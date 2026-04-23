/**
 * CLI helper: insert/remove the live variant mode script tag in the project's
 * main HTML entry point.
 *
 * On first live run, the agent generates `config.json` in this script's
 * directory with the project's insertion target (framework-specific). On
 * every subsequent run, this script handles insert/remove deterministically
 * with zero LLM involvement.
 *
 * Usage:
 *   node live-inject.mjs --port PORT   # Insert the live script tag
 *   node live-inject.mjs --remove      # Remove the live script tag
 *   node live-inject.mjs --check       # Check whether config.json exists
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = process.env.IMPECCABLE_LIVE_CONFIG || path.join(__dirname, 'config.json');
const MARKER_OPEN_TEXT = 'impeccable-live-start';
const MARKER_CLOSE_TEXT = 'impeccable-live-end';

/**
 * Hard-excluded directory patterns. These are NEVER user-facing pages and
 * matching them would silently inject tracking scripts into third-party
 * code. The user cannot turn these off via config — they are the floor.
 */
const HARD_EXCLUDES = [
  '**/node_modules/**',
  '**/.git/**',
];

export async function injectCli() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage: node live-inject.mjs [options]

Insert or remove the live mode script tag in the project's HTML entry point.
Reads configuration from config.json (in this same directory).

Modes:
  --port PORT   Insert script tag pointing at http://localhost:PORT/live.js
  --remove      Remove the script tag (if present)
  --check       Print whether config.json exists and its content

Output (JSON):
  { ok, file, inserted|removed, config? }`);
    process.exit(0);
  }

  if (args.includes('--check')) {
    if (!fs.existsSync(CONFIG_PATH)) {
      console.log(JSON.stringify({ ok: false, error: 'config_missing', path: CONFIG_PATH }));
      process.exit(0);
    }
    let cfg;
    try {
      cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    } catch (err) {
      console.log(JSON.stringify({ ok: false, error: 'config_invalid', message: err.message, path: CONFIG_PATH }));
      return;
    }
    try {
      validateConfig(cfg);
    } catch (err) {
      console.log(JSON.stringify({ ok: false, error: 'config_invalid', message: err.message, path: CONFIG_PATH }));
      return;
    }
    console.log(JSON.stringify({ ok: true, config: cfg, path: CONFIG_PATH }));
    return;
  }

  // Load config
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(JSON.stringify({ ok: false, error: 'config_missing', path: CONFIG_PATH }));
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  validateConfig(config);

  const resolvedFiles = resolveFiles(process.cwd(), config);

  if (args.includes('--remove')) {
    const results = resolvedFiles.map((relFile) => {
      const absFile = path.resolve(process.cwd(), relFile);
      if (!fs.existsSync(absFile)) return { file: relFile, error: 'file_not_found' };
      const content = fs.readFileSync(absFile, 'utf-8');
      const updated = removeTag(content, config.commentSyntax);
      if (updated === content) return { file: relFile, removed: false, note: 'no tag present' };
      fs.writeFileSync(absFile, updated, 'utf-8');
      return { file: relFile, removed: true };
    });
    console.log(JSON.stringify({ ok: true, results }));
    return;
  }

  // Insert mode — need --port
  const portIdx = args.indexOf('--port');
  const port = portIdx !== -1 ? parseInt(args[portIdx + 1], 10) : NaN;
  if (!Number.isFinite(port)) {
    console.error(JSON.stringify({ ok: false, error: 'missing_port' }));
    process.exit(1);
  }

  const results = resolvedFiles.map((relFile) => {
    const absFile = path.resolve(process.cwd(), relFile);
    if (!fs.existsSync(absFile)) return { file: relFile, error: 'file_not_found' };
    const content = fs.readFileSync(absFile, 'utf-8');
    const withoutOld = removeTag(content, config.commentSyntax);
    const updated = insertTag(withoutOld, config, port);
    if (updated === withoutOld) return { file: relFile, error: 'insertion_point_not_found', anchor: config.insertBefore || config.insertAfter };
    fs.writeFileSync(absFile, updated, 'utf-8');
    return { file: relFile, inserted: true };
  });
  const anyInserted = results.some((r) => r.inserted);
  console.log(JSON.stringify({ ok: anyInserted, port, results }));
  if (!anyInserted) process.exit(1);
}

/**
 * Expand config.files (which may contain glob patterns) into a literal list
 * of existing file paths relative to rootDir. Literal entries pass through;
 * glob patterns are expanded via fs.globSync. HARD_EXCLUDES and config.exclude
 * are applied as filters. Duplicates are removed. Order is preserved by
 * first appearance.
 */
export function resolveFiles(rootDir, config) {
  const patterns = config.files;
  const userExcludes = Array.isArray(config.exclude) ? config.exclude : [];
  const allExcludes = [...HARD_EXCLUDES, ...userExcludes];
  const excludeRegexes = allExcludes.map(globToRegex);

  const isExcluded = (relPath) => excludeRegexes.some((re) => re.test(relPath));
  const isGlob = (s) => /[*?[]/.test(s);

  const seen = new Set();
  const out = [];
  for (const pat of patterns) {
    if (!isGlob(pat)) {
      // Literal path — include even if it doesn't exist yet; the caller
      // reports file_not_found per-entry. Exclude list doesn't apply to
      // explicit literal entries (user named it on purpose).
      if (!seen.has(pat)) {
        seen.add(pat);
        out.push(pat);
      }
      continue;
    }
    let matches;
    try {
      matches = fs.globSync(pat, { cwd: rootDir, withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of matches) {
      if (!ent.isFile || !ent.isFile()) continue;
      const abs = path.join(ent.parentPath || ent.path || rootDir, ent.name);
      const rel = path.relative(rootDir, abs).split(path.sep).join('/');
      if (isExcluded(rel)) continue;
      if (seen.has(rel)) continue;
      seen.add(rel);
      out.push(rel);
    }
  }
  return out;
}

/**
 * Convert a glob pattern to a RegExp. Supports:
 *   **  → any number of path segments (including zero)
 *   *   → any chars except `/`
 *   ?   → any single char except `/`
 * Paths are normalized to forward slashes before matching.
 */
function globToRegex(pattern) {
  let re = '';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        // ** — any number of segments, including zero. Handle the common
        // **/ and /** forms so `a/**/b` matches `a/b` as well as `a/x/y/b`.
        if (pattern[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 3;
        } else {
          re += '.*';
          i += 2;
        }
      } else {
        re += '[^/]*';
        i += 1;
      }
    } else if (c === '?') {
      re += '[^/]';
      i += 1;
    } else if (/[.+^${}()|[\]\\]/.test(c)) {
      re += '\\' + c;
      i += 1;
    } else {
      re += c;
      i += 1;
    }
  }
  return new RegExp('^' + re + '$');
}

// ---------------------------------------------------------------------------
// Core operations
// ---------------------------------------------------------------------------

function validateConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') throw new Error('config.json must be an object');
  if (!Array.isArray(cfg.files) || cfg.files.length === 0) {
    throw new Error('config.files (non-empty string array) required');
  }
  if (!cfg.files.every((f) => typeof f === 'string' && f.length > 0)) {
    throw new Error('config.files must contain only non-empty strings');
  }
  if (cfg.exclude !== undefined) {
    if (!Array.isArray(cfg.exclude)) {
      throw new Error('config.exclude, if present, must be a string array');
    }
    if (!cfg.exclude.every((f) => typeof f === 'string' && f.length > 0)) {
      throw new Error('config.exclude must contain only non-empty strings');
    }
  }
  if (typeof cfg.insertBefore !== 'string' && typeof cfg.insertAfter !== 'string') {
    throw new Error('config.insertBefore or config.insertAfter (string) required');
  }
  if (cfg.commentSyntax !== 'html' && cfg.commentSyntax !== 'jsx') {
    throw new Error("config.commentSyntax must be 'html' or 'jsx'");
  }
  if (cfg.cspChecked !== undefined && typeof cfg.cspChecked !== 'boolean') {
    throw new Error("config.cspChecked, if present, must be a boolean");
  }
}

function commentOpen(syntax) { return syntax === 'jsx' ? '{/*' : '<!--'; }
function commentClose(syntax) { return syntax === 'jsx' ? '*/}' : '-->'; }

function buildTagBlock(syntax, port) {
  const open = commentOpen(syntax);
  const close = commentClose(syntax);
  return (
    open + ' ' + MARKER_OPEN_TEXT + ' ' + close + '\n' +
    '<script src="http://localhost:' + port + '/live.js"></script>\n' +
    open + ' ' + MARKER_CLOSE_TEXT + ' ' + close + '\n'
  );
}

function insertTag(content, config, port) {
  const block = buildTagBlock(config.commentSyntax, port);
  // insertBefore: match the LAST occurrence. Anchors like `</body>` naturally
  // belong at the end, and the same literal can appear earlier in code blocks
  // within rendered documentation pages.
  if (config.insertBefore) {
    const idx = content.lastIndexOf(config.insertBefore);
    if (idx === -1) return content;
    return content.slice(0, idx) + block + content.slice(idx);
  }
  // insertAfter: match the FIRST occurrence — typical anchors like `<head>` or
  // `<body>` open near the top of the document.
  const idx = content.indexOf(config.insertAfter);
  if (idx === -1) return content;
  const after = idx + config.insertAfter.length;
  // Preserve a single trailing newline if the anchor didn't end with one
  const prefix = content[after] === '\n' ? content.slice(0, after + 1) : content.slice(0, after) + '\n';
  return prefix + block + content.slice(prefix.length);
}

/**
 * Remove the live script block. Matches either HTML or JSX comment markers
 * regardless of config (so stale tags from a wrong config can still be cleaned).
 *
 * Indent-preserving: captures any whitespace immediately preceding the opener
 * marker and re-emits it in place of the removed block. `insertTag` inserted
 * the block *after* the original line's indent and *before* the anchor (e.g.
 * `</body>`), which moved the indent onto the opener line and left the anchor
 * unindented. Replacing the whole block (plus its trailing newline) with just
 * the captured indent hands the indent back to the anchor that follows.
 */
function removeTag(content, _syntax) {
  const patterns = [
    /([ \t]*)<!--\s*impeccable-live-start\s*-->[\s\S]*?<!--\s*impeccable-live-end\s*-->[ \t]*\n/,
    /([ \t]*)\{\/\*\s*impeccable-live-start\s*\*\/\}[\s\S]*?\{\/\*\s*impeccable-live-end\s*\*\/\}[ \t]*\n/,
  ];
  for (const pat of patterns) {
    const next = content.replace(pat, '$1');
    if (next !== content) return next;
  }
  return content;
}

// ---------------------------------------------------------------------------
// Auto-execute
// ---------------------------------------------------------------------------

const _running = process.argv[1];
if (_running?.endsWith('live-inject.mjs') || _running?.endsWith('live-inject.mjs/')) {
  injectCli();
}

export { insertTag, removeTag, validateConfig, buildTagBlock };
