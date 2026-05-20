import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeBuffer, readBuffer } from '../skill/scripts/live-manual-edits-buffer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(REPO_ROOT, 'skill/scripts/live-commit-manual-edits.mjs');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-test-'));
  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function entry({ id, pageUrl = '/', element = { tagName: 'h1' }, ops }) {
  return {
    id,
    pageUrl,
    element,
    ops,
    stagedAt: '2026-05-19T19:00:23.395Z',
  };
}

function runCommit(extraArgs = [], env = {}) {
  const stdout = execFileSync('node', [SCRIPT, ...extraArgs], {
    encoding: 'utf-8',
    cwd: tmpDir,
    env: {
      ...process.env,
      IMPECCABLE_LIVE_COPY_AGENT: 'mock',
      ...env,
    },
  });
  return JSON.parse(stdout.trim());
}

describe('live-commit-manual-edits.mjs batched AI apply', () => {
  it('batches staged edits and clears successful entries only after AI success', () => {
    fs.writeFileSync(path.join(tmpDir, 'src', 'page.html'), '<h1 class="hero">Hello</h1>\n');
    writeBuffer(tmpDir, {
      entries: [
        entry({
          id: 'e1',
          ops: [{ ref: 'div>h1.1', tag: 'h1', classes: ['hero'], originalText: 'Welcome', newText: 'Hello' }],
        }),
      ],
    });

    const result = runCommit([], {
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_RESULT: JSON.stringify({
        status: 'done',
        appliedEntryIds: ['e1'],
        files: ['src/page.html'],
      }),
    });

    assert.equal(result.count, 1);
    assert.equal(result.cleared, 1);
    assert.equal(result.failed.length, 0);
    assert.deepEqual(result.files, ['src/page.html']);
    assert.equal(readBuffer(tmpDir).entries.length, 0);
    assert.match(fs.readFileSync(path.join(tmpDir, 'src', 'page.html'), 'utf-8'), /Hello/);
  });

  it('keeps failed entries staged when the AI reports partial success', () => {
    fs.writeFileSync(path.join(tmpDir, 'src', 'a.html'), '<h1>A new</h1>\n');
    writeBuffer(tmpDir, {
      entries: [
        entry({ id: 'a', pageUrl: '/a', ops: [{ ref: 'a', tag: 'h1', originalText: 'A original', newText: 'A new' }] }),
        entry({ id: 'b', pageUrl: '/a', ops: [{ ref: 'b', tag: 'h1', originalText: 'B original', newText: 'B new' }] }),
        entry({ id: 'c', pageUrl: '/a', ops: [{ ref: 'c', tag: 'h1', originalText: 'C original', newText: 'C new' }] }),
      ],
    });

    const result = runCommit(['--page-url=/a'], {
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_RESULT: JSON.stringify({
        status: 'partial',
        appliedEntryIds: ['a'],
        failed: [{ entryId: 'b', reason: 'ambiguous duplicate card text' }],
        files: ['src/a.html'],
      }),
    });

    assert.equal(result.cleared, 1);
    assert.equal(result.applied.length, 1);
    assert.equal(result.failed.length, 2);
    assert.deepEqual(result.failed.map((item) => [item.id, item.reason]), [
      ['c', 'not_reported_applied'],
      ['b', 'ambiguous duplicate card text'],
    ]);
    assert.equal(readBuffer(tmpDir).entries.map((item) => item.id).join(','), 'b,c');
  });

  it('treats done without explicit appliedEntryIds as failed and keeps staged entries', () => {
    fs.writeFileSync(path.join(tmpDir, 'src', 'page.html'), '<h1>Hello</h1>\n');
    writeBuffer(tmpDir, {
      entries: [
        entry({ id: 'e1', ops: [{ ref: 'a', tag: 'h1', originalText: 'Welcome', newText: 'Hello' }] }),
      ],
    });

    const result = runCommit([], {
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_RESULT: JSON.stringify({
        status: 'done',
        files: ['src/page.html'],
      }),
    });

    assert.equal(result.cleared, 0);
    assert.equal(result.applied.length, 0);
    assert.equal(result.failed[0].reason, 'missing_applied_entry_ids');
    assert.equal(readBuffer(tmpDir).entries.length, 1);
  });

  it('fails source verification when applied IDs are reported but newText is absent', () => {
    fs.writeFileSync(path.join(tmpDir, 'src', 'page.html'), '<h1 class="hero">Welcome</h1>\n');
    writeBuffer(tmpDir, {
      entries: [
        entry({ id: 'e1', ops: [{ ref: 'a', tag: 'h1', classes: ['hero'], originalText: 'Welcome', newText: 'Hello' }] }),
      ],
    });

    const result = runCommit([], {
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_RESULT: JSON.stringify({
        status: 'done',
        appliedEntryIds: ['e1'],
        files: ['src/page.html'],
      }),
    });

    assert.equal(result.cleared, 0);
    assert.equal(result.applied.length, 0);
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].reason, 'source_verification_failed');
    assert.equal(readBuffer(tmpDir).entries.length, 1);
  });

  it('does not verify success from newText appearing elsewhere in the same file', () => {
    fs.writeFileSync(path.join(tmpDir, 'src', 'page.html'), '<h1 class="hero">Welcome</h1>\n<p>Hello</p>\n');
    writeBuffer(tmpDir, {
      entries: [
        entry({
          id: 'e1',
          ops: [{
            ref: 'body>h1.hero',
            tag: 'h1',
            classes: ['hero'],
            originalText: 'Welcome',
            newText: 'Hello',
            sourceHint: { file: 'src/page.html', line: 1, column: 1 },
          }],
        }),
      ],
    });

    const result = runCommit([], {
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_RESULT: JSON.stringify({
        status: 'done',
        appliedEntryIds: ['e1'],
        files: ['src/page.html'],
      }),
    });

    assert.equal(result.cleared, 0);
    assert.equal(result.applied.length, 0);
    assert.equal(result.failed[0].reason, 'source_verification_failed');
    assert.equal(result.failed[0].failures[0].detail, 'source_hint_still_contains_original_text');
    assert.equal(readBuffer(tmpDir).entries.length, 1);
  });

  it('verifies against reported files before failing a stale source hint window', () => {
    fs.mkdirSync(path.join(tmpDir, 'site/pages'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'site/pages/index.astro'), '<h1 class="hero">Welcome</h1>\n');
    fs.writeFileSync(path.join(tmpDir, 'src/page.html'), '<h1 class="hero">Hello</h1>\n');
    writeBuffer(tmpDir, {
      entries: [
        entry({
          id: 'e1',
          ops: [{
            ref: 'body>h1.hero',
            tag: 'h1',
            classes: ['hero'],
            originalText: 'Welcome',
            newText: 'Hello',
            sourceHint: { file: 'site/pages/index.astro', line: 1, column: 1 },
          }],
        }),
      ],
    });

    const result = runCommit([], {
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_RESULT: JSON.stringify({
        status: 'done',
        appliedEntryIds: ['e1'],
        files: ['src/page.html'],
      }),
    });

    assert.equal(result.cleared, 1);
    assert.equal(result.applied.length, 1);
    assert.equal(result.failed.length, 0);
    assert.equal(readBuffer(tmpDir).entries.length, 0);
  });

  it('fails source verification for legacy empty newText entries instead of treating them as applied', () => {
    fs.writeFileSync(path.join(tmpDir, 'src', 'page.html'), '<h1 class="hero">Welcome</h1>\n');
    writeBuffer(tmpDir, {
      entries: [
        entry({ id: 'empty', ops: [{ ref: 'a', tag: 'h1', classes: ['hero'], originalText: 'Welcome', newText: '' }] }),
      ],
    });

    const result = runCommit([], {
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_RESULT: JSON.stringify({
        status: 'done',
        appliedEntryIds: ['empty'],
        files: ['src/page.html'],
      }),
    });

    assert.equal(result.cleared, 0);
    assert.equal(result.applied.length, 0);
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].reason, 'source_verification_failed');
    assert.equal(result.failed[0].failures[0].detail, 'originalText_still_present_in_plausible_source_location');
    assert.equal(readBuffer(tmpDir).entries.length, 1);
  });

  it('verifies current hero edits against Astro source hints before clearing', () => {
    fs.mkdirSync(path.join(tmpDir, 'site/pages'), { recursive: true });
    const astroPath = path.join(tmpDir, 'site/pages/index.astro');
    const originalHook = "Great design prompts require design vocabulary. Most people don't have it. Impeccable teaches your AI deep design knowledge and gives you 23 commands to steer the result.";
    const writeAstro = ({ title, hook }) => {
      const lines = Array.from({ length: 82 }, () => '');
      lines[67] = `      <h1 class="hero-title-combined">${title}</h1>`;
      lines[70] = `      <p class="hero-hook-text hero-hook-text--full">${hook}</p>`;
      fs.writeFileSync(astroPath, lines.join('\n'));
    };

    writeAstro({ title: 'Impeccable', hook: originalHook });
    writeBuffer(tmpDir, {
      entries: [
        entry({
          id: 'hero-title',
          ops: [{
            ref: 'body>section#hero>h1',
            tag: 'h1',
            classes: ['hero-title-combined'],
            originalText: 'Impeccable',
            newText: 'Impeccable Wow',
            sourceHint: { file: 'site/pages/index.astro', line: 68, column: 39 },
          }],
        }),
        entry({
          id: 'hero-hook',
          ops: [{
            ref: 'body>section#hero>p:nth-of-type(2)',
            tag: 'p',
            classes: ['hero-hook-text', 'hero-hook-text--full'],
            originalText: originalHook,
            newText: 'YESSSSS',
            sourceHint: { file: 'site/pages/index.astro', line: 71, column: 54 },
          }],
        }),
      ],
    });

    const failed = runCommit([], {
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_RESULT: JSON.stringify({
        status: 'done',
        appliedEntryIds: ['hero-title', 'hero-hook'],
        files: ['site/pages/index.astro'],
      }),
    });

    assert.equal(failed.cleared, 0);
    assert.equal(failed.applied.length, 0);
    assert.equal(failed.failed.every((item) => item.reason === 'source_verification_failed'), true);
    assert.equal(readBuffer(tmpDir).entries.length, 2);

    writeAstro({ title: 'Impeccable Wow', hook: 'YESSSSS' });
    const applied = runCommit([], {
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_RESULT: JSON.stringify({
        status: 'done',
        appliedEntryIds: ['hero-title', 'hero-hook'],
        files: ['site/pages/index.astro'],
      }),
    });

    assert.equal(applied.cleared, 2);
    assert.equal(applied.applied.length, 2);
    assert.equal(applied.failed.length, 0);
    assert.equal(readBuffer(tmpDir).entries.length, 0);
  });

  it('keeps all entries staged when the AI runner fails', () => {
    writeBuffer(tmpDir, {
      entries: [
        entry({ id: 'e1', ops: [{ ref: 'a', tag: 'h1', originalText: 'A', newText: 'B' }] }),
      ],
    });

    const result = runCommit([], {
      IMPECCABLE_LIVE_COPY_AGENT: 'off',
    });

    assert.equal(result.cleared, 0);
    assert.equal(result.applied.length, 0);
    assert.equal(result.failed.length, 1);
    assert.match(result.failed[0].reason, /No live copy-edit AI runner found/);
    assert.equal(readBuffer(tmpDir).entries.length, 1);
  });

  it('reports no_pending_edits when buffer is empty', () => {
    const result = runCommit();

    assert.equal(result.reason, 'no_pending_edits');
    assert.equal(result.count, 0);
    assert.equal(result.cleared, 0);
  });

  it('passes repeated card and dynamic data evidence to the batch prompt path', () => {
    fs.mkdirSync(path.join(tmpDir, 'site/scripts/components'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'site/scripts/data.js'),
      "export const skillFocusAreas = [{ area: 'Color & Contrast', detail: 'Accessibility, systems, theming' }, { area: 'Interaction', detail: 'States' }];\n" +
      "export const dimensionGuidelineCounts = { 'Color & Contrast': 29, 'Interaction': 36 };\n"
    );
    fs.writeFileSync(path.join(tmpDir, 'site/scripts/components/foundation-animations.js'),
      "export const foundationAnimations = { 'Color & Contrast': '<svg>color</svg>', 'Interaction': '<svg>interaction</svg>' };\n"
    );
    writeBuffer(tmpDir, {
      entries: [
        entry({
          id: 'cards',
          element: {
            tagName: 'div',
            classes: ['foundation-card'],
            textContent: 'Color & Contrast 29 Accessibility, systems, theming',
          },
          ops: [
            {
              ref: 'body>main>section#foundation>div.foundation-grid>div:nth-of-type(2)>span.foundation-card-label:nth-of-type(1)',
              contextRef: 'body>main>section#foundation>div.foundation-grid>div:nth-of-type(2)',
              tag: 'span',
              classes: ['foundation-card-label'],
              originalText: 'Color & Contrast',
              newText: 'Color!!!',
              sourceHint: { file: 'site/pages/index.astro', loc: '2:3', line: 2, column: 3 },
              nearbyEditableTexts: [{ text: '29' }, { text: 'Accessibility, systems, theming' }],
            },
            {
              ref: 'body>main>section#foundation>div.foundation-grid>div:nth-of-type(3)>span.foundation-card-label:nth-of-type(1)',
              contextRef: 'body>main>section#foundation>div.foundation-grid>div:nth-of-type(3)',
              tag: 'span',
              classes: ['foundation-card-label'],
              originalText: 'Interaction',
              newText: 'Inter !!!',
              nearbyEditableTexts: [{ text: '36' }, { text: 'States' }],
            },
          ],
        }),
      ],
    });

    const result = runCommit([], {
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_RESULT: JSON.stringify({
        status: 'partial',
        appliedEntryIds: [],
        failed: [{ entryId: 'cards', reason: 'ambiguous reference check' }],
        files: [],
      }),
    });

    assert.equal(result.failed.length, 1);
    const candidates = result.failed[0].candidates;
    assert.equal(candidates.some((item) => item.file === 'site/scripts/data.js'), true);
    assert.equal(candidates.some((item) => item.file === 'site/scripts/components/foundation-animations.js'), true);
    assert.equal(readBuffer(tmpDir).entries.length, 1);
  });

  it('fails validation and keeps staged entries when touched JS is invalid or markers remain', () => {
    fs.writeFileSync(path.join(tmpDir, 'src', 'broken.js'), 'const answer = ;\n// impeccable-carbonize-start\n');
    writeBuffer(tmpDir, {
      entries: [
        entry({ id: 'bad', ops: [{ ref: 'a', tag: 'span', originalText: '29', newText: 'XX29' }] }),
      ],
    });

    const result = runCommit([], {
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_RESULT: JSON.stringify({
        status: 'done',
        appliedEntryIds: ['bad'],
        files: ['src/broken.js'],
      }),
    });

    assert.equal(result.cleared, 0);
    assert.equal(result.applied.length, 0);
    assert.equal(
      result.failed.some((item) => item.reason === 'post_apply_validation_failed'),
      true,
    );
    assert.equal(readBuffer(tmpDir).entries.length, 1);
  });

  it('keeps verified source edits staged when post-apply validation fails', () => {
    fs.writeFileSync(path.join(tmpDir, 'src', 'broken.js'), "const label = 'XX29';\nconst answer = ;\n");
    writeBuffer(tmpDir, {
      entries: [
        entry({ id: 'bad', ops: [{ ref: 'a', tag: 'span', originalText: '29', newText: 'XX29' }] }),
      ],
    });

    const result = runCommit([], {
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_RESULT: JSON.stringify({
        status: 'done',
        appliedEntryIds: ['bad'],
        files: ['src/broken.js'],
      }),
    });

    assert.equal(result.cleared, 0);
    assert.equal(result.applied.length, 0);
    assert.equal(result.failed[0].reason, 'post_apply_validation_failed');
    assert.equal(readBuffer(tmpDir).entries.length, 1);
  });

  it('rolls back touched source files when post-apply validation fails', () => {
    const file = path.join(tmpDir, 'src', 'broken.js');
    const before = "const label = 'Old';\n";
    fs.writeFileSync(file, before);
    writeBuffer(tmpDir, {
      entries: [
        entry({ id: 'bad', ops: [{ ref: 'a', tag: 'span', originalText: 'Old', newText: 'New' }] }),
      ],
    });

    const result = runCommit([], {
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_WRITES: JSON.stringify({
        'src/broken.js': "const label = 'New';\nconst answer = ;\n",
      }),
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_RESULT: JSON.stringify({
        status: 'done',
        appliedEntryIds: ['bad'],
        files: ['src/broken.js'],
      }),
    });

    assert.equal(result.cleared, 0);
    assert.equal(result.applied.length, 0);
    assert.equal(result.failed[0].reason, 'post_apply_validation_failed');
    assert.deepEqual(result.rolledBackFiles, ['src/broken.js']);
    assert.deepEqual(result.rollbackFailures, []);
    assert.equal(fs.readFileSync(file, 'utf-8'), before);
    assert.equal(readBuffer(tmpDir).entries.length, 1);
  });
});
