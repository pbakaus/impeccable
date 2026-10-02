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
