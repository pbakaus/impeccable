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

test('can request an isolated source preview for dedicated generation', () => {
  const command = buildGenerationPreflight({
    type: 'generate',
    id: 'session-isolated',
    count: 3,
    element: { classes: ['hero'], tagName: 'SECTION' },
  }, SCRIPTS_DIR, { isolated: true });
  assert.equal(command.mode, 'replace');
  assert.equal(command.args.includes('--isolated'), true);
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

test('returns scaffold metadata without exposing child-process details', () => {
  const calls = [];
  const result = runGenerationPreflight({
    type: 'generate',
    id: 'session-3',
    count: 1,
    element: { classes: ['hero'] },
  }, {
    scriptsDir: SCRIPTS_DIR,
    cwd: '/tmp/example',
    execFileSyncImpl(file, args, options) {
      calls.push({ file, args, options });
      return '{"file":"src/App.jsx","insertLine":12}\n';
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.scaffold, { file: 'src/App.jsx', insertLine: 12 });
  assert.equal(calls[0].file, process.execPath);
  assert.equal(calls[0].options.cwd, '/tmp/example');
});

test('skips preflight when the picker has no source locator', () => {
  const result = runGenerationPreflight({
    type: 'generate',
    id: 'session-4',
    count: 3,
    element: { tagName: 'DIV' },
  }, { scriptsDir: SCRIPTS_DIR });

  assert.deepEqual(result, { ok: false, skipped: true, reason: 'insufficient_locator' });
});
