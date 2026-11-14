mod support;
use impeccable_account::{config::Account, login, setup};
use impeccable_common::Io;
use serde_json::json;
use std::{path::PathBuf, time::Duration};
use support::fake::{browser, Fake};

#[test]
fn setup_scope_projection_daily_limit_opt_out_and_forget() {
    let fake = Fake::start();
    fake.knobs.lock().unwrap().setup = true;
    let env = fake.env("setup-contract");
    login(&env, &mut |u| browser(u), Duration::from_secs(10)).unwrap();
    assert_eq!(
        fake.record.lock().unwrap().scopes[0],
        "account:read rules:read setup:write"
    );
    let (mut io, _) = Io::captured("", PathBuf::from(&env["IMPECCABLE_HOME"]), env.clone());
    let inventory = json!({"installations":[
        {"owner":"private-owner","harness":"claude"},
        {"owner":"impeccable-loop","harness":"claude","hooks":[{"event":"Stop","matcher":"private"},{"event":"private"}],"instruction":true,"mcpServers":["private"],"mcpApprovals":[],"resources":[{"state":"created"},{"state":"conflict"}]}
    ],"pendingTransactions":2});
    setup::report(
        &io,
        &inventory,
        "4.8.1",
        &json!({"claude":"4.8.1","private":"secret"}),
    );
    setup::report(&io, &inventory, "4.8.1", &json!({}));
    let all = fake.record.lock().unwrap().setups.clone();
    assert_eq!(all.len(), 1);
    let b = &all[0];
    assert!(!b.to_string().contains("private"));
    assert_eq!(b["otherInstallations"], 1);
    assert_eq!(b["installations"][0]["hooks"], json!(["Stop"]));
    assert_eq!(b["installations"][0]["mcpServers"], 1);
    assert_eq!(
        b["installations"][0]["resources"],
        json!({"created":1,"preexisting":0,"conflict":1})
    );
    assert_eq!(b["deviceKey"].as_str().unwrap().len(), 64);
    assert_eq!(setup::run(&["forget".into()], &mut io), 0);
    setup::report(&io, &inventory, "4.8.1", &json!({}));
    assert_eq!(fake.hits("/cli/v1/setup/forget"), 1);
    assert_eq!(fake.record.lock().unwrap().setups.len(), 1);
    assert!(!setup::wanted(&io));
    assert!(Account::from_env(&env).is_ok());
}

#[test]
fn setup_scope_is_optional_and_declined_scope_sends_nothing() {
    for (off, denied) in [(true, false), (false, true)] {
        let fake = Fake::start();
        {
            let mut k = fake.knobs.lock().unwrap();
            k.setup = !off;
            k.setup_denied = denied;
        }
        let env = fake.env(if off { "setup-off" } else { "setup-denied" });
        login(&env, &mut |u| browser(u), Duration::from_secs(10)).unwrap();
        let (io, _) = Io::captured("", PathBuf::from(&env["IMPECCABLE_HOME"]), env);
        setup::report(&io, &json!({}), "4.8.1", &json!({}));
        assert_eq!(fake.hits("/cli/v1/setup/reports"), 0);
        if off {
            assert_eq!(
                fake.record.lock().unwrap().scopes[0],
                "account:read rules:read"
            );
        }
    }
}

#[test]
fn setup_respects_opt_outs_corrupt_state_and_daily_retry_after_404() {
    let fake = Fake::start();
    fake.knobs.lock().unwrap().setup = true;
    let env = fake.env("setup-retry");
    login(&env, &mut |u| browser(u), Duration::from_secs(10)).unwrap();
    let (mut io, _) = Io::captured("", PathBuf::from(&env["IMPECCABLE_HOME"]), env);
    for k in ["CI", "DO_NOT_TRACK", "IMPECCABLE_NO_TELEMETRY"] {
        io.env.insert(k.into(), "1".into());
        assert!(!setup::wanted(&io));
        io.env.remove(k);
    }
    let state = io.cwd.join("setup.json");
    std::fs::write(&state, "{bad").unwrap();
    assert!(!setup::wanted(&io));
    std::fs::remove_file(&state).unwrap();
    let inventory = json!({"installations":[],"pendingTransactions":0});
    fake.knobs.lock().unwrap().setup = false;
    setup::report(&io, &inventory, "4.8.1", &json!({}));
    assert_eq!(fake.hits("/cli/v1/setup/reports"), 1);
    assert!(!setup::wanted(&io));
    let mut local: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&state).unwrap()).unwrap();
    let key = local["deviceKey"].clone();
    for t in local["attempts"].as_object_mut().unwrap().values_mut() {
        *t = json!(1);
    }
    std::fs::write(&state, local.to_string()).unwrap();
    fake.knobs.lock().unwrap().setup = true;
    setup::report(&io, &inventory, "4.8.1", &json!({}));
    let b = fake.record.lock().unwrap().setups[0].clone();
    assert_eq!(b["deviceKey"], key);
    let mut keys: Vec<_> = b.as_object().unwrap().keys().map(String::as_str).collect();
    keys.sort();
    assert_eq!(
        keys,
        vec![
            "cliVersion",
            "deviceKey",
            "engineVersion",
            "installations",
            "os",
            "otherInstallations",
            "pendingTransactions",
            "reportId",
            "reportedAt",
            "skills",
            "version"
        ]
    );
}

#[test]
fn off_succeeds_while_a_report_is_waiting_for_the_service() {
    let fake = Fake::start();
    fake.knobs.lock().unwrap().setup = true;
    let env = fake.env("setup-control-busy");
    login(&env, &mut |u| browser(u), Duration::from_secs(10)).unwrap();
    let gate = fake.hold("/cli/v1/setup/reports");
    let upload = {
        let env = env.clone();
        std::thread::spawn(move || {
            let (io, _) = Io::captured("", PathBuf::from(&env["IMPECCABLE_HOME"]), env);
            setup::report(
                &io,
                &json!({"installations":[],"pendingTransactions":0}),
                "4.8.1",
                &json!({}),
            );
        })
    };
    fake.wait_for_hits("/cli/v1/setup/reports", 1);
    let (mut io, _) = Io::captured("", PathBuf::from(&env["IMPECCABLE_HOME"]), env);
    let start = std::time::Instant::now();
    let result = setup::run(&["off".into()], &mut io);
    gate.open();
    upload.join().unwrap();
    assert_eq!(result, 0, "off must save while the network is busy");
    assert!(start.elapsed() < Duration::from_secs(2));
    assert!(!setup::wanted(&io));
}

#[test]
fn a_claim_precedes_inventory_and_never_borrows_a_replacement_sign_in() {
    let fake = Fake::start();
    fake.knobs.lock().unwrap().setup = true;
    let env = fake.env("setup-bound-claim");
    login(&env, &mut |u| browser(u), Duration::from_secs(10)).unwrap();
    let (mut io, _) = Io::captured("", PathBuf::from(&env["IMPECCABLE_HOME"]), env.clone());
    let old = setup::begin(&io).expect("claim before inventory");
    assert!(
        !setup::wanted(&io),
        "even a hung inventory cannot spawn more workers"
    );
    assert!(setup::begin(&io).is_none());
    fake.knobs.lock().unwrap().setup_denied = true;
    login(&env, &mut |u| browser(u), Duration::from_secs(10)).unwrap();
    old.report(
        &io,
        &json!({"installations":[],"pendingTransactions":0}),
        "4.8.1",
        &json!({}),
    );
    assert_eq!(
        fake.hits("/cli/v1/setup/reports"),
        0,
        "no token from the declined sign-in"
    );
    fake.knobs.lock().unwrap().setup_denied = false;
    login(&env, &mut |u| browser(u), Duration::from_secs(10)).unwrap();
    let cancelled = setup::begin(&io).unwrap();
    assert_eq!(setup::run(&["off".into()], &mut io), 0);
    assert_eq!(setup::run(&["on".into()], &mut io), 0);
    cancelled.report(
        &io,
        &json!({"installations":[],"pendingTransactions":0}),
        "4.8.1",
        &json!({}),
    );
    assert_eq!(
        fake.hits("/cli/v1/setup/reports"),
        0,
        "an old claim stays cancelled after re-enabling"
    );
}
