//! Codex runs a hook from a person's `hooks.json` only once it is trusted: its
//! `hooks.state."<key>".trusted_hash` in CODEX_HOME/config.toml must equal the hook's
//! current hash (REN-2057). Connect trusts the hooks it wrote, and only those, the way
//! Codex's own hook review does: Codex's app server names each hook's key and hash
//! (`hooks/list`) and writes the trust (`config/batchWrite`). Disconnect takes it back.
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{channel, Receiver};
use std::time::{Duration, Instant};

const WAIT: Duration = Duration::from_secs(15);

/// A hook connect wrote, as the engine wrote it: its command and timeout.
pub(crate) type Written = (String, Option<u64>);

/// Trusts each hook in `home/hooks.json` that connect wrote (`written`), then checks
/// that Codex reads every one of them as trusted.
pub(crate) fn trust(exe: &Path, home: &Path, written: &[Written]) -> Result<(), String> {
    let mut server = Server::start(exe, home)?;
    let hooks = server.ours(home, written)?;
    if hooks.is_empty() {
        return Err("Codex doesn't list Impeccable's hooks".into());
    }
    let edits: Vec<Value> = hooks
        .iter()
        .filter(|h| h["trustStatus"] != "trusted")
        .filter_map(|h| {
            Some(json!({
                "keyPath": key_path(h["key"].as_str()?)? + ".trusted_hash",
                "value": h["currentHash"].as_str()?,
                "mergeStrategy": "upsert",
            }))
        })
        .collect();
    if !edits.is_empty() {
        server.call(
            "config/batchWrite",
            json!({ "edits": edits, "reloadUserConfig": true }),
        )?;
    }
    if server
        .ours(home, written)?
        .iter()
        .any(|h| h["trustStatus"] != "trusted")
    {
        return Err("Codex still reads Impeccable's hooks as untrusted".into());
    }
    Ok(())
}

/// Takes back the trust `trust` wrote, while the hooks are still in `hooks.json`.
pub(crate) fn untrust(exe: &Path, home: &Path, written: &[Written]) -> Result<(), String> {
    let mut server = Server::start(exe, home)?;
    let edits: Vec<Value> = server
        .ours(home, written)?
        .iter()
        .filter(|h| h["trustStatus"] != "untrusted")
        .filter_map(|h| {
            Some(json!({ "keyPath": key_path(h["key"].as_str()?)?, "value": null, "mergeStrategy": "replace" }))
        })
        .collect();
    if !edits.is_empty() {
        server.call("config/batchWrite", json!({ "edits": edits }))?;
    }
    Ok(())
}

/// `hooks.state."<key>"`; None for a key TOML's basic string would need escapes for.
fn key_path(key: &str) -> Option<String> {
    (!key.contains(['"', '\\']) && !key.chars().any(char::is_control))
        .then(|| format!("hooks.state.\"{key}\""))
}

/// The key suffixes (`:<event>:<group>:<hook>`) of the entries in `hooks.json` whose
/// command and timeout are one of `written`: the positions Codex names its hooks by.
fn suffixes(hooks_json: &Path, written: &[Written]) -> Vec<String> {
    let Some(doc) = std::fs::read(hooks_json)
        .ok()
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
    else {
        return vec![];
    };
    let mut out = vec![];
    for (event, groups) in doc["hooks"].as_object().into_iter().flatten() {
        for (g, group) in groups.as_array().into_iter().flatten().enumerate() {
            for (h, hook) in group["hooks"].as_array().into_iter().flatten().enumerate() {
                let entry = (hook["command"].as_str(), hook["timeout"].as_u64());
                if written.iter().any(|(c, t)| entry == (Some(c.as_str()), *t)) {
                    out.push(format!(":{}:{g}:{h}", snake(event)));
                }
            }
        }
    }
    out
}

/// `PostToolUse` -> `post_tool_use`, as Codex spells events in hook keys.
fn snake(event: &str) -> String {
    let mut out = String::new();
    for (i, c) in event.chars().enumerate() {
        if c.is_ascii_uppercase() && i > 0 {
            out.push('_');
        }
        out.push(c.to_ascii_lowercase());
    }
    out
}

/// One `codex app-server` over stdio, bounded so it can never hang connect.
struct Server {
    child: Child,
    stdin: ChildStdin,
    lines: Receiver<String>,
    next: u64,
    deadline: Instant,
}

impl Server {
    fn start(exe: &Path, home: &Path) -> Result<Server, String> {
        let mut child = Command::new(exe)
            .arg("app-server")
            .env("CODEX_HOME", home)
            .current_dir(home)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("couldn't start codex app-server: {e}"))?;
        let stdin = child.stdin.take().ok_or("codex app-server has no stdin")?;
        let stdout = child
            .stdout
            .take()
            .ok_or("codex app-server has no stdout")?;
        let (tx, lines) = channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if tx.send(line).is_err() {
                    break;
                }
            }
        });
        let mut server = Server {
            child,
            stdin,
            lines,
            next: 0,
            deadline: Instant::now() + WAIT,
        };
        server.call(
            "initialize",
            json!({ "clientInfo": { "name": "impeccable", "version": env!("CARGO_PKG_VERSION") } }),
        )?;
        server.send(&json!({ "jsonrpc": "2.0", "method": "initialized" }))?;
        Ok(server)
    }

    fn send(&mut self, msg: &Value) -> Result<(), String> {
        writeln!(self.stdin, "{msg}").map_err(|_| "codex app-server stopped".to_string())
    }

    fn call(&mut self, method: &str, params: Value) -> Result<Value, String> {
        self.next += 1;
        let id = self.next;
        self.send(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))?;
        loop {
            let left = self.deadline.saturating_duration_since(Instant::now());
            let line = self
                .lines
                .recv_timeout(left)
                .map_err(|_| format!("codex app-server didn't answer {method}"))?;
            let Ok(msg) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if msg["id"] != id {
                continue;
            }
            if let Some(e) = msg.get("error") {
                return Err(format!(
                    "codex app-server refused {method}: {}",
                    e["message"].as_str().unwrap_or("unknown error")
                ));
            }
            return Ok(msg["result"].clone());
        }
    }

    /// Codex's own listing of the hooks connect wrote, matched by file and position.
    fn ours(&mut self, home: &Path, written: &[Written]) -> Result<Vec<Value>, String> {
        let file = home.join("hooks.json");
        let suffixes = suffixes(&file, written);
        let file = file.canonicalize().unwrap_or(file);
        let listed = self.call("hooks/list", json!({ "cwds": [home] }))?;
        Ok(listed["data"][0]["hooks"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|h| {
                let source = h["sourcePath"].as_str().map(Path::new);
                source.is_some_and(|s| s.canonicalize().is_ok_and(|s| s == file))
                    && h["key"]
                        .as_str()
                        .is_some_and(|k| suffixes.iter().any(|s| k.ends_with(s.as_str())))
            })
            .cloned()
            .collect())
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_hook_is_named_by_its_event_group_and_place_among_the_persons_own() {
        let dir = std::env::temp_dir().join(format!("codex-trust-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("hooks.json");
        let cmd = |c: &str| json!({ "type": "command", "command": c, "timeout": 10 });
        std::fs::write(
            &file,
            json!({ "hooks": {
                "SessionStart": [{ "hooks": [cmd("mine"), cmd("loop start")] }, { "hooks": [{ "type": "command", "command": "loop start", "timeout": 30 }] }],
                "PostToolUse": [{ "matcher": "Bash", "hooks": [cmd("mine")] }, { "hooks": [cmd("loop register")] }],
            } })
            .to_string(),
        )
        .unwrap();
        let mut got = suffixes(
            &file,
            &[
                ("loop start".into(), Some(10)),
                ("loop register".into(), Some(10)),
            ],
        );
        got.sort();
        assert_eq!(got, [":post_tool_use:1:0", ":session_start:0:1"]);
        assert_eq!(
            key_path("/h/hooks.json:stop:0:0").unwrap(),
            "hooks.state.\"/h/hooks.json:stop:0:0\""
        );
        assert!(key_path("/h/\"x\"/hooks.json:stop:0:0").is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
