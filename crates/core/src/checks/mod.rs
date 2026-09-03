//! Port of `cli/engine/rules/checks.mjs`, split by concern so parallel work
//! does not collide. Each module holds the closed part of its concern: the
//! `check_*` and `scan_*` functions and the heuristics behind them. The open
//! part (the plain-data inputs and outputs, the CSS and text utilities, the
//! selector and tag lists) lives in `impeccable_foundation` and is
//! re-exported at the top of each module, so `checks::rules::RuleHit`,
//! `checks::measures::StyleMap` and friends keep resolving here.
//!
//! - `rules`: Section 3 pure element checks (checkBorders, checkColors,
//!   checkHoverContrast, checkIconTile, checkItalicSerif, checkHeroEyebrow,
//!   checkKickerAboveHeading, checkMotion, checkGlow) and their heuristics
//!   (isCardLikeFromProps, resolveSerif, isAccentColor,
//!   resolveHeroHeadingSizePx). Open: `impeccable_foundation::rules::types`.
//! - `css_scan`: CSS-text scanners (cssTextHasDarkRootBg,
//!   scanCssTextForGlow/GridBackground/RadialHalo/PseudoStripe/InsetStripe/
//!   Marquee/PulsingDot/OrganicClipPath/BuriedRaster, isRoundDotRadius).
//!   Open: `impeccable_foundation::css::scan`.
//! - `html_patterns`: scanHtmlForShapeAssembledIllustration,
//!   buildHtmlPatternCorpora, checkHtmlPatterns. Open (the corpora type):
//!   `impeccable_foundation::rules::html_patterns`.
//! - `measures`: the Section 4-6 gates that take plain data:
//!   checkRadialSpotlight, checkOversizedH1, checkGptThinBorderWideShadow,
//!   checkContentHiddenAtRest, isCreamColor, creamFromClassList,
//!   positionedStyleImpliesEscape, isOpaqueDecoratedBox. Open (value parsing,
//!   lengths, alphas, shadows, the style traits and the input structs):
//!   `impeccable_foundation::css::measures`.
//! - `text_rules`: the kicker / numbered-label / em-dash / repeated-text
//!   gates: isKickerCandidate, isNumberedSectionLabelCandidate,
//!   checkNumberedSectionLabels, checkEmDashOveruse, isRepeatedTextContainer.
//!   Open (selector and tag lists, thresholds, the two text parsers):
//!   `impeccable_foundation::rules::text`.
//!
//! Element/document adapters (`checkElement*`, `*DOM`, `*FromDoc`) are NOT in
//! core: the static ones live in the `html` crate against its DOM model, the
//! browser ones live in `crate::browser` against the probe trait.
//!
//! `vectors_a` (rules, css_scan, html_patterns) and `vectors_b` (measures,
//! text_rules) hold the vector-replay dispatch arms for the closed functions
//! of `crate::vectors`; the open arms are dispatched by
//! `impeccable_foundation::vectors`.

pub mod css_scan;
pub mod html_patterns;
pub mod measures;
pub mod rules;
pub mod text_rules;

#[cfg(feature = "vectors")]
pub mod vectors_a;
#[cfg(feature = "vectors")]
pub mod vectors_b;
