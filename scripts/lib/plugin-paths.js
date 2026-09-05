import fs from 'fs';
import path from 'path';
import { generateYamlFrontmatter, parseFrontmatter } from './utils.js';

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
 * No literal path survives installation (the plugin cache location varies
 * per machine and per plugin version), so skill and reference markdown
 * uses the `<skill-base-dir>` form SKILL.md's Setup step 1 already leads
 * with: the runtime shows the skill's loaded base directory when it loads
 * the skill, and scripts resolve against that. Agent files cannot use the
 * token (a spawned agent never loads SKILL.md) and get the
 * ${CLAUDE_PLUGIN_ROOT} variable instead; see PLUGIN_AGENT_SCRIPTS_PATH.
 */

// The resolved {{scripts_path}} in dist/claude-code output, fixed by the
// Claude Code transformer's configDir (.claude) + skill name (impeccable).
export const CLAUDE_PROJECT_SCRIPTS_PATH = '.claude/skills/impeccable/scripts';

export const PLUGIN_SCRIPTS_PATH = '<skill-base-dir>/scripts';

// Claude Code requires user consent to activate a skill whose frontmatter
// declares allowed-tools; non-interactive hosts (`claude -p`) cannot provide
// it and the skill silently degrades (issue #736). The plugin copy drops the
// key via structured frontmatter rewrite, not regex.
export const PROJECT_ALLOWED_TOOLS_LINE = `  - Bash(${CLAUDE_PROJECT_SCRIPTS_PATH}/impeccable *)\n`;

function stripAllowedToolsFrontmatter(content) {
  const { frontmatter, body } = parseFrontmatter(content);
  if (frontmatter['allowed-tools'] === undefined) return content;
  delete frontmatter['allowed-tools'];
  return `${generateYamlFrontmatter(frontmatter)}\n${body}`;
}

// Setup step 1's second sentence names the project path as the fallback
// when the runtime reports no base directory. A plugin install has no
// working project fallback (that path is the bug this rewrite exists to
// fix), and every instruction in the plugin copy already carries the
// token, so the sentence loses its fallback clause.
const SETUP_FALLBACK_TEXT =
  'That base directory resolves every `.claude/skills/impeccable/scripts/impeccable <verb>` command in this skill and its references, ' +
  'and `.claude/skills/impeccable/scripts` is the fallback only when the runtime reports no base directory.';
const SETUP_PLUGIN_TEXT =
  'Every `"<skill-base-dir>/scripts/impeccable" <verb>` command in this skill and its references resolves against that base directory.';

// Agent files are subagent system prompts: a spawned agent never loads
// SKILL.md, so Setup's <skill-base-dir> token is undefined in the one
// context that must act on it (review finding). Claude Code substitutes
// ${CLAUDE_PLUGIN_ROOT} inline anywhere in plugin skill and agent content
// per the substitution table in code.claude.com/docs/en/plugins-reference.
// (anthropics/claude-code#65768 observed subagents receiving the literal;
// it was auto-closed stale and the docs table postdates it. Frontmatter
// still has no variable, which is why the node pre-approval is dropped
// rather than rewritten.) Grok Build reads this same subtree with its own
// substitution behavior, so the embed instruction carries a sidecar
// fallback for any harness that hands the agent the unexpanded literal.
export const PLUGIN_AGENT_SCRIPTS_PATH = '${CLAUDE_PLUGIN_ROOT}/skills/impeccable/scripts';

// Appended as its own sentence after the agent's embed instruction so
// behavior is defined even where the variable reaches the agent
// unexpanded: the prompt survives as a sidecar and the manifest tells the
// parent, whose own thread can resolve the script and embed it properly.
export const AGENT_EMBED_FALLBACK =
  ' When that script path is unreachable in your environment, write the same prompt to ' +
  '`<asset>.prompt.txt` beside the asset and note it in your manifest so the parent can embed it.';

/**
 * Rewrite one markdown file's content for the plugin subtree. Pure, so the
 * unit suite can pin every rewrite without a build.
 */
export function rewritePluginMarkdown(content) {
  return stripAllowedToolsFrontmatter(content)
    .replaceAll(PROJECT_ALLOWED_TOOLS_LINE, '')
    .replaceAll(SETUP_FALLBACK_TEXT, SETUP_PLUGIN_TEXT)
    .replaceAll(CLAUDE_PROJECT_SCRIPTS_PATH, PLUGIN_SCRIPTS_PATH)
    // <skill-base-dir> expands to a real path at run time, and an unquoted
    // path with spaces splits before node sees it. Quote every command's
    // script argument, including the token-form commands SKILL.src.md
    // carries natively (Setup step 1). Runs after the path replacement so
    // one pattern covers both origins; already-quoted forms don't match.
    .replace(/node <skill-base-dir>\/scripts\/([^\s`"]+)/g, 'node "<skill-base-dir>/scripts/$1"')
    // The engine launcher is the command itself now (`<skill-base-dir>/scripts/impeccable <verb>`,
    // or `impeccable.cmd` on a Windows shell without sh), so the launcher path
    // is what gets quoted; the verb and its arguments follow unquoted.
    .replace(/(?<!["\w/])<skill-base-dir>\/scripts\/impeccable(\.cmd)?(?=[\s`])/g, '"<skill-base-dir>/scripts/impeccable$1"');
}

/**
 * Rewrite one agent file's content for the plugin subtree. Same quoting
 * discipline as the skill rewrite, but the path is the plugin-root
 * variable rather than the skill-base-dir token SKILL.md defines,
 * because no SKILL.md travels with a spawned agent.
 */
export function rewritePluginAgentMarkdown(content) {
  return content
    .replaceAll(CLAUDE_PROJECT_SCRIPTS_PATH, PLUGIN_AGENT_SCRIPTS_PATH)
    .replace(
      /node \$\{CLAUDE_PLUGIN_ROOT\}\/skills\/impeccable\/scripts\/([^\s`"]+)/g,
      'node "${CLAUDE_PLUGIN_ROOT}/skills/impeccable/scripts/$1"',
    )
    // Anchors on the command this rewrite just produced plus the rest of
    // its sentence, so the fallback lands as the following sentence rather
    // than splicing into the middle of one.
    .replace(
      /(`node "\$\{CLAUDE_PLUGIN_ROOT\}\/skills\/impeccable\/scripts\/embed-prompt\.mjs"[^`]*`[^.]*\.)/g,
      `$1${AGENT_EMBED_FALLBACK}`,
    );
}

/**
 * Fail the build when an agent file's rewrite no longer holds: a
 * project-relative scripts path or the skill-base-dir token survived, or
 * an embed instruction lost its unexpanded-variable fallback because the
 * source sentence the anchor keys on was reworded. Loud beats a silent
 * no-op, same contract as verifyPluginSkillRewrite.
 */
export function verifyPluginAgentRewrite(agentPath) {
  const content = fs.readFileSync(agentPath, 'utf-8');
  if (content.includes(CLAUDE_PROJECT_SCRIPTS_PATH) || content.includes('<skill-base-dir>')) {
    throw new Error(
      `Plugin rewrite drift: ${agentPath} references a scripts path a spawned agent cannot ` +
      'resolve (the project-relative form or the <skill-base-dir> token). Agent files must ' +
      'carry the ${CLAUDE_PLUGIN_ROOT} form; see rewritePluginAgentMarkdown (issue #523).',
    );
  }
  if (content.includes('embed-prompt.mjs') && !content.includes(AGENT_EMBED_FALLBACK)) {
    throw new Error(
      `Plugin rewrite drift: ${agentPath} carries an embed instruction without the sidecar ` +
      "fallback sentence. The source sentence no longer matches the anchor in " +
      'scripts/lib/plugin-paths.js (issue #523); update the fallback anchor to the new wording.',
    );
  }
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
  if (parseFrontmatter(content).frontmatter['allowed-tools'] !== undefined) {
    throw new Error(
      `Plugin rewrite drift: ${skillMdPath} still declares allowed-tools in frontmatter. ` +
      'The plugin copy must drop the entire block so non-interactive sessions can activate ' +
      'the skill (issue #736); update the removal in scripts/lib/plugin-paths.js.',
    );
  }
  if (/Bash\((?:node |[^)]*scripts\/impeccable)/.test(content)) {
    throw new Error(
      `Plugin rewrite drift: ${skillMdPath} still pre-approves an engine launcher or node script path. ` +
      'A stray Bash(...) entry survived the allowed-tools removal in ' +
      'scripts/lib/plugin-paths.js (issue #523); the plugin ships no launcher pre-approval.',
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
 * Apply a rewrite to every .md file under dir, recursively. Defaults to
 * the skill rewrite; the agents directory passes rewritePluginAgentMarkdown.
 * Script files are left alone: the only project-relative paths in them
 * (hook-admin.mjs) install project-scoped hooks via ${CLAUDE_PROJECT_DIR},
 * which is that command's actual job.
 */
export function rewritePluginMarkdownTree(dir, rewrite = rewritePluginMarkdown) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      rewritePluginMarkdownTree(entryPath, rewrite);
    } else if (entry.name.endsWith('.md')) {
      const original = fs.readFileSync(entryPath, 'utf-8');
      const rewritten = rewrite(original);
      if (rewritten !== original) fs.writeFileSync(entryPath, rewritten);
    }
  }
}
