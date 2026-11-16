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
    let mut env = fake.env("cli-login");
    env.insert("IMPECCABLE_NO_UPDATE_CHECK".into(), "1".into());
    // init's sign-in line reads `context`'s account line instead of a whoami call.
    let project = std::path::PathBuf::from(&env["IMPECCABLE_HOME"]).join("project");
    std::fs::create_dir_all(&project).unwrap();
    let account_line = || {
        let out = impeccable(&env, &["context"]).current_dir(&project).output().unwrap();
        String::from_utf8_lossy(&out.stdout).lines().filter(|l| l.starts_with("ACCOUNT:")).collect::<Vec<_>>().join("|")
    };
    assert_eq!(account_line(), "ACCOUNT: not signed in");
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
    assert_eq!(account_line(), "ACCOUNT: signed in");

    assert!(impeccable(&env, &["logout"]).status().unwrap().success());
    let out = impeccable(&env, &["whoami", "--json"]).output().unwrap();
    assert!(!out.status.success());
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(v["signed_in"].as_bool(), Some(false));
}

#[test]
fn login_when_signed_in_opens_nothing_unless_forced() {
    // Catches: onboarding sending a signed-in person through the browser again, and a script waiting on a link that never comes.
    let fake = Fake::start();
    let env = fake.env("cli-login-again");
    let sign_in = |args: &[&str]| {
        let mut child = impeccable(&env, args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let mut url = String::new();
        BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut url)
            .unwrap();
        assert!(url.starts_with("http"), "a link on stdout: {url:?}");
        browser(url.trim());
        assert!(child.wait().unwrap().success());
    };
    sign_in(&["login", "--no-browser"]);
    let out = impeccable(&env, &["login", "--no-browser"]).output().unwrap();
    assert!(out.status.success());
    assert!(out.stdout.is_empty(), "no link");
    assert!(String::from_utf8_lossy(&out.stderr).contains("Already signed in"), "{}", String::from_utf8_lossy(&out.stderr));
    // `--force` signs in again.
    sign_in(&["login", "--no-browser", "--force"]);
}

#[test]
fn login_skips_when_the_sign_in_holds_every_scope_the_service_offers() {
    // Catches (#1465 review): a scope that a sign-in is granted but `holds` never sees
    // (setup's grant file, worlds in the token's scopes), so every `login` reopens the browser.
    let fake = Fake::start();
    {
        let mut k = fake.knobs.lock().unwrap();
        (k.health, k.setup, k.taste, k.foundations, k.design, k.critiques, k.worlds) = (true, true, true, true, true, true, true);
    }
    let env = fake.env("cli-login-all-scopes");
    let mut child = impeccable(&env, &["login", "--no-browser"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut url = String::new();
    BufReader::new(child.stdout.take().unwrap()).read_line(&mut url).unwrap();
    browser(url.trim());
    assert!(child.wait().unwrap().success());
    let out = impeccable(&env, &["login", "--no-browser"]).output().unwrap();
    assert!(out.status.success());
    assert!(out.stdout.is_empty(), "no link: {}", String::from_utf8_lossy(&out.stdout));
    assert!(String::from_utf8_lossy(&out.stderr).contains("Already signed in"), "{}", String::from_utf8_lossy(&out.stderr));
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
    // `--force`: each call is a browser sign-in, also when an earlier one is stored.
    let mut child = impeccable(env, &["login", "--no-browser", "--force"])
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

#[test]
fn the_repo_settings_pages_switches_reach_the_rule_file_and_a_files_change_goes_back() {
    // Catches (REN-2056): the page's personal switches never reaching the agent's rule
    // file, a first sync wiping the lines a machine already had, or a line turned on
    // here being undone by the next sync instead of sent to the page.
    let fake = Fake::start();
    let mut env = fake.env("switch-sync");
    env.insert("IMPECCABLE_NO_UPDATE_CHECK".into(), "1".into());
    let home = std::path::PathBuf::from(&env["HOME"]);
    let project = home.join("site");
    std::fs::create_dir_all(&project).unwrap();
    let git = |args: &[&str]| assert!(Command::new("git").args(args).current_dir(&project).output().unwrap().status.success());
    git(&["init", "-q"]);
    git(&["remote", "add", "origin", "https://github.com/acme/site.git"]);
    let mut child = impeccable(&env, &["login", "--no-browser"]).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    let mut url = String::new();
    BufReader::new(child.stdout.take().unwrap()).read_line(&mut url).unwrap();
    browser(url.trim());
    assert!(child.wait().unwrap().success());
    let claude_md = home.join(".claude/CLAUDE.md");
    std::fs::create_dir_all(claude_md.parent().unwrap()).unwrap();
    std::fs::write(&claude_md, "# mine\n").unwrap();
    let refresh = || assert!(impeccable(&env, &["switches-refresh"]).current_dir(&project).status().unwrap().success());
    let on = || {
        let out = impeccable(&env, &["switches"]).output().unwrap();
        String::from_utf8_lossy(&out.stdout).lines().find(|l| l.starts_with("Claude Code")).unwrap_or_default().to_string()
    };
    let agents = |me: &str| fake.route("GET", "/cli/v1/agents", 200, vec![], format!(r#"{{"rev":1,"team":null,"me":{me}}}"#));
    fake.route("POST", "/cli/v1/agents/me", 200, vec![], r#"{"outcome":"set","rev":2,"team":null,"me":[]}"#);

    // Nothing set anywhere: nothing written, nothing sent.
    agents("null");
    refresh();
    assert_eq!(std::fs::read_to_string(&claude_md).unwrap(), "# mine\n");
    assert_eq!(fake.hits("/cli/v1/agents/me"), 0);
    // The page sets taste and a11y: they reach the file.
    agents(r#"["taste","a11y"]"#);
    refresh();
    assert!(on().ends_with(": taste, a11y"), "{}", on());
    assert!(std::fs::read_to_string(&claude_md).unwrap().starts_with("# mine\n\n<!-- impeccable start -->\n"));
    // A line turned on here (as loop connect does) is sent, not undone.
    let t = std::fs::read_to_string(&claude_md).unwrap();
    let loop_line = "When you need a person's decision or input, use needs_you.post (Impeccable) instead of asking in chat or a built-in question tool. If needs_you says Loop isn't connected, ask normally.";
    std::fs::write(&claude_md, t.replace("<!-- impeccable end -->", &format!("{loop_line}\n<!-- impeccable end -->"))).unwrap();
    refresh();
    assert_eq!(fake.hits("/cli/v1/agents/me"), 1);
    assert!(on().ends_with(": taste, loop, a11y"), "{}", on());
    // The page turns everything off: the block goes, the person's bytes stay.
    agents("[]");
    refresh();
    assert_eq!(std::fs::read_to_string(&claude_md).unwrap(), "# mine\n");
}

#[test]
fn two_agents_files_settle_on_one_set_a_failed_send_is_retried_and_an_unreadable_file_sends_nothing() {
    // Catches (review): Claude's and Codex's files pushing the page back and forth, a
    // failed upload dropping the change it carried, and a file the worker couldn't read
    // being sent as "every switch off".
    let fake = Fake::start();
    let mut env = fake.env("switch-sync-two");
    env.insert("IMPECCABLE_NO_UPDATE_CHECK".into(), "1".into());
    let home = std::path::PathBuf::from(&env["HOME"]);
    let project = home.join("site");
    std::fs::create_dir_all(&project).unwrap();
    let git = |args: &[&str]| assert!(Command::new("git").args(args).current_dir(&project).output().unwrap().status.success());
    git(&["init", "-q"]);
    git(&["remote", "add", "origin", "https://github.com/acme/site.git"]);
    let mut child = impeccable(&env, &["login", "--no-browser"]).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    let mut url = String::new();
    BufReader::new(child.stdout.take().unwrap()).read_line(&mut url).unwrap();
    browser(url.trim());
    assert!(child.wait().unwrap().success());
    let (claude, codex) = (home.join(".claude/CLAUDE.md"), home.join(".codex/AGENTS.md"));
    for f in [&claude, &codex] {
        std::fs::create_dir_all(f.parent().unwrap()).unwrap();
    }
    let refresh = || assert!(impeccable(&env, &["switches-refresh"]).current_dir(&project).status().unwrap().success());
    let lines = |f: &std::path::Path| std::fs::read_to_string(f).unwrap_or_default();
    let loop_line = "When you need a person's decision or input, use needs_you.post (Impeccable)";
    let taste_page = r#"{"rev":1,"team":null,"me":["taste"]}"#;
    fake.route("GET", "/cli/v1/agents", 200, vec![], taste_page);
    refresh();
    assert!(lines(&claude).contains("Impeccable Taste") && lines(&codex).contains("Impeccable Taste"));

    // Claude's file turns loop on, but the send fails: nothing is lost.
    let t = lines(&claude).replace("<!-- impeccable end -->", &format!("{loop_line} instead of asking in chat or a built-in question tool. If needs_you says Loop isn't connected, ask normally.\n<!-- impeccable end -->"));
    std::fs::write(&claude, t).unwrap();
    fake.route("POST", "/cli/v1/agents/me", 500, vec![], "{}");
    refresh();
    assert!(lines(&claude).contains(loop_line), "the unsent change stays: {}", lines(&claude));
    // The send works next time; then both files carry the set and nothing is sent again.
    fake.route("POST", "/cli/v1/agents/me", 200, vec![], r#"{"outcome":"set","rev":2,"team":null,"me":["taste","loop"]}"#);
    let before = fake.hits("/cli/v1/agents/me");
    refresh();
    assert_eq!(fake.hits("/cli/v1/agents/me"), before + 1);
    assert!(lines(&codex).contains(loop_line), "{}", lines(&codex));
    fake.route("GET", "/cli/v1/agents", 200, vec![], r#"{"rev":2,"team":null,"me":["taste","loop"]}"#);
    refresh();
    refresh();
    assert_eq!(fake.hits("/cli/v1/agents/me"), before + 1, "settled: no back and forth");

    // A file the worker can't read sends nothing and changes nothing.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&claude, std::fs::Permissions::from_mode(0o000)).unwrap();
        refresh();
        std::fs::set_permissions(&claude, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert_eq!(fake.hits("/cli/v1/agents/me"), before + 1);
        assert!(lines(&codex).contains(loop_line));
    }
}

#[test]
fn personal_switches_reach_gemini_copilot_and_an_existing_opencode_file_and_create_no_other() {
    // Catches (REN-2056): switches reaching only Claude Code and Codex, and a sync that
    // creates opencode's global AGENTS.md, which would turn off opencode's fallback to
    // the person's ~/.claude/CLAUDE.md.
    let fake = Fake::start();
    let mut env = fake.env("switch-harnesses");
    env.insert("IMPECCABLE_NO_UPDATE_CHECK".into(), "1".into());
    let home = std::path::PathBuf::from(&env["HOME"]);
    let project = home.join("site");
    std::fs::create_dir_all(&project).unwrap();
    let git = |args: &[&str]| assert!(Command::new("git").args(args).current_dir(&project).output().unwrap().status.success());
    git(&["init", "-q"]);
    git(&["remote", "add", "origin", "https://github.com/acme/site.git"]);
    let mut child = impeccable(&env, &["login", "--no-browser"]).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    let mut url = String::new();
    BufReader::new(child.stdout.take().unwrap()).read_line(&mut url).unwrap();
    browser(url.trim());
    assert!(child.wait().unwrap().success());
    for d in [".gemini", ".copilot", ".config/opencode"] {
        std::fs::create_dir_all(home.join(d)).unwrap();
    }
    let (gemini, copilot, opencode) = (
        home.join(".gemini/GEMINI.md"),
        home.join(".copilot/copilot-instructions.md"),
        home.join(".config/opencode/AGENTS.md"),
    );
    let refresh = || assert!(impeccable(&env, &["switches-refresh"]).current_dir(&project).status().unwrap().success());
    let read = |f: &std::path::Path| std::fs::read_to_string(f).unwrap_or_default();
    fake.route("GET", "/cli/v1/agents", 200, vec![], r#"{"rev":1,"team":null,"me":["taste"]}"#);
    refresh();
    for f in [&gemini, &copilot] {
        assert!(read(f).contains("<!-- impeccable start -->\nImpeccable Taste"), "{}: {}", f.display(), read(f));
    }
    assert!(!opencode.exists(), "opencode's file is never created");
    assert!(!home.join(".claude/CLAUDE.md").exists() && !home.join(".codex").exists());
    // Once the person has an opencode file, it gets the block too.
    std::fs::write(&opencode, "Mine.\n").unwrap();
    fake.route("GET", "/cli/v1/agents", 200, vec![], r#"{"rev":2,"team":null,"me":["taste","a11y"]}"#);
    refresh();
    assert!(read(&opencode).starts_with("Mine.\n\n<!-- impeccable start -->\n"), "{}", read(&opencode));
    let out = impeccable(&env, &["switches"]).output().unwrap();
    let listed = String::from_utf8_lossy(&out.stdout).replace('\\', "/");
    for name in ["Gemini CLI (~/.gemini/GEMINI.md): taste, a11y", "GitHub Copilot (~/.copilot/copilot-instructions.md): taste, a11y", "opencode (~/.config/opencode/AGENTS.md): taste, a11y"] {
        assert!(listed.contains(name), "{listed}");
    }
}

#[test]
fn an_agent_installed_after_the_first_sync_gets_the_saved_set_and_sends_nothing() {
    // Catches (review): a newly installed agent's rule file, with no block yet, read as
    // "every switch off" and sent to the page, wiping the person's switches everywhere.
    let fake = Fake::start();
    let mut env = fake.env("switch-new-agent");
    env.insert("IMPECCABLE_NO_UPDATE_CHECK".into(), "1".into());
    let home = std::path::PathBuf::from(&env["HOME"]);
    let project = home.join("site");
    std::fs::create_dir_all(&project).unwrap();
    let git = |args: &[&str]| assert!(Command::new("git").args(args).current_dir(&project).output().unwrap().status.success());
    git(&["init", "-q"]);
    git(&["remote", "add", "origin", "https://github.com/acme/site.git"]);
    let mut child = impeccable(&env, &["login", "--no-browser"]).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    let mut url = String::new();
    BufReader::new(child.stdout.take().unwrap()).read_line(&mut url).unwrap();
    browser(url.trim());
    assert!(child.wait().unwrap().success());
    std::fs::create_dir_all(home.join(".claude")).unwrap();
    let refresh = || assert!(impeccable(&env, &["switches-refresh"]).current_dir(&project).status().unwrap().success());
    fake.route("GET", "/cli/v1/agents", 200, vec![], r#"{"rev":1,"team":null,"me":["taste"]}"#);
    fake.route("POST", "/cli/v1/agents/me", 200, vec![], r#"{"outcome":"set","rev":2,"team":null,"me":[]}"#);
    refresh();
    // Gemini arrives later, with a GEMINI.md of the person's own and no block.
    std::fs::create_dir_all(home.join(".gemini")).unwrap();
    std::fs::write(home.join(".gemini/GEMINI.md"), "Mine.\n").unwrap();
    refresh();
    assert_eq!(fake.hits("/cli/v1/agents/me"), 0, "nothing sent");
    let claude = std::fs::read_to_string(home.join(".claude/CLAUDE.md")).unwrap();
    let gemini = std::fs::read_to_string(home.join(".gemini/GEMINI.md")).unwrap();
    assert!(claude.contains("Impeccable Taste"), "{claude}");
    assert!(gemini.starts_with("Mine.\n\n<!-- impeccable start -->\nImpeccable Taste"), "{gemini}");
    // Turning the last switch off in a synced file (the block goes) is sent, not undone.
    for f in [home.join(".claude/CLAUDE.md"), home.join(".gemini/GEMINI.md")] {
        let t = std::fs::read_to_string(&f).unwrap();
        let a = t.find("<!-- impeccable start -->").unwrap();
        let e = t.find("<!-- impeccable end -->").unwrap() + "<!-- impeccable end -->".len();
        std::fs::write(&f, format!("{}{}", t[..a].trim_end_matches('\n'), &t[e..])).unwrap();
    }
    refresh();
    assert_eq!(fake.hits("/cli/v1/agents/me"), 1, "the removal was sent");
    assert!(!std::fs::read_to_string(home.join(".claude/CLAUDE.md")).unwrap().contains("Impeccable Taste"));
    // Gemini removed, a sync without it, then installed again fresh: it gets the saved
    // set and nothing is sent.
    fake.route("GET", "/cli/v1/agents", 200, vec![], r#"{"rev":3,"team":null,"me":["taste"]}"#);
    refresh();
    std::fs::remove_dir_all(home.join(".gemini")).unwrap();
    refresh();
    std::fs::create_dir_all(home.join(".gemini")).unwrap();
    refresh();
    assert_eq!(fake.hits("/cli/v1/agents/me"), 1, "nothing more sent");
    assert!(std::fs::read_to_string(home.join(".gemini/GEMINI.md")).unwrap().contains("Impeccable Taste"));
    // A sync under another CLAUDE_CONFIG_DIR profile keeps the first profile remembered,
    // so removing its last switch later is still sent.
    let mut other = env.clone();
    let profile_b = home.join("claude-b");
    std::fs::create_dir_all(&profile_b).unwrap();
    other.insert("CLAUDE_CONFIG_DIR".into(), profile_b.to_string_lossy().into_owned());
    assert!(impeccable(&other, &["switches-refresh"]).current_dir(&project).status().unwrap().success());
    let a = home.join(".claude/CLAUDE.md");
    let t = std::fs::read_to_string(&a).unwrap();
    let (s0, e0) = (t.find("<!-- impeccable start -->").unwrap(), t.find("<!-- impeccable end -->").unwrap() + "<!-- impeccable end -->".len());
    std::fs::write(&a, format!("{}{}", t[..s0].trim_end_matches('\n'), &t[e0..])).unwrap();
    refresh();
    assert_eq!(fake.hits("/cli/v1/agents/me"), 2, "profile A's removal was sent");
}
