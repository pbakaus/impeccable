// The person's own agent in their Chrome (extension/walks/agent.js, REN-2053): what the CLI's relay sends over native
// messaging, what the person is asked in the side panel, and what the agent may and may not reach.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { stageStore, storeManifest } from '../scripts/lib/extension-manifests.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = JSON.parse(readFileSync(path.join(ROOT, 'extension/manifest.json'), 'utf8'));

describe('agent host', () => {
  // Chrome starts the CLI's host only for an origin its manifest lists: the developer build's pinned ID must be there.
  it('is reachable from the developer build, whose key pins an ID the CLI admits', () => {
    const hex = createHash('sha256').update(Buffer.from(MANIFEST.key, 'base64')).digest('hex').slice(0, 32);
    const id = [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
    const ids = readFileSync(path.join(ROOT, 'crates/mcp/src/browser.rs'), 'utf8').match(/pub const EXTENSION_IDS: &\[&str\] = &\[([^\]]*)\]/)[1];
    assert.ok(ids.includes(`"${id}"`), `${id} is not in EXTENSION_IDS`);
    assert.ok(MANIFEST.permissions.includes('nativeMessaging'));
  });

  it('stays out of the store build until its own submission', () => {
    assert.equal(storeManifest(MANIFEST).permissions.includes('nativeMessaging'), false);
    const root = path.join(mkdtempSync(path.join(tmpdir(), 'impeccable-agent-')), 'extension');
    try {
      stageStore(path.join(ROOT, 'extension'), root);
      assert.equal(JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8')).permissions.includes('nativeMessaging'), false);
    } finally {
      rmSync(path.dirname(root), { recursive: true, force: true });
    }
  });
});

describe('agent session', () => {
  const listeners = {};
  const event = (name) => ({ addListener(callback) { (listeners[name] ??= []).push(callback); } });
  const area = () => {
    const kept = {};
    return {
      kept,
      async get(key) { return typeof key === 'string' ? { [key]: kept[key] } : Array.isArray(key) ? Object.fromEntries(key.map((k) => [k, kept[k]])) : { ...key }; },
      async set(values) { Object.assign(kept, values); },
      async remove(key) { for (const k of [key].flat()) delete kept[k]; },
    };
  };
  // The host's end of the port: what the extension posts, and a way to send it a frame.
  const posted = [];
  let toExtension = null;
  let hostGone = null;
  const ports = [];
  const sent = [];
  const args = [];
  let navigations = 0;
  let url = 'about:blank';
  const fire = (method, params) => { for (const listener of listeners['debugger-event'] ?? []) listener({ tabId: 11 }, method, params); };
  const TREE = [
    { nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'Issues' }, childIds: ['2', '3', '5'] },
    { nodeId: '2', role: { value: 'heading' }, name: { value: 'Active issues' }, childIds: [] },
    { nodeId: '3', role: { value: 'generic' }, childIds: ['4'] },
    { nodeId: '4', role: { value: 'button' }, name: { value: 'New issue' }, backendDOMNodeId: 40, childIds: [] },
    { nodeId: '5', role: { value: 'textbox' }, name: { value: 'Password' }, value: { value: 'hunter22' }, backendDOMNodeId: 50, childIds: [] },
  ];
  const answers = {
    'Page.getFrameTree': () => ({ frameTree: { frame: { id: 'main', loaderId: 'l1', url } } }),
    'Page.navigate': ({ url: to }) => {
      const loaderId = `nav-${(navigations += 1)}`;
      setTimeout(() => { url = to; fire('Page.frameNavigated', { frame: { id: 'main', loaderId, url: to } }); fire('Page.lifecycleEvent', { frameId: 'main', name: 'load', loaderId }); }, 1);
      return { loaderId };
    },
    'Page.createIsolatedWorld': () => ({ executionContextId: 9 }),
    'Runtime.evaluate': () => ({ result: { value: {} } }),
    'Accessibility.getFullAXTree': () => ({ nodes: TREE }),
    'DOM.describeNode': ({ backendNodeId }) => ({ node: backendNodeId === 50 ? { nodeName: 'INPUT', attributes: ['type', 'password'] } : { nodeName: 'BUTTON', attributes: [] } }),
    'DOM.getBoxModel': () => ({ model: { border: [100, 200, 180, 200, 180, 240, 100, 240] } }),
    'Page.captureScreenshot': () => ({ data: btoa('still') }),
  };
  globalThis.self = { location: { origin: 'chrome-extension://ext' } };
  globalThis.WebSocket = class { static OPEN = 1; close() {} };
  globalThis.createImageBitmap = async () => ({ close() {} });
  globalThis.OffscreenCanvas = class { getContext() { return { drawImage() {} }; } async convertToBlob() { return new Blob(['x']); } };
  const tabs = { created: 0, removed: [] };
  const panel = { windows: [], opened: [], closed: [] };
  globalThis.chrome = {
    runtime: {
      id: 'ext', lastError: undefined, onMessage: event('message'), onConnect: event('connect'), onInstalled: event('installed'), onStartup: event('startup'),
      getURL: (file) => `chrome-extension://ext/${file}`, async sendMessage() {}, getManifest: () => MANIFEST,
      // Whether the side panel is open: as each test says.
      async getContexts({ contextTypes }) { return contextTypes.includes('SIDE_PANEL') ? panel.windows.map((windowId) => ({ contextType: 'SIDE_PANEL', windowId })) : []; },
      connectNative(name) {
        assert.equal(name, 'style.impeccable.browser');
        const port = {
          onMessage: { addListener(fn) { toExtension = fn; } },
          onDisconnect: { addListener(fn) { hostGone = fn; } },
          postMessage(message) { posted.push(message); },
        };
        ports.push(port);
        return port;
      },
    },
    alarms: { create() {}, onAlarm: event('alarm') },
    action: { async setPopup() {}, async setBadgeText() {}, async setBadgeBackgroundColor() {}, async setTitle() {} },
    debugger: {
      onEvent: event('debugger-event'), onDetach: event('detach'), async attach() {}, async detach() {},
      async sendCommand(_target, method, params) { sent.push(method); args.push(params); return (answers[method] ?? (() => ({})))(params); },
    },
    storage: { session: area(), local: area(), sync: { async get(defaults) { return defaults; } }, onChanged: event('storage-changed') },
    tabs: {
      onRemoved: event('removed'), onReplaced: event('replaced'), onCreated: event('created'), onUpdated: event('updated'), async sendMessage() {}, async query({ active }) { return active ? [{ id: 3, windowId: 1 }] : []; },
      async create() { tabs.created += 1; return { id: 11, windowId: 1 }; }, async get() { return { id: 11, windowId: 1, width: 800, height: 600, active: true, title: 'Issues' }; },
      async group() { return 5; }, async remove(id) { tabs.removed.push(id); }, async update() {},
    },
    tabGroups: { async update() {}, async get() { return { title: 'Impeccable · Claude Code' }; } },
    windows: { async get() { return { focused: true, state: 'normal', width: 800, height: 600 }; } },
    sidePanel: { async open({ windowId }) { panel.opened.push(windowId); }, async close({ windowId }) { panel.closed.push(windowId); }, async setPanelBehavior() {}, async setOptions() {} },
    webNavigation: { frames: [{ frameId: 0, parentFrameId: -1 }], async getAllFrames() { return this.frames; } },
    scripting: { async executeScript({ func }) { return ['coverSecrets', 'coverHolds', 'blankFields'].includes(func?.name) ? [{ frameId: 0, result: 0 }] : []; } },
    declarativeNetRequest: { rules: [], async getSessionRules() { return this.rules; }, async updateSessionRules({ removeRuleIds = [], addRules = [] }) { this.rules = [...this.rules.filter((r) => !removeRuleIds.includes(r.id)), ...addRules]; } },
  };
  const loaded = (async () => {
    await import('../extension/walks/worker.js');
    const store = await import('../extension/walks/store.js');
    await store.ready;
    return { ...store, driver: await import('../extension/walks/driver.js') };
  })();
  after(async () => { const { driver } = await loaded; await driver.ops.close(); });

  const turn = () => new Promise((resolve) => setTimeout(resolve, 5));
  async function until(test, what) {
    for (let n = 0; n < 400; n++) { if (test()) return; await turn(); }
    assert.fail(`never: ${what}`);
  }
  let nextId = 0;
  /** One call as the relay sends it; resolves to the extension's answer. */
  function call(tool, args = {}, agent = 'claude-code') {
    const id = (nextId += 1);
    toExtension({ id, agent, tool, arguments: args });
    return (async () => { await until(() => posted.some((m) => m.id === id), `an answer to ${tool}`); return posted.find((m) => m.id === id).result; })();
  }
  /** The person presses a button in the side panel. */
  const press = (control) => new Promise((resolve) => {
    for (const listener of listeners.message) listener({ control }, { id: 'ext', origin: 'chrome-extension://ext', url: 'chrome-extension://ext/walks/panel/panel.html' }, resolve);
  });
  const said = (result) => result.content.map((c) => c.text ?? '').join('\n');

  it('connects to the CLI’s host as the worker starts', async () => {
    await loaded;
    assert.equal(ports.length, 1);
  });

  it('asks the person in the side panel before a site, opens nothing on Not now, and refuses our own pages unasked', async () => {
    const { current } = await loaded;
    const own = await call('browser_open', { url: 'https://app.impeccable.style/app/acme' });
    assert.equal(own.isError, true);
    assert.equal(current().ask, null, 'our own page is never asked about');
    const asked = call('browser_open', { url: 'https://linear.app/acme' });
    await until(() => current().ask?.kind === 'site', 'the question');
    assert.deepEqual([current().state, current().ask.what, current().who.name, tabs.created], ['waiting', 'linear.app', 'Claude Code', 0]);
    // A Yes isn't one of a site question's answers: nothing opens on it.
    assert.deepEqual(await press('yes'), { ok: false });
    assert.deepEqual(await press('no'), { ok: true });
    const result = await asked;
    assert.equal(result.isError, true);
    assert.match(said(result), /didn’t allow linear\.app/);
    assert.equal(tabs.created, 0);
  });

  it('opens the tab on Always allow and answers with the tree, each control by ref and no secret field’s value', async () => {
    const { current } = await loaded;
    const opened = call('browser_open', { url: 'https://linear.app/acme' });
    await until(() => current().ask?.kind === 'site', 'the question');
    assert.deepEqual(await press('always'), { ok: true });
    const result = await opened;
    const tree = said(result);
    assert.equal(result.isError, undefined, tree);
    assert.match(tree, /heading "Active issues"/);
    assert.match(tree, /button "New issue" \[40\]/);
    assert.doesNotMatch(tree, /hunter22/);
    assert.deepEqual([tabs.created, current().state, current().agent], [1, 'walking', true]);
    assert.deepEqual((await chrome.storage.local.get('agentSites')).agentSites, ['https://linear.app']);
  });

  it('clicks a control by its ref at its middle, and tells the panel’s live log', async () => {
    const { current } = await loaded;
    const at = sent.length;
    const result = await call('browser_act', { op: 'click', ref: 40 });
    assert.equal(result.isError, undefined, said(result));
    const presses = args.slice(at).filter((p, i) => sent[at + i] === 'Input.dispatchMouseEvent' && p.type === 'mousePressed');
    assert.deepEqual(presses.map((p) => [p.x, p.y]), [[140, 220]]);
    assert.deepEqual(current().steps.map((s) => s.did), ['Opened linear.app/acme', 'Clicked “New issue”']);
  });

  it('takes a screenshot only when asked, as an image', async () => {
    const result = await call('browser_look', { kind: 'screenshot' });
    assert.equal(result.content[0].type, 'image');
    assert.equal(result.content[0].mimeType, 'image/jpeg');
  });

  it('asks again for another site, and goes there once allowed for this session alone', async () => {
    const { current } = await loaded;
    const going = call('browser_act', { op: 'goto', url: 'https://github.com/acme' });
    await until(() => current().ask?.kind === 'site', 'the question');
    assert.equal(current().ask.what, 'github.com');
    assert.deepEqual(await press('once'), { ok: true });
    const result = await going;
    assert.equal(result.isError, undefined, said(result));
    assert.equal(url, 'https://github.com/acme');
    assert.deepEqual((await chrome.storage.local.get('agentSites')).agentSites, ['https://linear.app']);
  });

  // Where one click grants an app access beyond the page: the agent never, even on a site it may use.
  it('refuses OAuth and app-install consent pages on an allowed site, by address and by a move there', async () => {
    const { driver } = await loaded;
    for (const url of ['https://github.com/login/oauth/authorize?client_id=x', 'https://github.com/apps/impeccable/installations/new', 'https://github.com/organizations/acme/settings/installations/12', 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x']) {
      const result = await call('browser_act', { op: 'goto', url });
      assert.equal(result.isError, true, url);
      assert.match(said(result), /grants an app access/);
    }
    // A page that sends the tab there itself, on a site the agent may use: the guard aborts the document.
    assert.equal(driver.walk.allowed.includes('https://github.com'), true);
    const at = sent.length;
    const ask = (requestId, to) => fire('Fetch.requestPaused', { requestId, resourceType: 'Document', frameId: 'main', request: { url: to, method: 'GET' } });
    ask('consent', 'https://github.com/settings/installations/1');
    ask('issues', 'https://github.com/acme/issues');
    await until(() => sent.slice(at).filter((m) => m.startsWith('Fetch.')).length >= 2, 'both answered');
    const answered = Object.fromEntries(args.slice(at).map((p, i) => [p?.requestId, sent[at + i]]).filter(([id]) => id));
    assert.deepEqual([answered.consent, answered.issues], ['Fetch.failRequest', 'Fetch.continueRequest']);
  });

  it('goes to another always-allowed site with no question', async () => {
    const { current } = await loaded;
    await chrome.storage.local.set({ agentSites: ['https://linear.app', 'https://figma.com'] });
    const result = await call('browser_act', { op: 'goto', url: 'https://figma.com/file/x' });
    assert.equal(result.isError, undefined, said(result));
    assert.equal(current().ask, null);
    assert.equal(url, 'https://figma.com/file/x');
  });

  it('ends a session using a site the person takes out of Always allow', async () => {
    const { driver } = await loaded;
    assert.ok(driver.walk?.agent);
    const before = (await chrome.storage.local.get('agentSites')).agentSites;
    await chrome.storage.local.set({ agentSites: [] });
    for (const listener of listeners['storage-changed']) listener({ agentSites: { oldValue: before, newValue: [] } }, 'local');
    await until(() => !driver.walk, 'the walk to end');
    // Put back for what follows.
    await chrome.storage.local.set({ agentSites: ['https://linear.app'] });
  });

  it('forgets an Allow once when the session ends', async () => {
    const { current } = await loaded;
    assert.equal(said(await call('browser_end')), 'Ended. The tab is the person’s again.');
    const asked = call('browser_open', { url: 'https://github.com/acme' });
    await until(() => current().ask?.kind === 'site', 'the question again');
    assert.deepEqual(await press('once'), { ok: true });
    assert.equal((await asked).isError, undefined);
  });

  it('ends on the person’s Stop: the debugger leaves, the agent is refused until it goes, and its next start is asked even on an always-allowed site', async () => {
    const { current, driver } = await loaded;
    assert.deepEqual(await press('stop'), { ok: true });
    await until(() => !driver.walk, 'the walk to end');
    assert.equal(current().agent, false, 'no stopped screen left behind');
    const refused = await call('browser_look', { kind: 'tree' });
    assert.equal(refused.isError, true);
    assert.match(said(refused), /stopped/);
    toExtension({ type: 'agent-gone' });
    await turn();
    const again = call('browser_open', { url: 'https://linear.app/acme' });
    await until(() => current().ask?.kind === 'site', 'the question after a Stop');
    assert.deepEqual(await press('once'), { ok: true });
    const reopened = await again;
    assert.equal(reopened.isError, undefined, said(reopened));
  });

  it('ends when the host goes away', async () => {
    const { driver } = await loaded;
    assert.ok(driver.walk?.agent);
    hostGone();
    await until(() => !driver.walk, 'the walk to end');
  });

  it('keeps a Stop the agent leaves during: its next start is still asked', async () => {
    const { current, driver } = await loaded;
    // The host went in the test above: the next minute's alarm connects again.
    for (const listener of listeners.alarm) listener({ name: 'agent-host' });
    assert.equal(ports.length, 2);
    // Always allowed, and nothing since asked for a fresh Allow: it opens unasked.
    const opening = await call('browser_open', { url: 'https://linear.app/acme' });
    assert.equal(opening.isError, undefined, said(opening));
    const stopping = press('stop');
    toExtension({ type: 'agent-gone' });
    await stopping;
    await until(() => !driver.walk, 'the walk to end');
    const again = call('browser_open', { url: 'https://linear.app/acme' });
    await until(() => current().ask?.kind === 'site', 'the question after a Stop it left during');
    await press('no');
    await again;
    toExtension({ type: 'agent-gone' });
  });

  // An agent's run leaves the side panel as it found it (the decider, 18 Nov): no done screen, nothing left behind.
  it('leaves the side panel as it found it when the session ends: closed again, or back at its default view', async () => {
    const { current } = await loaded;
    const empty = (await import('../extension/walks/view.js')).emptyView(false);
    /** One session on linear.app: allowed once if the person is asked. */
    const session = async () => {
      const opening = call('browser_open', { url: 'https://linear.app/acme' });
      await until(() => current().ask?.kind === 'site' || current().state === 'walking', 'asked or open');
      if (current().ask) await press('once');
      assert.equal((await opening).isError, undefined);
      assert.equal((await call('browser_end')).isError, undefined);
    };
    // Closed in the agent's window when the session began (open only in another): opened for the run there, and
    // closed at its end.
    panel.windows = [2];
    let [opens, closes] = [panel.opened.length, panel.closed.length];
    await session();
    assert.deepEqual([panel.opened.slice(opens), panel.closed.slice(closes), current()], [[1], [1], empty]);
    // Open there when it began: neither opened nor closed, and back at its default view.
    panel.windows = [1];
    [opens, closes] = [panel.opened.length, panel.closed.length];
    await session();
    assert.deepEqual([panel.opened.slice(opens), panel.closed.slice(closes), current()], [[], [], empty]);
    panel.windows = [];
    toExtension({ type: 'agent-gone' });
  });

  // A server's walk names its ops in JSON: none can make itself the agent's, and be asked nothing before a submit.
  it('never takes an agent walk from a socket message', async () => {
    const { driver } = await loaded;
    // As a new hand-off does: the person's Stop above held this worker's walks.
    (await import('../extension/walks/control.js')).rearm();
    await driver.ops.open({ url: 'http://localhost:3000/', name: 'Mira', agent: true });
    assert.equal(driver.walk.agent, false);
    await driver.ops.close();
  });
});
