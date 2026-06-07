import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applySuppressions } from '../cli/engine/config/suppress.mjs';

const SRC = [
  '/* impeccable-disable-next-line side-tab */', // line 1 -> suppresses line 2 side-tab
  '.a { border-left: 4px solid red; }', // line 2
  '.b { color: transparent; } /* impeccable-disable-line gradient-text */', // line 3
  '.c { border-left: 4px solid red; }', // line 4 (not suppressed)
].join('\n');

describe('inline suppression', () => {
  it('suppresses a specific rule on the next line', () => {
    const findings = [
      { antipattern: 'side-tab', line: 2 },
      { antipattern: 'side-tab', line: 4 },
    ];
    const kept = applySuppressions(findings, SRC);
    assert.deepEqual(kept.map(f => f.line), [4]);
  });
  it('suppresses same-line rule', () => {
    const kept = applySuppressions([{ antipattern: 'gradient-text', line: 3 }], SRC);
    assert.equal(kept.length, 0);
  });
  it('bare directive suppresses all rules in scope', () => {
    const src = '/* impeccable-disable-next-line */\n.x{}';
    const kept = applySuppressions([{ antipattern: 'anything', line: 2 }], src);
    assert.equal(kept.length, 0);
  });
  it('a named directive does not suppress a different rule', () => {
    const kept = applySuppressions([{ antipattern: 'gradient-text', line: 2 }], SRC);
    assert.equal(kept.length, 1);
  });
  it('file-level disable suppresses from its line onward', () => {
    const src = '.a{}\n/* impeccable-disable side-tab */\n.b{}\n.c{}';
    const kept = applySuppressions(
      [
        { antipattern: 'side-tab', line: 1 },
        { antipattern: 'side-tab', line: 4 },
      ],
      src,
    );
    assert.deepEqual(kept.map(f => f.line), [1]);
  });
});
