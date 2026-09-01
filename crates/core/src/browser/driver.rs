//! The in-page driver: the element loop, the page-level passes and the JSON
//! serialization of a run's findings. All closed; `CollectResult` is open.

use crate::ffi;
use impeccable_foundation::boundary::{fn_id, JsonBlob};
use impeccable_foundation::browser::dom::{Dom, ElId};
use impeccable_foundation::browser::{BrowserConfig, FindingGroup};

pub use impeccable_foundation::browser::CollectResult;

/// JS: index.mjs#scopedIgnoreActive
pub fn scoped_ignore_active(dom: &dyn Dom, el: ElId, rule_id: &str) -> bool {
    ffi::call_dom(fn_id::DRIVER_SCOPED_IGNORE_ACTIVE, dom, &(el, rule_id))
}

/// JS: index.mjs#serializeFindings
pub fn serialize_findings(dom: &dyn Dom, groups: &[FindingGroup]) -> serde_json::Value {
    let out: JsonBlob = ffi::call_dom(fn_id::DRIVER_SERIALIZE_FINDINGS, dom, &groups);
    out.parse()
}

/// JS: index.mjs#collectBrowserFindings
pub fn collect_browser_findings(dom: &dyn Dom, config: &BrowserConfig) -> CollectResult {
    // `BrowserConfig` carries raw `serde_json::Value` fields, so it crosses as
    // JSON text rather than postcard (see `boundary::JsonBlob`).
    ffi::call_dom(
        fn_id::DRIVER_COLLECT_BROWSER_FINDINGS,
        dom,
        &JsonBlob::of(config),
    )
}
