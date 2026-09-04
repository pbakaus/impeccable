/**
 * The runner's group shutdown.
 *
 * Two properties, and the first is the one that regressed: ending a group must
 * return as soon as the child is actually gone. A wait implemented as a poll on
 * `kill(pid, 0)` cannot do that, because a dead child is a zombie until this
 * process reaps it and a blocked event loop never reaps anything. Such a wait
 * always burns its whole grace period and always ends in a needless SIGKILL.
 *
 * Run with: node --test tests/process-group.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { killGroupSync, stopGroup, trackChildExit } from '../scripts/lib/process-group.mjs';

const POSIX = process.platform !== 'win32';

/** A child in its own process group that exits on SIGTERM, the ordinary case. */
function spawnObedient() {
  return spawnDetached('setInterval(() => {}, 1000);');
}

/** A child that traps SIGTERM and keeps running, so only SIGKILL ends it. */
function spawnStubborn() {
  return spawnDetached("process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);");
}

function spawnDetached(source) {
  const child = spawn(process.execPath, ['-e', source], {
    detached: true,
    stdio: 'ignore',
  });
  return trackChildExit(child);
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

describe('stopGroup', () => {
  it('returns as soon as the child exits, not after the grace period', {
    skip: POSIX ? false : 'process groups and SIGTERM are POSIX-only',
  }, async () => {
    const running = spawnObedient();
    const startedAt = Date.now();
    const outcome = await stopGroup(running, { graceMs: 5_000 });
    const elapsed = Date.now() - startedAt;

    assert.equal(outcome, 'exited');
    // The regression this pins: a poll on liveness could not see the reaped
    // child and would have taken the full 5s.
    assert.ok(elapsed < 1_000, `expected a prompt return, took ${elapsed}ms`);
    assert.equal(running.hasExited, true);
  });

  it('escalates to SIGKILL when the child ignores SIGTERM', {
    skip: POSIX ? false : 'process groups and SIGTERM are POSIX-only',
  }, async () => {
    const running = spawnStubborn();
    const { pid } = running.child;
    // Give the trap a moment to be installed, so the SIGTERM lands on a child
    // that really is ignoring it.
    await new Promise((r) => setTimeout(r, 250));

    const startedAt = Date.now();
    const outcome = await stopGroup(running, { graceMs: 400, killGraceMs: 2_000 });
    const elapsed = Date.now() - startedAt;

    assert.equal(outcome, 'killed');
    assert.ok(elapsed >= 400, `should have waited out the grace period, took ${elapsed}ms`);
    assert.equal(running.hasExited, true);
    assert.equal(isAlive(pid), false);
  });

  it('is a no-op for a child that has already exited', async () => {
    const running = spawnObedient();
    await stopGroup(running, { graceMs: 5_000 });
    assert.equal(await stopGroup(running, { graceMs: 5_000 }), 'already-gone');
  });
});

describe('killGroupSync', () => {
  it('ends a stubborn child without awaiting anything', {
    skip: POSIX ? false : 'process groups and SIGTERM are POSIX-only',
  }, async () => {
    const running = spawnStubborn();
    const { pid } = running.child;
    await new Promise((r) => setTimeout(r, 250));

    assert.equal(killGroupSync(running), true);
    // It cannot wait, so the death is observed here rather than there.
    await running.exited;
    assert.equal(isAlive(pid), false);
  });

  it('reports nothing to do when the child has already exited', async () => {
    const running = spawnObedient();
    await stopGroup(running, { graceMs: 5_000 });
    assert.equal(killGroupSync(running), false);
  });
});
