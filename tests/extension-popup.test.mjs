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
            // `initial` may answer per tab: a function of the tab asked about.
            else callback(typeof initial === 'function' ? initial(message.tabId) : initial);
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
  h.activate = async tab => { h.tab = tab; listeners.activated({ tabId: tab.id, windowId: 1 }); await tick(); };
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

// Catches the side panel's Scan, which stays open across tabs, showing and taking the first tab's findings.
test('Scan follows the front tab: its saved findings, and only its updates', async () => {
  const other = 'https://example.test/other';
  const h = await popup({ initial: tabId => (tabId === 8 ? { findings: [], url: other, scanComplete: true } : state()) });
  assert.equal(h.node('count-number').textContent, '2');
  await h.activate({ id: 8, url: other, status: 'complete' });
  assert.deepEqual([h.node('count-number').textContent, h.node('btn-copy-all').disabled], ['0', false], 'the new tab’s clean scan');
  h.broadcast({ action: 'findings-updated', tabId: 7, ...state() });
  assert.equal(h.node('count-number').textContent, '0', 'the tab left behind writes nothing here');
  h.broadcast({ action: 'findings-updated', tabId: 8, ...state(), url: other });
  assert.equal(h.node('count-number').textContent, '2');
});

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

// The popup is Firefox's alone (Chrome has the side panel, which holds Scan): the detector, asking nothing of an
// account even where one answers.
test('the popup is the detector alone, with no account', async () => {
  const h = await popup({ account: { status: { ok: true, available: true, signedIn: true, email: 'mira@example.com' } } });
  assert.equal(h.messages.some((m) => m.account), false);
  assert.equal(readFileSync(path.join(SOURCE, 'popup/popup.html'), 'utf8').includes('btn-pro'), false, 'no Impeccable Pro button');
  await h.click('btn-copy-all');
  assert.match(h.writes[0], /Total findings: 2/);
});

// The walk side panel (walks/panel/panel.js), run as a module against a stub DOM and a stubbed Chrome.
const where = (h) => h.app.querySelector('span.where')?.children[0]?.textContent ?? '';
const { STUBS } = await import('../extension/walks/panel/stub.js');
let panels = 0;
async function sidePanel({ view, status, signIn = { ok: false }, firstRunSeen = true, root = SOURCE, tab = 1, personas = [], apps = { ok: false }, cast = [], plan = { ok: false }, walk = { ok: true }, create = { ok: false }, remove = { ok: true }, journeys = { ok: false }, control = {}, mic = null, appForSite, hold = {}, connected, search = '', url = 'https://tidy.example/' } = {}) {
  const make = (tag) => ({
    tagName: tag.toUpperCase(), children: [], attributes: {}, dataset: {}, listeners: {}, textContent: '', className: '', hidden: false, disabled: false,
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    addEventListener(type, callback) { (this.listeners[type] ??= []).push(callback); },
    // A node lives in one place, as in a page: appending it elsewhere takes it from its old parent.
    append(...kids) { for (const kid of kids.filter((k) => typeof k === 'object')) { if (kid.parentElement && kid.parentElement !== this) kid.parentElement.children = kid.parentElement.children.filter((k) => k !== kid); kid.parentElement = this; this.children.push(kid); } },
    replaceChildren(...kids) { for (const kid of this.children) kid.parentElement = null; this.children = []; this.append(...kids); },
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
  // panel.html's Scan box sits in the page beside #app, found only while it is still in the page.
  const scanBox = make('section');
  scanBox.attributes.id = 'panel-scan';
  const body = make('body');
  body.append(app, scanBox);
  const document = { body, activeElement: null, getElementById: (id) => id === 'panel-scan' ? [...body.nodes()].find((n) => n.attributes.id === 'panel-scan') ?? null : app, createElement: make, createElementNS: (_, tag) => make(tag) };
  const sent = [];
  const opened = [];
  const local = { firstRunSeen, appForSite };
  const session = { view, connected };
  const changed = [];
  const activated = [];
  const updated = [];
  let front = tab, at = url;
  const area = (kept) => ({ async get(key) { return { [key]: kept[key] }; }, async set(values) { Object.assign(kept, values); }, async remove(key) { delete kept[key]; } });
  Object.assign(globalThis, {
    document, location: { search }, addEventListener() {},
    chrome: {
      // A persona made is in the list from then on, as the worker's is; one removed is gone from it. The account comes
      // as a copy, as a message does: a test changes it for the next answer only.
      runtime: { getManifest: () => ({ version: '9.9.9' }), async openOptionsPage() { opened.push('options'); }, async sendMessage(message) { sent.push(message); if (message.control) return control[message.control]; await hold[message.account]; if (message.account === 'create' && create.ok) personas.push(create.persona); if (message.account === 'remove' && remove.ok) personas.splice(personas.findIndex((p) => p.mine && p.slug === message.slug) >>> 0, 1); return { status: status && { ...status }, 'sign-in': signIn, personas: message.app ? { ok: true, personas: cast } : { ok: true, personas }, apps, plan, walk, create, remove, journeys }[message.account]; } },
      storage: { local: area(local), session: { ...area(session), onChanged: { addListener: (listener) => changed.push(listener) } } },
      action: { async openPopup() { opened.push('popup'); } },
      tabs: { async create(made) { opened.push(made); }, async query() { return [{ id: front, url: at }]; }, onActivated: { addListener: (listener) => activated.push(listener) }, onUpdated: { addListener: (listener) => updated.push(listener) } },
    },
  });
  // `mic`: a browser that hears (speech recognition, the microphone given) and whose mic level can be read; it counts
  // the streams opened and ended, the frames asked for and cancelled, and the audio contexts closed.
  Object.assign(globalThis, mic ? {
    webkitSpeechRecognition: class { start() { mic.heard = this; this.onstart?.(); } stop() { this.onend?.(); } abort() {} },
    AudioContext: class { createAnalyser() { return { getByteTimeDomainData() {} }; } createMediaStreamSource() { return { connect() {} }; } async close() { mic.closed += 1; } },
    requestAnimationFrame: () => { mic.frames += 1; return mic.frames; },
    cancelAnimationFrame: () => { mic.cancelled += 1; },
  } : { webkitSpeechRecognition: undefined, AudioContext: undefined });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: { language: 'en-GB', permissions: { query: async () => ({ state: 'granted' }) },
    mediaDevices: { async getUserMedia() { mic.opened += 1; return { getTracks: () => [{ stop() { mic.stopped += 1; } }] }; } } } });
  await import(`${pathToFileURL(path.join(root, 'walks/panel/panel.js')).href}?n=${panels += 1}`);
  for (let n = 0; n < 5; n += 1) await tick();
  const acts = () => app.querySelectorAll('[data-act]').map((node) => node.attributes['data-act']);
  const show = async (next) => { for (const listener of changed) listener({ view: { newValue: next } }); await tick(); };
  const press = async (act) => { for (const listener of app.querySelector(`[data-act="${act}"]`).listeners.click) listener({}); for (let n = 0; n < 3; n += 1) await tick(); };
  const switchTo = async (id, next = at) => { front = id; at = next; for (const listener of activated) listener({ tabId: id }); for (let n = 0; n < 3; n += 1) await tick(); };
  // The tab in front commits another address.
  const navigate = async (next) => { at = next; for (const listener of updated) listener(front, { url: next }); await tick(); };
  return { app, body: document.body, sent, opened, local, session, acts, show, press, switchTo, navigate };
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
  const back = await sidePanel({ view: ended, status: signedIn, tab: 7 });
  await back.press('back');
  assert.deepEqual([back.body.dataset.screen, back.opened], ['home', []], 'Back in the top row goes home and opens nothing');
});

// Catches a paused screen that never tells the person to take over when a passkey or phone sign-in was held.
test('the side panel’s sign-in pause says how else to sign in only once a write was held, and not after Continue', async () => {
  const { reduce } = await import('../extension/walks/view.js');
  const h = await sidePanel({ view: STUBS['paused-sign-in'], status: signedIn, control: { resume: { ok: false, why: 'sign-in' } } });
  const hinted = () => [h.acts(), h.app.querySelectorAll('[data-hint="stop-and-restart"]').length];
  const why = () => h.app.querySelectorAll('[data-refused]').map((node) => node.attributes['data-refused']);
  const resume = () => h.app.querySelector('[data-act="resume"]').textContent;
  const atSignIn = resume();
  await h.show(STUBS.paused);
  assert.notEqual(resume(), atSignIn, 'a sign-in pause names its Continue apart from a plain pause, the same command');
  await h.show(STUBS['paused-sign-in']);
  assert.deepEqual(hinted(), [['resume', 'stop'], 0], 'no write held');
  // Continue refused (the worker answers no `ok`): the pause is drawn again as it stands, here with a write held.
  h.session.view = STUBS['paused-sign-in-held'];
  await h.press('resume');
  assert.deepEqual([...hinted(), why(), document.activeElement?.attributes['data-act']], [['resume', 'stop'], 1, ['sign-in'], 'resume'], 'why it was refused, no new control, focus kept');
  await h.show(reduce(STUBS['paused-sign-in-held'], { type: 'resume' }));
  assert.deepEqual([...hinted(), why()], [['stop'], 0, []], 'gone once the walk goes on');
});

// A walk started from the terminal or the walk page has no persona picked here: its face is the one the server sends.
test('the side panel wears the face the server sends for a walk started elsewhere, and the letter without one', async () => {
  const { reduce } = await import('../extension/walks/view.js');
  const face = 'data:image/jpeg;base64,/9j/AAAA';
  const shown = async (persona) => {
    const h = await sidePanel({ view: reduce(STUBS.walking, { type: 'brief', persona }), status: signedIn });
    const head = h.app.querySelector('.walk-head').children.find((node) => node.className.split(' ').includes('face'));
    return [String(head.attributes.style).includes(`url("${face}")`), head.children.length];
  };
  assert.deepEqual(await shown({ name: 'Talia', role: 'Employee', face }), [true, 0]);
  assert.deepEqual(await shown({ name: 'Talia', role: 'Employee', face: 'https://elsewhere.example/t.jpg' }), [false, 1], 'only a data: picture');
});

// The list keeps its rows, so they can slide to their new places rather than being drawn again.
test('the side panel’s steps list keeps its rows as a step comes, and the current step is the newest', async () => {
  const { reduce } = await import('../extension/walks/view.js');
  const h = await sidePanel({ view: STUBS.walking, status: signedIn });
  const rows = () => h.app.querySelector('.sofar').children;
  const before = [...rows()];
  await h.show(reduce(STUBS.walking, { type: 'step', step: { n: 7, did: 'Clicked “Delete”' } }));
  const after = rows();
  assert.deepEqual([after.length, after.slice(1).every((row, i) => row === before[i]), after.filter((row) => row.className === 'now').map((row) => row.attributes['data-n'])],
    [before.length + 1, true, ['7']]);
});

test('the side panel’s Sees tips give the figure for the picked persona’s age band, and name them only when the card gives an age', async () => {
  const personas = [{ name: 'Zoe', role: 'A 24-year-old design student', slug: 'zoe' }, { name: 'Ben', role: 'A 70-year-old retired builder', slug: 'ben' }, { name: 'Ada', role: 'A mum with a 3-year-old', slug: 'ada' }];
  const h = await sidePanel({ view: STUBS.idle, status: signedIn, personas });
  const facts = () => ['normal', 'older'].map((sees) => h.app.querySelector(`[data-act="sees-${sees}"]`).attributes['aria-description']);
  const seen = [];
  for (const [i, who] of personas.entries()) {
    await h.press(`pick-${i}`);
    seen.push(facts().map((fact) => [fact.match(/\d+ in \d+/)[0], fact.includes(who.name)]));
  }
  assert.deepEqual(seen, [
    [['5 in 10', true], ['1 in 100', true]],
    [['8 in 10', true], ['4 in 10', true]],
    [['6 in 10', false], ['2 in 10', false]],
  ]);
});

// Catches the Sees figures staying general when a persona just made gets its age from the profile after reaching home.
test('the side panel’s Sees figures follow a profile that arrives after the persona reaches home', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const personas = [{ name: 'Maya', role: '', slug: 'default:maya', default: true }];
  const h = await sidePanel({ view: STUBS.idle, status: signedIn, personas, create: { ok: true, persona: { name: 'Nora', role: 'Night nurse', slug: 'nora', mine: true } } });
  await h.press('make-persona');
  h.app.querySelector('textarea').value = 'A night-shift nurse checking HR forms on break.';
  await h.press('make');
  await h.press('confirm');
  const fact = () => h.app.querySelector('[data-act="sees-normal"]').attributes['aria-description'];
  assert.equal(fact().includes('Nora'), false);
  personas[1] = { ...personas[1], about: 'A 24-year-old nurse on nights.' };
  t.mock.timers.tick(3000);
  for (let n = 0; n < 5; n += 1) await tick();
  assert.deepEqual([fact().match(/\d+ in \d+/)[0], fact().includes('Nora')], ['5 in 10', true]);
});

test('the side panel plans before it walks: Send asks for a plan, a risky one asks to go ahead, Start walk sends its id, Edit brings the words back', async (t) => {
  // Alex, their own, has no face yet: the panel's waits for it run on these timers.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const plan = { id: 'p-1', risky: true, steps: [{ text: 'Add a to-do', risky: false }, { text: 'Delete it', risky: true }] };
  const h = await sidePanel({ view: STUBS.idle, status: signedIn, personas: [{ name: 'Mira', role: 'Studio manager', slug: 'mira', face: 'https://impeccable.reviews/m.jpg' }, { name: 'Alex', role: '', mine: true, slug: 'alex', sees: 'colour-blind' }, { name: 'Maya', role: '', slug: 'default:maya', default: true, device: 'mobile' }], plan: { ok: true, plan }, tab: 7 });
  assert.equal(h.body.dataset.screen, 'home');
  await h.press('pick-2');
  assert.equal(h.app.querySelector('[data-act="size-phone"]').attributes['aria-pressed'], 'true', 'the card’s own screen is filled in');
  await h.press('pick-1');
  const pressed = (act) => h.app.querySelector(`[data-act="${act}"]`).attributes['aria-pressed'];
  assert.deepEqual([pressed('sees-colour-blind'), pressed('size-desktop')], ['true', 'true'], 'the card’s own sight is filled in, and the person’s own screen is back');
  const box = h.app.querySelector('textarea');
  box.value = 'Add a to-do, then delete it.';
  await h.press('send');
  assert.deepEqual(JSON.parse(JSON.stringify(h.sent.filter((m) => m.account === 'plan'))), [{ account: 'plan', persona: { mine: 'alex' }, task: 'Add a to-do, then delete it.', tabId: 7, device: 'desktop' }]);
  assert.deepEqual([h.body.dataset.screen, h.app.querySelectorAll('[data-risky]').length, h.app.querySelectorAll('[data-confirm]').length], ['plan', 1, 1]);
  await h.press('edit');
  assert.deepEqual([h.body.dataset.screen, h.app.querySelector('textarea').value], ['home', 'Add a to-do, then delete it.']);
  await h.press('sees-older');
  await h.press('send');
  await h.press('start');
  // How the persona sees goes with the journey: the one picked for it, and the next journey starts from the card again.
  assert.deepEqual(h.sent.filter((m) => m.account === 'walk').map((m) => [m.persona, m.plan, m.tabId, m.walker.name, m.sees]), [[{ mine: 'alex' }, 'p-1', 7, 'Alex', 'older']]);
  await h.show(STUBS.stopped);
  await h.press('home');
  assert.equal(pressed('sees-colour-blind'), 'true');
  const expired = await sidePanel({ view: STUBS.idle, status: signedIn, personas: [{ name: 'Mira', role: '', slug: 'mira' }], plan: { ok: true, plan }, walk: { ok: false, why: 'plan' } });
  assert.equal(expired.app.querySelector('[data-act="sees-normal"]').attributes['aria-pressed'], 'true', 'a card that says nothing sees normally');
  await expired.press('sees-older');
  expired.app.querySelector('textarea').value = 'Add a to-do.';
  await expired.press('send');
  await expired.press('start');
  assert.deepEqual([expired.body.dataset.screen, expired.sent.find((m) => m.account === 'walk').sees], ['home', 'older'], 'a plan the server refuses goes back to the box');
});

// + opens Make a persona: a description makes one, and Use them picks it; a refusal says why and keeps the words.
for (const [label, create] of [['made', { ok: true, persona: { name: 'Rosa', role: 'A night-shift nurse', slug: 'rosa', mine: true } }], ['refused', { ok: false, why: 'limit', max: 3 }]]) {
  test(`the side panel makes a persona from a description: ${label}`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    // A list that came back empty is one that didn't load: never an empty home.
    const empty = await sidePanel({ view: STUBS.idle, status: signedIn, personas: [] });
    assert.deepEqual(empty.acts().filter((act) => act === 'retry' || act === 'make-persona'), ['retry']);
    // Three of their own, the server's limit: the + says why and opens nothing.
    const full = await sidePanel({ view: STUBS.idle, status: signedIn, personas: ['rosa', 'theo', 'june'].map((slug) => ({ name: slug, role: '', slug, mine: true })) });
    await full.press('make-persona');
    assert.deepEqual([full.body.dataset.screen, full.app.querySelector('[data-act="make-persona"]').attributes['aria-disabled']], ['home', 'true']);
    const h = await sidePanel({ view: STUBS.idle, status: signedIn, personas: [{ name: 'Maya', role: '', slug: 'default:maya', default: true }], create });
    await h.press('make-persona');
    assert.deepEqual([h.body.dataset.screen, Boolean(h.app.querySelector('.intro'))], ['make', true]);
    // A phone, and one disability, each pressed straight away: the one chosen, picked again, goes back to none.
    await h.press('device-phone');
    for (const key of ['low-vision', 'low-vision', 'blind', 'low-vision']) await h.press(`need-${key}`);
    assert.deepEqual(['device-phone', 'need-low-vision', 'need-blind'].map((act) => h.app.querySelector(`[data-act="${act}"]`).attributes['aria-pressed']), ['true', 'true', 'false']);
    h.app.querySelector('textarea').value = '  A night-shift nurse who books shifts on her phone.  ';
    await h.press('make');
    assert.deepEqual(h.sent.filter((m) => m.account === 'create'), [{ account: 'create', description: 'A night-shift nurse who books shifts on her phone.', device: 'phone', disability: 'low-vision' }]);
    if (create.ok) {
      assert.deepEqual(h.acts().filter((act) => act !== 'make'), ['confirm'], 'Confirm is the only way on');
      const traits = h.app.querySelector('.traits').attributes;
      assert.deepEqual([traits['data-device'], traits['data-disability']], ['phone', 'low-vision'], 'the made persona shows what was picked');
      await h.press('confirm');
      assert.deepEqual([h.body.dataset.screen, h.app.querySelector('[data-act="pick-0"]').attributes['aria-pressed']], ['home', 'true'], 'first in the grid, picked');
      h.app.querySelector('textarea').value = 'Book a shift.';
      await h.press('send');
      assert.deepEqual(h.sent.filter((m) => m.account === 'plan').map((m) => m.persona), [{ mine: 'rosa' }], 'the new persona is the one picked');
    } else {
      assert.ok(h.app.querySelector('[role="alert"]'), 'it says why');
      assert.equal(h.app.querySelector('textarea').value, 'A night-shift nurse who books shifts on her phone.');
    }
  });
}

// Catches the intro starting over on a redraw (the person's apps arriving), or carrying on from last time when the screen opens again.
test('the persona intro carries on through a redraw and starts over when Create a persona opens again', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  const hold = {};
  let answer;
  hold.apps = new Promise((resolve) => { answer = resolve; });
  const h = await sidePanel({ view: STUBS.idle, status: signedIn, personas: [{ name: 'Maya', role: '', slug: 'default:maya', default: true }], apps: { ok: true, apps: [] }, hold });
  // How long until the last face comes in.
  const lastFace = () => parseInt(h.app.querySelectorAll('img.intro-pic').at(-1).attributes.style.split(':')[1], 10);
  await h.press('make-persona');
  const start = lastFace();
  t.mock.timers.tick(3000);
  answer();
  for (let n = 0; n < 5; n += 1) await tick();
  assert.equal(lastFace(), start - 3000);
  await h.press('back');
  await h.press('make-persona');
  assert.equal(lastFace(), start);
});

// Catches the box under the intro shown (and pressable) while the intro plays, never coming back, or held back where
// motion is reduced, from the start or from partway through.
for (const reduced of ['never', 'from the start', 'partway']) {
  test(`Create a persona's box waits out the intro, reduced motion ${reduced}`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
    const motion = { matches: reduced === 'from the start', changed: [] };
    globalThis.matchMedia = () => ({ get matches() { return motion.matches; }, addEventListener: (_, listener) => motion.changed.push(listener) });
    t.after(() => { delete globalThis.matchMedia; });
    const h = await sidePanel({ view: STUBS.idle, status: signedIn, personas: [{ name: 'Maya', role: '', slug: 'default:maya', default: true }] });
    const held = () => 'inert' in h.app.querySelector('.box').attributes;
    await h.press('make-persona');
    t.mock.timers.tick(3000);
    if (reduced === 'partway') { assert.equal(held(), true); motion.matches = true; for (const listener of motion.changed) listener(); }
    t.mock.timers.tick(12000);
    assert.deepEqual([Boolean(h.app.querySelector('.intro')), held()], [true, reduced === 'never']);
    t.mock.timers.tick(5000);
    assert.equal(held(), false, 'the intro over, the box is within reach');
  });
}

// Catches a persona just made keeping its letter after the server has drawn its photo: the panel never asked again.
test('the side panel asks for the personas again until each of the person’s own has its face, swaps it in where the letter was, and stops', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const photo = 'data:image/jpeg;base64,/9j/AAAA';
  const maya = { name: 'Maya', role: '', slug: 'default:maya', default: true };
  const wait = async (ms) => { t.mock.timers.tick(ms); for (let n = 0; n < 5; n += 1) await tick(); };
  const asks = (h) => h.sent.filter((m) => m.account === 'personas').length;
  const faces = (h, slug) => h.app.querySelectorAll('span.face').filter((node) => node.attributes['data-face'] === slug).map((node) => [String(node.attributes.style).includes(`url("${photo}")`), node.children.length]);

  const personas = [maya];
  const h = await sidePanel({ view: STUBS.idle, status: signedIn, personas, create: { ok: true, persona: { name: 'Nora', role: 'Night nurse', slug: 'nora', mine: true } } });
  await h.press('make-persona');
  h.app.querySelector('textarea').value = 'A night-shift nurse checking HR forms on break.';
  await h.press('make');
  const made = asks(h);
  const about = () => h.app.querySelector('.hero[data-slug="nora"]')?.children.find((node) => node.className === 'about')?.textContent;
  assert.deepEqual([faces(h, 'nora'), about()], [[[false, 1]], 'Night nurse'], 'Confirm shows the letter while the photo is drawn, and the role until the profile comes');
  // The create answers no profile; the list asked for the face carries it (the full one the server drafted).
  personas[1] = { ...personas[1], about: 'Works nights; checks forms on a phone between rounds.' };
  const hero = h.app.querySelector('.hero[data-slug="nora"]');
  await wait(3000);
  assert.deepEqual([asks(h), faces(h, 'nora'), h.sent.filter((m) => m.account === 'personas').at(-1).faceless, about(), h.app.querySelector('.hero[data-slug="nora"]') === hero], [made + 1, [[false, 1]], ['nora'], personas[1].about, true], 'a list without the face is asked for again, with only the faceless one’s face, and its profile shows in place');
  personas[1] = { ...personas[1], face: photo };
  await wait(6000);
  const confirm = h.app.querySelector('[data-act="confirm"]');
  assert.deepEqual([asks(h), faces(h, 'nora'), h.app.querySelector('[data-act="confirm"]')], [made + 2, [[true, 0]], confirm], 'the photo is swapped in, nothing redrawn');
  await h.press('confirm');
  assert.deepEqual([faces(h, 'nora'), String(h.app.querySelector('[data-act="pick-0"]').children[0].attributes.style).includes(photo), about()], [[], true, personas[1].about], 'the home’s hero and tile wear the photo, the hero the profile');
  await wait(60_000);
  assert.equal(asks(h), made + 2, 'every own persona has a face: no more asks');

  // An own persona whose photo never comes: four asks, then none, a list that doesn't come included; and none once the panel leaves the home.
  const down = Promise.reject(new Error('down'));
  down.catch(() => undefined);
  for (const [label, leave, expected] of [['stays home', null, 4], ['the list fails', 'fail', 4], ['opens History', 'history', 0]]) {
    const hold = {};
    const home = await sidePanel({ view: STUBS.idle, status: signedIn, personas: [{ name: 'Rosa', role: '', slug: 'rosa', mine: true }, maya], hold });
    const loaded = asks(home);
    if (leave === 'fail') hold.personas = down;
    else if (leave) await home.press(leave);
    for (const ms of [3000, 6000, 12000, 20000, 60_000]) await wait(ms);
    assert.equal(asks(home) - loaded, expected, label);
  }
});

// Six personas or fewer (+ the seventh tile): four to a row, larger. More: five to a row.
for (const [people, rows] of [[3, [4]], [4, [3, 2]], [5, [3, 3]], [6, [4, 3]], [7, [5, 3]]]) {
  test(`the side panel's grid of ${people} personas and the + is rows of ${rows.join(' and ')}`, async () => {
    const personas = Array.from({ length: people }, (_, i) => ({ name: `P${i}`, role: '', slug: `p${i}` }));
    const h = await sidePanel({ view: STUBS.idle, status: signedIn, personas });
    const drawn = h.app.querySelectorAll('.cast-row');
    assert.deepEqual([drawn.map((row) => row.children.length), drawn.at(-1).children.at(-1).attributes['data-act']], [rows, 'make-persona']);
  });
}

// The tab's address decides whose personas: an app's, or the six defaults. Make a persona's link opens a modal of the
// person's apps: an app's own cast (without the defaults) becomes the grid, first picked, and stays for that address.
// A local address always has the six defaults: the app is for that pick only, and one kept there before is ignored.
for (const [site, kept] of [['https://tidy.example', true], ['http://127.0.0.1:5190', false], ['http://hr.test:3000', false]]) {
  test(`the side panel asks for the personas of ${site}, uses an app’s personas there once chosen, and ${kept ? 'keeps' : 'does not keep'} that choice`, async () => {
    const maya = { name: 'Maya', role: '', slug: 'default:maya', default: true };
    const tidy = { workspace: 'acme', repo: 'tidy', app: 'web', name: 'Tidy' };
    const cast = [maya, { name: 'Mira', role: '', slug: 'mira', app: tidy }, { name: 'Alex', role: '', slug: 'alex', app: tidy }];
    const h = await sidePanel({ view: STUBS.idle, status: signedIn, personas: [maya], apps: { ok: true, apps: [tidy] }, cast, url: `${site}/` });
    assert.equal(h.sent.find((m) => m.account === 'personas').url, site);
    await h.press('make-persona');
    await h.press('from-app');
    await h.press('apps');
    await h.press('app-0');
    assert.deepEqual(h.sent.at(-1), { account: 'personas', app: { workspace: 'acme', repo: 'tidy', app: 'web' } });
    assert.equal(h.app.querySelectorAll('span.cast-one').length, 2, 'the app’s own cast, not the defaults');
    await h.press('use-these');
    assert.deepEqual([h.body.dataset.screen, h.app.querySelector('[data-act="pick-0"]').attributes['aria-label'], h.app.querySelector('[data-act="pick-0"]').attributes['aria-pressed']], ['home', 'Mira', 'true']);
    h.app.querySelector('textarea').value = 'Add a to-do.';
    await h.press('send');
    assert.deepEqual(h.sent.filter((m) => m.account === 'plan').map((m) => m.persona), [{ own: 'mira', app: tidy }], 'an app persona goes with its app');
    assert.equal(Boolean(h.local.appForSite?.[site]), kept);
    // The next panel on this address, with that app kept for it (from before, on a local one): its personas, or the defaults.
    const next = await sidePanel({ view: STUBS.idle, status: signedIn, personas: [maya], cast, appForSite: { [site]: tidy }, url: `${site}/` });
    assert.deepEqual([next.app.querySelector('[data-act="pick-0"]').attributes['aria-label'], next.sent.some((m) => m.account === 'personas' && m.app)], kept ? ['Mira', true] : ['Maya', false]);
  });
}

// "Use a persona from your app" is there only once an app of the person's has personas of its own: not while the apps
// come, not with no apps, not with apps that have none (the six defaults are not theirs).
for (const [what, apps, cast, shown] of [
  ['no apps', [], [], false],
  ['apps with no personas', [{ workspace: 'acme', repo: 'tidy', app: 'web', name: 'Tidy' }, { workspace: 'acme', repo: 'tidy', app: 'admin', name: 'Admin' }], [{ name: 'Maya', role: '', slug: 'default:maya', default: true }], false],
  ['an app with personas', [{ workspace: 'acme', repo: 'tidy', app: 'web', name: 'Tidy' }], [{ name: 'Mira', role: '', slug: 'mira', app: { workspace: 'acme', repo: 'tidy', app: 'web' } }], true],
]) {
  test(`Make a persona offers an app's personas ${shown ? 'for' : 'not for'} ${what}`, async () => {
    const hold = {};
    const h = await sidePanel({ view: STUBS.idle, status: signedIn, personas: [{ name: 'Maya', role: '', slug: 'default:maya', default: true }], apps: { ok: true, apps }, cast, hold });
    let answer;
    hold.apps = new Promise((resolve) => { answer = resolve; });
    await h.press('make-persona');
    assert.equal(h.acts().includes('from-app'), false, 'not while the apps come');
    answer();
    for (let n = 0; n < 5; n += 1) await tick();
    assert.deepEqual([h.acts().includes('from-app'), h.sent.filter((m) => m.account === 'personas' && m.app).length], [shown, apps.length]);
  });
}

// At the limit of their own, an app's personas are still there to pick: the + opens Make a persona with the app's
// option and no way to make one; with no app that has personas, the + stays greyed.
for (const [what, apps, cast, open] of [
  ['an app with personas', [{ workspace: 'acme', repo: 'tidy', app: 'web', name: 'Tidy' }], [{ name: 'Mira', role: '', slug: 'mira', app: { workspace: 'acme', repo: 'tidy', app: 'web' } }], true],
  ['no app with personas', [{ workspace: 'acme', repo: 'tidy', app: 'web', name: 'Tidy' }], [], false],
]) {
  test(`at the limit of their own, the + ${open ? 'opens' : 'stays greyed'} with ${what}`, async () => {
    const h = await sidePanel({ view: STUBS.idle, status: signedIn, personas: ['rosa', 'theo', 'june'].map((slug) => ({ name: slug, role: '', slug, mine: true })), apps: { ok: true, apps }, cast });
    for (let n = 0; n < 5; n += 1) await tick();
    assert.equal(h.app.querySelector('[data-act="make-persona"]').attributes['aria-disabled'], open ? undefined : 'true');
    await h.press('make-persona');
    for (let n = 0; n < 5; n += 1) await tick();
    // At the limit there is no box to write in, so no intro asking for one.
    assert.deepEqual([h.body.dataset.screen, h.acts().includes('from-app'), h.acts().includes('make'), Boolean(h.app.querySelector('[data-state="full"]')), Boolean(h.app.querySelector('.intro'))],
      open ? ['make', true, false, true, false] : ['home', false, false, false, false]);
  });
}

// The waveform reads the mic beside the speech recognition: its stream and frame loop end on Stop and on Send.
// Make a persona has the same mic: its words fill the make box, not the task box, and Create ends it.
test('the side panel’s mic opens a stream for the waveform while listening, ends it on Stop, Send and Create, and fills the box it was pressed in', async () => {
  const mic = { opened: 0, stopped: 0, frames: 0, cancelled: 0, closed: 0 };
  const h = await sidePanel({ view: STUBS.idle, status: signedIn, personas: [{ name: 'Mira', role: '', slug: 'mira' }], mic });
  const waves = () => h.app.querySelectorAll('.wave').length;
  const say = async (transcript) => { mic.heard.onresult({ results: [Object.assign([{ transcript }], { isFinal: true })] }); await tick(); };
  await h.press('mic');
  await tick();
  assert.deepEqual([waves(), mic.opened, mic.frames > 0], [1, 1, true]);
  await say('Add a to-do');
  assert.equal(h.app.querySelector('textarea').value, 'Add a to-do');
  await h.press('mic');
  assert.deepEqual([waves(), mic.stopped, mic.cancelled, mic.closed], [0, 1, 1, 1], 'Stop: the stream, the frames and the context end');
  await h.press('mic');
  await tick();
  h.app.querySelector('textarea').value = 'Add a to-do.';
  await h.press('send');
  assert.deepEqual([mic.opened, mic.stopped, mic.closed], [2, 2, 2], 'Send ends it too');
  await h.press('make-persona');
  await h.press('mic');
  await tick();
  assert.deepEqual([h.body.dataset.screen, waves(), h.acts().includes('make')], ['make', 1, true], 'the make box listens beside Create');
  await say('A night-shift nurse');
  assert.equal(h.app.querySelector('textarea').value, 'A night-shift nurse');
  await h.press('make');
  assert.deepEqual([mic.opened, mic.stopped, h.sent.find((m) => m.account === 'create')?.description], [3, 3, 'A night-shift nurse'], 'Create ends it and sends the words heard');
  await h.press('back');
  assert.equal(h.app.querySelector('textarea').value, 'Add a to-do.', 'the task box keeps its own words');
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

// Catches (REN-2331): the delighted face on a walk whose persona didn't get through.
for (const [label, outcome, mood] of [['got through', { finished: true, issues: [] }, 'delighted'], ['with friction', { finished: true, issues: [{ n: 1 }] }, 'confused'], ['got partway', { finished: false, issues: [] }, 'confused']]) {
  test(`the side panel's ending shows ${mood} when the persona ${label}`, async () => {
    const { reduce } = await import('../extension/walks/view.js');
    const ended = [{ type: 'opened', name: 'Mira', tab: 7 }, { type: 'finish', outcome }].reduce(reduce, STUBS.waiting);
    const h = await sidePanel({ view: ended, status: signedIn, tab: 7 });
    assert.equal(h.app.querySelector('div.end')?.querySelector('span.face')?.attributes['data-mood'], mood);
    assert.match(h.app.querySelector('div.end')?.querySelector('[role="status"]')?.textContent ?? '', { delighted: / got through\.$/, confused: outcome.finished ? / got through, with friction\.$/ : / got partway\.$/ }[mood]);
  });
}

// No walk running: never a dead end. Scan leads, as the popup's did (the panel is the whole extension in Chrome).
// Signed out, the panel signs in and then shows the personas; with no account, the terminal.
for (const [label, status, offers] of [
  ['signed out', { ok: true, available: true, signedIn: false }, ['settings', 'sign-in']],
  ['a server that takes no sign-ins', { ok: true, available: false }, ['copy']],
  // The server says who has Impeccable Pro: without it, Get Pro or another account, and no personas asked for.
  ['signed in to an account the server says has no Pro', { ok: true, available: true, signedIn: true, pro: false }, ['get-pro', 'another-account']],
]) {
  test(`with no walk running, the side panel offers ${offers.join(' and ')}: ${label}`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const h = await sidePanel({ view: STUBS['signed-out'], status, signIn: { ...signedIn, ok: true }, personas: [{ name: 'Mira', role: '', slug: 'mira' }] });
    assert.deepEqual(h.acts(), offers);
    assert.equal(h.app.querySelector('section[id="panel-scan"]')?.hidden, false, 'Scan is on the screen');
    if (offers[0] === 'get-pro') {
      assert.deepEqual([h.body.dataset.screen, h.sent.some((m) => m.account === 'personas')], ['not-pro', false]);
      const asked = (panel) => panel.sent.filter((m) => m.account === 'status').length;
      const wait = async (ms) => { t.mock.timers.tick(ms); for (let n = 0; n < 5; n += 1) await tick(); };
      const shown = asked(h);
      await h.switchTo(2);
      await h.navigate('https://impeccable.reviews/app/-/account?tab=plan');
      assert.equal(asked(h), shown + 1, 'back from another tab, or the tab gone elsewhere: asked again, once in 2 s');
      await wait(2000);
      await h.navigate('https://impeccable.reviews/app/-/account');
      assert.equal(asked(h), shown + 2);
      await h.press('get-pro');
      await h.press('another-account');
      assert.deepEqual([h.sent.filter((m) => m.account === 'get-pro' || m.account === 'sign-out').map((m) => m.account), h.body.dataset.screen], [['get-pro', 'sign-out'], 'signed-out']);
      const out = asked(h);
      await wait(60_000);
      assert.equal(asked(h), out, 'signed out, the account is not asked again');
      // Paid in the checkout's tab, the panel left open: within a moment it has Pro, with no reopening.
      const paying = { ...status };
      const p = await sidePanel({ view: STUBS['signed-out'], status: paying, personas: [{ name: 'Mira', role: '', slug: 'mira' }] });
      await p.press('get-pro');
      await p.press('get-pro');
      const first = asked(p);
      await wait(5000);
      assert.deepEqual([asked(p) - first, p.body.dataset.screen], [1, 'not-pro'], 'asked again once, however often pressed');
      // A Scan walk meanwhile: no asking while it runs, and again once it is over.
      await p.show(STUBS.walking);
      await wait(5000);
      assert.deepEqual([asked(p) - first, p.body.dataset.screen], [1, 'walking']);
      await p.show(undefined);
      await wait(5000);
      assert.deepEqual([asked(p) - first, p.body.dataset.screen], [2, 'not-pro']);
      // The server out of reach for a moment (no word on Pro), asked on a timer or another tab: still no Pro, still asking.
      delete paying.pro;
      await wait(5000);
      await p.switchTo(3);
      assert.deepEqual([asked(p) - first, p.body.dataset.screen], [4, 'not-pro']);
      paying.pro = true;
      await wait(5000);
      assert.deepEqual([p.body.dataset.screen, p.sent.some((m) => m.account === 'personas'), p.acts().includes('send')], ['home', true, true]);
      const done = asked(p);
      await wait(60_000);
      assert.equal(asked(p), done, 'with Pro, no more asking');
      return;
    }
    if (!offers.includes('sign-in')) return;
    await h.press('sign-in');
    assert.ok(h.sent.some((m) => m.account === 'sign-in'), 'the extension’s own sign-in');
    // "You're connected" with the email and nothing to press, for a moment; then the home.
    const moment = (panel) => [panel.body.dataset.screen, panel.app.querySelector('b[data-email]')?.textContent, panel.acts()];
    assert.deepEqual(moment(h), ['connected', signedIn.email, []]);
    t.mock.timers.tick(2000);
    assert.deepEqual([h.body.dataset.account, h.body.dataset.screen, h.acts().includes('send')], ['signed-in', 'home', true]);
    // Signed in from the popup, which the sign-in window closed: the panel opened next says it too, once.
    const next = await sidePanel({ view: STUBS.idle, status: signedIn, connected: true, personas: [{ name: 'Mira', role: '', slug: 'mira' }] });
    assert.deepEqual([moment(next), next.session.connected], [['connected', signedIn.email, []], undefined]);
  });
}

// `hold`: the account's answer, then its personas', each released by the test.
test('the side panel shows only its loading dots until the account and its personas are known', async () => {
  const release = {};
  const hold = Object.fromEntries(['status', 'personas'].map((ask) => [ask, new Promise((done) => { release[ask] = done; })]));
  const h = await sidePanel({ view: STUBS.idle, status: signedIn, personas: [{ name: 'Mira', role: '', slug: 'mira' }], hold });
  const drawn = () => [h.body.dataset.screen, h.app.querySelectorAll('.dots').length, h.acts().filter((act) => !['scan', 'history', 'settings'].includes(act))];
  assert.deepEqual(drawn(), ['loading', 1, []], 'the account still coming');
  release.status();
  for (let n = 0; n < 5; n += 1) await tick();
  assert.deepEqual(drawn(), ['home', 1, []], 'its personas still coming');
  release.personas();
  for (let n = 0; n < 5; n += 1) await tick();
  assert.deepEqual([h.body.dataset.screen, h.app.querySelectorAll('.dots').length, h.acts().includes('send')], ['home', 0, true]);
});

// The account lives in the panel: the cog opens it under itself, never the options page in a window of its own.
test('the side panel’s cog opens the account in the panel: the email, a way to report a problem, and Sign out, which signs out', async () => {
  const h = await sidePanel({ view: STUBS.idle, status: signedIn, personas: [{ name: 'Mira', role: '', slug: 'mira' }] });
  const cog = () => h.app.querySelector('[data-act="settings"]');
  await h.press('settings');
  assert.deepEqual([cog().attributes['aria-expanded'], h.app.querySelector('b[data-email]')?.textContent, h.opened], ['true', signedIn.email, []]);
  await h.press('settings');
  assert.deepEqual([cog().attributes['aria-expanded'], h.acts().includes('sign-out')], ['false', false], 'a second press closes it');
  await h.press('settings');
  assert.deepEqual(h.acts().filter((act) => act === 'help' || act === 'sign-out'), ['help', 'sign-out'], 'the way to report a problem, above Sign out');
  // A new issue on the public repository: the extension's version, nothing of the person or their journeys.
  const issue = () => { const at = new URL(h.opened.at(-1).url); return [`${at.origin}${at.pathname}`, [...at.searchParams.keys()], at.searchParams.get('body').includes('9.9.9'), at.href.includes(signedIn.email)]; };
  await h.press('help');
  assert.deepEqual([issue(), h.opened.at(-1).active, cog().attributes['aria-expanded'], h.acts().includes('help')], [['https://github.com/pbakaus/impeccable/issues/new', ['body'], true, false], true, 'false', false], 'it opens a new issue in a tab and closes');
  h.opened.length = 0;
  await h.press('settings');
  await h.press('sign-out');
  assert.deepEqual([h.sent.filter((m) => m.account === 'sign-out'), h.body.dataset.screen, h.opened], [[{ account: 'sign-out' }], 'signed-out', []]);
  // Signed out, the same cog: the way to report a problem alone, for someone who can't sign in.
  await h.press('settings');
  assert.deepEqual([h.body.dataset.screen, h.acts().filter((act) => ['your-personas', 'help', 'sign-out', 'scan', 'history'].includes(act)), h.app.querySelector('b[data-email]')], ['signed-out', ['help'], null]);
  await h.press('help');
  assert.deepEqual([issue(), cog().attributes['aria-expanded']], [['https://github.com/pbakaus/impeccable/issues/new', ['body'], true, false], 'false']);
});

// Your personas, from the cog: their own with Remove, the six without (the owner hasn't decided). Remove asks in its own
// row; No or Escape puts the row back, Yes removes it, here and from the home's grid.
test('the side panel’s Your personas removes only their own, after Are you sure, and the grid loses it', async () => {
  const own = [{ name: 'Rosa', role: 'A nurse', slug: 'rosa', mine: true }, { name: 'Theo', role: 'A shift lead', slug: 'theo', mine: true }];
  const h = await sidePanel({ view: STUBS.idle, status: signedIn, personas: [...own, { name: 'Maya', role: 'A student', slug: 'default:maya', default: true }] });
  await h.press('settings');
  assert.deepEqual(h.acts().filter((act) => ['your-personas', 'help', 'sign-out'].includes(act)), ['your-personas', 'help', 'sign-out'], 'above Having problems?');
  await h.press('your-personas');
  const rows = () => h.app.querySelectorAll('li.yours-row').map((row) => `${row.attributes['data-slug']}:${row.attributes['data-state']}`);
  const removes = () => h.acts().filter((act) => act.startsWith('remove-'));
  const focused = () => document.activeElement?.attributes['data-act'];
  assert.deepEqual([h.body.dataset.screen, rows(), removes(), h.sent.at(-1)], ['personas', ['rosa:mine', 'theo:mine', 'default:maya:default'], ['remove-rosa', 'remove-theo'], { account: 'personas' }], 'asked with no page: their own, then the six');
  await h.press('remove-theo');
  assert.deepEqual([rows(), removes(), focused()], [['rosa:mine', 'theo:sure', 'default:maya:default'], ['remove-rosa'], 'sure-no']);
  await h.press('sure-no');
  assert.deepEqual([rows()[1], focused()], ['theo:mine', 'remove-theo'], 'No: the row as it was');
  await h.press('remove-theo');
  for (const listener of h.app.querySelector('li[data-state="sure"]').listeners.keydown) listener({ key: 'Escape' });
  assert.deepEqual([rows()[1], focused(), h.sent.some((m) => m.account === 'remove')], ['theo:mine', 'remove-theo', false], 'Escape counts as No');
  await h.press('remove-theo');
  await h.press('sure-yes');
  assert.deepEqual([h.sent.filter((m) => m.account === 'remove'), rows(), focused()], [[{ account: 'remove', slug: 'theo' }], ['rosa:mine', 'default:maya:default'], 'remove-rosa']);
  await h.press('back');
  assert.deepEqual([h.body.dataset.screen, h.acts().filter((act) => act.startsWith('pick-')).map((act) => h.app.querySelector(`[data-act="${act}"]`).attributes['aria-label'])], ['home', ['Rosa', 'Maya']]);
});

// History, beside the cog: the account worker's `journeys`, the dots while they come. A row opens its journey's page in a new tab; Back goes home.
test('the side panel’s History opens from the top row, a row opens its journey in a new tab, and Back goes home', async () => {
  const { HISTORY } = await import('../extension/walks/panel/stub.js');
  let answer;
  const hold = { journeys: new Promise((done) => { answer = done; }) };
  const mira = [{ name: 'Mira', role: '', slug: 'mira' }];
  const h = await sidePanel({ view: STUBS.idle, status: signedIn, personas: mira, journeys: { ok: true, journeys: HISTORY }, hold });
  await h.press('history');
  assert.deepEqual([h.body.dataset.screen, h.app.querySelectorAll('span.dots').length, h.app.querySelectorAll('button.hist-row').length], ['history', 1, 0], 'the dots while they come');
  answer();
  for (let n = 0; n < 3; n += 1) await tick();
  assert.deepEqual([h.app.querySelectorAll('button.hist-row').map((row) => row.attributes['data-outcome']), h.sent.filter((m) => m.account === 'journeys').length], [HISTORY.map((j) => j.outcome), 1]);
  await h.press('journey-1');
  assert.deepEqual(h.opened, [{ url: HISTORY[1].url, active: true }]);
  await h.press('back');
  assert.equal(h.body.dataset.screen, 'home');
  // None: the empty line. None read is not none: Try again, which asks again, or Sign in again when the sign-in is gone.
  for (const [journeys, offer] of [[{ ok: true, journeys: [] }, null], [{ ok: false, why: 'journeys' }, 'retry'], [{ ok: false, why: 'signed-out' }, 'sign-in']]) {
    const empty = await sidePanel({ view: STUBS.idle, status: signedIn, personas: mira, journeys });
    await empty.press('history');
    assert.deepEqual([empty.app.querySelectorAll('span.dots').length, empty.app.querySelectorAll('button.hist-row').length, empty.app.querySelectorAll('p.task').length, ['retry', 'sign-in'].filter((act) => empty.acts().includes(act))], [0, 0, offer ? 0 : 1, offer ? [offer] : []]);
    if (offer !== 'retry') continue;
    await empty.press('retry');
    for (let n = 0; n < 3; n += 1) await tick();
    assert.deepEqual([empty.sent.filter((m) => m.account === 'journeys').length, empty.acts().includes('retry')], [2, true]);
  }
  // A journey still going reads as one.
  const going = await sidePanel({ view: STUBS.idle, status: signedIn, personas: mira, journeys: { ok: true, journeys: [{ ...HISTORY[0], outcome: 'running', issues: 0 }] } });
  await going.press('history');
  assert.deepEqual(going.app.querySelectorAll('button.hist-row').map((row) => row.attributes['data-outcome']), ['running']);
});

test('Scan opens again after going back: its box stays in the page between visits', async () => {
  const h = await sidePanel({ view: STUBS.idle, status: signedIn, personas: [{ name: 'Mira', role: '', slug: 'mira' }] });
  for (let visit = 0; visit < 2; visit += 1) {
    await h.press('scan');
    assert.equal(h.body.dataset.screen, 'scan');
    assert.ok(h.app.querySelector('.scan-wrap')?.children.some((kid) => kid.attributes.id === 'panel-scan'), `visit ${visit + 1} shows the Scan box`);
    await h.press('back');
    assert.equal(h.body.dataset.screen, 'home');
  }
});

// Catches the Scan screen keeping the site it opened on after the tab moves on, or showing none for a new tab.
for (const [label, move] of [
  ['navigating the same tab', (h) => h.navigate('https://other.example/a')],
  ['a new tab once its address commits', async (h) => { await h.switchTo(2, ''); assert.equal(where(h), '', 'nothing before it commits'); await h.navigate('https://other.example/a'); }],
]) {
  test(`Scan names the active tab’s site after ${label}`, async () => {
    const h = await sidePanel({ view: STUBS.idle, status: signedIn, personas: [{ name: 'Mira', role: '', slug: 'mira' }] });
    await h.press('scan');
    assert.equal(where(h), 'tidy.example');
    await move(h);
    assert.deepEqual([h.body.dataset.screen, where(h)], ['scan', 'other.example']);
  });
}

test('the side panel’s first run shows once: Before you start, then the tab group, then the home, and the next panel opens home', async () => {
  const h = await sidePanel({ view: STUBS.idle, status: signedIn, firstRunSeen: false, personas: [{ name: 'Mira', role: '', slug: 'mira' }] });
  const seen = [h.body.dataset.screen];
  assert.deepEqual(h.app.querySelectorAll('a').map((a) => [a.attributes.href, a.attributes.target]), [['https://impeccable.style/privacy', '_blank']], 'the privacy policy opens in a new tab');
  await h.press('got-it');
  seen.push(h.body.dataset.screen);
  await h.press('start-walking');
  seen.push(h.body.dataset.screen);
  assert.deepEqual([seen, h.local.firstRunSeen], [['before', 'tab-group', 'home'], true]);
  const next = await sidePanel({ view: STUBS.idle, status: signedIn, firstRunSeen: h.local.firstRunSeen, personas: [{ name: 'Mira', role: '', slug: 'mira' }] });
  assert.equal(next.body.dataset.screen, 'home');
});

test('the store build’s side panel asks nothing of an account and offers only the terminal', async () => {
  const h = await sidePanel({ view: STUBS['signed-out'], status: signedIn, root: stagedStore() });
  assert.deepEqual([h.sent.filter((m) => m.account), h.acts(), h.body.dataset.account], [[], ['copy'], 'off']);
});
