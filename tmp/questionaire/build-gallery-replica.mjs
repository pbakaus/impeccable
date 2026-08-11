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

/** @type {{ id: string, cells: string[], css: string }[]} */
const EXPERIMENTS = [
  {
    id: 'landing-drenched-color-roles',
    cells: ['strategy--persuade--drenched'],
    css: [
      'html[data-cell-screen="03"][data-cell-surface="persuade"][data-cell-option="drenched"]',
      '#picker-form .picker-strategy-stage > .picker-preview[data-surface="persuade"] {',
      '  --pv-secondary: var(--pkc-secondary) !important;',
      '  --pv-tertiary: var(--pkc-tertiary) !important;',
      '  --pv-bone: color-mix(in oklab, var(--pkc-p-ink) 55%, var(--pkc-primary)) !important;',
      '  --pv-strong: var(--pkc-p-ink) !important;',
      '  --pv-secondary-wash: color-mix(in oklab, var(--pkc-p-ink) 16%, var(--pkc-primary)) !important;',
      '}',
      'html[data-cell-screen="03"][data-cell-surface="persuade"][data-cell-option="drenched"]',
      '#picker-form .picker-strategy-stage > .picker-preview[data-surface="persuade"] .pv-image {',
      '  background: linear-gradient(',
      '    135deg,',
      '    color-mix(in oklab, var(--pkc-p-ink) 16%, var(--pkc-primary)),',
      '    color-mix(in oklab, var(--pkc-p-ink) 28%, var(--pkc-primary))',
      '  ) !important;',
      '  border-color: color-mix(in oklab, var(--pkc-p-ink) 40%, var(--pkc-primary)) !important;',
      '}',
      'html[data-cell-screen="03"][data-cell-surface="persuade"][data-cell-option="drenched"]',
      '#picker-form .picker-strategy-stage > .picker-preview[data-surface="persuade"] .pv-actions i:last-child {',
      '  border-color: color-mix(in oklab, var(--pkc-p-ink) 45%, var(--pkc-primary)) !important;',
      '  background: color-mix(in oklab, var(--pkc-p-ink) 12%, var(--pkc-primary)) !important;',
      '}',
    ].join('\n'),
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
    id: 'docs-strategy-wireframe-weight',
    cells: [
      'strategy--read--restrained',
      'strategy--read--committed',
      'strategy--read--full-palette',
    ],
    css: DOCS_WEIGHT_CSS,
  },
];

const experiment = String.raw`
<script data-gallery-replica-experiment="strategy-fixes">
(function () {
  var specs = ${JSON.stringify(EXPERIMENTS.map(({ id, cells, css }) => ({ id, cells, css })))};

  specs.forEach(function (spec) {
    spec.cells.forEach(function (cellId) {
      var frame = document.querySelector('iframe[data-cell="' + cellId + '"]');
      if (!frame) return;

      function apply() {
        var doc = frame.contentDocument;
        if (!doc || !doc.head) return;

        var style = doc.querySelector('[data-experiment="' + spec.id + '"]');
        if (!style) {
          style = doc.createElement('style');
          style.setAttribute('data-experiment', spec.id);
          style.textContent = spec.css;
          doc.head.appendChild(style);
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
    + '<strong>14–15 App UI</strong> color roles, and '
    + '<strong>16–18 Docs</strong> wireframe weight. '
    + 'Baseline: <a href="previews-gallery.html">previews-gallery.html</a>.</p>',
);

await writeFile(OUTPUT, replica);
console.log('wrote previews-gallery-improved.html (' + (replica.length / 1024 / 1024).toFixed(1) + ' MB)');
