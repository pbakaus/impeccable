//! `impeccable journeys` as a person or an agent drives it, against the fake
//! account service: what it sends, the one JSON object it prints, and its
//! exit codes.
#[path = "../../account/tests/support/fake.rs"]
mod fake;
use fake::{browser, Fake};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Command, Output, Stdio};

const START: &str = "/cli/v1/journeys";
const ONE: &str = "/cli/v1/journeys/j1";

fn impeccable(env: &HashMap<String, String>, args: &[&str]) -> Command {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_impeccable"));
    cmd.args(args).env_clear().envs(env).stdin(Stdio::null());
    for key in ["PATH", "SystemRoot", "TEMP", "TMP"] {
        if let Ok(v) = std::env::var(key) {
            cmd.env(key, v);
        }
    }
    // A test never opens the developer's browser.
    cmd.env("IMPECCABLE_NO_BROWSER", "1");
    cmd.current_dir(&env["HOME"]);
    cmd
}

/// A service with journeys on, and a machine signed in to it.
fn signed_in(name: &str) -> (Fake, HashMap<String, String>) {
    let fake = Fake::start();
    fake.knobs.lock().unwrap().journeys = true;
    let env = fake.env(name);
    let mut child = impeccable(&env, &["login", "--no-browser"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut url = String::new();
    BufReader::new(child.stdout.take().unwrap())
        .read_line(&mut url)
        .unwrap();
    browser(url.trim());
    assert!(child.wait().unwrap().success());
    (fake, env)
}

fn answer(fake: &Fake, method: &str, path: &str, status: u16, body: Value) {
    fake.route(method, path, status, vec![], body.to_string());
}

fn started(fake: &Fake) {
    let page = format!("{}/app/acme/journeys/j1", fake.url);
    answer(fake, "POST", START, 200, json!({ "id": "j1", "state": "queued", "device": "mobile", "page": page }));
}

fn status(state: &str, outcome: Value) -> Value {
    json!({
        "id": "j1", "state": state, "device": "mobile", "error": null, "outcome": outcome,
        "steps": [{ "n": 1, "did": "Opened /todos", "said": "", "issue": "The Add button does nothing" }],
    })
}

fn stdout_json(out: &Output) -> Value {
    serde_json::from_slice(&out.stdout)
        .unwrap_or_else(|_| panic!("stdout is not one JSON object: {}", String::from_utf8_lossy(&out.stdout)))
}

#[test]
fn a_journey_is_started_followed_to_its_end_and_reported() {
    // Catches: the start request losing what was asked (who, where, which browser), the sign-in asking for no journeys scope, or the result not reaching stdout as one object.
    let (fake, env) = signed_in("journeys-run");
    assert!(fake.record.lock().unwrap().scopes[0].contains("journeys:start"));
    started(&fake);
    let outcome = json!({
        "finished": true, "steps": 1, "ms": 48000, "replayUrl": null,
        "doneWhen": [{ "text": "A todo is listed", "met": true }],
        "issues": [{ "step": 1, "page": "/todos", "what": "The Add button does nothing" }],
    });
    answer(&fake, "GET", ONE, 200, status("done", outcome));
    let out = impeccable(&env, &["journeys", "add a todo", "--url", "http://localhost:5173/todos", "--repo", "acme/storefront", "--as", "dana", "--new", "--device", "phone", "--json"])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(0), "{}", String::from_utf8_lossy(&out.stderr));
    let sent = fake.record.lock().unwrap().bodies.clone();
    assert_eq!(
        sent,
        [(START.to_string(), json!({
            "repo": "acme/storefront", "app": "main", "goal": "add a todo", "doneWhen": [],
            "url": "http://localhost:5173/todos", "persona": "dana", "browser": "chrome",
            "visitMode": "new", "device": "mobile",
        }))]
    );
    let v = stdout_json(&out);
    assert_eq!((&v["id"], &v["state"], &v["finished"], &v["device"]), (&json!("j1"), &json!("done"), &json!(true), &json!("mobile")));
    assert_eq!(v["issues"][0]["step"], 1);
}

#[test]
fn an_agent_starts_one_detached_reads_where_it_stands_and_calls_it_off() {
    // Catches: --detach waiting for the end, a journey still going read as ended (exit 0 or 1), or stop not reaching the service.
    let (fake, env) = signed_in("journeys-detach");
    started(&fake);
    let out = impeccable(&env, &["journeys", "add-a-todo", "--pr", "12", "--repo", "acme/storefront", "--cloud", "--detach", "--json"])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(0));
    let v = stdout_json(&out);
    assert_eq!((v["id"].as_str(), v["page"].as_str()), (Some("j1"), Some(format!("{}/app/acme/journeys/j1", fake.url).as_str())));
    assert_eq!(fake.hits(ONE), 0);
    let sent = fake.record.lock().unwrap().bodies[0].1.clone();
    assert_eq!((&sent["errand"], &sent["pr"], &sent["browser"]), (&json!("add-a-todo"), &json!(12), &json!("cloud")));

    answer(&fake, "GET", ONE, 200, status("walking", Value::Null));
    let out = impeccable(&env, &["journeys", "status", "j1", "--json"]).output().unwrap();
    assert_eq!(out.status.code(), Some(3));
    let v = stdout_json(&out);
    assert_eq!((&v["state"], &v["steps"], v["issues"].as_array().map(Vec::len)), (&json!("walking"), &json!(1), Some(1)));

    answer(&fake, "POST", "/cli/v1/journeys/j1/cancel", 200, json!({ "id": "j1", "state": "cancelled" }));
    let out = impeccable(&env, &["journeys", "stop", "j1", "--json"]).output().unwrap();
    assert_eq!(out.status.code(), Some(0));
    assert_eq!(stdout_json(&out), json!({ "id": "j1", "state": "cancelled" }));
}

#[test]
fn each_way_a_journey_cannot_start_has_its_code_and_exit() {
    // Catches: a refusal read as "unreachable" (an agent would retry it forever), a missing journeys scope not sending the person to sign in, and a page on another site being accepted.
    let (fake, env) = signed_in("journeys-refused");
    let run = || {
        impeccable(&env, &["journeys", "add a todo", "--url", "http://localhost:5173", "--repo", "acme/storefront", "--json"])
            .output()
            .unwrap()
    };
    for (status, body, error, exit) in [
        (404, Value::Null, "not-enabled", 2),
        (409, json!({ "error": "no-cast" }), "no-cast", 2),
        (403, json!({ "error": "insufficient_scope" }), "not-signed-in", 4),
        (500, json!({}), "unreachable", 2),
        (418, json!({ "error": "a-new-code" }), "unknown", 2),
        (200, json!({ "id": "j1", "state": "queued", "page": "https://elsewhere.example/j1" }), "outdated", 2),
    ] {
        let sent = if body.is_null() { String::new() } else { body.to_string() };
        fake.route("POST", START, status, vec![], sent);
        let out = run();
        assert_eq!(stdout_json(&out)["error"], error, "{status}");
        assert_eq!(out.status.code(), Some(exit), "{status}");
        assert!(!out.stderr.is_empty(), "{status}: no line saying what to do");
    }
    assert_eq!(fake.hits(ONE), 0);
}

#[test]
fn nothing_is_asked_of_the_service_signed_out_or_on_bad_usage() {
    // Catches: a signed-out run (an agent's) opening a sign-in or exiting like a refusal, and a malformed command reaching the service.
    let fake = Fake::start();
    let env = fake.env("journeys-signed-out");
    let out = impeccable(&env, &["journeys", "status", "j1", "--json"]).output().unwrap();
    assert_eq!((out.status.code(), &stdout_json(&out)["error"]), (Some(4), &json!("not-signed-in")));
    for args in [
        &["journeys", "add a todo", "--json"][..],
        &["journeys", "add a todo", "--url", "localhost:5173", "--json"],
        &["journeys", "add a todo", "--url", "http://localhost:5173", "--pr", "3", "--json"],
        &["journeys", "status", "../j1", "--json"],
        &["journeys", "add a todo", "--url", "http://localhost:5173", "--no-such-option", "--json"],
    ] {
        let out = impeccable(&env, args).output().unwrap();
        assert_eq!((out.status.code(), &stdout_json(&out)["error"]), (Some(2), &json!("bad-usage")), "{args:?}");
    }
    assert_eq!(fake.record.lock().unwrap().hits.keys().filter(|p| p.starts_with("/cli/")).count(), 0);
}

#[test]
fn the_skill_is_written_where_agents_read_skills() {
    // Catches: the journeys skill landing in one agent's folder only, or needing a sign-in to install.
    let fake = Fake::start();
    let env = fake.env("journeys-skill");
    let out = impeccable(&env, &["journeys", "skill"]).output().unwrap();
    assert!(out.status.success());
    for home in [".claude/skills", ".agents/skills"] {
        let text = std::fs::read_to_string(format!("{}/{home}/impeccable-journeys/SKILL.md", env["HOME"])).unwrap();
        assert!(text.starts_with("---\nname: impeccable-journeys\n"), "{home}");
    }
}
