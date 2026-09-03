//! The plain-data shapes of the visual-contrast subsystem: painted-image
//! rects, the raster plan, the stack walk's node list, and the two staged
//! plans (`CssPlan`, `Prepared`) the caller resolves between passes. The
//! decisions that produce them live in `impeccable-core`.

use super::dom::{ElId, Rect};
use crate::color::Rgba;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The `{ left, top, width, height, intrinsicWidth, intrinsicHeight }` box.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaintedRect {
    pub left: f64,
    pub top: f64,
    pub width: f64,
    pub height: f64,
    pub intrinsic_width: f64,
    pub intrinsic_height: f64,
}

/// A `{ left, top, width, height }` container box (a DOMRect or a plain rect).
#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize)]
pub struct Box4 {
    pub left: f64,
    pub top: f64,
    pub width: f64,
    pub height: f64,
}

impl From<Rect> for Box4 {
    fn from(r: Rect) -> Self {
        Box4 {
            left: r.left,
            top: r.top,
            width: r.width,
            height: r.height,
        }
    }
}

// ─── raster sampling helpers (sampleDrawablePixel) ─────────────────────────

/// JS: index.mjs#sampleDrawablePixel — the canvas geometry: intrinsic size
/// scaled to a 640px raster budget.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RasterPlan {
    pub width: f64,
    pub height: f64,
    pub scale_x: f64,
    pub scale_y: f64,
}

// ─── the background stack walk (sampleVisualBackgroundAtPoint) ─────────────

/// One node of the stack walk with the branch it takes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StackNode {
    pub el: ElId,
    /// `"img"` (sampleImageElement), `"raster"` (canvas/video), `"css"`.
    pub kind: String,
}

/// The plan for `sampleCssBackground(node, style, point, textColor)`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CssPlan {
    /// A finished sample (analytic gradient, solid background, or the
    /// unresolved fallback).
    Sample { sample: Value },
    /// A `url()` layer the JS must load and raster-sample.
    Url {
        url: String,
        size: String,
        position: String,
    },
}

/// The outcome of the pre-analysis of a candidate.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Prepared {
    /// An early result (`status: 'unresolved'`), returned as-is.
    Early { early: Value },
    /// Ready to sample: the element, the sample points, and the text color.
    Ready {
        el: ElId,
        points: Vec<Value>,
        #[serde(rename = "textColor")]
        text_color: Rgba,
    },
}
