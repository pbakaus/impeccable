import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { readSourceFiles } from '../scripts/lib/utils.js';
import { createTransformer, PROVIDERS } from '../scripts/lib/transformers/index.js';
import { stageVSCodeExtension, rewriteVSCodeMarkdown } from '../scripts/lib/vscode-extension.js';

const repo = fileURLToPath(new URL('..', import.meta.url));

describe('VS Code skill extension', () => {
  let scratch;
  let extension;
  before(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-vscode-test-'));
    const { skills } = readSourceFiles(repo);
    const skillsVersion = JSON.parse(fs.readFileSync(path.join(repo, '.claude-plugin/plugin.json'), 'utf8')).version;
    createTransformer(PROVIDERS.github)(skills, scratch, { skillsVersion });
    extension = stageVSCodeExtension(repo, scratch);
  });
  after(() => fs.rmSync(scratch, { recursive: true, force: true }));

  it('registers only the skill, without editor runtime or project-install sidecars', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(extension, 'package.json'), 'utf8'));
    assert.deepEqual(manifest.contributes, { chatSkills: [{ path: './skills/impeccable/SKILL.md' }] });
    for (const key of ['main', 'browser', 'activationEvents', 'scripts']) assert.equal(key in manifest, false);
    assert.equal(manifest.version, JSON.parse(fs.readFileSync(path.join(repo, '.claude-plugin/plugin.json'))).version);
    assert.deepEqual(fs.readdirSync(extension).sort(), ['.vscodeignore', 'LICENSE', 'README.md', 'icon.png', 'package.json', 'skills']);
    assert.ok(fs.existsSync(path.join(extension, manifest.contributes.chatSkills[0].path)));
    const skill = fs.readFileSync(path.join(extension, manifest.contributes.chatSkills[0].path), 'utf8');
    assert.equal(skill.match(/^version: (.+)$/m)?.[1], manifest.version);
    assert.ok(fs.existsSync(path.join(extension, 'skills/impeccable/reference/degraded/asset-producer.md')));
    assert.equal(fs.existsSync(path.join(extension, 'skills/impeccable/scripts/bin')), false);
  });

  it('resolves linked resources inside the packaged skill and removes project launcher paths', () => {
    const skill = path.join(extension, 'skills/impeccable');
    let links = 0;
    for (const rel of fs.readdirSync(skill, { recursive: true }).filter(p => p.endsWith('.md'))) {
      const filename = path.join(skill, rel);
      const content = fs.readFileSync(filename, 'utf8');
      assert.doesNotMatch(content, /\.github\/skills\/impeccable\/scripts|\$\{CLAUDE_(?:SKILL_DIR|PLUGIN_ROOT)\}|\{\{scripts_path\}\}/);
      for (const match of content.matchAll(/\]\(([^)\s]+)\)/g)) {
        const link = match[1];
        if (!/^(?:reference\/|scripts\/)/.test(link)) continue;
        assert.ok(fs.existsSync(path.resolve(path.dirname(filename), link.split('#')[0])), `${rel}: ${link}`);
        links++;
      }
    }
    assert.ok(links > 20, 'entrypoint retains its playbook links');
  });

  it('keeps POSIX and Windows paths quoted, with arguments outside the quotes', () => {
    const output = rewriteVSCodeMarkdown('Run `.github/skills/impeccable/scripts/impeccable context` or `<skill-base-dir>/scripts/impeccable.cmd context`.');
    assert.equal(output, 'Run `"<skill-base-dir>/scripts/impeccable" context` or `"<skill-base-dir>/scripts/impeccable.cmd" context`.');
    assert.equal(rewriteVSCodeMarkdown(output), output);
    assert.throws(() => rewriteVSCodeMarkdown('changed Setup', { isSkillEntrypoint: true }), /rewrite drift/);
  });

  it('runs the relocated launcher with spaces without changing project cwd or skill root', { skip: process.platform === 'win32' }, () => {
    const installed = path.join(scratch, 'extension cache with spaces', 'skills', 'impeccable');
    fs.cpSync(path.join(extension, 'skills/impeccable'), installed, { recursive: true });
    const project = path.join(scratch, 'user project');
    fs.mkdirSync(project);
    const probe = path.join(scratch, 'probe engine');
    fs.writeFileSync(probe, '#!/bin/sh\nprintf "%s\\n" "$PWD" "$IMPECCABLE_SKILL_DIR" "$IMPECCABLE_SELF" "$@"\n', { mode: 0o755 });
    const launcher = path.join(installed, 'scripts/impeccable');
    const env = { ...process.env, IMPECCABLE_BIN: probe };
    delete env.IMPECCABLE_SKILL_DIR;
    delete env.IMPECCABLE_SELF;
    const output = execFileSync(launcher, ['context', '--target', 'a file.html'], { cwd: project, env, encoding: 'utf8' }).trim().split('\n');
    assert.equal(fs.realpathSync(output[0]), fs.realpathSync(project));
    assert.equal(fs.realpathSync(output[1]), fs.realpathSync(installed));
    assert.deepEqual(output.slice(2), [launcher, 'context', '--target', 'a file.html']);
    assert.deepEqual(fs.readdirSync(project), []);
  });

  it('rebuilds deterministically and removes stale generated files', () => {
    const before = fs.readFileSync(path.join(extension, 'skills/impeccable/SKILL.md'));
    fs.writeFileSync(path.join(extension, 'old.js'), 'stale');
    stageVSCodeExtension(repo, scratch);
    assert.equal(fs.existsSync(path.join(extension, 'old.js')), false);
    assert.deepEqual(fs.readFileSync(path.join(extension, 'skills/impeccable/SKILL.md')), before);
  });
});
