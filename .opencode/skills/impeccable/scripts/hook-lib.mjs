/**
 * Shared library for the Impeccable design hook.
 *
 * Pure-ish helpers split out from `hook.mjs` so unit tests can exercise
 * config parsing, finding filtering, dedup, render, and cache logic without
 * spawning a subprocess. `hook.mjs` itself is the thin stdin/stdout shim.
 *
 * Public surface (everything exported is part of the contract):
 *   ENVELOPE_PREFIX, ALLOWED_EXTS, SENSITIVE_PATH, GENERATED_PATH, TRUTHY
 *   truthy(value)
 *   readConfig(cwd) / DEFAULT_CONFIG
 *   readCache(cwd) / persistCache(cwd, cache)
 *   bumpEditCount(cache, sessionId, filePath) -> number
 *   suppressionNotice(filePath)
 *   filterFindings(findings, content, ext, config)
 *   dedupeAgainstCache(findings, cache, sessionId, filePath)
 *   renderTemplate(findings, filePath, config, opts)
 *   writeAuditLog(env, entry)
 *   loadDetector() -> Promise<{ detectText, detectHtml }>
 *   matchesAnyGlob(filePath, globs)
 *   parseInlineIgnores(content, ext) -> Map<lineNum, Set<ruleId|'*'>>
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
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ENVELOPE_PREFIX = '[impeccable@1]';

export const ALLOWED_EXTS = new Set([
  '.tsx', '.jsx', '.html', '.htm', '.vue', '.svelte', '.astro',
  '.css', '.scss', '.less', '.ts', '.js',
]);

// Hard-skip regex for sensitive files. Cannot be turned off via config.
export const SENSITIVE_PATH = /(?:^|[/\\])(?:\.env(?:\.|$)|.*\.pem$|id_rsa.*|.*secret.*|.*credential.*|\.git[/\\].*)/i;

// Hard-skip regex for generated, lock, minified, and build-output paths.
export const GENERATED_PATH = /(?:\.generated\.[a-z]+$|\.d\.ts$|\.min\.[a-z]+$|[/\\]node_modules[/\\]|[/\\](?:dist|build|out|\.next|\.cache|coverage)[/\\]|[/\\]?[^/\\]+\.lock(?:\.json)?$)/i;

export const TRUTHY = /^(1|true|yes|on)$/i;

export const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  ignoreRules: [],
  ignoreFiles: [],
  minSeverity: 'warning',
  limits: { maxFindings: 5, maxChars: 8000 },
});

const CACHE_MAX_SESSIONS = 8;
const EDIT_COUNT_THRESHOLD = 6;

export function truthy(value) {
  return typeof value === 'string' && TRUTHY.test(value);
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

export function getConfigPath(cwd) {
  return path.join(cwd, '.impeccable', 'hook.json');
}

export function getCachePath(cwd) {
  return path.join(cwd, '.impeccable', 'hook.cache.json');
}

export function readConfig(cwd) {
  const raw = safeReadJson(getConfigPath(cwd));
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CONFIG, limits: { ...DEFAULT_CONFIG.limits } };
  const limits = {
    maxFindings: numberOr(raw?.limits?.maxFindings, DEFAULT_CONFIG.limits.maxFindings),
    maxChars: numberOr(raw?.limits?.maxChars, DEFAULT_CONFIG.limits.maxChars),
  };
  return {
    enabled: raw.enabled === false ? false : true,
    ignoreRules: Array.isArray(raw.ignoreRules) ? raw.ignoreRules.map(String) : [],
    ignoreFiles: Array.isArray(raw.ignoreFiles) ? raw.ignoreFiles.map(String) : [],
    minSeverity: typeof raw.minSeverity === 'string' ? raw.minSeverity : DEFAULT_CONFIG.minSeverity,
    limits,
  };
}

function numberOr(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function readCache(cwd) {
  const raw = safeReadJson(getCachePath(cwd));
  if (!raw || typeof raw !== 'object' || raw.version !== 1) {
    return { version: 1, lastEducationAt: null, sessions: {} };
  }
  return {
    version: 1,
    lastEducationAt: raw.lastEducationAt || null,
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
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(cache));
    return true;
  } catch {
    return false;
  }
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
  return `${ENVELOPE_PREFIX} Suppressing further design hints on ${filePath}. ${EDIT_COUNT_THRESHOLD} edits in this session reached. Run /impeccable audit to revisit.`;
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

// Per-language inline ignore syntax.
//   HTML/Vue template/Svelte markup/Astro markup → `<!-- impeccable: ignore RULE -->`
//   JSX/TSX expressions                           → `{/* impeccable: ignore RULE */}`
//   CSS/SCSS/LESS                                 → `/* impeccable: ignore RULE */`
//   JS/TS                                         → `// impeccable: ignore RULE`
// Each directive applies to the NEXT NON-BLANK LINE so scope is unambiguous.
// `*` matches all rules.
const IGNORE_PATTERNS = [
  /<!--\s*impeccable\s*:\s*ignore\s+([\w*-]+)\s*-->/i,
  /\{\s*\/\*\s*impeccable\s*:\s*ignore\s+([\w*-]+)\s*\*\/\s*\}/i,
  /\/\*\s*impeccable\s*:\s*ignore\s+([\w*-]+)\s*\*\//i,
  /\/\/\s*impeccable\s*:\s*ignore\s+([\w*-]+)/i,
];

export function parseInlineIgnores(content, _ext) {
  const lines = content.split('\n');
  const result = new Map();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let ruleId = null;
    for (const pattern of IGNORE_PATTERNS) {
      const m = line.match(pattern);
      if (m) { ruleId = m[1]; break; }
    }
    if (!ruleId) continue;
    // Find the next non-blank line.
    let target = i + 1;
    while (target < lines.length && lines[target].trim() === '') target += 1;
    if (target >= lines.length) continue;
    const lineNumber = target + 1;
    const set = result.get(lineNumber) || new Set();
    set.add(ruleId);
    result.set(lineNumber, set);
  }
  return result;
}

const SEVERITY_ORDER = { advisory: 0, warning: 1, error: 2 };

function severityRank(s) {
  return SEVERITY_ORDER[s] ?? SEVERITY_ORDER.warning;
}

export function filterFindings(findings, content, ext, config) {
  if (!Array.isArray(findings) || findings.length === 0) return [];
  const ignoreRules = new Set((config.ignoreRules || []).map(String));
  const minRank = severityRank(config.minSeverity || 'warning');
  const ignores = parseInlineIgnores(content || '', ext);
  return findings.filter((f) => {
    if (!f || typeof f !== 'object') return false;
    if (ignoreRules.has(f.antipattern)) return false;
    if (severityRank(f.severity) < minRank) return false;
    const inlineSet = ignores.get(f.line);
    if (inlineSet && (inlineSet.has('*') || inlineSet.has(f.antipattern))) return false;
    return true;
  });
}

export function dedupeAgainstCache(findings, cache, sessionId, filePath) {
  if (!Array.isArray(findings) || findings.length === 0) return [];
  const fileEntry = ensureFile(cache, sessionId, filePath);
  const known = new Set(fileEntry.findings || []);
  const fresh = [];
  for (const f of findings) {
    const key = `${f.antipattern}:${f.line || 0}`;
    if (known.has(key)) continue;
    known.add(key);
    fresh.push(f);
  }
  return fresh;
}

export function rememberFindings(cache, sessionId, filePath, findings) {
  const fileEntry = ensureFile(cache, sessionId, filePath);
  const known = new Set(fileEntry.findings || []);
  for (const f of findings) known.add(`${f.antipattern}:${f.line || 0}`);
  fileEntry.findings = Array.from(known);
  ensureSession(cache, sessionId).updatedAt = Date.now();
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

  const header = `${ENVELOPE_PREFIX} Design detector flagged ${total} issue(s) in ${display}:`;
  const lines = shown.map((f) => formatFindingLine(f));
  const more = remaining > 0
    ? `... and ${remaining} more (see /impeccable audit).`
    : null;
  const footer = 'Consider revising before continuing. Suppress with inline comments (e.g. `// impeccable: ignore <rule>`) or .impeccable/hook.json. Run /impeccable audit for full coverage.';

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
    moreText = '... and more (see /impeccable audit).';
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
  return `${prefix} [${f.antipattern}] ${nameSegment} ${desc}`.replace(/\s+/g, ' ').trim();
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

export function writeAuditLog(env, entry) {
  const target = env?.IMPECCABLE_HOOK_LOG;
  if (!target || typeof target !== 'string') return false;
  try {
    const expanded = target.startsWith('~/')
      ? path.join(process.env.HOME || process.env.USERPROFILE || '.', target.slice(2))
      : target;
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
  detectorCache = { detectText: mod.detectText, detectHtml: mod.detectHtml };
  return detectorCache;
}

// For tests: allow injecting a detector implementation.
export function setDetectorForTesting(impl) {
  detectorCache = impl;
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
    if (truthy(env.IMPECCABLE_HOOK_DEPTH) || truthy(env.CLAUDE_HOOK_DEPTH)) {
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

    const filePath = event?.tool_input?.file_path;
    if (!filePath || typeof filePath !== 'string') {
      return result({ skipped: 'no-file-path', durationMs: Date.now() - started });
    }

    audit.file = filePath;
    audit.session = event.session_id || null;

    if (filePath.includes('..') || SENSITIVE_PATH.test(filePath)) {
      return result({ skipped: 'sensitive', durationMs: Date.now() - started });
    }
    if (GENERATED_PATH.test(filePath)) {
      return result({ skipped: 'generated', durationMs: Date.now() - started });
    }

    const ext = path.extname(filePath).toLowerCase();
    audit.ext = ext;
    if (!ALLOWED_EXTS.has(ext)) {
      return result({ skipped: 'extension', durationMs: Date.now() - started });
    }

    const projectCwd = event.cwd || cwd;
    const config = readConfig(projectCwd);
    if (config.enabled === false) {
      return result({ skipped: 'config-disabled', durationMs: Date.now() - started });
    }
    // Globs in `.impeccable/hook.json` are project-relative by convention
    // (matches gitignore). Match against both the relative and absolute path
    // so absolute-glob escape hatches still work too.
    const relForMatch = relativize(filePath, projectCwd);
    if (matchesAnyGlob(relForMatch, config.ignoreFiles) || matchesAnyGlob(filePath, config.ignoreFiles)) {
      return result({ skipped: 'config-ignore-file', durationMs: Date.now() - started });
    }
    if (!fs.existsSync(filePath)) {
      return result({ skipped: 'file-missing', durationMs: Date.now() - started });
    }

    const cache = readCache(projectCwd);
    const sessionId = event.session_id || 'unknown';
    const editCount = bumpEditCount(cache, sessionId, filePath);
    audit.editCount = editCount;

    if (editCount > EDIT_COUNT_THRESHOLD) {
      // Fire a one-shot notice the very turn we cross the threshold; silent after.
      const wasJustCrossed = editCount === EDIT_COUNT_THRESHOLD + 1;
      persistCache(projectCwd, cache);
      if (wasJustCrossed) {
        const text = suppressionNotice(relativize(filePath, projectCwd));
        return {
          exitCode: 0,
          stdout: payload(text, 'PostToolUse'),
          audit: { ...audit, suppressed: true, emitted: true, durationMs: Date.now() - started },
        };
      }
      return result({ suppressed: true, emitted: false, durationMs: Date.now() - started });
    }

    const det = detector || await loadDetector();
    if (!det || typeof det.detectText !== 'function') {
      persistCache(projectCwd, cache);
      return result({ skipped: 'detector-missing', durationMs: Date.now() - started });
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    let findings;
    if ((ext === '.html' || ext === '.htm') && typeof det.detectHtml === 'function') {
      try { findings = det.detectHtml(filePath); } catch { findings = []; }
    } else {
      try { findings = det.detectText(content, filePath); } catch { findings = []; }
    }

    const filtered = filterFindings(findings || [], content, ext, config);
    const fresh = dedupeAgainstCache(filtered, cache, sessionId, filePath);
    audit.findings = (findings || []).length;
    audit.freshFindings = fresh.length;

    if (fresh.length === 0) {
      persistCache(projectCwd, cache);
      return result({ emitted: false, durationMs: Date.now() - started });
    }

    rememberFindings(cache, sessionId, filePath, fresh);
    persistCache(projectCwd, cache);
    const text = renderTemplate(fresh, filePath, config, { cwd: projectCwd });
    return {
      exitCode: 0,
      stdout: payload(text, 'PostToolUse'),
      audit: { ...audit, emitted: true, chars: text.length, durationMs: Date.now() - started },
    };
  } catch (err) {
    return {
      exitCode: 0,
      stdout: '',
      audit: { ...audit, error: String(err && err.message ? err.message : err) },
    };
  }
}

export function payload(text, eventName = 'PostToolUse') {
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: eventName, additionalContext: text },
  });
}
