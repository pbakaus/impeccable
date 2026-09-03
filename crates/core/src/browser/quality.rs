//! `checkQuality` and its browser adapters from `checks.mjs` Section 5:
//! `checkQuality` (every branch, including the rect-gated ones the static
//! engine never reaches), `checkElementQualityDOM`,
//! `hasVisibleBackgroundBoundary`, `hasMeaningfulDirectText`,
//! `textDescendantsFlushSides`, `isVisuallyHidden`, `isNonRenderedText`,
//! `checkPageQualityFromDoc`, `checkPageQualityDOM`.

#![allow(unused_imports)]
use super::dom::{
    closest_or_none, direct_text, has_direct_text_longer_than, matches_or_false, pf0, safe_id,
    style_px, tag_lower, Dom, ElId, Rect,
};
use super::{BrowserConfig, BrowserFinding};
use crate::checks::measures::{colors_nearly_match, css_color_is_transparent, resolve_length_px};
use crate::checks::rules::RuleHit;
use crate::checks::text_rules::{
    NON_RENDERED_TAGS, QUALITY_TEXT_TAGS, SR_ONLY_SELECTOR, TEXT_EDGE_TAGS,
};
use crate::js::{self, math_round, number_to_string, parse_float, to_fixed};
use crate::js_ext_b::{slice_utf16_prefix, utf16_len};
use once_cell::sync::Lazy;
use regex::Regex;

macro_rules! re {
    ($name:ident, $pat:expr) => {
        static $name: Lazy<Regex> = Lazy::new(|| Regex::new(&$pat).expect(stringify!($name)));
    };
}

re!(WS_RE, format!("{}+", js::WS));
// JS `/url\(/i` in checkQuality's buried-raster branch.
re!(QUALITY_RASTER_URL_RE, format!(r"{}\(", js::ci("url")));
re!(CLIP_RECT_RE, format!(r"rect\({}*0", js::WS));
re!(
    CLIP_INSET_RE,
    format!(r"inset\({}*(?:50%|99|100%)", js::WS)
);
re!(OUTLINE_W_RE, r"([0-9]+(?:\.[0-9]+)?)\s*px");
re!(
    OUTLINE_STYLE_RE,
    r"(?-u:\b)(solid|dashed|dotted|double|groove|ridge|inset|outset)(?-u:\b)"
);
re!(
    OUTLINE_COLOR_RE,
    format!(r"(rgba?\([^)]+\)|#[0-9a-fA-F]{{3,8}}|[a-zA-Z]+){}*$", js::WS)
);

/// JS `s.replace(/\s+/g, ' ')`.
pub fn collapse_ws(s: &str) -> String {
    WS_RE.replace_all(s, " ").into_owned()
}

const FLUSH_SKIP_TAGS: &[&str] = &[
    "HTML", "BODY", "MAIN", "HEADER", "FOOTER", "NAV", "ARTICLE", "ASIDE", "BUTTON", "A", "LABEL",
    "SUMMARY", "CODE", "PRE", "INPUT", "TEXTAREA", "SELECT", "FORM", "FIGURE", "TABLE", "TBODY",
    "THEAD", "TR", "TD", "TH",
];

const TINY_TEXT_UI_CONTEXT: &str = "button, a, label, summary, pre, [role=\"button\"], [role=\"link\"], [role=\"tab\"], [role=\"menuitem\"], [role=\"option\"], nav, footer, [aria-hidden=\"true\"], [class*=\"badge\" i], [class*=\"caption\" i], [class*=\"chip\" i], [class*=\"code\" i], [class*=\"console\" i], [class*=\"diff\" i], [class*=\"label\" i], [class*=\"meta\" i], [class*=\"mock\" i], [class*=\"pill\" i], [class*=\"preview\" i], [class*=\"tag\" i], [class*=\"terminal\" i], [class*=\"writes\" i]";
const EXEMPT_CONTEXT: &str = "pre, code, kbd, samp, var, svg, [aria-hidden=\"true\"], [class*=\"terminal\" i], [class*=\"console\" i], [class*=\"code\" i], [class*=\"mock\" i], [class*=\"editor\" i], [class*=\"syntax\" i], [class*=\"diff\" i]";
const INTERACTIVE: &str = "a[href], button, summary, label, select, textarea, [role=\"button\"], [role=\"link\"], [role=\"tab\"], [role=\"menuitem\"], [role=\"menuitemcheckbox\"], [role=\"menuitemradio\"], [role=\"option\"], [role=\"checkbox\"], [role=\"radio\"], [role=\"switch\"], [role=\"treeitem\"], [tabindex]";
const FURNITURE: &str = "nav, [role=\"navigation\"], td, th, [role=\"gridcell\"], [role=\"cell\"], caption, figcaption, dt, dd, footer, [class*=\"meta\" i], [class*=\"label\" i], [class*=\"badge\" i], [class*=\"chip\" i], [class*=\"pill\" i], [class*=\"tag\" i], [class*=\"kicker\" i], [class*=\"eyebrow\" i], [class*=\"breadcrumb\" i], [class*=\"timestamp\" i], [class*=\"category\" i], [class*=\"caption\" i], [class*=\"nav\" i]";
const SMALLPRINT: &str = "small, footer, [class*=\"legal\" i], [class*=\"copyright\" i], [class*=\"fineprint\" i], [class*=\"fine-print\" i], [class*=\"smallprint\" i], [class*=\"small-print\" i], [class*=\"disclaimer\" i], [class*=\"disclosure\" i], [class*=\"footnote\" i]";
const TEXT_EDGE_QUERY: &str =
    "a, button, code, dd, dt, figcaption, h1, h2, h3, h4, h5, h6, li, p, pre, span, td, th";

/// JS `(el.matches && el.matches(sel)) || (el.closest && el.closest(sel))`.
fn matches_or_closest(dom: &dyn Dom, el: ElId, sel: &str) -> bool {
    matches_or_false(dom, el, sel) || closest_or_none(dom, el, sel).is_some()
}

/// JS: checks.mjs#hasVisibleBackgroundBoundary(style, el, win) — browser:
/// `style` is `el`'s own computed style, `win` the live window.
pub fn has_visible_background_boundary(dom: &dyn Dom, el: ElId) -> bool {
    let bg = dom.style(el, "backgroundColor");
    if css_color_is_transparent(Some(&bg)) {
        return false;
    }
    let mut parent = dom.parent(el);
    while let Some(p) = parent {
        let parent_bg = dom.style(p, "backgroundColor");
        if !css_color_is_transparent(Some(&parent_bg)) {
            return !colors_nearly_match(Some(&bg), Some(&parent_bg));
        }
        parent = dom.parent(p);
    }
    true
}

/// JS: checks.mjs#hasMeaningfulDirectText(node)
pub fn has_meaningful_direct_text(dom: &dyn Dom, el: ElId) -> bool {
    has_direct_text_longer_than(dom, el, 4)
}

/// JS: checks.mjs#textDescendantsFlushSides(el, rect) → [top, right, bottom, left]
pub fn text_descendants_flush_sides(dom: &dyn Dom, el: ElId, rect: &Rect) -> [bool; 4] {
    let mut flush = [false; 4];
    const TEXT_EDGE_THRESHOLD: f64 = 4.0;
    let candidates = dom.query_all(Some(el), TEXT_EDGE_QUERY).unwrap_or_default();
    for node in candidates {
        let tag_name = dom.tag_name(node);
        if !TEXT_EDGE_TAGS.contains(&tag_name.as_str()) || !has_meaningful_direct_text(dom, node) {
            continue;
        }
        let nr = dom.rect(node);
        if nr.width <= 0.0 || nr.height <= 0.0 {
            continue;
        }
        if nr.bottom < rect.top || nr.top > rect.bottom || nr.right < rect.left || nr.left > rect.right {
            continue;
        }
        if nr.top - rect.top <= TEXT_EDGE_THRESHOLD {
            flush[0] = true;
        }
        if rect.right - nr.right <= TEXT_EDGE_THRESHOLD {
            flush[1] = true;
        }
        if rect.bottom - nr.bottom <= TEXT_EDGE_THRESHOLD {
            flush[2] = true;
        }
        if nr.left - rect.left <= TEXT_EDGE_THRESHOLD {
            flush[3] = true;
        }
    }
    flush
}

/// JS: checks.mjs#isVisuallyHidden(el, style)
pub fn is_visually_hidden(dom: &dyn Dom, el: ElId) -> bool {
    if matches_or_closest(dom, el, SR_ONLY_SELECTOR) {
        return true;
    }
    let pos = dom.style(el, "position");
    if pos == "absolute" || pos == "fixed" {
        let clip = dom.style(el, "clip");
        let clip_path = {
            let a = dom.style(el, "clipPath");
            if !a.is_empty() {
                a
            } else {
                let b = dom.style(el, "webkitClipPath");
                if !b.is_empty() {
                    b
                } else {
                    dom.style(el, "clip-path")
                }
            }
        };
        if CLIP_RECT_RE.is_match(&clip) || CLIP_INSET_RE.is_match(&clip_path) {
            return true;
        }
        let w = parse_float(&dom.style(el, "width"));
        let h = parse_float(&dom.style(el, "height"));
        let overflow = dom.style(el, "overflow");
        if (w == 1.0 || h == 1.0) && (overflow == "hidden" || overflow == "clip") {
            return true;
        }
    }
    false
}

/// JS: checks.mjs#isNonRenderedText(el, tag, style)
pub fn is_non_rendered_text(dom: &dyn Dom, el: ElId, tag: &str) -> bool {
    let t = js::to_lower_case(tag);
    if NON_RENDERED_TAGS.contains(&t.as_str()) {
        return true;
    }
    if closest_or_none(dom, el, "head").is_some() {
        return true;
    }
    if dom.style(el, "display") == "none" {
        return true;
    }
    let vis = dom.style(el, "visibility");
    if vis == "hidden" || vis == "collapse" {
        return true;
    }
    false
}

/// Inputs of `checkQuality` as the browser adapter builds them.
pub struct QualityInput {
    pub el: ElId,
    pub tag: String,
    pub has_direct_text: bool,
    pub text_len: usize,
    pub font_size: f64,
    pub line_height_px: Option<f64>,
    pub letter_spacing_px: Option<f64>,
    pub rect: Rect,
    pub line_max: f64,
    pub viewport_width: f64,
}

/// JS: checks.mjs#checkQuality(opts), browser adapter inputs (`rect` set,
/// `win` = window).
pub fn check_quality(dom: &dyn Dom, q: &QualityInput) -> Vec<RuleHit> {
    let el = q.el;
    let tag = q.tag.as_str();
    let font_size = q.font_size;
    let text_len = q.text_len;
    let rect = &q.rect;
    let line_max = q.line_max;
    let viewport_width = q.viewport_width;
    let has_direct_text = q.has_direct_text;
    let mut findings: Vec<RuleHit> = Vec::new();

    let el_id = safe_id(dom, el);
    if el_id.starts_with("claude-") || el_id.starts_with("cic-") {
        return findings;
    }

    let st = |k: &str| dom.style(el, k);
    let spx = |k: &str| style_px(dom, el, k);

    // A raster (<img>, or an element with a background url) at near-zero
    // opacity never reaches the screen: the produced material ships as a
    // compliance token. The CSS-text scan catches the stylesheet form; this
    // catches computed opacity on the element itself (both engines).
    {
        let op = parse_float(&st("opacity"));
        if op.is_finite() && op < 0.15 && op >= 0.0 {
            let bg = st("backgroundImage");
            if tag == "img" || QUALITY_RASTER_URL_RE.is_match(&bg) {
                let label = if tag == "img" {
                    dom.attr(el, "alt").unwrap_or_default()
                } else {
                    slice_utf16_prefix(js::trim(&dom.text_content(el)), 40)
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

    // --- Line length too long ---
    if has_direct_text
        && QUALITY_TEXT_TAGS.contains(&tag)
        && rect.width > 0.0
        && (text_len as f64) > line_max
    {
        let chars_per_line = rect.width / (font_size * 0.5);
        if chars_per_line > line_max + 5.0 {
            findings.push(RuleHit::new(
                "line-length",
                format!(
                    "~{} chars/line (aim for <{})",
                    number_to_string(math_round(chars_per_line)),
                    number_to_string(line_max)
                ),
            ));
        }
    }

    // --- Cramped padding ---
    let is_inline_code = tag == "code" && closest_or_none(dom, el, "pre").is_none();
    if !is_inline_code && has_direct_text && text_len > 20 && rect.width > 100.0 && rect.height > 30.0 {
        let borders = [
            spx("borderTopWidth"),
            spx("borderRightWidth"),
            spx("borderBottomWidth"),
            spx("borderLeftWidth"),
        ];
        let border_count = borders.iter().filter(|w| **w > 0.0).count();
        let has_bg = has_visible_background_boundary(dom, el);
        if border_count >= 2 || has_bg {
            let mut v_pads: Vec<f64> = Vec::new();
            let mut h_pads: Vec<f64> = Vec::new();
            if has_bg || borders[0] > 0.0 {
                v_pads.push(spx("paddingTop"));
            }
            if has_bg || borders[2] > 0.0 {
                v_pads.push(spx("paddingBottom"));
            }
            if has_bg || borders[3] > 0.0 {
                h_pads.push(spx("paddingLeft"));
            }
            if has_bg || borders[1] > 0.0 {
                h_pads.push(spx("paddingRight"));
            }
            let v_min = v_pads.iter().copied().fold(f64::INFINITY, js::math_min);
            let h_min = h_pads.iter().copied().fold(f64::INFINITY, js::math_min);
            let v_thresh = js::math_max(4.0, font_size * 0.3);
            let h_thresh = js::math_max(8.0, font_size * 0.5);
            if v_min < v_thresh {
                findings.push(RuleHit::new(
                    "cramped-padding",
                    format!(
                        "{}px vertical padding (need ≥{}px for {}px text)",
                        number_to_string(v_min),
                        to_fixed(v_thresh, 1),
                        number_to_string(font_size)
                    ),
                ));
            } else if h_min < h_thresh {
                findings.push(RuleHit::new(
                    "cramped-padding",
                    format!(
                        "{}px horizontal padding (need ≥{}px for {}px text)",
                        number_to_string(h_min),
                        to_fixed(h_thresh, 1),
                        number_to_string(font_size)
                    ),
                ));
            }
        }
    }

    // --- Flush against a visible boundary ---
    {
        let upper_tag = js::to_upper_case(tag);
        let el_position = st("position");
        let children = dom.children(el);
        if !FLUSH_SKIP_TAGS.contains(&upper_tag.as_str())
            && !has_direct_text
            && el_position != "fixed"
            && el_position != "absolute"
            && !children.is_empty()
        {
            let border_w = [
                spx("borderTopWidth"),
                spx("borderRightWidth"),
                spx("borderBottomWidth"),
                spx("borderLeftWidth"),
            ];
            let bc = |k: &str| css_color_is_transparent(Some(&st(k)));
            let border_visible = [
                border_w[0] > 0.0 && !bc("borderTopColor"),
                border_w[1] > 0.0 && !bc("borderRightColor"),
                border_w[2] > 0.0 && !bc("borderBottomColor"),
                border_w[3] > 0.0 && !bc("borderLeftColor"),
            ];
            let mut outline_w = spx("outlineWidth");
            let mut outline_style_val = st("outlineStyle");
            let mut outline_color_val = st("outlineColor");
            let outline_short = st("outline");
            if outline_w == 0.0 && !outline_short.is_empty() {
                if let Some(m) = OUTLINE_W_RE.captures(&outline_short) {
                    outline_w = pf0(m.get(1).map(|x| x.as_str()).unwrap_or(""));
                }
                if outline_style_val.is_empty() {
                    outline_style_val = if OUTLINE_STYLE_RE.is_match(&outline_short) {
                        "solid".to_string()
                    } else {
                        String::new()
                    };
                }
                if outline_color_val.is_empty() {
                    if let Some(m) = OUTLINE_COLOR_RE.captures(&outline_short) {
                        outline_color_val = m.get(1).map(|x| x.as_str()).unwrap_or("").to_string();
                    }
                }
            }
            let outline_visible = outline_w > 0.0
                && !css_color_is_transparent(Some(&outline_color_val))
                && !outline_style_val.is_empty()
                && outline_style_val != "none";
            let bg_visible = has_visible_background_boundary(dom, el);
            let any_visible = border_visible.iter().any(|b| *b) || outline_visible || bg_visible;
            if any_visible {
                let len = |e: ElId, k: &str| {
                    resolve_length_px(Some(&dom.style(e, k)), font_size).unwrap_or(0.0)
                };
                let pad = [
                    len(el, "paddingTop"),
                    len(el, "paddingRight"),
                    len(el, "paddingBottom"),
                    len(el, "paddingLeft"),
                ];
                const PAD_THRESHOLD: f64 = 2.0;
                const CHILD_INSULATE_THRESHOLD: f64 = 4.0;
                let mut children_insulate = [false; 4];
                for &child in &children {
                    let child_pad = [
                        len(child, "paddingTop"),
                        len(child, "paddingRight"),
                        len(child, "paddingBottom"),
                        len(child, "paddingLeft"),
                    ];
                    let child_margin = [
                        len(child, "marginTop"),
                        len(child, "marginRight"),
                        len(child, "marginBottom"),
                        len(child, "marginLeft"),
                    ];
                    let cr = dom.rect(child);
                    if cr.width > 0.0 && cr.height > 0.0 {
                        if cr.top - rect.top >= CHILD_INSULATE_THRESHOLD {
                            children_insulate[0] = true;
                        }
                        if rect.right - cr.right >= CHILD_INSULATE_THRESHOLD {
                            children_insulate[1] = true;
                        }
                        if rect.bottom - cr.bottom >= CHILD_INSULATE_THRESHOLD {
                            children_insulate[2] = true;
                        }
                        if cr.left - rect.left >= CHILD_INSULATE_THRESHOLD {
                            children_insulate[3] = true;
                        }
                    }
                    for s in 0..4 {
                        if child_pad[s] >= CHILD_INSULATE_THRESHOLD
                            || child_margin[s] >= CHILD_INSULATE_THRESHOLD
                        {
                            children_insulate[s] = true;
                        }
                    }
                }

                let text_flush = text_descendants_flush_sides(dom, el, rect);
                let full_bleed_bg_band = viewport_width > 0.0
                    && rect.width >= viewport_width * 0.94
                    && bg_visible
                    && !outline_visible;
                let side_names = ["top", "right", "bottom", "left"];
                let mut flush_sides: Vec<&str> = Vec::new();
                for s in 0..4 {
                    let bg_bounds_side = bg_visible && !(full_bleed_bg_band && (s == 1 || s == 3));
                    let side_bounded = border_visible[s] || outline_visible || bg_bounds_side;
                    if side_bounded && pad[s] <= PAD_THRESHOLD && !children_insulate[s] && text_flush[s] {
                        flush_sides.push(side_names[s]);
                    }
                }

                if !flush_sides.is_empty() {
                    let mut has_text_child = false;
                    for &child in &children {
                        let child_text = js::trim(&dom.text_content(child)).to_string();
                        if utf16_len(&child_text) > 4 {
                            has_text_child = true;
                            break;
                        }
                    }
                    if has_text_child {
                        let cls_all = dom.class_name_prop(el).unwrap_or_default();
                        let cls_all = js::trim(&cls_all).to_string();
                        let cls = if cls_all.is_empty() {
                            String::new()
                        } else {
                            WS_RE.split(&cls_all).next().unwrap_or("").to_string()
                        };
                        let mut boundary_parts: Vec<String> = Vec::new();
                        let border_sides_visible: Vec<&str> = (0..4)
                            .filter(|i| border_visible[*i])
                            .map(|i| side_names[i])
                            .collect();
                        if border_sides_visible.len() == 4 {
                            boundary_parts.push("border".to_string());
                        } else if !border_sides_visible.is_empty() {
                            boundary_parts.push(format!("border-{}", border_sides_visible.join("/")));
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
                        let tl = js::to_lower_case(tag);
                        let ident = if !cls.is_empty() {
                            format!("<{}> \"{}\"", tl, cls)
                        } else {
                            format!("<{}>", tl)
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

    // --- Body text touching viewport edge ---
    if has_direct_text
        && text_len > 40
        && matches!(js::to_upper_case(tag).as_str(), "P" | "LI")
        && viewport_width > 0.0
    {
        let in_nav_header =
            closest_or_none(dom, el, "nav").is_some() || closest_or_none(dom, el, "header").is_some();
        let bg = st("backgroundColor");
        let has_own_bg = !bg.is_empty() && bg != "rgba(0, 0, 0, 0)" && bg != "transparent";
        let pos = st("position");
        let is_positioned = pos == "fixed" || pos == "absolute";
        let width_ratio = rect.width / viewport_width;
        let left_close = rect.left < 16.0;
        let right_close = rect.right > viewport_width - 16.0;
        if !in_nav_header && !has_own_bg && !is_positioned && width_ratio > 0.5 && (left_close || right_close) {
            let l = number_to_string(math_round(rect.left));
            let r = number_to_string(math_round(viewport_width - rect.right));
            let which = if left_close && right_close {
                format!("left {}px / right {}px", l, r)
            } else if left_close {
                format!("left {}px", l)
            } else {
                format!("right {}px", r)
            };
            findings.push(RuleHit::new(
                "body-text-viewport-edge",
                format!(
                    "<{}> with {}-char body bleeds to viewport edge ({})",
                    js::to_lower_case(tag),
                    text_len,
                    which
                ),
            ));
        }
    }

    let is_heading = matches!(tag, "h1" | "h2" | "h3" | "h4" | "h5" | "h6");

    // --- Tight line height ---
    if has_direct_text && text_len > 50 && !is_heading {
        if let Some(lh) = q.line_height_px {
            if font_size > 0.0 {
                let ratio = lh / font_size;
                if ratio > 0.0 && ratio < 1.3 {
                    findings.push(RuleHit::new(
                        "tight-leading",
                        format!("line-height {}x (need >=1.3)", to_fixed(ratio, 2)),
                    ));
                }
            }
        }
    }

    // --- Justified text (without hyphens) ---
    if has_direct_text && st("textAlign") == "justify" {
        let hyphens = {
            let a = st("hyphens");
            if !a.is_empty() {
                a
            } else {
                st("webkitHyphens")
            }
        };
        if hyphens != "auto" {
            findings.push(RuleHit::new(
                "justified-text",
                "text-align: justify without hyphens: auto".to_string(),
            ));
        }
    }

    // --- Tiny body text ---
    if has_direct_text && text_len > 20 && font_size < 12.0 {
        let skip_tags = ["sub", "sup", "code", "kbd", "samp", "var", "caption", "figcaption"];
        let in_ui_context = closest_or_none(dom, el, TINY_TEXT_UI_CONTEXT).is_some();
        let is_uppercase = st("textTransform") == "uppercase";
        if !skip_tags.contains(&tag)
            && !in_ui_context
            && !is_uppercase
            && !is_non_rendered_text(dom, el, tag)
        {
            findings.push(RuleHit::new(
                "tiny-text",
                format!("{}px body text", number_to_string(font_size)),
            ));
        }
    }

    // --- Undersized functional / UI text ---
    {
        let dt = js::trim(&collapse_ws(&direct_text(dom, el))).to_string();
        let dt_len = utf16_len(&dt);
        let ui_skip_tags = ["sub", "sup", "option"];
        if font_size > 0.0
            && font_size < 11.0
            && dt_len >= 2
            && !ui_skip_tags.contains(&tag)
            && !is_non_rendered_text(dom, el, tag)
        {
            let is_exempt_context = matches_or_closest(dom, el, EXEMPT_CONTEXT);
            if !is_exempt_context && !is_visually_hidden(dom, el) {
                let is_interactive = matches_or_closest(dom, el, INTERACTIVE);
                let is_furniture = matches_or_closest(dom, el, FURNITURE);
                let is_smallprint = matches_or_closest(dom, el, SMALLPRINT);
                let floor = if !is_interactive && is_smallprint { 10.0 } else { 11.0 };
                if font_size < floor && (is_interactive || is_furniture || dt_len <= 20) {
                    let excerpt = slice_utf16_prefix(&dt, 40);
                    findings.push(RuleHit::new(
                        "undersized-ui-text",
                        format!(
                            "{}px functional text \"{}\" (below {}px floor)",
                            number_to_string(font_size),
                            excerpt,
                            number_to_string(floor)
                        ),
                    ));
                }
            }
        }
    }

    // --- All-caps body text ---
    if has_direct_text && text_len > 30 && st("textTransform") == "uppercase" && !is_heading {
        findings.push(RuleHit::new(
            "all-caps-body",
            format!("text-transform: uppercase on {} chars of body text", text_len),
        ));
    }

    // --- Wide letter spacing on body text ---
    if has_direct_text && text_len > 20 && st("textTransform") != "uppercase" {
        if let Some(ls) = q.letter_spacing_px {
            if ls > 0.0 && font_size > 0.0 {
                let tracking_em = ls / font_size;
                if tracking_em > 0.05 {
                    findings.push(RuleHit::new(
                        "wide-tracking",
                        format!("letter-spacing: {}em on body text", to_fixed(tracking_em, 2)),
                    ));
                }
            }
        }
    }

    // --- Crushed letter spacing ---
    if has_direct_text && text_len > 20 && font_size > 0.0 {
        if let Some(ls) = q.letter_spacing_px {
            if ls < 0.0 {
                let tracking_em = ls / font_size;
                if tracking_em <= -0.05 {
                    let excerpt = slice_utf16_prefix(
                        &collapse_ws(js::trim(&dom.text_content(el))),
                        40,
                    );
                    findings.push(RuleHit::new(
                        "extreme-negative-tracking",
                        format!("letter-spacing: {}em — \"{}\"", to_fixed(tracking_em, 2), excerpt),
                    ));
                }
            }
        }
    }

    findings
}

/// JS: checks.mjs#checkElementQualityDOM(el)
pub fn check_element_quality_dom(dom: &dyn Dom, el: ElId, config: &BrowserConfig) -> Vec<RuleHit> {
    let tag = tag_lower(dom, el);
    let has_direct_text = has_direct_text_longer_than(dom, el, 10);
    let text_len = utf16_len(js::trim(&dom.text_content(el)));
    let font_size = {
        let n = parse_float(&dom.style(el, "fontSize"));
        if crate::js_ext_a::num_truthy(n) {
            n
        } else {
            16.0
        }
    };
    let line_height_px = resolve_length_px(Some(&dom.style(el, "lineHeight")), font_size);
    let letter_spacing_px = resolve_length_px(Some(&dom.style(el, "letterSpacing")), font_size);
    let rect = dom.rect(el);
    let line_max = config.line_max();
    let viewport_width = {
        let w = dom.inner_width();
        if crate::js_ext_a::num_truthy(w) {
            w
        } else {
            0.0
        }
    };
    check_quality(
        dom,
        &QualityInput {
            el,
            tag,
            has_direct_text,
            text_len,
            font_size,
            line_height_px,
            letter_spacing_px,
            rect,
            line_max,
            viewport_width,
        },
    )
}

/// JS: checks.mjs#checkPageQualityFromDoc(doc)
pub fn check_page_quality_from_doc(dom: &dyn Dom) -> Vec<RuleHit> {
    let mut findings = Vec::new();
    let mut prev_level: i64 = 0;
    let mut prev_text = String::new();
    for h in dom.query_all(None, "h1, h2, h3, h4, h5, h6").unwrap_or_default() {
        let tag = dom.tag_name(h);
        // JS `parseInt(h.tagName[1])`
        let level = js::parse_int(&tag.chars().nth(1).map(|c| c.to_string()).unwrap_or_default(), 10);
        let level = if level.is_nan() { 0 } else { level as i64 };
        let text = slice_utf16_prefix(&collapse_ws(js::trim(&dom.text_content(h))), 60);
        if prev_level > 0 && level > prev_level + 1 {
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
    }
    findings
}

/// JS: checks.mjs#checkPageQualityDOM() — `{ type, detail }` shape.
pub fn check_page_quality_dom(dom: &dyn Dom) -> Vec<BrowserFinding> {
    check_page_quality_from_doc(dom)
        .iter()
        .map(BrowserFinding::from_hit)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::browser::fake_dom::FakeDom;

    fn text_el(d: &mut FakeDom, body: ElId, tag: &str, text: &str, font: &str) -> ElId {
        let p = d.add(Some(body), tag);
        d.add_text(p, text);
        d.set_styles(
            p,
            &[
                ("fontSize", font),
                ("lineHeight", "normal"),
                ("letterSpacing", "normal"),
                ("backgroundColor", "rgba(0, 0, 0, 0)"),
                ("position", "static"),
                ("textTransform", "none"),
                ("textAlign", "start"),
            ],
        );
        p
    }

    #[test]
    fn line_length_and_viewport_edge() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let long = "x".repeat(120);
        let p = text_el(&mut d, body, "p", &long, "16px");
        d.set_rect(p, 0.0, 100.0, 1200.0, 40.0);
        let hits = check_element_quality_dom(&d, p, &BrowserConfig::default());
        let ids: Vec<&str> = hits.iter().map(|h| h.id.as_str()).collect();
        assert!(ids.contains(&"line-length"), "{ids:?}");
        assert_eq!(hits[0].snippet, "~150 chars/line (aim for <80)");
        assert!(ids.contains(&"body-text-viewport-edge"));
        let edge = hits.iter().find(|h| h.id == "body-text-viewport-edge").unwrap();
        assert_eq!(edge.snippet, "<p> with 120-char body bleeds to viewport edge (left 0px)");
        // narrower, inset paragraph: neither fires
        d.set_rect(p, 40.0, 100.0, 600.0, 40.0);
        let hits = check_element_quality_dom(&d, p, &BrowserConfig::default());
        assert!(hits.is_empty(), "{hits:?}");
    }

    #[test]
    fn cramped_padding_vertical() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        d.set_style(body, "backgroundColor", "rgb(255, 255, 255)");
        let p = text_el(&mut d, body, "div", &"word ".repeat(10), "16px");
        d.set_rect(p, 40.0, 100.0, 300.0, 60.0);
        d.set_styles(
            p,
            &[
                ("backgroundColor", "rgb(240, 240, 240)"),
                ("borderTopWidth", "0px"),
                ("borderRightWidth", "0px"),
                ("borderBottomWidth", "0px"),
                ("borderLeftWidth", "0px"),
                ("paddingTop", "2px"),
                ("paddingBottom", "12px"),
                ("paddingLeft", "12px"),
                ("paddingRight", "12px"),
            ],
        );
        let hits = check_element_quality_dom(&d, p, &BrowserConfig::default());
        assert_eq!(hits.len(), 1, "{hits:?}");
        assert_eq!(hits[0].snippet, "2px vertical padding (need ≥4.8px for 16px text)");
    }

    #[test]
    fn flush_children_against_border() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let card = d.add(Some(body), "section");
        d.set_attr(card, "class", "card-frame extra");
        d.set_rect(card, 0.0, 0.0, 400.0, 200.0);
        d.set_styles(
            card,
            &[
                ("position", "static"),
                ("borderTopWidth", "1px"),
                ("borderRightWidth", "1px"),
                ("borderBottomWidth", "1px"),
                ("borderLeftWidth", "1px"),
                ("borderTopColor", "rgb(0, 0, 0)"),
                ("borderRightColor", "rgb(0, 0, 0)"),
                ("borderBottomColor", "rgb(0, 0, 0)"),
                ("borderLeftColor", "rgb(0, 0, 0)"),
                ("outlineWidth", "0px"),
                ("backgroundColor", "rgba(0, 0, 0, 0)"),
                ("paddingTop", "28px"),
                ("paddingRight", "0px"),
                ("paddingBottom", "0px"),
                ("paddingLeft", "0px"),
                ("fontSize", "16px"),
            ],
        );
        let p = text_el(&mut d, card, "p", "Hello there friend", "16px");
        d.set_rect(p, 0.0, 28.0, 400.0, 20.0);
        d.set_styles(p, &[("paddingTop", "0px"), ("paddingRight", "0px"), ("paddingBottom", "0px"), ("paddingLeft", "0px"), ("marginTop", "0px"), ("marginRight", "0px"), ("marginBottom", "0px"), ("marginLeft", "0px")]);
        let hits = check_element_quality_dom(&d, card, &BrowserConfig::default());
        assert_eq!(hits.len(), 1, "{hits:?}");
        assert_eq!(
            hits[0].snippet,
            "<section> \"card-frame\": children flush against border on right/left (no inset)"
        );
    }

    #[test]
    fn typography_rules() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let text = "a".repeat(60);
        let p = text_el(&mut d, body, "p", &text, "16px");
        d.set_rect(p, 40.0, 100.0, 300.0, 40.0);
        d.set_styles(p, &[("lineHeight", "16px"), ("textAlign", "justify"), ("hyphens", "manual"), ("letterSpacing", "2px")]);
        let hits = check_element_quality_dom(&d, p, &BrowserConfig::default());
        let ids: Vec<&str> = hits.iter().map(|h| h.id.as_str()).collect();
        assert_eq!(ids, vec!["tight-leading", "justified-text", "wide-tracking"], "{hits:?}");
        assert_eq!(hits[0].snippet, "line-height 1.00x (need >=1.3)");
        assert_eq!(hits[2].snippet, "letter-spacing: 0.13em on body text");
        d.set_styles(p, &[("lineHeight", "24px"), ("textAlign", "left"), ("letterSpacing", "-1px"), ("textTransform", "uppercase")]);
        let hits = check_element_quality_dom(&d, p, &BrowserConfig::default());
        let ids: Vec<&str> = hits.iter().map(|h| h.id.as_str()).collect();
        assert_eq!(ids, vec!["all-caps-body", "extreme-negative-tracking"], "{hits:?}");
        assert_eq!(hits[1].snippet, format!("letter-spacing: -0.06em — \"{}\"", "a".repeat(40)));
    }

    #[test]
    fn tiny_and_undersized_text() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let p = text_el(&mut d, body, "p", "This is small body copy text", "10px");
        d.set_rect(p, 40.0, 100.0, 300.0, 40.0);
        let hits = check_element_quality_dom(&d, p, &BrowserConfig::default());
        let ids: Vec<&str> = hits.iter().map(|h| h.id.as_str()).collect();
        assert_eq!(ids, vec!["tiny-text"], "{hits:?}");
        assert_eq!(hits[0].snippet, "10px body text");
        // short functional label under 11px
        let s = text_el(&mut d, body, "span", "Meta 12:00", "9px");
        d.set_rect(s, 40.0, 100.0, 60.0, 12.0);
        let hits = check_element_quality_dom(&d, s, &BrowserConfig::default());
        assert_eq!(hits.len(), 1, "{hits:?}");
        assert_eq!(hits[0].snippet, "9px functional text \"Meta 12:00\" (below 11px floor)");
        // smallprint context softens the floor to 10px
        d.add_selector(s, SMALLPRINT);
        d.set_style(s, "fontSize", "10px");
        assert!(check_element_quality_dom(&d, s, &BrowserConfig::default()).is_empty());
        // sr-only exempts
        d.set_style(s, "fontSize", "9px");
        d.add_selector(s, SR_ONLY_SELECTOR);
        assert!(check_element_quality_dom(&d, s, &BrowserConfig::default()).is_empty());
    }

    #[test]
    fn skipped_heading() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let h1 = d.add(Some(body), "h1");
        d.add_text(h1, "  Title   here ");
        let h3 = d.add(Some(body), "h3");
        d.add_text(h3, "Sub");
        let f = check_page_quality_dom(&d);
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].type_, "skipped-heading");
        assert_eq!(f[0].detail, "<h1> \"Title here\" followed by <h3> \"Sub\" (missing h2)");
    }

    #[test]
    fn visually_hidden_and_non_rendered() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let s = d.add(Some(body), "span");
        d.set_styles(s, &[("position", "absolute"), ("clip", "rect(0px, 0px, 0px, 0px)")]);
        assert!(is_visually_hidden(&d, s));
        d.set_styles(s, &[("clip", "auto"), ("width", "1px"), ("height", "20px"), ("overflow", "hidden")]);
        assert!(is_visually_hidden(&d, s));
        d.set_style(s, "overflow", "visible");
        assert!(!is_visually_hidden(&d, s));
        assert!(is_non_rendered_text(&d, s, "script"));
        d.set_style(s, "visibility", "collapse");
        assert!(is_non_rendered_text(&d, s, "span"));
    }
}
