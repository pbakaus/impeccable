//! The per-element browser adapters. Only `is_rendered_for_browser_rule` has
//! an open caller; the rest run inside `driver::collect_browser_findings`.

use crate::ffi;
use impeccable_foundation::boundary::fn_id;
use impeccable_foundation::browser::dom::{Dom, ElId};

/// JS: index.mjs#isRenderedForBrowserRule
pub fn is_rendered_for_browser_rule(dom: &dyn Dom, el: ElId) -> bool {
    ffi::call_dom(fn_id::ELEMENT_IS_RENDERED_FOR_BROWSER_RULE, dom, &el)
}
