/**
 * Tests for live-accept.mjs — the deterministic accept/discard helper.
 * Run with: node --test tests/live-accept.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { sourceLockPath } from '../skill/scripts/live/source-lock.mjs';

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

// The failure that broke the first real Claude Code Live run. Progressive
// publication stages `.impeccable/live/artifacts/<id>-r<n>.<source-ext>`, which
// carries the session marker. findSessionFile walks `src`, `app`, `pages`, ... and
// then `.`; a project whose source is not under one of those (this repo's own site
// lives in `site/pages/`) falls through to the `.` walk, where dot-directories sort
// before letters — so the artifact was found before the real file.
describe('live-accept — marker search must ignore Impeccable state', () => {
  let tmp;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'impeccable-accept-decoy-')); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  const SOURCE = [
    '<main>',
    '<!-- impeccable-variants-start ab12cd34 -->',
    '<div data-impeccable-variant="original">ORIGINAL</div>',
    '<div data-impeccable-variant="1">VARIANT ONE</div>',
    '<!-- impeccable-variants-end ab12cd34 -->',
    '</main>',
    '',
  ].join('\n');

  function seed({ revisions = 3 } = {}) {
    mkdirSync(join(tmp, 'site', 'pages'), { recursive: true });
    mkdirSync(join(tmp, '.impeccable', 'live', 'artifacts'), { recursive: true });
    writeFileSync(join(tmp, 'site', 'pages', 'index.astro'), SOURCE);
    for (let r = 1; r <= revisions; r += 1) {
      writeFileSync(join(tmp, '.impeccable', 'live', 'artifacts', `ab12cd34-r${r}.astro`), SOURCE);
    }
  }

  it('accepts into real source when a staged artifact carries the same marker', () => {
    seed();
    const result = runAccept(tmp, ['--id', 'ab12cd34', '--variant', '1']);
    assert.equal(result.handled, true, JSON.stringify(result));
    assert.equal(
      result.file,
      'site/pages/index.astro',
      'accept must resolve the project file, not the .impeccable artifact decoy',
    );
    const source = readFileSync(join(tmp, 'site', 'pages', 'index.astro'), 'utf-8');
    assert.match(source, /VARIANT ONE/);
    assert.doesNotMatch(source, /impeccable-variants-start/, 'the wrapper must be gone from real source');
  });

  it('discards into real source with an artifact decoy present', () => {
    seed({ revisions: 1 });
    const result = runAccept(tmp, ['--id', 'ab12cd34', '--discard']);
    assert.equal(result.handled, true, JSON.stringify(result));
    assert.equal(result.file, 'site/pages/index.astro');
    assert.match(readFileSync(join(tmp, 'site', 'pages', 'index.astro'), 'utf-8'), /ORIGINAL/);
  });
});

describe('live-accept — session id validation', () => {
  let tmp;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'impeccable-accept-id-')); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  // --id becomes a path segment for the accept receipt. Traversal here wrote
  // JSON to arbitrary absolute paths (e.g. `--id ../../../../etc/evil`).
  for (const id of ['../../../../etc/evil', 'a/b', '..', 'a\\b', '']) {
    it(`refuses --id ${JSON.stringify(id)} without writing a receipt`, () => {
      const res = spawnSync('node', [ACCEPT, '--id', id, '--discard'], {
        cwd: tmp,
        encoding: 'utf-8',
      });
      assert.equal(res.status, 1, 'must exit non-zero');
      assert.match(res.stderr, /Invalid --id|Missing --id/);
      assert.equal(existsSync(join(tmp, '.impeccable', 'live', 'accept-receipts')), false);
    });
  }

  it('still accepts a well-formed id', () => {
    const res = spawnSync('node', [ACCEPT, '--id', 'ab12cd34', '--discard'], {
      cwd: tmp,
      encoding: 'utf-8',
    });
    assert.doesNotMatch(res.stderr || '', /Invalid --id/);
  });

  // --variant is interpolated into a RegExp and into the markup written back to
  // source. `.*` matched the `original` block first, so the CLI reported a
  // successful accept while actually restoring the original.
  for (const variant of ['.*', '[12]', 'original', '1e2', '']) {
    it(`refuses --variant ${JSON.stringify(variant)} rather than matching by regex`, () => {
      writeFileSync(join(tmp, 'page.html'), [
        '<!-- impeccable-variants-start ab12cd34 -->',
        '<div data-impeccable-variant="original">ORIGINAL CONTENT</div>',
        '<div data-impeccable-variant="1">VARIANT ONE</div>',
        '<!-- impeccable-variants-end ab12cd34 -->',
        '',
      ].join('\n'));
      const res = spawnSync('node', [ACCEPT, '--id', 'ab12cd34', '--variant', variant], {
        cwd: tmp,
        encoding: 'utf-8',
      });
      assert.equal(res.status, 1);
      assert.match(res.stderr, /Invalid --variant|Need --discard/);
      assert.match(
        readFileSync(join(tmp, 'page.html'), 'utf-8'),
        /impeccable-variants-start/,
        'a rejected variant must leave the wrapper untouched',
      );
    });
  }
});

// The plain wrapper is the only non-component preview path now that the isolated
// source-artifact mode is gone, so its lock-contention behaviour is what carries
// these guarantees.
describe('live-accept — plain wrapper under source-lock contention', () => {
  let tmp;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'impeccable-accept-lock-')); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  const PAGE = [
    '<!-- impeccable-variants-start ab12cd34 -->',
    '<div data-impeccable-variant="original">ORIGINAL</div>',
    '<div data-impeccable-variant="1">VARIANT ONE</div>',
    '<!-- impeccable-variants-end ab12cd34 -->',
    '',
  ].join('\n');

  function holdLock() {
    // realpath: mkdtemp hands back /var/... on macOS while the child's cwd
    // resolves to /private/var/..., and the lock digest hashes the absolute path.
    const realTmp = realpathSync(tmp);
    const lockPath = sourceLockPath(join(realTmp, 'page.html'), realTmp);
    mkdirSync(dirname(lockPath), { recursive: true });
    // process.pid is alive, so the lock is a live holder rather than stale.
    writeFileSync(lockPath, JSON.stringify({
      owner: 'generation:ab12cd34:1', token: 'other', pid: process.pid, at: Date.now(),
    }) + '\n');
  }

  for (const [label, args] of [['accept', ['--variant', '1']], ['discard', ['--discard']]]) {
    it(`reports a blocked ${label} as mode:error rather than a manual handoff`, () => {
      writeFileSync(join(tmp, 'page.html'), PAGE);
      holdLock();
      const result = runAccept(tmp, ['--id', 'ab12cd34', ...args]);
      assert.equal(result.handled, false, JSON.stringify(result));
      assert.equal(result.error, 'source_locked');
      // Without mode:error, completion.mjs classifies this as agent_done with an ok
      // ack and live.md tells the agent to hand-edit the file — racing the publisher
      // that holds the lock.
      assert.equal(result.mode, 'error');
      assert.equal(readFileSync(join(tmp, 'page.html'), 'utf-8'), PAGE, 'source must be untouched');
      assert.equal(existsSync(join(tmp, '.impeccable', 'live', 'accept-receipts')), false, 'no receipt for a failed op');
    });
  }

  it('succeeds once the lock is gone', () => {
    writeFileSync(join(tmp, 'page.html'), PAGE);
    const result = runAccept(tmp, ['--id', 'ab12cd34', '--variant', '1']);
    assert.equal(result.handled, true, JSON.stringify(result));
    assert.match(readFileSync(join(tmp, 'page.html'), 'utf-8'), /VARIANT ONE/);
  });
});

describe('live-accept — style-element edge cases', () => {
  let tmp;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'impeccable-accept-test-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

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

  it('replays a durable receipt when Accept is retried after source was already written', () => {
    const html = `<body>
  <!-- impeccable-variants-start RECEIPT1 -->
  <div data-impeccable-variants="RECEIPT1" data-impeccable-variant-count="2" style="display: contents">
    <div data-impeccable-variant="original"><p>original</p></div>
    <style data-impeccable-css="RECEIPT1" />
    <div data-impeccable-variant="1"><p>accepted once</p></div>
    <div data-impeccable-variant="2" style="display: none"><p>other</p></div>
  </div>
  <!-- impeccable-variants-end RECEIPT1 -->
</body>`;
    writeFileSync(join(tmp, 'page.html'), html);

    const first = runAccept(tmp, ['--id', 'RECEIPT1', '--variant', '1']);
    const afterFirst = readFileSync(join(tmp, 'page.html'), 'utf-8');
    const replay = runAccept(tmp, ['--id', 'RECEIPT1', '--variant', '1']);

    assert.equal(first.handled, true);
    assert.equal(replay.handled, true);
    assert.equal(replay.alreadyApplied, true);
    assert.equal(replay.file, 'page.html');
    assert.equal(readFileSync(join(tmp, 'page.html'), 'utf-8'), afterFirst);
    const conflict = runAccept(tmp, ['--id', 'RECEIPT1', '--variant', '2']);
    assert.equal(conflict.handled, false);
    assert.equal(conflict.error, 'accept_receipt_conflict');
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
    assert.match(
      after,
      /\n          <div data-impeccable-variant="1" style=\{\{ display: 'contents' \}\}>\n            <p className="hook">variant one<\/p>\n          <\/div>/,
      'accepted JSX content is indented inside the temporary carbonize variant wrapper',
    );
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

  it('carbonize preserves nested JSX indentation when the wrapper starts at column 0', () => {
    const tsx = `<div data-impeccable-variants="ROOTIND" data-impeccable-variant-count="2" style={{ display: 'contents' }}>
  {/* impeccable-variants-start ROOTIND */}
  <div data-impeccable-variant="original">
    <section className="hook">
      <span>original</span>
    </section>
  </div>
  <style data-impeccable-css="ROOTIND">{\`@scope ([data-impeccable-variant="1"]) { .hook { color: red; } }\`}</style>
  <div data-impeccable-variant="1">
    <section className="hook">
      <span>nested text</span>
    </section>
  </div>
  <div data-impeccable-variant="2" style={{ display: 'none' }}>
    <section className="hook">
      <span>variant two</span>
    </section>
  </div>
  {/* impeccable-variants-end ROOTIND */}
</div>
`;
    writeFileSync(join(tmp, 'Root.tsx'), tsx);

    const result = runAccept(tmp, ['--id', 'ROOTIND', '--variant', '1']);
    assert.equal(result.handled, true, `accept should succeed: ${JSON.stringify(result)}`);

    const after = readFileSync(join(tmp, 'Root.tsx'), 'utf-8');
    assert.match(
      after,
      /<div data-impeccable-variant="1" style=\{\{ display: 'contents' \}\}>\n    <section className="hook">\n      <span>nested text<\/span>\n    <\/section>\n  <\/div>/,
      'column-0 JSX accept preserves relative indentation inside the carbonize variant wrapper',
    );
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

describe('live-accept — Elixir templates under lib/', () => {
  let tmp;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'impeccable-accept-elixir-'));
    mkdirSync(join(tmp, 'lib', 'my_app_web', 'components'), { recursive: true });
  });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('accepts a variant when markers live in a .ex file inside lib/', () => {
    const id = 'elixir01';
    const source = `defmodule MyAppWeb.Layouts do
  def nav(assigns) do
    ~H"""
    <!-- impeccable-variants-start ${id} -->
    <div data-impeccable-variants="${id}" data-impeccable-variant-count="2" style="display: contents">
      <div data-impeccable-variant="original">
        <nav class="nav">before</nav>
      </div>
      <div data-impeccable-variant="1">
        <nav class="nav">after</nav>
      </div>
    </div>
    <!-- impeccable-variants-end ${id} -->
    """
  end
end
`;
    writeFileSync(join(tmp, 'lib', 'my_app_web', 'components', 'layouts.ex'), source);
    const result = runAccept(tmp, ['--id', id, '--variant', '1']);
    assert.equal(result.handled, true, JSON.stringify(result));
    const after = readFileSync(join(tmp, 'lib', 'my_app_web', 'components', 'layouts.ex'), 'utf-8');
    assert.ok(after.includes('>after</nav>'));
    assert.ok(!after.includes('impeccable-variants-start'));
    assert.ok(!after.includes('data-impeccable-variant="original"'));
  });
});
