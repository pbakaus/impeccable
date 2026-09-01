//! JS: skill/scripts/lib/image-metrics.mjs
//!
//! Perceptual measures comparing a comp with a build screenshot. Pure over
//! RGBA `Image`s. Gray images are `Vec<f32>` because the JS uses `Float32Array`
//! at every stage (toGray, blurGray, histograms, the detail grid); the f32
//! rounding at each store is load path of numeric parity, so it is preserved
//! here rather than accumulating in f64.

use crate::jsnum::{round, round_fixed, to_hex};
use crate::raster::{resize, Image};

/// Float32 grayscale image (JS `{ width, height, data: Float32Array }`).
#[derive(Clone)]
pub struct Gray {
    pub width: usize,
    pub height: usize,
    pub data: Vec<f32>,
}

/// JS: toGray(img). Composites over white, then Rec.709 luma, stored f32.
pub fn to_gray(img: &Image) -> Gray {
    let n = img.width * img.height;
    let mut g = vec![0f32; n];
    let mut p = 0usize;
    for gi in g.iter_mut() {
        let a = img.data[p + 3] as f64 / 255.0;
        let r = img.data[p] as f64 * a + 255.0 * (1.0 - a);
        let gg = img.data[p + 1] as f64 * a + 255.0 * (1.0 - a);
        let b = img.data[p + 2] as f64 * a + 255.0 * (1.0 - a);
        *gi = (0.2126 * r + 0.7152 * gg + 0.0722 * b) as f32;
        p += 4;
    }
    Gray { width: img.width, height: img.height, data: g }
}

#[inline]
fn clampi(v: i64, lo: i64, hi: i64) -> usize {
    v.max(lo).min(hi) as usize
}

/// JS: blurGray(gray, r). Separable box blur, radius r, f32 storage.
pub fn blur_gray(gray: &Gray, r: i64) -> Gray {
    if r <= 0 {
        return gray.clone();
    }
    let width = gray.width as i64;
    let height = gray.height as i64;
    let data = &gray.data;
    let mut tmp = vec![0f32; data.len()];
    let mut out = vec![0f32; data.len()];
    let win = (2 * r + 1) as f64;
    for y in 0..height {
        let row = (y * width) as usize;
        let mut acc = 0f64;
        for x in -r..=r {
            acc += data[row + clampi(x, 0, width - 1)] as f64;
        }
        for x in 0..width {
            tmp[row + x as usize] = (acc / win) as f32;
            let out_x = x - r;
            let in_x = x + r + 1;
            acc += data[row + clampi(in_x, 0, width - 1)] as f64
                - data[row + clampi(out_x, 0, width - 1)] as f64;
        }
    }
    for x in 0..width {
        let xu = x as usize;
        let mut acc = 0f64;
        for y in -r..=r {
            acc += tmp[clampi(y, 0, height - 1) * width as usize + xu] as f64;
        }
        for y in 0..height {
            out[y as usize * width as usize + xu] = (acc / win) as f32;
            let out_y = y - r;
            let in_y = y + r + 1;
            acc += tmp[clampi(in_y, 0, height - 1) * width as usize + xu] as f64
                - tmp[clampi(out_y, 0, height - 1) * width as usize + xu] as f64;
        }
    }
    Gray { width: gray.width, height: gray.height, data: out }
}

/// JS: ssim(a, b, win=8). Global SSIM over a window grid.
pub fn ssim(a: &Gray, b: &Gray, win: usize) -> f64 {
    assert!(a.width == b.width && a.height == b.height, "ssim: size mismatch");
    let c1 = (0.01 * 255.0f64).powi(2);
    let c2 = (0.03 * 255.0f64).powi(2);
    let w = a.width;
    let (mut total, mut n) = (0f64, 0f64);
    let winf = (win * win) as f64;
    let mut y = 0;
    while y + win <= a.height {
        let mut x = 0;
        while x + win <= a.width {
            let (mut ma, mut mb) = (0f64, 0f64);
            for yy in 0..win {
                for xx in 0..win {
                    let i = (y + yy) * w + x + xx;
                    ma += a.data[i] as f64;
                    mb += b.data[i] as f64;
                }
            }
            ma /= winf;
            mb /= winf;
            let (mut va, mut vb, mut cov) = (0f64, 0f64, 0f64);
            for yy in 0..win {
                for xx in 0..win {
                    let i = (y + yy) * w + x + xx;
                    let da = a.data[i] as f64 - ma;
                    let db = b.data[i] as f64 - mb;
                    va += da * da;
                    vb += db * db;
                    cov += da * db;
                }
            }
            va /= winf - 1.0;
            vb /= winf - 1.0;
            cov /= winf - 1.0;
            total += ((2.0 * ma * mb + c1) * (2.0 * cov + c2))
                / ((ma * ma + mb * mb + c1) * (va + vb + c2));
            n += 1.0;
            x += win;
        }
        y += win;
    }
    if n != 0.0 {
        total / n
    } else {
        1.0
    }
}

/// JS: ssimShifted(a, b, dx, dy, win=8).
pub fn ssim_shifted(a: &Gray, b: &Gray, dx: i64, dy: i64, win: usize) -> f64 {
    let w = a.width as i64 - dx.abs();
    let h = a.height as i64 - dy.abs();
    if w < win as i64 || h < win as i64 {
        return 0.0;
    }
    let (w, h) = (w as usize, h as usize);
    let mut sa = Gray { width: w, height: h, data: vec![0f32; w * h] };
    let mut sb = Gray { width: w, height: h, data: vec![0f32; w * h] };
    let ax = 0i64.max(-dx) as usize;
    let ay = 0i64.max(-dy) as usize;
    let bx = 0i64.max(dx) as usize;
    let by = 0i64.max(dy) as usize;
    for y in 0..h {
        let sao = (y + ay) * a.width + ax;
        let sbo = (y + by) * b.width + bx;
        sa.data[y * w..y * w + w].copy_from_slice(&a.data[sao..sao + w]);
        sb.data[y * w..y * w + w].copy_from_slice(&b.data[sbo..sbo + w]);
    }
    ssim(&sa, &sb, win)
}

/// JS: structureScore(imgA, imgB, workWidth=256).
pub fn structure_score(img_a: &Image, img_b: &Image, work_width: usize) -> f64 {
    let ww = work_width as f64;
    let h = 8f64.max(round((img_a.height as f64 / img_a.width as f64) * ww));
    let a = blur_gray(&to_gray(&resize(img_a, ww, h)), 2);
    let b = blur_gray(&to_gray(&resize(img_b, ww, h)), 2);
    let win = 8f64.min(2f64.max((ww.min(h) / 8.0).floor())) as usize;
    let mut best = ssim(&a, &b, win);
    let max_shift = 2f64.max(round(ww * 0.04));
    let steps = [-max_shift, -max_shift / 2.0, 0.0, max_shift / 2.0, max_shift];
    for &dy in &steps {
        for &dx in &steps {
            if dx == 0.0 && dy == 0.0 {
                continue;
            }
            best = best.max(ssim_shifted(&a, &b, round(dx) as i64, round(dy) as i64, win));
        }
    }
    best.max(0.0).min(1.0)
}

// ---- color -----------------------------------------------------------------

fn rgb_to_lab(r: f64, g: f64, b: f64) -> [f64; 3] {
    let lin = |c: f64| {
        let c = c / 255.0;
        if c <= 0.04045 {
            c / 12.92
        } else {
            ((c + 0.055) / 1.055).powf(2.4)
        }
    };
    let (rr, gg, bb) = (lin(r), lin(g), lin(b));
    let x = (rr * 0.4124 + gg * 0.3576 + bb * 0.1805) / 0.95047;
    let y = rr * 0.2126 + gg * 0.7152 + bb * 0.0722;
    let z = (rr * 0.0193 + gg * 0.1192 + bb * 0.9505) / 1.08883;
    let f = |t: f64| if t > 0.008856 { t.cbrt() } else { 7.787 * t + 16.0 / 116.0 };
    let (fx, fy, fz) = (f(x), f(y), f(z));
    [116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz)]
}

/// JS: deltaE(lab1, lab2).
pub fn delta_e(l1: [f64; 3], l2: [f64; 3]) -> f64 {
    ((l1[0] - l2[0]).powi(2) + (l1[1] - l2[1]).powi(2) + (l1[2] - l2[2]).powi(2)).sqrt()
}

/// JS: colorHistogram(img, sampleStep=2). 4096-bin (4 bits/channel), f32.
pub fn color_histogram(img: &Image, sample_step: usize) -> Vec<f32> {
    let mut bins = vec![0f32; 4096];
    let mut n = 0f64;
    let mut y = 0;
    while y < img.height {
        let mut x = 0;
        while x < img.width {
            let p = (y * img.width + x) * 4;
            if img.data[p + 3] >= 16 {
                let key = (((img.data[p] >> 4) as usize) << 8)
                    | (((img.data[p + 1] >> 4) as usize) << 4)
                    | (img.data[p + 2] >> 4) as usize;
                bins[key] = (bins[key] as f64 + 1.0) as f32;
                n += 1.0;
            }
            x += sample_step;
        }
        y += sample_step;
    }
    if n != 0.0 {
        for b in bins.iter_mut() {
            *b = (*b as f64 / n) as f32;
        }
    }
    bins
}

/// JS: histogramIntersection(h1, h2).
pub fn histogram_intersection(h1: &[f32], h2: &[f32]) -> f64 {
    let mut s = 0f64;
    for i in 0..h1.len() {
        s += (h1[i] as f64).min(h2[i] as f64);
    }
    s
}

/// A dominant color cluster: hex, coverage (rounded), and Lab.
#[derive(Clone)]
pub struct DominantColor {
    pub hex: String,
    pub coverage: f64,
    pub lab: [f64; 3],
}

struct Cluster {
    rgb: [f64; 3],
    lab: [f64; 3],
    w: f64,
}

/// JS: dominantColors(img, k=6, sampleStep=3).
pub fn dominant_colors(img: &Image, k: usize, sample_step: usize) -> Vec<DominantColor> {
    let hist = color_histogram(img, sample_step);
    let mut entries: Vec<(usize, f64)> = Vec::new();
    for (i, &v) in hist.iter().enumerate() {
        if (v as f64) > 0.0005 {
            entries.push((i, v as f64));
        }
    }
    // stable descending sort by weight
    entries.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
    let mut clusters: Vec<Cluster> = Vec::new();
    for (key, ew) in entries {
        let r = ((key >> 8) & 15) as f64 * 16.0 + 8.0;
        let g = ((key >> 4) & 15) as f64 * 16.0 + 8.0;
        let b = (key & 15) as f64 * 16.0 + 8.0;
        let lab = rgb_to_lab(r, g, b);
        let mut best_i: Option<usize> = None;
        let mut best_d = f64::INFINITY;
        for (ci, c) in clusters.iter().enumerate() {
            let d = delta_e(c.lab, lab);
            if d < best_d {
                best_d = d;
                best_i = Some(ci);
            }
        }
        if let (Some(ci), true) = (best_i, best_d < 14.0) {
            let c = &mut clusters[ci];
            let tw = c.w + ew;
            c.rgb = [
                (c.rgb[0] * c.w + r * ew) / tw,
                (c.rgb[1] * c.w + g * ew) / tw,
                (c.rgb[2] * c.w + b * ew) / tw,
            ];
            c.lab = rgb_to_lab(c.rgb[0], c.rgb[1], c.rgb[2]);
            c.w = tw;
        } else {
            clusters.push(Cluster { rgb: [r, g, b], lab, w: ew });
        }
    }
    clusters.sort_by(|a, b| b.w.partial_cmp(&a.w).unwrap());
    let top: Vec<&Cluster> = clusters.iter().take(k).collect();
    let covered = {
        let s: f64 = top.iter().map(|c| c.w).sum();
        if s == 0.0 {
            1.0
        } else {
            s
        }
    };
    top.into_iter()
        .map(|c| DominantColor {
            hex: to_hex(c.rgb),
            coverage: round_fixed(c.w / covered, 4),
            lab: c.lab,
        })
        .collect()
}

/// JS: paletteMatch(compColors, buildColors).
pub fn palette_match(comp: &[DominantColor], build: &[DominantColor]) -> f64 {
    if comp.is_empty() {
        return 1.0;
    }
    let (mut s, mut wsum) = (0f64, 0f64);
    for c in comp {
        let mut best = f64::INFINITY;
        for b in build {
            best = best.min(delta_e(c.lab, b.lab));
        }
        s += c.coverage * 0f64.max(1.0 - best / 25.0);
        wsum += c.coverage;
    }
    if wsum != 0.0 {
        s / wsum
    } else {
        1.0
    }
}

/// JS: colorScore(imgA, imgB) -> { score, intersection, paletteMatch }.
pub struct ColorScore {
    pub score: f64,
    pub intersection: f64,
    pub palette_match: f64,
}

pub fn color_score(img_a: &Image, img_b: &Image) -> ColorScore {
    let inter = histogram_intersection(&color_histogram(img_a, 2), &color_histogram(img_b, 2));
    let pm = palette_match(&dominant_colors(img_a, 6, 3), &dominant_colors(img_b, 6, 3));
    ColorScore { score: 0.35 * inter + 0.65 * pm, intersection: inter, palette_match: pm }
}

// ---- detail ----------------------------------------------------------------

/// JS: detailGrid(img, cols=12, rows=8, workWidth=512).
pub struct DetailGrid {
    pub cols: usize,
    pub rows: usize,
    pub cells: Vec<f32>,
}

pub fn detail_grid(img: &Image, cols: usize, rows: usize, work_width: usize) -> DetailGrid {
    let ww = work_width as f64;
    let h = (rows as f64).max(round((img.height as f64 / img.width as f64) * ww));
    let g = to_gray(&resize(img, ww, h));
    let mut grid = vec![0f32; cols * rows];
    let mut counts = vec![0f32; cols * rows];
    let gw = g.width;
    for y in 1..g.height - 1 {
        let cy = (rows - 1).min(((y as f64 / g.height as f64) * rows as f64).floor() as usize);
        for x in 1..g.width - 1 {
            let cx = (cols - 1).min(((x as f64 / g.width as f64) * cols as f64).floor() as usize);
            let i = y * gw + x;
            let gx = (g.data[i + 1] as f64 - g.data[i - 1] as f64).abs();
            let gy = (g.data[i + gw] as f64 - g.data[i - gw] as f64).abs();
            let idx = cy * cols + cx;
            grid[idx] = (grid[idx] as f64 + (gx + gy)) as f32;
            counts[idx] = (counts[idx] as f64 + 1.0) as f32;
        }
    }
    for i in 0..grid.len() {
        grid[i] = if counts[i] != 0.0 {
            (grid[i] as f64 / counts[i] as f64) as f32
        } else {
            0.0
        };
    }
    DetailGrid { cols, rows, cells: grid }
}

/// JS: detailScore(imgA, imgB, cols=12, rows=8) -> { score, rawScore, addedFraction }.
pub struct DetailScore {
    pub score: f64,
    pub raw_score: f64,
    pub added_fraction: f64,
}

pub fn detail_score(img_a: &Image, img_b: &Image, cols: usize, rows: usize) -> DetailScore {
    let a = detail_grid(img_a, cols, rows, 512);
    let b = detail_grid(img_b, cols, rows, 512);
    let floor = 1.5f64;
    let (mut s, mut w, mut added, mut added_w) = (0f64, 0f64, 0f64, 0f64);
    for i in 0..a.cells.len() {
        let ca = a.cells[i] as f64;
        let cb = b.cells[i] as f64;
        if ca > floor {
            s += (cb / ca).min(ca / cb) * ca;
            w += ca;
        }
        if cb > ca * 1.8 && cb > floor * 2.0 {
            added += 1.0;
        }
        added_w += 1.0;
    }
    let added_fraction = if added_w != 0.0 { added / added_w } else { 0.0 };
    let raw = if w != 0.0 { s / w } else { 1.0 };
    DetailScore {
        score: 0f64.max(raw - 0.5 * added_fraction),
        raw_score: raw,
        added_fraction,
    }
}

// ---- pixel diff ------------------------------------------------------------

/// JS: diffMap(imgA, imgB, workWidth=384).
pub fn diff_map(img_a: &Image, img_b: &Image, work_width: usize) -> Gray {
    let ww = work_width as f64;
    let h = 8f64.max(round((img_a.height as f64 / img_a.width as f64) * ww));
    let a = resize(img_a, ww, h);
    let b = resize(img_b, ww, h);
    let hh = h as usize;
    let mut out = vec![0f32; work_width * hh];
    let mut p = 0usize;
    for o in out.iter_mut() {
        let dr = a.data[p] as f64 - b.data[p] as f64;
        let dg = a.data[p + 1] as f64 - b.data[p + 1] as f64;
        let db = a.data[p + 2] as f64 - b.data[p + 2] as f64;
        *o = (1f64.min((dr * dr + dg * dg + db * db).sqrt() / 200.0)) as f32;
        p += 4;
    }
    blur_gray(&Gray { width: work_width, height: hh, data: out }, 1)
}

// ---- bands -----------------------------------------------------------------

/// A horizontal band edge (normalized y, strength).
#[derive(Clone)]
pub struct Band {
    pub y: f64,
    pub strength: f64,
}

/// JS: horizontalBands(img, workWidth=128, minGap=0.02).
pub fn horizontal_bands(img: &Image, work_width: usize, min_gap: f64) -> Vec<Band> {
    let ww = work_width as f64;
    let h = 16f64.max(round((img.height as f64 / img.width as f64) * ww));
    let s = resize(img, ww, h);
    let hh = h as usize;
    let mut row_mean = vec![0f32; hh * 3];
    for y in 0..hh {
        let (mut r, mut g, mut b) = (0f64, 0f64, 0f64);
        for x in 0..work_width {
            let p = (y * work_width + x) * 4;
            r += s.data[p] as f64;
            g += s.data[p + 1] as f64;
            b += s.data[p + 2] as f64;
        }
        row_mean[y * 3] = (r / ww) as f32;
        row_mean[y * 3 + 1] = (g / ww) as f32;
        row_mean[y * 3 + 2] = (b / ww) as f32;
    }
    let mut edges: Vec<Band> = Vec::new();
    for y in 1..hh {
        let dr = row_mean[y * 3] as f64 - row_mean[(y - 1) * 3] as f64;
        let dg = row_mean[y * 3 + 1] as f64 - row_mean[(y - 1) * 3 + 1] as f64;
        let db = row_mean[y * 3 + 2] as f64 - row_mean[(y - 1) * 3 + 2] as f64;
        let d = (dr * dr + dg * dg + db * db).sqrt();
        if d > 18.0 {
            edges.push(Band { y: y as f64 / h, strength: 1f64.min(d / 120.0) });
        }
    }
    let mut merged: Vec<Band> = Vec::new();
    for e in edges {
        if let Some(last) = merged.last_mut() {
            if e.y - last.y < min_gap {
                if e.strength > last.strength {
                    last.y = e.y;
                    last.strength = e.strength;
                }
                continue;
            }
        }
        merged.push(e);
    }
    merged
}

/// JS: bandScore(bandsA, bandsB, tol=0.04).
pub fn band_score(a: &[Band], b: &[Band], tol: f64) -> f64 {
    if a.is_empty() && b.is_empty() {
        return 1.0;
    }
    let matched = |from: &[Band], to: &[Band]| -> usize {
        from.iter()
            .filter(|x| to.iter().any(|y| (x.y - y.y).abs() <= tol))
            .count()
    };
    let recall = if !a.is_empty() {
        matched(a, b) as f64 / a.len() as f64
    } else {
        1.0
    };
    let precision = if !b.is_empty() {
        matched(b, a) as f64 / b.len() as f64
    } else {
        1.0
    };
    0.6 * recall + 0.4 * precision
}
