import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createLlmAgent, resolveLlmAgentConfig } from './live-e2e/agents/llm-agent.mjs';
import { bootFixtureSession, FIXTURES_DIR, REPO_ROOT } from './live-e2e/session.mjs';
import { runSteerSmoke } from './live-e2e/steer.mjs';
import { runPreActions } from './live-e2e/preactions.mjs';
import {
  assertAnnotationUploadEvent,
  assertApplyDockVisible,
  clickAccept,
  clickApplyEdits,
  clickDiscard,
  clickEditCopy,
  clickExitLiveMode,
  clickGo,
  clickNext,
  clickPrev,
  clickSaveEdit,
  drawAnnotationPinAndStroke,
  editTextLeaf,
  getVisibleVariant,
  installLiveQueryHelpers,
  pickElement,
  runInsertFlow,
  runLiveChromeBottomBarSmoke,
  waitForApplyDockHidden,
  waitForBarHidden,
  waitForCycling,
  waitForHandshake,
} from './live-e2e/ui.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_NAME = 'vite8-sveltekit-stateful';
const ROUTE_FILE = 'src/routes/+page.svelte';
const LAYOUT_FILE = 'src/routes/+layout.svelte';
const APP_HTML = 'src/app.html';
const EXPECTED_INSERT_PROMPT =
  'Insert a concise muted footnote below the empty expenses card explaining that shared expenses sync automatically.';

const artifactRoot = createArtifactRoot();
let playwright;
let browser;

if (!process.env.DEEPSEEK_API_KEY) {
  throw new Error('DEEPSEEK_API_KEY is required. This Svelte adapter sweep must never fall back to fake/mock AI.');
}

describe('Svelte live adapter DeepSeek browser sweep', () => {
  before(async () => {
    playwright = await import('playwright');
    browser = await playwright.chromium.launch({ headless: true });
  });

  after(async () => {
    if (browser) await browser.close();
  });

  it('covers live chrome, replace, edit, annotations, insert, refresh recovery, accept/discard, and exit', async (t) => {
    const fixture = loadConsolidatedFixture();
    const llmConfig = resolveLlmAgentConfig({ provider: 'deepseek' });
    assert.equal(llmConfig.provider, 'deepseek');
    const agent = await createLlmAgent({
      config: llmConfig,
      log: (m) => t.diagnostic('[deepseek] ' + m),
    });
    assert.ok(agent, 'DeepSeek agent must be available');

    const session = await bootFixtureSession({
      name: FIXTURE_NAME,
      fixture,
      browser,
      agent,
      wrapTarget: wrapTargetFromPickedElement,
      log: (m) => t.diagnostic(m),
    });

    const { page, tmp, live, consoleErrors, teardown } = session;
    const evidence = createEvidenceWriter({ page, tmp, live, consoleErrors });

    try {
      await evidence.capture('00-boot');
      await assertSvelteAdapterInjection(tmp);
      await waitForHandshake(page);
      await assertShadowChrome(page);
      await assertHostileCssIsolation(page);
      await evidence.capture('01-handshake');

      await runLiveChromeBottomBarSmoke(page, {
        expectDetectMinCount: 1,
        designRawText: 'Design System: Stateful Expense System',
      });
      await evidence.capture('02-bottom-bar');

      await runSteerSmoke(page, tmp, fixture, (m) => t.diagnostic(m), {
        unlockTimeoutMs: 120_000,
        selectorTimeoutMs: 60_000,
        runPreActions,
      });
      await evidence.capture('03-steer');

      await runPreActions(page, fixture.runtime.preActions);
      await assertOpenCount(page);

      const discardSession = await runReplaceDiscardRecoveryFlow({ page, tmp, evidence });
      await evidence.capture('04-replace-discard-recovered');
      await assertDiscardedSession(tmp, discardSession.id);

      await runEditCopyFlow({ page, tmp, live, evidence });
      await evidence.capture('05-edit-copy-applied');

      await runAnnotationGenerateFlow({ page, tmp, evidence });
      await evidence.capture('06-annotation-discarded');

      const acceptedReplace = await runAcceptReplaceFlow({ page, tmp, evidence });
      await assertCompletedRealSource(tmp, acceptedReplace.id);
      await evidence.capture('07-replace-accepted');

      const acceptedInsert = await runInsertFlowWithRecovery({ page, tmp, evidence });
      await assertCompletedRealSource(tmp, acceptedInsert.id);
      await assertFinalSourceClean(tmp);
      await evidence.capture('08-insert-accepted');

      const beforeExit = await globalBarSnapshot(page);
      await clickExitLiveMode(page);
      const afterExit = await page.evaluate(() => ({
        liveInit: window.__IMPECCABLE_LIVE_INIT__,
        hasGlobalBar: Boolean(window.__impeccableLiveQuery?.('#impeccable-live-global-bar')),
      }));
      assert.ok(beforeExit.hasBar, 'global bottom bar exists before Exit');
      assert.equal(afterExit.liveInit, false, 'live init flag clears after Exit');
      assert.equal(afterExit.hasGlobalBar, false, 'global bottom bar is removed immediately after Exit');
      await evidence.capture('09-exit');

      assertNoConsoleErrors(consoleErrors);
    } catch (err) {
      await evidence.capture('failure');
      throw err;
    } finally {
      await teardown();
    }
  });
});

function loadConsolidatedFixture() {
  const fixturePath = join(FIXTURES_DIR, FIXTURE_NAME, 'fixture.json');
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8'));
  fixture.runtime = {
    styling: 'plain-css',
    install: ['npm', 'install', '--no-audit', '--no-fund', '--loglevel=error'],
    devCommand: ['npx', 'vite', 'dev', '--host', '127.0.0.1'],
    readyPattern: 'Local:\\s+https?://[^:]+:(\\d+)',
    readyTimeoutMs: 120000,
    pickSelector: "[data-testid='expense-row']",
    acceptedSourcePattern: '<article[^>]*class="[^\"]*\\bexpense-row\\b',
    preActions: [
      { type: 'click', selector: "[data-testid='add-expense']" },
      { type: 'wait', selector: "[data-testid='expense-row']" },
    ],
    stateProbe: {
      textSelector: "[data-testid='open-count']",
      expectedText: '1 offen',
      windowProperty: '__impeccableStatefulMounts',
      expectWindowUnchanged: true,
    },
    steer: {
      message: 'make the title more direct for the expense dashboard',
      sourceFile: ROUTE_FILE,
      target: { classes: 'hero-title', tag: 'h1' },
      expectSelector: 'h1.hero-title[data-impeccable-steer="e2e"]',
      expectSourceContains: 'data-impeccable-steer="e2e"',
    },
    probe: {
      expectLiveInit: true,
      expectConsoleClean: true,
    },
  };
  return fixture;
}

async function runReplaceDiscardRecoveryFlow({ page, tmp, evidence }) {
  const stateBeforeCycling = await readStateProbe(page);
  await pickElement(page, "[data-testid='expense-row']", { resetPickMode: true });
  await assertSelectedElementChrome(page);
  await selectAction(page, 'Polish');

  const sourceBefore = readFileSync(join(tmp, ROUTE_FILE), 'utf-8');
  await clickGo(page);
  await waitForVisibleCycling(page, 3, { timeout: 240_000 });
  const session = await currentSveltePreviewSession(page, tmp);
  assert.equal(session.previewMode, 'svelte-component');
  assert.match(session.previewFile, /^node_modules\/\.impeccable-live\/[^/]+\/manifest\.json$/);
  assert.ok(existsSync(join(tmp, dirname(session.previewFile), 'v1.svelte')));
  assert.ok(existsSync(join(tmp, dirname(session.previewFile), 'v2.svelte')));
  assert.ok(existsSync(join(tmp, dirname(session.previewFile), 'v3.svelte')));
  assert.equal(readFileSync(join(tmp, ROUTE_FILE), 'utf-8'), sourceBefore, 'real Svelte source is not mutated while cycling');
  await assertStateProbeUnchanged(page, stateBeforeCycling, 'variant cycling should not remount Svelte app state');

  await cycleTo(page, 2);
  await cycleTo(page, 3);
  await cycleTo(page, 2);
  await assertVariantCounter(page, 2, 3);
  await evidence.capture('replace-cycle-variant-2');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForHandshake(page);
  await assertRecoverableMessage(page, 2, 3);
  await revealExpenseRow(page);
  await waitForVisibleCycling(page, 3, { timeout: 60_000 });
  await assertVariantCounter(page, 2, 3);

  await clickDiscard(page);
  await waitForBarHidden(page);
  await page.waitForSelector("[data-testid='expense-row']", { state: 'visible', timeout: 20_000 });
  await assertNoCyclingZero(page);
  await assertNoRawSvelteExpressions(page);
  return session;
}

async function runEditCopyFlow({ page, tmp, live, evidence }) {
  await runPreActions(page, [{ type: 'click', selector: "[data-testid='add-expense']" }, { type: 'wait', selector: "[data-testid='expense-row']" }]);
  await pickElement(page, "[data-testid='expense-row']", { resetPickMode: true });
  const sourceBeforeCancel = readFileSync(join(tmp, ROUTE_FILE), 'utf-8');

  await clickEditCopy(page);
  await editTextLeaf(page, '.expense-row strong', 'Design snack cancelled');
  await clickEditBadgeAction(page, 'Cancel');
  await page.waitForFunction(
    () => !window.__impeccableLiveQuery('[data-impeccable-editable="true"]'),
    null,
    { timeout: 5_000 },
  );
  assert.equal(readFileSync(join(tmp, ROUTE_FILE), 'utf-8'), sourceBeforeCancel, 'Cancel does not mutate source');
  await assertPendingDockCount(live, 0);

  await clickEditCopy(page);
  await editTextLeaf(page, '.expense-row strong', 'Design snack staged');
  await clickSaveEdit(page);
  await assertApplyDockVisible(page, 1);
  await assertPendingDockCount(live, 1);
  await clickPendingTrash(page);
  await waitForApplyDockHidden(page);
  await assertPendingDockCount(live, 0);
  await page.waitForFunction(
    () => document.querySelector('.expense-row strong')?.textContent?.includes('Design snack'),
    null,
    { timeout: 10_000 },
  );

  await clickEditCopy(page);
  await editTextLeaf(page, '.expense-row strong', 'Design snack approved');
  await clickSaveEdit(page);
  await assertApplyDockVisible(page, 1);
  await evidence.capture('edit-pending-dock');
  await clickApplyEdits(page);
  await waitForPendingDockCleared(live, { timeout: 240_000 });
  await waitForApplyDockHidden(page, { timeout: 60_000 });
  const sourceAfter = readFileSync(join(tmp, ROUTE_FILE), 'utf-8');
  assert.match(sourceAfter, /Design snack approved/, 'DeepSeek Apply writes edited copy to source');
  assert.doesNotMatch(sourceAfter, /contenteditable|data-impeccable-editable|data-impeccable-original-text|impeccable-variants/, 'manual Apply does not leak live scaffolding');
}

async function runAnnotationGenerateFlow({ page, tmp, evidence }) {
  await pickElement(page, '.hero-title', { resetPickMode: true });
  await drawAnnotationPinAndStroke(page, { comment: 'Make the page title easier to scan' });
  await selectAction(page, 'Polish');
  await clickGo(page);
  await waitForCycling(page, 3, { timeout: 180_000 });
  const generateEvent = latestJournalEvent(tmp, (event) => event.type === 'generate' && event.screenshotPath);
  await assertAnnotationUploadEvent(generateEvent);
  assert.ok(existsSync(generateEvent.screenshotPath), 'annotation screenshot file exists');
  await clickNext(page);
  await assertVariantCounter(page, 2, 3);
  await evidence.capture('annotation-cycle');
  await clickDiscard(page);
  await waitForBarHidden(page);
}

async function runAcceptReplaceFlow({ page, tmp, evidence }) {
  await runPreActions(page, [{ type: 'click', selector: "[data-testid='add-expense']" }, { type: 'wait', selector: "[data-testid='expense-row']" }]);
  await pickElement(page, "[data-testid='expense-row']", { resetPickMode: true });
  await selectAction(page, 'Polish');
  await clickGo(page);
  await waitForVisibleCycling(page, 3, { timeout: 240_000 });
  await cycleTo(page, 3);
  const session = await currentSveltePreviewSession(page, tmp);
  await evidence.capture('replace-before-accept');
  await clickAccept(page, { expectedVariant: 3 });
  await waitForSvelteAcceptComplete(tmp, session, { timeout: 120_000 });
  await waitForBarHidden(page, { timeout: 20_000 }).catch(() => {});
  const source = readFileSync(join(tmp, ROUTE_FILE), 'utf-8');
  assert.match(source, /expense-row/, 'accepted replace stays in real Svelte source');
  assert.doesNotMatch(source, /data-impeccable-variants|impeccable-variants-start|data-impeccable-variant=/, 'accepted replace source is clean');
  assert.equal(existsSync(join(tmp, dirname(session.previewFile))), false, 'temp Svelte preview folder deleted after accept');
  return session;
}

async function runInsertFlowWithRecovery({ page, tmp, evidence }) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForHandshake(page);
  await page.waitForSelector('.empty-card', { state: 'visible', timeout: 20_000 });
  await runInsertFlow(page, {
    anchorSelector: '.empty-card',
    position: 'after',
    prompt: EXPECTED_INSERT_PROMPT,
  });
  const insertEvent = await waitForLatestJournalEvent(tmp, (event) => event.type === 'generate' && event.mode === 'insert');
  assert.equal(insertEvent.mode, 'insert');
  assert.equal(insertEvent.count, 3);
  assert.equal(insertEvent.insert?.position, 'after');
  assert.match(insertEvent.insert?.anchor?.outerHTML || '', /empty-card/);

  await waitForCycling(page, 3, { timeout: 240_000 });
  await cycleTo(page, 2);
  await cycleTo(page, 3);
  await cycleTo(page, 2);
  await cycleTo(page, 3);
  await assertVariantCounter(page, 3, 3);
  const session = await currentSveltePreviewSession(page, tmp);
  assert.equal(JSON.parse(readFileSync(join(tmp, session.previewFile), 'utf-8')).mode, 'insert');
  await evidence.capture('insert-cycle-variant-3');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForHandshake(page);
  await waitForCycling(page, 3, { timeout: 60_000 });
  await assertVariantCounter(page, 3, 3);
  await page.waitForFunction(
    () => Boolean(document.querySelector('.empty-card + *')),
    null,
    { timeout: 20_000 },
  );

  await clickAccept(page, { expectedVariant: 3 });
  await waitForSvelteAcceptComplete(tmp, session, { timeout: 120_000 });
  await waitForBarHidden(page, { timeout: 20_000 }).catch(() => {});
  const source = readFileSync(join(tmp, ROUTE_FILE), 'utf-8');
  assert.match(source, /automatisch|synchron|sync|abgeglichen|shared expenses/i, 'accepted insert content lands in real source');
  assert.doesNotMatch(source, /data-impeccable-variants|impeccable-variants-start|data-impeccable-variant=/, 'accepted insert source is clean');
  assert.equal(existsSync(join(tmp, dirname(session.previewFile))), false, 'insert temp Svelte preview folder deleted after accept');
  return session;
}

async function assertSvelteAdapterInjection(tmp) {
  const appHtml = readFileSync(join(tmp, APP_HTML), 'utf-8');
  const layout = readFileSync(join(tmp, LAYOUT_FILE), 'utf-8');
  assert.doesNotMatch(appHtml, /live\.js|impeccable-live-start/, 'Svelte adapter leaves src/app.html untouched');
  assert.match(layout, /ImpeccableLiveRoot|impeccable-live-svelte-start/, 'Svelte adapter patches layout with live root');
}

async function assertShadowChrome(page) {
  const result = await page.evaluate(() => {
    const host = document.getElementById('impeccable-live-root');
    const root = host?.shadowRoot;
    return {
      hasHost: Boolean(host),
      hasShadowRoot: Boolean(root),
      hasGlobalBar: Boolean(root?.getElementById('impeccable-live-global-bar')),
      documentHasGlobalBar: Boolean(document.querySelector('#impeccable-live-global-bar')),
    };
  });
  assert.equal(result.hasHost, true);
  assert.equal(result.hasShadowRoot, true);
  assert.equal(result.hasGlobalBar, true);
  assert.equal(result.documentHasGlobalBar, false, 'live chrome is not mounted in app DOM');
}

async function assertHostileCssIsolation(page) {
  await waitForGlobalBarStable(page);
  const before = await globalBarSnapshot(page);
  const hostileStyle = await page.addStyleTag({
    content: `
      button, div, input, svg, #impeccable-live-root, impeccable-live-root * {
        display: block !important;
        color: rgb(255, 0, 255) !important;
        background: rgb(0, 255, 255) !important;
        font-size: 44px !important;
        opacity: 0.2 !important;
        z-index: 1 !important;
        pointer-events: none !important;
      }
    `,
  });
  try {
    const after = await globalBarSnapshot(page);
    assert.equal(after.display, before.display, 'hostile CSS cannot change display');
    assert.equal(after.pointerEvents, before.pointerEvents, 'hostile CSS cannot disable pointer events');
    assert.ok(
      Math.abs(Number.parseFloat(after.opacity) - Number.parseFloat(before.opacity)) < 0.01,
      'hostile CSS cannot change opacity',
    );
    assert.equal(after.fontSize, before.fontSize, 'hostile CSS cannot change font size');
    assert.equal(after.color, before.color, 'hostile CSS cannot change color');
    assert.equal(after.backgroundColor, before.backgroundColor, 'hostile CSS cannot change background color');
    assert.ok(Math.abs(after.rect.width - before.rect.width) < 1, 'hostile CSS cannot change bar width');
    assert.ok(Math.abs(after.rect.height - before.rect.height) < 1, 'hostile CSS cannot change bar height');
  } finally {
    await hostileStyle.evaluate((el) => el.remove()).catch(() => {});
  }
}

async function waitForGlobalBarStable(page) {
  await installLiveQueryHelpers(page);
  await page.waitForFunction(
    () => {
      const bar = window.__impeccableLiveQuery?.('#impeccable-live-global-bar');
      if (!bar) return false;
      const opacity = Number.parseFloat(getComputedStyle(bar).opacity || '0');
      return opacity >= 0.999;
    },
    null,
    { timeout: 5_000 },
  );
}

async function assertSelectedElementChrome(page) {
  await installLiveQueryHelpers(page);
  const result = await page.evaluate(() => {
    const q = window.__impeccableLiveQuery;
    const bar = q('#impeccable-live-bar');
    const picker = q('#impeccable-live-picker');
    const badge = q('#impeccable-live-edit-badge');
    const highlight = q('#impeccable-live-highlight');
    const input = q('#impeccable-live-input');
    return {
      hasBar: Boolean(bar),
      barText: bar?.textContent || '',
      hasPicker: Boolean(picker),
      hasBadge: Boolean(badge),
      badgeText: badge?.textContent || '',
      badgeLabel: badge?.querySelector('button')?.getAttribute('aria-label') || badge?.title || '',
      hasHighlight: Boolean(highlight),
      highlightVisible: highlight?.style.display !== 'none',
      hasInput: Boolean(input),
      hasCount: /×\d+/.test(bar?.textContent || ''),
      hasGenerateButton: [...(bar?.querySelectorAll('button') || [])].some((button) => button.getAttribute('aria-label') === 'Generate variants'),
    };
  });
  assert.equal(result.hasBar, true);
  assert.equal(result.hasPicker, true);
  assert.equal(result.hasBadge, true);
  assert.match(result.badgeLabel, /Edit copy/);
  assert.equal(result.hasHighlight, true);
  assert.equal(result.highlightVisible, true);
  assert.equal(result.hasInput, true);
  assert.equal(result.hasCount, true);
  assert.equal(result.hasGenerateButton, true);
}

async function selectAction(page, label) {
  await installLiveQueryHelpers(page);
  const opened = await page.evaluate(() => {
    const bar = window.__impeccableLiveQuery('#impeccable-live-bar');
    const btn = [...(bar?.querySelectorAll('button') || [])].find((candidate) => /▾|▼/.test(candidate.textContent || ''));
    if (!btn) return false;
    btn.click();
    return true;
  });
  assert.equal(opened, true, 'action picker button opens');
  await page.waitForFunction(
    (expected) => {
      const picker = window.__impeccableLiveQuery('#impeccable-live-picker');
      return picker?.style.display !== 'none'
        && [...picker.querySelectorAll('button')].some((btn) => (btn.textContent || '').includes(expected));
    },
    label,
    { timeout: 5_000 },
  );
  const clicked = await page.evaluate((expected) => {
    const picker = window.__impeccableLiveQuery('#impeccable-live-picker');
    const btn = [...(picker?.querySelectorAll('button') || [])].find((candidate) => (candidate.textContent || '').includes(expected));
    if (!btn) return false;
    btn.click();
    return true;
  }, label);
  assert.equal(clicked, true, `${label} action clicked`);
}

async function clickEditBadgeAction(page, label) {
  const clicked = await page.evaluate((expected) => {
    const badge = window.__impeccableLiveQuery('#impeccable-live-edit-badge');
    const btn = [...(badge?.querySelectorAll('button') || [])].find((candidate) => (candidate.textContent || '').includes(expected));
    if (!btn) return false;
    btn.click();
    return true;
  }, label);
  assert.equal(clicked, true, `${label} edit action clicked`);
}

async function clickPendingTrash(page) {
  const dialog = page.waitForEvent('dialog', { timeout: 5_000 })
    .then((d) => d.accept())
    .catch(() => {});
  const clicked = await page.evaluate(() => {
    const dock = window.__impeccableLiveQuery('#impeccable-live-pending-dock');
    const btn = [...(dock?.querySelectorAll('button') || [])].find((candidate) => /Discard copy edits/i.test(candidate.getAttribute('aria-label') || candidate.title || ''));
    if (!btn) return false;
    btn.click();
    return true;
  });
  await dialog;
  assert.equal(clicked, true, 'pending dock discard clicked');
}

async function cycleTo(page, target) {
  for (let i = 0; i < 6; i++) {
    const visible = await getVisibleVariant(page);
    if (visible === target) return;
    if (visible == null) await page.waitForTimeout(250);
    else if (visible < target) await clickNext(page);
    else await clickPrev(page);
  }
  assert.equal(await getVisibleVariant(page), target, `variant ${target} visible`);
}

async function waitForVisibleCycling(page, count, { timeout }) {
  await waitForCycling(page, count, { timeout });
  await page.waitForFunction(
    (expectedCount) => {
      const bar = window.__impeccableLiveQuery?.('#impeccable-live-bar');
      if (!bar) return false;
      const style = getComputedStyle(bar);
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number.parseFloat(style.opacity || '0') > 0.5
        && (bar.textContent || '').includes(`/${expectedCount}`);
    },
    count,
    { timeout: 10_000 },
  );
}

async function assertVariantCounter(page, variant, count) {
  await page.waitForFunction(
    ({ variant, count }) => {
      const bar = window.__impeccableLiveQuery('#impeccable-live-bar');
      if (!bar || !(bar.textContent || '').includes(`${variant}/${count}`)) return false;
      const style = getComputedStyle(bar);
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number.parseFloat(style.opacity || '0') > 0.5;
    },
    { variant, count },
    { timeout: 10_000 },
  );
  assert.equal(await getVisibleVariant(page), variant);
}

async function revealExpenseRow(page) {
  const row = page.locator("[data-testid='expense-row']").first();
  if (await row.isVisible().catch(() => false)) return;
  await page.locator("[data-testid='add-expense']").click();
  await row.waitFor({ state: 'visible', timeout: 10_000 });
}

async function assertRecoverableMessage(page, variant, count) {
  await page.waitForFunction(
    ({ variant, count }) => {
      const bar = window.__impeccableLiveQuery('#impeccable-live-bar');
      const raw = localStorage.getItem('impeccable-live-session');
      let saved = null;
      try { saved = raw ? JSON.parse(raw) : null; } catch {}
      return Boolean(
        bar
        && /Variants ready\. Reveal the selected element to resume\./.test(bar.textContent || '')
        && saved?.visible === variant
        && saved?.expected === count
        && saved?.previewMode === 'svelte-component'
      );
    },
    { variant, count },
    { timeout: 30_000 },
  );
}

async function currentSveltePreviewSession(page, tmp) {
  const saved = await page.evaluate(() => {
    const raw = localStorage.getItem('impeccable-live-session');
    return raw ? JSON.parse(raw) : null;
  });
  assert.ok(saved?.id, 'live session is stored locally');
  assert.equal(saved.previewMode, 'svelte-component');
  assert.ok(saved.previewFile, 'Svelte preview manifest path is stored');
  const manifest = JSON.parse(readFileSync(join(tmp, saved.previewFile), 'utf-8'));
  return { ...saved, manifest };
}

async function waitForSvelteAcceptComplete(tmp, session, { timeout }) {
  const manifestPath = join(tmp, session.previewFile);
  const sourcePath = join(tmp, ROUTE_FILE);
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const snapshot = readSessionSnapshot(tmp, session.id);
    const source = readFileSync(sourcePath, 'utf-8');
    if (
      snapshot?.phase === 'completed'
      && snapshot.sourceFile === ROUTE_FILE
      && !existsSync(manifestPath)
      && !/data-impeccable-variants|impeccable-variants-start|data-impeccable-variant=/.test(source)
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Svelte accept did not complete for ${session.id}; snapshot=${JSON.stringify(readSessionSnapshot(tmp, session.id))}`);
}

function assertCompletedRealSource(tmp, id) {
  const snapshot = readSessionSnapshot(tmp, id);
  assert.equal(snapshot?.phase, 'completed');
  assert.equal(snapshot.sourceFile, ROUTE_FILE);
  assert.doesNotMatch(snapshot.sourceFile || '', /node_modules\/\.impeccable-live/);
  assert.match(snapshot.previewFile || '', /node_modules\/\.impeccable-live\/[^/]+\/manifest\.json/);
}

function assertDiscardedSession(tmp, id) {
  const snapshot = readSessionSnapshot(tmp, id);
  assert.equal(snapshot?.phase, 'discarded');
}

function readSessionSnapshot(tmp, id) {
  const file = join(tmp, '.impeccable/live/sessions', `${id}.snapshot.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf-8'));
}

async function assertPendingDockCount(live, expected) {
  const deadline = Date.now() + 20_000;
  let last = null;
  while (Date.now() < deadline) {
    last = await getPendingDockCount(live);
    if (last === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.equal(last, expected, 'pending copy edit count');
}

async function waitForPendingDockCleared(live, { timeout }) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    last = await getPendingDockCount(live);
    if (last === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.equal(last, 0, 'pending copy edits clear after Apply');
}

async function getPendingDockCount(live) {
  const res = await fetch(`http://127.0.0.1:${live.port}/manual-edit-stash?token=${encodeURIComponent(live.token)}&pageUrl=%2F`);
  if (!res.ok) throw new Error(`manual-edit-stash failed: ${res.status}`);
  const json = await res.json();
  return json.count || 0;
}

async function assertNoCyclingZero(page) {
  const text = await page.evaluate(() => window.__impeccableLiveQuery('#impeccable-live-bar')?.textContent || '');
  assert.doesNotMatch(text, /0\s*\/\s*0/);
}

async function assertNoRawSvelteExpressions(page) {
  const body = await page.evaluate(() => document.body.textContent || '');
  assert.doesNotMatch(body, /\{expenses\[0\]\.(name|amount)\}/);
}

async function readStateProbe(page) {
  return page.evaluate(() => ({
    openCount: document.querySelector('[data-testid="open-count"]')?.textContent?.trim(),
    mounts: window.__impeccableStatefulMounts,
  }));
}

async function assertOpenCount(page) {
  const state = await readStateProbe(page);
  assert.equal(state.openCount, '1 offen');
}

async function assertStateProbeUnchanged(page, expected, message) {
  const state = await readStateProbe(page);
  assert.equal(state.openCount, expected.openCount);
  assert.equal(state.mounts, expected.mounts, message);
}

function assertFinalSourceClean(tmp) {
  const source = readFileSync(join(tmp, ROUTE_FILE), 'utf-8');
  assert.doesNotMatch(source, /node_modules\/\.impeccable-live|data-impeccable-variants|impeccable-variants-start|data-impeccable-variant=/);
}

function latestJournalEvent(tmp, predicate) {
  const events = readJournalEvents(tmp);
  for (let i = events.length - 1; i >= 0; i--) {
    if (predicate(events[i])) return events[i];
  }
  return null;
}

async function waitForLatestJournalEvent(tmp, predicate, { timeout = 20_000 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const event = latestJournalEvent(tmp, predicate);
    if (event) return event;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('timed out waiting for journal event');
}

function readJournalEvents(tmp) {
  const dir = join(tmp, '.impeccable/live/sessions');
  if (!existsSync(dir)) return [];
  const events = [];
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.jsonl'))) {
    const body = readFileSync(join(dir, file), 'utf-8');
    for (const line of body.split('\n')) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        events.push(parsed.event || parsed);
      } catch {}
    }
  }
  return events;
}

async function globalBarSnapshot(page) {
  await installLiveQueryHelpers(page);
  return page.evaluate(() => {
    const bar = window.__impeccableLiveQuery('#impeccable-live-global-bar');
    if (!bar) return { hasBar: false };
    const rect = bar.getBoundingClientRect();
    const style = getComputedStyle(bar);
    return {
      hasBar: true,
      display: style.display,
      pointerEvents: style.pointerEvents,
      opacity: style.opacity,
      fontSize: style.fontSize,
      color: style.color,
      backgroundColor: style.backgroundColor,
      transition: style.transition,
      transform: style.transform,
      rect: { width: rect.width, height: rect.height, left: rect.left, top: rect.top },
    };
  });
}

function wrapTargetFromPickedElement(event) {
  const element = event.element || {};
  const tag = typeof element.tagName === 'string'
    ? element.tagName.trim().toLowerCase()
    : '';
  const classes = Array.isArray(element.classes)
    ? element.classes.filter(Boolean).join(' ')
    : typeof element.className === 'string'
    ? element.className.trim().split(/\s+/).filter(Boolean).join(' ')
    : extractClassAttr(element.outerHTML);
  const elementId = typeof element.id === 'string' ? element.id.trim() : '';
  return {
    tag: tag || 'h1',
    ...(classes ? { classes } : {}),
    ...(elementId ? { elementId } : {}),
    ...(element.textContent ? { text: String(element.textContent).trim() } : {}),
  };
}

function extractClassAttr(outerHTML) {
  if (typeof outerHTML !== 'string') return '';
  const match = outerHTML.match(/\sclass=(["'])(.*?)\1/);
  return match ? match[2].trim().split(/\s+/).filter(Boolean).join(' ') : '';
}

function createEvidenceWriter({ page, tmp, live, consoleErrors }) {
  mkdirSync(artifactRoot, { recursive: true });
  writeFileSync(join(artifactRoot, 'fixture-tmp.txt'), tmp + '\n');
  return {
    async capture(name) {
      const safe = name.replace(/[^a-z0-9_.-]+/gi, '-');
      const dir = join(artifactRoot, safe);
      mkdirSync(dir, { recursive: true });
      try { await page.screenshot({ path: join(dir, 'page.png'), fullPage: true }); } catch {}
      try {
        const dom = await page.evaluate(() => {
          const host = document.getElementById('impeccable-live-root');
          const shadow = host?.shadowRoot;
          return {
            url: location.href,
            bodyText: document.body.textContent?.replace(/\s+/g, ' ').trim().slice(0, 4000),
            appHtml: document.body.innerHTML.slice(0, 12000),
            shadowHtml: shadow?.innerHTML.slice(0, 12000) || null,
            liveState: window.__IMPECCABLE_LIVE_CHROME_CORE__?.debugState?.() || null,
            localSession: localStorage.getItem('impeccable-live-session'),
          };
        });
        writeFileSync(join(dir, 'dom.json'), JSON.stringify(dom, null, 2) + '\n');
      } catch (err) {
        writeFileSync(join(dir, 'dom-error.txt'), err.stack || err.message || String(err));
      }
      writeFileSync(join(dir, 'console-errors.json'), JSON.stringify(consoleErrors, null, 2) + '\n');
      writeFileSync(join(dir, 'source.diff'), git(tmp, ['diff', '--', APP_HTML, LAYOUT_FILE, ROUTE_FILE]));
      copyIfExists(join(tmp, APP_HTML), join(dir, 'app.html'));
      copyIfExists(join(tmp, LAYOUT_FILE), join(dir, 'layout.svelte'));
      copyIfExists(join(tmp, ROUTE_FILE), join(dir, 'page.svelte'));
      copyDirIfExists(join(tmp, '.impeccable/live/sessions'), join(dir, 'sessions'));
      copyDirIfExists(join(tmp, 'node_modules/.impeccable-live'), join(dir, 'impeccable-live-preview'));
      writeFileSync(join(dir, 'preview-files.json'), JSON.stringify(listPreviewFiles(tmp), null, 2) + '\n');
      try {
        const status = await fetch(`http://127.0.0.1:${live.port}/status?token=${encodeURIComponent(live.token)}`).then((res) => res.json());
        writeFileSync(join(dir, 'status.json'), JSON.stringify(status, null, 2) + '\n');
      } catch {}
    },
  };
}

function listPreviewFiles(tmp) {
  const root = join(tmp, 'node_modules/.impeccable-live');
  if (!existsSync(root)) return [];
  const out = [];
  walk(root, (file) => out.push(relative(tmp, file).split('\\').join('/')));
  return out.sort();
}

function walk(dir, visit) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, visit);
    else visit(abs);
  }
}

function copyIfExists(from, to) {
  if (existsSync(from)) cpSync(from, to);
}

function copyDirIfExists(from, to) {
  if (!existsSync(from)) return;
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
}

function git(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf-8' });
  } catch (err) {
    return err.stdout?.toString?.() || err.message || String(err);
  }
}

function createArtifactRoot() {
  const explicit = process.env.IMPECCABLE_SVELTE_DEEPSEEK_ARTIFACT_DIR;
  if (explicit) return explicit;
  const base = join(REPO_ROOT, 'tmp/svelte-live-adapter-deepseek');
  for (const round of ['round-1', 'round-2']) {
    const candidate = join(base, round);
    if (!existsSync(candidate)) return candidate;
  }
  return join(base, `run-${new Date().toISOString().replace(/[:.]/g, '-')}`);
}

function assertNoConsoleErrors(consoleErrors) {
  const ignored = consoleErrors.filter((line) =>
    !/favicon|ResizeObserver loop limit exceeded/i.test(line)
  );
  assert.deepEqual(ignored, []);
}
