import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { finding } from '../findings.mjs';
import { normalizeDimensions } from '../registry/dimensions.mjs';
import { GENERIC_FONTS } from '../shared/constants.mjs';

const require = createRequire(import.meta.url);
let cssTreeLoadAttempted = false;
let cssTreeModule = null;

const TYPOGRAPHY_PROPERTIES = {
  'font-size': {
    ruleId: 'non-token-font-size',
    tokenKey: 'fontSize',
    label: 'design typography scale',
  },
  'line-height': {
    ruleId: 'non-token-line-height',
    tokenKey: 'lineHeight',
    label: 'design typography scale',
  },
  'letter-spacing': {
    ruleId: 'non-token-letter-spacing',
    tokenKey: 'letterSpacing',
    label: 'design typography scale',
  },
  'font-family': {
    ruleId: 'non-token-font-family',
    tokenKey: 'fontFamily',
    label: 'design typography families',
  },
};

const TOKEN_KEYS = new Set(Object.values(TYPOGRAPHY_PROPERTIES).map(meta => meta.tokenKey));
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

function samePath(a, b) {
  return path.resolve(a) === path.resolve(b);
}

function isWithinDir(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function isProjectBoundary(dir) {
  return fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, 'package.json'));
}

function findDesignSidecar(filePath) {
  let dir = startDirFor(filePath);
  const visited = new Set();
  const cwd = path.resolve(process.cwd());
  const cwdBoundary = isWithinDir(dir, cwd) ? cwd : null;
  while (dir && !visited.has(dir)) {
    visited.add(dir);
    const candidate = path.join(dir, '.impeccable', 'design.json');
    if (fs.existsSync(candidate)) return candidate;
    if (isProjectBoundary(dir) || (cwdBoundary && samePath(dir, cwdBoundary))) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
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
  const match = String(value).trim().match(/^(-?\d*\.?\d+)(px|rem)$/i);
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n)) return null;
  const px = match[2].toLowerCase() === 'px' ? n : n * 16;
  return `${formatNumber(px)}px`;
}

function comparableNumericValues(value) {
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

function typographyScale(typography) {
  const scale = typography?.scale;
  return scale && typeof scale === 'object' && !Array.isArray(scale) ? scale : null;
}

function scaleValues(scale, tokenKey) {
  const value = scale?.[tokenKey];
  if (Array.isArray(value)) return value.filter(item => typeof item === 'string' || typeof item === 'number');
  if (typeof value === 'string' || typeof value === 'number') return [value];
  return [];
}

function buildAllowedTypography(typography) {
  const scale = typographyScale(typography);
  const tokenValues = Object.fromEntries([...TOKEN_KEYS].map(key => [key, []]));
  if (scale) {
    for (const key of TOKEN_KEYS) tokenValues[key].push(...scaleValues(scale, key).map(String));
  }

  const allowed = Object.fromEntries(Object.keys(TYPOGRAPHY_PROPERTIES).map(prop => [
    prop,
    { comparable: new Set(), display: [] },
  ]));

  for (const [prop, meta] of Object.entries(TYPOGRAPHY_PROPERTIES)) {
    for (const value of tokenValues[meta.tokenKey]) {
      const display = displayCssValue(value);
      if (display && !allowed[prop].display.includes(display)) allowed[prop].display.push(display);

      if (prop === 'font-family') {
        const primary = primaryFontName(value);
        if (primary) allowed[prop].comparable.add(normalizeFontName(primary));
        continue;
      }

      for (const comparable of comparableNumericValues(value)) {
        allowed[prop].comparable.add(comparable);
      }
    }
  }

  return allowed;
}

function hasAllowedTypography(allowed) {
  return Object.values(allowed).some(entry => entry.comparable.size > 0);
}

function getCssTree() {
  if (cssTreeLoadAttempted) return cssTreeModule;
  cssTreeLoadAttempted = true;
  try {
    cssTreeModule = require('css-tree');
  } catch {
    cssTreeModule = null;
  }
  return cssTreeModule;
}

function lineAt(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function extractCssSegments(content) {
  const text = String(content || '');
  const segments = [];
  const firstHtmlTag = text.search(/<!doctype|<html|<head|<body/i);
  const leadingCss = firstHtmlTag === -1 ? text : text.slice(0, firstHtmlTag);
  if (leadingCss.trim()) segments.push({ text: leadingCss, startLine: 1, context: 'stylesheet' });

  const styleBlockRe = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let match;
  while ((match = styleBlockRe.exec(text)) !== null) {
    const cssStart = match.index + match[0].indexOf(match[1]);
    if (match[1].trim()) {
      segments.push({ text: match[1], startLine: lineAt(text, cssStart), context: 'stylesheet' });
    }
  }

  const styleAttrRe = /\bstyle\s*=\s*(["'])([\s\S]*?)\1/gi;
  while ((match = styleAttrRe.exec(text)) !== null) {
    if (match[2].trim()) {
      segments.push({ text: match[2], startLine: lineAt(text, match.index), context: 'declarationList' });
    }
  }

  return segments.length ? segments : [{ text, startLine: 1, context: 'stylesheet' }];
}

function parseCssDeclarations(segment) {
  const cssTree = getCssTree();
  if (!cssTree) throw new Error('css-tree unavailable');
  const { generate, parse, walk } = cssTree;
  const declarations = [];
  const ast = parse(segment.text, {
    context: segment.context,
    positions: true,
    parseValue: true,
    parseCustomProperty: false,
  });

  walk(ast, (node) => {
    if (node.type !== 'Declaration') return;
    const property = String(node.property || '').toLowerCase();
    if (!TYPOGRAPHY_PROPERTIES[property]) return;
    declarations.push({
      property,
      value: generate(node.value).trim(),
      line: segment.startLine + (node.loc?.start?.line || 1) - 1,
    });
  });

  return declarations;
}

function fallbackDeclarations(segment) {
  const declarations = [];
  const lines = segment.text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const re = /(^|[;{\s"'])(font-size|line-height|letter-spacing|font-family)\s*:\s*([^;{}]+)/gi;
    let match;
    while ((match = re.exec(lines[i])) !== null) {
      declarations.push({
        property: match[2].toLowerCase(),
        value: displayCssValue(match[3]),
        line: segment.startLine + i,
      });
    }
  }
  return declarations;
}

function extractTypographyDeclarations(content) {
  const declarations = [];
  for (const segment of extractCssSegments(content)) {
    try {
      declarations.push(...parseCssDeclarations(segment));
    } catch {
      declarations.push(...fallbackDeclarations(segment));
    }
  }
  return declarations;
}

function shouldSkipObservedValue(value) {
  const normalized = normalizeCssValue(value);
  return !normalized
    || normalized.includes('var(')
    || normalized.includes('{')
    || normalized.includes('$')
    || normalized.includes('@')
    || normalized.includes('#{')
    || SKIPPED_VALUES.has(normalized);
}

function propertyMatchesAllowed(prop, value, allowed) {
  if (prop === 'font-family') {
    const primary = primaryFontName(value);
    if (!primary) return true;
    return allowed[prop].comparable.has(normalizeFontName(primary));
  }

  const observedValues = comparableNumericValues(value);
  if (observedValues.length === 0) return true;
  return observedValues.some(candidate => allowed[prop].comparable.has(candidate));
}

function findingSnippet(prop, value, allowed) {
  const meta = TYPOGRAPHY_PROPERTIES[prop];
  const allowedText = allowed[prop].display.join(', ');
  if (prop === 'font-family') {
    const primary = primaryFontName(value) || displayCssValue(value);
    return `font-family: "${primary}" is not in ${meta.label}: ${allowedText}`;
  }
  return `${prop}: ${displayCssValue(value)} is not in ${meta.label}: ${allowedText}`;
}

function detectPersonalizedTypography(content, filePath, options = {}) {
  if (!shouldRunPersonalizedTypography(options)) return [];
  const typography = loadTypographyTokens(filePath);
  if (!typography) return [];

  const scale = typographyScale(typography);
  if (!scale) return [];
  const allowed = buildAllowedTypography(typography);
  if (!hasAllowedTypography(allowed)) {
    return [finding(
      'personalized-scale-unreadable',
      filePath,
      'tokens.typography.scale exists but contains no usable fontSize, lineHeight, letterSpacing, or fontFamily values',
    )];
  }
  const findings = [];

  for (const declaration of extractTypographyDeclarations(content)) {
    const { property, value, line } = declaration;
    if (shouldSkipObservedValue(value)) continue;
    if (allowed[property].comparable.size === 0) continue;
    if (propertyMatchesAllowed(property, value, allowed)) continue;
    findings.push(finding(
      TYPOGRAPHY_PROPERTIES[property].ruleId,
      filePath,
      findingSnippet(property, value, allowed),
      line,
    ));
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
  extractTypographyDeclarations,
  findDesignSidecar,
  hasAllowedTypography,
  loadTypographyTokens,
  shouldRunPersonalizedTypography,
  typographyScale,
};
