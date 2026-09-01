//! Headless Chrome launch and a small Chrome DevTools Protocol client.
//!
//! Why hand-written over `tungstenite` rather than `headless_chrome`: the
//! JS engine's observable behaviour is puppeteer's (its launch flags,
//! `newPage` setup, `goto` lifecycle semantics, `evaluate` error text,
//! `screenshot` parameters). `headless_chrome` re-implements those with its
//! own defaults (different flags, its own navigation wait, a tab abstraction
//! that hides lifecycle events, and a `fetch` feature that downloads
//! browsers), so matching puppeteer would mean fighting the crate. The
//! protocol surface we need is tiny (a dozen methods, six events), and a
//! flat JSON-RPC layer over one websocket keeps every CDP call visible and
//! auditable against puppeteer's source.
//!
//! Everything here is synchronous: one websocket, one thread; events that
//! arrive while a command is in flight are queued and drained by the page
//! state machine after every call.

use std::collections::{HashMap, HashSet, VecDeque};
use std::io::{BufRead, BufReader};
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use serde_json::{json, Map, Value};
use tungstenite::client::IntoClientRequest;
use tungstenite::protocol::WebSocketConfig;
use tungstenite::{Message, WebSocket};

/// puppeteer's `launch` timeout (`timeout: 30000` in BrowserLauncher).
const LAUNCH_TIMEOUT: Duration = Duration::from_secs(30);
/// puppeteer's per-command `protocolTimeout` (180 s).
const PROTOCOL_TIMEOUT: Duration = Duration::from_secs(180);

#[derive(Debug, Clone)]
pub struct CdpError {
    pub message: String,
}

impl CdpError {
    pub fn new(message: impl Into<String>) -> Self {
        CdpError {
            message: message.into(),
        }
    }
}

impl From<String> for CdpError {
    fn from(message: String) -> Self {
        CdpError { message }
    }
}

pub type CdpResult<T> = Result<T, CdpError>;

/// puppeteer's `ChromeLauncher.defaultArgs()` (headless, no extensions) plus
/// the user args, in the order puppeteer emits them. `--remote-debugging-port`
/// and `--user-data-dir` are appended by the launcher afterwards, as
/// puppeteer's `computeLaunchArguments` does.
pub fn default_chrome_args(user_args: &[String], dangerous_no_sandbox: bool) -> Vec<String> {
    let mut args: Vec<String> = [
        "--allow-pre-commit-input",
        "--disable-background-networking",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-breakpad",
        "--disable-client-side-phishing-detection",
        "--disable-component-extensions-with-background-pages",
        "--disable-crash-reporter",
        "--disable-default-apps",
        "--disable-dev-shm-usage",
        "--disable-hang-monitor",
        "--disable-infobars",
        "--disable-ipc-flooding-protection",
        "--disable-popup-blocking",
        "--disable-prompt-on-repost",
        "--disable-renderer-backgrounding",
        "--disable-search-engine-choice-screen",
        "--disable-sync",
        "--enable-automation",
        "--export-tagged-pdf",
        "--force-color-profile=srgb",
        "--generate-pdf-document-outline",
        "--metrics-recording-only",
        "--no-first-run",
        "--password-store=basic",
        "--use-mock-keychain",
        "--disable-features=Translate,AcceptCHFrame,MediaRouter,OptimizationHints,WebUIReloadButton,ProcessPerSiteUpToMainFrameThreshold,IsolateSandboxedIframes",
        "--enable-features=PdfOopif",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    if dangerous_no_sandbox && !user_args.iter().any(|a| a == "--no-sandbox") {
        args.push("--no-sandbox".to_string());
    }
    args.push("--headless=new".to_string());
    args.push("--hide-scrollbars".to_string());
    args.push("--mute-audio".to_string());
    args.push("--disable-extensions".to_string());
    if user_args.iter().all(|a| a.starts_with('-')) {
        args.push("about:blank".to_string());
    }
    args.extend(user_args.iter().cloned());
    args
}

/// A running headless browser: the process, its temp profile, and the
/// browser-level CDP connection.
pub struct Browser {
    child: Child,
    user_data_dir: PathBuf,
    conn: Connection,
    /// Sessions of `worker` targets whose exceptions count as page errors,
    /// keyed by session id → owning page session id.
    worker_owner: HashMap<String, String>,
}

impl Browser {
    /// Launch `executable` headless the way puppeteer does and connect to its
    /// DevTools websocket.
    pub fn launch(
        executable: &std::path::Path,
        user_args: &[String],
        dangerous_no_sandbox: bool,
    ) -> CdpResult<Browser> {
        let mut args = default_chrome_args(user_args, dangerous_no_sandbox);
        args.push("--remote-debugging-port=0".to_string());
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let user_data_dir = std::env::temp_dir().join(format!(
            "impeccable_dev_chrome_profile-{}-{}",
            std::process::id(),
            stamp
        ));
        std::fs::create_dir_all(&user_data_dir).map_err(|e| {
            CdpError::new(format!("Failed to create a temporary browser profile: {e}"))
        })?;
        args.push(format!("--user-data-dir={}", user_data_dir.display()));

        let mut child = match Command::new(executable)
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                let _ = std::fs::remove_dir_all(&user_data_dir);
                return Err(CdpError::new(format!(
                    "Failed to launch the browser process! {}: {e}",
                    executable.display()
                )));
            }
        };
        let stderr = child.stderr.take();
        let (tx, rx) = mpsc::channel::<String>();
        if let Some(stderr) = stderr {
            // Drain stderr for the life of the process so a chatty browser
            // never blocks on a full pipe; forward lines for endpoint discovery.
            std::thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines() {
                    match line {
                        Ok(l) => {
                            let _ = tx.send(l);
                        }
                        Err(_) => break,
                    }
                }
            });
        }
        let started = Instant::now();
        let mut collected = String::new();
        let ws_url = loop {
            let remaining = LAUNCH_TIMEOUT.saturating_sub(started.elapsed());
            if remaining.is_zero() {
                let _ = child.kill();
                let _ = child.wait();
                let _ = std::fs::remove_dir_all(&user_data_dir);
                return Err(CdpError::new(format!(
                    "Timed out after {} ms while waiting for the WS endpoint URL to appear in stdout!",
                    LAUNCH_TIMEOUT.as_millis()
                )));
            }
            match rx.recv_timeout(remaining.min(Duration::from_millis(200))) {
                Ok(line) => {
                    if let Some(rest) = line.strip_prefix("DevTools listening on ") {
                        break rest.trim().to_string();
                    }
                    collected.push_str(&line);
                    collected.push('\n');
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    let _ = child.wait();
                    let _ = std::fs::remove_dir_all(&user_data_dir);
                    return Err(CdpError::new(format!(
                        "Failed to launch the browser process!{}",
                        if collected.trim().is_empty() {
                            String::new()
                        } else {
                            format!(" {}", collected.trim())
                        }
                    )));
                }
            }
            if let Ok(Some(status)) = child.try_wait() {
                // Give the reader a moment to flush the last lines.
                while let Ok(line) = rx.recv_timeout(Duration::from_millis(50)) {
                    collected.push_str(&line);
                    collected.push('\n');
                }
                let _ = std::fs::remove_dir_all(&user_data_dir);
                return Err(CdpError::new(format!(
                    "Failed to launch the browser process! (exit {status}){}",
                    if collected.trim().is_empty() {
                        String::new()
                    } else {
                        format!(" {}", collected.trim())
                    }
                )));
            }
        };
        let conn = match Connection::connect(&ws_url) {
            Ok(c) => c,
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = std::fs::remove_dir_all(&user_data_dir);
                return Err(e);
            }
        };
        Ok(Browser {
            child,
            user_data_dir,
            conn,
            worker_owner: HashMap::new(),
        })
    }

    /// `browser.close()`: `Browser.close`, wait for exit, remove the temp
    /// profile.
    pub fn close(mut self) {
        let _ = self
            .conn
            .send(None, "Browser.close", json!({}), Duration::from_secs(5));
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            match self.child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(25))
                }
                _ => {
                    let _ = self.child.kill();
                    let _ = self.child.wait();
                    break;
                }
            }
        }
        for _ in 0..10 {
            if std::fs::remove_dir_all(&self.user_data_dir).is_ok() || !self.user_data_dir.exists()
            {
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }

    /// `browser.newPage()`: a fresh target in the default context, attached
    /// flat, with puppeteer's page setup applied.
    pub fn new_page(&mut self) -> CdpResult<Page<'_>> {
        let created = self.conn.send(
            None,
            "Target.createTarget",
            json!({ "url": "about:blank" }),
            PROTOCOL_TIMEOUT,
        )?;
        let target_id = created
            .get("targetId")
            .and_then(Value::as_str)
            .ok_or_else(|| CdpError::new("Target.createTarget returned no targetId"))?
            .to_string();
        let attached = self.conn.send(
            None,
            "Target.attachToTarget",
            json!({ "targetId": target_id, "flatten": true }),
            PROTOCOL_TIMEOUT,
        )?;
        let session_id = attached
            .get("sessionId")
            .and_then(Value::as_str)
            .ok_or_else(|| CdpError::new("Target.attachToTarget returned no sessionId"))?
            .to_string();
        let mut page = Page {
            browser: self,
            session_id,
            target_id,
            frames: HashMap::new(),
            main_frame_id: String::new(),
            page_errors: Vec::new(),
            swapped: false,
            same_document_navigation: false,
            iframe_sessions: HashSet::new(),
        };
        page.initialize()?;
        Ok(page)
    }
}

impl Drop for Browser {
    fn drop(&mut self) {
        // Belt and braces for the error paths that skip `close()`.
        if let Ok(None) = self.child.try_wait() {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
        let _ = std::fs::remove_dir_all(&self.user_data_dir);
    }
}

/// Origin-scoped basic-auth injection state (JS `applyOriginScopedAuth`,
/// issue #657): while armed, `Fetch.requestPaused` events on the session are
/// answered inline with `Fetch.continueRequest`, adding the Authorization
/// header only for same-origin requests.
struct OriginAuth {
    session_id: String,
    origin: String,
    header: String,
}

/// One websocket to the browser; JSON-RPC ids and an event queue.
struct Connection {
    ws: WebSocket<TcpStream>,
    next_id: u64,
    events: VecDeque<Value>,
    auth: Option<OriginAuth>,
}

impl Connection {
    fn connect(ws_url: &str) -> CdpResult<Connection> {
        let parsed = url_host_port(ws_url)
            .ok_or_else(|| CdpError::new(format!("Unexpected DevTools endpoint: {ws_url}")))?;
        let stream = TcpStream::connect(&parsed).map_err(|e| {
            CdpError::new(format!("Could not connect to the browser at {ws_url}: {e}"))
        })?;
        let _ = stream.set_nodelay(true);
        let request = ws_url
            .into_client_request()
            .map_err(|e| CdpError::new(format!("Bad DevTools endpoint {ws_url}: {e}")))?;
        let config = WebSocketConfig::default()
            .max_message_size(Some(256 * 1024 * 1024))
            .max_frame_size(Some(256 * 1024 * 1024));
        let (ws, _response) =
            tungstenite::client::client_with_config(request, stream, Some(config)).map_err(
                |e| CdpError::new(format!("WebSocket handshake with the browser failed: {e}")),
            )?;
        Ok(Connection {
            ws,
            next_id: 0,
            events: VecDeque::new(),
            auth: None,
        })
    }

    /// JS `page.on('request', ...)` handler body from `applyOriginScopedAuth`:
    /// answer a paused request, attaching Authorization only when the request
    /// URL's origin equals the armed origin. Returns true when the message was
    /// a `Fetch.requestPaused` for the armed session (consumed).
    fn maybe_handle_request_paused(&mut self, msg: &Value) -> bool {
        let Some(auth) = &self.auth else { return false };
        if msg.get("method").and_then(Value::as_str) != Some("Fetch.requestPaused") {
            return false;
        }
        if msg.get("sessionId").and_then(Value::as_str) != Some(auth.session_id.as_str()) {
            return false;
        }
        let (session_id, origin, header) = (
            auth.session_id.clone(),
            auth.origin.clone(),
            auth.header.clone(),
        );
        let params = msg.get("params").cloned().unwrap_or(Value::Null);
        let Some(request_id) = params.get("requestId").and_then(Value::as_str) else {
            return true;
        };
        let req_url = params
            .pointer("/request/url")
            .and_then(Value::as_str)
            .unwrap_or("");
        // JS: invalid request URL -> continue without auth.
        let same_origin = url::Url::parse(req_url)
            .map(|u| u.origin().ascii_serialization() == origin)
            .unwrap_or(false);
        let mut cont = Map::new();
        cont.insert("requestId".into(), json!(request_id));
        if same_origin {
            // JS `{ ...request.headers(), authorization: header }`: puppeteer's
            // request.headers() lowercases names, so authorization overrides.
            let mut headers: Vec<Value> = Vec::new();
            if let Some(obj) = params.pointer("/request/headers").and_then(Value::as_object) {
                for (k, v) in obj {
                    let name = k.to_ascii_lowercase();
                    if name == "authorization" {
                        continue;
                    }
                    headers.push(json!({ "name": name, "value": v.as_str().unwrap_or("") }));
                }
            }
            headers.push(json!({ "name": "authorization", "value": header }));
            cont.insert("headers".into(), Value::Array(headers));
        }
        // JS `void request.continue(...).catch(() => {})`.
        let _ = self.post(
            Some(&session_id),
            "Fetch.continueRequest",
            Value::Object(cont),
        );
        true
    }

    /// Write a command and return its id without waiting for the reply.
    fn post(&mut self, session_id: Option<&str>, method: &str, params: Value) -> CdpResult<u64> {
        self.next_id += 1;
        let id = self.next_id;
        let mut msg = Map::new();
        msg.insert("id".into(), json!(id));
        msg.insert("method".into(), json!(method));
        msg.insert("params".into(), params);
        if let Some(sid) = session_id {
            msg.insert("sessionId".into(), json!(sid));
        }
        let text = Value::Object(msg).to_string();
        self.ws
            .send(Message::Text(text.into()))
            .map_err(|e| CdpError::new(format!("Protocol error ({method}): {e}")))?;
        Ok(id)
    }

    /// Send a command and wait for its result. Events that arrive meanwhile
    /// are queued. A `{ error }` reply becomes `Protocol error (method): message`
    /// (puppeteer's wording).
    fn send(
        &mut self,
        session_id: Option<&str>,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> CdpResult<Value> {
        let id = self.post(session_id, method, params)?;
        let deadline = Instant::now() + timeout;
        loop {
            let msg = match self.read_one(deadline)? {
                Some(m) => m,
                None => {
                    return Err(CdpError::new(format!(
                        "{method} timed out. Increase the 'protocolTimeout' setting in launch/connect calls for a higher timeout if needed."
                    )))
                }
            };
            if msg.get("id").and_then(Value::as_u64) == Some(id) {
                if let Some(err) = msg.get("error") {
                    let text = err.get("message").and_then(Value::as_str).unwrap_or("");
                    let data = err.get("data").and_then(Value::as_str);
                    let full = match data {
                        Some(d) if !d.is_empty() => format!("{text} {d}"),
                        _ => text.to_string(),
                    };
                    return Err(CdpError::new(format!("Protocol error ({method}): {full}")));
                }
                return Ok(msg.get("result").cloned().unwrap_or(Value::Null));
            }
            if msg.get("method").is_some() {
                self.events.push_back(msg);
            }
            // Replies to fire-and-forget posts are dropped.
        }
    }

    /// Read one message, or `None` when `deadline` passes first.
    fn read_one(&mut self, deadline: Instant) -> CdpResult<Option<Value>> {
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Ok(None);
            }
            let _ = self
                .ws
                .get_ref()
                .set_read_timeout(Some(remaining.max(Duration::from_millis(1))));
            match self.ws.read() {
                Ok(Message::Text(t)) => match serde_json::from_str::<Value>(&t) {
                    Ok(v) => {
                        // Answer paused requests inline so a pending command
                        // (goto, evaluate) whose completion depends on them
                        // cannot deadlock the single-threaded client.
                        if self.maybe_handle_request_paused(&v) {
                            continue;
                        }
                        return Ok(Some(v));
                    }
                    Err(_) => continue,
                },
                Ok(Message::Close(_)) => {
                    return Err(CdpError::new("Protocol error: Target closed"));
                }
                Ok(_) => continue,
                Err(tungstenite::Error::Io(e))
                    if matches!(
                        e.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) =>
                {
                    return Ok(None);
                }
                Err(e) => {
                    return Err(CdpError::new(format!(
                        "Protocol error: connection closed ({e})"
                    )));
                }
            }
        }
    }

    /// Pull queued events, then any events already readable without waiting.
    fn take_events(&mut self) -> Vec<Value> {
        let mut out: Vec<Value> = self.events.drain(..).collect();
        // Non-blocking sweep of what's already on the wire.
        let deadline = Instant::now() + Duration::from_millis(1);
        while let Ok(Some(msg)) = self.read_one(deadline) {
            if msg.get("method").is_some() {
                out.push(msg);
            }
        }
        out
    }
}

fn url_host_port(ws_url: &str) -> Option<String> {
    let rest = ws_url.strip_prefix("ws://")?;
    let host_port = rest.split('/').next()?;
    if host_port.contains(':') {
        Some(host_port.to_string())
    } else {
        Some(format!("{host_port}:80"))
    }
}

#[derive(Default, Debug)]
struct FrameState {
    parent: Option<String>,
    loader_id: String,
    lifecycle: HashSet<String>,
    has_started_loading: bool,
}

/// puppeteer's `Viewport` subset we use.
#[derive(Debug, Clone, Copy)]
pub struct Viewport {
    pub width: u32,
    pub height: u32,
}

/// A puppeteer `Page`: one attached target with lifecycle tracking, page
/// error capture, and the evaluate/screenshot helpers the URL engine uses.
pub struct Page<'a> {
    browser: &'a mut Browser,
    session_id: String,
    target_id: String,
    frames: HashMap<String, FrameState>,
    main_frame_id: String,
    page_errors: Vec<String>,
    swapped: bool,
    same_document_navigation: bool,
    /// Auto-attached OOPIF sessions whose Page events feed the frame map.
    iframe_sessions: HashSet<String>,
}

/// A raw `Runtime.evaluate` outcome.
pub enum EvalOutcome {
    Value(Value),
    /// The page threw: message as puppeteer's `createEvaluationError` renders it.
    Exception(String),
}

impl<'a> Page<'a> {
    fn send(&mut self, method: &str, params: Value) -> CdpResult<Value> {
        let sid = self.session_id.clone();
        let out = self
            .browser
            .conn
            .send(Some(&sid), method, params, PROTOCOL_TIMEOUT);
        self.pump_events();
        out
    }

    /// puppeteer's `CdpPage` + `FrameManager.initialize` for a new target.
    fn initialize(&mut self) -> CdpResult<()> {
        self.send("Page.enable", json!({}))?;
        let tree = self.send("Page.getFrameTree", json!({}))?;
        if let Some(ft) = tree.get("frameTree") {
            self.handle_frame_tree(ft, None);
        }
        self.send("Page.setLifecycleEventsEnabled", json!({ "enabled": true }))?;
        // URL mode injects only the snapshot producer (plain JS) and runs the
        // rules natively in this process over `SnapshotDom` (triage D2; see
        // WASM-BUNDLE.md in the detector repo): no WebAssembly is compiled next
        // to the page, so the page's Content-Security-Policy no longer gates
        // the scan and `Page.setBypassCSP` is not needed. Leaving CSP enforced keeps the
        // scan passive — a strict-CSP page's blocked inline scripts stay
        // blocked, matching the puppeteer engine (which never bypassed CSP).
        self.send("Runtime.enable", json!({}))?;
        self.send("Network.enable", json!({}))?;
        self.send("Performance.enable", json!({}))?;
        self.send("Log.enable", json!({}))?;
        self.send(
            "Target.setAutoAttach",
            json!({ "autoAttach": true, "waitForDebuggerOnStart": true, "flatten": true }),
        )?;
        Ok(())
    }

    fn handle_frame_tree(&mut self, tree: &Value, parent: Option<String>) {
        let Some(frame) = tree.get("frame") else {
            return;
        };
        let Some(id) = frame.get("id").and_then(Value::as_str) else {
            return;
        };
        let id = id.to_string();
        let parent_id = frame
            .get("parentId")
            .and_then(Value::as_str)
            .map(|s| s.to_string())
            .or(parent);
        if parent_id.is_none() && self.main_frame_id.is_empty() {
            self.main_frame_id = id.clone();
        }
        let entry = self.frames.entry(id.clone()).or_default();
        entry.parent = parent_id;
        if let Some(children) = tree.get("childFrames").and_then(Value::as_array) {
            for child in children {
                self.handle_frame_tree(child, Some(id.clone()));
            }
        }
    }

    /// Drain queued CDP events into page state (frames, errors, auto-attach).
    fn pump_events(&mut self) {
        let events = self.browser.conn.take_events();
        for ev in events {
            self.on_event(&ev);
        }
    }

    fn on_event(&mut self, ev: &Value) {
        let method = ev.get("method").and_then(Value::as_str).unwrap_or("");
        let session = ev.get("sessionId").and_then(Value::as_str).unwrap_or("");
        let params = ev.get("params").cloned().unwrap_or(Value::Null);
        let is_page_session = session == self.session_id || self.iframe_sessions.contains(session);
        match method {
            "Target.attachedToTarget" => {
                let Some(new_session) = params.get("sessionId").and_then(Value::as_str) else {
                    return;
                };
                let new_session = new_session.to_string();
                let ttype = params
                    .pointer("/targetInfo/type")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let waiting = params
                    .get("waitingForDebugger")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                // Only targets hanging off this page (or its iframes) matter.
                if !is_page_session {
                    if waiting {
                        let _ = self.browser.conn.post(
                            Some(&new_session),
                            "Runtime.runIfWaitingForDebugger",
                            json!({}),
                        );
                    }
                    return;
                }
                // Fire-and-forget setup, in order, so the target is configured
                // before it resumes (puppeteer's FrameManager / WebWorker init).
                let conn = &mut self.browser.conn;
                match ttype {
                    "iframe" => {
                        self.iframe_sessions.insert(new_session.clone());
                        let _ = conn.post(Some(&new_session), "Page.enable", json!({}));
                        let _ = conn.post(
                            Some(&new_session),
                            "Page.setLifecycleEventsEnabled",
                            json!({ "enabled": true }),
                        );
                        let _ = conn.post(Some(&new_session), "Runtime.enable", json!({}));
                        let _ = conn.post(Some(&new_session), "Network.enable", json!({}));
                    }
                    "worker" => {
                        self.browser
                            .worker_owner
                            .insert(new_session.clone(), self.session_id.clone());
                        let _ = conn.post(Some(&new_session), "Runtime.enable", json!({}));
                    }
                    _ => {}
                }
                let _ = conn.post(
                    Some(&new_session),
                    "Target.setAutoAttach",
                    json!({ "autoAttach": true, "waitForDebuggerOnStart": true, "flatten": true }),
                );
                if waiting {
                    let _ = conn.post(
                        Some(&new_session),
                        "Runtime.runIfWaitingForDebugger",
                        json!({}),
                    );
                }
            }
            "Target.detachedFromTarget" => {
                if let Some(sid) = params.get("sessionId").and_then(Value::as_str) {
                    self.iframe_sessions.remove(sid);
                    self.browser.worker_owner.remove(sid);
                }
            }
            "Runtime.exceptionThrown" => {
                let counts = session == self.session_id
                    || self
                        .browser
                        .worker_owner
                        .get(session)
                        .map(|owner| *owner == self.session_id)
                        .unwrap_or(false);
                if counts {
                    if let Some(details) = params.get("exceptionDetails") {
                        let message = client_error_message(details);
                        // detect-url.mjs: first line, trimmed, 160 chars, deduped.
                        let first = message.split('\n').next().unwrap_or("");
                        let trimmed = impeccable_core::js::trim(first);
                        let sliced: String = trimmed.chars().take(160).collect();
                        if !sliced.is_empty() && !self.page_errors.contains(&sliced) {
                            self.page_errors.push(sliced);
                        }
                    }
                }
            }
            _ if !is_page_session => {}
            "Page.frameAttached" => {
                let (Some(id), Some(parent)) = (
                    params.get("frameId").and_then(Value::as_str),
                    params.get("parentFrameId").and_then(Value::as_str),
                ) else {
                    return;
                };
                if !self.frames.contains_key(id) {
                    self.frames.insert(
                        id.to_string(),
                        FrameState {
                            parent: Some(parent.to_string()),
                            ..Default::default()
                        },
                    );
                }
            }
            "Page.frameDetached" => {
                let Some(id) = params.get("frameId").and_then(Value::as_str) else {
                    return;
                };
                let reason = params
                    .get("reason")
                    .and_then(Value::as_str)
                    .unwrap_or("remove");
                if reason == "swap" {
                    if id == self.main_frame_id {
                        self.swapped = true;
                    }
                } else {
                    self.remove_frame_recursively(id);
                }
            }
            "Page.frameNavigated" => {
                let Some(frame) = params.get("frame") else {
                    return;
                };
                let Some(id) = frame.get("id").and_then(Value::as_str) else {
                    return;
                };
                let is_main = frame.get("parentId").and_then(Value::as_str).is_none();
                if is_main && id != self.main_frame_id {
                    // Main frame id changed (cross-process swap): carry state over.
                    let old = self.frames.remove(&self.main_frame_id).unwrap_or_default();
                    self.frames.insert(id.to_string(), old);
                    self.main_frame_id = id.to_string();
                } else if !self.frames.contains_key(id) {
                    self.frames.insert(
                        id.to_string(),
                        FrameState {
                            parent: frame
                                .get("parentId")
                                .and_then(Value::as_str)
                                .map(String::from),
                            ..Default::default()
                        },
                    );
                }
                let ntype = params
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or("Navigation");
                if ntype == "BackForwardCacheRestore" {
                    self.swapped = true;
                }
            }
            "Page.navigatedWithinDocument" => {
                if params.get("frameId").and_then(Value::as_str)
                    == Some(self.main_frame_id.as_str())
                {
                    self.same_document_navigation = true;
                }
            }
            "Page.frameStartedLoading" => {
                if let Some(id) = params.get("frameId").and_then(Value::as_str) {
                    if let Some(f) = self.frames.get_mut(id) {
                        f.has_started_loading = true;
                    }
                }
            }
            "Page.frameStoppedLoading" => {
                if let Some(id) = params.get("frameId").and_then(Value::as_str) {
                    if let Some(f) = self.frames.get_mut(id) {
                        f.lifecycle.insert("DOMContentLoaded".into());
                        f.lifecycle.insert("load".into());
                    }
                }
            }
            "Page.lifecycleEvent" => {
                let (Some(id), Some(name)) = (
                    params.get("frameId").and_then(Value::as_str),
                    params.get("name").and_then(Value::as_str),
                ) else {
                    return;
                };
                let loader = params.get("loaderId").and_then(Value::as_str).unwrap_or("");
                if let Some(f) = self.frames.get_mut(id) {
                    if name == "init" {
                        f.loader_id = loader.to_string();
                        f.lifecycle.clear();
                    }
                    f.lifecycle.insert(name.to_string());
                }
            }
            _ => {}
        }
    }

    fn remove_frame_recursively(&mut self, id: &str) {
        let children: Vec<String> = self
            .frames
            .iter()
            .filter(|(_, f)| f.parent.as_deref() == Some(id))
            .map(|(k, _)| k.clone())
            .collect();
        for c in children {
            self.remove_frame_recursively(&c);
        }
        self.frames.remove(id);
    }

    /// LifecycleWatcher#checkLifecycle over the frame tree.
    fn lifecycle_complete(&self, frame_id: &str, expected: &str) -> bool {
        let Some(frame) = self.frames.get(frame_id) else {
            return false;
        };
        if !frame.lifecycle.contains(expected) {
            return false;
        }
        for (id, child) in &self.frames {
            if child.parent.as_deref() == Some(frame_id)
                && child.has_started_loading
                && !self.lifecycle_complete(id, expected)
            {
                return false;
            }
        }
        true
    }

    /// `page.setViewport({width, height})` (EmulationManager#applyViewport).
    pub fn set_viewport(&mut self, viewport: Viewport) -> CdpResult<()> {
        self.send(
            "Emulation.setDeviceMetricsOverride",
            json!({
                "mobile": false,
                "width": viewport.width,
                "height": viewport.height,
                "deviceScaleFactor": 1,
                "screenOrientation": { "angle": 0, "type": "portraitPrimary" },
            }),
        )?;
        self.send(
            "Emulation.setTouchEmulationEnabled",
            json!({ "enabled": false }),
        )?;
        Ok(())
    }

    /// JS detect-url.mjs#applyOriginScopedAuth(page, href, credentials):
    /// page.authenticate is page-wide (a cross-origin redirect that then 401s
    /// would receive the credentials), so Authorization is attached only to
    /// requests on the scan origin, via Fetch interception.
    pub fn apply_origin_scoped_auth(
        &mut self,
        href: &str,
        username: &str,
        password: &str,
    ) -> CdpResult<()> {
        let Ok(parsed) = url::Url::parse(href) else {
            return Ok(());
        };
        let origin = parsed.origin().ascii_serialization();
        if origin.is_empty() {
            return Ok(());
        }
        // JS `basicAuthHeader(credentials)`.
        use base64::Engine as _;
        let header = format!(
            "Basic {}",
            base64::engine::general_purpose::STANDARD.encode(format!("{username}:{password}"))
        );
        // JS `page.setRequestInterception(true)`.
        self.send("Fetch.enable", json!({}))?;
        self.browser.conn.auth = Some(OriginAuth {
            session_id: self.session_id.clone(),
            origin,
            header,
        });
        Ok(())
    }

    /// `page.goto(url, { waitUntil, timeout })`. `wait_until` is puppeteer's
    /// name (`load`, `domcontentloaded`, `networkidle0`, `networkidle2`).
    pub fn goto(&mut self, url: &str, wait_until: &str, timeout: Duration) -> CdpResult<()> {
        let expected = match wait_until {
            "load" => "load",
            "domcontentloaded" => "DOMContentLoaded",
            "networkidle0" => "networkIdle",
            "networkidle2" => "networkAlmostIdle",
            other => {
                return Err(CdpError::new(format!(
                    "Unknown value for options.waitUntil: {other}"
                )))
            }
        };
        self.pump_events();
        let initial_loader = self
            .frames
            .get(&self.main_frame_id)
            .map(|f| f.loader_id.clone())
            .unwrap_or_default();
        self.swapped = false;
        self.same_document_navigation = false;
        let deadline = Instant::now() + timeout;
        let timeout_msg = format!("Navigation timeout of {} ms exceeded", timeout.as_millis());

        let sid = self.session_id.clone();
        let frame_id = self.main_frame_id.clone();
        let nav_id = self.browser.conn.post(
            Some(&sid),
            "Page.navigate",
            json!({ "url": url, "frameId": frame_id }),
        )?;
        // Race the navigate reply against the lifecycle watcher's timeout.
        let ensure_new_document;
        loop {
            let msg = match self.browser.conn.read_one(deadline)? {
                Some(m) => m,
                None => return Err(CdpError::new(timeout_msg)),
            };
            if msg.get("id").and_then(Value::as_u64) == Some(nav_id) {
                if let Some(err) = msg.get("error") {
                    let text = err.get("message").and_then(Value::as_str).unwrap_or("");
                    return Err(CdpError::new(format!(
                        "Protocol error (Page.navigate): {text}"
                    )));
                }
                let result = msg.get("result").cloned().unwrap_or(Value::Null);
                ensure_new_document = result
                    .get("loaderId")
                    .and_then(Value::as_str)
                    .map(|s| !s.is_empty())
                    .unwrap_or(false);
                if let Some(text) = result.get("errorText").and_then(Value::as_str) {
                    if !text.is_empty() && text != "net::ERR_HTTP_RESPONSE_CODE_FAILURE" {
                        return Err(CdpError::new(format!("{text} at {url}")));
                    }
                }
                break;
            }
            if msg.get("method").is_some() {
                self.on_event(&msg);
                if !self.frames.contains_key(&self.main_frame_id) {
                    return Err(CdpError::new("Navigating frame was detached"));
                }
            }
        }
        // Wait for the lifecycle + (new-document | same-document) condition.
        loop {
            self.pump_events();
            if !self.frames.contains_key(&self.main_frame_id) {
                return Err(CdpError::new("Navigating frame was detached"));
            }
            let lifecycle_ok = self.lifecycle_complete(&self.main_frame_id.clone(), expected);
            if lifecycle_ok {
                let loader_changed = self
                    .frames
                    .get(&self.main_frame_id)
                    .map(|f| f.loader_id != initial_loader)
                    .unwrap_or(false);
                let new_doc = self.swapped || loader_changed;
                if ensure_new_document {
                    if new_doc {
                        return Ok(());
                    }
                } else if self.same_document_navigation {
                    return Ok(());
                }
            }
            match self.browser.conn.read_one(deadline)? {
                Some(msg) => {
                    if msg.get("method").is_some() {
                        self.on_event(&msg);
                    }
                }
                None => return Err(CdpError::new(timeout_msg)),
            }
        }
    }

    /// `page.evaluate(<expression string>)`: `Runtime.evaluate` with
    /// `awaitPromise` + `returnByValue`, in the main world.
    pub fn evaluate(&mut self, expression: &str) -> CdpResult<EvalOutcome> {
        let res = self.send(
            "Runtime.evaluate",
            json!({
                "expression": expression,
                "returnByValue": true,
                "awaitPromise": true,
                "userGesture": true,
            }),
        );
        let res = match res {
            Ok(r) => r,
            Err(e) => {
                // ExecutionContext#rewriteError
                if e.message.contains("Object reference chain is too long")
                    || e.message.contains("Object couldn't be returned by value")
                {
                    return Ok(EvalOutcome::Value(Value::Null));
                }
                if e.message.ends_with("Cannot find context with specified id")
                    || e.message.ends_with("Inspected target navigated or closed")
                {
                    return Err(CdpError::new(
                        "Execution context was destroyed, most likely because of a navigation.",
                    ));
                }
                return Err(e);
            }
        };
        if let Some(details) = res.get("exceptionDetails") {
            return Ok(EvalOutcome::Exception(client_error_message(details)));
        }
        let remote = res.get("result").cloned().unwrap_or(Value::Null);
        Ok(EvalOutcome::Value(value_from_remote_object(&remote)))
    }

    /// `page.evaluate` that treats a page exception as an engine error, the
    /// way `await page.evaluate(...)` throws in the JS.
    pub fn evaluate_value(&mut self, expression: &str) -> CdpResult<Value> {
        match self.evaluate(expression)? {
            EvalOutcome::Value(v) => Ok(v),
            EvalOutcome::Exception(message) => Err(CdpError::new(message)),
        }
    }

    /// `page.screenshot({ encoding: 'base64', clip, captureBeyondViewport: true })`.
    /// Returns base64 PNG data.
    pub fn screenshot_clip(
        &mut self,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    ) -> CdpResult<String> {
        // Page.screenshot: roundRectangle(normalizeRectangle(clip)).
        let (x, width) = if width < 0.0 {
            (x + width, -width)
        } else {
            (x, width)
        };
        let (y, height) = if height < 0.0 {
            (y + height, -height)
        } else {
            (y, height)
        };
        let round = |v: f64| impeccable_core::js::math_round(v);
        let res = self.send(
            "Page.captureScreenshot",
            json!({
                "format": "png",
                "optimizeForSpeed": false,
                "fromSurface": true,
                "clip": { "x": round(x), "y": round(y), "width": round(width), "height": round(height), "scale": 1 },
                "captureBeyondViewport": true,
            }),
        )?;
        Ok(res
            .get("data")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string())
    }

    /// The deduped `pageerror` messages so far.
    pub fn page_errors(&mut self) -> Vec<String> {
        self.pump_events();
        self.page_errors.clone()
    }

    /// `page.close()`: `Target.closeTarget`, errors swallowed like the JS
    /// `page.close().catch(() => {})`.
    pub fn close(self) {
        let target_id = self.target_id.clone();
        let _ = self.browser.conn.send(
            None,
            "Target.closeTarget",
            json!({ "targetId": target_id }),
            Duration::from_secs(10),
        );
        // Detached sessions may keep queued events; drop anything stale.
        self.browser.conn.events.clear();
        // Interception (origin-scoped auth) dies with the page; a shared
        // browser's next page must not inherit it.
        if self
            .browser
            .conn
            .auth
            .as_ref()
            .map(|a| a.session_id == self.session_id)
            .unwrap_or(false)
        {
            self.browser.conn.auth = None;
        }
    }
}

/// puppeteer `valueFromPrimitiveRemoteObject` for `returnByValue` results.
fn value_from_remote_object(remote: &Value) -> Value {
    if let Some(unser) = remote.get("unserializableValue").and_then(Value::as_str) {
        return match unser {
            "-0" => json!(-0.0),
            "NaN" | "Infinity" | "-Infinity" => Value::Null,
            other => Value::String(other.to_string()),
        };
    }
    remote.get("value").cloned().unwrap_or(Value::Null)
}

/// `String(err?.message || err)` over puppeteer's `createClientError` /
/// `createEvaluationError`: the message for an error object, the stringified
/// primitive otherwise.
pub fn client_error_message(details: &Value) -> String {
    let exception = details.get("exception");
    let Some(exception) = exception else {
        return details
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
    };
    let etype = exception.get("type").and_then(Value::as_str).unwrap_or("");
    let subtype = exception
        .get("subtype")
        .and_then(Value::as_str)
        .unwrap_or("");
    let has_object_id = exception.get("objectId").is_some();
    if (etype != "object" || subtype != "error") && !has_object_id {
        // A thrown primitive: String(value).
        if let Some(unser) = exception.get("unserializableValue").and_then(Value::as_str) {
            return match unser {
                "-0" => "0".to_string(),
                other if other.ends_with('n') => other.trim_end_matches('n').to_string(),
                other => other.to_string(),
            };
        }
        return match exception.get("value") {
            None => "undefined".to_string(),
            Some(Value::Null) => "null".to_string(),
            Some(Value::String(s)) => s.clone(),
            Some(Value::Bool(b)) => b.to_string(),
            Some(Value::Number(n)) => {
                impeccable_core::js::number_to_string(n.as_f64().unwrap_or(f64::NAN))
            }
            Some(other) => other.to_string(),
        };
    }
    // getErrorDetails
    let description = exception
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or("");
    let mut lines: Vec<&str> = if exception.get("description").is_some() {
        description.split("\n    at ").collect()
    } else {
        Vec::new()
    };
    let frames = details
        .pointer("/stackTrace/callFrames")
        .and_then(Value::as_array)
        .map(|a| a.len())
        .unwrap_or(0);
    let size = frames.min(lines.len().saturating_sub(1));
    if size > 0 {
        let keep = lines.len() - size;
        lines.truncate(keep);
    }
    let name = exception
        .get("className")
        .and_then(Value::as_str)
        .unwrap_or("");
    let mut message = lines.join("\n");
    if !name.is_empty() {
        let prefix = format!("{name}: ");
        if message.starts_with(&prefix) {
            message = message[prefix.len()..].to_string();
        }
    }
    message
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_message_extraction_matches_puppeteer() {
        let details = json!({
            "text": "Uncaught",
            "exception": {
                "type": "object", "subtype": "error", "className": "ReferenceError",
                "description": "ReferenceError: foo is not defined\n    at <anonymous>:1:1",
                "objectId": "1"
            },
            "stackTrace": { "callFrames": [{ "functionName": "", "url": "", "lineNumber": 0, "columnNumber": 0 }] }
        });
        assert_eq!(client_error_message(&details), "foo is not defined");
        let primitive =
            json!({ "text": "Uncaught", "exception": { "type": "string", "value": "boom" } });
        assert_eq!(client_error_message(&primitive), "boom");
        let none = json!({ "text": "Uncaught SyntaxError" });
        assert_eq!(client_error_message(&none), "Uncaught SyntaxError");
        let syntax = json!({
            "text": "Uncaught",
            "exception": { "type": "object", "subtype": "error", "className": "SyntaxError",
                "description": "SyntaxError: Unexpected token '}'", "objectId": "2" }
        });
        assert_eq!(client_error_message(&syntax), "Unexpected token '}'");
    }

    #[test]
    fn default_args_shape() {
        let args = default_chrome_args(&[], false);
        assert_eq!(args[0], "--allow-pre-commit-input");
        assert!(args.contains(&"--headless=new".to_string()));
        assert!(args.contains(&"--hide-scrollbars".to_string()));
        assert_eq!(args.last().unwrap(), "about:blank");
        let with = default_chrome_args(&["--no-sandbox".to_string()], false);
        assert_eq!(with.last().unwrap(), "--no-sandbox");
        assert!(with.contains(&"about:blank".to_string()));
    }
}
