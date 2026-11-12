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

#[test]
fn whoami_shows_what_the_plan_includes_and_falls_back_without_the_catalog() {
    // Catches: whoami failing or going quiet when the public plan catalog is off (404), and the catalog's items not reaching the person.
    let fake = Fake::start();
    let env = fake.env("cli-plans");
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

    // The catalog is off: today's line.
    let out = impeccable(&env, &["whoami"]).output().unwrap();
    assert!(out.status.success());
    let text = String::from_utf8_lossy(&out.stdout);
    assert!(text.contains("Pro rules: included."), "{text}");
    // The account is named, and a non-production service shows its host.
    assert!(text.starts_with("Signed in to Impeccable (127.0.0.1:"), "{text}");
    // Pro gets no pricing pointer; an account without Pro gets the one live page (launch CTA audit).
    assert!(!text.contains("impeccable.style/pricing"), "{text}");
    fake.knobs.lock().unwrap().entitled = false;
    let out = impeccable(&env, &["whoami"]).output().unwrap();
    let free = String::from_utf8_lossy(&out.stdout);
    assert!(free.ends_with("See impeccable.style/pricing\n"), "{free}");
    fake.knobs.lock().unwrap().entitled = true;

    let catalog = serde_json::json!({
        "plans": [
            { "id": "free", "name": "Free", "builds": null, "adds": [{ "text": "The skill" }] },
            { "id": "pro", "name": "Pro", "builds": "free", "adds": [
                { "text": "Detector Pro: dozens of extra rules in your CLI" },
                { "text": "Live++", "soon": true },
            ] },
        ],
        "start": { "signIn": "npx impeccable login", "pricing": "https://impeccable.style/pricing" },
    });
    fake.route(
        "GET",
        "/v1/plans",
        200,
        vec![("content-type", "application/json".into())],
        catalog.to_string(),
    );
    let out = impeccable(&env, &["whoami"]).output().unwrap();
    assert!(out.status.success());
    let text = String::from_utf8_lossy(&out.stdout);
    assert!(
        text.contains("Plan: Pro. Everything in Free, plus:\n")
            && text.contains("  - Detector Pro: dozens of extra rules in your CLI\n")
            && text.contains("  - Live++ (soon)\n")
            && !text.contains("Pro rules"),
        "{text}"
    );
    let out = impeccable(&env, &["whoami", "--json"]).output().unwrap();
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(v["pro"].as_bool(), Some(true));
    assert_eq!(v["plan"]["id"], "pro");
    assert_eq!(
        v["plan"]["adds"][1],
        serde_json::json!({ "text": "Live++", "soon": true })
    );

    // Not entitled reads the Free plan.
    fake.knobs.lock().unwrap().entitled = false;
    let out = impeccable(&env, &["whoami"]).output().unwrap();
    let text = String::from_utf8_lossy(&out.stdout);
    assert!(
        text.contains("Plan: Free. Includes:\n  - The skill\n"),
        "{text}"
    );

    // A plan the entitlement names wins over the pro flag (Team, later).
    fake.route(
        "GET",
        "/cli/v1/entitlement",
        200,
        vec![("content-type", "application/json".into())],
        r#"{"pro":true,"reason":"operator","plan":"free"}"#,
    );
    let out = impeccable(&env, &["whoami"]).output().unwrap();
    let text = String::from_utf8_lossy(&out.stdout);
    assert!(text.contains("Plan: Free."), "{text}");
}

#[test]
#[cfg(target_os = "macos")]
fn a_home_without_a_keychain_says_why_sign_in_failed_and_how_out() {
    // Catches: "Sign-in failed: keychain write failed (-60006)." A HOME with no
    // keychain (SSH, a changed HOME, the launch smoke test) must name the cause
    // and the file store. Measured on macOS: such a HOME answers -60006.
    let fake = Fake::start();
    let mut env = fake.env("cli-login-no-keychain");
    env.remove("IMPECCABLE_CREDENTIAL_STORE");
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
    let out = child.wait_with_output().unwrap();
    // Whatever happened, leave no sign-in behind (a keychain item included).
    impeccable(&env, &["logout"]).output().unwrap();
    let err = String::from_utf8_lossy(&out.stderr);
    assert!(!out.status.success(), "{err}");
    assert!(
        err.contains("Sign-in failed: macOS wouldn't let the CLI write its keychain here"),
        "{err}"
    );
    assert!(
        err.contains("run: IMPECCABLE_CREDENTIAL_STORE=file impeccable login."),
        "{err}"
    );
}
