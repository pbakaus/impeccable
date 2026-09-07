# Skill-behavior tests

LLM-backed scenarios that verify how the impeccable skill drives context,
command-reference, new-work, and native-platform loading. Each scenario runs
against the default Anthropic, OpenAI, and Google models. DeepSeek remains
available through `IMPECCABLE_SKILL_BEHAVIOR_MODELS`.

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
resolves the binary in the generated fixture without a download. Without a
binary the suites skip.

To run a single scenario against one model:

```bash
IMPECCABLE_SKILL_BEHAVIOR_MODELS=claude-sonnet-5 IMPECCABLE_SKILL_BEHAVIOR_VERBOSE=1 \
  node --test --test-timeout=600000 --test-name-pattern="scenario 6" tests/skill-behavior/scenarios.test.mjs
```

## How it works

### Protocol versus full completion

`test:skill-behavior` now runs only `scenarios.test.mjs`. Routing cases stop
at the successful reference/context checkpoint they assert, with a ten-step
ceiling; shell access is context-only. They do **not** claim that a page was
built or reviewed. Editing/fallback controls retain their original assertions.
The focused S1/S2/S3/S4/S19 rerun passed 21/21 across the three default models.
A broader run exposed the context-only allowlist rejecting Svelte's valid
`+page.svelte` target. It was stopped, the allowlist fixed with a failing-then-
passing unit test, and S8 passed 3/3 on the focused rerun. Failed file reads
do not count as project exploration.

Full workflows moved to `tests/skill-workflow/full-build.test.mjs`:

```bash
bun run fetch:engine
bunx playwright install chromium
bun run test:skill-workflow
```

This separately billed suite defaults to Claude only; use
`IMPECCABLE_SKILL_BEHAVIOR_MODELS` to explicitly choose another model or sweep.
It preflights a local server and Chromium before each provider turn, exposing
real desktop/mobile screenshot and PNG viewing tools. Text-only fixtures use
system fonts and block external browser requests. No extra skill prose is added.
The API harness is not the actual Claude Code host, nor is its shell sandboxed.

Each workflow has a 50-step/840-second ceiling. Reaching a budget or output
limit fails explicitly; routing checkpoints cannot satisfy completion. UI
workflows require desktop and mobile captures matching the final local sources after
its last edit. Approval/brief-before-code and redesign documentation-at-finish
checks remain, as does exactly one context load across the completed turn.
CI runs this lane only when its manual `skill_workflow` checkbox is enabled.
Ordinary protocol CI now fetches its engine instead of silently skipping for
a missing binary. Full-build results must be reported separately from routing.

Each scenario:

1. `prepareWorkspace()` uses the production transformer to build current source
   into an independent `<workspace>/.claude/skills/impeccable`. References have
   resolved placeholders and generated degraded reviewer/documenter files.
   Host-specific blocks are omitted: this is a neutral API harness, not an exact
   Claude/Codex/Gemini host simulation. It optionally seeds project fixtures.
2. `runTurn()` inlines `SKILL.md` (placeholders neutralized) as the
   system prompt and runs Vercel AI SDK `generateText` with five
   tools: `bash`, `read`, `write`, `list`, and a fake
   provider-neutral `ask_user_question` backed by a deterministic simulated user.
3. The tools record every call into a `trace` that the test asserts on.
4. For scenario 4, a second `runTurn` reuses turn 1's `responseMessages`
   so the model sees a real multi-turn conversation.

The trace is the source of truth, not the model's free-form reply.

File tools are workspace-scoped; bash is a real host shell, **not a security
sandbox**. Use disposable synthetic fixtures. Shell helpers do not inherit
provider API keys/auth tokens; model calls still use the parent's keys. The
harness always sets `IMPECCABLE_QUESTION_DISABLED=1` for shell calls so real
decision pages cannot wait for a nonexistent browser user. The engine returns
its genuine structured-question fallback; browser decisions have separate E2E.

Set `IMPECCABLE_SKILL_BEHAVIOR_TRACE_DIR=<directory>` to retain per-turn JSON
with model, prompt, tool results, response ordering, usage, and finish reason.
Progress and failed turns retain their tool traces too; only completed turns
carry the full response sequence and final usage.
These are local diagnostic artifacts; inspect before sharing. Successful reads
or full reference content in shell output count as loading; filename mentions,
denied commands, and failed reads do not.

Context-only controls permit the real launcher with an optional workspace-relative
`--target`; compound commands remain rejected. The target form is part of the
skill's Setup contract, not a launcher failure.

## Release investigation (2026-09-07)

The initial release sweep reported 68/81 passes. Do not interpret its 13 failed
assertions as 13 demonstrated product regressions. The harness staged raw
references with unresolved placeholders, omitted generated degraded roles, and
allowed unanswered browser decisions. Its redesign assertion was also stale:
current `new-work.md` requires a surface brief **before code**, and DESIGN.md
**at finish**, from the built world. The corrected lifecycle checks retain
approval, brief, implementation, and final documentation requirements; missing
artifacts now have their own error instead of being called premature edits.
The historical tables below retain their original measurements and methods.

Focused launcher-fallback verification on the corrected fixture:

| Default model | Old fallback paragraph | Explicit pre-tool warning paragraph |
|---|---:|---:|
| `claude-sonnet-5` | 2/3 | 3/3 |
| `gpt-5.6-terra` | 3/3 | 3/3 |
| `gemini-3.7-flash` | 1/3 | 3/3 |

The three cases are denied editing, successful-loader control, and denied
planning. The old-paragraph failures were warning order, not refused edits.
An intermediate candidate run scored 8/9 because the control rejected valid
`context --target index.html`; after correcting that allowlist, the full focused
rerun passed 9/9. This is one measured run per variant, not a reliability estimate
or an all-workflow pass. Broader routing and workflow results remain separate.

On the resolved fixture, Gemini's workflow run passed 4/5: the completed new
page omitted user confirmation. Tightening the existing question paragraph
made its focused build lifecycle rerun pass 1/1. OpenAI passed all five workflow
cases with the fixture corrections alone. These are incremental measurements,
not one full sweep on the final candidate.

Claude's three-step routing sweep cut off two setup cases before loading
`new-work.md`. Both loaded it in bounded six-step diagnostics. Claude now has
the same six-step setup allowance as Gemini; reference and edit-order assertions
are unchanged. A full-build baseline separately hit the existing 840-second
deadline and is not counted as a pass.

The complete routing-only sweep retained its original budgets and passed 55/57
(Claude 17/19, OpenAI 19/19, Gemini 19/19). A six-step Claude rerun passed the two
previously clipped cases but exposed a separate context reload on turn two:
the model queried the loader again for image-tool availability. That run was
stopped after five passes and this failure rather than finishing another billed
sweep; the once-per-session assertion remains unchanged.

A saved Claude build trace used five calls shortening/counting the direction
contract, then reached the 22-step cap before implementation. The word target
is now approximate, with the six required blocks retained. A subsequent run
correctly stopped for missing customer evidence: the default simulated user had
selected “I have real details,” then promised them in a future message. The
case-study test now supplies a complete, explicitly synthetic brief when asked;
fresh-init and other user simulations are unchanged. Neither incomplete build
is counted as a pass.

The corrected-user Claude retest also remained incomplete: it asked, recorded
the six-block brief without the earlier word-count loop, then spent the remaining
22-step allowance acquiring and inspecting fonts before writing HTML. The
26-step redesign run produced the page and desktop/mobile captures but stopped
before DESIGN.md. These results do not establish full workflow completion.
Further work should separate narrow protocol checks from realistic, provisioned
full-build runs rather than keep adding skill prose or relaxing finish gates.
The later Claude run passed fresh init and refinement, failed the two bounded
build cases, and was stopped during critique's browser-tool discovery. Its
unfinished critique case is not a pass; the earlier OpenAI/Gemini critique
results remain the completed measurements.

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
| 19 | tiny spacing edit with PRODUCT.md + DESIGN.md; Bash denied, a real-loader success control, and a denied-launcher planning-only case | edits require successful playbook/craft-floor reads and a pre-edit denial warning; planning stays read-only and skips craft-floor |

## Setup launcher-failure branch (2026-09-06, PR #750)

Scenario 19 injects a host permission error before any shell command executes,
including retries and compound commands. File tools remain available; the
staged skill is read-only. Assertions require successful reads, an actual UI
edit, unchanged context files, and disclosure before the first write in the
assistant message sequence. Failed read attempts and shell commands merely
mentioning a reference do not count as loading it. The success control allows
only the real context-loader command through Bash and requires exit 0.

The suite measures continuation after a tool refusal, not Claude's skill
activation or plugin substitution. Those are separate loader/path checks.
It also does not establish behavior for every missing-binary or runtime error.

Focused baseline (2026-09-06): both scenario 19 cases passed on
`claude-sonnet-5`, one run each. The original wording also continued after
denial in the comparison run, but disclosed the failure only in its final
summary. This does not reproduce the reporter's complete reference-loading
failure or establish a multi-provider pass. An earlier scenario 6 result used
attempt-based reference assertions and is not counted as a success control.

### Refusal follow-up (2026-09-06, #744)

The provider-neutral harness models a loaded skill with a known base directory
using synthetic workspace-relative host metadata, not each provider's exact
generated prompt. The source instructions and `<skill-base-dir>` resolution
remain under test; reference reads still have to succeed. Provider transforms
and plugin loading have separate path/loader tests. The harness also sets an
explicit 16,384-token response ceiling for DeepSeek: the Anthropic-compatible
SDK otherwise treats that model as unknown and caps it at 4,096. Truncation
still fails the scenario; this changes the test runner, not the shipped skill.

The unchanged-source baseline with directory metadata passed 5/8 focused
cases: Sonnet skipped craft-floor in its successful-launcher control, OpenAI
stopped without editing after denial, and Gemini warned only after editing.
DeepSeek passed both cases. An initial candidate got OpenAI to edit but still
warned late on Sonnet, OpenAI, and Gemini; DeepSeek's denial response truncated.
All four successful-launcher controls passed that candidate.

The pre-review candidate separates the fallback from the long first step, says to
send the warning first and continue through permitted tools, and clarifies
that craft-floor also applies to small refinements. Setup grows by 18
whitespace-separated words; the description is unchanged. Sonnet and OpenAI
passed both final cases, as did DeepSeek with the explicit output ceiling.
Gemini still warned after the edit; its control passed. The final result is
7/8; the warning-order assertion remains unchanged.

Review follow-up: the fallback now says to follow the **applicable** steps
2–3, preserving step 3's planning-only exclusion (20 added Setup words overall).
A new denied-launcher planning case requires a real plan, no mutations or
craft-floor read, and successful context/target/playbook reads. On Sonnet,
the editing denial and successful-loader cases both passed again. The planning
run stayed read-only and skipped craft-floor, but failed because it did not
read `polish.md`. That assertion remains intact: this is another reference-loading
gap under #744, not a green planning result. Other providers were not rerun for
this wording-only review clarification.

The planning case also checks the response-message sequence: the launcher must
actually be denied, then an assistant warning must precede the first fallback
PRODUCT.md or DESIGN.md read. Deterministic tests reject silent continuation,
final-only warnings, warnings before denial, and user-authored warnings. This
checks disclosure even when no editing occurs; the editing cases retain their
existing pre-edit warning assertion.

One focused Sonnet rerun with this guard read the playbook and produced a
read-only plan without craft-floor, but omitted the launcher warning entirely.
The strengthened assertion correctly failed that run; #744 remains open for
the behavior failure rather than treating this coverage fix as a skill fix.

These are single samples per case and candidate, not reliability estimates.
This API harness starts with the skill loaded and readable references. It
does not measure activation, reproduce Windows command parsing, or establish
fallback behavior when the host also denies required file reads or writes.
Keep #744 open; evaluate activation separately with #375.

To repeat only these cases (provider keys and an engine binary required):

```sh
IMPECCABLE_SKILL_BEHAVIOR_MODELS=claude-sonnet-5,gpt-5.6-terra,gemini-3.7-flash,deepseek-v4-flash \
  node --test --test-name-pattern='scenario 19:' tests/skill-behavior/scenarios.test.mjs
```

## Workflow-advice baseline (2026-09-05, PR #737)

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
| 16 (existing project) | pass | pass | pass |
| 16 (missing product context) | flaky (1 of 2) | pass | pass |
| 17 (command comparison) | pass | pass | pass |
| 18 (explicit command) | pass | pass | pass |

Rechecked after reducing the skill addition to 59 words. Claude's first
missing-context response stayed read-only but skipped `routing.md`; an unchanged
repeat passed on all three providers. Keep that reference-read miss visible as
a flake rather than adding instructions for a single observation. All assertions
remain unchanged. Scenario 18 uses an eight-step budget and actual read-tool
evidence, not rejected bash reads. The initial unrestricted run (stopped after
host-wide search attempts), earlier rejected-read results, and broader suite's
sandboxed provider DNS errors are excluded from this baseline.

The full-build file adds end-to-end assertions for attended fresh init,
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
  --test-name-pattern="bolder refinement" tests/skill-workflow/full-build.test.mjs
```

Use the suite's current 900000ms timeout for full workflow cases; the 300000ms
example above is historical. The harness now disables decision pages itself.
Pipe
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
