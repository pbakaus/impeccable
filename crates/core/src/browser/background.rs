//! Section 4 (`resolveBackground` family) in browser mode
//! (`DETECTOR_IS_BROWSER === true`; the static-only branches — inline
//! `style=""` peeks and customPropMap resolution — are not reachable here
//! and are not ported). See browser/mod.rs.

use super::dom::{style_px, tag_lower, Dom, ElId};
use crate::checks::gradient_geometry::{self as geo, BackgroundLayers, Box2, PaintBox, UnderText};
use crate::color::{
    composite_color_over, is_no_paint_color_value, parse_any_color, parse_gradient_colors,
    parse_rgb, split_top_level_commas, Rgba,
};
use crate::js;
use once_cell::sync::Lazy;
use regex::Regex;

macro_rules! re {
    ($name:ident, $pat:expr) => {
        static $name: Lazy<Regex> = Lazy::new(|| Regex::new(&$pat).expect(stringify!($name)));
    };
}

// JS `/gradient/i`, `/url\s*\(/i`, `/gradient\s*\(/i`, `/^\s*url\s*\(/i`,
// `/^currentcolor$/i`: ASCII case folding (`ci`) and the JS `\s` set (`WS`).
re!(GRADIENT_RE, js::ci("gradient"));
re!(URL_RE, format!("{}{}*\\(", js::ci("url"), js::WS));
re!(GRADIENT_PAREN_RE, format!("{}{}*\\(", js::ci("gradient"), js::WS));
re!(URL_LEADING_RE, format!("^{}*{}{}*\\(", js::WS, js::ci("url"), js::WS));
re!(CURRENTCOLOR_RE, format!("^{}$", js::ci("currentcolor")));

/// JS `{ color, unresolved }` from resolveBackgroundInfo.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct BackgroundInfo {
    pub color: Option<Rgba>,
    pub unresolved: bool,
}

/// The alpha a fill needs before the walk every rule but contrast shares
/// composites it. The contrast walk composites every fill that paints.
const LEGACY_MIN_FILL_ALPHA: f64 = 0.1;

/// JS `parseRgb(x) || parseAnyColor(x)`.
fn parse_rgb_or_any(value: &str) -> Option<Rgba> {
    parse_rgb(Some(value)).or_else(|| parse_any_color(Some(value)))
}

/// JS: checks.mjs#readOwnBackgroundColor(el, computedStyle) — in the browser
/// `DETECTOR_IS_BROWSER` short-circuits before the inline-shorthand peek, so
/// this is the computed-style parse alone.
pub fn read_own_background_color(dom: &dyn Dom, el: ElId) -> Option<Rgba> {
    parse_rgb_or_any(&dom.style(el, "backgroundColor"))
}

/// JS: checks.mjs#readCascadeBackgroundColor(current, style, customPropMap)
/// — browser branch: computed style only.
fn read_cascade_background_color(dom: &dyn Dom, el: ElId) -> Option<Rgba> {
    parse_rgb_or_any(&dom.style(el, "backgroundColor"))
}

/// JS `bg && bg.a > 0.1` — `bg.a` is `undefined` (never for parsed
/// colors, but keep JS `undefined > 0.1 === false`).
fn alpha_gt(bg: &Rgba, t: f64) -> bool {
    match bg.a {
        Some(a) => a > t,
        None => false,
    }
}

/// The surface the contrast check reads text against, with what the walk
/// learned on the way: which box painted it, the translucent fills it
/// composited, and the gradients it found paint nowhere under the text.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct TextSurface {
    pub info: BackgroundInfo,
    /// The gradient read at points inside the text box and flattened over
    /// what sits behind it and under the fills above it.
    pub samples: Option<Vec<Rgba>>,
    /// The box whose gradient is the surface, sampled or not.
    pub gradient_host: Option<ElId>,
    /// The box that ended the walk: the opaque fill or the gradient. `None`
    /// is the canvas.
    pub host: Option<ElId>,
    /// The opaque colour at `host` before the fills above it.
    pub base: Option<Rgba>,
    /// The translucent fills between the text and `host`, innermost first.
    pub overlays: Vec<(ElId, Rgba)>,
    /// Boxes whose gradient layers the walk read as absent because no layer
    /// paints under the text (an underline tile, a faded glow).
    pub skipped_images: Vec<ElId>,
}

struct Query<'a> {
    skip_image: &'a dyn Fn(ElId) -> bool,
    min_fill_alpha: f64,
    /// The text box, for the gradient geometry.
    text: Option<Box2>,
    /// The text's font size, for the size-only coverage test.
    font_size: Option<f64>,
}

fn flatten(overlays: &[(ElId, Rgba)], base: Rgba) -> Rgba {
    let mut acc = base;
    for (_, o) in overlays.iter().rev() {
        acc = composite_color_over(o, &acc);
    }
    acc
}

/// JS: checks.mjs#resolveBackgroundInfo(el, win, customPropMap) in browser mode.
pub fn resolve_background_info(dom: &dyn Dom, el: ElId) -> BackgroundInfo {
    resolve_background_info_skipping_images(dom, el, &|_| false)
}

/// [`resolve_background_info`] with the background images of the boxes
/// `skip_image` names read as `none`. The SAFE_TAGS text path uses it for an
/// icon on the link or its list item: the walk gives up on any raster image,
/// and an external-link mark or an arrow bullet is not the surface the words
/// are read against.
pub fn resolve_background_info_skipping_images(
    dom: &dyn Dom,
    el: ElId,
    skip_image: &dyn Fn(ElId) -> bool,
) -> BackgroundInfo {
    let query = Query {
        skip_image,
        min_fill_alpha: LEGACY_MIN_FILL_ALPHA,
        text: None,
        font_size: None,
    };
    walk_surface(dom, el, &query).info
}

/// The surface under an element's text for the contrast check. It is the
/// shared walk with three differences, each about what a reader sees:
///
/// - every translucent fill that paints is composited, not only those above
///   an alpha of 0.1 (a `bg-primary/10` chip is the chip's colour, not the
///   section's);
/// - a gradient is read where the text sits inside the box that paints it,
///   so a button label is scored against the middle of its button rather
///   than the light rim at its top edge;
/// - a gradient whose tiles paint nowhere under the text (an underline drawn
///   as a 2px gradient, a radial glow that has faded out) is not a
///   background of this text, and the walk continues past it.
///
/// Where the geometry cannot be read, the gradient is the surface the way it
/// always was, and the caller scores its worst stop.
pub fn resolve_text_surface(
    dom: &dyn Dom,
    el: ElId,
    skip_image: &dyn Fn(ElId) -> bool,
    text: Box2,
    font_size: f64,
) -> TextSurface {
    let query = Query {
        skip_image,
        min_fill_alpha: 0.0,
        text: Some(text),
        font_size: Some(font_size),
    };
    walk_surface(dom, el, &query)
}

/// Whether a box generates no box of its own (`display: contents`): it paints
/// no background, so its computed fill describes nothing a reader sees.
/// Framer writes its page root this way with `background-color: #000`, and
/// every slot is `display: contents` by default.
pub fn paints_no_box(dom: &dyn Dom, el: ElId) -> bool {
    js::trim(&dom.style(el, "display")) == "contents"
}

fn walk_surface(dom: &dyn Dom, el: ElId, q: &Query<'_>) -> TextSurface {
    let mut out = TextSurface::default();
    let mut current = Some(el);
    while let Some(cur) = current {
        if paints_no_box(dom, cur) {
            current = dom.flat_parent(cur);
            continue;
        }
        let bg_image = if (q.skip_image)(cur) {
            String::from("none")
        } else {
            dom.style(cur, "backgroundImage")
        };
        let has_gradient_or_url = !bg_image.is_empty()
            && bg_image != "none"
            && (GRADIENT_RE.is_match(&bg_image) || URL_RE.is_match(&bg_image));

        let mut bg = read_cascade_background_color(dom, cur);

        let bg_color_raw = dom.style(cur, "backgroundColor");
        if (bg.is_none() || bg.map_or(false, |b| b.alpha_or_one() < 0.1))
            && CURRENTCOLOR_RE.is_match(js::trim(&bg_color_raw))
        {
            // JS: `bg.a < 0.1` with `a` undefined is false; alpha_or_one keeps
            // that (undefined never < 0.1 → treat as 1).
            let color = dom.style(cur, "color");
            bg = parse_rgb(Some(&color)).or_else(|| parse_any_color(Some(&color)));
        }

        match bg {
            Some(b) if alpha_gt(&b, q.min_fill_alpha) => {
                if b.a.map_or(false, |a| a >= 0.99) {
                    // A gradient on the same box paints over its fill, so
                    // the fill is the surface only where the gradient lets
                    // it show.
                    if has_gradient_or_url {
                        if let Some(painted) = own_gradient_over_fill(dom, cur, &bg_image, &b, q) {
                            return gradient_over_fill_surface(out, cur, painted);
                        }
                    }
                    out.info = BackgroundInfo {
                        color: Some(flatten(&out.overlays, b)),
                        unresolved: false,
                    };
                    out.host = Some(cur);
                    out.base = Some(b);
                    return out;
                }
                out.overlays.push((cur, b));
            }
            None if !is_no_paint_color_value(Some(&bg_color_raw)) => {
                out.info = BackgroundInfo {
                    color: None,
                    unresolved: true,
                };
                out.host = Some(cur);
                return out;
            }
            _ => {}
        }

        if has_gradient_or_url {
            match gradient_under_text(dom, cur, &bg_image, q) {
                Some(UnderText::Misses) => {
                    out.skipped_images.push(cur);
                    current = dom.flat_parent(cur);
                    continue;
                }
                Some(UnderText::Paint(samples)) => {
                    if let Some(flat) = flatten_samples(dom, cur, &samples, &mut out, q) {
                        out.samples = Some(flat);
                        out.gradient_host = Some(cur);
                        out.host = Some(cur);
                        out.info = BackgroundInfo {
                            color: None,
                            unresolved: false,
                        };
                        return out;
                    }
                }
                _ => {}
            }
            out.host = Some(cur);
            let layers = split_top_level_commas(&bg_image);
            let top_paint_layer = layers
                .iter()
                .find(|layer| GRADIENT_PAREN_RE.is_match(layer) || URL_RE.is_match(layer));
            let gradient_on_top = match top_paint_layer {
                Some(layer) => {
                    GRADIENT_PAREN_RE.is_match(layer) && !URL_LEADING_RE.is_match(layer)
                }
                None => false,
            };
            if !gradient_on_top {
                out.info = BackgroundInfo {
                    color: None,
                    unresolved: true,
                };
                return out;
            }
            let top = top_paint_layer.expect("gradient_on_top implies a layer");
            let url_beneath = layers
                .iter()
                .any(|layer| layer != top && URL_RE.is_match(layer));
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
            out.gradient_host = Some(cur);
            out.info = BackgroundInfo {
                color: None,
                unresolved: false,
            };
            return out;
        }
        current = dom.flat_parent(cur);
    }
    let canvas = Rgba::new(255.0, 255.0, 255.0, 1.0);
    out.info = BackgroundInfo {
        color: Some(flatten(&out.overlays, canvas)),
        unresolved: false,
    };
    out.base = Some(canvas);
    out
}

/// How far, on any channel, a gradient has to move an opaque fill under the
/// text before the surface is the gradient and not the fill. Under it a
/// reader sees the fill (a sheen, a vignette that has faded out there), and
/// the fill stays the surface, named and deduped as it always was.
const OWN_GRADIENT_MIN_CHANNEL_DELTA: f64 = 12.0;

/// What the gradient layers of a box with an opaque fill paint under the
/// queried text, flattened over that fill: `background: #8b5cf6
/// linear-gradient(135deg, #6d28d9, #9061f9)` shows the gradient, and the
/// fill nowhere (sona8.com's buttons were scored against the fill, a colour
/// no pixel of them has). `None` keeps the fill as the surface: on the walk
/// every other rule shares, where the layers hold a picture, where no layer
/// paints under the text, where the geometry cannot be read, and where the
/// gradient leaves the fill within [`OWN_GRADIENT_MIN_CHANNEL_DELTA`] at
/// every point under the text.
fn own_gradient_over_fill(dom: &dyn Dom, node: ElId, bg_image: &str, fill: &Rgba, q: &Query<'_>) -> Option<Vec<Rgba>> {
    q.text?;
    // A dot grid or hairline pattern over the fill is texture: the reader
    // sees the fill, and the worst dot is not the ground.
    if super::text_layers::gradient_layers_are_dot_texture(dom, node, bg_image) {
        return None;
    }
    let UnderText::Paint(samples) = gradient_under_text(dom, node, bg_image, q)? else {
        return None;
    };
    let painted: Vec<Rgba> = samples.iter().map(|s| composite_color_over(s, fill)).collect();
    let moved = |c: &Rgba| {
        (c.r - fill.r).abs() >= OWN_GRADIENT_MIN_CHANNEL_DELTA
            || (c.g - fill.g).abs() >= OWN_GRADIENT_MIN_CHANNEL_DELTA
            || (c.b - fill.b).abs() >= OWN_GRADIENT_MIN_CHANNEL_DELTA
    };
    painted.iter().any(moved).then_some(painted)
}

/// The surface of a box whose gradient was read over its own opaque fill
/// ([`own_gradient_over_fill`]): the samples, under the fills above them.
fn gradient_over_fill_surface(mut out: TextSurface, host: ElId, painted: Vec<Rgba>) -> TextSurface {
    out.samples = Some(painted.into_iter().map(|c| flatten(&out.overlays, c)).collect());
    out.gradient_host = Some(host);
    out.host = Some(host);
    out.info = BackgroundInfo {
        color: None,
        unresolved: false,
    };
    out
}

/// What a box's gradient layers paint under the queried text, when the query
/// carries a text box or a font size and the layers are gradients alone.
fn gradient_under_text(dom: &dyn Dom, node: ElId, bg_image: &str, q: &Query<'_>) -> Option<UnderText> {
    if q.text.is_none() && q.font_size.is_none() {
        return None;
    }
    if URL_RE.is_match(bg_image) || !GRADIENT_RE.is_match(bg_image) {
        return None;
    }
    let shorthand = dom.style(node, "background");
    let size = dom.style(node, "backgroundSize");
    if let Some(text) = q.text {
        let rect = dom.rect(node);
        let px = |prop: &str| style_px(dom, node, prop);
        let paint = PaintBox {
            border_box: Box2::new(rect.left, rect.top, rect.width, rect.height),
            border: [
                px("borderTopWidth"),
                px("borderRightWidth"),
                px("borderBottomWidth"),
                px("borderLeftWidth"),
            ],
            padding: [px("paddingTop"), px("paddingRight"), px("paddingBottom"), px("paddingLeft")],
        };
        let layers = BackgroundLayers {
            image: bg_image,
            size: &size,
            position: &dom.style(node, "backgroundPosition"),
            shorthand: &shorthand,
        };
        match geo::gradient_paint_under_text(&layers, &paint, &text) {
            UnderText::Unknown => {}
            known => return Some(known),
        }
    }
    // No geometry to read: what the tile's size and repeat say on their own.
    let font_size = q.font_size?;
    let repeat = geo::repeat_from("", &shorthand);
    geo::gradient_tile_misses_text(&size, repeat, font_size).then_some(UnderText::Misses)
}

/// The sampled gradient flattened the way it paints: each sample over the
/// host's own translucent fill, over whatever sits behind the host, and
/// under the translucent fills between the host and the text. `None` when
/// what sits behind a translucent sample cannot be read, which keeps the
/// worst-stop reading.
fn flatten_samples(
    dom: &dyn Dom,
    host: ElId,
    samples: &[Rgba],
    out: &mut TextSurface,
    q: &Query<'_>,
) -> Option<Vec<Rgba>> {
    let host_fill = match out.overlays.last() {
        Some((n, c)) if *n == host => Some(*c),
        _ => None,
    };
    let canvas = Rgba::new(255.0, 255.0, 255.0, 1.0);
    let translucent = samples.iter().any(|s| s.alpha_or_one() < 0.99);
    let backdrops: Vec<Rgba> = if !translucent {
        vec![canvas; samples.len()]
    } else {
        match dom.flat_parent(host) {
            None => vec![canvas; samples.len()],
            Some(parent) => {
                let behind = walk_surface(dom, parent, q);
                if behind.info.unresolved {
                    return None;
                }
                match (behind.info.color, behind.samples) {
                    (Some(c), _) => vec![c; samples.len()],
                    (None, Some(s)) if s.len() == samples.len() => s,
                    _ => return None,
                }
            }
        }
    };
    let flat: Vec<Rgba> = samples
        .iter()
        .zip(&backdrops)
        .map(|(s, b)| {
            let under = match host_fill {
                Some(f) => geo::over_unrounded(&f, b),
                None => *b,
            };
            composite_color_over(s, &under)
        })
        .collect();
    if host_fill.is_some() {
        out.overlays.pop();
    }
    Some(flat.into_iter().map(|c| flatten(&out.overlays, c)).collect())
}

/// JS: checks.mjs#resolveBackground(el, win, customPropMap)
pub fn resolve_background(dom: &dyn Dom, el: ElId) -> Option<Rgba> {
    resolve_background_info(dom, el).color
}

/// JS: checks.mjs#compositeGradientStops(stops, gradientEl, win, customPropMap)
///
/// `stops` are the stops of every layer in `bg_image`, pooled. Where the box
/// holds one gradient its translucent stops are composited over the ground
/// behind the box, as they always were. Where it holds several, an upper
/// layer's translucent stops lie over the layers below it in the same box,
/// not over that ground ([`layered_gradient_stops`]).
fn composite_gradient_stops(
    dom: &dyn Dom,
    stops: Vec<Rgba>,
    bg_image: &str,
    gradient_el: ElId,
    q: &Query<'_>,
) -> Option<Vec<Rgba>> {
    let has_alpha = stops.iter().any(|s| s.alpha_or_one() < 0.99);
    if !has_alpha {
        return Some(stops);
    }
    let base_el = dom.flat_parent(gradient_el).unwrap_or(gradient_el);
    let base = walk_surface(dom, base_el, q).info.color;
    if let Some(layered) = layered_gradient_stops(bg_image, base) {
        return Some(layered);
    }
    let mut out = Vec::new();
    for s in stops {
        let a = s.alpha_or_one();
        if a >= 0.99 {
            out.push(s);
            continue;
        }
        if let Some(b) = base {
            out.push(composite_color_over(&s, &b));
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

/// The most colours [`layered_gradient_stops`] carries from one layer to the
/// next; a box past it keeps the pooled reading.
const LAYERED_STOPS_MAX: usize = 48;

/// Every colour the gradient layers of one box can show, read bottom layer
/// up: an opaque stop is itself, and a translucent one is composited over
/// each colour the layers below it can show (over `ground`, behind the box,
/// for the bottom layer). wotsthat.com's avatar is a translucent radial
/// highlight (`rgba(255, 255, 255, 0.3)` to clear) over an opaque pastel
/// conic gradient; pooled, the highlight's clear stop was composited over
/// the dark page behind the avatar and dark initials read 1.1:1 against a
/// colour the avatar never shows.
///
/// A layer whose stops are all opaque may be a tile that leaves the layers
/// below showing around it, so their colours stay in the set. `None` (the
/// pooled reading) for a single layer, for a set past
/// [`LAYERED_STOPS_MAX`], and where nothing can be said.
fn layered_gradient_stops(bg_image: &str, ground: Option<Rgba>) -> Option<Vec<Rgba>> {
    let layers: Vec<Vec<Rgba>> = split_top_level_commas(bg_image)
        .iter()
        .map(|layer| parse_gradient_colors(Some(layer)))
        .filter(|stops| !stops.is_empty())
        .collect();
    if layers.len() < 2 {
        return None;
    }
    let push = |set: &mut Vec<Rgba>, c: Rgba| {
        if !set.iter().any(|k| k.r == c.r && k.g == c.g && k.b == c.b) {
            set.push(c);
        }
    };
    let mut visible: Vec<Rgba> = Vec::new();
    for (i, stops) in layers.iter().enumerate().rev() {
        let bottom = i == layers.len() - 1;
        let below: Vec<Rgba> = if bottom { ground.into_iter().collect() } else { visible.clone() };
        let opaque_layer = stops.iter().all(|s| s.alpha_or_one() >= 0.99);
        let mut next: Vec<Rgba> = if opaque_layer { visible.clone() } else { Vec::new() };
        for s in stops {
            if s.alpha_or_one() >= 0.99 {
                push(&mut next, *s);
            } else {
                for b in &below {
                    push(&mut next, composite_color_over(s, b));
                }
            }
        }
        if next.len() > LAYERED_STOPS_MAX {
            return None;
        }
        // A translucent layer over ground that could not be read shows
        // nothing this can name; the layers above it are read over what the
        // box is known to show.
        if !next.is_empty() {
            visible = next;
        }
    }
    (!visible.is_empty()).then_some(visible)
}

/// JS: checks.mjs#resolveGradientStops(el, win, customPropMap) in browser mode.
pub fn resolve_gradient_stops(dom: &dyn Dom, el: ElId) -> Option<Vec<Rgba>> {
    let query = Query {
        skip_image: &|_| false,
        min_fill_alpha: LEGACY_MIN_FILL_ALPHA,
        text: None,
        font_size: None,
    };
    gradient_stops_walk(dom, el, &query)
}

/// Every stop of the gradient a contrast surface walk stopped on, for text
/// whose position on it could not be read: the stops walk with the contrast
/// walk's fill threshold, reading the gradients it skipped as absent.
pub fn resolve_text_gradient_stops(dom: &dyn Dom, el: ElId, surface: &TextSurface) -> Option<Vec<Rgba>> {
    let skipped = |n: ElId| surface.skipped_images.contains(&n);
    let query = Query {
        skip_image: &skipped,
        min_fill_alpha: 0.0,
        text: None,
        font_size: None,
    };
    gradient_stops_walk(dom, el, &query)
}

fn gradient_stops_walk(dom: &dyn Dom, el: ElId, q: &Query<'_>) -> Option<Vec<Rgba>> {
    let mut current = Some(el);
    let mut overlays: Vec<(ElId, Rgba)> = Vec::new();
    while let Some(cur) = current {
        if paints_no_box(dom, cur) {
            current = dom.flat_parent(cur);
            continue;
        }
        let bg_image = if (q.skip_image)(cur) {
            String::from("none")
        } else {
            dom.style(cur, "backgroundImage")
        };
        if !bg_image.is_empty() && bg_image != "none" && URL_RE.is_match(&bg_image) {
            return None;
        }
        let mut stops: Option<Vec<Rgba>> = None;
        if !bg_image.is_empty() && bg_image != "none" && GRADIENT_RE.is_match(&bg_image) {
            let parsed = parse_gradient_colors(Some(&bg_image));
            if !parsed.is_empty() {
                stops = Some(parsed);
            }
        }
        if let Some(stops) = stops {
            let composited = composite_gradient_stops(dom, stops, &bg_image, cur, q);
            let Some(composited) = composited else { return None };
            if overlays.is_empty() {
                return Some(composited);
            }
            return Some(composited.into_iter().map(|stop| flatten(&overlays, stop)).collect());
        }
        let bg = read_cascade_background_color(dom, cur);
        if let Some(b) = bg {
            if alpha_gt(&b, q.min_fill_alpha) {
                if b.a.map_or(false, |a| a >= 0.99) {
                    return None;
                }
                overlays.push((cur, b));
            }
        }
        current = dom.flat_parent(cur);
    }
    None
}

/// A short name for the box that painted a surface, for a snippet: the tag
/// with its id, else with its first class.
pub fn surface_label(dom: &dyn Dom, el: ElId) -> String {
    let tag = tag_lower(dom, el);
    let id = dom.attr(el, "id").unwrap_or_default();
    let id = js::trim(&id);
    if !id.is_empty() && !id.chars().any(|c| c.is_ascii_whitespace()) {
        return format!("{tag}#{id}");
    }
    let class = dom.attr(el, "class").unwrap_or_default();
    match class.split_ascii_whitespace().next() {
        Some(first) => format!("{tag}.{first}"),
        None => tag,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::browser::fake_dom::FakeDom;

    #[test]
    fn opaque_ancestor_wins_and_translucent_overlays_flatten() {
        let mut d = FakeDom::new();
        let (html, body) = d.with_page();
        d.set_style(html, "backgroundColor", "rgba(0, 0, 0, 0)");
        d.set_style(html, "backgroundImage", "none");
        d.set_style(body, "backgroundColor", "rgb(0, 0, 0)");
        d.set_style(body, "backgroundImage", "none");
        let card = d.add(Some(body), "div");
        d.set_style(card, "backgroundColor", "rgba(255, 255, 255, 0.5)");
        d.set_style(card, "backgroundImage", "none");
        let info = resolve_background_info(&d, card);
        assert!(!info.unresolved);
        assert_eq!(info.color, Some(Rgba::new(128.0, 128.0, 128.0, 1.0)));
    }

    #[test]
    fn transparent_chain_falls_back_to_white_and_url_layer_abstains() {
        let mut d = FakeDom::new();
        let (html, body) = d.with_page();
        for e in [html, body] {
            d.set_style(e, "backgroundColor", "rgba(0, 0, 0, 0)");
            d.set_style(e, "backgroundImage", "none");
        }
        let p = d.add(Some(body), "p");
        d.set_style(p, "backgroundColor", "rgba(0, 0, 0, 0)");
        d.set_style(p, "backgroundImage", "none");
        assert_eq!(resolve_background(&d, p), Some(Rgba::new(255.0, 255.0, 255.0, 1.0)));
        d.set_style(body, "backgroundImage", "url(\"photo.png\")");
        let info = resolve_background_info(&d, p);
        assert!(info.unresolved && info.color.is_none());
    }

    #[test]
    fn gradient_on_top_yields_stops_and_unparseable_color_abstains() {
        let mut d = FakeDom::new();
        let (html, body) = d.with_page();
        d.set_style(html, "backgroundColor", "rgba(0, 0, 0, 0)");
        d.set_style(html, "backgroundImage", "none");
        d.set_style(body, "backgroundColor", "rgba(0, 0, 0, 0)");
        d.set_style(body, "backgroundImage", "linear-gradient(rgb(10, 20, 30), rgb(40, 50, 60))");
        let p = d.add(Some(body), "p");
        d.set_style(p, "backgroundColor", "rgba(0, 0, 0, 0)");
        d.set_style(p, "backgroundImage", "none");
        let info = resolve_background_info(&d, p);
        assert!(!info.unresolved && info.color.is_none());
        let stops = resolve_gradient_stops(&d, p).unwrap();
        assert_eq!(stops.len(), 2);
        assert_eq!(stops[0], Rgba::new(10.0, 20.0, 30.0, 1.0));
        d.set_style(p, "backgroundColor", "color(display-p3 1 0 0 / 0.5)");
        // JS parseAnyColor may or may not read display-p3; whatever it does,
        // an unreadable, non-no-paint value abstains.
        let info = resolve_background_info(&d, p);
        if parse_any_color(Some("color(display-p3 1 0 0 / 0.5)")).is_none() {
            assert!(info.unresolved);
        }
    }

    #[test]
    fn currentcolor_background_paints_with_text_color() {
        let mut d = FakeDom::new();
        let (html, body) = d.with_page();
        for e in [html, body] {
            d.set_style(e, "backgroundColor", "rgba(0, 0, 0, 0)");
            d.set_style(e, "backgroundImage", "none");
        }
        let chip = d.add(Some(body), "span");
        d.set_style(chip, "backgroundColor", "currentcolor");
        d.set_style(chip, "backgroundImage", "none");
        d.set_style(chip, "color", "rgb(1, 2, 3)");
        assert_eq!(resolve_background(&d, chip), Some(Rgba::new(1.0, 2.0, 3.0, 1.0)));
    }

    fn clear(d: &mut FakeDom, el: ElId) {
        d.set_style(el, "backgroundColor", "rgba(0, 0, 0, 0)");
        d.set_style(el, "backgroundImage", "none");
    }

    #[test]
    fn the_contrast_walk_composites_a_faint_tint_the_shared_walk_skips() {
        let mut d = FakeDom::new();
        let (html, body) = d.with_page();
        clear(&mut d, html);
        d.set_style(body, "backgroundColor", "rgb(255, 255, 255)");
        d.set_style(body, "backgroundImage", "none");
        let chip = d.add(Some(body), "button");
        d.set_style(chip, "backgroundColor", "rgba(243, 123, 46, 0.1)");
        d.set_style(chip, "backgroundImage", "none");
        assert_eq!(resolve_background(&d, chip), Some(Rgba::new(255.0, 255.0, 255.0, 1.0)));
        let s = resolve_text_surface(&d, chip, &|_| false, Box2::new(0.0, 0.0, 40.0, 16.0), 14.0);
        assert_eq!(s.info.color, Some(Rgba::new(254.0, 242.0, 234.0, 1.0)));
        assert_eq!(s.host, Some(body));
        assert_eq!(s.overlays, vec![(chip, Rgba::new(243.0, 123.0, 46.0, 0.1))]);
    }

    #[test]
    fn a_gradient_is_sampled_under_the_text_and_an_underline_tile_is_skipped() {
        let mut d = FakeDom::new();
        let (html, body) = d.with_page();
        clear(&mut d, html);
        d.set_style(body, "backgroundColor", "rgb(255, 255, 255)");
        d.set_style(body, "backgroundImage", "none");
        let button = d.add(Some(body), "a");
        let image = "linear-gradient(rgb(255, 255, 255) 0%, rgb(0, 0, 0) 100%)";
        d.set_styles(
            button,
            &[
                ("backgroundColor", "rgba(0, 0, 0, 0)"),
                ("backgroundImage", image),
                ("backgroundSize", "auto"),
                ("backgroundPosition", "0% 0%"),
                ("background", &format!("rgba(0, 0, 0, 0) {image} repeat scroll 0% 0% / auto padding-box border-box")),
            ],
        );
        d.set_rect(button, 0.0, 0.0, 100.0, 60.0);
        // Text in the lower half only ever sees the dark half.
        let s = resolve_text_surface(&d, button, &|_| false, Box2::new(10.0, 36.0, 80.0, 18.0), 14.0);
        let samples = s.samples.expect("samples");
        assert!(samples.iter().all(|c| c.r < 110.0), "{samples:?}");
        assert_eq!(s.gradient_host, Some(button));
        // An empty text box keeps the worst-stop reading.
        let s = resolve_text_surface(&d, button, &|_| false, Box2::new(0.0, 0.0, 0.0, 0.0), 14.0);
        assert!(s.samples.is_none() && s.gradient_host == Some(button));
        assert_eq!(resolve_text_gradient_stops(&d, button, &s).map(|v| v.len()), Some(2));

        let link = d.add(Some(body), "a");
        let rule = "linear-gradient(rgb(0, 0, 0), rgb(0, 0, 0))";
        d.set_styles(
            link,
            &[
                ("backgroundColor", "rgba(0, 0, 0, 0)"),
                ("backgroundImage", rule),
                ("backgroundSize", "0% 2px"),
                ("backgroundPosition", "0% 100%"),
                ("background", &format!("rgba(0, 0, 0, 0) {rule} no-repeat scroll 0% 100% / 0% 2px padding-box border-box")),
            ],
        );
        d.set_rect(link, 0.0, 100.0, 110.0, 31.0);
        let s = resolve_text_surface(&d, link, &|_| false, Box2::new(10.0, 106.0, 90.0, 19.0), 14.0);
        assert_eq!(s.info.color, Some(Rgba::new(255.0, 255.0, 255.0, 1.0)));
        assert_eq!(s.skipped_images, vec![link]);
        // Without a text box the size alone says the same.
        let s = resolve_text_surface(&d, link, &|_| false, Box2::new(0.0, 0.0, 0.0, 0.0), 14.0);
        assert_eq!(s.skipped_images, vec![link]);
    }

    /// sona8.com: `background: #8b5cf6 linear-gradient(135deg, #6d28d9,
    /// #9061f9)`. The gradient paints over the fill.
    #[test]
    fn a_gradient_over_the_same_boxs_opaque_fill_is_the_surface() {
        let mut d = FakeDom::new();
        let (html, body) = d.with_page();
        clear(&mut d, html);
        d.set_style(body, "backgroundColor", "rgb(255, 255, 255)");
        d.set_style(body, "backgroundImage", "none");
        let button = d.add(Some(body), "a");
        let paint = |d: &mut FakeDom, fill: &str, image: &str| {
            d.set_styles(
                button,
                &[
                    ("backgroundColor", fill),
                    ("backgroundImage", image),
                    ("backgroundSize", "auto"),
                    ("backgroundPosition", "0% 0%"),
                    ("background", &format!("{fill} {image} repeat scroll 0% 0% / auto padding-box border-box")),
                ],
            );
        };
        d.set_rect(button, 0.0, 0.0, 110.0, 40.0);
        let text = Box2::new(16.0, 10.0, 78.0, 20.0);
        paint(&mut d, "rgb(196, 181, 253)", "linear-gradient(135deg, rgb(91, 33, 182) 0%, rgb(109, 40, 217) 100%)");
        let s = resolve_text_surface(&d, button, &|_| false, text, 14.0);
        let samples = s.samples.expect("the gradient is sampled");
        assert!(samples.iter().all(|c| c.r < 115.0 && c.alpha_or_one() == 1.0), "{samples:?}");
        assert_eq!((s.gradient_host, s.host, s.info.color), (Some(button), Some(button), None));
        // The walk every other rule shares still reads the fill.
        assert_eq!(resolve_background(&d, button), Some(Rgba::new(196.0, 181.0, 253.0, 1.0)));

        // A translucent sheen is read over the fill, not over the page.
        paint(&mut d, "rgb(30, 58, 138)", "linear-gradient(rgba(255, 255, 255, 0.5), rgba(255, 255, 255, 0.5))");
        let s = resolve_text_surface(&d, button, &|_| false, text, 14.0);
        assert_eq!(s.samples.as_deref().and_then(|v| v.first()).copied(), Some(Rgba::new(143.0, 157.0, 197.0, 1.0)));

        // One that leaves the fill within a reader's tolerance keeps the
        // fill, named as it always was.
        paint(&mut d, "rgb(30, 58, 138)", "linear-gradient(rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0))");
        let s = resolve_text_surface(&d, button, &|_| false, text, 14.0);
        assert_eq!(s.info.color, Some(Rgba::new(30.0, 58.0, 138.0, 1.0)));
        assert!(s.samples.is_none() && s.gradient_host.is_none() && s.base.is_some());

        // So does one whose geometry cannot be read.
        paint(&mut d, "rgb(196, 181, 253)", "conic-gradient(rgb(91, 33, 182), rgb(109, 40, 217))");
        let s = resolve_text_surface(&d, button, &|_| false, text, 14.0);
        assert_eq!(s.info.color, Some(Rgba::new(196.0, 181.0, 253.0, 1.0)));
    }

    /// observations-1010 row 8, spacesheep.dev 10137895: the body draws a
    /// 1px dot every 24px over its fill, and the grey label was scored on
    /// the dot, 3.8:1. The reader sees the fill.
    #[test]
    fn a_dot_grid_over_the_boxs_fill_is_texture() {
        let mut d = FakeDom::new();
        let (html, body) = d.with_page();
        clear(&mut d, html);
        let paint = |d: &mut FakeDom, image: &str, size: &str| {
            d.set_styles(
                body,
                &[
                    ("backgroundColor", "rgb(248, 247, 244)"),
                    ("backgroundImage", image),
                    ("backgroundSize", size),
                    ("backgroundPosition", "0% 0%"),
                    ("background", &format!("rgb(248, 247, 244) {image} repeat scroll 0% 0% / {size} padding-box border-box")),
                ],
            );
        };
        d.set_rect(body, 0.0, 0.0, 1280.0, 2000.0);
        let label = d.add(Some(body), "span");
        d.set_style(label, "backgroundColor", "rgba(0, 0, 0, 0)");
        d.set_style(label, "backgroundImage", "none");
        let text = Box2::new(0.0, 0.0, 200.0, 20.0);
        let fill = Some(Rgba::new(248.0, 247.0, 244.0, 1.0));
        paint(&mut d, "radial-gradient(circle, rgba(26, 26, 31, 0.13) 1px, rgba(0, 0, 0, 0) 1.4px)", "24px 24px");
        let s = resolve_text_surface(&d, label, &|_| false, text, 14.0);
        assert_eq!((s.info.color, s.samples.is_none()), (fill, true), "{:?}", s.samples);
        // Twin: opaque stripes in the same cells are a surface, sampled.
        paint(&mut d, "linear-gradient(90deg, rgb(227, 226, 224) 50%, rgb(248, 247, 244) 50%)", "24px 24px");
        let s = resolve_text_surface(&d, label, &|_| false, text, 14.0);
        assert!(s.samples.is_some_and(|v| v.contains(&Rgba::new(227.0, 226.0, 224.0, 1.0))), "{:?}", s.info);
        // Dots in cells larger than a pattern, and grid lines (juskoe.vercel.app's
        // `bg-grid`), are read as before.
        let dots = |d: &FakeDom| super::super::text_layers::gradient_layers_are_dot_texture(d, body, &d.style(body, "backgroundImage"));
        paint(&mut d, "radial-gradient(circle, rgba(26, 26, 31, 0.6) 1px, rgba(0, 0, 0, 0) 1.4px)", "120px 120px");
        assert!(!dots(&d));
        // The capture's own serialisation of spacesheep's dot is one.
        paint(&mut d, "radial-gradient(circle, color(srgb 0.101961 0.101961 0.121569 / 0.13) 1px, rgba(0, 0, 0, 0) 1.4px)", "24px 24px");
        assert!(dots(&d));
        // Twins: a mesh of pinholes (clear centre, black outside) and a dense
        // halftone (3px dots in 7px cells, 58% of the cell) are surfaces.
        paint(&mut d, "radial-gradient(circle, rgba(0, 0, 0, 0) 1px, rgb(17, 17, 17) 1.5px)", "4px 4px");
        assert!(!dots(&d));
        paint(&mut d, "radial-gradient(circle, rgb(34, 34, 34) 3px, rgba(0, 0, 0, 0) 3px)", "7px 7px");
        assert!(!dots(&d));
        // The default shape with a spaced colour first, in a square cell, is
        // a circle too (#1201 review).
        paint(&mut d, "radial-gradient(rgba(26, 26, 31, 0.13) 1px, rgba(0, 0, 0, 0) 1.4px)", "24px 24px");
        assert!(dots(&d));
        // A coloured stop placed before an earlier one does not shrink the dot
        // (#1201 review): a 12px dot in 24px cells is dense.
        paint(&mut d, "radial-gradient(circle, rgb(17, 17, 17) 12px, rgb(34, 34, 34) 1px, rgba(0, 0, 0, 0) 1.4px)", "24px 24px");
        assert!(!dots(&d));
        // Four sparse layers offset across one cell are one dense pattern
        // (#1201 review): about 44% together.
        let dot = "radial-gradient(circle, rgb(34, 34, 34) 3px, rgba(0, 0, 0, 0) 3px)";
        paint(&mut d, &[dot; 4].join(", "), "16px 16px");
        assert!(!dots(&d));
        // An ellipse is not read as a circle's area (#1201 review).
        paint(&mut d, "radial-gradient(4px 32px, rgb(17, 17, 17) 3px, rgba(0, 0, 0, 0) 3px)", "8px 64px");
        assert!(!dots(&d));
        let s = resolve_text_surface(&d, label, &|_| false, text, 14.0);
        assert!(s.samples.is_some(), "{:?}", s.info);
        paint(
            &mut d,
            "linear-gradient(rgba(124, 58, 237, 0.12) 1px, rgba(0, 0, 0, 0) 1px), linear-gradient(90deg, rgba(124, 58, 237, 0.12) 1px, rgba(0, 0, 0, 0) 1px)",
            "48px 48px",
        );
        assert!(!dots(&d));
    }

    /// wotsthat.com: a translucent highlight over an opaque pastel wheel, on
    /// a dark page.
    #[test]
    fn an_upper_gradient_layer_is_composited_over_the_layers_below_it() {
        let mut d = FakeDom::new();
        let (html, body) = d.with_page();
        clear(&mut d, html);
        d.set_style(body, "backgroundColor", "rgb(19, 22, 42)");
        d.set_style(body, "backgroundImage", "none");
        let avatar = d.add(Some(body), "span");
        d.set_style(avatar, "backgroundColor", "rgba(0, 0, 0, 0)");
        d.set_style(
            avatar,
            "backgroundImage",
            "radial-gradient(circle at 30% 25%, rgba(255, 255, 255, 0.3) 0%, rgba(0, 0, 0, 0) 45%), conic-gradient(rgb(163, 230, 53) 0deg, rgb(45, 212, 191) 85deg, rgb(167, 139, 250) 180deg, rgb(163, 230, 53) 360deg)",
        );
        let stops = resolve_gradient_stops(&d, avatar).expect("stops");
        // The wheel's three colours, and each under the highlight. The clear
        // stop shows the wheel, never the page behind the avatar.
        assert_eq!(stops.len(), 6, "{stops:?}");
        assert!(stops.contains(&Rgba::new(163.0, 230.0, 53.0, 1.0)));
        assert!(stops.contains(&Rgba::new(191.0, 238.0, 114.0, 1.0)));
        assert!(stops.iter().all(|c| c.g > 130.0), "{stops:?}");

        // One layer is composited over the ground behind the box, as before.
        d.set_style(avatar, "backgroundImage", "linear-gradient(rgba(255, 255, 255, 0.5), rgba(0, 0, 0, 0))");
        let stops = resolve_gradient_stops(&d, avatar).expect("stops");
        assert_eq!(stops, vec![Rgba::new(137.0, 139.0, 149.0, 1.0), Rgba::new(19.0, 22.0, 42.0, 1.0)]);

        // Opaque layers alone are pooled, as before.
        d.set_style(
            avatar,
            "backgroundImage",
            "linear-gradient(rgb(1, 2, 3), rgb(4, 5, 6)), linear-gradient(rgb(7, 8, 9), rgb(10, 11, 12))",
        );
        assert_eq!(resolve_gradient_stops(&d, avatar).map(|v| v.len()), Some(4));
    }

    #[test]
    fn surface_labels_are_short() {
        let mut d = FakeDom::new();
        let (_, body) = d.with_page();
        let a = d.add(Some(body), "a");
        d.set_attr(a, "class", "primary button-lg");
        assert_eq!(surface_label(&d, a), "a.primary");
        d.set_attr(a, "id", "cta");
        assert_eq!(surface_label(&d, a), "a#cta");
        let s = d.add(Some(body), "section");
        assert_eq!(surface_label(&d, s), "section");
    }

    #[test]
    fn a_contents_box_paints_no_surface() {
        // Framer's page root: `display: contents` with `background-color: #000`.
        let mut d = FakeDom::new();
        let (html, body) = d.with_page();
        clear(&mut d, html);
        d.set_style(body, "backgroundColor", "rgb(255, 255, 255)");
        d.set_style(body, "backgroundImage", "none");
        let root = d.add(Some(body), "div");
        d.set_styles(root, &[("display", "contents"), ("backgroundColor", "rgb(0, 0, 0)"), ("backgroundImage", "none")]);
        let p = d.add(Some(root), "p");
        clear(&mut d, p);
        let s = resolve_text_surface(&d, p, &|_| false, Box2::new(0.0, 0.0, 200.0, 20.0), 16.0);
        assert_eq!(s.info.color, Some(Rgba::new(255.0, 255.0, 255.0, 1.0)));
        assert_eq!(s.host, Some(body));
        assert_eq!(resolve_background(&d, p), Some(Rgba::new(255.0, 255.0, 255.0, 1.0)));
        d.set_style(root, "display", "block");
        assert_eq!(resolve_background(&d, p), Some(Rgba::new(0.0, 0.0, 0.0, 1.0)));
    }

    #[test]
    fn the_walk_reads_a_fill_inside_a_shadow_tree() {
        let mut d = FakeDom::new();
        let (html, body) = d.with_page();
        clear(&mut d, html);
        d.set_style(body, "backgroundColor", "rgb(255, 255, 255)");
        d.set_style(body, "backgroundImage", "none");
        let host = d.add(Some(body), "tcg-promo");
        clear(&mut d, host);
        let band = d.add_shadow_child(host, "div");
        d.set_styles(band, &[("backgroundColor", "rgb(11, 58, 102)"), ("backgroundImage", "none")]);
        let slot = d.add(Some(band), "slot");
        d.set_styles(slot, &[("display", "contents"), ("backgroundColor", "rgba(0, 0, 0, 0)"), ("backgroundImage", "none")]);
        let h3 = d.add(Some(host), "h3");
        clear(&mut d, h3);
        assert_eq!(resolve_background(&d, h3), Some(Rgba::new(255.0, 255.0, 255.0, 1.0)));
        d.set_assigned_slot(h3, slot);
        assert_eq!(resolve_background(&d, h3), Some(Rgba::new(11.0, 58.0, 102.0, 1.0)));
        // Document queries never reach the shadow tree.
        assert!(!d.query_all(None, "*").unwrap().contains(&band));
    }
}
