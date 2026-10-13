import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Run the shipped panel script, with extension APIs stubbed. Browser rendering
// is exercised separately by fixtures/hard-offset-shadow/browser-check.mjs.
function panel() {
  const element = () => ({ addEventListener() {}, style: {}, classList: { add() {} } });
  const context = vm.createContext({
    document: { getElementById: element, documentElement: element() },
    window: { addEventListener() {} },
    chrome: {
      devtools: {
        panels: { themeName: 'light' },
        inspectedWindow: { tabId: 1, eval: (_code, callback) => callback('https://example.test/') },
      },
      runtime: {
        getURL: path => path,
        connect: () => ({ onMessage: { addListener() {} }, onDisconnect: { addListener() {} } }),
      },
    },
    // Keep async settings initialization pending; these tests exercise reports.
    fetch: () => new Promise(() => {}),
    setInterval() {},
  });
  vm.runInContext(readFileSync(new URL('../extension/devtools/panel.js', import.meta.url), 'utf8'), context);
  return context;
}

const shadow = {
  type: 'hard-offset-shadow', category: 'slop', severity: 'advisory', advisory: true,
  name: 'Hard offset shadow', detail: '8px 8px 0px #111',
  description: 'Check whether this fits the intended design direction.',
};
const item = findings => ({ selector: '#card', findings });

test('copy-all treats hard shadows as advisories without prescribing a fix', async () => {
  const report = await panel().formatFindingsForCopy([item([shadow])]);
  assert.match(report, /## Advisories \(1\)/);
  assert.match(report, /Hard offset shadow.*#card.*8px 8px/);
  assert.doesNotMatch(report, /AI tells|Suggested Impeccable skills to fix|\/polish/);
});

test('single-finding copy retains design guidance without prescribing a fix', async () => {
  const report = await panel().formatSingleFindingForCopy(item([shadow]), shadow);
  assert.match(report, /Check whether this fits the intended design direction/);
  assert.doesNotMatch(report, /Suggested Impeccable skill|\/polish/);
});

test('mixed reports preserve existing categories and suggestions for other rules', async () => {
  const report = await panel().formatFindingsForCopy([item([
    shadow,
    { type: 'side-tab', category: 'slop', name: 'Side tab', detail: 'border' },
    { type: 'low-contrast', category: 'quality', name: 'Low contrast', detail: '2:1' },
  ])]);
  assert.match(report, /## AI tells \(1\)/);
  assert.match(report, /## Quality issues \(1\)/);
  assert.match(report, /## Advisories \(1\)/);
  assert.match(report, /Suggested Impeccable skills to fix: \/distill, \/polish, \/colorize, \/audit/);
});

test('empty reports and the existing unknown-rule fallback still work', async () => {
  const context = panel();
  assert.equal(await context.formatFindingsForCopy([]), 'Impeccable found no anti-patterns on this page.');
  assert.equal(context.fixSkillFor('unknown-rule'), '/polish');
});
