import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeBuffer, readBuffer } from '../skill/scripts/live-manual-edits-buffer.mjs';
import { buildManualEditEvidence } from '../skill/scripts/live-manual-edit-evidence.mjs';
import { commitManualEdits } from '../skill/scripts/live-commit-manual-edits.mjs';
import {
  buildCopyEditBatchPrompt,
  runCopyEditPostApplyChecks,
} from '../skill/scripts/live-copy-edit-agent.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(REPO_ROOT, 'skill/scripts/live-commit-manual-edits.mjs');
const COMMIT_SOURCE = fs.readFileSync(SCRIPT, 'utf-8');

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
  it('accumulates warnings returned by repair attempts', () => {
    assert.match(
      COMMIT_SOURCE,
      /currentWarnings = \[\.\.\.currentWarnings, \.\.\.\(repairResult\.warnings \|\| \[\]\)\]/,
      'repair agent warnings should be merged into the final manual Apply result instead of being dropped',
    );
  });

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

  it('rolls back when a failed multi-op entry leaves one op in source', () => {
    const file = path.join(tmpDir, 'src', 'page.html');
    const before = [
      '<h1 class="hero">Old title</h1>',
      '<p class="tagline">Original tagline</p>',
      '<p class="hero-hook">Original hook</p>',
      '',
    ].join('\n');
    fs.writeFileSync(file, before);
    writeBuffer(tmpDir, {
      entries: [
        entry({
          id: 'title',
          ops: [{
            ref: 'body>h1.hero',
            tag: 'h1',
            classes: ['hero'],
            originalText: 'Old title',
            newText: 'New title',
            sourceHint: { file: 'src/page.html', line: 1, column: 1 },
          }],
        }),
        entry({
          id: 'combo',
          ops: [
            {
              ref: 'body>p.tagline',
              tag: 'p',
              classes: ['tagline'],
              originalText: 'Original tagline',
              newText: 'New tagline from failed entry',
              sourceHint: { file: 'src/page.html', line: 2, column: 1 },
            },
            {
              ref: 'body>p.hero-hook',
              tag: 'p',
              classes: ['hero-hook'],
              originalText: 'Original hook',
              newText: 'New hook from failed entry',
              sourceHint: { file: 'src/page.html', line: 3, column: 1 },
            },
          ],
        }),
      ],
    });

    const result = runCommit([], {
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_WRITES: JSON.stringify({
        'src/page.html': [
          '<h1 class="hero">New title</h1>',
          '<p class="tagline">New tagline from failed entry</p>',
          '<p class="hero-hook">Original hook</p>',
          '',
        ].join('\n'),
      }),
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_RESULT: JSON.stringify({
        status: 'partial',
        appliedEntryIds: ['title'],
        failed: [{ entryId: 'combo', reason: 'hook source conflict' }],
        files: ['src/page.html'],
      }),
    });

    assert.equal(result.cleared, 0);
    assert.equal(result.applied.length, 0);
    assert.equal(
      result.failed.some((item) => item.id === 'combo' && item.reason === 'failed_entry_source_changed'),
      true,
    );
    assert.equal(
      result.failed.some((item) => item.id === 'title' && item.reason === 'rolled_back_due_to_failed_entry_source_changed'),
      true,
    );
    assert.deepEqual(result.rolledBackFiles, ['src/page.html']);
    assert.equal(fs.readFileSync(file, 'utf-8'), before);
    assert.equal(readBuffer(tmpDir).entries.map((item) => item.id).join(','), 'title,combo');
  });

  it('rolls back when an omitted entry is changed in a reported file', () => {
    const file = path.join(tmpDir, 'src', 'page.html');
    const before = [
      '<h1 class="hero">Old title</h1>',
      '<span class="secondary-action">Learn more</span>',
      '',
    ].join('\n');
    fs.writeFileSync(file, before);
    writeBuffer(tmpDir, {
      entries: [
        entry({
          id: 'title',
          ops: [{
            ref: 'body>h1.hero',
            tag: 'h1',
            classes: ['hero'],
            originalText: 'Old title',
            newText: 'New title',
            sourceHint: { file: 'src/page.html', line: 1, column: 1 },
          }],
        }),
        entry({
          id: 'secondary',
          ops: [{
            ref: 'body>span.secondary-action',
            tag: 'span',
            classes: ['secondary-action'],
            originalText: 'Learn more',
            newText: 'Omitted secondary action',
            sourceHint: { file: 'src/page.html', line: 2, column: 1 },
          }],
        }),
      ],
    });

    const result = runCommit([], {
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_WRITES: JSON.stringify({
        'src/page.html': [
          '<h1 class="hero">New title</h1>',
          '<span class="secondary-action">Omitted secondary action</span>',
          '',
        ].join('\n'),
      }),
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_RESULT: JSON.stringify({
        status: 'done',
        appliedEntryIds: ['title'],
        files: ['src/page.html'],
      }),
    });

    assert.equal(result.cleared, 0);
    assert.equal(result.applied.length, 0);
    assert.equal(
      result.failed.some((item) => item.id === 'secondary' && item.reason === 'failed_entry_source_changed'),
      true,
    );
    assert.equal(
      result.failed.some((item) => item.id === 'title' && item.reason === 'rolled_back_due_to_failed_entry_source_changed'),
      true,
    );
    assert.deepEqual(result.rolledBackFiles, ['src/page.html']);
    assert.equal(fs.readFileSync(file, 'utf-8'), before);
    assert.equal(readBuffer(tmpDir).entries.map((item) => item.id).join(','), 'title,secondary');
  });

  it('treats entries reported as both applied and failed as a malformed result', () => {
    fs.writeFileSync(path.join(tmpDir, 'src', 'a.html'), '<h1>A new</h1>\n');
    writeBuffer(tmpDir, {
      entries: [
        entry({ id: 'a', ops: [{ ref: 'a', tag: 'h1', originalText: 'A original', newText: 'A new' }] }),
      ],
    });

    const result = runCommit([], {
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_RESULT: JSON.stringify({
        status: 'partial',
        appliedEntryIds: ['a'],
        failed: [{ entryId: 'a', reason: 'ambiguous after edit' }],
        files: ['src/a.html'],
      }),
    });

    assert.equal(result.cleared, 0);
    assert.equal(result.applied.length, 0);
    assert.equal(result.failed[0].reason, 'conflicting_apply_result');
    assert.equal(readBuffer(tmpDir).entries.map((item) => item.id).join(','), 'a');
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
    assert.equal(result.reason, 'manual_edit_repair_needs_decision');
    assert.equal(result.failed[0].reason, 'source_verification_failed');
    assert.equal(result.failed[0].checks[0].failures[0].detail, 'source_hint_still_contains_original_text');
    assert.equal(readBuffer(tmpDir).entries.length, 1);
  });

  it('keeps source writes for repair when source verification fails', () => {
    const file = path.join(tmpDir, 'src', 'page.html');
    const before = '<h1 class="hero">Welcome</h1>\n<p>Elsewhere</p>\n';
    fs.writeFileSync(file, before);
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
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_WRITES: JSON.stringify({
        'src/page.html': '<h1 class="hero">Welcome</h1>\n<p>Hello</p>\n',
      }),
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_RESULT: JSON.stringify({
        status: 'done',
        appliedEntryIds: ['e1'],
        files: ['src/page.html'],
      }),
    });

    assert.equal(result.cleared, 0);
    assert.equal(result.applied.length, 0);
    assert.equal(result.reason, 'manual_edit_repair_needs_decision');
    assert.equal(result.failed[0].reason, 'source_verification_failed');
    assert.equal(result.rolledBackFiles, undefined);
    assert.equal(fs.readFileSync(file, 'utf-8'), '<h1 class="hero">Welcome</h1>\n<p>Hello</p>\n');
    assert.equal(readBuffer(tmpDir).entries.length, 1);
  });

  it('verifies copy inside a multi-line element when the source hint points to the opening tag', () => {
    const file = path.join(tmpDir, 'site', 'pages', 'index.astro');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, [
      '<section>',
      '  <p class="hero-rebuild-body">',
      '    Fresh visual vocabulary for teams',
      '    working in production code.',
      '  </p>',
      '</section>',
      '',
    ].join('\n'));
    writeBuffer(tmpDir, {
      entries: [
        entry({
          id: 'p1',
          ops: [{
            ref: 'body>p.hero-rebuild-body',
            tag: 'p',
            classes: ['hero-rebuild-body'],
            originalText: 'Your AI ships generic frontend by default.',
            newText: 'Fresh visual vocabulary for teams working in production code.',
            sourceHint: { file: 'site/pages/index.astro', line: 2, column: 3 },
          }],
        }),
      ],
    });

    const result = runCommit([], {
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_RESULT: JSON.stringify({
        status: 'done',
        appliedEntryIds: ['p1'],
        files: ['site/pages/index.astro'],
      }),
    });

    assert.equal(result.cleared, 1);
    assert.equal(result.applied.length, 1);
    assert.equal(readBuffer(tmpDir).entries.length, 0);
  });

  it('deduplicates failed entries across repeated repair attempts', async () => {
    const file = path.join(tmpDir, 'src', 'page.html');
    fs.writeFileSync(file, '<h1 class="hero">Welcome</h1>\n');
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
    let calls = 0;

    const result = await commitManualEdits({
      cwd: tmpDir,
      provider: 'chat',
      env: { IMPECCABLE_LIVE_MANUAL_EDIT_REPAIR_ATTEMPTS: '2' },
      applyBatchToSource: async (_batch, { repair } = {}) => {
        calls += 1;
        if (!repair) {
          return {
            status: 'done',
            appliedEntryIds: ['e1'],
            failed: [],
            files: ['src/page.html'],
          };
        }
        return {
          status: 'partial',
          appliedEntryIds: [],
          failed: [{ entryId: 'e1', reason: 'still cannot verify source' }],
          files: ['src/page.html'],
        };
      },
    });

    assert.equal(calls, 3);
    assert.equal(result.reason, 'manual_edit_repair_needs_decision');
    assert.deepEqual(result.failed.map((item) => item.id), ['e1']);
    assert.equal(readBuffer(tmpDir).entries.length, 1);
  });

  it('does not roll back unrelated project changes made during Apply', () => {
    const pageFile = path.join(tmpDir, 'src', 'page.html');
    const notesFile = path.join(tmpDir, 'src', 'notes.html');
    const beforePage = '<h1 class="hero">Welcome</h1>\n';
    const beforeNotes = '<p>Do not touch</p>\n';
    fs.writeFileSync(pageFile, beforePage);
    fs.writeFileSync(notesFile, beforeNotes);
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
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_WRITES: JSON.stringify({
        'src/page.html': '<h1 class="hero">Hello</h1>\n',
        'src/notes.html': '<p>User changed this while Apply was running</p>\n',
      }),
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_RESULT: JSON.stringify({
        status: 'done',
        appliedEntryIds: ['e1'],
        files: ['src/page.html'],
      }),
    });

    assert.equal(result.cleared, 1);
    assert.equal(result.applied.length, 1);
    assert.equal(result.failed.length, 0);
    assert.equal(result.unreportedFiles, undefined);
    assert.equal(fs.readFileSync(pageFile, 'utf-8'), '<h1 class="hero">Hello</h1>\n');
    assert.equal(fs.readFileSync(notesFile, 'utf-8'), '<p>User changed this while Apply was running</p>\n');
    assert.equal(readBuffer(tmpDir).entries.length, 0);
  });

  it('fails instead of clearing when Apply changes an unreported Apply-owned source file', () => {
    const pageFile = path.join(tmpDir, 'src', 'page.html');
    const notesFile = path.join(tmpDir, 'src', 'notes.html');
    const beforePage = '<h1 class="hero">Welcome</h1>\n';
    const beforeNotes = '<h1 class="hero">Welcome</h1>\n';
    fs.writeFileSync(pageFile, beforePage);
    fs.writeFileSync(notesFile, beforeNotes);
    writeBuffer(tmpDir, {
      entries: [
        entry({
          id: 'e1',
          ops: [{
            ref: 'body>h1.hero:nth-of-type(1)',
            tag: 'h1',
            classes: ['hero'],
            originalText: 'Welcome',
            newText: 'Hello',
            sourceHint: { file: 'src/notes.html', line: 1, column: 1 },
          }],
        }),
      ],
    });

    const result = runCommit([], {
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_WRITES: JSON.stringify({
        'src/page.html': '<h1 class="hero">Hello</h1>\n',
        'src/notes.html': '<h1 class="hero">Hello</h1>\n',
      }),
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_RESULT: JSON.stringify({
        status: 'done',
        appliedEntryIds: ['e1'],
        files: ['src/page.html'],
      }),
    });

    assert.equal(result.cleared, 0);
    assert.equal(result.applied.length, 0);
    assert.equal(result.failed[0].reason, 'unreported_source_changes');
    assert.deepEqual(result.unreportedFiles, ['src/notes.html']);
    assert.deepEqual(new Set(result.rolledBackFiles), new Set(['src/page.html', 'src/notes.html']));
    assert.equal(fs.readFileSync(pageFile, 'utf-8'), beforePage);
    assert.equal(fs.readFileSync(notesFile, 'utf-8'), beforeNotes);
    assert.equal(readBuffer(tmpDir).entries.length, 1);
  });

  it('does not delete pre-existing reported files that were outside the rollback snapshot', () => {
    const pageFile = path.join(tmpDir, 'src', 'page.html');
    const extraFile = path.join(tmpDir, 'src', 'extra.html');
    const beforePage = '<h1 class="hero">Welcome</h1>\n';
    fs.writeFileSync(pageFile, beforePage);
    fs.writeFileSync(extraFile, '<p>Existing file</p>\n');
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
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_WRITES: JSON.stringify({
        'src/page.html': '<h1 class="hero">Hello</h1>\n',
        'src/extra.html': '<p>Existing file changed outside snapshot</p>\n',
      }),
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_RESULT: JSON.stringify({
        status: 'error',
        message: 'agent failed after editing',
        files: ['src/page.html', 'src/extra.html'],
      }),
    });

    assert.equal(result.cleared, 0);
    assert.deepEqual(result.rolledBackFiles, ['src/page.html']);
    assert.equal(fs.existsSync(extraFile), true);
    assert.equal(fs.readFileSync(pageFile, 'utf-8'), beforePage);
    assert.equal(fs.readFileSync(extraFile, 'utf-8'), '<p>Existing file changed outside snapshot</p>\n');
    assert.equal(result.rollbackFailures.some((item) => item.file === 'src/extra.html' && item.reason === 'no_snapshot'), true);
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
    assert.equal(result.reason, 'manual_edit_repair_needs_decision');
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].reason, 'source_verification_failed');
    assert.equal(result.failed[0].checks[0].failures[0].detail, 'originalText_still_present_in_plausible_source_location');
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
    assert.match(result.failed[0].reason, /No live copy-edit AI runner is available/);
    assert.equal(readBuffer(tmpDir).entries.length, 1);
  });

  it('rolls back source writes when the AI runner throws after writing', () => {
    const file = path.join(tmpDir, 'src', 'page.html');
    const before = '<h1>Old</h1>\n';
    fs.writeFileSync(file, before);
    writeBuffer(tmpDir, {
      entries: [
        entry({ id: 'e1', ops: [{ ref: 'a', tag: 'h1', originalText: 'Old', newText: 'New' }] }),
      ],
    });

    const result = runCommit([], {
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_WRITES: JSON.stringify({
        'src/page.html': '<h1>New</h1>\n',
      }),
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_RESULT: '{not json',
    });

    assert.equal(result.cleared, 0);
    assert.equal(result.applied.length, 0);
    assert.match(result.failed[0].reason, /Invalid IMPECCABLE_LIVE_COPY_AGENT_MOCK_RESULT JSON/);
    assert.deepEqual(result.rolledBackFiles, ['src/page.html']);
    assert.deepEqual(result.rollbackFailures, []);
    assert.equal(fs.readFileSync(file, 'utf-8'), before);
    assert.equal(readBuffer(tmpDir).entries.length, 1);
  });

  it('rolls back source writes when the AI reports an error', () => {
    const file = path.join(tmpDir, 'src', 'page.html');
    const before = '<h1>Old</h1>\n';
    fs.writeFileSync(file, before);
    writeBuffer(tmpDir, {
      entries: [
        entry({ id: 'e1', ops: [{ ref: 'a', tag: 'h1', originalText: 'Old', newText: 'New' }] }),
      ],
    });

    const result = runCommit([], {
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_WRITES: JSON.stringify({
        'src/page.html': '<h1>New</h1>\n',
      }),
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_RESULT: JSON.stringify({
        status: 'error',
        message: 'could not apply safely',
        failed: [{ entryId: 'e1', reason: 'ambiguous' }],
        files: ['src/page.html'],
      }),
    });

    assert.equal(result.cleared, 0);
    assert.equal(result.applied.length, 0);
    assert.equal(result.failed[0].reason, 'ambiguous');
    assert.deepEqual(result.rolledBackFiles, ['src/page.html']);
    assert.deepEqual(result.rollbackFailures, []);
    assert.equal(fs.readFileSync(file, 'utf-8'), before);
    assert.equal(readBuffer(tmpDir).entries.length, 1);
  });

  it('marks every staged entry failed when the AI reports error without per-entry failures', () => {
    writeBuffer(tmpDir, {
      entries: [
        entry({ id: 'e1', ops: [{ ref: 'a', tag: 'h1', originalText: 'Old', newText: 'New' }] }),
        entry({ id: 'e2', ops: [{ ref: 'b', tag: 'p', originalText: 'Before', newText: 'After' }] }),
      ],
    });

    const result = runCommit([], {
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_RESULT: JSON.stringify({
        status: 'error',
        message: 'could not apply safely',
        files: [],
      }),
    });

    assert.equal(result.cleared, 0);
    assert.deepEqual(result.failed.map((item) => [item.id, item.reason]), [
      ['e1', 'could not apply safely'],
      ['e2', 'could not apply safely'],
    ]);
    assert.equal(readBuffer(tmpDir).entries.length, 2);
  });

  it('reports no_pending_edits when buffer is empty', () => {
    const result = runCommit();

    assert.equal(result.reason, 'no_pending_edits');
    assert.equal(result.count, 0);
    assert.equal(result.cleared, 0);
  });

  it('reports a corrupt pending buffer instead of treating it as empty', () => {
    const bufferPath = path.join(tmpDir, '.impeccable', 'live', 'pending-manual-edits.json');
    fs.mkdirSync(path.dirname(bufferPath), { recursive: true });
    fs.writeFileSync(bufferPath, '{ not valid json');

    const result = runCommit();

    assert.equal(result.reason, 'manual_edit_buffer_invalid');
    assert.match(result.message, /manual_edit_buffer_unreadable/);
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

  it('caps weak literal and locator evidence so manual Apply payloads stay compact', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'page.jsx'),
      Array.from({ length: 30 }, (_, index) => `<span className="metric">${index % 2 === 0 ? '33' : '44'}</span>`).join('\n') + '\n',
    );
    writeBuffer(tmpDir, {
      entries: [
        entry({
          id: 'weak-number',
          element: { tagName: 'span', classes: ['metric'], textContent: '33' },
          ops: [{
            ref: 'body>span.metric:nth-of-type(1)',
            tag: 'span',
            classes: ['metric'],
            originalText: '33',
            newText: '0033',
          }],
        }),
      ],
    });

    const evidence = buildManualEditEvidence({ cwd: tmpDir, pageUrl: '/' });
    const candidate = evidence.candidates[0];
    assert.ok(candidate.textMatches.length <= 4, 'short numeric text matches should be capped aggressively');
    assert.ok(candidate.locatorMatches.length <= 4, 'broad locator matches should not dominate chat payloads');
  });

  it('verifies coupled label and count edits through same-entry dynamic data evidence', () => {
    fs.mkdirSync(path.join(tmpDir, 'site/scripts/components'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'site/scripts/data.js'),
      "export const skillFocusAreas = [{ area: 'Responsive', detail: 'Fluid layouts, touch targets' }];\n" +
      "export const dimensionGuidelineCounts = { 'Responsive': 23 };\n"
    );
    fs.writeFileSync(path.join(tmpDir, 'site/scripts/components/foundation-animations.js'),
      "export const foundationAnimations = { 'Responsive': '<svg>responsive</svg>' };\n"
    );
    writeBuffer(tmpDir, {
      entries: [
        entry({
          id: 'card',
          element: {
            tagName: 'div',
            classes: ['foundation-card'],
            textContent: 'Responsive 23 Fluid layouts, touch targets',
          },
          ops: [
            {
              ref: 'body>main>section#foundation>div.foundation-grid>div:nth-of-type(4)>span.foundation-card-label:nth-of-type(1)',
              contextRef: 'body>main>section#foundation>div.foundation-grid>div:nth-of-type(4)',
              tag: 'span',
              classes: ['foundation-card-label'],
              originalText: 'Responsive',
              newText: 'ResXXX',
              nearbyEditableTexts: [{ text: '23' }, { text: 'Fluid layouts, touch targets' }],
            },
            {
              ref: 'body>main>section#foundation>div.foundation-grid>div:nth-of-type(4)>span.foundation-card-count:nth-of-type(2)',
              contextRef: 'body>main>section#foundation>div.foundation-grid>div:nth-of-type(4)',
              tag: 'span',
              classes: ['foundation-card-count'],
              originalText: '23',
              newText: '42',
              nearbyEditableTexts: [{ text: 'Responsive' }, { text: 'Fluid layouts, touch targets' }],
            },
          ],
        }),
      ],
    });

    const result = runCommit([], {
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_WRITES: JSON.stringify({
        'site/scripts/data.js':
          "export const skillFocusAreas = [{ area: 'ResXXX', detail: 'Fluid layouts, touch targets' }];\n" +
          "export const dimensionGuidelineCounts = { 'ResXXX': 42 };\n",
        'site/scripts/components/foundation-animations.js':
          "export const foundationAnimations = { 'ResXXX': '<svg>responsive</svg>' };\n",
      }),
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_RESULT: JSON.stringify({
        status: 'done',
        appliedEntryIds: ['card'],
        files: ['site/scripts/data.js', 'site/scripts/components/foundation-animations.js'],
      }),
    });

    assert.equal(result.cleared, 2);
    assert.equal(result.applied.length, 2);
    assert.equal(result.failed.length, 0);
    assert.deepEqual(result.rolledBackFiles, undefined);
    assert.equal(readBuffer(tmpDir).entries.length, 0);
  });

  it('verifies standalone integer count edits from nearby dynamic data context', () => {
    fs.mkdirSync(path.join(tmpDir, 'site/scripts'), { recursive: true });
    const noisyCounts = Array.from({ length: 24 }, (_, index) => `  'noise-${index}': 23,`).join('\n');
    const before =
      "export const unrelatedCounts = {\n" +
      noisyCounts + "\n" +
      "};\n" +
      "export const skillFocusAreas = [{ area: 'Responsive', detail: 'Fluid layouts, touch targets' }];\n" +
      "export const repeatedMentions = ['Responsive', 'Responsive', 'Responsive', 'Responsive'];\n" +
      "export const dimensionGuidelineCounts = {\n" +
      "  'Responsive': 23,\n" +
      "};\n";
    fs.writeFileSync(path.join(tmpDir, 'site/scripts/data.js'), before);
    writeBuffer(tmpDir, {
      entries: [
        entry({
          id: 'count',
          element: {
            tagName: 'div',
            classes: ['foundation-card'],
            textContent: 'Responsive 23 Fluid layouts, touch targets',
          },
          ops: [
            {
              ref: 'body>main>section#foundation>div.foundation-grid>div:nth-of-type(4)>span.foundation-card-count:nth-of-type(2)',
              contextRef: 'body>main>section#foundation>div.foundation-grid>div:nth-of-type(4)',
              tag: 'span',
              classes: ['foundation-card-count'],
              originalText: '23',
              newText: '47',
              nearbyEditableTexts: [{ text: 'Responsive' }, { text: 'Fluid layouts, touch targets' }],
            },
          ],
        }),
      ],
    });

    const result = runCommit([], {
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_WRITES: JSON.stringify({
        'site/scripts/data.js':
          "export const unrelatedCounts = {\n" +
          noisyCounts + "\n" +
          "};\n" +
          "export const skillFocusAreas = [{ area: 'Responsive', detail: 'Fluid layouts, touch targets' }];\n" +
          "export const repeatedMentions = ['Responsive', 'Responsive', 'Responsive', 'Responsive'];\n" +
          "export const dimensionGuidelineCounts = {\n" +
          "  'Responsive': 47,\n" +
          "};\n",
      }),
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_RESULT: JSON.stringify({
        status: 'done',
        appliedEntryIds: ['count'],
        files: ['site/scripts/data.js'],
      }),
    });

    assert.equal(result.cleared, 1);
    assert.equal(result.applied.length, 1);
    assert.equal(result.failed.length, 0);
    assert.equal(readBuffer(tmpDir).entries.length, 0);
  });

  it('allows non-numeric count display copy when integer source data stays typed', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      scripts: {
        'impeccable:manual-edit-validate': 'node src/validate.mjs',
      },
    }, null, 2));
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'stats.mjs'),
      "export const stats = { count: 7 };\n",
    );
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'validate.mjs'),
      [
        "import { stats } from './stats.mjs';",
        "if (!Number.isInteger(stats.count)) throw new Error('stats.count must stay integer');",
        "if (stats.countLabel !== '7 seats') throw new Error('stats.countLabel must carry display copy');",
        '',
      ].join('\n'),
    );
    writeBuffer(tmpDir, {
      entries: [
        entry({
          id: 'typed-count',
          element: { tagName: 'span', classes: ['stat-count'], textContent: '7' },
          ops: [{
            ref: 'body>main>span.stat-count',
            tag: 'span',
            classes: ['stat-count'],
            originalText: '7',
            newText: '7 seats',
            sourceHint: { file: 'src/stats.mjs', line: 1, column: 31 },
          }],
        }),
      ],
    });

    const result = runCommit([], {
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_WRITES: JSON.stringify({
        'src/stats.mjs': "export const stats = { count: 7, countLabel: '7 seats' };\n",
      }),
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_RESULT: JSON.stringify({
        status: 'done',
        appliedEntryIds: ['typed-count'],
        files: ['src/stats.mjs'],
      }),
    });

    assert.equal(result.cleared, 1);
    assert.equal(result.applied.length, 1);
    assert.equal(result.failed.length, 0);
    assert.equal(fs.readFileSync(path.join(tmpDir, 'src', 'stats.mjs'), 'utf-8'), "export const stats = { count: 7, countLabel: '7 seats' };\n");
    assert.equal(readBuffer(tmpDir).entries.length, 0);
  });

  it('keeps source for repair when Apply coerces an integer source model into display text that crashes validation', () => {
    const statsFile = path.join(tmpDir, 'src', 'stats.mjs');
    const before = "export const stats = { count: 7 };\n";
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      scripts: {
        'impeccable:manual-edit-validate': 'node src/validate.mjs',
      },
    }, null, 2));
    fs.writeFileSync(statsFile, before);
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'validate.mjs'),
      [
        "import { stats } from './stats.mjs';",
        "if (!Number.isInteger(stats.count)) throw new Error('stats.count must stay integer');",
        '',
      ].join('\n'),
    );
    writeBuffer(tmpDir, {
      entries: [
        entry({
          id: 'typed-count',
          element: { tagName: 'span', classes: ['stat-count'], textContent: '7' },
          ops: [{
            ref: 'body>main>span.stat-count',
            tag: 'span',
            classes: ['stat-count'],
            originalText: '7',
            newText: '7 seats',
            sourceHint: { file: 'src/stats.mjs', line: 1, column: 31 },
          }],
        }),
      ],
    });

    const result = runCommit([], {
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_WRITES: JSON.stringify({
        'src/stats.mjs': "export const stats = { count: '7 seats' };\n",
      }),
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_RESULT: JSON.stringify({
        status: 'done',
        appliedEntryIds: ['typed-count'],
        files: ['src/stats.mjs'],
      }),
    });

    assert.equal(result.cleared, 0);
    assert.equal(result.applied.length, 0);
    assert.equal(result.reason, 'manual_edit_repair_needs_decision');
    assert.equal(result.failed[0].reason, 'post_apply_validation_failed');
    assert.equal(result.failed[0].checks.some((check) => check.reason === 'manual_edit_validation_failed'), true);
    assert.match(result.failed[0].checks.find((check) => check.reason === 'manual_edit_validation_failed').message, /stats\.count must stay integer/);
    assert.equal(result.rolledBackFiles, undefined);
    assert.equal(fs.readFileSync(statsFile, 'utf-8'), "export const stats = { count: '7 seats' };\n");
    assert.equal(readBuffer(tmpDir).entries.map((item) => item.id).join(','), 'typed-count');
  });

  it('fails validation and keeps staged entries when touched JS is invalid or markers remain', () => {
    fs.writeFileSync(path.join(tmpDir, 'src', 'broken.js'), "const label = 'XX29';\nconst answer = ;\n// impeccable-carbonize-start\n");
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

  it('keeps invalid touched JSON for repair before clearing staged edits', () => {
    const file = path.join(tmpDir, 'src', 'data.json');
    const before = '{"title":"Old"}\n';
    fs.writeFileSync(file, before);
    writeBuffer(tmpDir, {
      entries: [
        entry({ id: 'json', ops: [{ ref: 'a', tag: 'span', originalText: 'Old', newText: 'New', sourceHint: { file: 'src/data.json', line: 1 } }] }),
      ],
    });

    const result = runCommit([], {
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_WRITES: JSON.stringify({
        'src/data.json': '{"title":"New",}\n',
      }),
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_RESULT: JSON.stringify({
        status: 'done',
        appliedEntryIds: ['json'],
        files: ['src/data.json'],
      }),
    });

    assert.equal(result.cleared, 0);
    assert.equal(result.applied.length, 0);
    assert.equal(result.reason, 'manual_edit_repair_needs_decision');
    assert.equal(result.failed[0].reason, 'post_apply_validation_failed');
    assert.equal(result.failed[0].checks.some((check) => check.reason === 'invalid_json'), true);
    assert.equal(result.rolledBackFiles, undefined);
    assert.equal(fs.readFileSync(file, 'utf-8'), '{"title":"New",}\n');
    assert.equal(readBuffer(tmpDir).entries.length, 1);
  });

  it('keeps invalid touched CJS for repair before clearing staged edits', () => {
    const file = path.join(tmpDir, 'src', 'config.cjs');
    const before = "module.exports = { title: 'Old' };\n";
    fs.writeFileSync(file, before);
    writeBuffer(tmpDir, {
      entries: [
        entry({ id: 'cjs', ops: [{ ref: 'a', tag: 'span', originalText: 'Old', newText: 'New', sourceHint: { file: 'src/config.cjs', line: 1 } }] }),
      ],
    });

    const result = runCommit([], {
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_WRITES: JSON.stringify({
        'src/config.cjs': "module.exports = { title: 'New', broken: };\n",
      }),
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_RESULT: JSON.stringify({
        status: 'done',
        appliedEntryIds: ['cjs'],
        files: ['src/config.cjs'],
      }),
    });

    assert.equal(result.cleared, 0);
    assert.equal(result.applied.length, 0);
    assert.equal(result.reason, 'manual_edit_repair_needs_decision');
    assert.equal(result.failed[0].reason, 'post_apply_validation_failed');
    assert.equal(result.failed[0].checks.some((check) => check.reason === 'invalid_js'), true);
    assert.equal(result.rolledBackFiles, undefined);
    assert.equal(fs.readFileSync(file, 'utf-8'), "module.exports = { title: 'New', broken: };\n");
    assert.equal(readBuffer(tmpDir).entries.length, 1);
  });

  it('strips live edit runtime attributes from the copy-edit prompt context', () => {
    const decoratedHtml = '<section><h1 class="hero" contenteditable="true" data-impeccable-editable="true" data-impeccable-original-text="Original" style="user-select: text; cursor: text; outline: none; -webkit-user-modify: read-write-plaintext-only;">Edited</h1></section>';
    const prompt = buildCopyEditBatchPrompt({
      pageUrl: '/',
      entries: [
        entry({
          id: 'clean',
          element: { tagName: 'section', outerHTML: decoratedHtml, textContent: 'Edited' },
          ops: [{
            entryId: 'clean',
            ref: 'body>section>h1:nth-of-type(1)',
            tag: 'h1',
            originalText: 'Original',
            newText: 'Edited',
            leaf: { tagName: 'h1', outerHTML: decoratedHtml, textContent: 'Edited' },
            container: { tagName: 'section', outerHTML: decoratedHtml, textContent: 'Edited' },
          }],
        }),
      ],
      candidates: [],
    }, { cwd: tmpDir });

    assert.match(prompt, /replace only the target text node or source string literal/);
    assert.match(prompt, /do not reformat surrounding markup, indentation, attributes, blank lines, or unrelated whitespace/);
    assert.match(prompt, /Missing sourceHint is not a failure/);
    assert.match(prompt, /objectKeyMatches/);
    assert.match(prompt, /data object or mapped list item/);
    const serializedBatch = prompt.split('Staged copy-edit batch:\n').pop();
    assert.doesNotMatch(serializedBatch, /data-impeccable-original-text|data-impeccable-editable|contenteditable|-webkit-user-modify/);
    assert.match(serializedBatch, /Edited/);
  });

  it('fails post-apply validation when live edit runtime attributes leak into source', () => {
    fs.writeFileSync(path.join(tmpDir, 'src', 'page.astro'), '<h1 class="hero" data-impeccable-original-text="Original">Edited</h1>\n');

    const checks = runCopyEditPostApplyChecks({ cwd: tmpDir, files: ['src/page.astro'] });

    assert.equal(checks.ok, false);
    assert.equal(checks.failures[0].reason, 'leftover_impeccable_marker');
    assert.match(checks.failures[0].marker, /data-impeccable-original-text/);
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

  it('keeps touched source files when post-apply validation needs repair', () => {
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
    assert.equal(result.reason, 'manual_edit_repair_needs_decision');
    assert.equal(result.failed[0].reason, 'post_apply_validation_failed');
    assert.equal(result.rolledBackFiles, undefined);
    assert.equal(fs.readFileSync(file, 'utf-8'), "const label = 'New';\nconst answer = ;\n");
    assert.equal(readBuffer(tmpDir).entries.length, 1);
  });

  it('keeps source for repair when Apply leaks edit-mode contenteditable attributes into source', () => {
    const file = path.join(tmpDir, 'src', 'App.jsx');
    const before = 'export default function App() { return <h1 className="hero">Old</h1>; }\n';
    fs.writeFileSync(file, before);
    writeBuffer(tmpDir, {
      entries: [
        entry({
          id: 'edit-ui',
          ops: [{ ref: 'body>h1.hero', tag: 'h1', classes: ['hero'], originalText: 'Old', newText: 'Old New' }],
        }),
      ],
    });

    const result = runCommit([], {
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_WRITES: JSON.stringify({
        'src/App.jsx': 'export default function App() { return <h1 className="hero" contenteditable="true" data-impeccable-editable="true" data-impeccable-original-text="Old">Old New</h1>; }\n',
      }),
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_RESULT: JSON.stringify({
        status: 'done',
        appliedEntryIds: ['edit-ui'],
        files: ['src/App.jsx'],
      }),
    });

    assert.equal(result.cleared, 0);
    assert.equal(result.applied.length, 0);
    assert.equal(result.reason, 'manual_edit_repair_needs_decision');
    assert.equal(result.failed[0].reason, 'post_apply_validation_failed');
    assert.equal(result.failed[0].checks.some((check) => /data-impeccable-(editable|original-text)/.test(check.marker)), true);
    assert.equal(result.rolledBackFiles, undefined);
    assert.match(fs.readFileSync(file, 'utf-8'), /contenteditable="true"/);
    assert.equal(readBuffer(tmpDir).entries.map((item) => item.id).join(','), 'edit-ui');
  });

  it('keeps source for repair when Apply leaves carbonize or variant scaffolding in source', () => {
    const file = path.join(tmpDir, 'src', 'page.html');
    const before = '<h1 class="hero">Old</h1>\n';
    fs.writeFileSync(file, before);
    writeBuffer(tmpDir, {
      entries: [
        entry({
          id: 'variant-scaffold',
          ops: [{ ref: 'body>h1.hero', tag: 'h1', classes: ['hero'], originalText: 'Old', newText: 'New' }],
        }),
      ],
    });

    const result = runCommit([], {
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_WRITES: JSON.stringify({
        'src/page.html': [
          '<!-- impeccable-carbonize-start deadbeef -->',
          '<div data-impeccable-variants="deadbeef" data-impeccable-variant-count="3">',
          '  <div data-impeccable-variant="original"><h1 class="hero">New</h1></div>',
          '</div>',
          '<!-- impeccable-carbonize-end deadbeef -->',
          '',
        ].join('\n'),
      }),
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_RESULT: JSON.stringify({
        status: 'done',
        appliedEntryIds: ['variant-scaffold'],
        files: ['src/page.html'],
      }),
    });

    assert.equal(result.cleared, 0);
    assert.equal(result.applied.length, 0);
    assert.equal(result.reason, 'manual_edit_repair_needs_decision');
    assert.equal(result.failed[0].reason, 'post_apply_validation_failed');
    assert.equal(
      result.failed[0].checks.some((check) => /impeccable-carbonize-start|data-impeccable-variant/.test(check.marker)),
      true,
    );
    assert.equal(result.rolledBackFiles, undefined);
    assert.match(fs.readFileSync(file, 'utf-8'), /impeccable-carbonize-start/);
    assert.equal(readBuffer(tmpDir).entries.map((item) => item.id).join(','), 'variant-scaffold');
  });

  it('keeps the whole batch for repair when one applied edit leaves UI scaffolding behind', () => {
    const pageFile = path.join(tmpDir, 'src', 'page.html');
    const cardFile = path.join(tmpDir, 'src', 'card.html');
    const beforePage = '<h1 class="hero">Old title</h1>\n';
    const beforeCard = '<article class="card">Old card</article>\n';
    fs.writeFileSync(pageFile, beforePage);
    fs.writeFileSync(cardFile, beforeCard);
    writeBuffer(tmpDir, {
      entries: [
        entry({
          id: 'title',
          ops: [{ ref: 'body>h1.hero', tag: 'h1', classes: ['hero'], originalText: 'Old title', newText: 'New title' }],
        }),
        entry({
          id: 'card',
          ops: [{ ref: 'body>article.card', tag: 'article', classes: ['card'], originalText: 'Old card', newText: 'New card' }],
        }),
      ],
    });

    const result = runCommit([], {
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_WRITES: JSON.stringify({
        'src/page.html': '<h1 class="hero">New title</h1>\n',
        'src/card.html': '<article class="card"><span data-impeccable-text-wrap="true">New card</span></article>\n',
      }),
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_RESULT: JSON.stringify({
        status: 'done',
        appliedEntryIds: ['title', 'card'],
        files: ['src/page.html', 'src/card.html'],
      }),
    });

    assert.equal(result.cleared, 0);
    assert.equal(result.applied.length, 0);
    assert.equal(result.reason, 'manual_edit_repair_needs_decision');
    assert.deepEqual(result.failed.map((item) => item.reason), [
      'post_apply_validation_failed',
      'post_apply_validation_failed',
    ]);
    assert.equal(result.failed[0].checks.some((check) => /data-impeccable-text-wrap/.test(check.marker)), true);
    assert.equal(result.rolledBackFiles, undefined);
    assert.equal(fs.readFileSync(pageFile, 'utf-8'), '<h1 class="hero">New title</h1>\n');
    assert.match(fs.readFileSync(cardFile, 'utf-8'), /data-impeccable-text-wrap/);
    assert.deepEqual(readBuffer(tmpDir).entries.map((item) => item.id), ['title', 'card']);
  });

  it('keeps newly created files for repair when post-apply validation fails', () => {
    const pageFile = path.join(tmpDir, 'src', 'page.html');
    const newFile = path.join(tmpDir, 'src', 'new-broken.js');
    const before = '<h1 class="hero">Old</h1>\n';
    fs.writeFileSync(pageFile, before);
    writeBuffer(tmpDir, {
      entries: [
        entry({ id: 'e1', ops: [{ ref: 'a', tag: 'h1', classes: ['hero'], originalText: 'Old', newText: 'New' }] }),
      ],
    });

    const result = runCommit([], {
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_WRITES: JSON.stringify({
        'src/page.html': '<h1 class="hero">New</h1>\n',
        'src/new-broken.js': 'const answer = ;\n',
      }),
      IMPECCABLE_LIVE_COPY_AGENT_MOCK_RESULT: JSON.stringify({
        status: 'done',
        appliedEntryIds: ['e1'],
        files: ['src/page.html', 'src/new-broken.js'],
      }),
    });

    assert.equal(result.cleared, 0);
    assert.equal(result.applied.length, 0);
    assert.equal(result.reason, 'manual_edit_repair_needs_decision');
    assert.equal(result.failed[0].reason, 'post_apply_validation_failed');
    assert.equal(result.rolledBackFiles, undefined);
    assert.equal(fs.readFileSync(pageFile, 'utf-8'), '<h1 class="hero">New</h1>\n');
    assert.equal(fs.existsSync(newFile), true);
    assert.equal(readBuffer(tmpDir).entries.length, 1);
  });
});
