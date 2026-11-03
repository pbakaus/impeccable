import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Run the shipped panel script, with extension APIs stubbed.
function panel() {
  const elements = [];
  const element = () => {
    const node = {
      children: [], listeners: {}, style: {}, dataset: {}, classList: { add() {}, remove() {} },
      addEventListener(type, listener) { this.listeners[type] = listener; },
      appendChild(child) { this.children.push(child); },
      querySelector(selector) {
        assert.equal(selector, '.finding-copy');
        return this.copyButton ||= element();
      },
    };
    elements.push(node);
    return node;
  };
  const writes = [];
  const context = vm.createContext({
    document: { getElementById: element, createElement: element, documentElement: element() },
    elements, writes,
    navigator: { clipboard: { writeText: async text => { writes.push(text); } } },
    setTimeout() {},
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
  type: 'hard-offset-shadow', category: 'quality', severity: 'advisory', advisory: true,
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
  assert.equal(context.fixSkillFor({ type: 'unknown-rule' }), '/polish');
});

test('advisory presentation follows metadata for any rule and registry row', async () => {
  const context = panel();
  for (const advisory of [
    { type: 'future-rule', category: 'quality', severity: 'advisory' },
    { type: 'future-slop-rule', category: 'slop', advisory: true },
    { id: 'future-settings-rule', category: 'quality', severity: 'advisory' },
  ]) {
    assert.equal(context.presentationCategory(advisory), 'advisory');
    assert.equal(context.fixSkillFor(advisory), '');
    const finding = { ...advisory, name: 'Review this choice', detail: 'example' };
    const report = await context.formatFindingsForCopy([item([finding])]);
    assert.match(report, /## Advisories \(1\)/);
    assert.doesNotMatch(report, /Suggested Impeccable skills to fix/);
    const single = await context.formatSingleFindingForCopy(item([finding]), finding);
    assert.doesNotMatch(single, /Suggested Impeccable skill/);
  }
  assert.equal(context.presentationCategory({ type: 'hard-offset-shadow', category: 'quality' }), 'quality');
  assert.equal(context.fixSkillFor({ type: 'side-tab', advisory: false }), '/distill, /polish');
});

test('advisories keep a mapped fix command and drop only the generic fallback', async () => {
  const context = panel();
  assert.equal(context.fixSkillFor({ type: 'bounce-easing', category: 'slop', advisory: true }), '/animate');
  assert.equal(context.fixSkillFor({ type: 'straggler', category: 'quality', severity: 'advisory' }), '/typeset');
  assert.equal(context.fixSkillFor({ type: 'unbalanced-heading', category: 'quality', severity: 'advisory' }), '/typeset');
  assert.equal(context.fixSkillFor(shadow), '');
  const finding = { type: 'bounce-easing', category: 'slop', advisory: true, name: 'Bounce easing', detail: 'cubic-bezier' };
  const report = await context.formatFindingsForCopy([item([finding])]);
  assert.match(report, /## Advisories \(1\)/);
  assert.match(report, /Suggested Impeccable skills to fix: \/animate/);
});

// Exercise the rendered button, not just the formatter with a complete finding.
for (const [label, finding, expected] of [
  ['hard offset shadow', shadow, null],
  ['severity-only advisory', { ...shadow, type: 'future-rule', advisory: undefined }, null],
  ['boolean-only advisory', { ...shadow, type: 'future-rule', severity: undefined }, null],
  ['mapped advisory', { ...shadow, type: 'bounce-easing' }, '/animate'],
  ['ordinary unmapped finding', { ...shadow, type: 'future-rule', severity: undefined, advisory: false }, '/polish'],
]) {
  test(`rendered single-copy button preserves advice for ${label}`, async () => {
    const context = panel();
    context.renderFindings([item([finding])]);
    const buttons = context.elements.filter(node => node.copyButton).map(node => node.copyButton);
    assert.equal(buttons.length, 1);
    buttons[0].listeners.click({ stopPropagation() {} });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(context.writes.length, 1);
    assert.match(context.writes[0], /Element: `#card`/);
    assert.match(context.writes[0], /Check whether this fits the intended design direction/);
    if (expected) assert.ok(context.writes[0].includes(`Suggested Impeccable skill(s) to fix: ${expected}`));
    else assert.doesNotMatch(context.writes[0], /Suggested Impeccable skill|\/polish/);
  });
}
