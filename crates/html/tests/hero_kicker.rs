//! An eyebrow over a page's h1 is a kicker however it is dressed: in a
//! small-caps face ("IM Fell English SC") rather than `font-variant`, with a
//! middle dot, inside the `<article>` that holds the hero, over a fluid
//! `clamp()` heading. A byline, a dated or path line, a Simplified Chinese
//! face named "… SC" and untracked small caps are not.

use impeccable_html::{detect_html_source, DetectHtmlOptions};
use std::path::{Path, PathBuf};

fn fixture() -> Option<PathBuf> {
    let root = std::env::var("IMPECCABLE_PUBLIC_REPO")
        .map(PathBuf::from)
        .unwrap_or_else(|_| Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."));
    let p = root.join("tests/fixtures/antipatterns/kicker-over-hero.html");
    p.is_file().then_some(p)
}

#[test]
fn an_eyebrow_over_the_page_h1_is_a_kicker() {
    let Some(path) = fixture() else {
        eprintln!("fixture not found; skipping");
        return;
    };
    let src = std::fs::read_to_string(&path).unwrap();
    let mut headings: Vec<String> = detect_html_source(&src, &path, &DetectHtmlOptions::default())
        .into_iter()
        .filter(|f| f.antipattern == "kicker-above-heading")
        .filter_map(|f| f.snippet.split(" above h1 \"").nth(1).map(|h| h.trim_end_matches('"').to_string()))
        .collect();
    headings.sort_unstable();
    assert_eq!(
        headings,
        ["Field notes for the season", "Grow the whole year", "Plant once, save forever", "Seeds that come back"]
    );
}
