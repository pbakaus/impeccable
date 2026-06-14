import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  getHookConsent,
  setHookConsent,
  getLocalConfigPath,
  getConfigPath,
  ensureConfigGitExclude,
} from '../../cli/lib/impeccable-config.mjs';

describe('cli/lib/impeccable-config', () => {
  let root;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'imp-cfg-')); });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test('getHookConsent is undefined until a decision is recorded, then round-trips', () => {
    expect(getHookConsent(root)).toBeUndefined();
    setHookConsent(root, 'declined');
    expect(getHookConsent(root)).toBe('declined');
    setHookConsent(root, 'accepted');
    expect(getHookConsent(root)).toBe('accepted');
  });

  test('setHookConsent preserves unrelated keys in config.local.json', () => {
    mkdirSync(join(root, '.impeccable'), { recursive: true });
    writeFileSync(getLocalConfigPath(root), JSON.stringify({ updateCheck: false, hook: { quiet: true } }));
    setHookConsent(root, 'declined');
    const raw = JSON.parse(readFileSync(getLocalConfigPath(root), 'utf-8'));
    expect(raw.updateCheck).toBe(false);
    expect(raw.hook.quiet).toBe(true);
    expect(raw.hook.consent).toBe('declined');
  });

  test('config.local.json (per-developer) overrides config.json for consent', () => {
    mkdirSync(join(root, '.impeccable'), { recursive: true });
    writeFileSync(getConfigPath(root), JSON.stringify({ hook: { consent: 'accepted' } }));
    writeFileSync(getLocalConfigPath(root), JSON.stringify({ hook: { consent: 'declined' } }));
    expect(getHookConsent(root)).toBe('declined');
  });

  test('malformed config is tolerated (no throw, undefined consent)', () => {
    mkdirSync(join(root, '.impeccable'), { recursive: true });
    writeFileSync(getLocalConfigPath(root), '{ not json');
    expect(getHookConsent(root)).toBeUndefined();
  });

  test('writing consent gitignores config.local.json via .git/info/exclude', () => {
    execFileSync('git', ['init', '-q'], { cwd: root });
    setHookConsent(root, 'declined');
    const exclude = readFileSync(join(root, '.git', 'info', 'exclude'), 'utf-8');
    expect(exclude).toContain('.impeccable/config.local.json');
    // Idempotent: a second write does not duplicate the marker block.
    ensureConfigGitExclude(root);
    const again = readFileSync(join(root, '.git', 'info', 'exclude'), 'utf-8');
    expect((again.match(/impeccable-config-ignore-start/g) || []).length).toBe(1);
    // It uses .git/info/exclude, not a tracked .gitignore.
    expect(existsSync(join(root, '.gitignore'))).toBe(false);
  });

  test('ensureConfigGitExclude is a no-op outside a git repo', () => {
    expect(ensureConfigGitExclude(root)).toBe(false);
  });
});
