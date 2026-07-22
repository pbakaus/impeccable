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
// A hook manifest can be copied into a user-level settings file (issue #399:
// user-level hooks fire in every project, where a project-relative path may
// not exist). Guard node invocations so a missing file exits 0 without
// swallowing node's real exit code when the file is present.
const guardedNode = (hookPath) => `[ ! -f "${hookPath}" ] || node "${hookPath}"`;
const CLAUDE_PLUGIN_HOOK = '${CLAUDE_PLUGIN_ROOT}/skills/impeccable/scripts/hook.mjs';
const CODEX_PLUGIN_HOOK = '${PLUGIN_ROOT}/skills/impeccable/scripts/hook.mjs';
const CODEX_PROJECT_HOOK = '.agents/skills/impeccable/scripts/hook.mjs';
const CURSOR_BEFORE_EDIT_SCRIPT = '.cursor/skills/impeccable/scripts/hook-before-edit.mjs';
const GITHUB_PROJECT_HOOK = '$(git rev-parse --show-toplevel)/.github/skills/impeccable/scripts/hook.mjs';
// Grok project hooks are relative to the git/workspace root. Claude tool names
// in the matcher (Edit|Write|MultiEdit) alias to Grok's search_replace family.
const GROK_PROJECT_HOOK = '.grok/skills/impeccable/scripts/hook.mjs';

export function buildClaudeSettingsManifest() {
  return {
    description: 'Impeccable design detector: immediate-tier checks after Edit/Write/MultiEdit on UI files, full-rule deep pass on Stop.',
    hooks: {
      PostToolUse: [
        {
          matcher: 'Edit|Write|MultiEdit',
          hooks: [
            {
              type: 'command',
              command: guardedNode(CLAUDE_PROJECT_HOOK),
              timeout: TIMEOUT_SECONDS,
              statusMessage: STATUS_MESSAGE,
            },
          ],
        },
      ],
      Stop: [stopEntry(guardedNode(CLAUDE_PROJECT_HOOK))],
    },
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
    hooks: {
      PostToolUse: [
        {
          matcher: 'Edit|Write|MultiEdit',
          hooks: [
            {
              type: 'command',
              command: `node "${CLAUDE_PLUGIN_HOOK}"`,
              timeout: TIMEOUT_SECONDS,
              statusMessage: STATUS_MESSAGE,
            },
          ],
        },
      ],
      Stop: [stopEntry(`node "${CLAUDE_PLUGIN_HOOK}"`)],
    },
  };
}

// OpenAI plugin-packaged variant. Codex exposes ${PLUGIN_ROOT} for resources
// inside the installed plugin, so the public bundle can use the native path
// instead of relying on its Claude compatibility alias.
export function buildCodexPluginHooksManifest() {
  return {
    hooks: {
      PostToolUse: [
        {
          matcher: 'Edit|Write|apply_patch',
          hooks: [
            {
              type: 'command',
              command: `node "${CODEX_PLUGIN_HOOK}"`,
              timeout: TIMEOUT_SECONDS,
              statusMessage: STATUS_MESSAGE,
            },
          ],
        },
      ],
      Stop: [stopEntry(`node "${CODEX_PLUGIN_HOOK}"`)],
    },
  };
}

export function buildCodexHooksManifest() {
  return {
    hooks: {
      PostToolUse: [
        {
          matcher: 'Edit|Write|apply_patch',
          hooks: [
            {
              type: 'command',
              command: guardedNode(CODEX_PROJECT_HOOK),
              timeout: TIMEOUT_SECONDS,
              statusMessage: STATUS_MESSAGE,
            },
          ],
        },
      ],
      Stop: [stopEntry(guardedNode(CODEX_PROJECT_HOOK))],
    },
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
          bash: `node "${GITHUB_PROJECT_HOOK}"`,
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
    hooks: {
      PostToolUse: [
        {
          matcher: 'Edit|Write|MultiEdit',
          hooks: [
            {
              type: 'command',
              command: `node "${GROK_PROJECT_HOOK}"`,
              timeout: TIMEOUT_SECONDS,
              statusMessage: STATUS_MESSAGE,
            },
          ],
        },
      ],
      Stop: [stopEntry(`node "${GROK_PROJECT_HOOK}"`)],
    },
  };
}

export function hooksJsonFor(provider) {
  switch (provider) {
    case 'claude':
      return buildClaudeSettingsManifest();
    case 'codex':
      return buildCodexHooksManifest();
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
