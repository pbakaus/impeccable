/**
 * Playwright helpers that drive the live-mode bar UI exactly the way a user
 * would: pick an element, configure, Go, cycle, accept.
 *
 * Selector strategy: live-browser.js uses deterministic ids (`impeccable-live-*`)
 * for the global bar, per-element bar, action picker, and params panel. Buttons
 * inside the per-element bar are matched by visible text or unicode glyph
 * (`← / →`, `✓ Accept`, `✕`), or by aria-label for icon-only buttons (the
 * configure submit button). All selectors below come from
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
// The configure-row submit button is icon-only; its accessible name is the
// only stable handle (see buildConfigureSubmitButton in live-browser.js).
const GO_BUTTON_ARIA_LABEL = 'Generate variants';
const STEER_CHAT_ID = '#impeccable-live-page-chat';
const STEER_INPUT_ID = '#impeccable-live-page-chat-input';
const PICK_TOGGLE = '#impeccable-live-pick-toggle';
// Alias kept so references introduced via origin/main (PICK_TOGGLE_ID)
// continue to resolve to the same selector as the older PICK_TOGGLE name.
const PICK_TOGGLE_ID = PICK_TOGGLE;
const INSERT_TOGGLE = '#impeccable-live-insert-toggle';
const DETECT_TOGGLE = '#impeccable-live-detect-toggle';
const DETECT_BADGE = '#impeccable-live-detect-badge';
const DESIGN_TOGGLE = '#impeccable-live-design-toggle';
const DESIGN_HOST = '#impeccable-live-design-host';
const EXIT_BUTTON = '#impeccable-live-exit';
const INSERT_INPUT_ID = '#impeccable-live-insert-input';
const INSERT_CREATE_ID = '#impeccable-live-insert-create';
const ANNOTATION_ID = '#impeccable-live-annot';
const ANNOTATION_PINS_ID = '#impeccable-live-annot-pins';
const ANNOTATION_CLEAR_ID = '#impeccable-live-annot-clear';

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
  await installLiveQueryHelpers(page);
  await page.waitForFunction(
    (sel) => Boolean(window.__impeccableLiveQuery?.(sel)),
    GLOBAL_BAR_ID,
    { timeout },
  );
  // Wait for the picker mode to be active (live.js flips state PICKING after
  // SSE 'connected' arrives). We can detect it via the global bar's pick
  // toggle being in its ready state. Soft wait — fall through after a beat
  // even if the toggle hasn't visibly shifted.
  await page.waitForTimeout(250);
}

export async function assertBottomBarIdle(page, { timeout = 5_000 } = {}) {
  await installLiveQueryHelpers(page);
  await page.waitForFunction(
    ({ ids }) => ids.every((sel) => Boolean(window.__impeccableLiveQuery(sel))),
    {
      ids: [
        GLOBAL_BAR_ID,
        PICK_TOGGLE,
        INSERT_TOGGLE,
        DETECT_TOGGLE,
        DESIGN_TOGGLE,
        STEER_CHAT_ID,
        STEER_INPUT_ID,
        '#impeccable-live-page-chat-voice',
        EXIT_BUTTON,
      ],
    },
    { timeout },
  );
  const snapshot = await page.evaluate(({ pickSel, insertSel, detectSel, designSel }) => {
    const q = window.__impeccableLiveQuery;
    return {
      pick: controlSnapshot(q(pickSel)),
      insert: controlSnapshot(q(insertSel)),
      detect: controlSnapshot(q(detectSel)),
      design: controlSnapshot(q(designSel)),
    };

    function controlSnapshot(el) {
      return {
        exists: !!el,
        text: (el?.textContent || '').replace(/\s+/g, ' ').trim(),
        ariaLabel: el?.getAttribute('aria-label') || '',
        active: el?.dataset?.active || null,
        disabled: !!el?.disabled,
      };
    }
  }, {
    pickSel: PICK_TOGGLE,
    insertSel: INSERT_TOGGLE,
    detectSel: DETECT_TOGGLE,
    designSel: DESIGN_TOGGLE,
  });
  for (const [name, value] of Object.entries(snapshot)) {
    if (!value.exists) throw new Error(`bottom bar ${name} control is missing`);
    if (value.disabled) throw new Error(`bottom bar ${name} control unexpectedly disabled`);
  }
}

export async function runLiveChromeBottomBarSmoke(page, {
  expectDetectMinCount = 1,
  designTitle = '',
  designRawText = '',
} = {}) {
  await assertBottomBarIdle(page);
  await runPickInsertToggleSmoke(page);
  await runDetectSmoke(page, { expectMinCount: expectDetectMinCount });
  await runDesignPanelSmoke(page, { title: designTitle, rawText: designRawText });
}

function installLiveQueryHelpersInPage() {
  window.__impeccableLiveQuery = (selector) => {
    const root = window.__IMPECCABLE_LIVE_CHROME_CORE__?.root?.()
      || window.__IMPECCABLE_LIVE_UI_ROOT__
      || null;
    return root?.querySelector?.(selector) || document.querySelector(selector);
  };
  window.__impeccableLiveQueryAll = (selector) => {
    const root = window.__IMPECCABLE_LIVE_CHROME_CORE__?.root?.()
      || window.__IMPECCABLE_LIVE_UI_ROOT__
      || null;
    const fromRoot = root?.querySelectorAll ? [...root.querySelectorAll(selector)] : [];
    const fromDoc = [...document.querySelectorAll(selector)];
    return [...new Set([...fromRoot, ...fromDoc])];
  };
}

export async function installLiveQueryHelpers(page, { timeout = 5_000 } = {}) {
  await page.addInitScript(installLiveQueryHelpersInPage).catch(() => {});
  await withTimeout(
    page.evaluate(installLiveQueryHelpersInPage),
    timeout,
    'install live query helpers',
  );
}

function withTimeout(promise, timeout, label) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeout}ms`)), timeout);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

async function clickLiveControl(page, selector) {
  await installLiveQueryHelpers(page);
  const clicked = await page.evaluate((sel) => {
    const el = window.__impeccableLiveQuery(sel);
    if (!el || el.disabled) return false;
    el.click();
    return true;
  }, selector);
  if (clicked) return;
  await page.locator(selector).click({ timeout: 5_000 });
}

async function readControlActive(page, selector) {
  await installLiveQueryHelpers(page);
  return page.evaluate((sel) => window.__impeccableLiveQuery(sel)?.dataset.active === 'true', selector);
}

async function ensureLiveControlActive(page, selector, active) {
  if (await readControlActive(page, selector) === active) return;
  await clickLiveControl(page, selector);
  await page.waitForFunction(
    ({ sel, expected }) => window.__impeccableLiveQuery(sel)?.dataset.active === (expected ? 'true' : 'false'),
    { sel: selector, expected: active },
    { timeout: 5_000 },
  );
}

export async function runPickInsertToggleSmoke(page) {
  await ensureLiveControlActive(page, PICK_TOGGLE, true);
  await page.waitForFunction(
    ({ pickSel, insertSel }) =>
      window.__impeccableLiveQuery(pickSel)?.dataset.active === 'true'
      && window.__impeccableLiveQuery(insertSel)?.dataset.active === 'false',
    { pickSel: PICK_TOGGLE, insertSel: INSERT_TOGGLE },
    { timeout: 5_000 },
  );

  await ensureLiveControlActive(page, INSERT_TOGGLE, true);
  await page.waitForFunction(
    ({ pickSel, insertSel }) =>
      window.__impeccableLiveQuery(pickSel)?.dataset.active === 'false'
      && window.__impeccableLiveQuery(insertSel)?.dataset.active === 'true',
    { pickSel: PICK_TOGGLE, insertSel: INSERT_TOGGLE },
    { timeout: 5_000 },
  );

  await ensureLiveControlActive(page, INSERT_TOGGLE, false);
  await ensureLiveControlActive(page, PICK_TOGGLE, false);
}

export async function runDetectSmoke(page, { expectMinCount = 1 } = {}) {
  await ensureLiveControlActive(page, DETECT_TOGGLE, true);
  await page.waitForFunction(
    ({ badgeSel, expectMin }) => {
      const badge = window.__impeccableLiveQuery(badgeSel);
      const count = parseInt(badge?.textContent || '0', 10);
      const overlays = document.querySelectorAll('.impeccable-overlay').length;
      return count >= expectMin && overlays >= expectMin && badge?.style.display !== 'none';
    },
    { badgeSel: DETECT_BADGE, expectMin: expectMinCount },
    { timeout: 15_000 },
  );

  await ensureLiveControlActive(page, PICK_TOGGLE, true);
  await page.waitForFunction(
    () => [...document.querySelectorAll('.impeccable-overlay')]
      .every((overlay) => overlay.style.pointerEvents === 'none'),
    { timeout: 5_000 },
  );
  await ensureLiveControlActive(page, PICK_TOGGLE, false);

  await ensureLiveControlActive(page, DETECT_TOGGLE, false);
  await page.waitForFunction(
    ({ badgeSel }) => {
      const badge = window.__impeccableLiveQuery(badgeSel);
      return document.querySelectorAll('.impeccable-overlay').length === 0
        && (!badge || badge.style.display === 'none' || (badge.textContent || '') === '0');
    },
    { badgeSel: DETECT_BADGE },
    { timeout: 5_000 },
  );
}

export async function runDesignPanelSmoke(page, { title = '', rawText = '' } = {}) {
  await ensureLiveControlActive(page, DESIGN_TOGGLE, true);
  await page.waitForFunction(
    ({ hostSel, titleText }) => {
      const host = window.__impeccableLiveQuery(hostSel);
      const root = host?.shadowRoot;
      const panel = root?.querySelector('.panel');
      const bodyText = root?.querySelector('#panel-body')?.textContent || '';
      return panel?.getAttribute('data-open') === 'true'
        && bodyText.trim().length > 0
        && !bodyText.includes('Loading design system')
        && !bodyText.includes('No DESIGN.md yet')
        && !bodyText.includes('Failed to load design system')
        && (!titleText || bodyText.includes(titleText));
    },
    { hostSel: DESIGN_HOST, titleText: title },
    { timeout: 15_000 },
  );

  await page.evaluate((hostSel) => {
    const root = window.__impeccableLiveQuery(hostSel)?.shadowRoot;
    const raw = [...(root?.querySelectorAll('.tab') || [])].find((btn) => /Raw/i.test(btn.textContent || ''));
    raw?.click();
  }, DESIGN_HOST);
  await page.waitForFunction(
    ({ hostSel, expected }) => {
      const text = window.__impeccableLiveQuery(hostSel)?.shadowRoot?.textContent || '';
      return !expected || text.includes(expected);
    },
    { hostSel: DESIGN_HOST, expected: rawText },
    { timeout: 10_000 },
  );

  await page.evaluate((hostSel) => {
    const root = window.__impeccableLiveQuery(hostSel)?.shadowRoot;
    root?.querySelector('.panel-close')?.click();
  }, DESIGN_HOST);
  await page.waitForFunction(
    ({ hostSel, toggleSel }) => {
      const panel = window.__impeccableLiveQuery(hostSel)?.shadowRoot?.querySelector('.panel');
      const toggle = window.__impeccableLiveQuery(toggleSel);
      return panel?.getAttribute('data-open') === 'false' && toggle?.dataset.active === 'false';
    },
    { hostSel: DESIGN_HOST, toggleSel: DESIGN_TOGGLE },
    { timeout: 5_000 },
  );
}

export async function clickExitLiveMode(page) {
  await clickLiveControl(page, EXIT_BUTTON);
  await page.waitForFunction(
    ({ barSel }) => {
      const bar = window.__impeccableLiveQuery?.(barSel);
      return window.__IMPECCABLE_LIVE_INIT__ === false && (!bar || !bar.isConnected);
    },
    { barSel: GLOBAL_BAR_ID },
    { timeout: 5_000 },
  );
}

export async function drawAnnotationPinAndStroke(page, {
  comment = 'Make this area easier to scan',
} = {}) {
  await installLiveQueryHelpers(page);
  const rect = await waitForAnnotationRect(page);
  const pinPoint = {
    x: rect.left + Math.min(28, Math.max(12, rect.width * 0.2)),
    y: rect.top + Math.min(28, Math.max(12, rect.height * 0.35)),
  };
  await page.mouse.click(pinPoint.x, pinPoint.y);
  await page.waitForFunction(
    (pinsSel) => Boolean(window.__impeccableLiveQuery(pinsSel)?.querySelector('input')),
    ANNOTATION_PINS_ID,
    { timeout: 5_000 },
  );
  await page.evaluate(({ pinsSel, value }) => {
    const input = window.__impeccableLiveQuery(pinsSel)?.querySelector('input');
    if (!input) return false;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return true;
  }, { pinsSel: ANNOTATION_PINS_ID, value: comment });
  await page.waitForFunction(
    ({ pinsSel, expected }) => {
      const pins = window.__impeccableLiveQuery(pinsSel);
      return pins && pins.textContent.includes(expected);
    },
    { pinsSel: ANNOTATION_PINS_ID, expected: comment },
    { timeout: 5_000 },
  );

  const strokeStart = { x: rect.left + rect.width * 0.58, y: rect.top + rect.height * 0.28 };
  const strokeEnd = { x: rect.left + rect.width * 0.86, y: rect.top + rect.height * 0.72 };
  await page.mouse.move(strokeStart.x, strokeStart.y);
  await page.mouse.down();
  await page.mouse.move((strokeStart.x + strokeEnd.x) / 2, (strokeStart.y + strokeEnd.y) / 2, { steps: 4 });
  await page.mouse.move(strokeEnd.x, strokeEnd.y, { steps: 4 });
  await page.mouse.up();

  await page.waitForFunction(
    ({ annotSel, clearSel }) => {
      const annot = window.__impeccableLiveQuery(annotSel);
      const clear = window.__impeccableLiveQuery(clearSel);
      const stroke = annot?.querySelector('[data-annot-stroke]');
      return Boolean(stroke) && clear?.style.display !== 'none';
    },
    { annotSel: ANNOTATION_ID, clearSel: ANNOTATION_CLEAR_ID },
    { timeout: 5_000 },
  );
}

export async function assertAnnotationUploadEvent(event) {
  if (!event) throw new Error('expected recorded generate event');
  if (!Array.isArray(event.comments) || event.comments.length < 1) {
    throw new Error('expected generate event to include annotation comments');
  }
  if (!Array.isArray(event.strokes) || event.strokes.length < 1) {
    throw new Error('expected generate event to include annotation strokes');
  }
  if (!event.screenshotPath || typeof event.screenshotPath !== 'string') {
    throw new Error('expected generate event to include screenshotPath');
  }
}

async function waitForAnnotationRect(page) {
  await page.waitForFunction(
    (sel) => {
      const el = window.__impeccableLiveQuery(sel);
      if (!el || el.style.display === 'none') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 20 && rect.height > 20;
    },
    ANNOTATION_ID,
    { timeout: 5_000 },
  );
  return page.evaluate((sel) => {
    const rect = window.__impeccableLiveQuery(sel).getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  }, ANNOTATION_ID);
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
  // Wait specifically for the Configure-row submit button to be in the bar.
  // pickElement returning before that race-conditions with clickGo on
  // fixtures whose framework re-renders right after pick (modal open, tab
  // switch). Anchoring the wait on the submit button's accessible name is
  // robust: the bar can be visible-but-empty (state=PICKING) before
  // showBar('configure') populates the row, and the button itself is
  // icon-only.
  await page.waitForFunction(
    ({ barSel, goLabel }) => {
      const bar = window.__impeccableLiveQuery(barSel);
      if (!bar) return false;
      const btns = [...bar.querySelectorAll('button')];
      return btns.some((b) => (b.getAttribute('aria-label') || '') === goLabel);
    },
    { barSel: BAR_ID, goLabel: GO_BUTTON_ARIA_LABEL },
    { timeout: 5_000 },
  );
}

async function hideAnnotationOverlay(page) {
  await page.evaluate(() => {
    const annot = window.__impeccableLiveQuery('#impeccable-live-annot');
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
    const btn = window.__impeccableLiveQuery(sel);
    if (!btn) return false;
    btn.click();
    return true;
  }, PICK_TOGGLE_ID);
  if (!clicked) {
    await page.locator(PICK_TOGGLE_ID).click({ timeout: 5_000 });
  }
  await page.waitForFunction(
    (sel) => window.__impeccableLiveQuery(sel)?.dataset.active === 'true',
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
    const btn = window.__impeccableLiveQuery(sel);
    if (!btn) return;
    const active = btn.dataset.active === 'true';
    if (active) btn.click();
    btn.click();
  }, PICK_TOGGLE_ID).catch(() => {});
  await page.waitForFunction(
    (sel) => window.__impeccableLiveQuery(sel)?.dataset.active === 'true',
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
      const bar = window.__impeccableLiveQuery(barSel);
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
    await clickBarButton(page, { ariaLabel: GO_BUTTON_ARIA_LABEL });
    const advanced = await page.waitForFunction(
      ({ barSel, goLabel }) => {
        const bar = window.__impeccableLiveQuery(barSel);
        if (!bar) return false;
        const text = bar.textContent || '';
        if (/Generating\b/.test(text)) return true;
        if (/\d+\s*\/\s*\d+/.test(text)) return true;
        return ![...bar.querySelectorAll('button')].some((button) => (button.getAttribute('aria-label') || '') === goLabel);
      },
      { barSel: BAR_ID, goLabel: GO_BUTTON_ARIA_LABEL },
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
  await installLiveQueryHelpers(page);
  try {
    await page.waitForFunction(
    ({ barSel, expected }) => {
      const bar = window.__impeccableLiveQuery(barSel);
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
  } catch (err) {
    if (process.env.IMPECCABLE_E2E_DEBUG) {
      const snapshot = await page.evaluate((barSel) => {
        const query = window.__impeccableLiveQuery || ((sel) => document.querySelector(sel));
        const root = window.__IMPECCABLE_LIVE_CHROME_CORE__?.root?.() || window.__IMPECCABLE_LIVE_UI_ROOT__ || null;
        const bar = query(barSel);
        const toast = query('#impeccable-live-toast');
        const wrapper = document.querySelector('[data-impeccable-variants]');
        return {
          liveInit: window.__IMPECCABLE_LIVE_INIT__,
          adapter: window.__IMPECCABLE_LIVE_ADAPTER__,
          rootText: root?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 600) || null,
          bar: bar ? { display: bar.style.display, text: bar.textContent } : null,
          toast: toast?.textContent || null,
          wrapper: wrapper ? { preview: wrapper.dataset.impeccablePreview, count: wrapper.dataset.impeccableVariantCount, html: wrapper.outerHTML.slice(0, 600) } : null,
          debugState: window.__IMPECCABLE_LIVE_CHROME_CORE__?.debugState?.() || null,
          storage: localStorage.getItem('impeccable-live-session'),
          scripts: document.querySelectorAll('script[data-impeccable-live-script]').length,
          bodyText: document.body.textContent.replace(/\s+/g, ' ').trim().slice(0, 600),
        };
      }, BAR_ID).catch((snapErr) => ({ error: snapErr.message }));
      console.error('--- waitForCycling snapshot ---\n' + JSON.stringify(snapshot, null, 2));
    }
    throw err;
  }
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

function barButtonMatch(label) {
  if (label instanceof RegExp) return { kind: 'regex', source: label.source, flags: label.flags };
  if (label && typeof label === 'object' && label.ariaLabel) return { kind: 'aria', value: label.ariaLabel };
  return { kind: 'text', value: String(label) };
}

async function clickBarButton(page, label) {
  const textMatch = barButtonMatch(label);
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await installLiveQueryHelpers(page);
      const button = textMatch.kind === 'aria'
        ? page.locator(`${BAR_ID} button[aria-label="${textMatch.value}"]`)
        : page.locator(`${BAR_ID} button`, { hasText: label });
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
  try {
    await installLiveQueryHelpers(page);
    const textMatch = barButtonMatch(label);
    return await withTimeout(
      page.evaluate(findAndClickBarButton, { barSel: BAR_ID, textMatch }),
      5_000,
      'dispatch bar button',
    );
  } catch {
    return false;
  }
}

function findAndClickBarButton({ barSel, textMatch }) {
  const bar = window.__impeccableLiveQuery(barSel);
  if (!bar) return false;
  const btn = [...bar.querySelectorAll('button')]
    .find((candidate) => {
      const text = candidate.textContent || '';
      if (textMatch.kind === 'regex') return new RegExp(textMatch.source, textMatch.flags).test(text);
      if (textMatch.kind === 'aria') return (candidate.getAttribute('aria-label') || '') === textMatch.value;
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
  try {
    await installLiveQueryHelpers(page);
    return await withTimeout(
      page.evaluate((barSel) => {
        const wrapper = window.__impeccableLiveQuery('[data-impeccable-variants]');
        if (wrapper) {
          const variants = [...wrapper.querySelectorAll('[data-impeccable-variant]:not([data-impeccable-variant="original"])')];
          const visible = variants.find((variant) => variant.style.display !== 'none');
          const idx = visible ? parseInt(visible.dataset.impeccableVariant || '0', 10) : 0;
          if (idx > 0) return idx;
        }
        const bar = window.__impeccableLiveQuery(barSel);
        if (!bar) return null;
        const m = (bar.textContent || '').match(/(\d+)\s*\/\s*(\d+)/);
        return m ? parseInt(m[1], 10) : null;
      }, BAR_ID),
      5_000,
      'read visible variant',
    );
  } catch {
    return null;
  }
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
    () => window.__impeccableLiveQuery('[data-impeccable-editable="true"]')?.isContentEditable === true,
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
    () => !window.__impeccableLiveQuery('[data-impeccable-editable="true"]'),
    { timeout: 5_000 },
  );
}

async function clickEditBadgeButton(page, label) {
  const proxyRect = await page.evaluate((text) => {
    const proxies = [...document.querySelectorAll('[data-impeccable-edit-badge-proxy="true"]')];
    const proxy = proxies.find((candidate) =>
      (candidate.title || candidate.getAttribute('aria-label') || '').includes(text)
    );
    if (!proxy) return null;
    const rect = proxy.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, label).catch(() => null);
  if (proxyRect) {
    await page.mouse.click(proxyRect.x, proxyRect.y);
    return;
  }
  const button = page.locator(`${EDIT_BADGE_ID} button`, { hasText: label });
  try {
    await button.click({ timeout: 5_000 });
    return;
  } catch (err) {
    const clicked = await page.evaluate(({ badgeSel, text }) => {
      const badge = window.__impeccableLiveQuery(badgeSel);
      const btn = [...(badge?.querySelectorAll('button') || [])].find((candidate) =>
        (candidate.textContent || candidate.getAttribute('aria-label') || candidate.title || '').includes(text)
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
      const dock = window.__impeccableLiveQuery(dockSel);
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
      const dock = window.__impeccableLiveQuery(dockSel);
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
      const dock = window.__impeccableLiveQuery(dockSel);
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
  await installLiveQueryHelpers(page);
  await page.waitForFunction(
    (barSel) => {
      const bar = window.__impeccableLiveQuery(barSel);
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
    for (const el of window.__impeccableLiveQueryAll('astro-dev-toolbar')) {
      el.style.setProperty('display', 'none', 'important');
      el.style.setProperty('pointer-events', 'none', 'important');
    }
  });
}

export async function waitForSteerInputFocused(page, { timeout = 5_000 } = {}) {
  await page.waitForFunction(
    (inputSel) => {
      const input = window.__impeccableLiveQuery(inputSel);
      const active = window.__IMPECCABLE_LIVE_CHROME_CORE__?.activeElementDeep?.()
        || input?.getRootNode?.()?.activeElement
        || document.activeElement;
      return Boolean(input && active === input && input.style.pointerEvents !== 'none' && input.style.opacity !== '0');
    },
    STEER_INPUT_ID,
    { timeout },
  );
}

export async function waitForSteerInputValue(page, value, { timeout = 5_000 } = {}) {
  await page.waitForFunction(
    ({ inputSel, value: expected }) => window.__impeccableLiveQuery(inputSel)?.value === expected,
    { inputSel: STEER_INPUT_ID, value },
    { timeout },
  );
}

/**
 * Expand the Steer pill, type a message, and submit with Enter.
 * Uses a normal click when possible; falls back to direct focus when overlays
 * (e.g. Astro dev toolbar) intercept pointer events — same outcome as keyboard focus.
 */
export async function submitSteer(page, message) {
  await installLiveQueryHelpers(page);
  await preparePageForBarInteraction(page);
  const chat = page.locator(STEER_CHAT_ID);
  await chat.waitFor({ state: 'visible', timeout: 5_000 });

  try {
    await chat.click({ timeout: 2_500 });
  } catch {
    await chat.click({ force: true, timeout: 2_500 });
  }
  await waitForSteerInputFocused(page);

  const input = page.locator(STEER_INPUT_ID);
  await input.type(message, { timeout: 5_000 });
  await waitForSteerInputValue(page, message);
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
    (sel) => window.__impeccableLiveQuery(sel)?.dataset.processing === 'true',
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
      const chat = window.__impeccableLiveQuery(sel);
      const input = window.__impeccableLiveQuery('#impeccable-live-page-chat-input');
      return chat?.dataset.processing !== 'true' && input && !input.disabled;
    },
    STEER_CHAT_ID,
    { timeout },
  );
}

async function ensureToggleActive(page, selector, shouldBeActive) {
  await installLiveQueryHelpers(page);
  const isActive = await page.locator(selector).evaluate((el) => el?.dataset.active === 'true');
  if (isActive === shouldBeActive) return;
  await page.locator(selector).click({ timeout: 5_000 });
  await page.waitForFunction(
    ({ sel, active }) => window.__impeccableLiveQuery(sel)?.dataset.active === (active ? 'true' : 'false'),
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
    const line = window.__impeccableLiveQuery('#impeccable-live-insert-line');
    return line && line.style.display !== 'none';
  }, { timeout: 5_000 });
  await page.mouse.click(x, y);

  await installLiveQueryHelpers(page);
  await page.waitForFunction(
    ({ inputSel, barSel }) => {
      const input = window.__impeccableLiveQuery(inputSel);
      const bar = window.__impeccableLiveQuery(barSel);
      if (!input || !bar) return false;
      const rect = input.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && bar.style.display !== 'none';
    },
    { inputSel: INSERT_INPUT_ID, barSel: BAR_ID },
    { timeout: 5_000 },
  );

  const focused = await page.evaluate((sel) => {
    const el = window.__impeccableLiveQuery(sel);
    if (!el) return false;
    try { el.focus({ preventScroll: true }); } catch { el.focus(); }
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    return active === el;
  }, INSERT_INPUT_ID);
  if (!focused) throw new Error('Insert prompt input did not receive focus');

  await page.keyboard.type(prompt);
  await page.waitForFunction(
    ({ sel, value }) => window.__impeccableLiveQuery(sel)?.value === value,
    { sel: INSERT_INPUT_ID, value: prompt },
    { timeout: 5_000 },
  );

  await page.waitForFunction(
    (sel) => {
      const btn = window.__impeccableLiveQuery(sel);
      return btn && !btn.disabled;
    },
    INSERT_CREATE_ID,
    { timeout: 5_000 },
  );
  const clicked = await page.evaluate((sel) => {
    const btn = window.__impeccableLiveQuery(sel);
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  }, INSERT_CREATE_ID);
  if (!clicked) {
    await page.locator(INSERT_CREATE_ID).click({ force: true, timeout: 5_000 });
  }
}
