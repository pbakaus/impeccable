/**
 * Shared library for the Impeccable design hook.
 *
 * Pure-ish helpers split out from `hook.mjs` so unit tests can exercise
 * config parsing, finding filtering, dedup, render, and cache logic without
 * spawning a subprocess. `hook.mjs` itself is the thin stdin/stdout shim.
 *
 * Public surface (everything exported is part of the contract):
 *   ENVELOPE_PREFIX, ALLOWED_EXTS, ACK_EXTS, SENSITIVE_PATH, GENERATED_PATH, TRUTHY
 *   truthy(value)
 *   readConfig(cwd) / DEFAULT_CONFIG / getConfigPath(cwd) / getLocalConfigPath(cwd)
 *   resolveProjectPlatform(cwd) / isNativePlatform(platform)
 *   normalizeIgnoreValue(value)
 *   readCache(cwd) / persistCache(cwd, cache) / resolveCacheCwd(primaryFile, sessionCwd)
 *   bumpEditCount(cache, sessionId, filePath) -> number
 *   suppressionNotice(filePath)
 *   filterFindings(findings, content, ext, config)
 *   matchConfiguredExtension(filePath, extensions)
 *   dedupeAgainstCache(findings, cache, sessionId, filePath)
 *   renderTemplate(findings, filePath, config, opts)
 *   renderCleanAck(filePath, opts) / renderPendingAck(filePath, known, opts)
 *   shouldEmitAckForFile(filePath, config?)
 *   writeAuditLog(env, entry)
 *   loadDetector() -> Promise<{ detectText, detectHtml }>
 *   matchesAnyGlob(filePath, globs)
 *   normalizeScanTargets(primaryTargets, projectCwd)
 *   runHook(deps) -> { exitCode, stdout, audit, reason? }
 *
 * Design notes:
 * - All errors are swallowed at the runHook seam. The detector throwing must
 *   never break a turn. See PRD §5 "Failure modes".
 * - Cache shape is JSON-friendly; we gc the oldest sessions when there are
 *   more than 8 to keep file size predictable across long-lived projects.
 * - The detector loader looks for `detector/detect-antipatterns.mjs` next to
 *   this file first (built skill layout) and falls back to the repo root's
 *   `cli/engine/detect-antipatterns.mjs` (running from source).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { extractPlatform, loadContext } from './context.mjs';
import { IMPECCABLE_COMMAND } from './lib/provider.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ENVELOPE_PREFIX = '[impeccable@1]';

export const ALLOWED_EXTS = new Set([
  '.tsx', '.jsx', '.html', '.htm', '.vue', '.svelte', '.astro',
  '.css', '.scss', '.sass', '.less', '.ts', '.js',
]);

export const ACK_EXTS = new Set([
  '.tsx', '.jsx', '.html', '.htm', '.vue', '.svelte', '.astro',
  '.css', '.scss', '.sass', '.less',
]);

// Hard-skip regex for sensitive files. Cannot be turned off via config.
// Match tokenized secret/credential filenames, not UI names such as
// CredentialForm.tsx, SecretPage.jsx, or secretary-dashboard.vue.
export const SENSITIVE_PATH = new RegExp([
  String.raw`(?:^|[/\\])\.env(?:\.|$)`,
  String.raw`(?:^|[/\\])\.git(?:[/\\]|$)`,
  String.raw`(?:^|[/\\])id_rsa(?:$|[._-])[^/\\]*$`,
  String.raw`(?:^|[/\\])[^/\\]*\.pem$`,
  String.raw`(?:^|[/\\])(?:[^/\\]*[._-])?(?:secret|secrets|credential|credentials)(?=[._-])[^/\\]*\.(?:json|ya?ml|toml|ini|conf|config|env|txt|key|cert|crt|pem|js|ts)$`,
].join('|'), 'i');

// Hard-skip regex for generated, lock, minified, and build-output paths.
// `generated` is matched as a whole path segment so authored names such as
// `generated-utils.ts` or `CodeGenerator.tsx` still get scanned.
export const GENERATED_PATH = /(?:\.generated\.[a-z]+$|\.d\.ts$|\.min\.[a-z]+$|[/\\]node_modules[/\\]|[/\\]generated[/\\]|[/\\](?:dist|build|out|\.next|\.cache|coverage)[/\\]|[/\\]?[^/\\]+\.lock(?:\.json)?$)/i;

export const TRUTHY = /^(1|true|yes|on)$/i;

export const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  quiet: false,
  auditLog: null,
  designSystem: { enabled: true },
  ignoreRules: [],
  ignoreFiles: [],
  ignoreValues: [],
  extensions: [],
  // maxFileBytes: not every generated artifact lives under a path we can
  // recognize. Committed browser bundles and vendored detector copies sit
  // next to source and run 200KB+, while genuinely authored stylesheets in
  // this codebase top out under 90KB. A single file past the ceiling is a
  // bundle, and findings against a bundle are never actionable.
  limits: { maxFindings: 5, maxChars: 8000, maxFileBytes: 131072 },
});

export const HOOK_LOCAL_IGNORE_PATTERNS = Object.freeze([
  '.impeccable/hook.cache.json',
  '.impeccable/hook.pending.json',
  '.impeccable/config.local.json',
]);

const HOOK_IGNORE_MARKER_OPEN = '# impeccable-hook-ignore-start';
const HOOK_IGNORE_MARKER_CLOSE = '# impeccable-hook-ignore-end';
const CACHE_MAX_SESSIONS = 8;
export const EDIT_COUNT_THRESHOLD = 6;

export function truthy(value) {
  return typeof value === 'string' && TRUTHY.test(value);
}

function depthIsSet(value) {
  if (value === undefined || value === null) return false;
  const text = String(value).trim();
  if (!text) return false;
  if (TRUTHY.test(text)) return true;
  return /^\d+$/.test(text) && Number(text) > 0;
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

export function getConfigPath(cwd) {
  return path.join(cwd, '.impeccable', 'config.json');
}

export function getLocalConfigPath(cwd) {
  return path.join(cwd, '.impeccable', 'config.local.json');
}

export function getCachePath(cwd) {
  return path.join(cwd, '.impeccable', 'hook.cache.json');
}

export function getPendingPath(cwd) {
  return path.join(cwd, '.impeccable', 'hook.pending.json');
}

export function resolveProjectCwd(event, fallback = process.cwd()) {
  return event?.cwd
    || (Array.isArray(event?.workspace_roots) && event.workspace_roots[0])
    || envProjectDir(fallback)
    || fallback;
}

function looksLikeProjectRoot(dir) {
  return ['.git', 'package.json', '.impeccable'].some((marker) => {
    try { return fs.existsSync(path.join(dir, marker)); } catch { return false; }
  });
}

// Where `.impeccable/` (cache + config) lives for this event. Normally the
// session cwd, untouched. But when the agent was launched from an umbrella
// directory that is not itself a project (no .git, package.json, or
// .impeccable), key to the edited file's nearest project root instead, so a
// multi-project launch dir doesn't accumulate a shared cross-project cache
// (issue #305). Climbing stops at the home dir, falling back to the session
// cwd when no marker is found.
export function resolveCacheCwd(primaryFile, sessionCwd) {
  const base = path.resolve(sessionCwd || process.cwd());
  if (!primaryFile || typeof primaryFile !== 'string' || hasPathTraversal(primaryFile)) return base;
  if (looksLikeProjectRoot(base)) return base;
  let dir;
  try {
    dir = path.dirname(path.resolve(primaryFile));
  } catch {
    return base;
  }
  const home = path.resolve(os.homedir());
  while (true) {
    if (dir === home) return base;
    if (looksLikeProjectRoot(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return base;
    dir = parent;
  }
}

// The detector's rules are web rules (HTML/CSS shapes), but a React Native or
// Flutter project is made of the exact extensions the hook watches (.tsx, .ts,
// .js), so without this gate every native screen edit would draw web-shaped
// findings that contradict the native platform references. PRODUCT.md's
// `## Platform` field decides: `ios` / `android` / `adaptive` projects skip
// the scan entirely. Resolution goes through loadContext so the hook reads the
// same PRODUCT.md the skill does (alternate context dirs, monorepo fallback).
export function resolveProjectPlatform(cwd) {
  try {
    const ctx = loadContext(cwd);
    return extractPlatform(ctx && ctx.product);
  } catch {
    return null;
  }
}

export function isNativePlatform(platform) {
  return platform === 'ios' || platform === 'android' || platform === 'adaptive';
}

export function readConfig(cwd) {
  const config = cloneDefaultConfig();
  // Hook runtime settings live under `hook`; detector filters live under
  // `detector`. Back-compat: older configs stored detector filters in `hook`,
  // so read those first and let canonical `detector` settings win.
  for (const filePath of [getConfigPath(cwd), getLocalConfigPath(cwd)]) {
    const raw = safeReadJson(filePath);
    applyConfigSource(config, hookSection(raw));
    applyDetectorConfigSource(config, detectorSection(raw));
  }
  return config;
}

// The hook settings subtree of a unified config.json / config.local.json.
function hookSection(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return raw.hook && typeof raw.hook === 'object' && !Array.isArray(raw.hook) ? raw.hook : null;
}

function detectorSection(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return raw.detector && typeof raw.detector === 'object' && !Array.isArray(raw.detector) ? raw.detector : null;
}

function numberOr(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function cloneDefaultConfig() {
  return {
    ...DEFAULT_CONFIG,
    ignoreRules: [],
    ignoreFiles: [],
    ignoreValues: [],
    extensions: [],
    designSystem: { ...DEFAULT_CONFIG.designSystem },
    limits: { ...DEFAULT_CONFIG.limits },
  };
}

function applyDetectorConfigSource(config, raw) {
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
  if (Array.isArray(raw.extensions)) {
    config.extensions = mergeExtensions(config.extensions, raw.extensions);
  }
  return config;
}

// Extra scanned extensions from `detector.extensions` config. Entries are
// `{ ext, engine }` (engine 'html' | 'text', default 'html' — the common case
// for server-side templates) or bare strings as shorthand. Extensions are
// matched against the end of the filename, not path.extname, so double
// extensions like `.blade.php` and `.html.erb` work (issue #316).
function normalizeExtensionEntries(entries) {
  if (!Array.isArray(entries)) return [];
  const out = [];
  for (const entry of entries) {
    const raw = typeof entry === 'string' ? entry : entry?.ext;
    if (typeof raw !== 'string') continue;
    let ext = raw.trim().toLowerCase();
    if (!ext) continue;
    if (!ext.startsWith('.')) ext = `.${ext}`;
    const engine = (!(typeof entry === 'string') && entry?.engine === 'text') ? 'text' : 'html';
    out.push({ ext, engine });
  }
  return out;
}

function mergeExtensions(existing, incoming) {
  const map = new Map();
  for (const entry of normalizeExtensionEntries(existing)) map.set(entry.ext, entry);
  for (const entry of normalizeExtensionEntries(incoming)) map.set(entry.ext, entry);
  return Array.from(map.values());
}

export function matchConfiguredExtension(filePath, extensions) {
  if (!Array.isArray(extensions) || extensions.length === 0) return null;
  const name = path.basename(String(filePath || '')).toLowerCase();
  if (!name) return null;
  // The longest matching suffix wins, so `.blade.php` beats a broader `.php`
  // entry regardless of config order.
  let best = null;
  for (const entry of normalizeExtensionEntries(extensions)) {
    if (name.length > entry.ext.length && name.endsWith(entry.ext)
      && (!best || entry.ext.length > best.ext.length)) {
      best = entry;
    }
  }
  return best;
}

function applyConfigSource(config, raw) {
  if (!raw || typeof raw !== 'object') return config;
  if (Object.prototype.hasOwnProperty.call(raw, 'enabled')) {
    config.enabled = raw.enabled === false ? false : true;
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'quiet')) {
    config.quiet = raw.quiet === true;
  }
  if (typeof raw.auditLog === 'string' && raw.auditLog.trim()) {
    config.auditLog = raw.auditLog.trim();
  }
  applyDetectorConfigSource(config, raw);
  if (raw.limits && typeof raw.limits === 'object') {
    config.limits = {
      maxFindings: numberOr(raw.limits.maxFindings, config.limits.maxFindings),
      maxChars: numberOr(raw.limits.maxChars, config.limits.maxChars),
      maxFileBytes: numberOr(raw.limits.maxFileBytes, config.limits.maxFileBytes),
    };
  }
  return config;
}

function uniqueStrings(values) {
  return Array.from(new Set(values.map(String)));
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

function colorIgnoreKey(value) {
  const color = parseIgnoreColor(value);
  if (!color) return '';
  return `${color.r},${color.g},${color.b},${Math.round(color.a * 255)}`;
}

function parseIgnoreColor(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return null;

  const hex = text.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hex) return parseHexIgnoreColor(hex[1]);

  const rgb = text.match(/^rgba?\((.*)\)$/i);
  if (rgb) {
    const parts = splitColorArgs(rgb[1]);
    if (parts.length < 3 || parts.length > 4) return null;
    const r = parseRgbChannel(parts[0]);
    const g = parseRgbChannel(parts[1]);
    const b = parseRgbChannel(parts[2]);
    const a = parts[3] === undefined ? 1 : parseAlphaChannel(parts[3]);
    if ([r, g, b, a].some((v) => v === null)) return null;
    return { r, g, b, a };
  }

  const hsl = text.match(/^hsla?\((.*)\)$/i);
  if (hsl) {
    const parts = splitColorArgs(hsl[1]);
    if (parts.length < 3 || parts.length > 4) return null;
    const h = parseHueChannel(parts[0]);
    const s = parsePercentChannel(parts[1]);
    const l = parsePercentChannel(parts[2]);
    const a = parts[3] === undefined ? 1 : parseAlphaChannel(parts[3]);
    if ([h, s, l, a].some((v) => v === null)) return null;
    return hslToRgb(h, s, l, a);
  }

  return null;
}

function parseHexIgnoreColor(hex) {
  if (hex.length === 3 || hex.length === 4) {
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    const a = hex.length === 4 ? parseInt(hex[3] + hex[3], 16) / 255 : 1;
    return { r, g, b, a };
  }
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
  return { r, g, b, a };
}

function splitColorArgs(body) {
  const text = String(body || '').trim();
  if (!text) return [];
  if (text.includes(',')) {
    const parts = text.split(',').map((part) => part.trim()).filter(Boolean);
    const last = parts[parts.length - 1];
    if (last && last.includes('/')) {
      const split = last.split('/').map((part) => part.trim()).filter(Boolean);
      return [...parts.slice(0, -1), ...split];
    }
    return parts;
  }
  return text.replace(/\s*\/\s*/g, ' / ').split(/\s+/).filter((part) => part && part !== '/');
}

function parseRgbChannel(raw) {
  const text = String(raw || '').trim();
  const match = text.match(/^(-?\d*\.?\d+)(%)?$/);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return null;
  const scaled = match[2] ? value * 2.55 : value;
  if (scaled < 0 || scaled > 255) return null;
  return Math.round(scaled);
}

function parseAlphaChannel(raw) {
  const text = String(raw || '').trim();
  const match = text.match(/^(-?\d*\.?\d+)(%)?$/);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return null;
  const alpha = match[2] ? value / 100 : value;
  return alpha >= 0 && alpha <= 1 ? alpha : null;
}

function parseHueChannel(raw) {
  const text = String(raw || '').trim();
  const match = text.match(/^(-?\d*\.?\d+)(deg|rad|turn|grad)?$/);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = match[2] || 'deg';
  if (unit === 'turn') return value * 360;
  if (unit === 'rad') return value * (180 / Math.PI);
  if (unit === 'grad') return value * 0.9;
  return value;
}

function parsePercentChannel(raw) {
  const text = String(raw || '').trim();
  const match = text.match(/^(-?\d*\.?\d+)%$/);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return null;
  return value >= 0 && value <= 100 ? value / 100 : null;
}

function hslToRgb(hue, saturation, lightness, alpha) {
  const h = (((hue % 360) + 360) % 360) / 360;
  if (saturation === 0) {
    const gray = clampByte(Math.round(lightness * 255));
    return { r: gray, g: gray, b: gray, a: alpha };
  }
  const q = lightness < 0.5
    ? lightness * (1 + saturation)
    : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  const toRgb = (t) => {
    let channel = t;
    if (channel < 0) channel += 1;
    if (channel > 1) channel -= 1;
    if (channel < 1 / 6) return p + (q - p) * 6 * channel;
    if (channel < 1 / 2) return q;
    if (channel < 2 / 3) return p + (q - p) * (2 / 3 - channel) * 6;
    return p;
  };
  return {
    r: clampByte(Math.round(toRgb(h + 1 / 3) * 255)),
    g: clampByte(Math.round(toRgb(h) * 255)),
    b: clampByte(Math.round(toRgb(h - 1 / 3) * 255)),
    a: alpha,
  };
}

function clampByte(value) {
  return Math.min(255, Math.max(0, value));
}

function ignoreValueMatches(rule, entryValue, findingValue) {
  if (entryValue === findingValue) return true;
  if (rule !== 'design-system-color') return false;
  const entryColor = colorIgnoreKey(entryValue);
  return Boolean(entryColor && entryColor === colorIgnoreKey(findingValue));
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
    // Key order is rule, value, files, createdAt, reason and must stay that way:
    // normalizing runs on every write, so emitting a different order than the one
    // already on disk rewrites every untouched entry and churns the diff.
    if (typeof entry.createdAt === 'string' && entry.createdAt.trim()) {
      normalized.createdAt = entry.createdAt.trim();
    }
    if (typeof entry.reason === 'string' && entry.reason.trim()) {
      normalized.reason = entry.reason.trim();
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
  // Sort before joining: a scope is a set, so an entry already on disk in another
  // order must compare equal rather than dedup as two distinct entries.
  return Array.isArray(files) && files.length > 0 ? [...files].sort().join('\x1f') : '';
}

export function readCache(cwd) {
  const raw = safeReadJson(getCachePath(cwd));
  if (!raw || typeof raw !== 'object' || raw.version !== 1) {
    return { version: 1, sessions: {} };
  }
  return {
    version: 1,
    sessions: raw.sessions && typeof raw.sessions === 'object' ? raw.sessions : {},
  };
}

export function persistCache(cwd, cache) {
  const sessions = cache.sessions || {};
  const ids = Object.keys(sessions);
  if (ids.length > CACHE_MAX_SESSIONS) {
    // Garbage-collect oldest sessions by updatedAt.
    const ordered = ids
      .map((id) => [id, sessions[id]?.updatedAt || 0])
      .sort((a, b) => b[1] - a[1])
      .slice(0, CACHE_MAX_SESSIONS);
    const next = {};
    for (const [id] of ordered) next[id] = sessions[id];
    cache = { ...cache, sessions: next };
  }
  const target = getCachePath(cwd);
  try {
    ensureHookGitExcludes(cwd);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(cache));
    return true;
  } catch {
    return false;
  }
}

export function ensureHookGitExcludes(cwd = process.cwd()) {
  try {
    const target = resolveHookGitExcludeTarget(cwd);
    if (!target) {
      return { mode: 'none', changed: false, patterns: [...HOOK_LOCAL_IGNORE_PATTERNS] };
    }

    const patterns = target.patternPrefix
      ? HOOK_LOCAL_IGNORE_PATTERNS.map((pattern) => `${target.patternPrefix}/${pattern}`)
      : [...HOOK_LOCAL_IGNORE_PATTERNS];
    const markerSuffix = target.patternPrefix || '.';
    const markerOpen = `${HOOK_IGNORE_MARKER_OPEN} ${markerSuffix}`;
    const markerClose = `${HOOK_IGNORE_MARKER_CLOSE} ${markerSuffix}`;
    const existing = fs.existsSync(target.path) ? fs.readFileSync(target.path, 'utf-8') : '';
    const block = [markerOpen, ...patterns, markerClose].join('\n');
    const markerRe = new RegExp(`${escapeRegExp(markerOpen)}[\\s\\S]*?${escapeRegExp(markerClose)}`);

    let updated;
    if (markerRe.test(existing)) {
      updated = existing.replace(markerRe, block);
    } else {
      const prefix = existing.length === 0 ? '' : existing.endsWith('\n') ? existing : `${existing}\n`;
      updated = `${prefix}${prefix.endsWith('\n\n') || prefix === '' ? '' : '\n'}${block}\n`;
    }

    if (updated !== existing) {
      fs.mkdirSync(path.dirname(target.path), { recursive: true });
      fs.writeFileSync(target.path, updated, 'utf-8');
    }

    return {
      mode: 'git-info-exclude',
      file: path.relative(path.resolve(cwd), target.path).split(path.sep).join('/'),
      changed: updated !== existing,
      patterns,
    };
  } catch {
    return { mode: 'error', changed: false, patterns: [...HOOK_LOCAL_IGNORE_PATTERNS] };
  }
}

function resolveHookGitExcludeTarget(cwd) {
  const start = path.resolve(cwd);
  let dir = start;
  while (true) {
    const dotGit = path.join(dir, '.git');
    if (fs.existsSync(dotGit)) {
      const gitDir = resolveGitDir(dotGit, dir);
      if (!gitDir) return null;
      const relPrefix = path.relative(dir, start).split(path.sep).join('/');
      return {
        path: path.join(gitDir, 'info', 'exclude'),
        patternPrefix: relPrefix && relPrefix !== '.' ? relPrefix : '',
      };
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function resolveGitDir(dotGit, worktreeDir) {
  const stat = fs.statSync(dotGit);
  if (stat.isDirectory()) return dotGit;
  if (!stat.isFile()) return null;

  const body = fs.readFileSync(dotGit, 'utf-8').trim();
  const match = body.match(/^gitdir:\s*(.+)$/i);
  if (!match) return null;
  return path.isAbsolute(match[1]) ? match[1] : path.resolve(worktreeDir, match[1]);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function ensureSession(cache, sessionId) {
  if (!cache.sessions[sessionId]) {
    cache.sessions[sessionId] = { updatedAt: Date.now(), files: {} };
  }
  return cache.sessions[sessionId];
}

function ensureFile(cache, sessionId, filePath) {
  const session = ensureSession(cache, sessionId);
  if (!session.files[filePath]) {
    session.files[filePath] = { editCount: 0, findings: [] };
  }
  return session.files[filePath];
}

export function bumpEditCount(cache, sessionId, filePath) {
  const fileEntry = ensureFile(cache, sessionId, filePath);
  fileEntry.editCount = (fileEntry.editCount || 0) + 1;
  ensureSession(cache, sessionId).updatedAt = Date.now();
  return fileEntry.editCount;
}

export function suppressionNotice(filePath) {
  return `${ENVELOPE_PREFIX} Suppressing further design hints on ${filePath}. More than ${EDIT_COUNT_THRESHOLD} edits in this session reached. Run ${IMPECCABLE_COMMAND} audit to revisit.`;
}

// Glob → RegExp. Supports `**`, `*`, `?`, and `{a,b}` alternation.
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
  const normalized = filePath.split(path.sep).join('/');
  for (const glob of globs) {
    try {
      const re = globToRegex(String(glob));
      if (re.test(normalized)) return true;
      // Match against basename too for convenience: `*.generated.tsx` should
      // catch `src/foo.generated.tsx` without requiring `**/`.
      const base = normalized.split('/').pop();
      if (re.test(base)) return true;
    } catch {
      /* malformed glob, skip */
    }
  }
  return false;
}

export function filterFindings(findings, _content, _ext, config) {
  if (!Array.isArray(findings) || findings.length === 0) return [];
  const ignoreRules = new Set((config.ignoreRules || []).map((rule) => normalizeIgnoreRule(rule)));
  const ignoreValues = normalizeIgnoreValueEntries(config.ignoreValues || []);
  return findings.filter((f) => {
    if (!f || typeof f !== 'object') return false;
    if (ignoreRules.has(normalizeIgnoreRule(f.antipattern))) return false;
    if (isIgnoredFindingValue(f, ignoreValues)) return false;
    return true;
  });
}

function isIgnoredFindingValue(finding, ignoreValues) {
  if (!Array.isArray(ignoreValues) || ignoreValues.length === 0) return false;
  const rule = normalizeIgnoreRule(finding.antipattern);
  if (!rule) return false;
  // File-scoped wildcards suppress rules with no extractable value, such as side-tab.
  const value = extractFindingIgnoreValue(finding);
  return ignoreValues.some((entry) => {
    if (entry.rule !== rule) return false;
    const wildcardValue = entry.value === '*';
    if (!wildcardValue && (!value || !ignoreValueMatches(rule, entry.value, value))) return false;
    if (!Array.isArray(entry.files) || entry.files.length === 0) return !wildcardValue;
    return findingMatchesScopedIgnoreFile(finding, entry.files);
  });
}

function findingMatchesScopedIgnoreFile(finding, globs) {
  const filePath = String(finding?.file || '').trim();
  if (!filePath) return false;
  if (matchesAnyGlob(filePath, globs)) return true;

  const normalized = filePath.split(path.sep).join('/');
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
    'design-system-font-size',
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

export function dedupeAgainstCache(findings, cache, sessionId, filePath) {
  if (!Array.isArray(findings) || findings.length === 0) return [];
  const fileEntry = ensureFile(cache, sessionId, filePath);
  const known = new Set(fileEntry.findings || []);
  const fresh = [];
  for (const f of findings) {
    const key = findingCacheKey(f);
    if (known.has(key)) continue;
    known.add(key);
    fresh.push(f);
  }
  return fresh;
}

// Sync the remembered set to the findings present in the scan just performed.
//
// This replaces rather than accumulates, and that is the whole point. An
// append-only set made the hook lie twice over: the pending ack counted
// history instead of the live scan, so it kept naming findings the agent had
// already fixed, and a finding that was fixed and later reintroduced was
// deduped against a stale memory and never re-reported. Forgetting what is no
// longer there is what lets the count shrink and a regression fire again.
//
// Callers must pass the complete current finding set, not just the fresh ones.
export function rememberFindings(cache, sessionId, filePath, findings) {
  const fileEntry = ensureFile(cache, sessionId, filePath);
  const keys = new Set((findings || []).map(f => findingCacheKey(f)));
  fileEntry.findings = Array.from(keys);
  ensureSession(cache, sessionId).updatedAt = Date.now();
}

function findingCacheKey(finding) {
  const line = finding?.line || 0;
  const value = extractFindingIgnoreValue(finding);
  if (line > 0 && value) return `${finding.antipattern}:${line}:${value}`;
  if (line > 0) return `${finding.antipattern}:${line}`;
  if (value) return `${finding.antipattern}:0:${value}`;
  const snippet = String(finding?.snippet || '').trim().slice(0, 80);
  return snippet ? `${finding.antipattern}:0:${snippet}` : `${finding.antipattern}:0`;
}

export function renderTemplate(findings, filePath, config, opts = {}) {
  if (!Array.isArray(findings) || findings.length === 0) return '';
  const limits = config?.limits || DEFAULT_CONFIG.limits;
  const cap = Math.max(1, limits.maxFindings || DEFAULT_CONFIG.limits.maxFindings);
  const maxChars = Math.max(500, limits.maxChars || DEFAULT_CONFIG.limits.maxChars);

  const cwd = opts.cwd || process.cwd();
  const display = relativize(filePath, cwd);
  const total = findings.length;
  const shown = findings.slice(0, cap);
  const remaining = total - shown.length;

  const header = `${ENVELOPE_PREFIX} Design hook findings requiring review in ${display} (${total} issue(s)):`;
  const lines = shown.map((f) => formatFindingLine(f));
  const more = remaining > 0
    ? `... and ${remaining} more (see ${IMPECCABLE_COMMAND} audit).`
    : null;
  const footer = directiveFooter(display);

  const blocks = [header, ...lines];
  if (more) blocks.push(more);
  blocks.push('');
  blocks.push(footer);
  let text = blocks.join('\n');

  if (text.length > maxChars) {
    text = clampToBudget(header, lines, more, footer, maxChars);
  }
  return text;
}

function renderGroupedTemplate(groups, config, opts = {}) {
  const realGroups = groups.filter((group) => Array.isArray(group.findings) && group.findings.length > 0);
  if (realGroups.length === 0) return '';
  if (realGroups.length === 1) {
    const [group] = realGroups;
    return renderTemplate(group.findings, group.filePath, config, opts);
  }

  const limits = config?.limits || DEFAULT_CONFIG.limits;
  const cap = Math.max(1, limits.maxFindings || DEFAULT_CONFIG.limits.maxFindings);
  const maxChars = Math.max(500, limits.maxChars || DEFAULT_CONFIG.limits.maxChars);
  const cwd = opts.cwd || process.cwd();
  const total = realGroups.reduce((sum, group) => sum + group.findings.length, 0);
  const header = `${ENVELOPE_PREFIX} Design hook findings requiring review across ${realGroups.length} files (${total} issue(s)):`;
  const lines = [];
  let shownCount = 0;

  for (const group of realGroups) {
    const display = relativize(group.filePath, cwd);
    lines.push(`${display} (${group.findings.length} issue(s)):`);
    const remainingCap = Math.max(0, cap - shownCount);
    const shown = group.findings.slice(0, remainingCap);
    for (const finding of shown) {
      lines.push(formatFindingLine(finding));
    }
    shownCount += shown.length;
    const hidden = group.findings.length - shown.length;
    if (hidden > 0) {
      lines.push(`- ... ${hidden} more in ${display} (see ${IMPECCABLE_COMMAND} audit).`);
    }
  }

  const footer = directiveFooter('the affected files', { grouped: true });
  let text = [header, ...lines, '', footer].join('\n');
  if (text.length > maxChars) {
    text = clampGroupedToBudget(header, lines, footer, maxChars);
  }
  return text;
}

function clampGroupedToBudget(header, lines, footer, maxChars) {
  const assemble = (linesArr, omitted) => [
    header,
    ...linesArr,
    ...(omitted ? [`... and more (see ${IMPECCABLE_COMMAND} audit).`] : []),
    '',
    footer,
  ].join('\n');

  let working = lines.slice();
  let omitted = false;
  let assembled = assemble(working, omitted);
  while (assembled.length > maxChars && working.length > 1) {
    working.pop();
    omitted = true;
    assembled = assemble(working, omitted);
  }
  if (assembled.length > maxChars) {
    assembled = `${assembled.slice(0, maxChars - 1)}…`;
  }
  return assembled;
}

function clampToBudget(header, lines, more, footer, maxChars) {
  const assemble = (linesArr, moreText) => {
    const blocks = [header, ...linesArr];
    if (moreText) blocks.push(moreText);
    blocks.push('');
    blocks.push(footer);
    return blocks.join('\n');
  };

  let working = lines.slice();
  let moreText = more;
  let assembled = assemble(working, moreText);
  while (assembled.length > maxChars && working.length > 1) {
    working.pop();
    moreText = `... and more (see ${IMPECCABLE_COMMAND} audit).`;
    assembled = assemble(working, moreText);
  }
  if (assembled.length > maxChars) {
    assembled = `${assembled.slice(0, maxChars - 1)}…`;
  }
  return assembled;
}

function formatFindingLine(f) {
  const prefix = f.line && f.line > 0 ? `- L${f.line}` : '-';
  const desc = (f.description || '').trim();
  const name = (f.name || '').trim();
  // Description from the registry already ends in punctuation; join with a
  // single space. `name` may have a trailing period already, keep it clean.
  const nameSegment = name ? `${name.replace(/\.+\s*$/, '')}.` : '';
  const ignoreCommand = formatFindingIgnoreCommand(f);
  const ignoreSegment = ignoreCommand
    ? ` If the user explicitly confirms this value is intentional: \`${ignoreCommand}\`.`
    : '';
  return `${prefix} [${f.antipattern}] ${nameSegment} ${desc}${ignoreSegment}`.replace(/\s+/g, ' ').trim();
}

function formatFindingIgnoreCommand(finding) {
  if (!finding || typeof finding !== 'object') return '';
  const rule = normalizeIgnoreRule(finding.antipattern);
  if (!rule) return '';
  const normalizedValue = extractFindingIgnoreValue(finding);
  if (!normalizedValue) return '';
  const value = extractFindingIgnoreValueRaw(finding);
  const valueArg = quoteCommandArg(value);
  const reason = quoteCommandArg(`User confirmed ${value} is intentional`);
  return `${IMPECCABLE_COMMAND} hooks ignore-value ${rule} ${valueArg} --shared --reason ${reason}`;
}

function quoteCommandArg(value) {
  const text = String(value || '').trim();
  if (/^[A-Za-z0-9._:-]+$/.test(text)) return text;
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function relativize(filePath, cwd) {
  try {
    const rel = path.relative(cwd, filePath);
    if (!rel || rel.startsWith('..')) return filePath;
    return rel.split(path.sep).join('/');
  } catch {
    return filePath;
  }
}

// Codex `apply_patch` exposes the raw patch in `tool_input.command`, not
// `tool_input.file_path`. Claude Code may send both; parse the patch body
// so we can scan the file(s) the tool actually touched.
// https://developers.openai.com/codex/hooks#posttooluse
const APPLY_PATCH_FILE_RE = /^\*\*\* (?:Update|Add) File: (.+)$/gm;

export function parseApplyPatchPaths(command, projectCwd) {
  if (!command || typeof command !== 'string') return [];
  const out = [];
  for (const m of command.matchAll(APPLY_PATCH_FILE_RE)) {
    let p = (m[1] || '').trim();
    if (!p) continue;
    if (!path.isAbsolute(p)) p = path.resolve(projectCwd, p);
    out.push(p);
  }
  return out;
}

export function resolveTargetFiles(event, projectCwd) {
  const ti = event?.tool_input;
  const out = [];
  const add = (filePath) => {
    if (typeof filePath !== 'string' || !filePath) return;
    if (!out.includes(filePath)) out.push(filePath);
  };

  if (event?.tool_name === 'apply_patch' && ti && typeof ti.command === 'string') {
    for (const filePath of parseApplyPatchPaths(ti.command, projectCwd)) add(filePath);
  }
  if (ti && typeof ti.file_path === 'string' && ti.file_path) {
    add(ti.file_path);
  }
  // Cursor Write / StrReplace use `path`, not `file_path`.
  if (ti && typeof ti.path === 'string' && ti.path) {
    add(ti.path);
  }
  if (typeof event?.file_path === 'string' && event.file_path) {
    add(event.file_path);
  }
  return out;
}

export function resolveHarness(env = {}, event = null) {
  const explicit = env?.IMPECCABLE_HOOK_HARNESS;
  if (explicit === 'cursor') return 'cursor';
  if (explicit === 'github') return 'github';
  if (explicit === 'claude' || explicit === 'codex') return 'claude';
  // GitHub Copilot's postToolUse event uses camelCase `toolName`/`toolArgs` and
  // has no `tool_name`/`tool_input`. That shape is the discriminator.
  if (event && typeof event === 'object'
    && (typeof event.toolName === 'string' || event.toolArgs !== undefined)
    && event.tool_name === undefined && event.tool_input === undefined) {
    return 'github';
  }
  if (typeof event?.conversation_id === 'string' && event.conversation_id) return 'cursor';
  return 'claude';
}

// GitHub Copilot's postToolUse payload is
//   { sessionId, timestamp, cwd, toolName, toolArgs, toolResult }
// mapped onto the internal `{ tool_name, tool_input, cwd, session_id }` shape.
// `toolArgs` shape depends on the tool: the `edit`/`create`/`view` tools send a
// JSON *string* (double-encoded) carrying the file under `path`, e.g.
//   "{\"path\":\"/abs/app.tsx\",\"old_str\":\"...\",\"new_str\":\"...\"}",
// while `apply_patch` sends a raw OpenAI-format patch string (handled below in
// normalizeGitHubEvent). The detector reads the file from disk after the tool
// ran, so only the path (not the proposed content) is needed here.
export function parseGitHubToolArgs(toolArgs) {
  if (toolArgs && typeof toolArgs === 'object' && !Array.isArray(toolArgs)) return toolArgs;
  if (typeof toolArgs === 'string' && toolArgs.trim()) {
    try {
      const parsed = JSON.parse(toolArgs);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

// Copilot's `apply_patch` tool (used by interactive sessions and the cloud
// agent) sends a raw OpenAI-format patch string in toolArgs, not JSON:
//   *** Begin Patch
//   *** Add File: /abs/app.css
//   +body { ... }
//   *** End Patch
// The `view`/`edit`/`create` tools (seen in `copilot -p` runs) instead send a
// JSON string with the path under `path`. Both must map onto the internal shape.
const APPLY_PATCH_MARKER = /\*\*\* (?:Begin Patch|Add File:|Update File:|Delete File:)/;

function looksLikeApplyPatch(rawArgs) {
  if (typeof rawArgs !== 'string' || !APPLY_PATCH_MARKER.test(rawArgs)) return false;
  // Guard against an edit/create payload whose edited *content* happens to
  // contain patch markers: that payload is a JSON object string, whereas a real
  // apply_patch payload is a raw patch string that does not parse as JSON. Only
  // treat non-JSON-object strings as apply_patch so edit events still get their
  // `path` extracted.
  try {
    const parsed = JSON.parse(rawArgs);
    if (parsed && typeof parsed === 'object') return false;
  } catch { /* not JSON → genuine raw patch */ }
  return true;
}

function applyPatchText(rawArgs) {
  if (typeof rawArgs === 'string') {
    if (APPLY_PATCH_MARKER.test(rawArgs)) return rawArgs;
    // Defensive: a future Copilot build might JSON-wrap the patch.
    const parsed = parseGitHubToolArgs(rawArgs);
    return parsed.patch || parsed.input || parsed.command || '';
  }
  if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
    return rawArgs.patch || rawArgs.input || rawArgs.command || '';
  }
  return '';
}

function normalizeGitHubEvent(event, projectCwd) {
  const cwd = event.cwd || envProjectDir(projectCwd) || projectCwd;
  const sessionId = event.sessionId || event.session_id || 'unknown';
  const toolName = event.toolName || event.tool_name || null;
  const toolInput = event.tool_input && typeof event.tool_input === 'object' ? { ...event.tool_input } : {};
  const rawArgs = event.toolArgs;

  let normalizedToolName = toolName;
  if (toolName === 'apply_patch' || looksLikeApplyPatch(rawArgs)) {
    // resolveTargetFiles() reads the touched paths from tool_input.command when
    // tool_name is 'apply_patch', so normalize the name even if a future build
    // sends the patch under a different tool label.
    const patch = applyPatchText(rawArgs);
    if (patch) {
      toolInput.command = patch;
      normalizedToolName = 'apply_patch';
    }
  } else {
    const args = parseGitHubToolArgs(rawArgs);
    const filePath = args.path || args.file_path || args.filePath || args.target_file;
    if (typeof filePath === 'string' && filePath) toolInput.file_path = filePath;
  }

  return {
    ...event,
    cwd,
    session_id: sessionId,
    tool_name: normalizedToolName,
    tool_input: toolInput,
  };
}

export function normalizeHookEvent(event, projectCwd, harness = 'claude') {
  if (!event || typeof event !== 'object') return event;
  if (harness === 'github') return normalizeGitHubEvent(event, projectCwd);
  if (harness !== 'cursor') return event;

  const cwd = event.cwd
    || (Array.isArray(event.workspace_roots) && event.workspace_roots[0])
    || envProjectDir(projectCwd)
    || projectCwd;
  const sessionId = event.session_id || event.conversation_id || 'unknown';

  const ti = event.tool_input && typeof event.tool_input === 'object' ? event.tool_input : {};
  const filePath = ti.file_path || ti.path || event.file_path;
  if (filePath) {
    return {
      ...event,
      cwd,
      session_id: sessionId,
      tool_input: { ...ti, file_path: filePath },
    };
  }

  return { ...event, cwd, session_id: sessionId };
}

function envProjectDir(fallback) {
  if (typeof process.env.CURSOR_PROJECT_DIR === 'string' && process.env.CURSOR_PROJECT_DIR) {
    return process.env.CURSOR_PROJECT_DIR;
  }
  return fallback;
}

// UI components often keep slop in a sibling/co-located stylesheet while the
// JSX edit is what triggered PostToolUse. Scan those styles too so an App.jsx
// patch doesn't report "clean" while styles.css still has Inter/bounce/etc.
const UI_CODE_EXTS = new Set(['.jsx', '.tsx', '.vue', '.svelte', '.astro']);
const STYLE_EXTS = new Set(['.css', '.scss', '.sass', '.less']);
const CO_SCAN_STYLE_NAMES = [
  'styles.css', 'styles.scss', 'styles.sass', 'styles.less',
  'index.css', 'index.scss', 'index.sass', 'index.less',
  'global.css', 'global.scss', 'global.sass', 'global.less',
  'globals.css', 'globals.scss', 'globals.sass', 'globals.less',
];
const MAX_SCAN_TARGETS = 6;

const STATIC_STYLE_IMPORT_RE = /import\s+(?:[\w*{}\s,$]+\s+from\s+)?['"]([^'"]+\.(?:css|scss|sass|less))['"]/gi;

function hasPathTraversal(filePath) {
  return typeof filePath === 'string' && filePath.includes('..');
}

function isInsideProject(filePath, projectCwd) {
  if (!filePath || !projectCwd || hasPathTraversal(filePath)) return false;
  try {
    const rel = path.relative(projectCwd, filePath);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  } catch {
    return false;
  }
}

export function parseStaticStyleImports(content, fromFile, projectCwd) {
  if (!content || typeof content !== 'string') return [];
  const dir = path.dirname(fromFile);
  const out = [];
  for (const m of content.matchAll(STATIC_STYLE_IMPORT_RE)) {
    let p = (m[1] || '').trim();
    if (!p) continue;
    if (p.startsWith('.')) p = path.resolve(dir, p);
    else if (!path.isAbsolute(p)) p = path.resolve(projectCwd, p);
    if (!isInsideProject(p, projectCwd)) continue;
    out.push(p);
  }
  return out;
}

export function coLocatedStylesheets(filePath) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath, path.extname(filePath));
  const candidates = new Set([
    path.join(dir, `${base}.css`),
    path.join(dir, `${base}.module.css`),
    path.join(dir, `${base}.scss`),
    path.join(dir, `${base}.module.scss`),
    path.join(dir, `${base}.sass`),
    path.join(dir, `${base}.module.sass`),
    path.join(dir, `${base}.less`),
    path.join(dir, `${base}.module.less`),
  ]);
  for (const name of CO_SCAN_STYLE_NAMES) {
    candidates.add(path.join(dir, name));
  }
  return [...candidates].filter((p) => fs.existsSync(p));
}

export function normalizeScanTargets(primaryTargets, projectCwd) {
  if (!Array.isArray(primaryTargets) || primaryTargets.length === 0) return [];
  const ordered = [];
  const seen = new Set();
  const baseCwd = projectCwd || process.cwd();
  const normalizeTarget = (p) => {
    // Preserve literal `..` segments so downstream sensitive-path checks
    // still fire. path.resolve would collapse `/foo/../etc/passwd`.
    if (hasPathTraversal(p)) return p;
    return path.isAbsolute(p) ? p : path.resolve(baseCwd, p);
  };
  const add = (p) => {
    if (ordered.length >= MAX_SCAN_TARGETS) return;
    const abs = normalizeTarget(p);
    if (seen.has(abs)) return;
    seen.add(abs);
    ordered.push(abs);
    return abs;
  };

  for (const p of primaryTargets) add(p);
  return ordered;
}

export function expandScanTargets(primaryTargets, projectCwd) {
  const ordered = normalizeScanTargets(primaryTargets, projectCwd);
  if (ordered.length === 0) return [];
  const seen = new Set(ordered);
  const baseCwd = projectCwd || process.cwd();
  const add = (p) => {
    if (ordered.length >= MAX_SCAN_TARGETS) return;
    const abs = hasPathTraversal(p) ? p : (path.isAbsolute(p) ? p : path.resolve(baseCwd, p));
    if (seen.has(abs)) return;
    seen.add(abs);
    ordered.push(abs);
    return abs;
  };

  const normalizedPrimaries = [];
  for (const p of ordered) normalizedPrimaries.push(p);

  for (const p of normalizedPrimaries) {
    if (ordered.length >= MAX_SCAN_TARGETS) break;
    if (!isInsideProject(p, baseCwd)) continue;
    const ext = path.extname(p).toLowerCase();
    if (STYLE_EXTS.has(ext) || !UI_CODE_EXTS.has(ext)) continue;

    let content = '';
    try { content = fs.readFileSync(p, 'utf-8'); } catch { /* unreadable primary */ }

    for (const imp of parseStaticStyleImports(content, p, projectCwd)) {
      add(imp);
      if (ordered.length >= MAX_SCAN_TARGETS) break;
    }
    for (const col of coLocatedStylesheets(p)) {
      add(col);
      if (ordered.length >= MAX_SCAN_TARGETS) break;
    }
  }

  return ordered;
}

export function writeAuditLog(env, entry, cwd = process.cwd()) {
  // The event's project root (entry.cwd) when present, else the passed cwd. Both
  // config reads and relative log paths resolve against this, since the hook
  // process cwd can differ from the project being edited.
  const baseCwd = entry && typeof entry.cwd === 'string' && entry.cwd ? entry.cwd : cwd;
  // Env wins; otherwise fall back to the unified config's hook.auditLog path.
  let target = env?.IMPECCABLE_HOOK_LOG;
  if (!target || typeof target !== 'string') {
    try { target = readConfig(baseCwd).auditLog; } catch { target = null; }
  }
  if (!target || typeof target !== 'string') return false;
  try {
    let expanded;
    if (target.startsWith('~/')) {
      expanded = path.join(process.env.HOME || process.env.USERPROFILE || '.', target.slice(2));
    } else if (path.isAbsolute(target)) {
      expanded = target;
    } else {
      expanded = path.resolve(baseCwd, target);
    }
    fs.mkdirSync(path.dirname(expanded), { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
    fs.appendFileSync(expanded, line);
    return true;
  } catch {
    return false;
  }
}

const DETECTOR_CANDIDATES = [
  path.join(__dirname, 'detector', 'detect-antipatterns.mjs'),
  path.join(__dirname, '..', '..', 'cli', 'engine', 'detect-antipatterns.mjs'),
  path.join(__dirname, '..', '..', '..', 'cli', 'engine', 'detect-antipatterns.mjs'),
];

let detectorCache = null;
export async function loadDetector(candidates = DETECTOR_CANDIDATES) {
  if (detectorCache) return detectorCache;
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) return null;
  const mod = await import(pathToFileURL(found));
  detectorCache = {
    detectText: mod.detectText,
    detectHtml: mod.detectHtml,
    loadDesignSystemForCwd: mod.loadDesignSystemForCwd,
  };
  return detectorCache;
}

// For tests: allow injecting a detector implementation.
export function setDetectorForTesting(impl) {
  detectorCache = impl;
}

// ────────────────────────────────────────────────────────────────────────
// Nudge/steer messages for the no-silent-fires policy.
//
// The hook is designed to be a conversational presence: every fire that
// actually scans a file emits a developer-role message into the model's
// next turn. Three states map to three templates:
//
//   1. **Fresh findings**  → `renderTemplate` (existing, imperative).
//   2. **Pending findings** → `renderPendingAck` (re-nudge for issues the
//                              model was already told about in this
//                              session but hasn't fixed yet).
//   3. **Truly clean**      → `renderCleanAck` (short positive nudge that
//                              keeps the design discipline in context).
//
// All three are short (≤ ~40 tokens each) so the cumulative cost stays
// bounded across a long active editing session. Users who explicitly want
// silence-on-clean can set `IMPECCABLE_HOOK_QUIET=1` — runHook checks that
// env before emitting #2 or #3.
//
// Why not stay silent on dedup-clean? Earlier versions did. The model
// quickly forgets the prior reminder once tool output scrolls past it, so
// re-nudging on the same file with a short "still pending" line keeps the
// pressure on. The wording deliberately points back to "earlier this
// session" so the model knows it's a re-mind, not a new finding.
// ────────────────────────────────────────────────────────────────────────

const STEER_LINE = 'That does not mean the design is good: keep following the project design system and the impeccable skill guidance.';

export function renderCleanAck(filePath, opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const display = relativize(filePath, cwd);
  return `${ENVELOPE_PREFIX} Design hook scanned ${display}. No deterministic design-quality issues found. ${STEER_LINE}`;
}

export function renderPendingAck(filePath, knownFindings, opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const display = relativize(filePath, cwd);
  const count = knownFindings.length;
  // `knownFindings` here are the cache strings like "side-tab:3".
  const sample = knownFindings.slice(0, 3).join(', ');
  const more = count > 3 ? `, +${count - 3} more` : '';
  return `${ENVELOPE_PREFIX} Design hook scanned ${display}. Still has ${count} finding(s) flagged earlier this session (${sample}${more}). Handle them before finalizing — the previous reminder still applies.`;
}

export function shouldEmitAckForFile(filePath, config = null) {
  if (ACK_EXTS.has(path.extname(String(filePath || '')).toLowerCase())) return true;
  // Configured html-engine extensions are declared UI markup, so they get the
  // clean/pending acks; text-engine ones stay quiet like plain .ts/.js.
  const configured = matchConfiguredExtension(filePath, config?.extensions);
  return Boolean(configured && configured.engine === 'html');
}

export function designSystemOptions(config, detector, projectCwd) {
  if (config?.designSystem?.enabled === false) return {};
  if (!detector || typeof detector.loadDesignSystemForCwd !== 'function') return {};
  try {
    const designSystem = detector.loadDesignSystemForCwd(projectCwd);
    return designSystem ? { designSystem } : {};
  } catch {
    return {};
  }
}

export function appendDesignSystemNote(text, scanOptions) {
  if (!text || !scanOptions?.designSystem?.mdNewerThanJson) return text;
  return `${text}\n\n${ENVELOPE_PREFIX} DESIGN.md is newer than .impeccable/design.json. Run ${IMPECCABLE_COMMAND} document to refresh the design-system sidecar.`;
}

// The directive footer is the part of the hook output that steers model
// behavior. Three intentional moves:
//   1. **Imperative, not advisory.** "Handle these..." beats "Consider
//      revising..." which the model treats as a soft suggestion it can
//      override when the user asked for any kind of throwaway / demo UI.
//   2. **Explicit judgment clause.** Without it, the model will try to
//      "fix" intentional motion, bad fixtures, anti-pattern examples in
//      docs, or test cases. Naming the judgment inline beats hoping the
//      model infers it from context.
//   3. **Acknowledgement instruction.** Hook output is injected as
//      developer-role context, not a chat turn, so the user never sees the
//      raw envelope. Asking the model to surface the resolution in its
//      reply is the cheapest way to make the feedback loop visible.
function directiveFooter(display, opts = {}) {
  // Offer the rule-scoped-to-file form first. `ignore-file` silences every rule
  // for the path forever, which is far more than one noisy rule on a real UI
  // surface justifies, and it was previously the only option named here.
  const target = opts.grouped ? '<path>' : quoteCommandArg(display);
  const fileIgnoreGuidance = `run \`${IMPECCABLE_COMMAND} hooks ignore-value <id> "*" --file ${target}\` to scope just that rule to the file, or \`${IMPECCABLE_COMMAND} hooks ignore-file ${target}\` only when the whole file is out of scope for design review (a fixture, a generated artifact, a deliberate demo)`;
  return [
    'Handle these before finalizing: fix findings that are real design problems, or explicitly classify contextually intentional findings as false positives. Acknowledge what you changed or why you are leaving a finding unchanged.',
    '',
    'Use context judgment before editing. A finding is not automatically a defect; literal or domain-appropriate motion, intentional demos or fixtures, documentation of bad design, and user-confirmed choices can be valid as-is.',
    '',
    `Do not change intentional design just to satisfy the hook, and do not silence a real finding with an inline ignore comment to skip fixing it. Suppress a finding only after the user explicitly confirms it is intentional. Prefer a config ignore (one reviewable place, the commands below); reach for an inline \`impeccable-disable <rule>\` comment only when the waiver must travel with a file that leaves the repo, such as an exported or standalone document. Prefer the narrowest persisted exception: run the exact \`${IMPECCABLE_COMMAND} hooks ignore-value ... --shared\` command shown next to a value-specific finding. For \`overused-font\`, use \`ignore-value\` for a specific font and use \`${IMPECCABLE_COMMAND} hooks ignore-rule overused-font --all-values\` only when the user asks to ignore overused fonts generally. For a finding whose line shows no exact ignore-value command, such as \`side-tab\`, ${fileIgnoreGuidance}; use \`${IMPECCABLE_COMMAND} hooks ignore-rule <id>\` only when the user asks to suppress the whole non-value-specific rule. Run ${IMPECCABLE_COMMAND} audit for the full pass.`,
  ].join('\n');
}

/**
 * Run the hook with explicit dependencies. Returns a result object:
 *   { exitCode, stdout, audit, reason? }
 *
 * Never throws. All errors are converted to `exitCode: 0` + audit entry.
 */
export async function runHook({ stdinJson, env = {}, cwd = process.cwd(), now = Date.now, detector } = {}) {
  const audit = { ts: new Date(now()).toISOString(), event: 'PostToolUse' };
  const result = (extra) => ({ exitCode: 0, stdout: '', audit: { ...audit, ...extra } });

  try {
    // Re-entrancy guard.
    if (depthIsSet(env.IMPECCABLE_HOOK_DEPTH) || depthIsSet(env.CLAUDE_HOOK_DEPTH)) {
      return result({ reentrant: true, durationMs: 0 });
    }

    if (truthy(env.IMPECCABLE_HOOK_DISABLED)) {
      return result({ skipped: 'env-disabled', durationMs: 0 });
    }

    const started = Date.now();

    let event;
    try {
      event = typeof stdinJson === 'string' ? JSON.parse(stdinJson) : stdinJson;
    } catch {
      return result({ skipped: 'stdin-malformed', durationMs: Date.now() - started });
    }
    if (!event || typeof event !== 'object') {
      return result({ skipped: 'stdin-empty', durationMs: Date.now() - started });
    }

    const harness = resolveHarness(env, event);
    event = normalizeHookEvent(event, cwd, harness);
    audit.harness = harness;

    const sessionCwd = event.cwd || cwd;
    const primaryFiles = normalizeScanTargets(resolveTargetFiles(event, sessionCwd), sessionCwd);
    const projectCwd = resolveCacheCwd(primaryFiles[0], sessionCwd);
    audit.cwd = projectCwd;
    const primaryFileSet = new Set(primaryFiles);
    const targetFiles = expandScanTargets(primaryFiles, projectCwd);
    audit.session = event.session_id || null;
    if (event.tool_name) audit.tool = event.tool_name;

    if (targetFiles.length === 0) {
      return result({ skipped: 'no-file-path', durationMs: Date.now() - started });
    }

    const config = readConfig(projectCwd);
    if (config.enabled === false) {
      return result({ skipped: 'config-disabled', durationMs: Date.now() - started });
    }

    const platform = resolveProjectPlatform(projectCwd);
    if (isNativePlatform(platform)) {
      return result({ skipped: 'native-platform', platform, durationMs: Date.now() - started });
    }

    const cache = readCache(projectCwd);
    const sessionId = event.session_id || 'unknown';
    const det = detector || await loadDetector();
    if (!det || typeof det.detectText !== 'function') {
      // Cache is not mutated yet at this point; nothing to persist.
      return result({ skipped: 'detector-missing', durationMs: Date.now() - started });
    }
    const scanOptions = designSystemOptions(config, det, projectCwd);

    let pendingWinner = null;
    let cleanWinner = null;
    const freshGroups = [];
    let suppressionWinner = null;
    let cleanAckDeduped = false;
    let skippedBytes = 0;
    const quietMode = truthy(env.IMPECCABLE_HOOK_QUIET) || config.quiet === true;
    let detectorThrewAny = false;
    let lastSkip = 'no-scannable-file';
    let suppressedHit = false;
    let cacheDirty = false;

    for (const filePath of targetFiles) {
      audit.file = filePath;

      if (hasPathTraversal(filePath) || SENSITIVE_PATH.test(filePath)) {
        lastSkip = 'sensitive';
        continue;
      }
      if (GENERATED_PATH.test(filePath)) {
        lastSkip = 'generated';
        continue;
      }

      const ext = path.extname(filePath).toLowerCase();
      const configuredExt = matchConfiguredExtension(filePath, config.extensions);
      audit.ext = configuredExt ? configuredExt.ext : ext;
      if (!ALLOWED_EXTS.has(ext) && !configuredExt) {
        lastSkip = 'extension';
        continue;
      }

      const relForMatch = relativize(filePath, projectCwd);
      if (matchesAnyGlob(relForMatch, config.ignoreFiles) || matchesAnyGlob(filePath, config.ignoreFiles)) {
        lastSkip = 'config-ignore-file';
        continue;
      }
      if (!fs.existsSync(filePath)) {
        lastSkip = 'file-missing';
        continue;
      }

      const maxFileBytes = config.limits?.maxFileBytes ?? DEFAULT_CONFIG.limits.maxFileBytes;
      if (maxFileBytes > 0) {
        let size = 0;
        try { size = fs.statSync(filePath).size; } catch { size = 0; }
        if (size > maxFileBytes) {
          skippedBytes = size;
          lastSkip = 'too-large';
          continue;
        }
      }

      if (primaryFileSet.has(filePath)) {
        const editCount = bumpEditCount(cache, sessionId, filePath);
        cacheDirty = true;
        audit.editCount = editCount;

        if (editCount > EDIT_COUNT_THRESHOLD) {
          const wasJustCrossed = editCount === EDIT_COUNT_THRESHOLD + 1;
          if (wasJustCrossed && !suppressionWinner) {
            suppressionWinner = { filePath };
          }
          lastSkip = 'suppressed';
          suppressedHit = true;
          continue;
        }
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      let findings;
      let detectorThrew = false;
      const useHtmlEngine = configuredExt
        ? configuredExt.engine === 'html'
        : (ext === '.html' || ext === '.htm');
      if (useHtmlEngine && typeof det.detectHtml === 'function') {
        try { findings = await det.detectHtml(filePath, scanOptions); } catch { findings = []; detectorThrew = true; }
      } else {
        try { findings = await det.detectText(content, filePath, scanOptions); } catch { findings = []; detectorThrew = true; }
      }

      const filtered = filterFindings(findings || [], content, ext, config);
      const fresh = dedupeAgainstCache(filtered, cache, sessionId, filePath);
      audit.findings = (findings || []).length;
      audit.freshFindings = fresh.length;

      // A detector failure tells us nothing about the file, so leave whatever
      // was remembered alone rather than recording an empty scan as truth.
      if (detectorThrew) {
        detectorThrewAny = true;
        continue;
      }

      // Sync the cache to this scan before deciding what to emit, so fixed
      // findings stop being remembered and a reintroduced one reads as fresh.
      rememberFindings(cache, sessionId, filePath, filtered);
      cacheDirty = true;

      if (fresh.length > 0) {
        freshGroups.push({ filePath, findings: fresh });
        continue;
      }

      if (filtered.length > 0 && !pendingWinner) {
        // Count the live scan, not the session's history.
        pendingWinner = { filePath, known: filtered.map(f => findingCacheKey(f)) };
      } else if (filtered.length === 0 && !cleanWinner) {
        // The clean ack carries no finding, only the standing steer that a
        // silent hook is not a verdict on the design. Repeating it on every
        // clean edit spends context to say nothing, so it fires once per file
        // per session. The pending ack, which names real unresolved work, is
        // deliberately left to repeat.
        //
        // Quiet mode emits nothing, so it must not consume the ack and leave a
        // later non-quiet run in this session silent.
        if (quietMode || !shouldEmitAckForFile(filePath, config)) {
          cleanWinner = { filePath };
        } else if (ensureFile(cache, sessionId, filePath).cleanAcked) {
          // Spent for this file. Remember it for the audit trail, but keep
          // scanning: another target in this same event may still be owed an
          // ack, and dropping out here would lose it.
          cleanAckDeduped = true;
        } else {
          ensureFile(cache, sessionId, filePath).cleanAcked = true;
          cleanWinner = { filePath };
          cleanAckDeduped = false;
        }
      }
    }

    // Persist only when the write is earned: fresh findings justify creating
    // `.impeccable/` (dedup and suppression need it), and an already-present
    // `.impeccable/` dir marks a project that opted in. A non-UI edit, or a
    // clean UI edit in a project with no Impeccable footprint, must be a
    // no-op on disk (issues #344, #305).
    if (freshGroups.length > 0
      || (cacheDirty && fs.existsSync(path.join(projectCwd, '.impeccable')))) {
      persistCache(projectCwd, cache);
    }

    if (freshGroups.length > 0) {
      const firstGroup = freshGroups[0];
      const text = appendDesignSystemNote(renderGroupedTemplate(freshGroups, config, { cwd: projectCwd }), scanOptions);
      const allFindings = freshGroups.flatMap((group) => group.findings);
      return {
        exitCode: 0,
        stdout: payload(text, 'PostToolUse', harness),
        emission: {
          kind: 'fresh',
          file: firstGroup.filePath,
          findings: firstGroup.findings,
          groups: freshGroups,
        },
        audit: {
          ...audit,
          file: firstGroup.filePath,
          emitted: true,
          freshFiles: freshGroups.length,
          freshFindings: allFindings.length,
          chars: text.length,
          durationMs: Date.now() - started,
        },
      };
    }

    if (detectorThrewAny && !pendingWinner && !cleanWinner) {
      return result({ emitted: false, error: 'detector-threw', durationMs: Date.now() - started });
    }

    if (quietMode) {
      return result({ emitted: false, quiet: true, durationMs: Date.now() - started });
    }

    if (pendingWinner && shouldEmitAckForFile(pendingWinner.filePath, config)) {
      const text = appendDesignSystemNote(renderPendingAck(pendingWinner.filePath, pendingWinner.known, { cwd: projectCwd }), scanOptions);
      return {
        exitCode: 0,
        stdout: payload(text, 'PostToolUse', harness),
        emission: { kind: 'pending', file: pendingWinner.filePath, known: pendingWinner.known },
        audit: {
          ...audit,
          file: pendingWinner.filePath,
          emitted: true,
          kind: 'pending',
          pending: pendingWinner.known.length,
          chars: text.length,
          durationMs: Date.now() - started,
        },
      };
    }

    if (suppressionWinner) {
      const text = suppressionNotice(relativize(suppressionWinner.filePath, projectCwd));
      return {
        exitCode: 0,
        stdout: payload(text, 'PostToolUse', harness),
        emission: { kind: 'suppression', file: suppressionWinner.filePath },
        audit: {
          ...audit,
          file: suppressionWinner.filePath,
          suppressed: true,
          emitted: true,
          durationMs: Date.now() - started,
        },
      };
    }

    if (cleanWinner && !cleanAckDeduped && shouldEmitAckForFile(cleanWinner.filePath, config)) {
      const text = appendDesignSystemNote(renderCleanAck(cleanWinner.filePath, { cwd: projectCwd }), scanOptions);
      return {
        exitCode: 0,
        stdout: payload(text, 'PostToolUse', harness),
        emission: { kind: 'clean', file: cleanWinner.filePath },
        audit: {
          ...audit,
          file: cleanWinner.filePath,
          emitted: true,
          kind: 'clean',
          chars: text.length,
          durationMs: Date.now() - started,
        },
      };
    }

    if (pendingWinner) {
      return result({ emitted: false, skipped: 'non-ui-ack', durationMs: Date.now() - started });
    }

    // Distinct from non-ui-ack so the audit log shows noise being suppressed on
    // purpose rather than a file the hook could not classify.
    if (cleanWinner) {
      return result({ emitted: false, skipped: 'non-ui-ack', durationMs: Date.now() - started });
    }

    if (cleanAckDeduped) {
      return result({ emitted: false, skipped: 'clean-ack-deduped', durationMs: Date.now() - started });
    }

    if (suppressedHit) {
      return result({ suppressed: true, emitted: false, durationMs: Date.now() - started });
    }

    return result({
      skipped: lastSkip,
      ...(lastSkip === 'too-large' ? { bytes: skippedBytes } : {}),
      durationMs: Date.now() - started,
    });
  } catch (err) {
    return {
      exitCode: 0,
      stdout: '',
      audit: { ...audit, error: String(err && err.message ? err.message : err) },
    };
  }
}

export function payload(text, eventName = 'PostToolUse', harness = 'claude') {
  if (harness === 'cursor') {
    return JSON.stringify({ additional_context: text });
  }
  // GitHub Copilot's postToolUse hook injects context via a top-level
  // `additionalContext` string (alongside an optional `modifiedResult`).
  if (harness === 'github') {
    return JSON.stringify({ additionalContext: text });
  }
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: eventName, additionalContext: text },
  });
}
