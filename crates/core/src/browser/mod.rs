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
//! - `painted`: whether an element is painted at capture (visibility,
//!   effective opacity, clipping ancestors, document bounds), the gate the
//!   driver applies to the text and raster rules of the element pass.
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
//! - `hidden_mockup`: product mockups the page declares are not content
//!   (`inert` or `aria-hidden="true"` on a drawn window, behind gates), and
//!   boxes labelled as a screenshot; the driver drops or demotes the rules
//!   that score a mockup's text and boxes as content.
//! - `text_layers`: what the hit-test stacks over a run of text say about the
//!   surface the contrast walk resolved (covered at capture, paint the walk
//!   never read, or consistent), over the occlusion grid's points.
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
pub mod decorative_text;
pub mod driver;
pub mod hidden_mockup;
pub mod element_checks;
pub mod field_label;
pub mod line_breaks;
pub mod page_checks;
pub mod painted;
pub mod quality;
pub mod snapshot;
pub mod text_collectors;
pub mod text_context;
pub mod text_geometry;
pub mod text_layers;
pub mod visual;

pub use dom::{Dom, ElId, Rect};
pub use impeccable_foundation::browser::{
    BrowserConfig, BrowserFinding, DisabledValue, ElFinding, FindingGroup,
};
