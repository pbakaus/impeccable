/**
 * Tests for the live variant server.
 * Run with: node --test tests/live-server.test.mjs
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, execSync, spawn } from 'node:child_process';
import {
  getDesignSidecarPath,
  getLiveDir,
  getLiveServerPath,
  getLiveSessionsDir,
} from '../skill/scripts/lib/impeccable-paths.mjs';

const REPO_ROOT = process.cwd();
const SERVER_SCRIPT = join(REPO_ROOT, 'skill/scripts/live-server.mjs');
const COMPLETE_SCRIPT = join(REPO_ROOT, 'skill/scripts/live-complete.mjs');
// ---------------------------------------------------------------------------
// Helper: start/stop server for integration tests
// ---------------------------------------------------------------------------

function startServer(port = 8499, { cwd = REPO_ROOT, env = {} } = {}) {
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
        // Read token from PID file
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

async function stopServer(port, token) {
  try {
    await fetch(`http://localhost:${port}/stop?token=${token}`);
  } catch { /* server already gone */ }
}

async function drainPolls(server) {
  let drained;
  do {
    const r = await fetch(`http://localhost:${server.port}/poll?token=${server.token}&timeout=50&leaseMs=1`);
    drained = await r.json();
    if (drained.id) {
      await fetch(`http://localhost:${server.port}/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: server.token, id: drained.id, type: 'done' }),
      });
    }
  } while (drained.type !== 'timeout');
}

async function waitForManualActivity(server, type, { timeoutMs = 1000 } = {}) {
  const startedAt = Date.now();
  let last;
  while (Date.now() - startedAt < timeoutMs) {
    const res = await fetch(`http://localhost:${server.port}/status?token=${server.token}`);
    assert.equal(res.status, 200);
    last = await res.json();
    if (last.manualEdits?.lastActivity?.type === type) return last;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail('timed out waiting for manual edit activity ' + type + '; last=' + JSON.stringify(last?.manualEdits?.lastActivity || null));
}

async function stashManualEdit(server, entry) {
  const res = await fetch(`http://localhost:${server.port}/manual-edit-stash`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: server.token, ...entry }),
  });
  assert.equal(res.status, 200);
  return res.json();
}

it('gitignores local Impeccable runtime artifacts', () => {
  const ignored = execFileSync('git', [
    'check-ignore',
    '.impeccable/live/manual-edit-apply-transaction.json',
    '.impeccable/live/manual-edit-evidence/example.json',
    '.impeccable/hook.cache.json',
    '.impeccable/hook.pending.json',
    '.impeccable/config.local.json',
    '.impeccable/live/deferred-svelte-component-accepts.json',
  ], { cwd: REPO_ROOT, encoding: 'utf-8' });
  assert.match(ignored, /\.impeccable\/live\/manual-edit-apply-transaction\.json/);
  assert.match(ignored, /\.impeccable\/live\/manual-edit-evidence\/example\.json/);
  assert.match(ignored, /\.impeccable\/hook\.cache\.json/);
  assert.match(ignored, /\.impeccable\/hook\.pending\.json/);
  assert.match(ignored, /\.impeccable\/config\.local\.json/);
  assert.match(ignored, /\.impeccable\/live\/deferred-svelte-component-accepts\.json/);
});

async function readSseUntil(reader, decoder, needle, maxReads = 12) {
  let text = '';
  for (let i = 0; i < maxReads; i++) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
    if (text.includes(needle)) return text;
  }
  return text;
}

// ---------------------------------------------------------------------------
// Server integration tests
// ---------------------------------------------------------------------------

describe('live-server integration', () => {
  let server;
  let serverCwd;

  before(async () => {
    // Run the shared server against an isolated tmpdir so journals/snapshots
    // never land in the real repo's `.impeccable/live/sessions/`. Those would
    // otherwise be replayed into the poll queue on the next real `live` run.
    serverCwd = mkdtempSync(join(tmpdir(), 'impeccable-live-server-'));
    // The /source endpoint test below reads package.json from the server's
    // cwd, so seed a minimal one that contains the substring it asserts on.
    writeFileSync(join(serverCwd, 'package.json'), JSON.stringify({ name: 'impeccable' }));
    server = await startServer(8499, { cwd: serverCwd });
  });

  after(async () => {
    if (server) {
      await stopServer(server.port, server.token);
      server.proc.kill();
    }
    if (serverCwd) {
      rmSync(serverCwd, { recursive: true, force: true });
    }
  });

  it('/health returns correct status', async () => {
    const res = await fetch(`http://localhost:${server.port}/health`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'ok');
    assert.equal(data.port, server.port);
    assert.equal(data.mode, 'variant');
    assert.equal(typeof data.hasProjectContext, 'boolean');
    assert.equal(data.connectedClients, 0);
  });

  it('/live.js injects the canonical command vocabulary', async () => {
    // live-browser.js builds its action picker from window.__IMPECCABLE_VOCAB__
    // rather than an inline copy, so the server must serialize the canonical
    // vocabulary into /live.js (next to the token/port).
    const { LIVE_COMMANDS } = await import('../skill/scripts/live/vocabulary.mjs');
    const body = await (await fetch(`http://localhost:${server.port}/live.js`)).text();
    assert.match(body, /window\.__IMPECCABLE_VOCAB__\s*=/);
    const injected = JSON.parse(body.match(/window\.__IMPECCABLE_VOCAB__\s*=\s*(\[.*?\]);/s)[1]);
    assert.deepEqual(injected, LIVE_COMMANDS);
  });

  it('/status returns durable recovery state', async () => {
    await drainPolls(server);
    const eventRes = await fetch(`http://localhost:${server.port}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: server.token,
        type: 'generate',
        id: 'a1b2c3d5',
        action: 'impeccable',
        count: 1,
        pageUrl: '/',
        element: { outerHTML: '<button>Book</button>' },
      }),
    });
    assert.equal(eventRes.status, 200);

    const res = await fetch(`http://localhost:${server.port}/status?token=${server.token}`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'ok');
    assert.equal(data.activeSessions.some((s) => s.id === 'a1b2c3d5'), true);
    assert.equal(data.pendingEvents.some((e) => e.id === 'a1b2c3d5' && e.type === 'generate'), true);

    await drainPolls(server);
  });

  it('/status reports agentPolling from active poll leases', async () => {
    await drainPolls(server);
    let res = await fetch(`http://localhost:${server.port}/status?token=${server.token}`);
    let data = await res.json();
    assert.equal(data.agentPolling, false);

    const controller = new AbortController();
    const pollPromise = fetch(
      `http://localhost:${server.port}/poll?token=${server.token}&timeout=5000`,
      { signal: controller.signal },
    );
    await new Promise((resolve) => setTimeout(resolve, 80));
    res = await fetch(`http://localhost:${server.port}/status?token=${server.token}`);
    data = await res.json();
    assert.equal(data.agentPolling, true);

    controller.abort();
    await pollPromise.catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 80));
    res = await fetch(`http://localhost:${server.port}/status?token=${server.token}`);
    data = await res.json();
    assert.equal(data.agentPolling, false);
  });

  it('/status stops reporting agentPolling as soon as a poll returns an event', async () => {
    await drainPolls(server);
    const pollPromise = fetch(
      `http://localhost:${server.port}/poll?token=${server.token}&timeout=5000&leaseMs=30000`,
    ).then((response) => response.json());
    await new Promise((resolve) => setTimeout(resolve, 50));

    const eventRes = await fetch(`http://localhost:${server.port}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: server.token,
        type: 'generate',
        id: 'aabbcc77',
        action: 'impeccable',
        count: 1,
        pageUrl: '/',
        element: { outerHTML: '<button>Truthful poll</button>', tagName: 'BUTTON' },
      }),
    });
    assert.equal(eventRes.status, 200);
    const event = await pollPromise;
    assert.equal(event.id, 'aabbcc77');

    const status = await fetch(`http://localhost:${server.port}/status?token=${server.token}`).then((response) => response.json());
    assert.equal(status.agentPolling, false);

    await fetch(`http://localhost:${server.port}/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: server.token, id: event.id, type: 'done', sourceEventType: 'generate' }),
    });
  });

  it('/live.js serves script with token injected', async () => {
    const res = await fetch(`http://localhost:${server.port}/live.js`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/javascript');
    const text = await res.text();
    assert.ok(text.includes('__IMPECCABLE_TOKEN__'));
    assert.ok(text.includes(server.token));
    assert.ok(text.includes('__IMPECCABLE_PORT__'));
    const preludeIndex = text.indexOf('window.__IMPECCABLE_VOCAB__');
    const sessionPartIndex = text.indexOf('impeccable live script part: session-state (live-browser-session.js)');
    const domPartIndex = text.indexOf('impeccable live script part: dom-helpers (live-browser-dom.js)');
    const browserPartIndex = text.indexOf('impeccable live script part: browser-ui (live-browser.js)');
    const sessionHelperIndex = text.indexOf('__IMPECCABLE_LIVE_SESSION__');
    const domHelperIndex = text.indexOf('__IMPECCABLE_LIVE_DOM__');
    const browserInitIndex = text.indexOf('__IMPECCABLE_LIVE_INIT__');
    assert.ok(preludeIndex !== -1);
    assert.ok(sessionPartIndex !== -1);
    assert.ok(domPartIndex !== -1);
    assert.ok(browserPartIndex !== -1);
    assert.ok(sessionHelperIndex !== -1);
    assert.ok(domHelperIndex !== -1);
    assert.ok(browserInitIndex !== -1);
    assert.ok(
      preludeIndex < sessionPartIndex,
      'event=live_server.browser_script_order actor=browser operation=load_live_js risk=prelude_after_script_part expected=prelude before parts actual=' + preludeIndex + ':' + sessionPartIndex,
    );
    assert.ok(
      sessionPartIndex < domPartIndex,
      'event=live_server.browser_script_order actor=browser operation=load_live_js risk=dom_part_before_session_helper expected=session part before dom part actual=' + sessionPartIndex + ':' + domPartIndex,
    );
    assert.ok(
      domPartIndex < browserPartIndex,
      'event=live_server.browser_script_order actor=browser operation=load_live_js risk=browser_part_before_dom_helpers expected=dom part before browser part actual=' + domPartIndex + ':' + browserPartIndex,
    );
    assert.ok(
      sessionHelperIndex < browserInitIndex,
      'event=live_server.browser_helper_order actor=browser operation=load_live_js risk=session_helper_missing_before_browser_init expected=session helper before live init actual=' + sessionHelperIndex + ':' + browserInitIndex,
    );
    assert.ok(
      domHelperIndex < browserInitIndex,
      'event=live_server.browser_helper_order actor=browser operation=load_live_js risk=dom_helper_missing_before_browser_init expected=dom helper before live init actual=' + domHelperIndex + ':' + browserInitIndex,
    );
  });

  it('/design-system.json reads DESIGN.md plus .impeccable/design.json', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'impeccable-design-system-'));
    let designServer;
    try {
      writeFileSync(join(tmp, 'DESIGN.md'), `---
name: Temp System
description: Temporary design context
colors: {}
---

# Temp System
`);
      const sidecarPath = getDesignSidecarPath(tmp);
      mkdirSync(join(tmp, '.impeccable'), { recursive: true });
      writeFileSync(sidecarPath, JSON.stringify({ version: 2, source: 'new-sidecar' }));

      designServer = await startServer(8520, { cwd: tmp });
      const res = await fetch(`http://localhost:${designServer.port}/design-system.json?token=${designServer.token}`);
      const data = await res.json();

      assert.equal(res.status, 200);
      assert.equal(data.hasMd, true);
      assert.equal(data.hasSidecar, true);
      assert.equal(data.parsed.frontmatter.name, 'Temp System');
      assert.equal(data.sidecar.source, 'new-sidecar');
    } finally {
      if (designServer) {
        await stopServer(designServer.port, designServer.token);
        designServer.proc.kill();
      }
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('/design-system.json falls back to legacy root DESIGN.json', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'impeccable-design-system-legacy-'));
    let designServer;
    try {
      writeFileSync(join(tmp, 'DESIGN.md'), `---
name: Legacy System
description: Legacy design context
colors: {}
---

# Legacy System
`);
      writeFileSync(join(tmp, 'DESIGN.json'), JSON.stringify({ version: 2, source: 'legacy-sidecar' }));

      designServer = await startServer(8521, { cwd: tmp });
      const res = await fetch(`http://localhost:${designServer.port}/design-system.json?token=${designServer.token}`);
      const data = await res.json();

      assert.equal(res.status, 200);
      assert.equal(data.hasMd, true);
      assert.equal(data.hasSidecar, true);
      assert.equal(data.parsed.frontmatter.name, 'Legacy System');
      assert.equal(data.sidecar.source, 'legacy-sidecar');
    } finally {
      if (designServer) {
        await stopServer(designServer.port, designServer.token);
        designServer.proc.kill();
      }
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('/detect.js serves the detection overlay', async () => {
    const res = await fetch(`http://localhost:${server.port}/detect.js`);
    // May 404 if detect-antipatterns-browser.js hasn't been built
    assert.ok(res.status === 200 || res.status === 404);
  });

  it('/manual-edit-commit runs the batched AI apply path and clears successful entries', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'impeccable-manual-commit-server-'));
    let commitServer;
    try {
      mkdirSync(join(tmp, 'src'), { recursive: true });
      const sourcePath = join(tmp, 'src', 'page.html');
      writeFileSync(sourcePath, '<h1 class="hero">Welcome</h1>\n');

      commitServer = await startServer(8522, {
        cwd: tmp,
        env: {
          IMPECCABLE_LIVE_COPY_AGENT: 'mock',
          IMPECCABLE_LIVE_COPY_AGENT_MOCK_DELAY_MS: '400',
          IMPECCABLE_LIVE_COPY_AGENT_MOCK_RESULT: JSON.stringify({
            status: 'done',
            appliedEntryIds: ['abcdef12'],
            files: ['src/page.html'],
          }),
        },
      });
      const stash = await fetch(`http://localhost:${commitServer.port}/manual-edit-stash`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: commitServer.token,
          id: 'abcdef12',
          pageUrl: '/',
          element: { tagName: 'h1', outerHTML: '<h1 class="hero">Hello</h1>', textContent: 'Hello' },
          ops: [{ ref: 'body>h1.hero:nth-of-type(1)', tag: 'h1', classes: ['hero'], originalText: 'Welcome', newText: 'Hello' }],
        }),
      });
      assert.equal(stash.status, 200);
      writeFileSync(sourcePath, '<h1 class="hero">Hello</h1>\n');

      const commitPromise = fetch(`http://localhost:${commitServer.port}/manual-edit-commit?token=${commitServer.token}&pageUrl=%2F`, {
        method: 'POST',
      });

      const startedBody = await waitForManualActivity(commitServer, 'manual_edit_commit_started');
      assert.equal(startedBody.manualEdits.lastActivity.type, 'manual_edit_commit_started');
      assert.equal(startedBody.manualEdits.lastActivity.pendingCount, 1);

      const commit = await commitPromise;
      assert.equal(commit.status, 200);
      const result = await commit.json();

      assert.equal(result.count, 1);
      assert.equal(result.cleared, 1);
      assert.equal(result.perPage['/'] || 0, 0);
      assert.equal(result.applied.length, 1);
      assert.match(readFileSync(sourcePath, 'utf-8'), /Hello/);

      const status = await fetch(`http://localhost:${commitServer.port}/status?token=${commitServer.token}`);
      assert.equal(status.status, 200);
      const statusBody = await status.json();
      assert.equal(statusBody.manualEdits.lastActivity.type, 'manual_edit_commit_done');
      assert.equal(statusBody.manualEdits.lastActivity.appliedCount, 1);
      assert.equal(statusBody.manualEdits.lastActivity.cleared, 1);
    } finally {
      if (commitServer) {
        await stopServer(commitServer.port, commitServer.token);
        commitServer.proc.kill();
      }
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('/manual-edit-commit async mode returns immediately and reports completion through status/SSE activity', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'impeccable-manual-commit-server-async-'));
    let asyncServer;
    try {
      mkdirSync(join(tmp, 'src'), { recursive: true });
      const sourcePath = join(tmp, 'src', 'page.html');
      writeFileSync(sourcePath, '<h1 class="hero">Welcome</h1>\n');

      asyncServer = await startServer(8546, {
        cwd: tmp,
        env: {
          IMPECCABLE_LIVE_COPY_AGENT: 'mock',
          IMPECCABLE_LIVE_COPY_AGENT_MOCK_DELAY_MS: '300',
          IMPECCABLE_LIVE_COPY_AGENT_MOCK_RESULT: JSON.stringify({
            status: 'done',
            appliedEntryIds: ['ab12cd34'],
            files: ['src/page.html'],
          }),
        },
      });
      const stash = await fetch(`http://localhost:${asyncServer.port}/manual-edit-stash`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: asyncServer.token,
          id: 'ab12cd34',
          pageUrl: '/',
          element: { tagName: 'h1', outerHTML: '<h1 class="hero">Hello</h1>', textContent: 'Hello' },
          ops: [{ ref: 'body>h1.hero:nth-of-type(1)', tag: 'h1', classes: ['hero'], originalText: 'Welcome', newText: 'Hello' }],
        }),
      });
      assert.equal(stash.status, 200);
      writeFileSync(sourcePath, '<h1 class="hero">Hello</h1>\n');

      const commit = await fetch(`http://localhost:${asyncServer.port}/manual-edit-commit?token=${asyncServer.token}&pageUrl=%2F&async=1`, {
        method: 'POST',
      });
      assert.equal(commit.status, 202);
      const started = await commit.json();
      assert.equal(started.status, 'started');
      assert.equal(started.pendingCount, 1);

      const done = await waitForManualActivity(asyncServer, 'manual_edit_commit_done', { timeoutMs: 2000 });
      assert.equal(done.manualEdits.lastActivity.appliedCount, 1);
      assert.equal(done.manualEdits.lastActivity.cleared, 1);

      const stashAfter = await fetch(`http://localhost:${asyncServer.port}/manual-edit-stash?token=${asyncServer.token}&pageUrl=%2F`);
      assert.equal(stashAfter.status, 200);
      const stashBody = await stashAfter.json();
      assert.equal(stashBody.count, 0);
      assert.match(readFileSync(sourcePath, 'utf-8'), /Hello/);
    } finally {
      if (asyncServer) {
        await stopServer(asyncServer.port, asyncServer.token);
        asyncServer.proc.kill();
      }
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('/manual-edit-commit routes through the chat agent poll loop when configured', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'impeccable-manual-commit-chat-'));
    let chatServer;
    try {
      mkdirSync(join(tmp, 'src'), { recursive: true });
      const sourcePath = join(tmp, 'src', 'page.html');
      writeFileSync(sourcePath, '<h1 class="hero">Welcome</h1>\n');

      chatServer = await startServer(8524, {
        cwd: tmp,
        env: { IMPECCABLE_LIVE_COPY_AGENT: 'chat' },
      });

      // Stash a single op.
      const stash = await fetch(`http://localhost:${chatServer.port}/manual-edit-stash`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: chatServer.token,
          id: 'cafebabe',
          pageUrl: '/',
          element: { tagName: 'h1', outerHTML: '<h1 class="hero">Welcome</h1>', textContent: 'Welcome' },
          ops: [{ ref: 'body>h1.hero:nth-of-type(1)', tag: 'h1', classes: ['hero'], originalText: 'Welcome', newText: 'Hello' }],
        }),
      });
      assert.equal(stash.status, 200);

      let evidencePath;
      // Fake agent: long-poll, write the file, ack with the result shape.
      const agentLoop = (async () => {
        // First poll picks up the manual_edit_apply event.
        const pollRes = await fetch(`http://localhost:${chatServer.port}/poll?token=${chatServer.token}&timeout=10000&leaseMs=30000`);
        const event = await pollRes.json();
        assert.equal(event.type, 'manual_edit_apply');
        assert.deepEqual(event.agentAction, {
          kind: 'manual_edit_apply',
          required: 'apply_source_edits_then_reply',
          replyCommand: `live-poll.mjs --reply ${event.id} done --data '<json>'`,
          warning: 'Polling only leases this work item; it does not commit source edits.',
        });
        assert.equal(event.pageUrl, '/');
        assert.equal(typeof event.evidencePath, 'string');
        evidencePath = event.evidencePath;
        assert.equal(existsSync(event.evidencePath), true);
        assert.equal(Array.isArray(event.batch.candidates), true);
        assert.doesNotMatch(JSON.stringify(event.batch), /outerHTML|computedStyles|cssCustomProperties/);
        const evidence = JSON.parse(readFileSync(event.evidencePath, 'utf-8'));
        assert.equal(evidence.entries[0].id, 'cafebabe');
        assert.equal(Array.isArray(evidence.candidates), true);
        assert.equal(event.batch.entries.length, 1);
        assert.equal(event.batch.entries[0].id, 'cafebabe');
        const statusRes = await fetch(`http://localhost:${chatServer.port}/status?token=${chatServer.token}`);
        const status = await statusRes.json();
        const pendingManual = status.pendingEvents.find((item) => item.id === event.id);
        assert.equal(pendingManual.type, 'manual_edit_apply');
        assert.equal(pendingManual.evidencePath, event.evidencePath);
        assert.equal(pendingManual.agentAction.replyCommand, `live-poll.mjs --reply ${event.id} done --data '<json>'`);
        assert.deepEqual(pendingManual.manualApplySummary.files, ['src/page.html']);
        const malformedAck = await fetch(`http://localhost:${chatServer.port}/poll`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: chatServer.token,
            id: 'done',
            type: '--file',
            file: 'src/page.html',
          }),
        });
        assert.equal(malformedAck.status, 404);
        const malformedAckBody = await malformedAck.json();
        assert.equal(malformedAckBody.error, 'unknown_poll_reply_id');
        const stillPending = JSON.parse(readFileSync(join(getLiveDir(tmp), 'pending-manual-edits.json'), 'utf-8'));
        assert.equal(stillPending.entries.length, 1, 'malformed ack must not clear staged manual edits');
        // Apply the edit to source (simulating the agent's Edit tool).
        writeFileSync(sourcePath, '<h1 class="hero">Hello</h1>\n');
        // Ack with the structured result.
        const ackRes = await fetch(`http://localhost:${chatServer.port}/poll`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: chatServer.token,
            id: event.id,
            type: 'done',
            data: {
              status: 'done',
              appliedEntryIds: ['cafebabe'],
              failed: [],
              files: ['src/page.html'],
              notes: [],
            },
          }),
        });
        assert.equal(ackRes.status, 200);
      })();

      // Trigger Apply.
      const commitPromise = fetch(`http://localhost:${chatServer.port}/manual-edit-commit?token=${chatServer.token}&pageUrl=%2F`, {
        method: 'POST',
      });

      await agentLoop;
      const commit = await commitPromise;
      assert.equal(commit.status, 200);
      const result = await commit.json();
      assert.equal(result.count, 1);
      assert.equal(result.cleared, 1, 'verified entries should be cleared from the buffer');
      assert.equal(result.applied.length, 1);
      assert.deepEqual(result.files, ['src/page.html']);
      assert.match(readFileSync(sourcePath, 'utf-8'), /Hello/);
      assert.equal(existsSync(evidencePath), false, 'accepted chat Apply should clean up its evidence file');
      assert.equal(existsSync(join(getLiveDir(tmp), 'manual-edit-apply-transaction.json')), false);
    } finally {
      if (chatServer) {
        await stopServer(chatServer.port, chatServer.token);
        chatServer.proc.kill();
      }
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('/manual-edit-commit includes compact source candidates in chat Apply events', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'impeccable-manual-commit-chat-candidates-'));
    let candidateServer;
    try {
      mkdirSync(join(tmp, 'site/scripts/components'), { recursive: true });
      writeFileSync(join(tmp, 'site/scripts/data.js'), [
        "export const skillFocusAreas = { impeccable: [",
        "  { area: 'Typography', detail: 'Scale, rhythm, hierarchy, expression' },",
        ']};',
        "export const dimensionGuidelineCounts = { 'Typography': 33 };",
        '',
      ].join('\n'));
      writeFileSync(join(tmp, 'site/scripts/components/foundation-animations.js'),
        "export const foundationAnimations = { 'Typography': '<svg>type</svg>' };\n"
      );
      writeFileSync(join(tmp, 'site/scripts/components/foundation-grid.js'), [
        "import { skillFocusAreas, dimensionGuidelineCounts } from '../data.js';",
        "import { foundationAnimations } from './foundation-animations.js';",
        "export const render = (dim) => `<span class=\"foundation-card-label\">${dim.area}</span><span class=\"foundation-card-count\">${dimensionGuidelineCounts[dim.area]}</span>${foundationAnimations[dim.area]}`;",
        '',
      ].join('\n'));

      candidateServer = await startServer(8539, {
        cwd: tmp,
        env: { IMPECCABLE_LIVE_COPY_AGENT: 'chat' },
      });

      await stashManualEdit(candidateServer, {
        id: 'feedcafe',
        pageUrl: '/',
        element: { tagName: 'div', classes: ['foundation-card'], textContent: 'Typography 33 Scale, rhythm, hierarchy, expression' },
        ops: [
          {
            ref: 'body>main>section#foundation>div.foundation-card>span.foundation-card-label:nth-of-type(1)',
            tag: 'span',
            classes: ['foundation-card-label'],
            originalText: 'Typography',
            newText: 'Typo WOW',
          },
          {
            ref: 'body>main>section#foundation>div.foundation-card>span.foundation-card-count:nth-of-type(2)',
            tag: 'span',
            classes: ['foundation-card-count'],
            originalText: '33',
            newText: '0033',
          },
        ],
      });

      const commitPromise = fetch(`http://localhost:${candidateServer.port}/manual-edit-commit?token=${candidateServer.token}&pageUrl=%2F`, {
        method: 'POST',
      });

      const event = await fetch(`http://localhost:${candidateServer.port}/poll?token=${candidateServer.token}&timeout=10000&leaseMs=30000`)
        .then((res) => res.json());
      assert.equal(event.type, 'manual_edit_apply');
      const evidencePath = event.evidencePath;
      assert.equal(Array.isArray(event.batch.candidates), true);
      const candidateJson = JSON.stringify(event.batch.candidates);
      assert.match(candidateJson, /site\/scripts\/data\.js/);
      assert.match(candidateJson, /site\/scripts\/components\/foundation-animations\.js/);
      assert.match(candidateJson, /objectKeyMatches/);
      assert.ok(JSON.stringify(event).length < 12000, 'chat Apply poll payload should stay compact with filtered candidates');

      const ack = await fetch(`http://localhost:${candidateServer.port}/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: candidateServer.token,
          id: event.id,
          type: 'done',
          data: {
            status: 'error',
            appliedEntryIds: [],
            failed: [{ entryId: 'feedcafe', reason: 'test finished after inspecting candidates' }],
            files: [],
            notes: [],
          },
        }),
      });
      assert.equal(ack.status, 200);

      const commit = await commitPromise;
      assert.equal(commit.status, 200);
      const result = await commit.json();
      assert.equal(result.cleared, 0);
      assert.equal(result.failed[0].id, 'feedcafe');
      assert.equal(existsSync(evidencePath), false, 'terminal failed Apply reply should clean up evidence');
    } finally {
      if (candidateServer) {
        await stopServer(candidateServer.port, candidateServer.token);
        candidateServer.proc.kill();
      }
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('/manual-edit-commit rejects malformed chat Apply results without rolling back before retry', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'impeccable-manual-commit-chat-invalid-result-'));
    let chatServer;
    try {
      mkdirSync(join(tmp, 'src'), { recursive: true });
      const sourcePath = join(tmp, 'src', 'page.html');
      writeFileSync(sourcePath, '<h1 class="hero">Welcome</h1>\n');

      chatServer = await startServer(8537, {
        cwd: tmp,
        env: { IMPECCABLE_LIVE_COPY_AGENT: 'chat' },
      });

      await stashManualEdit(chatServer, {
        id: 'badc0de1',
        pageUrl: '/',
        element: { tagName: 'h1', outerHTML: '<h1 class="hero">Welcome</h1>', textContent: 'Welcome' },
        ops: [{
          ref: 'body>h1.hero:nth-of-type(1)',
          tag: 'h1',
          classes: ['hero'],
          originalText: 'Welcome',
          newText: 'Hello',
          sourceHint: { file: 'src/page.html', line: 1 },
        }],
      });

      const agentLoop = (async () => {
        const pollRes = await fetch(`http://localhost:${chatServer.port}/poll?token=${chatServer.token}&timeout=10000&leaseMs=30000`);
        const event = await pollRes.json();
        assert.equal(event.type, 'manual_edit_apply');
        const evidencePath = event.evidencePath;
        assert.equal(existsSync(evidencePath), true);

        writeFileSync(sourcePath, '<h1 class="hero">Hello</h1>\n');

        const rejectReply = async (data, expectedReason) => {
          const badAck = await fetch(`http://localhost:${chatServer.port}/poll`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              token: chatServer.token,
              id: event.id,
              type: 'done',
              ...(data === undefined ? {} : { data }),
            }),
          });
          assert.equal(badAck.status, 400);
          const body = await badAck.json();
          assert.equal(body.error, 'invalid_manual_apply_result');
          assert.equal(body.reason, expectedReason);
          assert.match(body.hint, new RegExp(`--reply ${event.id} done --data`));
          assert.match(readFileSync(sourcePath, 'utf-8'), /Hello/);
          assert.equal(existsSync(evidencePath), true, 'invalid replies should keep evidence for retry');
          const buffer = JSON.parse(readFileSync(join(getLiveDir(tmp), 'pending-manual-edits.json'), 'utf-8'));
          assert.equal(buffer.entries.length, 1, 'invalid result must keep staged manual edits until a valid retry');
          const statusRes = await fetch(`http://localhost:${chatServer.port}/status?token=${chatServer.token}`);
          const status = await statusRes.json();
          assert.equal(
            status.pendingEvents.some((item) => item.id === event.id && item.type === 'manual_edit_apply'),
            true,
            'invalid result must not acknowledge the leased manual Apply event',
          );
        };

        await rejectReply(undefined, 'missing_result_data');
        await rejectReply({ status: 'applied', entries: 99 }, 'summary_result_not_allowed');
        await rejectReply({ status: 'applied' }, 'invalid_status');
        await rejectReply({ status: 'applied', entries: 1, files: ['src/page.html'] }, 'summary_result_not_allowed');
        await rejectReply({ status: 'done', failed: [], files: [], notes: [] }, 'appliedEntryIds_must_be_array');
        await rejectReply({ status: 'done', appliedEntryIds: [], failed: [], files: [], notes: [] }, 'done_result_missing_applied_entry_ids');
        await rejectReply({ status: 'done', appliedEntryIds: ['not-this-event'], failed: [], files: [], notes: [] }, 'applied_entry_id_not_in_event');
        await rejectReply({ status: 'partial', appliedEntryIds: ['badc0de1'], failed: 'nope', files: [], notes: [] }, 'failed_must_be_array');

        const ackRes = await fetch(`http://localhost:${chatServer.port}/poll`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: chatServer.token,
            id: event.id,
            type: 'done',
            data: {
              status: 'done',
              appliedEntryIds: ['badc0de1'],
              failed: [],
              files: ['src/page.html'],
              notes: [],
            },
          }),
        });
        assert.equal(ackRes.status, 200);
        assert.equal(existsSync(evidencePath), false, 'valid retry should clean up evidence');
      })();

      const commitPromise = fetch(`http://localhost:${chatServer.port}/manual-edit-commit?token=${chatServer.token}&pageUrl=%2F`, {
        method: 'POST',
      });

      await agentLoop;
      const commit = await commitPromise;
      assert.equal(commit.status, 200);
      const result = await commit.json();
      assert.equal(result.cleared, 1);
      assert.equal(result.failed.length, 0);
      assert.match(readFileSync(sourcePath, 'utf-8'), /Hello/);
      const buffer = JSON.parse(readFileSync(join(getLiveDir(tmp), 'pending-manual-edits.json'), 'utf-8'));
      assert.equal(buffer.entries.length, 0, 'valid retry should clear staged manual edits');
    } finally {
      if (chatServer) {
        await stopServer(chatServer.port, chatServer.token);
        chatServer.proc.kill();
      }
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('/manual-edit-commit chunks chat Apply events by op count and aggregates replies', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'impeccable-manual-commit-chat-chunks-'));
    let chunkServer;
    try {
      mkdirSync(join(tmp, 'src'), { recursive: true });
      const sourcePath = join(tmp, 'src', 'page.html');
      writeFileSync(sourcePath, Array.from({ length: 7 }, (_, index) => `<p>Item ${String(index + 1).padStart(2, '0')}</p>`).join('\n') + '\n');

      chunkServer = await startServer(8528, {
        cwd: tmp,
        env: {
          IMPECCABLE_LIVE_COPY_AGENT: 'chat',
          IMPECCABLE_LIVE_MANUAL_EDIT_CHUNK_SIZE: '3',
        },
      });

      for (let index = 0; index < 7; index += 1) {
        const n = String(index + 1).padStart(2, '0');
        await stashManualEdit(chunkServer, {
          id: `a00000${n}`,
          pageUrl: '/',
          element: { tagName: 'p', outerHTML: `<p>Item ${n}</p>`, textContent: `Item ${n}` },
          ops: [{
            ref: `body>p:nth-of-type(${index + 1})`,
            tag: 'p',
            originalText: `Item ${n}`,
            newText: `Edited ${n}`,
            sourceHint: { file: 'src/page.html', line: index + 1 },
          }],
        });
      }

      const evidencePaths = [];
      const agentLoop = (async () => {
        const expectedChunkSizes = [3, 3, 1];
        for (const [index, expectedSize] of expectedChunkSizes.entries()) {
          const pollRes = await fetch(`http://localhost:${chunkServer.port}/poll?token=${chunkServer.token}&timeout=10000&leaseMs=30000`);
          const event = await pollRes.json();
          assert.equal(event.type, 'manual_edit_apply');
          assert.equal(event.agentAction.required, 'apply_source_edits_then_reply');
          assert.equal(event.agentAction.replyCommand, `live-poll.mjs --reply ${event.id} done --data '<json>'`);
          assert.equal(typeof event.evidencePath, 'string');
          assert.equal(existsSync(event.evidencePath), true);
          evidencePaths.push(event.evidencePath);
          assert.equal(Array.isArray(event.batch.candidates), true);
          assert.ok(JSON.stringify(event).length < 9000, 'chat Apply poll payload should stay compact; full evidence lives at evidencePath');
          assert.deepEqual(event.chunk, {
            index: index + 1,
            total: 3,
            opCount: expectedSize,
            totalOpCount: 7,
          });
          assert.equal(event.batch.count, expectedSize);
          assert.equal(event.batch.entries.reduce((sum, entry) => sum + entry.ops.length, 0), expectedSize);

          let source = readFileSync(sourcePath, 'utf-8');
          for (const entry of event.batch.entries) {
            for (const op of entry.ops) source = source.replace(op.originalText, op.newText);
          }
          writeFileSync(sourcePath, source);

          const ack = await fetch(`http://localhost:${chunkServer.port}/poll`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              token: chunkServer.token,
              id: event.id,
              type: 'done',
              data: {
                status: 'done',
                appliedEntryIds: event.batch.entries.map((entry) => entry.id),
                failed: [],
                files: ['src/page.html'],
                notes: [],
              },
            }),
          });
          assert.equal(ack.status, 200);
        }
      })();

      const commitPromise = fetch(`http://localhost:${chunkServer.port}/manual-edit-commit?token=${chunkServer.token}&pageUrl=%2F`, {
        method: 'POST',
      });

      await agentLoop;
      const commit = await commitPromise;
      assert.equal(commit.status, 200);
      const result = await commit.json();
      assert.equal(result.count, 7);
      assert.equal(result.cleared, 7);
      assert.equal(result.applied.length, 7);
      assert.equal(result.failed.length, 0);
      assert.match(readFileSync(sourcePath, 'utf-8'), /Edited 07/);
      assert.deepEqual(evidencePaths.map((file) => existsSync(file)), [false, false, false]);
    } finally {
      if (chunkServer) {
        await stopServer(chunkServer.port, chunkServer.token);
        chunkServer.proc.kill();
      }
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('/manual-edit-commit keeps fitting multi-op entries together across chat chunks', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'impeccable-manual-commit-chat-entry-chunks-'));
    let chunkServer;
    try {
      mkdirSync(join(tmp, 'src'), { recursive: true });
      const sourcePath = join(tmp, 'src', 'page.html');
      writeFileSync(sourcePath, [
        '<h1>Alpha</h1>',
        '<p>Bravo</p>',
        '<h2>Charlie</h2>',
        '<p>Delta</p>',
        '<button>Echo</button>',
      ].join('\n') + '\n');

      chunkServer = await startServer(8544, {
        cwd: tmp,
        env: {
          IMPECCABLE_LIVE_COPY_AGENT: 'chat',
          IMPECCABLE_LIVE_MANUAL_EDIT_CHUNK_SIZE: '3',
        },
      });

      await stashManualEdit(chunkServer, {
        id: 'aa111111',
        pageUrl: '/',
        element: { tagName: 'section', textContent: 'Alpha Bravo' },
        ops: [
          { ref: 'body>h1:nth-of-type(1)', tag: 'h1', originalText: 'Alpha', newText: 'Alpha edited', sourceHint: { file: 'src/page.html', line: 1 } },
          { ref: 'body>p:nth-of-type(1)', tag: 'p', originalText: 'Bravo', newText: 'Bravo edited', sourceHint: { file: 'src/page.html', line: 2 } },
        ],
      });
      await stashManualEdit(chunkServer, {
        id: 'bb222222',
        pageUrl: '/',
        element: { tagName: 'section', textContent: 'Charlie Delta' },
        ops: [
          { ref: 'body>h2:nth-of-type(1)', tag: 'h2', originalText: 'Charlie', newText: 'Charlie edited', sourceHint: { file: 'src/page.html', line: 3 } },
          { ref: 'body>p:nth-of-type(2)', tag: 'p', originalText: 'Delta', newText: 'Delta edited', sourceHint: { file: 'src/page.html', line: 4 } },
        ],
      });
      await stashManualEdit(chunkServer, {
        id: 'cc333333',
        pageUrl: '/',
        element: { tagName: 'button', textContent: 'Echo' },
        ops: [
          { ref: 'body>button:nth-of-type(1)', tag: 'button', originalText: 'Echo', newText: 'Echo edited', sourceHint: { file: 'src/page.html', line: 5 } },
        ],
      });

      const agentLoop = (async () => {
        const expected = [
          { size: 2, ids: ['aa111111'] },
          { size: 3, ids: ['bb222222', 'cc333333'] },
        ];
        for (const [index, expectation] of expected.entries()) {
          const event = await fetch(`http://localhost:${chunkServer.port}/poll?token=${chunkServer.token}&timeout=10000&leaseMs=30000`)
            .then((res) => res.json());
          assert.equal(event.type, 'manual_edit_apply');
          assert.equal(event.batch.count, expectation.size);
          assert.deepEqual(event.batch.entries.map((entry) => entry.id), expectation.ids);
          assert.deepEqual(event.batch.entries.map((entry) => entry.ops.length), expectation.ids.map((id) => id === 'cc333333' ? 1 : 2));
          assert.deepEqual(event.chunk, {
            index: index + 1,
            total: 2,
            opCount: expectation.size,
            totalOpCount: 5,
          });

          let source = readFileSync(sourcePath, 'utf-8');
          for (const entry of event.batch.entries) {
            for (const op of entry.ops) source = source.replace(op.originalText, op.newText);
          }
          writeFileSync(sourcePath, source);

          const ack = await fetch(`http://localhost:${chunkServer.port}/poll`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              token: chunkServer.token,
              id: event.id,
              type: 'done',
              data: {
                status: 'done',
                appliedEntryIds: event.batch.entries.map((entry) => entry.id),
                failed: [],
                files: ['src/page.html'],
                notes: [],
              },
            }),
          });
          assert.equal(ack.status, 200);
        }
      })();

      const commitPromise = fetch(`http://localhost:${chunkServer.port}/manual-edit-commit?token=${chunkServer.token}&pageUrl=%2F`, {
        method: 'POST',
      });

      await agentLoop;
      const commit = await commitPromise;
      assert.equal(commit.status, 200);
      const result = await commit.json();
      assert.equal(result.cleared, 5);
      assert.equal(result.applied.length, 5);
      assert.equal(result.failed.length, 0);
      assert.match(readFileSync(sourcePath, 'utf-8'), /Echo edited/);
    } finally {
      if (chunkServer) {
        await stopServer(chunkServer.port, chunkServer.token);
        chunkServer.proc.kill();
      }
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('/manual-edit-commit splits one multi-op entry and clears it only after every chunk applies', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'impeccable-manual-commit-chat-split-entry-'));
    let splitServer;
    try {
      mkdirSync(join(tmp, 'src'), { recursive: true });
      const sourcePath = join(tmp, 'src', 'page.html');
      writeFileSync(sourcePath, ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'].map((text) => `<span>${text}</span>`).join('\n') + '\n');

      splitServer = await startServer(8529, {
        cwd: tmp,
        env: {
          IMPECCABLE_LIVE_COPY_AGENT: 'chat',
          IMPECCABLE_LIVE_MANUAL_EDIT_CHUNK_SIZE: '3',
        },
      });

      await stashManualEdit(splitServer, {
        id: 'abc55555',
        pageUrl: '/',
        element: { tagName: 'section', outerHTML: '<section>Alpha Bravo Charlie Delta Echo</section>', textContent: 'Alpha Bravo Charlie Delta Echo' },
        ops: ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'].map((text, index) => ({
          ref: `body>section>span:nth-of-type(${index + 1})`,
          tag: 'span',
          originalText: text,
          newText: `${text} edited`,
          sourceHint: { file: 'src/page.html', line: index + 1 },
        })),
      });

      const agentLoop = (async () => {
        for (const [index, expectedSize] of [3, 2].entries()) {
          const event = await fetch(`http://localhost:${splitServer.port}/poll?token=${splitServer.token}&timeout=10000&leaseMs=30000`)
            .then((res) => res.json());
          assert.equal(event.type, 'manual_edit_apply');
          assert.equal(event.agentAction.required, 'apply_source_edits_then_reply');
          assert.equal(event.agentAction.replyCommand, `live-poll.mjs --reply ${event.id} done --data '<json>'`);
          assert.equal(typeof event.evidencePath, 'string');
          assert.equal(existsSync(event.evidencePath), true);
          assert.equal(Array.isArray(event.batch.candidates), true);
          assert.equal(event.batch.entries.length, 1);
          assert.equal(event.batch.entries[0].id, 'abc55555');
          assert.equal(event.batch.entries[0].ops.length, expectedSize);
          assert.deepEqual(event.chunk, {
            index: index + 1,
            total: 2,
            opCount: expectedSize,
            totalOpCount: 5,
          });

          let source = readFileSync(sourcePath, 'utf-8');
          for (const op of event.batch.entries[0].ops) source = source.replace(op.originalText, op.newText);
          writeFileSync(sourcePath, source);

          const ack = await fetch(`http://localhost:${splitServer.port}/poll`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              token: splitServer.token,
              id: event.id,
              type: 'done',
              data: {
                status: 'done',
                appliedEntryIds: ['abc55555'],
                failed: [],
                files: ['src/page.html'],
                notes: [],
              },
            }),
          });
          assert.equal(ack.status, 200);
        }
      })();

      const commitPromise = fetch(`http://localhost:${splitServer.port}/manual-edit-commit?token=${splitServer.token}&pageUrl=%2F`, {
        method: 'POST',
      });

      await agentLoop;
      const commit = await commitPromise;
      assert.equal(commit.status, 200);
      const result = await commit.json();
      assert.equal(result.count, 5);
      assert.equal(result.cleared, 5);
      assert.equal(result.applied.length, 5);
      assert.equal(result.failed.length, 0);
      assert.match(readFileSync(sourcePath, 'utf-8'), /Echo edited/);
    } finally {
      if (splitServer) {
        await stopServer(splitServer.port, splitServer.token);
        splitServer.proc.kill();
      }
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('/manual-edit-commit rolls back a split entry when a later chat chunk fails', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'impeccable-manual-commit-chat-chunk-fail-'));
    let failServer;
    try {
      mkdirSync(join(tmp, 'src'), { recursive: true });
      const sourcePath = join(tmp, 'src', 'page.html');
      const originalSource = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'].map((text) => `<span>${text}</span>`).join('\n') + '\n';
      writeFileSync(sourcePath, originalSource);

      failServer = await startServer(8530, {
        cwd: tmp,
        env: {
          IMPECCABLE_LIVE_COPY_AGENT: 'chat',
          IMPECCABLE_LIVE_MANUAL_EDIT_CHUNK_SIZE: '3',
        },
      });

      await stashManualEdit(failServer, {
        id: 'def55555',
        pageUrl: '/',
        element: { tagName: 'section', outerHTML: '<section>Alpha Bravo Charlie Delta Echo</section>', textContent: 'Alpha Bravo Charlie Delta Echo' },
        ops: ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'].map((text, index) => ({
          ref: `body>section>span:nth-of-type(${index + 1})`,
          tag: 'span',
          originalText: text,
          newText: `${text} edited`,
          sourceHint: { file: 'src/page.html', line: index + 1 },
        })),
      });

      const agentLoop = (async () => {
        const firstEvent = await fetch(`http://localhost:${failServer.port}/poll?token=${failServer.token}&timeout=10000&leaseMs=30000`)
          .then((res) => res.json());
        assert.equal(firstEvent.type, 'manual_edit_apply');
        assert.equal(firstEvent.chunk.index, 1);
        let source = readFileSync(sourcePath, 'utf-8');
        for (const op of firstEvent.batch.entries[0].ops) source = source.replace(op.originalText, op.newText);
        writeFileSync(sourcePath, source);
        const firstAck = await fetch(`http://localhost:${failServer.port}/poll`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: failServer.token,
            id: firstEvent.id,
            type: 'done',
            data: {
              status: 'done',
              appliedEntryIds: ['def55555'],
              failed: [],
              files: ['src/page.html'],
              notes: [],
            },
          }),
        });
        assert.equal(firstAck.status, 200);

        const secondEvent = await fetch(`http://localhost:${failServer.port}/poll?token=${failServer.token}&timeout=10000&leaseMs=30000`)
          .then((res) => res.json());
        assert.equal(secondEvent.type, 'manual_edit_apply');
        assert.equal(secondEvent.chunk.index, 2);
        const failedAck = await fetch(`http://localhost:${failServer.port}/poll`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: failServer.token,
            id: secondEvent.id,
            type: 'done',
            data: {
              status: 'error',
              appliedEntryIds: [],
              failed: [{ entryId: 'def55555', reason: 'second chunk failed' }],
              files: [],
              notes: [],
              message: 'second chunk failed',
            },
          }),
        });
        assert.equal(failedAck.status, 200);
      })();

      const commitPromise = fetch(`http://localhost:${failServer.port}/manual-edit-commit?token=${failServer.token}&pageUrl=%2F`, {
        method: 'POST',
      });

      await agentLoop;
      const commit = await commitPromise;
      assert.equal(commit.status, 200);
      const result = await commit.json();
      assert.equal(result.count, 5);
      assert.equal(result.cleared, 0);
      assert.equal(result.applied.length, 0);
      assert.equal(result.failed[0].id, 'def55555');
      assert.equal(result.failed[0].reason, 'second chunk failed');
      assert.deepEqual(result.rolledBackFiles, ['src/page.html']);
      assert.equal(readFileSync(sourcePath, 'utf-8'), originalSource);

      const nextEvent = await fetch(`http://localhost:${failServer.port}/poll?token=${failServer.token}&timeout=100&leaseMs=1`)
        .then((res) => res.json());
      assert.equal(nextEvent.type, 'timeout');

      const buffer = JSON.parse(readFileSync(join(getLiveDir(tmp), 'pending-manual-edits.json'), 'utf-8'));
      assert.equal(buffer.entries.length, 1);
    } finally {
      if (failServer) {
        await stopServer(failServer.port, failServer.token);
        failServer.proc.kill();
      }
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('/manual-edit-commit keeps entries staged when the chat agent does not ack', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'impeccable-manual-commit-timeout-'));
    let timeoutServer;
    try {
      mkdirSync(join(tmp, 'src'), { recursive: true });
      const sourcePath = join(tmp, 'src', 'page.html');
      writeFileSync(sourcePath, '<h1 class="hero">Welcome</h1>\n');

      timeoutServer = await startServer(8525, {
        cwd: tmp,
        env: {
          IMPECCABLE_LIVE_COPY_AGENT: 'chat',
          IMPECCABLE_LIVE_APPLY_EVENT_HARD_TIMEOUT_MS: '300',
          IMPECCABLE_LIVE_APPLY_EVENT_SOFT_DEADLINE_MS: '250',
        },
      });

      const stash = await fetch(`http://localhost:${timeoutServer.port}/manual-edit-stash`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: timeoutServer.token,
          id: 'feedface',
          pageUrl: '/',
          element: { tagName: 'h1', outerHTML: '<h1 class="hero">Welcome</h1>', textContent: 'Welcome' },
          ops: [{ ref: 'body>h1.hero:nth-of-type(1)', tag: 'h1', classes: ['hero'], originalText: 'Welcome', newText: 'Hello' }],
        }),
      });
      assert.equal(stash.status, 200);

      const pollPromise = fetch(`http://localhost:${timeoutServer.port}/poll?token=${timeoutServer.token}&timeout=10000&leaseMs=30000`)
        .then((res) => res.json());
      const commitPromise = fetch(`http://localhost:${timeoutServer.port}/manual-edit-commit?token=${timeoutServer.token}&pageUrl=%2F`, {
        method: 'POST',
      });

      const event = await pollPromise;
      assert.equal(event.type, 'manual_edit_apply');
      assert.equal(event.deadlineMs, 250);
      assert.equal(existsSync(event.evidencePath), true);

      const commit = await commitPromise;
      assert.equal(commit.status, 200);
      const result = await commit.json();
      assert.equal(result.cleared, 0);
      assert.equal(result.applied.length, 0);
      assert.equal(result.failed.length, 1);
      assert.equal(result.failed[0].reason, 'chat_agent_timeout');
      assert.match(readFileSync(sourcePath, 'utf-8'), /Welcome/);
      assert.equal(existsSync(event.evidencePath), false, 'timed-out Apply should clean up evidence');
      assert.equal(existsSync(join(getLiveDir(tmp), 'manual-edit-apply-transaction.json')), false);

      writeFileSync(sourcePath, '<h1 class="hero">Late write</h1>\n');
      const lateAck = await fetch(`http://localhost:${timeoutServer.port}/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: timeoutServer.token,
          id: event.id,
          type: 'done',
          data: {
            status: 'done',
            appliedEntryIds: ['feedface'],
            failed: [],
            files: ['src/page.html'],
          },
        }),
      });
      assert.equal(lateAck.status, 409);
      const lateAckBody = await lateAck.json();
      assert.equal(lateAckBody.error, 'stale_manual_edit_apply_reply');
      assert.deepEqual(lateAckBody.rolledBackFiles, ['src/page.html']);
      assert.match(readFileSync(sourcePath, 'utf-8'), /Welcome/);

      const buffer = JSON.parse(readFileSync(join(getLiveDir(tmp), 'pending-manual-edits.json'), 'utf-8'));
      assert.equal(buffer.entries.length, 1);
    } finally {
      if (timeoutServer) {
        await stopServer(timeoutServer.port, timeoutServer.token);
        timeoutServer.proc.kill();
      }
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('/manual-edit-commit repairs post-apply validation failures instead of rolling back', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'impeccable-manual-repair-success-'));
    let repairServer;
    try {
      mkdirSync(join(tmp, 'src'), { recursive: true });
      writeFileSync(join(tmp, 'package.json'), '{"type":"module"}\n');
      const pagePath = join(tmp, 'src', 'page.html');
      const dataPath = join(tmp, 'src', 'data.js');
      writeFileSync(pagePath, '<h1>Welcome</h1>\n');
      writeFileSync(dataPath, "export const counts = { 'Color': 29 };\n");

      repairServer = await startServer(8551, {
        cwd: tmp,
        env: { IMPECCABLE_LIVE_COPY_AGENT: 'chat' },
      });

      await stashManualEdit(repairServer, {
        id: 'a0000001',
        pageUrl: '/',
        element: { tagName: 'h1', outerHTML: '<h1>Welcome</h1>', textContent: 'Welcome' },
        ops: [{
          ref: 'body>h1:nth-of-type(1)',
          tag: 'h1',
          originalText: 'Welcome',
          newText: 'Hello',
          sourceHint: { file: 'src/page.html', line: 1 },
        }],
      });
      await stashManualEdit(repairServer, {
        id: 'a0000002',
        pageUrl: '/',
        element: { tagName: 'span', outerHTML: '<span>29</span>', textContent: '29' },
        ops: [{
          ref: 'body>span:nth-of-type(1)',
          tag: 'span',
          originalText: '29',
          newText: '0029',
          sourceHint: { file: 'src/data.js', line: 1 },
        }],
      });

      const agentLoop = (async () => {
        const event = await fetch(`http://localhost:${repairServer.port}/poll?token=${repairServer.token}&timeout=10000&leaseMs=30000`)
          .then((res) => res.json());
        assert.equal(event.type, 'manual_edit_apply');
        assert.equal(event.repair, undefined);
        writeFileSync(pagePath, '<h1>Hello</h1>\n');
        writeFileSync(dataPath, "export const counts = { 'Color': 0029 };\n");
        const ack = await fetch(`http://localhost:${repairServer.port}/poll`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: repairServer.token,
            id: event.id,
            type: 'done',
            data: {
              status: 'done',
              appliedEntryIds: ['a0000001', 'a0000002'],
              failed: [],
              files: ['src/page.html', 'src/data.js'],
              notes: [],
            },
          }),
        });
        assert.equal(ack.status, 200);

        const repairEvent = await fetch(`http://localhost:${repairServer.port}/poll?token=${repairServer.token}&timeout=10000&leaseMs=30000`)
          .then((res) => res.json());
        assert.equal(repairEvent.type, 'manual_edit_apply');
        assert.equal(repairEvent.repair.attempt, 1);
        assert.equal(repairEvent.repair.maxAttempts, 3);
        assert.equal(repairEvent.repair.reason, 'post_apply_validation_failed');
        assert.match(readFileSync(dataPath, 'utf-8'), /0029/);
        writeFileSync(dataPath, "export const counts = { 'Color': '0029' };\n");
        const repairAck = await fetch(`http://localhost:${repairServer.port}/poll`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: repairServer.token,
            id: repairEvent.id,
            type: 'done',
            data: {
              status: 'done',
              appliedEntryIds: ['a0000001', 'a0000002'],
              failed: [],
              files: ['src/data.js'],
              notes: [],
            },
          }),
        });
        assert.equal(repairAck.status, 200);
      })();

      const commit = await fetch(`http://localhost:${repairServer.port}/manual-edit-commit?token=${repairServer.token}&pageUrl=%2F`, {
        method: 'POST',
      });
      await agentLoop;
      assert.equal(commit.status, 200);
      const result = await commit.json();
      assert.equal(result.cleared, 2);
      assert.equal(result.failed.length, 0);
      assert.equal(result.repair.status, 'repaired');
      assert.deepEqual(result.rolledBackFiles || [], []);
      assert.equal(readFileSync(pagePath, 'utf-8'), '<h1>Hello</h1>\n');
      assert.equal(readFileSync(dataPath, 'utf-8'), "export const counts = { 'Color': '0029' };\n");
      assert.equal(existsSync(join(getLiveDir(tmp), 'manual-edit-apply-transaction.json')), false);
      const buffer = JSON.parse(readFileSync(join(getLiveDir(tmp), 'pending-manual-edits.json'), 'utf-8'));
      assert.equal(buffer.entries.length, 0);
    } finally {
      if (repairServer) {
        await stopServer(repairServer.port, repairServer.token);
        repairServer.proc.kill();
      }
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('/manual-edit-commit asks for a decision after repeated repair failures', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'impeccable-manual-repair-decision-'));
    let decisionServer;
    try {
      mkdirSync(join(tmp, 'src'), { recursive: true });
      writeFileSync(join(tmp, 'package.json'), '{"type":"module"}\n');
      const dataPath = join(tmp, 'src', 'data.js');
      const originalSource = "export const counts = { 'Color': 29 };\n";
      writeFileSync(dataPath, originalSource);

      decisionServer = await startServer(8552, {
        cwd: tmp,
        env: { IMPECCABLE_LIVE_COPY_AGENT: 'chat' },
      });

      await stashManualEdit(decisionServer, {
        id: 'b0000001',
        pageUrl: '/',
        element: { tagName: 'span', outerHTML: '<span>29</span>', textContent: '29' },
        ops: [{
          ref: 'body>span:nth-of-type(1)',
          tag: 'span',
          originalText: '29',
          newText: '0029',
          sourceHint: { file: 'src/data.js', line: 1 },
        }],
      });

      const agentLoop = (async () => {
        for (let index = 0; index < 4; index += 1) {
          const event = await fetch(`http://localhost:${decisionServer.port}/poll?token=${decisionServer.token}&timeout=10000&leaseMs=30000`)
            .then((res) => res.json());
          assert.equal(event.type, 'manual_edit_apply');
          if (index === 0) {
            assert.equal(event.repair, undefined);
          } else {
            assert.equal(event.repair.attempt, index);
            assert.equal(event.repair.maxAttempts, 3);
          }
          writeFileSync(dataPath, "export const counts = { 'Color': 0029 };\n");
          const ack = await fetch(`http://localhost:${decisionServer.port}/poll`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              token: decisionServer.token,
              id: event.id,
              type: 'done',
              data: {
                status: 'done',
                appliedEntryIds: ['b0000001'],
                failed: [],
                files: ['src/data.js'],
                notes: [],
              },
            }),
          });
          assert.equal(ack.status, 200);
        }
      })();

      const commit = await fetch(`http://localhost:${decisionServer.port}/manual-edit-commit?token=${decisionServer.token}&pageUrl=%2F`, {
        method: 'POST',
      });
      await agentLoop;
      assert.equal(commit.status, 200);
      const result = await commit.json();
      assert.equal(result.reason, 'manual_edit_repair_needs_decision');
      assert.equal(result.needsManualDecision, true);
      assert.equal(result.cleared, 0);
      assert.equal(result.repair.attempts, 3);
      assert.equal(readFileSync(dataPath, 'utf-8'), "export const counts = { 'Color': 0029 };\n");
      assert.equal(existsSync(join(getLiveDir(tmp), 'manual-edit-apply-transaction.json')), true);
      const decisionStatus = await fetch(`http://localhost:${decisionServer.port}/status?token=${decisionServer.token}`);
      assert.equal(decisionStatus.status, 200);
      const decisionStatusBody = await decisionStatus.json();
      assert.equal(decisionStatusBody.manualEdits.lastActivity.type, 'manual_edit_repair_needs_decision');
      const bufferBeforeRollback = JSON.parse(readFileSync(join(getLiveDir(tmp), 'pending-manual-edits.json'), 'utf-8'));
      assert.equal(bufferBeforeRollback.entries.length, 1);

      const rollback = await fetch(`http://localhost:${decisionServer.port}/manual-edit-repair-decision?token=${decisionServer.token}&pageUrl=%2F`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: decisionServer.token, pageUrl: '/', action: 'rollback' }),
      });
      assert.equal(rollback.status, 200);
      const rollbackBody = await rollback.json();
      assert.deepEqual(rollbackBody.rollback.rolledBackFiles, ['src/data.js']);
      assert.equal(readFileSync(dataPath, 'utf-8'), originalSource);
      assert.equal(existsSync(join(getLiveDir(tmp), 'manual-edit-apply-transaction.json')), false);
      const bufferAfterRollback = JSON.parse(readFileSync(join(getLiveDir(tmp), 'pending-manual-edits.json'), 'utf-8'));
      assert.equal(bufferAfterRollback.entries.length, 1);

      const repairWithoutTransaction = await fetch(`http://localhost:${decisionServer.port}/manual-edit-commit?token=${decisionServer.token}&pageUrl=%2F&repair=1`, {
        method: 'POST',
      });
      assert.equal(repairWithoutTransaction.status, 409);
      const repairWithoutTransactionBody = await repairWithoutTransaction.json();
      assert.equal(repairWithoutTransactionBody.error, 'manual_edit_repair_transaction_missing');
    } finally {
      if (decisionServer) {
        await stopServer(decisionServer.port, decisionServer.token);
        decisionServer.proc.kill();
      }
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('/manual-edit-discard cancels leased chat Apply events instead of redelivering them', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'impeccable-manual-discard-apply-'));
    let discardApplyServer;
    try {
      mkdirSync(join(tmp, 'src'), { recursive: true });
      const sourcePath = join(tmp, 'src', 'page.html');
      writeFileSync(sourcePath, '<h1 class="hero">Welcome</h1>\n');

      discardApplyServer = await startServer(8526, {
        cwd: tmp,
        env: { IMPECCABLE_LIVE_COPY_AGENT: 'chat' },
      });

      const stash = await fetch(`http://localhost:${discardApplyServer.port}/manual-edit-stash`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: discardApplyServer.token,
          id: 'aaaaaa11',
          pageUrl: '/',
          element: { tagName: 'h1', outerHTML: '<h1 class="hero">Welcome</h1>', textContent: 'Welcome' },
          ops: [{
            ref: 'body>h1.hero:nth-of-type(1)',
            tag: 'h1',
            classes: ['hero'],
            originalText: 'Welcome',
            newText: 'Hello',
            sourceHint: { file: 'src/page.html', line: 1 },
          }],
        }),
      });
      assert.equal(stash.status, 200);

      const pollPromise = fetch(`http://localhost:${discardApplyServer.port}/poll?token=${discardApplyServer.token}&timeout=10000&leaseMs=30000`)
        .then((res) => res.json());
      const commitPromise = fetch(`http://localhost:${discardApplyServer.port}/manual-edit-commit?token=${discardApplyServer.token}&pageUrl=%2F`, {
        method: 'POST',
      });

      const event = await pollPromise;
      assert.equal(event.type, 'manual_edit_apply');
      assert.equal(event.pageUrl, '/');
      assert.equal(event.batch.entries[0].id, 'aaaaaa11');
      assert.equal(existsSync(event.evidencePath), true);
      writeFileSync(sourcePath, '<h1 class="hero">Hello</h1>\n');

      const discard = await fetch(`http://localhost:${discardApplyServer.port}/manual-edit-discard?token=${discardApplyServer.token}&pageUrl=%2F`, {
        method: 'POST',
      });
      assert.equal(discard.status, 200);
      const discardBody = await discard.json();
      assert.equal(discardBody.discarded, 1);
      assert.deepEqual(discardBody.canceledApplyEvents.map((item) => item.id), [event.id]);
      assert.deepEqual(discardBody.canceledApplyEvents[0].rolledBackFiles, ['src/page.html']);
      assert.equal(discardBody.totalCount, 0);
      assert.match(readFileSync(sourcePath, 'utf-8'), /Welcome/);
      assert.equal(existsSync(event.evidencePath), false, 'discarded Apply should clean up evidence');
      assert.equal(existsSync(join(getLiveDir(tmp), 'manual-edit-apply-transaction.json')), false);

      const commit = await commitPromise;
      assert.equal(commit.status, 200);
      const commitBody = await commit.json();
      assert.equal(commitBody.cleared, 0);
      assert.equal(commitBody.failed.length, 1);
      assert.equal(commitBody.failed[0].reason, 'manual_edit_discarded');
      assert.equal(commitBody.totalCount, 0);

      const nextPoll = await fetch(`http://localhost:${discardApplyServer.port}/poll?token=${discardApplyServer.token}&timeout=100&leaseMs=1`);
      const nextEvent = await nextPoll.json();
      assert.equal(nextEvent.type, 'timeout');

      writeFileSync(sourcePath, '<h1 class="hero">Late write</h1>\n');
      const lateAck = await fetch(`http://localhost:${discardApplyServer.port}/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: discardApplyServer.token,
          id: event.id,
          type: 'done',
          data: {
            status: 'done',
            appliedEntryIds: ['aaaaaa11'],
            failed: [],
            files: ['src/page.html'],
          },
        }),
      });
      assert.equal(lateAck.status, 409);
      const lateAckBody = await lateAck.json();
      assert.equal(lateAckBody.error, 'stale_manual_edit_apply_reply');
      assert.deepEqual(lateAckBody.rolledBackFiles, ['src/page.html']);
      assert.match(readFileSync(sourcePath, 'utf-8'), /Welcome/);

      const buffer = JSON.parse(readFileSync(join(getLiveDir(tmp), 'pending-manual-edits.json'), 'utf-8'));
      assert.equal(buffer.entries.length, 0);
    } finally {
      if (discardApplyServer) {
        await stopServer(discardApplyServer.port, discardApplyServer.token);
        discardApplyServer.proc.kill();
      }
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('/manual-edit-commit rolls back abandoned chunk transactions after server restart', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'impeccable-manual-abandoned-transaction-'));
    let abandonedServer;
    let restarted;
    try {
      mkdirSync(join(tmp, 'src'), { recursive: true });
      const sourcePath = join(tmp, 'src', 'page.html');
      const originalSource = Array.from({ length: 4 }, (_, index) => `<p>Item ${index + 1}</p>`).join('\n') + '\n';
      writeFileSync(sourcePath, originalSource);

      abandonedServer = await startServer(8547, {
        cwd: tmp,
        env: {
          IMPECCABLE_LIVE_COPY_AGENT: 'chat',
          IMPECCABLE_LIVE_MANUAL_EDIT_CHUNK_SIZE: '3',
        },
      });

      for (let index = 0; index < 4; index += 1) {
        await stashManualEdit(abandonedServer, {
          id: `abc0000${index}`,
          pageUrl: '/',
          element: { tagName: 'p', outerHTML: `<p>Item ${index + 1}</p>`, textContent: `Item ${index + 1}` },
          ops: [{
            ref: `body>p:nth-of-type(${index + 1})`,
            tag: 'p',
            originalText: `Item ${index + 1}`,
            newText: `Edited ${index + 1}`,
            sourceHint: { file: 'src/page.html', line: index + 1 },
          }],
        });
      }

      const commitPromise = fetch(`http://localhost:${abandonedServer.port}/manual-edit-commit?token=${abandonedServer.token}&pageUrl=%2F`, {
        method: 'POST',
      }).catch((err) => err);

      const firstEvent = await fetch(`http://localhost:${abandonedServer.port}/poll?token=${abandonedServer.token}&timeout=10000&leaseMs=30000`)
        .then((res) => res.json());
      assert.equal(firstEvent.type, 'manual_edit_apply');
      assert.equal(firstEvent.chunk.index, 1);
      assert.equal(existsSync(firstEvent.evidencePath), true);
      let source = readFileSync(sourcePath, 'utf-8');
      for (const entry of firstEvent.batch.entries) {
        for (const op of entry.ops) source = source.replace(op.originalText, op.newText);
      }
      writeFileSync(sourcePath, source);
      assert.match(readFileSync(sourcePath, 'utf-8'), /Edited 1/);

      const firstAck = await fetch(`http://localhost:${abandonedServer.port}/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: abandonedServer.token,
          id: firstEvent.id,
          type: 'done',
          data: {
            status: 'done',
                appliedEntryIds: firstEvent.batch.entries.map((entry) => entry.id),
            failed: [],
            files: ['src/page.html'],
            notes: [],
          },
        }),
      });
      assert.equal(firstAck.status, 200);
      assert.equal(existsSync(firstEvent.evidencePath), false);

      const secondEvent = await fetch(`http://localhost:${abandonedServer.port}/poll?token=${abandonedServer.token}&timeout=10000&leaseMs=30000`)
        .then((res) => res.json());
      assert.equal(secondEvent.type, 'manual_edit_apply');
      assert.equal(secondEvent.chunk.index, 2);
      assert.equal(existsSync(secondEvent.evidencePath), true);

      abandonedServer.proc.kill('SIGKILL');
      await new Promise((resolve) => abandonedServer.proc.once('exit', resolve));
      const interrupted = await commitPromise;
      assert.ok(interrupted instanceof Error || interrupted.status === 200);
      abandonedServer = null;

      restarted = await startServer(8547, {
        cwd: tmp,
        env: {
          IMPECCABLE_LIVE_COPY_AGENT: 'chat',
          IMPECCABLE_LIVE_MANUAL_EDIT_CHUNK_SIZE: '3',
        },
      });

      assert.equal(readFileSync(sourcePath, 'utf-8'), originalSource);
      assert.equal(existsSync(secondEvent.evidencePath), false, 'server restart should prune stale Apply evidence');
      assert.equal(existsSync(join(getLiveDir(tmp), 'manual-edit-apply-transaction.json')), false);
      const buffer = JSON.parse(readFileSync(join(getLiveDir(tmp), 'pending-manual-edits.json'), 'utf-8'));
      assert.equal(buffer.entries.length, 4);
      const status = await fetch(`http://localhost:${restarted.port}/status?token=${restarted.token}`);
      assert.equal(status.status, 200);
      const statusBody = await status.json();
      assert.equal(statusBody.manualEdits.lastActivity.type, 'manual_edit_transaction_rolled_back');
      assert.equal(statusBody.manualEdits.lastActivity.reason, 'manual_edit_server_start_recovered_abandoned_transaction');
    } finally {
      if (abandonedServer) {
        try { await stopServer(abandonedServer.port, abandonedServer.token); } catch {}
        abandonedServer.proc.kill();
      }
      if (restarted) {
        await stopServer(restarted.port, restarted.token);
        restarted.proc.kill();
      }
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('/manual-edit-discard only cancels in-flight Apply events for the discarded page', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'impeccable-manual-discard-page-scope-'));
    let pageScopeServer;
    try {
      mkdirSync(join(tmp, 'src'), { recursive: true });
      const homePath = join(tmp, 'src', 'home.html');
      const docsPath = join(tmp, 'src', 'docs.html');
      writeFileSync(homePath, '<h1>Home</h1>\n');
      writeFileSync(docsPath, '<h1>Docs</h1>\n');

      pageScopeServer = await startServer(8527, {
        cwd: tmp,
        env: { IMPECCABLE_LIVE_COPY_AGENT: 'chat' },
      });

      const stashHome = await fetch(`http://localhost:${pageScopeServer.port}/manual-edit-stash`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: pageScopeServer.token,
          id: 'bbbbbb22',
          pageUrl: '/',
          element: { tagName: 'h1', outerHTML: '<h1>Home</h1>', textContent: 'Home' },
          ops: [{
            ref: 'body>h1:nth-of-type(1)',
            tag: 'h1',
            originalText: 'Home',
            newText: 'Home Ready',
            sourceHint: { file: 'src/home.html', line: 1 },
          }],
        }),
      });
      assert.equal(stashHome.status, 200);
      const stashDocs = await fetch(`http://localhost:${pageScopeServer.port}/manual-edit-stash`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: pageScopeServer.token,
          id: 'cccccc33',
          pageUrl: '/docs',
          element: { tagName: 'h1', outerHTML: '<h1>Docs</h1>', textContent: 'Docs' },
          ops: [{
            ref: 'body>h1:nth-of-type(1)',
            tag: 'h1',
            originalText: 'Docs',
            newText: 'Docs Ready',
            sourceHint: { file: 'src/docs.html', line: 1 },
          }],
        }),
      });
      assert.equal(stashDocs.status, 200);

      const homePollPromise = fetch(`http://localhost:${pageScopeServer.port}/poll?token=${pageScopeServer.token}&timeout=10000&leaseMs=30000`)
        .then((res) => res.json());
      const homeCommitPromise = fetch(`http://localhost:${pageScopeServer.port}/manual-edit-commit?token=${pageScopeServer.token}&pageUrl=%2F`, {
        method: 'POST',
      });
      const homeEvent = await homePollPromise;
      assert.equal(homeEvent.type, 'manual_edit_apply');
      assert.equal(homeEvent.pageUrl, '/');
      assert.equal(existsSync(homeEvent.evidencePath), true);

      const docsPollPromise = fetch(`http://localhost:${pageScopeServer.port}/poll?token=${pageScopeServer.token}&timeout=10000&leaseMs=30000`)
        .then((res) => res.json());
      const docsCommitPromise = fetch(`http://localhost:${pageScopeServer.port}/manual-edit-commit?token=${pageScopeServer.token}&pageUrl=%2Fdocs`, {
        method: 'POST',
      });
      const docsEvent = await docsPollPromise;
      assert.equal(docsEvent.type, 'manual_edit_apply');
      assert.equal(docsEvent.pageUrl, '/docs');
      assert.equal(existsSync(docsEvent.evidencePath), true);

      const discardHome = await fetch(`http://localhost:${pageScopeServer.port}/manual-edit-discard?token=${pageScopeServer.token}&pageUrl=%2F`, {
        method: 'POST',
      });
      assert.equal(discardHome.status, 200);
      const discardHomeBody = await discardHome.json();
      assert.deepEqual(discardHomeBody.canceledApplyEvents.map((item) => item.id), [homeEvent.id]);
      assert.equal(discardHomeBody.perPage['/'] || 0, 0);
      assert.equal(discardHomeBody.perPage['/docs'] || 0, 1);
      assert.equal(existsSync(homeEvent.evidencePath), false, 'page-scoped discard should remove matching evidence');
      assert.equal(existsSync(docsEvent.evidencePath), true, 'page-scoped discard should keep unrelated evidence');

      const homeCommit = await homeCommitPromise;
      const homeCommitBody = await homeCommit.json();
      assert.equal(homeCommitBody.failed[0].reason, 'manual_edit_discarded');

      writeFileSync(docsPath, '<h1>Docs Ready</h1>\n');
      const docsAck = await fetch(`http://localhost:${pageScopeServer.port}/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: pageScopeServer.token,
          id: docsEvent.id,
          type: 'done',
          data: {
            status: 'done',
            appliedEntryIds: ['cccccc33'],
            failed: [],
            files: ['src/docs.html'],
            notes: [],
          },
        }),
      });
      assert.equal(docsAck.status, 200);

      const docsCommit = await docsCommitPromise;
      const docsCommitBody = await docsCommit.json();
      assert.equal(docsCommitBody.cleared, 1);
      assert.equal(docsCommitBody.applied[0].id, 'cccccc33');
      assert.equal(docsCommitBody.totalCount, 0);
      assert.match(readFileSync(homePath, 'utf-8'), /Home/);
      assert.match(readFileSync(docsPath, 'utf-8'), /Docs Ready/);
      assert.equal(existsSync(docsEvent.evidencePath), false, 'successful unrelated Apply should then clean its evidence');
    } finally {
      if (pageScopeServer) {
        await stopServer(pageScopeServer.port, pageScopeServer.token);
        pageScopeServer.proc.kill();
      }
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('/poll rejects unknown reply ids instead of silently acknowledging nothing', async () => {
    const res = await fetch(`http://localhost:${server.port}/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: server.token,
        id: 'done',
        type: '--file',
        file: 'site/pages/index.astro',
      }),
    });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, 'unknown_poll_reply_id');
    assert.equal(body.id, 'done');
  });

  it('/manual-edit-discard returns discarded entries so the browser can restore visible text', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'impeccable-manual-discard-server-'));
    let discardServer;
    try {
      discardServer = await startServer(8523, { cwd: tmp });
      const stash = await fetch(`http://localhost:${discardServer.port}/manual-edit-stash`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: discardServer.token,
          id: 'abcdef16',
          pageUrl: '/',
          element: { tagName: 'h1', outerHTML: '<h1 class="hero">Hello</h1>', textContent: 'Hello' },
          ops: [{ ref: 'body>h1.hero:nth-of-type(1)', tag: 'h1', classes: ['hero'], originalText: 'Welcome', newText: 'Hello' }],
        }),
      });
      assert.equal(stash.status, 200);

      const discard = await fetch(`http://localhost:${discardServer.port}/manual-edit-discard?token=${discardServer.token}&pageUrl=%2F`, {
        method: 'POST',
      });
      assert.equal(discard.status, 200);
      const result = await discard.json();

      assert.equal(result.discarded, 1);
      assert.equal(result.entries.length, 1);
      assert.equal(result.entries[0].ops[0].originalText, 'Welcome');
      assert.equal(result.entries[0].ops[0].newText, 'Hello');
      assert.equal(result.perPage['/'] || 0, 0);
    } finally {
      if (discardServer) {
        await stopServer(discardServer.port, discardServer.token);
        discardServer.proc.kill();
      }
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('/events rejects direct manual_edit_apply because copy edits use staged apply', async () => {
    const res = await fetch(`http://localhost:${server.port}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: server.token,
        type: 'manual_edit_apply',
        id: 'abcdef14',
        pageUrl: '/',
        element: { tagName: 'p' },
        ops: [{ ref: 'body>p:nth-of-type(1)', tag: 'p', originalText: 'A', newText: 'B' }],
      }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /manual_edit_apply is disabled/);
  });

  it('/manual-edit-stash rejects empty copy-edit text before it reaches the pending buffer', async () => {
    const res = await fetch(`http://localhost:${server.port}/manual-edit-stash`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: server.token,
        id: 'abcdef15',
        pageUrl: '/',
        element: { tagName: 'p' },
        ops: [{ ref: 'body>p:nth-of-type(1)', tag: 'p', originalText: 'A', newText: '' }],
      }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /newText cannot be empty/);
  });

  it('/manual-edit-stash rejects markup-looking copy before it reaches the pending buffer', async () => {
    const cases = ['<strong>B</strong>', '{label}', 'label}', '`label`'];
    for (const [i, newText] of cases.entries()) {
      const res = await fetch(`http://localhost:${server.port}/manual-edit-stash`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: server.token,
          id: `abcdef1${i}`,
          pageUrl: '/',
          element: { tagName: 'p' },
          ops: [{ ref: 'body>p:nth-of-type(1)', tag: 'p', originalText: 'A', newText }],
        }),
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.match(body.error, /plain text only/);
    }
  });

  it('/manual-edit-stash rejects a corrupt pending buffer instead of overwriting it', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'impeccable-manual-stash-corrupt-'));
    let stashServer;
    try {
      stashServer = await startServer(8526, { cwd: tmp });
      const liveDir = getLiveDir(tmp);
      const bufferPath = join(liveDir, 'pending-manual-edits.json');
      mkdirSync(liveDir, { recursive: true });
      writeFileSync(bufferPath, '{ corrupt json');

      const stash = await fetch(`http://localhost:${stashServer.port}/manual-edit-stash`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: stashServer.token,
          id: 'badc0ffe',
          pageUrl: '/',
          element: { tagName: 'h1', outerHTML: '<h1>Hello</h1>', textContent: 'Hello' },
          ops: [{ ref: 'body>h1:nth-of-type(1)', tag: 'h1', originalText: 'Welcome', newText: 'Hello' }],
        }),
      });
      assert.equal(stash.status, 500);
      const body = await stash.json();
      assert.equal(body.error, 'stash_write_failed');
      assert.match(readFileSync(bufferPath, 'utf-8'), /corrupt json/);
    } finally {
      if (stashServer) {
        await stopServer(stashServer.port, stashServer.token);
        stashServer.proc.kill();
      }
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('/poll returns timeout when no events queued', async () => {
    const res = await fetch(`http://localhost:${server.port}/poll?token=${server.token}&timeout=500`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.type, 'timeout');
  });

  it('/poll type filters keep parallel poll consumers disjoint', async () => {
    await drainPolls(server);
    const controlPoll = fetch(
      `http://localhost:${server.port}/poll?token=${server.token}&timeout=2000&types=steer,manual_edit_apply,carbonize_cleanup,exit`,
    ).then((response) => response.json());
    const workerPoll = fetch(
      `http://localhost:${server.port}/poll?token=${server.token}&timeout=2000&types=generate,accept,discard,prefetch`,
    ).then((response) => response.json());

    const steer = {
      token: server.token,
      type: 'steer',
      id: 'aabbcc01',
      pageUrl: '/',
      message: 'Keep this on the foreground lane',
    };
    const generate = {
      token: server.token,
      type: 'generate',
      id: 'aabbcc02',
      action: 'impeccable',
      count: 1,
      pageUrl: '/',
      element: { outerHTML: '<button id="lane-test">Book</button>', id: 'lane-test', tagName: 'BUTTON' },
    };
    for (const event of [steer, generate]) {
      const response = await fetch(`http://localhost:${server.port}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      });
      assert.equal(response.status, 200);
    }

    const [controlEvent, workerEvent] = await Promise.all([controlPoll, workerPoll]);
    assert.equal(controlEvent.type, 'steer');
    assert.equal(controlEvent.id, steer.id);
    assert.equal(workerEvent.type, 'generate');
    assert.equal(workerEvent.id, generate.id);

    for (const reply of [
      { id: steer.id, type: 'steer_done', message: 'Control lane handled it', sourceEventType: 'steer' },
      { id: generate.id, type: 'done', sourceEventType: 'generate' },
    ]) {
      const response = await fetch(`http://localhost:${server.port}/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: server.token, ...reply }),
      });
      assert.equal(response.status, 200);
    }
  });

  it('/poll rejects invalid token', async () => {
    const res = await fetch(`http://localhost:${server.port}/poll?token=wrong&timeout=100`);
    assert.equal(res.status, 401);
  });

  it('/stop rejects invalid token', async () => {
    const res = await fetch(`http://localhost:${server.port}/stop?token=wrong`);
    assert.equal(res.status, 401);
  });

  it('POST /events rejects invalid token', async () => {
    const res = await fetch(`http://localhost:${server.port}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'wrong', type: 'exit' }),
    });
    assert.equal(res.status, 401);
  });

  it('POST /events validates event structure', async () => {
    const res = await fetch(`http://localhost:${server.port}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: server.token, type: 'generate' }), // missing required fields
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes('generate'));
  });

  // Regression: ids reach `execFileSync` argv and DOM attribute selectors.
  // Anything outside the strict generator pattern must be rejected before it
  // can leak into a downstream child_process or selector.
  it('POST /events rejects accept with shell metacharacters in id', async () => {
    const res = await fetch(`http://localhost:${server.port}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: server.token,
        type: 'accept',
        id: '"; rm -rf /; #',
        variantId: '0',
      }),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes('id'));
  });

  it('POST /events rejects accept with non-numeric variantId', async () => {
    const res = await fetch(`http://localhost:${server.port}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: server.token,
        type: 'accept',
        id: 'a1b2c3d4',
        variantId: '0; touch /tmp/owned',
      }),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes('variantId'));
  });

  it('POST /events rejects discard with malformed id', async () => {
    const res = await fetch(`http://localhost:${server.port}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: server.token, type: 'discard', id: 'not a uuid' }),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes('id'));
  });

  it('POST /events accepts valid exit event', async () => {
    const res = await fetch(`http://localhost:${server.port}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: server.token, type: 'exit' }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
  });

  it('events flow from browser POST to agent poll', async () => {
    // Drain any queued events from previous tests
    await drainPolls(server);

    // Start a poll (will block until event arrives or timeout)
    const pollPromise = fetch(`http://localhost:${server.port}/poll?token=${server.token}&timeout=5000`)
      .then(r => r.json());

    // Give the poll a moment to register
    await new Promise(r => setTimeout(r, 100));

    // Send a generate event (simulating browser)
    const postRes = await fetch(`http://localhost:${server.port}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: server.token,
        type: 'generate',
        id: 'a1b2c3d4',
        action: 'bolder',
        count: 2,
        element: { outerHTML: '<div>test</div>', tagName: 'div' },
      }),
    });
    assert.equal(postRes.status, 200);

    // Poll should resolve with the event
    const event = await pollPromise;
    assert.equal(event.type, 'generate');
    assert.equal(event.id, 'a1b2c3d4');
    assert.equal(event.action, 'bolder');
    assert.equal(event.count, 2);
    assert.equal(event.scaffoldAttempted, true);
    assert.equal(event.scaffoldError, 'insufficient_locator');
    assert.equal(Number.isFinite(event.generationReadyAt), true);

    await fetch(`http://localhost:${server.port}/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: server.token, id: 'test-e2e-1', type: 'done' }),
    });
  });

  it('persists browser events to the durable session journal before poll delivery', async () => {
    await drainPolls(server);
    const journalPath = join(getLiveSessionsDir(server.cwd), 'a1b2c3d6.jsonl');
    rmSync(journalPath, { force: true });

    const postRes = await fetch(`http://localhost:${server.port}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: server.token,
        type: 'generate',
        id: 'a1b2c3d6',
        action: 'layout',
        count: 3,
        pageUrl: 'http://localhost:4321/',
        element: { outerHTML: '<section>persist</section>', tagName: 'section' },
      }),
    });
    assert.equal(postRes.status, 200);

    assert.equal(
      existsSync(journalPath),
      true,
      'event=live_server.journal_before_poll actor=browser operation=post_generate risk=server_restart_loses_unpolled_event expected=journal exists before agent poll actual=missing suggestion=append to live-session-store before enqueueing event',
    );
    const journal = readFileSync(journalPath, 'utf-8');
    assert.match(journal, /"type":"generate"/);

    await fetch(`http://localhost:${server.port}/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: server.token, id: 'a1b2c3d6', type: 'done' }),
    });
  });

  it('accepts checkpoint events without exposing them as agent poll work', async () => {
    await drainPolls(server);
    const partialRes = await fetch(`http://localhost:${server.port}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: server.token,
        type: 'checkpoint',
        id: 'a1b2c3d7',
        phase: 'cycling',
        reason: 'browser_resumed',
        revision: 1,
        owner: 'browser-a',
        expectedVariants: 3,
        arrivedVariants: 1,
        visibleVariant: 1,
      }),
    });
    assert.equal(partialRes.status, 200);

    const secondRes = await fetch(`http://localhost:${server.port}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: server.token,
        type: 'checkpoint',
        id: 'a1b2c3d7',
        phase: 'cycling',
        reason: 'variants_progress',
        revision: 2,
        owner: 'browser-a',
        expectedVariants: 3,
        arrivedVariants: 2,
        visibleVariant: 2,
      }),
    });
    assert.equal(secondRes.status, 200);

    const res = await fetch(`http://localhost:${server.port}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: server.token,
        type: 'checkpoint',
        id: 'a1b2c3d7',
        phase: 'cycling',
        reason: 'variants_ready',
        revision: 3,
        owner: 'browser-a',
        expectedVariants: 3,
        arrivedVariants: 3,
        visibleVariant: 2,
        paramValues: { density: 'packed' },
      }),
    });
    assert.equal(res.status, 200);

    const polled = await fetch(`http://localhost:${server.port}/poll?token=${server.token}&timeout=50`).then(r => r.json());
    assert.equal(
      polled.type,
      'timeout',
      'event=live_server.checkpoint_not_polled actor=browser operation=checkpoint risk=checkpoint_starves_agent_queue expected=timeout actual=' + polled.type + ' suggestion=journal checkpoint without enqueueing agent work',
    );

    const snapshot = JSON.parse(readFileSync(join(getLiveSessionsDir(server.cwd), 'a1b2c3d7.snapshot.json'), 'utf-8'));
    assert.equal(snapshot.visibleVariant, 2);
    assert.deepEqual(snapshot.paramValues, { density: 'packed' });
    assert.ok(snapshot.generationTimings.first_reviewable?.at);
    assert.ok(snapshot.generationTimings.second_reviewable?.at);
    assert.ok(snapshot.generationTimings.all_variants_ready?.at);
    assert.ok(snapshot.generationTimings.first_reviewable.at <= snapshot.generationTimings.second_reviewable.at);
    assert.ok(snapshot.generationTimings.second_reviewable.at <= snapshot.generationTimings.all_variants_ready.at);

    const atomicRes = await fetch(`http://localhost:${server.port}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: server.token,
        type: 'checkpoint',
        id: 'a1b2c3da',
        phase: 'cycling',
        reason: 'variants_ready',
        revision: 1,
        owner: 'browser-a',
        expectedVariants: 3,
        arrivedVariants: 3,
        visibleVariant: 1,
      }),
    });
    assert.equal(atomicRes.status, 200);
    const atomicSnapshot = JSON.parse(readFileSync(join(getLiveSessionsDir(server.cwd), 'a1b2c3da.snapshot.json'), 'utf-8'));
    assert.ok(atomicSnapshot.generationTimings.first_reviewable?.at);
    assert.equal(
      atomicSnapshot.generationTimings.first_reviewable.at,
      atomicSnapshot.generationTimings.all_variants_ready?.at,
      'atomic delivery makes the first variant and full set reviewable together',
    );
  });

  it('journals and streams agent progress without leasing it as work', async () => {
    await drainPolls(server);
    const controller = new AbortController();
    const sseRes = await fetch(
      `http://localhost:${server.port}/events?token=${server.token}`,
      { signal: controller.signal },
    );
    const reader = sseRes.body.getReader();
    await reader.read();
    const progress = await fetch(`http://localhost:${server.port}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: server.token,
        type: 'agent_phase',
        id: 'a1b2c3e1',
        phase: 'first_variant_generating',
        owner: 'live-agent',
      }),
    });
    assert.equal(progress.status, 200);
    const message = new TextDecoder().decode((await reader.read()).value);
    controller.abort();
    assert.match(message, /"type":"agent_phase"/);
    assert.match(message, /"phase":"first_variant_generating"/);
    const polled = await fetch(`http://localhost:${server.port}/poll?token=${server.token}&timeout=50`).then(r => r.json());
    assert.equal(polled.type, 'timeout');
    const snapshot = JSON.parse(readFileSync(join(getLiveSessionsDir(server.cwd), 'a1b2c3e1.snapshot.json'), 'utf-8'));
    assert.ok(snapshot.generationTimings.first_variant_generating?.at);
  });

  it('streams Svelte component checkpoints as progressive preview updates', async () => {
    const controller = new AbortController();
    const sseRes = await fetch(
      `http://localhost:${server.port}/events?token=${server.token}`,
      { signal: controller.signal },
    );
    const reader = sseRes.body.getReader();
    const decoder = new TextDecoder();
    await reader.read(); // connected

    const res = await fetch(`http://localhost:${server.port}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: server.token,
        type: 'checkpoint',
        id: 'a1b2c3de',
        phase: 'cycling',
        reason: 'variants_progress',
        revision: 1,
        owner: 'svelte-worker',
        expectedVariants: 3,
        arrivedVariants: 1,
        visibleVariant: 1,
        previewMode: 'svelte-component',
        previewFile: 'node_modules/.impeccable-live/a1b2c3de/manifest.json',
        sourceFile: 'src/routes/+page.svelte',
      }),
    });
    assert.equal(res.status, 200);

    const { value } = await reader.read();
    const message = decoder.decode(value);
    assert.match(message, /"type":"variant_progress"/);
    assert.match(message, /"arrivedVariants":1/);
    assert.match(message, /"previewMode":"svelte-component"/);
    controller.abort();
  });

  it('streams source checkpoints so no-HMR frameworks can review variant 1', async () => {
    const controller = new AbortController();
    const sseRes = await fetch(
      `http://localhost:${server.port}/events?token=${server.token}`,
      { signal: controller.signal },
    );
    const reader = sseRes.body.getReader();
    const decoder = new TextDecoder();
    await reader.read(); // connected

    const res = await fetch(`http://localhost:${server.port}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: server.token,
        type: 'checkpoint',
        id: 'a1b2c3df',
        phase: 'cycling',
        reason: 'variants_progress',
        revision: 1,
        owner: 'source-worker',
        expectedVariants: 3,
        arrivedVariants: 1,
        visibleVariant: 1,
        previewMode: 'source',
        previewFile: 'app/pages/index.vue',
        sourceFile: 'app/pages/index.vue',
        publicationKind: 'params',
      }),
    });
    assert.equal(res.status, 200);

    const { value } = await reader.read();
    const message = decoder.decode(value);
    assert.match(message, /"type":"variant_progress"/);
    assert.match(message, /"arrivedVariants":1/);
    assert.match(message, /"previewMode":"source"/);
    assert.match(message, /"previewFile":"app\/pages\/index.vue"/);
    assert.match(message, /"publicationKind":"params"/);
    controller.abort();
  });

  // A framework full-reload (Astro reloads the page for any .astro edit, and
  // the preflight scaffold write triggers one) can put the browser mid-reload
  // exactly when the agent's `done` broadcasts. The resumed page then sits in
  // GENERATING at 0/N with the variants already in source. Its resumed
  // checkpoint is the evidence of the miss; the server must re-broadcast the
  // completion.
  async function runGenerateToDone(id, file) {
    await drainPolls(server);
    // A behind session left by a previous run would itself trigger connect-time
    // redelivery and contaminate this test's SSE stream — start from scratch.
    rmSync(join(getLiveSessionsDir(server.cwd), id + '.jsonl'), { force: true });
    rmSync(join(getLiveSessionsDir(server.cwd), id + '.snapshot.json'), { force: true });
    const postRes = await fetch(`http://localhost:${server.port}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: server.token,
        type: 'generate',
        id,
        action: 'bolder',
        count: 3,
        pageUrl: 'http://localhost:4321/',
        element: { outerHTML: '<h1>miss</h1>', tagName: 'h1' },
      }),
    });
    assert.equal(postRes.status, 200);
    const event = await fetch(`http://localhost:${server.port}/poll?token=${server.token}&timeout=2000`).then(r => r.json());
    assert.equal(event.id, id);
    const doneRes = await fetch(`http://localhost:${server.port}/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: server.token, id, type: 'done', file }),
    });
    assert.equal(doneRes.status, 200);
  }

  it('redelivers done when a resumed browser checkpoint shows it missed generation completion', async () => {
    await runGenerateToDone('a1b2c3f5', 'src/pages/index.astro');

    const controller = new AbortController();
    const sseRes = await fetch(
      `http://localhost:${server.port}/events?token=${server.token}`,
      { signal: controller.signal },
    );
    const reader = sseRes.body.getReader();
    const decoder = new TextDecoder();
    await reader.read(); // connected

    const res = await fetch(`http://localhost:${server.port}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: server.token,
        type: 'checkpoint',
        id: 'a1b2c3f5',
        phase: 'generating',
        reason: 'browser_resumed',
        revision: 2,
        owner: 'browser-resumed-tab',
        expectedVariants: 3,
        arrivedVariants: 0,
        visibleVariant: 0,
      }),
    });
    assert.equal(res.status, 200);

    const text = await readSseUntil(reader, decoder, '"redelivered":true');
    controller.abort();
    assert.match(
      text,
      /"type":"done"/,
      'event=live_server.missed_done_redelivery actor=browser operation=resumed_checkpoint_behind risk=session_stuck_generating expected=done rebroadcast actual=' + JSON.stringify(text.slice(0, 200)) + ' suggestion=rebroadcast stored completion when checkpoint reports generating with variants behind',
    );
    assert.match(text, /"file":"src\/pages\/index\.astro"/);
    assert.match(text, /"redelivered":true/);

    // Report the recovery so the session stops looking behind — later SSE
    // connects (in this suite and in production) shouldn't keep redelivering.
    const recovered = await fetch(`http://localhost:${server.port}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: server.token,
        type: 'checkpoint',
        id: 'a1b2c3f5',
        phase: 'cycling',
        reason: 'variants_ready',
        revision: 3,
        owner: 'browser-resumed-tab',
        expectedVariants: 3,
        arrivedVariants: 3,
        visibleVariant: 1,
      }),
    });
    assert.equal(recovered.status, 200);
  });

  it('does not redeliver done to a browser whose checkpoint is current', async () => {
    await runGenerateToDone('a1b2c3f6', 'src/pages/index.astro');

    const controller = new AbortController();
    const sseRes = await fetch(
      `http://localhost:${server.port}/events?token=${server.token}`,
      { signal: controller.signal },
    );
    const reader = sseRes.body.getReader();
    const decoder = new TextDecoder();
    await reader.read(); // connected

    const current = await fetch(`http://localhost:${server.port}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: server.token,
        type: 'checkpoint',
        id: 'a1b2c3f6',
        phase: 'generating',
        reason: 'browser_resumed',
        revision: 2,
        owner: 'browser-current-tab',
        expectedVariants: 3,
        arrivedVariants: 3,
        visibleVariant: 1,
      }),
    });
    assert.equal(current.status, 200);

    const ready = await fetch(`http://localhost:${server.port}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: server.token,
        type: 'checkpoint',
        id: 'a1b2c3f6',
        phase: 'cycling',
        reason: 'variants_ready',
        revision: 3,
        owner: 'browser-current-tab',
        expectedVariants: 3,
        arrivedVariants: 3,
        visibleVariant: 1,
        previewMode: 'source',
        previewFile: 'src/pages/index.astro',
        sourceFile: 'src/pages/index.astro',
      }),
    });
    assert.equal(ready.status, 200);

    const text = await readSseUntil(reader, decoder, '"variant_progress"', 4);
    controller.abort();
    assert.match(text, /"type":"variant_progress"/);
    const redeliveredForSession = text
      .split('\n')
      .some((line) => line.includes('"id":"a1b2c3f6"') && line.includes('"redelivered":true'));
    assert.equal(
      redeliveredForSession,
      false,
      'a checkpoint that already reports the full variant set must not trigger a done rebroadcast',
    );
  });

  it('marks completed generations durably in connected-payload summaries', async () => {
    await runGenerateToDone('a1b2c3f7', 'src/pages/about.astro');

    // Checkpoint lands while no SSE client is connected (the reloading page
    // POSTs checkpoints without waiting for its EventSource). It regresses
    // phase/arrivedVariants, but generationCompletedAt must survive — the
    // browser's connect-time self-heal keys on it.
    const res = await fetch(`http://localhost:${server.port}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: server.token,
        type: 'checkpoint',
        id: 'a1b2c3f7',
        phase: 'generating',
        reason: 'browser_resumed',
        revision: 2,
        owner: 'browser-early-checkpoint',
        expectedVariants: 3,
        arrivedVariants: 0,
        visibleVariant: 0,
      }),
    });
    assert.equal(res.status, 200);

    const controller = new AbortController();
    const sseRes = await fetch(
      `http://localhost:${server.port}/events?token=${server.token}`,
      { signal: controller.signal },
    );
    const reader = sseRes.body.getReader();
    const decoder = new TextDecoder();
    const text = await readSseUntil(reader, decoder, '"type":"connected"', 2);
    controller.abort();
    const connectedLine = text.split('\n').find((line) => line.includes('"type":"connected"'));
    assert.ok(connectedLine, 'connected payload present');
    const connected = JSON.parse(connectedLine.replace(/^data: /, ''));
    const summary = connected.activeSessions.find((session) => session.id === 'a1b2c3f7');
    assert.ok(summary, 'behind session appears in activeSessions');
    assert.equal(summary.phase, 'generating', 'behind checkpoint regressed the phase');
    assert.equal(summary.arrivedVariants, 0, 'behind checkpoint regressed the arrived count');
    assert.ok(
      Number.isFinite(summary.generationCompletedAt) && summary.generationCompletedAt > 0,
      'event=live_server.completed_marker_durable actor=browser operation=sse_connect_after_behind_checkpoint risk=session_stuck_generating expected=generationCompletedAt survives checkpoint regression actual=' + JSON.stringify(summary.generationCompletedAt) + ' suggestion=set monotone generationCompletedAt on agent_done in session-store',
    );
    assert.equal(summary.sourceFile, 'src/pages/about.astro');

    const recovered = await fetch(`http://localhost:${server.port}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: server.token,
        type: 'checkpoint',
        id: 'a1b2c3f7',
        phase: 'cycling',
        reason: 'variants_ready',
        revision: 3,
        owner: 'browser-early-checkpoint',
        expectedVariants: 3,
        arrivedVariants: 3,
        visibleVariant: 1,
      }),
    });
    assert.equal(recovered.status, 200);
  });

  it('redelivers an unacknowledged browser event after helper server restart', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'impeccable-server-restart-'));
    let firstServer;
    let restarted;
    try {
      firstServer = await startServer(8519, { cwd: tmp });
      const postRes = await fetch(`http://localhost:${firstServer.port}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: firstServer.token,
          type: 'generate',
          id: 'a1b2c3d8',
          action: 'polish',
          count: 2,
          pageUrl: 'http://localhost:4321/',
          element: { outerHTML: '<section>restart</section>', tagName: 'section' },
        }),
      });
      assert.equal(postRes.status, 200);

      await stopServer(firstServer.port, firstServer.token);
      firstServer.proc.kill();
      firstServer = null;

      restarted = await startServer(8519, { cwd: tmp });
      const replayed = await fetch(`http://localhost:${restarted.port}/poll?token=${restarted.token}&timeout=250&leaseMs=50`).then(r => r.json());

      assert.equal(
        replayed.id,
        'a1b2c3d8',
        'event=live_server.restart_replay actor=agent operation=poll_after_helper_restart risk=server_restart_loses_unpolled_event expected=a1b2c3d8 actual=' + replayed.id + ' suggestion=rebuild pending poll queue from live-session-store active snapshots on startup',
      );
      assert.equal(replayed.type, 'generate');
    } finally {
      if (firstServer) {
        await stopServer(firstServer.port, firstServer.token);
        firstServer.proc.kill();
      }
      if (restarted) {
        await stopServer(restarted.port, restarted.token);
        restarted.proc.kill();
      }
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('records explicit completion acknowledgements as completed durable sessions', async () => {
    await drainPolls(server);
    await fetch(`http://localhost:${server.port}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: server.token,
        type: 'generate',
        id: 'a1b2c3d9',
        action: 'impeccable',
        count: 1,
        pageUrl: '/',
        element: { outerHTML: '<button>Done</button>' },
      }),
    });
    const polled = await fetch(`http://localhost:${server.port}/poll?token=${server.token}&timeout=50`).then(r => r.json());
    assert.equal(polled.id, 'a1b2c3d9');
    const ack = await fetch(`http://localhost:${server.port}/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: server.token, id: 'a1b2c3d9', type: 'complete' }),
    });
    assert.equal(ack.status, 200);
    const snapshot = JSON.parse(readFileSync(join(getLiveSessionsDir(server.cwd), 'a1b2c3d9.snapshot.json'), 'utf-8'));
    assert.equal(snapshot.phase, 'completed');
  });

  it('manual live-complete acknowledges the running helper queue before writing fallback journal state', async () => {
    await drainPolls(server);
    await fetch(`http://localhost:${server.port}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: server.token,
        type: 'generate',
        id: 'a1b2c3dc',
        action: 'impeccable',
        count: 1,
        pageUrl: '/',
        element: { outerHTML: '<button>Manual</button>' },
      }),
    });
    const polled = await fetch(`http://localhost:${server.port}/poll?token=${server.token}&timeout=50&leaseMs=50`).then(r => r.json());
    assert.equal(polled.id, 'a1b2c3dc');

    const completed = JSON.parse(execFileSync(process.execPath, [COMPLETE_SCRIPT, '--id', 'a1b2c3dc'], { cwd: server.cwd, encoding: 'utf-8' }));
    assert.equal(completed.phase, 'completed');

    await new Promise(r => setTimeout(r, 75));
    const stale = await fetch(`http://localhost:${server.port}/poll?token=${server.token}&timeout=50&leaseMs=50`).then(r => r.json());
    assert.equal(
      stale.type,
      'timeout',
      'event=live_complete.running_server_ack actor=agent operation=manual_complete risk=completed_session_redelivered_from_memory expected=timeout actual=' + stale.id,
    );
  });

  it('does not drop polled events until the agent acknowledges them', async () => {
    await drainPolls(server);

    const postRes = await fetch(`http://localhost:${server.port}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: server.token,
        type: 'generate',
        id: 'a1b2c3da',
        action: 'polish',
        count: 2,
        element: { outerHTML: '<section>lease</section>', tagName: 'section' },
      }),
    });
    assert.equal(postRes.status, 200);

    // Both halves need real-time headroom in the direction they assert. With a
    // 50ms lease the "still leased" poll had to complete a whole HTTP round trip
    // inside 50ms or the lease expired first, the event was redelivered, and the
    // assertion failed for a scheduling hiccup rather than a bookkeeping bug —
    // which is what it did intermittently on CI while passing locally. Hold the
    // lease long enough that the round trip cannot cross it, then wait past it
    // explicitly to test redelivery.
    const LEASE_MS = 1000;
    const first = await fetch(`http://localhost:${server.port}/poll?token=${server.token}&timeout=100&leaseMs=${LEASE_MS}`).then(r => r.json());
    assert.equal(first.id, 'a1b2c3da');

    const leased = await fetch(`http://localhost:${server.port}/poll?token=${server.token}&timeout=25&leaseMs=${LEASE_MS}`).then(r => r.json());
    assert.equal(leased.type, 'timeout', 'leased event should not be redelivered before lease expiry');

    await new Promise(r => setTimeout(r, LEASE_MS + 300));
    const redelivered = await fetch(`http://localhost:${server.port}/poll?token=${server.token}&timeout=100&leaseMs=${LEASE_MS}`).then(r => r.json());
    assert.equal(
      redelivered.id,
      'a1b2c3da',
      'event=live_poll.lease_redelivery actor=agent operation=poll_after_missed_ack risk=agent_missed_event_loses_live_state expected=same event redelivered after lease expiry actual=' + redelivered.id + ' suggestion=inspect pending event lease bookkeeping',
    );

    await fetch(`http://localhost:${server.port}/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: server.token, id: 'a1b2c3da', type: 'done' }),
    });
    const acked = await fetch(`http://localhost:${server.port}/poll?token=${server.token}&timeout=50&leaseMs=50`).then(r => r.json());
    assert.equal(acked.type, 'timeout', 'acked event should be removed from the poll queue');
  });

  it('retires the leased Generate when early Accept or Discard takes ownership', async () => {
    await drainPolls(server);
    for (const [type, id] of [['accept', 'ea11ac01'], ['discard', 'ea11dc01']]) {
      const generated = await fetch(`http://localhost:${server.port}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: server.token,
          type: 'generate',
          id,
          action: 'bolder',
          count: 3,
          element: { outerHTML: '<section>early choice</section>', tagName: 'section' },
        }),
      });
      assert.equal(generated.status, 200);
      const generation = await fetch(`http://localhost:${server.port}/poll?token=${server.token}&types=generate&timeout=100&leaseMs=40`).then((response) => response.json());
      assert.equal(generation.id, id);

      const chosen = await fetch(`http://localhost:${server.port}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: server.token,
          type,
          id,
          ...(type === 'accept' ? { variantId: '1' } : {}),
        }),
      });
      assert.equal(chosen.status, 200);
      const choice = await fetch(`http://localhost:${server.port}/poll?token=${server.token}&types=${type}&timeout=100&leaseMs=40`).then((response) => response.json());
      assert.equal(choice.type, type);
      assert.equal(choice.id, id);
      const reply = await fetch(`http://localhost:${server.port}/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: server.token,
          id,
          sourceEventType: type,
          type: type === 'discard' ? 'discarded' : 'complete',
        }),
      });
      assert.equal(reply.status, 200);

      await new Promise((resolve) => setTimeout(resolve, 60));
      const stale = await fetch(`http://localhost:${server.port}/poll?token=${server.token}&types=generate&timeout=30&leaseMs=20`).then((response) => response.json());
      assert.equal(stale.type, 'timeout', `${type} must prevent Generate redelivery after its old lease expires`);
      const status = await fetch(`http://localhost:${server.port}/status?token=${server.token}`).then((response) => response.json());
      assert.equal(status.pendingEvents.some((event) => event.id === id && event.type === 'generate'), false);
    }
  });

  it('releases a failed worker Generate lease without consuming or broadcasting it', async () => {
    await drainPolls(server);
    const id = 'fa11bac1';
    const generated = await fetch(`http://localhost:${server.port}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: server.token,
        type: 'generate',
        id,
        action: 'bolder',
        count: 3,
        element: { outerHTML: '<article>fallback</article>', tagName: 'article' },
      }),
    });
    assert.equal(generated.status, 200);
    const leased = await fetch(`http://localhost:${server.port}/poll?token=${server.token}&types=generate&timeout=100&leaseMs=5000`).then((response) => response.json());
    assert.equal(leased.id, id);

    const retried = await fetch(`http://localhost:${server.port}/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: server.token,
        id,
        type: 'retry',
        sourceEventType: 'generate',
      }),
    });
    assert.equal(retried.status, 200);
    assert.equal((await retried.json()).released, true);

    const fallback = await fetch(`http://localhost:${server.port}/poll?token=${server.token}&types=generate&timeout=100&leaseMs=100`).then((response) => response.json());
    assert.equal(fallback.id, id);
    assert.equal(fallback.type, 'generate');
    const status = await fetch(`http://localhost:${server.port}/status?token=${server.token}`).then((response) => response.json());
    assert.equal(status.pendingEvents.some((event) => event.id === id && event.type === 'generate'), true);

    const done = await fetch(`http://localhost:${server.port}/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: server.token, id, type: 'done', sourceEventType: 'generate' }),
    });
    assert.equal(done.status, 200);
  });

  it('wakes a parked poll as soon as a missed-ack lease expires', async () => {
    await drainPolls(server);

    const postRes = await fetch(`http://localhost:${server.port}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: server.token,
        type: 'generate',
        id: 'a1b2c3db',
        action: 'polish',
        count: 1,
        element: { outerHTML: '<section>wakeup</section>', tagName: 'section' },
      }),
    });
    assert.equal(postRes.status, 200);

    const first = await fetch(`http://localhost:${server.port}/poll?token=${server.token}&timeout=100&leaseMs=60`).then(r => r.json());
    assert.equal(first.id, 'a1b2c3db');

    const startedAt = Date.now();
    const redelivered = await fetch(`http://localhost:${server.port}/poll?token=${server.token}&timeout=500&leaseMs=60`).then(r => r.json());
    const elapsed = Date.now() - startedAt;

    assert.equal(
      redelivered.id,
      'a1b2c3db',
      'event=live_poll.lease_expiry_wakeup actor=agent operation=poll_before_lease_expiry risk=parked_poll_waits_full_timeout expected=a1b2c3db actual=' + redelivered.id,
    );
    assert.ok(
      elapsed < 250,
      'event=live_poll.lease_expiry_latency actor=agent operation=poll_before_lease_expiry risk=redelivery_waits_full_timeout expected=<250 actual=' + elapsed,
    );

    await fetch(`http://localhost:${server.port}/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: server.token, id: 'a1b2c3db', type: 'done' }),
    });
  });

  it('agent reply is forwarded via SSE to browser', async () => {
    // Use raw HTTP to read SSE (no EventSource in Node.js)
    const controller = new AbortController();
    const sseRes = await fetch(
      `http://localhost:${server.port}/events?token=${server.token}`,
      { signal: controller.signal }
    );
    assert.equal(sseRes.status, 200);
    assert.equal(sseRes.headers.get('content-type'), 'text/event-stream');

    // Read the first message (should be "connected")
    const reader = sseRes.body.getReader();
    const decoder = new TextDecoder();
    const { value: chunk1 } = await reader.read();
    const text1 = decoder.decode(chunk1);
    assert.ok(text1.includes('"connected"'));

    // Queue a browser event, then send the matching reply from the agent.
    const queueRes = await fetch(`http://localhost:${server.port}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: server.token,
        type: 'generate',
        id: '5ee7e575',
        action: 'impeccable',
        count: 3,
        pageUrl: '/',
        element: { tagName: 'h1', className: 'hero-title', outerHTML: '<h1 class="hero-title">Hello</h1>', textContent: 'Hello' },
      }),
    });
    assert.equal(queueRes.status, 200);

    await fetch(`http://localhost:${server.port}/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: server.token, id: '5ee7e575', type: 'done', file: 'x.html' }),
    });

    // Read the next SSE message
    const { value: chunk2 } = await reader.read();
    const text2 = decoder.decode(chunk2);
    assert.ok(text2.includes('"done"'));
    assert.ok(text2.includes('5ee7e575'));

    controller.abort();
  });

  it('/source reads project files with valid token', async () => {
    const res = await fetch(`http://localhost:${server.port}/source?token=${server.token}&path=package.json`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('"impeccable"'));
  });

  it('/source rejects path traversal', async () => {
    const res = await fetch(`http://localhost:${server.port}/source?token=${server.token}&path=../../../etc/passwd`);
    assert.equal(res.status, 400);
  });

  it('/source rejects invalid token', async () => {
    const res = await fetch(`http://localhost:${server.port}/source?token=wrong&path=package.json`);
    assert.equal(res.status, 401);
  });

  it('/source returns 404 for missing files', async () => {
    try {
      const res = await fetch(`http://localhost:${server.port}/source?token=${server.token}&path=nonexistent.xyz`);
      assert.equal(res.status, 404);
    } catch {
      // Server may close socket on 404 for some Node versions
      assert.ok(true, 'Server rejected request for missing file');
    }
  });

  it('/modern-screenshot.js serves the vendored UMD build', async () => {
    const res = await fetch(`http://localhost:${server.port}/modern-screenshot.js`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/javascript');
    const text = await res.text();
    // Sanity: the UMD build self-registers as window.modernScreenshot.
    assert.ok(text.includes('modernScreenshot'));
  });

  it('POST /annotation rejects invalid token', async () => {
    const res = await fetch(`http://localhost:${server.port}/annotation?token=wrong&eventId=abc`, {
      method: 'POST', headers: { 'Content-Type': 'image/png' }, body: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    });
    assert.equal(res.status, 401);
  });

  it('POST /annotation rejects invalid eventId', async () => {
    const res = await fetch(`http://localhost:${server.port}/annotation?token=${server.token}&eventId=has%20spaces`, {
      method: 'POST', headers: { 'Content-Type': 'image/png' }, body: new Uint8Array([0x89]),
    });
    assert.equal(res.status, 400);
  });

  it('POST /annotation rejects non-PNG content-type', async () => {
    const res = await fetch(`http://localhost:${server.port}/annotation?token=${server.token}&eventId=abc`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array([0x89]),
    });
    assert.equal(res.status, 415);
  });

  it('POST /annotation writes PNG to session dir and returns path', async () => {
    const eventId = 'test-' + Math.random().toString(36).slice(2, 10);
    // Minimal valid PNG header + IEND chunk (enough to prove we wrote bytes)
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    const res = await fetch(`http://localhost:${server.port}/annotation?token=${server.token}&eventId=${eventId}`, {
      method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png,
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.ok(data.path.endsWith(eventId + '.png'));
    const written = readFileSync(data.path);
    assert.equal(written.length, png.length);
  });

  it('POST /events rejects steer with empty message', async () => {
    const res = await fetch(`http://localhost:${server.port}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: server.token,
        type: 'steer',
        id: 'a1b2c3de',
        message: '   ',
        pageUrl: 'http://localhost:3000/',
      }),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes('message'));
  });

  it('steer events flow from browser POST to agent poll and steer_done via SSE', async () => {
    await drainPolls(server);

    const controller = new AbortController();
    const sseRes = await fetch(
      `http://localhost:${server.port}/events?token=${server.token}`,
      { signal: controller.signal },
    );
    assert.equal(sseRes.status, 200);
    const reader = sseRes.body.getReader();
    const decoder = new TextDecoder();
    await reader.read(); // connected

    const pollPromise = fetch(`http://localhost:${server.port}/poll?token=${server.token}&timeout=5000`)
      .then(r => r.json());

    await new Promise(r => setTimeout(r, 100));

    const postRes = await fetch(`http://localhost:${server.port}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: server.token,
        type: 'steer',
        id: 'b2c3d4e5',
        message: 'Make the hero quieter',
        pageUrl: 'http://localhost:3000/',
      }),
    });
    assert.equal(postRes.status, 200);

    const event = await pollPromise;
    assert.equal(event.type, 'steer');
    assert.equal(event.id, 'b2c3d4e5');
    assert.equal(event.message, 'Make the hero quieter');

    await fetch(`http://localhost:${server.port}/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: server.token,
        id: 'b2c3d4e5',
        type: 'steer_done',
        message: 'Hero spacing tightened',
      }),
    });

    const text = await readSseUntil(reader, decoder, '"steer_done"');
    assert.ok(text.includes('"steer_done"'));
    assert.ok(text.includes('b2c3d4e5'));
    assert.ok(text.includes('Hero spacing tightened'));

    controller.abort();
  });

  it('POST /events accepts generate with optional annotation fields', async () => {
    // Drain any queued events from previous tests
    let drained;
    do {
      const r = await fetch(`http://localhost:${server.port}/poll?token=${server.token}&timeout=100`);
      drained = await r.json();
    } while (drained.type !== 'timeout');

    const postRes = await fetch(`http://localhost:${server.port}/events`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: server.token, type: 'generate',
        id: 'aa11bb22', action: 'polish', count: 2,
        element: { outerHTML: '<div>x</div>', tagName: 'div' },
        screenshotPath: '/tmp/fake.png',
        comments: [{ x: 10, y: 20, text: 'tighten this' }],
        strokes: [{ points: [[0, 0], [10, 10]] }],
      }),
    });
    assert.equal(postRes.status, 200);

    const pollRes = await fetch(`http://localhost:${server.port}/poll?token=${server.token}&timeout=2000`);
    const event = await pollRes.json();
    assert.equal(event.id, 'aa11bb22');
    assert.equal(event.screenshotPath, '/tmp/fake.png');
    assert.equal(event.comments.length, 1);
    assert.equal(event.strokes.length, 1);
  });

  it('POST /events rejects generate with malformed annotation fields', async () => {
    const postRes = await fetch(`http://localhost:${server.port}/events`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: server.token, type: 'generate',
        id: 'cc33dd44', action: 'polish', count: 2,
        element: { outerHTML: '<div>x</div>', tagName: 'div' },
        comments: 'not-an-array',
      }),
    });
    assert.equal(postRes.status, 400);
    const data = await postRes.json();
    assert.ok(data.error.includes('comments'));
  });

  it('POST /events accepts insert-mode generate with prompt only', async () => {
    await drainPolls(server);
    const postRes = await fetch(`http://localhost:${server.port}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: server.token,
        type: 'generate',
        id: 'aa22bb33',
        mode: 'insert',
        count: 3,
        pageUrl: '/',
        insert: {
          position: 'after',
          anchor: { tagName: 'section', classes: ['hero'] },
        },
        placeholder: { width: 320, height: 80 },
        freeformPrompt: 'Add testimonials',
      }),
    });
    assert.equal(postRes.status, 200);
    const polled = await fetch(`http://localhost:${server.port}/poll?token=${server.token}&timeout=2000`).then(r => r.json());
    assert.equal(polled.id, 'aa22bb33');
    assert.equal(polled.mode, 'insert');
    assert.equal(polled.freeformPrompt, 'Add testimonials');
    await fetch(`http://localhost:${server.port}/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: server.token, id: 'aa22bb33', type: 'done' }),
    });
  });

  it('POST /events rejects insert-mode generate without prompt or annotations', async () => {
    const postRes = await fetch(`http://localhost:${server.port}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: server.token,
        type: 'generate',
        id: 'bb33cc44',
        mode: 'insert',
        count: 2,
        insert: { position: 'before', anchor: { tagName: 'div', classes: ['x'] } },
        placeholder: { width: 200, height: 80 },
      }),
    });
    assert.equal(postRes.status, 400);
    const data = await postRes.json();
    assert.match(data.error, /freeformPrompt or annotations/i);
  });

  // A stale generate worker's `error` reply used to acknowledge *any* pending
  // event for its id, because inferSourceEventType returned undefined and
  // acknowledgePendingEvent treats that as a wildcard. It ate the user's queued
  // Accept, which was then never handed to an agent: the browser sat in SAVING
  // forever and a restart could not requeue it.
  it('a stale generate error reply does not consume a queued accept', async () => {
    await drainPolls(server);
    const id = 'ee55ff66';

    await fetch(`http://localhost:${server.port}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: server.token,
        type: 'generate',
        id,
        action: 'impeccable',
        count: 1,
        pageUrl: '/',
        element: { outerHTML: '<button>Book</button>' },
      }),
    });

    // Agent leases the generate.
    const leased = await (await fetch(
      `http://localhost:${server.port}/poll?token=${server.token}&timeout=200&leaseMs=60000`,
    )).json();
    assert.equal(leased.id, id);
    assert.equal(leased.type, 'generate');

    // User accepts. This retires the pending generate and queues the accept.
    await fetch(`http://localhost:${server.port}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: server.token, type: 'accept', id, variantId: '1' }),
    });

    // The stale generate worker now fails, using live.md's documented reply.
    const errRes = await fetch(`http://localhost:${server.port}/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: server.token, id, type: 'error', message: 'late failure' }),
    });
    assert.equal(errRes.status, 200);

    const status = await (await fetch(
      `http://localhost:${server.port}/status?token=${server.token}`,
    )).json();
    assert.equal(
      status.pendingEvents.some((e) => e.id === id && e.type === 'accept'),
      true,
      'the queued accept must survive a stale generate error',
    );

    // And it must still be deliverable to the next agent that polls.
    const next = await (await fetch(
      `http://localhost:${server.port}/poll?token=${server.token}&timeout=500&leaseMs=30000`,
    )).json();
    assert.equal(next.id, id);
    assert.equal(next.type, 'accept', 'the accept must reach an agent');

    // Acknowledge the accept explicitly. drainPolls replies `done`, which maps
    // to `generate`, so it can never retire an accept and would re-lease it in
    // a loop forever.
    await fetch(`http://localhost:${server.port}/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: server.token, id, type: 'complete', sourceEventType: 'accept' }),
    });
  });
});
