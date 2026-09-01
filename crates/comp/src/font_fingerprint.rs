//! JS: skill/scripts/lib/font-fingerprint.mjs
//!
//! Size-invariant, text-robust shape features for lettering in a raster.
//! `fingerprint(img)` returns the feature vector; `distance(a, b)` compares two
//! vectors. Pure over `Image`; depends only on `metrics::to_gray` and
//! `raster::resize`. Ported line-for-line, including the f32 gray/coverage
//! stores and the `+value.toFixed(4)` rounding of the emitted features.

use crate::jsnum::{round, round_fixed};
use crate::metrics::to_gray;
use crate::raster::{resize, Image};
use once_cell::sync::Lazy;
use std::collections::HashMap;

pub const VBINS: usize = 10;
pub const HQ: [f64; 4] = [0.25, 0.5, 0.75, 0.9];
pub const Z_CLIP: f64 = 3.0;
pub const GROSS_W: f64 = 1.5;
pub const GROSS_STD_WIDTH: f64 = 0.12;
pub const GROSS_STD_WEIGHT: f64 = 0.12;

/// Feature names in fingerprint order (JS: FEATURES).
pub static FEATURES: Lazy<Vec<String>> = Lazy::new(|| {
    let mut v: Vec<String> = vec![
        "advance", "advTall", "advX", "advCV", "gap", "xRatio", "descRatio", "stemW", "contrast",
        "serif", "roundFrac", "densTall", "densX", "runDensity",
    ]
    .into_iter()
    .map(String::from)
    .collect();
    for i in 0..VBINS {
        v.push(format!("vprof{i}"));
    }
    for q in HQ {
        v.push(format!("hrun{}", round(q * 100.0) as i64));
    }
    for q in HQ {
        v.push(format!("vrun{}", round(q * 100.0) as i64));
    }
    for s in ["colq25", "colq75", "wq25", "wq75"] {
        v.push(s.to_string());
    }
    v
});

static FEATURE_IDX: Lazy<HashMap<String, usize>> = Lazy::new(|| {
    FEATURES.iter().enumerate().map(|(i, k)| (k.clone(), i)).collect()
});

fn nfeat() -> usize {
    FEATURES.len()
}

/// A sparse feature vector: `None` == the JS `null`/missing.
#[derive(Clone)]
pub struct FeatureVec {
    pub vals: Vec<Option<f64>>,
}

impl FeatureVec {
    pub fn empty() -> Self {
        FeatureVec { vals: vec![None; nfeat()] }
    }
    pub fn get(&self, key: &str) -> Option<f64> {
        FEATURE_IDX.get(key).and_then(|&i| self.vals[i])
    }
    pub fn set(&mut self, key: &str, v: Option<f64>) {
        if let Some(&i) = FEATURE_IDX.get(key) {
            self.vals[i] = v;
        }
    }
}

/// The fitted per-feature normalization (JS: STATS). `(std, weight)`.
pub fn stats(key: &str) -> Option<(f64, f64)> {
    Some(match key {
        "advance" => (0.07648, 0.0),
        "advTall" => (0.25331, 0.0),
        "advX" => (0.05144, 1.5),
        "advCV" => (0.0857, 1.0),
        "gap" => (0.02668, 1.0),
        "xRatio" => (0.02315, 1.0),
        "descRatio" => (0.17831, 1.0),
        "stemW" => (0.01922, 1.0),
        "contrast" => (0.05969, 3.0),
        "serif" => (0.31477, 0.5),
        "roundFrac" => (0.09341, 1.0),
        "densTall" => (0.05708, 2.0),
        "densX" => (0.07666, 0.0),
        "runDensity" => (0.18199, 1.0),
        "vprof0" => (0.01178, 1.0),
        "vprof1" => (0.01331, 1.0),
        "vprof2" => (0.02745, 1.0),
        "vprof3" => (0.03046, 1.0),
        "vprof4" => (0.01933, 1.0),
        "vprof5" => (0.01737, 1.0),
        "vprof6" => (0.0336, 1.0),
        "vprof7" => (0.03195, 1.0),
        "vprof8" => (0.03271, 1.0),
        "vprof9" => (0.02951, 1.0),
        "hrun25" => (0.01751, 1.0),
        "hrun50" => (0.02124, 1.0),
        "hrun75" => (0.04503, 1.0),
        "hrun90" => (0.06844, 1.0),
        "vrun25" => (0.01895, 1.0),
        "vrun50" => (0.02405, 1.0),
        "vrun75" => (0.06199, 1.0),
        "vrun90" => (0.09486, 1.0),
        "colq25" => (0.02906, 1.0),
        "colq75" => (0.18204, 1.0),
        "wq25" => (0.19862, 1.0),
        "wq75" => (0.09687, 1.0),
        _ => return None,
    })
}

// ---- small numeric helpers (JS med/pct/mean/modeOf) ------------------------

fn med(a: &[f64]) -> Option<f64> {
    if a.is_empty() {
        return None;
    }
    let mut s = a.to_vec();
    s.sort_by(|p, q| p.partial_cmp(q).unwrap());
    let m = s.len() >> 1;
    Some(if s.len() % 2 == 1 { s[m] } else { (s[m - 1] + s[m]) / 2.0 })
}

fn pct(a: &[f64], p: f64) -> Option<f64> {
    if a.is_empty() {
        return None;
    }
    let mut s = a.to_vec();
    s.sort_by(|x, y| x.partial_cmp(y).unwrap());
    let idx = ((p * s.len() as f64).floor() as usize).min(s.len() - 1);
    Some(s[idx])
}

fn mean(a: &[f64]) -> Option<f64> {
    if a.is_empty() {
        None
    } else {
        Some(a.iter().sum::<f64>() / a.len() as f64)
    }
}

struct Mode {
    v: f64,
    n: i64,
}

fn mode_of(vals: &[f64], tol: f64) -> Mode {
    let mut s = vals.to_vec();
    s.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let mut best = f64::NAN;
    let mut best_c: i64 = -1;
    let mut j = 0usize;
    for i in 0..s.len() {
        while s[i] - s[j] > tol {
            j += 1;
        }
        let c = (i - j + 1) as i64;
        if c > best_c {
            best_c = c;
            best = (s[i] + s[j]) / 2.0;
        }
    }
    Mode { v: best, n: best_c }
}

// ---- binarize --------------------------------------------------------------

pub struct Bin {
    pub w: usize,
    pub h: usize,
    pub ink: Vec<u8>,
    pub ink_is_dark: bool,
    pub cov_a: Vec<f32>,
}

impl Bin {
    #[inline]
    fn cov(&self, i: usize) -> f64 {
        self.cov_a[i] as f64
    }
}

fn otsu(gray: &crate::metrics::Gray) -> i64 {
    let mut hist = [0f64; 256];
    for &v in &gray.data {
        let idx = (round(v as f64) as i64).clamp(0, 255) as usize;
        hist[idx] += 1.0;
    }
    let total = gray.data.len() as f64;
    let mut sum = 0f64;
    for (i, &h) in hist.iter().enumerate() {
        sum += i as f64 * h;
    }
    let (mut sum_b, mut w_b, mut best, mut thr) = (0f64, 0f64, 0f64, 128i64);
    for t in 0..256 {
        w_b += hist[t];
        if w_b == 0.0 {
            continue;
        }
        let w_f = total - w_b;
        if w_f == 0.0 {
            break;
        }
        sum_b += t as f64 * hist[t];
        let m_b = sum_b / w_b;
        let m_f = (sum - sum_b) / w_f;
        let between = w_b * w_f * (m_b - m_f).powi(2);
        if between > best {
            best = between;
            thr = t as i64;
        }
    }
    thr
}

fn binarize(img: &Image) -> Bin {
    let g = to_gray(img);
    let mut thr = otsu(&g) as f64;
    let mut dark = 0usize;
    for &v in &g.data {
        if (v as f64) < thr {
            dark += 1;
        }
    }
    if dark == 0 {
        thr += 1.0;
        for &v in &g.data {
            if (v as f64) < thr {
                dark += 1;
            }
        }
    }
    let ink_is_dark = dark <= g.data.len() / 2;
    let mut ink = vec![0u8; g.data.len()];
    let (mut s_i, mut n_i, mut s_g, mut n_g) = (0f64, 0usize, 0f64, 0usize);
    for i in 0..g.data.len() {
        let gv = g.data[i] as f64;
        let on = if ink_is_dark { gv < thr } else { gv >= thr };
        ink[i] = on as u8;
        if on {
            s_i += gv;
            n_i += 1;
        } else {
            s_g += gv;
            n_g += 1;
        }
    }
    let ink_level = if n_i > 0 {
        s_i / n_i as f64
    } else if ink_is_dark {
        0.0
    } else {
        255.0
    };
    let ground_level = if n_g > 0 {
        s_g / n_g as f64
    } else if ink_is_dark {
        255.0
    } else {
        0.0
    };
    let den = {
        let d = ground_level - ink_level;
        if d == 0.0 {
            1.0
        } else {
            d
        }
    };
    let mut cov_a = vec![0f32; g.data.len()];
    for i in 0..g.data.len() {
        cov_a[i] = (0f64.max(1f64.min((ground_level - g.data[i] as f64) / den))) as f32;
    }
    Bin { w: g.width, h: g.height, ink, ink_is_dark, cov_a }
}

// ---- lines -----------------------------------------------------------------

#[derive(Clone)]
pub struct Line {
    pub y0: usize,
    pub y1: usize,
    pub mass: f64,
}

struct WorkLine {
    y0: usize,
    y1: usize,
    run: usize,
    mass: f64,
    tall: bool,
}

fn find_lines(bin: &Bin) -> Vec<Line> {
    let (w, h, ink) = (bin.w, bin.h, &bin.ink);
    let mut col_ink = vec![0u32; w];
    for y in 0..h {
        let o = y * w;
        for x in 0..w {
            col_ink[x] += ink[o + x] as u32;
        }
    }
    let mut col_ok = vec![0u8; w];
    let mut ok_count = 0usize;
    for x in 0..w {
        if (col_ink[x] as f64) < h as f64 * 0.85 {
            col_ok[x] = 1;
            ok_count += 1;
        }
    }
    if ok_count == 0 {
        return Vec::new();
    }
    let mut row_ink = vec![0u32; h];
    for y in 0..h {
        let mut c = 0u32;
        let o = y * w;
        for x in 0..w {
            if col_ok[x] == 1 {
                c += ink[o + x] as u32;
            }
        }
        row_ink[y] = c;
    }
    let floor = 1f64.max(w as f64 * 0.004);
    let mut runs: Vec<(usize, usize)> = Vec::new();
    let mut y = 0usize;
    while y < h {
        if row_ink[y] as f64 > floor {
            let y0 = y;
            while y < h
                && (row_ink[y] as f64 > floor
                    || (y + 1 < h && row_ink[y + 1] as f64 > floor))
            {
                y += 1;
            }
            if y - y0 >= 4 {
                runs.push((y0, y));
            }
        } else {
            y += 1;
        }
    }
    let mut lines: Vec<WorkLine> = Vec::new();
    for (ri, &(ry0, ry1)) in runs.iter().enumerate() {
        let mut peak = 0u32;
        for yy in ry0..ry1 {
            peak = peak.max(row_ink[yy]);
        }
        let valley = peak as f64 * 0.15;
        let mut start = ry0;
        let mut in_valley = false;
        let mut valley_start = 0usize;
        for yy in ry0..ry1 {
            let low = (row_ink[yy] as f64) < valley;
            if low && !in_valley {
                in_valley = true;
                valley_start = yy;
            }
            if !low && in_valley {
                in_valley = false;
                if yy - valley_start >= 3 && valley_start.wrapping_sub(start) >= 4 && valley_start >= start {
                    lines.push(WorkLine { y0: start, y1: valley_start, run: ri, mass: 0.0, tall: false });
                    start = yy;
                }
            }
        }
        if ry1 - start >= 4 {
            lines.push(WorkLine { y0: start, y1: ry1, run: ri, mass: 0.0, tall: false });
        }
    }
    for ln in lines.iter_mut() {
        let mut m = 0f64;
        for yy in ln.y0..ln.y1 {
            m += row_ink[yy] as f64;
        }
        ln.mass = m;
    }
    let mass_max = lines.iter().fold(1f64, |acc, l| acc.max(l.mass));
    let real: Vec<&WorkLine> = lines.iter().filter(|l| l.mass >= mass_max * 0.05).collect();
    if real.len() >= 3 {
        let mut hs: Vec<usize> = real.iter().map(|l| l.y1 - l.y0).collect();
        hs.sort_unstable();
        let med_h = hs[hs.len() / 2] as f64;
        for ln in lines.iter_mut() {
            if (ln.y1 - ln.y0) as f64 > med_h * 3.0 {
                ln.tall = true;
            }
        }
    }
    let max_mass = lines.iter().filter(|l| !l.tall).fold(0f64, |acc, l| acc.max(l.mass));
    let mut merged: Vec<Line> = Vec::new();
    for i in 0..lines.len() {
        if lines[i].tall {
            continue;
        }
        if lines[i].mass >= max_mass * 0.3 {
            merged.push(Line { y0: lines[i].y0, y1: lines[i].y1, mass: lines[i].mass });
            continue;
        }
        if i + 1 < lines.len() {
            let (li_y0, li_y1, li_run) = (lines[i].y0, lines[i].y1, lines[i].run);
            let next = &lines[i + 1];
            if next.run == li_run
                && next.mass >= max_mass * 0.3
                && (li_y1 - li_y0) as f64 <= (next.y1 - next.y0) as f64 * 0.5
            {
                lines[i + 1].y0 = li_y0;
            }
        }
    }
    merged
}

// ---- line metrics ----------------------------------------------------------

struct LMetrics {
    base: f64,
    #[allow(dead_code)] // JS keeps both R and cap (cap === R); mirrored for fidelity
    r: f64,
    cap: f64,
    xh: Option<f64>,
    desc_ratio: Option<f64>,
    tol: f64,
    x_l: usize,
    x_r: usize,
    hs: Vec<f64>,
    ln: Line,
}

fn line_metrics(bin: &Bin, ln: &Line) -> Option<LMetrics> {
    let (w, ink) = (bin.w, &bin.ink);
    let mut cols: Vec<(usize, f64, f64)> = Vec::new(); // (x, top, bot)
    for x in 0..w {
        let mut top: i64 = -1;
        let mut bot: i64 = -1;
        for yy in ln.y0..ln.y1 {
            if ink[yy * w + x] == 1 {
                if top < 0 {
                    top = yy as i64;
                }
                bot = yy as i64 + 1;
            }
        }
        if top < 0 {
            continue;
        }
        let t = if top > 0 {
            top as f64 - bin.cov((top as usize - 1) * w + x)
        } else {
            top as f64
        };
        let b = if (bot as usize) < bin.h {
            bot as f64 + bin.cov(bot as usize * w + x)
        } else {
            bot as f64
        };
        cols.push((x, t, b));
    }
    if cols.len() < 8 {
        return None;
    }
    let rough_h = pct(&cols.iter().map(|c| c.2 - c.1).collect::<Vec<_>>(), 0.9)?;
    let tol = 1f64.max(round(rough_h * 0.04));
    let base_f = mode_of(&cols.iter().map(|c| c.2).collect::<Vec<_>>(), tol).v;
    let base = round(base_f);
    let hs: Vec<f64> = cols
        .iter()
        .filter(|c| c.2 <= base_f + tol * 1.5)
        .map(|c| base_f - c.1)
        .filter(|&h| h > 0.0)
        .collect();
    if hs.len() < 8 {
        return None;
    }
    let h_max_abs = pct(&hs, 0.995)?;
    let top_cluster: Vec<f64> = hs.iter().cloned().filter(|&h| h >= h_max_abs * 0.94).collect();
    let r = med(&top_cluster)?;
    if r < 4.0 {
        return None;
    }
    let low_hs: Vec<f64> = hs.iter().cloned().filter(|&h| h >= r * 0.3 && h <= r * 0.86).collect();
    let mut xh: Option<f64> = None;
    if low_hs.len() as f64 >= 6f64.max(hs.len() as f64 * 0.12) {
        let m = mode_of(&low_hs, tol);
        if m.n as f64 >= 4f64.max(low_hs.len() as f64 * 0.25) {
            xh = Some(m.v);
        }
    }
    let dsc: Vec<f64> = cols
        .iter()
        .filter(|c| c.2 > base_f + tol * 1.5 && c.1 < base_f - r * 0.3)
        .map(|c| (c.2 - base_f) / r)
        .collect();
    let desc_ratio = if dsc.len() >= 4 { pct(&dsc, 0.9) } else { None };
    Some(LMetrics {
        base,
        r,
        cap: r,
        xh,
        desc_ratio,
        tol,
        x_l: cols[0].0,
        x_r: cols[cols.len() - 1].0 + 1,
        hs,
        ln: ln.clone(),
    })
}

// ---- segmentation ----------------------------------------------------------

struct Glyph {
    x0: usize,
    x1: usize,
    w: usize,
    top: i64,
    bot: i64,
    h: i64,
    area: f64,
}

fn segment(bin: &Bin, ln: &Line, m: &LMetrics) -> Vec<Glyph> {
    let (w, ink) = (bin.w, &bin.ink);
    let band_top = (ln.y0 as f64).max(round(m.base - m.xh.unwrap_or(m.cap * 0.6))) as usize;
    let base_u = m.base as usize;
    let mut col_band = vec![0u32; w];
    for yy in band_top..base_u {
        let o = yy * w;
        for x in m.x_l..m.x_r {
            col_band[x] += ink[o + x] as u32;
        }
    }
    let mut runs: Vec<(usize, usize)> = Vec::new();
    let mut x = m.x_l;
    while x < m.x_r {
        if col_band[x] >= 1 {
            let x0 = x;
            while x < m.x_r && col_band[x] >= 1 {
                x += 1;
            }
            runs.push((x0, x));
        } else {
            x += 1;
        }
    }
    let mut out = Vec::new();
    for (rx0, rx1) in runs {
        let mut top: i64 = -1;
        let mut bot: i64 = -1;
        let mut area = 0f64;
        for yy in ln.y0..ln.y1 {
            let mut c = 0u32;
            let mut cv = 0f64;
            let o = yy * w;
            for xx in rx0..rx1 {
                c += ink[o + xx] as u32;
                cv += bin.cov_a[o + xx] as f64;
            }
            if c > 0 {
                if top < 0 {
                    top = yy as i64;
                }
                bot = yy as i64 + 1;
            }
            area += cv;
        }
        if top >= 0 {
            out.push(Glyph {
                x0: rx0,
                x1: rx1,
                w: rx1 - rx0,
                top,
                bot,
                h: bot - top,
                area,
            });
        }
    }
    out
}

// ---- measure ---------------------------------------------------------------

struct Measured {
    cap_height_px: f64,
    glyphs: i64,
    all_caps: bool,
    feats: FeatureVec,
    dens_tall: Option<f64>,
    dens_x: Option<f64>,
}

fn measure(bin: &Bin, lines: &[Line]) -> Option<Measured> {
    let (w, h, ink, cov_a) = (bin.w, bin.h, &bin.ink, &bin.cov_a);
    let h_len = |o: usize, x0: usize, x1: usize| -> f64 {
        let mut s = 0f64;
        let lo = x0.saturating_sub(1);
        let hi = (x1 + 1).min(w);
        for x in lo..hi {
            s += cov_a[o + x] as f64;
        }
        s
    };
    let v_len = |x: usize, y0: usize, y1: usize| -> f64 {
        let mut s = 0f64;
        let lo = y0.saturating_sub(1);
        let hi = (y1 + 1).min(h);
        for y in lo..hi {
            s += cov_a[y * w + x] as f64;
        }
        s
    };

    let mut glyph_n = 0i64;
    let (mut per_xh, mut per_desc, mut per_run_density): (Vec<f64>, Vec<f64>, Vec<f64>) =
        (vec![], vec![], vec![]);
    let mut all_caps_lines = 0i64;
    let mut vprof = [0f64; VBINS];
    let (mut hruns, mut vruns, mut col_hs, mut widths): (Vec<f64>, Vec<f64>, Vec<f64>, Vec<f64>) =
        (vec![], vec![], vec![], vec![]);
    let (mut adv_tall, mut adv_all, mut adv_x, mut gaps): (Vec<f64>, Vec<f64>, Vec<f64>, Vec<f64>) =
        (vec![], vec![], vec![], vec![]);
    let (mut stems, mut thins, mut serif_r): (Vec<f64>, Vec<f64>, Vec<f64>) = (vec![], vec![], vec![]);
    let (mut round_flags, mut dens_tall, mut dens_x): (Vec<f64>, Vec<f64>, Vec<f64>) =
        (vec![], vec![], vec![]);
    let (mut cap_sum, mut cap_n) = (0f64, 0i64);

    let mut metrics: Vec<LMetrics> = lines.iter().filter_map(|ln| line_metrics(bin, ln)).collect();
    if metrics.len() >= 2 {
        let with_x = metrics.iter().filter(|m| m.xh.is_some()).count();
        if with_x * 2 <= metrics.len() {
            for m in metrics.iter_mut() {
                m.xh = None;
            }
        }
    }
    for m in &metrics {
        let ln = &m.ln;
        let (base, cap, xh, tol, x_l, x_r) = (m.base, m.cap, m.xh, m.tol, m.x_l, m.x_r);
        cap_sum += cap;
        cap_n += 1;
        if let Some(xhv) = xh {
            per_xh.push(xhv / cap);
        } else {
            all_caps_lines += 1;
        }
        if let Some(dr) = m.desc_ratio {
            per_desc.push(dr);
        }
        for &hh in &m.hs {
            col_hs.push(hh / cap);
        }
        for yy in ln.y0..ln.y1 {
            let u = (base - yy as f64 - 0.5) / cap;
            let bi = ((u + 0.35) / 1.4 * VBINS as f64).floor() as i64;
            if bi < 0 || bi >= VBINS as i64 {
                continue;
            }
            let mut c = 0u32;
            let o = yy * w;
            for x in x_l..x_r {
                c += ink[o + x] as u32;
            }
            vprof[bi as usize] += c as f64;
        }
        let hy_start = (ln.y0 as f64).max(round(base - cap)) as usize;
        for yy in hy_start..base as usize {
            let o = yy * w;
            let mut x = x_l;
            while x < x_r {
                if ink[o + x] == 1 {
                    let x0 = x;
                    while x < x_r && ink[o + x] == 1 {
                        x += 1;
                    }
                    hruns.push(h_len(o, x0, x) / cap);
                } else {
                    x += 1;
                }
            }
        }
        for x in x_l..x_r {
            let mut yy = ln.y0;
            while yy < ln.y1 {
                if ink[yy * w + x] == 1 {
                    let y0 = yy;
                    while yy < ln.y1 && ink[yy * w + x] == 1 {
                        yy += 1;
                    }
                    vruns.push(v_len(x, y0, yy) / cap);
                } else {
                    yy += 1;
                }
            }
        }
        let gl = segment(bin, ln, m);
        let big: Vec<&Glyph> = gl
            .iter()
            .filter(|g| g.w as f64 >= cap * 0.12 && (base - g.top as f64) >= cap * 0.3)
            .collect();
        glyph_n += big.len() as i64;
        let on_base: Vec<&&Glyph> =
            big.iter().filter(|g| (g.bot as f64 - base).abs() <= tol * 1.5).collect();
        let cap_g: Vec<&&&Glyph> =
            on_base.iter().filter(|g| base - g.top as f64 >= cap * 0.88).collect();
        let xs: Vec<&&&Glyph> = if let Some(xhv) = xh {
            on_base
                .iter()
                .filter(|g| (base - g.top as f64 - xhv).abs() <= (tol * 1.5).max(cap * 0.05))
                .collect()
        } else {
            vec![]
        };
        for g in &cap_g {
            adv_tall.push(g.w as f64 / cap);
            dens_tall.push(g.area / (g.w as f64 * g.h as f64));
        }
        for g in &xs {
            dens_x.push(g.area / (g.w as f64 * g.h as f64));
            adv_x.push(g.w as f64 / cap);
        }
        for g in &on_base {
            adv_all.push(g.w as f64 / cap);
            widths.push(g.w as f64 / cap);
            round_flags.push(if g.w as f64 / (base - g.top as f64) > 0.9 { 1.0 } else { 0.0 });
        }
        for i in 0..big.len().saturating_sub(1) {
            let gap = big[i + 1].x0 as f64 - big[i].x1 as f64;
            if gap >= 0.0 && gap < cap * 0.6 {
                gaps.push(gap / cap);
            }
        }
        let x_top = base - xh.unwrap_or(cap * 0.55);
        let band_top = round(x_top + (base - x_top) * 0.2);
        let band_bot = round(base - (base - x_top) * 0.2);
        let (mut run_count, mut run_rows) = (0f64, 0f64);
        let mut yy = band_top as i64;
        while yy < band_bot as i64 {
            let o = yy as usize * w;
            let mut x = x_l;
            run_rows += 1.0;
            while x < x_r {
                if ink[o + x] == 1 {
                    let x0 = x;
                    while x < x_r && ink[o + x] == 1 {
                        x += 1;
                    }
                    let l = h_len(o, x0, x);
                    run_count += 1.0;
                    if l < cap * 0.5 {
                        stems.push(l / cap);
                    }
                } else {
                    x += 1;
                }
            }
            yy += 1;
        }
        if run_rows > 0.0 {
            per_run_density.push((run_count / run_rows) / ((x_r - x_l) as f64 / cap));
        }
        for x in x_l..x_r {
            let mut yy = ln.y0;
            while yy < ln.y1 {
                if ink[yy * w + x] == 1 {
                    let y0 = yy;
                    while yy < ln.y1 && ink[yy * w + x] == 1 {
                        yy += 1;
                    }
                    let l = v_len(x, y0, yy);
                    if l < cap * 0.35 {
                        thins.push(l / cap);
                    }
                } else {
                    yy += 1;
                }
            }
        }
        // serif
        let run_at = |yy: usize, x: usize| -> f64 {
            let o = yy * w;
            if ink[o + x] == 0 {
                return 0.0;
            }
            let mut a = x;
            let mut b = x;
            while a > x_l && ink[o + a - 1] == 1 {
                a -= 1;
            }
            while b + 1 < x_r && ink[o + b + 1] == 1 {
                b += 1;
            }
            h_len(o, a, b + 1)
        };
        let y_mid = round(base - cap * 0.4) as usize;
        let y_hi = round(base - cap * 0.18) as usize;
        let y_foot = (base - 1f64.max(round(cap * 0.04))) as usize;
        let base_i = base as usize;
        let mut x = x_l;
        while x < x_r {
            let mut yy = base_i - 1;
            if ink[yy * w + x] == 0 {
                x += 1;
                continue;
            }
            while yy > ln.y0 && ink[(yy - 1) * w + x] == 1 {
                yy -= 1;
            }
            if yy > y_mid {
                x += 1;
                continue;
            }
            let x0 = x;
            x += 1;
            while x < x_r && ink[(base_i - 1) * w + x] == 1 && ink[y_mid * w + x] == 1 {
                x += 1;
            }
            let xc = round((x0 + x - 1) as f64 / 2.0) as usize;
            let w_mid = run_at(y_mid, xc);
            let w_hi = run_at(y_hi, xc);
            let w_foot = run_at(y_foot, xc);
            if w_mid > 0.0 && w_mid < cap * 0.5 && w_hi <= w_mid * 1.3 && w_hi >= w_mid * 0.7 {
                serif_r.push(w_foot / w_mid);
            }
        }
    }
    if cap_n == 0 {
        return None;
    }
    let stem_w = med(&stems);
    let thin_w = med(&thins);
    let adv_m = med(&adv_all);
    let adv_sd = if adv_all.len() > 3 {
        let am = adv_m.unwrap();
        Some((adv_all.iter().map(|v| (v - am).powi(2)).sum::<f64>() / adv_all.len() as f64).sqrt())
    } else {
        None
    };
    let vsum = {
        let s: f64 = vprof.iter().sum();
        if s == 0.0 {
            1.0
        } else {
            s
        }
    };
    let mut feats = FeatureVec::empty();
    for i in 0..VBINS {
        feats.set(&format!("vprof{i}"), Some(vprof[i] / vsum));
    }
    for q in HQ {
        feats.set(&format!("hrun{}", round(q * 100.0) as i64), pct(&hruns, q));
        feats.set(&format!("vrun{}", round(q * 100.0) as i64), pct(&vruns, q));
    }
    feats.set("colq25", pct(&col_hs, 0.25));
    feats.set("colq75", pct(&col_hs, 0.75));
    feats.set("wq25", pct(&widths, 0.25));
    feats.set("wq75", pct(&widths, 0.75));
    feats.set("advance", adv_m);
    feats.set("advTall", if adv_tall.is_empty() { None } else { med(&adv_tall) });
    feats.set("advX", if adv_x.is_empty() { None } else { med(&adv_x) });
    feats.set(
        "advCV",
        match (adv_sd, adv_m) {
            (Some(sd), Some(am)) if am != 0.0 => Some(sd / am),
            _ => None,
        },
    );
    feats.set("gap", Some(if gaps.is_empty() { 0.0 } else { med(&gaps).unwrap() }));
    feats.set("xRatio", if per_xh.is_empty() { None } else { med(&per_xh) });
    feats.set("descRatio", if per_desc.is_empty() { None } else { med(&per_desc) });
    feats.set("runDensity", med(&per_run_density));
    feats.set("stemW", stem_w);
    feats.set(
        "contrast",
        match (stem_w, thin_w) {
            (Some(s), Some(t)) if s != 0.0 && t != 0.0 => Some(s / t),
            _ => None,
        },
    );
    feats.set("serif", if serif_r.len() >= 3 { med(&serif_r) } else { None });
    feats.set("roundFrac", if round_flags.is_empty() { None } else { mean(&round_flags) });
    let dt = if dens_tall.is_empty() { None } else { med(&dens_tall) };
    let dx = if dens_x.is_empty() { None } else { med(&dens_x) };
    feats.set("densTall", dt);
    feats.set("densX", dx);

    Some(Measured {
        cap_height_px: cap_sum / cap_n as f64,
        glyphs: glyph_n,
        all_caps: all_caps_lines * 2 > cap_n,
        feats,
        dens_tall: dt,
        dens_x: dx,
    })
}

// ---- isolate ---------------------------------------------------------------

struct Iso {
    lines: Vec<Line>,
    x0: usize,
    x1: usize,
    dropped: i64,
}

fn isolate_dominant(bin: &Bin, lines: &[Line], tol: f64) -> Option<Iso> {
    struct Item {
        ln: Line,
        cap: f64,
        base: f64,
        x_l: usize,
        x_r: usize,
    }
    let mut ms: Vec<Item> = Vec::new();
    for ln in lines {
        if let Some(m) = line_metrics(bin, ln) {
            ms.push(Item { ln: ln.clone(), cap: m.cap, base: m.base, x_l: m.x_l, x_r: m.x_r });
        }
    }
    if ms.is_empty() {
        return None;
    }
    struct Clu {
        cap: f64,
        idxs: Vec<usize>,
        mass: f64,
    }
    // iterate items sorted by cap desc (stable)
    let mut order: Vec<usize> = (0..ms.len()).collect();
    order.sort_by(|&a, &b| ms[b].cap.partial_cmp(&ms[a].cap).unwrap());
    let mut clusters: Vec<Clu> = Vec::new();
    for &i in &order {
        let cap = ms[i].cap;
        let found = clusters.iter_mut().find(|cl| (cl.cap - cap).abs() <= cl.cap * tol);
        if let Some(c) = found {
            c.idxs.push(i);
            c.mass += ms[i].ln.mass;
        } else {
            clusters.push(Clu { cap, idxs: vec![i], mass: ms[i].ln.mass });
        }
    }
    // sort clusters: multi (n>=3) first, then mass desc, then cap desc
    clusters.sort_by(|a, b| {
        let a_multi = a.idxs.len() >= 3;
        let b_multi = b.idxs.len() >= 3;
        if a_multi != b_multi {
            return if a_multi { std::cmp::Ordering::Less } else { std::cmp::Ordering::Greater };
        }
        b.mass
            .partial_cmp(&a.mass)
            .unwrap()
            .then(b.cap.partial_cmp(&a.cap).unwrap())
    });
    let keep_idxs = &clusters[0].idxs;
    let cap_max = keep_idxs.iter().map(|&i| ms[i].cap).fold(f64::NEG_INFINITY, f64::max);
    let (w, ink) = (bin.w, &bin.ink);
    let mut x0 = w;
    let mut x1 = 0usize;
    for &ii in keep_idxs {
        let it = &ms[ii];
        let top = round(it.base - it.cap * 0.75) as usize;
        let base_u = it.base as usize;
        for x in it.x_l..it.x_r {
            let mut tall = false;
            let mut y = top;
            while y < base_u && !tall {
                if ink[y * w + x] == 1 {
                    tall = true;
                }
                y += 1;
            }
            if !tall {
                continue;
            }
            let mut run = 0f64;
            let mut best = 0f64;
            for yy in it.ln.y0..it.ln.y1 {
                if ink[yy * w + x] == 1 {
                    run += 1.0;
                    if run > best {
                        best = run;
                    }
                } else {
                    run = 0.0;
                }
            }
            if best >= it.cap * 0.5 {
                if x < x0 {
                    x0 = x;
                }
                if x + 1 > x1 {
                    x1 = x + 1;
                }
            }
        }
    }
    if x1 <= x0 {
        return None;
    }
    let pad = round(cap_max * 0.5) as usize;
    Some(Iso {
        lines: keep_idxs.iter().map(|&i| ms[i].ln.clone()).collect(),
        x0: x0.saturating_sub(pad),
        x1: (x1 + pad).min(w),
        dropped: (ms.len() - keep_idxs.len()) as i64,
    })
}

fn mask_outside(bin: &Bin, x0: usize, x1: usize, lines: &[Line]) -> Bin {
    let (w, h) = (bin.w, bin.h);
    let mut keep_row = vec![0u8; h];
    for ln in lines {
        for y in ln.y0..ln.y1 {
            keep_row[y] = 1;
        }
    }
    let mut ink2 = vec![0u8; bin.ink.len()];
    let mut cov2 = vec![0f32; bin.cov_a.len()];
    for y in 0..h {
        if keep_row[y] == 0 {
            continue;
        }
        for x in x0..x1 {
            let i = y * w + x;
            ink2[i] = bin.ink[i];
            cov2[i] = bin.cov_a[i];
        }
    }
    Bin { w, h, ink: ink2, ink_is_dark: bin.ink_is_dark, cov_a: cov2 }
}

// ---- public fingerprint ----------------------------------------------------

/// A comp/crop fingerprint (JS: fingerprint() return object).
#[derive(Clone)]
pub struct Fingerprint {
    pub lines: usize,
    pub glyphs: i64,
    pub cap_height_px: f64,
    pub ink_is_dark: bool,
    pub upsampled: bool,
    pub all_caps: bool,
    pub isolated_from: i64,
    pub weight: Option<f64>,
    pub feats: FeatureVec,
}

impl Fingerprint {
    pub fn get(&self, key: &str) -> Option<f64> {
        self.feats.get(key)
    }
}

pub struct FpOpts {
    pub min_cap: f64,
    pub min_glyphs: i64,
    pub isolate: bool,
}

impl Default for FpOpts {
    fn default() -> Self {
        FpOpts { min_cap: 24.0, min_glyphs: 3, isolate: true }
    }
}

/// JS: fingerprint(img, {minCap, minGlyphs, isolate}). None == no lettering.
pub fn fingerprint(img: &Image, opts: &FpOpts) -> Option<Fingerprint> {
    let mut bin = binarize(img);
    let mut lines = find_lines(&bin);
    if lines.is_empty() {
        return None;
    }
    let mut isolated = 0i64;
    if opts.isolate && lines.len() > 1 {
        if let Some(iso) = isolate_dominant(&bin, &lines, 0.28) {
            if iso.dropped > 0 || (iso.x1 - iso.x0) < ((bin.w as f64) * 0.9) as usize {
                bin = mask_outside(&bin, iso.x0, iso.x1, &iso.lines);
                lines = iso.lines;
                isolated = iso.dropped;
            }
        }
    }
    let mut f = measure(&bin, &lines)?;
    if f.glyphs < opts.min_glyphs {
        return None;
    }
    let mut scale = 1f64;
    if f.cap_height_px < opts.min_cap && f.cap_height_px >= 4.0 {
        scale = 4f64.min((opts.min_cap / f.cap_height_px).ceil());
        let up = resize(img, img.width as f64 * scale, img.height as f64 * scale);
        bin = binarize(&up);
        lines = find_lines(&bin);
        if opts.isolate && lines.len() > 1 {
            if let Some(iso2) = isolate_dominant(&bin, &lines, 0.28) {
                if iso2.dropped > 0 || (iso2.x1 - iso2.x0) < ((bin.w as f64) * 0.9) as usize {
                    bin = mask_outside(&bin, iso2.x0, iso2.x1, &iso2.lines);
                    lines = iso2.lines;
                    isolated = isolated.max(iso2.dropped);
                }
            }
        }
        let f2 = if !lines.is_empty() { measure(&bin, &lines) } else { None };
        match f2 {
            Some(v) => f = v,
            None => scale = 1.0,
        }
    }
    let weight = if f.dens_tall.is_none() && f.dens_x.is_none() {
        None
    } else {
        Some(round_fixed(f.dens_tall.or(f.dens_x).unwrap(), 4))
    };
    let mut out_feats = FeatureVec::empty();
    for (i, k) in FEATURES.iter().enumerate() {
        out_feats.vals[i] = f.feats.get(k).map(|v| round_fixed(v, 4));
    }
    Some(Fingerprint {
        lines: lines.len(),
        glyphs: f.glyphs,
        cap_height_px: round_fixed(f.cap_height_px / scale, 1),
        ink_is_dark: bin.ink_is_dark,
        upsampled: scale > 1.0,
        all_caps: f.all_caps,
        isolated_from: isolated,
        weight,
        feats: out_feats,
    })
}

// ---- distance --------------------------------------------------------------

pub struct GrossGap {
    pub width: Option<f64>,
    pub weight: Option<f64>,
}

/// JS: grossGap(a, b). `a`/`b` are anything with `get(key) -> Option<f64>`.
pub fn gross_gap(a: &dyn Fn(&str) -> Option<f64>, b: &dyn Fn(&str) -> Option<f64>) -> GrossGap {
    let pick = |f: &dyn Fn(&str) -> Option<f64>, keys: &[&str]| -> Option<(&'static str, f64)> {
        for &k in keys {
            if let Some(v) = f(k) {
                // return the &'static str variant
                let ks: &'static str = match k {
                    "advX" => "advX",
                    "advTall" => "advTall",
                    "advance" => "advance",
                    "densTall" => "densTall",
                    "densX" => "densX",
                    "stemW" => "stemW",
                    _ => continue,
                };
                return Some((ks, v));
            }
        }
        None
    };
    let wa = pick(a, &["advX", "advTall", "advance"]);
    let wb = wa.and_then(|(k, _)| b(k).map(|v| (k, v)));
    let ha = pick(a, &["densTall", "densX", "stemW"]);
    let hb = ha.and_then(|(k, _)| b(k).map(|v| (k, v)));
    let gap = |x: Option<(&str, f64)>, y: Option<(&str, f64)>| -> Option<f64> {
        match (x, y) {
            (Some((_, xv)), Some((_, yv))) if xv > 0.0 && yv > 0.0 => Some((yv / xv).ln().abs()),
            _ => None,
        }
    };
    GrossGap { width: gap(wa, wb), weight: gap(ha, hb) }
}

/// JS: distance(a, b) with defaults p=1, zClip=3, gross=true.
pub fn distance(a: &dyn Fn(&str) -> Option<f64>, b: &dyn Fn(&str) -> Option<f64>) -> f64 {
    let (mut d, mut wsum) = (0f64, 0f64);
    let g = gross_gap(a, b);
    for (val, std) in [(g.width, GROSS_STD_WIDTH), (g.weight, GROSS_STD_WEIGHT)] {
        if let Some(gv) = val {
            let z = Z_CLIP.min(gv / std);
            d += GROSS_W * z;
            wsum += GROSS_W;
        }
    }
    for k in FEATURES.iter() {
        let s = match stats(k) {
            Some((std, w)) if w != 0.0 => (std, w),
            _ => continue,
        };
        let (av, bv) = (a(k), b(k));
        if let (Some(av), Some(bv)) = (av, bv) {
            let z = Z_CLIP.min((av - bv).abs() / s.0);
            d += s.1 * z;
            wsum += s.1;
        }
    }
    if wsum == 0.0 {
        return f64::INFINITY;
    }
    d / wsum
}

/// Convenience: distance where both sides are `FeatureVec`-like accessors.
pub fn distance_fp(a: &Fingerprint, b: &FeatureVec) -> f64 {
    distance(&|k| a.get(k), &|k| b.get(k))
}
