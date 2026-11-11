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
 *    The store zip's manifest holds the walk content scripts to the web app's
 *    production hosts; the source manifest keeps staging and localhost for
 *    Load unpacked.
 *
 * The source `extension/manifest.json` is the Chrome manifest. The Firefox
 * variant is derived at build time: the detector's background worker is
 * declared as an event-page `scripts` entry (the universally-supported path on
 * Gecko), and `browser_specific_settings.gecko` is added for AMO signing.
 * Walks (extension/walks/) are Chrome's alone: Firefox cannot drive a tab
 * through the debugger, so its build drops their permissions, content
 * scripts, side panel and files, and its background never loads them.
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
import { DETECTOR_WORKER, firefoxManifest as deriveFirefoxManifest, isFirefoxFile, storeManifest } from './lib/extension-manifests.js';

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

/** Every file a module worker loads through static imports, itself included. */
function moduleReferences(dir, entry) {
  const seen = new Set();
  const visit = (rel) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    const file = path.join(dir, rel);
    if (!fs.existsSync(file)) return;
    const source = fs.readFileSync(file, 'utf-8');
    for (const spec of source.matchAll(/^\s*import\s+(?:[^'"]*?\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/gm)) {
      visit(path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec[1])));
    }
  };
  visit(entry);
  return [...seen];
}

/** Throws unless every path `manifest` and its background reference exists under `dir`. */
function checkReferences(dir, manifest, label) {
  const background = manifest.background?.service_worker;
  const swSource = fs.readFileSync(path.join(EXT_DIR, DETECTOR_WORKER), 'utf-8');
  const referenced = [...new Set([
    ...manifestReferences(manifest),
    ...(background && manifest.background?.type === 'module' ? moduleReferences(dir, background) : []),
    ...serviceWorkerReferences(swSource),
  ])];
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

// --- 3a. Chrome store zip: the source tree with the store manifest ---

const chromeStageDir = path.join(DIST, 'extension-chrome');
const chromeStoreManifest = storeManifest(chromeManifest);
fs.rmSync(chromeStageDir, { recursive: true, force: true });
fs.cpSync(EXT_DIR, chromeStageDir, {
  recursive: true,
  filter: (src) => !['STORE_LISTING.md', '.DS_Store'].includes(path.basename(src)),
});
fs.writeFileSync(path.join(chromeStageDir, 'manifest.json'), JSON.stringify(chromeStoreManifest, null, 2) + '\n');
console.log(`Staged ${path.relative(ROOT, chromeStageDir)}/ (Chrome store manifest)`);
checkReferences(chromeStageDir, chromeStoreManifest, `${path.relative(ROOT, chromeStageDir)}/`);
packZip(path.join(DIST, 'extension.zip'), chromeStageDir, ['*.DS_Store']);

// --- 3b. Firefox: derive a Gecko-compatible manifest and stage an unpacked
// build (consumed by `web-ext lint` in CI), then zip it for AMO. ---

const firefoxManifest = deriveFirefoxManifest(chromeManifest);

const ffStageDir = path.join(DIST, 'extension-firefox');
fs.rmSync(ffStageDir, { recursive: true, force: true });
fs.cpSync(EXT_DIR, ffStageDir, {
  recursive: true,
  filter: (src) => {
    const base = path.basename(src);
    const rel = path.relative(EXT_DIR, src).split(path.sep).join('/');
    return base !== 'STORE_LISTING.md' && base !== '.DS_Store' && isFirefoxFile(rel, chromeManifest);
  },
});
fs.writeFileSync(
  path.join(ffStageDir, 'manifest.json'),
  JSON.stringify(firefoxManifest, null, 2) + '\n',
);
console.log(`Staged ${path.relative(ROOT, ffStageDir)}/ (Firefox manifest)`);
checkReferences(ffStageDir, firefoxManifest, `${path.relative(ROOT, ffStageDir)}/`);

// STORE_LISTING.md is already filtered out of the stage dir above.
packZip(path.join(DIST, 'extension-firefox.zip'), ffStageDir, ['*.DS_Store']);
