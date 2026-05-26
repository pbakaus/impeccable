import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

import { runAgentLoop } from './live-e2e/agent.mjs';
import { createLlmAgent, resolveLlmAgentConfig } from './live-e2e/agents/llm-agent.mjs';
import {
  assertApplyDockVisible,
  clickAccept,
  clickApplyEdits,
  clickEditCopy,
  clickGo,
  clickSaveEdit,
  pickElement,
  waitForBarHidden,
  waitForApplyDockHidden,
  waitForCycling,
  waitForHandshake,
} from './live-e2e/ui.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const SCRIPTS_DIR = join(REPO_ROOT, 'skill', 'scripts');
const REAL_BROWSER_ENABLED = process.env.IMPECCABLE_REAL_BROWSER_LLM === '1';
const BAR_ID = '#impeccable-live-bar';
const GLOBAL_BAR_ID = '#impeccable-live-global-bar';
const PICK_TOGGLE_ID = '#impeccable-live-pick-toggle';
const H1_SELECTOR = 'h1.hero-title-combined';
const TAGLINE_SELECTOR = 'p.hero-tagline-combined';
const HOOK_SELECTOR = 'p.hero-hook-text--full';
const INCLUDED_TITLE_SELECTOR = '.hero-included-title';
const INCLUDED_ITEM_SELECTOR = '.hero-included-items span:first-child';
const CTA_SELECTOR = '.hero-cta-combined';
const TYPOGRAPHY_LABEL_SELECTOR = '.foundation-grid .foundation-column:nth-child(1) .foundation-card-label';
const TYPOGRAPHY_COUNT_SELECTOR = '.foundation-grid .foundation-column:nth-child(1) .foundation-card-count';
const RESPONSIVE_LABEL_SELECTOR = '.foundation-grid .foundation-column:nth-child(4) .foundation-card-label';
const RESPONSIVE_COUNT_SELECTOR = '.foundation-grid .foundation-column:nth-child(4) .foundation-card-count';
const INDEX_ASTRO = 'site/pages/index.astro';
const DATA_JS = 'site/scripts/data.js';
const MAIN_CSS = 'site/styles/main.css';
const LONG_HOOK = "Great design prompts require design vocabulary. Most people don't have it. Impeccable teaches your AI deep design knowledge and gives you 23 commands to steer the result.";
const MANUAL_EDITS = [
  { selector: H1_SELECTOR, original: 'Impeccable', next: 'Impeccable WOWO' },
  { selector: TAGLINE_SELECTOR, original: 'Design fluency for AI harnesses', next: 'Design fluency for AI harnesses OOOO' },
  { selector: HOOK_SELECTOR, original: LONG_HOOK, next: `${LONG_HOOK}UUUUUU` },
  { selector: INCLUDED_TITLE_SELECTOR, original: "What's included", next: "What's includedYYYY" },
  {
    selector: INCLUDED_ITEM_SELECTOR,
    original: 'Impeccable agent skill with 23 design commands',
    next: 'Impeccable agent skill with 23 design commands HHH',
    editOriginal: ' agent skill with 23 design commands',
    editNext: ' agent skill with 23 design commands HHH',
  },
  { selector: CTA_SELECTOR, original: 'Get Started', next: 'Get Started YESSS' },
  { selector: TYPOGRAPHY_LABEL_SELECTOR, original: 'Typography', next: 'TypoXXX' },
  { selector: TYPOGRAPHY_COUNT_SELECTOR, original: '33', next: '0033' },
  { selector: RESPONSIVE_LABEL_SELECTOR, original: 'Responsive', next: 'RespoXXX' },
  { selector: RESPONSIVE_COUNT_SELECTOR, original: '23', next: 'TT33' },
];

const cleanupFns = [];

afterEach(async () => {
  while (cleanupFns.length) {
    const fn = cleanupFns.pop();
    try {
      await fn();
    } catch {
      // Best-effort cleanup; the test body reports the real failure.
    }
  }
});

describe('real browser LLM live manual edit flow', () => {
  it('visibly applies a 10-leaf manual batch, accepts a Go variant, then reverts the batch through the real browser', async (t) => {
    if (!REAL_BROWSER_ENABLED) {
      t.skip('set IMPECCABLE_REAL_BROWSER_LLM=1 to run the real-app browser+LLM flow');
      return;
    }

    const snapshots = snapshotFiles([
      INDEX_ASTRO,
      'site/layouts/Base.astro',
      DATA_JS,
      MAIN_CSS,
      '.impeccable/live/pending-manual-edits.json',
      '.impeccable/live/server.json',
    ]);
    cleanupFns.push(() => restoreFiles(snapshots));
    cleanupFns.push(() => discardManualEditBuffer());
    cleanupFns.push(() => rmSync(join(REPO_ROOT, '.impeccable/live/manual-edit-evidence'), { recursive: true, force: true }));

    stopLiveServer();
    discardManualEditBuffer();
    removeLiveInjection();

    const llmConfig = resolveLlmAgentConfig({
      provider: process.env.IMPECCABLE_E2E_LLM_PROVIDER,
      model: process.env.IMPECCABLE_E2E_LLM_MODEL,
    });
    const agent = await createLlmAgent({ config: llmConfig, log: (msg) => t.diagnostic('[llm] ' + msg) });
    if (!agent) {
      t.skip(`missing API key for ${llmConfig.provider}; cannot run real LLM smoke`);
      return;
    }
    t.diagnostic(`Using LLM agent provider=${llmConfig.provider} model=${llmConfig.model}`);

    const live = startLiveServer();
    cleanupFns.push(() => stopLiveServer());
    runInject(live.port);

    const dev = startRepoDevServer();
    cleanupFns.push(() => stopDevServer(dev.child));
    const { port: devPort } = await dev.ready;
    t.diagnostic(`dev server ready on ${devPort}; live server on ${live.port}`);

    const abort = new AbortController();
    const agentDone = runAgentLoop({
      tmp: REPO_ROOT,
      scriptsDir: SCRIPTS_DIR,
      port: live.port,
      token: live.token,
      agent,
      signal: abort.signal,
      log: (msg) => t.diagnostic('[agent] ' + msg),
    });
    cleanupFns.push(async () => {
      abort.abort();
      await agentDone.catch(() => {});
    });

    const userDataDir = mkdtempSync(join(tmpdir(), 'impeccable-real-browser-'));
    cleanupFns.push(() => rmSync(userDataDir, { recursive: true, force: true }));
    const slowMo = Number(process.env.IMPECCABLE_REAL_BROWSER_SLOWMO_MS || 250);
    const browserOptions = {
      headless: process.env.IMPECCABLE_REAL_BROWSER_HEADLESS === '1',
      slowMo: Number.isFinite(slowMo) ? slowMo : 250,
      viewport: { width: 1440, height: 900 },
    };
    if (process.env.IMPECCABLE_REAL_BROWSER_CHANNEL) {
      browserOptions.channel = process.env.IMPECCABLE_REAL_BROWSER_CHANNEL;
    }
    const ctx = await chromium.launchPersistentContext(userDataDir, browserOptions);
    cleanupFns.push(() => ctx.close());

    const page = await ctx.newPage();
    const appUrl = `http://127.0.0.1:${devPort}`;
    await warmDevServerPage(page, appUrl);

    const consoleErrors = [];
    page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push('console.error: ' + msg.text());
    });

    await hideAstroDevToolbar(page);
    await waitForHandshake(page);
    await waitForBrowserTexts(page, MANUAL_EDITS.map(({ selector, original }) => ({ selector, text: original })));

    await stageManualEdits(page, MANUAL_EDITS, 'next');
    await assertApplyDockVisible(page, MANUAL_EDITS.length, { timeout: 10_000 });
    await clickApplyEdits(page);
    await waitForApplyDockHidden(page, { timeout: 300_000 });
    await waitForPendingManualEditCount(0, { timeout: 300_000 });
    await waitForBrowserTexts(page, MANUAL_EDITS.map(({ selector, next }) => ({ selector, text: next })), { timeout: 120_000 });
    assert.deepEqual(consoleErrors, [], 'real browser console should stay clean after manual Apply');

    await page.waitForTimeout(30_000);
    await waitForBrowserTexts(page, MANUAL_EDITS.map(({ selector, next }) => ({ selector, text: next })));
    assertManualSourceApplied();

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
    await hideAstroDevToolbar(page);
    await waitForHandshake(page);
    await waitForBrowserTexts(page, MANUAL_EDITS.map(({ selector, next }) => ({ selector, text: next })));

    const sourceBeforeGo = readSourceBundle([INDEX_ASTRO, MAIN_CSS]);
    await pickElement(page, H1_SELECTOR, { resetPickMode: true });
    await clickGo(page);
    await waitForCycling(page, 3, { timeout: 240_000 });
    await clickAccept(page, { expectedVariant: 1 });
    await waitForBarHidden(page, { timeout: 120_000 });
    await page.waitForTimeout(30_000);

    await waitForBrowserTexts(page, [{ selector: H1_SELECTOR, text: 'Impeccable WOWO', contains: true }]);
    const sourceAfterGo = readSourceBundle([INDEX_ASTRO, MAIN_CSS]);
    assert.notEqual(sourceAfterGo, sourceBeforeGo, 'Go Accept should persist a real source change');
    assert.match(sourceAfterGo, /Impeccable(?:\s|<[^>]+>)*WOWO/);
    assertNoRuntimeLeakage(readFileSync(join(REPO_ROOT, INDEX_ASTRO), 'utf-8'));

    await stageManualEdits(page, MANUAL_EDITS, 'original');
    await assertApplyDockVisible(page, MANUAL_EDITS.length, { timeout: 10_000 });
    await clickApplyEdits(page);
    await waitForApplyDockHidden(page, { timeout: 300_000 });
    await waitForPendingManualEditCount(0, { timeout: 300_000 });
    await waitForBrowserTexts(page, MANUAL_EDITS.map(({ selector, original }) => ({ selector, text: original })), { timeout: 120_000 });

    await page.waitForTimeout(30_000);
    await waitForBrowserTexts(page, MANUAL_EDITS.map(({ selector, original }) => ({ selector, text: original })));
    assertManualSourceReverted();

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
    await hideAstroDevToolbar(page);
    await waitForHandshake(page);
    await waitForBrowserTexts(page, MANUAL_EDITS.map(({ selector, original }) => ({ selector, text: original })));

    assert.equal(readPendingManualEditCount(), 0, 'Apply stash should be empty after successful real-app Apply and revert');
    assert.deepEqual(consoleErrors, [], 'real browser console should stay clean through the full flow');
  });
});

async function stageManualEdits(page, edits, targetKey) {
  const groups = [
    { pickSelector: '.hero-combined-left', edits: edits.slice(0, 6) },
    { pickSelector: '.foundation-grid .foundation-column:nth-child(1) .foundation-card', edits: edits.slice(6, 8) },
    { pickSelector: '.foundation-grid .foundation-column:nth-child(4) .foundation-card', edits: edits.slice(8) },
  ];
  let stagedCount = 0;
  for (const group of groups) {
    await pickFreshElement(page, group.pickSelector);
    await clickEditCopy(page);
    for (const edit of group.edits) {
      await fillEditableByText(page, edit, targetKey);
      stagedCount++;
    }
    await clickSaveEdit(page);
    await assertApplyDockVisible(page, stagedCount, { timeout: 10_000 });
  }
}

async function pickFreshElement(page, selector) {
  await resetPickerToFresh(page);
  const target = page.locator(selector).first();
  await target.scrollIntoViewIfNeeded({ timeout: 10_000 });
  await hideLiveAnnotation(page);
  await target.hover({ timeout: 5_000 });
  await page.waitForTimeout(100);
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    (barSel) => {
      const bar = document.querySelector(barSel);
      if (!bar || bar.style.display === 'none') return false;
      return [...bar.querySelectorAll('button')].some((button) => /Go\b/.test(button.textContent || ''));
    },
    BAR_ID,
    { timeout: 5_000 },
  );
}

async function resetPickerToFresh(page) {
  await hideAstroDevToolbar(page);
  await page.waitForSelector(GLOBAL_BAR_ID, { timeout: 5_000 });
  const active = await page
    .locator(PICK_TOGGLE_ID)
    .evaluate((el) => el.dataset.active === 'true')
    .catch(() => false);
  if (active) {
    await page.locator(PICK_TOGGLE_ID).click({ timeout: 5_000, force: true });
    await page.waitForFunction(
      (sel) => document.querySelector(sel)?.dataset.active !== 'true',
      PICK_TOGGLE_ID,
      { timeout: 5_000 },
    );
  }
  await page.locator(PICK_TOGGLE_ID).click({ timeout: 5_000, force: true });
  await page.waitForFunction(
    (sel) => document.querySelector(sel)?.dataset.active === 'true',
    PICK_TOGGLE_ID,
    { timeout: 5_000 },
  );
  await page.waitForTimeout(100);
}

async function hideAstroDevToolbar(page) {
  await page.addStyleTag({
    content: 'astro-dev-toolbar{display:none!important;pointer-events:none!important;}',
  }).catch(() => {});
  await page.evaluate(() => {
    for (const toolbar of document.querySelectorAll('astro-dev-toolbar')) {
      toolbar.style.display = 'none';
      toolbar.style.pointerEvents = 'none';
    }
  }).catch(() => {});
}

async function hideLiveAnnotation(page) {
  await page.evaluate(() => {
    const annot = document.querySelector('#impeccable-live-annot');
    if (annot) annot.style.display = 'none';
  }).catch(() => {});
}

async function fillEditableByText(page, edit, targetKey) {
  const currentText = targetKey === 'next'
    ? (edit.editOriginal || edit.original)
    : (edit.editNext || edit.next);
  const replacementText = targetKey === 'next'
    ? (edit.editNext || edit.next)
    : (edit.editOriginal || edit.original);
  const editable = page
    .locator('[data-impeccable-editable="true"]')
    .filter({ hasText: currentText.trim() })
    .first();
  if (await editable.count()) {
    await editable.click({ timeout: 5_000 });
    await editable.fill(replacementText, { timeout: 5_000 });
    return;
  }
  const rows = await page.locator('[data-impeccable-editable="true"]').evaluateAll((nodes) =>
    nodes.map((node) => ({
      original: node.getAttribute('data-impeccable-original-text'),
      text: node.textContent,
    }))
  ).catch(() => []);
  throw new Error(`Could not find editable text leaf for ${edit.selector}; tried ${JSON.stringify(currentText)}. Editable rows: ${JSON.stringify(rows)}`);
}

async function waitForBrowserTexts(page, expectations, { timeout = 30_000 } = {}) {
  for (const expectation of expectations) {
    await page.locator(expectation.selector).first().waitFor({ state: 'visible', timeout });
    try {
      await page.waitForFunction(
        ({ selector, text, contains }) => {
          const node = document.querySelector(selector);
          const actual = (node?.textContent || '').replace(/\s+/g, ' ').trim();
          return contains ? actual.includes(text) : actual === text;
        },
        expectation,
        { timeout },
      );
    } catch (err) {
      const actual = await page.locator(expectation.selector).first().textContent({ timeout: 1_000 }).catch(() => null);
      throw new Error(`Timed out waiting for ${expectation.selector} to ${expectation.contains ? 'contain' : 'equal'} ${JSON.stringify(expectation.text)}; actual=${JSON.stringify(normalizeText(actual))}; ${err.message}`);
    }
  }
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

async function waitForPendingManualEditCount(expected, { timeout = 10_000 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (readPendingManualEditCount() === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.equal(readPendingManualEditCount(), expected, 'pending manual edit count');
}

async function warmDevServerPage(page, url) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const outdatedOptimizeDeps = [];
    const outdatedConsoleErrors = [];
    const onResponse = (response) => {
      if (response.status() === 504 && /Outdated Optimize Dep/i.test(response.statusText())) {
        outdatedOptimizeDeps.push(response.url());
      }
    };
    const onConsole = (msg) => {
      if (msg.type() === 'error' && /Outdated Optimize Dep/i.test(msg.text())) {
        outdatedConsoleErrors.push(msg.text());
      }
    };
    page.on('response', onResponse);
    page.on('console', onConsole);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    page.off('response', onResponse);
    page.off('console', onConsole);
    if (outdatedOptimizeDeps.length === 0 && outdatedConsoleErrors.length === 0) return;
    await page.waitForTimeout(1_500);
  }
  throw new Error('dev server kept returning Vite Outdated Optimize Dep responses during warmup');
}

function assertManualSourceApplied() {
  const index = readFileSync(join(REPO_ROOT, INDEX_ASTRO), 'utf-8');
  const data = readFileSync(join(REPO_ROOT, DATA_JS), 'utf-8');

  assert.match(index, /<h1[^>]*>Impeccable WOWO<\/h1>/);
  assert.match(index, /Design fluency for AI harnesses OOOO/);
  assert.match(index, new RegExp(escapeRegExp(`${LONG_HOOK}UUUUUU`)));
  assert.match(index, /What's includedYYYY/);
  assert.match(index, /<span><em>Impeccable<\/em> agent skill with 23 design commands HHH<\/span>/);
  assert.match(index, /Get Started YESSS/);
  assert.match(data, /area:\s*['"]TypoXXX['"]/);
  assert.match(data, /['"]TypoXXX['"]:\s*['"]0033['"]/);
  assert.match(data, /area:\s*['"]RespoXXX['"]/);
  assert.match(data, /['"]RespoXXX['"]:\s*['"]TT33['"]/);
  assert.doesNotMatch(data, /area:\s*['"]Typography['"]/);
  assert.doesNotMatch(data, /area:\s*['"]Responsive['"]/);
}

function assertManualSourceReverted() {
  const index = readFileSync(join(REPO_ROOT, INDEX_ASTRO), 'utf-8');
  const data = readFileSync(join(REPO_ROOT, DATA_JS), 'utf-8');

  for (const token of ['WOWO', 'OOOO', 'UUUUUU', 'YYYY', 'HHH', 'YESSS']) {
    assert.doesNotMatch(index, new RegExp(escapeRegExp(token)));
  }
  for (const token of ['TypoXXX', '0033', 'RespoXXX', 'TT33']) {
    assert.doesNotMatch(data, new RegExp(escapeRegExp(token)));
  }
  assert.match(index, /Impeccable/);
  assert.match(index, /Design fluency for AI harnesses/);
  assert.match(index, new RegExp(escapeRegExp(LONG_HOOK)));
  assert.match(index, /What's included/);
  assert.match(index, /<em>Impeccable<\/em> agent skill with 23 design commands/);
  assert.match(index, /Get Started/);
  assert.match(data, /area:\s*['"]Typography['"]/);
  assert.match(data, /['"]Typography['"]:\s*33/);
  assert.match(data, /area:\s*['"]Responsive['"]/);
  assert.match(data, /['"]Responsive['"]:\s*23/);
}

function assertNoRuntimeLeakage(source) {
  assert.doesNotMatch(source, /impeccable-live-start/);
  assert.doesNotMatch(source, /impeccable-variants-start/);
  assert.doesNotMatch(source, /contenteditable/);
  assert.doesNotMatch(source, /data-impeccable-/);
}

function readSourceBundle(files) {
  return files.map((file) => `--- ${file} ---\n${readFileSync(join(REPO_ROOT, file), 'utf-8')}`).join('\n');
}

function startLiveServer() {
  const out = execFileSync(process.execPath, [join(SCRIPTS_DIR, 'live-server.mjs'), '--background'], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
  });
  const jsonLine = out.trim().split('\n').filter(Boolean).pop();
  const info = JSON.parse(jsonLine);
  if (!info.port || !info.pid || !info.token) {
    throw new Error('live-server --background returned unexpected payload: ' + jsonLine);
  }
  return info;
}

function stopLiveServer() {
  try {
    execFileSync(process.execPath, [join(SCRIPTS_DIR, 'live-server.mjs'), 'stop'], {
      cwd: REPO_ROOT,
      stdio: 'ignore',
    });
  } catch {
    // already stopped
  }
}

function runInject(port) {
  const out = execFileSync(process.execPath, [join(SCRIPTS_DIR, 'live-inject.mjs'), '--port', String(port)], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
  });
  const result = JSON.parse(out.trim().split('\n').filter(Boolean).pop());
  if (!result.ok) throw new Error('live-inject failed: ' + JSON.stringify(result));
  return result;
}

function removeLiveInjection() {
  try {
    execFileSync(process.execPath, [join(SCRIPTS_DIR, 'live-inject.mjs'), '--remove'], {
      cwd: REPO_ROOT,
      stdio: 'ignore',
    });
  } catch {
    // best effort
  }
}

function startRepoDevServer() {
  const child = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--force'], {
    cwd: REPO_ROOT,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  const log = [];
  const capture = (chunk) => {
    const s = chunk.toString();
    log.push(s);
    if (log.length > 200) log.shift();
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('repo dev server ready timeout. Tail:\n' + log.join('')));
    }, 120_000);
    const check = (chunk) => {
      const text = chunk.toString();
      const match = text.match(/http:\/\/(?:localhost|127\.0\.0\.1):(\d+)/);
      if (!match) return;
      clearTimeout(timeout);
      resolve({ port: Number(match[1]) });
    };
    child.stdout.on('data', check);
    child.stderr.on('data', check);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`repo dev server exited before ready (code=${code}). Tail:\n${log.join('')}`));
    });
  });
  return { child, ready };
}

async function stopDevServer(child) {
  if (!child || child.killed) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    if (!child.killed) child.kill('SIGKILL');
  }
}

function snapshotFiles(files) {
  return files.map((file) => {
    const abs = join(REPO_ROOT, file);
    return {
      file,
      exists: existsSync(abs),
      body: existsSync(abs) ? readFileSync(abs, 'utf-8') : null,
    };
  });
}

function restoreFiles(snapshots) {
  for (const item of snapshots) {
    const abs = join(REPO_ROOT, item.file);
    if (!item.exists) {
      rmSync(abs, { force: true });
      continue;
    }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, item.body);
  }
}

function discardManualEditBuffer() {
  try {
    execFileSync(process.execPath, [join(SCRIPTS_DIR, 'live-discard-manual-edits.mjs')], {
      cwd: REPO_ROOT,
      stdio: 'ignore',
    });
  } catch {
    // best effort
  }
}

function readPendingManualEditCount() {
  const p = join(REPO_ROOT, '.impeccable/live/pending-manual-edits.json');
  if (!existsSync(p)) return 0;
  const data = JSON.parse(readFileSync(p, 'utf-8'));
  return (data.entries || []).reduce((sum, entry) => sum + (entry.ops?.length || 0), 0);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
