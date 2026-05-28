/**
 * Steer-bar smoke helpers for live-mode E2E.
 *
 * Exercises the lightweight page-level chat path: browser POST steer → agent
 * poll → steer_done SSE → Steer bar unlock. Runs before the heavier
 * pick → Go → cycle → accept chain in each fixture.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { findSteerTargetFile, STEER_MARKER_ATTR } from './agent.mjs';
import { submitSteer, waitForSteerDomMarker, waitForSteerLocked, waitForSteerUnlocked } from './ui.mjs';

export const DEFAULT_STEER_MESSAGE = 'steer-e2e mark hero';

export function resolveSteerSourceFile(tmp, fixture) {
  const steerCfg = fixture.runtime?.steer || {};
  if (steerCfg.sourceFile) return join(tmp, steerCfg.sourceFile);
  const target = steerCfg.target || { classes: 'hero-title', tag: 'h1' };
  return findSteerTargetFile(tmp, target);
}

/**
 * @param {import('playwright').Page} page
 * @param {string} tmp
 * @param {object} fixture
 * @param {(msg: string) => void} [log]
 * @param {{ unlockTimeoutMs?: number, selectorTimeoutMs?: number, runPreActions?: Function }=} opts
 */
export async function runSteerSmoke(page, tmp, fixture, log = () => {}, opts = {}) {
  if (fixture.runtime?.steer === false) {
    log('steer skipped (runtime.steer === false)');
    return;
  }

  const unlockTimeoutMs = opts.unlockTimeoutMs ?? 15_000;
  const selectorTimeoutMs = opts.selectorTimeoutMs ?? 20_000;
  const runPreActionsFn = opts.runPreActions;

  const steerCfg = fixture.runtime?.steer || {};
  const message = steerCfg.message || DEFAULT_STEER_MESSAGE;
  const expectSelector = steerCfg.expectSelector || `h1.hero-title[${STEER_MARKER_ATTR}]`;
  const sourceNeedle = steerCfg.expectSourceContains || STEER_MARKER_ATTR;
  const revealActions = steerCfg.preActions ?? fixture.runtime?.preActions;

  log(`Steer: submitting ${JSON.stringify(message)}`);
  await submitSteer(page, message);
  await waitForSteerLocked(page);
  log('Steer: locked (processing)');
  await waitForSteerUnlocked(page, { timeout: unlockTimeoutMs });
  log('Steer: unlocked');

  const sourceFile = resolveSteerSourceFile(tmp, fixture);
  const waitForSource = async () => {
    const deadline = Date.now() + selectorTimeoutMs;
    while (Date.now() < deadline) {
      const source = readFileSync(sourceFile, 'utf-8');
      if (source.includes(sourceNeedle)) return source;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(
      `steer marker missing from ${sourceFile} after ${selectorTimeoutMs}ms (expected ${JSON.stringify(sourceNeedle)})`,
    );
  };
  await waitForSource();
  log('Steer: source marker present');

  if (steerCfg.expectDom === false) {
    log('Steer: skipping DOM assertion (steer.expectDom === false)');
    return;
  }

  const assertDom = async () => {
    if (revealActions?.length && runPreActionsFn) {
      log(`Steer: revealing hero via ${revealActions.length} preAction(s)`);
      await runPreActionsFn(page, revealActions);
    }
    await waitForSteerDomMarker(page, expectSelector, { timeout: selectorTimeoutMs });
  };

  try {
    await assertDom();
  } catch (firstErr) {
    log('Steer: DOM marker not visible — reloading and retrying after HMR');
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
    try {
      await assertDom();
    } catch {
      throw firstErr;
    }
  }
  log('Steer: DOM marker visible');
}
