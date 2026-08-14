/**
 * Accept-time CSS reconciliation for live mode.
 *
 * The old accept path appended the chosen variant's whole <style> body in
 * front of the component's existing rules, which preserved every superseded
 * declaration (the "old divider borders survive the accept" bug) and left
 * dead parameter branches in source. This module makes acceptance a merge:
 *
 *   reconcileCss      replace rules whose selectors match, append new ones
 *   bakeParamValues   collapse --p-* vars and [data-p-*] branches to the
 *                     user's chosen values, driven by the declared param
 *                     kinds from params.json (not regex sniffing)
 *   pruneUnusedSelectors  use the framework compiler's own unused-selector
 *                     warnings to delete rules the accepted markup no longer
 *                     references
 *
 * The parser is hand-rolled on purpose: skill scripts run standalone inside
 * user projects and cannot rely on this repo's node_modules. It is a small
 * recursive block parser (comment- and string-aware), not a spec-complete
 * CSS parser; everything it emits round-trips byte-for-byte through raw
 * slices except the rules deliberately changed.
 */

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a stylesheet into a flat tree.
 * Node shapes:
 *   { type: 'rule', prelude, body, start, end, preludeStart }
 *   { type: 'at', name, prelude, children|body, start, end }  (children when
 *     the block contains rules: media/supports/layer/container/scope)
 *   { type: 'comment', text, start, end }
 */
export function parseStylesheet(css, offset = 0) {
  const text = String(css || '');
  const nodes = [];
  let i = 0;

  const skipWs = () => { while (i < text.length && /\s/.test(text[i])) i++; };

  while (i < text.length) {
    skipWs();
    if (i >= text.length) break;

    if (text[i] === '/' && text[i + 1] === '*') {
      const start = i;
      const close = text.indexOf('*/', i + 2);
      i = close === -1 ? text.length : close + 2;
      nodes.push({ type: 'comment', text: text.slice(start, i), start: offset + start, end: offset + i });
      continue;
    }

    const preludeStart = i;
    const boundary = scanToBlockOrStatementEnd(text, i);
    if (boundary.kind === 'none') break; // trailing garbage / declarations at top level
    if (boundary.kind === 'statement') {
      // Block-less at-statement (@import, @charset, @layer names;). Emitted
      // as its own node so the FOLLOWING rule still indexes for
      // reconciliation instead of being folded into this prelude.
      const raw = text.slice(preludeStart, boundary.index + 1).trim();
      if (raw) {
        nodes.push({
          type: 'at',
          name: (raw.match(/^@([A-Za-z-]+)/) || [])[1] || '',
          prelude: raw.replace(/;$/, ''),
          statement: true,
          start: offset + preludeStart,
          end: offset + boundary.index + 1,
        });
      }
      i = boundary.index + 1;
      continue;
    }
    const braceIdx = boundary.index;
    const prelude = text.slice(preludeStart, braceIdx).trim();
    const bodyStart = braceIdx + 1;
    const bodyEnd = scanBlockEnd(text, bodyStart);
    const body = text.slice(bodyStart, bodyEnd);
    const nodeEnd = Math.min(text.length, bodyEnd + 1);

    if (prelude.startsWith('@')) {
      const name = (prelude.match(/^@([A-Za-z-]+)/) || [])[1] || '';
      if (['media', 'supports', 'layer', 'container', 'scope'].includes(name)) {
        nodes.push({
          type: 'at',
          name,
          prelude,
          children: parseStylesheet(body, offset + bodyStart),
          start: offset + preludeStart,
          end: offset + nodeEnd,
        });
      } else {
        nodes.push({
          type: 'at',
          name,
          prelude,
          body,
          start: offset + preludeStart,
          end: offset + nodeEnd,
        });
      }
    } else if (prelude) {
      nodes.push({
        type: 'rule',
        prelude,
        body,
        start: offset + preludeStart,
        end: offset + nodeEnd,
        preludeStart: offset + preludeStart,
      });
    }
    i = nodeEnd;
  }
  return nodes;
}

/**
 * Scan for the next structural boundary: the `{` opening a block, or the `;`
 * ending a block-less at-statement, whichever comes first (string- and
 * comment-aware). Returns { kind: 'block' | 'statement' | 'none', index }.
 */
function scanToBlockOrStatementEnd(text, from) {
  let i = from;
  let quote = null;
  while (i < text.length) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      i = close === -1 ? text.length : close + 1;
    } else if (ch === '{') {
      return { kind: 'block', index: i };
    } else if (ch === ';') {
      return { kind: 'statement', index: i };
    }
    i++;
  }
  return { kind: 'none', index: -1 };
}

function scanBlockEnd(text, from) {
  let i = from;
  let depth = 1;
  let quote = null;
  while (i < text.length) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      i = close === -1 ? text.length : close + 1;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return text.length;
}

export function serializeNodes(nodes, indent = '') {
  const out = [];
  for (const node of nodes) {
    if (node.type === 'comment') {
      out.push(indent + node.text);
    } else if (node.type === 'rule') {
      out.push(`${indent}${node.prelude} {${formatBody(node.body, indent)}}`);
    } else if (node.type === 'at' && node.children) {
      out.push(`${indent}${node.prelude} {`);
      out.push(serializeNodes(node.children, indent + '  '));
      out.push(`${indent}}`);
    } else if (node.type === 'at' && node.statement) {
      out.push(`${indent}${node.prelude};`);
    } else if (node.type === 'at') {
      out.push(`${indent}${node.prelude} {${formatBody(node.body, indent)}}`);
    }
  }
  return out.join('\n');
}

function formatBody(body, indent) {
  const trimmed = String(body || '').trim();
  if (!trimmed) return ' ';
  const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 1 && lines[0].length < 60) return ` ${lines[0]} `;
  return '\n' + lines.map((l) => `${indent}  ${l}`).join('\n') + `\n${indent}`;
}

export function normalizeSelector(prelude) {
  return String(prelude || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([>+~,])\s*/g, '$1')
    .trim();
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

/**
 * Merge variant CSS into existing CSS. Rules whose (at-context, normalized
 * selector) match an existing rule REPLACE that rule's body in place; new
 * rules append at the end under their at-context. Returns { css, replaced,
 * appended }.
 */
export function reconcileCss(existingCss, variantCss) {
  const existing = parseStylesheet(existingCss);
  const incoming = parseStylesheet(variantCss);
  let replaced = 0;
  let appended = 0;

  const mergeLevel = (existingNodes, incomingNodes) => {
    const index = new Map();
    for (const node of existingNodes) {
      if (node.type === 'rule') index.set(normalizeSelector(node.prelude), node);
    }
    const atIndex = new Map();
    for (const node of existingNodes) {
      if (node.type === 'at' && node.children) atIndex.set(normalizeSelector(node.prelude), node);
    }
    // Baking can leave several incoming rules with the same selector (e.g. a
    // base rule plus a stripped param branch). The first one REPLACES the
    // existing body; later same-selector rules extend it, never clobber it.
    const touched = new Set();
    for (const node of incomingNodes) {
      if (node.type === 'comment') continue;
      if (node.type === 'rule') {
        const key = normalizeSelector(node.prelude);
        const match = index.get(key);
        if (match) {
          if (touched.has(key)) {
            match.body = `${match.body.trim()}\n${node.body.trim()}`;
          } else if (match.body.trim() !== node.body.trim()) {
            match.body = node.body;
            replaced++;
          }
          touched.add(key);
        } else {
          // New base rules go BEFORE the existing top-level media blocks:
          // appended after them, an equal-specificity base rule wins the
          // cascade over the stylesheet's earlier responsive overrides and
          // silently weakens the mobile styles for any still-shared class.
          const appendedNode = { ...node };
          const firstAt = existingNodes.findIndex((n) => n.type === 'at' && n.children);
          if (firstAt === -1) existingNodes.push(appendedNode);
          else existingNodes.splice(firstAt, 0, appendedNode);
          index.set(key, appendedNode);
          touched.add(key);
          appended++;
        }
      } else if (node.type === 'at' && node.children) {
        const key = normalizeSelector(node.prelude);
        const match = atIndex.get(key);
        if (match) {
          mergeLevel(match.children, node.children);
        } else {
          existingNodes.push({ ...node });
          atIndex.set(key, existingNodes[existingNodes.length - 1]);
          appended++;
        }
      } else {
        existingNodes.push({ ...node });
        appended++;
      }
    }
  };

  mergeLevel(existing, incoming);
  return { css: serializeNodes(existing), replaced, appended };
}

// ---------------------------------------------------------------------------
// Parameter baking
// ---------------------------------------------------------------------------

/**
 * Replace every `var(--p-<id>, fallback)` / `var(--p-<id>)` occurrence with a
 * literal value. Paren-aware: fallbacks containing calc()/nested vars are
 * handled, unlike the old `[^)]+` regex.
 */
export function substituteParamVar(css, id, value) {
  const text = String(css || '');
  const needle = `var(--p-${id}`;
  let out = '';
  let i = 0;
  while (i < text.length) {
    const idx = text.indexOf(needle, i);
    if (idx === -1) { out += text.slice(i); break; }
    const after = idx + needle.length;
    // Must be end of the var name: `)` or `,`.
    if (after < text.length && text[after] !== ')' && text[after] !== ',') {
      out += text.slice(i, after);
      i = after;
      continue;
    }
    let j = after;
    let depth = 1; // we are inside var(
    while (j < text.length && depth > 0) {
      if (text[j] === '(') depth++;
      else if (text[j] === ')') depth--;
      j++;
    }
    out += text.slice(i, idx) + String(value);
    i = j;
  }
  return out;
}

function normalizeToggleForVar(value) {
  return value === true || value === 'true' || value === 1 || value === '1' || value === 'on' ? '1' : '0';
}

function isToggleOn(value) {
  return normalizeToggleForVar(value) === '1';
}

/**
 * Strip `[data-p-<id>="value"]` / `[data-p-<id>]` attribute selectors from a
 * selector, deciding survival by the chosen value:
 *   returns null when the selector targets a non-chosen branch (drop it),
 *   otherwise the selector with the attribute test removed and any emptied
 *   :global() wrappers cleaned up.
 */
export function stripParamSelector(selector, id, kind, chosenValue) {
  const attrRe = new RegExp(`\\[data-p-${escapeRegExp(id)}(?:=(["'])(.*?)\\1)?\\]`, 'g');
  let drop = false;
  let out = String(selector).replace(attrRe, (_m, _q, expected) => {
    if (kind === 'steps') {
      if (expected == null || String(expected) === String(chosenValue)) return '';
      drop = true;
      return '';
    }
    // toggle: the runtime sets data-p-<id>="on" when on and removes the
    // attribute when off. A branch survives baking only if it actually
    // matched at preview time with the chosen state: the presence form and
    // the literal "on" form match while on; every other valued form
    // (["false"], ["0"], ...) never matched and is dead regardless of state.
    if (expected != null && expected !== 'on') {
      drop = true;
      return '';
    }
    if (!isToggleOn(chosenValue)) {
      drop = true;
      return '';
    }
    return '';
  });
  if (drop) return null;
  out = out
    .replace(/:global\(\s*\)/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^\s*[>+~]\s*/, '')
    .trim();
  return out || null;
}

/**
 * Bake chosen parameter values into CSS. `params` is the declared parameter
 * list for the accepted variant (from params.json); `values` maps id ->
 * chosen value (falling back to each param's declared default).
 */
export function bakeParamValues(css, params = [], values = {}) {
  let nodes = parseStylesheet(css);

  const chosen = new Map();
  for (const param of params || []) {
    if (!param || !param.id) continue;
    const has = values && Object.prototype.hasOwnProperty.call(values, param.id);
    chosen.set(param.id, { kind: param.kind, value: has ? values[param.id] : param.default });
  }
  // Values sent for params that were never declared still bake as ranges,
  // so an out-of-sync manifest degrades to the old behavior, not to silence.
  for (const [id, value] of Object.entries(values || {})) {
    if (!chosen.has(id)) chosen.set(id, { kind: 'range', value });
  }

  const bakeBody = (body) => {
    let out = String(body || '');
    for (const [id, { kind, value }] of chosen) {
      const literal = kind === 'toggle' ? normalizeToggleForVar(value) : String(value);
      out = substituteParamVar(out, id, literal);
    }
    // Strip the readiness sentinel as a DECLARATION, not a line: a one-line
    // rule carrying the sentinel plus real declarations must keep the rest.
    return out
      .replace(/(^|;)\s*--impeccable-variant-ready\s*:[^;{}]*/g, '$1')
      .replace(/;\s*;/g, ';')
      .replace(/^\s*;\s*/, '');
  };

  const transform = (list) => {
    const result = [];
    for (const node of list) {
      if (node.type === 'at' && node.children) {
        const children = transform(node.children);
        if (children.length > 0) result.push({ ...node, children });
        continue;
      }
      if (node.type !== 'rule') {
        if (node.type === 'at') result.push({ ...node, body: bakeBody(node.body) });
        else result.push(node);
        continue;
      }
      const selectors = splitSelectorList(node.prelude);
      const kept = [];
      for (let selector of selectors) {
        let alive = true;
        for (const [id, { kind, value }] of chosen) {
          if (kind !== 'steps' && kind !== 'toggle') continue;
          if (!selector.includes(`data-p-${id}`)) continue;
          const next = stripParamSelector(selector, id, kind, value);
          if (next == null) { alive = false; break; }
          selector = next;
        }
        if (alive && selector.trim()) kept.push(selector.trim());
      }
      if (kept.length === 0) continue;
      const body = bakeBody(node.body);
      if (!body.trim()) continue;
      result.push({ ...node, prelude: kept.join(', '), body });
    }
    return result;
  };

  nodes = transform(nodes);
  return serializeNodes(nodes);
}

export function splitSelectorList(prelude) {
  const selectors = [];
  let start = 0;
  let bracket = 0;
  let paren = 0;
  let quote = null;
  const text = String(prelude || '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '[') bracket++;
    else if (ch === ']') bracket = Math.max(0, bracket - 1);
    else if (ch === '(') paren++;
    else if (ch === ')') paren = Math.max(0, paren - 1);
    else if (ch === ',' && bracket === 0 && paren === 0) {
      selectors.push(text.slice(start, i));
      start = i + 1;
    }
  }
  selectors.push(text.slice(start));
  return selectors.map((s) => s.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Compiler-driven pruning
// ---------------------------------------------------------------------------

/**
 * Remove selectors the framework compiler reports as unused from a full
 * component source. `compileFn` is the app's svelte compile; warnings with
 * code `css_unused_selector` carry character offsets into the source.
 * `skipSelectors` protects selectors that were already unused before the
 * accept: pre-existing dead rules are the user's code, not live-mode debris.
 * Returns { source, removed } where removed lists the pruned selector texts.
 */
export function collectUnusedSelectors(componentSource, compileFn) {
  try {
    const { warnings } = compileFn(String(componentSource || ''), { generate: false });
    return new Set((warnings || [])
      .filter((w) => w.code === 'css_unused_selector'
        && Number.isInteger(w.start?.character)
        && Number.isInteger(w.end?.character))
      .map((w) => String(componentSource).slice(w.start.character, w.end.character).trim()));
  } catch {
    return new Set();
  }
}

export function pruneUnusedSelectors(componentSource, compileFn, { skipSelectors } = {}) {
  let source = String(componentSource || '');
  const removed = [];
  const skip = skipSelectors instanceof Set ? skipSelectors : new Set(skipSelectors || []);
  for (let pass = 0; pass < 3; pass++) {
    let warnings;
    try {
      ({ warnings } = compileFn(source, { generate: false }));
    } catch {
      return { source, removed }; // never let pruning break an accept
    }
    const unused = (warnings || [])
      .filter((w) => w.code === 'css_unused_selector'
        && Number.isInteger(w.start?.character)
        && Number.isInteger(w.end?.character))
      .filter((w) => !skip.has(source.slice(w.start.character, w.end.character).trim()))
      .sort((a, b) => b.start.character - a.start.character);
    if (unused.length === 0) break;

    let next = source;
    for (const warning of unused) {
      const result = removeSelectorAt(next, warning.start.character, warning.end.character);
      if (result.changed) {
        removed.push(result.selector);
        next = result.source;
      }
    }
    if (next === source) break;
    source = next;
  }
  return { source, removed };
}

/**
 * Remove the selector at [start, end) from its rule. When it is the rule's
 * only selector, remove the whole rule (prelude through closing brace).
 */
function removeSelectorAt(source, start, end) {
  const selector = source.slice(start, end);

  // Find the rule boundaries around the selector.
  const braceIdx = source.indexOf('{', end);
  if (braceIdx === -1) return { changed: false, selector, source };
  const bodyEnd = scanBlockEnd(source, braceIdx + 1);

  // Prelude spans backward from the brace to the previous } ; { or the end
  // of the <style> open tag. A bare `>` is NOT a boundary: it is the child
  // combinator, and cutting there truncates a selector list like
  // `.a > .b, .c` mid-prelude. Only a `>` that closes a `<style ...>` tag
  // bounds the walk.
  let preludeStart = start;
  for (let i = start - 1; i >= 0; i--) {
    const ch = source[i];
    if (ch === '}' || ch === '{' || ch === ';') { preludeStart = i + 1; break; }
    if (ch === '>') {
      const styleOpen = source.lastIndexOf('<style', i);
      if (styleOpen !== -1 && source.indexOf('>', styleOpen) === i) { preludeStart = i + 1; break; }
      continue; // child combinator inside the prelude
    }
    if (i === 0) preludeStart = 0;
  }
  const prelude = source.slice(preludeStart, braceIdx);
  const selectors = splitSelectorList(prelude);
  const target = selector.trim();
  const kept = selectors.filter((s) => s !== target);

  if (kept.length === selectors.length) {
    // Offsets did not line up with a full selector in the list; be safe.
    return { changed: false, selector, source };
  }

  if (kept.length === 0) {
    // Remove the entire rule including trailing newline.
    let ruleEnd = Math.min(source.length, bodyEnd + 1);
    while (ruleEnd < source.length && source[ruleEnd] === '\n') ruleEnd++;
    let ruleStart = preludeStart;
    while (ruleStart > 0 && (source[ruleStart - 1] === ' ' || source[ruleStart - 1] === '\t')) ruleStart--;
    return { changed: true, selector: target, source: source.slice(0, ruleStart) + source.slice(ruleEnd) };
  }

  const indent = (prelude.match(/^\s*/) || [''])[0];
  return {
    changed: true,
    selector: target,
    source: source.slice(0, preludeStart) + indent + kept.join(', ') + ' ' + source.slice(braceIdx, source.length),
  };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Collect every normalized selector in a CSS text, including inside nested
 * at-blocks. Used by the accept postcondition: a selector present before the
 * accept may only disappear if the compiler reported it unused; anything
 * else means the parser or reconciler damaged the user's file, and the write
 * must be refused rather than silently committed.
 */
export function collectAllSelectors(css, out = new Set()) {
  for (const node of parseStylesheet(css)) {
    if (node.type === 'rule') {
      for (const selector of splitSelectorList(node.prelude)) out.add(normalizeSelector(selector));
    } else if (node.type === 'at' && node.children) {
      for (const child of node.children) {
        if (child.type === 'rule') {
          for (const selector of splitSelectorList(child.prelude)) out.add(normalizeSelector(selector));
        } else if (child.type === 'at' && child.children) {
          collectSelectorsFromNodes(child.children, out);
        }
      }
    }
  }
  return out;
}

function collectSelectorsFromNodes(nodes, out) {
  for (const node of nodes) {
    if (node.type === 'rule') {
      for (const selector of splitSelectorList(node.prelude)) out.add(normalizeSelector(selector));
    } else if (node.type === 'at' && node.children) {
      collectSelectorsFromNodes(node.children, out);
    }
  }
}
