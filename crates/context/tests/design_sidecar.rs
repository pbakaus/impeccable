use impeccable_context::staleness::{check_design_sidecar, Finding};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

static NEXT_ID: AtomicU64 = AtomicU64::new(0);

const ORIGINAL: &[u8] = b"# Design\n\nUse blue buttons.\n";
const CHANGED: &[u8] = b"# Design\n\nUse red buttons.\n";

struct Fixture {
    root: PathBuf,
}
impl Fixture {
    fn new(fingerprint: Option<Value>) -> Self {
        let root = std::env::temp_dir().join(format!(
            "impeccable-846-contract-{}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            NEXT_ID.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(root.join(".impeccable")).unwrap();
        fs::write(root.join("DESIGN.md"), ORIGINAL).unwrap();
        let mut sidecar = json!({"schemaVersion": 2, "extensions": {"shadows": []}});
        if let Some(value) = fingerprint {
            sidecar["designMdFingerprint"] = value;
        }
        fs::write(
            root.join(".impeccable/design.json"),
            serde_json::to_vec(&sidecar).unwrap(),
        )
        .unwrap();
        Self::stamp(&root.join(".impeccable/design.json"), 200);
        Self { root }
    }
    fn stamp(path: &Path, seconds: u64) {
        // Windows requires a writable handle to change file timestamps.
        fs::File::options().write(true).open(path)
            .unwrap()
            .set_times(fs::FileTimes::new().set_modified(UNIX_EPOCH + Duration::from_secs(seconds)))
            .unwrap();
    }
    fn source(&self, bytes: &[u8], seconds: u64) {
        fs::write(self.root.join("DESIGN.md"), bytes).unwrap();
        Self::stamp(&self.root.join("DESIGN.md"), seconds);
    }
    fn findings(&self) -> Vec<Finding> {
        let source = self.root.join("DESIGN.md");
        let sidecar = self.root.join(".impeccable/design.json");
        let before = fs::read(&sidecar).unwrap();
        let findings = check_design_sidecar(
            Some(source.to_str().unwrap()),
            &[sidecar.to_str().unwrap().into()],
            self.root.to_str().unwrap(),
        );
        assert_eq!(
            before,
            fs::read(sidecar).unwrap(),
            "checking must never certify or rewrite a sidecar"
        );
        findings
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

// Proposed versioned contract: SHA-256 of bytes after CRLF -> LF only.
// Preserve lone CR, BOM, whitespace, Unicode bytes, and final newline.
fn fingerprint(bytes: &[u8]) -> Value {
    let mut normalized = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index..].starts_with(b"\r\n") {
            normalized.push(b'\n');
            index += 2;
        } else {
            normalized.push(bytes[index]);
            index += 1;
        }
    }
    json!({"algorithm": "sha256", "normalization": "lf-v1", "digest": format!("{:x}", Sha256::digest(normalized))})
}
fn has(findings: &[Finding], id: &str) -> bool {
    findings.iter().any(|finding| finding.id == id)
}

#[test]
fn matching_source_does_not_become_stale_after_checkout() {
    let fixture = Fixture::new(Some(fingerprint(ORIGINAL)));
    fixture.source(ORIGINAL, 300);
    assert!(!has(&fixture.findings(), "design-sidecar-stale"));
}
#[test]
fn changed_source_is_stale_even_with_an_older_mtime() {
    let fixture = Fixture::new(Some(fingerprint(ORIGINAL)));
    fixture.source(CHANGED, 100);
    assert!(has(&fixture.findings(), "design-sidecar-stale"));
}
#[test]
fn restored_source_matches_the_original_fingerprint() {
    let fixture = Fixture::new(Some(fingerprint(ORIGINAL)));
    fixture.source(CHANGED, 100);
    fixture.source(ORIGINAL, 300);
    assert!(!has(&fixture.findings(), "design-sidecar-stale"));
}
#[test]
fn legacy_sidecar_is_unverified_for_either_timestamp_order() {
    let fixture = Fixture::new(None);
    for seconds in [100, 300] {
        fixture.source(ORIGINAL, seconds);
        let findings = fixture.findings();
        assert!(
            has(&findings, "design-sidecar-unverified"),
            "mtime={seconds}"
        );
        assert!(!has(&findings, "design-sidecar-stale"));
    }
}
#[test]
fn malformed_or_unknown_fingerprint_is_unverified() {
    for invalid in [
        Value::Null,
        json!(17),
        json!("not-a-hash"),
        json!({}),
        json!({"algorithm":"sha256","normalization":"lf-v1","digest":"xyz"}),
        json!({"algorithm":"sha256","normalization":"future-v2","digest":"0".repeat(64)}),
    ] {
        let fixture = Fixture::new(Some(invalid));
        fixture.source(ORIGINAL, 100);
        assert!(has(&fixture.findings(), "design-sidecar-unverified"));
    }
}
#[test]
fn checkout_line_endings_do_not_change_the_fingerprint() {
    let fixture = Fixture::new(Some(fingerprint(ORIGINAL)));
    let crlf = String::from_utf8(ORIGINAL.to_vec())
        .unwrap()
        .replace('\n', "\r\n");
    assert_eq!(fingerprint(crlf.as_bytes()), fingerprint(ORIGINAL));
    fixture.source(crlf.as_bytes(), 300);
    assert!(!has(&fixture.findings(), "design-sidecar-stale"));
}

#[test]
fn stamp_preserves_source_and_sidecar_fields_and_is_repeatable() {
    let fixture = Fixture::new(None);
    let design = fixture.root.join("DESIGN.md");
    let sidecar = fixture.root.join(".impeccable/design.json");
    impeccable_context::design_sidecar::stamp(&design, &sidecar).unwrap();
    let bytes = fs::read(&sidecar).unwrap();
    let value: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(value["extensions"], json!({"shadows": []}));
    assert_eq!(value["designMdFingerprint"], fingerprint(ORIGINAL));
    assert_eq!(fs::read(&design).unwrap(), ORIGINAL);
    assert!(!has(&fixture.findings(), "design-sidecar-unverified"));
    impeccable_context::design_sidecar::stamp(&design, &sidecar).unwrap();
    assert_eq!(fs::read(sidecar).unwrap(), bytes);
}

#[test]
fn stamping_refuses_invalid_or_old_sidecars_without_changing_them() {
    let fixture = Fixture::new(None);
    let design = fixture.root.join("DESIGN.md");
    let sidecar = fixture.root.join(".impeccable/design.json");
    for content in [
        "broken",
        "null",
        "[]",
        "{}",
        "{\"schemaVersion\":1}",
        "{\"schemaVersion\":3}",
    ] {
        fs::write(&sidecar, content).unwrap();
        assert!(impeccable_context::design_sidecar::stamp(&design, &sidecar).is_err());
        assert_eq!(fs::read_to_string(&sidecar).unwrap(), content);
    }
    fs::remove_file(&sidecar).unwrap();
    assert!(impeccable_context::design_sidecar::stamp(&design, &sidecar).is_err());
    assert!(!sidecar.exists());
}

#[test]
fn only_crlf_is_normalized() {
    let original = impeccable_context::design_sidecar::fingerprint(ORIGINAL);
    assert_eq!(original, fingerprint(ORIGINAL));
    assert_eq!(
        original,
        impeccable_context::design_sidecar::fingerprint(b"# Design\r\n\r\nUse blue buttons.\r\n")
    );
    for changed in [
        b"# Design\n\nUse blue buttons.".as_slice(),
        b"# Design\n\nUse blue buttons. \n",
        b"\xef\xbb\xbf# Design\n\nUse blue buttons.\n",
        b"# Design\r\nUse blue buttons.\r",
    ] {
        assert_ne!(
            original,
            impeccable_context::design_sidecar::fingerprint(changed)
        );
    }
}

fn command(root: &Path, args: &[&str]) -> i32 {
    let mut io = impeccable_common::Io::stdio();
    io.cwd = root.to_owned();
    io.env.clear();
    io.stdout = Box::new(std::io::sink());
    io.stderr = Box::new(std::io::sink());
    impeccable_context::design_sidecar::run(
        &args.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
        &mut io,
    )
}

#[test]
fn command_resolves_target_and_refuses_invalid_arguments_without_writes() {
    let fixture = Fixture::new(None);
    fs::write(fixture.root.join("package.json"), "{}").unwrap();
    let sidecar = fixture.root.join(".impeccable/design.json");
    let before = fs::read(&sidecar).unwrap();
    for args in [
        vec![],
        vec!["stamp", "--unknown"],
        vec!["stamp", "--target"],
        vec!["stamp", "--target="],
        vec!["--help"],
    ] {
        let code = command(&fixture.root, &args);
        assert_eq!(code, if args == ["--help"] { 0 } else { 1 });
        assert_eq!(fs::read(&sidecar).unwrap(), before);
    }
    fs::create_dir_all(fixture.root.join("src")).unwrap();
    fs::write(fixture.root.join("src/app.html"), "<p>App</p>").unwrap();
    assert_eq!(
        command(&fixture.root, &["stamp", "--target", "src/app.html"]),
        0
    );
    assert!(!has(&fixture.findings(), "design-sidecar-unverified"));
}

#[test]
fn command_stamps_only_the_selected_workspace() {
    let fixture = Fixture::new(None);
    fs::create_dir_all(fixture.root.join(".git")).unwrap();
    fs::write(
        fixture.root.join("package.json"),
        r#"{"workspaces":["apps/*"]}"#,
    )
    .unwrap();
    let app = fixture.root.join("apps/web");
    fs::create_dir_all(app.join(".impeccable")).unwrap();
    fs::write(app.join("package.json"), "{}").unwrap();
    fs::write(app.join("DESIGN.md"), CHANGED).unwrap();
    fs::write(
        app.join(".impeccable/design.json"),
        r#"{"schemaVersion":2}"#,
    )
    .unwrap();
    let root_before = fs::read(fixture.root.join(".impeccable/design.json")).unwrap();
    assert_eq!(
        command(&fixture.root, &["stamp", "--target", "apps/web"]),
        0
    );
    let child: Value =
        serde_json::from_slice(&fs::read(app.join(".impeccable/design.json")).unwrap()).unwrap();
    assert_eq!(child["designMdFingerprint"], fingerprint(CHANGED));
    assert_eq!(
        fs::read(fixture.root.join(".impeccable/design.json")).unwrap(),
        root_before
    );
}
