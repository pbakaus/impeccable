/**
 * Tests for the live-insert CLI helper.
 * Run with: node --test tests/live-insert.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import {
  computeInsertLine,
  buildInsertWrapperLines,
  isInsertPosition,
} from '../skill/scripts/live-insert.mjs';

describe('isInsertPosition', () => {
  it('accepts before and after only', () => {
    assert.equal(isInsertPosition('before'), true);
    assert.equal(isInsertPosition('after'), true);
    assert.equal(isInsertPosition('inside'), false);
    assert.equal(isInsertPosition(''), false);
  });
});

describe('computeInsertLine', () => {
  it('returns startLine for before', () => {
    assert.equal(computeInsertLine(10, 14, 'before'), 10);
  });

  it('returns endLine + 1 for after', () => {
    assert.equal(computeInsertLine(10, 14, 'after'), 15);
  });
});

describe('buildInsertWrapperLines', () => {
  it('produces an insert scaffold without an original variant', () => {
    const lines = buildInsertWrapperLines({
      id: 'abc12345',
      count: 3,
      indent: '  ',
      commentSyntax: { open: '<!--', close: '-->' },
      isJsx: false,
    });
    const joined = lines.join('\n');
    assert.match(joined, /impeccable-variants-start abc12345/);
    assert.match(joined, /data-impeccable-variants="abc12345"/);
    assert.match(joined, /data-impeccable-mode="insert"/);
    assert.match(joined, /Variants: insert below this line/);
    assert.doesNotMatch(joined, /data-impeccable-variant="original"/);
  });

  it('keeps marker comments inside the wrapper for JSX', () => {
    const lines = buildInsertWrapperLines({
      id: 'jsx12345',
      count: 2,
      indent: '    ',
      commentSyntax: { open: '{/*', close: '*/}' },
      isJsx: true,
    });
    const joined = lines.join('\n');
    assert.match(joined, /^\s*<div data-impeccable-variants="jsx12345"/m);
    assert.match(joined, /{\/\* impeccable-variants-start jsx12345 \*\/}/);
    assert.doesNotMatch(joined, /data-impeccable-variant="original"/);
  });
});

describe('live-insert CLI integration', () => {
  let tmp;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'impeccable-insert-test-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('splices an insert wrapper after an anchor element in HTML', () => {
    writeFileSync(join(tmp, 'index.html'), `<!DOCTYPE html>
<html>
<body>
  <section class="hero">
    <h1>Hero</h1>
  </section>
  <section class="features">
    <h2>Features</h2>
  </section>
</body>
</html>`);

    const out = execSync(
      `node skill/scripts/live-insert.mjs --id ins12345 --count 3 --position after --classes "hero" --tag section --file "${join(tmp, 'index.html')}"`,
      { encoding: 'utf-8' },
    );
    const result = JSON.parse(out.trim());
    assert.equal(result.mode, 'insert');
    assert.equal(result.position, 'after');
    assert.ok(result.insertLine > 0);

    const after = readFileSync(join(tmp, 'index.html'), 'utf-8');
    assert.match(after, /data-impeccable-mode="insert"/);
    assert.match(after, /impeccable-variants-start ins12345/);
    assert.ok(after.indexOf('class="hero"') < after.indexOf('impeccable-variants-start ins12345'));
    assert.ok(after.indexOf('impeccable-variants-start ins12345') < after.indexOf('class="features"'));
    assert.doesNotMatch(after, /data-impeccable-variant="original"/);
  });

  it('splices an insert wrapper before an anchor element', () => {
    writeFileSync(join(tmp, 'page.html'), `<main>
  <section class="hero">Hero</section>
  <section class="cta">CTA</section>
</main>`);

    execSync(
      `node skill/scripts/live-insert.mjs --id ins99999 --count 2 --position before --classes "cta" --tag section --file "${join(tmp, 'page.html')}"`,
      { encoding: 'utf-8' },
    );

    const after = readFileSync(join(tmp, 'page.html'), 'utf-8');
    assert.ok(after.indexOf('impeccable-variants-start ins99999') < after.indexOf('class="cta"'));
    assert.ok(after.indexOf('class="hero"') < after.indexOf('impeccable-variants-start ins99999'));
  });

  it('works in JSX files with inner marker comments', () => {
    writeFileSync(join(tmp, 'App.jsx'), `export default function App() {
  return (
    <main>
      <section className="hero">Hero</section>
      <section className="footer">Footer</section>
    </main>
  );
}`);

    const out = execSync(
      `node skill/scripts/live-insert.mjs --id jsxins01 --count 3 --position after --classes "hero" --tag section --file "${join(tmp, 'App.jsx')}"`,
      { encoding: 'utf-8' },
    );
    const result = JSON.parse(out.trim());
    assert.equal(result.commentSyntax.open, '{/*');
    const after = readFileSync(join(tmp, 'App.jsx'), 'utf-8');
    assert.match(after, /data-impeccable-mode="insert"/);
    assert.match(after, /{\/\* impeccable-variants-start jsxins01 \*\/}/);
  });

  it('exits with error when position is missing', () => {
    writeFileSync(join(tmp, 'empty.html'), '<div class="x">x</div>');
    assert.throws(
      () => execSync(
        `node skill/scripts/live-insert.mjs --id bad00001 --count 2 --classes x --file "${join(tmp, 'empty.html')}"`,
        { encoding: 'utf-8', stdio: 'pipe' },
      ),
      (err) => err.status !== 0,
    );
  });

  it('exits with error for invalid position', () => {
    writeFileSync(join(tmp, 'empty.html'), '<div class="x">x</div>');
    assert.throws(
      () => execSync(
        `node skill/scripts/live-insert.mjs --id bad00002 --count 2 --position inside --classes x --file "${join(tmp, 'empty.html')}"`,
        { encoding: 'utf-8', stdio: 'pipe' },
      ),
      (err) => err.status !== 0,
    );
  });
});
