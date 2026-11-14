#[path = "../../account/tests/support/fake.rs"]
mod fake;
use fake::{browser, Fake};
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::Path;
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
    let mut child = impeccable(
        env,
        Path::new(&env["IMPECCABLE_HOME"]),
        &["login", "--no-browser"],
    )
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

const META: &str = r#"{"target":"Pricing","total_score":24,"max_score":32,"na_heuristics":"7,10","p0_count":1,"p1_count":2}"#;
fn write(env: &HashMap<String, String>, root: &Path) -> Output {
    impeccable(
        env,
        root,
        &["critique-storage", "write", "pricing", "report.md"],
    )
    .env("IMPECCABLE_CRITIQUE_META", META)
    .output()
    .unwrap()
}
fn setup(name: &str) -> (Fake, HashMap<String, String>) {
    let fake = Fake::start();
    fake.knobs.lock().unwrap().critiques = true;
    let env = fake.env(name);
    login(&env);
    std::fs::write(
        Path::new(&env["IMPECCABLE_HOME"]).join("report.md"),
        "# Report
Crowded header.",
    )
    .unwrap();
    (fake, env)
}
#[test]
fn only_new_reports_upload_and_explicit_off_wins() {
    let (fake, env) = setup("critique-flow");
    let root = Path::new(&env["IMPECCABLE_HOME"]);
    impeccable(&env, root, &["critiques", "off"])
        .output()
        .unwrap();
    let first = write(&env, root);
    assert!(first.status.success());
    assert_eq!(fake.hits("/cli/v1/critiques"), 0);
    assert!(impeccable(&env, root, &["critiques", "on"])
        .output()
        .unwrap()
        .status
        .success());
    let next = write(&env, root);
    assert!(next.status.success());
    assert_eq!(next.stderr, first.stderr);
    let bodies = fake.record.lock().unwrap().critiques.clone();
    assert_eq!(bodies.len(), 1);
    let b = &bodies[0];
    assert_eq!(b["target"], "Pricing");
    assert_eq!(b["score"], serde_json::json!({"total":24,"max":32}));
    assert_eq!(b["na"], serde_json::json!([7, 10]));
    assert_eq!(b["heuristics"], serde_json::Value::Null);
    assert_eq!(
        b["counts"],
        serde_json::json!({"p0":1,"p1":2,"p2":null,"p3":null})
    );
    assert_eq!(
        b["body"],
        "# Report
Crowded header.
"
    );
    assert!(b.get("label").is_none());
    assert_eq!(b.as_object().unwrap().len(), 9);
    impeccable(&env, root, &["critique-storage", "latest", "pricing"])
        .output()
        .unwrap();
    impeccable(&env, root, &["hook-before-edit"])
        .output()
        .unwrap();
    assert_eq!(fake.hits("/cli/v1/critiques"), 1);
    impeccable(&env, root, &["critiques", "forget"])
        .output()
        .unwrap();
    assert_eq!(fake.hits("/cli/v1/critiques/forget"), 1);
    write(&env, root);
    assert_eq!(fake.hits("/cli/v1/critiques"), 1);
}
#[test]
fn gates_and_service_failures_preserve_the_saved_report() {
    let (fake, env) = setup("critique-gates");
    let root = Path::new(&env["IMPECCABLE_HOME"]);
    assert!(impeccable(&env, root, &["critiques", "on"])
        .output()
        .unwrap()
        .status
        .success());
    let mut ci = env.clone();
    ci.insert("CI".into(), "1".into());
    write(&ci, root);
    std::fs::create_dir_all(root.join(".impeccable")).unwrap();
    std::fs::write(
        root.join(".impeccable/config.json"),
        r#"{"reports":{"enabled":false}}"#,
    )
    .unwrap();
    write(&env, root);
    assert_eq!(fake.hits("/cli/v1/critiques"), 0);
    std::fs::write(
        root.join(".impeccable/config.json"),
        r#"{"reports":{"enabled":true}}"#,
    )
    .unwrap();
    for status in [404, 403, 500] {
        fake.route("POST", "/cli/v1/critiques", status, vec![], "{}");
        let out = write(&env, root);
        assert!(out.status.success());
        assert!(out.stderr.is_empty());
        assert!(Path::new(String::from_utf8_lossy(&out.stdout).trim()).is_file());
    }
    let gate = fake.hold("/cli/v1/critiques");
    let start = std::time::Instant::now();
    let out = write(&env, root);
    gate.open();
    assert!(out.status.success());
    assert!(start.elapsed() < std::time::Duration::from_secs(4));
}
#[test]
fn sign_in_requests_only_advertised_scopes_and_a_declined_scope_sends_nothing() {
    let fake = Fake::start();
    login(&fake.env("critique-scope-off"));
    fake.knobs.lock().unwrap().critiques = true;
    fake.knobs.lock().unwrap().critiques_denied = true;
    let env = fake.env("critique-scope-denied");
    login(&env);
    let root = Path::new(&env["IMPECCABLE_HOME"]);
    std::fs::write(root.join("report.md"), "Report").unwrap();
    assert!(impeccable(&env, root, &["critiques", "on"])
        .output()
        .unwrap()
        .status
        .success());
    write(&env, root);
    assert_eq!(fake.hits("/cli/v1/critiques"), 0);
    assert_eq!(
        fake.record.lock().unwrap().scopes,
        vec![
            "account:read rules:read",
            "account:read rules:read critiques:write"
        ]
    );
}

#[test]
fn native_reports_use_the_same_repo_key_from_subdirectories() {
    let (fake, env) = setup("critique-native");
    let root = Path::new(&env["IMPECCABLE_HOME"]);
    assert!(impeccable(&env, root, &["critiques", "on"])
        .output()
        .unwrap()
        .status
        .success());
    for args in [
        vec!["init", "-q"],
        vec!["remote", "add", "origin", "git@GitHub.com:acme/native.git"],
    ] {
        assert!(Command::new("git")
            .args(args)
            .current_dir(root)
            .status()
            .unwrap()
            .success());
    }
    std::fs::write(
        root.join("PRODUCT.md"),
        "# Product

## Platform

ios
",
    )
    .unwrap();
    std::fs::create_dir(root.join("sub")).unwrap();
    std::fs::copy(root.join("report.md"), root.join("sub/report.md")).unwrap();
    assert!(write(&env, &root.join("sub")).status.success());
    let r = fake.record.lock().unwrap();
    assert_eq!(r.critiques.len(), 1);
    use sha2::Digest;
    assert_eq!(
        r.critiques[0]["repoKey"],
        format!(
            "{:x}",
            sha2::Sha256::digest(b"https://github.com/acme/native")
        )
    );
}

#[test]
fn a_single_na_index_survives_the_saved_frontmatter_parser() {
    let (fake, env) = setup("critique-single-na");
    let root = Path::new(&env["IMPECCABLE_HOME"]);
    assert!(impeccable(&env, root, &["critiques", "on"])
        .output()
        .unwrap()
        .status
        .success());
    let out = impeccable(&env, root, &["critique-storage", "write", "pricing", "report.md"])
        .env("IMPECCABLE_CRITIQUE_META", r#"{"target":"Pricing","total_score":24,"max_score":36,"na_heuristics":"7","p0_count":0,"p1_count":0}"#).output().unwrap();
    assert!(out.status.success());
    let r = fake.record.lock().unwrap();
    assert_eq!(r.critiques.len(), 1);
    assert_eq!(r.critiques[0]["na"], serde_json::json!([7]));
}

#[test]
fn review_numeric_target_keeps_its_original_spelling() {
    let (fake, env) = setup("critique-numeric-target");
    let root = Path::new(&env["IMPECCABLE_HOME"]);
    assert!(impeccable(&env, root, &["critiques", "on"])
        .output()
        .unwrap()
        .status
        .success());
    let meta = META.replace("Pricing", "00404");
    let out = impeccable(
        &env,
        root,
        &["critique-storage", "write", "pricing", "report.md"],
    )
    .env("IMPECCABLE_CRITIQUE_META", meta)
    .output()
    .unwrap();
    assert!(out.status.success());
    let r = fake.record.lock().unwrap();
    assert_eq!(r.critiques.len(), 1);
    assert_eq!(r.critiques[0]["target"], "00404");
}

#[test]
fn unsafe_or_oversized_inputs_are_not_saved_or_uploaded() {
    let (fake, env) = setup("critique-input-boundary");
    let root = Path::new(&env["IMPECCABLE_HOME"]);
    impeccable(&env, root, &["critiques", "on"])
        .output()
        .unwrap();
    std::fs::write(root.join("report.md"), vec![b'x'; 65537]).unwrap();
    assert!(!write(&env, root).status.success());
    #[cfg(unix)]
    {
        std::fs::remove_file(root.join("report.md")).unwrap();
        let outside =
            std::env::temp_dir().join(format!("critique-outside-{}.md", std::process::id()));
        std::fs::write(&outside, "External temporary report").unwrap();
        std::os::unix::fs::symlink(&outside, root.join("report.md")).unwrap();
        assert!(!write(&env, root).status.success());
        std::fs::remove_file(root.join("report.md")).unwrap();
        let out = impeccable(
            &env,
            root,
            &[
                "critique-storage",
                "write",
                "pricing",
                outside.to_str().unwrap(),
            ],
        )
        .env("IMPECCABLE_CRITIQUE_META", META)
        .output()
        .unwrap();
        std::fs::remove_file(outside).unwrap();
        assert!(out.status.success());
        assert_eq!(fake.hits("/cli/v1/critiques"), 1);
    }
}

#[test]
fn multiline_metadata_never_becomes_report_body() {
    let (fake, env) = setup("critique-multiline");
    let root = Path::new(&env["IMPECCABLE_HOME"]);
    impeccable(&env, root, &["critiques", "on"])
        .output()
        .unwrap();
    let mut meta: serde_json::Value = serde_json::from_str(META).unwrap();
    meta["notes"] = "Internal notes\n---\nprivate context".into();
    meta["list_notes"] = serde_json::json!(["one\n---\nprivate", "two"]);
    let out = impeccable(
        &env,
        root,
        &["critique-storage", "write", "pricing", "report.md"],
    )
    .env("IMPECCABLE_CRITIQUE_META", meta.to_string())
    .output()
    .unwrap();
    assert!(out.status.success());
    let saved = std::fs::read_to_string(
        String::from_utf8(out.stdout)
            .unwrap()
            .lines()
            .next()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        impeccable_context::critique_storage::parse_frontmatter(&saved)["notes"],
        meta["notes"]
    );
    assert_eq!(
        impeccable_context::critique_storage::parse_frontmatter(&saved)["list_notes"],
        "one\n---\nprivate,two"
    );
    assert!(saved.contains(r#"notes: "Internal notes\n---\nprivate context""#));
    assert_eq!(
        fake.record.lock().unwrap().critiques[0]["body"],
        "# Report\nCrowded header.\n"
    );
}

#[test]
fn encoded_requests_over_the_server_limit_are_skipped() {
    let (fake, env) = setup("critique-json-size");
    let root = Path::new(&env["IMPECCABLE_HOME"]);
    impeccable(&env, root, &["critiques", "on"])
        .output()
        .unwrap();
    std::fs::write(root.join("report.md"), "\\".repeat(50000)).unwrap();
    assert!(write(&env, root).status.success());
    assert_eq!(fake.hits("/cli/v1/critiques"), 0);
}

#[test]
fn forget_404_leaves_sync_off_and_reports_unconfirmed_deletion() {
    let (fake, env) = setup("critique-forget-unconfirmed");
    let root = Path::new(&env["IMPECCABLE_HOME"]);
    impeccable(&env, root, &["critiques", "on"])
        .output()
        .unwrap();
    fake.knobs.lock().unwrap().critiques = false;
    let out = impeccable(&env, root, &["critiques", "forget"])
        .output()
        .unwrap();
    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr)
        .contains("deleting your history couldn't be confirmed"));
    fake.knobs.lock().unwrap().critiques = true;
    write(&env, root);
    assert_eq!(fake.hits("/cli/v1/critiques"), 0);
}

#[test]
fn off_and_forget_wait_for_an_admitted_upload_to_finish() {
    for choice in ["off", "forget"] {
        let (fake, env) = setup(&format!("critique-{choice}-lock"));
        let root = Path::new(&env["IMPECCABLE_HOME"]);
        impeccable(&env, root, &["critiques", "on"])
            .output()
            .unwrap();
        let gate = fake.hold("/cli/v1/critiques");
        let mut upload = impeccable(
            &env,
            root,
            &["critique-storage", "write", "pricing", "report.md"],
        )
        .env("IMPECCABLE_CRITIQUE_META", META)
        .stdout(Stdio::null())
        .spawn()
        .unwrap();
        fake.wait_for_hits("/cli/v1/critiques", 1);
        let mut off = impeccable(&env, root, &["critiques", choice])
            .stdout(Stdio::null())
            .spawn()
            .unwrap();
        std::thread::sleep(std::time::Duration::from_millis(150));
        let waited = off.try_wait().unwrap().is_none();
        gate.open();
        assert!(upload.wait().unwrap().success());
        assert!(off.wait().unwrap().success());
        assert!(
            waited,
            "{choice} returned while the uploader still held admission"
        );
        write(&env, root);
        assert_eq!(fake.hits("/cli/v1/critiques"), 1);
    }
}

#[test]
fn expired_tokens_are_renewed_without_abandoning_rotation() {
    let fake = Fake::start();
    {
        let mut k = fake.knobs.lock().unwrap();
        k.critiques = true;
        k.access_ttl = 0;
    }
    let env = fake.env("critique-renewal");
    login(&env);
    let root = Path::new(&env["IMPECCABLE_HOME"]);
    std::fs::write(root.join("report.md"), "Report").unwrap();
    impeccable(&env, root, &["critiques", "on"])
        .output()
        .unwrap();
    fake.knobs.lock().unwrap().access_ttl = 900;
    let before = fake.hits("/oauth/token");
    let gate = fake.hold("/oauth/token");
    let start = std::time::Instant::now();
    assert!(write(&env, root).status.success());
    assert!(start.elapsed() < std::time::Duration::from_secs(4));
    let refreshed = fake.hits("/oauth/token") > before;
    gate.open();
    assert!(refreshed, "the expired token was never renewed");
    // whoami waits for refresh persistence under the ordinary lifecycle lock.
    assert!(impeccable(&env, root, &["whoami", "--json"])
        .output()
        .unwrap()
        .status
        .success());
    assert!(write(&env, root).status.success());
    assert_eq!(fake.hits("/cli/v1/critiques"), 1);
}

#[test]
fn quick_renewal_uploads_the_same_report_and_a_busy_lifecycle_lock_skips_it() {
    let fake = Fake::start();
    {
        let mut k = fake.knobs.lock().unwrap();
        k.critiques = true;
        k.access_ttl = 0;
    }
    let env = fake.env("critique-quick-renewal");
    login(&env);
    let root = Path::new(&env["IMPECCABLE_HOME"]);
    std::fs::write(root.join("report.md"), "Report").unwrap();
    impeccable(&env, root, &["critiques", "on"])
        .output()
        .unwrap();
    fake.knobs.lock().unwrap().access_ttl = 900;
    let account = impeccable_account::config::Account::from_env(&env).unwrap();
    let store = impeccable_account::store::Store::new(&account);
    let held = store.lock_for(std::time::Duration::ZERO).unwrap();
    let before = fake.hits("/oauth/token");
    let start = std::time::Instant::now();
    assert!(write(&env, root).status.success());
    assert!(start.elapsed() < std::time::Duration::from_secs(4));
    assert_eq!(fake.hits("/cli/v1/critiques"), 0);
    assert_eq!(fake.hits("/oauth/token"), before);
    drop(held);
    assert!(write(&env, root).status.success());
    assert_eq!(fake.hits("/cli/v1/critiques"), 1);
}

#[test]
fn a_busy_admission_lock_is_bounded_and_never_claims_an_optout() {
    let (fake, env) = setup("critique-busy-admission");
    let root = Path::new(&env["IMPECCABLE_HOME"]);
    impeccable(&env, root, &["critiques", "on"])
        .output()
        .unwrap();
    let held = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(root.join("critiques.lock"))
        .unwrap();
    held.try_lock().unwrap();
    assert!(write(&env, root).status.success());
    assert_eq!(fake.hits("/cli/v1/critiques"), 0);
    let start = std::time::Instant::now();
    let out = impeccable(&env, root, &["critiques", "off"])
        .output()
        .unwrap();
    assert!(start.elapsed() < std::time::Duration::from_secs(5));
    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains("couldn't save the setting"));
    drop(held);
    assert!(write(&env, root).status.success());
    assert_eq!(fake.hits("/cli/v1/critiques"), 1);
}

#[test]
fn invalid_service_settings_never_prevent_local_optout() {
    let (_fake, env) = setup("critique-invalid-service-optout");
    let root = Path::new(&env["IMPECCABLE_HOME"]);
    let mut invalid = env.clone();
    invalid.insert("IMPECCABLE_ACCOUNT_URL".into(), "not an origin".into());
    for choice in ["off", "forget"] {
        impeccable(&env, root, &["critiques", "on"])
            .output()
            .unwrap();
        let out = impeccable(&invalid, root, &["critiques", choice])
            .output()
            .unwrap();
        if choice == "off" {
            assert!(out.status.success());
        } else {
            assert!(!out.status.success());
            assert!(String::from_utf8_lossy(&out.stderr)
                .contains("deleting your history couldn't be confirmed"));
        }
        let status = impeccable(&env, root, &["critiques", "status"])
            .output()
            .unwrap();
        assert_eq!(status.stdout, b"Critique sync: off.\n");
    }
}

#[test]
fn repo_labels_use_the_remote_name_and_are_omitted_when_unavailable() {
    for (name, remote, expected) in [
        (
            "named",
            Some("git@GitHub.com:acme/remote-repo.git"),
            Some("remote-repo"),
        ),
        ("local", None, None),
        ("invalid", Some("git@github.com:acme/bad\\name.git"), None),
    ] {
        let (fake, env) = setup(&format!("critique-label-{name}"));
        let root = Path::new(&env["IMPECCABLE_HOME"]);
        assert!(Command::new("git")
            .args(["init", "-q"])
            .current_dir(root)
            .status()
            .unwrap()
            .success());
        if let Some(remote) = remote {
            assert!(Command::new("git")
                .args(["remote", "add", "origin", remote])
                .current_dir(root)
                .status()
                .unwrap()
                .success());
        }
        impeccable(&env, root, &["critiques", "on"])
            .output()
            .unwrap();
        assert!(write(&env, root).status.success());
        let record = fake.record.lock().unwrap();
        assert_eq!(record.critiques.len(), 1);
        let body = &record.critiques[0];
        assert!(body["repoKey"].as_str().is_some());
        assert_eq!(
            body.get("label").and_then(serde_json::Value::as_str),
            expected
        );
        if expected.is_none() {
            assert!(body.get("label").is_none());
        }
    }
}

#[test]
fn the_service_accepts_optional_labels_only_with_repo_keys() {
    use impeccable_account::{
        config::Account,
        http::ApiError,
        session::{Session, SessionError},
    };
    let (fake, env) = setup("critique-label-contract");
    let mut session = Session::load(&Account::from_env(&env).unwrap()).unwrap();
    let url = format!("{}/cli/v1/critiques", fake.url);
    let mut body = serde_json::json!({
        "version": 1, "critiqueId": "00000000-0000-4000-8000-000000000001",
        "createdAt": impeccable_context::util::iso_now(), "target": "Pricing",
        "score": {"total": 24, "max": 40}, "na": [], "counts": {"p0": 0, "p1": 0}, "body": "Report"
    });
    for label in [
        serde_json::Value::Null,
        serde_json::json!("repo"),
        serde_json::json!("  repo  "),
        serde_json::json!("repo\\secret"),
        serde_json::json!("\tname"),
        serde_json::json!("\u{FEFF}name"),
        serde_json::json!("a\u{E0001}b"),
        serde_json::json!("x".repeat(101)),
        serde_json::json!("   "),
        serde_json::json!(7),
    ] {
        for key in [serde_json::Value::Null, serde_json::json!("a".repeat(64))] {
            body["label"] = label.clone();
            body["repoKey"] = key.clone();
            let allowed = label.is_null()
                || (!key.is_null() && ["repo", "  repo  "].contains(&label.as_str().unwrap_or("")));
            let result = session.call(|client, token| client.post_json(&url, token, body.clone()));
            if allowed {
                assert!(result.is_ok(), "{label:?}: {result:?}");
            } else {
                assert!(matches!(
                    result,
                    Err(SessionError::Api(ApiError::Status { status: 400, .. }))
                ));
            }
        }
    }
}

#[test]
fn critique_notice_is_once_after_success_and_again_after_sign_in() {
    let (fake, env) = setup("critique-notice");
    let root = Path::new(&env["IMPECCABLE_HOME"]);
    let notice = "Uploaded this critique report to your Impeccable account. Each report you save uploads too. To stop: impeccable critiques off\n";
    let hook = impeccable(&env, root, &["hook-before-edit"])
        .output()
        .unwrap();
    assert!(!String::from_utf8_lossy(&hook.stdout).contains(notice));
    assert!(!String::from_utf8_lossy(&hook.stderr).contains(notice));
    assert_eq!(fake.hits("/cli/v1/critiques"), 0);
    for flag in ["--json", "--quiet", "--github"] {
        let out = impeccable(
            &env,
            root,
            &["critique-storage", "write", "pricing", "report.md", flag],
        )
        .env("IMPECCABLE_CRITIQUE_META", META)
        .output()
        .unwrap();
        assert!(out.status.success());
        assert!(!String::from_utf8_lossy(&out.stdout).contains(notice));
        assert!(!String::from_utf8_lossy(&out.stderr).contains(notice));
    }
    let before = fake.hits("/cli/v1/critiques");
    assert_eq!(before, 3);
    let first = write(&env, root);
    assert!(first.status.success());
    assert!(String::from_utf8_lossy(&first.stdout).ends_with(notice));
    assert!(!String::from_utf8_lossy(&first.stderr).contains(notice));
    let second = write(&env, root);
    assert!(!String::from_utf8_lossy(&second.stdout).contains(notice));
    assert_eq!(fake.hits("/cli/v1/critiques"), before + 2);
    login(&env);
    assert!(String::from_utf8_lossy(&write(&env, root).stdout).ends_with(notice));
}

const STALE_NOTICE: &str = "Saving to your Impeccable account needs a fresh sign-in. Run impeccable login to turn it on.\n";

#[test]
fn stale_sign_in_notice_is_shared_and_status_checks_current_offerings() {
    let fake = Fake::start();
    let env = fake.env("stale-shared");
    login(&env);
    let root = Path::new(&env["IMPECCABLE_HOME"]);
    std::fs::write(root.join("report.md"), "Report").unwrap();
    let metadata = "/.well-known/oauth-authorization-server";
    let before = fake.hits(metadata);
    // A service that does not offer the scope keeps the existing status.
    assert!(!String::from_utf8_lossy(&write(&env, root).stderr).contains(STALE_NOTICE));
    let status = impeccable(&env, root, &["critiques", "status"])
        .output()
        .unwrap();
    assert_eq!(
        String::from_utf8_lossy(&status.stdout),
        "Critique sync: on.\n"
    );
    assert!(fake.hits(metadata) > before);
    {
        let mut k = fake.knobs.lock().unwrap();
        k.critiques = true;
        k.health = true;
        k.setup = true;
    }
    for flag in ["--quiet", "--json"] {
        let out = impeccable(
            &env,
            root,
            &["critique-storage", "write", "pricing", "report.md", flag],
        )
        .env("IMPECCABLE_CRITIQUE_META", META)
        .output()
        .unwrap();
        assert!(!String::from_utf8_lossy(&out.stderr).contains(STALE_NOTICE));
    }
    let hook = impeccable(&env, root, &["hook-before-edit"])
        .output()
        .unwrap();
    assert!(!String::from_utf8_lossy(&hook.stderr).contains(STALE_NOTICE));
    assert_eq!(
        String::from_utf8_lossy(&write(&env, root).stderr),
        STALE_NOTICE
    );
    let before = fake.hits(metadata);
    assert!(write(&env, root).stderr.is_empty());
    assert_eq!(fake.hits(metadata), before);
    for (args, expected) in [
        (
            vec!["critiques", "status"],
            "Critique sync: on, but this sign-in can't save yet. Run impeccable login.\n",
        ),
        (
            vec!["setup", "status"],
            "Setup status: on, but this sign-in can't save yet. Run impeccable login.\n",
        ),
    ] {
        let out = impeccable(&env, root, &args).output().unwrap();
        assert!(out.status.success());
        assert_eq!(String::from_utf8_lossy(&out.stdout), expected);
    }
    // Sign-ins from before 4.9 stored no scopes, so a missing health:write in
    // the record is not evidence: status stays plain until the service refuses
    // an upload (review: Cursor and Greptile on 44c6aa146)...
    let status = impeccable(&env, root, &["health", "status"])
        .output()
        .unwrap();
    assert!(
        String::from_utf8_lossy(&status.stdout).starts_with("Design health: on. Each full"),
        "{}",
        String::from_utf8_lossy(&status.stdout)
    );
    assert!(Command::new("git")
        .args(["init", "-q"])
        .current_dir(root)
        .status()
        .unwrap()
        .success());
    std::fs::write(root.join("page.html"), "<h1>Hello</h1>").unwrap();
    let out = impeccable(&env, root, &["detect", "."]).output().unwrap();
    assert!(fake.hits("/cli/v1/health/scans") > 0);
    assert!(!String::from_utf8_lossy(&out.stderr).contains(STALE_NOTICE));
    assert!(!String::from_utf8_lossy(&out.stderr).contains("can't save scan results"));
    // ...and the service refusing it (403) is what makes status say so.
    let status = impeccable(&env, root, &["health", "status"])
        .output()
        .unwrap();
    assert_eq!(
        String::from_utf8_lossy(&status.stdout),
        "Design health: on, but this sign-in can't save yet. Run impeccable login.\n"
    );
    login(&env);
    let before = fake.hits(metadata);
    for args in [
        vec!["critiques", "status"],
        vec!["health", "status"],
        vec!["setup", "status"],
    ] {
        let out = impeccable(&env, root, &args).output().unwrap();
        assert!(String::from_utf8_lossy(&out.stdout).contains(": on."));
    }
    assert!(!String::from_utf8_lossy(&write(&env, root).stderr).contains(STALE_NOTICE));
    assert_eq!(fake.hits(metadata), before);
}

#[test]
fn unavailable_metadata_keeps_plain_status_and_leaves_notice_owed() {
    let fake = Fake::start();
    let env = fake.env("stale-metadata-failure");
    login(&env);
    let root = Path::new(&env["IMPECCABLE_HOME"]);
    std::fs::write(root.join("report.md"), "Report").unwrap();
    fake.knobs.lock().unwrap().critiques = true;
    fake.route(
        "GET",
        "/.well-known/oauth-authorization-server",
        500,
        vec![],
        "{}",
    );
    assert!(!String::from_utf8_lossy(&write(&env, root).stderr).contains(STALE_NOTICE));
    let out = impeccable(&env, root, &["critiques", "status"])
        .output()
        .unwrap();
    assert_eq!(out.stdout, b"Critique sync: on.\n");
    let account = impeccable_account::config::Account::from_env(&env).unwrap();
    let state = impeccable_account::store::Store::new(&account)
        .state()
        .unwrap();
    assert!(!account
        .dir()
        .join(format!("stale-grant-notice-{}", state.login))
        .exists());
}

// Catches an audit saved but never uploaded, uploaded unmarked (it would read as a critique out of 40), or one
// whose score cannot be an audit's reaching the account.
#[test]
fn a_saved_audit_uploads_marked_as_an_audit() {
    let (fake, env) = setup("audit-upload");
    let root = Path::new(&env["IMPECCABLE_HOME"]);
    assert!(impeccable(&env, root, &["critiques", "on"]).output().unwrap().status.success());
    let audit = |meta: &str| {
        impeccable(&env, root, &["audit-storage", "write", ".", "report.md"])
            .env("IMPECCABLE_REPORT_META", meta)
            .output()
            .unwrap()
    };
    let out = audit(r#"{"target":".","total_score":14,"max_score":20,"p0_count":0,"p1_count":2,"p2_count":3,"p3_count":1}"#);
    assert!(out.status.success());
    assert!(String::from_utf8_lossy(&out.stdout).contains("audit"));
    assert!(audit(r#"{"target":".","total_score":30,"max_score":40,"p0_count":0,"p1_count":0}"#).status.success());
    let r = fake.record.lock().unwrap();
    assert_eq!(r.critiques.len(), 1);
    let c = &r.critiques[0];
    assert_eq!((c["kind"].as_str(), c["score"]["max"].as_u64(), c["counts"]["p2"].as_u64()), (Some("audit"), Some(20), Some(3)));
    assert!(r.critiques.iter().all(|c| c["na"] == serde_json::json!([])));
}
