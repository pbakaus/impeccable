/**
 * CLI helper: insert/remove the live variant mode script tag in the project's
 * main HTML entry point.
 *
 * On first live run, the agent generates `.impeccable/live/config.json`
 * with the project's insertion target (framework-specific). On
 * every subsequent run, this script handles insert/remove deterministically
 * with zero LLM involvement.
 *
 * Framework knowledge lives in `live/frameworks/` — detection order, adapters,
 * the generic tag strategy, and the per-extension authoring traits live-wrap
 * reads. This file is the CLI around it: resolve config, resolve the
 * framework, heal orphaned artifacts, apply or remove, record the journal.
 *
 * Usage:
 *   node live-inject.mjs --port PORT [--token TOKEN]  # Insert the live script tag
 *   node live-inject.mjs --remove                     # Remove the live script tag
 *   node live-inject.mjs --check                      # Check whether live config exists
 *
 * When --token is supplied, it is appended to the /live.js src as `?token=...`
 * so the server's token-gated /live.js handler will serve the bundle. Omitting
 * the token yields a bare `/live.js` src (legacy behavior; the server returns
 * 401 for it under the current gate).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveLiveConfigPath } from './lib/impeccable-paths.mjs';
import {
  describeInjectArtifacts,
  frameworkIgnorePatterns,
  resolveFramework,
  resolveSourceTraits,
} from './live/frameworks/index.mjs';
import {
  clearInjectJournal,
  healInjectJournal,
  recordInjection,
} from './live/frameworks/journal.mjs';
import {
  buildTagBlock,
  insertTag,
  patchCspMeta,
  removeTag,
  revertCspMeta,
} from './live/frameworks/tag-strategy.mjs';
import { buildLiveScriptSrc } from './live/frameworks/script-src.mjs';
import { enterLiveRoot } from './live/roots.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Resolved lazily so the enterLiveRoot() chdir in the CLI guard below takes
// effect first; module scope runs before the guard.
let CONFIG_PATH_CACHED = null;
function CONFIG_PATH_GET() {
  if (!CONFIG_PATH_CACHED) {
    CONFIG_PATH_CACHED = resolveLiveConfigPath({ cwd: process.cwd(), scriptsDir: __dirname });
  }
  return CONFIG_PATH_CACHED;
}
const IGNORE_MARKER_OPEN = '# impeccable-live-ignore-start';
const IGNORE_MARKER_CLOSE = '# impeccable-live-ignore-end';

export const LIVE_IGNORE_PATTERNS = Object.freeze([
  '.impeccable/hook.cache.json',
  '.impeccable/hook.pending.json',
  '.impeccable/config.local.json',
  '.impeccable/live/server.json',
  '.impeccable/live/roots.json',
  '.impeccable/live/app-root.json',
  '.impeccable/live/inject-journal.json',
  '.impeccable/live/sessions/',
  '.impeccable/live/previews/',
  '.impeccable/live/annotations/',
  '.impeccable/live/artifacts/',
  '.impeccable/live/accept-receipts/',
  '.impeccable/live/locks/',
  '.impeccable/live/cache/',
  '.impeccable/live/manual-edit-apply-transaction.json',
  '.impeccable/live/manual-edit-events.jsonl',
  '.impeccable/live/manual-edit-evidence/',
  '.impeccable/live/pending-manual-edits.json',
  '.impeccable/live/deferred-svelte-component-accepts.json',
  '.impeccable-live.json',
  '.impeccable-live/',
  'app/.impeccable-live/',
  'src/.impeccable-live/',
  'node_modules/.impeccable-live/',
  'src/lib/impeccable/ImpeccableLiveRoot.svelte',
  'src/lib/impeccable/__runtime.js',
  'src/lib/impeccable/[0-9a-f]*/',
  'plugins/impeccable-live.client.ts',
  'app/plugins/impeccable-live.client.ts',
  'src/plugins/impeccable-live.client.ts',
]);

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
Reads configuration from .impeccable/live/config.json.

Modes:
  --port PORT   Insert script tag pointing at http://localhost:PORT/live.js
  --remove      Remove the script tag (if present)
  --check       Print whether .impeccable/live/config.json exists and its content

Output (JSON):
  { ok, file, inserted|removed, config? }`);
    process.exit(0);
  }

  if (args.includes('--check')) {
    // Deliberately read-only: --check runs from status paths and must never
    // mutate the tree. Journal reconciliation happens on the inject run.
    if (!fs.existsSync(CONFIG_PATH_GET())) {
      console.log(JSON.stringify({ ok: false, error: 'config_missing', path: CONFIG_PATH_GET() }));
      process.exit(0);
    }
    let cfg;
    try {
      cfg = JSON.parse(fs.readFileSync(CONFIG_PATH_GET(), 'utf-8'));
    } catch (err) {
      console.log(JSON.stringify({ ok: false, error: 'config_invalid', message: err.message, path: CONFIG_PATH_GET() }));
      return;
    }
    try {
      validateConfig(cfg);
    } catch (err) {
      console.log(JSON.stringify({ ok: false, error: 'config_invalid', message: err.message, path: CONFIG_PATH_GET() }));
      return;
    }
    console.log(JSON.stringify({ ok: true, config: cfg, path: CONFIG_PATH_GET() }));
    return;
  }

  // Load config
  if (!fs.existsSync(CONFIG_PATH_GET())) {
    console.error(JSON.stringify({ ok: false, error: 'config_missing', path: CONFIG_PATH_GET() }));
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH_GET(), 'utf-8'));
  validateConfig(config);

  const cwd = process.cwd();
  const resolvedFiles = resolveFiles(cwd, config);
  const resolved = resolveFramework(cwd, config);
  const isAdapter = resolved?.framework.inject.kind === 'adapter';

  if (args.includes('--remove')) {
    if (isAdapter) {
      const adapterResult = resolved.framework.inject.remove({ cwd, config, project: resolved.project });
      const ok = !(adapterResult && adapterResult.error);
      // Anything the adapter could not reach (its detection may have shifted
      // since the session started) is still on the journal.
      const { healed } = healInjectJournal(cwd);
      clearInjectJournal(cwd);
      console.log(JSON.stringify({
        ok,
        adapter: resolved.framework.name,
        results: [adapterResult],
        healed: healed.length ? healed : undefined,
      }));
      if (!ok) process.exitCode = 1;
      return;
    }
    const results = resolvedFiles.map((relFile) => {
      const absFile = path.resolve(cwd, relFile);
      if (!fs.existsSync(absFile)) return { file: relFile, error: 'file_not_found' };
      const content = fs.readFileSync(absFile, 'utf-8');
      const detagged = removeTag(content, config.commentSyntax);
      const updated = revertCspMeta(detagged);
      if (updated === content) return { file: relFile, removed: false, note: 'no tag present' };
      fs.writeFileSync(absFile, updated, 'utf-8');
      return {
        file: relFile,
        removed: detagged !== content,
        cspReverted: updated !== detagged,
      };
    });
    const { healed } = healInjectJournal(cwd);
    clearInjectJournal(cwd);
    console.log(JSON.stringify({ ok: true, results, healed: healed.length ? healed : undefined }));
    return;
  }

  // Insert mode — need --port
  const portIdx = args.indexOf('--port');
  const port = portIdx !== -1 ? parseInt(args[portIdx + 1], 10) : NaN;
  if (!Number.isFinite(port)) {
    console.error(JSON.stringify({ ok: false, error: 'missing_port' }));
    process.exit(1);
  }
  // Optional server token: appended to the /live.js src so the token-gated
  // /live.js handler authorizes the browser fetch. `live.mjs` always passes
  // it; a manual `--port`-only invocation reads the running helper's token
  // from server.json instead of writing an unauthenticated URL that 401s.
  const tokenIdx = args.indexOf('--token');
  let token = tokenIdx !== -1 ? args[tokenIdx + 1] : undefined;
  if (!token) {
    try {
      const info = JSON.parse(fs.readFileSync(path.join(cwd, '.impeccable', 'live', 'server.json'), 'utf-8'));
      // A record for a DIFFERENT port is a stale or foreign helper; its token
      // would 401 just the same, so only adopt a matching one.
      if (info?.token && Number(info.port) === port) token = info.token;
    } catch { /* no running helper recorded; keep legacy tokenless behavior */ }
  }

  // Reconcile before writing anything. Artifacts this run is about to own are
  // kept (so a repeat inject stays byte-idempotent); artifacts left behind by
  // a session that never got to stop are healed.
  const plannedArtifacts = describeInjectArtifacts(resolved, { cwd, files: resolvedFiles });
  const { healed } = healInjectJournal(cwd, { keep: plannedArtifacts.map((a) => a.path) });

  const gitIgnore = ensureLiveGitIgnores(cwd, frameworkIgnorePatterns(resolved));
  // In a nested-app repo the roots pointer lives at the REPO root, outside the
  // reach of the appRoot-relative ignore block above; give that directory its
  // own local excludes so the pointer (absolute host paths) never gets staged.
  try {
    const rootsManifest = JSON.parse(fs.readFileSync(path.join(cwd, '.impeccable', 'live', 'roots.json'), 'utf-8'));
    if (rootsManifest?.repoRoot && path.resolve(rootsManifest.repoRoot) !== path.resolve(cwd)) {
      ensureLiveGitIgnores(rootsManifest.repoRoot);
    }
  } catch { /* no manifest: single-root project */ }

  if (isAdapter) {
    const adapterResult = resolved.framework.inject.apply({
      cwd,
      port,
      token,
      config,
      project: resolved.project,
    });
    const ok = !(adapterResult && adapterResult.error);
    if (ok) recordInjection(cwd, { framework: resolved.framework.name, port, artifacts: plannedArtifacts });
    console.log(JSON.stringify({
      ok,
      port,
      adapter: resolved.framework.name,
      gitIgnore,
      results: [adapterResult],
      healed: healed.length ? healed : undefined,
    }));
    if (!ok) process.exitCode = 1;
    return;
  }

  const results = resolvedFiles.map((relFile) => {
    const absFile = path.resolve(cwd, relFile);
    if (!fs.existsSync(absFile)) return { file: relFile, error: 'file_not_found' };
    const content = fs.readFileSync(absFile, 'utf-8');
    const withoutOld = revertCspMeta(removeTag(content, config.commentSyntax));
    // Per-file, not per-project: a Vite app can hold an .astro partial, and a
    // framework project's entry template is often plain HTML.
    const scriptAttrs = resolveSourceTraits(relFile).injectScriptAttrs;
    const withTag = insertTag(withoutOld, config, port, token, scriptAttrs);
    if (withTag === withoutOld) {
      return { file: relFile, error: 'insertion_point_not_found', anchor: config.insertBefore || config.insertAfter };
    }
    const updated = patchCspMeta(withTag, port);
    fs.writeFileSync(absFile, updated, 'utf-8');
    return {
      file: relFile,
      inserted: true,
      cspPatched: updated !== withTag,
    };
  });
  const anyInserted = results.some((r) => r.inserted);
  const writtenFiles = new Set(results.filter((r) => r.inserted).map((r) => r.file));
  recordInjection(cwd, {
    framework: resolved?.framework.name,
    port,
    artifacts: plannedArtifacts.filter((a) => writtenFiles.has(a.path)),
  });
  console.log(JSON.stringify({
    ok: anyInserted,
    port,
    gitIgnore,
    results,
    healed: healed.length ? healed : undefined,
  }));
  if (!anyInserted) process.exit(1);
}

export function ensureLiveGitIgnores(cwd = process.cwd(), extraPatterns = []) {
  const target = resolveIgnoreTarget(cwd);
  const existing = fs.existsSync(target.path) ? fs.readFileSync(target.path, 'utf-8') : '';
  const block = [
    IGNORE_MARKER_OPEN,
    ...new Set([...LIVE_IGNORE_PATTERNS, ...extraPatterns]),
    IGNORE_MARKER_CLOSE,
  ].join('\n');
  const markerRe = new RegExp(`${escapeRegExp(IGNORE_MARKER_OPEN)}[\\s\\S]*?${escapeRegExp(IGNORE_MARKER_CLOSE)}`);

  let updated;
  if (markerRe.test(existing)) {
    updated = existing.replace(markerRe, block);
  } else {
    const prefix = existing.length === 0 ? '' : existing.endsWith('\n') ? existing : existing + '\n';
    updated = `${prefix}${prefix.endsWith('\n\n') || prefix === '' ? '' : '\n'}${block}\n`;
  }

  if (updated !== existing) {
    fs.mkdirSync(path.dirname(target.path), { recursive: true });
    fs.writeFileSync(target.path, updated, 'utf-8');
  }

  return {
    file: path.relative(cwd, target.path).split(path.sep).join('/'),
    mode: target.mode,
    changed: updated !== existing,
    patterns: [...new Set([...LIVE_IGNORE_PATTERNS, ...extraPatterns])],
  };
}

function resolveIgnoreTarget(cwd) {
  const gitExcludePath = resolveGitInfoExcludePath(cwd);
  if (gitExcludePath) {
    return { path: gitExcludePath, mode: 'git-info-exclude' };
  }
  return { path: path.join(cwd, '.gitignore'), mode: 'gitignore' };
}

function resolveGitInfoExcludePath(cwd) {
  const dotGit = path.join(cwd, '.git');
  if (!fs.existsSync(dotGit)) return null;

  const stat = fs.statSync(dotGit);
  if (stat.isDirectory()) return path.join(dotGit, 'info', 'exclude');
  if (!stat.isFile()) return null;

  const body = fs.readFileSync(dotGit, 'utf-8').trim();
  const match = body.match(/^gitdir:\s*(.+)$/i);
  if (!match) return null;
  const gitDir = path.isAbsolute(match[1]) ? match[1] : path.resolve(cwd, match[1]);
  return path.join(gitDir, 'info', 'exclude');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

// ---------------------------------------------------------------------------
// Auto-execute
// ---------------------------------------------------------------------------

const _running = process.argv[1];
if (_running?.endsWith('live-inject.mjs') || _running?.endsWith('live-inject.mjs/')) {
  enterLiveRoot();
  injectCli();
}

// Re-exported so long-standing importers (live.mjs, the adapter modules, the
// test suites) keep their entry points while the implementations live in
// live/frameworks/.
export {
  buildLiveScriptSrc,
  buildTagBlock,
  insertTag,
  patchCspMeta,
  removeTag,
  revertCspMeta,
  validateConfig,
};
export {
  applyNuxtLiveAdapter,
  buildNuxtPlugin,
  detectNuxtProject,
  removeNuxtLiveAdapter,
} from './live/frameworks/nuxt.mjs';
