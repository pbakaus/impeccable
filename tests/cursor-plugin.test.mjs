import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { stageCursorPlugin, rewriteCursorPluginMarkdown } from '../scripts/lib/cursor-plugin.js';
import { buildCursorHooksManifest } from '../scripts/lib/transformers/hooks.js';
import { collectPluginVersions } from '../scripts/lib/validate-plugin-versions.js';
import { readSourceFiles } from '../scripts/lib/utils.js';
import { createTransformer, PROVIDERS } from '../scripts/lib/transformers/index.js';

const scripts = '.cursor/skills/impeccable/scripts';
const sample = `---\nname: impeccable\ndescription: Design\n---\nRun \`${scripts}/impeccable context\`, and \`${scripts}\` is the fallback only when the runtime reports no base directory. Windows: \`${scripts}/impeccable.cmd context\`.\n`;

describe('Cursor native plugin', () => {
  let root;
  const write = (rel, content) => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-cursor-plugin-'));
    write('.claude-plugin/plugin.json', JSON.stringify({ version: '4.2.2', homepage: 'https://impeccable.style', repository: 'https://github.com/pbakaus/impeccable' }));
    write('scripts/lib/assets/plugin-icon.png', 'icon');
    write('docs/CURSOR-PLUGIN.md', 'Readme');
    write('LICENSE', 'license');
    write('dist/cursor/.cursor/skills/impeccable/SKILL.md', sample);
    write('dist/cursor/.cursor/skills/impeccable/reference/polish.md', sample);
    write('dist/cursor/.cursor/skills/impeccable/scripts/impeccable', '#!/bin/sh\nprintf "%s\\n" "$PWD" "$1"\ncat\nexit 2\n');
    fs.chmodSync(path.join(root, 'dist/cursor/.cursor/skills/impeccable/scripts/impeccable'), 0o755);
    write('dist/cursor/.cursor/agents/impeccable-asset-producer.md', sample);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('stages only the Cursor payload and preserves launcher permissions', () => {
    const output = stageCursorPlugin(root, path.join(root, 'dist'));
    const manifest = JSON.parse(fs.readFileSync(path.join(output, '.cursor-plugin/plugin.json')));
    assert.equal(manifest.version, '4.2.2');
    assert.equal(manifest.skills, './skills/');
    assert.equal(manifest.agents, './agents/');
    for (const rel of [manifest.logo, manifest.hooks, 'README.md', 'LICENSE']) assert.ok(fs.existsSync(path.join(output, rel)));
    for (const rel of ['skills/impeccable/SKILL.md', 'skills/impeccable/reference/polish.md', 'agents/impeccable-asset-producer.md']) {
      const text = fs.readFileSync(path.join(output, rel), 'utf8');
      assert.doesNotMatch(text, /\.cursor\/skills|fallback only/);
      assert.match(text, /"<skill-base-dir>\/scripts\/impeccable" context/);
      assert.match(text, /"<skill-base-dir>\/scripts\/impeccable\.cmd" context/);
    }
    assert.match(fs.readFileSync(path.join(output, 'agents/impeccable-asset-producer.md'), 'utf8'), /supplied in the handoff/);
    assert.equal(fs.statSync(path.join(output, 'skills/impeccable/scripts/impeccable')).mode & 0o111, 0o111);
    assert.equal(fs.readFileSync(path.join(root, 'dist/cursor/.cursor/skills/impeccable/SKILL.md'), 'utf8'), sample);
    write('dist/cursor-plugin/stale.txt', 'stale');
    stageCursorPlugin(root, path.join(root, 'dist'));
    assert.equal(fs.existsSync(path.join(output, 'stale.txt')), false);
  });

  it('runs the plugin hook from a relocated path with spaces, preserving cwd, stdin, and exit status', { skip: process.platform === 'win32' }, () => {
    const output = stageCursorPlugin(root, path.join(root, 'dist'));
    const relocated = path.join(root, 'installed plugin');
    fs.renameSync(output, relocated);
    const hooks = JSON.parse(fs.readFileSync(path.join(relocated, 'hooks/hooks.json')));
    assert.deepEqual(Object.keys(hooks.hooks), ['preToolUse']);
    const command = hooks.hooks.preToolUse[0].command.replaceAll('${CURSOR_PLUGIN_ROOT}', relocated);
    const result = spawnSync('sh', ['-c', command], { cwd: root, input: '{"tool_name":"Edit"}\n', encoding: 'utf8' });
    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.stdout, `${fs.realpathSync(root)}\nhook-before-edit\n{"tool_name":"Edit"}\n`);
    assert.match(buildCursorHooksManifest().hooks.preToolUse[0].command, /\.cursor\/skills\/impeccable/);
  });

  it('does not add path prose to agents that do not use scripts', () => {
    assert.equal(rewriteCursorPluginMarkdown('---\nname: reviewer\n---\nReview.', { agent: true }), '---\nname: reviewer\n---\nReview.\n');
  });

  it('detects version drift in both staged and tracked Cursor artifacts', () => {
    for (const prefix of ['cursor-plugin', 'dist/cursor-plugin']) {
      write(`${prefix}/.cursor-plugin/plugin.json`, JSON.stringify({ version: '0.0.1' }));
      write(`${prefix}/skills/impeccable/SKILL.md`, '---\nversion: 0.0.1\n---\n');
    }
    assert.equal(collectPluginVersions(root).mismatches.length, 4);
  });

  it('keeps the Git marketplace source and generated-output sync connected', () => {
    const repository = path.resolve(import.meta.dirname, '..');
    const marketplace = JSON.parse(fs.readFileSync(path.join(repository, '.cursor-plugin/marketplace.json')));
    assert.equal(marketplace.plugins[0].source, './cursor-plugin');
    const workflow = fs.readFileSync(path.join(repository, '.github/workflows/sync-generated-output.yml'), 'utf8');
    assert.match(workflow, /\n    cursor-plugin\n/);
    assert.match(workflow, /docs\/CURSOR-PLUGIN\.md/);
  });

  it('packages the real provider skill and all agents without unresolved launcher paths', () => {
    const repository = path.resolve(import.meta.dirname, '..');
    const version = JSON.parse(fs.readFileSync(path.join(repository, '.claude-plugin/plugin.json'))).version;
    const { skills } = readSourceFiles(repository);
    const dist = path.join(root, 'real-provider');
    createTransformer(PROVIDERS.cursor)(skills, dist, { skillsVersion: version });
    const output = stageCursorPlugin(repository, dist);
    assert.equal(fs.readdirSync(path.join(output, 'agents')).length, 4);
    let links = 0;
    for (const rel of fs.readdirSync(output, { recursive: true }).filter(file => file.endsWith('.md'))) {
      const filename = path.join(output, rel);
      const text = fs.readFileSync(filename, 'utf8');
      assert.doesNotMatch(text, /\.cursor\/skills\/impeccable\/scripts|\{\{scripts_path\}\}|fallback only when/);
      for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
        if (!/^(reference|scripts)\//.test(match[1])) continue;
        assert.ok(fs.existsSync(path.resolve(path.dirname(filename), match[1].split('#')[0])), `${rel}: ${match[1]}`);
        links++;
      }
    }
    assert.ok(links > 20);
    assert.equal(fs.existsSync(path.join(output, 'skills/impeccable/scripts/bin')), false);
    const entrypoint = fs.readFileSync(path.join(output, 'skills/impeccable/SKILL.md'), 'utf8');
    assert.match(entrypoint, /Run `"<skill-base-dir>\/scripts\/impeccable" context` once per session/);
  });
});
