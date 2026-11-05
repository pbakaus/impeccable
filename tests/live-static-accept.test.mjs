/**
 * Accept on a static page with no HMR or auto-reload (issue #1310).
 *
 * `python3 -m http.server` never swaps the DOM after carbonize, so the
 * browser's own commit has to leave the accepted variant looking the way it
 * did in preview: its scoped CSS and tuned --p-* values keep applying, and
 * the original and the other variants never show, even when the user picks a
 * new element right after Accept.
 *
 * Needs Playwright Chromium and the engine binary. Run with:
 *   node --test --test-timeout=300000 tests/live-static-accept.test.mjs
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createFakeAgent } from './live-e2e/agent.mjs';
import { ENGINE_BIN, ENGINE_MISSING_MESSAGE, bootFixtureSession } from './live-e2e/session.mjs';
import {
  clickAccept,
  clickGo,
  closeTunePanel,
  cycleToVariant,
  openTunePanel,
  pickElement,
  setTuneRange,
  waitForBarHidden,
  waitForCycling,
  waitForHandshake,
} from './live-e2e/ui.mjs';

const FIXTURE_ROOT = join(dirname(fileURLToPath(import.meta.url)), 'live-e2e', 'fixtures', 'static-html');
const FIXTURE = {
  config: { files: ['index.html'], insertBefore: '</body>', commentSyntax: 'html' },
  runtime: {
    install: ['true'],
    devCommand: ['python3', '-u', '-m', 'http.server', '0', '--bind', '127.0.0.1'],
    readyPattern: 'Serving HTTP on 127\\.0\\.0\\.1 port (\\d+)',
    readyTimeoutMs: 30000,
  },
};

let browser;

before(async () => {
  if (!ENGINE_BIN) return;
  const playwright = await import('playwright');
  browser = await playwright.chromium.launch({ headless: true });
});

after(async () => {
  if (browser) await browser.close();
});

function wrapTarget(event) {
  const element = event.element || {};
  return {
    tag: String(element.tagName || 'h1').toLowerCase(),
    classes: (element.classes || []).join(' '),
    ...(element.textContent ? { text: String(element.textContent).trim() } : {}),
  };
}

const visibleCount = (page, selector) => page.evaluate(
  (sel) => [...document.querySelectorAll(sel)].filter((el) => el.getClientRects().length > 0).length,
  selector,
);
const computed = (page, selector, prop) => page.evaluate(
  ([sel, p]) => {
    const el = [...document.querySelectorAll(sel)].find((e) => e.getClientRects().length > 0);
    return el ? getComputedStyle(el)[p] : null;
  },
  [selector, prop],
);

describe('accept on a static page', () => {
  it('keeps the accepted variant styled and the others hidden', async (t) => {
    if (!ENGINE_BIN) { t.skip(ENGINE_MISSING_MESSAGE); return; }
    const session = await bootFixtureSession({
      name: 'static-html',
      fixture: FIXTURE,
      fixtureRoot: FIXTURE_ROOT,
      browser,
      agent: createFakeAgent(),
      wrapTarget,
      log: (msg) => t.diagnostic(msg),
    });
    const { page, teardown } = session;
    try {
      await waitForHandshake(page);

      // Variant 3 styles the title with @scope rules: weight 600 + uppercase.
      await pickElement(page, 'h1.hero-title');
      await clickGo(page);
      await waitForCycling(page, 3);
      await cycleToVariant(page, 3, 3);
      await clickAccept(page, { expectedVariant: 3 });
      // The bar hides in the same step that drops the variant-state stylesheet.
      await waitForBarHidden(page);
      assert.equal(await page.locator('[data-impeccable-variants]').count(), 0, 'accept commits the wrapper at once');
      assert.equal(await visibleCount(page, 'h1.hero-title'), 1, 'only the accepted title renders right after accept');

      // A new interaction inside the 1.2 s fallback window.
      await page.waitForTimeout(400);
      await pickElement(page, 'p.hero-hook');
      await page.waitForTimeout(1_500);

      assert.equal(await visibleCount(page, 'h1.hero-title'), 1, 'one title after the fallback window');
      assert.equal(await computed(page, 'h1.hero-title', 'textTransform'), 'uppercase', 'scoped CSS still applies');

      // Variant 1 reads its tuned --p-lightness for the paragraph colour.
      await clickGo(page);
      await waitForCycling(page, 3);
      await cycleToVariant(page, 1, 3);
      await openTunePanel(page);
      await setTuneRange(page, 'Lightness', 0.7);
      await closeTunePanel(page);
      const tunedColor = await computed(page, 'p.hero-hook', 'color');
      await clickAccept(page, { expectedVariant: 1 });
      await page.waitForTimeout(1_500);

      assert.equal(await visibleCount(page, 'p.hero-hook'), 1, 'one paragraph after accept');
      assert.equal(await computed(page, 'p.hero-hook', 'color'), tunedColor, 'tuned values keep applying');
    } finally {
      await teardown();
    }
  });
});
