//! JS: skill/scripts/lib/hero-checks.mjs (plus `inkBox`, which lives in the
//! comp-diff orchestrator but is a pure function these checks depend on).
//!
//! Hero-gate checks that name a comp/build miss as a number. Pure over decoded
//! rasters and the spec. Results are shaped as `serde_json::Value` matching the
//! JS return objects so the parity harness can compare them directly.

use crate::font_fingerprint::{fingerprint, FpOpts};
use crate::jsnum::{round, round_fixed, to_fixed};
use crate::metrics::{delta_e, detail_grid, dominant_colors, to_gray, DominantColor};
use crate::raster::Image;
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::{json, Value};

/// Number -> string the way JS interpolates a `Number` (shortest round-trip;
/// integer-valued floats print without a decimal, as in both JS and Rust).
fn n(v: f64) -> String {
    format!("{v}")
}

#[derive(Clone, Copy)]
pub struct InkBox {
    pub x: i64,
    pub y: i64,
    pub w: i64,
    pub h: i64,
}

impl InkBox {
    fn to_value(self) -> Value {
        json!({ "x": self.x, "y": self.y, "w": self.w, "h": self.h })
    }
}

/// JS: inkBox(img). Bounding box of ink (|gray - ground| > 48).
pub fn ink_box(img: &Image) -> Option<InkBox> {
    let g = to_gray(img);
    let len = g.data.len();
    let step = (len / 4000).max(1);
    let mut sample: Vec<f64> = Vec::new();
    let mut i = 0;
    while i < len {
        sample.push(g.data[i] as f64);
        i += step;
    }
    sample.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let mid = sample.len() / 2;
    let ground = match sample.get(mid) {
        Some(&v) if v != 0.0 => v,
        _ => 255.0,
    };
    let (w, h) = (img.width, img.height);
    let (mut x0, mut y0, mut x1, mut y1) = (w as i64, h as i64, -1i64, -1i64);
    for y in 0..h {
        for x in 0..w {
            if (g.data[y * w + x] as f64 - ground).abs() > 48.0 {
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
    Some(InkBox { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 })
}

/// JS: inkColor(img). Heaviest non-ground cluster.
pub struct InkColor {
    pub ground: DominantColor,
    pub ink: Option<DominantColor>,
}

pub fn ink_color(img: &Image) -> Option<InkColor> {
    let cols = dominant_colors(img, 4, 3);
    if cols.is_empty() {
        return None;
    }
    let ground = cols[0].clone();
    let ink = cols
        .iter()
        .enumerate()
        .find(|(i, c)| *i != 0 && delta_e(c.lab, ground.lab) > 20.0)
        .map(|(_, c)| c.clone());
    Some(InkColor { ground, ink })
}

/// A spec region (minimal: only the fields the pure checks read).
pub struct Region {
    pub id: String,
    pub kind: String,
    pub chosen: Option<Chosen>,
}

pub struct Chosen {
    pub family: String,
    pub weight: String,
    pub font_size_px: String,
}

/// JS: textRegionCheck(region, compCrop, buildCrop, {capTol, minCap}).
pub fn text_region_check(region: &Region, comp_crop: &Image, build_crop: &Image) -> Value {
    let cap_tol = 0.22;
    let min_cap = 10.0;
    let mut findings: Vec<String> = Vec::new();
    let comp = fingerprint(comp_crop, &FpOpts::default());

    let colour_only = |findings: &mut Vec<String>| -> Value {
        let ca = ink_color(comp_crop);
        let cb = ink_color(build_crop);
        if let (Some(ca), Some(cb)) = (&ca, &cb) {
            if let (Some(ci), Some(cbi)) = (&ca.ink, &cb.ink) {
                if delta_e(ci.lab, cbi.lab) > 22.0 {
                    findings.push(format!(
                        "text {}: ink is {} in the build, {} in the comp; use the comp's colour",
                        region.id, cbi.hex, ci.hex
                    ));
                }
            }
        }
        json!({ "findings": findings, "metrics": Value::Null })
    };

    let comp = match &comp {
        Some(c) if c.cap_height_px != 0.0 && c.cap_height_px >= min_cap && c.glyphs >= 6 => c,
        _ => return colour_only(&mut findings),
    };
    if comp.lines >= 5 && (comp.glyphs as f64 / comp.lines as f64) < 3.0 {
        return colour_only(&mut findings);
    }
    if comp.cap_height_px > comp_crop.height as f64 * 0.6 {
        return colour_only(&mut findings);
    }
    let bfp = fingerprint(build_crop, &FpOpts::default());
    let metrics_build = bfp.as_ref().map(|b| {
        json!({ "cap": b.cap_height_px, "lines": b.lines, "glyphs": b.glyphs })
    });
    let mut metrics = json!({
        "comp": { "cap": comp.cap_height_px, "lines": comp.lines, "glyphs": comp.glyphs },
        "build": metrics_build.clone().unwrap_or(Value::Null),
    });
    let bfp = match &bfp {
        Some(b) if b.glyphs >= 4 => b,
        _ => return json!({ "findings": findings, "metrics": metrics }),
    };
    let cap_delta = (bfp.cap_height_px - comp.cap_height_px) / comp.cap_height_px;
    if cap_delta.abs() > cap_tol {
        let chosen = region
            .chosen
            .as_ref()
            .map(|c| {
                format!(
                    " (font-match ranked {} {} at {}px)",
                    c.family, c.weight, c.font_size_px
                )
            })
            .unwrap_or_default();
        findings.push(format!(
            "text {}: cap height {}px in the build, {}px in the comp ({}{}%); set font-size so the cap height renders at {}px{}",
            region.id,
            n(bfp.cap_height_px),
            n(comp.cap_height_px),
            if cap_delta > 0.0 { "+" } else { "" },
            round(cap_delta * 100.0) as i64,
            n(comp.cap_height_px),
            chosen
        ));
    }
    if comp.lines >= 2 && bfp.lines != comp.lines && (bfp.lines as i64 - comp.lines as i64).abs() >= 1 {
        findings.push(format!(
            "text {}: {} line{} in the build, {} in the comp; the measure (max-width, font-size, letter-spacing) wraps it differently, so the block is a different shape",
            region.id,
            bfp.lines,
            if bfp.lines == 1 { "" } else { "s" },
            comp.lines
        ));
    } else if comp.lines >= 3 && bfp.lines == comp.lines && cap_delta.abs() <= cap_tol {
        if let (Some(ba0), Some(bb0)) = (ink_box(comp_crop), ink_box(build_crop)) {
            let pa = ba0.h as f64 / comp.lines as f64;
            let pb = bb0.h as f64 / bfp.lines as f64;
            let dp = (pb - pa) / pa;
            if dp.abs() > 0.2 {
                findings.push(format!(
                    "text {}: line pitch {}px in the build, {}px in the comp ({}{}%); set line-height so {} lines stand {}px tall",
                    region.id,
                    round(pb) as i64,
                    round(pa) as i64,
                    if dp > 0.0 { "+" } else { "" },
                    round(dp * 100.0) as i64,
                    comp.lines,
                    round(ba0.h as f64) as i64
                ));
            }
        }
    }
    if let (Some(cg), Some(bg)) = (comp.get("gap"), bfp.get("gap")) {
        if cap_delta.abs() <= cap_tol && comp.glyphs >= 8 && bfp.glyphs >= 8 {
            let dg = bg - cg;
            if dg.abs() > 0.03f64.max(cg * 0.5) {
                findings.push(format!(
                    "text {}: letter-spacing is {} than the comp's (gap {} vs {} of the cap height); set letter-spacing to {} it by about {}px",
                    region.id,
                    if dg > 0.0 { "wider" } else { "tighter" },
                    to_fixed(bg, 3),
                    to_fixed(cg, 3),
                    if dg > 0.0 { "close" } else { "open" },
                    (round(dg * comp.cap_height_px) as i64).abs()
                ));
            }
        }
    }
    if let (Some(cd), Some(bd)) = (comp.get("densTall"), bfp.get("densTall")) {
        if cap_delta.abs() <= cap_tol {
            let r = bd / cd;
            if r > 1.25 {
                findings.push(format!(
                    "text {}: the face renders {}% heavier than the comp's (ink density {} vs {}); drop a weight step or use the ranked face",
                    region.id,
                    round((r - 1.0) * 100.0) as i64,
                    to_fixed(bd, 2),
                    to_fixed(cd, 2)
                ));
            } else if r < 0.75 {
                findings.push(format!(
                    "text {}: the face renders {}% lighter than the comp's (ink density {} vs {}); raise a weight step or use the ranked face",
                    region.id,
                    round((1.0 - r) * 100.0) as i64,
                    to_fixed(bd, 2),
                    to_fixed(cd, 2)
                ));
            }
        }
    }
    if comp.cap_height_px >= 16.0 {
        if let (Some(ca), Some(cb)) = (ink_color(comp_crop), ink_color(build_crop)) {
            if let (Some(ci), Some(cbi)) = (&ca.ink, &cb.ink) {
                if delta_e(ci.lab, cbi.lab) > 22.0 {
                    findings.push(format!(
                        "text {}: ink is {} in the build, {} in the comp; use the comp's colour",
                        region.id, cbi.hex, ci.hex
                    ));
                }
            }
        }
    }
    if let (Some(ba), Some(bb)) = (ink_box(comp_crop), ink_box(build_crop)) {
        let dy = bb.y - ba.y;
        if (dy as f64).abs() > 12f64.max(comp_crop.height as f64 * 0.15) {
            findings.push(format!(
                "text {}: its first line starts {}px {} than in the comp ({}px vs {}px into the region box); the spacing above it is {}",
                region.id,
                (round(dy as f64) as i64).abs(),
                if dy > 0 { "lower" } else { "higher" },
                bb.y,
                ba.y,
                if dy > 0 { "too large" } else { "too small" }
            ));
        }
        let dx = bb.x - ba.x;
        if (dx as f64).abs() > 12f64.max(comp_crop.width as f64 * 0.15) {
            findings.push(format!(
                "text {}: it starts {}px {} than in the comp",
                region.id,
                (round(dx as f64) as i64).abs(),
                if dx > 0 { "further right" } else { "further left" }
            ));
        }
    }
    metrics["capDelta"] = json!(round_fixed(cap_delta, 3));
    json!({ "findings": findings, "metrics": metrics })
}

/// JS: ruleRows(img, {span=0.5, step=28}).
pub fn rule_rows(img: &Image, span: f64, step: f64) -> Vec<usize> {
    let (w, h) = (img.width, img.height);
    let gray = |x: usize, y: usize| -> f64 {
        let i = (y * w + x) * 4;
        0.299 * img.data[i] as f64 + 0.587 * img.data[i + 1] as f64 + 0.114 * img.data[i + 2] as f64
    };
    let mut rows: Vec<usize> = Vec::new();
    for y in 1..h.saturating_sub(1) {
        let mut strong = 0usize;
        for x in 0..w {
            let d = (gray(x, y) - gray(x, y - 1))
                .abs()
                .max((gray(x, y) - gray(x, y + 1)).abs());
            if d > step {
                strong += 1;
            }
        }
        if strong as f64 >= w as f64 * span {
            rows.push(y);
        }
    }
    let mut out: Vec<usize> = Vec::new();
    for y in rows {
        if out.is_empty() || y - *out.last().unwrap() > 3 {
            out.push(y);
        }
    }
    out
}

/// JS: chromeStripCheck(region, compCrop, buildCrop).
pub fn chrome_strip_check(region: &Region, comp_crop: &Image, build_crop: &Image) -> Value {
    let mut findings: Vec<String> = Vec::new();
    let strip = comp_crop.height as f64 <= comp_crop.width as f64 * 0.35;
    if !strip {
        return json!({ "findings": findings });
    }
    if region.kind == "control" {
        match ink_box(comp_crop) {
            Some(ib) if (ib.w as f64) >= comp_crop.width as f64 * 0.6 => {}
            _ => return json!({ "findings": findings }),
        }
    }
    let ra = rule_rows(comp_crop, 0.5, 28.0);
    let rb = rule_rows(build_crop, 0.5, 28.0);
    if !ra.is_empty() && !rb.is_empty() {
        let ya = ra[0] as i64;
        let yb = rb[0] as i64;
        let dy = yb - ya;
        if (dy as f64).abs() > 5f64.max(comp_crop.height as f64 * 0.06) {
            findings.push(format!(
                "{} {}: its rule sits {}px into the box in the comp and {}px in the build ({}{}px), so the strip is {} than the comp's; match the height, not only the position",
                region.kind, region.id, ya, yb,
                if dy > 0 { "+" } else { "" }, dy,
                if dy > 0 { "taller" } else { "shorter" }
            ));
        }
        return json!({ "findings": findings, "comp": ya, "build": yb });
    }
    let ba = ink_box(comp_crop);
    let bb = ink_box(build_crop);
    let (ba, bb) = match (ba, bb) {
        (Some(a), Some(b)) => (a, b),
        _ => return json!({ "findings": findings }),
    };
    if (ba.w as f64) >= comp_crop.width as f64 * 0.6 && (ba.h as f64) <= comp_crop.height as f64 * 0.6 {
        let dh = bb.h - ba.h;
        if (dh as f64).abs() > 10f64.max(ba.h as f64 * 0.25) {
            findings.push(format!(
                "{} {}: its ink is {}px tall in the build and {}px in the comp ({}{}px); match the height, not only the position",
                region.kind, region.id, bb.h, ba.h,
                if dh > 0 { "+" } else { "" }, dh
            ));
        }
    }
    json!({ "findings": findings, "comp": ba.to_value(), "build": bb.to_value() })
}

/// JS: inventedInk(comp, build, {cols=10, rows=10, floor=10, added=12, ratio=2.5}).
pub fn invented_ink(comp: &Image, build: &Image) -> Value {
    let (cols, rows) = (10usize, 10usize);
    let (floor, added, ratio): (f64, f64, f64) = (10.0, 12.0, 2.5);
    let a = detail_grid(comp, cols, rows, 512);
    let b = detail_grid(build, cols, rows, 512);
    let mut cells: Vec<Value> = Vec::new();
    for r in 0..rows {
        for c in 0..cols {
            let i = r * cols + c;
            let ai = a.cells[i] as f64;
            let bi = b.cells[i] as f64;
            if !(ai < floor && bi > added.max(ai * ratio)) {
                continue;
            }
            let mut neighbourhood = 0f64;
            let mut cnt = 0f64;
            for dr in -1i64..=1 {
                for dc in -1i64..=1 {
                    let rr = r as i64 + dr;
                    let cc = c as i64 + dc;
                    if rr < 0 || cc < 0 || rr >= rows as i64 || cc >= cols as i64 {
                        continue;
                    }
                    neighbourhood += a.cells[rr as usize * cols + cc as usize] as f64;
                    cnt += 1.0;
                }
            }
            if neighbourhood / cnt >= floor * 2.0 {
                continue;
            }
            let label = format!("{}{}", (b'A' + c as u8) as char, r);
            cells.push(json!({
                "col": c, "row": r, "label": label,
                "comp": round_fixed(ai, 1), "build": round_fixed(bi, 1)
            }));
        }
    }
    let fraction = cells.len() as f64 / (cols * rows) as f64;
    json!({ "cells": cells, "fraction": fraction })
}

/// JS: plateClipCheck(region, compCrop, buildCrop, {margin=6}).
pub fn plate_clip_check(_region: &Region, comp_crop: &Image, build_crop: &Image) -> Value {
    let margin = 6.0;
    let a = ink_box(comp_crop);
    let b = ink_box(build_crop);
    let (a, b) = match (a, b) {
        (Some(a), Some(b)) => (a, b),
        _ => return json!({ "sides": [] }),
    };
    let (w, h) = (comp_crop.width as i64, comp_crop.height as i64);
    let flush = |v: i64| v <= 1;
    let mut sides: Vec<&str> = Vec::new();
    if a.x as f64 >= margin && flush(b.x) {
        sides.push("left");
    }
    if a.y as f64 >= margin && flush(b.y) {
        sides.push("top");
    }
    if (w - (a.x + a.w)) as f64 >= margin && flush(w - (b.x + b.w)) {
        sides.push("right");
    }
    if (h - (a.y + a.h)) as f64 >= margin && flush(h - (b.y + b.h)) {
        sides.push("bottom");
    }
    json!({ "sides": sides, "comp": a.to_value(), "build": b.to_value() })
}

// ---- svg illustrations -----------------------------------------------------

static RE_SVG: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?is)<svg\b([^>]*)>(.*?)</svg>").unwrap());
static RE_PATH: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)<path\b").unwrap());
static RE_SHAPE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)<(polyline|polygon|line|circle|ellipse|rect)\b").unwrap());
static RE_D: Lazy<Regex> = Lazy::new(|| Regex::new(r#"\sd="([^"]*)""#).unwrap());
static RE_POINTS: Lazy<Regex> = Lazy::new(|| Regex::new(r#"\spoints="([^"]*)""#).unwrap());
static RE_VB: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"viewBox="\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)"#).unwrap()
});
static RE_W: Lazy<Regex> = Lazy::new(|| Regex::new(r#"\swidth="([\d.]+)(px)?""#).unwrap());
static RE_H: Lazy<Regex> = Lazy::new(|| Regex::new(r#"\sheight="([\d.]+)(px)?""#).unwrap());
static RE_USE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)<use\b").unwrap());
static RE_TEXTIMG: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)<(text|image)\b").unwrap());
static RE_LABEL: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"(?i)\b(id|class|aria-label|data-region)="([^"]+)""#).unwrap());
static RE_WS: Lazy<Regex> = Lazy::new(|| Regex::new(r"\s+").unwrap());

/// JS: svgIllustrations(html, {iconPx=64, pathBudget=480, maxPaths=8}).
pub fn svg_illustrations(html: &str) -> Vec<Value> {
    let (icon_px, path_budget, max_paths) = (64f64, 480i64, 8i64);
    let mut out = Vec::new();
    for m in RE_SVG.captures_iter(html) {
        let attrs = m.get(1).map(|g| g.as_str()).unwrap_or("");
        let body = m.get(2).map(|g| g.as_str()).unwrap_or("");
        let paths = RE_PATH.find_iter(body).count() as i64 + RE_SHAPE.find_iter(body).count() as i64;
        let mut budget = 0i64;
        for c in RE_D.captures_iter(body) {
            budget += c.get(1).unwrap().as_str().len() as i64;
        }
        for c in RE_POINTS.captures_iter(body) {
            budget += c.get(1).unwrap().as_str().len() as i64;
        }
        let parse = |s: &str| s.parse::<f64>().unwrap_or(0.0);
        let vb = RE_VB.captures(attrs);
        let wm = RE_W.captures(attrs);
        let hm = RE_H.captures(attrs);
        let vb_long = vb
            .as_ref()
            .map(|c| parse(&c[1]).max(parse(&c[2])))
            .unwrap_or(0.0);
        let w_long = wm.as_ref().map(|c| parse(&c[1])).unwrap_or(0.0);
        let h_long = hm.as_ref().map(|c| parse(&c[1])).unwrap_or(0.0);
        let long = vb_long.max(w_long).max(h_long);
        let icon_sized = long > 0.0 && long <= icon_px && paths <= max_paths;
        let uses = RE_USE.is_match(body) && paths == 0;
        if uses {
            continue;
        }
        if icon_sized && budget <= path_budget {
            continue;
        }
        if budget <= path_budget && paths <= max_paths && long == 0.0 && !RE_TEXTIMG.is_match(body) {
            continue;
        }
        if budget > path_budget || paths > max_paths || (long > icon_px && paths > 0) {
            let label = RE_LABEL.captures(attrs).map(|c| c[2].to_string());
            let attr_slice: String = attrs.chars().take(80).collect();
            let snippet = format!(
                "<svg{}...> ({} shapes, {} chars of path data{})",
                RE_WS.replace_all(&attr_slice, " "),
                paths,
                budget,
                if long != 0.0 { format!(", {}px", n(long)) } else { String::new() }
            );
            out.push(json!({
                "snippet": snippet,
                "label": label,
                "paths": paths,
                "budget": budget,
                "long": long,
            }));
        }
    }
    out
}
