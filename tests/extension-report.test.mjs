import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function formatter() {
  const context = vm.createContext({});
  vm.runInContext(readFileSync(new URL('../extension/shared/findings-report.js', import.meta.url), 'utf8'), context);
  return context.ImpeccableReport;
}

test('shared report takes a page URL and counts individual findings', () => {
  const report = formatter().formatFindingsForCopy([
    { selector: '#card', findings: [
      { category: 'slop', type: 'side-tab', name: 'Side tab', detail: '4px border' },
      { category: 'quality', type: 'low-contrast', name: 'Low contrast', detail: '2:1' },
      { severity: 'advisory', name: 'Hard offset shadow', detail: '8px 8px 0' },
    ] },
    { isPageLevel: true, findings: [
      { category: 'quality', name: 'Heading order', detail: 'Missing h2' },
    ] },
  ], 'https://example.test/page?theme=light#card');
  assert.match(report, /URL: https:\/\/example.test\/page\?theme=light\n/);
  assert.match(report, /Total findings: 4/);
  assert.match(report, /## AI tells \(1\)/);
  assert.match(report, /## Quality issues \(2\)/);
  assert.match(report, /## Advisories \(1\)/);
  assert.match(report, /\*\*Side tab\*\* at `#card`: 4px border/);
  assert.match(report, /\*\*Heading order\*\* at _\(page-level\)_: Missing h2/);
});

test('advisory-only reports keep metadata and have no generic polish suggestion', () => {
  const report = formatter().formatFindingsForCopy([{ selector: 'button', findings: [
    { advisory: true, type: 'hard-offset-shadow', name: 'Hard offset shadow', detail: '4px 4px 0' },
  ] }], 'https://example.test/');
  assert.match(report, /## Advisories \(1\)/);
  assert.doesNotMatch(report, /\/polish|Suggested Impeccable/);
});
