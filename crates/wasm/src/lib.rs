//! impeccable-wasm: the in-page rule core. wasm-bindgen exports over
//! `impeccable_core::browser` (rules driven through the JS DOM probe) and
//! over the pure `impeccable_core` functions (JSON in / JSON out).

pub mod dom_source;
pub mod exports_driver;
#[cfg(feature = "pure-exports")]
pub mod exports_pure;
pub mod exports_visual;
pub mod js_dom;

use impeccable_core::browser::driver;
use impeccable_core::browser::BrowserConfig;
use dom_source::with_dom;
use wasm_bindgen::prelude::*;

/// `collectBrowserFindings()`: `config_json` is `{ extensionMode,
/// disabledRules, designSystem, lineLengthMax }`; returns
/// `{ groups: [{ el, findings }], pageLevel: [...] }`.
#[wasm_bindgen]
pub fn collect_browser_findings(config_json: &str) -> String {
    let config: BrowserConfig = serde_json::from_str(config_json).unwrap_or_default();
    let out = with_dom(|dom| driver::collect_browser_findings(dom, &config));
    serde_json::to_string(&out).unwrap_or_else(|_| "{\"groups\":[],\"pageLevel\":[]}".into())
}

/// `scopedIgnoreActive(el, ruleId)`.
#[wasm_bindgen]
pub fn scoped_ignore_active(el: u32, rule_id: &str) -> bool {
    with_dom(|dom| driver::scoped_ignore_active(dom, el, rule_id))
}

/// The rule registry as JSON: `[{ id, name, category, severity, advisory, description }]`.
#[wasm_bindgen]
pub fn antipatterns_json() -> String {
    let rows: Vec<serde_json::Value> = impeccable_core::registry::ANTIPATTERNS
        .iter()
        .map(|ap| {
            serde_json::json!({
                "id": ap.id,
                "name": ap.name,
                "category": ap.category,
                "severity": ap.severity,
                "advisory": ap.advisory,
                "description": ap.description,
            })
        })
        .collect();
    serde_json::to_string(&rows).unwrap_or_else(|_| "[]".into())
}
