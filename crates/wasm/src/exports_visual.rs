//! wasm exports for the visual-contrast subsystem (`browser-bundle/35-visual.js`
//! calls these; the decisions live in `impeccable_core::browser::visual`).
//! JSON in / JSON out; typed scalars where the signature is small. Element
//! arguments are probe handles.

use crate::dom_source::with_dom;
use impeccable_core::browser::visual as vc;
use impeccable_core::color::Rgba;
use serde_json::{json, Value};
use wasm_bindgen::prelude::*;

fn parse(s: &str) -> Value {
    serde_json::from_str(s).unwrap_or(Value::Null)
}

fn rgba(s: &str) -> Option<Rgba> {
    serde_json::from_str(s).ok()
}

fn out(v: &Value) -> String {
    v.to_string()
}

fn point_json(p: Option<(f64, f64)>) -> String {
    match p {
        Some((x, y)) => json!({ "x": x, "y": y }).to_string(),
        None => "null".to_string(),
    }
}

/// `collectVisualContrastCandidates(options)`: `options_json` is
/// `{ maxCandidates?, imageOnly? }`; returns the candidate array.
#[wasm_bindgen]
pub fn collect_visual_contrast_candidates(options_json: &str) -> String {
    let options = parse(options_json);
    Value::Array(with_dom(|dom| vc::collect_visual_contrast_candidates(dom, &options))).to_string()
}

/// `isRenderedForBrowserRule(el)`.
#[wasm_bindgen]
pub fn is_rendered_for_browser_rule(el: u32) -> bool {
    with_dom(|dom| impeccable_core::browser::element_checks::is_rendered_for_browser_rule(dom, el))
}

/// `blendRgba(fg, bg)`: colors as `{r,g,b,a}` JSON or `null`.
#[wasm_bindgen]
pub fn vc_blend(fg_json: &str, bg_json: &str) -> String {
    let fg = rgba(fg_json);
    let bg = rgba(bg_json);
    match vc::blend_rgba(fg.as_ref(), bg.as_ref()) {
        Some(c) => serde_json::to_string(&c).unwrap_or_else(|_| "null".into()),
        None => "null".into(),
    }
}

/// `textSamplePoints(rect)` for the live viewport: `[{x,y}]`.
#[wasm_bindgen]
pub fn vc_text_sample_points(left: f64, top: f64, width: f64, height: f64) -> String {
    let rect = impeccable_core::browser::Rect::from_xywh(left, top, width, height);
    let pts = with_dom(|d| vc::text_sample_points(&rect, d.inner_width(), d.inner_height()));
    Value::Array(pts.iter().map(|(x, y)| json!({ "x": x, "y": y })).collect()).to_string()
}

/// `sampleVisualBackgroundAtPoint` step 1: the nodes to walk for `el` at
/// `(x, y)` with their branch (`{ nodes: [{ el, kind }] }`), or the early
/// unresolved sample (`{ unresolved: {...} }`) when the depth cap is hit.
#[wasm_bindgen]
pub fn vc_stack_nodes(el: u32, x: f64, y: f64, depth: f64) -> String {
    match with_dom(|dom| vc::stack_nodes(dom, el, x, y, depth)) {
        Ok(nodes) => json!({ "nodes": nodes }).to_string(),
        Err(unresolved) => json!({ "unresolved": unresolved }).to_string(),
    }
}

/// `sampleImageElement` geometry: `intrinsic_*` = `naturalWidth || videoWidth
/// || width` (0 when none). Returns `{ painted, point }` or `{ sample }`.
#[wasm_bindgen]
pub fn vc_img_source_point(node: u32, intrinsic_w: f64, intrinsic_h: f64, x: f64, y: f64) -> String {
    match with_dom(|dom| vc::img_source_point(dom, node, intrinsic_w, intrinsic_h, x, y)) {
        Ok((painted, (px, py))) => json!({ "painted": painted, "point": { "x": px, "y": py } }).to_string(),
        Err(sample) => json!({ "sample": sample }).to_string(),
    }
}

/// `sampleImageElement` retry with the separately loaded image: the source
/// point (`{x,y}` or `null`) using the loaded intrinsic size.
#[wasm_bindgen]
pub fn vc_img_loaded_source_point(painted_json: &str, loaded_w: f64, loaded_h: f64, x: f64, y: f64) -> String {
    let Ok(painted) = serde_json::from_str::<vc::PaintedRect>(painted_json) else { return "null".into() };
    point_json(vc::img_loaded_source_point(&painted, loaded_w, loaded_h, x, y))
}

/// `{ ...sample, method: 'canvas-img-underlay' }` when sampled.
#[wasm_bindgen]
pub fn vc_img_finish(sample_json: &str) -> String {
    out(&vc::img_finish(parse(sample_json)))
}

/// canvas/video underlay source point (`intrinsic_*` = `node.width ||
/// node.videoWidth`, 0 when none); `{x,y}` or `null`.
#[wasm_bindgen]
pub fn vc_raster_source_point(node: u32, intrinsic_w: f64, intrinsic_h: f64, x: f64, y: f64) -> String {
    point_json(with_dom(|dom| vc::raster_source_point(dom, node, intrinsic_w, intrinsic_h, x, y)))
}

/// `{ ...sample, method: 'canvas-<tag>-underlay' }` when sampled.
#[wasm_bindgen]
pub fn vc_raster_finish(node: u32, sample_json: &str) -> String {
    out(&with_dom(|dom| vc::raster_finish(dom, node, parse(sample_json))))
}

/// `sampleDrawablePixel` canvas sizing: `{ width, height, scaleX, scaleY }`.
#[wasm_bindgen]
pub fn vc_raster_plan(intrinsic_w: f64, intrinsic_h: f64) -> String {
    serde_json::to_string(&vc::raster_plan(intrinsic_w, intrinsic_h)).unwrap_or_default()
}

/// `sampleDrawablePixel` pixel address on the raster: `{x,y}`.
#[wasm_bindgen]
pub fn vc_raster_pixel(plan_json: &str, source_x: f64, source_y: f64) -> String {
    let Ok(plan) = serde_json::from_str::<vc::RasterPlan>(plan_json) else { return "null".into() };
    point_json(Some(vc::raster_pixel(&plan, source_x, source_y)))
}

/// `{ status: 'sampled', color: { r, g, b, a: a255 / 255 } }`.
#[wasm_bindgen]
pub fn vc_pixel_sample(r: f64, g: f64, b: f64, a255: f64) -> String {
    out(&vc::pixel_sample(r, g, b, a255))
}

/// The canvas error → reason string (`'tainted image'` / `'image sample failed'`).
#[wasm_bindgen]
pub fn vc_raster_error_reason(message: &str) -> String {
    vc::raster_error_reason(message)
}

/// `{ status: 'unresolved', reason: reason || 'image sample failed' }`.
#[wasm_bindgen]
pub fn vc_raster_failure_sample(reason: &str) -> String {
    out(&vc::raster_failure_sample(reason))
}

/// `{ status: 'unresolved', reason: 'canvas unavailable' }`.
#[wasm_bindgen]
pub fn vc_raster_no_context_sample() -> String {
    out(&vc::raster_no_context_sample())
}

/// `sampleCssBackground` plan for `node`: `{ kind: 'sample', sample }` or
/// `{ kind: 'url', url, size, position }`.
#[wasm_bindgen]
pub fn vc_css_plan(node: u32, text_color_json: &str) -> String {
    let tc = rgba(text_color_json);
    serde_json::to_string(&with_dom(|dom| vc::css_plan(dom, node, tc.as_ref()))).unwrap_or_default()
}

/// url path: `{ status: 'unresolved', reason: 'image unavailable' }`.
#[wasm_bindgen]
pub fn vc_css_url_no_image() -> String {
    out(&vc::css_url_no_image())
}

/// url path: source point on the loaded image (`{ point }` or `{ sample }`).
#[wasm_bindgen]
pub fn vc_css_url_source_point(node: u32, intrinsic_w: f64, intrinsic_h: f64, size: &str, position: &str, x: f64, y: f64) -> String {
    match with_dom(|dom| vc::css_url_source_point(dom, node, intrinsic_w, intrinsic_h, size, position, x, y)) {
        Ok((px, py)) => json!({ "point": { "x": px, "y": py } }).to_string(),
        Err(sample) => json!({ "sample": sample }).to_string(),
    }
}

/// `{ ...sample, method: 'canvas-background-image' }` when sampled.
#[wasm_bindgen]
pub fn vc_css_url_finish(sample_json: &str) -> String {
    out(&vc::css_url_finish(parse(sample_json)))
}

/// A sampled color that ends the walk (no compositing beneath).
#[wasm_bindgen]
pub fn vc_sample_is_opaque(sample_json: &str) -> bool {
    vc::sample_is_opaque(&parse(sample_json))
}

/// The alpha-compositing step over the sample beneath.
#[wasm_bindgen]
pub fn vc_alpha_composite(sample_json: &str, under_json: &str) -> String {
    out(&vc::alpha_composite(parse(sample_json), &parse(under_json)))
}

/// The walk's final unresolved sample from the collected reasons (`[string]`).
#[wasm_bindgen]
pub fn vc_unresolved_from_reasons(reasons_json: &str) -> String {
    let reasons: Vec<String> = serde_json::from_str(reasons_json).unwrap_or_default();
    out(&vc::unresolved_from_reasons(&reasons))
}

/// `analyzeVisualContrastCandidate` before sampling: `{ early }` (a finished
/// result) or `{ el, points: [{x,y}], textColor }`.
#[wasm_bindgen]
pub fn vc_prepare_analysis(candidate_json: &str) -> String {
    let candidate = parse(candidate_json);
    serde_json::to_string(&with_dom(|dom| vc::prepare_analysis(dom, &candidate))).unwrap_or_default()
}

/// `analyzeVisualContrastCandidate` after sampling: the result object.
#[wasm_bindgen]
pub fn vc_finish_analysis(candidate_json: &str, text_color_json: &str, samples_json: &str, points_len: u32) -> String {
    let candidate = parse(candidate_json);
    let Some(tc) = rgba(text_color_json) else { return "null".into() };
    let samples: Vec<Value> = serde_json::from_str(samples_json).unwrap_or_default();
    out(&vc::finish_analysis(&candidate, &tc, &samples, points_len as usize))
}

/// `analyzeVisualContrast`: retry after scrollIntoView?
#[wasm_bindgen]
pub fn vc_needs_scroll_retry(result_json: &str) -> bool {
    vc::needs_scroll_retry(&parse(result_json))
}
