//! The static half of cramped-padding's flush-against-a-boundary shape.
//!
//! A file scan has no layout, so it cannot see where the glyphs land the way
//! the browser rule does. It reads the declarations that would move them
//! instead, which is why the padding that insets a container's text is
//! followed down through wrappers that hold no text of their own. What the
//! static scan still cannot clear is pinned here too, so the gap is visible
//! rather than folded into a golden.

use impeccable_html::{detect_html_source, DetectHtmlOptions};
use std::path::{Path, PathBuf};

fn scan(html: &str) -> Vec<String> {
    let opts = DetectHtmlOptions::default();
    detect_html_source(html, Path::new("/nonexistent/dir/x.html"), &opts)
        .into_iter()
        .filter(|f| f.antipattern == "cramped-padding")
        .map(|f| f.snippet)
        .collect()
}

fn page(style: &str, body: &str) -> String {
    format!("<!DOCTYPE html><html><head><style>{style}</style></head><body>{body}</body></html>")
}

/// `div.row > h3 > button.py-4`: the shape every component library emits for
/// an accordion. The direct child carries nothing; the padding that holds the
/// label off the rules is one step below it.
#[test]
fn padding_below_the_direct_child_still_insets() {
    let html = page(
        ".row { padding: 0 24px; border: 1px solid #cbd5e1; background: #fff; }
         .row h3 { margin: 0; }
         .row button { display: block; width: 100%; padding: 20px 0; border: 0; background: transparent; }",
        "<div class=\"row\"><h3><button type=\"button\">Which games does it work with?</button></h3></div>",
    );
    assert_eq!(scan(&html), Vec::<String>::new());
}

/// A chain of single-element wrappers passes the question all the way down.
#[test]
fn padding_further_down_a_single_chain_still_insets() {
    let html = page(
        ".wrap { padding: 0; border: 1px solid #cbd5e1; background: #fff; }
         .wrap .inner, .wrap .stack { padding: 0; margin: 0; }
         .wrap p { padding: 18px; margin: 0; }",
        "<div class=\"wrap\"><div class=\"inner\"><div class=\"stack\">\
         <p>Plans and pricing, compared</p></div></div></div>",
    );
    assert_eq!(scan(&html), Vec::<String>::new());
}

/// A wrapper holding several children stops the walk: any one of them can
/// reach the edge on its own, so the padding on another says nothing about
/// it. A scroll wrapper around a table is what that costs — the cells carry
/// the inset, below a branching `tr` — and only layout clears it.
#[test]
fn branching_wrappers_stop_the_walk() {
    let html = page(
        ".wrap { padding: 0; border: 1px solid #cbd5e1; background: #fff; overflow-x: auto; }
         .wrap table { border-collapse: collapse; width: 100%; }
         .wrap th, .wrap td { padding: 10px 16px; }",
        "<div class=\"wrap\"><table><tr><th>Plan</th><th>Seats</th></tr>\
         <tr><td>Starter</td><td>Three</td></tr></table></div>",
    );
    assert_eq!(
        scan(&html),
        vec!["<div> \"wrap\": children flush against border on all sides (no inset)".to_string()]
    );
}

/// Nothing below the wrapper insets anything, so the text really does run
/// into the border.
#[test]
fn a_wrapper_with_no_inset_anywhere_still_flags() {
    let html = page(
        ".row { padding: 0; border: 1px solid #cbd5e1; background: #fff; }
         .row h3 { margin: 0; }
         .row button { display: block; width: 100%; padding: 0; border: 0; background: transparent; }",
        "<div class=\"row\"><h3><button type=\"button\">Which games does it work with?</button></h3></div>",
    );
    assert_eq!(
        scan(&html),
        vec!["<div> \"row\": children flush against border on all sides (no inset)".to_string()]
    );
}

/// A wrapper whose own text sits at the edge is not cleared by a padded
/// sibling below it: the walk stops where text begins.
#[test]
fn text_on_the_way_down_stops_the_walk() {
    let html = page(
        ".row { padding: 0; border: 1px solid #cbd5e1; background: #fff; }
         .row .head { padding: 0; }
         .row .head span { padding: 20px; }",
        "<div class=\"row\"><div class=\"head\">Plans and pricing<span>Compare</span></div></div>",
    );
    assert_eq!(
        scan(&html),
        vec!["<div> \"row\": children flush against border on all sides (no inset)".to_string()]
    );
}

/// Issue #963: a single padding-free wrapper holding several padded sections
/// insets every side at its children and renders the same as the sections
/// sitting directly in the coloured wrapper.
#[test]
fn transparent_shell_holding_padded_sections_does_not_flag() {
    let style = "body { margin: 0; background: #eee; }
         .page { background: #fff; }
         header, main, footer { padding: 24px 32px; }";
    let direct = page(
        style,
        "<div class=\"page\"><header><a href=\"#\">Home</a></header>\
         <main><h1>Heading</h1><p>Body text.</p></main>\
         <footer><p>Footer text.</p></footer></div>",
    );
    assert_eq!(scan(&direct), Vec::<String>::new());

    let wrapped = page(
        style,
        "<div class=\"page\"><div class=\"inner\"><header><a href=\"#\">Home</a></header>\
         <main><h1>Heading</h1><p>Body text.</p></main>\
         <footer><p>Footer text.</p></footer></div></div>",
    );
    assert_eq!(scan(&wrapped), Vec::<String>::new());
}

/// White on an unpainted page is the canvas, not an edge; on a page that asks
/// for a dark scheme the browser paints a dark canvas and the same card is a
/// strong edge.
#[test]
fn the_canvas_follows_the_colour_scheme() {
    let light = page(
        ".card { padding: 0; background: #fff; border: 0; }
         .card p { margin: 0; padding: 0; }",
        "<div class=\"card\"><p>Today's headlines, in full</p></div>",
    );
    assert_eq!(scan(&light), Vec::<String>::new());

    let dark = page(
        ":root { color-scheme: dark; }
         .card { padding: 0; background: #fff; border: 0; }
         .card p { margin: 0; padding: 0; }",
        "<div class=\"card\"><p>Today's headlines, in full</p></div>",
    );
    assert_eq!(
        scan(&dark),
        vec!["<div> \"card\": children flush against bg on all sides (no inset)".to_string()]
    );
}

/// An absolutely positioned overlay's padding insets the overlay itself, not
/// the parent's box: it can never speak for the parent's edges. The walk must
/// stop at it, exactly like the browser rule does.
#[test]
fn a_positioned_shell_does_not_clear_the_walk() {
    let html = page(
        "body { margin: 0; }
         .page { background: #123; padding: 0; border: 0; }
         .rail { position: absolute; top: 0; left: 0; }
         .rail p { margin: 0; padding: 24px; }",
        "<div class=\"page\"><div class=\"rail\"><p>Rail one</p><p>Rail two</p></div></div>",
    );
    assert_eq!(
        scan(&html),
        vec!["<div> \"page\": children flush against bg on all sides (no inset)".to_string()]
    );
}

/// A transparent shell does not stop margin collapse: the first and last
/// vertical margins of its children collapse through it (and through a
/// padding-free page) out of the coloured box, so the text touches the edge
/// even though the declarations say 24px. Only padding (which never
/// collapses) holds; horizontal margins never collapse either.
#[test]
fn margins_collapse_through_a_transparent_shell() {
    let html = page(
        "body { margin: 0; }
         .page { background: #123; padding: 0; border: 0; }
         .inner { padding: 0; margin: 0; }
         .inner p { margin: 24px 0; padding: 0 24px; }",
        "<div class=\"page\"><div class=\"inner\">\
         <p>First paragraph of copy.</p><p>Second paragraph of copy.</p></div></div>",
    );
    assert_eq!(
        scan(&html),
        vec!["<div> \"page\": children flush against bg on top/bottom (no inset)".to_string()]
    );
}

/// The fixture's two columns are the contract: a file scan must report every
/// `flag-` case and nothing from the pass column. Layout is what clears the
/// rest of the pass column, and a file scan has none, so the cases it cannot
/// clear are listed here by name. The list may shrink; anything joining it
/// needs a reason in this file.
const STATIC_ONLY_LEFTOVERS: &[&str] = &[
    // A scroll wrapper whose table cells carry the inset, below a branching
    // row.
    "pass-table-wrap",
    // A spacer element, not a declaration, holds the text off the rule.
    "pass-tall-script",
    // A full-height child centres its label: only layout shows the air.
    "pass-segmented",
    // An inline trigger whose border-bottom is the underline itself.
    "pass-tooltip-underline",
    // A marquee track that scrolls its padded cards past the shell's edge.
    "pass-marquee-shell",
];

fn fixture(name: &str) -> Option<PathBuf> {
    let root = match std::env::var("IMPECCABLE_PUBLIC_REPO") {
        Ok(p) => PathBuf::from(p),
        Err(_) => Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."),
    };
    let p = root.join("tests/fixtures/antipatterns").join(name);
    p.is_file().then_some(p)
}

#[test]
fn the_flush_fixture_reports_its_flag_column() {
    let Some(path) = fixture("flush-against-border.html") else {
        eprintln!("fixture not found; skipping");
        return;
    };
    let src = std::fs::read_to_string(&path).unwrap();
    let mut flagged: Vec<String> = Vec::new();
    for snippet in scan(&src) {
        let name = snippet
            .split('"')
            .nth(1)
            .unwrap_or_default()
            .split_whitespace()
            .next()
            .unwrap_or_default()
            .to_string();
        assert!(
            name.starts_with("flag-") || STATIC_ONLY_LEFTOVERS.contains(&name.as_str()),
            "static scan reports a should-pass case: {snippet}"
        );
        if name.starts_with("flag-") {
            flagged.push(name);
        }
    }
    // Every flag case the file scan can reach; the rest of the flag column
    // needs layout and is covered by the URL scan.
    assert!(
        flagged.len() >= 5,
        "file scan lost flag cases: {flagged:?}"
    );
}
