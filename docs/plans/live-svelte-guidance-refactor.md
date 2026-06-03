# Split Svelte Live Guidance With DeepSeek Visual Validation

## Motivation

`skill/reference/live.md` should stay the universal live-mode protocol: boot the helper, open the app, run the poll loop, handle events, and follow the generic wrap/insert/accept contracts. The Svelte-native adapter adds important framework-specific rules, but keeping those rules inline makes `live.md` longer and sets the wrong pattern for future adapters.

This change moves Svelte/SvelteKit-specific authoring rules into a dedicated adapter reference while keeping the main live workflow stable and cache-friendly.

## Architecture

- Keep `reference/live.md` as the universal live-mode reference.
- Add `reference/live-svelte.md` for Svelte/SvelteKit component-preview rules.
- Emit `guidanceRefs: ["reference/live-svelte.md"]` from live helper tools whenever the Svelte adapter path is active.
- Preserve `cssAuthoring` as the exact per-run styling contract; adapter references explain how to follow it, but do not replace tool output.

The intended loading chain is:

1. Agent loads `reference/live.md` for live mode.
2. Agent runs `live.mjs`, `live-wrap.mjs`, or `live-insert.mjs`.
3. If tool output includes `guidanceRefs`, agent reads each referenced file before writing variants.

## Implementation Plan

- Add `skill/reference/live-svelte.md` covering:
  - load conditions (`adapter: "sveltekit"`, `previewMode: "svelte-component"`, or `guidanceRefs`);
  - replace mode component files under `componentDir`;
  - insert mode component files;
  - `propContract` preservation;
  - component `<style>` authoring;
  - `componentDir/params.json`;
  - accept/discard behavior.
- Slim `skill/reference/live.md` by replacing inline Svelte paragraphs with concise adapter-reference routing.
- Update `live-inject.mjs`, `live.mjs`, `live-wrap.mjs`, and `live-insert.mjs` to emit/pass through `guidanceRefs`.
- Update the LLM live E2E harness to include `live-svelte.md` when `wrapInfo.previewMode === "svelte-component"`.
- Add headed DeepSeek visual support for the Svelte adapter sweep via `IMPECCABLE_SVELTE_DEEPSEEK_HEADED=1`.
- Run `bun run build` after source edits to regenerate provider outputs.

## Validation Plan

- `bun test tests/live-reference.test.mjs`
- `node --test tests/framework-fixtures.test.mjs`
- `IMPECCABLE_E2E_ONLY=vite8-sveltekit bun run test:live-e2e`
- `DEEPSEEK_API_KEY=... node --test --test-timeout=600000 tests/live-svelte-adapter-deepseek.test.mjs`
- Optional visible DeepSeek sweep:
  - `IMPECCABLE_SVELTE_DEEPSEEK_HEADED=1`
  - `IMPECCABLE_SVELTE_DEEPSEEK_ARTIFACT_DIR=<artifact-dir>`
- External smoke on a throwaway copy/worktree of `/Users/abdulwahab/impeccable-live-svelte`, using DeepSeek for generation and saving screenshots/artifacts.
- `bun run test` after targeted checks are green.

## PR Readiness

Keep the PR as a draft until the implementation is complete, generated outputs are refreshed, targeted tests pass, and DeepSeek/Svelte visual evidence is recorded or explicitly skipped because `DEEPSEEK_API_KEY` is unavailable.
