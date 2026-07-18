/**
 * Agent module for the live-mode E2E test suite.
 *
 * Two layers:
 *
 * 1. `runAgentLoop(opts)` — the deterministic wrapper around the live-mode
 *    poll/wrap/write/accept protocol. This is identical for fake and real
 *    agents; only the variant-content production step differs.
 *
 * 2. `createFakeAgent()` — produces canned variants in the EXACT format
 *    `skill/reference/live.md` describes: a colocated
 *    `<style data-impeccable-css="ID">` block with `@scope ([data-impeccable-variant="N"])`
 *    rules, a `data-impeccable-params` JSON manifest covering range + steps + toggle
 *    kinds across the variant set, single top-level element per variant matching
 *    the original tag.
 *
 * A future LLM-backed agent slots in by implementing the same LiveAgent
 * interface: `generateVariants(event, context)` for picks, optional
 * `handleSteer(event, context)` for page-level Steer bar messages, and
 * optional `applyManualEdits(event, context)` for Manual Apply.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { completionTypeForAcceptResult } from '../../skill/scripts/live/completion.mjs';

const execFileP = promisify(execFile);

export const STEER_MARKER_ATTR = 'data-impeccable-steer';
export const STEER_MARKER_VALUE = 'e2e';

// ---------------------------------------------------------------------------
// Variant-output schema
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ParamSpec
 * @property {string} id
 * @property {'range' | 'steps' | 'toggle'} kind
 * @property {string} label
 * @property {*}      default
 * @property {number=} min
 * @property {number=} max
 * @property {number=} step
 * @property {Array<{value: string, label: string}>=} options
 *
 * @typedef {Object} VariantSpec
 * @property {string}  innerHtml         Single top-level element matching the
 *                                       original's tag (e.g. '<h1 ...>...</h1>').
 * @property {ParamSpec[]=} params       Optional 0-4 param manifest.
 *
 * @typedef {Object} GenerateOutput
 * @property {string}        scopedCss   Contents of the <style data-impeccable-css>
 *                                       block — `@scope` rules per variant.
 * @property {VariantSpec[]} variants
 *
 * @typedef {Object} ManualEditApplyOutput
 * @property {'done' | 'partial' | 'error'} status
 * @property {string[]=} appliedEntryIds
 * @property {Array<{entryId: string, reason: string, candidates?: object[]}>=} failed
 * @property {string[]=} files
 * @property {string[]=} notes
 *
 * @typedef {Object} SteerOutput
 * @property {string=} message  Optional short toast forwarded in steer_done.
 *
 * @typedef {Object} LiveAgent
 * @property {(event: object, context: object) => Promise<GenerateOutput>} generateVariants
 * @property {(event: object, context: object) => Promise<SteerOutput>} [handleSteer]
 * @property {(event: object, context: object) => Promise<ManualEditApplyOutput>} [applyManualEdits]
 */

// ---------------------------------------------------------------------------
// Fake agent — canned, format-faithful variants
// ---------------------------------------------------------------------------

/**
 * Build a fake agent that produces deterministic variants for an `<h1 class="hero-title">`
 * target. The exact CSS values are chosen so the test can later assert them
 * via `getComputedStyle` — variant 1 → red, variant 2 → bold, variant 3 → uppercase.
 *
 * The output mirrors a real agent's write-back faithfully:
 *   - <style data-impeccable-css="ID"> with @scope rules per variant
 *   - data-impeccable-params manifest with range + steps + toggle kinds
 *   - first variant visible (no display:none), rest hidden by the agent caller
 *   - inner content = single <h1> per variant
 */
export function createFakeAgent() {
  return {
    /** @type {LiveAgent['generateVariants']} */
    async generateVariants(event, context = {}) {
      if (event.mode === 'insert') {
        return generateInsertFakeVariants(context);
      }
      const text = event.element?.textContent?.trim() || extractText(event.element?.outerHTML) || 'Title';
      const tag = (event.element?.tagName || 'h1').toLowerCase();
      const cls = (event.element?.classes || ['hero-title'])
        .filter((name) => !/^svelte-[\w-]+$/.test(name))
        .join(' ')
        || 'hero-title';
      const preservedAttrs = buildPreservedVariantAttrs(event.element || {}, cls);
      const elementOpen = `<${tag}${preservedAttrs}>`;
      const elementClose = `</${tag}>`;
      const variantHtml = `${elementOpen}${htmlEscape(text)}${elementClose}`;
      const useAstroGlobalCss = context.wrapInfo?.styleMode === 'astro-global-prefixed';

      // Variant 1 — red color, with a `range` param tuning hue lightness.
      const variant1 = {
        innerHtml: variantHtml,
        params: [
          {
            id: 'lightness',
            kind: 'range',
            min: 0.3,
            max: 0.7,
            step: 0.05,
            default: 0.5,
            label: 'Lightness',
          },
        ],
      };

      // Variant 2 — bold weight, with a `steps` param for serif/sans/mono.
      const variant2 = {
        innerHtml: variantHtml,
        params: [
          {
            id: 'face',
            kind: 'steps',
            default: 'sans',
            label: 'Face',
            options: [
              { value: 'sans', label: 'Sans' },
              { value: 'serif', label: 'Serif' },
              { value: 'mono', label: 'Mono' },
            ],
          },
        ],
      };

      // Variant 3 — uppercase, with a `toggle` param for italic.
      const variant3 = {
        innerHtml: variantHtml,
        params: [
          {
            id: 'italic',
            kind: 'toggle',
            default: false,
            label: 'Italic',
          },
        ],
      };

      // Scoped CSS for most frameworks. Astro component styles are transformed
      // and scoped by the compiler, so live preview CSS must use a global style
      // tag plus explicit variant prefixes instead of raw @scope rules.
      const scopedCss = useAstroGlobalCss
        ? [
            `[data-impeccable-variant="1"] > ${tag} {`,
            '  color: oklch(var(--p-lightness, 0.5) 0.25 25);',
            '}',
            `[data-impeccable-variant="2"] > ${tag} { font-weight: 900; }`,
            `[data-impeccable-variant="2"][data-p-face="serif"] > ${tag} { font-family: ui-serif, serif; }`,
            `[data-impeccable-variant="2"][data-p-face="mono"]  > ${tag} { font-family: ui-monospace, monospace; }`,
            `[data-impeccable-variant="3"] > ${tag} { text-transform: uppercase; letter-spacing: 0.04em; }`,
            `[data-impeccable-variant="3"][data-p-italic] > ${tag} { font-style: italic; }`,
          ].join('\n')
        : [
            '@scope ([data-impeccable-variant="1"]) {',
            `  :scope > ${tag} {`,
            '    color: oklch(var(--p-lightness, 0.5) 0.25 25);',
            '  }',
            '}',
            '@scope ([data-impeccable-variant="2"]) {',
            `  :scope > ${tag} { font-weight: 900; }`,
            `  :scope[data-p-face="serif"] > ${tag} { font-family: ui-serif, serif; }`,
            `  :scope[data-p-face="mono"]  > ${tag} { font-family: ui-monospace, monospace; }`,
            '}',
            '@scope ([data-impeccable-variant="3"]) {',
            `  :scope > ${tag} { text-transform: uppercase; letter-spacing: 0.04em; }`,
            `  :scope[data-p-italic] > ${tag} { font-style: italic; }`,
            '}',
          ].join('\n');

      return {
        scopedCss,
        variants: [variant1, variant2, variant3],
      };
    },

    /** @type {LiveAgent['applyManualEdits']} */
    async applyManualEdits(event, context = {}) {
      const batch = await loadManualEditEventBatch(event, { tmp: context.tmp });
      return applyManualEditBatchToSource(batch, { tmp: context.tmp, repair: event.repair || null });
    },

    /** @type {LiveAgent['handleSteer']} */
    async handleSteer(_event, context) {
      await handleSteerDeterministic(context);
      return { message: 'Hero marked' };
    },
  };
}

function generateInsertFakeVariants(context = {}) {
  const useAstroGlobalCss = context.wrapInfo?.styleMode === 'astro-global-prefixed';

  const variant1 = {
    innerHtml: '<div class="inserted-strip"><p class="inserted-copy">Insert variant one</p></div>',
    params: [
      {
        id: 'lightness',
        kind: 'range',
        min: 0.3,
        max: 0.7,
        step: 0.05,
        default: 0.5,
        label: 'Lightness',
      },
    ],
  };

  const variant2 = {
    innerHtml: '<div class="inserted-strip"><p class="inserted-copy">Insert variant two</p></div>',
    params: [
      {
        id: 'face',
        kind: 'steps',
        default: 'sans',
        label: 'Face',
        options: [
          { value: 'sans', label: 'Sans' },
          { value: 'serif', label: 'Serif' },
          { value: 'mono', label: 'Mono' },
        ],
      },
    ],
  };

  const variant3 = {
    innerHtml: '<div class="inserted-strip"><p class="inserted-copy">Insert variant three</p></div>',
    params: [
      {
        id: 'italic',
        kind: 'toggle',
        default: false,
        label: 'Italic',
      },
    ],
  };

  const scopedCss = useAstroGlobalCss
    ? [
        '[data-impeccable-variant="1"] .inserted-copy {',
        '  color: oklch(var(--p-lightness, 0.5) 0.25 25);',
        '}',
        '[data-impeccable-variant="2"] .inserted-copy { font-weight: 900; }',
        '[data-impeccable-variant="2"][data-p-face="serif"] .inserted-copy { font-family: ui-serif, serif; }',
        '[data-impeccable-variant="2"][data-p-face="mono"]  .inserted-copy { font-family: ui-monospace, monospace; }',
        '[data-impeccable-variant="3"] .inserted-copy { text-transform: uppercase; letter-spacing: 0.04em; }',
        '[data-impeccable-variant="3"][data-p-italic] .inserted-copy { font-style: italic; }',
      ].join('\n')
    : [
        '@scope ([data-impeccable-variant="1"]) {',
        '  :scope .inserted-copy {',
        '    color: oklch(var(--p-lightness, 0.5) 0.25 25);',
        '  }',
        '}',
        '@scope ([data-impeccable-variant="2"]) {',
        '  :scope .inserted-copy { font-weight: 900; }',
        '  :scope[data-p-face="serif"] .inserted-copy { font-family: ui-serif, serif; }',
        '  :scope[data-p-face="mono"]  .inserted-copy { font-family: ui-monospace, monospace; }',
        '}',
        '@scope ([data-impeccable-variant="3"]) {',
        '  :scope .inserted-copy { text-transform: uppercase; letter-spacing: 0.04em; }',
        '  :scope[data-p-italic] .inserted-copy { font-style: italic; }',
        '}',
      ].join('\n');

  return {
    scopedCss,
    variants: [variant1, variant2, variant3],
  };
}

export function insertTargetFromEvent(event) {
  const anchor = event?.insert?.anchor || {};
  const classes = Array.isArray(anchor.classes)
    ? anchor.classes.join(' ')
    : (anchor.classes || '');
  const text = typeof anchor.textContent === 'string'
    ? anchor.textContent.trim().slice(0, 80)
    : '';
  return {
    position: event?.insert?.position === 'before' ? 'before' : 'after',
    classes: classes || undefined,
    tag: anchor.tagName || anchor.tag || undefined,
    elementId: anchor.id || anchor.elementId || undefined,
    text: text || undefined,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractText(outerHTML) {
  if (!outerHTML) return null;
  const m = outerHTML.match(/>([^<]+)</);
  return m ? m[1].trim() : null;
}

function htmlEscape(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function htmlAttrEscape(str) {
  return htmlEscape(str).replace(/"/g, '&quot;');
}

function buildPreservedVariantAttrs(element, className) {
  const attrs = [];
  if (className) attrs.push(['class', className]);
  if (element.id) attrs.push(['id', element.id]);
  const testId = readAttrFromOuterHtml(element.outerHTML, 'data-testid');
  if (testId) attrs.push(['data-testid', testId]);
  return attrs.map(([name, value]) => ` ${name}="${htmlAttrEscape(value)}"`).join('');
}

function readAttrFromOuterHtml(outerHTML, attr) {
  if (!outerHTML) return null;
  const match = String(outerHTML).match(new RegExp("\\s" + attr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "\\s*=\\s*([\"'])(.*?)\\1"));
  return match ? match[2] : null;
}

function attrEscape(str, { svelte = false } = {}) {
  let s = String(str).replace(/&/g, '&amp;').replace(/'/g, '&apos;');
  if (svelte) {
    // Svelte parses `{` in attribute values as expression starters even
    // inside quoted strings — see https://svelte.dev/e/expected_token .
    // Escape with HTML numeric entities so the literal characters land in
    // the rendered DOM attribute.
    s = s.replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');
  }
  return s;
}

/**
 * Translate an HTML snippet to JSX. The fake and LLM agents write innerHtml
 * in HTML form; the orchestrator translates per the target file's syntax.
 */
export function htmlToJsx(html) {
  return selfCloseHtmlVoidTagsForJsx(String(html)
    .replace(/(^|[\s<])class=/g, '$1className=')
    .replace(/\sstyle=(["'])([\s\S]*?)\1/g, (_match, _quote, value) => {
      const entries = parseInlineStyle(value);
      if (entries.length === 0) return '';
      return ' style={{ ' + entries.map(({ prop, value }) => `${formatJsxStyleKey(prop)}: ${JSON.stringify(value)}`).join(', ') + ' }}';
    }));
}

const JSX_VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);

function selfCloseHtmlVoidTagsForJsx(html) {
  let result = '';
  let index = 0;

  while (index < html.length) {
    const lt = html.indexOf('<', index);
    if (lt === -1) {
      result += html.slice(index);
      break;
    }
    result += html.slice(index, lt);

    const tagMatch = html.slice(lt + 1).match(/^([A-Za-z][\w:-]*)/);
    if (!tagMatch) {
      result += '<';
      index = lt + 1;
      continue;
    }

    const tagName = tagMatch[1];
    let end = lt + 1 + tagName.length;
    let quote = null;
    while (end < html.length) {
      const ch = html[end];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '>') {
        break;
      }
      end++;
    }

    if (end >= html.length) {
      result += html.slice(lt);
      break;
    }

    const tag = html.slice(lt, end + 1);
    if (!JSX_VOID_TAGS.has(tagName.toLowerCase()) || /\/\s*>$/.test(tag)) {
      result += tag;
    } else {
      result += html.slice(lt, end).replace(/\s+$/, '') + ' />';
    }
    index = end + 1;
  }

  return result;
}

function parseInlineStyle(style) {
  return splitInlineStyleDeclarations(String(style))
    .map((decl) => decl.trim())
    .filter(Boolean)
    .map(parseInlineStyleDeclaration)
    .filter(Boolean);
}

function splitInlineStyleDeclarations(style) {
  const declarations = [];
  let quote = null;
  let escaped = false;
  let parenDepth = 0;
  let start = 0;

  for (let i = 0; i < style.length; i++) {
    const ch = style[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '(') {
      parenDepth++;
      continue;
    }
    if (ch === ')' && parenDepth > 0) {
      parenDepth--;
      continue;
    }
    if (ch === ';' && parenDepth === 0) {
      declarations.push(style.slice(start, i));
      start = i + 1;
    }
  }

  declarations.push(style.slice(start));
  return declarations;
}

function parseInlineStyleDeclaration(decl) {
  const colon = decl.indexOf(':');
  if (colon <= 0) return null;
  const prop = decl.slice(0, colon).trim();
  const value = decl.slice(colon + 1).trim();
  if (!prop || !value) return null;
  return { prop, value };
}

function formatJsxStyleKey(prop) {
  if (prop.startsWith('--')) return JSON.stringify(prop);
  const reactKey = cssPropertyToReactKey(prop);
  return /^[A-Za-z_$][\w$]*$/.test(reactKey) ? reactKey : JSON.stringify(prop);
}

function cssPropertyToReactKey(prop) {
  const lower = prop.toLowerCase();
  if (lower.startsWith('-webkit-')) return 'Webkit' + capitalize(camelCaseCssProperty(lower.slice(8)));
  if (lower.startsWith('-moz-')) return 'Moz' + capitalize(camelCaseCssProperty(lower.slice(5)));
  if (lower.startsWith('-o-')) return 'O' + capitalize(camelCaseCssProperty(lower.slice(3)));
  if (lower.startsWith('-ms-')) return 'ms' + camelCaseCssProperty(lower.slice(4));
  if (lower === 'float') return 'cssFloat';
  return camelCaseCssProperty(prop);
}

function camelCaseCssProperty(prop) {
  return prop.replace(/-([a-z])/gi, (_match, ch) => ch.toUpperCase());
}

function capitalize(str) {
  return str ? str[0].toUpperCase() + str.slice(1) : str;
}

export const HOIST_ATTR = 'data-impeccable-hoist-id';

export function normalizeVariantOutput(output, wrapInfo = {}) {
  const scopedCssInput = output.scopedCss || '';
  const normalizedInputCss = normalizeVariantSelectorQuotes(scopedCssInput);
  const extraCss = [];
  const variants = output.variants.map((variant, i) => {
    const { innerHtml, groups } = stripInlineStylesPerElement(String(variant.innerHtml));

    for (const { hoistId, declarations } of groups) {
      extraCss.push(renderHoistedInlineStyleRule({
        variantId: i + 1,
        hoistId,
        declarations,
        styleMode: wrapInfo.styleMode,
      }));
    }

    return { ...variant, innerHtml };
  });

  const baseCss = renderMissingBaseVariantRules({
    scopedCss: normalizedInputCss,
    count: output.variants.length,
    styleMode: wrapInfo.styleMode,
  });
  if (extraCss.length === 0 && baseCss.length === 0 && normalizedInputCss === scopedCssInput) return output;
  const scopedCss = [normalizedInputCss, ...extraCss, ...baseCss]
    .map((chunk) => String(chunk).trim())
    .filter(Boolean)
    .join('\n');

  return { ...output, scopedCss, variants };
}

function normalizeVariantSelectorQuotes(css) {
  return String(css).replace(
    /\[data-impeccable-variant=(['"])(\d+)\1\]/g,
    (_match, _quote, id) => `[data-impeccable-variant="${id}"]`,
  );
}

export async function applyManualEditBatchToSource(batch, { tmp, sourceEdits, repair = null } = {}) {
  if (!tmp) throw new Error('manual edit apply requires tmp project root');
  const fileCache = new Map();
  const filesTouched = new Set();
  const appliedEntryIds = [];
  const failed = [];
  const sourceEditQueue = Array.isArray(sourceEdits) ? [...sourceEdits] : null;
  const allowAlreadyApplied = !!repair;

  const readRelativeFile = async (relativeFile) => {
    if (fileCache.has(relativeFile)) return fileCache.get(relativeFile);
    const full = safeProjectPath(tmp, relativeFile);
    const body = await fs.readFile(full, 'utf-8');
    fileCache.set(relativeFile, body);
    return body;
  };

  for (const entry of batch?.entries || []) {
    const beforeEntry = new Map(fileCache);
    const beforeTouched = new Set(filesTouched);
    const keyRenames = sourceKeyRenamesForEntry(entry);
    const entrySourceEdits = sourceEditQueue
      ? sourceEditQueue.filter((edit) => edit.entryId === entry.id)
      : null;
    let entryFailed = null;

    if (sourceEditQueue) {
      if (entrySourceEdits.length === 0) {
        entryFailed = { reason: 'no source edits returned', candidates: candidatesForEntry(batch, entry.id) };
      }
      for (const edit of entrySourceEdits) {
        if (entryFailed) break;
        const relativeFile = normalizeRelativeSourceFile(edit.file);
        if (!relativeFile) {
          entryFailed = { reason: 'invalid source edit file', candidates: candidatesForEntry(batch, entry.id) };
          break;
        }
        try {
          const body = await readRelativeFile(relativeFile);
          const replaced = replaceTextInSource(body, {
            originalText: edit.originalText,
            newText: edit.newText,
            line: edit.line,
            contextHints: contextHintsForEntry(entry),
          });
          if (!replaced.ok) {
            if (allowAlreadyApplied && sourceAlreadyShowsAppliedOp(body, {
              file: relativeFile,
              line: edit.line,
            }, edit)) {
              filesTouched.add(relativeFile);
              continue;
            }
            entryFailed = { reason: replaced.reason, candidates: candidatesForEntry(batch, entry.id) };
            break;
          }
          fileCache.set(relativeFile, replaced.body);
          filesTouched.add(relativeFile);
        } catch (err) {
          entryFailed = { reason: err.message, candidates: candidatesForEntry(batch, entry.id) };
          break;
        }
      }
    } else {
      for (const op of entry.ops || []) {
        const attempts = candidateAttemptsForOp(batch, entry, op);
        let opApplied = false;
        let lastReason = 'originalText not found';

        for (const attempt of attempts) {
          try {
            const body = await readRelativeFile(attempt.file);
            const replaced = replaceTextInSource(body, {
              originalText: op.originalText,
              newText: op.newText,
              line: attempt.line,
              contextHints: contextHintsForEntry(entry),
              keyRenames,
            });
            if (!replaced.ok) {
              if (allowAlreadyApplied && sourceAlreadyShowsAppliedOp(body, attempt, op)) {
                filesTouched.add(attempt.file);
                opApplied = true;
                break;
              }
              lastReason = replaced.reason;
              continue;
            }
            fileCache.set(attempt.file, replaced.body);
            filesTouched.add(attempt.file);
            opApplied = true;
            break;
          } catch (err) {
            lastReason = err.message;
          }
        }

        if (!opApplied) {
          entryFailed = { reason: lastReason, candidates: candidatesForEntry(batch, entry.id) };
          break;
        }
      }
    }

    if (entryFailed) {
      fileCache.clear();
      for (const [file, body] of beforeEntry) fileCache.set(file, body);
      filesTouched.clear();
      for (const file of beforeTouched) filesTouched.add(file);
      failed.push({ entryId: entry.id, ...entryFailed });
    } else {
      await applyCoupledSourceKeyRenamesForEntry({
        batch,
        entry,
        keyRenames,
        readRelativeFile,
        fileCache,
        filesTouched,
      });
      appliedEntryIds.push(entry.id);
    }
  }

  for (const file of filesTouched) {
    await fs.writeFile(safeProjectPath(tmp, file), fileCache.get(file), 'utf-8');
  }

  const status = failed.length === 0 ? 'done' : (appliedEntryIds.length > 0 ? 'partial' : 'error');
  return {
    status,
    appliedEntryIds,
    failed,
    files: [...filesTouched],
    notes: [],
  };
}

export async function loadManualEditEventBatch(event, { tmp } = {}) {
  if (!event?.evidencePath) return event?.batch;
  const evidencePath = await resolveManualEditEvidencePath(event.evidencePath, tmp);
  const body = await fs.readFile(evidencePath, 'utf-8');
  const batch = JSON.parse(body);
  return batch && typeof batch === 'object' && Array.isArray(batch.entries) ? batch : event.batch;
}

async function resolveManualEditEvidencePath(evidencePath, root) {
  if (!evidencePath || typeof evidencePath !== 'string') throw new Error('invalid manual edit evidence path');
  const base = root ? path.resolve(root) : process.cwd();
  const full = path.isAbsolute(evidencePath) ? evidencePath : path.resolve(base, evidencePath);
  const [realBase, realFull] = await Promise.all([
    fs.realpath(base).catch(() => base),
    fs.realpath(full).catch(() => full),
  ]);
  const rel = path.relative(realBase, realFull);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('manual edit evidence path outside fixture project');
  }
  return full;
}

function safeProjectPath(root, relativeFile) {
  const normalized = normalizeRelativeSourceFile(relativeFile);
  if (!normalized) throw new Error('invalid source file path');
  const full = path.resolve(root, normalized);
  const rel = path.relative(path.resolve(root), full);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('source file outside fixture project');
  }
  return full;
}

function normalizeRelativeSourceFile(file) {
  if (!file || typeof file !== 'string') return null;
  if (path.isAbsolute(file)) return null;
  const normalized = path.normalize(file).replace(/\\/g, '/');
  if (!normalized || normalized === '.' || normalized.startsWith('../')) return null;
  return normalized;
}

function candidateAttemptsForOp(batch, entry, op) {
  const attempts = [];
  const seen = new Set();
  const numericDisplayEdit = /^-?\d+(?:\.\d+)?$/.test(String(op?.originalText || '').trim())
    && !/^-?\d+(?:\.\d+)?$/.test(String(op?.newText || '').trim());
  const add = (file, line, kind) => {
    const relativeFile = normalizeRelativeSourceFile(file);
    if (!relativeFile) return;
    const key = `${relativeFile}:${line || ''}:${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    attempts.push({ file: relativeFile, line, kind });
  };

  const opCandidates = (batch?.candidates || [])
    .filter((candidate) => candidate.entryId === entry.id && (!candidate.ref || candidate.ref === op.ref));
  const relatedSiblingRefs = relatedSiblingRefsForOp(entry, op);
  const siblingCandidates = (batch?.candidates || [])
    .filter((candidate) => candidate.entryId === entry.id && candidate.ref && relatedSiblingRefs.has(candidate.ref));
  if (numericDisplayEdit) {
    for (const candidate of [...opCandidates, ...siblingCandidates]) {
      for (const match of candidate.objectKeyMatches || []) add(match.file, match.line, 'object_key_match');
    }
  }

  add(op?.sourceHint?.file, op?.sourceHint?.line, 'source_hint');

  for (const candidate of opCandidates) {
    const sourceHint = candidate.sourceHint;
    if (sourceHint?.status === 'ok') add(sourceHint.relativeFile || sourceHint.file, sourceHint.line, 'candidate_source_hint');
    for (const match of candidate.locatorMatches || []) add(match.file, match.line, 'locator_match');
    for (const match of candidate.textMatches || []) add(match.file, match.line, 'text_match');
    for (const match of candidate.objectKeyMatches || []) add(match.file, match.line, 'object_key_match');
    for (const match of candidate.contextTextMatches || []) add(match.file, match.line, 'context_text_match');
  }

  return attempts;
}

function replaceTextInSource(body, { originalText, newText, line, contextHints = [], keyRenames = [] }) {
  const original = String(originalText || '');
  if (!original) return { ok: false, reason: 'missing originalText' };

  const contextKeyValueMatch = replaceNumericValueForContextKey(body, {
    originalText: original,
    newText,
    contextHints,
  });
  if (contextKeyValueMatch.ok) return contextKeyValueMatch;

  if (Number.isFinite(Number(line)) && Number(line) > 0) {
    const typedDisplayMatch = replaceTypedNumericDisplayExpression(body, {
      originalText: original,
      newText,
      line: Number(line),
    });
    if (typedDisplayMatch.ok) return typedDisplayMatch;
    const lineMatch = replaceNearLine(body, original, String(newText), Number(line), keyRenames);
    if (lineMatch.ok) return lineMatch;
  }

  const numericDisplayEdit = isNumericDisplayEdit(original, newText);
  const matches = allIndexesOf(body, original)
    .filter((index) => !numericDisplayEdit || numericReplacementAllowedAt(body, index, original));
  if (matches.length === 0) return { ok: false, reason: 'originalText not found' };
  if (matches.length === 1) {
    return replaceAtIndexWithSourceRules(body, matches[0], original, String(newText));
  }

  const scored = matches.map((index) => ({
    index,
    score: scoreManualEditMatch(body, index, contextHints),
  })).sort((a, b) => b.score - a.score);
  if (scored[0].score > 0 && scored[0].score > scored[1].score) {
    return replaceAtIndexWithSourceRules(body, scored[0].index, original, String(newText));
  }
  return { ok: false, reason: 'originalText ambiguous' };
}

function replaceNumericValueForContextKey(body, { originalText, newText, contextHints = [] }) {
  const original = String(originalText || '').trim();
  const next = String(newText || '').trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(original) || !next || /^-?\d+(?:\.\d+)?$/.test(next)) {
    return { ok: false, reason: 'not a context-key numeric display edit' };
  }
  const context = contextHints.join(' ');
  if (!context) return { ok: false, reason: 'missing context for keyed numeric edit' };
  const lines = String(body || '').split('\n');
  const valuePattern = new RegExp(`(['"])([^'"]{2,160})\\1\\s*:\\s*${escapeRegExp(original)}(?=\\s*[,}])`);
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(valuePattern);
    if (!match || !context.includes(match[2])) continue;
    lines[index] = lines[index].slice(0, match.index)
      + match[0].replace(new RegExp(`${escapeRegExp(original)}$`), JSON.stringify(next))
      + lines[index].slice(match.index + match[0].length);
    return { ok: true, body: lines.join('\n') };
  }
  return { ok: false, reason: 'no related keyed numeric value found' };
}

function replaceTypedNumericDisplayExpression(body, { originalText, newText, line }) {
  const original = String(originalText || '').trim();
  const displayText = String(newText || '');
  const displayTrimmed = displayText.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(original)) return { ok: false, reason: 'not a numeric display edit' };
  if (!displayTrimmed || /^-?\d+(?:\.\d+)?$/.test(displayTrimmed)) {
    return { ok: false, reason: 'not a typed display expansion' };
  }

  const lines = body.split('\n');
  const lineIndex = Math.max(0, Math.min(lines.length - 1, Number(line) - 1));
  const candidateIndexes = [lineIndex];
  for (let i = 0; i < lines.length; i++) {
    if (i !== lineIndex && /String\([^)]+\)/.test(lines[i])) candidateIndexes.push(i);
  }

  for (const index of candidateIndexes) {
    const lineText = lines[index] || '';
    const stringCall = lineText.match(/String\(([^)\n]+)\)/);
    if (stringCall) {
      const replacement = JSON.stringify(displayTrimmed);
      lines[index] = lineText.slice(0, stringCall.index) + replacement + lineText.slice(stringCall.index + stringCall[0].length);
      return { ok: true, body: lines.join('\n') };
    }

    const bareExpression = lineText.match(/\{[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[['"][^'"]+['"]\])*\}/);
    if (bareExpression) {
      const replacement = `{${JSON.stringify(displayTrimmed)}}`;
      lines[index] = lineText.slice(0, bareExpression.index) + replacement + lineText.slice(bareExpression.index + bareExpression[0].length);
      return { ok: true, body: lines.join('\n') };
    }
  }

  return { ok: false, reason: 'no typed display expression near sourceHint' };
}

function replaceNearLine(body, originalText, newText, line, keyRenames = []) {
  const lines = body.split('\n');
  const lineIndex = Math.max(0, Math.min(lines.length - 1, Number(line) - 1));
  const indexes = [];
  for (let distance = 0; distance <= 3; distance += 1) {
    for (const i of distance === 0 ? [lineIndex] : [lineIndex - distance, lineIndex + distance]) {
      if (i >= 0 && i < lines.length && !indexes.includes(i)) indexes.push(i);
    }
  }
  for (const i of indexes) {
    const idx = lines[i].indexOf(originalText);
    if (idx === -1) continue;
    if (isNumericDisplayEdit(originalText, newText) && !numericReplacementAllowedOnLine(lines[i], idx, originalText)) continue;
    const replacement = sourceReplacementForLine(lines[i], originalText, newText);
    lines[i] = lines[i].slice(0, idx) + replacement + lines[i].slice(idx + originalText.length);
    lines[i] = applyCoupledSourceKeyRenames(lines[i], keyRenames);
    return { ok: true, body: lines.join('\n') };
  }
  return { ok: false, reason: 'originalText not found near sourceHint' };
}

function sourceAlreadyShowsAppliedOp(body, attempt, op) {
  const newText = typeof op?.newText === 'string' ? op.newText : '';
  const originalText = typeof op?.originalText === 'string' ? op.originalText : '';
  const lines = String(body || '').split('\n');
  const lineNumber = Number(attempt?.line);
  if (Number.isFinite(lineNumber) && lineNumber > 0) {
    const lineIndex = Math.max(0, Math.min(lines.length - 1, lineNumber - 1));
    const start = Math.max(0, lineIndex - 3);
    const end = Math.min(lines.length, lineIndex + 4);
    const windowLines = lines.slice(start, end);
    if (newText) return windowLines.some((line) => line.includes(newText));
    if (originalText) return windowLines.every((line) => !line.includes(originalText));
  }
  if (newText) return String(body || '').includes(newText);
  if (originalText) return !String(body || '').includes(originalText);
  return false;
}

function sourceKeyRenamesForEntry(entry) {
  return (entry?.ops || [])
    .filter((op) =>
      typeof op.originalText === 'string'
      && typeof op.newText === 'string'
      && op.originalText.trim()
      && op.newText.trim()
      && op.originalText !== op.newText
      && op.originalText.length <= 120
      && op.newText.length <= 120
      && !/^-?\d+(?:\.\d+)?$/.test(op.originalText.trim())
    )
    .map((op) => ({ from: op.originalText, to: op.newText }));
}

function isNumericDisplayEdit(originalText, newText) {
  const original = String(originalText || '').trim();
  const next = String(newText || '').trim();
  return /^-?\d+(?:\.\d+)?$/.test(original) && !!next && !/^-?\d+(?:\.\d+)?$/.test(next);
}

function numericReplacementAllowedAt(body, index, originalText) {
  const source = String(body || '');
  const lineStart = source.lastIndexOf('\n', index) + 1;
  const lineEndIndex = source.indexOf('\n', index);
  const lineEnd = lineEndIndex === -1 ? source.length : lineEndIndex;
  return numericReplacementAllowedOnLine(
    source.slice(lineStart, lineEnd),
    index - lineStart,
    originalText,
  );
}

function numericReplacementAllowedOnLine(line, index, originalText) {
  if (isInsideQuotedString(line, index)) return false;
  const before = index > 0 ? line[index - 1] : '';
  const after = line[index + String(originalText || '').length] || '';
  if (/[A-Za-z0-9_$.-]/.test(before) || /[A-Za-z0-9_$.-]/.test(after)) return false;
  return true;
}

function isInsideQuotedString(line, index) {
  let quote = null;
  let escaped = false;
  for (let i = 0; i < index; i += 1) {
    const ch = line[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
  }
  return !!quote;
}

function sourceReplacementForLine(line, originalText, newText) {
  const original = escapeRegExp(String(originalText || ''));
  const isPlainNumber = /^-?\d+(?:\.\d+)?$/.test(String(originalText || '').trim());
  const next = String(newText || '');
  const nextIsPlainNumber = /^-?\d+(?:\.\d+)?$/.test(next.trim());
  if (isPlainNumber && !nextIsPlainNumber) {
    const valuePattern = new RegExp(`(['\"][^'\"]+['\"]\\s*:\\s*)${original}(\\s*[,}])`);
    if (valuePattern.test(line)) return JSON.stringify(next);
  }
  return next;
}

function applyCoupledSourceKeyRenames(line, keyRenames) {
  let out = line;
  for (const { from, to } of keyRenames || []) {
    const escaped = escapeRegExp(from);
    out = out.replace(new RegExp(`'${escaped}'(?=\\s*:)`), `'${to.replace(/'/g, "\\'")}'`);
    out = out.replace(new RegExp(`"${escaped}"(?=\\s*:)`), `"${to.replace(/"/g, '\\"')}"`);
  }
  return out;
}

async function applyCoupledSourceKeyRenamesForEntry({
  batch,
  entry,
  keyRenames,
  readRelativeFile,
  fileCache,
  filesTouched,
}) {
  if (!Array.isArray(keyRenames) || keyRenames.length === 0) return;
  const files = new Set(filesTouched);
  for (const candidate of batch?.candidates || []) {
    if (candidate.entryId !== entry.id) continue;
    for (const match of candidate.objectKeyMatches || []) {
      const relativeFile = normalizeRelativeSourceFile(match.file);
      if (relativeFile) files.add(relativeFile);
    }
  }
  for (const file of files) {
    let body;
    try {
      body = await readRelativeFile(file);
    } catch {
      continue;
    }
    const lines = body.split('\n');
    let changed = false;
    for (let index = 0; index < lines.length; index += 1) {
      const next = applyCoupledSourceKeyRenames(lines[index], keyRenames);
      if (next === lines[index]) continue;
      lines[index] = next;
      changed = true;
    }
    if (!changed) continue;
    fileCache.set(file, lines.join('\n'));
    filesTouched.add(file);
  }
}

function replaceAtIndex(body, index, originalText, newText) {
  return {
    ok: true,
    body: body.slice(0, index) + newText + body.slice(index + originalText.length),
  };
}

function replaceAtIndexWithSourceRules(body, index, originalText, newText) {
  const source = String(body || '');
  const lineStart = source.lastIndexOf('\n', index) + 1;
  const lineEndIndex = source.indexOf('\n', index);
  const lineEnd = lineEndIndex === -1 ? source.length : lineEndIndex;
  const line = source.slice(lineStart, lineEnd);
  const replacement = sourceReplacementForLine(line, originalText, newText);
  return replaceAtIndex(source, index, originalText, replacement);
}

function allIndexesOf(body, needle) {
  const out = [];
  let index = 0;
  while (true) {
    index = body.indexOf(needle, index);
    if (index === -1) return out;
    out.push(index);
    index += Math.max(1, needle.length);
  }
}

function scoreManualEditMatch(body, index, contextHints) {
  const windowText = body.slice(Math.max(0, index - 600), index + 600);
  let score = 0;
  for (const hint of contextHints) {
    if (hint && windowText.includes(hint)) score++;
  }
  return score;
}

function contextHintsForEntry(entry) {
  const hints = [];
  const add = (value) => {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text.length >= 2 && text.length <= 180) hints.push(text);
  };
  for (const op of entry?.ops || []) {
    for (const nearby of op.nearbyEditableTexts || []) add(typeof nearby === 'string' ? nearby : nearby?.text);
    add(op.container?.textContent);
    add(op.leaf?.textContent);
  }
  add(entry?.element?.textContent);
  return [...new Set(hints)];
}

function relatedSiblingRefsForOp(entry, op) {
  const context = contextHintsForSingleOp(op).join(' ');
  if (!context) return new Set();
  return new Set((entry?.ops || [])
    .filter((sibling) => sibling.ref !== op.ref)
    .filter((sibling) => {
      const original = String(sibling.originalText || '').trim();
      const next = String(sibling.newText || '').trim();
      return (original && context.includes(original)) || (next && context.includes(next));
    })
    .map((sibling) => sibling.ref)
    .filter(Boolean));
}

function contextHintsForSingleOp(op) {
  const hints = [];
  const add = (value) => {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text.length >= 2 && text.length <= 240) hints.push(text);
  };
  for (const nearby of op?.nearbyEditableTexts || []) add(typeof nearby === 'string' ? nearby : nearby?.text);
  add(op?.container?.textContent);
  add(op?.leaf?.textContent);
  return [...new Set(hints)];
}

function candidatesForEntry(batch, entryId) {
  const out = [];
  for (const candidate of batch?.candidates || []) {
    if (candidate.entryId !== entryId) continue;
    if (candidate.sourceHint?.relativeFile) {
      out.push({ file: candidate.sourceHint.relativeFile, line: candidate.sourceHint.line, kind: 'candidate_source_hint' });
    }
    for (const key of ['textMatches', 'objectKeyMatches', 'locatorMatches', 'contextTextMatches']) {
      for (const match of candidate[key] || []) {
        out.push({ file: match.file, line: match.line, kind: match.kind || key });
      }
    }
  }
  return out.slice(0, 20);
}

function renderMissingBaseVariantRules({ scopedCss, count, styleMode }) {
  const rules = [];
  for (let i = 1; i <= count; i++) {
    if (!hasBaseVariantRule(scopedCss, i, styleMode)) {
      rules.push(renderBaseVariantRule(i, styleMode));
    }
  }
  return rules;
}

function hasBaseVariantRule(scopedCss, variantId, styleMode) {
  const q = String.raw`["']${variantId}["']`;
  if (styleMode === 'astro-global-prefixed') {
    return new RegExp(String.raw`\[data-impeccable-variant=${q}\](?:\s|>|\.|#|\[${HOIST_ATTR}=)`).test(scopedCss);
  }
  return new RegExp(String.raw`@scope\s*\(\s*\[data-impeccable-variant=${q}\]\s*\)`).test(scopedCss);
}

function renderBaseVariantRule(variantId, styleMode) {
  if (styleMode === 'astro-global-prefixed') {
    return [
      `[data-impeccable-variant="${variantId}"] > * {`,
      '  --impeccable-variant-ready: 1;',
      '}',
    ].join('\n');
  }
  return [
    `@scope ([data-impeccable-variant="${variantId}"]) {`,
    '  :scope > * { --impeccable-variant-ready: 1; }',
    '}',
  ].join('\n');
}

// Walk each opening tag char-by-char (respecting quotes so a literal `>`
// inside an attribute value doesn't terminate the tag early), strip any
// `style="..."`, and tag the element with `data-impeccable-hoist-id="N"`.
// The downstream rule selects on that attribute so it targets the exact
// element that was styled — never sibling tags of the same name.
function stripInlineStylesPerElement(innerHtml) {
  const groups = [];
  const styleRe = /\sstyle=(["'])([\s\S]*?)\1/;
  let counter = 0;
  let result = '';
  let i = 0;

  while (i < innerHtml.length) {
    const lt = innerHtml.indexOf('<', i);
    if (lt === -1) {
      result += innerHtml.slice(i);
      break;
    }
    result += innerHtml.slice(i, lt);

    const tagMatch = innerHtml.slice(lt + 1).match(/^([A-Za-z][\w:-]*)/);
    if (!tagMatch) {
      // </tag>, comments, text content — copy `<` and continue.
      result += '<';
      i = lt + 1;
      continue;
    }
    const tagName = tagMatch[1];

    let j = lt + 1 + tagName.length;
    let quote = null;
    while (j < innerHtml.length) {
      const ch = innerHtml[j];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '>') {
        break;
      }
      j++;
    }
    if (j >= innerHtml.length) {
      // Unterminated tag (malformed input): copy verbatim and stop.
      result += innerHtml.slice(lt);
      break;
    }

    const attrs = innerHtml.slice(lt + 1 + tagName.length, j);
    const styleMatch = attrs.match(styleRe);
    if (!styleMatch) {
      result += innerHtml.slice(lt, j + 1);
      i = j + 1;
      continue;
    }
    const entries = parseInlineStyle(styleMatch[2]);
    const strippedAttrs = attrs.replace(styleRe, '');
    if (entries.length === 0) {
      result += `<${tagName}${strippedAttrs}>`;
      i = j + 1;
      continue;
    }
    counter++;
    const hoistId = String(counter);
    groups.push({ hoistId, declarations: entries });
    result += `<${tagName} ${HOIST_ATTR}="${hoistId}"${strippedAttrs}>`;
    i = j + 1;
  }
  return { innerHtml: result, groups };
}

function renderHoistedInlineStyleRule({ variantId, hoistId, declarations, styleMode }) {
  // Select on the per-element hoist attribute, not the tag name, so two
  // <span>s in the same variant where only one had an inline style cannot
  // both pick up the hoisted declarations.
  const lines = declarations.map(({ prop, value }) => `    ${prop}: ${value};`);
  const target = `[${HOIST_ATTR}="${hoistId}"]`;
  if (styleMode === 'astro-global-prefixed') {
    return [
      `[data-impeccable-variant="${variantId}"] ${target} {`,
      ...lines.map((line) => line.slice(2)),
      '}',
    ].join('\n');
  }
  return [
    `@scope ([data-impeccable-variant="${variantId}"]) {`,
    `  :scope ${target} {`,
    ...lines,
    '  }',
    '}',
  ].join('\n');
}

/**
 * Render the variants block in either HTML or JSX, depending on commentSyntax.
 * In JSX:
 *   - comments use {/​* ... *​/} (already what commentSyntax.open is)
 *   - <style>{`@scope ... { ... }`}</style> wraps CSS in a template literal so JSX
 *     doesn't choke on the {} in CSS
 *   - non-default visible variants use style={{display: 'none'}}
 *   - inner element class= becomes className=, style="..." becomes JSX style={{ ... }}
 *   - data-impeccable-params stays a single-quoted JSON string (JSX-legal)
 */
function renderVariantsBlock({ sessionId, indent, output, commentSyntax, file, styleMode }) {
  const isJsx = commentSyntax.open === '{/*';
  const isSvelte = !!file && file.endsWith('.svelte');
  const isAstroGlobalCss = styleMode === 'astro-global-prefixed';

  const styleLines = isJsx
    ? [
        indent + '  <style data-impeccable-css="' + sessionId + '">{`',
        ...output.scopedCss.split('\n').map((l) => indent + '    ' + l),
        indent + '  `}</style>',
      ]
    : [
        indent + '  <style' + (isAstroGlobalCss ? ' is:inline' : '') + ' data-impeccable-css="' + sessionId + '">',
        ...output.scopedCss.split('\n').map((l) => indent + '    ' + l),
        indent + '  </style>',
      ];

  const variantBlocks = output.variants.map((v, i) => {
    const idx = i + 1;
    const paramsAttr = v.params && v.params.length
      ? " data-impeccable-params='" + attrEscape(JSON.stringify(v.params), { svelte: isSvelte }) + "'"
      : '';
    let styleAttr = '';
    if (i !== 0) styleAttr = isJsx ? " style={{display: 'none'}}" : ' style="display: none"';
    const inner = isJsx ? htmlToJsx(v.innerHtml) : v.innerHtml;
    return [
      indent + '  ' + commentSyntax.open + ' Variant ' + idx + ' ' + commentSyntax.close,
      indent + '  <div data-impeccable-variant="' + idx + '"' + styleAttr + paramsAttr + '>',
      indent + '    ' + inner,
      indent + '  </div>',
    ].join('\n');
  });

  return [...styleLines, ...variantBlocks].join('\n');
}

/**
 * Read the wrapped file, find the "insert below this line" marker, splice in
 * the rendered variants block, write back.
 */
async function spliceVariantsIntoWrapper({ tmp, wrapInfo, sessionId, output }) {
  const filePath = path.join(tmp, wrapInfo.file);
  const src = await fs.readFile(filePath, 'utf-8');
  const lines = src.split('\n');

  // Find the "Variants: insert below this line" comment line — definitive
  // marker, robust to any indentation off-by-one. Matches in any comment
  // style (HTML / JSX / Astro).
  const markerIdx = lines.findIndex((l) =>
    l.includes('Variants: insert below this line'),
  );
  if (markerIdx === -1) {
    throw new Error('insert marker not found in ' + wrapInfo.file);
  }

  const indent = (lines[markerIdx].match(/^\s*/) || [''])[0];
  // Indent INSIDE the wrapper is one level shallower (the marker is indented
  // 2 spaces relative to the wrapper opening). Remove the 2-space comment
  // indent to get the wrapper indent.
  const wrapperIndent = indent.replace(/  $/, '');

  const block = renderVariantsBlock({
    sessionId,
    indent: wrapperIndent,
    output,
    commentSyntax: wrapInfo.commentSyntax,
    file: wrapInfo.file,
    styleMode: wrapInfo.styleMode,
  });

  const endMarkerIdx = lines.findIndex((line, index) =>
    index > markerIdx && line.includes('impeccable-variants-end ' + sessionId),
  );
  if (endMarkerIdx === -1) {
    throw new Error('end marker not found in ' + wrapInfo.file);
  }
  const tailIdx = wrapInfo.commentSyntax.open === '{/*'
    ? endMarkerIdx
    : endMarkerIdx - 1;

  const next = [
    ...lines.slice(0, markerIdx + 1),
    block,
    ...lines.slice(tailIdx),
  ];
  await fs.writeFile(filePath, next.join('\n'), 'utf-8');
}

async function writeSvelteComponentVariants({ tmp, wrapInfo, event, output, writeParams = true }) {
  const manifestPath = path.join(tmp, wrapInfo.file);
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
  const componentDir = path.join(tmp, manifest.componentDir);
  const isInsert = manifest.mode === 'insert';
  const contract = Array.isArray(manifest.propContract) ? manifest.propContract : [];
  const propNames = contract.map((entry) => entry.prop);
  const baseMarkup = isInsert ? '' : substituteSvelteExprsWithProps(manifest.originalMarkup || '', contract).trim();
  const textValues = isInsert ? [] : extractTextPieces(event.element?.outerHTML || event.element?.textContent || '');
  const paramsByVariant = {};

  for (let i = 0; i < output.variants.length; i++) {
    const variantId = i + 1;
    const variant = output.variants[i];
    const tag = firstTagName(variant.innerHtml) || firstTagName(baseMarkup) || 'div';
    let markup = substituteLiveTextWithProps(variant.innerHtml || '', contract, textValues).trim();
    if (!isInsert && contract.length > 0 && !propNames.some((name) => markup.includes(`{${name}}`))) {
      markup = mergeTopLevelAttrs(baseMarkup, variant.innerHtml || '') || baseMarkup;
    }
    if (isInsert && !variantMarkupHasVisibleContent(markup)) {
      throw new Error(`Svelte insert variant ${variantId} has no visible content`);
    }
    if (isInsert && /\bdata-impeccable-[\w-]*\s*=/.test(markup)) {
      throw new Error(`Svelte insert variant ${variantId} contains preview-only data-impeccable attributes`);
    }
    const css = svelteCssForVariant(output.scopedCss || '', variantId, tag);
    const component = [
      buildSveltePropsScript(contract),
      '',
      markup || baseMarkup || '<div></div>',
      '',
      '<style>',
      css || '  :global(*) {}',
      '</style>',
      '',
    ].join('\n');
    await fs.writeFile(path.join(componentDir, `v${variantId}.svelte`), component, 'utf-8');
    paramsByVariant[String(variantId)] = Array.isArray(variant.params) ? variant.params : [];
  }

  if (writeParams) {
    await fs.writeFile(path.join(componentDir, 'params.json'), JSON.stringify(paramsByVariant, null, 2) + '\n', 'utf-8');
  }
  manifest.arrivedVariants = output.variants.length;
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
}

function variantMarkupHasVisibleContent(markup) {
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

function buildSveltePropsScript(contract) {
  if (!contract.length) return '<script>\n  let {} = $props();\n</script>';
  return `<script>\n  let { ${contract.map((entry) => entry.prop).join(', ')} } = $props();\n</script>`;
}

function substituteSvelteExprsWithProps(markup, contract) {
  let out = String(markup || '');
  for (const entry of contract) {
    out = out.split(`{${entry.expr}}`).join(`{${entry.prop}}`);
  }
  return out;
}

function substituteLiveTextWithProps(markup, contract, textValues) {
  let out = String(markup || '');
  for (let i = 0; i < contract.length; i++) {
    const value = textValues[i];
    if (!value) continue;
    out = out.split(htmlEscape(value)).join(`{${contract[i].prop}}`);
    out = out.split(value).join(`{${contract[i].prop}}`);
  }
  return out;
}

function extractTextPieces(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .split(/<[^>]+>/)
    .map((text) => text.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function firstTagName(markup) {
  const match = String(markup || '').match(/<([A-Za-z][\w:-]*)\b/);
  return match ? match[1].toLowerCase() : null;
}

function mergeTopLevelAttrs(baseMarkup, variantMarkup) {
  const base = String(baseMarkup || '');
  const variant = String(variantMarkup || '');
  const baseOpen = base.match(/^(\s*<)([A-Za-z][\w:-]*)([^>]*)(>)/);
  const variantOpen = variant.match(/^\s*<([A-Za-z][\w:-]*)([^>]*)(>)/);
  if (!baseOpen || !variantOpen || baseOpen[2].toLowerCase() !== variantOpen[1].toLowerCase()) return base;
  return base.replace(baseOpen[0], `${baseOpen[1]}${baseOpen[2]}${variantOpen[2]}${baseOpen[4]}`);
}

function svelteCssForVariant(scopedCss, variantId, tag) {
  const css = String(scopedCss || '');
  const chunks = extractVariantCssChunks(css, variantId);
  const rewritten = chunks
    .join('\n')
    .replace(new RegExp(String.raw`\\[data-impeccable-variant=["']${variantId}["']\\]\\s*>\\s*`, 'g'), '')
    .replace(new RegExp(String.raw`\\[data-impeccable-variant=["']${variantId}["']\\][^{]*>\\s*`, 'g'), '')
    .replace(/:scope(?:\[[^\]]+\])?\s*>\s*/g, '')
    .replace(/:scope(?:\[[^\]]+\])?/g, tag)
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim())
    .join('\n')
    .trim();
  return rewritten || `${tag} {}`;
}

function extractVariantCssChunks(css, variantId) {
  const lines = String(css || '').split('\n');
  const chunks = [];
  let collecting = false;
  let depth = 0;
  for (const line of lines) {
    if (line.includes(`[data-impeccable-variant="${variantId}"]`) || line.includes(`[data-impeccable-variant='${variantId}']`)) {
      collecting = true;
      depth = 0;
      if (!line.trim().startsWith('@scope')) chunks.push(line);
      depth += braceDelta(line);
      if (depth <= 0) collecting = false;
      continue;
    }
    if (!collecting) continue;
    const before = depth;
    depth += braceDelta(line);
    if (before === 1 && depth === 0 && line.trim() === '}') {
      collecting = false;
      continue;
    }
    chunks.push(line);
    if (depth <= 0) collecting = false;
  }
  return chunks;
}

function braceDelta(line) {
  return (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
}

// ---------------------------------------------------------------------------
// Poll loop — the "agent" runs this until aborted
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {string} opts.tmp        Project tmp dir (cwd for live-* scripts).
 * @param {string} opts.scriptsDir Path to the impeccable scripts dir.
 * @param {number} opts.port       live-server port.
 * @param {string} opts.token      live-server token.
 * @param {LiveAgent} opts.agent
 * @param {AbortSignal} opts.signal
 * @param {(msg: string) => void} [opts.log]
 * @param {object} [opts.steerSourceFile]  Optional relative source path for steer edits.
 * @param {object} [opts.steerTarget]      Optional { classes, tag } for steer target discovery.
 */
export async function runAgentLoop({
  tmp,
  scriptsDir,
  port,
  token,
  agent,
  signal,
  log = () => {},
  trace = () => {},
  atomicDelayMs = 0,
  wrapTarget = { classes: 'hero-title', tag: 'h1' },
  steerSourceFile,
  steerTarget,
}) {
  const base = `http://127.0.0.1:${port}`;

  while (!signal.aborted) {
    let event;
    try {
      const res = await fetch(`${base}/poll?token=${token}&timeout=5000`, { signal });
      event = await res.json();
    } catch (err) {
      if (signal.aborted) return;
      log('poll error: ' + err.message);
      await new Promise((r) => setTimeout(r, 200));
      continue;
    }

    if (event.type === 'timeout') continue;
    if (event.type === 'exit') return;
    if (event.type === 'prefetch') continue;
    if (event.type === 'connected') continue;

    trace('agent.event.received', { id: event.id, type: event.type, clientSentAt: event.clientSentAt ?? null });

    if (event.type === 'steer') {
      log(`steer id=${event.id} message=${JSON.stringify(event.message)}`);
      try {
        const target = typeof wrapTarget === 'function' ? wrapTarget(event) : wrapTarget;
        const steerCtxTarget = steerTarget || target;
        const steerContext = buildSteerContext({
          tmp,
          event,
          wrapTarget: steerCtxTarget,
          sourceFile: steerSourceFile,
        });
        let toast = 'Hero marked';
        if (typeof agent.handleSteer === 'function') {
          const result = await agent.handleSteer(event, steerContext);
          toast = result?.message || toast;
        } else {
          await handleSteerDeterministic(steerContext);
        }
        await fetch(`${base}/poll`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token,
            type: 'steer_done',
            id: event.id,
            message: toast,
            file: steerContext.targetFile,
          }),
          signal,
        });
      } catch (err) {
        if (signal.aborted) return;
        log('steer failed: ' + err.message);
        await fetch(`${base}/poll`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, type: 'error', id: event.id, message: err.message }),
          signal,
        }).catch(() => {});
      }
      continue;
    }

    if (event.type === 'generate') {
      const isInsert = event.mode === 'insert';
      log(`generate id=${event.id} mode=${isInsert ? 'insert' : 'replace'}${isInsert ? '' : ` action=${event.action}`} count=${event.count}`);
      try {
        let wrapInfo;
        if (event.scaffold) {
          wrapInfo = event.scaffold;
          trace('agent.scaffold.reused', {
            id: event.id,
            file: wrapInfo.file,
            previewMode: wrapInfo.previewMode || 'source',
            durationMs: event.scaffoldDurationMs ?? null,
          });
        } else if (isInsert) {
          trace('agent.scaffold.start', { id: event.id, mode: 'insert' });
          const insertTarget = insertTargetFromEvent(event);
          wrapInfo = await runInsert({
            tmp,
            scriptsDir,
            id: event.id,
            count: event.count,
            ...insertTarget,
          });
          trace('agent.scaffold.end', { id: event.id, file: wrapInfo.file, previewMode: wrapInfo.previewMode || 'source' });
        } else {
          trace('agent.scaffold.start', { id: event.id, mode: 'replace' });
          // 1. Wrap the original element in the variant scaffold (deterministic CLI)
          // wrapTarget can be a static {classes, tag, elementId} (test fixtures
          // know what they pick) or a function (event) => target (real-use
          // sessions: the agent must derive the selector from the picked
          // element on the fly).
          const target = typeof wrapTarget === 'function' ? wrapTarget(event) : wrapTarget;
          // Pull textContent from the picker event so wrap can disambiguate
          // when sibling elements share classes/tag (issue #114). Fixtures can
          // still override by including `text` in their wrapTarget.
          const text = target.text ?? (event.element?.textContent || '').trim();
          wrapInfo = await runWrap({
            tmp,
            scriptsDir,
            id: event.id,
            count: event.count,
            ...target,
            text,
          });
          trace('agent.scaffold.end', { id: event.id, file: wrapInfo.file, previewMode: wrapInfo.previewMode || 'source' });
        }
        log(`scaffolded: ${wrapInfo.file} insertLine=${wrapInfo.insertLine}`);

        // 2. Agent generates variant content (LLM-pluggable seam).
        // Providers may expose a true split path so variant 1 is written before
        // the request for the remaining variants completes.
        trace('agent.generate.start', { id: event.id, count: event.count });
        let output = normalizeVariantOutput(
          await agent.generateVariants(event, { wrapTarget, wrapInfo }),
          wrapInfo,
        );
        if (atomicDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, atomicDelayMs));
        }
        trace('agent.generate.first_ready', { id: event.id, count: output?.variants?.length || 0 });
        trace('agent.generate.end', { id: event.id, count: output?.variants?.length || 0 });

        if (output.variants.length !== event.count) {
          log(`warning: agent returned ${output.variants.length} variants, expected ${event.count}`);
        }

        // 3. Write the complete set into the deterministic preview target.
        trace('agent.write.start', { id: event.id, file: wrapInfo.file });
        if (wrapInfo.previewMode === 'svelte-component') {
          await writeSvelteComponentVariants({ tmp, wrapInfo, event, output, writeParams: true });
        } else {
          await spliceVariantsIntoWrapper({ tmp, wrapInfo, sessionId: event.id, output });
        }
        trace('agent.write.end', { id: event.id, file: wrapInfo.file });
        if (process.env.IMPECCABLE_E2E_DEBUG) {
          const post = await fs.readFile(path.join(tmp, wrapInfo.file), 'utf-8');
          log(`--- post-splice (variants written) ---\n${post}`);
        }

        // 4. Tell the server we're done (broadcasts SSE done → browser settles to CYCLING)
        trace('agent.reply.start', { id: event.id });
        await fetch(`${base}/poll`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, type: 'done', sourceEventType: 'generate', id: event.id, file: wrapInfo.file }),
          signal,
        });
        trace('agent.reply.end', { id: event.id });
      } catch (err) {
        if (signal.aborted) return;
        if (isExpectedGenerationCancellation(err)) {
          trace('agent.generate.canceled', { id: event.id, reason: 'stale_generation_epoch' });
          log('generate canceled after Accept/Discard: ' + err.message);
          continue;
        }
        trace('agent.generate.error', { id: event.id, message: err.message });
        log('generate failed: ' + err.message);
        await fetch(`${base}/poll`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, type: 'error', sourceEventType: 'generate', id: event.id, message: err.message }),
          signal,
        }).catch(() => {});
      }
      continue;
    }

    if (event.type === 'manual_edit_apply') {
      const entryCount = event.batch?.entries?.length || 0;
      const opCount = (event.batch?.entries || []).reduce((sum, entry) => sum + (entry.ops?.length || 0), 0) || entryCount;
      const chunkLabel = event.chunk ? ` (chunk ${event.chunk.index}/${event.chunk.total})` : '';
      const applyFiles = formatManualApplyFiles(event.batch);
      log(`Applying ${opCount} staged copy edit(s)${chunkLabel} across ${applyFiles}.`);
      try {
        if (typeof agent.applyManualEdits !== 'function') {
          throw new Error('agent does not implement applyManualEdits');
        }
        log("Using source hints first; I'll only touch the hinted copy.");
        const result = await agent.applyManualEdits(event, { tmp, scriptsDir });
        if (process.env.IMPECCABLE_E2E_DEBUG) {
          log(`manual_edit_apply result: ${JSON.stringify(result)}`);
        }
        await runPollReply({
          tmp,
          scriptsDir,
          id: event.id,
          status: 'done',
          data: result,
        });
        const appliedCount = result.appliedEntryIds?.length || 0;
        const failedCount = result.failed?.length || Math.max(0, entryCount - appliedCount);
        if (failedCount > 0) {
          log(`Applied ${appliedCount}/${entryCount} edit(s); ${failedCount} stayed staged because ${result.failed?.[0]?.reason || 'one or more entries failed'}.`);
        } else if (event.chunk) {
          const finalChunk = event.chunk.index === event.chunk.total;
          log(`Applied ${appliedCount}/${entryCount} entry(s) for chunk ${event.chunk.index}/${event.chunk.total}; ${finalChunk ? 'waiting for server verification.' : 'polling for the next Apply chunk.'}`);
        } else {
          log(`Applied ${appliedCount}/${entryCount} edit(s) and cleared the Apply stash.`);
        }
      } catch (err) {
        if (signal.aborted) return;
        log('manual_edit_apply failed: ' + err.message);
        const failedEntries = (event.batch?.entries || []).map((entry) => ({
          entryId: entry.id,
          reason: err.message || 'manual_edit_apply_failed',
          candidates: [],
        })).filter((item) => item.entryId);
        await runPollReply({
          tmp,
          scriptsDir,
          id: event.id,
          status: 'done',
          data: {
            status: 'error',
            appliedEntryIds: [],
            failed: failedEntries,
            files: [],
            notes: [],
            message: err.message,
          },
        }).catch(() => {});
      }
      continue;
    }

    if (event.type === 'accept') {
      log(`accept id=${event.id} variantId=${event.variantId}`);
      try {
        const acceptResult = await runAccept({
          tmp,
          scriptsDir,
          id: event.id,
          variant: event.variantId,
          paramValues: event.paramValues,
          pageUrl: event.pageUrl,
        });

        // Carbonize cleanup — required after accept per the live skill spec.
        // For the fake agent, we perform a faithful but minimal cleanup:
        // delete the carbonize block (markers + dead variants + inline <style>
        // + param-values comment) and unwrap the temporary variant div around
        // the accepted content. A real LLM agent would additionally migrate
        // the @scope rules into the project's stylesheet — out of scope for
        // a deterministic test.
        if (acceptResult.handled === true && acceptResult.carbonize === true && acceptResult.file) {
          if (process.env.IMPECCABLE_E2E_DEBUG) {
            const post = await fs.readFile(path.join(tmp, acceptResult.file), 'utf-8');
            log(`--- post-accept (pre-carbonize) ---\n${post}`);
          }
          await runCarbonizeCleanup({ tmp, file: acceptResult.file, sessionId: event.id, variant: event.variantId });
          log(`carbonize cleanup done on ${acceptResult.file}`);
        }

        const completionType = completionTypeForAcceptResult('accept', acceptResult);
        await fetch(`${base}/poll`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token,
            type: completionType,
            sourceEventType: 'accept',
            id: event.id,
            file: acceptResult.file,
            message: acceptResult.error,
            data: acceptResult.carbonize === true ? { carbonize: true, _acceptResult: acceptResult } : { _acceptResult: acceptResult },
          }),
          signal,
        });
        if (completionType === 'agent_done' && acceptResult.handled === true && acceptResult.carbonize === true) {
          await runLiveComplete({ tmp, scriptsDir, id: event.id });
          log(`completed carbonize session ${event.id}`);
        }
      } catch (err) {
        if (signal.aborted) return;
        log('accept failed: ' + err.message);
      }
      continue;
    }

    if (event.type === 'discard') {
      log(`discard id=${event.id}`);
      try {
        const discardResult = await runAccept({ tmp, scriptsDir, id: event.id, discard: true, pageUrl: event.pageUrl });
        const completionType = completionTypeForAcceptResult('discard', discardResult);
        await fetch(`${base}/poll`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token,
            type: completionType,
            sourceEventType: 'discard',
            id: event.id,
            file: discardResult.file,
            message: discardResult.error,
            data: { _acceptResult: discardResult },
          }),
          signal,
        });
      } catch (err) {
        if (signal.aborted) return;
        log('discard failed: ' + err.message);
      }
      continue;
    }

    log(`unhandled event: ${event.type}`);
  }
}

export function isExpectedGenerationCancellation(error) {
  return /(?:^|\b)stale_generation_epoch(?:\b|$)/.test(String(error?.message || error || ''));
}

async function runPollReply({ tmp, scriptsDir, id, status, message, data }) {
  const args = [path.join(scriptsDir, 'live-poll.mjs'), '--reply', id, status];
  if (data !== undefined) args.push('--data', JSON.stringify(data));
  if (message) args.push(message);
  await execFileP(process.execPath, args, { cwd: tmp });
}

function formatManualApplyFiles(batch) {
  const files = new Set();
  for (const entry of batch?.entries || []) {
    for (const op of entry.ops || []) {
      if (op.sourceHint?.file) files.add(op.sourceHint.file);
    }
  }
  for (const candidate of batch?.candidates || []) {
    if (candidate.file) files.add(candidate.file);
  }
  return files.size > 0 ? [...files].slice(0, 3).join(', ') : 'source files';
}

const SOURCE_EXTS = new Set(['.html', '.jsx', '.tsx', '.svelte', '.astro', '.vue']);
const SOURCE_SKIP = new Set(['node_modules', '.git', '.svelte-kit', 'dist', '.vite', 'build', '.next']);

/**
 * Locate the source file the fake steer handler would edit (for assertions).
 * @param {string} tmp
 * @param {{ classes?: string, tag?: string }=} target
 */
export function findSteerTargetFile(tmp, target = { classes: 'hero-title', tag: 'h1' }) {
  const file = findSteerTargetFileSync(tmp, target);
  if (!file) {
    throw new Error('Could not locate steer target file under ' + tmp);
  }
  return file;
}

/**
 * Context passed to agent.handleSteer (fake + LLM).
 * @param {{ tmp: string, event: object, wrapTarget: object, sourceFile?: string }} opts
 */
export function buildSteerContext({ tmp, event, wrapTarget, sourceFile }) {
  const target = wrapTarget || { classes: 'hero-title', tag: 'h1' };
  const targetFileAbs = sourceFile
    ? path.join(tmp, sourceFile)
    : findSteerTargetFile(tmp, target);
  const targetFile = path.relative(tmp, targetFileAbs);
  const source = readFileSync(targetFileAbs, 'utf-8');
  const tag = target.tag || 'h1';
  const classToken = (target.classes || 'hero-title').split(/\s+/)[0];
  const tagLine = source.split('\n').find((line) =>
    new RegExp(`<${tag}\\b`, 'i').test(line) && line.includes(classToken),
  );
  return {
    tmp,
    target,
    targetFile,
    targetFileAbs,
    pageUrl: event.pageUrl,
    tagLine: tagLine || null,
    sourceExcerpt: source.split('\n').slice(0, 60).join('\n'),
    requiredMarker: `${STEER_MARKER_ATTR}="${STEER_MARKER_VALUE}"`,
  };
}

/**
 * Apply one or more exact find/replace edits inside the staged fixture tree.
 * @param {string} tmp
 * @param {{ file: string, edits: Array<{ find: string, replace: string }> }} payload
 */
export async function applySteerEdits(tmp, { file, edits }) {
  if (!file || typeof file !== 'string') throw new Error('steer edits: file required');
  if (!Array.isArray(edits) || edits.length === 0) throw new Error('steer edits: edits array required');
  const abs = path.isAbsolute(file) ? file : path.join(tmp, file);
  const root = path.resolve(tmp);
  if (!path.resolve(abs).startsWith(root + path.sep) && path.resolve(abs) !== root) {
    throw new Error('steer edits: path escapes fixture root');
  }
  let body = await fs.readFile(abs, 'utf-8');
  for (const [i, edit] of edits.entries()) {
    if (!edit || typeof edit.find !== 'string' || typeof edit.replace !== 'string') {
      throw new Error(`steer edits[${i}]: find and replace must be strings`);
    }
    if (!body.includes(edit.find)) {
      throw new Error(`steer edits[${i}]: find string not found in ${file}`);
    }
    body = body.replace(edit.find, edit.replace);
  }
  await fs.writeFile(abs, body, 'utf-8');
}

async function handleSteerDeterministic(context) {
  const { targetFileAbs, target } = context;
  let body = await fs.readFile(targetFileAbs, 'utf-8');
  const next = addSteerMarkerToSource(body, target);
  if (next === body) return;
  if (!next) {
    const { classes = 'hero-title', tag = 'h1' } = target;
    const classToken = classes.split(/\s+/)[0];
    throw new Error(`steer target <${tag}.${classToken}> not found in ${targetFileAbs}`);
  }
  body = next;
  await fs.writeFile(targetFileAbs, body, 'utf-8');
}

export function addSteerMarkerToSource(body, target = { classes: 'hero-title', tag: 'h1' }) {
  const attr = `${STEER_MARKER_ATTR}="${STEER_MARKER_VALUE}"`;
  if (body.includes(attr)) return body;

  const { classes = 'hero-title', tag = 'h1' } = target;
  const classToken = classes.split(/\s+/)[0];
  const escapedTag = escapeRegExp(tag);
  const escapedClass = escapeRegExp(classToken);
  const classValue = `(?:["'][^"']*\\b${escapedClass}\\b[^"']*["']|\\{[^}]*\\b${escapedClass}\\b[^}]*\\})`;
  const openTagRe = new RegExp(
    `(<${escapedTag}\\b(?=[^>]*\\b(?:className|class)\\s*=\\s*${classValue})[^>]*)(>)`,
    'i',
  );
  if (!openTagRe.test(body)) return null;
  return body.replace(openTagRe, `$1 ${attr}$2`);
}

function findSteerTargetFileSync(tmp, target) {
  const { classes = 'hero-title', tag = 'h1' } = target;
  const classNeedle = classes.split(/\s+/)[0];
  const stack = [tmp];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SOURCE_SKIP.has(entry.name)) stack.push(full);
        continue;
      }
      const ext = path.extname(entry.name);
      if (!SOURCE_EXTS.has(ext)) continue;
      let body;
      try { body = readFileSync(full, 'utf-8'); } catch { continue; }
      if (!body.includes(classNeedle)) continue;
      if (!new RegExp(`<${tag}\\b`, 'i').test(body)) continue;
      return full;
    }
  }
  return null;
}

async function runWrap({ tmp, scriptsDir, id, count, classes, tag, elementId, text, pageUrl }) {
  const args = [path.join(scriptsDir, 'live-wrap.mjs'), '--id', id, '--count', String(count)];
  if (elementId) args.push('--element-id', elementId);
  if (classes) args.push('--classes', classes);
  if (tag) args.push('--tag', tag);
  if (text) args.push('--text', text);
  if (pageUrl) args.push('--page-url', pageUrl);
  const { stdout } = await execFileP(process.execPath, args, { cwd: tmp });
  const last = stdout.trim().split('\n').filter(Boolean).pop();
  return JSON.parse(last);
}

async function runInsert({ tmp, scriptsDir, id, count, position, classes, tag, elementId, text }) {
  const args = [
    path.join(scriptsDir, 'live-insert.mjs'),
    '--id', id,
    '--count', String(count),
    '--position', position,
  ];
  if (elementId) args.push('--element-id', elementId);
  if (classes) args.push('--classes', classes);
  if (tag) args.push('--tag', tag);
  if (text) args.push('--text', text);
  const { stdout } = await execFileP(process.execPath, args, { cwd: tmp });
  const last = stdout.trim().split('\n').filter(Boolean).pop();
  return JSON.parse(last);
}

/**
 * Apply the post-accept carbonize cleanup to the given file. Mirrors the
 * five-step rewrite the live skill expects of the agent:
 *
 *   1. Locate the carbonize block (bracketed by `impeccable-carbonize-start`
 *      and `impeccable-carbonize-end`).
 *   2. Step 2 ("move CSS into the project stylesheet") is skipped — that
 *      requires per-project judgment about which file owns these styles.
 *      The fake agent leaves CSS migration to the LLM-backed agent.
 *   3-5. Strip the carbonize block entirely AND unwrap the temporary
 *      `<div data-impeccable-variant="N" style="display: contents"|...>` wrapper
 *      that holds the accepted content. The accepted inner element survives.
 */
async function runCarbonizeCleanup({ tmp, file, sessionId /* , variant */ }) {
  const filePath = path.join(tmp, file);
  let body = await fs.readFile(filePath, 'utf-8');

  // 1. Strip the carbonize block. We match either comment style so this
  // works for both HTML and JSX targets.
  const startRe = new RegExp('[ \\t]*(?:<!--|\\{/\\*)\\s*impeccable-carbonize-start\\s+' + sessionId + '\\s*(?:-->|\\*/\\})\\n');
  const endRe   = new RegExp('[ \\t]*(?:<!--|\\{/\\*)\\s*impeccable-carbonize-end\\s+' + sessionId + '\\s*(?:-->|\\*/\\})\\n?');
  const startMatch = body.match(startRe);
  const endMatch = body.match(endRe);
  if (startMatch && endMatch && startMatch.index < endMatch.index) {
    const startIdx = startMatch.index;
    const endIdx = endMatch.index + endMatch[0].length;
    body = body.slice(0, startIdx) + body.slice(endIdx);
  }

  // 2. Unwrap the temporary `<div data-impeccable-variant="N" ...>` placed
  // around the accepted content. For JSX targets, live-accept also adds an
  // outer `<div data-impeccable-carbonize>` so the carbonize block and accepted
  // node occupy one child slot; strip that shell after the accepted node is
  // clean.
  body = unwrapDivAttributeWrapper(body, 'data-impeccable-variant', { expandSingleLineContainer: true });
  body = unwrapDivAttributeWrapper(body, 'data-impeccable-carbonize');

  // 3. Strip any `data-impeccable-hoist-id` attributes the normalize step
  // may have injected when the model emitted inline styles. The hoisted
  // CSS already migrated into the project stylesheet (real agent) or was
  // dropped with the carbonize block (fake agent); the attribute on the
  // element is now dead weight.
  body = body.replace(/\s+data-impeccable-hoist-id="[^"]*"/g, '');

  await fs.writeFile(filePath, body, 'utf-8');
}

function unwrapDivAttributeWrapper(body, attrName, { expandSingleLineContainer = false } = {}) {
  const lines = String(body).split('\n');
  const attrRe = new RegExp(`\\b${escapeRegExp(attrName)}=`);

  for (let i = 0; i < lines.length; i++) {
    if (!/<div\b/.test(lines[i]) || !attrRe.test(lines[i])) continue;

    const indent = (lines[i].match(/^(\s*)/) || [''])[1];
    let depth = countDivDepthDelta(lines[i]);
    for (let j = i + 1; j < lines.length; j++) {
      depth += countDivDepthDelta(lines[j]);
      if (depth !== 0) continue;

      let replacement = reindentWrapperBody(lines.slice(i + 1, j), indent).join('\n');
      if (expandSingleLineContainer) {
        replacement = expandAcceptedVariantMarkup(replacement, indent);
      }
      lines.splice(i, j - i + 1, ...replacement.split('\n'));
      return lines.join('\n');
    }
  }

  return body;
}

function countDivDepthDelta(line) {
  return countMatches(line, /<div\b/g) - countMatches(line, /<\/div>/g);
}

function countMatches(value, re) {
  return [...String(value || '').matchAll(re)].length;
}

function reindentWrapperBody(lines, indent) {
  const firstContentLine = lines.find((line) => line.trim() !== '');
  const innerIndent = (firstContentLine?.match(/^(\s*)/) || [''])[1] || '';
  return lines.map((line) => {
    if (line.trim() === '') return '';
    if (innerIndent && line.startsWith(innerIndent)) return indent + line.slice(innerIndent.length);
    return indent + line.trimStart();
  });
}

function expandAcceptedVariantMarkup(source, indent) {
  const lines = source.split('\n');
  if (lines.length !== 1) return source;

  const leading = lines[0].match(/^\s*/)?.[0] || indent;
  const trimmed = lines[0].trim();
  const expanded = expandSingleLineContainer(trimmed, leading);
  return expanded || source;
}

function expandSingleLineContainer(html, indent) {
  const outer = html.match(/^<([A-Za-z][\w:-]*)([^>]*)>([\s\S]+)<\/\1>$/);
  if (!outer) return null;

  const [, tagName, attrs, inner] = outer;
  const children = splitTopLevelElements(inner.trim());
  if (children.length < 2) return null;

  return [
    `${indent}<${tagName}${attrs}>`,
    ...children.map((child) => `${indent}  ${child}`),
    `${indent}</${tagName}>`,
  ].join('\n');
}

function splitTopLevelElements(html) {
  const children = [];
  let index = 0;

  while (index < html.length) {
    while (/\s/.test(html[index] || '')) index++;
    if (index >= html.length) break;
    if (html[index] !== '<') return [];

    const open = html.slice(index).match(/^<([A-Za-z][\w:-]*)(?:\s[^>]*)?>/);
    if (!open) return [];

    const tagName = open[1];
    const tagRe = new RegExp(`</?${escapeRegExp(tagName)}(?=[\\s>/])[^>]*>`, 'g');
    tagRe.lastIndex = index;
    let depth = 0;
    let end = -1;
    let match;

    while ((match = tagRe.exec(html))) {
      const token = match[0];
      if (token.startsWith('</')) depth--;
      else if (!token.endsWith('/>')) depth++;
      if (depth === 0) {
        end = tagRe.lastIndex;
        break;
      }
    }

    if (end === -1) return [];
    children.push(html.slice(index, end).trim());
    index = end;
  }

  return children;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function runAccept({ tmp, scriptsDir, id, variant, discard, paramValues, pageUrl }) {
  const args = [path.join(scriptsDir, 'live-accept.mjs'), '--id', id];
  if (discard) args.push('--discard');
  else args.push('--variant', String(variant));
  if (paramValues) args.push('--param-values', JSON.stringify(paramValues));
  if (pageUrl) args.push('--page-url', pageUrl);
  const { stdout } = await execFileP(process.execPath, args, { cwd: tmp });
  const last = stdout.trim().split('\n').filter(Boolean).pop();
  return JSON.parse(last);
}

async function runLiveComplete({ tmp, scriptsDir, id }) {
  await execFileP(process.execPath, [path.join(scriptsDir, 'live-complete.mjs'), '--id', id], { cwd: tmp });
}
