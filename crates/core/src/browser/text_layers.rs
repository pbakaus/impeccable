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
use super::element_checks::{effective_opacity_dom, parse_rgb_or_any};
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

/// Whether a layer above the text hides it at `(x, y)`: an image, a video, a
/// canvas, or an opaque fill, at full opacity, where the capture put it.
/// Raster backgrounds are not counted, because a transparent texture drawn
/// over a hero is one too.
fn covers(dom: &dyn Dom, node: ElId, x: f64, y: f64) -> bool {
    if is_document_surface(dom, node) || !rect_holds_point(&dom.rect(node), x, y) {
        return false;
    }
    if js::trim(&dom.style(node, "visibility")) == "hidden"
        || effective_opacity_dom(dom, node) < COVER_MIN_OPACITY
    {
        return false;
    }
    MEDIA_TAGS.contains(&tag_lower(dom, node).as_str())
        || parse_rgb_or_any(&dom.style(node, "backgroundColor"))
            .map_or(false, |c| c.alpha_or_one() >= COVER_MIN_ALPHA)
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

fn at_point(
    dom: &dyn Dom,
    el: ElId,
    x: f64,
    y: f64,
    host: Option<ElId>,
    resolved: Option<Rgba>,
) -> AtPoint {
    let stack = dom.elements_from_point(x, y);
    if stack.is_empty() {
        return AtPoint::Unanswered;
    }
    let in_text = |n: ElId| dom.contains(el, n);
    let Some(first) = stack.iter().position(|&n| in_text(n)) else {
        return AtPoint::Silent;
    };
    for &node in &stack[..first] {
        if dom.contains(node, el) {
            continue;
        }
        if covers(dom, node, x, y) {
            return AtPoint::Covered;
        }
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
    let (vw, vh) = occlusion_viewport(dom);
    let Some(rect) = occlusion_probe_rect(dom, el, &dom.rect(el)) else {
        return TextLayers::Undecided;
    };
    let points = occlusion_probe_points(&rect, vw, vh);
    if points.is_empty() || points.len() * 2 < occlusion_grid_size(&rect) {
        // Below the fold no point is answered, but one layer can be read off
        // the tree: a loaded picture a later sibling lays over the text.
        if rect.top >= vh && covered_by_a_later_picture(dom, el) {
            return TextLayers::Covered;
        }
        return TextLayers::Undecided;
    }
    let answers: Vec<AtPoint> = points
        .iter()
        .map(|&(x, y)| at_point(dom, el, x, y, host, resolved))
        .collect();
    if answers.contains(&AtPoint::Unanswered) {
        return TextLayers::Undecided;
    }
    let deciding: Vec<AtPoint> = answers.into_iter().filter(|a| *a != AtPoint::Silent).collect();
    if deciding.is_empty() || deciding.len() * 2 < points.len() {
        return TextLayers::Undecided;
    }
    if deciding.iter().all(|a| *a == AtPoint::Covered) {
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
///   own, whose source does not end in `.svg` or `.png`, sized to cover
///   (`object-fit` `fill` or `cover`), covering the text within a pixel, and
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
            let src = dom
                .image_current_src(img)
                .or_else(|| dom.attr(img, "src"))
                .unwrap_or_default()
                .to_ascii_lowercase();
            let path = src.split(['?', '#']).next().unwrap_or("");
            if path.ends_with(".svg") || path.ends_with(".png") {
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
            let covers = r.all_finite()
                && r.left <= text.left + 1.0
                && r.top <= text.top + 1.0
                && r.right >= text.right - 1.0
                && r.bottom >= text.bottom - 1.0;
            if !covers || !super::painted::painted_at_capture(dom, img) {
                return false;
            }
            let mut cur = Some(img);
            while let Some(c) = cur {
                if !opaque(c) {
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
