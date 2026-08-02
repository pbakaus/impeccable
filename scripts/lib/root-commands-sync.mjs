/**
 * Mirror generated provider command files (e.g. OpenCode's
 * commands/impeccable.md) from dist/ into the tracked root harness folders.
 * Without this, the release sync ships skills/agents/hooks but no slash
 * command bridge, so direct GitHub, npx-skills, and submodule installs of
 * OpenCode stay bridge-less (#483). Per-entry copy like the skills sync:
 * the destination directory is never removed, so repo-local or pinned
 * command files are preserved.
 */
import fs from 'node:fs';
import path from 'node:path';

export function syncRootCommands(distDir, rootDir, providers) {
  const synced = [];
  for (const { provider, configDir } of providers) {
    const src = path.join(distDir, provider, configDir, 'commands');
    if (!fs.existsSync(src)) continue;
    const dest = path.join(rootDir, configDir, 'commands');
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      fs.copyFileSync(path.join(src, entry.name), path.join(dest, entry.name));
    }
    synced.push(configDir);
  }
  return synced;
}
