//! Component-level opt-outs in the static engine: one `{ rule, selector }`
//! entry stands in for the same `data-impeccable-ignore` attribute repeated
//! on every instance of a component, and the waived findings come back
//! stamped so a caller can count them.

use impeccable_core::findings::{ignored_by, Finding};
use impeccable_core::selector_ignores::SelectorIgnore;
use impeccable_html::{detect_html_source, DetectHtmlOptions};
use std::path::Path;

/// Three instances of one 10px mono label, the shape that earned eleven
/// attributes on impeccable-site #34.
const PAGE: &str = r#"<!doctype html>
<html><head><style>
.ks-tag { font-family: ui-monospace, monospace; font-size: 10px; }
.free-label { font-size: 10px; }
body { font-family: system-ui; font-size: 16px; }
</style></head>
<body>
<h1>Worlds</h1>
<p>Body copy long enough to read like a real paragraph on a real page somewhere.</p>
<span class="ks-tag">01 - Explore directions</span>
<span class="ks-tag">02 - See one built</span>
<span class="ks-tag">03 - Third label</span>
<span class="free-label">04 - Not part of the component</span>
</body></html>
"#;

fn scan(html: &str, entries: &[SelectorIgnore]) -> Vec<Finding> {
    let opts = DetectHtmlOptions {
        ignore_selectors: entries,
        ..DetectHtmlOptions::default()
    };
    detect_html_source(html, Path::new("/nonexistent/dir/page.html"), &opts)
}

fn undersized(findings: &[Finding]) -> Vec<&Finding> {
    findings
        .iter()
        .filter(|f| f.antipattern == "undersized-ui-text")
        .collect()
}

#[test]
fn one_entry_covers_every_instance_of_the_component() {
    let before = scan(PAGE, &[]);
    let hits = undersized(&before);
    assert_eq!(hits.len(), 4, "fixture should flag all four labels");
    assert!(hits.iter().all(|f| ignored_by(f).is_none()));

    let after = scan(
        PAGE,
        &[SelectorIgnore::new("undersized-ui-text", ".ks-tag")],
    );
    let hits = undersized(&after);
    assert_eq!(hits.len(), 4, "waived findings are stamped, not dropped");
    let waived: Vec<&&Finding> = hits
        .iter()
        .filter(|f| ignored_by(f) == Some(".ks-tag"))
        .collect();
    assert_eq!(waived.len(), 3, "the three component instances are waived");
    // The label outside the component is untouched, and so is every other rule.
    let free: Vec<&&Finding> = hits.iter().filter(|f| ignored_by(f).is_none()).collect();
    assert_eq!(free.len(), 1);
    assert!(free[0].snippet.contains("Not part of the component"));
    assert!(after
        .iter()
        .filter(|f| f.antipattern != "undersized-ui-text")
        .all(|f| ignored_by(f).is_none()));
}

#[test]
fn an_entry_for_another_rule_waives_nothing() {
    let after = scan(PAGE, &[SelectorIgnore::new("side-tab", ".ks-tag")]);
    assert!(undersized(&after).iter().all(|f| ignored_by(f).is_none()));
}

#[test]
fn a_star_entry_waives_every_rule_on_the_component() {
    let after = scan(PAGE, &[SelectorIgnore::new("*", ".ks-tag")]);
    let waived = undersized(&after)
        .iter()
        .filter(|f| ignored_by(f).is_some())
        .count();
    assert_eq!(waived, 3);
}

#[test]
fn the_entry_covers_the_components_subtree() {
    let html = r#"<!doctype html><html><head><style>
.ks-tag { font-size: 10px; }
</style></head><body><h1>Title</h1>
<p>Body copy long enough to read like a real paragraph on a real page somewhere.</p>
<span class="ks-tag">outer <b>inner label text</b></span>
</body></html>"#;
    let after = scan(html, &[SelectorIgnore::new("undersized-ui-text", ".ks-tag")]);
    assert!(
        undersized(&after)
            .iter()
            .all(|f| ignored_by(f) == Some(".ks-tag")),
        "a finding on a descendant is waived with its component"
    );
}

#[test]
fn the_per_instance_attribute_still_works() {
    let html = PAGE.replace(
        r#"<span class="ks-tag">01"#,
        r#"<span class="ks-tag" data-impeccable-ignore="undersized-ui-text">01"#,
    );
    // Attribute-waived findings never reach the caller at all, which is the
    // behavior that shipped; the config entry is the countable alternative.
    let after = scan(&html, &[]);
    assert_eq!(undersized(&after).len(), 3);
}
