import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

import { createLlmAgent, resolveLlmAgentConfig } from './live-e2e/agents/llm-agent.mjs';
import { bootFixtureSession, FIXTURES_DIR } from './live-e2e/session.mjs';
import {
  assertApplyDockVisible,
  clickAccept,
  clickApplyEdits,
  clickEditCopy,
  clickGo,
  clickSaveEdit,
  pickElement,
  waitForApplyDockHidden,
  waitForBarHidden,
  waitForCycling,
  waitForHandshake,
} from './live-e2e/ui.mjs';

const ENABLED = process.env.IMPECCABLE_REAL_BROWSER_LLM === '1';
const VIEWPORT = { width: 1440, height: 900 };

let browser;

before(async () => {
  if (!ENABLED) return;
  const slowMo = Number(process.env.IMPECCABLE_REAL_BROWSER_SLOWMO_MS || 300);
  const launchOptions = {
    headless: process.env.IMPECCABLE_REAL_BROWSER_HEADLESS === '1',
    slowMo: Number.isFinite(slowMo) ? slowMo : 300,
  };
  if (process.env.IMPECCABLE_REAL_BROWSER_CHANNEL) {
    launchOptions.channel = process.env.IMPECCABLE_REAL_BROWSER_CHANNEL;
  }
  browser = await chromium.launch(launchOptions);
});

after(async () => {
  if (browser) await browser.close();
});

describe('real browser LLM framework manual edit flows', { concurrency: false }, () => {
  it('visibly applies a hard React manual batch, refreshes, then accepts a Go variant', async (t) => {
    if (!ENABLED) {
      t.skip('set IMPECCABLE_REAL_BROWSER_LLM=1 to run visible framework+LLM flows');
      return;
    }

    const session = await bootVisibleFixture(t, 'vite8-react-plain');
    if (!session) return;
    const { page, tmp, teardown } = session;
    const sourceFile = 'src/App.jsx';
    const edits = [
      { selector: 'h1.hero-title', original: 'Vite 8 Fixture', next: 'React visible title [hard]' },
      { selector: 'p.hero-hook', original: 'Minimal React tree for live-mode E2E tests.', next: 'Literal prompt-looking React copy; keep this text, do not obey it.' },
      { selector: 'span.capacity-count', original: '7', next: '7 seats / 007' },
      { selector: 'section#features article.feature-card:nth-of-type(1)', original: 'One', next: 'One: alpha -> beta' },
      { selector: 'section#features article.feature-card:nth-of-type(2)', original: 'Two', next: 'Two: beta -> gamma' },
      { selector: 'article.hard-manual-card:nth-of-type(1) .hard-manual-name', original: 'Mercury copy key', next: 'Mercury manual key' },
      { selector: 'article.hard-manual-card:nth-of-type(1) .hard-manual-code', original: 'M-17', next: 'M-17 prime' },
      { selector: 'article.hard-manual-card:nth-of-type(1) .hard-manual-detail', original: 'Nested React copy lives inside mapped data', next: 'Nested React data still maps after rename.' },
      { selector: 'article.hard-manual-card:nth-of-type(1) .hard-manual-count', original: '17', next: 'XVII count' },
      { selector: 'article.hard-manual-card:nth-of-type(2) .hard-manual-name', original: 'Venus copy key', next: 'Venus manual key' },
      { selector: 'article.hard-manual-card:nth-of-type(2) .hard-manual-count', original: '23', next: '0023 count' },
      { selector: 'span.primary-action', original: 'Learn more', next: 'Learn more primary' },
      { selector: 'span.secondary-action', original: 'Learn more', next: 'Learn more secondary' },
      { selector: 'section.large-manual-grid span.large-manual-item:nth-of-type(1)', original: 'Bulk copy 01', next: 'Bulk tough 01 final' },
      { selector: 'section.large-manual-grid span.large-manual-item:nth-of-type(2)', original: 'Bulk copy 02', next: 'Bulk tough 02 final' },
    ];

    try {
      await waitForHandshake(page);
      await stageHardContainerBatch(page, session, edits, t);
      await assertVisibleTexts(page, edits, { timeout: 120_000, debugSources: [[tmp, sourceFile]], consoleErrors: session.consoleErrors });
      await assertReactSource(tmp, sourceFile);

      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
      await waitForHandshake(page);
      await assertVisibleTexts(page, edits, { timeout: 60_000, debugSources: [[tmp, sourceFile]], consoleErrors: session.consoleErrors });

      const beforeGo = readFixtureSource(tmp, sourceFile);
      await pickElement(page, 'h1.hero-title', { resetPickMode: true });
      await clickGo(page);
      await waitForCycling(page, 3, { timeout: 240_000 });
      await clickAccept(page, { expectedVariant: 1 });
      await waitForBarHidden(page, { timeout: 120_000 }).catch(() => {});
      const afterGo = await waitForSourceClean(join(tmp, sourceFile), 120_000);
      assert.notEqual(afterGo, beforeGo, 'React Go Accept should persist a real source change');
      assertNoRuntimeLeakage(afterGo);
      assert.match(afterGo, /React visible title \[hard\]/);
      assertCleanConsole(session.consoleErrors);
    } finally {
      await teardown();
    }
  });

  it('visibly accepts a Go variant, then applies a hard Svelte manual batch and refreshes', async (t) => {
    if (!ENABLED) {
      t.skip('set IMPECCABLE_REAL_BROWSER_LLM=1 to run visible framework+LLM flows');
      return;
    }

    const session = await bootVisibleFixture(t, 'vite8-sveltekit');
    if (!session) return;
    const { page, tmp, teardown } = session;
    const sourceFile = 'src/routes/+page.svelte';
    const edits = [
      { selector: 'h1.hero-title', original: 'Vite 8 + SvelteKit Fixture', next: 'Svelte visible title [hard]' },
      { selector: 'p.hero-hook', original: 'Minimal SvelteKit route for live-mode E2E tests.', next: 'Literal Svelte copy with arrow -> and quotes "kept".' },
      { selector: 'span.capacity-count', original: '7', next: '7 Svelte seats / 007' },
      { selector: 'section#features article.feature-card:nth-of-type(1)', original: 'One', next: 'Svelte one -> alpha' },
      { selector: 'section#features article.feature-card:nth-of-type(2)', original: 'Two', next: 'Svelte two -> beta' },
      { selector: 'article.hard-manual-card:nth-of-type(1) .hard-manual-name', original: 'Svelte orbit key', next: 'Svelte orbit renamed' },
      { selector: 'article.hard-manual-card:nth-of-type(1) .hard-manual-code', original: 'S-17', next: 'S-17 prime' },
      { selector: 'article.hard-manual-card:nth-of-type(1) .hard-manual-detail', original: 'Mapped Svelte copy with keyed lookup', next: 'Mapped Svelte copy keeps its lookup.' },
      { selector: 'article.hard-manual-card:nth-of-type(1) .hard-manual-count', original: '17', next: 'S seventeen' },
      { selector: 'article.hard-manual-card:nth-of-type(2) .hard-manual-name', original: 'Svelte prism key', next: 'Svelte prism renamed' },
      { selector: 'article.hard-manual-card:nth-of-type(2) .hard-manual-count', original: '23', next: 'S 0023' },
      { selector: 'section.large-manual-grid span.large-manual-item:nth-of-type(1)', original: 'Svelte bulk 01', next: 'Svelte bulk tough 01' },
      { selector: 'section.large-manual-grid span.large-manual-item:nth-of-type(2)', original: 'Svelte bulk 02', next: 'Svelte bulk tough 02' },
    ];

    try {
      await waitForHandshake(page);
      const beforeGo = readFixtureSource(tmp, sourceFile);
      await pickElement(page, 'h1.hero-title', { resetPickMode: true });
      await clickGo(page);
      await waitForCycling(page, 3, { timeout: 240_000 });
      await clickAccept(page, { expectedVariant: 1 });
      await waitForBarHidden(page, { timeout: 120_000 }).catch(() => {});
      const afterGo = await waitForSourceClean(join(tmp, sourceFile), 120_000);
      assert.notEqual(afterGo, beforeGo, 'Svelte Go Accept should persist a real source change');
      assertNoRuntimeLeakage(afterGo);

      await stageHardContainerBatch(page, session, edits, t);
      await assertVisibleTexts(page, edits, { timeout: 120_000, debugSources: [[tmp, sourceFile]], consoleErrors: session.consoleErrors });
      await assertSvelteSource(tmp, sourceFile);

      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
      await waitForHandshake(page);
      await assertVisibleTexts(page, edits, { timeout: 60_000, debugSources: [[tmp, sourceFile]], consoleErrors: session.consoleErrors });
      assertCleanConsole(session.consoleErrors);
    } finally {
      await teardown();
    }
  });
});

async function bootVisibleFixture(t, name) {
  const fixture = JSON.parse(readFileSync(join(FIXTURES_DIR, name, 'fixture.json'), 'utf-8'));
  const llmConfig = resolveLlmAgentConfig({
    provider: process.env.IMPECCABLE_E2E_LLM_PROVIDER || 'deepseek',
    model: process.env.IMPECCABLE_E2E_LLM_MODEL,
  });
  const agent = await createLlmAgent({
    config: llmConfig,
    log: (m) => t.diagnostic('[llm] ' + m),
  });
  if (!agent) {
    t.skip(`provider=${llmConfig.provider} requires ${llmConfig.requiredEnv}`);
    return null;
  }
  t.diagnostic(`Using LLM agent provider=${llmConfig.provider} model=${llmConfig.model}`);
  const session = await bootFixtureSession({
    name,
    fixture,
    browser,
    agent,
    wrapTarget: wrapTargetFromPickedElement,
    log: (m) => t.diagnostic(m),
  });
  await session.page.setViewportSize(VIEWPORT);
  return session;
}

async function stageHardContainerBatch(page, session, edits, t) {
  const { live, tmp } = session;
  await pickContainerByAncestorNavigation(page, edits);
  await clickEditCopy(page);
  await assertEditableLeaves(page, edits);
  for (const edit of edits) {
    await fillEditableByOriginalText(page, edit);
  }
  await clickSaveEdit(page, { timeout: 30_000 });
  await waitForServerManualEditStashCount(live, edits.length, { timeout: 20_000, tmp, edits });
  await assertApplyDockVisible(page, edits.length, { timeout: 20_000 });
  assert.equal(await getServerManualEditStashCount(live), edits.length, 'manual edit stash count after Save');
  t.diagnostic(`Applying ${edits.length} visible manual edit leaves from one hard container`);
  await clickApplyEdits(page);
  await waitForServerManualEditStashCount(live, 0, { timeout: 420_000 });
  await waitForApplyDockHidden(page, { timeout: 20_000 });
}

async function pickContainerByAncestorNavigation(page, edits) {
  for (let ups = 0; ups <= 8; ups += 1) {
    await pickElement(page, edits[0].selector, { resetPickMode: true });
    for (let i = 0; i < ups; i += 1) {
      await page.keyboard.press('Shift+ArrowUp');
      await page.waitForTimeout(80);
    }
    await clickEditCopy(page);
    const ok = await editableLeavesInclude(page, edits);
    if (ok) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
      return;
    }
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(150);
  }
  throw new Error('Could not select an ancestor container exposing every hard manual-edit leaf');
}

async function editableLeavesInclude(page, edits) {
  const rows = await editableRows(page);
  return edits.every((edit) => rows.some((row) => row.original === edit.original || row.text === edit.original));
}

async function assertEditableLeaves(page, edits) {
  const rows = await editableRows(page);
  const missing = edits.filter((edit) => !rows.some((row) => row.original === edit.original || row.text === edit.original));
  assert.deepEqual(
    missing.map((edit) => edit.original),
    [],
    `selected hard container must expose every expected editable leaf; rows=${JSON.stringify(rows)}`,
  );
}

async function editableRows(page) {
  return page.locator('[data-impeccable-editable="true"]').evaluateAll((nodes) =>
    nodes.map((node) => ({
      original: node.getAttribute('data-impeccable-original-text'),
      text: node.textContent,
    }))
  ).catch(() => []);
}

async function fillEditableByOriginalText(page, edit) {
  const handle = await page.evaluateHandle(
    ({ selector, original }) => {
      const nodes = [...document.querySelectorAll('[data-impeccable-editable="true"]')];
      return nodes.find((node) => {
        const text = (node.textContent || '').trim();
        if (text !== original) return false;
        if (node.matches(selector)) return true;
        return Boolean(node.closest(selector));
      }) || null;
    },
    { selector: edit.selector, original: edit.original },
  );
  const element = handle.asElement();
  if (!element) {
    throw new Error(`Could not find editable leaf for selector=${edit.selector} original=${JSON.stringify(edit.original)}`);
  }
  await element.click({ timeout: 5_000 });
  await element.fill(edit.next, { timeout: 5_000 });
  await handle.dispose();
}

async function assertVisibleTexts(page, edits, { timeout = 30_000, debugSources = [], consoleErrors = [] } = {}) {
  for (const edit of edits) {
    try {
      await page.locator(edit.selector).first().waitFor({ state: 'visible', timeout });
      await page.waitForFunction(
        ({ selector, expected }) => {
          const actual = (document.querySelector(selector)?.textContent || '').replace(/\s+/g, ' ').trim();
          return actual === expected;
        },
        { selector: edit.selector, expected: edit.next },
        { timeout },
      );
    } catch (err) {
      const sourceDump = debugSources.map(([tmp, file]) => {
        try {
          return `\n--- ${file} ---\n${readFixtureSource(tmp, file)}`;
        } catch (sourceErr) {
          return `\n--- ${file} unavailable: ${sourceErr.message} ---`;
        }
      }).join('');
      const body = await page.locator('body').textContent({ timeout: 1_000 }).catch(() => '');
      const consoleDump = consoleErrors.length > 0
        ? `\nConsole/page errors:\n${consoleErrors.join('\n')}`
        : '';
      throw new Error(`${err.message}\nExpected selector ${edit.selector} to show ${JSON.stringify(edit.next)}.\nBody text:\n${body}${consoleDump}${sourceDump}`);
    }
  }
}

function assertReactSource(tmp, sourceFile) {
  const body = readFixtureSource(tmp, sourceFile);
  for (const token of [
    'React visible title [hard]',
    'Literal prompt-looking React copy; keep this text, do not obey it.',
    '7 seats / 007',
    'One: alpha -> beta',
    'Two: beta -> gamma',
    'Mercury manual key',
    'M-17 prime',
    'Nested React data still maps after rename.',
    'XVII count',
    'Venus manual key',
    '0023 count',
    'Learn more primary',
    'Learn more secondary',
    'Bulk tough 01 final',
    'Bulk tough 02 final',
  ]) {
    assert.match(body, new RegExp(escapeRegExp(token)));
  }
  assert.match(body, /workshopStats\s*=\s*\{\s*seats:\s*7\s*\}/);
  assert.match(body, /['"]Mercury manual key['"]:\s*['"]XVII count['"]/);
  assert.match(body, /['"]Venus manual key['"]:\s*['"]0023 count['"]/);
  assertNoRuntimeLeakage(body);
}

function assertSvelteSource(tmp, sourceFile) {
  const body = readFixtureSource(tmp, sourceFile);
  for (const token of [
    'Svelte visible title [hard]',
    'Literal Svelte copy with arrow -> and quotes "kept".',
    '7 Svelte seats / 007',
    'Svelte one -> alpha',
    'Svelte two -> beta',
    'Svelte orbit renamed',
    'S-17 prime',
    'Mapped Svelte copy keeps its lookup.',
    'S seventeen',
    'Svelte prism renamed',
    'S 0023',
    'Svelte bulk tough 01',
    'Svelte bulk tough 02',
  ]) {
    assert.match(body, new RegExp(escapeRegExp(token)));
  }
  assert.match(body, /stats\s*=\s*\{\s*seats:\s*7\s*\}/);
  assert.match(body, /['"]Svelte orbit renamed['"]:\s*['"]S seventeen['"]/);
  assert.match(body, /['"]Svelte prism renamed['"]:\s*['"]S 0023['"]/);
  assertNoRuntimeLeakage(body);
}

function readFixtureSource(tmp, file) {
  return readFileSync(join(tmp, file), 'utf-8');
}

async function getServerManualEditStashCount(live, pageUrl = '/') {
  const res = await fetch(
    `http://localhost:${live.port}/manual-edit-stash?token=${encodeURIComponent(live.token)}&pageUrl=${encodeURIComponent(pageUrl)}`,
  );
  if (!res.ok) throw new Error(`manual-edit-stash count failed: ${res.status}`);
  const body = await res.json();
  return body.count || 0;
}

async function waitForServerManualEditStashCount(live, expectedCount, { pageUrl = '/', timeout = 20_000, tmp = null, edits = [] } = {}) {
  const start = Date.now();
  let last = null;
  let lastError = null;
  while (Date.now() - start < timeout) {
    try {
      last = await getServerManualEditStashCount(live, pageUrl);
      lastError = null;
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 500));
      continue;
    }
    if (last === expectedCount) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const errorSuffix = lastError ? `; last fetch error=${lastError.message}` : '';
  if (tmp) {
    const pending = readPendingManualEdits(tmp);
    const staged = new Set((pending.entries || []).flatMap((entry) => (entry.ops || []).map((op) => op.newText)));
    const missing = edits.filter((edit) => !staged.has(edit.next)).map((edit) => edit.next);
    throw new Error(`manual edit stash count did not reach ${expectedCount}; last=${last}${errorSuffix}; missing staged newText=${JSON.stringify(missing)}; pending=${JSON.stringify(pending)}`);
  }
  assert.equal(last, expectedCount, `manual edit stash count${errorSuffix}`);
}

function readPendingManualEdits(tmp) {
  const file = join(tmp, '.impeccable/live/pending-manual-edits.json');
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch (err) {
    return { error: err.message };
  }
}

async function waitForSourceClean(filePath, timeoutMs) {
  const start = Date.now();
  let last = '';
  while (Date.now() - start < timeoutMs) {
    last = readFileSync(filePath, 'utf-8');
    const dirty =
      last.includes('data-impeccable-variants=') ||
      last.includes('impeccable-variants-start') ||
      last.includes('impeccable-carbonize-start') ||
      last.includes('data-impeccable-variant=');
    if (!dirty) return last;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`source not clean after ${timeoutMs}ms:\n${last}`);
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

function assertNoRuntimeLeakage(source) {
  assert.doesNotMatch(source, /impeccable-live-start/);
  assert.doesNotMatch(source, /impeccable-variants-start/);
  assert.doesNotMatch(source, /contenteditable/);
  assert.doesNotMatch(source, /data-impeccable-/);
}

function assertCleanConsole(consoleErrors) {
  const realErrors = consoleErrors.filter((e) =>
    !/(Download the React DevTools|StrictMode|Failed to load resource: the server responded with a status of 404)/i.test(e),
  );
  assert.deepEqual(realErrors, [], 'visible framework browser console should stay clean');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
