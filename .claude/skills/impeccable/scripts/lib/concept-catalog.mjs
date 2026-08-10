import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { WELL_TIERS } from './roll-selection.mjs';

export const CONCEPT_STATUSES = new Set(['approved', 'rejected']);

// What a concept is actually strong at. Worlds carry a durable visual
// identity (their palette/type half is the magnet); compositions carry a
// composition or interaction idea (their topology half is the magnet) that can be
// dressed in any committed identity; duals fuse both inseparably. Direction
// seeds draw world|dual, surface seeds draw composition|dual.
export const CONCEPT_STRENGTHS = new Set(['world', 'composition', 'dual']);

// Challenger tiers, ordered by translation cost: graphic grammars map to
// interface almost directly, instrument languages carry interaction physics,
// atmosphere worlds need the largest translation step. Every seed roll draws
// one challenger from each tier so at least one directly-usable graphic
// system is always on the table.
// Defined in roll-selection.mjs, the dependency-free leaf both the seeder and
// the roll API import. It cannot depend on this file: this one reads the
// filesystem, and a Pages Function must not pull node:fs into its bundle.
// Imported and re-exported rather than re-exported alone: a bare
// `export { X } from` does not bind X in this module's own scope, and
// validateConceptCatalog needs it.
export { WELL_TIERS };

// Reviewer axes that gate the challenger draw without touching approval.
export const CONCEPT_BREADTHS = new Set(['general', 'niche']);
// The registers of work a roll can be asked for. Kept here beside the review
// validation that uses it; roll-selection.mjs filters on it and the seeder
// validates the --mode flag against the same four.
export const SEED_MODES = new Set(['persuade', 'operate', 'read', 'experience']);

const WEB_LEVERAGE_RE = /(?:\b3d\b|\badaptive\b|\banimat(?:e|ed|ion)\b|\bapi\b|\baria\b|\baudio\b|\bautomated?\b|\bbarcode\b|\bbroadcastchannel\b|\bbrowser\b|\bcamera\b|canvas\b|\bcaption\b|\bcollaborat(?:e|ive|ion)\b|\bcompar(?:e|ison)\b|\bcomput(?:e|ed|ation)\b|\bcomputer[- ]vision\b|\bconstraint[- ]solving\b|\bcryptographic?\b|\bcss\b|\bdeep[- ]link(?:ing)?\b|\bdirect manipulation\b|\bdom\b|\bdrag\b|\bfilter\b|\bfocus\b|\bgenerative\b|\bgeolocat(?:e|ed|ion)\b|\bgesture\b|\bgpu\b|\bgraph\b|\bhistory\b|\bindexeddb\b|\binteractive\b|\bintersectionobserver\b|\bkeyboard\b|\blive\b|\blocal\b|\bmicrophone\b|\bmotion\b|\bmultiplayer\b|\bnative\b|\bnotification\b|\boffline\b|\bpersonaliz(?:e|ed|ation)\b|\bplayable\b|\bpointer\b|\bprocedural\b|\bprovenance\b|\breal[- ]?time\b|\bresizeobserver\b|\bresponsive\b|\breveal\b|\bscrub\b|\bsearch\b|\bsearchparams\b|\bsensor\b|\bserver[- ]sent\b|\bservice worker\b|\bshader\b|\bsimulat(?:e|ed|ion|or)\b|\bspatial\b|\bstate\b|\bstream(?:ing)?\b|\bsvg\b|\bsynchroniz(?:e|ed|ation)\b|\btimeline\b|\btouch\b|\burl|\bvideo\b|\bweb(?:gl|socket|vtt)?\b|\bworker\b|\bzoom\b)/i;
export const SYSTEM_PREFIXES = [
  'Palette/material:',
  'Type/composition:',
  'Topology/navigation:',
  'Controls/state:',
  'Responsive/motion:',
];
const BLAND_FORM_RE = /\b(?:control room|command center|operations center|dispatch desk|review queue|speaker queue|management console|admin console|operator loop|coordination system|tracking system|planning system|software platform|digital platform|operations cockpit|app portal|web portal|data hub|dashboard|workflow|planner|tracker|orchestrator)\b/i;

export function normalizeConceptForm(value) {
  return String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function validateConceptEntry(concept, { existingForms = new Map(), axes = null } = {}) {
  const errors = [];
  const id = concept?.id || '(unknown)';

  // Recorded aesthetic axis values. Optional, and absent means the value is
  // inferred from the system rules instead. Some axes cannot be inferred at all:
  // depth's keyword probe matched worlds that said "no cast shadow anywhere",
  // and motion and colour strategy describe properties the rules never state, so
  // a wave that assigns those has to record them or the assignment is lost.
  // Validated against the axes definition when the caller supplies it, because a
  // typo would read as "unrecorded" and silently fall back to a probe that is
  // known not to work.
  if (concept?.axes !== undefined && concept.axes !== null) {
    if (typeof concept.axes !== 'object' || Array.isArray(concept.axes)) {
      errors.push(`concept ${id} axes must be an object of axis id to value id`);
    } else if (axes) {
      const byId = new Map((axes.axes || []).map(axis => [axis.id, axis]));
      for (const [axisId, valueId] of Object.entries(concept.axes)) {
        const axis = byId.get(axisId);
        if (!axis) {
          errors.push(`concept ${id} names unknown axis "${axisId}"`);
        } else if (!(axis.values || []).some(value => value.id === valueId)) {
          errors.push(
            `concept ${id} axis "${axisId}" has unknown value "${valueId}" `
            + `(expected one of ${(axis.values || []).map(v => v.id).join(', ')})`
          );
        }
      }
    }
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(concept?.id || '')) {
    errors.push(`invalid concept id: ${String(concept?.id)}`);
  }

  const normalized = normalizeConceptForm(concept?.form);
  if (!normalized) {
    errors.push(`concept ${id} needs a form`);
  } else if (existingForms.has(normalized)) {
    errors.push(`duplicate concept form: ${id} and ${existingForms.get(normalized)}`);
  }
  if (typeof concept?.form !== 'string'
    || concept.form.trim().length < 40
    || concept.form.trim().length > 360
    || !concept.form.includes(',')) {
    errors.push(`concept ${id} must name a form and inherited structure after a comma`);
  }
  if (typeof concept?.lineage !== 'string'
    || concept.lineage.trim().length < 12
    || concept.lineage.trim().length > 200) {
    errors.push(`concept ${id} needs specific lineage metadata of 12–200 characters`);
  }
  if (!CONCEPT_STRENGTHS.has(concept?.strength)) {
    errors.push(`concept ${id} needs a strength of ${[...CONCEPT_STRENGTHS].join(', ')}`);
  }
  if (!Array.isArray(concept?.tags)
    || concept.tags.length !== 3
    || concept.tags.some(tag => typeof tag !== 'string' || !tag.trim())) {
    errors.push(`concept ${id} must have exactly three structural tags`);
  }
  // The slop this world in particular is at risk of. Optional, because 541
  // entries predate it and none of them are wrong for lacking it. A world built
  // from posters is at risk of shouting and one built from instruments is at
  // risk of dead greys; a global detector cannot know which, and the author can.
  if (concept?.avoid !== undefined) {
    if (!Array.isArray(concept.avoid)
      || concept.avoid.length < 2
      || concept.avoid.length > 3
      || concept.avoid.some(item => typeof item !== 'string' || item.trim().length < 12 || item.trim().length > 160)) {
      errors.push(`concept ${id} avoid must be two or three negations of 12–160 characters`);
    }
  }
  if (!Array.isArray(concept?.system)
    || concept.system.length !== SYSTEM_PREFIXES.length
    || concept.system.some(rule => typeof rule !== 'string' || rule.trim().length < 12 || rule.trim().length > 180)) {
    errors.push(`concept ${id} needs system grammar with exactly five rules of 12–180 characters`);
  } else {
    const uniqueRules = new Set(concept.system.map(normalizeConceptForm));
    if (uniqueRules.size !== SYSTEM_PREFIXES.length) {
      errors.push(`concept ${id} has duplicate system grammar rules`);
    }
    if (concept.system.some((rule, index) => !rule.startsWith(SYSTEM_PREFIXES[index]))) {
      errors.push(`concept ${id} system grammar must use palette, type, topology, controls, and responsive prefixes in order`);
    }
  }
  if (typeof concept?.spark !== 'string'
    || concept.spark.trim().length < 80
    || concept.spark.trim().length > 320) {
    errors.push(`concept ${id} needs a vivid creative spark of 80–320 characters`);
  }
  if (typeof concept?.webLeverage !== 'string'
    || concept.webLeverage.trim().length < 20
    || concept.webLeverage.trim().length > 240) {
    errors.push(`concept ${id} needs web leverage of 20–240 characters`);
  }
  if (/\b(?:live digital system|shared participatory system) modeled on\b/i.test(concept?.form || '')) {
    errors.push(`concept ${id} is a generic wrapper around another artifact`);
  }
  if (/\b(?:in the style of|styled like|copy of)\b/i.test(concept?.form || '')) {
    errors.push(`concept ${id} contains imitation language`);
  }
  if (BLAND_FORM_RE.test(concept?.form || '')) {
    errors.push(`concept ${id} is framed as a literal software or operations archetype instead of an inspiring visual world`);
  }
  return errors;
}

// Fingerprint of everything a reviewer judged. Reviews carry this hash so an
// approval cannot silently survive a content edit: the validator rejects any
// review whose hash no longer matches the concept it points at.
export function conceptContentHash(concept) {
  const payload = [
    concept?.form ?? '',
    concept?.lineage ?? '',
    JSON.stringify(concept?.tags ?? []),
    JSON.stringify(concept?.system ?? []),
    concept?.spark ?? '',
    concept?.webLeverage ?? '',
  ].join('\n');
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 12);
}

export function readConceptCatalog(catalogPath, reviewsPath) {
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  const reviewData = JSON.parse(readFileSync(reviewsPath, 'utf8'));
  const reviews = reviewData.reviews || {};
  const wellsById = new Map((catalog.wells || []).map(well => [well.id, well]));
  const concepts = [];

  for (const family of catalog.families || []) {
    for (const concept of family.concepts || []) {
      concepts.push({
        ...concept,
        familyId: family.id,
        familyLabel: family.label,
        wellId: family.well || null,
        wellLabel: wellsById.get(family.well)?.label || null,
        wellTier: wellsById.get(family.well)?.tier || null,
        status: reviews[concept.id]?.status || 'pending',
        review: reviews[concept.id] || null,
      });
    }
  }

  return { catalog, reviewData, reviews, concepts };
}

export function validateConceptCatalog(catalog, reviewData, {
  expectedTotal,
  minimumTotal,
  requireApprovedMinimum = true,
} = {}) {
  const errors = [];
  const warnings = [];
  const familyIds = new Set();
  const conceptIds = new Set();
  const normalizedForms = new Map();
  const concepts = [];

  if (!Number.isInteger(catalog?.schemaVersion) || catalog.schemaVersion < 7) {
    errors.push('catalog.schemaVersion must be 7 or newer');
  }
  if (typeof catalog?.catalogVersion !== 'string' || !catalog.catalogVersion.trim()) {
    errors.push('catalog.catalogVersion must be a non-empty string');
  }
  if (typeof catalog?.qualityBar?.principle !== 'string' || catalog.qualityBar.principle.trim().length < 80) {
    errors.push('catalog.qualityBar.principle must define the universal creative bar');
  }
  if (!Array.isArray(catalog?.qualityBar?.rejectIf) || catalog.qualityBar.rejectIf.length < 5) {
    errors.push('catalog.qualityBar.rejectIf must define at least five rejection gates');
  }
  if (!Array.isArray(catalog?.qualityBar?.reviewAxes) || catalog.qualityBar.reviewAxes.length < 8) {
    errors.push('catalog.qualityBar.reviewAxes must define at least eight review axes');
  }
  if (!Array.isArray(catalog?.families) || catalog.families.length < 3) {
    errors.push('catalog.families must contain at least three families');
  }

  const wellIds = new Set();
  if (!Array.isArray(catalog?.wells) || catalog.wells.length < 5) {
    errors.push('catalog.wells must define at least five inspiration wells');
  }
  for (const well of catalog?.wells || []) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(well.id || '')) {
      errors.push(`invalid well id: ${String(well.id)}`);
    } else if (wellIds.has(well.id)) {
      errors.push(`duplicate well id: ${well.id}`);
    }
    wellIds.add(well.id);
    if (typeof well.label !== 'string' || !well.label.trim()) {
      errors.push(`well ${well.id || '(unknown)'} needs a label`);
    }
    if (typeof well.description !== 'string' || well.description.trim().length < 40) {
      errors.push(`well ${well.id || '(unknown)'} needs a description of at least 40 characters`);
    }
    if (!WELL_TIERS.includes(well.tier)) {
      errors.push(`well ${well.id || '(unknown)'} needs a tier of ${WELL_TIERS.join(', ')}, got: ${String(well.tier)}`);
    }
  }
  const tiersPresent = new Set((catalog?.wells || []).map(well => well.tier).filter(tier => WELL_TIERS.includes(tier)));
  for (const tier of WELL_TIERS) {
    if ((catalog?.wells || []).length > 0 && !tiersPresent.has(tier)) {
      errors.push(`no well declares the ${tier} tier`);
    }
  }
  const populatedWells = new Set();

  for (const family of catalog?.families || []) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(family.id || '')) {
      errors.push(`invalid family id: ${String(family.id)}`);
    } else if (familyIds.has(family.id)) {
      errors.push(`duplicate family id: ${family.id}`);
    }
    familyIds.add(family.id);
    if (typeof family.label !== 'string' || !family.label.trim()) {
      errors.push(`family ${family.id || '(unknown)'} needs a label`);
    }
    if (!wellIds.has(family.well)) {
      errors.push(`family ${family.id || '(unknown)'} must belong to a declared well, got: ${String(family.well)}`);
    } else {
      populatedWells.add(family.well);
    }
    if (!Array.isArray(family.concepts) || family.concepts.length === 0) {
      errors.push(`family ${family.id || '(unknown)'} has no concepts`);
      continue;
    }

    for (const concept of family.concepts) {
      concepts.push(concept);
      if (conceptIds.has(concept.id)) {
        errors.push(`duplicate concept id: ${concept.id}`);
      }
      errors.push(...validateConceptEntry(concept, { existingForms: normalizedForms }));
      conceptIds.add(concept.id);
      const normalized = normalizeConceptForm(concept.form);
      if (normalized) normalizedForms.set(normalized, concept.id);
      if (typeof concept.webLeverage === 'string' && !WEB_LEVERAGE_RE.test(concept.webLeverage)) {
        warnings.push(`concept ${concept.id} web leverage should be checked for a specific browser-native capability`);
      }
    }
  }

  for (const well of catalog?.wells || []) {
    if (well.id && !populatedWells.has(well.id)) {
      errors.push(`well ${well.id} has no families`);
    }
  }

  if (expectedTotal !== undefined && concepts.length !== expectedTotal) {
    errors.push(`expected ${expectedTotal} concepts, found ${concepts.length}`);
  }
  if (minimumTotal !== undefined && concepts.length < minimumTotal) {
    errors.push(`expected at least ${minimumTotal} concepts, found ${concepts.length}`);
  }

  if (!Number.isInteger(reviewData?.schemaVersion) || reviewData.schemaVersion < 2) {
    errors.push('reviews.schemaVersion must be 2 or newer');
  }
  const conceptsById = new Map(concepts.map(concept => [concept.id, concept]));
  for (const [id, review] of Object.entries(reviewData?.reviews || {})) {
    if (!conceptIds.has(id)) errors.push(`review references missing concept: ${id}`);
    if (!CONCEPT_STATUSES.has(review?.status)) errors.push(`invalid review status for ${id}: ${String(review?.status)}`);
    if (typeof review?.reviewedBy !== 'string' || !review.reviewedBy.trim()) {
      errors.push(`review ${id} needs reviewedBy`);
    }
    if (typeof review?.reviewedAt !== 'string' || Number.isNaN(Date.parse(review.reviewedAt))) {
      errors.push(`review ${id} needs an ISO reviewedAt timestamp`);
    }
    if (typeof review?.formHash !== 'string' || !review.formHash.trim()) {
      errors.push(`review ${id} needs a formHash of the reviewed content`);
    } else if (conceptsById.has(id) && review.formHash !== conceptContentHash(conceptsById.get(id))) {
      errors.push(`review ${id} is stale: concept content changed since it was reviewed; reset or re-review it`);
    }
    if (review?.note !== undefined && (typeof review.note !== 'string' || !review.note.trim() || review.note.length > 500)) {
      errors.push(`review ${id} note must be a non-empty string of 500 characters or fewer`);
    }
    // Rating grades how strong an approved concept is (3 exceptional, 2 solid,
    // 1 marginal keep). Optional, approved-only, and read as a calibration
    // signal for future authoring rounds.
    if (review?.rating !== undefined) {
      if (![1, 2, 3].includes(review.rating)) {
        errors.push(`review ${id} rating must be 1, 2, or 3`);
      } else if (review.status !== 'approved') {
        errors.push(`review ${id} rating only applies to approved concepts`);
      }
    }
    // Breadth: a world too narrow to serve an arbitrary build keeps its approval
    // and leaves the challenger pool. Selection has honoured this for a while but
    // nothing validated it, so a typo would silently read as "general".
    if (review?.breadth !== undefined && !CONCEPT_BREADTHS.has(review.breadth)) {
      errors.push(`review ${id} breadth must be one of ${[...CONCEPT_BREADTHS].join(', ')}`);
    }
    // Mode eligibility: which registers of work this world can carry. Absent
    // means all of them, which is why it needs no backfill. Listing every mode
    // is the same as omitting it, and an empty list would deal nothing, so both
    // are rejected in favour of leaving the field out.
    if (review?.allowedModes !== undefined) {
      if (!Array.isArray(review.allowedModes) || review.allowedModes.length === 0) {
        errors.push(`review ${id} allowedModes must be a non-empty array, or omitted to allow every mode`);
      } else if (review.allowedModes.some(mode => !SEED_MODES.has(mode))) {
        errors.push(`review ${id} allowedModes may only contain ${[...SEED_MODES].join(', ')}`);
      } else if (new Set(review.allowedModes).size !== review.allowedModes.length) {
        errors.push(`review ${id} allowedModes must not repeat a mode`);
      } else if (review.allowedModes.length === SEED_MODES.size) {
        errors.push(`review ${id} allowedModes lists every mode; omit the field instead`);
      }
    }
  }

  const wellTierById = new Map((catalog?.wells || []).map(well => [well.id, well.tier]));
  const approved = concepts.filter(concept => reviewData?.reviews?.[concept.id]?.status === 'approved');
  const approvedTiers = new Set(
    (catalog?.families || [])
      .filter(family => family.concepts?.some(concept => reviewData?.reviews?.[concept.id]?.status === 'approved'))
      .map(family => wellTierById.get(family.well))
      .filter(tier => WELL_TIERS.includes(tier))
  );
  if (requireApprovedMinimum && approved.length < 3) errors.push('at least three concepts must be approved');
  if (requireApprovedMinimum && approvedTiers.size < WELL_TIERS.length) {
    errors.push('approved concepts must cover every challenger tier');
  }

  return {
    errors,
    warnings,
    stats: {
      wells: wellIds.size,
      families: familyIds.size,
      concepts: concepts.length,
      approved: approved.length,
      pending: concepts.length - Object.keys(reviewData?.reviews || {}).length,
      rejected: Object.values(reviewData?.reviews || {}).filter(review => review?.status === 'rejected').length,
    },
  };
}

export function approvedPoolRevision(concepts) {
  const payload = concepts
    .filter(concept => concept.status === 'approved')
    .map(concept => `${concept.familyId}:${concept.id}:${concept.strength}:${concept.form}:${concept.spark}:${JSON.stringify(concept.system)}:${concept.webLeverage}`)
    .sort()
    .join('\n');
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 12);
}

