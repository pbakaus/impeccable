/**
 * The leak guard itself.
 *
 * A live server must not outlive the test process that started it, even when
 * that process is SIGKILLed and no `after()` hook, no `finally`, and no
 * `process.on('exit')` handler ever runs. That is the shape that left 197
 * orphaned servers squatting the live suite's ports (issue: live-server leak).
 *
 * Run with: node --test tests/live-server-leak.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  PROC_ID_ENV,
  RUN_ID_ENV,
  alive,
  findLiveServers,
  killLiveServers,
  makeRunId,
} from '../scripts/lib/live-server-processes.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 8591;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(predicate, { timeoutMs = 10_000, stepMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(stepMs);
  }
  return false;
}

/**
 * A stand-in for a test file: arms the reaper, starts a detached live server
 * exactly as `live-server --background` does, prints its pid, then blocks
 * forever so the caller can decide how it dies.
 */
const VICTIM = `
import { spawn } from 'node:child_process';
import { armLiveServerReaper } from ${JSON.stringify(join(REPO_ROOT, 'tests/lib/live-servers.mjs'))};

armLiveServerReaper();

const child = spawn(process.execPath, [
  ${JSON.stringify(join(REPO_ROOT, 'skill/scripts/live-server.mjs'))},
  '--port=${PORT}',
], { detached: true, stdio: 'ignore', cwd: process.cwd() });
child.unref();

// Wait until it is actually listening before reporting, so the assertion below
// is about a running server rather than a pid that never came up.
const deadline = Date.now() + 15000;
while (Date.now() < deadline) {
  try {
    const res = await fetch('http://127.0.0.1:${PORT}/health');
    if (res.ok || res.status === 401 || res.status === 404) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 50));
}
console.log(JSON.stringify({ serverPid: child.pid }));
setInterval(() => {}, 1000);
`;

function startVictim(cwd) {
  const script = join(cwd, 'victim.mjs');
  writeFileSync(script, VICTIM);
  const proc = spawn(process.execPath, [script], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, [RUN_ID_ENV]: makeRunId(REPO_ROOT), [PROC_ID_ENV]: '' },
  });
  const ready = new Promise((resolve, reject) => {
    let out = '';
    let err = '';
    const timer = setTimeout(
      () => reject(new Error(`victim never reported a server\nstdout: ${out}\nstderr: ${err}`)),
      25_000,
    );
    timer.unref();
    proc.stdout.on('data', (d) => {
      out += d.toString();
      const line = out.split('\n').find((l) => l.trim().startsWith('{'));
      if (line) {
        clearTimeout(timer);
        resolve(JSON.parse(line));
      }
    });
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`victim exited early (code=${code})\n${err}`));
    });
  });
  return { proc, ready };
}

describe('live server leak guard', () => {
  it('kills the live server when the test process is SIGKILLed', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'impeccable-leak-'));
    let victim;
    let serverPid;
    try {
      victim = startVictim(cwd);
      ({ serverPid } = await victim.ready);
      assert.ok(alive(serverPid), 'server should be running before the kill');

      // The case no in-process cleanup can cover.
      victim.proc.kill('SIGKILL');

      const reaped = await waitUntil(() => !alive(serverPid), { timeoutMs: 15_000 });
      assert.equal(reaped, true, `live server pid ${serverPid} outlived the SIGKILLed test process`);
    } finally {
      if (victim?.proc && victim.proc.exitCode == null) victim.proc.kill('SIGKILL');
      if (serverPid && alive(serverPid)) killLiveServers([{ pid: serverPid, command: '' }]);
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('scopes a sweep to the marker, never to the name alone', () => {
    // No marker, no match: a sweep can never take out a live server that some
    // other checkout, or the user's own session, is running.
    assert.deepEqual(findLiveServers({}), []);
    assert.deepEqual(findLiveServers({ runId: 'no-such-run-id-' + Date.now() }), []);
  });
});
