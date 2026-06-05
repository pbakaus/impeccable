/**
 * Build-pipeline emitters for the Impeccable design hook.
 *
 * Three artifacts:
 *   1. hooks.json — per-provider hook manifest. PostToolUse shape is the same
 *      on both harnesses: one matcher group, no `if:` field. Claude's `if:`
 *      permission rule binds to a single tool name (`Edit(*.tsx)` never
 *      matches Write or MultiEdit), so extension filtering lives in the hook
 *      script on both sides.
 *   2. .codex/hooks.json — Codex project-local hook manifest. Codex discovers
 *      hooks next to project config layers; the command resolves the repo root
 *      at runtime and then runs the hook bundled under `.agents/skills`.
 *   3. .cursor/hooks.json — Cursor's flat project-local hook manifest.
 */

const SKILL_HOOK_SCRIPT_REL = 'skills/impeccable/scripts/hook.mjs';
const CODEX_PROJECT_HOOK_COMMAND = 'node "$(git rev-parse --show-toplevel)/.agents/skills/impeccable/scripts/hook.mjs"';

// Manifest copied verbatim from `dist/claude-code/.claude/hooks/` into the
// Claude marketplace `plugin/hooks/` subtree by `scripts/build.js`.
//
// **Shell form, not exec form.** We use `command: "node \"…path…\""` with
// the path embedded in the command string, not the exec form `command: "node",
// args: ["…path…"]`. The shell form gives Claude plugin installs placeholder
// substitution and lets Codex project hooks resolve the git root at runtime.
// Quotes around the path keep us safe if roots contain spaces.
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
              command: `node "${pluginRootPlaceholder}/${SKILL_HOOK_SCRIPT_REL}"`,
              timeout: 5,
              statusMessage: 'Scanning design',
            },
          ],
        },
      ],
    },
  };
}

export function buildCodexHooksManifest() {
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
              command: CODEX_PROJECT_HOOK_COMMAND,
              timeout: 5,
              statusMessage: 'Scanning design',
            },
          ],
        },
      ],
    },
  };
}

// Cursor discovers `.cursor/hooks.json` at the project root (not
// `.cursor/hooks/hooks.json`). Scripts live under `.cursor/skills/…` and
// run with cwd = project root.
//
// Cursor 3.5.x discards postToolUse `additional_context` (confirmed bug).
// Dynamic findings use afterFileEdit (record) + stop (followup_message).
// Keep commands free of POSIX-only `VAR=value` prefixes so the same manifest
// works on Windows; the scripts infer Cursor from the event shape.
const CURSOR_AFTER_EDIT_SCRIPT = '.cursor/skills/impeccable/scripts/hook-after-edit.mjs';
const CURSOR_STOP_SCRIPT = '.cursor/skills/impeccable/scripts/hook-stop.mjs';

export function buildCursorHooksManifest() {
  return {
    version: 1,
    hooks: {
      afterFileEdit: [
        {
          command: `node "${CURSOR_AFTER_EDIT_SCRIPT}"`,
          timeout: 5,
        },
      ],
      stop: [
        {
          command: `node "${CURSOR_STOP_SCRIPT}"`,
          timeout: 5,
          loop_limit: 1,
        },
      ],
    },
  };
}

export function hooksJsonFor(provider) {
  switch (provider) {
    case 'claude':
      return buildClaudeHooksManifest();
    case 'codex':
      return buildCodexHooksManifest();
    case 'cursor':
      return buildCursorHooksManifest();
    default:
      return null;
  }
}
