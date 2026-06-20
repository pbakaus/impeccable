/**
 * Plugin/skill version-drift detection (issue #274).
 *
 * The Claude Code marketplace installs from the committed `./plugin` subtree,
 * so any version disagreement between the hand-edited manifests and the
 * generated subtree ships stale content reporting a wrong version. Root
 * `.claude-plugin/plugin.json` is the single source of truth (build() reads
 * skillsVersion from it). Every other version-bearing file must match it:
 *
 *   - `.claude-plugin/marketplace.json` plugins[0].version — hand-edited
 *     alongside plugin.json; the post-merge sync workflow can't repair a
 *     mismatch here because it never bumps versions.
 *   - `plugin/.claude-plugin/plugin.json` version — generated, derived from
 *     root at build:release; checked so a bump that forgets to regenerate the
 *     subtree fails loudly instead of merging a drift window onto main.
 *   - `plugin/skills/impeccable/SKILL.md` frontmatter version — generated;
 *     same rationale.
 *
 * The collector is pure (filesystem-in, data-out) so it can be unit-tested
 * against fixtures; build.js owns the logging and the non-zero exit.
 */
import fs from 'fs';
import path from 'path';

/**
 * Pull the `version:` value out of a SKILL.md leading frontmatter block.
 * CRLF-tolerant (`\r?\n`) to match the shared parseFrontmatter in
 * scripts/lib/utils.js — a bundle saved with CRLF line endings must not read
 * as a null version and trip a false mismatch. `(.+)` stops at the line
 * terminator (so a trailing `\r` is excluded), and `.trim()` mops up the rest.
 */
export function readSkillFrontmatterVersion(content) {
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return null;
  const line = fm[1].match(/^version:\s*(.+)/m);
  return line ? line[1].trim().replace(/^['"]|['"]$/g, '') : null;
}

/**
 * Read a file and extract a value, turning read/parse failures into a clean
 * sentinel instead of a raw throw. A version bump is exactly the moment a
 * manifest is half-edited, so a malformed file must produce an actionable
 * diagnostic naming the file, not a stack trace out of build().
 *
 * @returns {{ value: any } | { error: string }}
 */
function extractFromFile(absPath, extract) {
  let raw;
  try {
    raw = fs.readFileSync(absPath, 'utf-8');
  } catch (err) {
    return { error: `could not read file (${err.code || err.message})` };
  }
  try {
    return { value: extract(raw) };
  } catch (err) {
    return { error: `could not parse (${err.message})` };
  }
}

/**
 * Compare every version-bearing plugin/skill file against root plugin.json.
 *
 * @param {string} rootDir repository root
 * @returns {{
 *   source: string|null,
 *   checked: Array<{relPath:string, found:any}>,
 *   mismatches: Array<{relPath:string, found:any, expected:string}>,
 *   errors: Array<{relPath:string, reason:string}>,
 * }}
 *   `source` is null only when root plugin.json is absent (nothing to check).
 *   A present-but-malformed root, or one missing its `version` field, instead
 *   reports an entry in `errors` so the build fails loudly rather than passing.
 */
export function collectPluginVersions(rootDir) {
  const rootRel = '.claude-plugin/plugin.json';
  const rootManifestPath = path.join(rootDir, rootRel);
  const empty = { source: null, checked: [], mismatches: [], errors: [] };
  if (!fs.existsSync(rootManifestPath)) return empty;

  const rootResult = extractFromFile(rootManifestPath, (raw) => JSON.parse(raw).version);
  if (rootResult.error) {
    return { ...empty, errors: [{ relPath: rootRel, reason: rootResult.error }] };
  }
  const source = rootResult.value;
  if (source == null) {
    return { ...empty, errors: [{ relPath: rootRel, reason: 'missing "version" field' }] };
  }

  const checks = [
    {
      relPath: '.claude-plugin/marketplace.json',
      read: (raw) => JSON.parse(raw).plugins?.[0]?.version,
    },
    {
      relPath: 'plugin/.claude-plugin/plugin.json',
      read: (raw) => JSON.parse(raw).version,
    },
    {
      relPath: 'plugin/skills/impeccable/SKILL.md',
      read: (raw) => readSkillFrontmatterVersion(raw),
    },
  ];

  const checked = [];
  const mismatches = [];
  const errors = [];
  for (const { relPath, read } of checks) {
    const absPath = path.join(rootDir, relPath);
    if (!fs.existsSync(absPath)) continue;
    const result = extractFromFile(absPath, read);
    if (result.error) {
      errors.push({ relPath, reason: result.error });
      continue;
    }
    const found = result.value;
    checked.push({ relPath, found });
    if (found !== source) mismatches.push({ relPath, found, expected: source });
  }

  return { source, checked, mismatches, errors };
}
