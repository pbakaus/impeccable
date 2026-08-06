/**
 * Tests for copyProviderCommands. Mirrors the PR #417 migration guards for the
 * skills path, applied to <provider>/commands. OpenCode discovers custom
 * commands from {command,commands}/**.md in the active config dir, so a
 * global install must target $OPENCODE_CONFIG_DIR/commands, $XDG_CONFIG_HOME/
 * opencode/commands, or ~/.config/opencode/commands (in that order), never
 * ~/.opencode/commands which OpenCode does not scan.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  symlinkSync,
  rmSync,
  realpathSync,
  lstatSync,
} from 'fs';
import { tmpdir } from 'os';

import {
  copyProviderCommands,
  isUpToDate,
  opencodeGlobalConfigDir,
} from '../cli/bin/commands/skills.mjs';

function setupBundleWithCommand(bundleDir, providerName, commandNames) {
  mkdirSync(path.join(bundleDir, providerName, 'commands'), { recursive: true });
  for (const name of commandNames) {
    const file = path.join(bundleDir, providerName, 'commands', `${name}.md`);
    writeFileSync(
      file,
      `description: Impeccable ${name} bridge\nagent: build\nsubtask: true\n\nbody ${name}\n`,
    );
  }
}

beforeEach(() => {
  process.env.IMPECCABLE_BUNDLE_PATH = '';
  delete process.env.OPENCODE_CONFIG_DIR;
  delete process.env.XDG_CONFIG_HOME;
});

afterEach(() => {
  delete process.env.OPENCODE_CONFIG_DIR;
  delete process.env.XDG_CONFIG_HOME;
});

describe('copyProviderCommands', () => {
  test('writes commands to project .opencode/commands by default', () => {
    const bundle = mkdtempSync(path.join(tmpdir(), 'imp-cmd-bundle-'));
    const project = mkdtempSync(path.join(tmpdir(), 'imp-cmd-proj-'));
    setupBundleWithCommand(bundle, '.opencode', ['impeccable']);
    try {
      const written = copyProviderCommands(bundle, project, ['opencode'], { scope: 'project' });
      expect(written).toBe(1);
      const dest = path.join(project, '.opencode', 'commands', 'impeccable.md');
      expect(existsSync(dest)).toBe(true);
      expect(readFileSync(dest, 'utf8')).toContain('impeccable bridge');
    } finally {
      rmSync(bundle, { recursive: true, force: true });
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('writes commands to ~/.config/opencode/commands for global scope', () => {
    const bundle = mkdtempSync(path.join(tmpdir(), 'imp-cmd-bundle-'));
    const home = mkdtempSync(path.join(tmpdir(), 'imp-cmd-home-'));
    setupBundleWithCommand(bundle, '.opencode', ['impeccable']);
    try {
      const written = copyProviderCommands(bundle, home, ['opencode'], { scope: 'user' });
      expect(written).toBe(1);
      const dest = path.join(home, '.config', 'opencode', 'commands', 'impeccable.md');
      expect(existsSync(dest)).toBe(true);
    } finally {
      rmSync(bundle, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('honours OPENCODE_CONFIG_DIR for global scope', () => {
    const bundle = mkdtempSync(path.join(tmpdir(), 'imp-cmd-bundle-'));
    const home = mkdtempSync(path.join(tmpdir(), 'imp-cmd-home-'));
    const customDir = mkdtempSync(path.join(tmpdir(), 'imp-cmd-custom-'));
    setupBundleWithCommand(bundle, '.opencode', ['impeccable']);
    try {
      process.env.OPENCODE_CONFIG_DIR = customDir;
      const written = copyProviderCommands(bundle, home, ['opencode'], { scope: 'user' });
      expect(written).toBe(1);
      const dest = path.join(customDir, 'commands', 'impeccable.md');
      expect(existsSync(dest)).toBe(true);
      expect(existsSync(path.join(home, '.config', 'opencode', 'commands'))).toBe(false);
    } finally {
      rmSync(bundle, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
      rmSync(customDir, { recursive: true, force: true });
    }
  });

  test('honours XDG_CONFIG_HOME/opencode/commands when OPENCODE_CONFIG_DIR is unset', () => {
    const bundle = mkdtempSync(path.join(tmpdir(), 'imp-cmd-bundle-'));
    const home = mkdtempSync(path.join(tmpdir(), 'imp-cmd-home-'));
    const xdgRoot = mkdtempSync(path.join(tmpdir(), 'imp-cmd-xdg-'));
    setupBundleWithCommand(bundle, '.opencode', ['impeccable']);
    try {
      process.env.XDG_CONFIG_HOME = xdgRoot;
      const written = copyProviderCommands(bundle, home, ['opencode'], { scope: 'user' });
      expect(written).toBe(1);
      const dest = path.join(xdgRoot, 'opencode', 'commands', 'impeccable.md');
      expect(existsSync(dest)).toBe(true);
    } finally {
      rmSync(bundle, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
      rmSync(xdgRoot, { recursive: true, force: true });
    }
  });

  test('migrates legacy ~/.opencode/commands entries without disturbing siblings', () => {
    const bundle = mkdtempSync(path.join(tmpdir(), 'imp-cmd-bundle-'));
    const home = mkdtempSync(path.join(tmpdir(), 'imp-cmd-home-'));
    setupBundleWithCommand(bundle, '.opencode', ['impeccable']);
    // Pre-seed a legacy copy with both a command we want to replace and a
    // sibling the install must NOT touch.
    const legacyDir = path.join(home, '.opencode', 'commands');
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(path.join(legacyDir, 'impeccable.md'), 'stale impeccable\n');
    writeFileSync(path.join(legacyDir, 'unrelated-command.md'), 'unrelated\n');
    try {
      const written = copyProviderCommands(bundle, home, ['opencode'], { scope: 'user' });
      expect(written).toBe(1);
      const dest = path.join(home, '.config', 'opencode', 'commands', 'impeccable.md');
      expect(existsSync(dest)).toBe(true);
      expect(existsSync(path.join(legacyDir, 'impeccable.md'))).toBe(false);
      expect(existsSync(path.join(legacyDir, 'unrelated-command.md'))).toBe(true);
      expect(readFileSync(path.join(legacyDir, 'unrelated-command.md'), 'utf8')).toBe('unrelated\n');
    } finally {
      rmSync(bundle, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('does not migrate a symlinked legacy dir (shared storage)', () => {
    const bundle = mkdtempSync(path.join(tmpdir(), 'imp-cmd-bundle-'));
    const home = mkdtempSync(path.join(tmpdir(), 'imp-cmd-home-'));
    const shared = mkdtempSync(path.join(tmpdir(), 'imp-cmd-shared-'));
    setupBundleWithCommand(bundle, '.opencode', ['impeccable']);
    mkdirSync(path.join(home, '.opencode'), { recursive: true });
    symlinkSync(shared, path.join(home, '.opencode', 'commands'), 'dir');
    writeFileSync(path.join(shared, 'unrelated-command.md'), 'unrelated\n');
    try {
      copyProviderCommands(bundle, home, ['opencode'], { scope: 'user' });
      expect(existsSync(path.join(shared, 'unrelated-command.md'))).toBe(true);
      expect(lstatSync(path.join(home, '.opencode', 'commands')).isSymbolicLink()).toBe(true);
    } finally {
      rmSync(bundle, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
      rmSync(shared, { recursive: true, force: true });
    }
  });

  test('returns 0 when the bundle has no commands dir', () => {
    const bundle = mkdtempSync(path.join(tmpdir(), 'imp-cmd-bundle-'));
    const project = mkdtempSync(path.join(tmpdir(), 'imp-cmd-proj-'));
    try {
      const written = copyProviderCommands(bundle, project, ['opencode'], { scope: 'project' });
      expect(written).toBe(0);
      expect(existsSync(path.join(project, '.opencode', 'commands'))).toBe(false);
    } finally {
      rmSync(bundle, { recursive: true, force: true });
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('ignores providers without a commands directory', () => {
    const bundle = mkdtempSync(path.join(tmpdir(), 'imp-cmd-bundle-'));
    const project = mkdtempSync(path.join(tmpdir(), 'imp-cmd-proj-'));
    mkdirSync(path.join(bundle, 'claude'), { recursive: true });
    try {
      const written = copyProviderCommands(bundle, project, ['claude'], { scope: 'project' });
      expect(written).toBe(0);
    } finally {
      rmSync(bundle, { recursive: true, force: true });
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe('isUpToDate command awareness', () => {
  function setupBundleWithSkill(bundleDir, providerName, { withCommands = true } = {}) {
    const skillDir = path.join(bundleDir, providerName, 'skills', 'impeccable');
    mkdirSync(path.join(skillDir, 'scripts'), { recursive: true });
    writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: impeccable\n---\nBundle skill.\n');
    writeFileSync(path.join(skillDir, 'scripts', 'context.mjs'), 'console.log("bundle");\n');
    if (withCommands) setupBundleWithCommand(bundleDir, providerName, ['impeccable']);
  }

  function mirrorBundleSkills(bundleDir, root, providerName) {
    fs.cpSync(
      path.join(bundleDir, providerName, 'skills'),
      path.join(root, providerName, 'skills'),
      { recursive: true },
    );
  }

  function mirrorBundleCommands(bundleDir, root, providerName) {
    fs.cpSync(
      path.join(bundleDir, providerName, 'commands'),
      path.join(root, providerName, 'commands'),
      { recursive: true },
    );
  }

  test('returns false when skills match but the command bridge is missing', () => {
    const bundle = mkdtempSync(path.join(tmpdir(), 'imp-cmd-bundle-'));
    const project = mkdtempSync(path.join(tmpdir(), 'imp-cmd-proj-'));
    setupBundleWithSkill(bundle, '.opencode');
    mirrorBundleSkills(bundle, project, '.opencode');
    try {
      expect(isUpToDate(project, ['.opencode'], bundle, 'project')).toBe(false);
    } finally {
      rmSync(bundle, { recursive: true, force: true });
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('returns true when skills and commands match the bundle', () => {
    const bundle = mkdtempSync(path.join(tmpdir(), 'imp-cmd-bundle-'));
    const project = mkdtempSync(path.join(tmpdir(), 'imp-cmd-proj-'));
    setupBundleWithSkill(bundle, '.opencode');
    mirrorBundleSkills(bundle, project, '.opencode');
    mirrorBundleCommands(bundle, project, '.opencode');
    try {
      expect(isUpToDate(project, ['.opencode'], bundle, 'project')).toBe(true);
    } finally {
      rmSync(bundle, { recursive: true, force: true });
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('returns false when the command bridge content drifted', () => {
    const bundle = mkdtempSync(path.join(tmpdir(), 'imp-cmd-bundle-'));
    const project = mkdtempSync(path.join(tmpdir(), 'imp-cmd-proj-'));
    setupBundleWithSkill(bundle, '.opencode');
    mirrorBundleSkills(bundle, project, '.opencode');
    mirrorBundleCommands(bundle, project, '.opencode');
    writeFileSync(path.join(project, '.opencode', 'commands', 'impeccable.md'), 'user edit drift\n');
    try {
      expect(isUpToDate(project, ['.opencode'], bundle, 'project')).toBe(false);
    } finally {
      rmSync(bundle, { recursive: true, force: true });
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('ignores local-only command files such as pinned shortcuts', () => {
    const bundle = mkdtempSync(path.join(tmpdir(), 'imp-cmd-bundle-'));
    const project = mkdtempSync(path.join(tmpdir(), 'imp-cmd-proj-'));
    setupBundleWithSkill(bundle, '.opencode');
    mirrorBundleSkills(bundle, project, '.opencode');
    mirrorBundleCommands(bundle, project, '.opencode');
    writeFileSync(path.join(project, '.opencode', 'commands', 'impeccable-audit.md'), 'pinned\n');
    try {
      expect(isUpToDate(project, ['.opencode'], bundle, 'project')).toBe(true);
    } finally {
      rmSync(bundle, { recursive: true, force: true });
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('ignores providers whose bundle has no commands directory', () => {
    const bundle = mkdtempSync(path.join(tmpdir(), 'imp-cmd-bundle-'));
    const project = mkdtempSync(path.join(tmpdir(), 'imp-cmd-proj-'));
    setupBundleWithSkill(bundle, '.opencode', { withCommands: false });
    mirrorBundleSkills(bundle, project, '.opencode');
    try {
      expect(isUpToDate(project, ['.opencode'], bundle, 'project')).toBe(true);
    } finally {
      rmSync(bundle, { recursive: true, force: true });
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('user scope resolves the commands dir via OPENCODE_CONFIG_DIR', () => {
    const bundle = mkdtempSync(path.join(tmpdir(), 'imp-cmd-bundle-'));
    const home = mkdtempSync(path.join(tmpdir(), 'imp-cmd-home-'));
    const custom = mkdtempSync(path.join(tmpdir(), 'imp-cmd-custom-'));
    setupBundleWithSkill(bundle, '.opencode');
    process.env.OPENCODE_CONFIG_DIR = custom;
    // User-scope OpenCode skills live at <config>/skills (HOME_SKILLS_DIR_OVERRIDES).
    fs.cpSync(path.join(bundle, '.opencode', 'skills'), path.join(custom, 'skills'), { recursive: true });
    try {
      expect(isUpToDate(home, ['.opencode'], bundle, 'user')).toBe(false);
      fs.cpSync(path.join(bundle, '.opencode', 'commands'), path.join(custom, 'commands'), { recursive: true });
      expect(isUpToDate(home, ['.opencode'], bundle, 'user')).toBe(true);
    } finally {
      rmSync(bundle, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
      rmSync(custom, { recursive: true, force: true });
    }
  });
});
