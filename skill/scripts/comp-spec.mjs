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
 *   node comp-spec.mjs --crop exploded-plate --out tmp/plate-src.png [--scale 2]
 *     crops the region from the comp (reference for a plate regeneration; a
 *     crop is never a shipping asset, its resolution is comp grade)
 *   node comp-spec.mjs --plate-prompt exploded-plate  # the regeneration prompt for that region
 *
 * comp-diff.mjs reads the same spec (`--spec`) so its region rows and this
 * file's rows are the same rows.
 */
import fs from 'node:fs';
import path from 'node:path';
import { decodePng, encodePng } from './lib/png.mjs';
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

function energyOf(img) {
  const g = detailGrid(img, 4, 4, 256);
  let s = 0; for (const v of g.cells) s += v;
  return s / g.cells.length;
}


export function measureRegions(comp, regionsInput, compPath) {
  const regions = [];
  const seen = new Set();
  for (const raw of regionsInput.regions || []) {
    if (!raw.id) throw new Error('every region needs an id');
    if (seen.has(raw.id)) throw new Error(`duplicate region id ${raw.id}`);
    seen.add(raw.id);
    const kind = raw.kind && KINDS.has(raw.kind) ? raw.kind : 'band';
    const box = raw.box && typeof raw.box.x === 'number' ? raw.box : gridToBox(raw.grid);
    const px = { x: Math.round(box.x * comp.width), y: Math.round(box.y * comp.height), w: Math.round(box.w * comp.width), h: Math.round(box.h * comp.height) };
    const c = crop(comp, px.x, px.y, px.w, px.h);
    const energy = energyOf(c);
    const raster = RASTER_KINDS.has(kind);
    regions.push({
      id: raw.id,
      kind,
      note: raw.note || null,
      box: { x: r4(box.x), y: r4(box.y), w: r4(box.w), h: r4(box.h) },
      px,
      aspect: r4(px.w / px.h),
      palette: paletteOf(c),
      detail: { energy: r4(energy) },
      medium: raw.medium || (raster ? 'raster' : 'semantic'),
      plate: raster ? (raw.plate || path.join(PLATES_DIR, `${raw.id}.png`)) : null,
      text: raw.text || null,
    });
  }
  return {
    tool: 'comp-spec',
    version: 1,
    createdAt: new Date().toISOString(),
    comp: compPath,
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
    const comp = decodePng(fs.readFileSync(spec.comp));
    let c = crop(comp, region.px.x, region.px.y, region.px.w, region.px.h);
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
  try { comp = decodePng(fs.readFileSync(compPath)); } catch (e) { console.error(`comp-spec: cannot read ${compPath}: ${e.message}`); process.exit(1); }

  if (flag('grid')) {
    fs.mkdirSync(path.dirname(GRID_PATH), { recursive: true });
    fs.writeFileSync(GRID_PATH, encodePng(renderGrid(comp)));
    console.log(`GRID ${GRID_PATH} (${comp.width}x${comp.height} comp; cells A0 top-left to J9 bottom-right)`);
    console.log(`PALETTE ${paletteOf(comp).map((c) => `${c.hex}(${Math.round(c.coverage * 100)}%)`).join(' ')}`);
    console.log(`BANDS ${horizontalBands(comp).filter((b) => b.strength > 0.2).map((b) => `${Math.round(b.y * 100)}%`).join(' ') || 'none'}`);
    console.log('NEXT open the grid image, then write regions.json in exactly this shape and run --regions regions.json:');
    console.log('  { "regions": [ { "id": "exploded-plate", "kind": "plate", "grid": "E0:H4", "note": "exploded carburetor drawing" }, { "id": "masthead", "kind": "chrome", "grid": "A0:J0", "note": "navy bar" } ] }');
    console.log('  kind: plate | image | texture (painted material: every illustration, photograph, figure, product object, texture; each ships as a raster plate) or text | control | chrome (code draws it). grid: <colrow>:<colrow>, A0 top-left to J9 bottom-right, inclusive.');
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

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) main();
