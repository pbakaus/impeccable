import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toSarif } from '../cli/engine/output/sarif.mjs';

describe('toSarif', () => {
  const findings = [
    { antipattern: 'side-tab', name: 'Side-tab accent border', description: 'desc', severity: 'warning', category: 'slop', engine: 'static-html', file: '/proj/a.html', line: 12, snippet: '<div>' },
    { antipattern: 'hairline-shadow', name: 'Hairline border with wide shadow', description: 'd2', severity: 'advisory', category: 'slop', engine: 'browser', file: '/proj/a.html', line: 0, snippet: '' },
  ];
  const sarif = toSarif(findings, { version: '2.3.2', rootDir: '/proj' });

  it('is SARIF 2.1.0 with one run', () => {
    assert.equal(sarif.version, '2.1.0');
    assert.equal(sarif.runs.length, 1);
    assert.equal(sarif.runs[0].tool.driver.name, 'impeccable');
  });
  it('declares each unique rule once', () => {
    const ids = sarif.runs[0].tool.driver.rules.map(r => r.id).sort();
    assert.deepEqual(ids, ['hairline-shadow', 'side-tab']);
  });
  it('maps severity to SARIF level and uses relative URIs + 1-based lines', () => {
    const results = sarif.runs[0].results;
    const side = results.find(r => r.ruleId === 'side-tab');
    assert.equal(side.level, 'warning');
    assert.equal(side.locations[0].physicalLocation.artifactLocation.uri, 'a.html');
    assert.equal(side.locations[0].physicalLocation.region.startLine, 12);
    const hair = results.find(r => r.ruleId === 'hairline-shadow');
    assert.equal(hair.level, 'note'); // advisory -> note
    assert.equal(hair.locations[0].physicalLocation.region.startLine, 1); // line 0 -> 1
  });
});
