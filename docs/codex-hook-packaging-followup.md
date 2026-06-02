# Codex Hook Packaging Follow-Up

Status: implemented in this branch after hook testing exposed the packaging gap.

## Why This Exists

During testing in `impeccable-live-react`, Codex did not show Impeccable in `/hooks` even after the `.agents` hook bundle was installed.

The root cause is that Codex does not discover visible lifecycle hooks from `.agents/hooks`. Codex discovers hooks from:

- project `.codex/hooks.json`
- user `~/.codex/hooks.json`
- inline `[hooks]` tables next to active `config.toml` layers
- enabled Codex plugins that bundle `hooks/hooks.json`

The temporary local workaround for testing was to add `.codex/hooks.json` in `impeccable-live-react` pointing at:

```text
$(git rev-parse --show-toplevel)/.agents/skills/impeccable/scripts/hook.mjs
```

That makes `/hooks` able to see the project-local hook in that repo.

## Product Issue

Before this change, the installable Codex plugin packaging needed a real fix.

Risk before the fix:

- `plugin/hooks/hooks.json` is generated from the Claude hook bundle.
- That file uses `${CLAUDE_PLUGIN_ROOT}`.
- Codex plugin hooks should use `${PLUGIN_ROOT}`.
- The Codex plugin cache observed during testing contained skill files but did not contain a usable Codex hook manifest/script shape.

Result: a production Codex plugin install could expose the Impeccable skill but fail to expose or run the design hook in `/hooks`.

## Implemented Fix

The build now emits two install package roots:

- `plugin/` remains the Claude Code package and keeps `plugin/hooks/hooks.json` with `${CLAUDE_PLUGIN_ROOT}`.
- `plugin-codex/` is the Codex package and writes `plugin-codex/hooks/hooks.json` with `${PLUGIN_ROOT}`.
- `.agents/plugins/marketplace.json` points Codex marketplace installs at `./plugin-codex`.

This keeps each runtime on the placeholder it actually expands and avoids relying on a project-local `.codex/hooks.json` workaround.

## Claude And Cursor Scope

This follow-up is Codex-specific.

Claude does not need the same fix. Its plugin hook manifest is expected to use `${CLAUDE_PLUGIN_ROOT}`, and Claude installs/read hooks from the Claude plugin or `.claude/hooks/hooks.json` path.

Cursor does not need the same fix either. Cursor uses `.cursor/hooks.json` with the `afterFileEdit` plus `stop` flow, not the Codex plugin hook discovery path.

Still add regression checks for all three providers after the Codex packaging fix:

- Claude: hook manifest still uses `${CLAUDE_PLUGIN_ROOT}` and points at bundled `skills/impeccable/scripts/hook.mjs`.
- Cursor: `.cursor/hooks.json` still contains `afterFileEdit` and `stop`, and both scripts are bundled.
- Codex: plugin/install hook manifest uses `${PLUGIN_ROOT}` and appears in `/hooks`.

## Regression Checks

The hook build tests assert:

- Codex plugin hook manifest contains `${PLUGIN_ROOT}`.
- Claude plugin hook manifest contains `${CLAUDE_PLUGIN_ROOT}`.
- The Codex marketplace points at `./plugin-codex`.
- The bundled hook scripts exist at the paths referenced by both hook manifests.

## Testing Notes

The `.codex/hooks.json` workaround is still useful in test repos when validating project-local hooks, but it is no longer the product fix.
