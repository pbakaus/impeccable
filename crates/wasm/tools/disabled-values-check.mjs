#!/usr/bin/env node
// disabledValues regression check of the in-page WASM bundle, ported from the
// retired tests/detect-antipatterns-browser.test.mjs case
// "extension mode suppresses disabledValues entries from scan config"
// (issue #639). The live overlay resolves the project's ignoreValues per page
// (skill/scripts/live-browser-ignores.js) and sends the survivors as
// config.disabledValues; the detector must filter them where the findings are
// assembled, since the overlay draws its markers from the collected findings.
// Color waivers match by value rather than by spelling, so a hex waiver has to
// suppress a finding the browser reported as rgb(...).
//
// Verification tooling like skip-scan-check.mjs: it needs this repo's fixtures
// plus puppeteer and a built bundle (`cargo xtask bundle`).
//
//   node crates/wasm/tools/disabled-values-check.mjs [--public <other checkout>] [--verbose]
//
// Exit 0 when every contract holds, 1 otherwise.
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
const publicRepo = path.resolve(flag('--public') || process.env.IMPECCABLE_PUBLIC_REPO || engineRoot);
const require = createRequire(path.join(publicRepo, 'package.json'));
const puppeteer = require('puppeteer');

const BUNDLE = fs.readFileSync(path.join(engineRoot, 'dist/detect-antipatterns-browser.js'), 'utf8');

// The JSON-safe payload shape the extension panel and the URL engine inject as
// __IMPECCABLE_CONFIG__.designSystem, for the DESIGN.md the design-system.html
// fixture is written against.
const designSystem = {
  present: true,
  hasFonts: true,
  allowedFonts: ['avenir next', 'ibm plex sans'],
  hasColors: true,
  allowedColors: [
    { r: 36, g: 31, b: 26 },
    { r: 247, g: 244, b: 238 },
    { r: 255, g: 255, b: 255 },
    { r: 184, g: 66, b: 46 },
    { r: 212, g: 199, b: 185 },
  ],
  hasRadii: true,
  allowedRadii: [4, 8, 32],
  hasPillRadius: true,
};

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
const ok = (msg) => console.log(`OK   ${msg}`);
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(`http://127.0.0.1:${port}/design-system.html`, { waitUntil: 'load' });
  await page.evaluate(() => {
    document.documentElement.dataset.impeccableExtension = 'true';
    window.__impeccableMessages = [];
    window.addEventListener('message', event => {
      if (event.source !== window || !event.data?.source?.startsWith('impeccable-')) return;
      window.__impeccableMessages.push(event.data);
    });
  });
  await page.evaluate(BUNDLE);

  const scan = (scanId, disabledValues, extraConfig = {}) => page.evaluate(async (config) => {
    window.postMessage({ source: 'impeccable-command', action: 'scan', config }, '*');
    const deadline = Date.now() + 5000;
    while (
      Date.now() < deadline &&
      !window.__impeccableMessages.some(message =>
        message.source === 'impeccable-results' && message.scanId === config.scanId)
    ) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    const resultMessage = window.__impeccableMessages.find(message =>
      message.source === 'impeccable-results' && message.scanId === config.scanId);
    const flat = (resultMessage?.findings || []).flatMap(group => group.findings || []);
    return {
      total: flat.length,
      colors: flat.filter(finding => finding.type === 'design-system-color').length,
      colorValues: flat
        .filter(finding => finding.type === 'design-system-color')
        .map(finding => finding.ignoreValue || ''),
      fonts: flat
        .filter(finding => finding.type === 'design-system-font')
        .map(finding => finding.ignoreValue || ''),
    };
  }, { scanId, visualContrast: false, designSystem, ...(disabledValues ? { disabledValues } : {}), ...extraConfig });

  const unfiltered = await scan('scan-dv-1');
  if (verbose) console.log('  unfiltered:', JSON.stringify(unfiltered));
  const poppins = (values) => values.some(value => /poppins/i.test(value));
  if (poppins(unfiltered.fonts)) {
    ok('control scan reported the undocumented poppins font');
  } else {
    fail(`expected an undocumented poppins font finding, got: ${JSON.stringify(unfiltered)}`);
  }

  const filtered = await scan('scan-dv-2', [{ rule: 'design-system-font', value: 'poppins' }]);
  if (!poppins(filtered.fonts)) {
    ok('the poppins waiver suppressed its finding');
  } else {
    fail(`expected the poppins waiver to suppress its finding, got: ${JSON.stringify(filtered)}`);
  }
  const waivedCount = unfiltered.fonts.filter(value => /poppins/i.test(value)).length;
  if (filtered.total === unfiltered.total - waivedCount) {
    ok('exactly the waived findings disappeared');
  } else {
    fail(`expected exactly the waived findings to disappear, got: ${JSON.stringify({ unfiltered, filtered })}`);
  }
  if (filtered.colors === unfiltered.colors) {
    ok('unrelated design-system findings survived');
  } else {
    fail(`expected unrelated design-system findings to survive, got: ${JSON.stringify({ unfiltered, filtered })}`);
  }

  // Color waivers match by value, not by spelling: the browser reports
  // computed rgb(...) strings while the waiver is written as hex.
  const rgbToHex = (value) => {
    const m = String(value).match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/i);
    if (!m) return null;
    return `#${[m[1], m[2], m[3]].map(n => Number(n).toString(16).padStart(2, '0')).join('')}`;
  };
  const rgbColor = unfiltered.colorValues.find(value => rgbToHex(value));
  if (!rgbColor) {
    fail(`expected an rgb()-reported design-system-color finding, got: ${JSON.stringify(unfiltered.colorValues)}`);
  } else {
    const hexWaiver = rgbToHex(rgbColor);
    const colorFiltered = await scan('scan-dv-3', [{ rule: 'design-system-color', value: hexWaiver }]);
    const waivedColorCount = unfiltered.colorValues.filter(value => value === rgbColor).length;
    if (colorFiltered.colors === unfiltered.colors - waivedColorCount) {
      ok(`the hex waiver ${hexWaiver} suppressed the ${rgbColor} findings`);
    } else {
      fail(`expected the hex waiver ${hexWaiver} to suppress the ${rgbColor} findings, got: ${JSON.stringify({ colorValues: unfiltered.colorValues, colorFiltered })}`);
    }
    if (poppins(colorFiltered.fonts)) {
      ok('unrelated font findings survived the color waiver');
    } else {
      fail(`expected unrelated font findings to survive the color waiver, got: ${JSON.stringify(colorFiltered)}`);
    }
  }

  // A page waived wholesale by detector.ignoreFiles arrives with
  // config.skipScan and must scan to nothing at all.
  const skipped = await scan('scan-dv-4', null, { skipScan: true });
  if (skipped.total === 0) {
    ok('skipScan emptied the scan');
  } else {
    fail(`expected skipScan to empty the scan, got: ${JSON.stringify(skipped)}`);
  }
  await page.close();
} finally {
  await browser.close().catch(() => {});
  server.close();
}
process.exit(failures ? 1 : 0);
