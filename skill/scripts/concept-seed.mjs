#!/usr/bin/env node
/**
 * External concept seed: the dice half of new-work's complete-direction and
 * established-world surface procedures.
 *
 * Before this script runs, the model retrieves cultural material and derives
 * a grounded shortlist of complete candidate directions from it (see
 * reference/new-work.md). Left alone, it then always builds its #1 —
 * and a single model's resonance ranking is deterministic, so every run
 * in a category ships the same one or two concepts. Measured: 30/35
 * identical concepts across 16 prompt framings; the model cannot roll
 * its own dice.
 *
 * This script rolls them from outside, the same trick that made the
 * palette seed work:
 *   - ASSIGNED INDEX: which entry of the model's own resonance-ordered
 *     shortlist gets built. The assignment is the dice: it never chooses an
 *     ungrounded ingredient, it only refuses the argmax rut. Attended runs
 *     present the assigned direction and offer re-roll instead of a ranked
 *     lineup, because a lineup hands selection back to a taste function
 *     (model or user) and taste functions pick the safest card.
 *   - CHALLENGERS (6): outside forms from concept-ingredients.json, two from
 *     each challenger tier (graphic system, instrument language, atmosphere
 *     world), fused with the product first (challenger supplies form and
 *     system grammar, product supplies every fact, clarity wins conflicts),
 *     then weighed against the derived candidates on audience identification
 *     and product clarity. They win only when they beat the grounded list;
 *     measured behavior is that they lose to strong cultural material and
 *     win over thin categories, which is the intended shape.
 *   - RE-ROLL (--reroll <n>): round n of the same base key. The script
 *     recomputes what rounds 0..n-1 drew, excludes all of it, and rolls a
 *     fresh assigned index, challengers, and compositions. One base key therefore
 *     reproduces the entire chain of rounds.
 *   - RATINGS: the reviewer's approval ratings weight the challenger draw
 *     (3-star doubles the odds, 1-star sits out); the approved pool itself
 *     is unchanged.
 *
 * Usage:
 *   node scripts/concept-seed.mjs --scope direction --mode persuade
 *   node scripts/concept-seed.mjs --scope surface --mode operate --from <key>
 *   node scripts/concept-seed.mjs --scope surface --mode operate --grain flow
 *   node scripts/concept-seed.mjs --scope direction --candidate-count 6
 *   node scripts/concept-seed.mjs --scope direction --mode persuade --from <key> --reroll 1
 *   node scripts/concept-seed.mjs --chosen <challenger-id> --from <key> --scope direction
 *
 * --grain names how much of the product is in play: product, flow, view, or
 * region. A docs site, an onboarding flow, a landing page and a data table are
 * four different amounts of product and want different compositions. Grain is a
 * preference: it deals matching compositions first and tops up from the rest of
 * the register, and the rendered seed says how many actually matched so a
 * borrowed structure is never mistaken for a supplied one.
 *
 * --platform names the delivery target (web, ios, android). Unlike grain this is
 * a hard filter: a composition that needs hover or a pointer does not degrade on
 * a phone, it stops working. --mode also gates which worlds are eligible, for
 * worlds whose reviewer marked them as carrying only some modes.
 *
 * --mode names the requested surface's mode (persuade, operate, read,
 * experience) so the appended compositions match its register of work; omitted,
 * they roll from the full approved pool.
 *
 * Challenger data resolves in order: a local catalog directory (the private
 * service repo, evals, and tests set IMPECCABLE_CATALOG_DIR), then the roll
 * API at impeccable.style, then a degraded assignment-only seed when both are
 * unavailable. --chosen sends the anonymous choice ping for API-dealt rolls;
 * DO_NOT_TRACK or IMPECCABLE_NO_TELEMETRY disables it.
 *
 * Env vars:
 *   IMPECCABLE_CONCEPT_SEED — same as --from; for reproducible eval runs.
 *   IMPECCABLE_CATALOG_DIR  — directory holding the four catalog JSON files.
 *   IMPECCABLE_API_URL      — roll API base (default https://impeccable.style/api).
 *   IMPECCABLE_NO_TELEMETRY — disables the choice ping (DO_NOT_TRACK also honored).
 */

import crypto from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  approvedPoolRevision,
  readConceptCatalog,
  validateConceptCatalog,
  WELL_TIERS,
} from './lib/concept-catalog.mjs';
import { readCompositionCatalog } from './lib/composition-catalog.mjs';
import {
  COMPOSITION_GRAINS,
  COMPOSITION_PLATFORMS,
  runSyncSelection,
  selectApprovedChallengers as selectApprovedChallengersCore,
  selectApprovedCompositions as selectApprovedCompositionsCore,
} from './lib/roll-selection.mjs';

const here = dirname(fileURLToPath(import.meta.url));

// Data resolution order: a local catalog (the private service repo, evals, and
// tests point IMPECCABLE_CATALOG_DIR at one), then the roll API, then a
// degraded assignment-only seed. The full catalog does not ship with the skill.
const CATALOG_DIR = process.env.IMPECCABLE_CATALOG_DIR || here;
const API_BASE = (process.env.IMPECCABLE_API_URL || 'https://impeccable.style/api').replace(/\/$/, '');
const API_TIMEOUT_MS = Number(process.env.IMPECCABLE_API_TIMEOUT || 4000);
// All API calls in one seed run share a single deadline so an unreachable
// network degrades after one timeout total, never one timeout per call.
let apiDeadline = null;
function apiBudgetMs() {
  if (apiDeadline === null) apiDeadline = Date.now() + API_TIMEOUT_MS;
  return Math.max(0, apiDeadline - Date.now());
}

const localStates = new Map();
function loadLocal(catalogDir = CATALOG_DIR) {
  if (localStates.has(catalogDir)) return localStates.get(catalogDir);
  let localState;
  try {
    const catalogState = readConceptCatalog(
      join(catalogDir, 'concept-ingredients.json'),
      join(catalogDir, 'concept-reviews.json')
    );
    const validation = validateConceptCatalog(catalogState.catalog, catalogState.reviewData);
    if (validation.errors.length > 0) {
      throw new Error(`invalid catalog: ${validation.errors.join('; ')}`);
    }
    const compositionState = readCompositionCatalog(
      join(catalogDir, 'composition-ingredients.json'),
      join(catalogDir, 'composition-reviews.json')
    );
    localState = {
      concepts: catalogState.concepts,
      compositions: compositionState.compositions,
    };
  } catch {
    localState = null;
  }
  localStates.set(catalogDir, localState);
  return localState;
}

function requireLocalConcepts() {
  const local = loadLocal();
  if (!local) {
    throw new Error('concept-seed: no local catalog (set IMPECCABLE_CATALOG_DIR or pass sourceConcepts)');
  }
  return local;
}

async function fetchRoll({ scope, key, mode, grain, platform, reroll }) {
  const params = new URLSearchParams({ scope, key, reroll: String(reroll) });
  if (mode) params.set('mode', mode);
  if (grain) params.set('grain', grain);
  if (platform) params.set('platform', platform);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), apiBudgetMs());
  try {
    // Race the budget explicitly: abort signals do not reliably cancel the
    // TCP connect phase, so a blackholed route would otherwise stall ~10s.
    const response = await Promise.race([
      fetch(`${API_BASE}/roll?${params}`, { signal: controller.signal }),
      new Promise(resolveTimeout => setTimeout(() => resolveTimeout(null), apiBudgetMs())),
    ]);
    if (!response) return null;
    if (!response.ok) return null;
    const roll = await response.json();
    if (!Array.isArray(roll.challengers) || roll.challengers.length === 0) return null;
    return roll;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function telemetryDisabled() {
  return Boolean(process.env.IMPECCABLE_NO_TELEMETRY || process.env.DO_NOT_TRACK);
}

// Anonymous choice ping: records only that a dealt world was selected.
// Fire-and-forget; never fails the caller.
export async function pingChosen({ chosenId, key, scope, mode }) {
  if (telemetryDisabled() || !chosenId) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), apiBudgetMs());
  try {
    await fetch(`${API_BASE}/chosen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chosenId, key, scope, mode }),
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const CARD_BASE = process.env.IMPECCABLE_CARD_BASE || 'https://impeccable.style/worlds/cards';

export function renderChallenger(concept, index) {
  const system = concept.system.map(rule => `       - ${rule}`).join('\n');
  const board = concept.cardBoard || `${CARD_BASE}/${concept.id}.webp`;
  const hero = concept.cardHero || `${CARD_BASE}/${concept.id}-hero.webp`;
  return `  ${index + 1}. ${concept.form}
     SOURCE ID: ${concept.id}
     CREATIVE SPARK: ${concept.spark}
     SYSTEM GRAMMAR:
${system}
     WEB LEVERAGE: ${concept.webLeverage}
     QUALITY BAR: board ${board} · hero ${hero}`;
}

export function renderComposition(composition, index = null) {
  const grammar = composition.grammar.map(rule => `       - ${rule}`).join('\n');
  return `  ${index == null ? '' : `${index + 1}. `}${composition.form}
     SOURCE ID: ${composition.id}
     SPARK: ${composition.spark}
     COMPOSITION GRAMMAR:
${grammar}
     WEB LEVERAGE: ${composition.webLeverage}`;
}

// Selection itself lives in lib/roll-selection.mjs so this script and the roll
// API run one algorithm rather than two that drifted. These wrappers add only
// what is local to the skill: resolving the catalog when no pool is passed, and
// driving the generator with Node's synchronous hash, which keeps a local render
// synchronous for prepared eval sessions and tests.
function driveSelection(generator) {
  return runSyncSelection(generator, input => crypto.createHash('sha256').update(input).digest('hex'));
}

export function dealCompositions({ scope, key, reroll = 0, mode = null, grain = null, platform = null, sourceCompositions = null, count = 3 }) {
  const compositions = sourceCompositions ?? requireLocalConcepts().compositions;
  return driveSelection(selectApprovedCompositionsCore({ scope, key, reroll, mode, grain, platform, compositions, count }));
}

// Array-returning form, which is what every caller wanted before the match
// report existed.
export function selectApprovedCompositions(options) {
  return dealCompositions(options).picks;
}

// Compatibility for callers that need a single smoke-test sample.
export function selectApprovedComposition(options) {
  return selectApprovedCompositions({ ...options, count: 1 })[0] ?? null;
}

export function selectApprovedChallengers({ scope, key, reroll = 0, mode = null, sourceConcepts = null }) {
  const source = sourceConcepts ?? requireLocalConcepts().concepts;
  const { approved, picks } = driveSelection(selectApprovedChallengersCore({ scope, key, reroll, mode, concepts: source }));
  return {
    approved,
    picks,
    poolRevision: approvedPoolRevision(source),
    catalogCount: source.length,
  };
}

const SEED_MODES = new Set(['persuade', 'operate', 'read', 'experience']);

export function renderConceptSeed({
  scope = 'surface',
  key = process.env.IMPECCABLE_CONCEPT_SEED || crypto.randomBytes(4).toString('hex'),
  reroll = 0,
  mode = null,
  grain = null,
  platform = null,
  candidateCount = 7,
  catalogDir = CATALOG_DIR,
  _resolvedData = undefined,
} = {}) {
  if (scope !== 'surface' && scope !== 'direction') {
    throw new Error('concept-seed: --scope must be direction or surface');
  }
  if (!Number.isInteger(reroll) || reroll < 0) {
    throw new Error('concept-seed: --reroll must be a non-negative integer');
  }
  if (mode !== null && !SEED_MODES.has(mode)) {
    throw new Error('concept-seed: --mode must be persuade, operate, read, or experience');
  }
  // Grain needs no mode: how much of the product is in play is independent of
  // which register of work it is.
  if (grain !== null && !COMPOSITION_GRAINS.includes(grain)) {
    throw new Error(`concept-seed: --grain must be one of ${COMPOSITION_GRAINS.join(', ')}`);
  }
  if (platform !== null && !COMPOSITION_PLATFORMS.includes(platform)) {
    throw new Error(`concept-seed: --platform must be one of ${COMPOSITION_PLATFORMS.join(', ')}`);
  }
  if (!Number.isInteger(candidateCount) || candidateCount < 5 || candidateCount > 7) {
    throw new Error('concept-seed: --candidate-count must be an integer from 5 to 7');
  }
  const unit = (salt) => {
    const h = crypto.createHash('sha256').update(`${scope}:${salt}:${key}`).digest();
    return h.readUInt32BE(0) / 0xffffffff;
  };
  const indexSalt = reroll === 0 ? 'index' : `index:reroll-${reroll}`;
  const buildIndex = 3 + Math.floor(unit(indexSalt) * (candidateCount - 2)); // 3..candidateCount

  // Local catalog first (private repo, evals, tests), then the roll API,
  // then a degraded assignment-only seed. The assigned index is pure local
  // math, so even a fully offline run keeps the anti-argmax mechanism.
  let data = _resolvedData ?? null;
  if (_resolvedData === undefined) {
    const local = loadLocal(catalogDir);
    if (local) {
      const { approved, picks, poolRevision, catalogCount } = selectApprovedChallengers({
        scope,
        key,
        reroll,
        mode,
        sourceConcepts: local.concepts,
      });
      data = {
        source: 'local',
        poolRevision,
        approvedCount: approved.length,
        catalogCount,
        challengers: picks,
        ...(() => {
          const dealt = dealCompositions({ scope, key, reroll, mode, grain, platform, sourceCompositions: local.compositions });
          return { compositions: dealt.picks, compositionMatch: dealt.match };
        })(),
      };
    } else {
      // Keep local renders synchronous for prepared eval sessions and tests;
      // installed skills without a bundled catalog resolve through the API.
      return fetchRoll({ scope, key, mode, grain, platform, reroll }).then(roll => renderConceptSeed({
        scope,
        key,
        reroll,
        mode,
        grain,
        platform,
        candidateCount,
        catalogDir,
        _resolvedData: roll ? {
          source: 'api',
          poolRevision: roll.poolRevision,
          approvedCount: roll.approvedCount,
          catalogCount: roll.catalogCount,
          challengers: roll.challengers,
          compositions: Array.isArray(roll.compositions)
            ? roll.compositions
            : Array.isArray(roll.stagings)
              ? roll.stagings
              : roll.staging ? [roll.staging] : [],
        } : null,
      }));
    }
  }

  const promotedInstruction = scope === 'direction'
    ? `After ordering the grounded directions by resonance, build candidate
  ${buildIndex} of your own grounded list; the assignment never points at a
  challenger. The assignment is the roll, not a suggestion: your top-ranked
  direction is what every run would ship, so the script decides which grounded
  direction gets built. Each direction joins a durable visual system to a
  concrete expression for the requested first surface, decided as one. It must
  survive the current task plus navigation, quiet and dense content,
  interaction and state, and a substantially different future surface. In an
  attended run, present the assigned direction fully committed and offer
  re-roll. You may add ONE card for your top-ranked grounded candidate when
  it is not the assigned direction, kicker MY PICK, with an honest risk line
  naming its familiarity; one pick card, never a ranked lineup, and the pick
  never takes the lead position. When the assignment IS your top candidate,
  there is no pick card. Re-roll yourself only
  on named factual grounds, when the assignment cannot carry the product's
  truth or task; taste is never grounds.`
  : `After ordering the task's grounded structural candidates by resonance,
  build candidate ${buildIndex} of your own grounded list; the assignment never
  points at a challenger. The assignment is the roll, not a suggestion.
  In an attended run, present the assigned structure and offer re-roll; never
  present a ranked lineup to choose from. Re-roll yourself only when the
  assignment fails audience identification or product clarity on named
  factual grounds.`;

  const challengerInstruction = scope === 'direction'
    ? `Fuse each challenger before judging it: the challenger supplies the form
  and its system grammar, the product supplies every fact, and clarity wins
  conflicts. Weigh the fused result against the assigned direction on exactly
  two axes, audience identification and product clarity. Losing to strong
  grounded material is a valid outcome; beating a thin or tool-monoculture
  list is the point. A fused challenger that wins both axes becomes the build.
  Close the weighing with a verdict per challenger, decided before any
  borrowing is considered: wins (beats the assigned direction on both axes),
  competitive (holds one axis), or declined (loses both). A declined
  challenger is not spent: name the one discipline of its system the assigned
  direction lacks, and raise the assigned direction to match before
  presenting it. A donation transfers ambition and system discipline, never
  the challenger's clothes; one world owns the page. Write each raise as its
  own named line on the presented direction, and carry every verdict, kept
  line, and raise into the decision page payload.`
  : `A challenger wins only when its fused result beats the grounded list on
  audience identification and product clarity. It may change task topology or
  interaction, but never the committed visual identity.`;

  const authorityInstruction = scope === 'direction'
    ? `PRODUCT.md and explicit incumbent brand commitments constrain every direction.
The seed never chooses exact colors, fonts, tokens, or a user preference, and
it never permits the world and first surface to be selected independently.`
  : `PRODUCT.md and DESIGN.md constrain every surface candidate's identity
vocabulary; they do not cancel task-level composition. The seed never
authorizes a new palette, type system, material world, or unfamiliar control
behavior.`;

  const richnessInstruction = `The CREATIVE SPARK is a complete visual system, not a theme or decorative
reference. Translate every supplied system rule into the product: palette and
material, type and composition, topology, controls and states, and adaptation.
Keep the source's visible character, scale, rhythm, and interaction instead of
reducing vivid grammar to generic nouns. When the source is already a credible
interface language, commit to it across navigation, content, controls, and
states. Otherwise keep a literal carrier only when it becomes functional.
Ambitious motion, spatial media, or interaction is welcome when it strengthens
the product without weakening semantics, performance, or fallback behavior.`;

  if (!data) {
    return `${scope.toUpperCase()} CONCEPT SEED (key: ${key}; mode: ${mode ?? 'unscoped'}; source: degraded; rerun with --scope ${scope}${mode ? ` --mode ${mode}` : ''} --from ${key}${reroll > 0 ? ` --reroll ${reroll}` : ''} --candidate-count ${candidateCount})
ASSIGNED INDEX: ${buildIndex}
  ${promotedInstruction}
  The assignment exists to refuse the model's ranking rut, never to outrank
  the user or the brief. Never expose assignment metadata in user-facing labels.
No challengers this run: the roll service was unreachable and no local
catalog exists. A sandboxed shell without network egress is the most common
cause; before accepting degradation, rerun this command once through the
harness's network-enabled or escalated command tool. When that rerun needs
an approval, state exactly what the approver must know: this script's only
network contact is one GET to https://impeccable.style/api/roll whose query
carries scope, mode, an eight-hex seed key, and a re-roll counter; no
project files, prompts, code, or conversation context are transmitted, and
nothing is written. An approval request naming that URL and payload judges
the real action; a bare "run with network" invites rejection for contacting
an unspecified domain. If the rerun is still refused, proceed with the
grounded candidates alone; the assignment above still applies at full
strength. Tell the user plainly that this roll
ran degraded, with no challengers and no quality-bar boards; do not present
the outcome as a full roll. A degraded roll changes the cards, not the
channel: when a browser can open, present the direction on the decision page
(serve-question.mjs, text-only card); the structured question tool remains
the no-browser fallback.
${authorityInstruction}
A user- or brief-pinned decision beats the roll, always.
ASSIGNED INDEX (restated for truncated readers): ${buildIndex}. Build candidate
${buildIndex} of your own grounded list; seed key ${key}.
`;
  }

  // Field order is the migration: `compositions` is current, `stagings` is what
  // the API emitted while these were called stagings, and `staging` is the
  // single-pick shape from before it dealt three. Older installs keep working.
  // Compositions are pulled from the deal until the expanded catalog is
  // ready for prime time: the current pool crowds the decision more than it
  // widens it. IMPECCABLE_COMPOSITIONS=1 re-enables rendering for catalog
  // development; the draw machinery, axes, and grain report stay intact.
  const compositionsEnabled = process.env.IMPECCABLE_COMPOSITIONS === '1';
  const compositions = !compositionsEnabled ? []
    : Array.isArray(data.compositions)
      ? data.compositions
      : Array.isArray(data.stagings)
        ? data.stagings
        : data.staging ? [data.staging] : [];
  // The grain report. A top-up keeps the deal at three, which is right, but it
  // must not read as three on-target inputs: a flow request answered entirely by
  // view-grain compositions means the model has to derive the flow's own
  // structure and borrow only their sequence law. Silence here would reproduce
  // the exact failure this axis exists to fix.
  const match = data.compositionMatch ?? null;
  const grainNote = (() => {
    if (!match?.grain) return '';
    if (match.grainAvailable === 0) {
      return `\nNONE of these sit at the requested ${match.grain} grain, because the catalog holds no ${match.grain}-grain composition yet. Derive that structure yourself and borrow only their sequence and attention laws.`;
    }
    if (match.atGrain === 0) {
      return `\nNONE of these sit at the requested ${match.grain} grain, though ${match.grainAvailable} exist; these were topped up from the rest of the register. Treat their structure as borrowed.`;
    }
    if (match.atGrain < compositions.length) {
      return `\n${match.atGrain} of ${compositions.length} sit at the requested ${match.grain} grain; the rest were topped up from the register and their structure is borrowed.`;
    }
    return '';
  })();
  const compositionBlock = compositions.length > 0
    ? `\n${scope === 'direction' ? 'FIRST-SURFACE COMPOSITION INPUTS (identity-free; test them with shortlisted worlds and keep world plus composition one decision):' : 'COMPOSITION CHALLENGERS (identity-free; dress them in the committed visual identity before judging):'}
${compositions.map((composition, index) => renderComposition(composition, index)).join('\n')}
Each one asks the same question of this build: what is the cleverest way to
present, organize, or make interactive the problem in front of you? They carry
structure only, never a palette, typeface, or material. Treat them as serious
rivals to your habitual layout, and keep only what makes this product clearer.${grainNote}\n`
    : '';
  const rerollBlock = reroll > 0
    ? `RE-ROLL ROUND ${reroll}: every candidate presented in earlier rounds, grounded
  and challenger alike, is eliminated and may not return reworded. Derive
  genuinely new grounded candidates from unexplored angles before judging
  these fresh challengers.\n`
    : '';
  const telemetryBlock = data.source === 'api'
    ? `TELEMETRY: if the resolved direction uses one of these challengers, rerun
  this script once with --chosen <challenger-id> --from ${key} --scope ${scope}${mode ? ` --mode ${mode}` : ''}
  after resolution. The ping is anonymous (chosen id only) and is skipped
  automatically when DO_NOT_TRACK or IMPECCABLE_NO_TELEMETRY is set.\n`
    : '';
  return `${scope.toUpperCase()} CONCEPT SEED (key: ${key}; mode: ${mode ?? 'unscoped'}; source: ${data.source}; approved pool: ${data.poolRevision}; ${data.approvedCount}/${data.catalogCount} human-approved; rerun with --scope ${scope}${mode ? ` --mode ${mode}` : ''} --from ${key}${reroll > 0 ? ` --reroll ${reroll}` : ''} --candidate-count ${candidateCount} to reproduce this roll against this catalog revision)
${rerollBlock}ASSIGNED INDEX: ${buildIndex}
  ${promotedInstruction}
  The assignment exists to refuse the model's ranking rut, never to outrank
  the user or the brief. Never expose assignment metadata in user-facing labels.
CHALLENGERS:
${data.challengers.map(renderChallenger).join('\n')}
${compositionBlock}${challengerInstruction}
When you can view images, open the QUALITY BAR board and hero for any
challenger you weigh seriously and for the world you build. They exist as a
craft bar, the finish level and commitment the build is expected to reach,
never as a mockup to copy; your surface serves this product, not that render.
${authorityInstruction}
${richnessInstruction}
${telemetryBlock}A user- or brief-pinned decision beats the roll, always.
ASSIGNED INDEX (restated for truncated readers): ${buildIndex}. Build candidate
${buildIndex} of your own grounded list; seed key ${key}.
`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const fromIdx = args.indexOf('--from');
  const scopeIdx = args.indexOf('--scope');
  const rerollIdx = args.indexOf('--reroll');
  const modeIdx = args.indexOf('--mode');
  const grainIdx = args.indexOf('--grain');
  const platformIdx = args.indexOf('--platform');
  const candidateCountIdx = args.indexOf('--candidate-count');
  const chosenIdx = args.indexOf('--chosen');
  try {
    if (chosenIdx !== -1) {
      // Choice ping: always exits 0, telemetry must never fail a design flow.
      const sent = await pingChosen({
        chosenId: args[chosenIdx + 1],
        key: fromIdx !== -1 ? args[fromIdx + 1] : undefined,
        scope: scopeIdx !== -1 ? args[scopeIdx + 1] : undefined,
        mode: modeIdx !== -1 ? args[modeIdx + 1] : undefined,
      });
      process.stdout.write(sent ? 'choice recorded\n' : 'choice ping skipped\n');
    } else {
      // Mechanical init gate: prose alone does not keep a model from dealing
      // before init, and fresh repos produced exactly that skip (the model
      // rolled directions with no PRODUCT.md, so nothing grounded the fusion).
      // The --chosen branch above stays ungated; telemetry never blocks.
      const { loadContext } = await import('./context.mjs');
      if (!loadContext(process.cwd()).hasProduct) {
        process.stdout.write([
          'NO_PRODUCT_MD: the dice stay in the cup until product truth exists.',
          'Complete the init ask round and write PRODUCT.md first (reference/init.md), then re-run this exact command.',
          'Challengers fuse their form with facts from PRODUCT.md; without it every direction is ungrounded.',
        ].join(' ') + '\n');
        process.exit(1);
      }
      process.stdout.write(await renderConceptSeed({
        scope: scopeIdx !== -1 ? args[scopeIdx + 1] : 'surface',
        key: fromIdx !== -1
          ? args[fromIdx + 1]
          : (process.env.IMPECCABLE_CONCEPT_SEED || crypto.randomBytes(4).toString('hex')),
        reroll: rerollIdx !== -1 ? Number(args[rerollIdx + 1]) : 0,
        mode: modeIdx !== -1 ? args[modeIdx + 1] : null,
        grain: grainIdx !== -1 ? args[grainIdx + 1] : null,
        platform: platformIdx !== -1 ? args[platformIdx + 1] : null,
        candidateCount: candidateCountIdx !== -1 ? Number(args[candidateCountIdx + 1]) : 7,
      }));
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
  // A raced-out fetch may still hold a socket; exit explicitly so the CLI
  // never lingers on a dead network path after output is written.
  process.exit(process.exitCode ?? 0);
}
