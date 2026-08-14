import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CONCEPT_STATUSES, normalizeConceptForm } from './concept-catalog.mjs';
// Defined in roll-selection.mjs for the same reason WELL_TIERS is: this file
// reads the filesystem, and the roll API imports the taxonomy to validate its
// grain and platform parameters. Re-exported so importers have one place to look.
import { COMPOSITION_GRAINS, COMPOSITION_PLATFORMS, isGrain, isPlatform } from './roll-selection.mjs';
export { COMPOSITION_GRAINS, COMPOSITION_PLATFORMS, isGrain, isPlatform };

// Catalog B: compositions rather than styles. A composition organizes attention,
// sequence, or manipulation on a surface and must survive being dressed in
// any committed visual identity; it deliberately carries no palette or type
// half. Surface-scope seeds draw from here (plus catalog A duals); direction
// seeds pair one composition with a chosen world for the first surface.

export const COMPOSITION_GRAMMAR_PREFIXES = [
  'Staging/hierarchy:',
  'Sequence/attention:',
  'Controls/state:',
  'Adaptation:',
];

// Surfaces align with the skill's modes: a persuade composition and an operate
// composition are different species, and read/experience surfaces get their own.
export const COMPOSITION_SURFACES = new Set(['persuade', 'operate', 'read', 'experience']);


export function compositionContentHash(composition) {
  const payload = [
    composition?.form ?? '',
    composition?.lineage ?? '',
    JSON.stringify(composition?.tags ?? []),
    JSON.stringify(composition?.grammar ?? []),
    composition?.spark ?? '',
    composition?.webLeverage ?? '',
  ].join('\n');
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 12);
}

export function validateCompositionEntry(composition, { existingForms = new Map() } = {}) {
  const errors = [];
  const id = composition?.id || '(unknown)';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(composition?.id || '')) {
    errors.push(`invalid composition id: ${String(composition?.id)}`);
  }
  const normalized = normalizeConceptForm(composition?.form);
  if (!normalized) {
    errors.push(`composition ${id} needs a form`);
  } else if (existingForms.has(normalized)) {
    errors.push(`duplicate composition form: ${id} and ${existingForms.get(normalized)}`);
  }
  if (typeof composition?.form !== 'string'
    || composition.form.trim().length < 40
    || composition.form.trim().length > 360
    || !composition.form.includes(',')) {
    errors.push(`composition ${id} must name a staging and its structural mechanism after a comma`);
  }
  if (typeof composition?.lineage !== 'string'
    || composition.lineage.trim().length < 12
    || composition.lineage.trim().length > 200) {
    errors.push(`composition ${id} needs lineage metadata of 12–200 characters`);
  }
  if (!COMPOSITION_SURFACES.has(composition?.surface)) {
    errors.push(`composition ${id} needs a surface of ${[...COMPOSITION_SURFACES].join(', ')}`);
  }
  // Grain: how much of the product this composes. Optional, and absence means
  // eligible at any grain, so nothing needs backfilling.
  if (composition?.grain !== undefined && composition.grain !== null && !isGrain(composition.grain)) {
    errors.push(`composition ${id} grain "${composition.grain}" must be one of ${COMPOSITION_GRAINS.join(', ')}`);
  }
  // Platforms this composition survives. Absence means all of them, so listing
  // every platform is the same as omitting the field and is rejected in favour of
  // leaving it out; an empty array would exclude the entry from every roll.
  if (composition?.platforms !== undefined && composition.platforms !== null) {
    const list = composition.platforms;
    if (!Array.isArray(list) || list.length === 0) {
      errors.push(`composition ${id} platforms must be a non-empty array, or omitted to allow every platform`);
    } else if (list.some(entry => !isPlatform(entry))) {
      errors.push(`composition ${id} platforms may only contain ${COMPOSITION_PLATFORMS.join(', ')}`);
    } else if (new Set(list).size !== list.length) {
      errors.push(`composition ${id} platforms must not repeat a platform`);
    } else if (list.length === COMPOSITION_PLATFORMS.length) {
      errors.push(`composition ${id} platforms lists every platform; omit the field instead`);
    }
  }
  if (!Array.isArray(composition?.tags)
    || composition.tags.length !== 3
    || composition.tags.some(tag => typeof tag !== 'string' || !tag.trim())) {
    errors.push(`composition ${id} must have exactly three structural tags`);
  }
  if (!Array.isArray(composition?.grammar)
    || composition.grammar.length !== COMPOSITION_GRAMMAR_PREFIXES.length
    || composition.grammar.some(rule => typeof rule !== 'string' || rule.trim().length < 12 || rule.trim().length > 180)) {
    errors.push(`composition ${id} needs grammar with exactly four rules of 12–180 characters`);
  } else {
    const unique = new Set(composition.grammar.map(normalizeConceptForm));
    if (unique.size !== COMPOSITION_GRAMMAR_PREFIXES.length) {
      errors.push(`composition ${id} has duplicate grammar rules`);
    }
    if (composition.grammar.some((rule, index) => !rule.startsWith(COMPOSITION_GRAMMAR_PREFIXES[index]))) {
      errors.push(`composition ${id} grammar must use staging, sequence, controls, and adaptation prefixes in order`);
    }
  }
  if (typeof composition?.spark !== 'string'
    || composition.spark.trim().length < 80
    || composition.spark.trim().length > 320) {
    errors.push(`composition ${id} needs a vivid spark of 80–320 characters`);
  }
  if (typeof composition?.webLeverage !== 'string'
    || composition.webLeverage.trim().length < 20
    || composition.webLeverage.trim().length > 240) {
    errors.push(`composition ${id} needs web leverage of 20–240 characters`);
  }
  return errors;
}

export function readCompositionCatalog(catalogPath, reviewsPath) {
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  const reviewData = JSON.parse(readFileSync(reviewsPath, 'utf8'));
  const reviews = reviewData.reviews || {};
  const familiesById = new Map((catalog.families || []).map(family => [family.id, family]));
  const compositions = (catalog.compositions || []).map(composition => ({
    ...composition,
    familyLabel: familiesById.get(composition.familyId)?.label || null,
    status: reviews[composition.id]?.status || 'pending',
    review: reviews[composition.id] || null,
  }));
  return { catalog, reviewData, reviews, compositions };
}

export function validateCompositionCatalog(catalog, reviewData, { minimumTotal } = {}) {
  const errors = [];
  const familyIds = new Set();
  const ids = new Set();
  const forms = new Map();

  if (!Number.isInteger(catalog?.schemaVersion) || catalog.schemaVersion < 1) {
    errors.push('composition catalog schemaVersion must be a positive integer');
  }
  if (typeof catalog?.qualityBar?.principle !== 'string' || catalog.qualityBar.principle.trim().length < 80) {
    errors.push('composition qualityBar.principle must define the staging bar');
  }
  if (!Array.isArray(catalog?.families) || catalog.families.length < 4) {
    errors.push('composition catalog needs at least four families');
  }
  for (const family of catalog?.families || []) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(family.id || '')) errors.push(`invalid composition family id: ${String(family.id)}`);
    if (familyIds.has(family.id)) errors.push(`duplicate composition family id: ${family.id}`);
    familyIds.add(family.id);
    if (typeof family.description !== 'string' || family.description.trim().length < 40) {
      errors.push(`composition family ${family.id || '(unknown)'} needs a description`);
    }
  }
  for (const composition of catalog?.compositions || []) {
    if (ids.has(composition.id)) errors.push(`duplicate composition id: ${composition.id}`);
    ids.add(composition.id);
    if (!familyIds.has(composition.familyId)) {
      errors.push(`composition ${composition.id} must belong to a declared family, got: ${String(composition.familyId)}`);
    }
    errors.push(...validateCompositionEntry(composition, { existingForms: forms }));
    const normalized = normalizeConceptForm(composition.form);
    if (normalized) forms.set(normalized, composition.id);
  }
  if (minimumTotal !== undefined && (catalog?.compositions || []).length < minimumTotal) {
    errors.push(`expected at least ${minimumTotal} compositions, found ${(catalog?.compositions || []).length}`);
  }
  for (const [id, review] of Object.entries(reviewData?.reviews || {})) {
    if (!ids.has(id)) errors.push(`composition review references missing entry: ${id}`);
    if (!CONCEPT_STATUSES.has(review?.status)) errors.push(`invalid composition review status for ${id}`);
    if (typeof review?.formHash !== 'string' || !review.formHash.trim()) {
      errors.push(`composition review ${id} needs a formHash`);
    } else {
      const entry = (catalog?.compositions || []).find(composition => composition.id === id);
      if (entry && review.formHash !== compositionContentHash(entry)) {
        errors.push(`composition review ${id} is stale: content changed since review`);
      }
    }
    // Mirrors the concept catalog: an optional 1-3 grade on approved entries
    // only, read as a calibration signal and used to weight challenger draws.
    if (review?.rating !== undefined) {
      if (![1, 2, 3].includes(review.rating)) {
        errors.push(`review ${id} rating must be 1, 2, or 3`);
      } else if (review.status !== 'approved') {
        errors.push(`review ${id} rating only applies to approved compositions`);
      }
    }
    if (review?.note !== undefined && (typeof review.note !== 'string' || !review.note.trim() || review.note.length > 500)) {
      errors.push(`composition review ${id} note must be a non-empty string of 500 characters or fewer`);
    }
  }
  return {
    errors,
    stats: {
      families: familyIds.size,
      compositions: (catalog?.compositions || []).length,
      approved: Object.values(reviewData?.reviews || {}).filter(review => review?.status === 'approved').length,
      rejected: Object.values(reviewData?.reviews || {}).filter(review => review?.status === 'rejected').length,
    },
  };
}
