/**
 * Integration tests for the design-hook build pipeline.
 * Run: node --test tests/hook-build.test.mjs
 *
 * Verifies that:
 *   - Claude/Codex hook manifests have the right shape, matcher, timeouts,
 *     and command/args. (Pure unit test against the builders — no FS dep.)
 *   - The committed build artifacts (`plugin/hooks/hooks.json`,
 *     `.agents/hooks/hooks.json`, `.codex-plugin/plugin.json`) exist and
 *     parse, and reference the bundled hook scripts that are also present.
 *
 * Both halves matter: the builder test catches regressions in the schema we
 * emit, and the artifact test catches "we forgot to commit the regenerated
 * files" mistakes before they reach users.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildClaudeHooksManifest,
  buildCodexHooksManifest,
  buildCodexPluginManifest,
  hooksJsonFor,
} from '../scripts/lib/transformers/hooks.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('buildClaudeHooksManifest()', () => {
  const m = buildClaudeHooksManifest();

  it('declares PostToolUse with Edit|Write|MultiEdit matcher', () => {
    const ptu = m.hooks.PostToolUse;
    assert.ok(Array.isArray(ptu) && ptu.length === 1);
    assert.equal(ptu[0].matcher, 'Edit|Write|MultiEdit');
  });

  it('uses exec form (command + args) — never shell form', () => {
    const handler = m.hooks.PostToolUse[0].hooks[0];
    assert.equal(handler.type, 'command');
    assert.equal(handler.command, 'node');
    assert.ok(Array.isArray(handler.args) && handler.args.length === 1);
    // Avoid bare-string `command: "node /path/script.mjs"` which breaks under
    // Windows .cmd shims and tokenizes paths with spaces.
    assert.ok(!('script' in handler));
  });

  it('points args at the bundled hook.mjs under ${CLAUDE_PLUGIN_ROOT}', () => {
    const arg = m.hooks.PostToolUse[0].hooks[0].args[0];
    assert.ok(arg.startsWith('${CLAUDE_PLUGIN_ROOT}/'), arg);
    assert.ok(arg.endsWith('/skills/impeccable/scripts/hook.mjs'), arg);
  });

  it('declares the if: glob covering the documented extensions', () => {
    const ifGlob = m.hooks.PostToolUse[0].hooks[0].if;
    assert.ok(ifGlob.startsWith('Edit('));
    for (const ext of ['tsx', 'jsx', 'html', 'vue', 'svelte', 'astro', 'css', 'scss', 'less', 'ts', 'js']) {
      assert.ok(ifGlob.includes(ext), `if: glob missing ${ext}`);
    }
  });

  it('sets PostToolUse timeout 5s, SessionStart timeout 3s', () => {
    assert.equal(m.hooks.PostToolUse[0].hooks[0].timeout, 5);
    assert.equal(m.hooks.SessionStart[0].hooks[0].timeout, 3);
  });

  it('declares a SessionStart greeting hook', () => {
    const handler = m.hooks.SessionStart[0].hooks[0];
    assert.equal(handler.type, 'command');
    assert.ok(handler.args[0].endsWith('/hook-session-start.mjs'));
  });
});

describe('buildCodexHooksManifest()', () => {
  const m = buildCodexHooksManifest();

  it('uses Edit|Write|apply_patch matcher (Codex tool surface)', () => {
    assert.equal(m.hooks.PostToolUse[0].matcher, 'Edit|Write|apply_patch');
  });

  it('uses ${PLUGIN_ROOT}, not ${CLAUDE_PLUGIN_ROOT}', () => {
    const arg = m.hooks.PostToolUse[0].hooks[0].args[0];
    assert.ok(arg.startsWith('${PLUGIN_ROOT}/'), arg);
    assert.ok(!arg.includes('CLAUDE_PLUGIN_ROOT'));
  });

  it('does not declare an if: glob (Codex has no analog)', () => {
    assert.equal(m.hooks.PostToolUse[0].hooks[0].if, undefined);
  });

  it('does not declare SessionStart (kept Claude-only in v1)', () => {
    assert.equal(m.hooks.SessionStart, undefined);
  });
});

describe('buildCodexPluginManifest()', () => {
  const root = {
    name: 'impeccable',
    description: 'Design fluency',
    version: '3.2.0',
    author: { name: 'Paul' },
    homepage: 'https://impeccable.style',
    repository: 'x',
  };
  const m = buildCodexPluginManifest(root);

  it('echoes name + version, points skills at ./skills/', () => {
    assert.equal(m.name, 'impeccable');
    assert.equal(m.version, '3.2.0');
    assert.equal(m.skills, './skills/');
  });

  it('does NOT declare hooks inline (auto-discovery + duplicate-file guard)', () => {
    assert.equal(m.hooks, undefined);
  });
});

describe('hooksJsonFor()', () => {
  it('routes claude/codex; returns null for others', () => {
    assert.ok(hooksJsonFor('claude'));
    assert.ok(hooksJsonFor('codex'));
    assert.equal(hooksJsonFor('cursor'), null);
  });
});

describe('committed hook artifacts in repo', () => {
  for (const rel of [
    'plugin/hooks/hooks.json',
    '.agents/hooks/hooks.json',
    '.codex-plugin/plugin.json',
  ]) {
    it(`${rel} exists and is valid JSON`, () => {
      const abs = path.join(REPO_ROOT, rel);
      assert.ok(fs.existsSync(abs), `${rel} missing — did you forget bun run build?`);
      assert.doesNotThrow(() => JSON.parse(fs.readFileSync(abs, 'utf-8')));
    });
  }

  it('plugin/hooks/hooks.json references a hook.mjs that is bundled in plugin/skills/', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'plugin/hooks/hooks.json'), 'utf-8'));
    const argPath = manifest.hooks.PostToolUse[0].hooks[0].args[0]
      .replace('${CLAUDE_PLUGIN_ROOT}/', '');
    const bundledScript = path.join(REPO_ROOT, 'plugin', argPath);
    assert.ok(fs.existsSync(bundledScript), `bundled hook script missing: ${bundledScript}`);
  });

  it('.agents/hooks/hooks.json references a hook.mjs that is bundled in .agents/skills/', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, '.agents/hooks/hooks.json'), 'utf-8'));
    const argPath = manifest.hooks.PostToolUse[0].hooks[0].args[0]
      .replace('${PLUGIN_ROOT}/', '');
    const bundledScript = path.join(REPO_ROOT, '.agents', argPath);
    assert.ok(fs.existsSync(bundledScript), `bundled hook script missing: ${bundledScript}`);
  });

  it('hook scripts can import the bundled detector via the relative path they use at runtime', () => {
    const scriptDir = path.join(REPO_ROOT, 'plugin/skills/impeccable/scripts');
    assert.ok(fs.existsSync(path.join(scriptDir, 'detector', 'detect-antipatterns.mjs')),
      'detector bundle missing — hook.mjs would fall back to source path and fail in production install');
  });
});
