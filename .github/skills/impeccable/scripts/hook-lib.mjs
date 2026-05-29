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
 *   renderCleanAck(filePath, opts) / renderPendingAck(filePath, known, opts)
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
  '.css', '.scss', '.sass', '.less', '.ts', '.js',
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

export function getPendingPath(cwd) {
  return path.join(cwd, '.impeccable', 'hook.pending.json');
}

function pendingBucketKey(conversationId) {
  return conversationId && String(conversationId) ? String(conversationId) : '_default';
}

function readPendingStore(cwd) {
  const raw = safeReadJson(getPendingPath(cwd));
  if (!raw || typeof raw !== 'object' || raw.version !== 1) {
    return { version: 1, buckets: {} };
  }
  return {
    version: 1,
    buckets: raw.buckets && typeof raw.buckets === 'object' ? raw.buckets : {},
  };
}

function persistPendingStore(cwd, store) {
  const target = getPendingPath(cwd);
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

/** Append one emission item for Cursor stop-hook followup. */
export function appendPending(cwd, conversationId, item) {
  if (!item || typeof item !== 'object') return false;
  const store = readPendingStore(cwd);
  const key = pendingBucketKey(conversationId);
  if (!Array.isArray(store.buckets[key])) store.buckets[key] = [];
  store.buckets[key].push({
    file: item.file,
    kind: item.kind,
    findings: item.findings || undefined,
    known: item.known || undefined,
  });
  return persistPendingStore(cwd, store);
}

/** Drain and clear the pending queue for a conversation (or default bucket). */
export function drainPending(cwd, conversationId) {
  const store = readPendingStore(cwd);
  const key = pendingBucketKey(conversationId);
  const items = Array.isArray(store.buckets[key]) ? store.buckets[key].slice() : [];
  if (items.length > 0) {
    delete store.buckets[key];
    persistPendingStore(cwd, store);
  }
  return items;
}

/** Clear pending queue without emitting (loop guard). */
export function clearPending(cwd, conversationId) {
  const store = readPendingStore(cwd);
  const key = pendingBucketKey(conversationId);
  if (!store.buckets[key]) return false;
  delete store.buckets[key];
  return persistPendingStore(cwd, store);
}

export function resolveProjectCwd(event, fallback = process.cwd()) {
  return event?.cwd
    || (Array.isArray(event?.workspace_roots) && event.workspace_roots[0])
    || envProjectDir(fallback)
    || fallback;
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

  const header = `${ENVELOPE_PREFIX} Required design corrections in ${display} (${total} issue(s)):`;
  const lines = shown.map((f) => formatFindingLine(f));
  const more = remaining > 0
    ? `... and ${remaining} more (see /impeccable audit).`
    : null;
  const footer = directiveFooter();

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

/**
 * Render a Cursor stop-hook followup_message from queued afterFileEdit items.
 * Uses the same envelope + directive footer as renderTemplate.
 */
export function renderCursorFollowup(items, opts = {}) {
  if (!Array.isArray(items) || items.length === 0) return '';
  const cwd = opts.cwd || process.cwd();
  const config = opts.config || DEFAULT_CONFIG;
  const limits = config?.limits || DEFAULT_CONFIG.limits;
  const cap = Math.max(1, limits.maxFindings || DEFAULT_CONFIG.limits.maxFindings);
  const maxChars = Math.max(500, limits.maxChars || DEFAULT_CONFIG.limits.maxChars);

  const header = `${ENVELOPE_PREFIX} Design hook flagged issues during your last turn:`;
  const sections = [];

  for (const item of items) {
    if (!item || typeof item !== 'object' || typeof item.file !== 'string') continue;
    const display = relativize(item.file, cwd);
    if (item.kind === 'pending' && Array.isArray(item.known) && item.known.length) {
      const count = item.known.length;
      const sample = item.known.slice(0, 3).join(', ');
      const more = count > 3 ? `, +${count - 3} more` : '';
      sections.push(`Still pending in ${display}: ${count} issue(s) flagged earlier this session (${sample}${more}).`);
    } else if (item.kind === 'fresh' && Array.isArray(item.findings) && item.findings.length) {
      const total = item.findings.length;
      const shown = item.findings.slice(0, cap);
      const remaining = total - shown.length;
      sections.push(`Required design corrections in ${display} (${total} issue(s)):`);
      sections.push(...shown.map((f) => formatFindingLine(f)));
      if (remaining > 0) {
        sections.push(`... and ${remaining} more in ${display} (see /impeccable audit).`);
      }
    }
  }

  if (sections.length === 0) return '';

  const footer = directiveFooter();
  let text = [header, ...sections, '', footer].join('\n');
  if (text.length > maxChars) {
    text = `${text.slice(0, maxChars - 16)}\n...(truncated)`;
  }
  return text;
}

export function followupPayload(text) {
  return JSON.stringify({ followup_message: text });
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
  if (ti && typeof ti.file_path === 'string' && ti.file_path) {
    return [ti.file_path];
  }
  // Cursor Write / StrReplace use `path`, not `file_path`.
  if (ti && typeof ti.path === 'string' && ti.path) {
    return [ti.path];
  }
  if (typeof event?.file_path === 'string' && event.file_path) {
    return [event.file_path];
  }
  if (event?.tool_name === 'apply_patch' && ti && typeof ti.command === 'string') {
    return parseApplyPatchPaths(ti.command, projectCwd);
  }
  return [];
}

export function resolveHarness(env = {}, event = null) {
  const explicit = env?.IMPECCABLE_HOOK_HARNESS;
  if (explicit === 'cursor') return 'cursor';
  if (explicit === 'claude' || explicit === 'codex') return 'claude';
  if (['afterFileEdit', 'sessionStart', 'stop'].includes(event?.hook_event_name)) return 'cursor';
  if (typeof event?.conversation_id === 'string' && event.conversation_id) return 'cursor';
  return 'claude';
}

export function normalizeHookEvent(event, projectCwd, harness = 'claude') {
  if (!event || typeof event !== 'object' || harness !== 'cursor') return event;

  const cwd = event.cwd
    || (Array.isArray(event.workspace_roots) && event.workspace_roots[0])
    || envProjectDir(projectCwd)
    || projectCwd;
  const sessionId = event.session_id || event.conversation_id || 'unknown';

  if (event.hook_event_name === 'afterFileEdit' && typeof event.file_path === 'string') {
    return {
      ...event,
      cwd,
      session_id: sessionId,
      tool_name: 'Write',
      tool_input: { file_path: event.file_path },
    };
  }

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

export function parseStaticStyleImports(content, fromFile, projectCwd) {
  if (!content || typeof content !== 'string') return [];
  const dir = path.dirname(fromFile);
  const out = [];
  for (const m of content.matchAll(STATIC_STYLE_IMPORT_RE)) {
    let p = (m[1] || '').trim();
    if (!p) continue;
    if (p.startsWith('.')) p = path.resolve(dir, p);
    else if (!path.isAbsolute(p)) p = path.resolve(projectCwd, p);
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
    path.join(dir, `${base}.less`),
  ]);
  for (const name of CO_SCAN_STYLE_NAMES) {
    candidates.add(path.join(dir, name));
  }
  return [...candidates].filter((p) => fs.existsSync(p));
}

export function expandScanTargets(primaryTargets, projectCwd) {
  if (!Array.isArray(primaryTargets) || primaryTargets.length === 0) return [];
  const ordered = [];
  const seen = new Set();
  const add = (p) => {
    if (ordered.length >= MAX_SCAN_TARGETS) return;
    // Preserve literal `..` segments so downstream sensitive-path checks
    // still fire. path.resolve would collapse `/foo/../etc/passwd`.
    const abs = (typeof p === 'string' && p.includes('..')) ? p : path.resolve(p);
    if (seen.has(abs)) return;
    seen.add(abs);
    ordered.push(abs);
  };

  for (const p of primaryTargets) add(p);

  for (const p of primaryTargets) {
    if (ordered.length >= MAX_SCAN_TARGETS) break;
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

const STEER_LINE = 'Keep typography hierarchy, spacing rhythm, and color contrast intentional on the next change.';

export function renderCleanAck(filePath, opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const display = relativize(filePath, cwd);
  return `${ENVELOPE_PREFIX} Design hook scanned ${display}. No anti-patterns. ${STEER_LINE}`;
}

export function renderPendingAck(filePath, knownFindings, opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const display = relativize(filePath, cwd);
  const count = knownFindings.length;
  // `knownFindings` here are the cache strings like "side-tab:3".
  const sample = knownFindings.slice(0, 3).join(', ');
  const more = count > 3 ? `, +${count - 3} more` : '';
  return `${ENVELOPE_PREFIX} Design hook scanned ${display}. Still has ${count} issue(s) flagged earlier this session (${sample}${more}). Address them before finalizing — the previous reminder still applies.`;
}

// The directive footer is the part of the hook output that steers model
// behavior. Three intentional moves:
//   1. **Imperative, not advisory.** "Fix these..." beats "Consider
//      revising..." which the model treats as a soft suggestion it can
//      override when the user asked for any kind of throwaway / demo UI.
//   2. **Explicit exception clause.** Without it, the model will try to
//      "fix" intentional bad fixtures, anti-pattern examples in docs, or
//      test cases. Naming the exception inline beats hoping the model
//      infers it from context.
//   3. **Acknowledgement instruction.** Hook output is injected as
//      developer-role context, not a chat turn, so the user never sees the
//      raw envelope. Asking the model to surface the fix in its reply is
//      the cheapest way to make the feedback loop visible to the user.
function directiveFooter() {
  return [
    'Fix these in your next reply before finalizing. Acknowledge what you changed so the user sees the correction.',
    '',
    'Skip the fix only if the user explicitly asked for an intentionally bad UI, an anti-pattern example, a test fixture, or documentation of bad design. In that case, say so and continue.',
    '',
    'Suppress permanently with `// impeccable: ignore <rule>` inline directives or .impeccable/hook.json. Run /impeccable audit for the full pass.',
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

    const harness = resolveHarness(env, event);
    event = normalizeHookEvent(event, cwd, harness);
    audit.harness = harness;

    const projectCwd = event.cwd || cwd;
    const targetFiles = expandScanTargets(resolveTargetFiles(event, projectCwd), projectCwd);
    audit.session = event.session_id || null;
    if (event.tool_name) audit.tool = event.tool_name;

    if (targetFiles.length === 0) {
      return result({ skipped: 'no-file-path', durationMs: Date.now() - started });
    }

    const config = readConfig(projectCwd);
    if (config.enabled === false) {
      return result({ skipped: 'config-disabled', durationMs: Date.now() - started });
    }

    const cache = readCache(projectCwd);
    const sessionId = event.session_id || 'unknown';
    const det = detector || await loadDetector();
    if (!det || typeof det.detectText !== 'function') {
      persistCache(projectCwd, cache);
      return result({ skipped: 'detector-missing', durationMs: Date.now() - started });
    }

    let pendingWinner = null;
    let cleanWinner = null;
    let detectorThrewAny = false;
    let lastSkip = 'no-scannable-file';
    let suppressedHit = false;

    for (const filePath of targetFiles) {
      audit.file = filePath;

      if (filePath.includes('..') || SENSITIVE_PATH.test(filePath)) {
        lastSkip = 'sensitive';
        continue;
      }
      if (GENERATED_PATH.test(filePath)) {
        lastSkip = 'generated';
        continue;
      }

      const ext = path.extname(filePath).toLowerCase();
      audit.ext = ext;
      if (!ALLOWED_EXTS.has(ext)) {
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

      const editCount = bumpEditCount(cache, sessionId, filePath);
      audit.editCount = editCount;

      if (editCount > EDIT_COUNT_THRESHOLD) {
        const wasJustCrossed = editCount === EDIT_COUNT_THRESHOLD + 1;
        persistCache(projectCwd, cache);
        if (wasJustCrossed) {
          const text = suppressionNotice(relativize(filePath, projectCwd));
          return {
            exitCode: 0,
            stdout: payload(text, 'PostToolUse', harness),
            emission: { kind: 'suppression', file: filePath },
            audit: { ...audit, suppressed: true, emitted: true, durationMs: Date.now() - started },
          };
        }
        lastSkip = 'suppressed';
        suppressedHit = true;
        continue;
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      let findings;
      let detectorThrew = false;
      if ((ext === '.html' || ext === '.htm') && typeof det.detectHtml === 'function') {
        try { findings = await det.detectHtml(filePath); } catch { findings = []; detectorThrew = true; }
      } else {
        try { findings = await det.detectText(content, filePath); } catch { findings = []; detectorThrew = true; }
      }

      const filtered = filterFindings(findings || [], content, ext, config);
      const fresh = dedupeAgainstCache(filtered, cache, sessionId, filePath);
      audit.findings = (findings || []).length;
      audit.freshFindings = fresh.length;

      if (fresh.length > 0) {
        rememberFindings(cache, sessionId, filePath, fresh);
        persistCache(projectCwd, cache);
        const text = renderTemplate(fresh, filePath, config, { cwd: projectCwd });
        return {
          exitCode: 0,
          stdout: payload(text, 'PostToolUse', harness),
          emission: { kind: 'fresh', file: filePath, findings: fresh },
          audit: { ...audit, emitted: true, chars: text.length, durationMs: Date.now() - started },
        };
      }

      if (detectorThrew) {
        detectorThrewAny = true;
        continue;
      }

      if (filtered.length > 0 && !pendingWinner) {
        const known = (ensureFile(cache, sessionId, filePath).findings || []).slice();
        pendingWinner = { filePath, known };
      } else if (filtered.length === 0 && !cleanWinner) {
        cleanWinner = { filePath };
      }
    }

    persistCache(projectCwd, cache);

    if (detectorThrewAny && !pendingWinner && !cleanWinner) {
      return result({ emitted: false, error: 'detector-threw', durationMs: Date.now() - started });
    }

    if (truthy(env.IMPECCABLE_HOOK_QUIET)) {
      return result({ emitted: false, quiet: true, durationMs: Date.now() - started });
    }

    if (pendingWinner) {
      const text = renderPendingAck(pendingWinner.filePath, pendingWinner.known, { cwd: projectCwd });
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

    if (cleanWinner) {
      const text = renderCleanAck(cleanWinner.filePath, { cwd: projectCwd });
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

    if (suppressedHit) {
      return result({ suppressed: true, emitted: false, durationMs: Date.now() - started });
    }

    return result({ skipped: lastSkip, durationMs: Date.now() - started });
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
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: eventName, additionalContext: text },
  });
}
