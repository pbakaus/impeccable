#!/usr/bin/env node

/**
 * Builds the browser DevTools extension (Chrome + Firefox).
 *
 * 1. Builds the five generated detector pieces (core.js, core_bg.wasm,
 *    snapshot.js, overlay.js, antipatterns.json) into extension/detector/ by
 *    running `cargo xtask bundle`, which compiles the rule core to
 *    WebAssembly and concatenates it with the page JS in browser-bundle/.
 * 2. Checks that every path the manifest and the service worker reference
 *    exists in extension/.
 * 3. Packages extension.zip (Chrome Web Store) and extension-firefox.zip (AMO).
 *
 * The source `extension/manifest.json` is the Chrome manifest. The Firefox
 * variant is derived at build time: the MV3 background service worker is
 * declared as an event-page `scripts` entry (the universally-supported path on
 * Gecko), and `browser_specific_settings.gecko` is added for AMO signing.
 *
 * Firefox caveat: the shell runs the WebAssembly rule core in an extension
 * offscreen document, and Gecko has no `chrome.offscreen` API, so the Firefox
 * package builds and lints but cannot scan until that gap is closed. The
 * Firefox artifact is still produced so `web-ext lint` keeps covering the
 * shared shell.
 *
 * Needs a Rust toolchain and wasm-pack for step 1. CI matrices that already
 * ran `cargo xtask bundle` can skip it with IMPECCABLE_EXTENSION_SKIP_BUNDLE=1,
 * which is honored only when extension/detector/ already holds all five pieces.
 *
 * Run: node scripts/build-extension.js
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EXT_DIR = path.join(ROOT, 'extension');
const DETECTOR_DIR = path.join(EXT_DIR, 'detector');

// --- 1. Build the detector pieces (cargo xtask bundle) ---

/** The five generated pieces the extension shell loads. */
const DETECTOR_PIECES = ['core.js', 'core_bg.wasm', 'snapshot.js', 'overlay.js', 'antipatterns.json'];

const havePieces = DETECTOR_PIECES.every((piece) => fs.existsSync(path.join(DETECTOR_DIR, piece)));
if (process.env.IMPECCABLE_EXTENSION_SKIP_BUNDLE === '1' && havePieces) {
  console.log('Skipping `cargo xtask bundle` (IMPECCABLE_EXTENSION_SKIP_BUNDLE=1, extension/detector/ is complete)');
} else {
  console.log('Building extension/detector/ with `cargo xtask bundle` ...');
  execSync('cargo xtask bundle', { cwd: ROOT, stdio: 'inherit' });
}

const missingPieces = DETECTOR_PIECES.filter((piece) => !fs.existsSync(path.join(DETECTOR_DIR, piece)));
if (missingPieces.length) {
  throw new Error(
    `extension/detector/ is missing generated piece(s) after the bundle step:\n` +
      missingPieces.map((p) => `  \u00b7 ${p}`).join('\n'),
  );
}
const totalKb =
  DETECTOR_PIECES.reduce((sum, piece) => sum + fs.statSync(path.join(DETECTOR_DIR, piece)).size, 0) / 1024;
console.log(`Built ${DETECTOR_PIECES.length} detector pieces into extension/detector/ (${totalKb.toFixed(1)} KB)`);

const ruleCount = JSON.parse(fs.readFileSync(path.join(DETECTOR_DIR, 'antipatterns.json'), 'utf-8')).length;
console.log(`  antipatterns.json: ${ruleCount} rules`);

// --- 2. Referenced-file check ---

const chromeManifest = JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'manifest.json'), 'utf-8'));

const serviceWorker = chromeManifest.background?.service_worker;
if (!serviceWorker) {
  throw new Error(
    'extension/manifest.json: expected background.service_worker to derive the Firefox manifest',
  );
}

/** Every extension-relative path the manifest declares. */
function manifestReferences(manifest) {
  const refs = [];
  const add = (value) => { if (typeof value === 'string' && value) refs.push(value.replace(/^\//, '')); };
  add(manifest.background?.service_worker);
  for (const script of manifest.background?.scripts || []) add(script);
  add(manifest.devtools_page);
  add(manifest.action?.default_popup);
  for (const icon of Object.values(manifest.action?.default_icon || {})) add(icon);
  for (const icon of Object.values(manifest.icons || {})) add(icon);
  for (const entry of manifest.content_scripts || []) {
    for (const file of entry.js || []) add(file);
    for (const file of entry.css || []) add(file);
  }
  for (const entry of manifest.web_accessible_resources || []) {
    for (const resource of entry.resources || []) add(resource);
  }
  return refs;
}

/**
 * The service worker injects the content script and its generated companions
 * by path and opens the offscreen document by path, so those files are
 * referenced without appearing in the manifest.
 */
function serviceWorkerReferences(source) {
  const refs = [];
  const offscreen = source.match(/OFFSCREEN_URL\s*=\s*['"]([^'"]+)['"]/);
  if (offscreen) refs.push(offscreen[1]);
  for (const block of source.matchAll(/files:\s*\[([^\]]*)\]/g)) {
    for (const file of block[1].matchAll(/['"]([^'"]+)['"]/g)) refs.push(file[1]);
  }
  return refs;
}

const swSource = fs.readFileSync(path.join(EXT_DIR, serviceWorker), 'utf-8');
const referenced = [...new Set([...manifestReferences(chromeManifest), ...serviceWorkerReferences(swSource)])];
const missingRefs = referenced.filter((rel) => !fs.existsSync(path.join(EXT_DIR, rel)));
if (missingRefs.length) {
  throw new Error(
    `extension/ is missing referenced file(s):\n${missingRefs.map((r) => `  · ${r}`).join('\n')}`,
  );
}
console.log(`Checked ${referenced.length} referenced paths; all present in extension/`);

// --- 3. Zip packaging ---

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
      // The rules run in the extension's own offscreen document; nothing is
      // transmitted off-device.
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

console.warn(
  'Warning: the Firefox package cannot scan yet. The rule core runs in an ' +
    'extension offscreen document and Gecko has no chrome.offscreen API. The ' +
    'artifact is built so web-ext lint keeps covering the shared shell.',
);
