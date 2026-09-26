//! JS: skill/scripts/comp-spec.mjs
//!
//! Turn an approved comp into a measured build spec (region boxes, palettes,
//! media, plate prompts). Pure; no browser.

use std::path::{Path, PathBuf};

use impeccable_common::Io;
use impeccable_comp::metrics as m;
use impeccable_comp::png_io;
use impeccable_comp::raster::{self as r, Image};
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use crate::util::{self, arg, arg_or, flag, num, r4, r4f, round};

pub const BUILD_DIR: &str = ".impeccable/build";
pub const SPEC_PATH: &str = ".impeccable/build/spec.json";
pub const GRID_PATH: &str = ".impeccable/build/comp-grid.png";
pub const PLATES_DIR: &str = "assets/plates";

const COLS: &[u8] = b"ABCDEFGHIJ";
pub const MAX_CODE_REGION_AREA: f64 = 0.25;
pub const EDGE_CONTACT_MIN: f64 = 0.35;

pub(crate) fn is_raster_kind(k: &str) -> bool {
    matches!(k, "plate" | "image" | "texture")
}
pub(crate) fn is_kind(k: &str) -> bool {
    matches!(k, "plate" | "image" | "texture" | "text" | "control" | "chrome" | "band")
}

/// JS: PAINTED_NOTE.
static PAINTED_NOTE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b(diagram|drawing|drawn|illustration|illustrations|illustrated|figure|schematic|exploded|photo|photos|photograph\w*|picture|painting|painted|render|rendered|rendering|artwork|engraving|etching|linework|line art|texture|textured|textures|grain|fabric|halftone|watercolou?r|sketch|sketched|blueprint|geometry|leader lines?|callout lines?|thumbnail|silhouette|product shot|hero image|3d)\b").unwrap()
});

/// JS: gridToBox(span). Err(message) mirrors the thrown Error.
pub fn grid_to_box(span: &str) -> Result<(f64, f64, f64, f64), String> {
    static RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)^([A-J])([0-9]):([A-J])([0-9])$").unwrap());
    let trimmed = span.trim();
    let caps = RE
        .captures(trimmed)
        .ok_or_else(|| format!("grid span \"{span}\" is not <colrow>:<colrow>, e.g. E0:J4"))?;
    let col = |s: &str| COLS.iter().position(|&c| c == s.to_ascii_uppercase().as_bytes()[0]).unwrap() as f64;
    let c0 = col(&caps[1]);
    let r0: f64 = caps[2].parse().unwrap();
    let c1 = col(&caps[3]);
    let r1: f64 = caps[4].parse().unwrap();
    let x0 = c0.min(c1);
    let x1 = c0.max(c1);
    let y0 = r0.min(r1);
    let y1 = r0.max(r1);
    Ok((x0 / 10.0, y0 / 10.0, (x1 - x0 + 1.0) / 10.0, (y1 - y0 + 1.0) / 10.0))
}

/// JS: renderGrid(comp).
pub fn render_grid(comp: &Image) -> Image {
    let target_w = 1536f64.min(comp.width as f64);
    let mut img = r::resize(comp, target_w, round((comp.height as f64 / comp.width as f64) * target_w));
    let iw = img.width as f64;
    let ih = img.height as f64;
    let cw = iw / 10.0;
    let ch = ih / 10.0;
    let line = [255.0, 40.0, 40.0, 200.0];
    for i in 1..10 {
        r::fill_rect(&mut img, round(i as f64 * cw), 0.0, 1.0, ih, line);
        r::fill_rect(&mut img, 0.0, round(i as f64 * ch), iw, 1.0, line);
    }
    for rr in 0..10usize {
        for c in 0..10usize {
            let label = format!("{}{}", COLS[c] as char, rr);
            r::draw_label(
                &mut img,
                &label,
                round(c as f64 * cw) + 3.0,
                round(rr as f64 * ch) + 3.0,
                [255.0, 230.0, 120.0, 255.0],
                [0.0, 0.0, 0.0, 170.0],
                2.0,
                4.0,
            );
        }
    }
    img
}

fn palette_of(img: &Image) -> Vec<m::DominantColor> {
    m::dominant_colors(img, 5, 3)
}

fn palette_json(colors: &[m::DominantColor]) -> Value {
    Value::Array(
        colors
            .iter()
            .map(|c| json!({ "hex": c.hex, "coverage": num(c.coverage) }))
            .collect(),
    )
}

fn gray_no_alpha(data: &[u8], i: usize) -> f64 {
    0.299 * data[i] as f64 + 0.587 * data[i + 1] as f64 + 0.114 * data[i + 2] as f64
}

/// JS: medianGray(img).
fn median_gray(img: &Image) -> f64 {
    let n = img.width * img.height;
    let step = (n / 6000).max(1);
    let mut sample: Vec<f64> = Vec::new();
    let mut j = 0;
    while j < n {
        sample.push(gray_no_alpha(&img.data, j * 4));
        j += step;
    }
    sample.sort_by(|a, b| a.partial_cmp(b).unwrap());
    sample[sample.len() / 2]
}

/// JS: energyOf(img) via detailGrid(img, 4, 4, 256).
fn energy_of(img: &Image) -> f64 {
    let g = m::detail_grid(img, 4, 4, 256);
    let s: f64 = g.cells.iter().map(|&v| v as f64).sum();
    s / g.cells.len() as f64
}

/// JS: artworkTouchesEdges(img, {contact, band, ground}). Returns edge names.
pub fn artwork_touches_edges(img: &Image, contact: f64, band: usize, ground_opt: Option<f64>) -> Vec<String> {
    let w = img.width;
    let h = img.height;
    let mut gray = vec![0f32; w * h];
    for (j, g) in gray.iter_mut().enumerate() {
        *g = gray_no_alpha(&img.data, j * 4) as f32;
    }
    let ground = ground_opt.unwrap_or_else(|| {
        let step = (gray.len() / 5000).max(1);
        let mut sample: Vec<f64> = Vec::new();
        let mut i = 0;
        while i < gray.len() {
            sample.push(gray[i] as f64);
            i += step;
        }
        sample.sort_by(|a, b| a.partial_cmp(b).unwrap());
        sample[sample.len() / 2]
    });
    let ink = |x: usize, y: usize| (gray[y * w + x] as f64 - ground).abs() > 60.0;
    let run = |n: usize, at: &dyn Fn(usize) -> bool| -> f64 {
        let mut best = 0usize;
        let mut cur = 0usize;
        for i in 0..n {
            if at(i) {
                cur += 1;
                if cur > best {
                    best = cur;
                }
            } else {
                cur = 0;
            }
        }
        best as f64 / n as f64
    };
    let mut sides = Vec::new();
    if run(h, &|y| (0..band).any(|x| ink(x, y))) >= contact {
        sides.push("left".to_string());
    }
    if run(h, &|y| (w.saturating_sub(band)..w).any(|x| ink(x, y))) >= contact {
        sides.push("right".to_string());
    }
    if run(w, &|x| (0..band).any(|y| ink(x, y))) >= contact {
        sides.push("top".to_string());
    }
    if run(w, &|x| (h.saturating_sub(band)..h).any(|y| ink(x, y))) >= contact {
        sides.push("bottom".to_string());
    }
    sides
}

/// JS: snapBoxToInk(comp, box, ground, {pad=6, minShrink=0.06}).
pub fn snap_box_to_ink(comp: &Image, boxf: (f64, f64, f64, f64), ground: f64) -> Option<(f64, f64, f64, f64)> {
    let pad = 6i64;
    let min_shrink = 0.06;
    let comp_w = comp.width as f64;
    let comp_h = comp.height as f64;
    let pxx = round(boxf.0 * comp_w) as i64;
    let pxy = round(boxf.1 * comp_h) as i64;
    let pxw = round(boxf.2 * comp_w) as i64;
    let pxh = round(boxf.3 * comp_h) as i64;
    if pxw < 8 || pxh < 8 {
        return None;
    }
    let c = r::crop(comp, pxx as f64, pxy as f64, pxw as f64, pxh as f64);
    let w = c.width;
    let h = c.height;
    let (mut x0, mut y0, mut x1, mut y1) = (w as i64, h as i64, -1i64, -1i64);
    for y in 0..h {
        for x in 0..w {
            let i = (y * w + x) * 4;
            let g = gray_no_alpha(&c.data, i);
            if (g - ground).abs() > 60.0 {
                if (x as i64) < x0 {
                    x0 = x as i64;
                }
                if (x as i64) > x1 {
                    x1 = x as i64;
                }
                if (y as i64) < y0 {
                    y0 = y as i64;
                }
                if (y as i64) > y1 {
                    y1 = y as i64;
                }
            }
        }
    }
    if x1 < 0 {
        return None;
    }
    let cell = 6usize.max(round((w.min(h) as f64) / 40.0) as usize);
    let cw = w.div_ceil(cell);
    let ch = h.div_ceil(cell);
    let mut cnt = vec![0u32; cw * ch];
    for y in 0..h {
        for x in 0..w {
            let i = (y * w + x) * 4;
            let g = gray_no_alpha(&c.data, i);
            if (g - ground).abs() > 60.0 {
                cnt[(y / cell) * cw + (x / cell)] += 1;
            }
        }
    }
    let mut on = vec![0u8; cw * ch];
    let threshold = (cell * cell) as f64 * 0.04;
    for i in 0..on.len() {
        on[i] = if cnt[i] as f64 >= threshold { 1 } else { 0 };
    }
    let mut grown = vec![0u8; on.len()];
    for y in 0..ch {
        for x in 0..cw {
            if on[y * cw + x] == 0 {
                continue;
            }
            for dy in -1i64..=1 {
                for dx in -1i64..=1 {
                    let nx = x as i64 + dx;
                    let ny = y as i64 + dy;
                    if nx >= 0 && ny >= 0 && (nx as usize) < cw && (ny as usize) < ch {
                        grown[(ny as usize) * cw + nx as usize] = 1;
                    }
                }
            }
        }
    }
    let mask = &grown;
    let mut label = vec![-1i64; cw * ch];
    struct Cand {
        n: u64,
        bx0: i64,
        by0: i64,
        bx1: i64,
        by1: i64,
        touches_side: bool,
    }
    let mut best: Option<Cand> = None;
    for s0 in 0..on.len() {
        if mask[s0] == 0 || label[s0] >= 0 {
            continue;
        }
        let mut stack = vec![s0];
        label[s0] = s0 as i64;
        let mut n: u64 = 0;
        let (mut bx0, mut by0, mut bx1, mut by1) = (cw as i64, ch as i64, -1i64, -1i64);
        while let Some(k) = stack.pop() {
            let kx = (k % cw) as i64;
            let ky = (k / cw) as i64;
            if on[k] != 0 {
                n += cnt[k] as u64;
                if kx < bx0 {
                    bx0 = kx;
                }
                if kx > bx1 {
                    bx1 = kx;
                }
                if ky < by0 {
                    by0 = ky;
                }
                if ky > by1 {
                    by1 = ky;
                }
            }
            for dy in -1i64..=1 {
                for dx in -1i64..=1 {
                    let nx = kx + dx;
                    let ny = ky + dy;
                    if nx < 0 || ny < 0 || nx >= cw as i64 || ny >= ch as i64 {
                        continue;
                    }
                    let nk = (ny as usize) * cw + nx as usize;
                    if mask[nk] != 0 && label[nk] < 0 {
                        label[nk] = s0 as i64;
                        stack.push(nk);
                    }
                }
            }
        }
        let touches_side = bx0 == 0 || bx1 == cw as i64 - 1;
        let cand = Cand { n, bx0, by0, bx1, by1, touches_side };
        match &best {
            None => best = Some(cand),
            Some(b) => {
                if b.touches_side && !cand.touches_side && cand.n * 3 >= b.n {
                    best = Some(cand);
                } else if !b.touches_side && cand.touches_side && cand.n < b.n * 3 {
                    // keep inside
                } else if cand.n > b.n {
                    best = Some(cand);
                }
            }
        }
    }
    if let Some(b) = &best {
        x0 = b.bx0 * cell as i64;
        y0 = b.by0 * cell as i64;
        x1 = ((w as i64) - 1).min((b.bx1 + 1) * cell as i64 - 1);
        y1 = ((h as i64) - 1).min((b.by1 + 1) * cell as i64 - 1);
    }
    let nx0 = 0i64.max(x0 - pad);
    let ny0 = 0i64.max(y0 - pad);
    let nx1 = (w as i64).min(x1 + 1 + pad);
    let ny1 = (h as i64).min(y1 + 1 + pad);
    let shrink = 1.0 - ((nx1 - nx0) * (ny1 - ny0)) as f64 / (w * h) as f64;
    if shrink < min_shrink {
        return None;
    }
    Some((
        (pxx as f64 + nx0 as f64) / comp_w,
        (pxy as f64 + ny0 as f64) / comp_h,
        (nx1 - nx0) as f64 / comp_w,
        (ny1 - ny0) as f64 / comp_h,
    ))
}

/// Automatic narrowing must not discard separate words/lines from a compound
/// control. The original largest-cluster helper remains available to explicit
/// callers; region measurement uses this conservative wrapper.
fn snap_preserving_ink(comp: &Image, boxf: (f64, f64, f64, f64), ground: f64) -> Option<(f64, f64, f64, f64)> {
    let snapped = snap_box_to_ink(comp, boxf, ground)?;
    let original = r::clamp_rect(comp, boxf.0 * comp.width as f64, boxf.1 * comp.height as f64,
        boxf.2 * comp.width as f64, boxf.3 * comp.height as f64);
    let keep = r::clamp_rect(comp, snapped.0 * comp.width as f64, snapped.1 * comp.height as f64,
        snapped.2 * comp.width as f64, snapped.3 * comp.height as f64);
    let (mut total, mut lost) = (0u64, 0u64);
    for y in original.y..original.y + original.h {
        for x in original.x..original.x + original.w {
            if (gray_no_alpha(&comp.data, (y * comp.width + x) * 4) - ground).abs() > 60. {
                total += 1;
                if x < keep.x || x >= keep.x + keep.w || y < keep.y || y >= keep.y + keep.h { lost += 1; }
            }
        }
    }
    // At most incidental noise may disappear. Preserve the supplied span when
    // the algorithm cannot distinguish a second label from unrelated content.
    (lost * 100 <= total * 5).then_some(snapped)
}

/// JS: uncoveredInkCells(comp, regions).
fn uncovered_ink_cells(comp: &Image, regions: &[Value]) -> Vec<String> {
    let grid = m::detail_grid(comp, 10, 10, 512);
    let mut energies: Vec<f64> = grid.cells.iter().map(|&v| v as f64).collect();
    energies.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let ground = *energies.get((energies.len() as f64 * 0.1).floor() as usize).unwrap_or(&0.0);
    let threshold = 4f64.max(ground * 2.2).max(ground + 12.0);
    let mut cells = Vec::new();
    for rr in 0..10usize {
        for c in 0..10usize {
            let e = grid.cells[rr * 10 + c] as f64;
            if e < threshold {
                continue;
            }
            let cx = (c as f64 + 0.5) / 10.0;
            let cy = (rr as f64 + 0.5) / 10.0;
            let covered = regions.iter().any(|reg| {
                let kind = reg.get("kind").and_then(Value::as_str).unwrap_or("");
                if kind == "texture" || kind == "band" {
                    return false;
                }
                let b = reg.get("coverBox").filter(|v| !v.is_null()).or_else(|| reg.get("box"));
                let Some(b) = b else { return false };
                let bx = b.get("x").and_then(Value::as_f64).unwrap_or(0.0);
                let by = b.get("y").and_then(Value::as_f64).unwrap_or(0.0);
                let bw = b.get("w").and_then(Value::as_f64).unwrap_or(0.0);
                let bh = b.get("h").and_then(Value::as_f64).unwrap_or(0.0);
                cx >= bx && cx <= bx + bw && cy >= by && cy <= by + bh
            });
            if !covered {
                cells.push(format!("{}{}", COLS[c] as char, rr));
            }
        }
    }
    cells
}

/// Painted-pixel reading of a code region's comp crop: how many colours sit
/// off the line between its two main tones (ground and ink, with every
/// antialiased mix between them), and the share of continuous-tone pixels in
/// its busy 8x8 blocks. Type and flat controls stay near their two tones;
/// photographs, rendered figures and material surfaces do not.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PaintedPixels { pub colours: usize, pub soft: f64 }
/// A window reads painted when any clause holds: (colours, soft) at least
/// (18, 0.44) or (28, 0.38), or 60 colours alone. Calibrated on 556 regions of
/// 12 eval comps plus 24 replayed runs: no text or control region that shows
/// only type reads painted, while every photograph and about half the plates do
/// (the misses are small single-ink sprigs that look like type).
pub const PAINTED_CLAUSES: [(usize, f64); 3] = [(18, 0.44), (28, 0.38), (60, 0.)];

fn seg_dist(p: [f64; 3], a: [f64; 3], b: [f64; 3]) -> f64 {
    let ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    let l2 = ab.iter().map(|v| v * v).sum::<f64>();
    let t = if l2 == 0. { 0. } else { ((0..3).map(|k| (p[k] - a[k]) * ab[k]).sum::<f64>() / l2).clamp(0., 1.) };
    (0..3).map(|k| (a[k] + t * ab[k] - p[k]).powi(2)).sum::<f64>().sqrt()
}

/// Side of the square window the painted reading is taken over, in comp
/// pixels. A fixed window keeps the reading independent of how much calm
/// ground a box also holds: a painted patch reads the same in a tight box and
/// in a generous one.
pub const PAINTED_WINDOW: usize = 64;

/// The strongest reading over `PAINTED_WINDOW` windows (half-window stride; a
/// crop smaller than a window is one window). None when no window keeps half
/// its pixels and 64 samples (`skip` marks crop pixels another raster region owns).
pub fn painted_pixels(img: &Image, skip: &dyn Fn(usize, usize) -> bool) -> Option<PaintedPixels> {
    painted_pixels_window(img, skip, PAINTED_WINDOW)
}

pub fn painted_pixels_window(img: &Image, skip: &dyn Fn(usize, usize) -> bool, win: usize) -> Option<PaintedPixels> {
    let starts = |n: usize| -> Vec<usize> { let w = win.min(n) & !1; if w == 0 { return vec![]; }
        let mut v: Vec<usize> = (0..=(n - w)).step_by((w / 2).max(2) & !1).collect(); if *v.last().unwrap() != (n - w) & !1 { v.push((n - w) & !1); } v };
    let (ww, wh) = (win.min(img.width) & !1, win.min(img.height) & !1);
    let score = painted_score;
    let mut best: Option<PaintedPixels> = None;
    for &y in &starts(img.height) { for &x in &starts(img.width) {
        let Some(p) = painted_window(img, skip, x, y, ww, wh) else { continue; };
        if best.as_ref().map_or(true, |b| score(&p) > score(b)) { best = Some(p); }
    }}
    best
}

fn painted_window(img: &Image, skip: &dyn Fn(usize, usize) -> bool, x0: usize, y0: usize, w: usize, h: usize) -> Option<PaintedPixels> {
    let d = &img.data;
    let px = |x: usize, y: usize| { let i = (y * img.width + x) * 4; [d[i] as f64, d[i + 1] as f64, d[i + 2] as f64] };
    let key = |p: [f64; 3]| ((p[0] as u32 >> 4) << 8) | ((p[1] as u32 >> 4) << 4) | (p[2] as u32 >> 4);
    // 2x box average: comp grain and paper noise average out, painted tone does not.
    let mut samples: Vec<[f64; 3]> = Vec::new();
    for y in (y0..y0 + h).step_by(2) { for x in (x0..x0 + w).step_by(2) {
        let cells = [(x, y), (x + 1, y), (x, y + 1), (x + 1, y + 1)];
        if cells.iter().any(|&(cx, cy)| skip(cx, cy)) { continue; }
        let s = cells.iter().fold([0.; 3], |a, &(cx, cy)| { let p = px(cx, cy); [a[0] + p[0], a[1] + p[1], a[2] + p[2]] });
        samples.push([(s[0] / 4.).floor(), (s[1] / 4.).floor(), (s[2] / 4.).floor()]);
    }}
    if samples.len() < 64 || samples.len() * 8 < w * h { return None; }
    let mut bins: std::collections::BTreeMap<u32, (usize, [f64; 3])> = Default::default();
    for &p in &samples { let e = bins.entry(key(p)).or_insert((0, [0.; 3])); e.0 += 1; for k in 0..3 { e.1[k] += p[k]; } }
    let mut ranked: Vec<(usize, [f64; 3])> = bins.values().map(|&(n, s)| (n, [s[0] / n as f64, s[1] / n as f64, s[2] / n as f64])).collect();
    ranked.sort_by(|a, b| b.0.cmp(&a.0));
    let ground = ranked[0].1;
    let ink = ranked.iter().map(|r| r.1).find(|c| seg_dist(*c, ground, ground) > 48.).unwrap_or(ground);
    let mut off: std::collections::HashMap<u32, usize> = Default::default();
    for &p in &samples { if seg_dist(p, ground, ink) > 24. { *off.entry(key(p)).or_default() += 1; } }
    let min = (samples.len() as f64 * 0.002).max(2.);
    let colours = off.values().filter(|&&n| n as f64 >= min).count();
    let (mut mid, mut busy) = (0usize, 0usize);
    for by in (y0..y0 + h.saturating_sub(7)).step_by(8) { for bx in (x0..x0 + w.saturating_sub(7)).step_by(8) {
        let cells: Vec<(usize, usize)> = (0..64).map(|k| (bx + k % 8, by + k / 8)).collect();
        if cells.iter().any(|&(x, y)| skip(x, y)) { continue; }
        let l: Vec<f64> = cells.iter().map(|&(x, y)| { let p = px(x, y); 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2] }).collect();
        let (lo, hi) = l.iter().fold((f64::MAX, f64::MIN), |(a, b), &v| (a.min(v), b.max(v)));
        if hi - lo < 24. { continue; }
        busy += 64;
        mid += l.iter().filter(|&&v| (v - lo) / (hi - lo) > 0.25 && (v - lo) / (hi - lo) < 0.75).count();
    }}
    Some(PaintedPixels { colours, soft: if busy == 0 { 0. } else { mid as f64 / busy as f64 } })
}

/// How far the reading gets toward its nearest clause; 1 or more reads painted.
fn painted_score(p: &PaintedPixels) -> f64 {
    PAINTED_CLAUSES.iter().map(|&(c, s)| (p.colours as f64 / c as f64).min(if s > 0. { p.soft / s } else { f64::MAX })).fold(0., f64::max)
}

pub fn reads_painted(p: &PaintedPixels) -> bool {
    PAINTED_CLAUSES.iter().any(|&(c, s)| p.colours >= c && p.soft >= s)
}

/// What a code region's own pixels hold once raster regions and smaller
/// regions inside it are set aside. `flat`: under 2% of them leave the main
/// tone (a bare ground). `rules`: the box is at most 6px on its short side, or
/// its ink is straight hairlines, at least 80% of ink pixels on a horizontal or
/// vertical run of 12px or more that is at most 6px thick. Neither needs a
/// human decision; emblems, marks and icons are neither.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Surface { pub flat: bool, pub rules: bool }

pub fn surface_of(img: &Image, skip: &dyn Fn(usize, usize) -> bool) -> Surface {
    let (w, h, d) = (img.width, img.height, &img.data);
    let px = |x: usize, y: usize| { let i = (y * w + x) * 4; [d[i] as f64, d[i + 1] as f64, d[i + 2] as f64] };
    let key = |p: [f64; 3]| ((p[0] as u32 >> 4) << 8) | ((p[1] as u32 >> 4) << 4) | (p[2] as u32 >> 4);
    let mut bins: std::collections::HashMap<u32, (usize, [f64; 3])> = Default::default();
    let mut kept = 0usize;
    for y in 0..h { for x in 0..w { if skip(x, y) { continue; } kept += 1;
        let p = px(x, y); let e = bins.entry(key(p)).or_insert((0, [0.; 3])); e.0 += 1; for k in 0..3 { e.1[k] += p[k]; } } }
    let thin_box = w.min(h) <= 6;
    let Some(&(n, sum)) = bins.values().max_by_key(|v| v.0) else { return Surface { flat: true, rules: thin_box }; };
    let ground = sum.map(|v| v / n as f64);
    let ink: Vec<bool> = (0..w * h).map(|i| !skip(i % w, i / w) && seg_dist(px(i % w, i / w), ground, ground) > 32.).collect();
    let count = ink.iter().filter(|&&v| v).count();
    // Length of the ink run through each pixel, per axis (index = y * w + x).
    let runs = |horizontal: bool| -> Vec<usize> {
        let (outer, inner) = if horizontal { (h, w) } else { (w, h) };
        let at = |o: usize, i: usize| if horizontal { o * w + i } else { i * w + o };
        let mut out = vec![0; w * h];
        for o in 0..outer { let mut i = 0; while i < inner {
            if !ink[at(o, i)] { i += 1; continue; }
            let start = i; while i < inner && ink[at(o, i)] { i += 1; }
            for k in start..i { out[at(o, k)] = i - start; }
        }}
        out
    };
    let (hr, vr) = (runs(true), runs(false));
    let straight = (0..w * h).filter(|&i| ink[i] && ((hr[i] >= 12 && vr[i] <= 6) || (vr[i] >= 12 && hr[i] <= 6))).count();
    Surface { flat: (count as f64) < 0.02 * kept as f64, rules: thin_box || (count > 0 && straight as f64 >= 0.8 * count as f64) }
}

/// Per code region: `surface` (above) and, when its crop reads painted, a
/// `painted-pixels` flag. The flag is never a refusal; it sends the region to
/// the human plan review. Pixels inside raster regions belong to their plates;
/// containers are judged on what shows between their raster children.
fn code_region_readings(comp: &Image, regions: &mut [Value]) {
    let pxbox = |r: &Value| ["x", "y", "w", "h"].map(|k| r["px"][k].as_i64().unwrap_or(0));
    let boxes: Vec<(String, bool, [i64; 4])> = regions.iter().filter(|r| r["kind"] != "band")
        .map(|r| (r["id"].as_str().unwrap_or("").to_string(), r["kind"].as_str().is_some_and(is_raster_kind), pxbox(r))).collect();
    let inside = |b: &[i64; 4], gx: i64, gy: i64| gx >= b[0] && gx < b[0] + b[2] && gy >= b[1] && gy < b[1] + b[3];
    for region in regions.iter_mut() {
        if !matches!(region["kind"].as_str(), Some("text" | "control" | "chrome")) { continue; }
        let [x, y, w, h] = pxbox(region);
        let crop = r::crop(comp, x as f64, y as f64, w as f64, h as f64);
        let raster = |cx: usize, cy: usize| boxes.iter().any(|(_, r, b)| *r && inside(b, x + cx as i64, y + cy as i64));
        // Smaller regions inside this one (its text, its controls) are theirs to judge.
        let owned = |cx: usize, cy: usize| boxes.iter().any(|(id, r, b)| (*r || (b[2] * b[3] < w * h && region["id"] != id.as_str())) && inside(b, x + cx as i64, y + cy as i64));
        let sf = surface_of(&crop, &owned);
        region["surface"] = json!({"flat": sf.flat, "rules": sf.rules});
        let Some(p) = painted_pixels(&crop, &raster).filter(reads_painted) else { continue; };
        region["flags"] = json!([{"id": "painted-pixels", "message": format!(
            "Looks painted: {} colours beyond its two main tones and soft shading across {}% of it. Drawn in code, this becomes a flat copy.",
            p.colours, round(p.soft * 100.) as i64)}]);
    }
}

fn box_json(b: (f64, f64, f64, f64)) -> Value {
    json!({ "x": r4(b.0), "y": r4(b.1), "w": r4(b.2), "h": r4(b.3) })
}

/// JS: measureRegions(comp, regionsInput, compPath). Err = thrown message.
pub fn measure_regions(comp: &Image, regions_input: &Value, comp_path: &str) -> Result<Value, String> {
    let mut regions: Vec<Value> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let page_ground = median_gray(comp);
    let w = comp.width as f64;
    let h = comp.height as f64;
    let empty = Vec::new();
    let raw_regions = regions_input.get("regions").and_then(Value::as_array).unwrap_or(&empty);
    for raw in raw_regions {
        let id = raw.get("id").and_then(Value::as_str);
        let Some(id) = id.filter(|s| !s.is_empty()) else {
            return Err("every region needs an id".into());
        };
        let id = id.to_string();
        if seen.contains(&id) {
            return Err(format!("duplicate region id {id}"));
        }
        seen.insert(id.clone());
        let raw_kind = raw.get("kind").and_then(Value::as_str);
        let kind = match raw_kind {
            Some(k) if is_kind(k) => k.to_string(),
            _ => return Err(format!("region {id} has kind {}; use one of plate, image, texture, text, control, chrome, band", raw.get("kind").map_or("(missing)".into(), Value::to_string))),
        };
        let note = raw.get("note").and_then(Value::as_str);
        if !note.map(|n| n.trim().chars().count() >= 8).unwrap_or(false) {
            return Err(format!(
                "region {id} has no note. Say in a few words what the comp shows there (the element, its material, its role): the note drives the plate prompt and the gate's messages, and a drawing named as chrome is only caught by what its note says."
            ));
        }
        let code_drawn = truthy(raw.get("codeDrawn"));
        let container = truthy(raw.get("container"));
        let bleed = truthy(raw.get("bleed"));
        for (key, present) in [("codeDrawn", code_drawn), ("container", container), ("bleed", bleed)] {
            if present {
                let suffix = match key {
                    "codeDrawn" => " (the painted-material refusal is overridden: code draws this region)",
                    "container" => " (the region-size refusal is overridden: one undivided element)",
                    _ => " (the clipped-artwork refusal is overridden: the page crops it there)",
                };
                warnings.push(format!("region {id}: \"{key}\": true set in the regions file{suffix}"));
            }
        }
        if let Some(n) = note {
            if !is_raster_kind(&kind) && kind != "band" && PAINTED_NOTE.is_match(n) && !code_drawn {
                return Err(format!(
                    "region {id} is kind \"{kind}\" but its note describes painted material (\"{n}\"). Anything drawn, photographed, or textured ships as a raster plate: set kind to plate (illustration, diagram, figure), image (photograph), or texture (ground). If the note is wrong and code really draws it (a table, a rule, a chrome bar), reword the note or set \"codeDrawn\": true on the region."
                ));
            }
        }
        // box: explicit raw.box (x is number) else gridToBox(raw.grid)
        let has_normalized_box = raw
            .get("box")
            .and_then(|b| b.get("x"))
            .map(|x| x.is_number())
            .unwrap_or(false);
        let has_pixel_box = raw.get("pixelBox").is_some();
        let has_box = has_normalized_box || has_pixel_box;
        let mut boxf: (f64, f64, f64, f64) = if has_pixel_box {
            if raw.get("box").is_some() || raw.get("grid").is_some() {
                return Err(format!("region {id}: use pixelBox, box, or grid, not multiple coordinate formats"));
            }
            let b = &raw["pixelBox"];
            let coords: Option<Vec<f64>> = ["x", "y", "w", "h"].iter().map(|key| b[*key].as_f64()).collect();
            let Some(v) = coords else { return Err(format!("region {id}: pixelBox requires numeric x, y, w, h in original comp pixels")); };
            if v.iter().any(|v| !v.is_finite() || v.fract() != 0.) || v[0] < 0. || v[1] < 0.
                || v[2] <= 0. || v[3] <= 0. || v[0] + v[2] > w || v[1] + v[3] > h {
                return Err(format!("region {id}: pixelBox must use whole pixels within the {w}x{h} comp with positive width and height"));
            }
            (v[0] / w, v[1] / h, v[2] / w, v[3] / h)
        } else if has_normalized_box {
            let b = &raw["box"];
            let coords: Option<Vec<f64>> = ["x", "y", "w", "h"].iter().map(|key| b[*key].as_f64()).collect();
            // Same geometry contract as pixelBox and --inspect-map: a region is at least one real comp pixel inside the frame.
            match coords {
                Some(v) if v.iter().all(|v| v.is_finite()) && v[0] >= 0. && v[1] >= 0. && v[2] > 0. && v[3] > 0.
                    && v[0] + v[2] <= 1. + 1e-9 && v[1] + v[3] <= 1. + 1e-9
                    && round(v[2] * w) >= 1. && round(v[3] * h) >= 1. => (v[0], v[1], v[2], v[3]),
                _ => return Err(format!("region {id}: box must use numeric x, y, w, h within 0..1 of the comp, with positive size of at least one comp pixel")),
            }
        } else {
            let grid = raw.get("grid").and_then(Value::as_str).unwrap_or("");
            grid_to_box(grid)?
        };
        let mut cover_box: Option<(f64, f64, f64, f64)> = None;
        let grid_str = raw.get("grid").and_then(Value::as_str);
        let snap_not_false = raw.get("snap").and_then(Value::as_bool) != Some(false);
        if !has_box && grid_str.is_some() && (kind == "text" || kind == "control") && snap_not_false {
            if let Some(snapped) = snap_preserving_ink(comp, boxf, page_ground) {
                cover_box = Some(boxf);
                boxf = snapped;
            }
        }
        let area = boxf.2 * boxf.3;
        if !is_raster_kind(&kind) && kind != "band" && area > MAX_CODE_REGION_AREA && !container {
            return Err(format!(
                "region {id} ({kind}) covers {}% of the comp; a code region is one element (a headline, a table, a control, a rule, a bar), and one this large is a column holding several. Name each element inside it as its own region (every illustration or photo as a plate), or set \"container\": true on the region if it truly is one undivided element.",
                round(area * 100.0) as i64
            ));
        }
        let px_x = round(boxf.0 * w) as i64;
        let px_y = round(boxf.1 * h) as i64;
        let px_w = round(boxf.2 * w) as i64;
        let px_h = round(boxf.3 * h) as i64;
        let c = r::crop(comp, px_x as f64, px_y as f64, px_w as f64, px_h as f64);
        let energy = energy_of(&c);
        let raster = is_raster_kind(&kind);
        let at_comp_edge = |side: &str| match side {
            "left" => px_x <= 1,
            "top" => px_y <= 1,
            "right" => px_x + px_w >= comp.width as i64 - 1,
            _ => px_y + px_h >= comp.height as i64 - 1,
        };
        let clipped: Vec<String> = if raster && kind != "texture" && !bleed {
            artwork_touches_edges(&c, EDGE_CONTACT_MIN, 2, Some(page_ground))
                .into_iter()
                .filter(|side| !at_comp_edge(side))
                .collect()
        } else {
            Vec::new()
        };
        if !clipped.is_empty() {
            warnings.push(format!(
                "region {id}: the artwork runs off the box on the {} (its ink reaches the edge over {}% of that side). Widen the region so the box holds the whole shape with a margin; a plate placed with object-fit: cover on this box would be cut there.",
                clipped.join(" and "),
                round(EDGE_CONTACT_MIN * 100.0) as i64
            ));
        }
        // Assemble the region object in JS field order (undefined keys omitted).
        let mut obj = Map::new();
        obj.insert("id".into(), json!(id));
        obj.insert("kind".into(), json!(kind));
        obj.insert("note".into(), note.map(Value::from).unwrap_or(Value::Null));
        obj.insert("grid".into(), grid_str.map(Value::from).unwrap_or(Value::Null));
        if code_drawn {
            obj.insert("codeDrawn".into(), json!(true));
        }
        if container {
            obj.insert("container".into(), json!(true));
        }
        if bleed {
            obj.insert("bleed".into(), json!(true));
        }
        if raw.get("snap").and_then(Value::as_bool) == Some(false) {
            obj.insert("snap".into(), json!(false));
        }
        for key in ["parentId", "reviewGroup"] {
            if let Some(value) = raw.get(key) { obj.insert(key.into(), value.clone()); }
        }
        if let Some(cb) = cover_box {
            obj.insert("coverBox".into(), box_json(cb));
        }
        obj.insert("box".into(), box_json(boxf));
        obj.insert("px".into(), json!({ "x": px_x, "y": px_y, "w": px_w, "h": px_h }));
        obj.insert("aspect".into(), r4(px_w as f64 / px_h as f64));
        obj.insert("palette".into(), palette_json(&palette_of(&c)));
        obj.insert("detail".into(), json!({ "energy": r4(energy) }));
        let medium = raw
            .get("medium")
            .and_then(Value::as_str)
            .map(String::from)
            .unwrap_or_else(|| if raster { "raster".into() } else { "semantic".into() });
        obj.insert("medium".into(), json!(medium));
        if !clipped.is_empty() {
            obj.insert("clipped".into(), json!(clipped));
        }
        let plate = if raster {
            let p = raw
                .get("plate")
                .and_then(Value::as_str)
                .map(String::from)
                .unwrap_or_else(|| join_path(PLATES_DIR, &format!("{id}.png")));
            Value::String(p)
        } else {
            Value::Null
        };
        obj.insert("plate".into(), plate);
        obj.insert("text".into(), raw.get("text").filter(|v| !v.is_null()).cloned().unwrap_or(Value::Null));
        regions.push(Value::Object(obj));
    }
    code_region_readings(comp, &mut regions);
    let uncovered = uncovered_ink_cells(comp, &regions);
    if uncovered.len() > 3 && !truthy(regions_input.get("allowUncovered")) {
        return Err(format!(
            "grid cells {} carry ink no region names. Every element the comp shows must be in a region (text, control, chrome, or a plate) so its absence in the build can be measured; add regions for them, or set \"allowUncovered\": true in the regions file after confirming those cells are empty ground.",
            uncovered.join(", ")
        ));
    }
    let bands: Vec<Value> = m::horizontal_bands(comp, 128, 0.02)
        .into_iter()
        .filter(|b| b.strength > 0.2)
        .map(|b| json!({ "y": r4(b.y), "strength": r4(b.strength) }))
        .collect();
    let mut spec = Map::new();
    spec.insert("tool".into(), json!("comp-spec"));
    spec.insert("version".into(), json!(1));
    spec.insert("createdAt".into(), json!(util::iso_now()));
    spec.insert("comp".into(), json!(comp_path));
    spec.insert("warnings".into(), json!(warnings));
    spec.insert("uncoveredInkCells".into(), json!(uncovered));
    spec.insert("compSize".into(), json!({ "width": comp.width, "height": comp.height }));
    spec.insert("aspect".into(), r4(w / h));
    spec.insert("orientation".into(), json!(if comp.width >= comp.height { "landscape" } else { "portrait" }));
    spec.insert("palette".into(), palette_json(&palette_of(comp)));
    spec.insert("bands".into(), Value::Array(bands));
    spec.insert("regions".into(), Value::Array(regions));
    Ok(Value::Object(spec))
}

/// JS: autoRegions(comp).
pub fn auto_regions(comp: &Image) -> Value {
    let bands: Vec<m::Band> = m::horizontal_bands(comp, 128, 0.02).into_iter().filter(|b| b.strength > 0.2).collect();
    let mut cuts: Vec<f64> = Vec::new();
    let raw: Vec<f64> = std::iter::once(0.0).chain(bands.iter().map(|b| b.y)).chain(std::iter::once(1.0)).collect();
    for (i, &v) in raw.iter().enumerate() {
        if i == 0 || v - cuts[cuts.len() - 1] > 0.06 {
            cuts.push(v);
        }
    }
    if *cuts.last().unwrap() != 1.0 {
        cuts.push(1.0);
    }
    let mut regions = Vec::new();
    for i in 0..cuts.len().saturating_sub(1) {
        regions.push(json!({
            "id": format!("band-{}", i + 1),
            "kind": "band",
            "box": { "x": 0, "y": cuts[i], "w": 1, "h": cuts[i + 1] - cuts[i] }
        }));
    }
    json!({ "regions": regions })
}

fn hex_to_rgb(hex: &str) -> Option<[u8; 3]> {
    static RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$").unwrap());
    let caps = RE.captures(hex)?;
    Some([
        u8::from_str_radix(&caps[1], 16).ok()?,
        u8::from_str_radix(&caps[2], 16).ok()?,
        u8::from_str_radix(&caps[3], 16).ok()?,
    ])
}

/// The exclusions are evidence about the reference, not an asset verdict.
/// Count the union of rasterized rectangles, including already-ground pixels.
pub struct PlateReference {
    pub image: Image,
    pub excluded_pixels: usize,
    pub total_pixels: usize,
    pub excluded_regions: Vec<Value>,
    pub ignored_containers: Vec<String>,
}

impl PlateReference {
    pub fn fully_excluded(&self) -> bool {
        self.excluded_pixels == self.total_pixels
    }

    pub fn audit(&self) -> Value {
        json!({"policy":"plate-reference-v2", "excludedPixels":self.excluded_pixels,
            "totalPixels":self.total_pixels, "remainingPixels":self.total_pixels-self.excluded_pixels,
            "excludedFraction":self.excluded_pixels as f64 / self.total_pixels.max(1) as f64,
            "fullyExcluded":self.fully_excluded(), "regions":self.excluded_regions,
            "ignoredContainers":self.ignored_containers})
    }

    pub fn issue(&self, id: &str) -> Option<String> {
        if !self.fully_excluded() { return None; }
        let ids = self.excluded_regions.iter().filter_map(|r|r["id"].as_str()).collect::<Vec<_>>().join(", ");
        Some(format!("reference for {id} has no visible pixels after excluding {ids}; correct the overlapping region geometry or container roles in the comp spec before evaluating this asset"))
    }
}

/// JS: plateReference(comp, spec, region). Kept for pure image consumers.
pub fn plate_reference(comp: &Image, spec: &Value, region: &Value) -> Image {
    prepare_plate_reference(comp, spec, region).image
}

pub fn prepare_plate_reference(comp: &Image, spec: &Value, region: &Value) -> PlateReference {
    let px = |k: &str| region.pointer(&format!("/px/{k}")).and_then(Value::as_f64).unwrap_or(0.0);
    let (rx, ry, rw, rh) = (px("x"), px("y"), px("w"), px("h"));
    let mut c = r::crop(comp, rx, ry, rw, rh);
    let total_pixels = c.width * c.height;
    let mut excluded = vec![false; total_pixels];
    let mut excluded_regions = Vec::new();
    let mut ignored_containers = Vec::new();
    let ground = region
        .get("palette")
        .and_then(Value::as_array)
        .and_then(|a| a.first())
        .and_then(|p| p.get("hex"))
        .and_then(Value::as_str)
        .and_then(hex_to_rgb)
        .unwrap_or([255, 255, 255]);
    let region_id = region.get("id").and_then(Value::as_str).unwrap_or("");
    if let Some(others) = spec.get("regions").and_then(Value::as_array) {
        for other in others {
            let oid = other.get("id").and_then(Value::as_str).unwrap_or("");
            let okind = other.get("kind").and_then(Value::as_str).unwrap_or("");
            if oid == region_id || is_raster_kind(okind) || okind == "band" {
                continue;
            }
            let opx = |k: &str| other.pointer(&format!("/px/{k}")).and_then(Value::as_f64).unwrap_or(0.0);
            let (ox_, oy_, ow_, oh_) = (opx("x"), opx("y"), opx("w"), opx("h"));
            let ox = 0f64.max(ox_ - rx);
            let oy = 0f64.max(oy_ - ry);
            let ox2 = rw.min(ox_ + ow_ - rx);
            let oy2 = rh.min(oy_ + oh_ - ry);
            if ox2 <= ox || oy2 <= oy {
                continue;
            }
            // Containers describe layout/background extent, not foreground ink.
            // Their actual child text/control regions remain independently masked.
            if other.get("container").and_then(Value::as_bool) == Some(true) {
                ignored_containers.push(oid.to_string());
                continue;
            }
            let rect = r::clamp_rect(&c, ox, oy, ox2-ox, oy2-oy);
            if rect.w == 0 || rect.h == 0 { continue; }
            for y in rect.y..rect.y+rect.h {
                for x in rect.x..rect.x+rect.w { excluded[y*c.width+x] = true; }
            }
            excluded_regions.push(json!({"id":oid,"kind":okind,
                "cropPx":{"x":rect.x,"y":rect.y,"w":rect.w,"h":rect.h},
                "pixels":rect.w*rect.h}));
            r::fill_rect(&mut c, ox, oy, ox2 - ox, oy2 - oy, [ground[0] as f64, ground[1] as f64, ground[2] as f64, 255.0]);
        }
    }
    PlateReference { image:c, excluded_pixels:excluded.iter().filter(|v|**v).count(),
        total_pixels, excluded_regions, ignored_containers }
}

/// JS: platePrompt(spec, region).
pub fn plate_prompt(spec: &Value, region: &Value) -> String {
    plate_prompt_background(spec, region, false)
}

fn plate_prompt_background(spec: &Value, region: &Value, transparent: bool) -> String {
    let world = spec
        .get("palette")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .take(3)
                .filter_map(|c| c.get("hex").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join(", ")
        })
        .unwrap_or_default();
    let kind = region.get("kind").and_then(Value::as_str).unwrap_or("");
    let kind_line = match kind {
        "texture" => "This is a seamless surface texture. Output a tileable texture plate with no objects, no text, no vignette.",
        "image" => "This is a photographic or illustrated image region. Output the same subject, same framing, same lighting.",
        _ => "This is a designed illustration plate. Output the same drawing, same style, same line weight and shading.",
    };
    let note = region.get("note").and_then(Value::as_str).filter(|s| !s.is_empty());
    let mut parts = vec![
        "Use the provided crop as the approved visual reference and recreate it as a clean production asset at the target aspect ratio.".to_string(),
        kind_line.to_string(),
        format!("Preserve silhouette, composition, perspective, palette ({world}), lighting, material, and texture exactly."),
        "Remove every piece of UI text, label, caption, button, and interface chrome that is not part of the artwork itself.".to_string(),
        if transparent {
            "Remove interface borders, card corners, and layout backgrounds; retain only shadows that belong to the referenced object itself.".to_string()
        } else {
            "Remove letterboxing, borders, card corners, drop shadows, and any layout background that the page will draw in code.".to_string()
        },
        if transparent {
            "Do not add objects, change the concept, or restyle. Preserve the reference's placement, scale, and clear margins exactly; do not enlarge the subject to fill the frame. Remove the page ground and interior gaps to genuine transparent alpha. Keep white paint and other solid foreground colors opaque, preserve fine edges, and retain partial alpha only for genuinely translucent material or soft shadows in the reference. No chroma background, baked-in checkerboard, or matte. Output a transparent PNG cutout.".to_string()
        } else {
            "Do not add objects. Do not change the concept. Do not restyle. The artwork fills the whole frame edge to edge at the same scale as the reference; no margins, no border, no background band.".to_string()
        },
    ];
    if let Some(n) = note {
        parts.push(format!("Region: {n}."));
    }
    parts.join(" ")
}

/// JS: printSpec(spec).
pub fn print_spec(spec: &Value) -> String {
    let mut lines: Vec<String> = Vec::new();
    let comp = spec.get("comp").and_then(Value::as_str).unwrap_or("");
    let cw = spec.pointer("/compSize/width").and_then(Value::as_i64).unwrap_or(0);
    let cha = spec.pointer("/compSize/height").and_then(Value::as_i64).unwrap_or(0);
    let orient = spec.get("orientation").and_then(Value::as_str).unwrap_or("");
    lines.push(format!("SPEC comp {comp} {cw}x{cha} {orient}"));
    let palette = spec.get("palette").and_then(Value::as_array).cloned().unwrap_or_default();
    lines.push(format!(
        "PALETTE {}",
        palette
            .iter()
            .map(|c| {
                let hex = c.get("hex").and_then(Value::as_str).unwrap_or("");
                let cov = c.get("coverage").and_then(Value::as_f64).unwrap_or(0.0);
                format!("{hex}({}%)", round(cov * 100.0) as i64)
            })
            .collect::<Vec<_>>()
            .join(" ")
    ));
    let bands = spec.get("bands").and_then(Value::as_array).cloned().unwrap_or_default();
    let bands_str = bands
        .iter()
        .map(|b| format!("{}%", round(b.get("y").and_then(Value::as_f64).unwrap_or(0.0) * 100.0) as i64))
        .collect::<Vec<_>>()
        .join(" ");
    lines.push(format!("BANDS {}", if bands_str.is_empty() { "none".to_string() } else { bands_str }));
    let regions = spec.get("regions").and_then(Value::as_array).cloned().unwrap_or_default();
    for r in &regions {
        let id = r.get("id").and_then(Value::as_str).unwrap_or("");
        let kind = r.get("kind").and_then(Value::as_str).unwrap_or("");
        let medium = r.get("medium").and_then(Value::as_str).unwrap_or("");
        let bx = r.pointer("/box/x").and_then(Value::as_f64).unwrap_or(0.0);
        let by = r.pointer("/box/y").and_then(Value::as_f64).unwrap_or(0.0);
        let bw = r.pointer("/box/w").and_then(Value::as_f64).unwrap_or(0.0);
        let bh = r.pointer("/box/h").and_then(Value::as_f64).unwrap_or(0.0);
        let pw = r.pointer("/px/w").and_then(Value::as_i64).unwrap_or(0);
        let ph = r.pointer("/px/h").and_then(Value::as_i64).unwrap_or(0);
        let aspect = r.get("aspect").and_then(Value::as_f64).unwrap_or(0.0);
        let pal = r
            .get("palette")
            .and_then(Value::as_array)
            .map(|a| a.iter().take(3).filter_map(|c| c.get("hex").and_then(Value::as_str)).collect::<Vec<_>>().join(" "))
            .unwrap_or_default();
        let plate = r.get("plate").and_then(Value::as_str);
        let note = r.get("note").and_then(Value::as_str);
        lines.push(format!(
            "REGION {} {} {} box x{}% y{}% w{}% h{}% ({}x{}px, {}:1) palette {}{}{}",
            util::pad_end(id, 18),
            util::pad_end(kind, 8),
            util::pad_end(medium, 8),
            round(bx * 100.0) as i64,
            round(by * 100.0) as i64,
            round(bw * 100.0) as i64,
            round(bh * 100.0) as i64,
            pw,
            ph,
            fmt_num(aspect),
            pal,
            plate.map(|p| format!(" plate {p}")).unwrap_or_default(),
            note.map(|n| format!("  # {n}")).unwrap_or_default()
        ));
    }
    for r in &regions {
        for f in r["flags"].as_array().into_iter().flatten() {
            let advice = if f["id"] == "painted-pixels" { " If it shows an illustration, photograph or texture, make it a plate, image or texture region; the plan review asks the user either way." } else { "" };
            lines.push(format!("FLAG {} {}: {}{advice}", r["id"].as_str().unwrap_or(""), f["id"].as_str().unwrap_or(""), f["message"].as_str().unwrap_or("")));
        }
    }
    let plates: Vec<&Value> = regions.iter().filter(|r| r.get("medium").and_then(Value::as_str) == Some("raster")).collect();
    let plate_ids = plates.iter().filter_map(|r| r.get("id").and_then(Value::as_str)).collect::<Vec<_>>().join(", ");
    lines.push(format!("PLATES {} to produce: {}", plates.len(), if plate_ids.is_empty() { "none".to_string() } else { plate_ids }));
    for wln in spec.get("warnings").and_then(Value::as_array).cloned().unwrap_or_default() {
        if let Some(s) = wln.as_str() {
            lines.push(format!("WARN {s}"));
        }
    }
    lines.push("RULE anything not in this list does not exist on the page: no borders, rules, chrome, or containers the comp does not show. Every raster region ships as its plate, never as CSS.".into());
    lines.join("\n")
}

/// JS number in a template literal (`${r.aspect}`): integers bare, else shortest.
fn fmt_num(v: f64) -> String {
    match num(v) {
        Value::Number(n) => n.to_string(),
        _ => "null".to_string(),
    }
}

fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().map(|f| f != 0.0 && !f.is_nan()).unwrap_or(false),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

fn join_path(a: &str, b: &str) -> String {
    Path::new(a).join(b).to_string_lossy().replace('\\', "/")
}

/// JS: loadSpec(specPath).
pub fn load_spec(path: &Path) -> Option<Value> {
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn resolve(io: &Io, p: &str) -> PathBuf {
    let path = Path::new(p);
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        io.cwd.join(path)
    }
}

// ---- CLI -------------------------------------------------------------------

/// `impeccable comp-spec ...`
/// A failed edit leaves the last valid measurements intact, but they cannot
/// authorize a build against different source geometry.
pub fn region_source_issue(io: &Io, spec: &Value) -> Option<String> {
    let source = spec.get("regionsSource")?;
    let Some(path) = source["path"].as_str() else {
        return Some("spec has invalid region source evidence; re-run comp-spec --regions".into());
    };
    let current = std::fs::read(resolve(io,path)).ok()
        .map(|bytes| format!("{:x}",Sha256::digest(&bytes)));
    if current.as_deref().is_some_and(|hash| Some(hash) == source["sha256"].as_str()) { return None; }
    Some(format!("region source {path} changed or is missing since measurement; fix it and re-run comp-spec --regions {path} before continuing"))
}

pub fn run(argv: &[String], io: &mut Io) -> i32 {
    let spec_path = arg_or(argv, "spec", SPEC_PATH).to_string();
    if flag(argv, "schema") {
        io.out(include_str!("region-map.schema.json"));
        return 0;
    }
    if flag(argv, "help") || argv.is_empty() {
        io.out("MAP WORKFLOW: open --grid, author regions.json, run --regions regions.json --inspect-map, inspect its crops, then correct the map. Stop here for a mapping-only task.\nSCHEMA: comp-spec --schema lists required fields, coordinates, parentId and reviewGroup. Default inspection output is concise; --json prints the full report.\n");
        io.out("REGION COORDINATES: use one of grid (coarse inclusive cells), box {x,y,w,h} (fractions of the comp, 0..1), or pixelBox {x,y,w,h} (whole pixels in the original comp). Use exact bounds when an element ends inside a grid cell; do not include neighbouring content.\n");
        io.out("usage: comp-spec.mjs --comp <png> --grid            write .impeccable/build/comp-grid.png (10x10 labeled grid) + palette + bands\n       comp-spec.mjs --comp <png> --regions <json>  measure regions -> .impeccable/build/spec.json\n         regions json: { \"regions\": [ { \"id\": \"art\", \"kind\": \"plate|image|texture|text|control|chrome\", \"grid\": \"E0:J4\", \"note\": \"...\" } ] }\n       comp-spec.mjs --comp <png> --auto [--out f]  write a band draft; refine into elements before --regions\n       comp-spec.mjs --comp <png> --regions <json> --inspect-map [--out-dir dir] [--json]  inspect all crops and masks without writing a spec\n       comp-spec.mjs --print                        the compact spec\n       comp-spec.mjs --crop <id> [--out f] [--scale n]   reference crop of a region (never a shipping asset)\n       comp-spec.mjs --plate-prompt <id> [--background transparent|opaque|auto]  the regeneration prompt for a raster region\n");
        return 0;
    }
    if flag(argv, "print") {
        let Some(spec) = load_spec(&resolve(io, &spec_path)) else {
            io.err(&format!("comp-spec: no spec at {spec_path}; run with --comp <png> --regions <json> first\n"));
            return 1;
        };
        io.out(&format!("{}\n", print_spec(&spec)));
        return 0;
    }
    if let Some(id) = arg(argv, "plate-prompt") {
        let background = arg(argv, "background");
        if flag(argv, "background") && !matches!(background, Some("transparent" | "opaque" | "auto")) {
            io.err("comp-spec: --background must be transparent, opaque, or auto.\n");
            return 1;
        }
        let Some(spec) = load_spec(&resolve(io, &spec_path)) else {
            io.err(&format!("comp-spec: no spec at {spec_path}\n"));
            return 1;
        };
        let region = spec.get("regions").and_then(Value::as_array).and_then(|a| a.iter().find(|r| r.get("id").and_then(Value::as_str) == Some(id)));
        let Some(region) = region else {
            io.err(&format!("comp-spec: no region {id}\n"));
            return 1;
        };
        io.out(&format!("{}\n", plate_prompt_background(&spec, region, background == Some("transparent"))));
        return 0;
    }
    if let Some(id) = arg(argv, "crop") {
        let Some(spec) = load_spec(&resolve(io, &spec_path)) else {
            io.err(&format!("comp-spec: no spec at {spec_path}\n"));
            return 1;
        };
        let region = spec.get("regions").and_then(Value::as_array).and_then(|a| a.iter().find(|r| r.get("id").and_then(Value::as_str) == Some(id))).cloned();
        let Some(region) = region else {
            let ids = spec.get("regions").and_then(Value::as_array).map(|a| a.iter().filter_map(|r| r.get("id").and_then(Value::as_str)).collect::<Vec<_>>().join(", ")).unwrap_or_default();
            io.err(&format!("comp-spec: no region {id}; ids: {ids}\n"));
            return 1;
        };
        let comp_file = spec.get("comp").and_then(Value::as_str).unwrap_or("");
        let comp = match png_io::load_raster(&resolve(io, comp_file)) {
            Ok((d, _)) => d.image,
            Err(e) => {
                io.err(&format!("comp-spec: cannot read {comp_file}: {e}\n"));
                return 1;
            }
        };
        let medium = region.get("medium").and_then(Value::as_str).unwrap_or("");
        let mut reference_audit = None;
        let mut c = if medium == "raster" && !flag(argv, "raw") {
            let reference = prepare_plate_reference(&comp, &spec, &region);
            if let Some(issue) = reference.issue(id) {
                io.err(&format!("comp-spec: {issue}.\n"));
                return 2;
            }
            reference_audit = Some(reference.audit());
            reference.image
        } else {
            let px = |k: &str| region.pointer(&format!("/px/{k}")).and_then(Value::as_f64).unwrap_or(0.0);
            r::crop(&comp, px("x"), px("y"), px("w"), px("h"))
        };
        let scale = util::parse_f64(arg_or(argv, "scale", "1"), 1.0);
        if scale > 1.0 {
            c = r::resize(&c, c.width as f64 * scale, c.height as f64 * scale);
        }
        let default_out = join_path(&join_path(BUILD_DIR, "crops"), &format!("{id}.png"));
        let out = arg_or(argv, "out", &default_out).to_string();
        let out_path = resolve(io, &out);
        if let Some(parent) = out_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let mut text = vec![("impeccable:crop-of".to_string(), format!("{comp_file}#{id}"))];
        if let Some(audit) = reference_audit {
            text.push(("impeccable:reference-audit".into(), audit.to_string()));
        }
        match png_io::encode_png(&c, &text) {
            Ok(bytes) => {
                let _ = std::fs::write(&out_path, bytes);
            }
            Err(e) => {
                io.err(&format!("comp-spec: {e}\n"));
                return 1;
            }
        }
        io.out(&format!("CROP {out} ({}x{}) region {id} of {comp_file}. Reference only: regenerate the plate from it, never ship it.\n", c.width, c.height));
        return 0;
    }

    let comp_path = arg(argv, "comp");
    let Some(comp_path) = comp_path else {
        io.err("usage: comp-spec.mjs --comp <png> (--grid | --regions <json> | --auto) [--spec out.json]\n       comp-spec.mjs --print | --crop <id> [--out file] [--scale n] | --plate-prompt <id>\n");
        return 1;
    };
    let comp = match png_io::load_raster(&resolve(io, comp_path)) {
        Ok((d, _)) => d.image,
        Err(e) => {
            io.err(&format!("comp-spec: cannot read {comp_path}: {e}\n"));
            return 1;
        }
    };

    if flag(argv, "inspect-map") {
        return crate::map_inspection::run(argv, io, &comp, comp_path);
    }

    if flag(argv, "grid") {
        let grid_out = resolve(io, GRID_PATH);
        if let Some(parent) = grid_out.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        match png_io::encode_png(&render_grid(&comp), &[]) {
            Ok(bytes) => {
                let _ = std::fs::write(&grid_out, bytes);
            }
            Err(e) => {
                io.err(&format!("comp-spec: {e}\n"));
                return 1;
            }
        }
        io.out(&format!("GRID {GRID_PATH} ({}x{} comp; cells A0 top-left to J9 bottom-right)\n", comp.width, comp.height));
        io.out(&format!(
            "PALETTE {}\n",
            palette_of(&comp)
                .iter()
                .map(|c| format!("{}({}%)", c.hex, round(c.coverage * 100.0) as i64))
                .collect::<Vec<_>>()
                .join(" ")
        ));
        let bands_str = m::horizontal_bands(&comp, 128, 0.02)
            .into_iter()
            .filter(|b| b.strength > 0.2)
            .map(|b| format!("{}%", round(b.y * 100.0) as i64))
            .collect::<Vec<_>>()
            .join(" ");
        io.out(&format!("BANDS {}\n", if bands_str.is_empty() { "none".to_string() } else { bands_str }));
        io.out("NEXT open the grid image, then write regions.json in exactly this shape and run --regions regions.json:\n");
        io.out("  { \"regions\": [ { \"id\": \"exploded-plate\", \"kind\": \"plate\", \"grid\": \"E0:H4\", \"note\": \"exploded carburetor drawing\" }, { \"id\": \"masthead\", \"kind\": \"chrome\", \"grid\": \"A0:J0\", \"note\": \"navy bar\" } ] }\n");
        io.out("  kind: plate | image | texture (painted material: every illustration, photograph, figure, product object, texture; each ships as a raster plate) or text | control | chrome (code draws it). grid: <colrow>:<colrow>, A0 top-left to J9 bottom-right, inclusive.\n");
        io.out("  A texture region is a clean sample cell of the material (ground with no ink on it), not the whole band it covers; the page tiles it. Ink that sits on the material gets its own text/control region.\n");
        io.out("  For exact edges, replace grid with pixelBox: {\"x\": <left>, \"y\": <top>, \"w\": <width>, \"h\": <height>} in original comp pixels, or box with fractions 0..1. Grid cells are approximate; an asset crop must not include the next section. comp-spec --help lists the command forms.\n");
        return 0;
    }

    if flag(argv,"auto") && arg(argv,"regions").is_none() {
        if flag(argv,"spec") {
            io.err("comp-spec: --auto writes a draft, not a measured spec; use --out <draft.json> instead of --spec\n");
            return 1;
        }
        let draft_path = arg_or(argv,"out",".impeccable/build/regions.draft.json");
        let dest = resolve(io,draft_path);
        if dest == resolve(io,SPEC_PATH) {
            io.err("comp-spec: an automatic draft cannot replace the measured spec\n");
            return 1;
        }
        let mut draft = auto_regions(&comp);
        draft["draft"] = json!(true);
        draft["comp"] = json!(comp_path);
        if let Some(parent) = dest.parent() { let _ = std::fs::create_dir_all(parent); }
        use std::io::Write;
        let written = std::fs::OpenOptions::new().write(true).create_new(true).open(&dest)
            .and_then(|mut file| file.write_all(util::json_pretty(&draft).as_bytes()));
        if let Err(error) = written {
            io.err(&format!("comp-spec: cannot write draft {draft_path}: {error}; use a new --out path to preserve existing work\n"));
            return 1;
        }
        io.out(&format!("DRAFT {draft_path}: {} approximate horizontal bands, not an element map.\nRefine the bands into the visible elements, remove the draft flag, then run comp-spec --comp {comp_path} --regions {draft_path}. The measured spec and build state are unchanged.\n",draft["regions"].as_array().map_or(0,Vec::len)));
        return 0;
    }
    let regions_source;
    let regions_input: Value = if let Some(rf) = arg(argv, "regions") {
        match std::fs::read_to_string(resolve(io, rf)) {
            Ok(raw) => match serde_json::from_str(&raw) {
                Ok(v) => {
                    regions_source = json!({"path":rf,"sha256":format!("{:x}",Sha256::digest(raw.as_bytes()))});
                    v
                },
                Err(e) => {
                    io.err(&format!("comp-spec: cannot read regions {rf}: {e}\n"));
                    return 1;
                }
            },
            Err(e) => {
                io.err(&format!("comp-spec: cannot read regions {rf}: {e}\n"));
                return 1;
            }
        }
    } else {
        io.err("comp-spec: pass --grid to get the coordinate grid, then --regions <json> (or --auto for band regions)\n");
        return 1;
    };
    if regions_input["draft"] == true {
        io.err("comp-spec: this is an automatic draft, not a measured element map; refine its bands into the visible elements before removing the draft flag\n");
        return 1;
    }
    let group_issues = impeccable_comp::review_groups::issues(regions_input["regions"].as_array().unwrap_or(&Vec::new()));
    if !group_issues.is_empty() {
        for (id, message) in group_issues { io.err(&format!("comp-spec: region {id}: {message}\n")); }
        return 1;
    }
    let mut spec = match measure_regions(&comp, &regions_input, comp_path) {
        Ok(s) => s,
        Err(e) => {
            io.err(&format!("comp-spec: {e}\n"));
            return 1;
        }
    };
    let spec_out = resolve(io, &spec_path);
    // Bind cached font evidence to the decoded reference, including dimensions.
    // Legacy specs without this identity are deliberately remeasured once.
    let mut hasher = Sha256::new();
    hasher.update(comp.width.to_le_bytes());
    hasher.update(comp.height.to_le_bytes());
    hasher.update(&comp.data);
    spec["compSha256"] = json!(format!("{:x}", hasher.finalize()));
    spec["regionsSource"] = regions_source;
    if let Some(previous) = std::fs::read(&spec_out).ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok()) {
        preserve_typography(&mut spec, &previous);
    }
    if let Some(parent) = spec_out.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(&spec_out, util::json_pretty(&spec));
    io.out(&format!("WROTE {spec_path}\n"));
    io.out(&format!("{}\n", print_spec(&spec)));
    let _ = r4f(0.0); // silence unused if optimized away
    0
}

/// Remeasuring an unrelated region must not erase measured font work. Reuse
/// only the existing spec's evidence, never a `type` claim in the input file.
fn preserve_typography(spec: &mut Value, previous: &Value) {
    if !spec["compSha256"].is_string() || spec["compSha256"] != previous["compSha256"] {
        return;
    }
    let Some(old_regions) = previous["regions"].as_array() else { return; };
    let Some(regions) = spec["regions"].as_array_mut() else { return; };
    for region in regions {
        if !matches!(region["kind"].as_str(), Some("text" | "control")) { continue; }
        let Some(old) = old_regions.iter().find(|old| old["id"] == region["id"]) else { continue; };
        if ["kind", "medium", "box", "px", "text"].iter().all(|key| old[*key] == region[*key]) {
            if let Some(ty) = old.get("type").filter(|ty| ty.is_object()) {
                region["type"] = ty.clone();
            }
        }
    }
}

#[cfg(test)]
mod reference_tests {
    use super::*;
    #[test]
    fn mapping_schema_is_available_without_a_comp_or_workspace() {
        let schema: Value = serde_json::from_str(include_str!("region-map.schema.json")).unwrap();
        assert_eq!(schema["properties"]["regions"]["items"]["required"], json!(["id","kind","note"]));
        assert_eq!(schema["properties"]["regions"]["items"]["oneOf"].as_array().unwrap().len(),3);
        let mut io = Io::stdio();
        io.cwd = std::path::PathBuf::from("/nonexistent/map-schema-test");
        io.stdout = Box::new(Vec::<u8>::new());
        assert_eq!(run(&["--schema".into()], &mut io),0);
    }


    #[test]
    fn automatic_snap_preserves_separated_navigation_and_multiline_copy() {
        let mut comp = r::create_image(300, 100, [255,255,255,255]);
        r::fill_rect(&mut comp, 25., 30., 70., 12., [0.,0.,0.,255.]);
        r::fill_rect(&mut comp, 185., 30., 45., 12., [0.,0.,0.,255.]);
        assert!(snap_box_to_ink(&comp, (0.,0.,1.,1.), 255.).is_some());
        assert!(snap_preserving_ink(&comp, (0.,0.,1.,1.), 255.).is_none());
        let mut single = r::create_image(300, 100, [255,255,255,255]);
        r::fill_rect(&mut single, 25., 30., 70., 12., [0.,0.,0.,255.]);
        assert!(snap_preserving_ink(&single, (0.,0.,1.,1.), 255.).is_some());
    }

    fn fixture() -> (Image, Value) {
        let mut comp = r::create_image(16, 16, [230, 220, 210, 255]);
        r::fill_rect(&mut comp, 4., 4., 8., 8., [30., 70., 110., 255.]);
        let region = json!({"id":"art","kind":"plate","medium":"raster",
            "px":{"x":0,"y":0,"w":16,"h":16},"palette":[{"hex":"#e6dcd2"}]});
        (comp, region)
    }

    #[test]
    fn exact_pixel_box_excludes_the_neighbouring_section() {
        let mut comp = r::create_image(301, 101, [20, 70, 110, 255]);
        r::fill_rect(&mut comp, 0., 61., 301., 40., [240., 180., 10., 255.]);
        let input = json!({"allowUncovered":true,"regions":[{"id":"photo","kind":"image",
            "note":"Wide photograph","bleed":true,"pixelBox":{"x":0,"y":0,"w":301,"h":61}}]});
        let spec = measure_regions(&comp, &input, "comp.png").unwrap();
        assert_eq!(spec["regions"][0]["px"], json!({"x":0,"y":0,"w":301,"h":61}));
        let reference = prepare_plate_reference(&comp, &spec, &spec["regions"][0]);
        assert_eq!((reference.image.width, reference.image.height), (301, 61));
        assert!(reference.image.data.chunks_exact(4).all(|px| px == [20,70,110,255]));
        for bad in [json!({"x":0,"y":0,"w":302,"h":61}), json!({"x":0.5,"y":0,"w":300,"h":61}),
            json!({"x":0,"y":0,"w":0,"h":61}), json!({"x":0,"y":0,"w":301})] {
            let mut broken = input.clone();
            broken["regions"][0]["pixelBox"] = bad;
            assert!(measure_regions(&comp, &broken, "comp.png").unwrap_err().contains("pixelBox"));
        }
        let mut ambiguous = input;
        ambiguous["regions"][0]["grid"] = json!("A0:J5");
        assert!(measure_regions(&comp, &ambiguous, "comp.png").unwrap_err().contains("multiple"));
    }

    #[test]
    fn container_background_preserves_art_but_foreground_control_still_masks() {
        let (comp, region) = fixture();
        let container = json!({"id":"background","kind":"chrome","container":true,
            "px":{"x":0,"y":0,"w":16,"h":16}});
        let spec = json!({"regions":[region,container]});
        assert_eq!(plate_reference(&comp, &spec, &spec["regions"][0]).data, comp.data);
        let mut spec = spec;
        spec["regions"].as_array_mut().unwrap().push(json!({"id":"button","kind":"control",
            "px":{"x":0,"y":0,"w":8,"h":8}}));
        let mut expected = comp.clone();
        r::fill_rect(&mut expected, 0., 0., 8., 8., [230.,220.,210.,255.]);
        assert_eq!(plate_reference(&comp, &spec, &spec["regions"][0]).data, expected.data);
    }

    #[test]
    fn exclusion_audit_counts_union_and_clips_to_crop() {
        let (comp, region) = fixture();
        let spec = json!({"regions":[region,
            {"id":"left","kind":"text","px":{"x":-8,"y":0,"w":20,"h":16}},
            {"id":"right","kind":"control","px":{"x":8,"y":0,"w":20,"h":16}}]});
        let reference = prepare_plate_reference(&comp, &spec, &spec["regions"][0]);
        assert_eq!(reference.excluded_pixels, 256);
        assert_eq!(reference.excluded_regions[0]["pixels"], 192);
        assert_eq!(reference.excluded_regions[1]["pixels"], 128);
        assert!(reference.fully_excluded());
        assert_eq!(reference.audit()["remainingPixels"], 0);
        assert!(reference.issue("art").unwrap().contains("left, right"));
    }

    #[test]
    fn uniform_reference_without_exclusions_is_not_an_exclusion_failure() {
        let (_, region) = fixture();
        let comp = r::create_image(16, 16, [230, 220, 210, 255]);
        let spec = json!({"regions":[region]});
        let reference = prepare_plate_reference(&comp, &spec, &spec["regions"][0]);
        assert_eq!(reference.excluded_pixels, 0);
        assert!(!reference.fully_excluded());
        assert!(reference.issue("art").is_none());
    }

    /// Deterministic noise so the synthetic crops carry comp-like grain.
    fn grain(seed: &mut u64) -> f64 { *seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407); ((*seed >> 33) % 13) as f64 - 6. }

    fn text_like(ground: [f64; 3], ink: [f64; 3]) -> Image {
        let mut img = r::create_image(240, 80, [0, 0, 0, 255]);
        let mut seed = 7;
        for y in 0..80 { for x in 0..240 {
            // Glyph-ish strokes with a one-pixel antialiased ramp on each side.
            let t = match (x % 9, (y / 20) % 2 == 0 && y % 20 > 4 && y % 20 < 16) { (3 | 4, true) => 1., (2 | 5, true) => 0.5, _ => 0. };
            let i = (y * 240 + x) * 4;
            for k in 0..3 { img.data[i + k] = (ground[k] + (ink[k] - ground[k]) * t + grain(&mut seed)).clamp(0., 255.) as u8; }
        }}
        img
    }

    #[test]
    fn flat_type_on_grained_ground_does_not_read_painted() {
        for (ground, ink) in [([236., 229., 214.], [40., 36., 30.]), ([34., 38., 44.], [235., 235., 230.]), ([226., 160., 60.], [30., 70., 45.])] {
            let p = painted_pixels(&text_like(ground, ink), &|_, _| false).unwrap();
            assert!(!reads_painted(&p), "{p:?}");
        }
    }

    #[test]
    fn continuous_tone_crop_reads_painted_and_is_flagged_on_a_code_region() {
        // A shaded, multi-hue surface: what a photograph or rendered figure looks like.
        let mut comp = r::create_image(240, 160, [0, 0, 0, 255]);
        let mut seed = 11;
        for y in 0..160 { for x in 0..240 {
            let (fx, fy) = (x as f64 / 240., y as f64 / 160.);
            let i = (y * 240 + x) * 4;
            let rgb = [60. + 180. * fx * (1. - 0.5 * fy), 40. + 150. * (fy * 3.1).sin().abs(), 50. + 170. * ((fx + fy) * 2.3).cos().abs()];
            for k in 0..3 { comp.data[i + k] = (rgb[k] + grain(&mut seed)).clamp(0., 255.) as u8; }
        }}
        let p = painted_pixels(&comp, &|_, _| false).unwrap();
        assert!(reads_painted(&p), "{p:?}");
        let input = json!({"allowUncovered": true, "regions": [
            {"id": "figure", "kind": "chrome", "note": "decorative panel", "container": true, "pixelBox": {"x": 0, "y": 0, "w": 120, "h": 160}},
            {"id": "art", "kind": "plate", "note": "the same surface as art", "pixelBox": {"x": 120, "y": 0, "w": 120, "h": 160}}]});
        let spec = measure_regions(&comp, &input, "comp.png").unwrap();
        assert_eq!(spec["regions"][0]["flags"][0]["id"], "painted-pixels");
        assert!(spec["regions"][1].get("flags").is_none(), "raster regions are never flagged");
        assert!(print_spec(&spec).contains("FLAG figure painted-pixels: Looks painted: ") && print_spec(&spec).contains("make it a plate, image or texture region"));
        assert!(!spec["regions"][0]["flags"][0]["message"].as_str().unwrap().contains("make it"), "the stored message is an observation for the reviewer");
        // A code region wholly covered by a raster region has no pixels of its own to judge.
        let covered = json!({"allowUncovered": true, "regions": [
            {"id": "caption", "kind": "text", "note": "caption over the art", "pixelBox": {"x": 20, "y": 20, "w": 80, "h": 60}},
            {"id": "art", "kind": "image", "note": "full photograph", "pixelBox": {"x": 0, "y": 0, "w": 240, "h": 160}}]});
        assert!(measure_regions(&comp, &covered, "comp.png").unwrap()["regions"][0].get("flags").is_none());
    }

    fn paint(comp: &mut Image, x0: usize, y0: usize, w: usize, h: usize, seed: &mut u64) {
        for y in y0..y0 + h { for x in x0..x0 + w {
            let (fx, fy) = ((x - x0) as f64 / w as f64, (y - y0) as f64 / h as f64);
            let i = (y * comp.width + x) * 4;
            let rgb = [60. + 180. * fx * (1. - 0.5 * fy), 40. + 150. * (fy * 3.1).sin().abs(), 50. + 170. * ((fx + fy) * 2.3).cos().abs()];
            for k in 0..3 { comp.data[i + k] = (rgb[k] + grain(seed)).clamp(0., 255.) as u8; }
        }}
    }

    #[test]
    fn a_painted_patch_reads_the_same_in_a_tight_box_and_a_generous_one() {
        // Type on paper with a painted sprig at the left, like foliage over a nav bar.
        let mut comp = text_like([236., 229., 214.], [40., 36., 30.]);
        let mut wide = r::create_image(640, 80, [0, 0, 0, 255]);
        for y in 0..80 { for x in 0..640 { let (i, j) = ((y * 640 + x) * 4, (y * 240 + x % 240) * 4); wide.data[i..i + 4].copy_from_slice(&comp.data[j..j + 4]); } }
        let mut seed = 5;
        paint(&mut wide, 0, 8, 72, 64, &mut seed);
        comp = wide;
        let readings: Vec<PaintedPixels> = [120, 240, 400, 640].iter().map(|&w| painted_pixels(&r::crop(&comp, 0., 0., w as f64, 80.), &|_, _| false).unwrap()).collect();
        assert!(readings.iter().all(reads_painted), "{readings:?}");
        assert!(readings.windows(2).all(|p| p[0] == p[1]), "the strongest window is the same window: {readings:?}");
        assert!(!reads_painted(&painted_pixels(&r::crop(&comp, 120., 0., 520., 80.), &|_, _| false).unwrap()), "type alone stays code");
    }

    #[test]
    fn containers_flag_on_unmapped_painted_material_between_their_raster_children() {
        let mut comp = r::create_image(480, 200, [236, 229, 214, 255]);
        let mut seed = 9;
        paint(&mut comp, 20, 20, 140, 160, &mut seed);
        paint(&mut comp, 300, 20, 140, 160, &mut seed);
        let map = |mapped_both: bool| {
            let mut regions = vec![json!({"id": "grid", "kind": "control", "container": true, "note": "grid of room cards", "pixelBox": {"x": 0, "y": 0, "w": 480, "h": 200}}),
                json!({"id": "photo-a", "kind": "image", "note": "room photograph", "pixelBox": {"x": 20, "y": 20, "w": 140, "h": 160}})];
            if mapped_both { regions.push(json!({"id": "photo-b", "kind": "image", "note": "room photograph", "pixelBox": {"x": 300, "y": 20, "w": 140, "h": 160}})); }
            measure_regions(&comp, &json!({"allowUncovered": true, "regions": regions}), "comp.png").unwrap()
        };
        assert_eq!(map(false)["regions"][0]["flags"][0]["id"], "painted-pixels", "the second photograph is in no raster region");
        assert!(map(true)["regions"][0].get("flags").is_none(), "every painted pixel belongs to a plate");
    }

    #[test]
    fn surface_separates_grounds_and_rules_from_marks() {
        let ground = [30, 50, 80, 255];
        let mut comp = r::create_image(800, 240, ground);
        r::fill_rect(&mut comp, 10., 10., 300., 2., [200., 170., 90., 255.]); // a hairline rule
        r::fill_rect(&mut comp, 40., 40., 120., 14., [240., 240., 240., 255.]); // a text child on the ground
        for a in 0..360 { // a ring mark with a dot: curves, not rules
            let t = a as f64 * std::f64::consts::PI / 180.;
            r::fill_rect(&mut comp, (340. + 20. * t.cos()).round(), (80. + 20. * t.sin()).round(), 2., 2., [200., 170., 90., 255.]);
        }
        r::fill_rect(&mut comp, 337., 77., 6., 6., [200., 170., 90., 255.]);
        let input = json!({"allowUncovered": true, "regions": [
            {"id": "rule", "kind": "chrome", "note": "brass hairline rule", "pixelBox": {"x": 5, "y": 4, "w": 310, "h": 14}},
            {"id": "panel", "kind": "chrome", "note": "blue panel ground", "pixelBox": {"x": 20, "y": 30, "w": 280, "h": 80}},
            {"id": "label", "kind": "text", "note": "white label text", "pixelBox": {"x": 38, "y": 38, "w": 124, "h": 18}},
            {"id": "mark", "kind": "chrome", "note": "brass ring mark", "pixelBox": {"x": 312, "y": 52, "w": 56, "h": 56}},
            {"id": "tick", "kind": "chrome", "note": "short tick", "pixelBox": {"x": 320, "y": 10, "w": 40, "h": 5}}]});
        let spec = measure_regions(&comp, &input, "comp.png").unwrap();
        let surface = |i: usize| (spec["regions"][i]["surface"]["flat"] == true, spec["regions"][i]["surface"]["rules"] == true);
        assert_eq!(surface(0), (false, true), "a hairline rule");
        assert_eq!(surface(1), (true, false), "the panel's own pixels are bare ground once its label is set aside");
        assert_eq!(surface(3), (false, false), "a mark is neither");
        assert_eq!(surface(4).1, true, "a box under 6px is a rule");
    }
}
