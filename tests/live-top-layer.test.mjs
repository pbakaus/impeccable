/**
 * Live chrome stays usable while a native modal <dialog> is open (issue #879).
 *
 * showModal() puts the dialog in the top layer and makes everything outside
 * its subtree inert, so chrome on <body> neither shows nor takes clicks. Real
 * pointer input only: a synthetic el.click() bypasses inertness and would pass
 * on the broken code.
 *
 * Needs Playwright Chromium (npx playwright install chromium); no engine
 * binary or dev server. Run with: node --test tests/live-top-layer.test.mjs
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOST = '#impeccable-live-top-layer';

const PAGE = `
  <button id="open" onclick="d.showModal()">Open</button>
  <p id="outside">Outside</p>
  <dialog id="d" style="transform: translateX(0); overflow: hidden">
    <p id="inside">Inside</p>
    <button id="close" onclick="d.close()">Close</button>
    <dialog id="d2"><p>Nested</p></dialog>
  </dialog>
  <dialog id="e1"><p>First</p></dialog>
  <dialog id="e2"><p>Second</p></dialog>
  <dialog id="e3"><p>Third</p></dialog>
  <div style="height: 2000px"></div>`;

let browser;
let page;

before(async () => {
  let playwright;
  try {
    playwright = await import('playwright');
    browser = await playwright.chromium.launch({ headless: true });
  } catch (err) {
    throw new Error(`Playwright Chromium is required (${err.message}). Run: npx playwright install chromium`);
  }
});

after(async () => {
  if (browser) await browser.close();
});

beforeEach(async () => {
  page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.setContent(PAGE);
  await page.addScriptTag({ path: join(ROOT, 'skill/scripts/live-browser-dom.js') });
  await page.evaluate(() => {
    const h = window.__IMPECCABLE_LIVE_DOM__.createLiveBrowserDomHelpers({ prefix: 'impeccable-live', document });
    const bar = document.createElement('div');
    bar.id = 'impeccable-live-bar';
    bar.style.cssText = 'position: fixed; left: 20px; bottom: 20px; width: 160px; height: 40px; z-index: 100005';
    bar.textContent = 'Live bar';
    bar.onclick = () => { window.clicks = (window.clicks || 0) + 1; };
    h.uiAppend(bar);
    window.live = h;
    window.stopWatch = h.watchModalDialogs();
  });
});

afterEach(async () => {
  await page.close();
});

async function click(selector) {
  const box = await page.locator(selector).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

const clicks = () => page.evaluate(() => window.clicks || 0);
const parentOf = (selector) => page.evaluate((s) => document.querySelector(s).parentElement?.id || null, selector);

describe('live chrome under a modal dialog', () => {
  it('stays clickable while a modal is open and returns to body on close', async () => {
    await click('#impeccable-live-bar');
    assert.equal(await clicks(), 1);

    await click('#open');
    await click('#impeccable-live-bar');
    assert.equal(await clicks(), 2);
    assert.equal(await page.evaluate(() => {
      const r = document.getElementById('impeccable-live-bar').getBoundingClientRect();
      return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2).id;
    }), 'impeccable-live-bar');
    assert.equal(await parentOf('#impeccable-live-bar'), 'impeccable-live-top-layer');
    assert.equal(await parentOf(HOST), 'd');

    // Chrome mounted while the modal is open lands in the same host.
    await page.evaluate(() => {
      const el = document.createElement('div');
      el.id = 'impeccable-live-late';
      window.live.uiAppend(el);
    });
    assert.equal(await parentOf('#impeccable-live-late'), 'impeccable-live-top-layer');

    await click('#close');
    assert.equal(await page.evaluate(() => document.querySelector('#impeccable-live-top-layer')), null);
    assert.equal(await page.evaluate(() => document.getElementById('impeccable-live-bar').parentNode === document.body), true);
    assert.equal(await page.evaluate(() => document.getElementById('impeccable-live-late').parentNode === document.body), true);
    await click('#impeccable-live-bar');
    assert.equal(await clicks(), 3);
  });

  it('follows the topmost of nested modals', async () => {
    await page.evaluate(() => d.showModal());
    await page.evaluate(() => d2.showModal());
    assert.equal(await parentOf(HOST), 'd2');
    await click('#impeccable-live-bar');
    assert.equal(await clicks(), 1);

    // Rewriting `open` on the lower modal does not raise it.
    await page.evaluate(() => d.setAttribute('open', ''));
    assert.equal(await parentOf(HOST), 'd2');
    await click('#impeccable-live-bar');
    assert.equal(await clicks(), 2);

    await page.evaluate(() => d2.close());
    assert.equal(await parentOf(HOST), 'd');
  });

  it('stays above a modal closed and reopened in one task', async () => {
    await page.evaluate(() => d.showModal());
    await page.evaluate(() => { d.close(); d.showModal(); });
    await click('#impeccable-live-bar');
    assert.equal(await clicks(), 1);
  });

  it('keeps chrome clicks out of the dialog handlers', async () => {
    // A common light-dismiss: close when a click lands outside the dialog box.
    await page.evaluate(() => d.addEventListener('click', (e) => {
      const r = d.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close();
    }));
    await page.evaluate(() => d.showModal());
    await click('#impeccable-live-bar');
    assert.equal(await clicks(), 1);
    assert.equal(await page.evaluate(() => d.open), true);
  });

  it('parks in the topmost of modals already open when watching starts', async () => {
    // Opened against document order, so document order would pick e3, then e2.
    await page.evaluate(() => { window.stopWatch(); e3.showModal(); e1.showModal(); e2.showModal(); window.live.watchModalDialogs(); });
    assert.equal(await parentOf(HOST), 'e2');
    await click('#impeccable-live-bar');
    assert.equal(await clicks(), 1);

    await page.evaluate(() => e2.close());
    assert.equal(await parentOf(HOST), 'e1');
    await click('#impeccable-live-bar');
    assert.equal(await clicks(), 2);
  });

  it('leaves parked chrome out of a copy of the picked dialog', async () => {
    await page.evaluate(() => d.showModal());
    const copy = await page.evaluate(() => {
      const clone = window.live.cloneWithoutChrome(d);
      return { host: d.contains(window.live.topLayerHost), parked: !!clone.querySelector('[id^="impeccable-live"]'), text: clone.textContent };
    });
    assert.equal(copy.host, true);
    assert.equal(copy.parked, false);
    assert.doesNotMatch(copy.text, /Live bar/);
    assert.match(copy.text, /Inside/);
  });

  it('puts the chrome back when an open modal is removed from the document', async () => {
    await page.evaluate(() => d.showModal());
    assert.equal(await parentOf(HOST), 'd');

    await page.evaluate(() => d.remove());
    assert.equal(await page.evaluate(() => document.getElementById('impeccable-live-bar').parentNode === document.body), true);
    assert.equal(await page.evaluate(() => document.querySelector('#impeccable-live-top-layer')), null);
  });

  it('mounts detect outlines for targets inside the modal in the host', async () => {
    await page.addScriptTag({ path: join(ROOT, 'browser-bundle/40-overlay.js') });
    await page.evaluate(() => {
      window.overlay = createImpeccableOverlay({ extensionMode: true, antipatterns: [{ id: 'x', name: 'X', category: 'slop' }] });
      for (const id of ['inside', 'outside']) {
        window.overlay.highlight(document.getElementById(id), [{ type: 'x', detail: id }]);
      }
    });
    const outlineParent = (id) => page.evaluate((target) => {
      const o = window.overlay.overlays.find((el) => el._targetEl.id === target);
      return o.parentNode === document.body ? 'body' : o.parentNode.id;
    }, id);
    assert.equal(await outlineParent('inside'), 'body');

    // The outline made while the dialog was closed moves in once it opens,
    // and still lines up with its target on a scrolled page.
    await page.evaluate(() => { scrollTo(0, 300); d.showModal(); });
    await page.waitForFunction(
      () => window.overlay.overlays.some((o) => o.parentNode.id === 'impeccable-live-top-layer' && o.style.display !== 'none'),
      null,
      { timeout: 5000 },
    );
    assert.equal(await outlineParent('inside'), 'impeccable-live-top-layer');
    assert.equal(await outlineParent('outside'), 'body');
    const [outline, target] = await page.evaluate(() => {
      const o = window.overlay.overlays.find((el) => el._targetEl.id === 'inside').getBoundingClientRect();
      const t = document.getElementById('inside').getBoundingClientRect();
      return [[o.top + 2, o.left + 2], [t.top, t.left]];
    });
    assert.deepEqual(outline.map(Math.round), target.map(Math.round));

    // One made while it is open mounts there directly.
    const direct = await page.evaluate(() => {
      window.overlay.highlight(document.getElementById('inside'), [{ type: 'x', detail: 'again' }]);
      return window.overlay.overlays.at(-1).parentNode.id;
    });
    assert.equal(direct, 'impeccable-live-top-layer');

    // A modal opened above takes the host, but an outline for the dialog
    // underneath stays under that modal, and returns when it closes.
    await page.evaluate(() => d2.showModal());
    assert.equal(await parentOf(HOST), 'd2');
    assert.equal(await outlineParent('inside'), 'body');
    await page.evaluate(() => d2.close());
    assert.equal(await outlineParent('inside'), 'impeccable-live-top-layer');
  });
});
