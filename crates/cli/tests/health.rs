//! Design health (REN-1559) end to end: `login` asking for `health:write`
//! only where it's offered, a full `detect` of a git repo uploading a body
//! the service accepts, every other scan uploading nothing, and the upload
//! never changing what detect prints or its exit code.
#[path = "../../account/tests/support/fake.rs"]
mod fake;
use fake::{browser, Fake};
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};

fn impeccable(env: &HashMap<String, String>, cwd: &Path, args: &[&str]) -> Command {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_impeccable"));
    cmd.args(args)
        .current_dir(cwd)
        .env_clear()
        .envs(env)
        .stdin(Stdio::null());
    for key in ["PATH", "SystemRoot", "TEMP", "TMP"] {
        if let Ok(v) = std::env::var(key) {
            cmd.env(key, v);
        }
    }
    cmd
}

fn login(env: &HashMap<String, String>) {
    let mut child = impeccable(env, Path::new(&env["IMPECCABLE_HOME"]), &["login", "--no-browser"])
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
}

fn git(dir: &Path, args: &[&str]) {
    let ok = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .unwrap()
        .success();
    assert!(ok, "git {args:?}");
}

/// A git repo with two plain findings and one advisory one at the top, and
/// one more file in `sub/`.
fn repo(env: &HashMap<String, String>, remote: Option<&str>) -> PathBuf {
    let root = Path::new(&env["IMPECCABLE_HOME"]).join("work").join("my-site");
    std::fs::create_dir_all(root.join("sub")).unwrap();
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/antipatterns");
    for f in ["border-accent-blank-lines.css", "em-dash-prose-list.html", "cream-palette.html"] {
        std::fs::copy(fixtures.join(f), root.join(f)).unwrap();
    }
    std::fs::copy(fixtures.join("cream-palette.html"), root.join("sub/cream.html")).unwrap();
    git(&root, &["init", "-q", "-b", "main"]);
    if let Some(r) = remote {
        git(&root, &["remote", "add", "origin", r]);
    }
    root.canonicalize().unwrap()
}

fn signed_in(name: &str) -> (Fake, HashMap<String, String>) {
    let fake = Fake::start();
    fake.knobs.lock().unwrap().health = true;
    let env = fake.env(name);
    login(&env);
    (fake, env)
}

fn scans(fake: &Fake) -> Vec<serde_json::Value> {
    let r = fake.record.lock().unwrap();
    assert!(r.refused.is_empty(), "the service refused: {:?}", r.refused);
    r.scans.clone()
}

fn run(env: &HashMap<String, String>, cwd: &Path, args: &[&str]) -> Output {
    impeccable(env, cwd, args).output().unwrap()
}

#[test]
fn sign_in_asks_for_health_write_only_where_the_service_offers_it() {
    // Catches: production sign-in failing with invalid_scope while design health is off there.
    let fake = Fake::start();
    let env = fake.env("health-scope-off");
    login(&env);
    fake.knobs.lock().unwrap().health = true;
    let env = fake.env("health-scope-on");
    login(&env);
    assert_eq!(
        fake.record.lock().unwrap().scopes,
        vec!["account:read rules:read", "account:read rules:read health:write"]
    );
}

#[test]
fn a_full_scan_uploads_counts_the_service_accepts_and_detect_is_unchanged() {
    // Catches: a body the service refuses, a path or snippet in it, and the upload changing detect's stdout or exit code.
    let (fake, env) = signed_in("health-full");
    let root = repo(&env, Some("git@GitHub.com:acme/my-site.git"));

    let first = run(&env, &root, &["detect", "--json", "."]);
    let body = scans(&fake).pop().expect("one upload");
    assert_eq!(body["coverage"], "full");
    // The repo's name from its remote, never the folder's (Paul, REN-1553, 10 Nov).
    assert_eq!(body["label"], "my-site", "{body}");
    assert_eq!(body["filesScanned"], 4);
    assert!(body["findings"].as_u64().unwrap() >= 2, "{body}");
    assert!(body["advisory"].as_u64().unwrap() >= 1, "{body}");
    assert_eq!(
        body["repoKey"].as_str().unwrap(),
        format!("{:x}", <sha2::Sha256 as sha2::Digest>::digest(b"https://github.com/acme/my-site"))
    );
    let text = body.to_string();
    for leak in ["sub/", ".html", ".css", "acme", "github", "/my-site"] {
        assert!(!text.contains(leak), "{leak} in {text}");
    }

    // The same scan, by absolute path: the same repo, stream, ruleset and fingerprints.
    run(&env, &root, &["detect", "--json", &root.to_string_lossy()]);
    let again = scans(&fake).pop().unwrap();
    for k in ["repoKey", "streamKey", "rulesetId", "fingerprints", "rules"] {
        assert_eq!(body[k], again[k], "{k}");
    }
    assert_ne!(body["scanId"], again["scanId"]);

    // What detect prints and its exit code are the same whatever the service does.
    for (on, denied) in [(false, false), (true, true)] {
        {
            let mut k = fake.knobs.lock().unwrap();
            k.health = on;
            k.health_denied = denied;
        }
        let out = run(&env, &root, &["detect", "--json", "."]);
        assert_eq!(out.stdout, first.stdout, "health={on} denied={denied}");
        assert_eq!(out.status.code(), first.status.code());
    }
}

#[test]
fn only_a_whole_repo_scan_uploads() {
    // Catches: a subdirectory, a file, a scoped run, piped input or a scan from inside the repo counting as the whole repo's health.
    let (fake, env) = signed_in("health-partial");
    let root = repo(&env, Some("https://github.com/acme/my-site"));
    for (cwd, args) in [
        (root.clone(), vec!["detect", "--json", "sub"]),
        (root.clone(), vec!["detect", "--json", "cream-palette.html"]),
        (root.clone(), vec!["detect", "--json", "--scope", "layout", "."]),
        (root.clone(), vec!["detect", "--json", ".", "sub"]),
        (root.clone(), vec!["detect", "--json"]),
        (root.join("sub"), vec!["detect", "--json", "."]),
        (root.clone(), vec!["hook-before-edit"]),
    ] {
        run(&env, &cwd, &args);
        assert_eq!(fake.hits("/cli/v1/health/scans"), 0, "{args:?} in {cwd:?}");
    }
    // A directory that isn't a git repo at all.
    let plain = Path::new(&env["IMPECCABLE_HOME"]).join("plain");
    std::fs::create_dir_all(&plain).unwrap();
    std::fs::copy(root.join("cream-palette.html"), plain.join("c.html")).unwrap();
    run(&env, &plain, &["detect", "--json", "."]);
    assert_eq!(fake.hits("/cli/v1/health/scans"), 0, "not a repo");
    // The control: the whole repo does upload.
    run(&env, &root, &["detect", "--json", "."]);
    assert_eq!(fake.hits("/cli/v1/health/scans"), 1);
}

#[test]
fn ci_telemetry_opt_outs_and_sync_off_send_nothing() {
    // Catches: pipelines or people who opted out of telemetry uploading scan results.
    let (fake, env) = signed_in("health-optout");
    let root = repo(&env, Some("https://github.com/acme/my-site"));
    let quiet = run(&env, &root, &["detect", "."]);
    for (k, v) in [("CI", "true"), ("DO_NOT_TRACK", "1"), ("IMPECCABLE_NO_TELEMETRY", "1")] {
        let mut e = env.clone();
        e.insert(k.into(), v.into());
        run(&e, &root, &["detect", "--json", "."]);
        assert_eq!(fake.hits("/cli/v1/health/scans"), 1, "{k}");
    }
    assert!(run(&env, &root, &["health", "off"]).status.success());
    let out = run(&env, &root, &["detect", "."]);
    assert_eq!(fake.hits("/cli/v1/health/scans"), 1, "sync off");
    assert!(!String::from_utf8_lossy(&out.stderr).contains("Design health"));
    // The first upload (above) said so once; a second never does.
    assert!(String::from_utf8_lossy(&quiet.stderr).contains("Design health: this scan's counts were saved"));
    assert!(run(&env, &root, &["health", "on"]).status.success());
    let out = run(&env, &root, &["detect", "."]);
    assert_eq!(fake.hits("/cli/v1/health/scans"), 2);
    assert!(!String::from_utf8_lossy(&out.stderr).contains("Design health"));
}

#[test]
fn a_sign_in_without_the_scope_is_told_once_and_forget_turns_sync_off() {
    // Catches: nagging on every scan when the scope was declined, and a forgotten trend restarting on the next scan.
    let (fake, env) = signed_in("health-forget");
    let root = repo(&env, None);
    fake.knobs.lock().unwrap().health_denied = true;
    let first = run(&env, &root, &["detect", "."]);
    let second = run(&env, &root, &["detect", "."]);
    let hint = "can't save scan results";
    assert!(String::from_utf8_lossy(&first.stderr).contains(hint));
    assert!(!String::from_utf8_lossy(&second.stderr).contains(hint));
    // A repo without a remote keeps a random id outside the work tree:
    // nothing is written into the repo, whose files it controls (review F4).
    assert!(!root.join(".impeccable").exists());
    let ids = Path::new(&env["IMPECCABLE_HOME"]).join("health/repos");
    assert_eq!(std::fs::read_dir(&ids).unwrap().count(), 1);

    fake.knobs.lock().unwrap().health_denied = false;
    let out = run(&env, &root, &["health", "forget"]);
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    assert_eq!(fake.record.lock().unwrap().forgets, 1);
    let before = fake.hits("/cli/v1/health/scans");
    run(&env, &root, &["detect", "."]);
    assert_eq!(fake.hits("/cli/v1/health/scans"), before, "sync stays off after forget");
    let status = run(&env, &root, &["health"]);
    assert!(String::from_utf8_lossy(&status.stdout).contains("turned off"));
}

#[test]
fn forget_without_the_service_confirming_fails_and_stays_off() {
    // Catches (review F8): a 404 from a switched-off service reported as "nothing was saved".
    let (fake, env) = signed_in("health-forget-404");
    let root = repo(&env, Some("https://github.com/acme/my-site"));
    run(&env, &root, &["detect", "."]);
    assert_eq!(fake.hits("/cli/v1/health/scans"), 1);
    fake.knobs.lock().unwrap().health = false;
    let out = run(&env, &root, &["health", "forget"]);
    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains("couldn't be confirmed"));
    fake.knobs.lock().unwrap().health = true;
    run(&env, &root, &["detect", "."]);
    assert_eq!(fake.hits("/cli/v1/health/scans"), 1, "sync stays off");
}

#[test]
fn an_opt_out_where_detect_runs_holds_for_a_scan_of_the_root() {
    // Catches (review F7): `detect ..` from a directory with "telemetry": false uploading the repo root's scan.
    let (fake, env) = signed_in("health-cwd-optout");
    let root = repo(&env, Some("https://github.com/acme/my-site"));
    std::fs::create_dir_all(root.join("sub/.impeccable")).unwrap();
    std::fs::write(root.join("sub/.impeccable/config.json"), r#"{"telemetry": false}"#).unwrap();
    run(&env, &root.join("sub"), &["detect", ".."]);
    assert_eq!(fake.hits("/cli/v1/health/scans"), 0);
}

#[test]
fn an_unsaved_or_unreadable_choice_never_reads_as_on() {
    // Catches (review F5): `health off` claiming success when it couldn't save, and a corrupt health.json reading as on.
    let (fake, env) = signed_in("health-persist");
    let root = repo(&env, Some("https://github.com/acme/my-site"));
    let state = Path::new(&env["IMPECCABLE_HOME"]).join("health.json");
    std::fs::write(&state, "{not json").unwrap();
    run(&env, &root, &["detect", "."]);
    assert_eq!(fake.hits("/cli/v1/health/scans"), 0, "corrupt reads as off");
    std::fs::remove_file(&state).unwrap();
    std::fs::create_dir(&state).unwrap();
    let out = run(&env, &root, &["health", "off"]);
    assert!(!out.status.success(), "off must fail when it can't be saved");
}

#[test]
fn an_upload_that_needs_a_fresh_token_keeps_the_sign_in() {
    // Catches (review F2): an upload rotating the refresh token on a short timeout and leaving the sign-in broken.
    let fake = Fake::start();
    {
        let mut k = fake.knobs.lock().unwrap();
        k.health = true;
        k.access_ttl = 0;
    }
    let env = fake.env("health-refresh");
    login(&env);
    let root = repo(&env, Some("https://github.com/acme/my-site"));
    run(&env, &root, &["detect", "."]);
    assert_eq!(scans(&fake).len(), 1);
    let out = run(&env, &root, &["whoami", "--json"]);
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stdout));
}

#[test]
fn a_quiet_scan_leaves_the_notice_for_the_next_one() {
    // Catches (review, Cursor): `detect --quiet` sending counts and using up the one notice that says so.
    let (fake, env) = signed_in("health-quiet");
    let root = repo(&env, Some("https://github.com/acme/my-site"));
    let notice = "Design health: this scan's counts were saved";
    let quiet = run(&env, &root, &["detect", "--quiet", "."]);
    assert_eq!(fake.hits("/cli/v1/health/scans"), 1);
    assert!(!String::from_utf8_lossy(&quiet.stderr).contains(notice));
    let loud = run(&env, &root, &["detect", "."]);
    assert!(String::from_utf8_lossy(&loud.stderr).contains(notice));

    fake.knobs.lock().unwrap().health_denied = true;
    let hint = "can't save scan results";
    let quiet = run(&env, &root, &["detect", "--quiet", "."]);
    assert!(!String::from_utf8_lossy(&quiet.stderr).contains(hint));
    let loud = run(&env, &root, &["detect", "."]);
    assert!(String::from_utf8_lossy(&loud.stderr).contains(hint));
}

#[test]
fn each_service_gives_its_own_notice() {
    // Catches (review, Greptile): a staging upload's notice hiding production's for the same sign-in count.
    let (staging, env) = signed_in("health-two-issuers");
    let root = repo(&env, Some("https://github.com/acme/my-site"));
    let notice = "Design health: this scan's counts were saved";
    assert!(String::from_utf8_lossy(&run(&env, &root, &["detect", "."]).stderr).contains(notice));
    assert_eq!(staging.hits("/cli/v1/health/scans"), 1);

    let production = Fake::start();
    production.knobs.lock().unwrap().health = true;
    let mut prod_env = env.clone();
    prod_env.insert("IMPECCABLE_ACCOUNT_URL".into(), production.url.clone());
    login(&prod_env);
    let out = run(&prod_env, &root, &["detect", "."]);
    assert_eq!(production.hits("/cli/v1/health/scans"), 1);
    assert!(String::from_utf8_lossy(&out.stderr).contains(notice));
}

#[test]
fn a_busy_sign_in_skips_the_upload_instead_of_holding_detect() {
    // Catches (review, Greptile): an upload due a token refresh waiting up to 60 s on the sign-in lock.
    let fake = Fake::start();
    {
        let mut k = fake.knobs.lock().unwrap();
        k.health = true;
        k.access_ttl = 0;
    }
    let env = fake.env("health-busy-lock");
    login(&env);
    let root = repo(&env, Some("https://github.com/acme/my-site"));
    let accounts = Path::new(&env["IMPECCABLE_HOME"]).join("account");
    let dir = std::fs::read_dir(&accounts).unwrap().next().unwrap().unwrap().path();
    let held = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(dir.join("lock"))
        .unwrap();
    held.try_lock().unwrap();
    let started = std::time::Instant::now();
    let out = run(&env, &root, &["detect", "."]);
    let took = started.elapsed();
    drop(held);
    assert_eq!(out.status.code(), Some(2));
    assert!(took < std::time::Duration::from_secs(10), "detect waited {took:?} on the lock");
    assert_eq!(fake.hits("/cli/v1/health/scans"), 0);
    // Once the lock is free the next scan refreshes and uploads as usual.
    run(&env, &root, &["detect", "."]);
    assert_eq!(fake.hits("/cli/v1/health/scans"), 1);
}

#[test]
fn a_changed_design_system_starts_a_new_ruleset() {
    // Catches (review, Greptile): editing DESIGN.md's allowed colors removing findings that the trend then reports as fixed.
    let (fake, env) = signed_in("health-design-system");
    let root = repo(&env, Some("https://github.com/acme/my-site"));
    let design = |primary: &str| format!("---\nname: Site\ncolors:\n  primary: \"{primary}\"\n---\n\n# Design\n");
    std::fs::write(root.join("DESIGN.md"), design("#0ea5e9")).unwrap();
    run(&env, &root, &["detect", "."]);
    std::fs::write(root.join("DESIGN.md"), design("#7c3aed")).unwrap();
    run(&env, &root, &["detect", "."]);
    run(&env, &root, &["detect", &root.to_string_lossy()]);
    let all = scans(&fake);
    assert_eq!(all.len(), 3);
    assert_ne!(all[0]["rulesetId"], all[1]["rulesetId"], "a new DESIGN.md is a new ruleset");
    assert_eq!(all[1]["rulesetId"], all[2]["rulesetId"], "the same one is the same ruleset");
}

#[test]
fn a_touched_design_file_keeps_the_ruleset() {
    // Catches (review, Greptile and Cursor): DESIGN.md's mtime against its sidecar's starting a new baseline with the same settings.
    let (fake, env) = signed_in("health-design-mtime");
    let root = repo(&env, Some("https://github.com/acme/my-site"));
    std::fs::write(root.join("DESIGN.md"), "---\nname: Site\ncolors:\n  primary: \"#0ea5e9\"\n---\n\n# Design\n").unwrap();
    std::fs::create_dir_all(root.join(".impeccable")).unwrap();
    std::fs::write(root.join(".impeccable/design.json"), r#"{"schemaVersion":1}"#).unwrap();
    let at = |secs: u64| std::time::UNIX_EPOCH + std::time::Duration::from_secs(secs);
    let touch = |file: &str, secs: u64| {
        std::fs::File::options().write(true).open(root.join(file)).unwrap().set_modified(at(secs)).unwrap();
    };
    touch(".impeccable/design.json", 1_700_000_000);
    touch("DESIGN.md", 1_600_000_000);
    run(&env, &root, &["detect", "."]);
    touch("DESIGN.md", 1_800_000_000);
    run(&env, &root, &["detect", "."]);
    let all = scans(&fake);
    assert_eq!(all.len(), 2);
    assert_eq!(all[0]["rulesetId"], all[1]["rulesetId"]);
}

#[test]
fn an_ignored_rule_starts_a_new_ruleset_however_it_is_spelled() {
    // Catches (review, Greptile): "CREAM-PALETTE" in ignoreRules hiding cream-palette findings without changing rulesetId.
    let (fake, env) = signed_in("health-ignore-case");
    let root = repo(&env, Some("https://github.com/acme/my-site"));
    std::fs::create_dir_all(root.join(".impeccable")).unwrap();
    let config = root.join(".impeccable/config.json");
    run(&env, &root, &["detect", "."]);
    std::fs::write(&config, r#"{"detector":{"ignoreRules":[" CREAM-PALETTE "]}}"#).unwrap();
    run(&env, &root, &["detect", "."]);
    std::fs::write(&config, r#"{"detector":{"ignoreRules":["cream-palette"]}}"#).unwrap();
    run(&env, &root, &["detect", "."]);
    let all = scans(&fake);
    assert_eq!(all.len(), 3);
    assert_ne!(all[0]["rules"], all[1]["rules"], "the ignore took effect");
    assert_ne!(all[0]["rulesetId"], all[1]["rulesetId"]);
    assert_eq!(all[1]["rulesetId"], all[2]["rulesetId"]);
}

#[test]
fn a_design_root_above_the_repo_keeps_the_ruleset_the_same_on_every_checkout() {
    // Catches (review, Cursor): a design root outside the scanned repo putting its absolute path into rulesetId, so two checkouts disagree.
    let (fake, env) = signed_in("health-outer-design-root");
    let home = Path::new(&env["IMPECCABLE_HOME"]).to_path_buf();
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/antipatterns");
    let mut roots = Vec::new();
    for checkout in ["checkout-a", "checkout-b"] {
        let mono = home.join(checkout).join("mono");
        let site = mono.join("packages/site");
        std::fs::create_dir_all(&site).unwrap();
        std::fs::write(mono.join("package.json"), r#"{"name":"mono","workspaces":["packages/*"]}"#).unwrap();
        std::fs::write(mono.join("DESIGN.md"), "---\nname: Mono\ncolors:\n  primary: \"#0ea5e9\"\n---\n\n# Design\n").unwrap();
        std::fs::write(site.join("package.json"), r#"{"name":"site"}"#).unwrap();
        std::fs::copy(fixtures.join("cream-palette.html"), site.join("cream-palette.html")).unwrap();
        git(&site, &["init", "-q", "-b", "main"]);
        git(&site, &["remote", "add", "origin", "https://github.com/acme/site"]);
        roots.push(site.canonicalize().unwrap());
    }
    for root in &roots {
        run(&env, root, &["detect", "."]);
    }
    let all = scans(&fake);
    assert_eq!(all.len(), 2);
    assert_eq!(all[0]["repoKey"], all[1]["repoKey"]);
    assert_eq!(all[0]["rulesetId"], all[1]["rulesetId"]);
}

#[test]
fn foundations_use_scan_evidence_and_the_health_opt_out() {
    let fake = Fake::start();
    fake.knobs.lock().unwrap().health = true;
    let env = fake.env("foundations-sync");
    login(&env);
    fake.knobs.lock().unwrap().foundations = true;
    let root = repo(&env, Some("https://github.com/acme/my-site"));
    run(&env, &root, &["detect", "--json", "."]);
    assert_eq!(
        fake.hits("/cli/v1/foundations"),
        0,
        "an existing grant has no foundations consent"
    );
    login(&env);
    assert_eq!(
        fake.record.lock().unwrap().scopes,
        vec![
            "account:read rules:read health:write",
            "account:read rules:read health:write foundations:write",
        ]
    );
    std::fs::write(root.join("contrast.html"), "<!doctype html><html><body><p style='color:#eee;background:#fff;font-size:16px'>Readable text</p></body></html>").unwrap();
    let out = run(&env, &root, &["detect", "--json", "."]);
    let r = fake.record.lock().unwrap();
    let body = r.foundations.last().expect("foundations uploaded");
    assert_eq!(body["repoKey"], r.scans.last().unwrap()["repoKey"]);
    assert_eq!(body["scanId"], r.scans.last().unwrap()["scanId"]);
    assert_eq!(body["items"]["no-generic-ai-patterns"], "failing");
    assert_eq!(body["items"]["readable-contrast"], "failing");
    assert!(body["items"].get("design-tokens").is_none());
    drop(r);
    for args in [
        vec!["detect", "--json", "sub"],
        vec!["detect", "--scope", "layout", "."],
        vec!["hook-before-edit"],
    ] {
        run(&env, &root, &args);
        assert_eq!(fake.hits("/cli/v1/foundations"), 1);
    }
    for key in ["CI", "DO_NOT_TRACK", "IMPECCABLE_NO_TELEMETRY"] {
        let mut off = env.clone();
        off.insert(key.into(), "1".into());
        run(&off, &root, &["detect", "."]);
    }
    run(&env, &root, &["health", "off"]);
    run(&env, &root, &["detect", "."]);
    assert_eq!(fake.hits("/cli/v1/foundations"), 1);
    run(&env, &root, &["health", "on"]);
    fake.knobs.lock().unwrap().foundations = false;
    let switched_off = run(&env, &root, &["detect", "--json", "."]);
    assert_eq!(out.stdout, switched_off.stdout);
    assert_eq!(out.status.code(), switched_off.status.code());
    assert_eq!(out.stderr, switched_off.stderr);
    // A route that stalls is bounded and never changes detect's result.
    fake.knobs.lock().unwrap().foundations = true;
    let gate = fake.hold("/cli/v1/foundations");
    let started = std::time::Instant::now();
    let stalled = run(&env, &root, &["detect", "--json", "."]);
    gate.open();
    assert!(started.elapsed() < std::time::Duration::from_secs(8));
    assert_eq!(out.stdout, stalled.stdout);
    assert_eq!(out.stderr, stalled.stderr);
    assert_eq!(out.status.code(), stalled.status.code());
    fake.knobs.lock().unwrap().foundations_denied = true;
    login(&env);
    let before = fake.hits("/cli/v1/foundations");
    run(&env, &root, &["detect", "--json", "."]);
    assert_eq!(fake.hits("/cli/v1/foundations"), before, "declined scope");
    fake.knobs.lock().unwrap().foundations_denied = false;
    login(&env);
    // With no scan evidence, send an empty items map rather than inventing passes.
    for file in [
        "contrast.html",
        "border-accent-blank-lines.css",
        "em-dash-prose-list.html",
        "cream-palette.html",
        "sub/cream.html",
    ] {
        std::fs::remove_file(root.join(file)).unwrap();
    }
    std::fs::write(
        root.join("clean.html"),
        "<!doctype html><html><body><p>Hello</p></body></html>",
    )
    .unwrap();
    run(&env, &root, &["detect", "--json", "."]);
    assert_eq!(
        fake.record.lock().unwrap().foundations.last().unwrap()["items"],
        serde_json::json!({})
    );
}
