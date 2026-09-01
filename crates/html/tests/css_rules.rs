//! `collectStaticCssRules` and `unwrapCssAtLayer` have no recorded call
//! vectors, so their expected output was produced by running the JS
//! (`css-cascade.mjs` + css-tree 3.2.1) in Node over a corpus of synthetic
//! stylesheets (nested @media / @supports / @layer, :hover shapes, comma
//! selectors, !important, custom properties, malformed CSS, comments,
//! @import / @font-face / @keyframes, unicode, escapes) plus every `<style>`
//! block and .css file under the public repo's tests/, skill/ and cli/.
//! Regenerate `fixtures/css-rules.json` with
//! `node crates/html/tests/fixtures/gen-css-rules.mjs`.

use impeccable_html::cascade::rules::{collect_static_css_rules, CssRule};
use impeccable_html::cascade::values::unwrap_css_at_layer;
use serde_json::Value;

fn rules_to_json(rules: &[CssRule]) -> Value {
    Value::Array(
        rules
            .iter()
            .map(|r| {
                serde_json::json!({
                    "selector": r.selector,
                    "declarations": r.declarations.iter().map(|d| serde_json::json!({
                        "prop": d.prop, "value": d.value, "important": d.important,
                    })).collect::<Vec<_>>(),
                    "specificity": r.specificity,
                    "order": r.order,
                    "isHover": r.is_hover,
                    "matchSelector": r.match_selector,
                })
            })
            .collect(),
    )
}

#[test]
fn collect_static_css_rules_matches_node() {
    let text = include_str!("fixtures/css-rules.json");
    let cases: Vec<Value> = serde_json::from_str(text).unwrap();
    let mut failures: Vec<String> = Vec::new();
    let mut checked = 0usize;
    for case in &cases {
        let css = case["css"].as_str().unwrap();
        let name = case["name"].as_str().unwrap();
        let expected = &case["rules"];
        let actual = rules_to_json(&collect_static_css_rules(css));
        checked += 1;
        if &actual != expected {
            // Find the first differing rule for a readable report.
            let ea = expected.as_array().unwrap();
            let aa = actual.as_array().unwrap();
            let mut detail = format!("expected {} rules, got {}", ea.len(), aa.len());
            for (i, (e, a)) in ea.iter().zip(aa.iter()).enumerate() {
                if e != a {
                    detail = format!("rule {}:\n    expected {}\n    actual   {}", i, e, a);
                    break;
                }
            }
            failures.push(format!("[{}] css={:?}\n  {}", name, css, detail));
        }
        let unwrapped = unwrap_css_at_layer(css);
        if Some(unwrapped.as_str()) != case["unwrapped"].as_str() {
            failures.push(format!(
                "[{}] unwrapCssAtLayer mismatch for css={:?}",
                name, css
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "{} of {} cases differ:\n{}",
        failures.len(),
        checked,
        failures.join("\n")
    );
}
