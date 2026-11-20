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

/// Issue #963 scope: only a stacked, edgeless shell is seen through. A row
/// flex shell lays its sections side by side, and a shell with a shadow is a
/// card of its own; both stop the walk and the page still flags.
#[test]
fn row_or_shadowed_shells_are_not_seen_through() {
    let body = "<div class=\"page\"><div class=\"inner\"><header><a href=\"#\">Home</a></header>\
         <main><h1>Heading</h1><p>Body text.</p></main></div></div>";
    let expect =
        vec!["<div> \"page\": children flush against bg on all sides (no inset)".to_string()];
    for inner in ["display: flex;", "box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);"] {
        let style = format!(
            "body {{ margin: 0; background: #eee; }}
             .page {{ background: #fff; }}
             .inner {{ {inner} }}
             header, main {{ padding: 24px 32px; }}"
        );
        assert_eq!(scan(&page(&style, body)), expect, "{inner}");
    }
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

/// A `flow-root` shell holds its children's vertical margins inside its own
/// box, so they really do inset the coloured page; only plain block flow lets
/// them collapse out.
#[test]
fn a_flow_root_shell_keeps_margin_clearance() {
    let html = page(
        "body { margin: 0; }
         .page { background: #123; padding: 0; border: 0; }
         .inner { display: flow-root; padding: 0; margin: 0; }
         .inner p { margin: 24px 0; padding: 0 24px; }",
        "<div class=\"page\"><div class=\"inner\">\
         <p>First paragraph of copy.</p><p>Second paragraph of copy.</p></div></div>",
    );
    assert_eq!(scan(&html), Vec::<String>::new());
}

/// A flex column stacks like a block but its items' margins never collapse,
/// so the same declarations are visible air between the text and the edge.
#[test]
fn a_column_flex_shell_keeps_margin_clearance() {
    let html = page(
        "body { margin: 0; }
         .page { background: #123; padding: 0; border: 0; }
         .inner { display: flex; flex-direction: column; padding: 0; margin: 0; }
         .inner p { margin: 24px 0; padding: 0 24px; }",
        "<div class=\"page\"><div class=\"inner\">\
         <p>First paragraph of copy.</p><p>Second paragraph of copy.</p></div></div>",
    );
    assert_eq!(scan(&html), Vec::<String>::new());
}

/// A border on the coloured box stops the collapse at the box, so the margin
/// keeps the text off the rule even though the shell in between is plain
/// block.
#[test]
fn a_border_on_the_coloured_box_keeps_margin_clearance() {
    let html = page(
        "body { margin: 0; }
         .page { background: #123; padding: 0; border: 1px solid #123; }
         .inner { padding: 0; margin: 0; }
         .inner p { margin: 24px 0; padding: 0 24px; }",
        "<div class=\"page\"><div class=\"inner\">\
         <p>First paragraph of copy.</p><p>Second paragraph of copy.</p></div></div>",
    );
    assert_eq!(scan(&html), Vec::<String>::new());
}

/// The text of the wrapper itself renders where the wrapper does. A label
/// short enough to slip the pass-through's length bar (`Sale`) still sits on
/// the page's edge, so the shell is not seen through.
#[test]
fn a_short_label_in_the_shell_keeps_the_warning() {
    let html = page(
        "body { margin: 0; }
         .page { background: #123; padding: 0; border: 0; }
         .inner { padding: 0; margin: 0; }
         .inner section { padding: 24px 32px; }",
        "<div class=\"page\"><div class=\"inner\">Sale\
         <section><p>First block of copy.</p></section>\
         <section><p>Second block of copy.</p></section></div></div>",
    );
    assert_eq!(
        scan(&html),
        vec!["<div> \"page\": children flush against bg on all sides (no inset)".to_string()]
    );
}

/// A box that centres a label in a minimum height insets it without padding
/// (#1596), whether it is the bounded box's child or the bounded box itself.
/// A height about one line tall, a label too long to stay on one line, a
/// column stack or no centring at all leaves the text on the rule.
#[test]
fn a_label_centred_in_a_min_height_is_inset() {
    let disc = |button: &str, text: &str| {
        scan(&page(
            &format!(
                ".disc {{ border: 1px solid #d1d5c3; background: #fff; }}
                 .disc > button {{ display: flex; min-height: 44px; padding: 0 12px; font-size: 14px; border: 0; background: transparent; {button} }}"
            ),
            &format!("<div class=\"disc\"><button type=\"button\">{text}</button></div>"),
        ))
    };
    assert_eq!(disc("align-items: center;", "Instagram"), Vec::<String>::new());
    let flush = vec!["<div> \"disc\": children flush against border on top/bottom (no inset)".to_string()];
    assert_eq!(disc("", "Instagram"), flush);
    assert_eq!(disc("align-items: center; min-height: 20px;", "Instagram"), flush);
    assert_eq!(disc("align-items: center; flex-direction: column;", "Instagram"), flush);
    assert_eq!(disc("align-items: center;", "Connect your Instagram account to share every post"), flush);
    assert_eq!(disc("align-items: center; line-height: 22px;", "Account<br>settings"), flush);
    assert_eq!(disc("align-items: center; transform: translateY(-14px);", "Instagram"), flush);
    let row = |style: &str| {
        scan(&page(
            &format!(
                ".chip {{ width: 24px; height: 24px; }}
                 .row {{ display: flex; min-height: 44px; padding: 0 8px; border: 1px solid #d1d5c3; {style} }}"
            ),
            "<div class=\"row\"><span class=\"chip\"></span><span>Instagram</span></div>",
        ))
    };
    assert_eq!(row("align-items: center;"), Vec::<String>::new());
    let flush = vec!["<div> \"row\": children flush against border on top/bottom (no inset)".to_string()];
    assert_eq!(row(""), flush);
    assert_eq!(row("align-items: center; min-height: 40px; } .row .chip { height: 36px;"), flush);
    assert_eq!(row("align-items: center; } .row span + span { font-size: 36px; line-height: 40px;"), flush);
    assert_eq!(row("align-items: center; } .row .chip { align-self: stretch;"), flush);
    assert_eq!(row("align-items: center; } .row .chip { height: calc(44px);"), flush);
}

/// `padding-inline-start` beside `border-inline-start` is the padding on the
/// bordered side (#1604); without it the cell's spans sit on the rule.
#[test]
fn logical_padding_insets_the_side_it_lands_on() {
    let cells = |pad: &str| {
        scan(&page(
            &format!(".g {{ display: grid; }} .g > div + div {{ border-inline-start: 1px solid #999; {pad} }}"),
            "<div class=\"g\"><div><span>Asalan</span><span>Gayo, Aceh</span></div>\
             <div><span>Disangrai</span><span>14 November 2026</span></div></div>",
        ))
    };
    assert_eq!(cells("padding-inline-start: 1rem;"), Vec::<String>::new());
    assert_eq!(cells("padding-inline: 1rem 0;"), Vec::<String>::new());
    let flush = vec!["<div>: children flush against border-left on left (no inset)".to_string()];
    assert_eq!(cells(""), flush);
    assert_eq!(cells("padding-inline: 0 1rem;"), flush);
}

/// Padding this engine cannot evaluate (`clamp()`, `calc()`, directly or
/// through a custom property) may be any length, so it is not read as zero
/// (#1605). A zero padding still flags.
#[test]
fn padding_written_as_a_math_function_is_not_zero() {
    let board = |pad: &str| {
        scan(&page(
            &format!(
                ":root {{ --pad: clamp(1.5rem, 4vw, 3.5rem); }}
                 .b {{ background: #232a28; color: #e7e9e4; border: 10px solid #4a3b2a; {pad} }}"
            ),
            "<div class=\"b\"><div>Hello there</div></div>",
        ))
    };
    assert_eq!(board("padding: clamp(1.5rem, 4vw, 3.5rem) 2rem;"), Vec::<String>::new());
    assert_eq!(board("padding: var(--pad);"), Vec::<String>::new());
    assert_eq!(board("padding: calc(1rem + 2px);"), Vec::<String>::new());
    assert_eq!(
        board("padding: 0;"),
        vec!["<div> \"b\": children flush against border+bg on all sides (no inset)".to_string()]
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

/// `cramped-padding-shell.html` (PR #1059): a shell's relative offset carries
/// its padded children onto the rule, and a border of any colour or a card
/// that is a flex, grid or flow-root container holds the children's margins
/// inside. The file scan reads all of it from the declarations, so the two
/// columns hold exactly.
#[test]
fn the_shell_fixture_reports_exactly_its_flag_column() {
    let Some(path) = fixture("cramped-padding-shell.html") else {
        eprintln!("fixture not found; skipping");
        return;
    };
    let src = std::fs::read_to_string(&path).unwrap();
    let mut flagged: Vec<String> = scan(&src)
        .iter()
        .map(|snippet| snippet.split('"').nth(1).unwrap_or_default().to_string())
        .collect();
    flagged.sort();
    assert_eq!(
        flagged,
        vec![
            "flag-shell-em-pull".to_string(),
            "flag-shell-loose-sibling".to_string(),
            "flag-shell-margins-escape".to_string(),
            "flag-shell-negative-margin".to_string(),
            "flag-shell-offset-left".to_string(),
            "flag-shell-offset-top".to_string(),
            "flag-shell-paragraph-offset".to_string(),
            "flag-shell-shorthand-pull".to_string(),
            "flag-shell-transform".to_string(),
        ]
    );
}
