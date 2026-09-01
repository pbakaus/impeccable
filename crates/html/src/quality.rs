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
    colors_nearly_match, css_color_is_transparent, resolve_length_px,
};
use impeccable_core::checks::rules::RuleHit;
use impeccable_core::checks::text_rules::{NON_RENDERED_TAGS, SR_ONLY_SELECTOR};
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

/// JS: checks.mjs#resolveFontSizePx(el, win)
pub fn resolve_font_size_px(el: &StaticElement<'_>) -> f64 {
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
    px
}

/// JS: checks.mjs#hasVisibleBackgroundBoundary(style, el, win)
pub fn has_visible_background_boundary(style: &StyleValues, el: &StaticElement<'_>) -> bool {
    let bg = sv(style, "backgroundColor");
    if css_color_is_transparent(Some(bg)) {
        return false;
    }
    let mut parent = el.parent_element();
    while let Some(p) = parent {
        let parent_bg = sv(p.style(), "backgroundColor");
        if !css_color_is_transparent(Some(parent_bg)) {
            return !colors_nearly_match(Some(bg), Some(parent_bg));
        }
        parent = p.parent_element();
    }
    true
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

/// Inputs of `checkQuality` as the static adapter builds them.
pub struct QualityInput<'a, 'b> {
    pub el: &'b StaticElement<'a>,
    pub tag: &'b str,
    pub style: &'a StyleValues,
    pub has_direct_text: bool,
    pub text_len: usize,
    pub font_size: f64,
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
const INTERACTIVE: &str = "a[href], button, summary, label, select, textarea, [role=\"button\"], [role=\"link\"], [role=\"tab\"], [role=\"menuitem\"], [role=\"menuitemcheckbox\"], [role=\"menuitemradio\"], [role=\"option\"], [role=\"checkbox\"], [role=\"radio\"], [role=\"switch\"], [role=\"treeitem\"], [tabindex]";
const FURNITURE: &str = "nav, [role=\"navigation\"], td, th, [role=\"gridcell\"], [role=\"cell\"], caption, figcaption, dt, dd, footer, [class*=\"meta\" i], [class*=\"label\" i], [class*=\"badge\" i], [class*=\"chip\" i], [class*=\"pill\" i], [class*=\"tag\" i], [class*=\"kicker\" i], [class*=\"eyebrow\" i], [class*=\"breadcrumb\" i], [class*=\"timestamp\" i], [class*=\"category\" i], [class*=\"caption\" i], [class*=\"nav\" i]";
const SMALLPRINT: &str = "small, footer, [class*=\"legal\" i], [class*=\"copyright\" i], [class*=\"fineprint\" i], [class*=\"fine-print\" i], [class*=\"smallprint\" i], [class*=\"small-print\" i], [class*=\"disclaimer\" i], [class*=\"disclosure\" i], [class*=\"footnote\" i]";

fn side_len(style: &StyleValues, key: &str, font_size: f64) -> f64 {
    resolve_length_px(sv_opt(style, key), font_size).unwrap_or(0.0)
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
            if tag == "img" || RASTER_URL_RE.is_match(bg) {
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
            let bc = |k: &str| css_color_is_transparent(Some(sv(style, k)));
            let border_visible = [
                border_w[0] > 0.0 && !bc("borderTopColor"),
                border_w[1] > 0.0 && !bc("borderRightColor"),
                border_w[2] > 0.0 && !bc("borderBottomColor"),
                border_w[3] > 0.0 && !bc("borderLeftColor"),
            ];
            let outline_w = pf0(sv(style, "outlineWidth"));
            let outline_style_val = sv(style, "outlineStyle");
            let outline_color_val = sv(style, "outlineColor");
            // `style.outline` is never set on a static style: the shorthand
            // fallback branch is unreachable here.
            let outline_visible = outline_w > 0.0
                && !css_color_is_transparent(Some(outline_color_val))
                && !outline_style_val.is_empty()
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
                const CHILD_INSULATE_THRESHOLD: f64 = 4.0;
                let mut children_insulate = [false; 4];
                for child in &children {
                    let cs = child.style();
                    let child_pad = [
                        side_len(cs, "paddingTop", font_size),
                        side_len(cs, "paddingRight", font_size),
                        side_len(cs, "paddingBottom", font_size),
                        side_len(cs, "paddingLeft", font_size),
                    ];
                    let child_margin = [
                        side_len(cs, "marginTop", font_size),
                        side_len(cs, "marginRight", font_size),
                        side_len(cs, "marginBottom", font_size),
                        side_len(cs, "marginLeft", font_size),
                    ];
                    for s in 0..4 {
                        if child_pad[s] >= CHILD_INSULATE_THRESHOLD
                            || child_margin[s] >= CHILD_INSULATE_THRESHOLD
                        {
                            children_insulate[s] = true;
                        }
                    }
                }
                let side_names = ["top", "right", "bottom", "left"];
                let mut flush_sides: Vec<&str> = Vec::new();
                for s in 0..4 {
                    let bg_bounds_side = bg_visible;
                    let side_bounded = border_visible[s] || outline_visible || bg_bounds_side;
                    if side_bounded && pad[s] <= PAD_THRESHOLD && !children_insulate[s] {
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
    if q.has_direct_text && sv_opt(style, "textAlign") == Some("justify") {
        let hyphens = {
            let a = sv(style, "hyphens");
            if !a.is_empty() {
                a
            } else {
                sv(style, "webkitHyphens")
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
    if q.has_direct_text && text_len > 20 && font_size < 12.0 {
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
            findings.push(RuleHit::new(
                "tiny-text",
                format!("{}px body text", number_to_string(font_size)),
            ));
        }
    }

    // --- Undersized functional / UI text ---
    {
        let direct_text = js::trim(&collapse_ws(&el.direct_text())).to_string();
        let dt_len = utf16_len(&direct_text);
        let ui_skip_tags = ["sub", "sup", "option"];
        if font_size > 0.0
            && font_size < 11.0
            && dt_len >= 2
            && !ui_skip_tags.contains(&tag)
            && !is_non_rendered_text(el, tag, Some(style))
        {
            let is_exempt_context = el.closest(EXEMPT_CONTEXT).is_some();
            if !is_exempt_context && !is_visually_hidden(el, style) {
                let is_interactive = el.closest(INTERACTIVE).is_some();
                let is_furniture = el.closest(FURNITURE).is_some();
                let is_smallprint = el.closest(SMALLPRINT).is_some();
                let floor = if !is_interactive && is_smallprint {
                    10.0
                } else {
                    11.0
                };
                if font_size < floor && (is_interactive || is_furniture || dt_len <= 20) {
                    let excerpt = slice_utf16_prefix(&direct_text, 40);
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
    if q.has_direct_text
        && text_len > 30
        && sv_opt(style, "textTransform") == Some("uppercase")
        && !is_heading
    {
        findings.push(RuleHit::new(
            "all-caps-body",
            format!(
                "text-transform: uppercase on {} chars of body text",
                text_len
            ),
        ));
    }

    // --- Wide letter spacing on body text ---
    if q.has_direct_text && text_len > 20 && sv_opt(style, "textTransform") != Some("uppercase") {
        if let Some(ls) = q.letter_spacing_px {
            if ls > 0.0 && font_size > 0.0 {
                let tracking_em = ls / font_size;
                if tracking_em > 0.05 {
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

    // --- Crushed letter spacing ---
    if q.has_direct_text && text_len > 20 && font_size > 0.0 {
        if let Some(ls) = q.letter_spacing_px {
            if ls < 0.0 {
                let tracking_em = ls / font_size;
                if tracking_em <= -0.05 {
                    let excerpt =
                        slice_utf16_prefix(&collapse_ws(js::trim(&el.text_content())), 40);
                    findings.push(RuleHit::new(
                        "extreme-negative-tracking",
                        format!(
                            "letter-spacing: {}em — \"{}\"",
                            to_fixed(tracking_em, 2),
                            excerpt
                        ),
                    ));
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
    let line_height_px = resolve_length_px(sv_opt(style, "lineHeight"), font_size);
    let letter_spacing_px = resolve_length_px(sv_opt(style, "letterSpacing"), font_size);
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
pub fn check_page_quality_from_doc(doc: &crate::dom::StaticDocument) -> Vec<RuleHit> {
    let mut findings = Vec::new();
    let mut prev_level: i64 = 0;
    let mut prev_text = String::new();
    for h in doc.query_selector_all("h1, h2, h3, h4, h5, h6") {
        let tag = h.tag_upper();
        let level = tag[1..2].parse::<i64>().unwrap_or(0);
        let text = slice_utf16_prefix(&collapse_ws(js::trim(&h.text_content())), 60);
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

/// The `childNodes`-based `hasText` used by `checkStaticPageTypography`.
pub fn has_nonblank_direct_text(el: &StaticElement<'_>) -> bool {
    el.child_nodes()
        .iter()
        .any(|c| matches!(c, ChildNode::Text(t) if !js::trim(t).is_empty()))
}
