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
 *   {
 *     "detector": { "ignoreRules": [], "ignoreFiles": [], "ignoreValues": [], "designSystem": { "enabled": true } },
 *     "hook": { "consent": "accepted" | "declined", ... },
 *     "updateCheck": bool
 *   }
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

function detectorSection(raw) {
  return raw && raw.detector && typeof raw.detector === 'object' && !Array.isArray(raw.detector) ? raw.detector : null;
}

const DETECTOR_CONFIG_KEYS = new Set(['ignoreRules', 'ignoreFiles', 'ignoreValues', 'designSystem', 'advisoryRules']);

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

function cloneRawDetectionConfig() {
  return {
    ignoreRules: [],
    ignoreFiles: [],
    ignoreValues: [],
  };
}

function applyDetectionConfigSource(config, raw) {
  if (!raw || typeof raw !== 'object') return config;
  // Advisory rules are opt-in for the design hook; the CLI carries the setting
  // so config round-trips (e.g. `impeccable hooks ignore-value`) preserve it.
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
  for (const filePath of [getConfigPath(root), getLocalConfigPath(root)]) {
    const raw = safeReadJson(filePath);
    // Back-compat: old builds stored detector filters under hook.*.
    applyDetectionConfigSource(config, hookSection(raw));
    applyDetectionConfigSource(config, detectorSection(raw));
  }
  return config;
}

export function readRawDetectionConfig(root, opts = {}) {
  const raw = safeReadJson(opts.local ? getLocalConfigPath(root) : getConfigPath(root));
  const config = cloneRawDetectionConfig();
  applyDetectionConfigSource(config, hookSection(raw));
  applyDetectionConfigSource(config, detectorSection(raw));
  return config;
}

export function writeDetectionConfig(root, detectorConfig, opts = {}) {
  const filePath = opts.local ? getLocalConfigPath(root) : getConfigPath(root);
  if (opts.local) ensureConfigGitExclude(root);
  const existing = safeReadJson(filePath) || {};
  const existingHook = hookSection(existing);
  const nextHook = stripDetectorKeys(existingHook);
  const nextDetector = {
    ...(detectorSection(existing) || {}),
    ...normalizeDetectionConfigForWrite(detectorConfig),
  };
  const next = {
    ...existing,
    detector: nextDetector,
  };
  if (nextHook && Object.keys(nextHook).length > 0) {
    next.hook = nextHook;
  } else {
    delete next.hook;
  }
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`);
  return filePath;
}

function normalizeDetectionConfigForWrite(config) {
  const out = {};
  if (Array.isArray(config?.ignoreRules)) {
    out.ignoreRules = uniqueStrings(config.ignoreRules.map((rule) => normalizeIgnoreRule(rule)).filter(Boolean));
  }
  if (Array.isArray(config?.ignoreFiles)) {
    out.ignoreFiles = uniqueStrings(config.ignoreFiles.filter(v => typeof v === 'string' && v.trim()).map(v => v.trim()));
  }
  out.ignoreValues = normalizeIgnoreValueEntries(config?.ignoreValues || []);
  if (config?.advisoryRules === 'include' || config?.advisoryRules === 'exclude') {
    out.advisoryRules = config.advisoryRules;
  }
  if (config?.designSystem && typeof config.designSystem === 'object' && !Array.isArray(config.designSystem)) {
    out.designSystem = {
      enabled: config.designSystem.enabled === false ? false : true,
    };
  }
  return out;
}

function stripDetectorKeys(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!DETECTOR_CONFIG_KEYS.has(key)) out[key] = value;
  }
  return out;
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
    const r = parseColorChannel(parts[0], COLOR_CHANNEL_FORMATS.rgb);
    const g = parseColorChannel(parts[1], COLOR_CHANNEL_FORMATS.rgb);
    const b = parseColorChannel(parts[2], COLOR_CHANNEL_FORMATS.rgb);
    const a = parts[3] === undefined ? 1 : parseColorChannel(parts[3], COLOR_CHANNEL_FORMATS.alpha);
    if ([r, g, b, a].some((v) => v === null)) return null;
    return { r, g, b, a };
  }

  const hsl = text.match(/^hsla?\((.*)\)$/i);
  if (hsl) {
    const parts = splitColorArgs(hsl[1]);
    if (parts.length < 3 || parts.length > 4) return null;
    const h = parseColorChannel(parts[0], COLOR_CHANNEL_FORMATS.hue);
    const s = parseColorChannel(parts[1], COLOR_CHANNEL_FORMATS.percent);
    const l = parseColorChannel(parts[2], COLOR_CHANNEL_FORMATS.percent);
    const a = parts[3] === undefined ? 1 : parseColorChannel(parts[3], COLOR_CHANNEL_FORMATS.alpha);
    if ([h, s, l, a].some((v) => v === null)) return null;
    return hslToRgb(h, s, l, a);
  }

  return null;
}

function parseHexIgnoreColor(hex) {
  const expanded = hex.length <= 4
    ? [...hex].map((digit) => digit.repeat(2)).join('')
    : hex;
  const [r, g, b, alpha = 255] = expanded
    .match(/../g)
    .map((channel) => Number.parseInt(channel, 16));
  return { r, g, b, a: alpha / 255 };
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

const CSS_NUMBER_RE = /^(-?\d*\.?\d+)(%|deg|rad|turn|grad)?$/;
const identity = (value) => value;
const COLOR_CHANNEL_FORMATS = {
  rgb: { units: { '': identity, '%': (value) => value * 2.55 }, min: 0, max: 255, round: true },
  alpha: { units: { '': identity, '%': (value) => value / 100 }, min: 0, max: 1 },
  hue: {
    units: {
      '': identity,
      deg: identity,
      rad: (value) => value * (180 / Math.PI),
      turn: (value) => value * 360,
      grad: (value) => value * 0.9,
    },
  },
  percent: { units: { '%': (value) => value / 100 }, min: 0, max: 1 },
};

function parseColorChannel(raw, { units, min = -Infinity, max = Infinity, round = false }) {
  const text = String(raw || '').trim();
  const match = text.match(CSS_NUMBER_RE);
  if (!match) return null;
  const convert = units[match[2] || ''];
  if (!convert) return null;
  const number = Number.parseFloat(match[1]);
  if (!Number.isFinite(number)) return null;
  const value = convert(number);
  if (value < min || value > max) return null;
  return round ? Math.round(value) : value;
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
    // already on disk rewrites every untouched entry and churns the diff. Keep in
    // step with normalizeIgnoreValueEntries in skill/scripts/hook-lib.mjs.
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

/**
 * The currently effective `hook.enabled` value, mirroring the runtime's own
 * resolution order in hook-lib.mjs's readConfig() / context.mjs's
 * hookEnabledAt() -- shared config.json first, then config.local.json
 * overriding it when it also has an explicit key. Returns undefined when
 * neither file has one (the runtime treats that as disabled per
 * DEFAULT_CONFIG, issue #512).
 */
export function getHookEnabled(root) {
  let enabled;
  for (const filePath of [getConfigPath(root), getLocalConfigPath(root)]) {
    const hook = hookSection(safeReadJson(filePath));
    if (hook && Object.prototype.hasOwnProperty.call(hook, 'enabled')) {
      enabled = hook.enabled !== false;
    }
  }
  return enabled;
}

/**
 * Persist `hook.enabled` to the shared config.json, preserving any sibling
 * keys. Mirrors skill/scripts/hook-admin.mjs's setEnabled(cwd, true): the
 * hook runtime's DEFAULT_CONFIG.enabled defaults to false (absence of
 * consent must not mean "on"), so this CLI install path -- the only other
 * place manifests get written -- must explicitly opt in, or an install done
 * through `npx impeccable skills install` would wire up manifests that never
 * actually fire.
 */
export function setHookEnabled(root, value) {
  const filePath = getConfigPath(root);
  const existing = safeReadJson(filePath) || {};
  const hook = hookSection(existing) || {};
  const next = { ...existing, hook: { ...hook, enabled: value } };
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`);
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
