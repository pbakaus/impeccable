#!/usr/bin/env node
/**
 * Fetch the pinned engine binary (root ENGINE_VERSION) for one or every
 * platform into skill/scripts/bin/<os>-<arch>/impeccable[.exe], the sibling
 * layout the launcher (skill/scripts/impeccable) looks in first.
 *
 *   node scripts/fetch-engine.mjs                # current platform
 *   node scripts/fetch-engine.mjs --all          # every release target
 *   node scripts/fetch-engine.mjs --target linux-x64 [--target ...]
 *   node scripts/fetch-engine.mjs --dest <dir>   # <dir>/<os>-<arch>/impeccable[.exe]
 *   node scripts/fetch-engine.mjs --lenient      # a target that cannot be fetched warns instead of failing
 *
 * Environment (same names the launcher honors):
 *   IMPECCABLE_DOWNLOAD_BASE  release channel root (default: the public repo's GitHub Releases)
 *   IMPECCABLE_BIN            copy this local binary for the current platform instead of downloading
 *
 * The URL scheme is the launcher's: <base>/engine-v<version>/impeccable-<os>-<arch>[.exe].
 * Every download is verified against the line for its version and asset in
 * skill/scripts/engine-checksums.txt; no line means no download.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_DOWNLOAD_BASE = 'https://github.com/pbakaus/impeccable/releases/download';
export const ENGINE_TARGETS = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64', 'windows-x64'];

export function readEngineVersion(root = ROOT) {
  return fs.readFileSync(path.join(root, 'ENGINE_VERSION'), 'utf-8').trim();
}

export function currentTarget() {
  const platform = { darwin: 'darwin', linux: 'linux', win32: 'windows' }[os.platform()] || 'unknown';
  const arch = { arm64: 'arm64', x64: 'x64' }[os.arch()] || 'unknown';
  return `${platform}-${arch}`;
}

export function binaryName(target) {
  return target.startsWith('windows-') ? 'impeccable.exe' : 'impeccable';
}

export function assetName(target) {
  return `impeccable-${target}${target.startsWith('windows-') ? '.exe' : ''}`;
}

export function assetUrl(version, target, base = process.env.IMPECCABLE_DOWNLOAD_BASE || DEFAULT_DOWNLOAD_BASE) {
  return `${base.replace(/\/$/, '')}/engine-v${version}/${assetName(target)}`;
}

export function manifestPath(root = ROOT) {
  return path.join(root, 'skill', 'scripts', 'engine-checksums.txt');
}

/**
 * The sha256 engine-checksums.txt records for one version and target, or null
 * when no line matches. Lines are `<version> <asset> <sha256>`; `#` comments
 * and blank lines are skipped. A malformed line throws, so a damaged manifest
 * never reads as "no entry".
 */
export function expectedChecksum(version, target, root = ROOT) {
  const file = manifestPath(root);
  if (!fs.existsSync(file)) return null;
  const lines = fs.readFileSync(file, 'utf-8').split(/\r?\n/);
  for (const [i, raw] of lines.entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const fields = line.split(/\s+/);
    if (fields.length !== 3 || !/^[0-9a-f]{64}$/.test(fields[2])) {
      throw new Error(`${file} line ${i + 1}: expected '<version> <asset> <sha256>', got ${JSON.stringify(line)}`);
    }
    if (fields[0] === version && fields[1] === assetName(target)) return fields[2];
  }
  return null;
}

export function binaryPath(target, dest = path.join(ROOT, 'skill', 'scripts', 'bin')) {
  return path.join(dest, target, binaryName(target));
}

export async function download(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function install(buffer, target, dest) {
  const out = binaryPath(target, dest);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const tmp = `${out}.part.${process.pid}`;
  fs.writeFileSync(tmp, buffer);
  fs.chmodSync(tmp, 0o755);
  fs.renameSync(tmp, out);
  return out;
}

/**
 * Fetch one target. Returns the installed path. Throws when the asset is
 * unavailable or its checksum does not match.
 */
export async function fetchEngine(target, { version = readEngineVersion(), dest, base, root } = {}) {
  const local = process.env.IMPECCABLE_BIN;
  if (local && target === currentTarget()) {
    if (!fs.existsSync(local)) throw new Error(`IMPECCABLE_BIN points at a missing file: ${local}`);
    return install(fs.readFileSync(local), target, dest);
  }
  const checksum = expectedChecksum(version, target, root);
  if (!checksum) {
    throw new Error(`no checksum for engine ${version} (${assetName(target)}) in ${manifestPath(root)}; refusing the unverified download`);
  }
  const url = assetUrl(version, target, base);
  const buffer = await download(url);
  const actual = createHash('sha256').update(buffer).digest('hex');
  if (actual !== checksum) throw new Error(`checksum mismatch for ${url}: expected ${checksum}, got ${actual}`);
  return install(buffer, target, dest);
}

function parseArgs(argv) {
  const opts = { targets: [], all: false, dest: undefined, lenient: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') opts.all = true;
    else if (a === '--lenient') opts.lenient = true;
    else if (a === '--target') opts.targets.push(argv[++i]);
    else if (a === '--dest') opts.dest = path.resolve(argv[++i]);
    else if (a === '--help' || a === '-h') { opts.help = true; }
    else throw new Error(`Unknown argument: ${a}`);
  }
  return opts;
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) {
    process.stdout.write('Usage: node scripts/fetch-engine.mjs [--all | --target <os-arch> ...] [--dest <dir>] [--lenient]\n');
    return 0;
  }
  const version = readEngineVersion();
  const targets = opts.all ? ENGINE_TARGETS : opts.targets.length ? opts.targets : [currentTarget()];
  let failures = 0;
  for (const target of targets) {
    if (!ENGINE_TARGETS.includes(target)) {
      process.stderr.write(`fetch-engine: unsupported target ${target} (known: ${ENGINE_TARGETS.join(', ')})\n`);
      failures++;
      continue;
    }
    try {
      const out = await fetchEngine(target, { version, dest: opts.dest });
      process.stdout.write(`fetch-engine: ${target} v${version} -> ${path.relative(ROOT, out)}\n`);
    } catch (err) {
      const line = `fetch-engine: ${target} v${version} unavailable: ${err.message}\n`;
      if (opts.lenient) process.stderr.write(`warning: ${line}`);
      else { process.stderr.write(line); failures++; }
    }
  }
  return failures ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code), (err) => { process.stderr.write(`fetch-engine: ${err.message}\n`); process.exit(1); });
}
