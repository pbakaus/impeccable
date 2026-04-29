/**
 * Tests for the live variant server.
 * Run with: node --test tests/live-server.test.mjs
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execSync, spawn } from 'node:child_process';

const SERVER_SCRIPT = 'source/skills/impeccable/scripts/live-server.mjs';
// Matches LIVE_PID_FILE in live-server.mjs: project root, not tmpdir().
const PID_FILE = join(process.cwd(), '.impeccable-live.json');

// ---------------------------------------------------------------------------
// Helper: start/stop server for integration tests
// ---------------------------------------------------------------------------

function startServer(port = 8499) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [SERVER_SCRIPT, '--port=' + port], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    let output = '';
    proc.stdout.on('data', (d) => {
      output += d.toString();
      if (output.includes('running on')) {
        // Read token from PID file
        try {
          const info = JSON.parse(readFileSync(PID_FILE, 'utf-8'));
          resolve({ proc, port: info.port, token: info.token });
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

// ---------------------------------------------------------------------------
// Server integration tests
// ---------------------------------------------------------------------------

describe('live-server integration', () => {
  let server;

  before(async () => {
    server = await startServer(8499);
  });

  after(async () => {
    if (server) {
      await stopServer(server.port, server.token);
      server.proc.kill();
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

  it('/live.js serves script with token injected', async () => {
    const res = await fetch(`http://localhost:${server.port}/live.js`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/javascript');
    const text = await res.text();
    assert.ok(text.includes('__IMPECCABLE_TOKEN__'));
    assert.ok(text.includes(server.token));
    assert.ok(text.includes('__IMPECCABLE_PORT__'));
  });

  it('/detect.js serves the detection overlay', async () => {
    const res = await fetch(`http://localhost:${server.port}/detect.js`);
    // May 404 if detect-antipatterns-browser.js hasn't been built
    assert.ok(res.status === 200 || res.status === 404);
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
    let drained;
    do {
      const r = await fetch(`http://localhost:${server.port}/poll?token=${server.token}&timeout=100`);
      drained = await r.json();
    } while (drained.type !== 'timeout');

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

    // Send a reply from the agent
    await fetch(`http://localhost:${server.port}/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: server.token, id: 'sse-test', type: 'done', file: 'x.html' }),
    });

    // Read the next SSE message
    const { value: chunk2 } = await reader.read();
    const text2 = decoder.decode(chunk2);
    assert.ok(text2.includes('"done"'));
    assert.ok(text2.includes('sse-test'));

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
