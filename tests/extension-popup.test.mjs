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
async function sidePanel({ view, status, signIn = { ok: false }, firstRunSeen = true, root = SOURCE, tab = 1, personas = [], apps = { ok: false }, cast = [], plan = { ok: false }, walk = { ok: true }, create = { ok: false }, journeys = { ok: false }, mic = null, appForSite, hold = {}, connected, search = '' } = {}) {
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
  let front = tab;
  const area = (kept) => ({ async get(key) { return { [key]: kept[key] }; }, async set(values) { Object.assign(kept, values); }, async remove(key) { delete kept[key]; } });
  Object.assign(globalThis, {
    document, location: { search }, addEventListener() {},
    chrome: {
      // A persona made is in the list from then on, as the worker's is.
      runtime: { async openOptionsPage() { opened.push('options'); }, async sendMessage(message) { sent.push(message); await hold[message.account]; if (message.account === 'create' && create.ok) personas.push(create.persona); return { status, 'sign-in': signIn, personas: message.app ? { ok: true, personas: cast } : { ok: true, personas }, apps, plan, walk, create, journeys }[message.account]; } },
      storage: { local: area(local), session: { ...area(session), onChanged: { addListener: (listener) => changed.push(listener) } } },
      action: { async openPopup() { opened.push('popup'); } },
      tabs: { async create(made) { opened.push(made); }, async query() { return [{ id: front, url: 'https://tidy.example/' }]; }, onActivated: { addListener: (listener) => activated.push(listener) } },
    },
  });
  // `mic`: a browser that hears (speech recognition, the microphone given) and whose mic level can be read; it counts
  // the streams opened and ended, the frames asked for and cancelled, and the audio contexts closed.
  Object.assign(globalThis, mic ? {
    webkitSpeechRecognition: class { start() { this.onstart?.(); } stop() { this.onend?.(); } abort() {} },
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
  const back = await sidePanel({ view: ended, status: signedIn, tab: 7 });
  await back.press('back');
  assert.deepEqual([back.body.dataset.screen, back.opened], ['home', []], 'Back in the top row goes home and opens nothing');
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

test('the side panel plans before it walks: Send asks for a plan, a risky one asks to go ahead, Start walk sends its id, Edit brings the words back', async () => {
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
  test(`the side panel makes a persona from a description: ${label}`, async () => {
    // A list that came back empty is one that didn't load: never an empty home.
    const empty = await sidePanel({ view: STUBS.idle, status: signedIn, personas: [] });
    assert.deepEqual(empty.acts().filter((act) => act === 'retry' || act === 'make-persona'), ['retry']);
    // Three of their own, the server's limit: the + says why and opens nothing.
    const full = await sidePanel({ view: STUBS.idle, status: signedIn, personas: ['rosa', 'theo', 'june'].map((slug) => ({ name: slug, role: '', slug, mine: true })) });
    await full.press('make-persona');
    assert.deepEqual([full.body.dataset.screen, full.app.querySelector('[data-act="make-persona"]').attributes['aria-disabled']], ['home', 'true']);
    const h = await sidePanel({ view: STUBS.idle, status: signedIn, personas: [{ name: 'Maya', role: '', slug: 'default:maya', default: true }], create });
    await h.press('make-persona');
    assert.equal(h.body.dataset.screen, 'make');
    h.app.querySelector('textarea').value = '  A night-shift nurse who books shifts on her phone.  ';
    await h.press('make');
    assert.deepEqual(h.sent.filter((m) => m.account === 'create'), [{ account: 'create', description: 'A night-shift nurse who books shifts on her phone.' }]);
    if (create.ok) {
      assert.deepEqual(h.acts().filter((act) => act !== 'make'), ['confirm'], 'Confirm is the only way on');
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
test('the side panel asks for the personas of the tab’s address, and uses an app’s personas there once chosen', async () => {
  const maya = { name: 'Maya', role: '', slug: 'default:maya', default: true };
  const tidy = { workspace: 'acme', repo: 'tidy', app: 'web', name: 'Tidy' };
  const cast = [maya, { name: 'Mira', role: '', slug: 'mira', app: tidy }, { name: 'Alex', role: '', slug: 'alex', app: tidy }];
  const h = await sidePanel({ view: STUBS.idle, status: signedIn, personas: [maya], apps: { ok: true, apps: [tidy] }, cast });
  assert.equal(h.sent.find((m) => m.account === 'personas').url, 'https://tidy.example');
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
  // The next panel on this address shows that app's personas again.
  const next = await sidePanel({ view: STUBS.idle, status: signedIn, personas: [maya], cast, appForSite: h.local.appForSite });
  assert.deepEqual([h.local.appForSite['https://tidy.example'].app, next.app.querySelector('[data-act="pick-0"]').attributes['aria-label']], ['web', 'Mira']);
});

// The waveform reads the mic beside the speech recognition: its stream and frame loop end on Stop and on Send.
test('the side panel’s mic opens a stream for the waveform while listening, and ends it on Stop and on Send', async () => {
  const mic = { opened: 0, stopped: 0, frames: 0, cancelled: 0, closed: 0 };
  const h = await sidePanel({ view: STUBS.idle, status: signedIn, personas: [{ name: 'Mira', role: '', slug: 'mira' }], mic });
  const waves = () => h.app.querySelectorAll('.wave').length;
  await h.press('mic');
  await tick();
  assert.deepEqual([waves(), mic.opened, mic.frames > 0], [1, 1, true]);
  await h.press('mic');
  assert.deepEqual([waves(), mic.stopped, mic.cancelled, mic.closed], [0, 1, 1, 1], 'Stop: the stream, the frames and the context end');
  await h.press('mic');
  await tick();
  h.app.querySelector('textarea').value = 'Add a to-do.';
  await h.press('send');
  assert.deepEqual([mic.opened, mic.stopped, mic.closed], [2, 2, 2], 'Send ends it too');
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

// No walk running: never a dead end. Signed out, the panel signs in and then shows the personas; with no account, the terminal.
for (const [label, status, offers] of [
  ['signed out', { ok: true, available: true, signedIn: false }, ['sign-in']],
  ['a server that takes no sign-ins', { ok: true, available: false }, ['copy']],
  // The server says who has Impeccable Pro: without it, Get Pro or another account, and no personas asked for.
  ['signed in to an account the server says has no Pro', { ok: true, available: true, signedIn: true, pro: false }, ['get-pro', 'another-account']],
]) {
  test(`with no walk running, the side panel offers ${offers.join(' and ')}: ${label}`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const h = await sidePanel({ view: STUBS['signed-out'], status, signIn: { ...signedIn, ok: true }, personas: [{ name: 'Mira', role: '', slug: 'mira' }] });
    assert.deepEqual(h.acts(), offers);
    if (offers[0] === 'get-pro') {
      assert.deepEqual([h.body.dataset.screen, h.sent.some((m) => m.account === 'personas')], ['not-pro', false]);
      await h.press('get-pro');
      await h.press('another-account');
      assert.deepEqual([h.sent.filter((m) => m.account === 'get-pro' || m.account === 'sign-out').map((m) => m.account), h.body.dataset.screen], [['get-pro', 'sign-out'], 'signed-out']);
      return;
    }
    if (offers[0] !== 'sign-in') return;
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

// The account lives in the panel: the cog opens it under itself, never the options page in a window of its own (REN-2038).
test('the side panel’s cog opens the account in the panel: the email and Sign out, which signs out', async () => {
  const h = await sidePanel({ view: STUBS.idle, status: signedIn, personas: [{ name: 'Mira', role: '', slug: 'mira' }] });
  const cog = () => h.app.querySelector('[data-act="settings"]');
  await h.press('settings');
  assert.deepEqual([cog().attributes['aria-expanded'], h.app.querySelector('b[data-email]')?.textContent, h.opened], ['true', signedIn.email, []]);
  await h.press('settings');
  assert.deepEqual([cog().attributes['aria-expanded'], h.acts().includes('sign-out')], ['false', false], 'a second press closes it');
  await h.press('settings');
  await h.press('sign-out');
  assert.deepEqual([h.sent.filter((m) => m.account === 'sign-out'), h.body.dataset.screen, h.opened], [[{ account: 'sign-out' }], 'signed-out', []]);
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
  // None, or none read: the empty line, never the dots.
  for (const journeys of [{ ok: true, journeys: [] }, { ok: false, why: 'journeys' }]) {
    const empty = await sidePanel({ view: STUBS.idle, status: signedIn, personas: mira, journeys });
    await empty.press('history');
    assert.deepEqual([empty.app.querySelectorAll('span.dots').length, empty.app.querySelectorAll('button.hist-row').length, empty.app.querySelectorAll('p.task').length], [0, 0, 1]);
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

test('the store build’s side panel asks nothing of an account and offers only the terminal', async () => {
  const h = await sidePanel({ view: STUBS['signed-out'], status: signedIn, root: stagedStore() });
  assert.deepEqual([h.sent.filter((m) => m.account), h.acts(), h.body.dataset.account], [[], ['copy'], 'off']);
});
