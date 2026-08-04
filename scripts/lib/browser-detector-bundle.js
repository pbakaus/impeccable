import fs from 'node:fs';
import path from 'node:path';

const BROWSER_DETECTOR_MODULES = [
  'cli/engine/shared/constants.mjs',
  'cli/engine/registry/antipatterns.mjs',
  'cli/engine/shared/color.mjs',
  'cli/engine/shared/fonts.mjs',
  'cli/engine/rules/checks.mjs',
  'cli/engine/browser/injected/index.mjs',
];

function browserSafeModule(root, relPath) {
  let code = fs.readFileSync(path.join(root, relPath), 'utf-8');
  if (relPath === 'cli/engine/registry/antipatterns.mjs') {
    const match = code.match(/const ANTIPATTERNS = \[[\s\S]*?\n\];/);
    if (!match) throw new Error('Could not extract browser antipattern registry');
    code = match[0];
  }
  code = code.replace(/^import[\s\S]*?;\n/gm, '');
  code = code.replace(/^export\s+\{[^}]*\};\n?/gm, '');
  code = code.replace(/^export\s+\{[\s\S]*?^};\n?/gm, '');
  return `// --- ${relPath} ---\n${code.trim()}\n`;
}

export function bundleBrowserDetectorModules(root) {
  return BROWSER_DETECTOR_MODULES
    .map((relPath) => browserSafeModule(root, relPath))
    .join('\n');
}
