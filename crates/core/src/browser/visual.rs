//! Visual-contrast decisions from `cli/engine/browser/injected/index.mjs`
//! (see browser/mod.rs). The async pixel sampling (Image loading, canvas
//! draws, scrollIntoView, paint waits) stays in `browser-bundle/35-visual.js`
//! and calls into these through the `vc_*` wasm exports; every threshold,
//! result string, and computation of that subsystem lives here.

#![allow(unused_imports)]

use super::dom::{
    closest_or_none, direct_text, pf0, safe_id, style_px, tag_lower, Dom, ElId, Rect,
};
use super::element_checks::{parse_rgb_or_any, DISABLED_CONTROL_SELECTOR};
use super::painted::{unpainted_for, PaintGate};
use crate::checks::rules::{
    is_emoji_only_text, is_glyph_only_text, text_fill_is_transparent, TRANSPARENT_INK_FLOOR,
};
use crate::color::{contrast_ratio, parse_gradient_colors, parse_rgb, split_top_level_commas, Rgba};
use impeccable_foundation::css::measures::{data_svg_intrinsic_size, ICON_MAX_PX};
use crate::constants::{SAFE_TAGS, WCAG_LARGE_BOLD_TEXT_PX, WCAG_LARGE_TEXT_PX};
use crate::js::{self, math_max, math_min, math_round, number_to_string, parse_float, parse_int, to_fixed, WS};
use crate::js_ext_a::{num_truthy, split_ws};
use crate::js_ext_b::{slice_utf16_prefix, utf16_len};
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

/// The plans and rects this subsystem passes around are shared; re-exported
/// so `browser::visual` stays one path.
pub use impeccable_foundation::browser::visual::*;

macro_rules! re {
    ($name:ident, $pat:expr) => {
        static $name: Lazy<Regex> = Lazy::new(|| Regex::new(&$pat).expect(stringify!($name)));
    };
}

// JS `/url\s*\(/i`, `/gradient/i`, `/url\((?:"([^"]+)"|'([^']+)'|([^)]*))\)/i`,
// `/taint|cross-origin|Security/i`: ASCII folding (`ci`), JS `\s` (`WS`).
re!(URL_RE, format!("{}{}*\\(", js::ci("url"), WS));
re!(GRADIENT_RE, js::ci("gradient"));
re!(WS_RUN, format!("{}+", WS));
re!(
    FIRST_CSS_URL_RE,
    format!(r#"{}\((?:"([^"]+)"|'([^']+)'|([^)]*))\)"#, js::ci("url"))
);
re!(PCT_END, "%$");
re!(PX_END, "px$");
re!(
    TAINT_RE,
    format!("{}|{}|{}", js::ci("taint"), js::ci("cross-origin"), js::ci("security"))
);

pub const OVERLAY_SELECTOR: &str =
    ".impeccable-overlay, .impeccable-label, .impeccable-banner, .impeccable-tooltip";
pub const LIVE_SELECTOR: &str = "[id^=\"impeccable-live-\"]";
/// The reason a stacked gradient is left to the screenshot check.
const STACKED_GRADIENTS: &str = "stacked gradients need screenshot pixels";

/// JS `s.replace(/\s+/g, ' ')`.
fn collapse_ws(s: &str) -> String {
    WS_RUN.replace_all(s, " ").into_owned()
}

/// JS `String(v || '')` on a JSON value.
fn str_or_empty(v: Option<&Value>) -> String {
    match v {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => {
            let f = n.as_f64().unwrap_or(f64::NAN);
            if num_truthy(f) {
                number_to_string(f)
            } else {
                String::new()
            }
        }
        Some(Value::Bool(true)) => "true".into(),
        _ => String::new(),
    }
}

fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().map_or(false, num_truthy),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

fn rgba_from_value(v: Option<&Value>) -> Option<Rgba> {
    match v {
        Some(Value::Object(_)) => serde_json::from_value(v.unwrap().clone()).ok(),
        _ => None,
    }
}

fn rgba_value(c: Option<&Rgba>) -> Value {
    match c {
        Some(c) => serde_json::to_value(c).unwrap_or(Value::Null),
        None => Value::Null,
    }
}

// ─── candidates ─────────────────────────────────────────────────────────────

/// JS: index.mjs#collectVisualContrastReasons(el, style)
pub fn collect_visual_contrast_reasons(dom: &dyn Dom, el: ElId) -> Vec<String> {
    let mut reasons: Vec<String> = Vec::new();
    let add = |reasons: &mut Vec<String>, r: &str| {
        if !reasons.iter().any(|x| x == r) {
            reasons.push(r.to_string());
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
    let own_bg_image = dom.style(el, "backgroundImage");
    if bg_clip == "text" && !own_bg_image.is_empty() && own_bg_image != "none" {
        add(&mut reasons, "background-clip text");
    }
    let text_shadow = dom.style(el, "textShadow");
    if !text_shadow.is_empty() && text_shadow != "none" {
        add(&mut reasons, "text shadow");
    }

    let mut current = Some(el);
    while let Some(cur) = current {
        // A `display: contents` box paints nothing (Framer's page root at
        // `#000`), so its fill neither ends the walk nor adds a reason.
        if super::background::paints_no_box(dom, cur) {
            current = dom.flat_parent(cur);
            continue;
        }
        let tag = tag_lower(dom, cur);
        let bg_image = dom.style(cur, "backgroundImage");
        let is_document_surface = tag == "body" || tag == "html";
        if !is_document_surface && !bg_image.is_empty() && bg_image != "none" {
            if URL_RE.is_match(&bg_image) {
                add(&mut reasons, "image background");
            }
            if GRADIENT_RE.is_match(&bg_image) {
                add(&mut reasons, "gradient background");
            }
        }
        if parse_float(&dom.style(cur, "opacity")) < 0.99 {
            add(&mut reasons, "opacity stack");
        }
        let mix = dom.style(cur, "mixBlendMode");
        if !mix.is_empty() && mix != "normal" {
            add(&mut reasons, "blend mode");
        }
        let filter = dom.style(cur, "filter");
        if !filter.is_empty() && filter != "none" {
            add(&mut reasons, "filter");
        }
        let solid_bg = parse_rgb_or_any(&dom.style(cur, "backgroundColor"))
            // JS `solidBg.a >= 0.95` (parseRgb always sets a).
            .filter(|bg| bg.a.unwrap_or(f64::NAN) >= 0.95 && (bg_image.is_empty() || bg_image == "none"));
        // A box whose own fill is at least 0.95 opaque shows at most a
        // twentieth of what its backdrop blur produces, and that fill is the
        // surface that ends this walk: shadcn's `bg-background/95
        // backdrop-blur` sticky header. Its backdrop filter blocks nothing,
        // so it keeps the candidate under a reason no pass refuses.
        let backdrop = dom.style(cur, "backdropFilter");
        if !backdrop.is_empty() && backdrop != "none" {
            add(
                &mut reasons,
                if solid_bg.is_some() {
                    "backdrop filter under an opaque fill"
                } else {
                    "backdrop filter"
                },
            );
        }
        if solid_bg.is_some() {
            break;
        }
        current = dom.parent(cur);
    }

    let sample_rect = dom.direct_text_rect(el).unwrap_or_else(|| dom.rect(el));
    let vw = dom.inner_width();
    let vh = dom.inner_height();
    let points = [
        (
            sample_rect.left + sample_rect.width / 2.0,
            sample_rect.top + sample_rect.height / 2.0,
        ),
        (
            sample_rect.left
                + math_min(sample_rect.width - 1.0, math_max(1.0, sample_rect.width * 0.25)),
            sample_rect.top + sample_rect.height / 2.0,
        ),
        (
            sample_rect.left
                + math_min(sample_rect.width - 1.0, math_max(1.0, sample_rect.width * 0.75)),
            sample_rect.top + sample_rect.height / 2.0,
        ),
    ];
    for (x, y) in points {
        if x < 0.0 || y < 0.0 || x > vw || y > vh {
            continue;
        }
        let stack = dom.elements_from_point(x, y);
        let self_index = stack
            .iter()
            .position(|&n| n == el || dom.contains(el, n) || dom.contains(n, el));
        let Some(self_index) = self_index else { continue };
        for &node in &stack[self_index + 1..] {
            let node_tag = tag_lower(dom, node);
            if matches!(
                node_tag.as_str(),
                "img" | "picture" | "video" | "canvas" | "svg"
            ) {
                add(&mut reasons, &format!("{node_tag} underlay"));
                break;
            }
        }
    }
    reasons
}

/// Replaced boxes that paint a picture rather than a colour.
const MEDIA_TAGS: &[&str] = &["img", "picture", "video", "canvas"];

/// Bounds on [`layer_under_text`]. The element pass asks it only for an
/// element the rule failed, and the visual pass's second budget for text
/// outside its first one until that budget fills, so a page pays for a
/// bounded number of them, and the node budget caps the most expensive one.
const LAYER_MAX_LEVELS: usize = 32;
const LAYER_MAX_SIBLINGS: usize = 32;
const LAYER_MAX_DEPTH: usize = 6;
const LAYER_MAX_CHILDREN: usize = 64;
const LAYER_MAX_NODES: usize = 1024;

/// The largest tile, per axis, a raster background can be drawn at and still
/// count as a texture over its element's own colour.
const TEXTURE_MAX_TILE_PX: f64 = 256.0;

/// How far apart, summed over the three channels, a surface the background
/// walk never read and the one it resolved may be and still be one surface.
const SAME_SURFACE_DISTANCE: f64 = 24.0;

/// In-flow boxes paint above negative `z-index` and below positioned boxes,
/// so they sit between the two on this coarse scale.
const FLOW_LAYER: f64 = -0.5;

/// A background colour nothing behind it shows through.
fn paints_opaque_color(dom: &dyn Dom, node: ElId) -> Option<Rgba> {
    parse_rgb_or_any(&dom.style(node, "backgroundColor")).filter(|c| c.alpha_or_one() >= 0.95)
}

/// The size a box's single background image is drawn at, where the computed
/// style says it: explicit pixel sizes, or the intrinsic size of an inline SVG
/// data URI where the size is `auto`. A remote file drawn at `auto`, `cover`,
/// `contain` or a percentage has no size this can read.
fn drawn_image_size(dom: &dyn Dom, node: ElId) -> Option<(f64, f64)> {
    let size = js::to_lower_case(&dom.style(node, "backgroundSize"));
    let first = size.split(',').next().unwrap_or("");
    let tokens: Vec<&str> = first.split_ascii_whitespace().collect();
    let intrinsic = || data_svg_intrinsic_size(&dom.style(node, "backgroundImage"));
    let px = |t: &str| {
        t.ends_with("px")
            .then(|| parse_float(t))
            .filter(|v| v.is_finite() && *v > 0.0)
    };
    match tokens.as_slice() {
        [] | ["auto"] | ["auto", "auto"] => intrinsic(),
        ["auto", h] => {
            let h = px(h)?;
            let (iw, ih) = intrinsic()?;
            Some((h * iw / ih, h))
        }
        [w] | [w, "auto"] => {
            let w = px(w)?;
            let (iw, ih) = intrinsic()?;
            Some((w, w * ih / iw))
        }
        [w, h] => Some((px(w)?, px(h)?)),
        _ => None,
    }
}

/// Whether an element's raster background is a small repeating tile: a
/// noise, grain or dot texture laid over the element's own colour. The
/// tile's pixels are not in the computed style, so "faint" cannot be
/// measured; what can be measured is the shape a photograph is almost never
/// drawn in. `no-repeat`, a size this cannot read (a remote file at `auto`,
/// `cover`, `contain`, a percentage), or a tile larger than
/// [`TEXTURE_MAX_TILE_PX`] is a picture.
fn raster_tiles_as_texture(dom: &dyn Dom, node: ElId) -> bool {
    if js::to_lower_case(&dom.style(node, "background")).contains("no-repeat") {
        return false;
    }
    drawn_image_size(dom, node)
        .map_or(false, |(w, h)| w <= TEXTURE_MAX_TILE_PX && h <= TEXTURE_MAX_TILE_PX)
}

/// Whether a box's background image is an icon rather than a picture: one
/// `no-repeat` image at most [`ICON_MAX_PX`] on both axes, at a size the
/// computed style states.
fn background_is_icon(dom: &dyn Dom, node: ElId) -> bool {
    let image = dom.style(node, "backgroundImage");
    if GRADIENT_RE.is_match(&image) || js::to_lower_case(&image).matches("url(").count() != 1 {
        return false;
    }
    if !js::to_lower_case(&dom.style(node, "background")).contains("no-repeat") {
        return false;
    }
    drawn_image_size(dom, node).map_or(false, |(w, h)| w <= ICON_MAX_PX && h <= ICON_MAX_PX)
}

/// The boxes whose background image is an icon beside this element's text:
/// the element itself (an external-link mark) and its nearest `li` (an arrow
/// bullet). The background walk and the layer test both read those images
/// as absent.
pub fn icon_hosts(dom: &dyn Dom, el: ElId) -> Vec<ElId> {
    const MAX_ANCESTORS: usize = 12;
    let mut hosts = Vec::new();
    if background_is_icon(dom, el) {
        hosts.push(el);
    }
    let mut cur = dom.parent(el);
    for _ in 0..MAX_ANCESTORS {
        let Some(c) = cur else { break };
        if tag_lower(dom, c) == "li" {
            if background_is_icon(dom, c) {
                hosts.push(c);
            }
            break;
        }
        cur = dom.parent(c);
    }
    hosts
}

/// What one box paints, in the terms the layer test needs.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Paint {
    /// A raster image, or a replaced media element.
    Picture,
    /// Its own opaque background colour.
    Fill(Rgba),
    /// An opaque colour drawn by its `::before` or `::after`.
    PseudoFill(Rgba),
    /// Paint the background walk cannot turn into a colour: a translucent or
    /// gradient pseudo-element over the box, a gradient drawn larger than it.
    Unmodelled,
    /// An opaque gradient laid under the text by a box that is nobody's
    /// ancestor, as the channel-wise least and greatest of its stops.
    Gradient { lo: Rgba, hi: Rgba },
}

/// SVG elements that paint where they are drawn. The capture records no
/// `fill`, so a shape under the text is paint the walk cannot read.
const SVG_SHAPES: &[&str] = &[
    "path", "rect", "circle", "ellipse", "polygon", "polyline", "line", "use",
];

/// A box's own `opacity`, `1` where the style does not say.
fn own_opacity(dom: &dyn Dom, node: ElId) -> f64 {
    let raw = dom.style(node, "opacity");
    let v = parse_float(&raw);
    if js::trim(&raw).is_empty() || !v.is_finite() {
        1.0
    } else {
        v.clamp(0.0, 1.0)
    }
}

/// The surface a box's gradient background paints, where it paints one
/// ([`super::text_layers::gradient_surface_stops`]: not a dot grid, a
/// hairline, a faint wash or a masked layer): [`Paint::Gradient`] where every
/// stop is opaque, [`Paint::Unmodelled`] where a stop lets something through.
fn gradient_surface(dom: &dyn Dom, node: ElId) -> Option<Paint> {
    let stops = super::text_layers::gradient_surface_stops(dom, node, own_opacity(dom, node))?;
    if stops.iter().any(|c| c.alpha_or_one() < 0.95) {
        return Some(Paint::Unmodelled);
    }
    let fold = |pick: fn(f64, f64) -> f64, start: f64| Rgba {
        r: stops.iter().map(|c| c.r).fold(start, pick),
        g: stops.iter().map(|c| c.g).fold(start, pick),
        b: stops.iter().map(|c| c.b).fold(start, pick),
        a: Some(1.0),
    };
    Some(Paint::Gradient {
        lo: fold(f64::min, f64::INFINITY),
        hi: fold(f64::max, f64::NEG_INFINITY),
    })
}

/// Whether an SVG shape is drawn around the text, the way an initial's
/// circle or a badge's rounded rect is, rather than behind a whole section:
/// a pattern or blob laid over a hero is decoration whose fill the capture
/// does not say, and the surface the walk named stands there.
fn shape_hugs_text(shape: &Rect, text: &Rect) -> bool {
    shape.width <= text.width * 3.0 + 16.0 && shape.height <= text.height * 3.0 + 16.0
}

/// What a box that is nobody's ancestor paints under the text: its own paint
/// as an ancestor's is read ([`own_paint`]), then paint the background walk
/// never reads on an ancestor either. An SVG image is a picture and an SVG
/// shape drawn around the text unmodelled paint (an initial's circle), and a
/// gradient that paints a surface is one (an `absolute inset-0` hero
/// gradient beside the content).
fn detached_paint(dom: &dyn Dom, node: ElId, text: &Rect) -> Option<Paint> {
    if let Some(paint) = own_paint(dom, node, text, false, false) {
        return Some(paint);
    }
    if is_svg(dom, node) {
        let tag = tag_lower(dom, node);
        if tag == "image" {
            return Some(Paint::Picture);
        }
        if SVG_SHAPES.contains(&tag.as_str()) && shape_hugs_text(&dom.rect(node), text) {
            return Some(Paint::Unmodelled);
        }
    }
    gradient_surface(dom, node)
}

fn is_svg(dom: &dyn Dom, node: ElId) -> bool {
    dom.namespace_uri(node) == impeccable_foundation::browser::snapshot::NS_SVG
}

/// Where a layer paints against the fills around it, for a layer whose
/// place in paint order is in question.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Order {
    /// Over the fills between it and the text: a reader sees it.
    Over,
    /// Beneath an opaque fill that is under the text too: nobody sees it
    /// there.
    Under,
    /// The capture does not say which.
    Unknown,
}

/// Whether a box opens a stacking context, so a negative `z-index` layer
/// inside it paints over its background rather than under it. `None` where
/// nothing the capture recorded opens one and it did not record `isolation`
/// (a capture older than that property); a Tailwind `isolate` class answers
/// for it there.
fn opens_stacking_context(dom: &dyn Dom, n: ElId) -> Option<bool> {
    if box_layer(dom, n).context.is_some() {
        return Some(true);
    }
    let value = |prop: &str| js::to_lower_case(js::trim(&dom.style(n, prop)));
    let set = |prop: &str, off: &str| {
        let v = value(prop);
        !v.is_empty() && v != off
    };
    let position = value("position");
    if position == "fixed" || position == "sticky" {
        return Some(true);
    }
    let effects = [
        ("filter", "none"),
        ("backdropFilter", "none"),
        ("mixBlendMode", "normal"),
        ("clipPath", "none"),
        ("maskImage", "none"),
        ("webkitMaskImage", "none"),
        ("perspective", "none"),
        ("translate", "none"),
        ("rotate", "none"),
        ("scale", "none"),
    ];
    if effects.iter().any(|(prop, off)| set(prop, off)) {
        return Some(true);
    }
    let contain = value("contain");
    if ["paint", "layout", "strict", "content"].iter().any(|k| contain.contains(k)) {
        return Some(true);
    }
    let will = value("willChange");
    if [
        "transform",
        "opacity",
        "filter",
        "z-index",
        "translate",
        "rotate",
        "scale",
        "isolation",
        "mix-blend-mode",
        "perspective",
    ]
    .iter()
    .any(|k| will.contains(k))
    {
        return Some(true);
    }
    match value("isolation").as_str() {
        "isolate" => Some(true),
        "" => {
            let class = dom.attr(n, "class").unwrap_or_default();
            class
                .split_ascii_whitespace()
                .any(|t| t == "isolate")
                .then_some(true)
        }
        _ => Some(false),
    }
}

/// Where a negative `z-index` layer hung from `start` paints: in the nearest
/// stacking context above it, beneath every in-flow background inside that
/// context. An opaque fill (or opaque gradient) on `start` or on a box above
/// it, before a stacking context is met, is painted over the layer, and the
/// text sits on that fill: the `absolute inset-0 -z-10` gradient inside a
/// `relative bg-white` section is hidden, the same layer inside an
/// `isolate` section shows. The document's own surface hides nothing: the
/// root is a stacking context, and `body`'s colour is the canvas's.
fn negative_layer_order(dom: &dyn Dom, start: ElId) -> Order {
    let mut unknown = false;
    let mut cur = Some(start);
    for _ in 0..LAYER_MAX_LEVELS {
        let Some(n) = cur else { break };
        let tag = tag_lower(dom, n);
        if tag == "body" || tag == "html" {
            break;
        }
        match opens_stacking_context(dom, n) {
            Some(true) => return Order::Over,
            Some(false) => {}
            None => unknown = true,
        }
        if paints_opaque_color(dom, n).is_some()
            || matches!(gradient_surface(dom, n), Some(Paint::Gradient { .. }))
        {
            return if unknown { Order::Unknown } else { Order::Under };
        }
        cur = dom.parent(n);
    }
    Order::Over
}

/// A pixel length a computed style gives, `None` for `auto` or anything else.
fn px_length(raw: &str) -> Option<f64> {
    let raw = js::trim(raw);
    if !raw.ends_with("px") {
        return None;
    }
    let v = parse_float(raw);
    v.is_finite().then_some(v)
}

/// Where a computed `transform` (with the `translate` property, where
/// recorded) puts a box of `rect`: the box itself for a translation, or,
/// for a rotation, a scale or a skew, the bounds of the transformed box about
/// its centre (the default `transform-origin`, which the capture does not
/// record for a pseudo-element), with `false` for "not exact": the box paints
/// inside those bounds but may not fill them. `None` for a transform this
/// cannot read (a 3D matrix).
fn transformed_box(rect: Rect, transform: &str, translate: &str) -> Option<(Rect, bool)> {
    let (w, h) = (rect.width, rect.height);
    let mut m = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];
    let transform = js::trim(transform);
    if !transform.is_empty() && transform != "none" {
        let inner = transform.strip_prefix("matrix(")?.strip_suffix(')')?;
        let v: Vec<f64> = inner.split(',').map(|t| parse_float(js::trim(t))).collect();
        if v.len() != 6 || v.iter().any(|x| !x.is_finite()) {
            return None;
        }
        m.copy_from_slice(&v);
    }
    let translate = js::trim(translate);
    if !translate.is_empty() && translate != "none" {
        let axis = |t: &str, size: f64| {
            if let Some(pct) = t.strip_suffix('%') {
                let v = parse_float(pct);
                v.is_finite().then_some(v / 100.0 * size)
            } else {
                px_length(t)
            }
        };
        let mut tokens = translate.split_ascii_whitespace();
        m[4] += axis(tokens.next()?, w)?;
        if let Some(t) = tokens.next() {
            m[5] += axis(t, h)?;
        }
    }
    let near = |a: f64, b: f64| (a - b).abs() < 1e-3;
    let exact = near(m[0], 1.0) && near(m[1], 0.0) && near(m[2], 0.0) && near(m[3], 1.0);
    let (cx, cy) = (rect.left + w / 2.0, rect.top + h / 2.0);
    let corners = [(-w / 2.0, -h / 2.0), (w / 2.0, -h / 2.0), (-w / 2.0, h / 2.0), (w / 2.0, h / 2.0)];
    let placed: Vec<(f64, f64)> = corners
        .iter()
        .map(|&(x, y)| (cx + m[0] * x + m[2] * y + m[4], cy + m[1] * x + m[3] * y + m[5]))
        .collect();
    let (l, r) = placed.iter().fold((f64::INFINITY, f64::NEG_INFINITY), |(l, r), p| (l.min(p.0), r.max(p.0)));
    let (t, b) = placed.iter().fold((f64::INFINITY, f64::NEG_INFINITY), |(t, b), p| (t.min(p.1), b.max(p.1)));
    Some((Rect::from_xywh(l, t, r - l, b - t), exact))
}

/// The padding box an absolutely positioned child of `host` is placed in:
/// the nearest positioned or transformed box, the host included. `None`
/// where that is the initial containing block, or an inline box, whose
/// geometry the capture does not give.
fn containing_block(dom: &dyn Dom, host: ElId) -> Option<Rect> {
    let mut cur = Some(host);
    for _ in 0..LAYER_MAX_LEVELS {
        let n = cur?;
        let tag = tag_lower(dom, n);
        if tag == "html" || tag == "body" {
            return None;
        }
        let position = dom.style(n, "position");
        let position = js::trim(&position);
        let transform = dom.style(n, "transform");
        let transform = js::trim(&transform);
        let positioned = !position.is_empty() && position != "static";
        if positioned || (!transform.is_empty() && transform != "none") {
            let display = dom.style(n, "display");
            if display == "inline" || display == "contents" {
                return None;
            }
            let border = |side: &str| px_length(&dom.style(n, side)).unwrap_or(0.0);
            let r = dom.rect(n);
            let (bl, bt) = (border("borderLeftWidth"), border("borderTopWidth"));
            let (br, bb) = (border("borderRightWidth"), border("borderBottomWidth"));
            return Some(Rect::from_xywh(
                r.left + bl,
                r.top + bt,
                (r.width - bl - br).max(0.0),
                (r.height - bt - bb).max(0.0),
            ));
        }
        cur = dom.parent(n);
    }
    None
}

/// The box an absolutely positioned `::before` / `::after` paints: its
/// offsets and size in its containing block, moved by its transform
/// ([`transformed_box`], whose `false` says the pseudo paints somewhere
/// inside the box but may not fill it). `None` where the capture does not
/// place it (a fixed pseudo, a size or offsets it did not resolve to pixels,
/// a 3D transform).
fn pseudo_box(dom: &dyn Dom, node: ElId, which: &str) -> Option<(Rect, bool)> {
    let get = |prop: &str| dom.pseudo_style(node, which, prop).unwrap_or_default();
    if js::trim(&get("position")) != "absolute" {
        return None;
    }
    let (w, h) = (px_length(&get("width"))?, px_length(&get("height"))?);
    let cb = containing_block(dom, node)?;
    let left = px_length(&get("left")).or_else(|| px_length(&get("right")).map(|r| cb.width - r - w))?;
    let top = px_length(&get("top")).or_else(|| px_length(&get("bottom")).map(|b| cb.height - b - h))?;
    let laid_out = Rect::from_xywh(cb.left + left, cb.top + top, w, h);
    transformed_box(laid_out, &get("transform"), &get("translate"))
}

/// Where a positioned pseudo-element paints against its host's background
/// and the fills above it. At `z-index: auto` or above it paints over them;
/// below zero it paints in the nearest stacking context, over the host's
/// fill only where the host opens that context itself
/// ([`negative_layer_order`]): the offset shadow or ring a card draws with
/// `::before { z-index: -1 }` behind its white fill is hidden under it. A
/// capture that did not record the pseudo's `z-index` is sure only where
/// nothing it could hide beneath has a fill.
fn pseudo_order(dom: &dyn Dom, node: ElId, which: &str) -> Order {
    let z = dom.pseudo_style(node, which, "zIndex").unwrap_or_default();
    let z = js::trim(&z);
    if z == "auto" {
        return Order::Over;
    }
    if z.is_empty() {
        return match negative_layer_order(dom, node) {
            Order::Over => Order::Over,
            _ => Order::Unknown,
        };
    }
    let v = parse_float(z);
    if !v.is_finite() {
        return Order::Unknown;
    }
    if v >= 0.0 {
        Order::Over
    } else {
        negative_layer_order(dom, node)
    }
}

/// A `::before` or `::after` painting something over the whole text run.
/// A small pseudo (an underline, a bullet, a badge dot) is not a surface,
/// and neither is one laid out inline, one placed off the text (a "Most
/// popular" badge at a card's corner) or one painted beneath an opaque fill
/// ([`pseudo_order`]).
fn pseudo_paint(dom: &dyn Dom, node: ElId, text: &Rect) -> Option<Paint> {
    pseudo_paint_placed(dom, node, text).map(|(paint, _)| paint)
}

/// [`pseudo_paint`], and whether the capture places it for certain: its box
/// is known to cover the text, and its order against the fills around it is
/// known. An uncertain one decides what it always did (the SAFE_TAGS path
/// waives against it) but no verdict of its own ([`found_order`]).
fn pseudo_paint_placed(dom: &dyn Dom, node: ElId, text: &Rect) -> Option<(Paint, bool)> {
    for which in ["::before", "::after"] {
        let get = |prop: &str| dom.pseudo_style(node, which, prop).unwrap_or_default();
        let content = get("content");
        let content = js::trim(&content);
        if content.is_empty() || content == "none" || content == "normal" {
            continue;
        }
        if get("display") == "none" || get("visibility") == "hidden" {
            continue;
        }
        let opacity = get("opacity");
        if !js::trim(&opacity).is_empty() && parse_float(&opacity) < 0.1 {
            continue;
        }
        let position = get("position");
        if position != "absolute" && position != "fixed" {
            continue;
        }
        let placed = match pseudo_box(dom, node, which) {
            Some((b, _)) if !rect_covers(&b, text) => continue,
            Some((_, exact)) => exact,
            None => {
                let (w, h) = (parse_float(&get("width")), parse_float(&get("height")));
                if !(w >= text.width - 4.0 && h >= text.height - 4.0) {
                    continue;
                }
                false
            }
        };
        let order = pseudo_order(dom, node, which);
        if order == Order::Under {
            continue;
        }
        let certain = placed && order == Order::Over;
        let image = get("backgroundImage");
        if URL_RE.is_match(&image) {
            return Some((Paint::Picture, certain));
        }
        if GRADIENT_RE.is_match(&image) {
            return Some((Paint::Unmodelled, certain));
        }
        if let Some(c) = parse_rgb_or_any(&get("backgroundColor")) {
            if c.alpha_or_one() >= 0.9 {
                return Some((Paint::PseudoFill(c), certain));
            }
            if c.alpha_or_one() > 0.1 {
                return Some((Paint::Unmodelled, certain));
            }
        }
    }
    None
}

/// Whether a gradient background is drawn larger than its box, so the part
/// under the text is a slice of the stops and not all of them: the animated
/// button that sweeps a `200% 200%` gradient across itself shows one colour
/// at a time, and scoring every stop names colours nobody sees there.
fn gradient_drawn_larger_than_box(dom: &dyn Dom, node: ElId) -> bool {
    if !GRADIENT_RE.is_match(&dom.style(node, "backgroundImage")) {
        return false;
    }
    let rect = dom.rect(node);
    let largest = math_max(rect.width, rect.height);
    js::to_lower_case(&dom.style(node, "backgroundSize"))
        .split(|c: char| c == ',' || c.is_ascii_whitespace())
        .any(|t| {
            (t.ends_with('%') && parse_float(t) > 100.5)
                || (t.ends_with("px") && parse_float(t) > largest + 1.0)
        })
}

/// What a box paints under text above it, pseudo-elements first because they
/// paint over the box's own background. `body` and `html` paint the document
/// itself, and their images are not a layer over it. `icon_host` says this
/// box's background image is an icon beside the text.
fn own_paint(
    dom: &dyn Dom,
    node: ElId,
    text: &Rect,
    document_surface: bool,
    icon_host: bool,
) -> Option<Paint> {
    if let Some(paint) = pseudo_paint(dom, node, text) {
        return Some(paint);
    }
    let fill = paints_opaque_color(dom, node);
    if !document_surface
        && URL_RE.is_match(&dom.style(node, "backgroundImage"))
        && !(icon_host && background_is_icon(dom, node))
        && !(fill.is_some() && raster_tiles_as_texture(dom, node))
    {
        return Some(Paint::Picture);
    }
    if !document_surface && gradient_drawn_larger_than_box(dom, node) {
        return Some(Paint::Unmodelled);
    }
    fill.map(Paint::Fill)
}

/// Whether `outer` covers `inner`, give or take a pixel of rounding.
fn rect_covers(outer: &Rect, inner: &Rect) -> bool {
    const SLACK: f64 = 1.0;
    outer.width > 0.0
        && outer.height > 0.0
        && inner.width > 0.0
        && inner.height > 0.0
        && outer.left <= inner.left + SLACK
        && outer.top <= inner.top + SLACK
        && outer.left + outer.width >= inner.left + inner.width - SLACK
        && outer.top + outer.height >= inner.top + inner.height - SLACK
}

/// A box's place in paint order, coarsely: `context` is the `z-index` of a
/// stacking context it opens (an opacity below 1 or a transform opens one at
/// 0), `positioned` whether it paints with the positioned boxes.
#[derive(Debug, Clone, Copy)]
struct BoxLayer {
    context: Option<f64>,
    positioned: bool,
}

fn box_layer(dom: &dyn Dom, node: ElId) -> BoxLayer {
    let position = dom.style(node, "position");
    let position = js::trim(&position);
    let positioned = !position.is_empty() && position != "static";
    let z_applies = positioned
        || dom.parent(node).map_or(false, |p| {
            let display = dom.style(p, "display");
            display.contains("flex") || display.contains("grid")
        });
    let z_raw = dom.style(node, "zIndex");
    let z_raw = js::trim(&z_raw);
    let z = (z_applies && !z_raw.is_empty() && z_raw != "auto")
        .then(|| parse_float(z_raw))
        .filter(|z| z.is_finite());
    let context = z.or_else(|| {
        let opacity = dom.style(node, "opacity");
        let translucent = !js::trim(&opacity).is_empty() && parse_float(&opacity) < 1.0;
        let transform = dom.style(node, "transform");
        let transform = js::trim(&transform);
        let transformed = !transform.is_empty() && transform != "none";
        (translucent || transformed).then_some(0.0)
    });
    BoxLayer {
        context,
        positioned,
    }
}

/// The layer the text paints in, seen one ancestor further out: the
/// outermost stacking context wins, and a positioned box lifts in-flow text
/// to the positioned layer.
fn outer_layer(inner: f64, b: BoxLayer) -> f64 {
    match b.context {
        Some(z) => z,
        None if b.positioned && inner == FLOW_LAYER => 0.0,
        None => inner,
    }
}

/// The layer a descendant of a sibling paints in, one level further in. Once
/// a stacking context is met, everything inside it paints at its `z-index`.
fn inner_layer(outer: (f64, bool), b: BoxLayer) -> (f64, bool) {
    let (layer, locked) = outer;
    if locked {
        return outer;
    }
    match b.context {
        Some(z) => (z, true),
        None if b.positioned && layer == FLOW_LAYER => (0.0, false),
        None => outer,
    }
}

/// Whether a box at `layer` paints beneath text at `text_layer`.
///
/// A later sibling has to prove it: only a strictly lower layer puts it under
/// the text, the `z-index: -1` photo after the content or the section laid
/// under a `z-index: 1` header. An earlier sibling is beneath unless it opens
/// a positive `z-index` above the text, which is what a modal or a popover
/// does. The strict order would put an earlier `position: relative;
/// z-index: 0` media box over in-flow text, and on real pages that text is
/// visible over the picture (a component's own styles the snapshot cannot
/// express), so an earlier box at layer 0 or below counts as underneath.
fn paints_beneath(layer: f64, text_layer: f64, earlier: bool) -> bool {
    if earlier {
        layer <= text_layer.max(0.0)
    } else {
        layer < text_layer
    }
}

/// Whether a box lets its children paint outside its own rect. A
/// `display: contents` element has no box, so its `overflow` clips nothing.
fn overflow_visible(dom: &dyn Dom, node: ElId) -> bool {
    if dom.style(node, "display") == "contents" {
        return true;
    }
    let overflow = dom.style(node, "overflow");
    let overflow = js::trim(&overflow);
    overflow.is_empty() || overflow == "visible"
}

/// Whether a child is worth looking inside for paint under the text: its own
/// rect covers the text, or it has no box of its own (zero size, or
/// `display: contents`) and so says nothing about where its children lie.
/// A slide parked beside the viewport, or a card elsewhere on the page, is
/// skipped without spending the budget.
///
/// An inline box with element children says nothing either: its rect is the
/// line its contents sit on, and a replaced child (the `<img>` in a
/// `<picture>`) is laid out at its own size. telekom.de's teaser photo is a
/// 366 x 480 image in a `<picture>` whose rect is a 21px line at the bottom
/// of the card.
fn may_reach_text(dom: &dyn Dom, child: ElId, text: &Rect) -> bool {
    let rect = dom.rect(child);
    rect_covers(&rect, text)
        || rect.width <= 0.0
        || rect.height <= 0.0
        || dom.style(child, "display") == "contents"
        || (dom.style(child, "display") == "inline" && dom.first_element_child(child).is_some())
}

/// The paint a sibling box, or something inside it, puts under the text,
/// looked at the way a reader looks down through it: its children topmost
/// first, then its own background. Only a box that covers the text rect can
/// decide, and only where it paints beneath the text. A box that does not
/// cover it is still looked inside where nothing clips its children: a
/// zero-height wrapper around an absolutely positioned photo, a
/// `display: contents` section, a carousel track narrower than its slides.
/// Below the sibling itself, only children that may reach the text are
/// visited ([`may_reach_text`]).
#[allow(clippy::too_many_arguments)]
fn layer_in_box(
    dom: &dyn Dom,
    node: ElId,
    text: &Rect,
    text_layer: f64,
    earlier: bool,
    depth: usize,
    outer: (f64, bool),
    budget: &mut usize,
    skip: &[ElId],
) -> Option<(Paint, ElId)> {
    if *budget == 0 {
        return None;
    }
    *budget -= 1;
    if dom.style(node, "visibility") == "hidden" || parse_float(&dom.style(node, "opacity")) < 0.05
    {
        return None;
    }
    let layer = inner_layer(outer, box_layer(dom, node));
    let beneath = paints_beneath(layer.0, text_layer, earlier);
    // A negative `z-index` layer that an opaque fill between it and its
    // stacking context paints over, nothing in it is seen: the dark
    // `-z-10` gradient inside a `relative bg-white` section.
    if beneath
        && layer.1
        && !outer.1
        && layer.0 < FLOW_LAYER
        && text_layer >= FLOW_LAYER
        && dom.parent(node).is_some_and(|p| negative_layer_order(dom, p) == Order::Under)
    {
        return None;
    }
    let covers = rect_covers(&dom.rect(node), text);
    let skipped = skip.contains(&node);
    if covers && beneath && !skipped && MEDIA_TAGS.contains(&tag_lower(dom, node).as_str()) {
        return Some((Paint::Picture, node));
    }
    if depth < LAYER_MAX_DEPTH && (covers || overflow_visible(dom, node)) {
        let children = dom.children(node);
        let reaching = children
            .iter()
            .rev()
            .filter(|&&child| may_reach_text(dom, child, text))
            .take(LAYER_MAX_CHILDREN);
        for &child in reaching {
            if let Some(paint) =
                layer_in_box(dom, child, text, text_layer, earlier, depth + 1, layer, budget, skip)
            {
                return Some(paint);
            }
        }
    }
    if covers && beneath && !skipped {
        detached_paint(dom, node, text).map(|paint| (paint, node))
    } else {
        None
    }
}

/// What paints under a run of text, as far as layout can say, next to the
/// answer the background walk already gave.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum LayerUnder {
    /// An image, a video, a canvas or a raster background under the whole run.
    Picture,
    /// An opaque surface that is nobody's ancestor fill: a sibling panel, a
    /// section a later box lays beneath the text, a pseudo-element's colour.
    /// The walk reads ancestor fills only, so it never saw this one.
    Detached(Rgba),
    /// Paint under the text the walk cannot turn into a colour.
    Unmodelled,
    /// An opaque gradient that is nobody's ancestor fill, as the channel-wise
    /// least and greatest of its stops.
    Gradient { lo: Rgba, hi: Rgba },
    /// The first opaque surface under the text is an ancestor's own fill,
    /// which is the surface the walk answers with.
    Ancestor,
    /// Nothing decided it.
    Undecided,
}

impl From<Paint> for LayerUnder {
    fn from(paint: Paint) -> Self {
        match paint {
            Paint::Picture => LayerUnder::Picture,
            Paint::Fill(c) | Paint::PseudoFill(c) => LayerUnder::Detached(c),
            Paint::Unmodelled => LayerUnder::Unmodelled,
            Paint::Gradient { lo, hi } => LayerUnder::Gradient { lo, hi },
        }
    }
}

/// The siblings of `node` that may paint beneath the text, topmost first:
/// the higher layer first, and at one layer the later box first.
fn sibling_layer(
    dom: &dyn Dom,
    parent: ElId,
    node: ElId,
    text: &Rect,
    text_layer: f64,
    budget: &mut usize,
    skip: &[ElId],
) -> Option<(LayerUnder, ElId)> {
    let siblings = dom.children(parent);
    let index = siblings.iter().position(|&s| s == node)?;
    let earlier = (0..index).rev().take(LAYER_MAX_SIBLINGS).map(|i| (i, true));
    let later = (index + 1..siblings.len())
        .take(LAYER_MAX_SIBLINGS)
        .map(|i| (i, false));
    let mut candidates: Vec<(f64, usize, bool)> = earlier
        .chain(later)
        .map(|(i, is_earlier)| {
            let layer = inner_layer((FLOW_LAYER, false), box_layer(dom, siblings[i])).0;
            (layer, i, is_earlier)
        })
        .collect();
    candidates.sort_by(|a, b| {
        b.0.partial_cmp(&a.0)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(b.1.cmp(&a.1))
    });
    for (_, i, is_earlier) in candidates {
        let outer = (FLOW_LAYER, false);
        if let Some((paint, found)) =
            layer_in_box(dom, siblings[i], text, text_layer, is_earlier, 0, outer, budget, skip)
        {
            return Some((paint.into(), found));
        }
    }
    None
}

/// The hit-test answer, for a page the geometric climb could not decide or
/// that ends at an opaque `body` or `html`, which is the surface the walk
/// falls back to and not proof that nothing paints above it. Only points in
/// the viewport can be asked, so this runs where a live browser answers and
/// is silent below the fold and in a replayed capture that did not record the
/// point. Each point reads the stack under the text down to the first opaque
/// box. A picture needs every answered point, the same whole-run test the
/// climb makes, so a run half over a photo and half over the page is scored
/// on the page. `None` when no point was answered.
fn hit_test_layer(dom: &dyn Dom, el: ElId, text: &Rect) -> Option<LayerUnder> {
    let vw = dom.inner_width();
    let vh = dom.inner_height();
    let y = text.top + text.height / 2.0;
    let xs = [
        text.left + text.width / 2.0,
        text.left + math_min(text.width - 1.0, math_max(1.0, text.width * 0.25)),
        text.left + math_min(text.width - 1.0, math_max(1.0, text.width * 0.75)),
    ];
    let mut answers = Vec::new();
    for x in xs {
        if x < 0.0 || y < 0.0 || x > vw || y > vh {
            continue;
        }
        let stack = dom.elements_from_point(x, y);
        let Some(self_index) = stack
            .iter()
            .position(|&n| n == el || dom.contains(el, n) || dom.contains(n, el))
        else {
            continue;
        };
        let mut answer = LayerUnder::Undecided;
        for &node in &stack[self_index + 1..] {
            if dom.contains(node, el) {
                if paints_opaque_color(dom, node).is_some() {
                    answer = LayerUnder::Ancestor;
                    break;
                }
                continue;
            }
            if MEDIA_TAGS.contains(&tag_lower(dom, node).as_str()) {
                answer = LayerUnder::Picture;
                break;
            }
            // Paint only the climb reads (a gradient, an SVG shape) decides
            // where its box covers the whole run, as it does there.
            let paint = if rect_covers(&dom.rect(node), text) {
                detached_paint(dom, node, text)
            } else {
                own_paint(dom, node, text, false, false)
            };
            if let Some(paint) = paint {
                answer = paint.into();
                break;
            }
        }
        answers.push(answer);
    }
    if answers.is_empty() {
        return None;
    }
    if answers.iter().all(|a| *a == LayerUnder::Picture) {
        return Some(LayerUnder::Picture);
    }
    answers
        .iter()
        .copied()
        .find(|a| {
            matches!(
                a,
                LayerUnder::Detached(_) | LayerUnder::Unmodelled | LayerUnder::Gradient { .. }
            )
        })
        .or_else(|| {
            answers
                .contains(&LayerUnder::Ancestor)
                .then_some(LayerUnder::Ancestor)
        })
}

/// What paints under this element's text, which says whether the surface
/// `resolve_background_info` returned is the one a reader sees.
///
/// The background walk reads the ancestor chain and answers with the first
/// opaque colour on it, so it is blind in several directions: an ancestor that
/// paints a raster image or a pseudo-element over its own colour, a positioned
/// sibling (hero photo, video, canvas, a dark section) that is nobody's
/// ancestor, and a gradient drawn larger than its box. Each answers with a
/// fill that is not under the text, which is how white text over a
/// photograph is reported as `1.1:1 on #f7f8f9`.
///
/// The test is geometric, so it works at any scroll position without a hit
/// test. It climbs from the element and at each level asks two things in
/// paint order: the box's own paint (pseudo-elements, then its background),
/// then its siblings that paint beneath the text, earlier ones at the text's
/// layer or below and later ones strictly below it (a `z-index: -1` photo
/// after the content, or a section laid under a `z-index: 1` header). A
/// sibling, or a box a few levels inside it, that covers the text rect decides
/// it. The first opaque ancestor fill ends the climb with
/// [`LayerUnder::Ancestor`]: the card on the hero photo is what the link on it
/// is read against. A solid colour carrying a small tiled texture of a size
/// the style states is such a surface, and an icon on the text's own element
/// or its `li` is not a picture at all. Where the climb reaches an opaque
/// `body` or `html`, or a transparent document, the hit-test stack answers
/// instead, and a page nothing decides is [`LayerUnder::Undecided`].
///
/// A gradient on an ancestor is not a picture. The walk scores it against
/// its stops, so an ancestor whose gradient is opaque ends the climb as its
/// fill would. A gradient that paints a surface on a box that is nobody's
/// ancestor (an `absolute inset-0` hero gradient beside the content) is paint
/// the walk never read ([`LayerUnder::Gradient`], or
/// [`LayerUnder::Unmodelled`] where a stop is translucent), and so is an SVG
/// shape (an initial's circle).
pub fn layer_under_text(dom: &dyn Dom, el: ElId) -> LayerUnder {
    layer_under_text_found(dom, el).0
}

/// [`layer_under_text`], with the box the climb found the paint on where the
/// climb decided it (`None` for an ancestor's fill and for the hit-test
/// answer).
pub fn layer_under_text_found(dom: &dyn Dom, el: ElId) -> (LayerUnder, Option<ElId>) {
    let text = dom.direct_text_rect(el).unwrap_or_else(|| dom.rect(el));
    let hosts = icon_hosts(dom, el);
    climb_layers(dom, el, el, &text, &hosts, &[])
}

/// What paints under `rect`, climbing from `start` the way
/// [`layer_under_text`] climbs from a run of text: the surface a box's
/// shadow or glow is drawn on, with `start` its parent.
pub fn layer_under_rect(dom: &dyn Dom, start: ElId, rect: &Rect) -> (LayerUnder, Option<ElId>) {
    climb_layers(dom, start, start, rect, &[], &[])
}

fn climb_layers(
    dom: &dyn Dom,
    el: ElId,
    start: ElId,
    text: &Rect,
    hosts: &[ElId],
    skip: &[ElId],
) -> (LayerUnder, Option<ElId>) {
    let text = *text;
    let mut budget = LAYER_MAX_NODES;
    let mut text_layer = FLOW_LAYER;
    let mut node = start;
    for _ in 0..LAYER_MAX_LEVELS {
        let tag = tag_lower(dom, node);
        let document_surface = tag == "body" || tag == "html";
        text_layer = outer_layer(text_layer, box_layer(dom, node));
        match own_paint(dom, node, &text, document_surface, hosts.contains(&node)) {
            Some(Paint::Fill(_)) if document_surface => {
                return (hit_test_layer(dom, el, &text).unwrap_or(LayerUnder::Ancestor), None);
            }
            Some(Paint::Fill(_)) => return (LayerUnder::Ancestor, None),
            Some(_) if skip.contains(&node) => {}
            Some(paint) => return (paint.into(), Some(node)),
            None => {}
        }
        if !document_surface && matches!(gradient_surface(dom, node), Some(Paint::Gradient { .. })) {
            return (LayerUnder::Ancestor, None);
        }
        let Some(parent) = dom.parent(node) else {
            break;
        };
        if let Some((layer, found)) =
            sibling_layer(dom, parent, node, &text, text_layer, &mut budget, skip)
        {
            return (layer, Some(found));
        }
        node = parent;
    }
    (hit_test_layer(dom, el, &text).unwrap_or(LayerUnder::Undecided), None)
}

/// Whether the surface the background walk resolved is the one under this
/// element's text, so a contrast verdict against it is about something a
/// reader sees. A picture, or paint the walk cannot model, is not; a surface
/// the walk never read is only where its colour is the one the walk named.
pub fn resolved_surface_is_under_text(dom: &dyn Dom, el: ElId, resolved: Option<Rgba>) -> bool {
    layer_matches_surface(layer_under_text(dom, el), resolved)
}

/// [`resolved_surface_is_under_text`] over an answer already read. A detached
/// gradient is the walk's surface only where every stop is within one
/// surface's tolerance of the colour the walk named.
pub fn layer_matches_surface(under: LayerUnder, resolved: Option<Rgba>) -> bool {
    match under {
        LayerUnder::Picture | LayerUnder::Unmodelled => false,
        LayerUnder::Detached(surface) => resolved.map_or(false, |bg| {
            (bg.r - surface.r).abs() + (bg.g - surface.g).abs() + (bg.b - surface.b).abs()
                <= SAME_SURFACE_DISTANCE
        }),
        LayerUnder::Gradient { lo, hi } => resolved.map_or(false, |bg| {
            let far = |l: f64, h: f64, b: f64| math_max((l - b).abs(), (h - b).abs());
            far(lo.r, hi.r, bg.r) + far(lo.g, hi.g, bg.g) + far(lo.b, hi.b, bg.b)
                <= SAME_SURFACE_DISTANCE
        }),
        LayerUnder::Ancestor | LayerUnder::Undecided => true,
    }
}

/// Whether the walk's surface is not what a reader sees under this text, for
/// the contrast verdicts outside the SAFE_TAGS path. The structural climb
/// ([`layer_under_text_found`]) says what paints under the run, and the
/// hit-test stacks ([`super::text_layers::layers_at_text`]) check it. Only
/// the climb's own finding counts here, a box it found under the whole run:
/// its hit-test fallback asks three points, and the stacks, which ask the
/// whole grid, already speak for the viewport. Where the stacks cannot say
/// (below the fold, a replay that never asked), or already see unread paint,
/// the climb decides; where they confirm the walk's
/// surface, the climb decides only for a layer that ignores pointer events,
/// which `elementsFromPoint` never lists (an `absolute inset-0
/// pointer-events-none` hero photo), and for an SVG shape drawn around the
/// text, whose fill the stacks cannot read either and so never contradict (an
/// initial's circle).
pub fn surface_unread(
    dom: &dyn Dom,
    under: (LayerUnder, Option<ElId>),
    resolved: Option<Rgba>,
    layers: super::text_layers::TextLayers,
) -> bool {
    use super::text_layers::TextLayers;
    if layer_matches_surface(under.0, resolved) || under.1.is_none() {
        return false;
    }
    match layers {
        TextLayers::Consistent => under
            .1
            .is_some_and(|n| is_svg(dom, n) || js::trim(&dom.style(n, "pointerEvents")) == "none"),
        TextLayers::Covered | TextLayers::UnreadSurface | TextLayers::Undecided => true,
    }
}

/// How many surfaces along the span [`unread_verdict`] reads.
const SPAN_SAMPLES: usize = 5;

fn mix(top: &Rgba, ground: &Rgba, alpha: f64) -> Rgba {
    let a = alpha.clamp(0.0, 1.0);
    Rgba {
        r: top.r * a + ground.r * (1.0 - a),
        g: top.g * a + ground.g * (1.0 - a),
        b: top.b * a + ground.b * (1.0 - a),
        a: Some(1.0),
    }
}

/// One layer of paint the climb found under the text and the walk never
/// read: what it paints and the opacity its box paints it at.
#[derive(Debug, Clone, Copy)]
struct UnreadLayer {
    found: ElId,
    under: LayerUnder,
    fade: f64,
}

impl UnreadLayer {
    fn new(dom: &dyn Dom, el: ElId, under: LayerUnder, found: ElId) -> Self {
        UnreadLayer {
            found,
            under,
            fade: layer_fade(dom, found, el).clamp(0.0, 1.0),
        }
    }

    /// Whether nothing beneath it shows through: an opaque fill, gradient
    /// or picture at full opacity, or paint whose colours are unknown, which
    /// can be anything from black to white whatever lies beneath.
    fn hides_beneath(&self, dom: &dyn Dom) -> bool {
        match self.under {
            LayerUnder::Unmodelled => super::text_layers::gradient_surface_stops(dom, self.found, 1.0).is_none(),
            LayerUnder::Picture | LayerUnder::Detached(_) | LayerUnder::Gradient { .. } => self.fade >= 0.999,
            LayerUnder::Ancestor | LayerUnder::Undecided => false,
        }
    }

    /// Whether the colours it paints are known: a fill or a gradient, not a
    /// picture or paint the capture does not describe.
    fn colours_known(&self, dom: &dyn Dom) -> bool {
        match self.under {
            LayerUnder::Detached(_) | LayerUnder::Gradient { .. } => true,
            LayerUnder::Unmodelled => super::text_layers::gradient_surface_stops(dom, self.found, 1.0).is_some(),
            _ => false,
        }
    }

    /// The surfaces it makes over any surface between `lo` and `hi`: a
    /// picture, or paint whose colours the capture does not give (an SVG
    /// shape, a translucent pseudo-element), is anything from black to white
    /// at its opacity; a fill or a gradient is its colours at that opacity.
    fn over(&self, dom: &dyn Dom, lo: Rgba, hi: Rgba) -> (Rgba, Rgba) {
        let black = Rgba::new(0.0, 0.0, 0.0, 1.0);
        let white = Rgba::new(255.0, 255.0, 255.0, 1.0);
        let f = self.fade;
        match self.under {
            LayerUnder::Detached(c) => (mix(&c, &lo, f), mix(&c, &hi, f)),
            LayerUnder::Gradient { lo: gl, hi: gh } => (mix(&gl, &lo, f), mix(&gh, &hi, f)),
            LayerUnder::Unmodelled => match super::text_layers::gradient_surface_stops(dom, self.found, 1.0) {
                Some(stops) => {
                    let faded: Vec<Rgba> = stops
                        .iter()
                        .map(|c| Rgba {
                            a: Some(c.alpha_or_one() * f),
                            ..*c
                        })
                        .collect();
                    span_under(&faded, lo, hi)
                }
                None => (mix(&black, &lo, f), mix(&white, &hi, f)),
            },
            _ => (mix(&black, &lo, f), mix(&white, &hi, f)),
        }
    }
}

/// How many layers of unread paint [`unread_verdict`] reads down through
/// before it gives up.
const UNREAD_MAX_LAYERS: usize = 4;

/// The nearest ancestor of `el` that holds `node`: the box a layer found
/// beside the text hangs from.
fn hang_of(dom: &dyn Dom, el: ElId, node: ElId) -> Option<ElId> {
    let mut cur = dom.parent(el);
    while let Some(c) = cur {
        if c == node || dom.contains(c, node) {
            return Some(c);
        }
        cur = dom.parent(c);
    }
    None
}

/// Whether the capture places the paint the climb found on `found` for
/// certain against the fills around it: a pseudo-element whose box or
/// `z-index` it did not record, or a negative `z-index` layer under a fill
/// whose stacking context it cannot tell (a capture older than
/// `isolation`), is [`Order::Unknown`]. The climb reads such paint as it
/// always did; a verdict of its own it does not decide.
fn found_order(dom: &dyn Dom, el: ElId, text: &Rect, found: ElId) -> Order {
    if let Some((_, certain)) = pseudo_paint_placed(dom, found, text) {
        if !certain {
            return Order::Unknown;
        }
    }
    let Some(hang) = hang_of(dom, el, found) else {
        return Order::Over;
    };
    if hang == found {
        return Order::Over;
    }
    // The stacking context the found box paints in, seen from the box both
    // hang from: the outermost one opened below it.
    let mut context = None;
    let mut cur = Some(found);
    for _ in 0..LAYER_MAX_LEVELS {
        let Some(n) = cur else { break };
        if n == hang {
            break;
        }
        if let Some(z) = box_layer(dom, n).context {
            context = Some((n, z));
        }
        cur = dom.parent(n);
    }
    match context {
        Some((n, z)) if z < FLOW_LAYER => dom
            .parent(n)
            .map_or(Order::Over, |p| negative_layer_order(dom, p)),
        _ => Order::Over,
    }
}

/// The colours an opaque fill or gradient the climb found (`under`) paints,
/// where it hides everything beneath it: not faded by its box, not a picture,
/// not paint whose colours the capture does not give. `el` is the element
/// whose surface it is.
pub fn opaque_detached_span(dom: &dyn Dom, el: ElId, under: (LayerUnder, Option<ElId>)) -> Option<(Rgba, Rgba)> {
    let found = under.1?;
    if layer_fade(dom, found, el) < 0.999 || found_order(dom, el, &dom.rect(el), found) != Order::Over {
        return None;
    }
    match under.0 {
        LayerUnder::Detached(c) => Some((c, c)),
        LayerUnder::Gradient { lo, hi } => Some((lo, hi)),
        _ => None,
    }
}

/// What a contrast verdict against the walk's surface is worth where the
/// structural climb found paint the walk never read under the text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnreadVerdict {
    /// The ink fails its bar over every surface that paint can make: the
    /// verdict is about a known fact and stands.
    Fails,
    /// The ink passes over every one of them: the walk's surface was wrong
    /// and so was its verdict.
    Passes,
    /// It depends on what the paint shows (a photo, a video, an SVG shape):
    /// only rendered pixels can say.
    Unknown,
}

/// The ancestors of `el` that paint the walk's translucent layers (its
/// overlays and its gradient host), outermost first, with the colours each
/// can paint.
fn walk_layers(dom: &dyn Dom, el: ElId, surface: &super::background::TextSurface) -> Vec<(ElId, Vec<Rgba>)> {
    let mut layers: Vec<(ElId, Vec<Rgba>)> = surface.overlays.iter().map(|(n, c)| (*n, vec![*c])).collect();
    if let Some(g) = surface.gradient_host {
        let stops = parse_gradient_colors(Some(&dom.style(g, "backgroundImage")));
        layers.push((g, stops));
    }
    let depth = |n: ElId| {
        let mut d = 0usize;
        let mut cur = Some(el);
        while let Some(c) = cur {
            if c == n {
                return d;
            }
            d += 1;
            cur = dom.flat_parent(c);
        }
        d
    };
    layers.sort_by_key(|(n, _)| std::cmp::Reverse(depth(*n)));
    layers
}

/// Composite paint of the given colours over every surface between `lo` and
/// `hi`: the new span, channel by channel.
fn span_under(layer: &[Rgba], lo: Rgba, hi: Rgba) -> (Rgba, Rgba) {
    if layer.is_empty() {
        return (lo, hi);
    }
    let over = |base: &Rgba| -> Vec<Rgba> { layer.iter().map(|c| mix(c, base, c.alpha_or_one())).collect() };
    let (a, b) = (over(&lo), over(&hi));
    let pick = |f: fn(f64, f64) -> f64, start: f64, v: &[Rgba]| Rgba {
        r: v.iter().map(|c| c.r).fold(start, f),
        g: v.iter().map(|c| c.g).fold(start, f),
        b: v.iter().map(|c| c.b).fold(start, f),
        a: Some(1.0),
    };
    let all: Vec<Rgba> = a.into_iter().chain(b).collect();
    (pick(f64::min, f64::INFINITY, &all), pick(f64::max, f64::NEG_INFINITY, &all))
}

/// What a contrast verdict is worth over the unread paint the climb found
/// under the text (`under`), read against every surface that paint can make.
/// The climb is asked again past each translucent layer it found (a glow, a
/// scrim, a faded painting) until it reaches paint that hides what is
/// beneath, or the walk's own ground, so a scrim over a photo is read as
/// one and a faint glow over a dark hero gradient as the other. The walk's
/// own translucent layers are put where they paint: an overlay or gradient on
/// an ancestor inside the box every layer hangs from lies over them, one at
/// or above those boxes under them, with the walk's opaque ground; one in
/// between is not read. A grain tile at `opacity: 0.085` or a 0.3 wash over
/// the page the walk read, and a dark hero gradient beside the content,
/// decide the verdict ([`UnreadVerdict::Fails`] or [`UnreadVerdict::Passes`]);
/// a photo at full opacity, or ground the walk could not read, leaves it
/// [`UnreadVerdict::Unknown`].
pub fn unread_verdict(
    dom: &dyn Dom,
    el: ElId,
    under: (LayerUnder, Option<ElId>),
    surface: &super::background::TextSurface,
    ink: Option<Rgba>,
    threshold: f64,
) -> UnreadVerdict {
    unread_reading(dom, el, under, surface, ink, threshold).verdict
}

/// A failing verdict read over unread paint, printed against that paint: the
/// surface in its span the ink reads best on, the ink as it reads there, and
/// the ratio, the most the text reaches.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rescore {
    pub surface: Rgba,
    pub ink: Rgba,
    pub ratio: f64,
    /// The box the paint was found on, which the finding names.
    pub layer: ElId,
}

/// [`unread_verdict`], with the rescore a failing verdict prints where the
/// walk's surface lies outside the span the paint can make (a dark panel
/// beside the content, not a grain over the page the walk read): the ratio
/// against the walk's surface would be about nothing a reader sees.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct UnreadReading {
    pub verdict: UnreadVerdict,
    pub rescore: Option<Rescore>,
}

pub fn unread_reading(
    dom: &dyn Dom,
    el: ElId,
    under: (LayerUnder, Option<ElId>),
    surface: &super::background::TextSurface,
    ink: Option<Rgba>,
    threshold: f64,
) -> UnreadReading {
    let unknown = UnreadReading { verdict: UnreadVerdict::Unknown, rescore: None };
    let (Some(found), Some(ink)) = (under.1, ink) else {
        return unknown;
    };
    if surface.info.unresolved || matches!(under.0, LayerUnder::Ancestor | LayerUnder::Undecided) {
        return unknown;
    }
    let text = dom.direct_text_rect(el).unwrap_or_else(|| dom.rect(el));
    if found_order(dom, el, &text, found) != Order::Over {
        return unknown;
    }
    let hosts = icon_hosts(dom, el);
    let mut chain = vec![UnreadLayer::new(dom, el, under.0, found)];
    let mut skip = vec![found];
    let mut on_ground = false;
    while !chain.last().is_some_and(|l| l.hides_beneath(dom)) {
        if chain.len() >= UNREAD_MAX_LAYERS {
            return unknown;
        }
        match climb_layers(dom, el, el, &text, &hosts, &skip) {
            (next, Some(node)) if !matches!(next, LayerUnder::Ancestor | LayerUnder::Undecided) => {
                if found_order(dom, el, &text, node) != Order::Over {
                    return unknown;
                }
                chain.push(UnreadLayer::new(dom, el, next, node));
                skip.push(node);
            }
            _ => {
                on_ground = true;
                break;
            }
        }
    }
    let Some(hangs) = chain
        .iter()
        .map(|l| hang_of(dom, el, l.found))
        .collect::<Option<Vec<ElId>>>()
    else {
        return unknown;
    };
    let mut above: Vec<Vec<Rgba>> = Vec::new();
    let mut below: Vec<(ElId, Vec<Rgba>)> = Vec::new();
    for (n, colours) in walk_layers(dom, el, surface) {
        let inside = hangs.iter().filter(|&&h| n != h && dom.contains(h, n)).count();
        if inside == hangs.len() {
            above.push(colours);
        } else if inside == 0 {
            below.push((n, colours));
        } else {
            return unknown;
        }
    }
    let (mut lo, mut hi) = if on_ground {
        // The walk's opaque ground, or, where it ended on a gradient, the
        // ground that gradient is flattened over.
        let base = surface.base.or_else(|| {
            let host = surface.gradient_host?;
            let parent = dom.flat_parent(host)?;
            let info = super::background::resolve_background_info(dom, parent);
            (!info.unresolved).then_some(info.color).flatten()
        });
        let Some(mut ground) = base else {
            return unknown;
        };
        for (n, colours) in &below {
            if Some(*n) == surface.gradient_host || colours.len() != 1 {
                return unknown;
            }
            ground = mix(&colours[0], &ground, colours[0].alpha_or_one());
        }
        (ground, ground)
    } else {
        (Rgba::new(0.0, 0.0, 0.0, 1.0), Rgba::new(255.0, 255.0, 255.0, 1.0))
    };
    for layer in chain.iter().rev() {
        (lo, hi) = layer.over(dom, lo, hi);
    }
    for colours in &above {
        (lo, hi) = span_under(colours, lo, hi);
    }
    let readings: Vec<(Rgba, Rgba, f64)> = (0..SPAN_SAMPLES)
        .map(|i| {
            let surface = mix(&hi, &lo, i as f64 / (SPAN_SAMPLES - 1) as f64);
            let seen = blend_rgba(Some(&ink), Some(&surface)).unwrap_or(ink);
            (surface, seen, contrast_ratio(&seen, &surface))
        })
        .collect();
    if readings.iter().all(|r| r.2 >= threshold) {
        return UnreadReading { verdict: UnreadVerdict::Passes, rescore: None };
    }
    if !readings.iter().all(|r| r.2 < threshold) {
        return unknown;
    }
    // How far the walk's surface lies outside the span, channel by channel.
    // Only a flat surface the walk named is compared, and only a span of
    // known colours (fills and gradients, not a picture's anything) names a
    // surface worth printing.
    let known = chain.iter().all(|l| l.colours_known(dom));
    let outside = surface.info.color.map_or(0.0, |c| {
        let off = |v: f64, a: f64, b: f64| math_max(0.0, math_max(a.min(b) - v, v - a.max(b)));
        off(c.r, lo.r, hi.r) + off(c.g, lo.g, hi.g) + off(c.b, lo.b, hi.b)
    });
    let byte = |c: Rgba| Rgba {
        r: clamp_byte(c.r),
        g: clamp_byte(c.g),
        b: clamp_byte(c.b),
        a: Some(1.0),
    };
    let rescore = (known && outside > SAME_SURFACE_DISTANCE)
        .then(|| {
            readings
                .iter()
                .copied()
                .fold(None::<(Rgba, Rgba, f64)>, |best, r| match best {
                    Some(b) if b.2 >= r.2 => Some(b),
                    _ => Some(r),
                })
                .map(|(surface, ink, _)| {
                    let (surface, ink) = (byte(surface), byte(ink));
                    Rescore { surface, ink, ratio: contrast_ratio(&ink, &surface), layer: chain[0].found }
                })
        })
        .flatten();
    UnreadReading { verdict: UnreadVerdict::Fails, rescore }
}

/// The WCAG bar for text at this size and weight.
pub fn contrast_threshold(font_size: f64, font_weight: f64) -> f64 {
    if font_size >= WCAG_LARGE_TEXT_PX || (font_size >= WCAG_LARGE_BOLD_TEXT_PX && font_weight >= 700.0) {
        3.0
    } else {
        4.5
    }
}

/// A text-shadow layer at most this blurred draws an edge around the glyph,
/// not a glow.
const OUTLINE_MAX_BLUR_PX: f64 = 2.0;

/// Whether the text is drawn with an outline in a colour of its own, which is
/// what a reader sees its fill against: a `-webkit-text-stroke` wider than
/// zero, or a text-shadow ring, two or more sharp, opaque layers offset in
/// opposing directions (`-2px -2px 0 #14224a, 2px 2px 0 #14224a, ...`, the
/// sticker look). A single drop shadow and a soft glow are not outlines. Its
/// contrast is the outline's and the fill's together, which only rendered
/// pixels say, so the fill-only verdict is not printed and the pixel pass
/// reads it. A capture made before the stroke was recorded reads no stroke.
pub fn text_outlined(dom: &dyn Dom, el: ElId) -> bool {
    let ink = parse_rgb_or_any(&dom.style(el, "color"));
    let distinct = |c: &Rgba| {
        c.alpha_or_one() >= 0.5
            && ink.map_or(true, |i| {
                (i.r - c.r).abs() + (i.g - c.g).abs() + (i.b - c.b).abs() > SAME_SURFACE_DISTANCE
            })
    };
    let stroke = parse_float(&dom.style(el, "webkitTextStrokeWidth"));
    if stroke.is_finite() && stroke > 0.0 {
        if let Some(c) = parse_rgb_or_any(&dom.style(el, "webkitTextStrokeColor")) {
            if distinct(&c) {
                return true;
            }
        }
    }
    let shadow = dom.style(el, "textShadow");
    let shadow = js::trim(&shadow);
    if shadow.is_empty() || shadow == "none" {
        return false;
    }
    let mut offsets: Vec<(f64, f64)> = Vec::new();
    for layer in crate::js_ext_a::split_commas_outside_parens(shadow) {
        let Some(info) = crate::checks::rules::find_shadow_color(layer) else { continue };
        let Some(color) = info.color else { continue };
        if !distinct(&color) {
            continue;
        }
        let vals = crate::checks::rules::extract_shadow_lengths(layer, Some((info.start, info.end)));
        let (x, y) = (vals.first().copied().unwrap_or(0.0), vals.get(1).copied().unwrap_or(0.0));
        let blur = vals.get(2).copied().unwrap_or(0.0);
        if blur <= OUTLINE_MAX_BLUR_PX && x.hypot(y) >= 0.5 {
            offsets.push((x, y));
        }
    }
    offsets
        .iter()
        .enumerate()
        .any(|(i, a)| offsets[i + 1..].iter().any(|b| a.0 * b.0 + a.1 * b.1 < 0.0))
}

/// Below this computed font size no glyph paints: a launcher button whose
/// label is set in `font-size: 0` and drawn by an icon instead.
const MIN_GLYPH_PX: f64 = 1.0;

/// Whether a candidate's text is where a reader could see and is asked to
/// read it at rest, the gates the element pass puts in front of every text
/// measurement. The pass samples pixels, and since it scrolls an off-canvas
/// candidate into view, what it measures there is whatever that scroll
/// brought into the capture, not what a visitor sees: the cells of a tab
/// strip past its clipping edge, a carousel badge parked beside the page.
///
/// - A disabled control (WCAG 1.4.3 exempts inactive components).
/// - Text in a font under a pixel, or inked in a colour at or near alpha 0,
///   paints no glyph. `-webkit-text-fill-color: transparent` counts too,
///   except on a box that clips its own background to its text: that is a
///   gradient heading, which both passes already refuse, and it keeps the
///   slot it always had.
/// - An element not painted at capture ([`unpainted_for`] with
///   [`PaintGate::Text`]): hidden, transparent, clipped out, outside the
///   document, visually hidden, or with no area.
///
/// Glyph-only and emoji-only text is refused by the caller, before this.
/// What the capture did not record keeps the candidate, as the predicate
/// does.
fn candidate_text_reads_at_rest(dom: &dyn Dom, el: ElId) -> bool {
    if closest_or_none(dom, el, DISABLED_CONTROL_SELECTOR).is_some() {
        return false;
    }
    let font_size = parse_float(&dom.style(el, "fontSize"));
    if font_size.is_finite() && font_size < MIN_GLYPH_PX {
        return false;
    }
    let clip = {
        let a = dom.style(el, "webkitBackgroundClip");
        if a.is_empty() {
            dom.style(el, "backgroundClip")
        } else {
            a
        }
    };
    if js::trim(&clip) != "text" {
        let ink_gone = parse_rgb_or_any(&dom.style(el, "color"))
            .map_or(false, |c| c.alpha_or_one() <= TRANSPARENT_INK_FLOOR);
        if ink_gone || text_fill_is_transparent(&dom.style(el, "webkitTextFillColor")) {
            return false;
        }
    }
    unpainted_for(dom, el, PaintGate::Text).is_none()
}

/// JS: index.mjs#collectVisualContrastCandidates(options)
///
/// A candidate has to pass the element pass's text gates first
/// ([`candidate_text_reads_at_rest`]), before its reasons are read (which
/// asks hit tests) and before it takes one of the `maxCandidates` slots, so a
/// page's hidden slides no longer spend the budget its visible text needs.
///
/// `maxRoutedCandidates` (0 unless given) is a second budget, for the text
/// the element pass hands over rather than scores: text over paint the
/// contrast walk never read ([`layer_under_text`] finds a picture, a
/// gradient, an SVG shape or a detached panel the walk's surface is not), a
/// link or a span with no fill of its own among it, and text drawn with an
/// outline ([`text_outlined`]). They are taken in document order after the
/// first budget's candidates, which stay exactly what they were, and carry
/// the reason `unread layer` or `text outline`, which the sampled pass
/// refuses, so only rendered pixels answer for them. A candidate of either
/// budget that the element pass hands over carries it as `routed` too.
pub fn collect_visual_contrast_candidates(dom: &dyn Dom, options: &Value) -> Vec<Value> {
    let budget = |key: &str, default: f64| match options.get(key) {
        Some(Value::Number(n)) if n.as_f64().map_or(false, f64::is_finite) => n.as_f64().unwrap(),
        _ => default,
    };
    let max_candidates = budget("maxCandidates", 12.0);
    let image_only = truthy(options.get("imageOnly"));
    let max_routed = if image_only { 0.0 } else { budget("maxRoutedCandidates", 0.0) };
    let body = dom.body();
    let root = dom.document_element();
    let mut candidates: Vec<Value> = Vec::new();
    let mut routed: Vec<Value> = Vec::new();
    for el in dom.query_all(None, "*").unwrap_or_default() {
        let base_open = (candidates.len() as f64) < max_candidates;
        let routed_open = (routed.len() as f64) < max_routed;
        if !base_open && !routed_open {
            break;
        }
        if closest_or_none(dom, el, OVERLAY_SELECTOR).is_some() {
            continue;
        }
        if closest_or_none(dom, el, LIVE_SELECTOR).is_some() {
            continue;
        }
        if Some(el) == body || Some(el) == root {
            continue;
        }
        // The element pass has no `aria-hidden` gate, so a verdict it hands
        // over on painted text inside an `aria-hidden` box would never be
        // read here and never replaced. Such text takes a slot of the second
        // budget only; the first is what it always was.
        let rendered = super::element_checks::is_rendered_for_browser_rule(dom, el);
        if !rendered && !(routed_open && super::element_checks::is_painted_for_browser_rule(dom, el)) {
            continue;
        }
        let tag = tag_lower(dom, el);
        if dom.style(el, "display") == "none" || dom.style(el, "visibility") == "hidden" {
            continue;
        }
        let direct = direct_text(dom, el);
        let has_direct_text = !js::trim(&direct).is_empty();
        // Text with no letter and no digit (a lone circle, a pair of braces),
        // an icon font's ligature or a close control's `x` is not read, on
        // this path as on every other.
        if !has_direct_text
            || is_emoji_only_text(&direct)
            || super::element_checks::is_icon_text(dom, el, &direct)
        {
            continue;
        }
        if base_open && rendered {
            if let Some(c) = base_candidate(dom, el, &tag, &direct, image_only) {
                candidates.push(c);
                continue;
            }
        }
        if routed_open {
            if let Some(c) = routed_candidate(dom, el, &tag, &direct) {
                routed.push(c);
            }
        }
    }
    candidates.extend(routed);
    candidates
}

/// The first budget's candidate for `el`, exactly as the collector has always
/// taken it: text that is not a plain link or span, with a reason the
/// element pass's colours may not describe what paints.
fn base_candidate(dom: &dyn Dom, el: ElId, tag: &str, direct: &str, image_only: bool) -> Option<Value> {
    let bg_color = super::background::read_own_background_color(dom, el);
    let is_styled_button = (tag == "a" || tag == "button")
        && bg_color.map_or(false, |c| c.a.map_or(false, |a| a > 0.5));
    if SAFE_TAGS.contains(&tag) && !is_styled_button {
        return None;
    }
    let rect = dom.direct_text_rect(el).unwrap_or_else(|| dom.rect(el));
    if rect.width < 4.0 || rect.height < 4.0 {
        return None;
    }
    if !candidate_text_reads_at_rest(dom, el) {
        return None;
    }
    // A box caught mid-reveal paints one frame of a fade; its pixels say
    // nothing about the contrast a visitor meets once it settles.
    if super::element_checks::caught_mid_reveal(dom, el) {
        return None;
    }
    let reasons = collect_visual_contrast_reasons(dom, el);
    if reasons.is_empty() {
        return None;
    }
    if image_only && !reasons.iter().any(|r| r == "image background") {
        return None;
    }
    // Text another layer covers at capture (a fixed consent banner, a photo
    // over an initial) is scored by no pass. The element pass stands down
    // on it, and the samples here read only what lies under the text.
    if crate::browser::text_layers::layers_at_text(dom, el, None, None)
        == crate::browser::text_layers::TextLayers::Covered
    {
        return None;
    }
    // Text the element pass hands over is marked in either budget, so the
    // URL engine lets the pixels replace its verdict. In this budget the
    // candidate keeps the reasons it always had, and the sampled pass reads
    // it as before.
    let routed = if image_only { None } else { routed_reason(dom, el) };
    let mut value = candidate_value(dom, el, tag, direct, &rect, reasons);
    if let (Some(reason), Value::Object(m)) = (routed, &mut value) {
        m.insert("routed".into(), Value::String(reason.to_string()));
        // Outlined glyphs are read in the colours they paint, the outline
        // included, not in their fill alone.
        if reason == "text outline" {
            m.insert("preferRenderedForeground".into(), Value::Bool(true));
        }
    }
    Some(value)
}

/// Why the element pass hands this text to the pixels rather than scoring
/// it, if it does: `unread layer` where the structural climb finds paint the
/// contrast walk never read under the run, `text outline` where the glyphs
/// carry an outline. The climb reads layout only, so it answers below the
/// fold and through layers that ignore pointer events.
///
/// A link or a span with no fill of its own is waived by the element pass on
/// any answer the climb gives, its hit-test fallback included, so it is
/// handed over on the same answer; other text only on a box the climb found
/// under the whole run, as [`surface_unread`] reads it.
pub fn routed_reason(dom: &dyn Dom, el: ElId) -> Option<&'static str> {
    let ink = dom.text_slot(el).unwrap_or(el);
    if text_outlined(dom, ink) {
        return Some("text outline");
    }
    let (under, found) = layer_under_text_found(dom, el);
    if matches!(under, LayerUnder::Ancestor | LayerUnder::Undecided) {
        return None;
    }
    if found.is_none() && !SAFE_TAGS.contains(&tag_lower(dom, el).as_str()) {
        return None;
    }
    let text = dom.direct_text_rect(el).unwrap_or_else(|| dom.rect(el));
    let font_size = {
        let v = parse_float(&dom.style(ink, "fontSize"));
        if num_truthy(v) {
            v
        } else {
            16.0
        }
    };
    let font_weight = {
        let v = parse_int(&dom.style(ink, "fontWeight"), 10);
        if num_truthy(v) {
            v
        } else {
            400.0
        }
    };
    let font_weight =
        crate::checks::rules::contrast_font_weight(font_weight, &dom.style(ink, "fontFamily"));
    let icons = icon_hosts(dom, el);
    let surface = super::background::resolve_text_surface(
        dom,
        ink,
        &|n| icons.contains(&n),
        crate::checks::gradient_geometry::Box2::new(text.left, text.top, text.width, text.height),
        font_size,
    );
    let resolved = if surface.info.unresolved { None } else { surface.info.color };
    if layer_matches_surface(under, resolved) {
        return None;
    }
    // A verdict the unread paint decides either way is the element pass's
    // to print or drop; only one that depends on the paint needs pixels. Ink
    // in exactly the walk's surface colour is the exception: the element
    // pass prints no `1.0:1` it cannot confirm, so the pixels answer for it.
    let ink_color = parse_rgb_or_any(&dom.style(ink, "color"));
    let same_hex = matches!((ink_color, resolved), (Some(i), Some(bg))
        if crate::color::color_to_hex(Some(&i)) == crate::color::color_to_hex(Some(&bg)));
    let threshold = contrast_threshold(font_size, font_weight);
    (same_hex
        || unread_verdict(dom, el, (under, found), &surface, ink_color, threshold) == UnreadVerdict::Unknown)
        .then_some("unread layer")
}

/// The second budget's candidate for `el` ([`routed_reason`]), past the
/// same text gates as the first.
fn routed_candidate(dom: &dyn Dom, el: ElId, tag: &str, direct: &str) -> Option<Value> {
    if closest_or_none(dom, el, DISABLED_CONTROL_SELECTOR).is_some() {
        return None;
    }
    let rect = dom.direct_text_rect(el).unwrap_or_else(|| dom.rect(el));
    if rect.width < 4.0 || rect.height < 4.0 {
        return None;
    }
    if !candidate_text_reads_at_rest(dom, el) || super::element_checks::caught_mid_reveal(dom, el) {
        return None;
    }
    let reason = routed_reason(dom, el)?;
    if crate::browser::text_layers::layers_at_text(dom, el, None, None)
        == crate::browser::text_layers::TextLayers::Covered
    {
        return None;
    }
    let mut reasons = collect_visual_contrast_reasons(dom, el);
    reasons.push(reason.to_string());
    let mut value = candidate_value(dom, el, tag, direct, &rect, reasons);
    if let Value::Object(m) = &mut value {
        m.insert("routed".into(), Value::String(reason.to_string()));
    }
    Some(value)
}

fn candidate_value(dom: &dyn Dom, el: ElId, tag: &str, direct: &str, rect: &Rect, reasons: Vec<String>) -> Value {
    let text_color = parse_rgb_or_any(&dom.style(el, "color"));
    let font_size = {
        let v = parse_float(&dom.style(el, "fontSize"));
        if num_truthy(v) {
            v
        } else {
            16.0
        }
    };
    let font_weight = {
        let v = parse_int(&dom.style(el, "fontWeight"), 10);
        if num_truthy(v) {
            v
        } else {
            400.0
        }
    };
    let font_weight =
        crate::checks::rules::contrast_font_weight(font_weight, &dom.style(el, "fontFamily"));
    let is_large_text = font_size >= WCAG_LARGE_TEXT_PX
        || (font_size >= WCAG_LARGE_BOLD_TEXT_PX && font_weight >= 700.0);
    let threshold = if is_large_text { 3.0 } else { 4.5 };
    let sx = dom.scroll_x();
    let sy = dom.scroll_y();
    let clip = json!({
        "x": math_max(0.0, (rect.left + sx - 2.0).floor()),
        "y": math_max(0.0, (rect.top + sy - 2.0).floor()),
        "width": math_max(1.0, (rect.width + 4.0).ceil()),
        "height": math_max(1.0, (rect.height + 4.0).ceil()),
    });
    let prefer_rendered = text_color.is_none()
        || text_color.map_or(false, |c| c.a.unwrap_or(f64::NAN) < 0.99)
        || reasons.iter().any(|r| {
            matches!(
                r.as_str(),
                "opacity stack"
                    | "blend mode"
                    | "filter"
                    | "backdrop filter"
                    | "background-clip text"
                    | "text outline"
            )
        });
    let text = slice_utf16_prefix(&collapse_ws(js::trim(direct)), 80);
    let mut m = Map::new();
    let selector = super::driver::generate_selector(dom, el);
    let identity = candidate_match(dom, &selector, el);
    m.insert("selector".into(), Value::String(selector));
    m.insert("tagName".into(), Value::String(tag.to_string()));
    m.insert("text".into(), Value::String(text));
    m.insert("threshold".into(), json!(threshold));
    m.insert("reasons".into(), json!(reasons));
    m.insert("clip".into(), clip);
    m.insert("textColor".into(), rgba_value(text_color.as_ref()));
    m.insert("preferRenderedForeground".into(), Value::Bool(prefer_rendered));
    m.insert(
        "backgroundClipText".into(),
        Value::Bool(reasons.iter().any(|r| r == "background-clip text")),
    );
    // Text with no reading job reports as advisory from either visual
    // pass; the key is only written when it holds.
    if super::decorative_text::is_decorative_text_dom(dom, el) {
        m.insert("decorative".into(), Value::Bool(true));
    }
    if let Some(identity) = identity {
        m.insert("match".into(), identity);
    }
    Value::Object(m)
}

// ─── pure math ──────────────────────────────────────────────────────────────

/// JS: index.mjs#clampByte(value)
pub fn clamp_byte(value: f64) -> f64 {
    math_max(0.0, math_min(255.0, math_round(value)))
}

/// JS: index.mjs#blendRgba(fg, bg)
pub fn blend_rgba(fg: Option<&Rgba>, bg: Option<&Rgba>) -> Option<Rgba> {
    let Some(fg) = fg else { return bg.copied() };
    if bg.is_none() || fg.a.is_none() || fg.a.unwrap() >= 0.999 {
        return Some(Rgba {
            r: clamp_byte(fg.r),
            g: clamp_byte(fg.g),
            b: clamp_byte(fg.b),
            a: Some(fg.a.unwrap_or(1.0)),
        });
    }
    let bg = bg.unwrap();
    let alpha = math_max(0.0, math_min(1.0, fg.a.unwrap()));
    Some(Rgba {
        r: clamp_byte(fg.r * alpha + bg.r * (1.0 - alpha)),
        g: clamp_byte(fg.g * alpha + bg.g * (1.0 - alpha)),
        b: clamp_byte(fg.b * alpha + bg.b * (1.0 - alpha)),
        a: Some(1.0),
    })
}

/// A background-color this translucent paints nothing worth reading; the
/// walk keeps going for what is under it (`sampleCssBackground`'s own cut-off).
const MIN_PAINTED_ALPHA: f64 = 0.05;
/// How far two opaque stops of one gradient may sit apart before the answer
/// depends on where in the box the text is.
const GRADIENT_STOP_SPREAD: f64 = 2.0;

/// What the analytic pass can say about a gradient it cannot position.
#[derive(Debug, Clone, PartialEq)]
pub enum GradientVerdict {
    /// Every stop agrees: the worst of them stands for the surface.
    Color(Rgba),
    /// The stops disagree, so which one is behind the glyphs decides the
    /// answer and nothing here knows which. Rendered pixels have to say.
    Unresolved,
}

/// JS: the gradient branch of `sampleCssBackground`, made answerable. A
/// translucent stop (`rgba(171, 171, 171, 0)` is how a browser serializes the
/// transparent end of a glow, and `from-primary/10` is a wash, not a slab)
/// composites differently at every point of the box, and two opaque stops far
/// apart pick out different verdicts at each end. `None` when the value
/// carries no stop at all.
pub fn analytic_gradient_verdict(text_color: &Rgba, colors: &[Rgba]) -> Option<GradientVerdict> {
    if colors.is_empty() {
        return None;
    }
    if colors.iter().any(|c| c.a.unwrap_or(1.0) < 0.95) {
        return Some(GradientVerdict::Unresolved);
    }
    let ratios: Vec<f64> = colors.iter().map(|c| contrast_ratio(text_color, c)).collect();
    let lo = ratios.iter().copied().fold(f64::INFINITY, math_min);
    let hi = ratios.iter().copied().fold(0.0, math_max);
    if lo > 0.0 && hi >= lo * GRADIENT_STOP_SPREAD {
        return Some(GradientVerdict::Unresolved);
    }
    pick_worst_contrast_color(text_color, colors).map(GradientVerdict::Color)
}

/// JS: index.mjs#pickWorstContrastColor(textColor, colors)
pub fn pick_worst_contrast_color(text_color: &Rgba, colors: &[Rgba]) -> Option<Rgba> {
    if colors.is_empty() {
        return None;
    }
    let mut worst = colors[0];
    let mut worst_ratio = contrast_ratio(text_color, &worst);
    for c in &colors[1..] {
        let ratio = contrast_ratio(text_color, c);
        if ratio < worst_ratio {
            worst = *c;
            worst_ratio = ratio;
        }
    }
    Some(worst)
}

/// JS: index.mjs#firstCssUrl(value)
pub fn first_css_url(value: &str) -> String {
    let Some(m) = FIRST_CSS_URL_RE.captures(value) else { return String::new() };
    let pick = m
        .get(1)
        .or_else(|| m.get(2))
        .or_else(|| m.get(3))
        .map(|g| g.as_str())
        .unwrap_or("");
    // JS `(match[1] || match[2] || match[3] || '')`: an empty group falls
    // through to the next one.
    let s = if !pick.is_empty() {
        pick
    } else {
        [m.get(2), m.get(3)]
            .iter()
            .flatten()
            .map(|g| g.as_str())
            .find(|s| !s.is_empty())
            .unwrap_or("")
    };
    js::trim(s).to_string()
}

/// JS: index.mjs#getLayerValue(value, index)
pub fn get_layer_value(value: &str, index: usize) -> String {
    value
        .split(',')
        .nth(index)
        .map(|s| js::trim(s).to_string())
        .unwrap_or_default()
}

/// JS: index.mjs#parsePositionToken(token, container, painted)
pub fn parse_position_token(token: &str, container: f64, painted: f64) -> f64 {
    if token.is_empty() || token == "center" {
        return (container - painted) / 2.0;
    }
    if token == "left" || token == "top" {
        return 0.0;
    }
    if token == "right" || token == "bottom" {
        return container - painted;
    }
    if PCT_END.is_match(token) {
        let pct = parse_float(token) / 100.0;
        return (container - painted) * pct;
    }
    if PX_END.is_match(token) {
        return pf0(token);
    }
    (container - painted) / 2.0
}

/// JS: index.mjs#parsePositionPair(positionValue)
pub fn parse_position_pair(position_value: &str) -> (String, String) {
    let src = if position_value.is_empty() { "50% 50%" } else { position_value };
    let tokens: Vec<&str> = split_ws(js::trim(src))
        .into_iter()
        .filter(|t| !t.is_empty())
        .collect();
    let first = tokens.first().copied().unwrap_or("50%");
    if tokens.len() < 2 {
        if first == "top" || first == "bottom" {
            return ("50%".into(), first.into());
        }
        return (first.into(), "50%".into());
    }
    let second = tokens[1];
    (first.into(), if second.is_empty() { "50%".into() } else { second.into() })
}

/// JS `image.naturalWidth || image.videoWidth || image.width || 1` — the JS
/// side hands the already-`||`-chained value, 0 when none.
fn intrinsic_or_one(v: f64) -> f64 {
    if num_truthy(v) {
        v
    } else {
        1.0
    }
}

/// JS: index.mjs#resolvePaintedImageRect(containerRect, image, sizeValue, positionValue)
pub fn resolve_painted_image_rect(
    container: &Box4,
    intrinsic_w: f64,
    intrinsic_h: f64,
    size_value: &str,
    position_value: &str,
) -> PaintedRect {
    let iw = intrinsic_or_one(intrinsic_w);
    let ih = intrinsic_or_one(intrinsic_h);
    let mut painted_w = iw;
    let mut painted_h = ih;
    let size = js::trim(if size_value.is_empty() { "auto" } else { size_value });
    if size == "cover" || size == "contain" {
        let scale = if size == "cover" {
            math_max(container.width / iw, container.height / ih)
        } else {
            math_min(container.width / iw, container.height / ih)
        };
        painted_w = iw * scale;
        painted_h = ih * scale;
    } else if !size.is_empty() && size != "auto" {
        let parts = split_ws(size);
        let width_token = parts.first().copied().unwrap_or("");
        let height_token = parts.get(1).copied().filter(|s| !s.is_empty()).unwrap_or("auto");
        if PCT_END.is_match(width_token) {
            painted_w = container.width * (parse_float(width_token) / 100.0);
        } else if PX_END.is_match(width_token) {
            let v = parse_float(width_token);
            if num_truthy(v) {
                painted_w = v;
            }
        }
        if height_token == "auto" {
            painted_h = painted_w * (ih / iw);
        } else if PCT_END.is_match(height_token) {
            painted_h = container.height * (parse_float(height_token) / 100.0);
        } else if PX_END.is_match(height_token) {
            let v = parse_float(height_token);
            if num_truthy(v) {
                painted_h = v;
            }
        }
    }
    let (x_token, y_token) = parse_position_pair(position_value);
    let position_x = parse_position_token(&x_token, container.width, painted_w);
    let position_y = parse_position_token(&y_token, container.height, painted_h);
    PaintedRect {
        left: container.left + position_x,
        top: container.top + position_y,
        width: painted_w,
        height: painted_h,
        intrinsic_width: iw,
        intrinsic_height: ih,
    }
}

/// JS: index.mjs#resolveObjectImageRect(containerRect, image, style)
pub fn resolve_object_image_rect(
    container: &Box4,
    intrinsic_w: f64,
    intrinsic_h: f64,
    object_fit: &str,
    object_position: &str,
) -> PaintedRect {
    let iw = intrinsic_or_one(intrinsic_w);
    let ih = intrinsic_or_one(intrinsic_h);
    let fit = if object_fit.is_empty() { "fill" } else { object_fit };
    let mut painted_w = container.width;
    let mut painted_h = container.height;
    if fit == "contain" || fit == "cover" {
        let scale = if fit == "cover" {
            math_max(container.width / iw, container.height / ih)
        } else {
            math_min(container.width / iw, container.height / ih)
        };
        painted_w = iw * scale;
        painted_h = ih * scale;
    } else if fit == "none" {
        painted_w = iw;
        painted_h = ih;
    } else if fit == "scale-down" {
        let contain_scale = math_min(math_min(container.width / iw, container.height / ih), 1.0);
        painted_w = iw * contain_scale;
        painted_h = ih * contain_scale;
    }
    let (x_token, y_token) = parse_position_pair(object_position);
    PaintedRect {
        left: container.left + parse_position_token(&x_token, container.width, painted_w),
        top: container.top + parse_position_token(&y_token, container.height, painted_h),
        width: painted_w,
        height: painted_h,
        intrinsic_width: iw,
        intrinsic_height: ih,
    }
}

/// JS: index.mjs#pointToImageSource(point, paintedRect)
pub fn point_to_image_source(x: f64, y: f64, painted: &PaintedRect) -> Option<(f64, f64)> {
    if x < painted.left
        || y < painted.top
        || x > painted.left + painted.width
        || y > painted.top + painted.height
    {
        return None;
    }
    Some((
        math_max(
            0.0,
            math_min(
                painted.intrinsic_width - 1.0,
                ((x - painted.left) / painted.width) * painted.intrinsic_width,
            ),
        ),
        math_max(
            0.0,
            math_min(
                painted.intrinsic_height - 1.0,
                ((y - painted.top) / painted.height) * painted.intrinsic_height,
            ),
        ),
    ))
}

/// JS: index.mjs#textSamplePoints(rect)
pub fn text_sample_points(rect: &Rect, inner_width: f64, inner_height: f64) -> Vec<(f64, f64)> {
    let inset_x = math_min(12.0, math_max(1.0, rect.width * 0.12));
    let inset_y = math_min(8.0, math_max(1.0, rect.height * 0.22));
    let xs: Vec<f64> = if rect.width < 28.0 {
        vec![rect.left + rect.width / 2.0]
    } else {
        vec![
            rect.left + inset_x,
            rect.left + rect.width / 2.0,
            rect.right - inset_x,
        ]
    };
    let ys: Vec<f64> = if rect.height < 22.0 {
        vec![rect.top + rect.height / 2.0]
    } else {
        vec![
            rect.top + inset_y,
            rect.top + rect.height / 2.0,
            rect.bottom - inset_y,
        ]
    };
    let mut points = Vec::new();
    for &y in &ys {
        for &x in &xs {
            if x >= 0.0 && y >= 0.0 && x <= inner_width && y <= inner_height {
                points.push((x, y));
            }
        }
    }
    points
}

// ─── raster sampling helpers (sampleDrawablePixel) ─────────────────────────

/// JS: index.mjs#sampleDrawablePixel (canvas sizing)
pub fn raster_plan(intrinsic_w: f64, intrinsic_h: f64) -> RasterPlan {
    let iw = intrinsic_or_one(intrinsic_w);
    let ih = intrinsic_or_one(intrinsic_h);
    let max_raster_side = 640.0;
    let scale = math_min(1.0, max_raster_side / math_max(iw, ih));
    let width = math_max(1.0, math_round(iw * scale));
    let height = math_max(1.0, math_round(ih * scale));
    RasterPlan {
        width,
        height,
        scale_x: width / iw,
        scale_y: height / ih,
    }
}

/// JS: index.mjs#sampleDrawablePixel (source point → raster pixel)
pub fn raster_pixel(plan: &RasterPlan, source_x: f64, source_y: f64) -> (f64, f64) {
    (
        math_max(0.0, math_min(plan.width - 1.0, (source_x * plan.scale_x).floor())),
        math_max(0.0, math_min(plan.height - 1.0, (source_y * plan.scale_y).floor())),
    )
}

/// JS: `{ status: 'sampled', color: { r, g, b, a: data[3] / 255 } }`.
pub fn pixel_sample(r: f64, g: f64, b: f64, a255: f64) -> Value {
    json!({ "status": "sampled", "color": { "r": r, "g": g, "b": b, "a": a255 / 255.0 } })
}

/// JS: the canvas draw / getImageData error classification.
pub fn raster_error_reason(message: &str) -> String {
    if TAINT_RE.is_match(message) {
        "tainted image".to_string()
    } else {
        "image sample failed".to_string()
    }
}

/// JS: `{ status: 'unresolved', reason: cached?.reason || 'image sample failed' }`.
pub fn raster_failure_sample(reason: &str) -> Value {
    let reason = if reason.is_empty() { "image sample failed" } else { reason };
    json!({ "status": "unresolved", "reason": reason })
}

/// JS: `{ status: 'unresolved', reason: 'canvas unavailable' }`.
pub fn raster_no_context_sample() -> Value {
    json!({ "status": "unresolved", "reason": "canvas unavailable" })
}

// ─── the background stack walk (sampleVisualBackgroundAtPoint) ─────────────

/// Whether a box above `el` that clips its overflow (`overflow` other than
/// `visible`, on either axis) leaves the point `(x, y)` outside its rect.
fn point_clipped_by_ancestor(dom: &dyn Dom, el: ElId, x: f64, y: f64) -> bool {
    let mut cur = dom.parent(el);
    while let Some(p) = cur {
        let clips = ["overflow", "overflowX", "overflowY"].iter().any(|k| {
            let v = dom.style(p, k);
            v.split_whitespace().any(|t| matches!(t, "hidden" | "clip" | "auto" | "scroll"))
        });
        if clips && dom.style(p, "display") != "contents" {
            let r = dom.rect(p);
            if r.width > 0.0
                && r.height > 0.0
                && (x < r.left - 1.0 || x > r.right + 1.0 || y < r.top - 1.0 || y > r.bottom + 1.0)
            {
                return true;
            }
        }
        cur = dom.parent(p);
    }
    false
}

/// JS: index.mjs#sampleVisualBackgroundAtPoint — the depth cap and the node
/// list (`elementsFromPoint` stack from the element down, overlay chrome
/// skipped). `Err` carries the early-unresolved sample.
pub fn stack_nodes(dom: &dyn Dom, el: ElId, x: f64, y: f64, depth: f64) -> Result<Vec<StackNode>, Value> {
    if depth > 8.0 {
        return Err(json!({ "status": "unresolved", "reason": "background stack too deep" }));
    }
    let stack = dom.elements_from_point(x, y);
    let self_index = stack.iter().position(|&n| n == el || dom.contains(el, n));
    // Text the hit test does not find at the point, where a box between it
    // and the page clips the point away, is not on screen there: what the
    // stack holds is whatever lies under the clipped-off part (telekom.de's
    // consent notice scrolls its list inside a 414px box, and the page's 50%
    // backdrop answers below it). Text that ignores pointer events is never
    // in the stack and keeps the walk from the element down.
    if self_index.is_none()
        && dom.style(el, "pointerEvents") != "none"
        && point_clipped_by_ancestor(dom, el, x, y)
    {
        return Err(json!({ "status": "unresolved", "reason": "text clipped at point" }));
    }
    let nodes: Vec<ElId> = match self_index {
        Some(i) => stack[i..].to_vec(),
        None => {
            let mut v = vec![el];
            v.extend(stack);
            v
        }
    };
    Ok(nodes
        .into_iter()
        .filter(|&n| closest_or_none(dom, n, OVERLAY_SELECTOR).is_none())
        .map(|n| {
            let tag = tag_lower(dom, n);
            let kind = if tag == "img" {
                "img"
            } else if tag == "canvas" || tag == "video" {
                "raster"
            } else if tag == "svg" {
                // Vector paint (an avatar circle, an inline illustration) is
                // opaque to this walk: its fills live on children no CSS
                // background read can see. Reading through it would report the
                // surface behind the artwork as the text's background.
                "unreadable"
            } else {
                "css"
            };
            StackNode {
                el: n,
                kind: kind.to_string(),
            }
        })
        .collect())
}

/// The walk's stop when it reaches paint it cannot read (`unreadable` stack
/// nodes). `stop` ends the walk: what is under this node is not what the text
/// sits on, so the nodes below it must not answer for it.
pub fn unreadable_stack_sample(dom: &dyn Dom, node: ElId) -> Value {
    json!({ "status": "unresolved", "reason": format!("{} paint", tag_lower(dom, node)), "stop": true })
}

/// An unresolved sample that ends the walk rather than passing it down.
pub fn sample_ends_walk(sample: &Value) -> bool {
    sample.get("stop").and_then(Value::as_bool) == Some(true)
}

/// The walk's compositing fold: `pending` is the translucent surfaces it
/// passed through, topmost first, and `ground` the opaque sample under them.
/// Each is blended into the one below, so the topmost surface names the
/// method (`...+alpha`), as the old pairwise recursion did.
pub fn composite_stack(pending: &[Value], ground: &Value) -> Value {
    let mut out = ground.clone();
    for sample in pending.iter().rev() {
        out = alpha_composite(sample.clone(), &out);
    }
    out
}

/// JS: index.mjs#sampleImageElement — painted rect + source point for the
/// `<img>` at `node` (`intrinsic_*` are the JS `naturalWidth || videoWidth ||
/// width` chain, 0 when none). `Err` is the unresolved sample.
pub fn img_source_point(
    dom: &dyn Dom,
    node: ElId,
    intrinsic_w: f64,
    intrinsic_h: f64,
    x: f64,
    y: f64,
) -> Result<(PaintedRect, (f64, f64)), Value> {
    let rect: Box4 = dom.rect(node).into();
    let painted = resolve_object_image_rect(
        &rect,
        intrinsic_w,
        intrinsic_h,
        &dom.style(node, "objectFit"),
        &dom.style(node, "objectPosition"),
    );
    match point_to_image_source(x, y, &painted) {
        Some(p) => Ok((painted, p)),
        None => Err(json!({ "status": "unresolved", "reason": "point outside image" })),
    }
}

/// JS: index.mjs#sampleImageElement — the retry with the separately loaded
/// image: the painted box stays, only the intrinsic size changes
/// (`loaded.naturalWidth || loaded.width || paintedRect.intrinsicWidth`).
pub fn img_loaded_source_point(
    painted: &PaintedRect,
    loaded_w: f64,
    loaded_h: f64,
    x: f64,
    y: f64,
) -> Option<(f64, f64)> {
    let loaded_rect = PaintedRect {
        intrinsic_width: if num_truthy(loaded_w) { loaded_w } else { painted.intrinsic_width },
        intrinsic_height: if num_truthy(loaded_h) { loaded_h } else { painted.intrinsic_height },
        ..*painted
    };
    point_to_image_source(x, y, &loaded_rect)
}

/// JS: `{ ...sample, method: 'canvas-img-underlay' }` when sampled, else the sample.
pub fn img_finish(sample: Value) -> Value {
    with_method(sample, "canvas-img-underlay")
}

/// JS: canvas/video underlay source point (`intrinsic_*` are
/// `node.width || node.videoWidth`, 0 when none → the rect's size).
pub fn raster_source_point(dom: &dyn Dom, node: ElId, intrinsic_w: f64, intrinsic_h: f64, x: f64, y: f64) -> Option<(f64, f64)> {
    let rect = dom.rect(node);
    let painted = PaintedRect {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        intrinsic_width: if num_truthy(intrinsic_w) { intrinsic_w } else { rect.width },
        intrinsic_height: if num_truthy(intrinsic_h) { intrinsic_h } else { rect.height },
    };
    point_to_image_source(x, y, &painted)
}

/// JS: `{ ...sample, method: \`canvas-${tag}-underlay\` }` when sampled.
pub fn raster_finish(dom: &dyn Dom, node: ElId, sample: Value) -> Value {
    let tag = tag_lower(dom, node);
    with_method(sample, &format!("canvas-{tag}-underlay"))
}

/// The opacity a layer is painted at under the text: the product of the
/// `opacity` on `node` and its ancestors up to the first one that also holds
/// the text (`el`), whose opacity fades the glyphs as much as the layer and so
/// changes nothing between them.
pub fn layer_fade(dom: &dyn Dom, node: ElId, el: ElId) -> f64 {
    const MAX_ANCESTORS: usize = 64;
    let mut fade = 1.0;
    let mut cur = Some(node);
    for _ in 0..MAX_ANCESTORS {
        let Some(c) = cur else { break };
        if c == el || dom.contains(c, el) {
            break;
        }
        fade *= own_opacity(dom, c);
        cur = dom.parent(c);
    }
    fade
}

/// A picture's sample in the stack walk, finished for what it paints under
/// the text. A picture faded by its own box (a card photo at `opacity: 0.16`
/// over a white card, a slide photo in a `0.1` wrapper) is a translucent
/// layer, and the walk goes on to composite it over what lies beneath; read
/// raw, it scored navy titles 1.0:1 against a dark photo nobody sees. A
/// picture that could not be read (a tainted image, a video frame the canvas
/// refused) ends the walk: what is under it is not what the text sits on, and
/// the white page beneath a hero video is not its frame. A point outside the
/// picture's painted box says nothing, as before.
pub fn media_sample(dom: &dyn Dom, node: ElId, el: ElId, sample: Value) -> Value {
    match sample.get("status").and_then(Value::as_str) {
        Some("sampled") => {
            let fade = layer_fade(dom, node, el);
            if fade >= 0.999 {
                return sample;
            }
            let mut m = sample.as_object().cloned().unwrap_or_default();
            if let Some(Value::Object(color)) = m.get_mut("color") {
                let a = color.get("a").and_then(Value::as_f64).unwrap_or(1.0);
                color.insert("a".into(), json!(a * fade));
            }
            Value::Object(m)
        }
        Some("unresolved") if str_or_empty(sample.get("reason")) != "point outside image" => {
            let mut m = sample.as_object().cloned().unwrap_or_default();
            m.insert("stop".into(), Value::Bool(true));
            Value::Object(m)
        }
        _ => sample,
    }
}

fn with_method(sample: Value, method: &str) -> Value {
    if sample.get("status").and_then(Value::as_str) == Some("sampled") {
        let mut m = sample.as_object().cloned().unwrap_or_default();
        m.insert("method".into(), Value::String(method.to_string()));
        Value::Object(m)
    } else {
        sample
    }
}

/// Whether background layer `index` is `none` or a gradient that paints the whole box:
/// tiled in both directions, or sized to the box and not moved off it by a
/// length offset. Shorter `background-*` lists repeat, as in CSS.
fn gradient_layer_covers_box(dom: &dyn Dom, node: ElId, layers: &[String], index: usize) -> bool {
    let layer = js::to_lower_case(js::trim(&layers[index]));
    // The `none` a `background` shorthand leaves beside its color paints nothing.
    if layer == "none" {
        return true;
    }
    let is_gradient = ["linear-gradient(", "radial-gradient(", "conic-gradient("]
        .iter()
        .any(|kind| layer.starts_with(kind) || layer.strip_prefix("repeating-").is_some_and(|l| l.starts_with(kind)));
    if !is_gradient {
        return false;
    }
    let value = |prop: &str| {
        let list = split_top_level_commas(&dom.style(node, prop));
        list.get(index % list.len().max(1)).map(|v| js::trim(v).to_string()).unwrap_or_default()
    };
    if matches!(value("backgroundRepeat").as_str(), "" | "repeat" | "repeat repeat") {
        return true;
    }
    // A gradient has no size of its own, so `auto` (and `contain`) fill the box.
    let size = value("backgroundSize");
    let fills = matches!(size.as_str(), "cover" | "contain") || split_ws(&size).iter().all(|t| matches!(&**t, "" | "auto" | "100%"));
    fills
        && split_ws(&value("backgroundPosition")).iter().all(|t| t.ends_with('%') || matches!(&**t, "" | "0px" | "left" | "top" | "center" | "right" | "bottom"))
}

/// JS: index.mjs#sampleCssBackground — every decision except the image
/// load and the canvas sample.
pub fn css_plan(dom: &dyn Dom, node: ElId, text_color: Option<&Rgba>) -> CssPlan {
    let bg_image = dom.style(node, "backgroundImage");
    if !bg_image.is_empty() && bg_image != "none" {
        if GRADIENT_RE.is_match(&bg_image) {
            if let Some(tc) = text_color {
                // Compared raw, `transparent` reads as black (issue #881). Over the
                // element's own opaque background-color the layers composite bottom
                // up before they are judged, while every layer is a gradient that
                // paints the whole box; anything else takes the path below.
                let layers = split_top_level_commas(&bg_image);
                let own = parse_rgb_or_any(&dom.style(node, "backgroundColor")).filter(|c| {
                    c.alpha_or_one() >= 0.999 && (0..layers.len()).all(|i| gradient_layer_covers_box(dom, node, &layers, i))
                });
                // Set when a translucent stop lands on more than one color: which
                // composite is painted then depends on where each of them sits.
                let mut positional = false;
                let colors: Option<Vec<Rgba>> = match own {
                    Some(own) => layers.iter().rev().try_fold(vec![own], |ground, layer| {
                        let stops = parse_gradient_colors(Some(layer));
                        if stops.is_empty() {
                            return (js::trim(layer) == "none").then_some(ground);
                        }
                        let mut over: Vec<Rgba> = Vec::new();
                        for stop in &stops {
                            // An opaque stop hides the ground: one color, not one per ground.
                            let under = if stop.alpha_or_one() >= 0.999 { &ground[..1] } else { &ground[..] };
                            positional |= under.len() > 1;
                            over.extend(under.iter().filter_map(|g| blend_rgba(Some(stop), Some(g))));
                        }
                        over.dedup();
                        // A stack too deep to enumerate is left unread, not cut short.
                        (over.len() <= 4096).then_some(over)
                    }),
                    None => Some(parse_gradient_colors(Some(&bg_image))),
                };
                let Some(colors) = colors else {
                    return CssPlan::Sample {
                        sample: json!({ "status": "unresolved", "reason": STACKED_GRADIENTS, "stop": true }),
                    };
                };
                if positional {
                    // The two ends of the range the stack can show, ranked as
                    // `finish_analysis` scores them (translucent text blended
                    // over each): it keeps the sample only when both ends agree
                    // on the verdict.
                    let painted = |bg: &Rgba| contrast_ratio(&blend_rgba(Some(tc), Some(bg)).unwrap(), bg);
                    let by_contrast = |a: &&Rgba, b: &&Rgba| painted(a).total_cmp(&painted(b));
                    if let (Some(color), Some(best)) = (colors.iter().min_by(by_contrast), colors.iter().max_by(by_contrast)) {
                        return CssPlan::Sample {
                            sample: json!({ "status": "sampled", "color": color, "best": best, "method": "analytic-gradient" }),
                        };
                    }
                }
                match analytic_gradient_verdict(tc, &colors) {
                    Some(GradientVerdict::Color(color)) => {
                        return CssPlan::Sample {
                            sample: json!({ "status": "sampled", "color": color, "method": "analytic-gradient" }),
                        };
                    }
                    Some(GradientVerdict::Unresolved) => {
                        return CssPlan::Sample {
                            sample: json!({ "status": "unresolved", "reason": "gradient stops disagree", "stop": true }),
                        };
                    }
                    None => {}
                }
            } else {
                // JS-PARITY: contrastRatio(null, c) throws in the JS when
                // textColor is null; analyzeVisualContrastCandidate never
                // reaches here without one, so this branch is unreachable.
            }
        }
        if URL_RE.is_match(&bg_image) {
            // A `fixed` image is placed against the viewport, not against
            // the box, so the pixel under a point depends on the scroll
            // position this walk never models. Mapped onto the box it read
            // white text on a dark photo band at 2.1:1 (epcco.com.sa). The
            // walk ends there and the pixel pass reads the text.
            if url_layer_is_fixed(&bg_image, &dom.style(node, "background")) {
                return CssPlan::Sample {
                    sample: json!({ "status": "unresolved", "reason": "fixed background image", "stop": true }),
                };
            }
            let size = {
                let v = get_layer_value(&dom.style(node, "backgroundSize"), 0);
                if v.is_empty() { "auto".to_string() } else { v }
            };
            let position = {
                let v = get_layer_value(&dom.style(node, "backgroundPosition"), 0);
                if v.is_empty() { "50% 50%".to_string() } else { v }
            };
            return CssPlan::Url {
                url: first_css_url(&bg_image),
                size,
                position,
            };
        }
    }
    let bg = parse_rgb_or_any(&dom.style(node, "backgroundColor"));
    if let Some(bg) = bg {
        if bg.a.unwrap_or(f64::NAN) > MIN_PAINTED_ALPHA {
            return CssPlan::Sample {
                sample: json!({ "status": "sampled", "color": bg, "method": "solid-background" }),
            };
        }
    }
    CssPlan::Sample {
        sample: json!({ "status": "unresolved", "reason": "no readable background" }),
    }
}

/// Whether the first `url()` layer of a box's `background-image` is drawn
/// with `background-attachment: fixed`, read from the computed `background`
/// shorthand (the capture records no attachment longhand). Where the
/// shorthand was not recorded, or its layers do not line up with the
/// image's, a box with one layer is read from it and any other is not fixed.
fn url_layer_is_fixed(bg_image: &str, shorthand: &str) -> bool {
    let images = crate::color::split_top_level_commas(bg_image);
    let layers = crate::color::split_top_level_commas(shorthand);
    let Some(index) = images.iter().position(|layer| URL_RE.is_match(layer)) else {
        return false;
    };
    if layers.len() != images.len() {
        return false;
    }
    crate::checks::gradient_geometry::parse_shorthand_layer(&layers[index]).fixed
}

/// JS: sampleCssBackground url path — `if (!img) return { status:
/// 'unresolved', reason: 'image unavailable' }`.
///
/// An image this pass could not load (a cross-origin file served without
/// CORS) is still painted on the page. Where its placement is known without
/// its pixels (a size stated in pixels or percentages, or `cover`) and it
/// covers neither the candidate's text nor its own box, it is not the surface
/// either, and the walk ends there as it does once the image loads
/// ([`css_url_source_point`]).
///
/// Otherwise the walk ends there too. It used to go on to the boxes beneath,
/// and scored the text against a surface the image covers: white text on
/// bankofamerica.com's photo band printed 1.0:1 against the white page
/// behind it. What the image shows there is not known, so the candidate is
/// left to the pixel pass.
pub fn css_url_no_image(dom: &dyn Dom, node: ElId, el: ElId, size: &str, position: &str) -> Value {
    let rect: Box4 = dom.rect(node).into();
    let painted = resolve_painted_image_rect(&rect, 0.0, 0.0, size, position);
    if image_leaves_text_uncovered(dom, node, el, &painted, 0.0, 0.0, size) {
        return uncovered_image_sample();
    }
    json!({ "status": "unresolved", "reason": "image unavailable", "stop": true })
}

/// The sample that ends the walk at an image that is not under the text.
fn uncovered_image_sample() -> Value {
    json!({
        "status": "unresolved",
        "reason": "background image does not cover the text",
        "stop": true,
    })
}

/// JS: sampleCssBackground url path — painted rect of the loaded image over
/// the node's box and the source point; `Err` is the unresolved sample.
///
/// An image is the surface under the text only where it covers that text.
/// One drawn `no-repeat` at a size and position that leave the candidate's
/// text box uncovered (a mark beside a button label), or that leave its own
/// box uncovered (an icon sprite framing a count, a picture parked at one
/// side of a panel), is a mark laid on a surface this walk does not read:
/// the box's own `background-color` is never read once it carries an image,
/// and the image's transparent pixels composite over whatever lies further
/// down the stack. That is how a white count on a dark badge read 1.1:1
/// against the page's own fill. Such an image ends the walk unresolved,
/// and the candidate is left to the pixel pass. `el` is the candidate.
///
/// Where the placement cannot be measured (a size that needs the image's
/// intrinsic size and none was loaded, a size in other units, a repeat the
/// capture did not record), the image is read as before. `body` and `html`
/// paint the document, so only the text box is asked of them.
#[allow(clippy::too_many_arguments)]
pub fn css_url_source_point(
    dom: &dyn Dom,
    node: ElId,
    el: ElId,
    intrinsic_w: f64,
    intrinsic_h: f64,
    size: &str,
    position: &str,
    x: f64,
    y: f64,
) -> Result<(f64, f64), Value> {
    let rect: Box4 = dom.rect(node).into();
    let painted = resolve_painted_image_rect(&rect, intrinsic_w, intrinsic_h, size, position);
    if image_leaves_text_uncovered(dom, node, el, &painted, intrinsic_w, intrinsic_h, size) {
        return Err(uncovered_image_sample());
    }
    // A point the image does not reach shows the box's own fill, or what is
    // behind the box, and this walk reads neither once a box carries an
    // image. It ends here rather than score the text against the boxes
    // beneath.
    point_to_image_source(x, y, &painted).ok_or_else(|| {
        json!({ "status": "unresolved", "reason": "point outside background image", "stop": true })
    })
}

/// How far a no-repeat image may fall short of a box and still cover it:
/// the rounding of positions and sizes.
const COVER_SLACK_PX: f64 = 1.0;

/// See [`css_url_source_point`].
#[allow(clippy::too_many_arguments)]
fn image_leaves_text_uncovered(
    dom: &dyn Dom,
    node: ElId,
    el: ElId,
    painted: &PaintedRect,
    intrinsic_w: f64,
    intrinsic_h: f64,
    size: &str,
) -> bool {
    let Some((repeat_x, repeat_y)) = background_repeat_axes(&dom.style(node, "background")) else {
        return false;
    };
    if (repeat_x && repeat_y) || !placed_size_is_known(size, intrinsic_w, intrinsic_h) {
        return false;
    }
    let covers = |target: &Rect| {
        if !target.all_finite() || target.width <= 0.0 || target.height <= 0.0 {
            return true;
        }
        let x = repeat_x
            || (painted.left <= target.left + COVER_SLACK_PX
                && painted.left + painted.width >= target.right - COVER_SLACK_PX);
        let y = repeat_y
            || (painted.top <= target.top + COVER_SLACK_PX
                && painted.top + painted.height >= target.bottom - COVER_SLACK_PX);
        x && y
    };
    let text = dom.direct_text_rect(el).unwrap_or_else(|| dom.rect(el));
    if !covers(&text) {
        return true;
    }
    let tag = tag_lower(dom, node);
    tag != "body" && tag != "html" && !covers(&dom.rect(node))
}

/// Which axes a box's first background layer repeats on, read from the
/// computed `background` shorthand (`rgba(0, 0, 0, 0.6) url("…") no-repeat
/// scroll 50% 50% / 22px 16px padding-box border-box`). `None` when the
/// shorthand was not recorded or names no repeat keyword.
fn background_repeat_axes(shorthand: &str) -> Option<(bool, bool)> {
    let lower = js::to_lower_case(shorthand);
    // The first layer, with every function (`url(…)`, `rgba(…)`) removed so
    // neither its commas nor its contents are read as keywords.
    let mut layer = String::new();
    let mut depth = 0usize;
    for c in lower.chars() {
        match c {
            '(' => depth += 1,
            ')' => depth = depth.saturating_sub(1),
            ',' if depth == 0 => break,
            _ if depth == 0 => layer.push(c),
            _ => {}
        }
    }
    let words: Vec<&str> = layer
        .split_ascii_whitespace()
        .filter(|w| matches!(*w, "repeat" | "no-repeat" | "repeat-x" | "repeat-y" | "space" | "round"))
        .collect();
    match words.as_slice() {
        [] => None,
        ["repeat-x"] => Some((true, false)),
        ["repeat-y"] => Some((false, true)),
        [one] => Some((*one != "no-repeat", *one != "no-repeat")),
        [x, y, ..] => Some((*x != "no-repeat", *y != "no-repeat")),
    }
}

/// Whether [`resolve_painted_image_rect`] places an image of this computed
/// `background-size` where the browser does: `cover`, or pixel and
/// percentage sizes on both axes, or any size once the image's intrinsic
/// size is known. Another unit, or a `calc()` mixing two, is not modelled.
fn placed_size_is_known(size: &str, intrinsic_w: f64, intrinsic_h: f64) -> bool {
    let size = js::to_lower_case(js::trim(size));
    if size.contains('(') {
        return false;
    }
    let tokens: Vec<&str> = size.split_ascii_whitespace().collect();
    let modelled = |t: &str| t == "auto" || t.ends_with("px") || t.ends_with('%');
    match tokens.as_slice() {
        ["cover"] => true,
        ["contain"] | [] => num_truthy(intrinsic_w) && num_truthy(intrinsic_h),
        [w] if modelled(w) => num_truthy(intrinsic_w) && num_truthy(intrinsic_h),
        [w, h] if modelled(w) && modelled(h) => {
            (*w != "auto" && *h != "auto") || (num_truthy(intrinsic_w) && num_truthy(intrinsic_h))
        }
        _ => false,
    }
}

/// JS: `{ ...sample, method: 'canvas-background-image' }` when sampled.
pub fn css_url_finish(sample: Value) -> Value {
    with_method(sample, "canvas-background-image")
}

/// JS: `!sample.color || sample.color.a == null || sample.color.a >= 0.95` —
/// a sampled color that ends the walk (no compositing over what is beneath).
pub fn sample_is_opaque(sample: &Value) -> bool {
    let Some(color) = sample.get("color") else { return true };
    if color.is_null() {
        return true;
    }
    match color.get("a") {
        None | Some(Value::Null) => true,
        Some(Value::Number(n)) => n.as_f64().map_or(false, |a| a >= 0.95),
        // JS `>=` on a non-number coerces; a non-numeric alpha never occurs.
        Some(_) => false,
    }
}

/// JS: the alpha compositing step — `under` sampled → blended color with
/// `${sample.method}+alpha`, else the translucent sample itself.
pub fn alpha_composite(sample: Value, under: &Value) -> Value {
    if under.get("status").and_then(Value::as_str) == Some("sampled") {
        let top = rgba_from_value(sample.get("color"));
        let base = rgba_from_value(under.get("color"));
        let blended = blend_rgba(top.as_ref(), base.as_ref());
        let method = str_or_empty(sample.get("method"));
        let mut out = json!({
            "status": "sampled",
            "color": rgba_value(blended.as_ref()),
            "method": format!("{method}+alpha"),
        });
        // A stacked gradient's range (`best`) is veiled the same way.
        if let Some(best) = rgba_from_value(under.get("best")) {
            out["best"] = rgba_value(blend_rgba(top.as_ref(), Some(&best)).as_ref());
        }
        return out;
    }
    sample
}

/// JS: the walk's final `{ status: 'unresolved', reason }` from the collected
/// per-node reasons (deduped, first three, comma-joined; fallback text).
pub fn unresolved_from_reasons(reasons: &[String]) -> Value {
    let mut uniq: Vec<&str> = Vec::new();
    for r in reasons {
        if r.is_empty() {
            continue;
        }
        if !uniq.contains(&r.as_str()) {
            uniq.push(r);
        }
    }
    let joined = uniq.iter().take(3).copied().collect::<Vec<_>>().join(", ");
    let reason = if joined.is_empty() { "no readable visual background".to_string() } else { joined };
    json!({ "status": "unresolved", "reason": reason })
}

// ─── analyzeVisualContrastCandidate ─────────────────────────────────────────

/// `{ ...candidate, ...extra }` with JS spread semantics (existing keys keep
/// their position; new keys append).
fn spread(candidate: &Value, extra: Vec<(&str, Value)>) -> Value {
    let mut m = candidate.as_object().cloned().unwrap_or_default();
    for (k, v) in extra {
        m.insert(k.to_string(), v);
    }
    Value::Object(m)
}

fn unresolved(candidate: &Value, reason: &str) -> Value {
    spread(
        candidate,
        vec![
            ("status", json!("unresolved")),
            ("confidence", json!("none")),
            ("reason", json!(reason)),
        ],
    )
}

/// JS: index.mjs#analyzeVisualContrastCandidate — everything before the
/// sampling loop.
/// `[n, count]` when `selector` matches `count` elements and `el` is the
/// `n`th, in document order. A generated selector names one element unless
/// the page repeats the id that anchors it (a search box rendered once per
/// breakpoint), and then the first match can be a collapsed copy the
/// candidate never came from. `None` for a selector that names one element.
fn candidate_match(dom: &dyn Dom, selector: &str, el: ElId) -> Option<Value> {
    if !selector.contains('#') {
        return None;
    }
    let matches = dom.query_all(None, selector).ok()?;
    if matches.len() < 2 {
        return None;
    }
    let n = matches.iter().position(|m| *m == el)?;
    Some(json!([n, matches.len()]))
}

/// The element a candidate names: the `n`th match its `match` field records
/// while the page still has that many, the first match otherwise.
pub fn candidate_element(dom: &dyn Dom, candidate: &Value) -> Result<Option<ElId>, ()> {
    let selector = str_or_empty(candidate.get("selector"));
    let identity = candidate.get("match").and_then(Value::as_array).and_then(|a| {
        Some((a.first()?.as_u64()? as usize, a.get(1)?.as_u64()? as usize))
    });
    match identity {
        Some((n, count)) => {
            let matches = dom.query_all(None, &selector).map_err(|_| ())?;
            Ok(if matches.len() == count { matches.get(n).copied() } else { matches.first().copied() })
        }
        None => dom.query_one(None, &selector).map_err(|_| ()),
    }
}

pub fn prepare_analysis(dom: &dyn Dom, candidate: &Value) -> Prepared {
    let el = match candidate_element(dom, candidate) {
        Err(_) => return Prepared::Early { early: unresolved(candidate, "stale selector") },
        Ok(None) => return Prepared::Early { early: unresolved(candidate, "missing element") },
        Ok(Some(el)) => el,
    };
    if !super::element_checks::is_rendered_for_browser_rule(dom, el) {
        return Prepared::Early { early: unresolved(candidate, "hidden element") };
    }
    let reasons: Vec<String> = candidate
        .get("reasons")
        .and_then(Value::as_array)
        .map(|a| a.iter().map(|v| str_or_empty(Some(v))).collect())
        .unwrap_or_default();
    let blocking = reasons.iter().find(|r| {
        matches!(
            r.as_str(),
            "background-clip text"
                | "blend mode"
                | "filter"
                | "backdrop filter"
                | "opacity stack"
                | "text shadow"
                | "unread layer"
                | "text outline"
        )
    });
    if let Some(b) = blocking {
        return Prepared::Early { early: unresolved(candidate, &format!("{b} needs screenshot pixels")) };
    }
    // A first-budget candidate the element pass hands over because the
    // structural climb found paint the contrast walk never read is not the
    // sampled pass's to score where that paint is one its stack walk cannot
    // see: a pseudo-element over the text, or a layer that ignores pointer
    // events, neither of which a hit-test stack lists. epcco.com.sa's footer
    // lays a `::before` teal scrim at 0.9 over its photo, and white copy on
    // it printed 2.6:1 against the bare photo.
    if candidate.get("routed").and_then(Value::as_str) == Some("unread layer") {
        let text = dom.direct_text_rect(el).unwrap_or_else(|| dom.rect(el));
        let unseen = layer_under_text_found(dom, el).1.is_some_and(|n| {
            js::trim(&dom.style(n, "pointerEvents")) == "none" || pseudo_paint(dom, n, &text).is_some()
        });
        if unseen {
            return Prepared::Early { early: unresolved(candidate, "unread layer needs screenshot pixels") };
        }
    }
    let text_color = parse_rgb_or_any(&dom.style(el, "color"))
        .or_else(|| rgba_from_value(candidate.get("textColor")));
    let Some(text_color) = text_color else {
        return Prepared::Early { early: unresolved(candidate, "unreadable text color") };
    };
    let rect = dom.direct_text_rect(el).unwrap_or_else(|| dom.rect(el));
    if rect.width < 4.0 || rect.height < 4.0 {
        return Prepared::Early { early: unresolved(candidate, "missing text rect") };
    }
    let points = text_sample_points(&rect, dom.inner_width(), dom.inner_height());
    if points.is_empty() {
        return Prepared::Early { early: unresolved(candidate, "text outside viewport") };
    }
    Prepared::Ready {
        el,
        points: points.iter().map(|(x, y)| json!({ "x": x, "y": y })).collect(),
        text_color,
    }
}

/// The ratio the sampled pass stands behind, over its sorted per-point
/// ratios. It is their median, the way the pixel pass reads its glyph cores:
/// the 10th percentile took one point over a bright patch of a photo, or a
/// sample off the image's edge, as the verdict for the whole line (vorelios.com
/// printed 4.0:1 against a median of 8.3:1, climatempo.com.br 4.4:1 against
/// 10.0:1). Where the points read two surfaces, the median more than
/// [`VERDICT_MEDIAN_DIVERGENCE`] times the 10th percentile, this is that
/// percentile: [`finish_analysis`] prints it where the median fails as well,
/// and gives no verdict where the median passes, since which of the two
/// surfaces the glyphs sit on is the pixel pass's to read.
pub fn sampled_verdict(sorted: &[f64]) -> f64 {
    let low = percentile(sorted, 10.0);
    let median = percentile(sorted, 50.0);
    if median > low * VERDICT_MEDIAN_DIVERGENCE {
        low
    } else {
        median
    }
}

/// The severity a failing visual-contrast verdict on `candidate` carries:
/// `advisory` for text with no reading job (the candidate's `decorative`)
/// and for a verdict just under its bar
/// ([`crate::checks::rules::contrast_near_bar`]), else the rule's own. The
/// sampled pass here and the URL engine's pixel pass both ask it.
pub fn visual_contrast_severity(candidate: &Value, measured: f64, threshold: f64) -> Option<String> {
    if candidate.get("decorative").and_then(Value::as_bool) == Some(true) {
        return Some(crate::checks::rules::ADVISORY_SEVERITY.to_string());
    }
    crate::checks::rules::contrast_severity(measured, threshold)
}

/// JS: index.mjs#analyzeVisualContrastCandidate — after the sampling loop:
/// `samples` is one `{ status, color?, method?, reason? }` per point.
pub fn finish_analysis(candidate: &Value, text_color: &Rgba, samples: &[Value], points_len: usize) -> Value {
    let mut ratios: Vec<f64> = Vec::new();
    let mut methods: Vec<String> = Vec::new();
    let mut unresolved_reasons: Vec<String> = Vec::new();
    let mut straddles = false;
    let threshold = candidate.get("threshold").and_then(Value::as_f64).unwrap_or(f64::NAN);
    let ratio_on = |bg: &Rgba| contrast_ratio(&blend_rgba(Some(text_color), Some(bg)).unwrap(), bg);
    for sample in samples {
        let sampled = sample.get("status").and_then(Value::as_str) == Some("sampled");
        let color = rgba_from_value(sample.get("color"));
        if !sampled || color.is_none() {
            unresolved_reasons.push(str_or_empty(sample.get("reason")));
            continue;
        }
        let ratio = ratio_on(&color.unwrap());
        // A stacked gradient reports the range of colors it can show. When the
        // two ends disagree on the verdict, the answer depends on where the
        // text sits, and only pixels can say. A veil over the range can swap
        // which end is worse, so neither is assumed to be.
        let other = rgba_from_value(sample.get("best")).map(|best| ratio_on(&best));
        if other.is_some_and(|other| (ratio < threshold) != (other < threshold)) {
            straddles = true;
            unresolved_reasons.push(STACKED_GRADIENTS.to_string());
            continue;
        }
        let ratio = other.map_or(ratio, |other| math_min(ratio, other));
        ratios.push(ratio);
        let method = str_or_empty(sample.get("method"));
        if !method.is_empty() && !methods.contains(&method) {
            methods.push(method);
        }
    }
    ratios.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let n = ratios.len();
    let measured = if n > 0 { sampled_verdict(&ratios) } else { f64::NAN };
    // A point left to the pixels can hide a failure: the readable points may
    // fail the text without it, never pass it.
    let uncertain_pass = straddles && n > 0 && !(measured < threshold);
    if n < math_min(3.0, points_len as f64) as usize || uncertain_pass {
        let mut uniq: Vec<&str> = Vec::new();
        for r in &unresolved_reasons {
            if !r.is_empty() && !uniq.contains(&r.as_str()) {
                uniq.push(r);
            }
        }
        let joined = uniq.iter().take(3).copied().collect::<Vec<_>>().join(", ");
        let reason = if joined.is_empty() { "not enough readable samples".to_string() } else { joined };
        return spread(
            candidate,
            vec![
                ("status", json!("unresolved")),
                ("confidence", json!("none")),
                ("samples", json!(n)),
                ("reason", json!(reason)),
            ],
        );
    }
    let median = percentile(&ratios, 50.0);
    // The points read two surfaces and the line passes on the one most of
    // them read: a few samples landed on a bright patch of a photo, or past
    // its edge (thekrogerco.com printed 1.9:1 against a median of 7.0:1 for
    // bold white text on a green photo). Which surface the glyphs sit on is
    // the pixel pass's to say, so this pass gives no verdict. The same guard
    // as the pixel pass's "verdict disagrees with its own median".
    if measured < threshold && median >= threshold && measured < median {
        return spread(
            candidate,
            vec![
                ("status", json!("unresolved")),
                ("confidence", json!("none")),
                ("samples", json!(n)),
                ("reason", json!("sample points disagree")),
            ],
        );
    }
    let status = if measured < threshold { "fail" } else { "pass" };
    let mut sorted_methods = methods.clone();
    sorted_methods.sort();
    let method = {
        let j = sorted_methods.join(", ");
        if j.is_empty() { "browser-visual".to_string() } else { j }
    };
    let text = str_or_empty(candidate.get("text"));
    let text_label = if text.is_empty() { String::new() } else { format!(" \"{text}\"") };
    let detail = format!(
        "browser contrast {}:1 median {}:1 (need {}:1) via {}{}",
        crate::color::ratio_label(measured, threshold),
        crate::color::ratio_label(median, threshold),
        number_to_string(threshold),
        method,
        text_label
    );
    let finding = if status == "fail" {
        match visual_contrast_severity(candidate, measured, threshold) {
            Some(severity) => json!({ "id": "low-contrast", "snippet": detail, "severity": severity }),
            None => json!({ "id": "low-contrast", "snippet": detail }),
        }
    } else {
        Value::Null
    };
    spread(
        candidate,
        vec![
            ("status", json!(status)),
            ("confidence", json!(if method.contains("canvas-") { "high" } else { "medium" })),
            ("method", json!(method)),
            ("ratio", json!(measured)),
            ("medianRatio", json!(median)),
            ("samples", json!(n)),
            ("finding", finding),
        ],
    )
}

// ─── the screenshot pixel pass ──────────────────────────────────────────────
//
// `screenshot-contrast` diffs two clipped screenshots of the same box, one
// with the text painted and one with it transparent, and measures every pixel
// the text changed. The decisions below say which of those pixels describe the
// text's own background and when the set is too unlike text to answer at all.

/// One pixel the text paints on: `delta` is the summed channel change between
/// the two frames (how much of the pixel the glyph covers), `ratio` the WCAG
/// ratio measured there, `ground` the luminance left when the text is hidden,
/// `darkened` says the text made that pixel darker than that ground, and
/// `off_color` that what the text painted there is not the color the text
/// declares.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GlyphPixel {
    pub delta: f64,
    pub ratio: f64,
    pub ground: f64,
    pub darkened: bool,
    pub off_color: bool,
}

/// How far a well covered pixel may drift from the declared text color,
/// relative to the distance between that color and the ground: a pixel two
/// thirds covered by the glyph sits a third of the way back toward the ground.
const PAINTED_COLOR_DRIFT: f64 = 0.5;

/// Whether the pixel the text painted looks like the color the text declares.
/// It should, wherever the glyph covers most of the pixel: `painted` is that
/// pixel in the frame with the text, `ground` the same pixel in the frame
/// without it. Only worth asking where the pass claims the CSS color as the
/// foreground — `preferRenderedForeground` makes the painted value the
/// foreground, and then there is nothing to check.
pub fn painted_is_text_color(painted: [f64; 3], text: [f64; 3], ground: [f64; 3]) -> bool {
    let drift: f64 = (0..3).map(|i| (painted[i] - text[i]).abs()).sum();
    let span: f64 = (0..3).map(|i| (text[i] - ground[i]).abs()).sum();
    drift <= span * PAINTED_COLOR_DRIFT
}

/// What the pixel pass concluded: a ratio it stands behind, or the reason it
/// could not read the text.
#[derive(Debug, Clone, PartialEq)]
pub enum PixelContrastOutcome {
    Verdict {
        measured: f64,
        median: f64,
        core_pixels: usize,
    },
    Unresolved(&'static str),
}

/// Below this many pixels the diff is noise, not a glyph.
pub const GLYPH_MIN_PIXELS: usize = 8;
/// A pixel is a glyph core at this share of the strongest change in the box:
/// the glyph covers nearly all of it, so what it painted is the text's own
/// color. Anything below it is partly background. An antialiased edge tends
/// to 1:1 no matter how legible the text is, and even a pixel three quarters
/// covered reads well under the color the visitor sees on a dark ground:
/// landio.framer.website's dates measured 3.5:1 over the pixels from 75% up,
/// where the crops read about 4.5:1.
const GLYPH_CORE_COVERAGE: f64 = 0.9;
/// Small or thin text can leave fewer than [`GLYPH_MIN_PIXELS`] cores; the
/// pass then reads the well covered pixels from this share up, as it did
/// before it sampled cores, rather than reporting nothing.
const GLYPH_BODY_COVERAGE: f64 = 0.75;
/// Text covers a fraction of its own box. When most of the clip changed, the
/// page repainted between the two screenshots (a video, a carousel, a reveal
/// animation) and no pixel pair is a glyph over its background.
const GLYPH_CHURN_SHARE: f64 = 0.55;
/// Hiding text moves every pixel it painted the same way: toward the surface
/// under it. A box where a large minority moved the other way holds something
/// that arrived or left between the captures — text mid-animation leaves its
/// old position and its new one in the same diff — so no pair is a glyph over
/// its background.
const GLYPH_DIRECTION_MINORITY: f64 = 0.25;
/// How far the verdict may sit below the median of every measured pixel
/// before the sample is judged bimodal rather than a reading of one surface.
const VERDICT_MEDIAN_DIVERGENCE: f64 = 3.0;
/// How far the surface the glyphs sit on may stand apart from the surface
/// beside them in the same box. A page that paints its own text twice (a
/// duplicate layer behind it for a glow) leaves the second copy where the
/// glyphs were, and the pass would read that copy as the background.
const GROUND_DISAGREEMENT: f64 = 2.0;

/// WCAG ratio between two luminances.
fn luminance_ratio(a: f64, b: f64) -> f64 {
    (math_max(a, b) + 0.05) / (math_min(a, b) + 0.05)
}

/// The sorted-array percentile the visual pass uses everywhere.
fn percentile(sorted: &[f64], pct: f64) -> f64 {
    let n = sorted.len();
    let idx = ((pct / 100.0) * n as f64).floor();
    sorted[math_min((n - 1) as f64, math_max(0.0, idx)) as usize]
}

/// Reasons whose rendered pixels do not say what the text sits on. A filter or
/// backdrop-filter paints the surface from something the diff cannot attribute
/// (the video or image under a glass panel reads as the panel's own ground),
/// and `background-clip: text` paints the glyphs from the background the
/// pass would score them against. Both resolve to unresolved, never to a
/// failure.
pub fn pixel_contrast_blocked(reasons: &[String]) -> Option<String> {
    reasons
        .iter()
        .find(|r| {
            matches!(
                r.as_str(),
                "background-clip text" | "filter" | "backdrop filter"
            )
        })
        .cloned()
}

/// The verdict over the pixels the text painted on. `clip_pixels` is the size
/// of the compared box and `surround_ground` the mean luminance of the pixels
/// in it the text did not touch, when there are enough of them to mean
/// anything.
pub fn pixel_contrast_verdict(
    pixels: &[GlyphPixel],
    clip_pixels: usize,
    surround_ground: Option<f64>,
) -> PixelContrastOutcome {
    if pixels.len() < GLYPH_MIN_PIXELS {
        return PixelContrastOutcome::Unresolved("too few glyph pixels");
    }
    if clip_pixels > 0 && pixels.len() as f64 > clip_pixels as f64 * GLYPH_CHURN_SHARE {
        return PixelContrastOutcome::Unresolved("box repainted between captures");
    }
    let darkened = pixels.iter().filter(|p| p.darkened).count();
    let minority = darkened.min(pixels.len() - darkened);
    if minority as f64 > pixels.len() as f64 * GLYPH_DIRECTION_MINORITY {
        return PixelContrastOutcome::Unresolved("text moved between captures");
    }
    let strongest = pixels.iter().fold(0.0f64, |m, p| math_max(m, p.delta));
    let covered = |share: f64| -> Vec<&GlyphPixel> {
        let floor = strongest * share;
        pixels.iter().filter(|p| p.delta >= floor).collect()
    };
    let mut core_pixels = covered(GLYPH_CORE_COVERAGE);
    if core_pixels.len() < GLYPH_MIN_PIXELS {
        core_pixels = covered(GLYPH_BODY_COVERAGE);
    }
    if core_pixels.len() < GLYPH_MIN_PIXELS {
        return PixelContrastOutcome::Unresolved("too few fully painted glyph pixels");
    }
    if core_pixels.iter().filter(|p| p.off_color).count() * 2 > core_pixels.len() {
        return PixelContrastOutcome::Unresolved("the text is painted by something else");
    }
    if let Some(surround) = surround_ground {
        let under: f64 =
            core_pixels.iter().map(|p| p.ground).sum::<f64>() / core_pixels.len() as f64;
        if luminance_ratio(under, surround) >= GROUND_DISAGREEMENT {
            return PixelContrastOutcome::Unresolved("the hidden text is still painted");
        }
    }
    let mut core: Vec<f64> = core_pixels.iter().map(|p| p.ratio).collect();
    let mut all: Vec<f64> = pixels.iter().map(|p| p.ratio).collect();
    core.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    all.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    // The verdict is the median of the glyph cores, so the median the snippet
    // prints is that same number over that same set. It used to be the median
    // over every changed pixel, edges included, which printed a verdict above
    // its own median (`pixel contrast 3.5:1 median 1.7:1`).
    let measured = percentile(&core, 50.0);
    if !measured.is_finite() || measured <= 0.0 {
        return PixelContrastOutcome::Unresolved("no readable glyph pixels");
    }
    // Every changed pixel still answers one question: whether the cores are a
    // reading of one surface or a second population (a repaint, a video band).
    if percentile(&all, 50.0) > measured * VERDICT_MEDIAN_DIVERGENCE {
        return PixelContrastOutcome::Unresolved("verdict disagrees with its own median");
    }
    PixelContrastOutcome::Verdict {
        measured,
        median: measured,
        core_pixels: core.len(),
    }
}

/// JS: analyzeVisualContrast — retry a candidate after scrolling it into view
/// only when the first pass failed for being outside the viewport.
pub fn needs_scroll_retry(result: &Value) -> bool {
    result.get("status").and_then(Value::as_str) == Some("unresolved")
        && result.get("reason").and_then(Value::as_str) == Some("text outside viewport")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::browser::fake_dom::FakeDom;

    fn rgba(r: f64, g: f64, b: f64, a: f64) -> Rgba {
        Rgba::new(r, g, b, a)
    }

    #[test]
    fn blend_and_worst_color() {
        let fg = rgba(0.0, 0.0, 0.0, 0.5);
        let bg = rgba(255.0, 255.0, 255.0, 1.0);
        let out = blend_rgba(Some(&fg), Some(&bg)).unwrap();
        assert_eq!((out.r, out.g, out.b, out.a), (128.0, 128.0, 128.0, Some(1.0)));
        assert_eq!(blend_rgba(None, Some(&bg)), Some(bg));
        let worst = pick_worst_contrast_color(&rgba(0.0, 0.0, 0.0, 1.0), &[bg, rgba(20.0, 20.0, 20.0, 1.0)]).unwrap();
        assert_eq!(worst.r, 20.0);
        assert!(pick_worst_contrast_color(&bg, &[]).is_none());
    }

    #[test]
    fn position_and_painted_rects() {
        assert_eq!(parse_position_pair(""), ("50%".into(), "50%".into()));
        assert_eq!(parse_position_pair("top"), ("50%".into(), "top".into()));
        assert_eq!(parse_position_pair("left 20px"), ("left".into(), "20px".into()));
        assert_eq!(parse_position_token("right", 100.0, 40.0), 60.0);
        assert_eq!(parse_position_token("25%", 100.0, 40.0), 15.0);
        let c = Box4 { left: 10.0, top: 20.0, width: 200.0, height: 100.0 };
        let p = resolve_painted_image_rect(&c, 400.0, 100.0, "cover", "center");
        assert_eq!((p.width, p.height), (400.0, 100.0));
        assert_eq!(p.left, 10.0 + (200.0 - 400.0) / 2.0);
        let o = resolve_object_image_rect(&c, 50.0, 50.0, "contain", "");
        assert_eq!((o.width, o.height), (100.0, 100.0));
        assert_eq!(point_to_image_source(0.0, 0.0, &p), None);
        assert_eq!(point_to_image_source(110.0, 70.0, &p), Some((200.0, 50.0)));
        assert_eq!(first_css_url("url(\"a b.png\"), url(c.png)"), "a b.png");
        assert_eq!(first_css_url("url( x.png )"), "x.png");
        assert_eq!(get_layer_value("cover, auto", 1), "auto");
    }

    #[test]
    fn sample_points_and_raster() {
        let r = Rect::from_xywh(0.0, 0.0, 100.0, 40.0);
        assert_eq!(text_sample_points(&r, 1280.0, 800.0).len(), 9);
        let r2 = Rect::from_xywh(-50.0, 0.0, 20.0, 10.0);
        assert!(text_sample_points(&r2, 1280.0, 800.0).is_empty());
        let plan = raster_plan(1280.0, 640.0);
        assert_eq!((plan.width, plan.height, plan.scale_x), (640.0, 320.0, 0.5));
        assert_eq!(raster_pixel(&plan, 1279.0, 5.0), (639.0, 2.0));
        assert_eq!(raster_error_reason("Failed: canvas is tainted"), "tainted image");
        assert_eq!(pixel_sample(1.0, 2.0, 3.0, 255.0)["color"]["a"], json!(1.0));
    }

    #[test]
    fn finish_analysis_formats_detail() {
        let candidate = json!({ "selector": "p", "text": "Hello", "threshold": 4.5 });
        let tc = rgba(120.0, 120.0, 120.0, 1.0);
        let samples: Vec<Value> = (0..3)
            .map(|_| json!({ "status": "sampled", "color": { "r": 255, "g": 255, "b": 255, "a": 1 }, "method": "solid-background" }))
            .collect();
        let out = finish_analysis(&candidate, &tc, &samples, 3);
        assert_eq!(out["status"], "fail");
        assert_eq!(out["confidence"], "medium");
        assert_eq!(out["finding"]["snippet"], "browser contrast 4.4:1 median 4.4:1 (need 4.5:1) via solid-background \"Hello\"");
        let out2 = finish_analysis(&candidate, &tc, &samples[..1], 3);
        assert_eq!(out2["status"], "unresolved");
        assert_eq!(out2["reason"], "not enough readable samples");
        assert_eq!(out2["samples"], json!(1));
        // A range whose ends disagree on the verdict is left to the pixels;
        // one whose ends agree is a verdict.
        let range = |best: f64| -> Vec<Value> {
            (0..3)
                .map(|_| json!({ "status": "sampled", "color": { "r": 255, "g": 255, "b": 255, "a": 1 }, "best": { "r": best, "g": best, "b": best, "a": 1 }, "method": "analytic-gradient" }))
                .collect()
        };
        let straddles = finish_analysis(&candidate, &tc, &range(0.0), 3);
        assert_eq!((&straddles["status"], &straddles["reason"]), (&json!("unresolved"), &json!(STACKED_GRADIENTS)));
        assert_eq!(finish_analysis(&candidate, &tc, &range(250.0), 3)["status"], "fail");
        // A veil can swap the ends: a passing `color` beside a failing `best` straddles too.
        let swapped: Vec<Value> = (0..3)
            .map(|_| json!({ "status": "sampled", "color": { "r": 0, "g": 0, "b": 0, "a": 1 }, "best": { "r": 255, "g": 255, "b": 255, "a": 1 }, "method": "analytic-gradient" }))
            .collect();
        assert_eq!(finish_analysis(&candidate, &tc, &swapped, 3)["reason"], json!(STACKED_GRADIENTS));
        // A translucent surface above the range veils both ends.
        let veil = json!({ "status": "sampled", "color": { "r": 0, "g": 0, "b": 0, "a": 0.5 }, "method": "solid-background" });
        let veiled = composite_stack(&[veil], &range(0.0)[0]);
        assert_eq!(rgba_from_value(veiled.get("color")), Some(rgba(128.0, 128.0, 128.0, 1.0)));
        assert_eq!(rgba_from_value(veiled.get("best")), Some(rgba(0.0, 0.0, 0.0, 1.0)));
        // One such point beside readable ones: they may fail the text, never pass it.
        let beside = |r: f64| -> Vec<Value> {
            let mut v: Vec<Value> = (0..3)
                .map(|_| json!({ "status": "sampled", "color": { "r": r, "g": r, "b": r, "a": 1 }, "method": "solid-background" }))
                .collect();
            v.push(range(0.0).remove(0));
            v
        };
        assert_eq!(finish_analysis(&candidate, &tc, &beside(0.0), 4)["status"], "unresolved");
        assert_eq!(finish_analysis(&candidate, &tc, &beside(255.0), 4)["status"], "fail");
    }

    #[test]
    fn finish_analysis_carries_the_advisory_severity() {
        let white: Vec<Value> = (0..3)
            .map(|_| json!({ "status": "sampled", "color": { "r": 255, "g": 255, "b": 255, "a": 1 }, "method": "solid-background" }))
            .collect();
        let candidate = json!({ "selector": "p", "text": "Hello", "threshold": 4.5 });
        // 4.4:1 sits inside the normal-text margin (r3-02).
        let near = finish_analysis(&candidate, &rgba(120.0, 120.0, 120.0, 1.0), &white, 3);
        assert_eq!(near["finding"]["severity"], "advisory");
        // 2.3:1 fails outright, unless the text has no reading job (r3-04).
        let far = finish_analysis(&candidate, &rgba(170.0, 170.0, 170.0, 1.0), &white, 3);
        assert_eq!(far["status"], "fail");
        assert!(far["finding"].get("severity").is_none(), "{far}");
        let decorative = json!({ "selector": "p", "text": "JD", "threshold": 4.5, "decorative": true });
        let shaped = finish_analysis(&decorative, &rgba(170.0, 170.0, 170.0, 1.0), &white, 3);
        assert_eq!(shaped["finding"]["severity"], "advisory");
    }

    #[test]
    fn finish_analysis_never_prints_a_failing_ratio_as_the_bar() {
        // #777777 over #070707 samples 4.498:1. One decimal read 4.5 and two
        // read 4.50, under a `need 4.5:1` it fails.
        let candidate = json!({ "selector": "p", "text": "Plans", "threshold": 4.5 });
        let tc = rgba(119.0, 119.0, 119.0, 1.0);
        let dark: Vec<Value> = (0..3)
            .map(|_| json!({ "status": "sampled", "color": { "r": 7, "g": 7, "b": 7, "a": 1 }, "method": "solid-background" }))
            .collect();
        let out = finish_analysis(&candidate, &tc, &dark, 3);
        assert_eq!(out["status"], "fail");
        assert_eq!(out["finding"]["snippet"], "browser contrast 4.49:1 median 4.49:1 (need 4.5:1) via solid-background \"Plans\"");
        // Four points over black beside three over #070707: one surface, and
        // its median passes where the 10th percentile used to fail.
        let mut mixed = dark.clone();
        for _ in 0..4 {
            mixed.push(json!({ "status": "sampled", "color": { "r": 0, "g": 0, "b": 0, "a": 1 }, "method": "solid-background" }));
        }
        let out = finish_analysis(&candidate, &tc, &mixed, 7);
        assert_eq!(out["status"], "pass", "{out}");
        assert!(out["finding"].is_null(), "{out}");
        // White over a grey band and over black reads two surfaces, and the
        // line passes over the one most points read: no verdict, and the
        // pixel pass reads which one the glyphs sit on.
        let white = rgba(255.0, 255.0, 255.0, 1.0);
        let grey = json!({ "status": "sampled", "color": { "r": 119, "g": 119, "b": 119, "a": 1 }, "method": "canvas-img-underlay" });
        let black = json!({ "status": "sampled", "color": { "r": 0, "g": 0, "b": 0, "a": 1 }, "method": "canvas-img-underlay" });
        let banded: Vec<Value> = vec![grey.clone(), grey.clone(), grey.clone(), black.clone(), black.clone(), black.clone(), black];
        let out = finish_analysis(&candidate, &white, &banded, 7);
        assert_eq!(out["status"], "unresolved", "{out}");
        assert_eq!(out["reason"], "sample points disagree", "{out}");
        assert!(out.get("finding").is_none(), "{out}");
        // Two surfaces that both fail keep the low reading, and the median
        // it prints: white over the grey band and over a paler one.
        let pale = json!({ "status": "sampled", "color": { "r": 236, "g": 236, "b": 236, "a": 1 }, "method": "canvas-img-underlay" });
        let failing: Vec<Value> = vec![pale.clone(), pale.clone(), pale, grey.clone(), grey.clone(), grey.clone(), grey];
        let out = finish_analysis(&candidate, &white, &failing, 7);
        assert_eq!(out["status"], "fail", "{out}");
        let snippet = out["finding"]["snippet"].as_str().unwrap();
        assert!(snippet.starts_with("browser contrast 1.2:1 median 4.48:1 (need 4.5:1)"), "{snippet}");
    }

    #[test]
    fn the_sampled_verdict_is_the_median_unless_the_points_read_two_surfaces() {
        // vorelios.com: one bright patch under a hero line.
        assert_eq!(sampled_verdict(&[4.0, 7.9, 8.1, 8.3, 8.4, 8.6, 9.0]), 8.3);
        // A line half over a light band and half over a dark one.
        assert_eq!(sampled_verdict(&[2.0, 2.1, 2.2, 12.0, 12.5, 13.0, 13.5]), 2.0);
        assert_eq!(sampled_verdict(&[3.0]), 3.0);
    }

    #[test]
    fn a_frosted_header_whose_own_fill_is_opaque_blocks_nothing() {
        // bookerapp.replit.app: shadcn's `bg-background/95 backdrop-blur`.
        let mut d = FakeDom::new();
        let (_html, body) = d.with_page();
        let wrap = d.add(Some(body), "div");
        d.set_style(wrap, "backgroundImage", "url(\"/booker_bg.jpg\")");
        let header = d.add(Some(wrap), "header");
        d.set_styles(header, &[("backgroundColor", "rgba(22, 24, 29, 0.95)"), ("backdropFilter", "blur(8px)")]);
        let p = d.add(Some(header), "p");
        d.set_style(p, "backgroundColor", "rgba(0, 0, 0, 0)");
        let reasons = collect_visual_contrast_reasons(&d, p);
        assert_eq!(reasons, vec!["backdrop filter under an opaque fill".to_string()]);
        assert!(pixel_contrast_blocked(&reasons).is_none());
        d.set_style(header, "backgroundColor", "rgba(22, 24, 29, 0.5)");
        let reasons = collect_visual_contrast_reasons(&d, p);
        assert!(reasons.iter().any(|r| r == "backdrop filter"), "{reasons:?}");
        assert!(reasons.iter().any(|r| r == "image background"), "{reasons:?}");
        // A contents box's fill ends nothing.
        d.set_styles(header, &[("backgroundColor", "rgb(0, 0, 0)"), ("backdropFilter", "none"), ("display", "contents")]);
        let reasons = collect_visual_contrast_reasons(&d, p);
        assert!(reasons.iter().any(|r| r == "image background"), "{reasons:?}");
    }

    #[test]
    fn stack_walk_pieces() {
        let s = json!({ "status": "sampled", "color": { "r": 1, "g": 2, "b": 3, "a": 0.5 }, "method": "solid-background" });
        assert!(!sample_is_opaque(&s));
        let under = json!({ "status": "sampled", "color": { "r": 255, "g": 255, "b": 255, "a": 1 } });
        let out = alpha_composite(s.clone(), &under);
        assert_eq!(out["method"], "solid-background+alpha");
        assert_eq!(out["color"]["r"].as_f64(), Some(128.0));
        assert_eq!(unresolved_from_reasons(&["a".into(), "".into(), "a".into(), "b".into(), "c".into(), "d".into()])["reason"], "a, b, c");
        assert_eq!(unresolved_from_reasons(&[])["reason"], "no readable visual background");
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let p = d.add(Some(body), "p");
        d.set_rect(p, 0.0, 0.0, 100.0, 50.0);
        assert!(stack_nodes(&d, p, 10.0, 10.0, 9.0).is_err());
        let nodes = stack_nodes(&d, p, 10.0, 10.0, 0.0).unwrap();
        assert_eq!(nodes[0].el, p);
        assert_eq!(nodes[0].kind, "css");
    }

    /// `n` pixels at one coverage / ratio pair, all darkening their ground.
    fn px(n: usize, delta: f64, ratio: f64) -> Vec<GlyphPixel> {
        vec![GlyphPixel { delta, ratio, ground: 1.0, darkened: true, off_color: false }; n]
    }

    #[test]
    fn pixel_verdict_reads_the_painted_glyph_not_its_edges() {
        // kraflio.com "LinkedIn": white bold 16px on a near-black card. The
        // painted pixels read 18:1; the antialiased edges read near 1:1 and
        // outnumber them, which is how the old tenth percentile reported 1.3:1
        // under a 10.2:1 median.
        let mut pixels = px(40, 705.0, 18.4);
        pixels.extend(px(120, 70.0, 1.1));
        match pixel_contrast_verdict(&pixels, 4000, None) {
            PixelContrastOutcome::Verdict { measured, median, core_pixels } => {
                assert_eq!(core_pixels, 40);
                assert!((measured - 18.4).abs() < 1e-9);
                // The printed median reads the same painted pixels, not the
                // edges the verdict set aside.
                assert!((median - 18.4).abs() < 1e-9);
            }
            other => panic!("{other:?}"),
        }
        // aisupply.framer.website collapsed accordion trigger: pale grey on
        // white through an opacity stack. Painted pixels really are 2.2:1.
        let mut faint = px(40, 240.0, 2.2);
        faint.extend(px(90, 60.0, 1.3));
        match pixel_contrast_verdict(&faint, 4000, None) {
            PixelContrastOutcome::Verdict { measured, .. } => assert!((measured - 2.2).abs() < 1e-9),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn pixel_verdict_reads_glyph_cores_and_never_prints_a_verdict_above_its_median() {
        // landio.framer.website "Access accurate, real-time data": light text
        // through an opacity stack on a near-black card, measured live. The
        // pixels from 90% of the strongest change up read 5.4:1, the band
        // under them 4.2:1 and 3.6:1, and the edges fall toward 1:1. Over the
        // pixels from 75% up the verdict was 4.2:1 (a failure) and the snippet
        // printed a median of 2.3:1 from every changed pixel.
        let mut pixels = px(322, 370.0, 5.4);
        pixels.extend(px(333, 320.0, 4.2));
        pixels.extend(px(220, 290.0, 3.6));
        pixels.extend(px(198, 250.0, 2.8));
        pixels.extend(px(253, 210.0, 2.3));
        pixels.extend(px(186, 160.0, 2.0));
        pixels.extend(px(900, 60.0, 1.3));
        match pixel_contrast_verdict(&pixels, 40000, None) {
            PixelContrastOutcome::Verdict { measured, median, core_pixels } => {
                assert_eq!(core_pixels, 322);
                assert!((measured - 5.4).abs() < 1e-9, "{measured}");
                assert!(measured <= median);
                assert!((median - 5.4).abs() < 1e-9, "{median}");
            }
            other => panic!("{other:?}"),
        }
        // A thin label with only a handful of cores keeps the verdict it had
        // over the well covered pixels instead of going silent.
        let mut thin = px(5, 400.0, 2.4);
        thin.extend(px(30, 320.0, 2.1));
        thin.extend(px(60, 100.0, 1.2));
        match pixel_contrast_verdict(&thin, 4000, None) {
            PixelContrastOutcome::Verdict { measured, median, core_pixels } => {
                assert_eq!(core_pixels, 35);
                assert!((measured - 2.1).abs() < 1e-9, "{measured}");
                assert!(measured <= median);
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn pixel_verdict_refuses_what_it_cannot_read() {
        assert_eq!(
            pixel_contrast_verdict(&px(4, 700.0, 1.2), 4000, None),
            PixelContrastOutcome::Unresolved("too few glyph pixels")
        );
        // adant.ai "60%": a video band inside the clip changes between the two
        // captures harder than the glyphs do, so the fully painted set is the
        // churn and the median of everything measured disagrees with it.
        let mut churn = px(30, 700.0, 1.4);
        churn.extend(px(200, 300.0, 16.2));
        assert_eq!(
            pixel_contrast_verdict(&churn, 4000, None),
            PixelContrastOutcome::Unresolved("verdict disagrees with its own median")
        );
        // A scroll-reveal mid-fade repaints the whole box, not a glyph.
        assert_eq!(
            pixel_contrast_verdict(&px(900, 120.0, 2.0), 1000, None),
            PixelContrastOutcome::Unresolved("box repainted between captures")
        );
        // Text mid-animation leaves its old position and its new one in the
        // same diff, so half the changed pixels moved the other way.
        let mut moved = px(60, 700.0, 1.2);
        moved.extend(px(60, 700.0, 16.0).into_iter().map(|p| GlyphPixel { darkened: false, ..p }));
        assert_eq!(
            pixel_contrast_verdict(&moved, 4000, None),
            PixelContrastOutcome::Unresolved("text moved between captures")
        );
        // paymentkit.com's hero: the frame without the text still paints it
        // (an animation left a copy behind), so what the glyphs painted is not
        // the color they declare and the diff is text over text.
        let mut ghost = px(40, 120.0, 1.1).into_iter().map(|p| GlyphPixel { off_color: true, ..p }).collect::<Vec<_>>();
        ghost.extend(px(90, 30.0, 1.4));
        assert_eq!(
            pixel_contrast_verdict(&ghost, 4000, None),
            PixelContrastOutcome::Unresolved("the text is painted by something else")
        );
        // paymentkit.com's headline: the frame without the text still holds a
        // dim copy of it, so the surface under the glyphs is nothing like the
        // surface beside them in the same box.
        assert_eq!(
            pixel_contrast_verdict(&px(40, 700.0, 2.6), 4000, Some(0.02)),
            PixelContrastOutcome::Unresolved("the hidden text is still painted")
        );
        // The surface under the glyphs matching the one beside them answers.
        assert!(matches!(
            pixel_contrast_verdict(&px(40, 700.0, 2.6), 4000, Some(0.9)),
            PixelContrastOutcome::Verdict { .. }
        ));
        // The same reading from a glyph that really is its declared color.
        assert!(painted_is_text_color([252.0, 252.0, 252.0], [255.0, 255.0, 255.0], [20.0, 22.0, 28.0]));
        assert!(!painted_is_text_color([52.0, 211.0, 153.0], [205.0, 205.0, 205.0], [160.0, 160.0, 160.0]));
        // One stray full-coverage pixel over a wash of edges: nothing to stand
        // behind.
        let mut sparse = px(1, 700.0, 1.2);
        sparse.extend(px(60, 60.0, 1.1));
        assert_eq!(
            pixel_contrast_verdict(&sparse, 4000, None),
            PixelContrastOutcome::Unresolved("too few fully painted glyph pixels")
        );
    }

    #[test]
    fn blocked_reasons_and_gradient_verdicts() {
        let blocked = ["opacity stack".to_string(), "backdrop filter".to_string()];
        assert_eq!(pixel_contrast_blocked(&blocked).as_deref(), Some("backdrop filter"));
        assert_eq!(
            pixel_contrast_blocked(&["background-clip text".to_string()]).as_deref(),
            Some("background-clip text")
        );
        assert_eq!(pixel_contrast_blocked(&["opacity stack".to_string()]), None);
        let white = rgba(255.0, 255.0, 255.0, 1.0);
        // framai.framer.website glow: the transparent end of the radial
        // gradient is the stop with the worst contrast, and it is not a light
        // grey surface. Nothing here knows where in the box the text sits.
        let glow = [
            rgba(133.0, 38.0, 254.0, 0.82),
            rgba(171.0, 171.0, 171.0, 0.0),
        ];
        assert_eq!(pick_worst_contrast_color(&white, &glow).unwrap(), glow[1]);
        assert_eq!(
            analytic_gradient_verdict(&white, &glow),
            Some(GradientVerdict::Unresolved)
        );
        // overdrive.health `from-primary/10`: a wash of the text's own color
        // over the card, not a slab of it.
        let wash = [rgba(55.0, 65.0, 81.0, 0.1), rgba(55.0, 65.0, 81.0, 0.1)];
        assert_eq!(
            analytic_gradient_verdict(&rgba(55.0, 65.0, 81.0, 1.0), &wash),
            Some(GradientVerdict::Unresolved)
        );
        // A solid color written as a gradient still answers.
        let solid = [rgba(62.0, 69.0, 204.0, 1.0), rgba(62.0, 69.0, 204.0, 1.0)];
        assert_eq!(
            analytic_gradient_verdict(&white, &solid),
            Some(GradientVerdict::Color(solid[0]))
        );
        // Opaque ends far apart: which one is behind the glyphs decides.
        let sweep = [rgba(20.0, 20.0, 24.0, 1.0), rgba(240.0, 240.0, 244.0, 1.0)];
        assert_eq!(
            analytic_gradient_verdict(&white, &sweep),
            Some(GradientVerdict::Unresolved)
        );
        assert_eq!(analytic_gradient_verdict(&white, &[]), None);
    }

    #[test]
    fn the_walk_composites_down_the_stack() {
        let glass = json!({ "status": "sampled", "color": { "r": 255, "g": 255, "b": 255, "a": 0.1 }, "method": "solid-background" });
        let scrim = json!({ "status": "sampled", "color": { "r": 0, "g": 0, "b": 0, "a": 0.5 }, "method": "analytic-gradient" });
        let ground = json!({ "status": "sampled", "color": { "r": 200, "g": 200, "b": 200, "a": 1 }, "method": "canvas-video-underlay" });
        let out = composite_stack(&[glass.clone(), scrim], &ground);
        // 200 under a half-black scrim is 100, and a tenth of white over that
        // is 116 — not the 255 the old self-compositing walk converged on.
        assert_eq!(out["color"]["r"].as_f64(), Some(116.0));
        assert_eq!(out["method"], "solid-background+alpha");
        // Nothing translucent above it leaves the ground as it was.
        assert_eq!(composite_stack(&[], &ground), ground);
        assert!(sample_ends_walk(&json!({ "status": "unresolved", "stop": true })));
        assert!(!sample_ends_walk(&json!({ "status": "unresolved" })));
    }

    #[test]
    fn vector_paint_stops_the_walk() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let avatar = d.add(Some(body), "svg");
        d.set_rect(avatar, 0.0, 0.0, 40.0, 40.0);
        let nodes = stack_nodes(&d, avatar, 10.0, 10.0, 0.0).unwrap();
        assert_eq!(nodes[0].kind, "unreadable");
        assert_eq!(unreadable_stack_sample(&d, avatar)["reason"], "svg paint");
    }

    /// A paragraph in a faded row: a candidate while the row is at rest, and
    /// none while the row is caught mid-reveal, since the pixels would read a
    /// frame of the fade.
    #[test]
    fn a_box_caught_mid_reveal_is_not_read_from_pixels() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        d.set_styles(body, &[("backgroundColor", "rgb(255, 255, 255)"), ("backgroundImage", "none")]);
        let row = d.add(Some(body), "div");
        d.set_styles(row, &[("backgroundColor", "rgba(0, 0, 0, 0)"), ("backgroundImage", "none"), ("opacity", "0.5")]);
        d.set_rect(row, 0.0, 0.0, 400.0, 40.0);
        let p = d.add(Some(row), "p");
        d.add_text(p, "Pick a template:");
        d.set_styles(p, &[("color", "rgb(10, 16, 21)"), ("fontSize", "16px"), ("fontWeight", "400"), ("backgroundColor", "rgba(0, 0, 0, 0)"), ("backgroundImage", "none"), ("opacity", "1")]);
        d.set_rect(p, 10.0, 10.0, 200.0, 20.0);
        let cands = collect_visual_contrast_candidates(&d, &json!({}));
        assert_eq!(cands.len(), 1, "{cands:?}");
        assert_eq!(cands[0]["reasons"], json!(["opacity stack"]));

        // Sliding in from under 0.1 opacity.
        d.set_styles(row, &[("opacity", "0.0283007"), ("transform", "matrix(1, 0, 0, 1, -19.1319, 0)")]);
        assert!(collect_visual_contrast_candidates(&d, &json!({})).is_empty());
        // Faded by a running animation.
        d.set_styles(row, &[("opacity", "0.5"), ("transform", "none")]);
        d.set_running_animations(row, &["opacity"]);
        assert!(collect_visual_contrast_candidates(&d, &json!({})).is_empty());
        // The animation settled.
        d.set_running_animations(row, &[]);
        assert_eq!(collect_visual_contrast_candidates(&d, &json!({})).len(), 1);
    }

    #[test]
    fn gradient_stops_are_judged_as_they_paint() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let sec = d.add(Some(body), "section");
        let radial = "radial-gradient(at 75% 42%, rgba(233, 231, 249, 0.72) 0px, rgba(0, 0, 0, 0) 58%)";
        let linear = "linear-gradient(rgb(242, 240, 250), rgba(0, 0, 0, 0) 75%)";
        // The `background` shorthand leaves a `none` layer beside its color.
        d.set_styles(sec, &[("backgroundImage", &format!("{radial}, none")), ("backgroundColor", "rgb(255, 255, 255)")]);
        let text = rgba(24.0, 25.0, 28.0, 1.0);
        let sample = |d: &FakeDom| match css_plan(d, sec, Some(&text)) {
            CssPlan::Sample { sample } => sample,
            other => panic!("{other:?}"),
        };
        let color = |d: &FakeDom| rgba_from_value(sample(d).get("color"));
        // Over the element's own white, a faded stop is never black.
        assert_eq!(color(&d), Some(rgba(239.0, 238.0, 251.0, 1.0)));
        // No ground of its own: a translucent stop is left to the pixels.
        let unread = |d: &FakeDom| sample(d)["reason"] == json!("gradient stops disagree");
        d.set_style(sec, "backgroundColor", "rgba(0, 0, 0, 0)");
        assert!(unread(&d));
        // A url() layer sits between the gradient and the color: the color is not the ground.
        d.set_styles(sec, &[
            ("backgroundImage", "linear-gradient(rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0)), url(\"a.png\")"),
            ("backgroundColor", "rgb(255, 255, 255)"),
        ]);
        assert!(unread(&d));
        // Stacked layers composite bottom up: the veil lands on the grey, not the white.
        d.set_style(sec, "backgroundImage", "linear-gradient(rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0.5)), linear-gradient(rgb(180, 180, 180), rgb(180, 180, 180))");
        assert_eq!(color(&d), Some(rgba(90.0, 90.0, 90.0, 1.0)));
        // A translucent layer over one that shows two colors reports the range
        // it can show: the worst, and the best beside it.
        d.set_style(sec, "backgroundImage", &format!("{radial}, {linear}"));
        let stacked = sample(&d);
        assert_eq!(rgba_from_value(stacked.get("color")), Some(rgba(236.0, 234.0, 249.0, 1.0)));
        assert_eq!(rgba_from_value(stacked.get("best")), Some(rgba(255.0, 255.0, 255.0, 1.0)));
        // Translucent text is ranked as it paints: red at 0.65 passes over white and
        // fails over black, so black is the worst end even though raw red is darker
        // against white.
        let veil_over_split = "linear-gradient(rgba(0, 0, 0, 0), rgba(0, 0, 0, 0)), linear-gradient(rgb(0, 0, 0), rgb(255, 255, 255))";
        d.set_style(sec, "backgroundImage", veil_over_split);
        let red = rgba(255.0, 0.0, 0.0, 0.65);
        let ranked = match css_plan(&d, sec, Some(&red)) {
            CssPlan::Sample { sample } => sample,
            other => panic!("{other:?}"),
        };
        assert_eq!(rgba_from_value(ranked.get("color")), Some(rgba(0.0, 0.0, 0.0, 1.0)));
        // Only a fully opaque fill is a ground: what is behind a 0.96 fill still shows.
        d.set_styles(sec, &[("backgroundImage", radial), ("backgroundColor", "rgba(255, 255, 255, 0.96)")]);
        assert!(unread(&d));
        // A layer that is not a gradient (a paint worklet) is not read as absent.
        d.set_styles(sec, &[("backgroundImage", &format!("{radial}, paint(dots)")), ("backgroundColor", "rgb(255, 255, 255)")]);
        assert!(unread(&d));
        // A small untiled gradient does not hide the layers outside it.
        d.set_styles(sec, &[
            ("backgroundImage", "linear-gradient(rgb(0, 0, 0), rgb(0, 0, 0)), linear-gradient(rgb(255, 255, 255), rgb(255, 255, 255))"),
            ("backgroundSize", "40px 40px, auto"),
            ("backgroundRepeat", "no-repeat, repeat"),
        ]);
        assert!(unread(&d));
        // Tiled, the same gradient paints the whole box.
        d.set_style(sec, "backgroundRepeat", "repeat");
        assert_eq!(color(&d), Some(rgba(0.0, 0.0, 0.0, 1.0)));
        // So does an untiled one whose `auto` side fills the box.
        d.set_styles(sec, &[("backgroundSize", "100% auto, auto"), ("backgroundRepeat", "no-repeat, repeat")]);
        assert_eq!(color(&d), Some(rgba(0.0, 0.0, 0.0, 1.0)));
    }

    #[test]
    fn candidates_and_prepare() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let sec = d.add(Some(body), "section");
        d.set_styles(sec, &[("backgroundImage", "linear-gradient(red, blue)"), ("backgroundColor", "rgba(0, 0, 0, 0)"), ("opacity", "1")]);
        d.set_rect(sec, 0.0, 0.0, 400.0, 200.0);
        let p = d.add(Some(sec), "p");
        d.add_text(p, "Hello world");
        d.set_styles(p, &[("color", "rgb(10, 10, 10)"), ("fontSize", "16px"), ("fontWeight", "400"), ("backgroundColor", "rgba(0, 0, 0, 0)"), ("backgroundImage", "none"), ("opacity", "1")]);
        d.set_rect(p, 10.0, 10.0, 200.0, 20.0);
        let cands = collect_visual_contrast_candidates(&d, &json!({}));
        assert_eq!(cands.len(), 1);
        let c = &cands[0];
        assert_eq!(c["reasons"], json!(["gradient background"]));
        assert_eq!(c["threshold"], json!(4.5));
        assert_eq!(c["clip"], json!({ "x": 8.0, "y": 8.0, "width": 204.0, "height": 24.0 }));
        assert_eq!(c["preferRenderedForeground"], json!(false));
        assert!(collect_visual_contrast_candidates(&d, &json!({ "imageOnly": true })).is_empty());
        let keys: Vec<&String> = c.as_object().unwrap().keys().collect();
        assert_eq!(keys, ["selector", "tagName", "text", "threshold", "reasons", "clip", "textColor", "preferRenderedForeground", "backgroundClipText"]);
        match prepare_analysis(&d, c) {
            Prepared::Ready { el, points, .. } => {
                assert_eq!(el, p);
                assert_eq!(points.len(), 3);
            }
            other => panic!("{other:?}"),
        }
        let blocked = json!({ "selector": "p", "reasons": ["opacity stack"] });
        match prepare_analysis(&d, &blocked) {
            Prepared::Early { early } => assert_eq!(early["reason"], "opacity stack needs screenshot pixels"),
            _ => panic!(),
        }
    }

    fn text_run(d: &mut FakeDom, parent: ElId, tag: &str, text: &str, rect: (f64, f64, f64, f64)) -> ElId {
        let el = d.add(Some(parent), tag);
        d.add_text(el, text);
        d.set_styles(
            el,
            &[
                ("color", "rgb(250, 250, 250)"),
                ("fontSize", "16px"),
                ("fontWeight", "400"),
                ("backgroundColor", "rgba(0, 0, 0, 0)"),
                ("backgroundImage", "none"),
                ("opacity", "1"),
            ],
        );
        d.set_rect(el, rect.0, rect.1, rect.2, rect.3);
        el
    }

    #[test]
    fn outlines_are_rings_of_sharp_shadows_or_a_stroke() {
        let mut d = FakeDom::new();
        let (_, body) = d.with_page();
        let el = text_run(&mut d, body, "span", "POOL", (0.0, 0.0, 120.0, 80.0));
        d.set_style(el, "color", "rgb(255, 206, 62)");
        let ring = "rgb(20, 34, 74) -2px -2px 0px, rgb(20, 34, 74) 2px -2px 0px, rgb(20, 34, 74) -2px 2px 0px, rgb(20, 34, 74) 2px 2px 0px";
        d.set_style(el, "textShadow", ring);
        assert!(text_outlined(&d, el), "a ring of sharp shadows");
        d.set_style(el, "textShadow", "rgb(20, 34, 74) 5px 6px 0px");
        assert!(!text_outlined(&d, el), "one drop shadow");
        d.set_style(el, "textShadow", "rgba(0, 0, 0, 0.6) 0px 0px 5px");
        assert!(!text_outlined(&d, el), "a soft halo");
        d.set_style(el, "textShadow", "rgb(255, 206, 62) -2px 0px 0px, rgb(255, 206, 62) 2px 0px 0px");
        assert!(!text_outlined(&d, el), "a ring in the fill's own colour thickens the glyph");
        d.set_style(el, "textShadow", "none");
        d.set_styles(el, &[("webkitTextStrokeWidth", "2px"), ("webkitTextStrokeColor", "rgb(20, 34, 74)")]);
        assert!(text_outlined(&d, el), "a stroke in a colour of its own");
        d.set_style(el, "webkitTextStrokeColor", "rgb(255, 206, 62)");
        assert!(!text_outlined(&d, el), "a stroke in the fill's colour");
    }

    #[test]
    fn a_covering_gradient_beside_the_text_is_unread_paint() {
        let mut d = FakeDom::new();
        let (_, body) = d.with_page();
        d.set_style(body, "backgroundColor", "rgb(255, 255, 255)");
        let hero = d.add(Some(body), "section");
        d.set_rect(hero, 0.0, 2000.0, 1280.0, 600.0);
        d.set_styles(hero, &[("position", "relative"), ("backgroundColor", "rgba(0, 0, 0, 0)"), ("opacity", "1")]);
        let layer = d.add(Some(hero), "div");
        d.set_rect(layer, 0.0, 2000.0, 1280.0, 600.0);
        d.set_styles(layer, &[("position", "absolute"), ("backgroundColor", "rgba(0, 0, 0, 0)"), ("opacity", "1")]);
        let p = text_run(&mut d, hero, "p", "Copy", (20.0, 2300.0, 400.0, 24.0));
        let set = |d: &mut FakeDom, image: &str| {
            d.set_style(layer, "backgroundImage", image);
        };
        set(&mut d, "linear-gradient(rgb(10, 31, 17), rgb(14, 37, 29))");
        let (under, found) = layer_under_text_found(&d, p);
        assert_eq!(found, Some(layer));
        let LayerUnder::Gradient { lo, hi } = under else { panic!("{under:?}") };
        assert_eq!((lo.r, lo.g, lo.b, hi.r, hi.g, hi.b), (10.0, 31.0, 17.0, 14.0, 37.0, 29.0));
        assert!(!layer_matches_surface(under, Some(Rgba::new(255.0, 255.0, 255.0, 1.0))));
        assert!(layer_matches_surface(under, Some(Rgba::new(12.0, 34.0, 23.0, 1.0))));
        // A glow that lets the page through is unmodelled paint.
        set(&mut d, "radial-gradient(rgba(37, 99, 235, 0.4), rgba(0, 0, 0, 0) 60%)");
        assert_eq!(layer_under_text(&d, p), LayerUnder::Unmodelled);
        // A dot grid, and a wash at 5%, are decoration.
        set(&mut d, "radial-gradient(rgb(51, 65, 85) 1px, rgba(0, 0, 0, 0) 1px)");
        assert_eq!(layer_under_text(&d, p), LayerUnder::Ancestor);
        set(&mut d, "linear-gradient(rgba(0, 0, 0, 0.05), rgba(0, 0, 0, 0.05))");
        assert_eq!(layer_under_text(&d, p), LayerUnder::Ancestor);
    }

    #[test]
    fn an_opaque_gradient_ancestor_is_the_walks_surface() {
        // A card painting its own opaque gradient over a hero photo: the walk
        // scores its stops, and the photo under the card is not under the text.
        let mut d = FakeDom::new();
        let (_, body) = d.with_page();
        d.set_style(body, "backgroundColor", "rgb(255, 255, 255)");
        let hero = d.add(Some(body), "section");
        d.set_rect(hero, 0.0, 2000.0, 1280.0, 600.0);
        d.set_styles(hero, &[("position", "relative"), ("backgroundColor", "rgba(0, 0, 0, 0)"), ("opacity", "1")]);
        let photo = d.add(Some(hero), "img");
        d.set_rect(photo, 0.0, 2000.0, 1280.0, 600.0);
        d.set_styles(photo, &[("position", "absolute"), ("opacity", "1")]);
        let card = d.add(Some(hero), "div");
        d.set_rect(card, 20.0, 2200.0, 600.0, 200.0);
        d.set_styles(
            card,
            &[
                ("position", "relative"),
                ("backgroundColor", "rgba(0, 0, 0, 0)"),
                ("backgroundImage", "linear-gradient(rgb(40, 20, 90), rgb(70, 30, 150))"),
                ("opacity", "1"),
            ],
        );
        let a = text_run(&mut d, card, "a", "Read more", (40.0, 2300.0, 120.0, 20.0));
        assert_eq!(layer_under_text(&d, a), LayerUnder::Ancestor);
        d.set_style(card, "backgroundImage", "linear-gradient(rgba(40, 20, 90, 0.5), rgba(70, 30, 150, 0.5))");
        assert_eq!(layer_under_text(&d, a), LayerUnder::Picture, "a translucent card shows the photo");
    }

    /// A white card below the fold holding a short note, with its
    /// `::before` set to `pseudo`.
    fn card_with_pseudo(pseudo: &[(&str, &str)]) -> (FakeDom, ElId, ElId) {
        let mut d = FakeDom::new();
        let (_, body) = d.with_page();
        d.set_style(body, "backgroundColor", "rgb(255, 255, 255)");
        let card = d.add(Some(body), "div");
        d.set_rect(card, 0.0, 2000.0, 420.0, 200.0);
        d.set_styles(
            card,
            &[
                ("position", "relative"),
                ("backgroundColor", "rgb(255, 255, 255)"),
                ("opacity", "1"),
                ("isolation", "auto"),
            ],
        );
        for (prop, value) in pseudo {
            d.set_pseudo_style(card, "::before", prop, value);
        }
        let p = text_run(&mut d, card, "p", "Billed yearly", (28.0, 2100.0, 80.0, 21.0));
        (d, card, p)
    }

    const BADGE: &[(&str, &str)] = &[
        ("content", "\"MOST POPULAR\""),
        ("position", "absolute"),
        ("display", "block"),
        ("width", "104px"),
        ("height", "21px"),
        ("top", "-12px"),
        ("left", "296px"),
        ("right", "20px"),
        ("bottom", "191px"),
        ("backgroundColor", "rgb(17, 24, 39)"),
        ("backgroundImage", "none"),
        ("transform", "none"),
        ("zIndex", "auto"),
    ];

    #[test]
    fn a_pseudo_decides_only_where_it_paints_over_the_text() {
        let dark = Rgba::new(17.0, 24.0, 39.0, 1.0);
        // visiby.net 3806: a "Most popular" badge at the card's corner is as
        // large as the note, and nowhere near it.
        let (mut d, card, p) = card_with_pseudo(BADGE);
        assert_eq!(layer_under_text(&d, p), LayerUnder::Ancestor, "a corner badge");
        // Stretched over the card, it is the surface.
        for (prop, value) in [("top", "0px"), ("left", "0px"), ("width", "420px"), ("height", "200px")] {
            d.set_pseudo_style(card, "::before", prop, value);
        }
        assert_eq!(layer_under_text_found(&d, p), (LayerUnder::Detached(dark), Some(card)));
        assert_eq!(found_order(&d, p, &d.rect(p), card), Order::Over);
        // An offset shadow at `z-index: -1` paints beneath the card's white.
        d.set_pseudo_style(card, "::before", "zIndex", "-1");
        d.set_pseudo_style(card, "::before", "transform", "matrix(1, 0, 0, 1, 8, 8)");
        assert_eq!(layer_under_text(&d, p), LayerUnder::Ancestor, "an offset shadow");
        // A card that opens its own stacking context paints it over its fill.
        d.set_style(card, "zIndex", "0");
        assert_eq!(layer_under_text(&d, p), LayerUnder::Detached(dark), "in the card's own context");
        d.set_style(card, "zIndex", "auto");
        // A capture that did not record the pseudo's `z-index` reads it as it
        // always did, but cannot say it is over the card's fill.
        d.set_pseudo_style(card, "::before", "zIndex", "");
        assert_eq!(layer_under_text(&d, p), LayerUnder::Detached(dark));
        assert_eq!(found_order(&d, p, &d.rect(p), card), Order::Unknown);
        // With no fill for it to hide beneath, the order does not matter.
        d.set_style(card, "backgroundColor", "rgba(0, 0, 0, 0)");
        assert_eq!(found_order(&d, p, &d.rect(p), card), Order::Over);
        d.set_style(card, "backgroundColor", "rgb(255, 255, 255)");
        // A pseudo the capture cannot place (rotated) keeps the old size
        // test, and is not placed for certain either.
        d.set_pseudo_style(card, "::before", "zIndex", "auto");
        d.set_pseudo_style(card, "::before", "transform", "matrix(0.7, 0.7, -0.7, 0.7, 0, 0)");
        assert_eq!(layer_under_text(&d, p), LayerUnder::Detached(dark));
        assert_eq!(found_order(&d, p, &d.rect(p), card), Order::Unknown);
        // yungching.com.tw: a rotated decoration whose bounds lie off the
        // text is not under it.
        for (prop, value) in [("top", "-12px"), ("left", "296px"), ("width", "104px"), ("height", "21px")] {
            d.set_pseudo_style(card, "::before", prop, value);
        }
        assert_eq!(layer_under_text(&d, p), LayerUnder::Ancestor, "a rotated corner decoration");
    }

    #[test]
    fn a_translated_pseudo_is_placed_where_it_moved() {
        let (mut d, card, _) = card_with_pseudo(BADGE);
        // The badge moved down over the note by the `translate` property.
        d.set_pseudo_style(card, "::before", "translate", "-250px 105px");
        d.set_pseudo_style(card, "::before", "width", "110px");
        assert_eq!(pseudo_box(&d, card, "::before").map(|(r, e)| (r.left, r.top, e)), Some((46.0, 2093.0, true)));
        d.set_pseudo_style(card, "::before", "translate", "-100% 500%");
        assert_eq!(pseudo_box(&d, card, "::before").map(|(r, e)| (r.left, r.top, e)), Some((186.0, 2093.0, true)));
        // Rotated a half turn about its centre it covers the same box, but
        // only the bounds are known.
        d.set_pseudo_style(card, "::before", "translate", "none");
        d.set_pseudo_style(card, "::before", "transform", "matrix(-1, 0, 0, -1, 0, 0)");
        let (r, exact) = pseudo_box(&d, card, "::before").unwrap();
        assert_eq!((r.left.round(), r.top.round(), r.width.round(), r.height.round(), exact), (296.0, 1988.0, 110.0, 21.0, false));
        d.set_pseudo_style(card, "::before", "transform", "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)");
        assert_eq!(pseudo_box(&d, card, "::before"), None);
    }

    #[test]
    fn a_negative_layer_under_an_ancestor_fill_is_hidden() {
        // `section.relative.bg-white > (div.absolute.inset-0.-z-10, content)`:
        // Chrome paints the section's white over the layer.
        let mut d = FakeDom::new();
        let (_, body) = d.with_page();
        d.set_style(body, "backgroundColor", "rgb(255, 255, 255)");
        let section = d.add(Some(body), "section");
        d.set_rect(section, 0.0, 2000.0, 1280.0, 400.0);
        d.set_styles(
            section,
            &[
                ("position", "relative"),
                ("backgroundColor", "rgb(255, 255, 255)"),
                ("opacity", "1"),
                ("isolation", "auto"),
            ],
        );
        let layer = d.add(Some(section), "div");
        d.set_rect(layer, 0.0, 2000.0, 1280.0, 400.0);
        d.set_styles(
            layer,
            &[
                ("position", "absolute"),
                ("zIndex", "-10"),
                ("backgroundColor", "rgba(0, 0, 0, 0)"),
                ("backgroundImage", "linear-gradient(135deg, rgb(15, 23, 42), rgb(30, 41, 59))"),
                ("opacity", "1"),
            ],
        );
        let content = d.add(Some(section), "div");
        d.set_rect(content, 0.0, 2000.0, 1280.0, 400.0);
        d.set_styles(content, &[("position", "relative"), ("backgroundColor", "rgba(0, 0, 0, 0)"), ("opacity", "1")]);
        let p = text_run(&mut d, content, "p", "Guest seats", (20.0, 2100.0, 300.0, 24.0));
        assert_eq!(layer_under_text(&d, p), LayerUnder::Ancestor, "hidden under the section's white");
        // An isolated section paints the layer over its own fill.
        d.set_style(section, "isolation", "isolate");
        assert_eq!(layer_under_text_found(&d, p).1, Some(layer));
        // A capture that did not record `isolation` reads the layer as it
        // always did, and cannot say which of the two it is.
        d.set_style(section, "isolation", "");
        assert_eq!(layer_under_text_found(&d, p).1, Some(layer));
        assert_eq!(found_order(&d, p, &d.rect(p), layer), Order::Unknown);
        // Tailwind's `isolate` class says it there.
        d.set_attr(section, "class", "relative isolate bg-white");
        assert_eq!(found_order(&d, p, &d.rect(p), layer), Order::Over);
        // A section with no fill of its own hides nothing.
        d.set_attr(section, "class", "relative");
        d.set_style(section, "backgroundColor", "rgba(0, 0, 0, 0)");
        assert_eq!(found_order(&d, p, &d.rect(p), layer), Order::Over);
    }

    #[test]
    fn an_svg_shape_counts_only_drawn_around_the_text() {
        let mut d = FakeDom::new();
        let (_, body) = d.with_page();
        d.set_style(body, "backgroundColor", "rgb(255, 255, 255)");
        let svg = d.add(Some(body), "svg");
        d.el_mut(svg).ns = impeccable_foundation::browser::snapshot::NS_SVG.to_string();
        d.set_rect(svg, 100.0, 2000.0, 48.0, 48.0);
        d.set_styles(svg, &[("backgroundColor", "rgba(0, 0, 0, 0)"), ("opacity", "1")]);
        let circle = d.add(Some(svg), "circle");
        d.el_mut(circle).ns = impeccable_foundation::browser::snapshot::NS_SVG.to_string();
        d.set_rect(circle, 100.0, 2000.0, 48.0, 48.0);
        d.set_styles(circle, &[("backgroundColor", "rgba(0, 0, 0, 0)"), ("opacity", "1")]);
        let text = text_run(&mut d, svg, "text", "M", (114.0, 2012.0, 20.0, 24.0));
        d.el_mut(text).ns = impeccable_foundation::browser::snapshot::NS_SVG.to_string();
        assert_eq!(layer_under_text_found(&d, text), (LayerUnder::Unmodelled, Some(circle)));
        // The same shape drawn behind a whole section is decoration.
        d.set_rect(circle, 0.0, 1500.0, 1280.0, 1200.0);
        assert_eq!(layer_under_text(&d, text), LayerUnder::Ancestor);
    }

    #[test]
    fn the_second_budget_takes_what_the_element_pass_hands_over() {
        let mut d = FakeDom::new();
        let (html, body) = d.with_page();
        d.set_rect(html, 0.0, 0.0, 1280.0, 4000.0);
        d.set_rect(body, 0.0, 0.0, 1280.0, 4000.0);
        d.set_style(body, "backgroundColor", "rgb(255, 255, 255)");
        // A candidate the first budget has always taken.
        let band = d.add(Some(body), "section");
        d.set_rect(band, 0.0, 0.0, 1280.0, 200.0);
        d.set_styles(
            band,
            &[
                ("backgroundImage", "linear-gradient(rgb(230, 226, 216), rgb(217, 212, 200))"),
                ("backgroundColor", "rgba(0, 0, 0, 0)"),
                ("opacity", "1"),
            ],
        );
        text_run(&mut d, band, "p", "Band copy", (10.0, 10.0, 200.0, 20.0));
        // A link with no fill over a hero photo, which the first budget never takes.
        let hero = d.add(Some(body), "section");
        d.set_rect(hero, 0.0, 1200.0, 1280.0, 600.0);
        d.set_styles(hero, &[("position", "relative"), ("backgroundColor", "rgba(0, 0, 0, 0)"), ("opacity", "1")]);
        let photo = d.add(Some(hero), "img");
        d.set_rect(photo, 0.0, 1200.0, 1280.0, 600.0);
        d.set_styles(photo, &[("position", "absolute"), ("opacity", "1")]);
        let content = d.add(Some(hero), "div");
        d.set_rect(content, 0.0, 1400.0, 1280.0, 100.0);
        d.set_styles(content, &[("position", "relative"), ("backgroundColor", "rgba(0, 0, 0, 0)"), ("opacity", "1")]);
        text_run(&mut d, content, "a", "View pricing", (20.0, 1420.0, 140.0, 20.0));

        let first = collect_visual_contrast_candidates(&d, &json!({ "maxCandidates": 12 }));
        assert_eq!(first.len(), 1, "{first:#?}");
        assert!(first[0].get("routed").is_none());
        let both = collect_visual_contrast_candidates(&d, &json!({ "maxCandidates": 12, "maxRoutedCandidates": 12 }));
        assert_eq!(both.len(), 2, "{both:#?}");
        assert_eq!(both[0], first[0], "the first budget is what it was");
        assert_eq!(both[1]["text"], json!("View pricing"));
        assert_eq!(both[1]["routed"], json!("unread layer"));
        assert!(both[1]["reasons"].as_array().unwrap().contains(&json!("unread layer")));
        let none = collect_visual_contrast_candidates(&d, &json!({ "maxCandidates": 12, "maxRoutedCandidates": 0 }));
        assert_eq!(none, first);
    }

    /// fischundfang.de marks its whole page wrapper `aria-hidden="true"`.
    /// The element pass scores the text in it, so the verdicts it hands over
    /// have to reach the pixels.
    #[test]
    fn handed_over_text_in_an_aria_hidden_box_takes_a_routed_slot() {
        let mut d = FakeDom::new();
        let (html, body) = d.with_page();
        d.set_rect(html, 0.0, 0.0, 1280.0, 4000.0);
        d.set_rect(body, 0.0, 0.0, 1280.0, 4000.0);
        d.set_style(body, "backgroundColor", "rgb(255, 255, 255)");
        let wrap = d.add(Some(body), "div");
        d.set_rect(wrap, 0.0, 0.0, 1280.0, 4000.0);
        d.set_styles(wrap, &[("backgroundColor", "rgba(0, 0, 0, 0)"), ("opacity", "1")]);
        d.set_attr(wrap, "aria-hidden", "true");
        // A first-budget candidate inside it stays out, as it always did.
        let band = d.add(Some(wrap), "section");
        d.set_rect(band, 0.0, 0.0, 1280.0, 200.0);
        d.set_styles(
            band,
            &[
                ("backgroundImage", "linear-gradient(rgb(230, 226, 216), rgb(217, 212, 200))"),
                ("backgroundColor", "rgba(0, 0, 0, 0)"),
                ("opacity", "1"),
            ],
        );
        text_run(&mut d, band, "p", "Band copy", (10.0, 10.0, 200.0, 20.0));
        // A caption over a photo, which the element pass hands over.
        let hero = d.add(Some(wrap), "section");
        d.set_rect(hero, 0.0, 1200.0, 1280.0, 600.0);
        d.set_styles(hero, &[("position", "relative"), ("backgroundColor", "rgba(0, 0, 0, 0)"), ("opacity", "1")]);
        let photo = d.add(Some(hero), "img");
        d.set_rect(photo, 0.0, 1200.0, 1280.0, 600.0);
        d.set_styles(photo, &[("position", "absolute"), ("opacity", "1")]);
        let content = d.add(Some(hero), "div");
        d.set_rect(content, 0.0, 1400.0, 1280.0, 100.0);
        d.set_styles(content, &[("position", "relative"), ("backgroundColor", "rgba(0, 0, 0, 0)"), ("opacity", "1")]);
        let caption = text_run(&mut d, content, "a", "19. Juni 2024", (20.0, 1420.0, 140.0, 20.0));

        let first = collect_visual_contrast_candidates(&d, &json!({ "maxCandidates": 12 }));
        assert!(first.is_empty(), "{first:#?}");
        let both = collect_visual_contrast_candidates(&d, &json!({ "maxCandidates": 12, "maxRoutedCandidates": 12 }));
        assert_eq!(both.len(), 1, "{both:#?}");
        assert_eq!(both[0]["text"], json!("19. Juni 2024"));
        assert_eq!(both[0]["routed"], json!("unread layer"));
        // What is not painted stays out of both budgets.
        d.set_style(wrap, "visibility", "hidden");
        d.set_style(caption, "visibility", "hidden");
        let hidden = collect_visual_contrast_candidates(&d, &json!({ "maxCandidates": 12, "maxRoutedCandidates": 12 }));
        assert!(hidden.is_empty(), "{hidden:#?}");
    }

    /// epcco.com.sa: `background: url(bg-2.jpg) center 0 / cover no-repeat
    /// fixed` on the band.
    #[test]
    fn a_fixed_image_ends_the_walk_unread() {
        let mut d = FakeDom::new();
        let (_, body) = d.with_page();
        let band = d.add(Some(body), "section");
        d.set_rect(band, 0.0, 1800.0, 1280.0, 155.0);
        let image = "url(\"https://example.com/bg-2.jpg\")";
        let paint = |d: &mut FakeDom, attachment: &str| {
            d.set_styles(
                band,
                &[
                    ("backgroundColor", "rgba(0, 0, 0, 0)"),
                    ("backgroundImage", image),
                    ("backgroundSize", "cover"),
                    ("backgroundPosition", "50% 0px"),
                    ("background", &format!("rgba(0, 0, 0, 0) {image} no-repeat {attachment} 50% 0px / cover padding-box border-box")),
                ],
            );
        };
        let white = rgba(255.0, 255.0, 255.0, 1.0);
        paint(&mut d, "fixed");
        match css_plan(&d, band, Some(&white)) {
            CssPlan::Sample { sample } => {
                assert_eq!(sample["reason"], "fixed background image");
                assert!(sample_ends_walk(&sample));
            }
            other => panic!("a fixed image was mapped onto its box: {other:?}"),
        }
        paint(&mut d, "scroll");
        assert!(matches!(css_plan(&d, band, Some(&white)), CssPlan::Url { .. }));
        // No shorthand recorded: read as before.
        d.set_style(band, "background", "");
        assert!(matches!(css_plan(&d, band, Some(&white)), CssPlan::Url { .. }));
        // An image that did not load ends the walk as well.
        assert!(sample_ends_walk(&css_url_no_image(&d, band, band, "cover", "50% 0px")));
    }

    #[test]
    fn the_sampled_pass_refuses_what_it_hands_to_the_pixels() {
        let mut d = FakeDom::new();
        let (_, body) = d.with_page();
        let p = text_run(&mut d, body, "p", "Copy", (10.0, 10.0, 200.0, 20.0));
        d.add_selector(p, "p");
        for reason in ["unread layer", "text outline"] {
            let candidate = json!({ "selector": "p", "reasons": [reason], "threshold": 4.5 });
            match prepare_analysis(&d, &candidate) {
                Prepared::Early { early } => assert_eq!(early["status"], json!("unresolved"), "{reason}"),
                Prepared::Ready { .. } => panic!("{reason} was sampled"),
            }
        }
        // A first-budget candidate is sampled as before where nothing the
        // stack walk cannot see lies under it.
        let routed = json!({ "selector": "p", "reasons": ["image background"], "routed": "unread layer", "threshold": 4.5 });
        assert!(matches!(prepare_analysis(&d, &routed), Prepared::Ready { .. }));

        // epcco.com.sa's footer: a `::before` scrim stretched over the
        // card, which no hit-test stack lists, goes to the pixels.
        let (mut d, card, p) = card_with_pseudo(BADGE);
        for (prop, value) in [("top", "0px"), ("left", "0px"), ("width", "420px"), ("height", "200px")] {
            d.set_pseudo_style(card, "::before", prop, value);
        }
        d.add_selector(p, "p");
        match prepare_analysis(&d, &routed) {
            Prepared::Early { early } => assert_eq!(early["reason"], "unread layer needs screenshot pixels"),
            Prepared::Ready { .. } => panic!("the scrim's text was sampled"),
        }
        // Without the `routed` mark it is not refused for the scrim.
        let unmarked = json!({ "selector": "p", "reasons": ["image background"], "threshold": 4.5 });
        if let Prepared::Early { early } = prepare_analysis(&d, &unmarked) {
            assert_ne!(early["reason"], "unread layer needs screenshot pixels");
        }
    }

    #[test]
    fn a_faded_picture_is_read_faded_and_an_unread_one_ends_the_walk() {
        let mut d = FakeDom::new();
        let (_, body) = d.with_page();
        let card = d.add(Some(body), "div");
        d.set_styles(card, &[("opacity", "1")]);
        let wrapper = d.add(Some(card), "div");
        d.set_styles(wrapper, &[("opacity", "0.1")]);
        let img = d.add(Some(wrapper), "img");
        d.set_styles(img, &[("opacity", "0.5")]);
        let text = d.add(Some(card), "h3");
        d.set_styles(text, &[("opacity", "1")]);
        let sampled = json!({ "status": "sampled", "color": { "r": 10, "g": 10, "b": 10, "a": 1.0 }, "method": "canvas-img-underlay" });
        let faded = media_sample(&d, img, text, sampled.clone());
        assert!((faded["color"]["a"].as_f64().unwrap() - 0.05).abs() < 1e-9, "{faded}");
        assert!(!sample_is_opaque(&faded));
        // A picture at full opacity is read as it was.
        d.set_styles(wrapper, &[("opacity", "1")]);
        d.set_styles(img, &[("opacity", "1")]);
        assert_eq!(media_sample(&d, img, text, sampled), json!({ "status": "sampled", "color": { "r": 10, "g": 10, "b": 10, "a": 1.0 }, "method": "canvas-img-underlay" }));
        let tainted = media_sample(&d, img, text, json!({ "status": "unresolved", "reason": "tainted image" }));
        assert!(sample_ends_walk(&tainted), "{tainted}");
        let outside = media_sample(&d, img, text, json!({ "status": "unresolved", "reason": "point outside image" }));
        assert!(!sample_ends_walk(&outside), "{outside}");
    }

    fn candidate_texts(d: &FakeDom) -> Vec<String> {
        collect_visual_contrast_candidates(d, &json!({ "maxCandidates": 50 }))
            .iter()
            .map(|c| c["text"].as_str().unwrap_or("").to_string())
            .collect()
    }

    #[test]
    fn the_pass_takes_only_text_a_reader_sees() {
        let mut d = FakeDom::new();
        let (html, body) = d.with_page();
        d.set_rect(html, 0.0, 0.0, 390.0, 4000.0);
        d.set_rect(body, 0.0, 0.0, 390.0, 4000.0);
        d.el_mut(html).scroll_width = 390.0;
        let section = d.add(Some(body), "section");
        d.set_styles(
            section,
            &[
                ("backgroundImage", "linear-gradient(rgb(230, 226, 216), rgb(217, 212, 200))"),
                ("backgroundColor", "rgba(0, 0, 0, 0)"),
                ("opacity", "1"),
            ],
        );
        d.set_rect(section, 0.0, 0.0, 390.0, 900.0);
        text_run(&mut d, section, "p", "Visible copy", (10.0, 10.0, 200.0, 20.0));

        // A tab strip that clips its row at 380px: the second cell sits at
        // x 600, which only a scroll the page never makes would show.
        let strip = d.add(Some(section), "div");
        d.set_styles(
            strip,
            &[
                ("overflowX", "hidden"),
                ("overflowY", "hidden"),
                ("backgroundImage", "none"),
                ("backgroundColor", "rgba(0, 0, 0, 0)"),
                ("opacity", "1"),
            ],
        );
        d.set_rect(strip, 10.0, 100.0, 370.0, 60.0);
        text_run(&mut d, strip, "p", "First cell", (36.0, 110.0, 248.0, 40.0));
        text_run(&mut d, strip, "p", "Past the strip", (600.0, 110.0, 248.0, 40.0));

        // Two faded controls with a fill of their own; the disabled one is
        // exempt, as it is in the element pass.
        for (label, top, disabled) in [("Continue", 200.0, true), ("Submit", 260.0, false)] {
            let button = text_run(&mut d, section, "button", label, (10.0, top, 200.0, 40.0));
            d.set_styles(button, &[("backgroundColor", "rgb(55, 65, 81)"), ("opacity", "0.5")]);
            if disabled {
                d.add_selector(button, "[disabled]");
            }
        }

        // A launcher whose label is set in 0px transparent ink over its own
        // gradient.
        let launcher = text_run(&mut d, section, "button", "ASK FEDEX", (284.0, 320.0, 80.0, 56.0));
        d.set_styles(
            launcher,
            &[
                ("backgroundColor", "rgb(77, 20, 140)"),
                ("backgroundImage", "linear-gradient(270deg, rgb(77, 20, 140) 0%, rgb(77, 20, 140) 100%)"),
                ("fontSize", "0px"),
                ("color", "rgba(0, 0, 0, 0)"),
            ],
        );

        // A lone circle, and copy filled with nothing.
        text_run(&mut d, section, "div", "\u{25EF}", (10.0, 400.0, 52.0, 84.0));
        let unfilled = text_run(&mut d, section, "p", "Filled with nothing", (10.0, 500.0, 200.0, 20.0));
        d.set_style(unfilled, "webkitTextFillColor", "rgba(0, 0, 0, 0)");

        // A heading that paints its own gradient into its glyphs keeps its
        // slot: both passes refuse it later, as before.
        let heading = text_run(&mut d, section, "h2", "Gradient heading", (10.0, 560.0, 300.0, 40.0));
        d.set_styles(
            heading,
            &[
                ("webkitBackgroundClip", "text"),
                ("backgroundImage", "linear-gradient(90deg, rgb(62, 69, 204), rgb(133, 38, 254))"),
                ("color", "rgba(0, 0, 0, 0)"),
                ("webkitTextFillColor", "rgba(0, 0, 0, 0)"),
            ],
        );

        assert_eq!(
            candidate_texts(&d),
            vec!["Visible copy", "First cell", "Submit", "Gradient heading"]
        );
    }

    #[test]
    fn hidden_candidates_no_longer_spend_the_budget() {
        let mut d = FakeDom::new();
        let (html, body) = d.with_page();
        d.set_rect(html, 0.0, 0.0, 1280.0, 2000.0);
        d.el_mut(html).scroll_width = 1280.0;
        let track = d.add(Some(body), "div");
        d.set_styles(
            track,
            &[
                ("overflowX", "hidden"),
                ("overflowY", "hidden"),
                ("backgroundImage", "url(\"https://example.com/photo.jpg\")"),
                ("backgroundColor", "rgba(0, 0, 0, 0)"),
                ("opacity", "1"),
            ],
        );
        d.set_rect(track, 0.0, 0.0, 600.0, 300.0);
        for i in 0..12 {
            text_run(&mut d, track, "p", "Parked slide", (700.0 + 600.0 * i as f64, 20.0, 200.0, 20.0));
        }
        text_run(&mut d, track, "p", "Active slide", (20.0, 20.0, 200.0, 20.0));
        assert_eq!(
            collect_visual_contrast_candidates(&d, &json!({}))
                .iter()
                .map(|c| c["text"].as_str().unwrap_or(""))
                .collect::<Vec<_>>(),
            vec!["Active slide"]
        );
    }

    #[test]
    fn an_image_that_covers_neither_the_text_nor_its_box_is_not_the_surface() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();

        // A 32px badge carrying a 22x16 frame sprite, the count centred on
        // it: the sprite covers the glyphs, not the badge.
        let badge = d.add(Some(body), "span");
        d.set_rect(badge, 200.0, 100.0, 32.0, 32.0);
        d.set_style(
            badge,
            "background",
            "rgba(0, 0, 0, 0.6) url(\"https://example.com/frame.svg\") no-repeat scroll 50% 50% / 22px 16px padding-box border-box",
        );
        let count = d.add(Some(badge), "i");
        d.add_text(count, "12");
        d.set_rect(count, 210.0, 107.5, 12.0, 17.0);
        d.set_text_rect(count, 211.0, 108.5, 10.0, 12.0);
        let sample =
            css_url_source_point(&d, badge, count, 30.0, 22.0, "22px 16px", "50% 50%", 216.0, 114.0)
                .unwrap_err();
        assert_eq!(sample["reason"], "background image does not cover the text");
        assert!(sample_ends_walk(&sample));
        // An image this pass could not load is still painted on the page, and
        // its stated placement says the same without its pixels.
        assert!(sample_ends_walk(&css_url_no_image(&d, badge, count, "22px 16px", "50% 50%")));

        // A 16px mark beside a button's label: the label is not over it.
        let button = d.add(Some(body), "button");
        d.set_rect(button, 0.0, 500.0, 200.0, 40.0);
        d.set_style(
            button,
            "background",
            "rgb(31, 41, 55) url(\"data:image/svg+xml,x\") no-repeat scroll 12px 50% / 16px 16px padding-box border-box",
        );
        d.add_text(button, "Download");
        d.set_text_rect(button, 40.0, 510.0, 80.0, 20.0);
        let sample =
            css_url_source_point(&d, button, button, 16.0, 16.0, "16px 16px", "12px 50%", 60.0, 520.0)
                .unwrap_err();
        assert!(sample_ends_walk(&sample));

        // A photo drawn to cover its card is the surface.
        let card = d.add(Some(body), "div");
        d.set_rect(card, 0.0, 200.0, 400.0, 240.0);
        d.set_style(
            card,
            "background",
            "rgba(0, 0, 0, 0) url(\"https://example.com/photo.jpg\") no-repeat scroll 50% 50% / cover padding-box border-box",
        );
        let caption = d.add(Some(card), "p");
        d.add_text(caption, "Caption");
        d.set_rect(caption, 20.0, 380.0, 200.0, 24.0);
        assert!(css_url_source_point(&d, card, caption, 1600.0, 900.0, "cover", "50% 50%", 60.0, 390.0).is_ok());
        assert_eq!(css_url_no_image(&d, card, caption, "cover", "50% 50%")["reason"], "image unavailable");

        // A repeating tile covers what it paints; outside its first tile the
        // point is unresolved, and the walk ends on the box rather than score
        // the text against what lies beneath it.
        let tiled = d.add(Some(body), "div");
        d.set_rect(tiled, 0.0, 600.0, 400.0, 200.0);
        d.set_style(
            tiled,
            "background",
            "rgb(20, 20, 20) url(\"https://example.com/noise.png\") repeat scroll 0% 0% / 64px 64px padding-box border-box",
        );
        let words = d.add(Some(tiled), "p");
        d.add_text(words, "Words");
        d.set_rect(words, 20.0, 620.0, 300.0, 24.0);
        assert!(css_url_source_point(&d, tiled, words, 64.0, 64.0, "64px 64px", "0% 0%", 30.0, 630.0).is_ok());
        let outside =
            css_url_source_point(&d, tiled, words, 64.0, 64.0, "64px 64px", "0% 0%", 200.0, 630.0)
                .unwrap_err();
        assert!(sample_ends_walk(&outside));
        assert_eq!(outside["reason"], "point outside background image");

        // What the capture cannot place is read where the image reaches: no
        // shorthand recorded, or a `contain` size with no intrinsic size
        // loaded.
        let bare = d.add(Some(body), "span");
        d.set_rect(bare, 200.0, 100.0, 32.0, 32.0);
        let unplaced = css_url_source_point(&d, bare, count, 30.0, 22.0, "22px 16px", "50% 50%", 216.0, 114.0);
        assert!(unplaced.is_ok());
        d.set_style(bare, "background", "rgba(0, 0, 0, 0) url(\"x.svg\") no-repeat scroll 50% 50% / contain padding-box border-box");
        let no_size = css_url_source_point(&d, bare, count, 0.0, 0.0, "contain", "50% 50%", 216.0, 114.0);
        assert!(no_size.map_or_else(|s| !sample_ends_walk(&s), |_| true));
    }

    /// observations-42 row 12, telekom.de: the teaser's photo is an `<img>`
    /// in an inline `<picture>` whose own rect is the 21px line at the foot
    /// of the card. The climb looks inside it and finds the photo under the
    /// overline, where it used to pass it by and reach the white page.
    #[test]
    fn the_climb_looks_inside_an_inline_picture() {
        let build = |picture_display: &str| {
            let mut d = FakeDom::new();
            let (_h, body) = d.with_page();
            d.set_style(body, "backgroundColor", "rgb(255, 255, 255)");
            let frame = d.add(Some(body), "div");
            d.set_styles(frame, &[("position", "relative"), ("display", "flex")]);
            d.set_rect(frame, 2.0, 100.0, 386.0, 500.0);
            let layer = d.add(Some(frame), "div");
            d.set_styles(layer, &[("position", "absolute"), ("display", "block")]);
            d.set_rect(layer, 12.0, 110.0, 366.0, 480.0);
            let picture = d.add(Some(layer), "picture");
            d.set_style(picture, "display", picture_display);
            d.set_rect(picture, 12.0, 574.0, 366.0, 21.0);
            let img = d.add(Some(picture), "img");
            d.set_styles(img, &[("display", "inline"), ("objectFit", "cover")]);
            d.set_rect(img, 12.0, 110.0, 366.0, 480.0);
            let content = d.add(Some(frame), "div");
            d.set_styles(content, &[("position", "relative"), ("display", "flex")]);
            d.set_rect(content, 12.0, 100.0, 366.0, 500.0);
            let overline = d.add(Some(content), "span");
            d.add_text(overline, "Young Unlimited");
            d.set_styles(overline, &[("display", "block"), ("color", "rgb(132, 245, 128)"), ("fontSize", "16px")]);
            d.set_rect(overline, 71.0, 380.0, 200.0, 20.0);
            d.set_text_rect(overline, 71.0, 380.0, 120.0, 20.0);
            (d, overline, img)
        };
        let (d, overline, img) = build("inline");
        assert_eq!(layer_under_text_found(&d, overline), (LayerUnder::Picture, Some(img)));
        // A block wrapper whose box misses the text is still passed by: the
        // climb reaches the page, and only the hit test is left to answer.
        let (d, overline, img) = build("block");
        assert_ne!(layer_under_text_found(&d, overline).1, Some(img));
    }

    /// observations-42 row 12, telekom.de: a consent notice scrolls its list
    /// inside a box, and the text below the box's edge is not on screen. The
    /// hit test there answers with the page's backdrop, which is not what
    /// the text sits on.
    #[test]
    fn text_clipped_away_at_a_point_is_unresolved_there() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let scroller = d.add(Some(body), "div");
        d.set_styles(scroller, &[("overflow", "hidden auto"), ("display", "block")]);
        d.set_rect(scroller, 250.0, 160.0, 780.0, 414.0);
        let item = d.add(Some(scroller), "strong");
        d.add_text(item, "broadband connection");
        d.set_rect(item, 312.0, 788.0, 167.0, 21.0);
        let backdrop = d.add(Some(body), "div");
        d.set_styles(backdrop, &[("position", "fixed"), ("backgroundColor", "rgba(0, 0, 0, 0.5)")]);
        d.set_rect(backdrop, 0.0, 0.0, 1280.0, 800.0);
        d.set_point(395.0, 798.0, vec![backdrop, body]);
        let err = stack_nodes(&d, item, 395.0, 798.0, 0.0).unwrap_err();
        assert_eq!(err["reason"], "text clipped at point");
        // Text that ignores pointer events is never in the stack and keeps
        // the walk from the element down, as does text no box clips there.
        d.set_style(item, "pointerEvents", "none");
        assert_eq!(stack_nodes(&d, item, 395.0, 798.0, 0.0).unwrap()[0].el, item);
        d.set_style(item, "pointerEvents", "auto");
        d.set_style(scroller, "overflow", "visible");
        assert_eq!(stack_nodes(&d, item, 395.0, 798.0, 0.0).unwrap()[0].el, item);
    }

    #[test]
    fn repeat_and_size_are_read_where_the_capture_states_them() {
        assert_eq!(
            background_repeat_axes("rgba(0, 0, 0, 0.6) url(\"a,no-repeat.svg\") no-repeat scroll 50% 50% / 22px 16px padding-box border-box"),
            Some((false, false))
        );
        assert_eq!(
            background_repeat_axes("url(\"a.png\") repeat-x scroll 0% 0% / auto padding-box border-box, rgb(255, 255, 255) url(\"b.png\") no-repeat scroll 0% 0% / auto padding-box border-box"),
            Some((true, false))
        );
        assert_eq!(
            background_repeat_axes("rgb(255, 255, 255) none repeat scroll 0% 0% / auto padding-box border-box"),
            Some((true, true))
        );
        assert_eq!(background_repeat_axes("url(x.png) space no-repeat"), Some((true, false)));
        assert_eq!(background_repeat_axes(""), None);
        assert!(placed_size_is_known("22px 16px", 0.0, 0.0));
        assert!(placed_size_is_known("cover", 0.0, 0.0));
        assert!(!placed_size_is_known("contain", 0.0, 0.0));
        assert!(placed_size_is_known("contain", 300.0, 200.0));
        assert!(!placed_size_is_known("auto 16px", 0.0, 0.0));
        assert!(!placed_size_is_known("calc(50% + 10px) auto", 300.0, 200.0));
        assert!(!placed_size_is_known("10em 2em", 300.0, 200.0));
    }

    /// Text a fixed layer covers at capture is no candidate: the element pass
    /// stands down on it, and a sampled or pixel verdict would score it anyway.
    #[test]
    fn covered_text_is_no_candidate() {
        let build = |banner_opacity: &str| {
            let mut d = FakeDom::new();
            let (_h, body) = d.with_page();
            let sec = d.add(Some(body), "section");
            d.set_styles(sec, &[("backgroundImage", "linear-gradient(red, blue)"), ("backgroundColor", "rgba(0, 0, 0, 0)"), ("opacity", "1")]);
            d.set_rect(sec, 0.0, 600.0, 1280.0, 200.0);
            let p = d.add(Some(sec), "p");
            d.add_text(p, "Team size");
            d.set_styles(p, &[("color", "rgb(250, 240, 250)"), ("fontSize", "14px"), ("fontWeight", "400"), ("backgroundColor", "rgba(0, 0, 0, 0)"), ("backgroundImage", "none"), ("opacity", "1")]);
            d.set_rect(p, 16.0, 735.0, 184.0, 20.0);
            let banner = d.add(Some(body), "div");
            d.set_styles(banner, &[("position", "fixed"), ("backgroundColor", "rgba(255, 255, 255, 0.95)"), ("backgroundImage", "none"), ("opacity", banner_opacity)]);
            d.set_rect(banner, 0.0, 645.0, 1280.0, 155.0);
            collect_visual_contrast_candidates(&d, &json!({}))
        };
        assert!(build("1").is_empty(), "{:?}", build("1"));
        assert_eq!(build("0.5").len(), 1, "a translucent banner shows the text");
    }
}
