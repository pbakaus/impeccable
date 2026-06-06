/**
 * Unit tests for the harmless Impeccable hook probe.
 * Run: node --test tests/hook.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = path.resolve('skill', 'scripts', 'hook-probe.mjs');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-hook-probe-'));
}

describe('hook-probe.mjs', () => {
  let cwd;

  beforeEach(() => {
    cwd = mkTmp();
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it('exits 0 and emits no output by default', () => {
    const result = spawnSync(process.execPath, [SCRIPT], {
      cwd,
      input: JSON.stringify({ hook_event_name: 'PostToolUse' }),
      encoding: 'utf8',
    });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  });

  it('tolerates malformed JSON stdin', () => {
    const result = spawnSync(process.execPath, [SCRIPT], {
      cwd,
      input: '{ nope',
      encoding: 'utf8',
    });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  });

  it('writes optional NDJSON only when IMPECCABLE_HOOK_PROBE_LOG is set', () => {
    const logPath = path.join(cwd, 'probe.ndjson');
    const result = spawnSync(process.execPath, [SCRIPT], {
      cwd,
      input: JSON.stringify({ hook_event_name: 'afterFileEdit', file_path: 'src/App.jsx' }),
      env: {
        ...process.env,
        IMPECCABLE_HOOK_PROBE_LOG: logPath,
      },
      encoding: 'utf8',
    });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');

    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
    assert.equal(lines.length, 1);

    const event = JSON.parse(lines[0]);
    assert.equal(event.provider, 'cursor');
    assert.equal(event.event, 'afterFileEdit');
    assert.equal(event.cwd, fs.realpathSync(cwd));
    assert.equal(event.file, 'src/App.jsx');
    assert.equal(typeof event.timestamp, 'string');
  });
});
