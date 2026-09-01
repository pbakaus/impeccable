//! The CSS-text scanners. Open: the custom-property and decl-block parsing,
//! the length helpers, the keyframe collection, the landmark ranges and the
//! `IndexedHit` / `PatternFinding` shapes
//! (`impeccable_foundation::css::scan`). Closed: the scanners.

use crate::ffi;
use impeccable_foundation::boundary::fn_id;

pub use impeccable_foundation::css::scan::*;

/// JS: checks.mjs#cssTextHasDarkRootBg
pub fn css_text_has_dark_root_bg(content: &str, custom_props: &CustomProps) -> bool {
    ffi::call(fn_id::CSS_TEXT_HAS_DARK_ROOT_BG, &(content, custom_props))
}

/// JS: checks.mjs#scanCssTextForGlow
pub fn scan_css_text_for_glow(content: &str) -> Vec<IndexedHit> {
    ffi::call(fn_id::CSS_SCAN_GLOW, &content)
}

/// JS: checks.mjs#scanCssTextForGridBackground
pub fn scan_css_text_for_grid_background(content: &str) -> Vec<IndexedHit> {
    ffi::call(fn_id::CSS_SCAN_GRID_BACKGROUND, &content)
}

/// JS: checks.mjs#scanCssTextForRadialHalo
pub fn scan_css_text_for_radial_halo(content: &str) -> Vec<IndexedHit> {
    ffi::call(fn_id::CSS_SCAN_RADIAL_HALO, &content)
}

/// JS: checks.mjs#scanCssTextForPseudoStripe
pub fn scan_css_text_for_pseudo_stripe(raw_content: &str) -> Vec<PatternFinding> {
    ffi::call(fn_id::CSS_SCAN_PSEUDO_STRIPE, &raw_content)
}

/// JS: checks.mjs#scanCssTextForInsetStripe
pub fn scan_css_text_for_inset_stripe(content: &str) -> Vec<PatternFinding> {
    ffi::call(fn_id::CSS_SCAN_INSET_STRIPE, &content)
}

/// JS: checks.mjs#scanCssTextForOrganicClipPath
pub fn scan_css_text_for_organic_clip_path(style_text: &str) -> Vec<PatternFinding> {
    ffi::call(fn_id::CSS_SCAN_ORGANIC_CLIP_PATH, &style_text)
}

/// JS: checks.mjs#scanCssTextForBuriedRaster
pub fn scan_css_text_for_buried_raster(style_text: &str) -> Vec<PatternFinding> {
    ffi::call(fn_id::CSS_SCAN_BURIED_RASTER, &style_text)
}

/// JS: checks.mjs#scanCssTextForMarquee
pub fn scan_css_text_for_marquee(content: &str, markup: Option<&str>) -> Vec<PatternFinding> {
    ffi::call(fn_id::CSS_SCAN_MARQUEE, &(content, markup))
}

/// JS: checks.mjs#isRoundDotRadius
pub fn is_round_dot_radius(radius_value: &str, w: f64, h: f64) -> bool {
    ffi::call(fn_id::CSS_IS_ROUND_DOT_RADIUS, &(radius_value, w, h))
}

/// JS: checks.mjs#scanCssTextForPulsingDot
pub fn scan_css_text_for_pulsing_dot(content: &str, markup: Option<&str>) -> Vec<PatternFinding> {
    ffi::call(fn_id::CSS_SCAN_PULSING_DOT, &(content, markup))
}
