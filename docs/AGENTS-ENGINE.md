# Agent configuration engine (PR 1)

`impeccable agents` manages one user installation at a time for Claude Code
or Codex. The caller supplies an explicit account root; the engine never
infers one from the current project.

## JSON interface

Commands emit one JSON response with `schemaVersion: 1`. Requests use
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

Supported verbs are `capabilities`, `plan`, `apply`, `undo`, `status`, and
`recover`. `capabilities` does not need a spec. Request and response schemas
are version 1; the journal schema is version 2 under
`~/.impeccable/agents`. Set `IMPECCABLE_AGENTS_HOME` to isolate it in tests.
The lock wait is ten seconds.

Exit codes: 0 success; 1 I/O failure; 2 invalid request; 3 lock timeout; 4
unsafe, ambiguous, invalid, or unsupported journal/settings state; 5 injected
failure used by recovery tests. Errors have stable `code` fields. A newer
journal is refused before edits.

## Resources and safety

Installations are keyed by owner, harness, and account root. Journal records
carry resource ids, state, original and last-written values, and installation
claims. Shared physical files can have claims from multiple Claude accounts.
Undo restores prior bytes when the file still matches the last write and no
other installation claims it. Otherwise it removes identifiable owner hook
entries or instruction blocks; drift it cannot identify safely is left in
place and reported.

Instruction blocks use `<!-- impeccable:<owner> start -->` and
`<!-- impeccable:<owner> end -->`. Markers must be unique, balanced,
standalone lines in order. The body is supplied by the caller and cannot
contain reserved marker syntax.

Claude MCP changes use the `claude` CLI with `CLAUDE_CONFIG_DIR`; Codex MCP
changes use `codex` with `CODEX_HOME`. Tests can inject `IMPECCABLE_CLAUDE_BIN`
and `IMPECCABLE_CODEX_BIN`. The engine checks names with `mcp get` and refuses
an unclaimed server name.

Claude settings and Codex hook manifests must be plain JSON objects. Invalid
JSON, duplicate keys, comments, and unexpected shapes are refused. Codex
`config.toml` hook enablement currently accepts a conservative comment-free
subset and refuses comments, duplicate keys, or unexpected table shapes.
State directories are mode 0700; journal, backup, and temporary files are
mode 0600. Writes use exclusive same-directory temporary files, fsync,
identity and hash rechecks, atomic rename, and post-write verification.
Write-ahead transactions let `recover` roll back targets still in their
recorded before/after state; changed targets are reported as conflicts and
left untouched.

The engine does not inspect credential stores or execute instruction bodies.
Request commands are trusted caller input.

## Person actions and scope

Codex hooks still need approval through `/hooks` and folder trust. The engine
reports these actions and never answers them for the person.

This PR is limited to user scope for Claude Code and Codex. Project scope,
additional harnesses, design-hook migration, and pristine journal import
remain out of scope.
