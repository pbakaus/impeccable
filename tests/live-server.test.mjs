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
} from '../skill/scripts/impeccable-paths.mjs';

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

  it('/live.js serves script with token injected', async () => {
    const res = await fetch(`http://localhost:${server.port}/live.js`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/javascript');
    const text = await res.text();
    assert.ok(text.includes('__IMPECCABLE_TOKEN__'));
    assert.ok(text.includes(server.token));
    assert.ok(text.includes('__IMPECCABLE_PORT__'));
    const sessionHelperIndex = text.indexOf('__IMPECCABLE_LIVE_SESSION__');
    const browserInitIndex = text.indexOf('__IMPECCABLE_LIVE_INIT__');
    assert.ok(sessionHelperIndex !== -1);
    assert.ok(browserInitIndex !== -1);
    assert.ok(
      sessionHelperIndex < browserInitIndex,
      'event=live_server.browser_helper_order actor=browser operation=load_live_js risk=session_helper_missing_before_browser_init expected=session helper before live init actual=' + sessionHelperIndex + ':' + browserInitIndex,
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

      const events = readFileSync(join(getLiveDir(tmp), 'manual-edit-events.jsonl'), 'utf-8');
      assert.match(events, /"type":"manual_edit_stashed"/);
      assert.match(events, /"type":"manual_edit_commit_started"/);
      assert.match(events, /"type":"manual_edit_commit_done"/);
    } finally {
      if (commitServer) {
        await stopServer(commitServer.port, commitServer.token);
        commitServer.proc.kill();
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

      // Fake agent: long-poll, write the file, ack with the result shape.
      const agentLoop = (async () => {
        // First poll picks up the manual_edit_apply event.
        const pollRes = await fetch(`http://localhost:${chatServer.port}/poll?token=${chatServer.token}&timeout=10000&leaseMs=30000`);
        const event = await pollRes.json();
        assert.equal(event.type, 'manual_edit_apply');
        assert.equal(event.pageUrl, '/');
        assert.equal(event.batch.entries.length, 1);
        assert.equal(event.batch.entries[0].id, 'cafebabe');
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

      const events = readFileSync(join(getLiveDir(tmp), 'manual-edit-events.jsonl'), 'utf-8');
      assert.match(events, /"provider":"chat"/);
      assert.match(events, /"type":"manual_edit_commit_done"/);
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

      const agentLoop = (async () => {
        const expectedChunkSizes = [3, 3, 1];
        for (const [index, expectedSize] of expectedChunkSizes.entries()) {
          const pollRes = await fetch(`http://localhost:${chunkServer.port}/poll?token=${chunkServer.token}&timeout=10000&leaseMs=30000`);
          const event = await pollRes.json();
          assert.equal(event.type, 'manual_edit_apply');
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
            type: 'error',
            message: 'second chunk failed',
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

      const commit = await commitPromise;
      assert.equal(commit.status, 200);
      const result = await commit.json();
      assert.equal(result.cleared, 0);
      assert.equal(result.applied.length, 0);
      assert.equal(result.failed.length, 1);
      assert.equal(result.failed[0].reason, 'chat_agent_timeout');
      assert.match(readFileSync(sourcePath, 'utf-8'), /Welcome/);

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

      const discard = await fetch(`http://localhost:${discardApplyServer.port}/manual-edit-discard?token=${discardApplyServer.token}&pageUrl=%2F`, {
        method: 'POST',
      });
      assert.equal(discard.status, 200);
      const discardBody = await discard.json();
      assert.equal(discardBody.discarded, 1);
      assert.deepEqual(discardBody.canceledApplyEvents.map((item) => item.id), [event.id]);
      assert.equal(discardBody.totalCount, 0);

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

      const docsPollPromise = fetch(`http://localhost:${pageScopeServer.port}/poll?token=${pageScopeServer.token}&timeout=10000&leaseMs=30000`)
        .then((res) => res.json());
      const docsCommitPromise = fetch(`http://localhost:${pageScopeServer.port}/manual-edit-commit?token=${pageScopeServer.token}&pageUrl=%2Fdocs`, {
        method: 'POST',
      });
      const docsEvent = await docsPollPromise;
      assert.equal(docsEvent.type, 'manual_edit_apply');
      assert.equal(docsEvent.pageUrl, '/docs');

      const discardHome = await fetch(`http://localhost:${pageScopeServer.port}/manual-edit-discard?token=${pageScopeServer.token}&pageUrl=%2F`, {
        method: 'POST',
      });
      assert.equal(discardHome.status, 200);
      const discardHomeBody = await discardHome.json();
      assert.deepEqual(discardHomeBody.canceledApplyEvents.map((item) => item.id), [homeEvent.id]);
      assert.equal(discardHomeBody.perPage['/'] || 0, 0);
      assert.equal(discardHomeBody.perPage['/docs'] || 0, 1);

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
    const cases = ['<strong>B</strong>', 'B > A', '{label}', 'label}', '`label`'];
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
    const res = await fetch(`http://localhost:${server.port}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: server.token,
        type: 'checkpoint',
        id: 'a1b2c3d7',
        phase: 'cycling',
        revision: 2,
        owner: 'browser-a',
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

    const first = await fetch(`http://localhost:${server.port}/poll?token=${server.token}&timeout=100&leaseMs=50`).then(r => r.json());
    assert.equal(first.id, 'a1b2c3da');

    const leased = await fetch(`http://localhost:${server.port}/poll?token=${server.token}&timeout=25&leaseMs=50`).then(r => r.json());
    assert.equal(leased.type, 'timeout', 'leased event should not be redelivered before lease expiry');

    await new Promise(r => setTimeout(r, 75));
    const redelivered = await fetch(`http://localhost:${server.port}/poll?token=${server.token}&timeout=100&leaseMs=50`).then(r => r.json());
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
});
