//! `impeccable loop connect` and `loop disconnect`: connect a person's coding agents to
//! Needs you and Loop.
//!
//! For each agent found (Claude Code, Codex), connect:
//! 1. adds the Impeccable MCP server, only if the agent has no server of that name, through
//!    the agent's own CLI, then checks the exact global entry it wrote;
//! 2. adds Loop's hooks through the agents engine (journaled, undone exactly);
//! 3. writes the record Loop's helper reads.
//!
//! Disconnect stops Loop waking, then removes the hooks. It never removes an MCP server:
//! it prints the exact command for the person to run. Agent tokens are never seen or
//! stored here: each agent signs in to the MCP server itself.
use impeccable_agents::{installed_specs, recover_spec, run_spec, Hook, McpApproval, Spec};
use crate::loop_taste;
use impeccable_common::Io;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// The Impeccable MCP servers. Constants of the build: the account service the CLI
/// signs in to (`IMPECCABLE_ACCOUNT_URL`) chooses between them, and nothing else can name
/// one. An entry is written into the agent's own global configuration and outlives the
/// variable, so an account URL that is neither service is refused, never followed and
/// never replaced by production.
const MCP_URL: &str = "https://api.impeccable.style/mcp";
const STAGING_MCP_URL: &str = "https://api.staging.impeccable.style/mcp";
/// The account services, as `impeccable_account::config::normalize_origin` spells them.
const ACCOUNTS: [(&str, &str); 2] = [
    (impeccable_account::config::DEFAULT_ACCOUNT_URL, MCP_URL),
    ("https://api.staging.impeccable.style", STAGING_MCP_URL),
];
thread_local! {
    /// The server this command's account service names, set by every `init_mcp_url`
    /// (not once per process), so a later call with another account never reuses the
    /// first's. Per thread, as each command runs its connect on one.
    static MCP_FOR_ACCOUNT: std::cell::Cell<Option<&'static str>> = const { std::cell::Cell::new(None) };
}
/// A build with the `test-mcp-url` feature (staging end-to-end runs only, like
/// `test-release-keys`) may point connect at another https MCP server through
/// `IMPECCABLE_MCP_URL`. Shipped builds don't have the feature, so they ignore the
/// variable.
#[cfg(feature = "test-mcp-url")]
thread_local! {
    static MCP_OVERRIDE: std::cell::Cell<Option<&'static str>> = const { std::cell::Cell::new(None) };
}

fn mcp_url() -> &'static str {
    #[cfg(feature = "test-mcp-url")]
    if let Some(url) = MCP_OVERRIDE.get() {
        return url;
    }
    MCP_FOR_ACCOUNT.get().unwrap_or(MCP_URL)
}

/// The MCP server of the account service `raw` names (`IMPECCABLE_ACCOUNT_URL`, unset
/// for production), or why there is none.
fn mcp_for_account(raw: Option<&str>) -> Result<&'static str> {
    let Some(raw) = raw.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(MCP_URL);
    };
    let origin = impeccable_account::config::normalize_origin(raw);
    ACCOUNTS
        .iter()
        .find(|(account, _)| origin.as_deref() == Some(*account))
        .map(|(_, mcp)| *mcp)
        .ok_or_else(|| {
            "IMPECCABLE_ACCOUNT_URL isn't the Impeccable account or its staging service, so no MCP server was added. Unset it to connect to Impeccable.".into()
        })
}

/// In a `test-mcp-url` build, a set but unusable `IMPECCABLE_MCP_URL` is refused, never
/// replaced by production: falling back would send a staging run's agents to production.
fn init_mcp_url(io: &Io) -> Result<()> {
    #[cfg(feature = "test-mcp-url")]
    if let Some(url) = io.env("IMPECCABLE_MCP_URL") {
        let usable = url::Url::parse(url)
            .ok()
            .filter(|u| {
                // A local stack serves plain http on this machine only.
                let loopback = matches!(u.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
                (u.scheme() == "https" || (u.scheme() == "http" && loopback))
                    && u.host_str().is_some()
                    && u.as_str() == url
            });
        if usable.is_none() || url.contains(char::is_whitespace) {
            MCP_OVERRIDE.set(None);
            return Err("IMPECCABLE_MCP_URL must be a plain https URL, or http on localhost.".into());
        }
        // Leaked once per call, in test builds only.
        MCP_OVERRIDE.set(Some(Box::leak(url.to_string().into_boxed_str())));
        return Ok(());
    }
    #[cfg(feature = "test-mcp-url")]
    MCP_OVERRIDE.set(None);
    let url = mcp_for_account(io.env("IMPECCABLE_ACCOUNT_URL"));
    MCP_FOR_ACCOUNT.set(url.as_ref().ok().copied());
    url.map(|_| ())
}
const MCP_NAME: &str = "impeccable";
/// Why an existing entry of that name isn't the one connect would write.
const SETTINGS_DIFFER: &str = "its settings differ";
/// The agents-engine owner id for everything this writes.
const OWNER: &str = "impeccable-loop";
/// The instruction connect keeps in the agent's own rule file (~/.claude/CLAUDE.md,
/// ~/.codex/AGENTS.md) as an engine-managed block, so agents bring questions to Loop
/// instead of waiting in a terminal. Disconnect removes the block with the hooks.
const INSTRUCTION: &str = "When you need a person's decision or input, use needs_you.post (Impeccable) instead of asking in chat or a built-in question tool. If needs_you says Loop isn't connected, ask normally.";
const APP: &str = "Applications/Impeccable Loop.app";
const HELPER: &str = "Contents/MacOS/loop-hook";
/// Where Loop's helper keeps its state (the old name stays until Loop migrates it).
const SUPPORT_PARENT: &str = "Library/Application Support";
const SUPPORT: [&str; 2] = ["Impeccable Reviews", "Loop"];
/// This command's own note, per connected agent and config folder, of where its MCP
/// server lives, so disconnect can print the exact command to remove it.
const TARGETS: &str = "connect.json";
/// How long one connect or disconnect waits for another to finish.
const LOCK_WAIT: Duration = Duration::from_secs(10);
/// How long an agent's `mcp add` may take, Codex's browser sign-in included.
const ADD_WAIT: Duration = Duration::from_secs(300);

type Result<T> = std::result::Result<T, String>;

const AGENTS: [(&str, &str); 2] = [("claude", "Claude Code"), ("codex", "Codex")];

fn label(harness: &str) -> &'static str {
    AGENTS
        .iter()
        .find(|(h, _)| *h == harness)
        .map_or("Agent", |(_, l)| l)
}

/// One agent on this Mac, as connect sees it.
struct Agent {
    harness: &'static str,
    /// The agent's CLI, validated (absolute, an executable regular file).
    executable: PathBuf,
    /// Claude: the folder holding settings.json; Codex: CODEX_HOME.
    root: PathBuf,
    /// The file that holds the agent's global (user-scope) MCP servers.
    mcp_file: PathBuf,
    /// The variable that selects that file, set explicitly for every call (Claude's
    /// default account has none, and its CLI then runs with the variable removed).
    env: Option<(&'static str, PathBuf)>,
}

/// `loop connect`.
pub(crate) fn connect(io: &Io) -> Result<String> {
    connect_only(io, None)
}

/// `loop connect [--agent claude|codex]`: the full text report, sign-in and follow-up
/// steps included, for every agent or just the one named.
pub(crate) fn connect_only(io: &Io, only: Option<&str>) -> Result<String> {
    connect_text(io, only).0
}

/// [`connect_only`], plus the agents this run connected: when one agent fails, the
/// others are still connected and the result is an error naming the failure.
pub(crate) fn connect_text(io: &Io, only: Option<&str>) -> (Result<String>, Vec<String>) {
    match connect_agents(io, only) {
        Err(e) => (Err(e), Vec::new()),
        Ok((out, connected, failed, rows)) => {
            let agents = rows
                .iter()
                .filter(|r| r["result"] == "connected")
                .filter_map(|r| r["agent"].as_str().map(str::to_owned))
                .collect();
            (connect_report(out, only, connected, failed), agents)
        }
    }
}

fn connect_report(out: String, only: Option<&str>, connected: usize, failed: usize) -> Result<String> {
    if connected == 0 && failed == 0 {
        if let Some(harness) = only {
            return Err(format!("{}: not found.", label(harness)));
        }
        return Err(format!(
            "{out}No coding agent found to connect (Claude Code or Codex)."
        ));
    }
    if failed > 0 {
        return Err(out.trim_end().to_string());
    }
    Ok(out)
}

/// `loop connect [--agent claude|codex] --json`, for Loop's own Settings and first-run
/// panel: never asks anything, and always answers one JSON object on stdout. The bool
/// is whether every agent asked for connected.
pub(crate) fn connect_json(io: &Io, only: Option<&str>) -> (Value, bool) {
    match connect_agents(io, only) {
        Ok((_, connected, failed, agents)) => (
            json!({ "ok": failed == 0 && connected > 0, "agents": agents }),
            failed == 0 && connected > 0,
        ),
        Err(e) => (json!({ "ok": false, "error": e, "agents": [] }), false),
    }
}

/// Connects each agent (or just `only`), returning the text report, how many connected
/// and failed, and one JSON row per agent. Errors are the reasons nothing was tried.
fn connect_agents(io: &Io, only: Option<&str>) -> Result<(String, usize, usize, Vec<Value>)> {
    if let Some(h) = only {
        if !AGENTS.iter().any(|(a, _)| *a == h) {
            return Err(format!("Unknown agent: {h}. Use claude or codex."));
        }
    }
    init_mcp_url(io)?;
    let home = home(io)?;
    let helper = home.join(APP).join(HELPER);
    if !helper.is_file() {
        return Err(missing_loop(&helper));
    }
    // Checked before any agent's configuration changes.
    let support = support_dir(&home)?;
    let _lock = lock(&support)?;
    // Taken second, as --mcp-only takes it alone, so the two never add at once.
    let _mcp_lock = mcp_lock(io)?;
    let mut out = String::new();
    let mut rows = Vec::new();
    let (mut connected, mut failed) = (0, 0);
    for (harness, label) in AGENTS {
        if only.is_some_and(|h| h != harness) {
            continue;
        }
        let Some(agent) = agent(io, &home, harness) else {
            out.push_str(&format!("{label}: not found, skipped.\n"));
            rows.push(json!({ "agent": harness, "label": label, "result": "not_found" }));
            continue;
        };
        let file = rule_file(harness, &agent.root);
        let noted = note_missing_rule_file(&support, &file);
        let result = connect_one(&agent, &helper, &support);
        if noted && result.is_err() && fs::symlink_metadata(&file).is_err() {
            forget_missing_rule_file(&support, &file);
        }
        match result {
            Ok(manual) => {
                connected += 1;
                out.push_str(&format!(
                    "{label}: connected.\n  Sign in: {}\n",
                    sign_in(harness)
                ));
                if !manual.is_empty() {
                    out.push_str(&format!("  Then in {label}: {}.\n", manual.join("; ")));
                }
                rows.push(json!({
                    "agent": harness, "label": label, "result": "connected",
                    "signIn": sign_in(harness), "then": manual,
                }));
            }
            Err(e) => {
                failed += 1;
                out.push_str(&format!("{label}: not connected: {e}\n"));
                rows.push(json!({ "agent": harness, "label": label, "result": "failed", "error": e }));
            }
        }
    }
    if connected > 0 {
        out.push_str("To check it works, ask your agent to post a test question to Needs you.\n");
    }
    Ok((out, connected, failed, rows))
}

/// `loop status [--json]`: what Loop and each agent look like right now, read only.
/// Nothing is written and no lock is taken; the agents' CLIs are never run.
pub(crate) fn status(io: &Io) -> Result<Value> {
    init_mcp_url(io)?;
    let home = home(io)?;
    let helper = home.join(APP).join(HELPER);
    let loop_installed = helper.is_file();
    let version = helper
        .parent()
        .and_then(Path::parent)
        .and_then(|c| {
            Command::new("/usr/bin/plutil")
                .args(["-extract", "CFBundleShortVersionString", "raw", "-o", "-"])
                .arg(c.join("Info.plist"))
                .stdin(Stdio::null())
                .stderr(Stdio::null())
                .output()
                .ok()
        })
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());
    let support = SUPPORT
        .iter()
        .fold(home.join(SUPPORT_PARENT), |d, part| d.join(part));
    let installed = installed_specs(OWNER).map(|f| f.committed).unwrap_or_default();
    let mut agents = Vec::new();
    for (harness, label) in AGENTS {
        let Some(agent) = agent(io, &home, harness) else {
            agents.push(json!({ "agent": harness, "label": label, "detected": false }));
            continue;
        };
        let mcp = match read_entry(&agent) {
            Entry::Exact => "registered",
            Entry::Absent => "absent",
            Entry::Other(_) => "different",
        };
        // Hooks count only when the engine installed them for this very config folder and
        // every resource is still as written: a journal alone says nothing once a hook was
        // removed by hand. A folder with no installation is answered without touching the
        // engine's folder at all.
        let hooks = loop_installed
            && installed.iter().any(|s| s.harness == harness && s.root == agent.root)
            && run_spec("status", &spec(&agent, &helper)).is_ok_and(|s| {
                s["installed"] == true
                    && s["resources"]
                        .as_array()
                        .is_some_and(|r| r.iter().all(|x| x["state"] != "conflict"))
            });
        let rules = agent.root.join(if harness == "claude" { "CLAUDE.md" } else { "AGENTS.md" });
        let shadow = root_override(harness, &agent.root);
        // Present only where the agent reads it: under an override, the override must carry it.
        let instruction = fs::read_to_string(shadow.as_deref().unwrap_or(&rules))
            .is_ok_and(|t| t.contains(INSTRUCTION));
        // The wake record is shared per agent; it speaks for this folder only when it names it.
        let root = agent.root.display().to_string();
        let connected = read_record(&support, harness).is_some_and(|r| {
            r["enabled"] == true
                && (r["configDir"].as_str() == Some(root.as_str())
                    || r["accounts"]
                        .as_array()
                        .is_some_and(|a| a.iter().any(|x| x.as_str() == Some(root.as_str()))))
        });
        agents.push(json!({
            "agent": harness, "label": label, "detected": true,
            "mcp": mcp, "hooks": hooks, "instruction": instruction, "connected": connected,
            "instructionShadowed": shadow.is_some() && !instruction,
        }));
    }
    Ok(json!({
        "loop": { "installed": loop_installed, "version": version },
        "agents": agents,
    }))
}

/// The plain-text form of `status`.
pub(crate) fn status_text(v: &Value) -> String {
    let mut out = match v["loop"]["version"].as_str() {
        Some(ver) if v["loop"]["installed"] == true => format!("Loop {ver}: installed.\n"),
        _ if v["loop"]["installed"] == true => "Loop: installed.\n".to_string(),
        _ => "Loop: not installed. Run impeccable loop install.\n".to_string(),
    };
    for a in v["agents"].as_array().into_iter().flatten() {
        let label = a["label"].as_str().unwrap_or("Agent");
        if a["detected"] != true {
            out.push_str(&format!("{label}: not found.\n"));
        } else if a["connected"] == true
            && a["hooks"] == true
            && a["instruction"] == true
            && a["mcp"] == "registered"
        {
            out.push_str(&format!("{label}: connected.\n"));
        } else {
            out.push_str(&format!(
                "{label}: not connected (MCP server {}, hooks {}, instruction {}). Run impeccable loop connect.\n",
                a["mcp"].as_str().unwrap_or("absent"),
                if a["hooks"] == true { "present" } else { "missing" },
                if a["instruction"] == true {
                    "present"
                } else if a["instructionShadowed"] == true {
                    "hidden by AGENTS.override.md"
                } else {
                    "missing"
                },
            ));
        }
    }
    out
}

/// The MCP server, added only when the agent has none of that name. True when this call
/// added it; an entry of that name that differs is left alone and is an error.
fn ensure_mcp(agent: &Agent) -> Result<bool> {
    let mut added = false;
    match read_entry(agent) {
        Entry::Exact => {}
        Entry::Other(why) if why == SETTINGS_DIFFER => {
            return Err(format!(
                "{} already has a different MCP server called {MCP_NAME}; it was left alone. Remove or rename it, then connect again.",
                agent.mcp_file.display()
            ))
        }
        Entry::Other(why) => {
            return Err(format!(
                "{} already has an MCP server called {MCP_NAME} ({why}); it was left alone",
                agent.mcp_file.display()
            ))
        }
        Entry::Absent => {
            let ran = add_server(agent);
            // Codex writes the entry, then signs in; a sign-in left unfinished still leaves
            // the exact entry, which is kept (the person signs in later).
            match read_entry(agent) {
                Entry::Exact => added = true,
                Entry::Absent => {
                    return Err(ran
                        .err()
                        .unwrap_or_else(|| "the agent didn't add the MCP server".into()))
                }
                Entry::Other(why) => {
                    return Err(format!(
                        "the MCP server the agent wrote isn't as expected ({why}); check {}",
                        agent.mcp_file.display()
                    ))
                }
            }
        }
    }
    Ok(added)
}

/// `loop connect --mcp-only [--agent claude|codex] [--json]`: the MCP server alone, for a
/// person without the Loop app (any OS). No hooks, no taste block, no Loop records: each
/// agent signs in to the server itself on first use.
pub(crate) fn connect_mcp(io: &Io, only: Option<&str>) -> (Result<String>, Value, bool) {
    let rows = (|| -> Result<(String, usize, usize, Vec<Value>)> {
        if let Some(h) = only {
            if !AGENTS.iter().any(|(a, _)| *a == h) {
                return Err(format!("Unknown agent: {h}. Use claude or codex."));
            }
        }
        init_mcp_url(io)?;
        let home = home(io)?;
        let _lock = mcp_lock(io)?;
        let (mut out, mut rows, mut connected, mut failed) = (String::new(), Vec::new(), 0, 0);
        for (harness, label) in AGENTS {
            if only.is_some_and(|h| h != harness) {
                continue;
            }
            let Some(agent) = agent(io, &home, harness) else {
                out.push_str(&format!("{label}: not found, skipped.\n"));
                rows.push(json!({ "agent": harness, "label": label, "result": "not_found" }));
                continue;
            };
            match ensure_mcp(&agent) {
                Ok(added) => {
                    connected += 1;
                    let what = if added { "MCP server added" } else { "MCP server already there" };
                    out.push_str(&format!("{label}: {what}.\n  Sign in: {}\n", sign_in(harness)));
                    rows.push(json!({ "agent": harness, "label": label, "result": "connected", "added": added, "signIn": sign_in(harness) }));
                }
                Err(e) => {
                    failed += 1;
                    out.push_str(&format!("{label}: not connected: {e}\n"));
                    rows.push(json!({ "agent": harness, "label": label, "result": "failed", "error": e }));
                }
            }
        }
        Ok((out, connected, failed, rows))
    })();
    match rows {
        Err(e) => (Err(e.clone()), json!({ "ok": false, "error": e, "agents": [] }), false),
        Ok((out, connected, failed, rows)) => {
            let ok = failed == 0 && connected > 0;
            (connect_report(out, only, connected, failed), json!({ "ok": ok, "agents": rows }), ok)
        }
    }
}

/// One agent. A failure after the hooks were newly installed undoes them; an earlier,
/// working installation is never undone by a failed reconnect. The MCP server is never
/// removed here: a failure says how to remove it.
fn connect_one(agent: &Agent, helper: &Path, support: &Path) -> Result<Vec<String>> {
    if agent.harness == "codex" {
        if let Some(other) = read_record(support, "codex")
            .filter(|r| r["enabled"] == true)
            .and_then(|r| r["configDir"].as_str().map(PathBuf::from))
            .filter(|dir| *dir != agent.root)
        {
            return Err(format!(
                "Codex is already connected for {}; run impeccable loop disconnect first.",
                other.display()
            ));
        }
    }
    // 1. The MCP server.
    let added = ensure_mcp(agent)?;
    let with_mcp = |why: String| -> String {
        if added {
            format!(
                "{why}; the {MCP_NAME} MCP server it added stays, remove it with: {}",
                remove_command(agent)
            )
        } else {
            why
        }
    };
    if let Err(e) = note_target(support, agent) {
        return Err(with_mcp(e));
    }
    // 2. Loop's hooks, through the engine.
    let spec = spec(agent, helper);
    // An installation whose state can't be read is never treated as absent: a failure
    // below would then undo hooks that were working.
    let was_installed = match run_spec("status", &spec) {
        Ok(s) => s["installed"] == true,
        Err((_, msg)) => return Err(with_mcp(format!("couldn't read its hooks: {msg}"))),
    };
    if let Err((_, msg)) = run_spec("apply", &spec) {
        return Err(with_mcp(match recover_spec(&spec) {
            Ok(r) if r["state"] == "conflict" => format!(
                "{msg}; its half-applied hooks couldn't be rolled back because a file changed, see impeccable agents recover"
            ),
            Ok(_) => msg,
            Err((_, m)) => format!("{msg}; rolling back its hooks also failed: {m}"),
        }));
    }
    // The record as it was, so a failure puts it back: Loop keeps waking exactly what
    // it woke before, and nothing this connect only began.
    let prior_record = fs::read(support.join(format!("{}-install.json", agent.harness))).ok();
    let rollback = |why: String| -> String {
        let mut why = why;
        if let Err(e) = restore_record(support, agent.harness, prior_record.as_deref()) {
            why = format!("{why}; putting back Loop's record also failed: {e}");
        }
        if !was_installed {
            if let Err((_, msg)) = run_spec("undo", &spec) {
                return with_mcp(format!("{why}; undoing its hooks also failed: {msg}"));
            }
        }
        with_mcp(why)
    };
    // 3. The record Loop's helper reads, then a check that everything is in place.
    if let Err(e) = write_record(support, agent, true) {
        return Err(rollback(e));
    }
    let status = match run_spec("status", &spec) {
        Ok(s) => s,
        Err((_, m)) => return Err(rollback(m)),
    };
    let resources = status["resources"].as_array().cloned().unwrap_or_default();
    if status["installed"] != true
        || resources.is_empty()
        || resources.iter().any(|r| r["state"] == "conflict")
    {
        return Err(rollback(
            "its hooks aren't in place after installing; run impeccable loop connect again".into(),
        ));
    }
    let mut manual: Vec<String> = status["manualActions"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default();
    // The engine wrote the instruction, but Codex reads AGENTS.override.md in its place.
    if status["effective"] == false {
        manual.push(shadowed_advice(&agent.root));
    }
    Ok(manual)
}

/// Codex reads `AGENTS.override.md` instead of `AGENTS.md` when both exist, so the
/// instruction connect wrote never reaches it.
fn root_override(harness: &str, root: &Path) -> Option<PathBuf> {
    let p = root.join("AGENTS.override.md");
    (harness == "codex" && p.exists()).then_some(p)
}

fn shadowed_advice(root: &Path) -> String {
    format!(
        "add this line to {}, which Codex reads instead of AGENTS.md: {INSTRUCTION}",
        root.join("AGENTS.override.md").display()
    )
}

/// `loop disconnect`: every installation connect made (from the engine's journals, not
/// today's environment), each on its own. Waking stops first; the hooks go; MCP servers
/// stay, with the exact command to remove each.
pub(crate) fn disconnect(io: &Io) -> Result<String> {
    // Disconnect adds no server, so an account URL connect would refuse never blocks it;
    // the URL only decides whether a recorded entry still matches.
    let _ = init_mcp_url(io);
    let home = home(io)?;
    let support = support_dir(&home)?;
    let _lock = lock(&support)?;
    let mut out = String::new();
    let mut failed = false;
    // A connect that stopped part way is rolled back first, so its hooks are either
    // gone or committed (and then undone below).
    let found = installed_specs(OWNER).map_err(|(_, m)| m)?;
    // The taste block goes before the engine's undo, so the engine finds each rule file
    // exactly as it wrote it and cleans up after itself (a file it created goes too).
    let every: Vec<&Spec> = found.pending.iter().chain(&found.committed).collect();
    let (taste_ok, created) = remove_taste(&home, &support, &every, &mut out);
    failed |= !taste_ok;
    let mut rolled_back = Vec::new();
    for spec in &found.pending {
        let label = label(&spec.harness);
        match recover_spec(spec) {
            Ok(r) if r["state"] == "conflict" => {
                failed = true;
                out.push_str(&format!(
                    "{label}: an earlier connect stopped part way and a file it touched has changed since; its hooks were left as they are.\n"
                ));
            }
            Ok(_) => rolled_back.push(spec),
            Err((_, msg)) => {
                failed = true;
                out.push_str(&format!(
                    "{label}: an earlier connect stopped part way and rolling it back failed: {msg}\n"
                ));
            }
        }
    }
    let found = installed_specs(OWNER).map_err(|(_, m)| m)?;
    for path in &found.unreadable {
        failed = true;
        out.push_str(&format!(
            "Couldn't read {}; whatever it installed was left in place.\n",
            path.display()
        ));
    }
    let specs = found.committed;
    // A rolled-back first connect has no journal left, but may have added the MCP
    // server and Loop's record: stop the waking and say how to remove the server.
    for spec in rolled_back {
        if specs
            .iter()
            .any(|s| s.harness == spec.harness && s.root == spec.root)
        {
            continue;
        }
        let label = label(&spec.harness);
        match forget_account(&support, &spec.harness, &spec.root) {
            Ok(()) => out.push_str(&format!(
                "{label}: an earlier connect that stopped part way was rolled back.\n"
            )),
            Err(e) => {
                failed = true;
                out.push_str(&format!("{label}: couldn't stop Loop waking it: {e}\n"));
            }
        }
        out.push_str(&mcp_stays(&support, spec));
    }
    for spec in &specs {
        if let Err(e) = forget_account(&support, &spec.harness, &spec.root) {
            failed = true;
            out.push_str(&format!(
                "{}: couldn't stop Loop waking it: {e}\n",
                label(&spec.harness)
            ));
        }
    }
    for spec in &specs {
        let label = label(&spec.harness);
        match run_spec("undo", spec) {
            Ok(result) => match result["conflicts"].as_array().map_or(0, Vec::len) {
                0 => out.push_str(&format!("{label}: disconnected.\n")),
                kept => out.push_str(&format!(
                    "{label}: disconnected; {kept} hooks you changed were left in place.\n"
                )),
            },
            Err((_, msg)) => {
                failed = true;
                out.push_str(&format!("{label}: hooks not removed: {msg}\n"));
            }
        }
        out.push_str(&mcp_stays(&support, spec));
    }
    // A rule file connect created for the taste block alone goes once it is empty
    // again. A file the person had before, even an empty one, stays, as does a link.
    for file in created {
        if fs::symlink_metadata(&file).is_ok_and(|m| m.is_file() && m.len() == 0) {
            let _ = fs::remove_file(&file);
        }
    }
    if out.is_empty() {
        out.push_str("Nothing to disconnect.\n");
    }
    if failed {
        return Err(out.trim_end().to_string());
    }
    Ok(out)
}

/// The line saying where `spec`'s MCP server stays and the exact command to remove it,
/// or nothing when connect recorded no target or the server is already gone.
fn mcp_stays(support: &Path, spec: &Spec) -> String {
    match recorded_target(support, &spec.harness, &spec.root) {
        Some(agent) if !matches!(read_entry(&agent), Entry::Absent) => format!(
            "  Its {MCP_NAME} MCP server stays in {}. To remove it: {}\n",
            agent.mcp_file.display(),
            remove_command(&agent)
        ),
        _ => String::new(),
    }
}

/// Why connect can't go on without Loop's helper. When agents are already connected,
/// their hooks call that path and stop waking without an error, so say so.
fn missing_loop(helper: &Path) -> String {
    let connected = installed_specs(OWNER).is_ok_and(|found| !found.committed.is_empty());
    if connected {
        format!(
            "Loop's hooks point at a Loop that isn't there: {} is missing, so your agents' sessions won't wake. Loop has to stay in ~/Applications (if you moved it to /Applications, move it back, or run impeccable loop install), then run impeccable loop connect again.",
            helper.display()
        )
    } else {
        "Impeccable Loop isn't installed in ~/Applications, or is too old to connect agents. Run impeccable loop install first.".into()
    }
}

fn home(io: &Io) -> Result<PathBuf> {
    // The engine's one reading of home: USERPROFILE first on Windows, HOME elsewhere.
    io.home()
        .filter(|h| h.is_absolute())
        .ok_or_else(|| "HOME is not set to an absolute path.".into())
}

/// The agent as connect configures it today, if its CLI is found.
fn agent(io: &Io, home: &Path, harness: &'static str) -> Option<Agent> {
    let executable = resolve(io, harness)?;
    // A relative folder means what it means to the agent started from here: resolved
    // against this directory, never dropped (that would connect the default account).
    let var = |name: &str| {
        io.env(name)
            .filter(|v| !v.is_empty())
            .map(|v| {
                io.cwd
                    .join(v)
                    .components()
                    .filter(|c| !matches!(c, std::path::Component::CurDir))
                    .collect::<PathBuf>()
            })
    };
    Some(if harness == "claude" {
        // Claude keeps user-scope MCP servers in .claude.json: in CLAUDE_CONFIG_DIR when
        // that is set, else in HOME.
        let custom = var("CLAUDE_CONFIG_DIR");
        Agent {
            harness,
            executable,
            root: custom.clone().unwrap_or_else(|| home.join(".claude")),
            mcp_file: custom
                .as_ref()
                .map_or_else(|| home.join(".claude.json"), |dir| dir.join(".claude.json")),
            env: custom.map(|d| ("CLAUDE_CONFIG_DIR", d)),
        }
    } else {
        let root = var("CODEX_HOME").unwrap_or_else(|| home.join(".codex"));
        Agent {
            harness,
            executable,
            mcp_file: root.join("config.toml"),
            env: Some(("CODEX_HOME", root.clone())),
            root,
        }
    })
}

/// Where a recorded installation's MCP server lives, from connect's note (exact, as
/// connect saw it), for the message disconnect prints. No CLI is run from this.
fn recorded_target(support: &Path, harness: &str, root: &Path) -> Option<Agent> {
    let note = read_json(&support.join(TARGETS))?;
    let entry = &note["targets"][format!("{harness}:{}", root.display())];
    let mcp_file = PathBuf::from(entry["file"].as_str()?);
    let env = entry["env"].as_array().and_then(|kv| {
        let name = match kv.first()?.as_str()? {
            "CLAUDE_CONFIG_DIR" => "CLAUDE_CONFIG_DIR",
            "CODEX_HOME" => "CODEX_HOME",
            _ => return None,
        };
        Some((name, PathBuf::from(kv.get(1)?.as_str()?)))
    });
    Some(Agent {
        harness: if harness == "claude" {
            "claude"
        } else {
            "codex"
        },
        executable: PathBuf::new(),
        root: root.to_path_buf(),
        mcp_file,
        env,
    })
}

fn note_target(support: &Path, agent: &Agent) -> Result<()> {
    let mut note = read_json(&support.join(TARGETS)).unwrap_or_else(|| json!({}));
    if !note["targets"].is_object() {
        note["targets"] = json!({});
    }
    note["targets"][format!("{}:{}", agent.harness, agent.root.display())] = json!({
        "file": agent.mcp_file.display().to_string(),
        "env": agent.env.as_ref().map(|(k, v)| json!([k, v.display().to_string()])),
    });
    publish(support, TARGETS, &note)
}

/// The agent's CLI, resolved once: the engine's override variable, else the first
/// executable regular file named for it in an absolute PATH entry (relative entries such
/// as `.` are skipped).
fn resolve(io: &Io, harness: &str) -> Option<PathBuf> {
    let over = if harness == "claude" {
        "IMPECCABLE_CLAUDE_BIN"
    } else {
        "IMPECCABLE_CODEX_BIN"
    };
    if let Some(path) = io.env(over).filter(|v| !v.is_empty()) {
        let p = PathBuf::from(path);
        return runnable(&p).then_some(p);
    }
    // Windows finds a CLI by its extension (npm installs `claude.cmd`), and separates
    // PATH entries with `;`, which split_paths knows.
    let names: &[&str] = if cfg!(windows) { &[".exe", ".cmd", ".bat"] } else { &[""] };
    let path = io.env("PATH")?;
    std::env::split_paths(path)
        .filter(|d| d.is_absolute())
        .flat_map(|d| names.iter().map(move |ext| d.join(format!("{harness}{ext}"))))
        .find(|p| runnable(p))
}

fn runnable(p: &Path) -> bool {
    p.is_absolute()
        && fs::metadata(p).is_ok_and(|m| {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                m.is_file() && m.permissions().mode() & 0o111 != 0
            }
            #[cfg(not(unix))]
            {
                m.is_file()
            }
        })
}

enum Entry {
    Absent,
    /// Exactly the entry connect writes, and nothing else.
    Exact,
    /// Something else under that name, or a file that can't be read as expected.
    Other(String),
}

/// The agent's global `impeccable` MCP entry, read from its own file (never through the
/// CLI, whose view merges in project settings and leaves fields out).
fn read_entry(agent: &Agent) -> Entry {
    let bytes = match fs::read(&agent.mcp_file) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Entry::Absent,
        Err(e) => return Entry::Other(e.to_string()),
    };
    let text = String::from_utf8_lossy(&bytes);
    if agent.harness == "claude" {
        let Ok(v) = serde_json::from_str::<Value>(&text) else {
            return Entry::Other("its file isn't valid JSON".into());
        };
        return match v.get("mcpServers").and_then(|s| s.get(MCP_NAME)) {
            None => Entry::Absent,
            Some(e) if *e == json!({"type": "http", "url": mcp_url()}) => Entry::Exact,
            Some(_) => Entry::Other(SETTINGS_DIFFER.into()),
        };
    }
    let Ok(doc) = text.parse::<toml_edit::DocumentMut>() else {
        return Entry::Other("its file isn't valid TOML".into());
    };
    let Some(entry) = doc.get("mcp_servers").and_then(|s| s.get(MCP_NAME)) else {
        return Entry::Absent;
    };
    let Some(table) = entry.as_table_like() else {
        return Entry::Other(SETTINGS_DIFFER.into());
    };
    // The approval mode is connect's own (through the engine's mcp_approvals), so a
    // server it already set up still counts as exactly its own.
    let keys: Vec<&str> = table
        .iter()
        .map(|(k, _)| k)
        .filter(|k| *k != "default_tools_approval_mode")
        .collect();
    if keys == ["url"] && table.get("url").and_then(|v| v.as_str()) == Some(mcp_url()) {
        Entry::Exact
    } else {
        Entry::Other(SETTINGS_DIFFER.into())
    }
}

/// The agent's CLI with exactly the configuration selection connect saw, run outside
/// any project so project settings play no part.
fn cli(agent: &Agent, args: &[&str]) -> Command {
    let mut cmd = Command::new(&agent.executable);
    cmd.args(args).stdin(Stdio::null());
    match &agent.env {
        Some((k, v)) => {
            cmd.env(k, v);
        }
        None => {
            cmd.env_remove("CLAUDE_CONFIG_DIR");
        }
    }
    if agent.root.is_dir() {
        cmd.current_dir(&agent.root);
    }
    cmd
}

/// Add the server through the agent's CLI. Codex starts its own browser sign-in right
/// after; its output is the person's to see, bounded so it can't hang connect.
fn add_server(agent: &Agent) -> Result<()> {
    if agent.harness == "claude" {
        let config = json!({"type": "http", "url": mcp_url()}).to_string();
        let out = cli(
            agent,
            &["mcp", "add-json", "--scope", "user", MCP_NAME, &config],
        )
        .output()
        .map_err(|e| e.to_string())?;
        return if out.status.success() {
            Ok(())
        } else {
            Err("claude refused to add the MCP server".into())
        };
    }
    let mut child = cli(agent, &["mcp", "add", MCP_NAME, "--url", mcp_url()])
        // Codex's own messages go to this command's stderr, never its stdout: a person
        // still sees them, and `--json` keeps exactly one object on stdout.
        .stdout(std::io::stderr())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| e.to_string())?;
    let deadline = Instant::now() + ADD_WAIT;
    loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            return if status.success() {
                Ok(())
            } else {
                Err("codex didn't finish adding the MCP server or signing in".into())
            };
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err("codex took too long to add the MCP server or sign in".into());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// The command a person runs to remove the server, with the exact configuration
/// selection connect used (Claude's default account: the variable unset).
fn remove_command(agent: &Agent) -> String {
    let env = match &agent.env {
        Some((k, v)) => format!("{k}={} ", quote(v)),
        None => "env -u CLAUDE_CONFIG_DIR ".into(),
    };
    if agent.harness == "claude" {
        format!("{env}claude mcp remove --scope user {MCP_NAME}")
    } else {
        format!("{env}codex mcp remove {MCP_NAME}")
    }
}

fn quote(path: &Path) -> String {
    format!("'{}'", path.display().to_string().replace('\'', r"'\''"))
}

/// Loop's hooks for one agent (Needs you's helper contract, 10 Nov).
/// Whether the Loop that owns `helper` (…/Contents/MacOS/loop-hook) is 0.1.1 or later,
/// read from its bundle's CFBundleShortVersionString. Unknown counts as no.
fn supports_context(helper: &Path) -> bool {
    let Some(plist) = helper
        .parent()
        .and_then(Path::parent)
        .map(|c| c.join("Info.plist"))
    else {
        return false;
    };
    Command::new("/usr/bin/plutil")
        .args(["-extract", "CFBundleShortVersionString", "raw", "-o", "-"])
        .arg(plist)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| semver::Version::parse(String::from_utf8_lossy(&o.stdout).trim()).ok())
        .is_some_and(|v| v >= semver::Version::new(0, 1, 1))
}

fn spec(agent: &Agent, helper: &Path) -> Spec {
    let harness = agent.harness;
    let command = |kind: &str| format!("{} {harness} {kind}", quote(helper));
    let hook = |event: &str, matcher: Option<&str>, kind: &str, timeout: u64, wake: bool| Hook {
        event: event.into(),
        matcher: matcher.map(Into::into),
        command: command(kind),
        timeout: Some(timeout),
        run_async: wake.then_some(true),
        async_rewake: wake.then_some(true),
    };
    let mut hooks = if harness == "claude" {
        vec![
            hook("SessionStart", None, "lifecycle", 86400, true),
            hook("Stop", None, "lifecycle", 86400, true),
            hook("StopFailure", None, "lifecycle", 86400, true),
            hook("PostToolUse", None, "register", 10, false),
            hook("PreToolUse", Some("AskUserQuestion"), "adoption", 2, false),
        ]
    } else {
        vec![
            hook("SessionStart", None, "lifecycle", 10, false),
            hook("PostToolUse", None, "register", 10, false),
        ]
    };
    // Tells a new session that Loop will wake it, so it stops polling for answers.
    // Synchronous: it prints at most one line within its own 400 ms probe and always
    // exits 0. Only Loop 0.1.1 and later have it; an older helper would fail every start.
    if supports_context(helper) {
        hooks.push(hook("SessionStart", None, "context", 5, false));
    }
    Spec {
        version: 1,
        owner: OWNER.into(),
        harness: harness.into(),
        root: agent.root.clone(),
        hooks,
        mcp_servers: vec![],
        // Codex asks before every tool call of a new server; Loop's questions should
        // reach the person without a prompt in the terminal first.
        mcp_approvals: if harness == "codex" {
            vec![McpApproval {
                server: MCP_NAME.into(),
                mode: "approve".into(),
            }]
        } else {
            vec![]
        },
        instruction: Some(INSTRUCTION.into()),
    }
}

/// Loop's support folder, made safe before anything else is written: each folder is the
/// person's own and never a symlink, and the folders are 0700.
fn support_dir(home: &Path) -> Result<PathBuf> {
    let parent = home.join(SUPPORT_PARENT);
    fs::create_dir_all(&parent).map_err(|e| e.to_string())?;
    let mut dir = parent;
    for part in SUPPORT {
        dir.push(part);
        match fs::symlink_metadata(&dir) {
            Ok(m) if m.file_type().is_symlink() || !m.is_dir() => {
                return Err(format!(
                    "{} isn't a plain folder; refusing to write there.",
                    dir.display()
                ));
            }
            Ok(_m) => {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::{MetadataExt, PermissionsExt};
                    // SAFETY: getuid has no preconditions.
                    if _m.uid() != unsafe { libc::getuid() } {
                        return Err(format!(
                            "{} belongs to another user; refusing to write there.",
                            dir.display()
                        ));
                    }
                    if _m.mode() & 0o777 != 0o700 {
                        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700))
                            .map_err(|e| e.to_string())?;
                    }
                }
            }
            Err(_) => {
                let mut builder = fs::DirBuilder::new();
                #[cfg(unix)]
                {
                    use std::os::unix::fs::DirBuilderExt;
                    builder.mode(0o700);
                }
                builder.create(&dir).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(dir)
}

/// One connect or disconnect at a time, across the engine, the agents' MCP entries and
/// the helper's records.
fn lock(support: &Path) -> Result<fs::File> {
    lock_at(&support.join(".connect.lock"))
}

/// One change to the agents' MCP servers at a time, with or without Loop: kept under
/// the engine's own folder (IMPECCABLE_HOME, else ~/.impeccable) so `--mcp-only` makes
/// no Loop folder on a machine without Loop.
fn mcp_lock(io: &Io) -> Result<fs::File> {
    let dir = impeccable_account::config::impeccable_home(&io.env)
        .ok_or("HOME is not set to an absolute path.")?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    lock_at(&dir.join(".mcp-connect.lock"))
}

fn lock_at(path: &Path) -> Result<fs::File> {
    let path = path.to_path_buf();
    if fs::symlink_metadata(&path).is_ok_and(|m| !m.is_file()) {
        return Err(format!(
            "{} isn't a plain file; refusing to write there.",
            path.display()
        ));
    }
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    let file = options.open(&path).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::fd::AsRawFd;
        let deadline = Instant::now() + LOCK_WAIT;
        // SAFETY: flock on a descriptor this function owns; released when the file drops.
        while unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
            if Instant::now() >= deadline {
                return Err(
                    "Another impeccable loop connect or disconnect is still running.".into(),
                );
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }
    Ok(file)
}

fn read_json(path: &Path) -> Option<Value> {
    if !fs::symlink_metadata(path).ok()?.is_file() {
        return None;
    }
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}

fn read_record(support: &Path, harness: &str) -> Option<Value> {
    read_json(&support.join(format!("{harness}-install.json")))
}

/// The record Loop's helper reads. Claude may be connected for several config folders:
/// `accounts` keeps all of them, `configDir` names the latest.
fn write_record(support: &Path, agent: &Agent, enabled: bool) -> Result<()> {
    let root = agent.root.display().to_string();
    let mut accounts: Vec<String> = read_record(support, agent.harness)
        .filter(|v| v["enabled"] == true)
        .and_then(|v| v["accounts"].as_array().cloned())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|a| a.as_str().map(str::to_owned))
        .collect();
    if !accounts.contains(&root) {
        accounts.push(root.clone());
    }
    let mut record = json!({
        "enabled": enabled,
        "harness": agent.harness,
        "executable": agent.executable.display().to_string(),
        "configDir": root,
    });
    if agent.harness == "claude" {
        record["accounts"] = json!(accounts);
    }
    publish(support, &format!("{}-install.json", agent.harness), &record)
}

/// Disconnect: this config folder no longer wakes. When none is left, the record says
/// so (`enabled: false`, `uninstalled: true`).
fn forget_account(support: &Path, harness: &str, root: &Path) -> Result<()> {
    let Some(mut record) = read_record(support, harness) else {
        return Ok(());
    };
    let root = root.display().to_string();
    let left: Vec<Value> = record["accounts"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|a| a.as_str() != Some(root.as_str()))
        .collect();
    if harness == "claude" && !left.is_empty() {
        record["accounts"] = json!(left);
        if record["configDir"] == root {
            record["configDir"] = left[0].clone();
        }
    } else {
        record["enabled"] = json!(false);
        record["uninstalled"] = json!(true);
        if harness == "claude" {
            record["accounts"] = json!([]);
        }
    }
    publish(support, &format!("{harness}-install.json"), &record)
}

/// Write a file whole: staged beside it (0600, created fresh) and renamed over it, so a
/// reader never sees half a file and a symlink at the name is replaced, not followed.
/// Put `harness`'s record back as it was before a connect began: its earlier bytes, or
/// no record at all.
fn restore_record(support: &Path, harness: &str, prior: Option<&[u8]>) -> Result<()> {
    let name = format!("{harness}-install.json");
    match prior {
        Some(bytes) => publish_bytes(support, &name, bytes),
        None => match fs::remove_file(support.join(&name)) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
            _ => Ok(()),
        },
    }
}

fn publish(support: &Path, name: &str, value: &Value) -> Result<()> {
    publish_bytes(support, name, format!("{value:#}\n").as_bytes())
}

fn publish_bytes(support: &Path, name: &str, bytes: &[u8]) -> Result<()> {
    let path = support.join(name);
    let staged = support.join(format!(".{name}.{}", std::process::id()));
    let _ = fs::remove_file(&staged);
    {
        use std::io::Write;
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&staged).map_err(|e| e.to_string())?;
        file.write_all(bytes).map_err(|e| e.to_string())?;
    }
    fs::rename(&staged, &path).map_err(|e| {
        let _ = fs::remove_file(&staged);
        e.to_string()
    })
}

/// What connect does about the taste block (`--taste`, `--no-taste`, or neither).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Taste {
    /// Neither flag: a person at a terminal is asked once; anything else skips it.
    Ask,
    /// Never ask (the JSON form): with no flag, nothing is added.
    Skip,
    Yes,
    No,
}

/// The person's answer for each rule file, in connect's note: `"on"` (added) or
/// `"off"` (declined). The rule file itself never carries it.
const TASTE_KEY: &str = "taste";
/// The rule files that were missing when a connect first wrote to them, in connect's
/// note. Once the taste block and the engine's block are both out, disconnect deletes
/// such a file if nothing is left in it; a file the person had, even empty, stays.
const TASTE_NEW_KEY: &str = "tasteCreated";

/// Before a connect writes to `file`: note it when it doesn't exist yet, returning
/// whether this call noted it. Called with the connect lock held. A failure only means
/// an emptied file stays later.
fn note_missing_rule_file(support: &Path, file: &Path) -> bool {
    if fs::symlink_metadata(file).is_ok() {
        return false;
    }
    let mut note = read_json(&support.join(TARGETS)).unwrap_or_else(|| json!({}));
    let key = json!(file.display().to_string());
    if !note[TASTE_NEW_KEY].is_array() {
        note[TASTE_NEW_KEY] = json!([]);
    }
    if note[TASTE_NEW_KEY].as_array().is_some_and(|a| a.contains(&key)) {
        return false;
    }
    note[TASTE_NEW_KEY].as_array_mut().unwrap().push(key);
    publish(support, TARGETS, &note).is_ok()
}

/// A connect that failed before writing `file`: it didn't create it after all.
fn forget_missing_rule_file(support: &Path, file: &Path) {
    let mut note = read_json(&support.join(TARGETS)).unwrap_or_else(|| json!({}));
    let key = json!(file.display().to_string());
    if let Some(list) = note[TASTE_NEW_KEY].as_array_mut() {
        list.retain(|v| *v != key);
        let _ = publish(support, TARGETS, &note);
    }
}

/// The agent's user-level rule file in this config folder, the one the engine's
/// instruction block lives in.
fn rule_file(harness: &str, root: &Path) -> PathBuf {
    root.join(if harness == "claude" { "CLAUDE.md" } else { "AGENTS.md" })
}

fn tilde(home: &Path, path: &Path) -> String {
    path.strip_prefix(home)
        .map_or_else(|_| path.display().to_string(), |rest| format!("~/{}", rest.display()))
}

/// The rule files of `agents` that are connected: an agent counts when the engine
/// holds a committed installation for its config folder.
fn taste_targets(io: &Io, home: &Path, agents: &[String]) -> Vec<PathBuf> {
    let installed = installed_specs(OWNER).map(|f| f.committed).unwrap_or_default();
    AGENTS
        .iter()
        .filter(|(h, _)| agents.iter().any(|a| a == h))
        .filter_map(|(h, _)| agent(io, home, h))
        .filter(|a| installed.iter().any(|s| s.harness == a.harness && s.root == a.root))
        .map(|a| rule_file(a.harness, &a.root))
        .collect()
}

fn row(file: &Path, result: &str) -> Value {
    json!({ "file": file.display().to_string(), "result": result })
}

/// After a connect: keep the taste block where the person said yes, and ask once (or
/// follow the flag) for the rule files never asked about. A block the person deleted by
/// hand is not put back unless they pass `--taste`; `--no-taste` takes it out. Returns
/// the report lines and one JSON row per rule file changed or asked about.
pub(crate) fn offer_taste(io: &mut Io, agents: &[String], choice: Taste) -> (String, Vec<Value>) {
    use std::io::IsTerminal;
    let (mut out, mut rows) = (String::new(), Vec::new());
    let Ok(home) = home(io) else { return (out, rows) };
    let Ok(support) = support_dir(&home) else { return (out, rows) };
    let targets = taste_targets(io, &home, agents);
    if targets.is_empty() {
        return (out, rows);
    }
    let note = read_json(&support.join(TARGETS)).unwrap_or_else(|| json!({}));
    let answered = |f: &Path| note[TASTE_KEY][f.display().to_string()].is_string();
    let (present, absent): (Vec<PathBuf>, Vec<PathBuf>) =
        targets.into_iter().partition(|f| loop_taste::present(f));
    // Asked about: files with no answer yet, and with --taste every file without the block.
    let ask: Vec<PathBuf> = absent
        .into_iter()
        .filter(|f| choice == Taste::Yes || !answered(f))
        .collect();
    let yes = match choice {
        _ if ask.is_empty() => None,
        Taste::Yes => Some(true),
        Taste::No => Some(false),
        Taste::Ask if io.stdin_is_tty && std::io::stdout().is_terminal() => {
            let files: Vec<String> = ask.iter().map(|f| tilde(&home, f)).collect();
            io.out(&format!(
                "Let your agents use your Impeccable taste? This adds 3 lines to {}. [Y/n] ",
                files.join(" and ")
            ));
            let _ = std::io::Write::flush(&mut io.stdout);
            let mut line = String::new();
            Some(
                std::io::stdin()
                    .read_line(&mut line)
                    .is_ok_and(|n| yes_answer(n, &line)),
            )
        }
        Taste::Ask | Taste::Skip => None,
    };
    // The answer was taken without the lock; the files and the note change under it.
    let _lock = match lock(&support) {
        Ok(l) => l,
        Err(e) => {
            if yes.is_some() || !present.is_empty() {
                out.push_str(&format!("Taste: nothing changed: {e}\n"));
            }
            return (out, rows);
        }
    };
    // A disconnect or another connect may have run while the person was answering, so
    // the files are looked at again now: only agents still connected are touched, a
    // block taken out meanwhile is not put back, and the answer covers only the files
    // it was asked about.
    let asked = ask;
    let mut note = read_json(&support.join(TARGETS)).unwrap_or_else(|| json!({}));
    let answered = |f: &Path| note[TASTE_KEY][f.display().to_string()].is_string();
    let (present, absent): (Vec<PathBuf>, Vec<PathBuf>) = taste_targets(io, &home, agents)
        .into_iter()
        .partition(|f| loop_taste::present(f));
    let ask: Vec<PathBuf> = absent
        .into_iter()
        .filter(|f| asked.contains(f) && (choice == Taste::Yes || !answered(f)))
        .collect();
    if !note[TASTE_KEY].is_object() {
        note[TASTE_KEY] = json!({});
    }
    let before = note[TASTE_KEY].clone();
    let mut record = |file: &Path, answer: &str| {
        note[TASTE_KEY][file.display().to_string()] = json!(answer);
    };
    for file in &present {
        let shown = tilde(&home, file);
        if choice == Taste::No {
            match loop_taste::take_out(file) {
                Ok(_) => {
                    record(file, "off");
                    out.push_str(&format!("Taste: removed from {shown}.\n"));
                    rows.push(row(file, "removed"));
                }
                Err(e) => {
                    out.push_str(&format!("Taste: left in {shown}: {e}\n"));
                    rows.push(json!({ "file": file.display().to_string(), "result": "failed", "error": e }));
                }
            }
            continue;
        }
        // Rewritten in place, so a block from an older wording is brought up to date.
        match loop_taste::add(file) {
            Ok(changed) => {
                record(file, "on");
                if changed {
                    rows.push(row(file, "updated"));
                }
            }
            Err(e) => {
                out.push_str(&format!("Taste: couldn't update {shown}: {e}\n"));
                rows.push(json!({ "file": file.display().to_string(), "result": "failed", "error": e }));
            }
        }
    }
    for file in &ask {
        let shown = tilde(&home, file);
        match yes {
            Some(true) => match loop_taste::add(file) {
                Ok(_) => {
                    record(file, "on");
                    out.push_str(&format!("Taste: added to {shown}.\n"));
                    if let Some(over) = file.parent().and_then(|root| root_override("codex", root)).filter(|_| file.ends_with("AGENTS.md")) {
                        out.push_str(&format!(
                            "  Codex reads {} instead; copy the taste lines there too.\n",
                            tilde(&home, &over)
                        ));
                    }
                    rows.push(row(file, "added"));
                }
                Err(e) => {
                    out.push_str(&format!("Taste: not added to {shown}: {e}\n"));
                    rows.push(json!({ "file": file.display().to_string(), "result": "failed", "error": e }));
                }
            },
            Some(false) => {
                record(file, "off");
                rows.push(row(file, "declined"));
            }
            None => rows.push(row(file, "skipped")),
        }
    }
    if yes.is_none() && !ask.is_empty() {
        out.push_str("To let your agents use your Impeccable taste: impeccable loop connect --taste\n");
    }
    if note[TASTE_KEY] != before {
        if let Err(e) = publish(&support, TARGETS, &note) {
            out.push_str(&format!("Taste: couldn't record your answer: {e}\n"));
            rows.push(json!({
                "file": support.join(TARGETS).display().to_string(),
                "result": "failed",
                "error": format!("couldn't record your answer: {e}"),
            }));
        }
    }
    (out, rows)
}

fn yes_answer(bytes_read: usize, line: &str) -> bool {
    bytes_read > 0 && matches!(line.trim().to_ascii_lowercase().as_str(), "" | "y" | "yes")
}

/// Disconnect: take the taste block out of every rule file connect put it in, and of
/// the rule files of the installations being removed, then forget the answers so a
/// later connect asks again. An answer whose file could not be changed is kept, so the
/// next disconnect tries that file again. Called with the connect lock held. Returns
/// whether all went well and the files connect created that the block came out of.
fn remove_taste(
    home: &Path,
    support: &Path,
    specs: &[&Spec],
    out: &mut String,
) -> (bool, Vec<PathBuf>) {
    let mut note = read_json(&support.join(TARGETS)).unwrap_or_else(|| json!({}));
    let answers = note[TASTE_KEY].as_object().cloned().unwrap_or_default();
    let mut files: Vec<PathBuf> = answers.keys().map(PathBuf::from).collect();
    for spec in specs {
        let file = rule_file(&spec.harness, &spec.root);
        if !files.contains(&file) {
            files.push(file);
        }
    }
    let new_files: Vec<Value> = note[TASTE_NEW_KEY].as_array().cloned().unwrap_or_default();
    let mut ok = true;
    let (mut created, mut kept, mut kept_new) = (Vec::new(), serde_json::Map::new(), Vec::new());
    for file in &files {
        let key = file.display().to_string();
        match loop_taste::take_out(file) {
            Ok(taken) => {
                if taken {
                    out.push_str(&format!("  Removed the taste lines from {}.\n", tilde(home, file)));
                }
                if taken && new_files.contains(&json!(key)) {
                    created.push(file.clone());
                }
            }
            Err(e) => {
                ok = false;
                out.push_str(&format!(
                    "  The taste lines in {} were left in place: {e}\n",
                    tilde(home, file)
                ));
                if let Some(answer) = answers.get(&key) {
                    kept.insert(key.clone(), answer.clone());
                }
                if new_files.contains(&json!(key)) {
                    kept_new.push(json!(key));
                }
            }
        }
    }
    if kept != answers || kept_new != new_files {
        note[TASTE_KEY] = Value::Object(kept);
        note[TASTE_NEW_KEY] = Value::Array(kept_new);
        if let Err(e) = publish(support, TARGETS, &note) {
            ok = false;
            out.push_str(&format!("  Couldn't forget the taste answers: {e}\n"));
        }
    }
    (ok, created)
}

fn sign_in(harness: &str) -> &'static str {
    if harness == "claude" {
        "in Claude Code, run /mcp, choose impeccable, then Authenticate."
    } else {
        "run codex mcp login impeccable (skip it if Codex just signed you in)."
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_failed_connect_puts_the_record_back_as_it_was() {
        // Catches (#1389 review): a failed first connect left `enabled: true`, so Loop
        // kept waking an agent that wasn't connected.
        let dir = std::env::temp_dir().join(format!("loop-record-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let record = dir.join("claude-install.json");
        let earlier = b"{\"enabled\":true,\"accounts\":[\"/a\"]}\n";
        fs::write(&record, earlier).unwrap();
        publish(
            &dir,
            "claude-install.json",
            &json!({"enabled": true, "accounts": ["/a", "/b"]}),
        )
        .unwrap();
        restore_record(&dir, "claude", Some(earlier)).unwrap();
        assert_eq!(fs::read(&record).unwrap(), earlier);
        restore_record(&dir, "claude", None).unwrap();
        assert!(!record.exists(), "no earlier record: none is left behind");
        restore_record(&dir, "claude", None).unwrap();
        let _ = fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod mcp_url_tests {
    use super::*;

    #[test]
    fn a_shipped_build_ignores_the_mcp_override() {
        // Catches: a variable redirecting a customer's agents to another MCP server.
        let mut env = std::collections::HashMap::new();
        env.insert("IMPECCABLE_MCP_URL".to_string(), "https://evil.example/mcp".to_string());
        let (io, _) = Io::captured("", std::env::temp_dir(), env);
        assert!(init_mcp_url(&io).is_ok());
        #[cfg(not(feature = "test-mcp-url"))]
        assert_eq!(mcp_url(), "https://api.impeccable.style/mcp");
        #[cfg(feature = "test-mcp-url")]
        assert_eq!(mcp_url(), "https://evil.example/mcp");
    }

    #[test]
    fn the_account_service_picks_its_own_mcp_server_and_nothing_else() {
        // Catches: IMPECCABLE_ACCOUNT_URL writing another server into an agent's global
        // config, or falling back to production for a run aimed elsewhere.
        assert_eq!(mcp_for_account(None), Ok("https://api.impeccable.style/mcp"));
        assert_eq!(mcp_for_account(Some(" ")), Ok("https://api.impeccable.style/mcp"));
        assert_eq!(mcp_for_account(Some("https://api.impeccable.style/")), Ok("https://api.impeccable.style/mcp"));
        assert_eq!(mcp_for_account(Some("https://API.staging.impeccable.style")), Ok("https://api.staging.impeccable.style/mcp"));
        for other in ["https://evil.example", "https://api.impeccable.style.evil.test", "http://127.0.0.1:8787", "https://impeccable.style", "not a url"] {
            assert!(mcp_for_account(Some(other)).is_err(), "{other}");
        }
    }

    #[test]
    fn each_call_takes_its_own_account_server() {
        // Catches (#1464 review): the first call's server sticking for the process, so a
        // later production call in it writes staging (or the reverse).
        let io_for = |account: Option<&str>| {
            let mut env = std::collections::HashMap::new();
            if let Some(a) = account {
                env.insert("IMPECCABLE_ACCOUNT_URL".to_string(), a.to_string());
            }
            Io::captured("", std::env::temp_dir(), env).0
        };
        assert!(init_mcp_url(&io_for(Some("https://api.staging.impeccable.style"))).is_ok());
        #[cfg(not(feature = "test-mcp-url"))]
        assert_eq!(mcp_url(), STAGING_MCP_URL);
        assert!(init_mcp_url(&io_for(None)).is_ok());
        #[cfg(not(feature = "test-mcp-url"))]
        assert_eq!(mcp_url(), MCP_URL);
        // A refused account leaves no earlier server behind.
        assert!(init_mcp_url(&io_for(Some("https://api.staging.impeccable.style"))).is_ok());
        assert!(init_mcp_url(&io_for(Some("https://evil.example"))).is_err());
        #[cfg(not(feature = "test-mcp-url"))]
        assert_eq!(mcp_url(), MCP_URL);
    }

    #[test]
    fn a_test_build_refuses_an_unusable_override_instead_of_using_production() {
        // Catches (#1403 review): an empty, http:// or padded IMPECCABLE_MCP_URL silently
        // registering production in a staging run.
        for bad in ["", "http://staging.example/mcp", " https://staging.example/mcp", "https://staging.example/mcp "] {
            let mut env = std::collections::HashMap::new();
            env.insert("IMPECCABLE_MCP_URL".to_string(), bad.to_string());
            let (io, _) = Io::captured("", std::env::temp_dir(), env);
            #[cfg(feature = "test-mcp-url")]
            assert!(init_mcp_url(&io).is_err(), "{bad:?}");
            #[cfg(not(feature = "test-mcp-url"))]
            assert!(init_mcp_url(&io).is_ok(), "{bad:?}");
        }
        // A local stack's http server on this machine is usable in a test build.
        for good in ["http://127.0.0.1:8787/mcp", "http://localhost:8787/mcp", "https://staging.example/mcp"] {
            let mut env = std::collections::HashMap::new();
            env.insert("IMPECCABLE_MCP_URL".to_string(), good.to_string());
            let (io, _) = Io::captured("", std::env::temp_dir(), env);
            assert!(init_mcp_url(&io).is_ok(), "{good:?}");
        }
        #[cfg(feature = "test-mcp-url")]
        for bad in ["http://127.0.0.1.evil.test/mcp", "http://192.168.1.2/mcp"] {
            let mut env = std::collections::HashMap::new();
            env.insert("IMPECCABLE_MCP_URL".to_string(), bad.to_string());
            let (io, _) = Io::captured("", std::env::temp_dir(), env);
            assert!(init_mcp_url(&io).is_err(), "{bad:?}");
        }
    }
}
