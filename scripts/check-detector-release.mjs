#!/usr/bin/env node
/**
 * Release-order guard for the closed detector.
 *
 * The open runtime links a prebuilt detector archive at build time
 * (crates/core/build.rs downloads it for the pinned DETECTOR_VERSION). An
 * engine release therefore cannot be built until the detector release exists.
 * This script verifies that `detector-v<DETECTOR_VERSION>` is fully published
 * on the public repo's GitHub Releases: one archive + .sha256 per target, the
 * browser bundle the extension vendors, and the in-page bundle (+ .sha256)
 * that crates/core/build.rs embeds for live mode's /detect.js.
 *
 *   node scripts/check-detector-release.mjs            # exits 1 and lists what is missing
 *   node scripts/check-detector-release.mjs --json     # machine-readable
 *
 * Environment:
 *   IMPECCABLE_DETECTOR_BASE  release root (default: the public repo's GitHub Releases;
 *                             the same variable crates/core/build.rs honors)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_DETECTOR_BASE = 'https://github.com/pbakaus/impeccable/releases/download';
export const DETECTOR_TARGETS = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64', 'windows-x64'];
export const BROWSER_BUNDLE_ASSET = 'detector-browser-bundle.zip';
/** The in-page wasm bundle crates/core/build.rs resolves beside the archive. */
export const IN_PAGE_BUNDLE_ASSET = 'detect-antipatterns-browser.js';

export function readDetectorVersion(root = ROOT) {
  return fs.readFileSync(path.join(root, 'DETECTOR_VERSION'), 'utf-8').trim();
}

/** The archive asset name for one target, as build.rs and the detector CI spell it. */
export function archiveAsset(target) {
  return target.startsWith('windows-') ? `impeccable_detector-${target}.lib` : `libimpeccable_detector-${target}.a`;
}

export function assetUrl(version, asset, base = process.env.IMPECCABLE_DETECTOR_BASE || DEFAULT_DETECTOR_BASE) {
  return `${base.replace(/\/$/, '')}/detector-v${version}/${asset}`;
}

// A ranged GET is the most portable existence probe: GitHub release downloads
// redirect to a signed storage URL that answers HEAD inconsistently.
async function urlExists(url, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(url, { method: 'GET', headers: { Range: 'bytes=0-0' }, redirect: 'follow' });
    if (res.body && typeof res.body.cancel === 'function') await res.body.cancel().catch(() => {});
    return res.status === 200 || res.status === 206;
  } catch {
    return false;
  }
}

/**
 * @returns {Promise<{ ok: boolean, version: string, base: string, missing: Array<{ kind: string, target?: string, what: string, url: string }> }>}
 */
export async function checkDetectorRelease({
  version = readDetectorVersion(),
  base = process.env.IMPECCABLE_DETECTOR_BASE || DEFAULT_DETECTOR_BASE,
  fetchImpl = fetch,
} = {}) {
  const missing = [];
  const probes = [];
  for (const target of DETECTOR_TARGETS) {
    const asset = archiveAsset(target);
    const url = assetUrl(version, asset, base);
    probes.push(
      urlExists(url, fetchImpl).then((ok) => { if (!ok) missing.push({ kind: 'archive', target, what: asset, url }); }),
      urlExists(`${url}.sha256`, fetchImpl).then((ok) => { if (!ok) missing.push({ kind: 'checksum', target, what: `${asset}.sha256`, url: `${url}.sha256` }); }),
    );
  }
  const bundleUrl = assetUrl(version, BROWSER_BUNDLE_ASSET, base);
  const inPageUrl = assetUrl(version, IN_PAGE_BUNDLE_ASSET, base);
  probes.push(
    urlExists(bundleUrl, fetchImpl).then((ok) => { if (!ok) missing.push({ kind: 'bundle', what: BROWSER_BUNDLE_ASSET, url: bundleUrl }); }),
    urlExists(inPageUrl, fetchImpl).then((ok) => { if (!ok) missing.push({ kind: 'in-page', what: IN_PAGE_BUNDLE_ASSET, url: inPageUrl }); }),
    urlExists(`${inPageUrl}.sha256`, fetchImpl).then((ok) => { if (!ok) missing.push({ kind: 'in-page-checksum', what: `${IN_PAGE_BUNDLE_ASSET}.sha256`, url: `${inPageUrl}.sha256` }); }),
  );
  await Promise.all(probes);
  // Plain byte order (not localeCompare, which files punctuation before
  // letters): per-target rows first, then the two bundle rows.
  const order = { archive: 0, checksum: 1, bundle: 2, 'in-page': 3, 'in-page-checksum': 4 };
  const key = (m) => m.target || (m.kind === 'bundle' ? 'zz-bundle' : 'zz-in-page');
  missing.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0) || order[a.kind] - order[b.kind]);
  return { ok: missing.length === 0, version, base, missing };
}

function main() {
  const json = process.argv.includes('--json');
  return checkDetectorRelease().then((result) => {
    if (json) {
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.ok ? 0 : 1);
    }
    if (result.ok) {
      console.log(`✓ detector v${result.version} release is complete: ${DETECTOR_TARGETS.length} archives + .sha256, ${BROWSER_BUNDLE_ASSET} and ${IN_PAGE_BUNDLE_ASSET} + .sha256 are published.`);
      console.log(`  release base: ${result.base}`);
      process.exit(0);
    }
    console.error(`✗ detector v${result.version} release is INCOMPLETE. Missing ${result.missing.length} asset(s):`);
    for (const m of result.missing) console.error(`    · ${m.what}\n        ${m.url}`);
    console.error('');
    console.error(`Publish detector v${result.version} (tag v${result.version} in the private detector repo; its CI`);
    console.error(`uploads the archives to this repo's detector-v${result.version} release) BEFORE tagging an engine`);
    console.error('release: crates/core/build.rs downloads the archive for every target it builds,');
    console.error(`and the ${IN_PAGE_BUNDLE_ASSET} it embeds for live mode.`);
    console.error(`  release base: ${result.base}`);
    process.exit(1);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
