/**
 * Protocol tests for agent-initiated element targeting (the `generate`
 * command), driven against the engine binary: POST /agent-target held-open
 * pairing with POST /agent-target-result, validation, the roll call and its
 * leases, the no-browser and timeout verdicts, and the live-generate verb's
 * local failure modes. Skips cleanly without a binary (tests/lib/engine-bin.mjs).
 *
 * Run with: node --test tests/live-agent-target.test.mjs
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ENGINE_MISSING_MESSAGE, engineEnv, findEngineBinary } from './lib/engine-bin.mjs';

// Resolve the repo from this file, not from cwd: the runner may be invoked
// from tests/ or anywhere else.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE_BIN = findEngineBinary();

// The action vocabulary lives in the engine (crates/live/src/vocabulary.rs);
// read it from the Rust source so the matrix below can never drift from what
// the live server accepts.
function readVisualActions() {
  const rust = readFileSync(join(REPO_ROOT, 'crates/live/src/vocabulary.rs'), 'utf-8');
  const block = rust.match(/pub const VISUAL_ACTIONS: \[&str; (\d+)\] = \[([\s\S]*?)\];/);
  if (!block) throw new Error('VISUAL_ACTIONS not found in crates/live/src/vocabulary.rs');
  return [...block[2].matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
}
const VISUAL_ACTIONS = readVisualActions();

function liveServerPath(cwd) {
  return join(cwd, '.impeccable/live/server.json');
}

/** Run the live-generate verb; the JSON verdict is on stdout on every exit code. */
function runGenerate(cwd, args) {
  return execFileSync(ENGINE_BIN, ['live-generate', ...args], {
    cwd,
    encoding: 'utf-8',
    env: engineEnv(ENGINE_BIN, {}),
  });
}

function startServer(port, { cwd, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ENGINE_BIN, ['live-server', '--port=' + port], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: engineEnv(ENGINE_BIN, { IMPECCABLE_LIVE_COPY_AGENT: 'off', ...env }),
    });
    let output = '';
    proc.stdout.on('data', (d) => { output += d.toString(); });
    proc.stderr.on('data', (d) => { output += d.toString(); });
    proc.on('error', reject);
    // The server writes server.json on listen; poll for it rather than
    // parsing the banner, so a slow first start still resolves.
    const deadline = Date.now() + 10_000;
    const tick = () => {
      try {
        const info = JSON.parse(readFileSync(liveServerPath(cwd), 'utf-8'));
        if (info.port && info.token) {
          resolve({ proc, port: info.port, token: info.token, cwd });
          return;
        }
      } catch { /* not yet */ }
      if (Date.now() > deadline) {
        reject(new Error('Server start timeout. Output: ' + output));
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

async function stopServer(server) {
  try {
    await fetch(`http://localhost:${server.port}/stop?token=${server.token}`);
  } catch { /* already gone */ }
}

function postJson(server, path, body) {
  return fetch(`http://localhost:${server.port}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * A minimal fake overlay: holds the SSE stream open and resolves pushed
 * messages so a test can await the next one matching a predicate.
 */
async function openSseClient(server, { clientId } = {}) {
  const controller = new AbortController();
  const res = await fetch(
    `http://localhost:${server.port}/events?token=${server.token}` + (clientId ? `&clientId=${clientId}` : ''),
    { signal: controller.signal },
  );
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const messages = [];
  const waiters = [];
  let buffer = '';
  (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
          if (!dataLine) continue;
          let msg;
          try { msg = JSON.parse(dataLine.slice(6)); } catch { continue; }
          messages.push(msg);
          for (let i = waiters.length - 1; i >= 0; i -= 1) {
            if (waiters[i].match(msg)) {
              waiters[i].resolve(msg);
              waiters.splice(i, 1);
            }
          }
        }
      }
    } catch { /* stream closed */ }
  })();
  return {
    messages,
    next(match, timeoutMs = 5000) {
      const found = messages.find(match);
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('SSE message timeout')), timeoutMs);
        waiters.push({ match, resolve: (m) => { clearTimeout(timer); resolve(m); } });
      });
    },
    close() { controller.abort(); },
  };
}

describe('POST /agent-target', { skip: ENGINE_BIN ? false : ENGINE_MISSING_MESSAGE }, () => {
  let tmp;
  let server;

  before(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'impeccable-agent-target-'));
    mkdirSync(join(tmp, '.impeccable/live'), { recursive: true });
    writeFileSync(join(tmp, 'index.html'), '<html><body><h1>t</h1></body></html>');
    // A short timeout keeps the browser_timeout case fast; the env override
    // exists exactly for this.
    server = await startServer(8497, {
      cwd: tmp,
      env: { IMPECCABLE_AGENT_TARGET_TIMEOUT_MS: '400' },
    });
  });

  after(async () => {
    await stopServer(server);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('rejects a wrong token with 401', async () => {
    const res = await postJson(server, '/agent-target', {
      token: 'nope', selector: 'h1', action: 'bolder', count: 3,
    });
    assert.equal(res.status, 401);
  });

  it('rejects an invalid action with 400 naming the vocabulary', async () => {
    const res = await postJson(server, '/agent-target', {
      token: server.token, selector: 'h1', action: 'bold', count: 3,
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /invalid action/);
    assert.match(body.error, /bolder/);
  });

  it('rejects an out-of-range count with 400', async () => {
    const res = await postJson(server, '/agent-target', {
      token: server.token, selector: 'h1', action: 'bolder', count: 9,
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /count must be 1-8/);
  });

  it('rejects a missing selector with 400', async () => {
    const res = await postJson(server, '/agent-target', {
      token: server.token, action: 'bolder', count: 3,
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /selector is required/);
  });

  it('answers no_browser_connected when no SSE client is attached', async () => {
    const res = await postJson(server, '/agent-target', {
      token: server.token, selector: 'h1', action: 'bolder', count: 3,
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.error, 'no_browser_connected');
  });

  it('broadcasts agent_target and resolves the held request with the browser result', async () => {
    const sse = await openSseClient(server);
    try {
      await sse.next((m) => m.type === 'connected');
      const held = postJson(server, '/agent-target', {
        token: server.token,
        selector: 'section.pricing',
        text: 'Studio',
        index: 2,
        action: 'bolder',
        count: 3,
        prompt: 'warmer',
        dryRun: true,
      });
      const pushed = await sse.next((m) => m.type === 'agent_target');
      assert.equal(pushed.selector, 'section.pricing');
      assert.equal(pushed.text, 'Studio');
      assert.equal(pushed.index, 2);
      assert.equal(pushed.action, 'bolder');
      assert.equal(pushed.count, 3);
      assert.equal(pushed.prompt, 'warmer');
      assert.equal(pushed.dryRun, true);
      assert.match(pushed.targetId, /^[0-9a-f]{8}$/);

      const resultRes = await postJson(server, '/agent-target-result', {
        token: server.token,
        targetId: pushed.targetId,
        ok: true,
        matchCount: 1,
        sessionId: 'aabbccdd',
        element: { tag: 'section', id: null, classes: ['pricing'], text: 'Three ways' },
      });
      assert.deepEqual(await resultRes.json(), { ok: true, delivered: true });

      const verdict = await (await held).json();
      assert.equal(verdict.ok, true);
      assert.equal(verdict.targetId, pushed.targetId);
      assert.equal(verdict.matchCount, 1);
      assert.equal(verdict.sessionId, 'aabbccdd');
      assert.equal(verdict.element.tag, 'section');
      // The browser's own token must never leak back into the verdict.
      assert.equal('token' in verdict, false);
    } finally {
      sse.close();
      // Give the server's 8s SSE-drop exit timer no chance to fire between
      // tests: reconnecting tests open their own client immediately.
    }
  });

  it('grants an agent-target claim exactly once, so one visible tab owns the request', async () => {
    const sse = await openSseClient(server);
    try {
      await sse.next((m) => m.type === 'connected');
      const held = postJson(server, '/agent-target', {
        token: server.token, selector: 'h1', action: 'bolder', count: 3,
      });
      const pushed = await sse.next((m) => m.type === 'agent_target');
      const first = await (await postJson(server, '/agent-target-claim', {
        token: server.token, targetId: pushed.targetId, clientId: 'tab-a', eligible: true,
      })).json();
      const second = await (await postJson(server, '/agent-target-claim', {
        token: server.token, targetId: pushed.targetId, clientId: 'tab-b', eligible: true,
      })).json();
      const renew = await (await postJson(server, '/agent-target-claim', {
        token: server.token, targetId: pushed.targetId, clientId: 'tab-a', eligible: true,
      })).json();
      assert.deepEqual(first, { ok: true, granted: true, pending: true });
      assert.deepEqual(second, { ok: true, granted: false, pending: true });
      assert.deepEqual(renew, { ok: true, granted: true, pending: true }, 'the holder renews its own lease');
      // Settle the held request so the suite never waits out the timeout.
      await postJson(server, '/agent-target-result', {
        token: server.token, targetId: pushed.targetId, ok: true, matchCount: 1, sessionId: 'aabbccdd',
      });
      await (await held).json();
    } finally {
      sse.close();
    }
  });

  it('reopens the claim after the winner lease lapses, so a surviving tab can rescue', async () => {
    // Own server: the shared one keeps the default 3s claim lease, which its
    // 400ms target timeout would delete long before the lease could lapse.
    const tmp2 = mkdtempSync(join(tmpdir(), 'impeccable-agent-lease-'));
    mkdirSync(join(tmp2, '.impeccable/live'), { recursive: true });
    writeFileSync(join(tmp2, 'index.html'), '<html><body><h1>t</h1></body></html>');
    const leaseServer = await startServer(8495, {
      cwd: tmp2,
      env: { IMPECCABLE_AGENT_TARGET_TIMEOUT_MS: '2000', IMPECCABLE_AGENT_TARGET_CLAIM_LEASE_MS: '250' },
    });
    const sse = await openSseClient(leaseServer);
    try {
      await sse.next((m) => m.type === 'connected');
      const held = postJson(leaseServer, '/agent-target', {
        token: leaseServer.token, selector: 'h1', action: 'bolder', count: 3,
      });
      const pushed = await sse.next((m) => m.type === 'agent_target');
      const win = await (await postJson(leaseServer, '/agent-target-claim', {
        token: leaseServer.token, targetId: pushed.targetId, clientId: 'tab-a', eligible: true,
      })).json();
      const deniedInsideLease = await (await postJson(leaseServer, '/agent-target-claim', {
        token: leaseServer.token, targetId: pushed.targetId, clientId: 'tab-b', eligible: true,
      })).json();
      assert.equal(win.granted, true);
      assert.equal(deniedInsideLease.granted, false);
      await new Promise((r) => setTimeout(r, 350));
      const rescue = await (await postJson(leaseServer, '/agent-target-claim', {
        token: leaseServer.token, targetId: pushed.targetId, clientId: 'tab-b', eligible: true,
      })).json();
      assert.equal(rescue.granted, true, 'a lapsed lease reopens the claim');
      const staleRenew = await (await postJson(leaseServer, '/agent-target-claim', {
        token: leaseServer.token, targetId: pushed.targetId, clientId: 'tab-a', eligible: true,
      })).json();
      assert.equal(staleRenew.granted, false, 'the lapsed holder cannot renew once a rescuer holds the lease');
      await postJson(leaseServer, '/agent-target-result', {
        token: leaseServer.token, targetId: pushed.targetId, ok: true, matchCount: 1, sessionId: 'aabbccdd',
      });
      const verdict = await (await held).json();
      assert.equal(verdict.ok, true);
    } finally {
      sse.close();
      await stopServer(leaseServer);
      rmSync(tmp2, { recursive: true, force: true });
    }
  });

  it('denies a claim for an unknown or already-resolved targetId', async () => {
    const res = await postJson(server, '/agent-target-claim', {
      token: server.token, targetId: 'deadbeef', clientId: 'tab-x', eligible: true,
    });
    assert.deepEqual(await res.json(), { ok: true, granted: false, pending: false }, 'and says the request is gone, which ends a rescue loop');
  });

  it('answers busy as soon as every connected overlay has reported busy', async () => {
    // Roll call: two tabs, both mid-session. Neither claims; each reports
    // ineligible, and the second report completes the roll call, so the
    // held request answers busy well inside the 400ms target timeout.
    const tabA = await openSseClient(server);
    const tabB = await openSseClient(server);
    try {
      await tabA.next((m) => m.type === 'connected');
      await tabB.next((m) => m.type === 'connected');
      const startedAt = Date.now();
      const held = postJson(server, '/agent-target', {
        token: server.token, selector: 'h1', action: 'bolder', count: 3,
      });
      const pushed = await tabA.next((m) => m.type === 'agent_target');
      for (const clientId of ['tab-a', 'tab-b']) {
        const report = await (await postJson(server, '/agent-target-claim', {
          token: server.token, targetId: pushed.targetId, clientId, eligible: false, state: 'CYCLING', reason: 'session_active',
        })).json();
        assert.deepEqual(report, { ok: true, granted: false });
      }
      const verdict = await (await held).json();
      assert.equal(verdict.error, 'busy');
      assert.equal(verdict.state, 'CYCLING');
      assert.equal(verdict.reason, 'session_active');
      assert.ok(Date.now() - startedAt < 350, 'the busy verdict did not wait for the timeout');
    } finally {
      tabA.close();
      tabB.close();
    }
  });

  it('lets an eligible tab serve the request while another tab reports busy', async () => {
    const tabA = await openSseClient(server);
    const tabB = await openSseClient(server);
    try {
      await tabA.next((m) => m.type === 'connected');
      await tabB.next((m) => m.type === 'connected');
      const held = postJson(server, '/agent-target', {
        token: server.token, selector: 'h1', action: 'bolder', count: 3,
      });
      const pushed = await tabA.next((m) => m.type === 'agent_target');
      await postJson(server, '/agent-target-claim', {
        token: server.token, targetId: pushed.targetId, clientId: 'tab-a', eligible: false, state: 'CYCLING', reason: 'session_active',
      });
      const claim = await (await postJson(server, '/agent-target-claim', {
        token: server.token, targetId: pushed.targetId, clientId: 'tab-b', eligible: true,
      })).json();
      assert.deepEqual(claim, { ok: true, granted: true, pending: true }, 'one busy report does not close a roll call with an idle tab left');
      await postJson(server, '/agent-target-result', {
        token: server.token, targetId: pushed.targetId, ok: true, matchCount: 1, sessionId: 'aabbccdd',
      });
      const verdict = await (await held).json();
      assert.equal(verdict.ok, true);
      assert.equal(verdict.sessionId, 'aabbccdd');
    } finally {
      tabA.close();
      tabB.close();
    }
  });

  it('completes the roll call when the holder itself turns busy', async () => {
    // The holder claimed, then went busy before acting. Its busy report must
    // hand the lease back, so the other tab's report completes the roll call
    // and the CLI gets busy now, not at the 15s timeout.
    const tabA = await openSseClient(server);
    const tabB = await openSseClient(server);
    try {
      await tabA.next((m) => m.type === 'connected');
      await tabB.next((m) => m.type === 'connected');
      const startedAt = Date.now();
      const held = postJson(server, '/agent-target', {
        token: server.token, selector: 'h1', action: 'bolder', count: 3,
      });
      const pushed = await tabA.next((m) => m.type === 'agent_target');
      const claim = await (await postJson(server, '/agent-target-claim', {
        token: server.token, targetId: pushed.targetId, clientId: 'tab-a', eligible: true,
      })).json();
      assert.deepEqual(claim, { ok: true, granted: true, pending: true });
      await postJson(server, '/agent-target-claim', {
        token: server.token, targetId: pushed.targetId, clientId: 'tab-a', eligible: false, state: 'GENERATING', reason: 'session_active',
      });
      await postJson(server, '/agent-target-claim', {
        token: server.token, targetId: pushed.targetId, clientId: 'tab-b', eligible: false, state: 'CYCLING', reason: 'session_active',
      });
      const verdict = await (await held).json();
      assert.equal(verdict.error, 'busy');
      assert.ok(Date.now() - startedAt < 350, 'the holder handing the lease back let the roll call complete');
    } finally {
      tabA.close();
      tabB.close();
    }
  });

  it('withdraws a stale busy report once that tab claims as eligible', async () => {
    // Tab A reported busy, then freed up and claimed as eligible before tab B
    // reported. B's late busy report must not resolve the request as busy on
    // A's stale word; A holds the lease and serves it.
    const tabA = await openSseClient(server);
    const tabB = await openSseClient(server);
    try {
      await tabA.next((m) => m.type === 'connected');
      await tabB.next((m) => m.type === 'connected');
      const held = postJson(server, '/agent-target', {
        token: server.token, selector: 'h1', action: 'bolder', count: 3,
      });
      const pushed = await tabA.next((m) => m.type === 'agent_target');
      await postJson(server, '/agent-target-claim', {
        token: server.token, targetId: pushed.targetId, clientId: 'tab-a', eligible: false, state: 'CYCLING', reason: 'session_active',
      });
      const reclaim = await (await postJson(server, '/agent-target-claim', {
        token: server.token, targetId: pushed.targetId, clientId: 'tab-a', eligible: true,
      })).json();
      assert.deepEqual(reclaim, { ok: true, granted: true, pending: true }, 'the freed tab takes the lease');
      await postJson(server, '/agent-target-claim', {
        token: server.token, targetId: pushed.targetId, clientId: 'tab-b', eligible: false, state: 'CYCLING', reason: 'session_active',
      });
      // Still pending: the stale report was withdrawn, so B's report alone
      // does not complete the roll call. A's result resolves it.
      const resultRes = await postJson(server, '/agent-target-result', {
        token: server.token, targetId: pushed.targetId, ok: true, matchCount: 1, sessionId: 'aabbccdd',
      });
      assert.deepEqual(await resultRes.json(), { ok: true, delivered: true });
      const verdict = await (await held).json();
      assert.equal(verdict.ok, true);
      assert.equal(verdict.sessionId, 'aabbccdd');
    } finally {
      tabA.close();
      tabB.close();
    }
  });

  it('tells a denied claimant whether the request is still pending, so rescue retries stop once it is gone', async () => {
    // The holder claims and never posts a result. The loser's denied claim
    // says the request is still pending, so it keeps retrying; once the
    // request times out, the answer says it is gone and the retry loop ends.
    const tab = await openSseClient(server);
    try {
      await tab.next((m) => m.type === 'connected');
      const held = postJson(server, '/agent-target', {
        token: server.token, selector: 'h1', action: 'bolder', count: 3,
      });
      const pushed = await tab.next((m) => m.type === 'agent_target');
      const holder = await (await postJson(server, '/agent-target-claim', {
        token: server.token, targetId: pushed.targetId, clientId: 'tab-a', eligible: true,
      })).json();
      assert.deepEqual(holder, { ok: true, granted: true, pending: true });
      const denied = await (await postJson(server, '/agent-target-claim', {
        token: server.token, targetId: pushed.targetId, clientId: 'tab-b', eligible: true,
      })).json();
      assert.deepEqual(denied, { ok: true, granted: false, pending: true }, 'a live request keeps the loser retrying');
      const verdict = await (await held).json();
      assert.equal(verdict.error, 'browser_timeout');
      const late = await (await postJson(server, '/agent-target-claim', {
        token: server.token, targetId: pushed.targetId, clientId: 'tab-b', eligible: true,
      })).json();
      assert.deepEqual(late, { ok: true, granted: false, pending: false }, 'a resolved request ends the retry loop');
    } finally {
      tab.close();
    }
  });

  it('replays a pending target to an overlay that connects after the broadcast', async () => {
    // Tab A hears the broadcast and stays silent. Tab B connects afterwards
    // (a reload mid-request): it must receive the same target, so it can
    // claim and serve instead of only widening the roll call's count.
    const tabA = await openSseClient(server, { clientId: 'tab-a' });
    let tabB = null;
    try {
      await tabA.next((m) => m.type === 'connected');
      const held = postJson(server, '/agent-target', {
        token: server.token, selector: 'h1', action: 'bolder', count: 3,
      });
      const pushed = await tabA.next((m) => m.type === 'agent_target');
      tabB = await openSseClient(server, { clientId: 'tab-b' });
      const replayed = await tabB.next((m) => m.type === 'agent_target');
      assert.equal(replayed.targetId, pushed.targetId, 'the late overlay is told about the pending target');
      assert.equal(replayed.selector, 'h1');
      const claim = await (await postJson(server, '/agent-target-claim', {
        token: server.token, targetId: pushed.targetId, clientId: 'tab-b', eligible: true,
      })).json();
      assert.deepEqual(claim, { ok: true, granted: true, pending: true });
      await postJson(server, '/agent-target-result', {
        token: server.token, targetId: pushed.targetId, ok: true, matchCount: 1, sessionId: 'aabbccdd',
      });
      const verdict = await (await held).json();
      assert.equal(verdict.ok, true);
      assert.equal(verdict.sessionId, 'aabbccdd');
    } finally {
      tabA.close();
      if (tabB) tabB.close();
    }
  });

  it('hands a disconnected holder\'s lease back at once', async () => {
    // Tab A claims and then disconnects (reload, closed tab). Its lease must
    // not have to lapse: tab B's next claim is granted right away.
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const tabA = await openSseClient(server, { clientId: 'tab-a' });
    const tabB = await openSseClient(server, { clientId: 'tab-b' });
    try {
      await tabA.next((m) => m.type === 'connected');
      await tabB.next((m) => m.type === 'connected');
      const held = postJson(server, '/agent-target', {
        token: server.token, selector: 'h1', action: 'bolder', count: 3,
      });
      const pushed = await tabB.next((m) => m.type === 'agent_target');
      const holder = await (await postJson(server, '/agent-target-claim', {
        token: server.token, targetId: pushed.targetId, clientId: 'tab-a', eligible: true,
      })).json();
      assert.equal(holder.granted, true);
      tabA.close();
      let claim = { granted: false };
      for (let i = 0; i < 20 && !claim.granted; i += 1) {
        await sleep(15);
        claim = await (await postJson(server, '/agent-target-claim', {
          token: server.token, targetId: pushed.targetId, clientId: 'tab-b', eligible: true,
        })).json();
      }
      assert.equal(claim.granted, true, 'the disconnect released the lease well inside the 3s lease and the 400ms timeout');
      await postJson(server, '/agent-target-result', {
        token: server.token, targetId: pushed.targetId, ok: true, matchCount: 1, sessionId: 'aabbccdd',
      });
      const verdict = await (await held).json();
      assert.equal(verdict.ok, true);
    } finally {
      tabA.close();
      tabB.close();
    }
  });

  it('retires a disconnected overlay\'s busy report instead of answering busy on its stale word', async () => {
    // Tab A reports busy and leaves; tab B stays silent. The timeout must
    // answer browser_timeout: the only busy word came from a tab that is gone.
    const tabA = await openSseClient(server, { clientId: 'tab-a' });
    const tabB = await openSseClient(server, { clientId: 'tab-b' });
    try {
      await tabA.next((m) => m.type === 'connected');
      await tabB.next((m) => m.type === 'connected');
      const held = postJson(server, '/agent-target', {
        token: server.token, selector: 'h1', action: 'bolder', count: 3,
      });
      const pushed = await tabB.next((m) => m.type === 'agent_target');
      await postJson(server, '/agent-target-claim', {
        token: server.token, targetId: pushed.targetId, clientId: 'tab-a', eligible: false, state: 'CYCLING', reason: 'session_active',
      });
      tabA.close();
      const verdict = await (await held).json();
      assert.equal(verdict.error, 'browser_timeout');
    } finally {
      tabA.close();
      tabB.close();
    }
  });

  it('keeps a reconnected overlay\'s lease and word when its old connection closes', async () => {
    // An EventSource reconnect opens a replacement connection under the same
    // page-level clientId before the old one is seen to close. The close
    // must retire nothing while the overlay is still connected.
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const tabA = await openSseClient(server, { clientId: 'tab-a' });
    const tabB = await openSseClient(server, { clientId: 'tab-b' });
    let tabA2 = null;
    try {
      await tabA.next((m) => m.type === 'connected');
      await tabB.next((m) => m.type === 'connected');
      const held = postJson(server, '/agent-target', {
        token: server.token, selector: 'h1', action: 'bolder', count: 3,
      });
      const pushed = await tabA.next((m) => m.type === 'agent_target');
      const holder = await (await postJson(server, '/agent-target-claim', {
        token: server.token, targetId: pushed.targetId, clientId: 'tab-a', eligible: true,
      })).json();
      assert.equal(holder.granted, true);
      tabA2 = await openSseClient(server, { clientId: 'tab-a' });
      await tabA2.next((m) => m.type === 'agent_target');
      tabA.close();
      await sleep(150);
      const rival = await (await postJson(server, '/agent-target-claim', {
        token: server.token, targetId: pushed.targetId, clientId: 'tab-b', eligible: true,
      })).json();
      assert.equal(rival.granted, false, 'the lease survived the reconnect');
      const renew = await (await postJson(server, '/agent-target-claim', {
        token: server.token, targetId: pushed.targetId, clientId: 'tab-a', eligible: true,
      })).json();
      assert.equal(renew.granted, true, 'the reconnected overlay still holds it');
      await postJson(server, '/agent-target-result', {
        token: server.token, targetId: pushed.targetId, ok: true, matchCount: 1, sessionId: 'aabbccdd',
      });
      const verdict = await (await held).json();
      assert.equal(verdict.sessionId, 'aabbccdd');
    } finally {
      tabA.close();
      tabB.close();
      if (tabA2) tabA2.close();
    }
  });

  it('completes the roll call when the last silent overlay disconnects', async () => {
    // Tab A reported busy; tab B never answered and then left. Every overlay
    // still connected has declined, so the verdict is busy now, not at the
    // timeout.
    const tabA = await openSseClient(server, { clientId: 'tab-a' });
    const tabB = await openSseClient(server, { clientId: 'tab-b' });
    try {
      await tabA.next((m) => m.type === 'connected');
      await tabB.next((m) => m.type === 'connected');
      const startedAt = Date.now();
      const held = postJson(server, '/agent-target', {
        token: server.token, selector: 'h1', action: 'bolder', count: 3,
      });
      const pushed = await tabA.next((m) => m.type === 'agent_target');
      await postJson(server, '/agent-target-claim', {
        token: server.token, targetId: pushed.targetId, clientId: 'tab-a', eligible: false, state: 'CYCLING', reason: 'session_active',
      });
      tabB.close();
      const verdict = await (await held).json();
      assert.equal(verdict.error, 'busy');
      assert.equal(verdict.reason, 'session_active');
      assert.ok(Date.now() - startedAt < 350, 'the disconnect completed the roll call before the timeout');
    } finally {
      tabA.close();
      tabB.close();
    }
  });

  it('carries every action in the live vocabulary from the CLI through the push', async () => {
    // The generate command promises the whole action picker, Freeform through
    // Overdrive. Drive each value through the CLI and the server, and read it
    // back off the broadcast the overlay would act on.
    const sse = await openSseClient(server);
    try {
      await sse.next((m) => m.type === 'connected');
      for (const action of VISUAL_ACTIONS) {
        const cli = new Promise((resolve) => {
          execFile(
            ENGINE_BIN,
            ['live-generate', '--selector', 'h1', '--action', action, '--dry-run'],
            { cwd: tmp, encoding: 'utf-8', env: engineEnv(ENGINE_BIN, {}) },
            (err, stdout) => resolve({ code: err ? err.code : 0, stdout }),
          );
        });
        const pushed = await sse.next(
          (m) => m.type === 'agent_target' && m.action === action && m.dryRun === true,
          10_000,
        );
        await postJson(server, '/agent-target-result', {
          token: server.token,
          targetId: pushed.targetId,
          ok: true,
          dryRun: true,
          matchCount: 1,
          element: { tag: 'h1', id: null, classes: [], text: 't' },
        });
        const { code, stdout } = await cli;
        const verdict = JSON.parse(stdout);
        assert.equal(code, 0, `${action}: the CLI exits 0`);
        assert.equal(verdict.ok, true, `${action}: the verdict is ok`);
      }
    } finally {
      sse.close();
    }
  });

  it('times out into browser_timeout when the overlay never answers, and a late result reports delivered:false', async () => {
    const sse = await openSseClient(server);
    try {
      await sse.next((m) => m.type === 'connected');
      const held = postJson(server, '/agent-target', {
        token: server.token, selector: 'h1', action: 'quieter', count: 2,
      });
      const pushed = await sse.next((m) => m.type === 'agent_target');
      const verdict = await (await held).json();
      assert.equal(verdict.ok, false);
      assert.equal(verdict.error, 'browser_timeout');
      assert.equal(verdict.timeoutMs, 400);

      const late = await postJson(server, '/agent-target-result', {
        token: server.token, targetId: pushed.targetId, ok: true,
      });
      assert.deepEqual(await late.json(), { ok: true, delivered: false });
    } finally {
      sse.close();
    }
  });

  it('rejects an agent-target result without a targetId', async () => {
    const res = await postJson(server, '/agent-target-result', {
      token: server.token, ok: true,
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /missing targetId/);
  });
});

describe('live-generate CLI --wait-for-browser', { skip: ENGINE_BIN ? false : ENGINE_MISSING_MESSAGE }, () => {
  let tmp;
  let server;

  before(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'impeccable-generate-wait-'));
    mkdirSync(join(tmp, '.impeccable/live'), { recursive: true });
    writeFileSync(join(tmp, 'index.html'), '<html><body><h1>t</h1></body></html>');
    server = await startServer(8496, {
      cwd: tmp,
      env: { IMPECCABLE_AGENT_TARGET_TIMEOUT_MS: '400' },
    });
  });

  after(async () => {
    await stopServer(server);
    rmSync(tmp, { recursive: true, force: true });
  });

  function runCli(cwd, args) {
    try {
      const stdout = runGenerate(cwd, args);
      return { code: 0, json: JSON.parse(stdout) };
    } catch (err) {
      return { code: err.status, json: JSON.parse(err.stdout) };
    }
  }

  it('rejects a malformed wait budget locally', () => {
    const { code, json } = runCli(tmp, ['--selector', 'h1', '--wait-for-browser', 'soon']);
    assert.equal(code, 1);
    assert.equal(json.error, 'invalid_wait');
  });

  it('gives up with no_browser_connected after the wait budget with no page attached', () => {
    const startedAt = Date.now();
    const { code, json } = runCli(tmp, ['--selector', 'h1', '--action', 'bolder', '--wait-for-browser', '1500']);
    assert.equal(code, 1);
    assert.equal(json.error, 'no_browser_connected');
    assert.equal(json.waitedMs, 1500);
    assert.ok(Date.now() - startedAt >= 1400, 'the CLI actually waited out the budget');
  });

  it('proceeds to target as soon as a page connects during the wait', async () => {
    // Connect the fake overlay 1.2s into the CLI's wait window. The CLI must
    // then send the target; the silent overlay lets it resolve as
    // browser_timeout, which proves the wait detected the connection and the
    // request went out (no_browser_connected would mean it never did). The
    // child runs async: execFileSync would block this process's event loop
    // and the delayed connect would never happen.
    const child = new Promise((resolve) => {
      execFile(
        ENGINE_BIN,
        ['live-generate', '--selector', 'h1', '--action', 'bolder', '--wait-for-browser', '10000'],
        { cwd: tmp, encoding: 'utf-8', env: engineEnv(ENGINE_BIN, {}) },
        (err, stdout) => resolve({ code: err ? err.code : 0, stdout }),
      );
    });
    await new Promise((r) => setTimeout(r, 1200));
    const sse = await openSseClient(server);
    const res = await child;
    sse.close();
    assert.equal(res.code, 1);
    const json = JSON.parse(res.stdout);
    assert.equal(json.error, 'browser_timeout');
  });
});

describe('live-generate CLI local failure modes', { skip: ENGINE_BIN ? false : ENGINE_MISSING_MESSAGE }, () => {
  function runCli(cwd, args) {
    try {
      const stdout = runGenerate(cwd, args);
      return { code: 0, json: JSON.parse(stdout) };
    } catch (err) {
      return { code: err.status, json: JSON.parse(err.stdout) };
    }
  }

  it('fails with server_not_running when no live server is recorded', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'impeccable-generate-cli-'));
    try {
      const { code, json } = runCli(tmp, ['--selector', 'h1', '--action', 'bolder']);
      assert.equal(code, 1);
      assert.equal(json.error, 'server_not_running');
      assert.match(json._instructions, / live\)/, 'names the boot verb');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('fails with invalid_action locally, listing the vocabulary and the mapping hint', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'impeccable-generate-cli-'));
    try {
      const { code, json } = runCli(tmp, ['--selector', 'h1', '--action', 'bold']);
      assert.equal(code, 1);
      assert.equal(json.error, 'invalid_action');
      assert.ok(json.validActions.includes('bolder'));
      assert.match(json._instructions, /bold -> bolder/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('fails with selector_required when --selector is missing', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'impeccable-generate-cli-'));
    try {
      const { code, json } = runCli(tmp, ['--action', 'bolder']);
      assert.equal(code, 1);
      assert.equal(json.error, 'selector_required');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('fails with invalid_count on a non-integer count', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'impeccable-generate-cli-'));
    try {
      const { code, json } = runCli(tmp, ['--selector', 'h1', '--count', 'many']);
      assert.equal(code, 1);
      assert.equal(json.error, 'invalid_count');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
