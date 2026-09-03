//! The in-page (browser) rule set, ported from the DOM adapters of
//! `cli/engine/rules/checks.mjs` (Sections 4-6, the `*DOM` functions) and
//! the driver in `cli/engine/browser/injected/index.mjs`. Everything here is
//! rule logic written against the [`dom::Dom`] probe trait; the JavaScript
//! left in the bundle only implements that trait, marshals JSON, and draws
//! the overlay UI.
//!
//! The probe trait itself, its snapshot implementation, the selector engine,
//! the test fake and the plain-data types live in
//! `impeccable_foundation::browser`; they are re-exported here under the
//! paths callers already use.
//!
//! Module map (one JS region each, so parallel work does not collide):
//!
//! - `dom`: the [`dom::Dom`] trait, `ElId`, `Rect`, shared helpers.
//! - `snapshot`: [`snapshot::SnapshotDom`], the trait over a serialized page
//!   (the extension's CSP-proof path), plus the one-shot findings run that
//!   drives the checks below; `selector`: the Chrome-flavored selector
//!   engine it matches with.
//! - `fake_dom`: a table-driven fake for unit tests (test builds only).
//! - `background`: Section 4 in browser mode — `readOwnBackgroundColor`,
//!   `readCascadeBackgroundColor`, `resolveBackgroundInfo`,
//!   `resolveBackground`, `resolveGradientStops`, `compositeGradientStops`.
//! - `element_checks`: the per-element adapters of Section 5 —
//!   `isTabContextElement`, `isStatusContextElement`, `checkElementBordersDOM`,
//!   `checkElementPseudoStripeDOM`, `readPseudoSurfaceDOM`,
//!   `checkElementColorsDOM`, `checkElementIconTileDOM`,
//!   `checkElementItalicSerifDOM`, `domAccentDashPseudo`,
//!   `checkElementHeroEyebrowDOM`, `checkElementMotionDOM`,
//!   `checkElementGlowDOM`, `checkElementAIPaletteDOM`,
//!   `elementGradientValue`, `spotlightLabel`, `checkElementRadialSpotlightDOM`,
//!   `checkElementOversizedH1DOM`, `checkElementGptBorderShadowDOM`,
//!   `classSelector`, `positionedChild*`, `clippingContainerIsIntentionalViewport`,
//!   `elementRect`, `positionedChildEscapesClip`, `checkClippedOverflow`,
//!   `checkElementClippedOverflowDOM`, `isRenderedForBrowserRule`,
//!   `checkElementTextOverflowDOM`, `keyframesToggleVisibilityDOM`,
//!   `checkElementBlinkingCursorDOM`, `effectiveOpacityDOM`.
//! - `quality`: `checkQuality` (browser branches included),
//!   `checkElementQualityDOM`, `hasVisibleBackgroundBoundary`,
//!   `hasMeaningfulDirectText`, `textDescendantsFlushSides`,
//!   `isVisuallyHidden`, `isNonRenderedText`, `checkPageQualityFromDoc`,
//!   `checkPageQualityDOM`.
//! - `page_checks`: Section 6 browser page-level checks — `checkTypography`,
//!   `isCardLikeDOM`, `checkLayout`, `checkHeadingRhythmDOM`,
//!   `checkCreamPalette` (browser path), `measureHiddenTextDOM`,
//!   `checkEdgeFlushCardsDOM`, `isOpaqueDecoratedBox` (in core measures),
//!   `isLayeredElement`, `elementDirectText`, `isPaintedForOcclusion`,
//!   `checkTextOcclusionDOM`, `checkFirstViewportColumnOverflowDOM`.
//! - `text_collectors`: `cleanInlineText`, `isKickerCardContext`,
//!   `kickerHeadingLevel`, `collectKickerCandidates`,
//!   `checkKickerAboveHeadingDOM`, `collectNumberedSectionLabelCandidates`,
//!   `checkNumberedSectionLabelsDOM`, `checkEmDashOveruseDOM`,
//!   `collectRepeatedContainerTextFindings`, `checkRepeatedContainerTextDOM`.
//! - `driver`: index.mjs — `scopedIgnoreActive`, `collectBrowserFindings`
//!   (element loop, page-level passes, html-pattern scoping, pulsing-dot
//!   promotion), the design-system checks, `serializeFindings`,
//!   `generateSelector`/`buildSelectorSegment`/`isLikelyHashedClass`,
//!   `isElementHidden`, `addVisualContrastResult`'s decision.
//! - `visual`: the visual-contrast subsystem's decisions —
//!   `collectVisualContrastReasons`, `collectVisualContrastCandidates`,
//!   `blendRgba`, `pickWorstContrastColor`, `textSamplePoints`,
//!   `parsePositionToken/Pair`, `resolvePaintedImageRect`,
//!   `resolveObjectImageRect`, `pointToImageSource`, `firstCssUrl`,
//!   `getLayerValue`, the candidate-analysis finalization. Its plain-data
//!   plans and rects are shared. The async pixel sampling (Image loading,
//!   canvas draws) stays JS and feeds these.
//!
//! Porting rules are the crate's usual ones (see docs/PORTING-GUIDE.md):
//! JS number/string semantics through `crate::js`, field order preserved,
//! bugs ported, `// JS-PARITY:` where it looks odd. Every function carries a
//! `/// JS: <file>#<name>` doc comment.

pub use impeccable_foundation::browser::dom;
pub use impeccable_foundation::browser::selector;

#[cfg(any(test, feature = "fake-dom"))]
pub use impeccable_foundation::browser::fake_dom;

pub mod background;
pub mod driver;
pub mod element_checks;
pub mod page_checks;
pub mod quality;
pub mod snapshot;
pub mod text_collectors;
pub mod visual;

pub use dom::{Dom, ElId, Rect};
pub use impeccable_foundation::browser::{BrowserConfig, BrowserFinding, ElFinding, FindingGroup};
