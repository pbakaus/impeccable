/**
 * Plugin manifest shape validation (PR #494).
 *
 * The Claude Code marketplace installs from the committed `./plugin` subtree,
 * and every key in its `.claude-plugin/plugin.json` is a claim about how
 * Claude Code's plugin loader behaves. Those claims are not checked by
 * `claude plugin validate` (it validates the marketplace manifest, not the
 * plugin manifest), and a wrong one fails silently: shipping an `agents` key
 * as an array of file paths made Claude Code load ZERO agents, while the
 * loader auto-discovers `agents/*.md` on its own when the key is absent. The
 * four shipped subagents were unreachable for every marketplace install and
 * nothing flagged it.
 *
 * This guard pins the verified contract:
 *
 *   - `KNOWN_LOADER_KEYS` is the set of keys confirmed to load correctly in a
 *     real Claude Code install (checked via the `claude plugin details`
 *     component inventory). A key outside the set fails the build until
 *     someone verifies it end to end and adds it here with a note.
 *   - The `agents` key must never appear. Omission is the only shape that
 *     works: an array of file paths loads zero agents, and a string or a
 *     directory entry fails the whole plugin.
 *   - Because omission means the files themselves are the only carrier, every
 *     agent in `skill/agents/` must have a shipped copy in `plugin/agents/`.
 *   - `skills` must keep the trailing-slash `./skills/` form (issue #86: the
 *     bare form fails to register slash commands).
 *
 * The collector is pure (filesystem-in, data-out) so it can be unit-tested
 * against fixtures; build.js owns the logging and the non-zero exit.
 */
import fs from 'fs';
import path from 'path';

/**
 * Keys verified against a live Claude Code install (2026-08, Claude Code
 * 2.1.220). Descriptive metadata keys pass through harmlessly; `skills` is
 * the one component path the loader reads from this manifest. Do not add a
 * component key (`agents`, `hooks`, `commands`, `mcpServers`, ...) without
 * installing the built subtree and confirming the component inventory in
 * `claude plugin details` counts every shipped piece.
 */
export const KNOWN_LOADER_KEYS = [
  'name',
  'description',
  'version',
  'author',
  'homepage',
  'repository',
  'skills',
];

function listMarkdown(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((file) => file.endsWith('.md')).sort();
}

/**
 * Validate the generated plugin manifest's shape against the verified loader
 * contract.
 *
 * @param {string} rootDir repository root
 * @returns {Array<{relPath:string, reason:string}>}
 *   Empty when the subtree is absent (nothing generated yet) or fully valid.
 */
export function collectPluginManifestFindings(rootDir) {
  const manifestRel = 'plugin/.claude-plugin/plugin.json';
  const manifestPath = path.join(rootDir, manifestRel);
  if (!fs.existsSync(manifestPath)) return [];

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch (err) {
    return [{ relPath: manifestRel, reason: `could not parse (${err.message})` }];
  }
  // JSON.parse accepts null, strings, numbers, and arrays; the key checks
  // below need a plain object, so anything else is a finding, not a crash.
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return [{
      relPath: manifestRel,
      reason: `manifest is ${Array.isArray(manifest) ? 'an array' : manifest === null ? 'null' : `a ${typeof manifest}`}, not a JSON object`,
    }];
  }

  const findings = [];

  if ('agents' in manifest) {
    findings.push({
      relPath: manifestRel,
      reason:
        'declares an "agents" key; Claude Code loads zero agents when it is present ' +
        'as file paths and fails the whole plugin on other shapes. Omit it and let ' +
        'the loader auto-discover plugin/agents/*.md (PR #494)',
    });
  }

  for (const key of Object.keys(manifest)) {
    if (key === 'agents') continue; // already reported with the specific fix
    if (!KNOWN_LOADER_KEYS.includes(key)) {
      findings.push({
        relPath: manifestRel,
        reason:
          `unverified manifest key "${key}"; confirm it loads in a real Claude Code ` +
          'install, then add it to KNOWN_LOADER_KEYS in scripts/lib/validate-plugin-manifest.js',
      });
    }
  }

  if (manifest.skills !== './skills/') {
    findings.push({
      relPath: manifestRel,
      reason:
        `"skills" is ${JSON.stringify(manifest.skills)}; must be "./skills/" ` +
        '(trailing-slash form, issue #86)',
    });
  }

  // With no `agents` key, shipped files are the only thing the loader sees.
  const sourceAgents = listMarkdown(path.join(rootDir, 'skill', 'agents'));
  const shippedAgents = listMarkdown(path.join(rootDir, 'plugin', 'agents'));
  for (const file of sourceAgents) {
    if (!shippedAgents.includes(file)) {
      findings.push({
        relPath: `plugin/agents/${file}`,
        reason:
          'missing from the plugin subtree; auto-discovery relies on the shipped ' +
          `file, so skill/agents/${file} would never load. Run \`bun run build:release\``,
      });
    }
  }

  return findings;
}
