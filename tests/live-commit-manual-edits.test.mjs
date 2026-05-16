import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
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
  fs.mkdirSync(path.join(tmpDir, 'src'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function entry({ id, pageUrl, ops }) {
  return {
    id,
    pageUrl,
    element: { tagName: 'h1' },
    ops,
    stagedAt: new Date().toISOString(),
  };
}

function runCommit(extraArgs = []) {
  const args = [SCRIPT, ...extraArgs];
  const stdout = execFileSync('node', args, { encoding: 'utf-8', cwd: tmpDir });
  return JSON.parse(stdout.trim());
}

describe('live-commit-manual-edits.mjs', () => {
  it('applies a single op and clears the entry from the buffer', () => {
    const file = path.join(tmpDir, 'src', 'page.html');
    fs.writeFileSync(file, '<div>\n  <h1 class="hero">Welcome</h1>\n</div>\n');
    writeBuffer(tmpDir, {
      entries: [
        entry({
          id: 'e1',
          pageUrl: '/',
          ops: [{ ref: 'div>h1.1', tag: 'h1', classes: ['hero'], originalText: 'Welcome', newText: 'Hello' }],
        }),
      ],
    });

    const result = runCommit();

    assert.equal(result.cleared, true);
    assert.equal(result.applied.length, 1);
    assert.equal(result.failed.length, 0);
    assert.match(fs.readFileSync(file, 'utf-8'), /Hello/);
    assert.equal(readBuffer(tmpDir).entries.length, 0);
  });

  it('preserves only the failed op when an entry has mixed outcomes', () => {
    const file = path.join(tmpDir, 'src', 'page.html');
    fs.writeFileSync(file, '<div>\n  <h1 class="hero">Welcome</h1>\n  <p class="lede">Body copy</p>\n</div>\n');
    writeBuffer(tmpDir, {
      entries: [
        entry({
          id: 'mixed',
          pageUrl: '/',
          ops: [
            // good op
            { ref: 'div>h1.1', tag: 'h1', classes: ['hero'], originalText: 'Welcome', newText: 'Hello' },
            // bad op — originalText not in source
            { ref: 'div>p.1', tag: 'p', classes: ['lede'], originalText: 'Nope', newText: 'X' },
          ],
        }),
      ],
    });

    const result = runCommit();

    assert.equal(result.cleared, false);
    assert.equal(result.applied.length, 1);
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].reason, 'text_not_in_source');

    const buf = readBuffer(tmpDir);
    assert.equal(buf.entries.length, 1, 'failed op stays in buffer');
    assert.equal(buf.entries[0].ops.length, 1);
    assert.equal(buf.entries[0].ops[0].ref, 'div>p.1');
  });

  it('--page-url scopes commit; entries for other pages survive untouched', () => {
    const a = path.join(tmpDir, 'src', 'a.html');
    const b = path.join(tmpDir, 'src', 'b.html');
    fs.writeFileSync(a, '<div>\n  <h1 class="aa">A original</h1>\n</div>\n');
    fs.writeFileSync(b, '<div>\n  <h1 class="bb">B original</h1>\n</div>\n');

    writeBuffer(tmpDir, {
      entries: [
        entry({ id: 'a', pageUrl: '/a', ops: [{ ref: 'div>h1.1', tag: 'h1', classes: ['aa'], originalText: 'A original', newText: 'A new' }] }),
        entry({ id: 'b', pageUrl: '/b', ops: [{ ref: 'div>h1.1', tag: 'h1', classes: ['bb'], originalText: 'B original', newText: 'B new' }] }),
      ],
    });

    const result = runCommit(['--page-url=/a']);

    assert.equal(result.cleared, true);
    assert.match(fs.readFileSync(a, 'utf-8'), /A new/);
    assert.match(fs.readFileSync(b, 'utf-8'), /B original/, 'page /b is untouched');

    const buf = readBuffer(tmpDir);
    assert.equal(buf.entries.length, 1);
    assert.equal(buf.entries[0].pageUrl, '/b');
  });

  it('reports no_pending_edits when buffer is empty', () => {
    const result = runCommit();
    assert.equal(result.reason, 'no_pending_edits');
    assert.equal(result.applied.length, 0);
  });
});
