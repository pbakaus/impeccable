//! Static element adapters from `checks.mjs` Section 5 (`checkElement*`) and
//! their DOM helpers (`scopedIgnoreActive`, `isTabContextElement`,
//! `isStatusContextElement`, `cleanInlineText`, kicker / numbered-label
//! candidate collection, radial spotlight, clipped overflow). Every pure
//! check comes from `impeccable_core::checks`; this file only reads the DOM
//! and the computed style and hands plain data over.

use crate::background::{
    a_ge, a_gt, read_cascade_background_color, read_own_background_color, resolve_background,
    resolve_border_radius_px, resolve_side_accent_corners, resolve_text_gradient_stops,
    resolve_text_surface, sv, sv_opt, CustomPropMap, TextSurface,
};
use crate::cascade::StyleValues;
use crate::layer::picture_under_text;
use crate::dom::{StaticDocument, StaticElement};
use crate::quality::{
    collapse_ws, is_in_non_rendered_markup, is_visually_hidden, pf0, resolve_font_size_px,
};
use impeccable_core::checks::css_scan::css_length_to_px;
use impeccable_core::checks::measures::{
    self, border_colors_from_style, border_widths_from_style, check_oversized_h1,
    data_svg_intrinsic_size, gpt_border_shadow_halo_blur_px, gpt_border_shadow_lengths_close,
    gpt_border_shadow_row_finding, gpt_border_shadow_row_size, gpt_thin_border_wide_shadow_pair,
    positioned_style_implies_escape_axis, resolve_length_px, GptBorderShadowInput,
    GptBorderShadowRowTree, OversizedH1Input, StyleMap, ICON_MAX_PX,
};
use impeccable_core::checks::rules::{
    check_borders, check_colors_deduped_shaped, check_glow, check_hero_eyebrow, check_hover_contrast,
    check_icon_tile, check_italic_serif, check_kicker_above_heading, check_motion,
    check_placeholder_colors, check_stripe_child, is_close_letter_text, is_emoji_only_text,
    is_glyph_only_text, is_heading_tag, is_icon_ligature_text, is_rounded_away_from_side,
    names_close_control,
    resolve_hero_heading_size_px, BorderOpts, ColorOpts, GlowOpts, HeroEyebrowOpts,
    HoverContrastOpts, IconTileOpts, ItalicSerifOpts, KickerCandidate, MotionOpts, RuleHit,
    SafeTagTextSeen, Sides,
};
use impeccable_core::checks::text_rules::{
    check_numbered_section_labels, is_kicker_candidate, is_numbered_section_label_candidate,
    parse_numbered_label_text, KickerCandidateInput, NumberedLabelCandidate,
    NumberedLabelCandidateInput, HEADING_TAGS, KICKER_CARD_CONTEXT_SELECTOR, KICKER_SKIP_SELECTOR,
    POPOVER_LAYER_SELECTOR, POSITIONED_CHILD_INTERACTIVE_SELECTOR,
};
use impeccable_core::color::{
    composite_color_over, is_no_paint_color_value, parse_any_color, parse_rgb, Rgba,
};
use impeccable_core::constants::SAFE_TAGS;
use impeccable_core::js::{self, parse_float, parse_int};
use impeccable_core::js_ext_a::num_truthy;
use impeccable_core::js_ext_b::slice_utf16_prefix;
use once_cell::sync::Lazy;
use regex::Regex;
use std::collections::HashSet;

/// `StyleMap` view of a computed style for the core helpers.
pub struct StyleRef<'a>(pub &'a StyleValues);

impl StyleMap for StyleRef<'_> {
    fn prop(&self, name: &str) -> Option<String> {
        self.0.get(name).cloned()
    }
}

fn hits(v: Vec<measures::Finding>) -> Vec<RuleHit> {
    v.into_iter()
        .map(|f| RuleHit {
            id: f.id,
            snippet: f.snippet,
            severity: None,
        })
        .collect()
}

static WS_RE: Lazy<Regex> = Lazy::new(|| Regex::new(&format!("{}+", js::WS)).expect("WS_RE"));
static IGNORE_SPLIT_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(&format!("[{},]+", js::WS_CHARS)).expect("IGNORE_SPLIT_RE"));

/// JS: checks.mjs#scopedIgnoreActive(el, ruleId)
pub fn scoped_ignore_active(el: &StaticElement<'_>, rule_id: &str) -> bool {
    let rule = js::to_lower_case(rule_id);
    let mut cur = Some(*el);
    while let Some(e) = cur {
        if let Some(attr) = e.get_attribute("data-impeccable-ignore") {
            let lowered = js::to_lower_case(js::trim(attr));
            let rules: Vec<&str> = IGNORE_SPLIT_RE
                .split(&lowered)
                .filter(|s| !s.is_empty())
                .collect();
            if rules.is_empty() || rules.contains(&"*") || rules.contains(&rule.as_str()) {
                return true;
            }
        }
        cur = e.parent_element();
    }
    false
}

static ACTIVE_CLASS_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(
        r"(?i)(?:^|[{ws}_-])(?:active|current|selected)(?:$|[{ws}_-])",
        ws = js::WS_CHARS
    ))
    .expect("ACTIVE_CLASS_RE")
});

/// JS: checks.mjs#isTabContextElement(el)
pub fn is_tab_context_element(el: &StaticElement<'_>) -> bool {
    if el
        .closest("[aria-selected=\"true\"], [aria-current]:not([aria-current=\"false\"])")
        .is_some()
    {
        return true;
    }
    let mut cur = Some(*el);
    let mut depth = 0;
    while let Some(e) = cur {
        if depth >= 6 {
            break;
        }
        if ACTIVE_CLASS_RE.is_match(e.class_name()) {
            return true;
        }
        cur = e.parent_element();
        depth += 1;
    }
    false
}

/// JS: checks.mjs#isStatusContextElement(el)
pub fn is_status_context_element(el: &StaticElement<'_>) -> bool {
    el.closest("[role=\"status\"], [role=\"alert\"], [role=\"alertdialog\"], [role=\"log\"], [aria-live=\"polite\"], [aria-live=\"assertive\"]")
        .is_some()
}

/// JS: checks.mjs#cleanInlineText(el): direct text nodes joined with a
/// space, whitespace collapsed, trimmed.
pub fn clean_inline_text(el: &StaticElement<'_>) -> String {
    let parts: Vec<String> = el
        .child_nodes()
        .iter()
        .filter_map(|c| match c {
            crate::dom::ChildNode::Text(t) => Some(t.to_string()),
            _ => None,
        })
        .collect();
    js::trim(&collapse_ws(&parts.join(" "))).to_string()
}

/// `(el.textContent || '').replace(/\s+/g, ' ').trim()`
fn collapsed_text_content(el: &StaticElement<'_>) -> String {
    js::trim(&collapse_ws(&el.text_content())).to_string()
}

/// JS: checks.mjs#isKickerCardContext(heading, kicker)
fn is_kicker_card_context(heading: &StaticElement<'_>, kicker: &StaticElement<'_>) -> bool {
    match heading.closest(KICKER_CARD_CONTEXT_SELECTOR) {
        Some(item) => item.contains(kicker),
        None => false,
    }
}

static HEADING_LEVEL_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^h([1-6])$").expect("HEADING_LEVEL_RE"));

/// JS: checks.mjs#kickerHeadingLevel(heading)
fn kicker_heading_level(heading: &StaticElement<'_>) -> f64 {
    let tag = heading.tag_lower();
    if let Some(m) = HEADING_LEVEL_RE.captures(&tag) {
        return parse_int(&m[1], 10);
    }
    let role = heading.get_attribute("role").unwrap_or("");
    if js::to_lower_case(role) != "heading" {
        return 0.0;
    }
    let aria_level = parse_int(heading.get_attribute("aria-level").unwrap_or(""), 10);
    if aria_level.is_finite() && aria_level >= 1.0 {
        aria_level
    } else {
        2.0
    }
}

/// `(value, fontSize) => resolveLengthPx(value, fontSize) || 0`
fn resolve_len_or_zero(value: &str, font_size: f64) -> f64 {
    match resolve_length_px(Some(value), font_size) {
        Some(n) if num_truthy(n) => n,
        _ => 0.0,
    }
}

/// `resolveLetterSpacing(style.fontSize || '', 16) || parseFloat(style.fontSize) || 0`
fn font_size_of(style: &StyleValues) -> f64 {
    let raw = sv(style, "fontSize");
    let a = resolve_len_or_zero(raw, 16.0);
    if num_truthy(a) {
        return a;
    }
    pf0(raw)
}

fn strip_edge_quotes_slice(text: &str, n: usize) -> String {
    slice_utf16_prefix(
        &impeccable_core::checks::text_rules::strip_edge_quotes(text),
        n,
    )
}

/// JS: checks.mjs#collectKickerCandidates(doc, getStyle, resolveLetterSpacing)
pub fn collect_kicker_candidates(doc: &StaticDocument) -> Vec<KickerCandidate> {
    let mut candidates = Vec::new();
    for heading in doc.query_selector_all("h1, h2, h3, h4, [role=\"heading\"]") {
        let heading_level = kicker_heading_level(&heading);
        if !num_truthy(heading_level) || heading_level > 4.0 {
            continue;
        }
        if heading.closest(KICKER_SKIP_SELECTOR).is_some() {
            continue;
        }
        if heading
            .closest("[role=\"tabpanel\"], [role=\"dialog\"], [role=\"application\"], dialog")
            .is_some()
        {
            continue;
        }
        let Some(kicker) = heading.previous_element_sibling() else {
            continue;
        };
        if kicker.closest(KICKER_SKIP_SELECTOR).is_some() {
            continue;
        }
        if is_kicker_card_context(&heading, &kicker) {
            continue;
        }
        let heading_style = heading.style();
        let kicker_style = kicker.style();
        let heading_tag = heading.tag_lower();
        let heading_text = collapsed_text_content(&heading);
        let kicker_text = {
            let t = clean_inline_text(&kicker);
            if t.is_empty() {
                collapsed_text_content(&kicker)
            } else {
                t
            }
        };
        let heading_font_size = font_size_of(heading_style);
        let kicker_font_size = font_size_of(kicker_style);
        let kicker_letter_spacing =
            resolve_len_or_zero(sv(kicker_style, "letterSpacing"), kicker_font_size);
        let kicker_font_variant = format!(
            "{} {}",
            sv(kicker_style, "fontVariant"),
            sv(kicker_style, "fontVariantCaps")
        );
        if !is_kicker_candidate(&KickerCandidateInput {
            heading_level,
            heading_text: &heading_text,
            heading_font_size,
            kicker_tag: &kicker.tag_lower(),
            kicker_text: &kicker_text,
            kicker_text_transform: sv(kicker_style, "textTransform"),
            kicker_font_variant: &kicker_font_variant,
            kicker_font_size,
            kicker_letter_spacing,
        }) {
            continue;
        }
        // The hero rule takes a tracked label over a display h1, at eyebrow
        // size once its em floor is what counts. Under the fixed 1.6px floor
        // the label is handed off only where the hero rule reports it: that
        // rule reads case from text-transform and typed capitals (not
        // small-caps) and passes over a dated meta line, so a label it leaves
        // is kept here.
        if heading_tag == "h1"
            && heading_font_size >= 48.0
            && (kicker_letter_spacing >= 1.6
                || (kicker_font_size <= 14.0
                    && impeccable_core::checks::rules::hero_eyebrow_tracked(
                        kicker_letter_spacing,
                        kicker_font_size,
                        Some(impeccable_core::checks::rules::HERO_EYEBROW_TRACKING_EM),
                    )
                    && !check_element_hero_eyebrow(&heading, heading_style, "h1").is_empty()))
        {
            continue;
        }
        candidates.push(KickerCandidate {
            heading_tag,
            heading_text: strip_edge_quotes_slice(&heading_text, 60),
            kicker_text: slice_utf16_prefix(&kicker_text, 40),
        });
    }
    candidates
}

/// JS: checks.mjs#checkKickerAboveHeadingFromDoc(doc, win)
pub fn check_kicker_above_heading_from_doc(doc: &StaticDocument) -> Vec<RuleHit> {
    check_kicker_above_heading(&collect_kicker_candidates(doc))
}

/// JS: checks.mjs#collectNumberedSectionLabelCandidates(doc, getStyle, resolveLetterSpacing)
pub fn collect_numbered_section_label_candidates(
    doc: &StaticDocument,
) -> Vec<NumberedLabelCandidate> {
    let mut candidates = Vec::new();
    let mut seen_labels: HashSet<ego_tree::NodeId> = HashSet::new();
    for heading in doc.query_selector_all("h2, h3, h4") {
        if heading.closest(KICKER_SKIP_SELECTOR).is_some() {
            continue;
        }
        let mut label = heading.previous_element_sibling();
        if label.is_none() {
            if let Some(parent) = heading.parent_element() {
                let first_child = parent.children().into_iter().next();
                if first_child.is_some_and(|fc| fc == heading) {
                    label = parent.previous_element_sibling();
                }
            }
        }
        let Some(label) = label else {
            continue;
        };
        if seen_labels.contains(&label.id()) {
            continue;
        }
        if label.closest(KICKER_SKIP_SELECTOR).is_some() {
            continue;
        }
        if HEADING_TAGS.contains(&label.tag_lower().as_str()) {
            continue;
        }
        if is_kicker_card_context(&heading, &label)
            || label
                .query_selector(impeccable_core::browser::text_collectors::NUMBERED_LABEL_MEDIA_SELECTOR)
                .is_some()
            || label.query_selector_all("svg").iter().any(|svg| {
                svg.parent_element().is_some_and(|box_| {
                    impeccable_core::browser::text_collectors::holds_number_text(&box_.direct_text())
                })
            })
        {
            continue;
        }
        let label_text = {
            let t = clean_inline_text(&label);
            if t.is_empty() {
                collapsed_text_content(&label)
            } else {
                t
            }
        };
        let Some(parsed) = parse_numbered_label_text(Some(&label_text)) else {
            continue;
        };
        let heading_style = heading.style();
        let label_style = label.style();
        let heading_text = collapsed_text_content(&heading);
        let heading_font_size = font_size_of(heading_style);
        let label_font_size = font_size_of(label_style);
        if !is_numbered_section_label_candidate(&NumberedLabelCandidateInput {
            heading_tag: &heading.tag_lower(),
            heading_text: &heading_text,
            heading_font_size,
            label_tag: &label.tag_lower(),
            label_index: Some(parsed.index),
            label_text: &parsed.text,
            label_font_size,
            label_letter_spacing: resolve_len_or_zero(
                sv(label_style, "letterSpacing"),
                label_font_size,
            ),
            label_font_weight: sv(label_style, "fontWeight"),
            label_font_family: sv(label_style, "fontFamily"),
            label_text_transform: sv(label_style, "textTransform"),
            label_color: sv(label_style, "color"),
        }) {
            continue;
        }
        seen_labels.insert(label.id());
        candidates.push(NumberedLabelCandidate {
            index: parsed.index,
            label_text: slice_utf16_prefix(&parsed.text, 24),
            heading_tag: heading.tag_lower(),
            heading_text: strip_edge_quotes_slice(&heading_text, 60),
        });
    }
    candidates
}

/// JS: checks.mjs#checkNumberedSectionLabelsFromDoc(doc, win)
pub fn check_numbered_section_labels_from_doc(doc: &StaticDocument) -> Vec<RuleHit> {
    hits(check_numbered_section_labels(
        &collect_numbered_section_label_candidates(doc),
        None,
    ))
}

// ─── Radial spotlight ───────────────────────────────────────────────────────

static RADIAL_RE: Lazy<Regex> = Lazy::new(|| Regex::new("(?i)radial-gradient").expect("RADIAL_RE"));
static INLINE_BG_IMAGE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(
        r"(?i)background(?:-image)?{ws}*:{ws}*([^;]+)",
        ws = js::WS
    ))
    .expect("INLINE_BG_IMAGE_RE")
});

/// JS: checks.mjs#elementGradientValue(style, el)
fn element_gradient_value(style: &StyleValues, el: &StaticElement<'_>) -> String {
    let bg_image = match sv_opt(style, "backgroundImage") {
        Some(v) if !v.is_empty() && v != "none" => v,
        _ => "",
    };
    if RADIAL_RE.is_match(bg_image) {
        return bg_image.to_string();
    }
    let bg = sv(style, "background");
    if RADIAL_RE.is_match(bg) {
        return bg.to_string();
    }
    let raw = el.get_attribute("style").unwrap_or("");
    if let Some(m) = INLINE_BG_IMAGE_RE.captures(raw) {
        if RADIAL_RE.is_match(&m[1]) {
            return m[1].to_string();
        }
    }
    String::new()
}

/// JS: checks.mjs#spotlightLabel(el)
fn spotlight_label(el: &StaticElement<'_>) -> String {
    if let Some(name) = el.get_attribute("data-name") {
        if !name.is_empty() {
            return name.to_string();
        }
    }
    let id = el.id_attr();
    if !id.is_empty() {
        return id.to_string();
    }
    let cls = js::trim(el.class_name());
    if !cls.is_empty() {
        if let Some(first) = WS_RE.split(cls).next() {
            if !first.is_empty() {
                return first.to_string();
            }
        }
    }
    el.tag_lower()
}

/// How far up the tree the copy a glow sits behind may live.
const GLOW_ANCESTOR_DEPTH: usize = 8;

/// The element's own opacity times its ancestors': what the glow's declared
/// alpha is actually multiplied by. Mirrors `effectiveOpacityDOM`, the whole
/// chain and the same floor, so both engines gate on the same number.
fn static_effective_opacity(el: &StaticElement<'_>) -> f64 {
    let mut acc = 1.0;
    let mut current = Some(*el);
    while let Some(cur) = current {
        let v = parse_float(sv(cur.style(), "opacity"));
        if v.is_finite() {
            acc *= v.clamp(0.0, 1.0);
        }
        if acc <= 0.02 {
            return 0.0;
        }
        current = cur.parent_element();
    }
    acc
}

fn has_text(el: &StaticElement<'_>) -> bool {
    !collapse_ws(js::trim(&el.text_content())).is_empty()
}

/// A static page has no layout, so "the glow sits behind text" is read
/// structurally: the glowing element carries copy itself, or it is an overlay
/// layer inside a container that does. An in-flow element with no copy of its
/// own takes its own band of the page and the copy around it sits above or
/// below, which is why only an overlay may borrow an ancestor's text. The
/// browser measures the rectangles instead and needs no such stand-in.
fn static_glow_behind_text(el: &StaticElement<'_>, style: &StyleValues) -> bool {
    if has_text(el) {
        return true;
    }
    let position = sv(style, "position");
    if position != "absolute" && position != "fixed" {
        return false;
    }
    let mut current = el.parent_element();
    let mut depth = 0;
    while let Some(parent) = current {
        if depth >= GLOW_ANCESTOR_DEPTH {
            break;
        }
        if has_text(&parent) {
            return true;
        }
        current = parent.parent_element();
        depth += 1;
    }
    false
}

/// The surface a glow paints on. The glow element's own image layers beneath
/// the glow and its background color come first, then each ancestor's images
/// and color, translucent paint composited over the first opaque surface.
/// `None` only when an image shows through or a color does not parse.
fn static_glow_backdrop(el: &StaticElement<'_>, gradient_value: &str) -> Option<Rgba> {
    let mut stack = measures::BackdropStack::default();
    let mut image = Some(measures::radial_spotlight_layers_beneath(gradient_value));
    let mut current = Some(*el);
    while let Some(cur) = current {
        let style = cur.style();
        let background_image = image
            .take()
            .unwrap_or_else(|| sv(style, "backgroundImage").to_string());
        let raw = sv(style, "backgroundColor");
        let mut color = read_cascade_background_color(&cur, style, None);
        if color.is_none() && js::trim(raw).eq_ignore_ascii_case("currentcolor") {
            color = parse_any_color(sv_opt(style, "color"));
        }
        let declared = !is_no_paint_color_value(Some(raw));
        match stack.paint_element(Some(&background_image), color, declared) {
            measures::BackdropStep::Resolved(surface) => return Some(surface),
            measures::BackdropStep::Unreadable => return None,
            measures::BackdropStep::Continue => {}
        }
        current = cur.parent_element();
    }
    Some(stack.finish())
}

/// JS: checks.mjs#checkElementRadialSpotlight(el, style, tag, window): the
/// declaration test, then the prominence gate, reporting the stop that passed.
pub fn check_element_radial_spotlight(el: &StaticElement<'_>, style: &StyleValues) -> Vec<RuleHit> {
    let gradient_value = element_gradient_value(style, el);
    if gradient_value.is_empty() {
        return Vec::new();
    }
    let stops = measures::radial_spotlight_stops(Some(&gradient_value));
    let width = pf0(sv(style, "width"));
    let height = pf0(sv(style, "height"));
    if stops.is_empty() || !measures::radial_spotlight_fits(width, height) {
        return Vec::new();
    }
    let prominence = measures::RadialGlowProminence {
        opacity: static_effective_opacity(el),
        backdrop: static_glow_backdrop(el, &gradient_value),
    };
    let Some(stop) = measures::radial_glow_prominent_stop(&stops, &prominence, || {
        static_glow_behind_text(el, style)
    }) else {
        return Vec::new();
    };
    let label = spotlight_label(el);
    hits(vec![measures::radial_spotlight_finding(
        &stop,
        width,
        height,
        Some(&label),
    )])
}

// ─── Element adapters ───────────────────────────────────────────────────────

/// JS: checks.mjs#checkElementBorders(tag, style, overrides = null, resolvedRadius, el)
pub fn check_element_borders(
    tag: &str,
    style: &StyleValues,
    resolved_radius: f64,
    el: &StaticElement<'_>,
) -> Vec<RuleHit> {
    let widths = Sides {
        top: pf0(sv(style, "borderTopWidth")),
        right: pf0(sv(style, "borderRightWidth")),
        bottom: pf0(sv(style, "borderBottomWidth")),
        left: pf0(sv(style, "borderLeftWidth")),
    };
    let colors = Sides {
        top: Some(sv(style, "borderTopColor")),
        right: Some(sv(style, "borderRightColor")),
        bottom: Some(sv(style, "borderBottomColor")),
        left: Some(sv(style, "borderLeftColor")),
    };
    let own_bg = parse_any_color(sv_opt(style, "backgroundColor"));
    // An accent on any edge is gated on the corners (left and right by the
    // rounded-card decision, top and bottom by r6-t2-side-tab-bands).
    let corners = if widths.top > 0.0 || widths.right > 0.0 || widths.bottom > 0.0 || widths.left > 0.0 {
        resolve_side_accent_corners(el, style, pf0(sv(style, "width")))
    } else {
        None
    };
    check_borders(
        tag,
        &widths,
        &colors,
        resolved_radius,
        &BorderOpts {
            tab_context: is_tab_context_element(el),
            status_context: is_status_context_element(el),
            badge_like: own_bg.is_some_and(|c| c.alpha_or_one() > 0.1),
            corners,
        },
    )
}

/// The element's `color`, custom properties resolved first as the colour
/// checks read it.
fn resolved_text_color(style: &StyleValues, custom_props: CustomPropMap<'_>) -> Option<Rgba> {
    custom_props
        .and_then(|m| measures::parse_color_resolved(sv_opt(style, "color"), Some(m)))
        .or_else(|| parse_rgb(sv_opt(style, "color")))
}

/// Whether an ancestor carrying direct text is one the contrast pass
/// actually scores, so a descendant sharing its colour can stand down. A
/// SAFE_TAG ancestor is only scored under the same predicate its
/// descendant is, and an ancestor whose own text is an arrow, an icon glyph
/// or a pair of braces is not scored at all, whatever its tag —
/// `<a><span>Read more</span> →</a>` has to report the span, because nothing
/// reports the anchor.
fn ancestor_scores_its_text(el: &StaticElement<'_>, direct: &str) -> bool {
    if is_emoji_only_text(direct) || is_glyph_only_text(direct) {
        return false;
    }
    if !SAFE_TAGS.contains(&el.tag_lower().as_str()) {
        return true;
    }
    !is_visually_hidden(el, el.style())
}

/// Whether this element's `color` comes from an ancestor the contrast pass
/// scores on its own, so repeating it here would report one washed-out
/// colour twice. The walk stops at the first ancestor painting a different
/// colour (nothing above it can be the source of this one), at the first
/// one painting a surface of its own without text on it (above that the
/// colour is judged against a different background, which is a different
/// verdict), and at a fixed depth, so it costs a handful of parent hops.
fn inherits_scored_text_color(
    el: &StaticElement<'_>,
    text_color: Option<Rgba>,
    custom_props: CustomPropMap<'_>,
) -> bool {
    const MAX_ANCESTORS: usize = 12;
    let mut cur = el.parent_element();
    for _ in 0..MAX_ANCESTORS {
        let Some(c) = cur else { return false };
        if resolved_text_color(c.style(), custom_props) != text_color {
            return false;
        }
        let direct = c.direct_text();
        if !js::trim(&direct).is_empty() {
            return ancestor_scores_its_text(&c, &direct);
        }
        if read_own_background_color(&c, c.style()).map_or(false, |b| a_gt(&b, 0.0)) {
            return false;
        }
        cur = c.parent_element();
    }
    false
}

/// An inactive control. WCAG 1.4.3 exempts them, and a ghost or transparent
/// disabled button is exactly the shape the SAFE_TAGS text path would
/// otherwise start reporting.
const DISABLED_CONTROL_SELECTOR: &str = "[disabled], [aria-disabled=\"true\"]";

/// Whether an ancestor clips its background to text, which makes this run's
/// glyphs part of that ancestor's fill: `<p class="gradient"><span>Split</span>
/// <span>word</span></p>`. What a reader sees there is the gradient, and the
/// span's declared `color` is either painted over nothing (a transparent
/// `-webkit-text-fill-color`, which the static cascade drops, so this engine
/// cannot see it) or painted over the gradient's own glyph shapes. Either way
/// the walk hands the check the gradient's stops as the surface, and the
/// verdict is about a surface nobody reads the text against.
///
/// The static cascade does carry `background-clip`, so the ancestor is
/// visible where the fill colour is not. The walk stops at an ancestor with
/// an opaque background of its own, because a box painted normally inside
/// the clipped one is a real surface again, and at a fixed depth.
fn text_clipped_by_an_ancestor(el: &StaticElement<'_>) -> bool {
    const MAX_ANCESTORS: usize = 12;
    let mut cur = el.parent_element();
    for _ in 0..MAX_ANCESTORS {
        let Some(c) = cur else { return false };
        let style = c.style();
        if js::trim(sv(style, "webkitBackgroundClip")) == "text"
            || js::trim(sv(style, "backgroundClip")) == "text"
        {
            return true;
        }
        if read_own_background_color(&c, style).map_or(false, |b| b.alpha_or_one() >= 0.95) {
            return false;
        }
        cur = c.parent_element();
    }
    false
}

/// Whether an element's background image is an icon beside its text: one
/// inline SVG at most `ICON_MAX_PX` on both axes. The static cascade carries
/// neither `background-size` nor `background-repeat`, so only a data URI,
/// whose root `<svg>` states its size, can be read as one. A remote file has
/// no size this engine can read and stays a picture.
fn background_is_icon(el: &StaticElement<'_>) -> bool {
    let image = sv(el.style(), "backgroundImage");
    !js::to_lower_case(image).contains("gradient")
        && data_svg_intrinsic_size(image).map_or(false, |(w, h)| w <= ICON_MAX_PX && h <= ICON_MAX_PX)
}

/// The boxes whose background image is an icon beside this element's text:
/// the element itself (an external-link mark) and its nearest `li` (an arrow
/// bullet).
fn icon_hosts(el: &StaticElement<'_>) -> Vec<ego_tree::NodeId> {
    const MAX_ANCESTORS: usize = 12;
    let mut hosts = Vec::new();
    if background_is_icon(el) {
        hosts.push(el.id());
    }
    let mut cur = el.parent_element();
    for _ in 0..MAX_ANCESTORS {
        let Some(c) = cur else { break };
        if c.tag_lower() == "li" {
            if background_is_icon(&c) {
                hosts.push(c.id());
            }
            break;
        }
        cur = c.parent_element();
    }
    hosts
}

/// The element's own declared `opacity`, `1` where it does not read.
fn opacity_of(style: &StyleValues) -> f64 {
    let raw = sv(style, "opacity");
    let v = parse_float(raw);
    if js::trim(raw).is_empty() || !v.is_finite() {
        1.0
    } else {
        v.clamp(0.0, 1.0)
    }
}

/// The ink a reader sees once the opacity of the boxes between the text and
/// its surface is applied. The browser engine's fold (see
/// `impeccable_core::browser::element_checks`) over the cascade's declared
/// opacity: only boxes below the surface take part, a faded box with no fill
/// inside it fades the glyphs alone, and one with a fill fades both.
fn fold_surface_opacity(
    el: &StaticElement<'_>,
    ink: &Rgba,
    surface: &TextSurface,
    effective_bg: &mut Option<Rgba>,
) -> Option<Rgba> {
    const MAX_ANCESTORS: usize = 64;
    let mut layers: Vec<(Option<Rgba>, f64)> = Vec::new();
    let mut cur = Some(*el);
    let mut reached = false;
    for _ in 0..MAX_ANCESTORS {
        let Some(c) = cur else {
            reached = surface.host.is_none();
            break;
        };
        if Some(c.id()) == surface.host {
            reached = true;
            break;
        }
        let fill = surface.overlays.iter().find(|(n, _)| *n == c.id()).map(|(_, f)| *f);
        layers.push((fill, opacity_of(c.style())));
        cur = c.parent_element();
    }
    if !reached {
        return None;
    }
    let product: f64 = layers.iter().map(|(_, o)| *o).product();
    if !(product < 0.999) {
        return None;
    }
    let outermost_fade = layers.iter().rposition(|(_, o)| *o < 0.999)?;
    let fill_inside_fade = layers[..=outermost_fade].iter().any(|(f, _)| f.is_some());
    if !fill_inside_fade {
        return Some(Rgba {
            a: Some(ink.alpha_or_one() * product),
            ..*ink
        });
    }
    if effective_bg.is_none() {
        return None;
    }
    let base = surface.base?;
    let (fg, bg) = impeccable_core::checks::gradient_geometry::fold_opacity(ink, &layers, &base);
    *effective_bg = Some(bg);
    Some(fg)
}

/// Text a reader sees as an icon rather than words, as the URL engine reads
/// it (`element_checks::is_icon_text`): no letter or digit, a ligature set in
/// an icon font, or a Latin `x` in a control that names itself a close or
/// dismiss button.
fn is_icon_text(el: &StaticElement<'_>, style: &StyleValues, direct: &str) -> bool {
    if is_glyph_only_text(direct) || is_icon_ligature_text(direct, sv(style, "fontFamily")) {
        return true;
    }
    if !is_close_letter_text(direct) {
        return false;
    }
    let mut boxes = vec![*el];
    if let Some(p) = el.parent_element() {
        boxes.push(p);
    }
    if let Some(control) = el.closest("button, [role=\"button\"], a") {
        boxes.push(control);
    }
    boxes.iter().any(|b| {
        let values: Vec<&str> = ["class", "id", "aria-label", "title"]
            .iter()
            .filter_map(|name| b.get_attribute(name))
            .collect();
        names_close_control(&values)
    })
}

const STRIPE_CHILD_SKIP: &str = "nav, blockquote, pre, table, button, a, select, progress, meter, [role=\"progressbar\"], [role=\"slider\"], [role=\"scrollbar\"], [role=\"separator\"], [role=\"tablist\"]";

fn static_edge_hugs(value: &str) -> bool {
    let n = parse_float(value);
    n.is_finite() && n.abs() <= 2.0
}

/// A width in px for the absolute CSS units (plus rem/em at 16px). `8%` or
/// `10vw` depends on a box the static engine does not lay out, so it is `None`.
fn static_stripe_width_px(value: &str) -> Option<f64> {
    if let Some(px) = css_length_to_px(value) {
        return Some(px);
    }
    let v = js::to_lower_case(js::trim(value));
    let split = v.find(|c: char| c.is_ascii_alphabetic())?;
    let n: f64 = v[..split].parse().ok()?;
    let per_unit = match &v[split..] {
        "pt" => 96.0 / 72.0,
        "pc" => 16.0,
        "in" => 96.0,
        "cm" => 96.0 / 2.54,
        "mm" => 96.0 / 25.4,
        "q" => 96.0 / 101.6,
        _ => return None,
    };
    Some(n * per_unit)
}

/// The first value token of a computed longhand that a shorthand or `var()`
/// may have filled with a whole list (`wrap column`, `center stretch`).
fn first_keyword(value: &str, allowed: &[&str]) -> Option<String> {
    value
        .split_ascii_whitespace()
        .map(js::to_lower_case)
        .find(|t| allowed.is_empty() || allowed.contains(&t.as_str()))
}

/// JS: checks.mjs#checkElementStripeChild(el, style)
pub fn check_element_stripe_child(el: &StaticElement<'_>, style: &StyleValues) -> Vec<RuleHit> {
    let tag = el.tag_lower();
    if tag != "div" && tag != "span" {
        return Vec::new();
    }
    let Some(host) = el.parent_element() else {
        return Vec::new();
    };
    if host.tag_lower() == "body"
        || host.tag_lower() == "html"
        || impeccable_core::browser::element_checks::is_stripe_heading_host(&host.tag_lower())
    {
        return Vec::new();
    }
    if !el.children().is_empty() {
        return Vec::new();
    }
    if !collapsed_text_content(el).is_empty() {
        return Vec::new();
    }
    if el.closest(STRIPE_CHILD_SKIP).is_some() {
        return Vec::new();
    }
    if is_tab_context_element(el) || is_status_context_element(el) {
        return Vec::new();
    }

    let width = static_stripe_width_px(sv(style, "width")).unwrap_or(0.0);
    let position = js::to_lower_case(sv(style, "position"));
    let height_raw = js::to_lower_case(sv(style, "height"));
    // Height is not inherited, so initial and unset both reset it to auto.
    let auto_height = matches!(height_raw.as_str(), "" | "auto" | "initial" | "unset");
    let host_style = host.style();
    let edge = if position == "absolute" || position == "fixed" {
        // The cascade already expands inset; a winning `auto` longhand
        // must not be overwritten by the earlier shorthand.
        let inset = ["top", "right", "bottom", "left"].map(|prop| sv(style, prop));
        // Opposing insets stretch only an auto-height box. With a definite
        // height CSS drops the bottom constraint instead of stretching it.
        let height_stretches = height_raw == "100%"
            || (auto_height && static_edge_hugs(&inset[0]) && static_edge_hugs(&inset[2]));
        if !height_stretches {
            return Vec::new();
        }
        if static_edge_hugs(&inset[3]) {
            Some("left")
        } else if static_edge_hugs(&inset[1]) {
            Some("right")
        } else {
            None
        }
    } else {
        let pdisplay = sv(host_style, "display");
        if !pdisplay.contains("flex") {
            return Vec::new();
        }
        let pdir = first_keyword(
            sv(host_style, "flexDirection"),
            &["row", "row-reverse", "column", "column-reverse"],
        )
        .unwrap_or_else(|| "row".to_string());
        if pdir.starts_with("column") {
            return Vec::new();
        }
        let align_self = first_keyword(sv(style, "alignSelf"), &[]).unwrap_or_default();
        let effective_align = if !align_self.is_empty() && align_self != "auto" {
            align_self
        } else {
            first_keyword(sv(host_style, "alignItems"), &[]).unwrap_or_default()
        };
        let is_stretch = effective_align.is_empty()
            || effective_align == "stretch"
            || effective_align == "normal";
        let height_stretches = height_raw == "100%" || (auto_height && is_stretch);
        if !height_stretches {
            return Vec::new();
        }
        let siblings = host.children();
        if siblings.len() < 2 {
            return Vec::new();
        }
        let reverse = pdir.contains("reverse");
        if siblings.first() == Some(el) {
            Some(if reverse { "right" } else { "left" })
        } else if siblings.last() == Some(el) {
            Some(if reverse { "left" } else { "right" })
        } else {
            None
        }
    };

    // Only on a host rounded away from the stripe (r6-t2), read the way the
    // CSS-text stripe forms read their hosts.
    if let Some(side) = edge.map(|e| if e == "left" { 3 } else { 1 }) {
        let corners = resolve_side_accent_corners(&host, host_style, pf0(sv(host_style, "width")));
        if !is_rounded_away_from_side(corners.as_ref(), side) {
            return Vec::new();
        }
    }
    let bg_raw = sv(style, "backgroundColor");
    let bg = parse_rgb(Some(&bg_raw)).or_else(|| parse_any_color(Some(&bg_raw)));
    check_stripe_child(&class_selector(el), width, edge, bg)
}

/// JS: checks.mjs#checkElementColors(el, style, tag, window, customPropMap, hasAnchorInheritRule)
pub fn check_element_colors(
    el: &StaticElement<'_>,
    style: &StyleValues,
    tag: &str,
    custom_props: CustomPropMap<'_>,
    seen: &mut SafeTagTextSeen,
) -> Vec<RuleHit> {
    if sv_opt(style, "visibility") == Some("hidden") {
        return Vec::new();
    }
    // Markup the browser never lays out: a `<template>`'s content, a
    // `[hidden]` subtree, a `<noscript>`, anything under `<head>`. The static
    // tree carries it and a browser scan cannot see it, so scoring it here is
    // a false positive only this engine can produce. Nothing viewport-shaped
    // belongs in that gate; see `is_in_non_rendered_markup`.
    if is_in_non_rendered_markup(el, tag) {
        return Vec::new();
    }
    let mut eff_opacity = 1.0f64;
    let mut cur = Some(*el);
    while let Some(c) = cur {
        if !(eff_opacity > 0.02) {
            break;
        }
        let op = sv(c.style(), "opacity");
        let op = if op.is_empty() { "1" } else { op };
        eff_opacity *= parse_float(op);
        cur = c.parent_element();
    }
    if eff_opacity <= 0.02 {
        return Vec::new();
    }
    let direct_text = el.direct_text();
    let has_direct_text = !js::trim(&direct_text).is_empty();
    let text_color = resolved_text_color(style, custom_props);
    // hasAnchorInheritRule is always false in the static engine.
    let icon_text = has_direct_text && is_icon_text(el, style, &direct_text);

    // Only the SAFE_TAGS gate in `check_colors` reads this, so the ancestor
    // walk and the hidden-text selector run only for those tags.
    let paints_own_text = has_direct_text
        && SAFE_TAGS.contains(&tag)
        && !is_emoji_only_text(&direct_text)
        && !icon_text
        && !is_visually_hidden(el, style)
        // The browser path also stands down where `-webkit-text-fill-color`
        // paints the glyphs in nothing. This engine cannot: the static
        // cascade drops that property, and a recorded call vector pins it
        // dropping it. The clip that property travels with is carried, so
        // a run inside a gradient-clipped parent is caught by the clip.
        && !text_clipped_by_an_ancestor(el)
        && el.closest(DISABLED_CONTROL_SELECTOR).is_none()
        && !inherits_scored_text_color(el, text_color, custom_props);

    // The walk gives up on any raster image, so a link with an external-link
    // mark, or one in a list item with an arrow bullet, reads as unresolved
    // and goes unscored. On the SAFE_TAGS text path an icon is read as
    // absent; everywhere else the walk is what it always was.
    let icons = if paints_own_text {
        icon_hosts(el)
    } else {
        Vec::new()
    };
    let font_size = {
        let n = parse_float(sv(style, "fontSize"));
        if num_truthy(n) {
            n
        } else {
            16.0
        }
    };
    // The coverage test compares a tile's px height with the text's. A size
    // in `em` or `rem` has no px value here, and the 9px floor below which
    // nothing is scored is the smallest the text can be.
    let coverage_font_px = if js::trim(sv(style, "fontSize")).ends_with("px") {
        font_size
    } else {
        9.0
    };
    let surface = resolve_text_surface(el, custom_props, &|c| icons.contains(&c.id()), coverage_font_px);
    let effective_bg = surface.info.color;

    let mut own_bg = custom_props
        .and_then(|m| measures::parse_color_resolved(sv_opt(style, "backgroundColor"), Some(m)))
        .or_else(|| read_own_background_color(el, style));

    let mut final_effective_bg = effective_bg;
    let mut surface_unresolved = surface.info.unresolved;
    let mut pseudo_surface_read = false;
    if own_bg.is_none() || own_bg.is_some_and(|c| c.alpha_or_one() <= 0.5) {
        if let Some(pseudo) = el.doc.get_pseudo_surface(el.id()) {
            own_bg = Some(pseudo);
            final_effective_bg = Some(pseudo);
            surface_unresolved = false;
            pseudo_surface_read = true;
        }
    }

    let (effective_bg_stops, bg_source, bg_source_host) =
        if surface_unresolved || final_effective_bg.is_some() {
            (None, None, None)
        } else {
            let stops = resolve_text_gradient_stops(el, custom_props, &surface);
            let source = stops
                .as_ref()
                .and(surface.gradient_label.as_ref())
                .map(|label| format!("gradient on {label}"));
            let host = source
                .as_ref()
                .and(surface.gradient_host)
                .map(|id| format!("{id:?}"));
            (stops, source, host)
        };
    let visible_text = match text_color {
        Some(ink) if !pseudo_surface_read && !surface_unresolved => {
            fold_surface_opacity(el, &ink, &surface, &mut final_effective_bg)
        }
        _ => None,
    }
    .or_else(|| text_color.filter(|c| c.a.is_some_and(|a| a < 1.0)));
    // An element's own gradient whose tile cannot cover its text (a hover
    // underline) does not make it a styled control.
    let own_image = if surface.skipped_images.contains(&el.id()) {
        "none"
    } else {
        sv(style, "backgroundImage")
    };
    let font_weight = {
        let n = parse_int(sv(style, "fontWeight"), 10);
        if num_truthy(n) {
            n
        } else {
            400.0
        }
    };
    let font_weight =
        impeccable_core::checks::rules::contrast_font_weight(font_weight, sv(style, "fontFamily"));
    let bg_clip = {
        let a = sv(style, "webkitBackgroundClip");
        if !a.is_empty() {
            a
        } else {
            sv(style, "backgroundClip")
        }
    };
    let color_opts = ColorOpts {
        tag: tag.to_string(),
        text_color,
        bg_color: own_bg,
        effective_bg: if surface_unresolved {
            None
        } else {
            final_effective_bg
        },
        effective_bg_stops,
        font_size,
        font_weight,
        has_direct_text,
        is_emoji_only: is_emoji_only_text(&direct_text),
        is_glyph_only: icon_text,
        paints_own_text,
        bg_clip: Some(bg_clip.to_string()),
        bg_image: Some(own_image.to_string()),
        class_list: Some(el.class_name().to_string()),
        detector_is_browser: false,
        visible_text,
        bg_source,
        bg_source_host,
        same_color_surface_is_unread: true,
    };
    // The page's one report of a colour pair goes to an element that will
    // actually print it, so an inline ignore on the first of fifty links
    // waives that link and not the other forty-nine. A background photo laid
    // under the text waives it too: this engine has no layout, so it reads
    // the stretched, out-of-flow shape such a photo is written in
    // (`picture_under_text`), where the browser path measures the layers.
    // Text with no reading job (avatar initials, a version stamp, a
    // signature, a mockup's labels) reports as advisory, asked only of an
    // element that failed.
    let decorative = std::cell::OnceCell::new();
    let is_decorative =
        || *decorative.get_or_init(|| crate::decorative_text::is_decorative_text(el));
    let mut findings = check_colors_deduped_shaped(
        &color_opts,
        seen,
        None,
        &is_decorative,
        &mut |h: &RuleHit| !scoped_ignore_active(el, &h.id) && !picture_under_text(el),
    );
    if tag == "input" || tag == "textarea" {
        let placeholder = el.get_attribute("placeholder").unwrap_or("").trim();
        if !placeholder.is_empty() {
            let skip = if tag == "input" {
                let t = js::to_lower_case(el.get_attribute("type").unwrap_or("text"));
                matches!(
                    t.as_str(),
                    "hidden" | "checkbox" | "radio" | "file" | "submit" | "button" | "image"
                        | "reset" | "range" | "color"
                ) || el
                    .get_attribute("value")
                    .is_some_and(|v| !js::trim(v).is_empty())
            } else {
                !js::trim(&direct_text).is_empty()
            };
            if !skip {
                if let Some(ph_style) = el.doc.get_placeholder_style(el.id()) {
                    let ph_color = custom_props
                        .and_then(|m| {
                            measures::parse_color_resolved(sv_opt(ph_style, "color"), Some(m))
                        })
                        .or_else(|| parse_rgb(sv_opt(ph_style, "color")))
                        .or_else(|| parse_any_color(sv_opt(ph_style, "color")));
                    if let Some(ph_color) = ph_color {
                        let mut hits = check_placeholder_colors(&color_opts, placeholder, ph_color);
                        if hits.iter().any(|h| h.id == "low-contrast")
                            && (is_decorative() || crate::field_label::field_has_visible_label(el))
                        {
                            impeccable_core::checks::rules::demote_low_contrast(&mut hits);
                        }
                        findings.extend(hits);
                    }
                }
            }
        }
    }
    // A disabled control is faded on purpose: its colours are not a contrast
    // verdict (WCAG 1.4.3 exempts inactive controls).
    if el.closest(DISABLED_CONTROL_SELECTOR).is_some() {
        findings.retain(|h| h.id != "low-contrast");
    }
    findings
}

/// JS: checks.mjs#checkElementHoverContrast(el, style, tag, window)
pub fn check_element_hover_contrast(
    el: &StaticElement<'_>,
    style: &StyleValues,
    tag: &str,
) -> Vec<RuleHit> {
    let Some(hover) = el.doc.get_hover_style(el.id()) else {
        return Vec::new();
    };
    let direct_text = el.direct_text();
    if js::trim(&direct_text).is_empty() {
        return Vec::new();
    }
    let Some(text_color) = parse_any_color(sv_opt(hover, "color")) else {
        return Vec::new();
    };
    if text_color.a.is_some_and(|a| a < 1.0) {
        return Vec::new();
    }
    let resting_own_bg = parse_any_color(sv_opt(style, "backgroundColor"));
    let hover_own_bg = parse_any_color(sv_opt(hover, "backgroundColor"));
    let own_bg = hover_own_bg.or(resting_own_bg);

    let bg = if own_bg.is_some_and(|c| a_ge(&c, 0.99)) {
        own_bg.unwrap()
    } else {
        let base_el = el.parent_element().unwrap_or(*el);
        let Some(under) = resolve_background(&base_el, None) else {
            return Vec::new();
        };
        match own_bg {
            Some(c) if a_gt(&c, 0.1) => composite_color_over(&c, &under),
            _ => under,
        }
    };
    let font_weight = {
        let n = parse_int(sv(style, "fontWeight"), 10);
        if num_truthy(n) {
            n
        } else {
            400.0
        }
    };
    let font_weight =
        impeccable_core::checks::rules::contrast_font_weight(font_weight, sv(style, "fontFamily"));
    let font_size = {
        let n = parse_float(sv(style, "fontSize"));
        if num_truthy(n) {
            n
        } else {
            16.0
        }
    };
    check_hover_contrast(&HoverContrastOpts {
        tag: tag.to_string(),
        text_color: Some(text_color),
        bg: Some(bg),
        own_bg_alpha: own_bg.map(|c| c.alpha_or_one()),
        font_size,
        font_weight,
        has_direct_text: true,
        is_emoji_only: is_emoji_only_text(&direct_text),
    })
}

/// JS: checks.mjs#checkElementIconTile(el, tag, window)
pub fn check_element_icon_tile(el: &StaticElement<'_>, tag: &str) -> Vec<RuleHit> {
    if !is_heading_tag(tag) {
        return Vec::new();
    }
    let Some(sibling) = el.previous_element_sibling() else {
        return Vec::new();
    };
    let sib_style = sibling.style();
    let sib_width = pf0(sv(sib_style, "width"));
    let sib_height = pf0(sv(sib_style, "height"));
    let icon_child =
        sibling.query_selector("svg, i[data-lucide], i[class*=\"fa-\"], i[class*=\"icon\"]");
    let mut icon_width = 0.0;
    if let Some(icon) = icon_child.as_ref() {
        let w = parse_float(sv(icon.style(), "width"));
        if num_truthy(w) {
            icon_width = w;
        } else {
            let a = parse_float(icon.get_attribute("width").unwrap_or(""));
            icon_width = if num_truthy(a) { a } else { 0.0 };
        }
    }
    let sib_direct_text = sibling.direct_text();
    let has_inline_emoji_icon =
        sibling.children().is_empty() && is_emoji_only_text(&sib_direct_text);
    check_icon_tile(&IconTileOpts {
        heading_tag: tag.to_string(),
        heading_text: Some(el.text_content()),
        heading_top: 0.0,
        sibling_tag: Some(sibling.tag_lower()),
        sibling_width: sib_width,
        sibling_height: sib_height,
        sibling_bottom: 0.0,
        sibling_bg_color: parse_rgb(sv_opt(sib_style, "backgroundColor")),
        sibling_bg_image: Some(sv(sib_style, "backgroundImage").to_string()),
        // A ring drawn by a zero-blur box-shadow (`ring-1`) is the tile's
        // border as far as a reader can tell.
        sibling_border_width: pf0(sv(sib_style, "borderTopWidth")).max(
            impeccable_core::checks::measures::parse_shadow_layers(sv(sib_style, "boxShadow"))
                .iter()
                .filter(|l| {
                    l.alpha >= impeccable_core::checks::measures::FAINT_PAINT_ALPHA
                        && l.x == 0.0
                        && l.y == 0.0
                        && l.blur == 0.0
                        && l.spread >= 0.5
                })
                .map(|l| l.spread)
                .fold(0.0, f64::max),
        ),
        sibling_border_radius: resolve_border_radius_px(sib_style, sib_width),
        has_icon_child: icon_child.is_some() || has_inline_emoji_icon,
        icon_child_width: icon_width,
        heading_is_card_title: false,
    })
}

/// JS: checks.mjs#checkElementItalicSerif(el, style, tag)
pub fn check_element_italic_serif(
    el: &StaticElement<'_>,
    style: &StyleValues,
    tag: &str,
) -> Vec<RuleHit> {
    if tag != "h1" && tag != "h2" {
        return Vec::new();
    }
    let mut pending = vec![*el];
    while let Some(node) = pending.pop() {
        let mut ancestor = Some(node);
        let mut hidden = false;
        while let Some(parent) = ancestor {
            let s = parent.style();
            if sv(s, "display") == "none"
                || matches!(sv(s, "visibility"), "hidden" | "collapse")
                || sv(s, "contentVisibility") == "hidden"
                || sv_opt(s, "opacity").is_some_and(|v| parse_float(v) <= 0.01)
                || parent.get_attribute("aria-hidden").as_deref() == Some("true")
                || parent.get_attribute("hidden").is_some()
            {
                hidden = true;
                break;
            }
            ancestor = parent.parent_element();
        }
        if hidden {
            continue;
        }
        if !js::trim(&node.direct_text()).is_empty() {
            let s = if node == *el { style } else { node.style() };
            let hits = check_italic_serif(&ItalicSerifOpts {
                tag: tag.to_string(),
                font_style: Some(sv(s, "fontStyle").to_string()),
                font_family: Some(sv(s, "fontFamily").to_string()),
                font_size: resolve_hero_heading_size_px(sv_opt(s, "fontSize")),
                heading_text: Some(el.text_content()),
            });
            if !hits.is_empty() {
                return hits;
            }
        }
        pending.extend(node.children().into_iter().rev());
    }
    Vec::new()
}

/// JS: checks.mjs#checkElementHeroEyebrow(el, style, tag, window, customPropMap)
pub fn check_element_hero_eyebrow(
    el: &StaticElement<'_>,
    style: &StyleValues,
    tag: &str,
) -> Vec<RuleHit> {
    if tag != "h1" {
        return Vec::new();
    }
    let Some(sibling) = el.previous_element_sibling() else {
        return Vec::new();
    };
    let sib_style = sibling.style();
    // customPropMap is null in the static engine: raw values pass through.
    let font_size_raw = sv(sib_style, "fontSize");
    let font_weight_raw = sv(sib_style, "fontWeight");
    let letter_spacing_raw = sv_opt(sib_style, "letterSpacing");
    let color_raw = sv(sib_style, "color");
    let heading_font_size_raw = sv_opt(style, "fontSize");
    let sibling_font_size = pf0(font_size_raw);
    check_hero_eyebrow(&HeroEyebrowOpts {
        heading_tag: tag.to_string(),
        heading_text: Some(el.text_content()),
        heading_font_size: resolve_hero_heading_size_px(heading_font_size_raw),
        heading_in_application_context: el
            .closest("[role=\"tabpanel\"], [role=\"dialog\"], [role=\"application\"], dialog")
            .is_some(),
        sibling_tag: Some(sibling.tag_lower()),
        sibling_text: Some(sibling.text_content()),
        sibling_text_transform: Some(sv(sib_style, "textTransform").to_string()),
        sibling_font_size,
        sibling_letter_spacing: match resolve_length_px(letter_spacing_raw, sibling_font_size) {
            Some(n) if num_truthy(n) => n,
            _ => 0.0,
        },
        sibling_font_weight: Some(font_weight_raw.to_string()),
        sibling_color: Some(color_raw.to_string()),
        sibling_has_accent_dash_pseudo: el.doc.has_accent_dash_pseudo(sibling.id()),
        sibling_tracking_floor_em: Some(impeccable_core::checks::rules::HERO_EYEBROW_TRACKING_EM),
        sibling_holds_time: sibling.tag_lower() == "time"
            || sibling.query_selector("time").is_some(),
    })
}

/// JS: checks.mjs#checkElementMotion(tag, style)
pub fn check_element_motion(tag: &str, style: &StyleValues) -> Vec<RuleHit> {
    let timing: Vec<&str> = [
        sv(style, "animationTimingFunction"),
        sv(style, "transitionTimingFunction"),
    ]
    .into_iter()
    .filter(|s| !s.is_empty())
    .collect();
    check_motion(&MotionOpts {
        tag: tag.to_string(),
        animation_name: Some(sv(style, "animationName").to_string()),
        timing_functions: Some(timing.join(" ")),
        class_list: Some(String::new()),
    })
}

/// JS: checks.mjs#checkElementGlow(tag, style, effectiveBg)
pub fn check_element_glow(
    style: &StyleValues,
    effective_bg: Option<impeccable_core::color::Rgba>,
) -> Vec<RuleHit> {
    let box_shadow = match sv_opt(style, "boxShadow") {
        Some(v) if !v.is_empty() && v != "none" => v,
        _ => "",
    };
    let text_shadow = match sv_opt(style, "textShadow") {
        Some(v) if !v.is_empty() && v != "none" => v,
        _ => "",
    };
    if box_shadow.is_empty() && text_shadow.is_empty() {
        return Vec::new();
    }
    // Static HTML has no layout, so the element's size stays unknown and the
    // perceptibility floor runs on the declaration and the opacity alone.
    let opacity = match sv_opt(style, "opacity") {
        Some(v) => {
            let n = js::parse_float(v);
            if n.is_nan() {
                None
            } else {
                Some(n.clamp(0.0, 1.0))
            }
        }
        None => None,
    };
    check_glow(&GlowOpts {
        box_shadow: Some(box_shadow.to_string()),
        text_shadow: Some(text_shadow.to_string()),
        effective_bg,
        element_opacity: opacity,
        element_size: None,
        surface: None,
    })
}

/// JS: detect-html.mjs#checkElementBrokenImage(el)
pub fn check_element_broken_image(el: &StaticElement<'_>) -> Vec<RuleHit> {
    let Some(src) = el.get_attribute("src") else {
        return vec![RuleHit::new(
            "broken-image",
            "<img> with no src attribute".to_string(),
        )];
    };
    let trimmed = js::trim(src);
    if trimmed.is_empty() || trimmed == "#" {
        return vec![RuleHit::new(
            "broken-image",
            format!("<img src=\"{}\">", src),
        )];
    }
    Vec::new()
}

/// JS: checks.mjs#checkElementOversizedH1(el, style, tag, window)
pub fn check_element_oversized_h1(el: &StaticElement<'_>, tag: &str) -> Vec<RuleHit> {
    if tag != "h1" {
        return Vec::new();
    }
    let Some(font_size) = resolve_font_size_px(el) else {
        return Vec::new();
    };
    let heading_text = collapse_ws(js::trim(&el.text_content()));
    hits(check_oversized_h1(&OversizedH1Input {
        tag,
        font_size,
        heading_text: &heading_text,
        rect: None,
        viewport_width: 0.0,
        viewport_height: 0.0,
    }))
}

/// The hairline-and-halo pair of one element, read off its resolved style.
/// The halo is measured first: it is one string parse, where the hairlines
/// cost four style reads and two allocations, and a sibling row walk asks
/// this of every box it passes.
fn gpt_border_shadow_pair(style: &StyleValues) -> Option<(f64, f64)> {
    let box_shadow = sv(style, "boxShadow");
    gpt_border_shadow_halo_blur_px(Some(box_shadow))?;
    let s = StyleRef(style);
    let widths = border_widths_from_style(&s);
    let colors: Vec<Option<String>> = border_colors_from_style(&s)
        .into_iter()
        .map(|c| if c.is_empty() { None } else { Some(c) })
        .collect();
    gpt_thin_border_wide_shadow_pair(&GptBorderShadowInput {
        border_widths: &widths,
        border_colors: Some(&colors),
        box_shadow: Some(box_shadow),
    })
}

/// A declared pixel length (`width: 180px`), or `None` for anything a file
/// scan cannot size without layout (`auto`, percentages, keywords).
fn gpt_border_shadow_declared_px(style: &StyleValues, prop: &str) -> Option<f64> {
    let value = sv(style, prop).trim();
    if !value.ends_with("px") {
        return None;
    }
    let px = parse_float(value);
    (!px.is_nan()).then_some(px)
}

/// Whether a box shows at rest, as far as a file scan can tell without
/// layout. It does not when it or an ancestor is closed (the `hidden`
/// attribute or `display: none`), or when it is lifted out of the flow
/// (absolute or fixed, itself or up to
/// [`measures::GPT_BORDER_SHADOW_MAX_WRAPPER_DEPTH`] wrappers up) and hidden
/// by `visibility: hidden` or opacities that multiply down to nothing. An
/// in-flow box hidden that way is content staged for a scroll reveal, which
/// still shows. A transform that parks a box off the page needs layout to
/// read, so a file scan does not.
fn gpt_border_shadow_paints_at_rest(el: &StaticElement<'_>) -> bool {
    let mut opacity = 1.0f64;
    let mut hidden = false;
    let mut out_of_flow = false;
    let mut depth = 0usize;
    let mut current = Some(el.clone());
    while let Some(node) = current {
        if node.get_attribute("hidden").is_some() {
            return false;
        }
        let style = node.style();
        if js::to_lower_case(sv(style, "display")) == "none" {
            return false;
        }
        if depth <= measures::GPT_BORDER_SHADOW_MAX_WRAPPER_DEPTH {
            let position = js::to_lower_case(sv(style, "position"));
            out_of_flow |= position == "absolute" || position == "fixed";
        }
        let visibility = js::to_lower_case(sv(style, "visibility"));
        hidden |= visibility == "hidden" || visibility == "collapse";
        let own = parse_float(sv(style, "opacity"));
        if own.is_finite() {
            opacity *= own;
        }
        current = node.parent_element();
        depth += 1;
    }
    !(out_of_flow && (hidden || opacity <= 0.02))
}

/// The tree a row walk reads in a file scan, which has no layout: wrappers of
/// one kind share a tag, and two boxes are the same card when they share a
/// tag and every pixel length both of them declare is comparable. A length
/// only one of them declares, or neither, compares as unknown rather than as
/// a mismatch.
struct StaticRowTree<'a>(std::marker::PhantomData<StaticElement<'a>>);

impl<'a> GptBorderShadowRowTree for StaticRowTree<'a> {
    type El = StaticElement<'a>;
    fn parent(&self, el: &StaticElement<'a>) -> Option<StaticElement<'a>> {
        el.parent_element()
    }
    fn previous_sibling(&self, el: &StaticElement<'a>) -> Option<StaticElement<'a>> {
        el.previous_element_sibling()
    }
    fn next_sibling(&self, el: &StaticElement<'a>) -> Option<StaticElement<'a>> {
        el.next_element_sibling()
    }
    fn first_child(&self, el: &StaticElement<'a>) -> Option<StaticElement<'a>> {
        el.first_element_child()
    }
    fn same_cell(&self, cell: &StaticElement<'a>, other: &StaticElement<'a>) -> bool {
        cell.tag_lower() == other.tag_lower()
    }
    fn same_card(&self, card: &StaticElement<'a>, other: &StaticElement<'a>) -> bool {
        if card.tag_lower() != other.tag_lower() {
            return false;
        }
        ["width", "height"].into_iter().all(|prop| {
            match (
                gpt_border_shadow_declared_px(card.style(), prop),
                gpt_border_shadow_declared_px(other.style(), prop),
            ) {
                (Some(a), Some(b)) => gpt_border_shadow_lengths_close(a, b),
                _ => true,
            }
        })
    }
    fn carries_pair(&self, el: &StaticElement<'a>) -> bool {
        gpt_border_shadow_pair(el.style()).is_some()
    }
    fn paints_at_rest(&self, el: &StaticElement<'a>) -> bool {
        gpt_border_shadow_paints_at_rest(el)
    }
}

/// JS: checks.mjs#checkElementGptBorderShadow(el, style)
pub fn check_element_gpt_border_shadow(
    el: &StaticElement<'_>,
    style: &StyleValues,
) -> Vec<RuleHit> {
    // The row walk is worth paying for only once this element carries the
    // pair itself.
    let Some(pair) = gpt_border_shadow_pair(style) else {
        return Vec::new();
    };
    hits(gpt_border_shadow_row_finding(
        pair,
        gpt_border_shadow_row_size(&StaticRowTree(std::marker::PhantomData), el),
    ))
}

// ─── Clipped overflow container ─────────────────────────────────────────────

/// JS: checks.mjs#classSelector(el)
pub fn class_selector(el: &StaticElement<'_>) -> String {
    let cls = js::trim(el.class_name());
    let tokens: Vec<&str> = if cls.is_empty() {
        Vec::new()
    } else {
        WS_RE.split(cls).filter(|s| !s.is_empty()).collect()
    };
    let tag = el.tag_lower();
    if tokens.is_empty() {
        tag
    } else {
        format!("{}.{}", tag, tokens.join("."))
    }
}

static VIEWPORT_ROLE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?-u:\b)(carousel|slider)(?-u:\b)").expect("VIEWPORT_ROLE_RE"));

/// JS: checks.mjs#positionedChildHasSubstantiveContent(child)
fn positioned_child_has_substantive_content(child: &StaticElement<'_>) -> bool {
    let text = collapsed_text_content(child);
    if !text.is_empty() {
        return true;
    }
    // StaticElement has no `matches`; only the descendant query applies.
    child
        .query_selector(POSITIONED_CHILD_INTERACTIVE_SELECTOR)
        .is_some()
}

/// JS: checks.mjs#positionedChildIsDecorative(child)
fn positioned_child_is_decorative(child: &StaticElement<'_>) -> bool {
    if child.closest("[aria-hidden=\"true\"]").is_some() {
        return true;
    }
    let role = js::to_lower_case(child.get_attribute("role").unwrap_or(""));
    if role == "none" || role == "presentation" {
        return true;
    }
    let tag = child.tag_lower();
    if matches!(tag.as_str(), "img" | "svg" | "canvas" | "video") {
        return true;
    }
    let ident = format!(
        "{} {}",
        child.get_attribute("class").unwrap_or(""),
        child.get_attribute("id").unwrap_or("")
    );
    if impeccable_core::checks::measures::ident_names_any(
        &ident,
        impeccable_core::browser::element_checks::DECOR_IDENT_WORDS,
        &[],
    ) && !positioned_child_has_substantive_content(child)
    {
        return true;
    }
    false
}

/// JS `el.matches(selector)`: `closest` stops at the element itself, so a
/// self match is the one it returns.
fn element_matches(el: &StaticElement<'_>, selector: &str) -> bool {
    el.closest(selector).is_some_and(|m| m.id() == el.id())
}

/// A layer the clip would really trap, whatever else it looks like. The layer
/// itself counts, not only a descendant of it: an empty `role="menu"` is a
/// menu.
fn positioned_child_is_popover_layer(child: &StaticElement<'_>) -> bool {
    element_matches(child, POPOVER_LAYER_SELECTOR)
        || child.query_selector(POPOVER_LAYER_SELECTOR).is_some()
}

fn ident_names_viewport(el: &StaticElement<'_>) -> bool {
    let ident = format!(
        "{} {}",
        el.get_attribute("class").unwrap_or(""),
        el.get_attribute("id").unwrap_or("")
    );
    impeccable_core::checks::measures::ident_names_any(
        &ident,
        impeccable_core::browser::element_checks::VIEWPORT_IDENT_WORDS,
        impeccable_core::browser::element_checks::VIEWPORT_IDENT_PAIRS,
    )
}

/// JS: checks.mjs#clippingContainerIsIntentionalViewport(el)
fn clipping_container_is_intentional_viewport(el: &StaticElement<'_>) -> bool {
    let role_description =
        js::to_lower_case(el.get_attribute("aria-roledescription").unwrap_or(""));
    if VIEWPORT_ROLE_RE.is_match(&role_description) {
        return true;
    }
    if ident_names_viewport(el) {
        return true;
    }
    // A marquee or a rail names the track that moves, not the window that
    // clips it, so the same words count on the immediate scrolling child.
    el.children().iter().any(ident_names_viewport)
}

/// The clipped axes of `el`, or `None` when it is not a clipping container
/// at all (it scrolls, its overflow is visible, or `display: contents`
/// leaves it without a box to clip with).
fn clipped_axes(style: &StyleValues) -> Option<(bool, bool)> {
    let clips = |v: &str| v == "hidden" || v == "clip";
    let scrolls = |v: &str| v == "auto" || v == "scroll";
    let ox = sv(style, "overflowX");
    let oy = sv(style, "overflowY");
    let ov = sv(style, "overflow");
    let clip_x = clips(ox) || clips(ov);
    let clip_y = clips(oy) || clips(ov);
    if (!clip_x && !clip_y) || scrolls(ox) || scrolls(oy) || scrolls(ov) {
        return None;
    }
    let display = sv(style, "display");
    if display == "contents" || display == "none" {
        return None;
    }
    Some((clip_x, clip_y))
}

/// Whether `el` may report a clipped child, its own or one it takes off a
/// descendant container. `html` and `body` hold the page rather than any
/// component in it: `overflow: hidden` there is the standard guard against
/// sideways scrolling, and the browser engine never scans either, so a
/// finding handed to one of them would not exist there at all.
fn clip_container_can_own_finding(el: &StaticElement<'_>) -> bool {
    let tag = el.tag_lower();
    tag != "html" && tag != "body" && !clipping_container_is_intentional_viewport(el)
}

/// Nested clips repeat one decision about the same layer. The clip nearest
/// the child is the one that cuts it first and the one whose component the
/// layer belongs to, so an outer container defers to any clipping container
/// between it and the child that traps the same layer.
fn nearer_clip_traps_child(el: &StaticElement<'_>, child: &StaticElement<'_>) -> bool {
    let mut current = child.parent_element();
    while let Some(inner) = current {
        if inner.id() == el.id() {
            return false;
        }
        if let Some((clip_x, clip_y)) = clipped_axes(inner.style()) {
            if clip_container_can_own_finding(&inner)
                && positioned_style_implies_escape_axis(&StyleRef(child.style()), clip_x, clip_y)
            {
                return true;
            }
        }
        current = inner.parent_element();
    }
    false
}

/// JS: checks.mjs#checkClippedOverflow(el, style, getStyle) / checkElementClippedOverflow
pub fn check_element_clipped_overflow(el: &StaticElement<'_>, style: &StyleValues) -> Vec<RuleHit> {
    let Some((clip_x, clip_y)) = clipped_axes(style) else {
        return Vec::new();
    };
    if !clip_container_can_own_finding(el) {
        return Vec::new();
    }
    for child in el.query_selector_all("*") {
        let child_style = child.style();
        let pos = sv(child_style, "position");
        if pos != "absolute" && pos != "fixed" {
            continue;
        }
        // Only a popover layer is a layer a clip can trap; the rest of what
        // a clip cuts is the effect (decision r6-t1-clipped-overflow-popovers).
        if !positioned_child_is_popover_layer(&child) {
            continue;
        }
        if positioned_child_is_decorative(&child) {
            continue;
        }
        // A slide, a ticker track or a scroller names itself: what its window
        // cuts off is the next frame, wherever it sits under the container.
        if ident_names_viewport(&child) {
            continue;
        }
        // No layout statically: `positionedChildEscapesClip` is null, and
        // so is the transform offset of a masked reveal.
        if !positioned_style_implies_escape_axis(&StyleRef(child_style), clip_x, clip_y) {
            continue;
        }
        if nearer_clip_traps_child(el, &child) {
            continue;
        }
        return vec![RuleHit::new(
            "clipped-overflow-container",
            format!(
                "{} clips positioned {}",
                class_selector(el),
                class_selector(&child)
            ),
        )];
    }
    Vec::new()
}

/// Only resolved, visible box shadows participate; reference assets and class
/// names do not establish whether a neobrutalist treatment is intentional.
pub fn check_element_hard_offset_shadow(el: &StaticElement<'_>) -> Vec<RuleHit> {
    let mut current = Some(*el);
    while let Some(node) = current {
        if node.get_attribute("hidden").is_some() || sv(node.style(), "display") == "none" {
            return Vec::new();
        }
        current = node.parent_element();
    }
    if matches!(sv(el.style(), "visibility"), "hidden" | "collapse") { return Vec::new(); }
    impeccable_core::checks::hard_offset_shadow::check_hard_offset_shadow(
        sv(el.style(), "boxShadow"), sv(el.style(), "color"), static_effective_opacity(el),
    )
}
