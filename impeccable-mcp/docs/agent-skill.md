---
name: impeccable-mcp
description: Use Impeccable through a remote MCP connector for source-backed design workflow, checkpoints, and detector guidance.
---

# Impeccable MCP

Use this skill guide when a client supports standalone Markdown skills or reusable agent instructions. It must be used with the `@Impeccable` MCP connector, which reads the real Impeccable source tree.

## Required Connector

- Attach or invoke the `@Impeccable` remote MCP connector.
- Call `impeccable_manifest` when you need to confirm source version or available commands.
- Call `impeccable_workflow` before generating UI or design code.
- Call `impeccable_checkpoint` after generating or revising UI.
- Call `impeccable_detect_markup` when markup, JSX, CSS, HTML, Vue, or Svelte output is available.
- Call `impeccable_checkpoint` with `before_final` before declaring work complete.

## Compatibility Limits

Some client skill-import surfaces accept only a single Markdown file and cannot include `scripts/`, `reference/`, `assets/`, subagents, or provider-native hooks. The MCP connector supplies those operational pieces from the real Impeccable source.

## Checkpoint Sequence

1. `before_generation`: choose the Impeccable command and confirm the brief/register.
2. `after_generation`: scan available markup/code and request revisions for important findings.
3. `before_final`: ensure P0/P1 issues are absent or explicitly acknowledged.

## Recommended Prompt Shape

```text
Use the Impeccable skill guide and @Impeccable connector.
Call impeccable_workflow for <command> before generating UI.
After generation, call impeccable_detect_markup if markup/style text is available.
Call impeccable_checkpoint before final.
```
