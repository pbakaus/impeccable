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
    let mut child = impeccable(env, Path::new(&env["IMPECCABLE_HOME"]), &["login", "--no-browser", "--force"])
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
    let hint = "Saving to your Impeccable account needs a fresh sign-in. Run impeccable login to turn it on.";
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
    let hint = "Saving to your Impeccable account needs a fresh sign-in. Run impeccable login to turn it on.";
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
    // A tracked key: the item fails, and neither the key nor where it sits is sent.
    let key = format!("sk_{}_{}", "live", "4eC39HqLyjWDarjtT1zdp7dcAbCdEf12");
    std::fs::create_dir_all(root.join("src")).unwrap();
    std::fs::write(root.join("src/billing-keys.json"), format!("{{\"k\": \"{key}\"}}\n")).unwrap();
    git(&root, &["add", "src/billing-keys.json"]);
    let out = run(&env, &root, &["detect", "--json", "."]);
    let r = fake.record.lock().unwrap();
    let body = r.foundations.last().expect("foundations uploaded");
    assert_eq!(body["repoKey"], r.scans.last().unwrap()["repoKey"]);
    assert_eq!(body["scanId"], r.scans.last().unwrap()["scanId"]);
    assert_eq!(body["items"]["no-generic-ai-patterns"], "failing");
    assert_eq!(body["items"]["readable-contrast"], "failing");
    assert_eq!(body["items"]["secrets-out-of-repo"], "failing");
    assert_eq!(body["items"]["ci-runs-tests"], "failing");
    // Items that need the network are never claimed.
    assert!(body["items"].get("real-packages").is_none());
    let sent = body.to_string();
    assert!(!sent.contains(&key[8..]) && !sent.contains("billing-keys"), "{sent}");
    // The repo's name, by health's label recipe, so the page needn't show a hash
    // (pristine#4721 accepts it).
    assert_eq!(body["label"], r.scans.last().unwrap()["label"]);
    assert_eq!(body["label"], "my-site");
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
    // Only a clean page left: the detector's classes pass as "none found".
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
    // A scan that read a page and found nothing claims "none found".
    let items = fake.record.lock().unwrap().foundations.last().unwrap()["items"].clone();
    assert_eq!(items["readable-contrast"], "checked", "{items}");
    assert_eq!(items["no-generic-ai-patterns"], "checked", "{items}");
    // The verb prints and uploads the same states, and the key's value stays
    // out of its JSON too.
    let verb = run(&env, &root, &["foundations", "--json"]);
    let printed: serde_json::Value = serde_json::from_slice(&verb.stdout).unwrap();
    assert_eq!(printed["items"], items);
    assert_eq!(printed["next"], "secrets-out-of-repo");
    assert_eq!(fake.record.lock().unwrap().foundations.last().unwrap()["items"], items);
    let stdout = String::from_utf8_lossy(&verb.stdout);
    assert!(!stdout.contains(&key[8..]) && !stdout.contains("billing-keys"));
}

#[test]
fn foundations_review_off_during_upload_prevents_the_health_request() {
    let fake = Fake::start();
    {
        let mut k = fake.knobs.lock().unwrap();
        k.health = true;
        k.foundations = true;
    }
    let env = fake.env("foundations-racing-off");
    login(&env);
    let root = repo(&env, Some("https://github.com/acme/site"));
    let gate = fake.hold("/cli/v1/foundations");
    let child = impeccable(&env, &root, &["detect", "--json", "."])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    fake.wait_for_hits("/cli/v1/foundations", 1);
    assert!(run(&env, &root, &["health", "off"]).status.success());
    gate.open();
    child.wait_with_output().unwrap();
    assert_eq!(fake.hits("/cli/v1/health/scans"), 0);
}

#[test]
fn foundations_review_json_alias_preserves_the_health_notice() {
    let (fake, env) = signed_in("health-json-alias");
    let root = repo(&env, Some("https://github.com/acme/site"));
    let out = run(&env, &root, &["detect", "-json", "."]);
    assert_eq!(fake.hits("/cli/v1/health/scans"), 1);
    assert!(!String::from_utf8_lossy(&out.stderr).contains("Design health:"));
    let out = run(&env, &root, &["detect", "."]);
    assert!(String::from_utf8_lossy(&out.stderr)
        .contains("Design health: this scan's counts were saved"));
}

#[test]
fn design_sync_defaults_on_changed_only_and_retries_failures() {
    let fake = Fake::start();
    {
        let mut k = fake.knobs.lock().unwrap();
        k.health = true;
        k.design = true;
    }
    let env = fake.env("design-sync");
    login(&env);
    assert_eq!(
        fake.record.lock().unwrap().scopes[0],
        "account:read rules:read health:write design:write"
    );
    let root = repo(&env, Some("git@GitHub.com:acme/my-site.git"));
    std::fs::write(root.join("DESIGN.md"), "# Site\n").unwrap();
    let baseline = run(&env, &root, &["detect", "--json", "."]);
    assert_eq!(fake.hits("/cli/v1/design"), 1);
    assert!(run(&env, &root, &["health", "design", "on"])
        .status
        .success());
    let uploaded = run(&env, &root, &["detect", "--json", "."]);
    assert_eq!(baseline.stdout, uploaded.stdout);
    assert_eq!(baseline.status.code(), uploaded.status.code());
    assert_eq!(baseline.stderr, uploaded.stderr);
    run(&env, &root, &["detect", "--quiet", "."]);
    assert_eq!(fake.hits("/cli/v1/design"), 1);
    let doc = fake.record.lock().unwrap().designs[0].clone();
    assert_eq!(doc["text"], "# Site\n");
    assert_eq!(doc["repoKey"], scans(&fake)[0]["repoKey"]);
    std::fs::write(root.join("DESIGN.md"), "# Changed\n").unwrap();
    fake.knobs.lock().unwrap().design = false;
    run(&env, &root, &["detect", "--json", "."]);
    fake.knobs.lock().unwrap().design = true;
    run(&env, &root, &["detect", "--json", "."]);
    assert_eq!(fake.record.lock().unwrap().designs.len(), 2);
    assert!(run(&env, &root, &["health", "forget"]).status.success());
    assert!(run(&env, &root, &["health", "on"]).status.success());
    run(&env, &root, &["detect", "--json", "."]);
    assert_eq!(fake.record.lock().unwrap().designs.len(), 3);
    assert!(run(&env, &root, &["health", "design", "off"])
        .status
        .success());
    std::fs::write(root.join("DESIGN.md"), "# Off\n").unwrap();
    run(&env, &root, &["detect", "."]);
    assert_eq!(fake.record.lock().unwrap().designs.len(), 3);
}

#[test]
fn design_sync_filters_metadata_bounds_files_and_respects_health_gates() {
    let fake = Fake::start();
    {
        let mut k = fake.knobs.lock().unwrap();
        k.health = true;
        k.design = true;
    }
    let env = fake.env("design-bounds");
    login(&env);
    let root = repo(&env, None);
    assert!(run(&env, &root, &["health", "design", "on"])
        .status
        .success());
    std::fs::create_dir_all(root.join(".impeccable")).unwrap();
    std::fs::write(root.join(".impeccable/design.json"), r##"{"extensions":{"colorMeta":{"primary":{"role":"primary","tonalRamp":["#fff"]}},"components":[{"html":"PRIVATE MARKUP"}],"narrative":"PRIVATE NARRATIVE"}}"##).unwrap();
    for text in [
        String::new(),
        " \n".into(),
        "# Bad\0".into(),
        "é".repeat(32769),
        "\u{1}".repeat(30000),
    ] {
        std::fs::write(root.join("DESIGN.md"), text).unwrap();
        run(&env, &root, &["detect", "--json", "."]);
    }
    assert_eq!(fake.hits("/cli/v1/design"), 0);
    std::fs::write(root.join("DESIGN.md"), "# Site\n").unwrap();
    for (key, value) in [
        ("CI", "1"),
        ("DO_NOT_TRACK", "1"),
        ("IMPECCABLE_NO_TELEMETRY", "1"),
    ] {
        let mut opted_out = env.clone();
        opted_out.insert(key.into(), value.into());
        run(&opted_out, &root, &["detect", "--json", "."]);
    }
    run(&env, &root, &["detect", "--json", "sub"]);
    run(&env, &root, &["health", "off"]);
    run(&env, &root, &["detect", "--json", "."]);
    assert_eq!(fake.hits("/cli/v1/design"), 0);
    run(&env, &root, &["health", "on"]);
    run(&env, &root, &["detect", "--json", "."]);
    let docs = fake.record.lock().unwrap().designs.clone();
    assert_eq!(docs.len(), 1);
    assert_eq!(
        docs[0]["sidecar"],
        serde_json::json!({"colorMeta":{"primary":{"role":"primary", "tonalRamp":["#fff"]}}})
    );
    assert!(!docs[0].to_string().contains("PRIVATE"));
    // An extension-only change is part of the uploaded content hash.
    std::fs::write(
        root.join(".impeccable/design.json"),
        r#"{"extensions":{"typographyMeta":{"body":{"purpose":"Reading"}}}}"#,
    )
    .unwrap();
    run(&env, &root, &["detect", "--json", "."]);
    assert_eq!(fake.record.lock().unwrap().designs.len(), 2);
    let state = Path::new(&env["IMPECCABLE_HOME"]).join("health/repos");
    for entry in std::fs::read_dir(state).unwrap().flatten() {
        if entry.path().extension().is_some_and(|e| e == "design") {
            let saved = std::fs::read_to_string(entry.path()).unwrap();
            assert_eq!(saved.len(), 64);
            assert!(saved.bytes().all(|b| b.is_ascii_hexdigit()));
        }
    }
}

#[test]
fn design_sync_requires_the_granted_scope() {
    let (fake, env) = signed_in("design-scope-gate");
    let root = repo(&env, Some("https://github.com/acme/site"));
    std::fs::write(root.join("DESIGN.md"), "# Site\n").unwrap();
    assert!(run(&env, &root, &["health", "design", "on"])
        .status
        .success());
    fake.knobs.lock().unwrap().design = true;
    run(&env, &root, &["detect", "--json", "."]);
    assert_eq!(fake.hits("/cli/v1/design"), 0);
    fake.knobs.lock().unwrap().design_denied = true;
    login(&env);
    run(&env, &root, &["detect", "--json", "."]);
    assert_eq!(fake.hits("/cli/v1/design"), 0, "declined scope");
    fake.knobs.lock().unwrap().design_denied = false;
    login(&env);
    run(&env, &root, &["detect", "--json", "."]);
    assert_eq!(fake.record.lock().unwrap().designs.len(), 1);
}

#[test]
fn design_forget_fences_a_late_success_response() {
    let fake = Fake::start();
    {
        let mut k = fake.knobs.lock().unwrap();
        k.health = true;
        k.design = true;
    }
    let env = fake.env("design-forget-race");
    login(&env);
    let root = repo(&env, None);
    std::fs::write(root.join("DESIGN.md"), "# Site\n").unwrap();
    run(&env, &root, &["health", "design", "on"]);
    let gate = fake.hold("/cli/v1/design");
    let mut child = impeccable(&env, &root, &["detect", "--json", "."])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let until = std::time::Instant::now() + std::time::Duration::from_secs(4);
    while fake.record.lock().unwrap().designs.is_empty() {
        assert!(std::time::Instant::now() < until);
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    assert!(run(&env, &root, &["health", "forget"]).status.success());
    assert!(run(&env, &root, &["health", "on"]).status.success());
    gate.open();
    child.wait().unwrap();
    run(&env, &root, &["detect", "--json", "."]);
    assert_eq!(fake.record.lock().unwrap().designs.len(), 2);
}

#[test]
fn design_scopes_stay_with_the_grant_when_another_person_signs_in() {
    let fake = Fake::start();
    {
        let mut k = fake.knobs.lock().unwrap();
        k.health = true;
        k.access_ttl = 0;
    }
    let old = fake.env("design-old-grant");
    login(&old);
    let root = repo(&old, None);
    std::fs::write(root.join("DESIGN.md"), "# Site\n").unwrap();
    run(&old, &root, &["health", "design", "on"]);
    fake.knobs.lock().unwrap().design = true;
    let newer = fake.env("design-new-grant");
    login(&newer);
    // First scan refreshes through health; the second must still lack consent.
    run(&old, &root, &["detect", "--json", "."]);
    run(&old, &root, &["detect", "--json", "."]);
    assert_eq!(fake.hits("/cli/v1/design"), 0);
}

#[test]
fn design_off_waits_for_an_admitted_upload() {
    for args in [
        &["health", "design", "off"][..],
        &["health", "off"][..],
        &["health", "forget"][..],
    ] {
        let fake = Fake::start();
        {
            let mut k = fake.knobs.lock().unwrap();
            k.health = true;
            k.design = true;
        }
        let env = fake.env(&format!("design-off-admission-{}", args.len()));
        login(&env);
        let root = repo(&env, None);
        std::fs::write(root.join("DESIGN.md"), "# Site\n").unwrap();
        run(&env, &root, &["health", "design", "on"]);
        let gate = fake.hold("/cli/v1/design");
        let mut scan = impeccable(&env, &root, &["detect", "--json", "."])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        fake.wait_for_hits("/cli/v1/design", 1);
        let mut off = impeccable(&env, &root, args)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        std::thread::sleep(std::time::Duration::from_millis(300));
        let early = off.try_wait().unwrap();
        gate.open();
        scan.wait().unwrap();
        let done = off.wait().unwrap();
        assert!(
            early.is_none(),
            "off returned while the earlier upload was admitted: {args:?}"
        );
        assert!(done.success());
        let count = fake.hits("/cli/v1/design");
        run(&env, &root, &["detect", "--json", "."]);
        assert_eq!(fake.hits("/cli/v1/design"), count);
    }
}

#[test]
fn design_refuses_a_state_secret_generation_mismatch() {
    let fake = Fake::start();
    {
        let mut k = fake.knobs.lock().unwrap();
        k.health = true;
        k.design = true;
    }
    let env = fake.env("design-inconsistent-snapshot");
    login(&env);
    let root = repo(&env, None);
    std::fs::write(root.join("DESIGN.md"), "# Site\n").unwrap();
    run(&env, &root, &["health", "design", "on"]);
    let account = impeccable_account::config::Account::from_env(&env).unwrap();
    let store = impeccable_account::store::Store::new(&account);
    let lock = store.lock().unwrap();
    let state = store.state().unwrap();
    let mut secret = store.secret(&state).unwrap();
    secret.generation += 1; // The secret-first crash window, without exposing any token.
    store.save(&lock, &state, &secret).unwrap();
    drop(lock);
    run(&env, &root, &["detect", "--json", "."]);
    assert_eq!(fake.hits("/cli/v1/design"), 0);
    assert!(
        impeccable_account::session::Session::load(&account).is_ok(),
        "ordinary recovery is unchanged"
    );
}

#[test]
fn design_skips_a_busy_lifecycle_even_with_a_fresh_token() {
    let fake = Fake::start();
    {
        let mut k = fake.knobs.lock().unwrap();
        k.health = true;
        k.design = true;
    }
    let env = fake.env("design-fresh-busy-snapshot");
    login(&env);
    let root = repo(&env, None);
    std::fs::write(root.join("DESIGN.md"), "# Site\n").unwrap();
    run(&env, &root, &["health", "design", "on"]);
    let account = impeccable_account::config::Account::from_env(&env).unwrap();
    let store = impeccable_account::store::Store::new(&account);
    let lock = store.lock().unwrap();
    run(&env, &root, &["detect", "--json", "."]);
    drop(lock);
    assert_eq!(fake.hits("/cli/v1/design"), 0);
}

#[test]
fn design_has_one_two_second_response_budget() {
    let fake = Fake::start();
    {
        let mut k = fake.knobs.lock().unwrap();
        k.health = true;
        k.design = true;
    }
    let env = fake.env("design-response-budget");
    login(&env);
    let root = repo(&env, None);
    std::fs::write(root.join("DESIGN.md"), "# Site\n").unwrap();
    let baseline = std::time::Instant::now();
    run(&env, &root, &["detect", "--json", "."]);
    let baseline = baseline.elapsed();
    run(&env, &root, &["health", "design", "on"]);
    let gate = fake.hold("/cli/v1/design");
    let start = std::time::Instant::now();
    run(&env, &root, &["detect", "--json", "."]);
    let elapsed = start.elapsed();
    gate.open();
    assert!(
        elapsed < baseline + std::time::Duration::from_secs(3),
        "added latency: {elapsed:?}"
    );
}

#[test]
fn design_refresh_can_finish_safely_after_detect_stops_waiting() {
    let fake = Fake::start();
    {
        let mut k = fake.knobs.lock().unwrap();
        k.health = true;
        k.design = true;
        k.access_ttl = 0;
    }
    let env = fake.env("design-renew-budget");
    login(&env);
    fake.knobs.lock().unwrap().access_ttl = 900;
    let root = repo(&env, None);
    std::fs::write(root.join("DESIGN.md"), "# Site\n").unwrap();
    run(&env, &root, &["health", "design", "on"]);
    let gate = fake.hold("/oauth/token");
    let mut scan = impeccable(&env, &root, &["detect", "--json", "."])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    fake.wait_for_hits("/oauth/token", 2);
    let until = std::time::Instant::now() + std::time::Duration::from_secs(3);
    let early = loop {
        if let Some(status) = scan.try_wait().unwrap() {
            break Some(status);
        }
        if std::time::Instant::now() >= until {
            break None;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    };
    gate.open();
    scan.wait().unwrap();
    assert!(
        early.is_some(),
        "detect waited for a stalled token rotation"
    );
    assert!(
        run(&env, &root, &["whoami", "--json"]).status.success(),
        "renewal kept the sign-in"
    );
    let account = impeccable_account::config::Account::from_env(&env).unwrap();
    let store = impeccable_account::store::Store::new(&account);
    let lock = store.lock().unwrap();
    let state = store.state().unwrap();
    assert_eq!(state.generation, store.secret(&state).unwrap().generation);
    drop(lock);
    assert_eq!(
        fake.hits("/cli/v1/design"),
        0,
        "renewal never receives an upload body"
    );
    run(&env, &root, &["detect", "--json", "."]);
    assert_eq!(fake.hits("/cli/v1/design"), 1);
}

#[test]
fn design_sync_reuses_health_repo_labels_and_omits_missing_ones() {
    assert_eq!(fake::parse_label(None), Ok(None));
    assert_eq!(fake::parse_label(Some(&serde_json::Value::Null)), Ok(None));
    assert_eq!(
        fake::parse_label(Some(&serde_json::json!("  acme web "))),
        Ok(Some("acme web".into()))
    );
    for value in [
        serde_json::json!("git@github.com:acme/web"),
        serde_json::json!("acme/web"),
        serde_json::json!("repo\\secret"),
        serde_json::json!("a\u{7}b"),
        serde_json::json!("\tacme"),
        serde_json::json!("\u{FEFF}acme"),
        serde_json::json!("x".repeat(101)),
        serde_json::json!("   "),
        serde_json::json!(7),
    ] {
        assert_eq!(fake::parse_label(Some(&value)), Err("label"));
    }
    for (i, (remote, expected)) in [
        (Some("git@GitHub.com:acme/my-site.git"), Some("my-site")),
        (Some("git@gitlab.com:group/sub/tool.git"), Some("tool")),
        (None, None),
        (Some("git@github.com:acme/repo\\secret.git"), None),
    ]
    .into_iter()
    .enumerate()
    {
        let fake = Fake::start();
        {
            let mut k = fake.knobs.lock().unwrap();
            k.health = true;
            k.design = true;
        }
        let env = fake.env(&format!("design-repo-label-{i}"));
        login(&env);
        let root = repo(&env, remote);
        std::fs::write(root.join("DESIGN.md"), "# Site\n").unwrap();
        assert!(run(&env, &root, &["health", "design", "on"])
            .status
            .success());
        run(&env, &root, &["detect", "--json", "."]);
        let doc = fake
            .record
            .lock()
            .unwrap()
            .designs
            .last()
            .cloned()
            .expect("design uploaded");
        let health = scans(&fake).pop().unwrap();
        assert_eq!(doc.get("label"), health.get("label"));
        match expected {
            Some(name) => assert_eq!(doc["label"], name),
            None => assert!(
                doc.get("label").is_none(),
                "omit absent labels, including null"
            ),
        }
    }
}

#[test]
fn design_setting_lock_wait_is_bounded_and_reports_a_plain_cause() {
    let fake = Fake::start();
    let env = fake.env("design-plain-lock-cause");
    let held = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(Path::new(&env["IMPECCABLE_HOME"]).join("design.lock"))
        .unwrap();
    held.try_lock().unwrap();
    for (args, prefix) in [
        (&["health", "design", "off"][..], "DESIGN.md sync"),
        (&["health", "off"][..], "Design health"),
    ] {
        let started = std::time::Instant::now();
        let out = run(&env, Path::new(&env["IMPECCABLE_HOME"]), args);
        assert!(!out.status.success());
        assert!(started.elapsed() >= std::time::Duration::from_secs(2));
        assert!(started.elapsed() < std::time::Duration::from_secs(6));
        assert_eq!(String::from_utf8(out.stderr).unwrap(), format!("{prefix}: couldn't save the setting: another impeccable command is using it; try again.\n"));
    }
}

#[test]
fn upload_features_share_one_grant_and_keep_independent_consent() {
    let fake = Fake::start();
    {
        let mut k = fake.knobs.lock().unwrap();
        k.health = true;
        k.setup = true;
        k.foundations = true;
        k.design = true;
    }
    let env = fake.env("combined-upload-grant");
    // Exercise shared consent without racing the detached setup worker.
    assert!(run(&env, Path::new(&env["IMPECCABLE_HOME"]), &["setup", "off"])
        .status
        .success());
    login(&env);
    assert_eq!(
        fake.record.lock().unwrap().scopes[0],
        "account:read rules:read health:write setup:write foundations:write design:write"
    );
    let root = repo(&env, Some("https://github.com/acme/site"));
    std::fs::write(root.join("DESIGN.md"), "# Site\n").unwrap();
    assert!(run(&env, &root, &["health", "design", "on"])
        .status
        .success());
    run(&env, &root, &["detect", "--json", "."]);
    assert_eq!(fake.record.lock().unwrap().designs.len(), 1);
    assert_eq!(fake.record.lock().unwrap().foundations.len(), 1);
    assert_eq!(scans(&fake).len(), 1);

    // A new grant can decline one feature without losing any other scope.
    fake.knobs.lock().unwrap().design_denied = true;
    login(&env);
    run(&env, &root, &["detect", "--json", "."]);
    assert_eq!(fake.record.lock().unwrap().designs.len(), 1);
    assert_eq!(fake.record.lock().unwrap().foundations.len(), 2);
    assert_eq!(scans(&fake).len(), 2);
}

#[test]
fn design_notice_is_once_after_success_and_again_after_sign_in() {
    let fake = Fake::start();
    {
        let mut k = fake.knobs.lock().unwrap();
        k.health = true;
        k.design = true;
    }
    let env = fake.env("design-notice");
    login(&env);
    let root = repo(&env, None);
    let notice = "Uploaded your DESIGN.md to your Impeccable account. It uploads again whenever it changes. To stop: impeccable health design off\n";
    let hook = run(&env, &root, &["hook-before-edit"]);
    assert!(!String::from_utf8_lossy(&hook.stdout).contains(notice));
    assert!(!String::from_utf8_lossy(&hook.stderr).contains(notice));
    assert_eq!(fake.hits("/cli/v1/design"), 0);
    for flag in ["--json", "--quiet", "--github"] {
        std::fs::write(root.join("DESIGN.md"), format!("# {flag}\n")).unwrap();
        let out = run(&env, &root, &["detect", flag, "."]);
        assert!(!String::from_utf8_lossy(&out.stderr).contains(notice));
        assert!(!String::from_utf8_lossy(&out.stdout).contains(notice));
    }
    assert_eq!(fake.hits("/cli/v1/design"), 3);
    for (text, expected) in [("# First", true), ("# Second", false)] {
        std::fs::write(root.join("DESIGN.md"), text).unwrap();
        let out = run(&env, &root, &["detect", "."]);
        assert_eq!(
            String::from_utf8_lossy(&out.stderr).contains(notice),
            expected
        );
        assert!(!String::from_utf8_lossy(&out.stdout).contains(notice));
    }
    assert_eq!(fake.hits("/cli/v1/design"), 5);
    login(&env);
    let out = run(&env, &root, &["detect", "."]);
    assert!(String::from_utf8_lossy(&out.stderr).contains(notice));
}

#[test]
fn stale_design_and_foundations_grants_require_current_service_offering() {
    let notice = "Saving to your Impeccable account needs a fresh sign-in. Run impeccable login to turn it on.";
    for feature in ["design", "foundations"] {
        let (fake, env) = signed_in(&format!("stale-{feature}"));
        let root = repo(&env, Some("https://github.com/acme/stale"));
        std::fs::write(root.join("DESIGN.md"), "# Design\n").unwrap();
        assert!(
            !String::from_utf8_lossy(&run(&env, &root, &["detect", "."]).stderr).contains(notice)
        );
        {
            let mut k = fake.knobs.lock().unwrap();
            k.design = feature == "design";
            k.foundations = feature == "foundations";
        }
        for args in [
            vec!["detect", "--quiet", "."],
            vec!["detect", "--json", "."],
            vec!["hook-before-edit"],
        ] {
            let out = run(&env, &root, &args);
            assert!(!String::from_utf8_lossy(&out.stderr).contains(notice));
        }
        let first = run(&env, &root, &["detect", "."]);
        assert_eq!(
            String::from_utf8_lossy(&first.stderr)
                .matches(notice)
                .count(),
            1,
            "{feature}"
        );
        let metadata = fake.hits("/.well-known/oauth-authorization-server");
        let second = run(&env, &root, &["detect", "."]);
        assert!(!String::from_utf8_lossy(&second.stderr).contains(notice));
        assert_eq!(
            fake.hits("/.well-known/oauth-authorization-server"),
            metadata
        );
    }
}

/// `login` run from `cwd`; returns what it printed to stderr.
fn login_in(env: &HashMap<String, String>, cwd: &Path) -> String {
    let mut child = impeccable(env, cwd, &["login", "--no-browser", "--force"])
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
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stderr).into_owned()
}

#[test]
fn the_first_sign_in_inside_a_repo_scans_and_adds_it_once() {
    // Catches: a new sign-in leaving the repository off the account until a second command, and rescans on every sign-in.
    let fake = Fake::start();
    {
        let mut k = fake.knobs.lock().unwrap();
        k.health = true;
        k.foundations = true;
    }
    let env = fake.env("first-signin");
    let root = repo(&env, Some("https://github.com/acme/my-site"));
    let err = login_in(&env, &root);
    assert!(err.contains("Added this repository to your account"), "{err}");
    assert!(err.contains("Find it under Repositories"), "{err}");
    assert_eq!(scans(&fake).len(), 1);
    assert_eq!(fake.hits("/cli/v1/foundations"), 1);
    // Nothing is written into the work tree.
    assert!(!root.join(".impeccable").exists());

    let again = login_in(&env, &root);
    assert!(!again.contains("Added this repository"), "{again}");
    assert_eq!(fake.hits("/cli/v1/health/scans"), 1, "no rescan on a later sign-in");
    assert_eq!(fake.hits("/cli/v1/foundations"), 1);

    // From a subdirectory the repository is the same one.
    login_in(&env, &root.join("sub"));
    assert_eq!(fake.hits("/cli/v1/health/scans"), 1);

    // Forget clears the mark, so the next sign-in adds the repository again.
    assert!(run(&env, &root, &["health", "forget"]).status.success());
    assert!(run(&env, &root, &["health", "on"]).status.success());
    let back = login_in(&env, &root);
    assert!(back.contains("Added this repository"), "{back}");
    assert_eq!(fake.hits("/cli/v1/health/scans"), 2);
}

#[test]
fn a_sign_in_outside_a_repo_scans_nothing_and_says_so() {
    let fake = Fake::start();
    fake.knobs.lock().unwrap().health = true;
    let env = fake.env("first-signin-outside");
    let err = login_in(&env, Path::new(&env["IMPECCABLE_HOME"]));
    assert!(err.contains("Not in a repository, so nothing was scanned"), "{err}");
    assert_eq!(fake.hits("/cli/v1/health/scans"), 0);
}

#[test]
fn a_sign_in_under_ci_or_with_sync_off_scans_nothing() {
    let fake = Fake::start();
    fake.knobs.lock().unwrap().health = true;
    let env = fake.env("first-signin-ci");
    let root = repo(&env, Some("https://github.com/acme/my-site"));
    let mut ci = env.clone();
    ci.insert("CI".into(), "true".into());
    let err = login_in(&ci, &root);
    assert!(!err.contains("Scanning"), "{err}");
    assert_eq!(fake.hits("/cli/v1/health/scans"), 0);
    assert!(run(&env, &root, &["health", "off"]).status.success());
    let err = login_in(&env, &root);
    assert!(!err.contains("Scanning"), "{err}");
    assert_eq!(fake.hits("/cli/v1/health/scans"), 0);
}

#[test]
fn a_failed_upload_keeps_the_sign_in_and_tries_again_next_time() {
    let fake = Fake::start();
    fake.knobs.lock().unwrap().health = true;
    let route = ("POST".to_string(), "/cli/v1/health/scans".to_string());
    fake.knobs.lock().unwrap().routes.insert(route.clone(), (500, vec![], vec![]));
    let env = fake.env("first-signin-fail");
    let root = repo(&env, Some("https://github.com/acme/my-site"));
    let err = login_in(&env, &root);
    assert!(err.contains("couldn't add it to your account just now"), "{err}");
    fake.knobs.lock().unwrap().routes.remove(&route);
    let err = login_in(&env, &root);
    assert!(err.contains("Added this repository"), "{err}");
}

#[test]
fn a_sign_in_the_service_gave_no_recording_scope_scans_nothing() {
    // Catches: scanning a whole repository for an upload the grant can't make.
    let fake = Fake::start();
    let env = fake.env("first-signin-noscope");
    let root = repo(&env, Some("https://github.com/acme/my-site"));
    let err = login_in(&env, &root);
    assert!(!err.contains("Scanning") && !err.contains("Not in a repository"), "{err}");
    assert_eq!(fake.hits("/cli/v1/health/scans"), 0);
}

#[test]
fn a_repo_already_added_by_detect_is_not_scanned_again_at_sign_in() {
    // Catches: an existing user's repository being rescanned on their next sign-in.
    let (fake, env) = signed_in("first-signin-after-detect");
    let root = repo(&env, Some("https://github.com/acme/my-site"));
    run(&env, &root, &["detect", "--json", "."]);
    assert_eq!(fake.hits("/cli/v1/health/scans"), 1);
    let err = login_in(&env, &root);
    assert!(!err.contains("Scanning"), "{err}");
    assert_eq!(fake.hits("/cli/v1/health/scans"), 1);
}

#[test]
fn a_telemetry_opt_out_still_gets_the_sign_in_scan_and_is_told_what_was_sent() {
    // Signing in is the consent for this one scan; the line says what left the machine.
    let fake = Fake::start();
    fake.knobs.lock().unwrap().health = true;
    let mut env = fake.env("first-signin-dnt");
    env.insert("DO_NOT_TRACK".into(), "1".into());
    let root = repo(&env, Some("https://github.com/acme/my-site"));
    let err = login_in(&env, &root);
    assert!(err.contains("Sent its name, finding counts and foundations checks, never your code or file names."), "{err}");
    assert_eq!(fake.hits("/cli/v1/health/scans"), 1);
    // Later scans still honor the opt-out.
    run(&env, &root, &["detect", "--json", "."]);
    assert_eq!(fake.hits("/cli/v1/health/scans"), 1);
}

#[test]
fn the_sign_in_scan_leaves_design_md_to_detect() {
    // Catches: file contents uploading during sign-in with their one-time notice swallowed.
    let fake = Fake::start();
    {
        let mut k = fake.knobs.lock().unwrap();
        k.health = true;
        k.design = true;
    }
    let env = fake.env("first-signin-design");
    let root = repo(&env, Some("https://github.com/acme/my-site"));
    std::fs::write(root.join("DESIGN.md"), "# Site\n").unwrap();
    login_in(&env, &root);
    assert_eq!(fake.hits("/cli/v1/health/scans"), 1);
    assert_eq!(fake.hits("/cli/v1/design"), 0);
    let out = run(&env, &root, &["detect", "."]);
    assert_eq!(fake.hits("/cli/v1/design"), 1);
    assert!(String::from_utf8_lossy(&out.stderr).contains("Uploaded your DESIGN.md"));
}

#[test]
fn foundations_alone_landing_counts_as_added() {
    // The foundations request is the one that founds the city.
    let fake = Fake::start();
    {
        let mut k = fake.knobs.lock().unwrap();
        k.health = true;
        k.foundations = true;
        k.routes.insert(("POST".into(), "/cli/v1/health/scans".into()), (500, vec![], vec![]));
    }
    let env = fake.env("first-signin-foundations");
    let root = repo(&env, Some("https://github.com/acme/my-site"));
    let err = login_in(&env, &root);
    assert!(err.contains("Added this repository"), "{err}");
    assert_eq!(fake.hits("/cli/v1/foundations"), 1);
    fake.knobs.lock().unwrap().routes.clear();
    login_in(&env, &root);
    assert_eq!(fake.hits("/cli/v1/foundations"), 1, "marked, no rescan");
}

#[test]
fn login_help_never_scans() {
    // Catches (review, Cursor): `login --help` exiting 0 and scanning the work tree.
    let (fake, env) = signed_in("first-signin-help");
    let root = repo(&env, Some("https://github.com/acme/my-site"));
    for flag in ["--help", "-h"] {
        let out = run(&env, &root, &["login", flag]);
        assert!(out.status.success());
        assert!(!String::from_utf8_lossy(&out.stderr).contains("Scanning"), "{flag}");
    }
    assert_eq!(fake.hits("/cli/v1/health/scans"), 0);
}

#[test]
fn a_sign_in_from_a_subdirectory_scans_with_the_root_config() {
    // Catches (review, Cursor): the root's ignoreRules skipped because detect read config from the subdirectory.
    let fake = Fake::start();
    fake.knobs.lock().unwrap().health = true;
    let env = fake.env("first-signin-subdir-config");
    let root = repo(&env, Some("https://github.com/acme/my-site"));
    std::fs::create_dir_all(root.join(".impeccable")).unwrap();
    std::fs::write(root.join(".impeccable/config.json"), r#"{"detector":{"ignoreRules":["cream-palette"]}}"#).unwrap();
    login_in(&env, &root.join("sub"));
    run(&env, &root, &["health", "forget"]);
    run(&env, &root, &["health", "on"]);
    run(&env, &root, &["detect", "--json", "."]);
    let all = scans(&fake);
    assert_eq!(all.len(), 2);
    assert_eq!(all[0]["rules"], all[1]["rules"]);
    assert_eq!(all[0]["rulesetId"], all[1]["rulesetId"]);
}
