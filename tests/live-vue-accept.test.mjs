import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { bootFixtureSession } from './live-e2e/session.mjs';
import { waitForHandshake, pickElement, clickGo, waitForCycling, openTunePanel, setTuneRange, closeTunePanel, clickAccept, waitForBarHidden, clickExitLiveMode } from './live-e2e/ui.mjs';

test('Vue preview → Tune → Accept → Reload preserves style and behavior', { timeout: 240000 }, async (t) => {
  const browser = await chromium.launch({ headless: true, ...(process.env.IMPECCABLE_TEST_CHROME ? { executablePath: process.env.IMPECCABLE_TEST_CHROME } : {}) });
  const fixtureRoot = join(process.cwd(), 'tests/fixtures/live-vue-accept/app');
  const fixture = JSON.parse(readFileSync(join(fixtureRoot, 'fixture.json')));
  let session;
  let cleanupPromise;
  const cleanup = () => cleanupPromise ||= (async () => {
    if (session) await session.teardown();
    await browser.close();
  })();
  t.after(cleanup);
  try {
    session = await bootFixtureSession({ name: 'vite-vue-stateful', fixture, fixtureRoot, browser,
      wrapTarget: { file: 'src/App.vue', classes: 'card', tag: 'section' },
      agent: { autoRepairMountFailures: false, async generateVariants(event) {
        return { scopedCss: '', variants: Array.from({ length: event.count }, () => ({
          vueComponent: { css: '.card { width: 400px; min-height: 80px; padding: calc(var(--p-space, 8) * 1px); color: #111; background: #ffd6d6; }' },
          params: [{ id: 'space', kind: 'range', min: 4, max: 32, step: 1, default: 8, label: 'Space' }],
        })) };
      } }, log: message => t.diagnostic(message),
    });
    const { page, tmp } = session;
    await waitForHandshake(page);
    const source = readFileSync(join(tmp, 'src/App.vue'), 'utf8');
    await pickElement(page, 'section.card', { position: { x: 4, y: 4 } });
    await clickGo(page);
    await waitForCycling(page, 3);
    assert.equal(readFileSync(join(tmp, 'src/App.vue'), 'utf8'), source, 'generation must not rewrite source');
    await openTunePanel(page);
    await setTuneRange(page, 'Space', 23);
    await closeTunePanel(page);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('section.card')).paddingLeft === '23px', null, { timeout: 15000 });
    const phase = await page.evaluate(() => Object.keys(localStorage).map(key => {
      try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
    }).find(value => value?.state === 'CYCLING')?.generationPhase);
    assert.ok(phase, 'generation phase must be persisted before reload');
    await page.reload();
    await waitForHandshake(page);
    await waitForCycling(page, 3);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('section.card')).paddingLeft === '23px', null, { timeout: 15000 });
    await clickAccept(page);
    await waitForBarHidden(page);
    await page.waitForFunction(() => !document.querySelector('[data-impeccable-variants]'), null, { timeout: 15000 });
    // The picker is released as soon as accept is durable. Source promotion
    // finishes asynchronously, so DOM cleanup alone is not a write receipt.
    const deadline = Date.now() + 20000;
    while (readFileSync(join(tmp, 'src/App.vue'), 'utf8') === source && Date.now() < deadline) await delay(50);
    const accepted = readFileSync(join(tmp, 'src/App.vue'), 'utf8');
    assert.notEqual(accepted, source, 'accept must promote the selected component to source');
    await page.reload();
    await waitForHandshake(page);
    await page.waitForSelector('section.card');
    assert.equal(await page.locator('section.card').evaluate(el => getComputedStyle(el).paddingLeft), '23px');
    assert.equal(await page.locator('.unrelated').evaluate(el => getComputedStyle(el).paddingLeft), '3px');
    await clickExitLiveMode(page);
    await page.locator('section.card').click();
    await page.waitForFunction(() => document.querySelector('section.card').textContent.includes('Imports: 1'), null, { timeout: 15000 });
    assert.equal(accepted.split('<template>')[0], source.split('<template>')[0]);
    assert.equal(accepted.split('<style>')[1], source.split('<style>')[1]);
    assert.doesNotMatch(accepted, /data-impeccable-|var\(--p-/);
    const previewRoot = join(tmp, 'node_modules/.impeccable-live');
    assert.deepEqual(existsSync(previewRoot) ? readdirSync(previewRoot).filter(name => /^[a-f0-9]{8}$/.test(name)) : [], []);
    execFileSync('npm', ['run', 'build'], { cwd: tmp, stdio: 'pipe' });
  } catch (error) {
    if (session) t.diagnostic(JSON.stringify(await session.page.evaluate(() => ({
      cards: [...document.querySelectorAll('section.card')].map(el => ({ html: el.outerHTML.slice(0, 500), padding: getComputedStyle(el).paddingLeft })),
      state: window.__IMPECCABLE_LIVE_CHROME_CORE__?.debugState?.(),
    })).catch(() => null)));
    throw error;
  } finally { await cleanup(); }
});
