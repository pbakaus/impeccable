/**
 * Integration tests for the design-hook build pipeline.
 * Run: node --test tests/hook-build.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildClaudeSettingsManifest,
  buildClaudePluginHooksManifest,
  buildCodexHooksManifest,
  buildCodexPluginHooksManifest,
  buildCursorHooksManifest,
  buildGitHubHooksManifest,
  buildGrokHooksManifest,
  hooksJsonFor,
} from '../scripts/lib/transformers/hooks.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'));
}

// Every hook command is the launcher shipped in the skill's scripts dir,
// invoked as `<scripts>/impeccable <verb>` behind an existence guard: a
// missing launcher exits 0 (issue #399: user-level manifests fire in every
// project) and a present one keeps its own exit code, so Claude's exit-2
// blocking signal still reaches the agent. No runtime probe: the launcher
// runs a self-contained binary, so there is no Node on the path to check.
function expectCommand(command, expectedScriptsDir, verb = 'hook') {
  assert.equal(typeof command, 'string');
  const launcher = `${expectedScriptsDir}/impeccable`;
  assert.ok(command.includes(launcher), `missing ${launcher} in ${command}`);
  assert.match(
    command,
    new RegExp(`^\\[ ! -f "[^"]*/impeccable" \\] \\|\\| "[^"]*/impeccable" ${verb}$`),
    `missing existence guard around the launcher in ${command}`,
  );
  assert.ok(!command.includes('node '), `hook command must not depend on node: ${command}`);
  assert.ok(!command.includes('.mjs'), `hook command still names a Node script: ${command}`);
}

function expectWindowsCommand(command, expectedScriptsDir, verb = 'hook') {
  assert.equal(typeof command, 'string');
  const launcher = `${expectedScriptsDir}/impeccable.cmd`;
  assert.equal(command, `if exist "${launcher}" ("${launcher}" ${verb} & exit /b)`);
}

function manifestCommands(manifest) {
  const commands = [];
  const walk = (value) => {
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (value && typeof value === 'object') {
      if (typeof value.command === 'string') commands.push(value.command);
      if (typeof value.bash === 'string') commands.push(value.bash);
      Object.values(value).forEach(walk);
    }
  };
  walk(manifest.hooks);
  return commands;
}

describe('hook manifest builders', () => {
  it('builds Claude project settings for the real detector hook', () => {
    const manifest = buildClaudeSettingsManifest();
    const group = manifest.hooks.PostToolUse[0];
    const handler = group.hooks[0];

    assert.equal(group.matcher, 'Edit|Write');
    assert.doesNotMatch(manifest.description, /MultiEdit/);
    assert.equal(handler.type, 'command');
    assert.equal(handler.timeout, 5);
    assert.equal(handler.statusMessage, 'Checking UI changes');
    expectCommand(handler.command, '.claude/skills/impeccable/scripts');
    assert.ok(handler.command.includes('${CLAUDE_PROJECT_DIR}'));
    assert.equal(handler.args, undefined);
    assert.equal(manifest.hooks.SessionStart, undefined);

    // Stop deep pass: same script, no matcher, longer budget.
    const stop = manifest.hooks.Stop[0].hooks[0];
    assert.equal(manifest.hooks.Stop[0].matcher, undefined);
    assert.equal(stop.timeout, 30);
    assert.equal(stop.statusMessage, 'Design deep pass');
    expectCommand(stop.command, '.claude/skills/impeccable/scripts');
  });

  it('builds Codex project-local hooks for the real detector hook', () => {
    // Default install dir is `.codex`: a `.codex`-directory install keeps the
    // skill payload at `.codex/skills/...`, so the hook must point there (not at
    // a hardcoded `.agents`, which no-ops on such installs).
    const manifest = buildCodexHooksManifest();
    assert.equal(manifest.description, undefined);
    const group = manifest.hooks.PostToolUse[0];
    const handler = group.hooks[0];

    assert.equal(group.matcher, 'Edit|Write|apply_patch');
    assert.equal(handler.type, 'command');
    assert.equal(handler.timeout, 5);
    assert.equal(handler.statusMessage, 'Checking UI changes');
    expectCommand(handler.command, '.codex/skills/impeccable/scripts');
    assert.ok(!handler.command.includes('git rev-parse --show-toplevel'));
    assert.ok(!handler.command.includes('${PLUGIN_ROOT}'));
    assert.equal(manifest.hooks.SessionStart, undefined);

    // Codex dispatches a native Stop event (turn scope), so it gets the deep
    // pass too.
    const stop = manifest.hooks.Stop[0].hooks[0];
    assert.equal(stop.timeout, 30);
    expectCommand(stop.command, '.codex/skills/impeccable/scripts');

    // Codex 0.146.0+ selects `commandWindows` on Windows (issue #452), where
    // the POSIX guard is not a command; that form calls impeccable.cmd.
    expectWindowsCommand(handler.commandWindows, '.codex/skills/impeccable/scripts');
    expectWindowsCommand(stop.commandWindows, '.codex/skills/impeccable/scripts');
  });

  it('derives the Codex hook payload path from the install dir', () => {
    // Each install dir gets a manifest pointing at its own skills payload: a
    // `.codex`-directory install at `.codex/skills`, a `.agents` (Codex repo
    // skills) install at `.agents/skills`.
    const codexDir = buildCodexHooksManifest('.codex');
    expectCommand(codexDir.hooks.PostToolUse[0].hooks[0].command, '.codex/skills/impeccable/scripts');
    expectCommand(codexDir.hooks.Stop[0].hooks[0].command, '.codex/skills/impeccable/scripts');

    const agentsDir = buildCodexHooksManifest('.agents');
    expectCommand(agentsDir.hooks.PostToolUse[0].hooks[0].command, '.agents/skills/impeccable/scripts');
    expectCommand(agentsDir.hooks.Stop[0].hooks[0].command, '.agents/skills/impeccable/scripts');
    assert.ok(!agentsDir.hooks.PostToolUse[0].hooks[0].command.includes('.codex/skills'));

    // hooksJsonFor threads the provider's configDir through to the builder.
    expectCommand(
      hooksJsonFor('codex', { configDir: '.agents' }).hooks.PostToolUse[0].hooks[0].command,
      '.agents/skills/impeccable/scripts',
    );
    expectCommand(
      hooksJsonFor('codex').hooks.PostToolUse[0].hooks[0].command,
      '.codex/skills/impeccable/scripts',
    );
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
    expectCommand(beforeEdit.command, '.cursor/skills/impeccable/scripts', 'hook-before-edit');
    assert.equal(beforeEdit.timeout, 5);
  });

  it('builds GitHub Copilot repo-level hooks for the real detector hook', () => {
    const manifest = buildGitHubHooksManifest();
    const entry = manifest.hooks.postToolUse[0];

    // GitHub's schema: flat entries (no nested `hooks`), lowercase event key,
    // `bash`/`timeoutSec`, and a full-match `matcher` against the tool name.
    assert.equal(manifest.version, 1);
    assert.equal(Object.keys(manifest.hooks).length, 1);
    assert.equal(entry.type, 'command');
    assert.equal(entry.matcher, 'edit|create|apply_patch');
    assert.equal(entry.timeoutSec, 5);
    assert.equal(entry.timeout, undefined);
    assert.equal(entry.command, undefined);
    expectCommand(entry.bash, '.github/skills/impeccable/scripts');
    assert.ok(entry.bash.includes('git rev-parse --show-toplevel'));
    assert.equal(manifest.hooks.PostToolUse, undefined);
    assert.equal(manifest.hooks.preToolUse, undefined);
  });

  it('builds Grok Build project hooks for the real detector hook', () => {
    const manifest = buildGrokHooksManifest();
    const group = manifest.hooks.PostToolUse[0];
    const handler = group.hooks[0];

    // Claude-compatible schema; Claude tool names alias to Grok tools at runtime.
    assert.equal(group.matcher, 'Edit|Write|MultiEdit');
    assert.equal(handler.type, 'command');
    assert.equal(handler.timeout, 5);
    assert.equal(handler.statusMessage, 'Checking UI changes');
    expectCommand(handler.command, '.grok/skills/impeccable/scripts');
    assert.ok(!handler.command.includes('${CLAUDE_PROJECT_DIR}'));
    assert.ok(!handler.command.includes('${GROK_PLUGIN_ROOT}'));
    assert.equal(manifest.hooks.SessionStart, undefined);

    const stop = manifest.hooks.Stop[0].hooks[0];
    assert.equal(stop.timeout, 30);
    assert.equal(stop.statusMessage, 'Design deep pass');
    expectCommand(stop.command, '.grok/skills/impeccable/scripts');
  });

  it('emits commandWindows only for Codex-shaped manifests', () => {
    // Codex reads a `commandWindows` sibling; Claude, Cursor, Grok, and Copilot
    // have no per-platform field, and an unknown key is a risk under a strict
    // parser, so it stays off everywhere else.
    const withWindows = [buildCodexHooksManifest(), buildCodexPluginHooksManifest()];
    const without = [
      buildClaudeSettingsManifest(),
      buildClaudePluginHooksManifest(),
      buildCursorHooksManifest(),
      buildGitHubHooksManifest(),
      buildGrokHooksManifest(),
    ];
    const entries = (manifest) => {
      const out = [];
      const walk = (value) => {
        if (Array.isArray(value)) { value.forEach(walk); return; }
        if (value && typeof value === 'object') {
          if (typeof value.command === 'string' || typeof value.bash === 'string') out.push(value);
          Object.values(value).forEach(walk);
        }
      };
      walk(manifest.hooks);
      return out;
    };
    for (const manifest of withWindows) {
      for (const entry of entries(manifest)) {
        assert.equal(typeof entry.commandWindows, 'string', `missing commandWindows in ${JSON.stringify(entry)}`);
        assert.ok(entry.commandWindows.includes('impeccable.cmd'));
      }
    }
    for (const manifest of without) {
      for (const entry of entries(manifest)) {
        assert.equal(entry.commandWindows, undefined, `unexpected commandWindows in ${JSON.stringify(entry)}`);
      }
    }
    for (const manifest of [...withWindows, ...without]) {
      for (const command of manifestCommands(manifest)) {
        assert.ok(!/node|systemMessage|node-unsupported/.test(command), `Node-era fragment in ${command}`);
      }
    }
  });

  it('routes supported hook builders and leaves other providers alone', () => {
    assert.ok(hooksJsonFor('claude'));
    assert.ok(hooksJsonFor('codex'));
    assert.ok(hooksJsonFor('cursor'));
    assert.ok(hooksJsonFor('github'));
    assert.ok(hooksJsonFor('grok'));
    assert.equal(hooksJsonFor('gemini'), null);
  });
});

// The tracked provider outputs are regenerated on main by the sync workflow
// (`bun run build:release`), never in a feature PR. Until that sync lands after
// the launcher swap, the tracked manifests still describe the Node scripts;
// gate these assertions on the synced launcher so a source-first branch is
// not red for output it is not allowed to stage.
const SYNCED = fs.existsSync(path.join(REPO_ROOT, '.claude/skills/impeccable/scripts/impeccable'));

describe('generated hook artifacts in repo', { skip: SYNCED ? false : 'generated provider output not yet synced (bun run build:release on main)' }, () => {
  for (const rel of [
    '.claude/settings.json',
    '.cursor/hooks.json',
    '.codex/hooks.json',
    '.github/hooks/impeccable.json',
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
    assert.deepEqual(readJson('.github/hooks/impeccable.json'), buildGitHubHooksManifest());
  });

  it('Claude project settings reference the launcher in .claude/skills', () => {
    const manifest = readJson('.claude/settings.json');
    const handler = manifest.hooks.PostToolUse[0].hooks[0];

    expectCommand(handler.command, '.claude/skills/impeccable/scripts');
    assert.ok(fs.existsSync(path.join(REPO_ROOT, '.claude/skills/impeccable/scripts')));
  });

  it('Cursor project hooks reference only the pre-write runtime in .cursor/skills', () => {
    const manifest = readJson('.cursor/hooks.json');
    const beforeEdit = manifest.hooks.preToolUse[0];

    assert.equal(Object.keys(manifest.hooks).length, 1);
    expectCommand(beforeEdit.command, '.cursor/skills/impeccable/scripts', 'hook-before-edit');
    assert.ok(fs.existsSync(path.join(REPO_ROOT, '.cursor/skills/impeccable/scripts/impeccable')));
    assert.equal(fs.existsSync(path.join(REPO_ROOT, '.cursor/skills/impeccable/scripts/hook-before-edit.mjs')), false);
  });

  it('Codex project hooks reference the launcher in the .codex skill payload', () => {
    // The committed `.codex/hooks.json` is the distribution artifact for a
    // `.codex`-directory install, whose skill payload lives at `.codex/skills/`
    // (issue: it previously hardcoded `.agents/skills`, so the guarded hook
    // no-opped on `.codex` installs). CLI installs that lay the skill down at
    // `.agents/skills` rewrite the command to that path at install time.
    const manifest = readJson('.codex/hooks.json');
    const handler = manifest.hooks.PostToolUse[0].hooks[0];

    expectCommand(handler.command, '.codex/skills/impeccable/scripts');
    assert.ok(!handler.command.includes('.agents/skills'));

    // The self-consistent Codex bundle at `dist/codex/.codex/skills/` is a build
    // artifact, not a tracked repo file; `bun run build` emits it and
    // build.test.js verifies it there. This suite runs before the build (CI's
    // `test:core` precedes the Build step), so it asserts only tracked outputs.

    // The repo ships the Codex skill payload at `.agents/skills` (the
    // layout CLI installs use, and where the rewritten command resolves).
    assert.ok(fs.existsSync(path.join(REPO_ROOT, '.agents/skills/impeccable/SKILL.md')));
    assert.ok(fs.existsSync(path.join(REPO_ROOT, '.agents/skills/impeccable/scripts')));
  });

  it('GitHub Copilot repo hooks reference the launcher in the .github skill payload', () => {
    const manifest = readJson('.github/hooks/impeccable.json');
    const entry = manifest.hooks.postToolUse[0];

    assert.equal(entry.matcher, 'edit|create|apply_patch');
    expectCommand(entry.bash, '.github/skills/impeccable/scripts');
    assert.ok(fs.existsSync(path.join(REPO_ROOT, '.github/skills/impeccable/SKILL.md')));
    assert.ok(fs.existsSync(path.join(REPO_ROOT, '.github/skills/impeccable/scripts')));
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
      'plugin/.codex-plugin',
      'plugin/assets',
      'plugin-codex',
    ]) {
      assert.equal(fs.existsSync(path.join(REPO_ROOT, rel)), false, `${rel} should not exist`);
    }
  });

  it('packages the Claude design hook in the plugin via plugin-root paths', () => {
    const abs = path.join(REPO_ROOT, 'plugin/hooks/hooks.json');
    assert.ok(fs.existsSync(abs), 'plugin/hooks/hooks.json missing - did you forget bun run build:release?');

    const manifest = readJson('plugin/hooks/hooks.json');
    assert.deepEqual(manifest, buildClaudePluginHooksManifest());
    // Codex loads bundled plugin hooks from this same file and rejects any
    // top-level field other than `hooks` (issue #330).
    assert.equal(manifest.description, undefined);

    const handler = manifest.hooks.PostToolUse[0].hooks[0];
    assert.equal(manifest.hooks.PostToolUse[0].matcher, 'Edit|Write');
    expectCommand(handler.command, 'skills/impeccable/scripts');
    // Resolves relative to the installed plugin, not a `.claude/skills/` layout.
    assert.ok(handler.command.includes('${CLAUDE_PLUGIN_ROOT}'),
      `plugin hook command must use $\{CLAUDE_PLUGIN_ROOT}: ${handler.command}`);
    assert.ok(!handler.command.includes('${CLAUDE_PROJECT_DIR}'),
      `plugin hook command must not use $\{CLAUDE_PROJECT_DIR}: ${handler.command}`);

    // Stop deep pass ships in the plugin manifest too, plugin-root-relative.
    const stop = manifest.hooks.Stop[0].hooks[0];
    assert.equal(stop.timeout, 30);
    expectCommand(stop.command, 'skills/impeccable/scripts');
    assert.ok(stop.command.includes('${CLAUDE_PLUGIN_ROOT}'));

    // The script the plugin hook points at must ship inside the plugin payload.
    assert.ok(fs.existsSync(path.join(REPO_ROOT, 'plugin/skills/impeccable/scripts')));
  });

  it('generated skill payloads ship the executable launcher and no Node scripts', () => {
    for (const scriptDir of [
      '.claude/skills/impeccable/scripts',
      '.cursor/skills/impeccable/scripts',
      '.agents/skills/impeccable/scripts',
      'plugin/skills/impeccable/scripts',
    ]) {
      const abs = path.join(REPO_ROOT, scriptDir);
      const launcher = path.join(abs, 'impeccable');
      assert.ok(fs.existsSync(launcher), `launcher missing in ${scriptDir}`);
      if (process.platform !== 'win32') {
        assert.ok(fs.statSync(launcher).mode & 0o111, `launcher not executable in ${scriptDir}`);
      }
      assert.ok(fs.existsSync(path.join(abs, 'impeccable.cmd')), `impeccable.cmd missing in ${scriptDir}`);
      assert.ok(fs.existsSync(path.join(abs, 'VERSION')), `VERSION missing in ${scriptDir}`);
      assert.equal(fs.existsSync(path.join(abs, 'bin')), false, `${scriptDir} must stay launcher-only in git; binaries ship only in IMPECCABLE_BUNDLE_ENGINE=1 release zips`);
      const stray = fs.readdirSync(abs).filter((f) => f.endsWith('.mjs') || f === 'detector' || f === 'lib');
      assert.deepEqual(stray, [], `Node-era files still in ${scriptDir}`);
    }
  });
});
