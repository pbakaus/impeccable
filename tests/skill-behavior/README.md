# Skill-behavior tests

LLM-backed scenarios that verify how the impeccable skill drives context,
command-reference, new-work, and native-platform loading. Each scenario runs
against one current model from each major provider (Anthropic, OpenAI, Google).

These are the tests you re-run when you refactor anything in SKILL.md's
`## Setup` section. They fail when the agent stops following the loading
contract.

## Run

```bash
bun run test:skill-behavior
IMPECCABLE_SKILL_BEHAVIOR_VERBOSE=1 bun run test:skill-behavior   # dump per-scenario traces
IMPECCABLE_SKILL_BEHAVIOR_MODELS=claude-sonnet-4-6 bun run test:skill-behavior   # scope to one model
```

Requires `.env` at repo root with at least one of `ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, `GOOGLE_CLOUD_API_KEY`. Providers without a key are
skipped, not failed.

## How it works

Each scenario:

1. `prepareWorkspace()` mints a temp dir, symlinks the canonical skill
   into `<workspace>/.claude/skills/impeccable`, and optionally writes
   `PRODUCT.md` / `DESIGN.md` fixtures.
2. `runTurn()` inlines `SKILL.md` (placeholders neutralized) as the
   system prompt and runs Vercel AI SDK `generateText` with four
   workspace-scoped tools: `bash`, `read`, `write`, `list`.
3. The tools record every call into a `trace` that the test asserts on.
4. For scenario 4, a second `runTurn` reuses turn 1's `responseMessages`
   so the model sees a real multi-turn conversation.

The trace is the source of truth, not the model's free-form reply.

## Scenarios

| # | Setup | Assertion |
|---|---|---|
| 1 | empty workspace | runs `context.mjs`; loads `reference/init.md` before implementation; automation is not an init bypass |
| 2 | PRODUCT.md only | runs `context.mjs` 1-3 times; loads `reference/init.md` to establish DESIGN.md with the user before surface work |
| 3 | PRODUCT.md + DESIGN.md | runs `context.mjs` 1-3 times; receives the committed design system and loads `reference/new-work.md` for the task-scoped concept |
| 4 | PRODUCT.md + DESIGN.md, context already loaded in turn 1 | turn 2 does **not** re-run `context.mjs` |
| 5 | PRODUCT.md without the legacy `## Register` field and no DESIGN.md | runs `context.mjs`; greenfield craft still loads `reference/init.md` to establish the missing world |
| 6 | PRODUCT.md + DESIGN.md + a minimal `index.html`; prompt is `/impeccable polish` | loads `reference/polish.md` |
| 7 | same fixture; prompt is `/impeccable audit` | loads `reference/audit.md` |
| 8 | PRODUCT.md + DESIGN.md + a SvelteKit scaffold (`src/app.css`, components, `+page.svelte`); prompt is `/impeccable polish src/routes/+page.svelte` | reads at least one project code file (CSS / component / page) — not just the skill's reference files |
| 9 | PRODUCT.md + `index.html` + a seeded update cache with a newer version (`skillVersion` copy-mode so `context.mjs` has a `SKILL.md` to version-check against); prompt is `/impeccable polish index.html` | `context.mjs` runs and its output carries the `UPDATE_AVAILABLE` directive (proven via captured bash output); the agent does **not** auto-run `npx impeccable update` (it must ask first) |
| 10 | no PRODUCT.md + a minimal `index.html`; prompt is `/impeccable polish index.html` | runs `context.mjs`, loads `reference/polish.md`, and does **not** divert into `reference/init.md` |
| 11 | empty workspace; prompt is `/impeccable shape ...` | runs `context.mjs`; resolves `reference/init.md` before planning the surface |
| 12 | empty workspace; prompt is natural-language build intent with no command word | runs `context.mjs`; resolves `reference/init.md` before implementation |
| 13 | empty workspace; prompt is `/impeccable teach` | runs `context.mjs` and diverts into `reference/init.md` because `teach` aliases `init` |
| 14 | PRODUCT.md with `## Register: product` + `## Platform: ios` (native iOS app); prompt is `/impeccable craft a tide detail screen` | `context.mjs` runs and emits a NEXT STEP pointing at `reference/ios.md` (proven via captured bash output); agent loads `reference/ios.md` (Setup step 5, native conventions on top of the register reference) |
| 15 | same iOS fixture; prompt is `/impeccable audit` | agent loads `reference/audit.native.md` (the Commands-table native variant, routed instead of `audit.md`) |

Scenario 9 passed on all three current-lineup providers (`claude-sonnet-4-6`,
`gpt-5.5`, `gemini-3.1-flash-lite`) on 2026-05-28.

## Baseline state (2026-05-20, previous cheap tier)

> **Lineup changed.** The default models are now `claude-sonnet-4-6`,
> `gpt-5.5`, and `gemini-3.1-flash-lite` (production-tier on Anthropic and
> OpenAI). The table below was measured on the *old* cheap tier
> (`claude-haiku-4-5` / `gpt-5.4-mini`) and is kept as the historical record.
> Re-measure on the current lineup and update this section; the stronger
> models are expected to clear the scenario 6/7 routing failures that the old
> gpt tier showed.

Captured after moving sub-command reference loading from step 4 to step 2
of Setup (so the agent loads `reference/<command>.md` right after
`context.mjs`, before "doing the work" preempts it), and tightening
step 3 to require at least one project code read even when a sub-command
reference loads first. Use this table when comparing pre/post refactor:
a regression is "more failures than baseline", not "any failures at all".

| Scenario | claude-haiku-4-5 | gpt-5.4-mini | gemini-3.1-flash-lite |
|---|---|---|---|
| 1 (no context) | pass (rare flake — agent stops after `context.mjs` without loading `init.md`) | pass | pass |
| 2 (product only) | pass | pass | pass |
| 3 (product + design) | pass | pass | pass (rare flake — sub-command ref loads but register ref doesn't) |
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
