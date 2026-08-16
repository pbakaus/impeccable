/**
 * Unit coverage for the plugin subtree script-path rewrite (issue #523).
 *
 * The ./plugin subtree copies the dist/claude-code output, whose
 * {{scripts_path}} resolves to the project-relative
 * `.claude/skills/impeccable/scripts`. Run from the plugin cache, that path
 * points into the user's project: a plugin-only user gets MODULE_NOT_FOUND,
 * and a dual-install user silently runs the project's older skill copy. The
 * rewrite swaps every markdown instruction to the `<skill-base-dir>` form
 * and drops the node pre-approval: no frontmatter rule can bind approval to
 * the loaded plugin root, and an unbound wildcard would auto-approve any
 * same-shaped path anywhere on disk.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  rewritePluginMarkdown,
  rewritePluginMarkdownTree,
  verifyPluginSkillRewrite,
  CLAUDE_PROJECT_SCRIPTS_PATH,
} from '../scripts/lib/plugin-paths.js';

describe('rewritePluginMarkdown', () => {
  test('rewrites a script instruction to the quoted skill-base-dir form', () => {
    const input = 'Run `node .claude/skills/impeccable/scripts/context.mjs` once per session.';
    expect(rewritePluginMarkdown(input)).toBe(
      'Run `node "<skill-base-dir>/scripts/context.mjs"` once per session.',
    );
  });

  test('rewrites every occurrence, quoting the script path but not the arguments', () => {
    const input = [
      'node .claude/skills/impeccable/scripts/live.mjs',
      'node .claude/skills/impeccable/scripts/live-poll.mjs --reply EVENT_ID done',
    ].join('\n');
    const output = rewritePluginMarkdown(input);
    expect(output).not.toContain(CLAUDE_PROJECT_SCRIPTS_PATH);
    expect(output).toContain('node "<skill-base-dir>/scripts/live.mjs"');
    expect(output).toContain('node "<skill-base-dir>/scripts/live-poll.mjs" --reply EVENT_ID done');
  });

  test('quotes commands already in the skill-base-dir form without double-quoting', () => {
    // SKILL.src.md's Setup step 1 carries the token form natively; a base
    // directory with spaces splits an unquoted path before node sees it.
    const input =
      'Run `node <skill-base-dir>/scripts/context.mjs` once per session. ' +
      'Already quoted: `node "<skill-base-dir>/scripts/detect.mjs"`.';
    expect(rewritePluginMarkdown(input)).toBe(
      'Run `node "<skill-base-dir>/scripts/context.mjs"` once per session. ' +
      'Already quoted: `node "<skill-base-dir>/scripts/detect.mjs"`.',
    );
  });

  test('removes the node pre-approval instead of widening it', () => {
    const frontmatter = [
      'allowed-tools:',
      '  - Bash(npx impeccable *)',
      '  - Bash(node .claude/skills/impeccable/scripts/*)',
      '---',
      '',
    ].join('\n');
    const output = rewritePluginMarkdown(frontmatter);
    // The generic path rewrite alone would leave Bash(node <skill-base-dir>/scripts/*),
    // a dead literal, and any wildcard replacement would auto-approve
    // same-shaped paths outside the plugin. The line must go entirely.
    expect(output).not.toContain('Bash(node ');
    expect(output).toContain('  - Bash(npx impeccable *)\n---');
  });

  test('drops the project-path fallback clause from Setup step 1', () => {
    const input =
      '1. Run `node <skill-base-dir>/scripts/context.mjs` once per session, where `<skill-base-dir>` is the ' +
      "loaded base directory the runtime reports for this skill; keep cwd at the user's project. " +
      'That base directory resolves every `node .claude/skills/impeccable/scripts/...` command in this skill ' +
      'and its references, and `.claude/skills/impeccable/scripts` is the fallback only when the runtime ' +
      'reports no base directory. Pass a named source file or route as `--target <path>`.';
    const output = rewritePluginMarkdown(input);
    expect(output).toContain(
      'Every `node "<skill-base-dir>/scripts/..."` command in this skill and its references resolves against that base directory.',
    );
    // The naive rewrite would keep the fallback clause and name the token as
    // its own fallback for when there is no base directory to resolve it.
    expect(output).not.toContain('fallback');
    expect(output).not.toContain(CLAUDE_PROJECT_SCRIPTS_PATH);
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
      'Run `node "<skill-base-dir>/scripts/context.mjs"`.',
    );
    expect(fs.readFileSync(path.join(root, 'reference/live.md'), 'utf-8')).toBe(
      'node "<skill-base-dir>/scripts/live.mjs"',
    );
    expect(fs.readFileSync(path.join(root, 'scripts/hook-admin.mjs'), 'utf-8')).toContain(
      '${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/hook.mjs',
    );
  });

  test('is a no-op on a missing directory', () => {
    expect(() => rewritePluginMarkdownTree(path.join(root, 'does-not-exist'))).not.toThrow();
  });
});

describe('verifyPluginSkillRewrite', () => {
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-plugin-verify-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const writeSkill = (contents) => {
    const p = path.join(root, 'SKILL.md');
    fs.writeFileSync(p, contents);
    return p;
  };

  const goodSkill = [
    'allowed-tools:',
    '  - Bash(node .claude/skills/impeccable/scripts/*)',
    '',
    '1. Run `node <skill-base-dir>/scripts/context.mjs` once per session, where `<skill-base-dir>` is the ' +
      "loaded base directory the runtime reports for this skill; keep cwd at the user's project. " +
      'That base directory resolves every `node .claude/skills/impeccable/scripts/...` command in this skill ' +
      'and its references, and `.claude/skills/impeccable/scripts` is the fallback only when the runtime ' +
      'reports no base directory.',
  ].join('\n');

  test('accepts a correctly rewritten SKILL.md', () => {
    const p = writeSkill(rewritePluginMarkdown(goodSkill));
    expect(() => verifyPluginSkillRewrite(p)).not.toThrow();
  });

  test('fails the build when the Setup fallback sentence no longer matched', () => {
    // Simulate SKILL.src.md rewording step 1: the sentence replacement
    // no-ops, so the plugin copy keeps the project path as its fallback.
    const reworded = goodSkill.replace('is the fallback only when', 'is used only when');
    const p = writeSkill(rewritePluginMarkdown(reworded));
    expect(() => verifyPluginSkillRewrite(p)).toThrow(/Setup step 1 fallback sentence/);
  });

  test('fails the build when a node pre-approval survives the removal', () => {
    const reworded = goodSkill.replace(
      'Bash(node .claude/skills/impeccable/scripts/*)',
      'Bash(node .claude/skills/impeccable/scripts/**)',
    );
    const p = writeSkill(rewritePluginMarkdown(reworded));
    expect(() => verifyPluginSkillRewrite(p)).toThrow(/pre-approves a node script path/);
  });

  test('fails the build when the project-relative scripts path survives at all', () => {
    // Simulate a path shape the replacements don't know: the rewritten copy
    // still names the project scripts directory somewhere new.
    const p = writeSkill(
      rewritePluginMarkdown(goodSkill) +
      '\nState lives next to `.claude/skills/impeccable/scripts` on disk.',
    );
    expect(() => verifyPluginSkillRewrite(p)).toThrow(/still contains the project-relative scripts path/);
  });
});
