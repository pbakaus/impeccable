# Skill-behavior tests

LLM-backed scenarios that verify how the impeccable skill drives
PRODUCT.md / DESIGN.md loading. Each scenario runs against the cheapest
tier of each major provider (Anthropic, OpenAI, Google) so a full sweep
costs a few cents and finishes in ~2 minutes.

These are the tests you re-run when you refactor anything in SKILL.md's
`## Setup` section. They fail when the agent stops following the loading
contract.

## Run

```bash
bun run test:skill-behavior
IMPECCABLE_SKILL_BEHAVIOR_VERBOSE=1 bun run test:skill-behavior   # dump per-scenario traces
IMPECCABLE_SKILL_BEHAVIOR_MODELS=claude-haiku-4-5 bun run test:skill-behavior   # scope to one model
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
| 1 | empty workspace | runs `context.mjs` (which prints a `NO_PRODUCT_MD` directive); agent then loads `reference/teach.md` via Read or `cat`; does **not** start writing HTML/CSS |
| 2 | PRODUCT.md only (with `## Register: brand`) | runs `context.mjs` 1-3 times; loads `reference/brand.md` |
| 3 | PRODUCT.md + DESIGN.md (brand register) | runs `context.mjs` 1-3 times; loads `reference/brand.md`; consults the design system (DESIGN.md bundled in output, but CSS / tokens / directory listing also count) |
| 4 | PRODUCT.md + DESIGN.md, context already loaded in turn 1 | turn 2 does **not** re-run `context.mjs`; `reference/brand.md` is loaded across turns 1+2 |
| 5 | PRODUCT.md WITHOUT a `## Register` field; task cue says "landing page" | runs `context.mjs` (which emits a generic register directive); agent loads `reference/brand.md` via task-cue cascade |

## Baseline state (2026-05-20)

Captured after condensing Setup to four bullets and teaching `context.mjs`
to emit a `NEXT STEP:` directive that names the matching register
reference when PRODUCT.md declares one (and a generic cascade prompt when
it doesn't). Use this table when comparing pre/post refactor: a
regression is "more failures than baseline", not "any failures at all".

| Scenario | claude-haiku-4-5 | gpt-5.4-mini | gemini-3.1-flash-lite |
|---|---|---|---|
| 1 (no context) | pass (variance: ~1 in 5 the agent stops after `context.mjs` without loading `teach.md`) | pass | pass |
| 2 (product only) | pass | pass | pass |
| 3 (product + design) | pass | pass | pass |
| 4 (already loaded) | pass | **fail** | pass |
| 5 (no register field, task-cue cascade) | pass | pass | pass |

13-14 / 15 typical. The stable failure is gpt-5.4-mini scenario 4:
it re-runs `context.mjs` on turn 2 despite seeing its output in turn 1's
history. Same known weakness as the v3.2.0 script baseline; Claude and
Gemini honor the "don't re-run" rule. The S1 claude flake is rare
(observed once across many runs) and likely terminates early under
load — re-running typically clears it.
