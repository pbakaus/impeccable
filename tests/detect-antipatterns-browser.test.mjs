/**
 * Puppeteer-backed fixture tests for browser-only detection rules.
 *
 * Some detection rules (cramped-padding, line-length, tight-leading,
 * skipped-heading, justified-text, tiny-text, all-caps-body, wide-tracking,
 * small-target) need real browser layout — they read getBoundingClientRect
 * and getComputedStyle results that jsdom can't compute. Those rules can't
 * be tested with the jsdom suite in detect-antipatterns-fixtures.test.mjs.
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
import { detectUrl } from '../cli/engine/detect-antipatterns.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 8765;
const BASE = `http://localhost:${PORT}`;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

let server;

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
  await new Promise((resolve) => server.listen(PORT, resolve));
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('detectUrl — browser-only fixtures', () => {
  // Only two rules genuinely need real browser layout (getBoundingClientRect):
  //   line-length    → reads rect.width to compute chars-per-line
  //   cramped-padding → reads rect.width/height to filter small badges
  // Everything else in the quality.html fixture runs in jsdom and is asserted
  // by tests/detect-antipatterns-fixtures.test.mjs.

  it('cramped-padding: flag column triggers all 8 cramped cases, pass column adds none', async () => {
    const f = await detectUrl(`${BASE}/fixtures/antipatterns/cramped-padding.html`);
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
    const f = await detectUrl(`${BASE}/fixtures/antipatterns/quality.html`);
    assert.equal(f.filter(r => r.antipattern === 'line-length').length, 1);
  });
});
