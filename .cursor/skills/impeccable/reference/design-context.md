# Design Context

Loaded by `/impeccable design-context`. Owns the design interview record, the document built from it, and its portable form. The interview itself is created by `/impeccable document` seed mode; this command is everything afterwards.

## Where it lives

One store, under the project root:

```text
.impeccable/design-context/
  context.json    the chat half of the interview: product, audience, brand, interview
  answers.json    the questionnaire's decisions
  assets/         brand files the user supplied
  fonts/          font faces the user uploaded
  cue.png         the chosen cue image, copied at submit
  runtime/        session.json, journal.jsonl, draft.json (local, gitignored)
  exports/        the written-out forms (local, gitignored)
```

`.impeccable/visual-cues/` is separate on purpose: it is the generation workspace, regenerable and gitignored, and the document no longer depends on it. The store is the user's own record and is theirs to commit.

## No argument

Report status in two lines, then act:

- Whether `answers.json` exists, and when it was last written.
- Whether a draft is waiting (`runtime/draft.json`), whether DESIGN.md is seeded, and whether a session is live (`runtime/session.json` naming a running process).

With answers on disk, do `open`. Without them, say the design context is created by the questionnaire and offer `/impeccable document`. Never start the questionnaire unasked.

## open

Reopen the document, live for edits.

Run `node .cursor/skills/impeccable/scripts/picker-server.mjs --doc` from the project root as a foreground command and parse its `PICKER_URL` line. Open it and wait exactly as [visual-cues.md](visual-cues.md)'s launch paragraph does: its harness-browser ladder (in-IDE browser first, then another browser tool, then the system opener, then telling the user the URL) and its wait-on-the-foreground-process rule. Skip everything earlier in its Step 7: the cue announcement and the `modes` and `context` writes belong to a run that is generating cues, and this one is not.

Then enter the document edit loop below. The process exiting is the signal:

- `DOC_SESSION_ENDED` and exit 0: the document was closed. Say so in one line; the loop is over.
- Exit 2: it timed out or was never opened. Say it can be reopened with the same command, and never relaunch unprompted.
- Exit 1: no interview exists. Route to `/impeccable document`.

## edit

Re-run the questionnaire over the previous answers.

Say in one line what it will do before launching, and settle DESIGN.md in the same breath, because a new run replaces the seed the last one produced: *"This re-runs the questionnaire with your previous answers filled in. When you finish, I will refresh DESIGN.md from the new answers. Refresh it, overwrite it, or merge by hand?"* That is the whole consent for this run; do not ask again afterwards.

Then run `node .cursor/skills/impeccable/scripts/picker-server.mjs`, using the same launch ladder and wait rule as `open`. Prefill happens on its own: an unfinished run resumes from its draft, a finished one loads its answers, and `--fresh` starts blank. Cues and `context.json` already exist from the previous run, so do not regenerate cues and do not repeat Step 7's pre-launch writes.

On exit 0, go to [document.md](document.md) Steps 5-6 and write the seed from the new `answers.json`, honoring the choice made before launch. On exit 2, nothing was answered and nothing changed.

If `.impeccable/visual-cues/cues.json` is missing, the questionnaire cannot run: its palette screen loads the dealt cues and the built-in seeds together and neither arrives without that file. Say so and offer a full `/impeccable document --seed` run instead.

## export

```text
node .cursor/skills/impeccable/scripts/design-context-export.mjs [--out DIR] [--no-assets]
```

Writes two files and prints an `EXPORTED` line for each. Tell the user what each is for, in one line each:

- `design-context.md` is the design context as one readable document. It is what to hand another tool, another agent, or a collaborator who needs to follow this design.
- `design-context.bundle.json` is the same context in a form `/impeccable design-context import` reads, including the files the user supplied.

Do not read the export back into the conversation; the user asked for a file, not a recitation.

## import

```text
node .cursor/skills/impeccable/scripts/design-context-import.mjs <bundle.json> [--design skip|write] [--force]
```

It refuses a project that already has a design context unless `--force`, and refuses while a document is open either way. Report what it prints:

- `DESIGN_MD carried` with a DESIGN.md already here: ask whether to refresh it from the imported context, overwrite it, or merge by hand, then act.
- `DESIGN_MD carried` with none here: offer to write it (`--design write`) or to re-seed from the imported answers through [document.md](document.md) Steps 5-6.
- `DESIGN_MD absent`: say the bundle carried decisions but no design document, and offer to seed one.

Then offer `open`.

## The document edit loop

The document is a working surface. Follow [visual-cues.md](visual-cues.md)'s "The document edit loop" section; it is the canonical contract for polling, the event kinds, and the reply commands. Two things to hold on to while you are in it:

- **The session is the only writer of the store.** Never edit `answers.json` or `context.json` yourself while a session runs. Values you settle travel on your reply, through `--answers` or `--context`. DESIGN.md and PRODUCT.md are yours to write directly.
- **A `save_batch` is already applied.** The user's values are in the store before you hear about them. Your work is the prose those values leave stale, in whichever document the event's `downstream` names.

## Pitfalls

- Never poll `answers.json` while a server runs. The process exiting is the signal.
- Never drive the questionnaire yourself. The answers are the user's, and a run you filled in is a run they did not make.
- Editing in the document changes values that are already there. A field the interview never captured is added by asking through the document's own request control, not by this command.
