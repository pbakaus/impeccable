import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const PIN_SCRIPT = path.join(ROOT, 'skill', 'scripts', 'pin.mjs');

// Neutralize any real user-scope OpenCode config so tests never write into the
// developer's actual global install. Points the resolution at a path that does
// not exist unless a test creates it.
function cleanEnv(overrides = {}) {
  return {
    ...process.env,
    OPENCODE_CONFIG_DIR: path.join(os.tmpdir(), 'impeccable-pin-no-config'),
    XDG_CONFIG_HOME: path.join(os.tmpdir(), 'impeccable-pin-no-xdg'),
    ...overrides,
  };
}

describe('pin command provider syntax', () => {
  let project;

  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-pin-'));
    fs.writeFileSync(path.join(project, 'package.json'), '{}\n');
    for (const harness of ['.claude', '.cursor', '.agents', '.codex']) {
      fs.mkdirSync(path.join(project, harness, 'skills', 'impeccable'), { recursive: true });
    }
  });

  afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
  });

  it('renders each pinned shortcut for its target harness', () => {
    const result = spawnSync(process.execPath, [PIN_SCRIPT, 'pin', 'audit'], {
      cwd: project,
      encoding: 'utf8',
      env: cleanEnv(),
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);

    for (const harness of ['.claude', '.cursor']) {
      const skill = fs.readFileSync(path.join(project, harness, 'skills', 'audit', 'SKILL.md'), 'utf8');
      assert.match(skill, /\/impeccable audit/);
      assert.doesNotMatch(skill, /\$impeccable audit/);
    }

    for (const harness of ['.agents', '.codex']) {
      const skill = fs.readFileSync(path.join(project, harness, 'skills', 'audit', 'SKILL.md'), 'utf8');
      assert.match(skill, /\$impeccable audit/);
      assert.doesNotMatch(skill, /\/impeccable audit/);
    }
  });
});

describe('pin command OpenCode target', () => {
  let project;

  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-pin-oc-'));
    fs.writeFileSync(path.join(project, 'package.json'), '{}\n');
    fs.mkdirSync(path.join(project, '.opencode', 'skills', 'impeccable'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
  });

  it('writes a slash command bridge for OpenCode, not a skill shortcut', () => {
    const result = spawnSync(process.execPath, [PIN_SCRIPT, 'pin', 'audit'], {
      cwd: project,
      encoding: 'utf8',
      env: cleanEnv(),
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);

    const commandPath = path.join(project, '.opencode', 'commands', 'impeccable-audit.md');
    assert.ok(fs.existsSync(commandPath), `expected ${commandPath}`);
    const content = fs.readFileSync(commandPath, 'utf8');
    assert.match(content, /---\ndescription:.*audit/);
    assert.match(content, /agent: build/);
    assert.match(content, /subtask: true/);
    assert.doesNotMatch(content, /user-invocable:/);
    assert.doesNotMatch(content, /argument-hint:/);

    const skillPath = path.join(project, '.opencode', 'skills', 'audit', 'SKILL.md');
    assert.equal(fs.existsSync(skillPath), false, 'OpenCode pin must not create a skill shortcut');
  });

  it('unpin removes only the OpenCode command bridge', () => {
    spawnSync(process.execPath, [PIN_SCRIPT, 'pin', 'audit'], { cwd: project, encoding: 'utf8', env: cleanEnv() });
    const commandPath = path.join(project, '.opencode', 'commands', 'impeccable-audit.md');
    assert.ok(fs.existsSync(commandPath));

    const result = spawnSync(process.execPath, [PIN_SCRIPT, 'unpin', 'audit'], {
      cwd: project,
      encoding: 'utf8',
      env: cleanEnv(),
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(fs.existsSync(commandPath), false);
  });

  it('unpin cleans the project command after the skill was removed', () => {
    spawnSync(process.execPath, [PIN_SCRIPT, 'pin', 'audit'], { cwd: project, encoding: 'utf8', env: cleanEnv() });
    const commandPath = path.join(project, '.opencode', 'commands', 'impeccable-audit.md');
    assert.ok(fs.existsSync(commandPath));

    // Skill removed before unpin (e.g. uninstall): cleanup must still find the pin.
    fs.rmSync(path.join(project, '.opencode', 'skills', 'impeccable'), { recursive: true, force: true });

    const result = spawnSync(process.execPath, [PIN_SCRIPT, 'unpin', 'audit'], {
      cwd: project,
      encoding: 'utf8',
      env: cleanEnv(),
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(fs.existsSync(commandPath), false, 'stale pin must be removed after skill removal');
  });

  it('unpin after skill removal leaves non-pinned user commands alone', () => {
    const commandsDir = path.join(project, '.opencode', 'commands');
    fs.mkdirSync(commandsDir, { recursive: true });
    const commandPath = path.join(commandsDir, 'impeccable-audit.md');
    fs.writeFileSync(commandPath, 'my own command, not a pin\n');
    fs.rmSync(path.join(project, '.opencode', 'skills', 'impeccable'), { recursive: true, force: true });

    const result = spawnSync(process.execPath, [PIN_SCRIPT, 'unpin', 'audit'], {
      cwd: project,
      encoding: 'utf8',
      env: cleanEnv(),
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.ok(fs.existsSync(commandPath), 'non-pinned user command must survive cleanup');
  });
});

describe('pin command OpenCode user scope', () => {
  let project;
  let config;

  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-pin-usr-'));
    fs.writeFileSync(path.join(project, 'package.json'), '{}\n');
    config = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-pin-cfg-'));
  });

  afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(config, { recursive: true, force: true });
  });

  function installUserScopeSkill(dir = config) {
    fs.mkdirSync(path.join(dir, 'skills', 'impeccable'), { recursive: true });
  }

  it('pins into the user config dir when only a global install exists', () => {
    installUserScopeSkill();
    const result = spawnSync(process.execPath, [PIN_SCRIPT, 'pin', 'audit'], {
      cwd: project,
      encoding: 'utf8',
      env: cleanEnv({ OPENCODE_CONFIG_DIR: config }),
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.doesNotMatch(result.stdout, /No harness directories/);
    const commandPath = path.join(config, 'commands', 'impeccable-audit.md');
    assert.ok(fs.existsSync(commandPath), `expected ${commandPath}`);
    assert.match(fs.readFileSync(commandPath, 'utf8'), /impeccable-pinned-command/);
    assert.equal(
      fs.existsSync(path.join(project, '.opencode', 'commands')),
      false,
      'must not create a project commands dir for a user-scope install',
    );
  });

  it('unpin removes the user-scope pinned command', () => {
    installUserScopeSkill();
    spawnSync(process.execPath, [PIN_SCRIPT, 'pin', 'audit'], {
      cwd: project,
      encoding: 'utf8',
      env: cleanEnv({ OPENCODE_CONFIG_DIR: config }),
    });
    const commandPath = path.join(config, 'commands', 'impeccable-audit.md');
    assert.ok(fs.existsSync(commandPath));

    const result = spawnSync(process.execPath, [PIN_SCRIPT, 'unpin', 'audit'], {
      cwd: project,
      encoding: 'utf8',
      env: cleanEnv({ OPENCODE_CONFIG_DIR: config }),
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(fs.existsSync(commandPath), false);
  });

  it('unpin removes the user-scope pinned command after the global skill was removed', () => {
    installUserScopeSkill();
    spawnSync(process.execPath, [PIN_SCRIPT, 'pin', 'audit'], {
      cwd: project,
      encoding: 'utf8',
      env: cleanEnv({ OPENCODE_CONFIG_DIR: config }),
    });
    const commandPath = path.join(config, 'commands', 'impeccable-audit.md');
    assert.ok(fs.existsSync(commandPath));

    // Global skill removed before unpin: cleanup must still find the pin.
    fs.rmSync(path.join(config, 'skills', 'impeccable'), { recursive: true, force: true });

    const result = spawnSync(process.execPath, [PIN_SCRIPT, 'unpin', 'audit'], {
      cwd: project,
      encoding: 'utf8',
      env: cleanEnv({ OPENCODE_CONFIG_DIR: config }),
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(fs.existsSync(commandPath), false, 'stale user-scope pin must be removed after skill removal');
  });

  it('pins in both scopes when project and user installs coexist', () => {
    installUserScopeSkill();
    fs.mkdirSync(path.join(project, '.opencode', 'skills', 'impeccable'), { recursive: true });
    const result = spawnSync(process.execPath, [PIN_SCRIPT, 'pin', 'audit'], {
      cwd: project,
      encoding: 'utf8',
      env: cleanEnv({ OPENCODE_CONFIG_DIR: config }),
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.ok(fs.existsSync(path.join(config, 'commands', 'impeccable-audit.md')), 'user-scope pin');
    assert.ok(fs.existsSync(path.join(project, '.opencode', 'commands', 'impeccable-audit.md')), 'project pin');
  });

  it('honours XDG_CONFIG_HOME when OPENCODE_CONFIG_DIR is unset', () => {
    const xdg = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-pin-xdg-'));
    installUserScopeSkill(path.join(xdg, 'opencode'));
    try {
      const result = spawnSync(process.execPath, [PIN_SCRIPT, 'pin', 'audit'], {
        cwd: project,
        encoding: 'utf8',
        env: cleanEnv({ OPENCODE_CONFIG_DIR: undefined, XDG_CONFIG_HOME: xdg }),
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.ok(fs.existsSync(path.join(xdg, 'opencode', 'commands', 'impeccable-audit.md')));
    } finally {
      fs.rmSync(xdg, { recursive: true, force: true });
    }
  });
});
