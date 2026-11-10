//! `impeccable loop connect` and `loop disconnect`: connect a person's coding agents to
//! Needs you and Loop.
//!
//! For each agent found (Claude Code, Codex), connect:
//! 1. adds the Impeccable MCP server, only if the agent has no server of that name, through
//!    the agent's own CLI, then checks the exact global entry it wrote;
//! 2. adds Loop's hooks through the agents engine (journaled, undone exactly);
//! 3. writes the record Loop's helper reads.
//!
//! Disconnect stops Loop waking first, removes the hooks, and removes the MCP server only
//! when connect added it and the entry is still exactly as written; otherwise it prints the
//! command to remove it. Agent tokens are never seen or stored here: each agent signs in to
//! the MCP server itself.
use impeccable_agents::{installed_specs, recover_spec, run_spec, Hook, Spec};
use impeccable_common::Io;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// The Impeccable MCP server. A constant of the build: never taken from a flag, the
/// environment or a server response.
const MCP_URL: &str = "https://api.impeccable.style/mcp";
const MCP_NAME: &str = "impeccable";
/// The agents-engine owner id for everything this writes.
const OWNER: &str = "impeccable-loop";
const APP: &str = "Applications/Impeccable Loop.app";
const HELPER: &str = "Contents/MacOS/loop-hook";
/// Where Loop's helper keeps its state (the old name stays until Loop migrates it).
const SUPPORT_PARENT: &str = "Library/Application Support";
const SUPPORT: [&str; 2] = ["Impeccable Reviews", "Loop"];
/// This command's own state: which MCP entries it added, per agent and config folder.
const STATE: &str = "connect.json";
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
    /// Variables the agent's CLI needs to find that file, passed explicitly.
    env: Vec<(&'static str, PathBuf)>,
}

/// `loop connect`.
pub(crate) fn connect(io: &Io) -> Result<String> {
    let home = home(io)?;
    let helper = home.join(APP).join(HELPER);
    if !helper.is_file() {
        return Err(
            "Impeccable Loop isn't installed, or is too old to connect agents. Run impeccable loop install first."
                .into(),
        );
    }
    // Checked before any agent's configuration changes.
    let support = support_dir(&home)?;
    let _lock = lock(&support)?;
    let mut out = String::new();
    let (mut connected, mut failed) = (0, 0);
    for (harness, label) in AGENTS {
        let Some(agent) = agent(io, &home, harness) else {
            out.push_str(&format!("{label}: not found, skipped.\n"));
            continue;
        };
        match connect_one(&agent, &helper, &support) {
            Ok(manual) => {
                connected += 1;
                out.push_str(&format!(
                    "{label}: connected.\n  Sign in: {}\n",
                    sign_in(harness)
                ));
                if !manual.is_empty() {
                    out.push_str(&format!("  Then in {label}: {}.\n", manual.join("; ")));
                }
            }
            Err(e) => {
                failed += 1;
                out.push_str(&format!("{label}: not connected: {e}\n"));
            }
        }
    }
    if connected == 0 && failed == 0 {
        return Err(format!(
            "{out}No coding agent found to connect (Claude Code or Codex)."
        ));
    }
    if connected > 0 {
        out.push_str("To check it works, ask your agent to post a test question to Needs you.\n");
    }
    if failed > 0 {
        return Err(out.trim_end().to_string());
    }
    Ok(out)
}

/// One agent. Each step that fails undoes the earlier ones of this run, so a failed
/// connect leaves the agent as it found it.
fn connect_one(agent: &Agent, helper: &Path, support: &Path) -> Result<Vec<String>> {
    if agent.harness == "codex" {
        if let Some(other) = read_record(support, "codex")
            .filter(|r| r["enabled"] == true)
            .and_then(|r| r["configDir"].as_str().map(PathBuf::from))
            .filter(|dir| *dir != agent.root)
        {
            return Err(format!(
                "Codex is already connected for {}; run impeccable loop disconnect first",
                other.display()
            ));
        }
    }
    // 1. The MCP server: added only when the agent has none of that name.
    let added = match read_entry(agent)? {
        Entry::Exact => false,
        Entry::Other(why) => {
            return Err(format!(
                "{} already has an MCP server called {MCP_NAME} ({why}); it was left alone",
                agent.mcp_file.display()
            ))
        }
        Entry::Absent => {
            let ran = add_server(agent);
            // Codex writes the entry, then signs in; a sign-in left unfinished still leaves
            // the exact entry, which is ours and kept (the person signs in later).
            match read_entry(agent)? {
                Entry::Exact => true,
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
    };
    let undo_mcp = |why: String| -> String {
        if added && remove_server(agent).is_err() {
            format!(
                "{why}; also remove the MCP server it added: {}",
                remove_command(agent)
            )
        } else {
            why
        }
    };
    // 2. Loop's hooks, through the engine.
    let spec = spec(agent, helper);
    if let Err((_, msg)) = run_spec("apply", &spec) {
        let _ = recover_spec(&spec);
        return Err(undo_mcp(msg));
    }
    let rollback = |why: String| -> String {
        let _ = run_spec("undo", &spec);
        undo_mcp(why)
    };
    // 3. The record Loop's helper reads, and this command's own note of what it added.
    if let Err(e) = write_record(support, agent, true) {
        return Err(rollback(e));
    }
    let previously = state_added(support, agent);
    if let Err(e) = set_state(support, agent, added || previously) {
        return Err(rollback(e));
    }
    let status = run_spec("status", &spec).map_err(|(_, m)| m)?;
    let resources = status["resources"].as_array().cloned().unwrap_or_default();
    if status["installed"] != true
        || resources.is_empty()
        || resources.iter().any(|r| r["state"] == "conflict")
    {
        return Err(
            "its hooks aren't in place after installing; run impeccable loop connect again".into(),
        );
    }
    Ok(status["manualActions"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default())
}

/// `loop disconnect`: every installation connect made (from the engine's journals, not
/// today's environment), each on its own.
pub(crate) fn disconnect(io: &Io) -> Result<String> {
    let home = home(io)?;
    let support = support_dir(&home)?;
    let _lock = lock(&support)?;
    let (specs, pending) = installed_specs(OWNER).map_err(|(_, m)| m)?;
    let mut out = String::new();
    let mut failed = false;
    // Waking stops for every installation before anything else is touched.
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
        let mut line = match run_spec("undo", spec) {
            Ok(result) => match result["conflicts"].as_array().map_or(0, Vec::len) {
                0 => format!("{label}: disconnected"),
                kept => {
                    format!("{label}: disconnected; {kept} hooks you changed were left in place")
                }
            },
            Err((_, msg)) => {
                failed = true;
                format!("{label}: hooks not removed: {msg}")
            }
        };
        let (said, complete) = disconnect_server(io, &home, &support, spec);
        failed |= !complete;
        line.push_str(&said);
        out.push_str(&line);
        out.push_str(".\n");
    }
    if pending > 0 {
        failed = true;
        out.push_str("An earlier connect stopped part way; run impeccable agents recover, then impeccable loop disconnect again.\n");
    }
    if out.is_empty() {
        out.push_str("Nothing to disconnect.\n");
    }
    if failed {
        return Err(out.trim_end().to_string());
    }
    Ok(out)
}

/// The MCP half of disconnect for one installation: removed only when connect added it
/// and the entry is still exactly as written, through a validated CLI; otherwise the
/// command to remove it is printed. Returns what to add to its line, and whether the
/// MCP half is done (a server left because it changed is done: that is by design).
fn disconnect_server(io: &Io, home: &Path, support: &Path, spec: &Spec) -> (String, bool) {
    let Some(agent) = agent_for(io, home, support, &spec.harness, &spec.root) else {
        let added = read_json(&support.join(STATE)).is_some_and(|v| {
            v["added"][format!("{}:{}", spec.harness, spec.root.display())] == true
        });
        return if added {
            (format!(
                "; its CLI wasn't found, so the {MCP_NAME} MCP server connect added is still there: reinstall it and run impeccable loop disconnect again"
            ), false)
        } else {
            (String::new(), true)
        };
    };
    if !state_added(support, &agent) {
        return (String::new(), true);
    }
    let result = match read_entry(&agent) {
        Ok(Entry::Absent) => Ok(()),
        Ok(Entry::Exact) => remove_server(&agent).and_then(|_| match read_entry(&agent)? {
            Entry::Absent => Ok(()),
            _ => Err("it is still there".into()),
        }),
        Ok(Entry::Other(_)) => {
            let _ = set_state(support, &agent, false);
            return (format!(
                "; its {MCP_NAME} MCP server changed since connect, so it was left in place (remove it with: {})",
                remove_command(&agent)
            ), true);
        }
        Err(e) => Err(e),
    };
    match result {
        Ok(()) => {
            let _ = set_state(support, &agent, false);
            (String::new(), true)
        }
        Err(e) => (
            format!(
                "; its {MCP_NAME} MCP server wasn't removed ({e}): {}",
                remove_command(&agent)
            ),
            false,
        ),
    }
}

fn home(io: &Io) -> Result<PathBuf> {
    io.env("HOME")
        .filter(|h| !h.is_empty() && Path::new(h).is_absolute())
        .map(PathBuf::from)
        .ok_or_else(|| "HOME is not set to an absolute path.".into())
}

/// The agent as connect would configure it today, if its CLI is found.
fn agent(io: &Io, home: &Path, harness: &'static str) -> Option<Agent> {
    let executable = resolve(io, harness)?;
    let var = |name: &str| {
        io.env(name)
            .filter(|v| !v.is_empty() && Path::new(v).is_absolute())
            .map(PathBuf::from)
    };
    Some(if harness == "claude" {
        let custom = var("CLAUDE_CONFIG_DIR");
        let root = custom.clone().unwrap_or_else(|| home.join(".claude"));
        // Claude keeps user-scope MCP servers in .claude.json: in CLAUDE_CONFIG_DIR when
        // that is set, else in HOME.
        let mcp_file = custom
            .as_ref()
            .map_or_else(|| home.join(".claude.json"), |dir| dir.join(".claude.json"));
        let env = custom
            .map(|d| vec![("CLAUDE_CONFIG_DIR", d)])
            .unwrap_or_default();
        Agent {
            harness,
            executable,
            root,
            mcp_file,
            env,
        }
    } else {
        let root = var("CODEX_HOME").unwrap_or_else(|| home.join(".codex"));
        Agent {
            harness,
            executable,
            mcp_file: root.join("config.toml"),
            env: vec![("CODEX_HOME", root.clone())],
            root,
        }
    })
}

/// The agent for a recorded installation (its config folder from the journal), with a
/// validated CLI: today's, else the one connect recorded. Never an unvalidated lookup.
fn agent_for(io: &Io, home: &Path, support: &Path, harness: &str, root: &Path) -> Option<Agent> {
    let harness: &'static str = if harness == "claude" {
        "claude"
    } else {
        "codex"
    };
    let mut agent = agent(io, home, harness).or_else(|| {
        let executable = recorded_executable(support, harness)?;
        let mut a = agent_with(home, harness, root, executable);
        a.root = root.to_path_buf();
        Some(a)
    })?;
    if agent.root != root {
        agent = agent_with(home, harness, root, agent.executable);
    }
    Some(agent)
}

/// An agent for an explicit config folder (a recorded installation).
fn agent_with(home: &Path, harness: &'static str, root: &Path, executable: PathBuf) -> Agent {
    if harness == "claude" {
        let default = home.join(".claude");
        let custom = (root != default).then(|| root.to_path_buf());
        Agent {
            harness,
            executable,
            root: root.to_path_buf(),
            mcp_file: custom
                .as_ref()
                .map_or_else(|| home.join(".claude.json"), |d| d.join(".claude.json")),
            env: custom
                .map(|d| vec![("CLAUDE_CONFIG_DIR", d)])
                .unwrap_or_default(),
        }
    } else {
        Agent {
            harness,
            executable,
            root: root.to_path_buf(),
            mcp_file: root.join("config.toml"),
            env: vec![("CODEX_HOME", root.to_path_buf())],
        }
    }
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
    io.env("PATH")?
        .split(':')
        .map(Path::new)
        .filter(|d| d.is_absolute())
        .map(|d| d.join(harness))
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
fn read_entry(agent: &Agent) -> Result<Entry> {
    let bytes = match fs::read(&agent.mcp_file) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Entry::Absent),
        Err(e) => return Ok(Entry::Other(e.to_string())),
    };
    let text = String::from_utf8_lossy(&bytes);
    if agent.harness == "claude" {
        let Ok(v) = serde_json::from_str::<Value>(&text) else {
            return Ok(Entry::Other("its file isn't valid JSON".into()));
        };
        return Ok(match v.get("mcpServers").and_then(|s| s.get(MCP_NAME)) {
            None => Entry::Absent,
            Some(e) if *e == json!({"type": "http", "url": MCP_URL}) => Entry::Exact,
            Some(_) => Entry::Other("its settings differ".into()),
        });
    }
    let Ok(doc) = text.parse::<toml_edit::DocumentMut>() else {
        return Ok(Entry::Other("its file isn't valid TOML".into()));
    };
    let Some(servers) = doc.get("mcp_servers") else {
        return Ok(Entry::Absent);
    };
    let Some(entry) = servers.get(MCP_NAME) else {
        return Ok(Entry::Absent);
    };
    let Some(table) = entry.as_table_like() else {
        return Ok(Entry::Other("its settings differ".into()));
    };
    let keys: Vec<&str> = table.iter().map(|(k, _)| k).collect();
    Ok(
        if keys == ["url"] && table.get("url").and_then(|v| v.as_str()) == Some(MCP_URL) {
            Entry::Exact
        } else {
            Entry::Other("its settings differ".into())
        },
    )
}

fn cli(agent: &Agent, args: &[&str]) -> Command {
    let mut cmd = Command::new(&agent.executable);
    cmd.args(args).stdin(Stdio::null());
    for (k, v) in &agent.env {
        cmd.env(k, v);
    }
    // Outside any project, so project settings play no part.
    if agent.root.is_dir() {
        cmd.current_dir(&agent.root);
    }
    cmd
}

/// Add the server through the agent's CLI. Codex starts its own browser sign-in right
/// after; its output is the person's to see, bounded so it can't hang connect.
fn add_server(agent: &Agent) -> Result<()> {
    if agent.harness == "claude" {
        let config = json!({"type": "http", "url": MCP_URL}).to_string();
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
    let mut child = cli(agent, &["mcp", "add", MCP_NAME, "--url", MCP_URL])
        .stdout(Stdio::inherit())
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

fn remove_server(agent: &Agent) -> Result<()> {
    let args: &[&str] = if agent.harness == "claude" {
        &["mcp", "remove", "--scope", "user", MCP_NAME]
    } else {
        &["mcp", "remove", MCP_NAME]
    };
    let out = cli(agent, args).output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(format!("{} refused to remove it", agent.harness))
    }
}

fn remove_command(agent: &Agent) -> String {
    let env: String = agent
        .env
        .iter()
        .map(|(k, v)| format!("{k}={} ", quote(v)))
        .collect();
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
    let hooks = if harness == "claude" {
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
    Spec {
        version: 1,
        owner: OWNER.into(),
        harness: harness.into(),
        root: agent.root.clone(),
        hooks,
        mcp_servers: vec![],
        mcp_approvals: vec![],
        instruction: None,
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
    let path = support.join(".connect.lock");
    if fs::symlink_metadata(&path).is_ok_and(|m| !m.is_file()) {
        return Err(format!("{} isn't a plain file.", path.display()));
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

fn recorded_executable(support: &Path, harness: &str) -> Option<PathBuf> {
    let p = PathBuf::from(read_record(support, harness)?["executable"].as_str()?);
    runnable(&p).then_some(p)
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

fn state_key(agent: &Agent) -> String {
    format!("{}:{}", agent.harness, agent.root.display())
}

/// Whether connect added this agent's MCP server (so disconnect may remove it).
fn state_added(support: &Path, agent: &Agent) -> bool {
    read_json(&support.join(STATE)).is_some_and(|v| v["added"][state_key(agent)] == true)
}

fn set_state(support: &Path, agent: &Agent, added: bool) -> Result<()> {
    let mut state = read_json(&support.join(STATE)).unwrap_or_else(|| json!({"added": {}}));
    if !state["added"].is_object() {
        state["added"] = json!({});
    }
    let key = state_key(agent);
    if added {
        state["added"][&key] = json!(true);
    } else if let Some(map) = state["added"].as_object_mut() {
        map.remove(&key);
    }
    publish(support, STATE, &state)
}

/// Write a file whole: staged beside it (0600, created fresh) and renamed over it, so a
/// reader never sees half a file and a symlink at the name is replaced, not followed.
fn publish(support: &Path, name: &str, value: &Value) -> Result<()> {
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
        file.write_all(format!("{value:#}\n").as_bytes())
            .map_err(|e| e.to_string())?;
    }
    fs::rename(&staged, &path).map_err(|e| {
        let _ = fs::remove_file(&staged);
        e.to_string()
    })
}

fn sign_in(harness: &str) -> &'static str {
    if harness == "claude" {
        "in Claude Code, run /mcp, choose impeccable, then Authenticate."
    } else {
        "run codex mcp login impeccable (skip it if Codex just signed you in)."
    }
}
