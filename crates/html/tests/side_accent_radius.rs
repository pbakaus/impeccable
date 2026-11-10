//! The side-accent gate through the static cascade: a card is rounded by the
//! `border-radius` shorthand, by the corner longhands a utility framework
//! emits, or not at all, and an unreadable radius is unknown rather than
//! square.

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
fn a_square_card_with_a_side_rule_stays_silent() {
    assert!(side_tab_snippets("border-left:4px solid #6366f1;").is_empty());
    assert!(side_tab_snippets("border-left:4px solid #6366f1;border-radius:0;").is_empty());
    // Rounded only where the stripe runs: still square where it counts.
    assert!(
        side_tab_snippets("border-left:4px solid #6366f1;border-radius:10px 0 0 10px;").is_empty()
    );
    // The same shape written as longhands.
    assert!(side_tab_snippets(
        "border-left:4px solid #6366f1;border-top-left-radius:10px;border-bottom-left-radius:10px;"
    )
    .is_empty());
}

#[test]
fn corner_longhands_round_a_card_the_shorthand_never_names() {
    // `border-l-4 border-indigo-500 rounded-r-lg` compiles to exactly this.
    assert_eq!(
        side_tab_snippets(
            "border-left-width:4px;border-left-style:solid;border-left-color:#6366f1;\
border-top-right-radius:.5rem;border-bottom-right-radius:.5rem;"
        ),
        vec!["border-left: 4px".to_string()]
    );
    // A longhand that rounds a corner the shorthand squared off counts too.
    assert_eq!(
        side_tab_snippets(
            "border-left:4px solid #6366f1;border-radius:0;border-top-right-radius:10px;\
border-bottom-right-radius:10px;"
        ),
        vec!["border-left: 4px".to_string()]
    );
}

#[test]
fn an_unreadable_radius_keeps_the_finding() {
    // calc(), var() and units this cannot resolve are unknown, not square.
    for css in [
        "border-left:4px solid #6366f1;border-radius:calc(0.5rem);",
        "border-left:4px solid #6366f1;border-radius:var(--r);",
        "border-left:4px solid #6366f1;border-radius:1vw;",
        "border-left:4px solid #6366f1;border-top-right-radius:calc(8px);",
    ] {
        assert_eq!(side_tab_snippets(css).len(), 1, "css {css:?}");
    }
    // A unit spelled in capitals is the same unit.
    assert_eq!(
        side_tab_snippets("border-left:4px solid #6366f1;border-radius:0.5REM;").len(),
        1
    );
}

#[test]
fn a_rounded_card_with_a_side_accent_still_reports() {
    assert_eq!(
        side_tab_snippets("border-left:4px solid #6366f1;border-radius:10px;"),
        vec!["border-left: 4px + border-radius: 10px".to_string()]
    );
    assert_eq!(
        side_tab_snippets("border-left:4px solid #6366f1;border-radius:0 10px 10px 0;"),
        vec!["border-left: 4px".to_string()]
    );
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
/// box-shadow. The static engine answers all three the same way.
#[test]
fn every_static_producer_answers_the_same_visual_the_same_way() {
    let stripes = ".bd{border-left:4px solid #6366f1}\
.sq{position:relative}.sq::before{content:\"\";position:absolute;left:0;top:0;bottom:0;width:5px;background:#6366f1}\
.sh{box-shadow:inset 6px 0 0 0 #6366f1}";
    assert_eq!(side_tab_page(stripes, PRODUCER_BODY), Vec::<String>::new());

    let rounded = format!("{stripes}.bd,.sq,.sh{{border-radius:12px}}");
    assert_eq!(
        side_tab_page(&rounded, PRODUCER_BODY),
        vec![
            ".sh — inset box-shadow 6px stripe (left)".to_string(),
            ".sq::before — absolute 5px pseudo-element stripe (left: 0)".to_string(),
            "border-left: 4px + border-radius: 12px".to_string(),
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
/// sees a second class the stripe rule never names.
#[test]
fn a_stripe_reads_the_cascade_of_the_element_it_paints() {
    let css = ".shell{border-radius:12px}\
.sq::before{content:\"\";position:absolute;right:0;top:0;bottom:0;width:5px;background:#6366f1}";
    assert_eq!(
        side_tab_page(css, "<div class=\"c shell sq\">p</div>"),
        vec![".sq::before — absolute 5px pseudo-element stripe (right: 0)".to_string()]
    );
    assert!(side_tab_page(css, "<div class=\"c sq\">p</div>").is_empty());
}

/// A stripe rule no element on the page matches reads its host rule's own
/// declarations, the way the text engine reads a stylesheet.
#[test]
fn a_stripe_with_no_matching_element_reads_the_host_rule() {
    let css = ".ghost{border-radius:12px}\
.ghost::before{content:\"\";position:absolute;left:0;top:0;bottom:0;width:5px;background:#6366f1}\
.plain::before{content:\"\";position:absolute;left:0;top:0;bottom:0;width:6px;background:#6366f1}";
    assert_eq!(
        side_tab_page(css, "<div class=\"c\">x</div>"),
        vec![".ghost::before — absolute 5px pseudo-element stripe (left: 0)".to_string()]
    );
}

/// Shorthand and longhands resolve in cascade order, the way the browser
/// resolves them: `rounded-lg rounded-r-none` is square away from a left
/// stripe, and a later shorthand resets an earlier longhand.
#[test]
fn radius_longhands_and_shorthand_resolve_in_cascade_order() {
    assert!(side_tab_snippets(
        "border-left:4px solid #6366f1;border-radius:12px;border-top-right-radius:0;border-bottom-right-radius:0;"
    )
    .is_empty());
    assert_eq!(
        side_tab_page(
            ".c.a{border-left:4px solid #6366f1;border-top-right-radius:0;border-bottom-right-radius:0}.c.a{border-radius:12px}",
            "<div class=\"c a\">x</div>"
        ),
        vec!["border-left: 4px + border-radius: 12px".to_string()]
    );
    // A more specific longhand beats a later, less specific shorthand.
    assert!(side_tab_page(
        ".c.a{border-left:4px solid #6366f1;border-top-right-radius:0;border-bottom-right-radius:0}.c{border-radius:12px}",
        "<div class=\"c a\">x</div>"
    )
    .is_empty());
}

/// `em` resolves against the element's own font size, and the snippet prints
/// the radius in px, the way the browser's computed style does.
#[test]
fn em_and_rem_radii_resolve_to_px() {
    assert!(
        side_tab_snippets("font-size:12px;border-left:4px solid #6366f1;border-radius:0.3em;")
            .is_empty()
    );
    assert_eq!(
        side_tab_snippets("font-size:20px;border-left:4px solid #6366f1;border-radius:0.3em;"),
        vec!["border-left: 4px + border-radius: 6px".to_string()]
    );
    assert_eq!(
        side_tab_snippets("border-left:4px solid #6366f1;border-radius:0.5rem;"),
        vec!["border-left: 4px + border-radius: 8px".to_string()]
    );
}

#[test]
fn a_var_built_radius_reads_each_corner_once_it_resolves() {
    // Rounded away from the stripe through a custom property: reports.
    assert_eq!(
        side_tab_snippets(
            "--r:0 12px 12px 0;border-left:4px solid #6366f1;border-radius:var(--r);"
        ),
        vec!["border-left: 4px".to_string()]
    );
    // Rounded only under the stripe: square where it counts.
    assert!(side_tab_snippets(
        "--r:12px 0 0 12px;border-left:4px solid #6366f1;border-radius:var(--r);"
    )
    .is_empty());
    // A later longhand still wins its corner over the var-built shorthand.
    assert!(side_tab_snippets(
        "--r:12px;border-left:4px solid #6366f1;border-radius:var(--r);\
border-top-right-radius:0;border-bottom-right-radius:0;"
    )
    .is_empty());
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

const CARD: &str = "width:400px;height:120px;padding:16px;background:#fdfdfd;\
border-left:4px solid #6366f1;";
const CARD_BODY: &str = "<div class=\"card\"><h3>Card</h3><p>Body copy.</p></div>";

/// Wherever the cascade cannot see a radius that may reach the card, the side
/// accent keeps its finding, as it did before the rounded-card gate. A card
/// whose every stylesheet the engine read, with no radius or a literal square
/// one, still drops it.
#[test]
fn a_radius_the_cascade_cannot_see_keeps_the_finding() {
    let page = |css: &str| side_tabs_on_page(&format!("<style>{css}</style>"), CARD_BODY);
    // A radius in a nested rule or in a container query the cascade skips.
    assert_eq!(
        page(&format!(".card{{{CARD}&.card{{border-radius:12px}}}}")),
        vec!["border-left: 4px"]
    );
    assert_eq!(
        page(&format!(
            ".card{{{CARD}}}@container (min-width:1px){{.card{{border-radius:12px}}}}"
        )),
        vec!["border-left: 4px"]
    );
    // The same shapes with a literal square radius, or a radius behind a
    // hover state that cannot round the card at rest, stay silent.
    assert!(page(&format!(".card{{{CARD}&.card{{border-radius:0}}}}")).is_empty());
    assert!(page(&format!(".card{{{CARD}&:hover{{border-radius:12px}}}}")).is_empty());
    assert!(page(&format!(".card{{{CARD}}}")).is_empty());
}

#[test]
fn a_rounded_class_with_no_compiled_rule_reads_the_utility_scale() {
    let css = format!("<style>.card{{{CARD}}}</style>");
    let body =
        |classes: &str| format!("<div class=\"{classes}\"><h3>Card</h3><p>Body copy.</p></div>");
    assert_eq!(
        side_tabs_on_page(&css, &body("card rounded-xl")),
        vec!["border-left: 4px"]
    );
    // A theme size the scale does not name is unknown.
    assert_eq!(
        side_tabs_on_page(&css, &body("card rounded-card")),
        vec!["border-left: 4px"]
    );
    assert!(side_tabs_on_page(&css, &body("card rounded-none")).is_empty());
    // Rounded only along the left stripe: square where it counts.
    assert!(side_tabs_on_page(&css, &body("card rounded-l-xl")).is_empty());
}

#[test]
fn an_unread_stylesheet_keeps_a_card_it_never_saw_a_radius_for() {
    let square = format!("<style>.card{{{CARD}}}</style>");
    for href in ["https://cdn.example.com/ui.css", "missing.css"] {
        assert_eq!(
            side_tabs_on_page(
                &format!("<link rel=\"stylesheet\" href=\"{href}\">{square}"),
                CARD_BODY
            ),
            vec!["border-left: 4px"],
            "{href}"
        );
    }
    // A font service carries no box rules.
    assert!(side_tabs_on_page(
        &format!(
            "<link rel=\"stylesheet\" href=\"https://fonts.googleapis.com/css2?family=Inter\">{square}"
        ),
        CARD_BODY
    )
    .is_empty());
    // A radius the engine read wins whatever else the page links.
    assert!(side_tabs_on_page(
        &format!(
            "<link rel=\"stylesheet\" href=\"https://cdn.example.com/ui.css\">\
<style>.card{{{CARD}border-radius:0}}</style>"
        ),
        CARD_BODY
    )
    .is_empty());
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
    // A row card rounded by another rule is the card scans' to report, once.
    let row_card = "<div class=\"row-card is-x\">A row card</div>";
    let stripe = ".row-card.is-x{width:400px;height:48px;box-shadow:inset 3px 0 0 #d0342c}";
    let rounded = side_tabs_on_page(&format!("<style>{stripe}.row-card{{border-radius:12px}}</style>"), row_card);
    assert_eq!(rounded.len(), 1, "{rounded:?}");
    assert!(!rounded[0].contains("row or cell"), "{rounded:?}");
    let square = side_tabs_on_page(&format!("<style>{stripe}</style>"), row_card);
    assert!(square.len() == 1 && square[0].contains("row or cell"), "{square:?}");
}
