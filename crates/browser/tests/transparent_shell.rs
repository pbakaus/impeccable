//! cramped-padding seen through a transparent shell (issue #963, PR #1059),
//! against an installed browser. Skips cleanly when there is none.
//!
//! `cramped-padding-shell.html` pairs each shell the rule must still flag (one
//! a relative offset carries onto the rule, one whose children's margins
//! collapse out of the card) with shells whose inset reaches the reader: a
//! border of any colour on the card, or a card that is a flex, grid or
//! flow-root container, holds the children's margins inside.

#[path = "support/http.rs"]
mod http;

use std::collections::HashMap;
use std::path::Path;

use impeccable_browser::BrowserEngine;
use impeccable_detect::engines::{ScanOptions, UrlEngine};

const FIXTURE: &str = "cramped-padding-shell.html";

fn engine() -> Option<BrowserEngine> {
    let env: HashMap<String, String> = std::env::vars().collect();
    if impeccable_browser::discovery::find_browser(&env).is_err() {
        eprintln!("skip: no installed browser found");
        return None;
    }
    Some(BrowserEngine::new(env))
}

#[test]
fn the_shell_fixture_reports_exactly_its_flag_column() {
    let Some(engine) = engine() else { return };
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/antipatterns").join(FIXTURE);
    let body = std::fs::read(path).expect("fixture");
    let origin = http::serve(move |p| (p == "/").then(|| ("text/html; charset=utf-8", body.clone())));
    let findings = engine.detect_url(&format!("{origin}/"), &ScanOptions::default()).expect("scan");
    let mut flagged: Vec<String> = findings
        .iter()
        .filter(|f| f.antipattern == "cramped-padding")
        .map(|f| f.extras.get("selector").and_then(|v| v.as_str()).unwrap_or("").to_string())
        .filter(|s| s.starts_with("#flag-") || s.starts_with("#pass-"))
        .collect();
    flagged.sort();
    flagged.dedup();
    assert_eq!(
        flagged,
        vec![
            "#flag-shell-em-pull",
            "#flag-shell-loose-sibling",
            "#flag-shell-margins-escape",
            "#flag-shell-negative-margin",
            "#flag-shell-offset-left", "#flag-shell-offset-top", "#flag-shell-paragraph-offset", "#flag-shell-shorthand-pull", "#flag-shell-transform"],
        "{findings:#?}"
    );
}
