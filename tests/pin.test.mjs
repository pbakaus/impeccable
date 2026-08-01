import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const PIN_SCRIPT = path.join(ROOT, 'skill', 'scripts', 'pin.mjs');

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
    spawnSync(process.execPath, [PIN_SCRIPT, 'pin', 'audit'], { cwd: project, encoding: 'utf8' });
    const commandPath = path.join(project, '.opencode', 'commands', 'impeccable-audit.md');
    assert.ok(fs.existsSync(commandPath));

    const result = spawnSync(process.execPath, [PIN_SCRIPT, 'unpin', 'audit'], {
      cwd: project,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(fs.existsSync(commandPath), false);
  });
});
