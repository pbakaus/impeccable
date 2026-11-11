import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

import { readHandoff } from '../extension/walks/handoff.js';
import { admit, onlyThisTab, verdict } from '../extension/walks/guard.js';
import { isSignInPage, lookInPage } from '../extension/walks/signin.js';
import { firefoxManifest, isFirefoxFile, moduleReferences, stageStore, storeManifest } from '../scripts/lib/extension-manifests.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = JSON.parse(readFileSync(path.join(ROOT, 'extension/manifest.json'), 'utf8'));
/** The store build's tree, staged once as scripts/build-extension.js stages it. */
let staged;
const STORE = () => (staged ??= (() => {
  const root = path.join(mkdtempSync(path.join(tmpdir(), 'impeccable-store-')), 'extension');
  stageStore(path.join(ROOT, 'extension'), root);
  return root;
})());

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
    ['close reasons', 'link.js', /const CLOSED = (.+);/, "{ replaced: 'replaced', over: 'outing over', cancelled: 'cancelled', undriven: 'no driver came' }"],
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
      const store = await import(pathToFileURL(path.join(STORE(), 'walks/handoff.js')).href);
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
  const doc = ({ passwords = [], frames = [], active = null } = {}) => ({ activeElement: active, querySelectorAll: (sel) => (sel.startsWith('iframe') ? frames : passwords) });
  const frame = (inner) => ({ tagName: 'IFRAME', contentDocument: inner });
  const seen = (document, status = 200) => JSON.parse(vm.runInNewContext(`JSON.stringify((${lookInPage})())`, { document, performance: { getEntriesByType: () => [{ responseStatus: status }] } }));

  for (const [label, document, expected] of [
    ['a visible password field', doc({ passwords: [field({ type: 'password' })] }), { password: true, focus: null }],
    ['a password field of no size', doc({ passwords: [field({ type: 'password' }, 0)] }), { password: false, focus: null }],
    ['a password field in a frame on its origin', doc({ frames: [frame(doc({ passwords: [field({ type: 'password' })] }))] }), { password: true, focus: null }],
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
    const chrome = { runtime: { getManifest: () => MANIFEST } };
    vm.runInNewContext(readFileSync(path.join(ROOT, 'extension/walks/present.js'), 'utf8'), { document: { documentElement: root }, chrome });
    assert.equal(root.dataset.impeccableWalks, MANIFEST.version);
    const [major, minor] = MANIFEST.version.split('.').map(Number);
    assert.ok(major > 0 || minor >= 2, MANIFEST.version);
  });
});

// The real Chrome worker (detector, then walks) on a stubbed browser: both halves share one set of listeners.
describe('Chrome background worker', () => {
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
      id: 'ext', onMessage: event('message'), onConnect: event('connect'), onInstalled: event('installed'), onStartup: event('startup'),
      getURL: (file) => `chrome-extension://ext/${file}`, async sendMessage() {}, getManifest: () => MANIFEST,
    },
    action: { async setBadgeText() {}, async setBadgeBackgroundColor() {}, async setPopup({ popup }) { toolbar.push({ popup }); }, async setTitle({ title }) { titles.push(title); } },
    webNavigation: { onCompleted: event('navigation') },
    debugger: { onEvent: event('debugger-event'), onDetach: event('detach') },
    storage: { session: area(), local: area(), sync: { async get(defaults) { return defaults; } } },
    tabs: { onRemoved: event('removed'), onCreated: event('created'), onUpdated: event('updated'), async sendMessage() {} },
    identity: { getRedirectURL: (path) => `https://ext.chromiumapp.org/${path}`, async launchWebAuthFlow() { throw new Error('no sign-in here'); } },
    sidePanel: { async open() {}, async setPanelBehavior({ openPanelOnActionClick }) { toolbar.push({ openPanelOnActionClick }); } },
  };
  const loaded = import('../extension/background/chrome-worker.js');

  const port = (name) => {
    const p = { name, posted: [], disconnected: false, onMessage: event(`${name}-message`), onDisconnect: event(`${name}-disconnect`) };
    p.postMessage = (message) => p.posted.push(message);
    p.disconnect = () => { p.disconnected = true; };
    return p;
  };

  it('keeps the detector panel port open alongside the walk worker', async () => {
    await loaded;
    const panel = port('impeccable-panel-7');
    for (const listener of listeners.connect) listener(panel);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(panel.disconnected, false);
    assert.equal(panel.posted[0]?.action, 'state');
  });

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

  it('points the toolbar icon at the walk panel while the walk is live, and back at the popup after', async () => {
    await loaded;
    // At start (no walk) the popup; after the hand-off above, the panel.
    assert.deepEqual(toolbar.slice(0, 4), [
      { popup: 'popup/popup.html' }, { openPanelOnActionClick: false },
      { popup: '' }, { openPanelOnActionClick: true },
    ]);
    // The server calls the walk off.
    sockets.at(-1).onclose({ reason: 'cancelled' });
    assert.deepEqual(toolbar.slice(4), [{ popup: 'popup/popup.html' }, { openPanelOnActionClick: false }]);
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
  const fire = (method, params) => { for (const listener of listeners['debugger-event']) listener({ tabId: 11 }, method, params); };
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
    const { current } = await import('../extension/walks/store.js');
    const { COPY } = await import('../extension/walks/panel/copy.js');
    driver.speak((message) => told.push(message));
    await driver.ops.open({ url: 'http://localhost:3000/', name: 'Mira' });
    return { ...driver, ...control, current, COPY };
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
      assert.deepEqual([answered, current().state, current().held, titles.at(-1)], [true, 'walking', null, MANIFEST.name]);
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
});

describe('derived extension manifests', () => {
  it('leaves walks and the account out of Firefox: no walk or account file, no debugger, no identity, no side panel', () => {
    const firefox = firefoxManifest(MANIFEST);
    assert.equal(firefox.permissions.includes('debugger'), false);
    assert.equal(firefox.permissions.includes('identity'), false);
    const accountFiles = readdirSync(path.join(ROOT, 'extension/account'), { recursive: true }).map((file) => `account/${file}`);
    assert.deepEqual(['account', ...accountFiles].filter((file) => isFirefoxFile(file, MANIFEST)), []);
    assert.equal('side_panel' in firefox, false);
    assert.equal(JSON.stringify(firefox).includes('walks/'), false);
    const walkFiles = readdirSync(path.join(ROOT, 'extension/walks'), { recursive: true }).map((file) => `walks/${file}`);
    assert.deepEqual(['walks', ...walkFiles].filter((file) => isFirefoxFile(file, MANIFEST)), []);
    assert.equal(isFirefoxFile(MANIFEST.background.service_worker, MANIFEST), false);
    assert.equal(isFirefoxFile('background/service-worker.js', MANIFEST), true);
  });

  it('keeps a content script that is not a walk one in Firefox', () => {
    const detector = { matches: ['<all_urls>'], js: ['content/content-script.js'] };
    const firefox = firefoxManifest({ ...MANIFEST, content_scripts: [...MANIFEST.content_scripts, detector] });
    assert.deepEqual(firefox.content_scripts, [detector]);
  });

  it('holds the store build to production hosts', () => {
    const matches = storeManifest(MANIFEST).content_scripts.flatMap((entry) => entry.matches);
    assert.ok(matches.length > 0);
    assert.deepEqual(matches.filter((match) => /staging|localhost/.test(match)), []);
    assert.ok(MANIFEST.content_scripts.some((entry) => entry.matches.some((match) => match.includes('localhost'))), 'the source manifest keeps localhost for Load unpacked');
  });

  it('leaves the account out of the store build, and keeps it in the one loaded unpacked', () => {
    const store = STORE();
    const manifest = JSON.parse(readFileSync(path.join(store, 'manifest.json'), 'utf8'));
    const loads = (root) => moduleReferences(root, MANIFEST.background.service_worker);
    assert.equal(manifest.permissions.includes('identity'), false);
    assert.deepEqual(readdirSync(store, { recursive: true }).filter((file) => /^account\b|popup\/account\.js$/.test(file)), []);
    assert.deepEqual(loads(store).filter((file) => file.startsWith('account/') || !existsSync(path.join(store, file))), [], 'its worker loads no account file, and every file it loads is there');
    assert.ok(loads(path.join(ROOT, 'extension')).includes('account/worker.js'));
  });
});
