#!/usr/bin/env node

/**
 * Builds the Chrome DevTools extension.
 *
 * 1. Generates the extension variant of the browser detector
 * 2. Extracts antipatterns.json for the panel UI
 * 3. Packages as extension.zip for Chrome Web Store upload
 *
 * Run: node scripts/build-extension.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ANTIPATTERNS } from '../cli/engine/registry/antipatterns.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EXT_DIR = path.join(ROOT, 'extension');

const BROWSER_MODULES = [
  'cli/engine/shared/constants.mjs',
  'cli/engine/registry/antipatterns.mjs',
  'cli/engine/shared/color.mjs',
  'cli/engine/rules/checks.mjs',
  'cli/engine/browser/injected/index.mjs',
];
const DETECTOR_OUTPUT = path.join(EXT_DIR, 'detector/detect.js');
const AP_OUTPUT = path.join(EXT_DIR, 'detector/antipatterns.json');

function browserSafeModule(relPath) {
  let code = fs.readFileSync(path.join(ROOT, relPath), 'utf-8');
  if (relPath === 'cli/engine/registry/antipatterns.mjs') {
    const match = code.match(/const ANTIPATTERNS = \[[\s\S]*?\n\];/);
    if (!match) throw new Error('Could not extract browser antipattern registry');
    code = match[0];
  }
  code = code.replace(/^import[\s\S]*?;\n/gm, '');
  code = code.replace(/^export\s+\{[\s\S]*?^};\n?/gm, '');
  return `// --- ${relPath} ---\n${code.trim()}\n`;
}

const code = BROWSER_MODULES.map(browserSafeModule).join('\n');

// --- 1. Build detector ---

const output = `/**
 * Anti-Pattern Browser Detector for Impeccable (Extension Variant)
 * Copyright (c) 2026 Paul Bakaus
 * SPDX-License-Identifier: Apache-2.0
 *
 * GENERATED -- do not edit. Source: cli/engine/browser/injected/index.mjs
 * Rebuild: node scripts/build-extension.js
 */
(function () {
if (typeof window === 'undefined') return;
${code}
})();
`;

fs.mkdirSync(path.dirname(DETECTOR_OUTPUT), { recursive: true });
fs.writeFileSync(DETECTOR_OUTPUT, output);
console.log(`Generated ${path.relative(ROOT, DETECTOR_OUTPUT)} (${(output.length / 1024).toFixed(1)} KB)`);

// --- 2. Extract antipatterns.json ---

// Include description so the devtools panel can show the full rule explanation
// in tooltips.
const apJson = ANTIPATTERNS.map(({ id, name, category, description }) => ({
  id,
  name,
  category: category || 'quality',
  description: description || '',
}));
fs.writeFileSync(AP_OUTPUT, JSON.stringify(apJson, null, 2) + '\n');
console.log(`Generated ${path.relative(ROOT, AP_OUTPUT)} (${ANTIPATTERNS.length} rules)`);

// --- 3. Zip packaging ---

import { execSync } from 'child_process';

const zipPath = path.join(ROOT, 'dist/extension.zip');
fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
try { fs.unlinkSync(zipPath); } catch {}
execSync(
  `zip -r ${JSON.stringify(zipPath)} . -x "STORE_LISTING.md" ".DS_Store"`,
  { cwd: EXT_DIR, stdio: 'pipe' },
);
const size = fs.statSync(zipPath).size;
console.log(`Packaged ${path.relative(ROOT, zipPath)} (${(size / 1024).toFixed(1)} KB)`);
