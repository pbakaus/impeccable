/**
 * Tests for live/source-lock.mjs — the per-source-file mutex guarding the
 * accept/publish critical sections.
 * Run with: node --test tests/live-source-lock.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { sourceLockPath, withSourceLockSync } from '../skill/scripts/live/source-lock.mjs';

const TARGET = 'src/page.html';

describe('live source-lock', () => {
  let tmp;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'impeccable-source-lock-'));
    mkdirSync(join(tmp, 'src'), { recursive: true });
    writeFileSync(join(tmp, TARGET), '<div>original</div>\n');
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  const writeLock = (body) => {
    const lockPath = sourceLockPath(TARGET, tmp);
    mkdirSync(dirname(lockPath), { recursive: true });
    writeFileSync(lockPath, JSON.stringify(body) + '\n');
    return lockPath;
  };

  it('runs the critical section and releases the lock', () => {
    const lockPath = sourceLockPath(TARGET, tmp);
    const result = withSourceLockSync(TARGET, 'accept:a', () => {
      assert.equal(existsSync(lockPath), true, 'lock must exist while held');
      return 'done';
    }, { cwd: tmp });
    assert.equal(result, 'done');
    assert.equal(existsSync(lockPath), false, 'lock must be released');
  });

  it('throws SOURCE_LOCKED when a live owner holds the lock', () => {
    // process.pid is this very process, so the recorded owner is alive.
    writeLock({ owner: 'publish:x', token: 'other', pid: process.pid, at: Date.now() });
    assert.throws(
      () => withSourceLockSync(TARGET, 'accept:a', () => 'should not run', { cwd: tmp }),
      (err) => err.code === 'SOURCE_LOCKED',
    );
  });

  it('does not sweep a live owner’s lock no matter how old it is', () => {
    // Age alone must not make a lock stale: a holder suspended mid-write would
    // otherwise have a second writer admitted to the same source file.
    const lockPath = writeLock({ owner: 'publish:x', token: 'other', pid: process.pid, at: 0 });
    const ancient = new Date(Date.now() - 10 * 60_000);
    utimesSync(lockPath, ancient, ancient);
    assert.throws(
      () => withSourceLockSync(TARGET, 'accept:a', () => 'should not run', { cwd: tmp }),
      (err) => err.code === 'SOURCE_LOCKED',
      'an old but live lock was stolen',
    );
  });

  it('reclaims a lock whose owner process is gone, without waiting out a timeout', () => {
    // PID 2^22 is above the platform maximum, so it can never be running.
    writeLock({ owner: 'publish:crashed', token: 'other', pid: 4194304, at: Date.now() });
    const result = withSourceLockSync(TARGET, 'accept:a', () => 'acquired', { cwd: tmp });
    assert.equal(result, 'acquired', 'a crashed holder must not block the next writer');
  });

  it('leaves a replacement lock alone when its own was swept', () => {
    // Simulates: our lock got reclaimed and another writer now owns the file.
    // Releasing must not unlink the replacement and admit a third writer.
    const lockPath = sourceLockPath(TARGET, tmp);
    withSourceLockSync(TARGET, 'accept:a', () => {
      writeFileSync(lockPath, JSON.stringify({
        owner: 'publish:other', token: 'a-different-token', pid: process.pid, at: Date.now(),
      }) + '\n');
    }, { cwd: tmp });
    assert.equal(existsSync(lockPath), true, 'another owner’s lock must survive our release');
    assert.match(readFileSync(lockPath, 'utf-8'), /a-different-token/);
  });

  it('retires an unreadable lock only once it is older than the fallback window', () => {
    const lockPath = writeLock('');
    assert.throws(
      () => withSourceLockSync(TARGET, 'accept:a', () => 'x', { cwd: tmp }),
      (err) => err.code === 'SOURCE_LOCKED',
      'a fresh unreadable lock is an in-flight acquisition, not garbage',
    );
    const ancient = new Date(Date.now() - 120_000);
    utimesSync(lockPath, ancient, ancient);
    assert.equal(
      withSourceLockSync(TARGET, 'accept:a', () => 'acquired', { cwd: tmp }),
      'acquired',
      'a stale unreadable lock must be retired',
    );
  });

  it('releases the lock even when the critical section throws', () => {
    const lockPath = sourceLockPath(TARGET, tmp);
    assert.throws(() => withSourceLockSync(TARGET, 'accept:a', () => {
      throw new Error('boom');
    }, { cwd: tmp }), /boom/);
    assert.equal(existsSync(lockPath), false, 'a thrown critical section must not leak the lock');
  });
});
