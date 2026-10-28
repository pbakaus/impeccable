//! What the hit-test stack says about the layers at a run of text.
//!
//! The contrast walk reads the element's ancestors and answers with the
//! first surface on that chain. Two kinds of layer never appear there, and
//! both make its verdict about something a reader does not see:
//!
//! - a layer **above** the text that hides it: a fixed cookie banner over the
//!   hero stats, a photo avatar laid over an SVG initial. The text is covered
//!   at capture and there is nothing to score.
//! - paint **under** the text that is nobody's ancestor fill: a sibling photo
//!   under a hero subline, a slideshow image under a title, an SVG circle under
//!   an initial, a dark positioned panel under a tab strip. The walk passes
//!   under it and lands on the page ground or on a card further out.
//!
//! Not every layer under the text is a surface. A dot grid, hairline grid
//! lines, a grain tile, a masked or faint decoration laid over a section
//! leaves the surface the walk named where it was, and the verdict stands.
//! Paint under the text sets the verdict aside only where it could really
//! change what the text sits on: a picture, or a gradient or fill whose
//! colours differ from the named surface, or paint whose colours cannot be
//! read where the walk only reached the page ground. A layer this cannot place
//! either way keeps the verdict.
//!
//! [`layers_at_text`] asks `elementsFromPoint` at the points the occlusion
//! grid already asks for the same box ([`occlusion_probe_points`]), so a live
//! scan answers them in the same round and a recording made for that check
//! answers them on replay. The layers are not modelled: this says only whether
//! the walk's verdict is about the text a reader meets, and leaves the verdict
//! alone wherever it cannot tell.

use super::dom::{flat_contains, tag_lower, Dom, ElId};
use super::element_checks::{blur_radius_px, effective_opacity_dom, parse_rgb_or_any};
use super::page_checks::{
    occlusion_grid_size, occlusion_probe_points, occlusion_probe_rect, occlusion_viewport,
    rect_holds_point,
};
use crate::color::{composite_color_over, parse_gradient_colors, split_top_level_commas, Rgba};
use crate::js;
use impeccable_foundation::browser::snapshot::NS_SVG;
use impeccable_foundation::css::measures::{data_svg_intrinsic_size, parse_gradient_layer_stops};

/// What the stacks at a run of text say about the surface the walk resolved.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextLayers {
    /// Every decided point has an opaque layer above the text.
    Covered,
    /// Every decided point has paint under the text, above the walk's
    /// surface, that the walk never read, or a layer above it.
    UnreadSurface,
    /// The stacks agree with the walk, or part of the run is visible over the
    /// surface it named.
    Consistent,
    /// Nothing can be said: a point is not answered (a recording that never
    /// asked it), less than half of the run's grid lies inside the viewport
    /// (below the fold), or too few points find the text at all.
    Undecided,
}

impl TextLayers {
    /// Whether a contrast verdict against the walk's surface stands.
    pub fn verdict_stands(self) -> bool {
        matches!(self, TextLayers::Consistent | TextLayers::Undecided)
    }
}

/// One point's answer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AtPoint {
    Covered,
    Unread,
    Consistent,
    /// The text is not in the stack there (an inline box's gap between
    /// lines, `pointer-events: none`). The point says nothing.
    Silent,
    /// No answer: the point was never asked, or nothing is there.
    Unanswered,
}

/// The effective opacity a layer needs to hide what is under it.
const COVER_MIN_OPACITY: f64 = 0.95;

/// The alpha a fill needs to hide what is under it, as the contrast walk
/// reads an opaque fill elsewhere.
const COVER_MIN_ALPHA: f64 = 0.95;

/// Paint fainter than this (a fill's alpha times its opacity, or the opacity
/// of an image, gradient or shape) is a wash over the surface, not a surface.
const FAINT_PAINT: f64 = 0.1;

/// A picture, gradient or shape at this effective opacity or below is
/// decoration over the surface (a grain layer at 0.2, a photo ghosted at
/// 0.3), and the walk's surface stands. A fill is composited instead, since
/// its colour says exactly how far it moves the surface.
const TEXTURE_MAX_OPACITY: f64 = 0.3;

/// A gradient drawn in cells at most this large on both axes is a pattern (a
/// dot grid, grid lines, a checker), not a surface.
const TEXTURE_MAX_CELL_PX: f64 = 64.0;

/// A gradient with a transparent stop and a stop position at most this far
/// in draws hairlines or dots, `radial-gradient(#334155 1px, transparent 1px)`.
const HAIRLINE_MAX_PX: f64 = 3.0;

/// An image repeated at a drawn size at most this large on both axes is a
/// texture tile (grain, noise, a dot or grid tile), as the visual pass reads
/// one.
const TEXTURE_MAX_TILE_PX: f64 = 256.0;

/// How far apart, summed over the channels, an unread fill and the resolved
/// surface may be and still be one surface, the tolerance the link path uses.
const SAME_SURFACE_DISTANCE: f64 = 24.0;

/// Replaced elements that paint a picture.
const MEDIA_TAGS: &[&str] = &["img", "video", "canvas"];

/// SVG elements that paint where they are hit.
const SVG_SHAPES: &[&str] = &[
    "path", "rect", "circle", "ellipse", "polygon", "polyline", "line", "image", "use",
];

fn is_document_surface(dom: &dyn Dom, node: ElId) -> bool {
    matches!(tag_lower(dom, node).as_str(), "body" | "html")
}

fn distance(a: &Rgba, b: &Rgba) -> f64 {
    (a.r - b.r).abs() + (a.g - b.g).abs() + (a.b - b.b).abs()
}

/// The fill alpha, times the layer's effective opacity, at which a layer
/// that also blurs what is under it hides the text: frosted glass leaves it
/// a smear. shinebythara.lovable.app's fixed nav, `bg-background/80
/// backdrop-blur-md` (0.8 and 12px), over its 14px promo row
/// (observations-1006 row 8). A translucent layer with no blur is not
/// taken: blueeyes.com.tw's cookie bar at `rgba(0, 0, 0, 0.8)` dims the
/// buttons under it, and the judges read them (row 6).
const SCRIM_BLURRED_MIN_ALPHA: f64 = 0.75;

/// The least backdrop blur that counts as glass, whatever the text.
const SCRIM_MIN_BLUR_PX: f64 = 8.0;

/// How much of the text's font size the backdrop blur has to reach: a blur
/// smears glyphs about its own size and leaves larger ones readable (a 40px
/// heading under a 4px frosted header reads clearly).
const SCRIM_BLUR_PER_FONT_PX: f64 = 1.0 / 3.0;

/// Whether a layer above the text hides it at `(x, y)`: an image, a video, a
/// canvas, or an opaque fill, at full opacity, or frosted glass
/// ([`SCRIM_BLURRED_MIN_ALPHA`]) whose blur reaches [`SCRIM_MIN_BLUR_PX`] and
/// a third of `font_px`, the text's font size (glass is not taken when the
/// size is unknown), where the capture put it. Raster backgrounds are not
/// counted, because a transparent texture drawn over a hero is one too.
fn covers(dom: &dyn Dom, node: ElId, x: f64, y: f64, font_px: f64) -> bool {
    if is_document_surface(dom, node) || !rect_holds_point(&dom.rect(node), x, y) {
        return false;
    }
    if js::trim(&dom.style(node, "visibility")) == "hidden" {
        return false;
    }
    let opacity = effective_opacity_dom(dom, node);
    let fill = parse_rgb_or_any(&dom.style(node, "backgroundColor"));
    if opacity >= COVER_MIN_OPACITY
        && (MEDIA_TAGS.contains(&tag_lower(dom, node).as_str())
            || fill.is_some_and(|c| c.alpha_or_one() >= COVER_MIN_ALPHA))
    {
        return true;
    }
    if !(font_px.is_finite() && font_px > 0.0) {
        return false;
    }
    let blur = blur_radius_px(&dom.style(node, "backdropFilter"));
    fill.is_some_and(|c| c.alpha_or_one() * opacity >= SCRIM_BLURRED_MIN_ALPHA)
        && blur >= SCRIM_MIN_BLUR_PX
        && blur >= font_px * SCRIM_BLUR_PER_FONT_PX
}

/// What a box that is nobody's ancestor paints under the text.
#[derive(Debug, Clone, PartialEq)]
enum Paint {
    /// Decoration over whatever the walk named: a dot grid, hairline lines, a
    /// grain tile, a masked or faint layer. Read past.
    Texture,
    /// An image, a video, a canvas, a photographic background: opaque paint
    /// that no named flat colour describes.
    Picture,
    /// A gradient or an SVG shape. `stops` are the colours it paints, at the
    /// box's opacity, and empty where the style does not say (an SVG shape's
    /// fill is not captured).
    Unmodelled(Vec<Rgba>),
    /// A fill, its alpha already multiplied by the box's opacity.
    Fill(Rgba),
    /// Could be a texture or a picture: a remote image tiled at its own size,
    /// which the computed style does not give.
    Undecided,
}

/// What one box's background images add up to.
enum Images {
    Texture,
    Picture,
    Gradient(Vec<Rgba>),
    Undecided,
}

/// Whether a background image is only gradients whose strongest stop, at the
/// box's opacity, is a wash: a tint laid over a hero at 5% changes no
/// verdict. A `url()` is a picture, and gradients whose stops cannot be read
/// are not known to be faint.
fn faint_gradient_wash(image: &str, opacity: f64) -> bool {
    if js::to_lower_case(image).contains("url(") {
        return false;
    }
    let stops = parse_gradient_colors(Some(image));
    !stops.is_empty()
        && stops.iter().map(|c| c.alpha_or_one()).fold(0.0, f64::max) * opacity <= FAINT_PAINT
}

fn masked(dom: &dyn Dom, node: ElId) -> bool {
    ["maskImage", "webkitMaskImage"].iter().any(|prop| {
        let value = dom.style(node, prop);
        let value = js::trim(&value);
        !value.is_empty() && value != "none"
    })
}

/// Whether a mask or a `clip-path` on `node` can leave part of its box
/// unpainted, so its box covering something is no proof its paint does (a
/// photo faded out by a `mask-image` gradient).
pub(crate) fn masked_or_clipped(dom: &dyn Dom, node: ElId) -> bool {
    masked(dom, node)
        || ["clipPath", "webkitClipPath"].iter().any(|prop| {
            let value = dom.style(node, prop);
            let value = js::trim(&value);
            !value.is_empty() && value != "none"
        })
}

fn px(token: &str) -> Option<f64> {
    token
        .strip_suffix("px")
        .map(js::parse_float)
        .filter(|v| v.is_finite() && *v >= 0.0)
}

/// A `background-size` layer given in pixels on both axes.
fn explicit_cell(size: &str) -> Option<(f64, f64)> {
    match size.split_ascii_whitespace().collect::<Vec<_>>().as_slice() {
        [w, h] => Some((px(w)?, px(h)?)),
        _ => None,
    }
}

/// The size an image layer is drawn at, where the computed style says it:
/// pixels on both axes, or the intrinsic size of an inline SVG drawn at
/// `auto`.
fn drawn_tile(layer: &str, size: &str) -> Option<(f64, f64)> {
    match size.split_ascii_whitespace().collect::<Vec<_>>().as_slice() {
        [] | ["auto"] | ["auto", "auto"] => data_svg_intrinsic_size(layer),
        [w, h] => Some((px(w)?, px(h)?)),
        _ => None,
    }
}

/// Whether a gradient draws hairlines or dots rather than a surface: most of
/// its stops are transparent, or it has a transparent stop and a stop placed
/// within [`HAIRLINE_MAX_PX`].
fn gradient_is_decoration(layer: &str) -> bool {
    let Some(stops) = parse_gradient_layer_stops(layer) else {
        return false;
    };
    let clear = stops.iter().filter(|s| s.transparent).count();
    if clear * 2 > stops.len() {
        return true;
    }
    clear > 0
        && layer
            .split(|c: char| c.is_ascii_whitespace() || c == ',' || c == '(' || c == ')')
            .filter_map(px)
            .any(|v| v > 0.0 && v <= HAIRLINE_MAX_PX)
}

/// Whether every background layer of a box is a sparse dot pattern: a
/// `radial-gradient` that paints a dot ([`radial_dot`]: coloured stops
/// first, then transparent to the end), repeated in cells at most
/// [`TEXTURE_MAX_CELL_PX`] on both axes, whose ink (the dot's area over the
/// cell's, times its strongest stop's alpha) is at most
/// [`DOT_TEXTURE_MAX_INK`]. spacesheep.dev's body draws a 1px dot every
/// 24px over its fill; the reader sees the fill, not the dot
/// (observations-1010 row 8). A mesh of pinholes (clear centre, opaque
/// outside), a dense halftone, an opaque checker and grid lines are not
/// sparse dots and are read as before (juskoe.vercel.app's `bg-grid` lines
/// are what several of its failing words were reported on, judged harmful
/// there). A layer whose cell the style does not state is not one either.
pub(crate) fn gradient_layers_are_dot_texture(dom: &dyn Dom, node: ElId, image: &str) -> bool {
    let sizes = split_top_level_commas(&js::to_lower_case(&dom.style(node, "backgroundSize")));
    let shorthand = split_top_level_commas(&js::to_lower_case(&dom.style(node, "background")));
    let layers = split_top_level_commas(image);
    if layers.is_empty() || sizes.is_empty() {
        return false;
    }
    // The ink of every layer together: several sparse layers offset across
    // one cell can make a dense pattern (#1201 review).
    let mut ink = 0.0;
    for (i, layer) in layers.iter().enumerate() {
        let lower = js::to_lower_case(layer);
        let repeats = !shorthand.get(i).map_or(false, |s| s.contains("no-repeat"));
        let Some((w, h)) = explicit_cell(sizes[i % sizes.len()].as_str()) else {
            return false;
        };
        let Some((radius, alpha)) = radial_dot(js::trim(&lower)) else {
            return false;
        };
        // The default shape is an ellipse in the cell's own proportions:
        // a circle only in a square cell.
        let circular = lower.contains("circle") || (w - h).abs() < 0.5;
        if !(repeats
            && circular
            && w > 0.0
            && h > 0.0
            && w <= TEXTURE_MAX_CELL_PX
            && h <= TEXTURE_MAX_CELL_PX
            && gradient_is_decoration(&lower))
        {
            return false;
        }
        ink += std::f64::consts::PI * radius * radius / (w * h) * alpha;
    }
    ink <= DOT_TEXTURE_MAX_INK
}

/// The most ink a dot pattern may lay over its cell, as a share of the
/// cell's area times the dot's alpha, summed over its layers, and still be
/// texture over the fill.
const DOT_TEXTURE_MAX_INK: f64 = 0.15;

/// A gradient argument split into its leading colour (a token, or a whole
/// function call such as `rgba(26, 26, 31, 0.13)`) and the rest.
fn leading_colour(arg: &str) -> Option<(&str, &str)> {
    match arg.find('(') {
        Some(open) if !arg[..open].contains(char::is_whitespace) => {
            let close = arg.rfind(')')?;
            Some((&arg[..=close], &arg[close + 1..]))
        }
        _ => Some(match arg.split_once(char::is_whitespace) {
            Some((c, r)) => (c, r),
            None => (arg, ""),
        }),
    }
}

/// A `radial-gradient` layer that paints a dot: its colour stops are opaque
/// enough to see first (alpha over 0.05), then transparent to the end, with
/// every position in pixels. The dot's radius (the first transparent stop's
/// position, or the last coloured one's where that is larger) and its
/// strongest alpha. `None` for any other shape: a ring, a hole, a stop
/// placed in percent or not at all, and an ellipse written as one (the
/// default shape is one too, which the caller allows only in a square
/// cell).
fn radial_dot(layer: &str) -> Option<(f64, f64)> {
    let inner = layer.strip_prefix("radial-gradient(")?.strip_suffix(')')?;
    // Only a circle: an ellipse's area is not the circle its stops give
    // (`ellipse 4px 32px` paints far more of a tall cell).
    let shape = split_top_level_commas(inner).into_iter().next().unwrap_or_default();
    let shape = js::trim(&shape).to_string();
    let starts_with_colour = leading_colour(&shape).is_some_and(|(c, _)| crate::color::parse_any_color(Some(c)).is_some());
    if !starts_with_colour && !shape.starts_with("circle") {
        return None;
    }
    let mut coloured: Vec<(f64, Option<f64>)> = Vec::new();
    let mut clear: Vec<Option<f64>> = Vec::new();
    for arg in split_top_level_commas(inner) {
        let arg = js::trim(&arg).to_string();
        let (colour, rest) = leading_colour(&arg)?;
        let Some(c) = crate::color::parse_any_color(Some(colour)) else {
            // The shape and position argument, allowed only first.
            if coloured.is_empty() && clear.is_empty() {
                continue;
            }
            return None;
        };
        let mut position = None;
        for t in rest.split_ascii_whitespace() {
            position = Some(px(t)?);
        }
        if c.alpha_or_one() > 0.05 {
            if !clear.is_empty() {
                return None;
            }
            coloured.push((c.alpha_or_one(), position));
        } else {
            clear.push(position);
        }
    }
    let first_clear = (*clear.first()?)?;
    // A stop placed before an earlier one is drawn at the earlier one's
    // position, so the dot reaches the furthest coloured stop.
    let last_coloured = coloured.iter().map(|(_, p)| *p).collect::<Option<Vec<f64>>>()?.into_iter().fold(0.0, f64::max);
    let alpha = coloured.iter().map(|(a, _)| *a).fold(0.0, f64::max);
    Some((first_clear.max(last_coloured), alpha))
}

/// What a box's background images paint. Every layer has to be texture for
/// the box to be; one picture makes it a picture, and one layer this cannot
/// place (a remote tile at its own size, an `image-set`) leaves it undecided.
fn background_images(dom: &dyn Dom, node: ElId, image: &str) -> Images {
    let sizes = split_top_level_commas(&js::to_lower_case(&dom.style(node, "backgroundSize")));
    let shorthand = split_top_level_commas(&js::to_lower_case(&dom.style(node, "background")));
    let (mut picture, mut undecided) = (false, false);
    let mut gradient: Option<Vec<Rgba>> = None;
    for (i, layer) in split_top_level_commas(image).iter().enumerate() {
        let lower = js::to_lower_case(layer);
        let size = if sizes.is_empty() {
            ""
        } else {
            sizes[i % sizes.len()].as_str()
        };
        let repeats = !shorthand.get(i).map_or(false, |s| s.contains("no-repeat"));
        if lower.contains("url(") {
            match drawn_tile(layer, size) {
                Some((w, h)) if repeats && w <= TEXTURE_MAX_TILE_PX && h <= TEXTURE_MAX_TILE_PX => {}
                Some(_) => picture = true,
                None if !repeats
                    || size.contains("cover")
                    || size.contains("contain")
                    || size.contains('%') =>
                {
                    picture = true
                }
                None => undecided = true,
            }
        } else if lower.contains("gradient(") {
            let small_cell = repeats
                && explicit_cell(size)
                    .map_or(false, |(w, h)| w <= TEXTURE_MAX_CELL_PX && h <= TEXTURE_MAX_CELL_PX);
            if js::trim(&lower).starts_with("repeating-") || small_cell || gradient_is_decoration(&lower) {
                continue;
            }
            gradient
                .get_or_insert_with(Vec::new)
                .extend(parse_gradient_colors(Some(layer)));
        } else {
            undecided = true;
        }
    }
    if picture {
        Images::Picture
    } else if undecided {
        Images::Undecided
    } else if let Some(stops) = gradient {
        Images::Gradient(stops)
    } else {
        Images::Texture
    }
}

/// The colours a box's gradient background paints as a surface, at
/// `opacity`, for the structural layer climb (`visual::layer_under_text`),
/// read the way the stacks read a gradient under the text. `None` where the
/// box paints no gradient, or only decoration: a dot grid, hairlines, a small
/// repeating cell, a masked layer, a wash at most [`FAINT_PAINT`] strong, or a
/// box at [`TEXTURE_MAX_OPACITY`] or below. A `url()` layer is a picture, and
/// the climb reads it before this.
pub(crate) fn gradient_surface_stops(dom: &dyn Dom, node: ElId, opacity: f64) -> Option<Vec<Rgba>> {
    let image = dom.style(node, "backgroundImage");
    let image = js::trim(&image);
    if image.is_empty() || image == "none" || !js::to_lower_case(image).contains("gradient(") {
        return None;
    }
    if opacity <= TEXTURE_MAX_OPACITY || masked(dom, node) || faint_gradient_wash(image, opacity) {
        return None;
    }
    match background_images(dom, node, image) {
        Images::Gradient(stops) if !stops.is_empty() => Some(
            stops
                .into_iter()
                .map(|c| Rgba {
                    a: Some(c.alpha_or_one() * opacity),
                    ..c
                })
                .collect(),
        ),
        _ => None,
    }
}

fn detached_paint(dom: &dyn Dom, node: ElId) -> Option<Paint> {
    if js::trim(&dom.style(node, "visibility")) == "hidden" {
        return None;
    }
    let opacity = effective_opacity_dom(dom, node);
    if opacity <= FAINT_PAINT {
        return None;
    }
    // Where a mask shows the layer cannot be read from its style: a masked
    // grid fading out under a hero is decoration.
    if masked(dom, node) {
        return Some(Paint::Texture);
    }
    let faint = opacity <= TEXTURE_MAX_OPACITY;
    let tag = tag_lower(dom, node);
    let svg = dom.namespace_uri(node) == NS_SVG;
    if MEDIA_TAGS.contains(&tag.as_str()) || (svg && tag == "image") {
        return Some(if faint { Paint::Texture } else { Paint::Picture });
    }
    if svg && SVG_SHAPES.contains(&tag.as_str()) {
        return Some(if faint {
            Paint::Texture
        } else {
            Paint::Unmodelled(Vec::new())
        });
    }
    let image = dom.style(node, "backgroundImage");
    let image = js::trim(&image);
    if !faint && !image.is_empty() && image != "none" && !faint_gradient_wash(image, opacity) {
        match background_images(dom, node, image) {
            Images::Texture => {}
            Images::Picture => return Some(Paint::Picture),
            Images::Undecided => return Some(Paint::Undecided),
            Images::Gradient(stops) => {
                return Some(Paint::Unmodelled(
                    stops
                        .into_iter()
                        .map(|c| Rgba {
                            a: Some(c.alpha_or_one() * opacity),
                            ..c
                        })
                        .collect(),
                ))
            }
        }
    }
    let fill = parse_rgb_or_any(&dom.style(node, "backgroundColor"))?;
    let alpha = fill.alpha_or_one() * opacity;
    (alpha > FAINT_PAINT).then(|| Paint::Fill(Rgba { a: Some(alpha), ..fill }))
}

/// Whether paint laid over the named surface moves it by more than one
/// surface's tolerance anywhere. `None` where the walk named no single colour
/// to compare with.
fn moves_surface(paint: &[Rgba], resolved: Option<Rgba>) -> Option<bool> {
    let surface = resolved?;
    Some(
        paint
            .iter()
            .any(|c| distance(&composite_color_over(c, &surface), &surface) > SAME_SURFACE_DISTANCE),
    )
}

/// The first layer in `above` (the stack above the text at `(x, y)`,
/// topmost first) that is not the text's ancestor and [`covers`] it there.
/// With `stays`, only a layer that stays over the text as the page scrolls
/// counts ([`stays_over_the_text`]).
fn cover_above(dom: &dyn Dom, el: ElId, above: &[ElId], x: f64, y: f64, stays: bool) -> Option<ElId> {
    let font_px = js::parse_float(&dom.style(el, "fontSize"));
    above
        .iter()
        .copied()
        .find(|&node| !dom.contains(node, el) && covers(dom, node, x, y, font_px) && (!stays || stays_over_the_text(dom, node, el)))
}

/// Whether a covering layer stays over the text when the visitor scrolls:
/// neither it nor an ancestor is `fixed` or `sticky`, so it moves with the
/// page, or the first such box and the layer itself are pinned to the
/// viewport's top (each box starts within 1px of it) with the page at its
/// top, so scrolling only carries the text further under it (metlife.com's
/// mobile nav over its breadcrumbs). A cookie bar fixed to the bottom of the
/// window lies over whatever text the capture left there, and a scroll
/// brings that text out (ytbulktranscript.app's paragraph, tau.ac.il's 9px
/// price); so does one placed at the bottom of a full-window fixed wrapper,
/// whose own top is 0.
///
/// A cover that scrolls with the page does not stay over text that is itself
/// `fixed` or `sticky`: scrolling carries the cover away and leaves the text
/// in the window.
fn stays_over_the_text(dom: &dyn Dom, node: ElId, text: ElId) -> bool {
    let pinned = |start: ElId| {
        let mut cur = Some(start);
        while let Some(n) = cur {
            if Some(n) == dom.body() || Some(n) == dom.document_element() {
                return false;
            }
            if matches!(dom.style(n, "position").as_str(), "fixed" | "sticky") {
                return true;
            }
            cur = dom.parent(n);
        }
        false
    };
    let at_top = |n: ElId| {
        let r = dom.rect(n);
        r.all_finite() && r.top <= 1.0
    };
    let mut cur = Some(node);
    while let Some(n) = cur {
        if Some(n) == dom.body() || Some(n) == dom.document_element() {
            return !pinned(text);
        }
        if matches!(dom.style(n, "position").as_str(), "fixed" | "sticky") {
            let scroll = dom.scroll_y();
            return at_top(n) && at_top(node) && scroll.is_finite() && scroll <= 1.0;
        }
        cur = dom.parent(n);
    }
    !pinned(text)
}

/// The share of a run's text a single covering layer has to hold for a
/// split grid to count as covered: bordeaux-metropole.fr's consent modal
/// holds 87% of a link whose top grid row lies just above it, and
/// searchvoro.com's card holds all of a paragraph whose box runs past it.
const COVERED_TEXT_MIN_SHARE: f64 = 0.85;

/// Whether one layer that covers the text at a deciding point holds at
/// least [`COVERED_TEXT_MIN_SHARE`] of the run's direct text box. A run with
/// no direct text box (a field's placeholder), or a layer the capture did
/// not measure, holds nothing.
fn covering_layer_holds_text(
    dom: &dyn Dom,
    el: ElId,
    points: &[(f64, f64)],
    answers: &[AtPoint],
    stays: bool,
) -> bool {
    let Some(text) = dom.direct_text_rect(el).filter(|r| r.all_finite() && r.width > 0.0 && r.height > 0.0) else {
        return false;
    };
    let area = text.width * text.height;
    let mut seen: Vec<ElId> = Vec::new();
    for (&(x, y), answer) in points.iter().zip(answers) {
        if *answer != AtPoint::Covered {
            continue;
        }
        let stack = dom.elements_from_point(x, y);
        let Some(first) = stack.iter().position(|&n| dom.contains(el, n)) else {
            continue;
        };
        let Some(layer) = cover_above(dom, el, &stack[..first], x, y, stays) else {
            continue;
        };
        if seen.contains(&layer) {
            continue;
        }
        seen.push(layer);
        // A clipped, masked or rotated layer paints less than its box, so
        // its box says nothing about the share it hides.
        if masked_or_clipped(dom, layer) || !moves_only(&dom.style(layer, "transform")) {
            continue;
        }
        let r = dom.rect(layer);
        if !r.all_finite() {
            continue;
        }
        let w = js::math_min(r.right, text.right) - js::math_max(r.left, text.left);
        let h = js::math_min(r.bottom, text.bottom) - js::math_max(r.top, text.top);
        if w > 0.0 && h > 0.0 && w * h >= COVERED_TEXT_MIN_SHARE * area {
            return true;
        }
    }
    false
}

/// Whether a computed `transform` leaves the box's shape alone: `none`, or
/// a matrix that only translates. Anything else, or an unrecorded value,
/// may not.
fn moves_only(transform: &str) -> bool {
    let t = js::trim(transform);
    if t == "none" {
        return true;
    }
    let Some(inner) = t.strip_prefix("matrix(").and_then(|r| r.strip_suffix(')')) else {
        return false;
    };
    let v: Vec<f64> = inner.split(',').map(|n| js::parse_float(js::trim(n))).collect();
    v.len() == 6 && v[0] == 1.0 && v[1] == 0.0 && v[2] == 0.0 && v[3] == 1.0
}

fn at_point(
    dom: &dyn Dom,
    el: ElId,
    x: f64,
    y: f64,
    host: Option<ElId>,
    resolved: Option<Rgba>,
    stays: bool,
) -> AtPoint {
    let stack = dom.elements_from_point(x, y);
    if stack.is_empty() {
        return AtPoint::Unanswered;
    }
    let in_text = |n: ElId| dom.contains(el, n);
    let Some(first) = stack.iter().position(|&n| in_text(n)) else {
        return AtPoint::Silent;
    };
    if cover_above(dom, el, &stack[..first], x, y, stays).is_some() {
        return AtPoint::Covered;
    }
    // The element paints its own surface: nothing under it is read.
    if host == Some(el) {
        return AtPoint::Consistent;
    }
    // The walk found no surface of its own and fell back to the document, so
    // paint under the text is better evidence than the ground it named.
    let on_ground = host.map_or(true, |h| is_document_surface(dom, h));
    let last = stack.iter().rposition(|&n| in_text(n)).unwrap_or(first);
    for &node in &stack[last + 1..] {
        // The host can sit inside a shadow tree (a component's own fill), and
        // a stack names only the shadow host, so containment is read through
        // the flat tree.
        if host.map_or(false, |h| flat_contains(dom, node, h)) || is_document_surface(dom, node) {
            return AtPoint::Consistent;
        }
        if in_text(node) || dom.contains(node, el) {
            continue;
        }
        if !rect_holds_point(&dom.rect(node), x, y) {
            continue;
        }
        match detached_paint(dom, node) {
            None | Some(Paint::Texture) => {}
            Some(Paint::Undecided) => return AtPoint::Consistent,
            Some(Paint::Picture) => return AtPoint::Unread,
            Some(Paint::Unmodelled(stops)) => {
                let moves = if stops.is_empty() {
                    None
                } else {
                    moves_surface(&stops, resolved)
                };
                return if moves.unwrap_or(on_ground) {
                    AtPoint::Unread
                } else {
                    AtPoint::Consistent
                };
            }
            Some(Paint::Fill(fill)) => {
                let Some(surface) = resolved else {
                    return if on_ground {
                        AtPoint::Unread
                    } else {
                        AtPoint::Consistent
                    };
                };
                if fill.alpha_or_one() >= COVER_MIN_ALPHA {
                    return if distance(&fill, &surface) <= SAME_SURFACE_DISTANCE {
                        AtPoint::Consistent
                    } else {
                        AtPoint::Unread
                    };
                }
                if moves_surface(&[fill], resolved) == Some(true) {
                    return AtPoint::Unread;
                }
            }
        }
    }
    AtPoint::Consistent
}

/// What the hit-test stacks over this element's text say about the surface
/// the contrast walk resolved: `host` is the box that ended the walk (`None`
/// for the canvas, the element itself where it paints its own surface) and
/// `resolved` the colour it named.
///
/// Every point of the occlusion grid over the painted box that lies inside
/// the viewport is asked, so a live scan asks them all in one round. Only
/// there can a point be answered, so at least half of the run's grid has to
/// lie inside the viewport: a title cut by the viewport's edge, or a hero
/// line running past the fold, is answered from what is visible of it, and a
/// run mostly below the fold is not. Every point asked has to be answered.
/// Of those, the points where the stack holds the text decide, and there
/// have to be at least half of them. The run is covered, or reads against a
/// surface the walk never read, only where every deciding point says so; a
/// run half under a banner or half over a photo keeps its verdict.
pub fn layers_at_text(
    dom: &dyn Dom,
    el: ElId,
    host: Option<ElId>,
    resolved: Option<Rgba>,
) -> TextLayers {
    layers(dom, el, host, resolved, false)
}

/// Whether the stacks show `el`'s text covered ([`TextLayers::Covered`] of
/// [`layers_at_text`]) by layers that stay over it when the page scrolls
/// ([`stays_over_the_text`]): the test the size, leading and measure rules
/// read, which a visitor's scroll would otherwise answer. A run below the
/// fold covered by a later card is read as [`layers_at_text`] reads it.
pub fn covered_for_good(dom: &dyn Dom, el: ElId) -> bool {
    layers(dom, el, None, None, true) == TextLayers::Covered
}

fn layers(dom: &dyn Dom, el: ElId, host: Option<ElId>, resolved: Option<Rgba>, stays: bool) -> TextLayers {
    let (vw, vh) = occlusion_viewport(dom);
    let Some(rect) = occlusion_probe_rect(dom, el, &dom.rect(el)) else {
        return TextLayers::Undecided;
    };
    let points = occlusion_probe_points(&rect, vw, vh);
    if points.is_empty() || points.len() * 2 < occlusion_grid_size(&rect) {
        // Below the fold no point is answered, but one layer can be read off
        // the tree: a loaded picture a later sibling lays over the text.
        if rect.top >= vh
            && (covered_by_a_later_picture(dom, el)
                || covered_by_a_later_fill(dom, el)
                || covered_by_a_higher_sibling(dom, el))
        {
            return TextLayers::Covered;
        }
        return TextLayers::Undecided;
    }
    let answers: Vec<AtPoint> = points
        .iter()
        .map(|&(x, y)| at_point(dom, el, x, y, host, resolved, stays))
        .collect();
    if answers.contains(&AtPoint::Unanswered) {
        return TextLayers::Undecided;
    }
    let deciding: Vec<AtPoint> = answers.iter().copied().filter(|a| *a != AtPoint::Silent).collect();
    if deciding.is_empty() || deciding.len() * 2 < points.len() {
        return TextLayers::Undecided;
    }
    // The grid probes the element's box, which can run past its text (a
    // paragraph wider than the card it sits in) or straddle a cover's edge
    // by a row: a layer that covers the text at one deciding point and
    // holds most of the text's own box covers it.
    if deciding.iter().all(|a| *a == AtPoint::Covered)
        || (deciding.contains(&AtPoint::Covered) && covering_layer_holds_text(dom, el, &points, &answers, stays))
    {
        TextLayers::Covered
    } else if deciding.iter().all(|a| matches!(a, AtPoint::Covered | AtPoint::Unread)) {
        TextLayers::UnreadSurface
    } else {
        TextLayers::Consistent
    }
}

/// The opacity a picture and the boxes between it and the sibling that holds
/// it need for the picture to hide what is under it.
const PICTURE_COVER_MIN_OPACITY: f64 = 0.95;

/// Whether a picture URL may carry transparency. The engine cannot see a
/// picture's alpha, so only a format that has none settles it: a JPEG, named
/// by a `data:image/jpeg` URI or by a path (before any query or fragment,
/// in any case) ending in `.jpg`, `.jpeg`, `.jpe`, `.jfif`, `.pjpeg` or
/// `.pjp`. PNG, SVG, WebP, GIF and AVIF can all be transparent, and a URL
/// that names no format (an image CDN's query, an empty source) is unknown,
/// so every one of them may be, and such a picture is not taken to cover
/// what lies beneath it.
pub(crate) fn url_may_be_transparent(url: &str) -> bool {
    let lower = url.trim().to_ascii_lowercase();
    if let Some(data) = lower.strip_prefix("data:") {
        let mime = data.split([';', ',']).next().unwrap_or("");
        return !matches!(mime.trim(), "image/jpeg" | "image/jpg" | "image/pjpeg");
    }
    let path = lower.split(['?', '#']).next().unwrap_or("");
    ![".jpg", ".jpeg", ".jpe", ".jfif", ".pjpeg", ".pjp"].iter().any(|ext| path.ends_with(ext))
}

/// `el`'s box cut to the overflow clip of every box from its parent up to
/// and including `top`, axis by axis (`overflow` `hidden`, `clip`, `auto` or
/// `scroll`, on a box that generates one of its own). Every clip on the way
/// counts, even one an absolutely positioned box escapes: a smaller box
/// covers less, which keeps a finding. A clip box the capture did not
/// measure leaves nothing visible.
pub(crate) fn visible_through_clips(dom: &dyn Dom, el: ElId, top: ElId) -> crate::browser::Rect {
    let mut r = dom.rect(el);
    if el == top {
        return r;
    }
    let mut cur = dom.parent(el);
    while let Some(c) = cur {
        if super::painted::clips_contents(&dom.style(c, "display")) {
            let (ox, oy) = super::painted::overflow_axes(dom, c);
            let (clip_x, clip_y) = (super::painted::clips(&ox), super::painted::clips(&oy));
            if clip_x || clip_y {
                let cr = dom.rect(c);
                if !cr.all_finite() {
                    r.left = f64::NAN;
                    return r;
                }
                if clip_x {
                    r.left = r.left.max(cr.left);
                    r.x = r.left;
                    r.right = r.right.min(cr.right);
                    r.width = (r.right - r.left).max(0.0);
                }
                if clip_y {
                    r.top = r.top.max(cr.top);
                    r.y = r.top;
                    r.bottom = r.bottom.min(cr.bottom);
                    r.height = (r.bottom - r.top).max(0.0);
                }
            }
        }
        if c == top {
            break;
        }
        cur = dom.parent(c);
    }
    r
}

/// The fill alpha, times the opacity of every box from the fill up to the
/// sibling that holds it, a box needs to hide the text under it.
const FILL_COVER_MIN_ALPHA: f64 = 0.95;

/// How many ancestors of the text [`covered_by_a_later_fill`] climbs.
const FILL_COVER_MAX_DEPTH: usize = 16;

/// How many elements [`covered_by_a_later_fill`] reads before it gives up
/// and answers no.
const FILL_COVER_BUDGET: usize = 3000;

/// Whether a later layer lays an opaque fill over all of `el`'s text:
/// kipper.com's demo frame, whose "load the demo" button (`position:
/// absolute; inset: 0`, after the poster that holds a fake chat input) sets
/// an opaque white card over the input's placeholder. Every one of these
/// holds:
///
/// - `el` and each ancestor up to the one whose later sibling holds the
///   fill sets no `z-index` (at most [`FILL_COVER_MAX_DEPTH`] levels);
/// - that sibling paints after it ([`super::painted::later_sibling_paints_after`])
///   and is painted at capture;
/// - the fill box, or a box between it and the sibling, is positioned, and
///   none of them sets a `z-index`, so the fill paints in a positioned layer
///   after the text's (a static block's background paints under the text of
///   earlier blocks);
/// - the fill's `background-color` alpha, times the opacity of every box
///   from the fill up to the sibling, is [`FILL_COVER_MIN_ALPHA`] or more,
///   its background is clipped to the border or padding box, and it is
///   painted at capture;
/// - every box from the fill up to the sibling has no mask or clip-path, no
///   `filter`, and `mix-blend-mode: normal`, and neither the fill nor any
///   ancestor is rotated or skewed;
/// - the fill's box (its padding box when the background is clipped to
///   it), cut to every overflow clip up to the sibling and inset by 0.3 of
///   its largest corner radius, covers the text within a pixel.
///
/// A box the capture did not measure, or a search past
/// [`FILL_COVER_BUDGET`] elements, covers nothing.
fn covered_by_a_later_fill(dom: &dyn Dom, el: ElId) -> bool {
    let text = dom
        .direct_text_rect(el)
        .filter(|r| r.all_finite() && r.width > 0.0 && r.height > 0.0)
        .unwrap_or_else(|| dom.rect(el));
    if !text.all_finite() || text.width <= 0.0 || text.height <= 0.0 {
        return false;
    }
    let z_auto = |e: ElId| matches!(dom.style(e, "zIndex").as_str(), "auto" | "");
    let positioned = |e: ElId| !matches!(dom.style(e, "position").as_str(), "static" | "");
    let opaque = |e: ElId| {
        let o = js::parse_float(&dom.style(e, "opacity"));
        o.is_finite() && o >= FILL_COVER_MIN_ALPHA
    };
    let mut read = 0usize;
    let body = dom.body();
    let mut held = el;
    for _ in 0..FILL_COVER_MAX_DEPTH {
        if !z_auto(held) {
            return false;
        }
        let Some(parent) = dom.parent(held) else { return false };
        if Some(parent) == body || dom.document_element() == Some(parent) {
            return false;
        }
        let siblings = dom.children(parent);
        let Some(at) = siblings.iter().position(|&c| c == held) else { return false };
        for &sib in &siblings[at + 1..] {
            if !z_auto(sib)
                || !super::painted::later_sibling_paints_after(dom, parent, held, sib)
                || !super::painted::painted_at_capture(dom, sib)
            {
                continue;
            }
            let mut boxes = vec![sib];
            boxes.extend(dom.query_all(Some(sib), "*").unwrap_or_default());
            for fill in boxes {
                read += 1;
                if read > FILL_COVER_BUDGET {
                    return false;
                }
                if fill_covers(dom, fill, sib, &text, &z_auto, &positioned, &opaque) {
                    return true;
                }
            }
        }
        held = parent;
    }
    false
}

/// The z-index `e` stacks at among its siblings: a number, on a box where
/// it applies (positioned, or a flex or grid item). `None` otherwise.
fn stack_z(dom: &dyn Dom, e: ElId) -> Option<f64> {
    let z = dom.style(e, "zIndex");
    let z = js::parse_float(&z).is_finite().then(|| js::parse_float(&z))?;
    let positioned = !matches!(dom.style(e, "position").as_str(), "static" | "");
    let item = dom.parent(e).is_some_and(|p| {
        matches!(dom.style(p, "display").as_str(), "flex" | "grid" | "inline-flex" | "inline-grid")
    });
    (positioned || item).then_some(z)
}

/// Whether a sibling ranked above the text's layer lays an opaque fill over
/// all of `el`'s text: apple.com's stacked gallery, five tab panels in one
/// grid cell, the active one at `z-index: 2` with a white fill over panels
/// 2 to 5 at 0; cursor.com's Slack demo window (z 10) under its CLI window
/// (z 15). From the first ancestor-or-self of `el` (within
/// [`FILL_COVER_MAX_DEPTH`]) whose z-index applies ([`stack_z`]), a sibling,
/// earlier or later, at a strictly higher z-index, painted at capture, that
/// holds a box passing [`fill_covers`] (the sibling's own z-index allowed,
/// and the rank standing for the positioned layer) covers it. Equal ranks
/// fall to document order, which [`covered_by_a_later_fill`] reads.
fn covered_by_a_higher_sibling(dom: &dyn Dom, el: ElId) -> bool {
    let text = dom
        .direct_text_rect(el)
        .filter(|r| r.all_finite() && r.width > 0.0 && r.height > 0.0)
        .unwrap_or_else(|| dom.rect(el));
    if !text.all_finite() || text.width <= 0.0 || text.height <= 0.0 {
        return false;
    }
    let body = dom.body();
    let mut held = el;
    let mut ranked = None;
    for _ in 0..FILL_COVER_MAX_DEPTH {
        if Some(held) == body || dom.document_element() == Some(held) {
            return false;
        }
        if let Some(z) = stack_z(dom, held) {
            ranked = Some((held, z));
            break;
        }
        let Some(parent) = dom.parent(held) else { return false };
        held = parent;
    }
    let Some((held, z)) = ranked else { return false };
    let Some(parent) = dom.parent(held) else { return false };
    let z_auto = |e: ElId| matches!(dom.style(e, "zIndex").as_str(), "auto" | "");
    let positioned = |e: ElId| !matches!(dom.style(e, "position").as_str(), "static" | "");
    let opaque = |e: ElId| {
        let o = js::parse_float(&dom.style(e, "opacity"));
        o.is_finite() && o >= FILL_COVER_MIN_ALPHA
    };
    let mut read = 0usize;
    for sib in dom.children(parent) {
        if sib == held || !stack_z(dom, sib).is_some_and(|zs| zs > z) || !super::painted::painted_at_capture(dom, sib) {
            continue;
        }
        let mut boxes = vec![sib];
        boxes.extend(dom.query_all(Some(sib), "*").unwrap_or_default());
        for fill in boxes {
            read += 1;
            if read > FILL_COVER_BUDGET {
                return false;
            }
            if fill_covers_ranked(dom, fill, sib, &text, &z_auto, &positioned, &opaque, true) {
                return true;
            }
        }
    }
    false
}

/// [`covered_by_a_later_fill`]'s test of one box `fill` inside `sib`.
fn fill_covers(
    dom: &dyn Dom,
    fill: ElId,
    sib: ElId,
    text: &crate::browser::Rect,
    z_auto: &dyn Fn(ElId) -> bool,
    positioned: &dyn Fn(ElId) -> bool,
    opaque: &dyn Fn(ElId) -> bool,
) -> bool {
    fill_covers_ranked(dom, fill, sib, text, z_auto, positioned, opaque, false)
}

/// [`fill_covers`], where `ranked` says `sib` stacks above the text by its
/// own z-index ([`covered_by_a_higher_sibling`]): its z-index is allowed,
/// and its rank stands for the positioned layer.
#[allow(clippy::too_many_arguments)]
fn fill_covers_ranked(
    dom: &dyn Dom,
    fill: ElId,
    sib: ElId,
    text: &crate::browser::Rect,
    z_auto: &dyn Fn(ElId) -> bool,
    positioned: &dyn Fn(ElId) -> bool,
    opaque: &dyn Fn(ElId) -> bool,
    ranked: bool,
) -> bool {
    let Some(bg) = parse_rgb_or_any(&dom.style(fill, "backgroundColor")) else {
        return false;
    };
    if bg.alpha_or_one() < FILL_COVER_MIN_ALPHA {
        return false;
    }
    let clip = dom.style(fill, "backgroundClip");
    let webkit_clip = dom.style(fill, "webkitBackgroundClip");
    if !matches!(clip.as_str(), "" | "border-box" | "padding-box")
        || !matches!(webkit_clip.as_str(), "" | "border-box" | "padding-box")
    {
        return false;
    }
    // A rotated or skewed fill paints less than its bounding box: the text
    // can show in the corners the box adds.
    if super::page_checks::drawn_tilted(dom, fill) {
        return false;
    }
    let mut layered = ranked;
    // The fill's alpha times every opacity up to the sibling: ten boxes at
    // 0.96 each let 0.34 of the text through between them.
    let mut alpha = bg.alpha_or_one();
    let mut cur = Some(fill);
    while let Some(c) = cur {
        // A blend mode or a filter changes what the fill leaves of the text
        // under it: a white card at `multiply` leaves it all.
        let blend = dom.style(c, "mixBlendMode");
        let filter = dom.style(c, "filter");
        if !(z_auto(c) || (ranked && c == sib))
            || !opaque(c)
            || masked_or_clipped(dom, c)
            || !matches!(blend.as_str(), "normal" | "")
            || !matches!(filter.as_str(), "none" | "")
        {
            return false;
        }
        alpha *= js::parse_float(&dom.style(c, "opacity"));
        if !(alpha >= FILL_COVER_MIN_ALPHA) {
            return false;
        }
        layered |= positioned(c);
        if c == sib {
            break;
        }
        cur = dom.parent(c);
    }
    if !layered {
        return false;
    }
    let mut r = visible_through_clips(dom, fill, sib);
    // A fill clipped to the padding box leaves the border unpainted, and a
    // transparent border shows the text under it.
    if clip == "padding-box" || webkit_clip == "padding-box" {
        let own = dom.rect(fill);
        let border = |side: &str| js::parse_float(&dom.style(fill, &format!("border{side}Width")));
        let (t, rt, b, l) = (border("Top"), border("Right"), border("Bottom"), border("Left"));
        if ![t, rt, b, l].iter().all(|w| w.is_finite() && *w >= 0.0) {
            return false;
        }
        r.left = r.left.max(own.left + l);
        r.top = r.top.max(own.top + t);
        r.right = r.right.min(own.right - rt);
        r.bottom = r.bottom.min(own.bottom - b);
    }
    if !r.all_finite() {
        return false;
    }
    // A rounded overflow clip between the fill and the sibling cuts the
    // fill's corners as its own radius would: a square fill inside a rounded
    // `overflow: hidden` card leaves the text under the card's corners.
    let Some(mut radius) = largest_corner_radius(&dom.style(fill, "borderRadius")) else {
        return false;
    };
    if fill != sib {
        let mut cur = dom.parent(fill);
        while let Some(c) = cur {
            if super::painted::clips_contents(&dom.style(c, "display")) {
                let (ox, oy) = super::painted::overflow_axes(dom, c);
                if super::painted::clips(&ox) || super::painted::clips(&oy) {
                    let Some(cr) = largest_corner_radius(&dom.style(c, "borderRadius")) else {
                        return false;
                    };
                    radius = radius.max(cr);
                }
            }
            if c == sib {
                break;
            }
            cur = dom.parent(c);
        }
    }
    let inset = 0.3 * radius;
    let covers = r.left + inset <= text.left + 1.0
        && r.top + inset <= text.top + 1.0
        && r.right - inset >= text.right - 1.0
        && r.bottom - inset >= text.bottom - 1.0;
    covers && super::painted::painted_at_capture(dom, fill)
}

/// The largest radius a computed `border-radius` names in pixels: `0px` or
/// an empty value is 0. `None` for a percentage or any other unit, which the
/// box's size would have to resolve.
fn largest_corner_radius(value: &str) -> Option<f64> {
    let mut max = 0.0f64;
    for token in value.split(|c: char| c.is_ascii_whitespace() || c == '/') {
        let token = token.trim();
        if token.is_empty() {
            continue;
        }
        let v = token.strip_suffix("px").map(js::parse_float)?;
        if !v.is_finite() || v < 0.0 {
            return None;
        }
        max = max.max(v);
    }
    Some(max)
}

/// How far the picture's box may sit from the avatar box on each side.
const AVATAR_BOX_SLACK: f64 = 3.0;

/// The largest avatar box, on either axis.
const AVATAR_MAX_SIDE: f64 = 160.0;

/// The most characters initials run to, for a box larger than an avatar.
const AVATAR_MAX_TEXT: usize = 3;

/// Whether a later sibling of `el` lays a loaded picture over all of `el`'s
/// text in the shape of an avatar: thingstohave.app's initials
/// (`Avatar__Fallback`) under the photo the next sibling holds. The engine
/// cannot see an image's alpha, and transparent pictures are common exactly
/// where they lie over text (grain and texture overlays, frames, cut-out
/// product shots), so the test keeps to the shape it was built for:
///
/// - the picture's box matches the box of `el`'s parent within
///   [`AVATAR_BOX_SLACK`] on every side, and that box is no larger than
///   [`AVATAR_MAX_SIDE`] on either axis or `el`'s text is at most
///   [`AVATAR_MAX_TEXT`] characters (initials);
/// - the picture is an `<img>` the capture saw complete with a size of its
///   own, whose source is a JPEG ([`url_may_be_transparent`]), sized to
///   cover (`object-fit` `fill` or `cover`), whose box, cut to every
///   overflow clip between it and the sibling ([`visible_through_clips`]),
///   covers the text within a pixel, and
///   which neither it nor any box up to the sibling fades below
///   [`PICTURE_COVER_MIN_OPACITY`];
/// - the sibling is drawn over `el` (neither sets a `z-index`, the sibling
///   is positioned or `el` is not, and in a flex or grid container CSS
///   `order` does not put it first) and is painted.
///
/// An image whose load state was not recorded covers nothing.
fn covered_by_a_later_picture(dom: &dyn Dom, el: ElId) -> bool {
    let Some(parent) = dom.parent(el) else { return false };
    let text = dom
        .direct_text_rect(el)
        .filter(|r| r.all_finite() && r.width > 0.0 && r.height > 0.0)
        .unwrap_or_else(|| dom.rect(el));
    if !text.all_finite() || text.width <= 0.0 || text.height <= 0.0 {
        return false;
    }
    let host = dom.rect(parent);
    if !host.all_finite() {
        return false;
    }
    let small = host.width <= AVATAR_MAX_SIDE && host.height <= AVATAR_MAX_SIDE;
    if !small && js::trim(&dom.text_content(el)).chars().count() > AVATAR_MAX_TEXT {
        return false;
    }
    let positioned = |e: ElId| !matches!(dom.style(e, "position").as_str(), "static" | "");
    let z_auto = |e: ElId| matches!(dom.style(e, "zIndex").as_str(), "auto" | "");
    if !z_auto(el) {
        return false;
    }
    let opaque = |e: ElId| {
        let o = js::parse_float(&dom.style(e, "opacity"));
        o.is_finite() && o >= PICTURE_COVER_MIN_OPACITY
    };
    let siblings = dom.children(parent);
    let Some(at) = siblings.iter().position(|&c| c == el) else { return false };
    siblings[at + 1..].iter().any(|&sib| {
        if !z_auto(sib)
            || !(positioned(sib) || !positioned(el))
            || !super::painted::later_sibling_paints_after(dom, parent, el, sib)
        {
            return false;
        }
        if !super::painted::painted_at_capture(dom, sib) {
            return false;
        }
        let pictures = if tag_lower(dom, sib) == "img" {
            vec![sib]
        } else {
            dom.query_all(Some(sib), "img").unwrap_or_default()
        };
        pictures.into_iter().any(|img| {
            let loaded = dom.image_complete(img) == Some(true)
                && dom.image_natural_size(img).is_some_and(|(w, h)| w > 0.0 && h > 0.0);
            if !loaded || !matches!(dom.style(img, "objectFit").as_str(), "fill" | "cover" | "") {
                return false;
            }
            let src = dom.image_current_src(img).or_else(|| dom.attr(img, "src")).unwrap_or_default();
            if url_may_be_transparent(&src) {
                return false;
            }
            let r = dom.rect(img);
            let matches_host = r.all_finite()
                && (r.left - host.left).abs() <= AVATAR_BOX_SLACK
                && (r.top - host.top).abs() <= AVATAR_BOX_SLACK
                && (r.right - host.right).abs() <= AVATAR_BOX_SLACK
                && (r.bottom - host.bottom).abs() <= AVATAR_BOX_SLACK;
            if !matches_host {
                return false;
            }
            // A wrapper with `overflow: hidden` narrower than the photo
            // shows only part of it.
            let r = visible_through_clips(dom, img, sib);
            let covers = r.all_finite()
                && r.left <= text.left + 1.0
                && r.top <= text.top + 1.0
                && r.right >= text.right - 1.0
                && r.bottom >= text.bottom - 1.0;
            if !covers || !super::painted::painted_at_capture(dom, img) {
                return false;
            }
            // A `z-index` on the picture or a box under the sibling can put
            // it behind the initials, and a mask or clip-path on the way can
            // leave them showing.
            let mut cur = Some(img);
            while let Some(c) = cur {
                if !opaque(c) || !z_auto(c) || masked_or_clipped(dom, c) {
                    return false;
                }
                if c == sib {
                    break;
                }
                cur = dom.parent(c);
            }
            true
        })
    })
}
