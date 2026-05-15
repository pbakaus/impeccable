/**
 * Puppeteer-backed fixture tests for browser-only detection rules.
 *
 * Some detection rules (cramped-padding, line-length, body-text-viewport-edge)
 * need real browser layout — they read getBoundingClientRect and real
 * getComputedStyle results that the static HTML/CSS engine intentionally
 * does not invent.
 *
 * This file uses detectUrl() (Puppeteer) to load fixtures in headless Chrome
 * via a temporary static HTTP server, so the fixtures can use absolute
 * <script src="/js/..."> paths just like in development.
 *
 * Run via Node's built-in test runner:
 *   node --test tests/detect-antipatterns-browser.test.mjs
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBrowserDetector, detectUrl } from '../cli/engine/detect-antipatterns.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

let server;
let baseUrl;

before(async () => {
  // Static server: maps /fixtures/* to tests/fixtures/* and
  // /js/detect-antipatterns-browser.js to cli/engine/detect-antipatterns-browser.js
  // (mirrors what Astro serves so fixtures can use absolute paths)
  server = http.createServer((req, res) => {
    let filePath;
    if (req.url.startsWith('/fixtures/')) {
      filePath = path.join(ROOT, 'tests', req.url);
    } else if (req.url === '/js/detect-antipatterns-browser.js') {
      filePath = path.join(ROOT, 'cli/engine/detect-antipatterns-browser.js');
    } else {
      res.writeHead(404).end();
      return;
    }
    try {
      const body = fs.readFileSync(filePath);
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
});

describe('detectUrl — browser-only fixtures', () => {
  // Only two rules genuinely need real browser layout (getBoundingClientRect):
  //   line-length    → reads rect.width to compute chars-per-line
  //   cramped-padding → reads rect.width/height to filter small badges
  // Everything else in the quality.html fixture runs in static HTML/CSS and is asserted
  // by tests/detect-antipatterns-fixtures.test.mjs.

  it('cramped-padding: flag column triggers all 8 cramped cases, pass column adds none', async () => {
    const f = await detectUrl(`${baseUrl}/fixtures/antipatterns/cramped-padding.html`);
    const cramped = f.filter(r => r.antipattern === 'cramped-padding');
    // Flag column has 8 cases that should fire under the asymmetric
    // proportional rule (vertical: max(4, fs×0.3), horizontal: max(8, fs×0.5)):
    //   1. 14px body / 4px all sides           — V fail
    //   2. 14px body / 2px all sides           — both fail
    //   3. 16px body / 4px all sides           — both fail
    //   4. 14px body / 1px V / 16px H          — V fail
    //   5. 14px body / 12px V / 4px H          — H fail
    //   6. 24px heading / 8px all sides        — H fail (improvement over old 8px floor)
    //   7. 32px hero / 6px V / 16px H          — V fail
    //   8. 14px <pre> / 2px all sides          — both fail
    // Pass column has 12 cases (small pills, standard cards, code blocks,
    // buttons, inputs, big text with proportional padding) — none should fire.
    assert.equal(cramped.length, 8, `expected 8 cramped-padding findings, got ${cramped.length}`);
  });

  it('line-length: flag column triggers, pass column adds none', async () => {
    const f = await detectUrl(`${baseUrl}/fixtures/antipatterns/quality.html`);
    assert.equal(f.filter(r => r.antipattern === 'line-length').length, 1);
  });

  it('body-text-viewport-edge: 3 flag paragraphs/list-items, 0 pass cases', async () => {
    const f = await detectUrl(`${baseUrl}/fixtures/antipatterns/body-text-viewport-edge.html`);
    const edges = f.filter(r => r.antipattern === 'body-text-viewport-edge');
    // Fixture has 3 escape-styled <p>/<li> paragraphs that bleed to
    // the viewport edges. The pass column has 5 paragraphs that
    // should not fire (centered container, inside nav, inside header,
    // inside section with own background, short label < 40 chars).
    assert.equal(edges.length, 3, `expected 3 body-text-viewport-edge findings, got ${edges.length}: ${JSON.stringify(edges.map(e => e.snippet))}`);
  });

  it('visual contrast: pixel fallback catches low contrast on image backgrounds', async () => {
    const analyticOnly = await detectUrl(`${baseUrl}/fixtures/antipatterns/visual-contrast.html`, {
      waitUntil: 'load',
      visualContrast: false,
    });
    assert.equal(
      analyticOnly.some(r => r.antipattern === 'low-contrast' && /White text on light image/i.test(r.snippet || '')),
      false,
      'analytic contrast should not guess image-background contrast',
    );

    const f = await detectUrl(`${baseUrl}/fixtures/antipatterns/visual-contrast.html`, {
      waitUntil: 'load',
      visualContrast: true,
    });
    assert.ok(
      f.some(r =>
        r.antipattern === 'low-contrast' &&
        /pixel contrast/i.test(r.snippet || '') &&
        /White text on light image/i.test(r.snippet || '')
      ),
      `expected pixel contrast finding for light image background, got: ${JSON.stringify(f.map(r => r.snippet))}`,
    );
    assert.equal(
      f.some(r => r.antipattern === 'low-contrast' && /White text on dark image/i.test(r.snippet || '')),
      false,
      'dark image background should keep enough contrast',
    );
  });

  it('browser API: impeccableDetect is pure, impeccableScan decorates', async () => {
    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.default.launch({
      headless: true,
      args: process.env.CI ? ['--no-sandbox', '--disable-setuid-sandbox'] : [],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      await page.goto(`${baseUrl}/fixtures/antipatterns/quality.html`, { waitUntil: 'load' });
      const browserScript = fs.readFileSync(path.join(ROOT, 'cli/engine/detect-antipatterns-browser.js'), 'utf-8');
      await page.evaluate(() => { window.__IMPECCABLE_CONFIG__ = { autoScan: false }; });
      await page.evaluate(browserScript);
      const pure = await page.evaluate(() => {
        const before = document.querySelectorAll('.impeccable-overlay, .impeccable-label, .impeccable-banner').length;
        const findings = window.impeccableDetect({ decorate: false, serialize: true });
        const after = document.querySelectorAll('.impeccable-overlay, .impeccable-label, .impeccable-banner').length;
        return { before, after, count: findings.length };
      });
      assert.equal(pure.before, 0);
      assert.equal(pure.after, 0);
      assert.ok(pure.count > 0);

      const decorated = await page.evaluate(() => {
        const groups = window.impeccableScan();
        const overlays = document.querySelectorAll('.impeccable-overlay, .impeccable-label, .impeccable-banner').length;
        return { groups: groups.length, overlays };
      });
      assert.ok(decorated.groups > 0);
      assert.ok(decorated.overlays > 0);
      await page.close();
    } finally {
      await browser.close().catch(() => {});
    }
  });

  it('createBrowserDetector reuses a browser and honors waitUntil overrides', async () => {
    const detector = await createBrowserDetector({ waitUntil: 'load', settleMs: 0 });
    try {
      const first = await detector.detectUrl(`${baseUrl}/fixtures/antipatterns/quality.html`);
      const second = await detector.detectUrl(`${baseUrl}/fixtures/antipatterns/body-text-viewport-edge.html`, {
        waitUntil: 'domcontentloaded',
      });
      assert.ok(first.some(r => r.antipattern === 'line-length'));
      assert.equal(second.filter(r => r.antipattern === 'body-text-viewport-edge').length, 3);
    } finally {
      await detector.close();
    }
  });
});
