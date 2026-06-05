import fs from 'node:fs';
import path from 'node:path';

import { finding } from '../findings.mjs';
import { GENERIC_FONTS } from '../shared/constants.mjs';
import { normalizeDimensions } from '../registry/antipatterns.mjs';

const PROPERTY_TO_RULE = {
  'font-size': 'non-token-font-size',
  'line-height': 'non-token-line-height',
  'letter-spacing': 'non-token-letter-spacing',
  'font-family': 'non-token-font-family',
};

const PROPERTY_TO_TOKEN_KEY = {
  'font-size': 'fontSize',
  'line-height': 'lineHeight',
  'letter-spacing': 'letterSpacing',
  'font-family': 'fontFamily',
};

const SKIPPED_VALUES = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer', 'normal']);

function shouldRunPersonalizedTypography(options = {}) {
  if (!options?.dimensions || options.dimensions.length === 0) return false;
  return normalizeDimensions(options.dimensions).includes('typography');
}

function startDirFor(filePath) {
  if (!filePath || filePath === '<stdin>' || /^https?:\/\//i.test(filePath)) return process.cwd();
  const resolved = path.resolve(filePath);
  try {
    const stat = fs.statSync(resolved);
    return stat.isDirectory() ? resolved : path.dirname(resolved);
  } catch {
    return path.dirname(resolved);
  }
}

function findDesignSidecar(filePath) {
  const starts = [startDirFor(filePath)];
  const visited = new Set();
  for (const start of starts) {
    let dir = start;
    while (dir && !visited.has(dir)) {
      visited.add(dir);
      const candidate = path.join(dir, '.impeccable', 'design.json');
      if (fs.existsSync(candidate)) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

function loadTypographyTokens(filePath) {
  const sidecarPath = findDesignSidecar(filePath);
  if (!sidecarPath) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
    const typography = parsed?.tokens?.typography;
    return typography && typeof typography === 'object' ? typography : null;
  } catch {
    return null;
  }
}

function normalizeCssValue(value) {
  return String(value ?? '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/\s*,\s*/g, ',')
    .replace(/\s*\(\s*/g, '(')
    .replace(/\s*\)\s*/g, ')')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function displayCssValue(value) {
  return String(value ?? '').trim().replace(/[;"'>]+$/g, '').trim();
}

function formatNumber(num) {
  if (!Number.isFinite(num)) return null;
  const rounded = Math.round(num * 1000) / 1000;
  return String(rounded).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function toPx(value) {
  const match = String(value).trim().match(/^(-?\d*\.?\d+)(px|rem|em)$/i);
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n)) return null;
  const px = match[2].toLowerCase() === 'px' ? n : n * 16;
  return `${formatNumber(px)}px`;
}

function canonicalNumericValues(value) {
  const raw = normalizeCssValue(value);
  if (!raw || raw.includes('var(') || raw.includes('{')) return [];
  const values = new Set([raw]);
  const px = toPx(raw);
  if (px) values.add(px);
  if (/^-?\d*\.?\d+$/.test(raw)) values.add(formatNumber(Number(raw)));
  return [...values].filter(Boolean);
}

function splitFontStack(value) {
  return String(value ?? '')
    .split(',')
    .map(part => part.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

function normalizeFontName(value) {
  return String(value ?? '').trim().replace(/^['"]|['"]$/g, '').toLowerCase();
}

function primaryFontName(value) {
  return splitFontStack(value).find(font => {
    const normalized = normalizeFontName(font);
    return normalized && !GENERIC_FONTS.has(normalized);
  }) || '';
}

function collectTypographyValues(input, byProp) {
  if (!input) return;
  if (Array.isArray(input)) {
    for (const item of input) collectTypographyValues(item, byProp);
    return;
  }
  if (typeof input !== 'object') return;
  for (const [key, value] of Object.entries(input)) {
    if (Object.values(PROPERTY_TO_TOKEN_KEY).includes(key) && (typeof value === 'string' || typeof value === 'number')) {
      byProp[key].push(String(value));
    } else if (value && typeof value === 'object') {
      collectTypographyValues(value, byProp);
    }
  }
}

function buildAllowedTypography(typography) {
  const byProp = {
    fontSize: [],
    lineHeight: [],
    letterSpacing: [],
    fontFamily: [],
  };
  collectTypographyValues(typography, byProp);

  const allowed = {
    'font-size': { comparable: new Set(), display: [] },
    'line-height': { comparable: new Set(), display: [] },
    'letter-spacing': { comparable: new Set(), display: [] },
    'font-family': { comparable: new Set(), display: [] },
  };

  for (const cssProp of ['font-size', 'line-height', 'letter-spacing']) {
    const tokenKey = PROPERTY_TO_TOKEN_KEY[cssProp];
    for (const value of byProp[tokenKey]) {
      for (const comparable of canonicalNumericValues(value)) allowed[cssProp].comparable.add(comparable);
      const display = displayCssValue(value);
      if (display && !allowed[cssProp].display.includes(display)) allowed[cssProp].display.push(display);
    }
  }

  for (const value of byProp.fontFamily) {
    const primary = primaryFontName(value);
    if (!primary) continue;
    const normalized = normalizeFontName(primary);
    allowed['font-family'].comparable.add(normalized);
    if (!allowed['font-family'].display.includes(primary)) allowed['font-family'].display.push(primary);
  }

  return allowed;
}

function shouldSkipObservedValue(value) {
  const normalized = normalizeCssValue(value);
  return !normalized || normalized.includes('var(') || normalized.includes('{') || SKIPPED_VALUES.has(normalized);
}

function propertyMatchesAllowed(prop, value, allowed) {
  if (prop === 'font-family') {
    const primary = primaryFontName(value);
    if (!primary) return true;
    return allowed[prop].comparable.has(normalizeFontName(primary));
  }

  const observedValues = canonicalNumericValues(value);
  if (observedValues.length === 0) return true;
  return observedValues.some(candidate => allowed[prop].comparable.has(candidate));
}

function findingSnippet(prop, value, allowed) {
  const allowedText = allowed[prop].display.join(', ');
  if (prop === 'font-family') {
    const primary = primaryFontName(value) || displayCssValue(value);
    return `font-family: "${primary}" is not in design typography families: ${allowedText}`;
  }
  return `${prop}: ${displayCssValue(value)} is not in design typography scale: ${allowedText}`;
}

function detectPersonalizedTypography(content, filePath, options = {}) {
  if (!shouldRunPersonalizedTypography(options)) return [];
  const typography = loadTypographyTokens(filePath);
  if (!typography) return [];
  const allowed = buildAllowedTypography(typography);
  const lines = String(content || '').split('\n');
  const findings = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const re = /(^|[;{\s"'])(font-size|line-height|letter-spacing|font-family)\s*:\s*([^;{}]+)/gi;
    let match;
    while ((match = re.exec(line)) !== null) {
      const prop = match[2].toLowerCase();
      const value = displayCssValue(match[3]);
      if (shouldSkipObservedValue(value)) continue;
      if (allowed[prop].comparable.size === 0) continue;
      if (propertyMatchesAllowed(prop, value, allowed)) continue;
      findings.push(finding(PROPERTY_TO_RULE[prop], filePath, findingSnippet(prop, value, allowed), i + 1));
    }
  }

  const deduped = [];
  const seen = new Set();
  for (const item of findings) {
    const key = `${item.antipattern}:${item.snippet}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

export {
  buildAllowedTypography,
  detectPersonalizedTypography,
  findDesignSidecar,
  loadTypographyTokens,
  shouldRunPersonalizedTypography,
};
