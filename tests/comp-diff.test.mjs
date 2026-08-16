import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodePng, encodePng } from '../skill/scripts/lib/png.mjs';
import { createImage, fillRect, blit, crop, resize, drawText } from '../skill/scripts/lib/raster.mjs';
import { compare, verdictFor, alignBuild } from '../skill/scripts/comp-diff.mjs';
import { dominantColors, structureScore, detailScore } from '../skill/scripts/lib/image-metrics.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'skill', 'scripts', 'comp-diff.mjs');

// A synthetic "comp": bone ground, navy masthead, a red-gutter table, and a
// noisy "illustration" region on the right of the fold. Deterministic noise.
function lcg(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0xffffffff); }

function makeComp(w = 768, h = 512) {
  const img = createImage(w, h, [240, 237, 226, 255]);
  fillRect(img, 0, 0, w, 32, [19, 33, 48, 255]); // masthead
  drawText(img, 'CARBURETOR CLUB', 12, 8, [240, 237, 226, 255], 2);
  // headline block
  fillRect(img, 24, 70, 280, 22, [19, 33, 48, 255]);
  fillRect(img, 24, 100, 240, 22, [19, 33, 48, 255]);
  fillRect(img, 24, 136, 90, 4, [176, 40, 32, 255]);
  // illustration: high-frequency noise plate
  const rnd = lcg(7);
  for (let y = 48; y < 240; y++) for (let x = 340; x < 740; x++) {
    const v = 120 + Math.floor(rnd() * 120);
    const p = (y * w + x) * 4; img.data[p] = v; img.data[p + 1] = v; img.data[p + 2] = v + 10;
  }
  // table with red gutter
  fillRect(img, 0, 260, w, 2, [19, 33, 48, 255]);
  for (let i = 0; i < 3; i++) {
    const y = 270 + i * 60;
    fillRect(img, 0, y, 10, 50, i === 0 ? [176, 40, 32, 255] : [19, 33, 48, 255]);
    fillRect(img, 30, y + 10, 300, 14, [19, 33, 48, 255]);
    fillRect(img, 30, y + 30, 200, 8, [120, 120, 120, 255]);
    fillRect(img, 0, y + 56, w, 1, [19, 33, 48, 255]);
  }
  // CTA
  fillRect(img, 24, 460, 160, 36, [19, 33, 48, 255]);
  return img;
}

function flattenIllustration(comp) {
  const img = { ...comp, data: new Uint8Array(comp.data) };
  fillRect(img, 340, 48, 400, 192, [200, 200, 205, 255]); // a flat gray box where the plate was
  return img;
}

function recolor(comp) {
  const img = { ...comp, data: new Uint8Array(comp.data) };
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i] > 220 && img.data[i + 1] > 210) { img.data[i] = 20; img.data[i + 1] = 40; img.data[i + 2] = 60; }
  }
  return img;
}

function shifted(comp, dx, dy) {
  const img = createImage(comp.width, comp.height, [240, 237, 226, 255]);
  blit(img, comp, dx, dy);
  return img;
}

function tallPage(comp) {
  // a full-page screenshot: comp on top, then more page below
  const img = createImage(comp.width, comp.height * 3, [240, 237, 226, 255]);
  blit(img, comp, 0, 0);
  fillRect(img, 0, comp.height + 40, comp.width, 200, [19, 33, 48, 255]);
  return img;
}

const SPEC = {
  regions: [
    { id: 'masthead', kind: 'control', box: { x: 0, y: 0, w: 1, h: 32 / 512 } },
    { id: 'headline', kind: 'text', box: { x: 0.02, y: 60 / 512, w: 0.4, h: 100 / 512 } },
    { id: 'plate', kind: 'plate', box: { x: 340 / 768, y: 48 / 512, w: 400 / 768, h: 192 / 512 } },
    { id: 'table', kind: 'control', box: { x: 0, y: 260 / 512, w: 1, h: 190 / 512 } },
  ],
};

describe('png codec', () => {
  it('round-trips RGBA through encode/decode', () => {
    const img = createImage(20, 10, [10, 20, 30, 255]);
    img.data.set([200, 100, 50, 128], (2 * 20 + 2) * 4);
    const back = decodePng(encodePng(img, { text: { 'impeccable:prompt': 'hello' } }));
    assert.equal(back.width, 20); assert.equal(back.height, 10);
    assert.deepEqual([...back.data.subarray(0, 4)], [10, 20, 30, 255]);
    assert.deepEqual([...back.data.subarray((2 * 20 + 2) * 4, (2 * 20 + 2) * 4 + 4)], [200, 100, 50, 128]);
    assert.equal(back.text['impeccable:prompt'], 'hello');
  });

  it('decodes a real gpt-image / Playwright style PNG when one is on disk (skips otherwise)', () => {
    const sample = path.join(ROOT, 'tests', 'fixtures', 'comp-fidelity', 'sample.png');
    if (!fs.existsSync(sample)) return;
    const img = decodePng(fs.readFileSync(sample));
    assert.ok(img.width > 0 && img.height > 0);
  });
});

describe('image metrics', () => {
  const comp = makeComp();
  it('identity scores 1', () => {
    assert.ok(structureScore(comp, comp) > 0.999);
    assert.ok(detailScore(comp, comp).score > 0.999);
  });
  it('dominant colors find the ground and the ink', () => {
    const cols = dominantColors(comp).map((c) => c.hex);
    assert.ok(cols.some((h) => h.startsWith('#f') || h.startsWith('#e')), `ground missing in ${cols}`);
    assert.ok(cols.some((h) => h.startsWith('#1') || h.startsWith('#0') || h.startsWith('#2')), `ink missing in ${cols}`);
  });
  it('a flattened plate loses detail', () => {
    const d = detailScore(comp, flattenIllustration(comp));
    assert.ok(d.score < 0.85, `expected detail loss, got ${d.score}`);
  });
});

describe('comp-diff compare', () => {
  const comp = makeComp();

  it('scores the comp against itself as a match everywhere', () => {
    const r = compare({ comp, build: comp, spec: SPEC });
    assert.equal(r.whole.overall, 1);
    for (const region of r.regions) assert.equal(region.verdict, 'match', region.id);
  });

  it('forgives a small translation', () => {
    const r = compare({ comp, build: shifted(comp, 6, 4), spec: SPEC });
    assert.ok(r.whole.overall >= 0.8, `overall ${r.whole.overall}`);
    assert.equal(verdictFor(r.whole), 'match');
  });

  it('reads the top of a full-page screenshot as the first viewport', () => {
    const r = compare({ comp, build: tallPage(comp), spec: SPEC });
    assert.equal(r.aligned.height, comp.height);
    assert.ok(r.whole.overall > 0.95, `overall ${r.whole.overall}`);
  });

  it('flags a flattened plate region as missing while the rest matches', () => {
    const r = compare({ comp, build: flattenIllustration(comp), spec: SPEC });
    const plate = r.regions.find((x) => x.id === 'plate');
    assert.equal(plate.verdict, 'missing');
    assert.equal(r.regions.find((x) => x.id === 'table').verdict, 'match');
    assert.equal(r.regions.find((x) => x.id === 'masthead').verdict, 'match');
  });

  it('fails a recolored page on color and structure', () => {
    const r = compare({ comp, build: recolor(comp), spec: SPEC });
    assert.ok(r.whole.color < 0.7, `color ${r.whole.color}`);
    assert.ok(r.whole.overall < 0.6, `overall ${r.whole.overall}`);
    assert.notEqual(verdictFor(r.whole), 'match');
  });

  it('derives band regions when no spec is given', () => {
    const r = compare({ comp, build: comp });
    assert.ok(r.regions.length >= 2);
    assert.ok(r.regions.every((x) => x.kind === 'band'));
  });

  it('pads a shorter build with white so a truncated page reads as missing content', () => {
    const half = crop(comp, 0, 0, comp.width, comp.height / 2);
    const aligned = alignBuild(comp, half);
    assert.equal(aligned.height, comp.height);
    const r = compare({ comp, build: half, spec: SPEC });
    assert.notEqual(r.regions.find((x) => x.id === 'table').verdict, 'match');
  });

  it('scales a build captured at a different width onto the comp', () => {
    const wide = resize(comp, comp.width * 1.5, comp.height * 1.5);
    const r = compare({ comp, build: wide, spec: SPEC });
    assert.ok(r.whole.overall > 0.9, `overall ${r.whole.overall}`);
  });
});

describe('comp-diff CLI', () => {
  let dir;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comp-diff-'));
    const comp = makeComp();
    fs.writeFileSync(path.join(dir, 'comp.png'), encodePng(comp));
    fs.writeFileSync(path.join(dir, 'flat.png'), encodePng(flattenIllustration(comp)));
    fs.writeFileSync(path.join(dir, 'spec.json'), JSON.stringify(SPEC));
  });

  it('writes side-by-side, heatmap, region pairs, and report.json', () => {
    const out = path.join(dir, 'diff');
    const res = spawnSync(process.execPath, [SCRIPT, '--comp', path.join(dir, 'comp.png'), '--build', path.join(dir, 'flat.png'), '--spec', path.join(dir, 'spec.json'), '--out-dir', out], { encoding: 'utf8' });
    assert.equal(res.status, 0, res.stderr + res.stdout);
    assert.match(res.stdout, /^COMP-DIFF/m);
    assert.match(res.stdout, /REGION plate\s+missing/);
    for (const f of ['side-by-side.png', 'heatmap.png', 'report.json', path.join('regions', 'plate.png')]) {
      assert.ok(fs.existsSync(path.join(out, f)), `${f} missing`);
    }
    const report = JSON.parse(fs.readFileSync(path.join(out, 'report.json'), 'utf8'));
    assert.equal(report.tool, 'comp-diff');
    assert.equal(report.regions.length, 4);
    assert.ok(report.palette.comp.length > 0);
    // artifacts decode
    const side = decodePng(fs.readFileSync(path.join(out, 'side-by-side.png')));
    assert.ok(side.width > 768);
  });

  it('exits 3 below --threshold and prints the instruction', () => {
    const res = spawnSync(process.execPath, [SCRIPT, '--comp', path.join(dir, 'comp.png'), '--build', path.join(dir, 'flat.png'), '--no-files', '--threshold', '0.99'], { encoding: 'utf8' });
    assert.equal(res.status, 3);
    assert.match(res.stdout, /BELOW THRESHOLD/);
  });

  it('--json prints the report', () => {
    const res = spawnSync(process.execPath, [SCRIPT, '--comp', path.join(dir, 'comp.png'), '--build', path.join(dir, 'comp.png'), '--no-files', '--json'], { encoding: 'utf8' });
    assert.equal(res.status, 0);
    const report = JSON.parse(res.stdout);
    assert.equal(report.verdict, 'match');
  });

  it('exits 1 with usage on missing args', () => {
    const res = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /usage/);
  });
});
