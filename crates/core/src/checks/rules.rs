//! Section 3 element checks. Open: the `*Opts` inputs, `RuleHit`, `Sides`,
//! the heading-tag and emoji helpers (`impeccable_foundation::rules::types`).
//! Closed: the checks themselves and the accent / serif / card heuristics.

use crate::ffi;
use impeccable_foundation::boundary::fn_id;

pub use impeccable_foundation::rules::types::*;

/// JS: checks.mjs#checkBorders
pub fn check_borders(
    tag: &str,
    widths: &Sides<f64>,
    colors: &Sides<Option<&str>>,
    radius: f64,
    opts: &BorderOpts,
) -> Vec<RuleHit> {
    ffi::call(
        fn_id::RULES_CHECK_BORDERS,
        &(tag, widths, colors, radius, opts),
    )
}

/// JS: checks.mjs#checkColors
pub fn check_colors(opts: &ColorOpts) -> Vec<RuleHit> {
    ffi::call(fn_id::RULES_CHECK_COLORS, opts)
}

/// JS: checks.mjs#checkHoverContrast
pub fn check_hover_contrast(opts: &HoverContrastOpts) -> Vec<RuleHit> {
    ffi::call(fn_id::RULES_CHECK_HOVER_CONTRAST, opts)
}

/// JS: checks.mjs#isCardLikeFromProps
pub fn is_card_like_from_props(
    has_shadow: bool,
    has_border: bool,
    has_radius: bool,
    has_bg: bool,
) -> bool {
    ffi::call(
        fn_id::RULES_IS_CARD_LIKE_FROM_PROPS,
        &(has_shadow, has_border, has_radius, has_bg),
    )
}

/// JS: checks.mjs#checkIconTile
pub fn check_icon_tile(opts: &IconTileOpts) -> Vec<RuleHit> {
    ffi::call(fn_id::RULES_CHECK_ICON_TILE, opts)
}

/// JS: checks.mjs#resolveSerif
pub fn resolve_serif(font_family: Option<&str>) -> SerifResolution {
    ffi::call(fn_id::RULES_RESOLVE_SERIF, &font_family)
}

/// JS: checks.mjs#checkItalicSerif
pub fn check_italic_serif(opts: &ItalicSerifOpts) -> Vec<RuleHit> {
    ffi::call(fn_id::RULES_CHECK_ITALIC_SERIF, opts)
}

/// JS: checks.mjs#isAccentColor
pub fn is_accent_color(css_color: &str) -> bool {
    ffi::call(fn_id::RULES_IS_ACCENT_COLOR, &css_color)
}

/// JS: checks.mjs#resolveHeroHeadingSizePx
pub fn resolve_hero_heading_size_px(value: Option<&str>) -> f64 {
    ffi::call(fn_id::RULES_RESOLVE_HERO_HEADING_SIZE_PX, &value)
}

/// JS: checks.mjs#checkHeroEyebrow
pub fn check_hero_eyebrow(opts: &HeroEyebrowOpts) -> Vec<RuleHit> {
    ffi::call(fn_id::RULES_CHECK_HERO_EYEBROW, opts)
}

/// JS: checks.mjs#checkKickerAboveHeading
pub fn check_kicker_above_heading(candidates: &[KickerCandidate]) -> Vec<RuleHit> {
    ffi::call(fn_id::RULES_CHECK_KICKER_ABOVE_HEADING, candidates)
}

/// JS: checks.mjs#checkMotion
pub fn check_motion(opts: &MotionOpts) -> Vec<RuleHit> {
    ffi::call(fn_id::RULES_CHECK_MOTION, opts)
}

/// JS: checks.mjs#checkGlow
pub fn check_glow(opts: &GlowOpts) -> Vec<RuleHit> {
    ffi::call(fn_id::RULES_CHECK_GLOW, opts)
}
