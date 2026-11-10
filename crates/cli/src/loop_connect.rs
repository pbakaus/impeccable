//! `impeccable loop connect` and `loop disconnect`: connect a person's coding agents to
//! Needs you and Loop. For each agent found (Claude Code, Codex) it adds the Impeccable MCP
//! server and Loop's hooks through the agents engine (journaled, undone exactly), and writes
//! the small record Loop's helper reads. It never sees or stores an agent's tokens: each
//! agent signs in to the MCP server itself, and this prints the one step it needs.
use impeccable_agents::{installed_specs, recover_spec, run_spec, Hook, McpServer, Spec};
use impeccable_common::Io;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
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
/// How long one connect or disconnect waits for another to finish.
const LOCK_WAIT: Duration = Duration::from_secs(10);

type Result<T> = std::result::Result<T, String>;

const AGENTS: [(&str, &str); 2] = [("claude", "Claude Code"), ("codex", "Codex")];

fn label(harness: &str) -> &'static str {
    AGENTS
        .iter()
        .find(|(h, _)| *h == harness)
        .map_or("Agent", |(_, l)| l)
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
        let Some(executable) = resolve(io, harness) else {
            out.push_str(&format!("{label}: not found, skipped.\n"));
            continue;
        };
        let spec = spec(harness, config_dir(io, &home, harness), &helper);
        match connect_one(&spec, &executable, &support) {
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

/// One agent: the engine install, then the helper's record, then a check that what was
/// written is in place. A failed install is rolled back before this returns.
fn connect_one(spec: &Spec, executable: &Path, support: &Path) -> Result<Vec<String>> {
    use_executable(&spec.harness, executable);
    if let Err((_, msg)) = run_spec("apply", spec) {
        // An apply that stopped part way (a CLI that wrote, then failed) leaves a pending
        // transaction: roll it back so a retry or disconnect starts clean.
        let _ = recover_spec(spec);
        return Err(msg);
    }
    write_record(support, &spec.harness, executable, &spec.root, true)?;
    let status = run_spec("status", spec).map_err(|(_, m)| m)?;
    let resources = status["resources"].as_array().cloned().unwrap_or_default();
    if status["installed"] != true || resources.is_empty() {
        return Err(
            "its configuration isn't in place after installing; run impeccable loop connect again"
                .into(),
        );
    }
    if resources.iter().any(|r| r["state"] == "conflict") {
        return Err(
            "an entry was changed while connecting; run impeccable loop connect again".into(),
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
/// today's environment), each on its own: Loop stops waking first, then exactly what
/// connect wrote is removed.
pub(crate) fn disconnect(io: &Io) -> Result<String> {
    let home = home(io)?;
    let support = support_dir(&home)?;
    let _lock = lock(&support)?;
    let (specs, pending) = installed_specs(OWNER).map_err(|(_, m)| m)?;
    // Waking stops for every installation before anything else is touched.
    for spec in &specs {
        let _ = forget_account(&support, &spec.harness, &spec.root);
    }
    let mut out = String::new();
    let mut failed = false;
    for spec in &specs {
        let label = label(&spec.harness);
        let executable =
            resolve(io, &spec.harness).or_else(|| recorded_executable(&support, &spec.harness));
        if let Some(executable) = &executable {
            use_executable(&spec.harness, executable);
        }
        match run_spec("undo", spec) {
            Ok(result) => {
                let kept = result["conflicts"].as_array().map_or(0, Vec::len);
                out.push_str(&format!(
                    "{label}: disconnected{}.\n",
                    if kept == 0 {
                        String::new()
                    } else {
                        format!("; {kept} entries you changed were left in place")
                    }
                ));
            }
            Err((_, msg)) => {
                failed = true;
                let hint = if executable.is_none() {
                    format!(" (its CLI wasn't found; reinstall {label} and run impeccable loop disconnect again, or remove the impeccable MCP server by hand)")
                } else {
                    String::new()
                };
                out.push_str(&format!("{label}: not fully disconnected: {msg}{hint}\n"));
            }
        }
    }
    if pending > 0 {
        out.push_str("An earlier connect stopped part way; run impeccable agents recover, or connect and disconnect again.\n");
    }
    if out.is_empty() {
        out.push_str("Nothing to disconnect.\n");
    }
    if failed {
        return Err(out.trim_end().to_string());
    }
    Ok(out)
}

fn home(io: &Io) -> Result<PathBuf> {
    io.env("HOME")
        .filter(|h| !h.is_empty() && Path::new(h).is_absolute())
        .map(PathBuf::from)
        .ok_or_else(|| "HOME is not set to an absolute path.".into())
}

fn config_dir(io: &Io, home: &Path, harness: &str) -> PathBuf {
    let (var, default) = if harness == "claude" {
        ("CLAUDE_CONFIG_DIR", ".claude")
    } else {
        ("CODEX_HOME", ".codex")
    };
    io.env(var)
        .filter(|v| !v.is_empty() && Path::new(v).is_absolute())
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(default))
}

fn override_var(harness: &str) -> &'static str {
    if harness == "claude" {
        "IMPECCABLE_CLAUDE_BIN"
    } else {
        "IMPECCABLE_CODEX_BIN"
    }
}

/// The agent's CLI, resolved once: the engine's override variable, else the first
/// executable regular file named for it in an absolute PATH entry (relative entries such
/// as `.` are skipped). The same path is recorded for Loop and used for every call.
fn resolve(io: &Io, harness: &str) -> Option<PathBuf> {
    let executable = |p: &Path| {
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
    };
    if let Some(over) = io.env(override_var(harness)).filter(|v| !v.is_empty()) {
        let p = PathBuf::from(over);
        return executable(&p).then_some(p);
    }
    io.env("PATH")?
        .split(':')
        .map(Path::new)
        .filter(|d| d.is_absolute())
        .map(|d| d.join(harness))
        .find(|p| executable(p))
}

/// The engine runs the agent's CLI from its override variable: make that the one resolved.
fn use_executable(harness: &str, executable: &Path) {
    std::env::set_var(override_var(harness), executable);
}

fn quote(path: &Path) -> String {
    format!("'{}'", path.display().to_string().replace('\'', r"'\''"))
}

/// What connect installs for one agent: the MCP server and Loop's hooks (Needs you's
/// helper contract, 10 Nov).
fn spec(harness: &str, root: PathBuf, helper: &Path) -> Spec {
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
        root,
        hooks,
        mcp_servers: vec![McpServer {
            name: MCP_NAME.into(),
            command: String::new(),
            args: vec![],
            env: Default::default(),
            url: Some(MCP_URL.into()),
        }],
        mcp_approvals: vec![],
        instruction: None,
    }
}

/// Loop's support folder, made safe before anything else is written: each folder this
/// uses is the person's own and never a symlink, and only folders it creates get 0700.
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
                    use std::os::unix::fs::MetadataExt;
                    // SAFETY: getuid has no preconditions.
                    if _m.uid() != unsafe { libc::getuid() } {
                        return Err(format!(
                            "{} belongs to another user; refusing to write there.",
                            dir.display()
                        ));
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

/// One connect or disconnect at a time, across the engine and the helper's records.
fn lock(support: &Path) -> Result<fs::File> {
    let file = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(false)
        .open(support.join(".connect.lock"))
        .map_err(|e| e.to_string())?;
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
    #[cfg(not(unix))]
    let _ = Instant::now();
    Ok(file)
}

fn record_path(support: &Path, harness: &str) -> PathBuf {
    support.join(format!("{harness}-install.json"))
}

fn read_record(support: &Path, harness: &str) -> Option<Value> {
    let path = record_path(support, harness);
    if !fs::symlink_metadata(&path).ok()?.is_file() {
        return None;
    }
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}

fn recorded_executable(support: &Path, harness: &str) -> Option<PathBuf> {
    let v = read_record(support, harness)?;
    let p = PathBuf::from(v["executable"].as_str()?);
    (p.is_absolute() && p.is_file()).then_some(p)
}

/// The record Loop's helper reads. Claude may be connected for several config folders:
/// `accounts` keeps all of them, `configDir` names the latest.
fn write_record(
    support: &Path,
    harness: &str,
    executable: &Path,
    root: &Path,
    enabled: bool,
) -> Result<()> {
    let root = root.display().to_string();
    let mut accounts: Vec<String> = read_record(support, harness)
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
        "harness": harness,
        "executable": executable.display().to_string(),
        "configDir": root,
    });
    if harness == "claude" {
        record["accounts"] = json!(accounts);
    }
    publish(support, harness, &record)
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
    publish(support, harness, &record)
}

/// Write a record whole: staged beside it (0600, created fresh) and renamed over it, so
/// the helper never reads half a file and a symlink at the name is replaced, not followed.
fn publish(support: &Path, harness: &str, record: &Value) -> Result<()> {
    let path = record_path(support, harness);
    let staged = support.join(format!(".{harness}-install.json.{}", std::process::id()));
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
        file.write_all(format!("{record:#}\n").as_bytes())
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
