/**
 * Build-pipeline emitters for the Impeccable design hook.
 *
 * Two emission targets exist:
 *
 * 1. Project-local install (the `npx impeccable skills install` CLI path):
 *      - Claude Code: `.claude/settings.json`   (${CLAUDE_PROJECT_DIR}-relative)
 *      - Codex:       `.codex/hooks.json`
 *      - Cursor:      `.cursor/hooks.json`
 *      - Grok Build:  `.grok/hooks/impeccable.json`
 *
 * 2. Claude Code plugin package (the marketplace / `/plugin install` path):
 *      - `plugin/hooks/hooks.json`              (${CLAUDE_PLUGIN_ROOT}-relative)
 *        Also consumed by Grok Build via Claude Code plugin compatibility
 *        (`CLAUDE_PLUGIN_ROOT` is aliased to `GROK_PLUGIN_ROOT`).
 *
 * 3. OpenAI plugin package:
 *      - `hooks/hooks.json`                     (${PLUGIN_ROOT}-relative)
 *
 * The plugin variant resolves the hook script relative to the installed plugin
 * root rather than assuming a `.claude/skills/impeccable/` layout, so it stays
 * correct wherever Claude Code unpacks the plugin.
 */

export const IMPECCABLE_HOOK_COMMAND_MARKER = 'skills/impeccable/scripts/hook.mjs';

const TIMEOUT_SECONDS = 5;
const STATUS_MESSAGE = 'Checking UI changes';
// The Stop deep pass scans every UI file touched in the session with the
// full rule set, so it gets a longer budget than the single-file per-edit
// pass. Wired only for Claude Code and Codex, which both dispatch a native
// `Stop` hook event; Cursor's stop hook is not consistently dispatched and
// GitHub Copilot's stop-style events do not feed context back to the model.
const STOP_TIMEOUT_SECONDS = 30;
const STOP_STATUS_MESSAGE = 'Design deep pass';

function stopEntry(command) {
  return {
    hooks: [
      {
        type: 'command',
        command,
        timeout: STOP_TIMEOUT_SECONDS,
        statusMessage: STOP_STATUS_MESSAGE,
      },
    ],
  };
}

const CLAUDE_PROJECT_HOOK = '${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/hook.mjs';
// The Node major the hook runtime requires, kept equal to the engines floor in
// package.json. The probe and the notice both derive from it so they cannot
// disagree about the supported version.
const NODE_MAJOR_FLOOR = 22;
// A hook manifest can be copied into a user-level settings file (issue #399:
// user-level hooks fire in every project, where a project-relative path may
// not exist). Guard node invocations so a missing file exits 0 without
// swallowing node's real exit code when the file is present.
//
// The runtime is guarded too (issue #410): a `node` on PATH too old for the
// hook's ESM syntax dies while hook.mjs is still being parsed, before the
// script's own always-exit-0 contract can run, so the harness reported a hook
// error on every edit and every Stop. Nothing written in ESM can report that
// condition, so the command string itself checks the version floor first, in
// ES5-only syntax that parses on any node old enough to fail it, and exits 0
// when the runtime is unsupported or missing.
//
// `notice` reports the dead runtime to the user. It is passed per harness
// because only some have a channel for it, checked against each harness's own
// hook reference on the events we hook:
//   Claude Code / Codex: `systemMessage` on stdout is shown to the user -> notice
//   Cursor: preToolUse output is permission-shaped and its `user_message`
//     renders only on DENY, so warning would block the edit    -> probe only
//   Grok Build: PostToolUse stdout is ignored; Stop additionalContext
//     reaches the model, but the node-version notice has no systemMessage
//     channel on this harness                                 -> probe only
//   Copilot: output contract unconfirmed; do not guess a shape -> probe only
//
// The clamp avoids `<` and `>` deliberately: Volta's Windows shims run through
// `cmd /C`, which reads an angle bracket in the `-e` payload as redirection, so
// `>=` failed before node ran at all and the guard reported a missing runtime on
// a machine that had a supported one (volta-cli/volta#1791). Newlines break the
// same way, so this payload also has to stay on one line.
const NODE_PROBE = `node -e "process.exit(Math.min(parseInt(process.versions.node,10),${NODE_MAJOR_FLOOR})===${NODE_MAJOR_FLOOR}?0:1)" 2>/dev/null`;
const guardedNode = (hookPath, notice = '') => {
  const probe = notice
    ? `! { ${NODE_PROBE} || { ${notice}; exit 0; }; }`
    : `! ${NODE_PROBE}`;
  return `[ ! -f "${hookPath}" ] || ${probe} || node "${hookPath}"`;
};

function buildClaudeCompatibleHooks(matcher, hookPath, notice = '') {
  const command = guardedNode(hookPath, notice);
  return {
    PostToolUse: [
      {
        matcher,
        hooks: [
          {
            type: 'command',
            command,
            timeout: TIMEOUT_SECONDS,
            statusMessage: STATUS_MESSAGE,
          },
        ],
      },
    ],
    Stop: [stopEntry(command)],
  };
}

// The message says `on PATH` deliberately: the common cause is a hook shell
// whose PATH misses the version manager, so a user already running Node 22
// needs to know the hook's PATH is at issue and not their install. Apostrophes
// cannot appear in it, since it travels inside a single-quoted shell string.
const NODE_NOTICE_TEXT = `The impeccable design hook is not running: no Node ${NODE_MAJOR_FLOOR} or newer on PATH. `
  + 'Install one, or remove the impeccable hook from your harness settings.';
// Claude Code and Codex both read `systemMessage`, so one payload serves both.
// The marker under ~/.impeccable holds it to one notice per machine (not per
// harness or per edit), and printf runs only after the marker write succeeds,
// so an unwritable HOME degrades to silence rather than a notice on every edit.
const SYSTEM_MESSAGE_NOTICE = 'D="$HOME/.impeccable"; [ -f "$D/node-unsupported" ] || '
  + '{ mkdir -p "$D" 2>/dev/null && : > "$D/node-unsupported" 2>/dev/null && '
  + `printf '%s' '{"systemMessage":"${NODE_NOTICE_TEXT}"}'; }`;
const CLAUDE_PLUGIN_HOOK = '${CLAUDE_PLUGIN_ROOT}/skills/impeccable/scripts/hook.mjs';
const CODEX_PLUGIN_HOOK = '${PLUGIN_ROOT}/skills/impeccable/scripts/hook.mjs';
// Codex reads project hooks from `.codex/hooks.json`, but the skill payload the
// hook invokes lives under the install's own skills dir: a `.codex`-directory
// install keeps it at `.codex/skills/...`, while a `.agents` (Codex repo-skills)
// install keeps it at `.agents/skills/...`. Derive the path from the install dir
// so each generated manifest points at its own payload rather than a hardcoded
// `.agents` — otherwise the guarded hook silently no-ops on `.codex` installs.
const codexProjectHook = (skillDir) => `${skillDir}/skills/impeccable/scripts/hook.mjs`;
const CURSOR_BEFORE_EDIT_SCRIPT = '.cursor/skills/impeccable/scripts/hook-before-edit.mjs';
const GITHUB_PROJECT_HOOK = '$(git rev-parse --show-toplevel)/.github/skills/impeccable/scripts/hook.mjs';
// Grok project hooks are relative to the git/workspace root. Claude tool names
// in the matcher (Edit|Write|MultiEdit) alias to Grok's search_replace family.
const GROK_PROJECT_HOOK = '.grok/skills/impeccable/scripts/hook.mjs';

export function buildClaudeSettingsManifest() {
  return {
    description: 'Impeccable design detector: immediate-tier checks after Edit/Write on UI files, full-rule deep pass on Stop.',
    hooks: buildClaudeCompatibleHooks(
      'Edit|Write',
      CLAUDE_PROJECT_HOOK,
      SYSTEM_MESSAGE_NOTICE,
    ),
  };
}

// Plugin-packaged variant of the Claude hook. Claude Code reads the `hooks`
// object from a plugin's `hooks/hooks.json`, and the command resolves relative
// to ${CLAUDE_PLUGIN_ROOT} so it does not depend on the skill being copied into
// `.claude/skills/`. No top-level `description`: Codex also loads bundled plugin
// hooks from `hooks/hooks.json` and its strict parser rejects any field other
// than `hooks`, failing the whole manifest (issue #330).
export function buildClaudePluginHooksManifest() {
  return {
    hooks: buildClaudeCompatibleHooks(
      'Edit|Write',
      CLAUDE_PLUGIN_HOOK,
      SYSTEM_MESSAGE_NOTICE,
    ),
  };
}

// OpenAI plugin-packaged variant. Codex exposes ${PLUGIN_ROOT} for resources
// inside the installed plugin, so the public bundle can use the native path
// instead of relying on its Claude compatibility alias.
export function buildCodexPluginHooksManifest() {
  return {
    hooks: buildClaudeCompatibleHooks(
      'Edit|Write|apply_patch',
      CODEX_PLUGIN_HOOK,
      SYSTEM_MESSAGE_NOTICE,
    ),
  };
}

// `skillDir` is the install's own dot-directory (a provider's configDir), so the
// emitted command points at that install's payload. Defaults to `.codex` for the
// Codex provider, whose self-consistent bundle keeps the skill at `.codex/skills`.
export function buildCodexHooksManifest(skillDir = '.codex') {
  const hookPath = codexProjectHook(skillDir);
  return {
    hooks: buildClaudeCompatibleHooks(
      'Edit|Write|apply_patch',
      hookPath,
      SYSTEM_MESSAGE_NOTICE,
    ),
  };
}

export function buildCursorHooksManifest() {
  return {
    version: 1,
    hooks: {
      preToolUse: [
        {
          command: guardedNode(CURSOR_BEFORE_EDIT_SCRIPT),
          timeout: TIMEOUT_SECONDS,
        },
      ],
    },
  };
}

// GitHub Copilot reads project hooks from `.github/hooks/*.json`. Its schema
// differs from Claude/Codex/Cursor: the event key is lowercase `postToolUse`,
// each entry is flat (no nested `hooks` array), the command lives under `bash`
// (with an optional `powershell` sibling), the timeout key is `timeoutSec`, and
// `matcher` is a full-match regex (`^(?:PATTERN)$`) tested against the tool name.
// Copilot's file-editing tool names vary by surface (verified against CLI
// 1.0.63): `copilot -p` runs use `edit` ({path, old_str, new_str}) and `create`
// ({path, file_text}); interactive sessions and the cloud agent use
// `apply_patch` (a raw OpenAI-format patch string). The matcher covers all
// three. The same manifest is honored by both the CLI and the cloud/app agent.
// https://docs.github.com/en/copilot/reference/hooks-reference
export function buildGitHubHooksManifest() {
  return {
    version: 1,
    hooks: {
      postToolUse: [
        {
          type: 'command',
          matcher: 'edit|create|apply_patch',
          bash: guardedNode(GITHUB_PROJECT_HOOK),
          timeoutSec: TIMEOUT_SECONDS,
        },
      ],
    },
  };
}

// Grok Build discovers project hooks from `.grok/hooks/*.json` and requires
// folder trust (`/hooks-trust` or `--trust`) before they run. Event schema is
// Claude-compatible (PostToolUse / Stop / PreToolUse); Claude tool names in
// matchers are aliased to Grok tools (Edit|Write|MultiEdit → search_replace).
// https://docs.x.ai/build/features/hooks
export function buildGrokHooksManifest() {
  return {
    hooks: buildClaudeCompatibleHooks('Edit|Write|MultiEdit', GROK_PROJECT_HOOK),
  };
}

export function hooksJsonFor(provider, options = {}) {
  switch (provider) {
    case 'claude':
      return buildClaudeSettingsManifest();
    case 'codex':
      return buildCodexHooksManifest(options.configDir || '.codex');
    case 'cursor':
      return buildCursorHooksManifest();
    case 'github':
      return buildGitHubHooksManifest();
    case 'grok':
      return buildGrokHooksManifest();
    default:
      return null;
  }
}
