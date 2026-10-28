#!/usr/bin/env node
/**
 * Release-order guard (triage decision D4).
 *
 * The launcher (skill/scripts/impeccable), the npm shim (cli/bin/cli.js), and
 * `impeccable install` all dead-end unless the engine release for the pinned
 * ENGINE_VERSION exists FIRST: the five platform binaries in the engine-v<version> GitHub Release
 * release channel AND the five @impeccable/cli-<os>-<arch> npm platform packages.
 * Nothing else mechanically stops a maintainer from tagging the skill release (or
 * merging and letting the sync workflow rewrite provider dirs) before those assets
 * are published, which breaks every install path.
 *
 * This script verifies, for the pinned engine version, that:
 *   1. each of the five release binaries impeccable-<os>-<arch>[.exe] is fetchable
 *   2. each binary's .sha256 sidecar is fetchable
 *   3. skill/scripts/engine-checksums.txt records the digest each sidecar publishes
 *   4. each npm platform package @impeccable/cli-<os>-<arch>@<version> is published
 *
 * Downloads trust engine-checksums.txt, never the sidecar; check 3 only proves
 * the two still agree. `--record` hashes the five downloaded binaries into the
 * manifest first, so a binary that disagrees with its own sidecar fails the run.
 *
 * Exits 0 when everything is present, non-zero (naming exactly what is missing)
 * otherwise. release.mjs runs it before an engine-dependent release; CI runs it
 * as a soft warning until the first engine release exists.
 *
 *   node scripts/check-engine-release.mjs            # check the pinned ENGINE_VERSION
 *   node scripts/check-engine-release.mjs --json     # machine-readable report
 *   node scripts/check-engine-release.mjs --record   # write engine-checksums.txt, then check
 *
 * Environment:
 *   IMPECCABLE_DOWNLOAD_BASE  release root (default: the public repo's GitHub Releases)
 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import {
  ENGINE_TARGETS,
  DEFAULT_DOWNLOAD_BASE,
  readEngineVersion,
  assetName,
  assetUrl,
  download,
  expectedChecksum,
  manifestPath,
} from './fetch-engine.mjs';

const NPM_REGISTRY = 'https://registry.npmjs.org';

// A ranged GET is the most portable existence probe: GitHub release downloads
// answer HEAD inconsistently across their 302 to object storage, but a
// `Range: bytes=0-0` GET follows the redirect and returns 200/206 for a real
// asset and 404 for a missing one without pulling the whole binary.
async function urlExists(url) {
  try {
    const res = await fetch(url, { redirect: 'follow', headers: { Range: 'bytes=0-0' } });
    return res.ok || res.status === 206;
  } catch (err) {
    return false;
  }
}

// The digest a .sha256 sidecar publishes, or null when it cannot be fetched.
async function sidecarDigest(url) {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    return res.ok ? (await res.text()).trim().split(/\s+/)[0].toLowerCase() || null : null;
  } catch {
    return null;
  }
}

function npmPackageUrl(target, version, registry) {
  // Scoped name: the slash is percent-encoded for the registry path.
  const name = `@impeccable/cli-${target}`;
  return `${registry}/${name.replace('/', '%2f')}/${version}`;
}

async function npmVersionExists(target, version, registry) {
  const url = npmPackageUrl(target, version, registry);
  try {
    const res = await fetch(url, { redirect: 'follow' });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Check every asset for one engine version. Returns { ok, version, base, missing }
 * where missing is a list of { kind, target, what, url } entries.
 */
export async function checkEngineRelease({
  version = readEngineVersion(),
  base = process.env.IMPECCABLE_DOWNLOAD_BASE || DEFAULT_DOWNLOAD_BASE,
  root,
  registry = NPM_REGISTRY,
} = {}) {
  const missing = [];

  await Promise.all(
    ENGINE_TARGETS.map(async (target) => {
      const binUrl = assetUrl(version, target, base);
      const shaUrl = `${binUrl}.sha256`;
      const npmUrl = npmPackageUrl(target, version, registry);

      const [binOk, published, npmOk] = await Promise.all([
        urlExists(binUrl),
        sidecarDigest(shaUrl),
        npmVersionExists(target, version, registry),
      ]);
      const recorded = expectedChecksum(version, target, root);

      if (!binOk) missing.push({ kind: 'binary', target, what: `impeccable-${target} binary`, url: binUrl });
      if (!published) missing.push({ kind: 'checksum', target, what: `impeccable-${target} .sha256`, url: shaUrl });
      else if (recorded !== published) {
        missing.push({
          kind: 'manifest',
          target,
          what: `engine-checksums.txt line for ${version} ${assetName(target)} (${recorded ? `records ${recorded}, the release publishes ${published}` : 'none'}; run check-engine-release --record)`,
          url: manifestPath(root),
        });
      }
      if (!npmOk) missing.push({ kind: 'npm', target, what: `@impeccable/cli-${target}@${version}`, url: npmUrl });
    })
  );

  // Stable ordering for a readable report: by target, then binary/checksum/manifest/npm.
  const order = { binary: 0, checksum: 1, manifest: 2, npm: 3 };
  missing.sort((a, b) => ENGINE_TARGETS.indexOf(a.target) - ENGINE_TARGETS.indexOf(b.target) || order[a.kind] - order[b.kind]);

  return { ok: missing.length === 0, version, base, missing };
}

/**
 * Download the five release binaries for `version`, hash them, and write
 * engine-checksums.txt with one line per asset. The manifest holds the pinned
 * version only; each engine release replaces it.
 */
export async function recordEngineChecksums({
  version = readEngineVersion(),
  base = process.env.IMPECCABLE_DOWNLOAD_BASE || DEFAULT_DOWNLOAD_BASE,
  root,
} = {}) {
  const lines = await Promise.all(ENGINE_TARGETS.map(async (target) => {
    const digest = createHash('sha256').update(await download(assetUrl(version, target, base))).digest('hex');
    return `${version} ${assetName(target)} ${digest}`;
  }));
  fs.writeFileSync(manifestPath(root), [
    '# Engine binary digests for the pinned ENGINE_VERSION: <engine-version> <asset> <sha256>.',
    '# The launchers, the npm shim, `impeccable install` and scripts/fetch-engine.mjs verify',
    '# every engine download against this file. Written by',
    '# `node scripts/check-engine-release.mjs --record` after each engine release.',
    ...lines,
    '',
  ].join('\n'));
}

function report(result) {
  const { ok, version, base, missing } = result;
  if (ok) {
    console.log(`✓ engine v${version} release is complete: all ${ENGINE_TARGETS.length} binaries + .sha256 + npm platform packages are published, and engine-checksums.txt matches.`);
    console.log(`  release base: ${base}`);
    return;
  }
  const unpublished = missing.filter((m) => m.kind !== 'manifest');
  const stale = missing.filter((m) => m.kind === 'manifest');
  const list = (entries) => {
    for (const m of entries) {
      console.error(`  · ${m.what}`);
      console.error(`      ${m.url}`);
    }
  };
  if (unpublished.length) {
    console.error(`✗ engine v${version} release is INCOMPLETE — ${unpublished.length} asset(s) missing:`);
    list(unpublished);
    console.error('');
    console.error(`Publish engine v${version} (tag engine-v${version}, bun run release:engine) AND the`);
    console.error('five @impeccable/cli-<os>-<arch> npm platform packages BEFORE releasing the');
    console.error('skill or merging rust-swap. Ordering: engine release → platform packages →');
    console.error('skill release/merge. See CLAUDE.md "Releases" and docs REVIEW-TRIAGE.md D4.');
  }
  if (stale.length) {
    console.error(`✗ skill/scripts/engine-checksums.txt disagrees with the engine v${version} release:`);
    list(stale);
    console.error('');
    console.error('Run node scripts/check-engine-release.mjs --record and commit the manifest.');
  }
  console.error(`  release base: ${base}`);
}

async function main(argv = process.argv.slice(2)) {
  const json = argv.includes('--json');
  if (argv.includes('--record')) await recordEngineChecksums();
  const result = await checkEngineRelease();
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    report(result);
  }
  return result.ok ? 0 : 1;
}

// Run only when invoked directly, not when imported by release.mjs.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code), (err) => { console.error(`check-engine-release: ${err.message}`); process.exit(1); });
}
