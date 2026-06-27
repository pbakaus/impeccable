/**
 * Idempotently write a marked block of Impeccable ignore patterns to the
 * project's shared, COMMITTED .gitignore.
 *
 * Why the shared .gitignore (unlike ensureHookGitExcludes in hook-lib.mjs and
 * ensureLiveGitIgnores in live-inject.mjs, which both prefer .git/info/exclude):
 * init is the team-wide entry point, and the artifacts ignored here —
 * screenshots, transient session/preview/cache dirs, regenerable hook caches,
 * and the per-dev local config — are universal junk that no developer should
 * commit from any clone. .git/info/exclude is machine-local and never shared,
 * so a fresh clone would see every critique/polish screenshot as untracked
 * until the hook or live mode happens to run. Writing .gitignore at init time
 * fixes that for the whole team up front.
 *
 * Shared project artifacts are deliberately left TRACKED. Do NOT add these:
 *   .impeccable/config.json       (unified shared config)
 *   .impeccable/live/config.json  (framework wiring, written by init Step 6)
 *   .impeccable/design.json       (shared design spec)
 *   .impeccable/critique/*.md     (review reports)
 *
 * Usage:
 *   node ensure-gitignore.mjs            # write/update the block
 *   node ensure-gitignore.mjs --check    # report whether the block is present
 *
 * Output (JSON): { ok, file, changed, mode, patterns, tracked }
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const GITIGNORE_MARKER_OPEN = '# impeccable-ignore-start';
export const GITIGNORE_MARKER_CLOSE = '# impeccable-ignore-end';

// Patterns are intentionally UNANCHORED (no leading slash). In a monorepo the
// active project (and therefore .impeccable/) lives under a nested workspace
// path like apps/web/, while .gitignore is written at the repo root. Anchored
// patterns would only match a root-level .impeccable and miss the nested one.
// Unanchored patterns match at any depth, matching the convention already used
// by HOOK_LOCAL_IGNORE_PATTERNS (hook-lib.mjs) and LIVE_IGNORE_PATTERNS
// (live-inject.mjs). .impeccable is a reserved skill dir name, so matching it
// at any depth is safe.
export const GITIGNORE_PATTERNS = Object.freeze([
  '# Ephemeral output, runtime state, and per-dev overrides.',
  '# Unanchored: .impeccable may sit at the repo root or under a nested',
  '# workspace (apps/web/.impeccable/...); anchored patterns would miss it.',
  '# Shared artifacts stay tracked: config.json, live/config.json,',
  '# design.json, critique/*.md.',
  '.impeccable/config.local.json',
  '.impeccable/hook.cache.json',
  '.impeccable/hook.pending.json',
  '.impeccable/*.png',
  '.impeccable/live/server.json',
  '.impeccable/live/sessions/',
  '.impeccable/live/previews/',
  '.impeccable/live/annotations/',
  '.impeccable/live/cache/',
  '.impeccable/live/manual-edit-apply-transaction.json',
  '.impeccable/live/manual-edit-events.jsonl',
  '.impeccable/live/manual-edit-evidence/',
  '.impeccable/live/pending-manual-edits.json',
  '.impeccable/live/deferred-svelte-component-accepts.json',
  '.impeccable/live/*.png',
]);

// Paths inside .impeccable/ that are shared project artifacts and must STAY
// tracked. Expressed relative to the .impeccable directory so they apply
// whether .impeccable is at the repo root or nested under a workspace.
const SHARED_ARTIFACT_RELS = Object.freeze([
  'config.json',
  'live/config.json',
  'design.json',
]);

// Exact (non-glob) ephemeral paths inside .impeccable/, relative to .impeccable.
// Mirrors the ignore patterns above; keep in sync if patterns change.
const EPHEMERAL_EXACT_RELS = Object.freeze([
  'config.local.json',
  'hook.cache.json',
  'hook.pending.json',
  'live/server.json',
  'live/manual-edit-apply-transaction.json',
  'live/manual-edit-events.jsonl',
  'live/pending-manual-edits.json',
  'live/deferred-svelte-component-accepts.json',
]);

const EPHEMERAL_DIR_PREFIXES = Object.freeze([
  'live/sessions/',
  'live/previews/',
  'live/annotations/',
  'live/cache/',
  'live/manual-edit-evidence/',
]);

/**
 * Locate the repo root by walking up for a .git entry. Falls back to cwd.
 */
function resolveRepoRoot(cwd = process.cwd()) {
  let dir = path.resolve(cwd);
  while (true) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(cwd);
    dir = parent;
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$1');
}

function blockText() {
  return [GITIGNORE_MARKER_OPEN, ...GITIGNORE_PATTERNS, GITIGNORE_MARKER_CLOSE].join('\n');
}

function markerRegex() {
  return new RegExp(
    `${escapeRegExp(GITIGNORE_MARKER_OPEN)}[\\s\\S]*?${escapeRegExp(GITIGNORE_MARKER_CLOSE)}`,
  );
}

/**
 * Read the set of git-tracked files via `git ls-files -z`. Returns null when git
 * is unavailable or the dir is not a git repo (status != 0), so callers never
 * mistake a disk-present-but-untracked file for a committed one.
 */
function gitTrackedFiles(repoRoot) {
  try {
    const res = spawnSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf-8' });
    if (res.error) return null;
    if (typeof res.status === 'number' && res.status !== 0) return null;
    return res.stdout.split('\0').filter(Boolean);
  } catch {
    return null;
  }
}

/**
 * Given a repo-root-relative path, return the portion UNDER the nearest
 * .impeccable/ directory, or null if the path is not inside one. Works whether
 * .impeccable is at the repo root (e.g. ".impeccable/design.json") or nested in
 * a monorepo workspace (e.g. "apps/web/.impeccable/design.json" -> "design.json").
 */
function relWithinImpeccable(repoRelPath) {
  const parts = repoRelPath.split('/');
  const idx = parts.indexOf('.impeccable');
  if (idx === -1) return null;
  const rel = parts.slice(idx + 1).join('/');
  return rel === '' ? null : rel;
}

function isSharedArtifact(rel) {
  return SHARED_ARTIFACT_RELS.includes(rel) || rel.startsWith('critique/');
}

function isEphemeral(rel) {
  if (rel.endsWith('.png')) return true;
  if (EPHEMERAL_EXACT_RELS.includes(rel)) return true;
  return EPHEMERAL_DIR_PREFIXES.some((prefix) => rel.startsWith(prefix));
}

/**
 * Classify the git-tracked files that live inside any .impeccable/ directory.
 *
 * Returns { gitAvailable, tracked, needsUntrack }:
 *   - gitAvailable: false when `git ls-files` could not run (no git / not a
 *     repo); in that case both lists are empty and the caller should not claim
 *     anything about tracking.
 *   - tracked: shared artifacts (config.json, live/config.json, design.json,
 *     critique/*.md) that are confirmed committed and will stay tracked.
 *   - needsUntrack: ephemeral files (screenshots, config.local.json, runtime
 *     state under live/) that are already committed and now match the ignore
 *     block. These are the `git rm --cached <path>` candidates.
 *
 * Paths in both lists are repo-root-relative (e.g. "apps/web/.impeccable/foo.png").
 */
export function analyzeTracked(repoRoot) {
  const files = gitTrackedFiles(repoRoot);
  if (files === null) return { gitAvailable: false, tracked: [], needsUntrack: [] };
  const tracked = [];
  const needsUntrack = [];
  for (const repoRel of files) {
    const rel = relWithinImpeccable(repoRel);
    if (!rel) continue;
    if (isSharedArtifact(rel)) {
      tracked.push(repoRel);
    } else if (isEphemeral(rel)) {
      needsUntrack.push(repoRel);
    }
  }
  return { gitAvailable: true, tracked, needsUntrack };
}

/**
 * Write (or refresh) the marked ignore block in the shared .gitignore.
 * Returns { ok, file, changed, mode, patterns }.
 */
export function ensureImpeccableGitignore(cwd = process.cwd()) {
  try {
    const repoRoot = resolveRepoRoot(cwd);
    const targetPath = path.join(repoRoot, '.gitignore');
    const existing = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf-8') : '';
    const block = blockText();
    const re = markerRegex();

    let updated;
    if (re.test(existing)) {
      updated = existing.replace(re, block);
    } else {
      const prefix = existing.length === 0 ? '' : existing.endsWith('\n') ? existing : `${existing}\n`;
      const gap = prefix.length === 0 || prefix.endsWith('\n\n') ? '' : '\n';
      updated = `${prefix}${gap}${block}\n`;
    }

    const changed = updated !== existing;
    if (changed) {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, updated, 'utf-8');
    }

    return {
      ok: true,
      file: path.relative(path.resolve(cwd), targetPath).split(path.sep).join('/') || '.gitignore',
      changed,
      mode: 'gitignore',
      patterns: [...GITIGNORE_PATTERNS],
    };
  } catch (err) {
    return { ok: false, error: String(err?.message || err), changed: false, mode: 'error' };
  }
}

/**
 * Report whether the marked block is already present and consistent.
 * Returns { ok, file, present, stale, patterns }.
 */
export function checkImpeccableGitignore(cwd = process.cwd()) {
  const repoRoot = resolveRepoRoot(cwd);
  const targetPath = path.join(repoRoot, '.gitignore');
  if (!fs.existsSync(targetPath)) {
    return {
      ok: true,
      file: path.relative(path.resolve(cwd), targetPath).split(path.sep).join('/') || '.gitignore',
      present: false,
      stale: false,
      patterns: [...GITIGNORE_PATTERNS],
    };
  }
  const existing = fs.readFileSync(targetPath, 'utf-8');
  const re = markerRegex();
  const match = existing.match(re);
  return {
    ok: true,
    file: path.relative(path.resolve(cwd), targetPath).split(path.sep).join('/') || '.gitignore',
    present: !!match,
    stale: !!match && match[0] !== blockText(),
    patterns: [...GITIGNORE_PATTERNS],
  };
}

// CLI mode
const _running = process.argv[1];
const _isCli = _running && (_running.endsWith('ensure-gitignore.mjs') || _running.endsWith('ensure-gitignore.mjs/'));
if (_isCli) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage: node ensure-gitignore.mjs [options]

Write or refresh the Impeccable ignore block in the project's shared .gitignore.

Modes:
  (default)    Write/update the marked block (idempotent)
  --check      Report whether the block is present and current

Output (JSON):
  default: { ok, file, changed, mode, patterns, gitAvailable, tracked, needsUntrack }
  --check: { ok, file, present, stale, patterns, gitAvailable, tracked, needsUntrack }`);
    process.exit(0);
  }

  const analysis = analyzeTracked(resolveRepoRoot(process.cwd()));
  if (args.includes('--check')) {
    const result = checkImpeccableGitignore(process.cwd());
    console.log(JSON.stringify({ ...result, ...analysis }, null, 2));
  } else {
    const result = ensureImpeccableGitignore(process.cwd());
    console.log(JSON.stringify({ ...result, ...analysis }, null, 2));
  }
}
