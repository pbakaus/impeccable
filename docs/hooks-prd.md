# Hook Install Plumbing PRD

| Field | Value |
|---|---|
| Status | Current PR scope |
| Scope | Install/update plumbing only |

## Summary

This PR installs provider-native hook manifests through the Impeccable skills CLI:

```bash
npx impeccable skills install
npx impeccable skills update
```

The installed hook is a harmless probe. It reads optional JSON stdin, exits 0, and emits no stdout or stderr by default. It can write one NDJSON line per invocation when `IMPECCABLE_HOOK_PROBE_LOG` is set.

The anti-pattern detector runtime is intentionally not part of this PR.

## Provider Surfaces

| Provider | Skill payload | Hook manifest | Probe command target |
|---|---|---|---|
| Claude Code | `.claude/skills/impeccable` | `.claude/settings.json` | `.claude/skills/impeccable/scripts/hook-probe.mjs` |
| Cursor | `.cursor/skills/impeccable` | `.cursor/hooks.json` | `.cursor/skills/impeccable/scripts/hook-probe.mjs` |
| Codex | `.agents/skills/impeccable` | `.codex/hooks.json` | `.agents/skills/impeccable/scripts/hook-probe.mjs` |

Codex project hooks require the normal `/hooks` trust approval after install or update when the hook definition hash changes.

## Non-Goals

- No Codex plugin package.
- No `codex plugin add` marketplace flow.
- No detector hook runtime.
- No `.impeccable/hook.json` kill-switch or suppression config yet.
- No Cursor `stop` follow-up hook yet.

## Installer Requirements

- `skills install` and `skills update` install or refresh hook manifests with the skill payload.
- Existing installs repair missing hook manifests without requiring `--force`.
- Existing third-party hook entries and settings are preserved.
- Old Impeccable hook entries are removed by matching `skills/impeccable/scripts/hook-probe.mjs` and previous detector-hook script paths.
- Malformed hook JSON aborts by default. With `--force`, the installer writes a `.bak` and replaces the manifest.

## Retired Artifacts

The build must not generate:

- `.claude/hooks/hooks.json`
- `.agents/hooks/`
- `.agents/plugins/marketplace.json`
- `plugin-codex/`
- `plugin/hooks/hooks.json`

Detector hook docs and runtime tests should move into a later PR when the detector hook behavior is ready to ship.
