use impeccable_html::{detect_html_source, DetectHtmlOptions};
use std::cell::RefCell;
use std::path::Path;

fn cramped_padding_ids(html: &str, warn: Option<&dyn Fn(&str)>) -> Vec<String> {
    let options = DetectHtmlOptions {
        warn,
        ..Default::default()
    };
    detect_html_source(
        html,
        Path::new("/nonexistent/samples/image-card.html"),
        &options,
    )
    .into_iter()
    .filter(|finding| finding.antipattern == "cramped-padding")
    .map(|finding| finding.snippet)
    .collect()
}

#[test]
fn unreadable_stylesheet_does_not_turn_unresolved_vars_into_cramped_padding() {
    let warnings = RefCell::new(String::new());
    let warn = |message: &str| warnings.borrow_mut().push_str(message);
    let html = r#"
        <link rel="stylesheet" href="brand/tokens.css">
        <style>
          .reverse {
            background: var(--brand-surface);
            padding: var(--brand-pad-y) var(--brand-pad-x);
          }
        </style>
        <div class="reverse"><p>Readable card copy</p></div>
    "#;

    assert!(cramped_padding_ids(html, Some(&warn)).is_empty());
    assert!(warnings
        .borrow()
        .contains("color and custom-property rules will be incomplete"));
}

#[test]
fn unresolved_padding_is_not_assumed_to_be_zero() {
    let html = r#"
        <style>
          .reverse {
            background: #f5f5f5;
            padding: var(--missing-padding);
          }
        </style>
        <div class="reverse"><p>Readable card copy</p></div>
    "#;

    assert!(cramped_padding_ids(html, None).is_empty());
}

#[test]
fn concrete_var_fallbacks_still_report_real_cramped_padding() {
    let html = r#"
        <style>
          .reverse {
            background: var(--missing-surface, #f5f5f5);
            padding: var(--missing-padding, 0);
          }
        </style>
        <div class="reverse"><p>Readable card copy</p></div>
    "#;

    assert_eq!(cramped_padding_ids(html, None).len(), 1);
}

#[test]
fn nested_concrete_var_fallbacks_still_report_real_cramped_padding() {
    let html = r#"
        <style>
          .reverse {
            background: var(--missing-surface, #f5f5f5);
            padding: var(--outer-padding, var(--inner-padding, 0));
          }
        </style>
        <div class="reverse"><p>Readable card copy</p></div>
    "#;

    assert_eq!(cramped_padding_ids(html, None).len(), 1);
}

#[test]
fn unresolved_border_style_is_not_a_visible_boundary() {
    let html = r#"
        <style>
          .reverse {
            border-width: 1px;
            border-color: #111;
            border-style: var(--missing-border-style);
            padding: 0;
          }
        </style>
        <div class="reverse"><p>Readable card copy</p></div>
    "#;

    assert!(cramped_padding_ids(html, None).is_empty());
}

#[test]
fn concrete_border_style_overrides_earlier_unresolved_style() {
    let html = r#"
        <style>
          .reverse {
            border-width: 1px;
            border-color: #111;
            border-style: var(--missing-border-style);
            border-style: solid;
            padding: 0;
          }
        </style>
        <div class="reverse"><p>Readable card copy</p></div>
    "#;

    assert_eq!(cramped_padding_ids(html, None).len(), 1);
}

#[test]
fn multi_value_border_style_fallback_is_not_misread_on_every_side() {
    let html = r#"
        <style>
          .reverse {
            border-width: 1px;
            border-color: #111;
            border-style: var(--missing-border-styles, none solid);
            padding: 0;
          }
        </style>
        <div class="reverse"><p>Readable card copy</p></div>
    "#;

    assert!(cramped_padding_ids(html, None).is_empty());
}

#[test]
fn unresolved_border_shorthand_component_is_not_a_visible_boundary() {
    let html = r#"
        <style>
          .reverse {
            border: 1px var(--missing-border-style) #111;
            padding: 0;
          }
        </style>
        <div class="reverse"><p>Readable card copy</p></div>
    "#;

    assert!(cramped_padding_ids(html, None).is_empty());
}

#[test]
fn uppercase_var_in_border_shorthand_is_not_a_visible_boundary() {
    let html = r#"
        <style>
          .reverse {
            border: 1px VAR(--missing-border-style) #111;
            padding: 0;
          }
        </style>
        <div class="reverse"><p>Readable card copy</p></div>
    "#;

    assert!(cramped_padding_ids(html, None).is_empty());
}

#[test]
fn uppercase_var_fallback_in_border_shorthand_still_reports_cramped_padding() {
    let html = r#"
        <style>
          .card {
            border: 1px #111 VAR(--missing-border-style, solid);
            padding: 0;
          }
        </style>
        <div class="card"><p>Readable card copy</p></div>
    "#;
    let lower = html.replace("VAR(", "var(");

    assert_eq!(cramped_padding_ids(html, None), cramped_padding_ids(&lower, None));
    assert!(!cramped_padding_ids(&lower, None).is_empty());
}

#[test]
fn unresolved_outline_style_is_not_a_visible_boundary() {
    let html = r#"
        <style>
          .reverse {
            outline-width: 1px;
            outline-color: #111;
            outline-style: var(--missing-outline-style);
            padding: 0;
          }
        </style>
        <div class="reverse"><p>Readable card copy</p></div>
    "#;

    assert!(cramped_padding_ids(html, None).is_empty());
}

fn finding_ids(html: &str) -> Vec<String> {
    detect_html_source(
        html,
        Path::new("/nonexistent/samples/image-card.html"),
        &DetectHtmlOptions::default(),
    )
    .into_iter()
    .map(|finding| finding.antipattern)
    .collect()
}

#[test]
fn unresolved_font_size_is_not_replaced_by_the_inherited_size() {
    let html = r#"<!doctype html>
        <html>
        <head>
        <style>
          body { font-size: 20px; }
          .tight { font-size: var(--missing-size); letter-spacing: -1.75px; }
          .wide { font-size: var(--missing-size); letter-spacing: 1.2px; }
          .leading { font-size: var(--missing-size); line-height: 1.5; }
          .inherits { font-size: var(--missing-size); }
          .inherits h2 { letter-spacing: -1.75px; }
          .shrunk { font-size: 10px; }
          .shrunk p { font-size: var(--missing-size); }
          .big { font-size: 80px; }
          .big h1 { font-size: var(--missing-size); }
        </style>
        </head>
        <body>
        <div class="big"><h1>A huge headline with plenty of characters in it for sure</h1></div>
        <h2 class="tight">A closing statement long enough to count</h2>
        <div class="inherits"><h2>An inherited size long enough to count</h2></div>
        <div class="shrunk"><p>Body copy that is comfortably longer than twenty characters.</p><p>Short copy</p></div>
        <p class="wide">Body copy that is comfortably longer than twenty characters.</p>
        <p class="leading">Body copy that is comfortably longer than fifty characters, so the leading rule has enough text to consider.</p>
        </body>
        </html>
    "#;

    let ids = finding_ids(html);
    for rule in [
        "extreme-negative-tracking",
        "wide-tracking",
        "tight-leading",
        "tiny-text",
        "undersized-ui-text",
        "oversized-h1",
    ] {
        assert!(!ids.iter().any(|id| id == rule), "{rule} in {ids:?}");
    }
}

#[test]
fn unresolved_font_size_keeps_zero_padding_cramped() {
    let html = r#"
        <style>
          * { margin: 0; }
          .card { font-size: var(--missing-size); background: #f5f5f5; padding: 0; }
          .em { font-size: var(--missing-size); background: #f5f5f5; padding: 0.1em; }
        </style>
        <div class="card"><p>Readable card copy</p></div>
        <div class="em"><p>Readable card copy</p></div>
    "#;

    assert_eq!(cramped_padding_ids(html, None).len(), 1);
}

#[test]
fn resolved_font_size_var_still_reports_crushed_tracking() {
    let html = r#"
        <style>
          :root { --size: 20px; }
          .tight { font-size: var(--size); letter-spacing: -1.75px; }
        </style>
        <h2 class="tight">A closing statement long enough to count</h2>
    "#;

    assert!(finding_ids(html)
        .iter()
        .any(|id| id == "extreme-negative-tracking"));
}
