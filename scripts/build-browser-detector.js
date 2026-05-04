#!/usr/bin/env node

/**
 * Generates cli/engine/detect-antipatterns-browser.js
 * by stripping Node-specific sections from the universal source and wrapping in an IIFE.
 *
 * Run: node scripts/build-browser-detector.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SOURCE = path.join(ROOT, 'cli/engine/detect-antipatterns.mjs');
const OUTPUT = path.join(ROOT, 'cli/engine/detect-antipatterns-browser.js');

let code = fs.readFileSync(SOURCE, 'utf-8');

// Strip shebang
code = code.replace(/^#!.*\n/, '');
// Strip sections between @browser-strip-start / @browser-strip-end markers
code = code.replace(/^\/\/ @browser-strip-start\n[\s\S]*?^\/\/ @browser-strip-end\n?/gm, '');
// Set IS_BROWSER = true (dead-code eliminates Node paths)
code = code.replace(/^const IS_BROWSER = .*$/m, 'const IS_BROWSER = true;');

const output = `/**
 * Anti-Pattern Browser Detector for Impeccable
 * Copyright (c) 2026 Paul Bakaus
 * SPDX-License-Identifier: Apache-2.0
 *
 * GENERATED -- do not edit. Source: detect-antipatterns.mjs
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
console.log(`Generated ${path.relative(ROOT, OUTPUT)} (${(output.length / 1024).toFixed(1)} KB)`);
