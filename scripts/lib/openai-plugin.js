import fs from 'fs';
import path from 'path';

import { buildCodexPluginManifest } from './codex-plugin.js';
import { buildCodexPluginHooksManifest } from './transformers/hooks.js';

function requirePath(absPath, label) {
  if (!fs.existsSync(absPath)) {
    throw new Error(`Cannot build OpenAI plugin: missing ${label}: ${absPath}`);
  }
}

function writeJson(absPath, value) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Stage the public OpenAI plugin from the Codex-transformed skill payload.
 *
 * The tracked ./plugin subtree is a Claude Code marketplace artifact. Reusing
 * its shared skills/ directory here silently ships Claude paths and slash
 * commands inside a Codex plugin. Keep this stage independent so each plugin
 * receives the provider transform it was built for.
 */
export function stageOpenAIPlugin(rootDir, distDir) {
  const rootManifestPath = path.join(rootDir, '.claude-plugin', 'plugin.json');
  const codexSkillSrc = path.join(distDir, 'codex', '.codex', 'skills', 'impeccable');
  const iconSrc = path.join(rootDir, 'site', 'public', 'apple-touch-icon.png');

  requirePath(rootManifestPath, 'root plugin manifest');
  requirePath(codexSkillSrc, 'Codex skill payload');
  requirePath(iconSrc, 'plugin icon');

  const pluginRoot = path.join(distDir, 'openai', 'impeccable');
  fs.rmSync(pluginRoot, { recursive: true, force: true });
  fs.mkdirSync(pluginRoot, { recursive: true });

  const rootManifest = JSON.parse(fs.readFileSync(rootManifestPath, 'utf8'));
  writeJson(
    path.join(pluginRoot, '.codex-plugin', 'plugin.json'),
    buildCodexPluginManifest(rootManifest),
  );

  fs.mkdirSync(path.join(pluginRoot, 'assets'), { recursive: true });
  fs.copyFileSync(iconSrc, path.join(pluginRoot, 'assets', 'icon.png'));

  fs.mkdirSync(path.join(pluginRoot, 'skills'), { recursive: true });
  fs.cpSync(
    codexSkillSrc,
    path.join(pluginRoot, 'skills', 'impeccable'),
    { recursive: true },
  );

  writeJson(
    path.join(pluginRoot, 'hooks', 'hooks.json'),
    buildCodexPluginHooksManifest(),
  );

  return pluginRoot;
}
