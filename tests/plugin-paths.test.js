/**
 * Unit coverage for the plugin subtree script-path rewrite (issue #523).
 *
 * The ./plugin subtree copies the dist/claude-code output, whose
 * {{scripts_path}} resolves to the project-relative
 * `.claude/skills/impeccable/scripts`. Run from the plugin cache, that path
 * points into the user's project: a plugin-only user gets MODULE_NOT_FOUND,
 * and a dual-install user silently runs the project's older skill copy. The
 * rewrite swaps every markdown instruction to the `<skill-base-dir>` form
 * and scopes the allowed-tools rule to the skill's own install path.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  rewritePluginMarkdown,
  rewritePluginMarkdownTree,
  CLAUDE_PROJECT_SCRIPTS_PATH,
  PLUGIN_ALLOWED_TOOLS_RULE,
} from '../scripts/lib/plugin-paths.js';

describe('rewritePluginMarkdown', () => {
  test('rewrites a script instruction to the skill-base-dir form', () => {
    const input = 'Run `node .claude/skills/impeccable/scripts/context.mjs` once per session.';
    expect(rewritePluginMarkdown(input)).toBe(
      'Run `node <skill-base-dir>/scripts/context.mjs` once per session.',
    );
  });

  test('rewrites every occurrence, not just the first', () => {
    const input = [
      'node .claude/skills/impeccable/scripts/live.mjs',
      'node .claude/skills/impeccable/scripts/live-poll.mjs --reply EVENT_ID done',
    ].join('\n');
    const output = rewritePluginMarkdown(input);
    expect(output).not.toContain(CLAUDE_PROJECT_SCRIPTS_PATH);
    expect(output).toContain('node <skill-base-dir>/scripts/live.mjs');
    expect(output).toContain('node <skill-base-dir>/scripts/live-poll.mjs --reply EVENT_ID done');
  });

  test('rewrites the allowed-tools rule to the install-path pattern, not a dead literal', () => {
    const frontmatter = [
      'allowed-tools:',
      '  - Bash(npx impeccable *)',
      '  - Bash(node .claude/skills/impeccable/scripts/*)',
    ].join('\n');
    const output = rewritePluginMarkdown(frontmatter);
    // The generic path rewrite alone would leave Bash(node <skill-base-dir>/scripts/*),
    // a rule that matches no real command. The allowed-tools rewrite must win.
    expect(output).toContain(`  - ${PLUGIN_ALLOWED_TOOLS_RULE}`);
    expect(output).not.toContain('Bash(node <skill-base-dir>/scripts/*)');
    expect(output).not.toContain('Bash(node .claude/skills/impeccable/scripts/*)');
    expect(output).toContain('  - Bash(npx impeccable *)');
  });

  test('turns the Setup step 1 fallback parenthetical into the token definition', () => {
    const input =
      "1. Run `node .claude/skills/impeccable/scripts/context.mjs` once per session " +
      "(if the runtime shows this skill's loaded base directory, run `node <skill-base-dir>/scripts/context.mjs`; " +
      "keep cwd at the user's project). Pass a named source file or route as `--target <path>`.";
    const output = rewritePluginMarkdown(input);
    expect(output).toContain('Run `node <skill-base-dir>/scripts/context.mjs` once per session');
    expect(output).toContain("(`<skill-base-dir>` is this skill's loaded base directory");
    // The naive rewrite would leave the same command twice in one sentence.
    expect(output.match(/<skill-base-dir>\/scripts\/context\.mjs/g)).toHaveLength(1);
  });

  test('leaves unrelated project-relative paths alone', () => {
    const input = 'State lives in `.impeccable/live/roots.json` and `.claude/settings.json`.';
    expect(rewritePluginMarkdown(input)).toBe(input);
  });
});

describe('rewritePluginMarkdownTree', () => {
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-plugin-paths-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('rewrites .md files recursively and leaves scripts untouched', () => {
    const write = (rel, contents) => {
      const abs = path.join(root, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, contents);
    };
    write('SKILL.md', 'Run `node .claude/skills/impeccable/scripts/context.mjs`.');
    write('reference/live.md', 'node .claude/skills/impeccable/scripts/live.mjs');
    // hook-admin.mjs installs project-scoped hooks; its project path is correct.
    write(
      'scripts/hook-admin.mjs',
      'const cmd = \'node "${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/hook.mjs"\';',
    );

    rewritePluginMarkdownTree(root);

    expect(fs.readFileSync(path.join(root, 'SKILL.md'), 'utf-8')).toBe(
      'Run `node <skill-base-dir>/scripts/context.mjs`.',
    );
    expect(fs.readFileSync(path.join(root, 'reference/live.md'), 'utf-8')).toBe(
      'node <skill-base-dir>/scripts/live.mjs',
    );
    expect(fs.readFileSync(path.join(root, 'scripts/hook-admin.mjs'), 'utf-8')).toContain(
      '${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/hook.mjs',
    );
  });

  test('is a no-op on a missing directory', () => {
    expect(() => rewritePluginMarkdownTree(path.join(root, 'does-not-exist'))).not.toThrow();
  });
});
