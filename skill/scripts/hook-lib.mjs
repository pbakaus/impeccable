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
 *   touchFile(cache, sessionId, filePath)
 *   suppressionNotice(filePath)
 *   filterFindings(findings, content, ext, config)
 *   ADVISORY_RULES / isAdvisoryFinding(finding)
 *   IMMEDIATE_TIER_RULES / splitFindingsByTier(findings) / perEditTieringActive(config, harness)
 *   matchConfiguredExtension(filePath, extensions)
 *   dedupeAgainstCache(findings, cache, sessionId, filePath)
 *   renderTemplate(findings, filePath, config, opts)
 *   renderCleanAck(filePath, opts) / renderPendingAck(filePath, known, opts)
 *   appendDesignSystemNote(text, scanOptions) / appendDesignSystemNoteOnce(text, scanOptions, cache, sessionId, config)
 *   designNoteReserve(scanOptions, cache, sessionId)
 *   footerModeForSession(cache, sessionId) / commitFooterShown(cache, sessionId, text)
 *   shouldEmitAckForFile(filePath, config?)
 *   writeAuditLog(env, entry)
 *   loadDetector() -> Promise<{ detectText, detectHtml }>
 *   matchesAnyGlob(filePath, globs)
 *   normalizeScanTargets(primaryTargets, projectCwd)
 *   runHook(deps) -> { exitCode, stdout, audit, reason? }
 *   runStopHook(deps) -> { exitCode, stdout, audit, emission? }
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
// `detector.extensions` (issue #316) is shared with Live's source search, which
// needs the same answer for `.heex` / `.blade.php` when it hunts for session
// markers. lib/template-extensions.mjs owns the shape; re-exported here because
// hook-lib has been the import site for matchConfiguredExtension since #347.
import {
  matchConfiguredExtension,
  mergeExtensions,
} from './lib/template-extensions.mjs';

export { matchConfiguredExtension };

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

// ── Two-tier rule surfacing ──────────────────────────────────────────────
// The per-edit PostToolUse pass surfaces only this "immediate" tier: rules
// that are mechanical, unambiguous, and worth interrupting an edit for —
// broken output the user would see (broken images, overflow, clipped
// popovers, text on the viewport edge), objective contrast/legibility
// failures, single-property slop that is trivial to fix in place (gradient
// text, glow shadows), and design-system drift (which compounds with every
// further edit if left uncorrected). Everything else — copy-cadence rules,
// palette/typography taste, layout rhythm — is deferred to the Stop-event
// deep pass (`runStopHook`), which runs the FULL rule set over every file
// touched this session and surfaces the remainder once.
//
// Rationale (measured in the eval harness): the per-edit stream fires
// overwhelmingly on copy-level rules, and that steady nag stream makes
// models more conservative, while a single full pass at completion fixes
// contrast/padding/glow just as reliably. Restore the old full per-edit
// behavior with `.impeccable/config.json` → `hook: { "perEditRules": "all" }`.
export const IMMEDIATE_TIER_RULES = new Set([
  // Broken output.
  'broken-image',
  'text-overflow',
  'clipped-overflow-container',
  'body-text-viewport-edge',
  // Objective contrast / legibility failures.
  'low-contrast',
  'gray-on-color',
  'tiny-text',
  // Single-property mechanical slop, trivial to fix at the edit site.
  'gradient-text',
  'dark-glow',
  // Design-system drift compounds if not corrected at edit time.
  'design-system-font',
  'design-system-color',
  'design-system-radius',
  'design-system-font-size',
]);

// ── Advisory rules ────────────────────────────────────────────────────────
// Advisory rules are opt-in noise: the CLI reports them in a separate section
// and they never count as failures. The design hook skips them entirely by
// default — in both the per-edit PostToolUse pass and the Stop deep pass — so
// the agent is never nagged about a taste call a human might make on purpose.
// A project opts back in with `.impeccable/config.json`:
//   { "detector": { "advisoryRules": "include" } }
// This set is the hook's own copy of the registry's `advisory: true` rules,
// mirroring how IMMEDIATE_TIER_RULES lists rule ids inline so the hook stays
// self-contained and testable without loading the detector. Keep it in sync
// with the registry (cli/engine/registry/antipatterns.mjs).
export const ADVISORY_RULES = new Set([
  'em-dash-overuse',
]);

export function isAdvisoryFinding(finding) {
  const id = finding && normalizeIgnoreRule(finding.antipattern);
  return Boolean(id && (ADVISORY_RULES.has(id) || finding.advisory === true));
}

export const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  quiet: false,
  auditLog: null,
  designSystem: { enabled: true },
  ignoreRules: [],
  ignoreFiles: [],
  ignoreValues: [],
  extensions: [],
  perEditRules: 'immediate',
  // Advisory rules are skipped unless a project sets detector.advisoryRules to
  // "include". See ADVISORY_RULES above.
  advisoryRules: 'exclude',
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

// Where mutable hook state (cache + pending) lives. Defaults to the
// project-local `.impeccable/` dir. When IMPECCABLE_CACHE_ROOT is set, state
// relocates to a per-project subdirectory of that root instead, keyed by a
// slug of the project path (`[:\\/.]` → `-`, mirroring Claude Code's
// `~/.claude/projects/` convention), so project roots stay free of tool
// artifacts (issue #422). User-authored config (config.json,
// config.local.json, design.json) deliberately stays project-local — only
// disposable state relocates.
function hookStateDir(cwd) {
  const root = process.env.IMPECCABLE_CACHE_ROOT;
  if (root && typeof root === 'string' && root.trim()) {
    const slug = String(cwd).replace(/[:\\/.]/g, '-');
    return path.join(root, slug);
  }
  return path.join(cwd, '.impeccable');
}

export function getCachePath(cwd) {
  return path.join(hookStateDir(cwd), 'hook.cache.json');
}

export function getPendingPath(cwd) {
  return path.join(hookStateDir(cwd), 'hook.pending.json');
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
  // `detector.advisoryRules: "include"` opts the hook into advisory rules
  // (em-dash overuse, etc.). Any other value keeps the default "exclude".
  if (raw.advisoryRules === 'include' || raw.advisoryRules === 'exclude') {
    config.advisoryRules = raw.advisoryRules;
  }
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

function applyConfigSource(config, raw) {
  if (!raw || typeof raw !== 'object') return config;
  if (Object.prototype.hasOwnProperty.call(raw, 'enabled')) {
    config.enabled = raw.enabled === false ? false : true;
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'quiet')) {
    config.quiet = raw.quiet === true;
  }
  if (raw.perEditRules === 'all' || raw.perEditRules === 'immediate') {
    config.perEditRules = raw.perEditRules;
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

// Record that a file was scanned this session without bumping its edit count.
// The Stop deep pass reads the session's file list to know what to re-scan,
// so a file whose per-edit findings were all deferred still needs an entry.
export function touchFile(cache, sessionId, filePath) {
  ensureFile(cache, sessionId, filePath);
  ensureSession(cache, sessionId).updatedAt = Date.now();
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
  // Advisory rules are skipped by default so the hook never nags about them;
  // a project opts in with detector.advisoryRules: "include".
  const includeAdvisory = (config?.advisoryRules || DEFAULT_CONFIG.advisoryRules) === 'include';
  return findings.filter((f) => {
    if (!f || typeof f !== 'object') return false;
    if (!includeAdvisory && isAdvisoryFinding(f)) return false;
    if (ignoreRules.has(normalizeIgnoreRule(f.antipattern))) return false;
    if (isIgnoredFindingValue(f, ignoreValues)) return false;
    return true;
  });
}

// Split filtered findings into the per-edit "immediate" tier and the tier
// deferred to the Stop deep pass. See IMMEDIATE_TIER_RULES for the tiering
// rationale.
export function splitFindingsByTier(findings) {
  const immediate = [];
  const deferred = [];
  for (const f of Array.isArray(findings) ? findings : []) {
    if (f && IMMEDIATE_TIER_RULES.has(normalizeIgnoreRule(f.antipattern))) {
      immediate.push(f);
    } else {
      deferred.push(f);
    }
  }
  return { immediate, deferred };
}

// Whether the per-edit pass for this harness should defer non-immediate
// findings to a Stop deep pass. Only Claude Code and Codex dispatch our Stop
// hook; Cursor and GitHub Copilot have no deep pass wired, so deferring for
// them would silently drop the non-immediate rules entirely.
export function perEditTieringActive(config, harness) {
  if (harness === 'cursor' || harness === 'github') return false;
  return (config?.perEditRules || DEFAULT_CONFIG.perEditRules) !== 'all';
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

    const googleLabel = text.match(/Google Fonts:\s*([^()\n;]+)/i);
    if (googleLabel) return cleanIgnoreValueDisplay(googleLabel[1]);

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
  // reserveChars holds back room for a note the caller appends after render
  // (the DESIGN.md staleness note), so the final payload stays inside the
  // configured budget. It comes off after the 500-char floor, so at floor
  // configs the note keeps guaranteed delivery room; the clamp budget can
  // therefore sit below 500, which clampLastLine's footer-preserving
  // fallback handles (Bugbot on PR #508).
  const maxChars = Math.max(500, limits.maxChars || DEFAULT_CONFIG.limits.maxChars) - (opts.reserveChars || 0);

  const cwd = opts.cwd || process.cwd();
  const display = relativize(filePath, cwd);
  const total = findings.length;
  const shown = findings.slice(0, cap);
  const remaining = total - shown.length;

  const header = `${ENVELOPE_PREFIX} Design hook findings requiring review in ${display} (${total} issue(s)):`;
  const seenRules = new Set();
  const lines = shown.map((f) => formatDedupedFindingLine(f, seenRules));
  const more = remaining > 0
    ? `... and ${remaining} more (see ${IMPECCABLE_COMMAND} audit).`
    : null;
  const footer = directiveFooter({ mode: opts.footer });

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
  const maxChars = Math.max(500, limits.maxChars || DEFAULT_CONFIG.limits.maxChars) - (opts.reserveChars || 0);
  const cwd = opts.cwd || process.cwd();
  const total = realGroups.reduce((sum, group) => sum + group.findings.length, 0);
  const header = `${ENVELOPE_PREFIX} Design hook findings requiring review across ${realGroups.length} files (${total} issue(s)):`;
  const lines = [];
  let shownCount = 0;
  // One seen-set across all groups: a rule already described under one file
  // is not re-described under the next.
  const seenRules = new Set();

  for (const group of realGroups) {
    const display = relativize(group.filePath, cwd);
    lines.push(`${display} (${group.findings.length} issue(s)):`);
    const remainingCap = Math.max(0, cap - shownCount);
    const shown = group.findings.slice(0, remainingCap);
    for (const finding of shown) {
      lines.push(formatDedupedFindingLine(finding, seenRules));
    }
    shownCount += shown.length;
    const hidden = group.findings.length - shown.length;
    if (hidden > 0) {
      lines.push(`- ... ${hidden} more in ${display} (see ${IMPECCABLE_COMMAND} audit).`);
    }
  }

  const footer = directiveFooter({ mode: opts.footer });
  let text = [header, ...lines, '', footer].join('\n');
  if (text.length > maxChars) {
    text = clampGroupedToBudget(header, lines, footer, maxChars);
  }
  return text;
}

// The clamp contract, shared by both budget functions: the footer is policy,
// not detail, so it survives every clamp. Try the requested footer first;
// when it cannot fit even after dropping finding lines, retry with the short
// policy rather than sacrifice findings that fit beside it. A result that
// dropped every finding line (a grouped render can fit a bare file header)
// does not count as a fit: findings are why the emission exists.
const isFindingLine = (line) => line.startsWith('- ');

function footerFallbacks(footer) {
  const short = directiveFooter({ mode: 'short' });
  return footer === short ? [footer] : [footer, short];
}

function clampGroupedToBudget(header, lines, footer, maxChars) {
  const assemble = (linesArr, omitted, footerText) => [
    header,
    ...linesArr,
    ...(omitted ? [`... and more (see ${IMPECCABLE_COMMAND} audit).`] : []),
    '',
    footerText,
  ].join('\n');

  for (const footerText of footerFallbacks(footer)) {
    let working = lines.slice();
    let omitted = false;
    let assembled = assemble(working, omitted, footerText);
    while (assembled.length > maxChars && working.length > 1) {
      working.pop();
      omitted = true;
      assembled = assemble(working, omitted, footerText);
    }
    if (assembled.length <= maxChars && working.some(isFindingLine)) return assembled;
  }
  return clampLastLine((linesArr, footerText) => assemble(linesArr, true, footerText),
    lines.find(isFindingLine) || lines[0], maxChars);
}

function clampToBudget(header, lines, more, footer, maxChars) {
  const assemble = (linesArr, moreText, footerText) => {
    const blocks = [header, ...linesArr];
    if (moreText) blocks.push(moreText);
    blocks.push('');
    blocks.push(footerText);
    return blocks.join('\n');
  };

  let lastMore = more;
  for (const footerText of footerFallbacks(footer)) {
    let working = lines.slice();
    let moreText = more;
    let assembled = assemble(working, moreText, footerText);
    while (assembled.length > maxChars && working.length > 1) {
      working.pop();
      moreText = `... and more (see ${IMPECCABLE_COMMAND} audit).`;
      assembled = assemble(working, moreText, footerText);
    }
    lastMore = moreText;
    if (assembled.length <= maxChars) return assembled;
  }
  return clampLastLine((linesArr, footerText) => assemble(linesArr, lastMore, footerText),
    lines.find(isFindingLine) || lines[0], maxChars);
}

// Last resort with one finding line left: the short policy gets the budget
// first, the line is clipped to what remains. The pre-fix tail-slice cut
// whatever happened to be last, which was always the footer.
function clampLastLine(build, line, maxChars) {
  const footerText = directiveFooter({ mode: 'short' });
  const bare = build([], footerText);
  // +1 for the newline the line itself brings when it joins the blocks.
  const room = maxChars - bare.length - 1;
  if (room >= 24) {
    const clipped = line.length > room ? `${line.slice(0, room - 1)}…` : line;
    return build([clipped], footerText);
  }
  // No room for even a clipped finding line: the note reservation can pull
  // the budget below the 500-char floor, and a deep file path can push the
  // header past what remains beside the short policy (Bugbot on PR #508).
  // Drop the line, and if the bare header + policy still overflow, clip the
  // head. Never tail-slice: the footer sits at the end, so a tail slice is
  // exactly the footer cut this renderer exists to prevent.
  if (bare.length <= maxChars) return bare;
  const head = bare.slice(0, Math.max(0, maxChars - footerText.length - 4));
  return `${head}…\n\n${footerText}`;
}

// `compact` drops the registry description: within one emission the first
// occurrence of a rule carries the full description and repeats keep only the
// rule id, name, and their own ignore hint (values differ per line, so the
// hint must survive the dedupe).
function formatFindingLine(f, opts = {}) {
  const prefix = f.line && f.line > 0 ? `- L${f.line}` : '-';
  const desc = opts.compact ? '' : (f.description || '').trim();
  const name = (f.name || '').trim();
  // Description from the registry already ends in punctuation; join with a
  // single space. `name` may have a trailing period already, keep it clean.
  const nameSegment = name ? `${name.replace(/\.+\s*$/, '')}.` : '';
  const ignoreHint = formatFindingIgnoreHint(f);
  const ignoreSegment = ignoreHint ? ` If intentional: \`${ignoreHint}\`.` : '';
  return `${prefix} [${f.antipattern}] ${nameSegment} ${desc}${ignoreSegment}`.replace(/\s+/g, ' ').trim();
}

// Dedupe applied in shown-line order, so the first rendered occurrence of a
// rule always carries the description. The budget clamps pop lines from the
// end, which can never orphan a compact repeat before its described first
// occurrence.
function formatDedupedFindingLine(finding, seenRules) {
  const rule = normalizeIgnoreRule(finding?.antipattern);
  const compact = rule ? seenRules.has(rule) : false;
  if (rule) seenRules.add(rule);
  return formatFindingLine(finding, { compact });
}

// The rule/value pair the footer's `hook-admin.mjs ignore-value` command
// takes. Deliberately just the args: the executable prefix, the --reason
// contract, and the disclosure rule live in the directive footer, stated once
// instead of per line.
function formatFindingIgnoreHint(finding) {
  if (!finding || typeof finding !== 'object') return '';
  const rule = normalizeIgnoreRule(finding.antipattern);
  if (!rule) return '';
  const normalizedValue = extractFindingIgnoreValue(finding);
  if (!normalizedValue) return '';
  const valueArg = quoteCommandArg(extractFindingIgnoreValueRaw(finding));
  return `ignore-value ${rule} ${valueArg}`;
}

function quoteCommandArg(value) {
  const text = String(value || '').trim();
  if (/^[A-Za-z0-9._:-]+$/.test(text)) return text;
  // The suggestion is meant to be run on this same machine, so quote for its
  // shell. POSIX /bin/sh still expands $(...), backticks, and ${} inside
  // double quotes, and these values come from scanned file content (a
  // font-family name) or a file path, so untrusted input must be
  // single-quoted (issue #476). Windows cmd.exe performs no such command
  // substitution, but it treats a single quote as a literal character rather
  // than a grouping delimiter, so a value or path containing spaces has to
  // stay double-quoted there (Greptile #533). Keep the pre-existing
  // double-quote escaping on Windows so that path's behavior is unchanged.
  if (process.platform === 'win32') {
    return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return `'${text.replace(/'/g, `'\\''`)}'`;
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

// Resolve a path to its canonical (symlink-free) form. When the path does
// not exist yet — the before-edit hook gates proposed Writes — canonicalize
// the nearest existing ancestor and re-append the remainder, so a new file
// under a symlinked root still compares equal to its canonical project.
// Memoized: the hook runs as a fresh process per tool event, so the cache
// amounts to once-per-event work — the scan loops re-check the same project
// root for every target file. The cap only matters to long-lived importers
// like the test runner.
const canonicalPathCache = new Map();
const CANONICAL_PATH_CACHE_MAX = 1024;

function canonicalPath(p) {
  const resolved = path.resolve(p);
  if (canonicalPathCache.has(resolved)) return canonicalPathCache.get(resolved);
  let canonical = resolved;
  let dir = resolved;
  const tail = [];
  while (true) {
    try {
      canonical = tail.length ? path.join(fs.realpathSync(dir), ...tail) : fs.realpathSync(dir);
      break;
    } catch { /* keep climbing */ }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    tail.unshift(path.basename(dir));
    dir = parent;
  }
  if (canonicalPathCache.size >= CANONICAL_PATH_CACHE_MAX) canonicalPathCache.clear();
  canonicalPathCache.set(resolved, canonical);
  return canonical;
}

// Containment gate shared by the before-edit hook and both scan passes. A
// session routinely touches files that belong to no project or to a
// different one — harness scratchpad dirs under the system temp root,
// sibling checkouts, one-off throwaway HTML — and findings against those are
// judged with THIS project's config and DESIGN.md palette, which is never
// right. Skip them (audit reason: outside-project). Paths are canonicalized
// first so a symlinked root (macOS /tmp -> /private/tmp) doesn't split the
// comparison.
export function isScanTargetInsideProject(filePath, projectCwd) {
  if (!filePath || !projectCwd) return false;
  return isInsideProject(canonicalPath(filePath), canonicalPath(projectCwd));
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

const DESIGN_STALE_NOTE = `${ENVELOPE_PREFIX} DESIGN.md is newer than .impeccable/design.json. Run ${IMPECCABLE_COMMAND} document to refresh the design-system sidecar.`;

export function appendDesignSystemNote(text, scanOptions) {
  if (!text || !scanOptions?.designSystem?.mdNewerThanJson) return text;
  return `${text}\n\n${DESIGN_STALE_NOTE}`;
}

// Session-scoped once-only gate for repeat-prone message parts. Returns true
// the first time a flag is consumed in a session and false after, mirroring
// the `cleanAcked` mechanic: the mtime skew (and the policy footer) do not
// change between edits, so re-stating them on every emission spends context
// to say nothing new. Callers must persist the cache for the flag to stick.
function consumeSessionNoticeFlag(cache, sessionId, flag) {
  const session = ensureSession(cache, sessionId);
  if (session[flag]) return false;
  session[flag] = true;
  session.updatedAt = Date.now();
  return true;
}

// Once-per-session variant of appendDesignSystemNote for the emission paths
// that have cache access. The staleness note names standing project state,
// not new information, so one mention per session is enough. The note is
// appended after the renderer has clamped to the configured budget: render
// paths reserve room for it via designNoteReserve, and the size check here
// is the safety net for the ack paths, deferring (without consuming the
// flag) to a later emission rather than busting maxChars.
export function appendDesignSystemNoteOnce(text, scanOptions, cache, sessionId, config) {
  if (!text || !scanOptions?.designSystem?.mdNewerThanJson) return text;
  const maxChars = Math.max(500, config?.limits?.maxChars || DEFAULT_CONFIG.limits.maxChars);
  if (text.length + DESIGN_STALE_NOTE.length + 2 > maxChars) return text;
  if (!consumeSessionNoticeFlag(cache, sessionId, 'designNoteShown')) return text;
  return appendDesignSystemNote(text, scanOptions);
}

// Render-time reservation for the note above: how many characters the
// renderer must hold back so a pending staleness note still fits inside the
// configured budget. Zero once the session has seen the note. Without the
// reservation, a session whose every emission fills the budget would defer
// the note forever.
export function designNoteReserve(scanOptions, cache, sessionId) {
  if (!scanOptions?.designSystem?.mdNewerThanJson) return 0;
  if (ensureSession(cache, sessionId).designNoteShown) return 0;
  return DESIGN_STALE_NOTE.length + 2;
}

// Full directive footer once per session, the short reminder after. Fresh
// emissions and Cursor denials share the session flag (`footerShown`), so a
// session pays the full policy exactly once however it first fires. The mode
// is a peek: the clamp can downgrade a requested full footer under a tight
// budget, so the flag commits only when the complete full policy actually
// reached the output. Matching the whole footer text (not a sentinel) keeps
// the flag honest against any truncation that spares the opening words.
export function footerModeForSession(cache, sessionId) {
  return ensureSession(cache, sessionId).footerShown ? 'short' : 'full';
}

export function commitFooterShown(cache, sessionId, text) {
  if (!text || !text.includes(directiveFooter())) return;
  const session = ensureSession(cache, sessionId);
  if (session.footerShown) return;
  session.footerShown = true;
  session.updatedAt = Date.now();
}

const HOOK_ADMIN_COMMAND = `node ${quoteCommandArg(path.join(__dirname, 'hook-admin.mjs'))}`;

// The directive footer is the part of the hook output that steers model
// behavior. Intentional moves, in order:
//   1. **Imperative, not advisory.** "Triage each finding..." beats
//      "Consider revising...", which the model treats as a soft suggestion.
//   2. **Positive triage branches.** Fix / suppress-and-disclose / ask. The
//      suppress branch names the calibration examples (demo, fixture,
//      documented bad design, user-confirmed choice) because the agent now
//      acts on its own confidence and needs the bar stated.
//   3. **Executable ignore path.** The old footer named only the slash
//      command, which an agent reacting to hook output cannot run; the
//      hook-admin.mjs invocation is runnable as-is and keeps agents out of
//      hand-editing config.json.
//   4. **Honest provenance.** The --reason is the audit trail; "user
//      confirmed" appears only when the user actually did.
//   5. **Acknowledgement instruction.** Hook output is injected as
//      developer-role context, so the reply is where the user sees the
//      resolution, including any ignore the agent persisted.
//   6. **Once per session.** The full policy emits on the session's first
//      fire; later emissions carry the one-line short form (mode 'short').
function directiveFooter(opts = {}) {
  if (opts.mode === 'short') {
    // No command path here: the session's first emission already gave the
    // runnable hook-admin.mjs invocation, and restating ~70 chars of absolute
    // path on every repeat is the duplication this mode exists to cut.
    return 'Triage per the session policy: fix real problems; persist confident false-positive or sanctioned-exception ignores via `hook-admin.mjs ignore-value` and disclose them in your reply; unsure, ask in one line.';
  }
  return [
    'Triage each finding, then state in your reply what you fixed, what you suppressed, and what you left standing:',
    '- Real design problem: fix it. Keep intentional design as designed.',
    `- Confident false positive or sanctioned exception (an intentional demo or fixture, documentation of bad design, literal or domain-appropriate motion, a choice the user confirmed): persist the narrowest ignore yourself and disclose it. Run \`${HOOK_ADMIN_COMMAND} ignore-value <rule> "<value>" --reason "<who decided: evidence>"\` with the pair shown on the finding line, or value "*" plus \`--file <path>\` when the line shows none. Write "user confirmed" in a reason only when the user did.`,
    '- Unsure: leave it as is and ask the user in one line.',
    `Self-serve ends at ignore-value: \`ignore-file\` and \`ignore-rule\` need the user's explicit approval, and never add an ignore to push a blocked write through. Full suppression ladder: ${IMPECCABLE_COMMAND} hooks.`,
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
    const tiered = perEditTieringActive(config, harness);

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
    let deferredTotal = 0;

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
      if (!isScanTargetInsideProject(filePath, projectCwd)) {
        lastSkip = 'outside-project';
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
      // Per-edit only surfaces the immediate tier; the rest waits for the
      // Stop deep pass. The file is still marked touched so the deep pass
      // knows to re-scan it.
      const { immediate, deferred } = tiered
        ? splitFindingsByTier(filtered)
        : { immediate: filtered, deferred: [] };
      if (deferred.length > 0) {
        touchFile(cache, sessionId, filePath);
        cacheDirty = true;
        deferredTotal += deferred.length;
      }
      const fresh = dedupeAgainstCache(immediate, cache, sessionId, filePath);
      audit.findings = (findings || []).length;
      audit.freshFindings = fresh.length;
      if (deferredTotal > 0) audit.deferred = deferredTotal;

      // A detector failure tells us nothing about the file, so leave whatever
      // was remembered alone rather than recording an empty scan as truth.
      if (detectorThrew) {
        detectorThrewAny = true;
        continue;
      }

      // Sync the cache to this scan before deciding what to emit, so fixed
      // findings stop being remembered and a reintroduced one reads as fresh.
      // Only the immediate tier is remembered: a deferred finding the per-edit
      // pass never reported must still read as fresh to the Stop deep pass.
      rememberFindings(cache, sessionId, filePath, immediate);
      cacheDirty = true;

      if (fresh.length > 0) {
        freshGroups.push({ filePath, findings: fresh });
        continue;
      }

      if (immediate.length > 0 && !pendingWinner) {
        // Count the live scan, not the session's history.
        pendingWinner = { filePath, known: immediate.map(f => findingCacheKey(f)) };
      } else if (immediate.length === 0 && !cleanWinner) {
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

    // The session notice flags mutate the cache, so they must settle before
    // the persist that makes them stick across events.
    if (freshGroups.length > 0) {
      const firstGroup = freshGroups[0];
      const footerMode = footerModeForSession(cache, sessionId);
      const text = appendDesignSystemNoteOnce(
        renderGroupedTemplate(freshGroups, config, {
          cwd: projectCwd,
          footer: footerMode,
          reserveChars: designNoteReserve(scanOptions, cache, sessionId),
        }),
        scanOptions, cache, sessionId, config,
      );
      commitFooterShown(cache, sessionId, text);
      // Fresh findings always earn the cache write, including creating
      // `.impeccable/`: dedup, suppression, and the notice flags need it.
      persistCache(projectCwd, cache);
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

    // Resolve the ack emission before the persist below: appendDesignSystem-
    // NoteOnce consumes a session flag, and the flag only sticks when the
    // write happens after it. Quiet mode emits nothing, so it consumes
    // nothing. The clean arm mirrors the branch order further down: pending
    // outranks suppression, suppression outranks clean.
    let ack = null;
    if (!quietMode && pendingWinner && shouldEmitAckForFile(pendingWinner.filePath, config)) {
      ack = {
        kind: 'pending',
        text: appendDesignSystemNoteOnce(renderPendingAck(pendingWinner.filePath, pendingWinner.known, { cwd: projectCwd }), scanOptions, cache, sessionId, config),
      };
    } else if (!quietMode && !suppressionWinner && cleanWinner && !cleanAckDeduped && shouldEmitAckForFile(cleanWinner.filePath, config)) {
      ack = {
        kind: 'clean',
        text: appendDesignSystemNoteOnce(renderCleanAck(cleanWinner.filePath, { cwd: projectCwd }), scanOptions, cache, sessionId, config),
      };
    }

    // Persist only when the write is earned: deferred findings need the
    // touched-file list for the Stop deep pass, and an already-present
    // `.impeccable/` dir marks a project that opted in. A non-UI edit, or a
    // clean UI edit in a project with no Impeccable footprint, must be a
    // no-op on disk (issues #344, #305).
    if (deferredTotal > 0 || (cacheDirty && fs.existsSync(path.join(projectCwd, '.impeccable')))) {
      persistCache(projectCwd, cache);
    }

    if (detectorThrewAny && !pendingWinner && !cleanWinner) {
      return result({ emitted: false, error: 'detector-threw', durationMs: Date.now() - started });
    }

    if (quietMode) {
      return result({ emitted: false, quiet: true, durationMs: Date.now() - started });
    }

    if (ack?.kind === 'pending') {
      const text = ack.text;
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

    if (ack?.kind === 'clean') {
      const text = ack.text;
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

// Cap on files the Stop deep pass will scan. The touched-file list is
// session-scoped and already capped per edit, but a very long session could
// accumulate more than the 30s hook timeout comfortably covers.
export const STOP_MAX_FILES = 20;

/**
 * Run the Stop-event deep pass: the FULL detector rule set over every UI
 * file touched this session, surfaced once, deduped against everything the
 * per-edit hook already reported. Same result contract as runHook():
 *   { exitCode, stdout, audit, emission? }
 *
 * Never throws; exits silent (and fast) when the session touched no UI
 * files. Output uses the Stop hookSpecificOutput channel: additionalContext
 * is delivered to the model and the conversation continues so it can act.
 */
export async function runStopHook({ stdinJson, env = {}, cwd = process.cwd(), now = Date.now, detector } = {}) {
  const audit = { ts: new Date(now()).toISOString(), event: 'Stop' };
  const result = (extra) => ({ exitCode: 0, stdout: '', audit: { ...audit, ...extra } });

  try {
    // Re-entrancy guard, same as the per-edit pass.
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

    // Claude Code's Stop-hook contract: `stop_hook_active` is true when this
    // hook is being re-invoked only because a prior invocation kept the turn
    // alive (here, via hookSpecificOutput.additionalContext). Re-scanning and
    // re-blocking now would loop until Claude Code's consecutive-block cap
    // force-ends the turn (issue #400). The prior fire already surfaced the
    // findings; whether to act on them is the agent's call. Exit fast with no
    // output before any scan. Only Claude Code sends this field; other
    // harnesses omit it, so the strict `=== true` is a no-op for them. This
    // guard makes the loop impossible regardless of the finding cache key's
    // line-number sensitivity (out of scope here; see findingCacheKey).
    if (event.stop_hook_active === true) {
      return result({ skipped: 'stop-hook-active', durationMs: Date.now() - started });
    }

    const harness = resolveHarness(env, event);
    audit.harness = harness;

    // A Stop event carries no file, so the session cwd is the project.
    // Umbrella-dir launches keyed their per-edit cache to the edited file's
    // project root (resolveCacheCwd); those sessions no-op here rather than
    // guessing which child project the session was about.
    const projectCwd = path.resolve(event.cwd || cwd);
    audit.cwd = projectCwd;
    const sessionId = event.session_id || 'unknown';
    audit.session = sessionId;

    const config = readConfig(projectCwd);
    if (config.enabled === false) {
      return result({ skipped: 'config-disabled', durationMs: Date.now() - started });
    }

    const cache = readCache(projectCwd);
    const touched = Object.keys(cache.sessions?.[sessionId]?.files || {});
    if (touched.length === 0) {
      return result({ skipped: 'no-touched-files', durationMs: Date.now() - started });
    }

    const platform = resolveProjectPlatform(projectCwd);
    if (isNativePlatform(platform)) {
      return result({ skipped: 'native-platform', platform, durationMs: Date.now() - started });
    }

    const det = detector || await loadDetector();
    if (!det || typeof det.detectText !== 'function') {
      return result({ skipped: 'detector-missing', durationMs: Date.now() - started });
    }
    const scanOptions = designSystemOptions(config, det, projectCwd);

    const freshGroups = [];
    let scanned = 0;
    for (const filePath of touched) {
      if (scanned >= STOP_MAX_FILES) break;
      if (hasPathTraversal(filePath) || SENSITIVE_PATH.test(filePath)) continue;
      if (GENERATED_PATH.test(filePath)) continue;
      const ext = path.extname(filePath).toLowerCase();
      const configuredExt = matchConfiguredExtension(filePath, config.extensions);
      if (!ALLOWED_EXTS.has(ext) && !configuredExt) continue;
      const relForMatch = relativize(filePath, projectCwd);
      if (matchesAnyGlob(relForMatch, config.ignoreFiles) || matchesAnyGlob(filePath, config.ignoreFiles)) continue;
      if (!fs.existsSync(filePath)) continue;
      // Caches written before this gate existed can still hold out-of-project
      // paths, so the Stop pass re-checks containment rather than trusting
      // the per-edit pass to have filtered them.
      if (!isScanTargetInsideProject(filePath, projectCwd)) continue;

      scanned += 1;
      let content = '';
      try { content = fs.readFileSync(filePath, 'utf-8'); } catch { continue; }

      let findings;
      const useHtmlEngine = configuredExt
        ? configuredExt.engine === 'html'
        : (ext === '.html' || ext === '.htm');

      if (useHtmlEngine && typeof det.detectHtml === 'function') {
        try { findings = await det.detectHtml(filePath, scanOptions); } catch { findings = []; }
      } else {
        try { findings = await det.detectText(content, filePath, scanOptions); } catch { findings = []; }
      }

      // Full rule set: no tier split here. Config/inline ignores still apply,
      // and the session dedupe drops everything the per-edit pass (or an
      // earlier Stop pass) already surfaced.
      const filtered = filterFindings(findings || [], content, ext, config);
      const fresh = dedupeAgainstCache(filtered, cache, sessionId, filePath);
      if (fresh.length > 0) {
        rememberFindings(cache, sessionId, filePath, fresh);
        freshGroups.push({ filePath, findings: fresh });
      }
    }
    audit.scannedFiles = scanned;

    if (freshGroups.length === 0) {
      return result({ emitted: false, skipped: 'stop-clean', durationMs: Date.now() - started });
    }

    // A per-edit fire earlier in this session already consumed the footer
    // flag, so the Stop wall of text carries the one-line short footer.
    const footerMode = footerModeForSession(cache, sessionId);
    const text = appendDesignSystemNoteOnce(
      renderGroupedTemplate(freshGroups, config, {
        cwd: projectCwd,
        footer: footerMode,
        reserveChars: designNoteReserve(scanOptions, cache, sessionId),
      }),
      scanOptions, cache, sessionId, config,
    );
    commitFooterShown(cache, sessionId, text);

    // Fresh findings earn the cache write so the next Stop fire is silent
    // unless new issues appear; the notice flags ride along.
    persistCache(projectCwd, cache);
    return {
      exitCode: 0,
      stdout: payload(text, 'Stop', harness),
      emission: {
        kind: 'stop-deep-pass',
        groups: freshGroups,
      },
      audit: {
        ...audit,
        emitted: true,
        freshFiles: freshGroups.length,
        freshFindings: freshGroups.reduce((sum, group) => sum + group.findings.length, 0),
        chars: text.length,
        durationMs: Date.now() - started,
      },
    };
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
