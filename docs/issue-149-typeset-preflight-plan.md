# Issue 149: `/typeset` Typography Preflight

## Summary

Implement Paul’s composite solution for issue #149: `/typeset` first runs deterministic typography preflights, including project-personalized checks from `.impeccable/design.json`, then the LLM still performs a full typography judgment. Detector output is defect evidence, not a completion signal.

Execution starts from `main`, creates `codex/issue-149-typeset-preflight`, writes this plan, and opens a draft PR titled `WIP: Add typeset typography preflight`.

## Key Changes

- Add detector scoping as `--dimension typography`, not `--category`, because detector `category` already means `slop` or `quality`.
- Define an explicit typography rule set by ID, including current rules such as `overused-font`, `single-font`, `flat-type-hierarchy`, `italic-serif-display`, `hero-eyebrow-chip`, `repeated-section-kickers`, `oversized-h1`, `extreme-negative-tracking`, `tight-leading`, `tiny-text`, `justified-text`, `all-caps-body`, `wide-tracking`, `skipped-heading`, and `line-length`.
- Add shared dimension filtering for CLI, regex, static HTML, browser URL scans, and browser injected scans.
- Add personalized typography checks that compare observed font size, line height, letter spacing, and font family values against typography tokens from `.impeccable/design.json`.

## Implementation Details

- Extend `.impeccable/design.json` generation with `tokens.typography`, a denormalized snapshot generated from `DESIGN.md` frontmatter. `DESIGN.md` remains the source of truth; the sidecar snapshot exists for detector consumption.
- Personalized findings should name both the offending value and the allowed scale, for example: `font-size: 12.5px is not in design typography scale: 12px, 14px, 16px, 20px, 32px`.
- Skip personalized checks gracefully when the sidecar is missing, old, malformed, or lacks typography tokens.
- Update `skill/reference/typeset.md` so `/typeset` runs:
  `node {{scripts_path}}/detect.mjs --json --dimension typography <resolved target>`
- Update the `/typeset` instructions to require two phases:
  1. Fix auto-detected typography issues.
  2. Still run a full LLM typography pass for hierarchy, rhythm, readability, personality, and overall type quality.

## Test Plan

- Add detector tests for `--dimension typography`, including that color, motion, and layout findings are excluded.
- Add rule-set tests proving typography dimension includes all relevant existing typography rules, even when `skillSection` metadata is absent.
- Add personalized typography fixtures distilled from the Keio Claude Design HTML, without committing the full 256 KB standalone file.
- Verify pass cases for token-matching literals, CSS variables, inherited values, missing sidecar, and old sidecar.
- Run:
  `bun run build`
  `bun run build:browser`
  `bun run build:extension`
  `bun run test`
  `bun run test:skill-behavior`

## PR Steps

- Branch: `codex/issue-149-typeset-preflight`
- Plan file: `docs/issue-149-typeset-preflight-plan.md`
- Commit subject: `Add typeset typography preflight plan`
- Draft PR title: `WIP: Add typeset typography preflight`
- Draft PR body: summarize Paul’s two-part solution, note v1 is `/typeset` only, list validation completed, and call out generated artifacts if `bun run build` changes `dist/`.
