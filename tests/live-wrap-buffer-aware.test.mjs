import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeBuffer } from '../skill/scripts/live-manual-edits-buffer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(REPO_ROOT, 'skill/scripts/live-wrap.mjs');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-buf-test-'));
  fs.mkdirSync(path.join(tmpDir, 'src'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function seedBuffer(entries) {
  writeBuffer(tmpDir, { entries });
}

function entry({ pageUrl, ops }) {
  return {
    id: 'e' + Math.random().toString(36).slice(2, 8),
    pageUrl,
    element: { tagName: 'h1' },
    ops,
    stagedAt: new Date().toISOString(),
  };
}

function runWrap(extraArgs) {
  const args = [SCRIPT, '--id', 'aaaaaaaa', '--count', '3', ...extraArgs];
  const stdout = execFileSync('node', args, { encoding: 'utf-8', cwd: tmpDir });
  return JSON.parse(stdout.trim());
}

describe('live-wrap.mjs buffer-aware "original" content', () => {
  it('with matching --page-url, rewrites the wrap block to reflect the buffered edit', () => {
    const file = path.join(tmpDir, 'src', 'page.html');
    fs.writeFileSync(file, '<div>\n  <h1 class="hero">Welcome</h1>\n</div>\n');

    seedBuffer([
      entry({ pageUrl: '/', ops: [{ ref: 'div>h1.1', tag: 'h1', classes: ['hero'], originalText: 'Welcome', newText: 'Hello there' }] }),
    ]);

    runWrap(['--classes', 'hero', '--tag', 'h1', '--page-url', '/']);

    const after = fs.readFileSync(file, 'utf-8');
    assert.match(after, /Hello there/);
    assert.doesNotMatch(after, /<h1 class="hero">Welcome<\/h1>/);
  });

  it('with mismatched --page-url, does NOT leak the edit (CB-4 regression)', () => {
    const file = path.join(tmpDir, 'src', 'page.html');
    fs.writeFileSync(file, '<div>\n  <h1 class="hero">Welcome</h1>\n</div>\n');

    // Buffer has an edit for "/a" — wrap is called for "/b"
    seedBuffer([
      entry({ pageUrl: '/a', ops: [{ ref: 'div>h1.1', tag: 'h1', classes: ['hero'], originalText: 'Welcome', newText: 'LEAK' }] }),
    ]);

    runWrap(['--classes', 'hero', '--tag', 'h1', '--page-url', '/b']);

    const after = fs.readFileSync(file, 'utf-8');
    assert.match(after, /Welcome/);
    assert.doesNotMatch(after, /LEAK/);
  });

  it('without --page-url, skips the buffer-aware step entirely', () => {
    const file = path.join(tmpDir, 'src', 'page.html');
    fs.writeFileSync(file, '<div>\n  <h1 class="hero">Welcome</h1>\n</div>\n');

    seedBuffer([
      entry({ pageUrl: '/', ops: [{ ref: 'div>h1.1', tag: 'h1', classes: ['hero'], originalText: 'Welcome', newText: 'SHOULD_NOT_APPEAR' }] }),
    ]);

    runWrap(['--classes', 'hero', '--tag', 'h1']);

    const after = fs.readFileSync(file, 'utf-8');
    assert.match(after, /Welcome/);
    assert.doesNotMatch(after, /SHOULD_NOT_APPEAR/);
  });
});
