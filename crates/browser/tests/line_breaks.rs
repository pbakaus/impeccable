//! `straggler` and `unbalanced-heading` against an installed browser, on the
//! fixtures' should-flag and should-pass cases. Skips cleanly when there is
//! none.
//!
//! Both rules read the rendered line boxes, which the static engine never
//! measures. The fixtures set their copy in a monospace face on columns sized
//! in `ch`, so the breaks are the same on every machine.

#[path = "support/http.rs"]
mod http;

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use impeccable_browser::BrowserEngine;
use impeccable_detect::engines::{ScanOptions, UrlEngine};

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/antipatterns")
}

fn engine() -> Option<BrowserEngine> {
    let env: HashMap<String, String> = std::env::vars().collect();
    if impeccable_browser::discovery::find_browser(&env).is_err() {
        eprintln!("skip: no installed browser found");
        return None;
    }
    Some(BrowserEngine::new(env))
}

/// `(rule, snippet, selector, severity)` for each line-break finding on one
/// fixture.
fn findings(engine: &BrowserEngine, origin: &str, fixture: &str) -> Vec<(String, String, String, String)> {
    engine
        .detect_url(&format!("{origin}/{fixture}"), &ScanOptions::default())
        .expect("scan")
        .into_iter()
        .filter(|f| f.antipattern == "straggler" || f.antipattern == "unbalanced-heading")
        .map(|f| {
            let selector = f.extras.get("selector").and_then(|s| s.as_str()).unwrap_or("").to_string();
            (f.antipattern, f.snippet, selector, f.severity)
        })
        .collect()
}

fn assert_cases(found: &[(String, String, String, String)], rule: &str, flag: &[&str], pass: &[&str]) {
    for case in flag {
        assert!(
            found.iter().any(|(id, _, sel, _)| id == rule && sel.contains(case)),
            "{rule}: `{case}` should flag, got {found:?}"
        );
    }
    for case in pass {
        assert!(
            !found.iter().any(|(_, _, sel, _)| sel.contains(case)),
            "{rule}: `{case}` should pass, got {found:?}"
        );
    }
    assert!(found.iter().all(|(id, _, _, _)| id == rule), "{found:?}");
    // An uneven break can be the design, so neither rule counts as a failure.
    assert!(found.iter().all(|(_, _, _, sev)| sev == "advisory"), "{found:?}");
}

#[test]
fn the_line_break_rules_read_the_rendered_lines() {
    let Some(engine) = engine() else { return };
    let origin = http::serve(|path| {
        std::fs::read(fixtures_dir().join(path.trim_start_matches('/')))
            .ok()
            .map(|body| ("text/html; charset=utf-8", body))
    });

    let stragglers = findings(&engine, &origin, "straggler.html");
    assert_cases(
        &stragglers,
        "straggler",
        &["flag-paragraph", "flag-list-item", "flag-quote", "flag-caption", "flag-inline"],
        &[
            "pass-pretty",
            "pass-balance",
            "pass-two-words",
            "pass-long-word",
            "pass-narrow",
            "pass-break",
            "pass-inline-icon",
            "pass-one-line",
        ],
    );
    let paragraph = stragglers.iter().find(|(_, _, sel, _)| sel.contains("flag-paragraph")).unwrap();
    assert!(paragraph.1.starts_with("\"text.\" alone on the last of 4 lines"), "{paragraph:?}");

    let headings = findings(&engine, &origin, "unbalanced-heading.html");
    assert_cases(
        &headings,
        "unbalanced-heading",
        &["flag-hero", "flag-three-lines", "flag-centred", "flag-card", "flag-pretty-ancestor"],
        &["pass-balance", "pass-pretty-ancestor", "pass-one-line", "pass-even", "pass-stacked", "pass-statement", "pass-two-words", "pass-narrow", "pass-break"],
    );
}
