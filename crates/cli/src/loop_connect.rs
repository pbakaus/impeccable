//! `impeccable loop connect` and `loop disconnect`: connect a person's coding agents to
//! Needs you and Loop. For each agent found (Claude Code, Codex) it adds the Impeccable MCP
//! server and Loop's hooks through the agents engine (journaled, undone exactly), and writes
//! the small record Loop's helper reads. It never sees or stores an agent's tokens: each
//! agent signs in to the MCP server itself, and this prints the one step it needs.
use impeccable_agents::{run_spec, Hook, McpServer, Spec};
use impeccable_common::Io;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

/// The Impeccable MCP server. A constant of the build: never taken from a flag, the
/// environment or a server response.
const MCP_URL: &str = "https://api.impeccable.style/mcp";
const MCP_NAME: &str = "impeccable";
/// The agents-engine owner id for everything this writes.
const OWNER: &str = "impeccable-loop";
const APP: &str = "Applications/Impeccable Loop.app";
const HELPER: &str = "Contents/MacOS/loop-hook";
/// Where Loop's helper keeps its state (the old name stays until Loop migrates it).
const SUPPORT: &str = "Library/Application Support/Impeccable Reviews/Loop";

type Result<T> = std::result::Result<T, String>;

struct Agent {
    harness: &'static str,
    /// The agent's absolute CLI path, which Loop uses to resume its sessions.
    executable: PathBuf,
    /// Claude: the folder holding settings.json; Codex: CODEX_HOME.
    config_dir: PathBuf,
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
    let mut out = String::new();
    let mut connected = 0;
    for (harness, label) in [("claude", "Claude Code"), ("codex", "Codex")] {
        let Some(agent) = find(io, &home, harness) else {
            out.push_str(&format!("{label}: not found, skipped.\n"));
            continue;
        };
        run_spec("apply", &spec(&agent, &helper)).map_err(|(_, m)| format!("{label}: {m}"))?;
        write_record(&home, &agent, true)?;
        let status =
            run_spec("status", &spec(&agent, &helper)).map_err(|(_, m)| format!("{label}: {m}"))?;
        let clean = status["resources"]
            .as_array()
            .is_some_and(|r| r.iter().all(|x| x["state"] != "conflict"));
        out.push_str(&format!(
            "{label}: connected{}.\n  Sign in: {}\n",
            if clean {
                ""
            } else {
                ", with entries changed since (check its settings)"
            },
            sign_in(harness)
        ));
        if let Some(steps) = status["manualActions"].as_array().filter(|a| !a.is_empty()) {
            let steps: Vec<&str> = steps.iter().filter_map(Value::as_str).collect();
            out.push_str(&format!("  Then in Codex: {}.\n", steps.join("; ")));
        }
        connected += 1;
    }
    if connected == 0 {
        return Err(format!(
            "{out}No coding agent found to connect (Claude Code or Codex)."
        ));
    }
    out.push_str("To check it works, ask your agent to post a test question to Needs you.\n");
    Ok(out)
}

/// `loop disconnect`: Loop stops waking first, then exactly what connect wrote is removed.
pub(crate) fn disconnect(io: &Io) -> Result<String> {
    let home = home(io)?;
    let helper = home.join(APP).join(HELPER);
    let mut out = String::new();
    for (harness, label) in [("claude", "Claude Code"), ("codex", "Codex")] {
        let record = home.join(SUPPORT).join(format!("{harness}-install.json"));
        let Some(agent) = find(io, &home, harness).or_else(|| recorded(&record, harness)) else {
            continue;
        };
        if record.exists() {
            write_record(&home, &agent, false)?;
        }
        let result =
            run_spec("undo", &spec(&agent, &helper)).map_err(|(_, m)| format!("{label}: {m}"))?;
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
    if out.is_empty() {
        out.push_str("Nothing to disconnect.\n");
    }
    Ok(out)
}

fn home(io: &Io) -> Result<PathBuf> {
    io.env("HOME")
        .filter(|h| !h.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| "HOME is not set.".into())
}

/// The agent's config folder, and its CLI on PATH. An agent without its CLI can't take
/// the MCP server (it is added through the agent's own CLI), so it is skipped.
fn find(io: &Io, home: &Path, harness: &'static str) -> Option<Agent> {
    let config_dir = match harness {
        "claude" => io
            .env("CLAUDE_CONFIG_DIR")
            .filter(|v| !v.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".claude")),
        _ => io
            .env("CODEX_HOME")
            .filter(|v| !v.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".codex")),
    };
    let executable = io
        .env("PATH")?
        .split(':')
        .filter(|d| Path::new(d).is_absolute())
        .map(|d| Path::new(d).join(harness))
        .find(|p| p.is_file())?;
    Some(Agent {
        harness,
        executable,
        config_dir,
    })
}

/// An agent whose CLI is gone but whose record remains, so disconnect still undoes it.
fn recorded(record: &Path, harness: &'static str) -> Option<Agent> {
    let v: Value = serde_json::from_slice(&fs::read(record).ok()?).ok()?;
    Some(Agent {
        harness,
        executable: PathBuf::from(v["executable"].as_str()?),
        config_dir: PathBuf::from(v["configDir"].as_str()?),
    })
}

fn quote(path: &Path) -> String {
    format!("'{}'", path.display().to_string().replace('\'', r"'\''"))
}

/// What connect installs for one agent: the MCP server and Loop's hooks (Needs you's
/// helper contract, 10 Nov).
fn spec(agent: &Agent, helper: &Path) -> Spec {
    let command = |kind: &str| format!("{} {} {kind}", quote(helper), agent.harness);
    let hook = |event: &str, matcher: Option<&str>, kind: &str, timeout: u64, wake: bool| Hook {
        event: event.into(),
        matcher: matcher.map(Into::into),
        command: command(kind),
        timeout: Some(timeout),
        run_async: wake.then_some(true),
        async_rewake: wake.then_some(true),
    };
    let hooks = if agent.harness == "claude" {
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
        harness: agent.harness.into(),
        root: agent.config_dir.clone(),
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

/// The record Loop's helper reads: `<support>/<harness>-install.json`, folder 0700, file 0600.
fn write_record(home: &Path, agent: &Agent, enabled: bool) -> Result<()> {
    let dir = home.join(SUPPORT);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    }
    let mut record = json!({
        "enabled": enabled,
        "harness": agent.harness,
        "executable": agent.executable.display().to_string(),
        "configDir": agent.config_dir.display().to_string(),
    });
    if agent.harness == "claude" {
        record["accounts"] = json!([agent.config_dir.display().to_string()]);
    }
    if !enabled {
        record["uninstalled"] = json!(true);
    }
    let path = dir.join(format!("{}-install.json", agent.harness));
    let staged = dir.join(format!(
        ".{}-install.json.{}",
        agent.harness,
        std::process::id()
    ));
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
        "run codex mcp login impeccable."
    }
}
