/**
 * font-index: the fingerprint index of the Google Fonts catalog that
 * font-match.mjs --rank uses as its candidate generator, and the pack/unpack
 * helpers the release-time build (repo scripts/build-font-index.mjs) shares with it.
 *
 * File: skill/scripts/data/font-index.json
 *   {
 *     schema: 1,
 *     text: "<index text every face was rendered with>",
 *     sizes: [48, 14],            // cap heights (px) the catalog was rendered at
 *     features: [...],            // feature names, in vector order (the fitted-nonzero subset of FEATURES)
 *     categories: ["sans", ...],  // category index -> name
 *     entries: [[family, weight, categoryIdx, variable(0|1), vec48, vec14], ...]
 *   }
 * A vector is a string of 3-char base-36 numbers, one per feature, each the
 * feature value x 1000 (three decimals, clipped at 46.655); "___" is null.
 * That packing keeps ~3,000 faces x 2 sizes x 33 features under 750 KB on
 * disk, which is what makes it shippable inside the skill without gzip.
 *
 * Two sizes because the fingerprint's features are stable within a factor of
 * ~2 in size but not from 48px down to 14px: a crop is routed to the index
 * rendered nearer its own cap height (ROUTE_CAP_PX is the boundary).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FEATURES, STATS, distance } from './font-fingerprint.mjs';

export const INDEX_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'font-index.json');
/** Cap heights the catalog is rendered at. `48c` is the same 48px cap in ALL
 *  CAPS text (schema 2), queried for caps crops; a schema-1 index without it
 *  routes caps crops to the mixed-case 48 as before. */
export const INDEX_SIZES = [48, 14, '48c'];
/** Crops with a cap height under this many px query the 14px index. */
export const ROUTE_CAP_PX = 22;
/** Below this cap height the fingerprint is not trustworthy; callers size by the box instead. */
export const MIN_RANK_CAP_PX = 10;
export const CATEGORIES = ['sans', 'serif', 'display', 'handwriting', 'mono'];
/** The features the index stores: the ones the fitted distance gives nonzero weight. */
export const GROSS_FEATURES = ['advance', 'advTall', 'advX', 'densTall', 'densX', 'stemW'];
export const INDEX_FEATURES = FEATURES.filter((k) => (STATS[k] && STATS[k].w > 0) || GROSS_FEATURES.includes(k));

const NULL_TOKEN = '___';
const MAX_Q = 36 ** 3 - 1;

export function packVector(fp, features = INDEX_FEATURES) {
  return features.map((k) => {
    const v = fp?.[k];
    if (v == null || !Number.isFinite(v)) return NULL_TOKEN;
    return Math.min(MAX_Q, Math.max(0, Math.round(v * 1000))).toString(36).padStart(3, '0');
  }).join('');
}

export function unpackVector(s, features = INDEX_FEATURES) {
  const out = {};
  for (let i = 0; i < features.length; i++) {
    const t = s.slice(i * 3, i * 3 + 3);
    out[features[i]] = t === NULL_TOKEN || t.length < 3 ? null : parseInt(t, 36) / 1000;
  }
  return out;
}

let cached = null;
/**
 * Load and decode the index. Returns null when the file is missing (callers
 * fall back to their built-in shortlist). Result: { schema, text, sizes,
 * features, entries: [{ family, weight, category, variable, fp: { 48: {...}, 14: {...}|null } }] }.
 */
export function loadFontIndex(file = INDEX_PATH) {
  if (cached && cached.file === file) return cached.index;
  if (!fs.existsSync(file)) return null;
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const features = raw.features || INDEX_FEATURES;
  const cats = raw.categories || CATEGORIES;
  const sizes = raw.sizes || INDEX_SIZES;
  const entries = raw.entries.map((e) => {
    const fp = {};
    sizes.forEach((sz, i) => { const v = e[4 + i]; fp[sz] = v ? unpackVector(v, features) : null; });
    return { family: e[0], weight: e[1], category: cats[e[2]] ?? String(e[2]), variable: !!e[3], fp };
  });
  const index = { schema: raw.schema, text: raw.text, sizes, features, entries };
  cached = { file, index };
  return index;
}

/** Which of the index's cap sizes a crop with this cap height should query. */
export function routeSize(capHeightPx, sizes = INDEX_SIZES, { allCaps = false } = {}) {
  const numeric = sizes.filter((s) => typeof s === 'number').sort((a, b) => a - b);
  if (allCaps && capHeightPx >= ROUTE_CAP_PX && sizes.includes('48c')) return '48c';
  return capHeightPx < ROUTE_CAP_PX ? numeric[0] : numeric[numeric.length - 1];
}

/**
 * The n nearest catalog faces to a comp fingerprint, routed by cap height.
 * Returns [{ family, weight, category, variable, d, size }] sorted by distance;
 * at most `perFamily` entries of one family so the shortlist spans faces, not weights.
 */
/**
 * Faces that are not lettering: barcodes, redaction bars, placeholder "flow"
 * text, dingbats, symbol fonts, and effect faces (outlines, shades, glitch,
 * pixel, 3D) whose fingerprint lands near heavy condensed text without being
 * usable as it. A comp headline never wants them; a caller who does can pass
 * them by name in `--candidates`.
 */
export const NON_TEXT_FAMILY = /barcode|^redacted|^flow (block|circular|rounded)|dings|symbols|^bungee (hairline|outline|shade|spice)|^rubik (80s|beastly|broken|bubbles|burned|dirt|distressed|doodle|gemstones|glitch|iso|lines|marker|maze|microbe|moonrocks|pixels|puddles|scribble|spray|storm|vinyl|wet)|^(nabla|honk|kablammo|sixtyfour|workbench|codystar|rock 3d|zen dots|ballet|butcherman|creepster|eater|faster one|frijole|nosifer|metal mania|miltonian)/i;

export function candidatesFromIndex(fp, index, { n = 25, category = null, perFamily = 2, includeNonText = false } = {}) {
  if (!fp || !index) return [];
  const size = routeSize(fp.capHeightPx, index.sizes, { allCaps: !!fp.allCaps });
  const wantCat = category ? String(category).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) : null;
  const scored = [];
  for (const e of index.entries) {
    if (wantCat && !wantCat.includes(e.category)) continue;
    if (!includeNonText && NON_TEXT_FAMILY.test(e.family)) continue;
    const v = e.fp[size];
    if (!v) continue;
    const d = distance(fp, v);
    if (!Number.isFinite(d)) continue;
    scored.push({ family: e.family, weight: e.weight, category: e.category, variable: e.variable, d, size });
  }
  scored.sort((a, b) => a.d - b.d);
  const perFam = new Map(); const out = [];
  for (const s of scored) {
    const c = perFam.get(s.family) || 0;
    if (c >= perFamily) continue;
    perFam.set(s.family, c + 1); out.push(s);
    if (out.length >= n) break;
  }
  return out;
}
