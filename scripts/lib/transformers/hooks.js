/**
 * Build-pipeline emitters for the Impeccable design hook.
 *
 * Two artifacts:
 *   1. hooks.json — per-provider hook manifest. Shape differs slightly between
 *      Claude Code (supports `if:` glob) and Codex (no `if:` analog, hook
 *      script does its own extension filter).
 *   2. .codex-plugin/plugin.json — net-new Codex plugin manifest. Codex
 *      auto-discovers `hooks/hooks.json` from the plugin root, so the manifest
 *      itself is intentionally tiny (no `hooks` field — listing it there would
 *      trigger Codex's "duplicate hooks file detected" error, mirroring the
 *      Claude Code behavior).
 */

const HOOK_SCRIPT_REL = 'skills/impeccable/scripts/hook.mjs';
const SESSION_SCRIPT_REL = 'skills/impeccable/scripts/hook-session-start.mjs';

const FILE_EXT_GLOB = '*.{tsx,jsx,html,vue,svelte,astro,css,scss,less,ts,js}';

export function buildClaudeHooksManifest({ pluginRootPlaceholder = '${CLAUDE_PLUGIN_ROOT}' } = {}) {
  return {
    description: 'Impeccable design detector: runs after Write/Edit/MultiEdit on UI files and surfaces findings as system reminders.',
    hooks: {
      PostToolUse: [
        {
          matcher: 'Edit|Write|MultiEdit',
          hooks: [
            {
              type: 'command',
              command: 'node',
              args: [`${pluginRootPlaceholder}/${HOOK_SCRIPT_REL}`],
              if: `Edit(${FILE_EXT_GLOB})`,
              timeout: 5,
            },
          ],
        },
      ],
      SessionStart: [
        {
          hooks: [
            {
              type: 'command',
              command: 'node',
              args: [`${pluginRootPlaceholder}/${SESSION_SCRIPT_REL}`],
              timeout: 3,
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
          matcher: 'Edit|Write|apply_patch',
          hooks: [
            {
              type: 'command',
              command: 'node',
              args: [`${pluginRootPlaceholder}/${HOOK_SCRIPT_REL}`],
              timeout: 5,
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
