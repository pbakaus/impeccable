//! Static element adapters from `checks.mjs` Section 5 (`checkElement*`) and
//! their DOM helpers (`scopedIgnoreActive`, `isTabContextElement`,
//! `isStatusContextElement`, `cleanInlineText`, kicker / numbered-label
//! candidate collection, radial spotlight, clipped overflow). Every pure
//! check comes from `impeccable_core::checks`; this file only reads the DOM
//! and the computed style and hands plain data over.

use crate::background::{
    a_ge, a_gt, read_own_background_color, resolve_background, resolve_background_info,
    resolve_border_radius_px, resolve_gradient_stops, sv, sv_opt, CustomPropMap,
};
use crate::cascade::StyleValues;
use crate::dom::{StaticDocument, StaticElement};
use crate::quality::{collapse_ws, pf0, resolve_font_size_px};
use impeccable_core::checks::measures::{
    self, border_colors_from_style, border_widths_from_style, check_gpt_thin_border_wide_shadow,
    check_oversized_h1, check_radial_spotlight, positioned_style_implies_escape, resolve_length_px,
    GptBorderShadowInput, OversizedH1Input, RadialSpotlightInput, StyleMap,
};
use impeccable_core::checks::rules::{
    check_borders, check_colors, check_glow, check_hero_eyebrow, check_hover_contrast,
    check_icon_tile, check_italic_serif, check_kicker_above_heading, check_motion,
    is_emoji_only_text, is_heading_tag, resolve_hero_heading_size_px, BorderOpts, ColorOpts,
    GlowOpts, HeroEyebrowOpts, HoverContrastOpts, IconTileOpts, ItalicSerifOpts, KickerCandidate,
    MotionOpts, RuleHit, Sides,
};
use impeccable_core::checks::text_rules::{
    check_numbered_section_labels, is_kicker_candidate, is_numbered_section_label_candidate,
    parse_numbered_label_text, KickerCandidateInput, NumberedLabelCandidate,
    NumberedLabelCandidateInput, HEADING_TAGS, KICKER_CARD_CONTEXT_SELECTOR, KICKER_SKIP_SELECTOR,
    POSITIONED_CHILD_INTERACTIVE_SELECTOR,
};
use impeccable_core::color::{composite_color_over, parse_any_color, parse_rgb};
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
        if heading_tag == "h1" && heading_font_size >= 48.0 && kicker_letter_spacing >= 1.6 {
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
        if is_kicker_card_context(&heading, &label) {
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

/// JS: checks.mjs#checkElementRadialSpotlight(el, style, tag, window)
pub fn check_element_radial_spotlight(el: &StaticElement<'_>, style: &StyleValues) -> Vec<RuleHit> {
    let gradient_value = element_gradient_value(style, el);
    if gradient_value.is_empty() {
        return Vec::new();
    }
    let label = spotlight_label(el);
    hits(check_radial_spotlight(&RadialSpotlightInput {
        gradient_value: Some(&gradient_value),
        width: pf0(sv(style, "width")),
        height: pf0(sv(style, "height")),
        label: Some(&label),
    }))
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
    check_borders(
        tag,
        &widths,
        &colors,
        resolved_radius,
        &BorderOpts {
            tab_context: is_tab_context_element(el),
            status_context: is_status_context_element(el),
            badge_like: own_bg.is_some_and(|c| c.alpha_or_one() > 0.1),
        },
    )
}

/// JS: checks.mjs#checkElementColors(el, style, tag, window, customPropMap, hasAnchorInheritRule)
pub fn check_element_colors(
    el: &StaticElement<'_>,
    style: &StyleValues,
    tag: &str,
    custom_props: CustomPropMap<'_>,
) -> Vec<RuleHit> {
    if sv_opt(style, "visibility") == Some("hidden") {
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

    let bg_info = resolve_background_info(el, custom_props);
    let effective_bg = bg_info.color;
    let mut text_color =
        custom_props.and_then(|m| measures::parse_color_resolved(sv_opt(style, "color"), Some(m)));
    if text_color.is_none() {
        text_color = parse_rgb(sv_opt(style, "color"));
    }
    // hasAnchorInheritRule is always false in the static engine.

    let mut own_bg = custom_props
        .and_then(|m| measures::parse_color_resolved(sv_opt(style, "backgroundColor"), Some(m)))
        .or_else(|| read_own_background_color(el, style));

    let mut final_effective_bg = effective_bg;
    let mut surface_unresolved = bg_info.unresolved;
    if own_bg.is_none() || own_bg.is_some_and(|c| c.alpha_or_one() <= 0.5) {
        if let Some(pseudo) = el.doc.get_pseudo_surface(el.id()) {
            own_bg = Some(pseudo);
            final_effective_bg = Some(pseudo);
            surface_unresolved = false;
        }
    }

    let effective_bg_stops = if surface_unresolved || final_effective_bg.is_some() {
        None
    } else {
        resolve_gradient_stops(el, custom_props)
    };
    let font_weight = {
        let n = parse_int(sv(style, "fontWeight"), 10);
        if num_truthy(n) {
            n
        } else {
            400.0
        }
    };
    let font_size = {
        let n = parse_float(sv(style, "fontSize"));
        if num_truthy(n) {
            n
        } else {
            16.0
        }
    };
    let bg_clip = {
        let a = sv(style, "webkitBackgroundClip");
        if !a.is_empty() {
            a
        } else {
            sv(style, "backgroundClip")
        }
    };
    check_colors(&ColorOpts {
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
        bg_clip: Some(bg_clip.to_string()),
        bg_image: Some(sv(style, "backgroundImage").to_string()),
        class_list: Some(el.class_name().to_string()),
        detector_is_browser: false,
    })
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
        sibling_border_width: pf0(sv(sib_style, "borderTopWidth")),
        sibling_border_radius: resolve_border_radius_px(sib_style, sib_width),
        has_icon_child: icon_child.is_some() || has_inline_emoji_icon,
        icon_child_width: icon_width,
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
    check_italic_serif(&ItalicSerifOpts {
        tag: tag.to_string(),
        font_style: Some(sv(style, "fontStyle").to_string()),
        font_family: Some(sv(style, "fontFamily").to_string()),
        font_size: pf0(sv(style, "fontSize")),
        heading_text: Some(el.text_content()),
    })
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
        transition_property: Some(sv(style, "transitionProperty").to_string()),
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
    check_glow(&GlowOpts {
        box_shadow: Some(box_shadow.to_string()),
        text_shadow: Some(text_shadow.to_string()),
        effective_bg,
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
    let font_size = resolve_font_size_px(el);
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

/// JS: checks.mjs#checkElementGptBorderShadow(el, style)
pub fn check_element_gpt_border_shadow(style: &StyleValues) -> Vec<RuleHit> {
    let s = StyleRef(style);
    let widths = border_widths_from_style(&s);
    let colors: Vec<Option<String>> = border_colors_from_style(&s)
        .into_iter()
        .map(|c| if c.is_empty() { None } else { Some(c) })
        .collect();
    hits(check_gpt_thin_border_wide_shadow(&GptBorderShadowInput {
        border_widths: &widths,
        border_colors: Some(&colors),
        box_shadow: Some(sv(style, "boxShadow")),
    }))
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

static DECORATIVE_IDENT_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(?-u:\b)(art|bg|background|badge|blob|crop|decor|dot|glow|grain|image|mask|ornament|overlay|photo|scrim|shadow|shine|texture)(?-u:\b)")
        .expect("DECORATIVE_IDENT_RE")
});
static VIEWPORT_ROLE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?-u:\b)(carousel|slider)(?-u:\b)").expect("VIEWPORT_ROLE_RE"));
static VIEWPORT_IDENT_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?-u:\b)(carousel|comparison|compare|fisheye|marquee|preview|scroller|slider|slideshow|split|viewport)(?-u:\b)")
        .expect("VIEWPORT_IDENT_RE")
});
static VIEWPORT_DEMO_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?-u:\b)(demo-area|demo-stage|demo-viewport)(?-u:\b)").expect("VIEWPORT_DEMO_RE")
});

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
    if DECORATIVE_IDENT_RE.is_match(&ident) && !positioned_child_has_substantive_content(child) {
        return true;
    }
    false
}

/// JS: checks.mjs#clippingContainerIsIntentionalViewport(el)
fn clipping_container_is_intentional_viewport(el: &StaticElement<'_>) -> bool {
    let role_description =
        js::to_lower_case(el.get_attribute("aria-roledescription").unwrap_or(""));
    if VIEWPORT_ROLE_RE.is_match(&role_description) {
        return true;
    }
    let ident = js::to_lower_case(&format!(
        "{} {}",
        el.get_attribute("class").unwrap_or(""),
        el.get_attribute("id").unwrap_or("")
    ));
    VIEWPORT_IDENT_RE.is_match(&ident) || VIEWPORT_DEMO_RE.is_match(&ident)
}

/// JS: checks.mjs#checkClippedOverflow(el, style, getStyle) / checkElementClippedOverflow
pub fn check_element_clipped_overflow(el: &StaticElement<'_>, style: &StyleValues) -> Vec<RuleHit> {
    let clips = |v: &str| v == "hidden" || v == "clip";
    let scrolls = |v: &str| v == "auto" || v == "scroll";
    let ox = sv(style, "overflowX");
    let oy = sv(style, "overflowY");
    let ov = sv(style, "overflow");
    let clip_x = clips(ox) || clips(ov);
    let clip_y = clips(oy) || clips(ov);
    let any_clip = clip_x || clip_y;
    let any_scroll = scrolls(ox) || scrolls(oy) || scrolls(ov);
    if !any_clip || any_scroll {
        return Vec::new();
    }
    if clipping_container_is_intentional_viewport(el) {
        return Vec::new();
    }
    for child in el.query_selector_all("*") {
        let child_style = child.style();
        let pos = sv(child_style, "position");
        if pos == "absolute" || pos == "fixed" {
            if positioned_child_is_decorative(&child) {
                continue;
            }
            // No layout statically: `positionedChildEscapesClip` is null.
            if !positioned_style_implies_escape(&StyleRef(child_style)) {
                continue;
            }
            return vec![RuleHit::new(
                "clipped-overflow-container",
                format!("{} clips a positioned child", class_selector(el)),
            )];
        }
    }
    Vec::new()
}
