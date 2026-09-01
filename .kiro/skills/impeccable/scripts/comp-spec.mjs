#!/usr/bin/env node
/**
 * comp-spec: turn an approved comp into a measured build spec, so the build
 * codes against numbers and crops instead of a memory of the image.
 *
 * Step 1, look at the comp with a coordinate grid on it:
 *   node comp-spec.mjs --comp .impeccable/mocks/approved.png --grid
 *     writes .impeccable/build/comp-grid.png (10x10 labeled grid, A-J / 0-9)
 *     and prints the measured palette and horizontal bands. Open the grid
 *     image and name every salient region by its grid span.
 *
 * Step 2, write the regions file (JSON) and measure it:
 *   node comp-spec.mjs --comp <comp> --regions regions.json
 *     regions.json: { "regions": [ { "id": "exploded-plate", "kind": "plate",
 *       "grid": "E0:J4", "note": "exploded carburetor line drawing" }, ... ] }
 *     `grid` is "<colrow>:<colrow>" inclusive (A0 top-left cell to J9 bottom
 *     right); `box` { x, y, w, h } normalized 0..1 is accepted instead. `kind`
 *     is one of plate | image | texture | text | control | chrome | band.
 *     Writes .impeccable/build/spec.json: every region with its normalized
 *     box, pixel box, sampled palette, detail energy, and its medium: raster
 *     for plate / image / texture (produced as a plate, never CSS), semantic
 *     for text / control / chrome. `--auto` proposes band regions from the
 *     comp itself when you have no regions file yet.
 *
 * Step 3, use it:
 *   node comp-spec.mjs --print                      # compact spec for the build thread
 *   node comp-spec.mjs --crop exploded-plate --out tmp/plate-src.png [--scale 2] [--raw]
 *     crops the region from the comp (reference for a plate regeneration; a
 *     crop is never a shipping asset, its resolution is comp grade). For a
 *     raster region the crop has overlapping text/control/chrome regions
 *     painted out, matching what the plate prompt asks the generator to
 *     remove; --raw keeps them.
 *   node comp-spec.mjs --plate-prompt exploded-plate  # the regeneration prompt for that region
 *
 * comp-diff.mjs reads the same spec (`--spec`) so its region rows and this
 * file's rows are the same rows.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng, loadRaster } from './lib/png.mjs';
import { crop, resize, fillRect, strokeRect, drawLabel, drawText } from './lib/raster.mjs';
import { dominantColors, horizontalBands, detailGrid } from './lib/image-metrics.mjs';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

export const BUILD_DIR = path.join('.impeccable', 'build');
export const SPEC_PATH = path.join(BUILD_DIR, 'spec.json');
export const GRID_PATH = path.join(BUILD_DIR, 'comp-grid.png');
export const PLATES_DIR = path.join('assets', 'plates');

export const RASTER_KINDS = new Set(['plate', 'image', 'texture']);
export const KINDS = new Set(['plate', 'image', 'texture', 'text', 'control', 'chrome', 'band']);
const COLS = 'ABCDEFGHIJ';

/** "E0:J4" -> normalized box (inclusive cell span on a 10x10 grid). */
export function gridToBox(span) {
  const m = /^([A-J])(\d):([A-J])(\d)$/i.exec(String(span).trim());
  if (!m) throw new Error(`grid span "${span}" is not <colrow>:<colrow>, e.g. E0:J4`);
  const c0 = COLS.indexOf(m[1].toUpperCase()), r0 = +m[2], c1 = COLS.indexOf(m[3].toUpperCase()), r1 = +m[4];
  const x0 = Math.min(c0, c1), x1 = Math.max(c0, c1), y0 = Math.min(r0, r1), y1 = Math.max(r0, r1);
  return { x: x0 / 10, y: y0 / 10, w: (x1 - x0 + 1) / 10, h: (y1 - y0 + 1) / 10 };
}

export function renderGrid(comp) {
  const targetW = Math.min(1536, comp.width);
  const img = resize(comp, targetW, Math.round((comp.height / comp.width) * targetW));
  const cw = img.width / 10, ch = img.height / 10;
  const line = [255, 40, 40, 200];
  for (let i = 1; i < 10; i++) {
    fillRect(img, Math.round(i * cw), 0, 1, img.height, line);
    fillRect(img, 0, Math.round(i * ch), img.width, 1, line);
  }
  for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) {
    drawLabel(img, `${COLS[c]}${r}`, Math.round(c * cw) + 3, Math.round(r * ch) + 3, { scale: 2, bg: [0, 0, 0, 170], fg: [255, 230, 120, 255] });
  }
  return img;
}

function paletteOf(img) {
  return dominantColors(img, 5).map(({ hex, coverage }) => ({ hex, coverage }));
}

/** Words in a region note that name painted material rather than code-drawn UI. */
export const PAINTED_NOTE = /\b(diagram|drawing|drawn|illustration|illustrations|illustrated|figure|schematic|exploded|photo|photos|photograph\w*|picture|painting|painted|render|rendered|rendering|artwork|engraving|etching|linework|line art|texture|textured|textures|grain|fabric|halftone|watercolou?r|sketch|sketched|blueprint|geometry|leader lines?|callout lines?|thumbnail|silhouette|product shot|hero image|3d)\b/i;

/** A text/control/chrome region larger than this fraction of the comp is a column, not an element. */
export const MAX_CODE_REGION_AREA = 0.25;

/** Fraction of an edge's length the artwork's dark mass has to touch to count as running off the box. */
export const EDGE_CONTACT_MIN = 0.35;

/**
 * Which edges of a plate region crop the artwork touches. 'Artwork' is the
 * region's non-ground mass: pixels far from the crop's median gray. A margin
 * of paper along an edge means the shape ends inside the box; a long run of
 * ink along it means the shape continues past it.
 */
export function artworkTouchesEdges(img, { contact = EDGE_CONTACT_MIN, band = 2, ground = null } = {}) {
  const W = img.width, H = img.height;
  const gray = new Float32Array(W * H);
  for (let i = 0, j = 0; i < img.data.length; i += 4, j++) gray[j] = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
  // ground is the page's, not the crop's: a region that is mostly a black
  // arch on paper has a mid-gray median and every edge reads as ink
  if (ground == null) {
    const sample = []; for (let i = 0; i < gray.length; i += Math.max(1, Math.floor(gray.length / 5000))) sample.push(gray[i]);
    sample.sort((a, b) => a - b); ground = sample[Math.floor(sample.length / 2)];
  }
  const ink = (x, y) => Math.abs(gray[y * W + x] - ground) > 60;
  const sides = [];
  // the longest contiguous run of ink along the edge, as a fraction of it:
  // an arch cut by the box leaves a long unbroken contact; grain, a rule
  // crossing, or a line of small type leave short ones
  const run = (n, at) => { let best = 0, cur = 0; for (let i = 0; i < n; i++) { if (at(i)) { cur++; if (cur > best) best = cur; } else cur = 0; } return best / n; };
  if (run(H, (y) => { for (let x = 0; x < band; x++) if (ink(x, y)) return true; return false; }) >= contact) sides.push('left');
  if (run(H, (y) => { for (let x = W - band; x < W; x++) if (ink(x, y)) return true; return false; }) >= contact) sides.push('right');
  if (run(W, (x) => { for (let y = 0; y < band; y++) if (ink(x, y)) return true; return false; }) >= contact) sides.push('top');
  if (run(W, (x) => { for (let y = H - band; y < H; y++) if (ink(x, y)) return true; return false; }) >= contact) sides.push('bottom');
  return sides;
}

/**
 * Shrink a normalized box to the ink inside it (pixels far from the page
 * ground), padded by `pad` px, never grown. Returns null when the crop has no
 * ink or the ink fills the box already.
 */
export function snapBoxToInk(comp, box, ground, { pad = 6, minShrink = 0.06 } = {}) {
  const px = { x: Math.round(box.x * comp.width), y: Math.round(box.y * comp.height), w: Math.round(box.w * comp.width), h: Math.round(box.h * comp.height) };
  if (px.w < 8 || px.h < 8) return null;
  const c = crop(comp, px.x, px.y, px.w, px.h);
  const W = c.width, H = c.height;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const g = 0.299 * c.data[i] + 0.587 * c.data[i + 1] + 0.114 * c.data[i + 2];
    if (Math.abs(g - ground) > 60) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  // The bounding box of all ink cannot shed a neighbour that shares the
  // span (a spine at the left edge, the next column's text at the right).
  // Take the largest connected ink mass instead: cells of `cell` px are
  // inked when 4% of their pixels are; 8-connected components; the one
  // with the most inked cells is the element the region names.
  const cell = Math.max(6, Math.round(Math.min(W, H) / 40));
  const cw = Math.ceil(W / cell), ch = Math.ceil(H / cell);
  const on = new Uint8Array(cw * ch), cnt = new Uint16Array(cw * ch);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const g = 0.299 * c.data[i] + 0.587 * c.data[i + 1] + 0.114 * c.data[i + 2];
    if (Math.abs(g - ground) > 60) cnt[Math.floor(y / cell) * cw + Math.floor(x / cell)]++;
  }
  for (let i = 0; i < on.length; i++) on[i] = cnt[i] >= cell * cell * 0.04 ? 1 : 0;
  // dilate by one cell so the letters of a word and the lines of a block
  // join into one mass; a neighbouring column a few cells away stays apart
  const grown = new Uint8Array(on.length);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    if (!on[y * cw + x]) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < cw && ny < ch) grown[ny * cw + nx] = 1; }
  }
  const mask = grown;
  const label = new Int32Array(cw * ch).fill(-1);
  let best = null;
  for (let s0 = 0; s0 < on.length; s0++) {
    if (!mask[s0] || label[s0] >= 0) continue;
    const stack = [s0]; label[s0] = s0; let n = 0, bx0 = cw, by0 = ch, bx1 = -1, by1 = -1;
    while (stack.length) {
      const k = stack.pop();
      const kx = k % cw, ky = (k / cw) | 0;
      if (on[k]) { n += cnt[k]; if (kx < bx0) bx0 = kx; if (kx > bx1) bx1 = kx; if (ky < by0) by0 = ky; if (ky > by1) by1 = ky; }
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = kx + dx, ny = ky + dy; if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
        const nk = ny * cw + nx; if (mask[nk] && label[nk] < 0) { label[nk] = s0; stack.push(nk); }
      }
    }
    // a mass touching the span's left or right edge continues past it (the
    // spine, the next column); the element the region names sits inside.
    // Prefer an inside mass unless the edge mass is far heavier.
    const touchesSide = bx0 === 0 || bx1 === cw - 1;
    const cand = { n, bx0, by0, bx1, by1, touchesSide };
    if (!best) best = cand;
    else if (best.touchesSide && !cand.touchesSide && cand.n * 3 >= best.n) best = cand;
    else if (!best.touchesSide && cand.touchesSide && cand.n < best.n * 3) { /* keep inside */ }
    else if (cand.n > best.n) best = cand;
  }
  if (best) { x0 = best.bx0 * cell; y0 = best.by0 * cell; x1 = Math.min(W - 1, (best.bx1 + 1) * cell - 1); y1 = Math.min(H - 1, (best.by1 + 1) * cell - 1); }
  const nx0 = Math.max(0, x0 - pad), ny0 = Math.max(0, y0 - pad), nx1 = Math.min(W, x1 + 1 + pad), ny1 = Math.min(H, y1 + 1 + pad);
  const shrink = 1 - ((nx1 - nx0) * (ny1 - ny0)) / (W * H);
  if (shrink < minShrink) return null;
  return { x: (px.x + nx0) / comp.width, y: (px.y + ny0) / comp.height, w: (nx1 - nx0) / comp.width, h: (ny1 - ny0) / comp.height };
}

function medianGray(img) {
  const sample = [];
  const step = Math.max(1, Math.floor((img.width * img.height) / 6000));
  for (let j = 0; j < img.width * img.height; j += step) { const i = j * 4; sample.push(0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]); }
  sample.sort((a, b) => a - b);
  return sample[Math.floor(sample.length / 2)];
}

function energyOf(img) {
  const g = detailGrid(img, 4, 4, 256);
  let s = 0; for (const v of g.cells) s += v;
  return s / g.cells.length;
}


/**
 * Grid cells (10x10) that carry ink the regions do not name. A regions file
 * that omits the comp's callouts, notes block, or parts table makes those
 * elements invisible to every later gate (they are never 'missing' if they
 * were never named), so the spec refuses to close over them. Texture and
 * band regions do not cover: a full-bleed paper texture names the ground,
 * not the drawing on it.
 */
export function uncoveredInkCells(comp, regions) {
  const grid = detailGrid(comp, 10, 10, 512);
  const cells = [];
  // The ground's own energy (paper grain, gradient) is the quietest tenth of
  // cells; ink is anything clearly above that. Median-relative thresholds
  // fail on textured comps where every cell carries grain.
  const energies = [...grid.cells].sort((a, b) => a - b);
  const ground = energies[Math.floor(energies.length * 0.1)] || 0;
  const threshold = Math.max(4, ground * 2.2, ground + 12);
  for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) {
    const e = grid.cells[r * 10 + c];
    if (e < threshold) continue;
    const cx = (c + 0.5) / 10, cy = (r + 0.5) / 10;
    const covered = regions.some((reg) => { const b = reg.coverBox || reg.box; return reg.kind !== 'texture' && reg.kind !== 'band' && cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h; });
    if (!covered) cells.push(`${COLS[c]}${r}`);
  }
  return cells;
}

export function measureRegions(comp, regionsInput, compPath) {
  const regions = [];
  const warnings = [];
  const seen = new Set();
  const pageGround = medianGray(comp);
  for (const raw of regionsInput.regions || []) {
    if (!raw.id) throw new Error('every region needs an id');
    if (seen.has(raw.id)) throw new Error(`duplicate region id ${raw.id}`);
    seen.add(raw.id);
    const kind = raw.kind && KINDS.has(raw.kind) ? raw.kind : 'band';
    // Every region says what it is. The note is what the plate prompt, the
    // gate messages, and the painted-material check read; a regions file of
    // bare ids and kinds is a list of boxes, and a session that named a
    // carburetor drawing "chrome" with no note was caught by nothing.
    if (kind !== 'band' && !(raw.note && String(raw.note).trim().length >= 8)) {
      throw new Error(`region ${raw.id} has no note. Say in a few words what the comp shows there (the element, its material, its role): the note drives the plate prompt and the gate's messages, and a drawing named as chrome is only caught by what its note says.`);
    }
    // The note is the model's own reading of the region. A note that names
    // painted material (a drawing, diagram, photo, illustration, texture)
    // filed under a code kind is a plate about to be redrawn in SVG: the
    // exploded carburetor "chrome" that the hero gate then scores missing.
    // Refuse at the spec, where the fix is one word, not at the hero.
    // Escape hatches persist into the spec and announce themselves: a
    // refusal overridden in regions.json used to vanish from spec.json, so
    // the shipped spec showed a clean classification with no trace (found in
    // the ninth sweep, where both carburetor illustrations were filed as
    // chrome behind codeDrawn: true).
    for (const key of ['codeDrawn', 'container', 'bleed']) {
      if (raw[key]) warnings.push(`region ${raw.id}: "${key}": true set in the regions file${key === 'codeDrawn' ? ' (the painted-material refusal is overridden: code draws this region)' : key === 'container' ? ' (the region-size refusal is overridden: one undivided element)' : ' (the clipped-artwork refusal is overridden: the page crops it there)'}`);
    }
    if (raw.note && !RASTER_KINDS.has(kind) && kind !== 'band' && PAINTED_NOTE.test(raw.note) && !raw.codeDrawn) {
      throw new Error(`region ${raw.id} is kind "${kind}" but its note describes painted material ("${raw.note}"). Anything drawn, photographed, or textured ships as a raster plate: set kind to plate (illustration, diagram, figure), image (photograph), or texture (ground). If the note is wrong and code really draws it (a table, a rule, a chrome bar), reword the note or set "codeDrawn": true on the region.`);
    }
    let box = raw.box && typeof raw.box.x === 'number' ? raw.box : gridToBox(raw.grid);
    // A grid span over-covers: a headline named B1:E4 carries the deck below
    // it and a slice of the next column, and every measurement downstream
    // (cap height, line count, structure) inherits that slop; a session
    // wrote a note saying its hero sat at 67 because the boxes straddled
    // elements, and it was right. Text and control regions snap to the ink
    // inside their span (page ground as the reference, a small pad); plates,
    // textures, chrome, and any region given an explicit box are left as
    // drawn. The grid stays on the record.
    let coverBox = null;
    if (!raw.box && raw.grid && (kind === 'text' || kind === 'control') && raw.snap !== false) {
      const snapped = snapBoxToInk(comp, box, pageGround);
      if (snapped) { coverBox = box; box = snapped; }
    }
    // A code region is one element the page draws: a headline, a table, a
    // button, a bar. A "chrome" region covering a third of the comp is a
    // column, and a column scored as one region hides everything inside it
    // (a session named seven regions for a page with three plates, a table,
    // a note, callouts and a spine, and the hero gate could name nothing).
    // Raster regions may be as large as the material; a texture is a sample.
    const area = box.w * box.h;
    if (!RASTER_KINDS.has(kind) && kind !== 'band' && area > MAX_CODE_REGION_AREA && !raw.container) {
      throw new Error(`region ${raw.id} (${kind}) covers ${Math.round(area * 100)}% of the comp; a code region is one element (a headline, a table, a control, a rule, a bar), and one this large is a column holding several. Name each element inside it as its own region (every illustration or photo as a plate), or set "container": true on the region if it truly is one undivided element.`);
    }
    const px = { x: Math.round(box.x * comp.width), y: Math.round(box.y * comp.height), w: Math.round(box.w * comp.width), h: Math.round(box.h * comp.height) };
    const c = crop(comp, px.x, px.y, px.w, px.h);
    const energy = energyOf(c);
    const raster = RASTER_KINDS.has(kind);
    // A plate box that cuts through its own artwork is a plate the page will
    // crop: object-fit: cover on that box shows the artwork with the side the
    // box lost, and the hero passed a cover arch cut flat on the left and
    // bleeding into the footer at 87%. Measure the artwork's edge contact
    // and say it here, where the fix is a wider grid span.
    // sides on the comp's own edge do not count: the comp crops there too
    const atCompEdge = { left: px.x <= 1, top: px.y <= 1, right: px.x + px.w >= comp.width - 1, bottom: px.y + px.h >= comp.height - 1 };
    const clipped = raster && kind !== 'texture' && !raw.bleed ? artworkTouchesEdges(c, { ground: pageGround }).filter((side) => !atCompEdge[side]) : [];
    if (clipped.length) warnings.push(`region ${raw.id}: the artwork runs off the box on the ${clipped.join(' and ')} (its ink reaches the edge over ${EDGE_CONTACT_MIN * 100}% of that side). Widen the region so the box holds the whole shape with a margin; a plate placed with object-fit: cover on this box would be cut there.`);
    regions.push({
      id: raw.id,
      kind,
      note: raw.note || null,
      grid: raw.grid || null,
      codeDrawn: raw.codeDrawn ? true : undefined,
      container: raw.container ? true : undefined,
      bleed: raw.bleed ? true : undefined,
      snap: raw.snap === false ? false : undefined,
      coverBox: coverBox ? { x: r4(coverBox.x), y: r4(coverBox.y), w: r4(coverBox.w), h: r4(coverBox.h) } : undefined,
      box: { x: r4(box.x), y: r4(box.y), w: r4(box.w), h: r4(box.h) },
      px,
      aspect: r4(px.w / px.h),
      palette: paletteOf(c),
      detail: { energy: r4(energy) },
      medium: raw.medium || (raster ? 'raster' : 'semantic'),
      clipped: clipped.length ? clipped : undefined,
      plate: raster ? (raw.plate || path.join(PLATES_DIR, `${raw.id}.png`)) : null,
      text: raw.text || null,
    });
  }
  const uncovered = uncoveredInkCells(comp, regions);
  if (uncovered.length > 3 && !regionsInput.allowUncovered) {
    throw new Error(`grid cells ${uncovered.join(', ')} carry ink no region names. Every element the comp shows must be in a region (text, control, chrome, or a plate) so its absence in the build can be measured; add regions for them, or set "allowUncovered": true in the regions file after confirming those cells are empty ground.`);
  }
  return {
    tool: 'comp-spec',
    version: 1,
    createdAt: new Date().toISOString(),
    comp: compPath,
    warnings,
    uncoveredInkCells: uncovered,
    compSize: { width: comp.width, height: comp.height },
    aspect: r4(comp.width / comp.height),
    orientation: comp.width >= comp.height ? 'landscape' : 'portrait',
    palette: paletteOf(comp),
    bands: horizontalBands(comp).filter((b) => b.strength > 0.2).map((b) => ({ y: r4(b.y), strength: r4(b.strength) })),
    regions,
  };
}

/** Propose regions from the comp's bands when no regions file exists yet. */
export function autoRegions(comp) {
  const bands = horizontalBands(comp).filter((b) => b.strength > 0.2);
  const cuts = [0, ...bands.map((b) => b.y), 1].filter((v, i, arr) => i === 0 || v - arr[i - 1] > 0.06);
  if (cuts[cuts.length - 1] !== 1) cuts.push(1);
  const regions = [];
  for (let i = 0; i + 1 < cuts.length; i++) regions.push({ id: `band-${i + 1}`, kind: 'band', box: { x: 0, y: cuts[i], w: 1, h: cuts[i + 1] - cuts[i] } });
  return { regions };
}

const r4 = (v) => Math.round(v * 10000) / 10000;

/**
 * The comp crop of a raster region, with every overlapping semantic region
 * (text, control, chrome) painted out in the crop's own ground color. The
 * plate prompt tells the generator to remove UI text and chrome, so a good
 * plate must be scored against a crop that has them removed too; otherwise
 * the plate loses structure points for obeying the spec.
 */
export function plateReference(comp, spec, region) {
  const c = crop(comp, region.px.x, region.px.y, region.px.w, region.px.h);
  const ground = (region.palette && region.palette[0] && hexToRgb(region.palette[0].hex)) || [255, 255, 255];
  for (const other of spec.regions || []) {
    if (other.id === region.id || RASTER_KINDS.has(other.kind) || other.kind === 'band') continue;
    const ox = Math.max(0, other.px.x - region.px.x), oy = Math.max(0, other.px.y - region.px.y);
    const ox2 = Math.min(region.px.w, other.px.x + other.px.w - region.px.x), oy2 = Math.min(region.px.h, other.px.y + other.px.h - region.px.y);
    if (ox2 <= ox || oy2 <= oy) continue;
    fillRect(c, ox, oy, ox2 - ox, oy2 - oy, [...ground, 255]);
  }
  return c;
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}

export function platePrompt(spec, region) {
  const world = spec.palette.slice(0, 3).map((c) => c.hex).join(', ');
  const kindLine = region.kind === 'texture'
    ? 'This is a seamless surface texture. Output a tileable texture plate with no objects, no text, no vignette.'
    : region.kind === 'image'
      ? 'This is a photographic or illustrated image region. Output the same subject, same framing, same lighting.'
      : 'This is a designed illustration plate. Output the same drawing, same style, same line weight and shading.';
  return [
    'Use the provided crop as the approved visual reference and recreate it as a clean production asset at the target aspect ratio.',
    kindLine,
    `Preserve silhouette, composition, perspective, palette (${world}), lighting, material, and texture exactly.`,
    'Remove every piece of UI text, label, caption, button, and interface chrome that is not part of the artwork itself.',
    'Remove letterboxing, borders, card corners, drop shadows, and any layout background that the page will draw in code.',
    'Do not add objects. Do not change the concept. Do not restyle. The artwork fills the whole frame edge to edge at the same scale as the reference; no margins, no border, no background band.',
    region.note ? `Region: ${region.note}.` : '',
  ].filter(Boolean).join(' ');
}

export function printSpec(spec) {
  const lines = [];
  lines.push(`SPEC comp ${spec.comp} ${spec.compSize.width}x${spec.compSize.height} ${spec.orientation}`);
  lines.push(`PALETTE ${spec.palette.map((c) => `${c.hex}(${Math.round(c.coverage * 100)}%)`).join(' ')}`);
  lines.push(`BANDS ${spec.bands.map((b) => `${Math.round(b.y * 100)}%`).join(' ') || 'none'}`);
  for (const r of spec.regions) {
    const b = r.box;
    lines.push(`REGION ${r.id.padEnd(18)} ${r.kind.padEnd(8)} ${r.medium.padEnd(8)} box x${Math.round(b.x * 100)}% y${Math.round(b.y * 100)}% w${Math.round(b.w * 100)}% h${Math.round(b.h * 100)}% (${r.px.w}x${r.px.h}px, ${r.aspect}:1) palette ${r.palette.slice(0, 3).map((c) => c.hex).join(' ')}${r.plate ? ` plate ${r.plate}` : ''}${r.note ? `  # ${r.note}` : ''}`);
  }
  const plates = spec.regions.filter((r) => r.medium === 'raster');
  lines.push(`PLATES ${plates.length} to produce: ${plates.map((r) => r.id).join(', ') || 'none'}`);
  for (const w of spec.warnings || []) lines.push(`WARN ${w}`);
  lines.push('RULE anything not in this list does not exist on the page: no borders, rules, chrome, or containers the comp does not show. Every raster region ships as its plate, never as CSS.');
  return lines.join('\n');
}

export function loadSpec(specPath = SPEC_PATH) {
  if (!fs.existsSync(specPath)) return null;
  return JSON.parse(fs.readFileSync(specPath, 'utf8'));
}

async function main() {
  const specPath = arg('spec', SPEC_PATH);
  if (flag('help') || process.argv.length <= 2) {
    console.log(`usage: comp-spec.mjs --comp <png> --grid            write .impeccable/build/comp-grid.png (10x10 labeled grid) + palette + bands
       comp-spec.mjs --comp <png> --regions <json>  measure regions -> .impeccable/build/spec.json
         regions json: { "regions": [ { "id": "art", "kind": "plate|image|texture|text|control|chrome", "grid": "E0:J4", "note": "..." } ] }
       comp-spec.mjs --comp <png> --auto            band regions when you have no regions file
       comp-spec.mjs --print                        the compact spec
       comp-spec.mjs --crop <id> [--out f] [--scale n]   reference crop of a region (never a shipping asset)
       comp-spec.mjs --plate-prompt <id>            the regeneration prompt for a raster region`);
    return;
  }
  if (flag('print')) {
    const spec = loadSpec(specPath);
    if (!spec) { console.error(`comp-spec: no spec at ${specPath}; run with --comp <png> --regions <json> first`); process.exit(1); }
    console.log(printSpec(spec));
    return;
  }
  if (arg('plate-prompt')) {
    const spec = loadSpec(specPath);
    if (!spec) { console.error(`comp-spec: no spec at ${specPath}`); process.exit(1); }
    const region = spec.regions.find((r) => r.id === arg('plate-prompt'));
    if (!region) { console.error(`comp-spec: no region ${arg('plate-prompt')}`); process.exit(1); }
    console.log(platePrompt(spec, region));
    return;
  }
  if (arg('crop')) {
    const spec = loadSpec(specPath);
    if (!spec) { console.error(`comp-spec: no spec at ${specPath}`); process.exit(1); }
    const region = spec.regions.find((r) => r.id === arg('crop'));
    if (!region) { console.error(`comp-spec: no region ${arg('crop')}; ids: ${spec.regions.map((r) => r.id).join(', ')}`); process.exit(1); }
    const comp = loadRaster(spec.comp).image;
    let c = region.medium === 'raster' && !flag('raw') ? plateReference(comp, spec, region) : crop(comp, region.px.x, region.px.y, region.px.w, region.px.h);
    const scale = parseFloat(arg('scale', '1'));
    if (scale > 1) c = resize(c, c.width * scale, c.height * scale);
    const out = arg('out', path.join(BUILD_DIR, 'crops', `${region.id}.png`));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, encodePng(c, { text: { 'impeccable:crop-of': `${spec.comp}#${region.id}` } }));
    console.log(`CROP ${out} (${c.width}x${c.height}) region ${region.id} of ${spec.comp}. Reference only: regenerate the plate from it, never ship it.`);
    return;
  }

  const compPath = arg('comp');
  if (!compPath) {
    console.error('usage: comp-spec.mjs --comp <png> (--grid | --regions <json> | --auto) [--spec out.json]\n       comp-spec.mjs --print | --crop <id> [--out file] [--scale n] | --plate-prompt <id>');
    process.exit(1);
  }
  let comp;
  try { comp = loadRaster(compPath).image; } catch (e) { console.error(`comp-spec: cannot read ${compPath}: ${e.message}`); process.exit(1); }

  if (flag('grid')) {
    fs.mkdirSync(path.dirname(GRID_PATH), { recursive: true });
    fs.writeFileSync(GRID_PATH, encodePng(renderGrid(comp)));
    console.log(`GRID ${GRID_PATH} (${comp.width}x${comp.height} comp; cells A0 top-left to J9 bottom-right)`);
    console.log(`PALETTE ${paletteOf(comp).map((c) => `${c.hex}(${Math.round(c.coverage * 100)}%)`).join(' ')}`);
    console.log(`BANDS ${horizontalBands(comp).filter((b) => b.strength > 0.2).map((b) => `${Math.round(b.y * 100)}%`).join(' ') || 'none'}`);
    console.log('NEXT open the grid image, then write regions.json in exactly this shape and run --regions regions.json:');
    console.log('  { "regions": [ { "id": "exploded-plate", "kind": "plate", "grid": "E0:H4", "note": "exploded carburetor drawing" }, { "id": "masthead", "kind": "chrome", "grid": "A0:J0", "note": "navy bar" } ] }');
    console.log('  kind: plate | image | texture (painted material: every illustration, photograph, figure, product object, texture; each ships as a raster plate) or text | control | chrome (code draws it). grid: <colrow>:<colrow>, A0 top-left to J9 bottom-right, inclusive.');
    console.log('  A texture region is a clean sample cell of the material (ground with no ink on it), not the whole band it covers; the page tiles it. Ink that sits on the material gets its own text/control region.');
    return;
  }

  let regionsInput;
  if (arg('regions')) {
    try { regionsInput = JSON.parse(fs.readFileSync(arg('regions'), 'utf8')); } catch (e) { console.error(`comp-spec: cannot read regions ${arg('regions')}: ${e.message}`); process.exit(1); }
  } else if (flag('auto')) {
    regionsInput = autoRegions(comp);
  } else {
    console.error('comp-spec: pass --grid to get the coordinate grid, then --regions <json> (or --auto for band regions)');
    process.exit(1);
  }
  let spec;
  try { spec = measureRegions(comp, regionsInput, compPath); } catch (e) { console.error(`comp-spec: ${e.message}`); process.exit(1); }
  fs.mkdirSync(path.dirname(specPath), { recursive: true });
  fs.writeFileSync(specPath, JSON.stringify(spec, null, 2));
  console.log(`WROTE ${specPath}`);
  console.log(printSpec(spec));
}

// realpath on both sides: a skill mounted through a symlink (Cursor, a
// worktree, an eval stage) must still run as a CLI.
const isMain = (() => {
  try { return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); }
  catch { return !!process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname); }
})();
if (isMain) main();
