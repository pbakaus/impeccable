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

function runWrapExpectFailure(extraArgs) {
  const args = [SCRIPT, '--id', 'aaaaaaaa', '--count', '3', ...extraArgs];
  try {
    execFileSync('node', args, { encoding: 'utf-8', cwd: tmpDir, stdio: ['ignore', 'pipe', 'pipe'] });
    throw new Error('expected wrap to fail');
  } catch (err) {
    if (err.status === undefined) throw err;
    return { status: err.status, stderr: err.stderr.toString() };
  }
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

  it('accepts --page-url=<url> when retrying after missing page-url guidance', () => {
    const file = path.join(tmpDir, 'src', 'page.html');
    fs.writeFileSync(file, '<div>\n  <h1 class="hero">Welcome</h1>\n</div>\n');

    seedBuffer([
      entry({ pageUrl: '/', ops: [{ ref: 'div>h1.1', tag: 'h1', classes: ['hero'], originalText: 'Welcome', newText: 'Hello equals' }] }),
    ]);

    runWrap(['--classes', 'hero', '--tag', 'h1', '--page-url=/']);

    const after = fs.readFileSync(file, 'utf-8');
    assert.match(after, /Hello equals/);
  });

  it('updates only the staged leaf when matching text repeats inside the selected original block', () => {
    const file = path.join(tmpDir, 'src', 'page.html');
    fs.writeFileSync(file, '<section class="hero">\n  <h1>Welcome</h1>\n  <p>Welcome</p>\n</section>\n');

    seedBuffer([
      entry({ pageUrl: '/', ops: [{ ref: 'section.hero>h1:nth-of-type(1)', tag: 'h1', originalText: 'Welcome', newText: 'Hello' }] }),
    ]);

    runWrap(['--classes', 'hero', '--tag', 'section', '--page-url', '/']);

    const after = fs.readFileSync(file, 'utf-8');
    const originalWrapper = after.match(/data-impeccable-variant="original"[\s\S]*?<\/div>/)?.[0] || '';
    assert.equal((originalWrapper.match(/Hello/g) || []).length, 1);
    assert.match(originalWrapper, /<h1>Hello<\/h1>/);
    assert.match(originalWrapper, /<p>Welcome<\/p>/);
  });

  it('with matching --page-url, refuses when a staged edit in the block is ambiguous', () => {
    const file = path.join(tmpDir, 'src', 'page.html');
    const original = '<section class="cards">\n  <p class="label">Same</p>\n  <p class="label">Same</p>\n</section>\n';
    fs.writeFileSync(file, original);

    seedBuffer([
      entry({
        pageUrl: '/',
        ops: [{
          ref: 'body>section.cards:nth-of-type(1)>p.label:nth-of-type(2)',
          tag: 'p',
          classes: ['label'],
          originalText: 'Same',
          newText: 'Second',
        }],
      }),
    ]);

    const result = runWrapExpectFailure(['--classes', 'cards', '--tag', 'section', '--page-url', '/']);
    assert.equal(result.status, 1);
    const errPayload = JSON.parse(result.stderr.split('\n').filter((l) => l.trim().startsWith('{')).pop());
    assert.equal(errPayload.error, 'manual_edit_buffer_apply_failed');
    assert.equal(errPayload.pendingOps.length, 1);
    assert.equal(fs.readFileSync(file, 'utf-8'), original);
  });

  it('with matching --page-url, ignores unrelated same-page staged edits outside the selected block', () => {
    const file = path.join(tmpDir, 'src', 'page.html');
    fs.writeFileSync(file, '<main>\n  <section class="hero"><h1>Welcome</h1></section>\n  <aside><p>Footer copy</p></aside>\n</main>\n');

    seedBuffer([
      entry({
        pageUrl: '/',
        ops: [{
          ref: 'body>main:nth-of-type(1)>aside:nth-of-type(1)>p:nth-of-type(1)',
          tag: 'p',
          originalText: 'Footer copy',
          newText: 'Footer edited',
          sourceHint: { file: 'src/page.html', line: 3 },
        }],
      }),
    ]);

    const result = runWrap(['--classes', 'hero', '--tag', 'section', '--page-url', '/']);
    assert.ok(result.file, 'wrap should succeed when same-page staged edits cannot affect the target block');
  });

  it('with mismatched --page-url, does not leak the edit', () => {
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

  it('with pending entries that affect the picked block, refuses without --page-url', () => {
    const file = path.join(tmpDir, 'src', 'page.html');
    fs.writeFileSync(file, '<div>\n  <h1 class="hero">Welcome</h1>\n</div>\n');

    seedBuffer([
      entry({
        pageUrl: '/',
        ops: [{
          ref: 'div>h1.1',
          tag: 'h1',
          classes: ['hero'],
          originalText: 'Welcome',
          newText: 'SHOULD_NOT_APPEAR',
          sourceHint: { file: 'src/page.html', line: 2 },
        }],
      }),
    ]);

    const result = runWrapExpectFailure(['--classes', 'hero', '--tag', 'h1']);
    assert.equal(result.status, 1);
    const errPayload = JSON.parse(result.stderr.split('\n').filter((l) => l.trim().startsWith('{')).pop());
    assert.equal(errPayload.error, 'missing_page_url_with_pending_edits');
    assert.equal(errPayload.pendingEntries, 1);
    assert.equal(fs.readFileSync(file, 'utf-8'), '<div>\n  <h1 class="hero">Welcome</h1>\n</div>\n');
  });

  it('without --page-url, does not block wrap for unrelated same-file pending edits', () => {
    const file = path.join(tmpDir, 'src', 'page.html');
    fs.writeFileSync(file, '<main>\n  <section class="hero"><h1>Welcome</h1></section>\n  <aside><p>Shared</p></aside>\n</main>\n');

    seedBuffer([
      entry({
        pageUrl: '/other',
        ops: [{
          ref: 'body>main:nth-of-type(1)>aside:nth-of-type(1)>p:nth-of-type(1)',
          tag: 'p',
          originalText: 'Shared',
          newText: 'Shared edited',
          sourceHint: { file: 'src/page.html', line: 3 },
        }],
      }),
    ]);

    const result = runWrap(['--classes', 'hero', '--tag', 'section']);
    assert.ok(result.file, 'wrap should succeed when staged edits cannot affect the target block');
  });

  it('with empty buffer, --page-url is optional', () => {
    const file = path.join(tmpDir, 'src', 'page.html');
    fs.writeFileSync(file, '<div>\n  <h1 class="hero">Welcome</h1>\n</div>\n');
    // No seedBuffer call — empty buffer.

    const result = runWrap(['--classes', 'hero', '--tag', 'h1']);
    assert.ok(result.file, 'wrap should succeed and emit file path');
  });
});
