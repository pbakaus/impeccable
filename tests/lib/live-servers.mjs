/**
 * Test-side guard against leaked live servers.
 *
 * Any test file that starts a live server (directly, through
 * `live-server --background`, or through a full `live` boot) imports this and
 * calls `armLiveServerReaper()` once at module scope. That does three things:
 *
 *   1. stamps this process's environment with a unique marker, so every server
 *      it starts from then on is identifiable as belonging to this process;
 *   2. installs exit and signal handlers that kill those servers on the ways
 *      out that JavaScript can still observe (assertion failure, thrown hook,
 *      Ctrl-C, `SIGTERM`);
 *   3. spawns a detached reaper holding a pipe to this process, which covers
 *      the way out that JavaScript cannot observe: `SIGKILL`, a runner killed
 *      mid-test, a `node:test` timeout that never reaches the `after()` hook.
 *
 * Servers spawned as direct children are also tracked by handle so the common
 * case is a cheap `child.kill()` rather than a process-table sweep.
 */

import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PROC_ID_ENV,
  REPO_ENV,
  RUN_ID_ENV,
  alive,
  findLiveServers,
  killLiveServers,
  makeRunId,
} from '../../scripts/lib/live-server-processes.mjs';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const REAPER = path.join(REPO_ROOT, 'scripts', 'lib', 'test-orphan-reaper.mjs');

const trackedChildren = new Set();
let procId = null;
let reaper = null;

/**
 * Idempotent. Safe to call from several modules in the same process.
 * @returns {string} the process marker every server started after this inherits.
 */
export function armLiveServerReaper() {
  if (procId) return procId;

  procId = `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  process.env[PROC_ID_ENV] = procId;
  // Standalone `node --test tests/live-server.test.mjs` gets the same coverage
  // as a run through scripts/run-tests.mjs.
  if (!process.env[RUN_ID_ENV]) process.env[RUN_ID_ENV] = makeRunId(REPO_ROOT);
  if (!process.env[REPO_ENV]) process.env[REPO_ENV] = REPO_ROOT;

  if (process.platform !== 'win32' && process.env.IMPECCABLE_NO_TEST_REAPER !== '1') {
    try {
      reaper = spawn(process.execPath, [REAPER, procId], {
        detached: true,
        stdio: ['pipe', 'ignore', 'ignore'],
      });
      reaper.unref();
      reaper.on('error', () => { reaper = null; });
    } catch {
      reaper = null;
    }
  }

  process.on('exit', () => cleanupSync());
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => {
      cleanupSync();
      // The shell convention for "killed by signal N": 130 SIGINT, 143 SIGTERM,
      // 129 SIGHUP.
      process.exit(128 + (os.constants.signals[sig] ?? 0));
    });
  }
  // An uncaught exception still fires 'exit', so no separate handler is owed.
  return procId;
}

/**
 * Register a live server started as a direct child, so it is killed by handle
 * on the way out instead of waiting for a process-table sweep.
 */
export function trackServerChild(child) {
  if (!child || typeof child.kill !== 'function') return child;
  trackedChildren.add(child);
  child.once('exit', () => trackedChildren.delete(child));
  return child;
}

export function untrackServerChild(child) {
  trackedChildren.delete(child);
}

/** Live servers this process started that are still running. */
export function findLeakedLiveServers() {
  if (!procId) return [];
  return findLiveServers({ procId });
}

/**
 * Synchronous best-effort cleanup. Called from `process.on('exit')`, where the
 * event loop is closed, so everything here has to be synchronous.
 */
export function cleanupSync() {
  for (const child of trackedChildren) {
    try { if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL'); } catch { /* gone */ }
  }
  trackedChildren.clear();

  if (procId) {
    try {
      const leaked = findLiveServers({ procId }).filter(({ pid }) => alive(pid));
      if (leaked.length) killLiveServers(leaked, { graceMs: 250 });
    } catch { /* the sweep is a safety net, not a requirement */ }
  }

  if (reaper) {
    try { reaper.stdin?.end(); } catch { /* already closed */ }
    reaper = null;
  }
}
