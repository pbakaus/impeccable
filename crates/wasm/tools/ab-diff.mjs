#!/usr/bin/env node
// A/B differential of the in-page bundles: inject an older checkout's JS
// bundle (cli/engine/detect-antipatterns-browser.js, --public) and this repo's WASM
// bundle (dist/detect-antipatterns-browser.js) into the SAME page in the same
// Chrome, and diff the raw `impeccableDetect({ decorate: false, serialize:
// true })` arrays (plus impeccableMeasureHiddenText and, with --visual, the
// impeccableAnalyzeVisualContrast results). Verification tooling only: it
// needs puppeteer and a pre-Rust checkout for the JS side, and is not part
// of any build.
//
//   node crates/wasm/tools/ab-diff.mjs [--public <other checkout>]
//        [--only fixture.html,...] [--rules side-tab,low-contrast]
//        [--url https://impeccable.style] [--visual] [--verbose]
//
// Exit 0 when every page is identical, 1 otherwise. Prints per-page timing.
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

const OLD = fs.readFileSync(path.join(publicRepo, 'cli/engine/detect-antipatterns-browser.js'), 'utf8');
const NEW = fs.readFileSync(path.join(engineRoot, 'dist/detect-antipatterns-browser.js'), 'utf8');
const rules = flag('--rules') ? flag('--rules').split(',') : null;
const only = flag('--only') ? flag('--only').split(',') : null;
const verbose = has('--verbose');
const visual = has('--visual');
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
async function runBundle(page, url, code) {
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.evaluate(() => { window.__IMPECCABLE_CONFIG__ = { autoScan: false }; });
  const t0 = performance.now();
  await page.evaluate(code);
  const tLoad = performance.now() - t0;
  const t1 = performance.now();
  const results = await page.evaluate(() => window.impeccableDetect({ decorate: false, serialize: true }));
  const tScan = performance.now() - t1;
  const hidden = await page.evaluate(() => window.impeccableMeasureHiddenText());
  let vis = null;
  if (visual) vis = await page.evaluate(() => window.impeccableAnalyzeVisualContrast({ maxCandidates: 12, scrollOffscreen: true }));
  return { results, hidden, vis, tLoad, tScan };
}
function project(results) {
  return results.map((g) => ({ ...g, findings: rules ? g.findings.filter((f) => rules.includes(f.type)) : g.findings }))
    .filter((g) => !rules || g.findings.length > 0);
}
for (const url of targets) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  let a, b;
  try {
    a = await runBundle(page, url, OLD);
    b = await runBundle(page, url, NEW);
  } catch (e) {
    console.log(`ERROR ${url}: ${e.message}`);
    failures++;
    await page.close();
    continue;
  }
  const A = JSON.stringify(project(a.results));
  const B = JSON.stringify(project(b.results));
  const H = JSON.stringify(a.hidden) === JSON.stringify(b.hidden);
  const V = visual ? JSON.stringify(a.vis) === JSON.stringify(b.vis) : true;
  const same = A === B && H && V;
  const label = path.basename(url) || url;
  timing.push({ label, oldLoad: a.tLoad, newLoad: b.tLoad, oldScan: a.tScan, newScan: b.tScan });
  console.log(`${same ? 'IDENTICAL' : 'DIFF     '} ${label}  js ${a.tScan.toFixed(0)}ms  wasm ${b.tScan.toFixed(0)}ms (load ${b.tLoad.toFixed(0)}ms)${errs.length ? '  pageerrors: ' + errs.join(' | ') : ''}`);
  if (!same) {
    failures++;
    if (!H) console.log('  hidden-text differs', JSON.stringify(a.hidden), JSON.stringify(b.hidden));
    if (!V) console.log('  visual differs', JSON.stringify(a.vis).slice(0, 400), '\n  vs', JSON.stringify(b.vis).slice(0, 400));
    if (A !== B) {
      const pa = project(a.results), pb = project(b.results);
      const flat = (r) => r.flatMap((g) => g.findings.map((f) => `${g.selector} :: ${f.type} :: ${f.detail}${f.severity !== undefined ? ' [' + f.severity + ']' : ''}`));
      const fa = flat(pa), fb = flat(pb);
      const onlyA = fa.filter((x) => !fb.includes(x));
      const onlyB = fb.filter((x) => !fa.includes(x));
      console.log(`  js ${fa.length} findings, wasm ${fb.length}`);
      for (const x of onlyA.slice(0, verbose ? 200 : 8)) console.log('   - js only:  ', x);
      for (const x of onlyB.slice(0, verbose ? 200 : 8)) console.log('   + wasm only:', x);
      if (onlyA.length === 0 && onlyB.length === 0) {
        // same set, different order or metadata
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
          if (JSON.stringify(pa[i]) !== JSON.stringify(pb[i])) {
            console.log('   group', i, '\n    js:  ', JSON.stringify(pa[i]).slice(0, 500), '\n    wasm:', JSON.stringify(pb[i]).slice(0, 500));
            if (!verbose) break;
          }
        }
      }
    }
  }
  await page.close();
}
await browser.close();
server.close();
const sum = (k) => timing.reduce((s, t) => s + t[k], 0);
console.log(`\n${targets.length - failures}/${targets.length} identical. total scan: js ${sum('oldScan').toFixed(0)}ms, wasm ${sum('newScan').toFixed(0)}ms; wasm bundle load avg ${(sum('newLoad') / Math.max(1, timing.length)).toFixed(0)}ms`);
process.exit(failures ? 1 : 0);
