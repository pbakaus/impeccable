import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { matchesAnyGlob } from '../cli/engine/config/glob.mjs';

describe('matchesAnyGlob', () => {
  it('matches ** across directories', () => {
    assert.ok(matchesAnyGlob('vendor/lib/a.css', ['vendor/**']));
    assert.ok(matchesAnyGlob('src/vendor/x/y.js', ['**/vendor/**']));
  });
  it('matches * within a segment only', () => {
    assert.ok(matchesAnyGlob('a/b.min.css', ['a/*.min.css']));
    assert.ok(!matchesAnyGlob('a/c/b.min.css', ['a/*.min.css']));
  });
  it('matches a bare extension glob', () => {
    assert.ok(matchesAnyGlob('deep/nested/x.test.tsx', ['**/*.test.tsx']));
  });
  it('returns false for empty pattern list', () => {
    assert.ok(!matchesAnyGlob('a.css', []));
  });
});
