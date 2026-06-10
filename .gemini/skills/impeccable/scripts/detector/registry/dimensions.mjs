const TYPOGRAPHY_RULE_IDS = new Set([
  'overused-font',
  'single-font',
  'flat-type-hierarchy',
  'italic-serif-display',
  'hero-eyebrow-chip',
  'repeated-section-kickers',
  'oversized-h1',
  'extreme-negative-tracking',
  'tight-leading',
  'tiny-text',
  'justified-text',
  'all-caps-body',
  'wide-tracking',
  'skipped-heading',
  'line-length',
  'icon-tile-stack',
  'non-token-font-size',
  'non-token-line-height',
  'non-token-letter-spacing',
  'non-token-font-family',
  'personalized-scale-unreadable',
]);

const DIMENSION_RULE_IDS = {
  typography: TYPOGRAPHY_RULE_IDS,
};

const DIMENSION_ALIASES = {
  type: 'typography',
  typeset: 'typography',
  typography: 'typography',
};

function normalizeDimensions(dimensions = []) {
  const values = Array.isArray(dimensions) ? dimensions : [dimensions];
  const normalized = [];
  for (const value of values) {
    if (!value) continue;
    const key = String(value).trim().toLowerCase();
    if (!key) continue;
    const dimension = DIMENSION_ALIASES[key] || key;
    if (!DIMENSION_RULE_IDS[dimension]) {
      throw new Error(`Unknown detector dimension "${value}". Supported dimensions: ${Object.keys(DIMENSION_RULE_IDS).join(', ')}`);
    }
    if (!normalized.includes(dimension)) normalized.push(dimension);
  }
  return normalized;
}

function getRuleIdsForDimensions(dimensions = []) {
  const normalized = normalizeDimensions(dimensions);
  if (normalized.length === 0) return null;
  const ids = new Set();
  for (const dimension of normalized) {
    for (const id of DIMENSION_RULE_IDS[dimension]) ids.add(id);
  }
  return ids;
}

function getRulesForDimension(rules, dimension) {
  const ids = getRuleIdsForDimensions([dimension]);
  return ids ? rules.filter(rule => ids.has(rule.id)) : [];
}

function findingRuleId(finding) {
  return finding?.antipattern || finding?.id || finding?.type;
}

function filterByDimensions(findings, dimensions = []) {
  const ids = getRuleIdsForDimensions(dimensions);
  if (!ids) return findings;
  return findings.filter(finding => ids.has(findingRuleId(finding)));
}

export {
  TYPOGRAPHY_RULE_IDS,
  DIMENSION_RULE_IDS,
  findingRuleId,
  filterByDimensions,
  getRuleIdsForDimensions,
  getRulesForDimension,
  normalizeDimensions,
};
