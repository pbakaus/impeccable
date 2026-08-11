/* Build an untouched replica of previews-gallery.html, then apply experiments
   to selected strategy iframes. The source gallery stays baseline. */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(HERE, 'previews-gallery.html');
const OUTPUT = path.join(HERE, 'previews-gallery-improved.html');

const OPS_PREVIEW =
  '#picker-form .picker-strategy-stage > .picker-preview.picker-preview--ops';

const DOCS_PREVIEW =
  '#picker-form .picker-strategy-stage > .picker-preview.picker-preview--docs';

const DOCS_SCOPE =
  'html[data-cell-screen="03"][data-cell-surface="read"]';

const DOCS_WEIGHT_CSS = [
  `${DOCS_SCOPE} ${DOCS_PREVIEW} {`,
  '  --pv-text: 1.65 !important;',
  '}',
  `${DOCS_SCOPE} ${DOCS_PREVIEW} .pd-item i {`,
  '  width: calc(4.07 * var(--pv-x)) !important;',
  '}',
  `${DOCS_SCOPE} ${DOCS_PREVIEW} .pd-item span {`,
  '  height: calc(1.53 * var(--pv-text) * var(--pv-x)) !important;',
  '}',
  `${DOCS_SCOPE} ${DOCS_PREVIEW} .pd-para i {`,
  '  height: calc(1.35 * var(--pv-text) * var(--pv-x)) !important;',
  '}',
  `${DOCS_SCOPE} ${DOCS_PREVIEW} .pd-note-dot {`,
  '  width: calc(4.07 * var(--pv-x)) !important;',
  '}',
  `${DOCS_SCOPE} ${DOCS_PREVIEW} .pd-note-lines i {`,
  '  height: calc(1 * var(--pv-text) * var(--pv-x)) !important;',
  '}',
  `${DOCS_SCOPE} ${DOCS_PREVIEW} .pd-phone-body .pd-para i {`,
  '  height: calc(1.37 * var(--pv-text) * var(--pv-x)) !important;',
  '}',
  `${DOCS_SCOPE} ${DOCS_PREVIEW} .pd-phone-body .pd-note-lines i {`,
  '  height: calc(0.83 * var(--pv-text) * var(--pv-x)) !important;',
  '}',
  `${DOCS_SCOPE} ${DOCS_PREVIEW} .pd-phone-body .pd-heading {`,
  '  height: calc(2.53 * var(--pv-text) * var(--pv-x)) !important;',
  '}',
  `${DOCS_SCOPE} ${DOCS_PREVIEW} .pd-phone-body .pd-note-dot {`,
  '  width: calc(2.64 * var(--pv-text) * var(--pv-x)) !important;',
  '}',
].join('\n');

const DOCS_CARRY_SCOPE =
  'html[data-cell-surface="read"]:is([data-cell-screen="08"], [data-cell-screen="09"], [data-cell-screen="10"])';

const DOCS_CARRY_ROOT = '[data-carry][data-surface="read"]';

const DOCS_CARRY_WEIGHT_CSS = [
  `${DOCS_CARRY_SCOPE} ${DOCS_CARRY_ROOT} {`,
  '  --pvs-carry-weight: 1.65 !important;',
  '}',
  `${DOCS_CARRY_SCOPE} ${DOCS_CARRY_ROOT} .ps-docs-item > i {`,
  '  width: calc(var(--pt-base) * 0.34 * var(--pvs-carry-weight)) !important;',
  '}',
  `${DOCS_CARRY_SCOPE} ${DOCS_CARRY_ROOT} :is(`,
  '  .ps-docs-item b,',
  '  .ps-docs-crumb,',
  '  .ps-docs-note-copy b',
  ') {',
  '  height: calc(var(--pt-base) * 0.26 * var(--pvs-carry-weight)) !important;',
  '}',
  `${DOCS_CARRY_SCOPE} ${DOCS_CARRY_ROOT} :is(`,
  '  .ps-docs-main .pt-headline i,',
  '  .ps-phone-body .pt-headline i',
  ') {',
  '  height: calc(var(--pt-base) * 0.72 * var(--pvs-carry-weight)) !important;',
  '}',
  `${DOCS_CARRY_SCOPE} ${DOCS_CARRY_ROOT} .ps-docs-sub {`,
  '  height: calc(var(--pt-base) * 0.5 * var(--pvs-carry-weight)) !important;',
  '}',
  `${DOCS_CARRY_SCOPE} ${DOCS_CARRY_ROOT} :is(`,
  '  .ps-docs-lede i,',
  '  .ps-docs-para i,',
  '  .ps-docs-list li',
  ') {',
  '  height: calc(var(--pt-base) * 0.3 * var(--pvs-carry-weight)) !important;',
  '}',
  `${DOCS_CARRY_SCOPE} ${DOCS_CARRY_ROOT} .ps-docs-note-copy > span i {`,
  '  height: calc(var(--pt-base) * 0.26 * var(--pvs-carry-weight)) !important;',
  '}',
  `${DOCS_CARRY_SCOPE} ${DOCS_CARRY_ROOT} .ps-docs-list li::before {`,
  '  width: calc(var(--pt-base) * 0.3 * var(--pvs-carry-weight)) !important;',
  '}',
].join('\n');

const DOCS_BOARD_CELLS = [
  'boundaries--read--open-space',
  'boundaries--read--thin-dividers',
  'boundaries--read--surface-changes',
  'corners--read--sharp',
  'corners--read--slightly-soft',
  'corners--read--friendly',
  'corners--read--pill',
  'depth--read--flat',
  'depth--read--soft-lift',
];

const GALLERY_PREVIEW =
  '#picker-form .picker-strategy-stage > .picker-preview.picker-preview--gallery:not([hidden])';

const LANDING_PREVIEW =
  '#picker-form .picker-strategy-stage > .picker-preview[data-surface="persuade"]';

function cellScope(screen, option) {
  return (
    'html[data-cell-screen="03"][data-cell-surface="' + screen + '"][data-cell-option="' + option + '"]'
  );
}

function drenchedRestoreCss(scope, preview) {
  return [
    scope,
    `${preview} {`,
    '  --pv-secondary: var(--pkc-secondary) !important;',
    '  --pv-tertiary: var(--pkc-tertiary) !important;',
    '  --pv-bone: color-mix(in oklab, var(--pkc-p-ink) 55%, var(--pkc-primary)) !important;',
    '  --pv-strong: var(--pkc-p-ink) !important;',
    '  --pv-secondary-wash: color-mix(in oklab, var(--pkc-p-ink) 16%, var(--pkc-primary)) !important;',
    '}',
  ].join('\n');
}

function drenchedPanelCss(scope, preview, panel = '.pv-image') {
  return [
    scope,
    `${preview} ${panel} {`,
    '  background: linear-gradient(',
    '    135deg,',
    '    color-mix(in oklab, var(--pkc-p-ink) 16%, var(--pkc-primary)),',
    '    color-mix(in oklab, var(--pkc-secondary) 34%, var(--pkc-primary))',
    '  ) !important;',
    '  border-color: color-mix(in oklab, var(--pkc-secondary) 52%, var(--pkc-primary)) !important;',
    '}',
    scope,
    `${preview} ${panel}::after {`,
    '  background: var(--pkc-tertiary) !important;',
    '}',
  ].join('\n');
}

const LANDING_DRENCHED_CSS = [
  drenchedRestoreCss(cellScope('persuade', 'drenched'), LANDING_PREVIEW),
  drenchedPanelCss(cellScope('persuade', 'drenched'), LANDING_PREVIEW + ' .pv-desktop'),
  cellScope('persuade', 'drenched'),
  `${LANDING_PREVIEW} .pv-desktop .pv-actions i:last-child {`,
  '  border-color: color-mix(in oklab, var(--pkc-secondary) 68%, var(--pkc-p-ink)) !important;',
  '  background: color-mix(in oklab, var(--pkc-secondary) 18%, var(--pkc-primary)) !important;',
  '}',
  cellScope('persuade', 'drenched'),
  `${LANDING_PREVIEW} .pv-desktop .pv-nav-bars i:nth-child(2) {`,
  '  background: color-mix(in oklab, var(--pkc-secondary) 72%, var(--pkc-p-ink)) !important;',
  '}',
].join('\n');

function portfolioCapAvatarsCss(option, circle = 'neutral') {
  const scope = cellScope('experience', option);
  const capCircle =
    circle === 'drenched'
      ? [
          '  border: 1px solid color-mix(in oklab, var(--pkc-secondary) 58%, var(--pkc-primary));',
          '  background: linear-gradient(',
          '    135deg,',
          '    color-mix(in oklab, var(--pkc-secondary) 30%, var(--pkc-primary)),',
          '    color-mix(in oklab, var(--pkc-p-ink) 20%, var(--pkc-primary))',
          '  );',
        ].join('\n')
      : circle === 'committed'
        ? [
            '  border: 1px solid color-mix(in oklab, var(--pkc-primary) 42%, var(--pkc-neutral));',
            '  background: linear-gradient(',
            '    135deg,',
            '    color-mix(in oklab, var(--pkc-primary) 16%, var(--pkc-neutral)),',
            '    color-mix(in oklab, var(--pkc-primary) 30%, var(--pkc-neutral))',
            '  );',
          ].join('\n')
        : [
            '  border: 1px solid color-mix(in oklab, var(--pv-secondary) 55%, var(--pv-neutral));',
            '  background: linear-gradient(',
            '    135deg,',
            '    color-mix(in oklab, var(--pv-secondary) 24%, var(--pv-neutral)),',
            '    color-mix(in oklab, var(--pv-secondary) 46%, var(--pv-neutral))',
            '  );',
          ].join('\n');

  return [
    `${scope} ${GALLERY_PREVIEW} .pv-desktop .pg-cap {`,
    '  padding-top: 5.2cqh !important;',
    '  gap: 2.6cqh !important;',
    '}',
    `${scope} ${GALLERY_PREVIEW} .pv-desktop .pg-cap::before {`,
    '  content: "";',
    '  display: block;',
    '  width: calc(11.5 * var(--pv-x));',
    '  aspect-ratio: 1;',
    '  border-radius: 50%;',
    capCircle,
    '}',
  ].join('\n');
}

const PORTFOLIO_DRENCHED_COLOR_CSS = [
  drenchedRestoreCss(cellScope('experience', 'drenched'), GALLERY_PREVIEW),
  drenchedPanelCss(cellScope('experience', 'drenched'), GALLERY_PREVIEW),
  cellScope('experience', 'drenched'),
  `${GALLERY_PREVIEW} .pg-track i:nth-child(2) {`,
  '  background: color-mix(in oklab, var(--pkc-secondary) 78%, var(--pkc-p-ink)) !important;',
  '}',
  cellScope('experience', 'drenched'),
  `${GALLERY_PREVIEW} .pg-cap-title {`,
  '  background: var(--pkc-tertiary) !important;',
  '}',
  cellScope('experience', 'drenched'),
  `${GALLERY_PREVIEW} .pv-nav-bars i:nth-child(2) {`,
  '  background: color-mix(in oklab, var(--pkc-secondary) 72%, var(--pkc-p-ink)) !important;',
  '}',
  cellScope('experience', 'drenched'),
  `${GALLERY_PREVIEW} .pv-tabbar i:nth-child(2) {`,
  '  background: color-mix(in oklab, var(--pkc-secondary) 70%, var(--pkc-p-ink)) !important;',
  '}',
  cellScope('experience', 'drenched'),
  `${GALLERY_PREVIEW} .pv-tabbar i:nth-child(3) {`,
  '  background: color-mix(in oklab, var(--pkc-tertiary) 82%, var(--pkc-p-ink)) !important;',
  '}',
].join('\n');

const DOCS_QUOTE_RESTRAINED_CSS = [
  cellScope('read', 'restrained'),
  `${DOCS_PREVIEW}:not([hidden]) {`,
  '  --pd-quote: var(--pd-ink) !important;',
  '}',
  cellScope('read', 'restrained'),
  `${DOCS_PREVIEW}:not([hidden]) :is(.pd-note-dot, .pd-note-lines i) {`,
  '  background: var(--pd-ink) !important;',
  '}',
].join('\n');

const FONT_PAIR_NO_NAV_ACTION_CELLS = [
  'font-pair--persuade--default',
  'font-pair--operate--default',
  'font-pair--read--default',
];

const FONT_PAIR_NO_NAV_ACTION_CSS = [
  '#picker-form .picker-preview-type .ps-nav-action {',
  '  display: none !important;',
  '}',
  '#picker-form .picker-preview-type .ps-nav-tail {',
  '  display: none !important;',
  '}',
  '#picker-form .picker-preview-type .ps-nav {',
  '  grid-template-columns: auto 1fr !important;',
  '}',
  '#picker-form .picker-preview-type {',
  '  --pvs-cta-text: var(--pv-neutral) !important;',
  '}',
].join('\n');

const FONT_PAIR_PERSUADE_HERO_IMAGE_CSS = [
  '#picker-form .picker-preview-type .ps-hero {',
  '  grid-template-columns: minmax(0, 1fr) 40% !important;',
  '}',
].join('\n');

const FONT_PAIR_PERSUADE_GALLERY_CSS = [
  '#picker-form .picker-preview-type .ps-gallery-item {',
  '  gap: var(--ps-gap-xs) !important;',
  '}',
  '#picker-form .picker-preview-type .ps-gallery-item > i {',
  '  max-width: none !important;',
  '  aspect-ratio: 3 / 2 !important;',
  '  border-radius: var(--pvs-radius-frame) !important;',
  '}',
  '#picker-form .picker-preview-type .ps-desktop .ps-gallery-item > i {',
  '  margin-inline: 0 !important;',
  '}',
  '#picker-form .picker-preview-type .ps-gallery-item [data-type-gallery-caption] {',
  '  color: var(--pvs-title) !important;',
  '  font-size: var(--pt-micro) !important;',
  '  line-height: 1.38 !important;',
  '  display: -webkit-box !important;',
  '  -webkit-box-orient: vertical !important;',
  '  -webkit-line-clamp: 2 !important;',
  '  overflow: hidden !important;',
  '  text-wrap: balance !important;',
  '  white-space: normal !important;',
  '}',
].join('\n');

const FONT_PAIR_PERSUADE_GALLERY_JS = [
  'var captions = [',
  '  "Lorem ipsum dolor sit amet consectetur",',
  '  "Dolor sit amet consectetur elit",',
  '  "Eiusmod tempor sed do eiusmod",',
  '];',
  'doc.querySelectorAll(".ps-gallery-item").forEach(function (item, index) {',
  '  var title = item.querySelector("[data-type-gallery-title]");',
  '  var meta = item.querySelector("[data-type-gallery-meta]");',
  '  var caption = item.querySelector("[data-type-gallery-caption]");',
  '  var text = captions[index] || "";',
  '  if (!text && title) {',
  '    text = title.textContent.trim();',
  '    if (meta) text = (text + " " + meta.textContent.trim()).trim();',
  '  }',
  '  if (!text) return;',
  '  if (caption) {',
  '    caption.textContent = text;',
  '    return;',
  '  }',
  '  if (!title) return;',
  '  title.removeAttribute("data-type-gallery-title");',
  '  title.setAttribute("data-type-gallery-caption", "");',
  '  title.textContent = text;',
  '  if (meta) meta.remove();',
  '});',
].join(' ');

const FONT_PAIR_OPERATE_OPS_CSS = [
  '#picker-form .picker-preview-type--ops {',
  '  --pvs-cta-text: var(--pv-neutral) !important;',
  '}',
  '#picker-form .picker-preview-type--ops .ps-ops-item--on {',
  '  padding-block: calc(var(--pt-base) * 0.45) !important;',
  '  padding-inline: calc(var(--pt-base) * 0.72) calc(var(--pt-base) * 0.58) !important;',
  '}',
  '#picker-form .picker-preview-type--ops .ps-ops-item--on b {',
  '  color: var(--pv-neutral) !important;',
  '}',
  '#picker-form .picker-preview-type--ops .ps-ops-field {',
  '  gap: calc(var(--pt-base) * 0.5) !important;',
  '  padding-block: calc(var(--pt-base) * 0.52) !important;',
  '  padding-inline: calc(var(--pt-base) * 0.68) calc(var(--pt-base) * 0.58) !important;',
  '}',
  '#picker-form .picker-preview-type--ops .ps-ops-field b {',
  '  flex: 1 1 auto !important;',
  '  line-height: 1.35 !important;',
  '}',
  '#picker-form .picker-preview-type--ops .ps-ops-chev {',
  '  transform: translateY(-12%) rotate(45deg) !important;',
  '  margin-inline-end: calc(var(--pt-base) * 0.08) !important;',
  '}',
  '#picker-form .picker-preview-type--ops .ps-ops-row--on {',
  '  padding-inline: calc(var(--pt-base) * 0.68) calc(var(--pt-base) * 0.58) !important;',
  '  border-radius: var(--pvs-radius-frame) !important;',
  '}',
].join('\n');

const FONT_PAIR_PERSUADE_PHONE_SPACING_CSS = [
  '#picker-form .picker-preview-type[data-surface="persuade"] .ps-phone-body {',
  '  gap: var(--ps-gap-md) !important;',
  '}',
  '#picker-form .picker-preview-type[data-surface="persuade"] .ps-phone-body :is(.pt-headline, .pt-body, .ps-actions, .ps-proof) {',
  '  margin-block-end: 0 !important;',
  '}',
  '#picker-form .picker-preview-type[data-surface="persuade"] .ps-phone-body .ps-editorial-copy {',
  '  gap: var(--ps-gap-sm) !important;',
  '}',
].join('\n');

const FONT_PAIR_READ_PHONE_SPACING_CSS = [
  '#picker-form .picker-preview-type--read .ps-phone-body {',
  '  gap: var(--ps-gap-md) !important;',
  '}',
  '#picker-form .picker-preview-type--read .ps-phone-body > * {',
  '  margin-block: 0 !important;',
  '}',
  '#picker-form .picker-preview-type--read .ps-phone-body .ps-docs-sub + .ps-docs-para {',
  '  margin-top: calc(var(--pt-base) * 0.45) !important;',
  '}',
  '#picker-form .picker-preview-type--read .ps-phone-body :is(.ps-docs-list, .ps-docs-note) {',
  '  margin-top: 0 !important;',
  '}',
].join('\n');

const FONT_PAIR_READ_DOCS_LAYOUT_CSS = [
  '#picker-form .picker-preview-type--read .ps-docs {',
  '  grid-template-columns: minmax(0, 21%) minmax(0, 1fr) !important;',
  '}',
  '#picker-form .picker-preview-type--read .ps-docs-rail {',
  '  padding-inline-end: calc(var(--pt-base) * 0.35) !important;',
  '}',
  '#picker-form .picker-preview-type--read .ps-docs-main {',
  '  padding: var(--ps-band-y) 5% 0 calc(var(--pt-base) * 0.8) !important;',
  '}',
].join('\n');

const FONT_PAIR_READ_SECTION_TITLE_JS =
  'doc.querySelectorAll("[data-type-section-title]").forEach(function (el) { if (el.textContent.trim() === "Lorem ipsum dolor sit") el.textContent = "Lorem ipsum dolor"; });';

const FONT_PAIR_EXPERIENCE_CAP_AVATARS_CSS = [
  '#picker-form .picker-preview-type--experience .ps-desktop .ps-index-cap {',
  '  align-content: start !important;',
  '}',
  '#picker-form .picker-preview-type--experience .ps-index-avatar {',
  '  display: none !important;',
  '}',
  '#picker-form .picker-preview-type--experience .ps-desktop .ps-index-avatar {',
  '  display: block !important;',
  '  width: calc(var(--pt-base) * 4.8) !important;',
  '  aspect-ratio: 1 !important;',
  '  border-radius: 50% !important;',
  '  border: 1px solid color-mix(in oklab, var(--pv-secondary) 55%, var(--pv-neutral)) !important;',
  '  background: linear-gradient(',
  '    135deg,',
  '    color-mix(in oklab, var(--pv-secondary) 24%, var(--pv-neutral)),',
  '    color-mix(in oklab, var(--pv-secondary) 46%, var(--pv-neutral))',
  '  ) !important;',
  '}',
].join('\n');

const FONT_PAIR_EXPERIENCE_CAP_AVATARS_JS = [
  'doc.querySelectorAll("#picker-form .picker-preview-type--experience .ps-desktop .ps-index-cap").forEach(function (cap) {',
  '  if (cap.querySelector(".ps-index-avatar")) return;',
  '  var avatar = doc.createElement("i");',
  '  avatar.className = "ps-index-avatar";',
  '  avatar.setAttribute("aria-hidden", "true");',
  '  cap.insertBefore(avatar, cap.firstChild);',
  '});',
].join(' ');

const FONT_PAIR_EXPERIENCE_LAYOUT_CSS = [
  '#picker-form .picker-preview-type--experience .ps-desktop {',
  '  grid-template-rows: 9.4% minmax(0, 1fr) !important;',
  '}',
  '#picker-form .picker-preview-type--experience .ps-index {',
  '  gap: var(--ps-gap-sm) !important;',
  '}',
  '#picker-form .picker-preview-type--experience .ps-index > .pt-headline {',
  '  max-width: none !important;',
  '  font-size: var(--pt-title) !important;',
  '  letter-spacing: 0 !important;',
  '  white-space: nowrap !important;',
  '  text-wrap: nowrap !important;',
  '}',
  '#picker-form .picker-preview-type--experience .ps-desktop .ps-index-cap {',
  '  gap: calc(var(--pt-base) * 0.42) !important;',
  '}',
  '#picker-form .picker-preview-type--experience .ps-desktop .ps-index-avatar {',
  '  margin-bottom: calc(var(--pt-base) * 0.12) !important;',
  '}',
  '#picker-form .picker-preview-type--experience .ps-index-stop--on {',
  '  padding: 0.55em 0.95em !important;',
  '  border-radius: var(--pvs-radius-bar) !important;',
  '  background-color: var(--pvs-cta) !important;',
  '  color: var(--pv-neutral) !important;',
  '  font-weight: 600 !important;',
  '}',
  '#picker-form .picker-preview-type--experience .ps-footer,',
  '#picker-form .picker-preview-type--experience .ps-phone-footer {',
  '  display: none !important;',
  '}',
].join('\n');

/** @type {{ id: string, cells: string[], css: string }[]} */
const EXPERIMENTS = [
  {
    id: 'font-pair-hide-nav-action',
    cells: FONT_PAIR_NO_NAV_ACTION_CELLS,
    css: FONT_PAIR_NO_NAV_ACTION_CSS,
  },
  {
    id: 'font-pair-persuade-hero-image',
    cells: ['font-pair--persuade--default'],
    css: FONT_PAIR_PERSUADE_HERO_IMAGE_CSS,
  },
  {
    id: 'font-pair-persuade-proof-copy',
    cells: ['font-pair--persuade--default'],
    js: 'var proofs = doc.querySelectorAll("[data-type-proof]"); if (proofs[1]) proofs[1].textContent = "Sit amet elit dolor";',
  },
  {
    id: 'font-pair-persuade-editorial-copy',
    cells: ['font-pair--persuade--default'],
    js: [
      'doc.querySelectorAll(".ps-editorial-copy > em[data-type-section-link]").forEach(function (el) { el.remove(); });',
      'var merged = "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.";',
      'doc.querySelectorAll("[data-type-section-body]").forEach(function (p) {',
      '  if (p.hasAttribute("data-type-section-body-2")) { p.remove(); return; }',
      '  var second = p.nextElementSibling;',
      '  if (second && second.hasAttribute("data-type-section-body-2")) {',
      '    p.textContent = merged;',
      '    second.remove();',
      '    return;',
      '  }',
      '  p.textContent = merged;',
      '});',
    ].join(' '),
  },
  {
    id: 'font-pair-persuade-gallery-cards',
    cells: ['font-pair--persuade--default'],
    css: FONT_PAIR_PERSUADE_GALLERY_CSS,
    js: FONT_PAIR_PERSUADE_GALLERY_JS,
  },
  {
    id: 'font-pair-persuade-phone-spacing',
    cells: ['font-pair--persuade--default'],
    css: FONT_PAIR_PERSUADE_PHONE_SPACING_CSS,
  },
  {
    id: 'font-pair-read-phone-spacing',
    cells: ['font-pair--read--default'],
    css: FONT_PAIR_READ_PHONE_SPACING_CSS,
  },
  {
    id: 'font-pair-read-docs-layout',
    cells: ['font-pair--read--default'],
    css: FONT_PAIR_READ_DOCS_LAYOUT_CSS,
    js: FONT_PAIR_READ_SECTION_TITLE_JS,
  },
  {
    id: 'font-pair-experience-cap-avatars',
    cells: ['font-pair--experience--default'],
    css: FONT_PAIR_EXPERIENCE_CAP_AVATARS_CSS,
    js: FONT_PAIR_EXPERIENCE_CAP_AVATARS_JS,
  },
  {
    id: 'font-pair-experience-layout',
    cells: ['font-pair--experience--default'],
    css: FONT_PAIR_EXPERIENCE_LAYOUT_CSS,
  },
  {
    id: 'font-pair-operate-ops-chrome',
    cells: ['font-pair--operate--default'],
    css: FONT_PAIR_OPERATE_OPS_CSS,
  },
  {
    id: 'landing-drenched-color-roles',
    cells: ['strategy--persuade--drenched'],
    css: LANDING_DRENCHED_CSS,
  },
  {
    id: 'ops-committed-color-visibility',
    cells: ['strategy--operate--committed'],
    css: [
      'html[data-cell-screen="03"][data-cell-surface="operate"][data-cell-option="committed"]',
      `${OPS_PREVIEW} {`,
      '  --pv-neutral: color-mix(in oklab, var(--pkc-neutral) 84%, var(--pkc-primary)) !important;',
      '  --po-wash: color-mix(in oklab, var(--pkc-primary) 24%, var(--pkc-neutral)) !important;',
      '}',
    ].join('\n'),
  },
  {
    id: 'ops-full-palette-color-roles',
    cells: ['strategy--operate--full-palette'],
    css: [
      'html[data-cell-screen="03"][data-cell-surface="operate"][data-cell-option="full-palette"]',
      `${OPS_PREVIEW} {`,
      '  --po-wash: color-mix(in oklab, var(--pkc-secondary) 22%, var(--pkc-neutral)) !important;',
      '}',
      'html[data-cell-screen="03"][data-cell-surface="operate"][data-cell-option="full-palette"]',
      `${OPS_PREVIEW} .po-row--on .po-dot {`,
      '  background: var(--pkc-tertiary) !important;',
      '}',
      'html[data-cell-screen="03"][data-cell-surface="operate"][data-cell-option="full-palette"]',
      `${OPS_PREVIEW} .po-field {`,
      '  border-color: var(--pkc-secondary) !important;',
      '}',
      'html[data-cell-screen="03"][data-cell-surface="operate"][data-cell-option="full-palette"]',
      `${OPS_PREVIEW} .po-chart i:nth-child(2) {`,
      '  background: color-mix(in oklab, var(--pkc-secondary) 78%, var(--pkc-neutral)) !important;',
      '}',
      'html[data-cell-screen="03"][data-cell-surface="operate"][data-cell-option="full-palette"]',
      `${OPS_PREVIEW} .po-chart i:nth-child(3) {`,
      '  background: color-mix(in oklab, var(--pkc-tertiary) 68%, var(--pkc-neutral)) !important;',
      '}',
    ].join('\n'),
  },
  {
    id: 'docs-restrained-quote-contrast',
    cells: ['strategy--read--restrained'],
    css: DOCS_QUOTE_RESTRAINED_CSS,
  },
  {
    id: 'docs-strategy-wireframe-weight',
    cells: [
      'strategy--read--restrained',
      'strategy--read--committed',
      'strategy--read--full-palette',
    ],
    css: DOCS_WEIGHT_CSS,
  },
  {
    id: 'docs-board-carry-weight',
    cells: DOCS_BOARD_CELLS,
    css: DOCS_CARRY_WEIGHT_CSS,
  },
  {
    id: 'portfolio-restrained-cap-avatars',
    cells: ['strategy--experience--restrained'],
    css: portfolioCapAvatarsCss('restrained', 'neutral'),
  },
  {
    id: 'portfolio-committed-cap-avatars',
    cells: ['strategy--experience--committed'],
    css: portfolioCapAvatarsCss('committed', 'committed'),
  },
  {
    id: 'portfolio-drenched-gallery',
    cells: ['strategy--experience--drenched'],
    css: PORTFOLIO_DRENCHED_COLOR_CSS + '\n' + portfolioCapAvatarsCss('drenched', 'drenched'),
  },
];

const experiment = String.raw`
<script data-gallery-replica-experiment="strategy-fixes">
(function () {
  var specs = ${JSON.stringify(EXPERIMENTS.map(({ id, cells, css, js }) => ({ id, cells, css: css || '', js: js || '' })))};

  specs.forEach(function (spec) {
    spec.cells.forEach(function (cellId) {
      var frame = document.querySelector('iframe[data-cell="' + cellId + '"]');
      if (!frame) return;

      function apply() {
        var doc = frame.contentDocument;
        if (!doc || !doc.head) return;

        if (spec.css) {
          var style = doc.querySelector('[data-experiment="' + spec.id + '"]');
          if (!style) {
            style = doc.createElement('style');
            style.setAttribute('data-experiment', spec.id);
            style.textContent = spec.css;
            doc.head.appendChild(style);
          }
        }

        if (spec.js) {
          try {
            eval(spec.js);
          } catch (err) {
            console.warn('[gallery-replica] ' + spec.id + ':', err);
          }
        }
      }

      frame.addEventListener('load', apply);
      apply();
    });
  });
})();
</script>`;

const html = await readFile(SOURCE, 'utf8');
if (html.includes('data-gallery-replica-experiment')) {
  throw new Error('Source gallery already contains the replica experiment');
}
if (!html.includes('</body>')) {
  throw new Error('Source gallery has no closing body tag');
}

for (const { cells } of EXPERIMENTS) {
  for (const cell of cells) {
    if (!html.includes('data-cell="' + cell + '"')) {
      throw new Error('Target cell not found: ' + cell);
    }
  }
}

let replica = html.replace('</body>', experiment + '\n</body>');
replica = replica.replace(
  '<title>Questionnaire previews, ground-truth gallery</title>',
  '<title>Questionnaire previews (improved experiment)</title>',
);
replica = replica.replace(
  '<h1>Questionnaire previews</h1>',
  '<h1>Questionnaire previews (improved experiment)</h1>',
);
replica = replica.replace(
  /<p class="note">Ground-truth extraction[\s\S]*?<\/p>/,
  '<p class="note">Replica of the ground-truth gallery with experiments on '
    + '<strong>12 Drenched</strong>, '
    + '<strong>14–15 App UI</strong> color roles, '
    + '<strong>16–18 Docs</strong> strategy wireframe weight, and '
    + '<strong>45–47 / 59–62 / 71–72 Docs</strong> board bar weight, and '
    + '<strong>19–21 Portfolio</strong> caption circles (desktop), '
    + '<strong>12 / 21 Drenched</strong> full accent roles, '
    + 'Baseline: <a href="previews-gallery.html">previews-gallery.html</a>.</p>',
);

await writeFile(OUTPUT, replica);
console.log('wrote previews-gallery-improved.html (' + (replica.length / 1024 / 1024).toFixed(1) + ' MB)');
