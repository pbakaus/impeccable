#!/usr/bin/env node
// `impeccable` npm shim: finds the platform binary and execs it with argv.
// Order: $IMPECCABLE_BIN, the @impeccable/cli-<os>-<arch> optional dependency,
// the version-pinned user cache (~/.impeccable/bin/<version>/), then a
// download into that cache from the public release channel. The cache and the
// download are verified against skill/scripts/engine-checksums.txt (shipped in
// the package); a <binary>.verified stamp records that a cached binary passed.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json');
const OS = { darwin: 'darwin', linux: 'linux', win32: 'windows' }[process.platform] || process.platform;
const ARCH = { arm64: 'arm64', x64: 'x64' }[process.arch] || process.arch;
const TARGET = `${OS}-${ARCH}`;
const EXE = OS === 'windows' ? 'impeccable.exe' : 'impeccable';
const PLATFORM_PKG = `@impeccable/cli-${TARGET}`;
// The engine version travels as the pinned optionalDependency range.
const VERSION = String(pkg.optionalDependencies?.[PLATFORM_PKG] || Object.values(pkg.optionalDependencies || {})[0] || '').replace(/^[^\d]*/, '');
const CACHE_ROOT = process.env.IMPECCABLE_HOME || path.join(os.homedir(), '.impeccable');
const CACHED = path.join(CACHE_ROOT, 'bin', VERSION, EXE);
const BASE = (process.env.IMPECCABLE_DOWNLOAD_BASE || 'https://github.com/pbakaus/impeccable/releases/download').replace(/\/$/, '');
const ASSET = `impeccable-${TARGET}${OS === 'windows' ? '.exe' : ''}`;
const URL = `${BASE}/engine-v${VERSION}/${ASSET}`;
const MANIFEST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'skill', 'scripts', 'engine-checksums.txt');
const STAMP = `${CACHED}.verified`;

function exists(p) { try { return !!p && fs.statSync(p).isFile(); } catch { return false; } }
// The digest MANIFEST records for this version and asset, or '' when none.
function expectedDigest() {
  try {
    for (const line of fs.readFileSync(MANIFEST, 'utf8').split(/\r?\n/)) {
      const [version, asset, sum] = line.trim().split(/\s+/);
      if (version === VERSION && asset === ASSET) return (sum || '').toLowerCase();
    }
  } catch { /* no manifest: nothing verifies */ }
  return '';
}
function fromPackage() {
  try { return path.join(path.dirname(require.resolve(`${PLATFORM_PKG}/package.json`)), 'bin', EXE); } catch { return null; }
}
async function download() {
  if (!VERSION) return null;
  // Fail closed, like the skill launcher and `impeccable install`: no digest
  // on record refuses the download before any request, and nothing is written
  // until the hash matches, so a refusal leaves the cache dir untouched.
  const expected = expectedDigest();
  if (!expected) {
    throw new Error(`no checksum for engine ${VERSION} (${ASSET}) in ${MANIFEST}; refusing the unverified download`);
  }
  const res = await fetch(URL, { redirect: 'follow' });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (createHash('sha256').update(buf).digest('hex') !== expected) {
    throw new Error(`checksum mismatch downloading ${URL}`);
  }
  fs.mkdirSync(path.dirname(CACHED), { recursive: true });
  const tmp = `${CACHED}.part.${process.pid}`;
  try {
    fs.writeFileSync(tmp, buf, { mode: 0o755 });
    fs.renameSync(tmp, CACHED);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
    throw err;
  }
  try { fs.writeFileSync(STAMP, `${expected}\n`); } catch { /* next run hashes again */ }
  return CACHED;
}
async function locate() {
  const envBin = process.env.IMPECCABLE_BIN;
  if (exists(envBin)) return envBin;
  const fromPkg = fromPackage();
  if (exists(fromPkg)) return fromPkg;
  if (exists(CACHED)) {
    if (exists(STAMP)) return CACHED;
    let digest = '';
    try { digest = createHash('sha256').update(fs.readFileSync(CACHED)).digest('hex'); } catch { /* unreadable: unverified */ }
    if (digest && digest === expectedDigest()) {
      try { fs.writeFileSync(STAMP, `${digest}\n`); } catch { /* read-only cache: verified this run */ }
      return CACHED;
    }
    process.stderr.write(`impeccable: cannot verify the cached engine ${CACHED} against ${MANIFEST}; downloading engine ${VERSION} again\n`);
  }
  return download().catch((err) => { process.stderr.write(`impeccable: ${err.message}\n`); return null; });
}

// `--version` / `-v` is answered by the shim itself: the number users mean
// is this npm package's version, not the engine's (docs/CLI-CONTRACT.md).
const argv = process.argv.slice(2);
if (argv[0] === '--version' || argv[0] === '-v') {
  process.stdout.write(`${pkg.version}\n`);
  process.exit(0);
}

const bin = await locate();
if (!bin) {
  process.stderr.write(
    `impeccable: no binary for ${TARGET}. Install ${PLATFORM_PKG}@${VERSION}, set IMPECCABLE_BIN, `
    + `or download impeccable-${TARGET} v${VERSION} from ${BASE} into ${CACHED}.\n`,
  );
  process.exit(127);
}
const result = spawnSync(bin, argv, {
  stdio: 'inherit',
  env: { IMPECCABLE_SELF: 'npx impeccable', ...process.env },
});
if (result.error) {
  process.stderr.write(`impeccable: failed to run ${bin}: ${result.error.message}\n`);
  process.exit(127);
}
process.exit(result.status === null ? 1 : result.status);
