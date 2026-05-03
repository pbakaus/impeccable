/**
 * Tests for project-local Impeccable path resolution.
 * Run with: node --test tests/impeccable-paths.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  getDesignSidecarPath,
  getLegacyLiveServerPath,
  getLiveAnnotationsDir,
  getLiveConfigPath,
  getLiveServerPath,
  getLiveSessionsDir,
  readLiveServerInfo,
  resolveDesignSidecarPath,
  resolveLiveConfigPath,
} from '../source/skills/impeccable/scripts/impeccable-paths.mjs';

describe('impeccable project paths', () => {
  let tmp;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'impeccable-paths-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('resolves the generated design sidecar under .impeccable', () => {
    assert.equal(getDesignSidecarPath(tmp), join(tmp, '.impeccable', 'design.json'));

    mkdirSync(join(tmp, '.impeccable'), { recursive: true });
    writeFileSync(join(tmp, 'DESIGN.json'), '{"source":"legacy"}');
    writeFileSync(getDesignSidecarPath(tmp), '{"source":"new"}');

    assert.equal(resolveDesignSidecarPath(tmp), getDesignSidecarPath(tmp));
  });

  it('falls back to legacy root DESIGN.json when the new sidecar is missing', () => {
    const legacyPath = join(tmp, 'DESIGN.json');
    writeFileSync(legacyPath, '{"source":"legacy"}');

    assert.equal(resolveDesignSidecarPath(tmp), legacyPath);
  });

  it('uses .impeccable/live/config.json as the default live config path', () => {
    assert.equal(resolveLiveConfigPath({ cwd: tmp, scriptsDir: join(tmp, 'scripts'), env: {} }), getLiveConfigPath(tmp));
  });

  it('falls back to legacy scripts/config.json when no new live config exists', () => {
    const scriptsDir = join(tmp, 'skills', 'impeccable', 'scripts');
    mkdirSync(scriptsDir, { recursive: true });
    const legacyConfig = join(scriptsDir, 'config.json');
    writeFileSync(legacyConfig, '{"files":["index.html"]}');

    assert.equal(resolveLiveConfigPath({ cwd: tmp, scriptsDir, env: {} }), legacyConfig);
  });

  it('lets IMPECCABLE_LIVE_CONFIG override both new and legacy config locations', () => {
    const override = join(tmp, 'custom-live-config.json');
    mkdirSync(join(tmp, '.impeccable', 'live'), { recursive: true });
    writeFileSync(getLiveConfigPath(tmp), '{"source":"new"}');
    writeFileSync(override, '{"source":"override"}');

    assert.equal(
      resolveLiveConfigPath({ cwd: tmp, scriptsDir: join(tmp, 'scripts'), env: { IMPECCABLE_LIVE_CONFIG: 'custom-live-config.json' } }),
      override,
    );
  });

  it('places live server, session, and annotation state under .impeccable/live', () => {
    assert.equal(getLiveServerPath(tmp), join(tmp, '.impeccable', 'live', 'server.json'));
    assert.equal(getLiveSessionsDir(tmp), join(tmp, '.impeccable', 'live', 'sessions'));
    assert.equal(getLiveAnnotationsDir(tmp), join(tmp, '.impeccable', 'live', 'annotations'));
  });

  it('reads new live server state before legacy recovery state', () => {
    mkdirSync(join(tmp, '.impeccable', 'live'), { recursive: true });
    writeFileSync(getLiveServerPath(tmp), JSON.stringify({ port: 8401, token: 'new' }));
    writeFileSync(getLegacyLiveServerPath(tmp), JSON.stringify({ port: 8400, token: 'legacy' }));

    const record = readLiveServerInfo(tmp);
    assert.equal(record.path, getLiveServerPath(tmp));
    assert.equal(record.info.token, 'new');
  });

  it('reads legacy live server state when the new state file is absent', () => {
    writeFileSync(getLegacyLiveServerPath(tmp), JSON.stringify({ port: 8400, token: 'legacy' }));

    const record = readLiveServerInfo(tmp);
    assert.equal(record.path, getLegacyLiveServerPath(tmp));
    assert.equal(record.info.token, 'legacy');
  });
});
