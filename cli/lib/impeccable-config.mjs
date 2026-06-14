/**
 * CLI-side reader/writer for the unified `.impeccable` config.
 *
 * The CLI (published to npm) and the skill scripts (bundled into the install)
 * live in separate trees and cannot share runtime code, so this duplicates a
 * small slice of skill/scripts/hook-lib.mjs — the config-path layout and the
 * `.git/info/exclude` handling. Keep the schema and exclude marker in sync if
 * either side changes.
 *
 * Schema (config.json shared / config.local.json gitignored, per-developer):
 *   { "hook": { "consent": "accepted" | "declined", ... }, "updateCheck": bool }
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';

export function getConfigPath(root) {
  return join(root, '.impeccable', 'config.json');
}

export function getLocalConfigPath(root) {
  return join(root, '.impeccable', 'config.local.json');
}

function safeReadJson(filePath) {
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  } catch {
    return null;
  }
}

function hookSection(raw) {
  return raw && raw.hook && typeof raw.hook === 'object' && !Array.isArray(raw.hook) ? raw.hook : null;
}

/**
 * The recorded design-hook decision: 'accepted' | 'declined' | undefined.
 * config.local.json (per-developer) overrides config.json.
 */
export function getHookConsent(root) {
  let consent;
  for (const filePath of [getConfigPath(root), getLocalConfigPath(root)]) {
    const hook = hookSection(safeReadJson(filePath));
    if (hook && (hook.consent === 'accepted' || hook.consent === 'declined')) consent = hook.consent;
  }
  return consent;
}

/**
 * Persist the per-developer decision to config.local.json, preserving any
 * sibling keys, and ensure the file is gitignored.
 */
export function setHookConsent(root, value) {
  const filePath = getLocalConfigPath(root);
  const existing = safeReadJson(filePath) || {};
  const hook = hookSection(existing) || {};
  const next = { ...existing, hook: { ...hook, consent: value } };
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`);
  ensureConfigGitExclude(root);
  return filePath;
}

const EXCLUDE_OPEN = '# impeccable-config-ignore-start';
const EXCLUDE_CLOSE = '# impeccable-config-ignore-end';
const EXCLUDE_PATTERNS = ['.impeccable/config.local.json'];

/**
 * Add config.local.json to `.git/info/exclude` so a developer's decision is
 * never committed. Idempotent via marker comments. Best-effort; returns false
 * when there is no resolvable git dir.
 */
export function ensureConfigGitExclude(root) {
  try {
    const gitDir = resolveGitDir(root);
    if (!gitDir) return false;
    const target = join(gitDir, 'info', 'exclude');
    const existing = existsSync(target) ? readFileSync(target, 'utf-8') : '';
    const block = [EXCLUDE_OPEN, ...EXCLUDE_PATTERNS, EXCLUDE_CLOSE].join('\n');
    const markerRe = new RegExp(`${escapeRegExp(EXCLUDE_OPEN)}[\\s\\S]*?${escapeRegExp(EXCLUDE_CLOSE)}`);
    let updated;
    if (markerRe.test(existing)) {
      updated = existing.replace(markerRe, block);
    } else {
      const prefix = existing.length === 0 ? '' : existing.endsWith('\n') ? existing : `${existing}\n`;
      updated = `${prefix}${block}\n`;
    }
    if (updated !== existing) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, updated);
    }
    return true;
  } catch {
    return false;
  }
}

function resolveGitDir(root) {
  const dotGit = join(root, '.git');
  if (!existsSync(dotGit)) return null;
  try {
    if (statSync(dotGit).isDirectory()) return dotGit;
    // A `.git` file (worktree/submodule) points elsewhere: "gitdir: <path>".
    const match = readFileSync(dotGit, 'utf-8').match(/gitdir:\s*(.+)/);
    if (match) {
      const resolved = match[1].trim();
      return isAbsolute(resolved) ? resolved : join(root, resolved);
    }
  } catch {
    /* fall through */
  }
  return null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
