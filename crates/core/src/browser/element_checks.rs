//! Section 5 per-element browser adapters (`checkElement*DOM`) from
//! `checks.mjs`, plus their DOM-facing helpers. See browser/mod.rs for the
//! full list this module owns.

#![allow(unused_imports)]

use super::background::{
    read_own_background_color, resolve_background_info, resolve_gradient_stops, BackgroundInfo,
};
use super::dom::{
    class_attr, class_attr_or_prop, closest_or_none, direct_text, has_direct_text_longer_than,
    matches_or_false, pf0, safe_id, style_px, tag_lower, Dom, ElId, ElStyle, Rect,
};
use super::BrowserFinding;
use crate::checks::measures::{
    self, border_colors_from_style, border_widths_from_style, check_gpt_thin_border_wide_shadow,
    check_oversized_h1, check_radial_spotlight, is_screen_reader_only_text_style,
    positioned_style_implies_escape, GptBorderShadowInput, OversizedH1Input,
    RadialSpotlightInput, SrOnlyMetrics,
};
use crate::checks::rules::{
    check_borders, check_colors, check_glow, check_hero_eyebrow, check_icon_tile,
    check_italic_serif, check_motion, is_emoji_only_text, BorderOpts, ColorOpts, GlowOpts,
    HeroEyebrowOpts, IconTileOpts, ItalicSerifOpts, MotionOpts, RuleHit, Sides, HEADING_TAGS,
};
use crate::checks::text_rules::{
    CURSOR_FIRST_VIEWPORT_PX, CURSOR_GLYPH_RE, POSITIONED_CHILD_INTERACTIVE_SELECTOR,
    TEXT_OVERFLOW_SKIP_TAGS,
};
use crate::color::{
    get_hue, has_chroma, parse_any_color, parse_gradient_colors, parse_rgb, relative_luminance,
    Rgba,
};
use crate::constants::{BORDER_SAFE_TAGS, SAFE_TAGS};
use crate::js::{self, math_round, number_to_string, parse_float, parse_int, WS};
use crate::js_ext_a::num_truthy;
use crate::js_ext_b::utf16_len;
use once_cell::sync::Lazy;
use regex::Regex;

macro_rules! re {
    ($name:ident, $pat:expr) => {
        static $name: Lazy<Regex> = Lazy::new(|| Regex::new(&$pat).expect(stringify!($name)));
    };
}

/// JS `parseRgb(x) || parseAnyColor(x)`.
pub fn parse_rgb_or_any(value: &str) -> Option<Rgba> {
    parse_rgb(Some(value)).or_else(|| parse_any_color(Some(value)))
}

// JS `/(?:^|[\s_-])(?:active|current|selected)(?:$|[\s_-])/i`: ASCII-only
// case folding (`ci`) and the JS `\s` set (`WS`), never Rust `(?i)` / `\s`.
re!(
    ACTIVE_CLASS_RE,
    format!(
        "(?:^|[{ws}_-])(?:{a}|{c}|{s})(?:$|[{ws}_-])",
        ws = js::WS_CHARS,
        a = js::ci("active"),
        c = js::ci("current"),
        s = js::ci("selected")
    )
);

/// JS: checks.mjs#isTabContextElement(el)
pub fn is_tab_context_element(dom: &dyn Dom, el: ElId) -> bool {
    if closest_or_none(
        dom,
        el,
        "[aria-selected=\"true\"], [aria-current]:not([aria-current=\"false\"])",
    )
    .is_some()
    {
        return true;
    }
    let mut cur = Some(el);
    let mut depth = 0;
    while let Some(c) = cur {
        if depth >= 6 {
            break;
        }
        let cls = class_attr_or_prop(dom, c);
        if ACTIVE_CLASS_RE.is_match(&cls) {
            return true;
        }
        cur = dom.parent(c);
        depth += 1;
    }
    false
}

/// JS: checks.mjs#isStatusContextElement(el)
pub fn is_status_context_element(dom: &dyn Dom, el: ElId) -> bool {
    closest_or_none(
        dom,
        el,
        "[role=\"status\"], [role=\"alert\"], [role=\"alertdialog\"], [role=\"log\"], [aria-live=\"polite\"], [aria-live=\"assertive\"]",
    )
    .is_some()
}

pub const SIDES: [&str; 4] = ["Top", "Right", "Bottom", "Left"];

/// JS: checks.mjs#checkElementBordersDOM(el)
pub fn check_element_borders_dom(dom: &dyn Dom, el: ElId) -> Vec<RuleHit> {
    let tag = tag_lower(dom, el);
    if BORDER_SAFE_TAGS.contains(&tag.as_str()) {
        return Vec::new();
    }
    let rect = dom.rect(el);
    if rect.width < 20.0 || rect.height < 20.0 {
        return Vec::new();
    }
    let mut widths = [0.0f64; 4];
    let mut colors: [String; 4] = Default::default();
    for (i, s) in SIDES.iter().enumerate() {
        widths[i] = style_px(dom, el, &format!("border{s}Width"));
        colors[i] = dom.style(el, &format!("border{s}Color"));
    }
    let own_bg = parse_rgb_or_any(&dom.style(el, "backgroundColor"));
    let badge_like = own_bg.map_or(false, |c| c.alpha_or_one() > 0.1);
    check_borders(
        &tag,
        &Sides {
            top: widths[0],
            right: widths[1],
            bottom: widths[2],
            left: widths[3],
        },
        &Sides {
            top: Some(colors[0].as_str()),
            right: Some(colors[1].as_str()),
            bottom: Some(colors[2].as_str()),
            left: Some(colors[3].as_str()),
        },
        style_px(dom, el, "borderRadius"),
        &BorderOpts {
            badge_like,
            status_context: is_status_context_element(dom, el),
            tab_context: is_tab_context_element(dom, el),
        },
    )
}

// ── shared helpers ────────────────────────────────────────────────────────

re!(WS_RUN, format!("{}+", WS));

/// JS `s.replace(/\s+/g, ' ')`.
fn collapse_ws(s: &str) -> String {
    WS_RUN.replace_all(s, " ").into_owned()
}

/// JS `Math.round(x)` rendered as `${...}`.
fn round_str(x: f64) -> String {
    number_to_string(math_round(x))
}

/// JS `Math.max(r,g,b) - Math.min(r,g,b)`.
fn spread(c: &Rgba) -> f64 {
    js::math_max3(c.r, c.g, c.b) - js::math_min3(c.r, c.g, c.b)
}

fn finding_hits(v: Vec<measures::Finding>) -> Vec<RuleHit> {
    v.into_iter()
        .map(|f| RuleHit {
            id: f.id,
            snippet: f.snippet,
        })
        .collect()
}

/// JS: checks.mjs#classSelector(el)
pub fn class_selector(dom: &dyn Dom, el: ElId) -> String {
    let cls = class_attr(dom, el);
    let tokens: Vec<&str> = WS_RUN
        .split(js::trim(&cls))
        .filter(|t| !t.is_empty())
        .collect();
    let tag = {
        let t = dom.tag_name(el);
        if t.is_empty() {
            "el".to_string()
        } else {
            js::to_lower_case(&t)
        }
    };
    if tokens.is_empty() {
        tag
    } else {
        format!("{}.{}", tag, tokens.join("."))
    }
}

/// JS: checks.mjs#isRenderedForBrowserRule(el)
pub fn is_rendered_for_browser_rule(dom: &dyn Dom, el: ElId) -> bool {
    let mut cur = Some(el);
    while let Some(c) = cur {
        if dom.attr(c, "aria-hidden").as_deref() == Some("true") {
            return false;
        }
        let visibility = js::to_lower_case(&dom.style(c, "visibility"));
        if dom.style(c, "display") == "none" || visibility == "hidden" || visibility == "collapse"
        {
            return false;
        }
        if style_px(dom, c, "opacity") <= 0.01 {
            return false;
        }
        if js::to_lower_case(&dom.style(c, "contentVisibility")) == "hidden" {
            return false;
        }
        cur = dom.parent(c);
    }
    true
}

/// JS: checks.mjs#effectiveOpacityDOM(el)
pub fn effective_opacity_dom(dom: &dyn Dom, el: ElId) -> f64 {
    let mut o = 1.0f64;
    let mut cur = Some(el);
    while let Some(c) = cur {
        let raw = dom.style(c, "opacity");
        let v = if raw.is_empty() {
            "1".to_string()
        } else {
            raw
        };
        o *= parse_float(&v);
        if o <= 0.02 {
            return 0.0;
        }
        cur = dom.parent(c);
    }
    o
}

// ── pseudo-element stripes / surfaces ─────────────────────────────────────

const PSEUDOS: [&str; 2] = ["::before", "::after"];

/// `getComputedStyle(el, which)` guard: false = the JS `continue`
/// (getComputedStyle threw, returned nothing, or `content` is none/empty).
fn pseudo_present(dom: &dyn Dom, el: ElId, which: &str) -> bool {
    match dom.pseudo_style(el, which, "content") {
        None => false,
        Some(c) => c != "none" && !c.is_empty(),
    }
}

/// JS `parseFloat(ps.x) || 0`.
fn pseudo_px(dom: &dyn Dom, el: ElId, which: &str, prop: &str) -> f64 {
    pf0(&dom.pseudo_style(el, which, prop).unwrap_or_default())
}

fn pseudo_str(dom: &dyn Dom, el: ElId, which: &str, prop: &str) -> String {
    dom.pseudo_style(el, which, prop).unwrap_or_default()
}

// JS `/(?:^|[\s_-])(?:btn|button|link)(?:$|[\s\w_-])/i` (ASCII `\w`).
re!(
    BTN_LINK_CLASS_RE,
    format!(
        "(?:^|[{ws}_-])(?:{b}|{bu}|{l})(?:$|[{ws}A-Za-z0-9_-])",
        ws = js::WS_CHARS,
        b = js::ci("btn"),
        bu = js::ci("button"),
        l = js::ci("link")
    )
);

/// JS: checks.mjs#checkElementPseudoStripeDOM(el)
pub fn check_element_pseudo_stripe_dom(dom: &dyn Dom, el: ElId) -> Vec<RuleHit> {
    let tag = tag_lower(dom, el);
    if BORDER_SAFE_TAGS.contains(&tag.as_str()) || tag == "summary" {
        return Vec::new();
    }
    if closest_or_none(dom, el, "nav, blockquote, pre").is_some() {
        return Vec::new();
    }
    if !is_rendered_for_browser_rule(dom, el) {
        return Vec::new();
    }
    let rect = dom.rect(el);
    if rect.width < 40.0 || rect.height < 20.0 {
        return Vec::new();
    }
    if is_tab_context_element(dom, el) {
        return Vec::new();
    }
    let mut findings = Vec::new();
    for which in PSEUDOS {
        if !pseudo_present(dom, el, which) {
            continue;
        }
        let position = pseudo_str(dom, el, which, "position");
        if position != "absolute" && position != "fixed" {
            continue;
        }
        if pseudo_px(dom, el, which, "opacity") <= 0.01
            || pseudo_str(dom, el, which, "display") == "none"
        {
            continue;
        }
        let w = pseudo_px(dom, el, which, "width");
        let h = pseudo_px(dom, el, which, "height");
        if !(w > 0.0 && h > 0.0) {
            continue;
        }
        let left = parse_float(&pseudo_str(dom, el, which, "left"));
        let right = parse_float(&pseudo_str(dom, el, which, "right"));
        let top = parse_float(&pseudo_str(dom, el, which, "top"));
        let bottom = parse_float(&pseudo_str(dom, el, which, "bottom"));
        let hugs = |v: f64| v.is_finite() && v >= -2.0 && v <= 2.0;

        let mut edge: Option<&str> = None;
        let mut thickness = 0.0;
        if w >= 3.0 && w <= 12.0 && h >= rect.height - 44.0 && h >= rect.height * 0.5 {
            edge = if hugs(left) {
                Some("left")
            } else if hugs(right) {
                Some("right")
            } else {
                None
            };
            thickness = w;
        }
        if edge.is_none()
            && h >= 3.0
            && h <= 12.0
            && w >= rect.width - 44.0
            && w >= rect.width * 0.5
        {
            let cls = class_attr_or_prop(dom, el);
            if !BTN_LINK_CLASS_RE.is_match(&cls) {
                edge = if hugs(top) {
                    Some("top")
                } else if hugs(bottom) {
                    Some("bottom")
                } else {
                    None
                };
                thickness = h;
            }
        }
        let Some(edge) = edge else { continue };
        let Some(bg) = parse_rgb_or_any(&pseudo_str(dom, el, which, "backgroundColor")) else {
            continue;
        };
        if bg.alpha_or_one() < 0.1 {
            continue;
        }
        if spread(&bg) < 30.0 {
            continue;
        }
        findings.push(RuleHit::new(
            "side-tab",
            format!(
                "{}{} — absolute {}px pseudo-element stripe ({})",
                class_selector(dom, el),
                which,
                number_to_string(thickness),
                edge
            ),
        ));
    }
    findings
}

/// JS: checks.mjs#readPseudoSurfaceDOM(el, rect)
pub fn read_pseudo_surface_dom(dom: &dyn Dom, el: ElId, rect: &Rect) -> Option<Rgba> {
    for which in PSEUDOS {
        if !pseudo_present(dom, el, which) {
            continue;
        }
        let position = pseudo_str(dom, el, which, "position");
        if position != "absolute" && position != "fixed" {
            continue;
        }
        // JS `(parseFloat(ps.opacity) || 1) < 0.9`
        let opacity = {
            let n = parse_float(&pseudo_str(dom, el, which, "opacity"));
            if num_truthy(n) {
                n
            } else {
                1.0
            }
        };
        if pseudo_str(dom, el, which, "display") == "none" || opacity < 0.9 {
            continue;
        }
        let w = pseudo_px(dom, el, which, "width");
        let h = pseudo_px(dom, el, which, "height");
        if w < rect.width - 4.0 || h < rect.height - 4.0 {
            continue;
        }
        let Some(bg) = parse_rgb_or_any(&pseudo_str(dom, el, which, "backgroundColor")) else {
            continue;
        };
        if bg.alpha_or_one() < 0.9 {
            continue;
        }
        return Some(bg);
    }
    None
}

// ── colors ────────────────────────────────────────────────────────────────

/// JS: checks.mjs#checkElementColorsDOM(el)
pub fn check_element_colors_dom(dom: &dyn Dom, el: ElId) -> Vec<RuleHit> {
    let tag = tag_lower(dom, el);
    let rect = dom.rect(el);
    if rect.width < 10.0 || rect.height < 10.0 {
        return Vec::new();
    }
    if dom.style(el, "visibility") == "hidden" || effective_opacity_dom(dom, el) <= 0.02 {
        return Vec::new();
    }
    let direct = direct_text(dom, el);
    let has_direct_text = !js::trim(&direct).is_empty();
    let bg_info = resolve_background_info(dom, el);
    let mut effective_bg = bg_info.color;
    let mut surface_unresolved = bg_info.unresolved;
    let mut own_bg = read_own_background_color(dom, el);
    if own_bg.map_or(true, |c| c.alpha_or_one() <= 0.5) {
        if let Some(pseudo_surface) = read_pseudo_surface_dom(dom, el, &rect) {
            own_bg = Some(pseudo_surface);
            effective_bg = Some(pseudo_surface);
            surface_unresolved = false;
        }
    }
    let font_size = {
        let n = parse_float(&dom.style(el, "fontSize"));
        if num_truthy(n) {
            n
        } else {
            16.0
        }
    };
    let font_weight = {
        let n = parse_int(&dom.style(el, "fontWeight"), 10);
        if num_truthy(n) {
            n
        } else {
            400.0
        }
    };
    let bg_clip = {
        let a = dom.style(el, "webkitBackgroundClip");
        if !a.is_empty() {
            a
        } else {
            dom.style(el, "backgroundClip")
        }
    };
    let effective_bg_stops = if surface_unresolved || effective_bg.is_some() {
        None
    } else {
        resolve_gradient_stops(dom, el)
    };
    check_colors(&ColorOpts {
        tag,
        text_color: parse_rgb_or_any(&dom.style(el, "color")),
        bg_color: own_bg,
        effective_bg: if surface_unresolved {
            None
        } else {
            effective_bg
        },
        effective_bg_stops,
        font_size,
        font_weight,
        has_direct_text,
        is_emoji_only: is_emoji_only_text(&direct),
        bg_clip: Some(bg_clip),
        bg_image: Some(dom.style(el, "backgroundImage")),
        class_list: Some(class_attr(dom, el)),
        detector_is_browser: true,
    })
}

// ── icon tile / italic serif / hero eyebrow ───────────────────────────────

/// JS: checks.mjs#checkElementIconTileDOM(el)
pub fn check_element_icon_tile_dom(dom: &dyn Dom, el: ElId) -> Vec<RuleHit> {
    let tag = tag_lower(dom, el);
    if !HEADING_TAGS.contains(&tag.as_str()) {
        return Vec::new();
    }
    let Some(sibling) = dom.previous_element_sibling(el) else {
        return Vec::new();
    };
    let sib_rect = dom.rect(sibling);
    let head_rect = dom.rect(el);
    let icon_child = dom
        .query_one(
            Some(sibling),
            "svg, i[data-lucide], i[class*=\"fa-\"], i[class*=\"icon\"]",
        )
        .unwrap_or(None);
    let icon_rect = icon_child.map(|c| dom.rect(c));
    let sib_direct = direct_text(dom, sibling);
    let has_inline_emoji_icon =
        dom.children(sibling).is_empty() && is_emoji_only_text(&sib_direct);
    check_icon_tile(&IconTileOpts {
        heading_tag: tag,
        heading_text: Some(dom.text_content(el)),
        heading_top: head_rect.top,
        sibling_tag: Some(tag_lower(dom, sibling)),
        sibling_width: sib_rect.width,
        sibling_height: sib_rect.height,
        sibling_bottom: sib_rect.bottom,
        sibling_bg_color: parse_rgb(Some(&dom.style(sibling, "backgroundColor"))),
        sibling_bg_image: Some(dom.style(sibling, "backgroundImage")),
        sibling_border_width: style_px(dom, sibling, "borderTopWidth"),
        sibling_border_radius: style_px(dom, sibling, "borderRadius"),
        has_icon_child: icon_child.is_some() || has_inline_emoji_icon,
        // JS `iconRect?.width || 0`
        icon_child_width: icon_rect
            .map(|r| r.width)
            .filter(|w| num_truthy(*w))
            .unwrap_or(0.0),
    })
}

/// JS: checks.mjs#checkElementItalicSerifDOM(el)
pub fn check_element_italic_serif_dom(dom: &dyn Dom, el: ElId) -> Vec<RuleHit> {
    let tag = tag_lower(dom, el);
    if tag != "h1" && tag != "h2" {
        return Vec::new();
    }
    check_italic_serif(&ItalicSerifOpts {
        tag,
        font_style: Some(dom.style(el, "fontStyle")),
        font_family: Some(dom.style(el, "fontFamily")),
        font_size: style_px(dom, el, "fontSize"),
        heading_text: Some(dom.text_content(el)),
    })
}

/// JS: checks.mjs#domAccentDashPseudo(el)
pub fn dom_accent_dash_pseudo(dom: &dyn Dom, el: ElId) -> bool {
    for which in PSEUDOS {
        if !pseudo_present(dom, el, which) {
            continue;
        }
        let w = pseudo_px(dom, el, which, "width");
        let h = pseudo_px(dom, el, which, "height");
        if !(w >= 8.0 && w <= 80.0 && h >= 1.0 && h <= 6.0) {
            continue;
        }
        let Some(bg) = parse_rgb_or_any(&pseudo_str(dom, el, which, "backgroundColor")) else {
            continue;
        };
        if bg.alpha_or_one() < 0.1 {
            continue;
        }
        if spread(&bg) >= 30.0 {
            return true;
        }
    }
    false
}

/// JS: checks.mjs#checkElementHeroEyebrowDOM(el)
pub fn check_element_hero_eyebrow_dom(dom: &dyn Dom, el: ElId) -> Vec<RuleHit> {
    let tag = tag_lower(dom, el);
    if tag != "h1" {
        return Vec::new();
    }
    let Some(sibling) = dom.previous_element_sibling(el) else {
        return Vec::new();
    };
    check_hero_eyebrow(&HeroEyebrowOpts {
        heading_tag: tag,
        heading_text: Some(dom.text_content(el)),
        heading_font_size: style_px(dom, el, "fontSize"),
        heading_in_application_context: closest_or_none(
            dom,
            el,
            "[role=\"tabpanel\"], [role=\"dialog\"], [role=\"application\"], dialog",
        )
        .is_some(),
        sibling_tag: Some(tag_lower(dom, sibling)),
        sibling_text: Some(dom.text_content(sibling)),
        sibling_text_transform: Some(dom.style(sibling, "textTransform")),
        sibling_font_size: style_px(dom, sibling, "fontSize"),
        sibling_letter_spacing: style_px(dom, sibling, "letterSpacing"),
        sibling_font_weight: Some(dom.style(sibling, "fontWeight")),
        sibling_color: Some(dom.style(sibling, "color")),
        sibling_has_accent_dash_pseudo: dom_accent_dash_pseudo(dom, sibling),
    })
}

// ── motion / glow / AI palette ────────────────────────────────────────────

/// JS: checks.mjs#checkElementMotionDOM(el)
pub fn check_element_motion_dom(dom: &dyn Dom, el: ElId) -> Vec<RuleHit> {
    let tag = tag_lower(dom, el);
    if SAFE_TAGS.contains(&tag.as_str()) {
        return Vec::new();
    }
    let timing: Vec<String> = [
        dom.style(el, "animationTimingFunction"),
        dom.style(el, "transitionTimingFunction"),
    ]
    .into_iter()
    .filter(|s| !s.is_empty())
    .collect();
    check_motion(&MotionOpts {
        tag,
        transition_property: Some(dom.style(el, "transitionProperty")),
        animation_name: Some(dom.style(el, "animationName")),
        timing_functions: Some(timing.join(" ")),
        class_list: Some(class_attr(dom, el)),
    })
}

/// The gradient-ancestor average color the glow / AI-palette checks fall
/// back to (JS: the `while (cur ...)` loops in checkElementGlowDOM and
/// checkElementAIPaletteDOM). `{ r, g, b }` without an alpha, as in the JS.
fn gradient_ancestor_average(dom: &dyn Dom, start: Option<ElId>) -> Option<Rgba> {
    let mut cur = start;
    while let Some(c) = cur {
        let bg_image = dom.style(c, "backgroundImage");
        let grad = parse_gradient_colors(Some(&bg_image));
        if !grad.is_empty() {
            let (mut r, mut g, mut b) = (0.0f64, 0.0f64, 0.0f64);
            for col in &grad {
                r += col.r;
                g += col.g;
                b += col.b;
            }
            let n = grad.len() as f64;
            return Some(Rgba {
                r: math_round(r / n),
                g: math_round(g / n),
                b: math_round(b / n),
                a: None,
            });
        }
        cur = dom.parent(c);
    }
    None
}

/// JS: checks.mjs#checkElementGlowDOM(el)
pub fn check_element_glow_dom(dom: &dyn Dom, el: ElId) -> Vec<RuleHit> {
    let box_shadow = {
        let v = dom.style(el, "boxShadow");
        if !v.is_empty() && v != "none" {
            v
        } else {
            String::new()
        }
    };
    let mut text_shadow = {
        let v = dom.style(el, "textShadow");
        if !v.is_empty() && v != "none" {
            v
        } else {
            String::new()
        }
    };
    let parent = dom.parent(el);
    if !text_shadow.is_empty() {
        if let Some(p) = parent {
            if dom.style(p, "textShadow") == text_shadow {
                text_shadow = String::new();
            }
        }
    }
    if box_shadow.is_empty() && text_shadow.is_empty() {
        return Vec::new();
    }
    let parent_bg_info = resolve_background_info(dom, parent.unwrap_or(el));
    let mut parent_bg = parent_bg_info.color;
    if parent_bg.is_none() && !parent_bg_info.unresolved {
        parent_bg = gradient_ancestor_average(dom, parent);
    }
    check_glow(&GlowOpts {
        box_shadow: Some(box_shadow),
        text_shadow: Some(text_shadow),
        effective_bg: parent_bg,
    })
}

/// JS: checks.mjs#checkElementAIPaletteDOM(el)
pub fn check_element_ai_palette_dom(dom: &dyn Dom, el: ElId) -> Vec<RuleHit> {
    let mut findings = Vec::new();
    let bg_image = dom.style(el, "backgroundImage");
    for c in parse_gradient_colors(Some(&bg_image)) {
        if has_chroma(Some(&c), Some(50.0)) {
            let hue = get_hue(Some(&c));
            if hue >= 260.0 && hue <= 310.0 {
                findings.push(RuleHit::new(
                    "ai-color-palette",
                    "Purple/violet gradient background".to_string(),
                ));
                break;
            }
            if hue >= 160.0 && hue <= 200.0 {
                findings.push(RuleHit::new(
                    "ai-color-palette",
                    "Cyan gradient background".to_string(),
                ));
                break;
            }
        }
    }
    let text_color = parse_rgb_or_any(&dom.style(el, "color"));
    if let Some(tc) = text_color {
        if has_chroma(Some(&tc), Some(80.0)) {
            let hue = get_hue(Some(&tc));
            let is_ai_palette =
                (hue >= 160.0 && hue <= 200.0) || (hue >= 260.0 && hue <= 310.0);
            if is_ai_palette {
                let parent = dom.parent(el);
                let parent_bg_info = match parent {
                    Some(p) => resolve_background_info(dom, p),
                    None => BackgroundInfo {
                        color: None,
                        unresolved: false,
                    },
                };
                let mut effective_bg = parent_bg_info.color;
                if effective_bg.is_none() && !parent_bg_info.unresolved {
                    effective_bg = gradient_ancestor_average(dom, parent);
                }
                if let Some(bg) = effective_bg {
                    if relative_luminance(&bg) < 0.1 {
                        let label = if hue >= 260.0 {
                            "Purple/violet"
                        } else {
                            "Cyan"
                        };
                        findings.push(RuleHit::new(
                            "ai-color-palette",
                            format!("{label} neon text on dark background"),
                        ));
                    }
                }
            }
        }
    }
    findings
}

// ── radial spotlight ──────────────────────────────────────────────────────

re!(RADIAL_RE, js::ci("radial-gradient"));
re!(
    INLINE_BG_RE,
    format!(
        "{bg}(?:-{img})?{ws}*:{ws}*([^;]+)",
        bg = js::ci("background"),
        img = js::ci("image"),
        ws = WS
    )
);

/// JS: checks.mjs#elementGradientValue(style, el)
pub fn element_gradient_value(dom: &dyn Dom, el: ElId) -> String {
    let bg_image = {
        let v = dom.style(el, "backgroundImage");
        if !v.is_empty() && v != "none" {
            v
        } else {
            String::new()
        }
    };
    if RADIAL_RE.is_match(&bg_image) {
        return bg_image;
    }
    let bg = dom.style(el, "background");
    if RADIAL_RE.is_match(&bg) {
        return bg;
    }
    let raw_style = dom.attr(el, "style").unwrap_or_default();
    if let Some(m) = INLINE_BG_RE.captures(&raw_style) {
        let v = m.get(1).map(|g| g.as_str()).unwrap_or("");
        if RADIAL_RE.is_match(v) {
            return v.to_string();
        }
    }
    String::new()
}

/// JS: checks.mjs#spotlightLabel(el)
pub fn spotlight_label(dom: &dyn Dom, el: ElId) -> String {
    if let Some(name) = dom.attr(el, "data-name") {
        if !name.is_empty() {
            return name;
        }
    }
    if let Some(id) = dom.id_prop(el) {
        if !id.is_empty() {
            return id;
        }
    }
    if let Some(cls) = dom.class_name_prop(el) {
        let first = WS_RUN
            .split(js::trim(&cls))
            .next()
            .unwrap_or("")
            .to_string();
        if !first.is_empty() {
            return first;
        }
    }
    let t = dom.tag_name(el);
    if t.is_empty() {
        "section".to_string()
    } else {
        js::to_lower_case(&t)
    }
}

/// JS: checks.mjs#checkElementRadialSpotlightDOM(el)
pub fn check_element_radial_spotlight_dom(dom: &dyn Dom, el: ElId) -> Vec<RuleHit> {
    let gradient_value = element_gradient_value(dom, el);
    if gradient_value.is_empty() {
        return Vec::new();
    }
    let rect = dom.rect(el);
    let label = spotlight_label(dom, el);
    finding_hits(check_radial_spotlight(&RadialSpotlightInput {
        gradient_value: Some(&gradient_value),
        width: rect.width,
        height: rect.height,
        label: Some(&label),
    }))
}

// ── oversized h1 / gpt border shadow ──────────────────────────────────────

/// JS: checks.mjs#checkElementOversizedH1DOM(el)
pub fn check_element_oversized_h1_dom(dom: &dyn Dom, el: ElId) -> Vec<RuleHit> {
    let tag = tag_lower(dom, el);
    if tag != "h1" {
        return Vec::new();
    }
    let font_size = style_px(dom, el, "fontSize");
    let heading_text = collapse_ws(js::trim(&dom.text_content(el)));
    let rect = dom.rect(el);
    let vw = dom.inner_width();
    let vh = dom.inner_height();
    finding_hits(check_oversized_h1(&OversizedH1Input {
        tag: &tag,
        font_size,
        heading_text: &heading_text,
        rect: Some(measures::Rect {
            width: rect.width,
            height: rect.height,
        }),
        viewport_width: if num_truthy(vw) { vw } else { 0.0 },
        viewport_height: if num_truthy(vh) { vh } else { 0.0 },
    }))
}

/// JS: checks.mjs#checkElementGptBorderShadowDOM(el)
pub fn check_element_gpt_border_shadow_dom(dom: &dyn Dom, el: ElId) -> Vec<RuleHit> {
    let style = ElStyle { dom, el };
    let widths = border_widths_from_style(&style);
    let colors: Vec<Option<String>> = border_colors_from_style(&style)
        .into_iter()
        .map(Some)
        .collect();
    let box_shadow = dom.style(el, "boxShadow");
    finding_hits(check_gpt_thin_border_wide_shadow(&GptBorderShadowInput {
        border_widths: &widths,
        border_colors: Some(&colors),
        box_shadow: Some(&box_shadow),
    }))
}

// ── clipped overflow container ────────────────────────────────────────────

// JS `\b` is ASCII (`(?-u:\b)`); `/i` folds ASCII only.
re!(
    DECOR_IDENT_RE,
    format!(
        "(?-u:\\b)({})(?-u:\\b)",
        [
            "art", "bg", "background", "badge", "blob", "crop", "decor", "dot", "glow", "grain",
            "image", "mask", "ornament", "overlay", "photo", "scrim", "shadow", "shine", "texture",
        ]
        .iter()
        .map(|w| js::ci(w))
        .collect::<Vec<_>>()
        .join("|")
    )
);
re!(CAROUSEL_ROLE_RE, r"(?-u:\b)(carousel|slider)(?-u:\b)");
re!(
    VIEWPORT_IDENT_RE,
    r"\b(carousel|comparison|compare|fisheye|marquee|preview|scroller|slider|slideshow|split|viewport)\b"
);
re!(DEMO_IDENT_RE, r"\b(demo-area|demo-stage|demo-viewport)\b");

/// JS: checks.mjs#positionedChildHasSubstantiveContent(child)
pub fn positioned_child_has_substantive_content(dom: &dyn Dom, child: ElId) -> bool {
    let text = collapse_ws(&dom.text_content(child));
    if !js::trim(&text).is_empty() {
        return true;
    }
    if matches_or_false(dom, child, POSITIONED_CHILD_INTERACTIVE_SELECTOR) {
        return true;
    }
    if let Ok(Some(_)) = dom.query_one(Some(child), POSITIONED_CHILD_INTERACTIVE_SELECTOR) {
        return true;
    }
    false
}

/// JS: checks.mjs#positionedChildIsDecorative(child)
pub fn positioned_child_is_decorative(dom: &dyn Dom, child: ElId) -> bool {
    if closest_or_none(dom, child, "[aria-hidden=\"true\"]").is_some() {
        return true;
    }
    let role = js::to_lower_case(&dom.attr(child, "role").unwrap_or_default());
    if role == "none" || role == "presentation" {
        return true;
    }
    let tag = tag_lower(dom, child);
    if matches!(tag.as_str(), "img" | "svg" | "canvas" | "video") {
        return true;
    }
    let ident = format!(
        "{} {}",
        dom.attr(child, "class").unwrap_or_default(),
        dom.attr(child, "id").unwrap_or_default()
    );
    if DECOR_IDENT_RE.is_match(&ident) && !positioned_child_has_substantive_content(dom, child) {
        return true;
    }
    false
}

/// JS: checks.mjs#clippingContainerIsIntentionalViewport(el)
pub fn clipping_container_is_intentional_viewport(dom: &dyn Dom, el: ElId) -> bool {
    let role_description =
        js::to_lower_case(&dom.attr(el, "aria-roledescription").unwrap_or_default());
    if CAROUSEL_ROLE_RE.is_match(&role_description) {
        return true;
    }
    let ident = js::to_lower_case(&format!(
        "{} {}",
        dom.attr(el, "class").unwrap_or_default(),
        dom.attr(el, "id").unwrap_or_default()
    ));
    VIEWPORT_IDENT_RE.is_match(&ident) || DEMO_IDENT_RE.is_match(&ident)
}

/// JS: checks.mjs#elementRect(el)
pub fn element_rect(dom: &dyn Dom, el: ElId) -> Option<Rect> {
    let rect = dom.rect(el);
    if !rect.all_finite() {
        return None;
    }
    if rect.width <= 0.0 && rect.height <= 0.0 {
        return None;
    }
    Some(rect)
}

/// JS: checks.mjs#positionedChildEscapesClip(el, child, clipX, clipY)
pub fn positioned_child_escapes_clip(
    dom: &dyn Dom,
    el: ElId,
    child: ElId,
    clip_x: bool,
    clip_y: bool,
) -> Option<bool> {
    let parent_rect = element_rect(dom, el)?;
    let child_rect = element_rect(dom, child)?;
    let threshold = 2.0;
    Some(
        (clip_x
            && (child_rect.left < parent_rect.left - threshold
                || child_rect.right > parent_rect.right + threshold))
            || (clip_y
                && (child_rect.top < parent_rect.top - threshold
                    || child_rect.bottom > parent_rect.bottom + threshold)),
    )
}

/// JS: checks.mjs#checkClippedOverflow(el, style, getStyle)
pub fn check_clipped_overflow(dom: &dyn Dom, el: ElId) -> Vec<RuleHit> {
    let clips = |v: &str| v == "hidden" || v == "clip";
    let scrolls = |v: &str| v == "auto" || v == "scroll";
    let ox = dom.style(el, "overflowX");
    let oy = dom.style(el, "overflowY");
    let ov = dom.style(el, "overflow");
    let clip_x = clips(&ox) || clips(&ov);
    let clip_y = clips(&oy) || clips(&ov);
    let any_clip = clip_x || clip_y;
    let any_scroll = scrolls(&ox) || scrolls(&oy) || scrolls(&ov);
    if !any_clip || any_scroll {
        return Vec::new();
    }
    if clipping_container_is_intentional_viewport(dom, el) {
        return Vec::new();
    }
    for child in dom.query_all(Some(el), "*").unwrap_or_default() {
        let pos = dom.style(child, "position");
        if pos == "absolute" || pos == "fixed" {
            if positioned_child_is_decorative(dom, child) {
                continue;
            }
            let escapes = positioned_child_escapes_clip(dom, el, child, clip_x, clip_y);
            if escapes == Some(false) {
                continue;
            }
            if escapes.is_none() && !positioned_style_implies_escape(&ElStyle { dom, el: child })
            {
                continue;
            }
            return vec![RuleHit::new(
                "clipped-overflow-container",
                format!("{} clips a positioned child", class_selector(dom, el)),
            )];
        }
    }
    Vec::new()
}

/// JS: checks.mjs#checkElementClippedOverflowDOM(el)
pub fn check_element_clipped_overflow_dom(dom: &dyn Dom, el: ElId) -> Vec<RuleHit> {
    check_clipped_overflow(dom, el)
}

// ── text overflow ─────────────────────────────────────────────────────────

re!(SCROLL_RE, r"(auto|scroll)");

fn is_scroll_region(dom: &dyn Dom, el: ElId) -> bool {
    SCROLL_RE.is_match(&dom.style(el, "overflowX")) || SCROLL_RE.is_match(&dom.style(el, "overflow"))
}

/// JS: checks.mjs#checkElementTextOverflowDOM(el)
pub fn check_element_text_overflow_dom(dom: &dyn Dom, el: ElId) -> Vec<RuleHit> {
    let tag = tag_lower(dom, el);
    if TEXT_OVERFLOW_SKIP_TAGS.contains(&tag.as_str()) {
        return Vec::new();
    }
    if dom.namespace_uri(el) == "http://www.w3.org/2000/svg" {
        return Vec::new();
    }
    if !is_rendered_for_browser_rule(dom, el) {
        return Vec::new();
    }
    if !has_direct_text_longer_than(dom, el, 0) {
        return Vec::new();
    }
    let rect = dom.rect(el);
    let style = ElStyle { dom, el };
    if is_screen_reader_only_text_style(
        Some(&style),
        &SrOnlyMetrics {
            width: Some(rect.width),
            client_width: Some(dom.client_width(el)),
            height: Some(rect.height),
            client_height: Some(dom.client_height(el)),
        },
    ) {
        return Vec::new();
    }
    if is_scroll_region(dom, el) {
        return Vec::new();
    }
    let mut p = dom.parent(el);
    while let Some(pp) = p {
        if is_scroll_region(dom, pp) {
            return Vec::new();
        }
        p = dom.parent(pp);
    }
    let client_width = dom.client_width(el);
    let delta = dom.scroll_width(el) - client_width;
    if client_width > 0.0 && delta >= 16.0 {
        return vec![RuleHit::new(
            "text-overflow",
            format!(
                "{} overflows its box by {}px",
                class_selector(dom, el),
                round_str(delta)
            ),
        )];
    }
    if client_width == 0.0 && rect.width > 0.0 {
        let mut container = dom.parent(el);
        while let Some(c) = container {
            if dom.client_width(c) != 0.0 {
                break;
            }
            container = dom.parent(c);
        }
        let Some(container) = container else {
            return Vec::new();
        };
        let stop = dom.parent(container);
        let mut p = Some(el);
        while let Some(pp) = p {
            if Some(pp) == stop {
                break;
            }
            let t = dom.style(pp, "transform");
            if !t.is_empty() && t != "none" {
                return Vec::new();
            }
            p = dom.parent(pp);
        }
        let c_rect = dom.rect(container);
        let content_right =
            c_rect.left + dom.client_left(container) + dom.client_width(container);
        let spill = rect.right - content_right;
        if spill >= 16.0 {
            return vec![RuleHit::new(
                "text-overflow",
                format!(
                    "{} overflows its container by {}px",
                    class_selector(dom, el),
                    round_str(spill)
                ),
            )];
        }
    }
    Vec::new()
}

// ── blinking cursor ───────────────────────────────────────────────────────

re!(HIDDEN_RE, js::ci("hidden"));
re!(
    BLINK_NAME_RE,
    format!("{}|{}|{}", js::ci("blink"), js::ci("caret"), js::ci("cursor"))
);

/// JS: checks.mjs#keyframesToggleVisibilityDOM(name)
pub fn keyframes_toggle_visibility_dom(dom: &dyn Dom, name: &str) -> bool {
    if name.is_empty() {
        return false;
    }
    let Some(frames) = dom.keyframes(name) else {
        return false;
    };
    let mut toggles_out = false;
    for frame in &frames {
        for (prop, value) in &frame.decls {
            if prop == "opacity" {
                if pf0(value) <= 0.15 {
                    toggles_out = true;
                }
            } else if prop == "visibility" {
                if HIDDEN_RE.is_match(value) {
                    toggles_out = true;
                }
            } else if prop != "animation-timing-function" {
                return false;
            }
        }
    }
    toggles_out
}

/// JS: checks.mjs#checkElementBlinkingCursorDOM(el)
pub fn check_element_blinking_cursor_dom(dom: &dyn Dom, el: ElId) -> Vec<BrowserFinding> {
    let tag = tag_lower(dom, el);
    if matches!(
        tag.as_str(),
        "input" | "textarea" | "select" | "img" | "svg" | "script" | "style"
    ) {
        return Vec::new();
    }
    let iterations: Vec<String> = dom
        .style(el, "animationIterationCount")
        .split(',')
        .map(|s| js::trim(s).to_string())
        .collect();
    if !iterations.iter().any(|s| s == "infinite") {
        return Vec::new();
    }
    let names: Vec<String> = dom
        .style(el, "animationName")
        .split(',')
        .map(|s| js::trim(s).to_string())
        .filter(|n| !n.is_empty() && n != "none")
        .collect();
    if names.is_empty() {
        return Vec::new();
    }
    let blink_name = names
        .iter()
        .find(|n| BLINK_NAME_RE.is_match(n))
        .cloned()
        .or_else(|| {
            names
                .iter()
                .find(|n| keyframes_toggle_visibility_dom(dom, n))
                .cloned()
        });
    let Some(blink_name) = blink_name else {
        return Vec::new();
    };
    if dom.is_content_editable(el)
        || closest_or_none(
            dom,
            el,
            "[contenteditable=\"\"], [contenteditable=\"true\"], [role=\"textbox\"]",
        )
        .is_some()
    {
        return Vec::new();
    }
    let rect = dom.rect(el);
    if rect.width <= 0.0 || rect.height <= 0.0 {
        return Vec::new();
    }
    let scroll_y = dom.scroll_y();
    let page_top = rect.top + if num_truthy(scroll_y) { scroll_y } else { 0.0 };
    if page_top > CURSOR_FIRST_VIEWPORT_PX {
        return Vec::new();
    }
    let text = js::trim(&dom.text_content(el)).to_string();
    let glyph_cursor = utf16_len(&text) == 1 && CURSOR_GLYPH_RE.is_match(&text);
    let mut block_cursor = false;
    if !glyph_cursor {
        if !text.is_empty() || !dom.children(el).is_empty() {
            return Vec::new();
        }
        let bg = parse_any_color(Some(&dom.style(el, "backgroundColor")));
        let filled = bg.map_or(false, |b| b.alpha_or_one() > 0.2);
        let has_border_fill = ["Left", "Right", "Bottom"]
            .iter()
            .any(|side| style_px(dom, el, &format!("border{side}Width")) >= 1.0);
        if !filled && !has_border_fill {
            return Vec::new();
        }
        let vertical = rect.width >= 1.0
            && rect.width <= 24.0
            && rect.height >= 6.0
            && rect.height <= 48.0
            && rect.height >= rect.width;
        let underscore =
            rect.height >= 1.0 && rect.height <= 6.0 && rect.width >= 4.0 && rect.width <= 24.0;
        if !vertical && !underscore {
            return Vec::new();
        }
        let radius_px = style_px(dom, el, "borderRadius");
        if radius_px >= 0.4 * js::math_min(rect.width, rect.height) {
            return Vec::new();
        }
        block_cursor = true;
    }
    if !glyph_cursor && !block_cursor {
        return Vec::new();
    }
    let in_hero_region = page_top <= 900.0
        || closest_or_none(
            dom,
            el,
            "header, nav, [role=\"banner\"], [role=\"navigation\"]",
        )
        .is_some();
    vec![BrowserFinding {
        type_: "blinking-cursor".to_string(),
        detail: format!(
            "{} — {}x{}px blinking cursor (animation \"{}\") in the first viewport",
            class_selector(dom, el),
            round_str(rect.width),
            round_str(rect.height),
            blink_name
        ),
        severity: if in_hero_region {
            Some("warning".to_string())
        } else {
            None
        },
        ignore_value: None,
    }]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::browser::fake_dom::FakeDom;

    fn page() -> (FakeDom, ElId) {
        let mut d = FakeDom::new();
        let (html, body) = d.with_page();
        for e in [html, body] {
            d.set_styles(
                e,
                &[
                    ("backgroundColor", "rgb(255, 255, 255)"),
                    ("backgroundImage", "none"),
                    ("opacity", "1"),
                    ("display", "block"),
                    ("visibility", "visible"),
                ],
            );
        }
        (d, body)
    }

    fn visible(d: &mut FakeDom, el: ElId) {
        d.set_styles(
            el,
            &[
                ("opacity", "1"),
                ("display", "block"),
                ("visibility", "visible"),
                ("backgroundImage", "none"),
            ],
        );
    }

    #[test]
    fn side_tab_border_flags_and_active_class_exempts() {
        let mut d = FakeDom::new();
        let (_html, body) = d.with_page();
        let card = d.add(Some(body), "div");
        d.set_rect(card, 0.0, 0.0, 300.0, 100.0);
        d.set_styles(
            card,
            &[
                ("borderTopWidth", "4px"),
                ("borderRightWidth", "0px"),
                ("borderBottomWidth", "0px"),
                ("borderLeftWidth", "0px"),
                ("borderLeftColor", "rgb(0, 0, 0)"),
                ("borderTopColor", "rgb(59, 130, 246)"),
                ("borderRightColor", "rgb(0, 0, 0)"),
                ("borderBottomColor", "rgb(0, 0, 0)"),
                ("borderRadius", "0px"),
                ("backgroundColor", "rgba(0, 0, 0, 0)"),
            ],
        );
        let hits = check_element_borders_dom(&d, card);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].id, "side-tab");
        assert_eq!(hits[0].snippet, "border-top: 4px");
        d.set_attr(card, "class", "card is-active");
        assert!(check_element_borders_dom(&d, card).is_empty());
    }

    #[test]
    fn pseudo_stripe_flags_left_stripe_and_skips_neutral() {
        let (mut d, body) = page();
        let card = d.add(Some(body), "div");
        visible(&mut d, card);
        d.set_attr(card, "class", "card feature");
        d.set_rect(card, 0.0, 0.0, 300.0, 120.0);
        for (p, v) in [
            ("content", "\"\""),
            ("position", "absolute"),
            ("opacity", "1"),
            ("display", "block"),
            ("width", "4px"),
            ("height", "120px"),
            ("left", "0px"),
            ("right", "296px"),
            ("top", "0px"),
            ("bottom", "0px"),
            ("backgroundColor", "rgb(59, 130, 246)"),
        ] {
            d.set_pseudo_style(card, "::before", p, v);
        }
        let hits = check_element_pseudo_stripe_dom(&d, card);
        assert_eq!(hits.len(), 1);
        assert_eq!(
            hits[0].snippet,
            "div.card.feature::before — absolute 4px pseudo-element stripe (left)"
        );
        d.set_pseudo_style(card, "::before", "backgroundColor", "rgb(120, 120, 120)");
        assert!(check_element_pseudo_stripe_dom(&d, card).is_empty());
    }

    #[test]
    fn colors_low_contrast_on_resolved_surface_and_pseudo_surface() {
        let (mut d, body) = page();
        let p = d.add(Some(body), "p");
        visible(&mut d, p);
        d.set_rect(p, 0.0, 0.0, 200.0, 40.0);
        d.add_text(p, "Body copy here");
        d.set_styles(
            p,
            &[
                ("backgroundColor", "rgba(0, 0, 0, 0)"),
                ("color", "rgb(200, 200, 200)"),
                ("fontSize", "16px"),
                ("fontWeight", "400"),
                ("webkitBackgroundClip", "border-box"),
            ],
        );
        let hits = check_element_colors_dom(&d, p);
        assert!(hits.iter().any(|h| h.id == "low-contrast"), "{hits:?}");
        // hidden by opacity: nothing
        d.set_style(p, "opacity", "0");
        assert!(check_element_colors_dom(&d, p).is_empty());
    }

    #[test]
    fn icon_tile_stack_flags() {
        let (mut d, body) = page();
        let card = d.add(Some(body), "div");
        let tile = d.add(Some(card), "div");
        let svg = d.add(Some(tile), "svg");
        let h3 = d.add(Some(card), "h3");
        d.add_text(h3, "Lightning Fast");
        d.set_rect(tile, 0.0, 0.0, 48.0, 48.0);
        d.set_rect(svg, 12.0, 12.0, 24.0, 24.0);
        d.set_rect(h3, 0.0, 60.0, 200.0, 24.0);
        d.set_styles(
            tile,
            &[
                ("backgroundColor", "rgb(59, 130, 246)"),
                ("backgroundImage", "none"),
                ("borderTopWidth", "0px"),
                ("borderRadius", "8px"),
            ],
        );
        let hits = check_element_icon_tile_dom(&d, h3);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].id, "icon-tile-stack");
        assert!(hits[0].snippet.contains("\"Lightning Fast\""), "{}", hits[0].snippet);
    }

    #[test]
    fn glow_uses_parent_surface_and_ai_palette_reads_gradient() {
        let (mut d, body) = page();
        d.set_style(body, "backgroundColor", "rgb(0, 0, 0)");
        let card = d.add(Some(body), "div");
        visible(&mut d, card);
        d.set_style(card, "boxShadow", "rgb(59, 130, 246) 0px 4px 20px 0px");
        d.set_style(card, "textShadow", "none");
        d.set_style(card, "backgroundColor", "rgba(0, 0, 0, 0)");
        let hits = check_element_glow_dom(&d, card);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].id, "dark-glow");
        assert_eq!(hits[0].snippet, "Colored box-shadow glow (#3b82f6) on dark background");

        let hero = d.add(Some(body), "section");
        d.set_style(
            hero,
            "backgroundImage",
            "linear-gradient(rgb(168, 85, 247), rgb(59, 130, 246))",
        );
        d.set_style(hero, "color", "rgb(0, 0, 0)");
        let hits = check_element_ai_palette_dom(&d, hero);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].snippet, "Purple/violet gradient background");
    }

    #[test]
    fn radial_spotlight_and_oversized_h1() {
        let (mut d, body) = page();
        let sec = d.add(Some(body), "section");
        d.set_attr(sec, "class", "hero glow");
        d.set_style(
            sec,
            "backgroundImage",
            "radial-gradient(circle at 52% 38%, rgba(80, 111, 255, 0.26), transparent 44%)",
        );
        d.set_rect(sec, 0.0, 0.0, 800.0, 400.0);
        let hits = check_element_radial_spotlight_dom(&d, sec);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].id, "radial-spotlight-glow");
        assert!(hits[0].snippet.contains("\"hero\""), "{}", hits[0].snippet);
        assert!(hits[0].snippet.contains("800x400"), "{}", hits[0].snippet);

        let h1 = d.add(Some(body), "h1");
        d.add_text(h1, "A really long headline that dominates the whole viewport");
        d.set_style(h1, "fontSize", "96px");
        d.set_rect(h1, 0.0, 0.0, 1200.0, 300.0);
        let hits = check_element_oversized_h1_dom(&d, h1);
        assert_eq!(hits.len(), 1);
        assert!(hits[0].snippet.starts_with("96px h1, 56 chars, 38vh"), "{}", hits[0].snippet);
    }

    #[test]
    fn clipped_overflow_and_text_overflow() {
        let (mut d, body) = page();
        let box_ = d.add(Some(body), "div");
        d.set_attr(box_, "class", "card");
        d.set_styles(box_, &[("overflow", "hidden"), ("overflowX", "hidden"), ("overflowY", "hidden")]);
        d.set_rect(box_, 0.0, 0.0, 200.0, 100.0);
        let menu = d.add(Some(box_), "div");
        d.add_text(menu, "Menu item");
        d.set_style(menu, "position", "absolute");
        d.set_rect(menu, 0.0, 90.0, 200.0, 60.0);
        let hits = check_element_clipped_overflow_dom(&d, box_);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].snippet, "div.card clips a positioned child");
        d.set_attr(box_, "class", "carousel");
        assert!(check_element_clipped_overflow_dom(&d, box_).is_empty());

        let cell = d.add(Some(body), "div");
        visible(&mut d, cell);
        d.set_attr(cell, "class", "cell");
        d.add_text(cell, "averyveryverylongword");
        d.set_rect(cell, 0.0, 0.0, 100.0, 20.0);
        d.el_mut(cell).client_width = 100.0;
        d.el_mut(cell).client_height = 20.0;
        d.el_mut(cell).scroll_width = 140.0;
        d.set_styles(cell, &[("overflow", "visible"), ("overflowX", "visible"), ("overflowY", "visible"), ("position", "static"), ("fontSize", "16px"), ("width", "100px"), ("height", "20px")]);
        let hits = check_element_text_overflow_dom(&d, cell);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].snippet, "div.cell overflows its box by 40px");
    }

    #[test]
    fn blinking_cursor_hero_promotion() {
        let (mut d, body) = page();
        let hero = d.add(Some(body), "header");
        let cur = d.add(Some(hero), "span");
        d.set_attr(cur, "class", "cursor");
        d.set_styles(
            cur,
            &[
                ("animationIterationCount", "infinite"),
                ("animationName", "blink"),
                ("backgroundColor", "rgb(0, 0, 0)"),
                ("borderRadius", "0px"),
                ("borderLeftWidth", "0px"),
                ("borderRightWidth", "0px"),
                ("borderBottomWidth", "0px"),
            ],
        );
        d.set_rect(cur, 100.0, 200.0, 2.0, 24.0);
        let hits = check_element_blinking_cursor_dom(&d, cur);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].severity.as_deref(), Some("warning"));
        assert_eq!(
            hits[0].detail,
            "span.cursor — 2x24px blinking cursor (animation \"blink\") in the first viewport"
        );
        // keyframes fallback: a fade name that toggles opacity
        d.set_style(cur, "animationName", "pulse-x");
        assert!(check_element_blinking_cursor_dom(&d, cur).is_empty());
        d.keyframes.insert(
            "pulse-x".into(),
            vec![crate::browser::dom::KeyframeFrame {
                decls: vec![("opacity".into(), "0".into())],
            }],
        );
        assert_eq!(check_element_blinking_cursor_dom(&d, cur).len(), 1);
    }
}
