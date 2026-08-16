#!/usr/bin/env node
/**
 * build-phase: the comp-led build as a state machine on disk, so the phases
 * new-work.md names are gated by scripts instead of remembered by the model.
 *
 * State lives at .impeccable/build/state.json. Phases, in order:
 *
 *   spec      the approved comp is measured (comp-spec.mjs wrote spec.json)
 *   plates    every raster region in the spec has its plate on disk
 *   hero      the first viewport is reproduced: comp-diff of hero-repro.png
 *             against the comp clears the gate
 *   sections  the rest of the surface is built inside the spec's system
 *   motion    interaction, reveals, motion
 *   responsive the other viewports
 *   review    the finish reviewer ran; disposition recorded
 *
 *   node build-phase.mjs start --comp <approved.png> [--breakpoint 1440x900] [--artifact index.html]
 *   node build-phase.mjs status                # human-readable, plus NEXT line
 *   node build-phase.mjs status --json
 *   node build-phase.mjs advance               # try to close the current phase; runs its gate
 *   node build-phase.mjs advance --force --reason "<why>"   # skip a gate; recorded, never silent
 *   node build-phase.mjs record hero --build .impeccable/review/hero-repro.png   # run the hero gate explicitly
 *   node build-phase.mjs note "<text>"         # append a note to the current phase
 *   node build-phase.mjs finish --disposition ship|fix|rebuild|recapture
 *
 * Gates:
 *   spec      -> spec.json exists and has >= 1 region
 *   plates    -> every region with medium raster has its plate file, decodable,
 *                at least 2x the comp region's pixel size in width, and the
 *                plate scores >= PLATE_MIN against the comp crop (comp-diff,
 *                detail-weighted). A missing or thin plate names itself.
 *   hero      -> every plate is referenced by a source file (the artifact
 *                named at start, else a bounded walk of the project), and
 *                .impeccable/review/hero-repro.png exists and comp-diff overall
 *                >= HERO_MIN (default 0.72) with no region `missing`. The
 *                score, the report path, and the attempt count are recorded.
 *   sections / motion / responsive -> no mechanical gate; advancing records
 *                the moment, and the finish reviewer reads the timeline.
 *
 * Exit codes: 0 ok / advanced, 2 gate failed (state unchanged, reasons
 * printed), 1 usage.
 *
 * Nothing here needs a browser. Screenshots come from the harness; this
 * script only measures them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decodePng } from './lib/png.mjs';
import { crop } from './lib/raster.mjs';
import { compare, verdictFor } from './comp-diff.mjs';
import { SPEC_PATH, BUILD_DIR, loadSpec } from './comp-spec.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const STATE_PATH = path.join(BUILD_DIR, 'state.json');
export const PHASES = ['spec', 'plates', 'hero', 'sections', 'motion', 'responsive', 'review'];
export const HERO_MIN = 0.72;
export const PLATE_MIN = 0.5;
export const HERO_REPRO = path.join('.impeccable', 'review', 'hero-repro.png');

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);
const now = () => new Date().toISOString();

export function loadState(statePath = STATE_PATH) {
  if (!fs.existsSync(statePath)) return null;
  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

export function saveState(state, statePath = STATE_PATH) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

export function newState({ comp, breakpoint = null, artifact = null }) {
  return {
    tool: 'build-phase',
    version: 1,
    startedAt: now(),
    comp,
    breakpoint,
    artifact,
    phase: 'spec',
    phases: Object.fromEntries(PHASES.map((p) => [p, { status: p === 'spec' ? 'open' : 'pending', openedAt: p === 'spec' ? now() : null, closedAt: null, attempts: 0, notes: [], gate: null, forced: null }])),
    finish: null,
  };
}

// ---- gates -----------------------------------------------------------------

export function gateSpec(state, { specPath = SPEC_PATH } = {}) {
  const spec = loadSpec(specPath);
  if (!spec) return { ok: false, reasons: [`no spec at ${specPath}: run comp-spec.mjs --comp ${state.comp} --grid, name the regions, then --regions regions.json`] };
  if (!spec.regions || spec.regions.length < 1) return { ok: false, reasons: ['spec has no regions'] };
  if (spec.comp && state.comp && path.resolve(spec.comp) !== path.resolve(state.comp)) {
    return { ok: false, reasons: [`spec measures ${spec.comp}, but this build started on ${state.comp}; re-run comp-spec on the approved comp`] };
  }
  const plates = spec.regions.filter((r) => r.medium === 'raster').length;
  return { ok: true, reasons: [], summary: `${spec.regions.length} regions, ${plates} plates` };
}

export function gatePlates(state, { specPath = SPEC_PATH } = {}) {
  const spec = loadSpec(specPath);
  if (!spec) return { ok: false, reasons: ['no spec'] };
  const rasterRegions = spec.regions.filter((r) => r.medium === 'raster');
  if (!rasterRegions.length) return { ok: true, reasons: [], summary: 'no plates owed', plates: [] };
  let comp = null;
  try { comp = decodePng(fs.readFileSync(spec.comp)); } catch { /* scored without the comp crop below */ }
  const reasons = [], plates = [];
  for (const r of rasterRegions) {
    const file = r.plate;
    if (!file || !fs.existsSync(file)) { reasons.push(`plate missing for ${r.id}: expected ${file || '(no path)'}; produce it from comp-spec.mjs --crop ${r.id} with generate-image.mjs --plate`); plates.push({ id: r.id, file, status: 'missing' }); continue; }
    let img;
    try { img = decodePng(fs.readFileSync(file)); } catch (e) { reasons.push(`plate ${file} is not a decodable PNG: ${e.message}`); plates.push({ id: r.id, file, status: 'unreadable' }); continue; }
    // A texture tiles, so it owes no size floor and no structural match:
    // it is judged on palette and grain only. Every other plate must be at
    // least 1.5x the region (capped at 1536px, the largest size the
    // generators emit; past that the region is a full-bleed field the page
    // scales) and read as the region under object-fit: cover.
    const isTexture = r.kind === 'texture';
    const minW = Math.min(1536, r.px.w * 1.5);
    if (!isTexture && img.width < minW) reasons.push(`plate ${file} is ${img.width}px wide; the comp region is ${r.px.w}px and a shipping plate needs at least ${Math.round(minW)}px. Regenerate at asset size, do not crop the comp.`);
    let score = null;
    if (comp) {
      const ref = crop(comp, r.px.x, r.px.y, r.px.w, r.px.h);
      const res = compare({ comp: ref, build: img, align: 'cover', spec: null, kind: r.kind });
      score = res.whole;
      const effective = isTexture ? 0.5 * score.color + 0.5 * Math.min(1, score.detail / 0.6) : score.overall;
      if (effective < PLATE_MIN) reasons.push(`plate ${file} scores ${(effective * 100).toFixed(0)}% against the comp region ${r.id} (structure ${(score.structure * 100).toFixed(0)}%, color ${(score.color * 100).toFixed(0)}%, detail ${(score.detail * 100).toFixed(0)}%); it does not read as the same ${isTexture ? 'material' : 'region'}. Regenerate with the crop as --ref and the comp-spec plate prompt${isTexture ? ', or crop a clean patch of the comp region and tile it' : ''}.`);
    }
    plates.push({ id: r.id, file, status: 'ok', size: `${img.width}x${img.height}`, score: score ? score.overall : null });
  }
  return { ok: reasons.length === 0, reasons, summary: `${plates.filter((p) => p.status === 'ok').length}/${rasterRegions.length} plates`, plates };
}

/** Source files that could reference a plate: bounded walk, skipping deps and build output. */
function sourceFiles(root = '.', limit = 400) {
  const out = [];
  const skip = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.svelte-kit', '.impeccable', 'assets', 'coverage']);
  const exts = /\.(html?|css|scss|jsx?|tsx?|svelte|vue|astro|mdx?|php|erb|hbs)$/i;
  const walk = (dir, depth) => {
    if (out.length >= limit || depth > 6) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= limit) return;
      if (e.isDirectory()) { if (!skip.has(e.name) && !e.name.startsWith('.')) walk(path.join(dir, e.name), depth + 1); }
      else if (exts.test(e.name)) out.push(path.join(dir, e.name));
    }
  };
  walk(root, 0);
  return out;
}

/** Plates the artifact never references: a plate on disk that no source names ships nothing. */
export function unreferencedPlates(spec, artifact = null) {
  const plates = (spec?.regions || []).filter((r) => r.medium === 'raster' && r.plate);
  if (!plates.length) return [];
  const files = artifact && fs.existsSync(artifact) ? [artifact] : sourceFiles();
  let corpus = '';
  for (const f of files) { try { corpus += fs.readFileSync(f, 'utf8') + '\n'; } catch { /* skip */ } }
  const missing = [];
  for (const r of plates) {
    const base = path.basename(r.plate);
    const stem = base.replace(/\.[a-z0-9]+$/i, '');
    // a data URI inline copy counts when the region id or file stem is named beside it
    if (corpus.includes(base) || (corpus.includes('data:image/') && (corpus.includes(stem) || corpus.includes(r.id)))) continue;
    missing.push(r);
  }
  return missing;
}

export function gateHero(state, { buildPath = HERO_REPRO, specPath = SPEC_PATH, min = HERO_MIN, outDir = path.join('.impeccable', 'review', 'diff', 'hero'), artifact = null } = {}) {
  if (!fs.existsSync(buildPath)) return { ok: false, reasons: [`no hero capture at ${buildPath}: screenshot the first viewport at the comp's own dimensions (${state.breakpoint || 'comp size'}) into that path`] };
  const specForRefs = loadSpec(specPath);
  const unreferenced = unreferencedPlates(specForRefs, artifact || state.artifact || null);
  if (unreferenced.length) {
    return { ok: false, reasons: unreferenced.map((r) => `plate ${r.plate} (region ${r.id}) is not referenced by any source file: the page draws that region in code while the produced plate sits unused. Place the plate (an <img>, a background-image, or an inlined data URI named for it) and recapture.`) };
  }
  const script = path.join(HERE, 'comp-diff.mjs');
  const args = [script, '--comp', state.comp, '--build', buildPath, '--out-dir', outDir, '--label', 'hero', '--json'];
  const spec = loadSpec(specPath);
  if (spec) args.push('--spec', specPath);
  const res = spawnSync(process.execPath, args, { encoding: 'utf8' });
  if (res.status !== 0 && res.status !== 3) return { ok: false, reasons: [`comp-diff failed: ${res.stderr || res.stdout}`] };
  let report;
  try { report = JSON.parse(res.stdout); } catch { return { ok: false, reasons: ['comp-diff produced no report'] }; }
  const reasons = [];
  if (report.overall < min) reasons.push(`hero overall ${(report.overall * 100).toFixed(0)}% < ${(min * 100).toFixed(0)}% (structure ${(report.scores.structure * 100).toFixed(0)}%, color ${(report.scores.color * 100).toFixed(0)}%, detail ${(report.scores.detail * 100).toFixed(0)}%)`);
  const missing = report.regions.filter((r) => r.verdict === 'missing');
  for (const r of missing) reasons.push(`region ${r.id} is missing (detail ${(r.score.detail * 100).toFixed(0)}%, structure ${(r.score.structure * 100).toFixed(0)}%): the comp shows material the build does not`);
  const contradicted = report.regions.filter((r) => r.verdict === 'contradicted');
  if (contradicted.length > Math.max(1, Math.floor(report.regions.length / 3))) reasons.push(`${contradicted.length} of ${report.regions.length} regions contradicted: ${contradicted.map((r) => r.id).join(', ')}`);
  return {
    ok: reasons.length === 0,
    reasons,
    summary: `hero ${(report.overall * 100).toFixed(0)}% (${report.verdict})`,
    score: report.overall,
    verdict: report.verdict,
    report: path.join(outDir, 'report.json'),
    sideBySide: report.files ? report.files.sideBySide : null,
    worst: [...report.regions].sort((a, b) => a.score.overall - b.score.overall).slice(0, 3).map((r) => `${r.id} ${r.verdict} ${(r.score.overall * 100).toFixed(0)}%`),
  };
}

const GATES = { spec: gateSpec, plates: gatePlates, hero: gateHero };

// ---- transitions -----------------------------------------------------------

export function runGate(state, phase, opts = {}) {
  const gate = GATES[phase];
  if (!gate) return { ok: true, reasons: [], summary: 'no mechanical gate' };
  return gate(state, opts);
}

/** Reasons a gate may be forced past. The user downgrading the comp's authority
 *  in words is the only one; the parent quotes it. A reason that does not name
 *  the user is a model talking itself past its own gate, and it is refused. */
export function forceAllowed(reason) {
  return typeof reason === 'string' && /\buser\b|\bthey (said|asked|told)\b|\bpaul\b/i.test(reason) && reason.trim().length > 20;
}

export function advance(state, { force = false, reason = null, gateOpts = {} } = {}) {
  const phase = state.phase;
  const idx = PHASES.indexOf(phase);
  if (idx === -1 || phase === 'review') return { ok: false, reasons: [`phase ${phase} cannot advance; use finish`] };
  const p = state.phases[phase];
  p.attempts += 1;
  const gate = runGate(state, phase, gateOpts);
  const { plates: _p, ...gateRecord } = gate;
  p.gate = { ...gateRecord, at: now() };
  if (!gate.ok && force && !forceAllowed(reason)) {
    p.status = 'open';
    return { ok: false, phase, reasons: [...gate.reasons, `--force refused: "${reason || ''}" does not quote the user downgrading the comp. A single-file deliverable, a missing tool, or difficulty is not a reason; embed the plate as a data URI, produce it with the harness image tool, or ask the user.`], gate };
  }
  if (!gate.ok && !force) { p.status = 'open'; return { ok: false, phase, reasons: gate.reasons, gate }; }
  if (!gate.ok && force) p.forced = { at: now(), reason, reasons: gate.reasons };
  p.status = 'closed'; p.closedAt = now();
  const next = PHASES[idx + 1];
  state.phase = next;
  state.phases[next].status = 'open'; state.phases[next].openedAt = now();
  return { ok: true, phase, next, gate, forced: !!p.forced };
}

export function nextInstruction(state) {
  switch (state.phase) {
    case 'spec': return `Measure the comp: node comp-spec.mjs --comp ${state.comp} --grid, open ${path.join(BUILD_DIR, 'comp-grid.png')}, write regions.json (every illustration, photo, texture as its own plate region), run comp-spec.mjs --comp ${state.comp} --regions regions.json, then build-phase.mjs advance.`;
    case 'plates': return 'Produce every plate in the spec (comp-spec.mjs --print lists them): comp-spec.mjs --crop <id>, then generate-image.mjs --plate <id> (or the harness image tool with the crop as reference and the comp-spec plate prompt). Then build-phase.mjs advance. Write no page code before this passes.';
    case 'hero': return `Build only the first viewport at ${state.breakpoint || 'the comp size'} using the plates and the spec's boxes and palette; capture it into ${HERO_REPRO}; run build-phase.mjs advance. Fix the worst regions it names and re-run; do not build past the hero until it passes.`;
    case 'sections': return 'Build the remaining sections inside the spec system (same corner language, rules, and palette; nothing the comp does not show). Then build-phase.mjs advance.';
    case 'motion': return 'Add the signature interaction, reveals, and motion. Then build-phase.mjs advance.';
    case 'responsive': return 'Build the other viewports (mobile first if the surface is mobile). Capture desktop.png and mobile.png into .impeccable/review/. Then build-phase.mjs advance.';
    case 'review': return 'Spawn the finish reviewer with the state file, the hero diff report, and the captures; record its disposition with build-phase.mjs finish --disposition <word>.';
    default: return '';
  }
}

export function renderStatus(state) {
  const lines = [`BUILD-PHASE ${state.phase.toUpperCase()}  comp ${state.comp}${state.breakpoint ? `  breakpoint ${state.breakpoint}` : ''}`];
  for (const p of PHASES) {
    const s = state.phases[p];
    let line = `  ${p.padEnd(11)} ${s.status.padEnd(8)}`;
    if (s.gate && s.gate.summary) line += ` ${s.gate.summary}`;
    if (s.attempts > 1) line += ` (${s.attempts} attempts)`;
    if (s.forced) line += `  FORCED: ${s.forced.reason}`;
    lines.push(line);
  }
  if (state.finish) lines.push(`  finish      ${state.finish.disposition} at ${state.finish.at}`);
  lines.push(`NEXT ${nextInstruction(state)}`);
  return lines.join('\n');
}

async function main() {
  const cmd = process.argv[2];
  if (!cmd || flag('help')) {
    console.error('usage: build-phase.mjs start --comp <png> [--breakpoint WxH] | status [--json] | advance [--force --reason "..."] | record hero --build <png> | note "<text>" | finish --disposition <word>');
    process.exit(1);
  }
  if (cmd === 'start') {
    const comp = arg('comp');
    if (!comp || !fs.existsSync(comp)) { console.error('build-phase: --comp <approved comp png> is required and must exist'); process.exit(1); }
    let breakpoint = arg('breakpoint');
    if (!breakpoint) { try { const i = decodePng(fs.readFileSync(comp)); breakpoint = `${i.width}x${i.height}`; } catch { /* leave null */ } }
    const existing = loadState();
    if (existing && !flag('reset')) {
      console.log(`build-phase: state exists (phase ${existing.phase}); pass --reset to start over`);
      console.log(renderStatus(existing));
      return;
    }
    const state = newState({ comp, breakpoint, artifact: arg('artifact') });
    saveState(state);
    console.log(renderStatus(state));
    return;
  }
  const state = loadState();
  if (!state) { console.error(`build-phase: no state at ${STATE_PATH}; run build-phase.mjs start --comp <approved comp>`); process.exit(1); }
  if (cmd === 'status') {
    if (flag('json')) console.log(JSON.stringify(state, null, 2)); else console.log(renderStatus(state));
    return;
  }
  if (cmd === 'note') {
    const text = process.argv.slice(3).filter((a) => !a.startsWith('--')).join(' ');
    state.phases[state.phase].notes.push({ at: now(), text });
    saveState(state);
    console.log(`noted on ${state.phase}`);
    return;
  }
  if (cmd === 'record') {
    const which = process.argv[3];
    if (which !== 'hero') { console.error('build-phase: record hero --build <png>'); process.exit(1); }
    const gate = gateHero(state, { buildPath: arg('build', HERO_REPRO), min: arg('min') ? parseFloat(arg('min')) : HERO_MIN });
    state.phases.hero.attempts += 1;
    state.phases.hero.gate = { ...gate, at: now() };
    saveState(state);
    console.log(`${gate.ok ? 'PASS' : 'FAIL'} ${gate.summary || ''}`);
    for (const r of gate.reasons) console.log(`  - ${r}`);
    if (gate.worst) console.log(`  worst: ${gate.worst.join('; ')}`);
    if (gate.sideBySide) console.log(`  open ${gate.sideBySide}`);
    process.exit(gate.ok ? 0 : 2);
  }
  if (cmd === 'advance') {
    const gateOpts = {};
    if (arg('build')) gateOpts.buildPath = arg('build');
    if (arg('min')) gateOpts.min = parseFloat(arg('min'));
    if (arg('artifact')) gateOpts.artifact = arg('artifact');
    const res = advance(state, { force: flag('force'), reason: arg('reason'), gateOpts });
    saveState(state);
    if (!res.ok) {
      console.log(`GATE ${res.phase ? res.phase.toUpperCase() : ''} FAILED (state unchanged)`);
      for (const r of res.reasons) console.log(`  - ${r}`);
      if (res.gate && res.gate.worst) console.log(`  worst: ${res.gate.worst.join('; ')}`);
      if (res.gate && res.gate.sideBySide) console.log(`  open ${res.gate.sideBySide} and the worst region pairs before editing`);
      process.exit(2);
    }
    console.log(`ADVANCED ${res.phase} -> ${res.next}${res.forced ? ' (FORCED; recorded)' : ''}${res.gate.summary ? `  ${res.gate.summary}` : ''}`);
    console.log(`NEXT ${nextInstruction(state)}`);
    return;
  }
  if (cmd === 'finish') {
    const disposition = arg('disposition');
    if (!['ship', 'fix', 'rebuild', 'recapture'].includes(disposition)) { console.error('build-phase: finish --disposition ship|fix|rebuild|recapture'); process.exit(1); }
    state.finish = { disposition, at: now(), phaseAtFinish: state.phase };
    if (state.phase === 'review') { state.phases.review.status = 'closed'; state.phases.review.closedAt = now(); }
    saveState(state);
    console.log(renderStatus(state));
    return;
  }
  console.error(`build-phase: unknown command ${cmd}`);
  process.exit(1);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) main();
