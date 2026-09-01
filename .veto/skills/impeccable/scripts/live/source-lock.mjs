import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { getLiveDir, isLiveServerPidReachable } from '../lib/impeccable-paths.mjs';

// Only used to retire a lock whose contents we cannot read (empty or truncated
// by a crash mid-write). A readable lock's fate is decided by its owner's
// liveness instead, so a slow critical section is never swept.
const UNREADABLE_LOCK_STALE_MS = 60_000;

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
  // Identifies this acquisition specifically, so release can tell our own lock
  // from a replacement that some other writer created.
  const token = randomUUID();
  let acquired = false;

  while (!acquired) {
    clearStaleLock(lockPath);
    let fd;
    try {
      fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(fd, JSON.stringify({
        owner,
        token,
        pid: process.pid,
        at: Date.now(),
        file: path.resolve(cwd, file),
      }) + '\n');
      acquired = true;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) {
        const locked = new Error('source_locked');
        locked.code = 'SOURCE_LOCKED';
        locked.lockPath = lockPath;
        throw locked;
      }
      sleepSync(Math.max(1, Math.min(Number(retryMs) || 5, deadline - Date.now())));
    } finally {
      try { if (fd !== undefined) fs.closeSync(fd); } catch {}
    }
  }

  try {
    return fn();
  } finally {
    releaseOwnLock(lockPath, token);
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readLock(lockPath) {
  try { return JSON.parse(fs.readFileSync(lockPath, 'utf-8')); } catch { return null; }
}

/**
 * Remove the lock only if it is still the one this call created. If a sweeper
 * judged our lock stale and another writer replaced it, unlinking here would
 * end *their* critical section and admit a third writer to the same file.
 */
function releaseOwnLock(lockPath, token) {
  const held = readLock(lockPath);
  if (held && held.token !== token) return;
  try { fs.unlinkSync(lockPath); } catch {}
}

/**
 * A lock is stale when its owner is gone, not when it is old.
 *
 * Age alone cuts both ways: it sweeps a live holder whose critical section
 * outran the timeout (a suspended laptop, a stopped process), letting two
 * writers into the same source file, while still making every accept on a
 * crashed holder's file wait out the full timeout. Asking the OS whether the
 * recorded pid is alive answers both correctly: a dead owner releases at once,
 * and a live owner keeps its lock however long it needs.
 */
function clearStaleLock(lockPath) {
  const held = readLock(lockPath);
  if (!held) {
    // Unreadable: either a crash truncated it, or we caught the brief window
    // between create and write in a live acquisition. mtime distinguishes them.
    try {
      const stat = fs.statSync(lockPath);
      if (Date.now() - stat.mtimeMs > UNREADABLE_LOCK_STALE_MS) fs.unlinkSync(lockPath);
    } catch { /* gone already */ }
    return;
  }
  if (typeof held.pid === 'number' && isLiveServerPidReachable(held.pid)) return;
  try { fs.unlinkSync(lockPath); } catch {}
}
