---
name: impeccable-mcp
description: Use Impeccable through a remote MCP connector for source-backed design workflow, checkpoints, and detector guidance.
---

# Impeccable MCP

Use this skill guide when a client supports standalone Markdown skills or reusable agent instructions. It must be used with the `@Impeccable` MCP connector, which reads the real Impeccable source tree.

The MCP connector is a bridge to the real Impeccable skill entrypoint. It does not install local skills, run provider-native hooks automatically, or edit client workspace files.

## Required Connector

- Attach or invoke the `@Impeccable` remote MCP connector.
- Call `impeccable_start` first. This routes the request to the real skill entrypoint, command reference, register reference, and next MCP bridge calls.
- Call `impeccable_manifest` when you need to confirm source version or available commands.
- Fetch the returned command and register references when the client supports MCP resources/tools.
- Call `impeccable_workflow` before generating UI or design code.
- Call `impeccable_detect_markup` when markup, JSX, CSS, HTML, Vue, or Svelte output is available.
- Call `impeccable_checkpoint` with `before_final` before declaring work complete when native Impeccable hooks are unavailable.

## Compatibility Limits

Some client skill-import surfaces accept only a single Markdown file and cannot include `scripts/`, `reference/`, `assets/`, subagents, or provider-native hooks. The MCP connector exposes those source-backed pieces from the real Impeccable source so the agent can follow them explicitly.

## Checkpoint Sequence

1. `impeccable_start`: choose the Impeccable command and source references.
2. `impeccable_workflow`: load the command-specific workflow guidance.
3. `impeccable_detect_markup`: scan available markup/code and request revisions for important findings.
4. `impeccable_checkpoint before_final`: ensure P0/P1 issues are absent or explicitly acknowledged.

## Recommended Prompt Shape

```text
Use the Impeccable skill guide and @Impeccable connector.
Call impeccable_start first for the user request and target.
Fetch the returned command/register references when available.
Call impeccable_workflow for the routed command before generating UI.
After generation, call impeccable_detect_markup if markup/style text is available.
Call impeccable_checkpoint before final.
```
