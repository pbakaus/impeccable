# Handoff: Svelte live mode bar stuck at `0/0` (CYCLING with no variants)

Date: 2026-05-30
Branch: `codex/issue-150-svelte-live`
Status: **Unresolved.** Two rounds of fixes landed and were synced to the manual test repo, but the symptom still reproduces.

---

## Symptom

In `~/impeccable-live-svelte`, after running a live action (Polish/Bolder) on the expense row, the floating live bar shows the **CYCLING** layout (prev/next arrows, two faint dots, `✓ Accept`, `✕`) but the counter reads `0/0` and every control is disabled (`opacity: 0.3`, `pointer-events: none`). No variant is mounted. The bar persists across reloads.

Captured DOM (trimmed): `<div id="impeccable-live-bar">` … `<span>0/0</span>` … `✓ Accept` (disabled) `✕`. Full markup is in the chat history if needed.

`0/0` = `visibleVariant=0 / arrivedVariants=0`. The two dots = `expectedVariants=2` rendered as "pending" (see `buildDots`, both unfilled because `arrivedVariants=0`).

---

## Context: what this feature is

Issue 150 replaced the Svelte "source-shadow" live preview with **real component injection**. See `docs/issue-150-live-preview-plan.md` and `skill/reference/live.md` (the `svelte-component` paragraph). Key pieces:

- `skill/scripts/live-svelte-component.mjs` — scaffolds `src/lib/impeccable/<id>/` with `manifest.json`, `v1.svelte`…`vN.svelte`, and a one-time `__runtime.js`. Inlines the accepted variant back into the route on exit.
- `skill/scripts/live-wrap.mjs` — `.svelte` targets return `previewMode: "svelte-component"`, `file` = manifest path.
- `skill/scripts/live-browser.js` — mounts compiled variants via Svelte 5 `mount()` into a `display:contents` slot that replaces the original element. Cycling = unmount + remount.
- `skill/scripts/live-accept.mjs` / `live-server.mjs` — defer the route source write to `live-server stop`.

The Svelte wrapper in the live DOM is **runtime-injected** and holds a single mount target (`[data-impeccable-component-mount]`), **not** `[data-impeccable-variant]` children like the HTML/JSX path. This distinction is the source of most of the trouble.

---

## What has already been fixed (and synced to the test repo)

All in `skill/scripts/live-browser.js`, rebuilt via `bun run build:skills` and rsync'd to `~/impeccable-live-svelte/.cursor/skills/impeccable/`.

1. **Params sidecar (the original compile error).** Svelte parses `{` inside an attribute value as an expression, so `data-impeccable-params='[{…}]'` broke compilation (`Expected token }`). Params now load from `componentDir/params.json` keyed by variant number:
   - `loadSvelteComponentParams(manifest)` fetches `params.json`.
   - `parseVariantParams()` reads from `svelteComponentSession.paramsByVariant` for the component path instead of the DOM attribute.
   - Agent contract updated in `live-svelte-component.mjs` (`buildSvelteComponentCssAuthoring`) and `skill/reference/live.md`.

2. **Resume guard.** `resumeSession()` now drops an orphaned `svelte-component` wrapper (no live in-memory mount) instead of resuming it into an empty bar. Without this, every reload resumed `arrivedVariants=0`.

3. **Abort-on-failure.** New `abortSvelteComponentInjection(sessionId, message)` resets the bar to PICKING (restores the original element, clears session, toast) when the picked element can't be found OR the initial `mountSvelteComponentVariant` returns false (compile/mount throw). Called from `injectSvelteComponentsFromManifest`.

Tests added in `tests/live-browser-regression.test.mjs` (all green): orphan reset, abort helper, sidecar params. Full focused suite passes: `node --test tests/live-browser-regression.test.mjs tests/live-svelte-component.test.mjs tests/live-accept.test.mjs`.

---

## Why it probably STILL reproduces (hypotheses, in priority order)

### H1. The served `live.js` is stale (verify FIRST)
The browser loads `live.js` from the running live-server, not from disk directly. If the server wasn't restarted, or the `<script src=".../live.js">` is cached, the page is still running the OLD code without the abort/resume guards.
- **Check:** in the page console, search the loaded script for `abortSvelteComponentInjection` / `loadSvelteComponentParams`. If absent, the fix isn't loaded.
- **Fix:** `live-server.mjs --stop` then `--background`, hard-reload (Cmd+Shift+R), reload Cursor.
- Confirm the test repo copy is current: `grep -l abortSvelteComponentInjection ~/impeccable-live-svelte/.cursor/skills/impeccable/scripts/live-browser.js`.

### H2. The variant still fails to compile, and a path other than `injectSvelteComponentsFromManifest` sets CYCLING
The abort only fires inside `injectSvelteComponentsFromManifest`. If the agent-authored `v1.svelte` still has a compile error (another `{` in an attribute, a bad expression, etc.), the mount fails. Confirm the abort path is actually reached:
- Look for the console line `[impeccable] Failed to mount Svelte variant N` and the toast.
- If CYCLING is being set somewhere else, audit every `updateBarContent('cycling')` / `state = 'CYCLING'` site (grep finds ~12) for one that runs with `arrivedVariants===0`.

### H3. Server-side event replay re-injects after reset
`live-server.mjs` redelivers unacknowledged events and persists a session journal. After the browser aborts to PICKING, a redelivered `done` event (SSE reconnect, or the agent reply not acked) could re-trigger injection. The `done` handler (`live-browser.js` ~line 4868) only injects when `state === 'GENERATING'`, so a clean PICKING state should be safe — but verify the state at the moment of replay. The durable session may also need clearing: check `.impeccable/live/sessions/` and `.impeccable/live/deferred-svelte-component-accepts.json` in the test repo.

### H4. Stale localStorage session keeps re-priming the bar
The bar persists `state`/`id`/`visible` to localStorage (keys prefixed `impeccable-live`). A reload can rehydrate CYCLING before any wrapper exists.
- **Check:** `Object.keys(localStorage).filter(k=>k.startsWith('impeccable-live'))` in the console.
- **Clear:** remove those keys and reload (see "Reset procedure" below).

### H5. Defect-class root cause: empty CYCLING is representable at all
The deepest fix is to make `0/0 CYCLING` an impossible state. A cheap, robust guard: in the cycling render path (`buildCyclingRow` / wherever `updateBarContent('cycling')` resolves), if `arrivedVariants === 0`, refuse to render CYCLING and fall back to PICKING (or hide). That self-heals regardless of which upstream path is buggy. Consider adding this as belt-and-suspenders even after the specific path is found.

---

## Reset procedure (clears the currently-stuck bar)

```js
// page console
Object.keys(localStorage).filter(k => k.startsWith('impeccable-live')).forEach(k => localStorage.removeItem(k));
location.reload();
```

```bash
cd ~/impeccable-live-svelte
node .cursor/skills/impeccable/scripts/live-server.mjs --stop
node .cursor/skills/impeccable/scripts/live-server.mjs --background
# also clear any orphaned session state if H3 suspected:
rm -rf .impeccable/live/sessions/* .impeccable/live/deferred-svelte-component-accepts.json
rm -rf src/lib/impeccable/*/   # leftover variant component dirs (keep __runtime.js)
```
Reload Cursor so `/impeccable` picks up the synced skill.

---

## Repro

1. `cd ~/impeccable-live-svelte && npm run dev`
2. New terminal: `node .cursor/skills/impeccable/scripts/live-server.mjs --background`, note the port.
3. `node .cursor/skills/impeccable/scripts/live-inject.mjs --port <port>` then `node .cursor/skills/impeccable/scripts/live-poll.mjs`.
4. In the browser: add an expense, pick the expense row, run Polish/Bolder, let variants generate.
5. Observe whether the bar reaches `1/3` (good) or `0/0` (the bug).
6. With `IMPECCABLE_E2E_DEBUG`-style logging: open devtools console and watch for `[impeccable]` lines during step 4.

The expense row source is `src/routes/+page.svelte` lines ~34-37 (`<article class="expense-row …">{expenses[0].name}…`). `propContract` derives `name` and `amount`.

---

## Suggested investigation order for tomorrow

1. **Confirm the new code is actually live** (H1) — single biggest time-saver. Grep the loaded script + the test-repo file for `abortSvelteComponentInjection`.
2. With confirmed-fresh code, reproduce and **capture the console**. Determine whether `injectSvelteComponentsFromManifest` runs and whether `mountSvelteComponentVariant` throws. Read the actual `src/lib/impeccable/<id>/v1.svelte` the agent wrote — is it valid Svelte?
3. If mount throws: the agent is still authoring an invalid component. Tighten the `live.md` contract / scaffold stub, OR make the inline-accept/scaffold validate. Capture the exact error.
4. If mount succeeds but bar still `0/0`: trace which `state='CYCLING'` site runs with `arrivedVariants=0` (H2) and add the H5 guard.
5. Add an E2E regression once root cause is known. Note `tests/live-e2e.test.mjs` still references the old `source-shadow` markers for the Svelte fixture (lines ~311, ~891, ~918) — that opt-in suite needs updating to the component-injection model regardless.

---

## Key files / line anchors (as of this handoff)

| File | What |
|---|---|
| `skill/scripts/live-browser.js` ~4242 | `injectSvelteComponentsFromManifest` |
| `skill/scripts/live-browser.js` (`abortSvelteComponentInjection`) | clean-reset helper |
| `skill/scripts/live-browser.js` (`mountSvelteComponentVariant`) | dynamic import + `mount()` |
| `skill/scripts/live-browser.js` (`loadSvelteComponentParams`, `parseVariantParams`) | sidecar params |
| `skill/scripts/live-browser.js` (`resumeSession`) | orphan-wrapper guard |
| `skill/scripts/live-browser.js` ~4868 | SSE `done` handler |
| `skill/scripts/live-browser.js` (`buildCyclingRow`, `buildDots`, ~2102/2262) | bar render — candidate for H5 guard |
| `skill/scripts/live-svelte-component.mjs` | scaffold / inline-accept / cssAuthoring contract |
| `skill/reference/live.md` (`svelte-component` paragraph + Parameters §7) | agent contract |

Remember: source of truth is `skill/`. After any edit run `bun run build:skills`, then rsync to `~/impeccable-live-svelte/.cursor/skills/impeccable/`. Do not hand-edit the harness copies.
