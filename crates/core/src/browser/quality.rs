//! `checkQuality` and its browser adapters from `checks.mjs` Section 5:
//! `checkQuality` (every branch, including the rect-gated ones the static
//! engine never reaches), `checkElementQualityDOM`,
//! `hasVisibleBackgroundBoundary`, `hasMeaningfulDirectText`,
//! `textDescendantsFlushSides`, `isVisuallyHidden`, `isNonRenderedText`,
//! `checkPageQualityFromDoc`, `checkPageQualityDOM`.

#![allow(unused_imports)]
use super::dom::{
    closest_or_none, direct_text, has_direct_text_longer_than, matches_or_false, pf0, safe_id,
    renders_no_text, style_px, tag_lower, Dom, DomChild, ElId, Rect,
};
use super::{BrowserConfig, BrowserFinding};
use crate::checks::measures::{
    chars_per_line, colors_nearly_match, css_color_is_transparent, is_capitalized_run,
    resolve_length_px, text_wraps_to_multiple_lines, TRACKED_LABEL_MAX_CHARS,
};
use crate::checks::rules::RuleHit;
use super::text_geometry::{
    holds_only_phrasing, line_pitch_px, phrasing_holds_break, phrasing_text_extent, phrasing_text_font,
    clamp_to_own_clip, rides_a_running_track, scrolling_ancestor_cuts, text_line_count,
};
use crate::checks::text_rules::{
    average_glyph_advance_em_at, font_weight_number, is_bold_title_leading, is_cjk_text,
    is_line_clamp, is_under_ui_text_floor, justifies_without_word_spaces_text,
    tracking_is_crushed, ALL_CAPS_LONG_RUN, LEADING_BOLD_TITLE_WEIGHT, SMALLPRINT_TEXT_FLOOR_PX,
    UI_TEXT_FLOOR_PX,
    JUSTIFY_NARROW_CHARS_PER_LINE, LEADING_DISPLAY_TYPE_PX, LEADING_HEADING_CONTEXT,
    LEADING_MIN_LINE_BOXES, NON_RENDERED_TAGS, QUALITY_TEXT_TAGS,
    SR_ONLY_SELECTOR, TEXT_EDGE_TAGS,
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
const INTERACTIVE: &str = "a[href], button, summary, label, select, textarea, [role=\"button\"], [role=\"link\"], [role=\"tab\"], [role=\"menuitem\"], [role=\"menuitemcheckbox\"], [role=\"menuitemradio\"], [role=\"option\"], [role=\"checkbox\"], [role=\"radio\"], [role=\"switch\"], [role=\"treeitem\"]";

/// The most text, in UTF-16 units, a focusable box holds while it still reads
/// as one control with a label: a tab, a chip, a custom button. Past this the
/// box is a region a visitor can focus (a card, an accordion item, a scroll
/// area), and the text inside it is content.
const FOCUSABLE_CONTROL_MAX_CHARS: usize = 80;

/// Whether `el` is, or sits in, a control: one of the [`INTERACTIVE`]
/// elements and roles, or a box made focusable with `tabindex`.
///
/// `tabindex` alone names no control. A negative value takes the box out of
/// the tab order (a skip-link target, a dialog focused from script), and
/// builders put `tabindex="0"` on whole components: directus.io's Framer
/// accordion item is a 358 by 531px focusable box around a code sample, a
/// heading and a paragraph. So a `tabindex` box counts when its value is not
/// negative and it holds at most [`FOCUSABLE_CONTROL_MAX_CHARS`] of text.
fn is_in_control(dom: &dyn Dom, el: ElId) -> bool {
    if matches_or_closest(dom, el, INTERACTIVE) {
        return true;
    }
    let mut cur = Some(el);
    while let Some(c) = cur {
        if let Some(value) = dom.attr(c, "tabindex") {
            let index = parse_float(js::trim(&value));
            let focusable = !(index.is_finite() && index < 0.0);
            if focusable
                && utf16_len(js::trim(&collapse_ws(&dom.text_content(c)))) <= FOCUSABLE_CONTROL_MAX_CHARS
            {
                return true;
            }
        }
        cur = dom.parent(c);
    }
    false
}
const FURNITURE: &str = "nav, [role=\"navigation\"], td, th, [role=\"gridcell\"], [role=\"cell\"], caption, figcaption, dt, dd, footer, [class*=\"meta\" i], [class*=\"label\" i], [class*=\"badge\" i], [class*=\"chip\" i], [class*=\"pill\" i], [class*=\"tag\" i], [class*=\"kicker\" i], [class*=\"eyebrow\" i], [class*=\"breadcrumb\" i], [class*=\"timestamp\" i], [class*=\"category\" i], [class*=\"caption\" i], [class*=\"nav\" i]";
const SMALLPRINT: &str = "small, footer, [class*=\"legal\" i], [class*=\"copyright\" i], [class*=\"fineprint\" i], [class*=\"fine-print\" i], [class*=\"smallprint\" i], [class*=\"small-print\" i], [class*=\"disclaimer\" i], [class*=\"disclosure\" i], [class*=\"footnote\" i]";
const TEXT_EDGE_QUERY: &str =
    "a, button, code, dd, dt, figcaption, h1, h2, h3, h4, h5, h6, li, p, pre, span, td, th";

/// JS `(el.matches && el.matches(sel)) || (el.closest && el.closest(sel))`.
fn matches_or_closest(dom: &dyn Dom, el: ElId, sel: &str) -> bool {
    matches_or_false(dom, el, sel) || closest_or_none(dom, el, sel).is_some()
}

/// The colour a browser paints behind a page that sets no background of its
/// own, under the light colour scheme: a white box on an unpainted light page
/// draws no edge.
pub const CANVAS_BACKGROUND: &str = "rgb(255, 255, 255)";

/// Whether the canvas under an unpainted chain is the light one
/// [`CANVAS_BACKGROUND`] names. A page that asks for a dark scheme gets a dark
/// canvas from the browser, and any value that mentions `dark` may resolve
/// that way, so only a plainly light scheme lets the comparison run.
pub fn canvas_is_light(scheme: &str) -> bool {
    !js::to_lower_case(scheme).contains("dark")
}

/// JS: checks.mjs#hasVisibleBackgroundBoundary(style, el, win) — browser:
/// `style` is `el`'s own computed style, `win` the live window. The JS
/// answered `true` when no ancestor painted; the canvas under an unpainted
/// light chain is white, so a white box there is compared against it like any
/// other ground.
pub fn has_visible_background_boundary(dom: &dyn Dom, el: ElId) -> bool {
    let bg = dom.style(el, "backgroundColor");
    if css_color_is_transparent(Some(&bg)) {
        return false;
    }
    let mut parent = dom.parent(el);
    while let Some(p) = parent {
        if gradient_paints_only(dom, p, el, &bg) {
            return false;
        }
        let parent_bg = dom.style(p, "backgroundColor");
        if !css_color_is_transparent(Some(&parent_bg)) {
            return !colors_nearly_match(Some(&bg), Some(&parent_bg));
        }
        parent = dom.parent(p);
    }
    // `colorScheme` is inherited, so the element's own computed value is the
    // page's.
    if !canvas_is_light(&dom.style(el, "colorScheme")) {
        return true;
    }
    !colors_nearly_match(Some(&bg), Some(CANVAS_BACKGROUND))
}

/// Whether `node`'s `background-image` is gradients alone, and every colour
/// they paint that shows (alpha over 0.05) nearly matches `fill`: the box
/// paints `fill` itself, so a box of that fill laid on it draws no edge.
/// freddiemac.com paints its grey cards with `linear-gradient(to right,
/// transparent 50px, #f3f3f3 50px)` on the row, and the grey text panel in
/// the row is the same grey. A picture (`url(...)`), a gradient this cannot
/// read, or one drawn at a `background-size` that does not fill the box says
/// nothing, and the walk goes on as before.
///
/// A gradient with transparent stops paints the fill only where those stops
/// are not: it is read only in the one shape freddiemac.com uses, a single
/// `linear-gradient` running to one side that is transparent up to a length
/// and the fill after it, and only when `el` lies wholly in the filled part.
fn gradient_paints_only(dom: &dyn Dom, node: ElId, el: ElId, fill: &str) -> bool {
    let image = dom.style(node, "backgroundImage");
    if image.is_empty() || image == "none" || !image.contains("gradient(") || image.contains("url(") {
        return false;
    }
    // A gradient drawn at a size of its own (a 2px rule along one edge:
    // `background-size: 100% 2px`) paints only that strip, and where is not
    // read here, so it says nothing about what lies under `el`.
    let size = dom.style(node, "backgroundSize");
    let fills_the_box = size.split(',').all(|layer| {
        matches!(
            js::trim(layer),
            "" | "auto" | "auto auto" | "cover" | "contain" | "100%" | "100% auto" | "auto 100%" | "100% 100%"
        )
    });
    if !fills_the_box {
        return false;
    }
    let colors = crate::color::parse_gradient_colors(Some(&image));
    let shown: Vec<_> = colors.iter().filter(|c| c.alpha_or_one() > 0.05).collect();
    let matches = !shown.is_empty()
        && shown.iter().all(|c| {
            colors_nearly_match(
                Some(fill),
                Some(&format!("rgba({}, {}, {}, {})", c.r, c.g, c.b, c.alpha_or_one())),
            )
        });
    if !matches {
        return false;
    }
    if shown.len() == colors.len() {
        return true;
    }
    match transparent_lead(&image) {
        Some((side, len)) => {
            let host = dom.rect(node);
            let r = dom.rect(el);
            // A length stop is in layout pixels; the rects are drawn at the
            // host's scale, which need not be the same on both axes
            // (`scaleX(0.5)` moves no vertical stop): a stop along x takes
            // the width's scale, one along y the height's.
            let start = |l: f64, scale: f64| if len.1 { l * len.0 / 100.0 } else { len.0 * scale };
            let across = || start(host.width, drawn_scale(dom, node, &host));
            let down = || start(host.height, drawn_scale_y(dom, node, &host));
            match side {
                "right" => r.left >= host.left + across() - 0.5,
                "left" => r.right <= host.right - across() + 0.5,
                "bottom" => r.top >= host.top + down() - 0.5,
                _ => r.bottom <= host.bottom - down() + 0.5,
            }
        }
        None => false,
    }
}

static TRANSPARENT_LEAD_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"^linear-gradient\(to (right|left|bottom|top), (?:transparent|rgba\(0, 0, 0, 0\)) ([0-9.]+)(px|%), (rgba?\([^)]*\)|#[0-9a-fA-F]+) ([0-9.]+)(px|%)\)$",
    )
    .unwrap()
});

/// `(side, (length, is_percent))` of a `linear-gradient(to <side>,
/// transparent <len>, <colour> <same len>)`: a hard edge where the fill
/// starts.
fn transparent_lead(image: &str) -> Option<(&'static str, (f64, bool))> {
    let m = TRANSPARENT_LEAD_RE.captures(js::trim(image))?;
    if m[2] != m[5] || m[3] != m[6] {
        return None;
    }
    let side = match &m[1] {
        "right" => "right",
        "left" => "left",
        "bottom" => "bottom",
        _ => "top",
    };
    Some((side, (parse_float(&m[2]), &m[3] == "%")))
}

/// Whether a box laid under `el`'s rect paints a photo there: an `img` or
/// `video`, itself or inside it, whose own rect covers `r`. The photo's rect,
/// not its wrapper's: an inline `<picture>` reports the line box its image
/// sits on, not the image. A `canvas` is drawn content (a map, a chart), and
/// a panel laid on it keeps its edge.
fn raster_covers(dom: &dyn Dom, layer: ElId, r: &Rect) -> bool {
    let covers = |n: ElId| {
        let nr = dom.rect(n);
        nr.left <= r.left + 1.0 && nr.right >= r.right - 1.0 && nr.top <= r.top + 1.0 && nr.bottom >= r.bottom - 1.0
    };
    let is_raster = |n: ElId| matches!(tag_lower(dom, n).as_str(), "img" | "video");
    // The photo has to paint: shown, and not faded out by itself or a box
    // between it and the layer.
    let paints = |n: ElId| {
        if dom.style(n, "display") == "none" || dom.style(n, "visibility") == "hidden" {
            return false;
        }
        let mut cur = Some(n);
        while let Some(c) = cur {
            let o = parse_float(&dom.style(c, "opacity"));
            if o.is_finite() && o <= 0.05 {
                return false;
            }
            if c == layer {
                break;
            }
            cur = dom.parent(c);
        }
        true
    };
    if is_raster(layer) {
        return paints(layer) && covers(layer);
    }
    dom.query_all(Some(layer), "img, video")
        .unwrap_or_default()
        .into_iter()
        .any(|n| paints(n) && covers(n))
}

/// Whether the fill `el` paints lies on a layer painting the same colour: a
/// sibling laid earlier (so painted under it) that covers it, of `el` or of
/// an ancestor below the first one that paints a background of its own.
/// hp.com's grey grid sits in a section whose grey is an absolutely
/// positioned media layer beside the content, not an ancestor, so the
/// background walk reads the white page behind both and sees an edge no
/// reader sees.
fn backdrop_layer_matches(dom: &dyn Dom, el: ElId) -> bool {
    let bg = dom.style(el, "backgroundColor");
    if css_color_is_transparent(Some(&bg)) {
        return false;
    }
    let r = dom.rect(el);
    let mut node = el;
    for _ in 0..12 {
        let mut prev = dom.previous_element_sibling(node);
        while let Some(s) = prev {
            prev = dom.previous_element_sibling(s);
            if dom.style(s, "display") == "none" {
                continue;
            }
            let sr = dom.rect(s);
            let covers = sr.left <= r.left + 1.0
                && sr.right >= r.right - 1.0
                && sr.top <= r.top + 1.0
                && sr.bottom >= r.bottom - 1.0;
            let fill = dom.style(s, "backgroundColor");
            if covers && !css_color_is_transparent(Some(&fill)) {
                return colors_nearly_match(Some(&bg), Some(&fill));
            }
            // A photo laid under the fill (telekom.de's magenta card on a
            // magenta photo) is what the reader sees around it, and its
            // colours are not read here: the edge the fill draws against
            // the page behind the photo is not one a reader sees.
            if raster_covers(dom, s, &r) {
                return true;
            }
        }
        let Some(parent) = dom.parent(node) else { return false };
        if !css_color_is_transparent(Some(&dom.style(parent, "backgroundColor"))) {
            return false;
        }
        node = parent;
    }
    false
}

/// Whether the band `el` paints continues past `side` (0 top, 1 right, 2
/// bottom, 3 left) into a sibling that abuts it there with the same fill:
/// cencora.com stacks grey bands, and the edge between two of them is no
/// edge at all.
fn side_meets_same_fill(dom: &dyn Dom, el: ElId, rect: &Rect, side: usize) -> bool {
    let bg = dom.style(el, "backgroundColor");
    if css_color_is_transparent(Some(&bg)) {
        return false;
    }
    let Some(parent) = dom.parent(el) else { return false };
    dom.children(parent).into_iter().any(|s| {
        if s == el || dom.style(s, "display") == "none" {
            return false;
        }
        let sr = dom.rect(s);
        if !(sr.width > 0.0 && sr.height > 0.0) {
            return false;
        }
        let across = |a0: f64, a1: f64, b0: f64, b1: f64| {
            js::math_min(a1, b1) - js::math_max(a0, b0) >= (a1 - a0) * 0.9
        };
        let abuts = match side {
            0 => (sr.bottom - rect.top).abs() <= 1.5 && across(rect.left, rect.right, sr.left, sr.right),
            2 => (sr.top - rect.bottom).abs() <= 1.5 && across(rect.left, rect.right, sr.left, sr.right),
            1 => (sr.left - rect.right).abs() <= 1.5 && across(rect.top, rect.bottom, sr.top, sr.bottom),
            _ => (sr.right - rect.left).abs() <= 1.5 && across(rect.top, rect.bottom, sr.top, sr.bottom),
        };
        abuts && colors_nearly_match(Some(&bg), Some(&dom.style(s, "backgroundColor")))
    })
}

/// The part of `inner` that falls inside `outer`, or `None` when the two miss
/// each other.
///
/// `direct_text_rect` is a font-metric box, not an ink box. A line box tighter
/// than the font's ascent and descent pushes it out of the element's own
/// border box, and so do the tall marks of Devanagari and Thai; no glyph lands
/// out there. Only the part inside that box is what a reader gets, so every
/// edge measurement clamps first.
fn clamp_to(inner: &Rect, outer: &Rect) -> Option<Rect> {
    let left = js::math_max(inner.left, outer.left);
    let top = js::math_max(inner.top, outer.top);
    let w = js::math_min(inner.right, outer.right) - left;
    let h = js::math_min(inner.bottom, outer.bottom) - top;
    if w <= 0.0 || h <= 0.0 {
        return None;
    }
    Some(Rect::from_xywh(left, top, w, h))
}

/// The space the element's own glyphs keep from each inner edge of its box
/// (`[top, right, bottom, left]`), or `None` when it paints no direct text.
///
/// `direct_text_rect` is the union of the client rects of the element's own
/// text nodes, so this is the room a reader sees rather than the room the
/// stylesheet declares: a fixed-height flex or grid box centres its label
/// with no padding at all, and half-leading adds space of its own.
///
/// Where the capture recorded the lines, only the lines that cross the box
/// are measured: a line that wraps out of a fixed-height box (nexttv.com.tw's
/// copyright, a 66px line box whose second line lands below it) is not text
/// the box holds, and the union with it put the text on the bottom border.
/// A box none of whose lines cross it holds none of its text.
fn direct_text_insets(dom: &dyn Dom, el: ElId, rect: &Rect, border: &[f64; 4]) -> Option<[f64; 4]> {
    let t = dom.direct_text_rect(el)?;
    if t.width <= 0.0 || t.height <= 0.0 {
        return None;
    }
    let t = match dom.text_line_rects(el) {
        Some(lines) if !lines.is_empty() => {
            let crosses = |l: &Rect, b: &Rect| {
                l.top < b.bottom && l.bottom > b.top && l.left < b.right && l.right > b.left
            };
            let kept = lines
                .iter()
                .filter(|l| l.all_finite() && crosses(l, &t) && crosses(l, rect))
                .fold(None::<Rect>, |acc, l| {
                    Some(match acc {
                        None => *l,
                        Some(a) => {
                            let left = js::math_min(a.left, l.left);
                            let top = js::math_min(a.top, l.top);
                            Rect::from_xywh(
                                left,
                                top,
                                js::math_max(a.right, l.right) - left,
                                js::math_max(a.bottom, l.bottom) - top,
                            )
                        }
                    })
                })?;
            clamp_to(&kept, &t)?
        }
        _ => t,
    };
    // Text that overruns its own box still reads as cramped: the clamped rect
    // lands on the border, an inset of zero.
    let t = clamp_to(&t, rect)?;
    Some([
        t.top - (rect.top + border[0]),
        (rect.right - border[1]) - t.right,
        (rect.bottom - border[2]) - t.bottom,
        t.left - (rect.left + border[3]),
    ])
}

/// Whether text laid out at `tr` survives the clipping between `node` and
/// `el`. A panel held at `max-height: 0` and a drawer collapsed to zero width
/// still lay their text out; none of it reaches the screen, so it cannot be
/// flush against anything.
fn text_rect_survives_clipping(dom: &dyn Dom, el: ElId, node: ElId, tr: &Rect) -> bool {
    let mut cur = dom.parent(node);
    while let Some(p) = cur {
        let clips = |k: &str| {
            let v = dom.style(p, k);
            v == "hidden" || v == "clip" || v == "scroll" || v == "auto"
        };
        if clips("overflow") || clips("overflowX") || clips("overflowY") {
            let cr = dom.rect(p);
            let w = js::math_min(tr.right, cr.right) - js::math_max(tr.left, cr.left);
            let h = js::math_min(tr.bottom, cr.bottom) - js::math_max(tr.top, cr.top);
            if w < 1.0 || h < 1.0 {
                return false;
            }
        }
        if p == el {
            break;
        }
        cur = dom.parent(p);
    }
    true
}

/// JS: checks.mjs#hasMeaningfulDirectText(node)
pub fn has_meaningful_direct_text(dom: &dyn Dom, el: ElId) -> bool {
    has_direct_text_longer_than(dom, el, 4)
}

/// `cramped-padding` measures a box by its glyphs rather than by the content
/// area of its text when the box is strictly under this height. Taste call
/// r3-20 reads "chips under 28px tall", and a 28px chip is not under 28px:
/// the bound sits at 27.5px so a 28px box, or one a subpixel layout puts at
/// 27.6px, keeps the content-area measure. yungching.com.tw's 24px step chip
/// is inside it; haraj.com.sa's 28px price chip is not.
pub const SMALL_CHIP_HEIGHT_UNDER_PX: f64 = 27.5;

/// The air a small chip's glyphs need from its edges, in ems of their font
/// size, before they read as flush (capped at the 4px a full-size box needs).
pub const SMALL_CHIP_AIR_EM: f64 = 0.25;

/// The band of `t`, a text rect of `node`, that its glyphs occupy: each line's
/// em box, one font size tall and centred on the line's content area. A Range
/// rect spans the font's ascent plus descent, which for most faces runs 1.2
/// to 1.4em and leaves room above the capitals and below the descenders; that
/// room, like CSS half-leading, is space a reader sees between the glyphs and
/// the edge. Only the vertical edges move; a rect already no taller than its
/// em boxes is returned as it is.
pub fn glyph_band(dom: &dyn Dom, node: ElId, t: &Rect) -> Rect {
    glyph_band_at(dom, node, t, 1.0)
}

/// [`glyph_band`] for text drawn at `scale` times its layout size: a
/// transform that shrinks a whole column (people.com.cn lays its desktop
/// page into a phone at about 0.3) shrinks the rects but not the computed
/// font size and line height, which are layout pixels.
fn glyph_band_at(dom: &dyn Dom, node: ElId, t: &Rect, scale: f64) -> Rect {
    let font_size = parse_float(&dom.style(node, "fontSize")) * scale;
    if !(font_size.is_finite() && font_size > 0.0) {
        return *t;
    }
    let own = resolve_length_px(Some(&dom.style(node, "lineHeight")), font_size / scale)
        .filter(|lh| lh.is_finite() && *lh > 0.0)
        .unwrap_or(font_size / scale * NORMAL_LINE_HEIGHT_EM);
    let pitch = line_pitch_px(dom, node, own) * scale;
    let lines = text_line_count(t.height, pitch, font_size);
    let content = t.height - (lines - 1.0) * pitch;
    let inset = (content - font_size) / 2.0;
    if !(inset > 0.0) || inset * 2.0 >= t.height {
        return *t;
    }
    Rect::from_xywh(t.left, t.top + inset, t.width, t.height - inset * 2.0)
}

/// The widest a glyph of `c` sets, in ems, as an upper bound: a full-width
/// CJK, kana or Hangul glyph is an em, a capital runs to about three
/// quarters, and every other glyph of a proportional face stays under 0.7em.
fn glyph_advance_bound_em(c: char) -> f64 {
    let cp = c as u32;
    let wide = matches!(cp,
        0x1100..=0x115F | 0x2E80..=0x303F | 0x3040..=0x33FF | 0x3400..=0x4DBF
        | 0x4E00..=0x9FFF | 0xA960..=0xA97F | 0xAC00..=0xD7FF | 0xF900..=0xFAFF
        | 0xFE30..=0xFE4F | 0xFF00..=0xFF60 | 0xFFE0..=0xFFE6 | 0x20000..=0x3FFFF);
    if wide {
        1.05
    } else if c.is_uppercase() {
        0.8
    } else {
        0.7
    }
}

/// Whether `el` is a wrapping flex container whose own text is split into
/// several runs, each an anonymous item too short to wrap in the box. Each
/// run then sets one line and moves to a row of its own when it does not
/// fit: the union of their rects is two or more rows of items (outreign.io's
/// wrapped row of "100 free lead searches", "14-day trial", ... on a phone),
/// not two line boxes of one run, and there is no leading between lines to
/// crowd. Only `flex-wrap: wrap` moves an item whole. Under the default
/// `nowrap` the items shrink to share one row and each run wraps inside its
/// item (outreign.io's same row at desktop width, where `sm:flex-nowrap`
/// applies), and a grid cell is narrower than the container; neither is
/// measured by the container's width. A container whose wrapping the capture
/// did not record, a single run, or any run long enough that it could wrap by
/// the widest advance a face sets, is measured as before.
fn items_each_fit_one_line(dom: &dyn Dom, el: ElId, font_size: f64) -> bool {
    let display = dom.style(el, "display");
    if !matches!(display.as_str(), "flex" | "inline-flex") {
        return false;
    }
    if !dom.style(el, "flexWrap").starts_with("wrap") {
        return false;
    }
    let runs: Vec<String> = dom
        .direct_text_nodes(el)
        .into_iter()
        .map(|t| collapse_ws(js::trim(&t)))
        .filter(|t| !t.is_empty())
        .collect();
    if runs.len() < 2 {
        return false;
    }
    let content_width = dom.client_width(el)
        - js::math_max(0.0, style_px(dom, el, "paddingLeft"))
        - js::math_max(0.0, style_px(dom, el, "paddingRight"));
    if !(content_width.is_finite() && content_width > 0.0 && font_size > 0.0) {
        return false;
    }
    runs.iter().all(|run| {
        let width: f64 = run.chars().map(glyph_advance_bound_em).sum::<f64>() * font_size;
        width < content_width
    })
}

/// The scale `el` is drawn at: its on-screen width over its layout width.
/// 1 unless a transform shrinks it by more than a twentieth, or when the
/// layout width was not recorded.
fn drawn_scale(dom: &dyn Dom, el: ElId, rect: &Rect) -> f64 {
    let layout = dom.offset_width(el);
    if !(layout.is_finite() && layout > 0.0 && rect.width > 0.0) {
        return 1.0;
    }
    let scale = rect.width / layout;
    if scale > 0.05 && scale < 0.95 {
        scale
    } else {
        1.0
    }
}

/// [`drawn_scale`] on the y axis: `el`'s on-screen height over its layout
/// height, under the same bounds.
fn drawn_scale_y(dom: &dyn Dom, el: ElId, rect: &Rect) -> f64 {
    let layout = dom.offset_height(el);
    if !(layout.is_finite() && layout > 0.0 && rect.height > 0.0) {
        return 1.0;
    }
    let scale = rect.height / layout;
    if scale > 0.05 && scale < 0.95 {
        scale
    } else {
        1.0
    }
}

/// How much of `tr`, a text rect of `node`, shows on the x axis once each box
/// between `node` and `el` (both ends included) that clips x has cut it:
/// `(left, right, cut_left, cut_right)`, the cut flags saying a clip took off
/// that end by more than `tolerance` (a line that overshoots a padding-less
/// box by a pixel or two is text touching its edge, not a line cut off).
/// `None` when nothing is left. A clip is the box's padding box; an inline
/// box clips nothing.
fn visible_x_extent(
    dom: &dyn Dom,
    el: ElId,
    node: ElId,
    tr: &Rect,
    tolerance: f64,
) -> Option<(f64, f64, bool, bool)> {
    let (mut left, mut right) = (tr.left, tr.right);
    let (mut cut_left, mut cut_right) = (false, false);
    let mut cur = dom.parent(node);
    while let Some(p) = cur {
        if dom.style(p, "display") != "inline" && crate::browser::text_geometry::clips_x(dom, p) {
            let pr = dom.rect(p);
            let inner_left = pr.left + dom.client_left(p).max(0.0);
            let cw = dom.client_width(p);
            let inner_right = if cw.is_finite() && cw > 0.0 { inner_left + cw } else { pr.right };
            if left < inner_left {
                cut_left |= inner_left - left > tolerance;
                left = inner_left;
            }
            if right > inner_right {
                cut_right |= right - inner_right > tolerance;
                right = inner_right;
            }
            if right - left < 1.0 {
                return None;
            }
        }
        if p == el {
            break;
        }
        cur = dom.parent(p);
    }
    Some((left, right, cut_left, cut_right))
}

/// The width of every line the element's text rendered on, or `None` when
/// the DOM cannot say where the lines are.
///
/// `Dom::text_line_rects` has already merged the fragments of a line back
/// together, so each rect here is one line box and nothing is divided by
/// anything: a leading tighter than the glyph box used to turn one rect into
/// two identical "lines" and charge a single long line twice.
fn rendered_line_widths(dom: &dyn Dom, el: ElId) -> Option<Vec<f64>> {
    Some(
        dom.text_line_rects(el)?
            .into_iter()
            .filter(|r| r.width > 0.0 && r.height > 0.0)
            .map(|r| r.width)
            .collect(),
    )
}

static COMBINING_OR_FORMAT_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"[\p{M}\p{Cf}]").expect("COMBINING_OR_FORMAT_RE"));

/// The running count of [`rendered_text_len`], fed one text node at a time.
///
/// White space is held back until a character that is not white space
/// follows it, so a leading run is dropped and a trailing run never counts:
/// the ends are trimmed as `String.prototype.trim` trims them, wherever the
/// node boundaries fall. A run of collapsible white space counts once, and it
/// runs on across node boundaries, the way `a <b> b</b>` renders one space.
#[derive(Default)]
struct RenderedTextCount {
    count: usize,
    /// White space seen since the last counted character.
    pending: usize,
    /// The last white space seen was collapsible, so more of it joins that run.
    in_collapsible_run: bool,
    /// Count white space that cannot collapse (preserved, or a no-break
    /// space) where it stands, edges included. Set for an atomic inline's
    /// contents, whose edges trim only collapsible white space.
    keep_fixed_spaces: bool,
    /// Preserved spaces before the first character, after the last line
    /// break ahead of it: indentation on the first line.
    lead: usize,
    /// Preserved spaces after the last character, before any line break,
    /// under `pre` or `break-spaces`, where they take room on the line.
    tail: usize,
    /// No line break has come since the last counted character, so a kept
    /// trailing space is still on that character's line.
    tail_open: bool,
    /// An atomic inline has been placed, so the line has begun even when the
    /// box held no text of its own (an image, an empty inline-block, an
    /// input): white space after it is between two things, not an edge.
    boxed: bool,
}

impl RenderedTextCount {
    /// Feeds one text node. `preserved` is whether its `white-space` keeps
    /// its spaces (`pre`, `pre-wrap`, `break-spaces`); `hangs` is whether
    /// spaces at the end of a line hang rather than take room (`pre-wrap`).
    /// Preserved white space renders where it sits on a line: indentation
    /// before the first word and, unless they hang, spaces after the last.
    /// Only the line breaks around the text, and the blank lines they open,
    /// are on no line of it.
    fn feed(&mut self, text: &str, preserved: bool, hangs: bool) {
        let collapsible = |c: char| matches!(c, ' ' | '\t' | '\n' | '\r' | '\u{c}');
        let line_break = |c: char| matches!(c, '\n' | '\r' | '\u{c}');
        let mut buf = [0u8; 4];
        for c in text.chars() {
            if collapsible(c) && !preserved {
                if !self.in_collapsible_run {
                    self.pending += 1;
                    self.in_collapsible_run = true;
                }
                continue;
            }
            if js::is_js_whitespace(c) && !self.keep_fixed_spaces {
                // A no-break space under a preserving white-space renders at
                // the edges like a preserved space does.
                if preserved && self.count == 0 && !self.boxed {
                    // Collapsible white space before the first preserved
                    // space starts the line and is removed; after it, it
                    // renders, so it joins the indentation.
                    self.lead = if line_break(c) { 0 } else { self.lead + self.lead.min(1) * self.pending + 1 };
                    self.pending = 0;
                    self.in_collapsible_run = false;
                    continue;
                } else if preserved && line_break(c) {
                    self.tail_open = false;
                } else if preserved && !hangs && self.tail_open {
                    self.tail += 1;
                }
                self.pending += 1;
                self.in_collapsible_run = false;
                continue;
            }
            // A mark is not on the line; it neither ends a run of white space
            // nor counts as a character.
            if COMBINING_OR_FORMAT_RE.is_match(c.encode_utf8(&mut buf)) {
                continue;
            }
            if self.count > 0 || self.boxed {
                self.count += self.pending;
            } else if self.lead > 0 {
                // Indentation, then any white space that followed it.
                self.count += self.lead + self.pending;
            }
            self.pending = 0;
            self.lead = 0;
            self.tail = 0;
            self.tail_open = true;
            self.in_collapsible_run = false;
            self.count += 1;
        }
    }

    /// The count, with the kept spaces that end the last line.
    fn total(&self) -> usize {
        if self.count > 0 {
            self.count + self.tail
        } else {
            0
        }
    }

    /// Takes in an atomic inline (an image, an inline-block) whose own
    /// contents counted `inner` characters. The box sits in the line like a
    /// character, so a collapsible space on each side of it renders: the run
    /// ends at the box. Its contents were counted in a count of their own,
    /// because they are laid out in their own formatting context: their edge
    /// collapsible white space is trimmed there and never joins the outer
    /// run, while preserved and no-break spaces at the edges still render.
    /// An empty box (an image, an input) holds its place the same way: the
    /// white space beside it is not at an edge of the text.
    /// Takes in a hard line break (`<br>`). The new line starts with no box
    /// on it, so white space after the break is at the line's start again,
    /// as it was before any box; and white space still held before the
    /// first character is dropped with the line it was on.
    fn line_break(&mut self) {
        self.boxed = false;
        if self.count == 0 {
            self.pending = 0;
        }
    }

    fn add_atomic_inline(&mut self, inner: usize) {
        self.in_collapsible_run = false;
        if self.count > 0 || self.boxed {
            self.count += self.pending;
        } else if self.lead > 0 {
            // Indentation, then any white space that followed it, as before
            // a first character.
            self.count += self.lead + self.pending;
        }
        self.pending = 0;
        self.lead = 0;
        self.tail = 0;
        self.tail_open = true;
        self.boxed = true;
        self.count += inner;
    }
}

/// Replaced elements, which lay out as atomic inlines in a line of text.
const REPLACED_TAGS: [&str; 11] =
    ["img", "svg", "video", "canvas", "iframe", "object", "embed", "input", "select", "textarea", "button"];

/// An atomic inline box: a replaced element or an `inline-*` display.
fn is_atomic_inline(dom: &dyn Dom, el: ElId) -> bool {
    REPLACED_TAGS.contains(&tag_lower(dom, el).as_str())
        || js::to_lower_case(&dom.style(el, "display")).trim().starts_with("inline-")
}

/// Feeds the text nodes under `el` in document order, each under its own
/// parent's `white-space`, skipping every descendant that renders no text
/// ([`renders_no_text`]: unrendered tags, `display: none`, and the contents
/// of a `content-visibility: hidden` box). `Dom::text_line_rects` skips the
/// same subtrees, so the count and the line widths it is divided among
/// always describe the same text.
fn feed_rendered_text(dom: &dyn Dom, el: ElId, out: &mut RenderedTextCount) {
    let mut preserved: Option<(bool, bool)> = None;
    for child in dom.child_nodes(el) {
        match child {
            DomChild::Text(text) => {
                let (preserved, hangs) = *preserved.get_or_insert_with(|| {
                    let white_space = dom.style(el, "whiteSpace");
                    (
                        white_space == "pre" || white_space == "pre-wrap" || white_space == "break-spaces",
                        white_space == "pre-wrap",
                    )
                });
                out.feed(&text, preserved, hangs);
            }
            DomChild::Element(child) => {
                if renders_no_text(dom, child) {
                    continue;
                }
                if tag_lower(dom, child) == "br" {
                    out.line_break();
                    continue;
                }
                if is_atomic_inline(dom, child) {
                    let mut inner = RenderedTextCount { keep_fixed_spaces: true, ..Default::default() };
                    feed_rendered_text(dom, child, &mut inner);
                    out.add_atomic_inline(inner.count);
                } else {
                    feed_rendered_text(dom, child, out);
                }
            }
        }
    }
}

/// How many characters of `el`'s text reached its rendered lines, which is
/// the count the line rects have to be divided among.
///
/// `textContent` is the source, not the rendering, and it runs over in three
/// ways. It includes the text of an inline `<style>` or `<script>` child and
/// of a `display: none` one, none of which is on any line. It keeps the
/// source's indentation and newlines, which `white-space: normal` collapses
/// to a single space. And it counts code units, so a combining mark, which
/// sits on its base and advances nothing, is charged as a character of its
/// own: a third of a Devanagari paragraph is marks.
///
/// So the count is built from the text nodes themselves, in order: the
/// unrendered descendants are never visited, each node's collapsible white
/// space is folded to one space unless the element it sits in preserves it
/// (a `pre-wrap` span inside a normal paragraph keeps its spaces, which are
/// on the line), and combining marks and format characters (zero-width
/// joiners, soft hyphens) are left out.
fn rendered_text_len(dom: &dyn Dom, el: ElId) -> usize {
    let mut count = RenderedTextCount::default();
    feed_rendered_text(dom, el, &mut count);
    count.total()
}

/// JS: checks.mjs#textDescendantsFlushSides(el, rect) → [top, right, bottom, left]
///
/// The side is flush when the *text* lands on it, not when a text-bearing box
/// does. Each candidate is measured by its own text rect, not by its border
/// box: a padded button, a centred heading and a table cell all fill the box
/// they sit in while their glyphs stay well inside it, and it is the glyphs a
/// reader sees crowding the boundary. A `<td>` fills its table edge to edge
/// and insets its own text by the cell padding; reading the cell's border box
/// called that flush and charged a framed table for having no inset (REN-403).
///
/// In a chip under [`SMALL_CHIP_HEIGHT_UNDER_PX`] tall the text is measured by
/// its glyphs ([`glyph_band`]) rather than by the content area its rect spans:
/// the line box there already holds the glyphs off the edge, and two pixels
/// of declared padding read as enough. Taste call r3-20 (2026-09-18).
pub fn text_descendants_flush_sides(dom: &dyn Dom, el: ElId, rect: &Rect) -> [bool; 4] {
    let mut flush = [false; 4];
    // Rects are screen pixels and the thresholds layout pixels: a box drawn
    // at a transform's scale is measured at that scale.
    let scale = drawn_scale(dom, el, rect);
    let edge_threshold = 4.0 * scale;
    let small_chip = rect.height > 0.0 && rect.height / scale < SMALL_CHIP_HEIGHT_UNDER_PX;
    // In a small chip the glyphs are measured, and the air they need scales
    // with them: a quarter of the font size, which is the 4px above for 16px
    // text and less for smaller labels. maritime.sh's mock URL bar holds 10px
    // text 3px off its edges.
    let land_threshold = |node: ElId| -> f64 {
        if !small_chip {
            return edge_threshold;
        }
        let font_size = parse_float(&dom.style(node, "fontSize"));
        if !(font_size.is_finite() && font_size > 0.0) {
            return edge_threshold;
        }
        js::math_min(4.0, font_size * SMALL_CHIP_AIR_EM) * scale
    };
    let candidates = dom.query_all(Some(el), TEXT_EDGE_QUERY).unwrap_or_default();
    for node in candidates {
        let tag_name = dom.tag_name(node);
        if !TEXT_EDGE_TAGS.contains(&tag_name.as_str()) || !has_meaningful_direct_text(dom, node) {
            continue;
        }
        let br = dom.rect(node);
        if br.width <= 0.0 || br.height <= 0.0 {
            continue;
        }
        if br.bottom < rect.top || br.top > rect.bottom || br.right < rect.left || br.left > rect.right {
            continue;
        }
        // Glyphs a reader sees are inside the node's own box, so a box that
        // reaches no edge of `el` has no text that reaches one. Rejecting on
        // the box first keeps the text measurement, a range walk in the page,
        // off the many candidates that sit well inside.
        let box_sides = [
            br.top - rect.top <= edge_threshold,
            rect.right - br.right <= edge_threshold,
            rect.bottom - br.bottom <= edge_threshold,
            br.left - rect.left <= edge_threshold,
        ];
        if !box_sides.iter().any(|s| *s) {
            continue;
        }
        // A Dom that cannot measure text falls back to the box, the behaviour
        // this rule had before, rather than going silent. In a small chip the
        // glyphs are measured rather than the font's content area.
        let nr = match dom.direct_text_rect(node) {
            Some(t) if t.width > 0.0 && t.height > 0.0 => match clamp_to(
                &if small_chip { glyph_band_at(dom, node, &t, scale) } else { t },
                &br,
            ) {
                Some(c) => c,
                None => continue,
            },
            _ => br,
        };
        // Only what the clipping boxes on the way leave of the line reaches
        // an edge. A side where a clip cuts the text is where the line is cut
        // off (a table scrolled sideways inside the box, a tab strip that
        // scrolls, a title an ellipsis ends), not where glyphs crowd a
        // boundary.
        let Some((left, right, cut_left, cut_right)) = visible_x_extent(dom, el, node, &nr, edge_threshold) else {
            continue;
        };
        // Text lands on a side when it stops within the threshold of it, on
        // either side of the edge. Text further past the edge than that is
        // not held against it: it runs out of the box (a block parked 64px
        // to the left of its column until its scroll reveal brings it in).
        let land = land_threshold(node);
        let lands = |gap: f64| gap <= land && gap >= -edge_threshold;
        let sides = [
            lands(nr.top - rect.top),
            !cut_right && lands(rect.right - right),
            lands(rect.bottom - nr.bottom),
            !cut_left && lands(left - rect.left),
        ];
        // The remaining tests run only for text that reached an edge.
        if !sides.iter().any(|s| *s) {
            continue;
        }
        if is_visually_hidden(dom, node) || !text_rect_survives_clipping(dom, el, node, &nr) {
            continue;
        }
        if !text_is_the_wrappers(dom, el, node) {
            continue;
        }
        for s in 0..4 {
            flush[s] |= sides[s];
        }
    }
    flush
}

/// The opacity at or under which a box on the way from a text to its wrapper
/// shows nothing of that text.
const WRAPPER_TEXT_UNSEEN_OPACITY: f64 = 0.02;

/// Whether the text of `node` is text the padding of `el` is there to hold
/// off its edge, asked of every box from `node` up to `el`, `el` excluded.
/// It is not when one of them:
///
/// - is at an opacity of [`WRAPPER_TEXT_UNSEEN_OPACITY`] or less: nothing of
///   the text shows, and a block waiting at 0 for its scroll reveal is
///   measured where the reveal starts it, not where it rests;
/// - is out of flow (`position: absolute` or `fixed`): the wrapper's padding
///   does not place it, its own offsets do (a promo badge pinned to a card's
///   corner);
/// - is a box that paints a surface of its own, a fill that differs from
///   what is behind it: the text sits on that surface, and its inset is that
///   box's to give. Inline boxes do not count: a highlighted word at the
///   start of a line is still a line of the wrapper's text.
fn text_is_the_wrappers(dom: &dyn Dom, el: ElId, node: ElId) -> bool {
    const MAX_DEPTH: usize = 256;
    let mut cur = Some(node);
    for _ in 0..MAX_DEPTH {
        let Some(c) = cur else { return true };
        if c == el {
            return true;
        }
        let opacity = parse_float(&dom.style(c, "opacity"));
        if opacity.is_finite() && opacity <= WRAPPER_TEXT_UNSEEN_OPACITY {
            return false;
        }
        if matches!(dom.style(c, "position").as_str(), "absolute" | "fixed") {
            return false;
        }
        if dom.style(c, "display") != "inline" && has_visible_background_boundary(dom, c) {
            return false;
        }
        cur = dom.parent(c);
    }
    true
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

/// Whether this element carries heading text, for the tight-leading floor:
/// the element is a heading (or takes the ARIA role), one of the inline tags
/// a heading's text sits in, or any other box under a heading (the `div` a
/// design system wraps heading copy in). A reading block nested inside a
/// heading (a `p`, an `li`, and whatever sits inside one) is body copy and
/// keeps the floor.
pub fn is_heading_text(dom: &dyn Dom, el: ElId) -> bool {
    if matches_or_false(dom, el, LEADING_HEADING_CONTEXT) {
        return true;
    }
    let Some(heading) = closest_or_none(dom, el, LEADING_HEADING_CONTEXT) else {
        return false;
    };
    // An inline tag (an anchor, a span) is heading text too, by the same
    // walk: no reading block sits between it and the heading. One inside a
    // `p` nested in the heading is that paragraph's body copy.
    let mut cur = Some(el);
    while let Some(c) = cur {
        if c == heading {
            break;
        }
        if QUALITY_TEXT_TAGS.contains(&tag_lower(dom, c).as_str()) {
            return false;
        }
        cur = dom.parent(c);
    }
    true
}

/// How far up from a text element the tight-leading floor looks for the box
/// that clamps or clips its lines: the element, the inline run it may sit in,
/// and the title wrapper around that (ynet.co.il sets its headline in a `div`
/// inside a link inside the clamped `div.slotTitle`).
const LINE_CLAMP_SEARCH_DEPTH: usize = 4;

/// The lines of `t`, the text rect of `el`, that render: whether a line clamp
/// holds them, and where the nearest box that clips them on the y axis cuts
/// them off.
///
/// A box between `el` and that clipping box with a `-webkit-box` line clamp
/// ([`is_line_clamp`], read from its `display` and `webkitLineClamp`) holds
/// the text in a clamp. A box that clips without a clamp (a `max-height` or
/// a fixed height with `overflow: hidden`) is no clamp: it only cuts the
/// count at its content box, so bold text it shows three lines of still
/// reports.
fn rendered_lines(dom: &dyn Dom, el: ElId, t: &Rect) -> (bool, f64) {
    let mut cur = Some(el);
    let mut depth = 0;
    while let Some(c) = cur {
        if depth >= LINE_CLAMP_SEARCH_DEPTH {
            break;
        }
        if is_line_clamp(&dom.style(c, "display"), &dom.style(c, "webkitLineClamp")) {
            return (true, t.bottom);
        }
        let clips = |k: &str| matches!(dom.style(c, k).as_str(), "hidden" | "clip");
        if clips("overflowY") || clips("overflow") {
            let r = dom.rect(c);
            let content_bottom =
                r.bottom - style_px(dom, c, "borderBottomWidth") - style_px(dom, c, "paddingBottom");
            if !(content_bottom.is_finite() && t.all_finite()) || content_bottom >= t.bottom {
                return (false, t.bottom);
            }
            return (false, js::math_max(content_bottom, t.top));
        }
        cur = dom.parent(c);
        depth += 1;
    }
    (false, t.bottom)
}

/// The tags whose prose is measured for `line-length` when its words sit
/// wholly in inline children (`<p><i>…</i></p>`).
const LINE_PROSE_TAGS: &[&str] = &["p", "li", "dd", "blockquote"];

/// Generic block boxes a CMS or a builder writes prose straight into, with no
/// `<p>` around it: cencora.com's `div.module__body`, aina-tech.io's
/// `div.mt-10.text-base` between two measured paragraphs.
const PROSE_BLOCK_TAGS: &[&str] = &["div", "section", "article", "aside", "main"];

/// Where prose written straight into a generic block is not prose: inside a
/// control, a link, or an editable field.
const PROSE_BLOCK_SKIP_SELECTOR: &str = "a, button, label, summary, select, textarea, [role=\"button\"], [role=\"link\"], [role=\"tab\"], [role=\"menuitem\"], [role=\"option\"], [contenteditable=\"true\"], [contenteditable=\"\"]";

/// Whether `el` is prose written straight into a generic block box: a
/// [`PROSE_BLOCK_TAGS`] element laid out as a block, holding text of its own
/// and nothing but phrasing under it, outside any control, and not set as
/// preformatted text. `line-length` and `body-text-viewport-edge` measure it
/// the way they measure a `<p>`, from its text runs only: where those cannot
/// be measured, a generic box is not taken for a paragraph. Nor is text set
/// at display size ([`LEADING_DISPLAY_TYPE_PX`] and up): fanniemae.com sets
/// its section titles as 28px `div.corp-h2`, a heading in a generic box.
fn is_prose_block(dom: &dyn Dom, el: ElId, tag: &str, has_direct_text: bool) -> bool {
    has_direct_text
        && PROSE_BLOCK_TAGS.contains(&tag)
        && !(parse_float(&dom.style(el, "fontSize")) >= LEADING_DISPLAY_TYPE_PX)
        && matches!(dom.style(el, "display").as_str(), "block" | "flow-root")
        && !dom.style(el, "whiteSpace").starts_with("pre")
        && holds_only_phrasing(dom, el)
        && closest_or_none(dom, el, PROSE_BLOCK_SKIP_SELECTOR).is_none()
}

/// The line-height `normal` stands for when counting line boxes: a text rect
/// one line tall is at most about 1.5em, two lines at least about 2.3em.
const NORMAL_LINE_HEIGHT_EM: f64 = 1.2;

/// How much of its content box a block's widest line fills before
/// `body-text-viewport-edge` takes the box's edges as the text's. A wrapped
/// paragraph's ragged right is under a word short of its column, and the box
/// is what an author sets.
const TEXT_FILLS_MEASURE: f64 = 0.9;

/// The controls whose labels wide tracking may set: links and buttons.
const TRACKED_CONTROL_LABEL: &str = "a[href], button, [role=\"button\"], [role=\"link\"], [role=\"tab\"]";

/// The letters in `text`: what a reader takes in as a label's length. The
/// spaces, digits and dots between words of a caps label
/// ("SCHEDULE AND CREATE 100 SOCIAL VIDEOS IN 20 MINS") are not.
fn letter_count(text: &str) -> usize {
    text.chars().filter(|c| c.is_alphabetic()).count()
}

/// Whether `el`'s text is a label-length run on one line: at most
/// [`TRACKED_LABEL_MAX_CHARS`] letters, and a text box that does not wrap.
fn short_one_line_label(dom: &dyn Dom, el: ElId, line_height_px: Option<f64>) -> bool {
    letter_count(js::trim(&dom.text_content(el))) <= TRACKED_LABEL_MAX_CHARS
        && !text_wraps_to_multiple_lines(
            dom.direct_text_rect(el).map(|r| r.height).unwrap_or(0.0),
            line_height_px,
        )
}

/// Whether `el` is a label typed in capitals: its text is a capitalized run
/// ([`is_capitalized_run`]) and a label-length run on one line
/// ([`short_one_line_label`]). `text-transform` does not say so, the markup
/// does. With `every_letter`, each letter has to be a capital: a line of
/// Hangul or kana with one Latin brand name in capitals ("인벤(INVEN)") is
/// running text, and letters with no case do not make it a label.
fn typed_caps_label(dom: &dyn Dom, el: ElId, line_height_px: Option<f64>, every_letter: bool) -> bool {
    let text = dom.text_content(el);
    let text = js::trim(&text);
    is_capitalized_run(text)
        && (!every_letter || text.chars().filter(|c| c.is_alphabetic()).all(|c| c.is_uppercase()))
        && short_one_line_label(dom, el, line_height_px)
}

/// Whether `el`'s text is typed in capitals, every letter of it: a
/// capitalized run ([`is_capitalized_run`]) with no letter that has no case,
/// shorter than a sentence ([`ALL_CAPS_LONG_RUN`], where `all-caps-body`
/// takes over a declared run but never sees a typed one).
fn typed_caps_text(dom: &dyn Dom, el: ElId) -> bool {
    let text = collapse_ws(js::trim(&dom.text_content(el)));
    utf16_len(&text) < ALL_CAPS_LONG_RUN
        && is_capitalized_run(&text)
        && text.chars().filter(|c| c.is_alphabetic()).all(|c| c.is_uppercase())
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

/// The largest box, on either axis, that reads as an icon rather than a
/// picture.
const RASTER_ICON_MAX_PX: f64 = 48.0;

/// The `blur()` radius past which a faint raster is a blur-up placeholder.
const RASTER_PLACEHOLDER_MIN_BLUR_PX: f64 = 4.0;

/// Whether a near-transparent raster is one state of a layer rather than
/// buried material: vector art, an icon-sized box, a blurred low-resolution
/// placeholder, or a frame stacked under a painted raster in the same box (a
/// crossfade whose visible frame is a sibling, a placeholder under a parent
/// that paints the loaded picture).
fn raster_is_state_layer(dom: &dyn Dom, el: ElId, tag: &str, bg: &str, rect: &Rect) -> bool {
    if crate::checks::measures::raster_source_is_svg(tag == "img", dom.attr(el, "src").as_deref(), bg) {
        return true;
    }
    if rect.width > 0.0
        && rect.height > 0.0
        && rect.width <= RASTER_ICON_MAX_PX
        && rect.height <= RASTER_ICON_MAX_PX
    {
        return true;
    }
    if filter_blur_px(&dom.style(el, "filter")) >= RASTER_PLACEHOLDER_MIN_BLUR_PX {
        return true;
    }
    let area = rect.width * rect.height;
    if !(area > 0.0) {
        return false;
    }
    let covers = |other: &Rect| {
        let w = (rect.right.min(other.right) - rect.left.max(other.left)).max(0.0);
        let h = (rect.bottom.min(other.bottom) - rect.top.max(other.top)).max(0.0);
        w * h >= area * 0.5
    };
    let paints_raster = |node: ElId| {
        let own = parse_float(&dom.style(node, "opacity"));
        let visible = !own.is_finite() || own >= 0.15;
        let t = tag_lower(dom, node);
        let raster = matches!(t.as_str(), "img" | "picture" | "video" | "canvas")
            || QUALITY_RASTER_URL_RE.is_match(&dom.style(node, "backgroundImage"));
        visible && raster && dom.style(node, "display") != "none" && covers(&dom.rect(node))
    };
    let Some(parent) = dom.parent(el) else {
        return false;
    };
    if dom
        .children(parent)
        .into_iter()
        .any(|sibling| sibling != el && paints_raster(sibling))
    {
        return true;
    }
    let mut ancestor = Some(parent);
    for _ in 0..2 {
        let Some(node) = ancestor else {
            break;
        };
        if Some(node) == dom.body() || Some(node) == dom.document_element() {
            break;
        }
        if paints_raster(node) {
            return true;
        }
        ancestor = dom.parent(node);
    }
    false
}

/// The largest `blur()` radius in a computed `filter`, 0 when there is none.
fn filter_blur_px(filter: &str) -> f64 {
    let mut max = 0.0f64;
    let lower = filter.to_ascii_lowercase();
    let mut rest = lower.as_str();
    while let Some(start) = rest.find("blur(") {
        let after = &rest[start + 5..];
        let end = after.find(')').unwrap_or(after.len());
        let v = parse_float(js::trim(&after[..end]));
        if v.is_finite() {
            max = max.max(v);
        }
        rest = &after[end..];
    }
    max
}

/// The viewport width at or under which a phone's gutter floor applies.
pub const BODY_TEXT_PHONE_VIEWPORT_MAX_PX: f64 = 480.0;

/// The gutter body text keeps from the side of a phone's window: a
/// consistent 12px (rtx.com at 390px) is a common mobile setting.
pub const BODY_TEXT_GUTTER_PHONE_PX: f64 = 12.0;

/// The gutter body text keeps from the side of a wider window.
pub const BODY_TEXT_GUTTER_PX: f64 = 16.0;

/// The gutter floor of `body-text-viewport-edge` at `viewport_width`: 12px at
/// 480px or less, 16px above.
pub fn body_text_gutter_floor(viewport_width: f64) -> f64 {
    if viewport_width <= BODY_TEXT_PHONE_VIEWPORT_MAX_PX {
        BODY_TEXT_GUTTER_PHONE_PX
    } else {
        BODY_TEXT_GUTTER_PX
    }
}

/// Where a paragraph's body text starts and ends on the x axis, as
/// `body-text-viewport-edge` reads it, or `None` when the rule does not
/// measure it: not a `<p>` or `<li>` (or prose written straight into a
/// generic block, [`is_prose_block`]) of more than 40 characters, inside a
/// `<nav>` or `<header>`, on its own fill, positioned, half the viewport wide
/// or less, cut by a scroller or a moving track rather than the page, or
/// wholly past either side of the viewport.
///
/// Measured on the text where it can be: a centred or padded paragraph
/// spans the viewport with its box while its glyphs keep a gutter, and a
/// paragraph a horizontal scroller cuts (a slide in a swiped track) meets
/// that track's clip rather than the page edge. A box that only hides its
/// overflow proves no track, so text it cuts at the screen edge counts.
/// Prose whose words sit wholly in inline children is measured the same
/// way. Where the text cannot be measured the box stands in, as before,
/// except for a generic block, which is measured on its text or not at all.
fn body_text_edge_span(dom: &dyn Dom, q: &QualityInput) -> Option<(f64, f64)> {
    let el = q.el;
    let tag = q.tag.as_str();
    let viewport_width = q.viewport_width;
    let has_direct_text = q.has_direct_text;
    let rect = &q.rect;
    let st = |k: &str| dom.style(el, k);
    let spx = |k: &str| style_px(dom, el, k);
    let is_edge_tag = matches!(js::to_upper_case(tag).as_str(), "P" | "LI");
    let edge_prose = !has_direct_text && is_edge_tag && holds_only_phrasing(dom, el);
    let prose_block = !is_edge_tag && is_prose_block(dom, el, tag, has_direct_text);
    if !((has_direct_text || edge_prose) && q.text_len > 40 && (is_edge_tag || prose_block) && viewport_width > 0.0) {
        return None;
    }
    let in_nav_header = closest_or_none(dom, el, "nav").is_some() || closest_or_none(dom, el, "header").is_some();
    let bg = st("backgroundColor");
    let has_own_bg = !bg.is_empty() && bg != "rgba(0, 0, 0, 0)" && bg != "transparent";
    let pos = st("position");
    let is_positioned = pos == "fixed" || pos == "absolute";
    let width_ratio = rect.width / viewport_width;
    if in_nav_header || has_own_bg || is_positioned || !(width_ratio > 0.5) {
        return None;
    }
    // Nor does text in a box caught part way through a move that ends.
    if super::painted::moves_mid_animation(dom, el) {
        return None;
    }
    let (left, right) = match phrasing_text_extent(dom, el) {
        Some(t) if scrolling_ancestor_cuts(dom, el, &t) => return None,
        // Text on a track a running animation moves stands wherever the
        // capture caught it.
        Some(_) if rides_a_running_track(dom, el) => return None,
        Some(t) => {
            // A line its own box truncates with an ellipsis or a clamp ends
            // at that box, wherever the Range rect of its text runs on to.
            let t = if super::element_checks::truncates_its_own_line(dom, el) {
                let (t_left, t_right) = clamp_to_own_clip(dom, el, t.left, t.right);
                if t_right > t_left {
                    Rect::from_xywh(t_left, t.top, t_right - t_left, t.height)
                } else {
                    t
                }
            } else {
                t
            };
            let content_left = rect.left + spx("borderLeftWidth") + spx("paddingLeft");
            let content_right = rect.right - spx("borderRightWidth") - spx("paddingRight");
            let pitch = q
                .line_height_px
                .filter(|lh| *lh > 0.0)
                .unwrap_or(q.font_size * NORMAL_LINE_HEIGHT_EM);
            if text_line_count(t.height, pitch, q.font_size) >= 2.0
                && t.width >= (content_right - content_left) * TEXT_FILLS_MEASURE
            {
                // Wrapped lines that fill the column reach its edges; how
                // ragged the longest line happens to be is not the gutter.
                (content_left, content_right)
            } else if st("display") == "list-item" {
                // A list item's marker is painted, not a text node: an
                // `inside` bullet sits at the content edge ahead of the text,
                // so the start side reaches that edge.
                if st("direction") == "rtl" {
                    (t.left, js::math_max(t.right, content_right))
                } else {
                    (js::math_min(t.left, content_left), t.right)
                }
            } else {
                (t.left, t.right)
            }
        }
        None if has_direct_text && !prose_block => (rect.left, rect.right),
        None => return None,
    };
    // Text wholly past either side of the viewport meets no edge a reader
    // sees: a desktop column laid out past a phone viewport, a list parked
    // 800px to the right.
    if right > 0.0 && left < viewport_width {
        Some((left, right))
    } else {
        None
    }
}

/// The hit, at advisory severity when `advisory` holds.
fn advisory_if(mut hit: RuleHit, advisory: bool) -> RuleHit {
    if advisory {
        hit.severity = Some(crate::checks::rules::ADVISORY_SEVERITY.to_string());
    }
    hit
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

    // The contexts in which a typography finding reports as advisory
    // (`crate::checks::text_context`), each asked once and only of an
    // element that failed: legal fine print under line-length, tiny-text and
    // tight-leading (taste call r5-p27), and mock context under tiny-text
    // and undersized-ui-text (r5-p26).
    let fine_print = std::cell::OnceCell::new();
    let fine_print_hit = |hit: RuleHit| {
        let yes = *fine_print.get_or_init(|| super::text_context::is_fine_print_dom(dom, el));
        advisory_if(hit, yes)
    };
    let mock = std::cell::OnceCell::new();
    let in_mock = || *mock.get_or_init(|| super::text_context::in_mock_context_dom(dom, el));

    // A raster (<img>, or an element with a background url) at near-zero
    // opacity never reaches the screen: the produced material ships as a
    // compliance token. The CSS-text scan catches the stylesheet form; this
    // catches computed opacity on the element itself (both engines).
    {
        let op = parse_float(&st("opacity"));
        if op.is_finite() && op < 0.15 && op >= 0.0 {
            let bg = st("backgroundImage");
            if (tag == "img" || QUALITY_RASTER_URL_RE.is_match(&bg))
                && !raster_is_state_layer(dom, el, tag, &bg, rect)
            {
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
    //
    // The measure is the line that rendered, not the box that could have held
    // it. `rect.width / (fontSize * 0.5)` is the box's capacity: a paragraph
    // sitting in a 1022px column whose text stops at 571px was charged with
    // 142 characters a line it never rendered (REN-402). What the reader sees
    // is `text_line_rects`, one rect per line box with the fragments of a
    // line merged back together, and the characters divide between the lines
    // in proportion to the ink each carries: one element's text is one font
    // at one size, so the average advance is the same on every line of it.
    //
    // The rects cover the element's whole rendered text, descendants and all,
    // so the characters divided among them are the rendered ones too
    // (`rendered_text_len`): measuring the direct text alone and then
    // charging it with the characters of an inline `<strong>` inflated every
    // paragraph that had one, and so does charging the lines with an inline
    // `<style>` child, the source's indentation, or a script's combining
    // marks, none of which takes up any of a line.
    //
    // A DOM that cannot say where the lines are gets no finding. The union of
    // a long first line and a short tail is the same union as two even lines,
    // so there is nothing in it to read a line off, and a rule that guesses
    // there is charging noise.
    //
    // Charged when at least two rendered lines run past the maximum. The harm
    // this rule names is the eye losing its place tracking back to the start
    // of the next line, so it takes a column of long lines to do the damage;
    // one long line and a short tail is a sentence that wrapped once.
    //
    // Prose whose words sit wholly in inline children, and prose written
    // straight into a generic block, is read the same way: the rects cover
    // every text node under the element, so the block that sets the lines is
    // the one measured.
    let prose_in_phrasing =
        !has_direct_text && LINE_PROSE_TAGS.contains(&tag) && holds_only_phrasing(dom, el);
    let prose_block = !QUALITY_TEXT_TAGS.contains(&tag)
        && (text_len as f64) > line_max
        && is_prose_block(dom, el, tag, has_direct_text);
    if (has_direct_text || prose_in_phrasing)
        && (QUALITY_TEXT_TAGS.contains(&tag) || prose_block)
        && rect.width > 0.0
        && (text_len as f64) > line_max
    {
        if let Some(widths) = rendered_line_widths(dom, el) {
            let total: f64 = widths.iter().sum();
            if total > 0.0 {
                let over = line_max + 5.0;
                let rendered_len = rendered_text_len(dom, el) as f64;
                let chars = |w: f64| rendered_len * w / total;
                let long = widths.iter().filter(|w| chars(**w) > over).count();
                if long >= 2 {
                    let longest = widths.iter().copied().fold(0.0, js::math_max);
                    findings.push(fine_print_hit(RuleHit::new(
                        "line-length",
                        format!(
                            "~{} chars on {} of {} rendered lines (aim for <{})",
                            number_to_string(math_round(chars(longest))),
                            number_to_string(long as f64),
                            number_to_string(widths.len() as f64),
                            number_to_string(line_max)
                        ),
                    )));
                }
            }
        }
    }

    // --- Cramped padding ---
    let is_inline_code = tag == "code" && closest_or_none(dom, el, "pre").is_none();
    // An inline box is a run of text inside a line, not a box around text:
    // its fill (a `<mark>` highlight) hugs the glyphs by design, and its
    // vertical padding moves nothing.
    if !is_inline_code
        && has_direct_text
        && text_len > 20
        && rect.width > 100.0
        && st("display") != "inline"
        && rect.height > 30.0
    {
        let borders = [
            spx("borderTopWidth"),
            spx("borderRightWidth"),
            spx("borderBottomWidth"),
            spx("borderLeftWidth"),
        ];
        // A `border: 1px solid transparent` focus-ring placeholder draws no
        // edge, so it bounds nothing.
        let border_visible = [
            borders[0] > 0.0 && !css_color_is_transparent(Some(&st("borderTopColor"))),
            borders[1] > 0.0 && !css_color_is_transparent(Some(&st("borderRightColor"))),
            borders[2] > 0.0 && !css_color_is_transparent(Some(&st("borderBottomColor"))),
            borders[3] > 0.0 && !css_color_is_transparent(Some(&st("borderLeftColor"))),
        ];
        let border_count = border_visible.iter().filter(|v| **v).count();
        let has_bg = has_visible_background_boundary(dom, el);
        // The space the reader sees, not the space the stylesheet declares:
        // the inset between the rendered text and the inside of the border
        // box. A 44px control with `padding: 0 16px` whose label a flex box
        // centres has 12px of air above the label and was charged with "0px
        // vertical padding" (REN-403). Nothing to measure the text with is
        // nothing to charge on, and the text is measured only for the
        // elements that got this far: the probe builds a Range per call, and
        // a page has a great many boxes that are not bounded at all.
        if let Some(insets) = (border_count >= 2 || has_bg)
            .then(|| direct_text_insets(dom, el, rect, &borders))
            .flatten()
        {
            let mut v_sides: Vec<usize> = Vec::new();
            let mut h_sides: Vec<usize> = Vec::new();
            if has_bg || border_visible[0] {
                v_sides.push(0);
            }
            if has_bg || border_visible[2] {
                v_sides.push(2);
            }
            // A fill that spans the window ends at the screen's edges, not at
            // an edge a reader sees beside the text: the flush form below
            // reads a full-bleed band the same way. nexttv.com.tw's dark
            // copyright band is the phone's full width.
            // The window's width less a classic scrollbar, which a 100%-wide
            // band stops at.
            let layout_width = dom
                .document_element()
                .map(|h| dom.client_width(h))
                .filter(|w| *w > 0.0 && *w <= viewport_width)
                .unwrap_or(viewport_width);
            let full_bleed_bg = has_bg
                && viewport_width > 0.0
                && rect.left <= 2.0
                && rect.right >= layout_width - 2.0;
            if (has_bg && !full_bleed_bg) || border_visible[3] {
                h_sides.push(3);
            }
            if (has_bg && !full_bleed_bg) || border_visible[1] {
                h_sides.push(1);
            }
            let pad_names = ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"];
            let min_over = |sides: &[usize], f: &dyn Fn(usize) -> f64| {
                sides.iter().map(|&s| f(s)).fold(f64::INFINITY, js::math_min)
            };
            let pad_of = |s: usize| spx(pad_names[s]);
            let v_min = min_over(&v_sides, &pad_of);
            let h_min = min_over(&h_sides, &pad_of);
            let v_thresh = js::math_max(4.0, font_size * 0.3);
            let h_thresh = js::math_max(8.0, font_size * 0.5);
            // The measured inset decides and is what the finding reports. The
            // declared padding has to be short as well: the text rect is a
            // font-metric box, and a line box tighter than the face's ascent
            // and descent pushes it toward the edge of a box whose padding is
            // generous.
            let inset_of = |s: usize| insets[s];
            let v_inset = min_over(&v_sides, &inset_of);
            let h_inset = min_over(&h_sides, &inset_of);
            let v_cramped = v_min < v_thresh && v_inset < v_thresh;
            let h_cramped = h_min < h_thresh && h_inset < h_thresh;
            let px = |v: f64| number_to_string(math_round(v * 10.0) / 10.0);
            if v_cramped {
                findings.push(RuleHit::new(
                    "cramped-padding",
                    format!(
                        "{}px of space above and below the text (need ≥{}px for {}px text)",
                        px(v_inset),
                        to_fixed(v_thresh, 1),
                        number_to_string(font_size)
                    ),
                ));
            } else if h_cramped {
                findings.push(RuleHit::new(
                    "cramped-padding",
                    format!(
                        "{}px of space beside the text (need ≥{}px for {}px text)",
                        px(h_inset),
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
        // A box with no area paints no boundary (a drawer collapsed to zero
        // width), and an inline box's border-bottom is an underline: text
        // sitting on it is the point of it, and padding would not move it.
        let el_is_box = rect.width > 0.0 && rect.height > 0.0 && st("display") != "inline";
        if !FLUSH_SKIP_TAGS.contains(&upper_tag.as_str())
            && !has_direct_text
            && el_position != "fixed"
            && el_position != "absolute"
            && el_is_box
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
            let bg_visible = has_visible_background_boundary(dom, el) && !backdrop_layer_matches(dom, el);
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
                // Content that runs past the box is clipped, not snug. A
                // table with a min-width inside an `overflow: hidden` frame
                // has its far column cut off, which is a defect
                // `clipped-overflow-container` is named for; calling it "no
                // inset" points at the wrong thing (REN-403).
                const OVERFLOW_TOLERANCE: f64 = 1.0;
                let mut children_overflow = [false; 4];
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
                        if rect.top - cr.top > OVERFLOW_TOLERANCE {
                            children_overflow[0] = true;
                        }
                        if cr.right - rect.right > OVERFLOW_TOLERANCE {
                            children_overflow[1] = true;
                        }
                        if cr.bottom - rect.bottom > OVERFLOW_TOLERANCE {
                            children_overflow[2] = true;
                        }
                        if rect.left - cr.left > OVERFLOW_TOLERANCE {
                            children_overflow[3] = true;
                        }
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
                    let bg_bounds_side = bg_visible
                        && !(full_bleed_bg_band && (s == 1 || s == 3))
                        && !side_meets_same_fill(dom, el, rect, s);
                    let side_bounded = border_visible[s] || outline_visible || bg_bounds_side;
                    if side_bounded
                        && pad[s] <= PAD_THRESHOLD
                        && !children_insulate[s]
                        && !children_overflow[s]
                        && text_flush[s]
                    {
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
    // The gutter a paragraph keeps from the side of the window. Text that
    // runs past that side is not a missing gutter but a page wider than its
    // viewport: the page-level form reports it once, in
    // `check_page_overflow_dom`, so a paragraph past an edge reports only the
    // gutter it keeps on the other side.
    if let Some((left, right)) = body_text_edge_span(dom, q) {
        let floor = body_text_gutter_floor(viewport_width);
        let l = math_round(left);
        let r = math_round(viewport_width - right);
        let left_close = l >= 0.0 && left < floor;
        let right_close = r >= 0.0 && right > viewport_width - floor;
        if left_close || right_close {
            let l = number_to_string(l);
            let r = number_to_string(r);
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
    // The 1.3 floor is a reading-comfort floor for body copy: text a visitor
    // reads at body scale, over more than one line. Several things are not
    // that.
    // Display type sets its own leading, and 1.2 at 32px is craft, not
    // crowding; headings routinely put their text in a child <a> or <span>,
    // so the exemption reads the nearest heading ancestor rather than the
    // element's own tag. Text that renders as a single line box has no gap
    // between lines to crowd. And source text that is never typeset (script,
    // style, noscript, head content, display:none, the sr-only clip patterns,
    // an element with no box at all) has no leading to measure.
    if has_direct_text
        && text_len > 50
        && !is_heading
        && font_size > 0.0
        && font_size < LEADING_DISPLAY_TYPE_PX
    {
        if let Some(own_lh) = q.line_height_px {
            // An inline run's lines are set on the block around it, whose
            // strut is the pitch when it is taller than the run's own value.
            let lh = line_pitch_px(dom, el, own_lh);
            let ratio = lh / font_size;
            // Compare on the ratio the snippet prints, so a page that sets
            // line-height: 1.3 exactly is never flagged for hitting the floor
            // (46.8 / 36 is 1.2999999999999998 in binary floats).
            let shown = js::math_round(ratio * 100.0) / 100.0;
            if ratio > 0.0 && shown < 1.3 {
                let text_rect = dom.direct_text_rect(el).unwrap_or(*rect);
                let wraps = text_rect.height >= lh * LEADING_MIN_LINE_BOXES
                    && !items_each_fit_one_line(dom, el, font_size);
                // A bold run of two rendered lines or fewer, or one in a line
                // clamp, is a title set on a div or span: it gets the heading
                // exemption. Lines a clipping box cuts off do not render.
                let bold_title = || {
                    let weight = font_weight_number(&st("fontWeight"));
                    if weight < LEADING_BOLD_TITLE_WEIGHT {
                        return false;
                    }
                    let (clamped, bottom) = rendered_lines(dom, el, &text_rect);
                    let lines = text_line_count(bottom - text_rect.top, lh, font_size);
                    is_bold_title_leading(weight, Some(lines), clamped)
                };
                if wraps
                    && !is_non_rendered_text(dom, el, tag)
                    && !is_visually_hidden(dom, el)
                    && !is_heading_text(dom, el)
                    && !bold_title()
                {
                    findings.push(fine_print_hit(RuleHit::new(
                        "tight-leading",
                        format!("line-height {}x (need >=1.3)", to_fixed(ratio, 2)),
                    )));
                }
            }
        }
    }

    // --- Justified text (without hyphens) ---
    // Only a narrow column stretches word spaces far enough to open rivers,
    // and only in a script that justifies on word spaces at all.
    if has_direct_text && st("textAlign") == "justify" && rect.width > 0.0 && font_size > 0.0 {
        let hyphens = {
            let a = st("hyphens");
            if !a.is_empty() {
                a
            } else {
                st("webkitHyphens")
            }
        };
        if hyphens != "auto"
            && chars_per_line(rect.width, font_size) <= JUSTIFY_NARROW_CHARS_PER_LINE
            && !justifies_without_word_spaces_text(&direct_text(dom, el))
        {
            findings.push(RuleHit::new(
                "justified-text",
                "text-align: justify without hyphens: auto".to_string(),
            ));
        }
    }

    // --- Tiny body text ---
    // Body text is running prose. A label set in capitals is not, whether
    // `text-transform` says so or the capitals are typed into the markup
    // (adant.ai's "ANIMATION · CINEMATIC 3D" card meta), and neither is a
    // command set in a monospace face with its whitespace kept (stroq.dev's
    // terminal mock), which is code whatever its class names.
    if has_direct_text && text_len > 20 && font_size < 12.0 {
        let skip_tags = ["sub", "sup", "code", "kbd", "samp", "var", "caption", "figcaption"];
        let in_ui_context = closest_or_none(dom, el, TINY_TEXT_UI_CONTEXT).is_some();
        let is_uppercase = st("textTransform") == "uppercase"
            || typed_caps_label(dom, el, q.line_height_px, true);
        let is_code_run = crate::checks::text_rules::is_monospace_family(&st("fontFamily"))
            && st("whiteSpace").starts_with("pre");
        if !skip_tags.contains(&tag)
            && !in_ui_context
            && !is_uppercase
            && !is_code_run
            && !is_non_rendered_text(dom, el, tag)
        {
            // Fine print and text in a mockup report as advisory.
            let hit = fine_print_hit(RuleHit::new(
                "tiny-text",
                format!("{}px body text", number_to_string(font_size)),
            ));
            findings.push(if hit.is_advisory() { hit } else { advisory_if(hit, in_mock()) });
        }
    }

    // --- Undersized functional / UI text ---
    {
        let dt = js::trim(&collapse_ws(&direct_text(dom, el))).to_string();
        let dt_len = utf16_len(&dt);
        let ui_skip_tags = ["sub", "sup", "option"];
        if font_size > 0.0
            && font_size < UI_TEXT_FLOOR_PX
            && dt_len >= 2
            && !ui_skip_tags.contains(&tag)
            // A footnote marker is set small by convention, and so is the
            // link inside it (`<sup><a>[7]</a></sup>`).
            && closest_or_none(dom, el, "sub, sup").is_none()
            && !is_non_rendered_text(dom, el, tag)
        {
            // A run set in a monospace face with its whitespace kept is
            // code, whatever its class names: the test `tiny-text` applies
            // to a long run. directus.io's JSON sample is Framer text with
            // hashed classes, 8px IBM Plex Mono at `white-space: pre-wrap`.
            // The same site sets its pricing labels that way, so a short run
            // also has to read as code.
            let is_code_run = crate::checks::text_rules::is_monospace_family(&st("fontFamily"))
                && st("whiteSpace").starts_with("pre")
                && crate::checks::text_rules::reads_as_code(&dt);
            let is_exempt_context = is_code_run || matches_or_closest(dom, el, EXEMPT_CONTEXT);
            if !is_exempt_context && !is_visually_hidden(dom, el) {
                let is_interactive = is_in_control(dom, el);
                let is_furniture = matches_or_closest(dom, el, FURNITURE);
                let is_smallprint = matches_or_closest(dom, el, SMALLPRINT);
                let floor = if !is_interactive && is_smallprint {
                    SMALLPRINT_TEXT_FLOOR_PX
                } else {
                    UI_TEXT_FLOOR_PX
                };
                // Fluid type a hair under the floor (10.9688px against 11px)
                // is not smaller text to a reader: the floor keeps a 0.1px
                // tolerance under each value.
                if is_under_ui_text_floor(font_size, floor)
                    && (is_interactive || is_furniture || dt_len <= 20)
                {
                    let excerpt = slice_utf16_prefix(&dt, 40);
                    // A label with no reading job (taste call r5-p3) and
                    // text in a mockup (r5-p26) report as advisory. A
                    // control's text is neither: a framed demo's controls
                    // keep failing too, since a visitor can use them.
                    let advisory = !is_interactive
                        && (super::text_context::is_micro_label_dom(dom, el) || in_mock());
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
    // item, a kicker or an eyebrow is taken in as a shape, so losing word
    // shapes costs nothing. The cost lands when the run is long enough to be
    // read as a sentence. The run is the element's own text: a bar or a form
    // control whose children hold the labels is not one long run, however its
    // subtree adds up.
    if has_direct_text && st("textTransform") == "uppercase" && !is_heading {
        let own_len = utf16_len(js::trim(&collapse_ws(&direct_text(dom, el))));
        if own_len >= ALL_CAPS_LONG_RUN {
            findings.push(RuleHit::new(
                "all-caps-body",
                format!("text-transform: uppercase on {} chars of body text", own_len),
            ));
        }
    }

    // --- Wide letter spacing on body text ---
    if has_direct_text && text_len > 20 {
        if let Some(ls) = q.letter_spacing_px {
            if ls > 0.0 && font_size > 0.0 {
                let tracking_em = ls / font_size;
                if tracking_em > 0.05 {
                    // Wide tracking is the standard treatment for an
                    // uppercase eyebrow, label or button. `text-transform`
                    // says so outright; capitals typed into the markup say
                    // it as plainly and take the same exemption, at any
                    // length and over any number of lines (mialight.app's
                    // caption that wraps on a phone). Every letter has to be
                    // a capital for that, so a CJK line with one Latin
                    // acronym in it stays running text unless it is a short
                    // label on one line.
                    // A link or button label is read at a glance too
                    // (lpga.or.jp's bold CJK "Instagram" link), held to the
                    // same size on one line.
                    let control_label = closest_or_none(dom, el, TRACKED_CONTROL_LABEL).is_some()
                        && short_one_line_label(dom, el, q.line_height_px);
                    // `text-transform: lowercase` renders no
                    // capitals, whatever the markup typed.
                    let lowered = st("textTransform") == "lowercase";
                    let caps_label = st("textTransform") == "uppercase"
                        || (!lowered
                            && (typed_caps_text(dom, el) || typed_caps_label(dom, el, q.line_height_px, false)));
                    if !caps_label && !control_label {
                        findings.push(RuleHit::new(
                            "wide-tracking",
                            format!("letter-spacing: {}em on body text", to_fixed(tracking_em, 2)),
                        ));
                    }
                }
            }
        }
    }

    // --- Crushed letter spacing ---
    if has_direct_text && text_len > 20 && font_size > 0.0 {
        if let Some(ls) = q.letter_spacing_px {
            if ls < 0.0 {
                let tracking_em = ls / font_size;
                if tracking_is_crushed(tracking_em, font_size) {
                    let text = collapse_ws(js::trim(&dom.text_content(el)));
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

/// JS: checks.mjs#checkElementQualityDOM(el)
pub fn check_element_quality_dom(dom: &dyn Dom, el: ElId, config: &BrowserConfig) -> Vec<RuleHit> {
    check_quality(dom, &quality_input(dom, el, config.line_max()))
}

/// The inputs `checkQuality` reads for `el`, as the browser adapter builds
/// them.
fn quality_input(dom: &dyn Dom, el: ElId, line_max: f64) -> QualityInput {
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
    let viewport_width = {
        let w = dom.inner_width();
        if crate::js_ext_a::num_truthy(w) {
            w
        } else {
            0.0
        }
    };
    QualityInput {
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
    }
}

/// What counts as the page's footer for `skipped-heading`: the element, the
/// landmark role, or the conventional id.
pub const FOOTER_SELECTOR: &str = "footer, [role=\"contentinfo\"], #footer";

/// JS: checks.mjs#checkPageQualityFromDoc(doc)
///
/// A skip into the footer is not reported (corpus decision
/// r5-p29-skipped-heading-footer-titles): footers title their link columns
/// with h4 straight after the page's closing h2, and those titles are chrome,
/// not part of the content outline. The skipped heading has to sit in a
/// footer, and the heading it follows has to be the last one before that
/// footer or the footer's own first heading when that one did not skip (the
/// closing call to action is often inside the footer). A skip between two
/// later footer headings, and every skip in the content, reports.
pub fn check_page_quality_from_doc(dom: &dyn Dom) -> Vec<RuleHit> {
    let mut findings = Vec::new();
    let mut prev_level: i64 = 0;
    let mut prev_text = String::new();
    let mut prev_footer: Option<ElId> = None;
    let mut prev_opens_footer = false;
    for h in dom.query_all(None, "h1, h2, h3, h4, h5, h6").unwrap_or_default() {
        let tag = dom.tag_name(h);
        // JS `parseInt(h.tagName[1])`
        let level = js::parse_int(&tag.chars().nth(1).map(|c| c.to_string()).unwrap_or_default(), 10);
        let level = if level.is_nan() { 0 } else { level as i64 };
        let text = slice_utf16_prefix(&collapse_ws(js::trim(&dom.text_content(h))), 60);
        let footer = dom.closest(h, FOOTER_SELECTOR).ok().flatten();
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
        // The footer's first heading speaks for the next one only when it
        // continues an outline (a closing call to action): one that skipped
        // into the footer, or that opens the page with no outline before it,
        // is itself a column title, and a skip after it is between two
        // footer headings.
        prev_opens_footer = opens_footer && continues && !skips;
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

/// The side of the viewport text runs past.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Side {
    Left,
    Right,
}

impl Side {
    fn name(self) -> &'static str {
        match self {
            Side::Left => "left",
            Side::Right => "right",
        }
    }

    /// How far an x extent reaches past this side of a viewport `vw` wide.
    fn past(self, left: f64, right: f64, vw: f64) -> f64 {
        match self {
            Side::Left => -left,
            Side::Right => right - vw,
        }
    }
}

/// Whether the viewport clips horizontal overflow: the root's `overflow-x`,
/// or body's when the root's is `visible`, since body's then propagates to
/// the viewport. Such a page cannot be scrolled sideways, and what runs past
/// its edge is cut off.
fn viewport_clips_x(dom: &dyn Dom) -> bool {
    let root = dom
        .document_element()
        .map(|r| super::text_geometry::overflow_x(dom, r))
        .unwrap_or_default();
    let ox = if root.is_empty() || root == "visible" {
        dom.body().map(|b| super::text_geometry::overflow_x(dom, b)).unwrap_or_default()
    } else {
        root
    };
    matches!(ox.as_str(), "hidden" | "clip")
}

/// The side a page scrolls to when it is wider than the viewport: right, or
/// left under `direction: rtl`. Overflow on the other side is unreachable.
fn scroll_side(dom: &dyn Dom) -> Side {
    let dir = dom
        .document_element()
        .map(|r| dom.style(r, "direction"))
        .filter(|d| !d.is_empty())
        .or_else(|| dom.body().map(|b| dom.style(b, "direction")))
        .unwrap_or_default();
    if dir == "rtl" {
        Side::Left
    } else {
        Side::Right
    }
}

/// On a page that scrolls sideways, the element whose box reaches furthest
/// past `side` of the viewport among those that set the page's width: every
/// box under the root that no ancestor below the root clips or scrolls on the
/// x axis and that is not fixed to the viewport, reaching no further than
/// the page scrolls (`limit`). The root and body pass their overflow to the
/// viewport and are walked through. Ties go to the outer box, which holds
/// the rest. Returns the element and how far past the edge it reaches.
fn widest_past_edge(dom: &dyn Dom, side: Side, vw: f64, limit: f64) -> Option<(ElId, f64)> {
    let root = dom.document_element()?;
    let body = dom.body();
    let mut best: Option<(ElId, f64)> = None;
    let mut stack: Vec<ElId> = dom.children(root).into_iter().rev().collect();
    while let Some(el) = stack.pop() {
        let display = dom.style(el, "display");
        if display == "none" || dom.style(el, "position") == "fixed" {
            continue;
        }
        if NON_RENDERED_TAGS.contains(&tag_lower(dom, el).as_str()) {
            continue;
        }
        let r = dom.rect(el);
        if display != "contents" && r.all_finite() && (r.width > 0.0 || r.height > 0.0) {
            let d = side.past(r.left, r.right, vw);
            if d >= 1.0 && d <= limit && best.map_or(true, |(_, b)| d > b + 0.5) {
                best = Some((el, d));
            }
        }
        let is_body = Some(el) == body;
        let descends = is_body
            || (!super::text_geometry::clips_x(dom, el)
                && dom.namespace_uri(el) != "http://www.w3.org/2000/svg");
        if descends {
            stack.extend(dom.children(el).into_iter().rev());
        }
    }
    best
}

/// On a page that cannot scroll to what runs past `side`, the widest box that
/// holds text past it: the box reaching furthest past the edge among the
/// paragraphs in `past` and their ancestors below the root. Whatever else
/// reaches past the edge there is held by a clip the walk above may not see
/// (a clip path, paint containment, a shadow root), so only the boxes around
/// the text count. Ties go to the outer box.
fn widest_holding_text(dom: &dyn Dom, past: &[(ElId, Side, f64)], side: Side, vw: f64) -> Option<(ElId, f64)> {
    let root = dom.document_element();
    let mut best: Option<(ElId, f64)> = None;
    for &(el, s, _) in past {
        if s != side {
            continue;
        }
        let mut chain: Option<(ElId, f64)> = None;
        let mut cur = Some(el);
        while let Some(c) = cur {
            if Some(c) == root {
                break;
            }
            let r = dom.rect(c);
            if r.all_finite() && (r.width > 0.0 || r.height > 0.0) {
                let d = side.past(r.left, r.right, vw);
                if d >= 1.0 && chain.map_or(true, |(_, b)| d + 0.5 >= b) {
                    chain = Some((c, d));
                }
            }
            cur = dom.parent(c);
        }
        if let Some((c, d)) = chain {
            if best.map_or(true, |(_, b)| d > b + 0.5) {
                best = Some((c, d));
            }
        }
    }
    best
}

/// Whether a box that hides or clips horizontal overflow cuts what `el`'s
/// text shows past `side` of the viewport: `el` itself or an ancestor below
/// the body, at `overflow-x: hidden` or `clip`, whose edge on that side sits
/// inside the viewport while the text, reaching `reach` past the viewport,
/// runs past it. A box whose own edge is past the viewport's hides nothing of
/// what the page could scroll to. The root and body stand for the viewport
/// ([`viewport_clips_x`]).
fn clip_cuts_text(dom: &dyn Dom, el: ElId, side: Side, reach: f64, vw: f64) -> bool {
    let root = dom.document_element();
    let body = dom.body();
    let mut cur = Some(el);
    while let Some(c) = cur {
        if Some(c) == root || Some(c) == body {
            break;
        }
        if matches!(super::text_geometry::overflow_x(dom, c).as_str(), "hidden" | "clip") {
            let r = dom.rect(c);
            if r.all_finite() && (r.width > 0.0 || r.height > 0.0) {
                let edge = side.past(r.left, r.right, vw);
                if edge <= 1.0 && reach > edge + 1.0 {
                    return true;
                }
            }
        }
        cur = dom.parent(c);
    }
    false
}

/// The longest text excerpt a page-level name carries, in characters.
const OVERFLOW_EXCERPT_CHARS: usize = 40;

/// The class tokens a page-level name keeps from an ancestor.
const OVERFLOW_ANCESTOR_CLASSES: usize = 3;

/// How the page-level finding names the widest element. `class_selector`
/// gives a bare `div` nothing to go on, so a `div` with no class is named by
/// its id, then by the nearest ancestor below the body with an id or a class
/// (`div in section#pricing`), then by the start of its text
/// (`div ("A column of a fixed-width desktop…")`).
fn overflow_element_name(dom: &dyn Dom, el: ElId) -> String {
    let name = super::element_checks::class_selector(dom, el);
    if name != "div" {
        return name;
    }
    let id_of = |e: ElId| dom.attr(e, "id").map(|v| js::trim(&v).to_string()).filter(|v| !v.is_empty());
    if let Some(id) = id_of(el) {
        return format!("div#{id}");
    }
    let root = dom.document_element();
    let body = dom.body();
    let mut cur = dom.parent(el);
    while let Some(a) = cur {
        if Some(a) == root || Some(a) == body {
            break;
        }
        let tag = js::to_lower_case(&dom.tag_name(a));
        if let Some(id) = id_of(a) {
            return format!("div in {tag}#{id}");
        }
        let cls = super::element_checks::class_selector(dom, a);
        if cls != tag {
            let mut parts = cls.split('.');
            let head = parts.next().unwrap_or_default().to_string();
            let tokens: Vec<&str> = parts.take(OVERFLOW_ANCESTOR_CLASSES).collect();
            return format!("div in {head}.{}", tokens.join("."));
        }
        cur = dom.parent(a);
    }
    let text = dom.inner_text(el).unwrap_or_else(|| dom.text_content(el));
    let words: Vec<&str> = text.split_whitespace().collect();
    if words.is_empty() {
        return name;
    }
    let mut excerpt = String::new();
    let mut cut = false;
    for w in &words {
        let next = if excerpt.is_empty() { w.chars().count() } else { excerpt.chars().count() + 1 + w.chars().count() };
        if next > OVERFLOW_EXCERPT_CHARS {
            cut = true;
            break;
        }
        if !excerpt.is_empty() {
            excerpt.push(' ');
        }
        excerpt.push_str(w);
    }
    if excerpt.is_empty() {
        // One word longer than the excerpt: keep its start.
        excerpt = words[0].chars().take(OVERFLOW_EXCERPT_CHARS).collect();
        cut = true;
    }
    let excerpt = excerpt.replace('"', "'");
    format!("div (\"{excerpt}{}\")", if cut { "…" } else { "" })
}

/// `body-text-viewport-edge`, page-level form: body text that runs past the
/// side of the viewport. That is not a missing gutter but a page wider than
/// its window, and one overflowing layout would otherwise report once per
/// paragraph with advice to add padding. It reports once per page, attributed
/// to the page, and names the widest element: the box reaching furthest past
/// that side among those that set the page's width, or the text itself when
/// it reaches further than any box.
///
/// The message follows what the page does (taste call r4-p20, 2026-09-18).
/// The text is cut off when the page cannot scroll to it: the viewport clips
/// x overflow (the root's `overflow-x`, or body's), the text runs past the
/// side a page never scrolls to (left of a left-to-right page), the root's
/// recorded scroll width shows the page does not scroll (a clip the walk
/// cannot see, such as a shadow root, holds the text), or a box that hides
/// overflow cuts the text of every paragraph on that side. The page scrolls
/// sideways when its scroll width exceeds the viewport and none of those
/// hold. When the engine cannot tell, because the root recorded no scroll
/// width, the sideways wording is used. The paragraphs are the ones the
/// element form measures, through the same gates, with the Text paint gate
/// and inline ignores applied to each.
pub fn check_page_overflow_dom(dom: &dyn Dom) -> Vec<BrowserFinding> {
    const RULE: &str = "body-text-viewport-edge";
    let vw = dom.inner_width();
    if !(vw.is_finite() && vw > 0.0) {
        return Vec::new();
    }
    // (element, side, how far its text reaches past that side)
    let mut past: Vec<(ElId, Side, f64)> = Vec::new();
    for el in dom
        .query_all(None, "p, li, div, section, article, aside, main")
        .unwrap_or_default()
    {
        if !super::driver::element_is_scanned(dom, el) {
            continue;
        }
        let q = quality_input(dom, el, 0.0);
        let Some((left, right)) = body_text_edge_span(dom, &q) else {
            continue;
        };
        let sides: Vec<Side> = [Side::Left, Side::Right]
            .into_iter()
            .filter(|s| math_round(s.past(left, right, vw)) > 0.0)
            .collect();
        if sides.is_empty() {
            continue;
        }
        if super::painted::unpainted_for(dom, el, super::painted::PaintGate::Text).is_some()
            || super::driver::scoped_ignore_active(dom, el, RULE)
        {
            continue;
        }
        for s in sides {
            past.push((el, s, s.past(left, right, vw)));
        }
    }
    let Some(&(first, side, text_reach)) = past
        .iter()
        .fold(None, |acc: Option<&(ElId, Side, f64)>, p| match acc {
            Some(a) if a.2 >= p.2 => Some(a),
            _ => Some(p),
        })
    else {
        return Vec::new();
    };
    let on_side: Vec<&(ElId, Side, f64)> = past.iter().filter(|p| p.1 == side).collect();
    let blocks = on_side.len();
    // How far the root scrolls past the viewport, when it recorded its
    // scroll width.
    let root_scroll = dom.document_element().and_then(|root| {
        let (scroll, client) = (dom.scroll_width(root), dom.client_width(root));
        let client = if client.is_finite() && client > 0.0 { client } else { vw };
        scroll.is_finite().then(|| scroll - client)
    });
    let cut_off = viewport_clips_x(dom)
        || side != scroll_side(dom)
        || root_scroll.is_some_and(|d| d <= 1.0)
        || on_side.iter().all(|&&(el, s, reach)| clip_cuts_text(dom, el, s, reach, vw));
    let scroll_reach = root_scroll.filter(|d| !cut_off && *d > 1.0);
    let widest_box = match scroll_reach {
        Some(limit) => widest_past_edge(dom, side, vw, limit + 1.0),
        None => widest_holding_text(dom, &past, side, vw),
    };
    let (widest, reach) = match widest_box {
        Some((el, d)) if d + 0.5 >= text_reach => (el, d),
        _ => (first, text_reach),
    };
    let name = overflow_element_name(dom, widest);
    let reach = number_to_string(math_round(reach));
    let blocks = format!("{} {}", blocks, if blocks == 1 { "block" } else { "blocks" });
    let vw = number_to_string(math_round(vw));
    let detail = if cut_off {
        format!(
            "text runs past the {} edge of the {vw}px viewport and is cut off: {name} reaches {reach}px past it, with text in {blocks}",
            side.name()
        )
    } else {
        format!(
            "page scrolls sideways at {vw}px: {name} reaches {reach}px past the {} edge, and text in {blocks} runs past it",
            side.name()
        )
    };
    vec![BrowserFinding::new(RULE, detail)]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::browser::fake_dom::FakeDom;

    fn raster(d: &mut FakeDom, parent: ElId, tag: &str, rect: (f64, f64, f64, f64)) -> ElId {
        let el = d.add(Some(parent), tag);
        d.set_styles(el, &[("opacity", "0"), ("backgroundImage", "none"), ("filter", "none")]);
        d.set_rect(el, rect.0, rect.1, rect.2, rect.3);
        el
    }

    fn buried(d: &FakeDom, el: ElId) -> bool {
        check_quality(
            d,
            &QualityInput {
                el,
                tag: tag_lower(d, el),
                has_direct_text: false,
                text_len: 0,
                font_size: 16.0,
                line_height_px: None,
                letter_spacing_px: None,
                rect: d.rect(el),
                line_max: 80.0,
                viewport_width: 1280.0,
            },
        )
        .iter()
        .any(|h| h.id == "buried-raster")
    }

    /// climatempo.com.br's icon states, picomq.com's copy button,
    /// exxonmobil.com's blur-up placeholders, resurf.so's crossfade frames.
    #[test]
    fn buried_raster_skips_state_layers() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let photo = raster(&mut d, body, "img", (0.0, 0.0, 480.0, 300.0));
        d.set_attr(photo, "src", "/texture.png");
        assert!(buried(&d, photo));
        d.set_attr(photo, "src", "/dist/images/v2/svg/location-granted.svg");
        assert!(!buried(&d, photo), "vector art");

        let copy = raster(&mut d, body, "button", (0.0, 400.0, 480.0, 300.0));
        d.set_style(copy, "backgroundImage", "url(\"data:image/svg+xml,%3Csvg%3E\")");
        assert!(!buried(&d, copy), "an SVG data URI");

        let icon = raster(&mut d, body, "img", (0.0, 800.0, 16.0, 16.0));
        d.set_attr(icon, "src", "/pin.png");
        assert!(!buried(&d, icon), "an icon-sized raster");

        let placeholder = raster(&mut d, body, "canvas", (0.0, 1000.0, 353.0, 199.0));
        d.set_style(placeholder, "backgroundImage", "url(\"/keytopic.jpg?w=40\")");
        assert!(buried(&d, placeholder));
        d.set_style(placeholder, "filter", "blur(10px)");
        assert!(!buried(&d, placeholder), "a blurred placeholder");

        let card = d.add(Some(body), "article");
        d.set_style(card, "backgroundImage", "url(\"/keytopic.jpg?w=2048\")");
        d.set_rect(card, 16.0, 1600.0, 321.0, 181.0);
        let under = raster(&mut d, card, "canvas", (0.0, 1590.0, 353.0, 199.0));
        d.set_style(under, "backgroundImage", "url(\"/keytopic.jpg?w=40\")");
        assert!(!buried(&d, under), "under a parent painting the loaded picture");

        let stack = d.add(Some(body), "div");
        let shown = raster(&mut d, stack, "img", (160.0, 3012.0, 960.0, 600.0));
        d.set_style(shown, "opacity", "1");
        let frame = raster(&mut d, stack, "img", (160.0, 3012.0, 960.0, 600.0));
        d.set_attr(frame, "src", "/screenshot-inbox.png");
        assert!(!buried(&d, frame), "a crossfade frame under a painted sibling");
        d.set_style(shown, "opacity", "0");
        assert!(buried(&d, frame), "no painted frame over it");
    }

    /// copperhead.sh: `<sup><a>[7]</a></sup>` at 10.2px.
    #[test]
    fn undersized_ui_text_skips_links_inside_markers() {
        let ui = |d: &FakeDom, el: ElId| {
            check_quality(
                d,
                &QualityInput {
                    el,
                    tag: "a".to_string(),
                    has_direct_text: true,
                    text_len: 3,
                    font_size: 10.2,
                    line_height_px: None,
                    letter_spacing_px: None,
                    rect: Rect::from_xywh(0.0, 0.0, 12.0, 13.0),
                    line_max: 80.0,
                    viewport_width: 1280.0,
                },
            )
            .iter()
            .any(|h| h.id == "undersized-ui-text")
        };
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let p = d.add(Some(body), "p");
        d.add_text(p, "The board was routed in one pass");
        let sup = d.add(Some(p), "sup");
        let link = d.add(Some(sup), "a");
        d.add_text(link, "[7]");
        d.add_selector(link, INTERACTIVE);
        assert!(!ui(&d, link));
        let nav_link = d.add(Some(body), "a");
        d.add_text(nav_link, "[7]");
        d.add_selector(nav_link, INTERACTIVE);
        assert!(ui(&d, nav_link));
    }

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
        let long = "x".repeat(240);
        let p = text_el(&mut d, body, "p", &long, "16px");
        d.set_rect(p, 0.0, 100.0, 1200.0, 72.0);
        // Three rendered lines: two full ones and a tail.
        d.set_text_lines(p, &[(0.0, 100.0, 1180.0, 19.0), (0.0, 124.0, 1180.0, 19.0), (0.0, 148.0, 400.0, 19.0)]);
        let hits = check_element_quality_dom(&d, p, &BrowserConfig::default());
        let ids: Vec<&str> = hits.iter().map(|h| h.id.as_str()).collect();
        assert!(ids.contains(&"line-length"), "{ids:?}");
        assert_eq!(hits[0].snippet, "~103 chars on 2 of 3 rendered lines (aim for <80)");
        assert!(ids.contains(&"body-text-viewport-edge"));
        let edge = hits.iter().find(|h| h.id == "body-text-viewport-edge").unwrap();
        assert_eq!(edge.snippet, "<p> with 240-char body bleeds to viewport edge (left 0px)");
        // narrower, inset paragraph: neither fires
        d.set_rect(p, 40.0, 100.0, 600.0, 72.0);
        d.set_text_lines(p, &[(40.0, 100.0, 580.0, 19.0), (40.0, 124.0, 580.0, 19.0), (40.0, 148.0, 580.0, 19.0)]);
        let hits = check_element_quality_dom(&d, p, &BrowserConfig::default());
        assert!(hits.is_empty(), "{hits:?}");
    }

    /// REN-402. Halfday's pricing copy: a 158-character paragraph in a 1022px
    /// card body, rendering 145 characters on its first line and 13 on its
    /// second. The old measurement charged the box (`1022 / (15 * 0.5)` = 136
    /// "chars/line") on every paragraph that shape, including the ones whose
    /// text stops well short of the box.
    #[test]
    fn line_length_reads_the_rendered_line_not_the_box() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let copy = "People are counted on the first of the month. Someone invited on the 3rd is free until the 1st, and someone removed mid-month is credited on the next invoice.";
        assert_eq!(copy.chars().count(), 158);
        let p = text_el(&mut d, body, "p", copy, "15px");
        d.set_style(p, "lineHeight", "24px");
        d.set_rect(p, 200.0, 971.0, 1022.0, 48.0);
        // One long line and a 13-character tail: the eye tracks back once.
        d.set_text_lines(p, &[(200.0, 974.0, 995.4, 18.0), (200.0, 998.0, 85.5, 18.0)]);
        assert_eq!(check_element_quality_dom(&d, p, &BrowserConfig::default()), vec![]);

        // The same box, text that stops at 571px: 89 characters on one line.
        let meta = text_el(&mut d, body, "p", &"y".repeat(89), "14px");
        d.set_style(meta, "lineHeight", "21.7px");
        d.set_rect(meta, 200.0, 122.0, 992.0, 21.7);
        d.set_text_lines(meta, &[(200.0, 124.2, 571.4, 17.0)]);
        assert_eq!(check_element_quality_dom(&d, meta, &BrowserConfig::default()), vec![]);

        // A column of long lines is the defect the rule is named for.
        let wall = text_el(&mut d, body, "p", &"z".repeat(500), "15px");
        d.set_style(wall, "lineHeight", "24px");
        d.set_rect(wall, 200.0, 100.0, 1022.0, 96.0);
        d.set_text_lines(
            wall,
            &[
                (200.0, 100.0, 1000.0, 18.0),
                (200.0, 124.0, 1000.0, 18.0),
                (200.0, 148.0, 1000.0, 18.0),
                (200.0, 172.0, 600.0, 18.0),
            ],
        );
        let hits = check_element_quality_dom(&d, wall, &BrowserConfig::default());
        assert_eq!(hits.len(), 1, "{hits:?}");
        assert_eq!(hits[0].snippet, "~139 chars on 3 of 4 rendered lines (aim for <80)");
    }

    /// A line box split across text nodes is still one line. An inline
    /// `<strong>` or `<a>` in the middle of a sentence is its own text node,
    /// so `getClientRects()` hands back a rect per fragment; counting each
    /// fragment as a line divided the paragraph's characters among them and
    /// hid a genuinely long column.
    #[test]
    fn a_line_split_across_fragments_is_one_line() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        // 300 characters over three rendered lines, each interrupted mid-line
        // by an inline element and so measured in two pieces.
        let p = text_el(&mut d, body, "p", &"w".repeat(300), "16px");
        d.set_rect(p, 0.0, 100.0, 1020.0, 72.0);
        d.set_text_lines(
            p,
            &[
                (0.0, 100.0, 520.0, 19.0),
                (520.0, 100.0, 480.0, 19.0),
                (0.0, 124.0, 510.0, 19.0),
                (510.0, 124.0, 490.0, 19.0),
                (0.0, 148.0, 505.0, 19.0),
                (505.0, 148.0, 495.0, 19.0),
            ],
        );
        let hits = check_element_quality_dom(&d, p, &BrowserConfig::default());
        let line = hits.iter().find(|h| h.id == "line-length").expect("charged");
        // Three lines of 1000px, not six of ~500: six would have put 50
        // characters on each and charged nothing at all.
        assert_eq!(line.snippet, "~100 chars on 3 of 3 rendered lines (aim for <80)");

        // The same merge the other way: one long line in two fragments plus a
        // short tail is two lines, and one long line is a sentence that
        // wrapped once.
        let q = text_el(&mut d, body, "p", &"w".repeat(190), "16px");
        d.set_rect(q, 0.0, 300.0, 1020.0, 48.0);
        d.set_text_lines(
            q,
            &[
                (0.0, 300.0, 600.0, 19.0),
                (600.0, 300.0, 400.0, 19.0),
                (0.0, 324.0, 120.0, 19.0),
            ],
        );
        let hits = check_element_quality_dom(&d, q, &BrowserConfig::default());
        assert!(!hits.iter().any(|h| h.id == "line-length"), "{hits:?}");
    }

    /// Two columns that happen to sit on the same rows are two flows, not one
    /// page-wide line. Fragments join a row only when they run on from it —
    /// a gap no wider than the row's own line box — so a gutter keeps them
    /// apart and the characters stay where the reader sees them.
    #[test]
    fn columns_on_the_same_rows_are_separate_lines() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let p = text_el(&mut d, body, "p", &"w".repeat(240), "16px");
        d.set_rect(p, 0.0, 100.0, 1020.0, 72.0);
        // Two 300px columns with a 100px gutter, three rows each.
        d.set_text_lines(
            p,
            &[
                (0.0, 100.0, 300.0, 19.0),
                (400.0, 100.0, 300.0, 19.0),
                (0.0, 124.0, 300.0, 19.0),
                (400.0, 124.0, 300.0, 19.0),
                (0.0, 148.0, 300.0, 19.0),
                (400.0, 148.0, 300.0, 19.0),
            ],
        );
        let hits = check_element_quality_dom(&d, p, &BrowserConfig::default());
        // Six short lines of 40 characters each, not three of 700px.
        assert!(!hits.iter().any(|h| h.id == "line-length"), "{hits:?}");
    }

    /// A rect that is already one line is one line, whatever the leading is.
    /// Dividing every rect by the line box turned a paragraph whose leading
    /// is tighter than its glyph box into two copies of the same line, and
    /// two copies of one long line satisfied "at least two long lines".
    #[test]
    fn tight_leading_does_not_double_count_a_line() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let p = text_el(&mut d, body, "p", &"w".repeat(200), "15px");
        // 10px of leading under an 19px glyph box: `round(19 / 10)` is 2.
        d.set_style(p, "lineHeight", "10px");
        d.set_rect(p, 0.0, 100.0, 1020.0, 19.0);
        d.set_text_lines(p, &[(0.0, 100.0, 1000.0, 19.0)]);
        let hits = check_element_quality_dom(&d, p, &BrowserConfig::default());
        assert!(!hits.iter().any(|h| h.id == "line-length"), "{hits:?}");
    }

    /// A DOM that kept only the union of its text rects cannot say where the
    /// lines are, and the rule stands down rather than inventing them. A
    /// snapshot captured before the lines were recorded is that DOM: the
    /// union of a long first line and a short tail is the same union as two
    /// even lines, so any width read off it is a width nothing rendered.
    #[test]
    fn a_dom_without_lines_does_not_charge_line_length() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let p = text_el(&mut d, body, "p", &"w".repeat(300), "16px");
        d.set_rect(p, 0.0, 100.0, 1020.0, 72.0);
        // The same paragraph the merge test charges, measured once.
        d.set_text_rect(p, 0.0, 100.0, 1000.0, 67.0);
        let hits = check_element_quality_dom(&d, p, &BrowserConfig::default());
        assert!(!hits.iter().any(|h| h.id == "line-length"), "{hits:?}");
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
        // The glyphs sit 2px under the top edge, as the padding says.
        d.set_text_rect(p, 52.0, 102.0, 200.0, 40.0);
        let hits = check_element_quality_dom(&d, p, &BrowserConfig::default());
        assert_eq!(hits.len(), 1, "{hits:?}");
        assert_eq!(
            hits[0].snippet,
            "2px of space above and below the text (need ≥4.8px for 16px text)"
        );
    }


    /// REN-403, the wrapper half of the same rule. Crewline's framed table:
    /// the `<table>` fills the frame edge to edge, and every cell insets its
    /// own text by the padding the stylesheet gives it. Reading the cell's
    /// border box called all four sides flush.
    #[test]
    fn flush_reads_the_text_not_the_cell_that_holds_it() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        d.set_style(body, "backgroundColor", "rgb(255, 255, 255)");
        let frame = d.add(Some(body), "div");
        d.set_attr(frame, "class", "table-frame");
        d.set_rect(frame, 0.0, 0.0, 860.0, 300.0);
        d.set_styles(
            frame,
            &[
                ("position", "static"),
                ("borderTopWidth", "1px"),
                ("borderRightWidth", "1px"),
                ("borderBottomWidth", "1px"),
                ("borderLeftWidth", "1px"),
                ("borderTopColor", "rgb(220, 220, 220)"),
                ("borderRightColor", "rgb(220, 220, 220)"),
                ("borderBottomColor", "rgb(220, 220, 220)"),
                ("borderLeftColor", "rgb(220, 220, 220)"),
                ("outlineWidth", "0px"),
                ("backgroundColor", "rgb(250, 250, 250)"),
                ("paddingTop", "0px"),
                ("paddingRight", "0px"),
                ("paddingBottom", "0px"),
                ("paddingLeft", "0px"),
                ("fontSize", "15px"),
            ],
        );
        let table = d.add(Some(frame), "table");
        d.set_rect(table, 0.0, 0.0, 860.0, 300.0);
        for (i, (x, y, w)) in [(0.0, 0.0, 430.0), (430.0, 0.0, 430.0), (0.0, 260.0, 430.0)]
            .into_iter()
            .enumerate()
        {
            let cell = d.add(Some(table), "td");
            d.add_text(cell, "Wednesday afternoon");
            d.set_rect(cell, x, y, w, 20.0);
            // Cell padding: 10px down, 16px across, which is where the text is.
            d.set_text_lines(cell, &[(x + 16.0, y + 10.0, w - 32.0, 17.0)]);
            let _ = i;
        }
        assert_eq!(check_element_quality_dom(&d, frame, &BrowserConfig::default()), vec![]);

        // A cell that really does put its text on the frame line is charged.
        let tight = d.add(Some(table), "td");
        d.add_text(tight, "Wednesday afternoon");
        d.set_rect(tight, 0.0, 140.0, 860.0, 20.0);
        d.set_text_lines(tight, &[(1.0, 140.0, 858.0, 17.0)]);
        let hits = check_element_quality_dom(&d, frame, &BrowserConfig::default());
        assert_eq!(hits.len(), 1, "{hits:?}");
        assert_eq!(
            hits[0].snippet,
            "<div> \"table-frame\": children flush against border+bg on right/left (no inset)"
        );

        // The same frame at 390px, where the table keeps its min-width and the
        // frame hides what does not fit: the right side is clipped, not snug,
        // and that is `clipped-overflow-container`'s business (REN-403).
        d.set_rect(table, 0.0, 0.0, 1400.0, 300.0);
        let hits = check_element_quality_dom(&d, frame, &BrowserConfig::default());
        assert_eq!(hits.len(), 1, "{hits:?}");
        assert_eq!(
            hits[0].snippet,
            "<div> \"table-frame\": children flush against border+bg on left (no inset)"
        );
    }

    /// REN-403. Halfday's plan button: 44px tall because the design system
    /// says every control is, `padding: 0 16px`, and the label optically
    /// centred by a flex box. The declared vertical padding is zero and the
    /// space above the label is 12px, which is what the reader sees.
    #[test]
    fn cramped_padding_measures_the_space_around_the_text() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        d.set_style(body, "backgroundColor", "rgb(255, 255, 255)");
        let btn = text_el(&mut d, body, "a", "Talk to us about Studio", "15px");
        d.set_rect(btn, 0.0, 778.7, 296.7, 44.0);
        d.set_styles(
            btn,
            &[
                ("backgroundColor", "rgb(255, 255, 255)"),
                ("borderTopWidth", "1px"),
                ("borderRightWidth", "1px"),
                ("borderBottomWidth", "1px"),
                ("borderLeftWidth", "1px"),
                ("borderTopColor", "rgb(220, 220, 220)"),
                ("borderRightColor", "rgb(220, 220, 220)"),
                ("borderBottomColor", "rgb(220, 220, 220)"),
                ("borderLeftColor", "rgb(220, 220, 220)"),
                ("paddingTop", "0px"),
                ("paddingBottom", "0px"),
                ("paddingLeft", "16px"),
                ("paddingRight", "16px"),
                ("display", "flex"),
            ],
        );
        d.set_text_lines(btn, &[(68.0, 791.2, 160.0, 18.0)]);
        assert_eq!(check_element_quality_dom(&d, btn, &BrowserConfig::default()), vec![]);

        // The same control with the label actually against the edge: charged.
        d.set_text_lines(btn, &[(68.0, 780.2, 160.0, 18.0)]);
        let hits = check_element_quality_dom(&d, btn, &BrowserConfig::default());
        assert_eq!(hits.len(), 1, "{hits:?}");
        assert_eq!(
            hits[0].snippet,
            "0.5px of space above and below the text (need ≥4.5px for 15px text)"
        );
    }

    /// A fixed-height flex row centres its label on zero padding: the padding
    /// property says 0, the reader sees 12px. Only a box where the glyphs
    /// really do crowd the edge is cramped.
    #[test]
    fn cramped_padding_reads_the_text_box_not_the_padding() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        d.set_style(body, "backgroundColor", "rgb(255, 255, 255)");
        let btn = text_el(&mut d, body, "div", "Book a free consultation", "14px");
        d.set_rect(btn, 0.0, 0.0, 240.0, 40.0);
        d.set_styles(
            btn,
            &[
                ("display", "flex"),
                ("backgroundColor", "rgb(37, 99, 235)"),
                ("borderTopWidth", "0px"),
                ("borderRightWidth", "0px"),
                ("borderBottomWidth", "0px"),
                ("borderLeftWidth", "0px"),
                ("paddingTop", "0px"),
                ("paddingBottom", "0px"),
                ("paddingLeft", "32px"),
                ("paddingRight", "32px"),
            ],
        );
        // 14px label centred in the 40px box: 12px of air above and below.
        d.set_text_rect(btn, 32.0, 12.0, 160.0, 16.0);
        assert!(check_element_quality_dom(&d, btn, &BrowserConfig::default()).is_empty());

        // Same declared padding, but the label fills the box.
        d.set_text_rect(btn, 32.0, 1.0, 160.0, 38.0);
        let hits = check_element_quality_dom(&d, btn, &BrowserConfig::default());
        assert_eq!(hits.len(), 1, "{hits:?}");
        assert_eq!(hits[0].snippet, "1px of space above and below the text (need ≥4.2px for 14px text)");
    }

    /// `border: 1px solid transparent` (a focus-ring placeholder) draws no
    /// edge, so a full-width row with no side padding crowds nothing.
    #[test]
    fn cramped_padding_ignores_a_transparent_border() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let row = text_el(&mut d, body, "div", "What does the free plan include?", "18px");
        d.set_rect(row, 0.0, 0.0, 640.0, 60.0);
        d.set_styles(
            row,
            &[
                ("paddingTop", "20px"),
                ("paddingBottom", "20px"),
                ("paddingLeft", "0px"),
                ("paddingRight", "0px"),
                ("borderTopWidth", "1px"),
                ("borderRightWidth", "1px"),
                ("borderBottomWidth", "1px"),
                ("borderLeftWidth", "1px"),
                ("borderTopColor", "rgba(0, 0, 0, 0)"),
                ("borderRightColor", "rgba(0, 0, 0, 0)"),
                ("borderBottomColor", "rgba(0, 0, 0, 0)"),
                ("borderLeftColor", "rgba(0, 0, 0, 0)"),
            ],
        );
        d.set_text_rect(row, 0.0, 21.0, 400.0, 18.0);
        assert!(check_element_quality_dom(&d, row, &BrowserConfig::default()).is_empty());
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
        // No text rect: a Dom that cannot measure glyphs keeps the boxes this
        // rule read before.
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

    /// The accordion row every component library emits: `div.border` >
    /// `h3` > `button.py-4`. The direct child carries no padding, so the
    /// insulation test sees nothing; the button's box fills the row; only
    /// its text rect shows the 16px the reader gets.
    fn accordion_row(d: &mut FakeDom) -> (ElId, ElId) {
        let (_h, body) = d.with_page();
        let row = d.add(Some(body), "div");
        d.set_attr(row, "class", "border");
        d.set_rect(row, 0.0, 0.0, 600.0, 58.0);
        d.set_styles(
            row,
            &[
                ("position", "static"),
                ("display", "block"),
                ("borderTopWidth", "1px"),
                ("borderRightWidth", "1px"),
                ("borderBottomWidth", "1px"),
                ("borderLeftWidth", "1px"),
                ("borderTopColor", "rgb(200, 200, 200)"),
                ("borderRightColor", "rgb(200, 200, 200)"),
                ("borderBottomColor", "rgb(200, 200, 200)"),
                ("borderLeftColor", "rgb(200, 200, 200)"),
                ("outlineWidth", "0px"),
                ("backgroundColor", "rgba(0, 0, 0, 0)"),
                ("paddingTop", "0px"),
                ("paddingRight", "24px"),
                ("paddingBottom", "0px"),
                ("paddingLeft", "24px"),
                ("fontSize", "16px"),
            ],
        );
        let h3 = d.add(Some(row), "h3");
        d.set_rect(h3, 24.0, 0.0, 552.0, 58.0);
        let zero = [
            ("paddingTop", "0px"),
            ("paddingRight", "0px"),
            ("paddingBottom", "0px"),
            ("paddingLeft", "0px"),
            ("marginTop", "0px"),
            ("marginRight", "0px"),
            ("marginBottom", "0px"),
            ("marginLeft", "0px"),
        ];
        d.set_styles(h3, &zero);
        let button = d.add(Some(h3), "button");
        d.add_text(button, "Which games does it work with?");
        d.set_rect(button, 24.0, 0.0, 552.0, 58.0);
        d.set_styles(button, &zero);
        (row, button)
    }

    #[test]
    fn flush_children_measure_text_not_boxes() {
        let mut d = FakeDom::new();
        let (row, button) = accordion_row(&mut d);
        // The button's own padding puts its label 20px off both rules.
        d.set_text_rect(button, 24.0, 20.0, 300.0, 18.0);
        assert!(check_element_quality_dom(&d, row, &BrowserConfig::default()).is_empty());

        // A row whose two-line label really does run into the rules.
        d.set_text_rect(button, 24.0, 1.0, 300.0, 56.0);
        let hits = check_element_quality_dom(&d, row, &BrowserConfig::default());
        assert_eq!(hits.len(), 1, "{hits:?}");
        assert_eq!(
            hits[0].snippet,
            "<div> \"border\": children flush against border on top/bottom (no inset)"
        );
    }

    /// freenet.de (218500, 218548) and sona8.com (217614, 217742, 217750,
    /// 217758): text the wrapper's padding does not place, or that a scroll
    /// reveal has not brought in yet.
    #[test]
    fn flush_ignores_text_that_is_not_the_wrappers() {
        let flush = vec!["<div> \"border\": children flush against border on top/bottom (no inset)".to_string()];
        let hits = |d: &FakeDom, row: ElId| -> Vec<String> {
            check_element_quality_dom(d, row, &BrowserConfig::default())
                .into_iter()
                .map(|h| h.snippet)
                .collect()
        };
        let mut d = FakeDom::new();
        let (row, button) = accordion_row(&mut d);
        let h3 = d.parent(button).unwrap();
        d.set_text_rect(button, 24.0, 1.0, 300.0, 56.0);
        d.set_styles(button, &[("display", "block"), ("opacity", "1"), ("position", "static")]);
        d.set_styles(h3, &[("display", "block"), ("opacity", "1"), ("position", "static")]);
        assert_eq!(hits(&d, row), flush);

        // A box on the way to the wrapper waits at opacity 0 for its reveal.
        d.set_style(h3, "opacity", "0");
        assert!(hits(&d, row).is_empty());
        d.set_style(h3, "opacity", "0.02");
        assert!(hits(&d, row).is_empty());
        d.set_style(h3, "opacity", "0.6");
        assert_eq!(hits(&d, row), flush);
        d.set_style(h3, "opacity", "1");

        // A badge pinned to the corner: the padding does not place it.
        d.set_style(button, "position", "absolute");
        assert!(hits(&d, row).is_empty());
        d.set_style(button, "position", "fixed");
        assert!(hits(&d, row).is_empty());
        d.set_style(button, "position", "relative");
        assert_eq!(hits(&d, row), flush);
        d.set_style(button, "position", "static");

        // A box that paints its own surface holds its own text; an inline
        // highlight is still the wrapper's line.
        d.set_style(h3, "backgroundColor", "rgb(20, 20, 20)");
        assert!(hits(&d, row).is_empty());
        d.set_style(h3, "display", "inline");
        assert_eq!(hits(&d, row), flush);
        d.set_styles(h3, &[("display", "block"), ("backgroundColor", "rgba(0, 0, 0, 0)")]);
        assert_eq!(hits(&d, row), flush);

        // Text further past an edge than the threshold has left the box (a
        // block a reveal starts 56px low); a pixel or two over it still lands
        // on the edge. The text is read inside its own box, so the box moves.
        let place = |d: &mut FakeDom, y: f64, h: f64| {
            d.set_rect(button, 24.0, y, 552.0, h);
            d.set_text_rect(button, 24.0, y, 300.0, h);
        };
        place(&mut d, -30.0, 50.0);
        assert!(hits(&d, row).is_empty(), "30px above the top rule, 38px off the bottom one");
        place(&mut d, -3.0, 64.0);
        assert_eq!(hits(&d, row), flush, "3px over each rule");
        place(&mut d, 1.0, 80.0);
        assert_eq!(
            hits(&d, row),
            vec!["<div> \"border\": children flush against border on top (no inset)".to_string()],
            "23px past the bottom rule"
        );
    }

    #[test]
    fn flush_ignores_hidden_and_clipped_text() {
        let mut d = FakeDom::new();
        let (row, button) = accordion_row(&mut d);
        d.set_text_rect(button, 24.0, 20.0, 300.0, 18.0);

        // A screen-reader-only heading at the box origin paints nothing.
        let sr = d.add(Some(row), "h2");
        d.add_text(sr, "Frequently asked questions");
        d.set_rect(sr, 24.0, 0.0, 1.0, 1.0);
        d.set_text_rect(sr, 24.0, 0.0, 200.0, 16.0);
        d.add_selector(sr, SR_ONLY_SELECTOR);
        assert!(check_element_quality_dom(&d, row, &BrowserConfig::default()).is_empty());

        // The collapsed answer panel lays its text out below the row and
        // clips every pixel of it away.
        let panel = d.add(Some(row), "div");
        d.set_rect(panel, 24.0, 58.0, 552.0, 0.0);
        d.set_styles(panel, &[("overflow", "hidden")]);
        let answer = d.add(Some(panel), "p");
        d.add_text(answer, "Any game with a public leaderboard.");
        d.set_rect(answer, 24.0, 58.0, 552.0, 20.0);
        d.set_text_rect(answer, 24.0, 59.0, 400.0, 18.0);
        assert!(check_element_quality_dom(&d, row, &BrowserConfig::default()).is_empty());
    }

    /// White on an unpainted page draws no edge, so the page shell is not a
    /// card whose text is flush against anything.
    #[test]
    fn white_on_the_canvas_is_not_a_boundary() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        d.set_style(body, "backgroundColor", "rgba(0, 0, 0, 0)");
        let shell = d.add(Some(body), "div");
        d.set_attr(shell, "class", "wrapper");
        d.set_rect(shell, 0.0, 0.0, 990.0, 400.0);
        d.set_styles(
            shell,
            &[
                ("position", "static"),
                ("display", "block"),
                ("backgroundColor", "rgb(255, 255, 255)"),
                ("borderTopWidth", "0px"),
                ("borderRightWidth", "0px"),
                ("borderBottomWidth", "0px"),
                ("borderLeftWidth", "0px"),
                ("outlineWidth", "0px"),
                ("paddingTop", "0px"),
                ("paddingRight", "0px"),
                ("paddingBottom", "0px"),
                ("paddingLeft", "0px"),
                ("fontSize", "16px"),
            ],
        );
        assert!(!has_visible_background_boundary(&d, shell));
        let p = text_el(&mut d, shell, "p", "Today's headlines, in full", "16px");
        d.set_rect(p, 0.0, 0.0, 990.0, 20.0);
        d.set_text_rect(p, 0.0, 2.0, 400.0, 16.0);
        assert!(check_element_quality_dom(&d, shell, &BrowserConfig::default()).is_empty());

        // A tinted card on the same page still bounds its text.
        d.set_style(shell, "backgroundColor", "rgb(15, 23, 42)");
        let hits = check_element_quality_dom(&d, shell, &BrowserConfig::default());
        assert_eq!(hits.len(), 1, "{hits:?}");
        assert_eq!(
            hits[0].snippet,
            "<div> \"wrapper\": children flush against bg on top/left (no inset)"
        );

        // The same white shell on a page that asks for a dark scheme sits on
        // the browser's dark canvas, where it is a strong edge.
        d.set_style(shell, "backgroundColor", "rgb(255, 255, 255)");
        d.set_style(shell, "colorScheme", "dark");
        assert!(has_visible_background_boundary(&d, shell));
        assert_eq!(
            check_element_quality_dom(&d, shell, &BrowserConfig::default()).len(),
            1
        );
    }

    /// A chip `height` tall on a tinted fill, 2px of vertical padding, and one
    /// label whose box and text rect are given. Returns `(chip, label)`.
    fn chip(d: &mut FakeDom, height: f64, font: &str, line_height: &str, label: (f64, f64)) -> (ElId, ElId) {
        let (_h, body) = d.with_page();
        d.set_style(body, "backgroundColor", "rgb(255, 255, 255)");
        let chip = d.add(Some(body), "div");
        d.set_attr(chip, "class", "faq-content__step");
        d.set_rect(chip, 620.0, 100.0, 66.0, height);
        d.set_styles(
            chip,
            &[
                ("position", "static"),
                ("display", "flex"),
                ("backgroundColor", "rgb(255, 170, 1)"),
                ("borderTopWidth", "0px"),
                ("borderRightWidth", "0px"),
                ("borderBottomWidth", "0px"),
                ("borderLeftWidth", "0px"),
                ("outlineWidth", "0px"),
                ("paddingTop", "2px"),
                ("paddingRight", "8px"),
                ("paddingBottom", "2px"),
                ("paddingLeft", "8px"),
                ("fontSize", "16px"),
            ],
        );
        let span = text_el(d, chip, "span", "Point", font);
        d.set_styles(
            span,
            &[
                ("display", "block"),
                ("lineHeight", line_height),
                ("paddingTop", "0px"),
                ("paddingRight", "0px"),
                ("paddingBottom", "0px"),
                ("paddingLeft", "0px"),
                ("marginTop", "0px"),
                ("marginRight", "0px"),
                ("marginBottom", "0px"),
                ("marginLeft", "0px"),
            ],
        );
        let (top, h) = label;
        d.set_rect(span, 628.0, 100.0 + top, 41.0, h);
        d.set_text_rect(span, 628.0, 100.0 + top, 41.0, h);
        (chip, span)
    }

    fn cramped(d: &FakeDom, el: ElId) -> Vec<String> {
        check_element_quality_dom(d, el, &BrowserConfig::default())
            .into_iter()
            .filter(|h| h.id == "cramped-padding")
            .map(|h| h.snippet)
            .collect()
    }

    /// Taste call r3-20: a chip under 28px tall is measured by its glyphs,
    /// half-leading included, and a 28px chip is not under 28px: the bound is
    /// strictly under 27.5px. yungching.com.tw's 24px step chip sets a 14px
    /// label on a 20px `normal` line 2px off its edges; the glyphs' em box
    /// sits 5px off. haraj.com.sa's 28px price chip holds a 19px content
    /// area 4px off inside a 24px line box 2px off and keeps the content-area
    /// measure, so it reports as it did before the decision (its em box, 5.5px
    /// off, would not).
    #[test]
    fn cramped_padding_measures_small_chips_by_their_glyphs() {
        let mut d = FakeDom::new();
        let (step, _) = chip(&mut d, 24.0, "14px", "normal", (2.0, 20.0));
        assert!(cramped(&d, step).is_empty(), "{:?}", cramped(&d, step));

        let top = vec!["<div> \"faq-content__step\": children flush against bg on top (no inset)"];
        let price = |height: f64| -> Vec<String> {
            let mut d = FakeDom::new();
            let (c, label) = chip(&mut d, height, "16px", "24px", (2.0, 24.0));
            d.set_text_rect(label, 628.0, 104.0, 41.0, 19.0);
            cramped(&d, c)
        };
        assert_eq!(price(28.0), top, "28px is not under 28px");

        // The bound is strictly under 27.5px: 27.4px is a small chip, while
        // 27.5px and a subpixel 27.6px keep the content-area measure.
        for (height, small) in [(27.4, true), (27.5, false), (27.6, false)] {
            let c = price(height);
            if small {
                assert!(c.is_empty(), "{height}px is a small chip: {c:?}");
            } else {
                assert_eq!(c, top, "{height}px is not a small chip");
            }
        }

        // The step chip's label geometry past the bound keeps the
        // content-area measure.
        let mut d = FakeDom::new();
        let (tall, _) = chip(&mut d, 30.0, "14px", "normal", (2.0, 20.0));
        assert_eq!(cramped(&d, tall), top);

        // A chip whose glyphs really do touch its edges still reports: a 16px
        // label on a 16px line in a 20px chip, its 19px content area 0.5px
        // off, keeps its em box 2px off the top and bottom.
        let mut d = FakeDom::new();
        let (touching, label) = chip(&mut d, 20.0, "16px", "16px", (2.0, 16.0));
        d.set_text_rect(label, 628.0, 100.5, 41.0, 19.0);
        assert_eq!(
            cramped(&d, touching),
            vec!["<div> \"faq-content__step\": children flush against bg on top/bottom (no inset)"]
        );
    }

    /// observations-28 row 13: sides a reader sees no edge on. A band that
    /// runs on into a sibling of the same fill (cencora.com), a fill laid on
    /// a positioned layer of the same colour (hp.com), and a line a clipping
    /// box cuts (a table scrolled sideways, a title an ellipsis ends) do not
    /// crowd a boundary.
    #[test]
    fn cramped_padding_reads_the_edges_a_reader_sees() {
        let band_page = |layer: bool| -> (FakeDom, ElId, ElId, ElId) {
            let mut d = FakeDom::new();
            let (_h, body) = d.with_page();
            d.set_style(body, "backgroundColor", "rgb(255, 255, 255)");
            let host = d.add(Some(body), "div");
            d.set_rect(host, 0.0, 100.0, 390.0, 200.0);
            if layer {
                let l = d.add(Some(host), "div");
                d.set_styles(l, &[("position", "absolute"), ("backgroundColor", "rgb(245, 245, 245)")]);
                d.set_rect(l, 0.0, 100.0, 390.0, 200.0);
            }
            let wrap = d.add(Some(host), "div");
            d.set_rect(wrap, 16.0, 100.0, 358.0, 200.0);
            let band = d.add(Some(wrap), "div");
            d.set_attr(band, "class", "band");
            d.set_rect(band, 16.0, 100.0, 358.0, 48.0);
            d.set_styles(band, &[("display", "block"), ("position", "static"), ("backgroundColor", "rgb(245, 245, 245)")]);
            let copy = text_el(&mut d, band, "p", "Copy that runs to the bottom edge", "14px");
            d.set_styles(copy, &[("paddingTop", "12px"), ("paddingLeft", "16px"), ("paddingRight", "16px")]);
            d.set_rect(copy, 16.0, 100.0, 358.0, 48.0);
            d.set_text_rect(copy, 32.0, 127.0, 300.0, 20.0);
            (d, wrap, band, copy)
        };
        let bottom = vec!["<div> \"band\": children flush against bg on bottom (no inset)"];
        let (mut d, wrap, band, _) = band_page(false);
        assert_eq!(cramped(&d, band), bottom);
        // The next band, abutting, is the same grey.
        let next = d.add(Some(wrap), "div");
        d.set_rect(next, 16.0, 148.0, 358.0, 40.0);
        d.set_style(next, "backgroundColor", "rgb(245, 245, 245)");
        assert!(cramped(&d, band).is_empty(), "same fill below");
        d.set_style(next, "backgroundColor", "rgb(224, 231, 255)");
        assert_eq!(cramped(&d, band), bottom, "another fill below");
        // The grey around the band is a positioned layer under the content.
        let (d, _, band, _) = band_page(true);
        assert!(cramped(&d, band).is_empty(), "same fill on a layer");

        // A line cut by a box that clips x (an ellipsis inside the band's
        // inset) reaches no side of the band.
        let (mut d, _, band, copy) = band_page(false);
        d.set_styles(copy, &[("paddingBottom", "12px"), ("paddingRight", "0px")]);
        d.set_text_rect(copy, 32.0, 112.0, 300.0, 20.0);
        let name = d.add(Some(copy), "span");
        d.add_text(name, "A post title an ellipsis ends inside the inset");
        d.set_styles(name, &[("display", "block"), ("overflowX", "hidden"), ("position", "static")]);
        d.set_rect(name, 32.0, 112.0, 326.0, 20.0);
        d.el_mut(name).client_width = 326.0;
        let run = d.add(Some(name), "span");
        d.add_text(run, "A post title an ellipsis ends inside the inset");
        d.set_styles(run, &[("display", "inline"), ("position", "static")]);
        d.set_rect(run, 32.0, 112.0, 380.0, 20.0);
        d.set_text_rect(run, 32.0, 112.0, 380.0, 20.0);
        assert!(cramped(&d, band).is_empty(), "cut by the ellipsis box: {:?}", cramped(&d, band));
        // Unclipped, the run ends 38px past the band's right side: it runs
        // out of the band, which is not text held against its edge.
        d.set_style(name, "overflowX", "visible");
        assert!(cramped(&d, band).is_empty(), "past the edge: {:?}", cramped(&d, band));
        // Ending on the edge, it is.
        d.set_rect(run, 32.0, 112.0, 342.0, 20.0);
        d.set_text_rect(run, 32.0, 112.0, 342.0, 20.0);
        assert_eq!(cramped(&d, band), vec!["<div> \"band\": children flush against bg on right (no inset)"]);
    }

    /// observations-42 row 5, nexttv.com.tw: a 66px line box whose second
    /// line wraps out below the box. The box holds the first line, 23px off
    /// each edge; the line below it is not text against the bottom border.
    /// A full-width band's sides are the screen's edges, not a box's.
    #[test]
    fn cramped_padding_measures_the_lines_the_box_holds() {
        let page = |lines: bool, width: f64| -> (FakeDom, ElId) {
            let mut d = FakeDom::new();
            d.inner_width = 390.0;
            let (_h, body) = d.with_page();
            d.set_style(body, "backgroundColor", "rgb(255, 255, 255)");
            let p = text_el(&mut d, body, "p", "Copyright NEXT TV Broadcasting Ltd. All rights reserved.", "14px");
            d.set_attr(p, "class", "copyright");
            d.set_rect(p, 0.0, 1370.0, width, 66.0);
            d.set_styles(
                p,
                &[
                    ("display", "block"),
                    ("lineHeight", "66px"),
                    ("backgroundColor", "rgb(64, 64, 64)"),
                    ("paddingTop", "0px"),
                    ("paddingBottom", "0px"),
                    ("paddingLeft", "0px"),
                    ("paddingRight", "0px"),
                ],
            );
            if lines {
                d.set_text_lines(p, &[(1.0, 1393.0, 387.0, 20.0), (92.0, 1459.0, 205.0, 20.0)]);
            } else {
                d.set_text_rect(p, 1.0, 1393.0, 387.0, 86.0);
            }
            (d, p)
        };
        let (d, p) = page(true, 390.0);
        assert!(cramped(&d, p).is_empty(), "{:?}", cramped(&d, p));
        // A capture with no lines measures the union, as before.
        let (d, p) = page(false, 390.0);
        assert_eq!(cramped(&d, p), vec!["0px of space above and below the text (need ≥4.2px for 14px text)"]);
        // A band narrower than the window has sides a reader sees, even a
        // wide one inset from both edges.
        let (d, p) = page(true, 360.0);
        assert_eq!(cramped(&d, p), vec!["0px of space beside the text (need ≥8.0px for 14px text)"]);
        // A 100% band stops at a classic scrollbar, short of the window.
        let (mut d, p) = page(true, 375.0);
        let html = d.document_element.unwrap();
        d.el_mut(html).client_width = 375.0;
        assert!(cramped(&d, p).is_empty(), "{:?}", cramped(&d, p));
        let (mut d, p) = page(true, 380.0);
        d.set_rect(p, 5.0, 1370.0, 380.0, 66.0);
        assert_eq!(cramped(&d, p), vec!["0px of space beside the text (need ≥8.0px for 14px text)"]);
    }

    /// observations-42 row 5, s-1.vercel.app: a `<mark>` highlight is a run
    /// of text inside a line; its fill hugs the glyphs by design.
    #[test]
    fn cramped_padding_skips_an_inline_highlight() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        d.set_style(body, "backgroundColor", "rgb(255, 255, 255)");
        let mark = text_el(&mut d, body, "mark", "trust compounds where nothing else does", "22px");
        d.set_styles(
            mark,
            &[
                ("display", "inline"),
                ("lineHeight", "32.3px"),
                ("backgroundColor", "rgb(255, 236, 153)"),
                ("paddingTop", "0px"),
                ("paddingBottom", "0px"),
                ("paddingLeft", "0px"),
                ("paddingRight", "0px"),
            ],
        );
        d.set_rect(mark, 40.0, 100.0, 600.0, 194.0);
        d.set_text_rect(mark, 40.0, 100.0, 600.0, 194.0);
        assert!(cramped(&d, mark).is_empty(), "{:?}", cramped(&d, mark));
        d.set_style(mark, "display", "inline-block");
        assert_eq!(cramped(&d, mark), vec!["0px of space above and below the text (need ≥6.6px for 22px text)"]);
    }

    /// A wrapper with a grey fill and the text at its right edge, inside a
    /// row whose own paint is set by `fill`.
    fn wrapper_in_row(row_bg: &str, row_image: &str) -> (FakeDom, ElId, ElId) {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        d.set_style(body, "backgroundColor", "rgb(255, 255, 255)");
        let row = d.add(Some(body), "div");
        d.set_rect(row, 50.0, 100.0, 580.0, 132.0);
        d.set_styles(row, &[("backgroundColor", row_bg), ("backgroundImage", row_image)]);
        let wrap = d.add(Some(row), "div");
        d.set_attr(wrap, "class", "main-section");
        d.set_rect(wrap, 180.0, 123.0, 374.0, 86.0);
        d.set_styles(
            wrap,
            &[("display", "flex"), ("position", "static"), ("backgroundColor", "rgb(243, 243, 243)")],
        );
        let copy = text_el(&mut d, wrap, "p", "Single-family credit risk transfer", "16px");
        d.set_styles(copy, &[("paddingTop", "16px"), ("paddingLeft", "16px"), ("paddingRight", "0px")]);
        d.set_rect(copy, 180.0, 123.0, 374.0, 86.0);
        d.set_text_rect(copy, 196.0, 139.0, 357.0, 22.0);
        (d, row, wrap)
    }

    /// observations-42 row 5, freddiemac.com: the row paints the card's grey
    /// with a gradient past 50px, and the grey text panel on it draws no edge.
    #[test]
    fn cramped_padding_reads_a_gradient_that_paints_the_same_fill() {
        let right = vec!["<div> \"main-section\": children flush against bg on right (no inset)"];
        let (d, _, wrap) = wrapper_in_row("rgba(0, 0, 0, 0)", "none");
        assert_eq!(cramped(&d, wrap), right, "on the white page");
        let (d, _, wrap) = wrapper_in_row(
            "rgba(0, 0, 0, 0)",
            "linear-gradient(to right, rgba(0, 0, 0, 0) 50px, rgb(243, 243, 243) 50px)",
        );
        assert!(cramped(&d, wrap).is_empty(), "{:?}", cramped(&d, wrap));
        // A gradient of another colour, or a picture, is read as before.
        let (d, _, wrap) = wrapper_in_row(
            "rgba(0, 0, 0, 0)",
            "linear-gradient(to right, rgba(0, 0, 0, 0) 50px, rgb(30, 64, 175) 50px)",
        );
        assert_eq!(cramped(&d, wrap), right, "another colour");
        let (d, _, wrap) = wrapper_in_row("rgba(0, 0, 0, 0)", "url(\"card.png\")");
        assert_eq!(cramped(&d, wrap), right, "a picture");
        // The panel over the transparent part of the row shows the page.
        let (d, _, wrap) = wrapper_in_row(
            "rgba(0, 0, 0, 0)",
            "linear-gradient(to right, rgba(0, 0, 0, 0) 200px, rgb(243, 243, 243) 200px)",
        );
        assert_eq!(cramped(&d, wrap), right, "over the transparent part");
        let (d, _, wrap) = wrapper_in_row(
            "rgba(0, 0, 0, 0)",
            "linear-gradient(to right, rgba(0, 0, 0, 0) 20%, rgb(243, 243, 243) 20%)",
        );
        assert!(cramped(&d, wrap).is_empty(), "past 20% of the row");
        // The same grey drawn as a 2px rule along the row's edge paints
        // nothing under the panel; at a size that fills the row it does.
        let grey = "linear-gradient(rgb(243, 243, 243), rgb(243, 243, 243))";
        let (mut d, row, wrap) = wrapper_in_row("rgba(0, 0, 0, 0)", grey);
        assert!(cramped(&d, wrap).is_empty(), "{:?}", cramped(&d, wrap));
        d.set_style(row, "backgroundSize", "100% 2px");
        assert_eq!(cramped(&d, wrap), right, "a strip of the fill");
        d.set_style(row, "backgroundSize", "100% 100%");
        assert!(cramped(&d, wrap).is_empty(), "{:?}", cramped(&d, wrap));
    }

    /// A length stop is scaled along its own axis. A row drawn at
    /// `scaleX(0.5)` keeps its height, so a downward gradient that starts
    /// its fill at 100px still starts it 100px down: a panel that begins
    /// 75px down lies partly on the page and keeps its edge. Scaling the
    /// stop by the width's half put the fill at 50px and dropped the finding.
    #[test]
    fn a_gradient_length_stop_is_scaled_along_its_own_axis() {
        let right = vec!["<div> \"main-section\": children flush against bg on right (no inset)"];
        // The row is laid out 1160 x 300 and drawn 580 x 300; the panel's
        // top is 75px below the row's.
        let build = |image: &str, squeeze: (f64, f64)| {
            let (mut d, row, wrap) = wrapper_in_row("rgba(0, 0, 0, 0)", image);
            d.set_rect(row, 50.0, 48.0, 580.0, 300.0);
            d.el_mut(row).offset_width = 580.0 / squeeze.0;
            d.el_mut(row).offset_height = 300.0 / squeeze.1;
            (d, wrap)
        };
        let down = "linear-gradient(to bottom, rgba(0, 0, 0, 0) 100px, rgb(243, 243, 243) 100px)";
        let (d, wrap) = build(down, (0.5, 1.0));
        assert_eq!(cramped(&d, wrap), right, "squeezed across, the fill still starts 100px down");
        // Squeezed down instead, the same stop is drawn 50px down and the
        // panel lies wholly on the fill.
        let (d, wrap) = build(down, (1.0, 0.5));
        assert!(cramped(&d, wrap).is_empty(), "{:?}", cramped(&d, wrap));
        // A stop along x takes the width's scale and ignores the height's:
        // the panel starts 130px in, past a 200px stop drawn at half width
        // and short of one drawn at full width.
        let across = "linear-gradient(to right, rgba(0, 0, 0, 0) 200px, rgb(243, 243, 243) 200px)";
        let (d, wrap) = build(across, (0.5, 1.0));
        assert!(cramped(&d, wrap).is_empty(), "{:?}", cramped(&d, wrap));
        let (d, wrap) = build(across, (1.0, 0.5));
        assert_eq!(cramped(&d, wrap), right, "squeezed down, the fill still starts 200px in");
    }

    /// observations-42 row 5, telekom.de: the magenta card sits on a photo
    /// laid under it by an earlier, absolutely positioned sibling; the white
    /// page behind the photo is not an edge a reader sees.
    #[test]
    fn cramped_padding_reads_a_photo_laid_under_the_fill() {
        let page = |photo: bool| -> (FakeDom, ElId) {
            let mut d = FakeDom::new();
            let (_h, body) = d.with_page();
            d.set_style(body, "backgroundColor", "rgb(255, 255, 255)");
            let frame = d.add(Some(body), "div");
            d.set_rect(frame, 2.0, 100.0, 386.0, 500.0);
            let layer = d.add(Some(frame), "div");
            d.set_styles(layer, &[("position", "absolute"), ("backgroundColor", "rgba(0, 0, 0, 0)")]);
            d.set_rect(layer, 12.0, 110.0, 366.0, 480.0);
            let picture = d.add(Some(layer), "picture");
            d.set_style(picture, "display", "inline");
            d.set_rect(picture, 12.0, 574.0, 366.0, 21.0);
            let img = d.add(Some(picture), "img");
            d.set_style(img, "display", "inline");
            if photo {
                d.set_rect(img, 12.0, 110.0, 366.0, 480.0);
            } else {
                d.set_rect(img, 12.0, 110.0, 366.0, 120.0);
            }
            let content = d.add(Some(frame), "div");
            d.set_rect(content, 12.0, 100.0, 366.0, 500.0);
            let card = d.add(Some(content), "div");
            d.set_attr(card, "class", "teaser");
            d.set_rect(card, 71.0, 374.0, 248.0, 196.0);
            d.set_styles(card, &[("display", "block"), ("position", "static"), ("backgroundColor", "rgb(226, 0, 116)")]);
            let h = text_el(&mut d, card, "h2", "Das ultimative Upgrade.", "32px");
            d.set_styles(h, &[("paddingLeft", "0px")]);
            d.set_rect(h, 71.0, 374.0, 224.0, 64.0);
            d.set_text_rect(h, 71.0, 374.0, 189.0, 64.0);
            (d, card)
        };
        let (d, card) = page(true);
        assert!(cramped(&d, card).is_empty(), "{:?}", cramped(&d, card));
        let (d, card) = page(false);
        assert_eq!(cramped(&d, card), vec!["<div> \"teaser\": children flush against bg on top/left (no inset)"]);
        // A photo that paints nothing is no backdrop.
        let (mut d, card) = page(true);
        let img = d.query_all(None, "img").unwrap()[0];
        d.set_style(img, "opacity", "0");
        assert_eq!(cramped(&d, card), vec!["<div> \"teaser\": children flush against bg on top/left (no inset)"]);
        // Drawn content is not a photo: a panel on a map canvas keeps its
        // edge.
        let (mut d, card) = page(true);
        let img = d.query_all(None, "img").unwrap()[0];
        d.els[img as usize].tag = "CANVAS".to_string();
        assert_eq!(cramped(&d, card), vec!["<div> \"teaser\": children flush against bg on top/left (no inset)"]);
    }

    /// observations-42 row 5, maritime.sh: a 16px mock URL bar holds 10px
    /// text 3px off its edges. A small chip's glyphs need a quarter of their
    /// font size, which is 4px only for 16px text.
    #[test]
    fn cramped_padding_scales_a_small_chips_air_with_its_text() {
        let mut d = FakeDom::new();
        let (bar, label) = chip(&mut d, 16.0, "10px", "15px", (0.5, 15.0));
        d.set_style(bar, "paddingTop", "0px");
        d.set_style(bar, "paddingBottom", "0px");
        d.set_text_rect(label, 628.0, 102.5, 41.0, 11.0);
        assert!(cramped(&d, bar).is_empty(), "{:?}", cramped(&d, bar));
        // 1px off is under a quarter of 10px.
        d.set_text_rect(label, 628.0, 100.5, 41.0, 11.0);
        assert_eq!(cramped(&d, bar), vec!["<div> \"faq-content__step\": children flush against bg on top (no inset)"]);
    }

    /// observations-42 row 6, fanniemae.com: a section title set at 28px in
    /// a generic `div` is display text, not body copy at the screen's edge.
    #[test]
    fn a_generic_block_at_display_size_is_not_prose() {
        let edge = |font: &str| {
            let mut d = FakeDom::new();
            d.inner_width = 390.0;
            let (_h, body) = d.with_page();
            let title = text_el(&mut d, body, "div", "Our mission is to make housing work for everyone.", font);
            d.set_styles(title, &[("display", "block"), ("lineHeight", "36px")]);
            d.set_rect(title, 10.0, 100.0, 370.0, 72.0);
            d.set_text_lines(title, &[(10.0, 102.0, 300.0, 32.0), (10.0, 138.0, 120.0, 32.0)]);
            snippets(&d, title, "body-text-viewport-edge")
        };
        assert_eq!(edge("18px").len(), 1, "body copy in a div");
        assert!(edge("28px").is_empty(), "{:?}", edge("28px"));
    }

    #[test]
    fn glyph_band_centres_the_em_box_on_each_line() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let one = text_el(&mut d, body, "span", "Point", "14px");
        let t = Rect::from_xywh(0.0, 10.0, 40.0, 20.0);
        let g = glyph_band(&d, one, &t);
        assert_eq!((g.top, g.bottom, g.left, g.right), (13.0, 27.0, 0.0, 40.0));

        // Two 18px lines 18px apart: the content area is 21.6px (1.2em)
        // and the union 39.6px; the em box moves 1.8px in at each end.
        let two = text_el(&mut d, body, "span", "Two lines of label text", "18px");
        d.set_style(two, "lineHeight", "18px");
        let t = Rect::from_xywh(0.0, 0.0, 200.0, 39.6);
        let g = glyph_band(&d, two, &t);
        assert!((g.top - 1.8).abs() < 1e-9 && (g.bottom - 37.8).abs() < 1e-9, "{g:?}");

        // A content area no taller than the font size has nothing to take off.
        let tight = text_el(&mut d, body, "span", "Tight face", "16px");
        let t = Rect::from_xywh(0.0, 0.0, 60.0, 15.0);
        assert_eq!(glyph_band(&d, tight, &t), t);
    }

    /// `direct_text_rect` is a font-metric box, not an ink box: half-leading
    /// and scripts with tall marks push it out of the box that paints the
    /// text, where no glyph can land. Measure the part inside that box.
    #[test]
    fn flush_clamps_text_to_the_box_that_paints_it() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        d.set_style(body, "backgroundColor", "rgb(255, 255, 255)");
        let panel = d.add(Some(body), "div");
        d.set_attr(panel, "class", "story-body");
        d.set_rect(panel, 0.0, 0.0, 360.0, 120.0);
        d.set_styles(
            panel,
            &[
                ("position", "static"),
                ("display", "block"),
                ("backgroundColor", "rgba(0, 0, 0, 0)"),
                ("borderTopWidth", "0px"),
                ("borderRightWidth", "0px"),
                ("borderBottomWidth", "1px"),
                ("borderLeftWidth", "0px"),
                ("borderBottomColor", "rgb(200, 200, 200)"),
                ("outlineWidth", "0px"),
                ("paddingTop", "0px"),
                ("paddingRight", "0px"),
                ("paddingBottom", "0px"),
                ("paddingLeft", "0px"),
                ("fontSize", "16px"),
            ],
        );
        // A plain wrapper, so the paragraph below is not a direct child and
        // the child-box insulation says nothing about it.
        let inner = d.add(Some(panel), "div");
        d.set_rect(inner, 0.0, 0.0, 360.0, 120.0);
        let p = text_el(&mut d, inner, "p", "एक पूरी कहानी यहाँ पढ़ें", "16px");
        d.set_styles(
            p,
            &[
                ("paddingTop", "0px"),
                ("paddingRight", "0px"),
                ("paddingBottom", "0px"),
                ("paddingLeft", "0px"),
                ("marginTop", "0px"),
                ("marginRight", "0px"),
                ("marginBottom", "0px"),
                ("marginLeft", "0px"),
            ],
        );
        // The paragraph ends 10px above the rule; its metric box runs 15px
        // past its own box and so past the rule.
        d.set_rect(p, 0.0, 10.0, 360.0, 100.0);
        d.set_text_rect(p, 0.0, 6.0, 340.0, 119.0);
        assert!(check_element_quality_dom(&d, panel, &BrowserConfig::default()).is_empty());

        // The shape the corpus confirms harmful: the label's own box overruns
        // the panel and its glyphs come with it.
        d.set_rect(p, 0.0, 10.0, 360.0, 115.0);
        d.set_text_rect(p, 0.0, 12.0, 340.0, 108.0);
        let hits = check_element_quality_dom(&d, panel, &BrowserConfig::default());
        assert_eq!(hits.len(), 1, "{hits:?}");
        assert_eq!(
            hits[0].snippet,
            "<div> \"story-body\": children flush against border-bottom on bottom (no inset)"
        );
    }

    #[test]
    fn typography_rules() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let text = "a".repeat(90);
        let p = text_el(&mut d, body, "p", &text, "16px");
        d.set_rect(p, 40.0, 100.0, 300.0, 40.0);
        d.set_styles(p, &[("lineHeight", "16px"), ("textAlign", "justify"), ("hyphens", "manual"), ("letterSpacing", "2px")]);
        let hits = check_element_quality_dom(&d, p, &BrowserConfig::default());
        let ids: Vec<&str> = hits.iter().map(|h| h.id.as_str()).collect();
        assert_eq!(ids, vec!["tight-leading", "justified-text", "wide-tracking"], "{hits:?}");
        assert_eq!(hits[0].snippet, "line-height 1.00x (need >=1.3)");
        assert_eq!(hits[2].snippet, "letter-spacing: 0.13em on body text");
        d.set_styles(p, &[("lineHeight", "24px"), ("textAlign", "left"), ("letterSpacing", "-1.6px"), ("textTransform", "uppercase")]);
        // 90 characters of uppercase: past the length where a run is read.
        let hits = check_element_quality_dom(&d, p, &BrowserConfig::default());
        let ids: Vec<&str> = hits.iter().map(|h| h.id.as_str()).collect();
        assert_eq!(ids, vec!["all-caps-body", "extreme-negative-tracking"], "{hits:?}");
        assert_eq!(hits[1].snippet, format!("letter-spacing: -0.10em at 16px — \"{}\"", "a".repeat(40)));
    }

    #[test]
    fn crushed_tracking_is_size_scaled_and_latin_only() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let latin = "Tightened headline copy running past twenty characters";

        let flags = |d: &FakeDom, el: ElId| {
            check_element_quality_dom(d, el, &BrowserConfig::default())
                .into_iter()
                .any(|h| h.id == "extreme-negative-tracking")
        };

        // Reading size: -0.05em (Tailwind's tracking-tighter) and -0.06em pass.
        let p = text_el(&mut d, body, "p", latin, "16px");
        d.set_rect(p, 40.0, 100.0, 300.0, 40.0);
        for ls in ["-0.05em", "-0.06em"] {
            d.set_styles(p, &[("letterSpacing", ls)]);
            assert!(!flags(&d, p), "{ls} at 16px should pass");
        }
        d.set_styles(p, &[("letterSpacing", "-0.08em")]);
        assert!(flags(&d, p), "-0.08em at 16px should flag");

        // Display size: the same -0.08em is conventional optical tightening.
        let h = text_el(&mut d, body, "h1", latin, "48px");
        d.set_rect(h, 40.0, 200.0, 600.0, 60.0);
        d.set_styles(h, &[("letterSpacing", "-0.08em")]);
        assert!(!flags(&d, h), "-0.08em at 48px should pass");
        d.set_styles(h, &[("letterSpacing", "-0.1em")]);
        assert!(flags(&d, h), "-0.1em at 48px should flag");

        // CJK glyphs are out of scope whatever the lang attribute says.
        let cjk = text_el(&mut d, body, "p", "赓续长征精神奋进复兴征程福建守护红色家底新时代新征程", "18px");
        d.set_rect(cjk, 40.0, 300.0, 300.0, 40.0);
        d.set_styles(cjk, &[("letterSpacing", "-0.1em")]);
        assert!(!flags(&d, cjk), "CJK text should pass");
    }

    /// The tight-leading floor is a body-copy floor. Reviewing the rule's
    /// output on real pages found it applied to display type, to heading text
    /// that sits in a child anchor or span, to text that renders one line, to
    /// source text nothing typesets, and to pages that set the floor exactly.
    #[test]
    fn tight_leading_carve_outs() {
        const COPY: &str = "This card description is comfortably longer than the fifty characters the leading check asks for.";

        fn leading(d: &FakeDom, el: ElId) -> Vec<String> {
            check_element_quality_dom(d, el, &BrowserConfig::default())
                .into_iter()
                .filter(|h| h.id == "tight-leading")
                .map(|h| h.snippet)
                .collect()
        }
        // Two wrapped lines of 16px copy on a 20px line box.
        fn wrapped(d: &mut FakeDom, parent: ElId, tag: &str, font: &str, lh: f64) -> ElId {
            let el = text_el(d, parent, tag, COPY, font);
            d.set_style(el, "lineHeight", &format!("{lh}px"));
            d.set_rect(el, 40.0, 100.0, 240.0, lh * 2.0);
            d.el_mut(el).direct_text_rect = Some(Rect::from_xywh(40.0, 100.0, 240.0, lh * 2.0));
            el
        }

        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();

        // Body copy under the floor: the case the rule is for.
        let copy = wrapped(&mut d, body, "p", "16px", 20.0);
        assert_eq!(leading(&d, copy), vec!["line-height 1.25x (need >=1.3)"]);

        // Display type carries its own leading.
        let display = wrapped(&mut d, body, "p", "32px", 38.4);
        assert!(leading(&d, display).is_empty(), "32px display type");
        let boundary = wrapped(&mut d, body, "p", "22px", 26.0);
        assert_eq!(
            leading(&d, boundary),
            vec!["line-height 1.18x (need >=1.3)"],
            "22px is still reading copy"
        );

        // One line box: there is no gap between lines to crowd.
        let one_line = wrapped(&mut d, body, "p", "16px", 20.0);
        d.set_rect(one_line, 40.0, 100.0, 900.0, 20.0);
        d.el_mut(one_line).direct_text_rect = Some(Rect::from_xywh(40.0, 100.0, 900.0, 20.0));
        assert!(leading(&d, one_line).is_empty(), "single line box");

        // Heading text in a child anchor, and a card title on the ARIA role.
        let h3 = d.add(Some(body), "h3");
        let link = wrapped(&mut d, h3, "a", "18px", 21.6);
        assert!(leading(&d, link).is_empty(), "anchor inside a heading");
        let titled = wrapped(&mut d, body, "span", "18px", 21.6);
        d.add_selector(titled, "[role=\"heading\"]");
        assert!(leading(&d, titled).is_empty(), "role=heading card title");
        // A block of reading copy nested inside a heading is still body copy.
        let nested = wrapped(&mut d, h3, "p", "16px", 17.6);
        assert_eq!(
            leading(&d, nested),
            vec!["line-height 1.10x (need >=1.3)"],
            "paragraph nested in a heading"
        );
        // And so is an inline run inside that paragraph.
        let nested_p = d.add(Some(h3), "p");
        let nested_run = wrapped(&mut d, nested_p, "span", "16px", 17.6);
        assert_eq!(
            leading(&d, nested_run),
            vec!["line-height 1.10x (need >=1.3)"],
            "span in a paragraph nested in a heading"
        );

        // line-height: 1.3 on 18px computes to 23.4px, and 23.4 / 18 lands
        // just under 1.3 in binary floats.
        let at_floor = wrapped(&mut d, body, "p", "18px", 23.4);
        assert!(leading(&d, at_floor).is_empty(), "exactly at the floor");

        // Source text nothing typesets, and text with no box at all.
        let script = wrapped(&mut d, body, "script", "16px", 16.0);
        assert!(leading(&d, script).is_empty(), "script source");
        let hidden = wrapped(&mut d, body, "p", "16px", 16.0);
        d.set_style(hidden, "display", "none");
        assert!(leading(&d, hidden).is_empty(), "display:none");
        let sr = wrapped(&mut d, body, "p", "16px", 16.0);
        d.add_selector(sr, SR_ONLY_SELECTOR);
        assert!(leading(&d, sr).is_empty(), "screen-reader-only copy");
        let boxless = wrapped(&mut d, body, "p", "16px", 16.0);
        d.set_rect(boxless, 0.0, 0.0, 0.0, 0.0);
        d.el_mut(boxless).direct_text_rect = None;
        assert!(leading(&d, boxless).is_empty(), "zero-area box");
    }

    fn snippets(d: &FakeDom, el: ElId, rule: &str) -> Vec<String> {
        check_element_quality_dom(d, el, &BrowserConfig::default())
            .into_iter()
            .filter(|h| h.id == rule)
            .map(|h| h.snippet)
            .collect()
    }

    /// observations-20 row 8: a one-line note in a wide box, a centred footer
    /// line and a block that never fills its column reported while the
    /// estimate read the box. The rendered lines decide.
    #[test]
    fn line_length_measures_the_rendered_text() {
        let long = "word ".repeat(40);
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let p = text_el(&mut d, body, "p", &long, "16px");
        d.set_style(p, "lineHeight", "24px");
        d.set_rect(p, 40.0, 100.0, 1200.0, 48.0);

        // Two lines that fill their 1,200px box.
        d.set_text_lines(p, &[(40.0, 102.0, 1180.0, 20.0), (40.0, 126.0, 1180.0, 20.0)]);
        assert_eq!(
            snippets(&d, p, "line-length"),
            vec!["~100 chars on 2 of 2 rendered lines (aim for <80)"]
        );
        // One line in the same box sends the eye nowhere.
        d.set_text_lines(p, &[(40.0, 102.0, 1180.0, 20.0)]);
        assert!(snippets(&d, p, "line-length").is_empty(), "one line");
        // Centred lines well short of the box: 119 characters on two lines
        // is ~60 a line.
        let centred = text_el(&mut d, body, "p", &"word ".repeat(24), "16px");
        d.set_style(centred, "lineHeight", "24px");
        d.set_rect(centred, 40.0, 200.0, 1200.0, 48.0);
        d.set_text_lines(centred, &[(340.0, 202.0, 600.0, 20.0), (340.0, 226.0, 600.0, 20.0)]);
        assert!(snippets(&d, centred, "line-length").is_empty(), "centred block");
        // A union with no lines behind it is not read.
        d.el_mut(p).text_line_rects = None;
        d.set_text_rect(p, 40.0, 102.0, 1180.0, 44.0);
        assert!(snippets(&d, p, "line-length").is_empty(), "no lines recorded");

        // simplybudget.framer.ai: 94 characters on two lines ended by a
        // `<br>`. Each line is as long as the author left it.
        let broken = text_el(&mut d, body, "p", &"word ".repeat(19), "16px");
        d.set_style(broken, "lineHeight", "28.8px");
        d.set_rect(broken, 260.0, 900.0, 760.0, 57.6);
        d.set_text_lines(broken, &[(260.0, 904.0, 660.0, 20.0), (260.0, 933.0, 80.0, 20.0)]);
        assert!(snippets(&d, broken, "line-length").is_empty(), "one long line and a tail");
    }

    /// observations-20 row 29: a full-width CJK glyph is an em wide. The
    /// characters divide between the rendered lines, whatever their advance,
    /// so a CJK column is charged at its own count.
    #[test]
    fn line_length_counts_cjk_glyphs_at_an_em() {
        let copy = "戸建/マンションは、NTTから送付される「開通のご案内」に記載の「ご利用サービス名」など、回線事業者からの案内をご確認のうえタイプに合ったコースをお選びください。".repeat(2);
        let len = utf16_len(&copy);
        assert!(len > 80);
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let p = text_el(&mut d, body, "p", &copy, "16px");
        d.set_style(p, "lineHeight", "24px");
        d.set_rect(p, 110.0, 100.0, 1060.0, 72.0);
        d.set_text_lines(
            p,
            &[(110.0, 104.0, 1048.0, 16.0), (110.0, 128.0, 1048.0, 16.0), (110.0, 152.0, 1048.0, 16.0)],
        );
        assert!(snippets(&d, p, "line-length").is_empty(), "a third of the glyphs a line");
        // A wider CJK column still reports, at its own count.
        let wide = text_el(&mut d, body, "p", &copy.repeat(2), "16px");
        d.set_rect(wide, 0.0, 300.0, 1600.0, 72.0);
        d.set_text_lines(
            wide,
            &[(0.0, 304.0, 1590.0, 16.0), (0.0, 328.0, 1590.0, 16.0), (0.0, 352.0, 1590.0, 16.0)],
        );
        let hits = snippets(&d, wide, "line-length");
        assert_eq!(hits.len(), 1, "{hits:?}");
        assert!(hits[0].starts_with("~10"), "{hits:?}");
    }

    /// walkthroughs-20 miss 2: prose whose words sit wholly in `<b>`, `<i>` or
    /// `<span>` was never measured, because the paragraph has no direct text.
    #[test]
    fn prose_in_inline_children_is_measured_on_its_paragraph() {
        let long = "word ".repeat(40);
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        d.inner_width = 1280.0;
        let intro = text_el(&mut d, body, "p", "", "16px");
        d.set_styles(intro, &[("lineHeight", "24px"), ("display", "block")]);
        d.set_rect(intro, 0.0, 100.0, 1280.0, 72.0);
        let b = d.add(Some(intro), "b");
        d.set_style(b, "display", "inline");
        d.add_text(b, "Opening words ");
        d.set_text_rect(b, 0.0, 102.0, 120.0, 20.0);
        let i = d.add(Some(intro), "i");
        d.set_style(i, "display", "inline");
        d.add_text(i, &long);
        d.set_text_rect(i, 0.0, 102.0, 1270.0, 68.0);
        // The paragraph's lines are the lines of the text under it.
        d.set_text_lines(intro, &[(0.0, 102.0, 1270.0, 20.0), (0.0, 126.0, 1270.0, 20.0), (0.0, 150.0, 300.0, 20.0)]);
        d.el_mut(intro).direct_text_rect = None;
        let len = utf16_len(js::trim(&d.text_content(intro)));
        assert_eq!(
            snippets(&d, intro, "line-length"),
            vec![format!(
                "~{} chars on 2 of 3 rendered lines (aim for <80)",
                ((len as f64) * 1270.0 / 2840.0).round()
            )]
        );
        assert_eq!(
            snippets(&d, intro, "body-text-viewport-edge"),
            vec![format!("<p> with {len}-char body bleeds to viewport edge (left 0px / right 0px)")]
        );
        // The inline children report neither rule themselves.
        for child in [b, i] {
            let hits = check_element_quality_dom(&d, child, &BrowserConfig::default());
            assert!(
                !hits.iter().any(|h| h.id == "line-length" || h.id == "body-text-viewport-edge"),
                "{hits:?}"
            );
        }
        // Inline prose the Dom cannot measure stays silent, as before.
        d.el_mut(intro).text_line_rects = None;
        d.el_mut(b).direct_text_rect = None;
        d.el_mut(i).direct_text_rect = None;
        assert!(snippets(&d, intro, "line-length").is_empty());
        assert!(snippets(&d, intro, "body-text-viewport-edge").is_empty());
        // A paragraph holding a block component is not inline prose.
        d.set_text_rect(i, 0.0, 102.0, 1270.0, 68.0);
        d.set_text_lines(intro, &[(0.0, 102.0, 1270.0, 20.0), (0.0, 126.0, 1270.0, 20.0), (0.0, 150.0, 300.0, 20.0)]);
        d.el_mut(intro).direct_text_rect = None;
        let card = d.add(Some(intro), "div");
        d.set_style(card, "display", "block");
        assert!(snippets(&d, intro, "line-length").is_empty());
    }

    /// observations-20 row 31: a centred or padded paragraph spans the
    /// viewport with its box while its glyphs keep a gutter, and a slide cut
    /// by its carousel track meets the track's clip, not the page edge.
    #[test]
    fn viewport_edge_measures_the_text_not_the_box() {
        let copy = "Two sides. One rivalry. Zero middle ground. Show them where you stand today.";
        let len = utf16_len(copy);
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        d.inner_width = 1280.0;
        let p = text_el(&mut d, body, "p", copy, "16px");
        d.set_style(p, "lineHeight", "24px");
        d.set_rect(p, 0.0, 100.0, 1280.0, 24.0);
        // Centred glyphs, 300px off both edges.
        d.set_text_rect(p, 300.0, 102.0, 680.0, 20.0);
        assert!(snippets(&d, p, "body-text-viewport-edge").is_empty(), "centred");
        // Padded: the glyphs start 32px in.
        d.set_text_rect(p, 32.0, 102.0, 680.0, 20.0);
        assert!(snippets(&d, p, "body-text-viewport-edge").is_empty(), "padded");
        // Glyphs at the edge report, with the text's own distances.
        d.set_text_rect(p, 0.0, 102.0, 680.0, 20.0);
        assert_eq!(
            snippets(&d, p, "body-text-viewport-edge"),
            vec![format!("<p> with {len}-char body bleeds to viewport edge (left 0px)")]
        );
        // With no text rect the box stands in, as before.
        d.el_mut(p).direct_text_rect = None;
        assert_eq!(
            snippets(&d, p, "body-text-viewport-edge"),
            vec![format!("<p> with {len}-char body bleeds to viewport edge (left 0px / right 0px)")]
        );

        // Text a box that only hides overflow cuts at 1,270px: an
        // `overflow-hidden` section (v0-optimus-delta.vercel.app) cannot be
        // told from a carousel track. Text past the window's edge is the
        // page's overflow, which the page-level form reports once; the
        // paragraph reports no gutter on that side.
        let track = d.add(Some(body), "div");
        d.set_styles(track, &[("overflowX", "hidden"), ("overflow", "hidden")]);
        d.set_rect(track, 10.0, 300.0, 1260.0, 200.0);
        d.el_mut(track).client_width = 1260.0;
        d.el_mut(track).scroll_width = 1590.0;
        let slide = text_el(&mut d, track, "p", copy, "16px");
        d.set_style(slide, "lineHeight", "24px");
        d.set_rect(slide, 900.0, 320.0, 700.0, 48.0);
        d.set_text_rect(slide, 900.0, 322.0, 690.0, 44.0);
        let past = |d: &FakeDom| -> Vec<String> {
            check_page_overflow_dom(d).into_iter().map(|f| f.detail).collect()
        };
        assert!(snippets(&d, slide, "body-text-viewport-edge").is_empty(), "cut by overflow: hidden");
        let cut = vec![
            "text runs past the right edge of the 1280px viewport and is cut off: p reaches 320px past it, with text in 1 block"
                .to_string(),
        ];
        assert_eq!(past(&d), cut, "cut by overflow: hidden");
        d.set_styles(track, &[("overflowX", "hidden"), ("overflow", "hidden auto")]);
        assert_eq!(past(&d), cut, "cut by overflow-x-hidden");
        // A track that scrolls on x, with the slide to scroll to, brings the
        // text into view: its clip is the track's, not the page's.
        d.set_styles(track, &[("overflowX", "auto"), ("overflow", "auto")]);
        assert!(past(&d).is_empty(), "a swiped track");
        // Out of the track, the same text runs off the page, and the track is
        // the widest box.
        d.set_styles(track, &[("overflowX", "visible"), ("overflow", "visible")]);
        assert!(snippets(&d, slide, "body-text-viewport-edge").is_empty());
        // Nothing the engine can see clips it, but the root does not scroll:
        // the page cannot scroll to the text, and it is cut off.
        assert_eq!(
            past(&d),
            vec!["text runs past the right edge of the 1280px viewport and is cut off: p reaches 320px past it, with text in 1 block".to_string()],
            "a root that does not scroll"
        );
        d.set_styles(track, &[("overflowX", "hidden"), ("overflow", "hidden")]);

        // Wrapped lines that fill a padded paragraph sit on its content box.
        let padded = text_el(&mut d, body, "p", copy, "16px");
        d.set_styles(padded, &[("lineHeight", "24px"), ("paddingLeft", "24px"), ("paddingRight", "24px")]);
        d.set_rect(padded, 0.0, 700.0, 1280.0, 48.0);
        d.set_text_rect(padded, 24.0, 702.0, 1220.0, 44.0);
        assert!(snippets(&d, padded, "body-text-viewport-edge").is_empty(), "24px padding");
        d.set_styles(padded, &[("paddingLeft", "8px"), ("paddingRight", "8px")]);
        d.set_text_rect(padded, 8.0, 702.0, 1230.0, 44.0);
        assert_eq!(
            snippets(&d, padded, "body-text-viewport-edge"),
            vec![format!("<p> with {len}-char body bleeds to viewport edge (left 8px / right 8px)")]
        );

        // A list item's `inside` marker paints at the content edge ahead of
        // its text, so the start side reaches that edge.
        let li = text_el(&mut d, body, "li", copy, "16px");
        d.set_styles(li, &[("lineHeight", "24px"), ("display", "list-item"), ("paddingLeft", "0px"), ("borderLeftWidth", "0px")]);
        d.set_rect(li, 0.0, 600.0, 1280.0, 24.0);
        d.set_text_rect(li, 18.0, 602.0, 700.0, 20.0);
        assert_eq!(
            snippets(&d, li, "body-text-viewport-edge"),
            vec![format!("<li> with {len}-char body bleeds to viewport edge (left 0px)")]
        );
        // Given a gutter of its own, the item keeps off the edge.
        d.set_style(li, "paddingLeft", "24px");
        d.set_text_rect(li, 42.0, 602.0, 700.0, 20.0);
        assert!(snippets(&d, li, "body-text-viewport-edge").is_empty());
    }

    /// Taste call r3-34: at 480px or less the gutter floor is 12px, above it
    /// 16px. rtx.com keeps a consistent 12px at 390px; text 8px from a
    /// phone's edge still reports.
    #[test]
    fn viewport_edge_floor_is_12px_on_phones() {
        let copy = "Our engineers build the systems that keep aircraft flying safely on every continent.";
        let len = utf16_len(copy);
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let p = text_el(&mut d, body, "p", copy, "16px");
        d.set_style(p, "lineHeight", "24px");
        let at = |d: &mut FakeDom, vw: f64, gutter: f64| -> Vec<String> {
            d.inner_width = vw;
            let pad = format!("{gutter}px");
            d.set_styles(p, &[("paddingLeft", pad.as_str()), ("paddingRight", pad.as_str())]);
            d.set_rect(p, 0.0, 100.0, vw, 48.0);
            d.set_text_rect(p, gutter, 102.0, vw - 2.0 * gutter, 44.0);
            snippets(d, p, "body-text-viewport-edge")
        };
        assert!(at(&mut d, 390.0, 12.0).is_empty(), "12px at 390px");
        assert!(at(&mut d, 480.0, 12.0).is_empty(), "12px at 480px");
        assert_eq!(
            at(&mut d, 390.0, 8.0),
            vec![format!("<p> with {len}-char body bleeds to viewport edge (left 8px / right 8px)")]
        );
        assert_eq!(
            at(&mut d, 390.0, 11.0),
            vec![format!("<p> with {len}-char body bleeds to viewport edge (left 11px / right 11px)")]
        );
        assert_eq!(
            at(&mut d, 481.0, 12.0),
            vec![format!("<p> with {len}-char body bleeds to viewport edge (left 12px / right 12px)")],
            "16px above 480px"
        );
        assert_eq!(at(&mut d, 1280.0, 12.0).len(), 1);
        assert!(at(&mut d, 1280.0, 16.0).is_empty());
    }

    /// elevancehealth.com (324856): a quote caught part way through its
    /// one-shot slide in from the right, 79px past a 390px viewport.
    #[test]
    fn text_in_a_box_mid_slide_is_not_measured_against_the_viewport() {
        use impeccable_foundation::browser::dom::KeyframeFrame;
        let copy = "Our care teams meet people where they are, and that changes what health looks like.";
        let frame = |decls: &[(&str, &str)]| KeyframeFrame {
            decls: decls.iter().map(|(p, v)| (p.to_string(), v.to_string())).collect(),
        };
        // `mover` takes the animation (or transition) and its running
        // properties; `wrapper` says whether a wrapper holds the quote.
        let run = |running: Option<Vec<&str>>, styles: &[(&str, &str)], on_wrapper: bool| {
            let mut d = FakeDom::new();
            let (html, body) = d.with_page();
            d.inner_width = 390.0;
            d.set_rect(html, 0.0, 0.0, 390.0, 2400.0);
            d.el_mut(html).client_width = 390.0;
            d.el_mut(html).scroll_width = 469.0;
            d.set_rect(body, 0.0, 0.0, 390.0, 2400.0);
            d.keyframes.insert(
                "quote-appear-right".into(),
                vec![frame(&[("opacity", "0"), ("right", "-96%")]), frame(&[("opacity", "1"), ("right", "0px")])],
            );
            d.keyframes.insert(
                "fade-up".into(),
                vec![frame(&[("opacity", "0"), ("transform", "translateY(20px)")]), frame(&[("opacity", "1"), ("transform", "none")])],
            );
            let wrapper = d.add(Some(body), "main");
            d.set_rect(wrapper, 0.0, 0.0, 390.0, 2400.0);
            let quote = d.add(Some(wrapper), "div");
            d.set_style(quote, "position", "relative");
            d.set_rect(quote, 119.0, 700.0, 350.0, 320.0);
            let mover = if on_wrapper { wrapper } else { quote };
            d.set_styles(mover, styles);
            d.el_mut(mover).running_animations = running.map(|r| r.into_iter().map(String::from).collect());
            let p = text_el(&mut d, quote, "p", copy, "16px");
            d.set_style(p, "lineHeight", "24px");
            d.set_rect(p, 143.0, 724.0, 310.0, 96.0);
            d.set_text_rect(p, 143.0, 724.0, 310.0, 96.0);
            check_page_overflow_dom(&d).len()
        };
        let slide = [("animationName", "quote-appear-right"), ("animationIterationCount", "1")];
        assert_eq!(run(Some(vec!["right", "opacity"]), &slide, false), 0);
        // A transition that names the property traces it too.
        let eased = [("transitionProperty", "left"), ("transitionDuration", "0.4s")];
        assert_eq!(run(Some(vec!["left"]), &eased, false), 0);
        // At rest, or in a loop, the box stands where it was measured.
        assert_eq!(run(Some(vec!["opacity"]), &slide, false), 1);
        let looped = [("animationName", "quote-appear-right"), ("animationIterationCount", "infinite")];
        assert_eq!(run(Some(vec!["right"]), &looped, false), 1);
        // A recording that did not read running animations.
        assert_eq!(run(None, &slide, false), 1);
        // A fade-up on an ancestor moves the text vertically only: the
        // overflow is real whatever frame the entrance was caught at.
        let fade_up = [("animationName", "fade-up"), ("animationIterationCount", "1"), ("transform", "matrix(1, 0, 0, 1, 0, 12)")];
        assert_eq!(run(Some(vec!["transform", "opacity"]), &fade_up, true), 1);
        // A transform moved by script (a Web Animations loop) with no CSS
        // animation or transition to trace it is unknown.
        let untraced = [("transform", "matrix(1, 0, 0, 1, -40, 0)")];
        assert_eq!(run(Some(vec!["transform"]), &untraced, false), 1);
    }

    /// Taste call r4-p20 (observations-25 issue 8): text past the viewport
    /// edge is the page's overflow, reported once per page with a message
    /// that says the page scrolls sideways and names the widest element.
    /// The per-paragraph findings go; gutters between 0 and the floor still
    /// report as gutters.
    #[test]
    fn text_past_the_viewport_reports_once_as_page_overflow() {
        let copy = "Бесплатные объявления о продаже автомобилей, запчастей и шин по всей стране.";
        let len = utf16_len(copy);
        let mut d = FakeDom::new();
        let (html, body) = d.with_page();
        d.inner_width = 390.0;
        d.set_rect(html, 0.0, 0.0, 390.0, 2400.0);
        d.el_mut(html).client_width = 390.0;
        d.el_mut(html).scroll_width = 1024.0;
        // drom.ru: a fixed 1024px desktop page at a phone's width.
        d.set_rect(body, 0.0, 0.0, 1024.0, 2400.0);
        let page = d.add(Some(body), "div");
        d.set_attr(page, "class", "b-wrapper");
        d.set_rect(page, 0.0, 0.0, 1024.0, 2400.0);
        let mut paras = Vec::new();
        for (i, right) in [731.0, 646.0, 380.0].into_iter().enumerate() {
            let p = text_el(&mut d, page, "p", copy, "16px");
            d.set_style(p, "lineHeight", "24px");
            d.set_rect(p, 20.0, 100.0 + 60.0 * i as f64, 1000.0, 24.0);
            d.set_text_rect(p, 20.0, 102.0 + 60.0 * i as f64, right - 20.0, 20.0);
            paras.push(p);
        }
        // Past the edge, no gutter finding: a 20px left gutter holds.
        for &p in &paras[..2] {
            assert!(snippets(&d, p, "body-text-viewport-edge").is_empty());
        }
        // The one that ends 10px short of the edge keeps a gutter under 12px.
        assert_eq!(
            snippets(&d, paras[2], "body-text-viewport-edge"),
            vec![format!("<p> with {len}-char body bleeds to viewport edge (right 10px)")]
        );
        let past = |d: &FakeDom| -> Vec<String> {
            check_page_overflow_dom(d).into_iter().map(|f| f.detail).collect()
        };
        // One finding for the page, naming the outermost of the widest boxes.
        assert_eq!(
            past(&d),
            vec!["page scrolls sideways at 390px: body reaches 634px past the right edge, and text in 2 blocks runs past it"
                .to_string()]
        );
        // The body at the viewport's width, the wrapper sets the page's width.
        d.set_rect(body, 0.0, 0.0, 390.0, 2400.0);
        assert_eq!(
            past(&d),
            vec!["page scrolls sideways at 390px: div.b-wrapper reaches 634px past the right edge, and text in 2 blocks runs past it"
                .to_string()]
        );
        // A wider box inside a box that clips it does not set the page's width.
        let strip = d.add(Some(page), "div");
        d.set_styles(strip, &[("overflowX", "hidden")]);
        d.set_rect(strip, 0.0, 400.0, 1024.0, 40.0);
        let banner = d.add(Some(strip), "div");
        d.set_rect(banner, 0.0, 400.0, 3000.0, 40.0);
        assert!(past(&d)[0].contains("div.b-wrapper reaches 634px"), "{:?}", past(&d));
        d.set_style(strip, "overflowX", "visible");
        // No box reaches further than the page scrolls: one that does is held
        // by a clip the walk cannot see.
        assert!(past(&d)[0].contains("div.b-wrapper reaches 634px"), "{:?}", past(&d));
        d.el_mut(html).scroll_width = 3000.0;
        assert!(past(&d)[0].contains("div in div.b-wrapper reaches 2610px"), "{:?}", past(&d));
        d.set_style(banner, "position", "fixed");
        assert!(past(&d)[0].contains("div.b-wrapper reaches 634px"), "a fixed box sets no width");
        d.el_mut(html).scroll_width = 1024.0;

        // A viewport that clips (centene.com's body at overflow-x: hidden)
        // cannot be scrolled: the text is cut off.
        d.set_style(body, "overflowX", "hidden");
        assert_eq!(
            past(&d),
            vec!["text runs past the right edge of the 390px viewport and is cut off: div.b-wrapper reaches 634px past it, with text in 2 blocks"
                .to_string()]
        );
        // A page that cannot scroll names the widest box around the text,
        // not a box elsewhere that a clip the walk cannot see holds.
        d.set_style(banner, "position", "static");
        assert!(past(&d)[0].contains("div.b-wrapper reaches 634px"), "{:?}", past(&d));
        d.set_style(banner, "position", "fixed");
        // The root's own overflow wins over body's.
        d.set_style(html, "overflowX", "auto");
        assert!(past(&d)[0].starts_with("page scrolls sideways"), "{:?}", past(&d));
        d.set_style(html, "overflowX", "hidden");
        assert!(past(&d)[0].starts_with("text runs past"), "{:?}", past(&d));
        d.set_style(html, "overflowX", "visible");
        d.set_style(body, "overflowX", "visible");

        // An inline ignore on a paragraph leaves it out of the count.
        d.set_attr(paras[1], "data-impeccable-ignore", "body-text-viewport-edge");
        assert!(past(&d)[0].ends_with("text in 1 block runs past it"), "{:?}", past(&d));
        d.set_attr(paras[0], "data-impeccable-ignore", "body-text-viewport-edge");
        assert!(past(&d).is_empty(), "every paragraph waived");
    }

    /// Taste call r4-p20, follow-up: the message follows the page. It says
    /// the page scrolls sideways when it can scroll to the text, and that the
    /// text is cut off when a box that hides overflow cuts it, whatever else
    /// widens the page. When the engine cannot tell, it says the page scrolls.
    #[test]
    fn page_overflow_wording_follows_the_page() {
        let copy = "A column laid out at a fixed desktop width that runs on past the right edge of the phone.";
        let mut d = FakeDom::new();
        let (html, body) = d.with_page();
        d.inner_width = 390.0;
        d.set_rect(html, 0.0, 0.0, 390.0, 2400.0);
        d.el_mut(html).client_width = 390.0;
        d.el_mut(html).scroll_width = 1200.0;
        d.set_rect(body, 0.0, 0.0, 390.0, 2400.0);
        // A 1200px banner widens the page on its own.
        let banner = d.add(Some(body), "div");
        d.set_attr(banner, "class", "promo-strip");
        d.set_rect(banner, 0.0, 0.0, 1200.0, 60.0);
        // Two paragraphs inside a wrapper as wide as the window that hides
        // x overflow (v0-optimus-delta.vercel.app's `overflow-x-hidden`).
        let wrap = d.add(Some(body), "div");
        d.set_attr(wrap, "class", "overflow-x-hidden");
        d.set_styles(wrap, &[("overflowX", "hidden")]);
        d.set_rect(wrap, 0.0, 100.0, 390.0, 400.0);
        let mut paras = Vec::new();
        for i in 0..2 {
            let p = text_el(&mut d, wrap, "p", copy, "16px");
            d.set_style(p, "lineHeight", "24px");
            d.set_rect(p, 20.0, 120.0 + 60.0 * i as f64, 700.0, 48.0);
            d.set_text_rect(p, 20.0, 122.0 + 60.0 * i as f64, 700.0, 44.0);
            paras.push(p);
        }
        let past = |d: &FakeDom| -> Vec<String> {
            check_page_overflow_dom(d).into_iter().map(|f| f.detail).collect()
        };
        // The page scrolls, for the banner, but the wrapper cuts every line.
        assert_eq!(
            past(&d),
            vec!["text runs past the right edge of the 390px viewport and is cut off: p reaches 330px past it, with text in 2 blocks"
                .to_string()]
        );
        // A wrapper whose own edge is past the viewport's hides nothing the
        // page could scroll to.
        d.set_rect(wrap, 0.0, 100.0, 800.0, 400.0);
        assert!(past(&d)[0].starts_with("page scrolls sideways at 390px"), "{:?}", past(&d));
        d.set_rect(wrap, 0.0, 100.0, 390.0, 400.0);
        // A one-line paragraph that clips its own overflow at the viewport's
        // edge cuts its own text.
        d.set_style(wrap, "overflowX", "visible");
        for (i, &p) in paras.iter().enumerate() {
            d.set_styles(p, &[("overflowX", "clip"), ("whiteSpace", "nowrap")]);
            d.set_rect(p, 20.0, 120.0 + 60.0 * i as f64, 370.0, 24.0);
            d.set_text_rect(p, 20.0, 122.0 + 60.0 * i as f64, 700.0, 20.0);
        }
        assert_eq!(
            past(&d),
            vec!["text runs past the right edge of the 390px viewport and is cut off: p reaches 330px past it, with text in 2 blocks"
                .to_string()]
        );
        // One paragraph the page can scroll to: the page scrolls sideways,
        // naming the banner that sets its width.
        d.set_style(paras[1], "overflowX", "visible");
        assert_eq!(
            past(&d),
            vec!["page scrolls sideways at 390px: div.promo-strip reaches 810px past the right edge, and text in 2 blocks runs past it"
                .to_string()]
        );
        // A root that records no sideways scroll: the page cannot scroll to
        // the text, whatever holds it (microsoft.com's parked card sits in a
        // shadow root).
        d.el_mut(html).scroll_width = 390.0;
        assert!(past(&d)[0].starts_with("text runs past the right edge"), "{:?}", past(&d));
        // The engine cannot tell: no clip it can see, and no scroll width
        // recorded. It uses the sideways wording and names the box around
        // the text.
        d.el_mut(html).scroll_width = f64::NAN;
        assert_eq!(
            past(&d),
            vec!["page scrolls sideways at 390px: p reaches 330px past the right edge, and text in 2 blocks runs past it"
                .to_string()]
        );
        // body at overflow-x: hidden clips the viewport.
        d.set_style(body, "overflowX", "hidden");
        assert!(past(&d)[0].starts_with("text runs past the right edge"), "{:?}", past(&d));
    }

    /// A bare `div` is named by its id, the nearest ancestor below the body
    /// with an id or a class, or the start of its text (centene.com named a
    /// bare `div` as the widest element).
    #[test]
    fn page_overflow_names_a_bare_div_so_it_can_be_found() {
        let copy = "Members can view claims, find a doctor and print an ID card from the portal at any time.";
        let mut d = FakeDom::new();
        let (html, body) = d.with_page();
        d.inner_width = 390.0;
        d.set_rect(html, 0.0, 0.0, 390.0, 2400.0);
        d.el_mut(html).client_width = 390.0;
        d.el_mut(html).scroll_width = 510.0;
        d.set_rect(body, 0.0, 0.0, 390.0, 2400.0);
        let section = d.add(Some(body), "section");
        d.set_rect(section, 0.0, 0.0, 390.0, 600.0);
        let outer = d.add(Some(section), "div");
        d.set_rect(outer, 0.0, 0.0, 390.0, 600.0);
        let row = d.add(Some(outer), "div");
        d.set_rect(row, 0.0, 0.0, 510.0, 600.0);
        let p = text_el(&mut d, row, "p", copy, "16px");
        d.set_style(p, "lineHeight", "24px");
        d.set_rect(p, 20.0, 100.0, 470.0, 48.0);
        d.set_text_rect(p, 20.0, 102.0, 470.0, 44.0);
        let name = |d: &FakeDom| -> String {
            let f = check_page_overflow_dom(d);
            let detail = &f[0].detail;
            let start = detail.find(": ").unwrap() + 2;
            let end = detail.find(" reaches ").unwrap();
            detail[start..end].to_string()
        };
        // No identifying ancestor: the start of the text.
        assert_eq!(name(&d), "div (\"Members can view claims, find a doctor…\")");
        // The nearest ancestor with a class, keeping three of its tokens.
        d.set_attr(section, "class", "hero dark wide-gutter extra");
        assert_eq!(name(&d), "div in section.hero.dark.wide-gutter");
        d.set_attr(outer, "id", "member-portal");
        assert_eq!(name(&d), "div in div#member-portal");
        // Its own id first.
        d.set_attr(row, "id", "claims-row");
        assert_eq!(name(&d), "div#claims-row");
        // A class of its own is the name, as for any element.
        d.set_attr(row, "class", "claims");
        assert_eq!(name(&d), "div.claims");
    }

    /// agora.co.il at 390px: a right-to-left page scrolls to the left, and
    /// text past the right edge of such a page, or past the left edge of a
    /// left-to-right one, cannot be scrolled to.
    #[test]
    fn page_overflow_reads_the_scroll_side() {
        let copy = "תודה שנרשמת לאתר. נשלח אליך הודעה עם כל הפרטים ברגע שהמודעה שלך תאושר ותפורסם.";
        let mut d = FakeDom::new();
        let (html, body) = d.with_page();
        d.inner_width = 390.0;
        d.set_rect(html, 0.0, 0.0, 390.0, 1400.0);
        d.el_mut(html).client_width = 390.0;
        d.el_mut(html).scroll_width = 639.0;
        d.set_rect(body, 0.0, 0.0, 390.0, 1400.0);
        let p = text_el(&mut d, body, "p", copy, "16px");
        d.set_style(p, "lineHeight", "24px");
        d.set_attr(p, "id", "thanks");
        d.set_rect(p, -249.0, 300.0, 625.0, 24.0);
        d.set_text_rect(p, -249.0, 302.0, 625.0, 20.0);
        let past = |d: &FakeDom| -> Vec<String> {
            check_page_overflow_dom(d).into_iter().map(|f| f.detail).collect()
        };
        // The right side keeps 14px, over the phone floor.
        assert!(snippets(&d, p, "body-text-viewport-edge").is_empty());
        assert_eq!(
            past(&d),
            vec!["text runs past the left edge of the 390px viewport and is cut off: p reaches 249px past it, with text in 1 block"
                .to_string()],
            "left of a left-to-right page"
        );
        d.set_style(html, "direction", "rtl");
        assert_eq!(
            past(&d),
            vec!["page scrolls sideways at 390px: p reaches 249px past the left edge, and text in 1 block runs past it"
                .to_string()],
        );
    }

    /// observations-20 row 40: an inline run at `line-height: 11px` inside a
    /// 14px block sits on 14px lines, and a label at 18px inside a 22.4px
    /// block sits on 22.4px ones.
    /// Taste call r3-03: bold titles set on a div or span get the heading
    /// exemption at two rendered lines or fewer, or in a line clamp.
    #[test]
    fn tight_leading_exempts_bold_titles() {
        const TITLE: &str = "Two southern residents charged over an international trafficking ring";
        fn title(d: &mut FakeDom, parent: ElId, weight: &str, lines: f64) -> ElId {
            let el = text_el(d, parent, "div", TITLE, "14px");
            d.set_styles(el, &[("lineHeight", "16px"), ("fontWeight", weight), ("display", "block")]);
            let h = 16.8 + 16.0 * (lines - 1.0);
            d.set_rect(el, 355.0, 300.0, 265.0, 16.0 * lines);
            d.el_mut(el).direct_text_rect = Some(Rect::from_xywh(355.0, 300.0, 265.0, h));
            el
        }
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();

        let bold = title(&mut d, body, "700", 2.0);
        assert!(snippets(&d, bold, "tight-leading").is_empty(), "bold, two lines");
        let semibold = title(&mut d, body, "600", 2.0);
        assert!(snippets(&d, semibold, "tight-leading").is_empty(), "600 is bold");
        let medium = title(&mut d, body, "500", 2.0);
        assert_eq!(snippets(&d, medium, "tight-leading"), vec!["line-height 1.14x (need >=1.3)"]);
        let three = title(&mut d, body, "700", 3.0);
        assert_eq!(
            snippets(&d, three, "tight-leading"),
            vec!["line-height 1.14x (need >=1.3)"],
            "bold body text of three lines keeps the floor"
        );

        // A clamp exempts a bold title however many lines it lays out.
        // Current Chrome computes a CSS clamp that takes effect as
        // `flow-root` carrying `webkitLineClamp`; a `-webkit-box` whose
        // clamp is left to a script (Taboola's) computes as itself.
        let boxed = title(&mut d, body, "670", 4.0);
        d.set_styles(boxed, &[("display", "-webkit-box"), ("webkitLineClamp", "none")]);
        assert!(snippets(&d, boxed, "tight-leading").is_empty(), "-webkit-box clamp");
        let flow = title(&mut d, body, "670", 4.0);
        d.set_styles(
            flow,
            &[("display", "flow-root"), ("webkitLineClamp", "2"), ("overflow", "hidden"), ("overflowY", "hidden")],
        );
        d.set_rect(flow, 355.0, 300.0, 265.0, 32.0);
        assert!(snippets(&d, flow, "tight-leading").is_empty(), "flow-root clamp");
        // A clamp of three lines that hides nothing still exempts.
        let exact = title(&mut d, body, "700", 3.0);
        d.set_styles(
            exact,
            &[("display", "flow-root"), ("webkitLineClamp", "3"), ("overflow", "hidden"), ("overflowY", "hidden")],
        );
        assert!(snippets(&d, exact, "tight-leading").is_empty(), "clamp of three, nothing hidden");
        // A clipping flow-root box with no clamp only cuts the count: three
        // of six laid-out lines render, and bold text of three lines reports.
        let maxed = title(&mut d, body, "700", 6.0);
        d.set_styles(
            maxed,
            &[("display", "flow-root"), ("webkitLineClamp", "none"), ("overflow", "hidden"), ("overflowY", "hidden")],
        );
        d.set_rect(maxed, 355.0, 300.0, 265.0, 48.0);
        assert_eq!(snippets(&d, maxed, "tight-leading").len(), 1, "max-height clip, no clamp");
        // The same box cut to two lines is a two-line bold title.
        d.set_rect(maxed, 355.0, 300.0, 265.0, 32.0);
        assert!(snippets(&d, maxed, "tight-leading").is_empty(), "clipped to two lines");
        // A clamp on a plain block clamps nothing, and is no clamp.
        let stray = title(&mut d, body, "670", 4.0);
        d.set_styles(stray, &[("display", "block"), ("webkitLineClamp", "2")]);
        assert_eq!(snippets(&d, stray, "tight-leading").len(), 1, "clamp on a plain block");
        // Regular copy in a clamp keeps the floor.
        let regular = title(&mut d, body, "400", 4.0);
        d.set_styles(regular, &[("display", "flow-root"), ("webkitLineClamp", "2")]);
        assert_eq!(snippets(&d, regular, "tight-leading").len(), 1, "regular weight in a clamp");

        // ynet.co.il's `div.slotTitle.medium`: the headline's own div lays out
        // three lines, and the clamped wrapper two levels up (through the
        // link) shows two of them.
        let wrapper = d.add(Some(body), "div");
        d.set_styles(
            wrapper,
            &[("display", "flow-root"), ("webkitLineClamp", "2"), ("overflow", "hidden"), ("overflowY", "hidden")],
        );
        d.set_rect(wrapper, 230.0, 4109.0, 190.0, 38.0);
        let link = d.add(Some(wrapper), "a");
        d.set_style(link, "display", "inline");
        let headline = text_el(&mut d, link, "div", TITLE, "15px");
        d.set_styles(headline, &[("display", "block"), ("lineHeight", "19px"), ("fontWeight", "670")]);
        d.set_rect(headline, 230.0, 4109.0, 190.0, 38.0);
        d.el_mut(headline).direct_text_rect = Some(Rect::from_xywh(252.0, 4111.0, 167.0, 53.0));
        assert!(snippets(&d, headline, "tight-leading").is_empty(), "two of three lines render");
        d.set_style(headline, "fontWeight", "400");
        assert_eq!(snippets(&d, headline, "tight-leading").len(), 1, "regular weight keeps the floor");

        // An inline bold run wrapping to two lines on its block.
        let block = d.add(Some(body), "div");
        d.set_styles(block, &[("display", "block"), ("fontSize", "16px"), ("lineHeight", "normal")]);
        let run = text_el(&mut d, block, "span", TITLE, "16px");
        d.set_styles(run, &[("display", "inline"), ("lineHeight", "19px"), ("fontWeight", "670")]);
        d.set_rect(run, 466.0, 8866.0, 374.0, 34.0);
        d.el_mut(run).direct_text_rect = Some(Rect::from_xywh(466.0, 8866.0, 374.0, 34.0));
        assert!(snippets(&d, run, "tight-leading").is_empty(), "inline bold run, two lines");
    }

    #[test]
    fn tight_leading_reads_the_block_an_inline_run_sits_on() {
        const COPY: &str = "Free furniture, free books, free clothes, free computers, and more besides.";
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let block = d.add(Some(body), "div");
        d.set_styles(block, &[("display", "inline-block"), ("fontSize", "14px"), ("lineHeight", "14px")]);
        let run = text_el(&mut d, block, "span", COPY, "11px");
        d.set_styles(run, &[("display", "inline"), ("lineHeight", "11px")]);
        d.set_rect(run, 46.0, 100.0, 298.0, 40.0);
        d.set_text_rect(run, 46.0, 100.0, 280.0, 40.0);
        assert_eq!(snippets(&d, run, "tight-leading"), vec!["line-height 1.27x (need >=1.3)"]);
        d.set_style(block, "lineHeight", "22.4px");
        assert!(snippets(&d, run, "tight-leading").is_empty(), "set on the block's 22.4px");
        // A block strut that cannot be resolved leaves the run's own value.
        d.set_style(block, "lineHeight", "normal");
        assert_eq!(snippets(&d, run, "tight-leading"), vec!["line-height 1.00x (need >=1.3)"]);
    }

    /// observations-28 row 25: outreign.io's hero meta row is a flex
    /// container whose three short text runs wrap as whole items onto two
    /// rows. The union of their rects is two rows tall, but no run has a
    /// second line box. A run long enough to wrap in the box is measured as
    /// before, and so is a single run.
    #[test]
    fn tight_leading_reads_flex_text_runs_as_items() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let row = d.add(Some(body), "p");
        d.add_text(row, "100 free lead searches");
        let sep = d.add(Some(row), "span");
        d.set_rect(sep, 182.0, 674.0, 1.0, 12.0);
        d.add_text(row, "14-day trial on paid plans");
        d.add(Some(row), "span");
        d.add_text(row, "Built with you on a call");
        d.set_styles(
            row,
            &[
                ("display", "flex"),
                ("flexWrap", "wrap"),
                ("fontSize", "12px"),
                ("lineHeight", "15px"),
                ("position", "static"),
            ],
        );
        d.set_rect(row, 27.0, 673.0, 336.0, 34.0);
        d.set_text_rect(row, 43.3, 673.0, 292.4, 34.0);
        d.el_mut(row).client_width = 336.0;
        assert!(snippets(&d, row, "tight-leading").is_empty(), "short runs, whole items");
        let flag = vec!["line-height 1.25x (need >=1.3)"];
        // Under `nowrap` the items shrink into one row and each run wraps in
        // its own item; a row whose wrapping was not recorded, and a grid
        // whose cells are narrower than the box, are measured as before.
        for wrap in ["nowrap", ""] {
            d.set_style(row, "flexWrap", wrap);
            assert_eq!(snippets(&d, row, "tight-leading"), flag, "flex-wrap {wrap:?}");
        }
        d.set_style(row, "flexWrap", "wrap-reverse");
        assert!(snippets(&d, row, "tight-leading").is_empty(), "wrap-reverse moves items whole");
        d.set_style(row, "display", "grid");
        assert_eq!(snippets(&d, row, "tight-leading"), flag, "grid");
        // A block that sets the same text as one run wraps its lines.
        d.set_style(row, "display", "block");
        assert_eq!(snippets(&d, row, "tight-leading"), flag);
        // A run wider than the box wraps inside its own item.
        d.set_style(row, "display", "flex");
        d.set_style(row, "flexWrap", "wrap");
        d.el_mut(row).client_width = 150.0;
        assert_eq!(snippets(&d, row, "tight-leading"), flag);
    }

    /// walkthroughs-20 note 13: tchibo.de sets its teaser headlines as
    /// `<h5><div>…</div></h5>`. Any box inside a heading carries heading text,
    /// unless it is a reading block nested there.
    #[test]
    fn tight_leading_exempts_heading_copy_in_a_block_wrapper() {
        const COPY: &str = "Jede Woche neu! Lassen Sie sich von unseren Kollektionen immer wieder neu inspirieren";
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let h5 = d.add(Some(body), "h5");
        let wrapper = text_el(&mut d, h5, "div", COPY, "19px");
        d.set_style(wrapper, "lineHeight", "24px");
        d.set_rect(wrapper, 12.0, 100.0, 366.0, 72.0);
        d.set_text_rect(wrapper, 12.0, 100.0, 330.0, 71.0);
        assert!(snippets(&d, wrapper, "tight-leading").is_empty(), "div in a heading");
        // A paragraph of body copy in a heading keeps the floor, and so does
        // what sits inside it.
        let para = text_el(&mut d, h5, "p", COPY, "16px");
        d.set_style(para, "lineHeight", "17.6px");
        d.set_rect(para, 12.0, 200.0, 300.0, 70.4);
        d.set_text_rect(para, 12.0, 200.0, 300.0, 70.4);
        assert_eq!(snippets(&d, para, "tight-leading"), vec!["line-height 1.10x (need >=1.3)"]);
        let inner = text_el(&mut d, para, "div", COPY, "16px");
        d.set_style(inner, "lineHeight", "17.6px");
        d.set_rect(inner, 12.0, 300.0, 300.0, 70.4);
        d.set_text_rect(inner, 12.0, 300.0, 300.0, 70.4);
        assert_eq!(snippets(&d, inner, "tight-leading").len(), 1, "a box inside the paragraph");
    }

    /// observations-20 row 41: a two-line inline highlight reports the union
    /// of its fragments, 43px, while each fragment is one 21px line.
    #[test]
    fn cramped_padding_judges_an_inline_box_per_line() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        d.set_style(body, "backgroundColor", "rgb(255, 255, 255)");
        let hl = text_el(&mut d, body, "span", "carrier's own estimating guide", "14px");
        d.set_styles(
            hl,
            &[
                ("display", "inline"),
                ("lineHeight", "25.9px"),
                ("backgroundColor", "rgb(254, 240, 138)"),
                ("borderTopWidth", "0px"),
                ("borderRightWidth", "0px"),
                ("borderBottomWidth", "0px"),
                ("borderLeftWidth", "0px"),
                ("paddingTop", "0px"),
                ("paddingBottom", "0px"),
                ("paddingLeft", "5px"),
                ("paddingRight", "5px"),
            ],
        );
        d.set_rect(hl, 55.0, 100.0, 234.0, 42.9);
        d.set_text_rect(hl, 55.0, 100.0, 234.0, 42.9);
        assert!(snippets(&d, hl, "cramped-padding").is_empty(), "two one-line fragments");
        // A box one 43px line tall is past the gate.
        d.set_style(hl, "display", "inline-block");
        assert_eq!(
            snippets(&d, hl, "cramped-padding"),
            vec!["0px of space above and below the text (need ≥4.2px for 14px text)"]
        );
    }

    #[test]
    fn wide_tracking_exempts_short_capital_labels() {
        // A tracked label: one line, capitals, inside the label length.
        let label_text = "LIMITED EDITION RELEASE 2026";
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let s = text_el(&mut d, body, "span", label_text, "12px");
        d.set_rect(s, 40.0, 100.0, 260.0, 18.0);
        d.set_styles(s, &[("lineHeight", "18px"), ("letterSpacing", "2px")]);
        d.els[s as usize].direct_text_rect = Some(Rect::from_xywh(40.0, 100.0, 260.0, 18.0));
        assert!(check_element_quality_dom(&d, s, &BrowserConfig::default()).is_empty());

        // The same label typed lowercase keeps the finding.
        let mixed = text_el(&mut d, body, "span", "Fall 2026 technology preview", "12px");
        d.set_rect(mixed, 40.0, 130.0, 260.0, 18.0);
        d.set_styles(mixed, &[("lineHeight", "18px"), ("letterSpacing", "2px")]);
        d.els[mixed as usize].direct_text_rect = Some(Rect::from_xywh(40.0, 130.0, 260.0, 18.0));
        let hits = check_element_quality_dom(&d, mixed, &BrowserConfig::default());
        let ids: Vec<&str> = hits.iter().map(|h| h.id.as_str()).collect();
        assert_eq!(ids, vec!["wide-tracking"], "{hits:?}");

        // The same words declared uppercase were always exempt.
        let up = text_el(&mut d, body, "span", "Fall 2026 technology preview", "12px");
        d.set_rect(up, 40.0, 160.0, 260.0, 18.0);
        d.set_styles(
            up,
            &[("lineHeight", "18px"), ("letterSpacing", "2px"), ("textTransform", "uppercase")],
        );
        d.els[up as usize].direct_text_rect = Some(Rect::from_xywh(40.0, 160.0, 260.0, 18.0));
        assert!(check_element_quality_dom(&d, up, &BrowserConfig::default()).is_empty());

        // Typed capitals take the exemption `text-transform` does, over two
        // lines (mialight.app's caption wrapping on a phone) and past the
        // label length alike, short of a sentence.
        d.set_rect(s, 40.0, 100.0, 140.0, 36.0);
        d.els[s as usize].direct_text_rect = Some(Rect::from_xywh(40.0, 100.0, 140.0, 36.0));
        assert!(check_element_quality_dom(&d, s, &BrowserConfig::default()).is_empty());
        let long = text_el(
            &mut d,
            body,
            "p",
            "NOW AVAILABLE IN THE US, CANADA & NEW ZEALAND AND AUSTRALIA",
            "16px",
        );
        d.set_rect(long, 40.0, 240.0, 300.0, 52.0);
        d.set_styles(long, &[("lineHeight", "26px"), ("letterSpacing", "2px")]);
        d.els[long as usize].direct_text_rect = Some(Rect::from_xywh(40.0, 240.0, 300.0, 52.0));
        assert!(check_element_quality_dom(&d, long, &BrowserConfig::default()).is_empty());

        // A sentence typed in capitals is running text, and so are capitals a
        // transform lowers.
        let sentence = text_el(
            &mut d,
            body,
            "p",
            "SUPPORT HOURS RUN MONDAY TO FRIDAY, FROM NINE IN THE MORNING UNTIL SIX IN THE EVENING",
            "16px",
        );
        d.set_rect(sentence, 40.0, 400.0, 600.0, 52.0);
        d.set_styles(sentence, &[("lineHeight", "26px"), ("letterSpacing", "2px")]);
        d.els[sentence as usize].direct_text_rect = Some(Rect::from_xywh(40.0, 400.0, 600.0, 52.0));
        let ids: Vec<String> =
            check_element_quality_dom(&d, sentence, &BrowserConfig::default()).into_iter().map(|h| h.id).collect();
        assert_eq!(ids, vec!["wide-tracking"]);
        d.set_style(s, "textTransform", "lowercase");
        let ids: Vec<String> =
            check_element_quality_dom(&d, s, &BrowserConfig::default()).into_iter().map(|h| h.id).collect();
        assert_eq!(ids, vec!["wide-tracking"]);
        d.set_style(s, "textTransform", "none");

        // A long line of Hangul with one Latin acronym in capitals is running
        // text: the short-label reading needs one line inside the label length.
        let long = text_el(
            &mut d,
            body,
            "p",
            "고객센터 운영 시간은 월요일부터 금요일까지 오전 아홉 시부터 오후 여섯 시까지입니다 (KST)",
            "16px",
        );
        d.set_rect(long, 40.0, 300.0, 600.0, 52.0);
        d.set_styles(long, &[("lineHeight", "26px"), ("letterSpacing", "2px")]);
        d.els[long as usize].direct_text_rect = Some(Rect::from_xywh(40.0, 300.0, 600.0, 52.0));
        let hits = check_element_quality_dom(&d, long, &BrowserConfig::default());
        let ids: Vec<&str> = hits.iter().map(|h| h.id.as_str()).collect();
        assert_eq!(ids, vec!["wide-tracking"], "{hits:?}");
        assert_eq!(hits[0].snippet, "letter-spacing: 0.13em on body text");
    }

    /// Uppercase costs reading only when the run is long enough to be read as
    /// a sentence. A label keeps its capitals however narrow the viewport is,
    /// and however much text the element's children hold.
    #[test]
    fn all_caps_body_needs_a_long_run() {
        let caps = |text: &str| -> Vec<RuleHit> {
            let mut d = FakeDom::new();
            let (_h, body) = d.with_page();
            let el = text_el(&mut d, body, "span", text, "12px");
            d.set_rect(el, 40.0, 100.0, 300.0, 18.0);
            d.set_styles(el, &[("lineHeight", "18px"), ("textTransform", "uppercase")]);
            check_element_quality_dom(&d, el, &BrowserConfig::default())
        };
        let flagged = |hits: &[RuleHit]| hits.iter().any(|h| h.id == "all-caps-body");

        // A card CTA or an eyebrow: conventional at any width, so silent.
        let label = "How Mintlify is scaling sales-led GTM";
        assert!(!flagged(&caps(label)), "37-char label");

        // Real sites run labels into the seventies; a sentence starts at 80.
        let long = "Every order placed before noon ships the same day from our warehouse today";
        assert_eq!(utf16_len(long), 74);
        assert!(!flagged(&caps(long)), "74-char label");
        let longer = format!("{long} or later");
        assert_eq!(utf16_len(&longer), 83);
        let hits = caps(&longer);
        assert!(flagged(&hits), "83-char run: {hits:?}");
        assert_eq!(
            hits.iter().find(|h| h.id == "all-caps-body").unwrap().snippet,
            "text-transform: uppercase on 83 chars of body text"
        );

        // The run is measured as rendered: markup whitespace collapses.
        let spaced = format!("\n      {longer}\n    ");
        let hits = caps(&spaced);
        assert_eq!(
            hits.iter().find(|h| h.id == "all-caps-body").unwrap().snippet,
            "text-transform: uppercase on 83 chars of body text"
        );

        // A bar whose own label is short and whose child holds a second one:
        // neither run is a sentence, so neither element is charged for both.
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let bar = text_el(&mut d, body, "div", "Audit trail complete ", "13px");
        d.set_rect(bar, 40.0, 100.0, 300.0, 20.0);
        d.set_styles(bar, &[("lineHeight", "20px"), ("textTransform", "uppercase")]);
        let badge_text = "immutable log of every configuration change your team makes";
        let badge = text_el(&mut d, bar, "span", badge_text, "13px");
        d.set_rect(badge, 40.0, 100.0, 300.0, 20.0);
        d.set_styles(badge, &[("lineHeight", "20px"), ("textTransform", "uppercase")]);
        // The subtree reaches the sentence length; neither run in it does.
        assert_eq!(utf16_len(&d.text_content(bar)), 80);
        assert_eq!(utf16_len(badge_text), 59);
        for el in [bar, badge] {
            let hits = check_element_quality_dom(&d, el, &BrowserConfig::default());
            assert!(!flagged(&hits), "{hits:?}");
        }
    }

    #[test]
    fn justified_text_narrows_to_rivers() {
        let latin = "word ".repeat(24);
        let chinese = "永慶房屋於一九八八年成立專注本業堅持創新秉持先誠實再成交的精神".to_string();
        let arabic = "يعتمد ضبط النص في الخط العربي على استطالة الحروف على السطر".to_string();
        let thai = "การจัดวางข้อความแบบชิดขอบทั้งสองด้านในภาษาไทยไม่ได้ดึงช่องว่าง".to_string();
        let justified = |text: &str, width: f64, hyphens: &str| {
            let mut d = FakeDom::new();
            let (_h, body) = d.with_page();
            let p = text_el(&mut d, body, "p", text, "16px");
            d.set_rect(p, 40.0, 100.0, width, 60.0);
            d.set_styles(p, &[("lineHeight", "26px"), ("textAlign", "justify"), ("hyphens", hyphens)]);
            let hits = check_element_quality_dom(&d, p, &BrowserConfig::default());
            hits.iter().any(|h| h.id == "justified-text")
        };

        // 300px at 16px is ~37 chars/line; 800px is ~100.
        assert!(justified(&latin, 300.0, "manual"));
        assert!(!justified(&latin, 800.0, "manual"));
        assert!(!justified(&latin, 300.0, "auto"));
        // Scripts that justify without stretching word spaces.
        assert!(!justified(&chinese, 300.0, "manual"));
        assert!(!justified(&arabic, 300.0, "manual"));
        assert!(!justified(&thai, 300.0, "manual"));
        // A Latin paragraph carrying a few ideographs is still Latin.
        assert!(justified(&format!("{latin} 永慶房屋"), 300.0, "manual"));
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

    /// Taste call r3-19: each floor keeps a 0.1px tolerance, so fluid type a
    /// hair under it stops reporting and text 0.1px under or more reports.
    #[test]
    fn undersized_ui_text_tolerates_fluid_sizes_a_hair_under_the_floor() {
        fn undersized(d: &FakeDom, el: ElId) -> Vec<String> {
            check_element_quality_dom(d, el, &BrowserConfig::default())
                .into_iter()
                .filter(|h| h.id == "undersized-ui-text")
                .map(|h| h.snippet)
                .collect()
        }
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let s = text_el(&mut d, body, "span", "透天厝", "10.9688px");
        d.set_rect(s, 23.0, 711.0, 33.0, 11.0);
        assert!(undersized(&d, s).is_empty(), "0.03px under 11px");
        d.set_style(s, "fontSize", "10.95px");
        assert!(undersized(&d, s).is_empty(), "0.05px under 11px");
        d.set_style(s, "fontSize", "10.9px");
        assert_eq!(undersized(&d, s), vec!["10.9px functional text \"透天厝\" (below 11px floor)"]);
        d.set_style(s, "fontSize", "10.944px");
        assert!(undersized(&d, s).is_empty(), "swipeloan.in's slider ticks");

        // The smallprint floor keeps the same tolerance.
        let legal = text_el(&mut d, body, "span", "Terms apply", "9.95px");
        d.set_rect(legal, 23.0, 800.0, 60.0, 11.0);
        d.add_selector(legal, SMALLPRINT);
        assert!(undersized(&d, legal).is_empty(), "0.05px under 10px");
        d.set_style(legal, "fontSize", "9.9px");
        assert_eq!(undersized(&d, legal), vec!["9.9px functional text \"Terms apply\" (below 10px floor)"]);

        // Text in a link keeps the interactive floor, smallprint class or not
        // (taste call r3-07, kept).
        let card = d.add(Some(body), "a");
        d.set_attr(card, "href", "/story");
        d.add_selector(card, INTERACTIVE);
        let credit = text_el(&mut d, card, "div", "Photo: Reuters", "10.5px");
        d.set_rect(credit, 23.0, 900.0, 80.0, 12.0);
        d.add_selector(credit, INTERACTIVE);
        d.add_selector(credit, SMALLPRINT);
        assert_eq!(
            undersized(&d, credit),
            vec!["10.5px functional text \"Photo: Reuters\" (below 11px floor)"]
        );
    }

    /// observations-35 row 6 (directus.io 216043 to 216058): `tabindex`
    /// alone names no control, and a monospace run that reads as code is
    /// code whatever its class names.
    #[test]
    fn undersized_ui_text_reads_focusable_regions_and_code_runs() {
        fn undersized(d: &FakeDom, el: ElId) -> Vec<String> {
            check_element_quality_dom(d, el, &BrowserConfig::default())
                .into_iter()
                .filter(|h| h.id == "undersized-ui-text")
                .map(|h| h.snippet)
                .collect()
        }
        let long = "A caption that runs well past twenty characters";
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        // A custom control: a short label in a focusable box.
        let chip = d.add(Some(body), "div");
        d.set_attr(chip, "tabindex", "0");
        let label = text_el(&mut d, chip, "span", "Show the full comparison table", "9px");
        d.set_rect(label, 20.0, 100.0, 140.0, 12.0);
        assert_eq!(undersized(&d, label).len(), 1, "a control's label, however long");
        // The same text in a box taken out of the tab order is content: over
        // twenty characters, it is body text and not this rule's.
        d.set_attr(chip, "tabindex", "-1");
        assert!(undersized(&d, label).is_empty(), "tabindex -1");
        // So is a focusable region holding more than a label.
        d.set_attr(chip, "tabindex", "0");
        let more = text_el(&mut d, chip, "p", "The region also holds a paragraph of copy, a heading and a code sample.", "16px");
        d.set_rect(more, 20.0, 120.0, 400.0, 20.0);
        assert!(undersized(&d, label).is_empty(), "a focusable region");
        // A short label in it still reports, as any short label does.
        let short = text_el(&mut d, chip, "span", "Beta", "9px");
        d.set_rect(short, 20.0, 150.0, 30.0, 12.0);
        assert_eq!(undersized(&d, short), vec!["9px functional text \"Beta\" (below 11px floor)"]);
        // A real control inside the region keeps the interactive reading.
        let button = d.add(Some(chip), "button");
        d.add_selector(button, INTERACTIVE);
        let in_button = text_el(&mut d, button, "span", long, "9px");
        d.set_rect(in_button, 20.0, 170.0, 200.0, 12.0);
        d.add_selector(in_button, INTERACTIVE);
        assert_eq!(undersized(&d, in_button).len(), 1);

        // Code: monospace, whitespace kept, and it reads as code.
        let line = text_el(&mut d, body, "p", "\"id\": 7,", "8px");
        d.set_rect(line, 20.0, 300.0, 80.0, 11.0);
        d.set_styles(line, &[("fontFamily", "\"IBM Plex Mono\", monospace"), ("whiteSpace", "pre-wrap")]);
        assert!(undersized(&d, line).is_empty(), "a JSON line");
        // The same face on a pricing label is a label (directus.io 216153).
        let price = text_el(&mut d, body, "p", "$50/seat", "9px");
        d.set_rect(price, 20.0, 320.0, 60.0, 11.0);
        d.set_styles(price, &[("fontFamily", "\"IBM Plex Mono\", monospace"), ("whiteSpace", "pre-wrap")]);
        assert_eq!(undersized(&d, price), vec!["9px functional text \"$50/seat\" (below 11px floor)"]);
        // Code in a proportional face, or with its whitespace collapsed, is
        // not told from a label.
        d.set_style(line, "whiteSpace", "normal");
        assert_eq!(undersized(&d, line).len(), 1);
        d.set_styles(line, &[("whiteSpace", "pre"), ("fontFamily", "Inter, sans-serif")]);
        assert_eq!(undersized(&d, line).len(), 1);
    }

    /// observations-35 row 15 (keydris.com 217085, leilonozap.vercel.app
    /// 215445, paseo.sh 217250): a line its own box truncates ends at that
    /// box, and text on a running marquee track stands where the capture
    /// caught it.
    #[test]
    fn viewport_edge_reads_a_truncated_line_at_its_box_and_skips_running_tracks() {
        let copy = "A long single line that the box truncates with an ellipsis well before the edge";
        let len = utf16_len(copy);
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        d.inner_width = 390.0;
        let card = d.add(Some(body), "div");
        d.set_rect(card, 37.0, 600.0, 316.0, 200.0);
        let line = text_el(&mut d, card, "p", copy, "14px");
        d.set_styles(
            line,
            &[("overflowX", "hidden"), ("overflow", "hidden"), ("textOverflow", "ellipsis"), ("display", "block"), ("lineHeight", "20px")],
        );
        d.set_rect(line, 50.0, 834.0, 290.0, 20.0);
        d.el_mut(line).client_width = 290.0;
        d.el_mut(line).scroll_width = 437.0;
        // The Range rect runs to x 487, 97px past a 390px viewport.
        d.set_text_rect(line, 50.0, 835.0, 437.0, 17.0);
        assert!(snippets(&d, line, "body-text-viewport-edge").is_empty(), "the line ends at 340");
        assert!(check_page_overflow_dom(&d).is_empty(), "and nothing runs past the page");
        // A line clamp truncates the same way.
        d.set_styles(line, &[("textOverflow", "clip"), ("webkitLineClamp", "2")]);
        assert!(check_page_overflow_dom(&d).is_empty());
        // A box that hides its overflow with no marker cuts text mid-word:
        // that is not truncation by design, and it reports as before.
        d.set_style(line, "webkitLineClamp", "none");
        assert_eq!(check_page_overflow_dom(&d).len(), 1, "no marker");
        // So does an inline box, which clips nothing.
        d.set_styles(line, &[("textOverflow", "ellipsis"), ("display", "inline")]);
        assert_eq!(check_page_overflow_dom(&d).len(), 1, "an inline box");
        d.set_style(line, "display", "block");
        // Text an ancestor cuts is not the line's own truncation
        // (simplybudget.framer.ai's card, kept by the review of
        // observations-20 row 31).
        d.set_styles(line, &[("overflowX", "visible"), ("overflow", "visible")]);
        d.set_styles(card, &[("overflowX", "hidden"), ("overflow", "hidden"), ("display", "block")]);
        d.el_mut(card).client_width = 316.0;
        assert_eq!(check_page_overflow_dom(&d).len(), 1, "cut by the card");
        // A truncated line whose box reaches the viewport edge has no gutter.
        d.set_styles(card, &[("overflowX", "visible"), ("overflow", "visible")]);
        d.set_styles(line, &[("overflowX", "hidden"), ("overflow", "hidden")]);
        d.set_rect(line, 50.0, 834.0, 336.0, 20.0);
        d.el_mut(line).client_width = 336.0;
        assert_eq!(
            snippets(&d, line, "body-text-viewport-edge"),
            vec![format!("<p> with {len}-char body bleeds to viewport edge (right 4px)")]
        );

        // paseo.sh: a card in a track a running animation moves.
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        d.inner_width = 390.0;
        let window = d.add(Some(body), "div");
        d.set_styles(window, &[("overflowX", "hidden"), ("overflow", "hidden"), ("display", "block")]);
        d.set_rect(window, 0.0, 1794.0, 390.0, 324.0);
        d.el_mut(window).client_width = 390.0;
        d.el_mut(window).scroll_width = 3247.0;
        let track = d.add(Some(window), "div");
        d.set_styles(
            track,
            &[("display", "flex"), ("transform", "matrix(1, 0, 0, 1, -1264.31, 0)"), ("animationName", "social-proof-scroll"), ("animationIterationCount", "infinite")],
        );
        d.set_rect(track, -1264.0, 1964.0, 2688.0, 154.0);
        d.el_mut(track).client_width = 2688.0;
        d.el_mut(track).scroll_width = 2688.0;
        let first = d.add(Some(track), "a");
        d.set_rect(first, -256.0, 1964.0, 320.0, 154.0);
        let second = d.add(Some(track), "a");
        d.set_rect(second, 80.0, 1964.0, 320.0, 154.0);
        let quote = text_el(&mut d, second, "p", copy, "14px");
        d.set_style(quote, "lineHeight", "22px");
        d.set_rect(quote, 97.0, 2025.0, 286.0, 68.0);
        d.set_text_rect(quote, 97.0, 2027.0, 281.0, 64.0);
        assert!(snippets(&d, quote, "body-text-viewport-edge").is_empty(), "a running track");
        // The same track held still by a script reports the gutter it shows.
        d.set_style(track, "animationName", "none");
        assert_eq!(
            snippets(&d, quote, "body-text-viewport-edge"),
            vec![format!("<p> with {len}-char body bleeds to viewport edge (right 7px)")]
        );
        // An animation that runs once is not a marquee.
        d.set_styles(track, &[("animationName", "slide-in"), ("animationIterationCount", "1")]);
        assert_eq!(snippets(&d, quote, "body-text-viewport-edge").len(), 1);
        // Nor is a one-shot slide beside an endless pulse: the pulse moves
        // nothing, and the counts pair with the names by position.
        let frames = |p: &str| vec![crate::browser::dom::KeyframeFrame { decls: vec![(p.to_string(), "x".to_string())] }];
        d.keyframes.insert("slide-in".to_string(), frames("transform"));
        d.keyframes.insert("pulse".to_string(), frames("opacity"));
        d.set_styles(track, &[("animationName", "slide-in, pulse"), ("animationIterationCount", "1, infinite")]);
        assert_eq!(snippets(&d, quote, "body-text-viewport-edge").len(), 1);
        d.set_styles(track, &[("animationName", "pulse, slide-in"), ("animationIterationCount", "1, infinite")]);
        assert!(snippets(&d, quote, "body-text-viewport-edge").is_empty(), "the slide is the endless one");
        // A prefixed transform moves the track too.
        d.keyframes.insert("slide-in".to_string(), frames("-webkit-transform"));
        assert!(snippets(&d, quote, "body-text-viewport-edge").is_empty(), "a -webkit-transform slide");
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

    /// r5-p29: a skip into the footer is chrome; a skip in the content, and
    /// one between two later footer headings, reports.
    #[test]
    fn skipped_heading_into_a_footer() {
        let heading = |d: &mut FakeDom, parent: ElId, tag: &str, text: &str| {
            let h = d.add(Some(parent), tag);
            d.add_text(h, text);
            h
        };
        let details = |d: &FakeDom| -> Vec<String> {
            check_page_quality_dom(d).into_iter().map(|f| f.detail).collect()
        };

        // The footer's column titles follow the page's closing h2.
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        heading(&mut d, body, "h1", "Products");
        heading(&mut d, body, "h3", "Jet Fuel");
        heading(&mut d, body, "h2", "Ready to start?");
        let footer = d.add(Some(body), "footer");
        d.add_selector(footer, FOOTER_SELECTOR);
        heading(&mut d, footer, "h4", "Solutions");
        heading(&mut d, footer, "h4", "Company");
        heading(&mut d, footer, "h6", "Legal");
        assert_eq!(
            details(&d),
            vec![
                "<h1> \"Products\" followed by <h3> \"Jet Fuel\" (missing h2)",
                "<h4> \"Company\" followed by <h6> \"Legal\" (missing h5)",
            ]
        );

        // The closing call to action sits inside the footer itself.
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        heading(&mut d, body, "h1", "Energy");
        let footer = d.add(Some(body), "div");
        d.add_selector(footer, FOOTER_SELECTOR);
        heading(&mut d, footer, "h2", "Ready to level up?");
        heading(&mut d, footer, "h4", "Products");
        heading(&mut d, footer, "h4", "Company");
        assert_eq!(details(&d), Vec::<String>::new());

        // A footer that opens on a column title: the skip after it is
        // between two footer headings.
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        heading(&mut d, body, "h2", "Ready to start?");
        let footer = d.add(Some(body), "footer");
        d.add_selector(footer, FOOTER_SELECTOR);
        heading(&mut d, footer, "h4", "Company");
        heading(&mut d, footer, "h6", "Legal");
        assert_eq!(details(&d), vec!["<h4> \"Company\" followed by <h6> \"Legal\" (missing h5)"]);

        // A footer heading that opens the page continues no outline.
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let footer = d.add(Some(body), "footer");
        d.add_selector(footer, FOOTER_SELECTOR);
        heading(&mut d, footer, "h4", "Company");
        heading(&mut d, footer, "h6", "Legal");
        assert_eq!(details(&d), vec!["<h4> \"Company\" followed by <h6> \"Legal\" (missing h5)"]);

        // The same headings with no footer around them.
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        heading(&mut d, body, "h2", "Ready to start?");
        heading(&mut d, body, "h4", "Solutions");
        assert_eq!(details(&d), vec!["<h2> \"Ready to start?\" followed by <h4> \"Solutions\" (missing h3)"]);
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

#[cfg(test)]
mod rendered_text_tests {
    use super::*;
    use crate::browser::fake_dom::FakeDom;

    /// A paragraph over two rendered lines of 640px and 260px, as
    /// directus.io's hero paragraph rendered.
    fn two_line_p(d: &mut FakeDom, body: ElId) -> ElId {
        let p = d.add(Some(body), "p");
        d.set_styles(
            p,
            &[
                ("fontSize", "18px"),
                ("lineHeight", "normal"),
                ("letterSpacing", "normal"),
                ("backgroundColor", "rgba(0, 0, 0, 0)"),
                ("position", "static"),
                ("textTransform", "none"),
                ("textAlign", "start"),
                ("whiteSpace", "normal"),
            ],
        );
        d.set_rect(p, 100.0, 270.0, 700.0, 56.0);
        d.set_text_lines(p, &[(100.0, 272.0, 640.0, 24.0), (100.0, 300.0, 260.0, 24.0)]);
        p
    }

    fn line_length(d: &FakeDom, el: ElId) -> Option<String> {
        check_element_quality_dom(d, el, &BrowserConfig::default())
            .into_iter()
            .find(|h| h.id == "line-length")
            .map(|h| h.snippet)
    }

    const SENTENCE: &str = "The collaborative backend that turns any database into an API your whole team can use today.";

    /// An inline `<style>` child is in `textContent` and on no line. Its 240
    /// characters were shared out between the two rendered lines and turned
    /// a 66-character line into a 240-character one.
    #[test]
    fn an_inline_style_child_is_not_counted() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let p = two_line_p(&mut d, body);
        let style = d.add(Some(p), "style");
        d.set_style(style, "display", "none");
        d.add_text(style, &"@keyframes blink { 0%, 50% { opacity: 1; } } ".repeat(6));
        d.add_text(p, SENTENCE);
        assert_eq!(rendered_text_len(&d, p), SENTENCE.len());
        assert_eq!(line_length(&d, p), None);

        // The same lines with that many characters of prose do report.
        let q = two_line_p(&mut d, body);
        d.add_text(q, &"w".repeat(SENTENCE.len() + 270));
        assert_eq!(
            line_length(&d, q).as_deref(),
            Some("~257 chars on 2 of 2 rendered lines (aim for <80)")
        );
    }

    /// A `display: none` child and a `<script>` are cut the same way, and a
    /// rendered inline child stays in.
    #[test]
    fn hidden_and_script_children_are_cut_and_inline_children_kept() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let p = two_line_p(&mut d, body);
        d.add_text(p, "Before ");
        let hidden = d.add(Some(p), "span");
        d.set_style(hidden, "display", "none");
        d.add_text(hidden, &"hidden ".repeat(40));
        let strong = d.add(Some(p), "strong");
        d.set_style(strong, "display", "inline");
        d.add_text(strong, "kept");
        let script = d.add(Some(p), "script");
        d.add_text(script, &"var x = 1; ".repeat(30));
        d.add_text(p, " after");
        assert_eq!(rendered_text_len(&d, p), "Before kept after".len());
    }

    /// Source indentation collapses to one space under `white-space: normal`
    /// and is kept under `pre-wrap`.
    #[test]
    fn source_indentation_collapses_unless_preserved() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let p = two_line_p(&mut d, body);
        d.add_text(p, "\n        Copyright 2017, all rights reserved\n                with the Directorate.\n    ");
        assert_eq!(
            rendered_text_len(&d, p),
            "Copyright 2017, all rights reserved with the Directorate.".len()
        );
        d.set_style(p, "whiteSpace", "pre-wrap");
        // The indentation before the first word is on the first line; the
        // line breaks around the text are not.
        assert_eq!(
            rendered_text_len(&d, p),
            "        Copyright 2017, all rights reserved\n                with the Directorate.".len()
        );
        // Spaces before and after the words of a one-line `pre` take room.
        let q = two_line_p(&mut d, body);
        d.add_text(q, "  indented  ");
        d.set_style(q, "whiteSpace", "pre");
        assert_eq!(rendered_text_len(&d, q), "  indented  ".len());
        // Under `pre-wrap` the spaces at the end of the line hang.
        d.set_style(q, "whiteSpace", "pre-wrap");
        assert_eq!(rendered_text_len(&d, q), "  indented".len());
        // No-break spaces at the edges of a `pre` line take room too.
        let r = two_line_p(&mut d, body);
        d.add_text(r, "\u{a0}indented\u{a0}");
        d.set_style(r, "whiteSpace", "pre");
        assert_eq!(rendered_text_len(&d, r), "_indented_".len());
    }

    /// Preserved indentation from one node and a collapsible space from the
    /// next both paint before the first word; a collapsible space before
    /// the indentation starts the line and is removed.
    #[test]
    fn indentation_and_a_following_collapsible_space_both_count() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let p = two_line_p(&mut d, body);
        d.add_text(p, " ");
        let span = d.add(Some(p), "span");
        d.set_style(span, "display", "inline");
        d.set_style(span, "whiteSpace", "pre");
        d.add_text(span, "  ");
        d.add_text(p, " \n  hello");
        assert_eq!(rendered_text_len(&d, p), "   hello".len());
        // The same when the first word sits in an inline-block.
        let q = two_line_p(&mut d, body);
        let span = d.add(Some(q), "span");
        d.set_style(span, "display", "inline");
        d.set_style(span, "whiteSpace", "pre");
        d.add_text(span, "  ");
        d.add_text(q, " ");
        let word = d.add(Some(q), "span");
        d.set_style(word, "display", "inline-block");
        d.add_text(word, "hello");
        assert_eq!(rendered_text_len(&d, q), "   hello".len());
    }

    /// A combining mark sits on its base and a zero-width joiner or soft
    /// hyphen draws nothing, so none of them is a character on the line.
    #[test]
    fn combining_marks_and_format_characters_are_not_counted() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let p = two_line_p(&mut d, body);
        // "राजस्थान के": र ा ज स ् थ ा न, a space, क े.
        d.add_text(p, "\u{930}\u{93e}\u{91c}\u{938}\u{94d}\u{925}\u{93e}\u{928} \u{915}\u{947}");
        assert_eq!(rendered_text_len(&d, p), 7);
        let q = two_line_p(&mut d, body);
        d.add_text(q, "cafe\u{301} co\u{ad}operate\u{200b}s");
        assert_eq!(rendered_text_len(&d, q), "cafe cooperates".len());
    }

    /// Plain prose counts as before, so a long column still reports the same
    /// number.
    #[test]
    fn plain_prose_counts_every_character() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let p = two_line_p(&mut d, body);
        d.set_text_lines(p, &[(100.0, 272.0, 640.0, 24.0), (100.0, 300.0, 640.0, 24.0)]);
        d.add_text(p, &"word ".repeat(40));
        assert_eq!(rendered_text_len(&d, p), 199);
        assert_eq!(
            line_length(&d, p).as_deref(),
            Some("~100 chars on 2 of 2 rendered lines (aim for <80)")
        );
    }

    /// Each text node keeps or folds its white space by the `white-space` it
    /// inherits, not the paragraph's. A `pre-wrap` span inside a normal
    /// paragraph keeps its runs of spaces on the line, so it counts the same
    /// as a `pre-wrap` paragraph and flags the same long lines.
    #[test]
    fn a_preserving_span_inside_a_normal_paragraph_keeps_its_spaces() {
        let text = "word    ".repeat(22);
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let p = two_line_p(&mut d, body);
        d.set_text_lines(p, &[(100.0, 272.0, 640.0, 24.0), (100.0, 300.0, 640.0, 24.0)]);
        d.add_text(p, "An opening line ");
        let span = d.add(Some(p), "span");
        d.set_style(span, "display", "inline");
        d.set_style(span, "whiteSpace", "pre-wrap");
        d.add_text(span, &text);
        assert_eq!(rendered_text_len(&d, p), "An opening line ".len() + 22 * 8 - 4);

        let whole = two_line_p(&mut d, body);
        d.set_text_lines(whole, &[(100.0, 272.0, 640.0, 24.0), (100.0, 300.0, 640.0, 24.0)]);
        d.set_style(whole, "whiteSpace", "pre-wrap");
        d.add_text(whole, &format!("An opening line {text}"));
        assert_eq!(rendered_text_len(&d, whole), rendered_text_len(&d, p));
        assert_eq!(line_length(&d, p), line_length(&d, whole));
        assert_eq!(
            line_length(&d, p).as_deref(),
            Some("~94 chars on 2 of 2 rendered lines (aim for <80)")
        );

        // The reverse: a normal span inside a pre-wrap paragraph folds its
        // own runs, and a collapsible run carries on across the boundary of
        // an inline child the way `a <b> b</b>` renders one space.
        let q = two_line_p(&mut d, body);
        d.set_style(q, "whiteSpace", "pre-wrap");
        d.add_text(q, "a  b");
        let normal = d.add(Some(q), "span");
        d.set_style(normal, "display", "inline");
        d.set_style(normal, "whiteSpace", "normal");
        d.add_text(normal, "   c   d");
        assert_eq!(rendered_text_len(&d, q), "a  b c d".len());
        let r = two_line_p(&mut d, body);
        d.add_text(r, "a ");
        let b = d.add(Some(r), "b");
        d.set_style(b, "display", "inline");
        d.add_text(b, " b");
        assert_eq!(rendered_text_len(&d, r), "a b".len());
    }

    /// The text of a hidden child is skipped where it sits, so a hidden run
    /// of white space never takes a visible space with it.
    #[test]
    fn a_hidden_child_is_skipped_where_it_sits() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let p = two_line_p(&mut d, body);
        d.add_text(p, "one two");
        let hidden = d.add(Some(p), "span");
        d.set_style(hidden, "display", "none");
        d.add_text(hidden, " ");
        assert_eq!(rendered_text_len(&d, p), "one two".len());

        let q = two_line_p(&mut d, body);
        d.add_text(q, "one two three four");
        for _ in 0..3 {
            let hidden = d.add(Some(q), "span");
            d.set_style(hidden, "display", "none");
            d.add_text(hidden, " ");
            d.add_text(q, "x");
        }
        assert_eq!(rendered_text_len(&d, q), "one two three fourxxx".len());
    }

    /// A `content-visibility: hidden` child lays out its box and renders none
    /// of its contents, so its text is on no line. A DOM that cannot say
    /// (no `contentVisibility` value) counts it.
    #[test]
    fn a_content_visibility_hidden_child_is_skipped() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let p = two_line_p(&mut d, body);
        d.add_text(p, "Before ");
        let skipped = d.add(Some(p), "span");
        d.set_style(skipped, "display", "inline-block");
        d.set_style(skipped, "contentVisibility", "hidden");
        d.add_text(skipped, &"unrendered ".repeat(30));
        d.add_text(p, "after");
        assert_eq!(rendered_text_len(&d, p), "Before after".len());

        let q = two_line_p(&mut d, body);
        d.add_text(q, "Before ");
        let unknown = d.add(Some(q), "span");
        d.set_style(unknown, "display", "inline");
        d.add_text(unknown, "kept ");
        d.add_text(q, "after");
        assert_eq!(rendered_text_len(&d, q), "Before kept after".len());

        // content-visibility does not apply to a plain inline box or to
        // display: contents, so their text renders and counts.
        for display in ["inline", "contents"] {
            let r = two_line_p(&mut d, body);
            d.add_text(r, "Before ");
            let inline = d.add(Some(r), "span");
            d.set_style(inline, "display", display);
            d.set_style(inline, "contentVisibility", "hidden");
            d.add_text(inline, "shown ");
            d.add_text(r, "after");
            assert_eq!(rendered_text_len(&d, r), "Before shown after".len(), "{display}");
        }
    }

    /// An image or an inline-block is an atomic inline: the space on each
    /// side of it renders, so the pair does not fold into one, and a
    /// populated box's own edge white space is trimmed inside it.
    #[test]
    fn spaces_around_an_atomic_inline_both_count() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        for (tag, display) in [("img", "inline"), ("span", "inline-block")] {
            let r = two_line_p(&mut d, body);
            d.add_text(r, "word ");
            let boxed = d.add(Some(r), tag);
            d.set_style(boxed, "display", display);
            d.add_text(r, " word");
            assert_eq!(rendered_text_len(&d, r), "word  word".len(), "{tag}");
        }

        // A populated box trims its own edge white space in its own
        // formatting context: none of it joins the spaces outside.
        for (tag, display) in [("span", "inline-block"), ("button", "inline-block")] {
            let r = two_line_p(&mut d, body);
            d.add_text(r, "word ");
            let boxed = d.add(Some(r), tag);
            d.set_style(boxed, "display", display);
            d.add_text(boxed, "\n      word\n    ");
            d.add_text(r, " word");
            assert_eq!(rendered_text_len(&d, r), "word word word".len(), "{tag}");
        }

        // Edge spaces that cannot collapse render inside the box: preserved
        // ones under white-space: pre, and no-break spaces.
        let r = two_line_p(&mut d, body);
        d.add_text(r, "word ");
        let pre = d.add(Some(r), "span");
        d.set_style(pre, "display", "inline-block");
        d.set_style(pre, "whiteSpace", "pre");
        d.add_text(pre, " word ");
        d.add_text(r, " word");
        assert_eq!(rendered_text_len(&d, r), "word  word  word".len());

        let r = two_line_p(&mut d, body);
        d.add_text(r, "word ");
        let nbsp = d.add(Some(r), "span");
        d.set_style(nbsp, "display", "inline-block");
        d.add_text(nbsp, "\u{a0}word\u{a0}");
        d.add_text(r, " word");
        assert_eq!(rendered_text_len(&d, r), "word _word_ word".len());
    }

    /// An empty atomic inline (an image, an input, an empty inline-block)
    /// still sits on the line, so a collapsible space between it and the
    /// text renders even where the box starts or ends the text.
    #[test]
    fn a_space_beside_an_empty_atomic_inline_at_the_edge_counts() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        for (tag, display) in [("img", "inline"), ("input", "inline-block"), ("span", "inline-block")] {
            let r = two_line_p(&mut d, body);
            let boxed = d.add(Some(r), tag);
            d.set_style(boxed, "display", display);
            d.add_text(r, " word");
            assert_eq!(rendered_text_len(&d, r), " word".len(), "leading {tag}");

            let r = two_line_p(&mut d, body);
            d.add_text(r, "word ");
            let boxed = d.add(Some(r), tag);
            d.set_style(boxed, "display", display);
            assert_eq!(rendered_text_len(&d, r), "word ".len(), "trailing {tag}");

            // Only the white space outside every box is an edge.
            let r = two_line_p(&mut d, body);
            d.add_text(r, "  ");
            let boxed = d.add(Some(r), tag);
            d.set_style(boxed, "display", display);
            d.add_text(r, " word ");
            assert_eq!(rendered_text_len(&d, r), " word".len(), "edges {tag}");

            // A hard break after the box starts a new line, whose leading
            // space is trimmed (review of #968).
            let r = two_line_p(&mut d, body);
            let boxed = d.add(Some(r), tag);
            d.set_style(boxed, "display", display);
            d.add(Some(r), "br");
            d.add_text(r, " word");
            assert_eq!(rendered_text_len(&d, r), "word".len(), "break {tag}");
        }
    }
}
