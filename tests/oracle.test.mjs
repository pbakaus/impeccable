/**
 * Behavior gate: replays the oracle corpus (tests/oracle) against the engine
 * binary and asserts no case differs from its golden beyond the reviewed
 * deltas in tests/oracle/DELTAS.md.
 *
 * Skips cleanly when no binary is available: set IMPECCABLE_BIN or run
 * `bun run fetch:engine` (which writes skill/scripts/bin/<os>-<arch>/).
 *
 * Run with: node --test tests/oracle.test.mjs
 * Scope:    IMPECCABLE_ORACLE_PREFIX=detect- node --test tests/oracle.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ENGINE_MISSING_MESSAGE, findEngineBinary } from './lib/engine-bin.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE_BIN = findEngineBinary();

describe('oracle corpus against the engine binary', { skip: ENGINE_BIN ? false : ENGINE_MISSING_MESSAGE }, () => {
  it('replays every recorded case with zero unreviewed differences', () => {
    const args = [path.join(REPO_ROOT, 'tests', 'oracle', 'run.mjs')];
    if (process.env.IMPECCABLE_ORACLE_PREFIX) args.push(process.env.IMPECCABLE_ORACLE_PREFIX);
    const result = spawnSync(process.execPath, args, {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      env: { ...process.env, IMPECCABLE_BIN: ENGINE_BIN },
      maxBuffer: 64 * 1024 * 1024,
    });
    const summary = (result.stdout || '').trim().split('\n').pop();
    const failures = (result.stdout || '').split('\n').filter((line) => line.startsWith('XX ') || line.startsWith('?? '));
    assert.equal(
      result.status,
      0,
      `oracle run exited ${result.status}: ${summary}\n${failures.slice(0, 40).join('\n')}\n${(result.stderr || '').slice(-4000)}`,
    );
  });
});
