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
 * that SKILL.md's Setup step 1 already carries as a fallback: the runtime
 * shows the skill's loaded base directory when it loads the skill, and
 * scripts resolve against that.
 */

// The resolved {{scripts_path}} in dist/claude-code output, fixed by the
// Claude Code transformer's configDir (.claude) + skill name (impeccable).
export const CLAUDE_PROJECT_SCRIPTS_PATH = '.claude/skills/impeccable/scripts';

export const PLUGIN_SCRIPTS_PATH = '<skill-base-dir>/scripts';

// The project-path rule pre-approves a path inside the user's project, the
// one place the plugin must NOT run scripts from. Claude Code Bash rules
// support mid-pattern wildcards, so scope approval to the skill's own
// scripts directory wherever the plugin cache puts it.
export const PLUGIN_ALLOWED_TOOLS_RULE = 'Bash(node */skills/impeccable/scripts/*)';

// Setup step 1's parenthetical describes the base-dir form as a fallback.
// In the plugin copy that form is the primary (and only) form, so the
// parenthetical becomes the definition of the token every instruction uses.
const SETUP_FALLBACK_TEXT =
  "(if the runtime shows this skill's loaded base directory, run `node <skill-base-dir>/scripts/context.mjs`; keep cwd at the user's project)";
const SETUP_PLUGIN_TEXT =
  "(`<skill-base-dir>` is this skill's loaded base directory, shown by the runtime when it loads the skill; keep cwd at the user's project)";

/**
 * Rewrite one markdown file's content for the plugin subtree. Pure, so the
 * unit suite can pin every rewrite without a build.
 */
export function rewritePluginMarkdown(content) {
  return content
    // Order matters: the allowed-tools rule contains the project path, so
    // rewrite it before the generic path replacement turns it into a
    // rule that matches nothing.
    .replaceAll(`Bash(node ${CLAUDE_PROJECT_SCRIPTS_PATH}/*)`, PLUGIN_ALLOWED_TOOLS_RULE)
    .replaceAll(SETUP_FALLBACK_TEXT, SETUP_PLUGIN_TEXT)
    .replaceAll(CLAUDE_PROJECT_SCRIPTS_PATH, PLUGIN_SCRIPTS_PATH);
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
