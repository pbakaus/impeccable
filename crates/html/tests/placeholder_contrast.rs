//! Integration tests for `::placeholder` contrast detection (#790).

use impeccable_html::{detect_html_source, DetectHtmlOptions};
use std::path::Path;

const ISSUER_REPRO: &str = r#"<!DOCTYPE html>
<html><head><style>
input::placeholder { color: #bbbbbb; }
input { background: white; font-size: 16px; width: 200px; height: 40px; border: 1px solid #ccc; padding: 8px; box-sizing: border-box; }
</style></head>
<body><input placeholder="Search"></body></html>
"#;

fn scan(html: &str) -> Vec<impeccable_core::findings::Finding> {
    detect_html_source(html, Path::new("/tmp/placeholder.html"), &DetectHtmlOptions::default())
}

fn repo_root() -> std::path::PathBuf {
    std::env::var("IMPECCABLE_PUBLIC_REPO")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."))
}

#[test]
fn issuer_repro_flags_pale_placeholder() {
    let findings = scan(ISSUER_REPRO);
    assert!(
        findings.iter().any(|f| f.antipattern == "low-contrast"),
        "expected low-contrast finding, got {findings:?}"
    );
}

#[test]
fn bare_placeholder_selector_flags() {
    let html = r#"<!DOCTYPE html>
<html><head><style>
::placeholder { color: #bbbbbb; }
input { background: white; font-size: 16px; width: 200px; height: 40px; }
</style></head>
<body><input placeholder="Search"></body></html>
"#;
    let findings = scan(html);
    assert!(
        findings.iter().any(|f| f.antipattern == "low-contrast"),
        "expected low-contrast for bare ::placeholder, got {findings:?}"
    );
}

#[test]
fn descendant_placeholder_selector_flags() {
    let html = r#"<!DOCTYPE html>
<html><head><style>
.form ::placeholder { color: #bbbbbb; }
input { background: white; font-size: 16px; width: 200px; height: 40px; }
</style></head>
<body><div class="form"><input placeholder="Search"></div></body></html>
"#;
    let findings = scan(html);
    assert!(
        findings.iter().any(|f| f.antipattern == "low-contrast"),
        "expected low-contrast for descendant ::placeholder, got {findings:?}"
    );
}

#[test]
fn fixture_flag_and_pass_cases() {
    let fixture = repo_root().join("tests/fixtures/antipatterns/placeholder-contrast.html");
    assert!(
        fixture.is_file(),
        "missing fixture at {}",
        fixture.display()
    );
    let html = std::fs::read_to_string(&fixture).unwrap();
    let findings = detect_html_source(&html, &fixture, &DetectHtmlOptions::default());
    let ids: Vec<&str> = findings.iter().map(|f| f.antipattern.as_str()).collect();
    let snippets: Vec<&str> = findings.iter().map(|f| f.snippet.as_str()).collect();

    for needle in [
        "Pale Placeholder On White Field",
        "Pale Placeholder On White Textarea",
        "Translucent Placeholder On Light Field",
        "Pale Placeholder On Frosted Panel",
    ] {
        assert!(
            snippets.iter().any(|s| s.contains(needle)),
            "expected flag for placeholder {needle:?}, findings={findings:?}"
        );
    }

    for needle in [
        "Ink Placeholder On White Field",
        "Light Placeholder On Dark Field",
        "Filled Field Hides Placeholder",
        "Unstyled Placeholder Uses UA Color",
    ] {
        assert!(
            !snippets.iter().any(|s| s.contains(needle)),
            "pass case {needle:?} should not flag, findings={findings:?}"
        );
    }

    assert!(
        ids.iter().filter(|id| **id == "low-contrast").count() >= 4,
        "expected at least four low-contrast hits, got {findings:?}"
    );
}
