import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
async function popup({ initial = state(), deferState = false, account, root = SOURCE, session } = {}) {
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
  const HIDDEN = [];
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, element({ id, disabled: ['btn-copy-all', 'btn-toggle'].includes(id), hidden: HIDDEN.includes(id) }));
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
    setTimeout, clearTimeout,
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
      ...(session ? { storage: { session: { async get(key) { return { [key]: session[key] }; }, async remove(key) { delete session[key]; } } } } : {}),
      runtime: {
        onMessage: event('message'),
        sendMessage(message, callback) {
          messages.push(message);
          // An answer may be worked out from the message, and come later.
          if (message.account) { const answer = account[message.account]; void Promise.resolve(typeof answer === 'function' ? answer(message) : answer ?? { ok: false }).then(callback); return; }
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

test('popup copies all active-tab findings with its URL and says it did', async () => {
  const h = await popup();
  assert.equal(h.node('btn-copy-all').disabled, false);
  await h.click('btn-copy-all');
  assert.equal(h.writes.length, 1);
  assert.match(h.writes[0], /URL: https:\/\/example.test\/page\n/);
  assert.match(h.writes[0], /Total findings: 2/);
  assert.match(h.writes[0], /## Advisories \(1\)/);
  assert.equal(h.node('copy-label').textContent, 'Copied');
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
    assert.match(h.node('scan-error').textContent, /Scan/);
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
  assert.match(h.node('scan-error').textContent, /Couldn.*copy.*Try again/i);
  assert.equal(h.node('btn-copy-all').disabled, false);
  h.rejectCopy = false;
  await h.click('btn-copy-all');
  assert.equal(h.writes.length, 1);
  assert.equal(h.node('copy-label').textContent, 'Copied');
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
  assert.equal(h.node('copy-label').textContent, 'Copy all');
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
    assert.equal(h.node('toggle-label').textContent, 'Show outlines');
    assert.equal(h.node('btn-copy-all').disabled, true);
    h.broadcast({ action: 'findings-updated', tabId: 7, ...state() });
    assert.equal(h.node('toggle-label').textContent, 'Show outlines');
    await h.click('btn-toggle');
    assert.equal(h.node('toggle-label').textContent, 'Hide outlines');
  });
}

test('reopening restores scan progress and a failed scan message without old findings', async () => {
  const pending = await popup({ initial: { findings: [], url: '', scanComplete: false, scanning: true } });
  assert.equal(pending.node('count-number').textContent, '0');
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
  failed.broadcast({ action: 'scan-started', tabId: 7 });
  assert.equal(failed.node('scan-error').textContent, '');
});

const signedIn = { ok: true, available: true, signedIn: true, email: 'mira@example.com' };

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
    if (store) assert.equal(readFileSync(path.join(stagedStore(), 'popup/popup.html'), 'utf8').includes('btn-pro'), false, 'no Impeccable Pro button');
    // The detector works as it always has.
    await h.click('btn-copy-all');
    assert.match(h.writes[0], /Total findings: 2/);
  });
}

// Impeccable Pro, at the popup's foot: signed out it signs in, through the worker; before the server takes sign-ins it says so on the line.
for (const [label, status, asks] of [
  ['the server takes sign-ins', { ok: true, available: true, signedIn: false }, true],
  ['a build loaded unpacked, before the server takes sign-ins', { ok: true, available: false, unpacked: true, server: 'https://api.impeccable.style' }, false],
]) {
  test(`Impeccable Pro signs in: ${label}`, async () => {
    const h = await popup({ account: { status, 'sign-in': { ok: false } } });
    await h.click('btn-pro');
    assert.equal(h.messages.some((m) => m.account === 'sign-in'), asks);
    assert.notEqual(h.node('scan-error').textContent, '', 'it says why nothing happened');
  });
}

// The walk side panel (walks/panel/panel.js), run as a module against a stub DOM and a stubbed Chrome.
const { STUBS } = await import('../extension/walks/panel/stub.js');
let panels = 0;
async function sidePanel({ view, status, signIn = { ok: false }, onboarded = false, root = SOURCE, tab = 1 } = {}) {
  const make = (tag) => ({
    tagName: tag.toUpperCase(), children: [], attributes: {}, dataset: {}, listeners: {}, textContent: '', className: '', hidden: false, disabled: false,
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    addEventListener(type, callback) { (this.listeners[type] ??= []).push(callback); },
    append(...kids) { this.children.push(...kids.filter((kid) => typeof kid === 'object')); },
    replaceChildren(...kids) { this.children = []; this.append(...kids); },
    focus() { document.activeElement = this; },
    *nodes() { for (const kid of this.children) { yield kid; yield* kid.nodes(); } },
    // Enough of a selector for the panel: `tag`, `.class` and `[attr]` / `[attr="value"]`, one of each at most.
    querySelectorAll(selector) {
      const [, tag, cls, attr, value] = selector.match(/^([a-z]*)(?:\.([\w-]+))?(?:\[([\w-]+)(?:="([^"]*)")?\])?$/);
      return [...this.nodes()].filter((node) => (!tag || node.tagName === tag.toUpperCase()) && (!cls || node.className.split(' ').includes(cls))
        && (!attr || (value === undefined ? attr in node.attributes : node.attributes[attr] === value)));
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; },
  });
  const app = make('main');
  const document = { body: make('body'), activeElement: null, getElementById: () => app, createElement: make, createElementNS: (_, tag) => make(tag) };
  const sent = [];
  const opened = [];
  const local = { onboarded };
  const session = { view };
  const changed = [];
  const activated = [];
  let front = tab;
  const area = (kept) => ({ async get(key) { return { [key]: kept[key] }; }, async set(values) { Object.assign(kept, values); }, async remove(key) { delete kept[key]; } });
  Object.assign(globalThis, {
    document, location: { search: '' }, addEventListener() {},
    chrome: {
      runtime: { async sendMessage(message) { sent.push(message); return message.account === 'status' ? status : message.account === 'sign-in' ? signIn : undefined; } },
      storage: { local: area(local), session: { ...area(session), onChanged: { addListener: (listener) => changed.push(listener) } } },
      action: { async openPopup() { opened.push('popup'); } },
      tabs: { async create(made) { opened.push(made); }, async query() { return [{ id: front }]; }, onActivated: { addListener: (listener) => activated.push(listener) } },
    },
  });
  await import(`${pathToFileURL(path.join(root, 'walks/panel/panel.js')).href}?n=${panels += 1}`);
  for (let n = 0; n < 5; n += 1) await tick();
  const acts = () => app.querySelectorAll('[data-act]').map((node) => node.attributes['data-act']);
  const show = async (next) => { for (const listener of changed) listener({ view: { newValue: next } }); await tick(); };
  const press = async (act) => { for (const listener of app.querySelector(`[data-act="${act}"]`).listeners.click) listener({}); for (let n = 0; n < 3; n += 1) await tick(); };
  const switchTo = async (id) => { front = id; for (const listener of activated) listener({ tabId: id }); for (let n = 0; n < 3; n += 1) await tick(); };
  return { app, body: document.body, sent, opened, local, session, acts, show, press, switchTo, intro: () => app.querySelector('.intro') !== null };
}

test('the first walk ever shows its intro in the side panel, once, and opens no tab', async () => {
  const h = await sidePanel({ view: STUBS.idle, status: signedIn });
  assert.equal(h.intro(), false);
  await h.show(STUBS.walking);
  assert.deepEqual([h.intro(), h.local.onboarded, h.opened], [true, true, []]);
  await h.press('intro-ok');
  assert.equal(h.intro(), false);
  await h.show(STUBS.done);
  await h.show(STUBS.walking);
  assert.equal(h.intro(), false, 'not on the next walk');
  const later = await sidePanel({ view: STUBS.walking, status: signedIn, onboarded: true });
  assert.equal(later.intro(), false, 'not in a panel opened later');
});

test('the side panel shows a finished walk on its own tab alone, and a site’s root as no page', async () => {
  const { reduce } = await import('../extension/walks/view.js');
  const issues = [{ step: 5, page: '/edit.html', what: 'Not saved' }, { step: 8, page: '/', what: 'Gone at once' }];
  const ended = [{ type: 'opened', name: 'Mira', tab: 7 }, { type: 'finish', outcome: { finished: true, issues } }].reduce(reduce, STUBS.waiting);
  const h = await sidePanel({ view: ended, status: signedIn, tab: 7 });
  assert.deepEqual([h.body.dataset.state, h.app.querySelectorAll('.finding-selector').map((node) => node.textContent)], ['done', ['/edit.html']]);
  await h.switchTo(8);
  assert.deepEqual([h.body.dataset.state, h.acts().includes('personas')], ['idle', true]);
  await h.show({ ...STUBS.walking, tab: 7 });
  assert.equal(h.body.dataset.state, 'walking', 'a walk under way shows on every tab');
  await h.show(ended);
  await h.switchTo(7);
  assert.equal(h.body.dataset.state, 'done');
  const later = await sidePanel({ view: ended, status: signedIn, tab: 8 });
  assert.equal(later.body.dataset.state, 'idle', 'opened later on another tab');
});

// The steps as the server lands them after a No: that deed and each one after it marked `no`; a deed the walk could not
// ask about marked `held`, which is not a No.
for (const [label, marks, named] of [['said No at step 2', { 2: 'no', 3: 'no' }, 2], ['could not ask at step 2', { 2: 'held' }, null]]) {
  test(`the side panel’s ending names the step only for a No: ${label}`, async () => {
    const { reduce } = await import('../extension/walks/view.js');
    const { COPY } = await import('../extension/walks/panel/copy.js');
    const steps = [1, 2, 3].map((n) => ({ type: 'step', step: { n, did: marks[n] ? 'Didn’t click “Delete”' : 'Clicked “Add”', said: '', ...(marks[n] ? { refused: marks[n] } : {}) } }));
    const ended = [{ type: 'opened', name: 'Mira', tab: 7 }, ...steps, { type: 'finish', outcome: { finished: false, issues: [] } }].reduce(reduce, STUBS.waiting);
    const h = await sidePanel({ view: ended, status: signedIn, tab: 7 });
    const line = h.app.querySelector('p.line').textContent;
    if (named) assert.deepEqual([line.includes(`step ${named}`), line === COPY.done.unfinished('Mira', 0)], [true, false]);
    else assert.equal(line, COPY.done.unfinished('Mira', 0));
  });
}

// No walk running: never a dead end. With the account the popup uses, the panel signs in or points at Personas.
for (const [label, status, offers] of [
  ['signed out', { ok: true, available: true, signedIn: false }, 'sign-in'],
  ['signed in', signedIn, 'personas'],
  ['a server that takes no sign-ins', { ok: true, available: false }, null],
]) {
  test(`with no walk running, the side panel offers the terminal and ${offers ?? 'nothing else'}: ${label}`, async () => {
    const h = await sidePanel({ view: STUBS['signed-out'], status, signIn: { ...signedIn, ok: true } });
    assert.deepEqual(h.acts().filter((act) => act !== 'copy'), offers ? [offers] : []);
    assert.ok(h.acts().includes('copy'));
    if (!offers) return;
    await h.press(offers);
    if (offers === 'sign-in') {
      assert.ok(h.sent.some((m) => m.account === 'sign-in'), 'the extension’s own sign-in');
      assert.deepEqual([h.body.dataset.account, h.acts().includes('personas')], ['signed-in', true]);
    } else {
      assert.deepEqual([h.opened, h.session.popupTab], [['popup'], 'personas']);
    }
  });
}

test('the store build’s side panel asks nothing of an account and offers only the terminal', async () => {
  const h = await sidePanel({ view: STUBS['signed-out'], status: signedIn, root: stagedStore() });
  assert.deepEqual([h.sent.filter((m) => m.account), h.acts(), h.body.dataset.account], [[], ['copy'], 'off']);
});
