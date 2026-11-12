import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { stageStore } from '../scripts/lib/extension-manifests.js';

const SOURCE = fileURLToPath(new URL('../extension/', import.meta.url));

const finding = { selector: '#card', findings: [
  { name: 'Low contrast', type: 'low-contrast', category: 'quality', detail: '2:1' },
  { name: 'Hard offset shadow', type: 'hard-offset-shadow', advisory: true, detail: '8px 8px 0' },
] };
const pageUrl = 'https://example.test/page#card';
const state = (findings = [finding]) => ({ findings, url: pageUrl, scanComplete: true });
const tick = () => new Promise(resolve => setImmediate(resolve));

// `account`: what the account worker answers each `{ account }` message with; leave it out for a browser without
// chrome.identity (Firefox), where the account script must stay out of the way. `root`: the build's folder, whose
// popup.html says which scripts run.
async function popup({ initial = state(), deferState = false, account, root = SOURCE } = {}) {
  const nodes = new Map();
  const element = (props = {}) => ({
    textContent: '', hidden: false, dataset: {}, attributes: {}, children: [], value: '', tabIndex: 0,
    classList: { toggle() {} }, listeners: {},
    addEventListener(type, callback) { this.listeners[type] = callback; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    focus() {}, append(...kids) { this.children.push(...kids); }, replaceChildren(...kids) { this.children = kids; },
    ...props,
  });
  // The page as popup.html marks it up: everything account.js finds hidden at first is hidden.
  const HIDDEN = ['account-tabs', 'tab-personas', 'panel-personas', 'panel-settings', 'scan-error', 'sign-in', 'helper-row'];
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, element({ id, disabled: id === 'btn-copy-all', hidden: HIDDEN.includes(id) }));
    return nodes.get(id);
  };
  const listeners = {};
  const event = name => ({ addListener(callback) { listeners[name] = callback; } });
  const writes = [];
  const messages = [];
  const h = { nodes, node, writes, messages, tab: { id: 7, url: pageUrl, status: 'complete' }, rejectCopy: false };
  const body = element();
  const context = vm.createContext({
    document: { getElementById: node, createElement: () => element(), body },
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
      ...(account ? { identity: {} } : {}),
      runtime: {
        onMessage: event('message'),
        sendMessage(message, callback) {
          messages.push(message);
          // An answer may be worked out from the message, and come later.
          if (message.account) { const answer = account[message.account]; void Promise.resolve(typeof answer === 'function' ? answer(message) : answer ?? { ok: false }).then(callback); return; }
          if (message.walks) { callback(account?.walks ?? null); return; }
          if (message.action === 'get-state') {
            if (deferState) h.deliverState = callback;
            else callback(initial);
          }
        },
      },
    },
  });
  // window.close is the popup closing itself; a test reads it as nothing more.
  context.window = { close() {} };
  const html = readFileSync(path.join(root, 'popup/popup.html'), 'utf8');
  for (const [, src] of html.matchAll(/<script src="([^"]+)"><\/script>/g)) {
    vm.runInContext(readFileSync(path.join(root, 'popup', src), 'utf8'), context);
  }
  await tick();
  h.broadcast = message => listeners.message(message);
  h.navigate = change => listeners.updated(7, change);
  h.click = id => node(id).listeners.click();
  h.body = body;
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

const signedIn = { ok: true, available: true, signedIn: true, email: 'mira@example.com' };
const personas = { ok: true, personas: [{ name: 'Ines', role: 'A retired teacher' }, { name: 'Kofi', role: '' }] };

const stages = [];
after(() => { for (const dir of stages) rmSync(dir, { recursive: true, force: true }); });
function stagedStore() {
  const dir = mkdtempSync(path.join(tmpdir(), 'impeccable-store-'));
  stages.push(dir);
  stageStore(SOURCE, path.join(dir, 'extension'));
  return path.join(dir, 'extension');
}

for (const [label, account, asked, store] of [
  ['a browser without sign-in (Firefox)', undefined, false],
  ['a store-like build whose server answers 404', { status: { ok: true, available: false } }, true],
  // The store build has no account: its popup asks nothing, even of a server that takes sign-ins.
  ['the store build', { status: { ok: true, available: true, signedIn: true, email: 'mira@example.com' } }, false, true],
]) {
  test(`the popup is the detector alone in ${label}`, async () => {
    const h = await popup({ account, ...(store ? { root: stagedStore() } : {}) });
    assert.equal(h.messages.some((m) => m.account), asked);
    assert.equal(h.node('account-tabs').hidden, true);
    assert.equal(h.node('panel-scan').hidden, false);
    // The detector works as it always has.
    await h.click('btn-copy-all');
    assert.match(h.writes[0], /Total findings: 2/);
  });
}

// A build loaded unpacked shows its account screens before the server takes sign-ins: Sign in then asks nothing.
for (const [label, status, asks] of [
  ['the server takes sign-ins', { ok: true, available: true, signedIn: false }, true],
  ['a build loaded unpacked, before the server takes sign-ins', { ok: true, available: false, unpacked: true, server: 'https://api.impeccable.style' }, false],
]) {
  test(`signed out, the popup offers Settings and Sign in under every tab, and no Personas: ${label}`, async () => {
    const h = await popup({ account: { status, 'sign-in': { ok: false } } });
    assert.deepEqual([h.node('account-tabs').hidden, h.node('tab-personas').hidden, h.node('sign-in').hidden], [false, true, false]);
    assert.equal(h.node('panel-scan').hidden, false, 'Scan is open first');
    h.click('tab-settings');
    assert.deepEqual([h.node('panel-settings').hidden, h.node('panel-scan').hidden, h.node('sign-in').hidden, h.node('btn-sign-out').hidden], [false, true, false, true]);
    assert.equal(h.body.dataset.account, 'signed-out');
    await h.click('btn-sign-in');
    assert.equal(h.messages.some((m) => m.account === 'sign-in'), asks);
    assert.equal(h.node('account-error').hidden, false, 'it says why nothing happened');
  });
}

for (const [state, button] of [['ready', true], ['missing', false], ['old', false]]) {
  test(`Settings shows the walk helper ${state}`, async () => {
    const h = await popup({ account: { status: { ok: true, available: true, signedIn: false }, walks: { state } } });
    await tick();
    assert.deepEqual([h.node('helper-row').hidden, h.node('helper-row').dataset.state, h.node('btn-helper').hidden], [false, state, button]);
  });
}

test('signed in, the popup shows the email and lists the personas', async () => {
  const h = await popup({ account: { status: signedIn, personas } });
  assert.equal(h.node('tab-personas').hidden, false);
  h.click('tab-settings');
  assert.deepEqual([h.node('account-email').textContent, h.node('sign-in').hidden, h.node('btn-sign-out').hidden], ['mira@example.com', true, false]);
  h.click('tab-personas');
  await tick();
  assert.equal(h.node('panel-personas').hidden, false);
  assert.deepEqual(h.node('persona-list').children.map((row) => row.children[0].textContent), ['Ines', 'Kofi']);
  assert.equal(h.node('tab-personas').attributes['aria-selected'], 'true');
});

test('signed in with no personas, the Personas tab shows its note and nothing else', async () => {
  const h = await popup({ account: { status: signedIn, personas: { ok: true, personas: [] } } });
  h.click('tab-personas');
  await tick();
  assert.deepEqual([h.node('persona-list').children.length, h.node('personas-note').hidden], [0, false]);
  assert.equal(h.node('personas-note').textContent, vm.runInNewContext(`${readFileSync(path.join(SOURCE, 'popup/words.js'), 'utf8')}; IMPECCABLE_WORDS.popup.noPersonas`, {}));
});

// "Walk this tab": each persona with a slug, and every preset, starts a walk of the tab the popup was opened on.
for (const [label, answer, state] of [
  ['started', { ok: true }, 'started'],
  ['before the server has the door', { ok: false, why: 'unavailable' }, 'unavailable'],
]) {
  test(`a persona walks this tab from the Personas tab: ${label}`, async () => {
    const h = await popup({ account: { status: signedIn, personas: { ok: true, personas: [{ name: 'Ada', role: '', slug: 'ada' }, { name: 'Bo', role: '' }] }, walk: answer } });
    h.click('tab-personas');
    await tick();
    const walks = (list) => h.node(list).children.map((row) => row.children.find((child) => child.dataset.walk)?.dataset.walk ?? null);
    assert.deepEqual([...walks('persona-list')], ['own:ada', null], 'a persona the server gave no slug cannot be walked');
    assert.deepEqual([...walks('preset-list')], ['preset:ines', 'preset:kofi', 'preset:priya', 'preset:tomasz', 'preset:hana', 'preset:noor']);
    const row = h.node('preset-list').children[0];
    row.children.find((child) => child.dataset.walk).listeners.click();
    const form = row.children.find((child) => child.className === 'walk-form');
    assert.equal(form.hidden, false);
    form.children.find((child) => child.className === 'walk-task').value = '  Read the top story.  ';
    await form.listeners.submit({ preventDefault() {} });
    assert.deepEqual(JSON.parse(JSON.stringify(h.messages.filter((m) => m.account === 'walk'))), [{ account: 'walk', persona: { preset: 'ines' }, task: 'Read the top story.', tabId: 7 }]);
    assert.equal(form.dataset.state, state);
  });
}

// Create a persona, at the top of the Personas tab: each state the form can be in, as the worker answers.
const ROSA = { name: 'Rosa', role: 'A night-shift nurse', slug: 'rosa', mine: true };
async function personasTab(account) {
  const h = await popup({ account: { status: signedIn, personas: { ok: true, personas: [] }, ...account } });
  h.click('tab-personas');
  await tick();
  const [button, form] = h.node('persona-create').children;
  const [, box, buttons, note] = form.children;
  return { h, button, form, box, go: buttons.children[1], note };
}
for (const [label, typed, answer, state] of [
  ['empty', '  ', null, 'empty'],
  ['too short', 'Nurse', null, 'short'],
  ['at the limit', 'A night-shift nurse.', { ok: false, why: 'limit' }, 'limit'],
  ['out of today’s quota', 'A night-shift nurse.', { ok: false, why: 'quota' }, 'quota'],
  ['signed in before creating could be asked for', 'A night-shift nurse.', { ok: false, why: 'scope' }, 'scope'],
  ['not available yet', 'A night-shift nurse.', { ok: false, why: 'unavailable' }, 'unavailable'],
  ['failed', 'A night-shift nurse.', { ok: false, why: 'failed' }, 'failed'],
]) {
  test(`Create a persona: ${label}`, async () => {
    const { h, button, form, box, note } = await personasTab({ create: answer });
    button.listeners.click();
    assert.deepEqual([form.hidden, button.hidden], [false, true]);
    box.value = typed;
    await form.listeners.submit({ preventDefault() {} });
    await tick();
    assert.equal(form.dataset.state, state);
    assert.equal(h.messages.some((m) => m.account === 'create'), answer !== null, 'a description under eight characters is never sent');
    assert.equal(note.hidden, false, 'it says why');
  });
}

test('Create a persona: working, then done, with the new row first and its task box open', async () => {
  let release;
  let made = false;
  const { h, form, box, go, button } = await personasTab({
    create: () => new Promise((done) => { release = () => { made = true; done({ ok: true, persona: ROSA }); }; }),
    personas: () => ({ ok: true, personas: [{ name: 'Ada', role: '', slug: 'ada', mine: true }, ...(made ? [ROSA] : []), { name: 'Mira', role: '', slug: 'mira' }] }),
  });
  button.listeners.click();
  box.value = '  A night-shift nurse checking opening hours.  ';
  await form.listeners.submit({ preventDefault() {} });
  assert.deepEqual([form.dataset.state, go.disabled, box.disabled], ['working', true, true]);
  assert.deepEqual(h.messages.filter((m) => m.account === 'create').map((m) => m.description), ['A night-shift nurse checking opening hours.']);
  release();
  await tick(); await tick();
  assert.deepEqual([form.dataset.state, form.hidden, button.hidden], ['done', true, false]);
  const rows = h.node('persona-list').children;
  const walkOf = (row) => row.children.find((child) => child.dataset?.walk)?.dataset.walk;
  assert.deepEqual(rows.map(walkOf), ['mine:rosa', 'mine:ada', 'own:mira']);
  assert.equal(rows[0].children.find((child) => child.className === 'walk-form')?.hidden, false, 'the task box is open under it');
  const task = rows[0].children.find((child) => child.className === 'walk-form');
  task.children.find((child) => child.className === 'walk-task').value = 'Find the opening hours.';
  await task.listeners.submit({ preventDefault() {} });
  assert.deepEqual(JSON.parse(JSON.stringify(h.messages.filter((m) => m.account === 'walk').map((m) => m.persona))), [{ mine: 'rosa' }]);
});

test('a popup opened while a persona is being made waits for it', async () => {
  const { h, form, box } = await personasTab({ personas: { ok: true, personas: [], creating: 'A night-shift nurse.' }, create: new Promise(() => {}) });
  assert.deepEqual([form.dataset.state, box.value], ['working', 'A night-shift nurse.']);
  assert.deepEqual(h.messages.filter((m) => m.account === 'create').map((m) => m.description), ['A night-shift nurse.']);
});

test('Remove asks first, and Keep keeps them', async () => {
  let gone = false;
  const { h } = await personasTab({ personas: () => ({ ok: true, personas: gone ? [] : [ROSA, { name: 'Mira', role: '', slug: 'mira' }] }), remove: () => { gone = true; return { ok: true }; } });
  const [mine, app] = h.node('persona-list').children;
  assert.equal(app.children.some((child) => child.className === 'persona-remove'), false, 'only the person’s own can be removed');
  const remove = mine.children.find((child) => child.className === 'persona-remove');
  const confirm = mine.children.find((child) => child.className === 'persona-confirm');
  const act = (name) => confirm.children[1].children.find((child) => child.dataset.act === name);
  remove.listeners.click();
  assert.deepEqual([confirm.hidden, remove.hidden], [false, true]);
  act('keep').listeners.click();
  assert.deepEqual([confirm.hidden, h.messages.some((m) => m.account === 'remove')], [true, false]);
  remove.listeners.click();
  await act('remove').listeners.click();
  await tick();
  assert.deepEqual(h.messages.filter((m) => m.account === 'remove').map((m) => m.slug), ['rosa']);
  assert.equal(h.node('persona-list').children.length, 0, 'the list is read again');
});
