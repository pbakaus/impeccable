//! `collectStaticCssRules` and `unwrapCssAtLayer` have no recorded call
//! vectors, so their expected output was produced by running the JS
//! (`css-cascade.mjs` + css-tree 3.2.1) in Node over a corpus of synthetic
//! stylesheets (nested @media / @supports / @layer, :hover shapes, comma
//! selectors, !important, custom properties, malformed CSS, comments,
//! @import / @font-face / @keyframes, unicode, escapes) plus every `<style>`
//! block and .css file under the public repo's tests/, skill/ and cli/.
//! Regenerate `fixtures/css-rules.json` with
//! `node crates/html/tests/fixtures/gen-css-rules.mjs`, then restore the
//! hand-edited signed-number cases (see `cascade::rules`, "Signed numbers
//! keep their space").

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

/// A number after another number or a function keeps its space, so a box
/// shorthand splits into the values the author wrote. css-tree alone writes
/// `0 0 0 -24px` as `0 0 0-24px`, `10% 0` as `10%0` and `var(--x) 0` as
/// `var(--x)0`.
#[test]
fn signed_values_in_shorthands_keep_their_space() {
    let rules = collect_static_css_rules(
        ".a{margin:-8px}\
         .b{margin:0 -8px}\
         .c{margin:0 -8px 4px}\
         .d{margin:0 -8px 0 0}\
         .e{margin:0 0 0 -24px}\
         .f{inset:0 -1px}\
         .g{margin:0 +8px 0 -0.5em}\
         .h{margin:0 calc(-1 * 8px) 0 -2%}\
         .i{margin:0 var(--pull) 0 -8px}\
         .j{--pull:0 -8px; margin:var(--pull, 0 -4px)}\
         .k{padding:8px 16px 4px 2px}\
         .l{box-shadow:0 -2px 0 4px}\
         .m{margin:0 var(--x) +2px calc(1px) 0}\
         .n{margin:10% 0 0 -24px}",
    );
    let got: Vec<(String, String, String)> = rules
        .iter()
        .flat_map(|r| {
            r.declarations
                .iter()
                .map(|d| (r.selector.clone(), d.prop.clone(), d.value.clone()))
        })
        .collect();
    let s = |a: &str, b: &str, c: &str| (a.to_string(), b.to_string(), c.to_string());
    assert_eq!(
        got,
        vec![
            s(".a", "margin", "-8px"),
            s(".b", "margin", "0 -8px"),
            s(".c", "margin", "0 -8px 4px"),
            s(".d", "margin", "0 -8px 0 0"),
            s(".e", "margin", "0 0 0 -24px"),
            s(".f", "inset", "0 -1px"),
            s(".g", "margin", "0 +8px 0 -0.5em"),
            s(".h", "margin", "0 calc(-1*8px) 0 -2%"),
            s(".i", "margin", "0 var(--pull) 0 -8px"),
            s(".j", "--pull", "0 -8px"),
            s(".j", "margin", "var(--pull, 0 -4px)"),
            s(".k", "padding", "8px 16px 4px 2px"),
            s(".l", "box-shadow", "0 -2px 0 4px"),
            s(".m", "margin", "0 var(--x) +2px calc(1px) 0"),
            s(".n", "margin", "10% 0 0 -24px"),
        ]
    );
}
