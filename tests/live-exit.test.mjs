/**
 * The Exit button's event must reach the agent even when the page reloads
 * right after it: an accept's carbonize edit makes the dev server reload the
 * page, and the reloaded overlay's SSE reconnect used to cancel the queued exit.
 * Skips cleanly without a binary (tests/lib/engine-bin.mjs).
 *
 * Run with: node --test tests/live-exit.test.mjs
 */

import { it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { ENGINE_MISSING_MESSAGE, engineEnv, findEngineBinary } from './lib/engine-bin.mjs';
import { armLiveServerReaper, trackServerChild } from './lib/live-servers.mjs';

const ENGINE_BIN = findEngineBinary();
armLiveServerReaper();

const cwd = mkdtempSync(join(tmpdir(), 'impeccable-live-exit-'));
after(() => rmSync(cwd, { recursive: true, force: true }));

async function startServer() {
  writeFileSync(join(cwd, 'index.html'), '<!doctype html><body></body>');
  const proc = trackServerChild(spawn(ENGINE_BIN, ['live-server', '--port=0'], {
    cwd,
    stdio: 'ignore',
    env: engineEnv(ENGINE_BIN, { IMPECCABLE_LIVE_COPY_AGENT: 'off' }),
  }));
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      const info = JSON.parse(readFileSync(join(cwd, '.impeccable/live/server.json'), 'utf-8'));
      if (info.port && info.token) return { proc, base: `http://localhost:${info.port}`, token: info.token };
    } catch { /* not yet */ }
    if (Date.now() > deadline) throw new Error('live-server did not start');
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Opens the overlay's event stream and waits for its connected frame. */
async function connectOverlay(server) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const res = await fetch(`${server.base}/events?token=${server.token}`, { signal: controller.signal });
    const reader = res.body.getReader();
    let text = '';
    while (!text.includes('"connected"')) {
      const { done, value } = await reader.read();
      if (done) throw new Error('event stream closed before it connected');
      text += new TextDecoder().decode(value);
    }
  } catch (err) {
    controller.abort();
    throw err;
  } finally {
    clearTimeout(timer);
  }
  return () => controller.abort();
}

it('an exit from the bar survives the page reloading before the agent polls', { skip: ENGINE_BIN ? false : ENGINE_MISSING_MESSAGE }, async () => {
  const server = await startServer();
  try {
    const closePage = await connectOverlay(server);
    const posted = await fetch(`${server.base}/events?token=${server.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'exit', source: 'user', token: server.token }),
    });
    assert.equal(posted.status, 200);
    closePage();
    const closeReloaded = await connectOverlay(server);
    const event = await (await fetch(`${server.base}/poll?token=${server.token}&timeout=2000`)).json();
    closeReloaded();
    assert.equal(event.type, 'exit');
  } finally {
    await fetch(`${server.base}/stop?token=${server.token}`).catch(() => {});
  }
});
