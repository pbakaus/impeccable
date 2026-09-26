// Copies the Impeccable design-system kit from the private site repo into
// ui/component-review/vendor/. The site is the source of truth; these files
// are verbatim excerpts so a future sync is this script, not a hand edit.
//   node scripts/sync-kinpaku-kit.mjs [path-to-impeccable-site]
import { readFileSync, writeFileSync } from 'node:fs';
import { writeKitCssModule } from './lib/kit-css-module.mjs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
const site = resolve(process.argv[2] ?? `${homedir()}/code/impeccable-site`, 'site');
const out = new URL('../ui/component-review/vendor/', import.meta.url).pathname;
const read = f => readFileSync(resolve(site, f), 'utf8');
// A section runs from its "/* ===" banner to the next banner. Pick sections by
// a selector they define, so line drift upstream does not matter.
function sections(css, wanted) {
  const parts = css.split(/(?=^\/\* =+\n)/m);
  return wanted.map(sel => {
    const hit = parts.find(p => p.includes(`\n${sel} {`) || p.includes(`\n${sel},`));
    if (!hit) throw new Error(`kit section defining ${sel} not found`);
    return hit.trimEnd();
  }).join('\n\n');
}
const kit = read('styles/kinpaku-kit.css');
const header = src => `/* VENDORED from impeccable-site/site/${src} (the source of truth).
   Do not edit here: change the site, then run node scripts/sync-kinpaku-kit.mjs. */\n`;
writeFileSync(out + 'kinpaku-tokens.css', header('styles/kinpaku-tokens.css') + read('styles/kinpaku-tokens.css'));
writeFileSync(out + 'kinpaku-kit.css', header('styles/kinpaku-kit.css (buttons, tabs, select, icon button, instrument strip, grain, switch, paper strip, thumb)') +
  sections(kit, ['.ks-button', '.ks-tab-list', '.ks-checkbox', '.ks-icon-button', '.ks-instrument-key', ':root', '.ks-switch', '.ks-tag', '.ks-thumb']) + '\n');
const docs = read('styles/docs-kinpaku.css');
const rail = docs.slice(docs.indexOf('/* Group headings are ink and bold'), docs.indexOf('/* Commands reuse the navigation above'));
writeFileSync(out + 'docs-rail.css', header('styles/docs-kinpaku.css (the command rail list: the site\'s selected-row pattern)') + rail.trimEnd() + '\n');
writeFileSync(out + 'instrument-strip.js', `// VENDORED from impeccable-site/site/scripts/instrument-strip.js (the source of truth).\n// Do not edit here: change the site, then run node scripts/sync-kinpaku-kit.mjs.\n` + read('scripts/instrument-strip.js'));
console.log('synced kit into', out);
writeKitCssModule(out);
