# Codex Hook Packaging Follow-Up

Status: implemented in this branch after hook testing exposed the packaging gap.

## Why This Exists

During testing in `impeccable-live-react`, Codex did not show Impeccable in `/hooks` after the `.agents` hook bundle was installed.

The root cause is that Codex does not discover visible lifecycle hooks from `.agents/hooks`. Codex discovers hooks from:

- project `.codex/hooks.json`
- user `~/.codex/hooks.json`
- inline `[hooks]` tables next to active `config.toml` layers
- enabled Codex plugins that bundle `hooks/hooks.json`

The project-local hook path is the right fit for Impeccable's current Codex install story because Codex already reads the skill from `.agents/skills/impeccable`.

## Product Decision

Impeccable no longer ships a separate Codex plugin package in this branch.

The build emits:

- `.agents/skills/impeccable/` for the Codex skill and bundled scripts.
- `.codex/hooks.json` for the Codex project hook.
- `plugin/` only for Claude Code plugin packaging.
- `.cursor/hooks.json` for Cursor.

The generated Codex hook command resolves from the git root:

```text
node "$(git rev-parse --show-toplevel)/.agents/skills/impeccable/scripts/hook.mjs"
```

That keeps Codex aligned with Cursor and repo-local installs: the project carries the hook manifest and the skill runtime together.

## Removed Artifacts

The build now removes stale Codex plugin-marketplace artifacts:

- `plugin-codex/`
- `.agents/plugins/marketplace.json`
- `.agents/hooks/hooks.json`

This prevents Codex from showing Impeccable under both "From Plugins" and "From Projects" for local installs.

## Regression Checks

The hook build tests assert:

- `.codex/hooks.json` exists, parses, and points at `.agents/skills/impeccable/scripts/hook.mjs`.
- `.agents/skills/impeccable/scripts/hook-lib.mjs` can import its bundled detector.
- Claude's plugin hook manifest still uses `${CLAUDE_PLUGIN_ROOT}`.
- Cursor's hook manifest still points at `hook-after-edit.mjs` and `hook-stop.mjs`.
- `plugin-codex/`, `.agents/plugins/marketplace.json`, and `.agents/hooks/` are absent after `bun run build`.
