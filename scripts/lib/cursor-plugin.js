import fs from 'node:fs';
import path from 'node:path';
import { buildCursorHooksManifest } from './transformers/hooks.js';

const PROJECT_SCRIPTS = '.cursor/skills/impeccable/scripts';

export function rewriteCursorPluginMarkdown(text, { agent = false } = {}) {
  // Installed plugins live outside the workspace. Keep the shared Setup flow,
  // but remove its project-install fallback and quote executable paths.
  text = text.replace(`, and \`${PROJECT_SCRIPTS}\` is the fallback only when the runtime reports no base directory`, '');
  text = text.replaceAll(`${PROJECT_SCRIPTS}/impeccable.cmd`, '"<skill-base-dir>/scripts/impeccable.cmd"');
  text = text.replaceAll(`${PROJECT_SCRIPTS}/impeccable`, '"<skill-base-dir>/scripts/impeccable"');
  text = text.replaceAll(PROJECT_SCRIPTS, '<skill-base-dir>/scripts');
  text = text.replace('`<skill-base-dir>/scripts/impeccable context`', '`"<skill-base-dir>/scripts/impeccable" context`');
  if (agent && text.includes('<skill-base-dir>')) {
    const end = text.indexOf('\n---', 4);
    if (end < 0) throw new Error('Cursor agent is missing frontmatter');
    const offset = end + 4;
    text = `${text.slice(0, offset)}\n\nResolve \`<skill-base-dir>\` from the skill scripts path supplied in the handoff (its parent directory), or from \`../skills/impeccable\` relative to this agent file. Keep cwd at the user's project.${text.slice(offset)}`;
  }
  return text.replace(/[\t ]+$/gm, '').trimEnd() + '\n';
}

function rewriteTree(dir, options) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) rewriteTree(file, options);
    else if (entry.name.endsWith('.md')) fs.writeFileSync(file, rewriteCursorPluginMarkdown(fs.readFileSync(file, 'utf8'), options));
  }
}

export function stageCursorPlugin(rootDir, distDir) {
  const provider = path.join(distDir, 'cursor', '.cursor');
  const icon = path.join(rootDir, 'scripts/lib/assets/plugin-icon.png');
  const readme = path.join(rootDir, 'docs/CURSOR-PLUGIN.md');
  for (const input of [path.join(provider, 'skills/impeccable/SKILL.md'), path.join(provider, 'agents'), icon, readme]) {
    if (!fs.existsSync(input)) throw new Error(`Cannot build Cursor plugin: missing ${input}`);
  }
  const source = JSON.parse(fs.readFileSync(path.join(rootDir, '.claude-plugin/plugin.json'), 'utf8'));
  const output = path.join(distDir, 'cursor-plugin');
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(path.join(output, '.cursor-plugin'), { recursive: true });
  fs.cpSync(path.join(provider, 'skills'), path.join(output, 'skills'), { recursive: true });
  fs.cpSync(path.join(provider, 'agents'), path.join(output, 'agents'), { recursive: true });
  rewriteTree(path.join(output, 'skills'));
  rewriteTree(path.join(output, 'agents'), { agent: true });
  fs.mkdirSync(path.join(output, 'assets'));
  fs.copyFileSync(icon, path.join(output, 'assets/icon.png'));
  fs.copyFileSync(readme, path.join(output, 'README.md'));
  fs.copyFileSync(path.join(rootDir, 'LICENSE'), path.join(output, 'LICENSE'));
  fs.writeFileSync(path.join(output, '.cursor-plugin/plugin.json'), `${JSON.stringify({
    name: 'impeccable', version: source.version,
    description: 'Design and refine interfaces with Impeccable skills, specialist agents, and design checks.',
    author: { name: 'Renaissance Geek, Inc.' },
    homepage: source.homepage, repository: source.repository,
    license: 'Apache-2.0', keywords: ['design', 'frontend', 'accessibility', 'ui', 'ux'],
    logo: 'assets/icon.png', skills: './skills/', agents: './agents/', hooks: './hooks/hooks.json',
  }, null, 2)}\n`);
  fs.mkdirSync(path.join(output, 'hooks'));
  fs.writeFileSync(path.join(output, 'hooks/hooks.json'), `${JSON.stringify(
    buildCursorHooksManifest('${CURSOR_PLUGIN_ROOT}/skills/impeccable/scripts'), null, 2,
  )}\n`);
  return output;
}
