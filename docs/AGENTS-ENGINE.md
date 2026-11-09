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

Hooks may also carry `timeout` (seconds), and for Claude Code `async` and
`asyncRewake`; unset fields are omitted. Both harnesses get the same entry
shape under `hooks.<event>`: `{"matcher"?, "hooks":[{"type":"command",
"command", ...}]}`. Codex specs may list `mcpApprovals`
(`[{"server":"impeccable","mode":"approve"}]`), which set
`default_tools_approval_mode` on an existing standard `[mcp_servers.<server>]`
table; a missing server is refused (`server_missing`) and inline or dotted
server tables need a manual edit. Undo restores the prior mode. Reapplying
after the person changed that mode is refused (`approval_drift`), as is a Codex
config with `features.hooks = false` (`hooks_disabled`): the engine never turns
the person's global hook switch back on. Undo leaves an instruction block whose
body was edited in place and reports it as a conflict, and an apply that would
replace a block holding neither the last-written nor the requested body is
refused before anything is written (`instruction_drift`), journal or not. Undo also
leaves a managed hook whose entry the person edited (same command, other
fields) and reports it as `<path>#hook:<event>:<command>` in `conflicts`.
Undo without a journal is refused (`journal_missing`) while this installation's
block is in the rule file or one of its exact hook entries is in the JSON hook
file (shared settings such as Codex's `features.hooks` don't count); with none
of that on disk, it returns `removed: false`. A hook entry that was there before
the install is never reported as edited.

Supported verbs are `capabilities`, `list`, `plan`, `apply`, `undo`, `status`,
and `recover`. `capabilities` and `list` do not need a spec.

`list` is the setup report: every committed installation in the journal, with
`owner`, `harness`, its hook `event`s and `matcher`s, whether it wrote an
instruction, the MCP server names it added or approved, and each resource's
`kind` and `state` (`created`, `preexisting`, `conflict` when the file no
longer holds what the engine wrote, or `unchecked` when the harness CLI that
would check it can't run). It also returns the engine's own `engineVersion`, a
count of `pendingTransactions` that `recover` would settle, and a count of
`unreadableJournals` (invalid, or written by a newer engine), which it skips
rather than failing the whole report. It is read-only, takes no lock, and returns no path, command, account
root or instruction text, so a signed-in client may send it to a server. Like
`status`, checking a Claude MCP server runs `claude mcp get`. Request and response schemas
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
other installation claims it. That holds across reapplies too (for example
installing first and enabling approvals later), as long as nothing outside the
engine changed the file between them. Otherwise it removes identifiable owner hook
entries or instruction blocks; drift it cannot identify safely is left in
place and reported.

Instruction blocks use `<!-- impeccable:<owner> start -->` and
`<!-- impeccable:<owner> end -->`. Markers must be unique, balanced,
standalone lines in order. The body is supplied by the caller and cannot
contain reserved marker syntax.

Claude MCP changes use the `claude` CLI with `CLAUDE_CONFIG_DIR`; Codex MCP
changes use `codex` with `CODEX_HOME`. Tests can inject `IMPECCABLE_CLAUDE_BIN`
and `IMPECCABLE_CODEX_BIN`. The engine observes servers with `claude mcp get`
or `codex mcp get --json`, records each server's last-written configuration,
and refuses a name already owned outside the engine. Matching servers claimed
by another owner share one resource; the CLI removes it only after the last
claim is released. If the observed configuration drifts, undo reports the
server conflict and leaves it untouched.

Claude settings and Codex hook manifests must be plain JSON objects. Invalid
JSON, duplicate keys, comments, and unexpected shapes are refused. Codex
Codex `config.toml` is parsed with `toml_edit` 0.22 and literal key lookups.
The engine preserves source bytes outside the touched `features.hooks` key,
including comments, inline tables, quoted dotted server names, and CRLF
line endings. Invalid TOML, duplicate keys, or unexpected `features` shapes
are refused before writing.
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
