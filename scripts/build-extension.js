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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EXT_DIR = path.join(ROOT, 'extension');

const SOURCE = path.join(ROOT, 'cli/engine/detect-antipatterns.mjs');
const DETECTOR_OUTPUT = path.join(EXT_DIR, 'detector/detect.js');
const AP_OUTPUT = path.join(EXT_DIR, 'detector/antipatterns.json');

let code = fs.readFileSync(SOURCE, 'utf-8');

// --- 1. Build detector ---

// Strip shebang
code = code.replace(/^#!.*\n/, '');
// Strip sections between @browser-strip-start / @browser-strip-end markers
code = code.replace(/^\/\/ @browser-strip-start\n[\s\S]*?^\/\/ @browser-strip-end\n?/gm, '');
// Set IS_BROWSER = true (dead-code eliminates Node paths)
code = code.replace(/^const IS_BROWSER = .*$/m, 'const IS_BROWSER = true;');

const output = `/**
 * Anti-Pattern Browser Detector for Impeccable (Extension Variant)
 * Copyright (c) 2026 Paul Bakaus
 * SPDX-License-Identifier: Apache-2.0
 *
 * GENERATED -- do not edit. Source: detect-antipatterns.mjs
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

const rawSource = fs.readFileSync(SOURCE, 'utf-8');
const apMatch = rawSource.match(/const ANTIPATTERNS = \[([\s\S]*?)\n\];/);
if (apMatch) {
  // Convert JS object literals to JSON. Include description so the
  // devtools panel can show the full rule explanation in tooltips —
  // previously this dropped description and the panel had nothing to display.
  const antipatterns = new Function(`return [${apMatch[1]}]`)();
  const apJson = antipatterns.map(({ id, name, category, description }) => ({
    id,
    name,
    category: category || 'quality',
    description: description || '',
  }));
  fs.writeFileSync(AP_OUTPUT, JSON.stringify(apJson, null, 2) + '\n');
  console.log(`Generated ${path.relative(ROOT, AP_OUTPUT)} (${antipatterns.length} rules)`);
}

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
