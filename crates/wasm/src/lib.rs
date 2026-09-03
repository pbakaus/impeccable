//! impeccable-wasm: the in-page rule core. wasm-bindgen exports over
//! `impeccable_core::browser` (rules driven through the JS DOM probe) and
//! over the pure `impeccable_core` functions (JSON in / JSON out).

pub mod dom_source;
#[cfg(feature = "detect")]
pub mod exports_detect;
pub mod exports_driver;
#[cfg(feature = "pure-exports")]
pub mod exports_pure;
pub mod exports_visual;
pub mod js_dom;

use dom_source::with_dom;
use impeccable_core::browser::driver;
use impeccable_core::browser::BrowserConfig;
use impeccable_core::rule_pack::RulePack;
use std::sync::OnceLock;
use wasm_bindgen::prelude::*;

static RULE_PACK: OnceLock<&'static dyn RulePack> = OnceLock::new();

/// Install a rule pack: registers its rows in the registry and hands its
/// hooks to every export below. Rust-only, on purpose — a pack is a compiled
/// dependency, not something JS passes in — so the caller is a downstream
/// crate that links this one as an rlib and calls this before its own exports
/// run. Later calls are ignored, the first pack wins.
///
/// The static HTML engine's half of a pack goes through
/// [`exports_detect::set_static_rule_pack`] (feature `detect`).
pub fn set_rule_pack(pack: &'static dyn RulePack) {
    impeccable_core::rule_pack::install(pack);
    let _ = RULE_PACK.set(pack);
}

/// The installed pack, if any.
pub fn installed_rule_pack() -> Option<&'static dyn RulePack> {
    RULE_PACK.get().copied()
}

/// `collectBrowserFindings()`: `config_json` is `{ extensionMode,
/// disabledRules, designSystem, lineLengthMax }`; returns
/// `{ groups: [{ el, findings }], pageLevel: [...] }`.
#[wasm_bindgen]
pub fn collect_browser_findings(config_json: &str) -> String {
    let mut config: BrowserConfig = serde_json::from_str(config_json).unwrap_or_default();
    config.rule_pack = installed_rule_pack();
    let out = with_dom(|dom| driver::collect_browser_findings(dom, &config));
    serde_json::to_string(&out).unwrap_or_else(|_| "{\"groups\":[],\"pageLevel\":[]}".into())
}

/// `scopedIgnoreActive(el, ruleId)`.
#[wasm_bindgen]
pub fn scoped_ignore_active(el: u32, rule_id: &str) -> bool {
    with_dom(|dom| driver::scoped_ignore_active(dom, el, rule_id))
}

/// The rule registry as JSON: `[{ id, name, category, severity, advisory, description }]`.
/// Built-ins in registry order, then any installed rule pack's rows.
#[wasm_bindgen]
pub fn antipatterns_json() -> String {
    let rows: Vec<serde_json::Value> = impeccable_core::registry::all_antipatterns()
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
