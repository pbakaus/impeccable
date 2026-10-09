//! Section 6 browser page-level checks from `checks.mjs`: `checkTypography`,
//! `isCardLikeDOM`, `checkLayout`, `checkHeadingRhythmDOM`,
//! `checkCreamPalette` (browser path), `measureHiddenTextDOM`,
//! `checkEdgeFlushCardsDOM`, `isLayeredElement`, `elementDirectText`,
//! `isPaintedForOcclusion`, `checkTextOcclusionDOM`,
//! `checkFirstViewportColumnOverflowDOM`.

#![allow(unused_imports)]
use super::dom::{
    ancestors_inclusive, class_attr, closest_or_none, direct_text, has_direct_text_longer_than, pf0,
    style_px, tag_lower, Dom, ElId, ElStyle, Rect,
};
use super::element_checks::{
    ai_palette_blur_px, class_selector, effective_opacity_dom, is_rendered_for_browser_rule,
};
use super::painted::painted_at_capture;
use super::{BrowserFinding, ElFinding};
use crate::checks::embedded_content::{
    control_of, is_media_control_name, is_output_chrome, is_play_name, visible_chars, Control,
    CAPTION_MAX_CHARS,
};
use crate::checks::measures::{
    cream_from_class_list, is_cream_color, is_opaque_decorated_box,
    is_screen_reader_only_text_style, resolve_length_px, SrOnlyMetrics, StyleMap,
};
use crate::checks::rules::{
    check_flat_type_hierarchy_samples, flat_type_hierarchy_severity, is_card_like_from_props,
    parse_font_weight, type_hierarchy_role, RuleHit,
    TypeSample, TYPE_HIERARCHY_SELECTOR,
};
use crate::color::parse_any_color;
use crate::constants::{is_brand_font_on_own_domain, CSS_GENERIC_FONTS, OVERUSED_FONTS, SAFE_TAGS};
use crate::js::{self, math_max, math_min, math_round, number_to_string, parse_float, to_fixed};
use crate::js_ext_a::num_truthy;
use crate::js_ext_b::{slice_utf16_prefix, utf16_len};
use once_cell::sync::Lazy;
use regex::Regex;

/// The hidden-text measurement result type is shared.
pub use impeccable_foundation::browser::HiddenTextMeasure;

macro_rules! re {
    ($name:ident, $pat:expr) => {
        static $name: Lazy<Regex> = Lazy::new(|| Regex::new(&$pat).expect(stringify!($name)));
    };
}

/// JS `\b` (ASCII word boundary).
const B: &str = r"(?-u:\b)";

re!(WS_RE, format!("{}+", js::WS));
re!(QUOTE_EDGE_START, r#"^['"]"#);
re!(QUOTE_EDGE_END, r#"['"]$"#);
// A popup layer named as a word of a class: `dropdown`, `nav-menu`, and the
// BEM `mega-nav__dropdown-level2`. Any character that is not a letter or a
// digit separates the words, so `_` does too, which the ASCII `\b` this
// replaced did not: it never matched a BEM element name.
re!(
    POPOVER_CLASS_RE,
    format!(
        "(?:^|[^A-Za-z0-9])(?:{})(?:[^A-Za-z0-9]|$)",
        ["dropdown", "popover", "tooltip", "menu", "modal", "dialog"]
            .iter()
            .map(|w| js::ci(w))
            .collect::<Vec<_>>()
            .join("|")
    )
);
re!(SCROLL_RE, r"(auto|scroll)");
re!(HIDDEN_VIS_RE, r"^(hidden|collapse)$");
re!(
    MARQUEE_IDENT_RE,
    format!(
        "{B}({}){B}",
        ["marquee", "ticker", "scroller", "carousel", "conveyor"]
            .iter()
            .map(|w| js::ci(w))
            .collect::<Vec<_>>()
            .join("|")
    )
);
re!(MARQUEE_ANIM_RE, r"marquee|ticker|scroll");
re!(GRADIENT_URL_RE, format!("({}|{})\\(", js::ci("gradient"), js::ci("url")));
re!(MULTI_COL_RE, r"(^|inline-)(grid|flex)$");

/// JS `s.replace(/\s+/g, ' ')`.
fn collapse_ws(s: &str) -> String {
    WS_RE.replace_all(s, " ").into_owned()
}

/// JS `f.trim().replace(/^['"]|['"]$/g, '')`: one leading and one trailing
/// quote removed (the `g` flag on an anchored alternation).
fn strip_edge_quotes(s: &str) -> String {
    let t = QUOTE_EDGE_START.replace(s, "");
    QUOTE_EDGE_END.replace(&t, "").into_owned()
}

/// JS `[...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 0)`.
fn has_visible_direct_text(dom: &dyn Dom, el: ElId) -> bool {
    has_direct_text_longer_than(dom, el, 0)
}

/// Below this share of the characters in text that has a box, a face named
/// primary by its element count sets next to none of what a visitor reads,
/// and `overused-font` stands down.
///
/// Counted per element, a page of short labels in one face over long copy
/// in another names the label face: walla.co.il's Arial at "40% of text"
/// sets 2% of the characters. But the element count is also how a display
/// face that sets every heading gets named, and judges call that the
/// pattern too: of the findings both judges called harmful, the lowest
/// character share is mrtarget.de's Montserrat at 6.6%, then vestris.ai's
/// Instrument Serif at 7.9%. One character in twenty sits clear of both.
/// A finding above it is never moved or renamed.
pub const OVERUSED_FONT_MIN_CHAR_SHARE: f64 = 0.05;

/// Whether `font` sets under [`OVERUSED_FONT_MIN_CHAR_SHARE`] of the
/// characters in text that has a box. With no such text there is nothing to
/// weigh, and the element count stands.
fn sets_next_to_none_of_the_text(font: &str, chars: &[(String, f64)], total: f64) -> bool {
    if !(total > 0.0) {
        return false;
    }
    let own = chars.iter().find(|(k, _)| k == font).map_or(0.0, |(_, c)| *c);
    own / total < OVERUSED_FONT_MIN_CHAR_SHARE
}

/// The characters of `el`'s own text nodes as they render: white space
/// collapsed, and the indentation around each node dropped.
fn direct_text_chars(dom: &dyn Dom, el: ElId) -> f64 {
    dom.direct_text_nodes(el)
        .iter()
        .map(|t| collapse_ws(js::trim(t)).chars().count() as f64)
        .sum()
}

/// Whether an element's text is laid out for a visitor: neither it nor an
/// ancestor is `hidden`, `display: none`, `visibility: hidden` or
/// `content-visibility: hidden`. Opacity is deliberately not read: copy
/// waiting at `opacity: 0` for a scroll reveal is the page's copy and a
/// visitor reads all of it.
fn font_text_has_a_box(dom: &dyn Dom, el: ElId) -> bool {
    for current in ancestors_inclusive(dom, el) {
        if dom.hidden_prop(current) || dom.attr(current, "hidden").is_some() {
            return false;
        }
        let visibility = js::to_lower_case(&dom.style(current, "visibility"));
        if js::to_lower_case(&dom.style(current, "display")) == "none"
            || visibility == "hidden"
            || visibility == "collapse"
            || js::to_lower_case(&dom.style(current, "contentVisibility")) == "hidden"
        {
            return false;
        }
    }
    true
}

const IMPECCABLE_OWN: &str =
    ".impeccable-overlay, .impeccable-label, .impeccable-banner, .impeccable-tooltip";

/// JS: checks.mjs#checkTypography()
pub fn check_typography(dom: &dyn Dom) -> Vec<BrowserFinding> {
    let mut findings = Vec::new();

    let mut font_usage: Vec<(String, f64)> = Vec::new();
    let mut total_text_elements = 0.0f64;
    let mut font_chars: Vec<(String, f64)> = Vec::new();
    let mut total_text_chars = 0.0f64;
    for el in dom
        .query_all(
            None,
            "p, h1, h2, h3, h4, h5, h6, li, td, th, dd, blockquote, figcaption, a, button, label, span",
        )
        .unwrap_or_default()
    {
        if closest_or_none(dom, el, IMPECCABLE_OWN).is_some() {
            continue;
        }
        if !has_visible_direct_text(dom, el) {
            continue;
        }
        // The characters each face sets in text that has a box: what
        // stands a finding down when the face it names sets next to none of
        // what a visitor reads (below).
        let weight = if font_text_has_a_box(dom, el) { direct_text_chars(dom, el) } else { 0.0 };
        let ff = dom.style(el, "fontFamily");
        if ff.is_empty() {
            continue;
        }
        let stack: Vec<String> = ff
            .split(',')
            .map(|f| js::to_lower_case(&strip_edge_quotes(js::trim(f))))
            .collect();
        // JS-PARITY: checks.mjs#checkTypography uses primaryFontFace(ff) whose
        // default skip is CSS_GENERIC_FONTS, so a system stack keeps its system
        // face as primary (fix #678).
        let Some(primary) = stack
            .iter()
            .find(|f| !f.is_empty() && !CSS_GENERIC_FONTS.contains(&f.as_str()))
        else {
            continue;
        };
        if let Some(slot) = font_usage.iter_mut().find(|(k, _)| k == primary) {
            slot.1 += 1.0;
        } else {
            font_usage.push((primary.clone(), 1.0));
        }
        total_text_elements += 1.0;
        if weight > 0.0 {
            if let Some(slot) = font_chars.iter_mut().find(|(k, _)| k == primary) {
                slot.1 += weight;
            } else {
                font_chars.push((primary.clone(), weight));
            }
            total_text_chars += weight;
        }
    }

    if total_text_elements >= 20.0 {
        // Report the actual primary face: the uniquely most-used family. The
        // old 15% threshold labeled secondary faces as primary, e.g. an 82/18
        // split (#709). `Array.prototype.sort` is stable, so ties keep
        // first-seen order and the tie test compares the top two counts.
        let hostname = dom.hostname();
        let mut ranked: Vec<&(String, f64)> = font_usage.iter().collect();
        ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        if let Some((font, count)) = ranked.first().map(|(f, c)| (f, *c)) {
            let tied = ranked.get(1).map(|r| r.1) == Some(count);
            if !tied {
                let share = count / total_text_elements;
                if OVERUSED_FONTS.contains(&font.as_str())
                    && !is_brand_font_on_own_domain(font, Some(&hostname))
                    && !sets_next_to_none_of_the_text(font, &font_chars, total_text_chars)
                {
                    findings.push(BrowserFinding::new(
                        "overused-font",
                        format!(
                            "Primary font: {} ({}% of text)",
                            font,
                            number_to_string(math_round(share * 100.0))
                        ),
                    ));
                }
            }
        }
    }

    let samples = flat_type_samples_from_dom(dom, Some(TYPE_HIERARCHY_SKIP_SELECTOR));
    let severity = flat_type_hierarchy_severity(&samples);
    for hit in check_flat_type_hierarchy_samples(&samples) {
        let mut f = BrowserFinding::new(&hit.id, hit.snippet);
        f.severity = severity.map(String::from);
        findings.push(f);
    }

    findings
}

/// The overlay chrome `checkTypography` hands `checkFlatTypeHierarchyFromDoc`
/// as its `skipElement` selector.
pub const TYPE_HIERARCHY_SKIP_SELECTOR: &str =
    ".impeccable-overlay, .impeccable-label, .impeccable-banner, .impeccable-tooltip, [id^=\"impeccable-live-\"]";

/// JS: checks.mjs#isRenderedTypeElement over a live DOM, plus the
/// screen-reader-only utility: a heading in a 1px box its `clip` or
/// `clip-path: inset()` removes, or inside one (kingkong.tech's `h1.sr-only`
/// and its 1px SEO block of 16px headings), sets no size a visitor sees.
fn is_rendered_type_element(dom: &dyn Dom, el: ElId) -> bool {
    for current in ancestors_inclusive(dom, el) {
        if dom.hidden_prop(current) || dom.attr(current, "hidden").is_some() {
            return false;
        }
        if super::painted::is_visually_hidden_box(dom, current) {
            return false;
        }
        let display = js::to_lower_case(&dom.style(current, "display"));
        let visibility = js::to_lower_case(&dom.style(current, "visibility"));
        let content_visibility = js::to_lower_case(&dom.style(current, "contentVisibility"));
        if display == "none"
            || visibility == "hidden"
            || visibility == "collapse"
            || content_visibility == "hidden"
        {
            return false;
        }
        let opacity = parse_float(&dom.style(current, "opacity"));
        if opacity.is_finite() && opacity <= 0.01 {
            return false;
        }
    }
    true
}

/// JS: checks.mjs#checkFlatTypeHierarchyFromDoc over a live DOM.
pub fn check_flat_type_hierarchy_from_dom(
    dom: &dyn Dom,
    skip_selector: Option<&str>,
) -> Vec<RuleHit> {
    check_flat_type_hierarchy_samples(&flat_type_samples_from_dom(dom, skip_selector))
}

/// The type samples the flat-type-hierarchy check reads off a live DOM.
pub fn flat_type_samples_from_dom(dom: &dyn Dom, skip_selector: Option<&str>) -> Vec<TypeSample> {
    let mut samples: Vec<TypeSample> = Vec::new();
    for el in dom
        .query_all(None, TYPE_HIERARCHY_SELECTOR)
        .unwrap_or_default()
    {
        if let Some(sel) = skip_selector {
            if closest_or_none(dom, el, sel).is_some() {
                continue;
            }
        }
        if js::trim(&dom.text_content(el)).is_empty() || !is_rendered_type_element(dom, el) {
            continue;
        }
        let font_size = parse_float(&dom.style(el, "fontSize"));
        if !font_size.is_finite() || font_size < 8.0 || font_size >= 200.0 {
            continue;
        }
        samples.push(TypeSample {
            role: type_hierarchy_role(&tag_lower(dom, el)),
            size: font_size,
            weight: parse_font_weight(&dom.style(el, "fontWeight")),
        });
    }
    samples
}

/// Whether `el` is drawn as a card, read from its computed box rather than
/// its class names. A card has an outline, a painted edge on at least three
/// sides (borders, or shadows that reach past the box there) or a fill that
/// differs from the surface under it, and it is rounded or casts a shadow. A
/// `border-t` section, a footer rule and a `border-b-[4px]` band paint one
/// edge, which is a divider, not a card.
pub fn is_card_like_dom(dom: &dyn Dom, el: ElId) -> bool {
    let tag = tag_lower(dom, el);
    if SAFE_TAGS.contains(&tag.as_str())
        || matches!(
            tag.as_str(),
            "input" | "select" | "textarea" | "img" | "video" | "canvas" | "picture"
        )
    {
        return false;
    }
    let layers = crate::checks::measures::parse_shadow_layers(&dom.style(el, "boxShadow"));
    let casts_shadow = layers.iter().any(|l| {
        l.alpha >= crate::checks::measures::FAINT_PAINT_ALPHA
            && (l.x != 0.0 || l.y != 0.0 || l.blur > 0.0 || l.spread != 0.0)
    });
    let rounded = has_corner_radius(&dom.style(el, "borderRadius"));
    if !casts_shadow && !rounded {
        return false;
    }
    card_edge_sides(dom, el, &layers) >= 3 || fill_differs_from_surface(dom, el)
}

/// Whether `el` shows a border on any side (half a pixel wide or more, in a
/// style that draws and a colour that is not transparent) or casts a shadow.
/// A nested card needs one of the two: a rounded box that paints only a fill
/// (a chat bubble, a stat tile, an open accordion's tint) is not counted as an
/// inner card, per decision r4-p16-nested-cards-fill-only. The outer card
/// still counts a fill.
fn shows_border_or_shadow(dom: &dyn Dom, el: ElId) -> bool {
    let layers = crate::checks::measures::parse_shadow_layers(&dom.style(el, "boxShadow"));
    let casts_shadow = layers.iter().any(|l| {
        l.alpha >= crate::checks::measures::FAINT_PAINT_ALPHA
            && (l.x != 0.0 || l.y != 0.0 || l.blur > 0.0 || l.spread != 0.0)
    });
    casts_shadow
        || ["Top", "Right", "Bottom", "Left"].iter().any(|side| {
            let width = parse_float(&dom.style(el, &format!("border{side}Width")));
            let style = dom.style(el, &format!("border{side}Style"));
            let color = dom.style(el, &format!("border{side}Color"));
            width >= 0.5
                && style != "none"
                && style != "hidden"
                && crate::checks::measures::css_color_alpha(Some(&color))
                    >= crate::checks::measures::FAINT_PAINT_ALPHA
        })
}

/// Any corner of a computed `border-radius` above zero.
fn has_corner_radius(value: &str) -> bool {
    value
        .split(|c: char| c.is_ascii_whitespace() || c == '/')
        .any(|part| parse_float(part) > 0.0)
}

/// How many sides of `el` show a painted edge: a border at least half a pixel
/// wide in a style that draws and a colour that is not transparent, or an
/// outer shadow layer that reaches at least a pixel past the box on that side
/// (a ring, `0 0 0 1px`, reaches all four).
fn card_edge_sides(
    dom: &dyn Dom,
    el: ElId,
    layers: &[crate::checks::measures::ShadowLayer],
) -> usize {
    let mut sides = [false; 4];
    for (i, side) in ["Top", "Right", "Bottom", "Left"].iter().enumerate() {
        let width = parse_float(&dom.style(el, &format!("border{side}Width")));
        let style = dom.style(el, &format!("border{side}Style"));
        let color = dom.style(el, &format!("border{side}Color"));
        sides[i] = width >= 0.5
            && style != "none"
            && style != "hidden"
            && crate::checks::measures::css_color_alpha(Some(&color))
                >= crate::checks::measures::FAINT_PAINT_ALPHA;
    }
    for layer in layers {
        if layer.inset || layer.alpha < crate::checks::measures::FAINT_PAINT_ALPHA {
            continue;
        }
        for (i, reach) in layer.outer_reach().iter().enumerate() {
            if *reach >= 1.0 {
                sides[i] = true;
            }
        }
    }
    sides.iter().filter(|s| **s).count()
}

/// Whether `el` paints a fill a reader can tell from the surface it sits on:
/// an image or a gradient, or a colour that, composited over that surface,
/// moves a channel by more than 3. Where the surface cannot be read, any
/// colour that is not transparent counts, as it did before.
fn fill_differs_from_surface(dom: &dyn Dom, el: ElId) -> bool {
    let image = dom.style(el, "backgroundImage");
    if !image.is_empty() && image != "none" {
        return true;
    }
    let raw = dom.style(el, "backgroundColor");
    if crate::checks::measures::css_color_is_transparent(Some(&raw)) {
        return false;
    }
    let Some(surface) = super::element_checks::painted_surface_under(dom, el) else {
        return true;
    };
    let fill = super::element_checks::own_fill_over(dom, el, &surface);
    math_max(
        math_max((fill.r - surface.r).abs(), (fill.g - surface.g).abs()),
        (fill.b - surface.b).abs(),
    ) > 3.0
}

/// A label box, not a card: a pill whose rounding meets at its ends, or a box
/// whose content holds a single line of its own text (a chip, an eyebrow, a
/// badge drawn with a border and an offset shadow).
fn is_single_line_label_box(dom: &dyn Dom, el: ElId, rect: &Rect) -> bool {
    let radius = parse_float(&dom.style(el, "borderRadius"));
    if radius.is_finite() && rect.height > 0.0 && radius >= rect.height / 2.0 - 0.5 {
        return true;
    }
    let font_size = parse_float(&dom.style(el, "fontSize"));
    let line_height = {
        let raw = dom.style(el, "lineHeight");
        if raw == "normal" {
            font_size * 1.2
        } else {
            parse_float(&raw)
        }
    };
    if !line_height.is_finite() || line_height <= 0.0 {
        return false;
    }
    let chrome = ["paddingTop", "paddingBottom", "borderTopWidth", "borderBottomWidth"]
        .iter()
        .map(|p| {
            let v = parse_float(&dom.style(el, p));
            if v.is_finite() {
                v
            } else {
                0.0
            }
        })
        .sum::<f64>();
    rect.height - chrome <= line_height * 1.5
}

/// A frame around embedded media: an image, a video, a canvas or an iframe
/// inside it covers at least 60% of its box (a video thumbnail with a play
/// button, a screenshot in a bordered frame).
fn is_media_frame(dom: &dyn Dom, el: ElId, rect: &Rect) -> bool {
    let area = rect.width * rect.height;
    if !(area > 0.0) {
        return false;
    }
    dom.query_all(Some(el), "img, picture, video, canvas, iframe")
        .unwrap_or_default()
        .into_iter()
        .any(|media| {
            let r = dom.rect(media);
            let w = (rect.right.min(r.right) - rect.left.max(r.left)).max(0.0);
            let h = (rect.bottom.min(r.bottom) - rect.top.max(r.top)).max(0.0);
            w * h >= area * 0.6
        })
}

/// A box whose element children are all form controls: the filled, rounded
/// field Framer and most form kits draw around an input or a select. Its text
/// is the select's options, not content of its own.
fn is_field_box(dom: &dyn Dom, el: ElId) -> bool {
    let children = dom.children(el);
    !children.is_empty()
        && children
            .iter()
            .all(|&c| matches!(tag_lower(dom, c).as_str(), "input" | "select" | "textarea"))
}

/// Whether `inner` runs along at least three edges of `outer`'s padding box: a
/// header band or a footer strip of the card itself, which reads as one card
/// with a divided surface.
fn shares_card_edges(dom: &dyn Dom, inner: ElId, outer: ElId) -> bool {
    let a = dom.rect(inner);
    let b = dom.rect(outer);
    if a.width <= 0.0 || b.width <= 0.0 {
        return false;
    }
    let border = |side: &str| {
        let v = parse_float(&dom.style(outer, &format!("border{side}Width")));
        if v.is_finite() {
            v
        } else {
            0.0
        }
    };
    let near = |x: f64, y: f64| (x - y).abs() <= 1.5;
    [
        near(a.top, b.top + border("Top")),
        near(a.right, b.right - border("Right")),
        near(a.bottom, b.bottom - border("Bottom")),
        near(a.left, b.left + border("Left")),
    ]
    .iter()
    .filter(|s| **s)
    .count()
        >= 3
}

/// Share of a box's area an embedded figure must cover to be its main child.
const FIGURE_MIN_AREA_SHARE: f64 = 0.4;

/// Share of a box's text an output block must hold to be its main child.
const OUTPUT_MIN_TEXT_SHARE: f64 = 0.6;

/// A box with more elements than this is not read as an output block.
const OUTPUT_MAX_NODES: usize = 2000;

/// The controls inside `el` (itself included), with the name each reads by:
/// its `aria-label`, else its `title`, else its text.
fn controls_in(dom: &dyn Dom, el: ElId) -> Vec<(ElId, Control, String)> {
    let mut nodes = vec![el];
    nodes.extend(dom.query_all(Some(el), "*").unwrap_or_default());
    nodes
        .into_iter()
        .filter_map(|n| {
            let kind = control_of(
                &tag_lower(dom, n),
                dom.attr(n, "type").as_deref(),
                dom.attr(n, "role").as_deref(),
            )?;
            let name = dom
                .attr(n, "aria-label")
                .or_else(|| dom.attr(n, "title"))
                .unwrap_or_else(|| dom.text_content(n));
            Some((n, kind, name))
        })
        .collect()
}

/// Non-whitespace characters of `el`'s text outside its controls (a
/// control inside another one is counted once).
fn text_outside_controls(dom: &dyn Dom, el: ElId, controls: &[(ElId, Control, String)]) -> usize {
    let total = visible_chars(&dom.text_content(el));
    let inside: usize = controls
        .iter()
        .filter(|(c, _, _)| {
            !controls
                .iter()
                .any(|(o, _, _)| o != c && dom.contains(*o, *c))
        })
        .map(|(c, _, _)| visible_chars(&dom.text_content(*c)))
        .sum();
    total.saturating_sub(inside)
}

/// A figure: an `<svg>` or a `<canvas>` inside the box covers at least 40% of
/// it and is its main child. The box holds a caption beside it (text, at most
/// `CAPTION_MAX_CHARS` of it: a chart with its legend and source line) and no
/// control outside the figure. A feature tile with an illustration, a heading,
/// copy and buttons is ordinary text and controls and keeps reporting.
fn is_figure_box(dom: &dyn Dom, el: ElId, rect: &Rect) -> bool {
    let area = rect.width * rect.height;
    if !(area > 0.0) {
        return false;
    }
    let figures: Vec<ElId> = dom
        .query_all(Some(el), "svg, canvas")
        .unwrap_or_default()
        .into_iter()
        .filter(|&figure| {
            let r = dom.rect(figure);
            let w = (rect.right.min(r.right) - rect.left.max(r.left)).max(0.0);
            let h = (rect.bottom.min(r.bottom) - rect.top.max(r.top)).max(0.0);
            w * h >= area * FIGURE_MIN_AREA_SHARE
        })
        .collect();
    if figures.is_empty() {
        return false;
    }
    let total = visible_chars(&dom.text_content(el));
    let controls = controls_in(dom, el);
    figures.into_iter().any(|figure| {
        let caption = total.saturating_sub(visible_chars(&dom.text_content(figure)));
        caption > 0
            && caption <= CAPTION_MAX_CHARS
            && controls.iter().all(|(c, _, _)| dom.contains(figure, *c))
    })
}

/// A monospace output block: one element in the box (the box itself or a
/// descendant) holds at least 60% of the box's text, at least 90% of that
/// text is set in a monospace face, and it is one run of text (a `<pre>`, a
/// `<code>`, `<samp>`, `<kbd>` or `<output>`, a box that keeps its white
/// space, or text whose inline runs hold 80% of it): sample output, a
/// terminal transcript, a request printed as code. A stack of rows set in a
/// monospace face (a list of providers with toggles, a table of fields) is
/// ordinary text and controls and keeps reporting, and so does any box on a
/// page whose outer card is set in a monospace face itself. The block is the
/// box's main child only when the box holds no control but its own chrome (a
/// copy button, an icon button such as a code window's "more options" menu):
/// a card set in a monospace face with a paragraph and an Upgrade button is
/// ordinary text and controls. (Links are not controls: a terminal's inline
/// links stay part of its output.)
fn is_output_block(dom: &dyn Dom, el: ElId, outer: ElId) -> bool {
    use crate::checks::text_rules::is_monospace_family;
    if is_monospace_family(&dom.style(outer, "fontFamily")) {
        return false;
    }
    if !controls_in(dom, el)
        .iter()
        .all(|(c, kind, name)| is_output_chrome(*kind, name, &dom.text_content(*c)))
    {
        return false;
    }
    let mut nodes = vec![el];
    nodes.extend(dom.query_all(Some(el), "*").unwrap_or_default());
    if nodes.len() > OUTPUT_MAX_NODES {
        return false;
    }
    let index: std::collections::HashMap<ElId, usize> = nodes.iter().enumerate().map(|(i, &n)| (n, i)).collect();
    // Per node: its subtree's text, the monospace share of it, and the part
    // reached through inline boxes alone (one run of text).
    let mut text = vec![0usize; nodes.len()];
    let mut mono = vec![0usize; nodes.len()];
    let mut run = vec![0usize; nodes.len()];
    for (i, &node) in nodes.iter().enumerate() {
        let own: usize = dom
            .direct_text_nodes(node)
            .iter()
            .map(|t| t.chars().filter(|c| !c.is_whitespace()).count())
            .sum();
        text[i] = own;
        run[i] = own;
        if own > 0 && is_monospace_family(&dom.style(node, "fontFamily")) {
            mono[i] = own;
        }
    }
    // Document order puts every child after its parent, so a reverse walk
    // folds each subtree into its parent once.
    for i in (1..nodes.len()).rev() {
        let Some(&parent) = dom.parent(nodes[i]).and_then(|p| index.get(&p)) else {
            continue;
        };
        text[parent] += text[i];
        mono[parent] += mono[i];
        if matches!(dom.style(nodes[i], "display").as_str(), "inline" | "contents") {
            run[parent] += run[i];
        }
    }
    let total = text[0];
    if total == 0 {
        return false;
    }
    nodes.iter().enumerate().any(|(i, &node)| {
        if (text[i] as f64) < total as f64 * OUTPUT_MIN_TEXT_SHARE
            || (mono[i] as f64) < text[i] as f64 * 0.9
        {
            return false;
        }
        let preformatted = matches!(
            tag_lower(dom, node).as_str(),
            "pre" | "code" | "samp" | "kbd" | "output"
        ) || {
            let ws = dom.style(node, "whiteSpace");
            ws.starts_with("pre") || ws == "break-spaces"
        };
        preformatted || run[i] as f64 >= text[i] as f64 * 0.8
    })
}

/// A media player that is the box's main child. The box holds a visible
/// `<audio>` or `<video>` (drawn with its own controls, or covering 40% of
/// the box), or a play or pause button beside a seek control
/// (`role="slider"`, a range input or a `<progress>`). And the player is most
/// of the box: every control in it is the player's own (a seek control, or a
/// button named with a media word or not named at all), and the text outside
/// the controls is caption-length (a title and a time). A hidden sound
/// element, a small avatar video or a promo's play button in a card of
/// ordinary copy and controls does not make it a player.
fn is_media_player(dom: &dyn Dom, el: ElId, rect: &Rect) -> bool {
    let area = rect.width * rect.height;
    let visible_media = dom
        .query_all(Some(el), "audio, video")
        .unwrap_or_default()
        .into_iter()
        .any(|m| {
            let r = dom.rect(m);
            if !(r.width > 0.0 && r.height > 0.0) {
                return false;
            }
            let w = (rect.right.min(r.right) - rect.left.max(r.left)).max(0.0);
            let h = (rect.bottom.min(r.bottom) - rect.top.max(r.top)).max(0.0);
            dom.attr(m, "controls").is_some() || (area > 0.0 && w * h >= area * FIGURE_MIN_AREA_SHARE)
        });
    let controls = controls_in(dom, el);
    let custom = controls
        .iter()
        .any(|(_, kind, name)| *kind == Control::Button && is_play_name(name))
        && (controls.iter().any(|(_, kind, _)| *kind == Control::Seek)
            || dom.query_one(Some(el), "progress").ok().flatten().is_some());
    (visible_media || custom)
        && controls.iter().all(|(_, kind, name)| {
            *kind == Control::Seek || (*kind == Control::Button && is_media_control_name(name))
        })
        && text_outside_controls(dom, el, &controls) <= CAPTION_MAX_CHARS
}

/// Whether `el` is a dialog: a `<dialog>`, `role="dialog"` or
/// `role="alertdialog"`, or `aria-modal="true"`.
fn is_dialog_el(dom: &dyn Dom, el: ElId) -> bool {
    tag_lower(dom, el) == "dialog"
        || dom.attr(el, "role").is_some_and(|role| {
            role.split_ascii_whitespace()
                .any(|token| matches!(js::to_lower_case(token).as_str(), "dialog" | "alertdialog"))
        })
        || dom
            .attr(el, "aria-modal")
            .is_some_and(|v| js::to_lower_case(js::trim(&v)) == "true")
}

/// Whether the outer card is a dialog: the dialog itself, or the first
/// card-like box inside one (a modal's panel inside its fixed overlay). A
/// card further in, inside the dialog's panel, is an ordinary card and its
/// nested cards report.
fn is_dialog_card(dom: &dyn Dom, outer: ElId) -> bool {
    if is_dialog_el(dom, outer) {
        return true;
    }
    let mut cur = dom.parent(outer);
    while let Some(a) = cur {
        if is_dialog_el(dom, a) {
            return true;
        }
        if is_card_like_dom(dom, a) {
            return false;
        }
        cur = dom.parent(a);
    }
    false
}

/// `role="menu"` or `role="listbox"`: a popup panel, however card-like it is
/// drawn. `role="tablist"`, `role="radiogroup"` and `role="toolbar"`: a
/// composite control (easyveo.com's Video / Image switch is a bordered,
/// rounded `tablist` of two buttons), which is one control, not a card.
fn has_popup_role(dom: &dyn Dom, el: ElId) -> bool {
    dom.attr(el, "role").is_some_and(|role| {
        role.split_ascii_whitespace().any(|token| {
            matches!(
                js::to_lower_case(token).as_str(),
                "menu" | "listbox" | "tablist" | "radiogroup" | "toolbar"
            )
        })
    })
}

/// JS: checks.mjs#checkLayout() — `{ type, detail, el }`.
pub fn check_layout(dom: &dyn Dom) -> Vec<ElFinding> {
    let mut findings = Vec::new();
    let mut flagged: Vec<ElId> = Vec::new();

    for el in dom.query_all(None, "*").unwrap_or_default() {
        if !is_card_like_dom(dom, el) || flagged.contains(&el) {
            continue;
        }
        let cls = class_attr(dom, el);
        let pos = dom.style(el, "position");
        if pos == "absolute" || pos == "fixed" {
            continue;
        }
        if POPOVER_CLASS_RE.is_match(&cls) || has_popup_role(dom, el) {
            continue;
        }
        if utf16_len(js::trim(&dom.text_content(el))) < 10 {
            continue;
        }
        let rect = dom.rect(el);
        if rect.width < 50.0 || rect.height < 30.0 {
            continue;
        }
        // A chip, a pill or an eyebrow label drawn as a box is a control or a
        // label inside the card, not a second card, and so is the field box a
        // form draws around a single input or select. A highlight run inside a
        // line (`<mark>`) is not a box at all, and a frame around a picture or
        // a video is embedded media.
        //
        // A box that shows neither a border nor a shadow is not an inner card
        // (r4-p16), and neither is a frame around embedded content: a figure
        // with its caption, a monospace output block or a media player
        // (r4-p17).
        if !shows_border_or_shadow(dom, el)
            || is_single_line_label_box(dom, el, &rect)
            || is_field_box(dom, el)
            || matches!(dom.style(el, "display").as_str(), "inline" | "contents")
            || is_media_frame(dom, el, &rect)
        {
            continue;
        }
        let mut parent = dom.parent(el);
        while let Some(p) = parent {
            if is_card_like_dom(dom, p) {
                // A panel not painted at capture (a closed mega-nav panel
                // held at `visibility: hidden`) is not a card anyone sees,
                // a band along the card's own edges is part of it, and a
                // dialog's panels are the dialog's content (r4-p17).
                if super::painted::painted_at_capture(dom, el)
                    && !shares_card_edges(dom, el, p)
                    && !is_dialog_card(dom, p)
                    && !is_figure_box(dom, el, &rect)
                    && !is_media_player(dom, el, &rect)
                    && !is_output_block(dom, el, p)
                {
                    flagged.push(el);
                }
                break;
            }
            parent = dom.parent(p);
        }
    }

    for &el in &flagged {
        let is_ancestor = flagged
            .iter()
            .any(|&other| other != el && dom.contains(el, other));
        if !is_ancestor {
            let mut finding = BrowserFinding::new("nested-cards", "Card inside card");
            // The panels of a drawn product mockup are a picture of an
            // interface, not cards nested on this page: advisory there
            // (decision r6-t3-nested-cards-mockups).
            if super::decorative_text::box_in_mockup_dom(dom, el) {
                finding.severity = Some(crate::checks::rules::ADVISORY_SEVERITY.to_string());
            }
            findings.push(ElFinding { el: Some(el), finding });
        }
    }
    findings
}

/// `heading-rhythm`: an element that takes part in normal flow and paints a
/// box of its own.
fn rhythm_visible_flow(dom: &dyn Dom, el: ElId) -> bool {
    let display = dom.style(el, "display");
    let visibility = dom.style(el, "visibility");
    if display == "none" || visibility == "hidden" {
        return false;
    }
    let op = dom.style(el, "opacity");
    let op = if op.is_empty() { "1".to_string() } else { op };
    if parse_float(&op) <= 0.05 {
        return false;
    }
    let pos = dom.style(el, "position");
    if pos == "absolute" || pos == "fixed" || pos == "sticky" {
        return false;
    }
    let r = dom.rect(el);
    r.width >= 1.0 && r.height >= 1.0
}

/// `display: contents` generates no box: its children lay out as children
/// of its parent, so the walks look through it.
fn rhythm_is_contents(dom: &dyn Dom, el: ElId) -> bool {
    dom.style(el, "display") == "contents"
}

fn rhythm_overlaps_x(sr: &Rect, rect: &Rect) -> bool {
    math_min(sr.right, rect.right) - math_max(sr.left, rect.left) >= 8.0
}

/// A box that paints an edge on `side` ("Top" or "Bottom"): a background
/// colour, a background image that covers the box ([`rhythm_image_band`]),
/// a border on that side, or a shadow.
fn rhythm_paints_edge(dom: &dyn Dom, el: ElId, side: &str) -> bool {
    if rhythm_is_contents(dom, el) {
        return false;
    }
    if let Some(bg) = parse_any_color(Some(&dom.style(el, "backgroundColor"))) {
        if bg.alpha_or_one() > 0.05 {
            return true;
        }
    }
    if rhythm_image_band(dom, el) {
        return true;
    }
    if style_px(dom, el, &format!("border{side}Width")) > 0.0 {
        return true;
    }
    crate::checks::measures::box_shadow_paints(&dom.style(el, "boxShadow"))
}

/// A box whose `background-image` paints a band across all of it, with an
/// edge a reader sees as plainly as one painted with a colour: jyes.com.tw's
/// grey news band is a `url()` texture tiled over the section. A layer bands
/// the box when it tiles on both axes, is sized to `cover`, or is a gradient
/// drawn at the box's own size. An icon placed once beside a heading's text,
/// a short accent bar drawn with a gradient under it, and text filled with a
/// gradient (`background-clip: text`) decorate the box without painting it,
/// and a layer whose tiling the capture did not record (no `background`
/// shorthand) is not counted, as before.
fn rhythm_image_band(dom: &dyn Dom, el: ElId) -> bool {
    let image = dom.style(el, "backgroundImage");
    if image.is_empty() || image == "none" {
        return false;
    }
    if [dom.style(el, "backgroundClip"), dom.style(el, "webkitBackgroundClip")]
        .iter()
        .any(|clip| clip.contains("text"))
    {
        return false;
    }
    let images = crate::color::split_top_level_commas(&image);
    let sizes = crate::color::split_top_level_commas(&dom.style(el, "backgroundSize"));
    let layers = crate::color::split_top_level_commas(&dom.style(el, "background"));
    images.iter().enumerate().any(|(i, img)| {
        if img == "none" {
            return false;
        }
        let size = sizes.get(i).or(sizes.last()).map(|s| js::trim(s).to_string()).unwrap_or_default();
        if size == "cover" {
            return true;
        }
        let gradient = img.contains("gradient(");
        if gradient && matches!(size.as_str(), "auto" | "auto auto" | "100% 100%") {
            return true;
        }
        // The shorthand spells each layer's tiling; the image's own
        // parentheses are dropped so a `url()` holding "repeat" cannot match.
        let Some(layer) = layers.get(i) else { return false };
        let mut words = Vec::new();
        let mut depth = 0i32;
        let mut word = String::new();
        for c in layer.chars() {
            match c {
                '(' => depth += 1,
                ')' => depth = (depth - 1).max(0),
                c if depth == 0 && c.is_whitespace() => {
                    if !word.is_empty() {
                        words.push(std::mem::take(&mut word));
                    }
                }
                c if depth == 0 => word.push(c),
                _ => {}
            }
        }
        if !word.is_empty() {
            words.push(word);
        }
        let tiling: Vec<&str> = words
            .iter()
            .map(String::as_str)
            .filter(|w| matches!(*w, "repeat" | "repeat-x" | "repeat-y" | "no-repeat" | "space" | "round"))
            .collect();
        match tiling.as_slice() {
            [one] => matches!(*one, "repeat" | "space" | "round"),
            [x, y] => {
                matches!(*x, "repeat" | "space" | "round") && matches!(*y, "repeat" | "space" | "round")
            }
            _ => false,
        }
    })
}

/// The flow box `s` presents to a walk: `s` itself, or for a
/// `display: contents` element the nearest of its children. `pick` tests a
/// candidate's rect; `from_end` walks the children last-first.
fn rhythm_flow_box(
    dom: &dyn Dom,
    s: ElId,
    rect: &Rect,
    from_end: bool,
    pick: &dyn Fn(&Rect) -> bool,
) -> Option<ElId> {
    if rhythm_is_contents(dom, s) {
        let mut kids = dom.children(s);
        if from_end {
            kids.reverse();
        }
        // A spacer child is space, not the wrapper's block: the walk goes on
        // to the content beside it.
        return kids.into_iter().find_map(|k| {
            rhythm_flow_box(dom, k, rect, from_end, pick).filter(|&b| !rhythm_is_spacer(dom, b))
        });
    }
    if !rhythm_visible_flow(dom, s) {
        return None;
    }
    let sr = dom.rect(s);
    (pick(&sr) && rhythm_overlaps_x(&sr, rect)).then_some(s)
}

const RHYTHM_MEDIA_TAGS: &[&str] = &["img", "picture", "video", "canvas", "svg", "iframe"];

/// A box that draws a border on a side other than its bottom: a frame, not a
/// rule.
fn rhythm_frames(dom: &dyn Dom, el: ElId) -> bool {
    ["borderTopWidth", "borderLeftWidth", "borderRightWidth"]
        .iter()
        .any(|side| style_px(dom, el, side) > 0.0)
}

/// The block measured above a heading already separates it from the heading:
/// a rule (an `hr` or a line a few pixels tall), a bottom border drawn alone
/// on the block or on the descendants that form its bottom edge, or a picture
/// that forms that edge. A heading tight under a photo is that photo's
/// caption, and a heading tight under a rule starts the section the rule
/// opens; neither reads as a caption for the content above. A box bordered on
/// its other sides too (a code block, a panel, a table cell) is a framed block
/// of content, and the heading tight under it still reads as its caption.
fn rhythm_block_separates(dom: &dyn Dom, el: ElId) -> bool {
    let er = dom.rect(el);
    if tag_lower(dom, el) == "hr" || er.height <= 4.0 {
        return true;
    }
    // A block with no words that holds a picture is a picture: a photo frame,
    // an icon badge.
    if js::trim(&dom.text_content(el)).is_empty()
        && !dom
            .query_all(Some(el), "img, picture, video, canvas, svg, iframe")
            .unwrap_or_default()
            .is_empty()
    {
        return true;
    }
    let mut cur = Some(el);
    let mut framed = false;
    for _ in 0..8 {
        let Some(c) = cur else { break };
        let cr = dom.rect(c);
        // Inside a frame, the frame is the edge a reader sees; a line drawn
        // within it is part of the framed content.
        framed = framed || rhythm_frames(dom, c);
        // A rule runs across the block; a bordered button or chip inside it
        // does not.
        if !framed && style_px(dom, c, "borderBottomWidth") > 0.0 && cr.width >= er.width * 0.9 {
            return true;
        }
        let tag = tag_lower(dom, c);
        if RHYTHM_MEDIA_TAGS.contains(&tag.as_str()) && cr.width >= er.width * 0.5 {
            return true;
        }
        // A heading stacked under another heading (a name over a title, a
        // title over a subtitle) is one titling group, not a caption for
        // content above.
        if matches!(tag.as_str(), "h1" | "h2" | "h3" | "h4" | "h5" | "h6") {
            return true;
        }
        cur = dom.children(c).into_iter().rev().find(|&k| {
            if dom.style(k, "display") == "none" {
                return false;
            }
            let kr = dom.rect(k);
            kr.width >= 1.0 && kr.height >= 1.0 && kr.bottom >= er.bottom - 2.0
        });
    }
    false
}

fn rhythm_rendered_children(dom: &dyn Dom, el: ElId) -> Vec<ElId> {
    dom.children(el)
        .into_iter()
        .filter(|&k| {
            if dom.style(k, "display") == "none" {
                return false;
            }
            let pos = dom.style(k, "position");
            if pos == "absolute" || pos == "fixed" {
                return false;
            }
            let r = dom.rect(k);
            r.width >= 1.0 && r.height >= 1.0
        })
        .collect()
}

/// How many wrappers deep a spacer is looked for.
const RHYTHM_SPACER_MAX_DEPTH: usize = 4;

/// Form controls draw what they hold (a value, a placeholder) without DOM
/// text, so an empty one is content, not space.
const RHYTHM_CONTROL_TAGS: &[&str] = &["input", "textarea", "select", "button", "meter", "progress"];

/// An empty box that only holds space open: no text, no picture, nothing
/// painted, and nothing laid out inside it but boxes that are spacers too.
/// It is part of the gap, not a block. kinghost.com.br wraps each 40px
/// `wp-block-spacer` in a bare `div`; the wrapper holds space open exactly as
/// the spacer does.
fn rhythm_is_spacer(dom: &dyn Dom, el: ElId) -> bool {
    js::trim(&dom.text_content(el)).is_empty() && rhythm_is_empty_box(dom, el, RHYTHM_SPACER_MAX_DEPTH)
}

fn rhythm_is_empty_box(dom: &dyn Dom, el: ElId, depth: usize) -> bool {
    let tag = tag_lower(dom, el);
    if rhythm_paints_edge(dom, el, "Bottom")
        || RHYTHM_MEDIA_TAGS.contains(&tag.as_str())
        || RHYTHM_CONTROL_TAGS.contains(&tag.as_str())
    {
        return false;
    }
    // A rule drawn along the top of an empty box (an `hr`, a divider `div`)
    // is a line a reader sees, not space: the walk above meets it as the
    // block that separates the heading from the content above.
    if tag_lower(dom, el) == "hr" || style_px(dom, el, "borderTopWidth") > 0.0 {
        return false;
    }
    if rhythm_shadow_content(dom, el, depth) {
        return false;
    }
    let children = rhythm_rendered_children(dom, el);
    children.is_empty() || (depth > 0 && children.into_iter().all(|k| rhythm_is_empty_box(dom, k, depth - 1)))
}

/// A shadow host whose shadow tree lays out content: a box there with words,
/// or one that is not itself an empty box. The light tree of a web component
/// can be empty while its shadow tree draws a whole carousel (otto.de's
/// `oc-cinema-v1`, cisco.com's and hp.com's custom elements); read through
/// `children` and `text_content` alone, such a host looks like a spacer and
/// the walks measured past it. A shadow tree that holds only a `<slot>` and
/// `<style>` lays out nothing of its own, and the host's light children are
/// judged as before. A probe that cannot see shadow trees lists none.
fn rhythm_shadow_content(dom: &dyn Dom, el: ElId, depth: usize) -> bool {
    dom.shadow_children(el).into_iter().any(|k| {
        if dom.style(k, "display") == "none" {
            return false;
        }
        let pos = dom.style(k, "position");
        if pos == "absolute" || pos == "fixed" {
            return false;
        }
        let r = dom.rect(k);
        if r.width < 1.0 || r.height < 1.0 {
            return false;
        }
        if RHYTHM_UNRENDERED_TAGS.contains(&tag_lower(dom, k).as_str()) {
            return false;
        }
        !js::trim(&dom.text_content(k)).is_empty() || !rhythm_is_empty_box(dom, k, depth)
    })
}

/// Elements whose text is in `textContent` and never on screen.
const RHYTHM_UNRENDERED_TAGS: [&str; 4] = ["style", "script", "noscript", "template"];

/// A page landmark other than the main content: the footer, a navigation
/// block, a sidebar, a banner. A heading introduces none of them.
fn rhythm_is_side_landmark(dom: &dyn Dom, el: ElId) -> bool {
    matches!(tag_lower(dom, el).as_str(), "footer" | "nav" | "aside" | "header")
        || dom.attr(el, "role").is_some_and(|role| {
            role.split_ascii_whitespace().any(|token| {
                matches!(
                    js::to_lower_case(token).as_str(),
                    "contentinfo" | "navigation" | "complementary" | "banner"
                )
            })
        })
}

/// The page's main content landmark.
fn rhythm_is_main_landmark(dom: &dyn Dom, el: ElId) -> bool {
    tag_lower(dom, el) == "main"
        || dom.attr(el, "role").is_some_and(|role| {
            role.split_ascii_whitespace().any(|token| js::to_lower_case(token) == "main")
        })
}

/// Where a block's content ends, as a reader sees it: a box that paints its
/// bottom edge ends at that edge; otherwise its bottom padding is space, and
/// so is whatever runs past the lowest child it lays out.
fn rhythm_content_bottom(dom: &dyn Dom, el: ElId) -> f64 {
    // An inline run can draw its line box past the block that holds it; the
    // block's own bottom is as far as its content reaches.
    math_min(rhythm_lowest_content(dom, el), dom.rect(el).bottom)
}

fn rhythm_lowest_content(dom: &dyn Dom, el: ElId) -> f64 {
    let mut cur = el;
    for _ in 0..8 {
        let r = dom.rect(cur);
        if rhythm_paints_edge(dom, cur, "Bottom")
            || RHYTHM_MEDIA_TAGS.contains(&tag_lower(dom, cur).as_str())
        {
            return r.bottom;
        }
        let lowest = rhythm_rendered_children(dom, cur)
            .into_iter()
            .filter(|&k| !rhythm_is_spacer(dom, k))
            .max_by(|&a, &b| {
                dom.rect(a)
                    .bottom
                    .partial_cmp(&dom.rect(b).bottom)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
        match lowest {
            Some(k) => cur = k,
            None => return r.bottom - math_max(0.0, style_px(dom, cur, "paddingBottom")),
        }
    }
    dom.rect(cur).bottom
}

fn rhythm_font_size(dom: &dyn Dom, el: ElId) -> f64 {
    let n = parse_float(&dom.style(el, "fontSize"));
    if num_truthy(n) {
        n
    } else {
        16.0
    }
}

/// `el` and its descendants in document order, at most `limit` of them.
fn rhythm_subtree(dom: &dyn Dom, el: ElId, limit: usize) -> Vec<ElId> {
    let mut out = Vec::new();
    let mut stack = vec![el];
    while let Some(c) = stack.pop() {
        if out.len() >= limit {
            break;
        }
        out.push(c);
        let mut kids = dom.children(c);
        kids.reverse();
        stack.extend(kids);
    }
    out
}

fn rhythm_has_words(dom: &dyn Dom, el: ElId) -> bool {
    dom.direct_text_nodes(el).iter().any(|t| !js::trim(t).is_empty())
}

/// The size of the text a block sets: that of the first element in it that
/// holds words, or the block's own size when none does.
fn rhythm_text_size(dom: &dyn Dom, el: ElId) -> f64 {
    let first = rhythm_subtree(dom, el, 60)
        .into_iter()
        .find(|&e| rhythm_has_words(dom, e))
        .unwrap_or(el);
    rhythm_font_size(dom, first)
}

/// A short line above a heading that reads as the heading's label: set
/// smaller than the body text (`text_size`), in capitals, tracked out, or
/// as a chip that paints its own small box. A line set like the body copy is
/// content of its own (a date, a byline, a closing sentence), not a label.
/// `opens_group` says the line is the first box its parent lays out, which
/// lets colour, italics or weight alone mark it as a label
/// ([`rhythm_set_apart`]).
fn rhythm_reads_as_eyebrow(
    dom: &dyn Dom,
    line: ElId,
    heading: ElId,
    text_size: f64,
    opens_group: bool,
) -> bool {
    let heading_size = rhythm_font_size(dom, heading);
    let span = math_max(dom.rect(heading).width, dom.rect(line).width);
    for e in rhythm_subtree(dom, line, 40) {
        let er = dom.rect(e);
        if rhythm_paints_edge(dom, e, "Bottom")
            && er.width >= 1.0
            && er.width < span * 0.6
            && !js::trim(&dom.text_content(e)).is_empty()
        {
            return true;
        }
        if !rhythm_has_words(dom, e) {
            continue;
        }
        let size = rhythm_font_size(dom, e);
        if size > heading_size {
            continue;
        }
        if size < text_size * 0.92 || dom.style(e, "textTransform") == "uppercase" {
            return true;
        }
        let tracking = parse_float(&dom.style(e, "letterSpacing"));
        if tracking.is_finite() && tracking >= 0.5 {
            return true;
        }
        let text = dom.direct_text_nodes(e).concat();
        let cased: Vec<char> = text
            .chars()
            .filter(|c| c.is_uppercase() || c.is_lowercase())
            .collect();
        if cased.len() >= 3 && cased.iter().all(|c| c.is_uppercase()) {
            return true;
        }
        if opens_group && rhythm_set_apart(dom, line, heading, e) {
            return true;
        }
    }
    false
}

/// The longest line, in UTF-16 units, that reads as a label on colour,
/// italics or weight alone. cnnbrasil.com.br's section links ("Política",
/// "Eleições") and outreign.io's italic eyebrows ("Five screens", "Compare
/// plans") are a word or two; a sentence closing the block above is longer.
const RHYTHM_SET_APART_MAX_CHARS: usize = 40;

/// How far apart, on any channel, two text colours must be to read as two
/// colours: grey-400 on a black card, purple on off-white.
const RHYTHM_COLOUR_STEP: f64 = 32.0;

/// How much lighter than the text around it a line must be set to stand
/// apart on weight alone: a hairline 100 or 200 italic against 400 body copy.
const RHYTHM_LIGHTER_WEIGHT_STEP: f64 = 300.0;

fn rhythm_colours_differ(dom: &dyn Dom, a: ElId, b: ElId) -> bool {
    let (Some(ca), Some(cb)) = (
        parse_any_color(Some(&dom.style(a, "color"))),
        parse_any_color(Some(&dom.style(b, "color"))),
    ) else {
        return false;
    };
    (ca.r - cb.r).abs() >= RHYTHM_COLOUR_STEP
        || (ca.g - cb.g).abs() >= RHYTHM_COLOUR_STEP
        || (ca.b - cb.b).abs() >= RHYTHM_COLOUR_STEP
        || (ca.alpha_or_one() - cb.alpha_or_one()).abs() >= 0.25
}

fn rhythm_is_italic(dom: &dyn Dom, el: ElId) -> bool {
    let style = dom.style(el, "fontStyle");
    style.starts_with("italic") || style.starts_with("oblique")
}

/// A short line at body size that a reader still sees as a label: one
/// rendered line of a few words whose colour, italics or much lighter weight
/// sets it apart both from the text it sits in (its container's own type)
/// and from the heading under it. A grey category link over a black
/// headline, a purple italic eyebrow over a white title. A date or a closing
/// sentence set like the copy around it stays content of its own.
///
/// Colour and italics also mark the line that closes the block above: a blue
/// "View all essays" link under a grid, a grey date under an excerpt, with
/// the next heading a few pixels below. What tells the two apart is the
/// markup, so the caller asks this only of a line that opens its parent
/// (cnnbrasil.com.br's category link starts the box that holds the headline;
/// outreign.io's eyebrow starts the box that holds the title). A line with
/// the block above laid out before it in the same parent stays a block of its
/// own, and the gap is measured to it, as before.
fn rhythm_set_apart(dom: &dyn Dom, line: ElId, heading: ElId, words: ElId) -> bool {
    let Some(container) = dom.parent(line) else { return false };
    if utf16_len(js::trim(&collapse_ws(&dom.text_content(line)))) > RHYTHM_SET_APART_MAX_CHARS {
        return false;
    }
    let size = rhythm_font_size(dom, words);
    let pitch = resolve_length_px(Some(&dom.style(words, "lineHeight")), size)
        .filter(|lh| lh.is_finite() && *lh > 0.0)
        .unwrap_or(size * 1.2);
    let one_line = dom
        .direct_text_rect(words)
        .map_or(false, |t| t.height > 0.0 && t.height < math_max(pitch, size * 1.2) * 1.5);
    if !one_line {
        return false;
    }
    if rhythm_colours_differ(dom, words, container) && rhythm_colours_differ(dom, words, heading) {
        return true;
    }
    if rhythm_is_italic(dom, words) && !rhythm_is_italic(dom, container) && !rhythm_is_italic(dom, heading) {
        return true;
    }
    let weight = parse_font_weight(&dom.style(words, "fontWeight"));
    let around = parse_font_weight(&dom.style(container, "fontWeight"));
    weight.is_finite() && around.is_finite() && weight <= around - RHYTHM_LIGHTER_WEIGHT_STEP
}

fn rhythm_painted_background(dom: &dyn Dom, el: ElId) -> Option<crate::color::Rgba> {
    parse_any_color(Some(&dom.style(el, "backgroundColor"))).filter(|c| c.alpha_or_one() > 0.05)
}

/// A box that shows where it ends: a bottom border, a shadow, or a background
/// band that differs from the backdrop behind what follows it.
fn rhythm_draws_bottom_edge(dom: &dyn Dom, el: ElId) -> bool {
    if rhythm_is_contents(dom, el) {
        return false;
    }
    if style_px(dom, el, "borderBottomWidth") > 0.0 {
        return true;
    }
    if crate::checks::measures::box_shadow_paints(&dom.style(el, "boxShadow")) {
        return true;
    }
    rhythm_band_differs_from_backdrop(dom, el)
}

/// A wrapper the walk above cannot look past: one that shows where it
/// starts with a top border, a shadow, a background image that bands it, or
/// a background colour that differs from the backdrop behind it. A wrapper
/// filled with the same colour as the page around it (a white section on a
/// white page, samsung.com's and costco.com's full-width module boxes) has no
/// edge a reader sees, so the block above it is still the heading's
/// neighbour, as [`rhythm_draws_bottom_edge`] already holds for the walk
/// below.
fn rhythm_draws_top_edge(dom: &dyn Dom, el: ElId) -> bool {
    if rhythm_is_contents(dom, el) {
        return false;
    }
    if style_px(dom, el, "borderTopWidth") > 0.0 || rhythm_image_band(dom, el) {
        return true;
    }
    let bs = dom.style(el, "boxShadow");
    if !bs.is_empty() && bs != "none" {
        return true;
    }
    rhythm_band_differs_from_backdrop(dom, el)
}

/// `el` paints a background colour that differs from the nearest painted
/// background behind it (white when none is).
fn rhythm_band_differs_from_backdrop(dom: &dyn Dom, el: ElId) -> bool {
    let Some(band) = rhythm_painted_background(dom, el) else { return false };
    // With no fill above it, the band sits on the canvas: white, or the
    // browser's dark canvas on a page that asks for a dark scheme only.
    let mut backdrop = rhythm_canvas(dom);
    let mut cur = dom.parent(el);
    while let Some(c) = cur {
        if let Some(bg) = rhythm_painted_background(dom, c) {
            backdrop = bg;
            break;
        }
        cur = dom.parent(c);
    }
    (band.r - backdrop.r).abs() > 2.0
        || (band.g - backdrop.g).abs() > 2.0
        || (band.b - backdrop.b).abs() > 2.0
        || (band.alpha_or_one() - backdrop.alpha_or_one()).abs() > 0.02
}

/// The canvas colour a page paints under everything: Chrome's dark canvas
/// (`#121212`) when the root's `color-scheme` names dark and not light,
/// white otherwise.
fn rhythm_canvas(dom: &dyn Dom) -> crate::color::Rgba {
    let scheme = dom
        .document_element()
        .map(|root| js::to_lower_case(&dom.style(root, "colorScheme")))
        .unwrap_or_default();
    let words: Vec<&str> = scheme.split_whitespace().collect();
    if words.contains(&"dark") && !words.contains(&"light") {
        crate::color::Rgba::new(18.0, 18.0, 18.0, 1.0)
    } else {
        crate::color::Rgba::new(255.0, 255.0, 255.0, 1.0)
    }
}

/// The outline of a box's rendered structure: tags only, a few levels deep.
fn rhythm_shape(dom: &dyn Dom, el: ElId, depth: usize, budget: &mut usize, out: &mut String) {
    out.push_str(&tag_lower(dom, el));
    if depth == 0 {
        return;
    }
    let kids = rhythm_rendered_children(dom, el);
    if kids.is_empty() {
        return;
    }
    out.push('(');
    for k in kids {
        if *budget == 0 {
            out.push('+');
            break;
        }
        *budget -= 1;
        rhythm_shape(dom, k, depth - 1, budget, out);
        out.push(' ');
    }
    out.push(')');
}

fn rhythm_shape_of(dom: &dyn Dom, el: ElId) -> String {
    let mut out = String::new();
    let mut budget = 24;
    rhythm_shape(dom, el, 3, &mut budget, &mut out);
    out
}

/// How much two outlines share: the Dice coefficient of their tag multisets.
fn rhythm_shape_similarity(a: &str, b: &str) -> f64 {
    let tokens = |s: &str| -> Vec<String> {
        s.split(|c: char| c == '(' || c == ')' || c == ' ')
            .filter(|t| !t.is_empty())
            .map(String::from)
            .collect()
    };
    let ta = tokens(a);
    let mut tb = tokens(b);
    if ta.is_empty() && tb.is_empty() {
        return 1.0;
    }
    let total = ta.len() + tb.len();
    let mut shared = 0usize;
    for t in &ta {
        if let Some(i) = tb.iter().position(|u| u == t) {
            tb.swap_remove(i);
            shared += 1;
        }
    }
    2.0 * shared as f64 / total as f64
}

/// The way down from `row` to `h`, heading first: each step's tag, class, and
/// index among its parent's children.
fn rhythm_heading_path(dom: &dyn Dom, row: ElId, h: ElId) -> Vec<(String, String, usize)> {
    let mut path = Vec::new();
    let mut cur = h;
    while cur != row {
        let Some(p) = dom.parent(cur) else { break };
        let idx = dom.children(p).iter().position(|&k| k == cur).unwrap_or(0);
        path.push((tag_lower(dom, cur), class_attr(dom, cur), idx));
        cur = p;
    }
    path
}

/// `s` holds a heading of `h`'s level where `row` holds `h`: at the same child
/// path (the same tags at the same indices), or under the same chain of tags
/// and classes.
fn rhythm_holds_heading_alike(dom: &dyn Dom, s: ElId, path: &[(String, String, usize)]) -> bool {
    let Some((heading_tag, _, _)) = path.first() else { return false };
    let mut cur = Some(s);
    for (tag, _, idx) in path.iter().rev() {
        cur = cur
            .and_then(|c| dom.children(c).get(*idx).copied())
            .filter(|&k| &tag_lower(dom, k) == tag);
    }
    if cur.is_some() {
        return true;
    }
    rhythm_subtree(dom, s, 400).into_iter().skip(1).any(|e| {
        &tag_lower(dom, e) == heading_tag
            && rhythm_heading_path(dom, s, e)
                .iter()
                .map(|(t, c, _)| (t, c))
                .eq(path.iter().map(|(t, c, _)| (t, c)))
    })
}

/// Outlines at least this alike are one repeated component: an accordion row
/// next to the open row, a card without the label its neighbour carries.
const RHYTHM_REPEAT_SIMILARITY: f64 = 0.7;

/// A box that is one of a run of like boxes: an accordion row, a list item, a
/// card in a grid. The box laid out next to it on either side has the same
/// tag, holds a heading of the same level in the same place (the same child
/// path, or the same chain of classes down to it), and has a similar outline.
/// A layout wrapper that shares a generic class with its neighbour but holds
/// other content (a heading alone in a `.row`, then a `.row` of feature
/// columns) repeats nothing, and the heading is measured past it.
fn rhythm_repeats(dom: &dyn Dom, el: ElId, h: ElId) -> bool {
    let tag = tag_lower(dom, el);
    let shape = rhythm_shape_of(dom, el);
    let path = rhythm_heading_path(dom, el, h);
    let lays_out = |s: ElId| -> bool {
        let pos = dom.style(s, "position");
        let r = dom.rect(s);
        dom.style(s, "display") != "none"
            && pos != "absolute"
            && pos != "fixed"
            && r.width >= 1.0
            && r.height >= 1.0
            && !rhythm_is_spacer(dom, s)
    };
    let alike = |s: ElId| -> bool {
        tag_lower(dom, s) == tag
            && rhythm_holds_heading_alike(dom, s, &path)
            && rhythm_shape_similarity(&shape, &rhythm_shape_of(dom, s)) >= RHYTHM_REPEAT_SIMILARITY
    };
    let mut prev = dom.previous_element_sibling(el);
    while let Some(s) = prev {
        if lays_out(s) {
            if alike(s) {
                return true;
            }
            break;
        }
        prev = dom.previous_element_sibling(s);
    }
    let mut next = dom.next_element_sibling(el);
    while let Some(s) = next {
        if lays_out(s) {
            return alike(s);
        }
        next = dom.next_element_sibling(s);
    }
    false
}

/// Subpixel layout puts two gaps set with one margin a fraction of a pixel
/// apart; a gap above this much larger than the gap below still reads as
/// equal.
const RHYTHM_EVEN_SLACK_PX: f64 = 0.5;

/// Running prose has at least this many characters...
const RHYTHM_PROSE_MIN_CHARS: usize = 80;
/// ...on at least this many rendered lines...
const RHYTHM_PROSE_MIN_LINES: usize = 2;
/// ...set no larger than this multiple of the body text size...
const RHYTHM_PROSE_MAX_SIZE_RATIO: f64 = 1.25;
/// ...across at least this share of the heading's width.
const RHYTHM_PROSE_MIN_WIDTH_SHARE: f64 = 0.5;

/// The text block a reader sees at the bottom of `block`: the block itself
/// when it sets words, else the lowest box it lays out, followed down until
/// one does. `None` when that edge is a picture or a box that shows where it
/// ends (a card, a panel, a band): the heading then sits under that edge,
/// not under text.
fn rhythm_closing_text(dom: &dyn Dom, block: ElId) -> Option<ElId> {
    let mut cur = block;
    for _ in 0..12 {
        if RHYTHM_MEDIA_TAGS.contains(&tag_lower(dom, cur).as_str()) || rhythm_draws_bottom_edge(dom, cur) {
            return None;
        }
        if rhythm_has_words(dom, cur) {
            return Some(cur);
        }
        cur = rhythm_rendered_children(dom, cur)
            .into_iter()
            .filter(|&k| !rhythm_is_spacer(dom, k))
            .max_by(|&a, &b| {
                dom.rect(a)
                    .bottom
                    .partial_cmp(&dom.rect(b).bottom)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })?;
    }
    None
}

/// The block above a heading ends in running prose: a paragraph or text
/// block of several lines of body-size text, set across the column. The
/// text that closes the block ([`rhythm_closing_text`]) has at least 80
/// characters on at least two rendered lines, is set smaller than the
/// heading and no larger than 1.25 times the body text (`text_size`), is
/// not itself a heading, and spans at least half the heading's width.
///
/// Each part keeps out something the probe on run 38 found reading fine
/// with even gaps: a short closing line or a pull statement (a line or two
/// of large type), a card grid whose last caption is the block's bottom (a
/// column a third as wide as the heading), and an eyebrow set like body text
/// (one line). Lines are read from the capture's line boxes; a DOM that
/// cannot say where the lines are (snapshots recorded before line rects)
/// stands down, and the heading is judged by the crowded test alone.
fn rhythm_ends_in_prose(dom: &dyn Dom, block: ElId, heading: ElId, text_size: f64) -> bool {
    let Some(text_el) = rhythm_closing_text(dom, block) else { return false };
    if matches!(tag_lower(dom, text_el).as_str(), "h1" | "h2" | "h3" | "h4" | "h5" | "h6") {
        return false;
    }
    let size = rhythm_font_size(dom, text_el);
    if size >= rhythm_font_size(dom, heading) || size > text_size * RHYTHM_PROSE_MAX_SIZE_RATIO {
        return false;
    }
    if utf16_len(js::trim(&collapse_ws(&dom.text_content(text_el)))) < RHYTHM_PROSE_MIN_CHARS {
        return false;
    }
    if dom.rect(text_el).width < dom.rect(heading).width * RHYTHM_PROSE_MIN_WIDTH_SHARE {
        return false;
    }
    let Some(lines) = dom.text_line_rects(text_el) else { return false };
    lines.iter().filter(|r| r.width > 0.0 && r.height > 0.0).count() >= RHYTHM_PROSE_MIN_LINES
}

/// JS: checks.mjs#checkHeadingRhythmDOM()
pub fn check_heading_rhythm_dom(dom: &dyn Dom) -> Vec<ElFinding> {
    const MIN_VIOLATIONS: usize = 2;
    const CARD_EXEMPT_HEIGHT: f64 = 200.0;
    const MAX_BELOW_PX: f64 = 160.0;
    const MIN_DEFICIT_PX: f64 = 12.0;
    let body = dom.body();

    let is_visible_flow = |el: ElId| rhythm_visible_flow(dom, el);
    let overlaps_x = rhythm_overlaps_x;
    let has_own_top_boundary = |el: ElId| rhythm_paints_edge(dom, el, "Top");
    // The nearest previous sibling that lays out a box, looking through
    // `display: contents` and past elements that render nothing.
    let previous_box = |n: ElId| -> Option<ElId> {
        let mut sib = dom.previous_element_sibling(n);
        while let Some(s) = sib {
            if rhythm_is_contents(dom, s) {
                if let Some(inner) = dom.children(s).into_iter().rev().find(|&k| {
                    let r = dom.rect(k);
                    r.width >= 1.0 && r.height >= 1.0
                }) {
                    return Some(inner);
                }
            } else {
                let r = dom.rect(s);
                if dom.style(s, "display") != "none" && r.width >= 1.0 && r.height >= 1.0 {
                    return Some(s);
                }
            }
            sib = dom.previous_element_sibling(s);
        }
        None
    };
    // The eyebrow fold. A label above the heading is part of the heading's
    // cluster whether it is the heading's own sibling or a sibling of a
    // wrapper that starts where the cluster starts: per-text wrappers
    // (`<div><p>Label</p></div><div><h2>…</h2></div>`) are how site builders
    // emit an eyebrow, and missing them measured the gap to the heading's
    // own label. Only a line that reads as a label folds in: `text_size` is
    // the size of the body text it is set against.
    let cluster_top = |h: ElId, rect: &Rect, text_size: f64| -> (ElId, f64) {
        let mut top_el = h;
        let mut top = rect.top;
        let mut cursor = h;
        let mut folded = 0;
        while folded < 3 {
            let Some(sib) = previous_box(cursor) else {
                let Some(p) = dom.parent(cursor) else { break };
                if Some(p) == body {
                    break;
                }
                let starts_with_cluster = rhythm_is_contents(dom, p)
                    || ((dom.rect(p).top - top).abs() <= 1.0 && !has_own_top_boundary(p));
                if !starts_with_cluster {
                    break;
                }
                cursor = p;
                continue;
            };
            // An empty spacer is gap, as it is to `edge_above`: step over it
            // so a label above it still folds in.
            if rhythm_is_spacer(dom, sib) {
                cursor = sib;
                continue;
            }
            if !is_visible_flow(sib) {
                break;
            }
            let sr = dom.rect(sib);
            if !overlaps_x(&sr, rect) {
                break;
            }
            let gap = top - sr.bottom;
            if gap < 0.0 || gap >= 28.0 || sr.height > 60.0 {
                break;
            }
            let text = js::trim(&dom.text_content(sib)).to_string();
            let text_len = utf16_len(&text);
            // A label has words. A rule, a spacer or an icon above the heading
            // is a block of its own, and the walk above judges it as one.
            if text_len == 0 {
                break;
            }
            // A heading above is a title of its own, never this heading's label.
            if matches!(tag_lower(dom, sib).as_str(), "h1" | "h2" | "h3" | "h4" | "h5" | "h6") {
                break;
            }
            let opens_group = previous_box(sib).is_none();
            if text_len > 80 || !rhythm_reads_as_eyebrow(dom, sib, h, text_size, opens_group) {
                break;
            }
            top_el = sib;
            top = sr.top;
            cursor = sib;
            folded += 1;
        }
        (top_el, top)
    };
    // The block above, and where its content ends. The gap a reader sees
    // runs from that content to the cluster's own first line: empty spacer
    // boxes are part of the gap, so is the bottom padding of a block that
    // paints no edge, and so is top padding on the cluster's first box.
    let edge_above = |h: ElId, start_el: ElId, top: f64, rect: &Rect| -> Option<(f64, ElId)> {
        let pick = |sr: &Rect| sr.bottom <= top + 2.0;
        let inset = if rhythm_paints_edge(dom, start_el, "Top") {
            0.0
        } else {
            math_max(0.0, style_px(dom, start_el, "paddingTop"))
        };
        let mut node = Some(start_el);
        while let Some(n) = node {
            if Some(n) == body {
                break;
            }
            // The nearest block above, not the first in source order: flex and
            // grid `order` can lay siblings out in another sequence.
            let mut nearest: Option<(f64, ElId)> = None;
            let mut sib = dom.previous_element_sibling(n);
            while let Some(s) = sib {
                if let Some(b) = rhythm_flow_box(dom, s, rect, true, &pick) {
                    if !rhythm_is_spacer(dom, b) {
                        let bottom = rhythm_content_bottom(dom, b);
                        if nearest.map_or(true, |(nb, _)| bottom > nb) {
                            nearest = Some((bottom, b));
                        }
                    }
                }
                sib = dom.previous_element_sibling(s);
            }
            if let Some((bottom, b)) = nearest {
                return Some((bottom - inset, b));
            }
            let parent = dom.parent(n);
            let Some(p) = parent else { return None };
            if Some(p) == body {
                return None;
            }
            // A wrapper whose start a reader sees separates the heading from
            // whatever is above it; one painted the colour behind it does not,
            // unless it is one of a run of like boxes. Then its fill marks a
            // card (haraj.com.sa's listings alternate grey and white rows) and
            // the box above is the card before it, not content the heading
            // follows, as before.
            if rhythm_draws_top_edge(dom, p)
                || (rhythm_paints_edge(dom, p, "Top") && rhythm_repeats(dom, p, h))
            {
                return None;
            }
            node = Some(p);
        }
        None
    };
    // The content the heading introduces: the nearest block below it, with
    // empty spacer boxes counted as space. When the heading is the last thing
    // in its box, the walk leaves the box, and the box's bottom padding and
    // margin are space below: a padded section header, a title row stretched
    // by a button or an icon beside the heading. The exception is a box that
    // ends visibly (a bottom border, a shadow, a band of its own color) or is
    // one of a run of like boxes (accordion rows, list items, cards in a
    // grid). Then the heading ends its box, what follows belongs to the next
    // box, and there is nothing below to measure.
    let edge_below = |h: ElId, rect: &Rect| -> Option<(f64, ElId)> {
        let pick = |sr: &Rect| sr.top >= rect.bottom - 2.0;
        let mut node = Some(h);
        while let Some(n) = node {
            if Some(n) == body {
                break;
            }
            let mut nearest: Option<(f64, ElId)> = None;
            let mut sib = dom.next_element_sibling(n);
            while let Some(s) = sib {
                if let Some(b) = rhythm_flow_box(dom, s, rect, false, &pick) {
                    if !rhythm_is_spacer(dom, b) {
                        let t = dom.rect(b).top;
                        if nearest.map_or(true, |(nt, _)| t < nt) {
                            nearest = Some((t, b));
                        }
                    }
                }
                sib = dom.next_element_sibling(s);
            }
            if let Some((_, b)) = nearest {
                // Once the walk has left the heading's own box, a landmark
                // below is the next region of the page, not the content the
                // heading introduces: a heading that closes the main column
                // is not bound to the page footer under it.
                if n != h && rhythm_is_side_landmark(dom, b) {
                    return None;
                }
                return nearest;
            }
            let p = dom.parent(n)?;
            if Some(p) != body
                && !rhythm_is_contents(dom, p)
                && (rhythm_draws_bottom_edge(dom, p) || rhythm_repeats(dom, p, h))
            {
                return None;
            }
            // Nothing below the heading inside the main content: what follows
            // `main` belongs to another landmark.
            if rhythm_is_main_landmark(dom, p) {
                return None;
            }
            node = Some(p);
        }
        None
    };
    let inside_small_card = |h: ElId| -> bool {
        let mut cur = dom.parent(h);
        while let Some(c) = cur {
            if Some(c) == body {
                break;
            }
            if is_card_like_dom(dom, c) {
                let cr = dom.rect(c);
                if cr.height < CARD_EXEMPT_HEIGHT {
                    return true;
                }
            }
            cur = dom.parent(c);
        }
        false
    };

    struct Cand {
        el: ElId,
        tag: String,
        text: String,
        above: f64,
        below: f64,
    }
    let mut candidates: Vec<Cand> = Vec::new();
    for h in dom.query_all(None, "h2, h3, h4").unwrap_or_default() {
        if !is_visible_flow(h) {
            continue;
        }
        // A heading nobody sees at rest (a slide parked past its track, a
        // carousel clone, a tab panel off to the side) sets no rhythm and
        // counts toward no page minimum.
        if super::painted::unpainted_for(dom, h, super::painted::PaintGate::Text).is_some() {
            continue;
        }
        let text = collapse_ws(js::trim(&dom.text_content(h)));
        if utf16_len(&text) < 3 {
            continue;
        }
        let rect = dom.rect(h);
        // A heading that draws its own top rule or band is separated from
        // whatever sits above it by that edge.
        if has_own_top_boundary(h) {
            continue;
        }
        let Some((below_top, below_el)) = edge_below(h, &rect) else { continue };
        // The body text a label is set against: the page's own text size, or
        // the text the heading introduces when that is set larger.
        let text_size = math_max(
            body.map_or(16.0, |b| rhythm_font_size(dom, b)),
            rhythm_text_size(dom, below_el),
        );
        let (top_el, top) = cluster_top(h, &rect, text_size);
        let Some((above_bottom, above_el)) = edge_above(h, top_el, top, &rect) else { continue };
        if inside_small_card(h) {
            continue;
        }
        let above = math_max(0.0, top - above_bottom);
        let below = math_max(0.0, below_top - rect.bottom);
        if below < 6.0 || below > MAX_BELOW_PX {
            continue;
        }
        // Crowded: clearly less space above than below. Even: no more space
        // above than below, under running prose, where the paragraph above
        // and the heading read as one run of text (Paul, round 7:
        // r7-t1-heading-rhythm-equal-gaps). Under any other block an even
        // gap mostly reads fine: a band edge, a card grid, a kicker.
        let crowded = above < below * 0.75 && below - above >= MIN_DEFICIT_PX;
        let even_under_prose = !crowded
            && above <= below + RHYTHM_EVEN_SLACK_PX
            && rhythm_ends_in_prose(dom, above_el, h, text_size);
        if (crowded || even_under_prose) && !rhythm_block_separates(dom, above_el) {
            candidates.push(Cand {
                el: h,
                tag: tag_lower(dom, h),
                text: slice_utf16_prefix(&text, 60),
                above,
                below,
            });
        }
    }

    if candidates.len() < MIN_VIOLATIONS {
        return Vec::new();
    }
    let n = candidates.len();
    candidates
        .into_iter()
        .map(|c| ElFinding {
            el: Some(c.el),
            finding: BrowserFinding::new(
                "heading-rhythm",
                format!(
                    "{} \"{}\" has {}px above vs {}px below — it reads as bound to the block above ({} headings on page)",
                    c.tag,
                    c.text,
                    number_to_string(math_round(c.above)),
                    number_to_string(math_round(c.below)),
                    n
                ),
            ),
        })
        .collect()
}

/// The share of the page's height that full-width bands have to cover for
/// the body's own fill to count as hidden.
const GROUND_COVER_MIN_SHARE: f64 = 0.95;

/// The deepest level under the body (its children are level 1) at which
/// [`covering_ground`] takes a box for a band; it looks through transparent
/// boxes only (body > main > section reaches level 2).
const GROUND_BAND_MAX_DEPTH: usize = 3;

/// The deepest level under the body at which [`cream_band_shows`] looks for
/// a cream box. It looks through every full-width box, opaque ones
/// included, since an SPA root that paints the ground can hold its cream
/// sections several levels down (body > #root > div > div > main >
/// section); it visits only full-width boxes, so the walk stays short.
const CREAM_BAND_MAX_DEPTH: usize = 8;

/// The colour a visitor sees as the page's ground when in-flow boxes as wide
/// as the body, each painting an opaque fill and no image, cover the body
/// from its top to the end of the page (within [`GROUND_COVER_MIN_SHARE`]):
/// the fill that covers the most height. Transparent in-flow boxes are looked
/// through, a few levels down. `None` (the body's own fill stands) when the
/// bands leave more of the page uncovered (a box with no measured rect
/// covers nothing), or when the page has no measured height.
fn covering_ground(dom: &dyn Dom, body: ElId) -> Option<crate::color::Rgba> {
    let body_rect = dom.rect(body);
    let sy = finite_or_zero(dom.scroll_y());
    if !body_rect.all_finite() || body_rect.width <= 0.0 {
        return None;
    }
    let page_bottom = dom
        .document_element()
        .map(|root| dom.scroll_height(root))
        .filter(|h| h.is_finite())
        .unwrap_or(0.0)
        .max(body_rect.bottom + sy);
    if page_bottom <= 0.0 {
        return None;
    }
    // (top, bottom, fill) in document coordinates.
    let mut bands: Vec<(f64, f64, crate::color::Rgba)> = Vec::new();
    let mut stack: Vec<(ElId, usize)> = vec![(body, 0)];
    while let Some((el, depth)) = stack.pop() {
        for child in dom.children(el) {
            if !matches!(dom.style(child, "position").as_str(), "static" | "relative" | "sticky" | "") {
                continue;
            }
            if !painted_at_capture(dom, child) {
                continue;
            }
            // A box with no measured rect covers nothing: what it would have
            // covered counts as the body's.
            let r = dom.rect(child);
            if !r.all_finite() || r.height <= 0.0 || r.width < GROUND_COVER_MIN_SHARE * body_rect.width {
                continue;
            }
            let image = dom.style(child, "backgroundImage");
            let fill = super::background::read_own_background_color(dom, child);
            // A band faded below full opacity lets the body show through.
            let opaque = effective_opacity_dom(dom, child) >= 0.95;
            match fill {
                Some(f) if opaque && f.alpha_or_one() >= 0.95 && (image.is_empty() || image == "none") => {
                    bands.push((r.top + sy, r.bottom + sy, f));
                }
                _ if depth + 1 < GROUND_BAND_MAX_DEPTH && fill.map_or(true, |f| f.alpha_or_one() <= 0.0) => {
                    stack.push((child, depth + 1));
                }
                _ => {}
            }
        }
    }
    let start = (body_rect.top + sy).max(0.0);
    let mut spans: Vec<(f64, f64)> = bands
        .iter()
        .map(|&(t, b, _)| (t.max(start), b.min(page_bottom)))
        .filter(|(t, b)| b > t)
        .collect();
    spans.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut covered = 0.0;
    let mut reach = start;
    for (t, b) in spans {
        if b > reach {
            covered += b - t.max(reach);
            reach = b;
        }
    }
    if covered < GROUND_COVER_MIN_SHARE * (page_bottom - start) {
        return None;
    }
    let mut by_fill: Vec<(crate::color::Rgba, f64)> = Vec::new();
    for (t, b, f) in bands {
        let h = (b.min(page_bottom) - t.max(start)).max(0.0);
        match by_fill.iter_mut().find(|(c, _)| c.r == f.r && c.g == f.g && c.b == f.b) {
            Some(entry) => entry.1 += h,
            None => by_fill.push((f, h)),
        }
    }
    by_fill.into_iter().fold(None, |best: Option<(crate::color::Rgba, f64)>, (c, h)| match best {
        Some((_, bh)) if bh >= h => best,
        _ => Some((c, h)),
    })
    .map(|(c, _)| c)
}

/// Whether a painted in-flow box as wide as the body, up to
/// [`CREAM_BAND_MAX_DEPTH`] levels under it, paints a cream fill of its own
/// by the strict cream test. Near-cream (which keeps a finding when it is
/// the ground) is deliberately not enough here: a warm near-white header or
/// footer strip on a white page (visiby.net/guides) does not make the page
/// cream, while a near-cream colour covering most of the page does.
fn cream_band_shows(dom: &dyn Dom, body: ElId) -> bool {
    let width = dom.rect(body).width;
    let mut stack: Vec<(ElId, usize)> = vec![(body, 0)];
    while let Some((el, depth)) = stack.pop() {
        for child in dom.children(el) {
            if !matches!(dom.style(child, "position").as_str(), "static" | "relative" | "sticky" | "") {
                continue;
            }
            let r = dom.rect(child);
            if !r.all_finite() || r.height <= 0.0 || r.width < GROUND_COVER_MIN_SHARE * width {
                continue;
            }
            if !painted_at_capture(dom, child) {
                continue;
            }
            let fill = super::background::read_own_background_color(dom, child);
            if fill.is_some_and(|f| f.alpha_or_one() >= 0.95) && is_cream_color(fill.as_ref()) {
                return true;
            }
            if depth + 1 < CREAM_BAND_MAX_DEPTH {
                stack.push((child, depth + 1));
            }
        }
    }
    false
}

/// A light warm colour within a few steps of the cream test: every channel
/// at 209 or more, red over green over blue, and red at least
/// [`NEAR_CREAM_MIN_WARMTH`] over blue.
fn near_cream(c: &crate::color::Rgba) -> bool {
    c.r.min(c.g).min(c.b) >= 209.0 && c.r >= c.g && c.g >= c.b && c.r - c.b >= NEAR_CREAM_MIN_WARMTH
}

/// Red at least 2 over blue. The grounds the cover test drops are grey
/// (useforward.co's rgb(241, 242, 239), green over red, which fails the
/// channel order at any floor) or white (warmth 0); the warm ground it keeps
/// (visiby.net's rgb(250, 248, 245), warmth 5) sits 3 units clear.
const NEAR_CREAM_MIN_WARMTH: f64 = 2.0;

fn finite_or_zero(v: f64) -> f64 {
    if v.is_finite() {
        v
    } else {
        0.0
    }
}

/// JS: checks.mjs#checkCreamPalette(document) (browser path), plus the
/// covered-body test ([`covering_ground`], [`cream_band_shows`]).
pub fn check_cream_palette(dom: &dyn Dom) -> Vec<RuleHit> {
    let mut findings = Vec::new();
    let Some(body) = dom.body() else { return findings };
    let html = dom.document_element();

    let mut bg = super::background::read_own_background_color(dom, body);
    if bg.is_none() || bg.map_or(false, |c| c.a == Some(0.0)) {
        if let Some(h) = html {
            bg = super::background::read_own_background_color(dom, h);
        }
    }
    if is_cream_color(bg.as_ref()) {
        // Where full-width bands cover the body from top to bottom, the
        // body's fill is not what a visitor sees (useforward.co: a cream
        // body under a dark hero and grey sections): the colour that covers
        // the most of the page is its ground, and a ground that is not cream
        // shows none. A cream ground keeps the finding as the body names it,
        // and so does a ground just short of the cream test's warmth floor
        // (visiby.net's wrapper at rgb(250, 248, 245) over a body at
        // rgb(246, 244, 239)): what is dropped is a ground that is plainly
        // not warm paper.
        // A cream band laid over the covering ground (visiby.net's pricing
        // page: a white root with a cream ticker and trust strip) still
        // shows the cream.
        if covering_ground(dom, body).is_some_and(|ground| !is_cream_color(Some(&ground)) && !near_cream(&ground))
            && !cream_band_shows(dom, body)
        {
            return findings;
        }
        let c = bg.unwrap();
        findings.push(RuleHit::new(
            "cream-palette",
            format!(
                "cream/beige page background rgb({}, {}, {})",
                number_to_string(c.r),
                number_to_string(c.g),
                number_to_string(c.b)
            ),
        ));
        return findings;
    }

    for el in [Some(body), html] {
        let cls = el.and_then(|e| dom.attr(e, "class"));
        // JS `el && el.getAttribute ? el.getAttribute('class') : ''` then
        // creamFromClassList(null) → null.
        if let Some(tok) = cream_from_class_list(cls.as_deref()) {
            findings.push(RuleHit::new(
                "cream-palette",
                format!("cream/beige page background (Tailwind {})", tok),
            ));
            break;
        }
    }
    findings
}

const HIDDEN_TEXT_EXCLUDE_TAGS: &[&str] = &[
    "script", "style", "noscript", "template", "title", "head", "meta", "link", "option",
    "optgroup", "select", "datalist", "dialog",
];

#[derive(Clone, Copy, PartialEq)]
enum HiddenState {
    Visible,
    Invisible,
    Excluded,
    /// Inside a slider that never started ([`unstarted_slider`]): out of
    /// both counts, and reported as a capture note instead.
    Unstarted,
}

/// Class words that name a slider or carousel: the box's own class, or a
/// class of its library (`swiper`, `slick`, `splide`, `glide`, `flickity`,
/// Slider Revolution's `rev_slider`).
const SLIDER_CLASS_WORDS: &[&str] =
    &["slider", "carousel", "swiper", "slick", "splide", "glide", "flickity", "slideshow", "revslider"];

/// The boxes that show a slide's picture, where a slide shows no text.
const SLIDER_MEDIA_TAGS: &[&str] = &["img", "picture", "video", "canvas", "svg"];

/// How far above a hidden box the slider that holds it is looked for.
const SLIDER_MAX_DEPTH: usize = 6;

/// Class words that name one slide of a slider (`swiper-slide`,
/// `carousel-item`, `splide__slide`) or a part of one (Bootstrap's
/// `carousel-caption`): such a box is in a slider, not the slider.
const SLIDE_CLASS_WORDS: &[&str] = &["slide", "item", "cell", "card", "pane", "caption"];

/// Whether `el` is a slider box: a class token names a slider
/// ([`SLIDER_CLASS_WORDS`]) and not one of its slides
/// ([`SLIDE_CLASS_WORDS`]).
fn slider_class(dom: &dyn Dom, el: ElId) -> bool {
    dom.attr(el, "class").unwrap_or_default().split_whitespace().any(|token| {
        let words = class_words(token);
        words.iter().any(|w| SLIDER_CLASS_WORDS.contains(&w.as_str()))
            && !words.iter().any(|w| SLIDE_CLASS_WORDS.contains(&w.as_str()))
    })
}

/// Whether `el`'s own text paints within `upto`: it is not
/// `visibility: hidden | collapse`, and no box from it up to `upto`
/// (inclusive) is `display: none`, `aria-hidden="true"` or at opacity 0.02 or
/// less.
fn text_shows_within(dom: &dyn Dom, el: ElId, upto: ElId) -> bool {
    shows_within(dom, el, upto, true)
}

/// [`text_shows_within`] for a picture: `aria-hidden` hides nothing from
/// sight, and a decorative slide image often carries it.
fn picture_shows_within(dom: &dyn Dom, el: ElId, upto: ElId) -> bool {
    shows_within(dom, el, upto, false)
}

fn shows_within(dom: &dyn Dom, el: ElId, upto: ElId, aria_hides: bool) -> bool {
    if HIDDEN_VIS_RE.is_match(&dom.style(el, "visibility")) {
        return false;
    }
    let mut cur = Some(el);
    while let Some(e) = cur {
        if dom.style(e, "display") == "none"
            || (aria_hides && dom.attr(e, "aria-hidden").as_deref() == Some("true"))
            || pf0(&dom.style(e, "opacity")) <= 0.02
        {
            return false;
        }
        if e == upto {
            return true;
        }
        cur = dom.parent(e);
    }
    true
}

/// Whether `el`, a box that is itself transparent or `visibility: hidden`,
/// sits in a slider that never started (corpus decision
/// r6-t6-hidden-scroll-linked): the box or one of its nearest
/// [`SLIDER_MAX_DEPTH`] ancestors carries a slider class
/// ([`SLIDER_CLASS_WORDS`]), and not one element in that slider shows text
/// or a picture ([`text_shows_within`]). A slider that started shows its current slide,
/// so its other slides are not this (they count as before). One that shows
/// nothing at all is the capture's state (a script that had not run, a
/// preloader still up), not something to measure the page by.
fn unstarted_slider(dom: &dyn Dom, el: ElId, verdicts: &mut std::collections::HashMap<ElId, bool>) -> bool {
    let Some(slider) = ancestors_inclusive(dom, el).into_iter().take(SLIDER_MAX_DEPTH + 1).find(|a| slider_class(dom, *a))
    else {
        return false;
    };
    if let Some(v) = verdicts.get(&slider) {
        return *v;
    }
    // A slide shows its text, or a picture: an image-only carousel that
    // started shows its current image while every caption waits hidden. The
    // picture has to be a slide's, inside the slider and spanning at least
    // half its width: an arrow icon or a dot beside slides that are all
    // hidden, or a backdrop on the slider's own box, starts nothing.
    let slider_width = dom.rect(slider).width;
    let shows = |e: ElId| {
        let pictured = || {
            let r = dom.rect(e);
            e != slider
                && r.width >= 1.0
                && r.height >= 1.0
                && (!(slider_width.is_finite() && slider_width > 0.0) || r.width >= 0.5 * slider_width)
                && (SLIDER_MEDIA_TAGS.contains(&tag_lower(dom, e).as_str())
                    || js::to_lower_case(&dom.style(e, "backgroundImage")).contains("url("))
        };
        (dom.direct_text_nodes(e).iter().any(|t| !js::trim(&collapse_ws(t)).is_empty()) && text_shows_within(dom, e, slider))
            || (pictured() && picture_shows_within(dom, e, slider))
    };
    let started =
        shows(slider) || dom.query_all(Some(slider), "*").unwrap_or_default().into_iter().any(shows);
    verdicts.insert(slider, !started);
    !started
}

/// At most this many hidden boxes are probed for a scroll-linked reveal
/// ([`Dom::shown_when_scrolled_to`]), the ones holding the most text.
pub const SCROLL_PROBE_MAX: usize = 8;

/// Roles that make an invisible box, or an invisible box inside one, closed
/// navigation: a menu that opens on demand.
const CLOSED_NAV_ROLES: &[&str] = &["navigation", "menu", "menubar"];

/// Roles that make an invisible box itself a closed overlay or an unselected
/// panel. Read on the box only: a selected tab panel or an open dialog can
/// hold a reveal that never ran.
const CLOSED_PANEL_ROLES: &[&str] = &["dialog", "alertdialog", "tabpanel"];

/// The words of a class token: split at anything that is not a letter or a
/// digit and at each lower-to-upper step, lowercased (`sp-tab-content`,
/// `Tabs_panel__x1`, `megaMenu`).
fn class_words(token: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut word = String::new();
    let mut prev_lower = false;
    for c in token.chars() {
        if !c.is_ascii_alphanumeric() || (c.is_ascii_uppercase() && prev_lower) {
            if !word.is_empty() {
                words.push(std::mem::take(&mut word));
            }
        }
        if c.is_ascii_alphanumeric() {
            word.push(c.to_ascii_lowercase());
        }
        prev_lower = c.is_ascii_lowercase();
    }
    if !word.is_empty() {
        words.push(word);
    }
    words
}

/// Whether a class token names a container that is closed until its trigger
/// opens it: a drawer (`offcanvas`, `drawer`), a menu flyout (`megamenu`,
/// `submenu`, `dropdown`, `flyout`), a modal, or a tab or accordion panel
/// (`tab-content`, `tab-pane`, `accordion-panel`). A bare `menu` or `tab` is
/// not enough: a restaurant's `menu-section` and a `tab` button are content.
fn closed_container_class(token: &str) -> bool {
    let words = class_words(token);
    let has = |w: &str| words.iter().any(|x| x == w);
    let pair = |a: &str, b: &str| words.windows(2).any(|p| p[0] == a && p[1] == b);
    if ["offcanvas", "drawer", "megamenu", "submenu", "dropdown", "flyout", "modal", "tabpanel", "tabpane"]
        .iter()
        .any(|w| has(w))
        || pair("off", "canvas")
        || pair("mega", "menu")
        || pair("sub", "menu")
    {
        return true;
    }
    let panel = ["content", "panel", "pane", "body"].iter().any(|w| has(w));
    panel && (has("tab") || has("tabs") || has("accordion"))
}

/// Whether a trigger marks the tab panel `el` open: an element whose
/// `aria-controls` names its id says `aria-selected="true"` or
/// `aria-expanded="true"`, or the tab its `aria-labelledby` names says
/// `aria-selected="true"`.
fn tab_panel_marked_open(dom: &dyn Dom, el: ElId) -> bool {
    let says_true = |e: ElId, name: &str| {
        dom.attr(e, name).map(|v| js::to_lower_case(js::trim(&v))).as_deref() == Some("true")
    };
    if let Some(id) = dom.attr(el, "id").map(|id| js::trim(&id).to_string()).filter(|id| !id.is_empty()) {
        let opens = dom.query_all(None, "[aria-controls]").unwrap_or_default().into_iter().any(|t| {
            dom.attr(t, "aria-controls").is_some_and(|ids| ids.split_whitespace().any(|i| i == id))
                && (says_true(t, "aria-selected") || says_true(t, "aria-expanded"))
        });
        if opens {
            return true;
        }
    }
    let labels = dom.attr(el, "aria-labelledby").unwrap_or_default();
    if labels.trim().is_empty() {
        return false;
    }
    dom.query_all(None, "[aria-selected]").unwrap_or_default().into_iter().any(|t| {
        says_true(t, "aria-selected")
            && dom.attr(t, "id").is_some_and(|tid| labels.split_whitespace().any(|l| l == tid))
    })
}

/// The ids whose controlling triggers all say closed: every element whose
/// `aria-controls` names the id carries `aria-expanded="false"` or
/// `aria-selected="false"`, and none says `true`.
fn closed_controlled_ids(dom: &dyn Dom) -> std::collections::HashSet<String> {
    let mut closed = std::collections::HashSet::new();
    let mut open = std::collections::HashSet::new();
    for trigger in dom.query_all(None, "[aria-controls]").unwrap_or_default() {
        let Some(ids) = dom.attr(trigger, "aria-controls") else { continue };
        let state = |name: &str| dom.attr(trigger, name).map(|v| js::to_lower_case(js::trim(&v)));
        let (expanded, selected) = (state("aria-expanded"), state("aria-selected"));
        let is = |v: &Option<String>, want: &str| v.as_deref() == Some(want);
        let says_open = is(&expanded, "true") || is(&selected, "true");
        let says_closed = is(&expanded, "false") || is(&selected, "false");
        for id in ids.split_whitespace() {
            if says_open {
                open.insert(id.to_string());
            } else if says_closed {
                closed.insert(id.to_string());
            }
        }
    }
    closed.retain(|id| !open.contains(id));
    closed
}

/// Whether `el`, a box that is itself transparent or `visibility: hidden`,
/// is closed interface waiting for its trigger rather than content whose
/// reveal never ran (corpus decision r5-p5-content-hidden-closed-navigation).
/// Any one of:
///
/// - it sits in navigation: the box or an ancestor is a `nav`, or carries a
///   role in [`CLOSED_NAV_ROLES`];
/// - the box or an ancestor is `inert`;
/// - the box or an ancestor is named by an `aria-controls` trigger that says
///   `aria-expanded="false"` or `aria-selected="false"` (`closed_ids`);
/// - the box itself carries a role in [`CLOSED_PANEL_ROLES`];
/// - the box itself carries a class token [`closed_container_class`] knows;
/// - the box itself follows its trigger: the element before it, or that
///   element's first child (a heading wrapping a button), says
///   `aria-expanded="false"`, the accordion that names no `aria-controls`
///   (the wrapper is a heading or holds nothing but the trigger);
/// - the box itself is a drawer parked beside the page: `position: fixed`
///   and wholly left or right of the viewport;
/// - the box itself is an overlay waiting to open: `position: fixed`, at
///   `visibility: hidden`, and covering the whole viewport;
/// - the box or an ancestor is a drawer slid off the page
///   ([`slid_off_drawer`]): hse.de's mobile menu, `position: absolute`
///   inside a panel translated a viewport width to the left.
///
/// A tab panel (by role or by a tab class) that its tab marks selected
/// ([`tab_panel_marked_open`]) is not closed by its own role or class: it is
/// the panel a visitor was meant to see. The other tests still apply.
///
/// A box none of these describe is base behaviour: its text counts as hidden.
fn closed_container(dom: &dyn Dom, el: ElId, closed_ids: &std::collections::HashSet<String>) -> bool {
    let role = |e: ElId| dom.attr(e, "role").map(|r| js::to_lower_case(js::trim(&r))).unwrap_or_default();
    let own_role = role(el);
    let class = dom.attr(el, "class").unwrap_or_default();
    // A tab panel its own tab marks selected is the panel a visitor is meant
    // to see: hidden, its reveal failed, and it is content like any other,
    // whether the role or a class (`tab-pane`) names it a panel.
    let tab_like = own_role == "tabpanel"
        || class.split_whitespace().any(|t| class_words(t).iter().any(|w| matches!(w.as_str(), "tab" | "tabs" | "tabpanel" | "tabpane")));
    // Only the panel's own role and class exemptions yield to that: an
    // inert or collapsed wrapper around it still closes it.
    let selected = tab_like && tab_panel_marked_open(dom, el);
    if !selected && CLOSED_PANEL_ROLES.contains(&own_role.as_str()) {
        return true;
    }
    if !selected && class.split_whitespace().any(closed_container_class) {
        return true;
    }
    let collapsed = |e: ElId| {
        dom.attr(e, "aria-expanded").map(|v| js::to_lower_case(js::trim(&v))).as_deref() == Some("false")
    };
    if let Some(before) = dom.previous_element_sibling(el) {
        // The wrapped trigger is the accordion heading's: a heading, or a
        // box holding only the trigger. A site header whose first child is a
        // closed hamburger says nothing about the hero after it.
        let wraps_trigger = || {
            let tag = tag_lower(dom, before);
            matches!(tag.as_str(), "h1" | "h2" | "h3" | "h4" | "h5" | "h6")
                || role(before) == "heading"
                || dom.children(before).len() == 1
        };
        if collapsed(before) || (dom.first_element_child(before).is_some_and(collapsed) && wraps_trigger()) {
            return true;
        }
    }
    if js::to_lower_case(&dom.style(el, "position")) == "fixed" {
        let rect = dom.rect(el);
        let viewport_width = dom.inner_width();
        if rect.width > 0.0 && (rect.right <= 0.0 || (viewport_width > 0.0 && rect.left >= viewport_width)) {
            return true;
        }
        // A layer fixed over the whole viewport and held at `visibility:
        // hidden` is a dialog or overlay waiting to open (visitabudhabi.ae's
        // MUI "Create Itinerary" modal), as long as it is not the page
        // itself: an app shell fixed over the viewport (`#app { position:
        // fixed; inset: 0 }`) held hidden by a reveal that failed is what the
        // rule reports, so a layer holding a `main`, an `h1`, or half the
        // page's text or more is left to the other tests. Transparency
        // alone is not enough either: a shell faded to 0 waiting for its
        // reveal looks the same.
        let viewport_height = dom.inner_height();
        if HIDDEN_VIS_RE.is_match(&dom.style(el, "visibility"))
            && rect.all_finite()
            && viewport_width > 0.0
            && viewport_height > 0.0
            && rect.left <= 1.0
            && rect.top <= 1.0
            && rect.right >= viewport_width - 1.0
            && rect.bottom >= viewport_height - 1.0
            && !holds_the_page(dom, el)
        {
            return true;
        }
    }
    for a in ancestors_inclusive(dom, el) {
        if tag_lower(dom, a) == "nav" || CLOSED_NAV_ROLES.contains(&role(a).as_str()) {
            return true;
        }
        if slid_off_drawer(dom, a) {
            return true;
        }
        if dom.attr(a, "inert").is_some() {
            return true;
        }
        if !closed_ids.is_empty() {
            if let Some(id) = dom.attr(a, "id") {
                if closed_ids.contains(&id) {
                    return true;
                }
            }
        }
    }
    false
}

/// Whether `el` holds the page rather than an overlay on it: a `main`
/// (or `role="main"`) or an `h1` inside it, or at least half of the
/// document's text.
fn holds_the_page(dom: &dyn Dom, el: ElId) -> bool {
    if dom.query_one(Some(el), "main, [role=\"main\"], h1").ok().flatten().is_some() {
        return true;
    }
    let Some(body) = dom.body() else { return true };
    let own = js::trim(&dom.text_content(el)).chars().count();
    let page = js::trim(&dom.text_content(body)).chars().count();
    page == 0 || own * 2 >= page
}

/// Whether `el` is a drawer slid off the page: positioned (`absolute` or
/// `fixed`), moved by a `transform` other than the identity that it
/// transitions, and with its box wholly left or right of the viewport. That
/// is an off-canvas panel at rest in its closed position, which its trigger
/// slides in; Tailwind's `-translate-x-full transition-transform` is the
/// usual spelling. A box parked off the page with no transform, or one that
/// does not animate its transform, is left to the other tests.
fn slid_off_drawer(dom: &dyn Dom, el: ElId) -> bool {
    let position = js::to_lower_case(&dom.style(el, "position"));
    if position != "absolute" && position != "fixed" {
        return false;
    }
    let transform = js::trim(&dom.style(el, "transform")).replace(' ', "");
    if transform.is_empty() || transform == "none" || super::element_checks::is_identity_matrix(&transform) {
        return false;
    }
    if !super::painted::declares_transition_of(dom, el, "transform") {
        return false;
    }
    let rect = dom.rect(el);
    let viewport_width = dom.inner_width();
    rect.all_finite()
        && rect.width > 0.0
        && viewport_width > 0.0
        && (rect.right <= 0.0 || rect.left >= viewport_width)
}

/// The topmost box from `el` up to, but not including, `start` that holds
/// itself at opacity 0.02 or less, or hides itself with `visibility` under a
/// visible parent: a box inside a hidden one that stays hidden when the outer
/// one is revealed. `None` when `el` is hidden only
/// through `start`.
fn held_inside(dom: &dyn Dom, el: ElId, start: ElId) -> Option<ElId> {
    let mut found = None;
    let mut cur = Some(el);
    while let Some(b) = cur {
        if b == start {
            break;
        }
        let opacity = js::parse_float(&dom.style(b, "opacity"));
        // `visibility` inherits, so a hidden box hides itself only where its
        // parent is visible: there the declaration is its own.
        let hidden = |e: ElId| matches!(dom.style(e, "visibility").as_str(), "hidden" | "collapse");
        // ...and only while `el` inherits it: a descendant that sets
        // `visibility: visible` again shows through it.
        let own_hidden = hidden(b) && hidden(el) && dom.parent(b).is_some_and(|p| !hidden(p));
        if (opacity.is_finite() && opacity <= 0.02) || own_hidden {
            found = Some(b);
        }
        cur = dom.parent(b);
    }
    found
}

/// JS: checks.mjs#measureHiddenTextDOM()
///
/// Text in closed interface is left out of both counts, like text under
/// `display: none` or `aria-hidden`: a box that starts a transparent or
/// `visibility: hidden` subtree and is a [`closed_container`] (a closed menu,
/// drawer or dialog, an unselected tab or accordion panel). Nobody expects a
/// closed menu to show, so it is not content a reveal failed to show.
///
/// Corpus decision r6-t6-hidden-scroll-linked adds two more:
///
/// - Text in a slider that never started ([`unstarted_slider`]) leaves both
///   counts and is reported in [`HiddenTextMeasure::unstarted_slider_chars`],
///   which the URL engine turns into a capture note rather than a finding.
/// - When the share would report, the hidden boxes holding the most text (up
///   to [`SCROLL_PROBE_MAX`]) are asked [`Dom::shown_when_scrolled_to`]. A box
///   that shows once the page is scrolled to it is a scroll-linked reveal the
///   measure caught at the top of the page: its text counts as shown, as a
///   box a CSS scroll or view timeline holds at 0 does, except text under a
///   box inside it that holds itself at opacity 0, which is asked about on
///   its own ([`held_inside`]). A box the probe has
///   not looked at (`None`: a replay of a recording made before the probe,
///   any DOM with no page behind it) stays hidden.
pub fn measure_hidden_text_dom(dom: &dyn Dom) -> HiddenTextMeasure {
    let root = dom.document_element();
    let mut cache: std::collections::HashMap<ElId, HiddenState> = std::collections::HashMap::new();
    // Read once, and only when the page has an invisible box to classify.
    let closed_ids: std::cell::OnceCell<std::collections::HashSet<String>> = std::cell::OnceCell::new();
    // The page's CSS, read once and only for a box an animation holds at 0.
    let style_text: std::cell::OnceCell<String> = std::cell::OnceCell::new();
    // Per slider box: whether it never started.
    let mut sliders: std::collections::HashMap<ElId, bool> = std::collections::HashMap::new();

    fn page_style_text(dom: &dyn Dom) -> String {
        let html = dom.document_html_for_patterns();
        let mut text = crate::checks::html_patterns::build_html_pattern_corpora(&html).style_text;
        text.push('\n');
        text.push_str(&dom.linked_stylesheet_text());
        text
    }

    #[allow(clippy::too_many_arguments)]
    fn state_of(
        dom: &dyn Dom,
        root: Option<ElId>,
        cache: &mut std::collections::HashMap<ElId, HiddenState>,
        closed_ids: &std::cell::OnceCell<std::collections::HashSet<String>>,
        style_text: &std::cell::OnceCell<String>,
        sliders: &mut std::collections::HashMap<ElId, bool>,
        el: Option<ElId>,
    ) -> HiddenState {
        let Some(el) = el else { return HiddenState::Visible };
        if Some(el) == root {
            return HiddenState::Visible;
        }
        if let Some(s) = cache.get(&el) {
            return *s;
        }
        let tag = tag_lower(dom, el);
        let state = if HIDDEN_TEXT_EXCLUDE_TAGS.contains(&tag.as_str()) {
            HiddenState::Excluded
        } else {
            let parent_state = state_of(dom, root, cache, closed_ids, style_text, sliders, dom.parent(el));
            if parent_state == HiddenState::Excluded {
                HiddenState::Excluded
            } else {
                let display = dom.style(el, "display");
                let cv = js::to_lower_case(&dom.style(el, "contentVisibility"));
                if display == "none"
                    || dom.hidden_prop(el)
                    || dom.attr(el, "aria-hidden").as_deref() == Some("true")
                    || cv == "hidden"
                {
                    HiddenState::Excluded
                } else if parent_state == HiddenState::Unstarted {
                    HiddenState::Unstarted
                } else if parent_state == HiddenState::Invisible {
                    HiddenState::Invisible
                } else if pf0(&dom.style(el, "opacity")) <= 0.02
                    || HIDDEN_VIS_RE.is_match(&dom.style(el, "visibility"))
                {
                    // The box where the invisible subtree starts decides for
                    // everything under it.
                    let by_visibility = HIDDEN_VIS_RE.is_match(&dom.style(el, "visibility"));
                    if closed_container(dom, el, closed_ids.get_or_init(|| closed_controlled_ids(dom))) {
                        HiddenState::Excluded
                    } else if super::painted::parked_outside_clip(dom, el) {
                        // A box parked outside the ancestor that clips it
                        // shows nothing at any opacity: collapsed interface,
                        // not content a reveal failed to show.
                        HiddenState::Excluded
                    } else if !by_visibility
                        && dom.running_animation_properties(el).is_some_and(|p| !p.is_empty())
                        && super::painted::opacity_held_by_scroll_timeline(
                            dom,
                            el,
                            style_text.get_or_init(|| page_style_text(dom)),
                        )
                    {
                        // A scroll or view timeline holds the box at 0 while
                        // the page sits at the top, where this is measured,
                        // and shows it to a visitor who scrolls: its text is
                        // content they read.
                        HiddenState::Visible
                    } else if !by_visibility && super::painted::opacity_animation_shows(dom, el) {
                        // A timed animation running on the box fades it in,
                        // or loops it through a visible phase: the capture
                        // caught a frame at 0, and a visitor reads the text.
                        HiddenState::Visible
                    } else if unstarted_slider(dom, el, sliders) {
                        HiddenState::Unstarted
                    } else {
                        HiddenState::Invisible
                    }
                } else {
                    HiddenState::Visible
                }
            }
        };
        cache.insert(el, state);
        state
    }

    let mut total_chars = 0.0f64;
    let mut hidden_chars = 0.0f64;
    let mut unstarted_slider_chars = 0.0f64;
    let mut unstarted_slider_samples: Vec<String> = Vec::new();
    // Each hidden text element and the box its invisible subtree starts at,
    // in document order, and the characters each such box holds.
    let mut hidden_els: Vec<(ElId, ElId, f64)> = Vec::new();
    let mut hidden_roots: Vec<(ElId, f64)> = Vec::new();
    for el in dom.query_all(None, "body *").unwrap_or_default() {
        let mut len = 0usize;
        for t in dom.direct_text_nodes(el) {
            len += utf16_len(js::trim(&collapse_ws(&t)));
        }
        if len == 0 {
            continue;
        }
        let state = state_of(dom, root, &mut cache, &closed_ids, &style_text, &mut sliders, Some(el));
        match state {
            HiddenState::Excluded => continue,
            HiddenState::Unstarted => {
                unstarted_slider_chars += len as f64;
                if unstarted_slider_samples.len() < 3 {
                    let text = slice_utf16_prefix(js::trim(&collapse_ws(&dom.text_content(el))), 40);
                    if !text.is_empty() {
                        unstarted_slider_samples.push(text);
                    }
                }
                continue;
            }
            _ => {}
        }
        total_chars += len as f64;
        if state == HiddenState::Invisible {
            hidden_chars += len as f64;
            // The topmost invisible box above it, which every state above
            // was cached on the way to this one.
            let mut start = el;
            while let Some(p) = dom.parent(start) {
                if cache.get(&p) != Some(&HiddenState::Invisible) {
                    break;
                }
                start = p;
            }
            hidden_els.push((el, start, len as f64));
            match hidden_roots.iter_mut().find(|(r, _)| *r == start) {
                Some((_, chars)) => *chars += len as f64,
                None => hidden_roots.push((start, len as f64)),
            }
        }
    }

    // Scroll-linked reveals, asked only of a page the share would report.
    // A shown box takes along the text that was hidden only through it. Text
    // under a box of its own held at opacity 0 inside it (a staggered child,
    // or one a reveal never reached) is asked about on its own, in a second
    // probe round, and stays hidden until the probe says it shows.
    let mut shown_els: Vec<ElId> = Vec::new();
    if crate::checks::measures::content_hidden_reports(total_chars, hidden_chars) {
        let mut by_size = hidden_roots.clone();
        by_size.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        let mut shown_roots: Vec<ElId> = Vec::new();
        for (start, _) in by_size.into_iter().take(SCROLL_PROBE_MAX) {
            if dom.shown_when_scrolled_to(start) == Some(true) {
                shown_roots.push(start);
            }
        }
        let mut inner_asked: Vec<ElId> = Vec::new();
        for &(el, start, len) in &hidden_els {
            if !shown_roots.contains(&start) {
                continue;
            }
            let inner = held_inside(dom, el, start);
            let shown = match inner {
                None => true,
                Some(b) => {
                    if !inner_asked.contains(&b) {
                        if inner_asked.len() >= SCROLL_PROBE_MAX {
                            continue;
                        }
                        inner_asked.push(b);
                    }
                    dom.shown_when_scrolled_to(b) == Some(true)
                }
            };
            if shown {
                hidden_chars -= len;
                shown_els.push(el);
            }
        }
    }

    let mut hidden_samples: Vec<String> = Vec::new();
    for (el, _, _) in hidden_els {
        if hidden_samples.len() >= 3 {
            break;
        }
        if shown_els.contains(&el) {
            continue;
        }
        let text = slice_utf16_prefix(js::trim(&collapse_ws(&dom.text_content(el))), 40);
        if !text.is_empty() {
            hidden_samples.push(text);
        }
    }
    HiddenTextMeasure {
        total_chars,
        hidden_chars,
        hidden_samples,
        unstarted_slider_chars,
        unstarted_slider_samples,
    }
}

/// JS `isScroller(s)` from checkEdgeFlushCardsDOM, read from `overflow-x`:
/// `main.overflow-x-hidden` computes the shorthand to `hidden auto` and
/// scrolls only vertically.
fn is_scroller(dom: &dyn Dom, el: ElId) -> bool {
    SCROLL_RE.is_match(&super::text_geometry::overflow_x(dom, el))
}

/// A part of a table: a cell, a row, a row group or a caption, by its tag or
/// by its computed `display`.
fn is_table_part(dom: &dyn Dom, el: ElId) -> bool {
    matches!(
        tag_lower(dom, el).as_str(),
        "td" | "th" | "tr" | "thead" | "tbody" | "tfoot" | "caption" | "colgroup" | "col"
    ) || matches!(
        dom.style(el, "display").as_str(),
        "table-cell"
            | "table-row"
            | "table-row-group"
            | "table-header-group"
            | "table-footer-group"
            | "table-caption"
            | "table-column"
            | "table-column-group"
    )
}

/// JS: checks.mjs#checkEdgeFlushCardsDOM()
pub fn check_edge_flush_cards_dom(dom: &dyn Dom) -> Vec<ElFinding> {
    let mut findings = Vec::new();
    let vh = {
        let h = dom.inner_height();
        if num_truthy(h) {
            h
        } else {
            800.0
        }
    };
    let scroll_y = {
        let y = dom.scroll_y();
        if num_truthy(y) {
            y
        } else {
            0.0
        }
    };

    for scroller in dom.query_all(None, "*").unwrap_or_default() {
        // The root and body scroll the page itself, not a row of cards.
        if Some(scroller) == dom.document_element() || Some(scroller) == dom.body() {
            continue;
        }
        if !is_scroller(dom, scroller) {
            continue;
        }
        if dom.scroll_width(scroller) <= dom.client_width(scroller) + 8.0 {
            continue;
        }
        if dom.scroll_left(scroller) > 4.0 {
            continue;
        }
        let sc_rect = dom.rect(scroller);
        if sc_rect.width < 120.0 || sc_rect.height < 60.0 {
            continue;
        }
        if sc_rect.top + scroll_y > 2.0 * vh {
            continue;
        }
        let content_left = sc_rect.left + dom.client_left(scroller);
        let content_right = content_left + dom.client_width(scroller);

        struct Flush {
            card: ElId,
            edge: &'static str,
            gap: f64,
        }
        let mut flush: Vec<Flush> = Vec::new();
        // The card-shaped boxes this scroller holds, as the right edge of the
        // one that ends first and the left edge of the one that starts last:
        // a row has two that sit side by side.
        let mut first_right = f64::INFINITY;
        let mut last_left = f64::NEG_INFINITY;
        for card in dom.query_all(Some(scroller), "*").unwrap_or_default() {
            if !is_rendered_for_browser_rule(dom, card) {
                continue;
            }
            let mut owner = dom.parent(card);
            while let Some(o) = owner {
                if o == scroller || is_scroller(dom, o) {
                    break;
                }
                owner = dom.parent(o);
            }
            if owner != Some(scroller) {
                continue;
            }
            let rect = dom.rect(card);
            if rect.width < 80.0 || rect.height < 40.0 {
                continue;
            }
            // A cell, a row or a row group of a table is a part of that
            // table, not a card: a data table that scrolls sideways starts
            // its first column at its edge.
            if is_table_part(dom, card) {
                continue;
            }
            let bg = parse_any_color(Some(&dom.style(card, "backgroundColor")));
            let has_bg = bg.map_or(false, |c| c.alpha_or_one() > 0.5);
            let border_sides = ["Top", "Right", "Bottom", "Left"]
                .iter()
                .filter(|s| style_px(dom, card, &format!("border{s}Width")) > 0.0)
                .count();
            if !has_bg && border_sides < 2 {
                continue;
            }
            first_right = math_min(first_right, rect.right);
            last_left = math_max(last_left, rect.left);
            let left_gutter = rect.left - content_left;
            let right_gap = content_right - rect.right;
            let flush_right = left_gutter >= 6.0 && right_gap < 8.0 && right_gap > -24.0;
            let flush_left = right_gap >= 6.0 && left_gutter < 8.0 && left_gutter > -24.0;
            if !flush_right && !flush_left {
                continue;
            }
            flush.push(Flush {
                card,
                edge: if flush_right { "right" } else { "left" },
                gap: math_round(if flush_right { right_gap } else { left_gutter }),
            });
        }
        if flush.is_empty() {
            continue;
        }
        // One card, or cards stacked in a column, is not a row that scrolls
        // past an edge: a textarea or a header button in a page wrapper.
        if first_right > last_left + 1.0 {
            continue;
        }
        let mut worst = &flush[0];
        for f in &flush[1..] {
            if f.gap < worst.gap {
                worst = f;
            }
        }
        findings.push(ElFinding {
            el: Some(scroller),
            finding: BrowserFinding::new(
                "edge-flush-cards",
                format!(
                    "{} card{} flush against the {} edge of {} at rest ({}px gap, e.g. {})",
                    flush.len(),
                    if flush.len() == 1 { "" } else { "s" },
                    worst.edge,
                    class_selector(dom, scroller),
                    number_to_string(worst.gap),
                    class_selector(dom, worst.card)
                ),
            ),
        });
    }
    findings
}

/// JS: checks.mjs#isLayeredElement(el)
pub fn is_layered_element(dom: &dyn Dom, el: ElId) -> bool {
    let body = dom.body();
    let mut cur = Some(el);
    while let Some(c) = cur {
        if Some(c) == body {
            break;
        }
        let pos = dom.style(c, "position");
        let pos = if pos.is_empty() { "static".to_string() } else { pos };
        if pos == "absolute" || pos == "fixed" || pos == "sticky" {
            return true;
        }
        cur = dom.parent(c);
    }
    false
}

/// `pointer-events: none`, computed (so inherited).
fn ignores_pointer_events(dom: &dyn Dom, el: ElId) -> bool {
    dom.style(el, "pointerEvents") == "none"
}

/// JS: checks.mjs#elementDirectText(el)
pub fn element_direct_text(dom: &dyn Dom, el: ElId) -> String {
    js::trim(&direct_text(dom, el)).to_string()
}

/// JS: checks.mjs#isPaintedForOcclusion(el)
pub fn is_painted_for_occlusion(dom: &dyn Dom, el: ElId) -> bool {
    // Closed <details> content is hidden through ::details-content, which no
    // element's computed style reports, so the browser's own verdict comes first.
    if dom.check_visibility(el) == Some(false) {
        return false;
    }
    let mut cur = Some(el);
    while let Some(c) = cur {
        let visibility = js::to_lower_case(&dom.style(c, "visibility"));
        if dom.style(c, "display") == "none" || visibility == "hidden" || visibility == "collapse" {
            return false;
        }
        if pf0(&dom.style(c, "opacity")) <= 0.05 {
            return false;
        }
        if js::to_lower_case(&dom.style(c, "contentVisibility")) == "hidden" {
            return false;
        }
        cur = dom.parent(c);
    }
    true
}

const OCCLUSION_TEXT_SKIP_TAGS: &[&str] = &["script", "style", "noscript", "template", "title"];

/// The SVG elements that print text. Every other element inside an `<svg>`
/// draws: a `path`, a `rect`, the `svg` itself.
const SVG_TEXT_TAGS: &[&str] = &["text", "tspan", "textpath"];

/// The blur radius at which text stops being words a reader could read: a
/// teaser under a sign-in gate at `blur(12px)`. Nothing covering it hides a
/// reading.
const OCCLUSION_ILLEGIBLE_BLUR_PX: f64 = 4.0;

/// Whether a decorated box counts through its own fill, the first of the two
/// ways `is_opaque_decorated_box` accepts it.
fn paints_opaque_fill(dom: &dyn Dom, el: ElId) -> bool {
    parse_any_color(Some(&dom.style(el, "backgroundColor"))).is_some_and(|c| c.alpha_or_one() > 0.6)
}

/// Whether `text` shows fewer than `n` characters on screen. Combining marks,
/// variation selectors, emoji skin tones and tag characters count with the
/// character before them, so does whatever a zero-width joiner joins, and two
/// regional indicators are one flag. Everything else counts on its own, so the
/// count never falls below what a reader sees, and text with `n` characters
/// is never dropped.
fn fewer_characters_than(text: &str, n: usize) -> bool {
    let mut count = 0usize;
    let mut joined = false;
    let mut open_flag = false;
    for c in text.chars() {
        let cp = c as u32;
        if cp == 0x200D {
            joined = true;
            continue;
        }
        let extends = matches!(
            cp,
            0x0300..=0x036F
                | 0x1AB0..=0x1AFF
                | 0x1DC0..=0x1DFF
                | 0x20D0..=0x20FF
                | 0xFE00..=0xFE0F
                | 0xFE20..=0xFE2F
                | 0x1F3FB..=0x1F3FF
                | 0xE0020..=0xE007F
                | 0xE0100..=0xE01EF
        );
        if extends {
            continue;
        }
        if joined {
            joined = false;
            continue;
        }
        if (0x1F1E6..=0x1F1FF).contains(&cp) {
            if open_flag {
                open_flag = false;
                continue;
            }
            open_flag = true;
        } else {
            open_flag = false;
        }
        count += 1;
        if count >= n {
            return false;
        }
    }
    count < n
}

/// The viewport the occlusion probes are asked inside, with the defaults a
/// Dom that did not measure it reads as.
pub fn occlusion_viewport(dom: &dyn Dom) -> (f64, f64) {
    let w = dom.inner_width();
    let h = dom.inner_height();
    (
        if num_truthy(w) { w } else { 1280.0 },
        if num_truthy(h) { h } else { 800.0 },
    )
}

/// JS `paintedRect(el, rect)`: the part of an element that is actually
/// painted, after every scrolling or clipping ancestor has had its say.
/// getBoundingClientRect reports where a box would be if nothing cut it off;
/// the elementFromPoint probe must only sample coordinates the text is painted
/// at (sticky footers under scroll regions otherwise read as burying the
/// clipped-away half). Border box on purpose: it errs toward probing. `None`
/// when a clip cuts the box down to less than a pixel.
pub fn occlusion_probe_rect(dom: &dyn Dom, el: ElId, rect: &Rect) -> Option<Rect> {
    let mut left = rect.left;
    let mut top = rect.top;
    let mut right = rect.right;
    let mut bottom = rect.bottom;
    let doc_el = dom.document_element();
    let mut cur = dom.parent(el);
    while let Some(c) = cur {
        if Some(c) == doc_el {
            break;
        }
        let ov = |k: &str| {
            let v = dom.style(c, k);
            if v.is_empty() {
                "visible".to_string()
            } else {
                v
            }
        };
        let clips_x = ov("overflowX") != "visible";
        let clips_y = ov("overflowY") != "visible";
        if !clips_x && !clips_y {
            cur = dom.parent(c);
            continue;
        }
        let b = dom.rect(c);
        if clips_x {
            left = js::math_max(left, b.left);
            right = js::math_min(right, b.right);
        }
        if clips_y {
            top = js::math_max(top, b.top);
            bottom = js::math_min(bottom, b.bottom);
        }
        if right - left < 1.0 || bottom - top < 1.0 {
            return None;
        }
        cur = dom.parent(c);
    }
    Some(Rect {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
        top,
        right,
        bottom,
        left,
    })
}

/// The occlusion grid's columns and rows over a painted text rect.
fn occlusion_grid(rect: &Rect) -> (f64, f64) {
    let cols = math_max(6.0, math_min(30.0, math_round(rect.width / 12.0)));
    let rows = math_max(1.0, math_min(4.0, math_round(rect.height / 14.0)));
    (cols, rows)
}

/// How many points the occlusion grid holds over a rect, inside the viewport
/// or not.
pub fn occlusion_grid_size(rect: &Rect) -> usize {
    let (cols, rows) = occlusion_grid(rect);
    (cols * rows) as usize
}

/// The points the occlusion grid asks about a painted text rect, column by
/// column, skipping those outside the viewport: up to 30 columns by 4 rows.
/// Other checks that need a hit-test stack over a run of text ask these same
/// points, so a page answers each of them once and a recording made for this
/// check answers them too.
pub fn occlusion_probe_points(rect: &Rect, vw: f64, vh: f64) -> Vec<(f64, f64)> {
    let (cols, rows) = occlusion_grid(rect);
    let mut points = Vec::new();
    let mut i = 0.0;
    while i < cols {
        let x = rect.left + rect.width * ((i + 0.5) / cols);
        i += 1.0;
        if x < 1.0 || x > vw - 1.0 {
            continue;
        }
        let mut j = 0.0;
        while j < rows {
            let y = rect.top + rect.height * ((j + 0.5) / rows);
            j += 1.0;
            if y < 1.0 || y > vh - 1.0 {
                continue;
            }
            points.push((x, y));
        }
    }
    points
}

/// Whether a captured rect holds a point, give or take a pixel. A hit-test
/// answer comes from the live page after the capture; where the element it
/// names is not where the capture put it, the page moved in between (a
/// carousel advancing, a marquee scrolling) and the answer describes a
/// different layout.
pub fn rect_holds_point(rect: &Rect, x: f64, y: f64) -> bool {
    const SLACK: f64 = 1.0;
    rect.width > 0.0
        && rect.height > 0.0
        && x >= rect.left - SLACK
        && x <= rect.right + SLACK
        && y >= rect.top - SLACK
        && y <= rect.bottom + SLACK
}

/// Whether text answering a probe point may draw over the victim there. Its
/// glyphs hold the point, or they meet the victim's glyphs somewhere: the
/// grid is coarse (one row through a single line's middle), so a word lying
/// under a heading's descenders, or a block label far wider than its words,
/// is met at points off the other word's glyphs, and the grid cannot say
/// where the two collide. Only glyphs clear of the victim's (a stretched
/// link's title below the topic its overlay answers over) cover nothing. A
/// text rect the capture did not record, on either side, keeps the answer.
fn glyphs_may_cover(answer: Option<Rect>, victim: Option<&Rect>, x: f64, y: f64) -> bool {
    let Some(answer) = answer.filter(|r| r.all_finite()) else {
        return true;
    };
    let Some(victim) = victim else {
        return true;
    };
    rect_holds_point(&answer, x, y)
        || (answer.left < victim.right
            && victim.left < answer.right
            && answer.top < victim.bottom
            && victim.top < answer.bottom)
}

/// Where the ascender line of Latin text sits below the top of its content
/// area, as a share of that area's height, at the least: the ascent of a text
/// face is 75 to 88% of ascent plus descent.
const INK_ASCENT_SHARE_MIN: f64 = 0.75;
/// The same share at the most, for placing the baseline when the bottom of
/// the ink is read.
const INK_ASCENT_SHARE_MAX: f64 = 0.82;
/// How far above the baseline unaccented Latin letters and digits reach, in
/// ems, at the most.
const INK_ASCENDER_EM: f64 = 0.8;
/// How far below the baseline their descenders reach, in ems, at the most.
const INK_DESCENDER_EM: f64 = 0.25;

/// Whether every character draws inside the ascender-to-descender band of a
/// Latin face: ASCII, common currency signs and spaces. An accented capital,
/// an emoji or a CJK glyph reaches further, and its content area stands.
fn draws_inside_latin_band(text: &str) -> bool {
    text.chars()
        .all(|c| c.is_ascii() || c.is_whitespace() || matches!(c, '€' | '£' | '¥' | '¢'))
}

/// The band of a text rect that its glyphs ink, top to bottom. A Range rect
/// spans the font's content area (ascent plus descent, about 1.2 to 1.5em a
/// line) whatever the line box holds, so a 40px price on a 40px line carries
/// a 57px rect that starts 9px above its own box, and reads as lying over the
/// 12px label above it while its digits sit well clear (freenet.de 218507).
/// The band drops the room above the ascenders of the first line and below
/// the descenders of the last. Both insets are underestimates: the ascent is
/// taken at its smallest plausible share for the top and its largest for the
/// bottom, so the band never ends inside real ink.
///
/// `None` keeps the content area: the text holds characters that reach past
/// the Latin band, the font size is unknown, or the rect is taller than one
/// line and the capture recorded no line rects.
fn glyph_ink_band(dom: &dyn Dom, el: ElId, rect: &Rect) -> Option<Rect> {
    if !draws_inside_latin_band(&direct_text(dom, el)) {
        return None;
    }
    let font_size = parse_float(&dom.style(el, "fontSize"));
    if !(font_size.is_finite() && font_size > 0.0) {
        return None;
    }
    let lines = dom
        .text_line_rects(el)
        .filter(|l| !l.is_empty() && l.iter().all(|r| r.all_finite()));
    let (first_height, last_height) = match &lines {
        Some(l) => {
            let first = l.iter().fold(None::<&Rect>, |a, r| match a {
                Some(a) if a.top <= r.top => Some(a),
                _ => Some(r),
            })?;
            let last = l.iter().fold(None::<&Rect>, |a, r| match a {
                Some(a) if a.bottom >= r.bottom => Some(a),
                _ => Some(r),
            })?;
            (first.height, last.height)
        }
        None if rect.height < font_size * 2.0 => (rect.height, rect.height),
        None => return None,
    };
    let top_inset = math_max(0.0, first_height * INK_ASCENT_SHARE_MIN - font_size * INK_ASCENDER_EM);
    let bottom_inset = math_max(
        0.0,
        last_height * (1.0 - INK_ASCENT_SHARE_MAX) - font_size * INK_DESCENDER_EM,
    );
    let height = rect.height - top_inset - bottom_inset;
    if height.is_nan() || height <= 0.0 {
        return None;
    }
    Some(Rect::from_xywh(rect.left, rect.top + top_inset, rect.width, height))
}

/// Whether `top`, a hit-test answer over `victim`, is a scroller's paging
/// control: a button or link (itself or within two levels above it) lifted
/// out of the flow (`position: absolute | fixed`) that spans the height of a
/// sideways scroller holding the victim, which it does not sit in, at one of
/// that scroller's ends. lance.com.br lays its "next" arrow over the right
/// end of a strip of match cards, and the card peeking under it is the
/// scroller's next item, not text the page hides.
fn is_scroller_arrow(dom: &dyn Dom, top: ElId, victim: ElId) -> bool {
    let mut control = None;
    let mut cur = Some(top);
    for _ in 0..3 {
        let Some(c) = cur else { break };
        let tag = tag_lower(dom, c);
        if tag == "button"
            || tag == "a"
            || dom.attr(c, "role").is_some_and(|r| js::to_lower_case(js::trim(&r)) == "button")
        {
            control = Some(c);
            break;
        }
        cur = dom.parent(c);
    }
    let Some(control) = control else { return false };
    let pos = dom.style(control, "position");
    if pos != "absolute" && pos != "fixed" {
        return false;
    }
    let scrolls_x = |n: ElId| {
        let x = dom.style(n, "overflowX");
        let x = if x.is_empty() {
            dom.style(n, "overflow").split_whitespace().next().unwrap_or("").to_string()
        } else {
            x
        };
        x == "auto" || x == "scroll"
    };
    let mut cur = dom.parent(victim);
    while let Some(sc) = cur {
        if dom.contains(sc, control) {
            return false;
        }
        if scrolls_x(sc) {
            let sr = dom.rect(sc);
            let cr = dom.rect(control);
            // A strip that has something to page to, and a control the size
            // of an arrow at its end, not a panel over it.
            let overflows = dom.scroll_width(sc) > dom.client_width(sc) + 1.0;
            if !(sr.height > 0.0 && cr.width > 0.0) || !overflows || cr.width > 0.25 * sr.width {
                return false;
            }
            let spans = cr.top <= sr.top + 0.1 * sr.height && cr.bottom >= sr.bottom - 0.1 * sr.height;
            let at_end = (cr.right - sr.right).abs() <= 2.0
                || (cr.left - sr.left).abs() <= 2.0
                || (cr.right >= sr.right - 2.0 && cr.left < sr.right)
                || (cr.left <= sr.left + 2.0 && cr.right > sr.left);
            return spans && at_end;
        }
        cur = dom.parent(sc);
    }
    false
}

/// Whether `el` or a box above it is drawn rotated or skewed: a computed
/// `transform` whose matrix turns the axes (`matrix(a, b, c, d, ..)` with `b`
/// or `c` off zero), or a 3D matrix, which this does not read.
fn drawn_tilted(dom: &dyn Dom, el: ElId) -> bool {
    let mut cur = Some(el);
    while let Some(c) = cur {
        let t = dom.style(c, "transform");
        let t = js::trim(&t);
        if t.starts_with("matrix3d(") {
            return true;
        }
        if let Some(args) = t.strip_prefix("matrix(").and_then(|r| r.strip_suffix(')')) {
            let v: Vec<f64> = args.split(',').map(|a| parse_float(js::trim(a))).collect();
            if v.len() == 6 && (v[1].abs() > 1e-3 || v[2].abs() > 1e-3) {
                return true;
            }
        }
        if dom.style(c, "rotate").split_whitespace().any(|t| t != "none" && t != "0deg") {
            return true;
        }
        cur = dom.parent(c);
    }
    false
}

/// The opaque layer an occluding answer belongs to: the nearest box above
/// `occ` (and not holding the victim) that paints an opaque fill over at
/// least half of the victim's box. suitemigration.com's hero stacks product
/// cards, and what a probe answers with is the front card's own text or a
/// bordered row in it; the card is what covers the text, so the finding
/// names it. `None` when `occ` is such a box itself or none is found.
fn covering_layer(dom: &dyn Dom, occ: ElId, victim: ElId, victim_rect: &Rect) -> Option<ElId> {
    let area = victim_rect.width * victim_rect.height;
    if !(area > 0.0) || paints_opaque_fill(dom, occ) {
        return None;
    }
    let mut cur = dom.parent(occ);
    while let Some(c) = cur {
        if dom.contains(c, victim) || Some(c) == dom.body() {
            return None;
        }
        if paints_opaque_fill(dom, c) {
            let r = dom.rect(c);
            let ix = math_max(0.0, math_min(r.right, victim_rect.right) - math_max(r.left, victim_rect.left));
            let iy = math_max(0.0, math_min(r.bottom, victim_rect.bottom) - math_max(r.top, victim_rect.top));
            if ix * iy >= 0.5 * area {
                return Some(c);
            }
        }
        cur = dom.parent(c);
    }
    None
}

/// Whether the hit-test stack at a point shows `victim` buried, with the
/// element that answered (`stack[0]`) lying on what buries it rather than on
/// the victim. Between the answer and the victim in paint order sits either
/// a picture (`img`, `picture`, `video`, `canvas`: the rule never counts a
/// picture as covering text), or an ancestor of the victim that paints an
/// opaque fill over it, which only a negative `z-index` arranges.
/// bankofamerica.com parks its collapsed sign-in form at `z-index: -1` under
/// the hero photo and the white masthead that holds it; the headline set on
/// the photo collides with none of the form's labels.
///
/// `false` whenever the stack does not place the victim under the answer: no
/// stack was recorded, or the victim is not in it.
fn buried_under_answer(dom: &dyn Dom, stack: &[ElId], victim: ElId) -> bool {
    let Some(at) = stack.iter().position(|&e| e == victim) else {
        return false;
    };
    stack[..at].iter().skip(1).any(|&layer| {
        matches!(tag_lower(dom, layer).as_str(), "img" | "video" | "canvas" | "picture")
            || (dom.contains(layer, victim) && paints_opaque_fill(dom, layer))
    })
}

/// How many ancestors of a hit-test answer text-occlusion asks whether they
/// are a moving ticker track.
const MARQUEE_TRACK_MAX_DEPTH: usize = 4;

/// The computed properties that decide which glyphs a run draws and where:
/// two runs are an overprint only where every one is recorded and equal.
const OVERPRINT_GLYPH_PROPS: &[&str] = &[
    "fontFamily",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "fontStretch",
    "fontVariantCaps",
    "fontFeatureSettings",
    "letterSpacing",
    "wordSpacing",
    "textTransform",
];

/// Whether `top` sets the words `victim` starts with again, drawing the same
/// glyphs from the same origin (within a pixel), so its glyphs land on the
/// victim's own. Both have to carry text of their own and a measured text
/// rect, and every property in [`OVERPRINT_GLYPH_PROPS`] has to be recorded
/// on both and equal: `text-transform: uppercase` over the same DOM text
/// draws other glyphs, and a value the capture did not record is unknown,
/// which keeps the collision.
fn overprints(dom: &dyn Dom, top: ElId, victim: ElId) -> bool {
    let same_origin = match (dom.direct_text_rect(top), dom.direct_text_rect(victim)) {
        (Some(a), Some(b)) if a.all_finite() && b.all_finite() => {
            (a.left - b.left).abs() <= 1.0 && (a.top - b.top).abs() <= 1.0
        }
        _ => false,
    };
    if !same_origin
        || !OVERPRINT_GLYPH_PROPS.iter().all(|p| {
            let v = dom.style(top, p);
            !v.is_empty() && v == dom.style(victim, p)
        })
    {
        return false;
    }
    let top_text = collapse_ws(js::trim(&element_direct_text(dom, top)));
    let victim_text = collapse_ws(js::trim(&element_direct_text(dom, victim)));
    !top_text.is_empty() && victim_text.starts_with(top_text.as_str())
}

/// JS: checks.mjs#checkTextOcclusionDOM()
pub fn check_text_occlusion_dom(dom: &dyn Dom) -> Vec<ElFinding> {
    let mut findings = Vec::new();
    let mut seen_victims: Vec<ElId> = Vec::new();
    // The inline boxes reported for a fill that leaks: there the element is
    // what covers, not what is covered.
    let mut leak_hosts: Vec<ElId> = Vec::new();
    let (vw, vh) = occlusion_viewport(dom);
    let body = dom.body();

    let is_floated = |el: ElId| -> bool {
        let f = {
            let a = dom.style(el, "cssFloat");
            if !a.is_empty() {
                a
            } else {
                let b = dom.style(el, "float");
                if !b.is_empty() {
                    b
                } else {
                    "none".to_string()
                }
            }
        };
        let f = js::to_lower_case(&f);
        f == "left" || f == "right"
    };
    let names_marquee = |el: ElId| -> bool {
        if dom.tag_name(el) == "MARQUEE" {
            return true;
        }
        let ident = format!(
            "{} {}",
            dom.attr(el, "class").unwrap_or_default(),
            dom.attr(el, "id").unwrap_or_default()
        );
        if MARQUEE_IDENT_RE.is_match(&ident) {
            return true;
        }
        let anim = js::to_lower_case(&dom.style(el, "animationName"));
        MARQUEE_ANIM_RE.is_match(&anim)
    };
    // A ticker moves between the capture and the probes, so what a point
    // answers inside it is a neighbour that slid under the point. The track
    // that moves is often an ancestor of the span the probe returns
    // (react-fast-marquee animates `.rfm-marquee`, two levels up), so a few
    // ancestors are asked too. An ancestor counts only while it moves: an
    // animation named for a ticker, or a marquee name on a box running an
    // animation. A page wrapper named `.page-scroller`, or iScroll's
    // `#scroller`, names a scroller without ticking, and the text under it
    // collides like any other.
    let is_marqueeish = |el: ElId| -> bool {
        if names_marquee(el) {
            return true;
        }
        let mut cur = dom.parent(el);
        for _ in 0..MARQUEE_TRACK_MAX_DEPTH {
            let Some(c) = cur else { break };
            if Some(c) == body {
                break;
            }
            let anim = js::to_lower_case(&dom.style(c, "animationName"));
            let animated = !anim.is_empty() && anim.split(',').any(|n| js::trim(n) != "none");
            if animated && (MARQUEE_ANIM_RE.is_match(&anim) || names_marquee(c)) {
                return true;
            }
            cur = dom.parent(c);
        }
        false
    };
    let is_pinned_overlay = |el: ElId| -> bool {
        let mut cur = Some(el);
        while let Some(c) = cur {
            if Some(c) == body {
                break;
            }
            let pos = dom.style(c, "position");
            let pos = if pos.is_empty() { "static".to_string() } else { pos };
            if pos == "fixed" || pos == "sticky" {
                return true;
            }
            cur = dom.parent(c);
        }
        false
    };

    // The covered text, the text or box covering it, and the cards a headline
    // overhangs all ask the shared painted-at-capture predicate, once per
    // element. It only removes: every element it keeps also passed
    // `is_painted_for_occlusion`.
    let painted_cache: std::cell::RefCell<std::collections::HashMap<ElId, bool>> = Default::default();
    let painted = |el: ElId| -> bool {
        if let Some(&v) = painted_cache.borrow().get(&el) {
            return v;
        }
        let v = painted_at_capture(dom, el);
        painted_cache.borrow_mut().insert(el, v);
        v
    };

    struct TextEl {
        el: ElId,
        rect: Rect,
        text: String,
    }
    let mut text_els: Vec<TextEl> = Vec::new();
    for el in dom.query_all(None, "body *").unwrap_or_default() {
        let tag = tag_lower(dom, el);
        if OCCLUSION_TEXT_SKIP_TAGS.contains(&tag.as_str()) {
            continue;
        }
        let in_svg = closest_or_none(dom, el, "svg").is_some();
        if in_svg && tag != "text" {
            continue;
        }
        let text = if in_svg {
            js::trim(&dom.text_content(el)).to_string()
        } else {
            element_direct_text(dom, el)
        };
        // One emoji is two UTF-16 units but one character on screen.
        if utf16_len(&text) < 2 || fewer_characters_than(&text, 2) {
            continue;
        }
        if !is_painted_for_occlusion(dom, el) {
            continue;
        }
        if effective_opacity_dom(dom, el) <= 0.02 {
            continue;
        }
        let full = dom.rect(el);
        if full.width < 6.0 || full.height < 6.0 {
            continue;
        }
        // Probe only where the text is on screen. A run clipped down to a
        // sliver is dropped rather than sampled.
        let Some(rect) = occlusion_probe_rect(dom, el, &full) else {
            continue;
        };
        if rect.width < 6.0 || rect.height < 6.0 {
            continue;
        }
        if rect.bottom <= 0.0 || rect.top >= vh {
            continue;
        }
        // Text a visitor cannot see (the items of a closed `<details>`, a
        // panel at `visibility: hidden`, a slide parked past its track) has
        // nothing covering it on screen. Nor has a run its clip cuts down to
        // a sliver (v0-orbit's KPI label, 6px of it left inside a squeezed
        // card): the Text gate's visible share decides, as it does for every
        // rule that reads one run of text. The occluders keep the plain
        // predicate: a box shows wherever any of it is painted.
        if !painted(el) || super::painted::unpainted_text_box(dom, el).is_some() {
            continue;
        }
        // Text blurred past reading (a teaser under a sign-in gate) is
        // texture; nothing on top of it hides words a reader could read.
        if ai_palette_blur_px(dom, el) >= OCCLUSION_ILLEGIBLE_BLUR_PX {
            continue;
        }
        text_els.push(TextEl { el, rect, text });
    }

    for victim in &text_els {
        let el = victim.el;
        let rect = &victim.rect;
        let text = &victim.text;
        if seen_victims.contains(&el) {
            continue;
        }
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
            continue;
        }

        // The probe is `elementFromPoint`, which passes through anything that
        // ignores pointer events. Over such text (a floating label laid on its
        // input) the answer is whatever lies under it, so a box it names may
        // sit below the text rather than over it, and cannot be counted. Text
        // it names overlaps the victim whichever of the two is on top.
        let passes_through = ignores_pointer_events(dom, el);
        // Each side's glyphs are read as the band they ink where that can
        // be told, the content area otherwise.
        let victim_glyphs = dom
            .direct_text_rect(el)
            .filter(|r| r.all_finite())
            .map(|r| glyph_ink_band(dom, el, &r).unwrap_or(r));
        let mut total = 0usize;
        let mut occluded = 0usize;
        let mut occluder_el: Option<ElId> = None;
        let mut occluder_kind = "";
        // Where the capture recorded the lines, a point off every line (the
        // empty end of a wrapped paragraph's last line, its box past the
        // words) has no text under it to cover, and the share is taken over
        // the points on the lines. Under a rotation or skew a line's rect is
        // the bounds of a tilted line, not the line, so the grid stands.
        let points = occlusion_probe_points(rect, vw, vh);
        let lines = if drawn_tilted(dom, el) {
            None
        } else {
            // The lines of the victim's own text: a child's line on a row of
            // its own is the child's text, which the probe already skips.
            let own = dom.direct_text_rect(el).filter(|r| r.all_finite());
            dom.text_line_rects(el)
                .map(|l| {
                    l.into_iter()
                        .filter(|r| {
                            own.as_ref().map_or(true, |o| {
                                r.top < o.bottom && r.bottom > o.top && r.left < o.right && r.right > o.left
                            })
                        })
                        .collect::<Vec<_>>()
                })
                .filter(|l| !l.is_empty() && l.iter().all(|r| r.all_finite()))
        }
        // A grid none of whose points lands on a line (one centred line in a
        // tall box, between two grid rows) says nothing either way; the
        // whole grid stands.
        .filter(|l| points.iter().any(|&(x, y)| l.iter().any(|r| rect_holds_point(r, x, y))));
        for (x, y) in points {
            if lines.as_ref().is_some_and(|l| !l.iter().any(|r| rect_holds_point(r, x, y))) {
                continue;
            }
            total += 1;
            let Some(top) = dom.element_from_point(x, y) else { continue };
            if top == el || dom.contains(el, top) || dom.contains(top, el) {
                continue;
            }
            if is_floated(top) || is_marqueeish(top) || is_pinned_overlay(top) || is_scroller_arrow(dom, top, el) {
                continue;
            }
            if effective_opacity_dom(dom, top) <= 0.02 || ignores_pointer_events(dom, top) {
                continue;
            }
            // An answer naming an element the capture says is not painted
            // describes a page that changed after the capture; it covers
            // nothing the capture measured.
            if !painted(top) {
                continue;
            }
            let top_tag = tag_lower(dom, top);
            if matches!(top_tag.as_str(), "img" | "video" | "canvas" | "picture") {
                continue;
            }
            // The answer may lie on a layer that buries the victim, not on
            // the victim.
            if buried_under_answer(dom, &dom.elements_from_point(x, y), el) {
                continue;
            }
            // A label at `font-size: 0` (a hidden link's) draws nothing, and
            // text covers the point only where its glyphs could: a stretched
            // link's transparent `::after` answers for the whole card while
            // its title sits elsewhere.
            let top_glyphs = dom
                .direct_text_rect(top)
                .map(|r| if r.all_finite() { glyph_ink_band(dom, top, &r).unwrap_or(r) } else { r });
            // The same words set again in the same face at the same origin
            // (schlittermann.de's logo, `a.logo` laid exactly over the first
            // word of `span.logo2`) draw the glyphs the victim draws: an
            // overprint, not a collision a reader sees.
            if overprints(dom, top, el) {
                continue;
            }
            let top_own_text = !element_direct_text(dom, top).is_empty()
                && !super::painted::under_1px(&dom.style(top, "fontSize"))
                && glyphs_may_cover(top_glyphs, victim_glyphs.as_ref(), x, y);
            let top_in_svg = closest_or_none(dom, top, "svg").is_some();
            let top_has_text = top_own_text || top_in_svg;
            let top_style = ElStyle { dom, el: top };
            // A box paints its fill and borders inside its own rect. Where the
            // box the page answered with is not at the point in the capture,
            // the page moved between the capture and the answer: a carousel
            // slid the next card, wearing the same classes as this caption's
            // own, under the point. The answer describes a layout the capture
            // never measured, so it counts for nothing. A box that carries text
            // of its own can still overflow its rect and is kept as text.
            let box_here = rect_holds_point(&dom.rect(top), x, y);
            if box_here && !passes_through && is_opaque_decorated_box(Some(&top_style)) {
                occluded += 1;
                if occluder_el.is_none() {
                    occluder_el = Some(top);
                    // A box counts through its fill or through its borders;
                    // one with no opaque fill is named for what it draws.
                    occluder_kind = if paints_opaque_fill(dom, top) { "box" } else { "border" };
                }
            } else if top_has_text {
                occluded += 1;
                if occluder_el.is_none() {
                    occluder_el = Some(top);
                    // Everything inside an SVG counts as drawing over the
                    // text; only its text elements are text.
                    occluder_kind = if top_in_svg && !top_own_text && !SVG_TEXT_TAGS.contains(&top_tag.as_str()) {
                        "graphic"
                    } else {
                        "text"
                    };
                }
            }
        }
        let Some(occ) = occluder_el else { continue };
        if total == 0 {
            continue;
        }
        let text_like = occluder_kind == "text" || occluder_kind == "graphic";
        let occ_frac = occluded as f64 / total as f64;
        if occ_frac < (if text_like { 0.45 } else { 0.3 }) {
            continue;
        }

        if text_like {
            let victim_svg = closest_or_none(dom, el, "svg");
            let occ_svg = closest_or_none(dom, occ, "svg");
            if victim_svg.is_some() && occ_svg.is_some() && victim_svg == occ_svg {
                continue;
            }
            if !is_layered_element(dom, el) && !is_layered_element(dom, occ) {
                continue;
            }
        }
        seen_victims.push(el);
        let layer = covering_layer(dom, occ, el, rect)
            .map(|l| format!(" on an opaque layer ({})", class_selector(dom, l)))
            .unwrap_or_default();
        findings.push(ElFinding {
            el: Some(el),
            finding: BrowserFinding::new(
                "text-occlusion",
                format!(
                    "{} \"{}\" is {}% covered by {} ({}){}",
                    class_selector(dom, el),
                    slice_utf16_prefix(text, 24),
                    number_to_string(math_round(occ_frac * 100.0)),
                    match occluder_kind {
                        "text" => "overlapping text",
                        "graphic" => "an SVG graphic",
                        "border" => "a bordered element",
                        _ => "an opaque element",
                    },
                    class_selector(dom, occ),
                    layer
                ),
            ),
        });
    }

    // (ii) Headline overhanging an opaque card.
    struct Card {
        el: ElId,
        rect: Rect,
    }
    let mut cards: Vec<Card> = Vec::new();
    for el in dom.query_all(None, "body *").unwrap_or_default() {
        if closest_or_none(dom, el, "svg").is_some() {
            continue;
        }
        // A card inside a closed disclosure or a hidden panel has no edge on
        // screen for a headline to collide with.
        if !is_painted_for_occlusion(dom, el) || !painted(el) {
            continue;
        }
        let bg = parse_any_color(Some(&dom.style(el, "backgroundColor")));
        let bg_img = dom.style(el, "backgroundImage");
        let Some(bg) = bg else { continue };
        if bg.alpha_or_one() <= 0.7 {
            continue;
        }
        if !bg_img.is_empty() && bg_img != "none" && GRADIENT_URL_RE.is_match(&bg_img) {
            continue;
        }
        let has_border = ["Top", "Right", "Bottom", "Left"]
            .iter()
            .any(|s| style_px(dom, el, &format!("border{s}Width")) > 0.0);
        let bs = dom.style(el, "boxShadow");
        let has_shadow = !bs.is_empty() && bs != "none";
        if !has_border && !has_shadow {
            continue;
        }
        if is_pinned_overlay(el) {
            continue;
        }
        let cr = dom.rect(el);
        if cr.width < 100.0 || cr.width > 0.8 * vw || cr.height < 60.0 {
            continue;
        }
        cards.push(Card { el, rect: cr });
    }
    for victim in &text_els {
        let el = victim.el;
        let rect = &victim.rect;
        let text = &victim.text;
        if seen_victims.contains(&el) {
            continue;
        }
        let font_size = {
            let n = parse_float(&dom.style(el, "fontSize"));
            if num_truthy(n) {
                n
            } else {
                16.0
            }
        };
        if font_size < 40.0 {
            continue;
        }
        let mut line_height = parse_float(&dom.style(el, "lineHeight"));
        if !line_height.is_finite() {
            line_height = font_size * 1.2;
        }
        let center_x = rect.left + rect.width / 2.0;
        for card in &cards {
            if card.el == el || dom.contains(el, card.el) || dom.contains(card.el, el) {
                continue;
            }
            let ix = math_max(0.0, math_min(rect.right, card.rect.right) - math_max(rect.left, card.rect.left));
            let iy = math_max(0.0, math_min(rect.bottom, card.rect.bottom) - math_max(rect.top, card.rect.top));
            if ix < 8.0 || iy < 0.5 * line_height {
                continue;
            }
            if center_x >= card.rect.left && center_x <= card.rect.right {
                continue;
            }
            if ix > 0.5 * rect.width {
                continue;
            }
            seen_victims.push(el);
            findings.push(ElFinding {
                el: Some(el),
                finding: BrowserFinding::new(
                    "text-occlusion",
                    format!(
                        "{} \"{}\" overhangs {} by {}px — the headline and the card collide",
                        class_selector(dom, el),
                        slice_utf16_prefix(text, 24),
                        class_selector(dom, card.el),
                        number_to_string(math_round(ix))
                    ),
                ),
            });
            break;
        }
    }

    // (iii) Inline padding leak.
    for el in dom.query_all(None, "body *").unwrap_or_default() {
        if closest_or_none(dom, el, "svg").is_some() {
            continue;
        }
        if !is_painted_for_occlusion(dom, el) {
            continue;
        }
        if dom.style(el, "display") != "inline" {
            continue;
        }
        if !painted(el) {
            continue;
        }
        let Some(bg) = parse_any_color(Some(&dom.style(el, "backgroundColor"))) else { continue };
        if bg.alpha_or_one() <= 0.6 {
            continue;
        }
        let pad_top = style_px(dom, el, "paddingTop");
        let pad_bottom = style_px(dom, el, "paddingBottom");
        if pad_top + pad_bottom < 24.0 {
            continue;
        }
        let rect = dom.rect(el);
        if rect.width < 12.0 || rect.height < 24.0 {
            continue;
        }
        let font_size = {
            let n = parse_float(&dom.style(el, "fontSize"));
            if num_truthy(n) {
                n
            } else {
                16.0
            }
        };
        let mut line_height = parse_float(&dom.style(el, "lineHeight"));
        if !line_height.is_finite() {
            line_height = font_size * 1.4;
        }
        if rect.height < 2.2 * line_height {
            continue;
        }
        if seen_victims.contains(&el) {
            continue;
        }
        let mut overlaps: Option<ElId> = None;
        let siblings = match dom.parent(el) {
            Some(p) => dom.children(p),
            None => Vec::new(),
        };
        for other in siblings {
            if other == el || dom.contains(el, other) || dom.contains(other, el) {
                continue;
            }
            if dom.style(other, "display") == "none" {
                continue;
            }
            let o_rect = dom.rect(other);
            let ix = math_max(0.0, math_min(rect.right, o_rect.right) - math_max(rect.left, o_rect.left));
            let iy = math_max(0.0, math_min(rect.bottom, o_rect.bottom) - math_max(rect.top, o_rect.top));
            if ix > 4.0 && iy > 4.0 && !js::trim(&dom.text_content(other)).is_empty() {
                overlaps = Some(other);
                break;
            }
        }
        // The fill leaks onto something or it covers nothing: a padded
        // inline button alone in its line box (nemonix.app's "Share your
        // feedback") hangs past the line with nothing there to cover.
        let Some(onto) = overlaps else { continue };
        // How far the fill runs past the line boxes its text sits in: the
        // box's height less one line height per line it spans.
        // Runs far apart on one row (labels set apart by wide margins) come
        // back as separate rects and are still one line: a rect starts a new
        // line only where it begins below the middle of the one before.
        let line_count = dom
            .text_line_rects(el)
            .map(|mut l| {
                l.retain(|r| r.all_finite());
                l.sort_by(|a, b| a.top.partial_cmp(&b.top).unwrap_or(std::cmp::Ordering::Equal));
                let mut rows = 0usize;
                let mut row_middle = f64::NEG_INFINITY;
                for r in &l {
                    if r.top >= row_middle {
                        rows += 1;
                        row_middle = r.top + r.height / 2.0;
                    }
                }
                rows
            })
            .filter(|n| *n > 0)
            .unwrap_or(1) as f64;
        let overhang = rect.height - line_count * line_height;
        if !(overhang > 0.0) {
            continue;
        }
        leak_hosts.push(el);
        seen_victims.push(el);
        findings.push(ElFinding {
            el: Some(el),
            finding: BrowserFinding::new(
                "text-occlusion",
                format!(
                    "{} is an inline element whose opaque fill leaks {}px past its line onto {}",
                    class_selector(dom, el),
                    number_to_string(math_round(overhang)),
                    class_selector(dom, onto)
                ),
            ),
        });
    }

    // Text covered inside a drawn product mockup is covered on purpose:
    // suitemigration.com fans five app screens into a deck, and nobody is
    // meant to read the card behind. Advisory there (decision
    // r8-t2-occlusion-stacked-mockup). Covered page text, a control in the
    // mockup, and the box whose fill leaks onto a neighbour keep the
    // registry's severity.
    for f in &mut findings {
        if f.el.is_some_and(|el| {
            !leak_hosts.contains(&el) && super::decorative_text::covered_text_in_mockup_dom(dom, el)
        }) {
            f.finding.severity = Some(crate::checks::rules::ADVISORY_SEVERITY.to_string());
        }
    }
    findings
}

/// How far down `d` (laid out at `dr`) shows: its bottom, or the bottom of
/// the nearest box between it and the row `row` (both ends included) that
/// clips or scrolls on y, when that ends sooner. cuisineactuelle.fr's tile
/// column runs eleven tiles into a 610px box that scrolls them, inside a
/// section that hides the rest; the column a reader sees ends at 610px.
fn column_visible_bottom(dom: &dyn Dom, d: ElId, dr: &Rect, row: ElId) -> f64 {
    let mut bottom = dr.bottom;
    let mut cur = dom.parent(d);
    while let Some(p) = cur {
        let y = {
            let v = dom.style(p, "overflowY");
            if v.is_empty() {
                dom.style(p, "overflow").split_whitespace().last().unwrap_or("").to_string()
            } else {
                v
            }
        };
        if matches!(y.as_str(), "hidden" | "clip" | "auto" | "scroll") && dom.style(p, "display") != "inline" {
            bottom = math_min(bottom, dom.rect(p).bottom);
        }
        if p == row {
            break;
        }
        cur = dom.parent(p);
    }
    bottom
}

/// Whether `d` is the content of a closed `<details>` at or below `within`:
/// inside one without `open`, and not in its `<summary>`. A closed
/// disclosure shows its summary alone, whatever rects the rest still reports
/// (freddiemac.com's FAQ accordion lays its answers out at full height).
fn in_closed_details(dom: &dyn Dom, d: ElId, within: ElId) -> bool {
    let mut cur = Some(d);
    let mut in_summary = false;
    while let Some(c) = cur {
        let tag = tag_lower(dom, c);
        if tag == "summary" {
            in_summary = true;
        } else if tag == "details" {
            if c != d && dom.attr(c, "open").is_none() && !in_summary {
                return true;
            }
            in_summary = false;
        }
        if c == within {
            break;
        }
        cur = dom.parent(c);
    }
    false
}

/// The longest link text, on average, a column of links can hold and still
/// read as navigation: menu entries, not linked cards or paragraphs.
const LINK_RAIL_MEAN_CHARS: f64 = 40.0;

/// Whether a column is a list of links: three or more links holding nine
/// tenths of its text, short on average. A section menu set in a sidebar
/// without a `nav` or a role (fanniemae.com's "About Us" side menu) is short
/// by design, like the navigation rails the fold test already leaves out.
fn is_link_list_rail(dom: &dyn Dom, column: ElId) -> bool {
    let chars = |n: ElId| dom.text_content(n).split_whitespace().map(utf16_len).sum::<usize>() as f64;
    let total = chars(column);
    if !(total > 0.0) {
        return false;
    }
    let links = dom.query_all(Some(column), "a").unwrap_or_default();
    // A link inside another counts once.
    let outer: Vec<ElId> = links
        .iter()
        .copied()
        .filter(|&a| !links.iter().any(|&o| o != a && dom.contains(o, a)))
        .collect();
    // A link a reader cannot see (a closed mega-menu) is no menu entry, and
    // its text is not the column's.
    let (shown, hidden): (Vec<ElId>, Vec<ElId>) = outer.into_iter().partition(|&a| painted_at_capture(dom, a));
    if shown.len() < 3 {
        return false;
    }
    let total = total - hidden.iter().map(|&a| chars(a)).sum::<f64>();
    let link_chars: f64 = shown.iter().map(|&a| chars(a)).sum();
    total > 0.0 && link_chars >= 0.9 * total && link_chars / shown.len() as f64 <= LINK_RAIL_MEAN_CHARS
}

/// JS: checks.mjs#checkFirstViewportColumnOverflowDOM()
pub fn check_first_viewport_column_overflow_dom(dom: &dyn Dom) -> Vec<ElFinding> {
    let mut findings = Vec::new();
    let vw = {
        let w = dom.inner_width();
        if num_truthy(w) {
            w
        } else {
            1280.0
        }
    };
    let vh = {
        let h = dom.inner_height();
        if num_truthy(h) {
            h
        } else {
            800.0
        }
    };
    let scroll_y = {
        let y = dom.scroll_y();
        if num_truthy(y) {
            y
        } else {
            0.0
        }
    };

    for el in dom.query_all(None, "body *").unwrap_or_default() {
        if !MULTI_COL_RE.is_match(&dom.style(el, "display")) {
            continue;
        }
        let rect = dom.rect(el);
        if rect.width < 0.5 * vw {
            continue;
        }
        let page_top = rect.top + scroll_y;
        let page_bottom = page_top + rect.height;
        if page_top >= vh * 0.9 || page_bottom <= vh {
            continue;
        }

        struct Col {
            top: f64,
            left: f64,
            right: f64,
            content_h: f64,
        }
        let mut cols: Vec<Col> = Vec::new();
        for child in dom.children(el) {
            if dom.style(child, "display") == "none" {
                continue;
            }
            let pos = dom.style(child, "position");
            if pos == "absolute" || pos == "fixed" {
                continue;
            }
            // A navigation rail, a tab list and a sticky outline are short by
            // design; they are not the column the fold is measured against.
            if pos == "sticky"
                || tag_lower(dom, child) == "nav"
                || dom.attr(child, "role").is_some_and(|r| {
                    r.split_ascii_whitespace()
                        .any(|t| matches!(js::to_lower_case(t).as_str(), "navigation" | "tablist"))
                })
                || is_link_list_rail(dom, child)
            {
                continue;
            }
            let cr = dom.rect(child);
            let w_share = cr.width / rect.width;
            if w_share < 0.25 || w_share > 0.9 {
                continue;
            }
            if cr.height < 40.0 {
                continue;
            }
            let mut content_bottom = cr.top;
            let mut lifted: Vec<ElId> = Vec::new();
            for d in dom.query_all(Some(child), "*").unwrap_or_default() {
                let dpos = dom.style(d, "position");
                if dpos == "absolute" || dpos == "fixed" {
                    lifted.push(d);
                    continue;
                }
                // What sits inside a layer lifted out of the flow is placed
                // with that layer (a docs outline in a fixed container), not
                // in the column.
                if lifted.iter().any(|&layer| dom.contains(layer, d)) {
                    continue;
                }
                if dom.style(d, "display") == "none" || dom.style(d, "visibility") == "hidden" {
                    continue;
                }
                if in_closed_details(dom, d, child) {
                    continue;
                }
                let dr = dom.rect(d);
                if dr.width > 0.0 && dr.height > 0.0 {
                    content_bottom = math_max(content_bottom, column_visible_bottom(dom, d, &dr, el));
                }
            }
            // A column with nothing painted in its own flow (a collapsed
            // accordion panel, an outline drawn by fixed layers) holds no
            // content to measure the fold against.
            if content_bottom - cr.top < 1.0 {
                continue;
            }
            cols.push(Col {
                top: cr.top,
                left: cr.left,
                right: cr.right,
                content_h: content_bottom - cr.top,
            });
        }
        if cols.len() < 2 {
            continue;
        }
        cols.sort_by(|a, b| {
            b.content_h
                .partial_cmp(&a.content_h)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        let tall = &cols[0];
        // The tall column is measured against the shortest box that sits
        // beside it and starts with it. Two boxes that share an x range are
        // stacked: a flex or grid container laid out as one column at this
        // width (`flex-col lg:flex-row`), where a short block above a long
        // one is the ordinary flow of a page, and a short block stacked in
        // the tall column's track says nothing about the column beside it.
        let Some(shortest) = cols[1..]
            .iter()
            .filter(|c| !(tall.left < c.right - 1.0 && c.left < tall.right - 1.0))
            .filter(|c| (tall.top - c.top).abs() <= 0.25 * vh)
            .min_by(|a, b| a.content_h.partial_cmp(&b.content_h).unwrap_or(std::cmp::Ordering::Equal))
        else {
            continue;
        };
        if tall.content_h <= vh * 1.4 {
            continue;
        }
        if shortest.content_h > vh {
            continue;
        }

        findings.push(ElFinding {
            el: Some(el),
            finding: BrowserFinding::new(
                "first-viewport-column-overflow",
                format!(
                    "{} opens the page with one column running {}% of the viewport tall while a sibling fits in {}% — the fold falls deep inside the section",
                    class_selector(dom, el),
                    number_to_string(math_round(tall.content_h / vh * 100.0)),
                    number_to_string(math_round(shortest.content_h / vh * 100.0))
                ),
            ),
        });
    }
    findings
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::browser::fake_dom::FakeDom;

    /// FakeDom matches selectors by exact string; `body *` (every descendant
    /// of body) has to be declared per element.
    fn mark_body_descendants(d: &mut FakeDom) {
        let body = d.body.unwrap();
        // a real body paints
        d.set_styles(body, &[("display", "block"), ("opacity", "1"), ("visibility", "visible")]);
        let html = d.document_element.unwrap();
        d.set_styles(html, &[("display", "block"), ("opacity", "1"), ("visibility", "visible")]);
        let n = d.els.len() as ElId;
        for id in 1..n {
            if id != body && d.contains(body, id) {
                d.add_selector(id, "body *");
            }
        }
    }

    fn card_styles(d: &mut FakeDom, el: ElId, bg: &str) {
        d.set_styles(
            el,
            &[
                ("boxShadow", "rgba(0, 0, 0, 0.1) 0px 2px 4px 0px"),
                ("borderRadius", "8px"),
                ("backgroundColor", bg),
                ("position", "static"),
                ("display", "block"),
                ("visibility", "visible"),
                ("opacity", "1"),
            ],
        );
    }

    #[test]
    fn typography_overused_and_flat() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        for i in 0..20 {
            let p = d.add(Some(body), "p");
            d.add_text(p, "text");
            d.set_style(p, "fontFamily", "\"Inter\", sans-serif");
            d.set_style(p, "fontSize", if i % 2 == 0 { "16px" } else { "18px" });
        }
        let s = d.add(Some(body), "span");
        d.add_text(s, "x");
        d.set_style(s, "fontFamily", "Georgia");
        d.set_style(s, "fontSize", "24px");
        let f = check_typography(&d);
        // One `body` role is under TYPE_HIERARCHY_MIN_ROLES, so the flat-type
        // rule abstains and only the font finding stands (#702).
        assert_eq!(f.len(), 1, "{f:?}");
        assert_eq!(f[0].type_, "overused-font");
        assert_eq!(f[0].detail, "Primary font: inter (95% of text)");
    }

    fn typeset(d: &mut FakeDom, parent: ElId, tag: &str, text: &str, family: &str) -> ElId {
        let el = d.add(Some(parent), tag);
        d.add_text(el, text);
        d.set_style(el, "fontFamily", family);
        d.set_style(el, "fontSize", "16px");
        el
    }

    fn font_finding(d: &FakeDom) -> Option<String> {
        check_typography(d).into_iter().find(|f| f.type_ == "overused-font").map(|f| f.detail)
    }

    /// walla.co.il: Arial is "40% of text" by element and sets 2% of the
    /// characters. Under one in twenty the finding stands down; above it the
    /// element count names the face and the snippet is unchanged.
    #[test]
    fn a_face_that_sets_next_to_none_of_the_text_stands_down() {
        let build = |label: &str| {
            let mut d = FakeDom::new();
            let (_h, body) = d.with_page();
            for _ in 0..20 {
                typeset(&mut d, body, "span", label, "Inter, sans-serif");
            }
            for _ in 0..5 {
                typeset(&mut d, body, "p", &"w".repeat(200), "Georgia, serif");
            }
            d
        };
        // 40 of 1,040 characters: 3.8%.
        assert_eq!(font_finding(&build("Go")), None);
        // 100 of 1,100: 9.1%, and the snippet is the element share.
        assert_eq!(font_finding(&build("Label")).as_deref(), Some("Primary font: inter (80% of text)"));
    }

    /// Only text with a box is weighed: the long copy in a closed drawer does
    /// not lift the face it is set in, and copy waiting for a scroll reveal
    /// at `opacity: 0` is weighed like any other.
    #[test]
    fn the_character_share_weighs_only_text_with_a_box() {
        let build = |hide: (&str, &str)| {
            let mut d = FakeDom::new();
            let (_h, body) = d.with_page();
            for _ in 0..20 {
                typeset(&mut d, body, "span", "Go", "Inter, sans-serif");
            }
            let drawer = d.add(Some(body), "div");
            d.set_style(drawer, hide.0, hide.1);
            for _ in 0..30 {
                typeset(&mut d, drawer, "p", &"w".repeat(200), "Inter, sans-serif");
            }
            for _ in 0..5 {
                typeset(&mut d, body, "p", &"w".repeat(200), "Georgia, serif");
            }
            d
        };
        assert_eq!(font_finding(&build(("display", "none"))), None);
        assert_eq!(font_finding(&build(("visibility", "hidden"))), None);
        assert_eq!(
            font_finding(&build(("opacity", "0"))).as_deref(),
            Some("Primary font: inter (91% of text)")
        );

        // With no text that has a box there is nothing to weigh, and the
        // element count stands as before.
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let hidden = d.add(Some(body), "div");
        d.set_style(hidden, "display", "none");
        for _ in 0..25 {
            typeset(&mut d, hidden, "p", "hidden", "Inter, sans-serif");
        }
        assert_eq!(font_finding(&d).as_deref(), Some("Primary font: inter (100% of text)"));
    }

    #[test]
    fn flat_type_hierarchy_roles() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        for (tag, size) in [("p", "16px"), ("p", "16px"), ("h2", "17px"), ("h1", "18px")] {
            let el = d.add(Some(body), tag);
            d.add_text(el, "text");
            d.set_style(el, "fontSize", size);
        }
        let f = check_typography(&d);
        assert_eq!(f.len(), 1, "{f:?}");
        assert_eq!(f[0].type_, "flat-type-hierarchy");
        assert_eq!(
            f[0].detail,
            "Role sizes: body 16px, h2 17px, h1 18px (largest adjacent step 1.06:1; target 1.25:1)"
        );

        // A clear step at any adjacent pair clears the rule.
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        for (tag, size) in [("p", "16px"), ("h2", "24px"), ("h1", "40px")] {
            let el = d.add(Some(body), tag);
            d.add_text(el, "text");
            d.set_style(el, "fontSize", size);
        }
        assert!(check_typography(&d).is_empty());

        // A hidden ancestor takes its text out of the sample.
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        for (tag, size) in [("p", "16px"), ("p", "16px"), ("h2", "17px")] {
            let el = d.add(Some(body), tag);
            d.add_text(el, "text");
            d.set_style(el, "fontSize", size);
        }
        let wrap = d.add(Some(body), "div");
        d.set_style(wrap, "display", "none");
        let h1 = d.add(Some(wrap), "h1");
        d.add_text(h1, "text");
        d.set_style(h1, "fontSize", "18px");
        assert!(check_typography(&d).is_empty());

        // kingkong.tech: the h1 a reader sees nothing of is screen-reader
        // only (1px, `clip-path: inset(50%)`), and so is a 1px SEO block
        // (`clip: rect(0, 0, 0, 0)`) holding a 16px h2. Neither sets a size;
        // the hero's 40px h2 does.
        let build = |hide: bool| {
            let mut d = FakeDom::new();
            let (_h, body) = d.with_page();
            for (tag, size) in [("p", "16px"), ("p", "16px"), ("h2", "40px")] {
                let el = d.add(Some(body), tag);
                d.add_text(el, "text");
                d.set_style(el, "fontSize", size);
                d.set_rect(el, 0.0, 0.0, 600.0, 40.0);
            }
            let h1 = d.add(Some(body), "h1");
            d.add_text(h1, "KingKong Technology");
            d.set_styles(h1, &[("fontSize", "16px"), ("position", "absolute"), ("clipPath", "inset(50%)")]);
            d.set_rect(h1, -1.0, 60.0, if hide { 1.0 } else { 400.0 }, if hide { 1.0 } else { 20.0 });
            let seo = d.add(Some(body), "div");
            d.set_styles(seo, &[("position", "absolute"), ("clip", "rect(0px, 0px, 0px, 0px)")]);
            d.set_rect(seo, 0.0, 61.0, if hide { 1.0 } else { 400.0 }, if hide { 1.0 } else { 200.0 });
            for _ in 0..3 {
                let h2 = d.add(Some(seo), "h2");
                d.add_text(h2, "Encoders");
                d.set_style(h2, "fontSize", "16px");
                d.set_rect(h2, 0.0, 61.0, 1.0, 20.0);
            }
            d
        };
        assert!(check_typography(&build(true)).is_empty());
        // A 1px box that nothing clips is not the sr-only utility: its
        // headings are type like any other.
        let mut d = build(true);
        for e in 0..d.els.len() as ElId {
            if d.style(e, "position") == "absolute" {
                d.set_styles(e, &[("clip", "auto"), ("clipPath", "none")]);
            }
        }
        assert_eq!(check_typography(&d).len(), 1);
        // Boxes the clip does not remove are type like any other.
        let f = check_typography(&build(false));
        assert_eq!(f.len(), 1, "{f:?}");
        assert_eq!(f[0].type_, "flat-type-hierarchy");
    }

    /// rtx.com: closed mega-nav panels, `ul.esds-mega-nav__dropdown-level2`
    /// with `role="menu"`, at `visibility: hidden`.
    #[test]
    fn nested_cards_skip_popup_panels_and_unpainted_cards() {
        fn nested(class: Option<&str>, role: Option<&str>, visibility: &str) -> usize {
            let mut d = FakeDom::new();
            let (_h, body) = d.with_page();
            let outer = d.add(Some(body), "div");
            card_styles(&mut d, outer, "rgb(255, 255, 255)");
            d.set_rect(outer, 0.0, 0.0, 400.0, 300.0);
            let inner = d.add(Some(outer), "ul");
            card_styles(&mut d, inner, "rgb(250, 250, 250)");
            d.set_rect(inner, 10.0, 10.0, 200.0, 100.0);
            d.set_style(inner, "visibility", visibility);
            if let Some(class) = class {
                d.set_attr(inner, "class", class);
            }
            if let Some(role) = role {
                d.set_attr(inner, "role", role);
            }
            d.add_text(inner, "Some card body text");
            d.add_text(outer, "Outer text longer than ten");
            check_layout(&d).len()
        }
        assert_eq!(nested(None, None, "visible"), 1);
        // BEM element names and underscores separate words too.
        assert_eq!(nested(Some("esds-mega-nav__dropdown-level2"), None, "visible"), 0);
        assert_eq!(nested(Some("site_menu"), None, "visible"), 0);
        // What matched before still matches, and a longer word still is not
        // the word.
        assert_eq!(nested(Some("nav-dropdown"), None, "visible"), 0);
        assert_eq!(nested(Some("Popover"), None, "visible"), 0);
        assert_eq!(nested(Some("menuitem-card"), None, "visible"), 1);
        assert_eq!(nested(Some("dropdown2"), None, "visible"), 1);
        // A popup role.
        assert_eq!(nested(None, Some("menu"), "visible"), 0);
        assert_eq!(nested(None, Some("listbox"), "visible"), 0);
        assert_eq!(nested(None, Some("region"), "visible"), 1);
        // A composite control (observations-35 row 8, easyveo.com 217313: a
        // `tablist` switch of two buttons).
        assert_eq!(nested(None, Some("tablist"), "visible"), 0);
        assert_eq!(nested(None, Some("radiogroup"), "visible"), 0);
        assert_eq!(nested(None, Some("toolbar"), "visible"), 0);
        assert_eq!(nested(None, Some("tabpanel"), "visible"), 1);
        // A panel not painted at capture.
        assert_eq!(nested(None, None, "hidden"), 0);
    }

    #[test]
    fn nested_cards() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let outer = d.add(Some(body), "div");
        card_styles(&mut d, outer, "rgb(255, 255, 255)");
        d.set_rect(outer, 0.0, 0.0, 400.0, 300.0);
        let inner = d.add(Some(outer), "div");
        card_styles(&mut d, inner, "rgb(250, 250, 250)");
        d.set_rect(inner, 10.0, 10.0, 200.0, 100.0);
        d.add_text(inner, "Some card body text");
        d.add_text(outer, "Outer text longer than ten");
        let f = check_layout(&d);
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].el, Some(inner));
        assert_eq!(f[0].finding.detail, "Card inside card");
        d.set_style(inner, "position", "absolute");
        assert!(check_layout(&d).is_empty());
    }

    /// Decision r6-t3-nested-cards-mockups (advisory): the panels of a drawn
    /// product mockup report as advisory, in a framed demo (r5-p26's
    /// structure) or under an HTML `role="img"`.
    /// Bordered cards in a bordered panel outside any mockup (paseo.sh)
    /// keep the registry's severity.
    #[test]
    fn nested_cards_in_a_mockup_are_advisory() {
        let build = |frame: &dyn Fn(&mut FakeDom, ElId, ElId)| {
            let mut d = FakeDom::new();
            let (_h, body) = d.with_page();
            let wrap = d.add(Some(body), "div");
            d.set_rect(wrap, 0.0, 0.0, 400.0, 300.0);
            let outer = d.add(Some(wrap), "div");
            card_styles(&mut d, outer, "rgb(255, 255, 255)");
            d.set_rect(outer, 0.0, 0.0, 400.0, 300.0);
            let inner = d.add(Some(outer), "div");
            card_styles(&mut d, inner, "rgb(250, 250, 250)");
            d.set_rect(inner, 10.0, 10.0, 200.0, 100.0);
            d.add_text(inner, "Some card body text");
            d.add_text(outer, "Outer text longer than ten");
            frame(&mut d, wrap, outer);
            let f = check_layout(&d);
            assert_eq!(f.len(), 1, "{f:?}");
            f[0].finding.severity.clone()
        };
        let advisory = Some(crate::checks::rules::ADVISORY_SEVERITY.to_string());
        assert_eq!(build(&|_, _, _| {}), None, "outside any mockup");
        assert_eq!(build(&|d, wrap, _| { d.set_attr(wrap, "role", "img"); }), advisory);
        // A class is not read: an `illustration` names a feature tile's
        // picture as often as a mockup (r4-p17 keeps those failing).
        assert_eq!(build(&|d, wrap, _| { d.set_attr(wrap, "class", "mockup-window"); }), None);
        assert_eq!(
            build(&|d, _, outer| { d.set_style(outer, "transform", "perspective(900px) rotateX(8deg)"); }),
            advisory,
            "a device frame tilted in 3D"
        );
        // The inner card can be the frame itself.
        assert_eq!(
            build(&|d, _, outer| {
                let inner = d.children(outer)[0];
                d.set_style(inner, "transform", "perspective(900px) rotateX(8deg)");
            }),
            advisory,
            "the inner card is the tilted frame"
        );
    }

    #[test]
    fn heading_rhythm_two_violations() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let sec = d.add(Some(body), "section");
        d.set_styles(sec, &[("display", "block"), ("visibility", "visible"), ("opacity", "1"), ("position", "static"), ("backgroundColor", "rgba(0, 0, 0, 0)"), ("borderTopWidth", "0px"), ("boxShadow", "none")]);
        d.set_rect(sec, 0.0, 0.0, 800.0, 1000.0);
        let mut y = 0.0;
        for i in 0..2 {
            let p0 = d.add(Some(sec), "p");
            d.add_text(p0, "Intro paragraph text that runs well past forty characters");
            d.set_styles(p0, &[("display", "block"), ("visibility", "visible"), ("opacity", "1"), ("position", "static"), ("fontSize", "20px")]);
            d.set_rect(p0, 0.0, y, 800.0, 20.0);
            y += 20.0 + 8.0; // 8px above the heading
            let h = d.add(Some(sec), "h2");
            d.add_text(h, &format!("Heading number {i}"));
            d.set_styles(h, &[("display", "block"), ("visibility", "visible"), ("opacity", "1"), ("position", "static"), ("fontSize", "24px")]);
            d.set_rect(h, 0.0, y, 800.0, 30.0);
            y += 30.0 + 40.0; // 40px below
            let p1 = d.add(Some(sec), "p");
            d.add_text(p1, "Body paragraph");
            d.set_styles(p1, &[("display", "block"), ("visibility", "visible"), ("opacity", "1"), ("position", "static"), ("fontSize", "16px")]);
            d.set_rect(p1, 0.0, y, 800.0, 20.0);
            y += 60.0;
        }
        let f = check_heading_rhythm_dom(&d);
        assert_eq!(f.len(), 2, "{f:?}");
        assert_eq!(
            f[0].finding.detail,
            "h2 \"Heading number 0\" has 8px above vs 40px below — it reads as bound to the block above (2 headings on page)"
        );
    }

    const FLOW: &[(&str, &str)] = &[
        ("display", "block"),
        ("visibility", "visible"),
        ("opacity", "1"),
        ("position", "static"),
        ("backgroundColor", "rgba(0, 0, 0, 0)"),
        ("borderTopWidth", "0px"),
        ("borderBottomWidth", "0px"),
        ("boxShadow", "none"),
    ];

    fn flow(d: &mut FakeDom, parent: ElId, tag: &str, rect: (f64, f64, f64, f64), text: &str) -> ElId {
        let el = d.add(Some(parent), tag);
        d.set_styles(el, FLOW);
        d.set_style(el, "fontSize", if tag == "h2" { "24px" } else { "16px" });
        d.set_rect(el, rect.0, rect.1, rect.2, rect.3);
        if !text.is_empty() {
            d.add_text(el, text);
        }
        el
    }

    /// observations-35 row 12 (kinghost.com.br 218700, 218716): a bare `div`
    /// around a 40px spacer block holds space open as the spacer does. Read
    /// as a block, it put the heading 0px under "the block above".
    #[test]
    fn heading_rhythm_reads_a_wrapper_of_spacers_as_space() {
        let build = |wrapped: bool| {
            let mut d = FakeDom::new();
            let (_h, body) = d.with_page();
            let page = flow(&mut d, body, "div", (0.0, 0.0, 800.0, 1000.0), "");
            let mut y = 0.0;
            for i in 0..2 {
                flow(&mut d, page, "p", (0.0, y, 800.0, 20.0), "The paragraph that closes the section above this heading");
                y += 20.0;
                // 40px of spacer, then the heading, then 24px to its content.
                let holder = if wrapped { flow(&mut d, page, "div", (0.0, y, 800.0, 40.0), "") } else { page };
                flow(&mut d, holder, "div", (0.0, y, 800.0, 40.0), "");
                y += 40.0;
                let section = flow(&mut d, page, "section", (0.0, y, 800.0, 200.0), "");
                flow(&mut d, section, "h2", (0.0, y, 800.0, 30.0), &format!("Section title {i}"));
                flow(&mut d, section, "p", (0.0, y + 54.0, 800.0, 100.0), "What the heading introduces");
                y += 200.0;
            }
            check_heading_rhythm_dom(&d).len()
        };
        assert_eq!(build(false), 0, "a bare spacer is space: 40px above, 24px below");
        assert_eq!(build(true), 0, "so is a wrapper that holds only the spacer");
        // Wrappers nest, and a picture anywhere inside makes a block.
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let wrap = flow(&mut d, body, "div", (0.0, 0.0, 800.0, 40.0), "");
        let inner = flow(&mut d, wrap, "div", (0.0, 0.0, 800.0, 40.0), "");
        assert!(rhythm_is_spacer(&d, wrap));
        let deep = flow(&mut d, inner, "div", (0.0, 0.0, 800.0, 40.0), "");
        assert!(rhythm_is_spacer(&d, wrap));
        let img = d.add(Some(deep), "img");
        d.set_styles(img, FLOW);
        d.set_rect(img, 0.0, 0.0, 800.0, 40.0);
        assert!(!rhythm_is_spacer(&d, wrap), "a picture inside");
        // A wrapper that paints its bottom edge is a block.
        let ruled = flow(&mut d, body, "div", (0.0, 100.0, 800.0, 40.0), "");
        flow(&mut d, ruled, "div", (0.0, 100.0, 800.0, 40.0), "");
        assert!(rhythm_is_spacer(&d, ruled));
        d.set_style(ruled, "borderBottomWidth", "1px");
        assert!(!rhythm_is_spacer(&d, ruled));
        // So is a short divider drawn only along its top (review of #941).
        let divider = flow(&mut d, body, "div", (0.0, 160.0, 48.0, 2.0), "");
        assert!(rhythm_is_spacer(&d, divider));
        d.set_style(divider, "borderTopWidth", "2px");
        assert!(!rhythm_is_spacer(&d, divider));
        // And one that holds words.
        let worded = flow(&mut d, body, "div", (0.0, 200.0, 800.0, 40.0), "");
        flow(&mut d, worded, "div", (0.0, 200.0, 800.0, 40.0), "Words");
        assert!(!rhythm_is_spacer(&d, worded));
    }

    /// observations-35 row 12 (improved-rotary-phone-two.vercel.app 213861):
    /// the heading's own content rendered at height 0, and the walk climbed
    /// out of `section` and `main` and measured 86px to the page footer.
    #[test]
    fn heading_rhythm_does_not_measure_to_another_landmark() {
        let build = |below_tag: &str, inside_main: bool| {
            let mut d = FakeDom::new();
            let (_h, body) = d.with_page();
            let main = flow(&mut d, body, if inside_main { "main" } else { "div" }, (0.0, 0.0, 800.0, 420.0), "");
            let mut y = 0.0;
            // Two headings 8px under the paragraph above and 40px over their
            // own content.
            for i in 0..2 {
                flow(&mut d, main, "p", (0.0, y, 800.0, 20.0), "The paragraph that closes the block above this heading");
                flow(&mut d, main, "h2", (0.0, y + 28.0, 800.0, 30.0), &format!("Section title {i}"));
                flow(&mut d, main, "p", (0.0, y + 98.0, 800.0, 20.0), "What the heading introduces, at some length");
                y += 150.0;
            }
            // A third ends its box, and the column: the next block sits 40px
            // under it, outside.
            let last = flow(&mut d, main, "div", (0.0, y, 800.0, 58.0), "");
            flow(&mut d, last, "p", (0.0, y, 800.0, 20.0), "The paragraph that closes the block above this heading");
            flow(&mut d, last, "h2", (0.0, y + 28.0, 800.0, 30.0), "Closing title");
            let after = if inside_main { body } else { main };
            flow(&mut d, after, below_tag, (0.0, y + 98.0, 800.0, 60.0), "Copyright and links");
            check_heading_rhythm_dom(&d).len()
        };
        assert_eq!(build("div", false), 3, "a block below, in the same column");
        assert_eq!(build("footer", false), 2, "a footer is not what the heading introduces");
        assert_eq!(build("nav", false), 2);
        assert_eq!(build("div", true), 2, "nothing is measured past the end of main");
    }

    /// observations-28 row 4: a background image paints a band a heading walk
    /// stops at only when it covers the box. jyes.com.tw tiles a texture over
    /// its news band; an icon placed once beside a heading, a 3px accent bar
    /// drawn with a gradient, and gradient-filled text decorate the box.
    #[test]
    fn heading_rhythm_image_band_needs_a_layer_that_covers_the_box() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let el = d.add(Some(body), "section");
        let band = |d: &mut FakeDom, styles: &[(&str, &str)]| {
            for p in ["backgroundImage", "backgroundSize", "background", "backgroundClip", "webkitBackgroundClip"] {
                d.set_style(el, p, "");
            }
            d.set_styles(el, styles);
            rhythm_image_band(d, el)
        };
        let tile = r#"url("https://www.jyes.com.tw/index-news-bg.jpg")"#;
        let shorthand = |repeat: &str| {
            format!(r#"rgba(0, 0, 0, 0) {tile} {repeat} scroll 0% 0% / auto padding-box border-box"#)
        };
        let tiled = shorthand("repeat");
        assert!(band(&mut d, &[("backgroundImage", tile), ("backgroundSize", "auto"), ("background", &tiled)]));
        assert!(band(&mut d, &[("backgroundImage", tile), ("backgroundSize", "cover")]));
        let grad = "linear-gradient(rgb(255, 255, 255), rgb(250, 250, 250))";
        assert!(band(&mut d, &[("backgroundImage", grad), ("backgroundSize", "auto")]));
        // An icon placed once, one axis of tiling, a tiling not recorded.
        let once = shorthand("no-repeat");
        assert!(!band(&mut d, &[("backgroundImage", tile), ("backgroundSize", "auto"), ("background", &once)]));
        let strip = shorthand("repeat-x");
        assert!(!band(&mut d, &[("backgroundImage", tile), ("backgroundSize", "auto"), ("background", &strip)]));
        assert!(!band(&mut d, &[("backgroundImage", tile), ("backgroundSize", "auto")]));
        // A 48px accent bar drawn 3px tall under a title.
        let bar = "linear-gradient(90deg, rgb(17, 17, 17) 0px, rgb(17, 17, 17) 48px, rgba(0, 0, 0, 0) 48px)";
        let bar_layer = format!("rgba(0, 0, 0, 0) {bar} no-repeat scroll 0% 100% / 100% 3px padding-box border-box");
        assert!(!band(&mut d, &[("backgroundImage", bar), ("backgroundSize", "100% 3px"), ("background", &bar_layer)]));
        // Gradient-filled text paints the glyphs, not the box.
        assert!(!band(&mut d, &[("backgroundImage", grad), ("backgroundSize", "auto"), ("webkitBackgroundClip", "text")]));
        assert!(!band(&mut d, &[("backgroundImage", "none")]));
    }

    /// observations-25 issue 20: joongang.co.kr's tab slide parked past its
    /// track holds the crowded heading's twin, which met the two-heading
    /// minimum on its own.
    #[test]
    fn heading_rhythm_counts_only_headings_on_screen() {
        let mut d = FakeDom::new();
        let (html, body) = d.with_page();
        d.set_rect(html, 0.0, 0.0, 800.0, 2000.0);
        d.el_mut(html).scroll_width = 800.0;
        let flow = [("display", "block"), ("visibility", "visible"), ("opacity", "1"), ("position", "static")];
        let sec = d.add(Some(body), "section");
        d.set_styles(sec, &flow);
        d.set_styles(sec, &[("backgroundColor", "rgba(0, 0, 0, 0)"), ("borderTopWidth", "0px"), ("boxShadow", "none")]);
        d.set_rect(sec, 0.0, 0.0, 800.0, 1000.0);
        let clip = d.add(Some(sec), "div");
        d.set_styles(clip, &flow);
        d.set_styles(clip, &[("overflowX", "hidden"), ("overflowY", "hidden")]);
        d.set_rect(clip, 0.0, 400.0, 800.0, 200.0);
        let track = d.add(Some(clip), "div");
        d.set_styles(track, &flow);
        d.set_rect(track, -900.0, 400.0, 800.0, 200.0);
        let mut group = |d: &mut FakeDom, parent: ElId, x: f64, y: f64, title: &str| {
            let p0 = d.add(Some(parent), "p");
            d.add_text(p0, "Intro paragraph text that runs well past forty characters");
            d.set_styles(p0, &flow);
            d.set_style(p0, "fontSize", "20px");
            d.set_rect(p0, x, y, 800.0, 20.0);
            let h = d.add(Some(parent), "h2");
            d.add_text(h, title);
            d.set_styles(h, &flow);
            d.set_style(h, "fontSize", "24px");
            d.set_rect(h, x, y + 28.0, 800.0, 30.0);
            let p1 = d.add(Some(parent), "p");
            d.add_text(p1, "Body paragraph");
            d.set_styles(p1, &flow);
            d.set_style(p1, "fontSize", "16px");
            d.set_rect(p1, x, y + 98.0, 800.0, 20.0);
        };
        group(&mut d, sec, 0.0, 0.0, "Heading on screen one");
        group(&mut d, sec, 0.0, 160.0, "Heading on screen two");
        group(&mut d, track, -900.0, 420.0, "Heading on a parked slide");
        // A heading whose own opacity is 1 inside a wrapper held at 0 (an
        // inactive tab) is not painted either (review of #941).
        let faded = d.add(Some(sec), "div");
        d.set_styles(faded, &flow);
        d.set_style(faded, "opacity", "0");
        d.set_rect(faded, 0.0, 700.0, 800.0, 200.0);
        group(&mut d, faded, 0.0, 720.0, "Heading in a faded tab");
        let f = check_heading_rhythm_dom(&d);
        let details: Vec<&str> = f.iter().map(|x| x.finding.detail.as_str()).collect();
        assert_eq!(details.len(), 2, "{details:?}");
        assert!(details.iter().all(|x| x.ends_with("(2 headings on page)")), "{details:?}");
        assert!(!details.iter().any(|x| x.contains("parked") || x.contains("faded")), "{details:?}");
    }

    /// A `display: contents` wrapper whose first child is a spacer: the
    /// block below the heading is the content after the spacer.
    #[test]
    fn heading_rhythm_reads_past_a_spacer_in_a_contents_wrapper() {
        let shown = [("display", "block"), ("visibility", "visible"), ("opacity", "1"), ("position", "static")];
        let build = |spacer_tag: &str| {
            let mut d = FakeDom::new();
            let (_h, body) = d.with_page();
            let sec = d.add(Some(body), "section");
            d.set_styles(sec, &[("display", "block"), ("visibility", "visible"), ("opacity", "1"), ("position", "static"), ("backgroundColor", "rgba(0, 0, 0, 0)"), ("borderTopWidth", "0px"), ("boxShadow", "none")]);
            d.set_rect(sec, 0.0, 0.0, 800.0, 2000.0);
            let mut y = 0.0;
            for i in 0..2 {
                let p0 = d.add(Some(sec), "p");
                d.add_text(p0, "Intro paragraph text that runs well past forty characters");
                d.set_styles(p0, &shown);
                d.set_style(p0, "fontSize", "20px");
                d.set_rect(p0, 0.0, y, 800.0, 20.0);
                y += 28.0;
                let h = d.add(Some(sec), "h2");
                d.add_text(h, &format!("Heading number {i}"));
                d.set_styles(h, &shown);
                d.set_style(h, "fontSize", "24px");
                d.set_rect(h, 0.0, y, 800.0, 30.0);
                y += 30.0;
                let wrap = d.add(Some(sec), "div");
                d.set_style(wrap, "display", "contents");
                let spacer = d.add(Some(wrap), spacer_tag);
                d.set_styles(spacer, &shown);
                d.set_rect(spacer, 0.0, y, 800.0, 16.0);
                y += 40.0;
                let p1 = d.add(Some(wrap), "p");
                d.add_text(p1, "Body paragraph");
                d.set_styles(p1, &shown);
                d.set_style(p1, "fontSize", "16px");
                d.set_rect(p1, 0.0, y, 800.0, 20.0);
                y += 400.0;
            }
            d
        };
        let f = check_heading_rhythm_dom(&build("div"));
        assert_eq!(f.len(), 2, "{f:?}");
        assert_eq!(
            f[0].finding.detail,
            "h2 \"Heading number 0\" has 8px above vs 40px below — it reads as bound to the block above (2 headings on page)"
        );
        // A borderless input in the spacer's place is the block below: it
        // draws its placeholder, which is not DOM text.
        let f = check_heading_rhythm_dom(&build("input"));
        assert!(f.is_empty(), "{f:?}");
    }

    #[test]
    fn a_band_on_a_dark_canvas_is_measured_against_it() {
        let mut d = FakeDom::new();
        let (html, body) = d.with_page();
        let section = d.add(Some(body), "section");
        d.set_styles(section, &[("display", "block"), ("backgroundColor", "rgb(18, 18, 18)")]);
        d.set_rect(section, 0.0, 0.0, 800.0, 400.0);
        // On the default white canvas the dark section is a band with an edge.
        assert!(rhythm_draws_bottom_edge(&d, section));
        // On a page that asks for a dark scheme the canvas is that dark.
        d.set_style(html, "colorScheme", "dark");
        assert!(!rhythm_draws_bottom_edge(&d, section));
        d.set_style(html, "colorScheme", "light dark");
        assert!(rhythm_draws_bottom_edge(&d, section));
    }

    #[test]
    fn hidden_text_measure() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let vis = d.add(Some(body), "p");
        d.add_text(vis, "  visible   text ");
        d.set_styles(vis, &[("display", "block"), ("opacity", "1"), ("visibility", "visible")]);
        let hid = d.add(Some(body), "div");
        d.set_styles(hid, &[("display", "block"), ("opacity", "0"), ("visibility", "visible")]);
        let inner = d.add(Some(hid), "span");
        d.add_text(inner, "hidden words here");
        d.set_styles(inner, &[("display", "inline"), ("opacity", "1"), ("visibility", "visible")]);
        let scr = d.add(Some(body), "script");
        d.add_text(scr, "var x = 1;");
        mark_body_descendants(&mut d);
        let m = measure_hidden_text_dom(&d);
        assert_eq!(m.total_chars, 12.0 + 17.0);
        assert_eq!(m.hidden_chars, 17.0);
        assert_eq!(m.hidden_samples, vec!["hidden words here".to_string()]);
    }

    /// A box of text under `parent`, shown or hidden by `styles`.
    fn hidden_box(d: &mut FakeDom, parent: ElId, tag: &str, styles: &[(&str, &str)], text: &str) -> ElId {
        let el = d.add(Some(parent), tag);
        d.set_styles(el, &[("display", "block"), ("opacity", "1"), ("visibility", "visible")]);
        d.set_styles(el, styles);
        if !text.is_empty() {
            d.add_text(el, text);
        }
        el
    }

    const OPACITY_0: &[(&str, &str)] = &[("opacity", "0")];
    const VIS_HIDDEN: &[(&str, &str)] = &[("visibility", "hidden")];

    /// r5-p5-content-hidden-closed-navigation: closed menus, drawers, dialogs
    /// and unselected panels leave both counts.
    #[test]
    fn hidden_text_measure_leaves_out_closed_interface() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        hidden_box(&mut d, body, "p", &[], "visible text");
        // nike.com: a transparent flyout inside the site nav.
        let nav = hidden_box(&mut d, body, "nav", &[], "");
        hidden_box(&mut d, nav, "div", OPACITY_0, "closed flyout in a nav");
        // A role=menu list that is itself hidden.
        let menu = hidden_box(&mut d, body, "ul", VIS_HIDDEN, "");
        d.set_attr(menu, "role", "menu");
        hidden_box(&mut d, menu, "li", VIS_HIDDEN, "closed menu item");
        // phillips66.com: an inert mega-menu.
        let mega = hidden_box(&mut d, body, "section", OPACITY_0, "inert mega menu");
        d.set_attr(mega, "inert", "");
        // cencora.com, apple.com: a flyout whose trigger says collapsed.
        let trigger = hidden_box(&mut d, body, "button", &[], "Who we are");
        d.set_attr(trigger, "aria-controls", "who-we-are other-panel");
        d.set_attr(trigger, "aria-expanded", "false");
        d.add_selector(trigger, "[aria-controls]");
        let flyout = hidden_box(&mut d, body, "div", &[], "");
        d.set_attr(flyout, "id", "who-we-are");
        hidden_box(&mut d, flyout, "div", VIS_HIDDEN, "controlled flyout text");
        // capitalone.com: a dialog that is not open.
        let dialog = hidden_box(&mut d, body, "div", &[("opacity", "0"), ("visibility", "hidden")], "closed dialog");
        d.set_attr(dialog, "role", "dialog");
        // An unselected tab panel by role, and lpga.or.jp's by class.
        let panel = hidden_box(&mut d, body, "div", VIS_HIDDEN, "unselected tab panel");
        d.set_attr(panel, "role", "tabpanel");
        let sp = hidden_box(&mut d, body, "div", VIS_HIDDEN, "unselected class panel");
        d.set_attr(sp, "class", "merit02 news sp-tab-content sp-tab-content-5");
        // airsoft-verzeichnis.de: a Bootstrap off-canvas drawer.
        let drawer = hidden_box(&mut d, body, "div", VIS_HIDDEN, "drawer links");
        d.set_attr(drawer, "class", "offcanvas offcanvas-start");
        // climatempo.com.br, becomeautonomous.com: an accordion answer that
        // follows a collapsed trigger, bare or wrapped in a heading.
        let q = hidden_box(&mut d, body, "button", &[], "Question");
        d.set_attr(q, "aria-expanded", "false");
        hidden_box(&mut d, body, "div", OPACITY_0, "collapsed answer one");
        let h = hidden_box(&mut d, body, "h3", &[], "");
        let hq = hidden_box(&mut d, h, "button", &[], "Question");
        d.set_attr(hq, "aria-expanded", "false");
        hidden_box(&mut d, body, "div", OPACITY_0, "collapsed answer two");
        // yna.co.kr: a fixed whole-site menu parked right of a 390px viewport.
        d.inner_width = 390.0;
        let parked = hidden_box(&mut d, body, "div", &[("opacity", "0"), ("position", "fixed")], "parked whole menu");
        d.set_rect(parked, 390.0, 0.0, 390.0, 844.0);
        mark_body_descendants(&mut d);
        let m = measure_hidden_text_dom(&d);
        assert_eq!((m.total_chars, m.hidden_chars), (12.0 + 10.0 + 16.0, 0.0), "{:?}", m.hidden_samples);
    }

    /// The counter-evidence (vestris.ai, findings 141184, 141225) and its
    /// neighbours: content a reveal never showed still counts.
    #[test]
    fn hidden_text_measure_keeps_reveals_that_never_ran() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        hidden_box(&mut d, body, "p", &[], "visible text");
        // An in-flow section still at opacity 0.
        let section = hidden_box(&mut d, body, "div", OPACITY_0, "");
        d.set_attr(section, "class", "framer-11o8is2");
        hidden_box(&mut d, section, "p", &[], "never revealed copy");
        // A reveal inside the selected tab panel and inside an open dialog:
        // the role is on an ancestor that shows, not on the hidden box.
        let panel = hidden_box(&mut d, body, "div", &[], "");
        d.set_attr(panel, "role", "tabpanel");
        hidden_box(&mut d, panel, "p", OPACITY_0, "reveal in the selected panel");
        // A panel whose trigger says expanded, and one with two triggers of
        // which one says expanded.
        let trigger = hidden_box(&mut d, body, "button", &[], "Open");
        d.set_attr(trigger, "aria-controls", "open-panel shared-panel");
        d.set_attr(trigger, "aria-expanded", "true");
        d.add_selector(trigger, "[aria-controls]");
        let other = hidden_box(&mut d, body, "button", &[], "Shut");
        d.set_attr(other, "aria-controls", "shared-panel");
        d.set_attr(other, "aria-expanded", "false");
        d.add_selector(other, "[aria-controls]");
        for id in ["open-panel", "shared-panel"] {
            hidden_box(&mut d, body, "hr", &[], "");
            let p = hidden_box(&mut d, body, "div", OPACITY_0, "expanded panel text");
            d.set_attr(p, "id", id);
        }
        // Class words that are content, not closed interface.
        for class in ["menu-section", "tab", "content", "drawing-board", "modality"] {
            let el = hidden_box(&mut d, body, "div", OPACITY_0, "plain content");
            d.set_attr(el, "class", class);
        }
        // An answer after an expanded trigger, and a fixed box that is on
        // screen (ktb.gov.tr's unmarked panel): neither is known closed.
        let q = hidden_box(&mut d, body, "button", &[], "Asked");
        d.set_attr(q, "aria-expanded", "true");
        hidden_box(&mut d, body, "div", OPACITY_0, "expanded answer");
        d.inner_width = 1280.0;
        let fixed = hidden_box(&mut d, body, "div", &[("opacity", "0"), ("position", "fixed")], "fixed on screen");
        d.set_rect(fixed, 680.0, 16.0, 520.0, 766.0);
        // A site header whose first child is a closed hamburger, then a hero
        // still at opacity 0: the hamburger closes its menu, not the hero.
        let header = hidden_box(&mut d, body, "header", &[], "");
        let burger = hidden_box(&mut d, header, "button", &[], "");
        d.set_attr(burger, "aria-expanded", "false");
        hidden_box(&mut d, header, "a", &[], "Logo");
        hidden_box(&mut d, body, "section", OPACITY_0, "stalled hero");
        mark_body_descendants(&mut d);
        let m = measure_hidden_text_dom(&d);
        let hidden = 19.0 + 28.0 + 2.0 * 19.0 + 5.0 * 13.0 + 15.0 + 15.0 + 12.0;
        assert_eq!((m.total_chars, m.hidden_chars), (12.0 + 4.0 + 4.0 + 5.0 + 4.0 + hidden, hidden));
    }

    /// sona8.com (217624 and five more) and directus.io (216125, 216180):
    /// text a view timeline holds at 0 counts as shown, and an answer parked
    /// outside its closed row leaves both counts.
    #[test]
    fn hidden_text_measure_leaves_out_scroll_timelines_and_parked_panels() {
        let fade = || vec![crate::browser::dom::KeyframeFrame { decls: vec![("opacity".to_string(), "0".to_string())] }];
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        d.html_for_patterns = "<html><head><style>.reveal > * { animation-name: rise; animation-timeline: view(); }\
.stagger > * { animation-name: rise; animation-timeline: auto; }</style></head><body></body></html>"
            .to_string();
        d.keyframes.insert("rise".to_string(), fade());
        hidden_box(&mut d, body, "p", &[], "visible text");
        // Held by a view timeline: content a visitor scrolls to.
        let scrubbed = hidden_box(&mut d, body, "div", &[("opacity", "0"), ("animationName", "rise")], "");
        d.add_selector(scrubbed, ".reveal > *");
        d.set_running_animations(scrubbed, &["opacity", "transform"]);
        hidden_box(&mut d, scrubbed, "p", &[], "scrubbed in on scroll");
        // The same animation on the document timeline, and a scrubbed box
        // from a probe that read no animations: reveals that have not run.
        let timed = hidden_box(&mut d, body, "div", &[("opacity", "0"), ("animationName", "rise")], "waits on a class");
        d.add_selector(timed, ".stagger > *");
        d.set_running_animations(timed, &["opacity"]);
        let unread = hidden_box(&mut d, body, "div", &[("opacity", "0"), ("animationName", "rise")], "no animations read");
        d.add_selector(unread, ".reveal > *");
        // A `visibility: hidden` box is not held by its opacity.
        let vis = hidden_box(&mut d, body, "div", &[("visibility", "hidden"), ("animationName", "rise")], "hidden by visibility");
        d.add_selector(vis, ".reveal > *");
        d.set_running_animations(vis, &["opacity"]);
        // An answer parked below its closed, clipped row.
        let row = hidden_box(&mut d, body, "div", &[("position", "relative"), ("overflowX", "hidden"), ("overflowY", "hidden")], "");
        d.set_rect(row, 108.0, 3617.0, 1064.0, 76.0);
        let answer = hidden_box(&mut d, row, "div", &[("opacity", "0"), ("position", "absolute")], "parked answer text");
        d.set_rect(answer, 132.0, 3744.0, 1016.0, 45.0);
        // The same answer inside its row's box, and one under a slider that
        // never got its height: both still count.
        let open_row = hidden_box(&mut d, body, "div", &[("position", "relative"), ("overflowX", "hidden"), ("overflowY", "hidden")], "");
        d.set_rect(open_row, 108.0, 4000.0, 1064.0, 200.0);
        let shown = hidden_box(&mut d, open_row, "div", &[("opacity", "0"), ("position", "absolute")], "answer in an open row");
        d.set_rect(shown, 132.0, 4060.0, 1016.0, 45.0);
        let slider = hidden_box(&mut d, body, "div", &[("position", "relative"), ("overflowX", "hidden"), ("overflowY", "hidden")], "");
        d.set_rect(slider, 0.0, 5000.0, 1280.0, 0.0);
        let slide = hidden_box(&mut d, slider, "div", &[("opacity", "0"), ("position", "absolute")], "slide never shown");
        d.set_rect(slide, 0.0, 5000.0, 1280.0, 400.0);
        mark_body_descendants(&mut d);
        let m = measure_hidden_text_dom(&d);
        let hidden = 16.0 + 18.0 + 20.0 + 21.0 + 17.0;
        assert_eq!((m.total_chars, m.hidden_chars), (12.0 + 21.0 + hidden, hidden), "{:?}", m.hidden_samples);
    }

    /// r6-t6-hidden-scroll-linked: a hidden box that shows once the page is
    /// scrolled to it leaves the hidden share; one the probe saw stay hidden,
    /// or never looked at, still counts. A slider with every slide hidden
    /// leaves both counts and is reported apart; a slider showing its current
    /// slide is a page, and its other slides count as before.
    /// review of #968: a selected panel named by its role and a tab class
    /// (Bootstrap's `tab-pane`) is content when it stays hidden, by either
    /// way of marking it selected; an unselected one is closed interface.
    #[test]
    fn a_selected_tab_pane_is_content_when_hidden() {
        let text = |c: &str, n: usize| c.repeat(n);
        for by_labelledby in [false, true] {
            let mut d = FakeDom::new();
            let (_h, body) = d.with_page();
            hidden_box(&mut d, body, "p", &[], &text("v", 100));
            let tab = hidden_box(&mut d, body, "button", &[], "Plans");
            d.set_attr(tab, "id", "tab-plans");
            d.set_attr(tab, "aria-selected", "true");
            d.add_selector(tab, "[aria-selected]");
            if !by_labelledby {
                d.set_attr(tab, "aria-controls", "panel-plans");
                d.add_selector(tab, "[aria-controls]");
            }
            let pane = hidden_box(&mut d, body, "div", VIS_HIDDEN, &text("s", 40));
            d.set_attr(pane, "role", "tabpanel");
            d.set_attr(pane, "class", "tab-pane fade");
            d.set_attr(pane, "id", "panel-plans");
            if by_labelledby {
                d.set_attr(pane, "aria-labelledby", "tab-plans");
            }
            let other = hidden_box(&mut d, body, "div", VIS_HIDDEN, &text("u", 40));
            d.set_attr(other, "role", "tabpanel");
            d.set_attr(other, "class", "tab-pane fade");
            d.set_attr(other, "id", "panel-other");
            mark_body_descendants(&mut d);
            let m = measure_hidden_text_dom(&d);
            assert_eq!((m.total_chars, m.hidden_chars), (145.0, 40.0), "labelledby: {by_labelledby}");
            // An inert wrapper still closes the selected panel (review of
            // #968): only the panel's own role and class yield.
            let wrap = hidden_box(&mut d, body, "div", &[], "");
            d.set_attr(wrap, "inert", "");
            // The trigger now names a panel inside the wrapper; the first
            // pane, named by nothing, is an unselected panel again.
            d.set_attr(pane, "id", "panel-gone");
            let inner = hidden_box(&mut d, wrap, "div", VIS_HIDDEN, &text("i", 40));
            d.set_attr(inner, "role", "tabpanel");
            d.set_attr(inner, "class", "tab-pane");
            d.set_attr(inner, "id", "panel-plans");
            if by_labelledby {
                d.set_attr(pane, "aria-labelledby", "");
                d.set_attr(inner, "aria-labelledby", "tab-plans");
            }
            mark_body_descendants(&mut d);
            let m = measure_hidden_text_dom(&d);
            assert_eq!((m.total_chars, m.hidden_chars), (105.0, 0.0), "inert, labelledby: {by_labelledby}");
        }
    }

    #[test]
    fn an_image_carousel_that_started_counts_its_hidden_captions() {
        let text = |c: &str, n: usize| c.repeat(n);
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        hidden_box(&mut d, body, "p", &[], &text("v", 100));
        let carousel = hidden_box(&mut d, body, "div", &[], "");
        d.set_attr(carousel, "class", "carousel");
        let current = hidden_box(&mut d, carousel, "div", &[], "");
        let img = hidden_box(&mut d, current, "img", &[], "");
        // Bootstrap's caption class names the carousel, and the caption is
        // part of a slide, not a slider of its own.
        let caption = hidden_box(&mut d, current, "p", VIS_HIDDEN, &text("a", 20));
        d.set_attr(caption, "class", "carousel-caption");
        let waiting = hidden_box(&mut d, carousel, "div", OPACITY_0, "");
        hidden_box(&mut d, waiting, "p", VIS_HIDDEN, &text("b", 20));
        mark_body_descendants(&mut d);
        d.set_rect(img, 0.0, 0.0, 640.0, 120.0);
        let m = measure_hidden_text_dom(&d);
        assert_eq!((m.total_chars, m.hidden_chars, m.unstarted_slider_chars), (140.0, 40.0, 0.0), "started");
        // With no picture laid out, nothing shows: it never started.
        d.set_rect(img, 0.0, 0.0, 0.0, 0.0);
        let m = measure_hidden_text_dom(&d);
        assert_eq!((m.total_chars, m.hidden_chars, m.unstarted_slider_chars), (100.0, 0.0, 40.0), "unstarted");
        // Nor does a 40px arrow icon beside slides that are all hidden.
        d.set_rect(carousel, 0.0, 0.0, 640.0, 120.0);
        let arrow = hidden_box(&mut d, carousel, "svg", &[], "");
        mark_body_descendants(&mut d);
        d.set_rect(arrow, 600.0, 40.0, 40.0, 40.0);
        let m = measure_hidden_text_dom(&d);
        assert_eq!(m.unstarted_slider_chars, 40.0, "an arrow");
        // Nor a backdrop on the slider's own box.
        d.set_style(carousel, "backgroundImage", "url(\"hero.jpg\")");
        let m = measure_hidden_text_dom(&d);
        assert_eq!(m.unstarted_slider_chars, 40.0, "the slider's backdrop");
        // A slide's picture across the track does, decorative or not
        // (review of #968: `aria-hidden` hides nothing from sight).
        d.set_rect(img, 0.0, 0.0, 640.0, 120.0);
        let m = measure_hidden_text_dom(&d);
        assert_eq!(m.unstarted_slider_chars, 0.0, "a slide's picture");
        d.set_attr(img, "aria-hidden", "true");
        let m = measure_hidden_text_dom(&d);
        assert_eq!(m.unstarted_slider_chars, 0.0, "an aria-hidden slide picture");
    }

    #[test]
    fn hidden_text_measure_probes_scroll_linked_reveals_and_sets_aside_unstarted_sliders() {
        let text = |c: &str, n: usize| c.repeat(n);
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        hidden_box(&mut d, body, "p", &[], &text("v", 100));
        let scrubbed = hidden_box(&mut d, body, "div", &[("opacity", "0")], "");
        d.set_shown_on_scroll(scrubbed, true);
        hidden_box(&mut d, scrubbed, "p", &[], &text("s", 150));
        let failed = hidden_box(&mut d, body, "div", &[("opacity", "0")], &text("f", 60));
        d.set_shown_on_scroll(failed, false);
        hidden_box(&mut d, body, "div", &[("visibility", "hidden")], &text("u", 40));
        // A slider that never started: its box is transparent, and so is
        // every slide of one whose box is not.
        let dead = hidden_box(&mut d, body, "div", &[("opacity", "0")], "");
        d.set_attr(dead, "class", "slider slider--thumbnails js-slider");
        hidden_box(&mut d, dead, "div", &[], &text("a", 50));
        let rev = hidden_box(&mut d, body, "div", &[], "");
        d.set_attr(rev, "class", "rev_slider");
        let list = hidden_box(&mut d, rev, "ul", &[], "");
        hidden_box(&mut d, list, "li", &[("visibility", "hidden")], &text("b", 30));
        hidden_box(&mut d, list, "li", &[("visibility", "hidden")], &text("c", 30));
        // A slider showing its current slide: the waiting slides are not the
        // slider, though their class names it.
        let live = hidden_box(&mut d, body, "div", &[], "");
        d.set_attr(live, "class", "swiper-wrapper");
        let current = hidden_box(&mut d, live, "div", &[], &text("d", 20));
        d.set_attr(current, "class", "swiper-slide swiper-slide-active");
        let waiting = hidden_box(&mut d, live, "div", &[("opacity", "0")], &text("e", 20));
        d.set_attr(waiting, "class", "swiper-slide");
        mark_body_descendants(&mut d);
        let m = measure_hidden_text_dom(&d);
        assert_eq!(
            (m.total_chars, m.hidden_chars, m.unstarted_slider_chars),
            (100.0 + 150.0 + 60.0 + 40.0 + 40.0, 60.0 + 40.0 + 20.0, 110.0)
        );
        assert_eq!(m.hidden_samples, vec![text("f", 40), text("u", 40), text("e", 20)]);
        assert_eq!(m.unstarted_slider_samples, vec![text("a", 40), text("b", 30), text("c", 30)]);

        // An outer section revealed on scroll, holding a child that stays at
        // opacity 0: the child's text stays hidden until the probe says it
        // shows too, and a child it says shows leaves with its section.
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        hidden_box(&mut d, body, "p", &[], &text("v", 100));
        let section = hidden_box(&mut d, body, "section", &[("opacity", "0")], &text("s", 60));
        d.set_shown_on_scroll(section, true);
        let stuck = hidden_box(&mut d, section, "div", &[("opacity", "0")], &text("k", 150));
        mark_body_descendants(&mut d);
        let m = measure_hidden_text_dom(&d);
        assert_eq!((m.total_chars, m.hidden_chars), (310.0, 150.0), "the inner box was not asked about");
        d.set_shown_on_scroll(stuck, false);
        let m = measure_hidden_text_dom(&d);
        assert_eq!((m.total_chars, m.hidden_chars), (310.0, 150.0));
        assert_eq!(m.hidden_samples, vec![text("k", 40)]);
        d.set_shown_on_scroll(stuck, true);
        let m = measure_hidden_text_dom(&d);
        assert_eq!((m.total_chars, m.hidden_chars), (310.0, 0.0));

        // A child that hides itself with `visibility` inside a section held
        // at opacity 0 stays hidden too until the probe says it shows.
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        hidden_box(&mut d, body, "p", &[], &text("v", 100));
        let section = hidden_box(&mut d, body, "section", &[("opacity", "0")], &text("s", 60));
        d.set_shown_on_scroll(section, true);
        hidden_box(&mut d, section, "div", &[("visibility", "hidden")], &text("k", 150));
        mark_body_descendants(&mut d);
        let m = measure_hidden_text_dom(&d);
        assert_eq!((m.total_chars, m.hidden_chars), (310.0, 150.0));

        // A grandchild that sets visibility: visible again shows once its
        // section does.
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        hidden_box(&mut d, body, "p", &[], &text("v", 100));
        let section = hidden_box(&mut d, body, "section", &[("opacity", "0")], &text("s", 60));
        d.set_shown_on_scroll(section, true);
        let wrap = hidden_box(&mut d, section, "div", &[("visibility", "hidden")], "");
        hidden_box(&mut d, wrap, "p", &[("visibility", "visible")], &text("k", 150));
        mark_body_descendants(&mut d);
        let m = measure_hidden_text_dom(&d);
        assert_eq!((m.total_chars, m.hidden_chars), (310.0, 0.0));

        // Below the reporting share nothing is probed, and nothing moves.
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        hidden_box(&mut d, body, "p", &[], &text("v", 400));
        let scrubbed = hidden_box(&mut d, body, "div", &[("opacity", "0")], &text("s", 150));
        d.set_shown_on_scroll(scrubbed, true);
        mark_body_descendants(&mut d);
        let m = measure_hidden_text_dom(&d);
        assert_eq!((m.total_chars, m.hidden_chars), (550.0, 150.0));
    }

    #[test]
    fn closed_container_class_words() {
        for token in [
            "offcanvas", "offcanvas-start", "off-canvas", "nav-drawer", "megamenu", "mega-menu", "megaMenu",
            "sub-menu", "globalnav-submenu", "user-item-dropdown-popover", "globalnav-flyout", "modal",
            "sp-tab-content", "tab-pane", "Tabs_panel__x1", "tabpanel", "accordion-body", "accordion__content",
        ] {
            assert!(closed_container_class(token), "{token}");
        }
        for token in ["menu", "menu-section", "tab", "tabs", "content", "table-content", "panel", "accordion", "reveal", "framer-11o8is2", "submenus-list-x"] {
            assert!(!closed_container_class(token), "{token}");
        }
    }

    /// agora.co.il, joongang.co.kr, v0-optimus-delta.vercel.app: the root, a
    /// page `#wrapper` at `overflow-x: hidden` (shorthand `hidden auto`) and a
    /// `main.overflow-x-hidden` read as scrollers, with a lone textarea or
    /// header button as the card.
    #[test]
    fn edge_flush_cards_skips_page_scrollers_and_lone_boxes() {
        let mut d = FakeDom::new();
        let (html, body) = d.with_page();
        let setup_scroller = |d: &mut FakeDom, el: ElId, x: &str, shorthand: &str| {
            d.set_styles(el, &[("overflowX", x), ("overflow", shorthand)]);
            d.set_rect(el, 0.0, 0.0, 390.0, 2000.0);
            let e = d.el_mut(el);
            e.client_width = 390.0;
            e.scroll_width = 711.0;
        };
        let card = |d: &mut FakeDom, parent: ElId, x: f64| {
            let c = d.add(Some(parent), "div");
            d.set_styles(c, &[("backgroundColor", "rgb(255, 255, 255)")]);
            d.set_rect(c, x, 40.0, 300.0, 120.0);
            c
        };

        // The root scrolls the page.
        setup_scroller(&mut d, html, "auto", "auto scroll");
        let wrapper = d.add(Some(body), "div");
        let a = card(&mut d, wrapper, -12.0);
        let _ = a;
        card(&mut d, wrapper, 320.0);
        assert!(check_edge_flush_cards_dom(&d).is_empty());

        // A page wrapper that hides x overflow scrolls only vertically.
        setup_scroller(&mut d, html, "visible", "visible");
        setup_scroller(&mut d, wrapper, "hidden", "hidden auto");
        assert!(check_edge_flush_cards_dom(&d).is_empty());

        // A real x scroller holding one flush box and no row.
        let rail = d.add(Some(body), "div");
        setup_scroller(&mut d, rail, "auto", "auto");
        let lone = card(&mut d, rail, 80.0);
        d.set_rect(lone, 80.0, 40.0, 308.0, 120.0);
        assert!(check_edge_flush_cards_dom(&d).is_empty(), "one box is not a row");
        // Two boxes stacked in a column are not a row either.
        let below = card(&mut d, rail, 80.0);
        d.set_rect(below, 80.0, 180.0, 308.0, 120.0);
        assert!(check_edge_flush_cards_dom(&d).is_empty(), "a column is not a row");
        // A second box beside them makes the row.
        card(&mut d, rail, 400.0);
        assert_eq!(check_edge_flush_cards_dom(&d).len(), 1);
    }

    #[test]
    fn edge_flush_cards() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let sc = d.add(Some(body), "div");
        d.set_attr(sc, "class", "rail");
        d.set_styles(sc, &[("overflowX", "auto"), ("overflow", "auto")]);
        d.set_rect(sc, 0.0, 100.0, 600.0, 200.0);
        {
            let e = d.el_mut(sc);
            e.client_width = 600.0;
            e.scroll_width = 1200.0;
            e.scroll_left = 0.0;
            e.client_left = 0.0;
        }
        let card = d.add(Some(sc), "article");
        d.set_attr(card, "class", "card");
        d.set_styles(card, &[("overflowX", "visible"), ("overflow", "visible"), ("backgroundColor", "rgb(255, 255, 255)"), ("borderTopWidth", "0px"), ("borderRightWidth", "0px"), ("borderBottomWidth", "0px"), ("borderLeftWidth", "0px")]);
        d.set_rect(card, 24.0, 110.0, 574.0, 150.0); // right edge at 598 → gap 2
        // The next card in the row, past the clip edge.
        let next = d.add(Some(sc), "article");
        d.set_styles(next, &[("backgroundColor", "rgb(255, 255, 255)")]);
        d.set_rect(next, 614.0, 110.0, 574.0, 150.0);
        let f = check_edge_flush_cards_dom(&d);
        assert_eq!(f.len(), 1, "{f:?}");
        assert_eq!(f[0].el, Some(sc));
        assert_eq!(
            f[0].finding.detail,
            format!(
                "1 card flush against the right edge of {} at rest (2px gap, e.g. {})",
                class_selector(&d, sc),
                class_selector(&d, card)
            )
        );
        d.set_rect(card, 24.0, 110.0, 540.0, 150.0);
        assert!(check_edge_flush_cards_dom(&d).is_empty());

        // observations-35 row 15 (paseo.sh 217737): the cells of a table
        // that scrolls sideways are parts of the table, not cards.
        d.set_rect(card, 24.0, 110.0, 574.0, 150.0);
        assert_eq!(check_edge_flush_cards_dom(&d).len(), 1);
        d.set_style(card, "display", "table-cell");
        d.set_style(next, "display", "table-cell");
        assert!(check_edge_flush_cards_dom(&d).is_empty());
        d.set_style(card, "display", "block");
        d.set_style(next, "display", "block");
        let table = d.add(Some(body), "table");
        d.set_styles(table, &[("overflowX", "auto"), ("overflow", "auto"), ("display", "block")]);
        d.set_rect(table, 24.0, 400.0, 342.0, 300.0);
        {
            let e = d.el_mut(table);
            e.client_width = 342.0;
            e.scroll_width = 700.0;
        }
        for (i, x) in [25.0, 225.0, 425.0].into_iter().enumerate() {
            let th = d.add(Some(table), "th");
            d.set_styles(th, &[("backgroundColor", "rgb(240, 240, 240)")]);
            d.set_rect(th, x, 400.0, 200.0, 48.0);
            d.add_text(th, &format!("Column {i}"));
        }
        assert!(check_edge_flush_cards_dom(&d).iter().all(|f| f.el != Some(table)), "table headers");
    }

    #[test]
    fn text_occlusion_box_and_inline_leak() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let base = &[("display", "block"), ("visibility", "visible"), ("opacity", "1"), ("contentVisibility", "visible"), ("position", "static"), ("cssFloat", "none"), ("animationName", "none")][..];
        let txt = d.add(Some(body), "p");
        d.set_attr(txt, "class", "victim");
        d.add_text(txt, "Readable headline");
        d.set_styles(txt, base);
        d.set_styles(txt, &[("fontSize", "16px"), ("overflow", "visible"), ("overflowX", "visible"), ("overflowY", "visible"), ("clip", "auto"), ("clipPath", "none")]);
        d.set_rect(txt, 100.0, 100.0, 240.0, 28.0);
        let boxel = d.add(Some(body), "div");
        d.set_attr(boxel, "class", "cover");
        d.set_styles(boxel, base);
        d.set_styles(boxel, &[("position", "absolute"), ("backgroundColor", "rgb(20, 20, 20)")]);
        d.set_rect(boxel, 100.0, 100.0, 240.0, 28.0);
        // FakeDom's elementsFromPoint returns the last element in document
        // order whose rect contains the point → the box.
        mark_body_descendants(&mut d);
        let f = check_text_occlusion_dom(&d);
        assert_eq!(f.len(), 1, "{f:?}");
        assert_eq!(f[0].el, Some(txt));
        assert_eq!(
            f[0].finding.detail,
            format!(
                "{} \"Readable headline\" is 100% covered by an opaque element ({})",
                class_selector(&d, txt),
                class_selector(&d, boxel)
            )
        );

        // inline leak
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let wrap = d.add(Some(body), "div");
        d.set_styles(wrap, base);
        d.set_rect(wrap, 0.0, 0.0, 400.0, 200.0);
        let leak = d.add(Some(wrap), "span");
        d.set_attr(leak, "class", "marker");
        d.set_styles(leak, base);
        d.set_styles(leak, &[("display", "inline"), ("backgroundColor", "rgb(255, 0, 0)"), ("paddingTop", "20px"), ("paddingBottom", "20px"), ("fontSize", "16px"), ("lineHeight", "20px")]);
        d.set_rect(leak, 10.0, 10.0, 40.0, 60.0);
        let sib = d.add(Some(wrap), "p");
        d.add_text(sib, "neighbour");
        d.set_attr(sib, "class", "next");
        d.set_styles(sib, base);
        d.set_rect(sib, 0.0, 40.0, 400.0, 20.0);
        mark_body_descendants(&mut d);
        let f = check_text_occlusion_dom(&d);
        assert_eq!(f.len(), 1, "{f:?}");
        assert_eq!(
            f[0].finding.detail,
            format!(
                "{} is an inline element whose opaque fill leaks 40px past its line onto {}",
                class_selector(&d, leak),
                class_selector(&d, sib)
            )
        );
    }

    /// Decision r8-t2-occlusion-stacked-mockup (advisory): covered text in a
    /// recognised mockup reports as advisory; covered page text, and a
    /// control in the mockup, keep the registry's severity.
    #[test]
    fn text_occlusion_in_a_mockup_is_advisory() {
        let build = |tag: &str, frame: &dyn Fn(&mut FakeDom, ElId)| {
            let mut d = FakeDom::new();
            let (_h, body) = d.with_page();
            let base = &[("display", "block"), ("visibility", "visible"), ("opacity", "1"), ("contentVisibility", "visible"), ("position", "static"), ("cssFloat", "none"), ("animationName", "none")][..];
            let deck = d.add(Some(body), "div");
            d.set_styles(deck, base);
            d.set_rect(deck, 0.0, 0.0, 600.0, 400.0);
            let card = d.add(Some(deck), "div");
            d.set_styles(card, base);
            d.set_rect(card, 50.0, 50.0, 400.0, 300.0);
            frame(&mut d, card);
            let txt = d.add(Some(card), tag);
            d.add_text(txt, "Needs attention");
            d.set_styles(txt, base);
            d.set_styles(txt, &[("fontSize", "16px"), ("overflow", "visible"), ("overflowX", "visible"), ("overflowY", "visible"), ("clip", "auto"), ("clipPath", "none")]);
            d.set_rect(txt, 100.0, 100.0, 240.0, 28.0);
            let front = d.add(Some(deck), "div");
            d.set_styles(front, base);
            d.set_styles(front, &[("position", "absolute"), ("backgroundColor", "rgb(20, 20, 20)")]);
            d.set_rect(front, 100.0, 100.0, 240.0, 28.0);
            mark_body_descendants(&mut d);
            let f = check_text_occlusion_dom(&d);
            assert_eq!(f.len(), 1, "{f:?}");
            assert_eq!(f[0].el, Some(txt));
            f[0].finding.severity.clone()
        };
        let tilted = |d: &mut FakeDom, card: ElId| {
            d.set_style(card, "transform", "perspective(900px) rotateX(8deg)");
        };
        let advisory = Some(crate::checks::rules::ADVISORY_SEVERITY.to_string());
        assert_eq!(build("p", &|_, _| {}), None, "covered page text");
        assert_eq!(build("p", &tilted), advisory, "covered in a tilted device frame");
        assert_eq!(build("button", &tilted), None, "a control in the mockup");
        // The picture path has no control guard of its own.
        let picture = |d: &mut FakeDom, card: ElId| { d.set_attr(card, "role", "img"); };
        assert_eq!(build("p", &picture), advisory, "covered in a subtree marked as a picture");
        assert_eq!(build("button", &picture), None, "a control in a picture");

        // An inline box whose fill leaks onto its neighbour is what covers,
        // not what is covered: in a mockup it keeps its severity.
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let base = &[("display", "block"), ("visibility", "visible"), ("opacity", "1"), ("contentVisibility", "visible"), ("position", "static"), ("cssFloat", "none"), ("animationName", "none")][..];
        let wrap = d.add(Some(body), "div");
        d.set_styles(wrap, base);
        d.set_style(wrap, "transform", "perspective(900px) rotateX(8deg)");
        d.set_rect(wrap, 0.0, 0.0, 400.0, 200.0);
        let leak = d.add(Some(wrap), "span");
        d.set_styles(leak, base);
        d.set_styles(leak, &[("display", "inline"), ("backgroundColor", "rgb(255, 0, 0)"), ("paddingTop", "20px"), ("paddingBottom", "20px"), ("fontSize", "16px"), ("lineHeight", "20px")]);
        d.set_rect(leak, 10.0, 10.0, 40.0, 60.0);
        let sib = d.add(Some(wrap), "p");
        d.add_text(sib, "neighbour");
        d.set_styles(sib, base);
        d.set_rect(sib, 0.0, 40.0, 400.0, 20.0);
        mark_body_descendants(&mut d);
        let f = check_text_occlusion_dom(&d);
        assert_eq!(f.len(), 1, "{f:?}");
        assert_eq!(f[0].el, Some(leak));
        assert_eq!(f[0].finding.severity, None);
    }

    /// Three labels in one padded inline link, set apart by wide margins,
    /// come back as three runs on one row. They are one line: the fill
    /// still hangs 30px past it onto the paragraph below.
    #[test]
    fn text_occlusion_inline_leak_counts_rows_not_runs() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let wrap = d.add(Some(body), "div");
        d.set_styles(wrap, PROBE_BASE);
        d.set_rect(wrap, 0.0, 100.0, 1056.0, 80.0);
        let btn = d.add(Some(wrap), "a");
        d.add_text(btn, "Plans   Pricing   Support");
        d.set_attr(btn, "class", "btn-lg");
        d.set_styles(btn, PROBE_BASE);
        d.set_styles(
            btn,
            &[
                ("display", "inline"),
                ("backgroundColor", "rgb(19, 21, 28)"),
                ("paddingTop", "15px"),
                ("paddingBottom", "15px"),
                ("fontSize", "14px"),
                ("lineHeight", "20px"),
            ],
        );
        d.set_rect(btn, 100.0, 88.0, 600.0, 50.0);
        d.set_text_lines(btn, &[(110.0, 105.0, 40.0, 16.0), (330.0, 105.0, 50.0, 16.0), (560.0, 105.0, 55.0, 16.0)]);
        let sib = d.add(Some(wrap), "p");
        d.add_text(sib, "The paragraph under the link's line.");
        d.set_attr(sib, "class", "next");
        d.set_styles(sib, PROBE_BASE);
        d.set_rect(sib, 0.0, 125.6, 1056.0, 24.0);
        mark_body_descendants(&mut d);
        let f = check_text_occlusion_dom(&d);
        let leak: Vec<_> = f.iter().filter(|f| f.el == Some(btn)).collect();
        assert_eq!(leak.len(), 1, "{f:?}");
        assert!(leak[0].finding.detail.contains("leaks 30px past its line onto"), "{:?}", leak[0].finding.detail);
        // Two rows of runs are two lines: 50 less 40 leaves 10px.
        d.set_text_lines(btn, &[(110.0, 95.0, 40.0, 16.0), (330.0, 95.0, 50.0, 16.0), (110.0, 115.0, 55.0, 16.0)]);
        let f = check_text_occlusion_dom(&d);
        let leak: Vec<_> = f.iter().filter(|f| f.el == Some(btn)).collect();
        assert!(leak[0].finding.detail.contains("leaks 10px past its line onto"), "{:?}", leak[0].finding.detail);
    }

    const PROBE_BASE: &[(&str, &str)] = &[
        ("display", "block"),
        ("visibility", "visible"),
        ("opacity", "1"),
        ("contentVisibility", "visible"),
        ("position", "static"),
        ("cssFloat", "none"),
        ("animationName", "none"),
        ("pointerEvents", "auto"),
        ("fontSize", "16px"),
    ];

    /// airsoft-verzeichnis.de's Bootstrap `form-floating` label: the hit test
    /// passes through it and answers with the input under it.
    #[test]
    fn text_occlusion_cannot_rank_a_box_under_text_that_ignores_pointer_events() {
        let run = |pointer_events: &str, input_text: Option<&str>| {
            let mut d = FakeDom::new();
            let (_h, body) = d.with_page();
            let field = d.add(Some(body), "div");
            d.set_styles(field, PROBE_BASE);
            d.set_style(field, "position", "relative");
            d.set_rect(field, 12.0, 104.0, 228.0, 58.0);
            let label = d.add(Some(field), "label");
            d.set_styles(label, PROBE_BASE);
            d.set_styles(label, &[("position", "absolute"), ("pointerEvents", pointer_events)]);
            d.set_rect(label, 24.0, 112.0, 120.0, 20.0);
            d.add_text(label, "Emailadresse");
            let input = d.add(Some(field), if input_text.is_some() { "div" } else { "input" });
            d.set_styles(input, PROBE_BASE);
            d.set_styles(input, &[("position", "absolute"), ("backgroundColor", "rgb(255, 255, 255)")]);
            d.set_rect(input, 12.0, 104.0, 228.0, 58.0);
            if let Some(t) = input_text {
                d.add_text(input, t);
            }
            mark_body_descendants(&mut d);
            check_text_occlusion_dom(&d)
        };
        assert_eq!(run("auto", None).len(), 1);
        assert!(run("none", None).is_empty());
        // Text it names overlaps the label whichever of the two is on top.
        let f = run("none", Some("Emailadresse eingeben"));
        assert_eq!(f.len(), 1, "{f:?}");
        assert!(f[0].finding.detail.contains("overlapping text"), "{f:?}");
    }

    /// ladepeche.fr's stretched link: its transparent `::after` answers for
    /// the whole card while its title sits below the topic. drom.ru's hidden
    /// link carries its label at `font-size: 0`.
    #[test]
    fn text_occlusion_counts_text_only_where_its_glyphs_are() {
        let run = |text_rect: Option<(f64, f64)>, font_size: &str| {
            let mut d = FakeDom::new();
            let (_h, body) = d.with_page();
            let overlay = d.add(Some(body), "div");
            d.set_styles(overlay, PROBE_BASE);
            d.set_style(overlay, "position", "absolute");
            d.set_rect(overlay, 85.0, 700.0, 665.0, 280.0);
            let topic = d.add(Some(overlay), "div");
            d.set_styles(topic, PROBE_BASE);
            d.set_rect(topic, 95.0, 710.0, 120.0, 20.0);
            d.set_text_rect(topic, 95.0, 711.0, 80.0, 18.0);
            d.add_text(topic, "Faits divers");
            let link = d.add(Some(overlay), "a");
            d.set_styles(link, PROBE_BASE);
            d.set_styles(link, &[("position", "absolute"), ("fontSize", font_size)]);
            // The rect the hit test answers for: the overlay's whole card.
            d.set_rect(link, 85.0, 700.0, 665.0, 280.0);
            d.add_text(link, "Messe polémique à Carcassonne");
            if let Some((x, y)) = text_rect {
                d.set_text_rect(link, x, y, 400.0, 40.0);
            }
            mark_body_descendants(&mut d);
            check_text_occlusion_dom(&d)
        };
        // The title's glyphs sit at y 800; the topic at y 710 is not under them.
        assert!(run(Some((95.0, 800.0)), "16px").is_empty());
        // Glyphs over the topic, and a text rect the capture did not record,
        // count as before.
        assert_eq!(run(Some((95.0, 705.0)), "16px").len(), 1);
        assert_eq!(run(None, "16px").len(), 1);
        // A label at font-size 0 draws nothing.
        assert!(run(None, "0px").is_empty());
    }

    /// observations-35 row 15 (freenet.de 218507): a 40px price on a 40px
    /// line carries a 57px text rect that starts 9px above its box and laps
    /// the 12px label over it, while its digits sit clear of the label.
    #[test]
    fn text_occlusion_reads_latin_text_by_its_ink_band() {
        let run = |price: &str, price_rect_top: f64| {
            let mut d = FakeDom::new();
            let (_h, body) = d.with_page();
            let panel = d.add(Some(body), "div");
            d.set_styles(panel, PROBE_BASE);
            d.set_style(panel, "position", "absolute");
            d.set_rect(panel, 700.0, 400.0, 400.0, 120.0);
            let label = d.add(Some(panel), "div");
            d.set_styles(label, PROBE_BASE);
            d.set_style(label, "fontSize", "12px");
            d.set_rect(label, 774.0, 437.0, 90.0, 17.0);
            d.set_text_rect(label, 774.0, 436.0, 55.0, 17.0);
            d.add_text(label, "Monatlich");
            let amount = d.add(Some(panel), "div");
            d.set_styles(amount, PROBE_BASE);
            d.set_style(amount, "fontSize", "40px");
            d.set_rect(amount, 774.0, 454.0, 47.0, 40.0);
            d.set_text_rect(amount, 774.0, price_rect_top, 47.0, 57.0);
            d.add_text(amount, price);
            // The page answers the label's probe row with the price, whose
            // inline box holds the points.
            for (x, y) in occlusion_probe_points(&d.rect(label), 1280.0, 800.0) {
                d.set_point(x, y, vec![amount, panel, body]);
            }
            mark_body_descendants(&mut d);
            check_text_occlusion_dom(&d).len()
        };
        assert_eq!(run("19", 445.0), 0, "the digits start under the label's ink");
        // Pulled up until the digits themselves cross the label, it reports.
        assert_eq!(run("19", 425.0), 1);
        // Text that reaches past the Latin band keeps its content area.
        assert_eq!(run("É9", 445.0), 1);
    }

    #[test]
    fn glyph_ink_band_insets_one_line_of_latin_text() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let el = d.add(Some(body), "div");
        d.set_style(el, "fontSize", "40px");
        d.add_text(el, "19,99 €");
        // 57px of content area at 40px: 0.75 * 57 - 0.8 * 40 = 10.75 off the
        // top, and 0.18 * 57 - 0.25 * 40 = 0.26 off the bottom.
        let band = glyph_ink_band(&d, el, &Rect::from_xywh(10.0, 445.0, 47.0, 57.0)).expect("band");
        assert!((band.top - 455.75).abs() < 1e-9, "{band:?}");
        assert!((band.bottom - 501.74).abs() < 1e-9, "{band:?}");
        // An ordinary 1.2em content area keeps all but a hair of its height.
        d.set_style(el, "fontSize", "16px");
        let band = glyph_ink_band(&d, el, &Rect::from_xywh(0.0, 0.0, 60.0, 19.0)).expect("band");
        assert!(band.top < 1.5 && band.bottom == 19.0, "{band:?}");
        // Several lines with no line rects, an unknown font size and
        // non-Latin text keep the rect.
        assert!(glyph_ink_band(&d, el, &Rect::from_xywh(0.0, 0.0, 60.0, 60.0)).is_none());
        d.set_text_lines(el, &[(0.0, 0.0, 60.0, 19.0), (0.0, 22.0, 40.0, 19.0), (0.0, 44.0, 50.0, 19.0)]);
        assert!(glyph_ink_band(&d, el, &Rect::from_xywh(0.0, 0.0, 60.0, 63.0)).is_some());
        d.set_style(el, "fontSize", "");
        assert!(glyph_ink_band(&d, el, &Rect::from_xywh(0.0, 0.0, 60.0, 19.0)).is_none());
        let cjk = d.add(Some(body), "div");
        d.set_style(cjk, "fontSize", "40px");
        d.add_text(cjk, "月額");
        assert!(glyph_ink_band(&d, cjk, &Rect::from_xywh(0.0, 0.0, 80.0, 57.0)).is_none());
    }

    /// observations-35 row 15 (bankofamerica.com 219458): a collapsed sign-in
    /// form parked at `z-index: -1` under the hero photo. The headline on the
    /// photo answers the label's points, and the stack shows the photo
    /// between the two.
    #[test]
    fn text_occlusion_skips_a_victim_buried_under_the_layer_the_answer_lies_on() {
        let run = |between: &str| {
            let mut d = FakeDom::new();
            let (_h, body) = d.with_page();
            let hero = d.add(Some(body), "div");
            d.set_styles(hero, PROBE_BASE);
            d.set_style(hero, "position", "relative");
            d.set_rect(hero, 0.0, 135.0, 390.0, 600.0);
            let form = d.add(Some(hero), "div");
            d.set_styles(form, PROBE_BASE);
            d.set_style(form, "position", "absolute");
            d.set_rect(form, 10.0, 135.0, 96.0, 600.0);
            let label = d.add(Some(form), "label");
            d.set_styles(label, PROBE_BASE);
            d.set_rect(label, 26.0, 167.0, 64.0, 20.0);
            d.set_text_rect(label, 26.0, 169.0, 45.0, 16.0);
            d.add_text(label, "User ID");
            let photo = d.add(Some(hero), "img");
            d.set_styles(photo, PROBE_BASE);
            d.set_rect(photo, 0.0, 135.0, 390.0, 600.0);
            let headline = d.add(Some(hero), "h2");
            d.set_styles(headline, PROBE_BASE);
            d.set_style(headline, "fontSize", "32px");
            d.set_rect(headline, 13.0, 149.0, 339.0, 75.0);
            d.set_text_rect(headline, 13.0, 148.0, 282.0, 75.0);
            d.add_text(headline, "Bank on your terms");
            let stack = match between {
                "photo" => vec![headline, photo, hero, label, form, body],
                "ancestor" => {
                    d.set_style(hero, "backgroundColor", "rgb(255, 255, 255)");
                    vec![headline, hero, label, form, body]
                }
                "none" => vec![headline, label, form, hero, body],
                _ => Vec::new(),
            };
            for (x, y) in occlusion_probe_points(&d.rect(label), 1280.0, 800.0) {
                if stack.is_empty() {
                    d.set_point(x, y, vec![headline]);
                } else {
                    d.set_point(x, y, stack.clone());
                }
            }
            mark_body_descendants(&mut d);
            check_text_occlusion_dom(&d).len()
        };
        assert_eq!(run("photo"), 0, "a picture between the headline and the label");
        assert_eq!(run("ancestor"), 0, "the label's own container paints over it");
        assert_eq!(run("none"), 1, "the headline lies on the label itself");
        assert_eq!(run("unlisted"), 1, "a stack that does not place the label");
    }

    /// v0-dashboard-ui-redesign-nine.vercel.app capture 3762: a mobile
    /// sidebar leaks under the page header, and its block label "Menu" lies
    /// wholly under the heading "Team". Both boxes are far wider than their
    /// words, and the grid spans the label's box; where the two words' glyphs
    /// meet, the heading counts at every point it answers, or the label would
    /// score only the share of its box the heading's glyphs cross.
    #[test]
    fn text_occlusion_counts_a_heading_over_a_wide_label_where_their_glyphs_meet() {
        let run = |menu_glyphs: Option<(f64, f64)>| {
            let mut d = FakeDom::new();
            let (_h, body) = d.with_page();
            let aside = d.add(Some(body), "aside");
            d.set_styles(aside, PROBE_BASE);
            d.set_style(aside, "position", "absolute");
            d.set_rect(aside, 0.0, 0.0, 240.0, 400.0);
            let menu = d.add(Some(aside), "p");
            d.set_styles(menu, PROBE_BASE);
            d.set_rect(menu, 16.0, 72.0, 223.0, 15.0);
            d.add_text(menu, "Menu");
            if let Some((x, w)) = menu_glyphs {
                d.set_text_rect(menu, x, 73.0, w, 12.0);
            }
            let main = d.add(Some(body), "main");
            d.set_styles(main, PROBE_BASE);
            d.set_style(main, "position", "relative");
            d.set_rect(main, 0.0, 0.0, 390.0, 400.0);
            let h1 = d.add(Some(main), "h1");
            d.set_styles(h1, PROBE_BASE);
            d.set_rect(h1, 16.0, 64.0, 358.0, 28.0);
            d.add_text(h1, "Team");
            d.set_text_rect(h1, 16.0, 66.0, 51.0, 23.0);
            mark_body_descendants(&mut d);
            check_text_occlusion_dom(&d)
        };
        // The label's glyphs lie under the heading's.
        let f = run(Some((16.0, 32.0)));
        assert_eq!(f.len(), 1, "{f:?}");
        assert!(f[0].finding.detail.contains("100% covered by overlapping text"), "{f:?}");
        // Glyphs clear of the heading's are not covered, however wide the box.
        assert!(run(Some((200.0, 32.0))).is_empty());
        // A label whose glyphs the capture did not record keeps every answer.
        assert_eq!(run(None).len(), 1);
    }

    /// The same capture's "Settings" under a card's h3: the grid's one row
    /// runs through the label's middle, just below the h3's glyph rect, while
    /// the two glyph rects overlap by 6px.
    #[test]
    fn text_occlusion_counts_a_heading_whose_glyphs_meet_the_label_off_the_grid_row() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let nav = d.add(Some(body), "nav");
        d.set_styles(nav, PROBE_BASE);
        d.set_style(nav, "position", "absolute");
        d.set_rect(nav, 0.0, 300.0, 240.0, 100.0);
        let label = d.add(Some(nav), "span");
        d.set_styles(label, PROBE_BASE);
        d.set_rect(label, 52.0, 330.0, 54.9, 20.0);
        d.set_text_rect(label, 52.0, 331.0, 54.9, 17.0);
        d.add_text(label, "Settings");
        let card = d.add(Some(body), "div");
        d.set_styles(card, PROBE_BASE);
        d.set_rect(card, 0.0, 280.0, 390.0, 300.0);
        let h3 = d.add(Some(card), "h3");
        d.set_styles(h3, PROBE_BASE);
        d.set_rect(h3, 41.0, 313.0, 308.0, 28.0);
        d.set_text_rect(h3, 41.0, 316.0, 125.0, 21.0);
        d.add_text(h3, "Alexandra Deff");
        mark_body_descendants(&mut d);
        let f = check_text_occlusion_dom(&d);
        assert_eq!(f.len(), 1, "{f:?}");
        assert!(f[0].finding.detail.contains("100% covered by overlapping text"), "{f:?}");
    }

    /// cnnbrasil.com.br's react-fast-marquee: the track that moves is the
    /// grandparent of the spans the probes answer with.
    #[test]
    fn text_occlusion_skips_answers_inside_a_moving_track() {
        let run = |animation: &str| {
            let mut d = FakeDom::new();
            let (_h, body) = d.with_page();
            let track = d.add(Some(body), "div");
            d.set_styles(track, PROBE_BASE);
            d.set_styles(track, &[("position", "absolute"), ("animationName", animation)]);
            d.set_rect(track, -100.0, 75.0, 2417.0, 16.0);
            let child = d.add(Some(track), "div");
            d.set_styles(child, PROBE_BASE);
            d.set_rect(child, 117.0, 75.0, 167.0, 16.0);
            let under = d.add(Some(child), "span");
            d.set_styles(under, PROBE_BASE);
            d.set_rect(under, 125.0, 75.0, 40.0, 16.0);
            d.add_text(under, "VALE3:");
            let over = d.add(Some(child), "span");
            d.set_styles(over, PROBE_BASE);
            d.set_rect(over, 125.0, 75.0, 60.0, 16.0);
            d.add_text(over, "R$ 73,20");
            mark_body_descendants(&mut d);
            check_text_occlusion_dom(&d)
        };
        assert!(!run("none").is_empty());
        assert!(run("scroll").is_empty());
        assert!(run("rfm-scroll").is_empty());
    }

    /// A page wrapper that names a scroller without moving (`.page-scroller`,
    /// iScroll's `#scroller`) silences nothing under it, and neither does a
    /// ticker track further up than a track sits.
    #[test]
    fn text_occlusion_asks_only_nearby_moving_ancestors() {
        let run = |class: &str, animation: &str, depth: usize| {
            let mut d = FakeDom::new();
            let (_h, body) = d.with_page();
            let wrapper = d.add(Some(body), "div");
            d.set_styles(wrapper, PROBE_BASE);
            d.set_styles(wrapper, &[("position", "relative"), ("animationName", animation)]);
            d.set_attr(wrapper, "class", class);
            d.set_rect(wrapper, 0.0, 0.0, 1280.0, 800.0);
            let mut parent = wrapper;
            for _ in 0..depth {
                let level = d.add(Some(parent), "div");
                d.set_styles(level, PROBE_BASE);
                d.set_rect(level, 0.0, 0.0, 1280.0, 800.0);
                parent = level;
            }
            let under = d.add(Some(parent), "span");
            d.set_styles(under, PROBE_BASE);
            d.set_style(under, "position", "absolute");
            d.set_rect(under, 125.0, 75.0, 60.0, 16.0);
            d.add_text(under, "Opening hours");
            let over = d.add(Some(parent), "span");
            d.set_styles(over, PROBE_BASE);
            d.set_style(over, "position", "absolute");
            d.set_rect(over, 125.0, 75.0, 60.0, 16.0);
            d.add_text(over, "Closed today");
            mark_body_descendants(&mut d);
            check_text_occlusion_dom(&d).len()
        };
        assert_eq!(run("page-scroller", "none", 1), 1);
        assert_eq!(run("marquee", "none", 1), 1);
        assert_eq!(run("marquee", "slide", 1), 0);
        assert_eq!(run("track", "ticker-run", 1), 0);
        assert_eq!(run("track", "ticker-run", 6), 1);
    }

    /// A carousel that advances between the capture and the hit-test answer
    /// puts the next slide's card, wearing this caption's own card classes,
    /// under the probes. That card's captured rect is elsewhere, so the
    /// answer describes a layout the capture never measured and counts for
    /// nothing. The same card at the caption's place is still an occluder.
    #[test]
    fn text_occlusion_ignores_a_box_answered_where_the_capture_did_not_put_it() {
        let run = |card_at: (f64, f64)| {
            let mut d = FakeDom::new();
            let (_h, body) = d.with_page();
            let base = &[("display", "block"), ("visibility", "visible"), ("opacity", "1"), ("contentVisibility", "visible"), ("position", "static"), ("cssFloat", "none"), ("animationName", "none")][..];
            let track = d.add(Some(body), "div");
            d.set_styles(track, base);
            d.set_rect(track, 0.0, 0.0, 1280.0, 400.0);
            let own_card = d.add(Some(track), "div");
            d.set_attr(own_card, "class", "card");
            d.set_styles(own_card, base);
            d.set_styles(own_card, &[("backgroundColor", "rgb(255, 255, 255)")]);
            d.set_rect(own_card, 96.0, 84.0, 488.0, 116.0);
            let caption = d.add(Some(own_card), "div");
            d.set_attr(caption, "class", "caption");
            d.add_text(caption, "The newest issue is out on the eighth");
            d.set_styles(caption, base);
            d.set_rect(caption, 110.0, 98.0, 460.0, 48.0);
            let next_card = d.add(Some(track), "div");
            d.set_attr(next_card, "class", "card");
            d.set_styles(next_card, base);
            d.set_styles(next_card, &[("backgroundColor", "rgb(255, 255, 255)")]);
            d.set_rect(next_card, card_at.0, card_at.1, 488.0, 116.0);
            mark_body_descendants(&mut d);
            let rect = d.rect(caption);
            for (x, y) in occlusion_probe_points(&rect, 1280.0, 800.0) {
                d.set_point(x, y, vec![next_card, track, body]);
            }
            check_text_occlusion_dom(&d)
        };
        assert!(run((632.0, 84.0)).is_empty(), "{:?}", run((632.0, 84.0)));
        let f = run((96.0, 84.0));
        assert_eq!(f.len(), 1, "{f:?}");
        assert!(f[0].finding.detail.contains("is 100% covered by an opaque element"), "{f:?}");
    }

    const OCCLUSION_BASE: &[(&str, &str)] = &[
        ("display", "block"),
        ("visibility", "visible"),
        ("opacity", "1"),
        ("contentVisibility", "visible"),
        ("position", "static"),
        ("cssFloat", "none"),
        ("animationName", "none"),
    ];

    /// demotv.lol: the items of a menu inside a closed `<details>` keep their
    /// layout, so they have boxes, but Chrome hides them on
    /// `::details-content`, which no ancestor style shows. checkVisibility()
    /// answers false. The items cover nothing, and nothing covers them.
    #[test]
    fn text_occlusion_skips_text_the_capture_did_not_paint() {
        let run = |menu_open: bool| {
            let mut d = FakeDom::new();
            let (_h, body) = d.with_page();
            let headline = d.add(Some(body), "h1");
            d.add_text(headline, "Watch demos");
            d.set_styles(headline, OCCLUSION_BASE);
            d.set_rect(headline, 40.0, 100.0, 500.0, 60.0);
            let menu = d.add(Some(body), "div");
            d.set_styles(menu, OCCLUSION_BASE);
            d.set_style(menu, "position", "absolute");
            d.set_rect(menu, 40.0, 100.0, 500.0, 60.0);
            let item = d.add(Some(menu), "a");
            d.add_text(item, "Bring your demo to your site");
            d.set_styles(item, OCCLUSION_BASE);
            d.set_rect(item, 40.0, 100.0, 500.0, 60.0);
            if !menu_open {
                d.el_mut(menu).check_visibility = Some(false);
                d.el_mut(item).check_visibility = Some(false);
            }
            mark_body_descendants(&mut d);
            // The page answers with the headline under the closed menu.
            for (x, y) in occlusion_probe_points(&d.rect(item), 1280.0, 800.0) {
                d.set_point(x, y, vec![headline, body]);
            }
            (check_text_occlusion_dom(&d), item)
        };
        let (open, item) = run(true);
        assert!(open.iter().any(|f| f.el == Some(item)), "{open:?}");
        let (closed, _) = run(false);
        assert!(closed.is_empty(), "{closed:?}");
    }

    /// schlittermann.de: `a.logo` sets "Schlittermann" again, in the same
    /// face and size, exactly over the first word of `span.logo2`.
    #[test]
    fn text_occlusion_skips_an_exact_overprint() {
        const GLYPHS: &[(&str, &str)] = &[
            ("fontWeight", "400"),
            ("fontStyle", "normal"),
            ("fontStretch", "100%"),
            ("fontVariantCaps", "normal"),
            ("fontFeatureSettings", "normal"),
            ("letterSpacing", "normal"),
            ("wordSpacing", "0px"),
            ("textTransform", "none"),
        ];
        let run_with = |shift: f64, size: &str, extra: &[(&str, &str)]| {
            let mut d = FakeDom::new();
            let (_h, body) = d.with_page();
            let tagline = d.add(Some(body), "span");
            d.set_styles(tagline, PROBE_BASE);
            d.set_styles(tagline, &[("position", "absolute"), ("fontSize", "52px"), ("fontFamily", "Arial")]);
            d.set_styles(tagline, GLYPHS);
            d.set_rect(tagline, 190.0, 80.0, 777.0, 60.0);
            d.set_text_rect(tagline, 190.0, 81.0, 442.0, 58.0);
            d.add_text(tagline, "Schlittermann");
            let logo = d.add(Some(body), "a");
            d.set_styles(logo, PROBE_BASE);
            d.set_styles(logo, GLYPHS);
            d.set_styles(logo, &[("position", "absolute"), ("fontSize", size), ("fontFamily", "Arial")]);
            d.set_styles(logo, extra);
            d.set_rect(logo, 190.0 + shift, 80.0, 442.0, 60.0);
            d.set_text_rect(logo, 190.0 + shift, 81.0, 442.0, 58.0);
            d.add_text(logo, "Schlittermann");
            mark_body_descendants(&mut d);
            check_text_occlusion_dom(&d)
        };
        let run = |shift: f64, size: &str| run_with(shift, size, &[]);
        assert!(run(0.0, "52px").is_empty());
        // Moved off the origin, or set at another size, the logo collides.
        assert_eq!(run(30.0, "52px").len(), 1);
        assert_eq!(run(0.0, "48px").len(), 1);
        // Upper-cased, the same DOM text draws other glyphs.
        assert_eq!(run_with(0.0, "52px", &[("textTransform", "uppercase")]).len(), 1);
        // A glyph property the capture did not record is unknown.
        assert_eq!(run_with(0.0, "52px", &[("wordSpacing", "")]).len(), 1);
    }

    /// v0-orbit-internal-app: a KPI label clipped by its squeezed card to the
    /// 6px left on screen, covered by the next card. A reader meets none of
    /// it; with most of the label on screen the collision is real.
    #[test]
    fn text_occlusion_needs_the_victims_visible_share() {
        let run = |card_width: f64| {
            let mut d = FakeDom::new();
            let (_h, body) = d.with_page();
            let card = d.add(Some(body), "div");
            d.set_styles(card, OCCLUSION_BASE);
            d.set_styles(card, &[("position", "relative"), ("overflow", "hidden"), ("overflowX", "hidden"), ("overflowY", "hidden")]);
            d.set_rect(card, 384.0, 260.0, card_width, 80.0);
            let label = d.add(Some(card), "span");
            d.set_styles(label, OCCLUSION_BASE);
            d.set_rect(label, 384.0, 271.0, 60.0, 50.0);
            d.add_text(label, "Total Book of Business");
            let next = d.add(Some(body), "div");
            d.set_styles(next, OCCLUSION_BASE);
            d.set_styles(next, &[("position", "relative"), ("backgroundColor", "rgb(255, 255, 255)")]);
            // The grid squeezes the card under its neighbour, which is laid
            // over the label.
            d.set_rect(next, 384.0, 260.0, 300.0, 80.0);
            mark_body_descendants(&mut d);
            for (x, y) in occlusion_probe_points(&d.rect(label), 1280.0, 800.0) {
                d.set_point(x, y, vec![next, body]);
            }
            (check_text_occlusion_dom(&d), label)
        };
        let (sliver, _) = run(6.0);
        assert!(sliver.is_empty(), "{sliver:?}");
        let (shown, label) = run(40.0);
        assert!(shown.iter().any(|f| f.el == Some(label)), "{shown:?}");
    }

    #[test]
    fn text_occlusion_overhang_needs_a_painted_card() {
        let run = |card_painted: bool| {
            let mut d = FakeDom::new();
            let (_h, body) = d.with_page();
            let title = d.add(Some(body), "h1");
            d.add_text(title, "Watch demos");
            d.set_styles(title, OCCLUSION_BASE);
            d.set_styles(title, &[("fontSize", "48px"), ("lineHeight", "56px")]);
            d.set_rect(title, 32.0, 318.0, 200.0, 56.0);
            let card = d.add(Some(body), "div");
            d.set_styles(card, OCCLUSION_BASE);
            d.set_styles(
                card,
                &[("position", "absolute"), ("backgroundColor", "rgb(255, 255, 255)"), ("borderTopWidth", "1px")],
            );
            d.set_rect(card, 150.0, 300.0, 300.0, 200.0);
            if !card_painted {
                d.el_mut(card).check_visibility = Some(false);
            }
            mark_body_descendants(&mut d);
            for (x, y) in occlusion_probe_points(&d.rect(title), 1280.0, 800.0) {
                d.set_point(x, y, vec![title, body]);
            }
            check_text_occlusion_dom(&d)
        };
        let shown = run(true);
        assert_eq!(shown.len(), 1, "{shown:?}");
        assert!(shown[0].finding.detail.contains("overhangs div by 82px"), "{shown:?}");
        assert!(run(false).is_empty());
    }

    /// Covered text on an opaque box, a border-only field and an SVG shape;
    /// the same text blurred behind a gate, and one emoji.
    #[test]
    fn text_occlusion_skips_illegible_text_and_names_what_covers_it() {
        #[derive(Clone, Copy)]
        enum Cover {
            Fill,
            Border,
            Svg,
        }
        let run = |text: &str, blur: &str, cover: Cover| {
            let mut d = FakeDom::new();
            let (_h, body) = d.with_page();
            let wrap = d.add(Some(body), "div");
            d.set_styles(wrap, OCCLUSION_BASE);
            d.set_style(wrap, "filter", blur);
            d.set_rect(wrap, 40.0, 100.0, 240.0, 24.0);
            let copy = d.add(Some(wrap), "p");
            d.set_attr(copy, "class", "copy");
            d.add_text(copy, text);
            d.set_styles(copy, OCCLUSION_BASE);
            d.set_rect(copy, 40.0, 100.0, 240.0, 24.0);
            let top = match cover {
                Cover::Fill | Cover::Border => {
                    let el = d.add(Some(body), "div");
                    d.set_attr(el, "class", "cover");
                    d.set_styles(el, OCCLUSION_BASE);
                    d.set_style(el, "position", "absolute");
                    if matches!(cover, Cover::Fill) {
                        d.set_style(el, "backgroundColor", "rgb(31, 122, 61)");
                    } else {
                        d.set_style(el, "backgroundColor", "rgba(0, 0, 0, 0)");
                        for side in ["Top", "Right", "Bottom", "Left"] {
                            d.set_style(el, &format!("border{side}Width"), "1px");
                            d.set_style(el, &format!("border{side}Color"), "rgb(153, 153, 153)");
                        }
                    }
                    d.set_rect(el, 30.0, 90.0, 280.0, 44.0);
                    el
                }
                Cover::Svg => {
                    let svg = d.add(Some(body), "svg");
                    d.set_styles(svg, OCCLUSION_BASE);
                    d.set_style(svg, "position", "absolute");
                    d.set_rect(svg, 30.0, 90.0, 280.0, 44.0);
                    let shape = d.add(Some(svg), "rect");
                    d.set_styles(shape, OCCLUSION_BASE);
                    d.set_rect(shape, 30.0, 90.0, 280.0, 44.0);
                    shape
                }
            };
            mark_body_descendants(&mut d);
            for (x, y) in occlusion_probe_points(&d.rect(copy), 1280.0, 800.0) {
                d.set_point(x, y, vec![top, body]);
            }
            check_text_occlusion_dom(&d).into_iter().map(|f| f.finding.detail).collect::<Vec<_>>()
        };
        assert_eq!(
            run("Palais Garnier, Paris", "none", Cover::Fill),
            vec!["p.copy \"Palais Garnier, Paris\" is 100% covered by an opaque element (div.cover)"]
        );
        assert_eq!(
            run("Calendar", "none", Cover::Border),
            vec!["p.copy \"Calendar\" is 100% covered by a bordered element (div.cover)"]
        );
        assert_eq!(run("Team", "none", Cover::Svg), vec!["p.copy \"Team\" is 100% covered by an SVG graphic (rect)"]);
        // Blurred past reading, under a gate.
        assert!(run("Palais Garnier, Paris", "blur(12px)", Cover::Fill).is_empty());
        // A soft blur still reads.
        assert_eq!(run("Palais Garnier, Paris", "blur(2px)", Cover::Fill).len(), 1);
        // One emoji is one character; two letters are two.
        assert!(run("\u{1F3AF}", "none", Cover::Fill).is_empty());
        assert_eq!(run("Go", "none", Cover::Fill).len(), 1);
    }

    #[test]
    fn characters_on_screen() {
        for one in ["\u{1F3AF}", "\u{1F44D}\u{1F3FD}", "\u{1F1EF}\u{1F1F5}", "e\u{301}", "\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}", "\u{2764}\u{FE0F}", "x"] {
            assert!(fewer_characters_than(one, 2), "{one:?}");
        }
        for two in ["Go", "\u{1F1EF}\u{1F1F5}\u{1F1E9}\u{1F1EA}", "\u{1F3AF}\u{1F3AF}", "\u{AC00}\u{AC01}", "a\u{301}b"] {
            assert!(!fewer_characters_than(two, 2), "{two:?}");
        }
    }

    /// A link in a closed <details> keeps its rect but paints nothing; the
    /// hero text behind it must not read as covering it.
    #[test]
    fn text_occlusion_skips_content_the_browser_reports_unpainted() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let base = &[("display", "block"), ("visibility", "visible"), ("opacity", "1"), ("contentVisibility", "visible"), ("position", "static"), ("cssFloat", "none"), ("animationName", "none")][..];
        let details = d.add(Some(body), "details");
        d.set_styles(details, base);
        let link = d.add(Some(details), "a");
        d.add_text(link, "Documentation");
        d.set_styles(link, base);
        d.set_style(link, "position", "absolute");
        d.set_rect(link, 100.0, 100.0, 240.0, 28.0);
        let h1 = d.add(Some(body), "h1");
        d.add_text(h1, "Hero headline");
        d.set_styles(h1, base);
        d.set_rect(h1, 100.0, 100.0, 240.0, 28.0);
        mark_body_descendants(&mut d);

        d.el_mut(link).check_visibility = Some(false);
        assert!(check_text_occlusion_dom(&d).is_empty());

        d.el_mut(link).check_visibility = Some(true);
        let f = check_text_occlusion_dom(&d);
        assert_eq!(f.len(), 1, "{f:?}");
        assert_eq!(f[0].el, Some(link));
    }

    #[test]
    fn first_viewport_column_overflow() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let grid = d.add(Some(body), "section");
        d.set_attr(grid, "class", "hero");
        d.set_styles(grid, &[("display", "grid")]);
        d.set_rect(grid, 0.0, 0.0, 1280.0, 1400.0);
        let a = d.add(Some(grid), "div");
        d.set_styles(a, &[("display", "block"), ("position", "static")]);
        d.set_rect(a, 0.0, 0.0, 640.0, 1400.0);
        let a_in = d.add(Some(a), "p");
        d.set_styles(a_in, &[("display", "block"), ("position", "static"), ("visibility", "visible")]);
        d.set_rect(a_in, 0.0, 0.0, 600.0, 1300.0);
        let b = d.add(Some(grid), "div");
        d.set_styles(b, &[("display", "block"), ("position", "static")]);
        d.set_rect(b, 640.0, 0.0, 640.0, 1400.0);
        let b_in = d.add(Some(b), "p");
        d.set_styles(b_in, &[("display", "block"), ("position", "static"), ("visibility", "visible")]);
        d.set_rect(b_in, 640.0, 0.0, 600.0, 300.0);
        mark_body_descendants(&mut d);
        let f = check_first_viewport_column_overflow_dom(&d);
        assert_eq!(f.len(), 1, "{f:?}");
        assert_eq!(
            f[0].finding.detail,
            format!(
                "{} opens the page with one column running 163% of the viewport tall while a sibling fits in 38% — the fold falls deep inside the section",
                class_selector(&d, grid)
            )
        );
        d.set_rect(b_in, 640.0, 0.0, 600.0, 900.0);
        assert!(check_first_viewport_column_overflow_dom(&d).is_empty());

        // observations-28 row 27: the tall column's box scrolls its content
        // at 700px (cuisineactuelle.fr's tile list), so it ends where it is
        // clipped, and the short column is short again.
        d.set_rect(b_in, 640.0, 0.0, 600.0, 300.0);
        d.set_styles(a, &[("overflowY", "auto")]);
        d.set_rect(a, 0.0, 0.0, 640.0, 700.0);
        assert!(check_first_viewport_column_overflow_dom(&d).is_empty(), "clipped at 700px");
        d.set_styles(a, &[("overflowY", "visible")]);
        assert_eq!(check_first_viewport_column_overflow_dom(&d).len(), 1, "unclipped");
    }

    /// observations-35 row 15 (submitmap.com 216883): `flex-col lg:flex-row`
    /// at a phone width stacks a short header block over a long list. Boxes
    /// that share an x range are not columns.
    #[test]
    fn first_viewport_column_overflow_needs_columns_side_by_side() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        d.inner_width = 390.0;
        let stack = d.add(Some(body), "div");
        d.set_styles(stack, &[("display", "flex")]);
        d.set_rect(stack, 0.0, 65.0, 390.0, 4600.0);
        let block = |d: &mut FakeDom, rect: (f64, f64, f64, f64), content_h: f64| {
            let col = d.add(Some(stack), "div");
            d.set_styles(col, &[("display", "block"), ("position", "static")]);
            d.set_rect(col, rect.0, rect.1, rect.2, rect.3);
            let inner = d.add(Some(col), "p");
            d.set_styles(inner, &[("display", "block"), ("position", "static"), ("visibility", "visible")]);
            d.set_rect(inner, rect.0, rect.1, rect.2, content_h);
            col
        };
        let intro = block(&mut d, (20.0, 100.0, 350.0, 44.0), 40.0);
        let list = block(&mut d, (20.0, 176.0, 350.0, 4200.0), 4160.0);
        mark_body_descendants(&mut d);
        assert!(check_first_viewport_column_overflow_dom(&d).is_empty(), "stacked");
        // The same two boxes side by side are columns.
        d.inner_width = 1280.0;
        d.set_rect(stack, 0.0, 65.0, 1280.0, 4600.0);
        d.set_rect(intro, 20.0, 100.0, 400.0, 44.0);
        d.set_rect(list, 440.0, 100.0, 800.0, 4200.0);
        assert_eq!(check_first_viewport_column_overflow_dom(&d).len(), 1, "side by side");
        // A short block stacked under the tall column, in its track, does
        // not hide the column beside it.
        let _extra = block(&mut d, (440.0, 120.0, 800.0, 30.0), 24.0);
        assert_eq!(check_first_viewport_column_overflow_dom(&d).len(), 1, "a short block in the tall track");
    }

    /// cisco.com and picomq.com: a tab list, a collapsed panel and an outline
    /// drawn by fixed layers are not columns the fold falls in.
    #[test]
    fn first_viewport_column_overflow_skips_rails_and_empty_columns() {
        fn build(role: Option<&str>, empty: bool, sticky: bool) -> usize {
            let mut d = FakeDom::new();
            let (_h, body) = d.with_page();
            let grid = d.add(Some(body), "section");
            d.set_styles(grid, &[("display", "grid")]);
            d.set_rect(grid, 0.0, 0.0, 1280.0, 1400.0);
            let a = d.add(Some(grid), "div");
            d.set_styles(a, &[("display", "block"), ("position", "static")]);
            d.set_rect(a, 0.0, 0.0, 640.0, 1400.0);
            let a_in = d.add(Some(a), "p");
            d.set_styles(a_in, &[("display", "block"), ("position", "static"), ("visibility", "visible")]);
            d.set_rect(a_in, 0.0, 0.0, 600.0, 1300.0);
            let b = d.add(Some(grid), "div");
            d.set_styles(b, &[("display", "block"), ("position", if sticky { "sticky" } else { "static" })]);
            if let Some(role) = role {
                d.set_attr(b, "role", role);
            }
            d.set_rect(b, 640.0, 0.0, 640.0, 1400.0);
            let b_in = d.add(Some(b), "p");
            d.set_styles(
                b_in,
                &[("display", "block"), ("position", if empty { "fixed" } else { "static" }), ("visibility", "visible")],
            );
            d.set_rect(b_in, 640.0, 0.0, 600.0, 300.0);
            if empty {
                // The outline's items sit in flow inside the fixed layer.
                let item = d.add(Some(b_in), "p");
                d.set_styles(item, &[("display", "block"), ("position", "static"), ("visibility", "visible")]);
                d.set_rect(item, 1024.0, 0.0, 224.0, 700.0);
            }
            mark_body_descendants(&mut d);
            check_first_viewport_column_overflow_dom(&d).len()
        }
        assert_eq!(build(None, false, false), 1);
        assert_eq!(build(Some("tablist"), false, false), 0);
        assert_eq!(build(Some("navigation"), false, false), 0);
        assert_eq!(build(None, true, false), 0);
        assert_eq!(build(None, false, true), 0);
    }

    /// observations-42 row 6: freddiemac.com's FAQ column of closed
    /// `<details>` still reports its answers at full height, and
    /// fanniemae.com's section menu is a sidebar of links with no `nav`.
    #[test]
    fn first_viewport_column_overflow_reads_closed_details_and_link_rails() {
        fn build(tall: &str, short: &str) -> usize {
            let mut d = FakeDom::new();
            let (_h, body) = d.with_page();
            let grid = d.add(Some(body), "section");
            d.set_styles(grid, &[("display", "grid")]);
            d.set_rect(grid, 0.0, 0.0, 1280.0, 1400.0);
            let col = |d: &mut FakeDom, x: f64| {
                let c = d.add(Some(grid), "div");
                d.set_styles(c, &[("display", "block"), ("position", "static")]);
                d.set_rect(c, x, 0.0, 640.0, 1400.0);
                c
            };
            let block = |d: &mut FakeDom, parent: ElId, tag: &str, rect: (f64, f64, f64, f64), text: &str| {
                let e = d.add(Some(parent), tag);
                d.set_styles(e, &[("display", "block"), ("position", "static"), ("visibility", "visible")]);
                d.set_rect(e, rect.0, rect.1, rect.2, rect.3);
                if !text.is_empty() {
                    d.add_text(e, text);
                }
                e
            };
            let a = col(&mut d, 0.0);
            match tall {
                "details" | "open" => {
                    let det = block(&mut d, a, "details", (0.0, 0.0, 600.0, 44.0), "");
                    if tall == "open" {
                        d.set_attr(det, "open", "");
                    }
                    block(&mut d, det, "summary", (0.0, 0.0, 600.0, 43.0), "How do I contact investor relations?");
                    let answer = block(&mut d, det, "div", (0.0, 44.0, 600.0, 1250.0), "");
                    block(&mut d, answer, "p", (0.0, 44.0, 600.0, 1250.0), "If you are an investor, write to us.");
                }
                _ => {
                    block(&mut d, a, "p", (0.0, 0.0, 600.0, 1300.0), "A long column of copy.");
                }
            }
            let b = col(&mut d, 640.0);
            match short {
                "hidden-menu" => {
                    // Copy, and a closed menu of links nobody sees.
                    block(&mut d, b, "p", (640.0, 0.0, 600.0, 200.0), "A short column of copy that a reader reads.");
                    let menu = block(&mut d, b, "ul", (640.0, 200.0, 600.0, 100.0), "");
                    for label in ["Who We Are", "Leadership", "Careers", "Newsroom", "Investors", "Contact"] {
                        let a = block(&mut d, menu, "a", (640.0, 200.0, 200.0, 24.0), label);
                        d.el_mut(a).check_visibility = Some(false);
                    }
                }
                "links" | "prose" => {
                    let ul = block(&mut d, b, "ul", (640.0, 0.0, 600.0, 300.0), "");
                    for (i, label) in ["Who We Are", "Leadership", "Careers", "News"].iter().enumerate() {
                        let li = block(&mut d, ul, "li", (640.0, i as f64 * 40.0, 600.0, 40.0), "");
                        if short == "links" {
                            block(&mut d, li, "a", (640.0, i as f64 * 40.0, 200.0, 24.0), label);
                        } else {
                            d.add_text(li, label);
                        }
                    }
                }
                _ => {
                    block(&mut d, b, "p", (640.0, 0.0, 600.0, 300.0), "A short column.");
                }
            }
            mark_body_descendants(&mut d);
            check_first_viewport_column_overflow_dom(&d).len()
        }
        assert_eq!(build("open", "prose"), 1, "an open disclosure shows its answer");
        assert_eq!(build("details", "prose"), 0, "a closed one shows its summary");
        assert_eq!(build("copy", "prose"), 1, "a short list of items");
        assert_eq!(build("copy", "links"), 0, "a list of links is a menu");
        assert_eq!(build("copy", "hidden-menu"), 1, "copy beside a hidden menu");
    }

    /// observations-42 row 13. nemonix.app: a padded inline button alone in
    /// its line hangs past the line onto nothing. The fill's overhang, not
    /// its whole height, is what the finding prints.
    #[test]
    fn text_occlusion_inline_leak_needs_something_to_cover() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let wrap = d.add(Some(body), "div");
        d.set_styles(wrap, PROBE_BASE);
        d.set_rect(wrap, 0.0, 100.0, 1056.0, 25.6);
        let btn = d.add(Some(wrap), "a");
        d.add_text(btn, "Share your feedback");
        d.set_attr(btn, "class", "btn-lg");
        d.set_styles(btn, PROBE_BASE);
        d.set_styles(
            btn,
            &[
                ("display", "inline"),
                ("backgroundColor", "rgb(19, 21, 28)"),
                ("paddingTop", "15px"),
                ("paddingBottom", "15px"),
                ("fontSize", "14px"),
                ("lineHeight", "22.4px"),
            ],
        );
        d.set_rect(btn, 427.0, 88.0, 201.0, 50.0);
        mark_body_descendants(&mut d);
        assert!(check_text_occlusion_dom(&d).iter().all(|f| f.el != Some(btn)), "nothing beside it");
    }

    /// observations-42 row 13, verizon.com: a sticker overlaps the empty end
    /// of a wrapped paragraph's box, past the words. Points off every line
    /// are not probed.
    #[test]
    fn text_occlusion_probes_only_where_the_lines_are() {
        let run = |lines: bool| {
            let mut d = FakeDom::new();
            let (_h, body) = d.with_page();
            let p = d.add(Some(body), "p");
            d.add_text(p, "After AutoPay and $15/mo switch discount");
            d.set_attr(p, "class", "micro");
            d.set_styles(p, PROBE_BASE);
            d.set_styles(p, &[("fontSize", "11px"), ("lineHeight", "16px")]);
            d.set_rect(p, 36.0, 533.0, 338.0, 48.0);
            if lines {
                d.set_text_lines(p, &[(36.0, 534.0, 102.0, 13.0), (36.0, 550.0, 136.5, 13.0), (36.0, 566.0, 112.7, 13.0)]);
            }
            let sticker = d.add(Some(body), "div");
            d.set_attr(sticker, "class", "circle");
            d.set_styles(sticker, PROBE_BASE);
            d.set_styles(sticker, &[("position", "absolute"), ("backgroundColor", "rgb(248, 255, 60)")]);
            d.set_rect(sticker, 183.0, 503.0, 195.0, 195.0);
            mark_body_descendants(&mut d);
            check_text_occlusion_dom(&d).into_iter().filter(|f| f.el == Some(p)).count()
        };
        assert_eq!(run(false), 1, "the box, as before");
        assert_eq!(run(true), 0, "the lines end before the sticker");

        // One centred line in a tall box, between the grid's rows: no point
        // lands on it, and the whole grid stands.
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let label = d.add(Some(body), "div");
        d.add_text(label, "Covered label");
        d.set_styles(label, PROBE_BASE);
        d.set_rect(label, 40.0, 100.0, 200.0, 120.0);
        d.set_text_lines(label, &[(40.0, 151.0, 200.0, 18.0)]);
        let cover = d.add(Some(body), "div");
        d.set_styles(cover, PROBE_BASE);
        d.set_styles(cover, &[("position", "absolute"), ("backgroundColor", "rgb(20, 20, 20)")]);
        d.set_rect(cover, 40.0, 100.0, 200.0, 120.0);
        mark_body_descendants(&mut d);
        assert_eq!(check_text_occlusion_dom(&d).iter().filter(|f| f.el == Some(label)).count(), 1);
    }

    /// observations-42 row 13, lance.com.br: a strip that scrolls sideways
    /// carries a "next" arrow at its right end, the height of the strip,
    /// over the card that peeks out under it.
    #[test]
    fn text_occlusion_skips_a_scrollers_paging_arrow() {
        let run = |position: &str, height: f64, scroll_width: f64| {
            let mut d = FakeDom::new();
            let (_h, body) = d.with_page();
            let section = d.add(Some(body), "section");
            d.set_styles(section, PROBE_BASE);
            d.set_rect(section, 0.0, 54.0, 1280.0, 154.0);
            let strip = d.add(Some(section), "div");
            d.set_styles(strip, PROBE_BASE);
            d.set_styles(strip, &[("overflowX", "scroll")]);
            d.set_rect(strip, 208.0, 54.0, 1072.0, 154.0);
            d.el_mut(strip).client_width = 1072.0;
            d.el_mut(strip).scroll_width = scroll_width;
            let card = d.add(Some(strip), "span");
            d.add_text(card, "UEFA Nations League");
            d.set_styles(card, PROBE_BASE);
            d.set_rect(card, 1200.0, 70.0, 160.0, 20.0);
            let arrow = d.add(Some(section), "button");
            d.set_attr(arrow, "class", "next");
            d.set_styles(arrow, PROBE_BASE);
            d.set_styles(arrow, &[("position", position), ("backgroundColor", "rgb(245, 245, 245)")]);
            d.set_rect(arrow, 1240.0, 54.0, 40.0, height);
            mark_body_descendants(&mut d);
            check_text_occlusion_dom(&d).into_iter().filter(|f| f.el == Some(card)).count()
        };
        assert_eq!(run("absolute", 154.0, 1400.0), 0, "the strip's own arrow");
        assert_eq!(run("absolute", 40.0, 1400.0), 1, "a small box over the card");
        assert_eq!(run("absolute", 154.0, 1072.0), 1, "a strip with nothing to page to");
    }

    /// observations-42 row 17, suitemigration.com: a probe over a stacked
    /// card answers with the front card's own text; the finding names the
    /// card that covers the victim as well.
    #[test]
    fn text_occlusion_names_the_layer_that_covers_the_text() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let deck = d.add(Some(body), "div");
        d.set_styles(deck, PROBE_BASE);
        d.set_styles(deck, &[("position", "relative")]);
        d.set_rect(deck, 0.0, 100.0, 600.0, 400.0);
        let back = d.add(Some(deck), "div");
        d.set_styles(back, PROBE_BASE);
        d.set_styles(back, &[("position", "absolute"), ("backgroundColor", "rgb(255, 255, 255)")]);
        d.set_rect(back, 0.0, 100.0, 400.0, 300.0);
        let victim = d.add(Some(back), "span");
        d.add_text(victim, "Needs attention");
        d.set_attr(victim, "class", "status");
        d.set_styles(victim, PROBE_BASE);
        d.set_rect(victim, 200.0, 200.0, 120.0, 20.0);
        let front = d.add(Some(deck), "div");
        d.set_attr(front, "class", "front-card");
        d.set_styles(front, PROBE_BASE);
        d.set_styles(front, &[("position", "absolute"), ("transform", "rotate(4deg)"), ("backgroundColor", "rgb(255, 255, 255)")]);
        d.set_rect(front, 150.0, 150.0, 400.0, 300.0);
        let row = d.add(Some(front), "span");
        d.add_text(row, "Trial Balance");
        d.set_attr(row, "class", "row-label");
        d.set_styles(row, PROBE_BASE);
        d.set_styles(row, &[("position", "relative")]);
        d.set_rect(row, 190.0, 195.0, 160.0, 30.0);
        d.set_text_rect(row, 190.0, 195.0, 160.0, 30.0);
        mark_body_descendants(&mut d);
        let f = check_text_occlusion_dom(&d);
        let hit = f.iter().find(|f| f.el == Some(victim)).expect("victim reported");
        assert_eq!(
            hit.finding.detail,
            format!(
                "{} \"Needs attention\" is 100% covered by overlapping text ({}) on an opaque layer ({})",
                class_selector(&d, victim),
                class_selector(&d, row),
                class_selector(&d, front)
            )
        );
    }

    fn outlined(d: &mut FakeDom, el: ElId, radius: &str) {
        let mut styles = vec![
            ("borderRadius", radius),
            ("backgroundColor", "rgb(255, 255, 255)"),
            ("backgroundImage", "none"),
            ("boxShadow", "none"),
            ("position", "static"),
        ];
        for side in ["Top", "Right", "Bottom", "Left"] {
            let (w, s, c): (&'static str, &'static str, &'static str) = match side {
                "Top" => ("borderTopWidth", "borderTopStyle", "borderTopColor"),
                "Right" => ("borderRightWidth", "borderRightStyle", "borderRightColor"),
                "Bottom" => ("borderBottomWidth", "borderBottomStyle", "borderBottomColor"),
                _ => ("borderLeftWidth", "borderLeftStyle", "borderLeftColor"),
            };
            styles.push((w, "1px"));
            styles.push((s, "solid"));
            styles.push((c, "rgb(228, 228, 231)"));
        }
        d.set_styles(el, &styles);
    }

    fn outlined_card(d: &mut FakeDom, parent: ElId, rect: (f64, f64, f64, f64)) -> ElId {
        let el = d.add(Some(parent), "div");
        outlined(d, el, "12px");
        d.set_rect(el, rect.0, rect.1, rect.2, rect.3);
        d.set_styles(el, &[("fontSize", "16px"), ("lineHeight", "24px"), ("paddingTop", "16px"), ("paddingBottom", "16px")]);
        d.add_text(el, "An inner card with copy of its own");
        el
    }

    /// auradeballet.com's `border-t` footer, vibe-audit-lab.base44.app's
    /// chips, demotv.lol's eyebrow, veeza.ai's header band, climatempo.com.br's
    /// lip shadow.
    #[test]
    fn nested_cards_read_edges_fills_labels_and_bands() {
        // A section with a top rule only is a divider.
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let band = d.add(Some(body), "footer");
        d.set_styles(
            band,
            &[
                ("borderTopWidth", "1px"),
                ("borderTopStyle", "solid"),
                ("borderTopColor", "rgba(36, 36, 36, 0.5)"),
                ("backgroundColor", "rgb(10, 10, 10)"),
                ("backgroundImage", "none"),
                ("borderRadius", "0px"),
                ("boxShadow", "none"),
            ],
        );
        d.set_rect(band, 0.0, 0.0, 1280.0, 400.0);
        d.add_text(band, "Footer copy longer than ten");
        let inner = outlined_card(&mut d, band, (256.0, 40.0, 768.0, 120.0));
        assert!(check_layout(&d).is_empty(), "a one-sided rule");
        // Outlined on every side and rounded, it is a card.
        outlined(&mut d, band, "16px");
        let f = check_layout(&d);
        assert_eq!(f.len(), 1, "{f:?}");
        assert_eq!(f[0].el, Some(inner));

        // Chips and eyebrows inside a card are labels.
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let card = d.add(Some(body), "div");
        outlined(&mut d, card, "16px");
        d.set_rect(card, 0.0, 0.0, 600.0, 400.0);
        d.add_text(card, "A card with labels in it");
        let label = outlined_card(&mut d, card, (24.0, 24.0, 200.0, 34.0));
        d.set_style(label, "borderRadius", "9999px");
        assert!(check_layout(&d).is_empty(), "a pill");
        d.set_styles(
            label,
            &[
                ("borderRadius", "0px"),
                ("boxShadow", "rgb(89, 219, 234) 3px 3px 0px 0px"),
                ("paddingTop", "5px"),
                ("paddingBottom", "5px"),
                ("lineHeight", "18px"),
            ],
        );
        d.set_rect(label, 24.0, 24.0, 200.0, 30.0);
        assert!(check_layout(&d).is_empty(), "a one-line eyebrow");
        d.set_rect(label, 24.0, 24.0, 200.0, 90.0);
        assert_eq!(check_layout(&d).len(), 1, "a box with room for lines");

        // tempra.framer.website: a filled field around a select inside a form
        // card.
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let form = d.add(Some(body), "form");
        outlined(&mut d, form, "16px");
        d.set_rect(form, 672.0, 7632.0, 528.0, 687.0);
        d.add_text(form, "Book a visit with our team");
        let field = d.add(Some(form), "div");
        d.set_styles(
            field,
            &[
                ("backgroundColor", "rgb(233, 236, 239)"),
                ("backgroundImage", "none"),
                ("borderRadius", "10px"),
                ("boxShadow", "none"),
                ("position", "relative"),
                ("fontSize", "16px"),
                ("lineHeight", "normal"),
            ],
        );
        d.set_rect(field, 692.0, 7978.0, 488.0, 50.0);
        let select = d.add(Some(field), "select");
        let option = d.add(Some(select), "option");
        d.add_text(option, "Air Conditioning Installation");
        assert!(check_layout(&d).is_empty(), "a field box");
        let note = d.add(Some(field), "p");
        d.add_text(note, "Pick the service you need");
        assert!(check_layout(&d).is_empty(), "a fill with no border or shadow (r4-p16)");
        outlined(&mut d, field, "10px");
        assert_eq!(check_layout(&d).len(), 1, "a framed box with content beside the control");

        // clipto.com: a tinted, rounded `<mark>` run; demotv.lol: a bordered
        // frame around a video thumbnail.
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let card = d.add(Some(body), "div");
        outlined(&mut d, card, "16px");
        d.set_rect(card, 0.0, 0.0, 600.0, 400.0);
        d.add_text(card, "Sources linked to their moments");
        let mark = outlined_card(&mut d, card, (24.0, 24.0, 210.0, 90.0));
        d.set_style(mark, "display", "inline");
        assert!(check_layout(&d).is_empty(), "an inline highlight");
        d.set_style(mark, "display", "block");
        assert_eq!(check_layout(&d).len(), 1, "a block box");
        let video = d.add(Some(mark), "video");
        d.set_rect(video, 25.0, 25.0, 208.0, 88.0);
        assert!(check_layout(&d).is_empty(), "a media frame");

        // A band along the card's own edges is part of the card.
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let article = d.add(Some(body), "article");
        outlined(&mut d, article, "24px");
        d.set_rect(article, 32.0, 2423.0, 389.0, 511.0);
        d.add_text(article, "Croatia full service");
        let header = d.add(Some(article), "div");
        d.set_styles(
            header,
            &[
                ("backgroundColor", "rgba(248, 250, 252, 0.8)"),
                ("backgroundImage", "none"),
                ("borderBottomWidth", "1px"),
                ("borderBottomStyle", "solid"),
                ("borderBottomColor", "rgba(2, 6, 23, 0.1)"),
                ("borderRadius", "24px 24px 0px 0px"),
                ("boxShadow", "none"),
                ("position", "static"),
                ("fontSize", "16px"),
                ("lineHeight", "24px"),
            ],
        );
        d.set_rect(header, 33.0, 2424.0, 387.0, 237.0);
        d.add_text(header, "CroatiaFull ServiceMost Popular");
        assert!(check_layout(&d).is_empty(), "a band along the card's edges");
        d.set_rect(header, 49.0, 2440.0, 355.0, 200.0);
        assert_eq!(check_layout(&d).len(), 1, "inset, it is a card of its own");

        // A white box on a white card with a 2px lip draws no second surface.
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let outer = d.add(Some(body), "div");
        d.set_styles(
            outer,
            &[
                ("backgroundColor", "rgb(255, 255, 255)"),
                ("backgroundImage", "none"),
                ("borderRadius", "28px"),
                ("boxShadow", "rgba(0, 0, 0, 0.1) 0px 4px 8px -2px"),
                ("position", "static"),
            ],
        );
        d.set_rect(outer, 312.0, 376.0, 312.0, 456.0);
        d.add_text(outer, "Plano Gratis feita para voce");
        let inner = d.add(Some(outer), "div");
        d.set_styles(
            inner,
            &[
                ("backgroundColor", "rgb(255, 255, 255)"),
                ("backgroundImage", "none"),
                ("borderRadius", "24px"),
                ("boxShadow", "rgba(0, 0, 0, 0.12) 0px 2px 4px -2px"),
                ("position", "static"),
                ("fontSize", "16px"),
                ("lineHeight", "24px"),
            ],
        );
        d.set_rect(inner, 320.0, 384.0, 296.0, 440.0);
        d.add_text(inner, "Feita para voce que precisa");
        assert!(check_layout(&d).is_empty(), "a white box with a lip");
        d.set_style(inner, "boxShadow", "rgba(0, 0, 0, 0.1) 0px 1px 3px 0px");
        assert_eq!(check_layout(&d).len(), 1, "a shadow that draws three edges");
    }

    /// observations-25 P16 and P17: adant.ai's and kraflio.com's chat
    /// bubbles (a fill and a radius, nothing else), hungrygpu.com's chart
    /// figure in its welcome dialog, soc-workflows-ai-cyb-tstb.bolt.host's
    /// sample report, theagenticdatacompany.com's audio sample player.
    #[test]
    fn nested_cards_skip_fill_only_boxes_and_embedded_content() {
        fn page() -> (FakeDom, ElId) {
            let mut d = FakeDom::new();
            let (_h, body) = d.with_page();
            let card = d.add(Some(body), "div");
            outlined(&mut d, card, "16px");
            d.set_style(card, "fontFamily", "Inter, sans-serif");
            d.set_rect(card, 0.0, 0.0, 600.0, 500.0);
            d.add_text(card, "An outer card with copy of its own");
            (d, card)
        }

        // A rounded tint with no border and no shadow is not an inner card.
        let (mut d, card) = page();
        let bubble = outlined_card(&mut d, card, (24.0, 24.0, 400.0, 90.0));
        d.set_style(bubble, "backgroundColor", "rgb(244, 244, 245)");
        for side in ["Top", "Right", "Bottom", "Left"] {
            d.set_style(bubble, &format!("border{side}Width"), "0px");
        }
        assert!(check_layout(&d).is_empty(), "a fill-only box");
        d.set_style(bubble, "borderBottomWidth", "1px");
        assert_eq!(check_layout(&d).len(), 1, "a fill with a border");
        d.set_style(bubble, "borderBottomWidth", "0px");
        d.set_style(bubble, "boxShadow", "rgba(0, 0, 0, 0.1) 0px 1px 3px 0px");
        assert_eq!(check_layout(&d).len(), 1, "a fill with a shadow");
        d.set_style(bubble, "boxShadow", "rgba(0, 0, 0, 0) 0px 1px 3px 0px");
        assert!(check_layout(&d).is_empty(), "a transparent shadow casts nothing");

        // The outer card may be fill-only: the narrowing reads the inner box.
        let (mut d, card) = page();
        for side in ["Top", "Right", "Bottom", "Left"] {
            d.set_style(card, &format!("border{side}Width"), "0px");
        }
        d.set_style(card, "backgroundColor", "rgb(233, 236, 239)");
        outlined_card(&mut d, card, (24.0, 24.0, 400.0, 90.0));
        assert_eq!(check_layout(&d).len(), 1, "a framed box in a fill-only card");

        // A figure: an svg covering 40% or more of the box, with a caption.
        let (mut d, card) = page();
        let figure = outlined_card(&mut d, card, (24.0, 24.0, 474.0, 309.0));
        let svg = d.add(Some(figure), "svg");
        d.set_rect(svg, 38.0, 56.0, 446.0, 168.0);
        assert!(check_layout(&d).is_empty(), "a chart with its caption");
        d.set_rect(svg, 38.0, 56.0, 446.0, 100.0);
        assert_eq!(check_layout(&d).len(), 1, "an illustration beside the copy");
        d.set_rect(svg, 38.0, 56.0, 24.0, 24.0);
        assert_eq!(check_layout(&d).len(), 1, "an icon");
        // Without a caption the svg is the whole box's text: still a card.
        let (mut d, card) = page();
        let figure = d.add(Some(card), "div");
        outlined(&mut d, figure, "12px");
        d.set_rect(figure, 24.0, 24.0, 474.0, 309.0);
        let canvas = d.add(Some(figure), "canvas");
        d.set_rect(canvas, 38.0, 56.0, 446.0, 168.0);
        let label = d.add(Some(canvas), "span");
        d.add_text(label, "A chart drawn on a canvas");
        assert_eq!(check_layout(&d).len(), 1, "a canvas with no caption");
        let caption = d.add(Some(figure), "p");
        d.add_text(caption, "Late 2024 open weights");
        assert!(check_layout(&d).is_empty(), "a canvas with a caption");

        // A monospace output block, unless the outer card is monospace too.
        let (mut d, card) = page();
        let output = outlined_card(&mut d, card, (24.0, 24.0, 500.0, 400.0));
        d.set_style(output, "fontFamily", "\"Courier New\", monospace");
        assert!(check_layout(&d).is_empty(), "a monospace output block");
        d.set_style(card, "fontFamily", "\"JetBrains Mono\", monospace");
        assert_eq!(check_layout(&d).len(), 1, "a card on a monospace page");
        d.set_style(card, "fontFamily", "Inter, sans-serif");
        // dograh.com: a stack of provider rows set in a monospace face, each a
        // block of its own, is ordinary text, not one run of output.
        let (mut d, card) = page();
        let stack = d.add(Some(card), "div");
        outlined(&mut d, stack, "12px");
        d.set_rect(stack, 24.0, 24.0, 500.0, 400.0);
        for name in ["Vertex AI speech to speech", "Deepgram speech to text", "Gemini Flash brain"] {
            let row = d.add(Some(stack), "div");
            d.set_styles(row, &[("display", "flex"), ("fontFamily", "\"JetBrains Mono\", monospace")]);
            d.add_text(row, name);
        }
        assert_eq!(check_layout(&d).len(), 1, "a stack of monospace rows");
        // A terminal: a header line and one paragraph of monospace output
        // with inline links in it.
        let (mut d, card) = page();
        let terminal = d.add(Some(card), "div");
        outlined(&mut d, terminal, "16px");
        d.set_rect(terminal, 24.0, 24.0, 405.0, 160.0);
        let header = d.add(Some(terminal), "div");
        d.set_style(header, "fontFamily", "Inter, sans-serif");
        d.add_text(header, "agent setup");
        let para = d.add(Some(terminal), "p");
        d.set_style(para, "fontFamily", "\"JetBrains Mono\", monospace");
        d.add_text(para, "Signup for an account and get an API key with");
        let link = d.add(Some(para), "a");
        d.set_styles(link, &[("display", "inline"), ("fontFamily", "\"JetBrains Mono\", monospace")]);
        d.add_text(link, "context.dev/auth.md");
        d.add_text(para, "then follow the quickstart to integrate it");
        assert!(check_layout(&d).is_empty(), "a terminal transcript");

        let (mut d, card) = page();
        let output = outlined_card(&mut d, card, (24.0, 24.0, 500.0, 400.0));
        d.set_style(output, "fontFamily", "\"Courier New\", monospace");
        let prose = d.add(Some(output), "p");
        d.set_style(prose, "fontFamily", "Inter, sans-serif");
        d.add_text(prose, "A paragraph of ordinary copy that outweighs the monospace line above it");
        assert_eq!(check_layout(&d).len(), 1, "mostly ordinary text");

        // A media player.
        let (mut d, card) = page();
        let player = outlined_card(&mut d, card, (24.0, 24.0, 500.0, 120.0));
        let play = d.add(Some(player), "button");
        d.set_attr(play, "aria-label", "Play");
        assert_eq!(check_layout(&d).len(), 1, "a button alone");
        let seek = d.add(Some(player), "div");
        d.set_attr(seek, "role", "slider");
        assert!(check_layout(&d).is_empty(), "a play button beside a seek bar");
        let mute = d.add(Some(player), "button");
        d.set_attr(mute, "aria-label", "Mute");
        assert!(check_layout(&d).is_empty(), "the player's own buttons");
        let choose = d.add(Some(player), "button");
        d.add_text(choose, "Choose");
        assert_eq!(check_layout(&d).len(), 1, "a pricing tier with a promo player");
        let (mut d, card) = page();
        let player = outlined_card(&mut d, card, (24.0, 24.0, 500.0, 120.0));
        let audio = d.add(Some(player), "audio");
        d.set_attr(audio, "controls", "");
        d.set_rect(audio, 40.0, 60.0, 300.0, 54.0);
        assert!(check_layout(&d).is_empty(), "an audio element with its controls");
        d.set_rect(audio, 0.0, 0.0, 0.0, 0.0);
        assert_eq!(check_layout(&d).len(), 1, "a hidden audio element");
        // A settings panel with a hidden sound element, and a profile card
        // with a small avatar video, are ordinary text and controls.
        let (mut d, card) = page();
        let panel = outlined_card(&mut d, card, (24.0, 24.0, 500.0, 120.0));
        d.add(Some(panel), "audio");
        let save = d.add(Some(panel), "button");
        d.add_text(save, "Save");
        assert_eq!(check_layout(&d).len(), 1, "a panel with a hidden audio element");
        let (mut d, card) = page();
        let profile = outlined_card(&mut d, card, (24.0, 24.0, 500.0, 160.0));
        let video = d.add(Some(profile), "video");
        d.set_rect(video, 40.0, 40.0, 48.0, 48.0);
        let follow = d.add(Some(profile), "button");
        d.add_text(follow, "Follow");
        assert_eq!(check_layout(&d).len(), 1, "a profile card with an avatar video");
        // A player whose text is more than a title and a time is a card.
        let (mut d, card) = page();
        let player = outlined_card(&mut d, card, (24.0, 24.0, 500.0, 200.0));
        let play = d.add(Some(player), "button");
        d.set_attr(play, "aria-label", "Play");
        let seek = d.add(Some(player), "input");
        d.set_attr(seek, "type", "range");
        assert!(check_layout(&d).is_empty(), "a range input player");
        let notes = d.add(Some(player), "p");
        d.add_text(
            notes,
            "Show notes for the episode: the guests talk about type, colour, layout and the \
             long road from a first sketch to a shipped design system, then take questions.",
        );
        assert_eq!(check_layout(&d).len(), 1, "a player beside a paragraph of copy");

        // A feature tile: a large illustration, a heading, copy and buttons.
        let (mut d, card) = page();
        let tile = outlined_card(&mut d, card, (24.0, 24.0, 474.0, 309.0));
        let svg = d.add(Some(tile), "svg");
        d.set_rect(svg, 38.0, 56.0, 446.0, 168.0);
        assert!(check_layout(&d).is_empty(), "an illustration with a caption line");
        let button = d.add(Some(tile), "button");
        d.add_text(button, "Try it");
        assert_eq!(check_layout(&d).len(), 1, "a tile with a control beside its svg");
        let (mut d, card) = page();
        let tile = outlined_card(&mut d, card, (24.0, 24.0, 474.0, 309.0));
        let svg = d.add(Some(tile), "svg");
        d.set_rect(svg, 38.0, 56.0, 446.0, 168.0);
        let copy = d.add(Some(tile), "p");
        d.add_text(
            copy,
            "Trigger workflows from any event in your stack, with retries, alerts, audit \
             logs and approvals built in, and a history of every run kept for a year.",
        );
        assert_eq!(check_layout(&d).len(), 1, "an svg beside body copy");

        // A card set in a monospace face with a paragraph and a button.
        let (mut d, card) = page();
        let tier = outlined_card(&mut d, card, (24.0, 24.0, 500.0, 160.0));
        d.set_style(tier, "fontFamily", "\"Courier New\", monospace");
        assert!(check_layout(&d).is_empty(), "a monospace output block");
        let copy_button = d.add(Some(tier), "button");
        d.set_attr(copy_button, "aria-label", "Copy code");
        assert!(check_layout(&d).is_empty(), "a code block with its copy button");
        // context.dev's code window: a "more options" icon menu in its header.
        let menu = d.add(Some(tier), "button");
        d.set_attr(menu, "aria-label", "More options");
        d.set_attr(menu, "aria-haspopup", "menu");
        assert!(check_layout(&d).is_empty(), "a code window's icon menu");
        let upgrade = d.add(Some(tier), "button");
        d.add_text(upgrade, "Upgrade");
        assert_eq!(check_layout(&d).len(), 1, "a monospace card with an Upgrade button");

        // The dialog itself as the outer card, or the first card inside it.
        for (attr, value) in [("role", "dialog"), ("role", "alertdialog"), ("aria-modal", "true")] {
            let (mut d, card) = page();
            outlined_card(&mut d, card, (24.0, 24.0, 400.0, 90.0));
            d.set_attr(card, attr, value);
            assert!(check_layout(&d).is_empty(), "{attr}={value}");
        }
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let overlay = d.add(Some(body), "div");
        d.set_attr(overlay, "role", "dialog");
        let panel = d.add(Some(overlay), "div");
        outlined(&mut d, panel, "16px");
        d.set_rect(panel, 380.0, 111.0, 520.0, 578.0);
        d.add_text(panel, "Welcome to the daily brief");
        let group = outlined_card(&mut d, panel, (403.0, 257.0, 474.0, 300.0));
        assert!(check_layout(&d).is_empty(), "a modal's panel");
        // A card inside a card inside the dialog's panel is an ordinary
        // nested card.
        outlined_card(&mut d, group, (420.0, 320.0, 400.0, 120.0));
        assert_eq!(check_layout(&d).len(), 1, "a card nested inside the dialog's panel");
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let overlay = d.add(Some(body), "div");
        d.set_attr(overlay, "role", "region");
        let panel = d.add(Some(overlay), "div");
        outlined(&mut d, panel, "16px");
        d.set_rect(panel, 380.0, 111.0, 520.0, 578.0);
        d.add_text(panel, "Welcome to the daily brief");
        outlined_card(&mut d, panel, (403.0, 257.0, 474.0, 200.0));
        assert_eq!(check_layout(&d).len(), 1, "a region is not a dialog");
    }

    #[test]
    fn cream_palette_tailwind_fallback() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        d.set_attr(body, "class", "bg-amber-50 text-black");
        let f = check_cream_palette(&d);
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].snippet, "cream/beige page background (Tailwind bg-amber-50)");
    }

    /// useforward.co (322742): a cream body under full-width sections that
    /// paint a dark hero and a grey page. The ground a visitor sees is grey.
    #[test]
    fn cream_palette_reads_the_bands_that_cover_the_body() {
        let build = |fills: &[(&str, f64)], page_h: f64| {
            let mut d = FakeDom::new();
            let (html, body) = d.with_page();
            d.inner_width = 1280.0;
            d.set_style(body, "backgroundColor", "rgb(245, 242, 236)");
            d.set_rect(html, 0.0, 0.0, 1280.0, page_h);
            d.set_rect(body, 0.0, 0.0, 1280.0, page_h);
            d.el_mut(html).scroll_height = Some(page_h);
            let main = d.add(Some(body), "main");
            d.set_style(main, "backgroundColor", "rgba(0, 0, 0, 0)");
            let mut y = 0.0;
            for &(fill, h) in fills {
                let section = d.add(Some(main), "section");
                d.set_styles(section, &[("backgroundColor", fill), ("backgroundImage", "none")]);
                d.set_rect(section, 0.0, y, 1280.0, h);
                y += h;
            }
            d.set_rect(main, 0.0, 0.0, 1280.0, y);
            check_cream_palette(&d)
        };
        let dark = "rgb(16, 16, 14)";
        let grey = "rgb(241, 242, 239)";
        let cream = "rgb(251, 247, 240)";
        // Covered by dark and grey: no cream shows.
        assert!(build(&[(dark, 800.0), (grey, 4200.0), (dark, 700.0)], 5700.0).is_empty());
        // Covered, mostly by a cream band: cream is the ground, and the
        // finding stands as the body names it.
        let f = build(&[(dark, 800.0), (cream, 4900.0)], 5700.0);
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].snippet, "cream/beige page background rgb(245, 242, 236)");
        // The bands leave a third of the page to the body: its fill stands.
        let f = build(&[(dark, 800.0), (grey, 3000.0)], 5700.0);
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].snippet, "cream/beige page background rgb(245, 242, 236)");
        // A cream strip laid over a white ground shows the cream.
        let f = build(&[("rgb(255, 255, 255)", 2000.0), (cream, 300.0), ("rgb(255, 255, 255)", 3400.0)], 5700.0);
        assert_eq!(f.len(), 1);
        // Warmth at the boundaries of the near-cream floor (2): white drops,
        // warmth 2 and 5 are warm paper, and a grey with green over red
        // drops whatever its warmth.
        assert!(build(&[("rgb(250, 250, 250)", 5700.0)], 5700.0).is_empty());
        assert!(build(&[("rgb(250, 249, 249)", 5700.0)], 5700.0).is_empty(), "warmth 1");
        assert_eq!(build(&[("rgb(250, 249, 248)", 5700.0)], 5700.0).len(), 1, "warmth 2");
        assert_eq!(build(&[("rgb(250, 248, 245)", 5700.0)], 5700.0).len(), 1, "warmth 5");
        assert!(build(&[("rgb(241, 242, 239)", 5700.0)], 5700.0).is_empty(), "grey");
        // A band at half alpha, or an opaque band at half opacity, lets the
        // cream through: it is no band.
        let f = build(&[("rgba(16, 16, 14, 0.5)", 5700.0)], 5700.0);
        assert_eq!(f.len(), 1);
        let faded = {
            let mut d = FakeDom::new();
            let (html, body) = d.with_page();
            d.inner_width = 1280.0;
            d.set_style(body, "backgroundColor", "rgb(245, 242, 236)");
            d.set_rect(html, 0.0, 0.0, 1280.0, 1000.0);
            d.set_rect(body, 0.0, 0.0, 1280.0, 1000.0);
            let band = d.add(Some(body), "section");
            d.set_styles(band, &[("backgroundColor", dark), ("backgroundImage", "none"), ("opacity", "0.5")]);
            d.set_rect(band, 0.0, 0.0, 1280.0, 1000.0);
            check_cream_palette(&d)
        };
        assert_eq!(faded.len(), 1);
        // A band with no measured rect covers nothing.
        let f = build(&[(dark, 800.0), (grey, f64::NAN)], 5700.0);
        assert_eq!(f.len(), 1);
    }

    /// An SPA root painting white over a cream body, with cream sections
    /// five levels down, still shows cream; a band painted by an image is
    /// no band, so a page it covers keeps the body's finding.
    #[test]
    fn cream_palette_finds_cream_deep_in_an_spa_and_skips_image_bands() {
        let mut d = FakeDom::new();
        let (html, body) = d.with_page();
        d.inner_width = 1280.0;
        d.set_style(body, "backgroundColor", "rgb(245, 242, 236)");
        d.set_rect(html, 0.0, 0.0, 1280.0, 4000.0);
        d.set_rect(body, 0.0, 0.0, 1280.0, 4000.0);
        d.el_mut(html).scroll_height = Some(4000.0);
        let root = d.add(Some(body), "div");
        d.set_styles(root, &[("backgroundColor", "rgb(255, 255, 255)"), ("backgroundImage", "none")]);
        d.set_rect(root, 0.0, 0.0, 1280.0, 4000.0);
        let mut parent = root;
        for tag in ["div", "div", "main"] {
            let el = d.add(Some(parent), tag);
            d.set_rect(el, 0.0, 0.0, 1280.0, 4000.0);
            parent = el;
        }
        for i in 0..4 {
            let section = d.add(Some(parent), "section");
            d.set_style(section, "backgroundColor", "rgb(251, 247, 240)");
            d.set_rect(section, 0.0, 1000.0 * i as f64, 1280.0, 1000.0);
        }
        assert_eq!(check_cream_palette(&d).len(), 1);

        let mut d = FakeDom::new();
        let (html, body) = d.with_page();
        d.inner_width = 1280.0;
        d.set_style(body, "backgroundColor", "rgb(245, 242, 236)");
        d.set_rect(html, 0.0, 0.0, 1280.0, 1000.0);
        d.set_rect(body, 0.0, 0.0, 1280.0, 1000.0);
        let hero = d.add(Some(body), "section");
        d.set_styles(hero, &[("backgroundColor", "rgb(16, 16, 14)"), ("backgroundImage", "url(\"/hero.jpg\")")]);
        d.set_rect(hero, 0.0, 0.0, 1280.0, 1000.0);
        assert_eq!(check_cream_palette(&d).len(), 1);
    }

    /// visitabudhabi.ae (324145): a MUI dialog fixed over the whole 390x844
    /// viewport at `opacity: 0; visibility: hidden`, waiting for its trigger.
    #[test]
    fn hidden_text_measure_leaves_out_a_hidden_viewport_overlay() {
        let run = |styles: &[(&str, &str)], rect: (f64, f64, f64, f64)| {
            let mut d = FakeDom::new();
            let (_h, body) = d.with_page();
            d.inner_width = 390.0;
            d.inner_height = 844.0;
            hidden_box(&mut d, body, "p", &[], "visible text on the page around the dialog");
            let dialog = hidden_box(&mut d, body, "div", styles, "Create Itinerary");
            d.set_rect(dialog, rect.0, rect.1, rect.2, rect.3);
            mark_body_descendants(&mut d);
            measure_hidden_text_dom(&d).hidden_chars
        };
        let full = (0.0, 0.0, 390.0, 844.0);
        let hidden_fixed = [("position", "fixed"), ("opacity", "0"), ("visibility", "hidden")];
        assert_eq!(run(&hidden_fixed, full), 0.0);
        // Transparent but not hidden: a shell waiting for a reveal.
        assert_eq!(run(&[("position", "fixed"), ("opacity", "0")], full), 16.0);
        // Not fixed, or not over the whole viewport: content.
        assert_eq!(run(&[("position", "absolute"), ("visibility", "hidden")], full), 16.0);
        assert_eq!(run(&hidden_fixed, (0.0, 0.0, 390.0, 300.0)), 16.0);

        // An app shell fixed over the viewport and held hidden by a reveal
        // that failed is the page, not an overlay: a `main` in it, or most
        // of the page's text, keeps it counted.
        let shell = |with_main: bool, text: &str| {
            let mut d = FakeDom::new();
            let (_h, body) = d.with_page();
            d.inner_width = 390.0;
            d.inner_height = 844.0;
            hidden_box(&mut d, body, "p", &[], "Loading");
            let app = hidden_box(&mut d, body, "div", &hidden_fixed, "");
            d.set_rect(app, 0.0, 0.0, 390.0, 844.0);
            let inner = hidden_box(&mut d, app, if with_main { "main" } else { "div" }, &[], text);
            d.set_rect(inner, 0.0, 0.0, 390.0, 844.0);
            mark_body_descendants(&mut d);
            measure_hidden_text_dom(&d).hidden_chars
        };
        assert_eq!(shell(true, "Short"), 5.0);
        assert_eq!(shell(false, "Your orders, your saved items and your account"), 46.0);
        // A short overlay beside more page text is still closed interface.
        assert_eq!(shell(false, "Hi"), 0.0);
    }

    /// hse.de (287847, 287911): the mobile menu at opacity 0, `position:
    /// absolute` inside a panel translated a viewport width to the left with
    /// `transition: transform 0.3s`.
    #[test]
    fn hidden_text_measure_leaves_out_a_drawer_slid_off_the_page() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        d.inner_width = 1280.0;
        hidden_box(&mut d, body, "p", &[], "visible text");
        let panel = hidden_box(
            &mut d,
            body,
            "div",
            &[
                ("position", "absolute"),
                ("transform", "matrix(1, 0, 0, 1, -1280, 0)"),
                ("transitionProperty", "transform"),
                ("transitionDuration", "0.3s"),
            ],
            "",
        );
        d.set_rect(panel, -1280.0, 0.0, 1280.0, 800.0);
        let menu = hidden_box(&mut d, panel, "div", &[("opacity", "0"), ("position", "absolute")], "Mode Schmuck");
        d.set_rect(menu, -1280.0, 0.0, 1280.0, 0.0);
        mark_body_descendants(&mut d);
        let m = measure_hidden_text_dom(&d);
        assert_eq!((m.total_chars, m.hidden_chars), (12.0, 0.0));

        // Each of these leaves the panel content that never showed.
        for (prop, value) in [
            ("transitionDuration", "0s"),
            ("transform", "none"),
            ("transform", "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)"),
            ("position", "static"),
        ] {
            d.set_style(panel, prop, value);
            let m = measure_hidden_text_dom(&d);
            assert_eq!(m.hidden_chars, 12.0, "{prop}: {value}");
            d.set_styles(
                panel,
                &[
                    ("position", "absolute"),
                    ("transform", "matrix(1, 0, 0, 1, -1280, 0)"),
                    ("transitionDuration", "0.3s"),
                ],
            );
        }
        // On the page, translated by a little: content.
        d.set_rect(panel, -40.0, 0.0, 1280.0, 800.0);
        assert_eq!(measure_hidden_text_dom(&d).hidden_chars, 12.0);
    }

    /// A box at 0 that a timed animation running on it shows counts as
    /// shown: a loop through a visible phase, or a fade-in that holds its
    /// end. A recording without the fill mode sees only the loops.
    #[test]
    fn hidden_text_measure_counts_a_running_fade_in_as_shown() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        d.keyframes.insert(
            "sent".to_string(),
            vec![
                crate::browser::dom::KeyframeFrame { decls: vec![("opacity".into(), "0".into())] },
                crate::browser::dom::KeyframeFrame { decls: vec![("opacity".into(), "1".into())] },
            ],
        );
        d.keyframe_keys.insert("sent".to_string(), vec!["0%, 25%".to_string(), "27%, 100%".to_string()]);
        hidden_box(&mut d, body, "p", &[], "visible text");
        let bubble = hidden_box(
            &mut d,
            body,
            "div",
            &[
                ("opacity", "0"),
                ("animationName", "sent"),
                ("animationIterationCount", "1"),
                ("animationFillMode", "forwards"),
                ("animationDirection", "normal"),
                ("animationDuration", "10s"),
                ("animationDelay", "0s"),
                ("animationPlayState", "running"),
                ("animationComposition", "replace"),
            ],
            "ok, moving to 10am",
        );
        d.set_running_animations(bubble, &["opacity", "transform"]);
        mark_body_descendants(&mut d);
        assert_eq!(measure_hidden_text_dom(&d).hidden_chars, 0.0);

        // Fill mode none hands the box back to its own opacity 0.
        d.set_style(bubble, "animationFillMode", "none");
        assert_eq!(measure_hidden_text_dom(&d).hidden_chars, 18.0);
        // An older recording: no fill mode read, base behaviour...
        d.set_style(bubble, "animationFillMode", "");
        assert_eq!(measure_hidden_text_dom(&d).hidden_chars, 18.0);
        // ...except for a loop, which shows every cycle.
        d.set_style(bubble, "animationIterationCount", "infinite");
        assert_eq!(measure_hidden_text_dom(&d).hidden_chars, 0.0);
        // Not seen running: hidden.
        d.el_mut(bubble).running_animations = Some(Vec::new());
        assert_eq!(measure_hidden_text_dom(&d).hidden_chars, 18.0);
        // A fade that ends at 0 is not shown either.
        d.set_running_animations(bubble, &["opacity"]);
        d.set_styles(bubble, &[("animationIterationCount", "1"), ("animationFillMode", "forwards"), ("animationDirection", "reverse")]);
        assert_eq!(measure_hidden_text_dom(&d).hidden_chars, 18.0);
    }
}
