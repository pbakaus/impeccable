/**
 * CLI-side reader/writer for the unified `.impeccable` config.
 *
 * The CLI (published to npm) and the skill scripts (bundled into the install)
 * live in separate trees and cannot share runtime code, so this duplicates a
 * small slice of skill/scripts/hook-lib.mjs — the config-path layout, detector
 * ignore semantics, and the `.git/info/exclude` handling. Keep the schema,
 * ignore filtering, and exclude marker in sync if either side changes.
 *
 * Schema (config.json shared / config.local.json gitignored, per-developer):
 *   { "hook": { "consent": "accepted" | "declined", "ignoreRules": [], "ignoreFiles": [], "ignoreValues": [], ... }, "updateCheck": bool }
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname, isAbsolute, relative, resolve, sep } from 'node:path';

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

const DEFAULT_DETECTION_CONFIG = Object.freeze({
  ignoreRules: [],
  ignoreFiles: [],
  ignoreValues: [],
  designSystem: { enabled: true },
});

function cloneDetectionConfig() {
  return {
    ignoreRules: [],
    ignoreFiles: [],
    ignoreValues: [],
    designSystem: { ...DEFAULT_DETECTION_CONFIG.designSystem },
  };
}

function applyDetectionConfigSource(config, raw) {
  if (!raw || typeof raw !== 'object') return config;
  if (raw.designSystem && typeof raw.designSystem === 'object' && !Array.isArray(raw.designSystem)) {
    config.designSystem = {
      ...config.designSystem,
      enabled: raw.designSystem.enabled === false ? false : true,
    };
  }
  if (Array.isArray(raw.ignoreRules)) {
    config.ignoreRules = uniqueStrings([...config.ignoreRules, ...raw.ignoreRules]);
  }
  if (Array.isArray(raw.ignoreFiles)) {
    config.ignoreFiles = uniqueStrings([...config.ignoreFiles, ...raw.ignoreFiles]);
  }
  if (Array.isArray(raw.ignoreValues)) {
    config.ignoreValues = mergeIgnoreValues(config.ignoreValues, raw.ignoreValues);
  }
  return config;
}

function uniqueStrings(values) {
  return Array.from(new Set(values.map(String)));
}

/**
 * Detector filters shared by `npx impeccable detect` and the design hook.
 * `hook.enabled` remains hook lifecycle state; manual CLI scans still run when
 * the hook is disabled, but they honor the same ignore rules and design-system
 * toggle.
 */
export function readDetectionConfig(root) {
  const config = cloneDetectionConfig();
  applyDetectionConfigSource(config, hookSection(safeReadJson(getConfigPath(root))));
  applyDetectionConfigSource(config, hookSection(safeReadJson(getLocalConfigPath(root))));
  return config;
}

export function normalizeIgnoreValue(value) {
  return String(value || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function normalizeIgnoreRule(rule) {
  return String(rule || '').trim().toLowerCase();
}

export function normalizeIgnoreValueEntries(entries) {
  if (!Array.isArray(entries)) return [];
  const out = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const rule = normalizeIgnoreRule(entry.rule);
    const value = normalizeIgnoreValue(entry.value);
    if (!rule || !value) continue;
    const normalized = { rule, value };
    const files = uniqueStrings([
      ...(typeof entry.file === 'string' && entry.file.trim() ? [entry.file.trim()] : []),
      ...(Array.isArray(entry.files) ? entry.files.filter(v => typeof v === 'string' && v.trim()).map(v => v.trim()) : []),
    ]);
    if (files.length > 0) normalized.files = files;
    if (typeof entry.reason === 'string' && entry.reason.trim()) {
      normalized.reason = entry.reason.trim();
    }
    if (typeof entry.createdAt === 'string' && entry.createdAt.trim()) {
      normalized.createdAt = entry.createdAt.trim();
    }
    out.push(normalized);
  }
  return out;
}

function mergeIgnoreValues(existing, incoming) {
  const map = new Map();
  for (const entry of normalizeIgnoreValueEntries(existing)) {
    map.set(`${entry.rule}\0${entry.value}\0${ignoreValueFilesKey(entry.files)}`, entry);
  }
  for (const entry of normalizeIgnoreValueEntries(incoming)) {
    map.set(`${entry.rule}\0${entry.value}\0${ignoreValueFilesKey(entry.files)}`, entry);
  }
  return Array.from(map.values());
}

function ignoreValueFilesKey(files) {
  return Array.isArray(files) && files.length > 0 ? files.join('\x1f') : '';
}

// Glob -> RegExp. Supports `**`, `*`, `?`, and `{a,b}` alternation.
function globToRegex(glob) {
  let re = '^';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i += 2;
        if (glob[i] === '/') i += 1;
      } else {
        re += '[^/]*';
        i += 1;
      }
    } else if (c === '?') {
      re += '[^/]';
      i += 1;
    } else if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end === -1) { re += '\\{'; i += 1; continue; }
      const parts = glob.slice(i + 1, end).split(',').map((p) => p.replace(/[.+^$()|[\]\\]/g, '\\$&'));
      re += `(?:${parts.join('|')})`;
      i = end + 1;
    } else if (/[.+^$()|[\]\\]/.test(c)) {
      re += `\\${c}`;
      i += 1;
    } else {
      re += c;
      i += 1;
    }
  }
  re += '$';
  return new RegExp(re);
}

export function matchesAnyGlob(filePath, globs) {
  if (!Array.isArray(globs) || globs.length === 0) return false;
  const normalized = String(filePath || '').split(sep).join('/');
  for (const glob of globs) {
    try {
      const re = globToRegex(String(glob));
      if (re.test(normalized)) return true;
      const base = normalized.split('/').pop();
      if (re.test(base)) return true;
    } catch {
      /* malformed glob, skip */
    }
  }
  return false;
}

export function shouldIgnoreDetectionFile(filePath, root, config) {
  const globs = config?.ignoreFiles || [];
  if (!Array.isArray(globs) || globs.length === 0) return false;
  const raw = String(filePath || '').trim();
  if (!raw) return false;
  if (matchesAnyGlob(raw, globs)) return true;

  try {
    const abs = isAbsolute(raw) ? raw : resolve(root, raw);
    if (matchesAnyGlob(abs, globs)) return true;
    const rel = relative(root, abs);
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) {
      return matchesAnyGlob(rel, globs);
    }
  } catch {
    /* ignore */
  }
  return false;
}

export function filterDetectionFindings(findings, config) {
  if (!Array.isArray(findings) || findings.length === 0) return [];
  const ignoreRules = new Set((config?.ignoreRules || []).map((rule) => normalizeIgnoreRule(rule)));
  const ignoreValues = normalizeIgnoreValueEntries(config?.ignoreValues || []);
  return findings.filter((finding) => {
    if (!finding || typeof finding !== 'object') return false;
    if (ignoreRules.has(normalizeIgnoreRule(finding.antipattern))) return false;
    if (isIgnoredFindingValue(finding, ignoreValues)) return false;
    return true;
  });
}

function isIgnoredFindingValue(finding, ignoreValues) {
  if (!Array.isArray(ignoreValues) || ignoreValues.length === 0) return false;
  const rule = normalizeIgnoreRule(finding.antipattern);
  const value = extractFindingIgnoreValue(finding);
  if (!rule || !value) return false;
  return ignoreValues.some((entry) => {
    const wildcardValue = entry.value === '*';
    if (entry.rule !== rule || (!wildcardValue && entry.value !== value)) return false;
    if (!Array.isArray(entry.files) || entry.files.length === 0) return !wildcardValue;
    return findingMatchesScopedIgnoreFile(finding, entry.files);
  });
}

function findingMatchesScopedIgnoreFile(finding, globs) {
  const filePath = String(finding?.file || '').trim();
  if (!filePath) return false;
  if (matchesAnyGlob(filePath, globs)) return true;

  const normalized = filePath.split(sep).join('/');
  const parts = normalized.split('/').filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const suffix = parts.slice(i).join('/');
    if (matchesAnyGlob(suffix, globs)) return true;
  }
  return false;
}

export function extractFindingIgnoreValue(finding) {
  if (!finding || typeof finding !== 'object') return '';
  const rule = normalizeIgnoreRule(finding.antipattern);
  const directValueRules = new Set([
    'overused-font',
    'bounce-easing',
    'design-system-font',
    'design-system-color',
    'design-system-radius',
  ]);
  if (!directValueRules.has(rule)) return '';
  return normalizeIgnoreValue(extractFindingIgnoreValueRaw(finding, rule));
}

function extractFindingIgnoreValueRaw(finding, rule = normalizeIgnoreRule(finding?.antipattern)) {
  const direct = cleanIgnoreValueDisplay(finding.ignoreValue || finding.value || '');
  if (direct) return direct;

  const candidates = [finding.detail, finding.snippet].filter((v) => typeof v === 'string' && v);
  for (const text of candidates) {
    if (rule === 'bounce-easing') {
      const motion = extractMotionIgnoreValue(text);
      if (motion) return motion;
      continue;
    }

    const primary = text.match(/Primary font:\s*([^()\n;]+)/i);
    if (primary) return cleanIgnoreValueDisplay(primary[1]);

    const family = text.match(/font-family\s*:\s*["']?([^'",;\n]+)/i);
    if (family) return cleanIgnoreValueDisplay(family[1]);

    const google = text.match(/[?&]family=([^&:;\n]+)/i);
    if (google) {
      try {
        return cleanIgnoreValueDisplay(decodeURIComponent(google[1]));
      } catch {
        return cleanIgnoreValueDisplay(google[1]);
      }
    }
  }

  return '';
}

function extractMotionIgnoreValue(text) {
  const tailwind = text.match(/\banimate-bounce\b/i);
  if (tailwind) return cleanIgnoreValueDisplay(tailwind[0]);

  const bezier = text.match(/cubic-bezier\([^)]+\)/i);
  if (bezier) return cleanIgnoreValueDisplay(bezier[0]);

  const animation = text.match(/animation(?:-name)?\s*:\s*([^;\n]+)/i);
  if (animation) {
    const token = animation[1]
      .split(/[,\s]+/)
      .find((part) => /bounce|elastic|wobble|jiggle|spring/i.test(part));
    if (token) return cleanIgnoreValueDisplay(token);
  }

  return '';
}

function cleanIgnoreValueDisplay(value) {
  return String(value || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\+/g, ' ')
    .replace(/\s+/g, ' ');
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
