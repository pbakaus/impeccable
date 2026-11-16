//! Which agents are connected right now (REN-2124). Each agent session runs one `impeccable mcp`, which lives exactly
//! as long as the session: at `initialize` it writes a record under `<IMPECCABLE_HOME>/running/`, and it removes it
//! when it ends. A record whose process is gone, or whose pid now belongs to a process started at another time, is a
//! session that crashed; the reader drops it. Nothing expires on a timer and nothing leaves the machine: Loop reads
//! `impeccable agents running --json` and forwards its own summary.
//!
//! Agents without the MCP entry are found by a process scan and listed as seen, not connected.
use impeccable_common::Io;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};

/// The harness executables the scan recognizes, by the base name of the program or of the script node runs.
const HARNESSES: &[(&str, &str)] = &[
    ("claude", "claude-code"),
    ("codex", "codex"),
    ("pi", "pi"),
    ("cursor-agent", "cursor"),
    ("antigravity", "antigravity"),
    ("gemini", "gemini-cli"),
    ("opencode", "opencode"),
];
/// Programs between a harness and its MCP server (`npx impeccable mcp`, a shell): skipped to find the harness.
const LAUNCHERS: &[&str] = &["node", "npm", "npx", "sh", "bash", "zsh", "dash", "impeccable", "env", "bun", "bunx"];

/// One running process: its parent, its start time (as `ps` gives it, so a reused pid differs) and its arguments.
#[derive(Clone, Debug, PartialEq)]
pub struct Proc {
    pub pid: u32,
    pub ppid: u32,
    pub start: String,
    pub args: Vec<String>,
}

/// Every process on the machine, from one `ps`. Empty where there is none (Windows: no presence there yet).
pub fn snapshot() -> HashMap<u32, Proc> {
    let out = std::process::Command::new("ps")
        .args(["-A", "-o", "pid=,ppid=,lstart=,args="])
        .env("LC_ALL", "C")
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output();
    match out {
        Ok(o) if o.status.success() => parse_ps(&String::from_utf8_lossy(&o.stdout)),
        _ => HashMap::new(),
    }
}

/// `ps -o pid=,ppid=,lstart=,args=` lines: two numbers, a five-word start time (`Mon Nov 16 21:50:00 2026`), then
/// the arguments.
pub fn parse_ps(text: &str) -> HashMap<u32, Proc> {
    let mut out = HashMap::new();
    for line in text.lines() {
        let mut words = line.split_whitespace();
        let (Some(pid), Some(ppid)) = (words.next().and_then(|w| w.parse().ok()), words.next().and_then(|w| w.parse().ok())) else {
            continue;
        };
        let start: Vec<&str> = words.by_ref().take(5).collect();
        if start.len() != 5 {
            continue;
        }
        out.insert(pid, Proc { pid, ppid, start: start.join(" "), args: words.map(str::to_string).collect() });
    }
    out
}

fn base(arg: &str) -> &str {
    arg.rsplit(['/', '\\']).next().unwrap_or(arg)
}

/// The harness a process is, from its program or (for `node <script>`) its script.
fn harness_of(p: &Proc) -> Option<&'static str> {
    let program = base(p.args.first()?);
    let named = |n: &str| HARNESSES.iter().find(|(exe, _)| *exe == n).map(|(_, h)| *h);
    named(program).or_else(|| if program == "node" { named(base(p.args.get(1)?)) } else { None })
}

/// The first ancestor of `pid` that isn't a launcher: the harness that started this MCP server.
pub fn harness_process(procs: &HashMap<u32, Proc>, pid: u32) -> Option<&Proc> {
    let mut at = procs.get(&procs.get(&pid)?.ppid)?;
    for _ in 0..8 {
        if harness_of(at).is_some() || !LAUNCHERS.contains(&base(at.args.first()?)) {
            return Some(at);
        }
        at = procs.get(&at.ppid)?;
    }
    None
}

/// The session's name as the harness was started with it (Claude Code's `--name` / `-n`).
/// `ps` gives the arguments split at spaces, so a quoted name reads as the words up to the next option.
fn session_name(p: &Proc) -> Option<String> {
    let at = p.args.iter().position(|a| a == "--name" || a == "-n")?;
    let words: Vec<&str> = p.args[at + 1..].iter().map(String::as_str).take_while(|w| !w.starts_with('-')).collect();
    clean(&words.join(" "))
}

/// A name as it may be saved and shown: no control characters (a newline or an escape would reach Loop and the
/// terminal), at most 40 characters, never blank.
fn clean(name: &str) -> Option<String> {
    let name: String = name.chars().filter(|c| !c.is_control()).take(40).collect();
    (!name.trim().is_empty()).then_some(name)
}

pub fn dir(env: &HashMap<String, String>) -> Option<PathBuf> {
    // Not `agents/`: that holds the agents engine's install journals.
    Some(impeccable_account::config::impeccable_home(env)?.join("running"))
}

/// This session's record, written at `initialize` and again when the session first names itself. It is removed when
/// the returned guard drops (the process ending); a crash leaves it for the reader to drop.
pub struct Presence {
    file: PathBuf,
    record: Value,
}

impl Presence {
    pub fn start(env: &HashMap<String, String>, harness: &str, cwd: &Path) -> Option<Presence> {
        let procs = snapshot();
        let me = procs.get(&std::process::id())?;
        let parent = harness_process(&procs, me.pid);
        let repo = impeccable_account::health::repo_key(&cwd.display().to_string(), env);
        let record = json!({
            "v": 1,
            "pid": me.pid,
            "start": me.start,
            "parent": parent.map(|p| json!({ "pid": p.pid, "start": p.start })),
            "harness": harness,
            "session": parent.and_then(session_name),
            "from": null,
            "cwd": cwd.display().to_string(),
            "repo": repo.map(|(key, label)| json!({ "key": key, "label": label })),
            "since": now(),
        });
        let dir = dir(env)?;
        let presence = Presence { file: dir.join(format!("{}.json", me.pid)), record };
        presence.save(&dir).then_some(presence)
    }

    /// The session's own name: the first a Needs-you call gives, which outranks every other and is kept.
    pub fn named(&mut self, from: &str) {
        let Some(from) = clean(from) else { return };
        if !self.record["from"].is_null() {
            return;
        }
        self.record["from"] = json!(from);
        if let Some(dir) = self.file.parent().map(Path::to_path_buf) {
            self.save(&dir);
        }
    }

    fn save(&self, dir: &Path) -> bool {
        #[cfg(unix)]
        {
            use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
            if std::fs::DirBuilder::new().recursive(true).mode(0o700).create(dir).is_err() {
                return false;
            }
            let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
        }
        let staged = self.file.with_extension("json.new");
        let written = std::fs::write(&staged, self.record.to_string()).is_ok();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&staged, std::fs::Permissions::from_mode(0o600));
        }
        written && std::fs::rename(&staged, &self.file).is_ok()
    }
}

impl Drop for Presence {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.file);
    }
}

fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// The name Loop shows: the session's own (`from`), else the harness's session name, else the repository and harness.
fn display_name(r: &Value) -> String {
    let text = |k: &str| r[k].as_str().and_then(clean);
    let harness = r["harness"].as_str().unwrap_or("agent");
    text("from").or_else(|| text("session")).unwrap_or_else(|| match r["repo"]["label"].as_str() {
        Some(label) => format!("{label} · {harness}"),
        None => harness.to_string(),
    })
}

/// Every agent: each live record as connected, then each harness process with none as seen, not connected. Dead
/// records are removed. The records are read before `procs` takes its snapshot, so a session that starts in between
/// is in the snapshot and its record is never taken for a dead one.
pub fn agents(dir: Option<&Path>, procs: impl FnOnce() -> HashMap<u32, Proc>) -> Vec<Value> {
    let mut out = Vec::new();
    let mut entries: Vec<PathBuf> = dir
        .and_then(|d| std::fs::read_dir(d).ok())
        .map(|it| it.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "json")).collect())
        .unwrap_or_default();
    entries.sort();
    let records: Vec<(PathBuf, Value)> = entries
        .into_iter()
        .filter_map(|path| std::fs::read(&path).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()).map(|r| (path, r)))
        .collect();
    let procs = procs();
    // No process list (ps failed): nothing can be told dead, so nothing is removed or listed.
    if procs.is_empty() {
        return out;
    }
    let mut parents = Vec::new();
    for (path, r) in records {
        let pid = r["pid"].as_u64().unwrap_or(0) as u32;
        let alive = procs.get(&pid).is_some_and(|p| Some(p.start.as_str()) == r["start"].as_str());
        if !alive {
            let _ = std::fs::remove_file(&path);
            continue;
        }
        if let Some(p) = r["parent"]["pid"].as_u64() {
            parents.push(p as u32);
        }
        out.push(json!({
            "key": format!("{pid}@{}", r["start"].as_str().unwrap_or("")),
            "name": display_name(&r),
            "harness": r["harness"],
            "repo": r["repo"],
            "cwd": r["cwd"],
            "pid": pid,
            "parent": r["parent"],
            "since": r["since"],
            "connected": true,
        }));
    }
    let mut seen: Vec<&Proc> = procs.values().filter(|p| harness_of(p).is_some() && !parents.contains(&p.pid)).collect();
    // A harness's own helpers (a child of the same harness) are one agent, not two.
    seen.retain(|p| procs.get(&p.ppid).map_or(true, |parent| harness_of(parent).is_none()));
    seen.sort_by_key(|p| p.pid);
    for p in seen {
        let harness = harness_of(p).unwrap_or("agent");
        out.push(json!({
            "key": format!("{}@{}", p.pid, p.start),
            "name": session_name(p).unwrap_or_else(|| harness.to_string()),
            "harness": harness,
            "repo": null,
            "cwd": null,
            "pid": p.pid,
            "parent": { "pid": p.pid, "start": p.start },
            "since": null,
            "connected": false,
        }));
    }
    out
}

/// `impeccable agents running [--json]`.
pub fn run(args: &[String], io: &mut Io) -> i32 {
    if args.iter().any(|a| a != "--json") {
        let _ = writeln!(io.stderr, "Usage: impeccable agents running [--json]");
        return 2;
    }
    let list = agents(dir(&io.env).as_deref(), snapshot);
    if args.iter().any(|a| a == "--json") {
        let _ = writeln!(io.stdout, "{}", Value::Array(list));
        return 0;
    }
    if list.is_empty() {
        let _ = writeln!(io.stdout, "No agents running.");
    }
    for a in &list {
        let state = if a["connected"] == true { "connected" } else { "seen, not connected" };
        let _ = writeln!(io.stdout, "{}  ({}, {state})", a["name"].as_str().unwrap_or(""), a["harness"].as_str().unwrap_or(""));
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    const PS: &str = "  100     1 Mon Nov 16 09:00:00 2026     /Applications/Claude.app/claude --name t1jp review --resume
  200   100 Mon Nov 16 09:00:05 2026     node /usr/lib/node_modules/npm/bin/npx-cli.js impeccable mcp
  201   200 Mon Nov 16 09:00:06 2026     /home/u/.npm/_npx/x/impeccable mcp
  300     1 Mon Nov 16 10:00:00 2026     /usr/local/bin/codex
  301   300 Mon Nov 16 10:00:01 2026     /usr/local/bin/codex app-server
  400     1 Mon Nov 16 11:00:00 2026     /bin/zsh
";

    #[test]
    fn finds_the_harness_through_its_launchers_and_reads_its_session_name() {
        let procs = parse_ps(PS);
        assert_eq!(procs[&100].start, "Mon Nov 16 09:00:00 2026");
        let harness = harness_process(&procs, 201).unwrap();
        // A quoted name with a space comes back whole, up to the next option.
        assert_eq!((harness.pid, session_name(harness).as_deref()), (100, Some("t1jp review")));
    }

    // Catches a crashed session listed as connected, a pid reused by another process read as the old session, and an
    // agent without the MCP entry missing from the list (or listed twice through its own helper process).
    #[test]
    fn lists_live_sessions_drops_dead_ones_and_scans_the_rest() {
        let dir = std::env::temp_dir().join(format!("impeccable-agents-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let procs = parse_ps(PS);
        let record = |pid: u32, start: &str, from: Value| json!({ "v": 1, "pid": pid, "start": start,
            "parent": { "pid": 100, "start": "Mon Nov 16 09:00:00 2026" }, "harness": "claude-code", "session": "t1jp",
            "from": from, "cwd": "/w", "repo": { "key": "k", "label": "web" }, "since": 1 });
        // A failed ps can tell nothing dead: no record goes.
        std::fs::write(dir.join("999.json"), record(999, "x", Value::Null).to_string()).unwrap();
        assert!(agents(Some(&dir), HashMap::new).is_empty());
        assert!(dir.join("999.json").exists());
        std::fs::write(dir.join("201.json"), record(201, "Mon Nov 16 09:00:06 2026", Value::Null).to_string()).unwrap();
        std::fs::write(dir.join("999.json"), record(999, "Mon Nov 16 08:00:00 2026", Value::Null).to_string()).unwrap();
        std::fs::write(dir.join("400.json"), record(400, "Sun Nov 15 08:00:00 2026", Value::Null).to_string()).unwrap();

        let list = agents(Some(&dir), || procs.clone());
        let shown: Vec<(String, bool)> = list.iter().map(|a| (a["name"].as_str().unwrap().to_string(), a["connected"] == true)).collect();
        assert_eq!(shown, [("t1jp".to_string(), true), ("codex".to_string(), false)]);
        assert!(!dir.join("999.json").exists() && !dir.join("400.json").exists() && dir.join("201.json").exists());

        // Its own name outranks the harness's; with neither, the repository and harness.
        let mut named = record(201, "x", json!("review bot"));
        assert_eq!(display_name(&named), "review bot");
        named["from"] = Value::Null;
        named["session"] = Value::Null;
        assert_eq!(display_name(&named), "web · claude-code");
        // A newline or an escape never reaches Loop or the terminal.
        named["from"] = json!("review\nbot\u{1b}[2J");
        assert_eq!(display_name(&named), "reviewbot[2J");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
