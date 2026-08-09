/**
 * Comments are prose, not markup.
 *
 * The line matchers scan raw source, so a comment that merely names a tag used
 * to be scanned as if it were that tag: a block comment explaining why an image
 * is proxied reported `broken-image` in a file with no img element in it.
 *
 * These tests pin both directions — the false positive is gone AND the rule
 * still catches the real thing. A fix that only silenced the rule would pass
 * the first half and fail the second.
 *
 * Run via Node's built-in test runner (not bun):
 *   node --test tests/detect-comments-are-not-code.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectText } from '../cli/engine/detect-antipatterns.mjs';

const ids = (source, file = 'sample.tsx') =>
  detectText(source, file).map((f) => f.antipattern);

describe('detectText - comments are not scanned as markup', () => {
  it('ignores a block comment that names an img tag', () => {
    const source = [
      'export function Avatar() {',
      '  /* The CDN answers 403 for an `<img>` loaded from another origin, so the',
      '     picture is proxied through our own route. */',
      '  return <div />;',
      '}',
      '',
    ].join('\n');
    assert.ok(!ids(source).includes('broken-image'));
  });

  it('ignores a line comment that names an img tag', () => {
    const source = ['// never ship an <img> without a src here', 'const x = 1;', ''].join('\n');
    assert.ok(!ids(source).includes('broken-image'));
  });

  it('ignores an HTML comment that names an img tag', () => {
    const source = ['<!-- an <img> with no src ships as a broken box -->', '<div></div>', ''].join('\n');
    assert.ok(!ids(source, 'sample.html').includes('broken-image'));
  });

  it('still flags an img element with no src', () => {
    const source = ['export function B() {', '  return <img className="w-4" />;', '}', ''].join('\n');
    assert.ok(ids(source).includes('broken-image'));
  });

  it('still flags an img element with an empty src', () => {
    const source = ['const markup = \'<img src="" alt="x">\';', ''].join('\n');
    assert.ok(ids(source).includes('broken-image'));
  });

  it('does not swallow the rest of a line after a URL in a string', () => {
    /* A regex-based strip of `//` would eat from `https://` to end of line and,
       in a minified or single-line source, hide everything after it. */
    const source = ['const a = "https://example.com/x";', 'const b = <img />;', ''].join('\n');
    assert.ok(ids(source).includes('broken-image'));
  });

  it('keeps reported line numbers pointing at the real line', () => {
    const source = [
      '/* a comment mentioning <img> so the mask has work to do */',
      '//',
      'const b = <img />;',
      '',
    ].join('\n');
    const found = detectText(source, 'sample.tsx').filter((f) => f.antipattern === 'broken-image');
    assert.equal(found.length, 1);
    assert.equal(found[0].line, 3);
  });
});
