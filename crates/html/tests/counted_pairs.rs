//! One report per colour pair and one per outer panel in the static engine,
//! each counting the rest (taste calls r14-t2 and r14-t5).

use impeccable_html::{detect_html_source, DetectHtmlOptions};
use std::path::Path;

fn repo_root() -> std::path::PathBuf {
    std::env::var("IMPECCABLE_PUBLIC_REPO")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."))
}

fn snippets(fixture: &str, rule: &str) -> Vec<String> {
    let path = repo_root().join("tests/fixtures/antipatterns").join(fixture);
    let html = std::fs::read_to_string(&path).expect("fixture");
    detect_html_source(&html, &path, &DetectHtmlOptions::default())
        .into_iter()
        .filter(|f| f.antipattern == rule)
        .map(|f| f.snippet)
        .collect()
}

#[test]
fn a_colour_pair_reports_once_and_counts_the_rest() {
    assert_eq!(
        snippets("low-contrast-counted-pairs.html", "low-contrast"),
        [
            "1.9:1 (need 4.5:1) — text #bbbbbb on #ffffff (and 2 more)",
            "2.3:1 (need 4.5:1) — text #ababab on #ffffff (and 2 more)",
            "2.8:1 (need 4.5:1) — text #e15c99 on #f9e5ef (and 1 more)",
            "2.1:1 (need 4.5:1) — text #b4b4b4 on #ffffff (and 1 more)",
            "1.8:1 (need 4.5:1) — text #c2c2c2 on #ffffff",
            "2.1:1 (need 4.5:1) — text #b5b5b5 on #ffffff (and 2 more)",
            "2.3:1 (need 4.5:1) — text #b6a6b6 on #ffffff (and 1 more)",
            // The file scan reads no vendor, so the feed's link is counted.
            "2.3:1 (need 4.5:1) — text #b7a7a7 on #ffffff (and 1 more)",
            // The avatar initial (advisory) and the tags stay apart.
            "1.8:1 (need 4.5:1) — text #ffffff on #93c5fd",
            "1.8:1 (need 4.5:1) — text #ffffff on #93c5fd (and 1 more)",
            // The file scan reads no vendor or pixel hand-over, so those
            // copies share their pair here.
            "2.4:1 (need 4.5:1) — text #a6a6a6 on #ffffff (and 1 more)",
            "2.1:1 (need 4.5:1) — text #b2b2b2 on #ffffff (and 2 more)",
            // Links over a dark photo are not counted.
            "2.2:1 (need 4.5:1) — text #c9a3c8 on #ffffff",
            "1.4:1 (need 4.5:1) — text #bbbbbb on #dddddd (gradient on div.grad-card) (and 2 more)",
        ]
    );
}

#[test]
fn a_colour_pair_keeps_counted_and_advisory_copies_apart() {
    // In the decorative fixture an avatar initial (advisory) and a count
    // badge (failing) wear white on #93c5fd: two findings, because an
    // advisory copy never speaks for a counted one.
    let path = repo_root().join("tests/fixtures/antipatterns/low-contrast-decorative.html");
    let html = std::fs::read_to_string(&path).expect("fixture");
    let found: Vec<(String, String)> = detect_html_source(&html, &path, &DetectHtmlOptions::default())
        .into_iter()
        .filter(|f| f.antipattern == "low-contrast" && f.snippet.contains("text #ffffff on #93c5fd"))
        .map(|f| (f.severity, f.snippet))
        .collect();
    let mut severities: Vec<&str> = found.iter().map(|(s, _)| s.as_str()).collect();
    severities.sort();
    assert_eq!(severities, ["advisory", "warning"], "{found:?}");
}

#[test]
fn an_outer_panel_reports_once_and_counts_its_cards() {
    let found = snippets("nested-cards.html", "nested-cards");
    // The FAQ panel's three rows and the tiles panel's three tiles (the file
    // scan reads no element for a page-level finding, so the tile's inline
    // ignore does not reach it) each report once.
    assert_eq!(found.iter().filter(|s| *s == "Card inside card (div) (and 2 more)").count(), 2, "{found:?}");
    assert!(found.iter().all(|s| !s.contains("(and 1 more)")), "{found:?}");
}
