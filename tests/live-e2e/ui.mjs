/**
 * Playwright helpers that drive the live-mode bar UI exactly the way a user
 * would: pick an element, configure, Go, cycle, accept.
 *
 * Selector strategy: live-browser.js uses deterministic ids (`impeccable-live-*`)
 * for the global bar, per-element bar, action picker, and params panel. Buttons
 * inside the per-element bar are matched by visible text or unicode glyph
 * (`Go →`, `← / →`, `✓ Accept`, `✕`). All selectors below come from
 * skill/scripts/live-browser.js — keep this file in sync if
 * the bar's text content changes.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BAR_ID = '#impeccable-live-bar';
const GLOBAL_BAR_ID = '#impeccable-live-global-bar';
const PICKER_ID = '#impeccable-live-picker';
const EDIT_BADGE_ID = '#impeccable-live-edit-badge';
const PENDING_DOCK_ID = '#impeccable-live-pending-dock';
const STEER_CHAT_ID = '#impeccable-live-page-chat';
const STEER_INPUT_ID = '#impeccable-live-page-chat-input';
const PICK_TOGGLE = '#impeccable-live-pick-toggle';
// Alias kept so references introduced via origin/main (PICK_TOGGLE_ID)
// continue to resolve to the same selector as the older PICK_TOGGLE name.
const PICK_TOGGLE_ID = PICK_TOGGLE;
const INSERT_TOGGLE = '#impeccable-live-insert-toggle';
const INSERT_INPUT_ID = '#impeccable-live-insert-input';
const INSERT_CREATE_ID = '#impeccable-live-insert-create';

/**
 * Wait for the live handshake to complete:
 *   - window.__IMPECCABLE_LIVE_INIT__ set
 *   - global bar mounted
 *   - SSE connection established (state transitioned to PICKING)
 *
 * Times out generously since some frameworks delay first render.
 */
export async function waitForHandshake(page, { timeout = 20_000 } = {}) {
  await page.waitForFunction(
    () => window.__IMPECCABLE_LIVE_INIT__ === true,
    { timeout },
  );
  await page.waitForSelector(GLOBAL_BAR_ID, { timeout });
  // Wait for the picker mode to be active (live.js flips state PICKING after
  // SSE 'connected' arrives). We can detect it via the global bar's pick
  // toggle being in its ready state. Soft wait — fall through after a beat
  // even if the toggle hasn't visibly shifted.
  await page.waitForTimeout(250);
}

/**
 * Click an in-page element to select it. live-browser.js's picker only acts
 * when state === 'PICKING' AND pickActive is true. Both interaction toggles
 * default off on a fresh page — enable pick mode before hovering.
 */
export async function pickElement(page, selector, opts = {}) {
  const position = opts.position || null;
  if (opts.resetPickMode) await resetPickMode(page);
  else await enablePickMode(page);
  for (let attempt = 0; attempt < 3; attempt++) {
    const el = await page.waitForSelector(selector, { timeout: 5_000 });
    await ensurePickerActive(page);
    await hideAnnotationOverlay(page);
    try {
      await el.hover(position ? { position } : undefined);
      // Tiny settle: live-browser updates `hoveredElement` on mousemove, and the
      // click handler reads from it.
      await page.waitForTimeout(50);
      await clickPickTarget(page, el, position);
    } catch (err) {
      if (attempt === 2) throw err;
      await page.waitForTimeout(250);
      await resetPickMode(page);
      continue;
    }
    // Per-element bar mounts on click → wait for it. Dialog fixtures can
    // briefly hide the global live chrome while preActions open a portal, so
    // retry once after explicitly re-arming picker mode.
    const visible = await page
      .waitForSelector(BAR_ID, { state: 'visible', timeout: 5_000 })
      .then(() => true, () => false);
    if (visible) break;
    await resetPickMode(page);
    if (attempt === 2) {
      await page.waitForSelector(BAR_ID, { state: 'visible', timeout: 1 });
    }
  }
  // Wait specifically for the Configure-row Go button to be in the bar.
  // pickElement returning before that race-conditions with clickGo on
  // fixtures whose framework re-renders right after pick (modal open, tab
  // switch). Anchoring the wait on the Go button's text is robust: the bar
  // can be visible-but-empty (state=PICKING) before showBar('configure')
  // populates the row.
  await page.waitForFunction(
    (barSel) => {
      const bar = document.querySelector(barSel);
      if (!bar) return false;
      const btns = [...bar.querySelectorAll('button')];
      return btns.some((b) => /Go\b/.test(b.textContent || ''));
    },
    BAR_ID,
    { timeout: 5_000 },
  );
}

async function hideAnnotationOverlay(page) {
  await page.evaluate(() => {
    const annot = document.querySelector('#impeccable-live-annot');
    if (annot) annot.style.display = 'none';
  }).catch(() => {});
}

async function clickPickTarget(page, el, position = null) {
  const box = await el.boundingBox();
  if (box) {
    const x = position ? box.x + position.x : box.x + box.width / 2;
    const y = position ? box.y + position.y : box.y + box.height / 2;
    await page.mouse.click(x, y);
    return;
  }
  await el.evaluate((node) => node.click());
}

async function ensurePickerActive(page) {
  await page.waitForSelector(GLOBAL_BAR_ID, { timeout: 5_000 });
  const active = await page
    .locator(PICK_TOGGLE_ID)
    .evaluate((el) => el.dataset.active === 'true')
    .catch(() => false);
  if (active) return;

  const clicked = await page.evaluate((sel) => {
    const btn = document.querySelector(sel);
    if (!btn) return false;
    btn.click();
    return true;
  }, PICK_TOGGLE_ID);
  if (!clicked) {
    await page.locator(PICK_TOGGLE_ID).click({ timeout: 5_000 });
  }
  await page.waitForFunction(
    (sel) => document.querySelector(sel)?.dataset.active === 'true',
    PICK_TOGGLE_ID,
    { timeout: 5_000 },
  );
}

async function resetPickMode(page) {
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(100);
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(100);
  await page.evaluate((sel) => {
    const btn = document.querySelector(sel);
    if (!btn) return;
    const active = btn.dataset.active === 'true';
    if (active) btn.click();
    btn.click();
  }, PICK_TOGGLE_ID).catch(() => {});
  await page.waitForFunction(
    (sel) => document.querySelector(sel)?.dataset.active === 'true',
    PICK_TOGGLE_ID,
    { timeout: 5_000 },
  ).catch(() => {});
}

/**
 * Set the variant count by clicking the count button (cycles 2 → 3 → 4 → 2).
 * Default is 3. If the desired count is already showing, this is a no-op.
 */
export async function setCount(page, count) {
  if (count < 2 || count > 4) throw new Error('count must be 2..4');
  for (let i = 0; i < 4; i++) {
    const current = await page.evaluate((barSel) => {
      const bar = document.querySelector(barSel);
      if (!bar) return null;
      const btns = [...bar.querySelectorAll('button')];
      const btn = btns.find((b) => /^×\d+$/.test((b.textContent || '').trim()));
      if (!btn) return null;
      return parseInt((btn.textContent || '').trim().slice(1), 10);
    }, BAR_ID);
    if (current === count) return;
    await page.locator(`${BAR_ID} button`, { hasText: /^×\d+$/ }).click();
  }
  throw new Error(`could not cycle count to ${count}`);
}

/**
 * Click Go. Browser POSTs the generate event; the agent picks it up. Headed
 * browser runs can occasionally accept the click without leaving configure
 * mode after a long manual Apply, so verify the bar advanced and retry the
 * visible click if it did not.
 */
export async function clickGo(page) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    await clickBarButton(page, /Go\b/);
    const advanced = await page.waitForFunction(
      (barSel) => {
        const bar = document.querySelector(barSel);
        if (!bar) return false;
        const text = bar.textContent || '';
        if (/Generating\b/.test(text)) return true;
        if (/\d+\s*\/\s*\d+/.test(text)) return true;
        return ![...bar.querySelectorAll('button')].some((button) => /Go\b/.test(button.textContent || ''));
      },
      BAR_ID,
      { timeout: 3_000 },
    ).then(() => true, (err) => {
      lastErr = err;
      return false;
    });
    if (advanced) return;
    await page.waitForTimeout(500);
  }
  throw lastErr || new Error('Go click did not leave configure mode');
}

/**
 * Wait for the bar to enter CYCLING state — happens after the agent's
 * variants land in the DOM via HMR and the MutationObserver counts them.
 *
 * The cycling row has the visible counter `N/M` in monospaced font; we
 * detect it by content. The bar can also auto-reload if HMR was slow, so
 * we give it a generous window.
 */
export async function waitForCycling(page, expectedCount, { timeout = 30_000 } = {}) {
  await page.waitForFunction(
    ({ barSel, expected }) => {
      const bar = document.querySelector(barSel);
      if (!bar) return false;
      const text = bar.textContent || '';
      // Counter format: "1/3", "2/3" etc. Look for any "i/N" with N matching.
      const m = text.match(/(\d+)\s*\/\s*(\d+)/);
      if (!m) return false;
      return parseInt(m[2], 10) === expected;
    },
    { barSel: BAR_ID, expected: expectedCount },
    { timeout },
  );
}

/**
 * Click the next variant button (right arrow).
 */
export async function clickNext(page) {
  await clickBarButton(page, '→');
}

export async function clickPrev(page) {
  await clickBarButton(page, '←');
}

async function clickBarButton(page, label) {
  const button = page.locator(`${BAR_ID} button`, { hasText: label });
  const textMatch = label instanceof RegExp
    ? { kind: 'regex', source: label.source, flags: label.flags }
    : { kind: 'text', value: String(label) };
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await button.click({ timeout: 5_000 });
      return;
    } catch (err) {
      lastErr = err;
      await page.waitForTimeout(500);
    }
  }
  // Real-LLM fixtures can leave Vite/Tailwind HMR settling for longer than a
  // human-visible click target stays Playwright-stable. Dispatch the click on
  // the current button if normal user-like clicks lost the remount race.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const clicked = await page.evaluate(findAndClickBarButton, { barSel: BAR_ID, textMatch });
      if (clicked) return;
    } catch (err) {
      lastErr = err;
    }
    await page.waitForSelector(BAR_ID, { timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(500);
  }
  throw lastErr;
}

async function dispatchBarButton(page, label) {
  const textMatch = label instanceof RegExp
    ? { kind: 'regex', source: label.source, flags: label.flags }
    : { kind: 'text', value: String(label) };
  return page.evaluate(findAndClickBarButton, { barSel: BAR_ID, textMatch });
}

function findAndClickBarButton({ barSel, textMatch }) {
  const bar = document.querySelector(barSel);
  if (!bar) return false;
  const btn = [...bar.querySelectorAll('button')]
    .find((candidate) => {
      const text = candidate.textContent || '';
      if (textMatch.kind === 'regex') return new RegExp(textMatch.source, textMatch.flags).test(text);
      return text.includes(textMatch.value);
    });
  if (!btn) return false;
  btn.click();
  return true;
}

/**
 * Read the currently visible variant index (the "i" in "i/N").
 */
export async function getVisibleVariant(page) {
  return page.evaluate((barSel) => {
    const wrapper = document.querySelector('[data-impeccable-variants]');
    if (wrapper) {
      const variants = [...wrapper.querySelectorAll('[data-impeccable-variant]:not([data-impeccable-variant="original"])')];
      const visible = variants.find((variant) => variant.style.display !== 'none');
      const idx = visible ? parseInt(visible.dataset.impeccableVariant || '0', 10) : 0;
      if (idx > 0) return idx;
    }
    const bar = document.querySelector(barSel);
    if (!bar) return null;
    const m = (bar.textContent || '').match(/(\d+)\s*\/\s*(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  }, BAR_ID);
}

/**
 * Click Accept — sends accept event with current variantId + paramValues.
 * The bar transitions to a "Saving..." spinner, then a green confirmed row.
 */
export async function clickAccept(page, { expectedVariant } = {}) {
  if (expectedVariant != null) {
    await ensureVisibleVariant(page, expectedVariant);
  }
  if (await dispatchBarButton(page, /Accept/)) return;
  await clickBarButton(page, /Accept/);
}

async function ensureVisibleVariant(page, expectedVariant) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await getVisibleVariant(page);
    if (current === expectedVariant) return;
    if (current == null) {
      await page.waitForTimeout(300);
      continue;
    }
    await clickBarButton(page, current < expectedVariant ? '→' : '←');
    await page.waitForTimeout(300);
  }
  const current = await getVisibleVariant(page);
  if (current !== expectedVariant) {
    throw new Error(`expected visible variant ${expectedVariant} before accept, got ${current}`);
  }
}

/**
 * Click Discard — sends discard event. live-accept.mjs unwinds the wrapper
 * and restores the original.
 */
export async function clickDiscard(page) {
  // The discard button has just a "✕" glyph as text content.
  await page.locator(`${BAR_ID} button`, { hasText: '✕' }).click();
}

export async function clickEditCopy(page) {
  await clickEditBadgeButton(page, 'Edit copy');
  await page.waitForFunction(
    () => document.querySelector('[data-impeccable-editable="true"]')?.isContentEditable === true,
    { timeout: 5_000 },
  );
}

export async function editTextLeaf(page, leafSelector, newText) {
  const leaf = page.locator(leafSelector).first();
  await leaf.waitFor({ state: 'visible', timeout: 5_000 });
  const editable = await resolveEditableLeaf(page, leafSelector);
  await editable.click({ timeout: 5_000 });
  await editable.fill(newText, { timeout: 5_000 });
}

async function resolveEditableLeaf(page, leafSelector) {
  const direct = page.locator(`${leafSelector}[contenteditable="true"]`).first();
  if (await direct.count()) return direct;
  const nested = page.locator(leafSelector).first().locator('[contenteditable="true"]').first();
  if (await nested.count()) return nested;
  return page.locator(leafSelector).first();
}

export async function clickSaveEdit(page) {
  await clickEditBadgeButton(page, 'Save');
  await page.waitForFunction(
    () => !document.querySelector('[data-impeccable-editable="true"]'),
    { timeout: 5_000 },
  );
}

async function clickEditBadgeButton(page, label) {
  const button = page.locator(`${EDIT_BADGE_ID} button`, { hasText: label });
  try {
    await button.click({ timeout: 5_000 });
    return;
  } catch (err) {
    const clicked = await page.evaluate(({ badgeSel, text }) => {
      const badge = document.querySelector(badgeSel);
      const btn = [...(badge?.querySelectorAll('button') || [])].find((candidate) =>
        (candidate.textContent || '').includes(text)
      );
      if (!btn) return false;
      btn.click();
      return true;
    }, { badgeSel: EDIT_BADGE_ID, text: label });
    if (!clicked) throw err;
  }
}

export async function assertApplyDockVisible(page, expectedCount, { timeout = 5_000 } = {}) {
  await page.waitForFunction(
    ({ dockSel, expected }) => {
      const dock = document.querySelector(dockSel);
      if (!dock || dock.style.display === 'none') return false;
      const pill = [...dock.querySelectorAll('button')].find((btn) =>
        /Apply copy edit/.test(btn.textContent || '')
      );
      if (!pill || pill.style.display === 'none') return false;
      if (expected == null) return true;
      return parseInt(pill.dataset.count || '0', 10) === expected;
    },
    { dockSel: PENDING_DOCK_ID, expected: expectedCount },
    { timeout },
  );
}

export async function waitForApplyDockHidden(page, { timeout = 10_000 } = {}) {
  await page.waitForFunction(
    (dockSel) => {
      const dock = document.querySelector(dockSel);
      if (!dock || dock.style.display === 'none') return true;
      const pill = [...dock.querySelectorAll('button')].find((btn) =>
        /Apply copy edit/.test(btn.textContent || '')
      );
      return !pill || pill.style.display === 'none' || parseInt(pill.dataset.count || '0', 10) === 0;
    },
    PENDING_DOCK_ID,
    { timeout },
  );
}

export async function assertApplyDockLoading(page, { timeout = 5_000 } = {}) {
  await page.waitForFunction(
    (dockSel) => {
      const dock = document.querySelector(dockSel);
      if (!dock || dock.style.display === 'none') return false;
      const pill = [...dock.querySelectorAll('button')].find((btn) =>
        /Apply copy edit|Applying|Verifying|Fixing apply issue/.test(btn.textContent || '')
      );
      if (!pill) return false;
      const spinner = dock.querySelector('[aria-hidden="true"]');
      return pill.disabled === true
        || pill.getAttribute('aria-busy') === 'true'
        || /Applying|Verifying|Fixing apply issue/.test(pill.textContent || '')
        || spinner?.style?.display === 'inline-block';
    },
    PENDING_DOCK_ID,
    { timeout },
  );
}

export async function clickApplyEdits(page) {
  const dialog = page.waitForEvent('dialog', { timeout: 5_000 })
    .then((d) => d.accept())
    .catch(() => {});
  await page.locator(`${PENDING_DOCK_ID} button`, { hasText: /Apply copy edit/ }).click({ timeout: 5_000 });
  await dialog;
}

export function assertSourceApplied(tmp, file, originalText, newText) {
  const body = readFileSync(join(tmp, file), 'utf-8');
  if (!body.includes(newText)) {
    throw new Error(`expected ${file} to include ${JSON.stringify(newText)}`);
  }
  if (originalText && !String(newText).includes(originalText) && body.includes(originalText)) {
    throw new Error(`expected ${file} not to include ${JSON.stringify(originalText)}`);
  }
}

/**
 * Wait for the bar to go away (after accept/discard the bar hides on confirm).
 */
export async function waitForBarHidden(page, { timeout = 10_000 } = {}) {
  await page.waitForFunction(
    (barSel) => {
      const bar = document.querySelector(barSel);
      return !bar || bar.style.display === 'none';
    },
    BAR_ID,
    { timeout },
  );
}

/**
 * Dismiss dev-tool overlays that intercept clicks on the live bar (Astro, etc.).
 * @param {import('playwright').Page} page
 */
export async function preparePageForBarInteraction(page) {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('astro-dev-toolbar')) {
      el.style.setProperty('display', 'none', 'important');
      el.style.setProperty('pointer-events', 'none', 'important');
    }
  });
}

async function focusSteerInput(page) {
  return page.evaluate(({ chatSel, inputSel }) => {
    const chat = document.querySelector(chatSel);
    const input = document.querySelector(inputSel);
    if (!chat || !input) return false;
    chat.dataset.expanded = 'true';
    chat.style.width = 'min(280px, 38vw)';
    chat.style.cursor = 'text';
    input.disabled = false;
    input.style.pointerEvents = 'auto';
    input.style.opacity = '1';
    input.style.width = 'auto';
    input.style.padding = '0 6px';
    try { window.focus(); } catch { /* embed may block */ }
    try { input.focus({ preventScroll: true }); } catch { input.focus(); }
    return document.activeElement === input;
  }, { chatSel: STEER_CHAT_ID, inputSel: STEER_INPUT_ID });
}

/**
 * Expand the Steer pill, type a message, and submit with Enter.
 * Uses a normal click when possible; falls back to direct focus when overlays
 * (e.g. Astro dev toolbar) intercept pointer events — same outcome as keyboard focus.
 */
export async function submitSteer(page, message) {
  await preparePageForBarInteraction(page);
  await page.locator(STEER_CHAT_ID).waitFor({ state: 'visible', timeout: 5_000 });

  try {
    await page.locator(STEER_CHAT_ID).click({ timeout: 2_500 });
  } catch {
    await focusSteerInput(page);
  }
  if (!(await focusSteerInput(page))) {
    await page.locator(STEER_CHAT_ID).click({ force: true, timeout: 2_500 }).catch(() => {});
    await focusSteerInput(page);
  }

  const input = page.locator(STEER_INPUT_ID);
  await input.fill(message, { timeout: 5_000 });
  await input.press('Enter');
}

/**
 * Poll until a marked hero is visible. Uses Playwright's visible check so
 * elements inside closed modals/tabs do not satisfy the assertion.
 */
export async function waitForSteerDomMarker(page, selector, { timeout = 20_000 } = {}) {
  const loc = page.locator(selector).first();
  await loc.waitFor({ state: 'visible', timeout });
}

/**
 * Steer bar enters processing mode after submit (handing off / working).
 */
export async function waitForSteerLocked(page, { timeout = 5_000 } = {}) {
  await page.waitForFunction(
    (sel) => document.querySelector(sel)?.dataset.processing === 'true',
    STEER_CHAT_ID,
    { timeout },
  );
}

/**
 * Steer bar unlocks after the agent replies steer_done over SSE.
 */
export async function waitForSteerUnlocked(page, { timeout = 15_000 } = {}) {
  await page.waitForFunction(
    (sel) => {
      const chat = document.querySelector(sel);
      const input = document.querySelector('#impeccable-live-page-chat-input');
      return chat?.dataset.processing !== 'true' && input && !input.disabled;
    },
    STEER_CHAT_ID,
    { timeout },
  );
}

async function ensureToggleActive(page, selector, shouldBeActive) {
  const isActive = await page.locator(selector).evaluate((el) => el?.dataset.active === 'true');
  if (isActive === shouldBeActive) return;
  await page.locator(selector).click({ timeout: 5_000 });
  await page.waitForFunction(
    ({ sel, active }) => document.querySelector(sel)?.dataset.active === (active ? 'true' : 'false'),
    { sel: selector, active: shouldBeActive },
    { timeout: 5_000 },
  );
}

/** Turn on Pick mode (and off Insert — they are mutually exclusive). */
export async function enablePickMode(page) {
  await ensureToggleActive(page, PICK_TOGGLE, true);
}

/** Turn on Insert mode (and off Pick — they are mutually exclusive). */
export async function enableInsertMode(page) {
  await ensureToggleActive(page, INSERT_TOGGLE, true);
}

/**
 * Insert flow: hover an anchor at before/after edge, click to place the
 * resizable placeholder, describe the new element, and click Create.
 */
export async function runInsertFlow(page, {
  anchorSelector,
  position = 'after',
  prompt = 'Add a testimonial strip',
} = {}) {
  await enableInsertMode(page);
  const anchor = await page.waitForSelector(anchorSelector, { timeout: 5_000 });
  const box = await anchor.boundingBox();
  if (!box) throw new Error(`anchor ${anchorSelector} has no layout box`);

  const x = box.x + box.width / 2;
  const y = position === 'before' ? box.y + 4 : box.y + box.height - 4;
  await page.mouse.move(x, y);
  await page.waitForFunction(() => {
    const line = document.getElementById('impeccable-live-insert-line');
    return line && line.style.display !== 'none';
  }, { timeout: 5_000 });
  await page.mouse.click(x, y);

  await page.waitForSelector(INSERT_INPUT_ID, { state: 'visible', timeout: 5_000 });
  await page.waitForSelector(BAR_ID, { state: 'visible', timeout: 5_000 });

  await page.evaluate(({ sel, value }) => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, { sel: INSERT_INPUT_ID, value: prompt });

  await page.waitForFunction(
    (sel) => {
      const btn = document.querySelector(sel);
      return btn && !btn.disabled;
    },
    INSERT_CREATE_ID,
    { timeout: 5_000 },
  );
  const clicked = await page.evaluate((sel) => {
    const btn = document.querySelector(sel);
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  }, INSERT_CREATE_ID);
  if (!clicked) {
    await page.locator(INSERT_CREATE_ID).click({ force: true, timeout: 5_000 });
  }
}
