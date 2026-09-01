#!/usr/bin/env node
/**
 * font-match: measure the lettering in a comp's text region and rank candidate
 * faces against it, so the face is chosen by metrics instead of by name.
 *
 *   node font-match.mjs --measure <region-id> [--spec .impeccable/build/spec.json]
 *     Fingerprints the comp crop of a text region (lib/font-fingerprint.mjs):
 *     cap height (px), glyph width per cap height (width class), stroke
 *     density and stem width (weight class), tracking, plus the size-invariant
 *     shape vector the ranking uses. Prints the summary and stores it on the
 *     region in the spec (`type` block), so build code can set font-size from
 *     capHeightPx and the hero gate can name a width/weight miss.
 *
 *   node font-match.mjs --rank <region-id> [--candidates "Barlow Condensed:700,Oswald:600"] [--text "The manuals stop."] [--category sans,display]
 *     Candidates come from a fingerprint index of the Google Fonts catalog
 *     (data/font-index.json, ~3,000 faces at two cap heights; the crop is
 *     routed to the 14px or 48px index by its cap height): the 25 nearest
 *     faces by fingerprint distance, plus the names you pass. Each candidate
 *     is then rendered with the region's text at the comp's cap height in a
 *     headless browser (Google Fonts CSS), fingerprinted the same way, and
 *     ranked by the same distance on the rendered text. Prints CATALOG (the
 *     index's top five), the ranking with per-face width and weight deltas,
 *     a proof sheet, and the CSS to use (family, weight, and the font-size
 *     that reproduces the comp's cap height). Needs a browser: playwright or
 *     puppeteer resolvable from the project or the impeccable CLI; without
 *     one, the CATALOG line is the ranking. Without the index the built-in
 *     per-width-class shortlist stands in.
 *
 * Why: models pick faces from memory and never measure. Three of the six
 * misses a human called on a first-round build were the same miss: the
 * headline face wider and lighter than the comp's, the parts list smaller,
 * the footer heavier. All three are ratios a script can read off pixels.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { decodePng, encodePng, loadRaster } from './lib/png.mjs';
import { crop } from './lib/raster.mjs';
import { fingerprint, distance } from './lib/font-fingerprint.mjs';
import { loadFontIndex, candidatesFromIndex, MIN_RANK_CAP_PX } from './lib/font-index.mjs';
import { loadSpec, SPEC_PATH } from './comp-spec.mjs';

const require = createRequire(import.meta.url);

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : fallback;
}

// ---- fingerprint ----------------------------------------------------------
// fingerprint(img) and distance(a, b) live in lib/font-fingerprint.mjs: size-
// invariant shape features per text line (advance, x-ratio, stem width,
// contrast, serif, density, ink profiles) and a noise-normalized weighted L1
// fitted on held-out Google Fonts probes. The class helpers below turn two of
// those features into the words the MEASURE line prints.

/**
 * The feature that reads as width: advX (x-height glyph width / R) on a
 * mixed-case crop, advTall (cap glyph width / R) when the crop is all caps.
 * Thresholds sit on the catalog index (advX 0.20 quantile 0.58, median 0.64,
 * 0.80 quantile 0.71) anchored by named faces: League Gothic 0.36, Oswald 0.42,
 * Anton 0.48, Barlow Condensed 0.54, Roboto Condensed 0.58, Roboto 0.62,
 * Inter 0.65, Space Grotesk 0.71, Montserrat Bold 0.76, Archivo Black 0.87.
 */
export function widthMeasure(fp) {
  if (!fp) return null;
  if (fp.advX != null) return { key: 'advX', value: fp.advX };
  if (fp.advTall != null) return { key: 'advTall', value: fp.advTall };
  if (fp.advance != null) return { key: 'advance', value: fp.advance };
  return null;
}
export function widthClass(fp) {
  const m = typeof fp === 'number' ? { key: 'advX', value: fp } : widthMeasure(fp);
  if (!m) return 'normal';
  // cap widths run ~10% wider than x-height widths against the same R
  const t = m.key === 'advTall' ? [0.45, 0.61, 0.78] : [0.42, 0.585, 0.72];
  if (m.value < t[0]) return 'compressed';
  if (m.value < t[1]) return 'condensed';
  if (m.value < t[2]) return 'normal';
  return 'wide';
}
/**
 * The feature that reads as weight: densTall (ink / bbox area of cap-height
 * glyphs); stemW (stem width / R) when no cap glyph was separable. Catalog
 * anchors for densTall: Lato 300 0.27, Roboto 300 0.32, Playfair 400 0.37,
 * Inter 400 0.44, Roboto 700 0.59, Work Sans 700 0.64, Bebas Neue 0.68,
 * Oswald 700 0.72, League Gothic 0.76, Anton 0.79. For stemW: Roboto 300 0.10,
 * Roboto 400 0.14, Inter 700 0.22, Archivo Black 0.30.
 */
export function weightMeasure(fp) {
  if (!fp) return null;
  if (fp.densTall != null) return { key: 'densTall', value: fp.densTall };
  if (fp.densX != null) return { key: 'densX', value: fp.densX };
  if (fp.stemW != null) return { key: 'stemW', value: fp.stemW };
  if (fp.weight != null) return { key: 'weight', value: fp.weight };
  return null;
}
export function weightClass(fp) {
  const m = typeof fp === 'number' ? { key: 'densTall', value: fp } : weightMeasure(fp);
  if (!m) return 'regular';
  const t = m.key === 'stemW' ? [0.105, 0.165, 0.195, 0.24] : [0.34, 0.48, 0.56, 0.66];
  if (m.value < t[0]) return 'light';
  if (m.value < t[1]) return 'regular';
  if (m.value < t[2]) return 'medium';
  if (m.value < t[3]) return 'bold';
  return 'black';
}

/**
 * A starter shortlist per width class, Google Fonts only, chosen to span
 * weight and character inside the class. Used only when the catalog index
 * (data/font-index.json) is missing; with the index, candidates come from
 * the comp's fingerprint and the model's own names.
 */
export const SHORTLIST = {
  compressed: ['League Gothic:400', 'Bebas Neue:400', 'Anton:400', 'Six Caps:400', 'Big Shoulders Display:900', 'Antonio:700', 'Saira Extra Condensed:800', 'Oswald:700'],
  condensed: ['League Gothic:400', 'Fjalla One:400', 'Anton:400', 'Bebas Neue:400', 'Oswald:600', 'Barlow Condensed:700', 'Roboto Condensed:800', 'Archivo Narrow:700', 'Pathway Gothic One:400', 'Big Shoulders Display:800', 'Teko:600', 'Sofia Sans Condensed:800'],
  normal: ['Inter:700', 'Work Sans:700', 'IBM Plex Sans:700', 'Archivo:800', 'Public Sans:700', 'Source Sans 3:700', 'Roboto:900', 'Barlow:800', 'Manrope:800', 'Rubik:800'],
  wide: ['Archivo Black:400', 'Syne:800', 'Space Grotesk:700', 'Unbounded:700', 'Bricolage Grotesque:800', 'Sora:800', 'Outfit:800', 'Lexend:800'],
};

/** Weight-shifted variants of a candidate list, one step lighter and heavier; the ranking decides. */
export function withWeightVariants(list) {
  const out = [];
  for (const c of list) {
    out.push(c);
    const m = /^(.*?):(\d{3})$/.exec(c);
    if (!m) continue;
    const w = parseInt(m[2], 10);
    for (const d of [-200, 200]) { const nw = w + d; if (nw >= 100 && nw <= 900) out.push(`${m[1]}:${nw}`); }
  }
  return [...new Set(out)];
}

/**
 * Candidate faces for a comp fingerprint: the nearest index faces (top n by
 * fingerprint distance, routed to the 14px or 48px index by the crop's cap
 * height, optionally filtered by category), the caller's own names first,
 * and the built-in shortlist only when there is no index. Returns
 * { candidates: [{ family, weight }], catalog: [index hits], source }.
 */
export function selectCandidates(fp, { own = [], index = null, n = 25, category = null } = {}) {
  const catalog = index ? candidatesFromIndex(fp, index, { n, category }) : [];
  const list = [...own, ...catalog.map((c) => ({ family: c.family, weight: c.weight }))];
  let source = 'index';
  if (!index) {
    source = 'shortlist';
    for (const s of withWeightVariants(SHORTLIST[widthClass(fp)] || SHORTLIST.normal)) list.push(parseCandidates(s)[0]);
  }
  const seen = new Set();
  const candidates = list.filter((c) => { const k = `${c.family}:${c.weight}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return { candidates, catalog, source };
}

/**
 * A choice font-match wrote carries a stamp over its own fields, so the spec
 * gate can tell a measured choice from a hand-typed one. Sessions with no
 * browser wrote `"chosen": { "family": "Arial Narrow", "source": "system-fallback" }`
 * straight into spec.json to get past the gate; that is the guess the gate
 * exists to refuse. Not secret, just not something a model reaches for.
 */
export function stampChoice(regionId, chosen) {
  const h = createHash('sha1').update(`font-match:${regionId}:${chosen.family}:${chosen.weight}:${chosen.fontSizePx}:${chosen.source}`).digest('hex').slice(0, 12);
  return { ...chosen, stamp: h };
}
export function choiceStamped(regionId, chosen) {
  if (!chosen || !chosen.stamp) return false;
  return stampChoice(regionId, { ...chosen, stamp: undefined }).stamp === chosen.stamp;
}

// ---- browser --------------------------------------------------------------

/**
 * Playwright and puppeteer write launch artifacts to os.tmpdir(). In a
 * sandbox whose /tmp is not writable (the ninth sweep: EPERM on
 * mkdtemp /tmp/playwright-artifacts-*), every rank silently fell back to the
 * catalog and three of four builds set headlines at twice the comp's cap.
 * Probe once and point TMPDIR at a workspace dir when the system one fails.
 */
function ensureWritableTmp() {
  const os = require('node:os');
  try { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-')); fs.rmSync(d, { recursive: true, force: true }); return; } catch { /* not writable */ }
  const local = path.resolve('.impeccable', 'tmp');
  try { fs.mkdirSync(local, { recursive: true }); process.env.TMPDIR = local; process.env.TMP = local; process.env.TEMP = local; } catch { /* leave as is; launch will say why */ }
}

async function loadBrowser() {
  ensureWritableTmp();
  // IMPECCABLE_NODE_MODULES: a node_modules dir holding playwright or
  // puppeteer, for harnesses that mount the skill somewhere its own resolution
  // roots cannot see (a sandbox root, a plugin cache). NODE_PATH works too.
  const extra = (process.env.IMPECCABLE_NODE_MODULES || '').split(path.delimiter).filter(Boolean);
  const tries = [
    ...extra.map((dir) => () => require(require.resolve('playwright', { paths: [dir, path.dirname(dir)] }))),
    () => require('playwright'),
    () => require(require.resolve('playwright', { paths: [process.cwd()] })),
    () => require(require.resolve('playwright', { paths: [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')] })),
  ];
  for (const t of tries) { try { const pw = t(); if (pw?.chromium) return { kind: 'playwright', mod: pw }; } catch { /* next */ } }
  const tries2 = [
    ...extra.map((dir) => () => require(require.resolve('puppeteer', { paths: [dir, path.dirname(dir)] }))),
    () => require('puppeteer'),
    () => require(require.resolve('puppeteer', { paths: [process.cwd()] })),
    () => require(require.resolve('puppeteer', { paths: [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')] })),
  ];
  for (const t of tries2) { try { const pp = t(); if (pp?.launch) return { kind: 'puppeteer', mod: pp }; } catch { /* next */ } }
  return null;
}

function parseCandidates(s) {
  return String(s || '').split(',').map((x) => x.trim()).filter(Boolean).map((x) => {
    const m = /^(.*?)(?::(\d{3}))?$/.exec(x);
    return { family: m[1].trim(), weight: m[2] ? parseInt(m[2], 10) : 400 };
  });
}

/** Render `text` in each candidate at a font-size whose measured cap height ~= targetCapPx; return fingerprints. */
export async function renderCandidates(candidates, text, targetCapPx, { transform = 'none' } = {}) {
  const b = await loadBrowser();
  if (!b) return null;
  // A resolvable module whose browser binary is absent (CI, a fresh install
  // without npx playwright install) throws at launch; that is the same
  // situation as no module, and the catalog fallback owns it.
  let browser;
  try { browser = b.kind === 'playwright' ? await b.mod.chromium.launch() : await b.mod.launch({ headless: true }); } catch { return null; }
  // One stylesheet per family+weight: a combined request 400s when any one
  // family lacks the requested axis (Anton has no wght range), and a static
  // family answers only for the weights it ships.
  const links = candidates.map((c) => `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(c.family).replace(/%20/g, '+')}:wght@${c.weight}&display=block">`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8">${links}<style>body{margin:0;background:#fff}div.s{position:absolute;left:0;top:0;white-space:nowrap;color:#000;line-height:1;padding:8px;text-transform:${transform}}</style></head><body></body></html>`;
  const results = [];
  const size0 = Math.max(12, Math.round(targetCapPx * 1.4));
  if (b.kind === 'playwright') {
    const page = await browser.newPage({ viewport: { width: 1600, height: 400 }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'load' });
    await page.waitForTimeout(800);
    for (const c of candidates) {
      // two passes: measure at size0, then rescale so the fingerprint's cap height matches the comp
      let size = size0, fp = null, ok = true;
      for (let pass = 0; pass < 2; pass++) {
        await page.evaluate(({ family, weight, size, text }) => {
          document.body.innerHTML = `<div class="s" style="font-family:'${family}',sans-serif;font-weight:${weight};font-size:${size}px">${text}</div>`;
        }, { family: c.family, weight: c.weight, size, text });
        let loaded = false;
        // Loaded means a real face of this family covers the requested weight;
        // fonts.check() answers true for a synthetic bold of a lighter file.
        try {
          loaded = await page.evaluate(async (f) => {
            const faces = await document.fonts.load(`${f.weight} 32px '${f.family}'`);
            await document.fonts.ready;
            const covers = (face) => { const w = String(face.weight || '400').split(/\s+/).map(Number); const lo = w[0], hi = w[1] ?? w[0]; return f.weight >= lo - 50 && f.weight <= hi + 50; };
            return faces.some((face) => face.family.replace(/["']/g, '') === f.family && face.status === 'loaded' && covers(face));
          }, c);
        } catch { loaded = false; }
        await page.waitForTimeout(100);
        if (!loaded) ok = false;
        const box = await page.evaluate(() => { const r = document.querySelector('div.s').getBoundingClientRect(); return { w: Math.ceil(r.width) + 8, h: Math.ceil(r.height) + 8 }; });
        const buf = await page.screenshot({ clip: { x: 0, y: 0, width: Math.min(1600, box.w), height: Math.min(400, box.h) } });
        fp = fingerprint(decodePng(buf));
        if (!fp || pass === 1) break;
        size = Math.max(8, Math.round(size * (targetCapPx / fp.capHeightPx)));
      }
      results.push({ ...c, loaded: ok, fontSizePx: size, fp });
    }
    await browser.close();
  } else {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 400 });
    await page.setContent(html, { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 800));
    for (const c of candidates) {
      let size = size0, fp = null, ok = true;
      for (let pass = 0; pass < 2; pass++) {
        await page.evaluate(({ family, weight, size, text }) => {
          document.body.innerHTML = `<div class="s" style="font-family:'${family}',sans-serif;font-weight:${weight};font-size:${size}px">${text}</div>`;
        }, { family: c.family, weight: c.weight, size, text });
        let loaded = false;
        // Loaded means a real face of this family covers the requested weight;
        // fonts.check() answers true for a synthetic bold of a lighter file.
        try {
          loaded = await page.evaluate(async (f) => {
            const faces = await document.fonts.load(`${f.weight} 32px '${f.family}'`);
            await document.fonts.ready;
            const covers = (face) => { const w = String(face.weight || '400').split(/\s+/).map(Number); const lo = w[0], hi = w[1] ?? w[0]; return f.weight >= lo - 50 && f.weight <= hi + 50; };
            return faces.some((face) => face.family.replace(/["']/g, '') === f.family && face.status === 'loaded' && covers(face));
          }, c);
        } catch { loaded = false; }
        await new Promise((r) => setTimeout(r, 100));
        if (!loaded) ok = false;
        const box = await page.evaluate(() => { const r = document.querySelector('div.s').getBoundingClientRect(); return { w: Math.ceil(r.width) + 8, h: Math.ceil(r.height) + 8 }; });
        const buf = await page.screenshot({ clip: { x: 0, y: 0, width: Math.min(1600, box.w), height: Math.min(400, box.h) } });
        fp = fingerprint(decodePng(buf));
        if (!fp || pass === 1) break;
        size = Math.max(8, Math.round(size * (targetCapPx / fp.capHeightPx)));
      }
      results.push({ ...c, loaded: ok, fontSizePx: size, fp });
    }
    await browser.close();
  }
  return results;
}

/** Comp crop over the top candidates, rendered at the comp's cap height, as one PNG. */
export async function renderProofSheet(compCrop, top, text, capPx, transform = 'none') {
  const b = await loadBrowser();
  if (!b || b.kind !== 'playwright') return null;
  const compB64 = Buffer.from(encodePng(compCrop)).toString('base64');
  const links = top.map((c) => `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(c.family).replace(/%20/g, '+')}:wght@${c.weight}&display=block">`).join('');
  const rowsHtml = top.map((c) => `<div class="row"><div class="lab">${c.family} ${c.weight} · ${c.fontSizePx}px</div><div class="s" style="font-family:'${c.family}';font-weight:${c.weight};font-size:${c.fontSizePx}px;text-transform:${transform}">${text}</div></div>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8">${links}<style>body{margin:0;background:#fff;padding:12px;font-family:system-ui}img{display:block;max-width:100%}.lab{font:12px system-ui;color:#666;margin:10px 0 2px}.s{white-space:nowrap;line-height:1.05;color:#111}</style></head><body><div class="lab">COMP</div><img src="data:image/png;base64,${compB64}">${rowsHtml}</body></html>`;
  let browser;
  try { browser = await b.mod.chromium.launch(); } catch { return null; }
  const page = await browser.newPage({ viewport: { width: Math.min(1600, Math.max(600, compCrop.width + 24)), height: 200 } });
  await page.setContent(html, { waitUntil: 'load' });
  try { await page.evaluate(async () => { await document.fonts.ready; }); } catch { /* ignore */ }
  await page.waitForTimeout(600);
  const buf = await page.screenshot({ fullPage: true });
  await browser.close();
  return buf;
}

// ---- CLI ------------------------------------------------------------------

function describe(fp) {
  const wm = widthMeasure(fp), wt = weightMeasure(fp);
  const wmS = wm ? ` (${wm.key} ${wm.value})` : '';
  const wtS = wt ? ` (${wt.key} ${wt.value})` : '';
  return `capHeight ${fp.capHeightPx}px, width ${widthClass(fp)}${wmS}, weight ${weightClass(fp)}${wtS}, tracking ${fp.gap}${fp.allCaps ? ', all caps' : ''}`;
}

/** Fingerprint fields the spec keeps for a region: the class-bearing features plus the shape summary, not the whole vector. */
function compactFp(fp) {
  if (!fp) return fp;
  const keep = ['lines', 'glyphs', 'capHeightPx', 'inkIsDark', 'allCaps', 'advance', 'advTall', 'advX', 'gap', 'xRatio', 'stemW', 'contrast', 'serif', 'densTall', 'densX', 'weight'];
  const out = {};
  for (const k of keep) if (fp[k] !== undefined) out[k] = fp[k];
  return out;
}

async function main() {
  const specPath = arg('spec', SPEC_PATH);
  const spec = loadSpec(specPath);
  const measureId = arg('measure'), rankId = arg('rank');
  const id = measureId || rankId;
  if (!id) {
    console.error('usage: font-match.mjs --measure <text-region-id> | --rank <text-region-id> [--candidates "Family:700,Family2:400,..."] [--text "..."] [--transform uppercase] [--category sans,serif,display,handwriting,mono]');
    process.exit(1);
  }
  if (!spec) { console.error(`font-match: no spec at ${specPath}; run comp-spec.mjs first`); process.exit(1); }
  const region = spec.regions.find((r) => r.id === id);
  if (!region) { console.error(`font-match: no region ${id}; ids: ${spec.regions.map((r) => r.id).join(', ')}`); process.exit(1); }
  const comp = loadRaster(spec.comp).image;
  const c = crop(comp, region.px.x, region.px.y, region.px.w, region.px.h);
  const fp = fingerprint(c);
  if (!fp) {
    // Record the attempt so the spec gate does not ask again; a region with
    // no separable glyphs (a rule, a bar of solid ink, a very small label at
    // comp resolution) is measured as "no lettering" and the model sizes it
    // by its box.
    region.type = { ...(region.type || {}), comp: null, measuredAt: new Date().toISOString(), note: 'no separable lettering in the crop; size by the region box' };
    fs.writeFileSync(specPath, JSON.stringify(spec, null, 2));
    console.log(`MEASURE ${id}: no separable lettering in the region crop at comp resolution; size this text by its box (${region.px.w}x${region.px.h}px) and inherit face and weight from the nearest measured region.`);
    process.exit(0);
  }
  region.type = { ...(region.type || {}), comp: compactFp(fp), widthClass: widthClass(fp), weightClass: weightClass(fp) };
  fs.writeFileSync(specPath, JSON.stringify(spec, null, 2));
  console.log(`MEASURE ${id}: ${describe(fp)} over ${fp.lines} line${fp.lines === 1 ? '' : 's'}, ${fp.glyphs} glyphs. Set this region's font-size so its cap height renders at ${fp.capHeightPx}px; choose a ${widthClass(fp)} ${weightClass(fp)} face.`);
  if (!rankId) return;
  if (fp.capHeightPx < MIN_RANK_CAP_PX) {
    console.log(`RANK skipped: cap height ${fp.capHeightPx}px is under ${MIN_RANK_CAP_PX}px, too small at comp resolution for a face fingerprint to mean anything. Size this text by its box (${region.px.w}x${region.px.h}px) and inherit face and weight from the nearest measured region.`);
    return;
  }
  const own = parseCandidates(arg('candidates'));
  const index = loadFontIndex();
  const { candidates, catalog, source } = selectCandidates(fp, { own, index, n: 25, category: arg('category') });
  if (index) {
    const top5 = []; for (const h of catalog) { if (!top5.some((t) => t.family === h.family)) top5.push(h); if (top5.length >= 5) break; }
    console.log(`CATALOG top-5 by fingerprint: ${top5.map((t) => `${t.family}:${t.weight}`).join(', ')} (from ${index.entries.length} indexed faces${catalog[0] ? `, ${catalog[0].size}px index` : ''}${arg('category') ? `, category ${arg('category')}` : ''})`);
    console.log(`CANDIDATES ${candidates.length}: ${own.length} yours + ${candidates.length - own.length} nearest in the catalog index`);
  } else {
    console.log(`CANDIDATES ${candidates.length}: ${own.length} yours + ${candidates.length - own.length} from the ${widthClass(fp)} shortlist (no catalog index at data/font-index.json)`);
  }
  const text = arg('text') || region.text || 'The manuals stop. The forum keeps going.';
  const transform = arg('transform', fp.allCaps ? 'uppercase' : 'none');
  const results = await renderCandidates(candidates, text, fp.capHeightPx, { transform });
  if (!results) {
    // No browser: the catalog fingerprint index is the ranking. Its top hit is
    // recorded as the chosen face (source `catalog`) so the spec gate has a
    // measured choice to close on; without this the gate refused forever and
    // sessions forced past it or spent ten turns installing Playwright.
    // font-size is estimated from the cap height at a 0.70 cap/em ratio, the
    // sans display median; the NOTE says to check one rendered word.
    if (index && catalog[0]) {
      const best = catalog[0];
      const fontSizePx = Math.round(fp.capHeightPx / 0.70);
      console.log(`RANK unavailable: no browser (playwright or puppeteer) resolvable from this project or the impeccable CLI; the CATALOG order stands as the ranking.`);
      console.log(`USE font-family: '${best.family}'; font-weight: ${best.weight}; font-size: ${fontSizePx}px;${transform !== 'none' ? ` text-transform: ${transform};` : ''} NOTE font-size is estimated (cap ${fp.capHeightPx}px / 0.70); render one headline word at that size, compare its cap height to the comp crop, and correct the size before building on it.`);
      region.type.chosen = stampChoice(id, { family: best.family, weight: best.weight, fontSizePx, source: 'catalog', estimatedSize: true });
      fs.writeFileSync(specPath, JSON.stringify(spec, null, 2));
      return;
    }
    console.log(`RANK unavailable: no browser (playwright or puppeteer) resolvable from this project or the impeccable CLI, and no catalog index. Choose by the MEASURE line: match the width class first, then the weight class; render one headline word against the comp before building on it.`);
    return;
  }
  // Drop faces that never loaded (a weight the family does not ship falls
  // back to a system face and would rank as that face), then collapse
  // duplicate renders (two requested weights that resolved to one file).
  const seenFp = new Set();
  const rows = results
    .filter((r) => r.fp && r.loaded)
    .map((r) => ({ ...r, d: distance(fp, r.fp) }))
    .filter((r) => Number.isFinite(r.d))
    .sort((a, b) => a.d - b.d)
    .filter((r) => { const k = `${r.family}|${r.fp.advX}|${r.fp.advTall}|${r.fp.densTall}|${r.fp.stemW}`; if (seenFp.has(k)) return false; seenFp.add(k); return true; });
  const dropped = results.filter((r) => !r.loaded).map((r) => `${r.family}:${r.weight}`);
  if (dropped.length) console.log(`SKIPPED (not available at that weight on Google Fonts): ${dropped.join(', ')}`);
  const wm = widthMeasure(fp), wt = weightMeasure(fp);
  const pctDelta = (m, other) => { if (!m || other?.[m.key] == null) return null; return (other[m.key] - m.value) / m.value; };
  const fmtPct = (v) => (v == null ? 'n/a' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(0)}%`);
  for (const r of rows) {
    console.log(`RANK ${r.family}:${r.weight} distance ${r.d.toFixed(3)}  width ${widthClass(r.fp)} (${fmtPct(pctDelta(wm, r.fp))} ${wm?.key || 'advance'})  weight ${weightClass(r.fp)} (${fmtPct(pctDelta(wt, r.fp))} ${wt?.key || 'ink'})  font-size ${r.fontSizePx}px for cap ${fp.capHeightPx}px`);
  }
  // proof sheet: comp crop over the top three renders, so the choice is seen, not only scored
  try {
    const top = rows.slice(0, 3);
    const sheet = await renderProofSheet(c, top, text, fp.capHeightPx, transform);
    if (sheet) {
      const out = path.join(path.dirname(specPath), 'font-match', `${id}.png`);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, sheet);
      console.log(`PROOF ${out} (comp crop, then the top ${top.length} candidates at the comp's cap height; open it before choosing)`);
    }
  } catch { /* proof sheet is best-effort */ }
  const best = rows[0];
  if (best) {
    const advice = [];
    const dw = pctDelta(wm, best.fp), dwt = pctDelta(wt, best.fp);
    if (dw != null && Math.abs(dw) > 0.1) advice.push(dw > 0 ? 'still too wide: try a more condensed face or a variable font with a wdth axis' : 'still too narrow: try a wider face');
    // a weight step only helps on a family that ships one; a single-cut display face is what it is
    const bestEntry = index?.entries.find((e) => e.family === best.family);
    const variable = bestEntry ? bestEntry.variable : true;
    if (dwt != null && Math.abs(dwt) > 0.15 && variable) advice.push(dwt > 0 ? `too heavy: drop to weight ${Math.max(100, best.weight - 200)}` : `too light: raise to weight ${Math.min(900, best.weight + 200)}`);
    console.log(`USE font-family: '${best.family}'; font-weight: ${best.weight}; font-size: ${best.fontSizePx}px;${transform !== 'none' ? ` text-transform: ${transform};` : ''}${advice.length ? ' NOTE ' + advice.join('; ') : ''}`);
    region.type.chosen = stampChoice(id, { family: best.family, weight: best.weight, fontSizePx: best.fontSizePx, source, fp: compactFp(best.fp) });
    fs.writeFileSync(specPath, JSON.stringify(spec, null, 2));
  }
}

const isMain = (() => {
  try { return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
})();
if (isMain) main().catch((e) => { console.error(`font-match: ${e.message}`); process.exit(1); });
