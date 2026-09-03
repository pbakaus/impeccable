/**
 * font-fingerprint: size-invariant, text-robust shape features for lettering
 * in a raster (a comp crop or a rendered sample). fingerprint(img) returns the
 * feature vector; distance(a, b) compares two vectors over noise-normalized,
 * weighted features. Used by font-match.mjs (comp measurement and ranking)
 * and by the catalog index build (scripts/build-font-index.mjs at the repo root). Depends only on
 * lib/image-metrics.mjs and lib/raster.mjs.
 *
 * Every measure is taken per text line and normalized by R, the line's
 * reference height (median of the tallest column heights above the baseline:
 * the cap line on an all-caps line, the ascender line on a mixed line), so
 * the same face gives the same numbers at any point size; per-glyph measures
 * are medians so the numbers survive a change of text. Small crops are
 * upsampled (bilinear) so R is at least 24px, and stroke runs are measured
 * with antialiased edge pixels counted by coverage, so stem widths do not
 * fatten at small sizes.
 *
 * Features (all in R units unless noted; null when not measurable):
 *   advance/advTall/advX  median glyph width over baseline glyphs / tall glyphs / x-height glyphs
 *   advCV                 spread of glyph widths (std/median): mono ~0.15, sans ~0.3, script > 0.5
 *   gap                   median inter-glyph gap
 *   xRatio                x-line / R (null on all-caps lines)
 *   descRatio             descender depth (90th pct)
 *   stemW                 median horizontal ink run in the x band (stem width)
 *   contrast              stem width / median thin (vertical) run: didone high, grotesque ~1
 *   serif                 foot width / mid-stem width on stems that reach the baseline
 *   roundFrac             fraction of glyphs with bbox aspect > 0.9
 *   densTall / densX      ink / bbox area for tall / x-height glyphs (weight)
 *   runDensity            horizontal ink runs per row per R of line width (stroke busyness)
 *   vprof0..9             normalized vertical ink profile from 0.35R below baseline to 1.05R above
 *   hrun25/50/75/90       quantiles of horizontal run lengths over the letter body
 *   vrun25/50/75/90       quantiles of vertical run lengths over the whole line
 *   colq25/75             quantiles of column heights above the baseline
 *   wq25/75               quantiles of glyph widths
 * Also returned: lines, glyphs, capHeightPx (R in source pixels), allCaps, inkIsDark,
 * upsampled, weight (densTall, so v1 callers keep a weight field).
 */
import { toGray } from './image-metrics.mjs';
import { resize } from './raster.mjs';

function otsu(gray) {
  const hist = new Float64Array(256);
  for (let i = 0; i < gray.data.length; i++) hist[Math.max(0, Math.min(255, Math.round(gray.data[i])))]++;
  const total = gray.data.length;
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; thr = t; }
  }
  return thr;
}

const med = (a) => { if (!a.length) return null; const s = [...a].sort((p, q) => p - q); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((p, q) => p - q); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

/** Binarize; returns { W, H, ink: Uint8Array, inkIsDark }. */
function binarize(img) {
  const g = toGray(img);
  let thr = otsu(g);
  let dark = 0; for (let i = 0; i < g.data.length; i++) if (g.data[i] < thr) dark++;
  // a two-level raster (no antialiasing) puts the Otsu threshold on the dark
  // level itself; step it up so that level counts as ink
  if (!dark) { thr += 1; for (let i = 0; i < g.data.length; i++) if (g.data[i] < thr) dark++; }
  const inkIsDark = dark <= g.data.length / 2;
  const ink = new Uint8Array(g.data.length);
  let sI = 0, nI = 0, sG = 0, nG = 0;
  for (let i = 0; i < g.data.length; i++) {
    const on = (inkIsDark ? g.data[i] < thr : g.data[i] >= thr) ? 1 : 0;
    ink[i] = on;
    if (on) { sI += g.data[i]; nI++; } else { sG += g.data[i]; nG++; }
  }
  const inkLevel = nI ? sI / nI : (inkIsDark ? 0 : 255), groundLevel = nG ? sG / nG : (inkIsDark ? 255 : 0);
  // coverage per pixel: 0 = ground, 1 = ink, linear between the two class means, so
  // antialiased edge pixels count fractionally and stroke widths do not fatten at small sizes
  const covA = new Float32Array(g.data.length);
  const den = groundLevel - inkLevel || 1;
  for (let i = 0; i < g.data.length; i++) covA[i] = Math.max(0, Math.min(1, (groundLevel - g.data[i]) / den));
  const cov = (i) => covA[i];
  return { W: g.width, H: g.height, ink, inkIsDark, cov, covA };
}

/** Text lines from the row-ink profile (same rules as font-match v1). */
function findLines(bin) {
  const { W, H, ink } = bin;
  // Columns inked top to bottom (a rule, a black margin, a page edge) span
  // every line and would fuse them into one run: leave them out of the row
  // profile. Lettering never fills a column for more than ~85% of the crop.
  const colInk = new Uint32Array(W);
  for (let y = 0; y < H; y++) { const o = y * W; for (let x = 0; x < W; x++) colInk[x] += ink[o + x]; }
  const colOk = new Uint8Array(W);
  let okCount = 0;
  for (let x = 0; x < W; x++) { if (colInk[x] < H * 0.85) { colOk[x] = 1; okCount++; } }
  if (!okCount) return { lines: [], rowInk: new Uint32Array(H) };
  const rowInk = new Uint32Array(H);
  for (let y = 0; y < H; y++) { let c = 0; const o = y * W; for (let x = 0; x < W; x++) if (colOk[x]) c += ink[o + x]; rowInk[y] = c; }
  const floor = Math.max(1, W * 0.004);
  const runs = [];
  let y = 0;
  while (y < H) {
    if (rowInk[y] > floor) {
      const y0 = y; while (y < H && (rowInk[y] > floor || (y + 1 < H && rowInk[y + 1] > floor))) y++;
      if (y - y0 >= 4) runs.push({ y0, y1: y });
    } else y++;
  }
  const lines = [];
  for (const run of runs) {
    let peak = 0; for (let yy = run.y0; yy < run.y1; yy++) peak = Math.max(peak, rowInk[yy]);
    const valley = peak * 0.15;
    let start = run.y0, inValley = false, valleyStart = 0;
    for (let yy = run.y0; yy < run.y1; yy++) {
      const low = rowInk[yy] < valley;
      if (low && !inValley) { inValley = true; valleyStart = yy; }
      if (!low && inValley) {
        inValley = false;
        if (yy - valleyStart >= 3 && valleyStart - start >= 4) { lines.push({ y0: start, y1: valleyStart, run }); start = yy; }
      }
    }
    if (run.y1 - start >= 4) lines.push({ y0: start, y1: run.y1, run });
  }
  // A piece split off inside one run with a fraction of the ink of the text
  // lines is not a line: a thin band of ascenders or tittles above the x band
  // (few letters reach it, so the valley rule fires) or a stray rule. Ascender
  // bands merge back into the line below them; anything else is dropped.
  for (const ln of lines) { let m = 0; for (let yy = ln.y0; yy < ln.y1; yy++) m += rowInk[yy]; ln.mass = m; }
  // A drawing or photo sharing the crop with body copy is one tall, massive
  // 'line' that would carry maxMass and drop every real line under the 30%
  // rule (a 461x307 thread crop measured as one 160px 'cap' off a
  // carburetor drawing). When several lines exist, ones far taller than the
  // median are not lettering: leave them out of the mass reference and out
  // of the result.
  // The median is taken over lines carrying real mass (rule slivers and
  // tittles do not vote), and needs three of them: two 145px headline lines
  // above a 26px artist line were dropped as 'tall' against a median pulled
  // to 28 by three slivers.
  const massMax = Math.max(1, ...lines.map((l) => l.mass));
  const real = lines.filter((l) => l.mass >= massMax * 0.05);
  if (real.length >= 3) {
    const hs = real.map((l) => l.y1 - l.y0).sort((a, b) => a - b);
    const medH = hs[Math.floor(hs.length / 2)];
    for (const ln of lines) if (ln.y1 - ln.y0 > medH * 3) ln.tall = true;
  }
  const maxMass = Math.max(0, ...lines.filter((l) => !l.tall).map((l) => l.mass));
  const merged = [];
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (ln.tall) continue;
    if (ln.mass >= maxMass * 0.3) { merged.push({ y0: ln.y0, y1: ln.y1, mass: ln.mass }); continue; }
    const next = lines[i + 1];
    if (next && next.run === ln.run && next.mass >= maxMass * 0.3 && (ln.y1 - ln.y0) <= (next.y1 - next.y0) * 0.5) { next.y0 = ln.y0; }
  }
  return { lines: merged, rowInk };
}

/** Feature names in fingerprint order (used by distance). */
const VBINS = 10, HQ = [0.25, 0.5, 0.75, 0.9];
export const FEATURES = ['advance', 'advTall', 'advX', 'advCV', 'gap', 'xRatio', 'descRatio', 'stemW', 'contrast', 'serif', 'roundFrac', 'densTall', 'densX', 'runDensity',
  ...Array.from({ length: VBINS }, (_, i) => `vprof${i}`), ...HQ.map((q) => `hrun${Math.round(q * 100)}`), ...HQ.map((q) => `vrun${Math.round(q * 100)}`), 'colq25', 'colq75', 'wq25', 'wq75'];

/** Center of the densest window of width tol in a list of values, and its count. */
function modeOf(vals, tol) {
  let best = null, bestC = -1;
  const s = [...vals].sort((a, b) => a - b);
  let j = 0;
  for (let i = 0; i < s.length; i++) {
    while (s[i] - s[j] > tol) j++;
    const c = i - j + 1;
    if (c > bestC) { bestC = c; best = (s[i] + s[j]) / 2; }
  }
  return { v: best, n: bestC };
}

/**
 * Per-line vertical metrics from column extrema, which do not need glyphs to
 * be separable. baseline = mode of column bottoms. R (the reference height)
 * is the top line of the tallest cluster: the cap line on an all-caps line,
 * the ascender line (or the cap line when caps are taller) on a mixed line.
 * The x-line is a second mode of column heights well below R; when there is
 * none the line is read as all-caps.
 */
function lineMetrics(bin, ln) {
  const { W, ink, cov } = bin;
  const cols = [];
  for (let x = 0; x < W; x++) {
    let top = -1, bot = -1;
    for (let yy = ln.y0; yy < ln.y1; yy++) if (ink[yy * W + x]) { if (top < 0) top = yy; bot = yy + 1; }
    if (top < 0) continue;
    // sub-pixel edges from the antialiased boundary pixel's coverage
    const t = top > 0 ? top - cov((top - 1) * W + x) : top;
    const b = bot < bin.H ? bot + cov(bot * W + x) : bot;
    cols.push({ x, top: t, bot: b });
  }
  if (cols.length < 8) return null;
  const roughH = pct(cols.map((c) => c.bot - c.top), 0.9);
  const tol = Math.max(1, Math.round(roughH * 0.04));
  const baseF = modeOf(cols.map((c) => c.bot), tol).v;
  const base = Math.round(baseF);
  const hs = cols.filter((c) => c.bot <= baseF + tol * 1.5).map((c) => baseF - c.top).filter((h) => h > 0);
  if (hs.length < 8) return null;
  const hMaxAbs = pct(hs, 0.995);
  const topCluster = hs.filter((h) => h >= hMaxAbs * 0.94);
  const R = med(topCluster);
  if (!R || R < 4) return null;
  const lowHs = hs.filter((h) => h >= R * 0.3 && h <= R * 0.86);
  let xh = null;
  if (lowHs.length >= Math.max(6, hs.length * 0.12)) {
    const m = modeOf(lowHs, tol);
    if (m.n >= Math.max(4, lowHs.length * 0.25)) xh = m.v;
  }
  const dsc = cols.filter((c) => c.bot > baseF + tol * 1.5 && c.top < baseF - R * 0.3).map((c) => (c.bot - baseF) / R);
  const descRatio = dsc.length >= 4 ? pct(dsc, 0.9) : null;
  return { base, R, cap: R, xh, descRatio, tol, xL: cols[0].x, xR: cols[cols.length - 1].x + 1, hs, ln };
}

/** Glyph boxes: column runs of ink inside the x band, so ascender/descender bridges do not merge letters. */
function segment(bin, ln, m) {
  const { W, ink } = bin;
  const bandTop = Math.max(ln.y0, Math.round(m.base - (m.xh || m.cap * 0.6)));
  const bandH = m.base - bandTop;
  const thr = 1;
  const colBand = new Uint32Array(W);
  for (let yy = bandTop; yy < m.base; yy++) { const o = yy * W; for (let x = m.xL; x < m.xR; x++) colBand[x] += ink[o + x]; }
  const runs = [];
  let x = m.xL;
  while (x < m.xR) {
    if (colBand[x] >= thr) { const x0 = x; while (x < m.xR && colBand[x] >= thr) x++; runs.push({ x0, x1: x }); } else x++;
  }
  const out = [];
  for (const r of runs) {
    let top = -1, bot = -1, area = 0;
    for (let yy = ln.y0; yy < ln.y1; yy++) {
      let c = 0, cv = 0; const o = yy * W; for (let xx = r.x0; xx < r.x1; xx++) { c += ink[o + xx]; cv += bin.covA[o + xx]; }
      if (c) { if (top < 0) top = yy; bot = yy + 1; }
      area += cv;
    }
    if (top >= 0) out.push({ x0: r.x0, x1: r.x1, w: r.x1 - r.x0, top, bot, h: bot - top, area });
  }
  return out;
}

function measure(bin, lines) {
  const { W, H, ink, covA } = bin;
  // run lengths with the antialiased edge pixels counted by coverage
  const hLen = (o, x0, x1) => { let s = 0; for (let x = Math.max(0, x0 - 1); x < Math.min(W, x1 + 1); x++) s += covA[o + x]; return s; };
  const vLen = (x, y0, y1) => { let s = 0; for (let y = Math.max(0, y0 - 1); y < Math.min(H, y1 + 1); y++) s += covA[y * W + x]; return s; };
  let glyphN = 0;
  const per = { xh: [], desc: [], runDensity: [] };
  let allCapsLines = 0;
  const vprof = new Float64Array(VBINS); const hruns = [], vruns = [], colHs = [], widths = [];
  const advTall = [], advAll = [], advX = [], gaps = [], stems = [], thins = [], serifR = [], round = [], densTall = [], densX = [];
  let capSum = 0, capN = 0;
  // One crop, one case. In a multi-line all-caps headline one line can grow a
  // spurious x-height from crossbars (the A and E arms of "JAPANESE" at 0.32R)
  // while its neighbours report none; that line then measures its stems and
  // its x band on the crossbar zone. Lines vote: when most lines see no
  // x-height, none does.
  const metrics = lines.map((ln) => lineMetrics(bin, ln)).filter(Boolean);
  if (metrics.length >= 2) {
    const withX = metrics.filter((m) => m.xh).length;
    if (withX * 2 <= metrics.length) for (const m of metrics) m.xh = null;
  }
  for (const m of metrics) {
    const ln = m.ln;
    const { base, cap, xh, tol, xL, xR } = m;
    capSum += cap; capN++;
    if (xh) per.xh.push(xh / cap);
    if (!xh) allCapsLines++;
    if (m.descRatio != null) per.desc.push(m.descRatio);
    for (const h of m.hs) colHs.push(h / cap);
    // vertical ink profile from 0.35R below the baseline to 1.05R above, VBINS bins
    for (let yy = ln.y0; yy < ln.y1; yy++) {
      const u = (base - yy - 0.5) / cap; // height above baseline in R units
      const bi = Math.floor((u + 0.35) / 1.4 * VBINS);
      if (bi < 0 || bi >= VBINS) continue;
      let c = 0; const o = yy * W; for (let x = xL; x < xR; x++) c += ink[o + x];
      vprof[bi] += c;
    }
    // horizontal run lengths over the whole line body (x band to cap line), vertical run lengths over all columns
    for (let yy = Math.max(ln.y0, Math.round(base - cap)); yy < base; yy++) {
      const o = yy * W; let x = xL;
      while (x < xR) { if (ink[o + x]) { const x0 = x; while (x < xR && ink[o + x]) x++; hruns.push(hLen(o, x0, x) / cap); } else x++; }
    }
    for (let x = xL; x < xR; x++) {
      let yy = ln.y0;
      while (yy < ln.y1) { if (ink[yy * W + x]) { const y0 = yy; while (yy < ln.y1 && ink[yy * W + x]) yy++; vruns.push(vLen(x, y0, yy) / cap); } else yy++; }
    }
    const gl = segment(bin, ln, m);
    const G = gl.filter((g) => g.w >= cap * 0.12 && (base - g.top) >= cap * 0.3);
    glyphN += G.length;
    const onBase = G.filter((g) => Math.abs(g.bot - base) <= tol * 1.5);
    const capG = onBase.filter((g) => base - g.top >= cap * 0.88);
    const xs = xh ? onBase.filter((g) => Math.abs(base - g.top - xh) <= Math.max(tol * 1.5, cap * 0.05)) : [];
    for (const g of capG) { advTall.push(g.w / cap); densTall.push(g.area / (g.w * g.h)); }
    for (const g of xs) { densX.push(g.area / (g.w * g.h)); advX.push(g.w / cap); }
    for (const g of onBase) { advAll.push(g.w / cap); widths.push(g.w / cap); round.push(g.w / (base - g.top) > 0.9 ? 1 : 0); }
    for (let i = 0; i + 1 < G.length; i++) { const gap = G[i + 1].x0 - G[i].x1; if (gap >= 0 && gap < cap * 0.6) gaps.push(gap / cap); }
    const xTop = base - (xh || cap * 0.55);
    const bandTop = Math.round(xTop + (base - xTop) * 0.2), bandBot = Math.round(base - (base - xTop) * 0.2);
    let runCount = 0, runRows = 0;
    for (let yy = bandTop; yy < bandBot; yy++) {
      const o = yy * W; let x = xL; runRows++;
      while (x < xR) { if (ink[o + x]) { const x0 = x; while (x < xR && ink[o + x]) x++; const L = hLen(o, x0, x); runCount++; if (L < cap * 0.5) stems.push(L / cap); } else x++; }
    }
    if (runRows) per.runDensity.push((runCount / runRows) / ((xR - xL) / cap));
    for (let x = xL; x < xR; x++) {
      let yy = ln.y0;
      while (yy < ln.y1) { if (ink[yy * W + x]) { const y0 = yy; while (yy < ln.y1 && ink[yy * W + x]) yy++; const L = vLen(x, y0, yy); if (L < cap * 0.35) thins.push(L / cap); } else yy++; }
    }
    // serif: stems that run straight to the baseline; foot width vs mid-stem width
    const runAt = (yy, x) => { const o = yy * W; if (!ink[o + x]) return 0; let a = x, b = x; while (a > xL && ink[o + a - 1]) a--; while (b + 1 < xR && ink[o + b + 1]) b++; return hLen(o, a, b + 1); };
    const yMid = Math.round(base - cap * 0.4), yHi = Math.round(base - cap * 0.18), yFoot = base - Math.max(1, Math.round(cap * 0.04));
    let x = xL;
    while (x < xR) {
      let yy = base - 1; if (!ink[yy * W + x]) { x++; continue; }
      while (yy > ln.y0 && ink[(yy - 1) * W + x]) yy--;
      if (yy > yMid) { x++; continue; }
      const x0 = x; x++; while (x < xR && ink[(base - 1) * W + x] && ink[yMid * W + x]) x++;
      const xc = Math.round((x0 + x - 1) / 2);
      const wMid = runAt(yMid, xc), wHi = runAt(yHi, xc), wFoot = runAt(yFoot, xc);
      if (wMid > 0 && wMid < cap * 0.5 && wHi <= wMid * 1.3 && wHi >= wMid * 0.7) serifR.push(wFoot / wMid);
    }
  }
  if (!capN) return null;
  const stemW = med(stems), thinW = med(thins);
  const advM = med(advAll);
  const advSd = advAll.length > 3 ? Math.sqrt(advAll.reduce((s, v) => s + (v - advM) ** 2, 0) / advAll.length) : null;
  const vsum = vprof.reduce((s, x) => s + x, 0) || 1;
  const extra = {};
  for (let i = 0; i < VBINS; i++) extra[`vprof${i}`] = vprof[i] / vsum;
  for (const q of HQ) { extra[`hrun${Math.round(q * 100)}`] = pct(hruns, q); extra[`vrun${Math.round(q * 100)}`] = pct(vruns, q); }
  extra.colq25 = pct(colHs, 0.25); extra.colq75 = pct(colHs, 0.75);
  extra.wq25 = pct(widths, 0.25); extra.wq75 = pct(widths, 0.75);
  return {
    ...extra,
    capHeightPx: capSum / capN,
    glyphs: glyphN,
    advance: advM,
    advTall: advTall.length ? med(advTall) : null,
    advX: advX.length ? med(advX) : null,
    advCV: advSd != null && advM ? advSd / advM : null,
    gap: gaps.length ? med(gaps) : 0,
    xRatio: per.xh.length ? med(per.xh) : null,
    descRatio: per.desc.length ? med(per.desc) : null,
    allCaps: allCapsLines * 2 > capN,
    runDensity: med(per.runDensity),
    stemW,
    contrast: stemW && thinW ? stemW / thinW : null,
    serif: serifR.length >= 3 ? med(serifR) : null,
    roundFrac: round.length ? mean(round) : null,
    densTall: densTall.length ? med(densTall) : null,
    densX: densX.length ? med(densX) : null,
  };
}

/**
 * fingerprint(img) -> features, or null when no lettering is found. Upsamples (bilinear) when the
 * cap height is under 24px so runs and edges are measured on finer pixels.
 */
/**
 * Keep the dominant lettering in a region crop: the lines whose cap height is
 * within `tol` of the tallest, clipped horizontally to their own ink. A comp
 * region drawn on a 10x10 grid over-covers: the headline crop carries the
 * first line of body copy below it and a slice of the neighbouring column,
 * and every one of those small letters pulls stem width, run lengths and the
 * x-height vote toward a lighter, wider face. Returns { lines, x0, x1 } in
 * the binarized image, or null when nothing survives.
 */
export function isolateDominant(bin, lines, { tol = 0.28 } = {}) {
  const ms = lines.map((ln) => ({ ln, m: lineMetrics(bin, ln) })).filter((x) => x.m);
  if (!ms.length) return null;
  // The dominant class is the one holding most of the ink, not the tallest
  // line: a body-copy crop that clips the last line of the headline above it
  // is body copy. Cluster caps within tol of each other and pick the cluster
  // with the most ink mass; the tallest wins only a tie.
  const clusters = [];
  for (const x of [...ms].sort((a, b) => b.m.cap - a.m.cap)) {
    const c = clusters.find((cl) => Math.abs(cl.cap - x.m.cap) <= cl.cap * tol);
    if (c) { c.items.push(x); c.mass += x.ln.mass || 0; } else clusters.push({ cap: x.m.cap, items: [x], mass: x.ln.mass || 0 });
  }
  // Mass per line-height, so one heavy display line does not outvote five
  // lines of body copy; and a cluster of a single clipped line never wins
  // over a cluster of three or more.
  for (const c of clusters) { c.rows = c.items.reduce((n, x) => n + (x.ln.y1 - x.ln.y0), 0); c.density = c.mass / Math.max(1, c.rows); c.n = c.items.length; }
  clusters.sort((a, b) => {
    const aMulti = a.n >= 3, bMulti = b.n >= 3;
    if (aMulti !== bMulti) return aMulti ? -1 : 1;
    return (b.mass - a.mass) || (b.cap - a.cap);
  });
  const keep = clusters[0].items;
  const capMax = Math.max(...keep.map((x) => x.m.cap));
  // horizontal extent of the kept lines' tallest ink columns only: a small
  // column of body text beside the headline shares its rows but not its height
  const { W, ink } = bin;
  let x0 = W, x1 = 0;
  for (const { ln, m } of keep) {
    const top = Math.round(m.base - m.cap * 0.75);
    for (let x = m.xL; x < m.xR; x++) {
      let tall = false;
      for (let y = top; y < m.base && !tall; y++) if (ink[y * W + x]) tall = true;
      if (!tall) continue;
      // a column is headline ink when a run of at least 0.5 cap of ink stands in it
      let run = 0, best = 0;
      for (let y = ln.y0; y < ln.y1; y++) { if (ink[y * W + x]) { run++; if (run > best) best = run; } else run = 0; }
      if (best >= m.cap * 0.5) { if (x < x0) x0 = x; if (x + 1 > x1) x1 = x + 1; }
    }
  }
  if (x1 <= x0) return null;
  // grow the box by half a cap so glyph sides and the tracking gap survive
  const pad = Math.round(capMax * 0.5);
  return { lines: keep.map((x) => x.ln), x0: Math.max(0, x0 - pad), x1: Math.min(W, x1 + pad), dropped: ms.length - keep.length };
}

function maskOutside(bin, x0, x1, lines) {
  const { W, H, ink, covA } = bin;
  const keepRow = new Uint8Array(H);
  for (const ln of lines) for (let y = ln.y0; y < ln.y1; y++) keepRow[y] = 1;
  const ink2 = new Uint8Array(ink.length), cov2 = new Float32Array(covA.length);
  for (let y = 0; y < H; y++) {
    if (!keepRow[y]) continue;
    for (let x = x0; x < x1; x++) { const i = y * W + x; ink2[i] = ink[i]; cov2[i] = covA[i]; }
  }
  return { ...bin, ink: ink2, covA: cov2, cov: (i) => cov2[i] };
}

export function fingerprint(img, { minCap = 24, minGlyphs = 3, isolate = true } = {}) {
  let bin = binarize(img);
  let { lines } = findLines(bin);
  if (!lines.length) return null;
  let isolated = 0;
  if (isolate && lines.length > 1) {
    const iso = isolateDominant(bin, lines);
    if (iso && (iso.dropped > 0 || iso.x1 - iso.x0 < bin.W * 0.9)) {
      bin = maskOutside(bin, iso.x0, iso.x1, iso.lines);
      lines = iso.lines;
      isolated = iso.dropped;
    }
  }
  let f = measure(bin, lines);
  // fewer than minGlyphs separable glyphs is not lettering (a rule, a solid
  // bar, one letterform): callers read null as "no separable lettering"
  if (!f || f.glyphs < minGlyphs) return null;
  let scale = 1;
  if (f.capHeightPx < minCap && f.capHeightPx >= 4) {
    scale = Math.min(4, Math.ceil(minCap / f.capHeightPx));
    const up = resize(img, img.width * scale, img.height * scale);
    bin = binarize(up);
    lines = findLines(bin).lines;
    // the upsample re-reads the whole crop: isolate again so the clipped
    // headline or the drawing does not come back at scale
    if (isolate && lines.length > 1) {
      const iso2 = isolateDominant(bin, lines);
      if (iso2 && (iso2.dropped > 0 || iso2.x1 - iso2.x0 < bin.W * 0.9)) { bin = maskOutside(bin, iso2.x0, iso2.x1, iso2.lines); lines = iso2.lines; isolated = Math.max(isolated, iso2.dropped); }
    }
    const f2 = lines.length ? measure(bin, lines) : null;
    if (f2) f = f2;
    else scale = 1;
  }
  const r = { lines: lines.length, glyphs: f.glyphs, capHeightPx: +(f.capHeightPx / scale).toFixed(1), inkIsDark: bin.inkIsDark, upsampled: scale > 1, allCaps: f.allCaps, isolatedFrom: isolated, weight: f.densTall == null && f.densX == null ? null : +(f.densTall ?? f.densX).toFixed(4) };
  for (const k of FEATURES) r[k] = f[k] == null ? null : +f[k].toFixed(4);
  return r;
}

/**
 * Distance normalization fitted on 299 held-out probes (150 at ~30px cap, 149
 * at ~14px, text different from the index text) against a 3,092-entry Google
 * Fonts index: std = within-family noise (1.4826 x median |probe - own index
 * entry|, floored at 5% of the catalog IQR spread), w = group weight from
 * coordinate descent on top-5 family recall. mean is unused by the distance.
 */
export const STATS = {
  advance: { std: 0.07648, w: 0 },
  advTall: { std: 0.25331, w: 0 },
  advX: { std: 0.05144, w: 1.5 },
  advCV: { std: 0.0857, w: 1 },
  gap: { std: 0.02668, w: 1 },
  xRatio: { std: 0.02315, w: 1 },
  descRatio: { std: 0.17831, w: 1 },
  stemW: { std: 0.01922, w: 1 },
  contrast: { std: 0.05969, w: 3 },
  serif: { std: 0.31477, w: 0.5 },
  roundFrac: { std: 0.09341, w: 1 },
  densTall: { std: 0.05708, w: 2 },
  densX: { std: 0.07666, w: 0 },
  runDensity: { std: 0.18199, w: 1 },
  vprof0: { std: 0.01178, w: 1 },
  vprof1: { std: 0.01331, w: 1 },
  vprof2: { std: 0.02745, w: 1 },
  vprof3: { std: 0.03046, w: 1 },
  vprof4: { std: 0.01933, w: 1 },
  vprof5: { std: 0.01737, w: 1 },
  vprof6: { std: 0.0336, w: 1 },
  vprof7: { std: 0.03195, w: 1 },
  vprof8: { std: 0.03271, w: 1 },
  vprof9: { std: 0.02951, w: 1 },
  hrun25: { std: 0.01751, w: 1 },
  hrun50: { std: 0.02124, w: 1 },
  hrun75: { std: 0.04503, w: 1 },
  hrun90: { std: 0.06844, w: 1 },
  vrun25: { std: 0.01895, w: 1 },
  vrun50: { std: 0.02405, w: 1 },
  vrun75: { std: 0.06199, w: 1 },
  vrun90: { std: 0.09486, w: 1 },
  colq25: { std: 0.02906, w: 1 },
  colq75: { std: 0.18204, w: 1 },
  wq25: { std: 0.19862, w: 1 },
  wq75: { std: 0.09687, w: 1 },
};
export const Z_CLIP = 3;

/** Weighted L1 over z-scored features; a feature missing on either side is skipped and the weight mass renormalized. */
/**
 * The two readings a designer makes before any detail: how wide, how heavy.
 * Width from the advance of tall glyphs (all-caps crops) or x-height glyphs;
 * weight from ink density of tall glyphs. Both are on the same scale in the
 * comp crop and in a catalog render, so their gap is a plain ratio. Distance
 * adds a penalty that grows with the ratio's log: a face 50% wider or 35%
 * lighter than the comp cannot rank above one that is right on both, whatever
 * its run-length profile says. Weighted like three fine features (the width
 * gap and the weight gap each score up to zClip x 1.5).
 */
export function grossGap(a, b) {
  const pick = (f, keys) => { for (const k of keys) if (f[k] != null) return { k, v: f[k] }; return null; };
  const wa = pick(a, ['advX', 'advTall', 'advance']), wb = wa ? (b[wa.k] != null ? { k: wa.k, v: b[wa.k] } : null) : null;
  const ha = pick(a, ['densTall', 'densX', 'stemW']), hb = ha ? (b[ha.k] != null ? { k: ha.k, v: b[ha.k] } : null) : null;
  const gap = (x, y) => (x && y && x.v > 0 && y.v > 0 ? Math.abs(Math.log(y.v / x.v)) : null);
  return { width: gap(wa, wb), weight: gap(ha, hb) };
}

export const GROSS_STD = { width: 0.12, weight: 0.12 }; // one "step" of width class or weight class, in log ratio
export const GROSS_W = 1.5;

export function distance(a, b, stats = STATS, { p = 1, zClip = Z_CLIP, gross = true } = {}) {
  let d = 0, wsum = 0;
  if (gross) {
    const g = grossGap(a, b);
    for (const k of ['width', 'weight']) {
      if (g[k] == null) continue;
      const z = Math.min(zClip, g[k] / GROSS_STD[k]);
      d += GROSS_W * (p === 1 ? z : z * z); wsum += GROSS_W;
    }
  }
  for (const k of FEATURES) {
    const s = stats[k]; if (!s || !s.w) continue;
    const av = a[k], bv = b[k];
    if (av == null || bv == null) continue;
    const z = Math.min(zClip, Math.abs(av - bv) / s.std);
    d += s.w * (p === 1 ? z : z * z); wsum += s.w;
  }
  if (!wsum) return Infinity;
  const v = d / wsum;
  return p === 1 ? v : Math.sqrt(v);
}

/** Debug: per-line metrics (base, R, xh, mode counts) for a raster. */
export function _debugLines(img) {
  const bin = binarize(img);
  const { lines } = findLines(bin);
  return lines.map((ln) => { const m = lineMetrics(bin, ln); if (!m) return { ln, m: null }; const hs = m.hs.map((h) => +(h / m.R).toFixed(2)).sort((a, b) => a - b); const hist = {}; for (const h of hs) { const b = Math.round(h * 20) / 20; hist[b] = (hist[b] || 0) + 1; } return { y0: ln.y0, y1: ln.y1, base: m.base, R: +m.R.toFixed(1), xh: m.xh && +m.xh.toFixed(1), hist }; });
}
