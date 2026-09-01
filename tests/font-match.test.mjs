import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { createImage, drawText } from '../skill/scripts/lib/raster.mjs';
import { fingerprint, distance, FEATURES, STATS } from '../skill/scripts/lib/font-fingerprint.mjs';
import { loadFontIndex, candidatesFromIndex, routeSize, packVector, unpackVector, INDEX_PATH, INDEX_FEATURES, ROUTE_CAP_PX, GROSS_FEATURES, NON_TEXT_FAMILY } from '../skill/scripts/lib/font-index.mjs';
import { widthClass, weightClass, selectCandidates, SHORTLIST, renderCandidates } from '../skill/scripts/font-match.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hasPlaywright = (() => { try { return !!require('playwright').chromium; } catch { return false; } })();

/** A white raster with a line of the bitmap font drawn on it, cap height 7 * scale px. */
function textSample(text, scale = 6, { x = 20, y = 20 } = {}) {
  const w = text.length * 6 * scale + 40, h = 7 * scale + 40;
  const img = createImage(w, h, [255, 255, 255, 255]);
  drawText(img, text, x, y, [0, 0, 0, 255], scale);
  return img;
}

describe('font-fingerprint', () => {
  it('fingerprints a synthetic rendered-text PNG with the expected fields', () => {
    const fp = fingerprint(textSample('HAMBURGEVONS THE QUICK BROWN FOX', 6));
    assert.ok(fp, 'fingerprint returned null');
    for (const k of ['lines', 'glyphs', 'capHeightPx', 'inkIsDark', 'allCaps', 'weight', ...FEATURES]) assert.ok(k in fp, `missing ${k}`);
    assert.equal(fp.lines, 1);
    assert.ok(fp.glyphs >= 20, `glyphs ${fp.glyphs}`);
    assert.ok(Math.abs(fp.capHeightPx - 42) <= 2, `capHeightPx ${fp.capHeightPx}`);
    assert.equal(fp.inkIsDark, true);
    assert.equal(typeof fp.allCaps, 'boolean');
    assert.ok(fp.advTall > 0.5 && fp.advTall < 0.9, `advTall ${fp.advTall}`);
    assert.ok(fp.densTall > 0.2 && fp.densTall < 0.9, `densTall ${fp.densTall}`);
    assert.ok(fp.stemW > 0, `stemW ${fp.stemW}`);
  });

  it('is size-stable: the same text at 4x and 6x scale lands close, and a bolder sample farther', () => {
    const a = fingerprint(textSample('HAMBURGEVONS THE QUICK BROWN FOX', 6));
    const b = fingerprint(textSample('HAMBURGEVONS THE QUICK BROWN FOX', 4));
    assert.equal(distance(a, a), 0);
    const dSame = distance(a, b);
    assert.ok(dSame > 0 && Number.isFinite(dSame), `dSame ${dSame}`);
    // a different sample: same glyph set but drawn twice offset by one scale step, so every stem doubles (a heavier face)
    const heavy = textSample('HAMBURGEVONS THE QUICK BROWN FOX', 6);
    drawText(heavy, 'HAMBURGEVONS THE QUICK BROWN FOX', 20 + 4, 20, [0, 0, 0, 255], 6);
    const c = fingerprint(heavy);
    const dOther = distance(a, c);
    assert.ok(dOther > dSame, `heavier sample (${dOther}) should be farther than a rescale (${dSame})`);
  });

  it('every weighted feature has a positive std, and distance skips features missing on either side', () => {
    for (const k of FEATURES) { assert.ok(STATS[k], `no STATS for ${k}`); assert.ok(STATS[k].std > 0); }
    const a = { advX: 0.5, densTall: 0.5, contrast: 1 }, b = { advX: 0.5, densTall: 0.5, contrast: null };
    assert.equal(distance(a, b), 0);
    assert.equal(distance({}, {}), Infinity);
  });
});

describe('font-index', () => {
  it('packs and unpacks a vector to three decimals, nulls preserved', () => {
    const fp = { advX: 0.3649, densTall: 0.6719, contrast: null, serif: 12.3456 };
    const back = unpackVector(packVector(fp));
    assert.equal(back.advX, 0.365);
    assert.equal(back.densTall, 0.672);
    assert.equal(back.contrast, null);
    assert.equal(back.serif, 12.346);
    assert.equal(back.gap, null, 'absent feature reads as null');
  });

  it('stores the features the fitted distance weights plus the gross width and weight readings', () => {
    assert.ok(INDEX_FEATURES.length >= 30);
    for (const k of INDEX_FEATURES) assert.ok(STATS[k].w > 0 || GROSS_FEATURES.includes(k), `${k} is indexed without weight or gross role`);
    for (const k of FEATURES) if (STATS[k].w === 0 && !GROSS_FEATURES.includes(k)) assert.ok(!INDEX_FEATURES.includes(k), `${k} has zero weight and should not be indexed`);
    for (const k of GROSS_FEATURES) assert.ok(INDEX_FEATURES.includes(k), `${k} is a gross reading and must be indexed`);
  });

  it('ships a three-render catalog index under 1.5 MB with > 2500 entries and the expected keys', () => {
    assert.ok(fs.existsSync(INDEX_PATH), `missing ${INDEX_PATH}`);
    assert.ok(fs.statSync(INDEX_PATH).size < 1.5 * 1024 * 1024, 'index over 1.5 MB');
    const index = loadFontIndex();
    assert.ok(index.entries.length > 2500, `entries ${index.entries.length}`);
    assert.deepEqual([...index.sizes].map(String).sort(), ['14', '48', '48c']);
    assert.deepEqual(index.features, INDEX_FEATURES);
    for (const e of index.entries.slice(0, 50)) {
      for (const k of ['family', 'weight', 'category', 'variable', 'fp']) assert.ok(k in e, `entry missing ${k}`);
      assert.ok(['sans', 'serif', 'display', 'handwriting', 'mono'].includes(e.category), e.category);
      assert.ok(e.fp[48], 'no 48px vector');
      for (const k of INDEX_FEATURES) assert.ok(k in e.fp[48]);
    }
    const lg = index.entries.find((e) => e.family === 'League Gothic');
    assert.ok(lg && lg.fp[48] && lg.fp[14] && lg.fp['48c'], 'League Gothic at all three renders');
    assert.ok(lg.fp['48c'].advTall != null && lg.fp['48c'].densTall != null, 'gross readings stored on the caps render');
    assert.ok(lg.fp[48].advX < 0.45, `League Gothic reads condensed: advX ${lg.fp[48].advX}`);
    const with14 = index.entries.filter((e) => e.fp[14]).length;
    assert.ok(with14 > 2500, `14px vectors ${with14}`);
  });

  it('routes candidate selection by cap height and returns 25 entries', () => {
    const index = loadFontIndex();
    const lg = index.entries.find((e) => e.family === 'League Gothic');
    assert.equal(routeSize(72), 48);
    assert.equal(routeSize(ROUTE_CAP_PX - 1), 14);
    assert.equal(routeSize(72, index.sizes, { allCaps: true }), '48c', 'caps crops route to the caps render');
    assert.equal(routeSize(ROUTE_CAP_PX - 1, index.sizes, { allCaps: true }), 14, 'small caps crops still route to the small size');
    assert.equal(routeSize(72, [48, 14], { allCaps: true }), 48, 'a schema-1 index without 48c falls back');
    // barcode / effect faces never come back as candidates
    const capsFp = { ...lg.fp['48c'], capHeightPx: 72, allCaps: true };
    const caps = candidatesFromIndex(capsFp, index, { n: 25 });
    assert.equal(caps[0].family, 'League Gothic');
    assert.equal(caps[0].size, '48c');
    assert.ok(caps.every((c) => !NON_TEXT_FAMILY.test(c.family)));
    assert.ok(NON_TEXT_FAMILY.test('Libre Barcode 128 Text') && NON_TEXT_FAMILY.test('Redacted') && !NON_TEXT_FAMILY.test('Rubik') && !NON_TEXT_FAMILY.test('Bungee'));
    const big = candidatesFromIndex({ ...lg.fp[48], capHeightPx: 72 }, index, { n: 25 });
    assert.equal(big.length, 25);
    assert.equal(big[0].family, 'League Gothic');
    assert.equal(big[0].size, 48);
    const small = candidatesFromIndex({ ...lg.fp[14], capHeightPx: 14 }, index, { n: 25 });
    assert.equal(small.length, 25);
    assert.equal(small[0].family, 'League Gothic');
    assert.equal(small[0].size, 14);
    for (const c of big) for (const k of ['family', 'weight', 'category', 'variable', 'd', 'size']) assert.ok(k in c);
    const sans = candidatesFromIndex({ ...lg.fp[48], capHeightPx: 72 }, index, { n: 10, category: 'serif' });
    assert.equal(sans.length, 10);
    assert.ok(sans.every((c) => c.category === 'serif'));
  });
});

describe('font-match', () => {
  it('reads width and weight classes off the v2 features with catalog-anchored thresholds', () => {
    const index = loadFontIndex();
    const at = (family, weight) => index.entries.find((e) => e.family === family && e.weight === weight).fp[48];
    assert.equal(widthClass(at('League Gothic', 400)), 'compressed');
    assert.equal(widthClass(at('Oswald', 700)), 'condensed');
    assert.equal(widthClass(at('Inter', 400)), 'normal');
    assert.equal(widthClass(at('Archivo Black', 400)), 'wide');
    assert.equal(weightClass(at('Lato', 300)), 'light');
    assert.equal(weightClass(at('Inter', 400)), 'regular');
    assert.equal(weightClass(at('Roboto', 700)), 'bold');
    assert.equal(weightClass(at('Anton', 400)), 'black');
    // all-caps crop: falls through to advTall
    assert.equal(widthClass({ advX: null, advTall: 0.48 }), 'condensed');
    assert.equal(weightClass({ densTall: null, densX: null, stemW: 0.09 }), 'light');
  });

  it('selects candidates from the index, keeps the caller names first, and uses the shortlist only without an index', () => {
    const index = loadFontIndex();
    const lg = { ...index.entries.find((e) => e.family === 'League Gothic').fp[48], capHeightPx: 72 };
    const own = [{ family: 'Bebas Neue', weight: 400 }];
    const r = selectCandidates(lg, { own, index, n: 25 });
    assert.equal(r.source, 'index');
    assert.equal(r.candidates[0].family, 'Bebas Neue');
    assert.equal(r.catalog.length, 25);
    assert.ok(r.candidates.length >= 25 && r.candidates.length <= 26);
    assert.ok(!r.candidates.some((c) => SHORTLIST.wide.includes(`${c.family}:${c.weight}`)), 'shortlist must not leak in when the index is present');
    const noIdx = selectCandidates(lg, { own, index: null });
    assert.equal(noIdx.source, 'shortlist');
    assert.ok(noIdx.candidates.some((c) => c.family === 'Six Caps'), 'compressed shortlist used');
  });

  it('renders and ranks candidates against a League Gothic sample (browser)', { skip: !hasPlaywright && 'playwright not resolvable' }, async () => {
    const results = await renderCandidates([{ family: 'League Gothic', weight: 400 }, { family: 'Inter', weight: 400 }], 'The manuals stop.', 48);
    if (!results) return; // module resolves but no browser binary (CI): the catalog fallback owns it
    const ok = results.filter((r) => r.loaded && r.fp);
    if (ok.length < 2) return; // offline: Google Fonts unreachable
    const index = loadFontIndex();
    const lg = index.entries.find((e) => e.family === 'League Gothic').fp[48];
    const inter = index.entries.find((e) => e.family === 'Inter' && e.weight === 400).fp[48];
    const rLg = ok.find((r) => r.family === 'League Gothic'), rIn = ok.find((r) => r.family === 'Inter');
    assert.ok(distance(rLg.fp, lg) < distance(rLg.fp, inter), 'rendered League Gothic is nearer its own index entry');
    assert.ok(distance(rIn.fp, inter) < distance(rIn.fp, lg), 'rendered Inter is nearer its own index entry');
  });
});

describe('font-fingerprint on mixed crops', () => {
  it('measures the body copy, not the drawing beside it or the headline clipped above it', () => {
    // 460x300 crop: one clipped headline line at the top (cap ~34), five lines
    // of body copy (cap ~10), and a dense drawing (a noise block) at the bottom
    const img = createImage(460, 300, [235, 232, 220, 255]);
    drawText(img, 'THE MANIFOLDS', 4, 2, [20, 20, 20, 255], 5);
    for (let i = 0; i < 5; i++) drawText(img, 'fresh cables slides return cleanly and the', 4, 60 + i * 24, [20, 20, 20, 255], 2);
    let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0xffffffff);
    for (let y = 190; y < 300; y++) for (let x = 0; x < 300; x++) { const v = 40 + Math.floor(rnd() * 180); const p = (y * 460 + x) * 4; img.data[p] = v; img.data[p + 1] = v; img.data[p + 2] = v; }
    const fp = fingerprint(img);
    assert.ok(fp, 'lettering found');
    assert.ok(fp.capHeightPx >= 8 && fp.capHeightPx <= 14, `body cap measured, got ${fp.capHeightPx}`);
    assert.ok(fp.lines >= 4, `body lines, got ${fp.lines}`);
    assert.ok(fp.isolatedFrom >= 1, 'the headline line was set aside');
  });
});
