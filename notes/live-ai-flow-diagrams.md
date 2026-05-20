# Live AI Flow Diagrams

These diagrams explain the difference between the existing Go pathway, the stuck direct copy-edit Save pathway, and the restored staged copy-edit Apply pathway.

The Go pathway uses the existing long-poll agent loop: the browser queues work, and an agent polling through `live-poll.mjs` handles it. Copy edits now stage immediately on Save, then the Apply copy edits dock runs one batched AI source-apply operation.

## Go Pathway

```mermaid
sequenceDiagram
  participant User
  participant Browser as Live Browser UI
  participant Server as Live Server
  participant Poll as live-poll.mjs
  participant Agent as AI Agent
  participant Source as Source Files
  participant App as Dev App / HMR

  User->>Browser: Pick element + click Go
  Browser->>Server: POST /events { type: "generate" }
  Server->>Server: Validate, journal, enqueue
  Agent->>Poll: Run live-poll.mjs
  Poll->>Server: GET /poll
  Server-->>Poll: generate event
  Poll-->>Agent: JSON event
  Agent->>Source: Write variant source
  Source-->>App: HMR update
  App-->>Browser: Variants appear
```

## Previous Stuck Copy Pathway

```mermaid
sequenceDiagram
  participant User
  participant Browser as Live Browser UI
  participant Server as Live Server
  participant Queue as Pending Queue
  participant Agent as Human/Chat Agent
  participant Source as Source Files

  User->>Browser: Edit text + Save
  Browser->>Server: POST /events { type: "manual_edit_apply" }
  Server->>Queue: Enqueue copy edit
  Note over Queue,Agent: No automatic worker was applying it
  Queue-->>Browser: No done/error reply
  Browser->>Browser: Loading keeps spinning
  Agent->>Queue: Manually notices pending event
  Agent->>Source: Applies edit
  Agent->>Server: Reply done
```

## Target Staged Copy Apply Pathway

```mermaid
sequenceDiagram
  participant User
  participant Browser as Live Browser UI
  participant Server as Live Server
  participant Commit as live-commit-manual-edits.mjs
  participant Worker as Batch AI Runner
  participant AI as codex / claude
  participant Buffer as Pending Copy Buffer
  participant Source as Source Files
  participant App as Dev App / HMR

  User->>Browser: Edit text + Save
  Browser->>Server: POST /manual-edit-stash
  Server->>Buffer: Stage rich edit context
  Browser->>Browser: Show Apply copy edits dock
  User->>Browser: Click Apply copy edits
  Browser->>Server: POST /manual-edit-commit
  Server->>Commit: Run page-scoped batch apply
  Commit->>Worker: Build prompt with all staged ops + candidates
  Worker->>AI: Apply smallest source edits + related references
  AI->>Source: Update true source files
  Commit->>Commit: Cleanup and validation checks
  Commit->>Buffer: Clear successful entries only
  Source-->>App: HMR update
  Server-->>Browser: { applied, failed, files, cleared }
  Browser->>Browser: Hide dock or keep failed staged edits
```
