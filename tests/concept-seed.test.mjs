import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  readConceptCatalog,
  validateConceptCatalog,
  validateConceptEntry,
} from '../skill/scripts/lib/concept-catalog.mjs';
import { readCompositionCatalog } from '../skill/scripts/lib/composition-catalog.mjs';
import { dealCompositions, renderChallenger, selectApprovedChallengers, selectApprovedComposition, selectApprovedCompositions } from '../skill/scripts/concept-seed.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'skill', 'scripts', 'concept-seed.mjs');
// The live catalog is service-side (impeccable-site); the public repo tests
// the seed mechanics against this fixture catalog, which passes the same
// validators the real one does.
const FIXTURE_DIR = path.join(ROOT, 'tests', 'fixtures', 'concept-catalog');

const fixtureState = readConceptCatalog(
  path.join(FIXTURE_DIR, 'concept-ingredients.json'),
  path.join(FIXTURE_DIR, 'concept-reviews.json')
);
const fixtureConcepts = fixtureState.concepts;
const fixtureCompositions = readCompositionCatalog(
  path.join(FIXTURE_DIR, 'composition-ingredients.json'),
  path.join(FIXTURE_DIR, 'composition-reviews.json')
).compositions;

function run(scope, extraArgs = [], env = {}) {
  return spawnSync(process.execPath, [SCRIPT, '--scope', scope, '--from', 'stable-test', ...extraArgs], {
    cwd: ROOT,
    encoding: 'utf-8',
    env: { ...process.env, IMPECCABLE_CATALOG_DIR: FIXTURE_DIR, ...env },
  });
}

describe('concept seed scopes', () => {
  it('keeps complete-direction and established-world surface rolls reproducible but independent', () => {
    const directionA = run('direction');
    const directionB = run('direction');
    const surface = run('surface');
    assert.equal(directionA.status, 0);
    assert.equal(directionA.stdout, directionB.stdout);
    assert.notEqual(directionA.stdout, surface.stdout);
    assert.match(directionA.stdout, /DIRECTION CONCEPT SEED/);
    assert.match(directionA.stdout, /source: local/);
    assert.match(directionA.stdout, /selected\s+independently/);
    assert.match(directionA.stdout, /substantially different future surface/);
    assert.match(directionA.stdout, /Never expose assignment metadata/);
    assert.match(directionA.stdout, /SYSTEM GRAMMAR:/);
    assert.match(directionA.stdout, /CREATIVE SPARK:/);
    assert.match(directionA.stdout, /WEB LEVERAGE:/);
    assert.match(directionA.stdout, /credible\s+interface language/);
    assert.match(directionA.stdout, /commit to it across navigation/);
    assert.doesNotMatch(directionA.stdout, /undefined/);
    assert.match(surface.stdout, /SURFACE CONCEPT SEED/);
    assert.match(surface.stdout, /committed visual identity/);
  });

  it('rejects unknown scopes', () => {
    const result = run('unknown');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /direction or surface/);
  });

  it('never promotes a rank outside the grounded candidate ledger', () => {
    for (const count of [5, 6, 7]) {
      for (let index = 0; index < 30; index += 1) {
        const result = spawnSync(process.execPath, [SCRIPT, '--scope', 'direction', '--from', `count-${count}-${index}`, '--candidate-count', String(count)], {
          cwd: ROOT,
          encoding: 'utf-8',
          env: { ...process.env, IMPECCABLE_CATALOG_DIR: FIXTURE_DIR },
        });
        assert.equal(result.status, 0);
        const promoted = Number(result.stdout.match(/ASSIGNED INDEX: (\d+)/)?.[1]);
        assert.equal(promoted >= 3 && promoted <= count, true, `rank ${promoted} must fit ${count} candidates`);
      }
    }
    const invalid = run('direction', ['--candidate-count', '4']);
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /integer from 5 to 7/);
  });

  it('degrades to a promotion-only seed when catalog and API are both unreachable', () => {
    const degraded = run('direction', ['--mode', 'persuade'], {
      IMPECCABLE_CATALOG_DIR: '/nonexistent-catalog-dir',
      IMPECCABLE_API_URL: 'http://127.0.0.1:9/api',
      IMPECCABLE_API_TIMEOUT: '400',
    });
    assert.equal(degraded.status, 0);
    assert.match(degraded.stdout, /source: degraded/);
    assert.match(degraded.stdout, /ASSIGNED INDEX: [3-7]/);
    assert.match(degraded.stdout, /No challengers this run/);
    assert.doesNotMatch(degraded.stdout, /CHALLENGERS:/);
  });

  it('keeps composition challengers inside the requested surface mode', () => {
    const pool = [
      { id: 'persuade-stage', surface: 'persuade', status: 'approved' },
      { id: 'experience-stage', surface: 'experience', status: 'approved' },
    ];
    const experience = selectApprovedComposition({
      scope: 'direction',
      key: 'mode-match',
      mode: 'experience',
      sourceCompositions: pool,
    });
    const read = selectApprovedComposition({
      scope: 'direction',
      key: 'mode-missing',
      mode: 'read',
      sourceCompositions: pool,
    });
    assert.equal(experience?.id, 'experience-stage');
    assert.equal(read, null, 'a missing mode must not borrow an unrelated composition');

    const rendered = run('direction', ['--mode', 'experience']);
    assert.equal(rendered.status, 0);
    assert.match(rendered.stdout, /mode: experience/);
    assert.match(rendered.stdout, /--scope direction --mode experience --from stable-test/);
    // Compositions are pulled from the deal by default until the expanded
    // catalog ships; the draw machinery stays live behind the env gate.
    assert.doesNotMatch(rendered.stdout, /COMPOSITION/);
    const gated = run('direction', ['--mode', 'experience'], { IMPECCABLE_COMPOSITIONS: '1' });
    assert.equal(gated.status, 0);
    assert.match(gated.stdout, /FIRST-SURFACE COMPOSITION/);
  });

  it('draws several composition inputs from distinct families when the approved pool allows it', () => {
    const pool = [
      { id: 'a', familyId: 'first', surface: 'persuade', status: 'approved' },
      { id: 'b', familyId: 'scroll', surface: 'persuade', status: 'approved' },
      { id: 'c', familyId: 'physics', surface: 'persuade', status: 'approved' },
      { id: 'd', familyId: 'first', surface: 'persuade', status: 'approved' },
      { id: 'e', familyId: 'other', surface: 'operate', status: 'approved' },
    ];
    const picks = selectApprovedCompositions({ scope: 'direction', key: 'several', mode: 'persuade', sourceCompositions: pool });
    assert.equal(picks.length, 3);
    assert.equal(new Set(picks.map(pick => pick.familyId)).size, 3);
    assert.equal(picks.every(pick => pick.surface === 'persuade'), true);
  });

  it('validates the fixture catalog with the real gates', () => {
    const result = validateConceptCatalog(fixtureState.catalog, fixtureState.reviewData);
    assert.deepEqual(result.errors, []);
    assert.equal(result.stats.approved >= 24, true);
    for (const tier of ['graphic', 'interaction', 'atmosphere']) {
      const approved = fixtureConcepts.filter(concept => concept.status === 'approved' && concept.wellTier === tier);
      assert.equal(approved.length >= 6, true, `${tier} needs re-roll depth`);
    }
  });

  it('rejects concepts that name a motif without system grammar and web leverage', () => {
    const errors = validateConceptEntry({
      id: 'fixture-newspaper',
      form: 'a newspaper front page, with headline hierarchy and columns',
      lineage: 'editorial publishing',
      tags: ['hierarchy', 'columns', 'serial'],
      strength: 'dual',
    });
    assert.equal(errors.some(error => error.includes('system grammar')), true);
    assert.equal(errors.some(error => error.includes('web leverage')), true);
  });

  it('rejects literal operations archetypes even when their UI grammar is complete', () => {
    const errors = validateConceptEntry({
      id: 'fixture-mission-control',
      form: 'a mission control room, where panels, alerts, and operator stations coordinate a launch',
      lineage: 'immersive environmental experience',
      tags: ['depth', 'threshold', 'rhythm'],
      strength: 'dual',
      spark: 'Cold reflected light moves across the room as the countdown opens one route, closes another, and leaves a bright trace of every recent decision on the main board.',
      system: [
        'Palette/material: wet basalt grays, cold green light, and one warm seam marking the active route',
        'Type/composition: narrow engraved capitals for room names over a quiet cartographic body voice',
        'Topology/navigation: move by chamber, threshold, and revealed route',
        'Controls/state: inspect open, pending, closed, and remembered states',
        'Responsive/motion: turn depth into a stepwise route with orientation kept',
      ],
      webLeverage: 'WebGL depth rendering with a complete keyboard-readable route index',
    });
    assert.equal(errors.some(error => error.includes('operations archetype')), true);
  });

  it('welcomes materially specific craft tools instead of confusing them with operational software', () => {
    const errors = validateConceptEntry({
      id: 'cabinetmaker-workbench',
      form: "a cabinetmaker's workbench, where holdfasts, planing stops, shavings, and old cuts turn careful joinery into visible memory",
      lineage: 'Cabinetmaking benches, workholding craft, hand-planing practice, and tool-wear conservation',
      tags: ['workholding', 'joinery', 'patina'],
      strength: 'world',
      spark: 'Morning light crosses a blackened bench top as pale curls gather behind a plane, a holdfast rings into place, and fresh dovetails rise from a century of cuts.',
      system: [
        'Palette/material: blackened beech, pale shaving curls, and brass holdfast glints over a workshop-gray ground',
        'Type/composition: stamped maker marks and penciled layout lines ranked against a strong horizontal bench datum',
        'Topology/navigation: follow stock from reference face through marked joints and fitted assemblies',
        'Controls/state: clamp, mark, plane, pare, dry-fit, revise, and preserve grain direction',
        'Responsive/motion: unfold the bench into a project sequence and follow each hand gesture',
      ],
      webLeverage: 'Grain-aware direct manipulation, reversible project history, and a keyboard-readable construction diagram',
    });
    assert.deepEqual(errors, []);
  });

  it('selects six approved challengers, two from every translation tier', () => {
    for (let index = 0; index < 100; index += 1) {
      const { picks } = selectApprovedChallengers({ scope: 'surface', key: `coverage-${index}`, sourceConcepts: fixtureConcepts });
      assert.equal(picks.length, 6);
      for (const tier of ['graphic', 'interaction', 'atmosphere']) {
        assert.equal(picks.filter(pick => pick.wellTier === tier).length, 2);
      }
      assert.equal(new Set(picks.map(pick => pick.id)).size, 6);
      assert.equal(picks.every(pick => pick.status === 'approved'), true);
    }
  });

  it('re-rolls draw disjoint challengers and stay reproducible from the base key', () => {
    const rounds = [0, 1, 2].map(reroll =>
      selectApprovedChallengers({ scope: 'direction', key: 'reroll-chain', reroll, sourceConcepts: fixtureConcepts })
    );
    const again = selectApprovedChallengers({ scope: 'direction', key: 'reroll-chain', reroll: 2, sourceConcepts: fixtureConcepts });
    assert.deepEqual(again.picks.map(pick => pick.id), rounds[2].picks.map(pick => pick.id));
    const seen = new Set();
    for (const round of rounds) {
      assert.equal(round.picks.length, 6);
      assert.equal(round.picks.every(pick => !seen.has(pick.id)), true);
      for (const pick of round.picks) seen.add(pick.id);
      for (const tier of ['graphic', 'interaction', 'atmosphere']) {
        assert.equal(round.picks.filter(pick => pick.wellTier === tier).length, 2);
      }
    }
  });

  it('renders re-roll rounds with elimination framing and a chained reproduction key', () => {
    const round0 = run('direction');
    const round1A = run('direction', ['--reroll', '1']);
    const round1B = run('direction', ['--reroll', '1']);
    assert.equal(round1A.status, 0);
    assert.equal(round1A.stdout, round1B.stdout);
    assert.notEqual(round1A.stdout, round0.stdout);
    assert.match(round1A.stdout, /RE-ROLL ROUND 1/);
    assert.match(round1A.stdout, /may not return reworded/);
    assert.match(round1A.stdout, /--from stable-test --reroll 1/);
    assert.doesNotMatch(round0.stdout, /RE-ROLL ROUND/);
    const invalid = run('direction', ['--reroll', 'nope']);
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /non-negative integer/);
  });

  it('filters challengers by strength per scope and falls back when a tier has no match', () => {
    const make = (id, tier, strength) => ({
      id,
      familyId: `${id}-family`,
      wellId: `${id}-well`,
      wellTier: tier,
      strength,
      status: 'approved',
      form: `${id} form`,
      spark: `${id} spark`,
      system: [],
      webLeverage: `${id} web`,
    });
    const pool = [
      make('poster', 'graphic', 'world'),
      make('flipbook', 'graphic', 'composition'),
      make('radar', 'interaction', 'dual'),
      make('cavern', 'atmosphere', 'world'),
    ];
    for (let index = 0; index < 40; index += 1) {
      const direction = selectApprovedChallengers({ scope: 'direction', key: `d-${index}`, sourceConcepts: pool });
      assert.equal(direction.picks.every(pick => pick.strength !== 'composition'), true);
      const surface = selectApprovedChallengers({ scope: 'surface', key: `s-${index}`, sourceConcepts: pool });
      const surfaceGraphic = surface.picks.find(pick => pick.wellTier === 'graphic');
      assert.equal(surfaceGraphic.id, 'flipbook');
      // atmosphere has no composition|dual entries, so surface falls back to its full pool
      const surfaceAtmosphere = surface.picks.find(pick => pick.wellTier === 'atmosphere');
      assert.equal(surfaceAtmosphere.id, 'cavern');
    }
  });

  it('weights challenger draws by approval rating without shrinking the pool', () => {
    const make = (id, rating) => ({
      id,
      familyId: `${id}-family`,
      wellId: `${id}-well`,
      wellTier: 'graphic',
      strength: 'world',
      status: 'approved',
      form: `${id} form`,
      spark: `${id} spark`,
      system: [],
      webLeverage: `${id} web`,
      review: rating ? { status: 'approved', rating } : { status: 'approved' },
    });
    const filler = (tier, id) => ({
      ...make(id, undefined),
      wellTier: tier,
    });
    const pool = [
      make('flagship', 3),
      make('solid-a', 2),
      make('solid-b', undefined),
      make('marginal', 1),
      filler('interaction', 'radar'),
      filler('atmosphere', 'cavern'),
    ];
    const counts = { flagship: 0, 'solid-a': 0, 'solid-b': 0, marginal: 0 };
    for (let index = 0; index < 300; index += 1) {
      const { picks } = selectApprovedChallengers({ scope: 'direction', key: `weight-${index}`, sourceConcepts: pool });
      const graphicFirst = picks.find(pick => pick.wellTier === 'graphic');
      counts[graphicFirst.id] += 1;
    }
    // A 1-star draws at half weight rather than not at all. Excluding it made a
    // rating do the job breadth already does, and a marginal keep records
    // "narrow or unexceptional" rather than "wrong".
    assert.equal(counts.marginal > 0, true, `marginal ${counts.marginal} should draw`);
    assert.equal(counts.marginal < counts['solid-b'], true,
      `marginal ${counts.marginal} should draw below solid-b ${counts['solid-b']}`);

    // A 3-star no longer outdraws a 2-star. The multiplier concentrated the
    // draw hard on a thin pool: measured on the live catalog, 3-star worlds took
    // 75% of the interaction draw from 15 of 25 eligible worlds.
    const spread = Math.abs(counts.flagship - counts['solid-b']) / Math.max(counts.flagship, counts['solid-b']);
    assert.equal(spread < 0.4, true,
      `flagship ${counts.flagship} and solid-b ${counts['solid-b']} should draw comparably`);

    // A tier holding only 1-star approvals still yields challengers.
    const onlyMarginal = [
      make('lone-marginal', 1),
      filler('interaction', 'radar2'),
      filler('atmosphere', 'cavern2'),
    ];
    const { picks } = selectApprovedChallengers({ scope: 'direction', key: 'lone', sourceConcepts: onlyMarginal });
    assert.equal(picks.some(pick => pick.id === 'lone-marginal'), true);
  });

  it('holds niche worlds out of the challenger pool however strong their rating', () => {
    const make = (id, rating, breadth) => ({
      id,
      familyId: `${id}-family`,
      wellId: `${id}-well`,
      wellTier: 'graphic',
      strength: 'world',
      status: 'approved',
      form: `${id} form`,
      spark: `${id} spark`,
      system: [],
      webLeverage: `${id} web`,
      review: { status: 'approved', ...(rating ? { rating } : {}), ...(breadth ? { breadth } : {}) },
    });
    const filler = (tier, id) => ({ ...make(id), wellTier: tier });
    const pool = [
      make('broad-flagship', 3),
      make('narrow-flagship', 3, 'niche'),
      make('broad-solid', 2),
      filler('interaction', 'radar3'),
      filler('atmosphere', 'cavern3'),
    ];
    // Breadth excludes independently of rating: over many keys a niche 3-star
    // never challenges while its broad peers keep rotating.
    for (let index = 0; index < 200; index += 1) {
      const { picks } = selectApprovedChallengers({ scope: 'direction', key: `breadth-${index}`, sourceConcepts: pool });
      assert.equal(picks.some(pick => pick.id === 'narrow-flagship'), false, `niche world drawn at key breadth-${index}`);
    }
    // A tier holding only niche approvals falls back rather than starving,
    // exactly like the marginal-only tier above.
    const onlyNiche = [
      make('lone-niche', 3, 'niche'),
      filler('interaction', 'radar4'),
      filler('atmosphere', 'cavern4'),
    ];
    const { picks } = selectApprovedChallengers({ scope: 'direction', key: 'lone-niche', sourceConcepts: onlyNiche });
    assert.equal(picks.some(pick => pick.id === 'lone-niche'), true);
  });

  it('weights composition draws by rating without letting the ticket dedupe erase the weight', () => {
    const pool = [
      { id: 'flagship-stage', surface: 'persuade', status: 'approved', review: { status: 'approved', rating: 3 } },
      { id: 'plain-stage', surface: 'persuade', status: 'approved', review: { status: 'approved' } },
      { id: 'marginal-stage', surface: 'persuade', status: 'approved', review: { status: 'approved', rating: 1 } },
    ];
    const counts = { 'flagship-stage': 0, 'plain-stage': 0, 'marginal-stage': 0 };
    for (let index = 0; index < 300; index += 1) {
      const picks = selectApprovedCompositions({ scope: 'direction', key: `stage-weight-${index}`, mode: 'persuade', sourceCompositions: pool, count: 1 });
      counts[picks[0].id] += 1;
    }
    // Same weighting as challengers: a 1-star draws at half rather than not at
    // all, and a 3-star no longer outdraws a 2-star.
    assert.equal(counts['marginal-stage'] > 0, true, 'a 1-star composition still draws, at half weight');
    assert.equal(counts['marginal-stage'] < counts['plain-stage'], true,
      `marginal ${counts['marginal-stage']} should draw below plain ${counts['plain-stage']}`);
    const stageSpread = Math.abs(counts['flagship-stage'] - counts['plain-stage'])
      / Math.max(counts['flagship-stage'], counts['plain-stage']);
    assert.equal(stageSpread < 0.4, true,
      `flagship ${counts['flagship-stage']} and plain ${counts['plain-stage']} should draw comparably`);

    // A pool of nothing but 1-star keeps still yields compositions.
    const onlyMarginal = [
      { id: 'lone-marginal-stage', surface: 'persuade', status: 'approved', review: { status: 'approved', rating: 1 } },
    ];
    const fallback = selectApprovedCompositions({ scope: 'direction', key: 'stage-lone', mode: 'persuade', sourceCompositions: onlyMarginal });
    assert.equal(fallback.some(pick => pick.id === 'lone-marginal-stage'), true);
  });

  it('gates compositions by breadth and falls back when every composition is niche', () => {
    const pool = [
      { id: 'broad-stage', surface: 'persuade', status: 'approved' },
      { id: 'niche-stage', surface: 'persuade', status: 'approved', review: { breadth: 'niche' } },
    ];
    for (let index = 0; index < 60; index += 1) {
      const picks = selectApprovedCompositions({ scope: 'direction', key: `stage-breadth-${index}`, mode: 'persuade', sourceCompositions: pool });
      assert.equal(picks.some(pick => pick.id === 'niche-stage'), false, `niche composition dealt at key stage-breadth-${index}`);
    }
    const allNiche = [
      { id: 'only-niche-stage', surface: 'persuade', status: 'approved', review: { breadth: 'niche' } },
    ];
    const fallback = selectApprovedCompositions({ scope: 'direction', key: 'all-niche', mode: 'persuade', sourceCompositions: allNiche });
    assert.equal(fallback.some(pick => pick.id === 'only-niche-stage'), true, 'an all-niche pool must fall back instead of dealing nothing');
  });

  it('mode-filters the fixture composition pool per surface register', () => {
    const operate = selectApprovedComposition({ scope: 'surface', key: 'fix-mode', mode: 'operate', sourceCompositions: fixtureCompositions });
    assert.equal(operate.surface, 'operate');
    const experience = selectApprovedComposition({ scope: 'surface', key: 'fix-mode', mode: 'experience', sourceCompositions: fixtureCompositions });
    assert.equal(experience.surface, 'experience');
  });

  it('renders the vivid spark before system and browser leverage', () => {
    const output = renderChallenger({
      form: 'a spiral galaxy, where gravity, orbit, density, and darkness organize attention across radical scales',
      spark: 'A brilliant core holds the central promise while related ideas travel through spiral arms and distant fragments wait at the edge of perception.',
      system: [
        'Palette/material: deep space black, star-white points, and one warm core glow reserved for the focus',
        'Type/composition: hairline astronomical labels orbiting a monumental numeral voice',
        'Topology/navigation: orbit a stable core and travel by arm or scale',
        'Controls/state: focus, compare, capture, and release orbiting material',
        'Responsive/motion: collapse depth into a radial sequence with orientation kept',
      ],
      webLeverage: 'WebGL semantic zoom with a complete keyboard-readable DOM index',
    }, 0);
    assert.match(output, /spiral galaxy/);
    assert.match(output, /CREATIVE SPARK: A brilliant core/);
    assert.equal(output.indexOf('CREATIVE SPARK:') < output.indexOf('SYSTEM GRAMMAR:'), true);
  });
});

describe('init gate', () => {
  const gateRun = (cwd) => spawnSync(process.execPath, [SCRIPT, '--scope', 'direction', '--from', 'gate-test'], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, IMPECCABLE_CATALOG_DIR: FIXTURE_DIR, IMPECCABLE_CONTEXT_DIR: '' },
  });

  it('refuses to deal when no PRODUCT.md exists and routes to init', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'concept-seed-noproduct-'));
    const result = gateRun(dir);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /NO_PRODUCT_MD/);
    assert.match(result.stdout, /init/);
    assert.doesNotMatch(result.stdout, /ASSIGNED INDEX/);
  });

  it('deals normally once PRODUCT.md exists', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'concept-seed-product-'));
    writeFileSync(path.join(dir, 'PRODUCT.md'), '# Test Product\n\n## Register\n\nbrand\n');
    const result = gateRun(dir);
    assert.equal(result.status, 0);
    assert.doesNotMatch(result.stdout, /NO_PRODUCT_MD/);
  });

  it('never gates the choice ping', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'concept-seed-ping-'));
    const result = spawnSync(process.execPath, [SCRIPT, '--chosen', 'assigned', '--from', 'gate-test'], {
      cwd: dir,
      encoding: 'utf-8',
      env: { ...process.env, IMPECCABLE_CATALOG_DIR: FIXTURE_DIR, IMPECCABLE_NO_TELEMETRY: '1' },
    });
    assert.equal(result.status, 0);
    assert.doesNotMatch(result.stdout, /NO_PRODUCT_MD/);
  });

  // Mode eligibility on worlds. Before this, selectApprovedChallengers never
  // received the mode at all, so a build asking for an app UI could draw six
  // worlds that only make sense on a landing page.
  it('keeps worlds out of modes their reviewer excluded, and treats absent as all modes', () => {
    const make = (id, tier, allowedModes) => ({
      id,
      familyId: `${id}-family`,
      wellTier: tier,
      strength: 'world',
      status: 'approved',
      form: `${id} form`,
      spark: `${id} spark`,
      system: [],
      webLeverage: `${id} web`,
      review: { status: 'approved', ...(allowedModes ? { allowedModes } : {}) },
    });
    const pool = [
      make('persuade-only', 'graphic', ['persuade']),
      make('anywhere', 'graphic'),
      make('operate-capable', 'graphic', ['operate', 'read']),
      make('radar', 'interaction'),
      make('cavern', 'atmosphere'),
    ];

    for (let index = 0; index < 25; index += 1) {
      const operate = selectApprovedChallengers({
        scope: 'direction', key: `mode-gate-${index}`, mode: 'operate', sourceConcepts: pool,
      }).picks.map(pick => pick.id);
      assert.equal(operate.includes('persuade-only'), false, `persuade-only dealt for operate at ${index}`);
    }

    // Absent allowedModes stays eligible in every mode.
    const seen = new Set();
    for (let index = 0; index < 25; index += 1) {
      for (const mode of ['persuade', 'operate', 'read', 'experience']) {
        for (const pick of selectApprovedChallengers({
          scope: 'direction', key: `mode-any-${index}`, mode, sourceConcepts: pool,
        }).picks) seen.add(pick.id);
      }
    }
    assert.equal(seen.has('anywhere'), true, 'a world with no allowedModes must stay eligible');
  });

  it('falls back rather than starving a tier whose every world excludes the mode', () => {
    const make = (id, tier, allowedModes) => ({
      id,
      familyId: `${id}-family`,
      wellTier: tier,
      strength: 'world',
      status: 'approved',
      form: `${id} form`,
      spark: `${id} spark`,
      system: [],
      webLeverage: `${id} web`,
      review: { status: 'approved', ...(allowedModes ? { allowedModes } : {}) },
    });
    // The whole interaction tier is persuade-only. Selection must degrade to it
    // rather than throw or deal fewer than six.
    const pool = [
      make('graphic-any', 'graphic'),
      make('graphic-two', 'graphic'),
      make('radar-persuade', 'interaction', ['persuade']),
      make('cavern-any', 'atmosphere'),
    ];
    const picks = selectApprovedChallengers({
      scope: 'direction', key: 'starve', mode: 'operate', sourceConcepts: pool,
    }).picks;
    assert.equal(picks.some(pick => pick.id === 'radar-persuade'), true, 'an emptied tier must fall back to its full pool');
  });

  // Grain: how much of the product a composition composes. Framed by what the
  // skill can be asked for (a docs site, an onboarding flow, a landing page, a
  // data table) rather than by what the catalog happens to hold.
  it('prefers the requested grain and tops up from the register', () => {
    const make = (id, grain) => ({
      id, familyId: `${id}-family`, surface: 'operate', status: 'approved',
      ...(grain ? { grain } : {}), review: { status: 'approved' },
    });
    const pool = [
      make('flow-one', 'flow'),
      make('flow-two', 'flow'),
      make('view-one', 'view'),
      make('view-two', 'view'),
      make('untagged', null),
    ];
    const dealt = dealCompositions({ scope: 'surface', key: 'grain-pref', mode: 'operate', grain: 'flow', sourceCompositions: pool });
    assert.equal(dealt.picks.length, 3, 'a thin grain tops up rather than dealing fewer');
    const ids = dealt.picks.map(pick => pick.id);
    assert.equal(ids.includes('flow-one') && ids.includes('flow-two'), true, 'both grain matches deal first');
    assert.equal(dealt.match.atGrain, 2);
    assert.equal(dealt.match.grainAvailable, 2);
  });

  // The report is the point. Three plausible view-grain compositions dealt
  // against a flow request, with no signal that none matched, is the same silent
  // plausibility this axis exists to remove.
  it('reports a grain miss instead of passing off borrowed structure', () => {
    const make = id => ({ id, familyId: `${id}-family`, surface: 'operate', status: 'approved', grain: 'view', review: { status: 'approved' } });
    const pool = [make('a'), make('b'), make('c')];
    const dealt = dealCompositions({ scope: 'surface', key: 'grain-miss', mode: 'operate', grain: 'flow', sourceCompositions: pool });
    assert.equal(dealt.picks.length, 3, 'still deals three');
    assert.equal(dealt.match.atGrain, 0, 'and says none matched');
    assert.equal(dealt.match.grainAvailable, 0);
  });

  // Platform is a hard filter, not a preference: a composition that needs hover
  // does not degrade on a phone, it stops working.
  it('excludes compositions the platform cannot carry, with no fallback', () => {
    const make = (id, platforms) => ({
      id, familyId: `${id}-family`, surface: 'operate', status: 'approved',
      ...(platforms ? { platforms } : {}), review: { status: 'approved' },
    });
    const pool = [make('web-only', ['web']), make('anywhere', null), make('native', ['ios', 'android'])];
    const onIos = dealCompositions({ scope: 'surface', key: 'plat', mode: 'operate', platform: 'ios', sourceCompositions: pool });
    const ids = onIos.picks.map(pick => pick.id);
    assert.equal(ids.includes('web-only'), false, 'a web-only composition must not reach an iOS build');
    assert.equal(onIos.match.platformExcluded, 1);

    const allWebOnly = [make('x', ['web']), make('y', ['web'])];
    const starved = dealCompositions({ scope: 'surface', key: 'plat2', mode: 'operate', platform: 'android', sourceCompositions: allWebOnly });
    assert.deepEqual(starved.picks, [], 'an empty deal beats dealing something that cannot work');
  });

  it('reproduces a grain-scoped deal from the same key', () => {
    const make = (id, grain) => ({
      id, familyId: `${id}-family`, surface: 'read', status: 'approved',
      ...(grain ? { grain } : {}), review: { status: 'approved' },
    });
    const pool = [make('p1', 'product'), make('v1', 'view'), make('v2', 'view'), make('r1', 'region')];
    const args = { scope: 'surface', key: 'grain-stable', mode: 'read', grain: 'product', sourceCompositions: pool };
    assert.deepEqual(
      selectApprovedCompositions(args).map(p => p.id),
      selectApprovedCompositions(args).map(p => p.id)
    );
  });
});

// The Windows abort in issue #504 (nodejs/node#56645) needs three things at
// once: a successful roll over Node's undici-backed fetch, the keep-alive
// socket that success leaves pooled, and the explicit process.exit at the end
// of the CLI. The suite's other API test exercises only the unreachable-API
// fallback, which leaves no pooled socket and so never walked the crashing
// path. This one serves a real roll from a local server and asserts the CLI
// destroys fetch's global dispatcher before exiting, so the teardown cannot
// silently regress. The teardown is Node fetch internals, so the CLI is
// spawned with node even when the suite itself runs under bun.
describe('API roll path', () => {
  const NODE = process.versions.bun ? 'node' : process.execPath;

  const ROLL_PAYLOAD = {
    poolRevision: 'api-test-rev',
    approvedCount: 6,
    catalogCount: 9,
    challengers: [{
      id: 'api-test-world',
      form: 'a letterpress print shop, where type, ink, and impression organize the page',
      spark: 'Deep impressions hold the central promise while loose sorts wait in the case.',
      system: ['Palette/material: dense ink black bitten into soft cotton paper'],
      webLeverage: 'Variable-font impression depth with a keyboard-readable page structure',
    }],
    compositions: [],
  };

  // Wraps the global dispatcher's destroy so the parent test can observe the
  // CLI's exit teardown. The warmup fetch makes fetch install the dispatcher
  // before the wrap, and parks a keep-alive socket in its pool, which is the
  // exact state the Windows crash needs at exit.
  const PRELOAD = [
    "const KEY = Symbol.for('undici.globalDispatcher.1');",
    'await fetch(`${process.env.IMPECCABLE_API_URL}/warmup`).then(r => r.arrayBuffer()).catch(() => {});',
    'const dispatcher = globalThis[KEY];',
    "if (dispatcher && typeof dispatcher.destroy === 'function') {",
    '  const destroy = dispatcher.destroy.bind(dispatcher);',
    '  dispatcher.destroy = (...args) => {',
    "    process.stderr.write('DISPATCHER_DESTROY_CALLED\\n');",
    '    return destroy(...args);',
    '  };',
    '}',
    '',
  ].join('\n');

  it('resolves a successful roll and destroys the fetch dispatcher before the explicit exit', async () => {
    const requests = [];
    const server = createServer((req, res) => {
      requests.push(req.url);
      if (req.url.startsWith('/api/roll?')) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(ROLL_PAYLOAD));
        return;
      }
      res.statusCode = 404;
      res.end('not found');
    });
    await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
    try {
      const dir = mkdtempSync(path.join(tmpdir(), 'concept-seed-api-'));
      writeFileSync(path.join(dir, 'PRODUCT.md'), '# Test Product\n\n## Platform\n\nweb\n');
      const preloadPath = path.join(dir, 'wrap-dispatcher.mjs');
      writeFileSync(preloadPath, PRELOAD);
      const result = await new Promise((resolveRun, rejectRun) => {
        const child = spawn(NODE, [
          '--import', pathToFileURL(preloadPath).href,
          SCRIPT, '--scope', 'direction', '--mode', 'persuade', '--from', 'api-test',
        ], {
          cwd: dir,
          env: {
            ...process.env,
            IMPECCABLE_CATALOG_DIR: '/nonexistent-catalog-dir',
            IMPECCABLE_API_URL: `http://127.0.0.1:${server.address().port}/api`,
          },
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', chunk => { stdout += chunk; });
        child.stderr.on('data', chunk => { stderr += chunk; });
        child.on('error', rejectRun);
        child.on('close', status => resolveRun({ status, stdout, stderr }));
      });
      assert.equal(result.status, 0, `stderr: ${result.stderr}`);
      assert.equal(requests.some(url => url.startsWith('/api/roll?')), true, 'the CLI must hit the roll endpoint');
      assert.match(result.stdout, /source: api/);
      assert.match(result.stdout, /letterpress print shop/);
      assert.match(result.stdout, /TELEMETRY:/);
      assert.match(result.stderr, /DISPATCHER_DESTROY_CALLED/, 'the dispatcher must be destroyed before process.exit');
    } finally {
      server.close();
    }
  });
});
