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
import {
  createGroupShutdown,
  killGroupSync,
  stopGroup,
  trackChildExit,
} from '../scripts/lib/process-group.mjs';

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

describe('createGroupShutdown', () => {
  const posixOnly = { skip: POSIX ? false : 'process groups and SIGTERM are POSIX-only' };

  function spy() {
    const codes = [];
    return { codes, exit: (code) => codes.push(code) };
  }

  it('a second signal kills the group instead of abandoning the escalation', posixOnly, async () => {
    // The regression: the first handler used to clear the only reference to
    // the group before awaiting, so the second signal killed nothing and its
    // exit walked away from an escalation that was still in flight. Because
    // the suite is spawned detached, it then outlived the runner, which is the
    // exact leak this whole change exists to close.
    const running = spawnStubborn();
    const { pid } = running.child;
    await new Promise((r) => setTimeout(r, 250));

    const { codes, exit } = spy();
    const shutdown = createGroupShutdown({ exit, graceMs: 30_000 });
    shutdown.track(running);

    const first = shutdown.onSignal(130);
    await new Promise((r) => setTimeout(r, 150));

    const startedAt = Date.now();
    await shutdown.onSignal(130);
    await running.exited;
    const elapsed = Date.now() - startedAt;

    assert.equal(isAlive(pid), false, 'the second signal must end the group');
    assert.ok(elapsed < 2_000, `should not wait out the 30s grace, took ${elapsed}ms`);
    assert.equal(codes[0], 130);
    await first;
  });

  it('ends the group on the first signal when it exits promptly', posixOnly, async () => {
    const running = spawnObedient();
    const { pid } = running.child;
    const { codes, exit } = spy();
    const shutdown = createGroupShutdown({ exit, graceMs: 5_000 });
    shutdown.track(running);

    const startedAt = Date.now();
    await shutdown.onSignal(143);
    assert.ok(Date.now() - startedAt < 1_000);
    assert.deepEqual(codes, [143]);
    assert.equal(isAlive(pid), false);
  });

  it('onExit still reaches a group a shutdown is in the middle of stopping', posixOnly, async () => {
    const running = spawnStubborn();
    const { pid } = running.child;
    await new Promise((r) => setTimeout(r, 250));

    const { exit } = spy();
    const shutdown = createGroupShutdown({ exit, graceMs: 30_000 });
    shutdown.track(running);
    const inFlight = shutdown.onSignal(130);
    await new Promise((r) => setTimeout(r, 150));

    // `current` is null by now; the handle lives in `stopping`.
    assert.equal(shutdown.onExit(), true);
    await running.exited;
    assert.equal(isAlive(pid), false);
    await inFlight;
  });

  it('exits cleanly when no group is running', async () => {
    const { codes, exit } = spy();
    const shutdown = createGroupShutdown({ exit });
    await shutdown.onSignal(129);
    assert.deepEqual(codes, [129]);
    assert.equal(shutdown.onExit(), false);
  });

  it('reports that it is shutting down, so a normal exit is not misread', posixOnly, async () => {
    const running = spawnObedient();
    const shutdown = createGroupShutdown({ exit: () => {}, graceMs: 5_000 });
    shutdown.track(running);
    assert.equal(shutdown.shuttingDown, false);
    const done = shutdown.onSignal(130);
    assert.equal(shutdown.shuttingDown, true);
    await done;
  });
});
