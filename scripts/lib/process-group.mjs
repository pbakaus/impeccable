/**
 * Stopping a spawned process group without blocking the event loop.
 *
 * The test runner puts every suite command in its own process group so one
 * signal can take down the runner, every test file it forked, and anything
 * those forked. Ending that group has one non-obvious constraint: **the wait
 * for the child to die cannot be a poll on liveness.**
 *
 * A dead child stays a zombie until its parent reaps it, and the parent here is
 * this process, which reaps through libuv when the event loop runs. So a busy
 * wait on `kill(pid, 0)` is doubly wrong: it blocks the very loop that would do
 * the reaping, and it then reads the unreaped zombie as alive. The wait would
 * always burn its full grace period and always end in a needless SIGKILL. There
 * is no waitpid from JavaScript that would see through this, so the wait has to
 * be asynchronous and keyed on the child's own `exit` event instead.
 */

/** Signal the whole group, then the child itself in case it leads no group. */
export function signalGroup(child, sig) {
  try { process.kill(-child.pid, sig); } catch { /* group already gone */ }
  try { child.kill(sig); } catch { /* already gone */ }
}

/**
 * Wrap a spawned child so its exit is observable as both a flag and a promise.
 * Register this before any other `exit` listener so `hasExited` is already true
 * by the time the others run.
 *
 * @returns {{child: import('node:child_process').ChildProcess, exited: Promise<void>, hasExited: boolean}}
 */
export function trackChildExit(child) {
  const running = { child, hasExited: false, exited: null };
  running.exited = new Promise((resolve) => {
    child.once('exit', () => {
      running.hasExited = true;
      resolve();
    });
  });
  return running;
}

/**
 * SIGTERM the group, wait for the child to actually exit, and escalate to
 * SIGKILL only if it has not exited within `graceMs`. Returns as soon as the
 * child is gone, so a suite that dies promptly costs milliseconds rather than
 * the whole grace period.
 *
 * @returns {Promise<'exited'|'killed'|'already-gone'>}
 */
export async function stopGroup(running, { graceMs = 2000, killGraceMs = 500 } = {}) {
  if (!running || running.hasExited) return 'already-gone';

  signalGroup(running.child, 'SIGTERM');
  if (await raceExit(running, graceMs)) return 'exited';

  signalGroup(running.child, 'SIGKILL');
  await raceExit(running, killGraceMs);
  return 'killed';
}

/**
 * The last resort, for `process.on('exit')` where the loop is closed and
 * nothing can be awaited. It cannot wait, so it does not pretend to: SIGTERM
 * for anything that handles it, then SIGKILL for anything that does not.
 */
export function killGroupSync(running) {
  if (!running || running.hasExited) return false;
  signalGroup(running.child, 'SIGTERM');
  signalGroup(running.child, 'SIGKILL');
  return true;
}

function raceExit(running, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    running.exited.then(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}
