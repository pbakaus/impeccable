/**
 * Tests for live-accept.mjs — the deterministic accept/discard helper.
 * Run with: node --test tests/live-accept.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { deferredAcceptsPath } from '../skill/scripts/live-svelte-component.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ACCEPT = resolve(__dirname, '..', 'skill/scripts/live-accept.mjs');
const WRAP = resolve(__dirname, '..', 'skill/scripts/live-wrap.mjs');

function runAccept(cwd, args) {
  try {
    const out = execFileSync('node', [ACCEPT, ...args], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return JSON.parse(out.trim());
  } catch (err) {
    const body = err.stdout?.toString().trim() || err.stderr?.toString().trim() || '';
    return JSON.parse(body || '{}');
  }
}

describe('live-accept — style-element edge cases', () => {
  let tmp;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'impeccable-accept-test-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('accepts a Svelte component-injection variant into the real source file', () => {
    mkdirSync(join(tmp, 'src', 'routes'), { recursive: true });
    mkdirSync(join(tmp, 'node_modules/.impeccable-live/COMP01'), { recursive: true });
    writeFileSync(join(tmp, 'src/routes/+page.svelte'), `<main>
  <article class="expense-row">
    <strong>{expenses[0].name}</strong>
    <span>{expenses[0].amount}</span>
  </article>
</main>
`);
    writeFileSync(join(tmp, 'node_modules/.impeccable-live/COMP01/manifest.json'), JSON.stringify({
      id: 'COMP01',
      previewMode: 'svelte-component',
      sourceFile: 'src/routes/+page.svelte',
      sourceStartLine: 2,
      sourceEndLine: 5,
      count: 2,
      propContract: [
        { prop: 'name', expr: 'expenses[0].name', placeholder: '{expenses[0].name}' },
        { prop: 'amount', expr: 'expenses[0].amount', placeholder: '{expenses[0].amount}' },
      ],
      originalMarkup: `<article class="expense-row">
    <strong>{expenses[0].name}</strong>
    <span>{expenses[0].amount}</span>
  </article>`,
      componentDir: 'node_modules/.impeccable-live/COMP01',
      runtimeModule: '/node_modules/.impeccable-live/__runtime.js',
    }, null, 2) + '\n');
    writeFileSync(join(tmp, 'node_modules/.impeccable-live/COMP01/v2.svelte'), `<script>
  /** @type {{ name: string, amount: string }} */
  let { name, amount } = $props();
</script>

<article class="expense-row accepted">
  <strong>{name}</strong>
  <span>{amount}</span>
</article>

<style>
  .accepted {
    box-shadow: 0 12px 24px rgba(0, 0, 0, 0.2);
  }
</style>
`);

    const result = runAccept(tmp, ['--id', 'COMP01', '--variant', '2']);
    assert.equal(result.handled, true, `accept should succeed: ${JSON.stringify(result)}`);
    assert.equal(result.file, 'src/routes/+page.svelte');
    assert.equal(result.previewMode, 'svelte-component');

    const sourceAfter = readFileSync(join(tmp, 'src/routes/+page.svelte'), 'utf-8');
    assert.ok(sourceAfter.includes('class="expense-row accepted"'), 'accepted variant written to real Svelte source');
    assert.ok(sourceAfter.includes('{expenses[0].name}'), 'source write preserves Svelte expressions');
    assert.ok(sourceAfter.includes('.accepted {'), 'accepted component CSS is written into route style');
    assert.ok(!existsSync(join(tmp, 'node_modules/.impeccable-live/COMP01')), 'temp component dir removed after accept');
  });

  it('scrubs preview-only variant CSS when accepting a Svelte component', () => {
    mkdirSync(join(tmp, 'src', 'routes'), { recursive: true });
    mkdirSync(join(tmp, 'node_modules/.impeccable-live/SCRUBCSS'), { recursive: true });
    writeFileSync(join(tmp, 'src/routes/+page.svelte'), `<main>
  <article class="expense-row">
    <div class="expense-details">
      <strong>{expenses[0].name}</strong>
      <span>{expenses[0].amount}</span>
    </div>
  </article>
</main>
<style>
  .expense-row { padding: 20px; }
</style>
`);
    writeFileSync(join(tmp, 'node_modules/.impeccable-live/SCRUBCSS/manifest.json'), JSON.stringify({
      id: 'SCRUBCSS',
      previewMode: 'svelte-component',
      sourceFile: 'src/routes/+page.svelte',
      sourceStartLine: 2,
      sourceEndLine: 7,
      count: 3,
      propContract: [
        { prop: 'name', expr: 'expenses[0].name', placeholder: '{expenses[0].name}' },
        { prop: 'amount', expr: 'expenses[0].amount', placeholder: '{expenses[0].amount}' },
      ],
      originalMarkup: `<article class="expense-row">
    <div class="expense-details">
      <strong>{expenses[0].name}</strong>
      <span>{expenses[0].amount}</span>
    </div>
  </article>`,
      componentDir: 'node_modules/.impeccable-live/SCRUBCSS',
      runtimeModule: '/node_modules/.impeccable-live/__runtime.js',
    }, null, 2) + '\n');
    writeFileSync(join(tmp, 'node_modules/.impeccable-live/SCRUBCSS/v2.svelte'), `<script>
  let { name, amount } = $props();
</script>

<article class="expense-row accepted">
  <div class="expense-details">
    <strong>{name}</strong>
    <span>{amount}</span>
  </div>
</article>

<style>
  [data-impeccable-variant="1"] .expense-row { color: red; } [data-impeccable-variant="2"] .expense-row { color: green; } [data-impeccable-variant="2"] [data-p-density="airy"] .expense-details { gap: 12px; } [data-impeccable-variant="3"] .expense-row { color: blue; } * { --impeccable-variant-ready: 1; }
</style>
`);

    const result = runAccept(tmp, [
      '--id',
      'SCRUBCSS',
      '--variant',
      '2',
      '--param-values',
      JSON.stringify({ density: 'airy' }),
    ]);
    assert.equal(result.handled, true, `accept should succeed: ${JSON.stringify(result)}`);

    const sourceAfter = readFileSync(join(tmp, 'src/routes/+page.svelte'), 'utf-8');
    assert.ok(sourceAfter.includes('color: green'), 'accepted variant CSS kept');
    assert.ok(sourceAfter.includes('gap: 12px'), 'selected param CSS kept and unwrapped');
    assert.doesNotMatch(sourceAfter, /data-impeccable-variant/, 'preview variant selectors removed from accepted source');
    assert.doesNotMatch(sourceAfter, /--impeccable-variant-ready/, 'preview readiness marker removed from accepted source');
    assert.doesNotMatch(sourceAfter, /color: red|color: blue/, 'non-accepted variant CSS dropped');
    assert.ok(!existsSync(join(tmp, 'node_modules/.impeccable-live/SCRUBCSS')), 'temp component dir removed after accept');
  });

  it('treats deprecated --defer-source-write as immediate Svelte source accept', () => {
    mkdirSync(join(tmp, 'src', 'routes'), { recursive: true });
    mkdirSync(join(tmp, 'node_modules/.impeccable-live/DEFER'), { recursive: true });
    writeFileSync(join(tmp, 'src/routes/+page.svelte'), `<main>
  <article class="expense-row">
    <strong>{expenses[0].name}</strong>
    <span>{expenses[0].amount}</span>
  </article>
</main>
<style>
  .expense-row { padding: 20px; }
</style>
`);
    writeFileSync(join(tmp, 'node_modules/.impeccable-live/DEFER/manifest.json'), JSON.stringify({
      id: 'DEFER',
      previewMode: 'svelte-component',
      sourceFile: 'src/routes/+page.svelte',
      sourceStartLine: 2,
      sourceEndLine: 5,
      count: 1,
      propContract: [
        { prop: 'name', expr: 'expenses[0].name', placeholder: '{expenses[0].name}' },
        { prop: 'amount', expr: 'expenses[0].amount', placeholder: '{expenses[0].amount}' },
      ],
      originalMarkup: `<article class="expense-row">
    <strong>{expenses[0].name}</strong>
    <span>{expenses[0].amount}</span>
  </article>`,
      componentDir: 'node_modules/.impeccable-live/DEFER',
      runtimeModule: '/node_modules/.impeccable-live/__runtime.js',
    }, null, 2) + '\n');
    writeFileSync(join(tmp, 'node_modules/.impeccable-live/DEFER/v1.svelte'), `<script>
  /** @type {{ name: string, amount: string }} */
  let { name, amount } = $props();
</script>

<article class="expense-row accepted">
  <strong>{name}</strong>
  <span>{amount}</span>
</article>

<style>
  .accepted {
    box-shadow: 0 12px 24px rgba(0, 0, 0, 0.2);
  }
</style>
`);

    const deprecated = runAccept(tmp, ['--id', 'DEFER', '--variant', '1', '--defer-source-write']);
    assert.equal(deprecated.handled, true, `accept should succeed: ${JSON.stringify(deprecated)}`);
    assert.equal(deprecated.deferredSourceWrite, undefined, 'deprecated flag must not report a deferred source write');
    assert.equal(deprecated.file, 'src/routes/+page.svelte');

    const sourceAfterAccept = readFileSync(join(tmp, 'src/routes/+page.svelte'), 'utf-8');
    assert.ok(sourceAfterAccept.includes('class="expense-row accepted"'), 'deprecated defer flag still writes selected variant immediately');
    assert.ok(sourceAfterAccept.includes('{expenses[0].name}'), 'source write preserves Svelte expressions');
    assert.ok(sourceAfterAccept.includes('.accepted {'), 'accepted component CSS is written into route style');
    assert.ok(sourceAfterAccept.includes('box-shadow: 0 12px 24px rgba(0, 0, 0, 0.2);'), 'accepted CSS declaration survives');
    assert.equal(existsSync(deferredAcceptsPath(tmp)), false, 'no deferred accept queue should be created');
    assert.ok(!existsSync(join(tmp, 'node_modules/.impeccable-live/DEFER')), 'temp component dir removed after immediate accept');
  });

  it('keeps Svelte preview files recoverable when selected variant is missing', () => {
    mkdirSync(join(tmp, 'src', 'routes'), { recursive: true });
    mkdirSync(join(tmp, 'node_modules/.impeccable-live/MISSING'), { recursive: true });
    const originalSource = `<main>
  <article class="expense-row">
    <strong>{expenses[0].name}</strong>
  </article>
</main>
`;
    writeFileSync(join(tmp, 'src/routes/+page.svelte'), originalSource);
    writeFileSync(join(tmp, 'node_modules/.impeccable-live/MISSING/manifest.json'), JSON.stringify({
      id: 'MISSING',
      previewMode: 'svelte-component',
      sourceFile: 'src/routes/+page.svelte',
      sourceStartLine: 2,
      sourceEndLine: 4,
      count: 2,
      propContract: [
        { prop: 'name', expr: 'expenses[0].name', placeholder: '{expenses[0].name}' },
      ],
      originalMarkup: `<article class="expense-row">
    <strong>{expenses[0].name}</strong>
  </article>`,
      componentDir: 'node_modules/.impeccable-live/MISSING',
      runtimeModule: '/node_modules/.impeccable-live/__runtime.js',
    }, null, 2) + '\n');
    writeFileSync(join(tmp, 'node_modules/.impeccable-live/MISSING/v1.svelte'), `<script>
  let { name } = $props();
</script>

<article class="expense-row accepted">
  <strong>{name}</strong>
</article>
`);

    const result = runAccept(tmp, ['--id', 'MISSING', '--variant', '2']);
    assert.equal(result.handled, false);
    assert.equal(result.file, 'src/routes/+page.svelte');
    assert.equal(result.previewMode, 'svelte-component');
    assert.match(result.error, /Variant 2 not found/);
    assert.equal(readFileSync(join(tmp, 'src/routes/+page.svelte'), 'utf-8'), originalSource);
    assert.equal(existsSync(join(tmp, 'node_modules/.impeccable-live/MISSING')), true, 'failed accept keeps temp preview session for recovery');
  });

  // Historical bug: extractVariant flipped into "inStyle" mode on <style and
  // scanned for </style> line-by-line. JSX self-closing <style ... /> has no
  // separate closer, so it got stuck forever and missed data-impeccable-variant
  // divs that came after.
  it('finds the accepted variant after a JSX self-closing <style /> block', () => {
    const html = `<body>
  <!-- impeccable-variants-start SELFC -->
  <div data-impeccable-variants="SELFC" data-impeccable-variant-count="3" style="display: contents">
    <div data-impeccable-variant="original">
      <p class="hook">original text</p>
    </div>
    <style data-impeccable-css="SELFC" dangerouslySetInnerHTML={{ __html: '@scope ([data-impeccable-variant="1"]) { .hook { color: red; } }' }} />
    <div data-impeccable-variant="1">
      <p class="hook">variant one</p>
    </div>
    <div data-impeccable-variant="2" style="display: none">
      <p class="hook">variant two</p>
    </div>
    <div data-impeccable-variant="3" style="display: none">
      <p class="hook">variant three</p>
    </div>
  </div>
  <!-- impeccable-variants-end SELFC -->
</body>`;
    writeFileSync(join(tmp, 'page.html'), html);

    const result = runAccept(tmp, ['--id', 'SELFC', '--variant', '2']);
    assert.equal(result.handled, true, `accept should succeed: ${JSON.stringify(result)}`);

    const after = readFileSync(join(tmp, 'page.html'), 'utf-8');
    // Self-closing style has no extractable CSS body, so there's nothing to carbonize —
    // no carbonize block, no data-impeccable-variant wrapper (it would serve no purpose).
    assert.ok(!after.includes('impeccable-carbonize-start'), 'no carbonize block (self-closing style has no body)');
    assert.ok(!after.includes('impeccable-variants-start'), 'variant markers removed');
    assert.ok(after.includes('variant two'), 'variant 2 content kept');
    assert.ok(!after.includes('variant three'), 'other variant content dropped');
    assert.ok(!after.includes('variant one'), 'other variant content dropped');
    assert.ok(!after.includes('original text'), 'original content dropped');
  });

  // Variant: same-line <style>…</style> block should also be treated as a
  // single skipped unit; the line has both open and close tags.
  it('finds the accepted variant after a single-line <style>…</style> block', () => {
    const html = `<body>
  <!-- impeccable-variants-start ONELINE -->
  <div data-impeccable-variants="ONELINE" data-impeccable-variant-count="3" style="display: contents">
    <div data-impeccable-variant="original"><p class="hook">original</p></div>
    <style data-impeccable-css="ONELINE">@scope ([data-impeccable-variant="1"]) { .hook { color: red; } }</style>
    <div data-impeccable-variant="1"><p class="hook">variant one</p></div>
    <div data-impeccable-variant="2" style="display: none"><p class="hook">variant two</p></div>
    <div data-impeccable-variant="3" style="display: none"><p class="hook">variant three</p></div>
  </div>
  <!-- impeccable-variants-end ONELINE -->
</body>`;
    writeFileSync(join(tmp, 'page.html'), html);

    const result = runAccept(tmp, ['--id', 'ONELINE', '--variant', '3']);
    assert.equal(result.handled, true, `accept should succeed: ${JSON.stringify(result)}`);

    const after = readFileSync(join(tmp, 'page.html'), 'utf-8');
    assert.ok(after.includes('data-impeccable-variant="3"'), 'accepted wrapper for variant 3 present');
    assert.ok(after.includes('variant three'), 'variant 3 content kept');
    assert.ok(!after.includes('variant two'), 'other variant content dropped');
  });

  // Baseline: the standard multi-line <style>...</style> case must keep working.
  it('finds the accepted variant after a multi-line <style>…</style> block (regression baseline)', () => {
    const html = `<body>
  <!-- impeccable-variants-start MULTI -->
  <div data-impeccable-variants="MULTI" data-impeccable-variant-count="3" style="display: contents">
    <div data-impeccable-variant="original"><p class="hook">original</p></div>
    <style data-impeccable-css="MULTI">
      @scope ([data-impeccable-variant="1"]) { .hook { color: red; } }
      @scope ([data-impeccable-variant="2"]) { .hook { color: green; } }
    </style>
    <div data-impeccable-variant="1"><p class="hook">variant one</p></div>
    <div data-impeccable-variant="2" style="display: none"><p class="hook">variant two</p></div>
  </div>
  <!-- impeccable-variants-end MULTI -->
</body>`;
    writeFileSync(join(tmp, 'page.html'), html);

    const result = runAccept(tmp, ['--id', 'MULTI', '--variant', '1']);
    assert.equal(result.handled, true, `accept should succeed: ${JSON.stringify(result)}`);

    const after = readFileSync(join(tmp, 'page.html'), 'utf-8');
    assert.ok(after.includes('data-impeccable-variant="1"'), 'accepted wrapper for variant 1 present');
    assert.ok(after.includes('variant one'), 'variant 1 content kept');
  });

  // Regression: the agent writes JSX <style>{`…`}</style> and live-accept's
  // extractCss used to capture the `{` … `` ` ``}` template-literal punctuation
  // as CSS content. handleAccept then re-wrapped with another `{` …
  // `` ` ``}`, producing nested template literals (`<style>{`{`@scope…`}`}`)
  // that oxc rejects with "Expected `}` but found `@`". extractCss must
  // strip the JSX wrap regardless of where the agent placed it.
  it('carbonize does not double-wrap when the variants block uses JSX template literals on their own lines', () => {
    const tsx = `export default function App() {\n` +
      `  return (\n` +
      `    <main>\n` +
      `      <>\n` +
      `        {/* impeccable-variants-start TPL */}\n` +
      `        <div data-impeccable-variants="TPL" data-impeccable-variant-count="2" style={{ display: 'contents' }}>\n` +
      `          <div data-impeccable-variant="original"><p className="hook">orig</p></div>\n` +
      `          <style data-impeccable-css="TPL">\n` +
      "            {`\n" +
      `              @scope ([data-impeccable-variant="1"]) { .hook { color: red; } }\n` +
      `              @scope ([data-impeccable-variant="2"]) { .hook { color: green; } }\n` +
      "            `}\n" +
      `          </style>\n` +
      `          <div data-impeccable-variant="1"><p className="hook">variant one</p></div>\n` +
      `          <div data-impeccable-variant="2" style={{ display: 'none' }}><p className="hook">variant two</p></div>\n` +
      `        </div>\n` +
      `        {/* impeccable-variants-end TPL */}\n` +
      `      </>\n` +
      `    </main>\n` +
      `  );\n` +
      `}\n`;
    writeFileSync(join(tmp, 'App.tsx'), tsx);

    const result = runAccept(tmp, ['--id', 'TPL', '--variant', '1']);
    assert.equal(result.handled, true, `accept should succeed: ${JSON.stringify(result)}`);

    const after = readFileSync(join(tmp, 'App.tsx'), 'utf-8');
    // Exactly one `{` opener after the carbonized <style ...> tag — not two.
    const carbonStyleMatch = after.match(/<style data-impeccable-css="TPL">([\s\S]*?)<\/style>/);
    assert.ok(carbonStyleMatch, 'carbonize <style> block present');
    const inner = carbonStyleMatch[1];
    // Inner must open with one `{` ... and end with one ` `` ... — no nesting.
    const openCount = (inner.match(/\{`/g) || []).length;
    const closeCount = (inner.match(/`\}/g) || []).length;
    assert.equal(openCount, 1, `expected exactly one {\` opener, got ${openCount}`);
    assert.equal(closeCount, 1, `expected exactly one \`} closer, got ${closeCount}`);
    // CSS content survived intact.
    assert.ok(inner.includes('@scope ([data-impeccable-variant="1"])'), 'variant-1 scope kept');
  });

  // Same shape, but the agent put `{`` and ``\`}` attached to first/last CSS
  // lines instead of on dedicated lines. Tests the inline-strip branch.
  it('carbonize does not double-wrap when JSX template-literal punctuation hugs the CSS lines', () => {
    const tsx = `export default function App() {\n` +
      `  return (\n` +
      `    <main>\n` +
      `      <>\n` +
      `        {/* impeccable-variants-start INLINE */}\n` +
      `        <div data-impeccable-variants="INLINE" data-impeccable-variant-count="2" style={{ display: 'contents' }}>\n` +
      `          <div data-impeccable-variant="original"><p className="hook">orig</p></div>\n` +
      `          <style data-impeccable-css="INLINE">\n` +
      "            {`@scope ([data-impeccable-variant=\"1\"]) { .hook { color: red; } }\n" +
      "             @scope ([data-impeccable-variant=\"2\"]) { .hook { color: green; } }`}\n" +
      `          </style>\n` +
      `          <div data-impeccable-variant="1"><p className="hook">variant one</p></div>\n` +
      `          <div data-impeccable-variant="2" style={{ display: 'none' }}><p className="hook">variant two</p></div>\n` +
      `        </div>\n` +
      `        {/* impeccable-variants-end INLINE */}\n` +
      `      </>\n` +
      `    </main>\n` +
      `  );\n` +
      `}\n`;
    writeFileSync(join(tmp, 'App.tsx'), tsx);

    const result = runAccept(tmp, ['--id', 'INLINE', '--variant', '1']);
    assert.equal(result.handled, true, `accept should succeed: ${JSON.stringify(result)}`);

    const after = readFileSync(join(tmp, 'App.tsx'), 'utf-8');
    const inner = after.match(/<style data-impeccable-css="INLINE">([\s\S]*?)<\/style>/)[1];
    const openCount = (inner.match(/\{`/g) || []).length;
    const closeCount = (inner.match(/`\}/g) || []).length;
    assert.equal(openCount, 1, `expected one {\` opener, got ${openCount}`);
    assert.equal(closeCount, 1, `expected one \`} closer, got ${closeCount}`);
    assert.ok(inner.includes('@scope ([data-impeccable-variant="1"])'), 'variant-1 scope kept');
  });

  // Regression: carbonize accept must not emit sibling nodes into a single-child
  // JSX slot (e.g. ternary else branch). live-wrap uses one outer div; accept
  // must match or Vite/Oxc fails with "Expected `,` or `)` but found Identifier".
  it('carbonize accept wraps JSX output in a single outer div for ternary branches', () => {
    const jsx = `import { useState } from 'react';

export default function App() {
  const [expenses, setExpenses] = useState([]);
  return (
    <main>
      <section className="expense-panel">
        {expenses.length === 0 ? (
          <article className="empty-card">No expenses</article>
        ) : (
          <div data-impeccable-variants="TERN" data-impeccable-variant-count="2" style={{ display: 'contents' }}>
            {/* impeccable-variants-start TERN */}
            <div data-impeccable-variant="original">
              <article className="expense-row"><strong>orig</strong></article>
            </div>
            <style data-impeccable-css="TERN">
              {\`
              @scope ([data-impeccable-variant="1"]) { .expense-row { padding: 8px; } }
              @scope ([data-impeccable-variant="2"]) { .expense-row { padding: 16px; } }
              \`}
            </style>
            <div data-impeccable-variant="1"><article className="expense-row"><strong>v1</strong></article></div>
            <div data-impeccable-variant="2" style={{ display: 'none' }}><article className="expense-row"><strong>v2</strong></article></div>
            {/* impeccable-variants-end TERN */}
          </div>
        )}
      </section>
    </main>
  );
}
`;
    writeFileSync(join(tmp, 'App.jsx'), jsx);

    const result = runAccept(tmp, ['--id', 'TERN', '--variant', '2']);
    assert.equal(result.handled, true, `accept should succeed: ${JSON.stringify(result)}`);

    const after = readFileSync(join(tmp, 'App.jsx'), 'utf-8');
    assert.match(
      after,
      /\)\s*:\s*\(\s*\n\s*<div data-impeccable-carbonize="TERN"/m,
      'ternary else branch must have one outer carbonize wrapper root',
    );
    assert.doesNotMatch(
      after,
      /\)\s*:\s*\(\s*\n\s*\{\/\*\s*impeccable-carbonize-start/m,
      'carbonize start marker must not be a sibling at the ternary slot level',
    );
    assert.ok(after.includes('data-impeccable-variant="2"'), 'accepted variant wrapper kept');
    assert.ok(after.includes('v2'), 'variant 2 content kept');
  });

  // Cursor Bugbot regression (PR #118 review): the JSX wrapper places
  // marker comments INSIDE the outer <div>, so block.start sits 2 spaces
  // deeper than the original element. Using block.start as the deindent
  // base on JSX accept/discard pushes every restored line 2 spaces too far
  // right. The fix anchors the indent on `replaceRange.start` (the outer
  // wrapper line), which is at the original element's indent level for
  // both HTML and JSX.
  it('discard restores JSX content at the original indent (no 2-space drift from marker-inside layout)', () => {
    // Run the real wrap CLI so we exercise the JSX-marker-inside-wrapper
    // layout end to end, not a hand-rolled approximation.
    const tsx = `export default function App() {
  return (
    <main>
      <aside className="card">
        <h1 className="hero-title">Hero</h1>
      </aside>
    </main>
  );
}`;
    writeFileSync(join(tmp, 'App.tsx'), tsx);

    execFileSync('node', [WRAP, '--id', 'INDENTDISC', '--count', '3', '--classes', 'card', '--tag', 'aside', '--file', join(tmp, 'App.tsx')], {
      cwd: tmp,
      encoding: 'utf-8',
    });

    runAccept(tmp, ['--id', 'INDENTDISC', '--discard']);
    const after = readFileSync(join(tmp, 'App.tsx'), 'utf-8');
    // The aside opener should land at exactly 6 spaces — same as the
    // original — and the <h1> child at 8 (preserved relative depth).
    // The earlier 6/6/6 collapse was caused by `originalLines.map(l =>
    // indent + '    ' + l.trimStart())` in live-wrap stripping ALL
    // leading whitespace before reindenting; the fix strips only the
    // COMMON minimum so the relative structure is preserved.
    assert.match(after, /^      <aside className="card">$/m,
      `<aside> opener must be at 6-space indent (was 8 before outer-indent fix), got:\n${after}`);
    assert.match(after, /^        <h1 className="hero-title">Hero<\/h1>$/m,
      `<h1> child must be at 8-space indent — relative depth preserved through wrap+discard. Got:\n${after}`);
    assert.match(after, /^      <\/aside>$/m,
      `</aside> closer must be back at 6-space indent. Got:\n${after}`);
  });

  it('expandReplaceRange handles multi-line self-closing <div /> inside the wrapped element', () => {
    // Cursor Bugbot regression: per-line depth tracking in
    // `expandReplaceRange` couldn't see across line boundaries, so a
    // multi-line self-closing JSX `<div\n  className="spacer"\n/>` got
    // counted as +1 with no compensating -1. The wrapper's outer </div>
    // never matched the depth-zero condition; replace-range stopped at
    // block.end (the marker comment), leaving the wrapper's outer </div>
    // orphaned in the file after accept/discard — and worse, an
    // unrelated <div className="next-card"> right after the wrapper got
    // its own </div> mis-counted as the wrapper close.
    const tsx = `export default function App() {
  return (
    <main>
      <aside className="card">
        <h1>Hi</h1>
        <div
          className="spacer"
        />
        <p>Body</p>
      </aside>
      <div className="next-card">After</div>
    </main>
  );
}`;
    writeFileSync(join(tmp, 'App.tsx'), tsx);

    execFileSync('node', [WRAP, '--id', 'MULTILINESC', '--count', '3', '--classes', 'card', '--tag', 'aside', '--file', join(tmp, 'App.tsx')], {
      cwd: tmp,
      encoding: 'utf-8',
    });

    const result = runAccept(tmp, ['--id', 'MULTILINESC', '--discard']);
    assert.equal(result.handled, true, `discard should succeed: ${JSON.stringify(result)}`);

    const after = readFileSync(join(tmp, 'App.tsx'), 'utf-8');
    // The wrapper scaffold must be fully gone — no orphan </div> from
    // the outer wrapper, and no impeccable markers/data attributes.
    assert.ok(!after.includes('data-impeccable-variants'),
      `outer wrapper div must be fully removed; got:\n${after}`);
    assert.ok(!after.includes('data-impeccable-variant'),
      `original-div wrapper must be fully removed; got:\n${after}`);
    assert.ok(!after.includes('impeccable-variants-start'),
      `start marker must be removed; got:\n${after}`);
    // The unrelated <div className="next-card">After</div> sibling
    // must survive intact — Bugbot's worst-case scenario was the depth
    // walk eating its </div> as the wrapper close.
    assert.ok(after.includes('<div className="next-card">After</div>'),
      `unrelated next-card sibling must be preserved; got:\n${after}`);
    // The multi-line self-closing div inside the original element must
    // survive too.
    assert.match(after, /<div\s*\n\s*className="spacer"\s*\n\s*\/>/m,
      `multi-line self-closing <div /> inside original must survive; got:\n${after}`);
  });

  it('expandReplaceRange finds JSX wrapper openers with long multi-line attributes', () => {
    const extraAttrs = Array.from({ length: 18 }, (_, i) => `        data-extra-${i}="x"`).join('\n');
    const tsx = `export default function App() {
  return (
    <main>
      <div
        className="impeccable-preview-shell"
${extraAttrs}
        data-impeccable-variants="LONGOPEN"
        data-impeccable-variant-count="2"
        style={{ display: 'contents' }}
      >
        {/* impeccable-variants-start LONGOPEN */}
        {/* Original */}
        <div data-impeccable-variant="original">
          <aside className="card">
            <h1>Original</h1>
          </aside>
        </div>
        {/* Variants: insert below this line */}
        <div data-impeccable-variant="1"><aside className="card"><h1>Variant</h1></aside></div>
        {/* impeccable-variants-end LONGOPEN */}
      </div>
      <div className="next-card">After</div>
    </main>
  );
}`;
    writeFileSync(join(tmp, 'App.tsx'), tsx);

    const result = runAccept(tmp, ['--id', 'LONGOPEN', '--discard']);
    assert.equal(result.handled, true, `discard should succeed: ${JSON.stringify(result)}`);

    const after = readFileSync(join(tmp, 'App.tsx'), 'utf-8');
    assert.doesNotMatch(after, /data-impeccable-variants/);
    assert.doesNotMatch(after, /impeccable-variants-start/);
    assert.match(after, /<aside className="card">\s*<h1>Original<\/h1>\s*<\/aside>/m);
    assert.ok(after.includes('<div className="next-card">After</div>'));
  });

  it('expandReplaceRange ignores unrelated prior end markers while finding the current JSX wrapper', () => {
    const tsx = `export default function App() {
  return (
    <main>
      <div data-impeccable-variants="ACTIVE" data-impeccable-variant-count="2" style={{ display: 'contents' }}>
        <div className="historical-marker-note">
          {/* impeccable-variants-end OLD */}
        </div>
        {/* impeccable-variants-start ACTIVE */}
        {/* Original */}
        <div data-impeccable-variant="original">
          <aside className="card">
            <h1>Original</h1>
          </aside>
        </div>
        {/* Variants: insert below this line */}
        <div data-impeccable-variant="1"><aside className="card"><h1>Variant</h1></aside></div>
        {/* impeccable-variants-end ACTIVE */}
      </div>
      <div className="next-card">After</div>
    </main>
  );
}`;
    writeFileSync(join(tmp, 'App.tsx'), tsx);

    const result = runAccept(tmp, ['--id', 'ACTIVE', '--discard']);
    assert.equal(result.handled, true, `discard should succeed: ${JSON.stringify(result)}`);

    const after = readFileSync(join(tmp, 'App.tsx'), 'utf-8');
    assert.doesNotMatch(after, /data-impeccable-variants/);
    assert.doesNotMatch(after, /impeccable-variants-start ACTIVE/);
    assert.doesNotMatch(after, /impeccable-variants-end OLD/);
    assert.match(after, /<aside className="card">\s*<h1>Original<\/h1>\s*<\/aside>/m);
    assert.ok(after.includes('<div className="next-card">After</div>'));
  });

  it('accept (no carbonize, raw HTML) restores at the original indent on JSX', () => {
    // Manually craft a wrapped file in the JSX-marker-inside layout — this
    // mirrors what wrap produces, but lets us exercise accept's indent
    // logic without a full live cycle.
    const tsx = `export default function App() {
  return (
    <main>
      <div data-impeccable-variants="INDENTACC" data-impeccable-variant-count="3" style={{ display: "contents" }}>
        {/* impeccable-variants-start INDENTACC */}
        {/* Original */}
        <div data-impeccable-variant="original">
          <aside className="card">
            <h1 className="hero-title">Hero</h1>
          </aside>
        </div>
        {/* Variants: insert below this line */}
        <div data-impeccable-variant="1"><aside className="card variant-one"><h1 className="hero-title">Hero</h1></aside></div>
        {/* impeccable-variants-end INDENTACC */}
      </div>
    </main>
  );
}`;
    writeFileSync(join(tmp, 'App.tsx'), tsx);

    runAccept(tmp, ['--id', 'INDENTACC', '--variant', '1']);
    const after = readFileSync(join(tmp, 'App.tsx'), 'utf-8');
    // The accepted aside (variant-one) should land at 6-space indent, the
    // same place the wrapper <div> sat — not 2 spaces deeper.
    assert.match(after, /^      <aside className="card variant-one">/m,
      `accepted <aside> must land at 6-space indent (the wrapper's level), got:\n${after}`);
  });

  // Discard must restore the original element after a self-closing <style />,
  // proving extractOriginal also survives the style pattern.
  it('discard restores the original element after a JSX self-closing <style />', () => {
    const html = `<body>
  <!-- impeccable-variants-start DISC -->
  <div data-impeccable-variants="DISC" data-impeccable-variant-count="2" style="display: contents">
    <div data-impeccable-variant="original"><p class="hook">ORIGINAL CONTENT</p></div>
    <style data-impeccable-css="DISC" dangerouslySetInnerHTML={{ __html: '@scope ([data-impeccable-variant="1"]) { .hook { color: red; } }' }} />
    <div data-impeccable-variant="1"><p class="hook">variant one</p></div>
    <div data-impeccable-variant="2" style="display: none"><p class="hook">variant two</p></div>
  </div>
  <!-- impeccable-variants-end DISC -->
</body>`;
    writeFileSync(join(tmp, 'page.html'), html);

    const result = runAccept(tmp, ['--id', 'DISC', '--discard']);
    assert.equal(result.handled, true, `discard should succeed: ${JSON.stringify(result)}`);

    const after = readFileSync(join(tmp, 'page.html'), 'utf-8');
    assert.ok(after.includes('ORIGINAL CONTENT'), 'original restored');
    assert.ok(!after.includes('impeccable-variants-start'), 'wrapper markers gone');
    assert.ok(!after.includes('variant one'), 'variants dropped');
  });
});

describe('live-accept — insert sessions', () => {
  let tmp;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'impeccable-accept-insert-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  const insertHtml = (id) => `<main>
  <section class="hero">Hero block</section>
  <!-- impeccable-variants-start ${id} -->
  <div data-impeccable-variants="${id}" data-impeccable-mode="insert" data-impeccable-variant-count="2" style="display: contents">
    <!-- Variants: insert below this line -->
    <style data-impeccable-css="${id}">@scope ([data-impeccable-variant="1"]) { .cta { color: red; } }</style>
    <div data-impeccable-variant="1"><p class="cta">Variant one</p></div>
    <div data-impeccable-variant="2" style="display: none"><p class="cta">Variant two</p></div>
  </div>
  <!-- impeccable-variants-end ${id} -->
  <section class="footer">Footer</section>
</main>`;

  it('discard removes an insert wrapper without touching anchor sections', () => {
    writeFileSync(join(tmp, 'page.html'), insertHtml('insaaa01'));
    const result = runAccept(tmp, ['--id', 'insaaa01', '--discard']);
    assert.equal(result.handled, true, JSON.stringify(result));
    const after = readFileSync(join(tmp, 'page.html'), 'utf-8');
    assert.ok(after.includes('Hero block'));
    assert.ok(after.includes('Footer'));
    assert.ok(!after.includes('impeccable-variants-start'));
    assert.ok(!after.includes('Variant one'));
  });

  it('accept keeps the chosen insert variant and drops the wrapper', () => {
    writeFileSync(join(tmp, 'page.html'), insertHtml('insbbb02'));
    const result = runAccept(tmp, ['--id', 'insbbb02', '--variant', '2']);
    assert.equal(result.handled, true, JSON.stringify(result));
    const after = readFileSync(join(tmp, 'page.html'), 'utf-8');
    assert.ok(after.includes('Variant two'));
    assert.ok(!after.includes('Variant one'));
    assert.ok(!after.includes('impeccable-variants-start'));
    assert.ok(after.includes('Hero block'));
    assert.ok(after.includes('Footer'));
  });
});
