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
import { bundleBrowserDetectorModules } from './lib/browser-detector-bundle.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const OUTPUT = path.join(ROOT, 'cli/engine/detect-antipatterns-browser.js');
const SITE_OUTPUT = path.join(ROOT, 'site/public/js/detect-antipatterns-browser.js');

const code = bundleBrowserDetectorModules(ROOT);

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
console.log(`Generated ${path.relative(ROOT, OUTPUT)} (${(output.length / 1024).toFixed(1)} KB)`);

// The site consumes this bundle from its own repo. Only mirror it when that
// checkout is present, so a build here never recreates a stray `site/` tree.
if (fs.existsSync(path.dirname(path.dirname(SITE_OUTPUT)))) {
  fs.mkdirSync(path.dirname(SITE_OUTPUT), { recursive: true });
  fs.writeFileSync(SITE_OUTPUT, output);
  console.log(`Generated ${path.relative(ROOT, SITE_OUTPUT)} (${(output.length / 1024).toFixed(1)} KB)`);
}
