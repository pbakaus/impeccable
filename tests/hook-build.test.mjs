/**
 * Integration tests for the design-hook build pipeline.
 * Run: node --test tests/hook-build.test.mjs
 *
 * Verifies that:
 *   - Claude/Codex hook manifests have the right shape, matcher, timeouts,
 *     and command/args. (Pure unit test against the builders — no FS dep.)
 *   - The committed build artifacts (`plugin/hooks/hooks.json`,
 *     `.agents/hooks/hooks.json`, `plugin/.codex-plugin/plugin.json`) exist and
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
  buildCursorHooksManifest,
  buildCodexPluginManifest,
  hooksJsonFor,
} from '../scripts/lib/transformers/hooks.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('buildClaudeHooksManifest()', () => {
  const m = buildClaudeHooksManifest();

  it('declares a single PostToolUse matcher group for direct-edit tools', () => {
    // Single matcher group covers Edit/Write/MultiEdit on Claude Code
    // and apply_patch on Codex. Claude sends `tool_input.file_path`;
    // Codex `apply_patch` sends the patch in `tool_input.command` (parsed
    // in hook-lib.mjs). The earlier `mcp__node_repl__.*` sweep group was
    // removed in v5: it required git-status fallback, only worked
    // inside git repos, and emitted confusing "look at unrelated work"
    // nudges when the model touched files outside the current task.
    const ptu = m.hooks.PostToolUse;
    assert.ok(Array.isArray(ptu) && ptu.length === 1, `expected 1 group, got ${ptu?.length}`);
    assert.equal(ptu[0].matcher, 'Edit|Write|MultiEdit|apply_patch');
  });

  it('uses shell-form command with quoted ${CLAUDE_PLUGIN_ROOT}', () => {
    // Codex only substitutes `${CLAUDE_PLUGIN_ROOT}` / `${PLUGIN_ROOT}` inside
    // the `command` string, not inside `args`. Exec form (command: "node" +
    // args: [...]) ships the literal placeholder to Node and the hook fails
    // with MODULE_NOT_FOUND. Every working hook in claude-plugins-official
    // (posthog, hookify) uses shell form for this reason. Quotes protect
    // plugin roots that contain spaces.
    const expected = 'node "${CLAUDE_PLUGIN_ROOT}/skills/impeccable/scripts/hook.mjs"';
    const handler = m.hooks.PostToolUse[0].hooks[0];
    assert.equal(handler.type, 'command');
    assert.equal(handler.command, expected);
    assert.ok(!('args' in handler), 'shell form must not also set args');
  });

  it('does not declare an if: glob (script filters; Edit-only if would skip Write/MultiEdit)', () => {
    assert.equal(m.hooks.PostToolUse[0].hooks[0].if, undefined);
  });

  it('sets timeouts: 5s PostToolUse, 3s SessionStart', () => {
    assert.equal(m.hooks.PostToolUse[0].hooks[0].timeout, 5);
    assert.equal(m.hooks.SessionStart[0].hooks[0].timeout, 3);
  });

  it('declares a SessionStart greeting hook using shell form', () => {
    const group = m.hooks.SessionStart[0];
    assert.equal(group.matcher, 'startup|resume');
    const handler = group.hooks[0];
    assert.equal(handler.type, 'command');
    assert.equal(
      handler.command,
      'node "${CLAUDE_PLUGIN_ROOT}/skills/impeccable/scripts/hook-session-start.mjs"',
    );
    assert.ok(!('args' in handler));
    assert.equal(handler.statusMessage, 'Loading design hook');
  });
});

describe('buildCodexHooksManifest()', () => {
  const m = buildCodexHooksManifest();

  it('declares a single PostToolUse matcher group (direct-edit only)', () => {
    const ptu = m.hooks.PostToolUse;
    assert.ok(Array.isArray(ptu) && ptu.length === 1);
    // Codex's direct-edit equivalents. apply_patch is the channel
    // Codex uses for almost all file mutations; Edit/Write are present
    // for harness compatibility. The earlier `mcp__node_repl__.*`
    // sweep group was pulled in v5 — see buildClaudeHooksManifest test
    // above for rationale.
    assert.equal(ptu[0].matcher, 'Edit|Write|apply_patch');
  });

  it('uses shell-form command with ${PLUGIN_ROOT}, not ${CLAUDE_PLUGIN_ROOT}', () => {
    const expected = 'node "${PLUGIN_ROOT}/skills/impeccable/scripts/hook.mjs"';
    const handler = m.hooks.PostToolUse[0].hooks[0];
    assert.equal(handler.type, 'command');
    assert.equal(handler.command, expected);
    assert.ok(!handler.command.includes('CLAUDE_PLUGIN_ROOT'));
    assert.ok(!('args' in handler));
  });

  it('does not declare an if: glob (Codex has no analog)', () => {
    assert.equal(m.hooks.PostToolUse[0].hooks[0].if, undefined);
  });

  it('PostToolUse timeout is 5s and exposes statusMessage', () => {
    const handler = m.hooks.PostToolUse[0].hooks[0];
    assert.equal(handler.timeout, 5);
    assert.equal(handler.statusMessage, 'Scanning design');
  });

  it('declares SessionStart with startup|resume matcher and PLUGIN_ROOT', () => {
    const group = m.hooks.SessionStart[0];
    assert.equal(group.matcher, 'startup|resume');
    const handler = group.hooks[0];
    assert.equal(handler.type, 'command');
    assert.equal(
      handler.command,
      'node "${PLUGIN_ROOT}/skills/impeccable/scripts/hook-session-start.mjs"',
    );
    assert.equal(handler.timeout, 3);
    assert.equal(handler.statusMessage, 'Loading design hook');
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

describe('buildCursorHooksManifest()', () => {
  const m = buildCursorHooksManifest();

  it('uses Cursor hooks.json schema (version 1, camelCase events)', () => {
    assert.equal(m.version, 1);
    assert.ok(Array.isArray(m.hooks.afterFileEdit));
    assert.ok(Array.isArray(m.hooks.stop));
    assert.ok(Array.isArray(m.hooks.sessionStart));
    assert.equal(m.hooks.postToolUse, undefined);
    assert.equal(m.hooks.PostToolUse, undefined);
  });

  it('afterFileEdit uses a portable node command + hook-after-edit.mjs', () => {
    const handler = m.hooks.afterFileEdit[0];
    assert.equal(handler.timeout, 5);
    assert.match(handler.command, /^node "/);
    assert.ok(!handler.command.includes('=cursor '));
    assert.ok(handler.command.includes('.cursor/skills/impeccable/scripts/hook-after-edit.mjs'));
  });

  it('stop uses hook-stop.mjs with loop_limit 1', () => {
    const handler = m.hooks.stop[0];
    assert.equal(handler.timeout, 5);
    assert.equal(handler.loop_limit, 1);
    assert.match(handler.command, /^node "/);
    assert.ok(!handler.command.includes('=cursor '));
    assert.ok(handler.command.includes('.cursor/skills/impeccable/scripts/hook-stop.mjs'));
  });

  it('sessionStart uses the session script with a portable node command', () => {
    const handler = m.hooks.sessionStart[0];
    assert.equal(handler.timeout, 3);
    assert.match(handler.command, /^node "/);
    assert.ok(!handler.command.includes('=cursor '));
    assert.ok(handler.command.includes('.cursor/skills/impeccable/scripts/hook-session-start.mjs'));
  });
});

describe('hooksJsonFor()', () => {
  it('routes claude/codex/cursor; returns null for others', () => {
    assert.ok(hooksJsonFor('claude'));
    assert.ok(hooksJsonFor('codex'));
    assert.ok(hooksJsonFor('cursor'));
    assert.equal(hooksJsonFor('gemini'), null);
  });
});

describe('committed hook artifacts in repo', () => {
  for (const rel of [
    'plugin/.codex-plugin/plugin.json',
    'plugin/hooks/hooks.json',
    '.agents/hooks/hooks.json',
    '.cursor/hooks.json',
  ]) {
    it(`${rel} exists and is valid JSON`, () => {
      const abs = path.join(REPO_ROOT, rel);
      assert.ok(fs.existsSync(abs), `${rel} missing — did you forget bun run build?`);
      assert.doesNotThrow(() => JSON.parse(fs.readFileSync(abs, 'utf-8')));
    });
  }

  // Shell-form command shape: `node "${PLUGIN_ROOT}/skills/.../hook.mjs"`.
  // Parse out the quoted path so we can verify the script exists on disk.
  const extractScriptPath = (commandStr, rootPlaceholder) => {
    const match = commandStr.match(/"([^"]+)"/);
    assert.ok(match, `expected quoted script path in command: ${commandStr}`);
    return match[1].replace(`${rootPlaceholder}/`, '');
  };

  it('plugin/.codex-plugin/plugin.json points at plugin-local skills/', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'plugin/.codex-plugin/plugin.json'), 'utf-8'));
    assert.equal(manifest.skills, './skills/');
    assert.ok(fs.existsSync(path.join(REPO_ROOT, 'plugin/skills/impeccable/SKILL.md')));
  });

  it('plugin/hooks/hooks.json references a hook.mjs that is bundled in plugin/skills/', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'plugin/hooks/hooks.json'), 'utf-8'));
    const scriptRel = extractScriptPath(
      manifest.hooks.PostToolUse[0].hooks[0].command,
      '${CLAUDE_PLUGIN_ROOT}',
    );
    const bundledScript = path.join(REPO_ROOT, 'plugin', scriptRel);
    assert.ok(fs.existsSync(bundledScript), `bundled hook script missing: ${bundledScript}`);
  });

  it('.agents/hooks/hooks.json references a hook.mjs that is bundled in .agents/skills/', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, '.agents/hooks/hooks.json'), 'utf-8'));
    const scriptRel = extractScriptPath(
      manifest.hooks.PostToolUse[0].hooks[0].command,
      '${PLUGIN_ROOT}',
    );
    const bundledScript = path.join(REPO_ROOT, '.agents', scriptRel);
    assert.ok(fs.existsSync(bundledScript), `bundled hook script missing: ${bundledScript}`);
  });

  it('.cursor/hooks.json references hook-after-edit.mjs bundled in .cursor/skills/', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, '.cursor/hooks.json'), 'utf-8'));
    const command = manifest.hooks.afterFileEdit[0].command;
    const match = command.match(/node "([^"]+)"/);
    assert.ok(match, `expected quoted script path in command: ${command}`);
    const scriptRel = match[1];
    const bundledScript = path.join(REPO_ROOT, scriptRel);
    assert.ok(fs.existsSync(bundledScript), `bundled hook script missing: ${bundledScript}`);
  });

  it('hook scripts can import the bundled detector via the relative path they use at runtime', () => {
    const scriptDir = path.join(REPO_ROOT, 'plugin/skills/impeccable/scripts');
    assert.ok(fs.existsSync(path.join(scriptDir, 'detector', 'detect-antipatterns.mjs')),
      'detector bundle missing — hook.mjs would fall back to source path and fail in production install');
  });
});
