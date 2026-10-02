//! Where did a region go? A bounded search for a comp region's pixels near its
//! box in a build capture, used by the responsive gate to tell a region that is
//! displaced (present, but shifted, often past the first viewport) from one that
//! is missing. Pure; no browser.
//!
//! The search runs on blurred luma at a working scale (each axis at most 96
//! samples across the region), scores every offset in the window by normalized
//! cross-correlation over the part of the region that lands inside the capture,
//! and confirms the best offset with the full comp-diff score on that part. A
//! region found nowhere in the window stays missing.

use impeccable_comp::metrics as m;
use impeccable_comp::raster::{self as r, Image};

use crate::comp_diff::{score_pair, verdict_for, Score};

/// Largest vertical displacement searched, as a share of the comp's height.
/// Wider than any sub-pixel or rounding drift (the comparison already absorbs a
/// global shift of 4% of the width) and narrow enough that a match is still the
/// same element in the same place of the layout, not a lookalike further down.
pub const MAX_DY: f64 = 0.12;
/// Largest horizontal displacement searched, as a share of the comp's width.
pub const MAX_DX: f64 = 0.04;
const WORK: f64 = 96.0;
const MIN_NCC: f64 = 0.6;

#[derive(Clone)]
pub struct Displacement {
    /// Offset of the region's content from its comp box, in comp pixels.
    pub dx: f64,
    pub dy: f64,
    /// Share of the region's box that lies inside the frame at the displaced position.
    pub visible: f64,
    /// True when the region's own pixels were too far out of the frame to match,
    /// and the offset was read from the content directly above it in its column.
    pub inferred: bool,
    pub score: Score,
}

impl Displacement {
    pub fn beyond_frame(&self) -> bool {
        self.visible < 0.999
    }
}

/// A comp-pixel rectangle, clamped to an image on use.
#[derive(Clone, Copy)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

fn gray(img: &Image) -> m::Gray {
    m::blur_gray(&m::to_gray(img), 1)
}

/// Normalized cross-correlation of the template against the window with the
/// template's top-left at (ox, oy) in window samples, over the overlap only.
/// Returns (ncc, overlap rows, overlap cols).
fn ncc(t: &m::Gray, w: &m::Gray, ox: i64, oy: i64) -> Option<(f64, usize, usize)> {
    let x0 = 0i64.max(-ox);
    let y0 = 0i64.max(-oy);
    let x1 = (t.width as i64).min(w.width as i64 - ox);
    let y1 = (t.height as i64).min(w.height as i64 - oy);
    if x1 <= x0 || y1 <= y0 {
        return None;
    }
    let n = ((x1 - x0) * (y1 - y0)) as f64;
    let (mut st, mut sw, mut stt, mut sww, mut stw) = (0f64, 0f64, 0f64, 0f64, 0f64);
    for y in y0..y1 {
        let tr = (y as usize) * t.width;
        let wr = ((y + oy) as usize) * w.width;
        for x in x0..x1 {
            let a = t.data[tr + x as usize] as f64;
            let b = w.data[wr + (x + ox) as usize] as f64;
            st += a;
            sw += b;
            stt += a * a;
            sww += b * b;
            stw += a * b;
        }
    }
    let vt = stt - st * st / n;
    let vw = sww - sw * sw / n;
    // A flat patch on either side has no shape to match.
    if vt <= n * 4.0 || vw <= n * 4.0 {
        return None;
    }
    Some(((stw - st * sw / n) / (vt * vw).sqrt(), (y1 - y0) as usize, (x1 - x0) as usize))
}

struct Best {
    dx: f64,
    dy: f64,
    ncc: f64,
}

/// Search `region` (comp pixels) of `comp` in `build` (already scaled to the
/// comp's width) over offsets within the bounds. `min_rows` is the share of the
/// template's rows that must overlap the build for an offset to count.
fn search(comp: &Image, build: &Image, region: Rect, dy_range: (f64, f64), dx_max: f64, min_rows: f64) -> Option<Best> {
    let fx = (WORK / region.w).min(1.0);
    let fy = (WORK / region.h).min(1.0);
    let template = r::crop(comp, region.x, region.y, region.w, region.h);
    let t = gray(&r::resize(&template, (template.width as f64 * fx).max(2.0), (template.height as f64 * fy).max(2.0)));
    // The window: the region's box widened by the search bounds, clamped to the build.
    let wx = (region.x - dx_max).max(0.0).floor();
    let wy = (region.y + dy_range.0).max(0.0).floor();
    let wr = (region.x + region.w + dx_max).min(build.width as f64);
    let wb = (region.y + region.h + dy_range.1).min(build.height as f64);
    if wr - wx < 2.0 || wb - wy < 2.0 {
        return None;
    }
    let window = r::crop(build, wx, wy, wr - wx, wb - wy);
    let w = gray(&r::resize(&window, (window.width as f64 * fx).max(2.0), (window.height as f64 * fy).max(2.0)));
    let (sx, sy) = (t.width as f64 / template.width as f64, t.height as f64 / template.height as f64);
    let steps = |lo: f64, hi: f64, s: f64| ((lo * s).floor() as i64, (hi * s).ceil() as i64);
    let (ylo, yhi) = steps(dy_range.0, dy_range.1, sy);
    let (xlo, xhi) = steps(-dx_max, dx_max, sx);
    let need_rows = ((t.height as f64 * min_rows).ceil() as usize).max(1);
    let mut best: Option<Best> = None;
    for dy in ylo..=yhi {
        for dx in xlo..=xhi {
            // Template origin in window samples.
            let ox = ((region.x - wx) * sx).round() as i64 + dx;
            let oy = ((region.y - wy) * sy).round() as i64 + dy;
            let Some((score, rows, cols)) = ncc(&t, &w, ox, oy) else { continue };
            if rows < need_rows || cols * 2 < t.width {
                continue;
            }
            if best.as_ref().is_none_or(|b| score > b.ncc + 1e-9) {
                best = Some(Best { dx: dx as f64 / sx, dy: dy as f64 / sy, ncc: score });
            }
        }
    }
    best.filter(|b| b.ncc >= MIN_NCC)
}

/// The full comp-diff score of the part of `region` that, moved by (dx, dy),
/// lands inside the build.
fn confirm(comp: &Image, build: &Image, region: Rect, dx: f64, dy: f64, kind: Option<&str>) -> Option<Score> {
    let top = (-(region.y + dy)).max(0.0);
    let left = (-(region.x + dx)).max(0.0);
    let bottom = (region.y + dy + region.h - build.height as f64).max(0.0);
    let right = (region.x + dx + region.w - build.width as f64).max(0.0);
    let w = region.w - left - right;
    let h = region.h - top - bottom;
    if w < 2.0 || h < 2.0 {
        return None;
    }
    let a = r::crop(comp, region.x + left, region.y + top, w, h);
    let b = r::crop(build, region.x + dx + left, region.y + dy + top, w, h);
    if a.width != b.width || a.height != b.height {
        return None;
    }
    let score = score_pair(&a, &b, kind);
    matches!(verdict_for(&score, kind), "match" | "drift").then_some(score)
}

fn visible(region: Rect, dx: f64, dy: f64, frame_w: f64, frame_h: f64) -> f64 {
    let ix = ((region.x + dx + region.w).min(frame_w) - (region.x + dx).max(0.0)).max(0.0);
    let iy = ((region.y + dy + region.h).min(frame_h) - (region.y + dy).max(0.0)).max(0.0);
    (ix * iy) / (region.w * region.h).max(1.0)
}

/// Find where `region` of `comp` sits in `build`, a capture scaled to the comp's
/// width whose first `frame_h` rows are the compared first viewport (a full-page
/// capture may run below it). Returns None when the region is in place or is not
/// found within the bounds.
pub fn find(comp: &Image, build: &Image, frame_h: f64, region: Rect, kind: Option<&str>) -> Option<Displacement> {
    if region.w < 2.0 || region.h < 2.0 {
        return None;
    }
    let max_dy = (comp.height as f64 * MAX_DY).round();
    let max_dx = (comp.width as f64 * MAX_DX).round();
    // A move under a pixel and a half at either scale is rounding, not displacement.
    let moved = |dx: f64, dy: f64| dx.abs() >= 2.0 || dy.abs() >= 2.0;
    let frame_w = comp.width as f64;
    // Direct: the region's own pixels, at least a third of its rows inside the build.
    if let Some(best) = search(comp, build, region, (-max_dy, max_dy), max_dx, 1.0 / 3.0) {
        if moved(best.dx, best.dy) {
            if let Some(score) = confirm(comp, build, region, best.dx, best.dy, kind) {
                return Some(Displacement { dx: best.dx.round(), dy: best.dy.round(), visible: visible(region, best.dx, best.dy, frame_w, frame_h), inferred: false, score });
            }
        }
    }
    // Inferred: a region near the bottom of the frame whose pixels left it. Read
    // the offset of the content directly above it in its column, searching down
    // only, and accept it when that offset puts most of the region past the frame.
    let context_h = region.y.min((region.h * 3.0).max(comp.height as f64 * 0.08)).floor();
    if context_h < 4.0 || region.y + region.h + max_dy < frame_h {
        return None;
    }
    let above = Rect { x: region.x, y: region.y - context_h, w: region.w, h: context_h };
    let best = search(comp, build, above, (0.0, max_dy), max_dx, 0.5)?;
    if best.dy < 2.0 || best.ncc < 0.7 {
        return None;
    }
    let score = confirm(comp, build, above, best.dx, best.dy, None)?;
    let shown = visible(region, best.dx, best.dy, frame_w, frame_h);
    (shown < 0.5).then_some(Displacement { dx: best.dx.round(), dy: best.dy.round(), visible: shown, inferred: true, score })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page(offset: f64, frame_h: usize) -> Image {
        let mut img = r::create_image(400, frame_h, [240, 240, 236, 255]);
        // A column of rows ending in a short line of "text" at y = 330 + offset.
        for i in 0..8 {
            let y = 40.0 + i as f64 * 34.0 + offset * (i as f64 / 8.0);
            r::fill_rect(&mut img, 220.0, y, 120.0 + (i % 3) as f64 * 20.0, 10.0, [20.0, 20.0, 20.0, 255.0]);
        }
        let y = 330.0 + offset;
        for k in 0..6 {
            r::fill_rect(&mut img, 230.0 + k as f64 * 22.0, y, 14.0, 18.0, [20.0, 20.0, 20.0, 255.0]);
        }
        img
    }

    #[test]
    fn a_region_moved_inside_the_frame_is_found_with_its_offset() {
        let comp = page(0.0, 360);
        let mut build = r::create_image(400, 360, [240, 240, 236, 255]);
        r::blit(&mut build, &comp, 0.0, 0.0);
        // Move only the sign-off line up by 24px.
        r::fill_rect(&mut build, 220.0, 326.0, 180.0, 30.0, [240.0, 240.0, 236.0, 255.0]);
        let line = r::crop(&comp, 220.0, 326.0, 180.0, 26.0);
        r::blit(&mut build, &line, 220.0, 302.0);
        let found = find(&comp, &build, 360.0, Rect { x: 222.0, y: 328.0, w: 140.0, h: 22.0 }, Some("text")).unwrap();
        assert_eq!((found.dx, found.dy), (0.0, -24.0));
        assert!(!found.beyond_frame());
        assert!(!found.inferred);
    }

    #[test]
    fn a_region_pushed_below_the_frame_is_read_from_its_column() {
        let comp = page(0.0, 360);
        // The column grows longer: every row moves down progressively, the last by 40px.
        let build = page(40.0, 360);
        let found = find(&comp, &build, 360.0, Rect { x: 222.0, y: 328.0, w: 140.0, h: 22.0 }, Some("text")).unwrap();
        assert!(found.inferred, "the line is out of the frame; its column says where it went");
        assert!(found.dy >= 25.0 && found.dy <= 45.0, "{}", found.dy);
        assert!(found.beyond_frame());
    }

    #[test]
    fn a_full_page_capture_finds_the_region_itself_below_the_frame() {
        let comp = page(0.0, 360);
        let build = page(40.0, 480);
        let found = find(&comp, &build, 360.0, Rect { x: 222.0, y: 328.0, w: 140.0, h: 22.0 }, Some("text")).unwrap();
        assert!(!found.inferred);
        assert_eq!(found.dy, 40.0);
        assert!(found.beyond_frame());
    }

    #[test]
    fn a_region_that_is_gone_is_not_displaced() {
        let comp = page(0.0, 360);
        let mut build = comp.clone();
        r::fill_rect(&mut build, 220.0, 326.0, 180.0, 34.0, [240.0, 240.0, 236.0, 255.0]);
        assert!(find(&comp, &build, 360.0, Rect { x: 222.0, y: 328.0, w: 140.0, h: 22.0 }, Some("text")).is_none());
        // In place: nothing to report either.
        assert!(find(&comp, &comp, 360.0, Rect { x: 222.0, y: 328.0, w: 140.0, h: 22.0 }, Some("text")).is_none());
    }
}
