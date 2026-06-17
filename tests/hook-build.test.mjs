/**
 * Integration tests for the design-hook build pipeline.
 * Run: node --test tests/hook-build.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  buildClaudeSettingsManifest,
  buildClaudePluginHooksManifest,
  buildCodexHooksManifest,
  buildCursorHooksManifest,
  hooksJsonFor,
} from '../scripts/lib/transformers/hooks.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'));
}

function expectCommand(command, expectedPath) {
  assert.equal(typeof command, 'string');
  assert.match(command, /^node "/);
  assert.ok(command.includes(expectedPath), `missing ${expectedPath} in ${command}`);
  assert.ok(!command.includes('hook-probe.mjs'), `probe hook still referenced in ${command}`);
}

describe('hook manifest builders', () => {
  it('builds Claude project settings for the real detector hook', () => {
    const manifest = buildClaudeSettingsManifest();
    const group = manifest.hooks.PostToolUse[0];
    const handler = group.hooks[0];

    assert.equal(group.matcher, 'Edit|Write|MultiEdit');
    assert.equal(handler.type, 'command');
    assert.equal(handler.timeout, 5);
    assert.equal(handler.statusMessage, 'Checking UI changes');
    expectCommand(handler.command, '.claude/skills/impeccable/scripts/hook.mjs');
    assert.ok(handler.command.includes('${CLAUDE_PROJECT_DIR}'));
    assert.equal(handler.args, undefined);
    assert.equal(manifest.hooks.SessionStart, undefined);
  });

  it('builds Codex project-local hooks for the real detector hook', () => {
    const manifest = buildCodexHooksManifest();
    const group = manifest.hooks.PostToolUse[0];
    const handler = group.hooks[0];

    assert.equal(group.matcher, 'Edit|Write|apply_patch');
    assert.equal(handler.type, 'command');
    assert.equal(handler.timeout, 5);
    assert.equal(handler.statusMessage, 'Checking UI changes');
    expectCommand(handler.command, '.agents/skills/impeccable/scripts/hook.mjs');
    assert.ok(handler.command.includes('git rev-parse --show-toplevel'));
    assert.ok(!handler.command.includes('${PLUGIN_ROOT}'));
    assert.equal(manifest.hooks.SessionStart, undefined);
  });

  it('builds one Cursor pre-write blocking hook', () => {
    const manifest = buildCursorHooksManifest();
    const beforeEdit = manifest.hooks.preToolUse[0];

    assert.equal(manifest.version, 1);
    assert.ok(Array.isArray(manifest.hooks.preToolUse));
    assert.equal(Object.keys(manifest.hooks).length, 1);
    assert.equal(manifest.hooks.afterFileEdit, undefined);
    assert.equal(manifest.hooks.stop, undefined);
    assert.equal(manifest.hooks.sessionStart, undefined);
    expectCommand(beforeEdit.command, '.cursor/skills/impeccable/scripts/hook-before-edit.mjs');
    assert.equal(beforeEdit.timeout, 5);
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

  it('root hook manifests exactly match the hook builders', () => {
    assert.deepEqual(readJson('.claude/settings.json'), buildClaudeSettingsManifest());
    assert.deepEqual(readJson('.cursor/hooks.json'), buildCursorHooksManifest());
    assert.deepEqual(readJson('.codex/hooks.json'), buildCodexHooksManifest());
  });

  it('Claude project settings reference hook.mjs in .claude/skills', () => {
    const manifest = readJson('.claude/settings.json');
    const handler = manifest.hooks.PostToolUse[0].hooks[0];

    expectCommand(handler.command, '.claude/skills/impeccable/scripts/hook.mjs');
    assert.ok(fs.existsSync(path.join(REPO_ROOT, '.claude/skills/impeccable/scripts/hook.mjs')));
    assert.ok(fs.existsSync(path.join(REPO_ROOT, '.claude/skills/impeccable/scripts/hook-lib.mjs')));
    assert.ok(fs.existsSync(path.join(REPO_ROOT, '.claude/skills/impeccable/scripts/detector/detect-antipatterns.mjs')));
  });

  it('Cursor project hooks reference only the pre-write runtime in .cursor/skills', () => {
    const manifest = readJson('.cursor/hooks.json');
    const beforeEdit = manifest.hooks.preToolUse[0];

    assert.equal(Object.keys(manifest.hooks).length, 1);
    expectCommand(beforeEdit.command, '.cursor/skills/impeccable/scripts/hook-before-edit.mjs');
    assert.ok(fs.existsSync(path.join(REPO_ROOT, '.cursor/skills/impeccable/scripts/hook-before-edit.mjs')));
    assert.equal(fs.existsSync(path.join(REPO_ROOT, '.cursor/skills/impeccable/scripts/hook-after-edit.mjs')), false);
    assert.equal(fs.existsSync(path.join(REPO_ROOT, '.cursor/skills/impeccable/scripts/hook-stop.mjs')), false);
    assert.ok(fs.existsSync(path.join(REPO_ROOT, '.cursor/skills/impeccable/scripts/hook-lib.mjs')));
    assert.ok(fs.existsSync(path.join(REPO_ROOT, '.cursor/skills/impeccable/scripts/detector/detect-antipatterns.mjs')));
  });

  it('Codex project hooks reference hook.mjs in the .agents skill payload', () => {
    const manifest = readJson('.codex/hooks.json');
    const handler = manifest.hooks.PostToolUse[0].hooks[0];

    expectCommand(handler.command, '.agents/skills/impeccable/scripts/hook.mjs');
    assert.ok(fs.existsSync(path.join(REPO_ROOT, '.agents/skills/impeccable/SKILL.md')));
    assert.ok(fs.existsSync(path.join(REPO_ROOT, '.agents/skills/impeccable/scripts/hook.mjs')));
    assert.ok(fs.existsSync(path.join(REPO_ROOT, '.agents/skills/impeccable/scripts/hook-lib.mjs')));
    assert.ok(fs.existsSync(path.join(REPO_ROOT, '.agents/skills/impeccable/scripts/detector/detect-antipatterns.mjs')));
  });

  it('does not generate probe scripts into provider skill payloads', () => {
    for (const providerDir of ['.claude', '.cursor', '.agents', 'plugin']) {
      const probe = path.join(REPO_ROOT, providerDir, 'skills', 'impeccable', 'scripts', 'hook-probe.mjs');
      assert.equal(fs.existsSync(probe), false, `${providerDir} still has hook-probe.mjs`);
    }
  });

  it('does not generate stale Codex hook packaging artifacts', () => {
    for (const rel of [
      '.claude/hooks/hooks.json',
      '.agents/hooks',
      '.agents/plugins/marketplace.json',
      'plugin-codex',
      'plugin/.codex-plugin/plugin.json',
    ]) {
      assert.equal(fs.existsSync(path.join(REPO_ROOT, rel)), false, `${rel} should not exist`);
    }
  });

  it('packages the Claude design hook in the plugin via plugin-root paths', () => {
    const abs = path.join(REPO_ROOT, 'plugin/hooks/hooks.json');
    assert.ok(fs.existsSync(abs), 'plugin/hooks/hooks.json missing - did you forget bun run build:release?');

    const manifest = readJson('plugin/hooks/hooks.json');
    assert.deepEqual(manifest, buildClaudePluginHooksManifest());

    const handler = manifest.hooks.PostToolUse[0].hooks[0];
    assert.equal(manifest.hooks.PostToolUse[0].matcher, 'Edit|Write|MultiEdit');
    expectCommand(handler.command, 'skills/impeccable/scripts/hook.mjs');
    // Resolves relative to the installed plugin, not a `.claude/skills/` layout.
    assert.ok(handler.command.includes('${CLAUDE_PLUGIN_ROOT}'),
      `plugin hook command must use $\{CLAUDE_PLUGIN_ROOT}: ${handler.command}`);
    assert.ok(!handler.command.includes('${CLAUDE_PROJECT_DIR}'),
      `plugin hook command must not use $\{CLAUDE_PROJECT_DIR}: ${handler.command}`);

    // The script the plugin hook points at must ship inside the plugin payload.
    assert.ok(fs.existsSync(path.join(REPO_ROOT, 'plugin/skills/impeccable/scripts/hook.mjs')));
    assert.ok(fs.existsSync(path.join(REPO_ROOT, 'plugin/skills/impeccable/scripts/hook-lib.mjs')));
  });

  it('generated hook runtime can import the bundled detector', async () => {
    for (const scriptDir of [
      '.claude/skills/impeccable/scripts',
      '.cursor/skills/impeccable/scripts',
      '.agents/skills/impeccable/scripts',
      'plugin/skills/impeccable/scripts',
    ]) {
      const abs = path.join(REPO_ROOT, scriptDir);
      assert.ok(fs.existsSync(path.join(abs, 'detector', 'detect-antipatterns.mjs')),
        `detector bundle missing in ${scriptDir}`);
      const hookLib = await import(pathToFileURL(path.join(abs, 'hook-lib.mjs')));
      const detector = await hookLib.loadDetector();
      assert.equal(typeof detector.detectText, 'function');
    }
  });
});
