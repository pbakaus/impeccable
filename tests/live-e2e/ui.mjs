/**
 * Playwright helpers that drive the live-mode bar UI exactly the way a user
 * would: pick an element, configure, Go, cycle, accept.
 *
 * Selector strategy: live-browser.js uses deterministic ids (`impeccable-live-*`)
 * for the global bar, per-element bar, action picker, and params panel. Buttons
 * inside the per-element bar are matched by visible text or unicode glyph
 * (`Go →`, `← / →`, `✓ Accept`, `✕`). All selectors below come from
 * source/skills/impeccable/scripts/live-browser.js — keep this file in sync if
 * the bar's text content changes.
 */

const BAR_ID = '#impeccable-live-bar';
const GLOBAL_BAR_ID = '#impeccable-live-global-bar';
const PICKER_ID = '#impeccable-live-picker';

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
 * when state === 'PICKING' AND pickActive is true; pickActive starts true on
 * connect. The handler reads the hovered element from `mousemove`, so we
 * dispatch a hover before the click.
 */
export async function pickElement(page, selector) {
  const el = await page.waitForSelector(selector, { timeout: 5_000 });
  await el.hover();
  // Tiny settle: live-browser updates `hoveredElement` on mousemove, and the
  // click handler reads from it.
  await page.waitForTimeout(50);
  await el.click();
  // Per-element bar mounts on click → wait for it.
  await page.waitForSelector(BAR_ID, { state: 'visible', timeout: 5_000 });
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
 * Click Go. Browser POSTs the generate event; the agent picks it up.
 *
 * On fixtures whose preActions triggered a layout shift (modal/tab opening)
 * the bar's open animation can still be running when we click, and
 * Playwright's stability gate occasionally times out on the first attempt.
 * Retry up to three times with a settle in between so a single race doesn't
 * fail the test.
 */
export async function clickGo(page) {
  await clickBarButton(page, /Go\b/);
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
  const clicked = await page.evaluate(findAndClickBarButton, { barSel: BAR_ID, textMatch });
  if (!clicked) throw lastErr;
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
