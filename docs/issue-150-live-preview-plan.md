# Issue 150 Live Preview Plan

## Current Bug Summary

Live preview can lose framework state when variants are written directly into watched component source. The Svelte reproduction is a stateful expense row: after adding an expense, generating variants for the row should not reset the component or render raw Svelte expressions such as `{expenses[0].name}`.

The current branch introduces source-shadow previews for Svelte so variants are written to `.impeccable/live/previews/` and injected into the live DOM without triggering Svelte HMR during cycling. Accept must still visibly keep the selected variant applied immediately, while syncing the real `.svelte` source only when live mode exits.

## Current Status

- Svelte source-shadow Accept fix is implemented.
- Svelte manual pass with the user is complete.
- React stateful fixture is added and passing the same automated flow.
- Focused live tests, Svelte/React live E2E, build, and full test suite have passed.
- React manual user check and the DeepSeek-backed final run are still pending.

## Svelte Fix Plan

- Keep source-shadow previews scoped to `.svelte` targets.
- Hydrate Svelte expression text from the live DOM before injecting preview variants.
- Copy framework-generated `svelte-*` classes into injected preview content so component CSS remains applied while cycling variants.
- On Accept, preserve the selected variant and its preview CSS in the browser DOM immediately.
- Defer the real `.svelte` source write until live shutdown to avoid accept-time remounts.
- On live shutdown, apply the accepted variant to the source file and remove preview scaffolding cleanly.
- Keep the connected indicator stable while an event is leased or actively being handled.

## React Parity Test Plan

- Add a Vite React stateful fixture with the same shape as the Svelte case:
  - `useState` expense list.
  - Add expense button.
  - Count text.
  - Expense row rendering `Design snack $12`.
- Run the same Go, cycle, Accept flow against the React row.
- Assert React state is preserved, row text remains real, variant CSS applies while cycling, and accepted styling remains visible after Accept.
- If React already passes, keep the React implementation path unchanged and retain the fixture as regression coverage.
- If React fails, extend the guarded source-shadow behavior to JSX/TSX only behind the explicit preview-mode path.

## Manual Testing Checklist

### Svelte

- [x] Reset temp Svelte app and live session state.
- [x] Start Svelte dev server.
- [x] Start Impeccable live server.
- [x] Start plain `live-poll.mjs`; do not run a demo or autonomous agent.
- [x] User adds an expense.
- [x] User selects the expense row.
- [x] User runs Polish or Bolder.
- [x] User cycles variants.
- [x] User accepts a variant.
- [x] Accepted styling remains visible immediately after Accept.
- [x] Row text is real text, not `{expenses[0].name}` / `{expenses[0].amount}`.
- [x] Expense count remains `1 offen`.

Manual note, 2026-05-30 07:46 JST: ran `/tmp/impeccable-svelte-manual` at `http://127.0.0.1:5173/` with Impeccable helper `8401` and plain polling only. The user added the expense row, selected it, ran Polish, accepted variant 2, and the accept event completed with deferred Svelte source write.

### React

- [ ] Start the React stateful fixture.
- [ ] Start Impeccable live server.
- [ ] Start plain `live-poll.mjs`; do not run a demo or autonomous agent.
- [ ] User adds an expense.
- [ ] User selects the expense row.
- [ ] User runs Polish or Bolder.
- [ ] User cycles variants.
- [ ] User accepts a variant.
- [ ] Accepted styling remains visible immediately after Accept.
- [ ] Row text is real text.
- [ ] Expense count remains `1`.

## Automated Validation Checklist

- [x] `node --test tests/live-browser-regression.test.mjs tests/live-accept.test.mjs tests/live-poll.test.mjs tests/live-server.test.mjs`
- [x] `IMPECCABLE_E2E_ONLY=vite8-sveltekit-stateful bun run test:live-e2e`
- [x] `IMPECCABLE_E2E_ONLY=vite8-react-stateful bun run test:live-e2e`
- [x] `bun run build`
- [x] `bun run test`

## DeepSeek Final Test Command

Run this after the Svelte and React manual checks are good:

```bash
IMPECCABLE_E2E_ONLY=vite8-sveltekit-stateful IMPECCABLE_E2E_AGENT=llm IMPECCABLE_E2E_LLM_PROVIDER=deepseek bun run test:live-e2e
```

The PR should remain draft until both manual framework checks and the DeepSeek-backed live Go test pass.
