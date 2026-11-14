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
 * 3. Packages, from the one source (scripts/lib/extension-manifests.js):
 *    - extension.zip: "Impeccable" for the Chrome Web Store: the detector,
 *      walks and the account, held to production hosts. Unpacked, it is
 *      extension/ itself.
 *    - extension-firefox.zip: the detector for AMO. Firefox cannot drive a
 *      tab through the debugger, so it has no walks.
 *    - extension-dev/ (no zip): extension/ plus the servers a developer names
 *      in the untracked extension/dev-hosts.local.json, to load unpacked.
 *
 * The Firefox manifest declares the detector's background worker as an
 * event-page `scripts` entry (the universally-supported path on Gecko), and
 * `browser_specific_settings.gecko` is added for AMO signing.
 *
 * Chrome hosts the WebAssembly rule core in an offscreen document; Firefox
 * loads the same document in a hidden iframe inside its background event page.
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
import { DETECTOR_WORKER, DEV_HOSTS, moduleReferences, stageDev, stageFirefox, stageStore } from './lib/extension-manifests.js';

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
  add(manifest.side_panel?.default_path);
  add(manifest.action?.default_popup);
  add(manifest.options_ui?.page);
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

/** Throws unless every path `manifest` and its background reference exists under `dir`. */
function checkReferences(dir, manifest, label) {
  const background = manifest.background?.service_worker;
  const swSource = fs.readFileSync(path.join(EXT_DIR, DETECTOR_WORKER), 'utf-8');
  const declared = manifestReferences(manifest);
  const loaded = background && manifest.background?.type === 'module' ? moduleReferences(dir, background) : [];
  // The detector's worker opens and injects its files by path.
  const detector = [...declared, ...loaded].includes(DETECTOR_WORKER) ? serviceWorkerReferences(swSource) : [];
  const referenced = [...new Set([...declared, ...loaded, ...detector])];
  const missingRefs = referenced.filter((rel) => !fs.existsSync(path.join(dir, rel)));
  if (missingRefs.length) {
    throw new Error(
      `${label} is missing referenced file(s):\n${missingRefs.map((r) => `  · ${r}`).join('\n')}`,
    );
  }
  console.log(`Checked ${referenced.length} referenced paths; all present in ${label}`);
}

checkReferences(EXT_DIR, chromeManifest, 'extension/');

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

// --- 3a. The Chrome store zip ---

const chromeStageDir = path.join(DIST, 'extension-chrome');
const chromeStoreManifest = stageStore(EXT_DIR, chromeStageDir);
console.log(`Staged ${path.relative(ROOT, chromeStageDir)}/ (Chrome store manifest)`);
checkReferences(chromeStageDir, chromeStoreManifest, `${path.relative(ROOT, chromeStageDir)}/`);
packZip(path.join(DIST, 'extension.zip'), chromeStageDir, ['*.DS_Store']);

// --- 3b. Firefox: stage an unpacked build (consumed by `web-ext lint` in CI),
// then zip it for AMO. ---

const ffStageDir = path.join(DIST, 'extension-firefox');
const firefoxManifest = stageFirefox(EXT_DIR, ffStageDir);
console.log(`Staged ${path.relative(ROOT, ffStageDir)}/ (Firefox manifest)`);
checkReferences(ffStageDir, firefoxManifest, `${path.relative(ROOT, ffStageDir)}/`);
packZip(path.join(DIST, 'extension-firefox.zip'), ffStageDir, ['*.DS_Store']);

// --- 3c. The development build: loaded unpacked, never zipped. ---

const devStageDir = path.join(DIST, 'extension-dev');
const dev = stageDev(EXT_DIR, devStageDir);
console.log(`Staged ${path.relative(ROOT, devStageDir)}/ (development; ${dev.servers.length} server(s) from extension/${DEV_HOSTS})`);
checkReferences(devStageDir, dev.manifest, `${path.relative(ROOT, devStageDir)}/`);
