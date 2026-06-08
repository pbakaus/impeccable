/**
 * Focused regression guard for LLM-backed post-accept cleanup.
 *
 * This is intentionally opt-in and provider-backed: it narrows the failure
 * where the accepted source has been carbonized cleanly but the browser still
 * exposes the accepted element under stale data-impeccable runtime wrappers.
 *
 * Run with:
 *   set -a; source .env.local; set +a
 *   node --test --test-timeout=600000 tests/live-e2e-accept-cleanup-regression.test.mjs
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

import { createLlmAgent, resolveLlmAgentConfig } from './live-e2e/agents/llm-agent.mjs';
import { bootFixtureSession, FIXTURES_DIR } from './live-e2e/session.mjs';
import { runSteerSmoke } from './live-e2e/steer.mjs';
import { runPreActions, waitForCyclingRobust } from './live-e2e/preactions.mjs';
import {
  clickAccept,
  clickGo,
  clickNext,
  getVisibleVariant,
  pickElement,
  waitForHandshake,
} from './live-e2e/ui.mjs';

loadEnvLocal();

const FIXTURE_NAME = 'vite8-react-plain';
const PICK_SELECTOR = 'h1.hero-title';
const EXPECTED_VARIANTS = 3;

let playwright;
let browser;

before(async () => {
  playwright = await import('playwright');
  browser = await playwright.chromium.launch({ headless: true });
});

after(async () => {
  if (browser) await browser.close();
});

describe('live-e2e accept cleanup regression', () => {
  it('cleans accepted LLM DOM wrappers after carbonize cleanup', async (t) => {
    const fixture = readFixture(FIXTURE_NAME);
    const llmConfig = resolveLlmAgentConfig({
      provider: process.env.IMPECCABLE_E2E_LLM_PROVIDER || 'deepseek',
    });
    const agent = await createLlmAgent({
      config: llmConfig,
      log: (msg) => t.diagnostic('[llm] ' + msg),
    });
    if (!agent) {
      t.skip(`${llmConfig.provider} live E2E requires ${llmConfig.requiredEnv}`);
      return;
    }

    const session = await bootFixtureSession({
      name: FIXTURE_NAME,
      fixture,
      browser,
      agent,
      wrapTarget: wrapTargetFromPickedElement,
      log: (msg) => t.diagnostic(msg),
    });

    const { page, tmp, teardown } = session;
    try {
      t.diagnostic(`Using LLM agent (provider=${llmConfig.provider} model=${llmConfig.model})`);
      await waitForHandshake(page);

      await runSteerSmoke(page, tmp, fixture, (msg) => t.diagnostic(msg), {
        unlockTimeoutMs: 90_000,
        selectorTimeoutMs: 45_000,
        runPreActions,
      });

      t.diagnostic(`Picking ${PICK_SELECTOR}`);
      await pickElement(page, PICK_SELECTOR);
      t.diagnostic('Clicking Go');
      await clickGo(page);

      t.diagnostic(`Waiting for CYCLING state with ${EXPECTED_VARIANTS} variants`);
      await waitForCyclingRobust(page, EXPECTED_VARIANTS, {
        agentMode: 'llm',
        preActions: fixture.runtime.preActions,
        log: (msg) => t.diagnostic(msg),
      });

      const sourceFile = await locateSessionFile(tmp);
      assert.match(
        readFileSync(sourceFile, 'utf-8'),
        /data-impeccable-variants="/,
        'variant wrapper should be present before accept',
      );

      t.diagnostic('Cycling to variant 2');
      await clickNext(page);
      assert.equal(await getVisibleVariant(page), 2, 'variant 2 visible after one Next');

      t.diagnostic('Accepting variant 2');
      await clickAccept(page, { expectedVariant: 2 });

      t.diagnostic('Waiting for accept + carbonize cleanup to land in source');
      const finalSource = await waitForSourceClean(sourceFile, 30_000);
      assert.doesNotMatch(finalSource, /data-impeccable-variants="/, 'source variants wrapper removed');
      assert.doesNotMatch(finalSource, /impeccable-variants-start/, 'source variants markers removed');
      assert.doesNotMatch(finalSource, /impeccable-carbonize-start/, 'source carbonize markers removed');
      assert.doesNotMatch(finalSource, /data-impeccable-variant="/, 'source variant wrapper removed');
      assert.match(finalSource, /<h1[^>]*(class|className)="[^"]*\bhero-title\b[^"]*"/);

      await waitForAcceptedDomClean(page, PICK_SELECTOR, {
        timeoutMs: 20_000,
        sourceFile,
        finalSource,
      });
    } finally {
      await teardown();
    }
  });
});

function readFixture(name) {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name, 'fixture.json'), 'utf-8'));
}

function loadEnvLocal() {
  const envPath = join(process.cwd(), '.env.local');
  if (!existsSync(envPath)) return;
  const body = readFileSync(envPath, 'utf-8');
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = unquoteEnvValue(rawValue.trim());
  }
}

function unquoteEnvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function wrapTargetFromPickedElement(event) {
  const element = event.element || {};
  const tag = typeof element.tagName === 'string'
    ? element.tagName.trim().toLowerCase()
    : '';
  const classes = typeof element.className === 'string'
    ? element.className.trim().split(/\s+/).filter(Boolean).join(' ')
    : extractClassAttr(element.outerHTML);
  const elementId = typeof element.id === 'string' ? element.id.trim() : '';

  return {
    tag: tag || 'h1',
    ...(classes ? { classes } : {}),
    ...(elementId ? { elementId } : {}),
  };
}

function extractClassAttr(outerHTML) {
  if (typeof outerHTML !== 'string') return '';
  const match = outerHTML.match(/\sclass=(["'])(.*?)\1/);
  return match ? match[2].trim().split(/\s+/).filter(Boolean).join(' ') : '';
}

async function waitForAcceptedDomClean(page, selector, { timeoutMs, sourceFile, finalSource }) {
  try {
    await page.waitForFunction(
      (sel) => {
        const matches = [...document.querySelectorAll(sel)];
        return matches.length > 0
          && matches.every((el) => !el.closest('[data-impeccable-variants],[data-impeccable-variant],[data-impeccable-carbonize]'));
      },
      selector,
      { timeout: timeoutMs },
    );
  } catch (err) {
    const diagnostic = await collectAcceptedDomDiagnostic(page, selector);
    diagnostic.sourceFile = sourceFile;
    diagnostic.sourceWasClean = isSourceClean(finalSource);
    throw new Error(
      'accepted DOM stayed stale after clean source; diagnostic='
      + JSON.stringify(diagnostic, null, 2),
      { cause: err },
    );
  }
}

async function collectAcceptedDomDiagnostic(page, selector) {
  return page.evaluate((sel) => {
    const matches = [...document.querySelectorAll(sel)];
    const clean = matches.filter((el) => !el.closest('[data-impeccable-variants],[data-impeccable-variant],[data-impeccable-carbonize]'));
    const stale = matches.filter((el) => el.closest('[data-impeccable-variants],[data-impeccable-variant],[data-impeccable-carbonize]'));
    const local = {};
    for (const key of [
      'impeccable-live-session',
      'impeccable-live-session-handled',
      'impeccable-live-session-scroll',
    ]) {
      local[key] = localStorage.getItem(key);
    }
    return {
      cleanMatchCount: clean.length,
      staleMatchCount: stale.length,
      remainingVariantsWrapperCount: document.querySelectorAll('[data-impeccable-variants]').length,
      remainingVariantWrapperCount: document.querySelectorAll('[data-impeccable-variant]').length,
      liveBarText: document.querySelector('#impeccable-live-bar')?.textContent || '',
      localStorage: local,
      heroHtml: matches.map((el) => el.outerHTML.slice(0, 500)),
      staleAncestorHtml: stale.map((el) => {
        const ancestor = el.closest('[data-impeccable-variants],[data-impeccable-variant]');
        return ancestor ? ancestor.outerHTML.slice(0, 700) : '';
      }),
    };
  }, selector);
}

function isSourceClean(source) {
  return !source.includes('data-impeccable-variants=')
    && !source.includes('impeccable-variants-start')
    && !source.includes('impeccable-carbonize-start')
    && !source.includes('data-impeccable-variant=');
}

async function waitForSourceClean(filePath, timeoutMs) {
  const start = Date.now();
  let last = '';
  while (Date.now() - start < timeoutMs) {
    last = readFileSync(filePath, 'utf-8');
    if (isSourceClean(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`source not clean after ${timeoutMs}ms; last contents:\n${last}`);
}

async function locateSessionFile(tmp) {
  for (const file of walkSources(tmp)) {
    const body = readFileSync(file, 'utf-8');
    if (
      body.includes('data-impeccable-variants=')
      || body.includes('impeccable-carbonize-start')
      || body.includes('impeccable-variants-start')
    ) {
      return file;
    }
  }
  throw new Error('Could not locate session source file under ' + tmp);
}

function walkSources(root) {
  const results = [];
  const stack = [root];
  const skip = new Set(['node_modules', '.git', '.svelte-kit', 'dist', '.vite', 'build', '.next']);
  const exts = new Set(['.html', '.jsx', '.tsx', '.svelte', '.astro', '.vue']);
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!skip.has(entry.name)) stack.push(full);
      } else if (exts.has(extname(entry.name))) {
        results.push(full);
      }
    }
  }
  return results;
}
