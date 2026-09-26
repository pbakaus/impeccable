// Writes ui/component-review/vendor/kit-css.ts from the vendored stylesheets so both the
// Bun bundle and Vite hosts (the eval dashboard imports this source) can load them;
// neither `with { type: 'text' }` nor `?raw` works in both.
import { readFileSync, writeFileSync } from 'node:fs';
export function writeKitCssModule(dir) {
  const read = (name) => readFileSync(dir + name, 'utf8');
  const body = [['tokens', 'kinpaku-tokens.css'], ['kit', 'kinpaku-kit.css'], ['rail', 'docs-rail.css']]
    .map(([name, file]) => `export const ${name} = ${JSON.stringify(read(file))};`).join('\n');
  writeFileSync(dir + 'kit-css.ts', `// GENERATED from the vendored stylesheets by scripts/sync-kinpaku-kit.mjs. Do not edit.\n${body}\n`);
}
if (import.meta.url === `file://${process.argv[1]}`) writeKitCssModule(new URL('../../ui/component-review/vendor/', import.meta.url).pathname);
