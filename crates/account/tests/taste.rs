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
    assert_eq!(cached["say"], "ignored");
    assert!(cached.get("page").is_none());
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

#[test]
fn focused_reads_are_separate_and_old_servers_fall_back() {
    let fake = Fake::start();
    let (mut io, account) = signed_in(&fake, "taste-focus");
    let git = |args: &[&str]| assert!(std::process::Command::new("git").args(args).current_dir(&io.cwd).status().unwrap().success());
    git(&["init", "-q"]);
    git(&["config", "remote.origin.url", "https://github.com/owner/project.git"]);
    let body = json!({"version":1,"state":"ready","rules":[],"repositoryRules":[{"id":"repo","direction":"prefer","text":"Square corners"}]}).to_string();
    fake.route("GET", "/cli/v1/taste", 200, vec![("etag", "one".into())], body.as_str());
    for focus in ["web", "slides", "motion"] {
        taste::run_refresh(&["--focus".into(), focus.into()], &mut io);
        let path = account.home.join(format!("taste-{focus}.json"));
        assert!(path.exists());
        assert!(!taste::wanted_for(&io, Some(focus)));
        let cached: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        assert_eq!(cached["repositoryRules"][0]["text"], "Square corners");
    }
    assert!(!account.home.join("taste.json").exists());
    taste::run_refresh(&[], &mut io);
    let reads = fake.record.lock().unwrap().taste_reads.clone();
    for (i, focus) in ["web", "slides", "motion"].iter().enumerate() {
        let q: std::collections::HashMap<_, _> = url::form_urlencoded::parse(reads[i].0.as_bytes()).into_owned().collect();
        assert_eq!(q.get("focus").unwrap(), focus);
        assert_eq!(q.get("repository").unwrap(), "owner/project");
    }
    assert!(!reads[3].0.contains("focus"));
    fake.route("GET", "/cli/v1/taste?limit=12&repository=owner%2Fproject&focus=slides", 400, vec![], r#"{"error":"focus"}"#);
    taste::run_refresh(&["--focus".into(), "slides".into()], &mut io);
    let reads = fake.record.lock().unwrap().taste_reads.clone();
    assert_eq!(reads.len(), 6);
    assert!(!reads[5].0.contains("focus"));
    assert_eq!(reads[5].1, None);
    impeccable_account::logout(&io.env).unwrap();
    for name in ["taste.json", "taste-web.json", "taste-slides.json", "taste-motion.json"] { assert!(!account.home.join(name).exists()); }
}

#[test]
fn notes_hash_stably_report_outcomes_and_validate_before_sending() {
    let fake = Fake::start();
    fake.knobs.lock().unwrap().cli_mcp = true;
    let (io, _) = signed_in(&fake, "taste-note");
    let base: Vec<String> = ["note", "--chose", "Square corners", "--rule", "Keep corners square"].iter().map(|s| s.to_string()).collect();
    for (outcome, line) in [("recorded", "recorded"), ("duplicate", "already recorded"), ("paused", "paused (taste capture is paused for your account)"), ("full", "full")] {
        fake.route("POST", "/cli/v1/taste/calls", 200, vec![], json!({"outcome":outcome}).to_string());
        let (mut io, cap) = Io::captured("", io.cwd.clone(), io.env.clone());
        assert_eq!(taste::run(&base, &mut io), 0);
        assert_eq!(String::from_utf8_lossy(&cap.stdout.borrow()), format!("{line}\n"));
        let mut args = base.clone(); args.push("--json".into());
        let (mut io, cap) = Io::captured("", io.cwd.clone(), io.env.clone());
        assert_eq!(taste::run(&args, &mut io), 0);
        assert_eq!(serde_json::from_slice::<Value>(&cap.stdout.borrow()).unwrap(), json!({"outcome":outcome}));
    }
    let calls = fake.record.lock().unwrap().taste_calls.clone();
    assert_eq!(calls.len(), 8);
    assert!(calls.iter().all(|c| c == &calls[0]));
    assert_eq!(calls[0].as_object().unwrap().len(), 3);
    assert_eq!(calls[0]["event"].as_str().unwrap().len(), 64);
    let git = |args: &[&str]| assert!(std::process::Command::new("git").args(args).current_dir(&io.cwd).status().unwrap().success());
    git(&["init", "-q"]);
    git(&["config", "remote.origin.url", "https://github.com/owner/project.git"]);
    let (mut scoped_io, _) = Io::captured("", io.cwd.clone(), io.env.clone());
    assert_eq!(taste::run(&base, &mut scoped_io), 0);
    let scoped = fake.record.lock().unwrap().taste_calls.last().unwrap().clone();
    assert_eq!(scoped["repository"], "owner/project");
    assert_ne!(scoped["event"], calls[0]["event"]);
    let mut explicit = base.clone();
    explicit.extend(["--repository", "other/repo", "--event", "explicit", "--over", "Round corners"].map(String::from));
    assert_eq!(taste::run(&explicit, &mut scoped_io), 0);
    assert_eq!(fake.record.lock().unwrap().taste_calls.last().unwrap(), &json!({
        "chose":"Square corners", "rule":"Keep corners square", "over":"Round corners", "repository":"other/repo", "event":"explicit"
    }));
    fake.route("POST", "/cli/v1/taste/calls", 403, vec![], "{}");
    let (mut io, cap) = Io::captured("", io.cwd.clone(), io.env.clone());
    assert_eq!(taste::run(&base, &mut io), 1);
    assert!(String::from_utf8_lossy(&cap.stderr.borrow()).contains("impeccable login"));
    let mut long = base.clone(); long[2] = "x".repeat(201);
    let before = fake.record.lock().unwrap().taste_calls.len();
    let (mut io, cap) = Io::captured("", io.cwd.clone(), io.env.clone());
    assert_eq!(taste::run(&long, &mut io), 1);
    assert!(String::from_utf8_lossy(&cap.stderr.borrow()).contains("200"));
    assert_eq!(fake.record.lock().unwrap().taste_calls.len(), before);
    impeccable_account::logout(&io.env).unwrap();
    let (mut io, cap) = Io::captured("", io.cwd.clone(), io.env.clone());
    assert_eq!(taste::run(&base, &mut io), 1);
    assert!(String::from_utf8_lossy(&cap.stderr.borrow()).contains("impeccable login"));
}


#[test]
fn foreground_reads_revalidate_print_rules_say_and_rev_and_report_unchanged() {
    let fake = Fake::start();
    let (mut io, account) = signed_in(&fake, "taste-foreground");
    let body = json!({"version":1,"state":"ready","rules":[{"id":"person","text":"Personal rule","direction":"prefer"}],
        "repositoryRules":[{"id":"repo","text":"Repository rule","direction":"avoid"}], "say":"Applied your taste: <rule>"});
    fake.route("GET", "/cli/v1/taste", 200, vec![("etag", "rev-1".into())], body.to_string());
    let git = |args: &[&str]| assert!(std::process::Command::new("git").args(args).current_dir(&io.cwd).status().unwrap().success());
    git(&["init", "-q"]);
    git(&["config", "remote.origin.url", "https://github.com/owner/project.git"]);
    let args: Vec<String> = ["--focus", "slides", "--json"].map(String::from).into();
    let (mut read_io, cap) = Io::captured("", io.cwd.clone(), io.env.clone());
    assert_eq!(taste::run(&args, &mut read_io), 0);
    let v: Value = serde_json::from_slice(&cap.stdout.borrow()).unwrap();
    assert_eq!(v["rev"], "rev-1");
    assert_eq!(v["say"], body["say"]);
    assert_eq!(v["rules"], body["rules"]);
    assert_eq!(v["repositoryRules"], body["repositoryRules"]);
    assert!(account.home.join("taste-slides.json").exists());
    fake.route("GET", "/cli/v1/taste", 304, vec![], "");
    let (mut read_io, cap) = Io::captured("", io.cwd.clone(), io.env.clone());
    assert_eq!(taste::run(&["--focus=slides".into(), "--since".into(), "rev-1".into()], &mut read_io), 0);
    assert_eq!(String::from_utf8_lossy(&cap.stdout.borrow()), "Taste rules are unchanged (rev: rev-1).\n");
    assert_eq!(fake.record.lock().unwrap().taste_reads.last().unwrap().1.as_deref(), Some("rev-1"));
    let (mut read_io, cap) = Io::captured("", io.cwd.clone(), io.env.clone());
    assert_eq!(taste::run(&["--focus=slides".into(), "--since=rev-1".into(), "--json".into()], &mut read_io), 0);
    assert_eq!(serde_json::from_slice::<Value>(&cap.stdout.borrow()).unwrap(), json!({"unchanged":true,"rev":"rev-1"}));

    let (mut read_io, cap) = Io::captured("", io.cwd.clone(), io.env.clone());
    assert_eq!(taste::run(&["--focus=slides".into()], &mut read_io), 0);
    let text = String::from_utf8_lossy(&cap.stdout.borrow()).to_string();
    assert!(text.find("Personal rule").unwrap() < text.find("Repository rule").unwrap());
    assert!(text.contains("Applied your taste: <rule>") && text.contains("rev: rev-1"));
    io.env.insert("IMPECCABLE_NO_TASTE".into(), "1".into());
    let (mut read_io, cap) = Io::captured("", io.cwd.clone(), io.env.clone());
    assert_eq!(taste::run(&[], &mut read_io), 0);
    assert_eq!(String::from_utf8_lossy(&cap.stdout.borrow()), "Taste is off.\n");
    io.env.remove("IMPECCABLE_NO_TASTE");
    fake.route("GET", "/cli/v1/taste", 200, vec![], json!({"version":1,"state":"paused","rules":[]}).to_string());
    let (mut read_io, cap) = Io::captured("", io.cwd.clone(), io.env.clone());
    assert_eq!(taste::run(&[], &mut read_io), 0);
    assert_eq!(String::from_utf8_lossy(&cap.stdout.borrow()), "Taste is off.\n");
    // Paused personal taste with the repository's rules still served (t13v, 22 Nov).
    fake.route("GET", "/cli/v1/taste", 200, vec![("etag", "rev-2".into())], json!({"version":1,"state":"ready","paused":true,"rules":[],
        "repositoryRules":[{"id":"repo","text":"Repository rule","direction":"avoid"}]}).to_string());
    let (mut read_io, cap) = Io::captured("", io.cwd.clone(), io.env.clone());
    assert_eq!(taste::run(&["--focus=web".into()], &mut read_io), 0);
    let text = String::from_utf8_lossy(&cap.stdout.borrow()).to_string();
    assert!(text.starts_with("Your own taste is paused; these are this repository's rules.\n- Avoid: Repository rule\n"), "{text}");
    // A cache from a client that dropped `paused` fetches one full reply instead of trusting its ETag.
    let cached = account.home.join("taste-web.json");
    let mut old: Value = serde_json::from_slice(&std::fs::read(&cached).unwrap()).unwrap();
    old.as_object_mut().unwrap().remove("paused");
    std::fs::write(&cached, old.to_string()).unwrap();
    let (mut read_io, _cap) = Io::captured("", io.cwd.clone(), io.env.clone());
    assert_eq!(taste::run(&["--focus=web".into()], &mut read_io), 0);
    assert_eq!(fake.record.lock().unwrap().taste_reads.last().unwrap().1, None, "no ETag sent for an old cache");
    impeccable_account::logout(&io.env).unwrap();
    let (mut read_io, cap) = Io::captured("", io.cwd.clone(), io.env.clone());
    assert_eq!(taste::run(&[], &mut read_io), 1);
    assert!(String::from_utf8_lossy(&cap.stderr.borrow()).contains("impeccable login"));
    let (mut read_io, cap) = Io::captured("", io.cwd.clone(), io.env.clone());
    assert_eq!(taste::run(&["--focus=bad".into()], &mut read_io), 1);
    assert!(String::from_utf8_lossy(&cap.stderr.borrow()).contains("web, slides or motion"));
}
