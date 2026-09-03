/**
 * Tests for syncRootCommands. The post-merge release sync must mirror
 * generated provider command files (e.g. OpenCode's commands/impeccable.md)
 * into the tracked root harness folders, or direct GitHub / submodule /
 * npx-skills installs ship OpenCode without the slash command bridge (#483).
 */
import { describe, test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { syncRootCommands } from '../scripts/lib/root-commands-sync.mjs';

function setupDist(distDir, provider, configDir, commands) {
  if (commands === null) return;
  const dir = join(distDir, provider, configDir, 'commands');
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(commands)) {
    writeFileSync(join(dir, name), body);
  }
}

describe('syncRootCommands', () => {
  test('mirrors generated command files into the root harness folder', () => {
    const dist = mkdtempSync(join(tmpdir(), 'imp-sync-dist-'));
    const root = mkdtempSync(join(tmpdir(), 'imp-sync-root-'));
    setupDist(dist, 'opencode', '.opencode', { 'impeccable.md': 'bridge v1\n' });
    try {
      const synced = syncRootCommands(dist, root, [{ provider: 'opencode', configDir: '.opencode' }]);
      expect(synced).toEqual(['.opencode']);
      expect(readFileSync(join(root, '.opencode', 'commands', 'impeccable.md'), 'utf8')).toBe('bridge v1\n');
    } finally {
      rmSync(dist, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('preserves repo-local or pinned command files already at the destination', () => {
    const dist = mkdtempSync(join(tmpdir(), 'imp-sync-dist-'));
    const root = mkdtempSync(join(tmpdir(), 'imp-sync-root-'));
    setupDist(dist, 'opencode', '.opencode', { 'impeccable.md': 'bridge v2\n' });
    const destDir = join(root, '.opencode', 'commands');
    mkdirSync(destDir, { recursive: true });
    writeFileSync(join(destDir, 'impeccable-audit.md'), 'pinned by user\n');
    writeFileSync(join(destDir, 'impeccable.md'), 'stale bridge\n');
    try {
      syncRootCommands(dist, root, [{ provider: 'opencode', configDir: '.opencode' }]);
      expect(readFileSync(join(destDir, 'impeccable.md'), 'utf8')).toBe('bridge v2\n');
      expect(readFileSync(join(destDir, 'impeccable-audit.md'), 'utf8')).toBe('pinned by user\n');
    } finally {
      rmSync(dist, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('skips providers whose dist variant has no commands dir', () => {
    const dist = mkdtempSync(join(tmpdir(), 'imp-sync-dist-'));
    const root = mkdtempSync(join(tmpdir(), 'imp-sync-root-'));
    setupDist(dist, 'opencode', '.opencode', { 'impeccable.md': 'bridge\n' });
    setupDist(dist, 'claude-code', '.claude', null);
    try {
      const synced = syncRootCommands(dist, root, [
        { provider: 'opencode', configDir: '.opencode' },
        { provider: 'claude-code', configDir: '.claude' },
      ]);
      expect(synced).toEqual(['.opencode']);
      expect(existsSync(join(root, '.claude', 'commands'))).toBe(false);
    } finally {
      rmSync(dist, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });
});
