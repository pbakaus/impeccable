import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_CONFIG, loadConfig } from '../cli/engine/config/load-config.mjs';

function tmp(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imp-cfg-'));
  for (const [name, contents] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), contents);
  return dir;
}

describe('loadConfig', () => {
  it('returns defaults when no config present', () => {
    const dir = tmp({});
    assert.deepEqual(loadConfig(dir), DEFAULT_CONFIG);
  });
  it('reads impeccable.config.json and merges over defaults', () => {
    const dir = tmp({ 'impeccable.config.json': JSON.stringify({ disabledRules: ['side-tab'], ignore: ['vendor/**'] }) });
    const cfg = loadConfig(dir);
    assert.deepEqual(cfg.disabledRules, ['side-tab']);
    assert.deepEqual(cfg.ignore, ['vendor/**']);
  });
  it('prefers impeccable.config.json over .impeccablerc.json', () => {
    const dir = tmp({
      'impeccable.config.json': JSON.stringify({ disabledRules: ['a'] }),
      '.impeccablerc.json': JSON.stringify({ disabledRules: ['b'] }),
    });
    assert.deepEqual(loadConfig(dir).disabledRules, ['a']);
  });
  it('reads package.json#impeccable as last resort', () => {
    const dir = tmp({ 'package.json': JSON.stringify({ name: 'x', impeccable: { lineLengthMax: 100 } }) });
    assert.equal(loadConfig(dir).lineLengthMax, 100);
  });
  it('ignores malformed JSON and falls back to defaults', () => {
    const dir = tmp({ 'impeccable.config.json': '{ not json' });
    assert.deepEqual(loadConfig(dir), DEFAULT_CONFIG);
  });
});
