/**
 * Canonical inventory of the Live overlay's UI surfaces: one entry per piece of
 * chrome Live mounts on the user's page, with the element ids that make it up.
 *
 * Single source of truth, consumed by:
 *   - skill/scripts/live/browser-script-parts.mjs — serializes this into
 *     window.__IMPECCABLE_LIVE_UI_SURFACES__ in the /live.js prelude.
 *   - skill/scripts/live-browser.js — publishes it on
 *     window.__IMPECCABLE_LIVE_CHROME_CORE__ for adapters and E2E probes. That
 *     file is served raw and injected as a classic <script>, so it cannot
 *     import this module at runtime; it reads the injected global instead, the
 *     same path live/vocabulary.mjs already takes for the command palette.
 *   - the private impeccable-site repo — site/components/LiveUiGallery.astro
 *     and tests/live-ui-lab.test.mjs import LIVE_UI_SURFACES at build time and
 *     fail the site build when the Live UI lab has no snapshot for a surface
 *     defined here. That guard only guards if it reads this list rather than a
 *     copy the site keeps, so this module must stay importable from Node.
 *     Renaming a key or the module is a breaking change for that build; the
 *     list was briefly inlined into live-browser.js and the site had to parse
 *     it back out with a regex.
 *
 * Add a surface here and both the browser bundle and the site lab follow.
 */

/** Id prefix every Live chrome element carries. Mirrored by PREFIX in live-browser.js. */
export const LIVE_UI_PREFIX = 'impeccable-live';

const id = (suffix) => `${LIVE_UI_PREFIX}-${suffix}`;

/**
 * The mount contract every Live chrome adapter (DOM, Svelte, ...) satisfies.
 * Published alongside the surfaces on __IMPECCABLE_LIVE_CHROME_CORE__.
 */
export const LIVE_CHROME_MOUNT_CONTRACT = Object.freeze(['root', 'transport', 'state', 'actions']);

export const LIVE_UI_SURFACES = Object.freeze([
  {
    key: 'global-bottom-bar',
    ids: [
      id('global-bar'), id('global-bar-brand'), id('pick-toggle'), id('insert-toggle'),
      id('detect-toggle'), id('detect-badge'), id('design-toggle'), id('page-chat'),
      id('page-chat-input'), id('page-chat-voice'), id('page-chat-send'),
    ],
  },
  { key: 'pending-copy-edit-dock', ids: [id('pending-dock')] },
  {
    key: 'element-selection-chrome',
    ids: [
      id('highlight'), id('tooltip'), id('bar'), id('selection-pill'), id('input'),
      id('configure-voice'), id('configure-bar-tooltip'),
    ],
  },
  { key: 'action-picker', ids: [id('picker')] },
  { key: 'edit-chrome', ids: [id('edit-badge')] },
  { key: 'generating-row', ids: [id('bar'), id('shader')] },
  { key: 'variant-cycling-row', ids: [id('bar'), id('params-panel')] },
  { key: 'variant-params-panel', ids: [id('params-panel')] },
  { key: 'saving-confirmed-rows', ids: [id('bar')] },
  {
    key: 'insert-mode-chrome',
    ids: [
      id('insert-line'), id('insert-placeholder'), id('placeholder-resize'), id('insert-input'),
      id('insert-voice'), id('insert-create'), id('insert-create-tooltip'),
    ],
  },
  { key: 'annotation-chrome', ids: [id('annot'), id('annot-svg'), id('annot-pins'), id('annot-clear')] },
  { key: 'design-system-panel', ids: [id('design-host')] },
  { key: 'toasts-and-errors', ids: [id('toast'), id('mount-error')] },
  { key: 'css-isolation-boundary', ids: [id('root')] },
].map((surface) => Object.freeze({ ...surface, ids: Object.freeze(surface.ids) })));

/** Every id any surface owns, de-duplicated, in surface order. */
export const LIVE_UI_COMPONENT_IDS = Object.freeze([
  ...new Set(LIVE_UI_SURFACES.flatMap((surface) => surface.ids)),
]);
