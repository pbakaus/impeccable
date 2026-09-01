//! Section 6 browser page-level checks. Only `measure_hidden_text_dom` has an
//! open caller; the rest run inside `driver::collect_browser_findings`.

use crate::ffi;
use impeccable_foundation::boundary::fn_id;
use impeccable_foundation::browser::dom::Dom;

pub use impeccable_foundation::browser::HiddenTextMeasure;

/// JS: checks.mjs#measureHiddenTextDOM
pub fn measure_hidden_text_dom(dom: &dyn Dom) -> HiddenTextMeasure {
    ffi::call_dom(fn_id::PAGE_MEASURE_HIDDEN_TEXT_DOM, dom, &())
}
