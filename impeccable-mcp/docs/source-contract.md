# Source Contract

The Impeccable MCP package is derived from the real Impeccable source tree. It must not silently fork or reimplement Impeccable workflows as a parallel catalog.

Authoritative inputs:

- `skill/SKILL.src.md`
- `skill/reference/*.md`
- `skill/scripts/command-metadata.json`
- `docs/HARNESSES.md`
- `cli/engine/detect-antipatterns.mjs`

Generated or served outputs:

- MCP tool descriptions and structured responses
- `docs/agent-skill.md`
- MCP resources under `impeccable://`
- `/health` source metadata

Every tool output that gives workflow guidance should include source commit or source path evidence when practical. Runtime code must resolve the source root from `IMPECCABLE_SOURCE_ROOT` or by walking up from the package location; it must not hard-code a local user path.
