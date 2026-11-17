//! `impeccable mcp`: the one Impeccable MCP server an agent runs, over stdio (REN-2053).
//!
//! Each agent starts its own process. It answers MCP's JSON-RPC, one message per line, and proxies every request to
//! the account service's `/mcp` under the CLI's own sign-in (`impeccable_account::session::Session`, which refreshes
//! a stale access token under the machine-wide lifecycle lock). So an agent never signs in itself, and a new scope
//! is asked for once, for the CLI.
//!
//! When the sign-in is gone (revoked, expired past refresh, or missing a scope the call needs), the call is held:
//! the agent gets "Waiting for you to approve in the browser" as progress, the CLI's own loopback sign-in opens the
//! browser, and the call is retried once. Without a browser (SSH, or no display) the answer is one line naming
//! `impeccable login`. Only one sign-in runs on the machine at a time: a second agent's call waits for it.
//!
//! stdout carries MCP frames only; diagnostics go to stderr. No token, authorization code, `state` or authorization
//! URL is ever written to either.
pub mod asset;
pub mod browser;
pub mod host_setup;
pub mod presence;

use impeccable_account::{config::Account, http::ApiError, session::{Session, SessionError}};
use impeccable_common::Io;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::time::{Duration, Instant, SystemTime};

/// What the agent reads while the person approves in the browser.
pub const WAITING: &str = "Waiting for you to approve in the browser";
/// The answer when nobody approved in time.
pub const NOT_APPROVED: &str = "Waiting for you to approve in the browser. Approve it there, then ask again.";
/// The answer where no browser can open (SSH, no display).
pub const NO_BROWSER: &str = "Sign in again: run `impeccable login`";
/// How long a held call waits for the person's approval.
pub const SIGN_IN_WAIT: Duration = Duration::from_secs(5 * 60);
const PROTOCOL: &str = "2025-06-18";

/// Why a call to the account service did not answer.
#[derive(Debug, PartialEq, Eq)]
pub enum Failure {
    /// The sign-in is gone or lacks a scope: signing in again may fix it.
    Auth,
    /// Anything else, in words safe to show (never a token).
    Other(String),
}

/// The account service's `/mcp`, and the CLI's own sign-in to it.
pub trait Upstream {
    fn call(&mut self, request: &Value) -> Result<Value, Failure>;
    /// Sign in again (or wait for another agent's sign-in). `Err` carries the line the agent reads.
    fn sign_in(&mut self) -> Result<(), String>;
    /// Whether a browser can open here; without one nobody is told to wait, and the answer is the one line.
    fn browser(&self) -> bool {
        true
    }
    /// PUT an artifact asset's bytes to the signed address the service reserved (`asset`); Err is the line the agent
    /// reads.
    fn upload(&mut self, _url: &str, _content_type: &str, _bytes: &[u8]) -> Result<(), String> {
        Err("Uploads aren't available here.".into())
    }
}

/// `impeccable mcp`: serve stdin until it closes.
pub fn run(args: &[String], io: &mut Io) -> i32 {
    if args.iter().any(|a| a == "--help" || a == "-h") {
        let _ = writeln!(io.stdout, "impeccable mcp: the Impeccable MCP server, over stdio, for a coding agent.\nAgents start it themselves; `impeccable install` adds it.");
        return 0;
    }
    let browser = can_open_browser(&io.env);
    let mut upstream = service(io.env.clone(), browser, Box::new(open_browser));
    let socket = browser::socket_path(&io.env);
    let stdin = std::io::stdin();
    let here = (io.env.clone(), io.cwd.clone());
    serve_session(stdin.lock(), &mut io.stdout, &mut io.stderr, &mut upstream, socket.as_deref(), Some((&here.0, &here.1)));
    0
}

/// Chrome starts the binary as the extension's native-messaging host with the extension's origin first: relay
/// until the extension closes. Any other origin is refused (Chrome's own manifest also admits only ours).
pub fn native_host(args: &[String], io: &mut Io) -> i32 {
    if !args.first().is_some_and(|a| browser::is_extension_origin(a)) {
        let _ = writeln!(io.stderr, "impeccable: not the Impeccable extension");
        return 2;
    }
    let Some(socket) = browser::socket_path(&io.env) else {
        let _ = writeln!(io.stderr, "impeccable: no home folder for the browser relay, or its path is too long");
        return 1;
    };
    match browser::host(&socket, std::io::stdin(), std::io::stdout()) {
        Ok(()) => 0,
        Err(e) => {
            let _ = writeln!(io.stderr, "impeccable: browser relay: {e}");
            1
        }
    }
}

/// Answer each JSON-RPC line from `input` on `out`.
pub fn serve(input: impl BufRead, out: &mut dyn Write, err: &mut dyn Write, upstream: &mut dyn Upstream) {
    serve_with(input, out, err, upstream, None);
}

/// `serve`, with the browser relay's socket: its tools are listed while the relay is up and free, and called over it.
pub fn serve_with(input: impl BufRead, out: &mut dyn Write, err: &mut dyn Write, upstream: &mut dyn Upstream, socket: Option<&std::path::Path>) {
    serve_session(input, out, err, upstream, socket, None);
}

/// `serve_with`, and with `here` (the environment and working folder) this session's presence record (REN-2124):
/// written at `initialize`, named by the first Needs-you call that names itself, removed when the session ends.
pub fn serve_session(
    input: impl BufRead,
    out: &mut dyn Write,
    err: &mut dyn Write,
    upstream: &mut dyn Upstream,
    socket: Option<&std::path::Path>,
    here: Option<(&std::collections::HashMap<String, String>, &std::path::Path)>,
) {
    let mut agent: Option<String> = None;
    let mut presence: Option<presence::Presence> = None;
    // The relay connection, kept only while this agent holds the browser (its last call wasn't refused as busy).
    let mut link: Option<browser::Link> = None;
    // Which relay socket was there at the last tools/list (its device, inode and change time, so a relay
    // replacing a crashed one's leftover file counts as new): when that changes (Chrome opened, closed or restarted after the agent
    // listed), the agent is told its tools changed, once. One stat per request, no probe.
    let mut listed_with: Option<Option<(u64, u64, i64, i64)>> = None;
    let relay_there = || socket.and_then(browser::socket_identity);
    for line in input.lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let Ok(mut request) = serde_json::from_str::<Value>(&line) else {
            frame(out, &json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": "Invalid JSON" } }));
            continue;
        };
        if request.get("method").and_then(Value::as_str) == Some("initialize") {
            agent = request.pointer("/params/clientInfo/name").and_then(Value::as_str).map(agent_label);
            if let (Some((env, cwd)), None) = (here, &presence) {
                presence = presence::Presence::start(env, agent.as_deref().unwrap_or("agent"), cwd);
            }
        }
        // The name the session gives itself, before a missing one is filled with the harness's.
        if let (Some(p), Some(from)) = (presence.as_mut(), named_by(&request)) {
            p.named(&from);
        }
        asked_as(&mut request, agent.as_deref());
        if listed_with.is_some_and(|was| was != relay_there()) {
            frame(out, &json!({ "jsonrpc": "2.0", "method": "notifications/tools/list_changed" }));
            listed_with = None;
        }
        if let Some(reply) = uploaded(&request, out, err, upstream, here.map(|(_, cwd)| cwd)) {
            frame(out, &reply);
            continue;
        }
        if let Some(socket) = socket {
            if let Some(reply) = browsed(&request, socket, agent.as_deref().unwrap_or("Your agent"), &mut link) {
                frame(out, &reply);
                continue;
            }
        }
        let listing = request.get("method").and_then(Value::as_str) == Some("tools/list");
        if listing {
            listed_with = Some(relay_there());
        }
        if let Some(mut reply) = answer(&request, out, err, upstream) {
            // The service's own `artifact.asset` takes a digest; the agent gets this one, which takes a file.
            if listing {
                if let Some(list) = reply.pointer_mut("/result/tools").and_then(Value::as_array_mut) {
                    if let Some(at) = list.iter().position(|t| t["name"] == asset::NAME) {
                        list[at] = asset::tool();
                    }
                }
            }
            // The agent driving keeps its tools; any other lists them while the relay is up and free. Local tools
            // don't wait on the account service: when its list fails, they're the list.
            if listing && (link.is_some() || socket.is_some_and(browser::ready)) {
                match reply.pointer_mut("/result/tools").and_then(Value::as_array_mut) {
                    Some(list) => list.extend(browser::tools()),
                    None => reply = json!({ "jsonrpc": "2.0", "id": request["id"], "result": { "tools": browser::tools() } }),
                }
            }
            frame(out, &reply);
        }
    }
}

/// An agent's name in a form the service always accepts as a session label: plain ASCII letters, digits and
/// `-_.@/+ `, at most 40 characters; empty when nothing is left (then no `from` is added).
fn agent_label(name: &str) -> String {
    let kept: String = name.chars().filter(|c| c.is_ascii_alphanumeric() || " -_.@/+".contains(*c)).take(40).collect();
    kept.trim().to_string()
}

/// Every agent on this machine shares the CLI's one sign-in, so a Needs-you call that doesn't name its session is
/// named for the agent that made it (its `clientInfo.name`): Claude Code and Codex keep their own questions.
/// The `from` a Needs-you call names itself with, if any.
fn named_by(request: &Value) -> Option<String> {
    if request.get("method").and_then(Value::as_str) != Some("tools/call")
        || !request.pointer("/params/name").and_then(Value::as_str).is_some_and(|n| n.starts_with("needs_you."))
    {
        return None;
    }
    request.pointer("/params/arguments/from").and_then(Value::as_str).filter(|f| !f.trim().is_empty()).map(str::to_string)
}

fn asked_as(request: &mut Value, agent: Option<&str>) {
    let Some(agent) = agent.filter(|a| !a.trim().is_empty()) else { return };
    if request.get("method").and_then(Value::as_str) != Some("tools/call") {
        return;
    }
    let needs_you = request.pointer("/params/name").and_then(Value::as_str).is_some_and(|n| n.starts_with("needs_you."));
    let Some(args) = request.pointer_mut("/params/arguments").and_then(Value::as_object_mut) else { return };
    if needs_you && !args.contains_key("from") {
        args.insert("from".into(), json!(agent));
    }
}

/// `artifact.asset` with a file: read and hashed here, reserved with the service, and its bytes uploaded only when the
/// workspace doesn't have them yet. None for anything else.
fn uploaded(
    request: &Value,
    out: &mut dyn Write,
    err: &mut dyn Write,
    upstream: &mut dyn Upstream,
    cwd: Option<&std::path::Path>,
) -> Option<Value> {
    if request.get("method").and_then(Value::as_str) != Some("tools/call") || request.pointer("/params/name") != Some(&json!(asset::NAME)) {
        return None;
    }
    let id = request.get("id").cloned().unwrap_or(Value::Null);
    let args = request.pointer("/params/arguments").cloned().unwrap_or_else(|| json!({}));
    let Some(path) = args["path"].as_str() else {
        return Some(said(&id, request, "Pass path: the file to upload."));
    };
    let here = cwd.map(std::path::Path::to_path_buf).or_else(|| std::env::current_dir().ok()).unwrap_or_default();
    let local = match asset::read(&here, path) {
        Ok(l) => l,
        Err(line) => return Some(said(&id, request, &line)),
    };
    let mut reserve = json!({ "sha256": local.sha256, "bytes": local.bytes.len(), "contentType": local.content_type });
    if let Some(w) = args.get("workspace") {
        reserve["workspace"] = w.clone();
    }
    let mut ask = json!({ "jsonrpc": "2.0", "id": id, "method": "tools/call", "params": { "name": asset::NAME, "arguments": reserve } });
    // The caller's progress token, so a sign-in on the way still tells it to wait.
    if let Some(meta) = request.pointer("/params/_meta") {
        ask["params"]["_meta"] = meta.clone();
    }
    let reply = held(&ask, out, err, upstream);
    let Some(result) = reply.get("result") else { return Some(reply) };
    Some(match asset::reservation(result) {
        Err(line) => said(&id, request, &line),
        Ok((key, None)) => json!({ "jsonrpc": "2.0", "id": id, "result": asset::done(&key) }),
        Ok((key, Some(url))) => match upstream.upload(&url, local.content_type, &local.bytes) {
            Ok(()) => json!({ "jsonrpc": "2.0", "id": id, "result": asset::done(&key) }),
            Err(line) => said(&id, request, &line),
        },
    })
}

/// A browser tool's call, answered over the relay; None for anything else.
fn browsed(request: &Value, socket: &std::path::Path, agent: &str, link: &mut Option<browser::Link>) -> Option<Value> {
    if request.get("method").and_then(Value::as_str) != Some("tools/call") {
        return None;
    }
    let name = request.pointer("/params/name").and_then(Value::as_str).filter(|n| browser::is_browser_tool(n))?;
    let id = request.get("id").cloned().unwrap_or(Value::Null);
    let args = request.pointer("/params/arguments").cloned().unwrap_or_else(|| json!({}));
    if link.is_none() {
        *link = browser::Link::connect(socket, agent);
    }
    let answer = match link.as_mut() {
        None => Err(browser::GONE.to_string()),
        Some(l) => l.call(name, &args),
    };
    Some(match answer {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err(line) => {
            // Busy or gone, this agent doesn't hold the browser: its next call connects afresh.
            *link = None;
            said(&id, request, &line)
        }
    })
}

fn frame(out: &mut dyn Write, v: &Value) {
    let _ = writeln!(out, "{v}");
    let _ = out.flush();
}

/// The reply to one request; None for a notification.
fn answer(request: &Value, out: &mut dyn Write, err: &mut dyn Write, upstream: &mut dyn Upstream) -> Option<Value> {
    let id = request.get("id")?.clone();
    let method = request.get("method").and_then(Value::as_str).unwrap_or("");
    let ok = |result: Value| json!({ "jsonrpc": "2.0", "id": id, "result": result });
    match method {
        "ping" => Some(ok(json!({}))),
        // Who we are is ours; what the service tells the model (its instructions) is passed on when it can be read.
        // Starting an agent never opens a browser: a missing sign-in is met on the first tool call instead.
        "initialize" => {
            let asked = request.pointer("/params/protocolVersion").and_then(Value::as_str).unwrap_or(PROTOCOL);
            let mut result = match upstream.call(request) {
                Ok(reply) => reply.get("result").cloned().unwrap_or_else(|| json!({})),
                Err(_) => json!({ "protocolVersion": asked }),
            };
            result["serverInfo"] = json!({ "name": "Impeccable", "version": env!("CARGO_PKG_VERSION") });
            result["capabilities"] = json!({ "tools": { "listChanged": true } });
            if result.get("protocolVersion").is_none() {
                result["protocolVersion"] = json!(asked);
            }
            Some(ok(result))
        }
        "tools/list" | "tools/call" => Some(held(request, out, err, upstream)),
        _ => Some(match upstream.call(request) {
            Ok(reply) => reply,
            Err(f) => failed(&id, f),
        }),
    }
}

/// A call that may need the person: tried, and on a sign-in failure signed in again and tried once more.
fn held(request: &Value, out: &mut dyn Write, err: &mut dyn Write, upstream: &mut dyn Upstream) -> Value {
    let id = request.get("id").cloned().unwrap_or(Value::Null);
    match upstream.call(request) {
        Ok(reply) => reply,
        Err(Failure::Other(why)) => failed(&id, Failure::Other(why)),
        Err(Failure::Auth) if !upstream.browser() => said(&id, request, NO_BROWSER),
        Err(Failure::Auth) => {
            if let Some(token) = request.pointer("/params/_meta/progressToken") {
                frame(out, &json!({ "jsonrpc": "2.0", "method": "notifications/progress", "params": { "progressToken": token, "progress": 0, "message": WAITING } }));
            }
            let _ = writeln!(err, "impeccable mcp: {WAITING}");
            match upstream.sign_in().and_then(|()| upstream.call(request).map_err(|f| match f {
                Failure::Auth => NOT_APPROVED.to_string(),
                Failure::Other(why) => why,
            })) {
                Ok(reply) => reply,
                Err(line) => said(&id, request, &line),
            }
        }
    }
}

/// The line the agent reads, as a tool's own error result where it asked for a tool, else as an error.
fn said(id: &Value, request: &Value, line: &str) -> Value {
    if request.get("method").and_then(Value::as_str) == Some("tools/call") {
        json!({ "jsonrpc": "2.0", "id": id, "result": { "content": [{ "type": "text", "text": line }], "isError": true } })
    } else {
        json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32001, "message": line } })
    }
}

fn failed(id: &Value, f: Failure) -> Value {
    let message = match f {
        Failure::Auth => NOT_APPROVED.to_string(),
        Failure::Other(why) => why,
    };
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32603, "message": message } })
}

/// The real account service, under the CLI's stored sign-in. `browser`: whether one can open here; `open` opens one
/// on the authorization URL and says whether it did (tests hand in the fake service's).
pub fn service(env: HashMap<String, String>, browser: bool, open: Box<dyn FnMut(&str) -> bool>) -> impl Upstream {
    Service { env, browser, open, unopened: None }
}

struct Service {
    env: HashMap<String, String>,
    browser: bool,
    open: Box<dyn FnMut(&str) -> bool>,
    /// A sign-in whose browser did not open, still waiting out its own deadline on its worker (which holds the
    /// machine's sign-in lock): until it ends, every call answers without starting another.
    unopened: Option<std::sync::mpsc::Receiver<bool>>,
}

impl Upstream for Service {
    fn upload(&mut self, url: &str, content_type: &str, bytes: &[u8]) -> Result<(), String> {
        let account = Account::from_env(&self.env).map_err(|e| e.to_string())?;
        // Up to 50 MB: more time than a tool call's minute.
        let client = impeccable_account::http::Client::with_deadline(&account, std::time::Duration::from_secs(600));
        match client.put_bytes(url, content_type, bytes) {
            Ok(_) => Ok(()),
            Err(ApiError::Status { status: 403, .. }) => Err("That upload is no longer allowed. Call artifact.asset again.".into()),
            Err(ApiError::Network(_)) => Err("Impeccable can’t be reached right now. Try again in a minute.".into()),
            Err(e) => Err(format!("The upload failed ({e}). Call artifact.asset again.")),
        }
    }

    fn call(&mut self, request: &Value) -> Result<Value, Failure> {
        let account = Account::from_env(&self.env).map_err(Failure::Other)?;
        let url = format!("{}/mcp", account.issuer);
        // Never a Keychain dialog from a process an agent started: a secret that needs one reads as signed out.
        let mut session = match Session::load_quietly(&account) {
            Ok(s) => s,
            Err(SessionError::NotSignedIn | SessionError::Expired) => return Err(Failure::Auth),
            Err(e) => return Err(Failure::Other(e.to_string())),
        };
        match session.call(|client, token| client.post_json(&url, token, request.clone())) {
            Ok(reply) => Ok(reply),
            Err(SessionError::NotSignedIn | SessionError::Expired) => Err(Failure::Auth),
            // 401: the sign-in is gone. 403 only for a missing scope (the service says `insufficient_scope`): a plan
            // or workspace refusal is the agent's to read, never a reason to open the browser again.
            Err(SessionError::Api(ApiError::Status { status: 401, .. })) => Err(Failure::Auth),
            Err(SessionError::Api(ApiError::Status { status: 403, code })) if code.as_deref() == Some("insufficient_scope") => Err(Failure::Auth),
            Err(SessionError::Api(ApiError::Status { status: 403, code })) => Err(Failure::Other(match code {
                Some(code) => format!("Impeccable refused that ({code}). Check your plan and workspace access."),
                None => "Impeccable refused that. Check your plan and workspace access.".into(),
            })),
            Err(SessionError::Api(ApiError::Network(_))) => Err(Failure::Other("Impeccable can’t be reached right now. Try again in a minute.".into())),
            Err(e) => Err(Failure::Other(e.to_string())),
        }
    }

    fn browser(&self) -> bool {
        self.browser
    }

    fn sign_in(&mut self) -> Result<(), String> {
        if !self.browser {
            return Err(NO_BROWSER.into());
        }
        if let Some(pending) = &self.unopened {
            if matches!(pending.try_recv(), Err(std::sync::mpsc::TryRecvError::Empty)) {
                return Err(NO_BROWSER.into());
            }
            self.unopened = None;
        }
        let dir = Account::from_env(&self.env).map_err(|_| NO_BROWSER.to_string())?.dir();
        let Some(held) = SignInLock::take(&dir)? else {
            // Another agent's sign-in is open: wait for it, then try with what it stored.
            return Ok(());
        };
        // The sign-in waits on its own thread for the browser's callback; a browser that did not open answers at
        // once (its listener ends with its own deadline), never after the five minutes.
        let (done_tx, done_rx) = std::sync::mpsc::channel::<bool>();
        let env = self.env.clone();
        let (url_tx, url_rx) = std::sync::mpsc::channel::<String>();
        // The worker holds the machine's sign-in lock until its login ends, so no other sign-in overlaps it.
        std::thread::spawn(move || {
            let _held = held;
            let signed = impeccable_account::login(&env, &mut |url: &str| { let _ = url_tx.send(url.to_string()); }, SIGN_IN_WAIT);
            let _ = done_tx.send(signed.is_ok());
        });
        // The URL is opened here, on this thread, where `open` lives; nothing else ever sees it.
        let Ok(url) = url_rx.recv_timeout(Duration::from_secs(30)) else {
            return Err(NOT_APPROVED.into());
        };
        if !(self.open)(&url) {
            self.unopened = Some(done_rx);
            return Err(NO_BROWSER.into());
        }
        match done_rx.recv_timeout(SIGN_IN_WAIT + Duration::from_secs(5)) {
            Ok(true) => Ok(()),
            _ => Err(NOT_APPROVED.into()),
        }
    }
}

/// Whether a browser can open here: not over SSH, and on Linux only with a display.
pub fn can_open_browser(env: &HashMap<String, String>) -> bool {
    let set = |k: &str| env.get(k).is_some_and(|v| !v.is_empty());
    if set("SSH_CONNECTION") || set("SSH_TTY") {
        return false;
    }
    !cfg!(target_os = "linux") || set("DISPLAY") || set("WAYLAND_DISPLAY")
}

fn open_browser(url: &str) -> bool {
    let mut cmd = if cfg!(target_os = "macos") {
        std::process::Command::new("open")
    } else if cfg!(windows) {
        let mut c = std::process::Command::new("cmd");
        c.args(["/C", "start", ""]);
        c
    } else {
        std::process::Command::new("xdg-open")
    };
    cmd.arg(url)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

/// One sign-in at a time on this machine. `take` returns the lock to hold while signing in, or None after waiting
/// out another agent's sign-in (it ended, or `SIGN_IN_WAIT` passed).
struct SignInLock(PathBuf);

impl SignInLock {
    fn take(dir: &std::path::Path) -> Result<Option<SignInLock>, String> {
        let _ = std::fs::create_dir_all(dir);
        let path = dir.join("mcp-sign-in.lock");
        let started = Instant::now();
        let mut waited = false;
        loop {
            match std::fs::OpenOptions::new().write(true).create_new(true).open(&path) {
                Ok(_) => return Ok(if waited { drop(SignInLock(path)); None } else { Some(SignInLock(path)) }),
                // Only another sign-in holding it is waited for; anything else (no permission, no disk) ends now.
                Err(e) if e.kind() != std::io::ErrorKind::AlreadyExists => return Err(format!("Could not start the sign-in: {e}")),
                Err(_) => {
                    let stale = std::fs::metadata(&path)
                        .and_then(|m| m.modified())
                        .ok()
                        .and_then(|t| SystemTime::now().duration_since(t).ok())
                        .is_some_and(|age| age > SIGN_IN_WAIT + Duration::from_secs(30));
                    if stale {
                        // A stale lock that can't be removed (another user's, say) ends the wait; it is never retried.
                        std::fs::remove_file(&path).map_err(|e| format!("Could not start the sign-in: {e}"))?;
                        continue;
                    }
                    if started.elapsed() > SIGN_IN_WAIT {
                        return Err(NOT_APPROVED.into());
                    }
                    waited = true;
                    std::thread::sleep(Duration::from_millis(500));
                }
            }
        }
    }
}

impl Drop for SignInLock {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

#[cfg(test)]
mod tests;
