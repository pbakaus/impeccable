//! wasm exports over `impeccable_core::browser::driver` (see
//! docs/WASM-BUNDLE.md for the contract).

use crate::dom_source::with_dom;
use impeccable_core::browser::driver;
use impeccable_core::browser::{BrowserFinding, FindingGroup};
use wasm_bindgen::prelude::*;

/// `serializeFindings(allFindings)`: `groups_json` is `[{ el, findings }]`.
#[wasm_bindgen]
pub fn serialize_findings(groups_json: &str) -> String {
    let groups: Vec<FindingGroup> = serde_json::from_str(groups_json).unwrap_or_default();
    with_dom(|dom| driver::serialize_findings(dom, &groups)).to_string()
}

/// `addVisualContrastResult` step 1: the element the result attaches to
/// (0 when nothing should be added).
#[wasm_bindgen]
pub fn visual_contrast_result_el(result_json: &str) -> u32 {
    let result: serde_json::Value = serde_json::from_str(result_json).unwrap_or(serde_json::Value::Null);
    with_dom(|dom| driver::visual_contrast_result_el(dom, &result)).unwrap_or(0)
}

/// `addVisualContrastResult` step 2: the finding to append to `el`'s group,
/// or `null`.
#[wasm_bindgen]
pub fn visual_contrast_result_finding(el: u32, existing_json: &str, result_json: &str) -> String {
    let existing: Vec<BrowserFinding> = serde_json::from_str(existing_json).unwrap_or_default();
    let result: serde_json::Value = serde_json::from_str(result_json).unwrap_or(serde_json::Value::Null);
    match with_dom(|dom| driver::visual_contrast_result_finding(dom, el, &existing, &result)) {
        Some(f) => serde_json::to_string(&f).unwrap_or_else(|_| "null".into()),
        None => "null".into(),
    }
}

/// `measureHiddenTextDOM()`.
#[wasm_bindgen]
pub fn measure_hidden_text() -> String {
    let m = with_dom(|dom| impeccable_core::browser::page_checks::measure_hidden_text_dom(dom));
    serde_json::to_string(&m).unwrap_or_else(|_| "{\"totalChars\":0,\"hiddenChars\":0,\"hiddenSamples\":[]}".into())
}
