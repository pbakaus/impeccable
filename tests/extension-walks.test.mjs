import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

import { readHandoff } from '../extension/walks/handoff.js';
import { admit, onlyThisTab, verdict } from '../extension/walks/guard.js';
import { firefoxManifest, isFirefoxFile, storeManifest } from '../scripts/lib/extension-manifests.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = JSON.parse(readFileSync(path.join(ROOT, 'extension/manifest.json'), 'utf8'));

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
    const local = readHandoff(
      JSON.stringify(block({ socket: 'ws://localhost:8794/api/outings/o1/socket' })),
      'http://app.localhost:8794/app/acme/outings/o1',
    );
    assert.equal(local.ok, true);
  });

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
  ]) {
    it(`refuses to walk ${url} with ${allow.length} allowed`, () => { assert.throws(() => admit(url, allow), { name: 'NotAllowed' }); });
  }

  const allowed = ['http://localhost:3000'];
  for (const [label, paused, answer] of [
    ['the top document off the site', { resourceType: 'Document', frameId: 'main', request: { url: 'https://example.com/' } }, 'block'],
    ['the top document on the site', { resourceType: 'Document', frameId: 'main', request: { url: 'http://localhost:3000/b' } }, 'continue'],
    ['a frame off the site', { resourceType: 'Document', frameId: 'child', request: { url: 'https://example.com/' } }, 'continue'],
  ]) {
    it(`lets ${label} ${answer}`, () => { assert.equal(verdict(paused, 'main', allowed), answer); });
  }

  it('refuses an op that names another tab', () => {
    assert.throws(() => onlyThisTab({ tabId: 3 }), { name: 'NotAllowed' });
    assert.doesNotThrow(() => onlyThisTab({ selector: '#go' }));
  });
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
  globalThis.WebSocket = class { static OPEN = 1; constructor(url, protocols) { sockets.push({ url, protocols }); } close() {} };
  globalThis.chrome = {
    runtime: {
      id: 'ext', onMessage: event('message'), onConnect: event('connect'), onInstalled: event('installed'), onStartup: event('startup'),
      getURL: (file) => `chrome-extension://ext/${file}`, async sendMessage() {}, getManifest: () => MANIFEST,
    },
    action: { async setBadgeText() {}, async setBadgeBackgroundColor() {} },
    webNavigation: { onCompleted: event('navigation') },
    debugger: { onEvent: event('debugger-event'), onDetach: event('detach') },
    storage: { session: area(), local: area(), sync: { async get(defaults) { return defaults; } } },
    tabs: { onRemoved: event('removed'), onCreated: event('created'), onUpdated: event('updated'), async sendMessage() {} },
    sidePanel: { async open() {} },
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
    assert.deepEqual(sockets.at(-1), { url: block().socket, protocols: ['impeccable-outing', block().ticket] });
  });
});

describe('derived extension manifests', () => {
  it('leaves walks out of Firefox: no walk file, no debugger, no side panel', () => {
    const firefox = firefoxManifest(MANIFEST);
    assert.equal(firefox.permissions.includes('debugger'), false);
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
});
