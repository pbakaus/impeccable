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
 *     fresh assigned index, challengers, and staging. One base key therefore
 *     reproduces the entire chain of rounds.
 *   - RATINGS: the reviewer's approval ratings weight the challenger draw
 *     (3-star doubles the odds, 1-star sits out); the approved pool itself
 *     is unchanged.
 *
 * Usage:
 *   node scripts/concept-seed.mjs --scope direction --mode persuade
 *   node scripts/concept-seed.mjs --scope surface --mode operate --from <key>
 *   node scripts/concept-seed.mjs --scope direction --candidate-count 6
 *   node scripts/concept-seed.mjs --scope direction --mode persuade --from <key> --reroll 1
 *   node scripts/concept-seed.mjs --chosen <challenger-id> --from <key> --scope direction
 *
 * --mode names the requested surface's mode (persuade, operate, read,
 * experience) so the appended staging matches its register of work; omitted,
 * the staging rolls from the full approved pool.
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
  deterministicRank,
  readConceptCatalog,
  validateConceptCatalog,
  WELL_TIERS,
} from './lib/concept-catalog.mjs';
import { readCompositionCatalog } from './lib/composition-catalog.mjs';

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

async function fetchRoll({ scope, key, mode, reroll }) {
  const params = new URLSearchParams({ scope, key, reroll: String(reroll) });
  if (mode) params.set('mode', mode);
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

export function renderStaging(composition, index = null) {
  const grammar = composition.grammar.map(rule => `       - ${rule}`).join('\n');
  return `  ${index == null ? '' : `${index + 1}. `}${composition.form}
     SOURCE ID: ${composition.id}
     SPARK: ${composition.spark}
     STAGING GRAMMAR:
${grammar}
     WEB LEVERAGE: ${composition.webLeverage}`;
}

// Three approved, identity-free staging inputs are rolled deterministically.
// One input was too weak a counterweight to a model's habitual page skeleton:
// it became a single optional flourish beside six identity challengers rather
// than a real search over composition. Prefer distinct staging families so a
// roll tests materially different hierarchy, sequence, and interaction laws.
// Cross-mode fallback would make the input misleading, so an absent mode still
// returns no staging. Re-rolls exclude every earlier set until the pool runs out.
export function selectApprovedStagings({ scope, key, reroll = 0, mode = null, sourceCompositions = null, count = 3 }) {
  const pool = sourceCompositions ?? requireLocalConcepts().compositions;
  let approved = pool.filter(composition => composition.status === 'approved');
  if (approved.length === 0) return [];
  if (mode) {
    const matching = approved.filter(composition => composition.surface === mode);
    if (matching.length === 0) return [];
    approved = matching;
  }
  const prior = new Set();
  let picks = [];
  for (let round = 0; round <= reroll; round += 1) {
    const available = approved.filter(composition => !prior.has(composition.id));
    const ranked = deterministicRank(
      available.length >= Math.min(count, approved.length) ? available : approved,
      round === 0 ? `${scope}:${key}:staging` : `${scope}:${key}:staging:reroll-${round}`
    );
    const families = new Set();
    picks = [];
    for (const composition of ranked) {
      const family = composition.familyId ?? composition.id;
      if (families.has(family)) continue;
      picks.push(composition);
      families.add(family);
      if (picks.length >= count) break;
    }
    for (const composition of ranked) {
      if (picks.length >= count) break;
      if (!picks.some(pick => pick.id === composition.id)) picks.push(composition);
    }
    if (round < reroll) picks.forEach(composition => prior.add(composition.id));
  }
  return picks;
}

// Compatibility for callers that need a single smoke-test sample.
export function selectApprovedStaging(options) {
  return selectApprovedStagings({ ...options, count: 1 })[0] ?? null;
}

export function selectApprovedChallengers({ scope, key, reroll = 0, sourceConcepts = null }) {
  const source = sourceConcepts ?? requireLocalConcepts().concepts;
  const approved = source.filter(concept => concept.status === 'approved');
  // Direction chooses a durable identity, so it draws worlds; surface designs
  // one page inside a committed identity, so it draws stagings. Duals serve
  // both. A tier with no matching-strength approvals falls back to its full
  // approved pool rather than starving the roll.
  const wanted = scope === 'direction'
    ? new Set(['world', 'dual'])
    : new Set(['composition', 'dual']);
  const approvedByTier = new Map();
  for (const concept of approved) {
    const tier = approvedByTier.get(concept.wellTier) || [];
    tier.push(concept);
    approvedByTier.set(concept.wellTier, tier);
  }
  if (WELL_TIERS.some(tier => !(approvedByTier.get(tier) || []).length)) {
    throw new Error('concept-seed: every challenger tier needs at least one approved concept');
  }
  for (const [tier, pool] of approvedByTier) {
    const matching = pool.filter(concept => wanted.has(concept.strength));
    if (matching.length > 0) approvedByTier.set(tier, matching);
  }
  // Two challengers per tier, so every roll carries near-zero-translation
  // graphic systems beside instrument languages and atmosphere worlds, with
  // the second pick preferring a different family for diversity. Tier order
  // in the rendered list is rolled too, to avoid positional bias.
  // Approval ratings weight the draw: a 3-star world earns a second ticket
  // (roughly double odds), a 1-star keeps its approval for direct briefs but
  // leaves the challenger pool unless a tier has nothing else.
  const ticketsFor = pool => pool.flatMap(concept => {
    const rating = concept.review?.rating;
    if (rating === 1) return [];
    return rating === 3
      ? [{ concept, ticket: 0 }, { concept, ticket: 1 }]
      : [{ concept, ticket: 0 }];
  });
  const pickRound = (round, excluded) => {
    const salt = round === 0 ? '' : `:reroll-${round}`;
    const tierOrder = deterministicRank(
      WELL_TIERS.map(id => ({ id })),
      `${scope}:${key}:tiers${salt}`
    ).map(item => item.id);
    return tierOrder.flatMap((tier, index) => {
      let pool = approvedByTier.get(tier).filter(concept => !excluded.has(concept.id));
      // A tier exhausted by prior rounds falls back to reuse over starvation.
      if (pool.length === 0) pool = approvedByTier.get(tier);
      let tickets = ticketsFor(pool);
      if (tickets.length === 0) tickets = pool.map(concept => ({ concept, ticket: 0 }));
      const ranked = deterministicRank(
        tickets,
        `${scope}:${key}:challenger-${index}${salt}`,
        entry => `${entry.concept.id}#${entry.ticket}`
      );
      const order = [];
      const seen = new Set();
      for (const entry of ranked) {
        if (seen.has(entry.concept.id)) continue;
        seen.add(entry.concept.id);
        order.push(entry.concept);
      }
      const first = order[0];
      const second = order.find(concept => concept.familyId !== first.familyId)
        || order.find(concept => concept.id !== first.id);
      return second ? [first, second] : [first];
    });
  };
  // Round n of a re-roll chain excludes everything rounds 0..n-1 drew, so the
  // same base key reproduces the whole chain.
  const excluded = new Set();
  let picks = pickRound(0, excluded);
  for (let round = 1; round <= reroll; round += 1) {
    for (const pick of picks) excluded.add(pick.id);
    picks = pickRound(round, excluded);
  }
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
        sourceConcepts: local.concepts,
      });
      data = {
        source: 'local',
        poolRevision,
        approvedCount: approved.length,
        catalogCount,
        challengers: picks,
        stagings: selectApprovedStagings({ scope, key, reroll, mode, sourceCompositions: local.compositions }),
      };
    } else {
      // Keep local renders synchronous for prepared eval sessions and tests;
      // installed skills without a bundled catalog resolve through the API.
      return fetchRoll({ scope, key, mode, reroll }).then(roll => renderConceptSeed({
        scope,
        key,
        reroll,
        mode,
        candidateCount,
        catalogDir,
        _resolvedData: roll ? {
          source: 'api',
          poolRevision: roll.poolRevision,
          approvedCount: roll.approvedCount,
          catalogCount: roll.catalogCount,
          challengers: roll.challengers,
          stagings: Array.isArray(roll.stagings) ? roll.stagings : roll.staging ? [roll.staging] : [],
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
  re-roll; never present a ranked lineup to choose from. Re-roll yourself only
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
  list is the point. A fused challenger that wins both axes becomes the build.`
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
cause: if this harness can rerun the command with network access granted,
do that once before proceeding. Otherwise proceed with the grounded
candidates alone; the assignment
above still applies at full strength. Tell the user plainly that this roll
ran degraded, with no challengers and no quality-bar boards; do not present
the outcome as a full roll. A degraded roll changes the cards, not the
channel: when a browser can open, present the direction on the decision page
(serve-question.mjs, text-only card); the structured question tool remains
the no-browser fallback.
${authorityInstruction}
A user- or brief-pinned decision beats the roll, always.
`;
  }

  const stagings = Array.isArray(data.stagings)
    ? data.stagings
    : data.staging ? [data.staging] : [];
  const stagingBlock = stagings.length > 0
    ? `\n${scope === 'direction' ? 'FIRST-SURFACE STAGING INPUTS (identity-free; test them with shortlisted worlds and keep world plus staging one decision):' : 'STAGING CHALLENGERS (identity-free; dress them in the committed visual identity before judging):'}
${stagings.map((staging, index) => renderStaging(staging, index)).join('\n')}
Stagings organize attention, sequence, and manipulation; they never bring a
palette, typeface, or material. Use them as serious alternatives to the model's
habitual composition, but keep only structures that strengthen this product.\n`
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
${stagingBlock}${challengerInstruction}
When you can view images, open the QUALITY BAR board and hero for any
challenger you weigh seriously and for the world you build. They exist as a
craft bar, the finish level and commitment the build is expected to reach,
never as a mockup to copy; your surface serves this product, not that render.
${authorityInstruction}
${richnessInstruction}
${telemetryBlock}A user- or brief-pinned decision beats the roll, always.
`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const fromIdx = args.indexOf('--from');
  const scopeIdx = args.indexOf('--scope');
  const rerollIdx = args.indexOf('--reroll');
  const modeIdx = args.indexOf('--mode');
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
