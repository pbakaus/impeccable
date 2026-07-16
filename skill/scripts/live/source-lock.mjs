import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getLiveDir } from '../lib/impeccable-paths.mjs';

const STALE_LOCK_MS = 60_000;

export function sourceLockPath(file, cwd = process.cwd()) {
  const digest = createHash('sha256').update(path.resolve(cwd, file)).digest('hex').slice(0, 24);
  return path.join(getLiveDir(cwd), 'locks', digest + '.lock');
}

export function withSourceLockSync(file, owner, fn, {
  cwd = process.cwd(),
  waitMs = 0,
  retryMs = 5,
} = {}) {
  const lockPath = sourceLockPath(file, cwd);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const deadline = Date.now() + Math.max(0, Number(waitMs) || 0);
  let fd;
  while (fd === undefined) {
    clearStaleLock(lockPath);
    try {
      fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(fd, JSON.stringify({ owner, pid: process.pid, at: Date.now(), file: path.resolve(cwd, file) }) + '\n');
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) {
        const locked = new Error('source_locked');
        locked.code = 'SOURCE_LOCKED';
        locked.lockPath = lockPath;
        throw locked;
      }
      sleepSync(Math.max(1, Math.min(Number(retryMs) || 5, deadline - Date.now())));
    }
  }

  try {
    return fn();
  } finally {
    try { if (fd !== undefined) fs.closeSync(fd); } catch {}
    try { fs.unlinkSync(lockPath); } catch {}
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function clearStaleLock(lockPath) {
  try {
    const stat = fs.statSync(lockPath);
    if (Date.now() - stat.mtimeMs > STALE_LOCK_MS) fs.unlinkSync(lockPath);
  } catch {}
}
