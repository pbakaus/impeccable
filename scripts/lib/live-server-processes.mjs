/**
 * Finding and killing live servers a test run left behind.
 *
 * The harness starts live servers in two shapes and neither one dies with the
 * process that started it:
 *
 *   1. a direct child (`node skill/scripts/live-server.mjs --port=N`, or
 *      `$IMPECCABLE_BIN live-server --port=N` once the engine is Rust), stopped
 *      by an HTTP `/stop` call in an `after()` hook;
 *   2. a detached daemon (`live-server --background`, or a full `live` boot),
 *      which is orphaned to pid 1 by design and stopped by the `stop` verb.
 *
 * Both survive a runner that dies before teardown: a `SIGKILL`, a Ctrl-C, a
 * `node:test` timeout that skips the `after()` hook. This module is the safety
 * net. It identifies servers by an environment marker the runner exports, so a
 * sweep can only ever match a server this repo's test harness started; nothing
 * is matched by port, by name alone, or by "looks like impeccable".
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/** Env var carrying the id of one suite command. Descendants inherit it. */
export const RUN_ID_ENV = 'IMPECCABLE_TEST_RUN_ID';
/**
 * Env var carrying the id of one test process. `node --test` runs files
 * concurrently and they all inherit the same run id, so a per-process id is
 * what lets one file's reaper kill that file's servers and not its siblings'.
 */
export const PROC_ID_ENV = 'IMPECCABLE_TEST_PROC_ID';
/** Env var carrying the repo root, so a cleanup can be scoped to this checkout. */
export const REPO_ENV = 'IMPECCABLE_TEST_REPO';

/**
 * A command line belonging to a live server. Matches the Node script
 * (`.../live-server.mjs`) and the engine verb (`.../impeccable live-server`).
 */
const LIVE_SERVER_RE = /(^|[\s/\\])live-server(\.mjs|\.exe)?(\s|$)/;

export function makeRunId(repoRoot = process.cwd()) {
  const slug = path.basename(repoRoot).replace(/[^A-Za-z0-9_-]/g, '') || 'repo';
  return `${slug}-${Date.now().toString(36)}-${process.pid}`;
}

/**
 * Live servers still running that carry one of the given markers.
 *
 * @param {object} opts
 * @param {string} [opts.runId]  match `IMPECCABLE_TEST_RUN_ID=<runId>` exactly.
 * @param {string} [opts.procId] match `IMPECCABLE_TEST_PROC_ID=<procId>` exactly.
 * @param {string} [opts.repo]   match `IMPECCABLE_TEST_REPO=<repo>` exactly, and
 *                               also any command line naming this repo's own
 *                               `live-server` script (covers servers started
 *                               before the marker existed).
 * @returns {{pid:number, command:string}[]}
 */
export function findLiveServers({ runId, procId, repo } = {}) {
  const markers = [];
  if (runId) markers.push(`${RUN_ID_ENV}=${runId}`);
  if (procId) markers.push(`${PROC_ID_ENV}=${procId}`);
  if (repo) markers.push(`${REPO_ENV}=${repo}`);
  if (!markers.length) return [];

  const commands = listCommands();
  if (!commands.size) return [];

  const matched = new Set();
  for (const pid of pidsWithEnvMarker(markers, commands)) matched.add(pid);
  if (repo) {
    // A server whose argv names this checkout's script is ours regardless of
    // whether it was started with the marker in place.
    const own = path.join(repo, 'skill', 'scripts', 'live-server');
    for (const [pid, command] of commands) {
      if (command.includes(own)) matched.add(pid);
    }
  }

  const out = [];
  for (const pid of matched) {
    if (pid === process.pid) continue;
    const command = commands.get(pid);
    if (!command || !LIVE_SERVER_RE.test(command)) continue;
    out.push({ pid, command });
  }
  return out.sort((a, b) => a.pid - b.pid);
}

/**
 * SIGTERM every process, then SIGKILL whatever is still alive after `graceMs`.
 * Kills the process group too when the process leads one, so a server that
 * spawned helpers does not leave them behind.
 *
 * @returns {number} how many processes were signalled.
 */
export function killLiveServers(procs, { graceMs = 400 } = {}) {
  if (!procs.length) return 0;
  for (const { pid } of procs) signal(pid, 'SIGTERM');
  const deadline = Date.now() + graceMs;
  // Busy-wait: this runs from `process.on('exit')` handlers, where the event
  // loop is already closed and nothing asynchronous can be awaited.
  while (Date.now() < deadline) {
    if (!procs.some(({ pid }) => alive(pid))) return procs.length;
  }
  for (const { pid } of procs) {
    if (alive(pid)) signal(pid, 'SIGKILL');
  }
  return procs.length;
}

export function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function signal(pid, sig) {
  // A process group id is always the pid of its leader, so `-pid` can only ever
  // reach a group this process leads. When it leads none, the call is ESRCH and
  // the plain kill below is what does the work.
  try { process.kill(-pid, sig); } catch { /* not a group leader */ }
  try { process.kill(pid, sig); } catch { /* already gone */ }
}

/** pid -> full command line, for every process this user can see. */
function listCommands() {
  const map = new Map();
  if (process.platform === 'win32') return map; // no supported sweep yet
  const res = spawnSync('ps', ['-A', '-ww', '-o', 'pid=,command='], { encoding: 'utf-8' });
  if (res.status !== 0 || !res.stdout) return map;
  for (const line of res.stdout.split('\n')) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (m) map.set(Number(m[1]), m[2]);
  }
  return map;
}

/**
 * Pids whose environment contains one of `markers`.
 *
 * Linux exposes `/proc/<pid>/environ` directly. BSD/macOS `ps -E` appends the
 * environment to the command column, so the marker is searched in that combined
 * line and the command is then read back from the marker-free listing (an env
 * value that happened to contain "live-server" must not decide the match).
 */
function pidsWithEnvMarker(markers, commands) {
  const hits = [];
  if (process.platform === 'linux') {
    let entries = [];
    try { entries = readdirSync('/proc'); } catch { return hits; }
    for (const entry of entries) {
      if (!/^\d+$/.test(entry)) continue;
      let environ = '';
      try { environ = readFileSync(`/proc/${entry}/environ`, 'utf-8'); } catch { continue; }
      const vars = environ.split('\0');
      if (markers.some((marker) => vars.includes(marker))) hits.push(Number(entry));
    }
    return hits;
  }

  const res = spawnSync('ps', ['-A', '-E', '-ww', '-o', 'pid=,command='], { encoding: 'utf-8' });
  if (res.status !== 0 || !res.stdout) return hits;
  for (const line of res.stdout.split('\n')) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const pid = Number(m[1]);
    if (!commands.has(pid)) continue;
    if (markers.some((marker) => m[2].includes(marker))) hits.push(pid);
  }
  return hits;
}
