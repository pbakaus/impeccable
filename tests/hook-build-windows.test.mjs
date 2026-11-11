import { it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildClaudePluginHooksManifest } from '../scripts/lib/transformers/hooks.js';

it('runs the shared plugin commandWindows from Windows shells with a spaced plugin path', { skip: process.platform !== 'win32' }, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-hook-'));
  const pluginRoot = path.join(temp, 'plugin with spaces æø');
  const scripts = path.join(pluginRoot, 'skills', 'impeccable', 'scripts');
  const launcher = path.join(scripts, 'impeccable.cmd');
  fs.mkdirSync(scripts, { recursive: true });
  const template = buildClaudePluginHooksManifest().hooks.PostToolUse[0].hooks[0].commandWindows;
  const command = template.replaceAll('${CLAUDE_PLUGIN_ROOT}', pluginRoot);
  const shells = [
    ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command]],
    ['cmd.exe', ['/d', '/s', '/c', command]],
  ];
  if (spawnSync('pwsh.exe', ['-NoProfile', '-Command', 'exit 0']).status === 0) {
    shells.push(['pwsh.exe', ['-NoProfile', '-NonInteractive', '-Command', command]]);
  }
  try {
    fs.writeFileSync(launcher, '@echo off\r\necho hook-ran-%1\r\nexit /b 0\r\n');
    for (const [shell, args] of shells) {
      const result = spawnSync(shell, args, { encoding: 'utf8', windowsVerbatimArguments: shell === 'cmd.exe' });
      assert.equal(result.status, 0, `${shell}: ${result.stderr}`);
      assert.match(result.stdout, /hook-ran-hook/, shell);
    }
    fs.writeFileSync(launcher, '@echo off\r\nexit /b 7\r\n');
    for (const [shell, args] of shells) {
      const result = spawnSync(shell, args, { encoding: 'utf8', windowsVerbatimArguments: shell === 'cmd.exe' });
      assert.ok(result.status > 0, `${shell}: launcher failure must remain nonzero`);
    }
    fs.rmSync(launcher);
    for (const [shell, args] of shells) {
      const result = spawnSync(shell, args, { encoding: 'utf8', windowsVerbatimArguments: shell === 'cmd.exe' });
      assert.equal(result.status, 0, `${shell}: missing launcher should be skipped`);
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
