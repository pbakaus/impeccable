#[path = "../../account/tests/support/fake.rs"]
mod fake;
use fake::{browser, Fake};
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Command, Stdio};

fn impeccable(env: &HashMap<String, String>, args: &[&str]) -> Command {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_impeccable"));
    cmd.args(args)
        .current_dir(&env["IMPECCABLE_HOME"])
        .env_clear()
        .envs(env)
        .stdin(Stdio::null());
    for key in ["PATH", "SystemRoot", "TEMP", "TMP"] {
        if let Ok(v) = std::env::var(key) {
            cmd.env(key, v);
        }
    }
    cmd
}

fn steps(out: &std::process::Output) -> (i32, HashMap<String, String>) {
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap_or_else(|e| panic!("{e}: {} / {}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)));
    let steps = v["steps"].as_array().unwrap().iter()
        .map(|s| (s["step"].as_str().unwrap().to_string(), s["result"].as_str().unwrap().to_string()))
        .collect();
    (out.status.code().unwrap(), steps)
}

// Catches start opening a second sign-in over a working one, going on past a sign-in that never finished
// (exit 3, nothing after it), and a machine without an agent reading as set up (exit 2).
#[test]
fn start_stops_at_an_unfinished_sign_in_and_skips_a_finished_one() {
    let fake = Fake::start();
    let mut env = fake.env("start");
    // No agent CLI on this PATH: the MCP step finds none.
    env.insert("PATH".into(), String::new());
    env.insert("IMPECCABLE_NO_BROWSER".into(), "1".into());
    env.insert("IMPECCABLE_LOGIN_TIMEOUT".into(), "1".into());
    let out = impeccable(&env, &["start", "--json"]).output().unwrap();
    let (code, s) = steps(&out);
    assert_eq!((code, s.get("sign_in").map(String::as_str), s.contains_key("mcp")), (3, Some("failed"), false));

    let mut child = impeccable(&env, &["login", "--no-browser"])
        .env("IMPECCABLE_LOGIN_TIMEOUT", "30")
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut url = String::new();
    BufReader::new(child.stdout.take().unwrap()).read_line(&mut url).unwrap();
    browser(url.trim());
    assert!(child.wait().unwrap().success());
    let out = impeccable(&env, &["start", "--json"]).output().unwrap();
    let (code, s) = steps(&out);
    assert_eq!((code, s["sign_in"].as_str(), s["mcp"].as_str()), (2, "already", "no_agents"));
    assert!(Path::new(&env["IMPECCABLE_HOME"]).exists());
}
