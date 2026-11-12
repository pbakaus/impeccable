//! Taste reads use the fake issuer and file credentials only.
mod support;
use impeccable_account::{config::Account, login, session::Session, store::Store, taste};
use impeccable_common::Io;
use serde_json::{json, Value};
use std::time::Duration;
use support::fake::{browser, Fake};

fn signed_in(fake: &Fake, name: &str) -> (Io, Account) {
    fake.knobs.lock().unwrap().taste = true;
    let env = fake.env(name);
    login(&env, &mut |u| browser(u), Duration::from_secs(10)).unwrap();
    let account = Account::from_env(&env).unwrap();
    let (io, _) = Io::captured("", account.home.clone(), env);
    (io, account)
}

#[test]
fn refresh_sanitizes_limits_revalidates_and_deletes() {
    let fake = Fake::start();
    let (io, account) = signed_in(&fake, "taste-read");
    let (mut io, cap) = Io::captured("", io.cwd.clone(), io.env.clone());
    let path = account.home.join("taste.json");
    assert!(taste::wanted(&io));
    let mut rules = vec![
        json!({"id":"bad id","text":"Bad id","direction":"prefer"}),
        json!({"id":"bad-direction","text":"Bad direction","direction":"other"}),
        json!({"id":"empty","text":"\u{0000}","direction":"prefer"}),
        json!({"id":"clean","text":"  Square\u{0000} corners   please  ","direction":"prefer","source":"seed","calls":2}),
    ];
    for n in 0..13 {
        rules.push(json!({"id":format!("r{n}"),"text":"é".repeat(260),"direction":"avoid"}));
    }
    fake.route("GET", "/cli/v1/taste", 200, vec![("etag", "\"v1\"".into())],
        json!({"version":1,"state":"ready","rules":rules,"say":"ignored","page":"ignored"}).to_string());
    assert_eq!(taste::run_refresh(&[], &mut io), 0);
    let read = || serde_json::from_slice::<Value>(&std::fs::read(&path).unwrap()).unwrap();
    let mut cached = read();
    assert_eq!(cached["rules"].as_array().unwrap().len(), 12);
    assert_eq!(cached["rules"][11]["id"], "r10");
    assert_eq!(cached["rules"][0]["text"], "Square corners please");
    assert_eq!(cached["rules"][1]["text"].as_str().unwrap().chars().count(), 240);
    assert!(cached.get("say").is_none() && cached.get("page").is_none());
    assert!(cached["rules"][0].get("source").is_none());
    assert_eq!(cached["etag"], "\"v1\"");
    assert!(!taste::wanted(&io));
    #[cfg(unix)] {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
    }
    cached["issuer"] = "https://other.invalid".into();
    std::fs::write(&path, cached.to_string()).unwrap();
    assert!(taste::wanted(&io));
    taste::run_refresh(&[], &mut io);
    assert_eq!(fake.record.lock().unwrap().taste_reads[1], ("limit=12".into(), None));
    cached = read();
    cached["fetchedAt"] = 1.into();
    std::fs::write(&path, cached.to_string()).unwrap();
    assert!(taste::wanted(&io));
    fake.route("GET", "/cli/v1/taste", 304, vec![], "");
    taste::run_refresh(&[], &mut io);
    let refreshed = read();
    assert_eq!(fake.record.lock().unwrap().taste_reads[2],
        ("limit=12".into(), Some("\"v1\"".into())));
    cached["fetchedAt"] = refreshed["fetchedAt"].clone();
    assert_eq!(cached, refreshed);
    assert!(refreshed["fetchedAt"].as_u64().unwrap() > 1);
    fake.route("GET", "/cli/v1/taste", 500, vec![], "");
    taste::run_refresh(&[], &mut io);
    assert_eq!(read(), refreshed);
    for status in [404, 403] {
        std::fs::write(&path, refreshed.to_string()).unwrap();
        fake.route("GET", "/cli/v1/taste", status, vec![], "");
        taste::run_refresh(&[], &mut io);
        assert!(!path.exists());
    }
    std::fs::write(&path, refreshed.to_string()).unwrap();
    io.env.insert("IMPECCABLE_NO_TASTE".into(), "1".into());
    assert!(!taste::wanted(&io));
    taste::run_refresh(&[], &mut io);
    assert_eq!(read(), refreshed);
    io.env.remove("IMPECCABLE_NO_TASTE");
    // An abrupt close is a network failure, with no real service involved.
    fake.route("GET", "/cli/v1/taste", 0, vec![], "");
    taste::run_refresh(&[], &mut io);
    assert_eq!(read(), refreshed);
    // A pause answers 200 with no rules: the old rules leave the copy at once.
    for state in ["paused", "plan", "empty"] {
        std::fs::write(&path, refreshed.to_string()).unwrap();
        fake.route("GET", "/cli/v1/taste", 200, vec![], json!({"version": 1, "state": state, "rules": []}).to_string());
        taste::run_refresh(&[], &mut io);
        let now = read();
        assert_eq!(now["state"], state);
        assert_eq!(now["rules"], json!([]));
    }
    // CI never schedules detached work; a telemetry opt-out does not stop the read.
    let mut stale = refreshed.clone();
    stale["fetchedAt"] = 1.into();
    std::fs::write(&path, stale.to_string()).unwrap();
    io.env.insert("DO_NOT_TRACK".into(), "1".into());
    assert!(taste::wanted(&io));
    io.env.remove("DO_NOT_TRACK");
    io.env.insert("CI".into(), "1".into());
    assert!(!taste::wanted(&io));
    io.env.remove("CI");
    // A new sign-in may be another person: the copy goes.
    std::fs::write(&path, refreshed.to_string()).unwrap();
    login(&io.env, &mut |u| browser(u), Duration::from_secs(10)).unwrap();
    assert!(!path.exists());
    std::fs::write(&path, refreshed.to_string()).unwrap();
    impeccable_account::logout(&io.env).unwrap();
    assert!(!path.exists());
    assert!(cap.stdout.borrow().is_empty());
    assert!(cap.stderr.borrow().is_empty());
}

#[test]
fn taste_metadata_and_saved_grant_follow_consent_and_refresh() {
    for (offered, granted) in [(false, false), (true, true), (true, false)] {
        let fake = Fake::start();
        fake.knobs.lock().unwrap().taste = offered;
        fake.knobs.lock().unwrap().taste_denied = !granted;
        let env = fake.env(if offered { "taste-offered" } else { "taste-off" });
        login(&env, &mut |u| browser(u), Duration::from_secs(10)).unwrap();
        assert_eq!(fake.record.lock().unwrap().scopes[0].split_whitespace()
            .any(|s| s == "taste:read"), offered);
        let account = Account::from_env(&env).unwrap();
        assert_eq!(Store::new(&account).state().unwrap().taste, granted);
        let mut session = Session::load(&account).unwrap();
        session.refresh().unwrap();
        assert_eq!(session.state.taste, granted);
    }
}

fn write_fixture(name: &str) -> (Fake, Io, Account) {
    let fake = Fake::start();
    fake.knobs.lock().unwrap().taste_write = true;
    let (mut io, account) = signed_in(&fake, name);
    io.env.insert("IMPECCABLE_SEED_SALT".into(), "taste-test-salt".into());
    (fake, io, account)
}

fn write_run(io: &Io, args: &[&str]) -> (i32, String, String) {
    let (mut run_io, cap) = Io::captured("", io.cwd.clone(), io.env.clone());
    let code = taste::run(&args.iter().map(|s| s.to_string()).collect::<Vec<_>>(), &mut run_io);
    let out = String::from_utf8(cap.stdout.borrow().clone()).unwrap();
    let err = String::from_utf8(cap.stderr.borrow().clone()).unwrap();
    (code, out, err)
}

#[test]
fn calls_sanitize_derive_stable_events_and_print_every_outcome() {
    let (fake, io, _) = write_fixture("taste-write-call");
    let chose = format!("  Square\0   corners {}", "é".repeat(220));
    let over = "o".repeat(230);
    let rule = "r".repeat(260);
    let args = ["call", "--kind", "agent", "--chose", &chose, "--over", &over, "--rule", &rule];
    for (outcome, line) in [
        ("recorded", "Taste: recorded."),
        ("duplicate", "Taste: already recorded."),
        ("paused", "Taste: learning is paused, nothing stored."),
        ("full", "Taste: today's limit is reached, nothing stored."),
    ] {
        fake.route("POST", "/cli/v1/taste/calls", 200, vec![], json!({"outcome":outcome}).to_string());
        assert_eq!(write_run(&io, &args), (0, format!("{line}\n"), String::new()));
    }
    let record = fake.record.lock().unwrap();
    assert_eq!(record.taste_calls.len(), 4);
    let body = &record.taste_calls[0];
    assert_eq!(body["kind"], "agent");
    assert!(body["chose"].as_str().unwrap().starts_with("Square corners "));
    assert_eq!(body["chose"].as_str().unwrap().chars().count(), 200);
    assert_eq!(body["over"], "o".repeat(200));
    assert_eq!(body["rule"], "r".repeat(240));
    let event = body["event"].as_str().unwrap();
    assert_eq!(event.len(), 37);
    assert!(event.starts_with("call-"));
    assert!(event[5..].bytes().all(|b| b.is_ascii_hexdigit()));
    assert!(record.taste_calls.iter().all(|b| b == body));
    drop(record);
    fake.route("POST", "/cli/v1/taste/calls", 200, vec![], r#"{"outcome":"recorded"}"#);
    assert_eq!(write_run(&io, &["call", "--kind", "variant", "--chose", "A", "--event", " custom\0  id ", "--json"]),
        (0, "{\"outcome\":\"recorded\"}\n".into(), String::new()));
    let record = fake.record.lock().unwrap();
    assert_eq!(record.taste_calls.last().unwrap(), &json!({"kind":"variant","chose":"A","event":"custom id"}));
}

#[test]
fn invalid_calls_fail_before_any_request_and_help_lists_both_commands() {
    let (fake, io, _) = write_fixture("taste-write-validation");
    for args in [
        vec!["call", "--kind", "agent", "--chose", "A"],
        vec!["call", "--kind", "other", "--chose", "A"],
        vec!["call", "--kind", "variant"],
        vec!["call", "--kind", "variant", "--chose", " \0 "],
        vec!["call", "--kind", "variant", "--chose"],
        vec!["used", "--where", "other", "valid"],
    ] {
        let (code, out, err) = write_run(&io, &args);
        assert_eq!(code, 1, "{args:?}");
        assert!(out.is_empty());
        assert_eq!(err.lines().count(), 1);
    }
    assert!(fake.record.lock().unwrap().taste_calls.is_empty());
    assert!(fake.record.lock().unwrap().taste_uses.is_empty());
    let (code, out, err) = write_run(&io, &["--help"]);
    assert_eq!(code, 0);
    assert!(err.is_empty());
    assert!(out.contains("taste call") && out.contains("taste used"));
}

#[test]
fn uses_filter_cap_and_derive_private_project_daily_sessions() {
    let (fake, mut io, _) = write_fixture("taste-write-used");
    fake.route("POST", "/cli/v1/taste/uses", 200, vec![], r#"{"counted":40}"#);
    let mut args = vec!["used".to_string(), "--where".into(), "build".into(), "bad id".into(), "!".into(), "é".into(), "x".repeat(65)];
    args.extend((0..45).map(|n| format!("r_{n}-ok")));
    let refs: Vec<_> = args.iter().map(String::as_str).collect();
    for _ in 0..2 {
        assert_eq!(write_run(&io, &refs), (0, "Taste: noted 40 rule(s) applied.\n".into(), String::new()));
    }
    let root = io.cwd.to_string_lossy().into_owned();
    let date = impeccable_context::util::iso_now();
    use sha2::{Digest, Sha256};
    let mut hash = Sha256::new();
    for part in [&root, &date[..10], "taste-test-salt"] {
        hash.update((part.len() as u64).to_be_bytes());
        hash.update(part.as_bytes());
    }
    let expected: String = hash.finalize()[..16].iter().map(|b| format!("{b:02x}")).collect();
    assert_eq!(fake.record.lock().unwrap().taste_uses[0]["session"], format!("use-{expected}"));
    // A subdirectory of a checkout shares its root, another checkout does not.
    std::fs::create_dir_all(io.cwd.join(".git")).unwrap();
    std::fs::create_dir_all(io.cwd.join("sub")).unwrap();
    io.cwd.push("sub");
    write_run(&io, &refs);
    io.cwd.pop();
    let other = io.cwd.join("other");
    std::fs::create_dir_all(other.join(".git")).unwrap();
    io.cwd = other;
    write_run(&io, &refs);
    let record = fake.record.lock().unwrap();
    let first = &record.taste_uses[0];
    assert_eq!(first["where"], "build");
    assert_eq!(first["rules"].as_array().unwrap().len(), 40);
    assert_eq!(first["rules"][0], "r_0-ok");
    assert_eq!(first["rules"][39], "r_39-ok");
    assert_eq!(first["session"], record.taste_uses[1]["session"]);
    assert_eq!(first["session"], record.taste_uses[2]["session"]);
    assert_ne!(first["session"], record.taste_uses[3]["session"]);
    let session = first["session"].as_str().unwrap();
    assert!(session.starts_with("use-"));
    assert_eq!(session.len(), 36);
    assert!(!first.to_string().contains(&io.cwd.to_string_lossy().to_string()));
    drop(record);
    assert_eq!(write_run(&io, &["used", "--where", "critique", "bad id", "!"]), (0, String::new(), String::new()));
    assert_eq!(fake.record.lock().unwrap().taste_uses.len(), 4);
    fake.route("POST", "/cli/v1/taste/uses", 200, vec![], r#"{"counted":0}"#);
    assert_eq!(write_run(&io, &["used", "--where", "critique", "rule"]), (0, String::new(), String::new()));
    assert_eq!(write_run(&io, &["used", "--where", "critique", "rule", "--json"]), (0, "{\"counted\":0}\n".into(), String::new()));
    assert_eq!(fake.record.lock().unwrap().taste_uses.last().unwrap()["where"], "critique");
}

#[test]
fn writes_honor_all_opt_outs_and_silently_ignore_server_failures() {
    let (fake, mut io, account) = write_fixture("taste-write-gates");
    let commands = [vec!["call", "--kind", "variant", "--chose", "A"], vec!["used", "--where", "build", "rule"]];
    let silent = (0, String::new(), String::new());
    for key in ["IMPECCABLE_NO_TASTE", "DO_NOT_TRACK", "IMPECCABLE_NO_TELEMETRY"] {
        io.env.insert(key.into(), "1".into());
        for args in &commands { assert_eq!(write_run(&io, args), silent); }
        io.env.remove(key);
    }
    std::fs::create_dir_all(io.cwd.join(".impeccable")).unwrap();
    std::fs::write(io.cwd.join(".impeccable/config.json"), r#"{"telemetry":false}"#).unwrap();
    for args in &commands { assert_eq!(write_run(&io, args), silent); }
    std::fs::remove_file(io.cwd.join(".impeccable/config.json")).unwrap();
    // A child app's own opt-out counts when the command runs from it, not only the checkout root's.
    assert!(std::process::Command::new("git").arg("init").arg(&io.cwd)
        .stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status().unwrap().success());
    let child = io.cwd.join("apps/web");
    std::fs::create_dir_all(child.join(".impeccable")).unwrap();
    std::fs::write(child.join(".impeccable/config.json"), r#"{"telemetry":false}"#).unwrap();
    let (child_io, _) = Io::captured("", child.clone(), io.env.clone());
    for args in &commands { assert_eq!(write_run(&child_io, args), silent); }
    std::fs::remove_dir_all(io.cwd.join("apps")).unwrap();
    let store = Store::new(&account);
    let original = store.state().unwrap();
    let mut state = original.clone();
    state.taste_write = false;
    store.write_state(&state).unwrap();
    for args in &commands { assert_eq!(write_run(&io, args), silent); }
    state.signed_in = false;
    store.write_state(&state).unwrap();
    for args in &commands { assert_eq!(write_run(&io, args), silent); }
    assert!(fake.record.lock().unwrap().taste_calls.is_empty());
    assert!(fake.record.lock().unwrap().taste_uses.is_empty());
    store.write_state(&original).unwrap();
    for status in [404, 403, 0, 400, 413, 500, 201] {
        for (route, args) in [ ("calls", &commands[0]), ("uses", &commands[1]) ] {
            fake.route("POST", &format!("/cli/v1/taste/{route}"), status, vec![], r#"{"outcome":"recorded","counted":1}"#);
            assert_eq!(write_run(&io, args), silent, "{route}: {status}");
        }
    }
}

#[test]
fn taste_write_scope_tracks_metadata_consent_and_refresh() {
    for (offered, granted) in [(false, false), (true, true), (true, false)] {
        let fake = Fake::start();
        fake.knobs.lock().unwrap().taste_write = offered;
        fake.knobs.lock().unwrap().taste_write_denied = !granted;
        let env = fake.env("taste-write-scope");
        login(&env, &mut |u| browser(u), Duration::from_secs(10)).unwrap();
        assert_eq!(fake.record.lock().unwrap().scopes[0].split_whitespace().any(|s| s == "taste:write"), offered);
        let account = Account::from_env(&env).unwrap();
        assert_eq!(Store::new(&account).state().unwrap().taste_write, granted);
        let mut session = Session::load(&account).unwrap();
        session.refresh().unwrap();
        assert_eq!(session.state.taste_write, granted);
    }
}
