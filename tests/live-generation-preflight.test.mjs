import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';

import {
  buildGenerationPreflight,
  runGenerationPreflight,
} from '../skill/scripts/live/generation-preflight.mjs';

const SCRIPTS_DIR = path.resolve('skill/scripts');

test('builds a replace preflight from the picker locator', () => {
  const command = buildGenerationPreflight({
    type: 'generate',
    id: 'session-1',
    count: 3,
    pageUrl: '/pricing',
    element: {
      id: 'hero',
      classes: ['hero', 'hero--dark'],
      tagName: 'SECTION',
      textContent: 'A faster way to ship',
    },
  }, SCRIPTS_DIR);

  assert.equal(command.mode, 'replace');
  assert.deepEqual(command.args.slice(1), [
    '--id', 'session-1', '--count', '3',
    '--element-id', 'hero',
    '--classes', 'hero hero--dark',
    '--tag', 'SECTION',
    '--text', 'A faster way to ship',
    '--page-url', '/pricing',
  ]);
});

test('builds an insert preflight from the anchor locator', () => {
  const command = buildGenerationPreflight({
    type: 'generate',
    id: 'session-2',
    count: 2,
    mode: 'insert',
    insert: {
      position: 'before',
      anchor: { classes: ['card'], tagName: 'ARTICLE', textContent: 'Plan' },
    },
  }, SCRIPTS_DIR);

  assert.equal(command.mode, 'insert');
  assert.deepEqual(command.args.slice(1), [
    '--id', 'session-2', '--count', '2', '--position', 'before',
    '--classes', 'card', '--tag', 'ARTICLE', '--text', 'Plan',
  ]);
});

test('returns scaffold metadata without exposing child-process details', async () => {
  const calls = [];
  const result = await runGenerationPreflight({
    type: 'generate',
    id: 'session-3',
    count: 1,
    element: { classes: ['hero'] },
  }, {
    scriptsDir: SCRIPTS_DIR,
    cwd: '/tmp/example',
    async execFileImpl(file, args, options) {
      calls.push({ file, args, options });
      return { stdout: '{"file":"src/App.jsx","insertLine":12}\n', stderr: '' };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.scaffold, { file: 'src/App.jsx', insertLine: 12 });
  assert.equal(calls[0].file, process.execPath);
  assert.equal(calls[0].options.cwd, '/tmp/example');
});

test('skips preflight when the picker has no source locator', async () => {
  const result = await runGenerationPreflight({
    type: 'generate',
    id: 'session-4',
    count: 3,
    element: { tagName: 'DIV' },
  }, { scriptsDir: SCRIPTS_DIR });

  assert.deepEqual(result, { ok: false, skipped: true, reason: 'insufficient_locator' });
});

test('yields to the event loop instead of blocking on the child process', async () => {
  // The server is single-threaded and leases polls through this call. A
  // synchronous spawn froze every other request (Accept, Discard, SSE) for the
  // scaffold's full duration — measured at ~7.6s on a large repo.
  let tickedDuringPreflight = false;
  const pending = runGenerationPreflight({
    type: 'generate',
    id: 'session-async',
    count: 1,
    element: { classes: ['hero'] },
  }, {
    scriptsDir: SCRIPTS_DIR,
    execFileImpl: () => new Promise((resolve) => {
      setTimeout(() => resolve({ stdout: '{"file":"src/App.jsx"}\n', stderr: '' }), 25);
    }),
  });
  setTimeout(() => { tickedDuringPreflight = true; }, 5);
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(tickedDuringPreflight, true, 'the event loop must stay responsive during preflight');
});

test('reports a child-process failure without leaking internals or throwing', async () => {
  const error = new Error('spawn failed');
  error.stderr = 'live-wrap.mjs: element not found\n';
  const result = await runGenerationPreflight({
    type: 'generate',
    id: 'session-fail',
    count: 1,
    element: { classes: ['hero'] },
  }, {
    scriptsDir: SCRIPTS_DIR,
    execFileImpl: () => Promise.reject(error),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'live-wrap.mjs: element not found');
  assert.ok(typeof result.durationMs === 'number');
});
