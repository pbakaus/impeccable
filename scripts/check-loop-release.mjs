#!/usr/bin/env node
// Check all embedded Loop pins, or record a release before shipping a new engine:
//   node scripts/check-loop-release.mjs
//   node scripts/check-loop-release.mjs --record 1.2.3
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_BASE = 'https://github.com/pbakaus/impeccable/releases/download';
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][\da-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][\da-zA-Z-]*))*))?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/;
const manifestPath = (root) => path.join(root, 'crates/cli/loop-checksums.txt');

export function parsePins(text) {
  const pins = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^([\da-fA-F]{64})\s+impeccable-loop-(.+)\.zip$/.exec(line);
    if (!match || !VERSION.test(match[2]) || pins.has(match[2])) throw new Error('Invalid Loop checksum manifest');
    pins.set(match[2], match[1].toLowerCase());
  }
  return pins;
}

// The configured base never carries a query; a redirect may (GitHub's release assets 302 to a signed ?sp=…&sig=… URL).
function secureUrl(raw, allowQuery = false) {
  const url = new URL(raw);
  if (url.username || url.password || (url.search && !allowQuery) || url.hash ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))) {
    throw new Error('Loop downloads require HTTPS (HTTP allowed only on localhost or 127.0.0.1)');
  }
  return url;
}

async function digest(version, base) {
  let url = secureUrl(`${base.replace(/\/$/, '')}/loop-v${version}/impeccable-loop-${version}.zip`);
  const localHttp = url.protocol === 'http:';
  for (let redirects = 0; redirects < 10; redirects++) {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(300_000) });
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel();
      if (!res.headers.get('location')) throw new Error('Loop redirect has no Location');
      url = secureUrl(new URL(res.headers.get('location'), url), true);
      if (!localHttp && url.protocol === 'http:') throw new Error('Refusing insecure Loop redirect');
      continue;
    }
    if (!res.ok) { await res.body?.cancel(); throw new Error(`HTTP ${res.status} for ${url}`); }
    const hash = createHash('sha256');
    for await (const chunk of res.body) hash.update(chunk);
    return hash.digest('hex');
  }
  throw new Error('Too many Loop redirects');
}

export async function checkLoopRelease({ root = ROOT, base = process.env.IMPECCABLE_DOWNLOAD_BASE || DEFAULT_BASE } = {}) {
  const pins = parsePins(fs.readFileSync(manifestPath(root), 'utf8'));
  for (const [version, expected] of pins) {
    if (await digest(version, base) !== expected) throw new Error(`Loop ${version}: SHA-256 checksum mismatch`);
  }
  return pins.size;
}

export async function recordLoopChecksum(version, { root = ROOT, base = process.env.IMPECCABLE_DOWNLOAD_BASE || DEFAULT_BASE } = {}) {
  if (!VERSION.test(version)) throw new Error('Expected --record <semver>');
  const file = manifestPath(root);
  const text = fs.readFileSync(file, 'utf8');
  const pins = parsePins(text);
  const actual = await digest(version, base);
  if (pins.has(version)) {
    if (pins.get(version) !== actual) throw new Error(`Loop ${version}: release differs from existing pin; refusing to overwrite`);
    return;
  }
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, `${text.trimEnd()}\n${actual}  impeccable-loop-${version}.zip\n`, { flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

async function main(args) {
  if (args.length === 2 && args[0] === '--record') await recordLoopChecksum(args[1]);
  else if (args.length) throw new Error('Usage: check-loop-release.mjs [--record <version>]');
  const count = await checkLoopRelease();
  console.log(`Loop release check: ${count} pinned release(s) verified.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => { console.error(`check-loop-release: ${err.message}`); process.exitCode = 1; });
}
