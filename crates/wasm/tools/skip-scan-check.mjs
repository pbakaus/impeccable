#!/usr/bin/env node
// skipScan regression check of the in-page WASM bundle, ported from the
// retired tests/detect-antipatterns-browser.test.mjs case
// "extension scan: skipScan suppresses the visual contrast stage too"
// (upstream commit 00095adb). An extension-mode scan of an
// ignoreFiles-waived page (config.skipScan) must stay at zero through the
// async visual-contrast stage as well: no results post with findings, no
// markers. The control scan proves the visual pass otherwise reports
// low-contrast on the same page. Verification tooling like ab-diff.mjs: it
// needs this repo's fixtures + puppeteer and a built bundle
// (`cargo xtask bundle`).
//
//   node crates/wasm/tools/skip-scan-check.mjs [--public <other checkout>] [--verbose]
//
// Exit 0 when both contracts hold, 1 otherwise.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const verbose = args.includes('--verbose');
const here = path.dirname(fileURLToPath(import.meta.url));
const engineRoot = path.resolve(here, '../../..');
// The fixtures and puppeteer live in this repo; --public points at another
// checkout (an older one, for A/B against the pre-Rust engine).
const publicRepo = path.resolve(flag('--public') || process.env.IMPECCABLE_PUBLIC_REPO || engineRoot);
const require = createRequire(path.join(publicRepo, 'package.json'));
const puppeteer = require('puppeteer');

const BUNDLE = fs.readFileSync(path.join(engineRoot, 'dist/detect-antipatterns-browser.js'), 'utf8');

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

const browser = await puppeteer.launch({
  headless: true,
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  args: process.env.CI ? ['--no-sandbox', '--disable-setuid-sandbox'] : [],
});
let failures = 0;
const fail = (msg) => { failures++; console.log(`FAIL ${msg}`); };
try {
  const page = await browser.newPage();
  // Keep failing visual-contrast cards inside the no-scroll viewport.
  await page.setViewport({ width: 1280, height: 1000 });
  await page.goto(`http://127.0.0.1:${port}/visual-contrast.html`, { waitUntil: 'load' });
  await page.evaluate(() => {
    document.documentElement.dataset.impeccableExtension = 'true';
    window.__impeccableMessages = [];
    window.addEventListener('message', event => {
      if (event.source !== window || !event.data?.source?.startsWith('impeccable-')) return;
      window.__impeccableMessages.push(event.data);
    });
  });
  await page.evaluate(BUNDLE);
  const resultsFor = (scanId) => page.evaluate((id) => (
    (window.__impeccableMessages || [])
      .filter(m => m.source === 'impeccable-results' && m.scanId === id)
      .map(m => ({
        count: m.count,
        types: (m.findings || []).flatMap(g => (g.findings || []).map(f => f.type || f.id)),
      }))
  ), scanId);

  // Control: the visual pass runs after the analytic scan and re-posts
  // results carrying its low-contrast findings. This is exactly what an
  // ignoreFiles-waived page must not do.
  await page.evaluate(() => {
    window.postMessage({
      source: 'impeccable-command',
      action: 'scan',
      config: { scanId: 'vc-skip-1', visualContrast: true, visualContrastMaxCandidates: 20 },
    }, '*');
  });
  const controlDeadline = Date.now() + 8000;
  let control = [];
  while (Date.now() < controlDeadline) {
    control = await resultsFor('vc-skip-1');
    if (control.some(r => r.types.includes('low-contrast'))) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (control.some(r => r.types.includes('low-contrast'))) {
    console.log('OK   control scan: visual pass reported low-contrast');
  } else {
    fail(`expected the control scan's visual pass to report low-contrast, got: ${JSON.stringify(control)}`);
  }
  if (verbose) console.log('  control posts:', JSON.stringify(control));

  // skipScan: a page waived wholesale by detector.ignoreFiles must stay
  // at zero through the async visual stage as well: no results post with
  // findings, no markers.
  await page.evaluate(() => {
    window.postMessage({
      source: 'impeccable-command',
      action: 'scan',
      config: { scanId: 'vc-skip-2', visualContrast: true, visualContrastMaxCandidates: 20, skipScan: true },
    }, '*');
  });
  await new Promise(resolve => setTimeout(resolve, 2500));
  const skipped = await resultsFor('vc-skip-2');
  if (skipped.length >= 1) {
    console.log(`OK   skipScan scan posted results (${skipped.length})`);
  } else {
    fail(`expected the skipScan scan to post results, got: ${JSON.stringify(skipped)}`);
  }
  if (skipped.every(r => r.count === 0 && r.types.length === 0)) {
    console.log('OK   every skipScan results post stayed empty');
  } else {
    fail(`expected every skipScan results post to stay empty, got: ${JSON.stringify(skipped)}`);
  }
  const overlays = await page.evaluate(() =>
    document.querySelectorAll('.impeccable-overlay, .impeccable-label').length);
  if (overlays === 0) {
    console.log('OK   no markers on the skipScan page');
  } else {
    fail(`expected no markers on a skipScan page, got ${overlays}`);
  }
  await page.close();
} finally {
  await browser.close().catch(() => {});
  server.close();
}
process.exit(failures ? 1 : 0);
