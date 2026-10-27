//! Absolute CSS units (`pt`, `pc`, `in`, `cm`, `mm`, `Q`) over the static
//! engine. A print stylesheet sets type in `pt`; the length resolver used to
//! know only px / rem / em / %, so every other suffix fell through to the
//! unitless branch and `15pt` resolved as 15em. `oversized-h1` then read a
//! 15pt heading as 225px, and `tight-leading` read a `line-height: 0.3in` as
//! 0.3em, a crushed 0.30x. Every page below is set in an absolute unit and
//! must be judged as the same page set in px.

use impeccable_html::{detect_html_source, DetectHtmlOptions};
use std::path::Path;

/// One value per unit, each worth exactly 96px at 96px/in. The body is set to
/// 10px so that reading the number as ems (10px per unit) lands far from the
/// real size for every unit, `pc` included: at the 16px default 1pc is also
/// 1em, which would hide a fall-through.
const NINETY_SIX_PX: &[&str] = &["72pt", "6pc", "1in", "2.54cm", "25.4mm", "101.6Q"];

/// Each worth exactly 48px, under the 72px threshold.
const FORTY_EIGHT_PX: &[&str] = &["36pt", "3pc", "0.5in", "1.27cm", "12.7mm", "50.8Q"];

const HEADLINE: &str = "A long headline that clears the forty character floor of the rule";

const COPY: &str = "This paragraph is reading copy that is comfortably longer than the fifty characters the check asks for before it measures leading.";

fn page(head: &str, body: &str) -> String {
    format!(
        "<!DOCTYPE html><html><head><title>t</title><style>{head}</style></head><body>{body}</body></html>"
    )
}

fn snippets(html: &str, rule: &str) -> Vec<String> {
    detect_html_source(
        html,
        Path::new("/tmp/absolute-units.html"),
        &DetectHtmlOptions::default(),
    )
    .into_iter()
    .filter(|f| f.antipattern == rule)
    .map(|f| f.snippet)
    .collect()
}

fn h1_page(size: &str) -> String {
    page(
        &format!("body {{ font-size: 10px; }} h1 {{ font-size: {size}; }}"),
        &format!("<h1>{HEADLINE}</h1>"),
    )
}

#[test]
fn oversized_h1_measures_each_absolute_unit_in_px() {
    for size in NINETY_SIX_PX {
        let hits = snippets(&h1_page(size), "oversized-h1");
        assert_eq!(hits.len(), 1, "{size} is 96px and flags once: {hits:?}");
        assert!(
            hits[0].starts_with("96px h1,"),
            "{size} reads as 96px, got {:?}",
            hits[0]
        );
    }
}

#[test]
fn oversized_h1_passes_each_absolute_unit_under_the_threshold() {
    for size in FORTY_EIGHT_PX {
        let hits = snippets(&h1_page(size), "oversized-h1");
        assert!(
            hits.is_empty(),
            "{size} is 48px and must not flag: {hits:?}"
        );
    }
}

/// The repro from the bug report: 15pt is 20px, so the 15px body's 1.35
/// headline and 1.5 paragraph are both comfortable.
#[test]
fn a_print_page_in_pt_raises_neither_finding() {
    let html = page(
        "body { font-size: 15px; line-height: 1.5; } h1 { font-size: 15pt; line-height: 1.35; }",
        &format!("<h1>{HEADLINE}</h1><p>{COPY}</p>"),
    );
    assert!(snippets(&html, "oversized-h1").is_empty());
    assert!(snippets(&html, "tight-leading").is_empty());
}

/// A line-height in inches or centimetres is a fraction of the unit: 0.3in is
/// 28.8px, 1.92x of a 15px paragraph. Read as 0.3em it was 4.5px, a ratio of
/// 0.30x, and the paragraph flagged as crushed.
#[test]
fn a_line_height_in_inches_or_centimetres_is_not_read_as_ems() {
    for leading in ["0.3in", "0.76cm", "7.6mm", "22pt"] {
        let html = page(
            &format!("body {{ font-size: 15px; }} p {{ width: 300px; line-height: {leading}; }}"),
            &format!("<p>{COPY}</p>"),
        );
        let hits = snippets(&html, "tight-leading");
        assert!(
            hits.is_empty(),
            "{leading} over 15px is about 1.9x: {hits:?}"
        );
    }
    // And the ratio it reports when the leading really is short is the real one:
    // 0.2in is 19.2px, 1.28x of 15px.
    let tight = page(
        "body { font-size: 15px; } p { width: 300px; line-height: 0.2in; }",
        &format!("<p>{COPY}</p>"),
    );
    assert_eq!(
        snippets(&tight, "tight-leading"),
        vec!["line-height 1.28x (need >=1.3)".to_string()]
    );
}

/// Size and leading in the same unit at a 1.2 ratio: tight in every unit, and
/// the ratio is the one the numbers say, not one skewed by the unit.
#[test]
fn tight_leading_reads_size_and_line_height_in_each_absolute_unit() {
    let cases = [
        ("12pt", "14.4pt"),
        ("1pc", "1.2pc"),
        ("0.2in", "0.24in"),
        ("0.5cm", "0.6cm"),
        ("5mm", "6mm"),
        ("20Q", "24Q"),
    ];
    for (size, leading) in cases {
        let html = page(
            &format!(
                "body {{ font-size: 10px; }} p {{ width: 260px; font-size: {size}; line-height: {leading}; }}"
            ),
            &format!("<p>{COPY}</p>"),
        );
        let hits = snippets(&html, "tight-leading");
        assert_eq!(
            hits,
            vec!["line-height 1.20x (need >=1.3)".to_string()],
            "{size}/{leading}: {hits:?}"
        );
    }
}

/// A px line-height over a pt font size: 17px on 12pt (16px) is 1.06x and
/// flags; an 18px line over 8pt (10.7px) is 1.69x and does not.
#[test]
fn a_px_line_height_is_judged_against_the_real_pt_size() {
    let flag = page(
        "p { width: 260px; font-size: 12pt; line-height: 17px; }",
        &format!("<p>{COPY}</p>"),
    );
    assert_eq!(
        snippets(&flag, "tight-leading"),
        vec!["line-height 1.06x (need >=1.3)".to_string()]
    );
    let pass = page(
        "p { width: 260px; font-size: 8pt; line-height: 18px; }",
        &format!("<p>{COPY}</p>"),
    );
    assert!(snippets(&pass, "tight-leading").is_empty());
}

/// Units are case-insensitive in CSS: `PT`, `In` and `q` are the same units.
#[test]
fn absolute_units_are_case_insensitive() {
    for size in ["72PT", "1IN", "101.6q"] {
        let hits = snippets(&h1_page(size), "oversized-h1");
        assert_eq!(hits.len(), 1, "{size}: {hits:?}");
        assert!(hits[0].starts_with("96px h1,"), "{size}: {:?}", hits[0]);
    }
}
