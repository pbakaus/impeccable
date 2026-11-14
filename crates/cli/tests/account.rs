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
    // What a child needs from this process (Windows can't open a socket without
    // SystemRoot), unless the test chose its own.
    for key in ["PATH", "SystemRoot", "TEMP", "TMP"] {
        if let (false, Ok(v)) = (env.contains_key(key), std::env::var(key)) {
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

/// Signs in with `login --no-browser` (stdin is not a terminal) from `cwd` and returns
/// what followed the link on stdout, and stderr.
fn login_output(env: &std::collections::HashMap<String, String>, cwd: &std::path::Path) -> (String, String) {
    use std::io::Read;
    let mut child = impeccable(env, &["login", "--no-browser"])
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut stdout = BufReader::new(child.stdout.take().unwrap());
    let mut url = String::new();
    stdout.read_line(&mut url).unwrap();
    browser(url.trim());
    let mut rest = String::new();
    stdout.read_to_string(&mut rest).unwrap();
    let mut err = String::new();
    child.stderr.take().unwrap().read_to_string(&mut err).unwrap();
    assert!(child.wait().unwrap().success(), "{err}");
    (rest, err)
}

fn env_with_path(env: &std::collections::HashMap<String, String>) -> std::collections::HashMap<String, String> {
    let mut env = env.clone();
    env.entry("PATH".into()).or_insert_with(|| std::env::var("PATH").unwrap_or_default());
    env
}

#[cfg(target_os = "macos")]
#[test]
fn login_offers_loop_connect_only_when_loop_is_installed_and_an_agent_is_not_connected() {
    // Catches: `loop connect` staying a door of its own that nobody finds after signing in,
    // the offer showing on a machine without Loop, and login words leaking onto stdout.
    let fake = Fake::start();
    let mut env = fake.env("cli-login-loop");
    let home = std::path::PathBuf::from(&env["HOME"]);
    // A `claude` on PATH is all status needs to see the agent; it is never run.
    let bin = home.join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    let claude = bin.join("claude");
    std::fs::write(&claude, "#!/bin/sh\nexit 0\n").unwrap();
    std::fs::set_permissions(&claude, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();
    std::fs::create_dir_all(home.join(".claude")).unwrap();
    env.insert("PATH".into(), format!("{}:/usr/bin:/bin", bin.display()));

    let (out, err) = login_output(&env, &home);
    assert!(!err.contains("Loop"), "no Loop, no offer: {err}");
    assert_eq!(out, "", "stdout carries the link alone");

    let macos = home.join("Applications/Impeccable Loop.app/Contents/MacOS");
    std::fs::create_dir_all(&macos).unwrap();
    std::fs::write(macos.join("loop-hook"), "#!/bin/sh\nexit 0\n").unwrap();
    let (out, err) = login_output(&env, &home);
    assert!(
        err.contains("Loop is installed. Connect Claude Code to it: impeccable loop connect\n"),
        "{err}"
    );
    assert_eq!(out, "");
    // Not a terminal: nothing was connected.
    assert!(!home.join(".claude.json").exists());
}

const SETUP: &str = r#"{ "version": 1, "at": "2026-11-14T09:00:00Z",
  "person": { "name": "Ada", "login": "ada" }, "signIn": { "github": true, "google": false },
  "plan": { "tier": "free", "trialEndsAt": null },
  "projects": [{ "id": "p_3f9c", "name": "pristine", "current": true, "repository": null, "lastSeenAt": null, "on": { "agent": true, "pullRequests": false } }],
  "places": [
    { "kind": "agent", "state": "on", "count": 1, "lastSeenAt": null, "step": null },
    { "kind": "agent-tools", "state": "off", "count": 0, "lastSeenAt": null, "step": { "id": "add-agent-tools", "place": "agent-tools", "label": "Add to Claude Code", "url": null, "command": "claude mcp add" } },
    { "kind": "loop", "state": "off", "count": 0, "lastSeenAt": null, "step": { "id": "get-loop", "place": "loop", "label": "Get it for Mac", "url": "https://impeccable.style/loop", "command": null } },
    { "kind": "extension", "state": "needs-pro", "count": 0, "lastSeenAt": null, "step": { "id": "upgrade", "place": "extension", "label": "Get Pro", "url": "https://impeccable.style/pro", "command": null } },
    { "kind": "github", "state": "off", "count": 0, "lastSeenAt": null, "step": { "id": "add-github", "place": "github", "label": "Add to GitHub", "url": "https://github.com/apps/impeccable-critique/installations/new", "command": null } }
  ],
  "next": { "id": "add-github", "place": "github", "label": "Add to GitHub", "url": "https://github.com/apps/impeccable-critique/installations/new", "command": null } }"#;

#[test]
fn login_and_status_draw_the_services_setup_read_for_this_project() {
    // Catches: login ending on "Signed in" with no next step, status computing its own
    // next step, and the project key not reaching the service (or reaching it in a URL).
    let fake = Fake::start();
    let env = env_with_path(&fake.env("cli-setup"));
    let repo = std::path::PathBuf::from(&env["HOME"]).join("pristine");
    std::fs::create_dir_all(&repo).unwrap();
    let git = |args: &[&str]| {
        assert!(Command::new("git").args(args).current_dir(&repo).stdout(Stdio::null()).stderr(Stdio::null()).status().unwrap().success());
    };
    git(&["init", "-q"]);
    git(&["remote", "add", "origin", "git@github.com:ada/pristine.git"]);

    // Before the service offers the read: login still succeeds and says nothing more.
    let (_, err) = login_output(&env, &repo);
    assert!(!err.contains("Next:"), "{err}");
    let status = impeccable(&env, &["status"]).current_dir(&repo).output().unwrap();
    assert!(!status.status.success());
    assert!(String::from_utf8_lossy(&status.stderr).contains("doesn't offer it yet"));

    fake.route("GET", "/cli/v1/setup", 200, vec![("content-type", "application/json".into())], SETUP);
    let (out, err) = login_output(&env, &repo);
    assert_eq!(out, "", "stdout carries the link alone");
    assert!(err.contains(
        "Connected: Your agent.\n\
         Not connected yet: Agent tools, Loop, Chrome extension (Pro), GitHub pull requests.\n\
         Next: Add to GitHub: https://github.com/apps/impeccable-critique/installations/new\n"
    ), "{err}");

    let status = impeccable(&env, &["status"]).current_dir(&repo).output().unwrap();
    assert!(status.status.success());
    let text = String::from_utf8_lossy(&status.stdout);
    assert!(text.contains("This project: pristine.\n"), "{text}");
    assert!(text.ends_with("Next: Add to GitHub: https://github.com/apps/impeccable-critique/installations/new\n"), "{text}");

    let json = impeccable(&env, &["status", "--json"]).current_dir(&repo).output().unwrap();
    let v: serde_json::Value = serde_json::from_slice(&json.stdout).unwrap();
    assert_eq!(v["next"]["id"], "add-github");

    // Every read from the repository that named it used its one key, in the
    // header. Under load git can miss its deadline and the read goes without a
    // key, which is allowed; naming a different project is not.
    let seen = fake.record.lock().unwrap().setup_projects.clone();
    assert!(seen.len() >= 4, "{seen:?}");
    let keys: Vec<&String> = seen.iter().flatten().collect();
    let key = keys.first().expect("the project header").as_str();
    assert!(key.len() == 64 && key.bytes().all(|b| b.is_ascii_hexdigit()), "{key}");
    assert!(keys.iter().all(|k| k.as_str() == key), "{seen:?}");
}
