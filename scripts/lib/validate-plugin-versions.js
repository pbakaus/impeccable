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

/** Pull the `version:` value out of a SKILL.md leading frontmatter block. */
export function readSkillFrontmatterVersion(content) {
  const fm = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return null;
  const line = fm[1].match(/^version:\s*(.+)$/m);
  return line ? line[1].trim().replace(/^['"]|['"]$/g, '') : null;
}

/**
 * Compare every version-bearing plugin/skill file against root plugin.json.
 *
 * @param {string} rootDir repository root
 * @returns {{ source: string|null, checked: Array<{relPath:string, found:any}>, mismatches: Array<{relPath:string, found:any, expected:string}> }}
 *   `source` is null when root plugin.json is absent (nothing to check).
 */
export function collectPluginVersions(rootDir) {
  const rootManifestPath = path.join(rootDir, '.claude-plugin/plugin.json');
  if (!fs.existsSync(rootManifestPath)) {
    return { source: null, checked: [], mismatches: [] };
  }
  const source = JSON.parse(fs.readFileSync(rootManifestPath, 'utf-8')).version;

  const checks = [
    {
      relPath: '.claude-plugin/marketplace.json',
      read: (absPath) => JSON.parse(fs.readFileSync(absPath, 'utf-8')).plugins?.[0]?.version,
    },
    {
      relPath: 'plugin/.claude-plugin/plugin.json',
      read: (absPath) => JSON.parse(fs.readFileSync(absPath, 'utf-8')).version,
    },
    {
      relPath: 'plugin/skills/impeccable/SKILL.md',
      read: (absPath) => readSkillFrontmatterVersion(fs.readFileSync(absPath, 'utf-8')),
    },
  ];

  const checked = [];
  const mismatches = [];
  for (const { relPath, read } of checks) {
    const absPath = path.join(rootDir, relPath);
    if (!fs.existsSync(absPath)) continue;
    const found = read(absPath);
    checked.push({ relPath, found });
    if (found !== source) mismatches.push({ relPath, found, expected: source });
  }

  return { source, checked, mismatches };
}
