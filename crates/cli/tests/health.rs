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
    assert_eq!(body["label"], "my-site");
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
    // A repo without a remote keeps a random id, ignored by git.
    let id = root.join(".impeccable/health/repo-id");
    assert!(id.exists());
    let ignored = Command::new("git")
        .arg("-C")
        .arg(&root)
        .args(["check-ignore", "-q", ".impeccable/health/repo-id"])
        .status()
        .unwrap()
        .success();
    assert!(ignored);

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
