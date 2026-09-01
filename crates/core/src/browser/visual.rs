//! The visual-contrast subsystem's decisions. Open: the plain-data plans and
//! rects (`impeccable_foundation::browser::visual`). Closed: every decision
//! below.
//!
//! The JS half of this subsystem is asynchronous (image loads, canvas draws),
//! so the run is staged: the caller asks for a plan, does the pixel work, and
//! hands the sample back. Every stage that carries a `serde_json::Value`
//! crosses as JSON text; the `f64`s that are not inside a `Value` stay in
//! postcard and keep their exact bits.

use crate::ffi;
use impeccable_foundation::boundary::{fn_id, CssPlanWire, JsonBlob, PreparedWire};
use impeccable_foundation::browser::dom::{Dom, ElId};
use impeccable_foundation::color::Rgba;
use serde_json::Value;

pub use impeccable_foundation::browser::visual::*;

fn blobs(values: &[Value]) -> Vec<JsonBlob> {
    values.iter().map(JsonBlob::of).collect()
}

// ── pure ──────────────────────────────────────────────────────────────────

/// JS: index.mjs#sampleDrawablePixel (the canvas geometry)
pub fn raster_plan(intrinsic_w: f64, intrinsic_h: f64) -> RasterPlan {
    ffi::call(fn_id::VISUAL_RASTER_PLAN, &(intrinsic_w, intrinsic_h))
}

/// JS: index.mjs#sampleDrawablePixel (the pixel to read)
pub fn raster_pixel(plan: &RasterPlan, source_x: f64, source_y: f64) -> (f64, f64) {
    ffi::call(fn_id::VISUAL_RASTER_PIXEL, &(plan, source_x, source_y))
}

/// JS: index.mjs#sampleDrawablePixel (the sample object)
pub fn pixel_sample(r: f64, g: f64, b: f64, a255: f64) -> Value {
    let out: JsonBlob = ffi::call(fn_id::VISUAL_PIXEL_SAMPLE, &(r, g, b, a255));
    out.parse()
}

/// JS: index.mjs#sampleDrawablePixel (the catch branch's reason)
pub fn raster_error_reason(message: &str) -> String {
    ffi::call(fn_id::VISUAL_RASTER_ERROR_REASON, &message)
}

/// JS: index.mjs#sampleDrawablePixel (the catch branch's sample)
pub fn raster_failure_sample(reason: &str) -> Value {
    let out: JsonBlob = ffi::call(fn_id::VISUAL_RASTER_FAILURE_SAMPLE, &reason);
    out.parse()
}

/// JS: index.mjs#sampleDrawablePixel (no 2d context)
pub fn raster_no_context_sample() -> Value {
    let out: JsonBlob = ffi::call(fn_id::VISUAL_RASTER_NO_CONTEXT_SAMPLE, &());
    out.parse()
}

/// JS: index.mjs#sampleImageElement (after the image loaded)
pub fn img_loaded_source_point(
    painted: &PaintedRect,
    loaded_w: f64,
    loaded_h: f64,
    x: f64,
    y: f64,
) -> Option<(f64, f64)> {
    ffi::call(
        fn_id::VISUAL_IMG_LOADED_SOURCE_POINT,
        &(painted, loaded_w, loaded_h, x, y),
    )
}

/// JS: index.mjs#sampleImageElement (the returned sample)
pub fn img_finish(sample: Value) -> Value {
    let out: JsonBlob = ffi::call(fn_id::VISUAL_IMG_FINISH, &JsonBlob::of(&sample));
    out.parse()
}

/// JS: index.mjs#sampleCssBackground (a `url()` layer with no image)
pub fn css_url_no_image() -> Value {
    let out: JsonBlob = ffi::call(fn_id::VISUAL_CSS_URL_NO_IMAGE, &());
    out.parse()
}

/// JS: index.mjs#sampleCssBackground (the returned sample)
pub fn css_url_finish(sample: Value) -> Value {
    let out: JsonBlob = ffi::call(fn_id::VISUAL_CSS_URL_FINISH, &JsonBlob::of(&sample));
    out.parse()
}

/// JS: index.mjs#sampleVisualBackgroundAtPoint (the opacity test)
pub fn sample_is_opaque(sample: &Value) -> bool {
    ffi::call(fn_id::VISUAL_SAMPLE_IS_OPAQUE, &JsonBlob::of(sample))
}

/// JS: index.mjs#sampleVisualBackgroundAtPoint (the compositing step)
pub fn alpha_composite(sample: Value, under: &Value) -> Value {
    let out: JsonBlob = ffi::call(
        fn_id::VISUAL_ALPHA_COMPOSITE,
        &(JsonBlob::of(&sample), JsonBlob::of(under)),
    );
    out.parse()
}

/// JS: index.mjs#analyzeVisualContrastCandidate (the unresolved result)
pub fn unresolved_from_reasons(reasons: &[String]) -> Value {
    let out: JsonBlob = ffi::call(fn_id::VISUAL_UNRESOLVED_FROM_REASONS, &reasons);
    out.parse()
}

/// JS: index.mjs#analyzeVisualContrastCandidate (the verdict)
pub fn finish_analysis(
    candidate: &Value,
    text_color: &Rgba,
    samples: &[Value],
    points_len: usize,
) -> Value {
    let out: JsonBlob = ffi::call(
        fn_id::VISUAL_FINISH_ANALYSIS,
        &(
            JsonBlob::of(candidate),
            text_color,
            blobs(samples),
            points_len as u64,
        ),
    );
    out.parse()
}

/// JS: index.mjs#runVisualContrast (the retry decision)
pub fn needs_scroll_retry(result: &Value) -> bool {
    ffi::call(fn_id::VISUAL_NEEDS_SCROLL_RETRY, &JsonBlob::of(result))
}

// ── dom-taking ────────────────────────────────────────────────────────────

/// JS: index.mjs#collectVisualContrastReasons
pub fn collect_visual_contrast_reasons(dom: &dyn Dom, el: ElId) -> Vec<String> {
    ffi::call_dom(fn_id::VISUAL_COLLECT_CONTRAST_REASONS, dom, &el)
}

/// JS: index.mjs#collectVisualContrastCandidates
pub fn collect_visual_contrast_candidates(dom: &dyn Dom, options: &Value) -> Vec<Value> {
    let out: Vec<JsonBlob> = ffi::call_dom(
        fn_id::VISUAL_COLLECT_CONTRAST_CANDIDATES,
        dom,
        &JsonBlob::of(options),
    );
    out.iter().map(|b| b.parse()).collect()
}

/// JS: index.mjs#sampleVisualBackgroundAtPoint (the stack walk)
pub fn stack_nodes(
    dom: &dyn Dom,
    el: ElId,
    x: f64,
    y: f64,
    depth: f64,
) -> Result<Vec<StackNode>, Value> {
    let out: Result<Vec<StackNode>, JsonBlob> =
        ffi::call_dom(fn_id::VISUAL_STACK_NODES, dom, &(el, x, y, depth));
    out.map_err(|b| b.parse())
}

/// JS: index.mjs#sampleImageElement (the painted rect and source point)
pub fn img_source_point(
    dom: &dyn Dom,
    node: ElId,
    intrinsic_w: f64,
    intrinsic_h: f64,
    x: f64,
    y: f64,
) -> Result<(PaintedRect, (f64, f64)), Value> {
    let out: Result<(PaintedRect, (f64, f64)), JsonBlob> = ffi::call_dom(
        fn_id::VISUAL_IMG_SOURCE_POINT,
        dom,
        &(node, intrinsic_w, intrinsic_h, x, y),
    );
    out.map_err(|b| b.parse())
}

/// JS: index.mjs#sampleRasterElement (the source point)
pub fn raster_source_point(
    dom: &dyn Dom,
    node: ElId,
    intrinsic_w: f64,
    intrinsic_h: f64,
    x: f64,
    y: f64,
) -> Option<(f64, f64)> {
    ffi::call_dom(
        fn_id::VISUAL_RASTER_SOURCE_POINT,
        dom,
        &(node, intrinsic_w, intrinsic_h, x, y),
    )
}

/// JS: index.mjs#sampleRasterElement (the returned sample)
pub fn raster_finish(dom: &dyn Dom, node: ElId, sample: Value) -> Value {
    let out: JsonBlob = ffi::call_dom(
        fn_id::VISUAL_RASTER_FINISH,
        dom,
        &(node, JsonBlob::of(&sample)),
    );
    out.parse()
}

/// JS: index.mjs#sampleCssBackground (the plan)
pub fn css_plan(dom: &dyn Dom, node: ElId, text_color: Option<&Rgba>) -> CssPlan {
    let out: CssPlanWire = ffi::call_dom(fn_id::VISUAL_CSS_PLAN, dom, &(node, text_color));
    out.into()
}

/// JS: index.mjs#sampleCssBackground (the `url()` layer's source point)
#[allow(clippy::too_many_arguments)]
pub fn css_url_source_point(
    dom: &dyn Dom,
    node: ElId,
    intrinsic_w: f64,
    intrinsic_h: f64,
    size: &str,
    position: &str,
    x: f64,
    y: f64,
) -> Result<(f64, f64), Value> {
    let out: Result<(f64, f64), JsonBlob> = ffi::call_dom(
        fn_id::VISUAL_CSS_URL_SOURCE_POINT,
        dom,
        &(node, intrinsic_w, intrinsic_h, size, position, x, y),
    );
    out.map_err(|b| b.parse())
}

/// JS: index.mjs#analyzeVisualContrastCandidate (the pre-analysis)
pub fn prepare_analysis(dom: &dyn Dom, candidate: &Value) -> Prepared {
    let out: PreparedWire = ffi::call_dom(
        fn_id::VISUAL_PREPARE_ANALYSIS,
        dom,
        &JsonBlob::of(candidate),
    );
    out.into()
}
