#!/usr/bin/env node
/**
 * Kills the live servers of one test process once that process is gone.
 *
 * In-process cleanup (an `after()` hook, a `process.on('exit')` handler) cannot
 * run when the process is `SIGKILL`ed, and that is exactly the case that left
 * 197 orphaned servers on a laptop. So the last line of defence lives outside
 * the process: this reaper is spawned detached, holding the write end of a pipe
 * on its stdin. When its parent dies, for any reason at all, the pipe closes,
 * the reaper wakes on EOF, and it kills every live server carrying the parent's
 * process marker.
 *
 * Scope is the marker, never a name or a port: only servers this exact test
 * process started are matched.
 *
 *   node scripts/lib/test-orphan-reaper.mjs <procId> [maxLifetimeMs]
 *
 * Deliberately not named after the thing it kills: its own argv must not look
 * like a live server to the sweep.
 */

import { findLiveServers, killLiveServers } from './live-server-processes.mjs';

const procId = process.argv[2];
const maxLifetimeMs = Number(process.argv[3]) || 6 * 60 * 60 * 1000;

if (!procId) {
  console.error('usage: test-orphan-reaper.mjs <procId> [maxLifetimeMs]');
  process.exit(2);
}

let done = false;

function sweepAndExit(code = 0) {
  if (done) return;
  done = true;
  try {
    const leaked = findLiveServers({ procId });
    if (leaked.length) killLiveServers(leaked);
  } catch { /* nothing useful to report: no one is reading our output */ }
  process.exit(code);
}

// The parent holds the other end of stdin. EOF means the parent is gone.
process.stdin.resume();
process.stdin.on('end', () => sweepAndExit(0));
process.stdin.on('close', () => sweepAndExit(0));
process.stdin.on('error', () => sweepAndExit(0));

// A reaper whose parent somehow outlives the machine's patience still goes away.
setTimeout(() => sweepAndExit(0), maxLifetimeMs).unref();

for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(sig, () => sweepAndExit(0));
}
