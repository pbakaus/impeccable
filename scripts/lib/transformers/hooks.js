/**
 * Build-pipeline emitters for the Impeccable design hook.
 *
 * Two artifacts:
 *   1. hooks.json — per-provider hook manifest. PostToolUse shape is the same
 *      on both harnesses: one matcher group, no `if:` field. Claude's `if:`
 *      permission rule binds to a single tool name (`Edit(*.tsx)` never
 *      matches Write or MultiEdit), so extension filtering lives in the hook
 *      script on both sides.
 *   2. .codex-plugin/plugin.json — net-new Codex plugin manifest. Codex
 *      auto-discovers `hooks/hooks.json` from the plugin root, so the manifest
 *      itself is intentionally tiny (no `hooks` field — listing it there would
 *      trigger Codex's "duplicate hooks file detected" error, mirroring the
 *      Claude Code behavior).
 */

const HOOK_SCRIPT_REL = 'skills/impeccable/scripts/hook.mjs';
const SESSION_SCRIPT_REL = 'skills/impeccable/scripts/hook-session-start.mjs';

// Manifest copied verbatim from `dist/claude-code/.claude/hooks/` into the
// shared marketplace `plugin/hooks/` subtree by `scripts/build.js`. Codex
// installs the same plugin from our marketplace, so the manifest needs to be
// portable across both harnesses.
//
// **Shell form, not exec form.** We use `command: "node \"…path…\""` with
// the path embedded in the command string, not the exec form
// `command: "node", args: ["…path…"]`. Codex only substitutes the
// `${CLAUDE_PLUGIN_ROOT}` / `${PLUGIN_ROOT}` placeholders inside the
// `command` string; placeholders in `args` are passed through literally,
// which makes Node fail to resolve the script path. Every working hook in
// `claude-plugins-official` (posthog, hookify, etc.) uses shell form for
// exactly this reason. The quotes around the path keep us safe if the
// plugin root contains spaces.
//
// **One matcher group, scoped to direct-edit tools.** Claude Code
// Edit/Write/MultiEdit carry `tool_input.file_path`. Codex `apply_patch`
// carries the patch in `tool_input.command` (see Codex hooks docs); the
// hook script parses `*** Update File:` / `*** Add File:` lines from that
// body. Codex's `mcp__node_repl__*` tools can also mutate files
// (via fs.writeFileSync etc.), but they don't expose file paths, so the
// only honest way to catch them was a git-status sweep. We pulled that
// path: it created a second always-running code branch, depended on the
// project being a git repo, and reading dirty trees produced confusing
// "look at unrelated work" nudges. The cost is missing detector coverage
// for `mcp__node_repl__` edits in Codex; the win is one simple code path
// and zero invocations on tool calls that don't carry a file.
//
// No `if:` on either harness. Claude's `if` field holds one permission rule
// tied to a tool name; `Edit(*.{tsx,...})` would skip Write and MultiEdit
// even when the group matcher includes them. The hook script already filters
// by extension before running the detector.
export function buildClaudeHooksManifest({ pluginRootPlaceholder = '${CLAUDE_PLUGIN_ROOT}' } = {}) {
  return {
    description: 'Impeccable design detector: runs after Edit/Write/MultiEdit/apply_patch on UI files and surfaces findings as system reminders.',
    hooks: {
      PostToolUse: [
        {
          matcher: 'Edit|Write|MultiEdit|apply_patch',
          hooks: [
            {
              type: 'command',
              command: `node "${pluginRootPlaceholder}/${HOOK_SCRIPT_REL}"`,
              timeout: 5,
              statusMessage: 'Scanning design',
            },
          ],
        },
      ],
      SessionStart: [
        {
          // Codex docs: matcher filters `source` (startup, resume, clear, compact).
          // Greet on fresh open and resume only — skip compact/clear churn.
          matcher: 'startup|resume',
          hooks: [
            {
              type: 'command',
              command: `node "${pluginRootPlaceholder}/${SESSION_SCRIPT_REL}"`,
              timeout: 3,
              statusMessage: 'Loading design hook',
            },
          ],
        },
      ],
    },
  };
}

export function buildCodexHooksManifest({ pluginRootPlaceholder = '${PLUGIN_ROOT}' } = {}) {
  return {
    description: 'Impeccable design detector: runs after Edit/Write/apply_patch on UI files and surfaces findings as system reminders.',
    hooks: {
      PostToolUse: [
        {
          // Codex parses the matcher as a regex; `|` works identically to Claude.
          // `apply_patch` is the canonical Codex edit tool; Edit/Write are aliases.
          matcher: 'Edit|Write|apply_patch',
          hooks: [
            {
              type: 'command',
              command: `node "${pluginRootPlaceholder}/${HOOK_SCRIPT_REL}"`,
              timeout: 5,
              statusMessage: 'Scanning design',
            },
          ],
        },
      ],
      SessionStart: [
        {
          matcher: 'startup|resume',
          hooks: [
            {
              type: 'command',
              command: `node "${pluginRootPlaceholder}/${SESSION_SCRIPT_REL}"`,
              timeout: 3,
              statusMessage: 'Loading design hook',
            },
          ],
        },
      ],
    },
  };
}

export function buildCodexPluginManifest(rootManifest) {
  // Tiny on purpose. Codex auto-discovers `hooks/hooks.json` from the plugin
  // root; declaring it in `plugin.json` would duplicate the registration.
  return {
    name: rootManifest.name,
    description: rootManifest.description,
    version: rootManifest.version,
    author: rootManifest.author,
    homepage: rootManifest.homepage,
    repository: rootManifest.repository,
    skills: './skills/',
  };
}

export function hooksJsonFor(provider) {
  switch (provider) {
    case 'claude':
      return buildClaudeHooksManifest();
    case 'codex':
      return buildCodexHooksManifest();
    default:
      return null;
  }
}
