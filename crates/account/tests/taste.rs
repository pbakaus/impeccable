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
