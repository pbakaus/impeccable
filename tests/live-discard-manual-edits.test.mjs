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
const SCRIPT = path.join(REPO_ROOT, 'skill/scripts/live-discard-manual-edits.mjs');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'discard-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function entry({ id, pageUrl, ops }) {
  return { id, pageUrl, element: { tagName: 'p' }, ops, stagedAt: new Date().toISOString() };
}

function op({ ref = 'div>p.1', newText = 'B' } = {}) {
  return { ref, tag: 'p', classes: ['x'], originalText: 'A', newText };
}

function runDiscard(extraArgs = []) {
  const args = [SCRIPT, ...extraArgs];
  const stdout = execFileSync('node', args, { encoding: 'utf-8', cwd: tmpDir });
  return JSON.parse(stdout.trim());
}

describe('live-discard-manual-edits.mjs', () => {
  it('no filter: returns total op count and empties the buffer', () => {
    writeBuffer(tmpDir, {
      entries: [
        entry({ id: 'a', pageUrl: '/a', ops: [op({ ref: 'r1' }), op({ ref: 'r2' })] }),
        entry({ id: 'b', pageUrl: '/b', ops: [op({ ref: 'r3' })] }),
      ],
    });

    const result = runDiscard();

    assert.equal(result.discarded, 3, 'reports ops removed, not entries');
    assert.deepEqual(result.entries.map((item) => item.id), ['a', 'b']);
    assert.equal(result.totalCount, 0);
    assert.equal(readBuffer(tmpDir).entries.length, 0);
  });

  it('--page-url scopes the discard; other pages survive', () => {
    writeBuffer(tmpDir, {
      entries: [
        entry({ id: 'a', pageUrl: '/a', ops: [op({ ref: 'r1' }), op({ ref: 'r2' })] }),
        entry({ id: 'b', pageUrl: '/b', ops: [op({ ref: 'r3' })] }),
      ],
    });

    const result = runDiscard(['--page-url=/a']);

    assert.equal(result.discarded, 2, 'reports ops on /a, not entries');
    assert.deepEqual(result.entries.map((item) => item.id), ['a']);
    assert.equal(result.totalCount, 1);
    const buf = readBuffer(tmpDir);
    assert.equal(buf.entries.length, 1);
    assert.equal(buf.entries[0].pageUrl, '/b');
  });

  it('returns zero when buffer is already empty', () => {
    const result = runDiscard();
    assert.equal(result.discarded, 0);
    assert.equal(result.totalCount, 0);
  });
});
