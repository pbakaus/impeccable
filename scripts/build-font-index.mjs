#!/usr/bin/env node
/**
 * build-font-index: rebuild skill/scripts/data/font-index.json, the fingerprint
 * index of the Google Fonts catalog that `font-match.mjs --rank` uses as its
 * candidate generator.
 *
 * This is a RELEASE-TIME step, not part of `bun run build`. It needs the
 * network (Google Fonts metadata + CSS) and Playwright Chromium, renders every
 * latin family at up to three weights (300 / 400 / 700, whichever the family
 * ships) at two cap heights (48px and 14px), fingerprints each render with
 * skill/scripts/lib/font-fingerprint.mjs, and packs the vectors with
 * skill/scripts/lib/font-index.mjs. A full run is ~6,000 renders and takes
 * 20-40 minutes. Rerun it when the fingerprint's FEATURES or STATS change
 * (the index stores only the features the fitted distance weights) or when
 * the catalog has moved on enough to matter; commit the regenerated JSON.
 *
 *   node scripts/build-font-index.mjs [--out skill/scripts/data/font-index.json]
 *                                     [--sample N]        # first N families only (tests, smoke)
 *                                     [--families "Inter,Oswald"]
 *                                     [--metadata path]   # cached fonts.google.com/metadata/fonts JSON
 *                                     [--resume]          # keep entries already in --out
 *
 * One-time setup: `npx playwright install chromium`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { fingerprint } from '../skill/scripts/lib/font-fingerprint.mjs';
import { decodePng } from '../skill/scripts/lib/png.mjs';
import { INDEX_PATH, INDEX_SIZES, INDEX_FEATURES, CATEGORIES, packVector } from '../skill/scripts/lib/font-index.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Text every catalog face is rendered with; covers caps, x-height letters, ascenders, descenders, digits. */
export const INDEX_TEXT = 'The quick brown fox jumps over the lazy dog 0123456789 HAMBURGEVONS';
/** All-caps variant, rendered at the large cap size only: a caps headline
 *  crop has no x-height band, so its features (advance, run lengths, vertical
 *  profile) belong to a different distribution than mixed-case text; matching
 *  a caps crop against mixed-case renders ranked barcode faces above the
 *  headline's own family. */
export const INDEX_TEXT_CAPS = 'THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG 0123456789 HAMBURGEVONS';
export const INDEX_WEIGHTS = [300, 400, 700];
const METADATA_URL = 'https://fonts.google.com/metadata/fonts';
const CATEGORY_MAP = { 'Sans Serif': 'sans', Serif: 'serif', Display: 'display', Handwriting: 'handwriting', Monospace: 'mono' };

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

/** Catalog entries [{ family, weight, category, variable }] from the Google Fonts metadata document. */
export function entriesFromMetadata(meta, { weights = INDEX_WEIGHTS } = {}) {
  const list = (meta.familyMetadataList || []).filter((x) => (x.subsets || []).includes('latin'));
  const out = [];
  for (const x of list) {
    const ax = (x.axes || []).find((a) => a.tag === 'wght');
    const ks = Object.keys(x.fonts || {}).filter((k) => !k.endsWith('i')).map(Number);
    const ws = weights.filter((t) => (ax ? t >= ax.min && t <= ax.max : ks.includes(t)));
    for (const w of ws) out.push({ family: x.family, weight: w, category: CATEGORY_MAP[x.category] || String(x.category || '').toLowerCase(), variable: !!ax });
  }
  return out;
}

/** Serialize decoded entries into the on-disk shape (see lib/font-index.mjs). */
export function serializeIndex(entries, { text = INDEX_TEXT, textCaps = INDEX_TEXT_CAPS, sizes = INDEX_SIZES } = {}) {
  const rows = entries.map((e) => [e.family, e.weight, Math.max(0, CATEGORIES.indexOf(e.category)), e.variable ? 1 : 0, ...sizes.map((sz) => (e.fp?.[sz] ? packVector(e.fp[sz]) : null))]);
  return JSON.stringify({ schema: 2, text, textCaps, sizes, features: INDEX_FEATURES, categories: CATEGORIES, entries: rows });
}

const gfHref = (f, w) => `https://fonts.googleapis.com/css2?family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@${w}&display=block`;

/** Render one face at a target cap height on an open page and return its fingerprint (or null when the face did not load). */
async function fingerprintFace(page, e, targetCap, text) {
  let size = Math.round(targetCap * 1.4), fp = null;
  for (let pass = 0; pass < 2; pass++) {
    await page.evaluate(({ family, weight, size, text }) => {
      document.body.innerHTML = `<div class="s" style="font-family:'${family}',sans-serif;font-weight:${weight};font-size:${size}px">${text}</div>`;
    }, { family: e.family, weight: e.weight, size, text });
    let loaded = false;
    try {
      loaded = await Promise.race([page.evaluate(async (f) => {
        const faces = await document.fonts.load(`${f.weight} 32px '${f.family}'`);
        await document.fonts.ready;
        const covers = (face) => { const w = String(face.weight || '400').split(/\s+/).map(Number); const lo = w[0], hi = w[1] ?? w[0]; return f.weight >= lo - 50 && f.weight <= hi + 50; };
        return faces.some((face) => face.family.replace(/["']/g, '') === f.family && face.status === 'loaded' && covers(face));
      }, e), new Promise((r) => setTimeout(() => r(false), 8000))]);
    } catch { loaded = false; }
    if (!loaded) return null;
    const box = await page.evaluate(() => { const r = document.querySelector('div.s').getBoundingClientRect(); return { w: Math.ceil(r.width) + 8, h: Math.ceil(r.height) + 8 }; });
    const buf = await page.screenshot({ clip: { x: 0, y: 0, width: Math.min(3000, box.w), height: Math.min(300, box.h) } });
    fp = fingerprint(decodePng(buf));
    if (!fp || pass === 1) break;
    size = Math.max(6, Math.round(size * (targetCap / fp.capHeightPx)));
  }
  return fp;
}

async function main() {
  const out = path.resolve(ROOT, arg('out', INDEX_PATH));
  const sample = arg('sample') ? parseInt(arg('sample'), 10) : null;
  const only = arg('families') ? new Set(arg('families').split(',').map((s) => s.trim())) : null;
  const metaPath = arg('metadata');
  const meta = metaPath ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : await (await fetch(METADATA_URL)).json();
  let entries = entriesFromMetadata(meta);
  if (only) entries = entries.filter((e) => only.has(e.family));
  if (sample) { const fams = [...new Set(entries.map((e) => e.family))].slice(0, sample); const keep = new Set(fams); entries = entries.filter((e) => keep.has(e.family)); }
  // --resume keeps entries already in --out. An entry whose fp is missing a
  // size the current INDEX_SIZES names (a schema-1 index before `48c`) is
  // re-rendered for the missing sizes only.
  const done = new Map();
  if (has('resume') && fs.existsSync(out)) {
    const { loadFontIndex } = await import('../skill/scripts/lib/font-index.mjs');
    for (const e of loadFontIndex(out).entries) {
      const missing = INDEX_SIZES.filter((sz) => !e.fp[sz]);
      if (missing.length && missing.length < INDEX_SIZES.length) e.missing = missing;
      done.set(`${e.family}:${e.weight}`, e);
    }
  }
  const renderSize = async (e, sz) => (typeof sz === 'string' && sz.endsWith('c') ? fingerprintFace(page, e, parseInt(sz, 10), INDEX_TEXT_CAPS) : fingerprintFace(page, e, sz, INDEX_TEXT));
  const pw = require('playwright');
  const browser = await pw.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 3000, height: 300 }, deviceScaleFactor: 1 });
  const results = [...done.values()].filter((e) => !e.missing);
  const failures = [];
  const byFam = new Map();
  for (const e of entries) {
    const prev = done.get(`${e.family}:${e.weight}`);
    if (prev && !prev.missing) continue;
    if (!byFam.has(e.family)) byFam.set(e.family, []);
    byFam.get(e.family).push(prev ? { ...e, prev } : e);
  }
  const fams = [...byFam.keys()];
  const t0 = Date.now(); let n = 0;
  for (let i = 0; i < fams.length; i += 20) {
    const todo = fams.slice(i, i + 20).flatMap((f) => byFam.get(f));
    const links = todo.map((e) => `<link rel="stylesheet" href="${gfHref(e.family, e.weight)}">`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8">${links}<style>body{margin:0;background:#fff}div.s{position:absolute;left:0;top:0;white-space:nowrap;color:#000;line-height:1;padding:8px}</style></head><body></body></html>`;
    try { await page.setContent(html, { waitUntil: 'load', timeout: 30000 }); } catch (err) { console.error(`batch at ${i}: ${err.message}`); }
    for (const e of todo) {
      n++;
      try {
        const fp = e.prev ? { ...e.prev.fp } : {};
        for (const sz of (e.prev ? e.prev.missing : INDEX_SIZES)) fp[sz] = await renderSize(e, sz);
        if (!fp[INDEX_SIZES[0]]) { failures.push({ ...e, reason: 'not loaded or no lettering' }); continue; }
        const { prev, ...clean } = e;
        results.push({ ...clean, fp });
      } catch (err) { failures.push({ ...e, reason: err.message.slice(0, 120) }); }
    }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, serializeIndex(results));
    const el = (Date.now() - t0) / 1000;
    console.error(`${n}/${entries.length - done.size} rendered, ${results.length} indexed, ${failures.length} failed, ${el.toFixed(0)}s`);
  }
  await browser.close();
  fs.writeFileSync(out, serializeIndex(results));
  if (failures.length) fs.writeFileSync(out.replace(/\.json$/, '-failures.json'), JSON.stringify(failures, null, 1));
  console.error(`DONE ${results.length} faces -> ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB), ${failures.length} failed`);
}

const isMain = (() => { try { return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) main().catch((e) => { console.error(`build-font-index: ${e.message}`); process.exit(1); });
