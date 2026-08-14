/**
 * The project-source walk shared by live-wrap.mjs and live-accept.mjs.
 *
 * Both scripts need the same thing: find the one project file containing a
 * string (wrap looks for the element's class/id/text, accept looks for the
 * session's `impeccable-variants-start` marker). They had two near-identical
 * copies of the walk, and the copies drifted — same `EXTENSIONS` array declared
 * twice, same `searchDirs` array declared twice, one `realpathSync` guarded by
 * try/catch and the other not. That drift is what #374 had to patch in two
 * places at once.
 *
 * Callers differ only in how they reject a candidate, so that is the one thing
 * this module takes as options (`skipDirs`, `fileFilter`).
 */

import fs from 'node:fs';
import path from 'node:path';
import { IMPECCABLE_DIR } from '../lib/impeccable-paths.mjs';
import { matchesTemplateExtension } from '../lib/template-extensions.mjs';

/**
 * Privileged roots, searched in order, before the catch-all `.` walk.
 *
 * `lib` is here for Phoenix, whose templates live in `lib/my_app_web/`. It is
 * an ordering preference rather than a reachability fix: `.` already recurses
 * into `lib`, so the real #374 bug was the extension list, not this array.
 */
export const SOURCE_SEARCH_DIRS = Object.freeze([
  'src', 'app', 'pages', 'components', 'public', 'views', 'templates', 'lib', '.',
]);

/**
 * Directories that are never project source.
 *
 * `.impeccable` is the critical entry, and it is not cosmetic. Progressive
 * publication stages each revision as `.impeccable/live/artifacts/
 * <id>-r<n>.<source-ext>`, and those artifacts carry the very marker accept
 * searches for. The walk reaches `.` for any project whose source is not under
 * one of the privileged roots above (this repo's own site lives in
 * `site/pages/`), and dot-directories sort before letters, so the artifact was
 * found *before* the real file. isGeneratedFile then declined the accept, and
 * the agent fell back to carbonizing several hundred lines of stylesheet by
 * hand.
 */
export const NEVER_SOURCE_DIRS = Object.freeze(['node_modules', '.git', IMPECCABLE_DIR]);

const MAX_DEPTH = 5;

/**
 * Walk the project for the first template file whose contents include `query`.
 *
 * @param {object} opts
 * @param {string} opts.query        substring to find in file contents
 * @param {string} opts.cwd          project root
 * @param {string[]} opts.extensions filename suffixes that count as templates
 * @param {Iterable<string>} [opts.skipDirs] directory names never to descend into
 * @param {(filePath: string) => boolean} [opts.fileFilter] return false to reject a candidate
 * @returns {string|null} absolute path of the first match
 */
export function findSourceFile({ query, cwd, extensions, skipDirs = NEVER_SOURCE_DIRS, fileFilter }) {
  const skip = new Set(skipDirs);
  const seen = new Set();
  for (const dir of SOURCE_SEARCH_DIRS) {
    const absDir = path.join(cwd, dir);
    if (!fs.existsSync(absDir)) continue;
    const result = walk(absDir, query, extensions, skip, fileFilter, seen, 0);
    if (result) return result;
  }
  return null;
}

function walk(dir, query, extensions, skip, fileFilter, seen, depth) {
  if (depth > MAX_DEPTH) return null;
  // A broken symlink anywhere in the tree used to throw straight out of
  // live-wrap's copy of this walk, killing the whole wrap.
  let realDir;
  try { realDir = fs.realpathSync(dir); } catch { return null; }
  if (seen.has(realDir)) return null;
  seen.add(realDir);

  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return null; }

  // Files before directories: a match in the current directory beats one
  // nested deeper.
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!matchesTemplateExtension(entry.name, extensions)) continue;
    const filePath = path.join(dir, entry.name);
    if (fileFilter && !fileFilter(filePath)) continue;
    try {
      if (fs.readFileSync(filePath, 'utf-8').includes(query)) return filePath;
    } catch { /* unreadable, skip */ }
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (skip.has(entry.name)) continue;
    const result = walk(path.join(dir, entry.name), query, extensions, skip, fileFilter, seen, depth + 1);
    if (result) return result;
  }

  return null;
}
