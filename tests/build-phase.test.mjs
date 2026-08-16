import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { encodePng } from '../skill/scripts/lib/png.mjs';
import { createImage, fillRect, blit, resize } from '../skill/scripts/lib/raster.mjs';
import { gridToBox, measureRegions, platePrompt } from '../skill/scripts/comp-spec.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPEC_SCRIPT = path.join(ROOT, 'skill', 'scripts', 'comp-spec.mjs');
const PHASE_SCRIPT = path.join(ROOT, 'skill', 'scripts', 'build-phase.mjs');

function lcg(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0xffffffff); }

function makeComp(w = 640, h = 400) {
  const img = createImage(w, h, [240, 237, 226, 255]);
  fillRect(img, 0, 0, w, 40, [19, 33, 48, 255]);
  fillRect(img, 20, 60, 220, 20, [19, 33, 48, 255]);
  fillRect(img, 20, 90, 180, 20, [19, 33, 48, 255]);
  const rnd = lcg(3);
  for (let y = 40; y < 200; y++) for (let x = 320; x < 640; x++) {
    const v = 100 + Math.floor(rnd() * 140);
    const p = (y * w + x) * 4; img.data[p] = v; img.data[p + 1] = v; img.data[p + 2] = v;
  }
  for (let i = 0; i < 3; i++) { fillRect(img, 0, 220 + i * 50, w, 1, [19, 33, 48, 255]); fillRect(img, 20, 232 + i * 50, 300, 12, [19, 33, 48, 255]); }
  return img;
}

function run(script, args, cwd) {
  return spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });
}

describe('comp-spec', () => {
  it('parses grid spans into normalized boxes', () => {
    assert.deepEqual(gridToBox('A0:A0'), { x: 0, y: 0, w: 0.1, h: 0.1 });
    assert.deepEqual(gridToBox('E0:J4'), { x: 0.4, y: 0, w: 0.6, h: 0.5 });
    assert.deepEqual(gridToBox('j4:e0'), { x: 0.4, y: 0, w: 0.6, h: 0.5 });
    assert.throws(() => gridToBox('K0:A1'));
  });

  it('measures regions with palette, pixel box, medium, and plate path', () => {
    const comp = makeComp();
    const spec = measureRegions(comp, { regions: [
      { id: 'masthead', kind: 'chrome', grid: 'A0:J0' },
      { id: 'art', kind: 'plate', grid: 'F1:J4', note: 'noise plate' },
    ] }, 'comp.png');
    assert.equal(spec.regions.length, 2);
    const art = spec.regions.find((r) => r.id === 'art');
    assert.equal(art.medium, 'raster');
    assert.equal(art.plate, path.join('assets', 'plates', 'art.png'));
    assert.equal(art.px.x, 320);
    assert.ok(art.palette.length > 0);
    assert.equal(spec.regions[0].medium, 'semantic');
    assert.equal(spec.orientation, 'landscape');
    assert.match(platePrompt(spec, art), /noise plate/);
  });

  it('rejects duplicate ids and missing ids', () => {
    const comp = makeComp();
    assert.throws(() => measureRegions(comp, { regions: [{ id: 'a', grid: 'A0:A0' }, { id: 'a', grid: 'B0:B0' }] }, 'c.png'), /duplicate/);
    assert.throws(() => measureRegions(comp, { regions: [{ grid: 'A0:A0' }] }, 'c.png'), /id/);
  });
});

describe('build-phase state machine (CLI)', () => {
  let dir;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-phase-'));
    fs.writeFileSync(path.join(dir, 'comp.png'), encodePng(makeComp()));
    fs.writeFileSync(path.join(dir, 'regions.json'), JSON.stringify({ regions: [
      { id: 'masthead', kind: 'chrome', grid: 'A0:J0' },
      { id: 'headline', kind: 'text', grid: 'A1:D2' },
      { id: 'art', kind: 'plate', grid: 'F1:J4', note: 'noise plate' },
      { id: 'list', kind: 'control', grid: 'A5:J9' },
    ] }));
  });
  after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('start writes state at spec and prints NEXT', () => {
    const res = run(PHASE_SCRIPT, ['start', '--comp', 'comp.png'], dir);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /BUILD-PHASE SPEC/);
    assert.match(res.stdout, /NEXT Measure the comp/);
    assert.ok(fs.existsSync(path.join(dir, '.impeccable', 'build', 'state.json')));
  });

  it('spec gate fails without a spec, passes once comp-spec wrote one', () => {
    let res = run(PHASE_SCRIPT, ['advance'], dir);
    assert.equal(res.status, 2);
    assert.match(res.stdout, /GATE SPEC FAILED/);
    res = run(SPEC_SCRIPT, ['--comp', 'comp.png', '--grid'], dir);
    assert.equal(res.status, 0, res.stderr);
    assert.ok(fs.existsSync(path.join(dir, '.impeccable', 'build', 'comp-grid.png')));
    res = run(SPEC_SCRIPT, ['--comp', 'comp.png', '--regions', 'regions.json'], dir);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /PLATES 1 to produce: art/);
    res = run(PHASE_SCRIPT, ['advance'], dir);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /ADVANCED spec -> plates/);
  });

  it('plates gate names the missing plate, rejects a comp-size crop, accepts a 2x plate', () => {
    let res = run(PHASE_SCRIPT, ['advance'], dir);
    assert.equal(res.status, 2);
    assert.match(res.stdout, /plate missing for art/);
    // force without the user's words is refused; with them it is recorded
    res = run(PHASE_SCRIPT, ['advance', '--force', '--reason', 'single-file HTML delivery requires embedded CSS'], dir);
    assert.equal(res.status, 2);
    assert.match(res.stdout, /--force refused/);
    // comp-size crop: too small
    res = run(SPEC_SCRIPT, ['--crop', 'art', '--out', 'assets/plates/art.png'], dir);
    assert.equal(res.status, 0, res.stderr);
    res = run(PHASE_SCRIPT, ['advance'], dir);
    assert.equal(res.status, 2);
    assert.match(res.stdout, /needs at least 480px/);
    // 2x crop passes size and similarity
    res = run(SPEC_SCRIPT, ['--crop', 'art', '--scale', '2', '--out', 'assets/plates/art.png'], dir);
    assert.equal(res.status, 0, res.stderr);
    res = run(PHASE_SCRIPT, ['advance'], dir);
    assert.equal(res.status, 0, res.stdout);
    assert.match(res.stdout, /ADVANCED plates -> hero/);
  });

  it('hero gate fails on a flat build and passes on a faithful one, recording attempts', () => {
    const comp = makeComp();
    const flat = createImage(comp.width, comp.height, [240, 237, 226, 255]);
    fillRect(flat, 0, 0, comp.width, 40, [19, 33, 48, 255]);
    fs.mkdirSync(path.join(dir, '.impeccable', 'review'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.impeccable', 'review', 'hero-repro.png'), encodePng(flat));
    // no source references the plate yet: refused before any diff runs
    let res = run(PHASE_SCRIPT, ['advance'], dir);
    assert.equal(res.status, 2, res.stdout);
    assert.match(res.stdout, /not referenced by any source file/);
    fs.writeFileSync(path.join(dir, 'index.html'), '<img src="assets/plates/art.png" alt="">');
    res = run(PHASE_SCRIPT, ['advance'], dir);
    assert.equal(res.status, 2, res.stdout);
    assert.match(res.stdout, /GATE HERO FAILED/);
    assert.match(res.stdout, /region art is missing/);
    assert.ok(fs.existsSync(path.join(dir, '.impeccable', 'review', 'diff', 'hero', 'side-by-side.png')));
    // faithful: the comp shifted by a few px, captured at 1.5x width
    const shifted = createImage(comp.width, comp.height, [240, 237, 226, 255]);
    blit(shifted, comp, 3, 2);
    fs.writeFileSync(path.join(dir, '.impeccable', 'review', 'hero-repro.png'), encodePng(resize(shifted, comp.width * 1.5, comp.height * 1.5)));
    res = run(PHASE_SCRIPT, ['advance'], dir);
    assert.equal(res.status, 0, res.stdout);
    assert.match(res.stdout, /ADVANCED hero -> sections/);
    const state = JSON.parse(fs.readFileSync(path.join(dir, '.impeccable', 'build', 'state.json'), 'utf8'));
    assert.equal(state.phases.hero.attempts, 3);
    assert.ok(state.phases.hero.gate.score >= 0.72);
  });

  it('later phases advance without a gate; force is recorded; finish records the disposition', () => {
    for (const from of ['sections', 'motion']) {
      const res = run(PHASE_SCRIPT, ['advance'], dir);
      assert.equal(res.status, 0, res.stdout);
      assert.match(res.stdout, new RegExp(`ADVANCED ${from}`));
    }
    let res = run(PHASE_SCRIPT, ['advance', '--force', '--reason', 'single-file delivery needs CSS'], dir);
    assert.equal(res.status, 0, 'responsive has no gate, so force is moot');
    res = run(PHASE_SCRIPT, ['finish', '--disposition', 'fix'], dir);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /finish      fix/);
    res = run(PHASE_SCRIPT, ['status', '--json'], dir);
    const state = JSON.parse(res.stdout);
    assert.equal(state.phase, 'review');
    assert.equal(state.finish.disposition, 'fix');
  });

  it('refuses a bad disposition and an unknown command', () => {
    assert.equal(run(PHASE_SCRIPT, ['finish', '--disposition', 'great'], dir).status, 1);
    assert.equal(run(PHASE_SCRIPT, ['dance'], dir).status, 1);
  });
});
