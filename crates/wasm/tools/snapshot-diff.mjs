#!/usr/bin/env node
// A/B of the two probes inside one bundle: inject dist/detect-antipatterns-
// browser.js and diff `impeccableDetect()` (rules over the live-DOM probe)
// against `impeccableDetectFromSnapshot()` (the same rules over a page
// snapshot, hit tests answered on demand) on the same page in the same
// Chrome. Verification tooling only (needs this repo's puppeteer).
//
//   node crates/wasm/tools/snapshot-diff.mjs [--public <other checkout>]
//        [--only fixture.html,...] [--url https://impeccable.style] [--verbose]
//
// Exit 0 when every page is identical, 1 otherwise. Prints per-page timing,
// snapshot size, rounds, and any computed-style property the capture missed.
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

const BUNDLE = fs.readFileSync(path.join(engineRoot, 'dist/detect-antipatterns-browser.js'), 'utf8');
const only = flag('--only') ? flag('--only').split(',') : null;
const verbose = has('--verbose');
const extraUrl = flag('--url');

const dir = path.join(publicRepo, 'tests/fixtures/antipatterns');
const server = http.createServer((req, res) => {
  const f = path.join(dir, decodeURIComponent(req.url.split('?')[0]));
  try {
    const body = fs.readFileSync(f);
    res.setHeader('Content-Type', f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'application/javascript' : f.endsWith('.svg') ? 'image/svg+xml' : f.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8');
    res.end(body);
  } catch { res.statusCode = 404; res.end(); }
}).listen(0);
const port = server.address().port;

let names = fs.readdirSync(dir).filter((n) => n.endsWith('.html')).sort();
if (only) names = names.filter((n) => only.includes(n));
const targets = names.map((n) => `http://127.0.0.1:${port}/${n}`);
if (extraUrl) targets.push(extraUrl);

const browser = await puppeteer.launch({ headless: true, executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined });
let failures = 0;
const timing = [];
const flat = (r) => r.flatMap((g) => g.findings.map((f) => `${g.selector} :: ${f.type} :: ${f.detail}${f.severity !== undefined ? ' [' + f.severity + ']' : ''}`));
for (const url of targets) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  let live, snap;
  try {
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.evaluate(() => { window.__IMPECCABLE_CONFIG__ = { autoScan: false }; });
    await page.evaluate(BUNDLE);
    live = await page.evaluate(() => {
      const t0 = performance.now();
      const findings = window.impeccableDetect({ decorate: false, serialize: true });
      return { findings, ms: performance.now() - t0 };
    });
    snap = await page.evaluate(() => {
      const t0 = performance.now();
      const r = window.impeccableDetectFromSnapshot();
      return { ...r, ms: performance.now() - t0 };
    });
  } catch (e) {
    console.log(`ERROR ${url}: ${e.message}`);
    failures++;
    await page.close();
    continue;
  }
  const A = JSON.stringify(live.findings);
  const B = JSON.stringify(snap.findings);
  const same = A === B;
  const label = path.basename(url) || url;
  const st = snap.stats;
  timing.push({ label, liveMs: live.ms, snapMs: snap.ms, captureMs: st.captureMs, coreMs: st.coreMs, bytes: st.bytes, elements: st.elements, rounds: st.rounds });
  console.log(`${same ? 'IDENTICAL' : 'DIFF     '} ${label}  live ${live.ms.toFixed(0)}ms  snapshot ${snap.ms.toFixed(0)}ms (capture ${st.captureMs.toFixed(0)}ms + core ${st.coreMs.toFixed(0)}ms, ${(st.bytes / 1024).toFixed(0)} KB, ${st.elements} els, ${st.rounds} round${st.rounds === 1 ? '' : 's'})${st.unknownStyleProps.length ? '  UNKNOWN STYLE PROPS: ' + st.unknownStyleProps.join(',') : ''}${errs.length ? '  pageerrors: ' + errs.join(' | ') : ''}`);
  if (!same) {
    failures++;
    const fa = flat(live.findings), fb = flat(snap.findings);
    const onlyA = fa.filter((x) => !fb.includes(x));
    const onlyB = fb.filter((x) => !fa.includes(x));
    console.log(`  live ${fa.length} findings, snapshot ${fb.length}`);
    for (const x of onlyA.slice(0, verbose ? 200 : 8)) console.log('   - live only:    ', x);
    for (const x of onlyB.slice(0, verbose ? 200 : 8)) console.log('   + snapshot only:', x);
    if (onlyA.length === 0 && onlyB.length === 0) {
      for (let i = 0; i < Math.max(live.findings.length, snap.findings.length); i++) {
        if (JSON.stringify(live.findings[i]) !== JSON.stringify(snap.findings[i])) {
          console.log('   group', i, '\n    live:    ', JSON.stringify(live.findings[i]).slice(0, 500), '\n    snapshot:', JSON.stringify(snap.findings[i]).slice(0, 500));
          if (!verbose) break;
        }
      }
    }
  }
  await page.close();
}
await browser.close();
server.close();
const sum = (k) => timing.reduce((a, t) => a + t[k], 0);
console.log(`\n${targets.length - failures}/${targets.length} identical. total scan: live ${sum('liveMs').toFixed(0)}ms, snapshot ${sum('snapMs').toFixed(0)}ms (capture ${sum('captureMs').toFixed(0)}ms, core ${sum('coreMs').toFixed(0)}ms); snapshot bytes total ${(sum('bytes') / 1024).toFixed(0)} KB`);
process.exit(failures ? 1 : 0);
