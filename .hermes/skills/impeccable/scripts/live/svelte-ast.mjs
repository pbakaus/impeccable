/**
 * AST-based Svelte scaffolding for live component previews.
 *
 * The scaffolder turns the selected block of a route's markup into a detached
 * preview component whose dynamic values arrive as props. The old
 * implementation matched `{...}` with a regex, which flattened control-flow
 * blocks ({#each}, {#if}) into scalar text props and shipped structurally
 * wrong previews. This module uses the app's own svelte compiler
 * (parse with modern: true) and replaces only expressions that are FREE,
 * i.e. reference identifiers not bound by an enclosing template scope:
 *
 *   {#each stages as stage, i}     stages  -> collection prop (array)
 *     <span>{stage.label}</span>   bound   -> left verbatim
 *   {/each}
 *   <p>{footerNote}</p>            free    -> text prop (string)
 *
 * Constructs that cannot work in a detached component (component tags whose
 * imports live in the route file, bind:/use: directives, await blocks,
 * render tags) mark the analysis unsupported; the caller falls back to
 * source-preview mode, which keeps the markup inside the route file where
 * those references still resolve. A wrong preview is worse than a plain one.
 *
 * The compiler is resolved from the APP's node_modules, never bundled: the
 * preview must be parsed by the same svelte version that will compile it.
 */

import { createRequire } from 'node:module';
import path from 'node:path';

const HANDLER_ATTR_RE = /^on[a-z]/;

/**
 * Resolve the app's svelte compiler synchronously (svelte 5 ships a CJS
 * compiler build, so createRequire works and the accept/scaffold pipeline
 * stays synchronous). Returns { parse, compile, VERSION } or null.
 */
export function loadSvelteCompiler(appRoot) {
  try {
    const req = createRequire(path.join(appRoot, 'package.json'));
    const mod = req('svelte/compiler');
    if (typeof mod.parse !== 'function') return null;
    const major = parseInt(String(mod.VERSION || '0'), 10);
    if (major < 5) return null; // detached mount() previews are svelte 5 only
    return { parse: mod.parse, compile: mod.compile, VERSION: mod.VERSION };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// ESTree helpers
// ---------------------------------------------------------------------------

/**
 * Collect the root identifiers an ESTree expression reads. Walks generically;
 * skips non-computed member properties and non-computed/non-shorthand object
 * keys, which are names, not references.
 */
export function collectRootIdentifiers(node, out = new Set()) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const item of node) collectRootIdentifiers(item, out);
    return out;
  }
  switch (node.type) {
    case 'Identifier':
      out.add(node.name);
      return out;
    case 'MemberExpression':
      collectRootIdentifiers(node.object, out);
      if (node.computed) collectRootIdentifiers(node.property, out);
      return out;
    case 'Property':
      if (node.computed) collectRootIdentifiers(node.key, out);
      collectRootIdentifiers(node.value, out);
      return out;
    case 'ArrowFunctionExpression':
    case 'FunctionExpression': {
      // Params shadow outer names inside the body.
      const bound = new Set();
      for (const param of node.params || []) collectPatternNames(param, bound);
      const inner = collectRootIdentifiers(node.body, new Set());
      for (const name of inner) if (!bound.has(name)) out.add(name);
      return out;
    }
    default: {
      for (const key of Object.keys(node)) {
        if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range' || key === 'parent') continue;
        collectRootIdentifiers(node[key], out);
      }
      return out;
    }
  }
}

/** Collect names bound by a destructuring pattern (each contexts, const tags). */
export function collectPatternNames(pattern, out = new Set()) {
  if (!pattern || typeof pattern !== 'object') return out;
  switch (pattern.type) {
    case 'Identifier':
      out.add(pattern.name);
      return out;
    case 'ObjectPattern':
      for (const prop of pattern.properties || []) {
        if (prop.type === 'RestElement') collectPatternNames(prop.argument, out);
        else collectPatternNames(prop.value, out);
      }
      return out;
    case 'ArrayPattern':
      for (const el of pattern.elements || []) if (el) collectPatternNames(el, out);
      return out;
    case 'AssignmentPattern':
      collectPatternNames(pattern.left, out);
      return out;
    case 'RestElement':
      collectPatternNames(pattern.argument, out);
      return out;
    default:
      return out;
  }
}

// ---------------------------------------------------------------------------
// Template analysis
// ---------------------------------------------------------------------------

class Analysis {
  constructor(source) {
    this.source = source;
    this.replacements = []; // { start, end, prop } source ranges to swap
    this.contract = [];     // [{ prop, expr, kind, ... }]
    this.byExpr = new Map(); // expr text -> contract entry
    this.usedNames = new Set();
    this.unsupported = null;
  }

  fail(reason) {
    if (!this.unsupported) this.unsupported = reason;
  }

  propFor(exprText, kind, extra = {}) {
    const existing = this.byExpr.get(exprText);
    if (existing) return existing;
    const base = derivePropName(exprText);
    let name = base;
    let n = 2;
    while (this.usedNames.has(name)) name = `${base}${n++}`;
    this.usedNames.add(name);
    const entry = { prop: name, expr: exprText, kind, ...extra };
    this.byExpr.set(exprText, entry);
    this.contract.push(entry);
    return entry;
  }
}

// A derived prop name lands in `let { <name> } = $props()`; a reserved word
// there is a syntax error the session only hits at import time.
const RESERVED_PROP_NAMES = new Set([
  'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
  'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false',
  'finally', 'for', 'function', 'if', 'implements', 'import', 'in',
  'instanceof', 'interface', 'let', 'new', 'null', 'package', 'private',
  'protected', 'public', 'return', 'static', 'super', 'switch', 'this',
  'throw', 'true', 'try', 'typeof', 'undefined', 'var', 'void', 'while',
  'with', 'yield',
]);

export function derivePropName(expr) {
  const tail = String(expr).match(/(?:\.|\[["']?)([A-Za-z_$][\w$]*)["']?\]?\s*$/);
  const candidate = (tail && tail[1])
    || (String(expr).match(/^([A-Za-z_$][\w$]*)$/) || [])[1]
    || 'value';
  return RESERVED_PROP_NAMES.has(candidate) ? `${candidate}Value` : candidate;
}

function exprText(source, node) {
  return source.slice(node.start, node.end);
}

// Identifiers that resolve in ANY module scope. They are neither hydratable
// props nor evidence of route coupling, so they count as neither free nor
// bound: `{Math.round(x)}` must not mint a prop named `round`, and
// `{fmt(stage.label)}` must not pass as global-only.
const GLOBAL_IDENTIFIERS = new Set([
  'Math', 'JSON', 'Date', 'Intl', 'Number', 'String', 'Boolean', 'Array',
  'Object', 'Map', 'Set', 'Promise', 'RegExp', 'NaN', 'Infinity', 'undefined',
  'isNaN', 'isFinite', 'parseInt', 'parseFloat', 'encodeURIComponent',
  'decodeURIComponent', 'console', 'window', 'document', 'navigator',
  'location', 'structuredClone', 'crypto',
]);

function classifyRoots(node, scopes) {
  const roots = collectRootIdentifiers(node);
  let bound = 0;
  let free = 0;
  for (const name of roots) {
    if (GLOBAL_IDENTIFIERS.has(name)) continue;
    if (scopes.some((scope) => scope.has(name))) bound++;
    else free++;
  }
  return { bound, free };
}

function isFree(node, scopes) {
  const { bound, free } = classifyRoots(node, scopes);
  return free > 0 && bound === 0;
}

/**
 * An expression mixing loop-bound and outer free identifiers (e.g.
 * `{fmt(stage.label)}` where `fmt` lives in the route script) can neither
 * become a prop (the bound part varies per item) nor survive detachment
 * verbatim (the free name is undeclared in the preview and throws at mount,
 * past the compile gate, because globals make it legal to the compiler).
 * Source-preview mode is the only correct home for it.
 */
function failOnMixedExpression(node, scopes, analysis, source) {
  const { bound, free } = classifyRoots(node, scopes);
  if (bound > 0 && free > 0) {
    analysis.fail(`expression mixing loop and outer identifiers ({${exprText(source, node).slice(0, 60)}}) requires source-preview mode`);
    return true;
  }
  return false;
}

/**
 * Analyze a parsed template fragment. `scopes` is a stack of Sets of bound
 * names; the outermost call passes an empty stack.
 */
function analyzeFragment(fragment, analysis, scopes) {
  if (!fragment || !Array.isArray(fragment.nodes)) return;
  // ConstTag declarations bind for the whole fragment.
  const fragmentScope = new Set();
  const nextScopes = [...scopes, fragmentScope];
  for (const node of fragment.nodes) {
    if (node.type === 'ConstTag' && node.declaration) {
      for (const decl of node.declaration.declarations || []) {
        collectPatternNames(decl.id, fragmentScope);
      }
    }
  }
  for (const node of fragment.nodes) analyzeNode(node, analysis, nextScopes);
}

function analyzeNode(node, analysis, scopes) {
  if (!node || analysis.unsupported) return;
  switch (node.type) {
    case 'Text':
    case 'Comment':
      return;
    case 'ExpressionTag': {
      if (failOnMixedExpression(node.expression, scopes, analysis, analysis.source)) return;
      if (isFree(node.expression, scopes)) {
        const text = exprText(analysis.source, node.expression);
        const entry = analysis.propFor(text, 'text');
        // node.start/end include the braces; keep them, swap the inside.
        analysis.replacements.push({ start: node.expression.start, end: node.expression.end, prop: entry.prop });
      }
      return;
    }
    case 'HtmlTag': {
      if (failOnMixedExpression(node.expression, scopes, analysis, analysis.source)) return;
      if (isFree(node.expression, scopes)) {
        const text = exprText(analysis.source, node.expression);
        const entry = analysis.propFor(text, 'raw');
        analysis.replacements.push({ start: node.expression.start, end: node.expression.end, prop: entry.prop });
      }
      return;
    }
    case 'ConstTag': {
      // Its expression may read free names; leave them: the declaration
      // travels with the markup and stays valid only if its inputs do.
      if (node.declaration) {
        for (const decl of node.declaration.declarations || []) {
          if (decl.init && failOnMixedExpression(decl.init, scopes, analysis, analysis.source)) return;
          if (decl.init && isFree(decl.init, scopes)) {
            const text = exprText(analysis.source, decl.init);
            const entry = analysis.propFor(text, 'text');
            analysis.replacements.push({ start: decl.init.start, end: decl.init.end, prop: entry.prop });
          }
        }
      }
      return;
    }
    case 'EachBlock': {
      if (failOnMixedExpression(node.expression, scopes, analysis, analysis.source)) return;
      if (isFree(node.expression, scopes)) {
        const text = exprText(analysis.source, node.expression);
        const item = describeEachItem(node, analysis.source);
        // Keyed each: the key must evaluate to a distinct value per hydrated
        // item or Svelte throws each_key_duplicate at mount. A key that is a
        // plain member of the item (the common `(item.id)` shape) gets a
        // synthetic per-index value injected by the browser (keyField).
        // Anything else cannot be hydrated safely; source-preview mode keeps
        // it correct.
        if (node.key) {
          const keyInfo = classifyEachKey(node);
          if (keyInfo.unsupported) {
            analysis.fail(keyInfo.unsupported);
            return;
          }
          if (keyInfo.keyField) {
            if (item.textSlots.some((slot) => slot.key === keyInfo.keyField)) {
              // The key doubles as a displayed slot; a synthetic value would
              // change visible text, and the displayed text may not be
              // unique. Not previewable in a detached component.
              analysis.fail('each key that is also a displayed field requires source-preview mode');
              return;
            }
            item.keyField = keyInfo.keyField;
          }
        }
        const entry = analysis.propFor(text, 'collection', { item });
        analysis.replacements.push({ start: node.expression.start, end: node.expression.end, prop: entry.prop });
      }
      const bound = new Set();
      if (node.context) collectPatternNames(node.context, bound);
      if (node.index) bound.add(node.index);
      analyzeFragment(node.body, analysis, [...scopes, bound]);
      if (node.fallback) analyzeFragment(node.fallback, analysis, scopes);
      return;
    }
    case 'IfBlock': {
      if (failOnMixedExpression(node.test, scopes, analysis, analysis.source)) return;
      if (isFree(node.test, scopes)) {
        const text = exprText(analysis.source, node.test);
        // The browser hydrates a free condition from what the live page
        // currently shows: when the consequent's root element is present
        // under the picked element, the condition is on.
        const entry = analysis.propFor(text, 'condition', {
          probe: describeElementProbe(node.consequent),
        });
        analysis.replacements.push({ start: node.test.start, end: node.test.end, prop: entry.prop });
      }
      analyzeFragment(node.consequent, analysis, scopes);
      if (node.alternate) analyzeFragment(node.alternate, analysis, scopes);
      return;
    }
    case 'KeyBlock': {
      if (failOnMixedExpression(node.expression, scopes, analysis, analysis.source)) return;
      if (isFree(node.expression, scopes)) {
        const text = exprText(analysis.source, node.expression);
        const entry = analysis.propFor(text, 'text');
        analysis.replacements.push({ start: node.expression.start, end: node.expression.end, prop: entry.prop });
      }
      analyzeFragment(node.fragment, analysis, scopes);
      return;
    }
    case 'SnippetBlock': {
      const bound = new Set();
      for (const param of node.parameters || []) collectPatternNames(param, bound);
      // The snippet's own name becomes available to render tags in this file.
      analyzeFragment(node.body, analysis, [...scopes, bound]);
      return;
    }
    case 'RegularElement':
    case 'SlotElement':
    case 'TitleElement': {
      if (node.name === 'script') {
        // An inline script inside the selected block carries route-scoped
        // code; running it a second time from a detached preview is wrong.
        analysis.fail('inline script element requires source-preview mode');
        return;
      }
      analyzeAttributes(node, analysis, scopes);
      if (!analysis.unsupported) analyzeFragment(node.fragment, analysis, scopes);
      return;
    }
    case 'SvelteElement':
    case 'SvelteFragment':
    case 'SvelteBoundary': {
      analyzeAttributes(node, analysis, scopes);
      if (!analysis.unsupported) analyzeFragment(node.fragment, analysis, scopes);
      return;
    }
    case 'Component':
    case 'SvelteComponent':
    case 'SvelteSelf':
      // The component's import lives in the route file; a detached preview
      // cannot resolve it. Source-preview mode keeps it working.
      analysis.fail(`component tag <${node.name || 'Component'}> requires source-preview mode`);
      return;
    case 'RenderTag':
      analysis.fail('render tag requires source-preview mode');
      return;
    case 'AwaitBlock':
      analysis.fail('await block requires source-preview mode');
      return;
    case 'SvelteHead':
    case 'SvelteWindow':
    case 'SvelteDocument':
    case 'SvelteBody':
      analysis.fail(`${node.type} requires source-preview mode`);
      return;
    default: {
      if (node.fragment) analyzeFragment(node.fragment, analysis, scopes);
      return;
    }
  }
}

function analyzeAttributes(node, analysis, scopes) {
  for (const attr of node.attributes || []) {
    switch (attr.type) {
      case 'Attribute': {
        if (attr.value === true) break;
        const parts = Array.isArray(attr.value) ? attr.value : [attr.value];
        for (const part of parts) {
          if (!part || part.type !== 'ExpressionTag') continue;
          if (failOnMixedExpression(part.expression, scopes, analysis, analysis.source)) return;
          if (!isFree(part.expression, scopes)) continue;
          const text = exprText(analysis.source, part.expression);
          const kind = HANDLER_ATTR_RE.test(attr.name) ? 'handler' : 'text';
          const entry = analysis.propFor(text, kind);
          analysis.replacements.push({ start: part.expression.start, end: part.expression.end, prop: entry.prop });
        }
        break;
      }
      case 'ClassDirective': {
        const expr = attr.expression;
        if (expr && failOnMixedExpression(expr, scopes, analysis, analysis.source)) return;
        if (expr && isFree(expr, scopes)) {
          const text = exprText(analysis.source, expr);
          // The directive's class name is literal, so the live DOM answers
          // the condition directly: the class is either present or not.
          const entry = analysis.propFor(text, 'condition', {
            probe: { className: attr.name },
          });
          analysis.replacements.push({ start: expr.start, end: expr.end, prop: entry.prop });
        }
        break;
      }
      case 'StyleDirective': {
        // Unlike ClassDirective, a style directive stores its value in
        // attribute shape: `true` for the shorthand, else an array of parts.
        const parts = attr.value === true ? [] : (Array.isArray(attr.value) ? attr.value : [attr.value]);
        for (const part of parts) {
          if (part?.type === 'ExpressionTag'
              && failOnMixedExpression(part.expression, scopes, analysis, analysis.source)) {
            return;
          }
        }
        const dynamic = parts.some((part) => part?.type === 'ExpressionTag' && isFree(part.expression, scopes));
        const shorthandFree = attr.value === true && isFree({ type: 'Identifier', name: attr.name }, scopes);
        if (dynamic || shorthandFree) {
          // style:opacity={x} carries a css VALUE, not a boolean, and the
          // computed value on the live element is not reliably recoverable in
          // the shape the expression produced. A falsified style is worse
          // than an HMR-resetting preview.
          analysis.fail(`style:${attr.name} with a dynamic value requires source-preview mode`);
        }
        break;
      }
      case 'BindDirective':
        analysis.fail(`bind:${attr.name} requires source-preview mode`);
        return;
      case 'UseDirective':
        analysis.fail(`use:${attr.name} requires source-preview mode`);
        return;
      case 'AnimateDirective':
      case 'TransitionDirective':
        // Motion directives reference route-scoped or svelte/transition
        // imports; a detached preview cannot resolve them.
        analysis.fail(`${attr.type} requires source-preview mode`);
        return;
      case 'OnDirective': {
        // Legacy on:click syntax; treat like handler attributes.
        const expr = attr.expression;
        if (expr && failOnMixedExpression(expr, scopes, analysis, analysis.source)) return;
        if (expr && isFree(expr, scopes)) {
          const text = exprText(analysis.source, expr);
          const entry = analysis.propFor(text, 'handler');
          analysis.replacements.push({ start: expr.start, end: expr.end, prop: entry.prop });
        }
        break;
      }
      case 'SpreadAttribute':
        analysis.fail('spread attribute requires source-preview mode');
        return;
      default:
        break;
    }
  }
}

/**
 * Describe the repeating item of an each block for browser-side hydration:
 * the item's root element (tag + static classes, used to count live
 * iterations) and the ordered text slots that reference loop bindings.
 */
function describeEachItem(node, source) {
  const body = node.body;
  const rootEl = (body?.nodes || []).find((n) => n.type === 'RegularElement');

  const textSlots = [];
  const staticTexts = [];
  let nestedUnsupported = false;
  const collectStatics = (fragment) => {
    for (const child of fragment?.nodes || []) {
      if (child.type === 'Text') {
        const trimmed = String(child.data || '').trim();
        if (trimmed) staticTexts.push(trimmed);
      } else if (child.type === 'IfBlock') {
        collectStatics(child.consequent);
        if (child.alternate) collectStatics(child.alternate);
      } else if (child.type === 'EachBlock') {
        collectStatics(child.body);
      } else if (child.fragment) {
        collectStatics(child.fragment);
      }
    }
  };
  collectStatics(body);
  const attrSlots = [];
  // The hydration item is a SHALLOW object whose string fields are the exact
  // property names the markup accesses, filled from the rendered page. That
  // model supports one item access per slot, optionally wrapped in a global
  // transform ({Math.round(r.score)} hydrates `score`). Shapes it cannot
  // represent split two ways: CRASHY ones would throw at mount time against a
  // shallow item (deep paths like r.meta.label, method calls like r.format())
  // and force the source-preview fallback; LOSSY ones render wrong but safe
  // (bare {r}, multi-access expressions that would double their text) and
  // also fall back in text position, where the damage is visible.
  const boundAs = (name, scopeInfos) => {
    for (let i = scopeInfos.length - 1; i >= 0; i--) {
      const info = scopeInfos[i];
      if (info.indexName === name) return 'index';
      if (info.itemName === name) return 'item';
      if (info.names.has(name)) return 'field';
    }
    return null;
  };
  const slotKeysOf = (expression, scopeInfos) => {
    const keys = new Set();
    let crashy = false;
    let lossy = false;
    let touches = false;
    const visit = (node, ctx) => {
      if (!node || typeof node !== 'object' || crashy) return;
      if (Array.isArray(node)) {
        for (const item of node) visit(item, {});
        return;
      }
      switch (node.type) {
        case 'Identifier': {
          const kind = boundAs(node.name, scopeInfos);
          if (!kind) return;
          touches = true;
          if (kind === 'index') return; // the runtime each provides it
          if (kind === 'item') { lossy = true; return; } // bare item reference
          if (ctx.callee) { crashy = true; return; } // field() on a hydrated string
          keys.add(node.name); // destructured context field
          return;
        }
        case 'MemberExpression': {
          if (
            !node.computed
            && node.object?.type === 'Identifier'
            && boundAs(node.object.name, scopeInfos) === 'item'
            && node.property?.type === 'Identifier'
          ) {
            touches = true;
            // item.a.b or item.method(): a shallow string field throws here.
            if (ctx.memberObject || ctx.callee) { crashy = true; return; }
            keys.add(node.property.name);
            return;
          }
          visit(node.object, { memberObject: true });
          if (node.computed) visit(node.property, {});
          return;
        }
        case 'CallExpression':
          visit(node.callee, { callee: true });
          for (const arg of node.arguments || []) visit(arg, {});
          return;
        case 'ArrowFunctionExpression':
        case 'FunctionExpression': {
          // Closures cannot hydrate; only lossy when they capture the item.
          const roots = collectRootIdentifiers(node);
          if ([...roots].some((name) => boundAs(name, scopeInfos))) { touches = true; lossy = true; }
          return;
        }
        case 'Property':
          if (node.computed) visit(node.key, {});
          visit(node.value, {});
          return;
        default: {
          for (const key of Object.keys(node)) {
            if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range' || key === 'parent') continue;
            visit(node[key], {});
          }
        }
      }
    };
    visit(expression, {});
    if (crashy) return { crashy: true };
    if (lossy || keys.size > 1) return { lossy: true };
    if (!touches || keys.size === 0) return { skip: true };
    return { key: [...keys][0] };
  };
  const staticClassesOf = (el) => {
    const classes = [];
    for (const attr of el?.attributes || []) {
      if (attr.type === 'Attribute' && attr.name === 'class' && Array.isArray(attr.value)) {
        for (const part of attr.value) {
          if (part.type === 'Text') classes.push(...part.data.split(/\s+/).filter(Boolean));
        }
      }
    }
    return classes;
  };
  const scopeInfoOf = (eachNode) => {
    const names = new Set();
    if (eachNode.context) collectPatternNames(eachNode.context, names);
    return {
      names,
      itemName: eachNode.context?.type === 'Identifier' ? eachNode.context.name : null,
      indexName: eachNode.index || null,
    };
  };
  const walkForSlots = (fragment, scopeInfos) => {
    for (const child of fragment?.nodes || []) {
      if (child.type === 'ExpressionTag') {
        const slot = slotKeysOf(child.expression, scopeInfos);
        if (slot.crashy || slot.lossy) { nestedUnsupported = true; continue; }
        if (slot.skip) continue;
        textSlots.push({ key: slot.key, expr: exprText(source, child.expression) });
      } else if (child.type === 'RegularElement' || child.type === 'SvelteElement') {
        // Bound values in ATTRIBUTES (href={link.href}, src={item.img}) are
        // part of the item too: the browser reads the rendered attribute off
        // the live element, so the preview does not mount with empty links.
        // Only a single-expression attribute hydrates exactly; a mixed value
        // ("card {r.status}") stays unhydrated because the rendered attribute
        // is not separable into its parts, which was the prior behavior.
        for (const attr of child.attributes || []) {
          if (attr.type !== 'Attribute' || attr.value === true) continue;
          if (HANDLER_ATTR_RE.test(attr.name)) continue; // functions cannot hydrate
          const parts = Array.isArray(attr.value) ? attr.value : [attr.value];
          const exprParts = parts.filter((part) => part?.type === 'ExpressionTag');
          for (const part of exprParts) {
            const slot = slotKeysOf(part.expression, scopeInfos);
            if (slot.crashy) { nestedUnsupported = true; continue; }
            if (slot.skip || slot.lossy) continue;
            if (parts.length !== 1) continue; // mixed static+dynamic value
            attrSlots.push({
              key: slot.key,
              expr: exprText(source, part.expression),
              attr: attr.name,
              tag: child.name || null,
              classes: staticClassesOf(child),
            });
          }
        }
        walkForSlots(child.fragment, scopeInfos);
        continue;
      } else if (child.type === 'EachBlock') {
        const roots = collectRootIdentifiers(child.expression);
        const boundNested = [...roots].some((name) => boundAs(name, scopeInfos));
        if (boundNested) nestedUnsupported = true; // nested per-item arrays: no hydration plan yet
        walkForSlots(child.body, [...scopeInfos, scopeInfoOf(child)]);
      } else if (child.type === 'IfBlock') {
        walkForSlots(child.consequent, scopeInfos);
        if (child.alternate) walkForSlots(child.alternate, scopeInfos);
      } else if (child.fragment) {
        walkForSlots(child.fragment, scopeInfos);
      }
    }
  };
  walkForSlots(body, [scopeInfoOf(node)]);

  const staticClasses = [];
  for (const attr of rootEl?.attributes || []) {
    if (attr.type === 'Attribute' && attr.name === 'class' && Array.isArray(attr.value)) {
      for (const part of attr.value) {
        if (part.type === 'Text') staticClasses.push(...part.data.split(/\s+/).filter(Boolean));
      }
    }
  }

  return {
    rootTag: rootEl?.name || null,
    rootClasses: staticClasses,
    textSlots,
    attrSlots,
    staticTexts,
    nestedUnsupported,
  };
}

/**
 * Classify a keyed each block's key expression:
 *   { keyField }        member of the loop item (e.g. `(expense.id)` when the
 *                       context binds `expense`): browser injects a unique
 *                       per-index value under that field.
 *   {}                  key is the whole loop item or the index: already
 *                       distinct per iteration, nothing to inject.
 *   { unsupported }     free or complex keys: cannot hydrate distinct values.
 */
function classifyEachKey(node) {
  const bound = new Set();
  if (node.context) collectPatternNames(node.context, bound);
  if (node.index) bound.add(node.index);
  const key = node.key;
  const roots = collectRootIdentifiers(key);
  const usesLoopBinding = [...roots].some((name) => bound.has(name));
  if (!usesLoopBinding) {
    // A key that ignores the loop item is constant across iterations:
    // guaranteed duplicate keys at mount.
    return { unsupported: 'each key not derived from the loop item requires source-preview mode' };
  }
  if (key.type === 'Identifier' && bound.has(key.name)) return {};
  if (
    key.type === 'MemberExpression'
    && !key.computed
    && key.object?.type === 'Identifier'
    && bound.has(key.object.name)
    && key.property?.type === 'Identifier'
  ) {
    return { keyField: key.property.name };
  }
  return { unsupported: 'complex each key requires source-preview mode' };
}

/**
 * Describe a fragment's root element for browser presence probing:
 * { tag, classes } of the first RegularElement, or null for text-only
 * fragments (which cannot be probed reliably).
 */
function describeElementProbe(fragment) {
  const rootEl = (fragment?.nodes || []).find((n) => n.type === 'RegularElement');
  if (!rootEl) return null;
  const classes = [];
  for (const attr of rootEl.attributes || []) {
    if (attr.type === 'Attribute' && attr.name === 'class' && Array.isArray(attr.value)) {
      for (const part of attr.value) {
        if (part.type === 'Text') classes.push(...part.data.split(/\s+/).filter(Boolean));
      }
    }
  }
  return { tag: rootEl.name, classes };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyze a markup block and produce the prop-substituted scaffold markup and
 * the v2 prop contract. Returns { ok: false, reason } when the block needs
 * source-preview mode (parse failure or unsupported construct).
 */
export function analyzeSvelteMarkup(markup, parse) {
  const source = String(markup || '');
  let ast;
  try {
    ast = parse(source, { modern: true });
  } catch (err) {
    return { ok: false, reason: `svelte parse failed: ${err.message}` };
  }
  if (ast.instance || ast.module) {
    return { ok: false, reason: 'selected block contains a script tag' };
  }
  const analysis = new Analysis(source);
  analyzeFragment(ast.fragment, analysis, []);
  if (analysis.unsupported) {
    return { ok: false, reason: analysis.unsupported };
  }
  for (const entry of analysis.contract) {
    if (entry.kind === 'collection' && entry.item?.nestedUnsupported) {
      return { ok: false, reason: 'per-item content (nested blocks or expressions) this preview cannot hydrate requires source-preview mode' };
    }
  }

  const markupWithProps = applyReplacements(source, analysis.replacements);
  return {
    ok: true,
    markupWithProps,
    contract: analysis.contract.map((entry) => ({
      prop: entry.prop,
      expr: entry.expr,
      kind: entry.kind,
      // Kept for backward compatibility with v1 consumers (fake e2e agent,
      // text-only restore paths).
      placeholder: `{${entry.expr}}`,
      ...(entry.item ? { item: entry.item } : {}),
      ...(entry.probe ? { probe: entry.probe } : {}),
    })),
  };
}

function applyReplacements(source, replacements) {
  const sorted = [...replacements].sort((a, b) => b.start - a.start);
  let out = source;
  for (const { start, end, prop } of sorted) {
    out = out.slice(0, start) + prop + out.slice(end);
  }
  return out;
}

/**
 * Restore a variant's markup back to route-source form: every free
 * identifier that matches a contract prop is replaced by its original
 * expression. AST-based so `{#each stages as stage}` restores to
 * `{#each data.stages as stage}` even though the prop appears without braces.
 */
export function restoreSvelteMarkup(markup, contract, parse) {
  const source = String(markup || '');
  const byProp = new Map();
  for (const entry of contract || []) byProp.set(entry.prop, entry.expr);
  if (byProp.size === 0) return { ok: true, markup: source };

  let ast;
  try {
    ast = parse(source, { modern: true });
  } catch (err) {
    return { ok: false, reason: `variant parse failed: ${err.message}` };
  }

  const replacements = [];
  const visitExpr = (expression, scopes) => {
    if (!expression) return;
    collectFreeIdentifierRanges(expression, scopes, (name, start, end) => {
      const original = byProp.get(name);
      if (original != null && original !== name) replacements.push({ start, end, prop: original });
    });
  };

  const walk = (fragment, scopes) => {
    const fragmentScope = new Set();
    const nextScopes = [...scopes, fragmentScope];
    for (const node of fragment?.nodes || []) {
      if (node.type === 'ConstTag' && node.declaration) {
        for (const decl of node.declaration.declarations || []) collectPatternNames(decl.id, fragmentScope);
      }
    }
    for (const node of fragment?.nodes || []) {
      switch (node?.type) {
        case 'ExpressionTag':
        case 'HtmlTag':
          visitExpr(node.expression, nextScopes);
          break;
        case 'ConstTag':
          for (const decl of node.declaration?.declarations || []) visitExpr(decl.init, nextScopes);
          break;
        case 'EachBlock': {
          visitExpr(node.expression, nextScopes);
          const bound = new Set();
          if (node.context) collectPatternNames(node.context, bound);
          if (node.index) bound.add(node.index);
          // The key evaluates per item, so the loop context and index are in
          // scope there. Visiting it with outer scopes only let a contract
          // prop that shares a loop binding's name rewrite the key.
          if (node.key) visitExpr(node.key, [...nextScopes, bound]);
          walk(node.body, [...nextScopes, bound]);
          if (node.fallback) walk(node.fallback, nextScopes);
          break;
        }
        case 'IfBlock':
          visitExpr(node.test, nextScopes);
          walk(node.consequent, nextScopes);
          if (node.alternate) walk(node.alternate, nextScopes);
          break;
        case 'KeyBlock':
          visitExpr(node.expression, nextScopes);
          walk(node.fragment, nextScopes);
          break;
        case 'SnippetBlock': {
          const bound = new Set();
          for (const param of node.parameters || []) collectPatternNames(param, bound);
          walk(node.body, [...nextScopes, bound]);
          break;
        }
        default: {
          for (const attr of node?.attributes || []) {
            if (attr.type === 'Attribute' && Array.isArray(attr.value)) {
              for (const part of attr.value) {
                if (part?.type === 'ExpressionTag') visitExpr(part.expression, nextScopes);
              }
            } else if (attr.expression) {
              visitExpr(attr.expression, nextScopes);
            }
          }
          if (node?.fragment) walk(node.fragment, nextScopes);
        }
      }
    }
  };
  walk(ast.fragment, []);

  return { ok: true, markup: applyReplacements(source, replacements) };
}

/**
 * Report [name, start, end] for every free root identifier READ in an
 * expression (skips member properties, object keys, shadowed names).
 */
function collectFreeIdentifierRanges(node, scopes, emit) {
  const visit = (n, localBound) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { for (const item of n) visit(item, localBound); return; }
    switch (n.type) {
      case 'Identifier': {
        const bound = localBound.has(n.name) || scopes.some((s) => s.has(n.name));
        if (!bound) emit(n.name, n.start, n.end);
        return;
      }
      case 'MemberExpression':
        visit(n.object, localBound);
        if (n.computed) visit(n.property, localBound);
        return;
      case 'Property':
        if (n.computed) visit(n.key, localBound);
        visit(n.value, localBound);
        return;
      case 'ArrowFunctionExpression':
      case 'FunctionExpression': {
        const inner = new Set(localBound);
        for (const param of n.params || []) collectPatternNames(param, inner);
        visit(n.body, inner);
        return;
      }
      default:
        for (const key of Object.keys(n)) {
          if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range' || key === 'parent') continue;
          visit(n[key], localBound);
        }
    }
  };
  visit(node, new Set());
}

/**
 * Build the preview component's script block from a v2 contract, with
 * defaults that keep an unhydrated mount rendering instead of crashing.
 */
// `/** @type {...} */` directly before a destructuring declaration is also
// JSDoc's cast syntax, and Svelte 5.50+ re-emits the annotation in cast form
// onto the template's own declaration: `var /** @type {...} */ (h1) = root()`.
// That is a syntax error, so the browser's dynamic import of the variant dies
// with "Unexpected token '('" and nothing renders. `@typedef` carries the same
// shape without being a cast. Keep it a typedef;
// tests/live-svelte-props-script.test.mjs compiles what these builders emit
// and parses the result.
export function buildPropsScriptV2(contract) {
  if (!contract || contract.length === 0) {
    return '<script>\n  /** @typedef {Record<string, never>} Props */\n  let {} = $props();\n</script>\n';
  }
  const defaults = {
    text: "''",
    raw: "''",
    condition: 'false',
    collection: '[]',
    handler: '() => {}',
  };
  const types = {
    text: 'string',
    raw: 'string',
    condition: 'boolean',
    collection: 'Array<Record<string, unknown>>',
    handler: '() => void',
  };
  const names = contract
    .map((c) => `${c.prop} = ${defaults[c.kind] ?? "''"}`)
    .join(', ');
  const typeFields = contract
    .map((c) => `    ${c.prop}?: ${types[c.kind] ?? 'string'};`)
    .join('\n');
  return `<script>\n  /** @typedef {{\n${typeFields}\n  }} Props */\n  let { ${names} } = $props();\n</script>\n`;
}
