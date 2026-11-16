//! `impeccable mcp` against the fake account service: a call goes through the CLI's own sign-in, and a sign-in that
//! was ended comes back with one approval and the held call answered.
#[path = "../../account/tests/support/mod.rs"]
mod support;
use impeccable_account::login;
use impeccable_mcp::{serve, service, NO_BROWSER};
use serde_json::{json, Value};
use std::time::Duration;
use support::fake::{browser, Fake};

fn talk(env: &std::collections::HashMap<String, String>, browser_here: bool, line: &Value) -> Value {
    let mut up = service(env.clone(), browser_here, Box::new(|url: &str| { browser(url); true }));
    let (mut out, mut err) = (Vec::new(), Vec::new());
    serve(line.to_string().as_bytes(), &mut out, &mut err, &mut up);
    let out = String::from_utf8(out).unwrap();
    serde_json::from_str(out.lines().last().unwrap()).unwrap()
}

// Catches the proxy not using the CLI's sign-in, a revoked sign-in not coming back with one approval, the held call
// not answered after it, and SSH getting anything but the one line.
#[test]
fn proxies_under_the_cli_sign_in_and_signs_in_again_once() {
    let fake = Fake::start();
    let env = fake.env("mcp-proxy");
    fake.route("POST", "/mcp", 200, vec![("content-type", "application/json".into())], json!({ "jsonrpc": "2.0", "id": 7, "result": { "content": [{ "type": "text", "text": "rules" }] } }).to_string());
    // Access tokens die at once, so every call refreshes: ending the grant is then what the proxy meets.
    fake.knobs.lock().unwrap().access_ttl = 0;
    login(&env, &mut |u: &str| browser(u), Duration::from_secs(10)).unwrap();
    let call = json!({ "jsonrpc": "2.0", "id": 7, "method": "tools/call", "params": { "name": "taste.get", "arguments": {} } });
    assert_eq!(talk(&env, true, &call)["result"]["content"][0]["text"], "rules");

    // The service ends the grant: refresh fails, so the proxy signs in again (one approval) and answers.
    let ended = fake.record.lock().unwrap().live_refresh_tokens();
    for t in ended { fake.record.lock().unwrap().end_grant_of(&t); }
    let logins = fake.hits("/oauth/token");
    assert_eq!(talk(&env, true, &call)["result"]["content"][0]["text"], "rules");
    assert!(fake.hits("/oauth/token") > logins);

    // Over SSH (no browser): the one line, and no sign-in started.
    let ended = fake.record.lock().unwrap().live_refresh_tokens();
    for t in ended { fake.record.lock().unwrap().end_grant_of(&t); }
    let said = talk(&env, false, &call);
    assert_eq!((said["result"]["content"][0]["text"].as_str(), said["result"]["isError"].as_bool()), (Some(NO_BROWSER), Some(true)));
}

// Catches a plan or workspace refusal (403 without `insufficient_scope`) sending the person to a browser sign-in on
// every call, and a missing scope (403 `insufficient_scope`) not doing so.
#[test]
fn opens_the_browser_only_for_a_missing_scope() {
    for (code, signs_in) in [("not-pro", false), ("insufficient_scope", true)] {
        let fake = Fake::start();
        let env = fake.env(&format!("mcp-403-{code}"));
        login(&env, &mut |u: &str| browser(u), Duration::from_secs(10)).unwrap();
        fake.route("POST", "/mcp", 403, vec![("content-type", "application/json".into())], json!({ "error": code }).to_string());
        let before = fake.hits("/oauth/token");
        let call = json!({ "jsonrpc": "2.0", "id": 9, "method": "tools/call", "params": { "name": "personas_list", "arguments": {} } });
        talk(&env, true, &call);
        assert_eq!(fake.hits("/oauth/token") > before, signs_in, "{code}");
    }
}

// Catches a browser that fails to open (DISPLAY set, no working opener) holding the agent's call for five minutes.
#[test]
fn answers_at_once_when_the_browser_does_not_open() {
    let fake = Fake::start();
    let env = fake.env("mcp-no-opener");
    let mut up = service(env.clone(), true, Box::new(|_: &str| false));
    let call = json!({ "jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": { "name": "taste.get", "arguments": {} } });
    let (mut out, mut err) = (Vec::new(), Vec::new());
    let started = std::time::Instant::now();
    serve(call.to_string().as_bytes(), &mut out, &mut err, &mut up);
    let said: Value = serde_json::from_str(String::from_utf8(out).unwrap().lines().last().unwrap()).unwrap();
    assert_eq!(said["result"]["content"][0]["text"], NO_BROWSER);
    // A second call while that sign-in is still waiting answers at once too, and starts no second sign-in.
    let (mut out, mut err) = (Vec::new(), Vec::new());
    serve(call.to_string().as_bytes(), &mut out, &mut err, &mut up);
    let again: Value = serde_json::from_str(String::from_utf8(out).unwrap().lines().last().unwrap()).unwrap();
    assert_eq!(again["result"]["content"][0]["text"], NO_BROWSER);
    assert!(started.elapsed() < Duration::from_secs(20));
}

/// Records what reaches the service.
struct Seen(Vec<Value>);
impl impeccable_mcp::Upstream for Seen {
    fn call(&mut self, request: &Value) -> Result<Value, impeccable_mcp::Failure> {
        self.0.push(request.clone());
        Ok(json!({ "jsonrpc": "2.0", "id": request["id"], "result": {} }))
    }
    fn sign_in(&mut self) -> Result<(), String> { Ok(()) }
}

// Catches Claude Code and Codex, sharing the CLI's one sign-in, reading and replacing each other's Needs-you
// questions: a call that names no session is named for the agent that made it, and a named one is left alone.
#[test]
fn names_needs_you_calls_for_the_agent_that_made_them() {
    let lines = [
        json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "clientInfo": { "name": "codex-mcp-client" } } }),
        json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": { "name": "needs_you.post", "arguments": { "title": "t" } } }),
        json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": { "name": "needs_you.answer", "arguments": { "from": "tab 2" } } }),
        json!({ "jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": { "name": "taste.get", "arguments": {} } }),
    ];
    let input: String = lines.iter().map(|l| format!("{l}\n")).collect();
    let mut seen = Seen(Vec::new());
    serve(input.as_bytes(), &mut Vec::new(), &mut Vec::new(), &mut seen);
    let args = |i: usize| seen.0[i]["params"]["arguments"].clone();
    assert_eq!(args(1)["from"], "codex-mcp-client");
    assert_eq!(args(2)["from"], "tab 2");
    assert!(args(3).get("from").is_none());

    // A name the service would refuse as a label is cut to what it accepts, and dropped when nothing is left.
    for (name, from) in [("Claude\u{200B} Code\n✨", Some("Claude Code")), ("\u{2800}\u{200B}", None), (&format!("{}é{}", "a".repeat(38), "bcd"), Some(&*format!("{}bc", "a".repeat(38))))] {
        let lines = [
            json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "clientInfo": { "name": name } } }),
            json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": { "name": "needs_you.list", "arguments": {} } }),
        ];
        let input: String = lines.iter().map(|l| format!("{l}\n")).collect();
        let mut seen = Seen(Vec::new());
        serve(input.as_bytes(), &mut Vec::new(), &mut Vec::new(), &mut seen);
        assert_eq!(seen.0[1]["params"]["arguments"]["from"].as_str(), from);
    }
}
