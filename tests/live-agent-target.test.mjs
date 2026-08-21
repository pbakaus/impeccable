/**
 * Tests for agent-initiated element targeting (the `generate` command):
 * POST /agent-target held-open pairing with POST /agent-target-result,
 * validation, the no-browser and timeout verdicts, and the live-generate CLI's
 * local failure modes.
 *
 * Run with: node --test tests/live-agent-target.test.mjs
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { getLiveServerPath } from '../skill/scripts/lib/impeccable-paths.mjs';

const REPO_ROOT = process.cwd();
const SERVER_SCRIPT = join(REPO_ROOT, 'skill/scripts/live-server.mjs');
const GENERATE_SCRIPT = join(REPO_ROOT, 'skill/scripts/live-generate.mjs');

function startServer(port, { cwd, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [SERVER_SCRIPT, '--port=' + port], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, IMPECCABLE_LIVE_COPY_AGENT: 'off', ...env },
    });
    let output = '';
    proc.stdout.on('data', (d) => {
      output += d.toString();
      if (output.includes('running on')) {
        try {
          const info = JSON.parse(readFileSync(getLiveServerPath(cwd), 'utf-8'));
          resolve({ proc, port: info.port, token: info.token, cwd });
        } catch {
          reject(new Error('Server started but PID file not readable'));
        }
      }
    });
    proc.stderr.on('data', (d) => { output += d.toString(); });
    proc.on('error', reject);
    setTimeout(() => reject(new Error('Server start timeout. Output: ' + output)), 5000);
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
async function openSseClient(server) {
  const controller = new AbortController();
  const res = await fetch(
    `http://localhost:${server.port}/events?token=${server.token}`,
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

describe('POST /agent-target', () => {
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
        action: 'bolder',
        count: 3,
        prompt: 'warmer',
        dryRun: true,
      });
      const pushed = await sse.next((m) => m.type === 'agent_target');
      assert.equal(pushed.selector, 'section.pricing');
      assert.equal(pushed.text, 'Studio');
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

describe('live-generate CLI --wait-for-browser', () => {
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
      const stdout = execFileSync(process.execPath, [GENERATE_SCRIPT, ...args], {
        cwd,
        encoding: 'utf-8',
      });
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
        process.execPath,
        [GENERATE_SCRIPT, '--selector', 'h1', '--action', 'bolder', '--wait-for-browser', '10000'],
        { cwd: tmp, encoding: 'utf-8' },
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

describe('live-generate CLI local failure modes', () => {
  function runCli(cwd, args) {
    try {
      const stdout = execFileSync(process.execPath, [GENERATE_SCRIPT, ...args], {
        cwd,
        encoding: 'utf-8',
      });
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
      assert.match(json._instructions, /live\.mjs/);
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
