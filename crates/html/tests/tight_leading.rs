//! The tight-leading floor over the static engine: it measures multi-line
//! body copy and nothing else. Review of the rule's output on real pages found
//! it applied to display type, to heading text that sits in a child anchor or
//! span, to text that never renders, and to pages that set the floor exactly.

use impeccable_html::{detect_html_source, DetectHtmlOptions};
use std::path::{Path, PathBuf};

fn repo_root() -> PathBuf {
    std::env::var("IMPECCABLE_PUBLIC_REPO")
        .map(PathBuf::from)
        .unwrap_or_else(|_| Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."))
}

fn leading_snippets(html: &str, path: &Path) -> Vec<String> {
    detect_html_source(html, path, &DetectHtmlOptions::default())
        .into_iter()
        .filter(|f| f.antipattern == "tight-leading")
        .map(|f| f.snippet)
        .collect()
}

fn scan(html: &str) -> Vec<String> {
    leading_snippets(html, Path::new("/tmp/tight-leading.html"))
}

fn page(head: &str, body: &str) -> String {
    format!("<!DOCTYPE html><html><head><style>{head}</style></head><body>{body}</body></html>")
}

const COPY: &str = "This paragraph is reading copy that is comfortably longer than the fifty characters the check asks for before it measures leading.";

#[test]
fn fixture_flag_and_pass_cases() {
    let fixture = repo_root().join("tests/fixtures/antipatterns/tight-leading.html");
    assert!(fixture.is_file(), "missing fixture at {}", fixture.display());
    let html = std::fs::read_to_string(&fixture).unwrap();
    let snippets = leading_snippets(&html, &fixture);

    // The five should-flag cases, each set at a ratio of its own.
    for ratio in ["1.25", "1.20", "1.17", "1.14", "1.10"] {
        assert!(
            snippets.iter().any(|s| s.contains(ratio)),
            "expected a tight-leading finding at {ratio}x, got {snippets:?}"
        );
    }
    // Display type (1.13), heading link (1.13), role=heading card title
    // (1.27), the paragraph at exactly the floor (1.30), the display:none
    // variant (1.07) and the clipped screen-reader copy (1.00) all pass.
    for ratio in ["1.13", "1.27", "1.30", "1.07", "1.00"] {
        assert!(
            !snippets.iter().any(|s| s.contains(ratio)),
            "pass case at {ratio}x should not flag, got {snippets:?}"
        );
    }
    // Heading copy in a block wrapper (1.26) passes in both engines.
    assert!(
        !snippets.iter().any(|s| s.contains("1.26")),
        "the div inside a heading should not flag, got {snippets:?}"
    );
    // Two cases the static engine cannot judge: it has no layout, so it still
    // reports the 1.15x single-line label, and the 0.95x inline run whose
    // lines sit on its block's 22px line boxes. The browser engine's wrap and
    // pitch tests are pinned in crates/core.
    assert!(
        snippets.iter().any(|s| s.contains("0.95")),
        "the documented static-only inline run, got {snippets:?}"
    );
    // The bold-title cases (taste call r3-03): bold body text over four lines
    // (1.19), the weight-500 title (1.14), regular copy in a clamp (1.20) and
    // bold text a max-height clip cuts to three lines (1.14) flag in both
    // engines; the bold titles in a clamp, one of which the text fills
    // exactly, pass in both. The two bold titles of two lines, on a div and
    // in an inline link, pass in the browser only: the static engine cannot
    // count lines. The flex row whose long first run wraps (1.17) flags in
    // both; the flex row of short runs wrapped as whole items (1.25) passes
    // in the browser only, since the static engine cannot see the items.
    // The print-sheet cases set in absolute units, which resolve at 96px to the
    // inch: 12pt over 15.5pt (1.29) and 0.2in over 0.256in (1.28) flag, at the
    // ratio the numbers say. Leading of 0.6cm over 15px (1.51), 0.25in over 14px
    // (1.71) and 16pt over 10pt (1.60) passes; read as ems the first two were
    // 0.60x and 0.25x and flagged as crushed.
    for ratio in ["1.29", "1.28"] {
        assert!(
            snippets.iter().any(|s| s.contains(ratio)),
            "expected a print-sheet finding at {ratio}x, got {snippets:?}"
        );
    }
    for ratio in ["0.60", "0.25", "1.51", "1.71"] {
        assert!(
            !snippets.iter().any(|s| s.contains(ratio)),
            "print-sheet leading in absolute units should not flag at {ratio}x, got {snippets:?}"
        );
    }
    assert_eq!(
        snippets.len(),
        17,
        "expected twelve flags plus the five documented static hits, got {snippets:?}"
    );
}

#[test]
fn a_bold_title_in_a_line_clamp_passes() {
    let clamp = "display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;";
    for weight in ["700", "600", "bold", "bolder"] {
        let hits = scan(&page(
            &format!("span {{ {clamp} width: 290px; font-size: 15px; line-height: 18px; font-weight: {weight}; }}"),
            &format!("<span>{COPY}</span>"),
        ));
        assert!(hits.is_empty(), "weight {weight} in a clamp: {hits:?}");
    }
    for weight in ["500", "normal", "400"] {
        let hits = scan(&page(
            &format!("span {{ {clamp} width: 290px; font-size: 15px; line-height: 18px; font-weight: {weight}; }}"),
            &format!("<span>{COPY}</span>"),
        ));
        assert_eq!(hits.len(), 1, "weight {weight} in a clamp keeps the floor: {hits:?}");
    }
    // Bold without a clamp: the lines cannot be counted without layout, so
    // the static engine keeps the floor.
    let hits = scan(&page(
        "div { width: 265px; font-size: 14px; line-height: 16px; font-weight: 700; }",
        &format!("<div>{COPY}</div>"),
    ));
    assert_eq!(hits.len(), 1, "unclamped bold, lines unknown: {hits:?}");
    // A clamp on a plain block (which clamps nothing) and a flow-root box
    // that only clips are no line clamp.
    for decls in [
        "display: block; -webkit-line-clamp: 2; overflow: hidden;",
        "display: flow-root; overflow: hidden; max-height: 54px;",
    ] {
        let hits = scan(&page(
            &format!("div {{ {decls} width: 265px; font-size: 14px; line-height: 16px; font-weight: 700; }}"),
            &format!("<div>{COPY}</div>"),
        ));
        assert_eq!(hits.len(), 1, "{decls}: no clamp: {hits:?}");
    }
    // An authored flow-root box with a clamp value reads as the clamp, the
    // way the browser engine sees a CSS clamp Chrome computes as flow-root.
    let hits = scan(&page(
        "div { display: flow-root; -webkit-line-clamp: 2; overflow: hidden; width: 265px; font-size: 14px; line-height: 16px; font-weight: 700; }",
        &format!("<div>{COPY}</div>"),
    ));
    assert!(hits.is_empty(), "flow-root with a clamp value: {hits:?}");
}

#[test]
fn display_type_sets_its_own_leading() {
    let flagged = scan(&page(
        "p { width: 300px; font-size: 18px; line-height: 21.6px; }",
        &format!("<p>{COPY}</p>"),
    ));
    assert_eq!(flagged.len(), 1, "18px body copy at 1.2 flags: {flagged:?}");

    let display = scan(&page(
        "p { width: 600px; font-size: 32px; line-height: 38.4px; }",
        &format!("<p>{COPY}</p>"),
    ));
    assert!(display.is_empty(), "32px display type passes: {display:?}");
}

#[test]
fn heading_exemption_follows_the_ancestor() {
    let link = scan(&page(
        "h3 { font-size: 30px; line-height: 34px; } a { color: #111; }",
        &format!("<h3><a href=\"/story\">{COPY}</a></h3>"),
    ));
    assert!(link.is_empty(), "heading text in a child anchor passes: {link:?}");

    let role = scan(&page(
        "span { font-size: 22px; line-height: 28px; }",
        &format!("<div><span role=\"heading\" aria-level=\"3\">{COPY}</span></div>"),
    ));
    assert!(role.is_empty(), "role=heading card title passes: {role:?}");

    // A block of reading copy nested inside a heading is body copy, and the
    // ancestor exemption must not reach it.
    let nested = scan(&page(
        "h3 { font-size: 16px; } p { width: 300px; font-size: 16px; line-height: 17.6px; }",
        &format!("<h3><p>{COPY}</p></h3>"),
    ));
    assert_eq!(nested.len(), 1, "paragraph nested in a heading still flags: {nested:?}");

    // So is an inline run inside that paragraph.
    let run = scan(&page(
        "h3 { font-size: 16px; } p { width: 300px; } span { font-size: 16px; line-height: 17.6px; }",
        &format!("<h3><p><span>{COPY}</span></p></h3>"),
    ));
    assert_eq!(run.len(), 1, "span in a paragraph nested in a heading still flags: {run:?}");
}

#[test]
fn exactly_at_the_floor_never_flags() {
    for (size, leading) in [("18px", "23.4px"), ("16px", "20.8px"), ("14px", "18.2px")] {
        let hits = scan(&page(
            &format!("p {{ width: 300px; font-size: {size}; line-height: {leading}; }}"),
            &format!("<p>{COPY}</p>"),
        ));
        assert!(hits.is_empty(), "{size}/{leading} is exactly 1.3: {hits:?}");
    }
}

#[test]
fn source_text_is_never_measured() {
    let hits = scan(&page(
        "body { font-size: 16px; line-height: 16px; } .gone { display: none; } .off { visibility: hidden; }",
        &format!(
            "<script>window.__DATA__ = {{ id: \"a\", label: \"{COPY}\" }};</script>\
             <noscript>&lt;iframe src=\"https://example.test/t\" height=\"0\"&gt;&lt;/iframe&gt; {COPY}</noscript>\
             <p class=\"gone\">{COPY}</p><p class=\"off\">{COPY}</p>"
        ),
    ));
    assert!(hits.is_empty(), "non-rendered text has no leading to judge: {hits:?}");
}
