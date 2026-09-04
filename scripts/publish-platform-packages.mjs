#!/usr/bin/env node
/**
 * Publish the five @impeccable/cli-<os>-<arch> npm platform packages for the
 * pinned ENGINE_VERSION from the engine-v<ENGINE_VERSION> GitHub release.
 *
 * Step 3 of the engine cutover, as one command:
 *
 *   bun run release:platform-packages            # publish every target not yet on npm
 *   bun run release:platform-packages -- --dry-run
 *   bun run release:platform-packages -- --target linux-x64
 *
 * For each target it downloads the release binary and its .sha256 sidecar
 * (the sidecar is required here: nothing unverified is ever published),
 * stages a package from cli/platform-packages/<target>/package.json with the
 * version stamped, the binary at bin/impeccable[.exe] (executable) and the
 * repo LICENSE, then runs `npm publish --access public` from the staging dir.
 * Targets already published at this version are skipped, so a re-run after a
 * partial failure picks up where it stopped.
 *
 * Preconditions checked up front: package.json optionalDependencies pin the
 * same version as ENGINE_VERSION, and `npm whoami` succeeds (log in first).
 *
 * Environment:
 *   IMPECCABLE_DOWNLOAD_BASE  release channel root (default: this repo's GitHub Releases)
 *   NPM_REGISTRY              registry used for the published-already probe (default: npmjs)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  ENGINE_TARGETS,
  assetUrl,
  binaryName,
  readEngineVersion,
} from './fetch-engine.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NPM_REGISTRY = (process.env.NPM_REGISTRY || 'https://registry.npmjs.org').replace(/\/$/, '');

export function packageName(target) {
  return `@impeccable/cli-${target}`;
}

/**
 * Build the package.json for one platform package from its template.
 * Pure: takes the template object and returns the stamped copy.
 */
export function stampTemplate(template, target, version) {
  const bin = binaryName(target);
  const expected = `bin/${bin}`;
  const binEntries = Object.values(template.bin || {});
  if (binEntries.length !== 1 || binEntries[0] !== expected) {
    throw new Error(`${packageName(target)} template must map its bin to ${expected} (got ${JSON.stringify(template.bin)})`);
  }
  if (template.name !== packageName(target)) {
    throw new Error(`template name ${template.name} does not match ${packageName(target)}`);
  }
  return { ...template, version };
}

/**
 * Stage one package into outDir: package.json, bin/<binary> (0755), LICENSE.
 * Returns the staged directory. No network; the caller supplies the bytes.
 */
export function stagePackage({ target, version, binary, template, license, outDir }) {
  const dir = path.join(outDir, target);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
  const pkg = stampTemplate(template, target, version);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  const binPath = path.join(dir, 'bin', binaryName(target));
  fs.writeFileSync(binPath, binary);
  fs.chmodSync(binPath, 0o755);
  fs.writeFileSync(path.join(dir, 'LICENSE'), license);
  return dir;
}

async function download(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Download and checksum-verify one release binary. The sidecar is mandatory. */
export async function fetchVerifiedBinary(target, version, base) {
  const url = assetUrl(version, target, base);
  let binary;
  try {
    binary = await download(url);
  } catch (err) {
    throw new Error(`release asset not available: ${err.message}. Publish engine-v${version} first (bun run release:engine) and wait for release-engine.yml to finish.`);
  }
  let sidecar;
  try {
    sidecar = (await download(`${url}.sha256`)).toString('utf-8').trim().split(/\s+/)[0];
  } catch (err) {
    throw new Error(`cannot verify ${url}: its .sha256 sidecar is missing (${err.message}); refusing to publish an unverified binary`);
  }
  if (!/^[0-9a-f]{64}$/i.test(sidecar || '')) {
    throw new Error(`cannot verify ${url}: its .sha256 sidecar is empty or malformed; refusing to publish an unverified binary`);
  }
  const actual = createHash('sha256').update(binary).digest('hex');
  if (actual !== sidecar.toLowerCase()) {
    throw new Error(`checksum mismatch for ${url}: expected ${sidecar}, got ${actual}`);
  }
  return binary;
}

/** True when <name>@<version> already exists on the registry. */
export async function isPublished(target, version, registry = NPM_REGISTRY) {
  const name = packageName(target).replace('/', '%2F');
  const res = await fetch(`${registry}/${name}/${version}`, { redirect: 'follow' });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`registry probe failed for ${packageName(target)}@${version}: ${res.status} ${res.statusText}`);
  return true;
}

function checkPins(version) {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
  const pins = pkg.optionalDependencies || {};
  const bad = ENGINE_TARGETS.filter((t) => pins[packageName(t)] !== version);
  if (bad.length) {
    const listed = bad.map((t) => `${packageName(t)}@${pins[packageName(t)] || 'missing'}`).join(', ');
    throw new Error(`package.json optionalDependencies do not pin ENGINE_VERSION ${version}: ${listed}. Bump them with ENGINE_VERSION first.`);
  }
}

function npmWhoami() {
  const res = spawnSync('npm', ['whoami', '--registry', NPM_REGISTRY], { encoding: 'utf-8' });
  if (res.status !== 0) {
    throw new Error(`npm is not logged in for ${NPM_REGISTRY} (npm whoami failed: ${(res.stderr || '').trim()}). Run \`npm login\` first.`);
  }
  return res.stdout.trim();
}

function npmPublish(dir, { dryRun }) {
  const args = ['publish', '--access', 'public', '--registry', NPM_REGISTRY];
  if (dryRun) args.push('--dry-run');
  const res = spawnSync('npm', args, { cwd: dir, stdio: 'inherit' });
  if (res.status !== 0) throw new Error(`npm publish failed in ${dir} (exit ${res.status})`);
}

function parseArgs(argv) {
  const opts = { targets: [], dryRun: false, force: false, keep: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--force') opts.force = true;
    else if (a === '--keep') opts.keep = true;
    else if (a === '--target') opts.targets.push(argv[++i]);
    else if (a === '--help' || a === '-h') {
      console.log('usage: publish-platform-packages.mjs [--dry-run] [--force] [--keep] [--target <os-arch>]...');
      process.exit(0);
    } else {
      console.error(`unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return opts;
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  const version = readEngineVersion();
  const targets = opts.targets.length ? opts.targets : ENGINE_TARGETS;
  for (const t of targets) {
    if (!ENGINE_TARGETS.includes(t)) throw new Error(`unsupported target ${t} (known: ${ENGINE_TARGETS.join(', ')})`);
  }
  checkPins(version);
  const licensePath = path.join(ROOT, 'LICENSE');
  if (!fs.existsSync(licensePath)) throw new Error(`LICENSE is missing at ${licensePath}; the platform packages ship it`);
  const license = fs.readFileSync(licensePath);
  const user = opts.dryRun ? '(dry run)' : npmWhoami();
  console.log(`→ Publishing @impeccable/cli-* platform packages for engine ${version} as ${user}`);

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-platform-packages-'));
  const results = [];
  try {
    for (const target of targets) {
      const name = packageName(target);
      if (!opts.force && (await isPublished(target, version))) {
        console.log(`  ${name}@${version} already published, skipping`);
        results.push({ target, status: 'skipped' });
        continue;
      }
      console.log(`  ${name}: downloading ${assetUrl(version, target)}`);
      const binary = await fetchVerifiedBinary(target, version, process.env.IMPECCABLE_DOWNLOAD_BASE);
      const template = JSON.parse(fs.readFileSync(path.join(ROOT, 'cli', 'platform-packages', target, 'package.json'), 'utf-8'));
      const dir = stagePackage({ target, version, binary, template, license, outDir });
      console.log(`  ${name}: staged ${dir} (${binary.length} bytes, checksum verified)`);
      npmPublish(dir, { dryRun: opts.dryRun });
      results.push({ target, status: opts.dryRun ? 'dry-run' : 'published' });
    }
  } finally {
    if (opts.keep) console.log(`  staging kept at ${outDir}`);
    else fs.rmSync(outDir, { recursive: true, force: true });
  }

  console.log('');
  for (const r of results) console.log(`✓ ${packageName(r.target)}@${version}: ${r.status}`);
  if (!opts.dryRun) {
    console.log('\n→ Next: `bun run check:engine-release` should now be fully green; then the clean-HOME launcher check, then merge.');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  });
}
