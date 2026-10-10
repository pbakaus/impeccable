import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Run the real worker with browser API boundaries replaced. Firefox exposes
// getContexts, but rejects OFFSCREEN_DOCUMENT before the scan can start.
function scannerHarness({ firefox = false, existingHost = false, failFirstCreate = false, ping } = {}) {
  const runtimeMessages = [];
  const tabMessages = [];
  const frames = [];
  let creates = 0;
  let ready = existingHost;
  const event = () => ({ addListener() {} });
  const chrome = {
    runtime: {
      onMessage: event(), onConnect: event(),
      getURL: (file) => `moz-extension://test/${file}`,
      async getContexts(filter) {
        if (firefox) throw new Error('Invalid enumeration value "OFFSCREEN_DOCUMENT"');
        assert.deepEqual(Array.from(filter.contextTypes), ['OFFSCREEN_DOCUMENT']);
        return ready ? [{}] : [];
      },
      async sendMessage(message) {
        runtimeMessages.push(message);
        if (message.action === 'ping') return ping ? ping() : { ok: ready };
      },
    },
    scripting: { async executeScript() {} },
    storage: { sync: { async get(defaults) { return defaults; } } },
    tabs: {
      onRemoved: event(),
      async sendMessage(tabId, message) { tabMessages.push({ tabId, ...message }); },
    },
  };
  function create() {
    creates++;
    if (failFirstCreate && creates === 1) throw new Error('host creation failed');
    ready = true;
  }
  const document = firefox ? {
    getElementById: (id) => frames.find(frame => frame.id === id) || null,
    createElement(tag) { assert.equal(tag, 'iframe'); return {}; },
    body: { appendChild(frame) { create(); frames.push(frame); } },
  } : undefined;
  if (!firefox) chrome.offscreen = { async createDocument() { create(); } };
  const context = vm.createContext({ chrome, document, setTimeout });
  vm.runInContext(readFileSync(path.join(ROOT, 'extension/background/service-worker.js'), 'utf8'), context);
  return { context, frames, runtimeMessages, tabMessages, creates: () => creates };
}

describe('extension rule core startup', () => {
  it('scans in Firefox without calling its unsupported offscreen APIs', async () => {
    const h = scannerHarness({ firefox: true });
    await vm.runInContext('sendScanToTab(7)', h.context);
    assert.equal(h.tabMessages.length, 1, JSON.stringify(h.runtimeMessages));
    assert.equal(h.tabMessages[0].action, 'scan');
    assert.equal(h.frames.length, 1);
    assert.equal(h.frames[0].src, 'moz-extension://test/offscreen/offscreen.html');
    assert.equal(h.frames[0].hidden, true);
  });

  for (const firefox of [false, true]) {
    const browser = firefox ? 'Firefox' : 'Chrome';
    it(`shares one core host across concurrent and repeated ${browser} scans`, async () => {
      const h = scannerHarness({ firefox });
      await vm.runInContext('Promise.all([sendScanToTab(7), sendScanToTab(8)])', h.context);
      await vm.runInContext('sendScanToTab(7)', h.context);
      assert.equal(h.creates(), 1);
      assert.deepEqual(h.tabMessages.map(m => m.tabId), [7, 8, 7]);
    });

    it(`reports ${browser} host failures and retries on the next scan`, async () => {
      const h = scannerHarness({ firefox, failFirstCreate: true });
      await vm.runInContext('sendScanToTab(7)', h.context);
      assert.equal(h.tabMessages.length, 0);
      assert.match(h.runtimeMessages.find(m => m.action === 'scan-failed')?.message || '', /host creation failed/);
      await vm.runInContext('sendScanToTab(7)', h.context);
      assert.equal(h.tabMessages.length, 1);
      assert.equal(h.creates(), 2);
    });

    it(`waits for the ${browser} core to answer before scanning`, async () => {
      let answer;
      const h = scannerHarness({ firefox, ping: () => new Promise(resolve => { answer = resolve; }) });
      const scan = vm.runInContext('sendScanToTab(7)', h.context);
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(h.tabMessages.length, 0);
      answer({ ok: true });
      await scan;
      assert.equal(h.tabMessages.length, 1);
    });

    it(`surfaces ${browser} WASM startup errors instead of reporting a clean page`, async () => {
      const h = scannerHarness({ firefox, ping: () => ({ ok: false, error: 'WASM failed to load' }) });
      await vm.runInContext('sendScanToTab(7)', h.context);
      assert.equal(h.tabMessages.length, 0);
      assert.match(h.runtimeMessages.find(m => m.action === 'scan-failed')?.message || '', /WASM failed to load/);
    });

    it(`retries while the ${browser} core message listener is not registered`, async () => {
      let pings = 0;
      const h = scannerHarness({ firefox, ping: () => {
        assert.equal(h.tabMessages.length, 0, 'scan must wait for a successful ping');
        if (++pings <= 2) throw new Error('Could not establish connection. Receiving end does not exist.');
        return { ok: true };
      } });
      await vm.runInContext('sendScanToTab(7)', h.context);
      assert.equal(pings, 3);
      assert.equal(h.creates(), 1);
      assert.deepEqual(h.tabMessages.map(m => [m.tabId, m.action]), [[7, 'scan']]);
      assert.equal(h.runtimeMessages.filter(m => m.action === 'scan-failed').length, 0);
    });

    it(`reports exhausted ${browser} startup retries and recovers on the next scan`, async () => {
      let listenerReady = false;
      let pings = 0;
      const h = scannerHarness({ firefox, ping: () => {
        pings++;
        if (!listenerReady) throw new Error('Could not establish connection. Receiving end does not exist.');
        return { ok: true };
      } });
      await vm.runInContext('sendScanToTab(7)', h.context);
      assert.equal(pings, 50);
      assert.equal(h.tabMessages.length, 0);
      const failures = h.runtimeMessages.filter(m => m.action === 'scan-failed');
      assert.equal(failures.length, 1);
      assert.equal(failures[0].tabId, 7);
      assert.match(failures[0].message, /rule core did not answer/);

      listenerReady = true;
      await vm.runInContext('sendScanToTab(7)', h.context);
      assert.equal(pings, 51, 'a failed startup must not leave a cached rejected promise');
      assert.equal(h.creates(), 1, 'reuse the existing core host');
      assert.deepEqual(h.tabMessages.map(m => [m.tabId, m.action]), [[7, 'scan']]);
      assert.equal(h.runtimeMessages.filter(m => m.action === 'scan-failed').length, 1);
      if (firefox) assert.equal(h.frames.length, 1, 'reuse the existing background iframe');
    });
  }

  it('reuses an existing Chrome offscreen document after worker restart', async () => {
    const h = scannerHarness({ existingHost: true });
    await vm.runInContext('sendScanToTab(7)', h.context);
    assert.equal(h.creates(), 0);
    assert.equal(h.tabMessages.length, 1);
  });
});

describe('extension DevTools packaging', () => {
  it('uses extension-root paths for DevTools panel pages', () => {
    const source = readFileSync(path.join(ROOT, 'extension/devtools/devtools.js'), 'utf-8');

    assert.match(
      source,
      /chrome\.devtools\.panels\.create\(\s*['"]Impeccable['"],\s*['"]\/icons\/icon-32\.png['"],\s*['"]\/devtools\/panel\.html['"]\s*\)/s,
      'Firefox resolves DevTools URLs relative to devtools.html unless they start at the extension root',
    );
    assert.match(source, /sidebar\.setPage\(['"]\/devtools\/sidebar\.html['"]\)/);
    assert.doesNotMatch(source, /['"]devtools\/(?:panel|sidebar)\.html['"]/);
    assert.doesNotMatch(source, /['"]icons\/icon-32\.png['"]/);
  });
});

describe('extension badge colors', () => {
  // Optional-call syntax on a method a browser does not implement returns
  // undefined, and .catch on undefined throws: updateBadge would abort before
  // it set the badge at all. Firefox's action API has no setBadgeTextColor,
  // so the call has to be guarded by an existence check, not by `?.`.
  it('guards setBadgeTextColor instead of chaining .catch onto an optional call', () => {
    const source = readFileSync(path.join(ROOT, 'extension/background/service-worker.js'), 'utf-8');

    assert.doesNotMatch(
      source,
      /setBadgeTextColor\?\.\([^)]*\)\s*\.catch/s,
      'setBadgeTextColor?.(...).catch(...) throws wherever the method is missing',
    );
    assert.match(
      source,
      /typeof chrome\.action\.setBadgeTextColor === 'function'/,
      'the call needs an existence check around it',
    );
    assert.match(
      source,
      /typeof pending\.catch === 'function'/,
      'the return value needs a promise check before .catch',
    );
  });

  it('paints the badge in kinpaku gold with ink text', () => {
    const source = readFileSync(path.join(ROOT, 'extension/background/service-worker.js'), 'utf-8');

    assert.match(source, /setBadgeBackgroundColor\(\{ color: '#ffba00'/);
    assert.match(source, /setBadgeTextColor\(\{ color: '#0b0903'/);
    assert.doesNotMatch(source, /#d6336c/, 'the magenta badge is retired');
  });
});
