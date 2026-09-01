/**
 * Svelte live-mode component injection helpers.
 *
 * Variants are real .svelte components under node_modules/.impeccable-live/<session-id>/.
 * The browser mounts them via Svelte 5 mount(); accept inlines the chosen
 * variant back into the route source with props mapped to original bindings.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import {
  analyzeSvelteMarkup,
  buildPropsScriptV2,
  loadSvelteCompiler,
  restoreSvelteMarkup,
} from './svelte-ast.mjs';
import {
  bakeParamValues,
  collectAllSelectors,
  collectUnusedSelectors,
  normalizeSelector,
  parseStylesheet,
  pruneUnusedSelectors,
  reconcileCss,
  serializeNodes,
  splitSelectorList,
} from './accept-css.mjs';
import { verifyAcceptedSource } from './accept-verify.mjs';

// Preview modules stay under node_modules on purpose: SvelteKit restricts
// vite's server.fs.allow to src/lib, src/routes, .svelte-kit, and
// node_modules, so an .impeccable/ tree under the app root 403s (verified
// against a real SvelteKit dev server). Staleness from node_modules being
// unwatched is solved by REVISIONED module paths instead: every publish
// snapshots the variant files into a fresh r<N>/ directory and the browser
// imports from there, so a republished fix can never be pinned by a
// transform cache keyed on the old path.
export const SVELTE_COMPONENT_ROOT = 'node_modules/.impeccable-live';
// A short-lived interim location; swept so no project keeps a stray tree.
export const LEGACY_SVELTE_COMPONENT_ROOT = '.impeccable/live/previews';
export const SVELTE_RUNTIME_FILE = `${SVELTE_COMPONENT_ROOT}/__runtime.js`;
export const SVELTE_PROBE_FILE = `${SVELTE_COMPONENT_ROOT}/__probe.js`;
export const DEFERRED_ACCEPTS_FILE = '.impeccable/live/deferred-svelte-component-accepts.json';

const MUSTACHE_RE = /\{([^{}]+)\}/g;

export function shouldUseSvelteComponentInjection(filePath) {
  if (/^(0|false|no)$/i.test(process.env.IMPECCABLE_LIVE_SVELTE_COMPONENT || '')) return false;
  return path.extname(filePath).toLowerCase() === '.svelte';
}

export function componentSessionDir(id, cwd = process.cwd()) {
  return path.join(cwd, SVELTE_COMPONENT_ROOT, id);
}

export function manifestPathForSession(id, cwd = process.cwd()) {
  return path.join(componentSessionDir(id, cwd), 'manifest.json');
}

export function ensureRuntimeHelper(cwd = process.cwd()) {
  const file = path.join(cwd, SVELTE_RUNTIME_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, `export { mount, unmount } from 'svelte';\n`, 'utf-8');
  }
  // Attach-time probe: the browser imports this through the dev server before
  // the first mount. A 404 here means the resolved app root and the dev
  // server's root disagree, and the session fails with a named error instead
  // of a silent fall-back to the picker at first variant.
  const probe = path.join(cwd, SVELTE_PROBE_FILE);
  if (!fs.existsSync(probe)) {
    fs.writeFileSync(probe, `export const impeccableLivePreviewProbe = true;\n`, 'utf-8');
  }
  return file;
}

/**
 * Extract ordered unique mustache expressions from markup (not inside <!-- -->).
 */
export function extractMustacheExpressions(text) {
  const expressions = [];
  const seen = new Set();
  const lines = String(text || '').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('<!--')) continue;
    let match;
    MUSTACHE_RE.lastIndex = 0;
    while ((match = MUSTACHE_RE.exec(line)) !== null) {
      const expr = match[1].trim();
      if (!expr || seen.has(expr)) continue;
      seen.add(expr);
      expressions.push(expr);
    }
  }
  return expressions;
}

export function buildPropContract(expressions) {
  return expressions.map((expr, index) => {
    const derived = derivePropName(expr, index);
    return {
      prop: derived,
      expr,
      placeholder: `{${expr}}`,
    };
  });
}

function derivePropName(expr, index) {
  const tail = expr.match(/(?:\.|\[)(\w+)\s*\]?$/);
  if (tail && tail[1] && /^[A-Za-z_$][\w$]*$/.test(tail[1])) {
    return tail[1];
  }
  return `prop${index}`;
}

export function substituteExprsWithProps(markup, contract) {
  let out = String(markup || '');
  for (const entry of contract) {
    out = out.split(entry.placeholder).join(`{${entry.prop}}`);
  }
  return out;
}

export function substitutePropsWithExprs(markup, contract) {
  let out = String(markup || '');
  for (const entry of contract) {
    out = out.split(`{${entry.prop}}`).join(`{${entry.expr}}`);
  }
  return out;
}

export function parseSvelteComponentFile(content) {
  const text = String(content || '');
  const scriptMatch = text.match(/^([\s\S]*?)<script\b[^>]*>[\s\S]*?<\/script>/i);
  const withoutScript = scriptMatch ? text.slice(scriptMatch[0].length) : text;
  const styleMatch = withoutScript.match(/<style\b[^>]*>[\s\S]*?<\/style\s*>/i);
  const styleBlock = styleMatch ? styleMatch[0] : '';
  const markup = styleMatch
    ? withoutScript.slice(0, styleMatch.index).trim()
    : withoutScript.trim();
  const cssLines = styleBlock
    ? styleBlock
      .replace(/^<style\b[^>]*>/i, '')
      .replace(/<\/style\s*>$/i, '')
      .split('\n')
      .map((line) => line.trimEnd())
    : [];
  while (cssLines.length > 0 && cssLines[0].trim() === '') cssLines.shift();
  while (cssLines.length > 0 && cssLines[cssLines.length - 1].trim() === '') cssLines.pop();
  return { markup, cssLines, styleBlock };
}

// A JSDoc `@type` directly before a destructuring declaration is JSDoc cast
// syntax, and Svelte 5.50+ re-emits it onto the template's own declaration as
// `var /** @type {...} */ (h1) = root()`, which does not parse. The browser's
// import of the variant then fails with "Unexpected token '('" and the session
// shows nothing. `@typedef` documents the same shape without being a cast.
// tests/live-svelte-props-script.test.mjs compiles and parses what this emits.
function buildPropsScript(contract) {
  if (contract.length === 0) {
    return '<script>\n  /** @typedef {Record<string, never>} Props */\n  let {} = $props();\n</script>\n';
  }
  const names = contract.map((c) => c.prop).join(', ');
  const typeFields = contract.map((c) => `    ${c.prop}: string;`).join('\n');
  return `<script>\n  /** @typedef {{\n${typeFields}\n  }} Props */\n  let { ${names} } = $props();\n</script>\n`;
}

function buildVariantStub(variantNum, originalWithProps, contract) {
  const propsComment = contract.length > 0
    ? `\n<!-- Props: ${contract.map((c) => `${c.prop} <- {${c.expr}}`).join(', ')} -->\n`
    : '';
  return `${buildPropsScript(contract)}${propsComment}${originalWithProps.trim()}\n\n<style>\n  /* Variant ${variantNum}: add scoped CSS here */\n</style>\n`;
}

function buildInsertVariantStub(variantNum) {
  return `${buildPropsScript([])}<div class="impeccable-insert-preview">Insert variant ${variantNum}</div>\n\n<style>\n  .impeccable-insert-preview { display: block; }\n</style>\n`;
}

/**
 * Scaffold a component-preview session. The scaffold is AST-based: the app's
 * own svelte compiler parses the selected markup, control-flow blocks are
 * preserved (an each collection crosses the prop contract as ONE structured
 * prop, its loop body verbatim), and constructs a detached preview cannot
 * support return `{ fallback: 'source-preview', reason }` so the caller keeps
 * the markup inside the route file instead of shipping a wrong preview.
 */
export function scaffoldSvelteComponentSession({
  id,
  count,
  sourceFile,
  sourceStartLine,
  sourceEndLine,
  originalLines,
  cwd = process.cwd(),
}) {
  const originalMarkup = originalLines.join('\n');

  const compiler = loadSvelteCompiler(cwd);
  if (!compiler) {
    return { fallback: 'source-preview', reason: 'svelte 5 compiler not resolvable from the app root' };
  }
  const analysis = analyzeSvelteMarkup(originalMarkup, compiler.parse);
  if (!analysis.ok) {
    return { fallback: 'source-preview', reason: analysis.reason };
  }

  ensureRuntimeHelper(cwd);
  const dir = componentSessionDir(id, cwd);
  fs.mkdirSync(dir, { recursive: true });

  const contract = analysis.contract;
  const seeded = extractMatchingSourceCss(
    safeReadSource(path.resolve(cwd, sourceFile)),
    originalMarkup,
  );
  const seededCss = seeded.css;
  // The preview compiles in isolation, so NONE of these source rules applied
  // to what the user approved. Accept enforces that preview truth: any of
  // them the variant does not re-declare is superseded and removed, instead
  // of re-attaching to the accepted markup through kept class names (the
  // ".decisions grid grabs the new board" failure). Only the CLASS-matched
  // selectors are candidates; tag rules style shared route elements.
  const seededSelectors = [...seeded.supersedable];

  const manifest = {
    id,
    previewMode: 'svelte-component',
    contractVersion: 2,
    sourceFile: sourceFile.split(path.sep).join('/'),
    sourceStartLine,
    sourceEndLine,
    count,
    propContract: contract,
    originalMarkup,
    seededSelectors,
    componentDir: path.relative(cwd, dir).split(path.sep).join('/'),
    // Absolute paths let the browser fall back to /@fs/ imports when the dev
    // server's base or root makes root-relative URLs miss, and probe whether
    // the preview tree is reachable at all before blaming a variant.
    componentDirAbs: dir.split(path.sep).join('/'),
    runtimeModule: `/${SVELTE_RUNTIME_FILE}`,
    runtimeModuleAbs: path.join(cwd, SVELTE_RUNTIME_FILE).split(path.sep).join('/'),
    probeModule: `/${SVELTE_PROBE_FILE}`,
    probeModuleAbs: path.join(cwd, SVELTE_PROBE_FILE).split(path.sep).join('/'),
  };

  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

  for (let n = 1; n <= count; n++) {
    const variantFile = path.join(dir, `v${n}.svelte`);
    if (!fs.existsSync(variantFile)) {
      fs.writeFileSync(variantFile, buildVariantStubV2(n, analysis.markupWithProps, contract, seededCss), 'utf-8');
    }
  }

  return {
    manifest,
    manifestFile: path.relative(cwd, path.join(dir, 'manifest.json')).split(path.sep).join('/'),
    componentDir: manifest.componentDir,
    propContract: contract,
    // Inlined so the generate event's scaffold payload carries the stub
    // shape; the agent edits vN.svelte in place instead of spending reads on
    // the manifest and stub files (or deleting and recreating them).
    stubMarkup: analysis.markupWithProps,
    seededCss,
  };
}

function safeReadSource(filePath) {
  try { return fs.readFileSync(filePath, 'utf-8'); } catch { return ''; }
}

function escapeSelectorToken(token) {
  return String(token).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Seed variant stubs with the source component's rules that already style the
 * selected markup, so variants start from the real cascade (a detached
 * preview inherits none of the route's compile-scoped CSS) instead of
 * reimplementing it blind.
 *
 * Returns { css, supersedable }. `css` is every matching rule (class OR tag
 * matched). `supersedable` holds only the CLASS-matched selectors: those are
 * the accept-time removal candidates. Tag selectors (h1, a, p) style shared
 * elements across the whole route, so they seed the preview but are never
 * candidates for removal.
 */
export function extractMatchingSourceCss(routeSource, originalMarkup) {
  const empty = { css: '', supersedable: new Set() };
  const styleMatch = String(routeSource || '').match(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/i);
  if (!styleMatch) return empty;
  const classNames = new Set();
  const classRe = /class\s*=\s*(["'])(.*?)\1/g;
  let m;
  while ((m = classRe.exec(originalMarkup))) {
    for (const cls of m[2].split(/\s+/)) if (cls && !cls.includes('{')) classNames.add(cls);
  }
  const tagRe = /<([a-z][a-z0-9-]*)/gi;
  const tags = new Set();
  while ((m = tagRe.exec(originalMarkup))) tags.add(m[1].toLowerCase());
  if (classNames.size === 0 && tags.size === 0) return empty;

  // Token-boundary matching, never substring: `.btn` must not match
  // `.btn-primary`, and `.stage` must not match `.stages`. A substring hit
  // seeds a rule that never styled the pick, and a falsely seeded selector
  // becomes an accept-time DELETION of a hand-written rule.
  const classRes = [...classNames].map((cls) => new RegExp('\\.' + escapeSelectorToken(cls) + '(?![A-Za-z0-9_-])'));
  const tagRes = [...tags].map((tag) => new RegExp('(^|[\\s>+~,(])' + escapeSelectorToken(tag) + '(?![A-Za-z0-9_-])', 'i'));
  const classMatches = (selector) => classRes.some((re) => re.test(selector));
  const tagMatches = (selector) => tagRes.some((re) => re.test(selector));

  const supersedable = new Set();
  const ruleMatches = (prelude) => {
    let matched = false;
    for (const selector of splitSelectorList(prelude)) {
      if (classMatches(selector)) {
        matched = true;
        supersedable.add(normalizeSelector(selector));
      } else if (tagMatches(selector)) {
        matched = true;
      }
    }
    return matched;
  };

  const pick = (nodes) => {
    const kept = [];
    for (const node of nodes) {
      if (node.type === 'rule' && ruleMatches(node.prelude)) kept.push(node);
      else if (node.type === 'at' && node.children) {
        const children = pick(node.children);
        if (children.length) kept.push({ ...node, children });
      }
    }
    return kept;
  };
  return { css: serializeNodes(pick(parseStylesheet(styleMatch[1]))), supersedable };
}

function buildVariantStubV2(variantNum, markupWithProps, contract, seededCss) {
  const propsComment = contract.length > 0
    ? `\n<!-- Props: ${contract.map((c) => `${c.prop} (${c.kind}) <- {${c.expr}}`).join(', ')} -->\n`
    : '';
  // The guard comments must never contain the literal "<style" character
  // sequence: agents (and the fake test agent) locate the style block with
  // string searches, and a mention inside a comment truncates their surgery
  // mid-comment.
  const css = seededCss
    ? `\n<style>\n  /* Variant ${variantNum}: seeded from the route's current rules; restyle or delete freely.\n     ALL rules go inside THIS block. Svelte allows exactly one top-level style\n     element per component; appending a second one is a compile error. */\n${seededCss.split('\n').map((l) => (l.trim() ? '  ' + l : '')).join('\n')}\n</style>\n`
    : `\n<style>\n  /* Variant ${variantNum}: add all CSS inside THIS block. Svelte allows exactly\n     one top-level style element; a second one is a compile error. */\n</style>\n`;
  return `${buildPropsScriptV2(contract)}${propsComment}${markupWithProps.trim()}\n${css}`;
}

export function scaffoldSvelteComponentInsertSession({
  id,
  count,
  sourceFile,
  insertLine,
  position,
  anchorStartLine,
  anchorEndLine,
  anchorLines,
  cwd = process.cwd(),
}) {
  ensureRuntimeHelper(cwd);
  const dir = componentSessionDir(id, cwd);
  fs.mkdirSync(dir, { recursive: true });

  const anchorMarkup = (anchorLines || []).join('\n');
  const manifest = {
    id,
    mode: 'insert',
    previewMode: 'svelte-component',
    sourceFile: sourceFile.split(path.sep).join('/'),
    insertLine,
    position,
    anchorStartLine,
    anchorEndLine,
    originalMarkup: anchorMarkup,
    anchorMarkup,
    count,
    propContract: [],
    componentDir: path.relative(cwd, dir).split(path.sep).join('/'),
    componentDirAbs: dir.split(path.sep).join('/'),
    runtimeModule: `/${SVELTE_RUNTIME_FILE}`,
    runtimeModuleAbs: path.join(cwd, SVELTE_RUNTIME_FILE).split(path.sep).join('/'),
    probeModule: `/${SVELTE_PROBE_FILE}`,
    probeModuleAbs: path.join(cwd, SVELTE_PROBE_FILE).split(path.sep).join('/'),
  };

  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

  for (let n = 1; n <= count; n++) {
    const variantFile = path.join(dir, `v${n}.svelte`);
    if (!fs.existsSync(variantFile)) {
      fs.writeFileSync(variantFile, buildInsertVariantStub(n), 'utf-8');
    }
  }

  return {
    manifest,
    manifestFile: path.relative(cwd, path.join(dir, 'manifest.json')).split(path.sep).join('/'),
    componentDir: manifest.componentDir,
    propContract: [],
  };
}

export function findSvelteComponentManifest(id, cwd = process.cwd()) {
  const direct = manifestPathForSession(id, cwd);
  if (fs.existsSync(direct)) {
    return readManifest(direct);
  }
  // Legacy location: a session scaffolded by an older version can still be
  // accepted after an upgrade.
  const legacyDirect = path.join(cwd, LEGACY_SVELTE_COMPONENT_ROOT, id, 'manifest.json');
  if (fs.existsSync(legacyDirect)) {
    return readManifest(legacyDirect);
  }
  for (const rootRel of [SVELTE_COMPONENT_ROOT, LEGACY_SVELTE_COMPONENT_ROOT]) {
    const root = path.join(cwd, rootRel);
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(root, entry.name, 'manifest.json');
      if (!fs.existsSync(candidate)) continue;
      try {
        const manifest = readManifest(candidate);
        if (manifest?.id === id) return { ...manifest, manifestPath: candidate };
      } catch { /* skip */ }
    }
  }
  return null;
}

export function readManifest(manifestPath) {
  const data = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  return {
    ...data,
    manifestPath,
  };
}

export function resolveSourceFile(sourceFile, cwd = process.cwd()) {
  if (!sourceFile || path.isAbsolute(sourceFile)) {
    throw new Error('Invalid svelte-component source file');
  }
  const full = path.resolve(cwd, sourceFile);
  const rel = path.relative(cwd, full);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Svelte-component source file escapes project root');
  }
  if (!fs.existsSync(full)) {
    throw new Error('Svelte-component source file not found: ' + sourceFile);
  }
  return full;
}

function appendCssToSvelteStyle(lines, cssLines) {
  const closeIdx = findLastStyleCloseLine(lines);
  const prepared = ['', ...cssLines.map((line) => (line.trim() === '' ? '' : '  ' + line.trimStart()))];
  if (closeIdx === -1) {
    return [...lines, '', '<style>', ...prepared.slice(1), '</style>'];
  }
  return [
    ...lines.slice(0, closeIdx),
    ...prepared,
    ...lines.slice(closeIdx),
  ];
}

function findLastStyleCloseLine(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/<\/style\s*>/.test(lines[i])) return i;
  }
  return -1;
}

function bakeParamValuesInCss(cssLines, paramValues) {
  if (!paramValues || Object.keys(paramValues).length === 0) return cssLines;
  return cssLines.map((line) => {
    let out = line;
    for (const [key, value] of Object.entries(paramValues)) {
      const varName = `--p-${key}`;
      out = out.replace(new RegExp(`var\\(${escapeRegExp(varName)}(?:,\\s*[^)]+)?\\)`, 'g'), String(value));
    }
    return out;
  });
}

function sanitizeAcceptedSvelteCss(cssLines, variantNum, paramValues = null, rootTag = 'div') {
  const css = String((cssLines || []).join('\n'));
  if (!/data-impeccable-variant|impeccable-variant-ready/.test(css)) return cssLines;

  const rules = parseCssRules(css);
  const output = [];
  for (const rule of rules) {
    appendSanitizedCssRule(output, rule, variantNum, paramValues, rootTag);
  }
  return output.join('\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '');
}

function appendSanitizedCssRule(output, rule, variantNum, paramValues, rootTag) {
  const prelude = rule.prelude.trim();
  const body = rule.body.trim();
  if (!prelude || !body || /--impeccable-variant-ready\s*:/.test(body)) return;

  if (/^@scope\b/i.test(prelude)) {
    if (/data-impeccable-variant/.test(prelude) && !selectorHasVariant(prelude, variantNum)) return;
    const inner = parseCssRules(body);
    for (const innerRule of inner) {
      const rewrittenPrelude = rewriteAcceptedSvelteSelector(innerRule.prelude, variantNum, paramValues, rootTag, true);
      if (!rewrittenPrelude || /--impeccable-variant-ready\s*:/.test(innerRule.body)) continue;
      output.push(formatCssRule(rewrittenPrelude, innerRule.body.trim()));
    }
    return;
  }

  const rewrittenPrelude = rewriteAcceptedSvelteSelector(prelude, variantNum, paramValues, rootTag, false);
  if (!rewrittenPrelude) return;
  output.push(formatCssRule(rewrittenPrelude, body));
}

function parseCssRules(css) {
  const rules = [];
  const text = String(css || '');
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i++;
    const preludeStart = i;
    while (i < text.length && text[i] !== '{') i++;
    if (i >= text.length) break;
    const prelude = text.slice(preludeStart, i).trim();
    i++;
    const bodyStart = i;
    let depth = 1;
    let quote = null;
    let comment = false;
    while (i < text.length && depth > 0) {
      const ch = text[i];
      const next = text[i + 1];
      if (comment) {
        if (ch === '*' && next === '/') {
          comment = false;
          i += 2;
          continue;
        }
        i++;
        continue;
      }
      if (quote) {
        if (ch === '\\') {
          i += 2;
          continue;
        }
        if (ch === quote) quote = null;
        i++;
        continue;
      }
      if (ch === '/' && next === '*') {
        comment = true;
        i += 2;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        i++;
        continue;
      }
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      i++;
    }
    const body = text.slice(bodyStart, Math.max(bodyStart, i - 1));
    if (prelude) rules.push({ prelude, body });
  }
  return rules;
}

function rewriteAcceptedSvelteSelector(prelude, variantNum, paramValues, rootTag, fromScope) {
  const selectors = splitSelectorList(prelude);
  const rewritten = [];
  for (const selector of selectors) {
    const next = rewriteAcceptedSvelteSelectorPart(selector, variantNum, paramValues, rootTag, fromScope);
    if (next) rewritten.push(next);
  }
  return rewritten.join(', ');
}

function rewriteAcceptedSvelteSelectorPart(selector, variantNum, paramValues, rootTag, fromScope) {
  let out = selector.trim();
  const hasVariant = /data-impeccable-variant/.test(out);
  if (hasVariant && !selectorHasVariant(out, variantNum)) return '';
  if (hasVariant) {
    out = out.replace(variantSelectorRegex(variantNum), '');
    out = out.replace(/\[data-impeccable-variant=(["']).*?\1\]/g, '');
  }

  const paramResult = rewriteParamSelectors(out, paramValues);
  if (!paramResult.keep) return '';
  out = paramResult.selector;

  out = out
    .replace(/:scope(?:\[[^\]]+\])?\s*>\s*/g, '')
    .replace(/:scope(?:\[[^\]]+\])?/g, rootTag || '')
    .replace(/\s+/g, ' ')
    .trim();

  out = out.replace(/^[>+~]\s*/, '').trim();
  if (!out && (hasVariant || fromScope)) return rootTag || ':global(*)';
  return out;
}

function rewriteParamSelectors(selector, paramValues) {
  let keep = true;
  const next = selector.replace(/\[data-p-([A-Za-z0-9_-]+)(?:=(["'])(.*?)\2)?\]/g, (_match, key, _quote, expected) => {
    if (!paramValues || !Object.prototype.hasOwnProperty.call(paramValues, key)) return '';
    const actual = paramValues[key];
    if (expected != null && String(actual) !== String(expected)) {
      keep = false;
      return '';
    }
    if (expected == null && (actual === false || actual == null || actual === 'false' || actual === 'off' || actual === '0')) {
      keep = false;
      return '';
    }
    return '';
  });
  return { keep, selector: next };
}


function selectorHasVariant(selector, variantNum) {
  return variantSelectorRegex(variantNum).test(selector);
}

function variantSelectorRegex(variantNum) {
  return new RegExp(`\\[data-impeccable-variant=(["'])${escapeRegExp(String(variantNum))}\\1\\]`, 'g');
}

function formatCssRule(selector, body) {
  return `${selector} { ${body.trim()} }`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function inlineSvelteComponentAccept(manifest, variantNum, paramValues = null, cwd = process.cwd()) {
  const sourceFile = resolveSourceFile(manifest.sourceFile, cwd);
  const variantPath = path.join(cwd, manifest.componentDir, `v${variantNum}.svelte`);
  const resultBase = {
    file: manifest.sourceFile,
    sourceFile: manifest.sourceFile,
    previewMode: 'svelte-component',
    componentDir: manifest.componentDir,
    carbonize: false,
  };
  if (!fs.existsSync(variantPath)) {
    return { handled: false, error: `Variant ${variantNum} not found`, ...resultBase };
  }

  const { markup, cssLines } = parseSvelteComponentFile(fs.readFileSync(variantPath, 'utf-8'));
  if (manifest.mode === 'insert') {
    return inlineSvelteComponentInsertAccept({
      manifest,
      markup,
      cssLines,
      variantNum,
      paramValues,
      sourceFile,
      resultBase,
      cwd,
    });
  }

  const rootTag = matchOpeningTag(markup)?.tag || 'div';
  const contract = manifest.propContract || [];
  const compiler = loadSvelteCompiler(cwd);
  const mergedMarkup = mergeOriginalTopLevelAttrs(markup, manifest.originalMarkup || '');

  // Restore props back to route expressions. Contract v2 restores through the
  // AST so a prop used without braces (each headers, attribute positions)
  // still maps back to its original expression; v1 falls back to the textual
  // placeholder swap.
  let restoredText;
  if (Number(manifest.contractVersion) === 2 && compiler) {
    const restored = restoreSvelteMarkup(mergedMarkup, contract, compiler.parse);
    if (!restored.ok) {
      return { handled: false, error: 'Accepted variant does not parse: ' + restored.reason, ...resultBase };
    }
    restoredText = restored.markup;
  } else {
    restoredText = substitutePropsWithExprs(mergedMarkup, contract);
  }
  const restoredMarkup = restoredText.split('\n').map((line) => line.trimEnd());

  const sourceContent = fs.readFileSync(sourceFile, 'utf-8');
  const sourceLines = sourceContent.split('\n');
  const start = Number(manifest.sourceStartLine) - 1;
  const end = Number(manifest.sourceEndLine) - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end >= sourceLines.length) {
    return { handled: false, error: 'Invalid source line range for ' + manifest.sourceFile, ...resultBase };
  }

  const indent = sourceLines[start].match(/^(\s*)/)?.[1] || '';
  const indentedMarkup = reindentPreservingStructure(restoredMarkup, indent);

  let newLines = [
    ...sourceLines.slice(0, start),
    ...indentedMarkup,
    ...sourceLines.slice(end + 1),
  ];

  // Selectors that were already unused before this accept are the user's
  // pre-existing code; the pruning pass must not touch them.
  const preUnused = compiler ? collectUnusedSelectors(sourceContent, compiler.compile) : new Set();

  // Bake params (declared kinds from params.json drive branch pruning), then
  // MERGE into the component's existing style block: matching selectors are
  // replaced, new ones appended. Appending alone is how superseded rules used
  // to survive their own replacement.
  const declaredParams = readDeclaredParams(manifest, variantNum, cwd);
  let variantCss = cssLines.join('\n');
  if (/data-impeccable-variant|impeccable-variant-ready/.test(variantCss)) {
    // Defensive: strip preview-wrapper selectors that authoring rules forbid
    // on this path but an off-spec agent may still emit.
    variantCss = sanitizeAcceptedSvelteCss(cssLines, variantNum, paramValues, rootTag).join('\n');
  }
  const bakedCss = bakeParamValues(variantCss, declaredParams, paramValues || {});
  const cssStats = { replaced: 0, appended: 0, pruned: [], superseded: [] };
  if (bakedCss.trim()) {
    const merged = mergeCssIntoSvelteSource(newLines.join('\n'), bakedCss);
    newLines = merged.text.split('\n');
    cssStats.replaced = merged.replaced;
    cssStats.appended = merged.appended;
  }

  let finalText = newLines.join('\n');

  // Preview truth: the detached preview never applied the source rules that
  // styled the replaced selection, so the user approved a design without
  // them. Any seeded selector the variant did not re-declare is superseded;
  // left in place it re-attaches through kept class names (the accepted root
  // keeps its original classes) and re-layouts markup it no longer owns.
  //
  // Removal is bounded by ownership: a selector whose classes are still used
  // by route markup OUTSIDE the replaced region does not belong to the pick
  // alone, and removing it would strip styling from markup this accept never
  // touched. Keeping it risks a visible re-attachment quirk on the accepted
  // region; deleting it breaks the rest of the route. Keep it.
  const outsideMarkup = [...sourceLines.slice(0, start), ...sourceLines.slice(end + 1)]
    .join('\n')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '');
  const outsideClasses = new Set();
  {
    const attrRe = /class\s*=\s*(["'])(.*?)\1/g;
    let cm;
    while ((cm = attrRe.exec(outsideMarkup))) {
      for (const cls of cm[2].split(/\s+/)) if (cls && !cls.includes('{')) outsideClasses.add(cls);
    }
    const directiveRe = /class:([A-Za-z0-9_-]+)/g;
    while ((cm = directiveRe.exec(outsideMarkup))) outsideClasses.add(cm[1]);
  }
  const usedOutsideReplacedRegion = (selector) => {
    const classTokenRe = /\.([A-Za-z0-9_-]+)/g;
    let tm;
    while ((tm = classTokenRe.exec(selector))) {
      if (outsideClasses.has(tm[1])) return true;
    }
    return false;
  };
  const incomingSelectors = collectAllSelectors(bakedCss);
  const superseded = (manifest.seededSelectors || [])
    .map((selector) => normalizeSelector(selector))
    .filter((selector) => selector && !incomingSelectors.has(selector) && !usedOutsideReplacedRegion(selector));
  if (superseded.length > 0) {
    const scrubbed = removeSelectorsFromSvelteSource(finalText, new Set(superseded));
    finalText = scrubbed.text;
    cssStats.superseded = scrubbed.removed;
  }

  if (compiler) {
    const pruned = pruneUnusedSelectors(finalText, compiler.compile, { skipSelectors: preUnused });
    finalText = pruned.source;
    cssStats.pruned = pruned.removed;
  }

  // Postcondition: no selector from the user's pre-accept CSS may vanish
  // unless the compiler-driven prune or the preview-truth supersession
  // deliberately removed it. This turns any parser or reconciler defect into
  // a loud refusal instead of silent damage to a hand-written style block.
  const lostSelectors = findLostSelectors(sourceContent, finalText, [
    ...cssStats.pruned,
    ...cssStats.superseded,
  ]);
  if (lostSelectors.length > 0) {
    return {
      handled: false,
      error: 'CSS reconciliation would lose selectors from the existing style block: '
        + lostSelectors.join(', ')
        + '. Source not modified; accept the variant manually.',
      mode: 'error',
      ...resultBase,
    };
  }

  try {
    fs.writeFileSync(sourceFile, finalText, 'utf-8');
  } catch (err) {
    return { handled: false, error: 'Failed to write Svelte source: ' + err.message, ...resultBase };
  }
  removeSvelteComponentSession(manifest.id, cwd);

  const verify = verifyAcceptedSource(finalText);
  return {
    handled: true,
    css: cssStats,
    verify,
    ...resultBase,
  };
}

/** Re-indent a block onto `indent` while preserving its internal structure. */
export function reindentPreservingStructure(lines, indent) {
  const nonEmpty = lines.filter((line) => line.trim() !== '');
  if (nonEmpty.length === 0) return lines.map(() => '');
  const minIndent = Math.min(...nonEmpty.map((line) => (line.match(/^\s*/) || [''])[0].length));
  return lines.map((line) => {
    if (line.trim() === '') return '';
    const current = (line.match(/^\s*/) || [''])[0].length;
    return indent + line.slice(Math.min(minIndent, current));
  });
}

function styleBlockText(sourceText) {
  const match = String(sourceText || '').match(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/i);
  return match ? match[1] : '';
}

/**
 * Remove every rule whose (normalized) selector list is fully contained in
 * `selectors` from the component's style block, at any at-rule nesting depth.
 * Rules that mix doomed and surviving selectors keep the survivors.
 */
export function removeSelectorsFromSvelteSource(sourceText, selectors) {
  const text = String(sourceText || '');
  const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
  let lastMatch = null;
  let m;
  while ((m = styleRe.exec(text))) lastMatch = m;
  if (!lastMatch) return { text, removed: [] };

  const removed = [];
  const transform = (nodes) => {
    const kept = [];
    for (const node of nodes) {
      if (node.type === 'rule') {
        const survivors = [];
        for (const selector of splitSelectorList(node.prelude)) {
          if (selectors.has(normalizeSelector(selector))) removed.push(normalizeSelector(selector));
          else survivors.push(selector);
        }
        if (survivors.length > 0) kept.push({ ...node, prelude: survivors.join(', ') });
      } else if (node.type === 'at' && node.children) {
        const children = transform(node.children);
        if (children.length > 0) kept.push({ ...node, children });
      } else {
        kept.push(node);
      }
    }
    return kept;
  };

  const nodes = transform(parseStylesheet(lastMatch[1]));
  if (removed.length === 0) return { text, removed };
  const openTag = lastMatch[0].slice(0, lastMatch[0].indexOf('>') + 1);
  const rebuilt = `${openTag}\n${serializeNodes(nodes).split('\n').map((l) => (l.trim() ? '  ' + l : '')).join('\n')}\n</style>`;
  return {
    text: text.slice(0, lastMatch.index) + rebuilt + text.slice(lastMatch.index + lastMatch[0].length),
    removed,
  };
}

export function findLostSelectors(beforeSource, afterSource, prunedSelectors = []) {
  const before = collectAllSelectors(styleBlockText(beforeSource));
  const after = collectAllSelectors(styleBlockText(afterSource));
  const pruned = new Set((prunedSelectors || []).map((s) => normalizeSelector(s)));
  const lost = [];
  for (const selector of before) {
    if (!after.has(selector) && !pruned.has(selector)) lost.push(selector);
  }
  return lost;
}

function readDeclaredParams(manifest, variantNum, cwd) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(cwd, manifest.componentDir, 'params.json'), 'utf-8'));
    const list = raw?.[String(variantNum)];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/**
 * Merge CSS into a svelte component's top-level style block (created when
 * absent), replacing rules whose selectors match and appending the rest.
 */
export function mergeCssIntoSvelteSource(sourceText, incomingCss) {
  const text = String(sourceText || '');
  const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
  let lastMatch = null;
  let m;
  while ((m = styleRe.exec(text))) lastMatch = m;

  if (!lastMatch) {
    const { css, replaced, appended } = reconcileCss('', incomingCss);
    return {
      text: `${text.replace(/\s*$/, '')}\n\n<style>\n${indentCssBlock(css)}\n</style>\n`,
      replaced,
      appended,
    };
  }

  const inner = lastMatch[1];
  const { css, replaced, appended } = reconcileCss(inner, incomingCss);
  const openTag = lastMatch[0].slice(0, lastMatch[0].indexOf('>') + 1);
  const replacedBlock = `${openTag}\n${indentCssBlock(css)}\n</style>`;
  return {
    text: text.slice(0, lastMatch.index) + replacedBlock + text.slice(lastMatch.index + lastMatch[0].length),
    replaced,
    appended,
  };
}

function indentCssBlock(css) {
  return String(css || '')
    .split('\n')
    .map((line) => (line.trim() === '' ? '' : '  ' + line))
    .join('\n');
}

function inlineSvelteComponentInsertAccept({
  manifest,
  markup,
  cssLines,
  variantNum,
  paramValues,
  sourceFile,
  resultBase,
  cwd,
}) {
  if (!svelteMarkupHasVisibleContent(markup)) {
    return { handled: false, error: 'Accepted Svelte insert variant is empty', ...resultBase };
  }
  if (/\bdata-impeccable-[\w-]*\s*=/.test(markup)) {
    return { handled: false, error: 'Accepted Svelte insert variant contains preview-only data-impeccable attributes', ...resultBase };
  }

  const rootTag = matchOpeningTag(markup)?.tag || 'div';
  const restoredMarkup = String(markup || '')
    .split('\n')
    .map((line) => line.trimEnd());
  const sourceContent = fs.readFileSync(sourceFile, 'utf-8');
  const sourceLines = sourceContent.split('\n');
  const insertIndex = Number(manifest.insertLine) - 1;
  if (!Number.isInteger(insertIndex) || insertIndex < 0 || insertIndex > sourceLines.length) {
    return { handled: false, error: 'Invalid insert line for ' + manifest.sourceFile, ...resultBase };
  }

  const nearbyLine = sourceLines[insertIndex] ?? sourceLines[insertIndex - 1] ?? '';
  const indent = nearbyLine.match(/^(\s*)/)?.[1] || '';
  const indentedMarkup = reindentPreservingStructure(restoredMarkup, indent);

  let newLines = [
    ...sourceLines.slice(0, insertIndex),
    ...indentedMarkup,
    ...sourceLines.slice(insertIndex),
  ];

  let variantCss = cssLines.join('\n');
  if (/data-impeccable-variant|impeccable-variant-ready/.test(variantCss)) {
    variantCss = sanitizeAcceptedSvelteCss(cssLines, variantNum, paramValues, rootTag).join('\n');
  }
  const declaredParams = readDeclaredParams(manifest, variantNum, cwd);
  const bakedCss = bakeParamValues(variantCss, declaredParams, paramValues || {});
  if (bakedCss.trim()) {
    const merged = mergeCssIntoSvelteSource(newLines.join('\n'), bakedCss);
    newLines = merged.text.split('\n');
  }

  try {
    fs.writeFileSync(sourceFile, newLines.join('\n'), 'utf-8');
  } catch (err) {
    return { handled: false, error: 'Failed to write Svelte source: ' + err.message, ...resultBase };
  }
  removeSvelteComponentSession(manifest.id, cwd);

  const verify = verifyAcceptedSource(newLines.join('\n'));
  return {
    handled: true,
    verify,
    ...resultBase,
  };
}

function svelteMarkupHasVisibleContent(markup) {
  const text = String(markup || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length > 0) return true;
  return /<(img|svg|canvas|video|audio|picture|input|button|select|textarea)\b/i.test(markup || '');
}

function mergeOriginalTopLevelAttrs(markup, originalMarkup) {
  const variantOpen = matchOpeningTag(markup);
  const originalOpen = matchOpeningTag(originalMarkup);
  if (!variantOpen || !originalOpen) return markup;
  if (variantOpen.tag.toLowerCase() !== originalOpen.tag.toLowerCase()) return markup;

  const variantAttrs = parseAttrSegments(variantOpen.attrs);
  const originalAttrs = parseAttrSegments(originalOpen.attrs);
  const additions = [];
  let attrs = variantOpen.attrs;

  const originalClass = originalAttrs.get('class');
  const variantClass = variantAttrs.get('class');
  if (originalClass && variantClass) {
    const merged = mergeStaticClassAttr(originalClass, variantClass);
    if (merged) {
      attrs = attrs.slice(0, variantClass.start) + merged + attrs.slice(variantClass.end);
      variantAttrs.set('class', { ...variantClass, raw: merged });
    }
  } else if (originalClass && !variantClass) {
    additions.push(originalClass.raw);
  }

  for (const [name, attr] of originalAttrs) {
    if (name === 'class') continue;
    if (!variantAttrs.has(name)) additions.push(attr.raw);
  }

  if (additions.length === 0 && attrs === variantOpen.attrs) return markup;
  const nextOpen = variantOpen.prefix
    + variantOpen.tag
    + attrs
    + additions.map((attr) => ' ' + attr.trim()).join('')
    + variantOpen.close;
  return markup.slice(0, variantOpen.index) + nextOpen + markup.slice(variantOpen.index + variantOpen.raw.length);
}

function matchOpeningTag(markup) {
  const match = String(markup || '').match(/^(\s*<)([A-Za-z][\w:-]*)([^>]*?)(\/?>)/);
  if (!match) return null;
  return {
    raw: match[0],
    prefix: match[1],
    tag: match[2],
    attrs: match[3] || '',
    close: match[4],
    index: match.index || 0,
  };
}

function parseAttrSegments(attrs) {
  const out = new Map();
  const re = /([A-Za-z_:][\w:.-]*)(?:\s*=\s*(?:"[^"]*"|'[^']*'|\{[^}]*\}|[^\s"'>=]+))?/g;
  let match;
  while ((match = re.exec(attrs))) {
    const raw = match[0];
    const name = match[1];
    out.set(name, {
      name,
      raw,
      start: match.index,
      end: match.index + raw.length,
    });
  }
  return out;
}

function mergeStaticClassAttr(originalClass, variantClass) {
  const originalValue = originalClass.raw.match(/class\s*=\s*(["'])(.*?)\1/);
  const variantValue = variantClass.raw.match(/class\s*=\s*(["'])(.*?)\1/);
  if (!originalValue || !variantValue) return null;
  const quote = variantValue[1];
  const classes = [
    ...variantValue[2].split(/\s+/),
    ...originalValue[2].split(/\s+/),
  ].filter(Boolean);
  return `class=${quote}${[...new Set(classes)].join(' ')}${quote}`;
}

export function removeSvelteComponentSession(id, cwd = process.cwd()) {
  const dir = componentSessionDir(id, cwd);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch { /* non-fatal */ }
}

/**
 * Compile-check every variant component of a session with the app's own
 * compiler, BEFORE the browser ever imports them. A variant that does not
 * compile (the classic: a second top-level <style> appended next to the
 * seeded one) used to surface as a red Vite overlay in the user's page plus
 * a mount-failure round trip; bounced at publish time it is a private
 * agent-side fix with the exact file and line.
 *
 * What this deliberately does NOT prove is that the emitted module is valid
 * JavaScript, and issue #580 was exactly that gap: valid .svelte source whose
 * generated JS did not parse, so this check passed and the browser's import
 * failed with "Unexpected token '('". Two reasons it cannot close the gap, both
 * structural rather than oversights:
 *
 *   - `generate: false` produces no JS to inspect, and generating it here would
 *     spend a full codegen per variant on the publish path.
 *   - `loadSvelteCompiler` reaches the compiler through createRequire, which
 *     Svelte's export map routes to a prebuilt CJS build. The dev server
 *     imports `src/compiler` instead, and only that path uses the app's
 *     installed printer (esrap). The two can disagree, so even a generated
 *     check here would be checking a different compiler than the one whose
 *     output the browser runs.
 *
 * tests/live-svelte-props-script.test.mjs covers the emitted JS, importing the
 * compiler as ESM so it sees what the dev server sees.
 */
export function compileCheckVariants(id, cwd = process.cwd()) {
  const manifest = findSvelteComponentManifest(id, cwd);
  if (!manifest || !manifest.manifestPath) return { ok: true, failures: [], checked: 0 };
  const compiler = loadSvelteCompiler(cwd);
  if (!compiler || typeof compiler.compile !== 'function') return { ok: true, failures: [], checked: 0 };
  const sessionDir = path.dirname(manifest.manifestPath);
  const failures = [];
  let checked = 0;
  let entries = [];
  try { entries = fs.readdirSync(sessionDir); } catch { return { ok: true, failures: [], checked: 0 }; }
  for (const name of entries) {
    if (!/^v\d+\.svelte$/.test(name)) continue;
    checked++;
    try {
      compiler.compile(fs.readFileSync(path.join(sessionDir, name), 'utf-8'), { generate: false });
    } catch (err) {
      failures.push({
        file: `${manifest.componentDir}/${name}`,
        line: err?.start?.line ?? null,
        column: err?.start?.column ?? null,
        message: String(err?.message || err).split('\n')[0].slice(0, 300),
      });
    }
  }
  return { ok: failures.length === 0, failures, checked };
}

/**
 * Snapshot the agent-authored variant files into a fresh revision directory
 * and stamp the manifest. Called by the server on every publish (`done`
 * reply) for a component session; the browser imports from the revision dir,
 * so the dev server can never serve a stale compile of a republished file.
 */
export function bumpSvelteComponentPreviewRevision(id, cwd = process.cwd()) {
  const manifest = findSvelteComponentManifest(id, cwd);
  if (!manifest || !manifest.manifestPath) return null;
  const sessionDir = path.dirname(manifest.manifestPath);
  const revision = Number(manifest.revision || 0) + 1;
  const revDirName = `r${revision}`;
  const revDir = path.join(sessionDir, revDirName);
  try {
    fs.mkdirSync(revDir, { recursive: true });
    let entries = [];
    try { entries = fs.readdirSync(sessionDir, { withFileTypes: true }); } catch { /* empty */ }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (entry.name === 'manifest.json') continue;
      fs.copyFileSync(path.join(sessionDir, entry.name), path.join(revDir, entry.name));
    }
    // Previous revision dirs are dead the moment a new one exists.
    for (const entry of entries) {
      if (entry.isDirectory() && /^r\d+$/.test(entry.name) && entry.name !== revDirName) {
        try { fs.rmSync(path.join(sessionDir, entry.name), { recursive: true, force: true }); } catch { /* non-fatal */ }
      }
    }
    const relSessionDir = path.relative(cwd, sessionDir).split(path.sep).join('/');
    const updated = {
      ...manifest,
      revision,
      revisionDir: `${relSessionDir}/${revDirName}`,
      revisionDirAbs: revDir.split(path.sep).join('/'),
    };
    delete updated.manifestPath;
    fs.writeFileSync(manifest.manifestPath, JSON.stringify(updated, null, 2) + '\n', 'utf-8');
    return { revision, revisionDir: updated.revisionDir };
  } catch {
    return null;
  }
}

/**
 * Stop-path sweep. The whole `node_modules/.impeccable-live` tree is
 * impeccable-owned and gitignored, so once no session should survive there is
 * nothing left worth keeping: the per-session dirs, the generated
 * `__runtime.js`, and the parent directory all go. The old per-entry loop
 * skipped `__*` entries and the parent, which left the runtime shim and an
 * empty directory in every project that ever ran live mode once.
 */
export function removeAllSvelteComponentSessions(cwd = process.cwd()) {
  for (const rootRel of [SVELTE_COMPONENT_ROOT, LEGACY_SVELTE_COMPONENT_ROOT]) {
    const root = path.join(cwd, rootRel);
    if (!fs.existsSync(root)) continue;
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch { /* non-fatal */ }
  }
}

/**
 * Boot-path sweep. A restart must not delete the tree wholesale: sessions
 * recorded in the session store may still be mid-generation. Remove only the
 * session dirs whose id has no active snapshot, then drop `__runtime.js` and
 * the parent directory when nothing is left to serve.
 *
 * @param {Iterable<string>} activeIds session ids that must be preserved
 * @returns {{ removed: string[], removedRoot: boolean, kept: string[] }}
 */
export function sweepInactiveSvelteComponentSessions(activeIds = [], cwd = process.cwd()) {
  const result = { removed: [], removedRoot: false, kept: [] };
  const active = new Set();
  for (const id of activeIds || []) {
    if (typeof id === 'string' && id) active.add(id);
  }

  for (const rootRel of [SVELTE_COMPONENT_ROOT, LEGACY_SVELTE_COMPONENT_ROOT]) {
    const root = path.join(cwd, rootRel);
    if (!fs.existsSync(root)) continue;

    let entries;
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }

    let keptHere = 0;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('__')) continue;
      if (active.has(entry.name)) {
        result.kept.push(entry.name);
        keptHere++;
        continue;
      }
      try {
        fs.rmSync(path.join(root, entry.name), { recursive: true, force: true });
        result.removed.push(entry.name);
      } catch {
        // Could not remove it, so it still occupies the tree; treat it as kept
        // so the parent directory is not torn out from under it.
        result.kept.push(entry.name);
        keptHere++;
      }
    }

    if (keptHere === 0) {
      try {
        fs.rmSync(root, { recursive: true, force: true });
        result.removedRoot = true;
      } catch { /* non-fatal */ }
    }
  }
  return result;
}

export function deferredAcceptsPath(cwd = process.cwd()) {
  const key = createHash('sha1').update(path.resolve(cwd)).digest('hex').slice(0, 16);
  return path.join(os.tmpdir(), 'impeccable-live', key, 'deferred-svelte-component-accepts.json');
}

export function readDeferredAccepts(cwd = process.cwd()) {
  const file = deferredAcceptsPath(cwd);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return { accepts: [] };
  }
}

export function writeDeferredAccept(entry, cwd = process.cwd()) {
  const file = deferredAcceptsPath(cwd);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const data = readDeferredAccepts(cwd);
  data.accepts = (data.accepts || []).filter((item) => item.id !== entry.id);
  data.accepts.push({ ...entry, createdAt: new Date().toISOString() });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

export function applyDeferredSvelteComponentAccepts(cwd = process.cwd()) {
  const file = deferredAcceptsPath(cwd);
  const data = readDeferredAccepts(cwd);
  const pending = Array.isArray(data.accepts) ? data.accepts : [];
  const results = [];
  const remaining = [];
  for (const entry of pending) {
    try {
      const manifest = findSvelteComponentManifest(entry.id, cwd);
      if (!manifest) {
        results.push({ id: entry.id, ok: false, error: 'manifest not found' });
        remaining.push(entry);
        continue;
      }
      const result = inlineSvelteComponentAccept(
        manifest,
        entry.variantNum,
        entry.paramValues || null,
        cwd,
      );
      results.push({ id: entry.id, ok: result.handled !== false, result });
      if (result.handled === false) remaining.push(entry);
    } catch (err) {
      results.push({ id: entry.id, ok: false, error: err.message });
      remaining.push(entry);
    }
  }
  if (remaining.length > 0) {
    fs.writeFileSync(file, JSON.stringify({ accepts: remaining }, null, 2) + '\n', 'utf-8');
  } else {
    try { fs.rmSync(file, { force: true }); } catch {}
  }
  return { applied: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
}

export function buildSvelteComponentCssAuthoring(count) {
  const variantNumbers = Array.from({ length: count }, (_, i) => i + 1);
  return {
    mode: 'svelte-component',
    styleTag: null,
    strategy: 'component-style-block',
    rulePattern: '.semantic-class { ... }',
    selectorExamples: variantNumbers.map(() => '.expense-row { padding: 22px; }'),
    requirements: [
      'Write each variant as a real Svelte component file (v1.svelte, v2.svelte, ...).',
      'Keep the prop names from propContract; bind dynamic text with {propName}, not literal snapshot text.',
      'Put variant CSS in the component <style> block using semantic class selectors.',
      'Author param-driven CSS against var(--p-<id>, default) and [data-p-<id>] using :global(...) so the runtime knob values reach the mounted root.',
      'Declare params in componentDir/params.json keyed by variant number (e.g. {"1": [...], "2": [...]}), NOT as a data-impeccable-params attribute.',
      'Do not use @scope or data-impeccable-variant selectors in component files.',
      'Do not edit the route source file during generation; only edit files under componentDir.',
    ],
    forbidden: [
      'Do not use @scope blocks in Svelte component variants.',
      'Do not copy live DOM snapshot text into markup when propContract provides bindings.',
      'Do not add data-impeccable-* attributes inside component files. Svelte parses { in attribute values as an expression, so data-impeccable-params with JSON breaks the build; use componentDir/params.json instead.',
    ],
    paramsFile: 'params.json',
  };
}
