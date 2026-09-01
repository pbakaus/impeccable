#!/usr/bin/env node
/**
 * Critique persistence helper.
 *
 * Each critique run writes a per-target snapshot to
 *   .impeccable/critique/<timestamp>__<slug>.md
 * with a small YAML frontmatter carrying the score + P0/P1 counts.
 *
 * The polish workflow reads the latest matching snapshot at start as its
 * fix backlog. No other skill auto-reads critique output.
 *
 * The slug is derived mechanically from the *resolved* primary artifact
 * (file path or URL), never from the user's natural-language phrasing.
 * Slug stability across runs is what lets the trend display work.
 *
 * CLI entry points (called from skill instructions):
 *   node critique-storage.mjs slug <resolved-target>
 *   node critique-storage.mjs write <slug> <snapshot-body-file>
 *   node critique-storage.mjs latest <slug>
 *   node critique-storage.mjs trend <slug> [limit]
 *   node critique-storage.mjs close <slug>
 *
 * Note: there is intentionally no `ignore` subcommand. ignore.md is a plain
 * markdown file; the model reads it directly with its file-read tool. This
 * helper only exists for operations the model can't trivially do inline
 * (normalizing paths, generating filenames, globbing + parsing frontmatter).
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getCritiqueDir } from './lib/impeccable-paths.mjs';
import { slugFromTarget } from './lib/target-slug.mjs';

export { slugFromTarget } from './lib/target-slug.mjs';

/**
 * Mechanically derive a slug from a resolved target. Returns null if the
 * input doesn't look like a stable identifier (empty, project root, etc).
 *
 * Accepts file paths and URLs. The model resolves "the homepage" to a
 * concrete artifact before calling this — we never slug a natural-language
 * phrase.
 */
/**
 * Filename-safe UTC ISO timestamp: hyphens for separators, trailing Z.
 * Plain colons aren't allowed on Windows filesystems.
 */
export function nowFilenameStamp(date = new Date()) {
  const iso = date.toISOString();           // 2026-05-12T18:30:00.123Z
  return iso.replace(/[:.]/g, '-').replace(/-\d+Z$/, 'Z');
}

/**
 * Return an exact content fingerprint for a local file target. URLs and
 * non-files return null because their content is not available here.
 *
 * The fingerprint deliberately describes bytes, not Git state or mtimes:
 * critique often assesses an uncommitted file, and a later polish run should
 * inherit that backlog when the bytes are unchanged regardless of staging.
 */
function resolveLocalTargetPath(target, { cwd = process.cwd() } = {}) {
  if (!target || /^https?:\/\//i.test(target)) return null;
  return path.isAbsolute(target) ? path.resolve(target) : path.resolve(cwd, target);
}

export function fingerprintTarget(target, { cwd = process.cwd() } = {}) {
  const filePath = resolveLocalTargetPath(target, { cwd });
  if (!filePath) return null;
  try {
    if (!fs.statSync(filePath).isFile()) return null;
    return `sha256:${createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')}`;
  } catch {
    return null;
  }
}

/**
 * Write a snapshot for `slug`. `meta` carries the small structured frontmatter
 * keys read back by readTrend(). `body` is the human-readable critique
 * report (everything below the frontmatter).
 *
 * Returns the absolute path written.
 */
export function writeSnapshot({ slug, meta, body, cwd = process.cwd(), now = new Date() }) {
  if (!slug) throw new Error('writeSnapshot requires a slug');
  const dir = getCritiqueDir(cwd);
  fs.mkdirSync(dir, { recursive: true });
  const timestamp = nowFilenameStamp(now);
  const filePath = path.join(dir, `${timestamp}__${slug}.md`);
  // Spread `meta` first so internally computed `timestamp` and `slug`
  // always win. Otherwise a caller-supplied meta blob (parsed from the
  // IMPECCABLE_CRITIQUE_META env var) could clobber them, leaving the
  // filename in disagreement with its frontmatter and corrupting trends.
  const front = serializeFrontmatter({ ...meta, timestamp, slug });
  fs.writeFileSync(filePath, `${front}\n${body.trim()}\n`, 'utf-8');
  return filePath;
}

function serializeFrontmatter(obj) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    const str = typeof value === 'string' ? value : String(value);
    // Quote strings that contain : or # to keep parsing simple.
    const needsQuotes = typeof value === 'string' && /[:#]/.test(str);
    lines.push(`${key}: ${needsQuotes ? JSON.stringify(str) : str}`);
  }
  lines.push('---');
  return lines.join('\n');
}

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const out = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if (/^".*"$/.test(value)) {
      try { value = JSON.parse(value); } catch { /* leave as-is */ }
    } else if (/^-?\d+$/.test(value)) {
      value = Number(value);
    } else if (value === 'true' || value === 'false') {
      value = value === 'true';
    }
    out[key] = value;
  }
  return out;
}

/**
 * Return snapshot files matching `suffix`, sorted oldest → newest.
 */
const SNAPSHOT_FILENAME = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z__.+\.md$/;

function listSnapshots(suffix, cwd) {
  const dir = getCritiqueDir(cwd);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => SNAPSHOT_FILENAME.test(f) && f.endsWith(suffix))
    .sort()
    .map((f) => path.join(dir, f));
}

function readSnapshot(filePath) {
  if (!filePath) return null;
  const body = fs.readFileSync(filePath, 'utf-8');
  return { path: filePath, body, meta: parseFrontmatter(body) };
}

/**
 * Return the most recent snapshot for `slug`, or null. Polish reads this
 * to find its fix backlog when the slug matches.
 */
export function readLatestSnapshot(slug, { cwd = process.cwd() } = {}) {
  const latest = readSnapshot(listSnapshots(`__${slug}.md`, cwd).at(-1));
  return latest?.meta.closed === true ? null : latest;
}

/**
 * Mark the newest snapshot for `slug` closed so `latest` is empty without
 * deleting the score history consumed by `trend`. A later write naturally
 * becomes the new live backlog. Returns the path marked closed, or null.
 */
export function closeSnapshot(slug, { cwd = process.cwd() } = {}) {
  const latest = readSnapshot(listSnapshots(`__${slug}.md`, cwd).at(-1));
  if (!latest || latest.meta.closed === true) return null;
  const closedBody = latest.body.replace(
    /^(---\r?\n[\s\S]*?)(\r?\n---)/,
    '$1\nclosed: true$2',
  );
  if (closedBody === latest.body) {
    throw new Error(`Cannot close snapshot without frontmatter: ${latest.path}`);
  }
  fs.writeFileSync(latest.path, closedBody, 'utf-8');
  return latest.path;
}

/** Return the most recent snapshot across all targets, or null. */
export function readLatestSnapshotAcrossTargets({ cwd = process.cwd() } = {}) {
  const latestBySlug = new Map();
  for (const filePath of listSnapshots('.md', cwd)) {
    const snapshot = readSnapshot(filePath);
    if (snapshot?.meta.slug) latestBySlug.set(snapshot.meta.slug, snapshot);
  }
  return [...latestBySlug.values()]
    .filter((snapshot) => snapshot.meta.closed !== true)
    .sort((a, b) => a.path.localeCompare(b.path))
    .at(-1) || null;
}

/**
 * Return the last `limit` snapshots' frontmatter, oldest → newest.
 * Critique appends a one-line trend to its output using this.
 */
export function readTrend(slug, { limit = 5, cwd = process.cwd() } = {}) {
  const all = listSnapshots(`__${slug}.md`, cwd);
  const slice = all.slice(-limit);
  return slice.map((file) => parseFrontmatter(fs.readFileSync(file, 'utf-8')));
}

// ---- CLI ---------------------------------------------------------------

// Accept either a ready slug or a concrete target (path/URL) everywhere, so
// callers never have to run the slug step separately. Anything containing a
// path or URL marker is resolved through slugFromTarget.
function isReadySlug(value) {
  return /^[a-z0-9-]+$/.test(value || '') && !value.includes('/');
}

function coerceSlug(value) {
  if (!value) return null;
  if (isReadySlug(value)) return value;
  return slugFromTarget(value);
}

function main(argv) {
  const [cmd, ...args] = argv;
  switch (cmd) {
    case 'slug': {
      const slug = slugFromTarget(args[0]);
      if (!slug) { process.stderr.write('no stable slug for input\n'); process.exit(1); }
      process.stdout.write(`${slug}\n`);
      return;
    }
    case 'write': {
      const [slugArg, bodyFile] = args;
      const slug = coerceSlug(slugArg);
      if (!slug || !bodyFile) { process.stderr.write('usage: write <slug-or-target> <body-file>\n'); process.exit(1); }
      const raw = fs.readFileSync(bodyFile, 'utf-8');
      // The body file may be a full report. The caller passes the meta as
      // a JSON object on stdin if it wants structured frontmatter; otherwise
      // we write with minimal metadata.
      let meta = {};
      const metaArg = process.env.IMPECCABLE_CRITIQUE_META;
      if (metaArg) {
        try { meta = JSON.parse(metaArg); } catch { /* ignore */ }
      }
      // The helper, not caller-provided metadata, owns the target fingerprint.
      // This makes the snapshot describe the exact file bytes critique saw.
      delete meta.target_fingerprint;
      delete meta.target_path;
      const targetFingerprint = fingerprintTarget(slugArg);
      if (targetFingerprint) {
        meta.target_fingerprint = targetFingerprint;
        meta.target_path = resolveLocalTargetPath(slugArg);
      }
      const out = writeSnapshot({ slug, meta, body: raw });
      process.stdout.write(`${out}\n`);
      return;
    }
    case 'latest': {
      const target = args[0];
      const slug = coerceSlug(target);
      const latest = readLatestSnapshot(slug);
      if (!latest) { process.exit(2); }
      const targetFingerprint = fingerprintTarget(target);
      const targetPath = resolveLocalTargetPath(target);
      const concreteLocalTarget = targetPath && (
        latest.meta.target_path === targetPath
        || !isReadySlug(target)
        || fs.existsSync(targetPath)
      );
      if (concreteLocalTarget && latest.meta.target_fingerprint !== targetFingerprint) {
        closeSnapshot(slug);
        process.exit(2);
      }
      process.stdout.write(latest.body);
      return;
    }
    case 'close': {
      const slug = coerceSlug(args[0]);
      if (!slug) { process.stderr.write('usage: close <slug-or-target>\n'); process.exit(1); }
      const closed = closeSnapshot(slug);
      if (!closed) { process.exit(2); }
      process.stdout.write(`${closed}\n`);
      return;
    }
    case 'trend': {
      const rows = readTrend(coerceSlug(args[0]), { limit: args[1] ? Number(args[1]) : 5 });
      process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
      return;
    }
    default:
      process.stderr.write('usage: critique-storage.mjs <slug|write|latest|trend|close> [args]\n');
      process.exit(1);
  }
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1]);
  } catch {
    // pathToFileURL normalizes Windows paths; keep it as a fallback for any
    // environment where realpath is unavailable.
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  }
}

// Why the realpath check: generated skills are often reached through symlinked
// harness directories (for example a demo repo's `.agents` -> source `.agents`).
// Node resolves import.meta.url to the real file, while process.argv[1] keeps
// the symlink path. Comparing canonical paths prevents a silent exit-0 no-op.
if (isMainModule()) {
  main(process.argv.slice(2));
}
