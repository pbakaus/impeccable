import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

import { readHandoff, resultLink } from '../extension/walks/handoff.js';
import { MAX_OTHER_SITES, MAX_SITE_QUESTIONS, admit, onlyThisTab, verdict } from '../extension/walks/guard.js';
import { isSignInPage, lookInPage } from '../extension/walks/signin.js';
import { listen } from '../extension/walks/panel/voice.js';
import { WALK_PERMISSIONS, firefoxManifest, isStoreFile, moduleReferences, stageFirefox, stageStore, storeManifest } from '../scripts/lib/extension-manifests.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = JSON.parse(readFileSync(path.join(ROOT, 'extension/manifest.json'), 'utf8'));
/** The store and Firefox trees, each staged once as scripts/build-extension.js stages it. */
const staged = {};
const stageOnce = (name, make) => () => (staged[name] ??= (() => {
  const root = path.join(mkdtempSync(path.join(tmpdir(), 'impeccable-store-')), 'extension');
  make(path.join(ROOT, 'extension'), root);
  return root;
})());
const STORE = stageOnce('main', stageStore);
const FIREFOX = stageOnce('firefox', stageFirefox);
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
    ['capabilities', 'worker.js', /const CAN = (.+);/, "['tab', 'ask', 'go', 'upload']"],
    ['most other sites a walk may go to', 'guard.js', /const MAX_OTHER_SITES = (.+);/, '8'],
  ]) {
    it(`keeps the ${what}`, () => { assert.equal(source(file).match(pattern)?.[1], expected); });
  }
});

describe('walk hand-off', () => {
  it('takes a block from our walk page, with the socket on its paired host', () => {
    const read = readHandoff(JSON.stringify(block()), PAGE);
    assert.equal(read.ok, true);
    assert.equal(read.handoff.site, 'http://localhost:3000');
    // How the persona sees the page (REN-2039) is kept for the sight filter (sight.js).
    assert.equal(readHandoff(JSON.stringify(block({ persona: { name: 'Robert', role: '', sees: 'older-eyes' } })), PAGE).handoff.persona.sees, 'older-eyes');
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
    ['a persona who sees in a way no filter draws', PAGE, { persona: { name: 'Robert', role: '', sees: 'x-ray' } }, 'persona'],
    ['another version', PAGE, { v: 2 }, 'v'],
    ['a start address off this machine and off the allow-list', PAGE, { url: 'https://example.com/' }, 'url'],
    ['an allow-list entry that is not an origin', PAGE, { allow: ['https://example.com/path'] }, 'allow'],
  ]) {
    it(`refuses ${label}`, () => {
      assert.deepEqual(readHandoff(JSON.stringify(block(over)), page), { ok: false, why });
    });
  }
});

describe('walk result link', () => {
  // The result is on the app host of the walk's own server (the web app links a walk's result there).
  for (const [label, link, socket, shown] of [
    ['the app host, production', 'https://app.impeccable.style/app/acme/runs/r1/personas/ines', block().socket, true],
    ['the public host, production', 'https://impeccable.reviews/app/acme/runs/r1/personas/ines', block().socket, true],
    ['the app host, staging', 'https://app.staging.impeccable.style/app/acme/runs/r1', 'wss://staging.impeccable.reviews/api/outings/o1/socket', true],
    ['the app host on this machine, same port', 'http://app.localhost:8794/app/acme/runs/r1', 'ws://localhost:8794/api/outings/o1/socket', true],
    ['the app host on this machine, another port', 'http://app.localhost:9000/app/acme/runs/r1', 'ws://localhost:8794/api/outings/o1/socket', false],
    ['staging, for a production walk', 'https://app.staging.impeccable.style/app/acme/runs/r1', block().socket, false],
    ['another site', 'https://example.com/app/acme/runs/r1', block().socket, false],
    ['plain http on our host', 'http://app.impeccable.style/app/acme/runs/r1', block().socket, false],
  ]) {
    it(`${shown ? 'opens' : 'neither shows nor opens'} a result on ${label}`, () => {
      assert.equal(resultLink(link, socket), shown ? link : null);
    });
  }
});

// Talk to type, against a stand-in for the browser's speech recognition: what the person says lands in the box after
// what was there, interim words included, and nothing is sent when they stop.
describe('talk to type', () => {
  class Speech {
    static last;
    constructor() { Speech.last = this; this.calls = []; }
    start() { this.calls.push('start'); this.onstart?.(); }
    stop() { this.calls.push('stop'); this.hear(['try signing up'], true); this.onend?.(); }
    abort() { this.calls.push('abort'); }
    hear(parts, final = false) { this.onresult?.({ results: parts.map((transcript) => Object.assign([{ transcript }], { isFinal: final })) }); }
  }
  const run = (base) => {
    const seen = { text: [], ended: [], started: 0 };
    const control = listen(Speech, { base, lang: 'en-GB', onStart: () => { seen.started += 1; }, onText: (text) => seen.text.push(text), onEnd: (why) => seen.ended.push(why) });
    return { seen, control, rec: Speech.last };
  };

  it('listens through pauses with interim words, writes them after the box’s text, and keeps them when stopped', () => {
    const { seen, control, rec } = run('On the pricing page ');
    assert.deepEqual([rec.continuous, rec.interimResults, rec.lang, seen.started], [true, true, 'en-GB', 1]);
    rec.hear(['try sign']);
    control.stop();
    assert.deepEqual(seen.text, ['On the pricing page try sign', 'On the pricing page try signing up']);
    assert.deepEqual(seen.ended, [null]);
  });

  // Chrome ends a session by itself after a pause or about a minute of talk: a new one starts, its words
  // follow the earlier ones once (last interim words kept), and only a long silence ends listening.
  it('starts again when Chrome ends a session, without doubling or losing words', () => {
    const { seen, control, rec: first } = run('');
    first.hear(['open the pricing page'], true);
    first.hear(['open the pricing page', ' and compare']);
    first.onend();
    const second = Speech.last;
    assert.notEqual(second, first);
    second.hear(['then click upgrade']);
    control.stop();
    assert.deepEqual(seen.text.slice(-3), ['open the pricing page and compare', 'open the pricing page and compare then click upgrade', 'open the pricing page and compare try signing up']);
    assert.deepEqual([seen.started, seen.ended], [2, [null]]);
  });

  it('starts a new session when words stop coming mid-talk', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { seen, rec: first } = run('');
    first.hear(['open the pricing page']);
    t.mock.timers.tick(8000);
    assert.deepEqual([first.calls, seen.started, seen.ended], [['start', 'stop'], 2, []]);
    Speech.last.hear(['then click upgrade']);
    assert.equal(seen.text.at(-1), 'try signing up then click upgrade');
  });

  it('keeps what the person types while listening, and adds only new words after it', () => {
    const { seen, control, rec } = run('');
    rec.hear(['open pricing']);
    control.retype('open pricing and log in');
    rec.hear(['open pricing', ' then upgrade']);
    assert.equal(seen.text.at(-1), 'open pricing and log in then upgrade');
  });

  it('frees the mic when Chrome never answers a stop', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { seen, control, rec } = run('');
    rec.stop = () => { rec.calls.push('stop'); };
    control.stop();
    assert.deepEqual(seen.ended, []);
    t.mock.timers.tick(2000);
    assert.deepEqual([rec.calls, seen.ended], [['start', 'stop', 'abort'], [null]]);
  });

  it('stops by itself after two silent sessions in a row', () => {
    const { seen, rec: first } = run('');
    first.onerror({ error: 'no-speech' });
    first.onend();
    assert.deepEqual(seen.ended, []);
    Speech.last.onerror({ error: 'no-speech' });
    Speech.last.onend();
    assert.deepEqual([seen.started, seen.ended], [2, [null]]);
  });

  it('starts again when the connection drops, and says so after two failures in a row', () => {
    const { seen, rec: first } = run('');
    first.hear(['open pricing'], true);
    first.onerror({ error: 'network' });
    first.onend();
    Speech.last.onerror({ error: 'network' });
    Speech.last.onend();
    assert.deepEqual(seen.ended, []);
    Speech.last.onerror({ error: 'network' });
    Speech.last.onend();
    assert.deepEqual([seen.started, seen.ended, seen.text.at(-1)], [3, ['network'], 'open pricing']);
  });

  for (const [error, ended] of [['not-allowed', 'not-allowed'], ['audio-capture', 'audio-capture'], ['aborted', null]]) {
    it(`ends once on ${error}, saying ${ended ?? 'nothing'}`, () => {
      const { seen, rec } = run('');
      rec.onerror({ error });
      rec.onend?.();
      assert.deepEqual([seen.started, seen.ended], [1, [ended]]);
    });
  }

  it('drops at once on Send: no more words and no end called back', () => {
    const { seen, control, rec } = run('');
    control.drop();
    rec.onresult?.({ results: [[{ transcript: 'late' }]] });
    rec.onend?.();
    assert.deepEqual([seen.text, seen.ended, rec.calls], [[], [], ['start', 'abort']]);
  });
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
  const field = (attrs = {}, size = 10) => ({ tagName: 'INPUT', type: attrs.type ?? 'text', value: attrs.value ?? '', getAttribute: (name) => attrs[name] ?? null, getBoundingClientRect: () => ({ width: size, height: size }), checkVisibility: () => size > 0 });
  // `inputs`: every field of the page (`input`), the passwords among them unless given.
  const doc = ({ passwords = [], inputs = passwords, frames = [], hosts = [], active = null } = {}) => ({ activeElement: active, querySelectorAll: (sel) => (sel === '*' ? [...frames, ...hosts] : sel === 'input' ? inputs : passwords) });
  // A form of these fields: each knows it (`field.form`), and the page holds them all.
  const form = (...fields) => {
    const own = { querySelectorAll: (sel) => (sel === 'input' ? fields : fields.filter((f) => f.type === 'password')) };
    for (const f of fields) f.form = own;
    return fields;
  };
  const page = (...forms) => doc({ inputs: forms.flat(), passwords: forms.flat().filter((f) => f.type === 'password') });
  const host = (root) => ({ tagName: 'DIV', shadowRoot: root });
  const frame = (inner) => ({ tagName: 'IFRAME', contentDocument: inner });
  const seen = (document, status = 200) => JSON.parse(vm.runInNewContext(`JSON.stringify((${lookInPage})())`, { document, performance: { getEntriesByType: () => [{ responseStatus: status }] } }));

  for (const [label, document, expected] of [
    ['a visible password field', doc({ passwords: [field({ type: 'password' })] }), { password: true, focus: null }],
    ['a password field of no size', doc({ passwords: [field({ type: 'password' }, 0)] }), { password: false, focus: null }],
    ['a password field in a frame on its origin', doc({ frames: [frame(doc({ passwords: [field({ type: 'password' })] }))] }), { password: true, focus: null }],
    ['a password field in an open shadow root', doc({ hosts: [host(doc({ passwords: [field({ type: 'password' })] }))] }), { password: true, focus: null }],
    // hr-pilot-vercel's own pages, as read from them (15 Nov): its login, and its settings signed in.
    ['a login: a username and a password', page(form(field({ autocomplete: 'username' }), field({ type: 'password', autocomplete: 'current-password' }))), { password: true, focus: null }],
    ['a sign-up: an email and two passwords', page(form(field({ type: 'email' }), field({ type: 'password' }), field({ type: 'password' }))), { password: true, focus: null }],
    ['settings signed in: a profile with an email, and a change of password', page(form(field({}), field({ type: 'email' })), form(field({ type: 'password', id: 'current-password' }), field({ type: 'password', id: 'new-password' }))), { password: false, focus: null }],
    ['settings signed in, a password already in the change of password', page(form(field({ type: 'password', id: 'current-password', value: 'x' }), field({ type: 'password', id: 'new-password' }))), { password: true, filled: true, focus: null }],
    ['a login with its password filled', page(form(field({ autocomplete: 'username' }), field({ type: 'password', value: 'x' }))), { password: true, filled: true, focus: null }],
    ['a page signed in with an email field', page(form(field({ type: 'email' }))), { password: false, focus: null }],
    ['focus on a password field', doc({ active: field({ type: 'password' }) }), { password: false, focus: 'password' }],
    ['focus on a card number', doc({ active: field({ autocomplete: 'shipping cc-number' }) }), { password: false, focus: 'card' }],
    ['focus on a one-time code', doc({ active: field({ autocomplete: 'one-time-code' }) }), { password: false, focus: 'code' }],
    ['focus in a frame on another origin', doc({ active: frame(null) }), { password: false, focus: 'frame' }],
    ['focus on a password field in a frame on its origin', doc({ active: frame(doc({ active: field({ type: 'password' }) })) }), { password: false, focus: 'password' }],
    ['focus on a plain field', doc({ active: field({ autocomplete: 'email' }) }), { password: false, focus: null }],
  ]) {
    it(`sees ${label}`, () => { assert.deepEqual(seen(document), { filled: false, ...expected, status: 200 }); });
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
    // It tells the worker it is here (so the page is not reloaded mid-hand-off), and tells nobody else anything.
    const answers = [];
    for (const id of ['ext', 'other']) heard({ walks: 'here' }, { id }, (answer) => answers.push([id, answer.here]));
    assert.deepEqual(answers, [['ext', true]]);
    const [major, minor] = MANIFEST.version.split('.').map(Number);
    assert.ok(major > 0 || minor >= 2, MANIFEST.version);
  });
});

// The real Chrome worker (detector, then walks) on a stubbed browser: both halves share one set of listeners.
describe('walk worker', () => {
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
    action: { async setPopup({ popup }) { toolbar.push({ popup }); }, async setBadgeText() {}, async setBadgeBackgroundColor() {}, async setTitle({ title }) { titles.push(title); } },
    debugger: { onEvent: event('debugger-event'), onDetach: event('detach') },
    storage: { session: area(), local: area(), sync: { async get(defaults) { return defaults; } } },
    tabs: { onRemoved: event('removed'), onReplaced: event('replaced'), onCreated: event('created'), onUpdated: event('updated'), async sendMessage() {} },
    sidePanel: { async open() {}, async setPanelBehavior({ openPanelOnActionClick }) { toolbar.push({ openPanelOnActionClick }); } },
  };
  const loaded = import('../extension/walks/worker.js');

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

  it('points the toolbar icon at the walk panel while a walk is under way, and back at the popup after', async () => {
    await loaded;
    // The server calls the walk off.
    sockets.at(-1).onclose({ reason: 'cancelled' });
    assert.deepEqual(toolbar.slice(-4), [{ popup: '' }, { openPanelOnActionClick: true }, { popup: MANIFEST.action.default_popup }, { openPanelOnActionClick: false }]);
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

  // A journey from the command or an agent comes through our page, with no panel to pick: the card's sight, beside the
  // block (an older build refuses it inside), draws its pictures. One pixel each: red, then white.
  it('draws the pictures of a journey our page hands over as the persona card’s sight sees them', async () => {
    await loaded;
    const { seenAs } = await import('../extension/walks/sight.js');
    const taken = btoa(String.fromCharCode(255, 0, 0, 255, 255, 255, 255, 255));
    const kept = { bitmap: globalThis.createImageBitmap, canvas: globalThis.OffscreenCanvas };
    globalThis.createImageBitmap = async (blob) => ({ width: 2, height: 1, px: new Uint8ClampedArray(await blob.arrayBuffer()), close() {} });
    globalThis.OffscreenCanvas = class {
      getContext() { const canvas = this; return { drawImage(bitmap) { canvas.px = bitmap.px; }, getImageData: () => ({ data: canvas.px }), putImageData({ data }) { canvas.px = data; } }; }
      async convertToBlob() { return new Blob([this.px]); }
    };
    const walk = async (sees) => {
      const before = sockets.length;
      const answer = await new Promise((resolve) => { for (const listener of listeners.message) listener({ handoff: JSON.stringify(block()), ...(sees ? { sees } : {}) }, fromPage, resolve); });
      for (let turn = 0; turn < 50 && sockets.length === before; turn++) await new Promise((resolve) => setImmediate(resolve));
      const seen = await seenAs(taken, 'png');
      sockets.at(-1).onclose({ reason: 'cancelled' });
      return { ok: answer.ok, changed: seen !== taken };
    };
    try {
      assert.deepEqual(await walk('older-eyes'), { ok: true, changed: true });
      assert.deepEqual(await walk('x-ray'), { ok: true, changed: false }, 'a sight no filter draws: the picture as taken');
      assert.deepEqual(await walk(null), { ok: true, changed: false });
    } finally {
      Object.assign(globalThis, { createImageBitmap: kept.bitmap, OffscreenCanvas: kept.canvas });
    }
  });

  // A reload mid-hand-off loses the walk: added, the extension reloads only the start pages that cannot have handed one over.
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
    const { ops, command, current } = await walked();
    assert.equal(current().tab, 11, 'the view knows the walked tab, where the panel shows its result');
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

  it('films none of the person’s screen while they have the tab, and films again once they hand it back', async () => {
    const { ops, command } = await walked();
    page.seen = {};
    await ops.cdp({ method: 'Page.startScreencast', params: { maxWidth: 50 } });
    await settle(100);
    assert.equal(await command('takeover'), true);
    await settle(20);
    const taken = sent.length;
    const frames = told.length;
    await settle(200);
    assert.deepEqual([since(taken, 'Page.captureScreenshot'), told.slice(frames).filter((m) => m.method === 'Page.screencastFrame').length], [0, 0]);
    assert.equal(await command('handback'), true);
    await settle(150);
    assert.ok(since(taken, 'Page.captureScreenshot') > 0, 'the film rolls again');
    await ops.cdp({ method: 'Page.stopScreencast' });
  });

  // `g1` is the goto's own document, committed before Page.navigate answers, as Chrome does it.
  const commit = (loaderId, status) => {
    fire('Page.frameNavigated', { frame: { id: 'main', loaderId, url: `http://localhost:3000/${loaderId}` } });
    fire('Network.responseReceived', { type: 'Document', frameId: 'main', loaderId, requestId: loaderId, response: { status, headers: {} } });
  };
  const load = (loaderId) => fire('Page.lifecycleEvent', { frameId: 'main', name: 'load', loaderId });
  for (const [label, then, status] of [
    ['its own load', () => load('g1'), 200],
    ['the load of the page a script sent it on to', () => { commit('g2', 203); load('g2'); }, 203],
    ['no load from a page that did not follow its own', () => load('l1'), 'TimeoutError'],
  ]) {
    it(`settles a goto on ${label} (REN-1910)`, async () => {
      const { ops } = await walked();
      const navigate = answers['Page.navigate'];
      answers['Page.navigate'] = () => { commit('g1', 200); return { loaderId: 'g1' }; };
      try {
        const went = ops.goto({ url: 'http://localhost:3000/', waitUntil: 'load', timeout: 60 });
        await settle(5);
        then();
        assert.equal(await went.then((r) => r.value.status, (err) => err.name), status);
      } finally {
        answers['Page.navigate'] = navigate;
      }
    });
  }

  // Each sign of a sign-in pauses the walk before anything else is done, and Continue keeps it paused while a 401 holds.
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
      else if (sign === 'a 401 asking for a password') {
        assert.equal(await command('resume'), false, 'Continue while it still shows');
        assert.equal(current().state, 'paused');
      }
      page.seen = {};
      assert.equal(await command('resume'), true);
      await asked;
      assert.deepEqual([answered, current().state, current().held, titles.at(-1)], [true, 'walking', null, MANIFEST.name]);
    });
  }

  // A page the detector reads as a sign-in that is not one (a settings page signed in): Continue is the person's word,
  // and the walk goes on there. Another page with a password field pauses it again.
  it('goes on at Continue past a password field on that page, and pauses again on the next', async () => {
    const { ops, command, current } = await walked();
    fire('Page.frameNavigated', { frame: { id: 'main', loaderId: 'l8', url: 'http://localhost:3000/settings' } });
    page.seen = { password: true };
    // Pictures, as a terminal walk takes one each step (the address stays the page's).
    const asked = ops.screenshot({ format: 'png' });
    await settle(20);
    assert.deepEqual([current().state, current().held], ['paused', 'sign-in']);
    assert.equal(await command('resume'), true, 'Continue while the field still shows');
    await asked;
    await ops.screenshot({ format: 'png' });
    await settle(20);
    assert.equal(current().state, 'walking', 'that page pauses no more');
    page.seen = { password: true, filled: true };
    const filled = ops.screenshot({ format: 'png' });
    await settle(20);
    assert.deepEqual([current().state, current().held], ['paused', 'sign-in'], 'a password in a field there pauses it again');
    page.seen = { password: true };
    assert.equal(await command('resume'), true);
    await filled;
    fire('Page.frameNavigated', { frame: { id: 'main', loaderId: 'l9', url: 'http://localhost:3000/elsewhere' } });
    const next = ops.screenshot({ format: 'png' });
    await settle(20);
    assert.deepEqual([current().state, current().held], ['paused', 'sign-in'], 'the next page pauses');
    page.seen = {};
    await command('resume');
    await next;
    // Off the page Continue was pressed on, for the tests after.
    fire('Page.frameNavigated', { frame: { id: 'main', loaderId: 'l10', url: 'http://localhost:3000/' } });
  });

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

  // How the persona sees (REN-1892, REN-2038): the journey's pictures are drawn as the side panel picked for it, else as
  // the persona's card says, and go as taken for one who sees normally. A picture here is raw RGBA bytes, pixel by
  // pixel: red, green, blue, white, black.
  it('sends the persona pictures as this journey’s sight sees them, and untouched for normal eyes', async () => {
    const { ops } = await walked();
    page.seen = {};
    const PIXELS = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255], [0, 0, 0]];
    const taken = btoa(String.fromCharCode(...PIXELS.flatMap((rgb) => [...rgb, 255])));
    const kept = { shot: answers['Page.captureScreenshot'], bitmap: globalThis.createImageBitmap, canvas: globalThis.OffscreenCanvas };
    answers['Page.captureScreenshot'] = () => ({ data: taken });
    globalThis.createImageBitmap = async (blob) => ({ width: PIXELS.length, height: 1, px: new Uint8ClampedArray(await blob.arrayBuffer()), close() {} });
    globalThis.OffscreenCanvas = class {
      constructor(width, height) { this.px = new Uint8ClampedArray(width * height * 4); }
      getContext() {
        const canvas = this;
        return { drawImage(bitmap) { canvas.px.set(bitmap.px); }, getImageData() { return { data: canvas.px }; }, putImageData({ data }) { canvas.px = data; }, measureText: () => ({ width: 0 }), beginPath() {}, roundRect() {}, fill() {}, fillText() {} };
      }
      async convertToBlob() { return new Blob([this.px]); }
    };
    const { handoff: was } = await chrome.storage.session.get('handoff');
    // `sight`: the panel's pick for this journey; `card`: the persona card's own.
    const seen = async (sight, card) => {
      await chrome.storage.session.set({ handoff: { ...was, ...(sight ? { sees: sight } : {}), persona: { name: 'Mira', role: '', ...(card ? { sees: card } : {}) } } });
      const { data } = (await ops.screenshot({ format: 'png' })).value;
      const bytes = Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0));
      return { data, px: PIXELS.map((_, i) => [...bytes.subarray(i * 4, i * 4 + 3)]) };
    };
    try {
      assert.equal((await seen(null)).data, taken, 'none chosen: the picture as taken');
      assert.equal((await seen('normal', 'older-eyes')).data, taken, 'Normal picked for a persona with older eyes: the picture as taken');
      const card = await seen(null, 'colour-blind');
      assert.ok(card.data !== taken && card.data === (await seen('colour-blind')).data, 'none picked: the card’s own');
      const [red, green, blue] = (await seen('colour-blind')).px;
      assert.ok(Math.abs(red[0] - red[1]) < 40 && Math.abs(green[0] - green[1]) < 40, `red and green both turn olive: ${red} ${green}`);
      assert.ok(blue[2] > blue[0] + 100, `blue stays blue: ${blue}`);
      const [, , , white, black] = (await seen('older')).px;
      assert.ok(white.every((v) => v < 230) && black.every((v) => v > 15), `older eyes see less contrast: ${white} ${black}`);
      assert.ok(white[2] < white[0] - 15, `and less blue: ${white}`);
      // A full page, taller than the tab: the replay keeps its top and right edge, so the label goes there, sized to it.
      let box = null;
      const context = OffscreenCanvas.prototype.getContext;
      OffscreenCanvas.prototype.getContext = function () { return { ...context.call(this), roundRect: (x, y, w, h) => { box = { x, y, w, h }; } }; };
      globalThis.createImageBitmap = async () => ({ width: 2108, height: 1498, px: new Uint8ClampedArray(2108 * 1498 * 4), close() {} });
      await seen('older');
      assert.ok(box && box.y < 50 && box.x > 2108 / 2 && box.h >= 40, `the label sits top right, big enough to read when shrunk: ${JSON.stringify(box)}`);
    } finally {
      await chrome.storage.session.set({ handoff: was });
      answers['Page.captureScreenshot'] = kept.shot;
      Object.assign(globalThis, { createImageBitmap: kept.bitmap, OffscreenCanvas: kept.canvas });
    }
  });

  it('keeps a sign-in pause the person takes over hushed, and goes on when they hand back', async () => {
    const { command, current } = await walked();
    page.seen = { password: true };
    await command('pause');
    await command('resume');
    assert.deepEqual([current().state, current().held], ['paused', 'sign-in']);
    assert.equal(await command('takeover'), true);
    const heard = told.length;
    fire('Page.frameNavigated', { frame: { id: 'main', loaderId: 'l3', url: 'http://localhost:3000/callback?code=secret' } });
    assert.deepEqual(told.slice(heard).filter((m) => m.event !== 'takeover').map((m) => m.event), [], 'nothing of the page is told while they sign in');
    assert.equal(await command('handback'), true, 'handed back: the person is done, though a password field still shows');
    assert.equal(current().state, 'walking');
    page.seen = {};
    await settle(5);
    assert.equal(told.slice(heard).find((m) => m.event === 'url')?.url, 'http://localhost:3000/callback?code=secret', 'told once it goes on');
    fire('Page.frameNavigated', { frame: { id: 'main', loaderId: 'l3b', url: 'http://localhost:3000/' } });
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

  // REN-1891: the op says where, never what. Whatever else it carries, the page gets the picture shipped in walks/.
  it('attaches only the bundled sample picture, whatever file, path or address the op names', async () => {
    const { ops } = await walked();
    page.seen = {};
    const fetched = [];
    const given = [];
    const { fetch } = globalThis;
    const { sendCommand } = chrome.debugger;
    globalThis.fetch = async (url) => { fetched.push(String(url)); return new Response(readFileSync(path.join(ROOT, 'extension', String(url).replace('chrome-extension://ext/', '')))); };
    chrome.debugger.sendCommand = async (target, method, params) => {
      if (method !== 'Runtime.evaluate' || !params?.expression?.includes('elementFromPoint')) return sendCommand(target, method, params);
      given.push(params.expression);
      return { result: { value: 'picker' } };
    };
    try {
      const named = { file: '/etc/passwd', path: '/Users/me/secret.png', url: 'https://evil.example/x.png', data: 'ZXZpbA==', name: 'evil.exe', type: 'text/html' };
      assert.deepEqual(await ops.upload({ x: 5, y: 6, ...named }), { value: 'picker' });
      assert.deepEqual(fetched, ['chrome-extension://ext/walks/sample-photo.png']);
      const sample = readFileSync(path.join(ROOT, 'extension/walks/sample-photo.png')).toString('base64');
      assert.ok(given[0].endsWith(`)(5,6,"${sample}","sample-photo.png","image/png")`));
      for (const value of Object.values(named)) assert.ok(!given[0].includes(value), `${value} never reaches the page`);
    } finally {
      globalThis.fetch = fetch;
      chrome.debugger.sendCommand = sendCommand;
    }
  });

  // REN-1891: dragover bubbles, so a page that cancels it on the document would make any point read as a drop box.
  // The page script runs against a stand-in page whose events go in and back out through the parents, as Chrome's do.
  for (const [cancels, gives] of [['document', 'NotFound'], ['box', 'drop']]) {
    it(`drops the picture only where the box at the point takes it: cancelled on the ${cancels} gives ${gives}`, async () => {
      const { ops } = await walked();
      page.seen = {};
      const node = (up, element = true) => ({
        up, parentElement: element ? up : null, heard: [], closest: () => null,
        addEventListener(type, fn, capture = false) { this.heard.push({ type, fn, capture }); },
        removeEventListener(type, fn, capture = false) { this.heard = this.heard.filter((l) => !(l.type === type && l.fn === fn && l.capture === capture)); },
        dispatchEvent(e) {
          const path = [];
          for (let at = this; at; at = at.up) path.unshift(at);
          const run = (at, capture) => { for (const l of at.heard.filter((h) => h.type === e.type && h.capture === capture)) l.fn(e); };
          for (const at of path.slice(0, -1)) run(at, true);
          run(this, true);
          run(this, false);
          for (const at of path.slice(0, -1).reverse()) run(at, false);
        },
      });
      const document = node(null, false);
      const html = node(document, false);
      document.body = node(html);
      const box = node(document.body);
      const at = node(box);
      document.elementFromPoint = () => at;
      const dropped = [];
      const cancelling = cancels === 'document' ? document : box;
      for (const type of ['dragenter', 'dragover']) cancelling.addEventListener(type, (e) => e.preventDefault());
      cancelling.addEventListener('drop', (e) => { dropped.push(e.type); e.preventDefault(); });
      const stand = {
        document, File, Uint8Array, atob, Event: class {}, HTMLInputElement: class {},
        DataTransfer: class { constructor() { this.items = { add() {} }; } },
        DragEvent: class { constructor(type) { this.type = type; this.defaultPrevented = false; } preventDefault() { this.defaultPrevented = true; } },
      };
      const { fetch } = globalThis;
      const { sendCommand } = chrome.debugger;
      globalThis.fetch = async (url) => new Response(readFileSync(path.join(ROOT, 'extension', String(url).replace('chrome-extension://ext/', ''))));
      chrome.debugger.sendCommand = async (target, method, params) => (String(params?.expression).includes('elementFromPoint') ? { result: { value: vm.runInNewContext(params.expression, stand) } } : sendCommand(target, method, params));
      try {
        const got = await ops.upload({ x: 5, y: 6 }).then((r) => r.value, (err) => err.name);
        assert.deepEqual([got, dropped], [gives, gives === 'drop' ? ['drop'] : []]);
      } finally {
        globalThis.fetch = fetch;
        chrome.debugger.sendCommand = sendCommand;
      }
    });
  }

  // REN-1891: a pause that lands while the upload's world is being made gives the page no picture.
  it('gives no picture when a pause lands while the upload is under way', async () => {
    const { ops, command } = await walked();
    page.seen = {};
    const { fetch } = globalThis;
    globalThis.fetch = async (url) => new Response(readFileSync(path.join(ROOT, 'extension', String(url).replace('chrome-extension://ext/', ''))));
    let release;
    answers['Page.createIsolatedWorld'] = () => new Promise((resolve) => { release = () => resolve({ executionContextId: 9 }); });
    const given = [];
    const { sendCommand } = chrome.debugger;
    chrome.debugger.sendCommand = async (target, method, params) => { if (String(params?.expression).includes('elementFromPoint')) given.push(method); return sendCommand(target, method, params); };
    try {
      const upload = ops.upload({ x: 5, y: 6 });
      for (let turn = 0; turn < 50 && !release; turn++) await settle(1);
      assert.equal(await command('pause'), true);
      release();
      await assert.rejects(upload, { name: 'Paused' });
      assert.deepEqual(given, [], 'nothing reaches the page');
    } finally {
      chrome.debugger.sendCommand = sendCommand;
      answers['Page.createIsolatedWorld'] = () => ({ executionContextId: 9 });
      globalThis.fetch = fetch;
      await command('resume');
    }
  });

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

  // Signing in while paused: Chrome pushes an extension's debugger off a tab that is still open, as `target_closed`,
  // when another extension puts a frame of its own in the page (1Password's "Save login?" on the page a sign-in lands
  // on), and refuses it back until that frame goes. The journey keeps its tab, or the one Chrome swapped in for it;
  // only a tab that is gone ends it.
  // `refusing`: what Chrome refuses while the frame is there: the debugger's attach, or every command once the frame
  // lands after the debugger got back on.
  for (const [label, kept, push, refusing = 'attach'] of [
    ['another extension’s frame pushes the debugger off the open tab', 11, ({ detach }) => detach(11)],
    ['another extension’s frame lets the debugger back on but refuses it the page', 11, ({ detach }) => detach(11), 'command'],
    ['Chrome swaps the tab for another', 12, ({ detach, replaced }) => { replaced(12, 11); detach(11); }],
    ['the tab is closed', null, ({ detach, removed }) => { detach(11); removed(11); }],
  ]) {
    it(`${kept === null ? 'ends' : 'keeps'} a journey paused at a sign-in when ${label}`, async () => {
      const { ops, command, current, rearm, dispatch } = await walked();
      await ops.close();
      rearm();
      dispatch({ type: 'handoff', handoff: { persona: { name: 'Mira', role: '' }, errand: { name: '', goal: 'Look around.', doneWhen: [] }, site: 'http://localhost:3000' } });
      await ops.open({ url: 'http://localhost:3000/', name: 'Mira' });
      assert.equal(await command('pause'), true);
      fire('Page.frameNavigated', { frame: { id: 'main', loaderId: 's1', url: 'http://localhost:3000/people' } });
      const heard = told.length;
      const { attach, sendCommand } = chrome.debugger;
      const { get } = chrome.tabs;
      const armed = [];
      let refused = refusing === 'attach';
      const refusal = () => new Error('Cannot access a chrome-extension:// URL of different extension');
      chrome.debugger.attach = async () => { if (refused && refusing === 'attach') throw refusal(); };
      chrome.debugger.sendCommand = async (target, method, params) => {
        if (refused && refusing === 'command') throw refusal();
        if (method === 'Fetch.enable') armed.push(target.tabId);
        return sendCommand(target, method, params);
      };
      chrome.tabs.get = async (id) => { if (kept === null) throw new Error(`No tab with id: ${id}.`); return get(id); };
      const fireAll = (name, ...args) => { for (const listener of listeners[name] ?? []) listener(...args); };
      try {
        push({ detach: (tabId) => fireAll('detach', { tabId }, 'target_closed'), replaced: (added, gone) => fireAll('replaced', added, gone), removed: (tabId) => fireAll('removed', tabId, {}) });
        await settle(10);
        refused = true;
        if (kept === null) {
          assert.deepEqual([current().state, current().failure?.reason], ['failed', 'tab-closed']);
          assert.deepEqual(told.slice(heard).filter((m) => m.event === 'detached').map((m) => m.reason), ['target_closed']);
          return;
        }
        assert.equal(await command('resume'), false, 'Continue waits while the debugger cannot get back on');
        assert.equal(current().state, 'paused');
        refused = false;
        assert.equal(await command('resume'), true);
        assert.equal(current().state, 'walking');
        assert.deepEqual([...new Set(armed)], [kept], 'the guard is on the tab again before the walk goes on');
        assert.deepEqual(told.slice(heard).filter((m) => m.event === 'detached'), [], 'the other end never hears the tab went');
      } finally {
        Object.assign(chrome.debugger, { attach, sendCommand });
        chrome.tabs.get = get;
      }
    });
  }

  // Last, as it ends the walk: Stop, or the socket going (it closes the walk), while the walk's tab is still being
  // opened ends the walk and closes it.
  for (const [step, by] of [['create', 'stop'], ['attach', 'stop'], ['create', 'close'], ['attach', 'close']]) {
    it(`ends the walk and closes its tab when ${by === 'stop' ? 'Stop' : 'the socket going'} comes as the tab is ${step === 'create' ? 'made' : 'taken'}`, async () => {
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
        if (by === 'stop') assert.equal(await command('stop'), true);
        else await ops.close();
        go();
        await assert.rejects(opening, { name: 'Stopped' });
        assert.deepEqual(removed, [12]);
        if (by === 'stop') assert.equal(current().state, 'stopped');
        // Ended here, so the walks below can start.
        else dispatch({ type: 'stop' });
        if (step === 'create') assert.deepEqual(attached, [], 'the debugger never reaches it');
      } finally {
        Object.assign(chrome.tabs, { create, remove });
        chrome.debugger.attach = attach;
      }
    });
  }

  // A walk of the person's own tab, handed over by the account worker: after the walks above, as it takes the one walk there is.
  const SHOP = 'https://shop.example.com';
  const started = (over = {}) => JSON.stringify(block({ socket: 'wss://impeccable.reviews/api/outings/o1/socket', url: `${SHOP}/cart`, ...over }));
  const fromMain = async ({ handoff, tabId }) => (await import('../extension/walks/link.js')).adopt(handoff, tabId);
  const tabs = { made: [], removed: [], ungrouped: [], groupId: -1, url: `${SHOP}/cart` };
  // The person's history in the tab: a page of the same site from before the walk, then where it starts.
  const history = { currentIndex: 1, entries: [{ id: 1, url: `${SHOP}/before` }, { id: 2, url: `${SHOP}/cart` }] };
  let own;
  const ownTab = () => (own ??= (async () => {
    const walk = await walked();
    await walk.ops.close();
    answers['Page.getNavigationHistory'] = () => history;
    Object.assign(chrome.tabs, {
      async create(tab) { tabs.made.push(tab); return { id: 30, windowId: 1 }; },
      async remove(id) { tabs.removed.push(id); },
      async get(id) { return { id, windowId: 1, index: 3, url: tabs.url, groupId: tabs.groupId, width: 1280, height: 800, active: true }; },
      async ungroup(id) { tabs.ungrouped.push(id); },
    });
    return walk;
  })());

  for (const [label, handoff, why] of [
    ['a socket on another host', started({ socket: 'wss://example.com/api/outings/o1/socket' }), 'socket'],
    ['our own app as the tab', started({ url: 'https://app.impeccable.style/app/acme' }), 'url'],
    ['a tab that is on another site now', started({ url: 'https://elsewhere.example.com/' }), 'tab'],
    ['sites of its own to allow', started({ allow: ['https://api.shop.example.com'] }), 'allow'],
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
    assert.deepEqual(sent.slice(at).filter((m) => ['Page.navigate', 'Page.reload', 'Emulation.setDeviceMetricsOverride', 'Page.startScreencast'].includes(m)), []);
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

  // The tab asks for a request as a page would: a top-level document unless `extra` says otherwise.
  let moves = 0;
  const move = (url, extra = {}) => fireOn(21, 'Fetch.requestPaused', { requestId: `go-${(moves += 1)}`, resourceType: 'Document', frameId: 'main', request: { method: 'GET', url }, ...extra });
  const fetched = (from) => sent.slice(from).filter((m) => m.startsWith('Fetch.'));
  const goTold = (from) => told.slice(from).filter((m) => m.kind === 'go');
  const click = { action: 'click', x: 5, y: 5 };

  it('asks before another site, once for it and its www and https forms, goes there only on Yes, and keeps a No', async () => {
    const { ops, command, current } = await ownTab();
    page.seen = {};
    // What the other end had heard when the move was let through.
    let heardAtContinue = null;
    const { sendCommand } = chrome.debugger;
    chrome.debugger.sendCommand = async (target, method, params) => {
      if (method === 'Fetch.continueRequest') heardAtContinue ??= goTold(0).map((m) => `${m.event}:${m.said ?? ''}`).slice(-2);
      return sendCommand(target, method, params);
    };
    try {
      for (const [url, answer, done] of [['http://news.example.org/a', 'yes', 'Fetch.continueRequest'], ['https://ads.example.net/', 'no', 'Fetch.failRequest'], ['http://93.184.216.34/', 'yes', 'Fetch.continueRequest']]) {
        await ops.mouse(click);
        const [at, heard] = [sent.length, told.length];
        move(url);
        await settle(5);
        assert.deepEqual([current().ask, fetched(at)], [{ kind: 'go', what: new URL(url).host }, []]);
        await command(answer);
        await settle(5);
        assert.deepEqual(fetched(at), [done]);
        const origin = new URL(url).origin;
        assert.deepEqual(goTold(heard), [{ event: 'asking', kind: 'go', origin }, { event: 'answered', kind: 'go', origin, said: answer }]);
      }
    } finally {
      chrome.debugger.sendCommand = sendCommand;
    }
    assert.deepEqual(heardAtContinue, ['asking:', 'answered:yes'], 'told the question and its answer before the move went on');
    await ops.mouse(click);
    for (const [url, done] of [
      ['https://news.example.org/b', 'Fetch.continueRequest'],
      ['https://www.news.example.org/c', 'Fetch.continueRequest'],
      ['https://ads.example.net/again', 'Fetch.failRequest'],
      ['https://www.ads.example.net/', 'Fetch.failRequest'],
      ['http://192.168.1.1/', 'Fetch.failRequest'],
    ]) {
      const [at, heard] = [sent.length, told.length];
      move(url);
      await settle(5);
      assert.deepEqual([current().ask, fetched(at), goTold(heard)], [null, [done], []], `${url} is not asked about`);
      if (done === 'Fetch.failRequest') assert.equal(told.slice(heard).find((m) => m.event === 'blocked')?.url, url);
    }
  });

  it('asks again after a pause cut a question short, and tells the other end so while paused', async () => {
    const { ops, command, current } = await ownTab();
    page.seen = {};
    await ops.mouse(click);
    const [at, heard] = [sent.length, told.length];
    const origin = 'https://shop.example.net';
    move(`${origin}/`);
    await settle(5);
    assert.equal(current().ask?.kind, 'go');
    assert.equal(await command('pause'), true);
    await settle(5);
    assert.deepEqual([goTold(heard).map((m) => m.said ?? m.event), fetched(at)], [['asking', 'void'], ['Fetch.failRequest']]);
    assert.equal(await command('resume'), true);
    await ops.mouse(click);
    move(`${origin}/`);
    await settle(5);
    assert.equal(current().ask?.what, 'shop.example.net', 'asked again');
    await command('no');
    await settle(5);
  });

  it('asks nothing of a move that is not the walk’s own: a goto, one long after its last click, one while going back', async () => {
    const { ops, current } = await ownTab();
    page.seen = {};
    await assert.rejects(ops.goto({ url: 'https://elsewhere.example.com/', waitUntil: 'load', timeout: 1000 }), { name: 'NotAllowed' });
    assert.equal(current().ask, null);
    await ops.mouse(click);
    const { now } = Date;
    Date.now = () => now() + 11_000;
    try {
      const at = sent.length;
      move('https://late.example.com/');
      await settle(5);
      assert.deepEqual([current().ask, fetched(at)], [null, ['Fetch.failRequest']], 'a page’s own timer is refused unasked');
    } finally {
      Date.now = now;
    }
    // Back: never to the person's page from before the walk, nor to a site the walk may not be on.
    for (const entries of [history.entries, [...history.entries, { id: 3, url: 'https://elsewhere.example.com/' }, { id: 4, url: `${SHOP}/cart` }]]) {
      Object.assign(history, { entries, currentIndex: entries.length - 1 });
      const at = sent.length;
      await assert.rejects(ops.goBack({ waitUntil: 'load', timeout: 1000 }), { name: 'NotAllowed' });
      assert.deepEqual([current().ask, sent.slice(at).filter((m) => m === 'Page.navigateToHistoryEntry')], [null, []]);
    }
    Object.assign(history, { entries: [...history.entries.slice(0, 2), { id: 3, url: `${SHOP}/list` }, { id: 4, url: `${SHOP}/cart` }], currentIndex: 3 });
    await ops.mouse(click);
    const back = ops.goBack({ waitUntil: 'load', timeout: 1000 });
    await settle(10);
    const at = sent.length;
    move('https://redirect.example.com/');
    await settle(5);
    assert.deepEqual([current().ask, fetched(at)], [null, ['Fetch.failRequest']], 'nothing is asked while going back');
    fireOn(21, 'Page.navigatedWithinDocument', { frameId: 'main', url: `${SHOP}/list` });
    await back;
    Object.assign(history, { entries: history.entries.slice(0, 2), currentIndex: 1 });
  });

  it('only looks on another site: a write there fails, and no typing or asked deed is done there', async () => {
    const { ops, current } = await ownTab();
    page.seen = {};
    fireOn(21, 'Page.frameNavigated', { frame: { id: 'main', loaderId: 'n1', url: 'https://news.example.org/a' } });
    for (const [url, method, done, resourceType] of [
      ['https://news.example.org/vote', 'POST', 'Fetch.failRequest'],
      ['https://news.example.org/subscribe', 'POST', 'Fetch.failRequest', 'Document'],
      ['https://forms.example.com/send', 'POST', 'Fetch.failRequest', 'Document'],
      ['https://news.example.org/more', 'GET', 'Fetch.continueRequest'],
      [`${SHOP}/api/cart`, 'POST', 'Fetch.continueRequest'],
    ].map(([url, method, done, resourceType = 'XHR']) => [url, method, done, resourceType])) {
      await ops.mouse(click);
      const at = sent.length;
      move(url, { resourceType, request: { method, url } });
      await settle(5);
      assert.deepEqual([current().ask, fetched(at)], [null, [done]], `${method} ${url}`);
    }
    const at = sent.length;
    await assert.rejects(ops.keyboard({ action: 'type', text: 'hi' }), { name: 'NotAllowed' });
    await assert.rejects(ops.mouse({ ...click, ask: { kind: 'send', what: 'Send the comment' } }), { name: 'NotAllowed' });
    assert.deepEqual([current().ask, sent.slice(at).filter((m) => m.startsWith('Input.'))], [null, []]);
    await ops.keyboard({ action: 'press', key: 'PageDown' });
    assert.equal(sent.slice(at).filter((m) => m === 'Input.dispatchKeyEvent').length, 2, 'a key that only scrolls is pressed');
    fireOn(21, 'Page.frameNavigated', { frame: { id: 'main', loaderId: 'n2', url: `${SHOP}/cart` } });
  });

  it('lets go of the person’s tab at the end and leaves it open, out of the group it was put in', async () => {
    const { ops, current } = await ownTab();
    await ops.close();
    assert.deepEqual([tabs.made, tabs.removed, tabs.ungrouped, current().state], [[], [], [21], 'done']);
  });

  // REN-1890: a journey at phone or tablet width lays the person's tab out at that size, and gives the tab its own size
  // back before the debugger leaves, however the journey ends. Chrome would keep a leftover override no longer than the
  // debugger stays, but the clear is what a stop or a failure is checked by here.
  for (const [label, device, end] of [
    ['Stop, at phone width', 'phone', ({ command }) => command('stop')],
    ['a guard ending (the tab left its site), at tablet width', 'tablet', () => fireOn(21, 'Page.frameNavigated', { frame: { id: 'main', loaderId: 'x1', url: 'https://elsewhere.example.com/' } })],
    ['an open that failed once the tab was sized', 'phone', null],
    ['Cancel on Chrome’s debugging bar, which takes the touch and the user agent but not the size', 'tablet', () => { for (const listener of listeners.detach) listener({ tabId: 21 }, 'canceled_by_user'); }],
  ]) {
    it(`lays the person’s tab out at the width picked, and clears it before letting go on ${label}`, async () => {
      const walk = await ownTab();
      const { ops, current, dispatch, DEVICES } = walk;
      const log = [];
      const { sendCommand, detach, attach } = chrome.debugger;
      chrome.debugger.sendCommand = async (target, method, params) => {
        if (method.startsWith('Emulation.') || method === 'Page.reload') log.push([method, params]);
        if (!end && method === 'Emulation.setTouchEmulationEnabled' && params.enabled) throw new Error('{"message":"no touch here"}');
        return sendCommand(target, method, params);
      };
      chrome.debugger.detach = async () => { log.push(['detach']); };
      chrome.debugger.attach = async () => { log.push(['attach']); };
      try {
        const before = sockets.length;
        assert.equal((await (await import('../extension/walks/link.js')).adopt(started(), 21, device)).ok, true);
        for (let turn = 0; turn < 50 && sockets.length === before; turn++) await settle(1);
        // The page loads again under its new size: its `load` comes as Chrome's would.
        const loaded = setInterval(() => fireOn(21, 'Page.lifecycleEvent', { frameId: 'main', name: 'load', loaderId: 'again' }), 2);
        const opening = ops.open({ url: `${SHOP}/`, name: 'Ines' }).finally(() => clearInterval(loaded));
        if (!end) {
          await assert.rejects(opening, /no touch here/);
          // The server ends a walk whose tab did not open.
          sockets.at(-1).onclose({ reason: 'cancelled' });
        }
        else {
          await opening;
          // Loaded again once, after the size and before anything else; and kept beyond this worker until given back.
          const methods = log.map(([method]) => method);
          assert.equal(methods.indexOf('Page.reload'), methods.indexOf('Emulation.setUserAgentOverride') + 1, methods.join());
          assert.deepEqual((await chrome.storage.session.get('sizedTab')).sizedTab, { tabId: 21, device });
          // The engine's own size for the walk does not undo the person's pick.
          await ops.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
          await end(walk);
          await settle(5);
        }
        const { width, height } = DEVICES[device];
        assert.deepEqual(log.find(([method]) => method === 'Emulation.setDeviceMetricsOverride')[1], { width, height, deviceScaleFactor: 1, mobile: true });
        if (end) assert.match(log.find(([method]) => method === 'Emulation.setUserAgentOverride')[1].userAgent, /Android/);
        assert.equal((await chrome.storage.session.get('sizedTab')).sizedTab, undefined);
        const tail = log.slice(label.startsWith('Cancel') ? -6 : -4).map(([method, params]) => (method === 'Emulation.setDeviceMetricsOverride' ? 'size' : ['attach', 'detach'].includes(method) ? method : `${method}:${JSON.stringify(params ?? {})}`));
        // Cleared before the debugger leaves; after a debugger that left by itself, a moment's one sets the size and clears it.
        assert.deepEqual(tail, label.startsWith('Cancel')
          ? ['attach', 'size', 'Emulation.clearDeviceMetricsOverride:{}', 'Emulation.setTouchEmulationEnabled:{"enabled":false}', 'Emulation.setUserAgentOverride:{"userAgent":""}', 'detach']
          : ['Emulation.clearDeviceMetricsOverride:{}', 'Emulation.setTouchEmulationEnabled:{"enabled":false}', 'Emulation.setUserAgentOverride:{"userAgent":""}', 'detach']);
      } finally {
        Object.assign(chrome.debugger, { sendCommand, detach, attach });
        // Ended here when it did not end itself, so the walks below can start.
        dispatch({ type: 'stop' });
      }
    });
  }

  it('gives back the size of a tab the last worker sized and never let go of, as the next worker starts', async () => {
    await ownTab();
    const log = [];
    const { sendCommand, detach, attach } = chrome.debugger;
    chrome.debugger.sendCommand = async (target, method, params) => { log.push(`${target.tabId} ${method}${method === 'Emulation.setDeviceMetricsOverride' ? '' : JSON.stringify(params ?? {})}`); };
    chrome.debugger.detach = async ({ tabId }) => { log.push(`${tabId} detach`); };
    chrome.debugger.attach = async ({ tabId }) => { log.push(`${tabId} attach`); };
    try {
      await chrome.storage.session.set({ sizedTab: { tabId: 33, device: 'phone' } });
      // Another worker's driver, as Chrome starts one: the same module, loaded afresh.
      await import('../extension/walks/driver.js?restarted');
      await settle(10);
      assert.deepEqual(log, ['33 attach', '33 Emulation.setDeviceMetricsOverride', '33 Emulation.clearDeviceMetricsOverride{}', '33 Emulation.setTouchEmulationEnabled{"enabled":false}', '33 Emulation.setUserAgentOverride{"userAgent":""}', '33 detach']);
      assert.equal((await chrome.storage.session.get('sizedTab')).sizedTab, undefined);
    } finally {
      Object.assign(chrome.debugger, { sendCommand, detach, attach });
    }
  });

  // Each on a walk of its own, after the one above has ended: the counts start at nothing.
  for (const [label, answer, asked] of [[`${MAX_OTHER_SITES} other sites`, 'yes', MAX_OTHER_SITES], [`${MAX_SITE_QUESTIONS} questions`, 'no', MAX_SITE_QUESTIONS]]) {
    it(`asks no more after ${label}: the next site is refused unasked`, async () => {
      const { ops, command, current } = await ownTab();
      const before = sockets.length;
      assert.equal((await fromMain({ walks: 'walk', handoff: started(), tabId: 21 })).ok, true);
      for (let turn = 0; turn < 50 && sockets.length === before; turn++) await settle(1);
      await ops.open({ url: `${SHOP}/`, name: 'Ines' });
      page.seen = {};
      try {
        for (let n = 0; n <= asked; n++) {
          await ops.mouse(click);
          const at = sent.length;
          move(`https://site${n}.example.com/`);
          await settle(5);
          if (n === asked) assert.deepEqual([current().ask, fetched(at)], [null, ['Fetch.failRequest']]);
          else {
            assert.equal(current().ask?.what, `site${n}.example.com`);
            await command(answer);
            await settle(5);
          }
        }
      } finally {
        await ops.close();
      }
    });
  }

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
    ['walking a tab of its own', view('walking'), false, true],
  ]) {
    it(`${glow ? 'glows' : 'does not glow'} ${label}`, async () => { assert.equal((await badge()).badgeState(shown, adopted).glow, glow); });
  }
});

describe('derived extension manifests', () => {
  const files = (folder) => [folder, ...readdirSync(path.join(ROOT, 'extension', folder), { recursive: true }).map((file) => `${folder}/${file}`)];

  it('leaves walks and the account out of Firefox', () => {
    const firefox = firefoxManifest(MANIFEST);
    assert.deepEqual(firefox.permissions.filter((permission) => [...WALK_PERMISSIONS, 'identity'].includes(permission)), []);
    for (const key of ['side_panel', 'content_scripts', 'externally_connectable', 'key']) assert.equal(key in firefox, false, key);
    assert.deepEqual(readdirSync(FIREFOX(), { recursive: true }).filter((file) => /^(walks|account)\b|^background\/chrome-worker\.js$|popup\/(account|words)\.js$/.test(file)), []);
  });

  it('ships walks in the store build, held to production hosts with its switches off, and the account out', () => {
    const store = STORE();
    const manifest = JSON.parse(readFileSync(path.join(store, 'manifest.json'), 'utf8'));
    const shipped = readdirSync(store, { recursive: true });
    assert.deepEqual(files('walks').filter((file) => !shipped.includes(file)), [], 'every walk file');
    assert.deepEqual(shipped.filter((file) => /^account\b|popup\/(account|words)\.js$/.test(file)), []);
    assert.deepEqual(files('account').filter((file) => isStoreFile(file)), []);
    assert.deepEqual(moduleReferences(store, manifest.background.service_worker).filter((file) => !existsSync(path.join(store, file))), []);
    assert.deepEqual(manifest.content_scripts.flatMap((entry) => entry.js).sort(), ['walks/handoff-content.js', 'walks/present.js']);
    const matches = manifest.content_scripts.flatMap((entry) => entry.matches);
    assert.deepEqual(matches.filter((match) => /staging|localhost/.test(match)), []);
    assert.equal('key' in manifest, false);
    assert.match(readFileSync(path.join(store, 'shared/build.js'), 'utf8'), /account: false, devHosts: false/);
    assert.doesNotMatch(readFileSync(path.join(store, 'popup/popup.html'), 'utf8'), /account\.js|words\.js/);
    assert.deepEqual(['account/worker.js', 'walks/worker.js'].filter((file) => !moduleReferences(path.join(ROOT, 'extension'), MANIFEST.background.service_worker).includes(file)), []);
  });
});

// Chrome's permission warnings (developer.chrome.com, "Permissions list" and "Permission warning guidelines"): the
// permissions below show none. Any other permission, and any host, counts as one. An update that adds a warning
// switches the extension off until the person accepts it: walks add the four of driving a tab, and nothing else. The
// account (not in the store build) adds one more: the notice when an agent asks for a journey (REN-1909).
describe('extension install warnings', () => {
  const SILENT = ['activeTab', 'alarms', 'identity', 'offscreen', 'scripting', 'sidePanel', 'storage'];
  /** As published in 1.4.0, the version people have installed. */
  const PUBLISHED = { permissions: ['activeTab', 'scripting', 'storage', 'webNavigation', 'offscreen'], host_permissions: ['<all_urls>'] };
  const warned = (manifest) => manifest.permissions.filter((permission) => !SILENT.includes(permission)).sort();
  const hosts = (manifest) => [...(manifest.host_permissions ?? []), ...(manifest.content_scripts ?? []).flatMap((entry) => entry.matches)];

  const GAINED = ['debugger', 'downloads', 'tabGroups', 'tabs'];
  for (const [label, manifest, account] of [['loaded unpacked', MANIFEST, ['notifications']], ['the store build', storeManifest(MANIFEST), []]]) {
    it(`asks for no warning 1.4.0 did not but walks': ${label}`, () => {
      assert.deepEqual(warned(manifest), [...warned(PUBLISHED), ...GAINED, ...account].sort());
      // 1.4.0 has every site, so any content script's pages are already in its warning.
      assert.ok(hosts(PUBLISHED).includes('<all_urls>') || hosts(manifest).every((host) => hosts(PUBLISHED).includes(host)));
      assert.deepEqual(manifest.host_permissions, PUBLISHED.host_permissions);
      assert.equal('optional_permissions' in manifest, false);
    });
  }
});

