/**
 * Tests for project-local Impeccable path resolution.
 * Run with: node --test tests/impeccable-paths.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  getDesignSidecarPath,
  getCritiqueDir,
  getLegacyLiveServerPath,
  getLiveAnnotationsDir,
  getLiveConfigPath,
  getLiveServerPath,
  getLiveSessionsDir,
  readLiveServerInfo,
  resolveDesignSidecarPath,
  resolveLiveConfigPath,
} from '../skill/scripts/lib/impeccable-paths.mjs';

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

  it('places .impeccable state under the active monorepo child project', () => {
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({
      private: true,
      workspaces: ['apps/*'],
    }));
    mkdirSync(join(tmp, 'apps', 'dashboard', 'src'), { recursive: true });
    writeFileSync(join(tmp, 'apps', 'dashboard', 'src', 'App.jsx'), 'export default null;\n');
    const options = { targetPath: 'apps/dashboard/src/App.jsx' };
    const projectRoot = join(tmp, 'apps', 'dashboard');

    assert.equal(getDesignSidecarPath(tmp, options), join(projectRoot, '.impeccable', 'design.json'));
    assert.equal(getLiveConfigPath(tmp, options), join(projectRoot, '.impeccable', 'live', 'config.json'));
    assert.equal(getLiveServerPath(tmp, options), join(projectRoot, '.impeccable', 'live', 'server.json'));
    assert.equal(getLiveSessionsDir(tmp, options), join(projectRoot, '.impeccable', 'live', 'sessions'));
    assert.equal(getLiveAnnotationsDir(tmp, options), join(projectRoot, '.impeccable', 'live', 'annotations'));
    assert.equal(getCritiqueDir(tmp, options), join(projectRoot, '.impeccable', 'critique'));
    assert.equal(getLegacyLiveServerPath(tmp, options), join(projectRoot, '.impeccable-live.json'));
    assert.equal(resolveLiveConfigPath({ cwd: tmp, scriptsDir: join(tmp, 'scripts'), env: {}, targetPath: options.targetPath }), getLiveConfigPath(tmp, options));
  });

  it('does not let a root live config shadow a child project live config path', () => {
    writeFileSync(join(tmp, 'turbo.json'), '{"tasks":{}}');
    mkdirSync(join(tmp, 'apps', 'admin', 'src'), { recursive: true });
    writeFileSync(join(tmp, 'apps', 'admin', 'src', 'App.jsx'), 'export default null;\n');
    mkdirSync(join(tmp, '.impeccable', 'live'), { recursive: true });
    writeFileSync(join(tmp, '.impeccable', 'live', 'config.json'), '{"source":"root"}');

    assert.equal(
      resolveLiveConfigPath({ cwd: tmp, scriptsDir: join(tmp, 'scripts'), env: {}, targetPath: 'apps/admin/src/App.jsx' }),
      join(tmp, 'apps', 'admin', '.impeccable', 'live', 'config.json'),
    );
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

  it('keeps live server state when pid probing returns EPERM', () => {
    mkdirSync(join(tmp, '.impeccable', 'live'), { recursive: true });
    writeFileSync(getLiveServerPath(tmp), JSON.stringify({ port: 8401, token: 'new', pid: 12345 }));
    const originalKill = process.kill;
    process.kill = () => {
      const err = new Error('permission denied');
      err.code = 'EPERM';
      throw err;
    };

    try {
      const record = readLiveServerInfo(tmp);
      assert.equal(record.path, getLiveServerPath(tmp));
      assert.equal(record.info.token, 'new');
      assert.equal(existsSync(getLiveServerPath(tmp)), true);
    } finally {
      process.kill = originalKill;
    }
  });

  it('removes stale live server state when pid probing returns ESRCH', () => {
    mkdirSync(join(tmp, '.impeccable', 'live'), { recursive: true });
    writeFileSync(getLiveServerPath(tmp), JSON.stringify({ port: 8401, token: 'new', pid: 12345 }));
    const originalKill = process.kill;
    process.kill = () => {
      const err = new Error('no such process');
      err.code = 'ESRCH';
      throw err;
    };

    try {
      const record = readLiveServerInfo(tmp);
      assert.equal(record, null);
      assert.equal(existsSync(getLiveServerPath(tmp)), false);
    } finally {
      process.kill = originalKill;
    }
  });
});
