import fs from 'fs';
import path from 'path';

/**
 * Rewrite project-relative script paths for the plugin subtree (issue #523).
 *
 * The ./plugin subtree is a verbatim copy of the dist/claude-code output,
 * where {{scripts_path}} resolves to `.claude/skills/impeccable/scripts`,
 * a path relative to the user's project. Run from the plugin cache, that
 * path points at whatever the project has installed: a plugin-only user
 * gets MODULE_NOT_FOUND, and a dual-install user silently runs the
 * project's (possibly older) skill copy.
 *
 * There is no literal path that works for plugins (CLAUDE_PLUGIN_ROOT is
 * hook-only), so the plugin's markdown uses the `<skill-base-dir>` form
 * SKILL.md's Setup step 1 already leads with: the runtime shows the
 * skill's loaded base directory when it loads the skill, and scripts
 * resolve against that.
 */

// The resolved {{scripts_path}} in dist/claude-code output, fixed by the
// Claude Code transformer's configDir (.claude) + skill name (impeccable).
export const CLAUDE_PROJECT_SCRIPTS_PATH = '.claude/skills/impeccable/scripts';

export const PLUGIN_SCRIPTS_PATH = '<skill-base-dir>/scripts';

// The project-path rule pre-approves a path inside the user's project, the
// one place the plugin must NOT run scripts from. No replacement rule
// exists: a wildcard pattern such as `node */skills/impeccable/scripts/*`
// auto-approves any same-shaped path anywhere on disk, and frontmatter has
// no variable bound to the loaded plugin root (CLAUDE_PLUGIN_ROOT is
// hook-only). The plugin copy drops the rule and script runs go through
// the normal Bash confirmation.
export const PROJECT_ALLOWED_TOOLS_LINE = `  - Bash(node ${CLAUDE_PROJECT_SCRIPTS_PATH}/*)\n`;

// Setup step 1's second sentence names the project path as the fallback
// when the runtime reports no base directory. A plugin install has no
// working project fallback (that path is the bug this rewrite exists to
// fix), and every instruction in the plugin copy already carries the
// token, so the sentence loses its fallback clause.
const SETUP_FALLBACK_TEXT =
  'That base directory resolves every `node .claude/skills/impeccable/scripts/...` command in this skill and its references, ' +
  'and `.claude/skills/impeccable/scripts` is the fallback only when the runtime reports no base directory.';
const SETUP_PLUGIN_TEXT =
  'Every `node "<skill-base-dir>/scripts/..."` command in this skill and its references resolves against that base directory.';

/**
 * Rewrite one markdown file's content for the plugin subtree. Pure, so the
 * unit suite can pin every rewrite without a build.
 */
export function rewritePluginMarkdown(content) {
  return content
    // Order matters: the allowed-tools line contains the project path, so
    // remove it before the generic path replacement rewrites it into a
    // line the removal no longer matches.
    .replaceAll(PROJECT_ALLOWED_TOOLS_LINE, '')
    .replaceAll(SETUP_FALLBACK_TEXT, SETUP_PLUGIN_TEXT)
    .replaceAll(CLAUDE_PROJECT_SCRIPTS_PATH, PLUGIN_SCRIPTS_PATH)
    // <skill-base-dir> expands to a real path at run time, and an unquoted
    // path with spaces splits before node sees it. Quote every command's
    // script argument, including the token-form commands SKILL.src.md
    // carries natively (Setup step 1). Runs after the path replacement so
    // one pattern covers both origins; already-quoted forms don't match.
    .replace(/node <skill-base-dir>\/scripts\/([^\s`"]+)/g, 'node "<skill-base-dir>/scripts/$1"');
}

/**
 * Fail the build when the copied SKILL.md no longer matches the rewrite.
 * The fallback-sentence replacement keys on the exact Setup step 1 text; if
 * SKILL.src.md rewords it, replaceAll silently no-ops and the plugin ships
 * the project path as its fallback. Loud beats wrong: the build stops here
 * so plugin-paths.js gets updated alongside the source.
 */
export function verifyPluginSkillRewrite(skillMdPath) {
  const content = fs.readFileSync(skillMdPath, 'utf-8');
  if (!content.includes(SETUP_PLUGIN_TEXT)) {
    throw new Error(
      `Plugin rewrite drift: ${skillMdPath} is missing the <skill-base-dir> resolution sentence. ` +
      "SKILL.src.md's Setup step 1 fallback sentence no longer matches the replacement in " +
      'scripts/lib/plugin-paths.js (issue #523); update SETUP_FALLBACK_TEXT to the new wording.',
    );
  }
  if (content.includes('Bash(node ')) {
    throw new Error(
      `Plugin rewrite drift: ${skillMdPath} still pre-approves a node script path. ` +
      "SKILL.src.md's allowed-tools entry no longer matches the removal in " +
      'scripts/lib/plugin-paths.js (issue #523); the plugin ships no node pre-approval.',
    );
  }
  if (content.includes(CLAUDE_PROJECT_SCRIPTS_PATH)) {
    throw new Error(
      `Plugin rewrite drift: ${skillMdPath} still contains the project-relative scripts path ` +
      `(${CLAUDE_PROJECT_SCRIPTS_PATH}). A wording or path shape in SKILL.src.md slipped past ` +
      'the replacements in scripts/lib/plugin-paths.js (issue #523); the plugin copy must not ' +
      "reference the project's scripts directory.",
    );
  }
}

/**
 * Apply rewritePluginMarkdown to every .md file under dir, recursively.
 * Script files are left alone: the only project-relative paths in them
 * (hook-admin.mjs) install project-scoped hooks via ${CLAUDE_PROJECT_DIR},
 * which is that command's actual job.
 */
export function rewritePluginMarkdownTree(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      rewritePluginMarkdownTree(entryPath);
    } else if (entry.name.endsWith('.md')) {
      const original = fs.readFileSync(entryPath, 'utf-8');
      const rewritten = rewritePluginMarkdown(original);
      if (rewritten !== original) fs.writeFileSync(entryPath, rewritten);
    }
  }
}
