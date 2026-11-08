# Agent configuration engine (PR 1)

`impeccable agents` manages one user installation at a time. The initial
targets are Claude Code and Codex. Pass an explicit account root in the
request; no account is inferred from the current project.

## JSON interface

All commands emit one JSON response with `schemaVersion: 1`. Requests use
`version: 1` and `--spec <path|->`:

```json
{
  "version": 1,
  "owner": "impeccable-loop",
  "harness": "claude",
  "root": "/Users/example/.claude",
  "hooks": [{"event":"PreToolUse","matcher":"Edit","command":"loop-hook"}],
  "mcpServers": [],
  "instruction": "Caller supplied instructions"
}
```

The supported verbs are `capabilities`, `plan`, `apply`, `undo`, `status`,
and `recover`. `capabilities` does not need a spec. The journal schema is
version 1 and lives below `~/.impeccable/agents`; set
`IMPECCABLE_AGENTS_HOME` to isolate it in tests. The lock wait is ten seconds.

Exit codes: 0 success; 1 I/O failure; 2 invalid request; 3 lock timeout; 4
unsafe, ambiguous, invalid, or unsupported journal/settings state. Errors have
stable `code` fields. A newer journal is refused before edits.

## Resources and safety

Installations are keyed by owner, harness, and explicit account root. Hook
manifests and instruction files are owned resources. Undo restores exact
previous bytes only when the managed write is still unchanged; drift is
reported and left untouched. Instruction blocks use
`<!-- impeccable:<owner> start -->` and `<!-- impeccable:<owner> end -->`.
The body is caller supplied. Marker syntax inside a body is reserved.

Settings must be plain JSON objects. Invalid JSON and unexpected shapes are
refused. The private journal directory is mode 0700 and journal files mode
0600. The engine does not inspect credential stores or execute instruction
bodies. Commands supplied in requests are trusted caller input.

## Person actions

Codex hook installation still requires approval through `/hooks`; Codex also
uses folder trust. The engine reports these as manual actions and never
approves hooks or changes trust on the person's behalf.

## Current boundary

This first version is limited to user scope for Claude Code and Codex. Project
scope, additional harnesses, migration of the existing design hook, MCP CLI
integration, crash recovery for interrupted writes, and journal import are
follow-up work.
