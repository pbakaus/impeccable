//! `undersized-ui-text` over the static engine: each size floor keeps a 0.1px
//! tolerance under it (taste call r3-19), and text in a link keeps the 11px
//! interactive floor whatever class it carries (taste call r3-07, kept).

use impeccable_html::{detect_html_source, DetectHtmlOptions};
use std::path::{Path, PathBuf};

fn repo_root() -> PathBuf {
    std::env::var("IMPECCABLE_PUBLIC_REPO")
        .map(PathBuf::from)
        .unwrap_or_else(|_| Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."))
}

fn undersized(html: &str, path: &Path) -> Vec<String> {
    detect_html_source(html, path, &DetectHtmlOptions::default())
        .into_iter()
        .filter(|f| f.antipattern == "undersized-ui-text")
        .map(|f| f.snippet)
        .collect()
}

fn scan(css: &str, body: &str) -> Vec<String> {
    let html = format!("<!DOCTYPE html><html><head><style>{css}</style></head><body>{body}</body></html>");
    undersized(&html, Path::new("/tmp/undersized-ui-text.html"))
}

#[test]
fn fixture_flag_and_pass_cases() {
    let fixture = repo_root().join("tests/fixtures/antipatterns/undersized-ui-text.html");
    let html = std::fs::read_to_string(&fixture).expect("fixture");
    let snippets = undersized(&html, &fixture);
    for flag in ["Flag Edge Link", "Flag Edge Legal", "Flag Photo Credit", "Flag Nav Link"] {
        assert!(snippets.iter().any(|s| s.contains(flag)), "{flag} should flag, got {snippets:?}");
    }
    for pass in ["Pass Fluid Link", "Pass Fluid Legal", "Pass Legal Fine Print"] {
        assert!(!snippets.iter().any(|s| s.contains(pass)), "{pass} should pass, got {snippets:?}");
    }
    assert!(
        snippets.iter().any(|s| s == "10.9px functional text \"Flag Edge Link\" (below 11px floor)"),
        "{snippets:?}"
    );
    assert!(
        snippets.iter().any(|s| s.starts_with("9.9px functional text \"Flag Edge Legal") && s.ends_with("(below 10px floor)")),
        "{snippets:?}"
    );
}

#[test]
fn each_floor_keeps_a_tenth_of_a_pixel() {
    for (size, reports) in [("10.9688px", false), ("10.95px", false), ("10.91px", false), ("10.9px", true), ("10.5px", true)] {
        let hits = scan(&format!("a {{ font-size: {size}; }}"), "<a href=\"/buy\">Buy now</a>");
        assert_eq!(!hits.is_empty(), reports, "{size} against the 11px floor: {hits:?}");
    }
    for (size, reports) in [("9.95px", false), ("9.9px", true)] {
        let hits = scan(
            &format!("small {{ font-size: {size}; }}"),
            "<p><small>Terms apply</small></p>",
        );
        assert_eq!(!hits.is_empty(), reports, "{size} against the 10px floor: {hits:?}");
    }
}

/// A furniture class on `html` is a script state flag (schlittermann.de's
/// `html.js-nav-ready`), as the browser engine reads it: it does not make
/// every sentence on the page navigation. On `body` and below it still
/// counts.
#[test]
fn furniture_class_on_html_is_a_state_flag() {
    let sentence = "This sentence is long enough to read as body copy.";
    let css = "p { font-size: 10px; }";
    let on_html = format!(
        "<!DOCTYPE html><html class=\"js-nav-ready\"><head><style>{css}</style></head><body><p>{sentence}</p></body></html>"
    );
    assert!(undersized(&on_html, Path::new("/tmp/flag.html")).is_empty(), "html.js-nav-ready");
    let on_body = format!(
        "<!DOCTYPE html><html><head><style>{css}</style></head><body class=\"has-breadcrumb\"><p>{sentence}</p></body></html>"
    );
    assert!(!undersized(&on_body, Path::new("/tmp/flag.html")).is_empty(), "body.has-breadcrumb");
}
