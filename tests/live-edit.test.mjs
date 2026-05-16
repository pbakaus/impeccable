import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(REPO_ROOT, 'skill/scripts/live-edit.mjs');

function runEdit(cwd, ops, extraArgs = []) {
  const args = [SCRIPT, '--id', 'aaaaaaaa', '--ops', JSON.stringify(ops), ...extraArgs];
  let stdout;
  try {
    stdout = execFileSync('node', args, { encoding: 'utf-8', cwd });
  } catch (err) {
    return { ok: false, error: err.message, stderr: err.stderr };
  }
  return JSON.parse(stdout.trim());
}

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-edit-test-'));
  // Mirror the dir layout findFileWithQuery searches by default
  fs.mkdirSync(path.join(tmpDir, 'src'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('live-edit.mjs', () => {
  it('single text-replace rewrites source', () => {
    const file = path.join(tmpDir, 'src', 'card.html');
    fs.writeFileSync(file, '<div class="card">\n  <h2 class="title">Build faster</h2>\n  <p class="lede">Without the cognitive load</p>\n</div>\n');

    const result = runEdit(tmpDir, [
      { ref: 'div>h2.1', tag: 'h2', classes: ['title'], originalText: 'Build faster', newText: 'Ship faster' },
    ]);

    assert.equal(result.ok, true);
    assert.equal(result.applied.length, 1);
    assert.equal(result.failed.length, 0);
    const after = fs.readFileSync(file, 'utf-8');
    assert.match(after, /<h2 class="title">Ship faster<\/h2>/);
    assert.doesNotMatch(after, /Build faster/);
  });

  it('two text-replaces in same file applied in one write', () => {
    const file = path.join(tmpDir, 'src', 'card.html');
    fs.writeFileSync(file, '<div class="card">\n  <h2 class="title">Build faster</h2>\n  <p class="lede">Without the cognitive load</p>\n</div>\n');

    const result = runEdit(tmpDir, [
      { ref: 'div>h2.1', tag: 'h2', classes: ['title'], originalText: 'Build faster', newText: 'Ship faster' },
      { ref: 'div>p.1', tag: 'p', classes: ['lede'], originalText: 'Without the cognitive load', newText: 'Without the noise' },
    ]);

    assert.equal(result.ok, true);
    assert.equal(result.applied.length, 2);
    const after = fs.readFileSync(file, 'utf-8');
    assert.match(after, /Ship faster/);
    assert.match(after, /Without the noise/);
  });

  it('block-delete removes the matched element', () => {
    const file = path.join(tmpDir, 'src', 'card.html');
    fs.writeFileSync(file, '<div class="card">\n  <h2 class="title">Build faster</h2>\n  <p class="kill">remove me</p>\n  <p class="keep">keep me</p>\n</div>\n');

    const result = runEdit(tmpDir, [
      { ref: 'div>p.1', tag: 'p', classes: ['kill'], originalText: 'remove me', deleted: true },
    ]);

    assert.equal(result.ok, true);
    assert.equal(result.applied.length, 1);
    const after = fs.readFileSync(file, 'utf-8');
    assert.doesNotMatch(after, /remove me/);
    assert.match(after, /keep me/);
  });

  it('reports text_not_in_source when originalText absent from source', () => {
    const file = path.join(tmpDir, 'src', 'card.html');
    fs.writeFileSync(file, '<div class="card">\n  <h2 class="title">{title}</h2>\n</div>\n');

    const result = runEdit(tmpDir, [
      { ref: 'div>h2.1', tag: 'h2', classes: ['title'], originalText: 'Build faster', newText: 'Ship faster' },
    ]);

    assert.equal(result.ok, true);
    assert.equal(result.applied.length, 0);
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].reason, 'text_not_in_source');
  });

  it('reports insufficient_locator when neither id nor classes', () => {
    const file = path.join(tmpDir, 'src', 'card.html');
    fs.writeFileSync(file, '<div><p>Hello</p></div>\n');

    const result = runEdit(tmpDir, [
      { ref: 'div>p.1', tag: 'p', originalText: 'Hello', newText: 'World' },
    ]);

    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].reason, 'insufficient_locator');
  });

  it('locates by id when classes are absent', () => {
    const file = path.join(tmpDir, 'src', 'card.html');
    fs.writeFileSync(file, '<div id="main">\n  <p id="lede">Hello</p>\n</div>\n');

    const result = runEdit(tmpDir, [
      { ref: 'div>p.1', tag: 'p', elementId: 'lede', originalText: 'Hello', newText: 'World' },
    ]);

    assert.equal(result.ok, true);
    assert.equal(result.applied.length, 1);
    assert.match(fs.readFileSync(file, 'utf-8'), /<p id="lede">World<\/p>/);
  });

  it('disambiguates two matching elements via originalText (filterByText)', () => {
    const file = path.join(tmpDir, 'src', 'card.html');
    fs.writeFileSync(
      file,
      '<div>\n' +
      '  <section class="card"><h2>Build faster than your competition</h2></section>\n' +
      '  <section class="card"><h2>Ship faster without the cognitive load</h2></section>\n' +
      '</div>\n'
    );

    const result = runEdit(tmpDir, [
      {
        ref: 'div>section.2',
        tag: 'section',
        classes: ['card'],
        originalText: 'Ship faster without the cognitive load',
        newText: 'Ship without thinking too hard about it',
      },
    ]);

    assert.equal(result.ok, true);
    assert.equal(result.applied.length, 1);
    const after = fs.readFileSync(file, 'utf-8');
    assert.match(after, /Ship without thinking too hard about it/);
    assert.match(after, /Build faster than your competition/);
  });

  it('refuses with text_ambiguous_in_block when originalText appears more than once (A3)', () => {
    const file = path.join(tmpDir, 'src', 'list.html');
    fs.writeFileSync(file,
      '<ul class="items">\n' +
      '  <li>Item</li>\n' +
      '  <li>Item</li>\n' +
      '</ul>\n'
    );

    const result = runEdit(tmpDir, [
      { ref: 'ul>li.2', tag: 'ul', classes: ['items'], originalText: 'Item', newText: 'Renamed' },
    ]);

    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].reason, 'text_ambiguous_in_block');
    assert.equal(result.applied.length, 0);
    // Source is untouched — refuse-on-ambiguity.
    const after = fs.readFileSync(file, 'utf-8');
    assert.doesNotMatch(after, /Renamed/);
  });

  it('rejects newText containing forbidden chars (A4)', () => {
    const file = path.join(tmpDir, 'src', 'card.html');
    fs.writeFileSync(file, '<div class="card">\n  <p class="lede">Hello</p>\n</div>\n');

    for (const bad of ['<', '>', '{', '}', '`']) {
      const result = runEdit(tmpDir, [
        { ref: 'div>p.1', tag: 'p', classes: ['lede'], originalText: 'Hello', newText: 'safe ' + bad + ' rest' },
      ]);
      assert.equal(result.failed.length, 1, 'failed for ' + bad);
      assert.equal(result.failed[0].reason, 'invalid_chars_in_newText');
      assert.ok(result.failed[0].forbidden.includes(bad));
    }
  });

  it('handles ops resolving to different files independently', () => {
    const a = path.join(tmpDir, 'src', 'a.html');
    const b = path.join(tmpDir, 'src', 'b.html');
    fs.writeFileSync(a, '<div>\n  <h1 class="hero">Welcome</h1>\n</div>\n');
    fs.writeFileSync(b, '<div>\n  <h1 class="cta">Click me</h1>\n</div>\n');

    const result = runEdit(tmpDir, [
      { ref: 'div>h1.1', tag: 'h1', classes: ['hero'], originalText: 'Welcome', newText: 'Hello' },
      { ref: 'div>h1.1', tag: 'h1', classes: ['cta'], originalText: 'Click me', newText: 'Tap me' },
    ]);

    assert.equal(result.applied.length, 2);
    assert.match(fs.readFileSync(a, 'utf-8'), /Hello/);
    assert.match(fs.readFileSync(b, 'utf-8'), /Tap me/);
  });
});
