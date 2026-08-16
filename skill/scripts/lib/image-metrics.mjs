/**
 * Perceptual measures for comparing a comp with a build screenshot. Pure
 * functions over `{ width, height, data }` RGBA images; no I/O.
 *
 * Three families, because a build fails a comp in three separable ways:
 *
 * - structure: is the composition the same? Measured as SSIM over a blurred
 *   grayscale downsample, which forgives font hinting and a few pixels of
 *   drift and punishes a moved, missing, or invented region.
 * - color: is the palette and its distribution the same? Histogram
 *   intersection in a coarse quantized space plus a dominant-color extraction,
 *   so a navy page built from a bone comp fails even if the shapes match.
 * - detail: is the material there? Local high-frequency energy per cell. A
 *   comp with an illustration, texture, or photograph carries energy a flat
 *   CSS stand-in does not; the ratio build/comp per region is the most direct
 *   measure of "the plate got replaced by a gradient".
 */
import { resize } from './raster.mjs';

export function toGray(img) {
  const g = new Float32Array(img.width * img.height);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) {
    const a = img.data[p + 3] / 255;
    // composite over white so transparent regions read as the page ground
    const r = img.data[p] * a + 255 * (1 - a), gg = img.data[p + 1] * a + 255 * (1 - a), b = img.data[p + 2] * a + 255 * (1 - a);
    g[i] = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
  }
  return { width: img.width, height: img.height, data: g };
}

/** Separable box blur on a float gray image, radius r. */
export function blurGray(gray, r) {
  if (r <= 0) return gray;
  const { width, height, data } = gray;
  const tmp = new Float32Array(data.length), out = new Float32Array(data.length);
  const win = 2 * r + 1;
  for (let y = 0; y < height; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += data[y * width + Math.min(width - 1, Math.max(0, x))];
    for (let x = 0; x < width; x++) {
      tmp[y * width + x] = acc / win;
      const outX = x - r, inX = x + r + 1;
      acc += data[y * width + Math.min(width - 1, inX)] - data[y * width + Math.max(0, outX)];
    }
  }
  for (let x = 0; x < width; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(height - 1, Math.max(0, y)) * width + x];
    for (let y = 0; y < height; y++) {
      out[y * width + x] = acc / win;
      const outY = y - r, inY = y + r + 1;
      acc += tmp[Math.min(height - 1, inY) * width + x] - tmp[Math.max(0, outY) * width + x];
    }
  }
  return { width, height, data: out };
}

/** Global SSIM between two same-size gray images using an 8x8 window grid. */
export function ssim(a, b, win = 8) {
  if (a.width !== b.width || a.height !== b.height) throw new Error('ssim: size mismatch');
  const C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2;
  let total = 0, n = 0;
  for (let y = 0; y + win <= a.height; y += win) {
    for (let x = 0; x + win <= a.width; x += win) {
      let ma = 0, mb = 0;
      for (let yy = 0; yy < win; yy++) for (let xx = 0; xx < win; xx++) { const i = (y + yy) * a.width + x + xx; ma += a.data[i]; mb += b.data[i]; }
      ma /= win * win; mb /= win * win;
      let va = 0, vb = 0, cov = 0;
      for (let yy = 0; yy < win; yy++) for (let xx = 0; xx < win; xx++) { const i = (y + yy) * a.width + x + xx; const da = a.data[i] - ma, db = b.data[i] - mb; va += da * da; vb += db * db; cov += da * db; }
      va /= win * win - 1; vb /= win * win - 1; cov /= win * win - 1;
      total += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
      n++;
    }
  }
  return n ? total / n : 1;
}

/** SSIM of `a` against `b` shifted by (dx, dy); the overlap is compared, edges dropped. */
function ssimShifted(a, b, dx, dy, win) {
  const w = a.width - Math.abs(dx), h = a.height - Math.abs(dy);
  if (w < win || h < win) return 0;
  const sa = { width: w, height: h, data: new Float32Array(w * h) };
  const sb = { width: w, height: h, data: new Float32Array(w * h) };
  const ax = Math.max(0, -dx), ay = Math.max(0, -dy), bx = Math.max(0, dx), by = Math.max(0, dy);
  for (let y = 0; y < h; y++) {
    sa.data.set(a.data.subarray((y + ay) * a.width + ax, (y + ay) * a.width + ax + w), y * w);
    sb.data.set(b.data.subarray((y + by) * b.width + bx, (y + by) * b.width + bx + w), y * w);
  }
  return ssim(sa, sb, win);
}

/**
 * Structure score 0..1: SSIM over blurred grayscale at a fixed working width,
 * taking the best of a small translation search so a composition that sits a
 * few pixels off (a different masthead height, a scrollbar) is not read as a
 * different composition. Shifts up to ~4% of the width are forgiven; a moved
 * region is not.
 */
export function structureScore(imgA, imgB, workWidth = 256) {
  const h = Math.max(8, Math.round((imgA.height / imgA.width) * workWidth));
  const a = blurGray(toGray(resize(imgA, workWidth, h)), 2);
  const b = blurGray(toGray(resize(imgB, workWidth, h)), 2);
  const win = Math.min(8, Math.max(2, Math.floor(Math.min(workWidth, h) / 8)));
  let best = ssim(a, b, win);
  const maxShift = Math.max(2, Math.round(workWidth * 0.04));
  for (const dy of [-maxShift, -maxShift / 2, 0, maxShift / 2, maxShift]) {
    for (const dx of [-maxShift, -maxShift / 2, 0, maxShift / 2, maxShift]) {
      if (!dx && !dy) continue;
      best = Math.max(best, ssimShifted(a, b, Math.round(dx), Math.round(dy), win));
    }
  }
  return Math.max(0, Math.min(1, best));
}

// ---- color -----------------------------------------------------------------

function rgbToLab(r, g, b) {
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = (R * 0.2126 + G * 0.7152 + B * 0.0722) / 1.0;
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function deltaE(lab1, lab2) {
  return Math.hypot(lab1[0] - lab2[0], lab1[1] - lab2[1], lab1[2] - lab2[2]);
}

/** Quantized color histogram (4 bits per channel = 4096 bins), normalized. */
export function colorHistogram(img, sampleStep = 2) {
  const bins = new Float32Array(4096);
  let n = 0;
  for (let y = 0; y < img.height; y += sampleStep) {
    for (let x = 0; x < img.width; x += sampleStep) {
      const p = (y * img.width + x) * 4;
      if (img.data[p + 3] < 16) continue;
      const key = ((img.data[p] >> 4) << 8) | ((img.data[p + 1] >> 4) << 4) | (img.data[p + 2] >> 4);
      bins[key]++; n++;
    }
  }
  if (n) for (let i = 0; i < bins.length; i++) bins[i] /= n;
  return bins;
}

export function histogramIntersection(h1, h2) {
  let s = 0;
  for (let i = 0; i < h1.length; i++) s += Math.min(h1[i], h2[i]);
  return s;
}

/**
 * Dominant colors: merge histogram bins greedily by Lab distance into up to
 * `k` clusters and return them sorted by coverage.
 */
export function dominantColors(img, k = 6, sampleStep = 3) {
  const hist = colorHistogram(img, sampleStep);
  const entries = [];
  for (let i = 0; i < hist.length; i++) if (hist[i] > 0.0005) entries.push({ key: i, w: hist[i] });
  entries.sort((a, b) => b.w - a.w);
  const clusters = [];
  for (const e of entries) {
    const r = ((e.key >> 8) & 15) * 16 + 8, g = ((e.key >> 4) & 15) * 16 + 8, b = (e.key & 15) * 16 + 8;
    const lab = rgbToLab(r, g, b);
    let best = null, bestD = Infinity;
    for (const c of clusters) { const d = deltaE(c.lab, lab); if (d < bestD) { bestD = d; best = c; } }
    if (best && bestD < 14) {
      const tw = best.w + e.w;
      best.rgb = [(best.rgb[0] * best.w + r * e.w) / tw, (best.rgb[1] * best.w + g * e.w) / tw, (best.rgb[2] * best.w + b * e.w) / tw];
      best.lab = rgbToLab(...best.rgb); best.w = tw;
    } else clusters.push({ rgb: [r, g, b], lab, w: e.w });
  }
  clusters.sort((a, b) => b.w - a.w);
  const top = clusters.slice(0, k);
  const covered = top.reduce((s, c) => s + c.w, 0) || 1;
  return top.map((c) => ({ hex: toHex(c.rgb), coverage: +(c.w / covered).toFixed(4), lab: c.lab }));
}

export function toHex(rgb) {
  return '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

/**
 * Palette match 0..1: for each dominant comp color, coverage-weighted best
 * Lab match in the build's dominant set (dE 0 -> 1, dE >= 40 -> 0).
 */
export function paletteMatch(compColors, buildColors) {
  if (!compColors.length) return 1;
  let s = 0, wsum = 0;
  for (const c of compColors) {
    let best = Infinity;
    for (const b of buildColors) best = Math.min(best, deltaE(c.lab, b.lab));
    s += c.coverage * Math.max(0, 1 - best / 40); wsum += c.coverage;
  }
  return wsum ? s / wsum : 1;
}

/** Color score 0..1: blend of histogram intersection and dominant-palette match. */
export function colorScore(imgA, imgB) {
  const inter = histogramIntersection(colorHistogram(imgA), colorHistogram(imgB));
  const pm = paletteMatch(dominantColors(imgA), dominantColors(imgB));
  return { score: 0.35 * inter + 0.65 * pm, intersection: inter, paletteMatch: pm };
}

// ---- detail ----------------------------------------------------------------

/** Mean absolute gradient (Sobel-lite) per cell over a cols x rows grid. */
export function detailGrid(img, cols = 12, rows = 8, workWidth = 512) {
  const h = Math.max(rows, Math.round((img.height / img.width) * workWidth));
  const g = toGray(resize(img, workWidth, h));
  const grid = new Float32Array(cols * rows);
  const counts = new Float32Array(cols * rows);
  for (let y = 1; y < g.height - 1; y++) {
    const cy = Math.min(rows - 1, Math.floor((y / g.height) * rows));
    for (let x = 1; x < g.width - 1; x++) {
      const cx = Math.min(cols - 1, Math.floor((x / g.width) * cols));
      const i = y * g.width + x;
      const gx = Math.abs(g.data[i + 1] - g.data[i - 1]);
      const gy = Math.abs(g.data[i + g.width] - g.data[i - g.width]);
      grid[cy * cols + cx] += gx + gy; counts[cy * cols + cx]++;
    }
  }
  for (let i = 0; i < grid.length; i++) grid[i] = counts[i] ? grid[i] / counts[i] : 0;
  return { cols, rows, cells: grid };
}

/**
 * Detail score 0..1 and per-cell ratio. Cells where the comp is nearly flat
 * are ignored (nothing to lose); the score is the coverage-weighted mean of
 * min(1, build/comp) over cells with comp energy, so extra detail in the
 * build (invented chrome) is reported separately as `added`.
 */
export function detailScore(imgA, imgB, cols = 12, rows = 8) {
  const a = detailGrid(imgA, cols, rows), b = detailGrid(imgB, cols, rows);
  const floor = 1.5; // energy below this is a flat field at the 512px working width
  let s = 0, w = 0, added = 0, addedW = 0;
  const ratios = new Float32Array(cols * rows);
  for (let i = 0; i < a.cells.length; i++) {
    const ca = a.cells[i], cb = b.cells[i];
    ratios[i] = ca > floor ? cb / ca : (cb > floor ? Infinity : 1);
    if (ca > floor) { s += Math.min(1, cb / ca) * ca; w += ca; }
    if (cb > ca * 1.8 && cb > floor * 2) { added += 1; }
    addedW += 1;
  }
  return { score: w ? s / w : 1, addedFraction: addedW ? added / addedW : 0, comp: a, build: b, ratios };
}

// ---- pixel diff -----------------------------------------------------------

/** Per-pixel Lab-ish difference map (0..1) at a working width; blurred a little. */
export function diffMap(imgA, imgB, workWidth = 384) {
  const h = Math.max(8, Math.round((imgA.height / imgA.width) * workWidth));
  const a = resize(imgA, workWidth, h), b = resize(imgB, workWidth, h);
  const out = new Float32Array(workWidth * h);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    const dr = a.data[p] - b.data[p], dg = a.data[p + 1] - b.data[p + 1], db = a.data[p + 2] - b.data[p + 2];
    out[i] = Math.min(1, Math.sqrt(dr * dr + dg * dg + db * db) / 200);
  }
  return blurGray({ width: workWidth, height: h, data: out }, 1);
}

// ---- bands (horizontal layout structure) ---------------------------------

/**
 * Detect horizontal band boundaries: rows where the mean color changes
 * sharply. Returns normalized y positions (0..1) with strengths. This is the
 * "layout grid" read of a page: header / hero / index / footer as bands.
 */
export function horizontalBands(img, workWidth = 128, minGap = 0.02) {
  const h = Math.max(16, Math.round((img.height / img.width) * workWidth));
  const s = resize(img, workWidth, h);
  const rowMean = new Float32Array(h * 3);
  for (let y = 0; y < h; y++) {
    let r = 0, g = 0, b = 0;
    for (let x = 0; x < workWidth; x++) { const p = (y * workWidth + x) * 4; r += s.data[p]; g += s.data[p + 1]; b += s.data[p + 2]; }
    rowMean[y * 3] = r / workWidth; rowMean[y * 3 + 1] = g / workWidth; rowMean[y * 3 + 2] = b / workWidth;
  }
  const edges = [];
  for (let y = 1; y < h; y++) {
    const d = Math.hypot(rowMean[y * 3] - rowMean[(y - 1) * 3], rowMean[y * 3 + 1] - rowMean[(y - 1) * 3 + 1], rowMean[y * 3 + 2] - rowMean[(y - 1) * 3 + 2]);
    if (d > 18) edges.push({ y: y / h, strength: Math.min(1, d / 120) });
  }
  // merge close edges
  const merged = [];
  for (const e of edges) {
    const last = merged[merged.length - 1];
    if (last && e.y - last.y < minGap) { if (e.strength > last.strength) { last.y = e.y; last.strength = e.strength; } }
    else merged.push({ ...e });
  }
  return merged;
}

/** Band agreement 0..1: fraction of comp bands with a build band within tolerance, and vice versa. */
export function bandScore(bandsA, bandsB, tol = 0.04) {
  if (!bandsA.length && !bandsB.length) return 1;
  const match = (from, to) => from.filter((a) => to.some((b) => Math.abs(a.y - b.y) <= tol)).length;
  const recall = bandsA.length ? match(bandsA, bandsB) / bandsA.length : 1;
  const precision = bandsB.length ? match(bandsB, bandsA) / bandsB.length : 1;
  return 0.6 * recall + 0.4 * precision;
}
