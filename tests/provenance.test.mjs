import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectText } from '../cli/engine/detect-antipatterns.mjs';

describe('finding provenance', () => {
  it('regex findings carry engine and category', () => {
    // gradient text is a reliable regex-engine trigger
    const css = '.h { background: linear-gradient(90deg,#f00,#00f); -webkit-background-clip: text; color: transparent; }';
    const findings = detectText(css, 'a.css', {});
    assert.ok(findings.length > 0, 'expected at least one finding');
    for (const f of findings) {
      assert.equal(f.engine, 'regex');
      assert.ok(typeof f.category === 'string' && f.category.length > 0);
    }
  });
});
