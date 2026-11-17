//! Side bars through the static cascade: a left or right bar of 2px or more
//! reports on any box, and a 1px bar on a box the cascade rounds, by the
//! `border-radius` shorthand, the corner longhands a utility framework emits,
//! or a utility class. A radius the cascade cannot read is not known to round
//! the box.

use impeccable_html::{detect_html_source, DetectHtmlOptions};
use std::path::Path;

fn side_tab_snippets(card_css: &str) -> Vec<String> {
    let html = format!(
        "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>t</title>\
<style>.card{{width:400px;height:120px;padding:16px;background:#fdfdfd;{card_css}}}</style>\
</head><body><div class=\"card\"><h3>Card</h3><p>Body copy.</p></div></body></html>"
    );
    let opts = DetectHtmlOptions::default();
    let findings = detect_html_source(&html, Path::new("/nonexistent/dir/page.html"), &opts);
    let value = serde_json::to_value(&findings).unwrap();
    value
        .as_array()
        .unwrap()
        .iter()
        .filter(|f| f["antipattern"] == "side-tab")
        .map(|f| f["snippet"].as_str().unwrap_or("").to_string())
        .collect()
}

#[test]
fn a_side_bar_of_two_px_reports_on_a_square_card() {
    assert_eq!(side_tab_snippets("border-left:4px solid #6366f1;"), vec!["border-left: 4px"]);
    assert_eq!(side_tab_snippets("border-left:2px solid #9ca3af;border-radius:0;"), vec!["border-left: 2px"]);
    assert_eq!(side_tab_snippets("border-inline-end:3px solid currentColor;"), vec!["border-right: 3px"]);
    // A hairline on a square card is a divider; a frame, a transparent edge
    // are not bars.
    assert!(side_tab_snippets("border-left:1px solid #ddd;").is_empty());
    assert!(side_tab_snippets("border:2px solid #ddd;").is_empty());
    assert!(side_tab_snippets("border-left:3px solid transparent;").is_empty());
}

#[test]
fn a_hairline_reports_on_a_card_the_cascade_rounds() {
    let bar = "border-left:1px solid #ddd;";
    for (css, want) in [
        ("border-radius:10px;", "border-left: 1px + border-radius: 10px"),
        ("border-radius:10px 0 0 10px;", "border-left: 1px + border-radius: 10px"),
        // `border-l border-gray-200 rounded-r-lg` compiles to this.
        ("border-top-right-radius:.5rem;border-bottom-right-radius:.5rem;", "border-left: 1px + border-radius: 8px"),
        ("font-size:20px;border-radius:0.3em;", "border-left: 1px + border-radius: 6px"),
        ("--r:0 12px 12px 0;border-radius:var(--r);", "border-left: 1px + border-radius: 12px"),
    ] {
        assert_eq!(side_tab_snippets(&format!("{bar}{css}")), vec![want.to_string()], "{css}");
    }
    // A later shorthand squares what an earlier longhand rounded.
    assert!(side_tab_snippets(&format!("{bar}border-top-right-radius:10px;border-radius:0;")).is_empty());
    // A radius the cascade cannot read is not known to round the card.
    assert!(side_tab_snippets(&format!("{bar}border-radius:calc(0.5rem);")).is_empty());
}

fn side_tab_page(css: &str, body: &str) -> Vec<String> {
    let html = format!(
        "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>t</title>\
<style>.c{{width:400px;height:120px;padding:16px;background:#fdfdfd}}{css}</style></head><body>{body}</body></html>"
    );
    let findings = detect_html_source(
        &html,
        Path::new("/nonexistent/dir/page.html"),
        &DetectHtmlOptions::default(),
    );
    let value = serde_json::to_value(&findings).unwrap();
    let mut out: Vec<String> = value
        .as_array()
        .unwrap()
        .iter()
        .filter(|f| f["antipattern"] == "side-tab")
        .map(|f| f["snippet"].as_str().unwrap_or("").to_string())
        .collect();
    out.sort();
    out
}

const PRODUCER_BODY: &str =
    "<div class=\"c bd\">b</div><div class=\"c sq\">p</div><div class=\"c sh\">s</div>";

/// One visual, three authorings: a border, an absolute ::before bar, an inset
/// box-shadow. The static engine answers all three the same way, square at
/// 2px and up, rounded at 1px, whatever their colour.
#[test]
fn every_static_producer_answers_the_same_visual_the_same_way() {
    let bars = |w: u8| {
        format!(
            ".bd{{border-left:{w}px solid #9ca3af}}\
.sq{{position:relative}}.sq::before{{content:\"\";position:absolute;left:0;top:0;bottom:0;width:{w}px;background:#9ca3af}}\
.sh{{box-shadow:inset {w}px 0 0 0 var(--text)}}"
        )
    };
    assert_eq!(
        side_tab_page(&bars(2), PRODUCER_BODY),
        vec![
            ".sh — inset box-shadow 2px stripe (left)".to_string(),
            ".sq::before — absolute 2px pseudo-element stripe (left: 0)".to_string(),
            "border-left: 2px".to_string(),
        ]
    );
    assert_eq!(side_tab_page(&bars(1), PRODUCER_BODY), Vec::<String>::new());
    let rounded = format!("{}.bd,.sq,.sh{{border-radius:12px}}", bars(1));
    assert_eq!(
        side_tab_page(&rounded, PRODUCER_BODY),
        vec![
            ".sh — inset box-shadow 1px stripe (left)".to_string(),
            ".sq::before — absolute 1px pseudo-element stripe (left: 0)".to_string(),
            "border-left: 1px + border-radius: 12px".to_string(),
        ]
    );
}

/// A top or bottom band passes the same rounded-card gate in every producer
/// (decision r6-t2-side-tab-bands): silent on a square box, reported on a
/// card rounded away from it.
#[test]
fn a_top_band_needs_a_rounded_card_in_every_producer() {
    let css = ".bd{border-top:4px solid #6366f1}\
.sq{position:relative}.sq::after{content:\"\";position:absolute;left:0;right:0;top:0;height:5px;background:#6366f1}\
.sh{box-shadow:inset 0 6px 0 0 #6366f1}";
    assert!(side_tab_page(css, PRODUCER_BODY).is_empty());
    // Rounded only away from the band: the bottom corners.
    let rounded = ".bd,.sq,.sh{border-radius:0 0 12px 12px}".to_string() + css;
    assert_eq!(side_tab_page(&rounded, PRODUCER_BODY).len(), 3);
}

/// The radius can come from any rule that matches the element: the cascade
/// sees a second class the bar rule never names, or the element a state
/// selector styles.
#[test]
fn a_hairline_reads_the_cascade_of_the_element_it_paints() {
    let css = ".shell{border-radius:12px}\
.sq::before{content:\"\";position:absolute;right:0;top:0;bottom:0;width:1px;background:#ddd}";
    assert_eq!(
        side_tab_page(css, "<div class=\"c shell sq\">p</div>"),
        vec![".sq::before — absolute 1px pseudo-element stripe (right: 0)".to_string()]
    );
    assert!(side_tab_page(css, "<div class=\"c sq\">p</div>").is_empty());
    // The pressed nav button: the radius is on `.it`, the bar on its state.
    let pressed = ".it{display:grid;padding:7px 12px;border:0;border-radius:6px;background:none}\
.it:hover{background:var(--hover)}\
.it[aria-pressed='true']{background:var(--surface-inset);box-shadow:inset 1px 0 0 var(--text);font-weight:600}";
    assert_eq!(
        side_tab_page(pressed, "<nav><button class=\"it\" aria-pressed=\"true\">One</button></nav>"),
        vec![".it[aria-pressed='true'] — inset box-shadow 1px stripe (left)".to_string()]
    );
}

/// A bar rule no element on the page matches reads its host rule's own
/// declarations, the way the text engine reads a stylesheet.
#[test]
fn a_hairline_with_no_matching_element_reads_the_host_rule() {
    let css = ".ghost{border-radius:12px}\
.ghost::before{content:\"\";position:absolute;left:0;top:0;bottom:0;width:1px;background:#ddd}\
.plain::before{content:\"\";position:absolute;left:0;top:0;bottom:0;width:1px;background:#ddd}";
    assert_eq!(
        side_tab_page(css, "<div class=\"c\">x</div>"),
        vec![".ghost::before — absolute 1px pseudo-element stripe (left: 0)".to_string()]
    );
}

fn side_tabs_on_page(head: &str, body: &str) -> Vec<String> {
    let html = format!(
        "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>t</title>{head}\
</head><body>{body}</body></html>"
    );
    let opts = DetectHtmlOptions::default();
    let findings = detect_html_source(&html, Path::new("/nonexistent/dir/page.html"), &opts);
    let value = serde_json::to_value(&findings).unwrap();
    let mut out: Vec<String> = value
        .as_array()
        .unwrap()
        .iter()
        .filter(|f| f["antipattern"] == "side-tab")
        .map(|f| f["snippet"].as_str().unwrap_or("").to_string())
        .collect();
    out.sort();
    out
}

#[test]
fn a_rounded_class_with_no_compiled_rule_reads_the_utility_scale() {
    let css = "<style>.card{width:400px;height:120px;border-left:1px solid #ddd}</style>";
    let body = |classes: &str| format!("<div class=\"{classes}\"><h3>Card</h3><p>Body copy.</p></div>");
    assert_eq!(side_tabs_on_page(css, &body("card rounded-xl")), vec!["border-left: 1px + border-radius: 12px"]);
    assert!(side_tabs_on_page(css, &body("card rounded-none")).is_empty());
}

#[test]
fn a_row_stripe_reports_only_where_its_selector_matches_a_cell() {
    let count = |cls: &str| {
        let html = format!(
            "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>t</title>\
<style>td.is-x:not(.plain){{box-shadow:inset 3px 0 0 #d0342c;}}</style></head>\
<body><table><tr><td class=\"is-x {cls}\">a</td></tr></table></body></html>"
        );
        let findings = detect_html_source(&html, Path::new("/nonexistent/dir/page.html"), &DetectHtmlOptions::default());
        let value = serde_json::to_value(&findings).unwrap();
        value.as_array().unwrap().iter().filter(|f| f["antipattern"] == "side-tab").count()
    };
    assert_eq!(count("plain"), 0);
    assert_eq!(count("other"), 1);
    // A plain branch beside a status branch reports only where a status
    // row is on the page.
    let branches = "<style>tr.is-error td,td.amount{box-shadow:inset 3px 0 0 #d0342c;background:#fff}</style>";
    assert!(side_tabs_on_page(branches, "<table><tr><td class=\"amount\">1</td></tr></table>").is_empty());
    assert_eq!(side_tabs_on_page(branches, "<table><tr class=\"is-error\"><td>1</td></tr></table>").len(), 1);
    // A row card reports once, rounded by another rule or square.
    let row_card = "<div class=\"row-card is-x\">A row card</div>";
    let stripe = ".row-card.is-x{width:400px;height:48px;box-shadow:inset 3px 0 0 #d0342c}";
    let rounded = side_tabs_on_page(&format!("<style>{stripe}.row-card{{border-radius:12px}}</style>"), row_card);
    assert_eq!(rounded.len(), 1, "{rounded:?}");
    let square = side_tabs_on_page(&format!("<style>{stripe}</style>"), row_card);
    assert_eq!(square.len(), 1, "{square:?}");
}
