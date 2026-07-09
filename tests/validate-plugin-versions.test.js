/**
 * Unit coverage for the plugin/skill version-drift guard (issue #274).
 *
 * The Claude Code marketplace installs from the committed `./plugin` subtree,
 * so a version disagreement between the hand-edited manifests and the
 * generated subtree ships stale content under a wrong version number. The
 * guard treats root `.claude-plugin/plugin.json` as the source of truth and
 * flags any other version-bearing file that disagrees.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  collectPluginVersions,
  readSkillFrontmatterVersion,
} from '../scripts/lib/validate-plugin-versions.js';

function skillMd(version) {
  return `---\nname: impeccable\nversion: ${version}\nuser-invocable: true\n---\n\nBody.\n`;
}

function writeFixture(root, { plugin, marketplace, subtreePlugin, codexPlugin, skill } = {}) {
  const write = (rel, contents) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  };
  if (plugin !== undefined) {
    write('.claude-plugin/plugin.json', JSON.stringify({ name: 'impeccable', version: plugin }, null, 2));
  }
  if (marketplace !== undefined) {
    write('.claude-plugin/marketplace.json', JSON.stringify({ plugins: [{ name: 'impeccable', version: marketplace }] }, null, 2));
  }
  if (subtreePlugin !== undefined) {
    write('plugin/.claude-plugin/plugin.json', JSON.stringify({ name: 'impeccable', version: subtreePlugin, skills: './skills/' }, null, 2));
  }
  if (codexPlugin !== undefined) {
    write('dist/openai/impeccable/.codex-plugin/plugin.json', JSON.stringify({ name: 'impeccable', version: codexPlugin, skills: './skills/' }, null, 2));
  }
  if (skill !== undefined) {
    write('plugin/skills/impeccable/SKILL.md', skillMd(skill));
  }
}

describe('collectPluginVersions', () => {
  let root;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-ver-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('no mismatches when every version agrees', () => {
    writeFixture(root, { plugin: '3.7.1', marketplace: '3.7.1', subtreePlugin: '3.7.1', codexPlugin: '3.7.1', skill: '3.7.1' });
    const { source, mismatches } = collectPluginVersions(root);
    expect(source).toBe('3.7.1');
    expect(mismatches).toEqual([]);
  });

  test('flags a lagging marketplace.json (the half the sync workflow cannot repair)', () => {
    writeFixture(root, { plugin: '3.7.1', marketplace: '3.1.1', subtreePlugin: '3.7.1', skill: '3.7.1' });
    const { mismatches } = collectPluginVersions(root);
    expect(mismatches).toEqual([
      { relPath: '.claude-plugin/marketplace.json', found: '3.1.1', expected: '3.7.1' },
    ]);
  });

  test('flags a stale ./plugin subtree manifest', () => {
    writeFixture(root, { plugin: '3.7.1', marketplace: '3.7.1', subtreePlugin: '3.6.0', skill: '3.7.1' });
    const { mismatches } = collectPluginVersions(root);
    expect(mismatches).toEqual([
      { relPath: 'plugin/.claude-plugin/plugin.json', found: '3.6.0', expected: '3.7.1' },
    ]);
  });

  test('flags a stale Codex plugin manifest', () => {
    writeFixture(root, { plugin: '3.7.1', marketplace: '3.7.1', subtreePlugin: '3.7.1', codexPlugin: '3.6.0', skill: '3.7.1' });
    const { mismatches } = collectPluginVersions(root);
    expect(mismatches).toEqual([
      { relPath: 'dist/openai/impeccable/.codex-plugin/plugin.json', found: '3.6.0', expected: '3.7.1' },
    ]);
  });

  test('flags a stale bundled SKILL.md frontmatter version', () => {
    writeFixture(root, { plugin: '3.7.1', marketplace: '3.7.1', subtreePlugin: '3.7.1', skill: '3.1.1' });
    const { mismatches } = collectPluginVersions(root);
    expect(mismatches).toEqual([
      { relPath: 'plugin/skills/impeccable/SKILL.md', found: '3.1.1', expected: '3.7.1' },
    ]);
  });

  test('reports every drifted file at once', () => {
    writeFixture(root, { plugin: '3.7.1', marketplace: '3.1.1', subtreePlugin: '3.5.0', skill: '3.1.1' });
    const { mismatches } = collectPluginVersions(root);
    expect(mismatches.map((m) => m.relPath)).toEqual([
      '.claude-plugin/marketplace.json',
      'plugin/.claude-plugin/plugin.json',
      'plugin/skills/impeccable/SKILL.md',
    ]);
  });

  test('skips files that do not exist instead of throwing', () => {
    writeFixture(root, { plugin: '3.7.1' }); // only root manifest present
    const { source, checked, mismatches, errors } = collectPluginVersions(root);
    expect(source).toBe('3.7.1');
    expect(checked).toEqual([]);
    expect(mismatches).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('returns a null source with no errors when root plugin.json is absent', () => {
    const { source, mismatches, errors } = collectPluginVersions(root);
    expect(source).toBeNull();
    expect(mismatches).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('reports a malformed checked manifest as an error instead of throwing', () => {
    writeFixture(root, { plugin: '3.7.1', subtreePlugin: '3.7.1', skill: '3.7.1' });
    // marketplace.json half-edited mid-bump: invalid JSON.
    fs.writeFileSync(path.join(root, '.claude-plugin/marketplace.json'), '{ "plugins": [ { "version": ');
    const { mismatches, errors } = collectPluginVersions(root);
    expect(mismatches).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0].relPath).toBe('.claude-plugin/marketplace.json');
    expect(errors[0].reason).toMatch(/parse/i);
  });

  test('reports a malformed root plugin.json as an error, not a thrown stack', () => {
    fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude-plugin/plugin.json'), '{ not json');
    const { source, errors } = collectPluginVersions(root);
    expect(source).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0].relPath).toBe('.claude-plugin/plugin.json');
    expect(errors[0].reason).toMatch(/parse/i);
  });

  test('flags a root plugin.json that exists but has no version field', () => {
    fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'impeccable' }));
    const { source, errors } = collectPluginVersions(root);
    // source stays null, but it is reported as an error rather than silently passing.
    expect(source).toBeNull();
    expect(errors).toEqual([{ relPath: '.claude-plugin/plugin.json', reason: 'missing "version" field' }]);
  });
});

describe('readSkillFrontmatterVersion', () => {
  test('reads an unquoted version', () => {
    expect(readSkillFrontmatterVersion(skillMd('3.7.1'))).toBe('3.7.1');
  });

  test('strips surrounding quotes', () => {
    expect(readSkillFrontmatterVersion('---\nversion: "3.7.1"\n---\n')).toBe('3.7.1');
  });

  test('returns null when there is no frontmatter block', () => {
    expect(readSkillFrontmatterVersion('no frontmatter here')).toBeNull();
  });

  test('reads a version from CRLF-encoded frontmatter', () => {
    const crlf = '---\r\nname: impeccable\r\nversion: 3.7.1\r\nuser-invocable: true\r\n---\r\n\r\nBody.\r\n';
    expect(readSkillFrontmatterVersion(crlf)).toBe('3.7.1');
  });
});

describe('collectPluginVersions with CRLF line endings', () => {
  let root;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-ver-crlf-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('a CRLF-saved SKILL.md at the right version is not a false mismatch', () => {
    writeFixture(root, { plugin: '3.7.1', marketplace: '3.7.1', subtreePlugin: '3.7.1', skill: '3.7.1' });
    // Re-save the bundled SKILL.md with CRLF line endings.
    const skillPath = path.join(root, 'plugin/skills/impeccable/SKILL.md');
    fs.writeFileSync(skillPath, fs.readFileSync(skillPath, 'utf-8').replace(/\n/g, '\r\n'));
    const { mismatches, errors } = collectPluginVersions(root);
    expect(mismatches).toEqual([]);
    expect(errors).toEqual([]);
  });
});
