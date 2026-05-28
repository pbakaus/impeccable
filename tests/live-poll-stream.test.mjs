/**
 * Integration tests for live-poll --stream mode.
 * Run with: node --test tests/live-poll-stream.test.mjs
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { getLiveServerPath } from '../skill/scripts/impeccable-paths.mjs';
import { postReply } from '../skill/scripts/live-poll.mjs';

const REPO_ROOT = process.cwd();
const SERVER_SCRIPT = join(REPO_ROOT, 'skill/scripts/live-server.mjs');
const POLL_SCRIPT = join(REPO_ROOT, 'skill/scripts/live-poll.mjs');

function startServer(port = 8498, { cwd = REPO_ROOT } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [SERVER_SCRIPT, '--port=' + port], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
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

async function stopServer(port, token) {
  try {
    await fetch(`http://localhost:${port}/stop?token=${token}`);
  } catch { /* already gone */ }
}

function readStdoutLine(streamProc, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for stdout line. Buffer: ' + buffer.slice(0, 200)));
    }, timeoutMs);

    function onData(chunk) {
      buffer += chunk.toString();
      const idx = buffer.indexOf('\n');
      if (idx === -1) return;
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      cleanup();
      resolve(line);
    }

    function cleanup() {
      clearTimeout(timer);
      streamProc.stdout.off('data', onData);
    }

    streamProc.stdout.on('data', onData);
    if (buffer.includes('\n')) onData('');
  });
}

describe('live-poll --stream integration', () => {
  let server;
  let serverCwd;

  before(async () => {
    serverCwd = mkdtempSync(join(tmpdir(), 'impeccable-live-poll-stream-'));
    server = await startServer(8498, { cwd: serverCwd });
  });

  after(async () => {
    if (server?.proc && !server.proc.killed) {
      await stopServer(server.port, server.token);
      server.proc.kill('SIGTERM');
    }
    if (serverCwd) rmSync(serverCwd, { recursive: true, force: true });
  });

  it('emits multiple steer events without restarting the poll process', async () => {
    const streamProc = spawn('node', [POLL_SCRIPT, '--stream', '--ack-timeout=15000'], {
      cwd: server.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    try {
      const firstLinePromise = readStdoutLine(streamProc);

      await new Promise((r) => setTimeout(r, 150));

      const post1 = await fetch(`http://localhost:${server.port}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: server.token,
          type: 'steer',
          id: '11111111',
          message: 'stream test one',
          pageUrl: 'http://localhost:4321/',
        }),
      });
      assert.equal(post1.status, 200);

      const firstLine = await firstLinePromise;
      const firstEvent = JSON.parse(firstLine);
      assert.equal(firstEvent.type, 'steer');
      assert.equal(firstEvent.id, '11111111');

      await postReply(`http://localhost:${server.port}`, server.token, {
        id: '11111111',
        type: 'steer_done',
        message: 'done one',
      });

      const secondLinePromise = readStdoutLine(streamProc);

      const post2 = await fetch(`http://localhost:${server.port}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: server.token,
          type: 'steer',
          id: '22222222',
          message: 'stream test two',
          pageUrl: 'http://localhost:4321/',
        }),
      });
      assert.equal(post2.status, 200);

      const secondLine = await secondLinePromise;
      const secondEvent = JSON.parse(secondLine);
      assert.equal(secondEvent.type, 'steer');
      assert.equal(secondEvent.id, '22222222');
      assert.equal(secondEvent.message, 'stream test two');
    } finally {
      streamProc.kill('SIGTERM');
    }
  });

  it('emits insert-mode generate and clears pending after done reply', async () => {
    const streamProc = spawn('node', [POLL_SCRIPT, '--stream', '--ack-timeout=15000'], {
      cwd: server.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    try {
      const linePromise = readStdoutLine(streamProc);

      await new Promise((r) => setTimeout(r, 150));

      const postRes = await fetch(`http://localhost:${server.port}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: server.token,
          type: 'generate',
          id: 'aa999999',
          mode: 'insert',
          count: 3,
          pageUrl: 'http://localhost:4321/',
          insert: {
            position: 'after',
            anchor: { tagName: 'section', classes: ['hero'] },
          },
          placeholder: { width: 320, height: 80 },
          freeformPrompt: 'Add testimonials',
        }),
      });
      assert.equal(postRes.status, 200);

      const line = await linePromise;
      const event = JSON.parse(line);
      assert.equal(event.type, 'generate');
      assert.equal(event.mode, 'insert');
      assert.equal(event.id, 'aa999999');
      assert.equal(event.freeformPrompt, 'Add testimonials');

      await postReply(`http://localhost:${server.port}`, server.token, {
        id: 'aa999999',
        type: 'done',
      });
    } finally {
      streamProc.kill('SIGTERM');
    }
  });
});
