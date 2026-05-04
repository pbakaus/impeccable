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
 * A future LLM-backed agent slots in by implementing the same VariantAgent
 * interface (one method, `generateVariants(event, context)`), so the loop and
 * harness stay unchanged.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

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
 * @typedef {Object} VariantAgent
 * @property {(event: object, context: object) => Promise<GenerateOutput>} generateVariants
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
    /** @type {VariantAgent['generateVariants']} */
    async generateVariants(event, context = {}) {
      const text = extractText(event.element?.outerHTML) || 'Title';
      const cls = 'hero-title';
      const useAstroGlobalCss = context.wrapInfo?.styleMode === 'astro-global-prefixed';

      // Variant 1 — red color, with a `range` param tuning hue lightness.
      const variant1 = {
        innerHtml: `<h1 class="${cls}">${text}</h1>`,
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
        innerHtml: `<h1 class="${cls}">${text}</h1>`,
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
        innerHtml: `<h1 class="${cls}">${text}</h1>`,
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
            '[data-impeccable-variant="1"] > h1 {',
            '  color: oklch(var(--p-lightness, 0.5) 0.25 25);',
            '}',
            '[data-impeccable-variant="2"] > h1 { font-weight: 900; }',
            '[data-impeccable-variant="2"][data-p-face="serif"] > h1 { font-family: ui-serif, serif; }',
            '[data-impeccable-variant="2"][data-p-face="mono"]  > h1 { font-family: ui-monospace, monospace; }',
            '[data-impeccable-variant="3"] > h1 { text-transform: uppercase; letter-spacing: 0.04em; }',
            '[data-impeccable-variant="3"][data-p-italic] > h1 { font-style: italic; }',
          ].join('\n')
        : [
            '@scope ([data-impeccable-variant="1"]) {',
            '  :scope > h1 {',
            '    color: oklch(var(--p-lightness, 0.5) 0.25 25);',
            '  }',
            '}',
            '@scope ([data-impeccable-variant="2"]) {',
            '  :scope > h1 { font-weight: 900; }',
            '  :scope[data-p-face="serif"] > h1 { font-family: ui-serif, serif; }',
            '  :scope[data-p-face="mono"]  > h1 { font-family: ui-monospace, monospace; }',
            '}',
            '@scope ([data-impeccable-variant="3"]) {',
            '  :scope > h1 { text-transform: uppercase; letter-spacing: 0.04em; }',
            '  :scope[data-p-italic] > h1 { font-style: italic; }',
            '}',
          ].join('\n');

      return {
        scopedCss,
        variants: [variant1, variant2, variant3],
      };
    },
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
 * Translate an HTML snippet to JSX. Currently: class= → className=, optionally
 * preserves whitespace + tags. The fake agent writes innerHtml in HTML form;
 * the orchestrator translates per the target file's syntax.
 */
function htmlToJsx(html) {
  return html.replace(/\bclass=/g, 'className=');
}

/**
 * Render the variants block in either HTML or JSX, depending on commentSyntax.
 * In JSX:
 *   - comments use {/​* ... *​/} (already what commentSyntax.open is)
 *   - <style>{`@scope ... { ... }`}</style> wraps CSS in a template literal so JSX
 *     doesn't choke on the {} in CSS
 *   - non-default visible variants use style={{display: 'none'}}
 *   - inner element class= becomes className=
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

  const next = [
    ...lines.slice(0, markerIdx + 1),
    block,
    ...lines.slice(markerIdx + 1),
  ];
  await fs.writeFile(filePath, next.join('\n'), 'utf-8');
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
 * @param {VariantAgent} opts.agent
 * @param {AbortSignal} opts.signal
 * @param {(msg: string) => void} [opts.log]
 * @param {object} [opts.wrapTarget] Default target for live-wrap when an
 *                                   element comes from the picker without an
 *                                   id we can resolve. e.g. {classes:'hero-title', tag:'h1'}.
 */
export async function runAgentLoop({
  tmp,
  scriptsDir,
  port,
  token,
  agent,
  signal,
  log = () => {},
  wrapTarget = { classes: 'hero-title', tag: 'h1' },
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

    if (event.type === 'generate') {
      log(`generate id=${event.id} action=${event.action} count=${event.count}`);
      try {
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
        const wrapInfo = await runWrap({
          tmp,
          scriptsDir,
          id: event.id,
          count: event.count,
          ...target,
          text,
        });
        log(`wrapped: ${wrapInfo.file} insertLine=${wrapInfo.insertLine}`);

        // 2. Agent generates variant content (LLM-pluggable seam)
        const output = await agent.generateVariants(event, { wrapTarget, wrapInfo });
        if (output.variants.length !== event.count) {
          log(`warning: agent returned ${output.variants.length} variants, expected ${event.count}`);
        }

        // 3. Splice variants block into the wrapper (deterministic fs)
        await spliceVariantsIntoWrapper({ tmp, wrapInfo, sessionId: event.id, output });
        if (process.env.IMPECCABLE_E2E_DEBUG) {
          const post = await fs.readFile(path.join(tmp, wrapInfo.file), 'utf-8');
          log(`--- post-splice (variants written) ---\n${post}`);
        }

        // 4. Tell the server we're done (broadcasts SSE done → browser settles to CYCLING)
        await fetch(`${base}/poll`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, type: 'done', id: event.id }),
          signal,
        });
      } catch (err) {
        if (signal.aborted) return;
        log('generate failed: ' + err.message);
        await fetch(`${base}/poll`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, type: 'error', id: event.id, message: err.message }),
          signal,
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

        await fetch(`${base}/poll`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, type: 'accept', id: event.id, data: { _acceptResult: acceptResult } }),
          signal,
        });
      } catch (err) {
        if (signal.aborted) return;
        log('accept failed: ' + err.message);
      }
      continue;
    }

    if (event.type === 'discard') {
      log(`discard id=${event.id}`);
      try {
        const discardResult = await runAccept({ tmp, scriptsDir, id: event.id, discard: true });
        await fetch(`${base}/poll`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, type: 'discard', id: event.id, data: { _acceptResult: discardResult } }),
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

async function runWrap({ tmp, scriptsDir, id, count, classes, tag, elementId, text }) {
  const args = [path.join(scriptsDir, 'live-wrap.mjs'), '--id', id, '--count', String(count)];
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
  // around the accepted content. live-accept emits this wrapper with
  // `style="display: contents"` so it doesn't affect layout. We strip the
  // wrapper open/close lines and keep what's between.
  // Match the opening div (any single line) followed by inner content
  // followed by `</div>`, where the open carries data-impeccable-variant
  // and is NOT inside a data-impeccable-variants wrapper (the variants
  // wrapper has the trailing `s`).
  body = body.replace(
    /^([ \t]*)<div\b[^>]*\bdata-impeccable-variant="[^"]+"[^>]*>\n([\s\S]*?)\n[ \t]*<\/div>\n/m,
    (match, indent, inner) => {
      // Re-indent inner content to the wrapper's indent level.
      const innerLines = inner.split('\n');
      const innerIndent = (innerLines[0].match(/^\s*/) || [''])[0];
      const dedented = innerLines.map((l) => {
        if (l.startsWith(innerIndent)) return indent + l.slice(innerIndent.length);
        return l;
      }).join('\n');
      return dedented + '\n';
    },
  );

  await fs.writeFile(filePath, body, 'utf-8');
}

async function runAccept({ tmp, scriptsDir, id, variant, discard, paramValues }) {
  const args = [path.join(scriptsDir, 'live-accept.mjs'), '--id', id];
  if (discard) args.push('--discard');
  else args.push('--variant', String(variant));
  if (paramValues) args.push('--param-values', JSON.stringify(paramValues));
  const { stdout } = await execFileP(process.execPath, args, { cwd: tmp });
  const last = stdout.trim().split('\n').filter(Boolean).pop();
  return JSON.parse(last);
}
