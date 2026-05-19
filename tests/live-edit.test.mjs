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

  it('uses unique literal fallback for leaf-only data edits with a locator signal', () => {
    fs.mkdirSync(path.join(tmpDir, 'site/scripts'), { recursive: true });
    const file = path.join(tmpDir, 'site/scripts/data.js');
    fs.writeFileSync(file,
      "export const skillFocusAreas = {\n" +
      "  impeccable: [\n" +
      "    { area: 'Spatial GGGGG', detail: 'Layout, spacing, composition' },\n" +
      "  ],\n" +
      "};\n" +
      "export const dimensionGuidelineCounts = {\n" +
      "  'Spatial Design': 27,\n" +
      "};\n"
    );

    const result = runEdit(tmpDir, [
      {
        ref: 'span',
        tag: 'span',
        classes: ['foundation-card-label'],
        originalText: 'Spatial GGGGG',
        newText: 'Spatial',
      },
    ]);

    assert.equal(result.ok, true);
    assert.equal(result.failed.length, 0);
    assert.equal(result.applied.length, 1);
    const after = fs.readFileSync(file, 'utf-8');
    assert.match(after, /area: 'Spatial'/);
    assert.match(after, /'Spatial Design': 27/);
  });

  it('cascades identity value edits to matching JS object keys', () => {
    fs.mkdirSync(path.join(tmpDir, 'site/scripts/components'), { recursive: true });
    const dataFile = path.join(tmpDir, 'site/scripts/data.js');
    const animationFile = path.join(tmpDir, 'site/scripts/components/foundation-animations.js');
    fs.writeFileSync(dataFile,
      "export const skillFocusAreas = {\n" +
      "  impeccable: [\n" +
      "    { area: 'Spatial Design', detail: 'Layout, spacing, composition' },\n" +
      "  ],\n" +
      "};\n" +
      "export const dimensionGuidelineCounts = {\n" +
      "  'Spatial Design': 27,\n" +
      "};\n"
    );
    fs.writeFileSync(animationFile,
      "export const foundationAnimations = {\n" +
      "  'Spatial Design': '<svg></svg>',\n" +
      "};\n"
    );

    const result = runEdit(tmpDir, [
      {
        ref: 'body>main:nth-of-type(1)>span:nth-of-type(1)',
        tag: 'span',
        classes: ['foundation-card-label'],
        originalText: 'Spatial Design',
        newText: 'Spatial',
        contextHints: ['Layout, spacing, composition'],
      },
    ]);

    assert.equal(result.ok, true);
    assert.equal(result.failed.length, 0);
    assert.deepEqual(new Set(result.files), new Set([
      'site/scripts/data.js',
      'site/scripts/components/foundation-animations.js',
    ]));
    assert.match(fs.readFileSync(dataFile, 'utf-8'), /area: 'Spatial'/);
    assert.match(fs.readFileSync(dataFile, 'utf-8'), /'Spatial': 27/);
    assert.doesNotMatch(fs.readFileSync(dataFile, 'utf-8'), /Spatial Design/);
    assert.match(fs.readFileSync(animationFile, 'utf-8'), /'Spatial': '<svg><\/svg>'/);
  });

  it('refuses identity key cascade when the new key already exists', () => {
    fs.mkdirSync(path.join(tmpDir, 'site/scripts'), { recursive: true });
    const file = path.join(tmpDir, 'site/scripts/data.js');
    fs.writeFileSync(file,
      "export const skillFocusAreas = {\n" +
      "  impeccable: [\n" +
      "    { area: 'Spatial Design', detail: 'Layout, spacing, composition' },\n" +
      "  ],\n" +
      "};\n" +
      "export const dimensionGuidelineCounts = {\n" +
      "  'Spatial Design': 27,\n" +
      "  'Spatial': 99,\n" +
      "};\n"
    );

    const result = runEdit(tmpDir, [
      {
        ref: 'body>main:nth-of-type(1)>span:nth-of-type(1)',
        tag: 'span',
        classes: ['foundation-card-label'],
        originalText: 'Spatial Design',
        newText: 'Spatial',
        contextHints: ['Layout, spacing, composition'],
      },
    ]);

    assert.equal(result.applied.length, 0);
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].reason, 'reference_integrity_risk');
    const after = fs.readFileSync(file, 'utf-8');
    assert.match(after, /area: 'Spatial Design'/);
    assert.match(after, /'Spatial Design': 27/);
    assert.match(after, /'Spatial': 99/);
  });

  it('keeps JS valid when visible numeric text has a leading zero', () => {
    fs.mkdirSync(path.join(tmpDir, 'site/scripts'), { recursive: true });
    const file = path.join(tmpDir, 'site/scripts/data.js');
    fs.writeFileSync(file,
      "export const dimensionGuidelineCounts = {\n" +
      "  'UX Writing': 32,\n" +
      "};\n"
    );

    const result = runEdit(tmpDir, [
      {
        ref: 'body>main:nth-of-type(1)>span:nth-of-type(2)',
        tag: 'span',
        classes: ['foundation-card-count'],
        originalText: '32',
        newText: '00',
        contextHints: ['UX Writing'],
      },
    ]);

    assert.equal(result.ok, true);
    assert.equal(result.failed.length, 0);
    const after = fs.readFileSync(file, 'utf-8');
    assert.match(after, /'UX Writing': '00'/);
    execFileSync(process.execPath, ['--check', file]);
  });

  it('does not use no-context fallback for unstructured text occurrences', () => {
    fs.mkdirSync(path.join(tmpDir, 'site/scripts'), { recursive: true });
    const file = path.join(tmpDir, 'site/scripts/data.js');
    fs.writeFileSync(file, '// Spatial GGGGG is mentioned in a comment only\n');

    const result = runEdit(tmpDir, [
      {
        ref: 'span',
        tag: 'span',
        classes: ['foundation-card-label'],
        originalText: 'Spatial GGGGG',
        newText: 'Spatial',
      },
    ]);

    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].reason, 'element_not_found');
    assert.match(fs.readFileSync(file, 'utf-8'), /Spatial GGGGG is mentioned/);
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
