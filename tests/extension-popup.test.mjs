import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const finding = { selector: '#card', findings: [
  { name: 'Low contrast', type: 'low-contrast', category: 'quality', detail: '2:1' },
  { name: 'Hard offset shadow', type: 'hard-offset-shadow', advisory: true, detail: '8px 8px 0' },
] };
const pageUrl = 'https://example.test/page#card';
const state = (findings = [finding]) => ({ findings, url: pageUrl, scanComplete: true });
const tick = () => new Promise(resolve => setImmediate(resolve));

async function popup({ initial = state(), deferState = false } = {}) {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      textContent: '', hidden: false, disabled: id === 'btn-copy-all', dataset: {},
      classList: { toggle() {} }, listeners: {},
      addEventListener(type, callback) { this.listeners[type] = callback; },
    });
    return nodes.get(id);
  };
  const listeners = {};
  const event = name => ({ addListener(callback) { listeners[name] = callback; } });
  const writes = [];
  const messages = [];
  const h = { nodes, node, writes, messages, tab: { id: 7, url: pageUrl, status: 'complete' }, rejectCopy: false };
  const context = vm.createContext({
    document: { getElementById: node },
    navigator: { clipboard: { async writeText(text) {
      if (h.copyGate) await h.copyGate;
      if (h.rejectCopy) throw new Error('Clipboard blocked');
      writes.push(text);
    } } },
    chrome: {
      tabs: { query: async () => {
        if (h.queryGate) await h.queryGate;
        return h.tab ? [h.tab] : [];
      }, onUpdated: event('updated'), onActivated: event('activated') },
      runtime: {
        onMessage: event('message'),
        sendMessage(message, callback) {
          messages.push(message);
          if (message.action === 'get-state') {
            if (deferState) h.deliverState = callback;
            else callback(initial);
          }
        },
      },
    },
  });
  for (const path of ['shared/findings-report.js', 'popup/popup.js']) {
    vm.runInContext(readFileSync(new URL(`../extension/${path}`, import.meta.url), 'utf8'), context);
  }
  await tick();
  h.broadcast = message => listeners.message(message);
  h.navigate = change => listeners.updated(7, change);
  h.click = id => node(id).listeners.click();
  return h;
}

test('popup copies all active-tab findings with its URL and a visible success message', async () => {
  const h = await popup();
  assert.equal(h.node('btn-copy-all').disabled, false);
  await h.click('btn-copy-all');
  assert.equal(h.writes.length, 1);
  assert.match(h.writes[0], /URL: https:\/\/example.test\/page\n/);
  assert.match(h.writes[0], /Total findings: 2/);
  assert.match(h.writes[0], /## Advisories \(1\)/);
  assert.match(h.node('copy-status').textContent, /Copied/);
});

test('popup distinguishes a clean scan from no scan or a failed scan', async () => {
  const h = await popup({ initial: { findings: [] } });
  assert.equal(h.node('btn-copy-all').disabled, true);
  h.broadcast({ action: 'findings-updated', tabId: 7, ...state([]) });
  assert.equal(h.node('btn-copy-all').disabled, false);
  await h.click('btn-copy-all');
  assert.match(h.writes[0], /found no anti-patterns/);
  assert.match(h.writes[0], /URL: https:\/\/example.test\/page\n/);
  assert.match(h.writes[0], /Total findings: 0/);
  h.broadcast({ action: 'scan-failed', tabId: 7, message: 'Scan blocked' });
  assert.equal(h.node('btn-copy-all').disabled, true);
  assert.equal(h.node('scan-error').textContent, 'Scan blocked');
});

test('popup ignores background-tab and unscoped broadcasts', async () => {
  const h = await popup();
  for (const tabId of [8, undefined]) {
    h.broadcast({ action: 'findings-updated', tabId, findings: [], url: 'https://other.test/' });
    h.broadcast({ action: 'scan-failed', tabId, message: 'Other tab failed' });
  }
  await h.click('btn-copy-all');
  assert.match(h.writes[0], /Low contrast/);
  assert.doesNotMatch(h.writes[0], /other.test/);
});

test('a scan in progress disables copy until new results arrive', async () => {
  const h = await popup();
  await h.click('btn-scan');
  assert.equal(h.node('btn-copy-all').disabled, true);
  h.broadcast({ action: 'findings-updated', tabId: 7, ...state() });
  assert.equal(h.node('btn-copy-all').disabled, false);
  h.broadcast({ action: 'scan-started', tabId: 7 });
  assert.equal(h.node('btn-copy-all').disabled, true);
});

for (const [label, change] of [
  ['another tab', { id: 8, url: pageUrl, status: 'complete' }],
  ['another page', { id: 7, url: 'https://example.test/next', status: 'complete' }],
  ['same-URL reload', { id: 7, url: pageUrl, status: 'loading' }],
  ['closed tab', null],
]) {
  test(`copy does not use old findings after ${label}`, async () => {
    const h = await popup();
    h.tab = change;
    await h.click('btn-copy-all');
    assert.equal(h.writes.length, 0);
    assert.equal(h.node('btn-copy-all').disabled, true);
    assert.match(h.node('copy-status').textContent, /Scan/);
  });
}

test('navigation clears results before a same-URL reload completes', async () => {
  const h = await popup();
  h.navigate({ status: 'loading' });
  assert.equal(h.node('btn-copy-all').disabled, true);
  assert.equal(h.node('count-number').textContent, '0');
});

test('a delayed initial state cannot overwrite newer findings', async () => {
  const h = await popup({ deferState: true });
  h.broadcast({ action: 'findings-updated', tabId: 7, ...state() });
  h.deliverState(state([]));
  await h.click('btn-copy-all');
  assert.match(h.writes[0], /Total findings: 2/);
});

test('clipboard rejection gives a visible retry message and keeps findings available', async () => {
  const h = await popup();
  h.rejectCopy = true;
  await h.click('btn-copy-all');
  assert.match(h.node('copy-status').textContent, /Couldn.*copy.*Try again/i);
  assert.equal(h.node('btn-copy-all').disabled, false);
  h.rejectCopy = false;
  await h.click('btn-copy-all');
  assert.equal(h.writes.length, 1);
  assert.match(h.node('copy-status').textContent, /Copied/);
});


test('a new scan cancels copy while the active-tab query is pending', async () => {
  const h = await popup();
  let release;
  h.queryGate = new Promise(resolve => { release = resolve; });
  const copying = h.click('btn-copy-all');
  h.broadcast({ action: 'scan-started', tabId: 7 });
  release();
  await copying;
  assert.equal(h.writes.length, 0);
  assert.equal(h.node('btn-copy-all').disabled, true);
});

test('an old clipboard completion cannot mark a newer report copied', async () => {
  const h = await popup();
  let release;
  h.copyGate = new Promise(resolve => { release = resolve; });
  const copying = h.click('btn-copy-all');
  await tick();
  h.broadcast({ action: 'findings-updated', tabId: 7, ...state([]) });
  release();
  await copying;
  assert.equal(h.node('copy-status').textContent, '');
  assert.equal(h.node('btn-copy-all').disabled, false);
});


test('partial findings stay visible but cannot be copied before the visual pass completes', async () => {
  const h = await popup();
  await h.click('btn-scan');
  h.broadcast({ action: 'findings-updated', tabId: 7, ...state([]), scanComplete: false });
  assert.equal(h.node('btn-copy-all').disabled, true);
  assert.equal(h.node('btn-scan').disabled, false);
  await h.click('btn-copy-all');
  assert.equal(h.writes.length, 0);
  h.broadcast({ action: 'findings-updated', tabId: 7, ...state(), scanComplete: false });
  assert.equal(h.node('count-number').textContent, '2');
  assert.equal(h.node('btn-copy-all').disabled, true);
  h.broadcast({ action: 'findings-updated', tabId: 7, ...state() });
  await h.click('btn-copy-all');
  assert.match(h.writes[0], /Total findings: 2/);
});

for (const url of ['', 'https://example.test/previous']) {
  test(`restores hidden overlays without trusting stale scan URL ${url}`, async () => {
    const h = await popup({ initial: { ...state(), url, overlaysVisible: false } });
    assert.equal(h.node('btn-toggle').textContent, 'Show overlays');
    assert.equal(h.node('btn-copy-all').disabled, true);
    h.broadcast({ action: 'findings-updated', tabId: 7, ...state() });
    assert.equal(h.node('btn-toggle').textContent, 'Show overlays');
    await h.click('btn-toggle');
    assert.equal(h.node('btn-toggle').textContent, 'Hide overlays');
  });
}

test('reopening restores scan progress and a failed scan message without old findings', async () => {
  const pending = await popup({ initial: { findings: [], url: '', scanComplete: false, scanning: true } });
  assert.equal(pending.node('count-number').textContent, '0');
  assert.equal(pending.node('btn-scan').textContent, 'Restart scan');
  assert.equal(pending.node('btn-scan').disabled, false);
  assert.equal(pending.node('btn-copy-all').disabled, true);
  await pending.click('btn-scan');
  assert.equal(pending.messages.at(-1).action, 'scan');
  assert.equal(pending.messages.at(-1).tabId, 7);
  pending.broadcast({ action: 'scan-started', tabId: 7 });
  assert.equal(pending.node('btn-scan').disabled, false);
  assert.equal(pending.node('btn-copy-all').disabled, true);
  const failed = await popup({ initial: { findings: [], url: '', scanComplete: false, scanning: false, scanError: 'Snapshot failed' } });
  assert.equal(failed.node('count-number').textContent, '0');
  assert.equal(failed.node('btn-copy-all').disabled, true);
  assert.equal(failed.node('btn-scan').disabled, false);
  assert.equal(failed.node('scan-error').textContent, 'Snapshot failed');
  assert.equal(failed.node('scan-error').hidden, false);
  failed.broadcast({ action: 'scan-started', tabId: 7 });
  assert.equal(failed.node('scan-error').hidden, true);
});
