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
import { createBrowserDetector, detectUrl, normalizeDesignSystem } from '../cli/engine/detect-antipatterns.mjs';
import { filterDetectionFindings } from '../cli/lib/impeccable-config.mjs';

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
    // Pass column has 13 cases (small pills, inline code, standard cards, code blocks,
    // buttons, inputs, big text with proportional padding) — none should fire.
    assert.equal(cramped.length, 8, `expected 8 cramped-padding findings, got ${cramped.length}`);
  });

  it('cramped-padding wrapper: skips same-surface wrappers, full-bleed marquees, and inset inner text surfaces', async () => {
    const f = await detectUrl(`${baseUrl}/fixtures/antipatterns/flush-against-border.html`);
    const cramped = f.filter(r => r.antipattern === 'cramped-padding');
    const snippets = cramped.map(r => r.snippet || '').join('\n');

    for (const cls of ['flag-frameworks', 'flag-card-borders', 'flag-bg-only', 'flag-outline-only', 'flag-asym-leftflush']) {
      assert.match(snippets, new RegExp(`"${cls}"`), `expected ".${cls}" to be flagged`);
    }
    for (const cls of ['pass-same-bg-child', 'pass-marquee-shell', 'pass-inner-text-surface']) {
      assert.doesNotMatch(snippets, new RegExp(`"${cls}"`), `".${cls}" should not be flagged`);
    }
  });

  it('line-length: flag column triggers, pass column adds none', async () => {
    const f = await detectUrl(`${baseUrl}/fixtures/antipatterns/quality.html`);
    assert.equal(f.filter(r => r.antipattern === 'line-length').length, 1);
  });

  it('design-system: URL scans apply injected design context', async () => {
    const designSystem = normalizeDesignSystem({
      frontmatter: {
        typography: {
          display: { fontFamily: 'Avenir Next, Georgia, serif' },
          body: { fontFamily: 'IBM Plex Sans, Arial, sans-serif' },
        },
        colors: {
          ink: '#241f1a',
          paper: '#f7f4ee',
          surface: '#ffffff',
          accent: '#b8422e',
          border: '#d4c7b9',
        },
        rounded: {
          sm: '4px',
          md: '8px',
          '"2xl"': '32px',
          full: '999px',
        },
      },
      sidecar: {
        extensions: {
          colorMeta: {
            accent: {
              canonical: '#b8422e',
              tonalRamp: ['#923524', '#d55a42'],
            },
          },
        },
      },
    });
    const f = await detectUrl(`${baseUrl}/fixtures/antipatterns/design-system.html`, {
      designSystem,
      visualContrast: false,
    });
    const designFindings = f.filter(r => r.antipattern.startsWith('design-system-'));
    const snippets = designFindings.map(r => r.snippet || '').join('\n');

    assert.ok(designFindings.some(r => r.antipattern === 'design-system-font'), 'expected unsupported font');
    assert.ok(designFindings.some(r => r.antipattern === 'design-system-color'), 'expected undocumented colors');
    assert.ok(designFindings.some(r => r.antipattern === 'design-system-radius'), 'expected undocumented radius');
    assert.match(snippets, /Flag Font Unsupported/);
    assert.match(snippets, /Flag Color Hot Pink/);
    assert.match(snippets, /Flag Radius Eighteen/);
    assert.doesNotMatch(snippets, /Pass Mid Pill Radius/);

    const filtered = filterDetectionFindings(f, {
      ignoreRules: [],
      ignoreValues: [{ rule: 'design-system-font', value: 'poppins' }],
    });
    assert.equal(
      filtered.some(r => r.antipattern === 'design-system-font' && /poppins/i.test(r.ignoreValue || r.snippet || '')),
      false,
      'URL design-system findings should carry ignoreValue for CLI suppressions',
    );
  });

  it('clipped-overflow-container: utility-named popovers still flag when clipped', async () => {
    const f = await detectUrl(`${baseUrl}/fixtures/antipatterns/clipped-overflow-container.html`);
    const snippets = f
      .filter(r => r.antipattern === 'clipped-overflow-container')
      .map(r => r.snippet || '')
      .join('\n');

    assert.match(snippets, /flag-shadow-utility/, 'shadow-lg utility surfaces must not be skipped as decorative');
    assert.match(snippets, /flag-overlay-surface/, 'overlay-named content surfaces must not be skipped as decorative');
    assert.doesNotMatch(snippets, /pass-contained-overlay/, 'aria-hidden decorative overlays should remain skipped');
  });

  it('oversized-h1: requires the headline to dominate the viewport, not just be large', async () => {
    const f = await detectUrl(`${baseUrl}/fixtures/antipatterns/oversized-h1-browser.html`);
    const hits = f.filter(r => r.antipattern === 'oversized-h1');
    assert.equal(
      hits.length,
      1,
      `expected exactly one oversized-h1 finding, got ${hits.length}: ${hits.map(r => r.snippet).join('; ')}`,
    );
    assert.match(hits[0].snippet, /sprawls across the whole/i);
    assert.equal(
      hits.some(r => /missing design vocabulary/i.test(r.snippet || '')),
      false,
      'a large two-line homepage-style h1 must not flag unless it dominates the viewport',
    );
  });

  it('typography side-by-side: element-level flag cases get regular overlays', async () => {
    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.default.launch({
      headless: true,
      args: process.env.CI ? ['--no-sandbox', '--disable-setuid-sandbox'] : [],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      await page.goto(`${baseUrl}/fixtures/antipatterns/typography.html`, { waitUntil: 'load' });
      const browserScript = fs.readFileSync(path.join(ROOT, 'cli/engine/detect-antipatterns-browser.js'), 'utf-8');
      await page.evaluate(() => { window.__IMPECCABLE_CONFIG__ = { autoScan: false }; });
      await page.evaluate(browserScript);
      const result = await page.evaluate(() => {
        const groups = window.impeccableScan();
        const types = groups.flatMap(group => group.findings.map(finding => finding.type || finding.id));
        return {
          types,
          pageTypes: groups
            .filter(group => group.el === document.body || group.el === document.documentElement)
            .flatMap(group => group.findings.map(finding => finding.type || finding.id)),
          hasBanner: Boolean(document.querySelector('.impeccable-banner')),
          overlays: document.querySelectorAll('.impeccable-overlay:not(.impeccable-banner)').length,
        };
      });
      for (const id of ['tight-leading', 'tiny-text', 'all-caps-body', 'wide-tracking', 'justified-text']) {
        assert.ok(result.types.includes(id), `expected browser typography scan to include ${id}: ${JSON.stringify(result)}`);
      }
      assert.ok(result.pageTypes.includes('overused-font'), `expected browser typography scan to include page-level overused-font: ${JSON.stringify(result)}`);
      assert.equal(result.hasBanner, true, `expected page-level typography banner: ${JSON.stringify(result)}`);
      assert.ok(result.overlays >= 5, `expected visible typography overlays, got: ${JSON.stringify(result)}`);
      await page.close();
    } finally {
      await browser.close().catch(() => {});
    }
  });

  it('overused-font: hook inline-ignore comments do not suppress browser findings', async () => {
    const f = await detectUrl(`${baseUrl}/fixtures/antipatterns/hook-inline-ignore.html`);
    assert.ok(
      f.some(r => r.antipattern === 'overused-font' || r.type === 'overused-font' || r.id === 'overused-font'),
      `expected browser scan to include overused-font despite inline comments: ${JSON.stringify(f)}`,
    );
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

  it('text-overflow: flags content wider than its box, skips real scroll regions', async () => {
    // Browser-only: needs scrollWidth vs clientWidth from real layout.
    // Flag column: a nowrap line and an unbreakable token spilling past a
    // fixed-width box (overflow visible). Pass column: a genuine
    // overflow-x:auto scroll region, a <pre>, normally wrapping text, a long
    // line living inside a scroll ancestor, and sr-only accessible text.
    const f = await detectUrl(`${baseUrl}/fixtures/antipatterns/text-overflow.html`);
    const hits = f.filter(r => r.antipattern === 'text-overflow');
    const flagged = new Set();
    for (const r of hits) {
      const m = (r.snippet || '').match(/\.(flag-[\w-]+|pass-[\w-]+)/);
      if (m) flagged.add(m[1]);
    }
    assert.ok(flagged.has('flag-nowrap'), 'expected the nowrap overflow case to flag');
    assert.ok(flagged.has('flag-longword'), 'expected the unbreakable-token overflow case to flag');
    for (const cls of [
      'pass-scroll',
      'pass-pre',
      'pass-wrap',
      'pass-inside-scroll',
      'pass-sr-only-clip-path',
      'pass-sr-only-legacy',
      'pass-sr-only-tiny-hidden',
      'pass-sr-only-clipped-wide',
      'pass-hidden-slide-overflow',
    ]) {
      assert.ok(!flagged.has(cls), `".${cls}" should NOT be flagged as text-overflow`);
    }
    assert.equal(hits.length, 2, `expected exactly 2 text-overflow findings, got ${hits.length}: ${JSON.stringify(hits.map(h => h.snippet))}`);
  });

  it('visual contrast: browser fallback catches low contrast on image backgrounds', async () => {
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
      visualContrastMaxCandidates: 20,
    });
    const visualFindings = f.filter(r =>
      r.antipattern === 'low-contrast' &&
      /(?:browser|pixel) contrast/i.test(r.snippet || '')
    );
    assert.equal(
      visualFindings.length,
      4,
      `expected 4 visual contrast findings, got ${visualFindings.length}: ${JSON.stringify(visualFindings.map(r => r.snippet))}`,
    );
    assert.ok(
      f.some(r =>
        r.antipattern === 'low-contrast' &&
        /(?:browser|pixel) contrast/i.test(r.snippet || '') &&
        /White text on light image/i.test(r.snippet || '')
      ),
      `expected visual contrast finding for light image background, got: ${JSON.stringify(f.map(r => r.snippet))}`,
    );
    assert.ok(
      f.some(r => r.antipattern === 'low-contrast' && /Dark text on dark image/i.test(r.snippet || '')),
      'expected pixel contrast finding for dark text on dark image',
    );
    assert.ok(
      f.some(r => r.antipattern === 'low-contrast' && /Translucent white text on a pale pattern/i.test(r.snippet || '')),
      'expected pixel contrast finding for translucent text on pale pattern',
    );
    assert.ok(
      f.some(r => r.antipattern === 'low-contrast' && /Muted gray text on a misty image/i.test(r.snippet || '')),
      'expected pixel contrast finding for muted gray text on misty image',
    );
    assert.equal(
      f.some(r => r.antipattern === 'low-contrast' && /White text on dark image/i.test(r.snippet || '')),
      false,
      'dark image background should keep enough contrast',
    );
    assert.equal(
      f.some(r => r.antipattern === 'low-contrast' && /Dark text on light image/i.test(r.snippet || '')),
      false,
      'light image with dark text should keep enough contrast',
    );
    assert.equal(
      f.some(r => r.antipattern === 'low-contrast' && /Hidden mockup text/i.test(r.snippet || '')),
      false,
      'aria-hidden decorative mockups should not produce visual contrast findings',
    );
    assert.equal(
      f.some(r => r.antipattern === 'low-contrast' && /Should (?:flag|pass) after pixel sampling/i.test(r.snippet || '')),
      false,
      'fixture column headings should not be low-contrast findings',
    );
  });

  it('browser API: visual contrast fallback resolves readable image backgrounds without overlays', async () => {
    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.default.launch({
      headless: true,
      args: process.env.CI ? ['--no-sandbox', '--disable-setuid-sandbox'] : [],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      await page.goto(`${baseUrl}/fixtures/antipatterns/visual-contrast.html`, { waitUntil: 'load' });
      const browserScript = fs.readFileSync(path.join(ROOT, 'cli/engine/detect-antipatterns-browser.js'), 'utf-8');
      await page.evaluate(() => { window.__IMPECCABLE_CONFIG__ = { autoScan: false }; });
      await page.evaluate(browserScript);
      const result = await page.evaluate(async () => {
        const before = document.querySelectorAll('.impeccable-overlay, .impeccable-label, .impeccable-banner').length;
        const analyses = await window.impeccableAnalyzeVisualContrast({ maxCandidates: 20, scrollOffscreen: true });
        const after = document.querySelectorAll('.impeccable-overlay, .impeccable-label, .impeccable-banner').length;
        return {
          before,
          after,
          failed: analyses.filter(item => item.status === 'fail').map(item => item.finding?.snippet || ''),
          passed: analyses.filter(item => item.status === 'pass').map(item => item.text || ''),
          unresolved: analyses.filter(item => item.status === 'unresolved').map(item => item.reason || ''),
        };
      });
      assert.equal(result.before, 0);
      assert.equal(result.after, 0);
      assert.equal(result.failed.length, 4, `expected 4 browser visual failures, got: ${JSON.stringify(result)}`);
      assert.ok(result.failed.some(snippet => /White text on light image/i.test(snippet)));
      assert.ok(result.failed.some(snippet => /Dark text on dark image/i.test(snippet)));
      assert.ok(result.failed.every(snippet => /browser contrast/i.test(snippet)));
      assert.ok(result.passed.some(text => /White text on dark image/i.test(text)));
      assert.ok(result.passed.some(text => /Dark text on light image/i.test(text)));
    } finally {
      await browser.close().catch(() => {});
    }
  });

  it('browser API: visual contrast scan decorates visible findings without scrolling by default', async () => {
    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.default.launch({
      headless: true,
      args: process.env.CI ? ['--no-sandbox', '--disable-setuid-sandbox'] : [],
    });
    try {
      const page = await browser.newPage();
      // Keep three failing visual-contrast cards in the no-scroll viewport;
      // the offscreen cases are covered by the scrollOffscreen test above.
      await page.setViewport({ width: 1280, height: 1000 });
      await page.goto(`${baseUrl}/fixtures/antipatterns/visual-contrast.html`, { waitUntil: 'load' });
      const browserScript = fs.readFileSync(path.join(ROOT, 'cli/engine/detect-antipatterns-browser.js'), 'utf-8');
      await page.evaluate(() => { window.__IMPECCABLE_CONFIG__ = { autoScan: false }; });
      await page.evaluate(browserScript);
      const result = await page.evaluate(async () => {
        let scrollEvents = 0;
        let maxScrollY = window.scrollY;
        window.addEventListener('scroll', () => {
          scrollEvents += 1;
          maxScrollY = Math.max(maxScrollY, window.scrollY);
        }, { passive: true });
        const syncScanResult = window.impeccableScan({
          visualContrast: true,
          visualContrastMaxCandidates: 20,
        });
        const syncDetectResult = window.impeccableDetect({
          visualContrast: true,
          serialize: true,
        });
        const groups = await window.impeccableScanAsync({
          visualContrast: true,
          visualContrastMaxCandidates: 20,
        });
        await new Promise(resolve => setTimeout(resolve, 50));
        return {
          groups: groups.map(group => ({
            text: group.el.textContent || '',
            types: group.findings.map(finding => finding.type || finding.id),
          })),
          overlays: document.querySelectorAll('.impeccable-overlay:not(.impeccable-banner)').length,
          labels: document.querySelectorAll('.impeccable-label').length,
          analyses: window.impeccableGetLastVisualContrastAnalyses().filter(item => item.status === 'fail').length,
          scrollEvents,
          maxScrollY,
          finalScrollY: window.scrollY,
          syncScanIsArray: Array.isArray(syncScanResult),
          syncDetectIsArray: Array.isArray(syncDetectResult),
          hasAsyncApi: typeof window.impeccableScanAsync === 'function' && typeof window.impeccableDetectAsync === 'function',
        };
      });
      const visualGroups = result.groups.filter(group =>
        group.types.includes('low-contrast') &&
        /(?:White text on light image|Dark text on dark image|Translucent white text|Muted gray text)/i.test(group.text)
      );
      assert.equal(result.analyses, 3, `expected 3 viewport visual failures, got: ${JSON.stringify(result)}`);
      assert.equal(visualGroups.length, 3, `expected 3 viewport visual groups, got: ${JSON.stringify(result)}`);
      assert.ok(result.overlays >= 3, `expected regular overlays for visible visual findings, got: ${JSON.stringify(result)}`);
      assert.ok(result.labels >= 3, `expected regular labels for visible visual findings, got: ${JSON.stringify(result)}`);
      assert.equal(result.maxScrollY, 0, `visual scan should not scroll the page by default: ${JSON.stringify(result)}`);
      assert.equal(result.finalScrollY, 0, `visual scan should preserve scroll by default: ${JSON.stringify(result)}`);
      assert.equal(result.syncScanIsArray, true, `impeccableScan should keep a synchronous Array return: ${JSON.stringify(result)}`);
      assert.equal(result.syncDetectIsArray, true, `impeccableDetect should keep a synchronous Array return: ${JSON.stringify(result)}`);
      assert.equal(result.hasAsyncApi, true, `visual contrast should expose explicit async APIs: ${JSON.stringify(result)}`);

      const refreshedOverlayResult = await page.evaluate(async () => {
        window.scrollTo(0, 0);
        const target = [...document.querySelectorAll('p')]
          .find(node => /White text on light image should be sampled/i.test(node.textContent || ''));
        target.style.fontSize = '10px';
        const initialGroups = window.impeccableScan({
          visualContrast: true,
          visualContrastMaxCandidates: 20,
        });
        const initialTargetGroup = initialGroups.find(group => group.el === target);
        const deadline = Date.now() + 1000;
        while (
          Date.now() < deadline &&
          !/low contrast/i.test(target?._impeccableOverlay?.textContent || '')
        ) {
          const nextButton = target?._impeccableOverlay?.querySelector('button:last-of-type');
          if (nextButton) nextButton.click();
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        const labelVariants = [];
        const overlay = target?._impeccableOverlay;
        for (let i = 0; i < 3; i++) {
          labelVariants.push(overlay?.textContent || '');
          overlay?.querySelector('button:last-of-type')?.click();
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        return {
          initialTypes: initialTargetGroup?.findings.map(finding => finding.type || finding.id) || [],
          labelText: target?._impeccableOverlay?.textContent || '',
          labelVariants,
          overlayConnected: Boolean(target?._impeccableOverlay?.isConnected),
        };
      });
      assert.ok(refreshedOverlayResult.initialTypes.includes('tiny-text'), `test setup should create an initial sync overlay on the target: ${JSON.stringify(refreshedOverlayResult)}`);
      assert.ok(refreshedOverlayResult.labelVariants.some(text => /tiny body text/i.test(text)), `expected refreshed overlay to keep the sync finding label: ${JSON.stringify(refreshedOverlayResult)}`);
      assert.ok(refreshedOverlayResult.labelVariants.some(text => /low contrast/i.test(text)), `expected visual contrast to refresh the existing overlay label: ${JSON.stringify(refreshedOverlayResult)}`);
      assert.equal(refreshedOverlayResult.overlayConnected, true, `expected refreshed overlay to stay connected: ${JSON.stringify(refreshedOverlayResult)}`);

      const lazyResult = await page.evaluate(async () => {
        const target = [...document.querySelectorAll('p')]
          .find(node => /Muted gray text on a misty image/i.test(node.textContent || ''));
        target?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
        await new Promise(resolve => setTimeout(resolve, 250));
        return {
          overlays: document.querySelectorAll('.impeccable-overlay:not(.impeccable-banner)').length,
          labels: document.querySelectorAll('.impeccable-label').length,
          analyses: window.impeccableGetLastVisualContrastAnalyses().filter(item => item.status === 'fail').length,
          targetHasOverlay: Boolean(target?._impeccableOverlay),
          scrollY: window.scrollY,
        };
      });
      assert.equal(lazyResult.analyses, 4, `expected lazy visual resolution after scrolling into view, got: ${JSON.stringify(lazyResult)}`);
      assert.ok(lazyResult.overlays >= 4, `expected lazy visual overlay after scrolling into view, got: ${JSON.stringify(lazyResult)}`);
      assert.ok(lazyResult.labels >= 4, `expected lazy visual label after scrolling into view, got: ${JSON.stringify(lazyResult)}`);
      assert.equal(lazyResult.targetHasOverlay, true, `expected lazy visual target to get a regular overlay, got: ${JSON.stringify(lazyResult)}`);
      assert.ok(lazyResult.scrollY > 0, `test should have naturally scrolled to the offscreen case: ${JSON.stringify(lazyResult)}`);

      const staleOverlayResult = await page.evaluate(async () => {
        const target = [...document.querySelectorAll('p')]
          .find(node => /Muted gray text on a misty image/i.test(node.textContent || ''));
        window.scrollTo(0, 0);
        await new Promise(resolve => setTimeout(resolve, 50));
        await window.impeccableScanAsync({
          visualContrast: true,
          visualContrastMaxCandidates: 20,
        });
        const staleCleared = !target?._impeccableOverlay;
        target?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
        await new Promise(resolve => setTimeout(resolve, 250));
        return {
          staleCleared,
          targetHasOverlay: Boolean(target?._impeccableOverlay),
          targetOverlayConnected: Boolean(target?._impeccableOverlay?.isConnected),
          overlays: document.querySelectorAll('.impeccable-overlay:not(.impeccable-banner)').length,
          analyses: window.impeccableGetLastVisualContrastAnalyses().filter(item => item.status === 'fail').length,
        };
      });
      assert.equal(staleOverlayResult.staleCleared, true, `expected clearOverlays to remove stale target overlay refs, got: ${JSON.stringify(staleOverlayResult)}`);
      assert.equal(staleOverlayResult.targetHasOverlay, true, `expected lazy visual target to be highlightable after a rescan, got: ${JSON.stringify(staleOverlayResult)}`);
      assert.equal(staleOverlayResult.targetOverlayConnected, true, `expected lazy visual overlay after rescan to be connected, got: ${JSON.stringify(staleOverlayResult)}`);

      const offscreenResult = await page.evaluate(async () => {
        window.scrollTo(0, 0);
        let maxScrollY = window.scrollY;
        window.addEventListener('scroll', () => {
          maxScrollY = Math.max(maxScrollY, window.scrollY);
        }, { passive: true });
        const groups = await window.impeccableScanAsync({
          visualContrast: true,
          visualContrastMaxCandidates: 20,
          visualContrastScrollOffscreen: true,
        });
        await new Promise(resolve => setTimeout(resolve, 50));
        return {
          groups: groups.map(group => ({
            text: group.el.textContent || '',
            types: group.findings.map(finding => finding.type || finding.id),
          })),
          analyses: window.impeccableGetLastVisualContrastAnalyses().filter(item => item.status === 'fail').length,
          maxScrollY,
          finalScrollY: window.scrollY,
        };
      });
      const offscreenVisualGroups = offscreenResult.groups.filter(group =>
        group.types.includes('low-contrast') &&
        /(?:White text on light image|Dark text on dark image|Translucent white text|Muted gray text)/i.test(group.text)
      );
      assert.equal(offscreenResult.analyses, 4, `expected 4 opt-in visual failures, got: ${JSON.stringify(offscreenResult)}`);
      assert.equal(offscreenVisualGroups.length, 4, `expected 4 opt-in visual groups, got: ${JSON.stringify(offscreenResult)}`);
      assert.ok(offscreenResult.maxScrollY > 0, `offscreen opt-in should be allowed to scroll: ${JSON.stringify(offscreenResult)}`);
      assert.equal(offscreenResult.finalScrollY, 0, `offscreen opt-in should restore scroll: ${JSON.stringify(offscreenResult)}`);
    } finally {
      await browser.close().catch(() => {});
    }
  });

  it('extension mode remove cancels pending lazy visual contrast work', async () => {
    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.default.launch({
      headless: true,
      args: process.env.CI ? ['--no-sandbox', '--disable-setuid-sandbox'] : [],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      await page.goto(`${baseUrl}/fixtures/antipatterns/visual-contrast.html`, { waitUntil: 'load' });
      const browserScript = fs.readFileSync(path.join(ROOT, 'cli/engine/detect-antipatterns-browser.js'), 'utf-8');
      await page.evaluate(() => {
        document.documentElement.dataset.impeccableExtension = 'true';
        window.__impeccableMessages = [];
        window.addEventListener('message', event => {
          if (event.source !== window || !event.data?.source?.startsWith('impeccable-')) return;
          window.__impeccableMessages.push(event.data);
        });
      });
      await page.evaluate(browserScript);
      const result = await page.evaluate(async () => {
        window.postMessage({
          source: 'impeccable-command',
          action: 'scan',
          config: {
            visualContrast: true,
            visualContrastMaxCandidates: 20,
          },
        }, '*');
        const scanDeadline = Date.now() + 1000;
        while (
          Date.now() < scanDeadline &&
          !window.impeccableGetLastVisualContrastAnalyses()
            .some(item => item.status === 'unresolved' && item.reason === 'text outside viewport')
        ) {
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        const unresolvedBeforeRemove = window.impeccableGetLastVisualContrastAnalyses()
          .filter(item => item.status === 'unresolved' && item.reason === 'text outside viewport').length;
        window.postMessage({ source: 'impeccable-command', action: 'remove' }, '*');
        await new Promise(resolve => setTimeout(resolve, 50));
        const target = [...document.querySelectorAll('p')]
          .find(node => /Muted gray text on a misty image/i.test(node.textContent || ''));
        target?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
        await new Promise(resolve => setTimeout(resolve, 300));
        const resultsAfterRemove = window.__impeccableMessages
          .filter(message => message.source === 'impeccable-results').length;
        return {
          unresolvedBeforeRemove,
          overlayCount: document.querySelectorAll('.impeccable-overlay').length,
          targetHasOverlay: Boolean(target?._impeccableOverlay),
          resultsAfterRemove,
        };
      });
      assert.ok(result.unresolvedBeforeRemove > 0, `test setup should leave lazy visual candidates pending: ${JSON.stringify(result)}`);
      assert.equal(result.overlayCount, 0, `remove should not allow lazy visual overlays to reappear: ${JSON.stringify(result)}`);
      assert.equal(result.targetHasOverlay, false, `remove should clear stale target overlay refs: ${JSON.stringify(result)}`);
      await page.close();
    } finally {
      await browser.close().catch(() => {});
    }
  });

  it('extension mode reports async visual contrast errors to the panel', async () => {
    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.default.launch({
      headless: true,
      args: process.env.CI ? ['--no-sandbox', '--disable-setuid-sandbox'] : [],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      await page.goto(`${baseUrl}/fixtures/antipatterns/visual-contrast.html`, { waitUntil: 'load' });
      const browserScript = fs.readFileSync(path.join(ROOT, 'cli/engine/detect-antipatterns-browser.js'), 'utf-8');
      await page.evaluate(() => {
        document.documentElement.dataset.impeccableExtension = 'true';
        window.__impeccableMessages = [];
        window.addEventListener('message', event => {
          if (event.source !== window || !event.data?.source?.startsWith('impeccable-')) return;
          window.__impeccableMessages.push(event.data);
        });
      });
      await page.evaluate(browserScript);
      const result = await page.evaluate(async () => {
        const originalGetContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function getContext() {
          throw new Error('forced visual contrast canvas failure');
        };
        try {
          window.postMessage({
            source: 'impeccable-command',
            action: 'scan',
            config: {
              visualContrast: true,
              visualContrastMaxCandidates: 20,
            },
          }, '*');
          const deadline = Date.now() + 1000;
          while (
            Date.now() < deadline &&
            !window.__impeccableMessages.some(message => message.source === 'impeccable-error')
          ) {
            await new Promise(resolve => setTimeout(resolve, 25));
          }
          return {
            ready: window.__impeccableMessages.some(message => message.source === 'impeccable-ready'),
            results: window.__impeccableMessages.some(message => message.source === 'impeccable-results'),
            errors: window.__impeccableMessages
              .filter(message => message.source === 'impeccable-error')
              .map(message => message.message || ''),
          };
        } finally {
          HTMLCanvasElement.prototype.getContext = originalGetContext;
        }
      });
      assert.equal(result.ready, true, `expected extension ready message, got: ${JSON.stringify(result)}`);
      assert.equal(result.results, true, `expected initial sync results before async visual error, got: ${JSON.stringify(result)}`);
      assert.ok(
        result.errors.some(message => /forced visual contrast canvas failure/.test(message)),
        `expected extension visual contrast error message, got: ${JSON.stringify(result)}`,
      );
      await page.close();
    } finally {
      await browser.close().catch(() => {});
    }
  });

  it('extension mode echoes scan ids on result messages', async () => {
    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.default.launch({
      headless: true,
      args: process.env.CI ? ['--no-sandbox', '--disable-setuid-sandbox'] : [],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      await page.goto(`${baseUrl}/fixtures/antipatterns/should-pass.html`, { waitUntil: 'load' });
      const browserScript = fs.readFileSync(path.join(ROOT, 'cli/engine/detect-antipatterns-browser.js'), 'utf-8');
      await page.evaluate(() => {
        document.documentElement.dataset.impeccableExtension = 'true';
        window.__impeccableMessages = [];
        window.addEventListener('message', event => {
          if (event.source !== window || !event.data?.source?.startsWith('impeccable-')) return;
          window.__impeccableMessages.push(event.data);
        });
      });
      await page.evaluate(browserScript);
      const result = await page.evaluate(async () => {
        window.postMessage({
          source: 'impeccable-command',
          action: 'scan',
          config: { scanId: 'scan-2' },
        }, '*');
        const deadline = Date.now() + 1000;
        while (
          Date.now() < deadline &&
          !window.__impeccableMessages.some(message =>
            message.source === 'impeccable-results' &&
            message.scanId === 'scan-2'
          )
        ) {
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        const resultMessage = window.__impeccableMessages.find(message =>
          message.source === 'impeccable-results' &&
          message.scanId === 'scan-2'
        );
        return {
          ready: window.__impeccableMessages.some(message => message.source === 'impeccable-ready'),
          scanId: resultMessage?.scanId || null,
          count: resultMessage?.count ?? null,
        };
      });
      assert.equal(result.ready, true, `expected extension ready message, got: ${JSON.stringify(result)}`);
      assert.equal(result.scanId, 'scan-2', `expected scan id echo in results, got: ${JSON.stringify(result)}`);
      assert.equal(result.count, 0, `expected clean fixture to have no findings, got: ${JSON.stringify(result)}`);
      await page.close();
    } finally {
      await browser.close().catch(() => {});
    }
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

  it('browser API: async scan and detect reject instead of throwing synchronously', async () => {
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
      const result = await page.evaluate(async () => {
        const originalQuerySelectorAll = Document.prototype.querySelectorAll;
        Document.prototype.querySelectorAll = function querySelectorAll() {
          throw new Error('forced query failure');
        };
        try {
          const scan = await window.impeccableScanAsync().then(
            () => ({ state: 'resolved' }),
            error => ({ state: 'rejected', message: error?.message || String(error) }),
          );
          const detect = await window.impeccableDetectAsync().then(
            () => ({ state: 'resolved' }),
            error => ({ state: 'rejected', message: error?.message || String(error) }),
          );
          return { scan, detect };
        } finally {
          Document.prototype.querySelectorAll = originalQuerySelectorAll;
        }
      });
      assert.deepEqual(result.scan, { state: 'rejected', message: 'forced query failure' });
      assert.deepEqual(result.detect, { state: 'rejected', message: 'forced query failure' });
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
