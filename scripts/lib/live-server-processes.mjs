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
 *
 * Every marker value is an opaque token: a random run or process id, or a hash
 * of the checkout path. None of them is a path, and none can contain
 * whitespace, which is what keeps the `ps -E` matching below exact.
 */

import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';

/**
 * The three matching markers. Every value is an opaque token from the alphabet
 * below, never a path and never anything a user chose. That is what lets the
 * `ps -E` matcher work on a "starts an entry, ends at whitespace or line end"
 * rule with no ambiguous case left, and it is a load-bearing invariant rather
 * than a formatting preference: a value free to contain a space and a
 * `KEY=`-shaped token could impersonate the end of its own entry, and one
 * checkout's cleanup could then reach a neighbouring checkout's servers.
 */
const MARKER_VALUE_RE = /^[A-Za-z0-9_-]+$/;

/** Env var carrying the id of one suite command. Descendants inherit it. */
export const RUN_ID_ENV = 'IMPECCABLE_TEST_RUN_ID';
/**
 * Env var carrying the id of one test process. `node --test` runs files
 * concurrently and they all inherit the same run id, so a per-process id is
 * what lets one file's reaper kill that file's servers and not its siblings'.
 */
export const PROC_ID_ENV = 'IMPECCABLE_TEST_PROC_ID';
/**
 * Env var carrying a hash of the checkout, so a cleanup can be scoped to it.
 * The value is `repoMarker()`, not the path: two checkouts whose paths share a
 * prefix get unrelated hashes, and no filesystem path can leak into matching.
 */
export const REPO_ENV = 'IMPECCABLE_TEST_REPO';
/**
 * The checkout path in readable form, for a human looking at `ps -E` output or
 * a stuck process. **Never used for matching**, and nothing should start: it is
 * the one marker-adjacent value that can contain whitespace.
 */
export const REPO_PATH_ENV = 'IMPECCABLE_TEST_REPO_PATH';

/**
 * A command line belonging to a live server. Matches the Node script
 * (`.../live-server.mjs`) and the engine verb (`.../impeccable live-server`).
 */
const LIVE_SERVER_RE = /(^|[\s/\\])live-server(\.mjs|\.exe)?(\s|$)/;

/**
 * A stable, opaque id for one checkout: the first 16 hex characters of the
 * sha256 of its real path. Symlinked and `/private`-prefixed spellings of the
 * same directory resolve to the same marker; `/work/impeccable` and
 * `/work/impeccable-copy` do not share a prefix.
 */
export function repoMarker(repoRoot) {
  // path.resolve first so a trailing slash or a `.` segment cannot change the
  // marker for a directory that is not on disk (realpathSync throws for those).
  let resolved = path.resolve(repoRoot);
  try { resolved = realpathSync(resolved); } catch { /* not on disk; hash as normalized */ }
  return createHash('sha256').update(resolved).digest('hex').slice(0, 16);
}

/**
 * An id for one suite command. Random, so two runs of the same suite in the
 * same second never collide, and hex/`-` only so it can never break out of its
 * own environment entry.
 */
export function makeRunId(repoRoot = process.cwd()) {
  return `${repoMarker(repoRoot)}-${randomBytes(8).toString('hex')}`;
}

/** An id for one test process. Same alphabet rule as the run id. */
export function makeProcId() {
  return `p${process.pid}-${randomBytes(8).toString('hex')}`;
}

/**
 * Live servers still running that carry one of the given markers.
 *
 * @param {object} opts
 * Every marker is an environment entry the harness itself exported. There is
 * deliberately no fallback that matches a command line under the checkout: a
 * developer running `impeccable live` in this repo has exactly that command
 * line, and a cleanup must never be able to kill their session.
 *
 * @param {string} [opts.runId]  match `IMPECCABLE_TEST_RUN_ID=<runId>` exactly.
 * @param {string} [opts.procId] match `IMPECCABLE_TEST_PROC_ID=<procId>` exactly.
 * @param {string} [opts.repo]   a checkout path; matched as its `repoMarker()`
 *                               hash, never as the path itself.
 * @returns {{pid:number, command:string}[]}
 */
export function findLiveServers({ runId, procId, repo } = {}) {
  const markers = [];
  if (runId) markers.push(`${RUN_ID_ENV}=${assertMarkerValue(runId)}`);
  if (procId) markers.push(`${PROC_ID_ENV}=${assertMarkerValue(procId)}`);
  if (repo) markers.push(`${REPO_ENV}=${assertMarkerValue(repoMarker(repo))}`);
  if (!markers.length) return [];

  const commands = listCommands();
  if (!commands.size) return [];

  const matched = new Set(pidsWithEnvMarker(markers, commands));

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

/**
 * Whether a `ps -E` line contains `marker` as a complete environment entry.
 *
 * A plain substring test is wrong here: a marker is a substring of any longer
 * value that starts with it, and matching that would let one checkout's cleanup
 * kill a neighbouring checkout's servers. `ps` flattens the environment into
 * whitespace-separated `KEY=VALUE` pairs, so an entry runs to the next
 * whitespace or to the end of the line.
 *
 * That simple rule is sound only because every marker value is drawn from
 * `MARKER_VALUE_RE` and can therefore never contain whitespace: no value can
 * hide the end of its own entry, and there is no ambiguous case. Give a marker
 * a free-form value and this becomes guesswork again, which is why
 * `assertMarkerValue` refuses one.
 */
export function envLineHasEntry(line, marker) {
  for (let from = 0; ; from += 1) {
    const at = line.indexOf(marker, from);
    if (at === -1) return false;
    const startsEntry = at === 0 || /\s/.test(line[at - 1]);
    const end = at + marker.length;
    const endsEntry = end === line.length || /\s/.test(line[end]);
    if (startsEntry && endsEntry) return true;
    from = at;
  }
}

/** Refuse a marker value that could break out of its own environment entry. */
function assertMarkerValue(value) {
  if (!MARKER_VALUE_RE.test(value)) {
    throw new Error(
      `refusing to match on "${value}": a marker value must be [A-Za-z0-9_-] only, ` +
      'so that an environment entry ends where the whitespace after it does. ' +
      'Hash or tokenize the value before passing it (see repoMarker).',
    );
  }
  return value;
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
 * Linux exposes `/proc/<pid>/environ` directly, so entries are compared whole.
 * BSD/macOS `ps -E` appends the environment to the command column instead, so
 * the marker is matched against that combined line through `envLineHasEntry`,
 * which requires the same whole-entry boundary. The command itself is then read
 * back from the marker-free listing, so an env value that happened to contain
 * "live-server" cannot decide the match.
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
    if (markers.some((marker) => envLineHasEntry(m[2], marker))) hits.push(pid);
  }
  return hits;
}
