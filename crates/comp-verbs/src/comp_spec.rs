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

use crate::util::{self, arg, arg_or, flag, num, r4, r4f, round};

pub const BUILD_DIR: &str = ".impeccable/build";
pub const SPEC_PATH: &str = ".impeccable/build/spec.json";
pub const GRID_PATH: &str = ".impeccable/build/comp-grid.png";
pub const PLATES_DIR: &str = "assets/plates";

const COLS: &[u8] = b"ABCDEFGHIJ";
pub const MAX_CODE_REGION_AREA: f64 = 0.25;
pub const EDGE_CONTACT_MIN: f64 = 0.35;

fn is_raster_kind(k: &str) -> bool {
    matches!(k, "plate" | "image" | "texture")
}
fn is_kind(k: &str) -> bool {
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
            _ => "band".to_string(),
        };
        let note = raw.get("note").and_then(Value::as_str);
        if kind != "band" && !note.map(|n| n.trim().chars().count() >= 8).unwrap_or(false) {
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
        let has_box = raw
            .get("box")
            .and_then(|b| b.get("x"))
            .map(|x| x.is_number())
            .unwrap_or(false);
        let mut boxf: (f64, f64, f64, f64) = if has_box {
            let b = raw.get("box").unwrap();
            (
                b.get("x").and_then(Value::as_f64).unwrap_or(0.0),
                b.get("y").and_then(Value::as_f64).unwrap_or(0.0),
                b.get("w").and_then(Value::as_f64).unwrap_or(0.0),
                b.get("h").and_then(Value::as_f64).unwrap_or(0.0),
            )
        } else {
            let grid = raw.get("grid").and_then(Value::as_str).unwrap_or("");
            grid_to_box(grid)?
        };
        let mut cover_box: Option<(f64, f64, f64, f64)> = None;
        let grid_str = raw.get("grid").and_then(Value::as_str);
        let snap_not_false = raw.get("snap").and_then(Value::as_bool) != Some(false);
        if !has_box && grid_str.is_some() && (kind == "text" || kind == "control") && snap_not_false {
            if let Some(snapped) = snap_box_to_ink(comp, boxf, page_ground) {
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

/// JS: plateReference(comp, spec, region).
pub fn plate_reference(comp: &Image, spec: &Value, region: &Value) -> Image {
    let px = |k: &str| region.pointer(&format!("/px/{k}")).and_then(Value::as_f64).unwrap_or(0.0);
    let (rx, ry, rw, rh) = (px("x"), px("y"), px("w"), px("h"));
    let mut c = r::crop(comp, rx, ry, rw, rh);
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
            r::fill_rect(&mut c, ox, oy, ox2 - ox, oy2 - oy, [ground[0] as f64, ground[1] as f64, ground[2] as f64, 255.0]);
        }
    }
    c
}

/// JS: platePrompt(spec, region).
pub fn plate_prompt(spec: &Value, region: &Value) -> String {
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
        "Remove letterboxing, borders, card corners, drop shadows, and any layout background that the page will draw in code.".to_string(),
        "Do not add objects. Do not change the concept. Do not restyle. The artwork fills the whole frame edge to edge at the same scale as the reference; no margins, no border, no background band.".to_string(),
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
pub fn run(argv: &[String], io: &mut Io) -> i32 {
    let spec_path = arg_or(argv, "spec", SPEC_PATH).to_string();
    if flag(argv, "help") || argv.is_empty() {
        io.out("usage: comp-spec.mjs --comp <png> --grid            write .impeccable/build/comp-grid.png (10x10 labeled grid) + palette + bands\n       comp-spec.mjs --comp <png> --regions <json>  measure regions -> .impeccable/build/spec.json\n         regions json: { \"regions\": [ { \"id\": \"art\", \"kind\": \"plate|image|texture|text|control|chrome\", \"grid\": \"E0:J4\", \"note\": \"...\" } ] }\n       comp-spec.mjs --comp <png> --auto            band regions when you have no regions file\n       comp-spec.mjs --print                        the compact spec\n       comp-spec.mjs --crop <id> [--out f] [--scale n]   reference crop of a region (never a shipping asset)\n       comp-spec.mjs --plate-prompt <id>            the regeneration prompt for a raster region\n");
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
        let Some(spec) = load_spec(&resolve(io, &spec_path)) else {
            io.err(&format!("comp-spec: no spec at {spec_path}\n"));
            return 1;
        };
        let region = spec.get("regions").and_then(Value::as_array).and_then(|a| a.iter().find(|r| r.get("id").and_then(Value::as_str) == Some(id)));
        let Some(region) = region else {
            io.err(&format!("comp-spec: no region {id}\n"));
            return 1;
        };
        io.out(&format!("{}\n", plate_prompt(&spec, region)));
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
        let mut c = if medium == "raster" && !flag(argv, "raw") {
            plate_reference(&comp, &spec, &region)
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
        let text = vec![("impeccable:crop-of".to_string(), format!("{comp_file}#{id}"))];
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
        return 0;
    }

    let regions_input: Value = if let Some(rf) = arg(argv, "regions") {
        match std::fs::read_to_string(resolve(io, rf)) {
            Ok(raw) => match serde_json::from_str(&raw) {
                Ok(v) => v,
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
    } else if flag(argv, "auto") {
        auto_regions(&comp)
    } else {
        io.err("comp-spec: pass --grid to get the coordinate grid, then --regions <json> (or --auto for band regions)\n");
        return 1;
    };
    let spec = match measure_regions(&comp, &regions_input, comp_path) {
        Ok(s) => s,
        Err(e) => {
            io.err(&format!("comp-spec: {e}\n"));
            return 1;
        }
    };
    let spec_out = resolve(io, &spec_path);
    if let Some(parent) = spec_out.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(&spec_out, util::json_pretty(&spec));
    io.out(&format!("WROTE {spec_path}\n"));
    io.out(&format!("{}\n", print_spec(&spec)));
    let _ = r4f(0.0); // silence unused if optimized away
    0
}
