import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

import { readHandoff } from '../extension/walks/handoff.js';
import { admit, onlyThisTab, verdict } from '../extension/walks/guard.js';
import { isSignInPage, lookInPage } from '../extension/walks/signin.js';
import { HELPER_KEY, START_PAGES, WALK_PERMISSIONS, firefoxManifest, helperManifest, isStoreFile, moduleReferences, stageHelper, stageStore, storeManifest } from '../scripts/lib/extension-manifests.js';
import { IDS } from '../extension/shared/ids.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = JSON.parse(readFileSync(path.join(ROOT, 'extension/manifest.json'), 'utf8'));
/** The store builds' trees, main's and the helper's, each staged once as scripts/build-extension.js stages it. */
const staged = {};
const stageOnce = (name, make) => () => (staged[name] ??= (() => {
  const root = path.join(mkdtempSync(path.join(tmpdir(), 'impeccable-store-')), 'extension');
  make(path.join(ROOT, 'extension'), root);
  return root;
})());
const STORE = stageOnce('main', stageStore);
const HELPER_STORE = stageOnce('helper', (from, to) => stageHelper(from, to, { store: true }));
after(() => { for (const root of Object.values(staged)) rmSync(path.dirname(root), { recursive: true, force: true }); });

const PAGE = 'https://app.impeccable.style/app/acme/outings/o1';
const block = (over = {}) => ({
  v: 1,
  outing: 'o1',
  socket: 'wss://impeccable.reviews/api/outings/o1/socket',
  ticket: 'ticket-0123456789',
  persona: { name: 'Mira', role: '' },
  errand: { name: '', goal: 'Add a to-do, then delete it.', doneWhen: [] },
  url: 'http://localhost:3000/',
  allow: [],
  ...over,
});

// Values the web app holds too. A change here must be made on the web app's side as well: this table fails so the
// author goes and looks.
describe('walk contract with the web app', () => {
  const source = (file) => readFileSync(path.join(ROOT, 'extension/walks', file), 'utf8');
  for (const [what, file, pattern, expected] of [
    ['protocol number', 'worker.js', /const PROTOCOL = (.+);/, '2'],
    ['socket subprotocol', 'worker.js', /const SUBPROTOCOL = (.+);/, "'impeccable-outing'"],
    ['part size', 'worker.js', /const PART_CHARS = (.+);/, '256 * 1024'],
    ['close reasons', 'link.js', /const CLOSED = (.+);/, "{ replaced: 'replaced', over: 'outing over', cancelled: 'cancelled', undriven: 'no driver came', switchedOff: 'switched off' }"],
    ['field limits', 'handoff.js', /const MAX = (.+);/, '{ name: 120, role: 200, errand: 120, goal: 2000, check: 300 }'],
    ['device names', 'handoff.js', /const DEVICES = (.+);/, "['desktop', 'mobile', 'tablet']"],
  ]) {
    it(`keeps the ${what}`, () => { assert.equal(source(file).match(pattern)?.[1], expected); });
  }
});

describe('walk hand-off', () => {
  it('takes a block from our walk page, with the socket on its paired host', () => {
    const read = readHandoff(JSON.stringify(block()), PAGE);
    assert.equal(read.ok, true);
    assert.equal(read.handoff.site, 'http://localhost:3000');
  });

  // The store build takes a walk from our production pages alone; the build loaded unpacked, from staging and this machine too.
  for (const [label, page, socket] of [
    ['production', PAGE, block().socket],
    ['staging', 'https://app.staging.impeccable.style/app/acme/outings/o1', 'wss://staging.impeccable.reviews/api/outings/o1/socket'],
    ['this machine', 'http://app.localhost:8794/app/acme/outings/o1', 'ws://localhost:8794/api/outings/o1/socket'],
    ['this machine without the app host', 'http://localhost:8794/app/acme/outings/o1', 'ws://localhost:8794/api/outings/o1/socket'],
  ]) {
    it(`takes a hand-off from ${label} in the build loaded unpacked${label === 'production' ? ' and the store build' : ', not the store build'}`, async () => {
      const store = await import(pathToFileURL(path.join(HELPER_STORE(), 'walks/handoff.js')).href);
      const text = JSON.stringify(block({ socket }));
      assert.deepEqual([readHandoff(text, page).ok, store.readHandoff(text, page).ok], [true, label === 'production']);
    });
  }

  for (const [label, page, over, why] of [
    ['a page that is not ours', 'https://example.com/app/acme/outings/o1', {}, 'origin'],
    ['a socket on another host', PAGE, { socket: 'wss://example.com/api/outings/o1/socket' }, 'socket'],
    ['a socket on the app host instead of its pair', PAGE, { socket: 'wss://app.impeccable.style/api/outings/o1/socket' }, 'socket'],
    ['a socket for another walk', PAGE, { socket: 'wss://impeccable.reviews/api/outings/o2/socket' }, 'socket'],
    ['an unknown field', PAGE, { extra: true }, 'malformed'],
    ['another version', PAGE, { v: 2 }, 'v'],
    ['a start address off this machine and off the allow-list', PAGE, { url: 'https://example.com/' }, 'url'],
    ['an allow-list entry that is not an origin', PAGE, { allow: ['https://example.com/path'] }, 'allow'],
  ]) {
    it(`refuses ${label}`, () => {
      assert.deepEqual(readHandoff(JSON.stringify(block(over)), page), { ok: false, why });
    });
  }
});

describe('walk guard', () => {
  for (const [url, allow, origin] of [
    ['http://localhost:3000/a', [], 'http://localhost:3000'],
    ['http://127.0.0.1:8080/', [], 'http://127.0.0.1:8080'],
    ['https://app.example.com/start', ['https://app.example.com'], 'https://app.example.com'],
  ]) {
    it(`admits ${url}`, () => { assert.equal(admit(url, allow).origin, origin); });
  }

  for (const [url, allow] of [
    ['https://example.com/', []],
    ['https://example.com/', ['https://other.example.com']],
    ['file:///etc/hosts', []],
    // Our own app, API and sign-in pages, even when allowed or on this machine.
    ['https://impeccable.reviews/app', ['https://impeccable.reviews']],
    ['https://staging.impeccable.reviews/', ['https://staging.impeccable.reviews']],
    ['https://app.impeccable.style/app/acme', ['https://app.impeccable.style']],
    ['https://api.staging.impeccable.style/mcp', ['https://api.staging.impeccable.style']],
    ['http://app.localhost:8794/app', []],
    ['http://api.localhost:8794/', []],
    ['http://localhost:8794/app/oauth/authorize?client_id=x', []],
  ]) {
    it(`refuses to walk ${url} with ${allow.length} allowed`, () => { assert.throws(() => admit(url, allow), { name: 'NotAllowed' }); });
  }

  const allowed = ['http://localhost:3000'];
  for (const [label, paused, answer] of [
    ['the top document off the site', { resourceType: 'Document', frameId: 'main', request: { url: 'https://example.com/' } }, 'block'],
    ['the top document on the site', { resourceType: 'Document', frameId: 'main', request: { url: 'http://localhost:3000/b' } }, 'continue'],
    ['a frame off the site', { resourceType: 'Document', frameId: 'child', request: { url: 'https://example.com/' } }, 'continue'],
    ['the top document on our own sign-in dialog', { resourceType: 'Document', frameId: 'main', request: { url: 'http://localhost:3000/app/oauth/authorize' } }, 'block'],
    // Writes: to the walk's own site, yes; to anywhere else, no, whoever asks; reads go anywhere.
    ['a write to the site', { resourceType: 'XHR', frameId: 'main', request: { method: 'DELETE', url: 'http://localhost:3000/api/todos/1' } }, 'continue'],
    ['a write to another origin', { resourceType: 'Fetch', frameId: 'main', request: { method: 'POST', url: 'https://example.com/collect' } }, 'refuse'],
    ['a frame’s form posted to another origin', { resourceType: 'Document', frameId: 'child', request: { method: 'POST', url: 'https://example.com/form' } }, 'refuse'],
    ['a read from another origin', { resourceType: 'Script', frameId: 'main', request: { method: 'GET', url: 'https://cdn.example.com/a.js' } }, 'continue'],
  ]) {
    it(`lets ${label} ${answer}`, () => { assert.equal(verdict(paused, 'main', allowed), answer); });
  }

  it('refuses an op that names another tab', () => {
    assert.throws(() => onlyThisTab({ tabId: 3 }), { name: 'NotAllowed' });
    assert.doesNotThrow(() => onlyThisTab({ selector: '#go' }));
  });
});

// What the walk reads of the page for itself, on a stand-in document: the signs of a sign-in, and where typing lands.
describe('walk lookout', () => {
  const field = (attrs = {}, size = 10) => ({ tagName: 'INPUT', type: attrs.type ?? 'text', getAttribute: (name) => attrs[name] ?? null, getBoundingClientRect: () => ({ width: size, height: size }), checkVisibility: () => size > 0 });
  const doc = ({ passwords = [], frames = [], hosts = [], active = null } = {}) => ({ activeElement: active, querySelectorAll: (sel) => (sel === '*' ? [...frames, ...hosts] : passwords) });
  const host = (root) => ({ tagName: 'DIV', shadowRoot: root });
  const frame = (inner) => ({ tagName: 'IFRAME', contentDocument: inner });
  const seen = (document, status = 200) => JSON.parse(vm.runInNewContext(`JSON.stringify((${lookInPage})())`, { document, performance: { getEntriesByType: () => [{ responseStatus: status }] } }));

  for (const [label, document, expected] of [
    ['a visible password field', doc({ passwords: [field({ type: 'password' })] }), { password: true, focus: null }],
    ['a password field of no size', doc({ passwords: [field({ type: 'password' }, 0)] }), { password: false, focus: null }],
    ['a password field in a frame on its origin', doc({ frames: [frame(doc({ passwords: [field({ type: 'password' })] }))] }), { password: true, focus: null }],
    ['a password field in an open shadow root', doc({ hosts: [host(doc({ passwords: [field({ type: 'password' })] }))] }), { password: true, focus: null }],
    ['focus on a password field', doc({ active: field({ type: 'password' }) }), { password: false, focus: 'password' }],
    ['focus on a card number', doc({ active: field({ autocomplete: 'shipping cc-number' }) }), { password: false, focus: 'card' }],
    ['focus on a one-time code', doc({ active: field({ autocomplete: 'one-time-code' }) }), { password: false, focus: 'code' }],
    ['focus in a frame on another origin', doc({ active: frame(null) }), { password: false, focus: 'frame' }],
    ['focus on a password field in a frame on its origin', doc({ active: frame(doc({ active: field({ type: 'password' }) })) }), { password: false, focus: 'password' }],
    ['focus on a plain field', doc({ active: field({ autocomplete: 'email' }) }), { password: false, focus: null }],
  ]) {
    it(`sees ${label}`, () => { assert.deepEqual(seen(document), { ...expected, status: 200 }); });
  }

  it('sees a 401 page', () => { assert.equal(seen(doc(), 401).status, 401); });

  for (const [url, expected] of [
    ['https://accounts.google.com/o/oauth2/auth', true],
    ['https://acme.okta.com/login', true],
    ['https://github.com/login/oauth/authorize', true],
    ['https://github.com/acme/web', false],
    ['https://okta.com.example.com/', false],
    ['http://localhost:3000/login', false],
  ]) {
    it(`takes ${url} ${expected ? 'for' : 'not for'} a sign-in page`, () => { assert.equal(isSignInPage(url), expected); });
  }
});

describe('walk mark on our pages', () => {
  it('writes the extension version, which the app takes as current (0.2.0 or later)', () => {
    const root = { dataset: {} };
    let heard;
    const chrome = { runtime: { id: 'ext', getManifest: () => MANIFEST, onMessage: { addListener: (listener) => { heard = listener; } } } };
    vm.runInNewContext(readFileSync(path.join(ROOT, 'extension/walks/present.js'), 'utf8'), { document: { documentElement: root }, chrome });
    assert.equal(root.dataset.impeccableWalks, MANIFEST.version);
    // It tells the helper it is here (so the page is not reloaded mid-hand-off), and tells nobody else anything.
    const answers = [];
    for (const id of ['ext', 'other']) heard({ walks: 'here' }, { id }, (answer) => answers.push([id, answer.here]));
    assert.deepEqual(answers, [['ext', true]]);
    const [major, minor] = MANIFEST.version.split('.').map(Number);
    assert.ok(major > 0 || minor >= 2, MANIFEST.version);
  });
});

// The real Chrome worker (detector, then walks) on a stubbed browser: both halves share one set of listeners.
describe('walk helper worker', () => {
  const listeners = {};
  const event = (name) => ({ addListener(callback) { (listeners[name] ??= []).push(callback); } });
  const area = () => {
    const kept = {};
    return {
      async get(key) { return typeof key === 'string' ? { [key]: kept[key] } : { ...key }; },
      async set(values) { Object.assign(kept, values); },
      async remove(key) { delete kept[key]; },
    };
  };
  const sockets = [];
  globalThis.WebSocket = class { static OPEN = 1; constructor(url, protocols) { Object.assign(this, { url, protocols }); sockets.push(this); } close() {} };
  const toolbar = [];
  const titles = [];
  globalThis.chrome = {
    runtime: {
      id: 'ext', onMessage: event('message'), onMessageExternal: event('external'), onConnect: event('connect'), onInstalled: event('installed'), onStartup: event('startup'),
      getURL: (file) => `chrome-extension://ext/${file}`, async sendMessage() {}, getManifest: () => helperManifest(MANIFEST),
    },
    action: { async setBadgeText() {}, async setBadgeBackgroundColor() {}, async setTitle({ title }) { titles.push(title); } },
    debugger: { onEvent: event('debugger-event'), onDetach: event('detach') },
    storage: { session: area(), local: area(), sync: { async get(defaults) { return defaults; } } },
    tabs: { onRemoved: event('removed'), onCreated: event('created'), onUpdated: event('updated'), async sendMessage() {} },
    sidePanel: { async open() {}, async setPanelBehavior({ openPanelOnActionClick }) { toolbar.push({ openPanelOnActionClick }); } },
  };
  const loaded = import('../extension/walks/worker.js');

  // The one message that crosses between the two extensions; nothing else, from anyone else, is answered.
  for (const [label, message, id, answered] of [
    ['main’s hello', { walks: 'hello' }, IDS.unpacked.main, true],
    ['another extension’s hello', { walks: 'hello' }, 'other', false],
    ['main asking for more', { walks: 'hello', token: 'x' }, IDS.unpacked.main, false],
    ['main asking anything else', { walks: 'open' }, IDS.unpacked.main, false],
  ]) {
    it(`answers ${label}: ${answered}`, async () => {
      await loaded;
      const answers = [];
      for (const listener of listeners.external) listener(message, { id }, (answer) => answers.push(answer));
      assert.deepEqual(answers, answered ? [{ ok: true, contract: 2, version: MANIFEST.version }] : []);
    });
  }

  const handOver = (sender) => new Promise((resolve) => {
    for (const listener of listeners.message) listener({ handoff: JSON.stringify(block()) }, sender, resolve);
  });
  const fromPage = { id: 'ext', frameId: 0, url: PAGE, tab: { id: 4, windowId: 1, url: PAGE } };

  for (const [label, sender] of [
    ['a frame inside our page', { ...fromPage, frameId: 1 }],
    ['another extension', { ...fromPage, id: 'other' }],
  ]) {
    it(`refuses a hand-off from ${label}`, async () => {
      await loaded;
      assert.deepEqual(await handOver(sender), { ok: false, why: 'origin' });
    });
  }

  it('takes a hand-off from our walk page and opens its socket with the ticket', async () => {
    await loaded;
    assert.deepEqual(await handOver(fromPage), { ok: true });
    for (let turn = 0; turn < 50 && sockets.length === 0; turn++) await new Promise((resolve) => setImmediate(resolve));
    const { url, protocols } = sockets.at(-1);
    assert.deepEqual({ url, protocols }, { url: block().socket, protocols: ['impeccable-outing', block().ticket] });
  });

  it('points the toolbar icon at the walk panel, walk or not', async () => {
    await loaded;
    // The server calls the walk off.
    sockets.at(-1).onclose({ reason: 'cancelled' });
    assert.deepEqual(toolbar, [{ openPanelOnActionClick: true }]);
  });

  it('ends a walk the server switched off as failed, said once in the panel and the toolbar', async () => {
    await loaded;
    const { current } = await import('../extension/walks/store.js');
    const { COPY } = await import('../extension/walks/panel/copy.js');
    const before = sockets.length;
    assert.deepEqual(await handOver(fromPage), { ok: true });
    for (let turn = 0; turn < 50 && sockets.length === before; turn++) await new Promise((resolve) => setImmediate(resolve));
    sockets.at(-1).onclose({ reason: 'switched off' });
    sockets.at(-1).onclose({ reason: 'switched off' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual([current().state, current().failure.reason, titles.at(-1)], ['failed', 'switched-off', COPY.failed['switched-off']]);
    assert.equal(titles.filter((title) => title === COPY.failed['switched-off']).length, 1);
  });

  // A reload mid-hand-off loses the walk: added, the helper reloads only the start pages that cannot have handed one over.
  it('reloads, once added, only the start pages its content script is not on and no hand-off came from', async () => {
    await loaded;
    const outing = (id) => ({ id, url: `http://app.localhost:8794/app/acme/outings/o${id}` });
    const reloaded = [];
    const { query, sendMessage, reload } = chrome.tabs;
    await chrome.storage.session.set({ handoff: { tabId: 2 } });
    Object.assign(chrome.tabs, {
      async query() { return [outing(1), outing(2), outing(3), { id: 4, url: 'https://example.com/' }]; },
      async sendMessage(id, message) { if (id === 3 && message.walks === 'here') return { here: true }; throw new Error('Receiving end does not exist'); },
      async reload(id) { reloaded.push(id); },
    });
    try {
      for (const listener of listeners.installed) listener({ reason: 'install' });
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.deepEqual(reloaded, [1]);
    } finally {
      Object.assign(chrome.tabs, { query, sendMessage, reload });
      await chrome.storage.session.remove('handoff');
    }
  });

  // A walked tab on a stubbed debugger, opened after the tests above: every command the walk sends it, in order,
  // and what the other end is told.
  const sent = [];
  const told = [];
  const page = { seen: {} };
  const answers = {
    'Page.getFrameTree': () => ({ frameTree: { frame: { id: 'main', loaderId: 'l1', url: 'about:blank' } } }),
    'Page.navigate': () => ({ loaderId: 'l1' }),
    'Page.getLayoutMetrics': () => ({ cssLayoutViewport: { clientWidth: 100, clientHeight: 80 } }),
    'Page.captureScreenshot': () => new Promise((resolve) => setTimeout(() => resolve({ data: btoa(String(sent.length)) }), 5)),
    'Page.createIsolatedWorld': () => ({ executionContextId: 9 }),
    'Runtime.evaluate': () => ({ result: { value: page.seen } }),
  };
  const fireOn = (tabId, method, params) => { for (const listener of listeners['debugger-event']) listener({ tabId }, method, params); };
  const fire = (method, params) => fireOn(11, method, params);
  const since = (at, method) => sent.slice(at).filter((m) => m === method).length;
  const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let opened;
  const walked = () => (opened ??= (async () => {
    await loaded;
    Object.assign(chrome.debugger, {
      async attach() {}, async detach() {},
      async sendCommand(_target, method) { sent.push(method); return (answers[method] ?? (() => ({})))(); },
    });
    Object.assign(chrome.tabs, {
      async create() { return { id: 11, windowId: 1 }; }, async get() { return { id: 11, windowId: 1, width: 800, height: 600, active: true }; },
      async group() { return 5; }, async remove() {}, async update() {},
    });
    chrome.tabGroups = { async update() {}, async get() { return { title: 'Impeccable · Mira' }; } };
    chrome.windows = { async get() { return { focused: true, state: 'normal', width: 800, height: 600 }; } };
    globalThis.createImageBitmap = async () => ({ close() {} });
    globalThis.OffscreenCanvas = class { getContext() { return { drawImage() {} }; } async convertToBlob() { return new Blob([String(sent.length)]); } };
    const driver = await import('../extension/walks/driver.js');
    const control = await import('../extension/walks/control.js');
    const { current, dispatch } = await import('../extension/walks/store.js');
    const { COPY } = await import('../extension/walks/panel/copy.js');
    driver.speak((message) => told.push(message));
    await driver.ops.open({ url: 'http://localhost:3000/', name: 'Mira' });
    return { ...driver, ...control, current, dispatch, COPY };
  })());

  after(async () => { if (opened) await (await opened).ops.close(); });

  it('takes and tells nothing of the page while paused, and films again once it goes on', async () => {
    const { ops, command } = await walked();
    await ops.cdp({ method: 'Page.startScreencast', params: { maxWidth: 50 } });
    await settle(150);
    assert.ok(since(0, 'Page.captureScreenshot') > 0, 'the film is rolling');
    assert.equal(await command('pause'), true);
    const paused = sent.length;
    const heard = told.length;
    fire('Page.frameNavigated', { frame: { id: 'main', loaderId: 'l2', url: 'http://localhost:3000/next' } });
    fire('Page.javascriptDialogOpening', { type: 'alert', message: 'Hello' });
    await settle(250);
    assert.equal(since(paused, 'Page.captureScreenshot'), 0, 'no picture is taken while paused');
    assert.ok(sent.includes('Network.disable'));
    assert.deepEqual(told.slice(heard).map((m) => m.event ?? 'reply'), [], 'nothing of the page is told');
    assert.equal(await command('resume'), true);
    await settle(150);
    assert.equal(since(paused, 'Network.enable'), 1);
    assert.ok(since(paused, 'Page.captureScreenshot') > 0, 'the film rolls again');
    assert.equal(told.slice(heard).find((m) => m.event === 'url')?.url, 'http://localhost:3000/next', 'and the other end hears where the tab is now');
    await ops.cdp({ method: 'Page.stopScreencast' });
  });

  // Each sign of a sign-in pauses the walk before anything else is done, and Continue keeps it paused while it holds.
  for (const [sign, show] of [
    ['a visible password field', () => { page.seen = { password: true }; }],
    ['a move to a sign-in host', () => fire('Fetch.requestPaused', { requestId: 'r1', resourceType: 'Document', frameId: 'main', request: { url: 'https://accounts.google.com/signin' } })],
    ['a 401 asking for a password', () => { page.seen = { status: 401 }; fire('Network.responseReceived', { type: 'Document', frameId: 'main', loaderId: 'l2', requestId: 'r2', response: { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="x"' } } }); }],
  ]) {
    it(`pauses itself at ${sign}, until the sign-in is gone`, async () => {
      const { ops, command, current, COPY } = await walked();
      const before = sent.length;
      show();
      let answered = false;
      const asked = ops.url().then(() => { answered = true; });
      await settle(20);
      assert.deepEqual([current().state, current().held, titles.at(-1), answered], ['paused', 'sign-in', COPY.signIn, false]);
      assert.equal(told.filter((m) => m.event === 'paused').length, told.filter((m) => m.event === 'resumed').length + 1, 'the other end is told once');
      if (sign === 'a move to a sign-in host') assert.ok(sent.indexOf('Network.disable', before) < sent.findIndex((m, i) => i >= before && m.startsWith('Fetch.')), 'paused before the guard answered');
      else {
        assert.equal(await command('resume'), false, 'Continue while it still shows');
        assert.equal(current().state, 'paused');
      }
      page.seen = {};
      assert.equal(await command('resume'), true);
      await asked;
      assert.deepEqual([answered, current().state, current().held, titles.at(-1)], [true, 'walking', null, helperManifest(MANIFEST).action.default_title]);
    });
  }

  // The pause's one barrier: what was under way when it landed answers nothing of then, and nothing decided before it
  // is done after Continue.
  it('lets nothing through a pause: a late picture is taken again after Continue, and a click from before is never made', async () => {
    const { ops, command } = await walked();
    page.seen = {};
    let release;
    answers['Page.captureScreenshot'] = () => new Promise((resolve) => { release = () => resolve({ data: 'before' }); });
    const shot = ops.screenshot({ format: 'png' });
    for (let turn = 0; turn < 50 && !release; turn++) await settle(1);
    assert.equal(await command('pause'), true);
    const typing = ops.keyboard({ action: 'type', text: 'hello' });
    const click = ops.mouse({ action: 'click', x: 5, y: 5 });
    answers['Page.captureScreenshot'] = () => ({ data: 'after' });
    release();
    await settle(20);
    assert.deepEqual(await ops.cdp({ method: 'Page.stopScreencast' }), { value: {} }, 'stopping the film passes through the pause');
    const atContinue = sent.length;
    assert.equal(await command('resume'), true);
    assert.deepEqual((await shot).value, { data: 'after' }, 'the picture from before the pause is never sent');
    await assert.rejects(click, { name: 'Paused' });
    await assert.rejects(typing, { name: 'Paused' });
    assert.deepEqual(sent.slice(atContinue).filter((m) => m.startsWith('Input.')), [], 'no click and no key from before the pause');
    await ops.mouse({ action: 'click', x: 5, y: 5 });
    assert.equal(sent.slice(atContinue).filter((m) => m === 'Input.dispatchMouseEvent').length, 3, 'one asked for after Continue is made');
  });

  it('keeps a sign-in pause the person takes over hushed, and turns a hand back during it into a pause', async () => {
    const { command, current } = await walked();
    page.seen = { password: true };
    await command('pause');
    await command('resume');
    assert.deepEqual([current().state, current().held], ['paused', 'sign-in']);
    assert.equal(await command('takeover'), true);
    const heard = told.length;
    fire('Page.frameNavigated', { frame: { id: 'main', loaderId: 'l3', url: 'http://localhost:3000/callback?code=secret' } });
    assert.deepEqual(told.slice(heard).filter((m) => m.event !== 'takeover').map((m) => m.event), [], 'nothing of the page is told while they sign in');
    assert.equal(await command('handback'), false, 'not handed back while the sign-in shows');
    assert.deepEqual([current().state, current().held], ['paused', 'sign-in']);
    page.seen = {};
    assert.equal(await command('resume'), true);
    assert.equal(current().state, 'walking');
    await settle(5);
    assert.equal(told.slice(heard).find((m) => m.event === 'url')?.url, 'http://localhost:3000/callback?code=secret', 'told once it goes on');
  });

  it('lets the person who took over at a sign-in sign in on a sign-in host, and neither the page nor the walk go there', async () => {
    const { command, current } = await walked();
    const ask = (url, extra = {}) => fire('Fetch.requestPaused', { requestId: `r-${url}`, resourceType: 'Document', frameId: 'main', request: { method: 'GET', url }, ...extra });
    const answered = async (act) => { const at = sent.length; act(); await settle(5); return sent.slice(at).filter((m) => m.startsWith('Fetch.')); };
    page.seen = { password: true };
    await command('pause');
    await command('resume');
    assert.deepEqual([current().state, current().held], ['paused', 'sign-in']);
    assert.deepEqual(await answered(() => ask('https://acme.okta.com/login')), ['Fetch.failRequest'], 'a pause a page can fake opens nothing');
    assert.equal(await command('takeover'), true);
    assert.deepEqual(await answered(() => ask('https://accounts.google.com/signin')), ['Fetch.continueRequest'], 'the person goes to sign in');
    assert.deepEqual(await answered(() => ask('https://accounts.google.com/signin/v2', { resourceType: 'XHR', request: { method: 'POST', url: 'https://accounts.google.com/signin/v2' } })), ['Fetch.continueRequest'], 'and sends it what it asks');
    assert.deepEqual(await answered(() => ask('https://example.com/collect', { resourceType: 'XHR', request: { method: 'POST', url: 'https://example.com/collect' } })), ['Fetch.failRequest'], 'but nothing else is let through');
    fire('Page.frameNavigated', { frame: { id: 'main', loaderId: 'l4', url: 'https://accounts.google.com/signin' } });
    await settle(5);
    assert.equal(current().state, 'takeover', 'on the sign-in host the walk is held, not ended');
    assert.equal(await command('handback'), false, 'nor goes on there');
    fire('Page.frameNavigated', { frame: { id: 'main', loaderId: 'l5', url: 'http://localhost:3000/' } });
    page.seen = {};
    assert.equal(await command('resume'), true);
    assert.deepEqual(await answered(() => ask('https://accounts.google.com/signin')), ['Fetch.failRequest'], 'walking, the walk never goes there itself');
    page.seen = {};
    await settle(5);
    await command('resume');
    assert.equal(current().state, 'walking');
  });

  it('takes no picture of a page it cannot read', async () => {
    const { ops } = await walked();
    page.seen = null;
    const before = sent.length;
    await assert.rejects(ops.screenshot({ format: 'png' }), { name: 'NotAllowed' });
    assert.equal(since(before, 'Page.captureScreenshot'), 0);
    page.seen = {};
  });

  for (const focus of ['password', 'card', 'code', 'frame']) {
    it(`types nothing when focus is a ${focus} field`, async () => {
      const { ops } = await walked();
      page.seen = { focus };
      const before = sent.length;
      await assert.rejects(ops.keyboard({ action: 'type', text: 'hunter2' }), { name: 'NotAllowed' });
      await assert.rejects(ops.keyboard({ action: 'press', key: 'Enter' }), { name: 'NotAllowed' });
      assert.equal(sent.slice(before).filter((m) => m.startsWith('Input.')).length, 0);
      page.seen = {};
      await ops.keyboard({ action: 'type', text: 'ok' });
      assert.equal(sent.slice(before).filter((m) => m === 'Input.dispatchKeyEvent').length, 4);
    });
  }

  it('lets nothing a pause held reach the tab once Stop is pressed, even while the walk is still letting go', async () => {
    const { ops, command, hooks } = await walked();
    page.seen = {};
    const reached = [];
    const { sendCommand } = chrome.debugger;
    chrome.debugger.sendCommand = async (target, method, params) => {
      if (String(params?.expression).includes('held')) reached.push(method);
      return sendCommand(target, method, params);
    };
    const tidying = async () => { await settle(20); };
    hooks.closing.push(tidying);
    try {
      assert.equal(await command('pause'), true);
      const looked = ops.evaluate({ fn: '() => "held"', args: [] }).then(() => 'done', (err) => err.name);
      await settle(5);
      assert.equal(await command('stop'), true);
      assert.deepEqual([await looked, reached], ['Stopped', []]);
    } finally {
      chrome.debugger.sendCommand = sendCommand;
      hooks.closing.splice(hooks.closing.indexOf(tidying), 1);
    }
  });

  // Last, as it ends the walk: Stop pressed while the walk's tab is still being opened ends the walk and closes it.
  for (const step of ['create', 'attach']) {
    it(`ends the walk and closes its tab when Stop comes as the tab is ${step === 'create' ? 'made' : 'taken'}`, async () => {
      const { ops, command, current, rearm, dispatch } = await walked();
      await ops.close();
      rearm();
      dispatch({ type: 'handoff', handoff: { persona: { name: 'Mira', role: '' }, errand: { name: '', goal: 'Look around.', doneWhen: [] }, site: 'http://localhost:3000' } });
      const removed = [];
      const attached = [];
      const { create, remove } = chrome.tabs;
      const { attach } = chrome.debugger;
      let go;
      const gate = new Promise((resolve) => { go = resolve; });
      chrome.tabs.create = async () => { if (step === 'create') await gate; return { id: 12, windowId: 1 }; };
      chrome.tabs.remove = async (id) => { removed.push(id); };
      chrome.debugger.attach = async ({ tabId }) => { attached.push(tabId); if (step === 'attach') await gate; };
      try {
        const opening = ops.open({ url: 'http://localhost:3000/', name: 'Mira' });
        await settle(5);
        assert.equal(await command('stop'), true);
        go();
        await assert.rejects(opening, { name: 'Stopped' });
        assert.deepEqual([removed, current().state], [[12], 'stopped']);
        if (step === 'create') assert.deepEqual(attached, [], 'the debugger never reaches it');
      } finally {
        Object.assign(chrome.tabs, { create, remove });
        chrome.debugger.attach = attach;
      }
    });
  }

  // A walk of the person's own tab, handed over by main: after the walks above, as it takes the one walk there is.
  const SHOP = 'https://shop.example.com';
  const started = (over = {}) => JSON.stringify(block({ socket: 'wss://impeccable.reviews/api/outings/o1/socket', url: `${SHOP}/cart`, ...over }));
  const fromMain = (message, id = IDS.unpacked.main) => new Promise((resolve) => {
    let answered = false;
    for (const listener of listeners.external) if (listener(message, { id }, (answer) => { answered = true; resolve(answer); }) !== true && !answered) resolve(null);
  });
  const tabs = { made: [], removed: [], ungrouped: [], groupId: -1, url: `${SHOP}/cart` };
  let own;
  const ownTab = () => (own ??= (async () => {
    const walk = await walked();
    await walk.ops.close();
    Object.assign(chrome.tabs, {
      async create(tab) { tabs.made.push(tab); return { id: 30, windowId: 1 }; },
      async remove(id) { tabs.removed.push(id); },
      async get(id) { return { id, windowId: 1, index: 3, url: tabs.url, groupId: tabs.groupId, width: 1280, height: 800, active: true }; },
      async ungroup(id) { tabs.ungrouped.push(id); },
    });
    return walk;
  })());

  for (const [label, message, id] of [
    ['another extension', { walks: 'walk', handoff: started(), tabId: 21 }, 'other'],
    ['main with a field too many', { walks: 'walk', handoff: started(), tabId: 21, token: 'x' }, IDS.unpacked.main],
  ]) {
    it(`takes no walk of a tab from ${label}`, async () => {
      await ownTab();
      assert.equal(await fromMain(message, id), null);
    });
  }

  for (const [label, handoff, why] of [
    ['a socket on another host', started({ socket: 'wss://example.com/api/outings/o1/socket' }), 'socket'],
    ['our own app as the tab', started({ url: 'https://app.impeccable.style/app/acme' }), 'url'],
    ['a tab that is on another site now', started({ url: 'https://elsewhere.example.com/' }), 'tab'],
  ]) {
    it(`refuses main's walk of a tab with ${label}`, async () => {
      await ownTab();
      assert.deepEqual(await fromMain({ walks: 'walk', handoff, tabId: 21 }), { ok: false, why });
    });
  }

  it('walks the person’s own tab where it is: no tab opened or closed, no move, no resize, no film', async () => {
    const { ops, current } = await ownTab();
    const before = sockets.length;
    assert.equal((await fromMain({ walks: 'walk', handoff: started(), tabId: 21 })).ok, true);
    for (let turn = 0; turn < 50 && sockets.length === before; turn++) await settle(1);
    assert.equal(current().state, 'waiting');
    const at = sent.length;
    const opened = await ops.open({ url: `${SHOP}/`, name: 'Ines' });
    assert.equal(opened.value.tabId, 21);
    assert.equal(current().state, 'walking');
    await ops.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
    await assert.rejects(ops.cdp({ method: 'Page.startScreencast', params: {} }), { name: 'NotSupported' });
    assert.deepEqual(sent.slice(at).filter((m) => ['Page.navigate', 'Emulation.setDeviceMetricsOverride', 'Page.startScreencast'].includes(m)), []);
    assert.deepEqual([tabs.made, tabs.removed], [[], []]);
  });

  it('asks the person before a deed the server marked: no click before Yes, and none at all on No', async () => {
    const { ops, command, current } = await ownTab();
    page.seen = {};
    const clicks = (from) => sent.slice(from).filter((m) => m === 'Input.dispatchMouseEvent').length;
    for (const [answer, done] of [['yes', 3], ['no', 0]]) {
      const at = sent.length;
      const click = ops.mouse({ action: 'click', x: 5, y: 5, ask: { kind: 'delete', what: 'Delete “Buy oat milk”' } });
      await settle(20);
      let looked = false;
      const meanwhile = ops.url().then(() => { looked = true; });
      await settle(20);
      assert.deepEqual([current().ask?.kind, clicks(at), looked], ['delete', 0, false], 'it waits, and so does everything after it');
      assert.equal(await command(answer), true);
      if (answer === 'yes') await click; else await assert.rejects(click, { name: 'Declined' });
      await meanwhile;
      assert.deepEqual([clicks(at), current().ask], [done, null]);
    }
  });

  it('asks before another site, and goes there only on Yes', async () => {
    const { command, current } = await ownTab();
    for (const [url, answer, fetched] of [['https://news.example.org/a', 'yes', 'Fetch.continueRequest'], ['https://ads.example.net/', 'no', 'Fetch.failRequest']]) {
      const at = sent.length;
      fireOn(21, 'Fetch.requestPaused', { requestId: `go-${url}`, resourceType: 'Document', frameId: 'main', request: { method: 'GET', url } });
      await settle(5);
      assert.deepEqual([current().ask, sent.slice(at).filter((m) => m.startsWith('Fetch.'))], [{ kind: 'go', what: new URL(url).host }, []]);
      await command(answer);
      await settle(5);
      assert.deepEqual(sent.slice(at).filter((m) => m.startsWith('Fetch.')), [fetched]);
    }
    const at = sent.length;
    fireOn(21, 'Fetch.requestPaused', { requestId: 'go-local', resourceType: 'Document', frameId: 'main', request: { method: 'GET', url: 'http://192.168.1.1/' } });
    await settle(5);
    assert.deepEqual([current().ask, sent.slice(at).filter((m) => m.startsWith('Fetch.'))], [null, ['Fetch.failRequest']], 'a private address is never asked for');
  });

  it('lets go of the person’s tab at the end and leaves it open, out of the group it was put in', async () => {
    const { ops, current } = await ownTab();
    await ops.close();
    assert.deepEqual([tabs.made, tabs.removed, tabs.ungrouped, current().state], [[], [], [21], 'done']);
  });

  it('drops a reply that settles after its socket is gone, never sending it on the next one', async () => {
    const { ops } = await ownTab();
    const open = (ws) => { ws.readyState = 1; ws.sent = []; ws.send = (text) => ws.sent.push(JSON.parse(text)); return ws; };
    const next = async (sender, ticket) => {
      const before = sockets.length;
      await new Promise((resolve) => { for (const listener of listeners.message) listener({ handoff: JSON.stringify(block({ ticket })) }, sender, resolve); });
      for (let turn = 0; turn < 50 && sockets.length === before; turn++) await settle(1);
      return open(sockets.at(-1));
    };
    const first = await next(fromPage, 'ticket-first-000000');
    let go;
    const { create } = chrome.tabs;
    chrome.tabs.create = async () => { await new Promise((resolve) => { go = resolve; }); return { id: 40, windowId: 1 }; };
    try {
      first.onmessage({ data: JSON.stringify({ op: 'open', id: 7, url: 'http://localhost:3000/', name: 'Mira' }) });
      for (let turn = 0; turn < 50 && !go; turn++) await settle(1);
      const second = await next(fromPage, 'ticket-second-00000');
      go();
      await settle(20);
      assert.deepEqual([first.sent.filter((m) => m.id === 7), second.sent.filter((m) => m.id === 7)], [[], []]);
    } finally {
      chrome.tabs.create = create;
      await ops.close();
    }
  });
});

// The badge's own script, on a stand-in page: the glow on a walk of the person's own tab, and when it goes.
describe('walk glow', () => {
  // After the worker's tests have put a stand-in Chrome in place: the badge's module hangs on the driver's.
  const badge = () => import('../extension/walks/badge.js');
  const page = async () => {
    const { badgeInPage } = await badge();
    const clock = { now: 0 };
    const ticks = [];
    const node = (tag) => ({
      tag, style: {}, dataset: {}, isConnected: false, children: [],
      append(...kids) { for (const kid of kids) { kid.isConnected = true; this.children.push(kid); } },
      remove() { this.isConnected = false; }, setAttribute() {}, addEventListener() {},
      attachShadow() { return node('#shadow'); }, getBoundingClientRect: () => ({ width: 100, height: 30 }),
    });
    const root = node('html');
    const context = {
      document: { createElement: node, documentElement: root }, CSSStyleSheet: class { replaceSync() {} },
      Date: { now: () => clock.now }, setInterval: (fn) => { ticks.push(fn); return 1; }, clearInterval() {}, innerWidth: 800, innerHeight: 600, addEventListener() {},
    };
    vm.runInNewContext(`(${badgeInPage})('bind', 3000, 1500)`, context);
    const glow = () => root.children.find((child) => child.tag === 'impeccable-walk-glow');
    const shows = () => Boolean(glow()?.isConnected && glow().style.visibility !== 'hidden');
    return { api: context.__impeccableWalkBadge, clock, tick: () => ticks.forEach((fn) => fn()), shows };
  };
  const walking = { title: '', sub: '', stop: 'Stop', resume: '', state: 'walking', step: 1, glow: true };

  it('shows while walking, takes no clicks, and is out of every picture', async () => {
    const { api, shows } = await page();
    api.set(walking);
    assert.equal(shows(), true);
    api.veil(true);
    assert.equal(shows(), false, 'hidden for a picture');
    api.veil(false);
    assert.equal(shows(), true);
  });

  for (const [label, end] of [
    ['the person takes over', ({ api }) => api.set({ ...walking, state: 'takeover', glow: false })],
    ['the walk ends', ({ api }) => api.remove()],
    ['the debugger leaves without a word', ({ clock, tick }) => { clock.now += 1600; tick(); }],
  ]) {
    it(`goes when ${label}`, async () => {
      const at = await page();
      at.api.set(walking);
      end(at);
      assert.equal(at.shows(), false);
    });
  }

  const view = (state, extra = {}) => ({ state, who: { name: 'Ines' }, steps: [], ask: null, ...extra });
  for (const [label, shown, adopted, glow] of [
    ['walking the person’s tab', view('walking'), true, true],
    ['asking on it', view('walking', { ask: { kind: 'pay', what: 'Pay $12' } }), true, true],
    ['paused', view('paused'), true, false],
    ['taken over', view('takeover'), true, false],
    ['walking a tab of its own', view('walking'), false, false],
  ]) {
    it(`${glow ? 'glows' : 'does not glow'} ${label}`, async () => { assert.equal((await badge()).badgeState(shown, adopted).glow, glow); });
  }
});

describe('derived extension manifests', () => {
  const files = (folder) => [folder, ...readdirSync(path.join(ROOT, 'extension', folder), { recursive: true }).map((file) => `${folder}/${file}`)];

  // Firefox ships main's store files (stageFirefox).
  it('leaves walks, the account and the onboarding out of Firefox', () => {
    const firefox = firefoxManifest(MANIFEST);
    assert.deepEqual(firefox.permissions.filter((permission) => [...WALK_PERMISSIONS, 'identity'].includes(permission)), []);
    for (const key of ['side_panel', 'content_scripts', 'externally_connectable', 'key']) assert.equal(key in firefox, false, key);
    assert.deepEqual(['walks', 'account', 'onboarding'].flatMap(files).filter((file) => isStoreFile(file)), []);
    assert.deepEqual([MANIFEST.background.service_worker, 'background/service-worker.js'].map((file) => isStoreFile(file)), [false, true]);
  });

  it('gives the helper every walk permission and file, and main none of them', () => {
    const helper = helperManifest(MANIFEST);
    assert.deepEqual(WALK_PERMISSIONS.filter((permission) => !helper.permissions.includes(permission)), []);
    for (const main of [MANIFEST, storeManifest(MANIFEST)]) {
      assert.deepEqual(main.permissions.filter((permission) => WALK_PERMISSIONS.includes(permission)), []);
      assert.equal(JSON.stringify(main).includes('walks/'), false);
    }
    const root = HELPER_STORE();
    const shipped = readdirSync(root, { recursive: true });
    assert.deepEqual(files('walks').filter((file) => !shipped.includes(file)), [], 'every walk file');
    assert.deepEqual(shipped.filter((file) => /^(account|onboarding|popup|devtools|detector|content|offscreen|background)\b/.test(file)), [], 'nothing of main');
    assert.deepEqual(moduleReferences(root, helper.background.service_worker).filter((file) => !existsSync(path.join(root, file))), []);
    assert.deepEqual(helper.content_scripts.flatMap((entry) => entry.js).sort(), ['walks/handoff-content.js', 'walks/present.js']);
  });

  it('holds the store helper to production hosts and its switches off, and the unpacked one to neither', () => {
    const store = JSON.parse(readFileSync(path.join(HELPER_STORE(), 'manifest.json'), 'utf8'));
    const matches = store.content_scripts.flatMap((entry) => entry.matches);
    assert.ok(matches.length > 0);
    assert.deepEqual(matches.filter((match) => /staging|localhost/.test(match)), []);
    assert.equal('key' in store, false);
    assert.match(readFileSync(path.join(HELPER_STORE(), 'shared/build.js'), 'utf8'), /account: false, devHosts: false/);
    assert.ok(helperManifest(MANIFEST).content_scripts.some((entry) => entry.matches.some((match) => match.includes('localhost'))));
  });

  it('leaves the account and the onboarding out of main’s store build, and keeps them in the one loaded unpacked', () => {
    const store = STORE();
    const loads = (root, manifest) => moduleReferences(root, manifest.background.service_worker);
    assert.deepEqual(readdirSync(store, { recursive: true }).filter((file) => /^(account|onboarding|walks)\b|popup\/(account|words)\.js$/.test(file)), []);
    const manifest = JSON.parse(readFileSync(path.join(store, 'manifest.json'), 'utf8'));
    assert.deepEqual(loads(store, manifest).filter((file) => !existsSync(path.join(store, file))), []);
    assert.doesNotMatch(readFileSync(path.join(store, 'popup/popup.html'), 'utf8'), /account\.js|words\.js/);
    assert.deepEqual(['account/worker.js', 'onboarding/contact.js'].filter((file) => !loads(path.join(ROOT, 'extension'), MANIFEST).includes(file)), []);
  });

  // Each lets only the other in, by the id Chrome gives it: from its key when loaded unpacked, the store's otherwise.
  it('names each extension’s id on the other side, and each key gives the unpacked id', () => {
    const idOf = (key) => createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32).replace(/./g, (h) => String.fromCharCode(97 + parseInt(h, 16)));
    assert.deepEqual([idOf(MANIFEST.key), idOf(HELPER_KEY)], [IDS.unpacked.main, IDS.unpacked.helper]);
    assert.deepEqual(MANIFEST.externally_connectable, { ids: [IDS.unpacked.helper] });
    assert.deepEqual(helperManifest(MANIFEST).externally_connectable, { ids: [IDS.unpacked.main] });
    assert.deepEqual(helperManifest(MANIFEST, { store: true }).externally_connectable, { ids: [IDS.store.main] });
    assert.deepEqual(MANIFEST.content_scripts.flatMap((entry) => entry.matches), START_PAGES, 'main’s onboarding runs where the helper marks the page');
  });
});

// Chrome's permission warnings (developer.chrome.com, "Permissions list" and "Permission warning guidelines"): the
// permissions below show none. Any other permission, and any host, counts as one. An update that adds a warning
// switches the extension off until the person accepts it, so main's must stay those of the version people have.
describe('main extension install warnings', () => {
  const SILENT = ['activeTab', 'alarms', 'identity', 'offscreen', 'scripting', 'sidePanel', 'storage'];
  /** As published in 1.4.0, the version people have installed. */
  const PUBLISHED = { permissions: ['activeTab', 'scripting', 'storage', 'webNavigation', 'offscreen'], host_permissions: ['<all_urls>'] };
  const warned = (manifest) => manifest.permissions.filter((permission) => !SILENT.includes(permission)).sort();
  const hosts = (manifest) => [...(manifest.host_permissions ?? []), ...(manifest.content_scripts ?? []).flatMap((entry) => entry.matches)];

  for (const [label, manifest] of [['loaded unpacked', MANIFEST], ['the store build', storeManifest(MANIFEST)]]) {
    it(`asks for no warning 1.4.0 did not: ${label}`, () => {
      assert.deepEqual(warned(manifest), warned(PUBLISHED));
      // 1.4.0 has every site, so any content script's pages are already in its warning.
      assert.ok(hosts(PUBLISHED).includes('<all_urls>') || hosts(manifest).every((host) => hosts(PUBLISHED).includes(host)));
      assert.deepEqual(manifest.host_permissions, PUBLISHED.host_permissions);
      assert.equal('optional_permissions' in manifest, false);
    });
  }
});

