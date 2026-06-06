export const IMPECCABLE_HOOK_COMMAND_MARKER = 'skills/impeccable/scripts/hook-probe.mjs';

const TIMEOUT_SECONDS = 3;
const CLAUDE_PROJECT_PROBE = '${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/hook-probe.mjs';
const CURSOR_PROJECT_PROBE = '.cursor/skills/impeccable/scripts/hook-probe.mjs';
const CODEX_PROJECT_PROBE = '$(git rev-parse --show-toplevel)/.agents/skills/impeccable/scripts/hook-probe.mjs';

export function buildClaudeSettingsManifest() {
  return {
    hooks: {
      PostToolUse: [
        {
          matcher: 'Edit|Write|MultiEdit',
          hooks: [
            {
              type: 'command',
              command: `node "${CLAUDE_PROJECT_PROBE}"`,
              timeout: TIMEOUT_SECONDS,
            },
          ],
        },
      ],
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
              command: `node "${CODEX_PROJECT_PROBE}"`,
              timeout: TIMEOUT_SECONDS,
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
      afterFileEdit: [
        {
          command: `node "${CURSOR_PROJECT_PROBE}"`,
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

export function hookArtifactPathFor(configDir) {
  if (configDir === '.claude') return 'settings.json';
  if (configDir === '.cursor') return 'hooks.json';
  if (configDir === '.codex') return 'hooks.json';
  return null;
}
