//! Port of `cli/engine/rules/checks.mjs`, split by concern so parallel work
//! does not collide. Each module holds the rule half of its concern: the
//! `check_*` and `scan_*` functions and the heuristics behind them. The
//! shared half (the plain-data inputs and outputs, the CSS and text
//! utilities, the selector and tag lists) lives in `impeccable_foundation`
//! and is re-exported at the top of each module, so `checks::rules::RuleHit`,
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
//! - `decorative_text`: the shapes of text with no reading job (avatar
//!   initials, version stamps, signatures, mockup text) that report
//!   `low-contrast` as advisory. The adapters gather the facts.
//! - `text_rules`: the kicker / numbered-label / em-dash / repeated-text
//!   gates: isKickerCandidate, isNumberedSectionLabelCandidate,
//!   checkNumberedSectionLabels, checkEmDashOveruse, isRepeatedTextContainer.
//!   Open (selector and tag lists, thresholds, the two text parsers):
//!   `impeccable_foundation::rules::text`.
//! - `text_context`: the contexts in which a typography finding reports as
//!   advisory (framed HTML demos, legal fine print, micro-labels), decided
//!   once over the `ContextNode` both engines implement.
//! - `embedded_content`: how both engines read the controls and captions in
//!   a box that frames embedded content for nested-cards (r4-p17).
//!
//! Element/document adapters (`checkElement*`, `*DOM`, `*FromDoc`) are NOT in
//! core: the static ones live in the `html` crate against its DOM model, the
//! browser ones live in `crate::browser` against the probe trait.
//!
//! `vectors_a` (rules, css_scan, html_patterns) and `vectors_b` (measures,
//! text_rules) hold this crate's vector-replay dispatch arms for
//! `crate::vectors`; foundation's own arms are dispatched by
//! `impeccable_foundation::vectors`.

pub mod css_scan;
pub mod decorative_text;
pub mod embedded_content;
pub mod gradient_geometry;
pub mod html_patterns;
pub mod measures;
pub mod rules;
pub mod text_context;
pub mod text_rules;

#[cfg(feature = "vectors")]
pub mod vectors_a;
#[cfg(feature = "vectors")]
pub mod vectors_b;

pub mod hard_offset_shadow;
