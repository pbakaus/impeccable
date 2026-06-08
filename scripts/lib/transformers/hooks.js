/**
 * Build-pipeline emitters for the Impeccable design hook.
 *
 * The hook install path in this PR is project-local:
 *   - Claude Code: `.claude/settings.json`
 *   - Codex: `.codex/hooks.json`
 *   - Cursor: `.cursor/hooks.json`
 *
 * No provider marketplace or Codex plugin packaging is emitted here.
 */

export const IMPECCABLE_HOOK_COMMAND_MARKER = 'skills/impeccable/scripts/hook.mjs';

const TIMEOUT_SECONDS = 5;
const SKILL_HOOK_SCRIPT_REL = 'skills/impeccable/scripts/hook.mjs';
const CLAUDE_PROJECT_HOOK = '${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/hook.mjs';
const CODEX_PROJECT_HOOK = '$(git rev-parse --show-toplevel)/.agents/skills/impeccable/scripts/hook.mjs';
const CURSOR_BEFORE_EDIT_SCRIPT = '.cursor/skills/impeccable/scripts/hook-before-edit.mjs';
const CURSOR_AFTER_EDIT_SCRIPT = '.cursor/skills/impeccable/scripts/hook-after-edit.mjs';
const CURSOR_STOP_SCRIPT = '.cursor/skills/impeccable/scripts/hook-stop.mjs';

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
              statusMessage: 'Scanning design',
            },
          ],
        },
      ],
    },
  };
}

export function buildClaudePluginHooksManifest({ pluginRootPlaceholder = '${CLAUDE_PLUGIN_ROOT}' } = {}) {
  return {
    description: 'Impeccable design detector: runs after Edit/Write/MultiEdit on UI files and surfaces findings as system reminders.',
    hooks: {
      PostToolUse: [
        {
          matcher: 'Edit|Write|MultiEdit',
          hooks: [
            {
              type: 'command',
              command: `node "${pluginRootPlaceholder}/${SKILL_HOOK_SCRIPT_REL}"`,
              timeout: TIMEOUT_SECONDS,
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
          matcher: 'Edit|Write|apply_patch',
          hooks: [
            {
              type: 'command',
              command: `node "${CODEX_PROJECT_HOOK}"`,
              timeout: TIMEOUT_SECONDS,
              statusMessage: 'Scanning design',
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
      afterFileEdit: [
        {
          command: `node "${CURSOR_AFTER_EDIT_SCRIPT}"`,
          timeout: TIMEOUT_SECONDS,
        },
      ],
      stop: [
        {
          command: `node "${CURSOR_STOP_SCRIPT}"`,
          timeout: TIMEOUT_SECONDS,
          loop_limit: 1,
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

export function hookArtifactPathFor(configDir) {
  if (configDir === '.claude') return 'settings.json';
  if (configDir === '.cursor') return 'hooks.json';
  if (configDir === '.codex') return 'hooks.json';
  return null;
}
