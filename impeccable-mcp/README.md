# Impeccable MCP

Source-backed remote MCP server for the real upstream Impeccable skill system.

This package lives inside the Impeccable repo and reads the authoritative source files from the repo checkout:

- `skill/SKILL.src.md`
- `skill/reference/*.md`
- `skill/scripts/command-metadata.json`
- `docs/HARNESSES.md`
- `cli/engine/detect-antipatterns.mjs`

It exposes read-only MCP tools over `/mcp` and a Railway health endpoint at `/health`.

## Tools

- `impeccable_manifest`
- `impeccable_skill_markdown`
- `impeccable_workflow`
- `impeccable_checkpoint`
- `impeccable_detect_markup`
- `search`
- `fetch`

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
