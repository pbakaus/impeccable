#!/usr/bin/env node
/**
 * Exhaustive-ish live UI recorder for issue #150.
 *
 * Saves screenshots and DOM/computed snapshots under tmp/. It uses the same
 * shared chrome inventory exposed by live-browser.js, then walks the Svelte
 * stateful fixture through pick, Polish, variant cycling, hostile CSS, and
 * accept. Set IMPECCABLE_PARITY_AGENT=llm plus provider env to use a real LLM;
 * the default is the deterministic fixture agent for repeatable UI capture.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { chromium } from 'playwright';
import { createFakeAgent } from './agent.mjs';
import { createLlmAgent, resolveLlmAgentConfig } from './agents/llm-agent.mjs';
import { bootFixtureSession, FIXTURES_DIR, REPO_ROOT } from './session.mjs';
import {
  clickAccept,
  clickGo,
  clickNext,
  clickPrev,
  getVisibleVariant,
  installLiveQueryHelpers,
  pickElement,
  waitForBarHidden,
  waitForCycling,
  waitForHandshake,
} from './ui.mjs';
import { runPreActions } from './preactions.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(REPO_ROOT, 'tmp', 'live-ui-parity-' + new Date().toISOString().replace(/[:.]/g, '-'));
const fixtureName = process.env.IMPECCABLE_PARITY_FIXTURE || 'vite8-sveltekit-stateful';
const fixture = JSON.parse(readFileSync(join(FIXTURES_DIR, fixtureName, 'fixture.json'), 'utf-8'));

mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: process.env.IMPECCABLE_HEADED !== '1' });
let session;
try {
  const agent = await createRecorderAgent();
  session = await bootFixtureSession({
    name: fixtureName,
    fixture,
    browser,
    agent,
    wrapTarget: wrapTargetFromPickedElement,
    log: (msg) => console.log('[recorder]', msg),
  });

  const { page } = session;
  await waitForHandshake(page);
  await capture(page, '01-handshake');

  await runPreActions(page, fixture.runtime.preActions || []);
  await capture(page, '02-preactions');

  await pickElement(page, fixture.runtime.pickSelector || '[data-testid="expense-row"]');
  await capture(page, '03-configure-rest');

  await openActionPicker(page);
  await capture(page, '04-action-picker-open');
  await chooseAction(page, 'Polish');
  await capture(page, '05-polish-selected');

  await clickGo(page);
  await waitForCycling(page, 3, { timeout: process.env.IMPECCABLE_PARITY_AGENT === 'llm' ? 240_000 : 30_000 });
  await capture(page, '06-variant-1');

  await clickNext(page);
  await capture(page, '07-variant-2');

  await clickPrev(page);
  await capture(page, '08-variant-1-left');

  await clickNext(page);
  await clickNext(page);
  await capture(page, '09-variant-3');

  await injectHostileCss(page);
  await capture(page, '10-hostile-css');

  await clickAccept(page, { expectedVariant: 3 });
  await capture(page, '11-accepted-variant-3');
  await waitForBarHidden(page).catch(() => {});

  writeFileSync(join(outDir, 'summary.json'), JSON.stringify({
    fixture: fixtureName,
    outDir,
    agent: process.env.IMPECCABLE_PARITY_AGENT || 'fake',
    createdAt: new Date().toISOString(),
  }, null, 2) + '\n');
  console.log(outDir);
} finally {
  if (session) await session.teardown();
  await browser.close();
}

async function createRecorderAgent() {
  if (process.env.IMPECCABLE_PARITY_AGENT !== 'llm') return createFakeAgent();
  const config = resolveLlmAgentConfig({
    provider: process.env.IMPECCABLE_E2E_LLM_PROVIDER,
    model: process.env.IMPECCABLE_E2E_LLM_MODEL,
  });
  const agent = await createLlmAgent({ config, log: (msg) => console.log('[llm]', msg) });
  if (!agent) throw new Error(`LLM recorder requires ${config.requiredEnv}`);
  return agent;
}

async function openActionPicker(page) {
  await page.evaluate(() => {
    const bar = window.__impeccableLiveQuery('#impeccable-live-bar');
    const button = [...(bar?.querySelectorAll('button') || [])].find((btn) => /Freeform|Bolder|Quieter|Distill|Polish|Typeset|Colorize|Layout|Adapt|Animate|Delight|Overdrive/.test(btn.textContent || ''));
    button?.click();
  });
}

async function chooseAction(page, label) {
  await page.evaluate((actionLabel) => {
    const picker = window.__impeccableLiveQuery('#impeccable-live-picker');
    const button = [...(picker?.querySelectorAll('button') || [])].find((btn) => (btn.textContent || '').includes(actionLabel));
    button?.click();
  }, label);
}

async function injectHostileCss(page) {
  await page.addStyleTag({
    content: `
      button, div, input, svg, #impeccable-live-root, impeccable-live-root * {
        all: unset !important;
        display: block !important;
        color: rgb(255, 0, 255) !important;
        background: rgb(0, 255, 0) !important;
        font-family: "Comic Sans MS" !important;
        opacity: 0.33 !important;
        z-index: 1 !important;
        pointer-events: none !important;
      }
    `,
  });
}

async function capture(page, stage) {
  await installLiveQueryHelpers(page);
  const dir = join(outDir, stage);
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, 'full.png'), fullPage: true });
  const snapshot = await page.evaluate(async () => {
    const root = window.__IMPECCABLE_LIVE_CHROME_CORE__?.root?.() || window.__IMPECCABLE_LIVE_UI_ROOT__ || null;
    const ids = window.__IMPECCABLE_LIVE_CHROME_CORE__?.componentIds || [];
    const elements = {};
    for (const id of ids) {
      const el = root?.querySelector?.('#' + CSS.escape(id)) || document.getElementById(id);
      if (!el) continue;
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      elements[id] = {
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 240),
        ariaLabel: el.getAttribute('aria-label'),
        title: el.getAttribute('title'),
        dataset: { ...el.dataset },
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        computed: {
          display: cs.display,
          color: cs.color,
          backgroundColor: cs.backgroundColor,
          fontFamily: cs.fontFamily,
          opacity: cs.opacity,
          zIndex: cs.zIndex,
          pointerEvents: cs.pointerEvents,
        },
      };
    }
    return {
      url: location.href,
      shadowRoot: Boolean(document.getElementById('impeccable-live-root')?.shadowRoot),
      shadowHtml: root?.innerHTML?.slice(0, 20000) || '',
      visibleVariant: await Promise.resolve(window.__impeccableLiveQuery('#impeccable-live-bar')?.textContent?.match(/(\d+)\s*\/\s*(\d+)/)?.[0] || null),
      openCount: document.querySelector('[data-testid="open-count"]')?.textContent || null,
      mounts: window.__impeccableStatefulMounts,
      rawSvelteExpressionVisible: document.body.textContent.includes('{expenses[0].name}') || document.body.textContent.includes('{expenses[0].amount}'),
      elements,
    };
  });
  snapshot.visibleVariantIndex = await getVisibleVariant(page).catch(() => null);
  writeFileSync(join(dir, 'dom.json'), JSON.stringify(snapshot, null, 2) + '\n');
}

function wrapTargetFromPickedElement(event) {
  const element = event.element || {};
  return {
    tag: (element.tagName || 'article').toLowerCase(),
    classes: Array.isArray(element.classes) ? element.classes.join(' ') : '',
    text: element.textContent || '',
  };
}
