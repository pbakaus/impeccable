# Issue 149: `/typeset` Typography Preflight

## Summary

Implement Paul's composite solution: `/typeset` runs deterministic typography preflights first, including project-personalized checks from `.impeccable/design.json`, then still performs a full LLM typography judgment. Detector output is evidence to fix, not a completion signal.

## Key Changes

- Add detector scoping as `--dimension typography`, not `--category`, because `category` already means `slop` or `quality`.
- Define an explicit typography rule set by ID, including existing typography rules with and without `skillSection` metadata.
- Add shared dimension filtering across CLI, regex scans, static HTML scans, browser URL scans, and browser injected scans.
- Extend `.impeccable/design.json` with `tokens.typography` as a denormalized snapshot from `DESIGN.md` frontmatter; `DESIGN.md` remains the source of truth.
- Add personalized typography findings for font size, line height, letter spacing, and font family values outside the project typography tokens.
- Update `/typeset` to run `node {{scripts_path}}/detect.mjs --json --dimension typography <resolved target>`, then require a second full LLM typography pass for hierarchy, rhythm, readability, personality, and overall type quality.

## Test Plan

- Add `--dimension typography` tests proving typography findings remain while color, motion, and layout findings are excluded.
- Add rule-set tests proving typography dimension includes explicit rule IDs even when `skillSection` metadata is absent or points elsewhere, such as `tight-leading`, `tiny-text`, `justified-text`, `wide-tracking`, `skipped-heading`, and `line-length`.
- Add a distilled Keio test from `/Users/abdulwahab/Downloads/Keio Flower Shop (standalone).html`; do not commit the full 251 KB standalone file.
- Good test: create a temporary project with distilled Keio CSS/HTML using `.preheading`, `.brand .word`, `.hero h1`, `.hero-lede`, `.glass-pill`, `.strip-words span`, and `.foot-inner`; give it a narrower `tokens.typography` scale so values like `font-size: 23px`, `line-height: 0.98`, and `letter-spacing: 0.18em` produce exact `non-token-*` snippets naming both offending value and allowed scale.
- Control test: run the same distilled Keio fixture with a matching `tokens.typography` snapshot that includes the observed Keio values; assert zero personalized `non-token-*` findings, proving the detector is token-driven rather than hardcoded to the fixture.
- Add pass coverage for CSS variables, inherited/global values, missing sidecar, malformed sidecar, old sidecar without `tokens.typography`, and non-HTML source scans.

## DeepSeek Validation

- Deterministic builds and detector tests remain model-free.
- All LLM-backed validation for this feature must use DeepSeek only.
- Add DeepSeek support to `tests/skill-behavior/providers.mjs` with `deepseek-v4-flash`, `DEEPSEEK_API_KEY`, and default base URL `https://api.deepseek.com/anthropic`.
- Run skill behavior with:
  `IMPECCABLE_SKILL_BEHAVIOR_MODELS=deepseek-v4-flash bun run test:skill-behavior`
- If live E2E is run, force:
  `IMPECCABLE_E2E_LLM_PROVIDER=deepseek IMPECCABLE_E2E_LLM_MODEL=deepseek-v4-flash bun run test:live-e2e`
- Do not run Anthropic, OpenAI, Google, fake-agent, or fallback LLM sweeps for this PR.

## Validation Commands

- `bun run build`
- `bun run build:browser`
- `bun run build:extension`
- `bun run test`
- `IMPECCABLE_SKILL_BEHAVIOR_MODELS=deepseek-v4-flash bun run test:skill-behavior`

## Assumptions

- The Keio standalone HTML is source material only; committed fixtures should be small, readable, and distilled.
- Personalized checks skip gracefully when no usable typography sidecar exists.
- Existing detector/build validation still runs after implementation.
