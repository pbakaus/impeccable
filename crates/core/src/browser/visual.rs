//! Visual-contrast decisions from `cli/engine/browser/injected/index.mjs`
//! (see browser/mod.rs). The async pixel sampling (Image loading, canvas
//! draws, scrollIntoView, paint waits) stays in `browser-bundle/35-visual.js`
//! and calls into these through the `vc_*` wasm exports; every threshold,
//! result string, and computation of that subsystem lives here.

#![allow(unused_imports)]

use super::dom::{
    closest_or_none, direct_text, pf0, safe_id, style_px, tag_lower, Dom, ElId, Rect,
};
use super::element_checks::parse_rgb_or_any;
use crate::color::{contrast_ratio, parse_gradient_colors, parse_rgb, Rgba};
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
        let backdrop = dom.style(cur, "backdropFilter");
        if !backdrop.is_empty() && backdrop != "none" {
            add(&mut reasons, "backdrop filter");
        }
        let solid_bg = parse_rgb_or_any(&dom.style(cur, "backgroundColor"));
        if let Some(bg) = solid_bg {
            // JS `solidBg.a >= 0.95` (parseRgb always sets a).
            if bg.a.unwrap_or(f64::NAN) >= 0.95 && (bg_image.is_empty() || bg_image == "none") {
                break;
            }
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

/// JS: index.mjs#collectVisualContrastCandidates(options)
pub fn collect_visual_contrast_candidates(dom: &dyn Dom, options: &Value) -> Vec<Value> {
    let max_candidates = match options.get("maxCandidates") {
        Some(Value::Number(n)) if n.as_f64().map_or(false, f64::is_finite) => {
            n.as_f64().unwrap()
        }
        _ => 12.0,
    };
    let image_only = truthy(options.get("imageOnly"));
    let body = dom.body();
    let root = dom.document_element();
    let mut candidates: Vec<Value> = Vec::new();
    for el in dom.query_all(None, "*").unwrap_or_default() {
        if (candidates.len() as f64) >= max_candidates {
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
        if !super::element_checks::is_rendered_for_browser_rule(dom, el) {
            continue;
        }
        let tag = tag_lower(dom, el);
        if dom.style(el, "display") == "none" || dom.style(el, "visibility") == "hidden" {
            continue;
        }
        let direct = direct_text(dom, el);
        let has_direct_text = !js::trim(&direct).is_empty();
        if !has_direct_text || crate::checks::rules::is_emoji_only_text(&direct) {
            continue;
        }
        let bg_color = super::background::read_own_background_color(dom, el);
        let is_styled_button = (tag == "a" || tag == "button")
            && bg_color.map_or(false, |c| c.a.map_or(false, |a| a > 0.5));
        if SAFE_TAGS.contains(&tag.as_str()) && !is_styled_button {
            continue;
        }
        let rect = dom.direct_text_rect(el).unwrap_or_else(|| dom.rect(el));
        if rect.width < 4.0 || rect.height < 4.0 {
            continue;
        }
        let reasons = collect_visual_contrast_reasons(dom, el);
        if reasons.is_empty() {
            continue;
        }
        if image_only && !reasons.iter().any(|r| r == "image background") {
            continue;
        }
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
                    "opacity stack" | "blend mode" | "filter" | "backdrop filter" | "background-clip text"
                )
            });
        let text = slice_utf16_prefix(&collapse_ws(js::trim(&direct)), 80);
        let mut m = Map::new();
        m.insert("selector".into(), Value::String(super::driver::generate_selector(dom, el)));
        m.insert("tagName".into(), Value::String(tag));
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
        candidates.push(Value::Object(m));
    }
    candidates
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

/// JS: index.mjs#sampleVisualBackgroundAtPoint — the depth cap and the node
/// list (`elementsFromPoint` stack from the element down, overlay chrome
/// skipped). `Err` carries the early-unresolved sample.
pub fn stack_nodes(dom: &dyn Dom, el: ElId, x: f64, y: f64, depth: f64) -> Result<Vec<StackNode>, Value> {
    if depth > 8.0 {
        return Err(json!({ "status": "unresolved", "reason": "background stack too deep" }));
    }
    let stack = dom.elements_from_point(x, y);
    let self_index = stack.iter().position(|&n| n == el || dom.contains(el, n));
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

fn with_method(sample: Value, method: &str) -> Value {
    if sample.get("status").and_then(Value::as_str) == Some("sampled") {
        let mut m = sample.as_object().cloned().unwrap_or_default();
        m.insert("method".into(), Value::String(method.to_string()));
        Value::Object(m)
    } else {
        sample
    }
}

/// JS: index.mjs#sampleCssBackground — every decision except the image
/// load and the canvas sample.
pub fn css_plan(dom: &dyn Dom, node: ElId, text_color: Option<&Rgba>) -> CssPlan {
    let bg_image = dom.style(node, "backgroundImage");
    if !bg_image.is_empty() && bg_image != "none" {
        if GRADIENT_RE.is_match(&bg_image) {
            if let Some(tc) = text_color {
                let colors = parse_gradient_colors(Some(&bg_image));
                if let Some(color) = pick_worst_contrast_color(tc, &colors) {
                    return CssPlan::Sample {
                        sample: json!({ "status": "sampled", "color": color, "method": "analytic-gradient" }),
                    };
                }
            } else {
                // JS-PARITY: contrastRatio(null, c) throws in the JS when
                // textColor is null; analyzeVisualContrastCandidate never
                // reaches here without one, so this branch is unreachable.
            }
        }
        if URL_RE.is_match(&bg_image) {
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
        if bg.a.unwrap_or(f64::NAN) > 0.05 {
            return CssPlan::Sample {
                sample: json!({ "status": "sampled", "color": bg, "method": "solid-background" }),
            };
        }
    }
    CssPlan::Sample {
        sample: json!({ "status": "unresolved", "reason": "no readable background" }),
    }
}

/// JS: sampleCssBackground url path — `if (!img) return { status:
/// 'unresolved', reason: 'image unavailable' }`.
pub fn css_url_no_image() -> Value {
    json!({ "status": "unresolved", "reason": "image unavailable" })
}

/// JS: sampleCssBackground url path — painted rect of the loaded image over
/// the node's box and the source point; `Err` is the unresolved sample.
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
    let rect: Box4 = dom.rect(node).into();
    let painted = resolve_painted_image_rect(&rect, intrinsic_w, intrinsic_h, size, position);
    point_to_image_source(x, y, &painted)
        .ok_or_else(|| json!({ "status": "unresolved", "reason": "point outside background image" }))
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
        return json!({
            "status": "sampled",
            "color": rgba_value(blended.as_ref()),
            "method": format!("{method}+alpha"),
        });
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
pub fn prepare_analysis(dom: &dyn Dom, candidate: &Value) -> Prepared {
    let selector = str_or_empty(candidate.get("selector"));
    let el = match dom.query_one(None, &selector) {
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
            "background-clip text" | "blend mode" | "filter" | "backdrop filter" | "opacity stack" | "text shadow"
        )
    });
    if let Some(b) = blocking {
        return Prepared::Early { early: unresolved(candidate, &format!("{b} needs screenshot pixels")) };
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

/// JS: index.mjs#analyzeVisualContrastCandidate — after the sampling loop:
/// `samples` is one `{ status, color?, method?, reason? }` per point.
pub fn finish_analysis(candidate: &Value, text_color: &Rgba, samples: &[Value], points_len: usize) -> Value {
    let mut ratios: Vec<f64> = Vec::new();
    let mut methods: Vec<String> = Vec::new();
    let mut unresolved_reasons: Vec<String> = Vec::new();
    for sample in samples {
        let sampled = sample.get("status").and_then(Value::as_str) == Some("sampled");
        let color = rgba_from_value(sample.get("color"));
        if !sampled || color.is_none() {
            unresolved_reasons.push(str_or_empty(sample.get("reason")));
            continue;
        }
        let bg = color.unwrap();
        let fg = blend_rgba(Some(text_color), Some(&bg)).unwrap();
        ratios.push(contrast_ratio(&fg, &bg));
        let method = str_or_empty(sample.get("method"));
        if !method.is_empty() && !methods.contains(&method) {
            methods.push(method);
        }
    }
    if ratios.len() < math_min(3.0, points_len as f64) as usize {
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
                ("samples", json!(ratios.len())),
                ("reason", json!(reason)),
            ],
        );
    }
    ratios.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let n = ratios.len();
    let pick = |pct: f64| -> f64 {
        let idx = ((pct / 100.0) * n as f64).floor();
        let idx = math_min((n - 1) as f64, math_max(0.0, idx)) as usize;
        ratios[idx]
    };
    let measured = pick(10.0);
    let median = pick(50.0);
    let threshold = candidate.get("threshold").and_then(Value::as_f64).unwrap_or(f64::NAN);
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
        to_fixed(measured, 1),
        to_fixed(median, 1),
        number_to_string(threshold),
        method,
        text_label
    );
    let finding = if status == "fail" {
        json!({ "id": "low-contrast", "snippet": detail })
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
}
