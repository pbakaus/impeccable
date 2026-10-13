//! Whether an element is painted at capture time.
//!
//! The element pass measures text and images from their computed style and
//! their box. A box can carry a real measurement and still show nothing: a
//! mobile submenu held at zero width, the cells of a horizontal scroller past
//! its visible edge, an animated demo step that has not played, a poster at
//! opacity 0 over a playing video. A reader cannot see any of those at rest,
//! so a rule that scores what a reader sees has nothing to score.
//!
//! [`unpainted_at_capture`] is the one predicate every such rule shares, and
//! the driver applies it to the rules [`paint_gate`] names. It reads only what
//! the element pass already reads (style, rects, scroll metrics,
//! `checkVisibility`) and walks the ancestor chain once, so its cost is
//! bounded by the depth of the element, and the driver asks it only for
//! elements that produced a gated finding.
//!
//! Besides what hides a box, the predicate knows what hides the paint inside
//! one: fallback content of a media element, a face turned away under
//! `backface-visibility: hidden`, and for the Text gate text set under 1px.
//! A placeholder inked transparent is skipped where the placeholder is
//! scored, and a word part way through a scripted colour reveal where its
//! contrast is ([`colour_mid_reveal`]).
//!
//! What it cannot decide it keeps: a property or metric the capture did not
//! record (a snapshot older than the measurement) never removes a finding.
//!
//! Rules that name an element other than the one they report on, or that report
//! on the page, ask the predicate about it themselves: `clipped-overflow-container`
//! about the positioned child it names ([`unpainted_inside`], which leaves the
//! container's own clip to the rule) and about the container
//! ([`unpainted_text_box`]), `side-tab`'s border path about the card
//! ([`unpainted_text_box`]), `nested-cards` about the inner card,
//! `kicker-above-heading` about the heading and the label above it,
//! `text-occlusion` about the covered text, the text or box covering it and
//! the card a headline overhangs, and the page-level CSS-text forms in
//! [`PAINT_GATED_PAGE_FORMS`] about the elements their selector matches.
//!
//! `content-hidden-at-rest` is deliberately not gated: hidden text is what it
//! reports.

use super::dom::{class_attr, has_direct_text_longer_than, tag_lower, Dom, ElId, Rect};
use super::element_checks::effective_opacity_dom;
use super::text_geometry::phrasing_text_extent;
use super::BrowserFinding;
use crate::checks::measures::{clipped_by_inset, clipped_by_rect};
use crate::js;

/// Why an element is not painted at capture.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unpainted {
    /// `display: none` or `content-visibility: hidden` on an ancestor, or
    /// `visibility: hidden` / `checkVisibility()` false on the element.
    NotRendered,
    /// The element's effective opacity is at or near 0.
    Transparent,
    /// A near-transparent raster that is one state of a moving layer: a
    /// crossfade, a slideshow, a poster over a video, a lazy-load fade.
    StateLayer,
    /// An ancestor that clips its overflow has no area on a clipped axis, or
    /// does not overlap the element on it.
    ClippedOut,
    /// The box lies wholly outside the scrollable document (or, inside a
    /// fixed layer, wholly outside the viewport).
    OutsideDocument,
    /// The element or an ancestor is a visually hidden box: at most 1px on
    /// each axis, with a `clip: rect()` or `clip-path: inset()` that removes
    /// it (`.sr-only`, `.visually-hidden`, video.js control text).
    VisuallyHidden,
    /// A text measurement's element holds no text.
    NoText,
    /// The box has no width or no height, and none of its content shows past
    /// that edge.
    NoArea,
    /// A text measurement's text is set at a font size under 1px, and no
    /// descendant sets it larger: a Slick dot's `font-size: 0` label, a link
    /// laid over a card whose words only a screen reader reads.
    NoFontSize,
    /// The element is fallback content of a `<video>`, `<audio>`, `<canvas>`
    /// or `<iframe>` (the "your browser does not support video" line), which a
    /// browser that renders the element never paints.
    FallbackContent,
    /// The element or an ancestor is a face turned away from the viewer under
    /// `backface-visibility: hidden`: the back of a flip card at rest.
    TurnedAway,
    /// The element or an ancestor runs a one-shot animation that leaves it at
    /// opacity 0 and holds that frame ([`fades_out_for_good`]): the outgoing
    /// half of a swap, caught before it faded.
    FadesOut,
}

/// Which predicate a rule's findings pass through.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PaintGate {
    /// A text measurement: the element's own opacity counts, and it needs
    /// text and a box with area to show it in.
    Text,
    /// `buried-raster`, which measures the element's own opacity.
    Raster,
    /// A rule about the element's own box: its own opacity counts, and it
    /// needs area.
    Box,
    /// `blinking-cursor`, which reports the element toggling its own opacity
    /// or visibility: a cursor caught in its off phase is still the cursor,
    /// so only what its ancestors do hides it, and it needs area.
    Toggle,
}

/// How the element's own opacity takes part.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OwnOpacity {
    /// The element's own opacity decides whether it is seen (text rules).
    Counts,
    /// The rule measures the element's own opacity (`buried-raster`), so only
    /// ancestors count toward transparency, and a near-transparent element
    /// that is one state of a moving layer is skipped.
    Measured,
    /// The rule reports the element switching its own opacity or visibility
    /// on and off (`blinking-cursor`), so neither its own opacity nor a
    /// `visibility: hidden` that its parent does not share hides it.
    Toggled,
}

/// The rules that measure one element's text. Style tells about the page
/// (fonts, borders) describe authored CSS whatever state is showing and are
/// not gated; `italic-serif-display` reports one heading's display
/// treatment, which a visitor meets only where the heading is shown, and
/// `gradient-text` the ramp painted on one run of text, which a label inside
/// a closed menu (bt.cn's mobile dropdown, observations-28 row 20) or a
/// watermark nobody sees never shows. The border path of `side-tab` and the
/// container of `clipped-overflow-container` ask [`unpainted_text_box`]
/// themselves, since their rule ids also cover forms the gate does not apply
/// to.
pub const PAINT_GATED_TEXT_RULES: &[&str] = &[
    "all-caps-body",
    "body-text-viewport-edge",
    "cramped-padding",
    "extreme-negative-tracking",
    "gradient-text",
    "gray-on-color",
    "italic-serif-display",
    "justified-text",
    "line-length",
    "low-contrast",
    "text-overflow",
    "tight-leading",
    "tiny-text",
    "undersized-ui-text",
    "wide-tracking",
];

/// The opacity at or below which an element reads as not painted, the same
/// floor [`effective_opacity_dom`] collapses to zero.
const TRANSPARENT_FLOOR: f64 = 0.02;

/// The own-opacity ceiling of `buried-raster`'s opacity form.
const STATE_LAYER_OPACITY: f64 = 0.15;

/// The share of a text measurement's width that has to show inside its
/// clipping ancestors and the document for a text rule to score it. A date on
/// a Swiper slide parked at x -66 with 4 of its 70px on the page, or a slick
/// clone 79% past its track, is a copy nobody reads; the copies on screen are
/// the ones a reader meets. Only the x axis is floored: a line-clamped
/// standfirst or a collapsed "read more" box shows its first lines, and the
/// text rects of the lines it hides run past its bottom edge.
pub const TEXT_MIN_VISIBLE_SHARE: f64 = 0.25;

/// The rules about an element's own box. A box that shows nothing at rest (a
/// collapsed tray at height 0, the volume panel of a player whose control bar
/// is not rendered, a seek bar parked off the canvas, a loader at
/// `display: none`, a closed flyout, a row still waiting to be revealed, a
/// slide parked past its track's clip) is not where a visitor meets how it
/// animates (`bounce-easing`), the glow around it (`dark-glow`) or the
/// palette it paints (`ai-color-palette`).
pub const PAINT_GATED_BOX_RULES: &[&str] = &["ai-color-palette", "bounce-easing", "dark-glow", "hard-offset-shadow"];

/// The rules whose page-level CSS-text form names the rule a selector
/// declared: such a finding reports only when at least one element the
/// selector matches is painted at capture. The match is tested on the base
/// predicate alone, with no area test, because the selector may name a
/// pseudo-element (`.node::after`) whose host has no box of its own.
pub const PAINT_GATED_PAGE_FORMS: &[&str] = &["bounce-easing", "dark-glow", "gradient-text", "pulsing-dot", "repeating-stripes-gradient"];

/// Which gate a rule's findings pass through, or `None` for an ungated rule.
pub fn paint_gate(rule_id: &str) -> Option<PaintGate> {
    if rule_id == "buried-raster" {
        Some(PaintGate::Raster)
    } else if rule_id == "blinking-cursor" {
        Some(PaintGate::Toggle)
    } else if PAINT_GATED_TEXT_RULES.contains(&rule_id) {
        Some(PaintGate::Text)
    } else if PAINT_GATED_BOX_RULES.contains(&rule_id) {
        Some(PaintGate::Box)
    } else {
        None
    }
}

/// Whether a page-level CSS-text form of `rule_id` should report, given the
/// elements its selector matched. A rule outside [`PAINT_GATED_PAGE_FORMS`],
/// and a selector that matched nothing (which the caller decides on its
/// own), keep base behavior.
pub fn page_form_painted(dom: &dyn Dom, rule_id: &str, matches: &[ElId]) -> bool {
    !PAINT_GATED_PAGE_FORMS.contains(&rule_id)
        || matches.is_empty()
        || matches.iter().any(|&el| painted_at_capture(dom, el))
}

/// Drop the findings on `el` whose rule needs a painted element when `el` is
/// not painted. Each gate is evaluated at most once per element, and not at
/// all when no finding needs it.
pub fn retain_painted(dom: &dyn Dom, el: ElId, findings: &mut Vec<BrowserFinding>) {
    let mut painted: [Option<bool>; 4] = [None; 4];
    findings.retain(|f| match paint_gate(&f.type_) {
        None => true,
        Some(gate) => *painted[gate as usize].get_or_insert_with(|| unpainted_for(dom, el, gate).is_none()),
    });
}

/// Why `el` is not painted for a rule behind `gate`, or `None` when it is.
pub fn unpainted_for(dom: &dyn Dom, el: ElId, gate: PaintGate) -> Option<Unpainted> {
    match gate {
        PaintGate::Raster => unpainted_at_capture(dom, el, OwnOpacity::Measured),
        PaintGate::Box => unpainted_at_capture(dom, el, OwnOpacity::Counts).or_else(|| no_area(dom, el)),
        PaintGate::Toggle => unpainted_at_capture(dom, el, OwnOpacity::Toggled).or_else(|| no_area(dom, el)),
        PaintGate::Text => unpainted_walk(dom, el, OwnOpacity::Counts, None, &mut Visible::floored(TEXT_MIN_VISIBLE_SHARE))
            .or_else(|| no_text(dom, el))
            .or_else(|| no_font_size(dom, el))
            .or_else(|| no_area(dom, el)),
    }
}

/// Why the box of `el`, a container of text, is not painted for a rule about
/// that box (the border path of `side-tab`, the clip of
/// `clipped-overflow-container`), or `None` when it is: the Text gate's walk,
/// with its visible-share floor, and its area test, but not its test for
/// text, since a card that holds only an image, or whose words sit in a
/// descendant a later element carries, still shows its edge.
pub fn unpainted_text_box(dom: &dyn Dom, el: ElId) -> Option<Unpainted> {
    unpainted_walk(dom, el, OwnOpacity::Counts, None, &mut Visible::floored(TEXT_MIN_VISIBLE_SHARE))
        .or_else(|| no_area(dom, el))
}

/// Whether `el`'s text shows across its whole width at rest: no clipping
/// ancestor and no edge of the document cuts it on the x axis (within a
/// pixel). A Dom that cannot measure it answers yes. The page's one report of
/// a colour pair is claimed for good only by such a copy.
pub fn text_shown_across(dom: &dyn Dom, el: ElId) -> bool {
    let mut vis = Visible::tracking();
    unpainted_walk(dom, el, OwnOpacity::Counts, None, &mut vis).is_none() && vis.shown_across()
}

/// Whether a visitor sees `el` painted at rest, counting its own opacity.
pub fn painted_at_capture(dom: &dyn Dom, el: ElId) -> bool {
    unpainted_at_capture(dom, el, OwnOpacity::Counts).is_none()
}

/// Why `el` is not painted at capture, or `None` when it is (or when the Dom
/// cannot measure it, which keeps the finding).
pub fn unpainted_at_capture(dom: &dyn Dom, el: ElId, own: OwnOpacity) -> Option<Unpainted> {
    unpainted_walk(dom, el, own, None, &mut Visible::floored(0.0))
}

/// Why `el` is not painted at capture apart from the clipping of `container`
/// and of everything above it (the document's edges included), or `None` when
/// nothing else hides it. A rule that reports what `container`'s clip does to
/// `el` (`clipped-overflow-container`) asks this: that clip is the finding,
/// and what the ancestors above do to the container is the container's own
/// paint. Everything that hides the whole subtree (`display: none`,
/// transparency, a visually hidden box) still counts at every level, and so
/// does a fixed layer parked outside the viewport.
pub fn unpainted_inside(dom: &dyn Dom, el: ElId, container: ElId) -> Option<Unpainted> {
    unpainted_walk(dom, el, OwnOpacity::Counts, Some(container), &mut Visible::floored(0.0))
}

/// How much of a text measurement shows on the x axis, for the visible-share
/// floor: the extent it is taken of (the text where it can be measured, else
/// the box), and the part of it no clip has cut. Passing a horizontal
/// scroller replaces both with the scroller's box, since scrolling brings
/// anything in its range into it.
struct Visible {
    min_share: f64,
    /// Whether the shown part is tracked with no floor to apply.
    track: bool,
    measured: bool,
    extent: (f64, f64),
    shown: (f64, f64),
}

impl Visible {
    /// No floor at 0, which leaves every decision to the overlap tests.
    fn floored(min_share: f64) -> Visible {
        Visible { min_share, track: false, measured: false, extent: (0.0, 0.0), shown: (0.0, 0.0) }
    }

    /// No floor, but the shown part is tracked.
    fn tracking() -> Visible {
        Visible { track: true, ..Visible::floored(0.0) }
    }

    /// Only a floor or a tracked walk measures the text, so the base
    /// predicate costs what it did.
    fn measure(&mut self, dom: &dyn Dom, el: ElId, rect: &Rect) {
        if !(self.min_share > 0.0 || self.track) {
            return;
        }
        let text = phrasing_text_extent(dom, el).filter(|t| t.all_finite() && t.width > 0.0 && t.height > 0.0);
        let r = text.unwrap_or(*rect);
        self.measured = r.width > 0.0;
        self.extent = (r.left, r.right);
        self.shown = self.extent;
    }

    /// Cut the shown part to `[lo, hi]`; true when what is left falls under
    /// the floor. `floors` says whether this cut may count toward the floor
    /// (asked only on a floored walk): a cut that may not leaves the share
    /// as it was, so the walk decides as the base predicate did. A tracked
    /// walk records every cut.
    fn cut(&mut self, lo: f64, hi: f64, floors: impl FnOnce() -> bool) -> bool {
        if !self.measured {
            return false;
        }
        if self.min_share > 0.0 {
            if !floors() {
                return false;
            }
        } else if !self.track {
            return false;
        }
        self.shown = (js::math_max(self.shown.0, lo), js::math_min(self.shown.1, hi));
        self.under_floor()
    }

    fn scroll(&mut self, lo: f64, hi: f64) {
        if !self.measured {
            return;
        }
        self.extent = (lo, hi);
        self.shown = (lo, hi);
    }

    fn under_floor(&self) -> bool {
        let width = self.extent.1 - self.extent.0;
        self.min_share > 0.0
            && self.measured
            && width > 0.0
            && js::math_max(0.0, self.shown.1 - self.shown.0) / width < self.min_share
    }

    fn shown_across(&self) -> bool {
        !self.measured || (self.shown.0 <= self.extent.0 + 1.0 && self.shown.1 >= self.extent.1 - 1.0)
    }
}

fn unpainted_walk(
    dom: &dyn Dom,
    el: ElId,
    own: OwnOpacity,
    clip_root: Option<ElId>,
    vis: &mut Visible,
) -> Option<Unpainted> {
    if Some(el) == dom.body() || Some(el) == dom.document_element() {
        return None;
    }
    // An element caught in the off phase of its own toggle carries a
    // `visibility: hidden` its parent does not, and `checkVisibility()`, which
    // the capture asks with `checkVisibilityCSS`, answers false for it. For a
    // rule about the toggle neither hides it; the walk below still reads the
    // ancestors' `display` and `content-visibility`. A parent whose visibility
    // was not recorded cannot share it, so the element is kept.
    let toggled_off = own == OwnOpacity::Toggled
        && hides_by_visibility(dom, el)
        && !dom.parent(el).is_some_and(|p| hides_by_visibility(dom, p));
    if !toggled_off && dom.check_visibility(el) == Some(false) {
        return Some(Unpainted::NotRendered);
    }
    // `visibility` inherits, so the element's computed value covers its
    // ancestors; `display: none` and `content-visibility: hidden` do not, and
    // the walk below reads them.
    if (!toggled_off && hides_by_visibility(dom, el)) || dom.style(el, "display") == "none" {
        return Some(Unpainted::NotRendered);
    }
    if is_visually_hidden_box(dom, el) {
        return Some(Unpainted::VisuallyHidden);
    }
    if turned_away(dom, el) {
        return Some(Unpainted::TurnedAway);
    }

    match own {
        OwnOpacity::Toggled => {
            if let Some(p) = dom.parent(el) {
                if effective_opacity_dom(dom, p) <= TRANSPARENT_FLOOR {
                    return Some(Unpainted::Transparent);
                }
            }
        }
        OwnOpacity::Counts => {
            if effective_opacity_dom(dom, el) <= TRANSPARENT_FLOOR {
                return Some(Unpainted::Transparent);
            }
        }
        OwnOpacity::Measured => {
            if let Some(p) = dom.parent(el) {
                if effective_opacity_dom(dom, p) <= TRANSPARENT_FLOOR {
                    return Some(Unpainted::Transparent);
                }
            }
            let op = js::parse_float(&dom.style(el, "opacity"));
            if op.is_finite() && op < STATE_LAYER_OPACITY && is_state_layer(dom, el) {
                return Some(Unpainted::StateLayer);
            }
        }
    }
    // Only the element's own fade counts where its own opacity does; the
    // others ask its ancestors alone, as the opacity tests above do.
    if fades_out_in_chain(dom, el, own == OwnOpacity::Counts) {
        return Some(Unpainted::FadesOut);
    }

    let rect = dom.rect(el);
    if !rect.all_finite() {
        return None;
    }
    vis.measure(dom, el, &rect);
    let viewport_w = finite_or(dom.inner_width(), 0.0);
    let viewport_h = finite_or(dom.inner_height(), 0.0);

    let body = dom.body();
    let root = dom.document_element();
    let mut placement = Placement::of(dom, el);
    // The outermost fixed box on the containing chain, once one is found.
    let mut fixed_rect = if placement == Placement::Fixed { Some(rect) } else { None };
    // Whether an ancestor above the current fixed box left its containing
    // block undecided, so the box may not be a viewport layer at all.
    let mut fixed_undecided = false;
    // Where the element can be shown, as the next clipping ancestor sees it:
    // its own box until the walk passes a scroll container, whose box it
    // takes on the axis that scrolls. Scrolling brings anything in the
    // scroller's range into the scroller's box, so an ancestor above the
    // scroller hides the element only where it hides the scroller.
    let mut band = rect;
    // Whether the walk still tests overflow clips; it stops at `clip_root`.
    let mut clip_tests = true;
    let mut cur = dom.parent(el);
    while let Some(p) = cur {
        let display = dom.style(p, "display");
        if display == "none" || js::to_lower_case(&dom.style(p, "contentVisibility")) == "hidden" {
            return Some(Unpainted::NotRendered);
        }
        if FALLBACK_HOST_TAGS.contains(&tag_lower(dom, p).as_str()) {
            return Some(Unpainted::FallbackContent);
        }
        if turned_away(dom, p) {
            return Some(Unpainted::TurnedAway);
        }
        if Some(p) == clip_root {
            clip_tests = false;
        }
        let containment = if placement == Placement::InFlow {
            Containment::DoesNot
        } else {
            contains_fixed(dom, p)
        };
        if placement == Placement::Fixed && containment == Containment::Undecided {
            fixed_undecided = true;
        }
        if placement.clipped_by(dom, p, containment) {
            // A 1px box whose clip removes it shows none of its content, even
            // where that content overlaps the pixel it keeps.
            if is_visually_hidden_box(dom, p) {
                return Some(Unpainted::VisuallyHidden);
            }
            // The page's own overflow propagates to the viewport, whose
            // scrolling is what brings content into view; the document test
            // below covers what it can never reach.
            let is_page = Some(p) == body || Some(p) == root;
            if clip_tests && !is_page && clips_contents(&display) {
                match clip_outcome(dom, el, p, &band, vis, viewport_w, viewport_h) {
                    Ok(next) => band = next,
                    Err(reason) => return Some(reason),
                }
            }
            placement = Placement::of(dom, p);
            if placement == Placement::Fixed {
                fixed_rect = Some(dom.rect(p));
                fixed_undecided = false;
            }
        }
        cur = dom.parent(p);
    }

    if placement == Placement::Fixed {
        // A fixed layer no containing ancestor holds is viewport-relative and
        // never scrolled to: when the layer's own box lies outside the
        // viewport (a parked drawer), nothing in it is painted. Content that
        // runs past the edge of a layer on screen is left to the clip tests,
        // which is how a smooth-scroll viewport keeps its page. A layer that
        // an ancestor may contain is positioned against that ancestor, not
        // the viewport, and is kept.
        if fixed_undecided {
            return None;
        }
        if let Some(fr) = fixed_rect.filter(Rect::all_finite) {
            if viewport_w > 0.0 && viewport_h > 0.0 && misses(&fr, 0.0, viewport_w, 0.0, viewport_h) {
                return Some(Unpainted::OutsideDocument);
            }
        }
        // Nor can a page scroll sideways to what a viewport layer holds past
        // its left or right edge: a drawer parked at x 540 inside a fixed
        // header on a 390px phone. Only the x axis: a smooth-scroll layer
        // keeps its page below the fold and moves it into view.
        if viewport_w > 0.0 && misses_axis(band.left, band.right, band.width, 0.0, viewport_w) {
            return Some(Unpainted::OutsideDocument);
        }
        return None;
    }
    // The document's edges are the outermost clip, above any container.
    if clip_root.is_some() {
        return None;
    }
    outside_document(dom, &band, vis, viewport_w)
}

/// How an element's box is placed, which decides which ancestors clip it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Placement {
    InFlow,
    Absolute,
    Fixed,
}

impl Placement {
    fn of(dom: &dyn Dom, el: ElId) -> Placement {
        match dom.style(el, "position").as_str() {
            "absolute" => Placement::Absolute,
            "fixed" => Placement::Fixed,
            _ => Placement::InFlow,
        }
    }

    /// Whether `p`'s overflow can clip a box placed like this: an in-flow box
    /// is clipped by every ancestor, an absolute box only from its containing
    /// block (the nearest positioned or containing ancestor) up, a fixed box
    /// only from a containing ancestor up. An undecided ancestor is not taken
    /// as the containing block, which clips no more than the page does.
    fn clipped_by(self, dom: &dyn Dom, p: ElId, containment: Containment) -> bool {
        match self {
            Placement::InFlow => true,
            Placement::Absolute => is_positioned(dom, p) || containment == Containment::Contains,
            Placement::Fixed => containment == Containment::Contains,
        }
    }
}

/// `visibility: hidden` or `collapse`, computed (so inherited).
fn hides_by_visibility(dom: &dyn Dom, el: ElId) -> bool {
    matches!(js::to_lower_case(&dom.style(el, "visibility")).as_str(), "hidden" | "collapse")
}

fn is_positioned(dom: &dyn Dom, el: ElId) -> bool {
    let pos = dom.style(el, "position");
    !pos.is_empty() && pos != "static"
}

/// Whether an element is the containing block of its fixed descendants.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Containment {
    Contains,
    DoesNot,
    /// No recorded property makes it one, and at least one property that
    /// could was not recorded.
    Undecided,
}

/// The individual transform-like properties: any value but `none` makes the
/// element the containing block of its fixed and absolute descendants.
const CONTAINING_PROPS: &[&str] = &["transform", "translate", "scale", "rotate", "perspective", "filter", "backdropFilter"];

/// The `will-change` values that do the same ahead of the change.
const CONTAINING_WILL_CHANGE: &[&str] = &["transform", "translate", "scale", "rotate", "perspective", "filter", "backdrop-filter"];

/// `transform`, `translate`, `scale`, `rotate`, `perspective`, `filter` or
/// `backdrop-filter` other than `none`, a `will-change` that names one of
/// them, and paint or layout containment (`contain: paint | layout | strict |
/// content`). A size container (`container-type`) applies size and style
/// containment only and holds nothing. A computed value always has a keyword,
/// so an empty read is a property the capture did not record.
fn contains_fixed(dom: &dyn Dom, el: ElId) -> Containment {
    let mut undecided = false;
    for prop in CONTAINING_PROPS {
        let v = dom.style(el, prop);
        if v.is_empty() {
            undecided = true;
        } else if v != "none" {
            return Containment::Contains;
        }
    }
    let will_change = dom.style(el, "willChange");
    if will_change.is_empty() {
        undecided = true;
    } else if will_change
        .split(',')
        .map(js::trim)
        .any(|v| CONTAINING_WILL_CHANGE.contains(&v))
    {
        return Containment::Contains;
    }
    let contain = dom.style(el, "contain");
    if contain.is_empty() {
        undecided = true;
    } else if contain
        .split_ascii_whitespace()
        .any(|v| matches!(v, "paint" | "layout" | "strict" | "content"))
    {
        return Containment::Contains;
    }
    if undecided {
        Containment::Undecided
    } else {
        Containment::DoesNot
    }
}

/// Whether an overflow clip on `container` can cut `el`, a `position: fixed`
/// box inside it. A fixed box is clipped only from its containing block up,
/// so `container` or an element between the two has to be that block: an
/// overflow-hidden host that is not one (a card holding a floating player)
/// cannot cut it. An element whose containment the capture could not decide
/// counts as one, which keeps the finding.
pub fn fixed_box_clippable_by(dom: &dyn Dom, el: ElId, container: ElId) -> bool {
    let mut cur = dom.parent(el);
    while let Some(p) = cur {
        if contains_fixed(dom, p) != Containment::DoesNot {
            return true;
        }
        if p == container {
            return false;
        }
        cur = dom.parent(p);
    }
    true
}

/// A box at most 1px on each axis whose `clip: rect()` (on an absolutely
/// positioned box, the only kind `clip` applies to) or `clip-path: inset()`
/// removes it: the screen-reader-only utility. Its content is laid out, and
/// can overlap the pixel the box keeps, but none of it is seen. The rect is
/// read first, so the common case costs one read.
fn is_visually_hidden_box(dom: &dyn Dom, el: ElId) -> bool {
    let r = dom.rect(el);
    if !r.all_finite() || r.width > 1.0 || r.height > 1.0 {
        return false;
    }
    let clip_applies = matches!(dom.style(el, "position").as_str(), "absolute" | "fixed");
    (clip_applies && clipped_by_rect(Some(&dom.style(el, "clip"))))
        || clipped_by_inset(Some(&dom.style(el, "clipPath")))
        || clipped_by_inset(Some(&dom.style(el, "webkitClipPath")))
}

/// The elements a text rule scores that paint a value or a placeholder
/// rather than text content.
const TEXT_CONTROL_TAGS: &[&str] = &["input", "textarea", "select"];

/// A text measurement's element with no text: nothing but whitespace in it.
/// The direct text is asked first, which settles every element that carries
/// its own words without reading the subtree.
fn no_text(dom: &dyn Dom, el: ElId) -> Option<Unpainted> {
    let tag = tag_lower(dom, el);
    // The text inside a media element or a canvas is what a browser that
    // cannot render it shows instead; one that renders it paints the media.
    if FALLBACK_HOST_TAGS.contains(&tag.as_str()) {
        return Some(Unpainted::FallbackContent);
    }
    if has_direct_text_longer_than(dom, el, 0) || TEXT_CONTROL_TAGS.contains(&tag.as_str()) {
        return None;
    }
    js::trim(&dom.text_content(el)).is_empty().then_some(Unpainted::NoText)
}

/// The elements whose content is fallback: a browser that renders the
/// element paints the media, the canvas bitmap or the frame, never the
/// markup inside it. `<object>` is left out, since it shows its content when
/// the resource fails to load, which a capture does not record.
const FALLBACK_HOST_TAGS: &[&str] = &["audio", "canvas", "iframe", "video"];

/// A text measurement whose text is set under 1px: the element's computed
/// font size parses below 1px, and no descendant that carries text of its own
/// sets a size of 1px or more (the gap-collapsing `font-size: 0` on a row of
/// inline blocks, whose children set their own). A size that does not parse
/// keeps the finding. The subtree is read only once the element's own size
/// is under 1px.
fn no_font_size(dom: &dyn Dom, el: ElId) -> Option<Unpainted> {
    if !under_1px(&dom.style(el, "fontSize")) {
        return None;
    }
    let sized_text = dom.query_all(Some(el), "*").unwrap_or_default().into_iter().any(|d| {
        has_direct_text_longer_than(dom, d, 0) && !under_1px(&dom.style(d, "fontSize"))
    });
    (!sized_text).then_some(Unpainted::NoFontSize)
}

/// A computed `font-size` that parses to a size under 1px.
pub fn under_1px(font_size: &str) -> bool {
    let n = js::parse_float(font_size);
    n.is_finite() && n < 1.0
}

/// Whether `node` is a face turned away under `backface-visibility: hidden`:
/// its own `transform` is a 3D matrix that points its front away from the
/// viewer (a negative z scale, as `rotateY(180deg)` gives), and nothing above
/// it rotates in 3D, which could turn it back (a flip card's inner box on
/// hover). A property the capture did not record, an individual `rotate` or
/// `scale` on the face, or a 3D transform above it keeps the element. The
/// walk calls this for the element and each ancestor, so a face hides its
/// whole subtree; only a face found reads the chain above it.
fn turned_away(dom: &dyn Dom, node: ElId) -> bool {
    if dom.style(node, "backfaceVisibility") != "hidden" || !faces_away(&dom.style(node, "transform")) {
        return false;
    }
    let individual_none = |el: ElId, prop: &str| matches!(dom.style(el, prop).as_str(), "none" | "");
    if !(individual_none(node, "rotate") && individual_none(node, "scale")) {
        return false;
    }
    let mut up = dom.parent(node);
    while let Some(a) = up {
        if dom.style(a, "transform").starts_with("matrix3d(") || !individual_none(a, "rotate") {
            return false;
        }
        up = dom.parent(a);
    }
    true
}

/// Whether a computed `transform` is a 3D matrix whose z axis points away
/// from the viewer (`m33` below 0).
fn faces_away(transform: &str) -> bool {
    let Some(body) = transform.strip_prefix("matrix3d(").and_then(|b| b.strip_suffix(')')) else {
        return false;
    };
    let values: Vec<f64> = body.split(',').map(|v| js::parse_float(js::trim(v))).collect();
    values.len() == 16 && values.iter().all(|v| v.is_finite()) && values[10] < 0.0
}

/// A box with no width or no height shows nothing when its content cannot
/// show past that edge either: the element clips that axis, or its scroll
/// extent there is at most 1px (an inline box, which grows with its glyphs,
/// reports 0). Text that runs past a zero-width box with visible overflow
/// shows in its scroll extent and is kept, as is a metric the capture did not
/// record, and `display: contents`, which generates no box for its content to
/// sit in. The Text gate asks the same test: a 0x0 anchor whose nowrap label
/// overflows it (a map pin, a chart label) shows that label, and a 0x0 box
/// with nothing past its edges is flat on both axes.
fn no_area(dom: &dyn Dom, el: ElId) -> Option<Unpainted> {
    let r = dom.rect(el);
    if !r.all_finite() || (r.width > 0.0 && r.height > 0.0) || dom.style(el, "display") == "contents" {
        return None;
    }
    let (ox, oy) = overflow_axes(dom, el);
    let at_most_1px = |v: f64| v.is_finite() && v <= 1.0;
    let flat_x = r.width <= 0.0 && (clips(&ox) || at_most_1px(dom.scroll_width(el)));
    let flat_y = r.height <= 0.0 && (clips(&oy) || at_most_1px(dom.scroll_height(el)));
    (flat_x || flat_y).then_some(Unpainted::NoArea)
}

/// `overflow-x` / `overflow-y`, from the shorthand when neither was recorded.
fn overflow_axes(dom: &dyn Dom, el: ElId) -> (String, String) {
    let ox = dom.style(el, "overflowX");
    let oy = dom.style(el, "overflowY");
    if ox.is_empty() && oy.is_empty() {
        let o = dom.style(el, "overflow");
        (o.clone(), o)
    } else {
        (ox, oy)
    }
}

/// `overflow` does not apply to boxes that generate no block of their own.
fn clips_contents(display: &str) -> bool {
    !matches!(display, "contents" | "inline" | "table-row" | "table-row-group")
}

fn finite_or(v: f64, fallback: f64) -> f64 {
    if v.is_finite() {
        v
    } else {
        fallback
    }
}

/// Whether `rect` has no overlap with the band `[lo, hi]` on each axis.
fn misses(rect: &Rect, left: f64, right: f64, top: f64, bottom: f64) -> bool {
    misses_axis(rect.left, rect.right, rect.width, left, right)
        || misses_axis(rect.top, rect.bottom, rect.height, top, bottom)
}

/// A box with extent overlaps when at least 1px of it lies inside the band; a
/// box with none overlaps when its edge lies inside it.
fn misses_axis(start: f64, end: f64, extent: f64, lo: f64, hi: f64) -> bool {
    if extent > 0.0 {
        js::math_min(end, hi) - js::math_max(start, lo) < 1.0
    } else {
        start < lo || start > hi
    }
}

fn clips(value: &str) -> bool {
    matches!(value, "hidden" | "clip" | "auto" | "scroll")
}

fn scrolls(value: &str) -> bool {
    matches!(value, "auto" | "scroll")
}

/// Whether a scroll container has content to scroll to. A metric the capture
/// did not record answers yes.
fn has_overflow(scroll: f64, client: f64) -> bool {
    !(scroll.is_finite() && client.is_finite()) || scroll > client + 1.0
}

/// The clip test for one ancestor `p` that clips the element, over `band`,
/// where the element can be shown as `p` sees it. `Err` names why `p` hides
/// the element; `Ok` carries the band for the ancestors above `p`.
fn clip_outcome(
    dom: &dyn Dom,
    el: ElId,
    p: ElId,
    band: &Rect,
    vis: &mut Visible,
    viewport_w: f64,
    viewport_h: f64,
) -> Result<Rect, Unpainted> {
    let (ox, oy) = overflow_axes(dom, p);
    let clip_x = clips(&ox);
    let clip_y = clips(&oy);
    if !clip_x && !clip_y {
        return Ok(*band);
    }
    let cr = dom.rect(p);
    if !cr.all_finite() {
        return Ok(*band);
    }
    // A clipping box with no area on a clipped axis shows nothing: a submenu
    // held at zero width, a panel at `max-height: 0`.
    if (clip_x && cr.width < 1.0) || (clip_y && cr.height < 1.0) {
        return Err(Unpainted::ClippedOut);
    }
    // Horizontally, every clipping or scrolling box hides what lies past its
    // edge at rest: carousel tracks, the columns of a scrolled table.
    if clip_x && misses_axis(band.left, band.right, band.width, cr.left, cr.right) {
        return Err(Unpainted::ClippedOut);
    }
    // A text measurement has to show enough of its width inside the box to be
    // read. A box that truncates its line with an ellipsis shows the start of
    // it, which is what a reader reads.
    if clip_x
        && dom.style(p, "textOverflow") != "ellipsis"
        && vis.cut(cr.left, cr.right, || parks_copies(dom, el, p, &cr, viewport_w))
    {
        return Err(Unpainted::ClippedOut);
    }
    // Vertically only a box that hides its overflow does. A vertical scroll
    // container is how an app shell scrolls its page, and a full-viewport
    // fixed layer that hides overflow is how a smooth-scroll library does; the
    // content below their fold is reached by the ordinary scroll.
    let hides_y = matches!(oy.as_str(), "hidden" | "clip");
    let script_frame = hides_y && is_script_scroll_frame(dom, p, &cr, viewport_h);
    if hides_y
        && !is_viewport_layer(dom, p, &cr, viewport_w, viewport_h)
        && misses_axis(band.top, band.bottom, band.height, cr.top, cr.bottom)
        && !(script_frame && band.bottom > cr.bottom)
    {
        return Err(Unpainted::ClippedOut);
    }
    let (mut left, mut width) = (band.left, band.width);
    let (mut top, mut height) = (band.top, band.height);
    if scrolls(&ox) && has_overflow(dom.scroll_width(p), dom.client_width(p)) {
        left = cr.left;
        width = cr.width;
        vis.scroll(cr.left, cr.right);
    }
    if script_frame || (scrolls(&oy) && has_overflow(dom.scroll_height(p), dom.client_height(p))) {
        top = cr.top;
        height = cr.height;
    }
    Ok(Rect::from_xywh(left, top, width, height))
}

/// Whether a box that hides its vertical overflow may be scrolled by script:
/// it is at least as tall as the fold (the viewport, or the root's layout
/// height when that is shorter) and its content runs past its bottom (or the
/// capture did not record whether it does). smooth-scrollbar and Locomotive
/// Scroll wrap the page in such a box, not always a fixed one, and move the
/// content with transforms; a capture cannot tell that from content held
/// clipped, so what lies below the box's bottom edge is kept. Smaller clips
/// (carousels, accordions, collapsed menus) and the x axis are not affected.
fn is_script_scroll_frame(dom: &dyn Dom, p: ElId, cr: &Rect, viewport_h: f64) -> bool {
    let root_h = dom
        .document_element()
        .map(|root| dom.client_height(root))
        .filter(|h| h.is_finite() && *h > 0.0);
    let fold = match root_h {
        Some(h) if viewport_h > 0.0 => js::math_min(h, viewport_h),
        Some(h) => h,
        None => viewport_h,
    };
    fold > 0.0
        && cr.height >= fold - 1.0
        && has_overflow(dom.scroll_height(p), dom.client_height(p))
        && !capped_by_max_height(dom, p, cr, js::math_max(fold, viewport_h))
}

/// Whether a box stands at its `max-height`: a "read more" panel held at
/// 1000px over a spec table, a collapsed description. A scroll library sizes
/// its frame with `height` (the viewport's, or a fixed layer's), so a box
/// its `max-height` stops is a collapsed panel whose clip is what a visitor
/// sees. A frame capped at the viewport's height (`height: 100vh; max-height:
/// 100vh`) is still the viewport's frame, so the cap has to stand taller than
/// the viewport. A value that is not a length (`none`, or none recorded)
/// caps nothing.
fn capped_by_max_height(dom: &dyn Dom, p: ElId, cr: &Rect, viewport_h: f64) -> bool {
    let value = dom.style(p, "maxHeight");
    let Some(px) = value.strip_suffix("px").map(js::parse_float) else {
        return false;
    };
    px.is_finite() && px > viewport_h + 1.0 && (cr.height - px).abs() <= 1.0
}

fn is_viewport_layer(dom: &dyn Dom, p: ElId, cr: &Rect, viewport_w: f64, viewport_h: f64) -> bool {
    dom.style(p, "position") == "fixed"
        && viewport_w > 0.0
        && viewport_h > 0.0
        && cr.left <= 1.0
        && cr.top <= 1.0
        && cr.right >= viewport_w - 1.0
        && cr.bottom >= viewport_h - 1.0
}

/// Whether the box lies wholly where the document cannot be scrolled to:
/// before its start, past its scroll width, or below its scroll height.
fn outside_document(dom: &dyn Dom, rect: &Rect, vis: &mut Visible, viewport_w: f64) -> Option<Unpainted> {
    let sx = finite_or(dom.scroll_x(), 0.0);
    let sy = finite_or(dom.scroll_y(), 0.0);
    let left = rect.left + sx;
    let right = rect.right + sx;
    if rect.height > 0.0 && rect.bottom + sy <= 0.0 {
        return Some(Unpainted::OutsideDocument);
    }
    let root = dom.document_element()?;
    // Below the end of the page's scroll range. A page whose body is the
    // scroller (the root held at the viewport's height) scrolls as far as
    // the body does, so the taller of the two is the range. Without a
    // measured height, nothing is known below the fold.
    let doc_h = [Some(root), dom.body()]
        .into_iter()
        .flatten()
        .map(|e| finite_or(dom.scroll_height(e), 0.0))
        .fold(0.0, f64::max);
    if doc_h > 0.0 && rect.height > 0.0 && rect.top + sy >= doc_h {
        return Some(Unpainted::OutsideDocument);
    }
    let doc_w = finite_or(dom.scroll_width(root), 0.0);
    let rtl = js::to_lower_case(&dom.style(root, "direction")) == "rtl";
    // Scrollable x range: `[0, doc_w]` left to right, `[vw - doc_w, vw]` right
    // to left. Without a measured width, only the side the scroll origin sits
    // on is known.
    let (start, end) = if doc_w > 0.0 {
        if rtl {
            (viewport_w - doc_w, viewport_w)
        } else {
            (0.0, doc_w)
        }
    } else if rtl {
        (f64::NEG_INFINITY, viewport_w)
    } else {
        (0.0, f64::INFINITY)
    };
    if rect.width > 0.0 && (right <= start || left >= end) {
        return Some(Unpainted::OutsideDocument);
    }
    // A text measurement needs enough of its width on the page's scroll
    // origin side: a copy parked before the start of the document (a slide at
    // x -66 with 4px on the page) can never be scrolled to. Text cut at the
    // page's far edge runs past a page that hides its overflow, the page
    // shell cutting a line a visitor reads, and keeps reporting as it did.
    let (origin_lo, origin_hi) = if rtl { (f64::NEG_INFINITY, end - sx) } else { (start - sx, f64::INFINITY) };
    if vis.cut(origin_lo, origin_hi, || true) {
        return Some(Unpainted::OutsideDocument);
    }
    vis.cut(start - sx, end - sx, || false);
    None
}

/// Whether a clip that cuts a text measurement on the x axis is one that
/// parks copies, where the visible-share floor applies: a box narrower than
/// the page (a carousel, a swatch or badge row), a box that scrolls on x with
/// content to scroll to, or a box around a track a script moves with
/// transforms. A box at least as wide as the viewport that only hides its
/// overflow is the page shell, and text it cuts is a layout bug a visitor
/// sees (a non-wrapping row's second column, a desktop column at a phone
/// width), so it keeps base behaviour. With no measured viewport the width
/// test proves nothing.
fn parks_copies(dom: &dyn Dom, el: ElId, p: ElId, cr: &Rect, viewport_w: f64) -> bool {
    let page_w = page_width(dom, viewport_w);
    (page_w > 0.0 && cr.width < page_w - 1.0)
        || super::text_geometry::scrolls_x(dom, p)
        || super::text_geometry::moves_a_track(dom, el, p)
}

/// The width of the page a visitor sees: the viewport, or the root's client
/// width when a classic scrollbar makes that narrower. 0 when neither was
/// measured.
fn page_width(dom: &dyn Dom, viewport_w: f64) -> f64 {
    let client = dom.document_element().map(|root| dom.client_width(root)).filter(|w| w.is_finite() && *w > 0.0);
    match client {
        Some(w) if viewport_w > 0.0 => js::math_min(w, viewport_w),
        Some(w) => w,
        None => viewport_w,
    }
}

/// Whether a near-transparent raster is one state of a moving layer rather
/// than an image held buried. An animation whose keyframes move opacity (or
/// cannot be read) is enough. A declared opacity transition is not: utility
/// CSS puts `opacity` in the default transition list of every element that
/// animates anything, so the transition counts only with a second marker of
/// a layer between states: an animation, a lazy-load marker on the raster or
/// its parent, or a crossfade stack (a video around it, or a sibling video or
/// raster layer over most of its box).
///
/// Even then the transition counts only while the raster is at rest at 0 (an
/// effective opacity at or below the transparent floor). A fade in or a
/// crossfade starts from 0; an image held buried sits at a faint value other
/// than 0, and Next.js images are lazy by default while Tailwind's transition
/// utilities are everywhere, so the markers alone would silence it.
///
/// A transition in progress leaves no trace in a capture, so a crossfade
/// driven by script over layers that are not siblings, or a lazy fade marked
/// only in script state, is still reported; an image genuinely held buried
/// at 0 that also carries `loading="lazy"` or sits over a sibling image is
/// skipped.
///
/// Two more readings need no declared marker. An animation or transition the
/// capture saw running on the raster and moving its `opacity` is a fade in
/// progress ([`opacity_in_motion`]). And an `<img>` at rest at 0 whose class
/// list the page is seen swapping on other images is waiting for the same
/// swap ([`awaits_class_reveal`]).
fn is_state_layer(dom: &dyn Dom, el: ElId) -> bool {
    if declares_opacity_animation(dom, el)
        || lazy_raster_pending(dom, el)
        || opacity_in_motion(dom, el)
        || awaits_class_reveal(dom, el)
    {
        return true;
    }
    // The poster a video plays over needs no transition: the player hides
    // it the moment the video has a frame, and the video is what shows.
    if effective_opacity_dom(dom, el) <= TRANSPARENT_FLOOR && poster_under_video(dom, el) {
        return true;
    }
    if !declares_opacity_transition(dom, el) || effective_opacity_dom(dom, el) > TRANSPARENT_FLOOR {
        return false;
    }
    declares_animation(dom, el) || marks_lazy_loading(dom, el) || in_crossfade_stack(dom, el)
}

/// Whether an animation or transition running on the element at capture
/// moves its `opacity`: the frame the capture read is one of a fade, not a
/// value the raster is held at. A probe that could not read running
/// animations answers no.
fn opacity_in_motion(dom: &dyn Dom, el: ElId) -> bool {
    dom.running_animation_properties(el)
        .is_some_and(|props| props.iter().any(|p| p == "opacity"))
}

/// The longest a one-shot animation may run, delay included, for the frame
/// it ends on to be the state a visitor meets: maritime.sh's URL bar swaps
/// hosts four seconds into a ten-second demo.
const ANIMATION_END_MAX_SECONDS: f64 = 60.0;

/// One entry of an element's `animation-*` lists: the lists pair with
/// `animation-name` by position, repeating when shorter.
struct AnimationEntry {
    name: String,
    iterations: String,
    fill: String,
    direction: String,
    duration: String,
    delay: String,
    timeline: String,
    play_state: String,
    composition: String,
}

/// The entries of the element's `animation-*` lists, one per name other
/// than `none`. A list the capture did not record (a recording made before
/// it read `animation-fill-mode`, `animation-direction`,
/// `animation-duration`, `animation-delay` and `animation-play-state`) reads
/// empty, and every test that needs it answers no.
fn animation_entries(dom: &dyn Dom, el: ElId) -> Vec<AnimationEntry> {
    let names = dom.style(el, "animationName");
    if js::trim(&names).is_empty() || js::trim(&names) == "none" {
        return Vec::new();
    }
    let list = |prop: &str| -> Vec<String> {
        dom.style(el, prop).split(',').map(|v| js::to_lower_case(js::trim(v))).collect()
    };
    let at = |v: &[String], i: usize| -> String {
        if v.is_empty() {
            String::new()
        } else {
            v[i % v.len()].clone()
        }
    };
    let (iterations, fill, direction) = (list("animationIterationCount"), list("animationFillMode"), list("animationDirection"));
    let (duration, delay, timeline) = (list("animationDuration"), list("animationDelay"), list("animationTimeline"));
    let play_state = list("animationPlayState");
    let composition = list("animationComposition");
    names
        .split(',')
        .map(js::trim)
        .enumerate()
        .filter(|(_, name)| !name.is_empty() && *name != "none")
        .map(|(i, name)| AnimationEntry {
            name: name.to_string(),
            iterations: at(&iterations, i),
            fill: at(&fill, i),
            direction: at(&direction, i),
            duration: at(&duration, i),
            delay: at(&delay, i),
            timeline: at(&timeline, i),
            play_state: at(&play_state, i),
            composition: at(&composition, i),
        })
        .collect()
}

/// The one entry of the element's animations whose keyframes set `opacity`,
/// with every entry: `None` where none does or more than one does, since
/// which of several wins depends on their order and their composition, and
/// where a keyframe set cannot be read.
fn sole_opacity_entry(dom: &dyn Dom, el: ElId) -> Option<AnimationEntry> {
    let mut found: Option<AnimationEntry> = None;
    for entry in animation_entries(dom, el) {
        let frames = dom.keyframes(&entry.name)?;
        if frames.iter().any(|f| f.decls.iter().any(|(p, _)| p == "opacity")) {
            if found.is_some() {
                return None;
            }
            found = Some(entry);
        }
    }
    found
}

/// The opacity a keyframe sets, `None` where it sets none or it does not
/// read as a number.
fn frame_opacity(frame: &super::dom::KeyframeFrame) -> Option<f64> {
    frame
        .decls
        .iter()
        .rev()
        .find(|(p, _)| p == "opacity")
        .map(|(_, v)| {
            let v = js::trim(v);
            match v.strip_suffix('%') {
                Some(pct) => js::parse_float(pct) / 100.0,
                None => js::parse_float(v),
            }
        })
        .filter(|v| v.is_finite())
}

/// Whether a keyframe selector (`"0%, 35%"`, `"from"`, `"to"`) names the
/// offset `at` (0 or 1).
fn key_names_offset(key: &str, at: f64) -> bool {
    key.split(',').any(|k| {
        let k = js::to_lower_case(js::trim(k));
        let offset = match k.as_str() {
            "from" => 0.0,
            "to" => 1.0,
            _ => match k.strip_suffix('%') {
                Some(pct) => js::parse_float(pct) / 100.0,
                None => f64::NAN,
            },
        };
        (offset - at).abs() < 1e-9
    })
}

/// The opacity the keyframes of `name` set at offset `at` (0 or 1): the last
/// frame whose selector names that offset and sets `opacity`. `None` where
/// the capture recorded no selectors, or no frame sets opacity there (the
/// box then takes its own opacity, which the capture does not know).
fn opacity_at_offset(dom: &dyn Dom, name: &str, at: f64) -> Option<f64> {
    let frames = dom.keyframes(name)?;
    let keys = dom.keyframe_keys(name)?;
    if keys.len() != frames.len() {
        return None;
    }
    frames
        .iter()
        .zip(keys.iter())
        .filter(|(_, key)| key_names_offset(key, at))
        .filter_map(|(frame, _)| frame_opacity(frame))
        .last()
}

/// The opacity a finite animation holds once it has played, where it holds
/// one: it is running (`animation-play-state`), `animation-fill-mode` is
/// `forwards` or `both`, the iteration count is a whole number, the run
/// (delay plus every iteration) ends within [`ANIMATION_END_MAX_SECONDS`] on
/// the document timeline, and a keyframe at the offset the direction ends on
/// sets `opacity`. `None` for anything else: an unrecorded list or keyframe
/// selector, an infinite or fractional count, a scroll-driven timeline, a
/// fill mode that hands the box back to its own style, an
/// `animation-composition` other than `replace`.
fn held_end_opacity(dom: &dyn Dom, entry: &AnimationEntry) -> Option<f64> {
    if entry.play_state != "running" || !matches!(entry.fill.as_str(), "forwards" | "both") {
        return None;
    }
    if !(entry.timeline.is_empty() || entry.timeline == "auto") {
        return None;
    }
    // Only a replacing animation ends on its end frame's value: under `add`
    // or `accumulate` the frame's opacity is combined with the box's own,
    // which the capture does not know apart from the animated value it read.
    if entry.composition != "replace" {
        return None;
    }
    let count = js::parse_float(&entry.iterations);
    if !(count.is_finite() && count >= 1.0 && count.fract() == 0.0) {
        return None;
    }
    let (duration, delay) = (css_time(&entry.duration)?, css_time(&entry.delay)?);
    if !(duration > 0.0 && delay.max(0.0) + duration * count <= ANIMATION_END_MAX_SECONDS) {
        return None;
    }
    let odd = count % 2.0 == 1.0;
    let ends_on_last = match entry.direction.as_str() {
        "normal" => true,
        "reverse" => false,
        "alternate" => odd,
        "alternate-reverse" => !odd,
        _ => return None,
    };
    opacity_at_offset(dom, &entry.name, if ends_on_last { 1.0 } else { 0.0 })
}

/// A CSS `<time>` in seconds, `None` where it does not read.
fn css_time(value: &str) -> Option<f64> {
    let v = js::trim(value);
    let n = if let Some(ms) = v.strip_suffix("ms") {
        js::parse_float(ms) / 1000.0
    } else if let Some(s) = v.strip_suffix('s') {
        js::parse_float(s)
    } else {
        return None;
    };
    n.is_finite().then_some(n)
}

/// Whether an animation running on `el` at capture leaves it hidden for
/// good: a one-shot fade that ends at opacity 0 and holds that frame
/// (`forwards`), such as the outgoing half of maritime.sh's URL swap
/// (`ds-url-old 10s linear forwards`, opacity 1 until 35% and 0 after). A
/// capture taken in the first seconds reads opacity 1, which is a frame no
/// visitor is left with. The capture has to have seen an animation moving
/// the box's `opacity`, and the fade has to be the box's only animation that
/// sets it ([`sole_opacity_entry`]); a recording made before the capture read
/// the fill mode, direction, duration, delay, play state and keyframe
/// selectors answers no ([`held_end_opacity`]).
pub(crate) fn fades_out_for_good(dom: &dyn Dom, el: ElId) -> bool {
    if !opacity_in_motion(dom, el) {
        return false;
    }
    sole_opacity_entry(dom, el)
        .and_then(|entry| held_end_opacity(dom, &entry))
        .is_some_and(|o| o <= TRANSPARENT_FLOOR)
}

/// Whether the animation that sets `el`'s opacity, running at capture, shows
/// it: a loop whose keyframes take its `opacity` above the transparent
/// floor, or a one-shot fade that ends above it and holds that frame. A box
/// caught at 0 in the first frames of a timed fade-in, or in the off phase
/// of a loop, is content a visitor reads. Scroll-driven timelines are
/// [`opacity_held_by_scroll_timeline`]'s; a paused animation, a box with
/// more than one animation setting opacity, and a recording that did not
/// see the animation running answer no.
pub(crate) fn opacity_animation_shows(dom: &dyn Dom, el: ElId) -> bool {
    if !opacity_in_motion(dom, el) {
        return false;
    }
    let Some(entry) = sole_opacity_entry(dom, el) else {
        return false;
    };
    if !(entry.timeline.is_empty() || entry.timeline == "auto") || entry.play_state == "paused" {
        return false;
    }
    if entry.iterations == "infinite" {
        return dom
            .keyframes(&entry.name)
            .is_some_and(|frames| frames.iter().filter_map(frame_opacity).any(|o| o > TRANSPARENT_FLOOR));
    }
    held_end_opacity(dom, &entry).is_some_and(|o| o > TRANSPARENT_FLOOR)
}

/// The opacity at or under which a loop's keyframe makes the box vanish.
const LOOP_VANISH_OPACITY: f64 = 0.1;

/// Whether a loop running on `el` at capture takes it out of sight every
/// cycle: the box's only animation setting `opacity` is paired with an
/// `infinite` iteration count, is not paused, and has a keyframe at or under
/// [`LOOP_VANISH_OPACITY`], and the capture saw an animation moving the box's
/// `opacity`. The frame the capture read and the frame a later screenshot
/// shows are different phases of it. A loop that only breathes (0.7 to 1),
/// one that moves a transform or a shadow alone (a marquee, a floating
/// card), a box whose keyframes the capture could not read, and a recording
/// that did not read running animations answer no.
pub(crate) fn loops_in_motion(dom: &dyn Dom, el: ElId) -> bool {
    let names = dom.style(el, "animationName");
    if js::trim(&names).is_empty() || js::trim(&names) == "none" {
        return false;
    }
    if !opacity_in_motion(dom, el) {
        return false;
    }
    sole_opacity_entry(dom, el).is_some_and(|entry| {
        entry.iterations == "infinite"
            && entry.play_state != "paused"
            && dom
                .keyframes(&entry.name)
                .is_some_and(|frames| frames.iter().filter_map(frame_opacity).any(|o| o <= LOOP_VANISH_OPACITY))
    })
}

/// Whether `el` (when `include_self`) or an ancestor fades out for good
/// ([`fades_out_for_good`]). Only boxes that name an animation are asked
/// about what runs on them.
fn fades_out_in_chain(dom: &dyn Dom, el: ElId, include_self: bool) -> bool {
    const MAX_ANCESTORS: usize = 64;
    let mut cur = if include_self { Some(el) } else { dom.parent(el) };
    for _ in 0..MAX_ANCESTORS {
        let Some(c) = cur else { return false };
        if Some(c) == dom.body() || Some(c) == dom.document_element() {
            return false;
        }
        let names = dom.style(c, "animationName");
        if !js::trim(&names).is_empty() && js::trim(&names) != "none" && fades_out_for_good(dom, c) {
            return true;
        }
        cur = dom.parent(c);
    }
    false
}

/// Whether `el`, a box at an opacity of 0, is held there by a scroll-driven
/// animation rather than by a reveal that never ran: `animation-timeline:
/// view()` fades a block in as it enters the viewport and holds it at its
/// first keyframe while it is below the fold, so a measure taken at the top
/// of the page reads every block further down at 0, and a visitor who
/// scrolls sees all of them. All three of:
///
/// - an animation the capture saw running on the box moves its `opacity`;
/// - an `animation-name` on the box has keyframes that set `opacity`;
/// - that opacity animation runs on a scroll progress timeline (`scroll()`),
///   a view progress timeline (`view()`) or a named timeline (`--name`): the
///   computed `animation-timeline` entry paired with its `animation-name`
///   entry (the cascade has settled any override, and a box running a
///   document-timeline fade beside a scroll-driven one is not held). A
///   capture that did not record `animation-timeline` falls back to a rule
///   in `style_text` whose selector matches the box and declares one.
///
/// A probe that could not read running animations, a timeline attached by
/// script (`new ScrollTimeline()`), and a scroll-linked reveal a script
/// drives by writing styles are none of these and keep base behaviour.
pub fn opacity_held_by_scroll_timeline(dom: &dyn Dom, el: ElId, style_text: &str) -> bool {
    if !opacity_in_motion(dom, el) {
        return false;
    }
    let fades = |name: &str| {
        dom.keyframes(name)
            .is_some_and(|frames| frames.iter().any(|f| f.decls.iter().any(|(p, _)| p == "opacity")))
    };
    let scroll_driven = |timeline: &str| {
        let timeline = js::to_lower_case(js::trim(timeline));
        timeline.starts_with("scroll(") || timeline.starts_with("view(") || timeline.starts_with("--")
    };
    let timelines = dom.style(el, "animationTimeline");
    if !js::trim(&timelines).is_empty() {
        // `animation-timeline` pairs with `animation-name` by position, its
        // list repeating when it is the shorter one.
        let timelines: Vec<&str> = timelines.split(',').collect();
        return dom
            .style(el, "animationName")
            .split(',')
            .enumerate()
            .any(|(i, name)| {
                let name = js::trim(name);
                name != "none" && fades(name) && scroll_driven(timelines[i % timelines.len()])
            });
    }
    if !animation_names(dom, el).iter().any(|name| fades(name)) {
        return false;
    }
    const DECL: &str = "animation-timeline";
    let lower = style_text.to_ascii_lowercase();
    let mut from = 0;
    while let Some(found) = lower[from..].find(DECL) {
        let at = from + found;
        from = at + DECL.len();
        let rest = lower[from..].trim_start();
        let Some(value) = rest.strip_prefix(':') else { continue };
        let value = value.split([';', '}']).next().unwrap_or("");
        let scroll_driven = value.split(',').map(js::trim).any(|timeline| {
            timeline.starts_with("scroll(") || timeline.starts_with("view(") || timeline.starts_with("--")
        });
        if !scroll_driven {
            continue;
        }
        let Some(selector) = crate::checks::css_scan::enclosing_css_selector(style_text, at) else {
            continue;
        };
        if dom.matches(el, &selector) == Ok(true) {
            return true;
        }
    }
    false
}

/// Whether `el`, an absolutely positioned box with area, lies wholly outside
/// an ancestor that clips it, where every ancestor that clips it has area on
/// the axis it clips: the answer of a closed accordion that parks its panel
/// below a row which hides its overflow. Such a box shows nothing at any
/// opacity, so its opacity is not what hides its text. A box under a clip
/// collapsed to no width or no height (a slider that never got its height) is
/// not this: there the clip itself may be what failed.
pub fn parked_outside_clip(dom: &dyn Dom, el: ElId) -> bool {
    if Placement::of(dom, el) != Placement::Absolute {
        return false;
    }
    let rect = dom.rect(el);
    if !rect.all_finite() || rect.width < 1.0 || rect.height < 1.0 {
        return false;
    }
    if unpainted_at_capture(dom, el, OwnOpacity::Toggled) != Some(Unpainted::ClippedOut) {
        return false;
    }
    const MAX_ANCESTORS: usize = 512;
    let mut cur = dom.parent(el);
    for _ in 0..MAX_ANCESTORS {
        let Some(p) = cur else { break };
        if Some(p) == dom.body() || Some(p) == dom.document_element() {
            break;
        }
        if clips_contents(&dom.style(p, "display")) {
            let (ox, oy) = overflow_axes(dom, p);
            let cr = dom.rect(p);
            if !cr.all_finite() || (clips(&ox) && cr.width < 1.0) || (clips(&oy) && cr.height < 1.0) {
                return false;
            }
        }
        cur = dom.parent(p);
    }
    true
}

/// How many revealed peers show that a page swaps a class to reveal its
/// images.
const CLASS_REVEAL_MIN_PEERS: usize = 2;

/// The own opacity from which a peer image counts as revealed.
const CLASS_REVEAL_PEER_OPACITY: f64 = 0.5;

/// Whether an `<img>` at rest at 0 is waiting for a class swap the page is
/// seen making on other images. A theme that fades its thumbnails in as they
/// scroll into view holds each one at `opacity: 0` under one class and swaps
/// it for another that sets `opacity: 1` with an opacity transition (tagDiv
/// Newspaper's `td-animation-stack-type0-1` to `-type0-2`, a React image
/// going from `opacity-0` to `opacity-100` once it loads); a capture that
/// reads the page before the swap reaches an image finds it at 0 with no
/// lazy marker, since its `src` is already set and the fade is declared on
/// the class that replaces this one.
///
/// The evidence is on the page: at least [`CLASS_REVEAL_MIN_PEERS`] other
/// images that are shown (own opacity [`CLASS_REVEAL_PEER_OPACITY`] or more,
/// painted through their ancestors), declare an opacity transition or an
/// opacity animation, share a class token with this image and carry its
/// class list with exactly one token swapped for another or one token added.
/// An image with no class, or with no such peers, keeps base behaviour: one
/// held at 0 on a page that reveals nothing else of its kind is reported.
fn awaits_class_reveal(dom: &dyn Dom, el: ElId) -> bool {
    if tag_lower(dom, el) != "img" || effective_opacity_dom(dom, el) > TRANSPARENT_FLOOR {
        return false;
    }
    let own = class_tokens(dom, el);
    if own.is_empty() {
        return false;
    }
    let mut peers = 0;
    for other in dom.query_all(None, "img").unwrap_or_default() {
        if other == el {
            continue;
        }
        let theirs = class_tokens(dom, other);
        let shared = own.iter().filter(|t| theirs.contains(*t)).count();
        let gone = own.len() - shared;
        let new = theirs.iter().filter(|t| !own.contains(*t)).count();
        if shared == 0 || gone > 1 || new != 1 {
            continue;
        }
        let opacity = js::parse_float(&dom.style(other, "opacity"));
        if !(opacity.is_finite() && opacity >= CLASS_REVEAL_PEER_OPACITY) {
            continue;
        }
        if effective_opacity_dom(dom, other) <= TRANSPARENT_FLOOR {
            continue;
        }
        if !(declares_opacity_transition(dom, other) || declares_opacity_animation(dom, other)) {
            continue;
        }
        peers += 1;
        if peers >= CLASS_REVEAL_MIN_PEERS {
            return true;
        }
    }
    false
}

/// The distinct class tokens of an element, as written.
fn class_tokens(dom: &dyn Dom, el: ElId) -> Vec<String> {
    let mut tokens: Vec<String> = Vec::new();
    for token in class_attr(dom, el).split_ascii_whitespace() {
        if !tokens.iter().any(|t| t == token) {
            tokens.push(token.to_string());
        }
    }
    tokens
}

/// `transition-property` / `transition-duration` pair `opacity` or `all` with
/// a non-zero duration (the lists repeat to the longer one).
fn declares_opacity_transition(dom: &dyn Dom, el: ElId) -> bool {
    declares_transition_of(dom, el, "opacity")
}

/// `transition-property` / `transition-duration` pair `property` or `all`
/// with a non-zero duration (the lists repeat to the longer one).
pub(crate) fn declares_transition_of(dom: &dyn Dom, el: ElId, property: &str) -> bool {
    let props = dom.style(el, "transitionProperty");
    let durations = dom.style(el, "transitionDuration");
    let props: Vec<&str> = props.split(',').map(js::trim).collect();
    let durations: Vec<&str> = durations.split(',').map(js::trim).collect();
    if durations.is_empty() {
        return false;
    }
    props.iter().enumerate().any(|(i, p)| {
        (*p == property || *p == "all") && css_time_seconds(durations[i % durations.len()]) > 0.0
    })
}

/// How many words of a run have to carry their own inline colour before the
/// run reads as a scripted colour reveal.
const REVEAL_RUN_MIN_WORDS: usize = 3;

/// Whether `el`'s colour is one frame of a scripted colour reveal rather
/// than its colour at rest: a scroll-linked "words light up as you read"
/// paragraph, where a script writes each word's (or letter's) `color` into
/// its `style` attribute and the word transitions `color` to it. The element
/// is such a word and transitions `color`, and either its parent holds at
/// least [`REVEAL_RUN_MIN_WORDS`] such words of its tag as children, itself
/// included, or it is one letter and its grandparent's words hold that many
/// such letters between them (a letter-by-letter reveal wraps each word in a
/// span of its own). A reveal wraps every word it lights, so a run with a bare
/// word of its own is prose an editor coloured in places (a TinyMCE span, a
/// link a theme transitions), and not a reveal. A word a script has not
/// reached yet is still in its start colour, which is no colour a reader is
/// asked to read. A row of chips whose selected one React styles inline paints
/// a fill and a border too, and is not a word run.
pub fn colour_mid_reveal(dom: &dyn Dom, el: ElId) -> bool {
    if !is_reveal_word(dom, el) || !declares_transition_of(dom, el, "color") {
        return false;
    }
    let tag = dom.tag_name(el);
    let is_word = |w: ElId| dom.tag_name(w) == tag && is_reveal_word(dom, w);
    let Some(parent) = dom.parent(el) else {
        return false;
    };
    if has_direct_text_longer_than(dom, parent, 0) {
        return false;
    }
    let words = dom.children(parent).into_iter().filter(|&w| is_word(w)).take(REVEAL_RUN_MIN_WORDS).count();
    if words >= REVEAL_RUN_MIN_WORDS {
        return true;
    }
    if !is_one_letter(dom, el) {
        return false;
    }
    let Some(run) = dom.parent(parent) else {
        return false;
    };
    if has_direct_text_longer_than(dom, run, 0) {
        return false;
    }
    let mut letters = 0;
    for word in dom.children(run) {
        if has_direct_text_longer_than(dom, word, 0) {
            continue;
        }
        letters += dom.children(word).into_iter().filter(|&l| is_word(l) && is_one_letter(dom, l)).count();
        if letters >= REVEAL_RUN_MIN_WORDS {
            return true;
        }
    }
    false
}

/// An element whose text is one character of its own, and nothing inside it.
fn is_one_letter(dom: &dyn Dom, el: ElId) -> bool {
    dom.children(el).is_empty() && js::trim(&super::dom::direct_text(dom, el)).chars().count() == 1
}

/// The declarations a colour reveal writes into a word's `style` attribute.
/// `display` is among them: a reveal that splits a heading into words sets
/// each one `inline-block` beside its colour (antropi.world's
/// `span.word-element`), and the word is still held to an inline display
/// below. A chip a script styles inline writes a fill or a border too.
const REVEAL_STYLE_PROPS: &[&str] = &["color", "opacity", "transition", "will-change", "display"];

/// An inline word whose `style` attribute sets its `color` and nothing but
/// what a colour reveal writes beside it (its transition, an opacity, its
/// display). Inline means laid out as a word: `inline` or `inline-block`, or
/// the `block` either computes to as an item of a flex or grid run.
fn is_reveal_word(dom: &dyn Dom, el: ElId) -> bool {
    // A flex or grid container blockifies its items, so a word set
    // `inline-block` inside a wrapping flex heading computes to `block`.
    let inline = match dom.style(el, "display").as_str() {
        "inline" | "inline-block" => true,
        "block" => dom.parent(el).is_some_and(|p| {
            matches!(dom.style(p, "display").as_str(), "flex" | "inline-flex" | "grid" | "inline-grid")
        }),
        _ => false,
    };
    if !inline {
        return false;
    }
    let Some(style) = dom.attr(el, "style") else {
        return false;
    };
    let names: Vec<String> = style
        .split(';')
        .filter_map(|decl| decl.split_once(':'))
        .map(|(name, _)| js::to_lower_case(js::trim(name)))
        .collect();
    names.iter().any(|n| n == "color")
        && names
            .iter()
            .all(|n| REVEAL_STYLE_PROPS.contains(&n.as_str()) || n.starts_with("transition-"))
}

/// Whether the element's `style` attribute declares `property`.
fn inline_declares(dom: &dyn Dom, el: ElId, property: &str) -> bool {
    dom.attr(el, "style").is_some_and(|style| {
        style
            .split(';')
            .filter_map(|decl| decl.split_once(':'))
            .any(|(name, _)| js::to_lower_case(js::trim(name)) == property)
    })
}

fn css_time_seconds(value: &str) -> f64 {
    let v = js::trim(value);
    let n = if let Some(ms) = v.strip_suffix("ms") {
        js::parse_float(ms) / 1000.0
    } else if let Some(s) = v.strip_suffix('s') {
        js::parse_float(s)
    } else {
        0.0
    };
    finite_or(n, 0.0)
}

fn animation_names(dom: &dyn Dom, el: ElId) -> Vec<String> {
    dom.style(el, "animationName")
        .split(',')
        .map(js::trim)
        .filter(|name| !name.is_empty() && *name != "none")
        .map(str::to_string)
        .collect()
}

/// Any `animation-name` other than `none`.
fn declares_animation(dom: &dyn Dom, el: ElId) -> bool {
    !animation_names(dom, el).is_empty()
}

/// An `animation-name` whose keyframes animate opacity, or whose keyframes
/// the capture could not read.
fn declares_opacity_animation(dom: &dyn Dom, el: ElId) -> bool {
    animation_names(dom, el).iter().any(|name| match dom.keyframes(name) {
        Some(frames) => frames.iter().any(|f| f.decls.iter().any(|(p, _)| p == "opacity")),
        None => true,
    })
}

/// The attributes lazy-loading libraries park a source or a load state in.
const LAZY_ATTRS: &[&str] = &[
    "data-src",
    "data-srcset",
    "data-lazy",
    "data-lazy-src",
    "data-lazy-srcset",
    "data-original",
    "data-bg",
    "data-loaded",
    "data-ll-status",
];

/// `loading="lazy"`, a lazy-loading library's source or state attribute, or a
/// class on the raster or its parent that names lazy loading or a load state
/// (`lazyload`, `owl-lazy`, `is-loading`, `preload`).
fn marks_lazy_loading(dom: &dyn Dom, el: ElId) -> bool {
    if dom
        .attr(el, "loading")
        .is_some_and(|v| js::to_lower_case(js::trim(&v)) == "lazy")
    {
        return true;
    }
    if LAZY_ATTRS.iter().any(|name| dom.attr(el, name).is_some()) {
        return true;
    }
    [Some(el), dom.parent(el)].into_iter().flatten().any(|node| {
        class_attr(dom, node).split_ascii_whitespace().any(|token| {
            let token = js::to_lower_case(token);
            token.contains("lazy") || token.contains("loading") || token.contains("preload")
        })
    })
}

/// Whether a raster is a lazy-loading library's image that has not been
/// shown yet, which the library fades in once its source arrives:
///
/// - a load-state attribute says it has not loaded (`data-loaded="false"`,
///   or vanilla-lazyload's `data-ll-status` at anything but `loaded`);
/// - a library holds its source (`data-src`, `data-srcset`, ...) and the
///   element has no `src` of its own yet;
/// - a class on the raster or its parent names lazy loading (`lazy`,
///   `lazyload`, `lazy-load-image-background`) and none names the loaded
///   state (`lazyloaded`, `lazy-load-image-loaded`), while the raster sits
///   at rest at 0 or a script is tweening its inline `opacity` (jQuery
///   lazyload's `fadeIn`, caught in its first frames).
///
/// The native `loading="lazy"` attribute alone does not count: Next.js
/// images carry it by default, and an image held buried behind it is still
/// reported.
fn lazy_raster_pending(dom: &dyn Dom, el: ElId) -> bool {
    if dom.attr(el, "data-loaded").is_some_and(|v| js::to_lower_case(js::trim(&v)) == "false") {
        return true;
    }
    if dom.attr(el, "data-ll-status").is_some_and(|v| js::to_lower_case(js::trim(&v)) != "loaded") {
        return true;
    }
    let holds_source = LAZY_ATTRS
        .iter()
        .filter(|name| !matches!(**name, "data-loaded" | "data-ll-status"))
        .any(|name| dom.attr(el, name).is_some());
    if holds_source && dom.attr(el, "src").map_or(true, |v| js::trim(&v).is_empty()) {
        return true;
    }
    let tokens: Vec<String> = [Some(el), dom.parent(el)]
        .into_iter()
        .flatten()
        .flat_map(|node| {
            class_attr(dom, node)
                .split_ascii_whitespace()
                .map(js::to_lower_case)
                .collect::<Vec<_>>()
        })
        .collect();
    if !tokens.iter().any(|t| t.contains("lazy")) || tokens.iter().any(|t| t.contains("loaded")) {
        return false;
    }
    effective_opacity_dom(dom, el) <= TRANSPARENT_FLOOR || inline_opacity_declared(dom, el)
}

/// Whether the element's `style` attribute declares `opacity`: the value a
/// script tween writes on each frame.
fn inline_opacity_declared(dom: &dyn Dom, el: ElId) -> bool {
    inline_declares(dom, el, "opacity")
}

const MEDIA_TAGS: &[&str] = &["img", "picture", "video", "canvas"];

/// How deep a sibling's subtree is searched for the video or raster it holds.
const LAYER_SEARCH_DEPTH: usize = 3;

/// A `<video>` parent, or a sibling that is (or holds) a video or a raster
/// covering most of the element's box: the other layers of a crossfade, or
/// the video a poster sits over.
fn in_crossfade_stack(dom: &dyn Dom, el: ElId) -> bool {
    stacked_with(dom, el, false)
}

/// A `<video>` parent, or a sibling that is (or holds) a `<video>` covering
/// most of the element's box: the poster frame of a player (hse.de's live
/// preview, whose `<img>` sits at opacity 0 beside the playing video). A
/// raster sibling alone is not enough here, since an image held buried over
/// another image is what `buried-raster` reports.
fn poster_under_video(dom: &dyn Dom, el: ElId) -> bool {
    stacked_with(dom, el, true)
}

fn stacked_with(dom: &dyn Dom, el: ElId, video_only: bool) -> bool {
    let Some(parent) = dom.parent(el) else {
        return false;
    };
    if tag_lower(dom, parent) == "video" {
        return true;
    }
    let rect = dom.rect(el);
    dom.children(parent)
        .into_iter()
        .filter(|sibling| *sibling != el)
        .any(|sibling| holds_layer_over(dom, sibling, &rect, LAYER_SEARCH_DEPTH, video_only))
}

fn holds_layer_over(dom: &dyn Dom, node: ElId, target: &Rect, depth: usize, video_only: bool) -> bool {
    let tag = tag_lower(dom, node);
    let layer = if video_only {
        tag == "video" && shows_box(dom, node)
    } else {
        MEDIA_TAGS.contains(&tag.as_str()) || dom.style(node, "backgroundImage").contains("url(")
    };
    if layer && covers_most_of(&dom.rect(node), target) {
        return true;
    }
    depth > 0
        && dom
            .children(node)
            .into_iter()
            .any(|child| holds_layer_over(dom, child, target, depth - 1, video_only))
}

/// Whether a box is drawn at all: rendered, not `visibility: hidden`, and
/// above the transparent floor once its ancestors' opacity is applied.
fn shows_box(dom: &dyn Dom, node: ElId) -> bool {
    dom.check_visibility(node) != Some(false)
        && !hides_by_visibility(dom, node)
        && dom.style(node, "display") != "none"
        && effective_opacity_dom(dom, node) > TRANSPARENT_FLOOR
}

/// Whether `layer` overlaps at least half of `target`'s area.
fn covers_most_of(layer: &Rect, target: &Rect) -> bool {
    if !layer.all_finite() || !target.all_finite() {
        return false;
    }
    let area = target.width * target.height;
    if area <= 0.0 {
        return false;
    }
    let w = js::math_min(layer.right, target.right) - js::math_max(layer.left, target.left);
    let h = js::math_min(layer.bottom, target.bottom) - js::math_max(layer.top, target.top);
    w > 0.0 && h > 0.0 && w * h >= 0.5 * area
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::browser::fake_dom::FakeDom;

    /// The computed values a browser reports for the containing-block
    /// properties when none is set.
    const RESOLVED_INITIAL: &[(&str, &str)] = &[
        ("transform", "none"),
        ("translate", "none"),
        ("scale", "none"),
        ("rotate", "none"),
        ("perspective", "none"),
        ("filter", "none"),
        ("backdropFilter", "none"),
        ("willChange", "auto"),
        ("contain", "none"),
    ];

    fn resolved(d: &mut FakeDom, el: ElId) {
        d.set_styles(el, RESOLVED_INITIAL);
    }

    fn page() -> (FakeDom, ElId) {
        let mut d = FakeDom::new();
        let (html, body) = d.with_page();
        d.set_rect(html, 0.0, 0.0, 1280.0, 4000.0);
        d.set_rect(body, 0.0, 0.0, 1280.0, 4000.0);
        d.el_mut(html).scroll_width = 1280.0;
        resolved(&mut d, html);
        resolved(&mut d, body);
        (d, body)
    }

    fn why(d: &FakeDom, el: ElId) -> Option<Unpainted> {
        unpainted_at_capture(d, el, OwnOpacity::Counts)
    }

    fn raster(d: &FakeDom, el: ElId) -> Option<Unpainted> {
        unpainted_at_capture(d, el, OwnOpacity::Measured)
    }

    fn text(d: &FakeDom, el: ElId) -> Option<Unpainted> {
        unpainted_for(d, el, PaintGate::Text)
    }

    /// jyes.com.tw's Slick dots: the label of each dot is `font-size: 0`.
    #[test]
    fn text_set_under_1px_is_not_painted_for_text_rules() {
        let (mut d, body) = page();
        let dot = d.add(Some(body), "button");
        d.set_style(dot, "fontSize", "0px");
        d.set_rect(dot, 574.0, 568.0, 12.0, 12.0);
        d.add_text(dot, "1");
        assert_eq!(text(&d, dot), Some(Unpainted::NoFontSize));
        // The box rules still see the dot.
        assert_eq!(unpainted_for(&d, dot, PaintGate::Box), None);

        // A row that collapses the gaps between inline blocks with
        // `font-size: 0` shows the text its children set larger.
        let row = d.add(Some(body), "div");
        d.set_style(row, "fontSize", "0px");
        d.set_rect(row, 40.0, 200.0, 600.0, 20.0);
        d.add_text(row, " ");
        let item = d.add(Some(row), "span");
        d.set_style(item, "fontSize", "14px");
        d.set_rect(item, 40.0, 200.0, 80.0, 20.0);
        d.add_text(item, "Pricing");
        assert_eq!(text(&d, row), None);
        assert_eq!(text(&d, item), None);

        // A size that does not parse keeps the text.
        d.set_style(dot, "fontSize", "");
        assert_eq!(text(&d, dot), None);
        assert!(under_1px("0.5px"));
        assert!(!under_1px("1px"));
        assert!(!under_1px(""));
    }

    /// stroq.dev's "your browser does not support video" line inside the
    /// case-study `<video>`.
    #[test]
    fn fallback_content_of_a_media_element_is_not_painted() {
        let (mut d, body) = page();
        let video = d.add(Some(body), "video");
        d.set_rect(video, 61.0, 1863.0, 1158.0, 650.0);
        d.add_text(video, "Your browser does not support the video tag.");
        assert_eq!(text(&d, video), Some(Unpainted::FallbackContent));
        // The media box itself paints.
        assert_eq!(unpainted_for(&d, video, PaintGate::Box), None);

        for tag in ["video", "audio", "canvas", "iframe"] {
            let host = d.add(Some(body), tag);
            d.set_rect(host, 40.0, 100.0, 300.0, 150.0);
            let p = d.add(Some(host), "p");
            d.set_rect(p, 40.0, 100.0, 300.0, 20.0);
            d.add_text(p, "Download the file instead.");
            assert_eq!(why(&d, p), Some(Unpainted::FallbackContent), "{tag}");
        }

        // `<object>` shows its content when the resource fails to load.
        let object = d.add(Some(body), "object");
        d.set_rect(object, 40.0, 400.0, 300.0, 150.0);
        let p = d.add(Some(object), "p");
        d.set_rect(p, 40.0, 400.0, 300.0, 20.0);
        d.add_text(p, "The chart could not load.");
        assert_eq!(why(&d, p), None);
    }

    /// aisdr.com's guide cards: the back of each is `rotateY(180deg)` under
    /// `backface-visibility: hidden`.
    #[test]
    fn a_face_turned_away_is_not_painted() {
        const FLIPPED: &str = "matrix3d(-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1)";
        let (mut d, body) = page();
        let card = d.add(Some(body), "div");
        d.set_styles(card, &[("position", "relative"), ("transform", "none"), ("rotate", "none")]);
        d.set_rect(card, 175.0, 1971.0, 296.0, 233.0);
        let back = d.add(Some(card), "div");
        d.set_styles(back, &[("position", "absolute"), ("transform", FLIPPED), ("backfaceVisibility", "hidden"), ("rotate", "none"), ("scale", "none")]);
        d.set_rect(back, 175.0, 1971.0, 296.0, 233.0);
        let copy = d.add(Some(back), "p");
        d.set_rect(copy, 196.0, 1992.0, 254.0, 90.0);
        d.add_text(copy, "Are you overhyping the AI?");
        assert_eq!(why(&d, copy), Some(Unpainted::TurnedAway));
        assert_eq!(why(&d, back), Some(Unpainted::TurnedAway));

        // The front face, and a back face whose backface shows, are painted.
        let front = d.add(Some(card), "div");
        d.set_styles(front, &[("transform", "none"), ("backfaceVisibility", "hidden")]);
        d.set_rect(front, 175.0, 1971.0, 296.0, 233.0);
        assert_eq!(why(&d, front), None);
        d.set_style(back, "backfaceVisibility", "visible");
        assert_eq!(why(&d, copy), None);

        // A capture that did not record the property keeps it.
        d.set_style(back, "backfaceVisibility", "");
        assert_eq!(why(&d, copy), None);

        // The card turned by a 3D transform of its own (a flip on hover) may
        // face the back towards the viewer, so it is kept.
        d.set_style(back, "backfaceVisibility", "hidden");
        d.set_style(card, "transform", FLIPPED);
        assert_eq!(why(&d, copy), None);
        d.set_style(card, "transform", "none");
        d.set_style(card, "rotate", "y 180deg");
        assert_eq!(why(&d, copy), None);

        // A 2D mirror turns nothing away.
        d.set_style(card, "rotate", "none");
        d.set_style(back, "transform", "matrix(-1, 0, 0, 1, 0, 0)");
        assert_eq!(why(&d, copy), None);
    }

    /// bt.cn's mobile drawer: parked at x 540 on a 390px phone, inside a
    /// fixed header whose `backdrop-filter` makes it the drawer's containing
    /// block.
    #[test]
    fn a_viewport_layer_holds_nothing_past_the_viewport_sides() {
        let mut d = FakeDom::new();
        let (html, body) = d.with_page();
        d.set_rect(html, 0.0, 0.0, 390.0, 844.0);
        d.set_rect(body, 0.0, 0.0, 390.0, 844.0);
        d.el_mut(html).scroll_width = 390.0;
        d.inner_width = 390.0;
        d.inner_height = 844.0;
        resolved(&mut d, html);
        resolved(&mut d, body);
        let header = d.add(Some(body), "header");
        resolved(&mut d, header);
        d.set_styles(header, &[("position", "fixed"), ("backdropFilter", "blur(12px)")]);
        d.set_rect(header, 0.0, 0.0, 390.0, 60.0);
        let drawer = d.add(Some(header), "div");
        resolved(&mut d, drawer);
        d.set_style(drawer, "position", "fixed");
        d.set_rect(drawer, 540.0, 0.0, 240.0, 844.0);
        let label = d.add(Some(drawer), "span");
        d.set_rect(label, 594.0, 186.0, 16.0, 22.0);
        d.add_text(label, "AI");
        assert_eq!(why(&d, label), Some(Unpainted::OutsideDocument));

        // Opened, the drawer is on screen.
        d.set_rect(drawer, 150.0, 0.0, 240.0, 844.0);
        d.set_rect(label, 204.0, 186.0, 16.0, 22.0);
        assert_eq!(why(&d, label), None);

        // Below the fold of a viewport layer is what a smooth-scroll page
        // brings into view.
        d.set_rect(label, 204.0, 1400.0, 16.0, 22.0);
        assert_eq!(why(&d, label), None);
    }

    /// jyes.com.tw's spec table under a "read more" panel held at
    /// `max-height: 1000px`, taller than the phone's viewport.
    #[test]
    fn a_panel_held_at_its_max_height_is_not_a_scroll_frame() {
        let (mut d, body) = page();
        let panel = d.add(Some(body), "div");
        d.set_styles(panel, &[("display", "block"), ("overflowX", "hidden"), ("overflowY", "hidden"), ("maxHeight", "1000px")]);
        d.set_rect(panel, 20.0, 4516.0, 350.0, 1000.0);
        d.el_mut(panel).client_height = 999.0;
        d.el_mut(panel).scroll_height = Some(2968.0);
        let cell = d.add(Some(panel), "td");
        d.set_rect(cell, 173.0, 6076.0, 195.0, 149.0);
        d.add_text(cell, "B1/B3/B5/B8");
        assert_eq!(why(&d, cell), Some(Unpainted::ClippedOut));
        let shown = d.add(Some(panel), "p");
        d.set_rect(shown, 40.0, 4600.0, 300.0, 40.0);
        assert_eq!(why(&d, shown), None);

        // A frame sized by `height` (the scroll libraries' way) keeps what
        // lies below its bottom edge, and so does a cap it does not reach.
        d.set_style(panel, "maxHeight", "none");
        assert_eq!(why(&d, cell), None);
        d.set_style(panel, "maxHeight", "1200px");
        assert_eq!(why(&d, cell), None);
        d.set_style(panel, "maxHeight", "100%");
        assert_eq!(why(&d, cell), None);

        // A frame capped at the viewport's own height (`height: 100vh;
        // max-height: 100vh`) is the viewport's frame, not a collapsed panel.
        let vh = d.inner_height();
        d.set_rect(panel, 0.0, 0.0, 1280.0, vh);
        d.el_mut(panel).client_height = vh;
        d.set_style(panel, "maxHeight", &format!("{vh}px"));
        d.set_rect(cell, 40.0, 1600.0, 195.0, 40.0);
        assert_eq!(why(&d, cell), None);
    }

    /// zigzag.kr (`data-loaded="false"`), thairath.co.th
    /// (react-lazy-load-image-component before its `-loaded` class) and
    /// jyes.com.tw (jQuery lazyload's `fadeIn` in its first frames).
    #[test]
    fn a_lazy_image_a_library_has_not_shown_is_a_state_layer() {
        let (mut d, body) = page();
        let wrap = d.add(Some(body), "div");
        d.set_rect(wrap, 40.0, 400.0, 400.0, 400.0);
        let img = d.add(Some(wrap), "img");
        d.set_rect(img, 40.0, 400.0, 400.0, 400.0);
        d.set_style(img, "opacity", "0");
        assert_eq!(raster(&d, img), None);

        d.set_attr(img, "data-loaded", "false");
        assert_eq!(raster(&d, img), Some(Unpainted::StateLayer));
        d.set_attr(img, "data-loaded", "true");
        assert_eq!(raster(&d, img), None);

        // A library that holds the source while the element has none.
        d.set_attr(img, "data-src", "/photo.jpg");
        assert_eq!(raster(&d, img), Some(Unpainted::StateLayer));
        d.set_attr(img, "src", "/photo.jpg");
        assert_eq!(raster(&d, img), None);

        // A lazy-loading class on the parent, before the loaded class.
        d.set_attr(wrap, "class", "lazy-load-image-background blur");
        assert_eq!(raster(&d, img), Some(Unpainted::StateLayer));
        d.set_attr(wrap, "class", "lazy-load-image-background blur lazy-load-image-loaded");
        assert_eq!(raster(&d, img), None);

        // A faint value is a fade only while a script tweens it inline.
        d.set_attr(wrap, "class", "pic");
        d.set_attr(img, "class", "lazy");
        d.set_style(img, "opacity", "0.0688");
        assert_eq!(raster(&d, img), None);
        d.set_attr(img, "style", "display: inline; opacity: 0.0688;");
        assert_eq!(raster(&d, img), Some(Unpainted::StateLayer));

        // The native attribute alone is Next.js's default, not a library.
        let native = d.add(Some(body), "img");
        d.set_rect(native, 40.0, 900.0, 400.0, 400.0);
        d.set_style(native, "opacity", "0");
        d.set_attr(native, "loading", "lazy");
        assert_eq!(raster(&d, native), None);
    }

    /// v0-evasion-website.vercel.app: each word of a paragraph lights up as
    /// the reader scrolls, written into its `style` attribute.
    #[test]
    fn a_word_part_way_through_a_colour_reveal_is_not_at_rest() {
        let (mut d, body) = page();
        let p = d.add(Some(body), "p");
        d.set_rect(p, 40.0, 1200.0, 600.0, 40.0);
        let mut words = Vec::new();
        for w in ["Words", "light", "up", "later"] {
            let span = d.add(Some(p), "span");
            d.set_styles(span, &[("display", "inline"), ("transitionProperty", "color, background-color"), ("transitionDuration", "0.15s")]);
            d.set_attr(span, "style", "color: rgb(228, 228, 231);");
            d.add_text(span, w);
            words.push(span);
        }
        assert!(colour_mid_reveal(&d, words[0]));

        // Without the transition the colour is where it rests.
        for &w in &words {
            d.set_style(w, "transitionDuration", "0s");
        }
        assert!(!colour_mid_reveal(&d, words[0]));

        // Two coloured words are an emphasis, not a reveal.
        for &w in &words {
            d.set_style(w, "transitionDuration", "0.15s");
        }
        d.set_attr(words[2], "style", "");
        d.set_attr(words[3], "style", "font-weight: 600;");
        assert!(!colour_mid_reveal(&d, words[0]));

        // zoptron.framer.ai reveals letter by letter, one span per word: a
        // two-letter word's letters count with the rest of the paragraph.
        let q = d.add(Some(body), "p");
        d.set_style(q, "display", "flex");
        d.set_rect(q, 40.0, 1400.0, 600.0, 40.0);
        let mut letters = Vec::new();
        for word in ["an", "idea"] {
            let w = d.add(Some(q), "span");
            for c in word.chars() {
                let l = d.add(Some(w), "span");
                d.set_styles(l, &[("display", "inline"), ("transitionProperty", "color"), ("transitionDuration", "0.2s")]);
                d.set_attr(l, "style", "transition: color 0.2s ease-in-out; color: rgb(50, 61, 73);");
                d.add_text(l, &c.to_string());
                letters.push(l);
            }
        }
        assert!(colour_mid_reveal(&d, letters[0]));

        // antropi.world splits a wrapping flex heading into words: each sets
        // its display beside its colour, and computes to `block` as a flex
        // item. The spacers between them are not words.
        let h = d.add(Some(body), "h1");
        d.set_style(h, "display", "flex");
        d.set_rect(h, 40.0, 1600.0, 600.0, 120.0);
        let mut flex_words = Vec::new();
        for w in ["we", "are", "creating", "the"] {
            let span = d.add(Some(h), "span");
            d.set_styles(span, &[("display", "block"), ("transitionProperty", "color"), ("transitionDuration", "0.3s")]);
            d.set_attr(span, "style", "display: inline-block; color: rgb(172, 176, 207); will-change: color; transition: color 0.3s;");
            d.add_text(span, w);
            flex_words.push(span);
            let gap = d.add(Some(h), "span");
            d.set_style(gap, "display", "block");
            d.set_attr(gap, "style", "display: inline-block; width: 0.3em;");
        }
        assert!(colour_mid_reveal(&d, flex_words[0]));
        // Blocks stacked in a block parent are not a word run.
        d.set_style(h, "display", "block");
        assert!(!colour_mid_reveal(&d, flex_words[0]));

        // clipto.com's chips: the selected one styled inline with its fill.
        let row = d.add(Some(body), "div");
        d.set_style(row, "display", "flex");
        let mut chips = Vec::new();
        for _ in 0..4 {
            let chip = d.add(Some(row), "button");
            d.set_styles(chip, &[("display", "inline-flex"), ("transitionProperty", "all"), ("transitionDuration", "0.15s")]);
            d.set_attr(chip, "style", "background-color: #D97757; color: #FFFFFF;");
            chips.push(chip);
        }
        assert!(!colour_mid_reveal(&d, chips[0]));
        for &c in &chips {
            d.set_style(c, "display", "inline");
        }
        assert!(!colour_mid_reveal(&d, chips[0]));
    }

    /// Copy an editor coloured by hand under a theme's colour transition is
    /// at rest: a reveal wraps every word it lights, so bare words beside the
    /// coloured ones, or whole words where the grandparent path wants
    /// letters, are prose.
    #[test]
    fn editor_coloured_copy_under_a_transition_is_at_rest() {
        let (mut d, body) = page();
        let inline_word = |d: &mut FakeDom, parent: ElId, tag: &str, text: &str| {
            let w = d.add(Some(parent), tag);
            d.set_styles(w, &[("display", "inline"), ("transitionProperty", "all"), ("transitionDuration", "0.3s")]);
            d.set_attr(w, "style", "color: #b0b0b0;");
            d.add_text(w, text);
            w
        };

        // A footer list: each link alone in its item, whole words under the ul.
        let ul = d.add(Some(body), "ul");
        let mut links = Vec::new();
        for text in ["About us", "Careers", "Press", "Contact"] {
            let li = d.add(Some(ul), "li");
            links.push(inline_word(&mut d, li, "a", text));
        }
        assert!(!colour_mid_reveal(&d, links[0]));

        // Three paragraphs, one editor-coloured link each.
        let article = d.add(Some(body), "div");
        let mut para_links = Vec::new();
        for text in ["one link", "another link", "a third link"] {
            let p = d.add(Some(article), "p");
            d.add_text(p, "Some copy with ");
            para_links.push(inline_word(&mut d, p, "a", text));
            d.add_text(p, " inside.");
        }
        assert!(!colour_mid_reveal(&d, para_links[0]));

        // TinyMCE runs in a sentence that also carries bare words.
        let p = d.add(Some(body), "p");
        d.add_text(p, "Shipping is free ");
        let runs: Vec<ElId> = ["on orders", "within the EU", "three to five days"]
            .into_iter()
            .map(|t| inline_word(&mut d, p, "span", t))
            .collect();
        d.add_text(p, " in most regions.");
        assert!(!colour_mid_reveal(&d, runs[0]));

        // The same runs with every word wrapped are a reveal.
        let q = d.add(Some(body), "p");
        let wrapped: Vec<ElId> = ["on", "orders", "within"].into_iter().map(|t| inline_word(&mut d, q, "span", t)).collect();
        assert!(colour_mid_reveal(&d, wrapped[0]));
        // A word nested one level down is not a letter.
        let r = d.add(Some(body), "p");
        let mut nested = Vec::new();
        for t in ["on", "orders", "within"] {
            let holder = d.add(Some(r), "span");
            nested.push(inline_word(&mut d, holder, "span", t));
        }
        assert!(!colour_mid_reveal(&d, nested[0]));
    }

    #[test]
    fn a_plain_paragraph_is_painted() {
        let (mut d, body) = page();
        let p = d.add(Some(body), "p");
        d.set_rect(p, 40.0, 100.0, 400.0, 60.0);
        assert_eq!(why(&d, p), None);
        assert!(painted_at_capture(&d, p));
    }

    #[test]
    fn hidden_and_undisplayed_elements_are_not_rendered() {
        let (mut d, body) = page();
        let p = d.add(Some(body), "p");
        d.set_rect(p, 40.0, 100.0, 400.0, 60.0);
        d.el_mut(p).check_visibility = Some(false);
        assert_eq!(why(&d, p), Some(Unpainted::NotRendered));

        let menu = d.add(Some(body), "div");
        d.set_style(menu, "display", "none");
        let a = d.add(Some(menu), "a");
        assert_eq!(why(&d, a), Some(Unpainted::NotRendered));

        let q = d.add(Some(body), "p");
        d.set_style(q, "visibility", "hidden");
        assert_eq!(why(&d, q), Some(Unpainted::NotRendered));
    }

    #[test]
    fn a_demo_step_that_has_not_played_is_transparent() {
        let (mut d, body) = page();
        let step = d.add(Some(body), "div");
        d.set_styles(step, &[("opacity", "0"), ("transitionProperty", "opacity, transform"), ("transitionDuration", "0.45s, 0.45s")]);
        d.set_rect(step, 100.0, 1500.0, 339.0, 260.0);
        let label = d.add(Some(step), "span");
        d.set_rect(label, 350.0, 1530.0, 72.0, 16.0);
        assert_eq!(why(&d, label), Some(Unpainted::Transparent));
    }

    #[test]
    fn a_collapsed_submenu_clips_its_items() {
        let (mut d, body) = page();
        let li = d.add(Some(body), "li");
        d.set_rect(li, 0.0, 60.0, 390.0, 40.0);
        // max-height: 0 panel under the item.
        let sub = d.add(Some(li), "ul");
        d.set_styles(sub, &[("overflow", "hidden"), ("overflowX", "hidden"), ("overflowY", "hidden")]);
        d.set_rect(sub, 0.0, 100.0, 390.0, 0.0);
        let p = d.add(Some(sub), "p");
        d.set_rect(p, 16.0, 100.0, 358.0, 54.0);
        assert_eq!(why(&d, p), Some(Unpainted::ClippedOut));

        // The adm.com shape: an absolute scroller at zero width.
        let side = d.add(Some(body), "ul");
        d.set_styles(side, &[("position", "absolute"), ("overflowX", "scroll"), ("overflowY", "scroll")]);
        d.set_rect(side, 0.0, 73.0, 0.0, 771.0);
        let item = d.add(Some(side), "li");
        let copy = d.add(Some(item), "p");
        d.set_rect(copy, 66.0, 268.0, 65.0, 378.0);
        assert_eq!(why(&d, copy), Some(Unpainted::ClippedOut));
    }

    #[test]
    fn a_zero_size_wrapper_that_hides_overflow_shows_nothing() {
        let (mut d, body) = page();
        let wrap = d.add(Some(body), "div");
        d.set_styles(wrap, &[("overflowX", "hidden"), ("overflowY", "hidden")]);
        d.set_rect(wrap, 40.0, 300.0, 0.0, 0.0);
        let p = d.add(Some(wrap), "p");
        d.set_rect(p, 40.0, 300.0, 400.0, 60.0);
        assert_eq!(why(&d, p), Some(Unpainted::ClippedOut));
    }

    #[test]
    fn a_horizontal_scroller_hides_cells_past_its_edge() {
        let (mut d, body) = page();
        let scroller = d.add(Some(body), "div");
        d.set_styles(scroller, &[("overflowX", "auto"), ("overflowY", "hidden")]);
        d.set_rect(scroller, 40.0, 600.0, 310.0, 330.0);
        let track = d.add(Some(scroller), "div");
        d.set_rect(track, 40.0, 600.0, 640.0, 330.0);
        let first = d.add(Some(track), "div");
        d.set_rect(first, 40.0, 600.0, 193.0, 62.0);
        let third = d.add(Some(track), "div");
        d.set_rect(third, 382.0, 600.0, 148.0, 62.0);
        let peeking = d.add(Some(track), "div");
        d.set_rect(peeking, 233.0, 600.0, 148.0, 62.0);
        assert_eq!(why(&d, first), None);
        assert_eq!(why(&d, peeking), None);
        assert_eq!(why(&d, third), Some(Unpainted::ClippedOut));
    }

    #[test]
    fn a_vertical_scroll_container_keeps_content_below_its_fold() {
        let (mut d, body) = page();
        let shell = d.add(Some(body), "main");
        d.set_styles(shell, &[("overflowX", "hidden"), ("overflowY", "auto")]);
        d.set_rect(shell, 0.0, 0.0, 1280.0, 800.0);
        let p = d.add(Some(shell), "p");
        d.set_rect(p, 40.0, 2400.0, 600.0, 80.0);
        assert_eq!(why(&d, p), None);
    }

    /// The Tailwind shell: `h-screen flex overflow-hidden` around a `main`
    /// that scrolls. What lies below main's fold is reached by scrolling main,
    /// so the wrapper above it hides only what it hides of main.
    #[test]
    fn an_app_shell_keeps_what_its_inner_scroller_reaches() {
        let (mut d, body) = page();
        let shell = d.add(Some(body), "div");
        d.set_styles(shell, &[("display", "flex"), ("overflowX", "hidden"), ("overflowY", "hidden")]);
        d.set_rect(shell, 0.0, 0.0, 1280.0, 800.0);
        let main = d.add(Some(shell), "main");
        d.set_styles(main, &[("display", "block"), ("overflowX", "auto"), ("overflowY", "auto")]);
        d.set_rect(main, 240.0, 0.0, 1040.0, 800.0);
        d.el_mut(main).client_width = 1040.0;
        d.el_mut(main).scroll_width = 1040.0;
        d.el_mut(main).client_height = 800.0;
        d.el_mut(main).scroll_height = Some(3200.0);
        let below = d.add(Some(main), "p");
        d.set_rect(below, 264.0, 2400.0, 640.0, 60.0);
        assert_eq!(why(&d, below), None);

        // A capture without scrollHeight keeps it too.
        d.el_mut(main).scroll_height = None;
        assert_eq!(why(&d, below), None);

        // When main has nothing to scroll (its height chain is broken, so it
        // is as tall as its content), a wrapper shorter than the viewport
        // hides what lies below it.
        d.set_rect(main, 240.0, 0.0, 1040.0, 3200.0);
        d.el_mut(main).client_height = 3200.0;
        d.el_mut(main).scroll_height = Some(3200.0);
        d.set_rect(shell, 0.0, 0.0, 1280.0, 600.0);
        d.el_mut(shell).client_height = 600.0;
        d.el_mut(shell).scroll_height = Some(3200.0);
        assert_eq!(why(&d, below), Some(Unpainted::ClippedOut));

        // A wrapper as tall as the viewport whose content runs past it is
        // the shape a smooth-scroll library scrolls by script, so the same
        // content is kept.
        d.set_rect(shell, 0.0, 0.0, 1280.0, 800.0);
        d.el_mut(shell).client_height = 800.0;
        assert_eq!(why(&d, below), None);
    }

    /// smooth-scrollbar and Locomotive Scroll: a viewport-tall wrapper that
    /// hides overflow, not fixed, around content moved by transforms.
    #[test]
    fn a_viewport_tall_frame_keeps_content_below_its_fold() {
        let (mut d, body) = page();
        let frame = d.add(Some(body), "div");
        d.set_styles(frame, &[("display", "block"), ("overflowX", "hidden"), ("overflowY", "hidden")]);
        d.set_rect(frame, 0.0, 0.0, 1280.0, 800.0);
        d.el_mut(frame).client_height = 800.0;
        d.el_mut(frame).scroll_height = Some(2000.0);
        let content = d.add(Some(frame), "div");
        d.set_style(content, "transform", "matrix(1, 0, 0, 1, 0, 0)");
        d.set_rect(content, 0.0, 0.0, 1280.0, 2000.0);
        let below = d.add(Some(content), "p");
        d.set_rect(below, 40.0, 1800.0, 600.0, 40.0);
        assert_eq!(why(&d, below), None);

        // An unrecorded scrollHeight keeps it too.
        d.el_mut(frame).scroll_height = None;
        assert_eq!(why(&d, below), None);

        // The root's layout height is the fold when it is shorter than the
        // window (a horizontal scrollbar takes the rest).
        let root = d.document_element.unwrap();
        d.el_mut(root).client_height = 785.0;
        d.set_rect(frame, 0.0, 0.0, 1280.0, 785.0);
        assert_eq!(why(&d, below), None);

        // Content above the frame's top edge is not what scrolling reaches.
        let above = d.add(Some(content), "p");
        d.set_rect(above, 40.0, -400.0, 600.0, 40.0);
        assert_eq!(why(&d, above), Some(Unpainted::ClippedOut));

        // A frame whose content does not run past it holds nothing below it.
        d.el_mut(frame).scroll_height = Some(785.0);
        d.el_mut(frame).client_height = 785.0;
        assert_eq!(why(&d, below), Some(Unpainted::ClippedOut));

        // Nor does a frame shorter than the fold: an accordion panel or a
        // collapsed menu at a fixed height.
        d.el_mut(frame).scroll_height = Some(2000.0);
        d.set_rect(frame, 0.0, 0.0, 1280.0, 400.0);
        d.el_mut(frame).client_height = 400.0;
        assert_eq!(why(&d, below), Some(Unpainted::ClippedOut));

        // The x axis still clips past a viewport-tall frame's edge.
        d.set_rect(frame, 0.0, 0.0, 1280.0, 800.0);
        d.el_mut(frame).client_height = 800.0;
        d.el_mut(root).client_height = 0.0;
        let right = d.add(Some(content), "p");
        d.set_rect(right, 1400.0, 200.0, 300.0, 40.0);
        assert_eq!(why(&d, right), Some(Unpainted::ClippedOut));
    }

    #[test]
    fn a_root_scroller_under_a_hidden_page_keeps_its_content() {
        let (mut d, body) = page();
        let html = d.document_element.unwrap();
        for el in [html, body] {
            d.set_styles(el, &[("overflowX", "hidden"), ("overflowY", "hidden")]);
            d.set_rect(el, 0.0, 0.0, 1280.0, 800.0);
        }
        let root = d.add(Some(body), "div");
        d.set_styles(root, &[("display", "block"), ("overflowX", "hidden"), ("overflowY", "auto")]);
        d.set_rect(root, 0.0, 0.0, 1280.0, 800.0);
        d.el_mut(root).client_height = 800.0;
        d.el_mut(root).scroll_height = Some(5000.0);
        let p = d.add(Some(root), "p");
        d.set_rect(p, 40.0, 4200.0, 640.0, 60.0);
        assert_eq!(why(&d, p), None);
    }

    #[test]
    fn a_scroller_wider_than_its_frame_keeps_what_it_scrolls_into_view() {
        let (mut d, body) = page();
        let frame = d.add(Some(body), "div");
        d.set_styles(frame, &[("display", "block"), ("overflowX", "hidden"), ("overflowY", "hidden")]);
        d.set_rect(frame, 40.0, 600.0, 600.0, 300.0);
        let scroller = d.add(Some(frame), "div");
        d.set_styles(scroller, &[("display", "block"), ("overflowX", "auto"), ("overflowY", "hidden")]);
        d.set_rect(scroller, 40.0, 600.0, 900.0, 300.0);
        d.el_mut(scroller).client_width = 900.0;
        d.el_mut(scroller).scroll_width = 2400.0;
        // Inside the scroller's box, past the frame's edge: scrolling the
        // scroller brings it under the frame.
        let cell = d.add(Some(scroller), "div");
        d.set_rect(cell, 700.0, 600.0, 200.0, 100.0);
        assert_eq!(why(&d, cell), None);
        // Past the scroller's own edge at rest: dropped, as before.
        let past = d.add(Some(scroller), "div");
        d.set_rect(past, 1200.0, 600.0, 200.0, 100.0);
        assert_eq!(why(&d, past), Some(Unpainted::ClippedOut));
        // A scroller with nothing to scroll shows under the frame only what
        // already sits there.
        d.el_mut(scroller).scroll_width = 900.0;
        assert_eq!(why(&d, cell), Some(Unpainted::ClippedOut));
    }

    #[test]
    fn a_smooth_scroll_viewport_keeps_content_below_its_fold() {
        let (mut d, body) = page();
        let wrapper = d.add(Some(body), "div");
        d.set_styles(wrapper, &[("position", "fixed"), ("overflowX", "hidden"), ("overflowY", "hidden")]);
        d.set_rect(wrapper, 0.0, 0.0, 1280.0, 800.0);
        let content = d.add(Some(wrapper), "div");
        d.set_style(content, "transform", "matrix(1, 0, 0, 1, 0, 0)");
        d.set_rect(content, 0.0, 0.0, 1280.0, 6000.0);
        let p = d.add(Some(content), "p");
        d.set_rect(p, 40.0, 2400.0, 600.0, 80.0);
        assert_eq!(why(&d, p), None);
    }

    #[test]
    fn page_level_overflow_does_not_clip_the_fold() {
        let (mut d, body) = page();
        d.set_styles(body, &[("overflowX", "hidden"), ("overflowY", "hidden")]);
        d.set_rect(body, 0.0, 0.0, 1280.0, 800.0);
        let p = d.add(Some(body), "p");
        d.set_rect(p, 40.0, 2400.0, 600.0, 80.0);
        assert_eq!(why(&d, p), None);
    }

    #[test]
    fn an_absolute_popover_escapes_a_clip_below_its_containing_block() {
        let (mut d, body) = page();
        let card = d.add(Some(body), "div");
        d.set_style(card, "position", "relative");
        d.set_rect(card, 40.0, 100.0, 400.0, 300.0);
        let strip = d.add(Some(card), "div");
        d.set_styles(strip, &[("overflowX", "hidden"), ("overflowY", "hidden")]);
        d.set_rect(strip, 40.0, 100.0, 400.0, 40.0);
        let pop = d.add(Some(strip), "div");
        d.set_style(pop, "position", "absolute");
        d.set_rect(pop, 40.0, 160.0, 200.0, 80.0);
        let link = d.add(Some(pop), "a");
        d.set_rect(link, 48.0, 168.0, 80.0, 14.0);
        assert_eq!(why(&d, link), None);

        // Once the clipping strip is itself the containing block, it clips.
        d.set_style(strip, "position", "relative");
        assert_eq!(why(&d, link), Some(Unpainted::ClippedOut));
    }

    #[test]
    fn content_outside_the_document_is_not_painted() {
        let (mut d, body) = page();
        let slide = d.add(Some(body), "div");
        d.set_rect(slide, -5275.0, 3200.0, 580.0, 326.0);
        assert_eq!(why(&d, slide), Some(Unpainted::OutsideDocument));
        let past = d.add(Some(body), "div");
        d.set_rect(past, 1300.0, 3200.0, 580.0, 326.0);
        assert_eq!(why(&d, past), Some(Unpainted::OutsideDocument));
        let edge = d.add(Some(body), "div");
        d.set_rect(edge, -66.0, 560.0, 70.0, 20.0);
        assert_eq!(why(&d, edge), None);

        // Right to left, the document extends past the left edge instead.
        let root = d.document_element.unwrap();
        d.set_style(root, "direction", "rtl");
        d.el_mut(root).scroll_width = 2560.0;
        let before = d.add(Some(body), "div");
        d.set_rect(before, -800.0, 3200.0, 580.0, 326.0);
        assert_eq!(why(&d, before), None);
    }

    /// review of #941: a box moved below the document's scroll height can
    /// never be scrolled to.
    #[test]
    fn content_below_the_document_is_not_painted() {
        let (mut d, body) = page();
        let root = d.document_element.unwrap();
        let below = d.add(Some(body), "div");
        d.set_rect(below, 40.0, 4100.0, 580.0, 326.0);
        // An unmeasured height knows nothing below the fold.
        assert_eq!(why(&d, below), None);
        d.el_mut(root).scroll_height = Some(4000.0);
        assert_eq!(why(&d, below), Some(Unpainted::OutsideDocument));
        let last = d.add(Some(body), "div");
        d.set_rect(last, 40.0, 3900.0, 580.0, 326.0);
        assert_eq!(why(&d, last), None, "runs past the end but starts on the page");

        // A body that scrolls under a root held at the viewport's height
        // reaches as far as the body does.
        d.el_mut(root).scroll_height = Some(800.0);
        d.el_mut(body).scroll_height = Some(4500.0);
        assert_eq!(why(&d, below), None);

        // So does a scroller inside the page: its box is what the document
        // has to reach.
        d.el_mut(body).scroll_height = Some(4000.0);
        d.el_mut(root).scroll_height = Some(4000.0);
        let frame = d.add(Some(body), "div");
        d.set_styles(frame, &[("display", "block"), ("overflowX", "hidden"), ("overflowY", "auto")]);
        d.set_rect(frame, 0.0, 3600.0, 1280.0, 400.0);
        d.el_mut(frame).client_height = 400.0;
        d.el_mut(frame).scroll_height = Some(1200.0);
        let row = d.add(Some(frame), "p");
        d.set_rect(row, 40.0, 4300.0, 640.0, 40.0);
        assert_eq!(why(&d, row), None);
    }

    #[test]
    fn a_fixed_drawer_off_the_viewport_is_not_painted() {
        let (mut d, body) = page();
        let drawer = d.add(Some(body), "aside");
        d.set_style(drawer, "position", "fixed");
        d.set_rect(drawer, 1280.0, 0.0, 320.0, 800.0);
        let link = d.add(Some(drawer), "a");
        d.set_rect(link, 1296.0, 40.0, 120.0, 16.0);
        assert_eq!(why(&d, link), Some(Unpainted::OutsideDocument));

        d.set_rect(drawer, 960.0, 0.0, 320.0, 800.0);
        d.set_rect(link, 976.0, 40.0, 120.0, 16.0);
        assert_eq!(why(&d, link), None);
    }

    /// A fixed badge inside a container that is its containing block sits
    /// against that container, far down the page, not against the viewport.
    #[test]
    fn a_fixed_element_inside_a_containing_block_is_not_a_viewport_layer() {
        let triggers: &[(&str, &str)] = &[
            ("transform", "matrix(1, 0, 0, 1, 0, 0)"),
            ("filter", "blur(1px)"),
            ("willChange", "transform"),
            ("willChange", "opacity, filter"),
            ("contain", "paint"),
            ("contain", "layout"),
            ("contain", "strict"),
            ("translate", "0px"),
            ("scale", "1"),
            ("rotate", "0deg"),
            ("perspective", "800px"),
            ("backdropFilter", "blur(4px)"),
        ];
        for (prop, value) in triggers {
            let (mut d, body) = page();
            let container = d.add(Some(body), "div");
            resolved(&mut d, container);
            d.set_styles(container, &[("position", "relative")]);
            d.set_rect(container, 40.0, 2000.0, 400.0, 400.0);
            let badge = d.add(Some(container), "a");
            d.set_style(badge, "position", "fixed");
            d.set_rect(badge, 60.0, 2020.0, 120.0, 14.0);
            // No trigger: a viewport layer parked below the viewport.
            assert_eq!(why(&d, badge), Some(Unpainted::OutsideDocument), "without {prop}");
            d.set_style(container, prop, value);
            assert_eq!(why(&d, badge), None, "{prop}: {value}");
        }

        // `will-change` naming something else and `contain: size` or
        // `contain: style` do not contain it.
        for (prop, value) in [("willChange", "opacity"), ("contain", "size"), ("contain", "style")] {
            let (mut d, body) = page();
            let container = d.add(Some(body), "div");
            resolved(&mut d, container);
            d.set_style(container, prop, value);
            d.set_rect(container, 40.0, 2000.0, 400.0, 400.0);
            let badge = d.add(Some(container), "a");
            d.set_style(badge, "position", "fixed");
            d.set_rect(badge, 60.0, 2020.0, 120.0, 14.0);
            assert_eq!(why(&d, badge), Some(Unpainted::OutsideDocument), "{prop}: {value}");
        }
    }

    /// A recording made before the capture read `will-change`, `contain` and
    /// the individual transforms cannot rule them out, so the badge is kept.
    #[test]
    fn an_undecided_containing_block_keeps_a_fixed_element() {
        let (mut d, body) = page();
        let container = d.add(Some(body), "div");
        d.set_styles(container, &[("transform", "none"), ("filter", "none"), ("backdropFilter", "none")]);
        d.set_rect(container, 40.0, 2000.0, 400.0, 400.0);
        let badge = d.add(Some(container), "a");
        d.set_style(badge, "position", "fixed");
        d.set_rect(badge, 60.0, 2020.0, 120.0, 14.0);
        assert_eq!(why(&d, badge), None);

        // An undecided ancestor also never makes an absolute box clip sooner.
        let strip = d.add(Some(body), "div");
        d.set_styles(strip, &[("overflowX", "hidden"), ("overflowY", "hidden")]);
        d.set_rect(strip, 40.0, 100.0, 400.0, 40.0);
        let pop = d.add(Some(strip), "div");
        d.set_style(pop, "position", "absolute");
        d.set_rect(pop, 40.0, 160.0, 200.0, 80.0);
        assert_eq!(why(&d, pop), None);
    }

    #[test]
    fn a_crossfade_layer_is_a_state_for_the_raster_rule() {
        let (mut d, body) = page();
        let stack = d.add(Some(body), "div");
        d.set_style(stack, "position", "relative");
        d.set_rect(stack, 40.0, 400.0, 320.0, 200.0);
        let active = d.add(Some(stack), "img");
        d.set_styles(active, &[("position", "absolute"), ("opacity", "1")]);
        d.set_rect(active, 40.0, 400.0, 320.0, 200.0);
        let poster = d.add(Some(stack), "img");
        d.set_styles(poster, &[("position", "absolute"), ("opacity", "0"), ("transitionProperty", "opacity"), ("transitionDuration", "120ms")]);
        d.set_rect(poster, 40.0, 400.0, 320.0, 200.0);
        assert_eq!(raster(&d, poster), Some(Unpainted::StateLayer));

        let all = d.add(Some(stack), "img");
        d.set_styles(all, &[("opacity", "0"), ("transitionProperty", "all"), ("transitionDuration", "0.1s")]);
        d.set_rect(all, 40.0, 400.0, 320.0, 200.0);
        assert_eq!(raster(&d, all), Some(Unpainted::StateLayer));

        // A raster held near zero with nothing moving it is what the rule is for.
        let buried = d.add(Some(body), "img");
        d.set_styles(buried, &[("opacity", "0.05"), ("transitionProperty", "all"), ("transitionDuration", "0s")]);
        d.set_rect(buried, 40.0, 700.0, 320.0, 200.0);
        assert_eq!(raster(&d, buried), None);

        // An animation that moves opacity marks a slideshow layer; one that
        // only moves transform does not.
        let slide = d.add(Some(stack), "div");
        d.set_styles(slide, &[("opacity", "0"), ("animationName", "trophy-fade"), ("backgroundImage", "url(a.png)")]);
        d.set_rect(slide, 40.0, 400.0, 320.0, 200.0);
        d.keyframes.insert(
            "trophy-fade".to_string(),
            vec![crate::browser::dom::KeyframeFrame { decls: vec![("opacity".to_string(), "1".to_string())] }],
        );
        assert_eq!(raster(&d, slide), Some(Unpainted::StateLayer));
        d.keyframes.insert(
            "trophy-fade".to_string(),
            vec![crate::browser::dom::KeyframeFrame { decls: vec![("transform".to_string(), "none".to_string())] }],
        );
        assert_eq!(raster(&d, slide), None);

        // A raster inside a transparent layer is not painted either way.
        let hidden_stack = d.add(Some(body), "div");
        d.set_style(hidden_stack, "opacity", "0");
        let inner = d.add(Some(hidden_stack), "img");
        d.set_style(inner, "opacity", "0.05");
        assert_eq!(raster(&d, inner), Some(Unpainted::Transparent));
    }

    const TAILWIND_TRANSITION: &[(&str, &str)] = &[
        ("transitionProperty", "color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter, backdrop-filter"),
        ("transitionDuration", "0.15s"),
    ];

    /// fischundfang.de (findings 218782, 218787, 219211, 219393, 220983,
    /// 221026): tagDiv Newspaper holds each thumbnail at opacity 0 under
    /// `td-animation-stack-type0-1` and swaps the class for `-type0-2`, which
    /// fades it in, as its reveal queue reaches the image.
    #[test]
    fn an_image_waiting_for_a_class_swap_is_a_state_layer() {
        let (mut d, body) = page();
        let thumb = |d: &mut FakeDom, y: f64, class: &str, opacity: &str| {
            let img = d.add(Some(body), "img");
            d.set_rect(img, 106.0, y, 324.0, 235.0);
            if !class.is_empty() {
                d.set_attr(img, "class", class);
            }
            d.set_attr(img, "src", "/thumb.jpg");
            d.set_styles(img, &[("opacity", opacity), ("transitionProperty", "all"), ("transitionDuration", "0s")]);
            img
        };
        let fades = |d: &mut FakeDom, img: ElId| {
            d.set_styles(img, &[("transitionProperty", "opacity"), ("transitionDuration", "0.3s")]);
        };
        let waiting = thumb(&mut d, 2793.0, "entry-thumb td-animation-stack-type0-1", "0");
        assert_eq!(raster(&d, waiting), None, "no image on the page has been revealed");

        // One revealed peer is not enough; two are.
        let first = thumb(&mut d, 400.0, "entry-thumb td-animation-stack-type0-2", "1");
        fades(&mut d, first);
        assert_eq!(raster(&d, waiting), None);
        let second = thumb(&mut d, 800.0, "entry-thumb td-animation-stack-type0-2", "0.82");
        fades(&mut d, second);
        assert_eq!(raster(&d, waiting), Some(Unpainted::StateLayer));

        // A class added on reveal, rather than swapped.
        let (mut d, body) = page();
        let _ = body;
        let waiting = thumb(&mut d, 2793.0, "photo fade", "0");
        for y in [400.0, 800.0] {
            let shown = thumb(&mut d, y, "photo fade in", "1");
            fades(&mut d, shown);
        }
        assert_eq!(raster(&d, waiting), Some(Unpainted::StateLayer));

        // An image held at a faint value is not at the start of a fade.
        d.set_style(waiting, "opacity", "0.08");
        assert_eq!(raster(&d, waiting), None);
        d.set_style(waiting, "opacity", "0");

        // Peers that do not fade, are not shown, share no class, or differ by
        // more than the one token are not evidence.
        let (mut d, _body) = page();
        let waiting = thumb(&mut d, 2793.0, "entry-thumb stack-1", "0");
        thumb(&mut d, 300.0, "entry-thumb stack-2", "1");
        thumb(&mut d, 400.0, "entry-thumb stack-2", "1");
        for y in [500.0, 600.0] {
            let hidden = thumb(&mut d, y, "entry-thumb stack-2", "0.2");
            fades(&mut d, hidden);
        }
        for y in [700.0, 800.0] {
            let other = thumb(&mut d, y, "logo shown", "1");
            fades(&mut d, other);
        }
        for y in [900.0, 1000.0] {
            let far = thumb(&mut d, y, "entry-thumb wide stack-2", "1");
            fades(&mut d, far);
        }
        assert_eq!(raster(&d, waiting), None);

        // An image with no class has no swap to wait for.
        let (mut d, _body) = page();
        let bare = thumb(&mut d, 2793.0, "", "0");
        for y in [400.0, 800.0] {
            let shown = thumb(&mut d, y, "loaded", "1");
            fades(&mut d, shown);
        }
        assert_eq!(raster(&d, bare), None);
    }

    /// fischundfang.de 219211: an image at 0.105 with the fade running on it.
    #[test]
    fn a_fade_running_on_an_image_is_a_state_layer() {
        let (mut d, body) = page();
        let img = d.add(Some(body), "img");
        d.set_rect(img, 478.0, 600.0, 324.0, 235.0);
        d.set_styles(img, &[("opacity", "0.105372"), ("transitionProperty", "opacity"), ("transitionDuration", "0.3s")]);
        assert_eq!(raster(&d, img), None, "a probe that read no animations");
        d.set_running_animations(img, &[]);
        assert_eq!(raster(&d, img), None, "nothing running: held at a faint value");
        d.set_running_animations(img, &["transform"]);
        assert_eq!(raster(&d, img), None);
        d.set_running_animations(img, &["opacity"]);
        assert_eq!(raster(&d, img), Some(Unpainted::StateLayer));
    }

    /// sona8.com: `animation-timeline: view()` holds every block below the
    /// fold at its first keyframe while the page sits at the top.
    #[test]
    fn a_scroll_timeline_holding_opacity_is_recognised() {
        let css = ".has-reveal [data-cascade] > * { animation-name: lab-scrub-rise; animation-timeline: view(); }\n\
.has-reveal .timed > * { animation-name: lab-rise; animation-timeline: auto; }\n\
.has-reveal .rail { animation-name: lab-rail; animation-timeline: --lab-rail; }";
        let (mut d, body) = page();
        let fade = || vec![crate::browser::dom::KeyframeFrame { decls: vec![("opacity".to_string(), "0".to_string())] }];
        d.keyframes.insert("lab-scrub-rise".to_string(), fade());
        d.keyframes.insert("lab-rise".to_string(), fade());
        d.keyframes.insert("lab-rail".to_string(), fade());
        d.keyframes.insert(
            "lab-grow".to_string(),
            vec![crate::browser::dom::KeyframeFrame { decls: vec![("transform".to_string(), "none".to_string())] }],
        );
        let block = d.add(Some(body), "div");
        d.set_styles(block, &[("opacity", "0"), ("animationName", "lab-scrub-rise")]);
        d.add_selector(block, ".has-reveal [data-cascade] > *");
        assert!(!opacity_held_by_scroll_timeline(&d, block, css), "a probe that read no animations");
        d.set_running_animations(block, &["opacity", "transform"]);
        assert!(opacity_held_by_scroll_timeline(&d, block, css));
        d.set_running_animations(block, &["transform"]);
        assert!(!opacity_held_by_scroll_timeline(&d, block, css), "the running animation moves no opacity");
        d.set_running_animations(block, &["opacity"]);
        d.set_style(block, "animationName", "lab-grow");
        assert!(!opacity_held_by_scroll_timeline(&d, block, css), "its keyframes set no opacity");
        d.set_style(block, "animationName", "none");
        assert!(!opacity_held_by_scroll_timeline(&d, block, css), "a transition, not an animation");

        // A named timeline counts; the document timeline does not.
        let rail = d.add(Some(body), "div");
        d.set_styles(rail, &[("opacity", "0"), ("animationName", "lab-rail")]);
        d.set_running_animations(rail, &["opacity"]);
        d.add_selector(rail, ".has-reveal .rail");
        assert!(opacity_held_by_scroll_timeline(&d, rail, css));
        let timed = d.add(Some(body), "div");
        d.set_styles(timed, &[("opacity", "0"), ("animationName", "lab-rise")]);
        d.set_running_animations(timed, &["opacity"]);
        d.add_selector(timed, ".has-reveal .timed > *");
        assert!(!opacity_held_by_scroll_timeline(&d, timed, css));
        assert!(!opacity_held_by_scroll_timeline(&d, timed, ""), "no rule to read");

        // With the computed timeline recorded, the cascade's answer decides:
        // a later rule's `auto` wins over the stylesheet's `view()`.
        d.set_style(block, "animationName", "lab-scrub-rise");
        d.set_running_animations(block, &["opacity"]);
        d.set_style(block, "animationTimeline", "auto");
        assert!(!opacity_held_by_scroll_timeline(&d, block, css), "the timeline was overridden");
        d.set_style(block, "animationTimeline", "view()");
        assert!(opacity_held_by_scroll_timeline(&d, block, css));
        // A view() timeline on a transform animation beside a document-
        // timeline fade does not hold the fade.
        d.set_style(block, "animationName", "lab-grow, lab-rise");
        d.set_style(block, "animationTimeline", "view(), auto");
        assert!(!opacity_held_by_scroll_timeline(&d, block, css), "the fade runs on the document timeline");
        d.set_style(block, "animationName", "lab-rise, lab-grow");
        d.set_style(block, "animationTimeline", "view()");
        assert!(opacity_held_by_scroll_timeline(&d, block, css), "one timeline repeats for every name");
    }

    /// directus.io: a closed FAQ row hides its overflow at 76px and parks the
    /// answer, absolutely positioned at opacity 0, below it.
    #[test]
    fn a_box_parked_outside_its_clip_is_recognised() {
        let (mut d, body) = page();
        let row = d.add(Some(body), "div");
        resolved(&mut d, row);
        d.set_styles(row, &[("display", "flex"), ("position", "relative"), ("overflowX", "hidden"), ("overflowY", "hidden")]);
        d.set_rect(row, 108.0, 3617.0, 1064.0, 76.0);
        let answer = d.add(Some(row), "div");
        resolved(&mut d, answer);
        d.set_styles(answer, &[("display", "flex"), ("position", "absolute"), ("opacity", "0")]);
        d.set_rect(answer, 132.0, 3744.0, 1016.0, 45.0);
        assert!(parked_outside_clip(&d, answer));

        // Inside the row, in flow, or with no area: not parked.
        d.set_rect(answer, 132.0, 3640.0, 1016.0, 45.0);
        assert!(!parked_outside_clip(&d, answer));
        d.set_rect(answer, 132.0, 3744.0, 1016.0, 45.0);
        d.set_style(answer, "position", "static");
        assert!(!parked_outside_clip(&d, answer));
        d.set_style(answer, "position", "absolute");
        d.set_rect(answer, 132.0, 3744.0, 1016.0, 0.0);
        assert!(!parked_outside_clip(&d, answer));
        d.set_rect(answer, 132.0, 3744.0, 1016.0, 45.0);

        // A row that does not clip, or is not the containing block.
        d.set_styles(row, &[("overflowX", "visible"), ("overflowY", "visible")]);
        assert!(!parked_outside_clip(&d, answer));
        d.set_styles(row, &[("overflowX", "hidden"), ("overflowY", "hidden"), ("position", "static")]);
        assert!(!parked_outside_clip(&d, answer));
        d.set_style(row, "position", "relative");
        assert!(parked_outside_clip(&d, answer));

        // epcco.com.sa: a slider collapsed to no height is not a closed row.
        d.set_rect(row, 108.0, 3617.0, 1064.0, 0.0);
        assert!(!parked_outside_clip(&d, answer));
    }

    /// Tailwind's `transition` utility lists `opacity` for every element that
    /// animates anything, so a declared transition alone does not make a
    /// buried image a state layer.
    #[test]
    fn a_transition_utility_alone_does_not_hide_a_buried_image() {
        let (mut d, body) = page();
        let hero = d.add(Some(body), "div");
        d.set_style(hero, "position", "relative");
        d.set_rect(hero, 0.0, 0.0, 1280.0, 480.0);
        let photo = d.add(Some(hero), "img");
        d.set_styles(photo, TAILWIND_TRANSITION);
        d.set_styles(photo, &[("position", "absolute"), ("opacity", "0.08")]);
        d.set_rect(photo, 0.0, 0.0, 1280.0, 480.0);
        let heading = d.add(Some(hero), "h1");
        d.set_rect(heading, 40.0, 200.0, 600.0, 60.0);
        assert_eq!(raster(&d, photo), None);

        // With a second marker, a transition at rest at 0 is a load or
        // crossfade state.
        d.set_style(photo, "opacity", "0");
        d.el_mut(photo).attrs.push(("loading".to_string(), "lazy".to_string()));
        assert_eq!(raster(&d, photo), Some(Unpainted::StateLayer));
        d.el_mut(photo).attrs.clear();
        d.el_mut(photo).attrs.push(("class".to_string(), "owl-lazy item-img".to_string()));
        assert_eq!(raster(&d, photo), Some(Unpainted::StateLayer));
        d.el_mut(photo).attrs.clear();
        d.el_mut(photo).attrs.push(("data-src".to_string(), "hero.jpg".to_string()));
        assert_eq!(raster(&d, photo), Some(Unpainted::StateLayer));
        d.el_mut(photo).attrs.clear();
        d.set_style(photo, "animationName", "drift");
        d.keyframes.insert(
            "drift".to_string(),
            vec![crate::browser::dom::KeyframeFrame { decls: vec![("transform".to_string(), "none".to_string())] }],
        );
        assert_eq!(raster(&d, photo), Some(Unpainted::StateLayer));
        d.set_style(photo, "animationName", "none");
        assert_eq!(raster(&d, photo), None);
        d.set_style(photo, "opacity", "0.08");

        // A small sibling raster (a logo over the hero) is not a crossfade
        // layer.
        let logo = d.add(Some(hero), "img");
        d.set_rect(logo, 40.0, 40.0, 120.0, 40.0);
        assert_eq!(raster(&d, photo), None);
    }

    /// The Next.js Image shape: lazy by default, often with Tailwind's
    /// `transition-opacity`, held at a faint value under a dark overlay. A
    /// fade starts from 0, so the markers do not make it a state layer.
    #[test]
    fn a_lazy_image_held_at_a_faint_value_is_not_a_state_layer() {
        let (mut d, body) = page();
        let hero = d.add(Some(body), "section");
        d.set_styles(hero, &[("position", "relative"), ("overflowX", "hidden"), ("overflowY", "hidden")]);
        d.set_rect(hero, 0.0, 0.0, 1280.0, 520.0);
        let photo = d.add(Some(hero), "img");
        d.set_styles(photo, &[("position", "absolute"), ("opacity", "0.1"), ("transitionProperty", "opacity"), ("transitionDuration", "0.15s")]);
        d.el_mut(photo).attrs.push(("loading".to_string(), "lazy".to_string()));
        d.el_mut(photo).attrs.push(("data-nimg".to_string(), "fill".to_string()));
        d.set_rect(photo, 0.0, 0.0, 1280.0, 520.0);
        let overlay = d.add(Some(hero), "div");
        d.set_styles(overlay, &[("position", "absolute"), ("backgroundImage", "linear-gradient(rgba(0, 0, 0, 0.6), rgba(0, 0, 0, 0.9))")]);
        d.set_rect(overlay, 0.0, 0.0, 1280.0, 520.0);
        assert_eq!(raster(&d, photo), None);

        // Tailwind's `transition` list, the same.
        d.set_styles(photo, TAILWIND_TRANSITION);
        assert_eq!(raster(&d, photo), None);

        // A crossfade sibling over the same box does not change that.
        let next = d.add(Some(hero), "img");
        d.set_rect(next, 0.0, 0.0, 1280.0, 520.0);
        assert_eq!(raster(&d, photo), None);

        // At 0, or an effective 0 through a faint parent, it is a fade.
        d.set_style(photo, "opacity", "0.02");
        assert_eq!(raster(&d, photo), Some(Unpainted::StateLayer));
        d.set_style(photo, "opacity", "0.1");
        d.set_style(hero, "opacity", "0.15");
        assert_eq!(raster(&d, photo), Some(Unpainted::StateLayer));

        // A keyframe animation that moves opacity can be caught mid-flight,
        // so it still marks a state at a faint value.
        d.set_style(hero, "opacity", "1");
        d.set_style(photo, "animationName", "pulse");
        d.keyframes.insert(
            "pulse".to_string(),
            vec![crate::browser::dom::KeyframeFrame { decls: vec![("opacity".to_string(), "0.5".to_string())] }],
        );
        assert_eq!(raster(&d, photo), Some(Unpainted::StateLayer));
    }

    /// The adant.app shape: an image poster at opacity 0 beside a wrapper that
    /// holds the playing video over the same box.
    #[test]
    fn a_poster_over_a_video_is_a_state_layer() {
        let (mut d, body) = page();
        let stack = d.add(Some(body), "div");
        d.set_style(stack, "position", "relative");
        d.set_rect(stack, 829.0, 448.0, 270.0, 428.0);
        let wrap = d.add(Some(stack), "div");
        d.set_rect(wrap, 829.0, 448.0, 270.0, 428.0);
        let video = d.add(Some(wrap), "video");
        d.set_rect(video, 829.0, 448.0, 270.0, 428.0);
        let poster = d.add(Some(stack), "img");
        d.set_styles(poster, &[("position", "absolute"), ("opacity", "0"), ("transitionProperty", "opacity"), ("transitionDuration", "0.12s")]);
        d.set_rect(poster, 829.0, 448.0, 270.0, 428.0);
        assert_eq!(raster(&d, poster), Some(Unpainted::StateLayer));

        // Moved off the video's box, the same image is reported.
        d.set_rect(video, 40.0, 1200.0, 270.0, 428.0);
        d.set_rect(wrap, 40.0, 1200.0, 270.0, 428.0);
        assert_eq!(raster(&d, poster), None);
    }

    /// video.js control text: a 1px absolute box whose clip removes it,
    /// holding labels laid out over the pixel it keeps.
    #[test]
    fn screen_reader_text_is_visually_hidden() {
        let (mut d, body) = page();
        let bar = d.add(Some(body), "div");
        d.set_style(bar, "position", "absolute");
        d.set_rect(bar, 660.0, 8071.0, 270.0, 32.0);
        let sr = d.add(Some(bar), "span");
        d.set_styles(
            sr,
            &[
                ("display", "block"),
                ("position", "absolute"),
                ("overflowX", "hidden"),
                ("overflowY", "hidden"),
                ("clip", "rect(0px, 0px, 0px, 0px)"),
                ("clipPath", "inset(50%)"),
            ],
        );
        d.set_rect(sr, 708.0, 8076.0, 1.0, 1.0);
        let label = d.add(Some(sr), "span");
        d.set_style(label, "display", "inline-block");
        d.set_rect(label, 708.0, 8076.0, 31.0, 10.0);
        d.add_text(label, "Loaded");
        assert_eq!(why(&d, label), Some(Unpainted::VisuallyHidden));
        assert_eq!(why(&d, sr), Some(Unpainted::VisuallyHidden));

        // Either clip removes it on its own.
        d.set_style(sr, "clipPath", "none");
        assert_eq!(why(&d, label), Some(Unpainted::VisuallyHidden));
        d.set_styles(sr, &[("clip", "auto"), ("clipPath", "inset(50%)")]);
        assert_eq!(why(&d, label), Some(Unpainted::VisuallyHidden));
        d.set_styles(sr, &[("clipPath", "none"), ("webkitClipPath", "inset(50%)")]);
        assert_eq!(why(&d, label), Some(Unpainted::VisuallyHidden));

        // Without a clip, the pixel the box keeps overlaps the label, and the
        // overflow test keeps it.
        d.set_style(sr, "webkitClipPath", "none");
        assert_eq!(why(&d, label), None);

        // `clip` applies only to an absolutely positioned box.
        d.set_styles(sr, &[("position", "static"), ("clip", "rect(0px, 0px, 0px, 0px)")]);
        assert_eq!(why(&d, label), None);

        // A box larger than 1px is not the utility; the clip tests decide it.
        d.set_styles(sr, &[("position", "absolute"), ("clipPath", "inset(50%)")]);
        d.set_rect(sr, 700.0, 8070.0, 60.0, 30.0);
        assert_eq!(why(&d, label), None);
    }

    /// The framer typewriter between words, and a paragraph held at no
    /// height.
    #[test]
    fn a_text_rule_needs_text_and_a_box_that_shows_it() {
        let (mut d, body) = page();
        let wrapper = d.add(Some(body), "span");
        d.set_style(wrapper, "display", "inline");
        d.set_rect(wrapper, 887.0, 6522.0, 0.0, 18.0);
        d.el_mut(wrapper).scroll_width = 0.0;
        assert_eq!(unpainted_for(&d, wrapper, PaintGate::Text), Some(Unpainted::NoText));
        // The base predicate and the other gates do not ask for text.
        assert_eq!(why(&d, wrapper), None);
        assert_eq!(unpainted_for(&d, wrapper, PaintGate::Box), Some(Unpainted::NoArea));
        let copy = d.add(Some(wrapper), "b");
        d.add_text(copy, "   ");
        assert_eq!(unpainted_for(&d, wrapper, PaintGate::Text), Some(Unpainted::NoText));
        d.add_text(copy, "Search your word");
        assert_eq!(unpainted_for(&d, wrapper, PaintGate::Text), Some(Unpainted::NoArea));
        d.set_rect(wrapper, 887.0, 6522.0, 108.0, 18.0);
        assert_eq!(unpainted_for(&d, wrapper, PaintGate::Text), None);

        // A form control paints its value or its placeholder.
        let field = d.add(Some(body), "input");
        d.set_rect(field, 40.0, 200.0, 240.0, 32.0);
        assert_eq!(unpainted_for(&d, field, PaintGate::Text), None);

        let p = d.add(Some(body), "p");
        d.add_text(p, "Collapsed answer copy");
        d.set_styles(p, &[("display", "block"), ("overflowX", "hidden"), ("overflowY", "hidden")]);
        d.set_rect(p, 40.0, 900.0, 400.0, 0.0);
        d.el_mut(p).scroll_height = Some(54.0);
        assert_eq!(unpainted_for(&d, p, PaintGate::Text), Some(Unpainted::NoArea));
        // With visible overflow its lines show past the edge.
        d.set_styles(p, &[("overflowX", "visible"), ("overflowY", "visible")]);
        assert_eq!(unpainted_for(&d, p, PaintGate::Text), None);
        // Nothing past the edge: no lines at all.
        d.el_mut(p).scroll_height = Some(0.0);
        assert_eq!(unpainted_for(&d, p, PaintGate::Text), Some(Unpainted::NoArea));
        // A metric the capture did not record keeps it.
        d.el_mut(p).scroll_height = None;
        assert_eq!(unpainted_for(&d, p, PaintGate::Text), None);

        // `display: contents` reports no box of its own and keeps its text.
        let contents = d.add(Some(body), "span");
        d.add_text(contents, "Pricing");
        d.set_style(contents, "display", "contents");
        d.set_rect(contents, 0.0, 0.0, 0.0, 0.0);
        assert_eq!(unpainted_for(&d, contents, PaintGate::Text), None);
    }

    /// The att.com tray at `max-height: 0`, the video.js volume panel and the
    /// Flowplayer seek bar: boxes a box rule (the retired `layout-transition`,
    /// when this was written) reported unpainted.
    #[test]
    fn a_box_rule_skips_boxes_that_show_nothing() {
        let (mut d, body) = page();
        let tray = d.add(Some(body), "div");
        d.set_styles(tray, &[("display", "block"), ("overflowX", "hidden"), ("overflowY", "hidden")]);
        d.set_rect(tray, 16.0, 4688.0, 1248.0, 0.0);
        d.el_mut(tray).scroll_height = Some(0.0);
        assert_eq!(unpainted_for(&d, tray, PaintGate::Box), Some(Unpainted::NoArea));
        // A zero-height box whose content shows past its edge is kept.
        d.set_styles(tray, &[("overflowX", "visible"), ("overflowY", "visible")]);
        d.el_mut(tray).scroll_height = Some(240.0);
        assert_eq!(unpainted_for(&d, tray, PaintGate::Box), None);
        // Open, it is painted.
        d.set_styles(tray, &[("overflowX", "hidden"), ("overflowY", "hidden")]);
        d.set_rect(tray, 16.0, 4688.0, 1248.0, 240.0);
        assert_eq!(unpainted_for(&d, tray, PaintGate::Box), None);

        let bar = d.add(Some(body), "div");
        d.set_style(bar, "display", "none");
        let volume = d.add(Some(bar), "div");
        d.set_styles(volume, &[("display", "flex"), ("transitionProperty", "width")]);
        d.set_rect(volume, 0.0, 0.0, 0.0, 0.0);
        assert_eq!(unpainted_for(&d, volume, PaintGate::Box), Some(Unpainted::NotRendered));

        let seek = d.add(Some(body), "div");
        d.set_styles(seek, &[("display", "block"), ("position", "absolute")]);
        d.set_rect(seek, -326.0, 1061.0, 140.0, 2.0);
        assert_eq!(unpainted_for(&d, seek, PaintGate::Box), Some(Unpainted::OutsideDocument));
    }

    #[test]
    fn unpainted_inside_leaves_the_container_clip_to_the_rule() {
        let (mut d, body) = page();
        let frame = d.add(Some(body), "div");
        d.set_styles(frame, &[("display", "block"), ("overflowX", "hidden"), ("overflowY", "hidden")]);
        d.set_rect(frame, 40.0, 300.0, 300.0, 40.0);
        let host = d.add(Some(frame), "div");
        resolved(&mut d, host);
        d.set_styles(host, &[("display", "block"), ("position", "relative"), ("overflowX", "hidden"), ("overflowY", "hidden")]);
        d.set_rect(host, 40.0, 300.0, 300.0, 40.0);
        let menu = d.add(Some(host), "div");
        d.set_style(menu, "position", "absolute");
        d.set_rect(menu, 40.0, 340.0, 200.0, 60.0);
        // The host's clip hides the menu: that is what the rule reports, and
        // the frame above repeats it.
        assert_eq!(why(&d, menu), Some(Unpainted::ClippedOut));
        assert_eq!(unpainted_inside(&d, menu, host), None);
        // Nor is the document edge: a tooltip over a header at the top of
        // the page.
        let tip = d.add(Some(host), "div");
        d.set_style(tip, "position", "absolute");
        d.set_rect(tip, 40.0, -60.0, 160.0, 30.0);
        assert_eq!(unpainted_inside(&d, tip, host), None);

        // A control bar at display none between them hides it all the same.
        let controls = d.add(Some(host), "div");
        d.set_style(controls, "display", "none");
        let rate_menu = d.add(Some(controls), "div");
        d.set_style(rate_menu, "position", "absolute");
        d.set_rect(rate_menu, 40.0, 340.0, 200.0, 60.0);
        assert_eq!(unpainted_inside(&d, rate_menu, host), Some(Unpainted::NotRendered));

        // So does transparency.
        d.set_style(menu, "opacity", "0");
        assert_eq!(unpainted_inside(&d, menu, host), Some(Unpainted::Transparent));
    }

    /// ynet.co.il: a floating player, `position: fixed`, inside a card that
    /// hides overflow.
    #[test]
    fn a_fixed_box_is_clippable_only_through_its_containing_block() {
        let (mut d, body) = page();
        let card = d.add(Some(body), "div");
        resolved(&mut d, card);
        let wrap = d.add(Some(card), "div");
        resolved(&mut d, wrap);
        let player = d.add(Some(wrap), "div");
        d.set_style(player, "position", "fixed");
        assert!(!fixed_box_clippable_by(&d, player, card));
        d.set_style(wrap, "willChange", "transform");
        assert!(fixed_box_clippable_by(&d, player, card));
        d.set_style(wrap, "willChange", "auto");
        d.set_style(card, "transform", "matrix(1, 0, 0, 1, 0, 0)");
        assert!(fixed_box_clippable_by(&d, player, card));

        // A containment the capture did not record keeps the finding.
        let (mut d, body) = page();
        let card = d.add(Some(body), "div");
        let player = d.add(Some(card), "div");
        d.set_style(player, "position", "fixed");
        assert!(fixed_box_clippable_by(&d, player, card));
    }

    #[test]
    fn retain_painted_only_touches_gated_rules() {
        let (mut d, body) = page();
        let wrap = d.add(Some(body), "div");
        d.set_styles(wrap, &[("overflowX", "hidden"), ("overflowY", "hidden")]);
        d.set_rect(wrap, 40.0, 300.0, 0.0, 0.0);
        let a = d.add(Some(wrap), "a");
        d.set_rect(a, 40.0, 300.0, 80.0, 14.0);
        d.add_text(a, "Read more");
        let mut findings = vec![
            BrowserFinding::new("undersized-ui-text", "10px functional text"),
            BrowserFinding::new("gradient-text", "gradient"),
            BrowserFinding::new("low-contrast", "2.0:1"),
            BrowserFinding::new("bounce-easing", "animation: bounce"),
            BrowserFinding::new("dark-glow", "Colored box-shadow glow (#cdaca2) on dark background"),
            BrowserFinding::new("ai-color-palette", "Purple/violet gradient background"),
            BrowserFinding::new("italic-serif-display", "italic serif h1 (playfair display) at 60px"),
            BrowserFinding::new("blinking-cursor", "i.caret — 5x10px blinking cursor"),
        ];
        findings.push(BrowserFinding::new("font-overuse-stand-in", "an ungated style tell"));
        retain_painted(&d, a, &mut findings);
        let ids: Vec<&str> = findings.iter().map(|f| f.type_.as_str()).collect();
        assert_eq!(ids, vec!["font-overuse-stand-in"]);

        // Painted, every finding stays.
        d.set_rect(wrap, 40.0, 300.0, 400.0, 40.0);
        let mut kept = vec![
            BrowserFinding::new("bounce-easing", "animation: bounce"),
            BrowserFinding::new("dark-glow", "glow"),
            BrowserFinding::new("blinking-cursor", "cursor"),
        ];
        retain_painted(&d, a, &mut kept);
        assert_eq!(kept.len(), 3);

        assert_eq!(paint_gate("content-hidden-at-rest"), None);
        assert_eq!(paint_gate("gradient-text"), Some(PaintGate::Text));
        // A retired rule is ungated like any id the engine does not report.
        assert_eq!(paint_gate("layout-transition"), None);
        assert_eq!(paint_gate("bounce-easing"), Some(PaintGate::Box));
        assert_eq!(paint_gate("dark-glow"), Some(PaintGate::Box));
        assert_eq!(paint_gate("ai-color-palette"), Some(PaintGate::Box));
        assert_eq!(paint_gate("italic-serif-display"), Some(PaintGate::Text));
        assert_eq!(paint_gate("low-contrast"), Some(PaintGate::Text));
        assert_eq!(paint_gate("buried-raster"), Some(PaintGate::Raster));
        assert_eq!(paint_gate("blinking-cursor"), Some(PaintGate::Toggle));
    }

    /// copperhead.sh's caret between blinks, and a cursor inside a panel a
    /// visitor never sees.
    #[test]
    fn a_toggle_rule_reads_only_what_hides_the_element_from_outside() {
        let (mut d, body) = page();
        let term = d.add(Some(body), "div");
        d.set_rect(term, 40.0, 100.0, 280.0, 32.0);
        let cursor = d.add(Some(term), "span");
        d.set_rect(cursor, 100.0, 107.0, 10.0, 18.0);
        assert_eq!(unpainted_for(&d, cursor, PaintGate::Toggle), None);

        // The off phase of an opacity blink is still the cursor.
        d.set_style(cursor, "opacity", "0");
        assert_eq!(unpainted_for(&d, cursor, PaintGate::Toggle), None);
        assert_eq!(unpainted_for(&d, cursor, PaintGate::Box), Some(Unpainted::Transparent));
        d.set_style(cursor, "opacity", "1");

        // So is the off phase of a visibility blink, which checkVisibility()
        // answers false for, while its parent stays visible or unrecorded.
        d.set_style(cursor, "visibility", "hidden");
        d.el_mut(cursor).check_visibility = Some(false);
        assert_eq!(unpainted_for(&d, cursor, PaintGate::Toggle), None);
        d.set_style(term, "visibility", "visible");
        assert_eq!(unpainted_for(&d, cursor, PaintGate::Toggle), None);
        assert_eq!(unpainted_for(&d, cursor, PaintGate::Box), Some(Unpainted::NotRendered));

        // A panel at visibility: hidden hides it.
        d.set_style(term, "visibility", "hidden");
        assert_eq!(unpainted_for(&d, cursor, PaintGate::Toggle), Some(Unpainted::NotRendered));
        d.set_style(term, "visibility", "visible");
        d.set_style(cursor, "visibility", "visible");
        d.el_mut(cursor).check_visibility = Some(true);

        // So does a transparent panel, and one at display: none.
        d.set_style(term, "opacity", "0");
        assert_eq!(unpainted_for(&d, cursor, PaintGate::Toggle), Some(Unpainted::Transparent));
        d.set_style(term, "opacity", "1");
        d.set_style(term, "display", "none");
        assert_eq!(unpainted_for(&d, cursor, PaintGate::Toggle), Some(Unpainted::NotRendered));
        d.set_style(term, "visibility", "hidden");
        d.set_style(cursor, "visibility", "hidden");
        d.el_mut(cursor).check_visibility = Some(false);
        assert_eq!(unpainted_for(&d, cursor, PaintGate::Toggle), Some(Unpainted::NotRendered));
    }

    /// observations-25 issue 4: co-trip.jp's date on a Swiper slide parked
    /// with a sliver in view, and a slick clone 79% past its track. A text
    /// measurement with less than a quarter of its width inside its clip is
    /// not painted for the text rules; the other gates keep the overlap test.
    #[test]
    fn a_text_copy_mostly_past_its_clip_is_not_painted_for_text_rules() {
        let (mut d, body) = page();
        let clip = d.add(Some(body), "div");
        d.set_styles(clip, &[("overflowX", "hidden"), ("overflowY", "hidden")]);
        d.set_rect(clip, 240.0, 100.0, 600.0, 60.0);
        let track = d.add(Some(clip), "div");
        d.set_style(track, "transform", "matrix(1, 0, 0, 1, -82, 0)");
        d.set_rect(track, 158.0, 100.0, 900.0, 60.0);
        let date = d.add(Some(track), "div");
        d.add_text(date, "2026.08.13");
        // 4 of its 70px inside the clip.
        d.set_rect(date, 174.0, 116.0, 70.0, 20.0);
        assert_eq!(why(&d, date), None, "the base predicate keeps any overlap");
        assert_eq!(unpainted_for(&d, date, PaintGate::Box), None);
        assert_eq!(unpainted_for(&d, date, PaintGate::Text), Some(Unpainted::ClippedOut));
        // 30 of 70px shows: a copy a reader can make out still reports.
        d.set_rect(date, 210.0, 116.0, 70.0, 20.0);
        assert_eq!(unpainted_for(&d, date, PaintGate::Text), None);
        // The text's own extent is what shows, not the box around it.
        d.set_rect(date, -600.0, 116.0, 1000.0, 20.0);
        d.set_text_rect(date, 250.0, 118.0, 70.0, 16.0);
        assert_eq!(unpainted_for(&d, date, PaintGate::Text), None, "text inside a wide box");
        d.set_text_rect(date, 176.0, 118.0, 70.0, 16.0);
        assert_eq!(unpainted_for(&d, date, PaintGate::Text), Some(Unpainted::ClippedOut));

        // A box that truncates its line with an ellipsis shows the start of it.
        let truncate = d.add(Some(body), "div");
        d.set_styles(truncate, &[("overflowX", "hidden"), ("overflowY", "hidden"), ("textOverflow", "ellipsis")]);
        d.set_rect(truncate, 20.0, 300.0, 150.0, 24.0);
        let label = d.add(Some(truncate), "span");
        d.set_style(label, "display", "inline");
        d.add_text(label, "A very long label that runs far past its narrow box");
        d.set_rect(label, 20.0, 300.0, 900.0, 24.0);
        assert_eq!(unpainted_for(&d, label, PaintGate::Text), None);
        d.set_style(truncate, "textOverflow", "clip");
        assert_eq!(unpainted_for(&d, label, PaintGate::Text), Some(Unpainted::ClippedOut));

        // Only the x axis is floored: a line-clamped standfirst shows its first
        // lines, while the text rects of the lines it hides run past its bottom.
        let clamp = d.add(Some(body), "div");
        d.set_styles(clamp, &[("overflowX", "hidden"), ("overflowY", "hidden")]);
        d.set_rect(clamp, 40.0, 900.0, 400.0, 40.0);
        let standfirst = d.add(Some(clamp), "p");
        d.add_text(standfirst, "A standfirst clamped to two lines of a much longer summary");
        d.set_rect(standfirst, 40.0, 900.0, 400.0, 200.0);
        assert_eq!(unpainted_for(&d, standfirst, PaintGate::Text), None);

        // A cell a horizontal scroller shows a sliver of at rest; past the
        // scroller, the ancestors above judge the scroller's box.
        let scroller = d.add(Some(body), "div");
        d.set_styles(scroller, &[("overflowX", "auto"), ("overflowY", "hidden")]);
        d.set_rect(scroller, 40.0, 1200.0, 310.0, 100.0);
        d.el_mut(scroller).client_width = 310.0;
        d.el_mut(scroller).scroll_width = 900.0;
        let cell = d.add(Some(scroller), "div");
        d.add_text(cell, "Third column");
        d.set_rect(cell, 330.0, 1200.0, 150.0, 40.0);
        assert_eq!(unpainted_for(&d, cell, PaintGate::Text), Some(Unpainted::ClippedOut));
        d.set_rect(cell, 250.0, 1200.0, 150.0, 40.0);
        assert_eq!(unpainted_for(&d, cell, PaintGate::Text), None);
    }

    /// A date parked past the page's left edge with 4px on the page.
    #[test]
    fn a_text_copy_mostly_off_the_document_is_not_painted_for_text_rules() {
        let (mut d, body) = page();
        let edge = d.add(Some(body), "div");
        d.add_text(edge, "2026.08.09");
        d.set_rect(edge, -66.0, 560.0, 70.0, 20.0);
        assert_eq!(why(&d, edge), None);
        assert_eq!(unpainted_for(&d, edge, PaintGate::Text), Some(Unpainted::OutsideDocument));
        d.set_rect(edge, -30.0, 560.0, 70.0, 20.0);
        assert_eq!(unpainted_for(&d, edge, PaintGate::Text), None, "40 of 70px on the page");
        // Past the document's far edge the page shell cuts a line that starts
        // in view: a layout bug a visitor sees, which keeps reporting.
        d.set_rect(edge, 1270.0, 560.0, 70.0, 20.0);
        assert_eq!(unpainted_for(&d, edge, PaintGate::Text), None);
        // Right to left, the page scrolls past the left edge instead, and the
        // scroll origin is the right edge.
        let root = d.document_element.unwrap();
        d.set_style(root, "direction", "rtl");
        d.el_mut(root).scroll_width = 2560.0;
        d.set_rect(edge, -66.0, 560.0, 70.0, 20.0);
        assert_eq!(unpainted_for(&d, edge, PaintGate::Text), None);
        d.set_rect(edge, 1276.0, 560.0, 70.0, 20.0);
        assert_eq!(unpainted_for(&d, edge, PaintGate::Text), Some(Unpainted::OutsideDocument));
    }

    /// The review's overflow probe at 390px: a non-wrapping row's second
    /// column with 50 of 280px in view, cut by a wrapper that hides overflow
    /// across the whole viewport. A page shell's cut is a layout bug, not a
    /// parked copy, so the floor does not apply; a narrower clip, a scroller
    /// and a transformed track as wide as the viewport still floor.
    #[test]
    fn a_page_shell_cut_is_not_floored() {
        let (mut d, body) = page();
        d.inner_width = 390.0;
        let root = d.document_element.unwrap();
        d.set_rect(root, 0.0, 0.0, 390.0, 4000.0);
        d.el_mut(root).scroll_width = 390.0;
        d.el_mut(root).client_width = 390.0;
        let shell = d.add(Some(body), "div");
        d.set_styles(shell, &[("overflowX", "hidden"), ("overflowY", "visible")]);
        d.set_rect(shell, 0.0, 0.0, 390.0, 2000.0);
        d.el_mut(shell).client_width = 390.0;
        d.el_mut(shell).scroll_width = 640.0;
        let row = d.add(Some(shell), "div");
        d.set_rect(row, 0.0, 400.0, 640.0, 120.0);
        let left = d.add(Some(row), "div");
        d.set_rect(left, 0.0, 400.0, 320.0, 120.0);
        let right = d.add(Some(row), "div");
        d.set_rect(right, 320.0, 400.0, 320.0, 120.0);
        let p = d.add(Some(right), "p");
        d.add_text(p, "The right column of the same row starts near the right edge of the phone screen");
        d.set_rect(p, 340.0, 400.0, 280.0, 120.0);
        assert_eq!(unpainted_for(&d, p, PaintGate::Text), None, "50 of 280px in view, cut by the page shell");
        // A desktop column 1,700px wide in the same shell.
        d.set_rect(p, 20.0, 400.0, 1700.0, 120.0);
        assert_eq!(unpainted_for(&d, p, PaintGate::Text), None);
        d.set_rect(p, 340.0, 400.0, 280.0, 120.0);

        // A classic scrollbar narrows the page: a shell at the root's client
        // width is still the page shell.
        d.el_mut(root).client_width = 375.0;
        d.set_rect(shell, 0.0, 0.0, 375.0, 2000.0);
        assert_eq!(unpainted_for(&d, p, PaintGate::Text), None);
        d.el_mut(root).client_width = 390.0;
        d.set_rect(shell, 0.0, 0.0, 390.0, 2000.0);

        // A clip narrower than the page parks copies.
        d.set_rect(shell, 0.0, 0.0, 360.0, 2000.0);
        assert_eq!(unpainted_for(&d, p, PaintGate::Text), Some(Unpainted::ClippedOut));
        d.set_rect(shell, 0.0, 0.0, 390.0, 2000.0);

        // A scroller as wide as the page brings its cells into view.
        d.set_style(shell, "overflowX", "auto");
        assert_eq!(unpainted_for(&d, p, PaintGate::Text), Some(Unpainted::ClippedOut));
        d.set_style(shell, "overflowX", "hidden");

        // A track a script moves with transforms, as wide as the page.
        d.set_style(row, "transform", "matrix(1, 0, 0, 1, -40, 0)");
        d.el_mut(row).scroll_width = 640.0;
        assert_eq!(unpainted_for(&d, p, PaintGate::Text), Some(Unpainted::ClippedOut));
        d.set_style(row, "transform", "none");

        // With no measured viewport the width test proves nothing.
        d.inner_width = f64::NAN;
        d.el_mut(root).client_width = 0.0;
        d.set_rect(shell, 0.0, 0.0, 360.0, 2000.0);
        assert_eq!(unpainted_for(&d, p, PaintGate::Text), None);
    }

    /// A 0x0 anchor whose nowrap label overflows it visibly (a map pin, a
    /// chart label) shows that label, and the Text gate keeps it; a 0x0 box
    /// with nothing past its edges shows no text.
    #[test]
    fn a_zero_box_shows_the_text_that_overflows_it() {
        let (mut d, body) = page();
        let pin = d.add(Some(body), "span");
        d.set_styles(pin, &[("position", "absolute"), ("overflowX", "visible"), ("overflowY", "visible")]);
        d.add_text(pin, "Harbour office, open 9 to 5");
        d.set_rect(pin, 120.0, 60.0, 0.0, 0.0);
        d.el_mut(pin).scroll_width = 140.0;
        d.el_mut(pin).scroll_height = Some(15.0);
        assert_eq!(unpainted_for(&d, pin, PaintGate::Text), None, "the label overflows visibly");
        assert_eq!(unpainted_for(&d, pin, PaintGate::Box), None);
        // A metric the capture did not record keeps it.
        d.el_mut(pin).scroll_width = f64::NAN;
        d.el_mut(pin).scroll_height = None;
        assert_eq!(unpainted_for(&d, pin, PaintGate::Text), None);
        // Nothing runs past its edges: no text shows.
        d.el_mut(pin).scroll_width = 0.0;
        d.el_mut(pin).scroll_height = Some(0.0);
        assert_eq!(unpainted_for(&d, pin, PaintGate::Text), Some(Unpainted::NoArea));
        // A 0x0 box that hides its overflow shows none of it.
        d.el_mut(pin).scroll_width = 140.0;
        d.el_mut(pin).scroll_height = Some(15.0);
        d.set_styles(pin, &[("overflowX", "hidden"), ("overflowY", "hidden")]);
        assert_eq!(unpainted_for(&d, pin, PaintGate::Text), Some(Unpainted::NoArea));
    }

    #[test]
    fn text_shown_across_reads_the_x_cuts() {
        let (mut d, body) = page();
        let clip = d.add(Some(body), "div");
        d.set_styles(clip, &[("overflowX", "hidden"), ("overflowY", "hidden")]);
        d.set_rect(clip, 240.0, 100.0, 300.0, 40.0);
        let word = d.add(Some(clip), "span");
        d.set_style(word, "display", "inline-block");
        d.add_text(word, "Journal entries");
        d.set_rect(word, 180.0, 100.0, 140.0, 40.0);
        assert!(!text_shown_across(&d, word), "60px of it past the clip");
        d.set_rect(word, 260.0, 100.0, 140.0, 40.0);
        assert!(text_shown_across(&d, word));
        // A cut on y alone does not count.
        d.set_rect(word, 260.0, 120.0, 140.0, 40.0);
        assert!(text_shown_across(&d, word));
        // Not painted at all: not shown.
        d.set_style(clip, "display", "none");
        assert!(!text_shown_across(&d, word));
    }

    #[test]
    fn a_page_form_needs_a_painted_match() {
        let (mut d, body) = page();
        let loader = d.add(Some(body), "div");
        d.set_style(loader, "display", "none");
        d.el_mut(loader).check_visibility = Some(false);
        let shown = d.add(Some(body), "div");
        d.set_rect(shown, 40.0, 100.0, 200.0, 40.0);
        assert!(!page_form_painted(&d, "bounce-easing", &[loader]));
        assert!(page_form_painted(&d, "bounce-easing", &[loader, shown]));
        assert!(!page_form_painted(&d, "pulsing-dot", &[loader]));
        assert!(!page_form_painted(&d, "dark-glow", &[loader]));
        // Outside the list, and with nothing matched, base behavior stands.
        assert!(page_form_painted(&d, "marquee", &[loader]));
        assert!(page_form_painted(&d, "bounce-easing", &[]));
        // A pseudo-element host with no box of its own still counts.
        let host = d.add(Some(body), "div");
        d.set_rect(host, 40.0, 200.0, 0.0, 0.0);
        assert!(page_form_painted(&d, "pulsing-dot", &[host]));
    }

    /// Keyframes with their selectors, as a capture records both.
    fn set_keyframes(d: &mut FakeDom, name: &str, frames_by_key: &[(&str, &[(&str, &str)])]) {
        let values: Vec<&[(&str, &str)]> = frames_by_key.iter().map(|(_, decls)| *decls).collect();
        d.keyframes.insert(name.into(), frames(&values));
        d.keyframe_keys.insert(name.into(), frames_by_key.iter().map(|(k, _)| k.to_string()).collect());
    }

    fn frames(values: &[&[(&str, &str)]]) -> Vec<crate::browser::dom::KeyframeFrame> {
        values
            .iter()
            .map(|decls| crate::browser::dom::KeyframeFrame {
                decls: decls.iter().map(|(p, v)| (p.to_string(), v.to_string())).collect(),
            })
            .collect()
    }

    /// The computed `animation-*` lists of a one-shot run, as a capture that
    /// records the fill mode, direction, duration and delay reads them.
    fn one_shot(d: &mut FakeDom, el: ElId, name: &str, fill: &str) {
        d.set_styles(
            el,
            &[
                ("animationName", name),
                ("animationIterationCount", "1"),
                ("animationFillMode", fill),
                ("animationDirection", "normal"),
                ("animationDuration", "10s"),
                ("animationDelay", "0s"),
                ("animationTimeline", "auto"),
                ("animationPlayState", "running"),
                ("animationComposition", "replace"),
            ],
        );
        d.set_running_animations(el, &["opacity"]);
    }

    /// maritime.sh (285091, 285346): the outgoing host of a URL swap,
    /// `ds-url-old 10s linear forwards`, read at opacity 1 in its first
    /// seconds and held at 0 after.
    #[test]
    fn a_one_shot_fade_out_that_holds_its_end_is_not_painted() {
        let (mut d, body) = page();
        let bar = d.add(Some(body), "div");
        d.set_rect(bar, 40.0, 200.0, 300.0, 20.0);
        let old = d.add(Some(bar), "span");
        d.set_styles(old, &[("fontSize", "10.5px"), ("opacity", "1"), ("position", "absolute")]);
        d.set_rect(old, 40.0, 200.0, 174.0, 20.0);
        d.add_text(old, "mail.google.com");
        set_keyframes(&mut d, "ds-url-old", &[("0%, 35%", &[("opacity", "1")]), ("36%, 100%", &[("opacity", "0")])]);
        set_keyframes(&mut d, "ds-url-new", &[("0%, 35%", &[("opacity", "0")]), ("37%, 100%", &[("opacity", "1")])]);
        one_shot(&mut d, old, "ds-url-old", "forwards");
        assert_eq!(text(&d, old), Some(Unpainted::FadesOut));
        d.set_style(old, "animationFillMode", "both");
        assert_eq!(text(&d, old), Some(Unpainted::FadesOut));

        // The fade carries what is inside the box with it.
        let inner = d.add(Some(old), "b");
        d.set_style(inner, "fontSize", "10.5px");
        d.set_rect(inner, 40.0, 200.0, 40.0, 20.0);
        d.add_text(inner, "mail");
        assert_eq!(text(&d, inner), Some(Unpainted::FadesOut));
        // The raster rule asks its ancestors alone.
        assert_eq!(raster(&d, old), None);

        // Each of these leaves the box shown, or says nothing it can hold.
        let cases: &[(&str, &str)] = &[
            ("animationFillMode", "none"),
            ("animationFillMode", "backwards"),
            ("animationDirection", "reverse"),
            ("animationIterationCount", "infinite"),
            ("animationIterationCount", "1.5"),
            ("animationDuration", "120s"),
            ("animationTimeline", "view()"),
            ("animationPlayState", "paused"),
            ("animationName", "ds-url-new"),
            ("animationName", "unknown-keyframes"),
            // A second animation setting opacity: which wins depends on order
            // and composition, so neither decides.
            ("animationName", "ds-url-old, ds-url-new"),
        ];
        for (prop, value) in cases {
            one_shot(&mut d, old, "ds-url-old", "forwards");
            d.set_style(old, prop, value);
            assert_eq!(text(&d, old), None, "{prop}: {value}");
        }
        // Two alternating runs end where they started; three end at 0.
        one_shot(&mut d, old, "ds-url-old", "forwards");
        d.set_styles(old, &[("animationDirection", "alternate"), ("animationIterationCount", "2"), ("animationDuration", "4s")]);
        assert_eq!(text(&d, old), None);
        d.set_style(old, "animationIterationCount", "3");
        assert_eq!(text(&d, old), Some(Unpainted::FadesOut));

        // Paired by position: the second name takes the second fill mode.
        set_keyframes(&mut d, "drift", &[("to", &[("transform", "translateY(4px)")])]);
        one_shot(&mut d, old, "drift, ds-url-old", "none, forwards");
        assert_eq!(text(&d, old), Some(Unpainted::FadesOut));
        d.set_style(old, "animationFillMode", "forwards, none");
        assert_eq!(text(&d, old), None);

        // The end is the frame at 100%, wherever the stylesheet lists it.
        set_keyframes(&mut d, "out-of-order", &[("to", &[("opacity", "0")]), ("from", &[("opacity", "1")])]);
        one_shot(&mut d, old, "out-of-order", "forwards");
        assert_eq!(text(&d, old), Some(Unpainted::FadesOut));
        set_keyframes(&mut d, "out-of-order", &[("to", &[("opacity", "1")]), ("from", &[("opacity", "0")])]);
        assert_eq!(text(&d, old), None);
        // With no frame at 100% the box ends on its own opacity: unknown.
        set_keyframes(&mut d, "dip", &[("50%", &[("opacity", "0")])]);
        one_shot(&mut d, old, "dip", "forwards");
        assert_eq!(text(&d, old), None);
        // Keyframes recorded without their selectors: unknown.
        d.keyframe_keys.remove("ds-url-old");
        one_shot(&mut d, old, "ds-url-old", "forwards");
        assert_eq!(text(&d, old), None);
        set_keyframes(&mut d, "ds-url-old", &[("0%, 35%", &[("opacity", "1")]), ("36%, 100%", &[("opacity", "0")])]);

        // A capture that saw nothing running, and a recording made before
        // the fill mode, direction, duration and delay were read, keep base
        // behaviour.
        one_shot(&mut d, old, "ds-url-old", "forwards");
        d.el_mut(old).running_animations = Some(Vec::new());
        assert_eq!(text(&d, old), None);
        d.el_mut(old).running_animations = None;
        assert_eq!(text(&d, old), None);
        one_shot(&mut d, old, "ds-url-old", "forwards");
        for prop in [
            "animationFillMode",
            "animationDirection",
            "animationDuration",
            "animationDelay",
            "animationPlayState",
            "animationComposition",
        ] {
            one_shot(&mut d, old, "ds-url-old", "forwards");
            d.set_style(old, prop, "");
            assert_eq!(text(&d, old), None, "{prop} unrecorded");
        }
        // An animation that adds to the box's own opacity does not end on
        // its end frame's value: 1 plus the frame's 0 is still shown.
        for composition in ["add", "accumulate"] {
            one_shot(&mut d, old, "ds-url-old", "forwards");
            d.set_style(old, "animationComposition", composition);
            assert_eq!(text(&d, old), None, "{composition}");
        }
    }

    /// hse.de (287819): the poster of a live preview at opacity 0 with no
    /// transition, beside the wrapper of the `<video>` that plays over it.
    #[test]
    fn a_poster_beside_a_playing_video_needs_no_transition() {
        let (mut d, body) = page();
        let card = d.add(Some(body), "div");
        d.set_style(card, "position", "relative");
        d.set_rect(card, 15.0, 3551.0, 312.0, 390.0);
        let wrap = d.add(Some(card), "div");
        d.set_style(wrap, "position", "absolute");
        d.set_rect(wrap, 15.0, 3551.0, 312.0, 390.0);
        let video = d.add(Some(wrap), "video");
        d.set_rect(video, 14.0, 3431.0, 312.0, 553.0);
        let poster = d.add(Some(card), "img");
        d.set_styles(poster, &[("opacity", "0"), ("transitionProperty", "all"), ("transitionDuration", "0s")]);
        d.set_rect(poster, 15.0, 3551.0, 312.0, 390.0);
        assert_eq!(raster(&d, poster), Some(Unpainted::StateLayer));

        // Held faint rather than at 0, it is an image held buried.
        d.set_style(poster, "opacity", "0.05");
        assert_eq!(raster(&d, poster), None);
        d.set_style(poster, "opacity", "0");

        // An image instead of the video, with no transition: still reported.
        let stack = d.add(Some(body), "div");
        d.set_rect(stack, 15.0, 100.0, 312.0, 390.0);
        let photo_wrap = d.add(Some(stack), "div");
        d.set_rect(photo_wrap, 15.0, 100.0, 312.0, 390.0);
        let photo = d.add(Some(photo_wrap), "img");
        d.set_rect(photo, 15.0, 100.0, 312.0, 390.0);
        let buried = d.add(Some(stack), "img");
        d.set_styles(buried, &[("opacity", "0"), ("transitionProperty", "all"), ("transitionDuration", "0s")]);
        d.set_rect(buried, 15.0, 100.0, 312.0, 390.0);
        assert_eq!(raster(&d, buried), None);

        // A video that is not drawn replaces nothing.
        d.set_style(wrap, "opacity", "0");
        assert_eq!(raster(&d, poster), None);
        d.set_style(wrap, "opacity", "1");
        d.set_style(video, "visibility", "hidden");
        assert_eq!(raster(&d, poster), None);
        d.set_style(video, "visibility", "visible");
        assert_eq!(raster(&d, poster), Some(Unpainted::StateLayer));

        // The video moved off the poster's box: reported.
        d.set_rect(wrap, 15.0, 1200.0, 312.0, 390.0);
        d.set_rect(video, 15.0, 1200.0, 312.0, 390.0);
        assert_eq!(raster(&d, poster), None);
    }

    /// ascenix.co (286171 to 286173): a hero note that grows from
    /// `scale(0.22)` at opacity 0 and back, forever.
    #[test]
    fn a_loop_through_nothing_is_in_motion_and_a_breath_is_not() {
        let (mut d, body) = page();
        let note = d.add(Some(body), "li");
        d.set_styles(note, &[("opacity", "1"), ("animationName", "orb-note"), ("animationIterationCount", "infinite")]);
        d.set_running_animations(note, &["opacity", "box-shadow", "transform"]);
        d.keyframes.insert(
            "orb-note".into(),
            frames(&[&[("transform", "scale(.6)"), ("opacity", "0")], &[("opacity", "1")], &[("opacity", "0")]]),
        );
        assert!(loops_in_motion(&d, note));
        // A recording that read no running animations, or saw none moving
        // opacity, says nothing.
        d.el_mut(note).running_animations = None;
        assert!(!loops_in_motion(&d, note));
        d.set_running_animations(note, &["transform"]);
        assert!(!loops_in_motion(&d, note));
        d.set_running_animations(note, &["opacity"]);
        // One run, and a loop that only breathes, are not.
        d.set_style(note, "animationIterationCount", "1");
        assert!(!loops_in_motion(&d, note));
        d.set_style(note, "animationIterationCount", "infinite");
        d.keyframes.insert("orb-note".into(), frames(&[&[("opacity", "0.7")], &[("opacity", "1")]]));
        assert!(!loops_in_motion(&d, note));
        // Paused, or with a second animation setting opacity: not decided.
        d.keyframes.insert("orb-note".into(), frames(&[&[("opacity", "0")], &[("opacity", "1")]]));
        assert!(loops_in_motion(&d, note));
        d.set_style(note, "animationPlayState", "paused");
        assert!(!loops_in_motion(&d, note));
        d.set_style(note, "animationPlayState", "running");
        d.keyframes.insert("hold".into(), frames(&[&[("opacity", "1")]]));
        d.set_style(note, "animationName", "orb-note, hold");
        assert!(!loops_in_motion(&d, note));
        d.set_style(note, "animationName", "orb-note");
        // A marquee moves only its transform.
        d.keyframes.insert("orb-note".into(), frames(&[&[("transform", "translateX(0)")], &[("transform", "translateX(-50%)")]]));
        assert!(!loops_in_motion(&d, note));
    }
}
