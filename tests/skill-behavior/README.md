# Skill-behavior tests

LLM-backed scenarios that verify how the impeccable skill drives context,
command-reference, new-work, and native-platform loading. Each scenario runs
against one current model from each supported provider (Anthropic, OpenAI,
Google, DeepSeek).

These are the tests you re-run when you refactor anything in SKILL.md's
`## Setup` section. They fail when the agent stops following the loading
contract.

## Run

```bash
bun run test:skill-behavior
IMPECCABLE_SKILL_BEHAVIOR_VERBOSE=1 bun run test:skill-behavior   # dump per-scenario traces
IMPECCABLE_SKILL_BEHAVIOR_MODELS=claude-sonnet-5 bun run test:skill-behavior   # scope to one model
IMPECCABLE_SKILL_BEHAVIOR_EFFORT=xhigh bun run test:skill-behavior             # OpenAI reasoning effort (default: high)
```

Requires `.env` at repo root with at least one of `ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, `GOOGLE_CLOUD_API_KEY`, `DEEPSEEK_API_KEY`. Providers without a key are
skipped, not failed.

Also requires the engine binary (`bun run fetch:engine`, or `IMPECCABLE_BIN`).
The staged skill dir ships the launcher (`scripts/impeccable`); the harness
exports `IMPECCABLE_BIN` into every bash call the agent makes, so the launcher
resolves the binary in both symlink and copy mode without a download. Without a
binary the suites skip.

To run a single scenario against one model:

```bash
IMPECCABLE_SKILL_BEHAVIOR_MODELS=claude-sonnet-5 IMPECCABLE_SKILL_BEHAVIOR_VERBOSE=1 \
  node --test --test-timeout=600000 --test-name-pattern="scenario 6" tests/skill-behavior/scenarios.test.mjs
```

## How it works

Each scenario:

1. `prepareWorkspace()` mints a temp dir, symlinks the canonical skill
   into `<workspace>/.claude/skills/impeccable` (so its launcher is at
   `.claude/skills/impeccable/scripts/impeccable`), and optionally writes
   `PRODUCT.md` / `DESIGN.md` fixtures.
2. `runTurn()` inlines `SKILL.md` (placeholders neutralized) as the
   system prompt and runs Vercel AI SDK `generateText` with four
   workspace-scoped tools: `bash`, `read`, `write`, `list`, and a fake
   provider-neutral `ask_user_question` backed by a deterministic simulated user.
3. The tools record every call into a `trace` that the test asserts on.
4. For scenario 4, a second `runTurn` reuses turn 1's `responseMessages`
   so the model sees a real multi-turn conversation.

The trace is the source of truth, not the model's free-form reply.

## Scenarios

| # | Setup | Assertion |
|---|---|---|
| 1 | empty workspace | runs `impeccable context`; loads `reference/init.md` before implementation; automation is not an init bypass |
| 2 | PRODUCT.md only | runs `impeccable context` 1-3 times; loads `reference/new-work.md` to resolve visual authority, establish a world when needed, and develop the surface |
| 3 | PRODUCT.md + DESIGN.md | runs `impeccable context` 1-3 times; receives the committed design system and loads `reference/new-work.md` for the task-scoped concept |
| 4 | PRODUCT.md + DESIGN.md, context already loaded in turn 1 | turn 2 does **not** re-run `impeccable context` |
| 5 | PRODUCT.md without the legacy `## Register` field and no DESIGN.md | runs `impeccable context`; greenfield craft loads `reference/new-work.md`, not init, to establish the missing world |
| 6 | PRODUCT.md + DESIGN.md + a minimal `index.html`; prompt is `/impeccable polish` | loads `reference/polish.md` |
| 7 | same fixture; prompt is `/impeccable audit` | loads `reference/audit.md` |
| 8 | PRODUCT.md + DESIGN.md + a SvelteKit scaffold (`src/app.css`, components, `+page.svelte`); prompt is `/impeccable polish src/routes/+page.svelte` | reads at least one project code file (CSS / component / page) — not just the skill's reference files |
| 9 | PRODUCT.md + `index.html` + a seeded update cache with a newer version (`skillVersion` copy-mode so `impeccable context` has a `SKILL.md` to version-check against); prompt is `/impeccable polish index.html` | `impeccable context` runs and its output carries the `UPDATE_AVAILABLE` directive (proven via captured bash output); the agent does **not** auto-run `npx impeccable update` (it must ask first) |
| 10 | no PRODUCT.md + a minimal `index.html`; prompt is `/impeccable polish index.html` | runs `impeccable context`, loads `reference/polish.md`, and does **not** divert into `reference/init.md` |
| 11 | empty workspace; prompt is `/impeccable shape ...` | runs `impeccable context`; resolves `reference/init.md` before planning the surface |
| 12 | empty workspace; prompt is natural-language build intent with no command word | runs `impeccable context`; resolves `reference/init.md` before implementation |
| 13 | empty workspace; prompt is `/impeccable teach` | runs `impeccable context` and diverts into `reference/init.md` because `teach` aliases `init` |
| 14 | PRODUCT.md with `## Platform: ios` (native iOS app); prompt is `/impeccable craft a tide detail screen` | `impeccable context` runs and emits the contents of `reference/ios.md` directly, placing native conventions in context without a second model-directed read |
| 15 | same iOS fixture; prompt is `/impeccable audit` | agent loads `reference/audit.native.md` (the Commands-table native variant, routed instead of `audit.md`) |
| 16 | existing surface, with and without PRODUCT.md; asks where to start | loads `routing.md`, delivers advice, and does not edit project files, start an interview, archive a critique, or run menu scans |
| 17 | existing surface; asks whether critique is required before polish | loads `routing.md` and both command references, then delivers advice without executing the playbooks |
| 18 | existing surface; explicitly requests polish followed by a next-command recommendation | loads `polish.md` rather than substituting workflow advice for the requested work |

## Workflow-advice baseline (PR #737)

The four cases in scenarios 16-18 are new; prior scenario results do not
establish their behavior. The advice-only assertions inspect write-tool calls
and file mutations from bash (excluding context's internal `.impeccable/`
state, but not critique reports), require an actual answer, and reject
interviews and menu scans. Scenario 18 checks command-reference precedence;
it does not assert completion of a full polish pass. These cases allow only
the exact context-loader command through bash; references use read/list, and
the write tool remains available for project files so unsolicited edits still
fail the test. Writes to the staged skill are rejected. This keeps the routing
measurement from running arbitrary shell searches outside its fixture.

| Scenario | claude-sonnet-5 | gpt-5.6-terra | gemini-3.7-flash |
|---|---|---|---|
| 16 (existing project) | not measured | not measured | not measured |
| 16 (missing product context) | not measured | not measured | not measured |
| 17 (command comparison) | not measured | not measured | not measured |
| 18 (explicit command) | not measured | not measured | not measured |

The workflow-contract file adds end-to-end assertions for attended fresh init,
an initialized natural build request, replacement-world redesign, scope-preserving bolder
refinement, and critique's closing question. It checks question order and
context/artifact writes rather than only reference-file loading.

`critique closes with the question or an explicit skip line` is a regression
guard, not a routing check. A critique that prints its report and then stops,
asking nothing and printing no `Questions skipped: <reason>` line, is an
incomplete run: the close is half the deliverable, and `polish` downstream has
no priorities to inherit without it. The fixture page is deliberately broken
enough to put the report past the three-Priority-Issue threshold, so the run
cannot reach the skip branch on merit. The assertion is deliberately loose about
*how* the run closes, because either close is valid; what it forbids is neither.

## Workflow-contract baseline (2026-08-13, current lineup)

Measured while checking whether an `{{ask_instruction}}` rewrite had regressed
anything.

**The last two columns are no longer in the default lineup.** `gpt-5.6-luna` and
`deepseek-v4-flash` were dropped in 2026-08 for being below the frontier tier:
they fail scenarios by stopping mid-run or archiving a report without stating
it, which is model-floor behavior rather than a skill-text defect. Their columns
stay here because they are the record of what a weaker model does with this text,
and that is the useful part. Reproduce with
`IMPECCABLE_SKILL_BEHAVIOR_MODELS=gpt-5.6-luna,deepseek-v4-flash`.

Against the current default lineup, two cells are the known floor:
`redesign replaces DESIGN` is flaky on every model, and `critique closes` is
flaky on gemini-3.6-flash. A regression is a failure beyond those two.

The Google slot in `DEFAULT_MODELS` moved to `gemini-3.7-flash` on 2026-08-15.
Every Gemini cell in the tables below was measured on 3.6-flash (or 3.5-flash
where marked), and per the cross-version rule further down, those results are
unmeasured on 3.7, not inherited. Re-run the sweep on the next Setup or routing
change and update the tables to the new column.

**Read any failure against the clock before calling it behavior.** The suite ran
at a 300s per-test timeout until 2026-08-13, and for the workflow-contract
scenarios that cap was below the runtime of a correct run. `initialized natural
build` on claude-sonnet-5 was measured at 579s when it stopped to put the
concept to the user before building, while the runs that skipped that checkpoint
and failed the assertion finished in 130-200s. The cap was therefore selecting
for the behavior the scenario forbids: thorough runs were killed, hasty ones
were graded. The timeout is now 900s (`scripts/test-suites.mjs`). A duration at
or just past the cap is a timeout, not a verdict.

| Scenario | claude-sonnet-5 | gpt-5.6-terra | gemini-3.6-flash | luna / deepseek (dropped) |
|---|---|---|---|---|
| attended fresh init | pass | pass | pass | not measured |
| initialized natural build | flaky (1 of 4, and see the clock note) | pass | pass | not measured |
| redesign replaces DESIGN | flaky (timeout this run) | **fail** | **fail (timeout)** | not measured |
| bolder refinement | pass | pass | pass (on 3.5) | luna pass, deepseek **fail** |
| critique closes | pass (4 of 4) | pass (3 of 3) | **flaky (1 of 4)** | luna **fail (1 of 6)**, deepseek flaky |

Gemini's `bolder refinement` and `critique closes` runs in this sweep died on
`AI_APICallError` / `ETIMEDOUT` before completing a turn. Network failures are
not behavior measurements and are excluded from the counts above.

## Scenario baseline (2026-08-13, current lineup)

Measured on the same sweep. `scenarios.test.mjs` passes 15 of 15 on
gpt-5.6-terra and gemini-3.6-flash. Only claude-sonnet-5 fails anything, and
that asymmetry is the finding: the two cells below fail on the frontier model
while two weaker-on-paper lineups route correctly, so read them as a text
problem that one model's priors expose rather than as a model floor.

| Scenario | claude-sonnet-5 | gpt-5.6-terra | gemini-3.6-flash |
|---|---|---|---|
| 1-7, 10, 12-15 | pass | pass | pass |
| 8 (SvelteKit exploration) | flaky | pass | pass |
| 11 (shape resolves the build gate) | flaky | pass | pass |

Scenarios 8 and 11 pass on re-run, so treat a single failure there as flake and
confirm with a second run before investigating.

Scenarios 9 and 15 both failed on sonnet when this baseline was first measured,
and the two causes are worth keeping because neither was where it looked:

- **9 was a real defect in the directive.** `UPDATE_AVAILABLE` said to ask the
  user, then "If they agree, run `npx impeccable update`", then to continue
  without waiting. With no wait there is no agreement to read, so the command
  was the only concrete instruction left standing and sonnet ran it. Fixed by
  removing the command from the turn entirely rather than by strengthening the
  warning around it.
- **15 was a broken fixture.** The iOS workspace held PRODUCT.md and nothing
  else, so `audit the app in this workspace` named an app that did not exist.
  Sonnet spent its whole step budget looking for it and read no reference file
  at all, which the assertion reported as "loaded `audit.md` instead of the
  variant". The fixture now ships one SwiftUI screen, the same courtesy
  `MINIMAL_LANDING_HTML` already did for the web scenarios. The scenario passes
  on unmodified `main` once the fixture is answerable, which is the proof the
  routing text was never at fault.

The general lesson is worth more than either fix: **an assertion reports the
property it checks, not the reason it failed.** Both of these read as routing
defects and neither was one. Pull the trace before writing the diagnosis, and
prefer `IMPECCABLE_SKILL_BEHAVIOR_VERBOSE=1` over inference from the message.

Gemini cells marked `on 3.5` were measured on the superseded `gemini-3.5-flash`
and have not been re-run on 3.6. That distinction is not pedantic. `critique
closes` passed twice on 3.5-flash, then failed three times in a row on 3.6-flash
against identical instruction text, and only passed once the report delivery step
was made explicit. A version bump inside one family changed the outcome, so treat
cross-version carryover as unmeasured rather than inherited.

`not measured` means exactly that: the cell was never run in isolation on this
lineup. Only the scenarios under investigation were scoped per model. The rows
are worth keeping anyway, since a scenario absent from the table is easy to
mistake for a scenario that passed.

**`bolder refinement`, deepseek-v4-flash.** The model runs `impeccable context`, reads
`bolder.md`, `craft-floor.md`, and `current.html`, then ends its turn without
editing anything: empty `writePaths`, no `ask_user_question` call, well short of
the 16-step cap. Confirmed identical on HEAD with `bolder.md` reverted, so it is
not a skill-text problem. Same shape as the gpt-5.4-mini scenario 6/7 failures
below: the model consumes the references and then declines to act.

**`critique closes`: the three ways a critique fails to land.** The scenario
asserts emission order, not just the presence of a question, because the command
fails in three distinct ways and only one of them was the reported bug:

1. *No close.* Report lands, no question, no skip line. `polish` downstream
   inherits nothing.
2. *Question before report.* The question is emitted first and the report after
   it, so the report is withheld until the user answers. Observed directly on
   gpt-5.6-luna, and the reason the invariant is a position rule ("the question
   is the LAST thing in the response") rather than a statement about prose order.
3. *Report never spoken.* The report is authored straight into the persistence
   heredoc, archived, and never written to chat. A perfect snapshot and a user
   who sees nothing.

Mode 3 is the one worth understanding, because it was structural rather than a
model quirk. `critique.md` described the report's format and then went directly
to writing a temp file, with no step that said to output the report. Both
gemini-3.6-flash and luna responded by bundling heredoc, snapshot write, trend
read, and cleanup into a single bash call and stopping. The `Deliver the Report`
section exists to close that gap, and it worked: gemini-3.6-flash failed three
consecutive runs before it, and its failures afterward all show the report
reaching chat.

**Mode 1 is not fixed on gemini-3.6-flash.** It passes 1 run in 3 on the final
text. Two structural attempts were made and neither settled it: the close was
promoted into Hard Invariants with a printable `Questions skipped: <reason>`
string, then made step 6 of the persistence list so it would sit inside the
numbered flow rather than after it (the shape that fixed mode 3). Both moved it
from consistently failing to intermittently passing, and further prose tuning
was not paying, so it stopped. claude-sonnet-5 and gpt-5.6-terra are clean.
Treat this cell as the known floor and re-measure rather than tuning blindly:
the next useful move is probably a structural one, such as making the close
something the run cannot syntactically finish without, not another paragraph.

Read the counts here as what they are: small samples on a nondeterministic
system, several of them gathered while the instruction text was still changing
between runs. They support "the close works on the current lineup" and not much
finer than that. Re-measure rather than assuming when the lineup changes.

**`redesign replaces DESIGN`, flaky.** It has failed on two different assertions
across runs (`designWrite > question` and `implementation > designWrite`), and on
one run claude-sonnet-5 exhausted the 300s per-test timeout instead of asserting.
The traces never load `document.md`; the ordering under test comes from
`new-work.md`. Re-run before believing a single red result here. Which model
produced which failure was not pinned down, so the row records only that the
scenario is unstable.

The `bolder` claude-sonnet-5 cell is unmeasured for a specific reason: the scoped
run that produced this table used a 180s cap, which sonnet exceeded. That is a
timeout, not a failure, and it is why the guidance below insists on 300000.

### Scoping a run while investigating

Both files honor `--test-name-pattern`, which is much cheaper than a full sweep
when bisecting one scenario:

```bash
IMPECCABLE_QUESTION_DISABLED=1 CI=1 IMPECCABLE_SKILL_BEHAVIOR_MODELS=deepseek-v4-flash \
  node --test --test-timeout=300000 --test-force-exit \
  --test-name-pattern="bolder refinement" tests/skill-behavior/workflow-contract.test.mjs
```

Keep `--test-timeout` at 300000. A tighter cap turns claude-sonnet-5's slower
runs into timeouts that look like failures. Set `IMPECCABLE_QUESTION_DISABLED=1`
and `CI=1` so `impeccable serve-question` cannot open a browser window on the host. Pipe
to a file rather than `tail`; node prints the failing-test summary at the end,
and truncating it costs you the per-model attribution.

## Baseline state (2026-05-20, previous cheap tier)

> **Historical record.** The default models are now `claude-sonnet-5` and
> `gemini-3.6-flash`. The table below was measured on an older cheap tier
> (`claude-haiku-4-5` / `gpt-5.4-mini`) and is kept as the historical record.
> Re-measure on the current lineup and update this section; the stronger
> models are expected to clear the scenario 6/7 routing failures that the old
> gpt tier showed.

Captured after moving sub-command reference loading from step 4 to step 2
of Setup (so the agent loads `reference/<command>.md` right after
`impeccable context`, before "doing the work" preempts it), and tightening
step 3 to require at least one project code read even when a sub-command
reference loads first. Use this table when comparing pre/post refactor:
a regression is "more failures than baseline", not "any failures at all".

| Scenario | claude-haiku-4-5 | gpt-5.4-mini | gemini-3.1-flash-lite |
|---|---|---|---|
| 1 (no context) | pass (rare flake — agent stops after `impeccable context` without loading `init.md`) | pass | pass |
| 2 (product only) | pass | pass | pass |
| 3 (product + design) | pass | pass | pass (rare flake — sub-command ref loads but world ref doesn't) |
| 4 (already loaded) | pass | pass | pass |
| 5 (no register field, task-cue cascade) | pass | pass | pass |
| 6 (`polish` routing) | pass | **fail** | pass |
| 7 (`audit` routing) | pass | **fail** | pass |
| 8 (existing project, explore design system) | pass | pass | pass |

21-22 / 24 typical. The stable failures are gpt-5.4-mini scenarios 6 and 7:
the model reads `index.html` (the target file), recognizes "polish" or
"audit" as a familiar action, and proceeds with the work without ever
loading the sub-command reference. Stronger SKILL.md wording (MUST,
"non-optional", reordered earlier) didn't move it; this looks like a
model-floor behavior rather than a skill ambiguity. Claude and Gemini
honor the load.
