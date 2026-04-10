#!/usr/bin/env node

/**
 * Builds the Chrome DevTools extension.
 *
 * 1. Generates the extension variant of the browser detector
 * 2. Extracts antipatterns.json for the panel UI
 * 3. Optionally packages as a .zip for Chrome Web Store
 *
 * Run: node scripts/build-extension.js
 *      node scripts/build-extension.js --zip
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ANTIPATTERNS } from '../src/detect-antipatterns.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EXT_DIR = path.join(ROOT, 'extension');

const SOURCE = path.join(ROOT, 'src/detect-antipatterns.mjs');
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

const apJson = ANTIPATTERNS.map(({ id, name, category, description }) => ({
  id,
  name,
  category: category || 'quality',
  description: description || '',
}));
fs.writeFileSync(AP_OUTPUT, JSON.stringify(apJson, null, 2) + '\n');
console.log(`Generated ${path.relative(ROOT, AP_OUTPUT)} (${ANTIPATTERNS.length} rules)`);

// --- 3. Zip packaging ---

if (process.argv.includes('--zip')) {
  const archiver = (await import('archiver')).default;
  const zipPath = path.join(ROOT, 'dist/impeccable-extension.zip');
  fs.mkdirSync(path.dirname(zipPath), { recursive: true });

  const zipStream = fs.createWriteStream(zipPath);
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.pipe(zipStream);
  archive.directory(EXT_DIR, false);

  await archive.finalize();
  const size = fs.statSync(zipPath).size;
  console.log(`Packaged ${path.relative(ROOT, zipPath)} (${(size / 1024).toFixed(1)} KB)`);
}
