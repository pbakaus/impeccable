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
