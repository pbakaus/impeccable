/**
 * Pre-pick page setup for live-mode E2E (modals, tabs, routes).
 *
 * Live mode's picker intercepts page clicks while pickActive is true, so these
 * actions temporarily disarm pick mode — same as a user toggling Pick off to
 * open a modal, then back on to select an element.
 */

import { waitForCycling } from './ui.mjs';

const PICK_TOGGLE = '#impeccable-live-pick-toggle';

/**
 * @param {import('playwright').Page} page
 * @param {Array<{ type: string, selector?: string, path?: string }>} actions
 */
export async function runPreActions(page, actions) {
  if (!actions?.length) return;

  const pickerToggle = await page.$(PICK_TOGGLE);
  const wasActive = pickerToggle
    ? await pickerToggle.evaluate((el) => el.dataset.active === 'true')
    : false;
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
      const after = await page.$(PICK_TOGGLE);
      if (after) {
        const isActive = await after.evaluate((el) => el.dataset.active === 'true');
        if (!isActive) await clickPickToggle(page, PICK_TOGGLE);
      }
    }
  }
}

async function clickPickToggle(page, selector) {
  try {
    await page.locator(selector).click({ timeout: 5_000 });
    return;
  } catch (err) {
    const clicked = await page.evaluate((sel) => {
      const btn = document.querySelector(sel);
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
    if (agentMode !== 'llm') throw firstErr;
  }

  log('Cycling not reached after LLM generate — reloading to pick up HMR');
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
  if (preActions?.length) await runPreActions(page, preActions);
  await waitForCycling(page, expectedCount, { timeout: 60_000 });
}
