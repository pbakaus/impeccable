/* Build an untouched replica of previews-gallery.html, then apply color-only
   experiments to selected strategy iframes. The source gallery stays baseline. */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(HERE, 'previews-gallery.html');
const OUTPUT = path.join(HERE, 'previews-gallery-improved.html');

const OPS_PREVIEW =
  '#picker-form .picker-strategy-stage > .picker-preview.picker-preview--ops';

/** @type {{ id: string, cell: string, css: string }[]} */
const EXPERIMENTS = [
  {
    id: 'landing-drenched-color-roles',
    cell: 'strategy--persuade--drenched',
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
    cell: 'strategy--operate--committed',
    css: [
      'html[data-cell-screen="03"][data-cell-surface="operate"][data-cell-option="committed"]',
      `${OPS_PREVIEW} {`,
      '  /* Committed: primary owns the paper and the selection wash, not a 5% trace.',
      '     Structure stays neutral like Restrained so accents still pop. */',
      '  --pv-neutral: color-mix(in oklab, var(--pkc-neutral) 84%, var(--pkc-primary)) !important;',
      '  --po-wash: color-mix(in oklab, var(--pkc-primary) 24%, var(--pkc-neutral)) !important;',
      '}',
    ].join('\n'),
  },
  {
    id: 'ops-full-palette-color-roles',
    cell: 'strategy--operate--full-palette',
    css: [
      'html[data-cell-screen="03"][data-cell-surface="operate"][data-cell-option="full-palette"]',
      `${OPS_PREVIEW} {`,
      '  /* Full palette wireframe never assigns secondary; spread all four roles. */',
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
];

const experiment = String.raw`
<script data-gallery-replica-experiment="strategy-color-fixes">
(function () {
  var specs = ${JSON.stringify(EXPERIMENTS.map(({ id, cell, css }) => ({ id, cell, css })))};

  specs.forEach(function (spec) {
    var frame = document.querySelector('iframe[data-cell="' + spec.cell + '"]');
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
})();
</script>`;

const html = await readFile(SOURCE, 'utf8');
if (html.includes('data-gallery-replica-experiment')) {
  throw new Error('Source gallery already contains the replica experiment');
}
if (!html.includes('</body>')) {
  throw new Error('Source gallery has no closing body tag');
}

for (const { cell } of EXPERIMENTS) {
  if (!html.includes('data-cell="' + cell + '"')) {
    throw new Error('Target cell not found: ' + cell);
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
  '<p class="note">Replica of the ground-truth gallery with color-only experiments on '
    + '<strong>Landing page + Drenched</strong>, '
    + '<strong>App UI + Committed</strong>, and '
    + '<strong>App UI + Full palette</strong>. '
    + 'Baseline: <a href="previews-gallery.html">previews-gallery.html</a>. '
    + 'Restrained is unchanged (reference).</p>',
);

await writeFile(OUTPUT, replica);
console.log('wrote previews-gallery-improved.html (' + (replica.length / 1024 / 1024).toFixed(1) + ' MB)');
