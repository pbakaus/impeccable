#!/usr/bin/env node

/**
 * Generates cli/engine/detect-antipatterns-browser.js
 * by concatenating the browser-safe detector modules and wrapping them in an IIFE.
 *
 * Run: node scripts/build-browser-detector.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const MODULES = [
  'cli/engine/shared/constants.mjs',
  'cli/engine/registry/antipatterns.mjs',
  'cli/engine/shared/color.mjs',
  'cli/engine/shared/fonts.mjs',
  'cli/engine/rules/checks.mjs',
  'cli/engine/browser/injected/index.mjs',
];
const OUTPUT = path.join(ROOT, 'cli/engine/detect-antipatterns-browser.js');
const SITE_OUTPUT = path.join(ROOT, 'site/public/js/detect-antipatterns-browser.js');

function browserSafeModule(relPath) {
  let code = fs.readFileSync(path.join(ROOT, relPath), 'utf-8');
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

const code = MODULES.map(browserSafeModule).join('\n');

const output = `/**
 * Anti-Pattern Browser Detector for Impeccable
 * Copyright (c) 2026 Paul Bakaus
 * SPDX-License-Identifier: Apache-2.0
 *
 * GENERATED -- do not edit. Source: cli/engine/browser/injected/index.mjs
 * Rebuild: node scripts/build-browser-detector.js
 *
 * Usage: <script src="detect-antipatterns-browser.js"></script>
 * Re-scan: window.impeccableScan()
 */
(function () {
if (typeof window === 'undefined') return;
${code}
})();
`;

fs.writeFileSync(OUTPUT, output);
fs.mkdirSync(path.dirname(SITE_OUTPUT), { recursive: true });
fs.writeFileSync(SITE_OUTPUT, output);
console.log(`Generated ${path.relative(ROOT, OUTPUT)} (${(output.length / 1024).toFixed(1)} KB)`);
console.log(`Generated ${path.relative(ROOT, SITE_OUTPUT)} (${(output.length / 1024).toFixed(1)} KB)`);
