//! The open binary hands scans to a verified Pro build, and only scans, and
//! never from inside a Pro child.
#![cfg(unix)]
#[path = "../../account/tests/support/fake.rs"]
mod fake;
use fake::*;
use impeccable_account::{config::Account, login, pro};
use std::process::{Command, Stdio};

/// A stand-in Pro build: says who ran it.
const PRO: &[u8] = b"#!/bin/sh\necho \"pro-child:$IMPECCABLE_PRO_CHILD $*\"\n";

fn run(
    env: &std::collections::HashMap<String, String>,
    extra: &[(&str, &str)],
    args: &[&str],
) -> (String, String) {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_impeccable"));
    cmd.args(args)
        .env_clear()
        .envs(env)
        .envs(extra.iter().copied())
        .stdin(Stdio::null());
    if let Ok(path) = std::env::var("PATH") {
        cmd.env("PATH", path);
    }
    let out = cmd.output().unwrap();
    (
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

#[test]
fn scans_dispatch_to_the_pro_build_except_where_guarded() {
    // Catches: a Pro child re-dispatching (a loop), $IMPECCABLE_BIN losing precedence, non-scan verbs dispatching.
    let fake = Fake::start();
    let mut env = fake.env("dispatch");
    login(
        &env,
        &mut |url| browser(url),
        std::time::Duration::from_secs(10),
    )
    .unwrap();
    let release = keypair();
    let lease_key = keypair();
    env.insert(
        "IMPECCABLE_PRO_RELEASE_KEYS".into(),
        release_keys_json("r1", &release),
    );
    fake.lease_keys(&[("l1", &lease_key)]);
    let sha = fake.publish("r1", &release, PRO, 1);
    fake.lease("l1", &lease_key, &sha, unix_now() + 6 * 86400);
    let account = Account::from_env(&env).unwrap();
    let keys = pro::verify::pinned_keys(&env);
    assert!(matches!(
        pro::refresh(&account, &keys),
        pro::Refreshed::Ready { .. }
    ));

    let target = account.home.join("page.html");
    std::fs::write(&target, "<p>hi</p>").unwrap();
    let target = target.to_string_lossy().into_owned();
    let (out, _) = run(&env, &[], &["detect", &target]);
    assert_eq!(out.trim(), format!("pro-child:1 detect {target}"));
    for (guard, value) in [
        ("IMPECCABLE_PRO_CHILD", "1"),
        ("IMPECCABLE_BIN", "/elsewhere/impeccable"),
        ("IMPECCABLE_PRO", "off"),
    ] {
        let (out, _) = run(&env, &[(guard, value)], &["detect", &target]);
        assert!(!out.contains("pro-child"), "{guard}: {out}");
    }
    let (out, _) = run(&env, &[], &["whoami"]);
    assert!(
        !out.contains("pro-child") && out.contains("Signed in"),
        "{out}"
    );
}

#[test]
fn without_a_sign_in_scans_run_the_open_engine_silently() {
    // Catches: open-source users (never signed in) seeing any change in a scan's output.
    let fake = Fake::start();
    let env = fake.env("no-sign-in");
    let target = std::path::Path::new(&env["IMPECCABLE_HOME"]).join("page.html");
    std::fs::write(&target, "<p>hi</p>").unwrap();
    let (out, err) = run(&env, &[], &["detect", "--json", &target.to_string_lossy()]);
    assert!(
        !out.contains("pro-child") && !err.contains("Pro rules"),
        "{out}{err}"
    );
}
