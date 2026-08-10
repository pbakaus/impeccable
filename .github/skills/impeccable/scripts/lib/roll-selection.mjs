// The one implementation of world-roll selection.
//
// Two copies of this logic used to exist: this repo's concept-seed.mjs and the
// service repo's functions/api/_worldroll-core.js, whose header claimed they
// matched "exactly". They did not. The API had no breadth gate on either pool,
// no rating weighting for compositions, and dealt one composition where the
// seeder dealt three. Because the catalog never ships with the skill, every real
// user rolls through that API, so those gates reached nobody.
//
// Why generators. The two callers cannot agree on a hash: Node has a
// synchronous one, Workers only have async crypto.subtle, and concept-seed's
// local render path is deliberately synchronous so prepared eval sessions and
// tests can call it without awaiting. Rather than fork the logic or force the
// whole seeder async, the selection is written once as a generator that yields
// batches of strings to hash and resumes with their digests. runSyncSelection
// and runAsyncSelection below are the only runtime-specific code, about eight
// lines each. Both digests are the same bytes, so a roll is identical either way.
//
// Nothing here reads a file, an environment variable, or the network: callers
// pass pools in.

export const WELL_TIERS = ['graphic', 'interaction', 'atmosphere'];

// Grain: how much of the product a composition composes. Named grain rather than
// scope because scope already means direction-or-surface on every roll, and
// 'surface' is already a register value, so a scope of 'surface' would collide
// with both.
//
// This axis is framed by what the skill can be asked for, not by what the
// catalog happens to hold. A user asks for a docs site, an onboarding flow, a
// landing page, or a data table, and those are four different amounts of
// product. Register says what kind of work it is; grain says how much of it.
// Without grain, a request for a hero section can be dealt a whole-site
// navigation structure and nothing notices.
//
// Measured when this was added: 137 of 173 approved compositions were view
// grain, product grain was empty, and flow grain held one entry. That is why an
// onboarding request had nothing to draw.
export const COMPOSITION_GRAINS = [
  'product', // a whole site or app: its information architecture
  'flow',    // a sequence of views with one outcome: onboarding, checkout, setup
  'view',    // one page or screen
  'region',  // a section inside a view: a hero, a feature grid, a table
];

// Delivery targets a composition can survive. Mirrors the skill's platform axis
// minus 'adaptive', which is a project-level value meaning both native targets
// rather than something a single composition is authored for.
//
// A composition that leans on hover, a pointer, or a wide viewport does not
// survive a phone, and nothing in the schema could say so before this.
export const COMPOSITION_PLATFORMS = ['web', 'ios', 'android'];

// Both fields are optional and absence means eligible everywhere, so no entry
// has to be backfilled before this ships and no existing roll changes.
export function isGrain(value) {
  return COMPOSITION_GRAINS.includes(value);
}

export function isPlatform(value) {
  return COMPOSITION_PLATFORMS.includes(value);
}


/**
 * Drives a selection generator with a synchronous hash.
 * @param {Generator} generator yields string[] to hash, resumes with hex string[]
 * @param {(input: string) => string} hash
 */
export function runSyncSelection(generator, hash) {
  let step = generator.next();
  while (!step.done) step = generator.next(step.value.map(hash));
  return step.value;
}

/**
 * Drives a selection generator with an asynchronous hash.
 * @param {Generator} generator
 * @param {(input: string) => Promise<string>} hash
 */
export async function runAsyncSelection(generator, hash) {
  let step = generator.next();
  while (!step.done) step = generator.next(await Promise.all(step.value.map(hash)));
  return step.value;
}

// Ranks items by the digest of `${input}:${id}`, descending, with the id as a
// stable tiebreak. Yields every needed digest in one batch so the async driver
// can resolve them concurrently.
function* rank(items, input, idFor = item => item.id) {
  const ids = items.map(idFor);
  const digests = yield ids.map(id => `${input}:${id}`);
  return items
    .map((item, index) => ({ item, id: ids[index], score: digests[index] }))
    .sort((a, b) => b.score.localeCompare(a.score) || a.id.localeCompare(b.id))
    .map(entry => entry.item);
}

// Rating sets how many tickets a world holds; breadth decides whether it draws
// at all. A niche world leaves the pool however good it is, keeping its approval
// for direct briefs. Breadth was split out of rating because the only way to
// hold a narrow world back used to be calling it marginal, which made "excellent
// but narrow" unrecordable and corrupted ratings as a calibration signal.
//
// Two tickets for a 3-star, one for everything else, was too sharp. Measured
// against the catalog as it stood: 3-star worlds absorbed 57% of the graphic
// draw from 65 of 163 eligible worlds, 46% of atmosphere from 13 of 43, and
// 75% of interaction from 15 of 25. The reviewer's complaint, that the same
// worlds keep coming back, is what a rating multiplier does to a pool whose
// thinnest tier holds 25 worlds.
//
// So a 3-star no longer outdraws a 2-star, and a 1-star draws at half rather
// than not at all. A marginal keep is still worth showing sometimes: the
// judgement it records is "narrow or unexceptional", not "wrong", and excluding
// it entirely made a rating do a job breadth already does properly.
const RATING_TICKETS = { 1: 1, 2: 2, 3: 2 };
const ticketsForRating = rating => RATING_TICKETS[rating] ?? 2;

function challengerTickets(pool) {
  return pool.flatMap(concept => {
    if (concept.review?.breadth === 'niche') return [];
    return Array.from({ length: ticketsForRating(concept.review?.rating) },
      (_, ticket) => ({ concept, ticket }));
  });
}

function compositionTickets(pool) {
  return pool.flatMap(composition => Array.from(
    { length: ticketsForRating(composition.review?.rating) },
    (_, ticket) => ({ composition, ticket })));
}

/**
 * Six challengers, two per translation tier, from an explicit approved pool.
 * Drive with runSyncSelection or runAsyncSelection.
 *
 * @param {object} options
 * @param {'direction'|'surface'} options.scope
 * @param {string} options.key              same key reproduces the roll
 * @param {number} [options.reroll]         round of the re-roll chain
 * @param {number|null} [options.minRating] optional floor, skipped per tier it would empty
 * @param {Array} options.concepts          merged concepts with status, review, wellTier, familyId
 * @returns {Generator<string[], {approved: Array, picks: Array}, string[]>}
 */
// A world with no allowedModes is eligible everywhere, which is what keeps this
// additive: nothing has to be backfilled for the filter to be safe.
function modeAllows(concept, mode) {
  const allowed = concept.review?.allowedModes;
  if (!Array.isArray(allowed) || allowed.length === 0) return true;
  return allowed.includes(mode);
}

export function* selectApprovedChallengers({ scope, key, reroll = 0, minRating = null, mode = null, concepts }) {
  const approved = concepts.filter(concept => concept.status === 'approved');
  // Direction chooses a durable identity, so it draws worlds; surface designs
  // one page inside a committed identity, so it draws compositions. Duals serve
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

  // Optional minimum-rating gate, applied per tier and skipped for any tier it
  // would empty, so a thin tier degrades to its full approved pool.
  if (minRating) {
    for (const [tier, pool] of approvedByTier) {
      const rated = pool.filter(concept => (concept.review?.rating || 0) >= minRating);
      if (rated.length > 0) approvedByTier.set(tier, rated);
    }
  }
  // Mode eligibility, per tier and skipped where it would empty a tier. Worlds
  // used to be drawn with no mode awareness at all, so a build asking for an app
  // UI could get six worlds that only make sense on a landing page. A world is an
  // identity and identities transfer further than compositions do, so this is a
  // ceiling the reviewer sets rather than a category assignment: eligible
  // everywhere until someone says otherwise.
  if (mode) {
    for (const [tier, pool] of approvedByTier) {
      const eligible = pool.filter(concept => modeAllows(concept, mode));
      if (eligible.length > 0) approvedByTier.set(tier, eligible);
    }
  }
  for (const [tier, pool] of approvedByTier) {
    const matching = pool.filter(concept => wanted.has(concept.strength));
    if (matching.length > 0) approvedByTier.set(tier, matching);
  }

  // Two challengers per tier, so every roll carries near-zero-translation
  // graphic systems beside instrument languages and atmosphere worlds, with the
  // second pick preferring a different family. Tier order is rolled too, to
  // avoid positional bias.
  function* pickRound(round, excluded) {
    const salt = round === 0 ? '' : `:reroll-${round}`;
    const tierOrder = (yield* rank(
      WELL_TIERS.map(id => ({ id })),
      `${scope}:${key}:tiers${salt}`
    )).map(item => item.id);
    const picks = [];
    for (const [index, tier] of tierOrder.entries()) {
      let pool = approvedByTier.get(tier).filter(concept => !excluded.has(concept.id));
      // A tier exhausted by prior rounds falls back to reuse over starvation.
      if (pool.length === 0) pool = approvedByTier.get(tier);
      let tickets = challengerTickets(pool);
      if (tickets.length === 0) tickets = pool.map(concept => ({ concept, ticket: 0 }));
      const ranked = yield* rank(
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
      picks.push(...(second ? [first, second] : [first]));
    }
    return picks;
  }

  // Round n of a re-roll chain excludes everything rounds 0..n-1 drew, so the
  // same base key reproduces the whole chain.
  const excluded = new Set();
  let picks = yield* pickRound(0, excluded);
  for (let round = 1; round <= reroll; round += 1) {
    for (const pick of picks) excluded.add(pick.id);
    picks = yield* pickRound(round, excluded);
  }
  return { approved, picks };
}

function emptyMatch(grain, platform, platformExcluded = 0) {
  return { grain: grain ?? null, atGrain: grain ? 0 : null, grainAvailable: grain ? 0 : null, platform: platform ?? null, platformExcluded };
}

/**
 * Three identity-free composition inputs from an explicit approved pool.
 * Drive with runSyncSelection or runAsyncSelection.
 *
 * One input was too weak a counterweight to a model's habitual page skeleton:
 * it became a single optional flourish beside six identity challengers rather
 * than a real search over composition. Distinct composition families are preferred
 * so a roll tests materially different hierarchy, sequence, and interaction
 * laws. Cross-mode fallback would make the input misleading, so an absent mode
 * returns nothing rather than borrowing. Re-rolls exclude every earlier set
 * until the pool runs out.
 *
 * @param {object} options
 * @param {'direction'|'surface'} options.scope
 * @param {string} options.key
 * @param {number} [options.reroll]
 * @param {string|null} [options.mode]  surface register to stay inside
 * @param {string|null} [options.grain]     how much of the product is in play
 * @param {string|null} [options.platform]  delivery target the result has to survive
 * @param {Array} options.compositions  merged compositions with status, review, surface, familyId
 * @param {number} [options.count]
 * @returns {Generator<string[], {picks: Array, match: object}, string[]>}
 */
export function* selectApprovedCompositions({ scope, key, reroll = 0, mode = null, grain = null, platform = null, compositions, count = 3 }) {
  // Compositions honour the same breadth gate as worlds: one too specific to serve
  // an arbitrary build stays approved for direct briefs and leaves the
  // challenger pool. Falls back to the full approved set rather than returning
  // nothing if every approved composition is niche.
  let approved = compositions.filter(composition => composition.status === 'approved');
  const broad = approved.filter(composition => composition.review?.breadth !== 'niche');
  if (broad.length > 0) approved = broad;
  if (approved.length === 0) return { picks: [], match: emptyMatch(grain, platform) };
  if (mode) {
    const matching = approved.filter(composition => composition.surface === mode);
    if (matching.length === 0) return { picks: [], match: emptyMatch(grain, platform) };
    approved = matching;
  }
  // Platform is a hard filter, unlike grain. A composition that needs hover or a
  // pointer does not degrade on a phone into something slightly worse; it stops
  // working, so borrowing it would be a defect rather than a stretch. Absent
  // platforms means it survives anywhere.
  let platformExcluded = 0;
  if (platform) {
    const survives = approved.filter(composition => {
      const only = composition.platforms;
      return !Array.isArray(only) || only.length === 0 || only.includes(platform);
    });
    platformExcluded = approved.length - survives.length;
    // No fallback here either: dealing a hover-only composition to a phone build
    // is worse than dealing nothing, and an empty deal is a visible gap.
    approved = survives;
    if (approved.length === 0) return { picks: [], match: emptyMatch(grain, platform, platformExcluded) };
  }

  const prior = new Set();
  let picks = [];
  for (let round = 0; round <= reroll; round += 1) {
    const available = approved.filter(composition => !prior.has(composition.id));
    const base = available.length >= Math.min(count, approved.length) ? available : approved;
    // Rating weights the draw as it does for worlds. It matters more here
    // because the per-surface pools are small, so an unweighted shuffle repeats
    // a weak composition far more often. Each ticket carries its index so the rank
    // sees a distinct key per ticket: ranking bare duplicates would hash
    // identically and the pick loop's id-dedupe would silently discard the
    // second copy, making the weighting a no-op.
    let tickets = compositionTickets(base);
    // A pool of nothing but 1-star keeps still has to yield compositions.
    if (tickets.length === 0) tickets = base.map(composition => ({ composition, ticket: 0 }));
    const ranked = (yield* rank(
      tickets,
      // The salt keeps the word "staging" deliberately. It is hash input, so
      // renaming it would re-deal every roll anyone has ever reproduced by key.
      round === 0 ? `${scope}:${key}:staging` : `${scope}:${key}:staging:reroll-${round}`,
      entry => `${entry.composition.id}#${entry.ticket}`
    )).map(entry => entry.composition);

    // Grain is a preference, not a filter: requesting an onboarding flow deals
    // flow-grain compositions first and tops up from the rest of the register
    // rather than dealing fewer than three. A stable partition of an already
    // deterministic ranking is still deterministic.
    //
    // The top-up is why match is reported. Dealing three plausible view-grain
    // compositions against a flow request, with no signal that none matched, is
    // the same silent-plausibility failure this whole axis exists to fix: the
    // model would improvise the flow structure while believing it was handed one.
    const ordered = grain
      ? [...ranked.filter(composition => composition.grain === grain),
         ...ranked.filter(composition => composition.grain !== grain)]
      : ranked;

    const families = new Set();
    picks = [];
    for (const composition of ordered) {
      const family = composition.familyId ?? composition.id;
      if (families.has(family)) continue;
      picks.push(composition);
      families.add(family);
      if (picks.length >= count) break;
    }
    for (const composition of ordered) {
      if (picks.length >= count) break;
      if (!picks.some(pick => pick.id === composition.id)) picks.push(composition);
    }
    if (round < reroll) picks.forEach(composition => prior.add(composition.id));
  }

  const atGrain = grain ? picks.filter(composition => composition.grain === grain).length : null;
  return {
    picks,
    match: {
      grain: grain ?? null,
      // How many of the dealt compositions actually sit at the requested grain.
      // 0 with a grain requested means every pick is a borrowed structure.
      atGrain,
      grainAvailable: grain ? approved.filter(composition => composition.grain === grain).length : null,
      platform: platform ?? null,
      platformExcluded,
    },
  };
}
