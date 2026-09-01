//! The kicker / numbered-label / em-dash / repeated-text gates. Open: the
//! selector and tag lists, the thresholds, the two text parsers and the input
//! structs (`impeccable_foundation::rules::text`). Closed: the gates and the
//! heuristic regexes behind them.

use crate::ffi;
use impeccable_foundation::boundary::fn_id;
use impeccable_foundation::css::measures::{Finding, StyleMap};

pub use impeccable_foundation::rules::text::*;

/// JS: checks.mjs#isKickerCandidate
pub fn is_kicker_candidate(o: &KickerCandidateInput) -> bool {
    ffi::call(fn_id::TEXT_IS_KICKER_CANDIDATE, o)
}

/// JS: checks.mjs#isNumberedSectionLabelCandidate
pub fn is_numbered_section_label_candidate(o: &NumberedLabelCandidateInput) -> bool {
    ffi::call(fn_id::TEXT_IS_NUMBERED_SECTION_LABEL_CANDIDATE, o)
}

/// JS: checks.mjs#checkNumberedSectionLabels
pub fn check_numbered_section_labels(
    candidates: &[NumberedLabelCandidate],
    min_count: Option<f64>,
) -> Vec<Finding> {
    ffi::call(
        fn_id::TEXT_CHECK_NUMBERED_SECTION_LABELS,
        &(candidates, min_count),
    )
}

/// JS: checks.mjs#checkEmDashOveruse
pub fn check_em_dash_overuse(text: Option<&str>) -> Vec<Finding> {
    ffi::call(fn_id::TEXT_CHECK_EM_DASH_OVERUSE, &text)
}

/// JS: checks.mjs#isRepeatedTextContainer
pub fn is_repeated_text_container(style: Option<&dyn StyleMap>) -> bool {
    ffi::call_style(
        fn_id::TEXT_IS_REPEATED_TEXT_CONTAINER,
        style,
        &style.is_some(),
    )
}
