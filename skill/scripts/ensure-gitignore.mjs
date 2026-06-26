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

export const GITIGNORE_MARKER_OPEN = '# impeccable-ignore-start';
export const GITIGNORE_MARKER_CLOSE = '# impeccable-ignore-end';

export const GITIGNORE_PATTERNS = Object.freeze([
  '# Ephemeral output, runtime state, and per-dev overrides.',
  '# Shared artifacts stay tracked: config.json, live/config.json,',
  '# design.json, critique/*.md.',
  '/.impeccable/config.local.json',
  '/.impeccable/hook.cache.json',
  '/.impeccable/hook.pending.json',
  '/.impeccable/*.png',
  '/.impeccable/live/server.json',
  '/.impeccable/live/sessions/',
  '/.impeccable/live/previews/',
  '/.impeccable/live/annotations/',
  '/.impeccable/live/cache/',
  '/.impeccable/live/manual-edit-apply-transaction.json',
  '/.impeccable/live/manual-edit-events.jsonl',
  '/.impeccable/live/manual-edit-evidence/',
  '/.impeccable/live/pending-manual-edits.json',
  '/.impeccable/live/deferred-svelte-component-accepts.json',
  '/.impeccable/live/*.png',
]);

const TRACKED_ARTIFACTS = Object.freeze([
  '.impeccable/config.json',
  '.impeccable/live/config.json',
  '.impeccable/design.json',
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
 * Paths that are currently tracked in git but would be covered by our block.
 * Returned so the caller (agent) can warn the user that adding the block will
 * NOT retroactively untrack an already-committed file — `git rm --cached` is
 * needed for that.
 */
function detectTrackedArtifacts(repoRoot) {
  const out = [];
  for (const rel of TRACKED_ARTIFACTS) {
    const abs = path.join(repoRoot, rel);
    if (fs.existsSync(abs)) out.push(rel);
  }
  return out;
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
  default: { ok, file, changed, mode, patterns }
  --check: { ok, file, present, stale, patterns, tracked }`);
    process.exit(0);
  }

  if (args.includes('--check')) {
    const result = checkImpeccableGitignore(process.cwd());
    const tracked = detectTrackedArtifacts(resolveRepoRoot(process.cwd()));
    console.log(JSON.stringify({ ...result, tracked }, null, 2));
  } else {
    const result = ensureImpeccableGitignore(process.cwd());
    const tracked = detectTrackedArtifacts(resolveRepoRoot(process.cwd()));
    console.log(JSON.stringify({ ...result, tracked }, null, 2));
  }
}
