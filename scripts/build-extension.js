#!/usr/bin/env node

/**
 * Builds the browser DevTools extension (Chrome + Firefox).
 *
 * 1. Generates the extension variant of the browser detector
 * 2. Extracts antipatterns.json for the panel UI
 * 3. Packages extension.zip (Chrome Web Store) and extension-firefox.zip (AMO)
 *
 * The source `extension/manifest.json` is the Chrome manifest. The Firefox
 * variant is derived at build time: the MV3 background service worker is
 * declared as an event-page `scripts` entry (the universally-supported path on
 * Gecko), and `browser_specific_settings.gecko` is added for AMO signing.
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

const DIST = path.join(ROOT, 'dist');
fs.mkdirSync(DIST, { recursive: true });

// `excludes` are passed to `zip -x`; patterns match the full archive path with
// `*` spanning `/`, so `*.DS_Store` strips the file at every depth, not just root.
function packZip(zipPath, cwd, excludes = []) {
  try { fs.unlinkSync(zipPath); } catch {}
  const exArgs = excludes.map((e) => `-x ${JSON.stringify(e)}`).join(' ');
  execSync(
    `zip -r ${JSON.stringify(zipPath)} .${exArgs ? ' ' + exArgs : ''}`,
    { cwd, stdio: 'pipe' },
  );
  const size = fs.statSync(zipPath).size;
  console.log(`Packaged ${path.relative(ROOT, zipPath)} (${(size / 1024).toFixed(1)} KB)`);
}

// --- 3a. Chrome zip (manifest unchanged) ---

packZip(path.join(DIST, 'extension.zip'), EXT_DIR, ['STORE_LISTING.md', '*.DS_Store']);

// --- 3b. Firefox: derive a Gecko-compatible manifest and stage an unpacked
// build (consumed by `web-ext lint` in CI), then zip it for AMO. ---

const chromeManifest = JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'manifest.json'), 'utf-8'));

const serviceWorker = chromeManifest.background?.service_worker;
if (!serviceWorker) {
  throw new Error(
    'extension/manifest.json: expected background.service_worker to derive the Firefox manifest',
  );
}

const firefoxManifest = {
  ...chromeManifest,
  // Gecko supports MV3 via non-persistent event pages. Declaring `scripts`
  // (rather than `service_worker`) is the path supported across all MV3 Firefox
  // releases; service-worker.js uses only top-level listeners + an in-memory
  // Map, so it runs unchanged as an event page.
  background: { scripts: [serviceWorker] },
  // Required by AMO for signing/distribution. Ignored by Chrome.
  browser_specific_settings: {
    gecko: {
      id: 'impeccable@bakaus.com',
      // `data_collection_permissions` (below) is required by AMO for new
      // submissions and is only honored on Firefox 140+. We set the floor to
      // 140 so the declared min version actually supports every key we ship;
      // everything else this extension uses (MV3 action, scripting, devtools,
      // object-form web_accessible_resources, storage.sync) landed long before.
      strict_min_version: '140.0',
      // The detector runs entirely in-page; nothing is transmitted off-device.
      data_collection_permissions: { required: ['none'] },
    },
  },
};

const ffStageDir = path.join(DIST, 'extension-firefox');
fs.rmSync(ffStageDir, { recursive: true, force: true });
fs.cpSync(EXT_DIR, ffStageDir, {
  recursive: true,
  filter: (src) => {
    const base = path.basename(src);
    return base !== 'STORE_LISTING.md' && base !== '.DS_Store';
  },
});
fs.writeFileSync(
  path.join(ffStageDir, 'manifest.json'),
  JSON.stringify(firefoxManifest, null, 2) + '\n',
);
console.log(`Staged ${path.relative(ROOT, ffStageDir)}/ (Firefox manifest)`);

// STORE_LISTING.md is already filtered out of the stage dir above.
packZip(path.join(DIST, 'extension-firefox.zip'), ffStageDir, ['*.DS_Store']);
