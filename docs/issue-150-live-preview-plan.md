# Issue 150 Live Preview Plan

## Current Bug Summary

Live preview can lose framework state when variants are written directly into watched component source. The Svelte reproduction is a stateful expense row: after adding an expense, generating variants for the row should not reset the component or render raw Svelte expressions such as `{expenses[0].name}`.

The current branch uses **Svelte component injection** for `.svelte` targets: variants are real components under `src/lib/impeccable/<id>/`, mounted in the browser via Svelte 5 `mount()`, and inlined back into the route source on live exit. Accept keeps the mounted component visible immediately while deferring the route write until `live-server stop`.

## Manual test apps (home directory)

Stateful framework repros live outside this repo:

- **Svelte:** `~/impeccable-live-svelte` (see its `README.md`)
- **React:** `~/impeccable-live-react` (see its `README.md`)

Each app includes a copied `.cursor/skills/impeccable` build from the local impeccable branch for live-server / inject / poll.

## Current Status

- Svelte component-injection Accept fix is implemented.
- Svelte manual pass with the user is complete (`~/impeccable-live-svelte`).
- React manual user check and the DeepSeek-backed final run are still pending (`~/impeccable-live-react`).
- Focused live tests, build, and full test suite should pass after harness refresh.

## Svelte Fix Plan

- Keep component injection scoped to `.svelte` targets.
- Extract `propContract` from the picked route markup and author variants as real `.svelte` files with `{propName}` bindings.
- Mount compiled variants in the browser with the app's shared Svelte runtime.
- On Accept, keep the chosen mounted variant visible immediately.
- Defer the real route source inline until live shutdown to avoid accept-time remounts.
- On live shutdown, inline accepted markup + CSS into the route and remove temp component files.
- Keep the connected indicator stable while an event is leased or actively being handled.

## React Parity Test Plan

- Same shape as the Svelte case in `~/impeccable-live-react`.
- Run the same Go, cycle, Accept flow against the React row.
- React already uses direct source wrap + Fast Refresh; keep that path unchanged unless manual testing shows state loss.

## Validation Checklist (impeccable repo)

- [ ] `node --test tests/live-browser-regression.test.mjs tests/live-accept.test.mjs tests/live-poll.test.mjs tests/live-server.test.mjs tests/live-svelte-component.test.mjs`
- [ ] Manual Svelte run in `~/impeccable-live-svelte`
- [ ] `bun run build`
- [ ] `bun run test`

The PR should remain draft until the React manual check in `~/impeccable-live-react` passes.
