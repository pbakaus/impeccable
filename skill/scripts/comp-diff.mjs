#!/usr/bin/env node
/**
 * comp-diff: measure a build screenshot against its approved comp and produce
 * the evidence a reviewer (human or model) needs to judge fidelity without
 * trusting anyone's memory of the image.
 *
 *   node comp-diff.mjs --comp .impeccable/mocks/approved.png --build .impeccable/review/hero-repro.png
 *   node comp-diff.mjs --comp comp.png --build desktop.png --spec .impeccable/build/spec.json --out-dir .impeccable/review/diff
 *   node comp-diff.mjs ... --json            # machine-readable report on stdout
 *   node comp-diff.mjs ... --threshold 0.75  # exit 3 when the overall score is below
 *
 * Inputs: two PNGs. The build capture may be taller than the comp (a full-page
 * screenshot); it is scaled to the comp's width and the top comp-height rows
 * are compared, because the comp is the first viewport. `--align stretch`
 * squashes the whole build onto the comp instead, for a comp that covers a
 * whole page.
 *
 * Outputs (in --out-dir, default .impeccable/review/diff):
 *   side-by-side.png   comp | build, same size, labeled, with the score
 *   heatmap.png        build with the difference painted over it (red = wrong)
 *   regions/<id>.png   paired crops per region at legible scale, scored
 *   report.json        every number below, plus per-region rows
 *
 * Scores (0..1): structure (blurred SSIM: is the composition the same?),
 * color (histogram + dominant palette: is it the same palette at the same
 * coverage?), detail (high-frequency energy ratio: did the material survive,
 * or did an illustration become a gradient?), bands (do the horizontal
 * sections line up?). `overall` weights them 0.35 / 0.25 / 0.25 / 0.15.
 *
 * Regions come from --spec (comp-spec.mjs output: normalized boxes) or, with
 * none, from the comp's own horizontal bands, so the per-region crops exist
 * either way. Every region row carries the same four scores plus `verdict`:
 * match (>= 0.8), drift (>= 0.6), missing (detail ratio < 0.35 with structure
 * < 0.6), or contradicted (everything else). The words are the finish
 * reviewer's fidelity vocabulary on purpose.
 *
 * Exit codes: 0 measured (and above threshold when one is given), 1 usage or
 * unreadable input, 3 below threshold.
 */
import fs from 'node:fs';
import path from 'node:path';
import { decodePng, encodePng } from './lib/png.mjs';
import { crop, resize, fit, blit, createImage, fillRect, strokeRect, drawLabel } from './lib/raster.mjs';
import { structureScore, colorScore, detailScore, diffMap, horizontalBands, bandScore, dominantColors } from './lib/image-metrics.mjs';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

export function readPng(file) {
  return decodePng(fs.readFileSync(file));
}

/**
 * Scale the build to the comp's width; take the top comp-height rows
 * (align=top), squash the whole build onto the comp (align=stretch), or scale
 * to cover and center-crop (align=cover, the way `object-fit: cover` will show
 * a plate whose aspect differs from its region).
 */
export function alignBuild(comp, build, align = 'top') {
  if (align === 'stretch') return resize(build, comp.width, comp.height);
  if (align === 'cover') {
    const s = Math.max(comp.width / build.width, comp.height / build.height);
    const scaled = resize(build, build.width * s, build.height * s);
    return crop(scaled, (scaled.width - comp.width) / 2, (scaled.height - comp.height) / 2, comp.width, comp.height);
  }
  const scaled = build.width === comp.width ? build : resize(build, comp.width, Math.round((build.height / build.width) * comp.width));
  if (scaled.height === comp.height) return scaled;
  if (scaled.height > comp.height) return crop(scaled, 0, 0, comp.width, comp.height);
  // shorter than the comp: pad with white so a short page reads as missing content, not as a resize
  const out = createImage(comp.width, comp.height, [255, 255, 255, 255]);
  blit(out, scaled, 0, 0);
  return out;
}

/** Weights per region kind: what a region is made of decides what losing it looks like. */
const WEIGHTS = {
  default: { structure: 0.35, color: 0.25, detail: 0.25, bands: 0.15 },
  plate: { structure: 0.25, color: 0.2, detail: 0.5, bands: 0.05 },
  image: { structure: 0.25, color: 0.2, detail: 0.5, bands: 0.05 },
  texture: { structure: 0.15, color: 0.35, detail: 0.5, bands: 0 },
  text: { structure: 0.5, color: 0.25, detail: 0.15, bands: 0.1 },
  control: { structure: 0.45, color: 0.35, detail: 0.2, bands: 0 },
};

export function scorePair(a, b, kind = null) {
  const structure = structureScore(a, b);
  const color = colorScore(a, b);
  const detail = detailScore(a, b);
  const bandsA = horizontalBands(a), bandsB = horizontalBands(b);
  const bands = bandScore(bandsA, bandsB);
  const w = WEIGHTS[kind] || WEIGHTS.default;
  const overall = w.structure * structure + w.color * color.score + w.detail * detail.score + w.bands * bands;
  return {
    overall: r4(overall),
    structure: r4(structure),
    color: r4(color.score),
    colorIntersection: r4(color.intersection),
    paletteMatch: r4(color.paletteMatch),
    detail: r4(detail.score),
    detailAdded: r4(detail.addedFraction),
    bands: r4(bands),
    _detail: detail,
    _bands: { comp: bandsA, build: bandsB },
  };
}

export function verdictFor(s, kind = null) {
  const painted = kind === 'plate' || kind === 'image' || kind === 'texture';
  if (painted && s.detail < 0.5) return 'missing';
  if (s.detail < 0.35 && s.structure < 0.6) return 'missing';
  if (s.overall >= 0.8) return 'match';
  if (s.overall >= 0.6) return 'drift';
  return 'contradicted';
}

const r4 = (v) => Math.round(v * 10000) / 10000;

/** Regions from a spec (normalized boxes) or derived from the comp's bands. */
export function resolveRegions(comp, spec) {
  const regions = [];
  if (spec && Array.isArray(spec.regions) && spec.regions.length) {
    for (const r of spec.regions) {
      const box = r.box || r;
      if ([box.x, box.y, box.w, box.h].some((v) => typeof v !== 'number')) continue;
      regions.push({ id: r.id || `region-${regions.length + 1}`, x: box.x, y: box.y, w: box.w, h: box.h, kind: r.kind || null });
    }
    if (regions.length) return regions;
  }
  const bands = horizontalBands(comp).filter((b) => b.strength > 0.2);
  const cuts = [0, ...bands.map((b) => b.y), 1].filter((v, i, arr) => i === 0 || v - arr[i - 1] > 0.06);
  if (cuts[cuts.length - 1] !== 1) cuts.push(1);
  for (let i = 0; i + 1 < cuts.length; i++) {
    regions.push({ id: `band-${i + 1}`, x: 0, y: cuts[i], w: 1, h: cuts[i + 1] - cuts[i], kind: 'band' });
  }
  if (regions.length < 2) {
    return [
      { id: 'top', x: 0, y: 0, w: 1, h: 0.5, kind: 'band' },
      { id: 'bottom', x: 0, y: 0.5, w: 1, h: 0.5, kind: 'band' },
    ];
  }
  return regions;
}

/** Crop a normalized region; regions thinner than 48px in either axis are grown to that so tiny strips do not swing on subpixel noise. */
function regionCrop(img, r) {
  const minPx = 48;
  let x = r.x * img.width, y = r.y * img.height, w = r.w * img.width, h = r.h * img.height;
  if (h < minPx) { y -= (minPx - h) / 2; h = minPx; }
  if (w < minPx) { x -= (minPx - w) / 2; w = minPx; }
  return crop(img, x, y, w, h);
}

const HEAT_LABEL = { match: [40, 160, 80, 255], drift: [220, 160, 30, 255], missing: [200, 40, 40, 255], contradicted: [200, 40, 40, 255] };

export function renderSideBySide(comp, build, label, score) {
  const gap = 24, pad = 48;
  const targetW = Math.min(comp.width, 1400);
  const a = fit(comp, targetW, 100000), b = resize(build, a.width, a.height);
  const out = createImage(a.width * 2 + gap + pad * 2, a.height + pad * 2 + 24, [24, 24, 28, 255]);
  blit(out, a, pad, pad + 24);
  blit(out, b, pad + a.width + gap, pad + 24);
  drawLabel(out, 'COMP', pad, pad - 4, { scale: 2 });
  drawLabel(out, `BUILD ${label ? label.toUpperCase() : ''}`.trim(), pad + a.width + gap, pad - 4, { scale: 2 });
  const s = `OVERALL ${(score.overall * 100).toFixed(0)}%  STRUCT ${(score.structure * 100).toFixed(0)}%  COLOR ${(score.color * 100).toFixed(0)}%  DETAIL ${(score.detail * 100).toFixed(0)}%  BANDS ${(score.bands * 100).toFixed(0)}%`;
  drawLabel(out, s, pad, out.height - pad + 8, { scale: 2, bg: HEAT_LABEL[verdictFor(score)] });
  return out;
}

export function renderHeatmap(comp, build) {
  const map = diffMap(comp, build);
  const base = resize(build, map.width, map.height);
  const out = { width: base.width, height: base.height, data: new Uint8Array(base.data) };
  for (let i = 0, p = 0; i < map.data.length; i++, p += 4) {
    const d = map.data[i];
    if (d < 0.12) { // dim what matches so wrong stands out
      out.data[p] = out.data[p] * 0.55 + 255 * 0.45 * 0.2; out.data[p + 1] = out.data[p + 1] * 0.55; out.data[p + 2] = out.data[p + 2] * 0.55; continue;
    }
    const a = Math.min(1, (d - 0.12) / 0.5);
    out.data[p] = out.data[p] * (1 - a) + 235 * a; out.data[p + 1] = out.data[p + 1] * (1 - a) + 40 * a; out.data[p + 2] = out.data[p + 2] * (1 - a) + 40 * a;
  }
  const scaled = resize(out, comp.width, comp.height);
  drawLabel(scaled, 'DIFF: RED = DIFFERS FROM COMP', 12, 12, { scale: 2 });
  return scaled;
}

export function renderRegionPair(compCrop, buildCrop, id, score) {
  const gap = 16, pad = 12;
  const maxW = 700;
  const a = fit(compCrop, maxW, 700, true), b = resize(buildCrop, a.width, a.height);
  const out = createImage(a.width * 2 + gap + pad * 2, a.height + pad * 2 + 30, [24, 24, 28, 255]);
  blit(out, a, pad, pad + 30);
  blit(out, b, pad + a.width + gap, pad + 30);
  const v = verdictFor(score);
  drawLabel(out, `${id.toUpperCase()}  COMP`, pad, pad, { scale: 2 });
  drawLabel(out, `BUILD  ${v.toUpperCase()} ${(score.overall * 100).toFixed(0)}%`, pad + a.width + gap, pad, { scale: 2, bg: HEAT_LABEL[v] });
  return out;
}

export function compare({ comp, build, spec = null, align = 'top', label = '', kind = null }) {
  const aligned = alignBuild(comp, build, align);
  const whole = scorePair(comp, aligned, kind);
  const regions = resolveRegions(comp, spec).map((r) => {
    const a = regionCrop(comp, r), b = regionCrop(aligned, r);
    const s = scorePair(a, b, r.kind);
    return { ...r, score: strip(s), verdict: verdictFor(s, r.kind), _a: a, _b: b };
  });
  const compPalette = dominantColors(comp), buildPalette = dominantColors(aligned);
  return { label, align, whole: strip(whole), regions, aligned, compPalette, buildPalette, _whole: whole };
}

function strip(s) {
  const { _detail, _bands, ...rest } = s;
  return rest;
}

export function writeArtifacts(result, comp, outDir) {
  fs.mkdirSync(path.join(outDir, 'regions'), { recursive: true });
  const side = renderSideBySide(comp, result.aligned, result.label, result.whole);
  fs.writeFileSync(path.join(outDir, 'side-by-side.png'), encodePng(side));
  fs.writeFileSync(path.join(outDir, 'heatmap.png'), encodePng(renderHeatmap(comp, result.aligned)));
  const regionFiles = [];
  for (const r of result.regions) {
    const file = path.join(outDir, 'regions', `${r.id}.png`);
    fs.writeFileSync(file, encodePng(renderRegionPair(r._a, r._b, r.id, r.score)));
    regionFiles.push(file);
  }
  return { sideBySide: path.join(outDir, 'side-by-side.png'), heatmap: path.join(outDir, 'heatmap.png'), regionFiles };
}

export function buildReport(result, files, meta) {
  return {
    tool: 'comp-diff',
    version: 1,
    createdAt: new Date().toISOString(),
    ...meta,
    align: result.align,
    overall: result.whole.overall,
    verdict: verdictFor(result.whole),
    scores: result.whole,
    palette: { comp: result.compPalette.map(({ hex, coverage }) => ({ hex, coverage })), build: result.buildPalette.map(({ hex, coverage }) => ({ hex, coverage })) },
    regions: result.regions.map(({ _a, _b, ...r }) => r),
    files,
  };
}

function summarize(report) {
  const lines = [];
  lines.push(`COMP-DIFF ${report.label ? `[${report.label}] ` : ''}overall ${(report.overall * 100).toFixed(0)}% (${report.verdict}) structure ${(report.scores.structure * 100).toFixed(0)}% color ${(report.scores.color * 100).toFixed(0)}% detail ${(report.scores.detail * 100).toFixed(0)}% bands ${(report.scores.bands * 100).toFixed(0)}%`);
  lines.push(`PALETTE comp ${report.palette.comp.slice(0, 5).map((c) => `${c.hex}(${Math.round(c.coverage * 100)}%)`).join(' ')}`);
  lines.push(`PALETTE build ${report.palette.build.slice(0, 5).map((c) => `${c.hex}(${Math.round(c.coverage * 100)}%)`).join(' ')}`);
  for (const r of report.regions) {
    lines.push(`REGION ${r.id.padEnd(18)} ${r.verdict.padEnd(12)} ${(r.score.overall * 100).toFixed(0).padStart(3)}%  structure ${(r.score.structure * 100).toFixed(0).padStart(3)}%  color ${(r.score.color * 100).toFixed(0).padStart(3)}%  detail ${(r.score.detail * 100).toFixed(0).padStart(3)}%${r.score.detailAdded > 0.25 ? '  +invented detail' : ''}`);
  }
  if (report.files) {
    lines.push(`FILES side-by-side ${report.files.sideBySide}`);
    lines.push(`FILES heatmap ${report.files.heatmap}`);
    lines.push(`FILES regions ${report.files.regionFiles.length} under ${path.dirname(report.files.regionFiles[0] || report.files.heatmap)}`);
  }
  const worst = [...report.regions].sort((a, b) => a.score.overall - b.score.overall).slice(0, 3);
  if (worst.length) lines.push(`WORST ${worst.map((r) => `${r.id} (${r.verdict}, ${(r.score.overall * 100).toFixed(0)}%)`).join('; ')}`);
  lines.push('OPEN the side-by-side and the worst region pairs before deciding anything; the numbers rank, the crops decide.');
  return lines.join('\n');
}

async function main() {
  const compPath = arg('comp'), buildPath = arg('build');
  if (!compPath || !buildPath) {
    console.error('usage: comp-diff.mjs --comp <png> --build <png> [--spec spec.json] [--out-dir dir] [--align top|stretch] [--label name] [--threshold 0.75] [--json]');
    process.exit(1);
  }
  let comp, build;
  try { comp = readPng(compPath); } catch (e) { console.error(`comp-diff: cannot read comp ${compPath}: ${e.message}`); process.exit(1); }
  try { build = readPng(buildPath); } catch (e) { console.error(`comp-diff: cannot read build ${buildPath}: ${e.message}`); process.exit(1); }
  let spec = null;
  const specPath = arg('spec');
  if (specPath) {
    try { spec = JSON.parse(fs.readFileSync(specPath, 'utf8')); } catch (e) { console.error(`comp-diff: cannot read spec ${specPath}: ${e.message}`); process.exit(1); }
  }
  const outDir = arg('out-dir', path.join(path.dirname(buildPath), 'diff'));
  const label = arg('label', path.basename(buildPath, '.png'));
  const result = compare({ comp, build, spec, align: arg('align', 'top'), label });
  const files = flag('no-files') ? null : writeArtifacts(result, comp, outDir);
  const report = buildReport(result, files, { label, comp: compPath, build: buildPath, spec: specPath || null, compSize: `${comp.width}x${comp.height}`, buildSize: `${build.width}x${build.height}` });
  if (files) fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  if (flag('json')) console.log(JSON.stringify(report, null, 2));
  else console.log(summarize(report));
  const threshold = arg('threshold') ? parseFloat(arg('threshold')) : null;
  if (threshold != null && report.overall < threshold) {
    if (!flag('json')) console.log(`BELOW THRESHOLD ${(threshold * 100).toFixed(0)}%: the reproduction is not done. Fix the worst regions and re-run; do not build past the hero.`);
    process.exit(3);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) main();
