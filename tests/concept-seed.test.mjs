import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readConceptCatalog,
  validateConceptCatalog,
  validateConceptEntry,
} from '../skill/scripts/lib/concept-catalog.mjs';
import { readCompositionCatalog } from '../skill/scripts/lib/composition-catalog.mjs';
import { renderChallenger, selectApprovedChallengers, selectApprovedStaging, selectApprovedStagings } from '../skill/scripts/concept-seed.mjs';

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

  it('keeps staging challengers inside the requested surface mode', () => {
    const pool = [
      { id: 'persuade-stage', surface: 'persuade', status: 'approved' },
      { id: 'experience-stage', surface: 'experience', status: 'approved' },
    ];
    const experience = selectApprovedStaging({
      scope: 'direction',
      key: 'mode-match',
      mode: 'experience',
      sourceCompositions: pool,
    });
    const read = selectApprovedStaging({
      scope: 'direction',
      key: 'mode-missing',
      mode: 'read',
      sourceCompositions: pool,
    });
    assert.equal(experience?.id, 'experience-stage');
    assert.equal(read, null, 'a missing mode must not borrow an unrelated staging');

    const rendered = run('direction', ['--mode', 'experience']);
    assert.equal(rendered.status, 0);
    assert.match(rendered.stdout, /mode: experience/);
    assert.match(rendered.stdout, /--scope direction --mode experience --from stable-test/);
    assert.match(rendered.stdout, /FIRST-SURFACE STAGING/);
  });

  it('draws several staging inputs from distinct families when the approved pool allows it', () => {
    const pool = [
      { id: 'a', familyId: 'first', surface: 'persuade', status: 'approved' },
      { id: 'b', familyId: 'scroll', surface: 'persuade', status: 'approved' },
      { id: 'c', familyId: 'physics', surface: 'persuade', status: 'approved' },
      { id: 'd', familyId: 'first', surface: 'persuade', status: 'approved' },
      { id: 'e', familyId: 'other', surface: 'operate', status: 'approved' },
    ];
    const picks = selectApprovedStagings({ scope: 'direction', key: 'several', mode: 'persuade', sourceCompositions: pool });
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
    assert.equal(counts.marginal, 0);
    // Two tickets should put the flagship on top roughly twice as often as an
    // unrated peer; a generous margin keeps the assertion deterministic-safe.
    assert.equal(counts.flagship > counts['solid-b'] * 1.3, true,
      `flagship ${counts.flagship} vs solid-b ${counts['solid-b']}`);

    // A tier holding only 1-star approvals still yields challengers.
    const onlyMarginal = [
      make('lone-marginal', 1),
      filler('interaction', 'radar2'),
      filler('atmosphere', 'cavern2'),
    ];
    const { picks } = selectApprovedChallengers({ scope: 'direction', key: 'lone', sourceConcepts: onlyMarginal });
    assert.equal(picks.some(pick => pick.id === 'lone-marginal'), true);
  });

  it('mode-filters the fixture staging pool per surface register', () => {
    const operate = selectApprovedStaging({ scope: 'surface', key: 'fix-mode', mode: 'operate', sourceCompositions: fixtureCompositions });
    assert.equal(operate.surface, 'operate');
    const experience = selectApprovedStaging({ scope: 'surface', key: 'fix-mode', mode: 'experience', sourceCompositions: fixtureCompositions });
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
});
