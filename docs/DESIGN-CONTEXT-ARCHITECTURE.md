# Design context architecture

How the design interview, the design context document, and everything the user
gives us during the seed process are organized, and why.

## The problem this layout solves

The design context is one product concept. Before this layout it was scattered
across two directories with no owner:

- `.impeccable/design-interview/` held the questionnaire submission, uploaded
  fonts, staged brand assets, and two runtime files.
- `.impeccable/visual-cues/` held the cue generation workspace, and also, buried
  inside `cues.json`, the `context` object carrying the entire chat half of the
  interview plus the `modes` set. Neither is a generation artifact.
- The design context document was not a file at all. It was a client-side render
  that existed only after a submit, died with its session, and could not be
  reopened.
- Three scripts hardcoded the storage directory independently, with no shared
  constant. The agent-side poll CLI treats a missing session file as a clean
  exit, so a half-finished rename would fail silently and no test would catch it.

Export, import, resume, rebuild, and edit each had to reassemble state from those
places with implicit coupling. One canonical store with one code owner replaces
that.

## File layout, in the user's project

```
.impeccable/design-context/          the store: the one exportable unit
  context.json    { schemaVersion, modes, context }   the chat half of the run
  answers.json    the questionnaire submission, flat form-field shape
  assets/         brand files the user supplied
  fonts/          font faces the user uploaded
  cue.png         the chosen hero, copied at submit
  runtime/        session.json, journal.jsonl, draft.json   (gitignored)
  exports/        design-context.md, design-context.bundle.json   (gitignored)

.impeccable/visual-cues/             the generation workspace, unchanged
  brief.md, <slug>.png x6, cues.json (cues + palette only), fonts.json
```

The reasoning, in the order the decisions were made:

1. **Durable versus regenerable is the axis.** It matches the policy this repo's
   own `.gitignore` states: generated sidecars and config may be tracked, but
   runtime recovery state and local assets stay local. Everything in the store
   above `runtime/` is a user decision or a user-supplied file, so it is
   trackable and exportable. The workspace is regenerable process output and
   stays ignored.
2. **`context.json` moves the chat half out of `cues.json`.** The context object
   was never a cue artifact. It rode there because that was the only file the
   picker served. With its own home it survives cue regeneration, imports without
   dragging six hero images along, and can be edited by the save flow without
   touching the generation workspace.
3. **`cue.png` makes the document self-sufficient.** The Color article renders
   the chosen cue only when the cue manifest still lists it, which means the
   document breaks once the workspace is cleaned or in a project that received
   the context by import. Copying the one chosen hero into the store at submit
   time costs a few hundred kilobytes and buys rendering independence. The five
   unpicked heroes stay in the workspace as art direction leftovers.
4. **`runtime/` isolates ephemera.** Session discovery, the journal, and the
   mid-questionnaire draft never belong in an export or a commit. One gitignore
   line covers all of it permanently.
5. **PRODUCT.md and DESIGN.md stay at the project root.** They are the canonical
   documents the whole toolchain reads. `context.json` carries distilled copies
   with provenance, never replacements. Edits that touch product truth reconcile
   back into PRODUCT.md through the agent rather than the store growing a second
   product record.

## Code layout

The shape mirrors `skill/scripts/live/`, which solves the same class of problem.

```
skill/scripts/design-context/
  store.mjs            the only code that knows store paths or writes store files
  bindings.mjs         the editable-field registry for the document
  session-routes.mjs   HTTP handlers for the document edit session
  portability.mjs      the export bundle format and its import validation

skill/scripts/
  picker-server.mjs      static serving, boot contract, submit, autosave, spawn
  picker-doc-session.mjs the session shell: http server, timers, token
  picker-doc-poll.mjs    the agent's poll CLI
  design-context-export.mjs / design-context-import.mjs

picker/scripts/
  boot.js              one memoized fetch of the boot contract
  hydrate.js           restoring a previous run into the questionnaire
  palette-picker.js    the questionnaire; owns running hydration
  design-context.js    the document; document mode, pending ledger, save bar
```

Three ownership rules keep this correct as it grows.

**store.mjs is the single writer of store files.** Server, session, and import
all go through it. Every write is atomic: write a temporary file beside the
target, then rename over it, so a reader never sees a torn file.

**Reads come off disk per request.** Files are the truth. Process memory is a
cache at best. This is live mode's stat-keyed cache rule in its simplest form,
which is all a small store needs.

**During a live session, only the session process writes store files.** The agent
edits its own documents, DESIGN.md and PRODUCT.md, directly. Any answer or
context updates it needs to make ride in its reply payload for the session to
apply. Without that split, an agent doing a read, modify, write cycle on the
answers file can silently drop a change the session wrote in between.

## The live session

The document is a working surface, not a report. The patterns below are taken
from live mode, scaled to one page, one store, and one agent.

1. **Append-only journal with pure replay.** The session appends one line per
   render-relevant event to `runtime/journal.jsonl`: applied changes, batch
   transitions, and request transitions. A booting session replays the file to
   recover its sequence number and any unacknowledged batch. Lines it cannot use,
   including records written by an older release that carry no sequence number,
   become diagnostics rather than failures.
2. **Stage, then apply.** Edits accumulate in a client-side ledger keyed by field
   binding. Re-editing a field updates the new value but keeps the first original,
   so the record of what changed stays true across repeated edits.
3. **Delivery that survives a dead agent.** One batch is outstanding at a time and
   is journaled. A poll leases it, a reply acknowledges it, and a session restart
   re-offers anything unacknowledged. An invalid reply returns a corrective hint
   while the lease holds, so the agent can fix its own message.
4. **Server-owned truth, DOM as cache.** The state endpoint carries the journal
   sequence and the current batch. The client compares sequence numbers and
   re-fetches when the server has moved ahead. That re-fetch and re-render is the
   hot reload. The count of staged changes before Apply is the client's own,
   because nothing has reached the server yet.
5. **One in-flight lock.** While a batch is unacknowledged the document's edit
   affordances are disabled. A re-render triggered by anything else re-applies
   still-staged edits onto the fresh DOM, so a background event never wipes work
   the user has not saved.
6. **Loopback discovery with a per-run token.** The session records its process
   id, port, and token; readers probe liveness before trusting the record; the
   token, not the origin, is the security boundary.

What was deliberately left out, because each answers a question this surface does
not ask: the evidence gathering and verification pipeline and the repair loop
(live cannot know which source file a DOM edit belongs to, while every field here
has an authoritative address and applying is a deterministic write); server-sent
events and reload-resume state (a two-second poll already covers it); poll lanes
and priorities and chunking (one agent, one batch); the roots manifest (one fixed
path under the project root).

## Data flow

```
SEED
  agent stages assets into the store, runs the cue pipeline, writes the
  workspace and the store's context.json, then launches the picker
  client boots, prefills from a draft or a previous submission, autosaves
  submit writes answers, copies the chosen hero, forks the session, exits 0
  agent seeds DESIGN.md from the answers, then enters the edit loop

REOPEN
  the picker server runs in document mode, reusing or spawning a session
  the client renders the document directly, with no submit
  the session ending is the agent's completion signal

EDIT
  staged changes leave the ledger as one batch, the session applies them to
  the store and queues the downstream work, the agent reconciles DESIGN.md
  and PRODUCT.md prose and replies, the sequence advances, the tab re-fetches
  and re-renders

EXPORT AND IMPORT
  the store compiles to a readable markdown document plus a lossless bundle
  importing a bundle rebuilds a working store in another project
```
