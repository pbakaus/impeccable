# Framework fixtures

Representative project shapes for exercising live mode against different framework conventions. Each fixture is a small directory tree that the test harness copies into a temp git repo, then drives `live-inject.mjs`, `live-wrap.mjs`, `live-accept.mjs`, and `lib/is-generated.mjs` against.

Fixtures can also opt into a **runtime E2E** pass that actually installs dependencies, boots the framework dev server, and drives a Playwright browser to verify the live handshake. See the `runtime` block below.

## Layout

```
<fixture>/
  files/              project tree the test copies into tmp
  gitignore.txt       becomes .gitignore in tmp (so we can commit the real files here)
  fixture.json        config + expected results the test consumes
```

`fixture.json` schema:

```json
{
  "name": "human-readable label",
  "config": { ...contents for .impeccable/live/config.json ... },
  "sourceFiles": ["paths that is-generated should classify as source (false)"],
  "generatedFiles": ["paths that is-generated should classify as generated (true)"],
  "wrapCases": [
    {
      "name": "description",
      "args": { "classes": "...", "tag": "...", "elementId": "..." },
      "expectedFile": "where wrap should land (relative to fixture root)",
      "expectsError": "optional error code, e.g. element_not_in_source"
    }
  ],
  "csp": {
    "shape": "shared-helper | inline-headers | middleware | meta-tag | null",
    "signals": ["diagnostic hints — paths where CSP was detected"],
    "patchTarget": "which file the agent should modify",
    "expectedAfter": "filename of the reference post-patch output inside this fixture"
  },
  "runtime": {
    "styling": "plain-css | tailwind-v4 | styled-components | ...",
    "appDir": "website",
    "install": ["npm", "install"],
    "devCommand": ["npm", "run", "dev"],
    "scheme": "http",
    "ignoreHTTPSErrors": false,
    "readyPattern": "Local:\\s+https?://[^:]+:(\\d+)",
    "readyTimeoutMs": 120000,
    "pickSelector": "h1.hero-title",
    "pickPosition": { "x": 10, "y": 10 },
    "variantSequence": [3, 1, 2],
    "acceptedSourcePattern": "<ul[^>]*class=\"[^\"]*\\bexpense-list\\b",
    "assertSourceContains": ["{#each expenses as expense, i}"],
    "stateProbe": {
      "textSelector": "[data-testid='open-count']",
      "expectedText": "3 offen",
      "windowProperty": "__impeccableStatefulMounts",
      "expectedWindowValue": 1,
      "expectWindowUnchanged": true
    },
    "paramsScenario": {
      "variant": 2,
      "rangeLabel": "Lead",
      "rangeValue": 1.8,
      "stepsLabel": "Density",
      "stepsOptionLabel": "Snug",
      "expectSourceContains": ["line-height: 1.8"],
      "expectSourceMissing": ["letter-spacing: 0.14em"]
    },
    "componentFailureScenarios": { "variant": 2, "storageLoss": false },
    "mode": "insert",
    "insert": {
      "anchorSelector": "section#features",
      "position": "after",
      "prompt": "Add a testimonial strip below features",
      "expectSelector": ".inserted-strip",
      "assertAnchorContains": "feature-grid"
    },
    "preActions": [
      { "type": "click", "selector": "[data-testid='open-modal']" },
      { "type": "goto",  "path": "/about" }
    ],
    "reloadProbe": {
      "preActions": [{ "type": "click", "selector": "[data-testid='open-modal']" }],
      "expectSelector": "h1.hero-title"
    },
    "steer": {
      "message": "steer-e2e mark hero",
      "expectSelector": "h1.hero-title[data-impeccable-steer=\"e2e\"]"
    },
    "probe": {
      "expectLiveInit": true,
      "expectConsoleClean": true
    }
  }
}
```

The legacy `middleware` shape name covers CSP set in either Next.js
`middleware.*` files or the Next.js 16 `proxy.*` convention.

The `expectedAfter` file lives alongside `fixture.json` (not inside `files/`) and is a human/agent-review reference — tests don't auto-apply the patch.

The `runtime` block is optional. Fixtures without it only run the static unit checks (is-generated, inject, wrap, csp-detect). Fixtures *with* it additionally run the E2E suite in `tests/live-e2e.test.mjs` (`bun run test:live-e2e`), which:

1. Stages the fixture into a tmp repo.
2. Runs `runtime.install` to install real deps.
3. Starts `live-server.mjs --background` and runs `live-inject.mjs --port` against it.
4. Spawns `runtime.devCommand` and scrapes the port from stdout using `runtime.readyPattern` (the first capture group must be the port).
5. Opens Playwright Chromium at the dev URL and asserts `window.__IMPECCABLE_LIVE_INIT__ === true` (the browser-side handshake oracle) within `runtime.readyTimeoutMs`.
6. Runs a **Steer smoke** step (unless `runtime.steer === false`): submit a message in the global Steer bar, wait for the fake agent to reply `steer_done`, assert the bar unlocks and a `data-impeccable-steer` marker lands in source + DOM. Then continues with pick → Go → cycle → accept.
7. Tears everything down (Playwright close, dev server SIGTERM, live-server stop, tmp rm).

### `runtime.appDir`

Optional, defaults to `.`. Set it when the served app is **not** the repo root, the shape live mode has to resolve on its own (a CLI package at the root with the site in `website/`, for example). With `appDir` set, the harness:

- stages `files/` and runs `git init` at the tmp root, as always;
- writes `.impeccable/live/config.json` under `<tmp>/<appDir>/`, and treats every fixture-relative path in `fixture.json` (`steer.sourceFile`, manual-edit `expectedSourceFile`, and so on) as relative to that app dir;
- runs `runtime.install` and `runtime.devCommand` with the app dir as cwd;
- boots through `live.mjs` **from the tmp root** instead of calling `live-server.mjs` and `live-inject.mjs` directly, so the run exercises root resolution (`skill/scripts/live/roots.mjs`) rather than assuming it. The parsed `live.mjs` payload is exposed as `session.liveBoot`, and `tests/live-e2e.test.mjs` asserts on `roots.appRoot`, `roots.contextRoot`, the persisted `roots.json`, and the repo-root pointer.

The session object carries both paths: `session.tmp` is the repo root (use it for git and for artifact capture) and `session.appRoot` is the app. They are the same directory for every fixture without `appDir`.

### Picking, cycling, and the render proof

`pickSelector` names the element the run picks. The picker resolves whatever is
under the cursor, so a **container whose centre is covered by a child can never
be picked**: add `pickPosition` (`{x, y}` in px from the element's top-left) to
aim at a point the container owns, such as its own padding.

`variantSequence` (default `[2]`) is the order the run cycles through; the last
entry is the variant it accepts. Every variant the run lands on gets a computed
`font-weight` assertion in fake-agent mode, because the fake agent renders each
variant at a distinct weight (`FAKE_VARIANT_FONT_WEIGHTS` in
`tests/live-e2e/agent.mjs`: 300 / 900 / 600). That turns "variant N is visible"
from a bar-label claim into a render fact, so a sequence like `[3, 1, 2]` proves
all three variants really render.

`acceptedSourcePattern` overrides the default post-accept source check (an `<h1
class="hero-title">`), and `assertSourceContains` lists strings that must
survive the whole wrap → accept → carbonize cycle. On Svelte component previews
that is how a fixture proves control flow was not flattened: list the `{#each}`
header and the per-item expressions.

`stateProbe` asserts page state is not lost. `textSelector` / `expectedText`
check rendered state; `windowProperty` with `expectedWindowValue` and
`expectWindowUnchanged` check a counter the app bumps on mount, so a scaffold
that silently remounted the page fails. It runs after preActions, after the
variants land, and (outside component previews) after accept.

### Extra scenarios

Beyond the core cycle, a fixture opts into scenarios by declaring their config.
Each one is also gated by `IMPECCABLE_E2E_SCENARIOS`:

| Scenario name | Enabled by | What it proves |
|---|---|---|
| `params` | `runtime.paramsScenario` | Dial a `range` and a `steps` knob in the real Tune popover, accept, and assert the chosen values are baked into source as literals with the unchosen branch dropped and no `data-p-*` / `var(--p-*)` left behind. |
| `mount-failure` | `runtime.componentFailureScenarios` | Corrupt the published `r<N>/v<variant>` revision file, step onto it, and assert the persistent mount-error card appears, the session survives (bar + localStorage intact), and a `variant_mount_failed` event lands in the session journal. Then restore, Retry, and reach the variant again. |
| `republish` | `runtime.componentFailureScenarios` | Re-author every variant and reply `done` again; the browser must mount the new content, which is what the server's revision-dir bump exists to guarantee. |
| `storage-loss` | `runtime.componentFailureScenarios` (unless `storageLoss: false`) | Clear localStorage, reload, and assert the comparison comes back from the server's durable session record alone. |

`componentFailureScenarios.variant` picks which variant to break or observe.
Set `storageLoss: false` for fixtures whose picked element only exists after
preActions: the reload discards that state, and re-creating it races the
preview mount.

These scenarios assert on deterministic content, so they skip under
`IMPECCABLE_E2E_AGENT=llm`.

One gotcha: `tests/framework-fixtures.test.mjs` stages the same fixture flat and writes the live config at the tmp root, so `config.files` has to resolve from both the repo root and the app root. A glob (`"**/index.html"`) satisfies both; a literal `"index.html"` only works from the app root and makes the static sweep report `file_not_found`.

Useful runtime E2E filters:

- `IMPECCABLE_E2E_ONLY=<fixture>[,<fixture>]` scopes the run to selected fixture names.
- `IMPECCABLE_E2E_SCENARIOS=core` runs only the main click → Go → cycle → accept path; omit it or use `all` to include manual edit, annotation, exit, params, and the component failure-injection probes. Names: `core`, `manual`, `annotations`, `exit`, `missed-done`, `params`, `mount-failure`, `republish`, `storage-loss`.
- `IMPECCABLE_E2E_TEST_TIMEOUT_MS`, `IMPECCABLE_E2E_INSTALL_TIMEOUT_MS`, and `IMPECCABLE_E2E_DEV_READY_TIMEOUT_MS` tighten CI smoke timeouts without changing fixture metadata.

Optional `runtime.steer` fields:

```json
"steer": {
  "message": "steer-e2e mark hero",
  "sourceFile": "src/routes/About.jsx",
  "expectSelector": "h1.hero-title[data-impeccable-steer=\"e2e\"]",
  "expectSourceContains": "data-impeccable-steer=\"e2e\"",
  "preActions": [{ "type": "click", "selector": "[data-testid='nav-about']" }]
}
```

When `preActions` is omitted, steer smoke inherits `runtime.preActions` to reveal hidden heroes before the DOM check. Source is asserted first; a reload + retry covers HMR lag. Set `"steer": false` to skip, or `"expectDom": false` for source-only verification.

## Current fixtures

| Fixture | Shape |
|---|---|
| `vite-react/` | Tracked `index.html` shell + `src/App.jsx`. Inject into the shell. |
| `nextjs-app/` | `app/layout.tsx` as JSX inject target (commentSyntax `jsx`). |
| `astro/` | `src/layouts/Layout.astro` as inject target. HTML comments. |
| `sveltekit/` | `src/app.html` shell + `src/routes/+page.svelte`. |
| `vite8-sveltekit-stateful/` | Svelte 5 route with `$state`, an `{#if}` branch, and an `{#each}` list. Picks the list container, so the component-preview scaffold has to carry the loop across as one `collection` prop and hydrate its items from the live DOM. Also carries the params, failure-injection, and state-preservation probes. |
| `nuxt-vite7/` | Nuxt 4 `app/` structure + Vue 3 SFC. Live loads through a generated dev-only client plugin. |
| `tanstack-router-vite/` | Vite + TanStack Router (code-based SPA). Tracked `index.html` shell inject (the baseline Vite path, no adapter). |
| `tanstack-start/` | Vite + TanStack Start (SSR). No static `index.html`; Live patches the `__root.tsx` document to mount a generated dev-only React component that loads the bundle. |
| `multipage-with-generator/` | `src/` tracked, `dist/` gitignored. Exercises the is-generated guard and `element_not_in_source` fallback. |
| `nextjs-turborepo/` | Monorepo with shared CSP helper (`createBaseNextConfig`). CSP shape `append-arrays`. |
| `nextjs-inline-csp/` | App-level `next.config.js` with a literal CSP string. CSP shape `append-string`. |
| `sveltekit-csp/` | SvelteKit `kit.csp.directives` in `svelte.config.js`. CSP shape `append-arrays`. |
| `nuxt-csp/` | Nuxt `routeRules` with literal CSP header in `nuxt.config.ts`. CSP shape `append-string`. |
| `monorepo-nested-vite/` | Repo root is a CLI package with no dev config and no workspaces; the served Vite + React app lives in `website/`. Exercises `runtime.appDir` and live-mode root resolution. |

Add new fixtures by cloning a directory, swapping files, and updating `fixture.json`. A fixture with a `runtime` block also needs its name added to the live-e2e matrices in `.github/workflows/ci.yml`: the `live-e2e-full` group list, and one `live-e2e-smoke` group when it should run on every PR. Keep the groups roughly the same size, since they run in parallel and the job times out at 15 minutes.
