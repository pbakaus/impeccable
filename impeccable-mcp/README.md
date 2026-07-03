# Impeccable MCP

Source-backed remote MCP server for the real upstream Impeccable skill system.

The MCP server is a bridge to Impeccable's real skill entrypoint and references. It does not install local skill folders, run provider-native hooks automatically, or edit client workspace files.

This package lives inside the Impeccable repo and reads the authoritative source files from the repo checkout:

- `skill/SKILL.src.md`
- `skill/reference/*.md`
- `skill/scripts/command-metadata.json`
- `docs/HARNESSES.md`
- `cli/engine/detect-antipatterns.mjs`

It exposes read-only MCP tools over `/mcp` and a Railway health endpoint at `/health`.

## Tools

- `impeccable_start`
- `impeccable_manifest`
- `impeccable_skill_markdown`
- `impeccable_workflow`
- `impeccable_checkpoint`
- `impeccable_detect_markup`
- `search`
- `fetch`

Call `impeccable_start` first. It routes a natural-language UI request to the real skill entrypoint, command reference, register reference, and next MCP bridge calls.

## Local Verification

```bash
cd impeccable-mcp
npm run verify
```

## Runtime

```bash
cd impeccable-mcp
IMPECCABLE_MCP_KEYS=local-dev-key npm start
```

Set `IMPECCABLE_SOURCE_ROOT` only when the deployed package cannot resolve the parent Impeccable repo automatically.

For Railway, deploy from the repo root using the root `railway.json`; the MCP runtime needs the parent Impeccable source tree.
