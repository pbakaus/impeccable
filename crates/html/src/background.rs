//! Section 4 of `cli/engine/rules/checks.mjs`: the unified background walk
//! (`readOwnBackgroundColor`, `readCascadeBackgroundColor`,
//! `resolveBackgroundInfo`, `resolveBackground`, `resolveGradientStops`,
//! `compositeGradientStops`, `resolveBorderRadiusPx`), static-engine
//! branches only (`DETECTOR_IS_BROWSER === false`).

use crate::cascade::StyleValues;
use crate::dom::StaticElement;
use ego_tree::NodeId;
use impeccable_core::checks::gradient_geometry as geo;
use impeccable_core::checks::measures::{
    parse_color_resolved, parse_radius_corner_px_em, parse_radius_corners_em, parse_radius_to_px,
    parse_radius_token_px, CustomProps, ROOT_FONT_SIZE_PX,
};
use impeccable_core::checks::rules::Corners;
use impeccable_core::color::{
    composite_color_over, is_no_paint_color_value, parse_any_color, parse_gradient_colors,
    parse_rgb, split_top_level_commas, Rgba,
};
use impeccable_core::js;
use once_cell::sync::Lazy;
use regex::Regex;

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
fn paints_no_box(style: &StyleValues) -> bool {
    js::to_lower_case(js::trim(sv(style, "display"))) == "contents"
}

fn flatten(overlays: &[(NodeId, Rgba)], base: Rgba) -> Rgba {
    let mut acc = base;
    for (_, o) in overlays.iter().rev() {
        acc = composite_color_over(o, &acc);
    }
    acc
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
pub(crate) fn gradient_tile_misses(style: &StyleValues, bg_image: &str, font_size: f64) -> bool {
    if !GRADIENT_RE.is_match(bg_image) || URL_CALL_RE.is_match(bg_image) {
        return false;
    }
    let first_layer = split_top_level_commas(bg_image).into_iter().next().unwrap_or_default();
    let size = match js::trim(sv(style, "backgroundSize")) {
        "" => geo::parse_shorthand_layer(&first_layer).size.unwrap_or_default(),
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

        let mut bg = read_cascade_background_color(&cur, style, custom_props);

        if (bg.is_none() || bg.as_ref().is_some_and(|c| a_lt(c, 0.1)))
            && CURRENTCOLOR_RE.is_match(js::trim(sv(style, "backgroundColor")))
        {
            let color = sv_opt(style, "color");
            bg = parse_rgb(color).or_else(|| parse_color_resolved(color, custom_props));
        }

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
            if q.font_size.is_some_and(|f| gradient_tile_misses(style, bg_image, f)) {
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
        let bg_image = if skipped { "none" } else { sv(style, "backgroundImage") };
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
