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

for (const [label, account, asked] of [
  ['a browser without sign-in (Firefox)', undefined, false],
  ['a build whose server answers 404', { status: { ok: true, available: false } }, true],
]) {
  test(`the popup is the detector alone in ${label}`, async () => {
    const h = await popup({ account });
    assert.equal(h.messages.some((m) => m.account), asked);
    // The detector works as it always has.
    await h.click('btn-copy-all');
    assert.match(h.writes[0], /Total findings: 2/);
  });
}

// Impeccable Pro, at the popup's foot: signed out it signs in, through the worker; before the server takes sign-ins it says so on the line.
for (const [label, status, asks] of [
  ['the server takes sign-ins', { ok: true, available: true, signedIn: false }, true],
  ['a build loaded unpacked, before the server takes sign-ins', { ok: true, available: false, unpacked: true, server: 'https://api.impeccable.style' }, false],
  // Signed in, and the server says the account has no Impeccable Pro: no side panel, and no second sign-in.
  ['an account the server says has no Pro', { ok: true, available: true, signedIn: true, pro: false }, false],
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
async function sidePanel({ view, status, signIn = { ok: false }, firstRunSeen = true, root = SOURCE, tab = 1, personas = [], plan = { ok: false }, walk = { ok: true } } = {}) {
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
  const local = { firstRunSeen };
  const session = { view };
  const changed = [];
  const activated = [];
  let front = tab;
  const area = (kept) => ({ async get(key) { return { [key]: kept[key] }; }, async set(values) { Object.assign(kept, values); }, async remove(key) { delete kept[key]; } });
  Object.assign(globalThis, {
    document, location: { search: '' }, addEventListener() {},
    chrome: {
      runtime: { async sendMessage(message) { sent.push(message); return { status, 'sign-in': signIn, personas: { ok: true, personas }, plan, walk }[message.account]; } },
      storage: { local: area(local), session: { ...area(session), onChanged: { addListener: (listener) => changed.push(listener) } } },
      action: { async openPopup() { opened.push('popup'); } },
      tabs: { async create(made) { opened.push(made); }, async query() { return [{ id: front, url: 'https://tidy.example/' }]; }, onActivated: { addListener: (listener) => activated.push(listener) } },
    },
  });
  await import(`${pathToFileURL(path.join(root, 'walks/panel/panel.js')).href}?n=${panels += 1}`);
  for (let n = 0; n < 5; n += 1) await tick();
  const acts = () => app.querySelectorAll('[data-act]').map((node) => node.attributes['data-act']);
  const show = async (next) => { for (const listener of changed) listener({ view: { newValue: next } }); await tick(); };
  const press = async (act) => { for (const listener of app.querySelector(`[data-act="${act}"]`).listeners.click) listener({}); for (let n = 0; n < 3; n += 1) await tick(); };
  const switchTo = async (id) => { front = id; for (const listener of activated) listener({ tabId: id }); for (let n = 0; n < 3; n += 1) await tick(); };
  return { app, body: document.body, sent, opened, local, session, acts, show, press, switchTo };
}

test('the side panel shows a finished walk on its own tab alone, with one button to its results naming the count', async () => {
  const { reduce } = await import('../extension/walks/view.js');
  const issues = [{ step: 5, page: '/edit.html', what: 'Not saved' }, { step: 8, page: '/', what: 'Gone at once' }];
  const replayUrl = 'https://impeccable.reviews/app/tidy/outings/o-1';
  const ended = [{ type: 'opened', name: 'Mira', tab: 7 }, { type: 'finish', outcome: { finished: true, issues }, replayUrl }].reduce(reduce, STUBS.waiting);
  const h = await sidePanel({ view: ended, status: signedIn, tab: 7 });
  const results = () => h.app.querySelector('[data-act="results"]');
  assert.deepEqual([h.body.dataset.screen, results().attributes['data-issues']], ['end', '2']);
  await h.switchTo(8);
  assert.equal(h.body.dataset.screen, 'home');
  await h.show({ ...STUBS.walking, tab: 7 });
  assert.deepEqual([h.body.dataset.screen, h.acts()], ['walking', ['stop']], 'a walk under way shows on every tab, with Stop alone');
  await h.show(ended);
  await h.switchTo(7);
  await h.press('results');
  assert.deepEqual([h.opened.map((made) => made.url), h.body.dataset.screen], [[replayUrl], 'home'], 'the results open, and the panel goes home');
  const later = await sidePanel({ view: ended, status: signedIn, tab: 8 });
  assert.equal(later.body.dataset.screen, 'home', 'opened later on another tab');
});

test('the side panel plans before it walks: Send asks for a plan, a risky one asks to go ahead, Start walk sends its id, Edit brings the words back', async () => {
  const plan = { id: 'p-1', risky: true, steps: [{ text: 'Add a to-do', risky: false }, { text: 'Delete it', risky: true }] };
  const h = await sidePanel({ view: STUBS.idle, status: signedIn, personas: [{ name: 'Mira', role: 'Studio manager', slug: 'mira', face: 'https://impeccable.reviews/m.jpg' }, { name: 'Alex', role: '', mine: true, slug: 'alex' }], plan: { ok: true, plan }, tab: 7 });
  assert.equal(h.body.dataset.screen, 'home');
  await h.press('pick-1');
  const box = h.app.querySelector('textarea');
  box.value = 'Add a to-do, then delete it.';
  await h.press('send');
  assert.deepEqual(JSON.parse(JSON.stringify(h.sent.filter((m) => m.account === 'plan'))), [{ account: 'plan', persona: { mine: 'alex' }, task: 'Add a to-do, then delete it.', tabId: 7 }]);
  assert.deepEqual([h.body.dataset.screen, h.app.querySelectorAll('[data-risky]').length, h.app.querySelectorAll('[data-confirm]').length], ['plan', 1, 1]);
  await h.press('edit');
  assert.deepEqual([h.body.dataset.screen, h.app.querySelector('textarea').value], ['home', 'Add a to-do, then delete it.']);
  await h.press('send');
  await h.press('start');
  assert.deepEqual(h.sent.filter((m) => m.account === 'walk').map((m) => [m.persona, m.plan, m.tabId, m.walker.name]), [[{ mine: 'alex' }, 'p-1', 7, 'Alex']]);
  const expired = await sidePanel({ view: STUBS.idle, status: signedIn, personas: [{ name: 'Mira', role: '', slug: 'mira' }], plan: { ok: true, plan }, walk: { ok: false, why: 'plan' } });
  expired.app.querySelector('textarea').value = 'Add a to-do.';
  await expired.press('send');
  await expired.press('start');
  assert.equal(expired.body.dataset.screen, 'home', 'a plan the server refuses goes back to the box');
});

test('a walk that ended with no results page to open offers the way home', async () => {
  const h = await sidePanel({ view: STUBS.stopped, status: signedIn, personas: [{ name: 'Mira', role: '', slug: 'mira' }] });
  assert.deepEqual([h.body.dataset.screen, h.acts().includes('results')], ['end', false]);
  await h.press('home');
  assert.equal(h.body.dataset.screen, 'home');
});

// The steps as the server lands them after a No: that deed and each one after it marked `no`; a deed the walk could not
// ask about marked `held`, which is not a No.
for (const [label, marks, named] of [['said No at step 2', { 2: 'no', 3: 'no' }, 2], ['could not ask at step 2', { 2: 'held' }, null]]) {
  test(`the side panel’s ending names the step only for a No: ${label}`, async () => {
    const { reduce } = await import('../extension/walks/view.js');
    const steps = [1, 2, 3].map((n) => ({ type: 'step', step: { n, did: marks[n] ? 'Didn’t click “Delete”' : 'Clicked “Add”', said: '', ...(marks[n] ? { refused: marks[n] } : {}) } }));
    const ended = [{ type: 'opened', name: 'Mira', tab: 7 }, ...steps, { type: 'finish', outcome: { finished: false, issues: [] } }].reduce(reduce, STUBS.waiting);
    const h = await sidePanel({ view: ended, status: signedIn, tab: 7 });
    const line = h.app.querySelector('p.line')?.textContent;
    if (named) assert.ok(line.includes(`step ${named}`));
    else assert.equal(line, undefined);
  });
}

// No walk running: never a dead end. Signed out, the panel signs in and then shows the personas; with no sign-in to be had, it asks again.
for (const [label, status, offers, store] of [
  ['signed out', { ok: true, available: true, signedIn: false }, 'sign-in'],
  ['signed out, in the store build', { ok: true, available: true, signedIn: false }, 'sign-in', true],
  ['a server that takes no sign-ins', { ok: true, available: false }, 'again'],
  // The server says who has Impeccable Pro: without it the panel offers the settings alone and asks for no personas.
  ['signed in to an account the server says has no Pro', { ok: true, available: true, signedIn: true, pro: false }, 'settings'],
]) {
  test(`with no walk running, the side panel offers ${offers}: ${label}`, async () => {
    const h = await sidePanel({ view: STUBS['signed-out'], status, signIn: { ...signedIn, ok: true }, personas: [{ name: 'Mira', role: '', slug: 'mira' }], ...(store ? { root: stagedStore() } : {}) });
    assert.deepEqual(h.acts(), [offers]);
    if (offers === 'settings') assert.deepEqual([h.body.dataset.screen, h.sent.some((m) => m.account === 'personas')], ['not-pro', false]);
    if (offers !== 'sign-in') return;
    await h.press(offers);
    assert.ok(h.sent.some((m) => m.account === 'sign-in'), 'the extension’s own sign-in');
    assert.deepEqual([h.body.dataset.account, h.body.dataset.screen, h.acts().includes('send')], ['signed-in', 'home', true]);
  });
}

test('the side panel offers nothing until the worker has said who is signed in', async () => {
  const h = await sidePanel({ view: STUBS['signed-out'], status: new Promise(() => {}) });
  assert.deepEqual(h.acts(), []);
});

test('the side panel’s first run shows once: Before you start, then the tab group, then the home, and the next panel opens home', async () => {
  const h = await sidePanel({ view: STUBS.idle, status: signedIn, firstRunSeen: false, personas: [{ name: 'Mira', role: '', slug: 'mira' }] });
  const seen = [h.body.dataset.screen];
  await h.press('got-it');
  seen.push(h.body.dataset.screen);
  await h.press('start-walking');
  seen.push(h.body.dataset.screen);
  assert.deepEqual([seen, h.local.firstRunSeen], [['before', 'tab-group', 'home'], true]);
  const next = await sidePanel({ view: STUBS.idle, status: signedIn, firstRunSeen: h.local.firstRunSeen, personas: [{ name: 'Mira', role: '', slug: 'mira' }] });
  assert.equal(next.body.dataset.screen, 'home');
});

