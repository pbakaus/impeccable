/**
 * Build-pipeline emitters for the Impeccable design hook.
 *
 * Two emission targets exist:
 *
 * 1. Project-local install (the `npx impeccable skills install` CLI path):
 *      - Claude Code: `.claude/settings.json`   (${CLAUDE_PROJECT_DIR}-relative)
 *      - Codex:       `.codex/hooks.json`
 *      - Cursor:      `.cursor/hooks.json`
 *
 * 2. Claude Code plugin package (the marketplace / `/plugin install` path):
 *      - `plugin/hooks/hooks.json`              (${CLAUDE_PLUGIN_ROOT}-relative)
 *
 * The plugin variant resolves the hook script relative to the installed plugin
 * root rather than assuming a `.claude/skills/impeccable/` layout, so it stays
 * correct wherever Claude Code unpacks the plugin.
 */

export const IMPECCABLE_HOOK_COMMAND_MARKER = 'skills/impeccable/scripts/hook.mjs';

const TIMEOUT_SECONDS = 5;
const STATUS_MESSAGE = 'Checking UI changes';
const CLAUDE_PROJECT_HOOK = '${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/hook.mjs';
const CLAUDE_PLUGIN_HOOK = '${CLAUDE_PLUGIN_ROOT}/skills/impeccable/scripts/hook.mjs';
const CODEX_PROJECT_HOOK = '$(git rev-parse --show-toplevel)/.agents/skills/impeccable/scripts/hook.mjs';
const CURSOR_BEFORE_EDIT_SCRIPT = '.cursor/skills/impeccable/scripts/hook-before-edit.mjs';

export function buildClaudeSettingsManifest() {
  return {
    description: 'Impeccable design detector: runs after Edit/Write/MultiEdit on UI files and surfaces findings as system reminders.',
    hooks: {
      PostToolUse: [
        {
          matcher: 'Edit|Write|MultiEdit',
          hooks: [
            {
              type: 'command',
              command: `node "${CLAUDE_PROJECT_HOOK}"`,
              timeout: TIMEOUT_SECONDS,
              statusMessage: STATUS_MESSAGE,
            },
          ],
        },
      ],
    },
  };
}

// Plugin-packaged variant of the Claude hook. Same schema as the settings.json
// manifest (Claude Code reads an identical `hooks` object from a plugin's
// `hooks/hooks.json`), but the command resolves relative to ${CLAUDE_PLUGIN_ROOT}
// so it does not depend on the skill being copied into `.claude/skills/`.
export function buildClaudePluginHooksManifest() {
  return {
    description: 'Impeccable design detector: runs after Edit/Write/MultiEdit on UI files and surfaces findings as system reminders.',
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
    },
  };
}

export function buildCodexHooksManifest() {
  return {
    description: 'Impeccable design detector: runs after Edit/Write/apply_patch on UI files and surfaces findings as system reminders.',
    hooks: {
      PostToolUse: [
        {
          matcher: 'Edit|Write|apply_patch',
          hooks: [
            {
              type: 'command',
              command: `node "${CODEX_PROJECT_HOOK}"`,
              timeout: TIMEOUT_SECONDS,
              statusMessage: STATUS_MESSAGE,
            },
          ],
        },
      ],
    },
  };
}

export function buildCursorHooksManifest() {
  return {
    version: 1,
    hooks: {
      preToolUse: [
        {
          command: `node "${CURSOR_BEFORE_EDIT_SCRIPT}"`,
          timeout: TIMEOUT_SECONDS,
        },
      ],
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
    default:
      return null;
  }
}
