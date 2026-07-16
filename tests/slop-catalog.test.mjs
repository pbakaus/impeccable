import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { ANTIPATTERNS } from '../cli/engine/registry/antipatterns.mjs';

const CRITIQUE_ONLY_RULES = new Set([
  'glassmorphism',
  'over-round',
  'sketchy-svg',
  'hero-metric-layout',
  'identical-card-grids',
]);

test('the Slop catalog covers every detector rule', () => {
  const source = fs.readFileSync(new URL('../site/pages/slop/index.astro', import.meta.url), 'utf8');
  const staticRuleIds = [...source.matchAll(/id="rule-([^"]+)"/g)].map((match) => match[1]);
  const catalogLists = source.match(/const CATALOG_RULE_IDS = \{([\s\S]*?)\n\};/);

  assert.ok(catalogLists, 'CATALOG_RULE_IDS should remain easy to audit');

  const dynamicRuleIds = [...catalogLists[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  const catalogRuleIds = new Set([...staticRuleIds, ...dynamicRuleIds]);
  const registryRuleIds = new Set(ANTIPATTERNS.map((rule) => rule.id));
  const missingRuleIds = [...registryRuleIds].filter((id) => !catalogRuleIds.has(id));
  const critiqueOnlyRuleIds = [...catalogRuleIds].filter((id) => !registryRuleIds.has(id));

  assert.deepEqual(missingRuleIds, []);
  assert.deepEqual(new Set(critiqueOnlyRuleIds), CRITIQUE_ONLY_RULES);
  assert.equal(catalogRuleIds.size, ANTIPATTERNS.length + CRITIQUE_ONLY_RULES.size);
});

test('new detector rules read like catalog entries, not release notes', () => {
  const source = fs.readFileSync(new URL('../site/pages/slop/index.astro', import.meta.url), 'utf8');
  const copyBlock = source.match(/const CATALOG_RULE_COPY = \{([\s\S]*?)\n\};/);

  assert.ok(copyBlock, 'CATALOG_RULE_COPY should remain easy to audit');
  assert.doesNotMatch(source, /latest detector coverage|catalog had fallen behind/i);

  const descriptions = [...copyBlock[1].matchAll(/:\s*'([^']+)'/g)].map((match) => match[1]);
  assert.equal(descriptions.length, 18);
  assert.ok(descriptions.every((description) => description.length <= 155));
});
