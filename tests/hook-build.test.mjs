/**
 * Integration tests for provider-native hook probe build artifacts.
 * Run: node --test tests/hook-build.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  buildClaudeSettingsManifest,
  buildCodexHooksManifest,
  buildCursorHooksManifest,
  hooksJsonFor,
} from '../scripts/lib/transformers/hooks.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROBE_MARKER = 'skills/impeccable/scripts/hook-probe.mjs';

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'));
}

function expectProbeCommand(value, providerPath) {
  assert.equal(typeof value, 'string');
  assert.ok(value.includes(PROBE_MARKER), `missing probe marker in ${value}`);
  assert.ok(value.includes(providerPath), `missing provider path ${providerPath} in ${value}`);
  assert.ok(!value.includes('hook.mjs'), `old detector hook still referenced in ${value}`);
  assert.ok(!value.includes('hook-after-edit.mjs'), `old Cursor hook still referenced in ${value}`);
  assert.ok(!value.includes('hook-stop.mjs'), `old Cursor hook still referenced in ${value}`);
}

describe('hook manifest builders', () => {
  it('builds Claude project settings for the harmless probe', () => {
    const manifest = buildClaudeSettingsManifest();
    const group = manifest.hooks.PostToolUse[0];
    const handler = group.hooks[0];

    assert.equal(group.matcher, 'Edit|Write|MultiEdit');
    assert.equal(handler.type, 'command');
    assert.equal(handler.timeout, 3);
    expectProbeCommand(handler.command, '.claude/skills/impeccable/scripts/hook-probe.mjs');
    assert.ok(handler.command.includes('${CLAUDE_PROJECT_DIR}'));
    assert.equal(handler.args, undefined);
    assert.equal(handler.statusMessage, undefined);
  });

  it('builds Codex project-local hooks for the harmless probe', () => {
    const manifest = buildCodexHooksManifest();
    const group = manifest.hooks.PostToolUse[0];
    const handler = group.hooks[0];

    assert.equal(group.matcher, 'Edit|Write|apply_patch');
    assert.equal(handler.type, 'command');
    assert.equal(handler.timeout, 3);
    expectProbeCommand(handler.command, '.agents/skills/impeccable/scripts/hook-probe.mjs');
    assert.ok(handler.command.includes('git rev-parse --show-toplevel'));
    assert.equal(handler.statusMessage, undefined);
  });

  it('builds Cursor hooks for the harmless probe', () => {
    const manifest = buildCursorHooksManifest();
    const handler = manifest.hooks.afterFileEdit[0];

    assert.equal(manifest.version, 1);
    assert.ok(Array.isArray(manifest.hooks.afterFileEdit));
    assert.equal(manifest.hooks.stop, undefined);
    assert.equal(handler.timeout, 3);
    expectProbeCommand(handler.command, '.cursor/skills/impeccable/scripts/hook-probe.mjs');
  });

  it('routes supported hook builders and leaves other providers alone', () => {
    assert.ok(hooksJsonFor('claude'));
    assert.ok(hooksJsonFor('codex'));
    assert.ok(hooksJsonFor('cursor'));
    assert.equal(hooksJsonFor('gemini'), null);
  });
});

describe('generated hook artifacts in repo', () => {
  for (const rel of [
    '.claude/settings.json',
    '.cursor/hooks.json',
    '.codex/hooks.json',
  ]) {
    it(`${rel} exists and is valid JSON`, () => {
      const abs = path.join(REPO_ROOT, rel);
      assert.ok(fs.existsSync(abs), `${rel} missing - did you forget bun run build?`);
      assert.doesNotThrow(() => JSON.parse(fs.readFileSync(abs, 'utf8')));
    });
  }

  it('Claude project settings reference the probe in .claude/skills', () => {
    const manifest = readJson('.claude/settings.json');
    const handler = manifest.hooks.PostToolUse[0].hooks[0];

    expectProbeCommand(handler.command, '.claude/skills/impeccable/scripts/hook-probe.mjs');
    assert.ok(fs.existsSync(path.join(REPO_ROOT, '.claude/skills/impeccable/scripts/hook-probe.mjs')));
  });

  it('Cursor project hooks reference the probe in .cursor/skills', () => {
    const manifest = readJson('.cursor/hooks.json');
    const handler = manifest.hooks.afterFileEdit[0];

    expectProbeCommand(handler.command, '.cursor/skills/impeccable/scripts/hook-probe.mjs');
    assert.ok(fs.existsSync(path.join(REPO_ROOT, '.cursor/skills/impeccable/scripts/hook-probe.mjs')));
  });

  it('Codex project hooks reference the probe in .agents/skills', () => {
    const manifest = readJson('.codex/hooks.json');
    const handler = manifest.hooks.PostToolUse[0].hooks[0];

    expectProbeCommand(handler.command, '.agents/skills/impeccable/scripts/hook-probe.mjs');
    assert.ok(fs.existsSync(path.join(REPO_ROOT, '.agents/skills/impeccable/scripts/hook-probe.mjs')));
    assert.ok(fs.existsSync(path.join(REPO_ROOT, '.agents/skills/impeccable/SKILL.md')));
  });

  it('does not generate old hook runtime scripts into provider skill payloads', () => {
    for (const providerDir of ['.claude', '.cursor', '.agents']) {
      const scriptsDir = path.join(REPO_ROOT, providerDir, 'skills', 'impeccable', 'scripts');
      for (const oldScript of ['hook.mjs', 'hook-lib.mjs', 'hook-admin.mjs', 'hook-after-edit.mjs', 'hook-stop.mjs']) {
        assert.equal(fs.existsSync(path.join(scriptsDir, oldScript)), false, `${providerDir} still has ${oldScript}`);
      }
    }
  });

  it('does not generate plugin or stale Codex hook packaging artifacts', () => {
    for (const rel of [
      '.claude/hooks/hooks.json',
      '.agents/hooks',
      '.agents/plugins/marketplace.json',
      'plugin-codex',
      'plugin/hooks/hooks.json',
      'plugin/.codex-plugin/plugin.json',
    ]) {
      assert.equal(fs.existsSync(path.join(REPO_ROOT, rel)), false, `${rel} should not exist`);
    }
  });

  it('probe scripts execute successfully from all generated provider payloads', () => {
    for (const rel of [
      '.claude/skills/impeccable/scripts/hook-probe.mjs',
      '.cursor/skills/impeccable/scripts/hook-probe.mjs',
      '.agents/skills/impeccable/scripts/hook-probe.mjs',
    ]) {
      const result = spawnSync(process.execPath, [path.join(REPO_ROOT, rel)], {
        cwd: REPO_ROOT,
        input: JSON.stringify({ hook_event_name: 'PostToolUse' }),
        encoding: 'utf8',
      });

      assert.equal(result.status, 0, `${rel} exited ${result.status}: ${result.stderr}`);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr, '');
    }
  });
});
