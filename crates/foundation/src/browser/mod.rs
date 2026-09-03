//! The shared half of the in-page rule set: the DOM probe trait every engine
//! implements ([`dom::Dom`]), the snapshot implementation and its selector
//! engine, the test fake, and the plain-data types the browser checks take
//! in and hand back. The checks themselves live in `impeccable-core`.
//!
//! - `dom`: the [`dom::Dom`] trait, `ElId`, `Rect`, shared helpers.
//! - `snapshot`: [`snapshot::SnapshotDom`], the trait over a serialized page
//!   (the extension's CSP-proof path); `selector`: the Chrome-flavored
//!   selector engine it matches with.
//! - `fake_dom`: a table-driven fake for unit tests (test builds only).
//! - `visual`: the plain-data plans and rects of the visual-contrast
//!   subsystem.

pub mod dom;
#[cfg(any(test, feature = "fake-dom"))]
pub mod fake_dom;

pub mod selector;
pub mod snapshot;
pub mod visual;

use serde::{Deserialize, Serialize};

pub use dom::{Dom, ElId, Rect};

/// The `{ type, detail, severity?, ignoreValue? }` shape the overlay loop
/// carries (`checkElement*DOM(el).map(f => ({ type: f.id, detail: f.snippet }))`).
/// Field order matches the JS object literal so serialized JSON is byte-equal.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BrowserFinding {
    #[serde(rename = "type")]
    pub type_: String,
    pub detail: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub severity: Option<String>,
    #[serde(
        default,
        rename = "ignoreValue",
        skip_serializing_if = "Option::is_none"
    )]
    pub ignore_value: Option<String>,
}

impl BrowserFinding {
    pub fn new(type_: impl Into<String>, detail: impl Into<String>) -> Self {
        BrowserFinding {
            type_: type_.into(),
            detail: detail.into(),
            severity: None,
            ignore_value: None,
        }
    }
    /// `{ type: f.id, detail: f.snippet }` from a Section 3 hit.
    pub fn from_hit(hit: &crate::rules::types::RuleHit) -> Self {
        BrowserFinding::new(hit.id.clone(), hit.snippet.clone())
    }
    /// `{ type: f.id, detail: f.snippet }` from a measures Finding.
    pub fn from_measure(f: &crate::css::measures::Finding) -> Self {
        BrowserFinding::new(f.id.clone(), f.snippet.clone())
    }
}

/// A finding attributed to an element (`{ el, type, detail }` from the
/// page-level checks that name their own target). `el == None` means "the
/// check attributes to document.body" (JS `f.el || document.body`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ElFinding {
    pub el: Option<ElId>,
    pub finding: BrowserFinding,
}

/// One entry of the driver's group map: `{ el, findings }` in insertion order.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FindingGroup {
    pub el: ElId,
    pub findings: Vec<BrowserFinding>,
}

/// What the bundle passes into `collectBrowserFindings`: extension mode and
/// the relevant slice of `window.__IMPECCABLE_CONFIG__`.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserConfig {
    #[serde(default)]
    pub extension_mode: bool,
    /// `window.__IMPECCABLE_CONFIG__?.disabledRules || []` (only honored in
    /// extension mode, exactly as the JS reads it).
    #[serde(default)]
    pub disabled_rules: Vec<String>,
    /// `window.__IMPECCABLE_CONFIG__?.skipScan === true` (only honored in
    /// extension mode): the page is waived wholesale by detector.ignoreFiles,
    /// so every scan stage answers empty.
    #[serde(default)]
    pub skip_scan: bool,
    /// `window.__IMPECCABLE_CONFIG__?.designSystem`, raw.
    #[serde(default)]
    pub design_system: Option<serde_json::Value>,
    /// `window.__IMPECCABLE_CONFIG__?.lineLengthMax` (any JSON value; the JS
    /// applies `|| 80`).
    #[serde(default)]
    pub line_length_max: Option<serde_json::Value>,
}

impl BrowserConfig {
    /// JS `(window.__IMPECCABLE_CONFIG__?.lineLengthMax) || 80`.
    pub fn line_max(&self) -> f64 {
        match &self.line_length_max {
            Some(serde_json::Value::Number(n)) => {
                let v = n.as_f64().unwrap_or(f64::NAN);
                if crate::js_ext_a::num_truthy(v) {
                    v
                } else {
                    80.0
                }
            }
            Some(serde_json::Value::String(s)) if !s.is_empty() => {
                // JS keeps the string; `textLen > lineMax` then compares
                // number-to-string. Coerce like `>` would.
                let v = crate::js::string_to_number(s);
                if v.is_nan() {
                    f64::NAN
                } else {
                    v
                }
            }
            _ => 80.0,
        }
    }
}

/// JS: checks.mjs#measureHiddenTextDOM() result.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HiddenTextMeasure {
    #[serde(with = "crate::js::json_number")]
    pub total_chars: f64,
    #[serde(with = "crate::js::json_number")]
    pub hidden_chars: f64,
    pub hidden_samples: Vec<String>,
}

/// The result of `collectBrowserFindings()`: the group map in insertion
/// order and the page-level list (banner content).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectResult {
    pub groups: Vec<FindingGroup>,
    pub page_level: Vec<BrowserFinding>,
}
