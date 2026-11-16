//! A session's presence record (REN-2124): written at `initialize`, named by the session, gone when it ends.
#![cfg(unix)]
use impeccable_mcp::{presence, serve_session, Failure, Upstream};
use serde_json::{json, Value};
use std::io::Write as _;
use std::os::unix::net::UnixStream;
use std::time::Duration;

struct Remote;
impl Upstream for Remote {
    fn call(&mut self, r: &Value) -> Result<Value, Failure> {
        Ok(json!({ "jsonrpc": "2.0", "id": r["id"], "result": {} }))
    }
    fn sign_in(&mut self) -> Result<(), String> {
        Ok(())
    }
}

/// The agents `impeccable agents running` lists now, by name, with whether each is connected.
fn listed(home: &std::path::Path) -> Vec<(String, bool)> {
    presence::agents(Some(&home.join("running")), presence::snapshot)
        .into_iter()
        .filter(|a| a["connected"] == true)
        .map(|a| (a["name"].as_str().unwrap().to_string(), a["harness"] == "codex-mcp-client"))
        .collect()
}

fn until(mut done: impl FnMut() -> bool) -> bool {
    (0..200).any(|_| done() || { std::thread::sleep(Duration::from_millis(10)); false })
}

// Catches a session missing from Loop's list while it runs, listed under the harness after naming itself, or still
// listed after it ended.
#[test]
fn a_session_is_listed_while_it_runs_by_the_name_it_gives_itself() {
    let home = std::env::temp_dir().join(format!("impeccable-presence-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&home);
    let env: std::collections::HashMap<String, String> = [("IMPECCABLE_HOME".to_string(), home.display().to_string())].into();
    let (mut agent, server_in) = UnixStream::pair().unwrap();
    let (e, cwd) = (env.clone(), std::env::temp_dir());
    let server = std::thread::spawn(move || {
        serve_session(std::io::BufReader::new(server_in), &mut Vec::new(), &mut Vec::new(), &mut Remote, None, Some((&e, &cwd)));
    });
    let send = |agent: &mut UnixStream, v: Value| writeln!(agent, "{v}").unwrap();
    send(&mut agent, json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "clientInfo": { "name": "codex-mcp-client" } } }));
    assert!(until(|| listed(&home).len() == 1), "never listed");
    assert!(listed(&home)[0].1, "harness");

    send(&mut agent, json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": { "name": "needs_you.list", "arguments": { "from": "review bot" } } }));
    assert!(until(|| listed(&home).first().is_some_and(|(n, _)| n == "review bot")), "{:?}", listed(&home));
    // Its first name stays: a later call naming another session doesn't rename it, and control characters never land.
    send(&mut agent, json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": { "name": "needs_you.list", "arguments": { "from": "tab 2" } } }));
    send(&mut agent, json!({ "jsonrpc": "2.0", "id": 4, "method": "ping" }));
    std::thread::sleep(Duration::from_millis(100));
    assert_eq!(listed(&home)[0].0, "review bot");

    drop(agent);
    server.join().unwrap();
    assert!(listed(&home).is_empty());
    let _ = std::fs::remove_dir_all(&home);
}
