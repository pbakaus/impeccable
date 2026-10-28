//! Section 4 of `cli/engine/rules/checks.mjs`: the unified background walk
//! (`readOwnBackgroundColor`, `readCascadeBackgroundColor`,
//! `resolveBackgroundInfo`, `resolveBackground`, `resolveGradientStops`,
//! `compositeGradientStops`, `resolveBorderRadiusPx`), static-engine
//! branches only (`DETECTOR_IS_BROWSER === false`).

use crate::cascade::csstree::strings::{decode_string, decode_url};
use crate::cascade::values::{css_call_end, css_string_end, extract_static_color};
use crate::cascade::StyleValues;
use crate::dom::StaticElement;
use ego_tree::NodeId;
use impeccable_core::checks::gradient_geometry as geo;
use impeccable_core::checks::measures::{
    parse_color_resolved, parse_radius_corner_px_em, parse_radius_corners_em, parse_radius_to_px,
    parse_radius_token_px, CustomProps, ROOT_FONT_SIZE_PX,
};
use impeccable_core::checks::rules::Corners;
use impeccable_core::checks::sampled_contrast::{
    attachment_depends_on_layout, paints_no_tile, repeat_tiles, uniform_wash, wash_fills_box,
};
use impeccable_core::color::{
    composite_color_over, is_no_paint_color_value, parse_any_color, parse_gradient_colors,
    parse_rgb, split_top_level_commas, Rgba,
};
use impeccable_core::js;
use once_cell::sync::Lazy;
use regex::Regex;
use std::borrow::Cow;
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

/// `style.x || ''` on a computed style map.
pub fn sv<'a>(style: &'a StyleValues, key: &str) -> &'a str {
    style.get(key).map(|s| s.as_str()).unwrap_or("")
}

/// `style.x` as JS sees it: `None` for a key the style object never had.
pub fn sv_opt<'a>(style: &'a StyleValues, key: &str) -> Option<&'a str> {
    style.get(key).map(|s| s.as_str())
}

/// JS `c.a >= x` where `a` may be undefined (then false).
pub fn a_ge(c: &Rgba, x: f64) -> bool {
    c.a.is_some_and(|a| a >= x)
}
/// JS `c.a > x`.
pub fn a_gt(c: &Rgba, x: f64) -> bool {
    c.a.is_some_and(|a| a > x)
}
/// JS `c.a < x`.
pub fn a_lt(c: &Rgba, x: f64) -> bool {
    c.a.is_some_and(|a| a < x)
}

/// The static engine's `customPropMap` is always `null`; kept as a
/// parameter so the port mirrors the JS signatures.
pub type CustomPropMap<'a> = Option<&'a dyn CustomProps>;

static INLINE_BG_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(
        r"(?i)background(?:-color)?{ws}*:{ws}*([^;]+)",
        ws = js::WS
    ))
    .expect("INLINE_BG_RE")
});
static INLINE_BG_IMAGE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(
        r"(?i)background(?:-image)?{ws}*:{ws}*([^;]+)",
        ws = js::WS
    ))
    .expect("INLINE_BG_IMAGE_RE")
});
static GRADIENT_RE: Lazy<Regex> = Lazy::new(|| Regex::new("(?i)gradient").expect("GRADIENT_RE"));
static GRADIENT_CALL_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(r"(?i)gradient{ws}*\(", ws = js::WS)).expect("GRADIENT_CALL_RE")
});
static URL_CALL_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(&format!(r"(?i)url{ws}*\(", ws = js::WS)).expect("URL_CALL_RE"));
static URL_START_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(&format!(r"(?i)^{ws}*url{ws}*\(", ws = js::WS)).expect("URL_START_RE"));
static HEX_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)#([0-9a-f]{6}|[0-9a-f]{3})(?-u:\b)").expect("HEX_RE"));
static CURRENTCOLOR_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new("(?i)^currentcolor$").expect("CURRENTCOLOR_RE"));

/// `rawStyle.match(/background(?:-color)?\s*:\s*([^;]+)/i)` → trimmed value.
fn inline_bg(el: &StaticElement<'_>) -> String {
    let raw = el.get_attribute("style").unwrap_or("");
    INLINE_BG_RE
        .captures(raw)
        .map(|m| js::trim(&m[1]).to_string())
        .unwrap_or_default()
}

fn hex_to_rgba(h: &str) -> Rgba {
    let p = |s: &str| js::parse_int(s, 16);
    if h.len() == 6 {
        Rgba::new(p(&h[0..2]), p(&h[2..4]), p(&h[4..6]), 1.0)
    } else {
        let d = |i: usize| {
            let c = &h[i..i + 1];
            p(&format!("{c}{c}"))
        };
        Rgba::new(d(0), d(1), d(2), 1.0)
    }
}

/// JS: checks.mjs#readOwnBackgroundColor(el, computedStyle)
pub fn read_own_background_color(el: &StaticElement<'_>, style: &StyleValues) -> Option<Rgba> {
    let bgc = sv_opt(style, "backgroundColor");
    let bg = parse_rgb(bgc).or_else(|| parse_any_color(bgc));
    if bg.as_ref().is_some_and(|c| a_ge(c, 0.1)) {
        return bg;
    }
    let inline = inline_bg(el);
    if inline.is_empty() {
        return bg;
    }
    if GRADIENT_RE.is_match(&inline) || URL_CALL_RE.is_match(&inline) {
        return bg;
    }
    if let Some(from_rgb) = parse_rgb(Some(&inline)) {
        return Some(from_rgb);
    }
    if let Some(m) = HEX_RE.captures(&inline) {
        return Some(hex_to_rgba(&m[1]));
    }
    bg
}

/// JS: checks.mjs#readCascadeBackgroundColor(current, style, customPropMap)
pub fn read_cascade_background_color(
    current: &StaticElement<'_>,
    style: &StyleValues,
    custom_props: CustomPropMap<'_>,
) -> Option<Rgba> {
    let bgc = sv_opt(style, "backgroundColor");
    let mut bg = parse_rgb(bgc).or_else(|| parse_any_color(bgc));
    if bg.is_none() || bg.as_ref().is_some_and(|c| a_lt(c, 0.1)) {
        if let Some(map) = custom_props {
            bg = parse_color_resolved(bgc, Some(map));
        }
        if bg.is_none() || bg.as_ref().is_some_and(|c| a_lt(c, 0.1)) {
            let inline = inline_bg(current);
            if !inline.is_empty()
                && !GRADIENT_RE.is_match(&inline)
                && !URL_CALL_RE.is_match(&inline)
            {
                bg = parse_color_resolved(Some(&inline), custom_props)
                    .or_else(|| parse_any_color(Some(&inline)));
            }
        }
    }
    bg
}

/// `{ color, unresolved }` from `resolveBackgroundInfo`.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct BackgroundInfo {
    pub color: Option<Rgba>,
    pub unresolved: bool,
}

/// The alpha a fill needs before the walk every rule but contrast shares
/// composites it. The contrast walk composites every fill that paints.
const LEGACY_MIN_FILL_ALPHA: f64 = 0.1;

/// The surface the contrast check reads text against, with what the walk
/// learned on the way. The browser engine's `TextSurface` without the
/// sampled gradient: this engine has no layout to sample it at.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct TextSurface {
    pub info: BackgroundInfo,
    /// The box whose gradient is the surface.
    pub gradient_host: Option<NodeId>,
    /// [`surface_label`] of `gradient_host`.
    pub gradient_label: Option<String>,
    /// The box that ended the walk. `None` is the canvas.
    pub host: Option<NodeId>,
    /// The opaque colour at `host` before the fills above it.
    pub base: Option<Rgba>,
    /// The translucent fills between the text and `host`, innermost first.
    pub overlays: Vec<(NodeId, Rgba)>,
    /// Boxes whose gradient the walk read as absent because its tile cannot
    /// cover a line of the text.
    pub skipped_images: Vec<NodeId>,
}

struct Query<'a> {
    skip_image: &'a dyn Fn(&StaticElement<'_>) -> bool,
    min_fill_alpha: f64,
    /// The text's font size in px, for the size-only coverage test.
    font_size: Option<f64>,
}

/// Whether a box declares `display: contents`: it generates no box, so it
/// paints no background, and the walk reads past its fill.
pub(crate) fn paints_no_box(style: &StyleValues) -> bool {
    js::to_lower_case(js::trim(sv(style, "display"))) == "contents"
}

fn flatten(overlays: &[(NodeId, Rgba)], base: Rgba) -> Rgba {
    let mut acc = base;
    for (_, o) in overlays.iter().rev() {
        acc = composite_color_over(o, &acc);
    }
    acc
}

/// One element's own background color as both ancestor walks read it: the
/// cascade color, or the text color when the declared value is
/// `currentcolor`.
fn level_background_color(
    cur: &StaticElement<'_>,
    style: &StyleValues,
    custom_props: CustomPropMap<'_>,
) -> Option<Rgba> {
    let mut bg = read_cascade_background_color(cur, style, custom_props);
    if (bg.is_none() || bg.as_ref().is_some_and(|c| a_lt(c, 0.1)))
        && CURRENTCOLOR_RE.is_match(js::trim(sv(style, "backgroundColor")))
    {
        let color = sv_opt(style, "color");
        bg = parse_rgb(color).or_else(|| parse_color_resolved(color, custom_props));
    }
    bg
}

/// JS: checks.mjs#resolveBackgroundInfo(el, win, customPropMap)
pub fn resolve_background_info(
    el: &StaticElement<'_>,
    custom_props: CustomPropMap<'_>,
) -> BackgroundInfo {
    resolve_background_info_skipping_images(el, custom_props, &|_| false)
}

/// [`resolve_background_info`] with the background images of the boxes
/// `skip_image` names read as `none`. The SAFE_TAGS text path uses it for an
/// icon on the link or its list item: the walk gives up on any raster image,
/// and an external-link mark or an arrow bullet is not the surface the words
/// are read against.
pub fn resolve_background_info_skipping_images(
    el: &StaticElement<'_>,
    custom_props: CustomPropMap<'_>,
    skip_image: &dyn Fn(&StaticElement<'_>) -> bool,
) -> BackgroundInfo {
    let query = Query {
        skip_image,
        min_fill_alpha: LEGACY_MIN_FILL_ALPHA,
        font_size: None,
    };
    walk_surface(el, custom_props, &query).info
}

/// The surface under an element's text for the contrast check: the shared
/// walk compositing every translucent fill that paints, and reading past a
/// gradient whose tile cannot cover a line of the text (an underline drawn
/// as `linear-gradient(#000, #000) no-repeat 0 100% / 0% 2px`). This engine
/// has no layout, so a gradient that does cover stays the surface and the
/// caller scores its worst stop.
pub fn resolve_text_surface(
    el: &StaticElement<'_>,
    custom_props: CustomPropMap<'_>,
    skip_image: &dyn Fn(&StaticElement<'_>) -> bool,
    font_size: f64,
) -> TextSurface {
    let query = Query {
        skip_image,
        min_fill_alpha: 0.0,
        font_size: Some(font_size),
    };
    walk_surface(el, custom_props, &query)
}

/// Whether a box's gradient tile, from its size and repeat alone, cannot
/// cover a line of text. The cascade carries the `background-size` and
/// `background-repeat` longhands an author declared; a `background`
/// shorthand arrives whole in `backgroundImage`, and its size and repeat
/// are read out of it.
fn gradient_tile_misses(style: &StyleValues, bg_image: &str, font_size: f64) -> bool {
    if !GRADIENT_RE.is_match(bg_image) || URL_CALL_RE.is_match(bg_image) {
        return false;
    }
    let first_layer = split_top_level_commas(bg_image)
        .into_iter()
        .next()
        .unwrap_or_default();
    let size = match js::trim(sv(style, "backgroundSize")) {
        "" => geo::parse_shorthand_layer(&first_layer)
            .size
            .unwrap_or_default(),
        declared => declared.to_string(),
    };
    let repeat = geo::repeat_from(sv(style, "backgroundRepeat"), bg_image);
    geo::gradient_tile_misses_text(&size, repeat, font_size)
}

fn walk_surface(
    el: &StaticElement<'_>,
    custom_props: CustomPropMap<'_>,
    q: &Query<'_>,
) -> TextSurface {
    let mut out = TextSurface::default();
    let mut current = Some(*el);
    while let Some(cur) = current {
        let style = cur.style();
        if paints_no_box(style) {
            current = cur.parent_element();
            continue;
        }
        let bg_image = if (q.skip_image)(&cur) {
            "none"
        } else {
            sv(style, "backgroundImage")
        };
        let has_gradient_or_url = !bg_image.is_empty()
            && bg_image != "none"
            && (GRADIENT_RE.is_match(bg_image) || URL_CALL_RE.is_match(bg_image));

        let bg = level_background_color(&cur, style, custom_props);

        if let Some(c) = bg.as_ref().filter(|c| a_gt(c, q.min_fill_alpha)) {
            if a_ge(c, 0.99) {
                out.info = BackgroundInfo {
                    color: Some(flatten(&out.overlays, *c)),
                    unresolved: false,
                };
                out.host = Some(cur.id());
                out.base = Some(*c);
                return out;
            }
            out.overlays.push((cur.id(), *c));
        } else if bg.is_none() && !is_no_paint_color_value(sv_opt(style, "backgroundColor")) {
            out.info = BackgroundInfo {
                color: None,
                unresolved: true,
            };
            out.host = Some(cur.id());
            return out;
        }
        if has_gradient_or_url {
            if q.font_size
                .is_some_and(|f| gradient_tile_misses(style, bg_image, f))
            {
                out.skipped_images.push(cur.id());
                current = cur.parent_element();
                continue;
            }
            out.host = Some(cur.id());
            let layers = split_top_level_commas(bg_image);
            let top_paint_layer = layers
                .iter()
                .find(|layer| GRADIENT_CALL_RE.is_match(layer) || URL_CALL_RE.is_match(layer));
            let gradient_on_top = top_paint_layer.is_some_and(|layer| {
                GRADIENT_CALL_RE.is_match(layer) && !URL_START_RE.is_match(layer)
            });
            if !gradient_on_top {
                out.info = BackgroundInfo {
                    color: None,
                    unresolved: true,
                };
                return out;
            }
            let top = top_paint_layer.unwrap();
            let url_beneath = layers
                .iter()
                .any(|layer| layer != top && URL_CALL_RE.is_match(layer));
            if url_beneath {
                let top_stops = parse_gradient_colors(Some(top));
                let provably_opaque =
                    !top_stops.is_empty() && top_stops.iter().all(|s| s.alpha_or_one() >= 0.99);
                if !provably_opaque {
                    out.info = BackgroundInfo {
                        color: None,
                        unresolved: true,
                    };
                    return out;
                }
            }
            out.gradient_host = Some(cur.id());
            out.gradient_label = Some(surface_label(&cur));
            out.info = BackgroundInfo {
                color: None,
                unresolved: false,
            };
            return out;
        }
        current = cur.parent_element();
    }
    let canvas = Rgba::new(255.0, 255.0, 255.0, 1.0);
    out.info = BackgroundInfo {
        color: Some(flatten(&out.overlays, canvas)),
        unresolved: false,
    };
    out.base = Some(canvas);
    out
}

/// JS: checks.mjs#resolveBackground(el, win, customPropMap)
pub fn resolve_background(el: &StaticElement<'_>, custom_props: CustomPropMap<'_>) -> Option<Rgba> {
    resolve_background_info(el, custom_props).color
}

/// JS: checks.mjs#resolveGradientStops(el, win, customPropMap)
pub fn resolve_gradient_stops(
    el: &StaticElement<'_>,
    custom_props: CustomPropMap<'_>,
) -> Option<Vec<Rgba>> {
    let query = Query {
        skip_image: &|_| false,
        min_fill_alpha: LEGACY_MIN_FILL_ALPHA,
        font_size: None,
    };
    gradient_stops_walk(el, custom_props, &query)
}

/// Every stop of the gradient a contrast surface walk stopped on: the stops
/// walk with the contrast walk's fill threshold, reading the gradients it
/// skipped as absent.
pub fn resolve_text_gradient_stops(
    el: &StaticElement<'_>,
    custom_props: CustomPropMap<'_>,
    surface: &TextSurface,
) -> Option<Vec<Rgba>> {
    let skipped = |c: &StaticElement<'_>| surface.skipped_images.contains(&c.id());
    let query = Query {
        skip_image: &skipped,
        min_fill_alpha: 0.0,
        font_size: None,
    };
    gradient_stops_walk(el, custom_props, &query)
}

fn gradient_stops_walk(
    el: &StaticElement<'_>,
    custom_props: CustomPropMap<'_>,
    q: &Query<'_>,
) -> Option<Vec<Rgba>> {
    let mut current = Some(*el);
    let mut overlays: Vec<(NodeId, Rgba)> = Vec::new();
    while let Some(cur) = current {
        let style = cur.style();
        if paints_no_box(style) {
            current = cur.parent_element();
            continue;
        }
        let skipped = (q.skip_image)(&cur);
        let bg_image = if skipped {
            "none"
        } else {
            sv(style, "backgroundImage")
        };
        if !bg_image.is_empty() && bg_image != "none" && URL_CALL_RE.is_match(bg_image) {
            return None;
        }
        let mut stops: Option<Vec<Rgba>> = None;
        if !bg_image.is_empty() && bg_image != "none" && GRADIENT_RE.is_match(bg_image) {
            let parsed = parse_gradient_colors(Some(bg_image));
            if !parsed.is_empty() {
                stops = Some(parsed);
            }
        }
        if stops.is_none() && !skipped {
            let raw = cur.get_attribute("style").unwrap_or("");
            if let Some(m) = INLINE_BG_IMAGE_RE.captures(raw) {
                if GRADIENT_RE.is_match(&m[1]) {
                    let parsed = parse_gradient_colors(Some(&m[1]));
                    if !parsed.is_empty() {
                        stops = Some(parsed);
                    }
                }
            }
        }
        if let Some(stops) = stops {
            let composited = composite_stops(&stops, &cur, custom_props, q);
            let Some(composited) = composited else {
                return None;
            };
            if overlays.is_empty() {
                return Some(composited);
            }
            return Some(
                composited
                    .into_iter()
                    .map(|stop| flatten(&overlays, stop))
                    .collect(),
            );
        }
        let bg = read_cascade_background_color(&cur, style, custom_props);
        if let Some(c) = bg.filter(|c| a_gt(c, q.min_fill_alpha)) {
            if a_ge(&c, 0.99) {
                return None;
            }
            overlays.push((cur.id(), c));
        }
        current = cur.parent_element();
    }
    None
}

/// JS: checks.mjs#compositeGradientStops(stops, gradientEl, win, customPropMap)
pub fn composite_gradient_stops(
    stops: &[Rgba],
    gradient_el: &StaticElement<'_>,
    custom_props: CustomPropMap<'_>,
) -> Option<Vec<Rgba>> {
    let query = Query {
        skip_image: &|_| false,
        min_fill_alpha: LEGACY_MIN_FILL_ALPHA,
        font_size: None,
    };
    composite_stops(stops, gradient_el, custom_props, &query)
}

fn composite_stops(
    stops: &[Rgba],
    gradient_el: &StaticElement<'_>,
    custom_props: CustomPropMap<'_>,
    q: &Query<'_>,
) -> Option<Vec<Rgba>> {
    let has_alpha = stops.iter().any(|s| s.alpha_or_one() < 0.99);
    if !has_alpha {
        return Some(stops.to_vec());
    }
    let base_el = gradient_el.parent_element().unwrap_or(*gradient_el);
    let base = walk_surface(&base_el, custom_props, q).info.color;
    let mut out: Vec<Rgba> = Vec::new();
    for s in stops {
        let a = s.alpha_or_one();
        if a >= 0.99 {
            out.push(*s);
            continue;
        }
        if let Some(base) = base.as_ref() {
            out.push(composite_color_over(s, base));
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

/// A short name for the box that painted a surface, for a snippet: the tag
/// with its id, else with its first class.
pub fn surface_label(el: &StaticElement<'_>) -> String {
    let tag = el.tag_lower();
    let id = js::trim(el.id_attr());
    if !id.is_empty() && !id.chars().any(|c| c.is_ascii_whitespace()) {
        return format!("{tag}#{id}");
    }
    match el.class_name().split_ascii_whitespace().next() {
        Some(first) => format!("{tag}.{first}"),
        None => tag,
    }
}

/// JS: checks.mjs#resolveBorderRadiusPx(el, style, widthPx, win)
pub fn resolve_border_radius_px(style: &StyleValues, width_px: f64) -> f64 {
    parse_radius_to_px(sv_opt(style, "borderRadius"), width_px).unwrap_or(0.0)
}

/// The element's font size in px, what an `em` radius resolves against.
fn em_px(style: &StyleValues) -> f64 {
    let size = impeccable_core::js::parse_float(sv(style, "fontSize"));
    if size.is_finite() && size > 0.0 {
        size
    } else {
        ROOT_FONT_SIZE_PX
    }
}

/// The radius the border snippet reports, in px: the first horizontal radius
/// of the shorthand with `em` / `rem` converted, which is what the browser's
/// computed style prints. A token that does not convert (a `calc()`) keeps
/// [`resolve_border_radius_px`]'s unitless reading.
pub fn resolve_border_radius_scalar_px(style: &StyleValues, width_px: f64) -> f64 {
    let first = sv_opt(style, "borderRadius")
        .and_then(|v| v.split('/').next())
        .and_then(|h| h.split_whitespace().next());
    first
        .and_then(|token| parse_radius_token_px(token, width_px, em_px(style)))
        .unwrap_or_else(|| resolve_border_radius_px(style, width_px))
}

/// The four corner radii in px, read from the `border-<corner>-radius`
/// longhands. The cascade expands every `border-radius` shorthand into those
/// longhands with the shorthand's own cascade order, so a longhand declared
/// after the shorthand wins its corner and a shorthand declared after a
/// longhand resets it, the way the browser resolves them. `None` when a
/// corner carries a value the parser cannot resolve, so the caller keeps
/// reporting instead of reading the box as square.
///
/// A shorthand built from `var()` cannot be split before it resolves, so the
/// cascade hands every corner the whole value. A corner still carrying the
/// resolved shorthand (its value equals `borderRadius`) reads its own
/// position of it: `--r: 0 12px 12px 0` rounds the right corners only. The
/// one case this misreads is a two-value longhand spelled exactly like the
/// shorthand before it.
pub fn resolve_border_radius_corners(style: &StyleValues, width_px: f64) -> Option<Corners> {
    let em = em_px(style);
    let shorthand = sv_opt(style, "borderRadius");
    let whole = || parse_radius_corners_em(shorthand, width_px, em);
    let corner = |prop: &str, pick: fn(&Corners) -> f64| {
        let value = sv_opt(style, prop);
        if value.is_some() && value == shorthand {
            whole().map(|c| pick(&c))
        } else {
            parse_radius_corner_px_em(value, width_px, em)
        }
    };
    Some(Corners {
        top_left: corner("borderTopLeftRadius", |c| c.top_left)?,
        top_right: corner("borderTopRightRadius", |c| c.top_right)?,
        bottom_right: corner("borderBottomRightRadius", |c| c.bottom_right)?,
        bottom_left: corner("borderBottomLeftRadius", |c| c.bottom_left)?,
    })
}

/// The corners the side-accent gate reads for an element. The cascade is
/// the answer only where it could see every radius that reaches the element,
/// and everywhere else the corners are unknown, which keeps the finding:
///
/// - a radius the cascade could not apply may reach the element (a nested
///   rule, a rule inside `@container` or an unknown at-rule, a selector the
///   matcher refuses);
/// - no applied declaration gave the element a radius, but its classes name
///   one the page compiles at runtime (`rounded-lg` with no stylesheet rule
///   for it): the utility classes decide, an unknown size stays unknown;
/// - no applied declaration gave the element a radius and the page links a
///   stylesheet the engine did not read.
///
/// Only a radius the engine reads, or the initial `0` of a box every
/// stylesheet of which it read, silences a side accent.
pub fn resolve_side_accent_corners(
    el: &StaticElement<'_>,
    style: &StyleValues,
    width_px: f64,
) -> Option<Corners> {
    if el.radius_unseen() {
        return None;
    }
    if !el.radius_declared() {
        let classes = impeccable_core::checks::rules::tailwind_declared_corners(el.class_name());
        if classes.declared() {
            return classes.to_corners();
        }
        if el.page_has_unread_stylesheet() {
            return None;
        }
    }
    resolve_border_radius_corners(style, width_px)
}

// ─── the image ground (#560) ────────────────────────────────────────────────

static GRADIENT_PRELUDE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(
        r"(?i)^(?:to{ws}|from{ws}|at{ws}|in{ws}|[-+]?[0-9.]+(?:deg|grad|rad|turn)(?-u:\b)|circle(?-u:\b)|ellipse(?-u:\b)|closest-|farthest-)|{ws}at{ws}",
        ws = js::WS
    ))
    .expect("GRADIENT_PRELUDE_RE")
});
static STOP_POSITION_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)^[-+]?[0-9.]+(?:%|[a-z]+)?$").expect("STOP_POSITION_RE"));

/// The first call at the top level of `text[from..to]` whose name `wanted`
/// accepts, as `(start of the name, index of its "(")`. A call nested in
/// another (`image-set(url(a.png) 1x)`, `cross-fade(..)`) is that function's
/// argument, not the layer's image, and a string hides whatever it quotes.
fn top_level_call(
    text: &str,
    from: usize,
    to: usize,
    wanted: impl Fn(&str) -> bool,
) -> Option<(usize, usize)> {
    let bytes = text.as_bytes();
    let is_name = |b: u8| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b >= 0x80;
    let mut i = from;
    while i < to {
        match bytes[i] {
            b'\\' => i += 2,
            b'"' | b'\'' => i = css_string_end(text, i),
            b'(' => {
                let mut name = i;
                while name > from && is_name(bytes[name - 1]) {
                    name -= 1;
                }
                if wanted(&text[name..i]) {
                    return Some((name, i));
                }
                i = css_call_end(text, i);
            }
            _ => i += 1,
        }
    }
    None
}

fn is_gradient_name(name: &str) -> bool {
    name.len() >= 8 && name.as_bytes()[name.len() - 8..].eq_ignore_ascii_case(b"gradient")
}

/// A `url()` call inside a background value, located the way the CSS
/// tokenizer would: `url(` and then a quoted string, or an unquoted run to
/// the first unescaped `)`. Spans are byte offsets into the value it was
/// found in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UrlCall {
    arg_start: usize,
    arg_end: usize,
    quoted: bool,
    escaped: bool,
}

impl UrlCall {
    /// The `url()` call at the top level of `text[from..to]`. `url(` inside
    /// a longer identifier (`myurl(`) is a custom function, not this token.
    fn find(text: &str, from: usize, to: usize) -> Option<UrlCall> {
        let (_, open) = top_level_call(text, from, to, |name| name.eq_ignore_ascii_case("url"))?;
        let close = css_call_end(text, open).min(to);
        let closed = close > open + 1 && text.as_bytes()[close - 1] == b')';
        let inner_end = if closed { close - 1 } else { close };
        let inner = &text[open + 1..inner_end];
        let lead = inner.len() - inner.trim_start().len();
        let trimmed = inner.trim();
        let mut arg_start = open + 1 + lead;
        let mut arg_end = arg_start + trimmed.len();
        let bytes = trimmed.as_bytes();
        let quoted = bytes.len() >= 2
            && (bytes[0] == b'"' || bytes[0] == b'\'')
            && bytes[bytes.len() - 1] == bytes[0];
        if quoted {
            arg_start += 1;
            arg_end -= 1;
        }
        Some(UrlCall {
            arg_start,
            arg_end,
            quoted,
            escaped: text[arg_start..arg_end].contains('\\'),
        })
    }

    /// The url the call names, decoded. Borrowed from `text` unless it
    /// carries escapes, so a multi-megabyte data URI is never copied.
    pub fn value<'t>(&self, text: &'t str) -> Cow<'t, str> {
        let raw = &text[self.arg_start..self.arg_end];
        if !self.escaped {
            Cow::Borrowed(raw)
        } else if self.quoted {
            Cow::Owned(decode_string(&text[self.arg_start - 1..self.arg_end + 1]))
        } else {
            Cow::Owned(decode_url(&format!("url({raw})")))
        }
    }
}

/// The byte spans of a background list's top-level layers, trimmed. Commas
/// inside calls and strings do not split.
fn layer_spans(text: &str) -> Vec<(usize, usize)> {
    let bytes = text.as_bytes();
    let mut spans: Vec<(usize, usize)> = Vec::new();
    let mut start = 0usize;
    let mut i = 0usize;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' => i += 1,
            b'(' => {
                i = css_call_end(text, i);
                continue;
            }
            b'"' | b'\'' => {
                i = css_string_end(text, i);
                continue;
            }
            b',' => {
                spans.push((start, i));
                start = i + 1;
            }
            _ => {}
        }
        i += 1;
    }
    spans.push((start.min(text.len()), text.len()));
    spans
        .into_iter()
        .map(|(from, to)| {
            let slice = &text[from..to];
            let lead = slice.len() - slice.trim_start().len();
            (from + lead, from + lead + slice.trim().len())
        })
        .collect()
}

/// One entry of a comma-separated background list, with the CSS wraparound
/// for a list shorter than the image list.
fn layer_entry(value: &str, index: usize) -> String {
    let parts = split_top_level_commas(value);
    if parts.is_empty() {
        return String::new();
    }
    js::trim(&parts[index % parts.len()]).to_string()
}

/// The stops of a gradient call (`linear-gradient(..)`, name to closing
/// paren), when every one of them was read. `parse_gradient_colors` reads
/// color functions and hex only, so a `transparent`, named, `currentcolor`,
/// or `var()` stop goes missing from its result, and a wash judged on the
/// stops that remain is not the wash that paints. `None` for that case, and
/// for a gradient with no stops.
fn gradient_stops(call: &str) -> Option<Vec<Rgba>> {
    let stops = parse_gradient_colors(Some(call));
    let args = &call[call.find('(')? + 1..];
    let args = args.strip_suffix(')').unwrap_or(args);
    let expected = split_top_level_commas(args)
        .iter()
        .enumerate()
        .filter(|(index, segment)| {
            let segment = js::trim(segment);
            let prelude = *index == 0 && GRADIENT_PRELUDE_RE.is_match(segment);
            !segment.is_empty() && !prelude && !STOP_POSITION_RE.is_match(segment)
        })
        .count();
    (!stops.is_empty() && stops.len() == expected).then_some(stops)
}

/// A background layer that names a color and nothing else: the final layer
/// of `background: url(x.png), #17150f`. An unresolved `var()` could be an
/// image as easily as a color, so it is not one.
fn is_color_layer(layer: &str) -> bool {
    let var = layer
        .get(..4)
        .is_some_and(|head| head.eq_ignore_ascii_case("var("));
    !var && extract_static_color(layer) == layer
}

/// What one element paints behind its descendants' text, as the sampled
/// path reads it.
#[derive(Debug, Clone, PartialEq)]
pub enum LevelPaint {
    /// Translucent paint only (uniform washes, then the element's own
    /// color), top to bottom. The walk goes on to the parent.
    Through(Vec<Rgba>),
    /// The analytic walk owns this level: an opaque color with no image over
    /// it, an opaque gradient, a scrim that varies or has a stop the engine
    /// cannot read, an unparseable color, or an image function it cannot
    /// read.
    Stop,
    /// A `url()` layer, with what the element paints over and under it.
    Image(ImageLayer),
}

#[derive(Debug, Clone, PartialEq)]
pub struct ImageLayer {
    /// The `url()` call inside the element's `backgroundImage` value.
    pub call: UrlCall,
    /// The layer's own `background-repeat`, `background-size`, and
    /// `background-position` entries.
    pub repeat: String,
    pub size: String,
    pub position: String,
    /// The layer's `background-origin` and `background-clip` entries, for a
    /// layer painted inside the element's padding (`sampled_ground`).
    pub origin: String,
    pub clip: String,
    /// The layer's `background-attachment` entry: `fixed` meets the box
    /// where layout says (`sampled_ground`).
    pub attachment: String,
    /// Uniform washes listed above the image in the same declaration.
    pub washes: Vec<Rgba>,
    /// The element's own background color, painted beneath the image.
    pub color: Option<Rgba>,
    /// Another layer is listed beneath the image, so a translucent pixel has
    /// unknown paint under it.
    pub layers_beneath: bool,
    /// The element's font size in px, for a size given in `em`.
    pub font_size: f64,
}

/// A `background-blend-mode` or `mix-blend-mode` other than `normal`:
/// paint the sampler cannot reproduce. A CSS-wide keyword other than
/// `inherit` is the initial value, `normal`.
fn blends(mode: &str) -> bool {
    !mode.is_empty()
        && mode.split(',').any(|m| {
            let m = js::trim(m);
            !(m.eq_ignore_ascii_case("normal")
                || m.eq_ignore_ascii_case("initial")
                || m.eq_ignore_ascii_case("unset")
                || m.eq_ignore_ascii_case("revert")
                || m.eq_ignore_ascii_case("revert-layer"))
        })
}

/// A `filter` or `backdrop-filter` that changes a region's colors: paint
/// the sampler cannot reproduce. `blur()` and `drop-shadow()` leave a
/// region's mean color where it is (a frosted panel over a photo is still
/// the photo's colors, averaged), so a filter made of those alone is read
/// through; any other function (`brightness()`, `invert()`, `contrast()`,
/// a `var()` that did not resolve, an SVG `url()`) stops the walk. A
/// CSS-wide keyword other than `inherit` is the initial value, `none`.
fn filters(value: &str) -> bool {
    let v = js::to_lower_case(js::trim(value));
    if v.is_empty()
        || matches!(
            v.as_str(),
            "none" | "initial" | "unset" | "revert" | "revert-layer"
        )
    {
        return false;
    }
    // Only the outer functions are filters: the color inside a
    // `drop-shadow(0 1px 2px rgba(0, 0, 0, .3))` is its argument, however
    // it is spelled.
    let mut depth = 0usize;
    let mut name = String::new();
    let mut saw_call = false;
    for ch in v.chars() {
        match ch {
            '(' => {
                if depth == 0 {
                    saw_call = true;
                    if !matches!(name.as_str(), "blur" | "drop-shadow") {
                        return true;
                    }
                }
                depth += 1;
                name.clear();
            }
            ')' => {
                depth = depth.saturating_sub(1);
                name.clear();
            }
            c if depth == 0 && (c.is_ascii_alphanumeric() || c == '-') => name.push(c),
            _ if depth == 0 => name.clear(),
            _ => {}
        }
    }
    // No function at all: not a filter value the engine knows.
    !saw_call
}

/// Whether an ancestor of `el` (not `el` itself, whose own filter
/// `analyze_level` reads) carries a `filter` that changes colors. A
/// `backdrop-filter` above reworks what lies behind that ancestor, not what
/// it contains, so only `filter` counts here.
/// A color-changing `filter` or a `mix-blend-mode` on an ancestor of `el`
/// that generates a box: either reworks the image and the text together
/// with what is behind the ancestor, which the samples cannot show. A
/// `display: contents` ancestor has no box, so neither applies, as
/// `analyze_level` reads past one below the image.
fn ancestor_reworks_colors(el: &StaticElement<'_>) -> bool {
    std::iter::successors(el.parent_element(), |e| e.parent_element()).any(|e| {
        let style = e.style();
        !paints_no_box(style)
            && (filters(sv(style, "filter")) || blends(sv(style, "mixBlendMode")))
    })
}

/// The paint of one element, in isolation from its ancestors.
/// Per axis, whether a layer with these entries may leave the element's
/// padding to what is beneath it: positioned inside the padding by
/// `background-origin: content-box` on an axis it does not tile along (a
/// tiled axis fills the padding box wherever the tiles start), or clipped to
/// the content box by `background-clip: content-box` on every axis, with
/// padding on that axis (any value not known to be zero). Text positioned
/// in that padding is not under the layer, and without layout the model
/// cannot tell it from text in the content box. An entry is read token by
/// token, since a shorthand's bare `var()` may have resolved into it beside
/// a literal keyword, and one still holding a `var()` is not known to
/// paint the padding.
pub(crate) fn layer_inset_by_padding(
    style: &StyleValues,
    origin: &str,
    clip: &str,
    repeat: &str,
) -> (bool, bool) {
    let names_content_box = |entry: &str| {
        entry.contains("var(")
            || entry
                .split_whitespace()
                .any(|token| token.eq_ignore_ascii_case("content-box"))
    };
    let inside = names_content_box(origin);
    let clipped = names_content_box(clip);
    if !inside && !clipped {
        return (false, false);
    }
    let padded = |sides: [&str; 2]| sides.iter().any(|side| !zero_length(sv(style, side)));
    let (tiles_x, tiles_y) = repeat_tiles(repeat);
    let inset = |tiles: bool, padded: bool| padded && (clipped || (inside && !tiles));
    (
        inset(tiles_x, padded(["paddingLeft", "paddingRight"])),
        inset(tiles_y, padded(["paddingTop", "paddingBottom"])),
    )
}

/// Whether an element's own color may leave part of the box to what is
/// beneath it. The color is clipped by the bottom layer's `background-clip`
/// entry (the list cycles over the image layers and entries past them are
/// ignored, so with one layer the first entry is the color's): clipped to
/// the content box (or by an entry still holding a `var()`) with padding
/// on any side not known to be zero, the padding is untinted; clipped to
/// the text, it paints glyphs and no ground at all. Without layout the walk
/// cannot tell text in the padding from text in the content box, so a wash
/// so clipped is not known to tint every sample.
fn color_leaves_box(style: &StyleValues) -> bool {
    let bg_image = sv(style, "backgroundImage");
    let layers = if bg_image.is_empty() {
        1
    } else {
        layer_spans(bg_image).len().max(1)
    };
    let entry = layer_entry(background_clip(style), layers - 1);
    let last = js::trim(&entry);
    let names = |keyword: &str| {
        last.split_whitespace()
            .any(|token| token.eq_ignore_ascii_case(keyword))
    };
    if names("text") {
        return true;
    }
    (last.contains("var(") || names("content-box"))
        && ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"]
            .iter()
            .any(|side| !zero_length(sv(style, side)))
}

/// A padding the box does not have: zero in any unit. What layout would
/// have to resolve (`var()`, `calc()`) is not known to be zero.
fn zero_length(value: &str) -> bool {
    let value = js::trim(value);
    value.is_empty() || (js::parse_float(value) == 0.0 && !value.contains('('))
}

/// The `background-clip` list, the prefixed form first where it is set, as
/// the text-clip gate reads it.
pub(crate) fn background_clip(style: &StyleValues) -> &str {
    let prefixed = sv(style, "webkitBackgroundClip");
    if prefixed.is_empty() {
        sv(style, "backgroundClip")
    } else {
        prefixed
    }
}

pub fn analyze_level(cur: &StaticElement<'_>) -> LevelPaint {
    let style = cur.style();
    // `display: contents` generates no box: its fill and its image paint
    // nowhere, and the walk reads past it, as the analytic walk does.
    if paints_no_box(style) {
        return LevelPaint::Through(Vec::new());
    }
    // A `::before` or `::after` stretched over the element paints over
    // whatever the element paints: an opaque fill the analytic path owns, a
    // translucent or gradient overlay, or a picture. None of them is in the
    // samples, so the walk gives up here.
    if cur.doc.get_pseudo_surface(cur.id()).is_some()
        || cur.doc.has_pseudo_overlay(cur.id())
        || cur.doc.has_pseudo_picture(cur.id())
    {
        return LevelPaint::Stop;
    }
    // A blend changes what every pixel looks like in a way the sampler
    // cannot reproduce, and so does a filter: a `backdrop-filter` on the
    // text or a wrapper reworks what shows through behind the text, and a
    // `filter` on a box reworks the box and everything in it.
    if blends(sv(style, "backgroundBlendMode"))
        || blends(sv(style, "mixBlendMode"))
        || filters(sv(style, "filter"))
        || filters(sv(style, "backdropFilter"))
    {
        return LevelPaint::Stop;
    }
    let bg = level_background_color(cur, style, None);
    if bg.is_none() && !is_no_paint_color_value(sv_opt(style, "backgroundColor")) {
        return LevelPaint::Stop;
    }
    let color = bg.filter(|c| a_gt(c, 0.1));
    // A color clipped away from part of the box does not tint every sample
    // as a wash, nor lie under every pixel of an image above it: the walk
    // gives up rather than darken the ground.
    if color.is_some() && color_leaves_box(style) {
        return LevelPaint::Stop;
    }
    // A `var()` in the background shorthand added or removed layers once
    // resolved: nothing stored per layer lines up with what paints.
    if sv(style, "backgroundLayersUnknown") == "1" {
        return LevelPaint::Stop;
    }
    let bg_image = sv(style, "backgroundImage");
    let font_size = js::parse_float(sv(style, "fontSize"));
    let font_size = if font_size > 0.0 { font_size } else { 16.0 };
    let mut washes: Vec<Rgba> = Vec::new();
    if !bg_image.is_empty() {
        let spans = layer_spans(bg_image);
        for (index, &(from, to)) in spans.iter().enumerate() {
            let layer = &bg_image[from..to];
            if layer.is_empty() || layer.eq_ignore_ascii_case("none") {
                continue;
            }
            // A layer sized to zero lays out no tile however it repeats:
            // it paints nothing, image or wash, and is read past like
            // `none`.
            let size = layer_entry(sv(style, "backgroundSize"), index);
            if paints_no_tile(&size) {
                continue;
            }
            // A layer clipped to the text paints the glyphs and no ground:
            // read past, like `none` (a list clipped on every layer is the
            // ink gate's to refuse).
            if layer_entry(background_clip(style), index)
                .split_whitespace()
                .any(|token| token.eq_ignore_ascii_case("text"))
            {
                continue;
            }
            // A layer fixed to the viewport meets the box where layout says.
            let attachment = layer_entry(sv(style, "backgroundAttachment"), index);
            let fixed = attachment_depends_on_layout(&attachment);
            if let Some((name, open)) = top_level_call(bg_image, from, to, is_gradient_name) {
                // An opaque gradient is the ground; a scrim that varies is
                // placed under the text on purpose, and without layout the
                // engine cannot say which stop the text sits on. A wash that
                // does not fill the box tints some samples and not others.
                let call = &bg_image[name..css_call_end(bg_image, open)];
                let Some(stops) = gradient_stops(call) else {
                    return LevelPaint::Stop;
                };
                if stops.iter().all(|s| s.alpha_or_one() >= 0.99) {
                    return LevelPaint::Stop;
                }
                let Some(wash) = uniform_wash(&stops) else {
                    return LevelPaint::Stop;
                };
                let repeat = layer_entry(sv(style, "backgroundRepeat"), index);
                let position = layer_entry(sv(style, "backgroundPosition"), index);
                if fixed || !wash_fills_box(&repeat, &size, &position, font_size) {
                    return LevelPaint::Stop;
                }
                // A wash painted inside the padding tints the content box
                // and not the padding, and the walk cannot place the text.
                let origin = layer_entry(sv(style, "backgroundOrigin"), index);
                let clip = layer_entry(background_clip(style), index);
                let wash_inset = layer_inset_by_padding(style, &origin, &clip, &repeat);
                if wash_inset.0 || wash_inset.1 {
                    return LevelPaint::Stop;
                }
                washes.push(wash);
                continue;
            }
            // A shorthand layer may put color, position, size, or repeat
            // tokens around the image call; the call is what matters.
            let Some(call) = UrlCall::find(bg_image, from, to) else {
                return LevelPaint::Stop;
            };
            // `none` paints nothing, and a final layer that is only a color
            // is the element's own color, which the cascade stored as
            // `backgroundColor`. Anything else beneath the image is paint
            // this walk has not read.
            let last = spans.len() - 1;
            let layers_beneath = (index + 1..spans.len()).any(|below| {
                let (from, to) = spans[below];
                let rest = &bg_image[from..to];
                !(rest.is_empty()
                    || rest.eq_ignore_ascii_case("none")
                    || (below == last && is_color_layer(rest)))
            });
            return LevelPaint::Image(ImageLayer {
                call,
                repeat: layer_entry(sv(style, "backgroundRepeat"), index),
                size,
                position: layer_entry(sv(style, "backgroundPosition"), index),
                origin: layer_entry(sv(style, "backgroundOrigin"), index),
                clip: layer_entry(background_clip(style), index),
                attachment,
                washes,
                color,
                layers_beneath,
                font_size,
            });
        }
    }
    if color.as_ref().is_some_and(|c| a_ge(c, 0.99)) {
        return LevelPaint::Stop;
    }
    washes.extend(color);
    LevelPaint::Through(washes)
}

/// [`analyze_level`] remembered per element for one document: a page's text
/// elements share their ancestors, and an ancestor's background (a data URI
/// can run to megabytes) is read once.
#[derive(Default)]
pub struct LevelCache(RefCell<HashMap<NodeId, Rc<LevelPaint>>>);

impl LevelCache {
    fn get(&self, el: &StaticElement<'_>) -> Rc<LevelPaint> {
        if let Some(hit) = self.0.borrow().get(&el.id()) {
            return hit.clone();
        }
        let paint = Rc::new(analyze_level(el));
        self.0.borrow_mut().insert(el.id(), paint.clone());
        paint
    }
}

/// The image a text element sits on: the nearest level that paints a `url()`
/// layer, with everything painted between the text and it.
#[derive(Debug, Clone, PartialEq)]
pub struct ImageGround {
    /// The element that paints the image.
    pub node: NodeId,
    pub layer: ImageLayer,
    /// Translucent paint between the text and the image, top to bottom,
    /// each with the element that paints it; the image element's own washes
    /// carry its id. The adapter folds the opacity of the boxes between the
    /// text and the image around these.
    pub overlays: Vec<(NodeId, Rgba)>,
    /// What a translucent pixel composites over, when the walk can say.
    pub under: Option<Rgba>,
    /// The element also declares an opaque color, so the image replaces it
    /// as the ground only if it provably covers the box.
    pub over_opaque_color: bool,
}

/// What shows through a translucent image: the parent chain's ground as the
/// analytic walk composites it, white at the root, unless an image on the
/// way to the first opaque level hides that ground, which makes it unknown.
fn parent_ground(cur: &StaticElement<'_>, levels: &LevelCache) -> Option<Rgba> {
    let Some(parent) = cur.parent_element() else {
        return Some(Rgba::new(255.0, 255.0, 255.0, 1.0));
    };
    let mut probe = Some(parent);
    while let Some(p) = probe {
        match &*levels.get(&p) {
            LevelPaint::Image(_) => return None,
            LevelPaint::Stop => break,
            LevelPaint::Through(_) => probe = p.parent_element(),
        }
    }
    resolve_background(&parent, None)
}

/// The walk the sampled path takes in place of [`resolve_background_info`]:
/// up from the text to the first `url()` layer. `None` when an element on
/// the way is one the analytic walk owns (see [`LevelPaint::Stop`]) or when
/// no image is reached.
pub fn find_image_ground(el: &StaticElement<'_>, levels: &LevelCache) -> Option<ImageGround> {
    let mut current = Some(*el);
    let mut overlays: Vec<(NodeId, Rgba)> = Vec::new();
    while let Some(cur) = current {
        match &*levels.get(&cur) {
            LevelPaint::Stop => return None,
            LevelPaint::Through(paint) => overlays.extend(paint.iter().map(|c| (cur.id(), *c))),
            LevelPaint::Image(layer) => {
                overlays.extend(layer.washes.iter().map(|c| (cur.id(), *c)));
                let over_opaque_color = layer.color.as_ref().is_some_and(|c| a_ge(c, 0.99));
                // A layer beneath the image is unknown paint. Otherwise the
                // element's own color, over its parent's ground when it is
                // translucent, white at the root like the analytic walk.
                let under = if layer.layers_beneath {
                    None
                } else if over_opaque_color {
                    layer.color
                } else {
                    let parent_ground = parent_ground(&cur, levels);
                    match layer.color {
                        Some(c) => parent_ground.map(|p| composite_color_over(&c, &p)),
                        None => parent_ground,
                    }
                };
                // A color-changing `filter` or a blend on any boxed ancestor
                // of the image element reworks the image and the text
                // together, which the samples cannot show: the walk gives up.
                if ancestor_reworks_colors(&cur) {
                    return None;
                }
                return Some(ImageGround {
                    node: cur.id(),
                    layer: layer.clone(),
                    overlays,
                    under,
                    over_opaque_color,
                });
            }
        }
        current = cur.parent_element();
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cascade::{build_static_style_map, collect_static_css_text};
    use crate::dom::StaticDocument;
    use std::path::Path;

    fn url_in(text: &str) -> Option<Cow<'_, str>> {
        UrlCall::find(text, 0, text.len()).map(|call| call.value(text))
    }

    #[test]
    fn a_url_call_ends_where_the_tokenizer_says() {
        assert_eq!(url_in("url(x.png)").as_deref(), Some("x.png"));
        assert_eq!(
            url_in("URL( 'x y.png' ) no-repeat").as_deref(),
            Some("x y.png")
        );
        // The generator's unquoted-escaped form: an escaped paren is part
        // of the url, not its end.
        assert_eq!(
            url_in(r"url(a\).png)center/cover").as_deref(),
            Some("a).png")
        );
        assert_eq!(url_in(r"url(a\ b\(1\).png)").as_deref(), Some("a b(1).png"));
        // A style attribute keeps its quotes: an escaped quote does not
        // close the string, and a paren inside it does not close the call.
        assert_eq!(
            url_in(r#"url("a\"b.png") no-repeat"#).as_deref(),
            Some(r#"a"b.png"#)
        );
        assert_eq!(
            url_in(r#"url("a).png") no-repeat"#).as_deref(),
            Some("a).png")
        );
        // Tokens may come first, and a color function ahead of the image is
        // not the call.
        assert_eq!(
            url_in("rgba(0, 0, 0, 0.5) url(x.png)center/cover").as_deref(),
            Some("x.png")
        );
        assert_eq!(url_in("myurl(x.png)"), None);
        assert_eq!(url_in("linear-gradient(red, blue)"), None);
        // A url that is another function's argument is not the layer's
        // image, and neither is one a string merely mentions.
        assert_eq!(url_in("image-set(url(x.png) 1x, url(x2.png) 2x)"), None);
        assert_eq!(url_in("cross-fade(url(a.png), url(b.png), 50%)"), None);
        assert_eq!(url_in(r#"image-set("url(x.png)" 1x)"#), None);
        // No escapes means no copy, whatever the length.
        let uri = format!("url(data:image/png;base64,{})", "A".repeat(4096));
        assert!(matches!(url_in(&uri), Some(Cow::Borrowed(_))));
        // A call that never closes still yields what is there.
        assert_eq!(url_in("url(x.png").as_deref(), Some("x.png"));
    }

    #[test]
    fn layers_split_on_top_level_commas_only() {
        let text = r#"linear-gradient(red, blue) , url("a,b.png") center, none"#;
        let layers: Vec<&str> = layer_spans(text)
            .into_iter()
            .map(|(from, to)| &text[from..to])
            .collect();
        assert_eq!(
            layers,
            [
                "linear-gradient(red, blue)",
                r#"url("a,b.png") center"#,
                "none"
            ]
        );
        assert_eq!(layer_spans("none"), vec![(0, 4)]);
    }

    #[test]
    fn a_gradient_is_read_only_when_every_stop_is() {
        let uniform =
            gradient_stops("linear-gradient(to right, rgba(0,0,0,.4) 0%, rgba(0,0,0,.4) 100%)");
        assert_eq!(uniform.map(|s| s.len()), Some(2));
        assert_eq!(
            gradient_stops("radial-gradient(circle at top, #000, 40%, #fff)").map(|s| s.len()),
            Some(2)
        );
        assert_eq!(
            gradient_stops("conic-gradient(from 90deg, #000 0deg, #fff 180deg)").map(|s| s.len()),
            Some(2)
        );
        // A stop the color parser does not read is a stop all the same.
        for scrim in [
            "linear-gradient(rgba(0,0,0,.8), transparent)",
            "linear-gradient(to top, rgba(0,0,0,.75), transparent)",
            "linear-gradient(transparent, rgba(0,0,0,.8))",
            "linear-gradient(black, rgba(0,0,0,.8))",
            "linear-gradient(rgba(0,0,0,.8), currentcolor)",
            "linear-gradient(rgba(0,0,0,.8), var(--end))",
            "linear-gradient(transparent, transparent)",
        ] {
            assert_eq!(gradient_stops(scrim), None, "{scrim}");
        }
    }

    #[test]
    fn a_filter_stops_the_walk_only_where_it_changes_colors() {
        for read_through in [
            "none",
            "initial",
            "blur(8px)",
            "drop-shadow(0 1px 2px #000)",
            "drop-shadow(0 1px 2px rgba(0, 0, 0, 0.3))",
            "blur(2px) drop-shadow(0 0 2px rgb(0 0 0 / 50%))",
        ] {
            assert!(!filters(read_through), "{read_through}");
        }
        for stop in [
            "brightness(0.1)",
            "blur(2px) brightness(0.5)",
            "invert(1)",
            "url(#frosted)",
            "var(--fx)",
            "contrast(2) drop-shadow(0 0 1px #000)",
            "unknown",
        ] {
            assert!(filters(stop), "{stop}");
        }
    }

    #[test]
    fn only_unread_paint_counts_as_a_layer_beneath_the_image() {
        let beneath = |background: &str| -> bool {
            let doc = document(&format!(
                "<style>.x {{ background: {background}; }}</style><p class=x>Text</p>"
            ));
            let el = doc.query_selector(".x").expect("element");
            match analyze_level(&el) {
                LevelPaint::Image(layer) => layer.layers_beneath,
                other => panic!("{background}: {other:?}"),
            }
        };
        assert!(!beneath("url(a.png)"));
        assert!(!beneath("url(a.png), none"));
        // The declared color is the element's own, not unknown paint.
        assert!(!beneath("url(a.png), #17150f"));
        assert!(!beneath("url(a.png) no-repeat, rgba(23, 21, 15, 0.9)"));
        assert!(beneath("url(a.png), url(b.png)"));
        assert!(beneath("url(a.png), linear-gradient(#000, #fff)"));
        assert!(beneath("url(a.png), url(b.png), #17150f"));
        assert!(beneath("url(a.png), var(--below)"));
    }

    fn document(html: &str) -> StaticDocument {
        let mut doc = StaticDocument::parse(html);
        let (css, _) =
            collect_static_css_text(&doc, Path::new("/nonexistent"), None, "x.html", None, None);
        build_static_style_map(&mut doc, &css, None, "x.html");
        doc
    }

    /// The two ancestor walks, side by side: the analytic one (`unresolved`)
    /// and the sampled one (an image ground, and whether it sits over an
    /// opaque color).
    fn walks(css: &str) -> (bool, Option<bool>) {
        let doc = document(&format!(
            "<style>{css}</style><section><div class=x><p id=t>Text</p></div></section>"
        ));
        let el = doc.query_selector("#t").expect("text element");
        let levels = LevelCache::default();
        (
            resolve_background_info(&el, None).unresolved,
            find_image_ground(&el, &levels).map(|g| g.over_opaque_color),
        )
    }

    #[test]
    fn the_sampled_walk_finds_an_image_only_where_the_analytic_walk_cannot_see_past_one() {
        // Wherever the analytic walk reports `unresolved` because of a
        // `url()` layer, the sampled walk finds that layer, and nowhere else
        // does it claim one without an opaque color to say so.
        for (css, unresolved, ground) in [
            (".x { background: url(a.png); }", true, Some(false)),
            (
                ".x { background-image: none, url(a.png); }",
                true,
                Some(false),
            ),
            (
                ".x { background: center / cover no-repeat url(a.png); }",
                true,
                Some(false),
            ),
            (
                ".x { background: rgba(0,0,0,.4) url(a.png); }",
                true,
                Some(false),
            ),
            (
                ".x { background: linear-gradient(rgba(0,0,0,.4), rgba(0,0,0,.4)), url(a.png); }",
                true,
                Some(false),
            ),
            (
                "section { background: url(a.png); } .x { background: rgba(0,0,0,.4); }",
                true,
                Some(false),
            ),
            // A scrim, a stop it cannot read, an image function it cannot
            // read: both walks give up.
            (
                ".x { background: linear-gradient(rgba(0,0,0,.8), transparent), url(a.png); }",
                true,
                None,
            ),
            (
                ".x { background: linear-gradient(rgba(0,0,0,.8), rgba(0,0,0,0)), url(a.png); }",
                true,
                None,
            ),
            (
                ".x { background-image: image-set(url(a.png) 1x); }",
                true,
                None,
            ),
            // An opaque color: the analytic walk resolves it. The sampled
            // walk agrees unless an image is painted over that color.
            (".x { background: #111; }", false, None),
            (
                "section { background: url(a.png); } .x { background: #111; }",
                false,
                None,
            ),
            (".x { background: #111 url(a.png); }", false, Some(true)),
            (".x { background: url(a.png) #111; }", false, Some(true)),
            // A color-only shorthand clears the image an earlier rule set.
            (
                ".x { background: url(a.png); } div.x { background: transparent; }",
                false,
                None,
            ),
            // No image anywhere.
            (".x { color: red; }", false, None),
            // A blend the sampler cannot reproduce, a covering pseudo surface,
            // and a wash that does not fill the box all give up.
            (
                ".x { background: #111 url(a.png) center / cover; background-blend-mode: multiply; }",
                false,
                None,
            ),
            (
                "section { background: url(a.png); } .x { mix-blend-mode: multiply; }",
                true,
                None,
            ),
            (
                ".x { background: linear-gradient(rgba(0,0,0,.4), rgba(0,0,0,.4)) 0 0 / 20px 20px no-repeat, url(a.png); }",
                true,
                None,
            ),
            // A `display: contents` box paints nothing: its own image is not
            // a ground, and it does not hide the one behind it.
            (".x { display: contents; background: url(a.png); }", false, None),
            (
                "section { background: url(a.png); } .x { display: contents; background: #111; }",
                true,
                Some(false),
            ),
            // A color as the final layer of the list is the color, in
            // either walk.
            (".x { background: url(a.png), #111; }", false, Some(true)),
        ] {
            assert_eq!(walks(css), (unresolved, ground), "{css}");
        }
    }
}
