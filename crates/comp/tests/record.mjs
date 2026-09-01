/**
 * Differential-parity recorder for the impeccable-comp Rust port.
 *
 * FROZEN. The JS libs it reads (`skill/scripts/lib/*.mjs`) were removed when
 * the runtime went node-free, so this cannot run again; it is kept as the
 * record of how `tests/golden/parity.json` was produced. Point
 * IMPECCABLE_PUBLIC_REPO at a checkout old enough to still have them.
 *
 * Runs the pure JS comp-fidelity libs over a set of representative inputs and
 * writes:
 *   - PNG fixtures (crates/comp/tests/fixtures/*.png)
 *   - golden JSON (crates/comp/tests/golden/parity.json)
 * The Rust integration test decodes the same PNGs, runs the port, and asserts
 * equality. Image-pixel parity is proven by CRC32 of the decoded RGBA buffers;
 * scores/fingerprints are compared value-for-value.
 *
 * Reads the repo read-only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUB =
  process.env.IMPECCABLE_PUBLIC_REPO ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const L = (p) => `${PUB}/skill/scripts/lib/${p}`;
const png = await import(L('png.mjs'));
const raster = await import(L('raster.mjs'));
const metrics = await import(L('image-metrics.mjs'));
const ff = await import(L('font-fingerprint.mjs'));
const fi = await import(L('font-index.mjs'));
const hero = await import(L('hero-checks.mjs'));

const HERE = path.dirname(new URL(import.meta.url).pathname);
const FIX = path.join(HERE, 'fixtures');
const GOLD = path.join(HERE, 'golden');
fs.mkdirSync(FIX, { recursive: true });
fs.mkdirSync(GOLD, { recursive: true });

// ---- crc32 (same polynomial as png.mjs) ----
const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(data) { let c = 0xffffffff; for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8); return ((c ^ 0xffffffff) >>> 0); }
const imgCrc = (im) => crc32(im.data);
const grayCrc = (g) => { const f = new Float32Array(g.data); return crc32(new Uint8Array(f.buffer, f.byteOffset, f.byteLength)); };
const round = (v, d = 6) => (v == null || !Number.isFinite(v) ? v : +v.toFixed(d));
const roundMap = (o, d = 6) => { const r = {}; for (const k of Object.keys(o)) r[k] = typeof o[k] === 'number' ? round(o[k], d) : o[k]; return r; };

function savePng(name, im) { fs.writeFileSync(path.join(FIX, name), png.encodePng(im)); return name; }

const G = {};

// ---- 1. sample.png decode parity ----
const sampleBuf = fs.readFileSync(path.join(PUB, 'tests/fixtures/comp-fidelity/sample.png'));
fs.writeFileSync(path.join(FIX, 'sample.png'), sampleBuf);
const sample = png.decodePng(sampleBuf);
G.sample = { width: sample.width, height: sample.height, crc: imgCrc(sample) };

// ---- 2. synthetic comp + build variants (mirrors comp-diff.test.mjs makeComp) ----
const { createImage, fillRect, drawText, resize, crop, blit, strokeRect, drawLabel, fit } = raster;
function lcg(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0xffffffff); }
function makeComp(w = 768, h = 512) {
  const img = createImage(w, h, [240, 237, 226, 255]);
  fillRect(img, 0, 0, w, 32, [19, 33, 48, 255]);
  drawText(img, 'CARBURETOR CLUB', 12, 8, [240, 237, 226, 255], 2);
  fillRect(img, 24, 70, 280, 22, [19, 33, 48, 255]);
  fillRect(img, 24, 100, 240, 22, [19, 33, 48, 255]);
  fillRect(img, 24, 136, 90, 4, [176, 40, 32, 255]);
  const rnd = lcg(7);
  for (let y = 48; y < 240; y++) for (let x = 340; x < 740; x++) { const v = 120 + Math.floor(rnd() * 120); const p = (y * w + x) * 4; img.data[p] = v; img.data[p + 1] = v; img.data[p + 2] = v + 10; }
  fillRect(img, 0, 260, w, 2, [19, 33, 48, 255]);
  for (let i = 0; i < 3; i++) { const y = 270 + i * 60; fillRect(img, 0, y, 10, 50, i === 0 ? [176, 40, 32, 255] : [19, 33, 48, 255]); fillRect(img, 30, y + 10, 300, 14, [19, 33, 48, 255]); fillRect(img, 30, y + 30, 200, 8, [120, 120, 120, 255]); fillRect(img, 0, y + 56, w, 1, [19, 33, 48, 255]); }
  fillRect(img, 24, 460, 160, 36, [19, 33, 48, 255]);
  return img;
}
const comp = makeComp();
// build A: flatten illustration
const flat = { ...comp, data: new Uint8Array(comp.data) };
fillRect(flat, 340, 48, 400, 192, [200, 200, 205, 255]);
// build B: recolor ground -> navy
const recolor = { ...comp, data: new Uint8Array(comp.data) };
for (let i = 0; i < recolor.data.length; i += 4) if (recolor.data[i] > 220 && recolor.data[i + 1] > 210) { recolor.data[i] = 20; recolor.data[i + 1] = 40; recolor.data[i + 2] = 60; }
// build C: 5px shift
const shift = createImage(comp.width, comp.height, [240, 237, 226, 255]);
blit(shift, comp, 5, 3);

savePng('comp.png', comp);
savePng('build_flat.png', flat);
savePng('build_recolor.png', recolor);
savePng('build_shift.png', shift);
G.images = {
  comp: imgCrc(comp), flat: imgCrc(flat), recolor: imgCrc(recolor), shift: imgCrc(shift),
};

// ---- 3. raster op parity (CRC of op outputs) ----
G.raster = {};
G.raster.resize_down = imgCrc(resize(comp, 256, 170));
G.raster.resize_up = imgCrc(resize(crop(comp, 24, 60, 300, 90), 600, 180));
G.raster.crop = imgCrc(crop(comp, 340, 48, 400, 192));
G.raster.fit = imgCrc(fit(comp, 300, 300));
{ const c = createImage(200, 60, [10, 10, 10, 255]); strokeRect(c, 10, 10, 180, 40, [255, 0, 0, 255], 3); drawLabel(c, 'HELLO 42%', 20, 20, { scale: 2 }); G.raster.label = imgCrc(c); }
{ const b = createImage(120, 80, [255, 255, 255, 255]); blit(b, crop(comp, 0, 0, 60, 40), 30, 20); G.raster.blit = imgCrc(b); }

// ---- 4. metrics parity ----
function scores(a, b) {
  return {
    structure: round(metrics.structureScore(a, b), 8),
    color: roundMap(metrics.colorScore(a, b), 8),
    detail: (() => { const d = metrics.detailScore(a, b); return { score: round(d.score, 8), rawScore: round(d.rawScore, 8), addedFraction: round(d.addedFraction, 8) }; })(),
    bands: round(metrics.bandScore(metrics.horizontalBands(a), metrics.horizontalBands(b)), 8),
    diffMapCrc: grayCrc(metrics.diffMap(a, b)),
  };
}
G.scores = {
  comp_flat: scores(comp, flat),
  comp_recolor: scores(comp, recolor),
  comp_shift: scores(comp, shift),
  comp_self: scores(comp, comp),
  sample_resized: scores(sample, resize(sample, 300, 200)),
};
G.gray = { comp_toGray: grayCrc(metrics.toGray(comp)), comp_blur: grayCrc(metrics.blurGray(metrics.toGray(comp), 2)) };
G.dominant = { comp: metrics.dominantColors(comp).map((c) => ({ hex: c.hex, coverage: c.coverage })), sample: metrics.dominantColors(sample).map((c) => ({ hex: c.hex, coverage: c.coverage })) };
G.bands = { comp: metrics.horizontalBands(comp).map((b) => ({ y: round(b.y, 8), strength: round(b.strength, 8) })) };
G.detailGrid = { comp: [...metrics.detailGrid(comp).cells].map((v) => round(v, 6)) };

// ---- 5. inkBox (pure, lives in comp-diff) ----
const cd = await import(`${PUB}/skill/scripts/comp-diff.mjs`);
G.inkBox = { comp: cd.inkBox(comp), sample: cd.inkBox(sample), flat: cd.inkBox(flat) };

// ---- 6. font fingerprint parity ----
function textSample(text, scale = 6, { x = 20, y = 20 } = {}) { const w = text.length * 6 * scale + 40, h = 7 * scale + 40; const img = createImage(w, h, [255, 255, 255, 255]); drawText(img, text, x, y, [0, 0, 0, 255], scale); return img; }
const s6 = textSample('HAMBURGEVONS THE QUICK BROWN FOX', 6);
const s4 = textSample('HAMBURGEVONS THE QUICK BROWN FOX', 4);
const heavy = textSample('HAMBURGEVONS THE QUICK BROWN FOX', 6); drawText(heavy, 'HAMBURGEVONS THE QUICK BROWN FOX', 24, 20, [0, 0, 0, 255], 6);
const multi = createImage(700, 200, [255, 255, 255, 255]); drawText(multi, 'HEADLINE ONE', 20, 20, [0, 0, 0, 255], 6); drawText(multi, 'SECOND LINE HERE', 20, 90, [0, 0, 0, 255], 4);
savePng('text_s6.png', s6); savePng('text_s4.png', s4); savePng('text_heavy.png', heavy); savePng('text_multi.png', multi);
const fpFull = (im) => { const f = ff.fingerprint(im); if (!f) return null; const o = {}; for (const k of Object.keys(f)) o[k] = f[k]; return o; };
G.fingerprint = { s6: fpFull(s6), s4: fpFull(s4), heavy: fpFull(heavy), multi: fpFull(multi), sample: fpFull(sample) };
const fS6 = ff.fingerprint(s6), fS4 = ff.fingerprint(s4), fHeavy = ff.fingerprint(heavy);
G.distance = {
  self: round(ff.distance(fS6, fS6), 10),
  s6_s4: round(ff.distance(fS6, fS4), 10),
  s6_heavy: round(ff.distance(fS6, fHeavy), 10),
  grossGap_s6_heavy: (() => { const g = ff.grossGap(fS6, fHeavy); return { width: round(g.width, 10), weight: round(g.weight, 10) }; })(),
  synthetic: round(ff.distance({ advX: 0.5, densTall: 0.5, contrast: 1 }, { advX: 0.5, densTall: 0.5, contrast: null }), 10),
};
G.features = ff.FEATURES;

// ---- 7. font-index parity ----
G.index = {};
G.index.features = fi.INDEX_FEATURES;
G.index.pack = fi.packVector(fS6);
G.index.unpack = roundMap(fi.unpackVector(fi.packVector(fS6)), 6);
G.index.route = { c8: fi.routeSize(8), c20: fi.routeSize(20), c30: fi.routeSize(30), c30caps: fi.routeSize(30, undefined, { allCaps: true }) };
G.index.nonText = ['Barcode 39', 'Redacted Script', 'Rubik Glitch', 'Noto Sans', 'Inter', 'Honk', 'Zen Dots'].map((f) => ({ f, hit: fi.NON_TEXT_FAMILY.test(f) }));
const index = fi.loadFontIndex();
if (index) {
  G.index.loaded = { schema: index.schema, sizes: index.sizes, entries: index.entries.length, features: index.features };
  const cand = fi.candidatesFromIndex(fS6, index, { n: 10 });
  G.index.candidates_s6 = cand.map((c) => ({ family: c.family, weight: c.weight, category: c.category, size: c.size, d: round(c.d, 8) }));
  const candSample = fpFull(sample) ? fi.candidatesFromIndex(ff.fingerprint(sample), index, { n: 5 }) : [];
  G.index.candidates_sample = candSample.map((c) => ({ family: c.family, weight: c.weight, d: round(c.d, 8) }));
}

// ---- 8. hero-checks parity ----
// text region: comp crop vs a "build" crop that is smaller cap + shifted
const compCrop = textSample('DISPLAY HEADLINE', 6, { x: 20, y: 20 });
const buildCrop = createImage(compCrop.width, compCrop.height, [255, 255, 255, 255]); drawText(buildCrop, 'DISPLAY HEADLINE', 20, 40, [40, 40, 40, 255], 4);
savePng('hero_comp_crop.png', compCrop); savePng('hero_build_crop.png', buildCrop);
const region = { id: 'hero', kind: 'text', type: { comp: null } };
const trc = hero.textRegionCheck(region, compCrop, buildCrop);
G.hero = { textRegion: { findings: trc.findings, metrics: trc.metrics } };
// inventedInk: build adds a noisy strip where comp is calm
const heroComp = createImage(512, 400, [245, 245, 240, 255]);
const heroBuild = { ...heroComp, data: new Uint8Array(heroComp.data) };
const rnd2 = lcg(11); for (let y = 20; y < 60; y++) for (let x = 20; x < 480; x++) { const v = Math.floor(rnd2() * 255); const p = (y * 512 + x) * 4; heroBuild.data[p] = v; heroBuild.data[p + 1] = v; heroBuild.data[p + 2] = v; }
const inv = hero.inventedInk(heroComp, heroBuild);
G.hero.invented = { cells: inv.cells, fraction: round(inv.fraction, 8) };
// plateClip: comp has margin, build flush
const plateComp = createImage(300, 200, [255, 255, 255, 255]); fillRect(plateComp, 40, 30, 200, 140, [10, 20, 40, 255]);
const plateBuild = createImage(300, 200, [255, 255, 255, 255]); fillRect(plateBuild, 0, 0, 260, 180, [10, 20, 40, 255]);
G.hero.plateClip = hero.plateClipCheck({ id: 'plate' }, plateComp, plateBuild);
// chromeStrip: a masthead strip with a rule
const stripComp = createImage(600, 120, [255, 255, 255, 255]); fillRect(stripComp, 0, 0, 600, 40, [20, 30, 50, 255]); fillRect(stripComp, 0, 58, 600, 2, [0, 0, 0, 255]);
const stripBuild = createImage(600, 120, [255, 255, 255, 255]); fillRect(stripBuild, 0, 0, 600, 40, [20, 30, 50, 255]); fillRect(stripBuild, 0, 88, 600, 2, [0, 0, 0, 255]);
const cs = hero.chromeStripCheck({ id: 'nav', kind: 'band' }, stripComp, stripBuild);
G.hero.chromeStrip = { findings: cs.findings, comp: cs.comp, build: cs.build };
G.hero.ruleRows = { strip: hero.ruleRows(stripComp) };
G.hero.inkColor = (() => { const c = hero.inkColor(compCrop); return c && c.ink ? { hex: c.ink.hex } : null; })();
// svgIllustrations: pure over HTML string
const html = `
<svg width="24" height="24"><path d="M1 1 L2 2"/></svg>
<svg viewBox="0 0 800 600"><path d="${'M0 0 '.repeat(200)}"/><path d="${'L1 1 '.repeat(100)}"/><polyline points="${'1,2 '.repeat(50)}"/></svg>
<svg width="48" height="48"><use href="#icon"/></svg>
`;
G.hero.svg = hero.svgIllustrations(html).map((s) => ({ paths: s.paths, budget: s.budget, long: s.long, label: s.label }));

fs.writeFileSync(path.join(GOLD, 'parity.json'), JSON.stringify(G, null, 1));
console.log('wrote', path.join(GOLD, 'parity.json'));
console.log('fixtures:', fs.readdirSync(FIX).join(', '));
