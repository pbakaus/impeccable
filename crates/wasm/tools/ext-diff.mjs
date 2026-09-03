#!/usr/bin/env node
// Differential of two Chrome extensions: an older JS extension
// (rules in JS, MAIN-world detector) and this repo's `extension/`
// (rules in WASM in the offscreen document over a page snapshot). Loads
// each into headless Chrome (`--load-extension`), drives the service worker
// exactly as the popup would (`sendScanToTab`), and diffs the serialized
// findings the content script reported. Verification tooling only.
//
//   node crates/wasm/tools/ext-diff.mjs --a <js extension dir> [--b extension]
//        [--public <other checkout>] [--only fixture.html,...]
//        [--url https://github.com] [--csp]  [--messages] [--verbose]
//
//   --csp       also serve every fixture with `Content-Security-Policy: script-src 'self'`
//   --messages  drive the popup and DevTools-panel message flows against B and check the answers
//
// Exit 0 when every page is identical, 1 otherwise. Prints per-page timing
// and, for B, snapshot size / rounds as the content script measured them.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const has = (n) => args.includes(n);
const here = path.dirname(fileURLToPath(import.meta.url));
const engineRoot = path.resolve(here, '../../..');
// The fixtures and puppeteer live in this repo; --public points at another
// checkout (an older one, for A/B against the pre-Rust engine).
const publicRepo = path.resolve(flag('--public') || process.env.IMPECCABLE_PUBLIC_REPO || engineRoot);
const require = createRequire(path.join(publicRepo, 'package.json'));
const puppeteer = require('puppeteer');

const extA = flag('--a') ? path.resolve(flag('--a')) : null;
const extB = path.resolve(flag('--b') || path.join(engineRoot, 'extension'));
const only = flag('--only') ? flag('--only').split(',') : null;
const verbose = has('--verbose');
const withCsp = has('--csp');
const extraUrls = args.flatMap((a, i) => (a === '--url' ? [args[i + 1]] : []));

const dir = path.join(publicRepo, 'tests/fixtures/antipatterns');
const server = http.createServer((req, res) => {
  const [p, q] = req.url.split('?');
  const f = path.join(dir, decodeURIComponent(p));
  try {
    const body = fs.readFileSync(f);
    res.setHeader('Content-Type', f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'application/javascript' : f.endsWith('.svg') ? 'image/svg+xml' : f.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8');
    if (q === 'csp') res.setHeader('Content-Security-Policy', "script-src 'self'; style-src 'self' 'unsafe-inline'; img-src * data:");
    res.end(body);
  } catch { res.statusCode = 404; res.end(); }
}).listen(0);
const port = server.address().port;

let names = fs.readdirSync(dir).filter((n) => n.endsWith('.html')).sort();
if (only) names = names.filter((n) => only.includes(n));
const targets = names.map((n) => `http://127.0.0.1:${port}/${n}`);
if (withCsp) for (const n of names) targets.push(`http://127.0.0.1:${port}/${n}?csp`);
targets.push(...extraUrls);

async function launch(extDir) {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, '--no-first-run'],
  });
  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker', { timeout: 20000 });
  const worker = await swTarget.worker();
  return { browser, worker };
}

// Drive one scan of `url` through the extension's service worker, exactly
// as the popup does, and return what the content script reported.
async function scanWith({ browser, worker }, url, opts = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' || /impeccable/.test(m.text())) errs.push(`[console] ${m.text().slice(0, 200)}`); });
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 90000 });
  await page.bringToFront();
  const t0 = Date.now();
  const out = await worker.evaluate(async (targetUrl, settleMs) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((t) => t.url === targetUrl) || tabs.find((t) => (t.url || '').startsWith(targetUrl.split('#')[0]));
    if (!tab) return { error: 'tab not found', tabs: tabs.map((t) => t.url) };
    const tabId = tab.id;
    let failed = null;
    const onMsg = (m) => { if (m.action === 'scan-failed' && m.tabId === tabId) failed = m.message; };
    chrome.runtime.onMessage.addListener(onMsg);
    tabState.delete(tabId);
    const t0 = Date.now();
    await sendScanToTab(tabId);
    // Wait for the first findings post, then for the reports to settle
    // (the visual pass posts a second time).
    let firstAt = null;
    let last = null;
    let lastChange = Date.now();
    while (Date.now() - t0 < 60000) {
      const st = tabState.get(tabId);
      if (failed) break;
      if (st && st.injected) {
        if (firstAt === null) firstAt = Date.now();
        const cur = JSON.stringify(st.findings);
        if (cur !== last) { last = cur; lastChange = Date.now(); }
        if (Date.now() - lastChange > settleMs) break;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    chrome.runtime.onMessage.removeListener(onMsg);
    const st = tabState.get(tabId);
    return { findings: st ? st.findings : null, injected: !!(st && st.injected), failed, firstMs: firstAt ? firstAt - t0 : null, totalMs: lastChange - t0, stats: st ? st.stats || null : null };
  }, url, opts.settleMs || 1200);
  const wall = Date.now() - t0;
  await page.close();
  return { ...out, wall, errs };
}

const flat = (r) => (r || []).flatMap((g) => g.findings.map((f) => `${g.selector} :: ${f.type} :: ${f.detail}${f.severity !== undefined ? ' [' + f.severity + ']' : ''}`));
const stripRects = (r) => (r || []).map((g) => { const { rect, ...rest } = g; return rest; });

let failures = 0;
const A = extA ? await launch(extA) : null;
const B = await launch(extB);
const timing = [];
for (const url of targets) {
  const label = url.startsWith('http://127.0.0.1') ? path.basename(url) : url;
  let a = null, b = null;
  try {
    b = await scanWith(B, url);
    if (A) a = await scanWith(A, url);
  } catch (e) {
    console.log(`ERROR ${label}: ${e.message}`);
    failures++;
    continue;
  }
  const bs = b.stats;
  const bStat = bs ? `  [snapshot ${(bs.bytes / 1024).toFixed(0)} KB, ${bs.elements} els, capture ${bs.captureMs.toFixed(0)}ms, core ${bs.coreMs == null ? '?' : bs.coreMs.toFixed(0)}ms, ${bs.rounds} round${bs.rounds === 1 ? '' : 's'}/${bs.hitTests} hit tests, ${bs.ioAsks} io asks, findings at ${bs.findingsAtMs == null ? '?' : bs.findingsAtMs.toFixed(0)}ms, visual at ${bs.visualAtMs == null ? '-' : bs.visualAtMs.toFixed(0)}ms${bs.unknownStyleProps?.length ? ', UNKNOWN STYLE PROPS ' + bs.unknownStyleProps.join(',') : ''}]` : '';
  if (!A) {
    const ok = !b.failed && b.injected;
    if (!ok) failures++;
    console.log(`${ok ? 'OK       ' : 'FAILED   '} ${label}  ${b.failed ? 'scan-failed: ' + b.failed : `${flat(b.findings).length} findings in ${b.wall}ms`}${bStat}${b.errs.length ? '  errs: ' + b.errs.join(' | ') : ''}`);
    continue;
  }
  const same = JSON.stringify(a.findings) === JSON.stringify(b.findings);
  const sameNoRect = JSON.stringify(stripRects(a.findings)) === JSON.stringify(stripRects(b.findings));
  const status = same ? 'IDENTICAL' : sameNoRect ? 'RECT-DIFF' : 'DIFF     ';
  if (!sameNoRect) failures++;
  timing.push({ label, aMs: a.wall, bMs: b.wall });
  console.log(`${status} ${label}  js ${a.wall}ms (${flat(a.findings).length} findings${a.failed ? ', FAILED: ' + a.failed : ''})  wasm ${b.wall}ms (${flat(b.findings).length} findings${b.failed ? ', FAILED: ' + b.failed : ''})${bStat}${b.errs.length ? '  wasm errs: ' + b.errs.join(' | ') : ''}`);
  if (!same) {
    const fa = flat(a.findings), fb = flat(b.findings);
    const onlyA = fa.filter((x) => !fb.includes(x));
    const onlyB = fb.filter((x) => !fa.includes(x));
    for (const x of onlyA.slice(0, verbose ? 200 : 8)) console.log('   - js only:  ', x);
    for (const x of onlyB.slice(0, verbose ? 200 : 8)) console.log('   + wasm only:', x);
    if (onlyA.length === 0 && onlyB.length === 0) {
      const pa = a.findings || [], pb = b.findings || [];
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        if (JSON.stringify(pa[i]) !== JSON.stringify(pb[i])) {
          console.log('   group', i, '\n    js:  ', JSON.stringify(pa[i]).slice(0, 400), '\n    wasm:', JSON.stringify(pb[i]).slice(0, 400));
          if (!verbose) break;
        }
      }
    }
  }
}

if (has('--messages')) {
  // Popup flow: an extension page sends { action: 'scan', tabId } and expects
  // findings-updated; DevTools panel flow: connect a panel port and expect
  // state + findings; toggle-overlays round trip.
  const url = `http://127.0.0.1:${port}/should-flag.html`;
  const page = await B.browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle0' });
  const extId = new URL(B.worker.url()).host;
  const ext = await B.browser.newPage();
  await ext.goto(`chrome-extension://${extId}/popup/popup.html`);
  const result = await ext.evaluate(async (targetUrl) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((t) => t.url === targetUrl);
    const out = { tabId: tab?.id };
    const got = { updated: null, panelState: null, panelFindings: null, toggled: null, sidebar: null };
    const done = new Promise((resolve) => {
      chrome.runtime.onMessage.addListener((m) => {
        if (m.action === 'findings-updated' && m.tabId === tab.id) got.updated = m.findings.length;
        if (m.action === 'overlays-toggled-broadcast' && m.tabId === tab.id) got.toggled = m.visible;
        if (got.updated !== null && got.panelFindings !== null && got.toggled !== null) resolve();
      });
      setTimeout(resolve, 20000);
    });
    const portP = chrome.runtime.connect({ name: `impeccable-panel-${tab.id}` });
    portP.onMessage.addListener((m) => {
      if (m.action === 'state') got.panelState = { injected: m.injected, findings: (m.findings || []).length };
      if (m.action === 'findings') { got.panelFindings = m.findings.length; if (got.toggled === null) chrome.runtime.sendMessage({ action: 'toggle-overlays', tabId: tab.id }); }
    });
    chrome.runtime.sendMessage({ action: 'scan', tabId: tab.id });
    await done;
    const state = await chrome.runtime.sendMessage({ action: 'get-state', tabId: tab.id });
    out.got = got;
    out.state = { injected: state.injected, findings: state.findings.length, overlaysVisible: state.overlaysVisible };
    // Highlight round trip through the panel port
    portP.postMessage({ action: 'highlight', selector: state.findings[0]?.selector });
    await new Promise((r) => setTimeout(r, 300));
    portP.postMessage({ action: 'unhighlight' });
    portP.disconnect();
    return out;
  }, url);
  const overlays = await page.evaluate(() => ({
    overlays: document.querySelectorAll('.impeccable-overlay:not(.impeccable-banner)').length,
    hidden: document.body.classList.contains('impeccable-hidden'),
    noWindowApi: typeof window.impeccableDetect === 'undefined',
  }));
  const ok = result.got.updated > 0 && result.got.panelFindings > 0 && result.got.toggled === false && result.state.overlaysVisible === false && overlays.overlays > 0 && overlays.hidden && overlays.noWindowApi;
  if (!ok) failures++;
  console.log(`${ok ? 'OK       ' : 'FAILED   '} message flow: popup scan -> findings-updated(${result.got.updated}); panel port state(${JSON.stringify(result.got.panelState)}) findings(${result.got.panelFindings}); toggle -> broadcast visible=${result.got.toggled}, state.overlaysVisible=${result.state.overlaysVisible}; page: ${overlays.overlays} overlays, hidden=${overlays.hidden}, no window API=${overlays.noWindowApi}`);
  await ext.close();
  await page.close();
}

await B.browser.close();
if (A) await A.browser.close();
server.close();
if (timing.length) {
  const sum = (k) => timing.reduce((s, t) => s + t[k], 0);
  console.log(`\n${timing.length - failures}/${timing.length} identical (rects ignored where noted). wall total: js ${sum('aMs')}ms, wasm ${sum('bMs')}ms`);
}
process.exit(failures ? 1 : 0);
