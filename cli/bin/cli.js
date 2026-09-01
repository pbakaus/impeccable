#!/usr/bin/env node
// `impeccable` npm shim: finds the platform binary and execs it with argv.
// Order: $IMPECCABLE_BIN, the @impeccable/cli-<os>-<arch> optional dependency,
// the version-pinned user cache (~/.impeccable/bin/<version>/), then a
// download into that cache from the public release channel.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

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
const URL = `${BASE}/engine-v${VERSION}/impeccable-${TARGET}${OS === 'windows' ? '.exe' : ''}`;

function exists(p) { try { return !!p && fs.statSync(p).isFile(); } catch { return false; } }
function fromPackage() {
  try { return path.join(path.dirname(require.resolve(`${PLATFORM_PKG}/package.json`)), 'bin', EXE); } catch { return null; }
}
async function download() {
  if (!VERSION) return null;
  const res = await fetch(URL, { redirect: 'follow' });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  const sum = await fetch(`${URL}.sha256`, { redirect: 'follow' }).then(r => (r.ok ? r.text() : ''), () => '');
  const expected = sum.trim().split(/\s+/)[0];
  if (expected && createHash('sha256').update(buf).digest('hex') !== expected) {
    throw new Error(`checksum mismatch downloading ${URL}`);
  }
  fs.mkdirSync(path.dirname(CACHED), { recursive: true });
  const tmp = `${CACHED}.part.${process.pid}`;
  fs.writeFileSync(tmp, buf, { mode: 0o755 });
  fs.renameSync(tmp, CACHED);
  return CACHED;
}
async function locate() {
  const envBin = process.env.IMPECCABLE_BIN;
  if (exists(envBin)) return envBin;
  const fromPkg = fromPackage();
  if (exists(fromPkg)) return fromPkg;
  if (exists(CACHED)) return CACHED;
  return download().catch((err) => { process.stderr.write(`impeccable: ${err.message}\n`); return null; });
}

const bin = await locate();
if (!bin) {
  process.stderr.write(
    `impeccable: no binary for ${TARGET}. Install ${PLATFORM_PKG}@${VERSION}, set IMPECCABLE_BIN, `
    + `or download impeccable-${TARGET} v${VERSION} from ${BASE} into ${CACHED}.\n`,
  );
  process.exit(127);
}
const result = spawnSync(bin, process.argv.slice(2), {
  stdio: 'inherit',
  env: { IMPECCABLE_SELF: 'npx impeccable', ...process.env },
});
if (result.error) {
  process.stderr.write(`impeccable: failed to run ${bin}: ${result.error.message}\n`);
  process.exit(127);
}
process.exit(result.status === null ? 1 : result.status);
