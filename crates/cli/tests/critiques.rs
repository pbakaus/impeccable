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
fn only_new_reports_upload_after_explicit_opt_in() {
    let (fake, env) = setup("critique-flow");
    let root = Path::new(&env["IMPECCABLE_HOME"]);
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
