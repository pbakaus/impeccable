//! `impeccable login --no-browser`, `whoami` and `logout` as a script drives
//! them, against the fake account service.
#[path = "../../account/tests/support/fake.rs"]
mod fake;
use fake::{browser, Fake};
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};

fn impeccable(env: &std::collections::HashMap<String, String>, args: &[&str]) -> Command {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_impeccable"));
    cmd.args(args).env_clear().envs(env).stdin(Stdio::null());
    for key in ["PATH", "SystemRoot", "TEMP", "TMP"] {
        if let Ok(v) = std::env::var(key) {
            cmd.env(key, v);
        }
    }
    cmd
}

#[test]
fn a_script_signs_in_checks_and_signs_out() {
    // Catches: the non-interactive sign-in path (the rehearsal's) printing the link anywhere but alone on stdout.
    let fake = Fake::start();
    let env = fake.env("cli-login");
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

    let out = impeccable(&env, &["whoami", "--json"]).output().unwrap();
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(
        (v["signed_in"].as_bool(), v["pro"].as_bool()),
        (Some(true), Some(true))
    );

    assert!(impeccable(&env, &["logout"]).status().unwrap().success());
    let out = impeccable(&env, &["whoami", "--json"]).output().unwrap();
    assert!(!out.status.success());
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(v["signed_in"].as_bool(), Some(false));
}
