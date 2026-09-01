//! JS: skill/scripts/comp-diff.mjs
//!
//! Measure a build screenshot against its approved comp: structure / color /
//! detail / bands scores, per-region verdicts, and the side-by-side / heatmap /
//! region-pair artifacts. Pure (no browser); the JS spawned no browser either.

use std::path::{Path, PathBuf};

use impeccable_comp::hero::{ink_box, InkBox};
use impeccable_comp::metrics as m;
use impeccable_comp::png_io;
use impeccable_comp::raster::{self as r, Image};
use serde_json::{json, Value};

use crate::util::{self, arg, arg_or, flag, num, pad_end, pad_start, r4f, round, to_fixed};

use impeccable_common::Io;

// ---- scoring ---------------------------------------------------------------

/// scorePair(a, b, kind) output, fields stored already r4-rounded (the JS
/// stores `r4(...)` and every downstream reader sees the rounded value).
#[derive(Clone)]
pub struct Score {
    pub overall: f64,
    pub structure: f64,
    pub color: f64,
    pub color_intersection: f64,
    pub palette_match: f64,
    pub detail: f64,
    pub detail_raw: f64,
    pub detail_added: f64,
    pub bands: f64,
}

impl Score {
    /// strip(s): the report/region JSON, JS field order.
    pub fn to_json(&self) -> Value {
        json!({
            "overall": num(self.overall),
            "structure": num(self.structure),
            "color": num(self.color),
            "colorIntersection": num(self.color_intersection),
            "paletteMatch": num(self.palette_match),
            "detail": num(self.detail),
            "detailRaw": num(self.detail_raw),
            "detailAdded": num(self.detail_added),
            "bands": num(self.bands),
        })
    }
}

fn weights(kind: Option<&str>) -> (f64, f64, f64, f64) {
    // (structure, color, detail, bands)
    match kind {
        Some("plate") | Some("image") => (0.25, 0.2, 0.5, 0.05),
        Some("texture") => (0.15, 0.35, 0.5, 0.0),
        Some("text") => (0.5, 0.25, 0.15, 0.1),
        Some("control") => (0.45, 0.35, 0.2, 0.0),
        _ => (0.35, 0.25, 0.25, 0.15),
    }
}

/// JS: scorePair(a, b, kind).
pub fn score_pair(a: &Image, b: &Image, kind: Option<&str>) -> Score {
    let structure = m::structure_score(a, b, 256);
    let color = m::color_score(a, b);
    let detail = m::detail_score(a, b, 12, 8);
    let bands_a = m::horizontal_bands(a, 128, 0.02);
    let bands_b = m::horizontal_bands(b, 128, 0.02);
    let bands = m::band_score(&bands_a, &bands_b, 0.04);
    let (ws, wc, wd, wb) = weights(kind);
    let overall = ws * structure + wc * color.score + wd * detail.score + wb * bands;
    Score {
        overall: r4f(overall),
        structure: r4f(structure),
        color: r4f(color.score),
        color_intersection: r4f(color.intersection),
        palette_match: r4f(color.palette_match),
        detail: r4f(detail.score),
        detail_raw: r4f(detail.raw_score),
        detail_added: r4f(detail.added_fraction),
        bands: r4f(bands),
    }
}

/// JS: verdictFor(s, kind).
pub fn verdict_for(s: &Score, kind: Option<&str>) -> &'static str {
    let painted = matches!(kind, Some("plate") | Some("image") | Some("texture"));
    if s.detail_raw < 0.15 {
        return "missing";
    }
    if painted && s.detail < 0.5 {
        return "missing";
    }
    if !painted && s.detail < 0.35 && s.structure < 0.6 {
        if s.detail_raw < 0.2 {
            return "missing";
        }
        if s.structure >= 0.5 && s.color >= 0.5 {
            return "drift";
        }
        return "contradicted";
    }
    if s.detail < 0.35 && s.structure < 0.6 {
        return "missing";
    }
    if s.structure < 0.3 {
        return "contradicted";
    }
    if painted && (s.structure < 0.45 || s.detail_added > 0.4) {
        return "contradicted";
    }
    if kind == Some("text") && s.color >= 0.5 {
        return if s.overall >= 0.8 { "match" } else { "drift" };
    }
    if (kind == Some("chrome") || kind == Some("control")) && s.structure >= 0.5 && s.color >= 0.5 {
        return if s.overall >= 0.8 { "match" } else { "drift" };
    }
    if s.overall >= 0.8 {
        return "match";
    }
    if s.overall >= 0.6 {
        return "drift";
    }
    "contradicted"
}

// ---- alignment -------------------------------------------------------------

/// JS: alignBuild(comp, build, align='top').
pub fn align_build(comp: &Image, build: &Image, align: &str) -> Image {
    if align == "stretch" {
        return r::resize(build, comp.width as f64, comp.height as f64);
    }
    if align == "cover" {
        let s = (comp.width as f64 / build.width as f64).max(comp.height as f64 / build.height as f64);
        let scaled = r::resize(build, build.width as f64 * s, build.height as f64 * s);
        return r::crop(
            &scaled,
            (scaled.width as f64 - comp.width as f64) / 2.0,
            (scaled.height as f64 - comp.height as f64) / 2.0,
            comp.width as f64,
            comp.height as f64,
        );
    }
    let scaled = if build.width == comp.width {
        build.clone()
    } else {
        r::resize(
            build,
            comp.width as f64,
            round((build.height as f64 / build.width as f64) * comp.width as f64),
        )
    };
    if scaled.height == comp.height {
        return scaled;
    }
    if scaled.height > comp.height {
        return r::crop(&scaled, 0.0, 0.0, comp.width as f64, comp.height as f64);
    }
    let mut out = r::create_image(comp.width, comp.height, [255, 255, 255, 255]);
    r::blit(&mut out, &scaled, 0.0, 0.0);
    out
}

pub struct Shift {
    pub dx: i64,
    pub dy: i64,
    #[allow(dead_code)]
    pub score: f64,
}

/// JS: bestShift(comp, build, workWidth=256).
pub fn best_shift(comp: &Image, build: &Image, work_width: usize) -> Shift {
    let ww = work_width as f64;
    let h = 8f64.max(round((comp.height as f64 / comp.width as f64) * ww));
    let a = m::blur_gray(&m::to_gray(&r::resize(comp, ww, h)), 2);
    let b = m::blur_gray(&m::to_gray(&r::resize(build, ww, h)), 2);
    let max_shift = 2f64.max(round(ww * 0.04));
    let mut best_dx = 0i64;
    let mut best_dy = 0i64;
    let mut best_score = m::ssim_shifted(&a, &b, 0, 0, 8);
    let steps = [-max_shift, -max_shift / 2.0, 0.0, max_shift / 2.0, max_shift];
    for &dy in &steps {
        for &dx in &steps {
            let sc = m::ssim_shifted(&a, &b, round(dx) as i64, round(dy) as i64, 8);
            if sc > best_score + 0.01 {
                best_dx = round(dx) as i64;
                best_dy = round(dy) as i64;
                best_score = sc;
            }
        }
    }
    let scale = comp.width as f64 / ww;
    Shift {
        dx: round(best_dx as f64 * scale) as i64,
        dy: round(best_dy as f64 * scale) as i64,
        score: best_score,
    }
}

// ---- regions ---------------------------------------------------------------

#[derive(Clone)]
pub struct RegionBox {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub kind: Option<String>,
}

/// JS: resolveRegions(comp, spec).
pub fn resolve_regions(comp: &Image, spec: Option<&Value>) -> Vec<RegionBox> {
    let mut regions: Vec<RegionBox> = Vec::new();
    if let Some(spec) = spec {
        if let Some(arr) = spec.get("regions").and_then(Value::as_array) {
            if !arr.is_empty() {
                for r in arr {
                    let boxv = r.get("box").unwrap_or(r);
                    let get = |k: &str| boxv.get(k).and_then(Value::as_f64);
                    let (x, y, w, h) = (get("x"), get("y"), get("w"), get("h"));
                    if x.is_none() || y.is_none() || w.is_none() || h.is_none() {
                        continue;
                    }
                    let id = r
                        .get("id")
                        .and_then(Value::as_str)
                        .map(String::from)
                        .unwrap_or_else(|| format!("region-{}", regions.len() + 1));
                    let kind = r.get("kind").and_then(Value::as_str).map(String::from);
                    regions.push(RegionBox {
                        id,
                        x: x.unwrap(),
                        y: y.unwrap(),
                        w: w.unwrap(),
                        h: h.unwrap(),
                        kind,
                    });
                }
                if !regions.is_empty() {
                    return regions;
                }
            }
        }
    }
    let bands: Vec<m::Band> = m::horizontal_bands(comp, 128, 0.02)
        .into_iter()
        .filter(|b| b.strength > 0.2)
        .collect();
    let mut cuts: Vec<f64> = Vec::new();
    let raw: Vec<f64> = std::iter::once(0.0)
        .chain(bands.iter().map(|b| b.y))
        .chain(std::iter::once(1.0))
        .collect();
    for (i, &v) in raw.iter().enumerate() {
        if i == 0 || v - cuts[cuts.len() - 1] > 0.06 {
            cuts.push(v);
        }
    }
    if *cuts.last().unwrap() != 1.0 {
        cuts.push(1.0);
    }
    for i in 0..cuts.len().saturating_sub(1) {
        regions.push(RegionBox {
            id: format!("band-{}", i + 1),
            x: 0.0,
            y: cuts[i],
            w: 1.0,
            h: cuts[i + 1] - cuts[i],
            kind: Some("band".into()),
        });
    }
    if regions.len() < 2 {
        return vec![
            RegionBox { id: "top".into(), x: 0.0, y: 0.0, w: 1.0, h: 0.5, kind: Some("band".into()) },
            RegionBox { id: "bottom".into(), x: 0.0, y: 0.5, w: 1.0, h: 0.5, kind: Some("band".into()) },
        ];
    }
    regions
}

/// JS: regionCrop(img, r).
fn region_crop(img: &Image, rr: &RegionBox) -> Image {
    let min_px = 48f64;
    let mut x = rr.x * img.width as f64;
    let mut y = rr.y * img.height as f64;
    let mut w = rr.w * img.width as f64;
    let mut h = rr.h * img.height as f64;
    if h < min_px {
        y -= (min_px - h) / 2.0;
        h = min_px;
    }
    if w < min_px {
        x -= (min_px - w) / 2.0;
        w = min_px;
    }
    r::crop(img, x, y, w, h)
}

fn ink_box_json(b: &Option<InkBox>) -> Value {
    match b {
        Some(v) => json!({ "x": v.x, "y": v.y, "w": v.w, "h": v.h }),
        None => Value::Null,
    }
}

// ---- compare ---------------------------------------------------------------

pub struct CompareRegion {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub kind: Option<String>,
    pub score: Score,
    pub verdict: String,
    pub ink_comp: Option<InkBox>,
    pub ink_build: Option<InkBox>,
    pub a: Image,
    pub b: Image,
}

pub struct CompareResult {
    pub label: String,
    pub align: String,
    pub whole: Score,
    pub regions: Vec<CompareRegion>,
    pub aligned: Image,
    pub shift: Shift,
    pub comp_palette: Vec<m::DominantColor>,
    pub build_palette: Vec<m::DominantColor>,
}

/// JS: compare({ comp, build, spec, align, label, kind }).
pub fn compare(
    comp: &Image,
    build: &Image,
    spec: Option<&Value>,
    align: &str,
    label: &str,
    kind: Option<&str>,
) -> CompareResult {
    let aligned0 = align_build(comp, build, align);
    let whole = score_pair(comp, &aligned0, kind);
    let as_captured = aligned0.clone();
    let shift = best_shift(comp, &aligned0, 256);
    let aligned = if shift.dx != 0 || shift.dy != 0 {
        let mut shifted = r::create_image(aligned0.width, aligned0.height, [255, 255, 255, 255]);
        r::blit(&mut shifted, &aligned0, -shift.dx as f64, -shift.dy as f64);
        shifted
    } else {
        aligned0
    };
    let regions_in = resolve_regions(comp, spec);
    let mut regions = Vec::with_capacity(regions_in.len());
    for rr in regions_in {
        let a = region_crop(comp, &rr);
        let b = region_crop(&aligned, &rr);
        let s = score_pair(&a, &b, rr.kind.as_deref());
        let verdict = verdict_for(&s, rr.kind.as_deref()).to_string();
        regions.push(CompareRegion {
            id: rr.id,
            x: rr.x,
            y: rr.y,
            w: rr.w,
            h: rr.h,
            kind: rr.kind,
            score: s,
            verdict,
            ink_comp: ink_box(&a),
            ink_build: ink_box(&b),
            a,
            b,
        });
    }
    let comp_palette = m::dominant_colors(comp, 6, 3);
    let build_palette = m::dominant_colors(&aligned, 6, 3);
    CompareResult {
        label: label.to_string(),
        align: align.to_string(),
        whole,
        regions,
        aligned: as_captured,
        shift,
        comp_palette,
        build_palette,
    }
}

fn palette_json(colors: &[m::DominantColor]) -> Value {
    Value::Array(
        colors
            .iter()
            .map(|c| json!({ "hex": c.hex, "coverage": num(c.coverage) }))
            .collect(),
    )
}

/// JS: buildReport(result, files, meta). Field order preserved.
pub fn build_report(result: &CompareResult, files: Option<&Value>, meta: &Value) -> Value {
    let mut report = serde_json::Map::new();
    report.insert("tool".into(), json!("comp-diff"));
    report.insert("version".into(), json!(1));
    report.insert("createdAt".into(), json!(util::iso_now()));
    if let Some(obj) = meta.as_object() {
        for (k, v) in obj {
            report.insert(k.clone(), v.clone());
        }
    }
    report.insert("align".into(), json!(result.align));
    report.insert("overall".into(), num(result.whole.overall));
    report.insert("verdict".into(), json!(verdict_for(&result.whole, None)));
    report.insert("scores".into(), result.whole.to_json());
    report.insert(
        "palette".into(),
        json!({ "comp": palette_json(&result.comp_palette), "build": palette_json(&result.build_palette) }),
    );
    report.insert(
        "regions".into(),
        Value::Array(result.regions.iter().map(region_json).collect()),
    );
    report.insert("files".into(), files.cloned().unwrap_or(Value::Null));
    Value::Object(report)
}

fn region_json(r: &CompareRegion) -> Value {
    json!({
        "id": r.id,
        "x": num(r.x),
        "y": num(r.y),
        "w": num(r.w),
        "h": num(r.h),
        "kind": r.kind.clone().map(Value::String).unwrap_or(Value::Null),
        "score": r.score.to_json(),
        "verdict": r.verdict,
        "inkBox": json!({ "comp": ink_box_json(&r.ink_comp), "build": ink_box_json(&r.ink_build) }),
    })
}

// ---- artifacts -------------------------------------------------------------

fn heat_label(verdict: &str) -> [f64; 4] {
    match verdict {
        "match" => [40.0, 160.0, 80.0, 255.0],
        "drift" => [220.0, 160.0, 30.0, 255.0],
        _ => [200.0, 40.0, 40.0, 255.0],
    }
}

/// JS: renderSideBySide(comp, build, label, score).
fn render_side_by_side(comp: &Image, build: &Image, label: &str, score: &Score) -> Image {
    let gap = 24f64;
    let pad = 48f64;
    let target_w = (comp.width as f64).min(1400.0);
    let a = r::fit(comp, target_w, 100000.0, false);
    let b = r::resize(build, a.width as f64, a.height as f64);
    let mut out = r::create_image(
        a.width * 2 + gap as usize + pad as usize * 2,
        a.height + pad as usize * 2 + 24,
        [24, 24, 28, 255],
    );
    r::blit(&mut out, &a, pad, pad + 24.0);
    r::blit(&mut out, &b, pad + a.width as f64 + gap, pad + 24.0);
    r::draw_label(&mut out, "COMP", pad, pad - 4.0, [255.0, 255.0, 255.0, 255.0], [0.0, 0.0, 0.0, 220.0], 2.0, 4.0);
    let build_label = format!("BUILD {}", label.to_uppercase()).trim().to_string();
    r::draw_label(&mut out, &build_label, pad + a.width as f64 + gap, pad - 4.0, [255.0, 255.0, 255.0, 255.0], [0.0, 0.0, 0.0, 220.0], 2.0, 4.0);
    let s = format!(
        "OVERALL {}%  STRUCT {}%  COLOR {}%  DETAIL {}%  BANDS {}%",
        to_fixed(score.overall * 100.0, 0),
        to_fixed(score.structure * 100.0, 0),
        to_fixed(score.color * 100.0, 0),
        to_fixed(score.detail * 100.0, 0),
        to_fixed(score.bands * 100.0, 0)
    );
    let bg = heat_label(verdict_for(score, None));
    let oh = out.height as f64;
    r::draw_label(&mut out, &s, pad, oh - pad + 8.0, [255.0, 255.0, 255.0, 255.0], bg, 2.0, 4.0);
    out
}

/// JS: renderHeatmap(comp, build).
fn render_heatmap(comp: &Image, build: &Image) -> Image {
    let map = m::diff_map(comp, build, 384);
    let base = r::resize(build, map.width as f64, map.height as f64);
    let mut out = Image { width: base.width, height: base.height, data: base.data.clone() };
    for i in 0..map.data.len() {
        let d = map.data[i] as f64;
        let p = i * 4;
        if d < 0.12 {
            out.data[p] = (out.data[p] as f64 * 0.55 + 255.0 * 0.45 * 0.2) as u8;
            out.data[p + 1] = (out.data[p + 1] as f64 * 0.55) as u8;
            out.data[p + 2] = (out.data[p + 2] as f64 * 0.55) as u8;
            continue;
        }
        let alpha = 1f64.min((d - 0.12) / 0.5);
        out.data[p] = (out.data[p] as f64 * (1.0 - alpha) + 235.0 * alpha) as u8;
        out.data[p + 1] = (out.data[p + 1] as f64 * (1.0 - alpha) + 40.0 * alpha) as u8;
        out.data[p + 2] = (out.data[p + 2] as f64 * (1.0 - alpha) + 40.0 * alpha) as u8;
    }
    let mut scaled = r::resize(&out, comp.width as f64, comp.height as f64);
    r::draw_label(&mut scaled, "DIFF: RED = DIFFERS FROM COMP", 12.0, 12.0, [255.0, 255.0, 255.0, 255.0], [0.0, 0.0, 0.0, 220.0], 2.0, 4.0);
    scaled
}

/// JS: renderRegionPair(compCrop, buildCrop, id, score).
fn render_region_pair(comp_crop: &Image, build_crop: &Image, id: &str, score: &Score) -> Image {
    let gap = 16f64;
    let pad = 12f64;
    let max_w = 700f64;
    let a = r::fit(comp_crop, max_w, 700.0, true);
    let b = r::resize(build_crop, a.width as f64, a.height as f64);
    let mut out = r::create_image(
        a.width * 2 + gap as usize + pad as usize * 2,
        a.height + pad as usize * 2 + 30,
        [24, 24, 28, 255],
    );
    r::blit(&mut out, &a, pad, pad + 30.0);
    r::blit(&mut out, &b, pad + a.width as f64 + gap, pad + 30.0);
    let v = verdict_for(score, None);
    r::draw_label(&mut out, &format!("{}  COMP", id.to_uppercase()), pad, pad, [255.0, 255.0, 255.0, 255.0], [0.0, 0.0, 0.0, 220.0], 2.0, 4.0);
    r::draw_label(
        &mut out,
        &format!("BUILD  {} {}%", v.to_uppercase(), to_fixed(score.overall * 100.0, 0)),
        pad + a.width as f64 + gap,
        pad,
        [255.0, 255.0, 255.0, 255.0],
        heat_label(v),
        2.0,
        4.0,
    );
    out
}

fn write_png(path: &Path, img: &Image) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let bytes = png_io::encode_png(img, &[])?;
    std::fs::write(path, bytes).map_err(|e| e.to_string())
}

/// JS: writeArtifacts(result, comp, outDir).
pub fn write_artifacts(result: &CompareResult, comp: &Image, out_dir: &Path) -> Value {
    let _ = std::fs::create_dir_all(out_dir.join("regions"));
    let side = render_side_by_side(comp, &result.aligned, &result.label, &result.whole);
    let side_path = out_dir.join("side-by-side.png");
    let _ = write_png(&side_path, &side);
    let heat_path = out_dir.join("heatmap.png");
    let _ = write_png(&heat_path, &render_heatmap(comp, &result.aligned));
    let mut region_files: Vec<Value> = Vec::new();
    for rg in &result.regions {
        let file = out_dir.join("regions").join(format!("{}.png", rg.id));
        let _ = write_png(&file, &render_region_pair(&rg.a, &rg.b, &rg.id, &rg.score));
        region_files.push(json!(path_str(&file)));
    }
    json!({
        "sideBySide": path_str(&side_path),
        "heatmap": path_str(&heat_path),
        "regionFiles": region_files,
    })
}

fn path_str(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

// ---- summary ---------------------------------------------------------------

fn pct(v: f64) -> String {
    to_fixed(v * 100.0, 0)
}

/// JS: summarize(report).
fn summarize(report: &Value) -> String {
    let mut lines: Vec<String> = Vec::new();
    let label = report.get("label").and_then(Value::as_str).unwrap_or("");
    let overall = report.get("overall").and_then(Value::as_f64).unwrap_or(0.0);
    let verdict = report.get("verdict").and_then(Value::as_str).unwrap_or("");
    let scores = report.get("scores").cloned().unwrap_or(Value::Null);
    let sc = |k: &str| scores.get(k).and_then(Value::as_f64).unwrap_or(0.0);
    lines.push(format!(
        "COMP-DIFF {}overall {}% ({}) structure {}% color {}% detail {}% bands {}%",
        if !label.is_empty() { format!("[{label}] ") } else { String::new() },
        pct(overall),
        verdict,
        pct(sc("structure")),
        pct(sc("color")),
        pct(sc("detail")),
        pct(sc("bands"))
    ));
    let comp_pal = report.pointer("/palette/comp").and_then(Value::as_array).cloned().unwrap_or_default();
    let build_pal = report.pointer("/palette/build").and_then(Value::as_array).cloned().unwrap_or_default();
    let pal_str = |arr: &[Value]| {
        arr.iter()
            .take(5)
            .map(|c| {
                let hex = c.get("hex").and_then(Value::as_str).unwrap_or("");
                let cov = c.get("coverage").and_then(Value::as_f64).unwrap_or(0.0);
                format!("{hex}({}%)", round(cov * 100.0) as i64)
            })
            .collect::<Vec<_>>()
            .join(" ")
    };
    lines.push(format!("PALETTE comp {}", pal_str(&comp_pal)));
    lines.push(format!("PALETTE build {}", pal_str(&build_pal)));
    let regions = report.get("regions").and_then(Value::as_array).cloned().unwrap_or_default();
    for rg in &regions {
        let id = rg.get("id").and_then(Value::as_str).unwrap_or("");
        let rverdict = rg.get("verdict").and_then(Value::as_str).unwrap_or("");
        let s = rg.get("score").cloned().unwrap_or(Value::Null);
        let rsc = |k: &str| s.get(k).and_then(Value::as_f64).unwrap_or(0.0);
        let added = rsc("detailAdded");
        lines.push(format!(
            "REGION {} {} {}%  structure {}%  color {}%  detail {}%{}",
            pad_end(id, 18),
            pad_end(rverdict, 12),
            pad_start(&to_fixed(rsc("overall") * 100.0, 0), 3),
            pad_start(&to_fixed(rsc("structure") * 100.0, 0), 3),
            pad_start(&to_fixed(rsc("color") * 100.0, 0), 3),
            pad_start(&to_fixed(rsc("detail") * 100.0, 0), 3),
            if added > 0.25 { "  +invented detail" } else { "" }
        ));
    }
    if let Some(files) = report.get("files").filter(|f| !f.is_null()) {
        let side = files.get("sideBySide").and_then(Value::as_str).unwrap_or("");
        let heat = files.get("heatmap").and_then(Value::as_str).unwrap_or("");
        lines.push(format!("FILES side-by-side {side}"));
        lines.push(format!("FILES heatmap {heat}"));
        let rf = files.get("regionFiles").and_then(Value::as_array).cloned().unwrap_or_default();
        let dir_of = rf
            .first()
            .and_then(Value::as_str)
            .or(Some(heat))
            .map(|p| {
                Path::new(p)
                    .parent()
                    .map(|d| d.to_string_lossy().replace('\\', "/"))
                    .unwrap_or_default()
            })
            .unwrap_or_default();
        lines.push(format!("FILES regions {} under {}", rf.len(), dir_of));
    }
    let mut worst = regions.clone();
    worst.sort_by(|a, b| {
        let av = a.pointer("/score/overall").and_then(Value::as_f64).unwrap_or(0.0);
        let bv = b.pointer("/score/overall").and_then(Value::as_f64).unwrap_or(0.0);
        av.partial_cmp(&bv).unwrap()
    });
    let worst: Vec<String> = worst
        .iter()
        .take(3)
        .map(|r| {
            let id = r.get("id").and_then(Value::as_str).unwrap_or("");
            let v = r.get("verdict").and_then(Value::as_str).unwrap_or("");
            let o = r.pointer("/score/overall").and_then(Value::as_f64).unwrap_or(0.0);
            format!("{id} ({v}, {}%)", to_fixed(o * 100.0, 0))
        })
        .collect();
    if !worst.is_empty() {
        lines.push(format!("WORST {}", worst.join("; ")));
    }
    lines.push("OPEN the side-by-side and the worst region pairs before deciding anything; the numbers rank, the crops decide.".into());
    lines.join("\n")
}

fn read_png(io: &Io, file: &str) -> Result<Image, String> {
    let path = resolve(io, file);
    let (decoded, _) = png_io::load_raster(&path)?;
    Ok(decoded.image)
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

/// `impeccable comp-diff --comp <png> --build <png> ...`
pub fn run(argv: &[String], io: &mut Io) -> i32 {
    let comp_path = arg(argv, "comp");
    let build_path = arg(argv, "build");
    let (Some(comp_path), Some(build_path)) = (comp_path, build_path) else {
        io.err("usage: comp-diff.mjs --comp <png> --build <png> [--spec spec.json] [--out-dir dir] [--align top|stretch] [--label name] [--threshold 0.75] [--json]\n");
        return 1;
    };
    let comp = match read_png(io, comp_path) {
        Ok(v) => v,
        Err(e) => {
            io.err(&format!("comp-diff: cannot read comp {comp_path}: {e}\n"));
            return 1;
        }
    };
    let build = match read_png(io, build_path) {
        Ok(v) => v,
        Err(e) => {
            io.err(&format!("comp-diff: cannot read build {build_path}: {e}\n"));
            return 1;
        }
    };
    let mut spec: Option<Value> = None;
    let spec_path = arg(argv, "spec");
    if let Some(sp) = spec_path {
        match std::fs::read_to_string(resolve(io, sp)) {
            Ok(raw) => match serde_json::from_str::<Value>(&raw) {
                Ok(v) => spec = Some(v),
                Err(e) => {
                    io.err(&format!("comp-diff: cannot read spec {sp}: {e}\n"));
                    return 1;
                }
            },
            Err(e) => {
                io.err(&format!("comp-diff: cannot read spec {sp}: {e}\n"));
                return 1;
            }
        }
    }
    let default_out = {
        let d = Path::new(build_path).parent().map(|p| p.to_path_buf()).unwrap_or_default();
        d.join("diff").to_string_lossy().replace('\\', "/")
    };
    let out_dir = arg_or(argv, "out-dir", &default_out).to_string();
    let default_label = Path::new(build_path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let label = arg_or(argv, "label", &default_label).to_string();
    let align = arg_or(argv, "align", "top").to_string();

    let result = compare(&comp, &build, spec.as_ref(), &align, &label, None);
    let files = if flag(argv, "no-files") {
        None
    } else {
        Some(write_artifacts(&result, &comp, &resolve(io, &out_dir)))
    };
    let meta = json!({
        "label": label,
        "comp": comp_path,
        "build": build_path,
        "spec": spec_path.map(Value::from).unwrap_or(Value::Null),
        "compSize": format!("{}x{}", comp.width, comp.height),
        "buildSize": format!("{}x{}", build.width, build.height),
    });
    let report = build_report(&result, files.as_ref(), &meta);
    if files.is_some() {
        let rp = resolve(io, &out_dir).join("report.json");
        let _ = std::fs::write(&rp, util::json_pretty(&report));
    }
    if flag(argv, "json") {
        io.out(&format!("{}\n", util::json_pretty(&report)));
    } else {
        io.out(&format!("{}\n", summarize(&report)));
    }
    let threshold = arg(argv, "threshold").map(|t| util::parse_f64(t, f64::NAN));
    if let Some(th) = threshold {
        if result.whole.overall < th {
            if !flag(argv, "json") {
                io.out(&format!(
                    "BELOW THRESHOLD {}%: the reproduction is not done. Fix the worst regions and re-run; do not build past the hero.\n",
                    to_fixed(th * 100.0, 0)
                ));
            }
            return 3;
        }
    }
    0
}
