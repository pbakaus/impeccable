import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Run the real worker with browser API boundaries replaced. Firefox exposes
// getContexts, but rejects OFFSCREEN_DOCUMENT before the scan can start.
function scannerHarness({ firefox = false, existingHost = false, failFirstCreate = false, failScanDelivery = false, deliverScan, recoverScan, cancelTab, inject, ping } = {}) {
  const runtimeMessages = [];
  const tabMessages = [];
  const frames = [];
  let creates = 0;
  let ready = existingHost;
  const listeners = {};
  const event = name => ({ addListener(callback) { listeners[name] = callback; } });
  const chrome = {
    runtime: {
      onMessage: event('message'), onConnect: event('connect'),
      getURL: (file) => `moz-extension://test/${file}`,
      async getContexts(filter) {
        if (firefox) throw new Error('Invalid enumeration value "OFFSCREEN_DOCUMENT"');
        assert.deepEqual(Array.from(filter.contextTypes), ['OFFSCREEN_DOCUMENT']);
        return ready ? [{}] : [];
      },
      async sendMessage(message) {
        runtimeMessages.push(message);
        if (message.action === 'ping') return ping ? ping() : { ok: ready };
        if (message.action === 'scan-cancel-tab' && cancelTab) return cancelTab();
      },
    },
    action: { async setBadgeText() {}, async setBadgeBackgroundColor() {} },
    webNavigation: { onCompleted: event('navigation') },
    scripting: { async executeScript() { if (inject) await inject(); } },
    storage: { sync: { async get(defaults) { return defaults; } } },
    tabs: {
      onRemoved: event('removed'),
      async sendMessage(tabId, message) {
        tabMessages.push({ tabId, ...message });
        if (failScanDelivery && message.action === 'scan') throw new Error('Receiving end does not exist');
        if (deliverScan && message.action === 'scan') return deliverScan(message);
        if (message.action === 'get-scan-id') return { scanId: recoverScan ? await recoverScan() : null };
      },
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
  const context = vm.createContext({ chrome, document, setTimeout, crypto: webcrypto });
  vm.runInContext(readFileSync(path.join(ROOT, 'extension/background/service-worker.js'), 'utf8'), context);
  return { context, frames, runtimeMessages, tabMessages, listeners, creates: () => creates };
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


describe('extension popup scan state', () => {
  const url = 'https://example.test/scanned#card';
  function report(h, findings = [], scanComplete = true) {
    const scanId = vm.runInContext("getState(7).scanId ||= 'test-scan'", h.context);
    h.listeners.message({ action: 'findings', findings, scanComplete, scanId }, { url, tab: { id: 7 } }, () => {});
  }
  function state(h) {
    let result;
    h.listeners.message({ action: 'get-state', tabId: 7 }, {}, value => { result = value; });
    return result;
  }

  it('keeps partial scan reports incomplete until the final result', () => {
    const h = scannerHarness();
    report(h, [], false);
    assert.equal(state(h).scanComplete, false);
    assert.equal(h.runtimeMessages.at(-1).scanComplete, false);
    report(h);
    assert.equal(state(h).scanComplete, true);
    assert.equal(h.runtimeMessages.at(-1).scanComplete, true);
  });

  it('marks an empty scan complete and includes the source URL in popup broadcasts', () => {
    const h = scannerHarness();
    assert.equal(state(h).scanComplete, false);
    report(h);
    assert.equal(state(h).scanComplete, true);
    assert.equal(state(h).url, url);
    const message = h.runtimeMessages.find(message => message.action === 'findings-updated');
    assert.equal(message.url, url);
    assert.equal(message.tabId, 7);
    assert.equal(message.findings.length, 0);
  });

  it('invalidates cached copy data while scanning and after failure', async () => {
    const h = scannerHarness();
    report(h, [{ findings: [{ name: 'Old finding' }] }]);
    await vm.runInContext('sendScanToTab(7)', h.context);
    assert.equal(state(h).findings.length, 0);
    assert.equal(state(h).scanning, true);
    assert.equal(state(h).scanComplete, false);
    assert.ok(h.runtimeMessages.some(message => message.action === 'scan-started' && message.tabId === 7));
    report(h, [{ findings: [{ name: 'Old finding' }] }]);
    h.listeners.message({ action: 'detector-error', scanId: state(h).scanId, message: 'Snapshot failed' }, { tab: { id: 7 } }, () => {});
    assert.equal(state(h).scanComplete, false);
    assert.equal(state(h).findings.length, 0);
    assert.equal(state(h).scanning, false);
    assert.equal(state(h).scanError, 'Snapshot failed');
  });

  it('reports scan delivery failure and clears pending state for a reopened popup', async () => {
    const h = scannerHarness({ failScanDelivery: true });
    await vm.runInContext('sendScanToTab(7)', h.context);
    assert.equal(state(h).scanning, false);
    assert.equal(state(h).scanComplete, false);
    assert.match(state(h).scanError, /Receiving end does not exist/);
    assert.ok(h.runtimeMessages.some(message => message.action === 'scan-failed' && message.tabId === 7));
  });

  it('clears source URL and scan state on top-level navigation and notifies the popup', () => {
    const h = scannerHarness();
    report(h);
    h.listeners.navigation({ tabId: 7, frameId: 2 });
    assert.equal(state(h).scanComplete, true);
    h.listeners.navigation({ tabId: 7, frameId: 0 });
    assert.equal(state(h).scanComplete, false);
    assert.equal(state(h).url, '');
    assert.ok(h.runtimeMessages.some(message => message.action === 'navigated' && message.tabId === 7));
  });
});

// Exercise the real content script across the offscreen protocol, including a
// delayed image read. No generated detector code is replaced in production.
function contentScanHarness({ visual = true, fail = false } = {}) {
  const messages = [];
  let listener;
  let releaseImage;
  const image = new Promise(resolve => { releaseImage = resolve; });
  let step = 0;
  const initial = [{ selector: '#text', findings: [] }];
  const final = [{ selector: '#text', findings: [{ type: 'low-contrast' }] }];
  const overlay = { remove() {}, clearOverlays() {}, highlight() {}, setFirstScanDone() {}, showPageBanner() {} };
  const context = vm.createContext({
    window: {
      __impeccableSnapshot: {
        capture: () => ({ json: '{}', elements: {}, stats: { elements: 1, bytes: 2, ms: 0 } }),
        visualIO: () => ({ loadImage: () => image }),
      },
      __impeccableCreateOverlay: () => overlay,
      addEventListener() {},
    },
    document: { body: {}, documentElement: {}, addEventListener() {} },
    location: { href: 'https://example.test/' }, performance,
    setTimeout() {},
    chrome: { runtime: {
      onMessage: { addListener(fn) { listener = fn; } },
      async sendMessage(msg) {
        messages.push(msg);
        if (msg.action === 'antipatterns') return { antipatterns: [] };
        if (msg.action === 'scan-start') return { stage: 'findings', groups: [], serialized: initial };
        if (msg.action === 'scan-continue') {
          if (!visual) return { done: true };
          if (++step === 1) return { ask: { io: { kind: 'loadImage', src: '/slow.png' } } };
          if (fail) return { error: 'Image read failed' };
          if (step === 2) return { stage: 'visual', groups: [], added: [], serialized: final };
          return { done: true };
        }
      },
    } },
  });
  vm.runInContext(readFileSync(path.join(ROOT, 'extension/content/content-script.js'), 'utf8'), context);
  listener({ action: 'scan' }, {}, () => {});
  return { messages, releaseImage, listener };
}
const nextTurn = () => new Promise(resolve => setImmediate(resolve));

describe('content script scan completion', () => {
  it('keeps delayed image findings partial and publishes a complete final report', async () => {
    const h = contentScanHarness();
    await nextTurn();
    let reports = h.messages.filter(m => m.action === 'findings');
    assert.equal(reports.length, 1);
    assert.equal(reports[0].scanComplete, false);
    h.releaseImage({});
    await nextTurn();
    reports = h.messages.filter(m => m.action === 'findings');
    assert.deepEqual(reports.map(m => m.scanComplete), [false, false, true]);
    assert.equal(reports.at(-1).findings[0].findings[0].type, 'low-contrast');
  });

  it('completes when the core skips visual checks', async () => {
    const h = contentScanHarness({ visual: false });
    await nextTurn();
    assert.deepEqual(h.messages.filter(m => m.action === 'findings').map(m => m.scanComplete), [false, true]);
  });

  it('never marks a failed visual pass complete', async () => {
    const h = contentScanHarness({ fail: true });
    await nextTurn();
    h.releaseImage({});
    await nextTurn();
    assert.equal(h.messages.some(m => m.scanComplete), false);
    assert.equal(h.messages.find(m => m.action === 'detector-error').message, 'Image read failed');
  });

  it('does not complete a scan after the content script is removed', async () => {
    const h = contentScanHarness();
    await nextTurn();
    h.listener({ action: 'remove' }, {}, () => {});
    h.releaseImage({});
    await nextTurn();
    assert.equal(h.messages.filter(m => m.action === 'findings' && m.scanComplete).length, 0);
  });
});


describe('replacement scan isolation', () => {
  function state(h) { return vm.runInContext('getState(7)', h.context); }
  function deliver(h, scanId, action = 'findings') {
    h.listeners.message({ action, scanId, scanComplete: true, findings: [{ selector: scanId, findings: [] }], message: 'Old scan failed' }, { url: 'https://example.test/', tab: { id: 7 } }, () => {});
  }

  it('ignores old and untagged reports and errors after a restart', async () => {
    const h = scannerHarness();
    await vm.runInContext('sendScanToTab(7)', h.context);
    const first = h.tabMessages.at(-1).scanId;
    await vm.runInContext('sendScanToTab(7)', h.context);
    const second = h.tabMessages.at(-1).scanId;
    assert.ok(first);
    assert.notEqual(first, second);
    deliver(h, first);
    deliver(h, undefined);
    assert.equal(state(h).scanComplete, false);
    deliver(h, second);
    for (const id of [first, undefined]) {
      deliver(h, id);
      deliver(h, id, 'detector-error');
    }
    assert.equal(state(h).scanComplete, true);
    assert.equal(state(h).findings[0].selector, second);
    assert.equal(state(h).scanError, null);
  });

  it('ignores a late scan-message rejection after the replacement completes', async () => {
    let rejectFirst;
    let calls = 0;
    const h = scannerHarness({ deliverScan: () => ++calls === 1 ? new Promise((_, reject) => { rejectFirst = reject; }) : undefined });
    const first = vm.runInContext('sendScanToTab(7)', h.context);
    await nextTurn();
    await vm.runInContext('sendScanToTab(7)', h.context);
    const id = h.tabMessages.at(-1).scanId;
    deliver(h, id);
    rejectFirst(new Error('Old channel closed'));
    await first;
    assert.equal(state(h).scanComplete, true);
    assert.equal(state(h).scanError, null);
    assert.equal(state(h).findings[0].selector, id);
  });

  it('does not dispatch an old scan whose injection completes after its replacement', async () => {
    let releaseFirst;
    let calls = 0;
    const h = scannerHarness({ inject: () => ++calls === 1 ? new Promise(resolve => { releaseFirst = resolve; }) : undefined });
    const first = vm.runInContext('sendScanToTab(7)', h.context);
    await nextTurn();
    await vm.runInContext('sendScanToTab(7)', h.context);
    const id = h.tabMessages.at(-1).scanId;
    deliver(h, id);
    releaseFirst();
    await first;
    assert.equal(h.tabMessages.filter(m => m.action === 'scan').length, 1);
    assert.equal(state(h).scanComplete, true);
    assert.equal(state(h).scanId, id);
  });

  it('recovers a surviving page scan after a worker restart', async () => {
    const h = scannerHarness({ recoverScan: () => 'surviving' });
    deliver(h, 'surviving');
    await nextTurn();
    assert.equal(state(h).scanComplete, true);
    assert.equal(state(h).findings[0].selector, 'surviving');
    assert.equal(state(h).scanId, 'surviving');
  });

  it('does not recover an old document or override a newly started scan', async () => {
    const oldPage = scannerHarness({ recoverScan: () => 'current-document' });
    deliver(oldPage, 'old-document');
    await nextTurn();
    assert.equal(state(oldPage).scanComplete, false);
    let release;
    const h = scannerHarness({ recoverScan: () => new Promise(resolve => { release = resolve; }) });
    deliver(h, 'old');
    await nextTurn();
    await vm.runInContext('sendScanToTab(7)', h.context);
    const id = h.tabMessages.at(-1).scanId;
    release('old');
    await nextTurn();
    assert.equal(state(h).scanId, id);
    assert.equal(state(h).scanComplete, false);
    deliver(h, id);
    assert.equal(state(h).scanComplete, true);
  });

  it('coalesces worker recovery so partial and final reports keep their order', async () => {
    let release;
    let queries = 0;
    const h = scannerHarness({ recoverScan: () => { queries++; return new Promise(resolve => { release = resolve; }); } });
    h.listeners.message({ action: 'findings', scanId: 'surviving', scanComplete: false, findings: [] }, { tab: { id: 7 } }, () => {});
    deliver(h, 'surviving');
    await nextTurn();
    assert.equal(queries, 1);
    release('surviving');
    await nextTurn();
    assert.equal(state(h).scanComplete, true);
    assert.equal(state(h).findings[0].selector, 'surviving');
  });

  it('recovers current errors but never recovers across navigation', async () => {
    const failed = scannerHarness({ recoverScan: () => 'surviving' });
    deliver(failed, 'surviving', 'detector-error');
    await nextTurn();
    assert.equal(state(failed).scanError, 'Old scan failed');
    let release;
    const h = scannerHarness({ recoverScan: () => new Promise(resolve => { release = resolve; }) });
    deliver(h, 'old');
    await nextTurn();
    h.listeners.navigation({ tabId: 7, frameId: 0 });
    release('old');
    await nextTurn();
    assert.equal(state(h).scanId, null);
    assert.equal(state(h).findings.length, 0);
  });

  it('cancels destroyed tab sessions even before this worker has state', () => {
    const h = scannerHarness();
    h.listeners.navigation({ tabId: 7, frameId: 0 });
    h.listeners.removed(8);
    assert.deepEqual(h.runtimeMessages.filter(m => m.action === 'scan-cancel-tab').map(m => m.tabId), [7, 8]);
  });

  it('does not let an old teardown remove a new scan', async () => {
    let release;
    let calls = 0;
    const h = scannerHarness({ cancelTab: () => ++calls === 2 ? new Promise(resolve => { release = resolve; }) : undefined });
    await vm.runInContext('sendScanToTab(7)', h.context);
    const teardown = vm.runInContext('tearDownTab(7)', h.context);
    await nextTurn();
    await vm.runInContext('sendScanToTab(7)', h.context);
    const id = h.tabMessages.at(-1).scanId;
    deliver(h, id);
    release();
    await teardown;
    assert.equal(h.tabMessages.some(m => m.action === 'remove'), false);
    assert.equal(state(h).scanId, id);
    assert.equal(state(h).scanComplete, true);
  });

  it('does not accept reports after navigation invalidates their scan', async () => {
    const h = scannerHarness();
    await vm.runInContext('sendScanToTab(7)', h.context);
    const id = h.tabMessages.at(-1).scanId;
    h.listeners.navigation({ tabId: 7, frameId: 0 });
    deliver(h, id);
    assert.equal(state(h).scanComplete, false);
    assert.equal(state(h).findings.length, 0);
  });
});

function restartHarness({ rejectImage = false, replacementWaits = false } = {}) {
  const messages = [];
  let listener;
  let finishImage;
  const oldImage = new Promise((resolve, reject) => { finishImage = () => rejectImage ? reject(new Error('old image failed')) : resolve({}); });
  let starts = 0;
  let stage = 0;
  const overlay = { clearOverlays() {}, highlight() {}, setFirstScanDone() {}, showPageBanner() {} };
  const context = vm.createContext({
    window: {
      __impeccableSnapshot: {
        capture: () => ({ json: '{}', elements: {}, stats: { elements: 1, bytes: 2, ms: 0 } }),
        visualIO: () => ({ loadImage: src => src === 'old' ? oldImage : new Promise(() => {}) }),
      },
      __impeccableCreateOverlay: () => overlay, addEventListener() {},
    },
    document: { body: {}, documentElement: {}, addEventListener() {} },
    location: { href: 'https://example.test/' }, performance, setTimeout() {},
    chrome: { runtime: {
      onMessage: { addListener(fn) { listener = fn; } },
      async sendMessage(msg) {
        messages.push(msg);
        if (msg.action === 'antipatterns') return { antipatterns: [] };
        if (msg.action === 'scan-start') {
          starts++; stage = 0;
          return { stage: 'findings', groups: [], serialized: [{ selector: `scan-${starts}`, findings: [] }] };
        }
        if (msg.action === 'scan-continue') {
          if (++stage === 1 && (starts === 1 || replacementWaits)) return { ask: { io: { kind: 'loadImage', src: starts === 1 ? 'old' : 'new' } } };
          if (stage > 2) return { error: 'no such session' };
          return { done: true };
        }
      },
    } },
  });
  vm.runInContext(readFileSync(path.join(ROOT, 'extension/content/content-script.js'), 'utf8'), context);
  return { messages, finishImage, scan: id => listener({ action: 'scan', scanId: id }, {}, () => {}) };
}

for (const options of [{}, { rejectImage: true }, { replacementWaits: true }]) {
  it(`stops the old image continuation after restart: ${JSON.stringify(options)}`, async () => {
    const h = restartHarness(options);
    h.scan('old');
    await nextTurn();
    h.scan('new');
    await nextTurn();
    const starts = h.messages.filter(m => m.action === 'scan-start');
    assert.notEqual(starts[0].session, starts[1].session);
    const count = h.messages.filter(m => m.action === 'scan-continue').length;
    h.finishImage();
    await nextTurn();
    assert.equal(h.messages.filter(m => m.action === 'scan-continue').length, count);
    assert.equal(h.messages.some(m => m.action === 'detector-error'), false);
    const complete = h.messages.filter(m => m.action === 'findings' && m.scanComplete);
    assert.equal(complete.length, options.replacementWaits ? 0 : 1);
    if (complete.length) assert.equal(complete[0].scanId, 'new');
  });
}


for (const byTab of [false, true]) it(`canceling a parked lazy session releases the real offscreen queue (byTab=${byTab})`, async () => {
  let listener;
  const wasm = {
    snapshot_load: () => 1, snapshot_has_needs: () => false,
    collect_browser_findings: () => JSON.stringify({ groups: [], pageLevel: [] }),
    snapshot_unknown_style_props: () => '[]', serialize_findings: () => '[]', snapshot_clear() {},
    visual_contrast_result_el: () => 0,
  };
  const context = vm.createContext({
    performance,
    __impeccableLoadCore: async () => wasm,
    __visualContrastMode: () => false,
    createVisualContrast: io => ({ analyzeVisualContrastCandidate: async () => io.loadImage('/slow.png') }),
    chrome: { runtime: { onMessage: { addListener(fn) { listener = fn; } } } },
  });
  vm.runInContext(readFileSync(path.join(ROOT, 'browser-bundle/60-offscreen.js'), 'utf8'), context);
  const send = msg => new Promise(resolve => {
    const pending = listener({ target: 'impeccable-offscreen', ...msg }, { tab: { id: msg.session === 'tab-two' ? 2 : 1 } }, resolve);
    if (!pending) resolve(undefined);
  });
  const lazy = await send({ action: 'analyze-candidate', session: 'tab-one-lazy', snapshot: '{}' });
  assert.equal(lazy.ask.io.kind, 'loadImage');
  const queued = byTab ? send({ action: 'analyze-candidate', session: 'tab-one-queued', snapshot: '{}' }) : null;
  let next;
  const other = send({ action: 'scan-start', session: 'tab-two', snapshot: '{}' }).then(value => { next = value; });
  await nextTurn();
  assert.equal(next, undefined);
  const cancelled = await send(byTab ? { action: 'scan-cancel-tab', tabId: 1 } : { action: 'scan-cancel', session: 'tab-one-lazy' });
  assert.equal(cancelled?.ok, true);
  if (queued) assert.equal((await queued).superseded, true);
  const late = await send({ action: 'scan-continue', session: 'tab-one-lazy', answer: {} });
  assert.equal(late.error, 'no such session');
  await nextTurn();
  assert.equal(next?.stage, 'findings');
  await other;
  const done = await send({ action: 'scan-continue', session: 'tab-two', answer: {} });
  assert.equal(done.done, true);
});

function lazyCandidatesHarness() {
  const messages = [];
  const elements = [{ name: 'a' }, { name: 'b' }];
  const sessions = new Map();
  const observers = [];
  const events = {};
  const location = { href: 'https://example.test/' };
  let listener;
  let generation = 0;
  let captureNumber = 0;
  let releaseImage;
  const blocked = new Promise(resolve => { releaseImage = resolve; });
  const overlay = { remove() {}, clearOverlays() {}, highlight() {}, setFirstScanDone() {}, showPageBanner() {} };
  const context = vm.createContext({
    performance, location,
    requestAnimationFrame: fn => setImmediate(fn),
    setTimeout() {},
    IntersectionObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe() {} unobserve() {} disconnect() {}
    },
    document: { body: {}, documentElement: {}, addEventListener() {}, querySelector: selector => elements[selector === '#a' ? 0 : 1] },
    window: {
      addEventListener: (name, fn) => { events[name] = fn; },
      __impeccableCreateOverlay: () => overlay,
      __impeccableSnapshot: {
        capture() {
          const sequence = ++captureNumber;
          return { json: JSON.stringify({ sequence }), sequence, elements: { 1: elements[0], 2: elements[1] }, stats: { elements: 2, bytes: 2, ms: 0 } };
        },
        idOf: el => elements.indexOf(el) + 1,
        answer: (_ask, cap) => ({ sequence: cap.sequence }),
        visualIO: cap => ({ loadImage: () => generation === 1 ? blocked : Promise.resolve({ sequence: cap.sequence }) }),
      },
    },
    chrome: { runtime: {
      onMessage: { addListener(fn) { listener = fn; } },
      async sendMessage(msg) {
        messages.push(msg);
        if (msg.action === 'antipatterns') return { antipatterns: [] };
        if (msg.action === 'scan-start') {
          generation++;
          sessions.set(msg.session, { stage: 0 });
          return { stage: 'findings', groups: [], serialized: [] };
        }
        if (msg.action === 'analyze-candidate') {
          sessions.set(msg.session, { candidate: msg, stage: 0 });
          return { ask: { hitTests: [[0, 0]] } };
        }
        if (msg.action === 'scan-continue') {
          const session = sessions.get(msg.session);
          if (!session.candidate) {
            if (++session.stage === 1) return { stage: 'visual', groups: [], added: [], serialized: [], lazy: [{ selector: '#a' }, { selector: '#b' }] };
            return { done: true };
          }
          if (++session.stage === 1) {
            assert.equal(msg.answer.sequence, JSON.parse(session.candidate.snapshot).sequence, 'candidate answers must use its own capture');
            return { ask: { io: { kind: 'loadImage', src: '/candidate.png' } } };
          }
          const el = session.candidate.candidate.selector === '#a' ? 1 : 2;
          const groups = [...session.candidate.groups, { el, findings: [{ type: 'low-contrast' }] }];
          return { el, groups, serialized: groups.map(group => ({ selector: group.el === 1 ? '#a' : '#b', findings: group.findings })) };
        }
        return { ok: true };
      },
    } },
  });
  vm.runInContext(readFileSync(path.join(ROOT, 'extension/content/content-script.js'), 'utf8'), context);
  return {
    messages, releaseImage,
    scan: id => listener({ action: 'scan', scanId: id }, {}, () => {}),
    remove: () => listener({ action: 'remove' }, {}, () => {}),
    navigate() { location.href += '#next'; events.hashchange(); },
    visible: () => observers.at(-1).callback(elements.map(target => ({ target, isIntersecting: true }))),
  };
}
const settleLazy = async () => { for (let i = 0; i < 8; i++) await nextTurn(); };

it('serializes visible lazy candidates and preserves both findings', async () => {
  const h = lazyCandidatesHarness();
  h.scan('first');
  await settleLazy();
  h.visible();
  await settleLazy();
  assert.equal(h.messages.filter(m => m.action === 'analyze-candidate').length, 1, 'the second candidate must wait for the first IO');
  const prepare = h.messages.findIndex(m => m.action === 'prepare-rule-core');
  assert(prepare >= 0 && prepare < h.messages.findIndex(m => m.action === 'analyze-candidate'), 'restore the host before a deferred request');
  h.releaseImage({});
  await settleLazy();
  assert.deepEqual(h.messages.filter(m => m.action === 'findings').at(-1).findings.map(f => f.selector), ['#a', '#b']);
  assert.equal(h.messages.some(m => m.action === 'detector-error'), false);
});

for (const invalidation of ['restart', 'remove', 'navigate']) it(`a blocked old lazy queue cannot block the next scan after ${invalidation}`, async () => {
  const h = lazyCandidatesHarness();
  h.scan('first');
  await settleLazy();
  h.visible();
  await settleLazy();
  if (invalidation !== 'restart') h[invalidation]();
  h.scan('second');
  await settleLazy();
  h.visible();
  await settleLazy();
  const reports = h.messages.filter(m => m.action === 'findings' && m.scanId === 'second');
  assert.deepEqual(reports.at(-1).findings.map(f => f.selector), ['#a', '#b']);
  const before = h.messages.length;
  h.releaseImage({});
  await settleLazy();
  assert.equal(h.messages.length, before, 'a stale queued candidate must not start after old IO resolves');
});

it('tears down surviving content after worker state was lost', async () => {
  const h = scannerHarness();
  await vm.runInContext('tearDownTab(7)', h.context);
  assert.equal(h.tabMessages.some(message => message.action === 'remove'), true);
  assert.equal(vm.runInContext('getState(7).scanId', h.context), null);
});


describe('deferred rule-core preparation after background restart', () => {
  for (const firefox of [false, true]) it(`restores the current deferred scan host (Firefox=${firefox})`, async () => {
    const h = scannerHarness({ firefox, existingHost: !firefox, recoverScan: () => 'surviving' });
    const result = await vm.runInContext("prepareRuleCore(7, 'surviving')", h.context);
    assert.equal(result.ok, true);
    assert.equal(h.creates(), firefox ? 1 : 0);
    assert.equal(h.tabMessages.filter(m => m.action === 'scan').length, 0, 'do not replace the surviving scan');
  });

  it('reports deferred host failure through the message handler and retries', async () => {
    const h = scannerHarness({ firefox: true, failFirstCreate: true, recoverScan: () => 'surviving' });
    const prepare = () => new Promise(resolve => h.listeners.message(
      { action: 'prepare-rule-core', scanId: 'surviving' }, { tab: { id: 7 } }, resolve,
    ));
    assert.match((await prepare()).error, /host creation failed/);
    assert.equal((await prepare()).ok, true);
    assert.equal(h.creates(), 2);
  });

  it('does not start a host for a stale document', async () => {
    const h = scannerHarness({ firefox: true, recoverScan: () => 'current' });
    const result = await vm.runInContext("prepareRuleCore(7, 'old')", h.context);
    assert.equal(result.superseded, true);
    assert.equal(h.creates(), 0);
  });

  it('invalidates deferred preparation when navigation happens during host startup', async () => {
    let release;
    const h = scannerHarness({ firefox: true, recoverScan: () => 'surviving', ping: () => new Promise(resolve => { release = resolve; }) });
    const ready = vm.runInContext("prepareRuleCore(7, 'surviving')", h.context);
    await nextTurn();
    h.listeners.navigation({ tabId: 7, frameId: 0 });
    release({ ok: true });
    assert.equal((await ready).superseded, true);
  });
});
