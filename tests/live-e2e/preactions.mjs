/**
 * Pre-pick page setup for live-mode E2E (modals, tabs, routes).
 *
 * Live mode's picker intercepts page clicks while pickActive is true, so these
 * actions temporarily disarm pick mode — same as a user toggling Pick off to
 * open a modal, then back on to select an element.
 */

import { installLiveQueryHelpers, waitForCycling } from './ui.mjs';

const PICK_TOGGLE = '#impeccable-live-pick-toggle';

/**
 * @param {import('playwright').Page} page
 * @param {Array<{ type: string, selector?: string, path?: string }>} actions
 */
export async function runPreActions(page, actions) {
  if (!actions?.length) return;

  await installLiveQueryHelpers(page);
  const wasActive = await page.evaluate((sel) =>
    window.__impeccableLiveQuery?.(sel)?.dataset.active === 'true',
  PICK_TOGGLE).catch(() => false);
  if (wasActive) await clickPickToggle(page, PICK_TOGGLE);

  try {
    for (let i = 0; i < actions.length; i++) {
      const a = actions[i];
      if (a.type === 'click') {
        const next = actions[i + 1];
        if (next?.type === 'wait') {
          const alreadyVisible = await page.locator(next.selector).first().isVisible().catch(() => false);
          if (alreadyVisible) continue;
        }
        const loc = page.locator(a.selector);
        await loc.first().waitFor({ state: 'visible', timeout: 5_000 });
        await loc.first().click();
        continue;
      }
      if (a.type === 'goto') {
        const target = new URL(a.path, page.url()).href;
        await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 10_000 });
        continue;
      }
      if (a.type === 'wait') {
        await page.waitForSelector(a.selector, { timeout: 5_000 });
        continue;
      }
      throw new Error(`unknown preAction type: ${a.type}`);
    }
  } finally {
    if (wasActive) {
      const isActive = await page.evaluate((sel) =>
        window.__impeccableLiveQuery?.(sel)?.dataset.active === 'true',
      PICK_TOGGLE).catch(() => false);
      if (!isActive) await clickPickToggle(page, PICK_TOGGLE);
    }
  }
}

async function clickPickToggle(page, selector) {
  await installLiveQueryHelpers(page);
  try {
    await page.locator(selector).click({ timeout: 5_000 });
    return;
  } catch (err) {
    const clicked = await page.evaluate((sel) => {
      const btn = window.__impeccableLiveQuery(sel);
      if (!btn) return false;
      btn.click();
      return true;
    }, selector);
    if (!clicked) throw err;
  }
}

/**
 * Wait for CYCLING with the same recovery paths live mode expects:
 * retrace preActions when conditional UI closed, reload when LLM + HMR lag.
 *
 * @param {import('playwright').Page} page
 * @param {number} expectedCount
 * @param {{ agentMode?: string, preActions?: object[], log?: (msg: string) => void }} opts
 */
export async function waitForCyclingRobust(page, expectedCount, opts = {}) {
  const agentMode = opts.agentMode || 'fake';
  const preActions = opts.preActions;
  const log = opts.log || (() => {});
  const firstPassTimeoutMs = agentMode === 'llm' ? 90_000 : 5_000;
  const finalTimeoutMs = agentMode === 'llm' ? 90_000 : 30_000;

  if (preActions?.length) {
    try {
      await waitForCycling(page, expectedCount, { timeout: firstPassTimeoutMs });
      return;
    } catch {
      log(`Cycling not reached in ${firstPassTimeoutMs}ms — retracing preActions`);
      await runPreActions(page, preActions);
    }
  }

  try {
    await waitForCycling(page, expectedCount, { timeout: finalTimeoutMs });
    return;
  } catch (firstErr) {
    if (process.env.IMPECCABLE_E2E_DEBUG) {
      firstErr.message += '\n\n--- live UI snapshot ---\n' + JSON.stringify(await liveUiSnapshot(page), null, 2);
    }
    if (agentMode !== 'llm') throw firstErr;
  }

  log('Cycling not reached after LLM generate — reloading to pick up HMR');
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
  await installLiveQueryHelpers(page);
  if (preActions?.length) await runPreActions(page, preActions);
  await waitForCycling(page, expectedCount, { timeout: 60_000 });
}

async function liveUiSnapshot(page) {
  return page.evaluate(() => {
    const query = window.__impeccableLiveQuery || ((sel) => document.querySelector(sel));
    const root = window.__IMPECCABLE_LIVE_CHROME_CORE__?.root?.() || window.__IMPECCABLE_LIVE_UI_ROOT__ || null;
    const bar = query('#impeccable-live-bar');
    const toast = query('#impeccable-live-toast');
    const wrapper = document.querySelector('[data-impeccable-variants]');
    return {
      href: location.href,
      liveInit: window.__IMPECCABLE_LIVE_INIT__,
      adapter: window.__IMPECCABLE_LIVE_ADAPTER__,
      hasShadowRoot: Boolean(document.getElementById('impeccable-live-root')?.shadowRoot),
      rootText: root?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 500) || null,
      bar: bar ? { display: bar.style.display, text: bar.textContent } : null,
      toast: toast ? toast.textContent : null,
      wrapper: wrapper ? { preview: wrapper.dataset.impeccablePreview, count: wrapper.dataset.impeccableVariantCount, html: wrapper.outerHTML.slice(0, 800) } : null,
      debugState: window.__IMPECCABLE_LIVE_CHROME_CORE__?.debugState?.() || null,
      storage: localStorage.getItem('impeccable-live-session'),
      scripts: document.querySelectorAll('script[data-impeccable-live-script]').length,
      consoleHint: 'See page console errors captured by the test session.',
    };
  }).catch((err) => ({ error: err.message }));
}
