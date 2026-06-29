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
 * 3. Cursor plugin package (the Customize / Cursor marketplace path):
 *      - `plugin-cursor/hooks/hooks.json`       (plugin-root-relative)
 *
 * The plugin variants resolve the hook script relative to the installed plugin
 * root rather than assuming a project `.claude/skills/` or `.cursor/skills/`
 * layout, so they stay correct wherever the harness unpacks the plugin. Cursor
 * has no `${CLAUDE_PLUGIN_ROOT}` equivalent; its plugin hooks run from the
 * plugin root, so a plugin-root-relative path is the portable form.
 */

export const IMPECCABLE_HOOK_COMMAND_MARKER = 'skills/impeccable/scripts/hook.mjs';

const TIMEOUT_SECONDS = 5;
const STATUS_MESSAGE = 'Checking UI changes';
const CLAUDE_PROJECT_HOOK = '${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/hook.mjs';
const CLAUDE_PLUGIN_HOOK = '${CLAUDE_PLUGIN_ROOT}/skills/impeccable/scripts/hook.mjs';
const CODEX_PROJECT_HOOK = '$(git rev-parse --show-toplevel)/.agents/skills/impeccable/scripts/hook.mjs';
const CURSOR_BEFORE_EDIT_SCRIPT = '.cursor/skills/impeccable/scripts/hook-before-edit.mjs';
const CURSOR_PLUGIN_BEFORE_EDIT_SCRIPT = 'skills/impeccable/scripts/hook-before-edit.mjs';
const GITHUB_PROJECT_HOOK = '$(git rev-parse --show-toplevel)/.github/skills/impeccable/scripts/hook.mjs';

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

// Plugin-packaged variant of the Cursor hook. Cursor auto-discovers a plugin's
// `hooks/hooks.json` and runs its commands from the plugin root, so the command
// resolves the pre-write gate relative to the plugin payload's bundled skill
// (`skills/impeccable/scripts/...`) rather than a project `.cursor/skills/`
// layout. Same blocking preToolUse behavior as the project-local manifest.
export function buildCursorPluginHooksManifest() {
  return {
    version: 1,
    hooks: {
      preToolUse: [
        {
          command: `node "${CURSOR_PLUGIN_BEFORE_EDIT_SCRIPT}"`,
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
    default:
      return null;
  }
}
