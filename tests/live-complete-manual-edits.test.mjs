import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeBuffer, readBuffer } from '../skill/scripts/live-manual-edits-buffer.mjs';
import { getManualEditHandoffPath } from '../skill/scripts/live-manual-edit-handoff.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(REPO_ROOT, 'skill/scripts/live-complete-manual-edits.mjs');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'complete-manual-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function op(ref, text = 'A') {
  return { ref, tag: 'p', classes: ['copy'], originalText: text, newText: text + '!' };
}

function runComplete(extraArgs = []) {
  const stdout = execFileSync('node', [SCRIPT, ...extraArgs], { cwd: tmpDir, encoding: 'utf-8' });
  return JSON.parse(stdout.trim());
}

describe('live-complete-manual-edits.mjs', () => {
  it('clears only ops represented by the handoff', () => {
    writeBuffer(tmpDir, {
      entries: [
        { id: 'a', pageUrl: '/', element: {}, ops: [op('r1'), op('r2')], stagedAt: 'now' },
        { id: 'b', pageUrl: '/other', element: {}, ops: [op('r1', 'B')], stagedAt: 'now' },
      ],
    });
    const handoffPath = getManualEditHandoffPath(tmpDir, 'feedface0005');
    fs.mkdirSync(path.dirname(handoffPath), { recursive: true });
    fs.writeFileSync(handoffPath, JSON.stringify({
      version: 1,
      handoffId: 'feedface0005',
      ops: [
        { pageUrl: '/', ref: 'r1' },
        { pageUrl: '/other', ref: 'r1' },
      ],
    }, null, 2));

    const result = runComplete(['--handoff-id=feedface0005']);

    assert.equal(result.ok, true);
    assert.equal(result.removed, 2);
    assert.equal(result.totalCount, 1);
    const buffer = readBuffer(tmpDir);
    assert.equal(buffer.entries.length, 1);
    assert.equal(buffer.entries[0].pageUrl, '/');
    assert.equal(buffer.entries[0].ops[0].ref, 'r2');
    const completed = JSON.parse(fs.readFileSync(handoffPath, 'utf-8'));
    assert.equal(completed.removedOps, 2);
    assert.ok(completed.completedAt);
  });
});
