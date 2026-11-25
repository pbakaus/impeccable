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
    login_with(env, &[]);
}

/// `extra`: `--force` for a second sign-in to an account already signed in.
fn login_with(env: &HashMap<String, String>, extra: &[&str]) {
    let args: Vec<&str> = ["login", "--no-browser"].iter().chain(extra).copied().collect();
    let mut child = impeccable(
        env,
        Path::new(&env["IMPECCABLE_HOME"]),
        &args,
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

const META: &str = r#"{"target":"Pricing","total_score":24,"max_score":32,"na_heuristics":"7,10","p0_count":1,"p1_count":2,"p2_count":3,"p3_count":4,"title":"Pricing plans","heuristics":[{"n":1,"score":4},{"n":2,"score":3}]}"#;
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
/// The line a save printed after the report's path, if any.
fn said(out: &Output) -> String {
    let text = String::from_utf8_lossy(&out.stdout).into_owned();
    let mut lines = text.lines();
    assert!(Path::new(lines.next().unwrap_or("").trim()).is_file(), "{text}");
    lines.collect::<Vec<_>>().join("\n")
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
    assert_eq!(b["title"], "Pricing plans");
    assert_eq!(b["heuristics"], serde_json::json!([{"n":1,"score":4},{"n":2,"score":3}]));
    assert_eq!(
        b["counts"],
        serde_json::json!({"p0":1,"p1":2,"p2":3,"p3":4})
    );
    assert_eq!(
        b["body"],
        "# Report
Crowded header.
"
    );
    assert!(b.get("label").is_none());
    assert_eq!(b.as_object().unwrap().len(), 10);
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
    assert_eq!(said(&write(&ci, root)), "");
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
    // Every refusal keeps the report and says why in one line, with the fix.
    for (status, reason) in [
        (401, "your sign-in expired; sign in again with npx impeccable login"),
        (403, "this sign-in can't save critiques; sign in again with npx impeccable login"),
        (409, "it was made before you deleted your critique history"),
        (429, "you've reached the upload limit (10 a minute, 200 a day); run it again later to save it"),
        (404, "Impeccable had a problem; the report is saved locally. Run it again to save it."),
        (500, "Impeccable had a problem; the report is saved locally. Run it again to save it."),
    ] {
        fake.route("POST", "/cli/v1/critiques", status, vec![], "{}");
        let out = write(&env, root);
        assert!(out.status.success());
        assert!(out.stderr.is_empty());
        assert_eq!(said(&out), format!("Not saved to Impeccable: {reason}"), "HTTP {status}");
    }
    let gate = fake.hold("/cli/v1/critiques");
    let start = std::time::Instant::now();
    let out = write(&env, root);
    gate.open();
    assert!(out.status.success());
    assert!(start.elapsed() < std::time::Duration::from_secs(4));
    assert!(said(&out).starts_with("Not saved to Impeccable: "), "{}", said(&out));
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
fn optional_metadata_is_cleaned_without_losing_the_upload() {
    let (fake, env) = setup("critique-optional-metadata");
    let root = Path::new(&env["IMPECCABLE_HOME"]);
    let title = format!("  Plans\t \n\u{200e}{}\0  ", "界".repeat(200));
    for (title, expected) in [
        (title, Some(format!("Plans {}", "界".repeat(114)))),
        (" \0\u{200d} \n".into(), None),
    ] {
        let mut meta: serde_json::Value = serde_json::from_str(META).unwrap();
        meta["title"] = title.into();
        meta["heuristics"] = serde_json::json!([
            {"n":1,"score":4}, {"n":0,"score":2}, {"n":2,"score":5},
            {"n":3,"score":"2"}, {"n":4.5,"score":2}, null,
            {"n":1,"score":2}, {"n":9,"score":0}
        ]);
        meta["p2_count"] = (-1).into();
        meta["p3_count"] = 101.into();
        let out = impeccable(&env, root, &["critique-storage", "write", "pricing", "report.md"])
            .env("IMPECCABLE_CRITIQUE_META", meta.to_string()).output().unwrap();
        assert!(out.status.success());
        let records = fake.record.lock().unwrap();
        let b = records.critiques.last().expect("upload landed");
        assert_eq!(b.get("title").and_then(|v| v.as_str()), expected.as_deref());
        assert_eq!(b["heuristics"], serde_json::json!([{"n":1,"score":4},{"n":9,"score":0}]));
        assert!(b["counts"]["p2"].is_null());
        assert!(b["counts"]["p3"].is_null());
        let path = String::from_utf8_lossy(&out.stdout).lines().next().unwrap().to_string();
        let saved = std::fs::read_to_string(path).unwrap();
        let front = impeccable_context::critique_storage::parse_frontmatter(&saved);
        assert_eq!(front.get("title").and_then(|v| v.as_str()), expected.as_deref());
        assert_eq!(front["heuristics"], b["heuristics"]);
        assert!(!front.contains_key("p2_count"));
        assert!(!front.contains_key("p3_count"));
    }
    assert_eq!(fake.hits("/cli/v1/critiques"), 2);
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
fn repo_labels_use_the_remote_or_folder_name_and_are_omitted_when_invalid() {
    for (name, remote, expected) in [
        (
            "named",
            Some("git@GitHub.com:acme/remote-repo.git"),
            Some("remote-repo"),
        ),
        // No remote: the folder's name (Paul, REN-2028).
        ("local", None, Some("<folder>")),
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
        let expected = if expected == Some("<folder>") { root.file_name().and_then(|n| n.to_str()) } else { expected };
        assert_eq!(
            body.get("label").and_then(serde_json::Value::as_str),
            expected
        );
        if expected.is_none() {
            assert!(body.get("label").is_none());
        }
        // Only a repo with no remote names its place: the parent folder (REN-2313).
        let place = remote.is_none().then(|| root.parent().and_then(|p| p.file_name()).and_then(|n| n.to_str())).flatten();
        assert_eq!(body.get("place").and_then(serde_json::Value::as_str), place);
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
fn every_save_links_its_critique_and_the_first_on_a_sign_in_says_how_to_stop() {
    let (fake, env) = setup("critique-notice");
    let root = Path::new(&env["IMPECCABLE_HOME"]);
    let stop = "\nEvery critique you save uploads; to stop: impeccable critiques off";
    let hook = impeccable(&env, root, &["hook-before-edit"])
        .output()
        .unwrap();
    assert!(!String::from_utf8_lossy(&hook.stdout).contains("Impeccable:"));
    assert!(!String::from_utf8_lossy(&hook.stderr).contains("Impeccable:"));
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
        assert!(!String::from_utf8_lossy(&out.stdout).contains("Impeccable:"));
        assert!(out.stderr.is_empty());
    }
    let before = fake.hits("/cli/v1/critiques");
    assert_eq!(before, 3);
    let page = |n: usize| {
        format!(
            "Saved to Impeccable: {}/app/-/critiques?report=fake{n}",
            fake.url
        )
    };
    let first = write(&env, root);
    assert!(first.status.success());
    assert_eq!(said(&first), page(4) + stop);
    assert!(first.stderr.is_empty());
    assert_eq!(said(&write(&env, root)), page(5));
    assert_eq!(fake.hits("/cli/v1/critiques"), before + 2);
    login_with(&env, &["--force"]);
    assert_eq!(said(&write(&env, root)), page(6) + stop);
    // A service that answers without a link (its critiques page off) still says it saved.
    fake.route(
        "POST",
        "/cli/v1/critiques",
        200,
        vec![],
        r#"{"outcome":"recorded"}"#,
    );
    assert_eq!(said(&write(&env, root)), "Saved to Impeccable.");
}

// Catches a sign-in offer, hint or nudge reaching someone who isn't signed in.
#[test]
fn signed_out_install_and_critique_never_mention_signing_in() {
    let fake = Fake::start();
    let env = fake.env("critique-signed-out");
    let root = Path::new(&env["IMPECCABLE_HOME"]);
    std::fs::create_dir_all(root).unwrap();
    let mentions = |text: &str| {
        let text = text.to_ascii_lowercase();
        ["login", "sign in", "sign-in"].iter().any(|w| text.contains(w))
    };

    // A local bundle, with the engine binary staged so install stays offline.
    let bundle = root.join("bundle/.claude/skills/impeccable");
    std::fs::create_dir_all(bundle.join("scripts")).unwrap();
    std::fs::write(bundle.join("SKILL.md"), "---\nname: impeccable\n---\n# impeccable\n").unwrap();
    std::fs::write(bundle.join("scripts/VERSION"), "9.9.9\n").unwrap();
    std::fs::write(bundle.join("scripts/impeccable"), "#!/bin/sh\nexit 0\n").unwrap();
    if let Some((os, arch)) = impeccable_skills::engine_binary::platform_tag() {
        let bin = bundle.join(format!("scripts/bin/{os}-{arch}"));
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(bin.join("impeccable"), "#!/bin/sh\nexit 0\n").unwrap();
    }
    let project = root.join("project");
    std::fs::create_dir_all(project.join(".git")).unwrap();
    let out = impeccable(&env, &project, &["install", "-y", "--providers=claude", "--scope=project", "--no-hooks"])
        .env("IMPECCABLE_BUNDLE_PATH", root.join("bundle"))
        .env("TMPDIR", root)
        .env("IMPECCABLE_NO_UPDATE_CHECK", "1")
        .output()
        .unwrap();
    let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    assert!(out.status.success(), "{text}");
    assert!(text.contains("Done!"), "{text}");
    assert!(!mentions(&text), "{text}");

    std::fs::write(root.join("report.md"), "# Report\nCrowded header.").unwrap();
    let out = write(&env, root);
    assert_eq!(said(&out), "");
    assert!(!mentions(&String::from_utf8_lossy(&out.stderr)));
    assert_eq!(fake.hits("/cli/v1/critiques"), 0);
}

const STALE_NOTICE: &str = "Saving to your Impeccable account needs a fresh sign-in. Run npx impeccable login to turn it on.\n";

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
    // A quiet save said nothing, so the shared notice is still owed.
    let owed = |root: &Path| {
        std::fs::read_dir(root.join("account"))
            .into_iter()
            .flatten()
            .flatten()
            .flat_map(|d| std::fs::read_dir(d.path()).into_iter().flatten().flatten())
            .all(|f| !f.file_name().to_string_lossy().starts_with("stale-grant-notice-"))
    };
    assert!(owed(root));
    let hook = impeccable(&env, root, &["hook-before-edit"])
        .output()
        .unwrap();
    assert!(!String::from_utf8_lossy(&hook.stderr).contains(STALE_NOTICE));
    // Once the service offers the scope, each save says why it wasn't saved.
    let cant = "Not saved to Impeccable: this sign-in can't save critiques; sign in again with npx impeccable login";
    let out = write(&env, root);
    assert!(out.stderr.is_empty());
    assert_eq!(said(&out), cant);
    let before = fake.hits(metadata);
    let out = write(&env, root);
    assert!(out.stderr.is_empty());
    assert_eq!(said(&out), cant);
    assert_eq!(fake.hits(metadata), before);
    for (args, expected) in [
        (
            vec!["critiques", "status"],
            "Critique sync: on, but this sign-in can't save yet. Run npx impeccable login.\n",
        ),
        (
            vec!["setup", "status"],
            "Setup status: on, but this sign-in can't save yet. Run npx impeccable login.\n",
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
        "Design health: on, but this sign-in can't save yet. Run npx impeccable login.\n"
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

// Catches an audit saved but never uploaded, uploaded unmarked (it would read as a critique out of 40), one whose
// score cannot be an audit's reaching the account, or a linked file uploaded as an audit.
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
    // An audit uploads now, so a link in place of its report is refused as a critique's is.
    #[cfg(unix)]
    {
        let outside = std::env::temp_dir().join(format!("audit-outside-{}.md", std::process::id()));
        std::fs::write(&outside, "Not a report").unwrap();
        std::fs::remove_file(root.join("report.md")).unwrap();
        std::os::unix::fs::symlink(&outside, root.join("report.md")).unwrap();
        assert!(!audit(r#"{"target":".","total_score":14,"max_score":20,"p0_count":0,"p1_count":0}"#).status.success());
        std::fs::remove_file(outside).unwrap();
    }
    let r = fake.record.lock().unwrap();
    assert_eq!(r.critiques.len(), 1);
    let c = &r.critiques[0];
    assert_eq!((c["kind"].as_str(), c["score"]["max"].as_u64(), c["counts"]["p2"].as_u64()), (Some("audit"), Some(20), Some(3)));
    assert!(r.critiques.iter().all(|c| c["na"] == serde_json::json!([])));
}

#[test]
fn an_accepted_variant_records_the_prototype_once_and_never_when_opted_out() {
    let (fake, env) = setup("prototype-accept");
    let root = Path::new(&env["IMPECCABLE_HOME"]);
    let id = "ab12cd34";
    std::fs::write(
        root.join("index.html"),
        format!(
            "<!-- impeccable-variants-start {id} -->\n<div data-impeccable-variants=\"{id}\" data-impeccable-variant-count=\"3\" style=\"display: contents\">\n<div data-impeccable-variant=\"original\"><h1>Old</h1></div>\n<div data-impeccable-variant=\"1\"><h1>New</h1></div>\n</div>\n<!-- impeccable-variants-end {id} -->\n"
        ),
    )
    .unwrap();
    let sessions = root.join(".impeccable/live/sessions");
    std::fs::create_dir_all(&sessions).unwrap();
    std::fs::write(
        sessions.join(format!("{id}.jsonl")),
        format!("{}\n", serde_json::json!({"seq": 1, "id": id, "type": "generate", "ts": "2026-11-16T10:00:00.000Z",
            "event": {"id": id, "type": "generate", "pageUrl": "http://localhost:5173/pricing?plan=pro#top", "count": 3}})),
    )
    .unwrap();
    let accept = || impeccable(&env, root, &["live-accept", "--id", id, "--variant", "1"]).output().unwrap();
    // The accept's stdout stays one JSON result and nothing is said on stderr.
    let first = accept();
    assert!(first.status.success());
    let result: serde_json::Value = serde_json::from_slice(&first.stdout).unwrap();
    assert_eq!(result["handled"], true);
    assert!(first.stderr.is_empty(), "{}", String::from_utf8_lossy(&first.stderr));
    // A replayed accept sends the same id, so the service counts it once.
    assert!(accept().status.success());
    let sent = fake.record.lock().unwrap().prototypes.clone();
    assert_eq!(sent.len(), 2);
    assert_eq!(sent[0]["prototypeId"], sent[1]["prototypeId"]);
    assert_eq!((sent[0]["target"].as_str(), sent[0]["variants"].as_u64()), (Some("/pricing"), Some(3)));
    // Exactly these keys: no repoKey outside a repository, nothing of the variants.
    let mut keys: Vec<_> = sent[0].as_object().unwrap().keys().cloned().collect();
    keys.sort();
    assert_eq!(keys, ["createdAt", "prototypeId", "target", "variants"]);
    // The replay keeps the first accept's time.
    assert_eq!(sent[0]["createdAt"], sent[1]["createdAt"]);
    impeccable(&env, root, &["critiques", "off"]).output().unwrap();
    assert!(accept().status.success());
    assert_eq!(fake.hits("/cli/v1/prototypes"), 2);
    // An accept older than the service's one-day window sends nothing.
    impeccable(&env, root, &["critiques", "on"]).output().unwrap();
    let receipt = root.join(format!(".impeccable/live/accept-receipts/{id}.json"));
    let mut r: serde_json::Value = serde_json::from_slice(&std::fs::read(&receipt).unwrap()).unwrap();
    r["completedAt"] = "2026-01-01T00:00:00.000Z".into();
    std::fs::write(&receipt, r.to_string()).unwrap();
    assert!(accept().status.success());
    assert_eq!(fake.hits("/cli/v1/prototypes"), 2);
}

#[test]
fn successful_report_uploads_refresh_health_once_a_day_only_when_wanted_in_git() {
    let (fake, env) = setup("critique-health-refresh");
    let root = Path::new(&env["IMPECCABLE_HOME"]);
    let health = root.join("health.json");
    let marks = || -> serde_json::Value {
        std::fs::read(&health).ok()
            .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
            .and_then(|v| v.get("critiqueRefreshes").cloned())
            .unwrap_or(serde_json::json!({}))
    };
    // An upload outside git leaves no scheduling timestamp.
    assert!(write(&env, root).status.success());
    assert_eq!(fake.hits("/cli/v1/critiques"), 1);
    assert_eq!(marks(), serde_json::json!({}));
    assert!(Command::new("git").args(["init", "-q"]).current_dir(root)
        .status().unwrap().success());
    fake.route("POST", "/cli/v1/critiques", 500, vec![], "{}");
    assert!(write(&env, root).status.success());
    assert_eq!(marks(), serde_json::json!({}));
    fake.route("POST", "/cli/v1/critiques", 200, vec![], r#"{"outcome":"recorded"}"#);
    std::fs::write(&health, r#"{"sync":false}"#).unwrap();
    let before = write(&env, root);
    assert!(before.status.success());
    assert!(before.stderr.is_empty());
    assert_eq!(fake.hits("/cli/v1/critiques"), 3);
    assert_eq!(marks(), serde_json::json!({}));
    std::fs::write(&health, r#"{"sync":true}"#).unwrap();
    let first = write(&env, root);
    let claimed = marks();
    assert_eq!(claimed.as_object().unwrap().len(), 1);
    assert!(claimed.as_object().unwrap().values().all(|v| v.as_u64().unwrap() > 0));
    let second = write(&env, root);
    assert_eq!(marks(), claimed);
    // After the initial upload notice, scheduling changes no output or status.
    for out in [&before, &first, &second] {
        let text = String::from_utf8(out.stdout.clone()).unwrap();
        let path = text.lines().next().unwrap();
        assert!(Path::new(path).is_file());
        assert_eq!(out.stdout, format!("{path}\nSaved to Impeccable.\n").as_bytes());
    }
    assert_eq!(first.stderr, before.stderr);
    assert_eq!(second.stderr, before.stderr);
    assert_eq!(first.status.code(), before.status.code());
    assert_eq!(second.status.code(), before.status.code());
    // An audit uses the same success hook, even when its upload notice is quiet.
    let mut expired = claimed;
    for value in expired.as_object_mut().unwrap().values_mut() {
        *value = 1.into();
    }
    std::fs::write(&health, serde_json::json!({"sync":true,"critiqueRefreshes":expired}).to_string()).unwrap();
    let audit = impeccable(&env, root, &["audit-storage", "write", ".", "report.md", "--quiet"])
        .env("IMPECCABLE_REPORT_META", r#"{"target":".","total_score":14,"max_score":20,"p0_count":0,"p1_count":2}"#)
        .output().unwrap();
    assert!(audit.status.success());
    assert!(audit.stderr.is_empty());
    assert_eq!(marks().as_object().unwrap().len(), 1);
    assert_ne!(marks(), expired);
}

#[test]
fn a_report_upload_refreshes_health_and_foundations_in_the_background() {
    let fake = Fake::start();
    {
        let mut k = fake.knobs.lock().unwrap();
        (k.critiques, k.health, k.foundations) = (true, true, true);
    }
    let env = fake.env("critique-health-upload");
    login(&env);
    let root = Path::new(&env["IMPECCABLE_HOME"]).join("work").join("site");
    std::fs::create_dir_all(&root).unwrap();
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/antipatterns");
    std::fs::copy(fixtures.join("cream-palette.html"), root.join("index.html")).unwrap();
    std::fs::write(root.join("report.md"), "# Report\nCrowded header.").unwrap();
    for args in [vec!["init", "-q"], vec!["remote", "add", "origin", "https://github.com/acme/site.git"]] {
        assert!(Command::new("git").args(args).current_dir(&root).status().unwrap().success());
    }
    assert!(write(&env, &root).status.success());
    assert_eq!(fake.hits("/cli/v1/critiques"), 1);
    // The refresh is detached: wait for its uploads without blocking the save.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
    while (fake.hits("/cli/v1/health/scans") == 0 || fake.hits("/cli/v1/foundations") == 0)
        && std::time::Instant::now() < deadline
    {
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    let r = fake.record.lock().unwrap();
    let scan = r.scans.last().expect("the background refresh uploaded a health scan");
    assert_eq!(scan["repoKey"], r.critiques[0]["repoKey"]);
    assert!(r.foundations.last().is_some(), "the background refresh uploaded Foundations");
}

// The service's fake validates actual bytes, lengths, hashes and issued keys.
fn frame_page(mode: &'static str) -> (String, std::sync::Arc<std::sync::atomic::AtomicUsize>, std::sync::Arc<std::sync::atomic::AtomicBool>, std::thread::JoinHandle<()>) {
    use std::io::{Read, Write};
    use std::sync::{Arc, atomic::{AtomicBool, AtomicUsize, Ordering}};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let url = format!("http://{}/page", listener.local_addr().unwrap());
    let hits = Arc::new(AtomicUsize::new(0));
    let stop = Arc::new(AtomicBool::new(false));
    let (seen, done) = (hits.clone(), stop.clone());
    let handle = std::thread::spawn(move || {
        while !done.load(Ordering::SeqCst) {
            match listener.accept() {
                // One thread per connection: Chrome opens spare connections that
                // send nothing, and the real request must not wait behind them.
                Ok((mut stream, _)) => { let seen = seen.clone(); std::thread::spawn(move || {
                    // An accepted socket inherits the listener's non-blocking mode on macOS.
                    stream.set_nonblocking(false).unwrap();
                    stream.set_read_timeout(Some(std::time::Duration::from_secs(5))).unwrap();
                    let mut buf = [0; 4096];
                    let n = stream.read(&mut buf).unwrap_or(0);
                    let request = String::from_utf8_lossy(&buf[..n]);
                    if n == 0 {
                        return;
                    }
                    if request.starts_with("GET /page ") {
                        seen.fetch_add(1, Ordering::SeqCst);
                    }
                    if mode == "redirect" && request.starts_with("GET /page ") {
                        let _ = write!(stream, "HTTP/1.1 302 Found\r\nLocation: /signin\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                    } else if mode == "error" && request.starts_with("GET /page ") {
                        let body = "<h1>Server error</h1>";
                        let _ = write!(stream, "HTTP/1.1 500 Internal Server Error\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                    } else {
                        let body = "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'><style>body{background:#fcfaf7;color:#222;font:24px sans-serif}</style><h1>Pricing</h1><p>Plans for everyone.</p>";
                        let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                    }
                }); }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(std::time::Duration::from_millis(20)),
                Err(_) => break,
            }
        }
    });
    (url, hits, stop, handle)
}

fn check_frames(mode: &'static str) {
    let dropped = mode != "ok";
    use std::sync::atomic::Ordering;
    let (fake, mut env) = setup(&format!("frames-{mode}"));
    // Browser discovery uses the same environment in the detached worker.
    // Chrome on Windows also needs its profile folders to start.
    for key in ["IMPECCABLE_BROWSER", "PUPPETEER_EXECUTABLE_PATH", "CHROME_PATH", "PUPPETEER_DANGEROUS_NO_SANDBOX",
        "LOCALAPPDATA", "APPDATA", "USERPROFILE", "ProgramFiles", "ProgramFiles(x86)"] {
        if let Ok(v) = std::env::var(key) { env.insert(key.into(), v); }
    }
    let root = Path::new(&env["IMPECCABLE_HOME"]);
    let (url, hits, stop, server) = frame_page(mode);
    let mut meta: serde_json::Value = serde_json::from_str(META).unwrap();
    meta["url"] = url.into();
    let out = impeccable(&env, root, &["critique-storage", "write", "pricing", "report.md"])
        .env("IMPECCABLE_CRITIQUE_META", meta.to_string()).output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    assert!(said(&out).contains("Saved to Impeccable:"));
    assert!(fake.record.lock().unwrap().critiques[0].get("url").is_none());
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(25);
    while std::time::Instant::now() < deadline {
        if !dropped && fake.record.lock().unwrap().captures.len() == 2 { break; }
        if dropped && hits.load(Ordering::SeqCst) >= 2 {
            // Both pages were seen; give a wrongly kept frame time to upload.
            std::thread::sleep(std::time::Duration::from_secs(3));
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    stop.store(true, Ordering::SeqCst);
    server.join().unwrap();
    let seen = hits.load(Ordering::SeqCst);
    assert!(seen >= 2, "worker navigated both viewports ({seen} page loads)");
    let record = fake.record.lock().unwrap();
    if dropped {
        assert!(record.captures.is_empty());
        assert_eq!(record.hits.get("/cli/v1/critiques/captures").copied().unwrap_or(0), 0);
    } else {
        assert_eq!(record.captures.len(), 2);
        for (c, viewport, width, height) in [
            (&record.captures[0], "desktop", 1440, 900),
            (&record.captures[1], "phone", 390, 844),
        ] {
            assert_eq!(c["viewport"], viewport);
            assert_eq!(c["width"], width);
            assert_eq!(c["height"], height);
            assert_eq!(c["label"], "Pricing plans");
        }
    }
}

/// One browser at a time: the page itself attaches both frames, and a
/// redirect elsewhere or an error page attaches none.
#[test]
fn a_critique_attaches_frames_only_of_the_page_itself() {
    if impeccable_browser::discovery::find_browser(&std::env::vars().collect()).is_err() {
        eprintln!("skip: no installed browser found");
        return;
    }
    for mode in ["ok", "redirect", "error"] {
        check_frames(mode);
    }
}

/// A critique of a checked-out pull request names its branch, commit and, when
/// the agent gave one, the pull request, so it files under it (REN-2377).
#[test]
fn a_critique_names_the_branch_commit_and_pull_request_it_ran_on() {
    let (fake, env) = setup("critique-pull");
    let root = Path::new(&env["IMPECCABLE_HOME"]);
    let git = |args: &[&str]| {
        let out = Command::new("git").args(["-c", "user.name=t", "-c", "user.email=t@t"]).args(args).current_dir(root).output().unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    };
    git(&["init", "-q"]);
    git(&["checkout", "-q", "-b", "ada/fix-nav"]);
    git(&["commit", "-q", "--allow-empty", "-m", "nav"]);
    let sha = git(&["rev-parse", "HEAD"]);
    impeccable(&env, root, &["critiques", "on"]).output().unwrap();
    let mut meta: serde_json::Value = serde_json::from_str(META).unwrap();
    meta["pr"] = "#134".into();
    let out = impeccable(&env, root, &["critique-storage", "write", "pricing", "report.md"])
        .env("IMPECCABLE_CRITIQUE_META", meta.to_string()).output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    // Detached, with no pull request named: the commit alone.
    git(&["checkout", "-q", "--detach"]);
    std::fs::write(root.join("report.md"), "# Report\nCrowded header, again.").unwrap();
    assert!(write(&env, root).status.success());
    let record = fake.record.lock().unwrap();
    assert!(record.refused.is_empty(), "{:?}", record.refused);
    let [first, second] = &record.critiques[..] else { panic!("{:?}", record.critiques) };
    assert_eq!((first["headSha"].as_str(), first["branch"].as_str(), first["pr"].as_u64()), (Some(sha.as_str()), Some("ada/fix-nav"), Some(134)));
    assert_eq!(second["headSha"].as_str(), Some(sha.as_str()));
    assert!(second.get("branch").is_none() && second.get("pr").is_none(), "{second}");
}
