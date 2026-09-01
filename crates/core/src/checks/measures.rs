//! The Section 4-6 gates that take plain data. Open: value parsing, lengths,
//! alphas, shadows, the `StyleMap` / `CustomProps` traits and the input
//! structs (`impeccable_foundation::css::measures`). Closed: the gates and the
//! cream / opaque-box / positioned-escape heuristics.

use crate::ffi;
use impeccable_foundation::boundary::fn_id;
use impeccable_foundation::color::Rgba;

pub use impeccable_foundation::css::measures::*;

/// JS: checks.mjs#checkRadialSpotlight
pub fn check_radial_spotlight(input: &RadialSpotlightInput) -> Vec<Finding> {
    ffi::call(fn_id::MEASURES_CHECK_RADIAL_SPOTLIGHT, input)
}

/// JS: checks.mjs#isCreamColor
pub fn is_cream_color(rgb: Option<&Rgba>) -> bool {
    ffi::call(fn_id::MEASURES_IS_CREAM_COLOR, &rgb)
}

/// JS: checks.mjs#creamFromClassList
pub fn cream_from_class_list(cls: Option<&str>) -> Option<String> {
    ffi::call(fn_id::MEASURES_CREAM_FROM_CLASS_LIST, &cls)
}

/// JS: checks.mjs#checkOversizedH1
pub fn check_oversized_h1(input: &OversizedH1Input) -> Vec<Finding> {
    ffi::call(fn_id::MEASURES_CHECK_OVERSIZED_H1, input)
}

/// JS: checks.mjs#checkGptThinBorderWideShadow
pub fn check_gpt_thin_border_wide_shadow(input: &GptBorderShadowInput) -> Vec<Finding> {
    ffi::call(fn_id::MEASURES_CHECK_GPT_THIN_BORDER_WIDE_SHADOW, input)
}

/// JS: checks.mjs#positionedStyleImpliesEscape
pub fn positioned_style_implies_escape(style: &dyn StyleMap) -> bool {
    ffi::call_style(
        fn_id::MEASURES_POSITIONED_STYLE_IMPLIES_ESCAPE,
        Some(style),
        &(),
    )
}

/// JS: checks.mjs#checkContentHiddenAtRest
pub fn check_content_hidden_at_rest(input: &ContentHiddenInput) -> Vec<Finding> {
    ffi::call(fn_id::MEASURES_CHECK_CONTENT_HIDDEN_AT_REST, input)
}

/// JS: checks.mjs#isOpaqueDecoratedBox
pub fn is_opaque_decorated_box(cs: Option<&dyn StyleMap>) -> bool {
    ffi::call_style(
        fn_id::MEASURES_IS_OPAQUE_DECORATED_BOX,
        cs,
        &cs.is_some(),
    )
}
