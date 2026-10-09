//! `checkQuality` and its static-DOM helpers from `checks.mjs` Section 5
//! (`resolveFontSizePx`, `hasVisibleBackgroundBoundary`, `isVisuallyHidden`,
//! `isNonRenderedText`, `checkElementQuality`, `checkPageQualityFromDoc`).
//! Only the branches reachable with `rect: null` (the static adapter) are
//! ported; the browser-only rules (line-length, the rect-gated
//! cramped-padding, body-text-viewport-edge) never fire here.

use crate::background::{sv, sv_opt};
use crate::cascade::StyleValues;
use crate::dom::{ChildNode, StaticElement};
use impeccable_core::checks::measures::{
    chars_per_line, colors_nearly_match, css_color_is_transparent, is_capitalized_run,
    resolve_length_px, TRACKED_LABEL_MAX_CHARS,
};
use impeccable_core::checks::rules::RuleHit;
use impeccable_core::checks::text_rules::{
    font_weight_number, is_bold_title_leading, is_cjk_text, is_line_clamp,
    is_under_ui_text_floor, justifies_without_word_spaces_text, tracking_is_crushed,
    ALL_CAPS_LONG_RUN, JUSTIFY_NARROW_CHARS_PER_LINE, LEADING_DISPLAY_TYPE_PX,
    LEADING_HEADING_CONTEXT, NON_RENDERED_TAGS, QUALITY_TEXT_TAGS, SMALLPRINT_TEXT_FLOOR_PX,
    SR_ONLY_SELECTOR, UI_TEXT_FLOOR_PX,
};
use impeccable_core::js::{self, number_to_string, parse_float, to_fixed};
use impeccable_core::js_ext_a::num_truthy;
use impeccable_core::js_ext_b::{slice_utf16_prefix, utf16_len};
use once_cell::sync::Lazy;
use regex::Regex;

static WS_RE: Lazy<Regex> = Lazy::new(|| Regex::new(&format!("{}+", js::WS)).expect("WS_RE"));
// JS `/url\(/i` in checkQuality's buried-raster branch.
static RASTER_URL_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(&format!(r"{}\(", impeccable_core::js::ci("url"))).expect("RASTER_URL_RE"));
static CLIP_RECT_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(&format!(r"rect\({}*0", js::WS)).expect("CLIP_RECT_RE"));
static CLIP_INSET_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(r"inset\({}*(?:50%|99|100%)", js::WS)).expect("CLIP_INSET_RE")
});

/// JS `s.replace(/\s+/g, ' ')`.
pub fn collapse_ws(s: &str) -> String {
    WS_RE.replace_all(s, " ").into_owned()
}

/// JS `parseFloat(x) || 0`.
pub fn pf0(s: &str) -> f64 {
    let n = parse_float(s);
    if num_truthy(n) {
        n
    } else {
        0.0
    }
}

/// JS: checks.mjs#resolveFontSizePx(el, win). `None` when the font size is
/// an unresolved var() (not defined in any stylesheet this engine read): the
/// inherited size is not the element's, so nothing may be built on it.
pub fn resolve_font_size_px(el: &StaticElement<'_>) -> Option<f64> {
    if has_unresolved_var(sv(el.style(), "fontSize")) {
        return None;
    }
    let mut chain: Vec<String> = Vec::new();
    let mut cur = Some(*el);
    while let Some(e) = cur {
        chain.push(sv(e.style(), "fontSize").to_string());
        cur = e.parent_element();
    }
    let mut px = 16.0;
    for v in chain.iter().rev() {
        if v.is_empty() || v == "inherit" {
            continue;
        }
        let num = parse_float(v);
        if num.is_nan() {
            continue;
        }
        if v.ends_with("px") {
            px = num;
        } else if v.ends_with("rem") {
            px = num * 16.0;
        } else if v.ends_with("em") {
            px = num * px;
        } else if v.ends_with('%') {
            px = (num / 100.0) * px;
        } else {
            px = num;
        }
    }
    Some(px)
}

/// JS: checks.mjs#hasVisibleBackgroundBoundary(style, el, win)
pub fn has_visible_background_boundary(style: &StyleValues, el: &StaticElement<'_>) -> bool {
    let bg = sv(style, "backgroundColor");
    if has_unresolved_var(bg) || css_color_is_transparent(Some(bg)) {
        return false;
    }
    let mut parent = el.parent_element();
    while let Some(p) = parent {
        let parent_bg = sv(p.style(), "backgroundColor");
        if has_unresolved_var(parent_bg) {
            return false;
        }
        if !css_color_is_transparent(Some(parent_bg)) {
            return !colors_nearly_match(Some(bg), Some(parent_bg));
        }
        parent = p.parent_element();
    }
    // Nothing in the chain paints, so the ground is the canvas: a white box
    // on an unpainted light page draws no edge. A page that asks for a dark
    // scheme gets a dark canvas, and there a white box is an edge.
    if !impeccable_core::browser::quality::canvas_is_light(sv(style, "colorScheme")) {
        return true;
    }
    !colors_nearly_match(
        Some(bg),
        Some(impeccable_core::browser::quality::CANVAS_BACKGROUND),
    )
}

/// JS: checks.mjs#isVisuallyHidden(el, style)
pub fn is_visually_hidden(el: &StaticElement<'_>, style: &StyleValues) -> bool {
    // StaticElement has no `matches`; `closest` covers the element itself.
    if el.closest(SR_ONLY_SELECTOR).is_some() {
        return true;
    }
    let pos = sv(style, "position");
    if pos == "absolute" || pos == "fixed" {
        let clip = sv(style, "clip");
        let clip_path = {
            let a = sv(style, "clipPath");
            if !a.is_empty() {
                a
            } else {
                let b = sv(style, "webkitClipPath");
                if !b.is_empty() {
                    b
                } else {
                    sv(style, "clip-path")
                }
            }
        };
        if CLIP_RECT_RE.is_match(clip) || CLIP_INSET_RE.is_match(clip_path) {
            return true;
        }
        let w = parse_float(sv(style, "width"));
        let h = parse_float(sv(style, "height"));
        let overflow = sv(style, "overflow");
        if (w == 1.0 || h == 1.0) && (overflow == "hidden" || overflow == "clip") {
            return true;
        }
    }
    false
}

/// Whether this element carries heading text, for the tight-leading floor:
/// the element is a heading (or takes the ARIA role), one of the inline tags
/// a heading's text sits in, or any other box under a heading (the `div` a
/// design system wraps heading copy in). A reading block nested inside a
/// heading (a `p`, an `li`, and whatever sits inside one) is body copy and
/// keeps the floor.
pub fn is_heading_text(el: &StaticElement<'_>) -> bool {
    let Some(found) = el.closest(LEADING_HEADING_CONTEXT) else {
        return false;
    };
    if found.node.id() == el.node.id() {
        return true;
    }
    // An inline tag (an anchor, a span) is heading text too, by the same
    // walk: no reading block sits between it and the heading. One inside a
    // `p` nested in the heading is that paragraph's body copy.
    let mut cur = Some(*el);
    while let Some(c) = cur {
        if c.node.id() == found.node.id() {
            break;
        }
        if QUALITY_TEXT_TAGS.contains(&c.tag_lower().as_str()) {
            return false;
        }
        cur = c.parent_element();
    }
    true
}

/// JS: checks.mjs#isNonRenderedText(el, tag, style)
pub fn is_non_rendered_text(
    el: &StaticElement<'_>,
    tag: &str,
    style: Option<&StyleValues>,
) -> bool {
    let t = js::to_lower_case(tag);
    if NON_RENDERED_TAGS.contains(&t.as_str()) {
        return true;
    }
    if el.closest("head").is_some() {
        return true;
    }
    if let Some(style) = style {
        if sv_opt(style, "display") == Some("none") {
            return true;
        }
        let vis = sv_opt(style, "visibility");
        if vis == Some("hidden") || vis == Some("collapse") {
            return true;
        }
    }
    false
}

/// How far up the tree the measure lookup walks before giving up. A column
/// width is declared on the text block or on the wrapper a few levels above
/// it; past that the walk is paying for nothing.
const MEASURE_ANCESTOR_LIMIT: usize = 12;

/// The measure an element's lines can occupy, from the nearest declared
/// `width` on the element or an ancestor. `None` when nothing on the chain
/// declares one, and a caller that needs a measure then has none to judge:
/// this engine has no layout, which is why `line-length` does not fire here
/// either. The static cascade carries `width` and not `max-width`, and a
/// percentage is relative to a containing block it cannot size, so both of
/// those read as undeclared.
fn declared_measure_px(el: &StaticElement<'_>, font_size: f64) -> Option<f64> {
    let mut cur = Some(*el);
    for _ in 0..MEASURE_ANCESTOR_LIMIT {
        let e = cur?;
        let raw = sv(e.style(), "width");
        if !raw.ends_with('%') {
            if let Some(px) = resolve_length_px(Some(raw), font_size) {
                if px > 0.0 {
                    return Some(px);
                }
            }
        }
        cur = e.parent_element();
    }
    None
}

/// Whether the `hidden` attribute takes an element out of layout. The static
/// cascade carries author CSS and no UA stylesheet, so it cannot turn
/// `hidden` into `display: none` on its own, and this reads the attribute.
///
/// The UA's `[hidden] { display: none }` is the weakest rule on the page, so
/// any author `display` beats it: `<div hidden class="reveal">` with
/// `.reveal { display: block }` renders, and is scored. `hidden="until-found"`
/// is different. That content is laid out with `content-visibility: hidden`
/// until find-in-page or a fragment link reveals it, which no author
/// `display` undoes, so a browser measures a zero-size rect there and a
/// browser scan reports nothing.
fn hidden_by_attribute(el: &StaticElement<'_>) -> bool {
    let Some(value) = el.get_attribute("hidden") else {
        return false;
    };
    if value.trim().eq_ignore_ascii_case("until-found") {
        return true;
    }
    let display = sv_opt(el.style(), "display").map_or("", str::trim);
    display.is_empty() || display == "none"
}

/// Whether a closed `<details>` hides `child`. Until the element opens,
/// everything in it but its first `<summary>` is slotted out of sight, so a
/// link in the disclosed panel is markup a reader cannot see.
fn hidden_by_closed_details(details: &StaticElement<'_>, child: &StaticElement<'_>) -> bool {
    if details.tag_lower() != "details" || details.get_attribute("open").is_some() {
        return false;
    }
    let summary = details
        .children()
        .into_iter()
        .find(|c| c.tag_lower() == "summary");
    summary.map_or(true, |s| s.id() != child.id())
}

/// Markup a browser lays out nowhere, at any viewport: a `<template>`'s
/// content, a `<noscript>` (inert whenever scripting is on, which is what a
/// scanning browser does), anything under `<head>`, a `[hidden]` subtree no
/// author `display` reveals, and the panel of a closed `<details>`. The
/// static tree carries all of it (html5ever hands template fragments back as
/// ordinary descendants of the template element), so a `*` element rule
/// walks the markup of every unmounted component on the page and scores it
/// as though it were on screen. A browser scan cannot produce those
/// findings, and a rule that judges what a reader reads should not either.
///
/// Every fact read here is a fact about markup, and so the walk goes to the
/// root: a `<template>` twenty levels up hides this element as surely as its
/// parent does. The only style it reads is an author `display` on a
/// `hidden` element, and only to let it reveal the element. The static
/// cascade descends `@media` blocks unconditionally, so a winning
/// `display: none` is some narrow viewport's answer and not the one a reader
/// sees: gating on it would delete the coverage this engine has always had
/// of the `.desktop-only` sections a `max-width` query collapses on phones.
/// `display: none` therefore stays out of this, and so does `visibility`,
/// which `check_element_colors` reads on the element itself the way it
/// always has.
pub fn is_in_non_rendered_markup(el: &StaticElement<'_>, tag: &str) -> bool {
    let tag = js::to_lower_case(tag);
    if NON_RENDERED_TAGS.contains(&tag.as_str()) || hidden_by_attribute(el) {
        return true;
    }
    // A closed `<details>`'s own direct text sits in the hidden panel too.
    if tag == "details" && el.get_attribute("open").is_none() {
        return true;
    }
    let mut child = *el;
    while let Some(p) = child.parent_element() {
        if NON_RENDERED_TAGS.contains(&p.tag_lower().as_str())
            || hidden_by_attribute(&p)
            || hidden_by_closed_details(&p, &child)
        {
            return true;
        }
        child = p;
    }
    false
}

/// Inputs of `checkQuality` as the static adapter builds them.
pub struct QualityInput<'a, 'b> {
    pub el: &'b StaticElement<'a>,
    pub tag: &'b str,
    pub style: &'a StyleValues,
    pub has_direct_text: bool,
    pub text_len: usize,
    pub font_size: Option<f64>,
    pub line_height_px: Option<f64>,
    pub letter_spacing_px: Option<f64>,
}

const FLUSH_SKIP_TAGS: &[&str] = &[
    "HTML", "BODY", "MAIN", "HEADER", "FOOTER", "NAV", "ARTICLE", "ASIDE", "BUTTON", "A", "LABEL",
    "SUMMARY", "CODE", "PRE", "INPUT", "TEXTAREA", "SELECT", "FORM", "FIGURE", "TABLE", "TBODY",
    "THEAD", "TR", "TD", "TH",
];

const TINY_TEXT_UI_CONTEXT: &str = "button, a, label, summary, pre, [role=\"button\"], [role=\"link\"], [role=\"tab\"], [role=\"menuitem\"], [role=\"option\"], nav, footer, [aria-hidden=\"true\"], [class*=\"badge\" i], [class*=\"caption\" i], [class*=\"chip\" i], [class*=\"code\" i], [class*=\"console\" i], [class*=\"diff\" i], [class*=\"label\" i], [class*=\"meta\" i], [class*=\"mock\" i], [class*=\"pill\" i], [class*=\"preview\" i], [class*=\"tag\" i], [class*=\"terminal\" i], [class*=\"writes\" i]";
const EXEMPT_CONTEXT: &str = "pre, code, kbd, samp, var, svg, [aria-hidden=\"true\"], [class*=\"terminal\" i], [class*=\"console\" i], [class*=\"code\" i], [class*=\"mock\" i], [class*=\"editor\" i], [class*=\"syntax\" i], [class*=\"diff\" i]";
const INTERACTIVE: &str = "a[href], button, summary, label, select, textarea, [role=\"button\"], [role=\"link\"], [role=\"tab\"], [role=\"menuitem\"], [role=\"menuitemcheckbox\"], [role=\"menuitemradio\"], [role=\"option\"], [role=\"checkbox\"], [role=\"radio\"], [role=\"switch\"], [role=\"treeitem\"]";

/// The browser engine's `FOCUSABLE_CONTROL_MAX_CHARS`.
const FOCUSABLE_CONTROL_MAX_CHARS: usize = 80;

/// Whether `el` is, or sits in, a control, as the browser engine reads it:
/// one of the [`INTERACTIVE`] elements and roles, or a box with a `tabindex`
/// that is not negative and that holds at most
/// [`FOCUSABLE_CONTROL_MAX_CHARS`] of text. A focusable region (a card, an
/// accordion item, a skip-link target) is not a control.
fn is_in_control(el: &StaticElement<'_>) -> bool {
    if el.closest(INTERACTIVE).is_some() {
        return true;
    }
    let mut cur = Some(*el);
    while let Some(c) = cur {
        if let Some(value) = c.get_attribute("tabindex") {
            let index = parse_float(js::trim(value));
            let focusable = !(index.is_finite() && index < 0.0);
            if focusable
                && utf16_len(js::trim(&collapse_ws(&c.text_content()))) <= FOCUSABLE_CONTROL_MAX_CHARS
            {
                return true;
            }
        }
        cur = c.parent_element();
    }
    false
}
const FURNITURE_ELEMENTS: &str = "nav, [role=\"navigation\"], td, th, [role=\"gridcell\"], [role=\"cell\"], caption, figcaption, dt, dd, footer";
/// Class markers of page furniture. As in the browser engine, they are not
/// read off `html`, which holds a page's script state flags
/// (`html.js-nav-ready` is not navigation).
const FURNITURE_CLASSES: &str = "[class*=\"meta\" i], [class*=\"label\" i], [class*=\"badge\" i], [class*=\"chip\" i], [class*=\"pill\" i], [class*=\"tag\" i], [class*=\"kicker\" i], [class*=\"eyebrow\" i], [class*=\"breadcrumb\" i], [class*=\"timestamp\" i], [class*=\"category\" i], [class*=\"caption\" i], [class*=\"nav\" i]";
const SMALLPRINT: &str = "small, footer, [class*=\"legal\" i], [class*=\"copyright\" i], [class*=\"fineprint\" i], [class*=\"fine-print\" i], [class*=\"smallprint\" i], [class*=\"small-print\" i], [class*=\"disclaimer\" i], [class*=\"disclosure\" i], [class*=\"footnote\" i]";

fn has_unresolved_var(value: &str) -> bool {
    js::to_lower_case(value).contains("var(")
}

fn side_len(style: &StyleValues, key: &str, font_size: Option<f64>) -> Option<f64> {
    let value = sv_opt(style, key)?;
    if has_unresolved_var(value) {
        return None;
    }
    let at = |fs: f64| resolve_length_px(Some(value), fs).unwrap_or(0.0);
    match font_size {
        Some(fs) => Some(at(fs)),
        // Unknown only when the side depends on the font size (em, %).
        None => (at(0.0) == at(1.0)).then(|| at(0.0)),
    }
}

const PAD_KEYS: [&str; 4] = ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"];
const MARGIN_KEYS: [&str; 4] = ["marginTop", "marginRight", "marginBottom", "marginLeft"];
/// How far below a container's own child the inset may sit and still count.
/// A scroll wrapper around a table reaches its padded cells in four steps
/// (`table` > `tbody` > `tr` > `td`).
const MAX_INSULATE_DEPTH: usize = 4;

/// Whether `el` keeps the container's text off side `s`.
///
/// An element that holds one element and no text of its own is a pass-through
/// (`<h3>` around a padded `<button>`, `<a>` around a padded card), so the
/// question goes to what it wraps: the padding that insets the text often sits
/// a step or two below the container's own child. Where it holds several
/// children the question stops, because any one of them can reach the edge on
/// its own and the padding of another says nothing about it. The browser rule
/// measures where the glyphs land and needs none of this; the static scan has
/// no layout, so it reads the declarations that would move them.
fn insulates_side(el: &StaticElement<'_>, s: usize, font_size: Option<f64>, depth: usize) -> bool {
    const CHILD_INSULATE_THRESHOLD: f64 = 4.0;
    let style = el.style();
    // A side this engine cannot resolve (an unresolved var(), or an em or %
    // length on an unknown font size) may well insulate, so it does.
    let insulates = |key: &str| {
        side_len(style, key, font_size).is_none_or(|v| v >= CHILD_INSULATE_THRESHOLD)
    };
    if insulates(PAD_KEYS[s]) || insulates(MARGIN_KEYS[s]) {
        return true;
    }
    if depth == 0 || el.has_direct_text_longer_than(4) {
        return false;
    }
    let children = el.children();
    match children.as_slice() {
        [only] => insulates_side(only, s, font_size, depth - 1),
        _ => false,
    }
}

/// The hit, at advisory severity when `advisory` holds.
fn advisory_if(mut hit: RuleHit, advisory: bool) -> RuleHit {
    if advisory {
        hit.severity = Some(impeccable_core::checks::rules::ADVISORY_SEVERITY.to_string());
    }
    hit
}

/// JS: checks.mjs#checkQuality(opts), static (`rect: null`) branches.
pub fn check_quality(q: &QualityInput<'_, '_>) -> Vec<RuleHit> {
    let el = q.el;
    let tag = q.tag;
    let style = q.style;
    let font_size = q.font_size;
    let text_len = q.text_len;
    let mut findings: Vec<RuleHit> = Vec::new();

    let el_id = el.id_attr();
    if el_id.starts_with("claude-") || el_id.starts_with("cic-") {
        return findings;
    }

    // A raster (<img>, or an element with a background url) at near-zero
    // opacity never reaches the screen: the produced material ships as a
    // compliance token. The CSS-text scan catches the stylesheet form; this
    // catches computed opacity on the element itself (both engines).
    {
        let op = parse_float(sv(style, "opacity"));
        if op.is_finite() && op < 0.15 && op >= 0.0 {
            let bg = sv(style, "backgroundImage");
            if (tag == "img" || RASTER_URL_RE.is_match(bg))
                && !impeccable_core::checks::measures::raster_source_is_svg(
                    tag == "img",
                    el.get_attribute("src"),
                    bg,
                )
            {
                let label = if tag == "img" {
                    el.get_attribute("alt").unwrap_or("").to_string()
                } else {
                    slice_utf16_prefix(js::trim(&el.text_content()), 40)
                };
                findings.push(RuleHit::new(
                    "buried-raster",
                    format!(
                        "{} at opacity {}{}",
                        if tag == "img" { "<img>" } else { "raster background" },
                        number_to_string(op),
                        if label.is_empty() {
                            String::new()
                        } else {
                            format!(" \"{label}\"")
                        }
                    ),
                ));
            }
        }
    }

    // --- Line length / cramped padding (rect-gated): never fire statically.

    // --- Flush against a visible boundary ---
    {
        let upper_tag = js::to_upper_case(tag);
        let el_position = sv(style, "position");
        let children = el.children();
        if !FLUSH_SKIP_TAGS.contains(&upper_tag.as_str())
            && !q.has_direct_text
            && el_position != "fixed"
            && el_position != "absolute"
            && !children.is_empty()
        {
            let bw = |k: &str| pf0(sv(style, k));
            let border_w = [
                bw("borderTopWidth"),
                bw("borderRightWidth"),
                bw("borderBottomWidth"),
                bw("borderLeftWidth"),
            ];
            let bc = |k: &str| {
                let value = sv(style, k);
                has_unresolved_var(value) || css_color_is_transparent(Some(value))
            };
            let bs = |k: &str| {
                let value = sv(style, k);
                let value = js::to_lower_case(js::trim(value));
                value.is_empty()
                    || matches!(
                        value.as_str(),
                        "solid"
                            | "dashed"
                            | "dotted"
                            | "double"
                            | "groove"
                            | "ridge"
                            | "inset"
                            | "outset"
                    )
            };
            let border_visible = [
                border_w[0] > 0.0 && !bc("borderTopColor") && bs("borderTopStyle"),
                border_w[1] > 0.0 && !bc("borderRightColor") && bs("borderRightStyle"),
                border_w[2] > 0.0 && !bc("borderBottomColor") && bs("borderBottomStyle"),
                border_w[3] > 0.0 && !bc("borderLeftColor") && bs("borderLeftStyle"),
            ];
            let outline_w = pf0(sv(style, "outlineWidth"));
            let outline_style_val = sv(style, "outlineStyle");
            let outline_color_val = sv(style, "outlineColor");
            // `style.outline` is never set on a static style: the shorthand
            // fallback branch is unreachable here.
            let outline_visible = outline_w > 0.0
                && !has_unresolved_var(outline_color_val)
                && !css_color_is_transparent(Some(outline_color_val))
                && !outline_style_val.is_empty()
                && !has_unresolved_var(outline_style_val)
                && outline_style_val != "none";
            let bg_visible = has_visible_background_boundary(style, el);
            let any_visible = border_visible.iter().any(|b| *b) || outline_visible || bg_visible;
            if any_visible {
                let pad = [
                    side_len(style, "paddingTop", font_size),
                    side_len(style, "paddingRight", font_size),
                    side_len(style, "paddingBottom", font_size),
                    side_len(style, "paddingLeft", font_size),
                ];
                const PAD_THRESHOLD: f64 = 2.0;
                let mut children_insulate = [false; 4];
                for s in 0..4 {
                    children_insulate[s] = children
                        .iter()
                        .any(|c| insulates_side(c, s, font_size, MAX_INSULATE_DEPTH));
                }
                let side_names = ["top", "right", "bottom", "left"];
                let mut flush_sides: Vec<&str> = Vec::new();
                for s in 0..4 {
                    let bg_bounds_side = bg_visible;
                    let side_bounded = border_visible[s] || outline_visible || bg_bounds_side;
                    if side_bounded
                        && pad[s].is_some_and(|v| v <= PAD_THRESHOLD)
                        && !children_insulate[s]
                    {
                        flush_sides.push(side_names[s]);
                    }
                }
                if !flush_sides.is_empty() {
                    let has_text_child = children
                        .iter()
                        .any(|c| utf16_len(js::trim(&c.text_content())) > 4);
                    if has_text_child {
                        let cls_all = js::trim(el.class_name());
                        let cls = if cls_all.is_empty() {
                            ""
                        } else {
                            WS_RE.split(cls_all).next().unwrap_or("")
                        };
                        let mut boundary_parts: Vec<String> = Vec::new();
                        let border_sides_visible: Vec<&str> = (0..4)
                            .filter(|i| border_visible[*i])
                            .map(|i| side_names[i])
                            .collect();
                        if border_sides_visible.len() == 4 {
                            boundary_parts.push("border".to_string());
                        } else if !border_sides_visible.is_empty() {
                            boundary_parts
                                .push(format!("border-{}", border_sides_visible.join("/")));
                        }
                        if outline_visible {
                            boundary_parts.push("outline".to_string());
                        }
                        if bg_visible {
                            boundary_parts.push("bg".to_string());
                        }
                        let sides_label = if flush_sides.len() == 4 {
                            "all sides".to_string()
                        } else {
                            flush_sides.join("/")
                        };
                        let tag_lower = js::to_lower_case(tag);
                        let ident = if !cls.is_empty() {
                            format!("<{}> \"{}\"", tag_lower, cls)
                        } else {
                            format!("<{}>", tag_lower)
                        };
                        findings.push(RuleHit::new(
                            "cramped-padding",
                            format!(
                                "{}: children flush against {} on {} (no inset)",
                                ident,
                                boundary_parts.join("+"),
                                sides_label
                            ),
                        ));
                    }
                }
            }
        }
    }

    let is_heading = matches!(tag, "h1" | "h2" | "h3" | "h4" | "h5" | "h6");

    // --- Tight line height ---
    if q.has_direct_text && text_len > 50 && !is_heading {
        if let (Some(lh), Some(font_size)) = (q.line_height_px, font_size) {
            if font_size > 0.0 && font_size < LEADING_DISPLAY_TYPE_PX {
                let ratio = lh / font_size;
                // Compare on the ratio the snippet prints, so a page that sets
                // line-height: 1.3 exactly is never flagged for hitting the floor
                // (46.8 / 36 is 1.2999999999999998 in binary floats).
                let shown = js::math_round(ratio * 100.0) / 100.0;
                if ratio > 0.0
                    && shown < 1.3
                    && !is_non_rendered_text(el, tag, Some(style))
                    && !is_visually_hidden(el, style)
                    && !is_heading_text(el)
                    // A bold title in a -webkit-box line clamp gets the heading
                    // exemption. The browser engine also exempts bold text of two
                    // lines or fewer; with no layout, lines cannot be counted here.
                    && !is_bold_title_leading(
                        font_weight_number(sv(style, "fontWeight")),
                        None,
                        is_line_clamp(sv(style, "display"), sv(style, "webkitLineClamp")),
                    )
                {
                    findings.push(advisory_if(
                        RuleHit::new(
                            "tight-leading",
                            format!("line-height {}x (need >=1.3)", to_fixed(ratio, 2)),
                        ),
                        crate::text_context::is_fine_print(el),
                    ));
                }
            }
        }
    }

    // --- Justified text (without hyphens) ---
    // Only a narrow column stretches word spaces far enough to open rivers,
    // and only in a script that justifies on word spaces at all.
    // An unresolved font size gives no measure to judge the column by.
    if let Some(font_size) = font_size
        .filter(|fs| q.has_direct_text && sv_opt(style, "textAlign") == Some("justify") && *fs > 0.0)
    {
        let hyphens = {
            let a = sv(style, "hyphens");
            if !a.is_empty() {
                a
            } else {
                sv(style, "webkitHyphens")
            }
        };
        let narrow = declared_measure_px(el, font_size)
            .is_some_and(|w| chars_per_line(w, font_size) <= JUSTIFY_NARROW_CHARS_PER_LINE);
        if hyphens != "auto" && narrow && !justifies_without_word_spaces_text(&el.direct_text()) {
            findings.push(RuleHit::new(
                "justified-text",
                "text-align: justify without hyphens: auto".to_string(),
            ));
        }
    }

    // --- Tiny body text ---
    if let Some(font_size) =
        font_size.filter(|fs| q.has_direct_text && text_len > 20 && *fs < 12.0)
    {
        let skip_tags = [
            "sub",
            "sup",
            "code",
            "kbd",
            "samp",
            "var",
            "caption",
            "figcaption",
        ];
        let in_ui_context = el.closest(TINY_TEXT_UI_CONTEXT).is_some();
        let is_uppercase = sv_opt(style, "textTransform") == Some("uppercase");
        if !skip_tags.contains(&tag)
            && !in_ui_context
            && !is_uppercase
            && !is_non_rendered_text(el, tag, Some(style))
        {
            // Fine print (taste call r5-p27) and text in a mockup (r5-p26)
            // report as advisory.
            findings.push(advisory_if(
                RuleHit::new("tiny-text", format!("{}px body text", number_to_string(font_size))),
                crate::text_context::is_fine_print(el) || crate::text_context::in_mock_context(el),
            ));
        }
    }

    // --- Undersized functional / UI text ---
    {
        let direct_text = js::trim(&collapse_ws(&el.direct_text())).to_string();
        let dt_len = utf16_len(&direct_text);
        let ui_skip_tags = ["sub", "sup", "option"];
        if let Some(font_size) = font_size.filter(|fs| {
            *fs > 0.0
                && *fs < UI_TEXT_FLOOR_PX
                && dt_len >= 2
                && !ui_skip_tags.contains(&tag)
                // A footnote marker is set small by convention, and so is the
                // link inside it (`<sup><a>[7]</a></sup>`).
                && el.closest("sub, sup").is_none()
                && !is_non_rendered_text(el, tag, Some(style))
        }) {
            // The browser engine also exempts a monospace run with its
            // whitespace kept that reads as code; this cascade carries no
            // `white-space`, so a code line outside a `pre` or `code` still
            // reports here.
            let is_exempt_context = el.closest(EXEMPT_CONTEXT).is_some();
            if !is_exempt_context && !is_visually_hidden(el, style) {
                let is_interactive = is_in_control(el);
                let is_furniture = el.closest(FURNITURE_ELEMENTS).is_some()
                    || el.closest(FURNITURE_CLASSES).is_some_and(|m| m.tag_lower() != "html");
                let is_smallprint = el.closest(SMALLPRINT).is_some();
                let floor = if !is_interactive && is_smallprint {
                    SMALLPRINT_TEXT_FLOOR_PX
                } else {
                    UI_TEXT_FLOOR_PX
                };
                // A 0.1px tolerance under each floor, as the browser engine.
                if is_under_ui_text_floor(font_size, floor)
                    && (is_interactive || is_furniture || dt_len <= 20)
                {
                    let excerpt = slice_utf16_prefix(&direct_text, 40);
                    // A label with no reading job (taste call r5-p3) and
                    // text in a mockup (r5-p26) report as advisory. A
                    // control's text is neither: a framed demo's controls
                    // keep failing too, since a visitor can use them.
                    let advisory = !is_interactive
                        && (crate::text_context::is_micro_label(el)
                            || crate::text_context::in_mock_context(el));
                    findings.push(advisory_if(
                        RuleHit::new(
                            "undersized-ui-text",
                            format!(
                                "{}px functional text \"{}\" (below {}px floor)",
                                number_to_string(font_size),
                                excerpt,
                                number_to_string(floor)
                            ),
                        ),
                        advisory,
                    ));
                }
            }
        }
    }

    // --- All-caps body text ---
    // Uppercase on a short run is a convention, not a defect: a button, a nav
    // item, a kicker or an eyebrow is taken in as a shape. The cost lands when
    // the run is long enough to be read as a sentence. The run is the
    // element's own text, so a bar or a form control whose children hold the
    // labels is not one long run, however its subtree adds up.
    if q.has_direct_text && sv_opt(style, "textTransform") == Some("uppercase") && !is_heading {
        let own_len = utf16_len(js::trim(&collapse_ws(&el.direct_text())));
        if own_len >= ALL_CAPS_LONG_RUN {
            findings.push(RuleHit::new(
                "all-caps-body",
                format!("text-transform: uppercase on {} chars of body text", own_len),
            ));
        }
    }

    // --- Wide letter spacing on body text ---
    if q.has_direct_text && text_len > 20 {
        if let (Some(ls), Some(font_size)) = (q.letter_spacing_px, font_size) {
            if ls > 0.0 && font_size > 0.0 {
                let tracking_em = ls / font_size;
                if tracking_em > 0.05 {
                    // Wide tracking is the standard treatment for an
                    // uppercase eyebrow, label or button. `text-transform`
                    // says so outright, and capitals typed into the markup
                    // take the same exemption under a sentence's length
                    // when every letter is one and no transform lowers it.
                    // A run inside the label length keeps the looser reading
                    // it had (a CJK label with a Latin acronym); this engine
                    // has no layout, so it counts as one line.
                    let own = collapse_ws(js::trim(&el.text_content()));
                    let every_letter_caps = utf16_len(&own) < ALL_CAPS_LONG_RUN
                        && is_capitalized_run(&own)
                        && own.chars().filter(|c| c.is_alphabetic()).all(|c| c.is_uppercase());
                    let lowered = sv_opt(style, "textTransform") == Some("lowercase");
                    let caps_label = sv_opt(style, "textTransform") == Some("uppercase")
                        || (!lowered
                            && (every_letter_caps
                                || (text_len <= TRACKED_LABEL_MAX_CHARS && is_capitalized_run(&own))));
                    // CJK text takes open tracking by convention, as the
                    // browser engine and extreme-negative-tracking read it.
                    let cjk = impeccable_core::checks::text_rules::is_cjk_text(&own);
                    if !caps_label && !cjk {
                        findings.push(RuleHit::new(
                            "wide-tracking",
                            format!(
                                "letter-spacing: {}em on body text",
                                to_fixed(tracking_em, 2)
                            ),
                        ));
                    }
                }
            }
        }
    }

    // --- Crushed letter spacing ---
    if q.has_direct_text && text_len > 20 {
        if let (Some(ls), Some(font_size)) = (q.letter_spacing_px, font_size) {
            if ls < 0.0 && font_size > 0.0 {
                let tracking_em = ls / font_size;
                if tracking_is_crushed(tracking_em, font_size) {
                    let text = collapse_ws(js::trim(&el.text_content()));
                    if !is_cjk_text(&text) {
                        findings.push(RuleHit::new(
                            "extreme-negative-tracking",
                            format!(
                                "letter-spacing: {}em at {}px — \"{}\"",
                                to_fixed(tracking_em, 2),
                                number_to_string(font_size),
                                slice_utf16_prefix(&text, 40)
                            ),
                        ));
                    }
                }
            }
        }
    }

    findings
}

/// JS: checks.mjs#checkElementQuality(el, style, tag, window)
pub fn check_element_quality(
    el: &StaticElement<'_>,
    style: &StyleValues,
    tag: &str,
) -> Vec<RuleHit> {
    let has_direct_text = el.has_direct_text_longer_than(10);
    let text_len = utf16_len(js::trim(&el.text_content()));
    let font_size = resolve_font_size_px(el);
    let line_height_px =
        font_size.and_then(|fs| resolve_length_px(sv_opt(style, "lineHeight"), fs));
    let letter_spacing_px =
        font_size.and_then(|fs| resolve_length_px(sv_opt(style, "letterSpacing"), fs));
    check_quality(&QualityInput {
        el,
        tag,
        style,
        has_direct_text,
        text_len,
        font_size,
        line_height_px,
        letter_spacing_px,
    })
}

/// JS: checks.mjs#checkPageQualityFromDoc(doc)
///
/// A skip into the footer is not reported; see the browser twin
/// (`impeccable_core::browser::quality::check_page_quality_from_doc`) for
/// the rule (corpus decision r5-p29-skipped-heading-footer-titles).
pub fn check_page_quality_from_doc(doc: &crate::dom::StaticDocument) -> Vec<RuleHit> {
    let mut findings = Vec::new();
    let mut prev_level: i64 = 0;
    let mut prev_text = String::new();
    let mut prev_footer = None;
    let mut prev_opens_footer = false;
    for h in doc.query_selector_all("h1, h2, h3, h4, h5, h6") {
        let tag = h.tag_upper();
        let level = tag[1..2].parse::<i64>().unwrap_or(0);
        let text = slice_utf16_prefix(&collapse_ws(js::trim(&h.text_content())), 60);
        let footer = h
            .closest(impeccable_core::browser::quality::FOOTER_SELECTOR)
            .map(|f| f.id());
        let opens_footer = footer.is_some() && footer != prev_footer;
        let into_footer = footer.is_some() && (opens_footer || prev_opens_footer);
        let continues = prev_level > 0;
        let skips = continues && level > prev_level + 1;
        if skips && !into_footer {
            findings.push(RuleHit::new(
                "skipped-heading",
                format!(
                    "<h{}> \"{}\" followed by <h{}> \"{}\" (missing h{})",
                    prev_level,
                    prev_text,
                    level,
                    text,
                    prev_level + 1
                ),
            ));
        }
        prev_level = level;
        prev_text = text;
        prev_footer = footer;
        // As in the URL engine: a footer's first heading that skipped in is
        // a column title, and excuses nothing after it.
        prev_opens_footer = opens_footer && continues && !skips;
    }
    findings
}

/// The `childNodes`-based `hasText` used by `checkStaticPageTypography`.
pub fn has_nonblank_direct_text(el: &StaticElement<'_>) -> bool {
    el.child_nodes()
        .iter()
        .any(|c| matches!(c, ChildNode::Text(t) if !js::trim(t).is_empty()))
}
