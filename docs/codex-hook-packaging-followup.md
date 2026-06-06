# Codex Hook Packaging Follow-Up

Status: retired by the provider-native install-plumbing branch.

Codex no longer uses an Impeccable plugin package for project hooks in this PR. The supported path is:

- `.agents/skills/impeccable/` for the Codex skill payload.
- `.codex/hooks.json` for the project-local hook manifest.
- `npx impeccable skills install` and `npx impeccable skills update` to install or refresh both.

The hook command runs the harmless probe:

```text
node "$(git rev-parse --show-toplevel)/.agents/skills/impeccable/scripts/hook-probe.mjs"
```

The build must not generate:

- `plugin-codex/`
- `.agents/hooks/`
- `.agents/plugins/marketplace.json`

Codex users still approve the project hook through `/hooks`. There is no `codex plugin add` flow for this hook.
