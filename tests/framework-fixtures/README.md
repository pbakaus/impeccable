# Framework fixtures

Representative project shapes for exercising live mode against different framework conventions. Each fixture is a small directory tree that the test harness copies into a temp git repo, then drives `live-inject.mjs`, `live-wrap.mjs`, `live-accept.mjs`, and `is-generated.mjs` against.

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
    "install": ["npm", "install"],
    "devCommand": ["npm", "run", "dev"],
    "scheme": "http",
    "ignoreHTTPSErrors": false,
    "readyPattern": "Local:\\s+https?://[^:]+:(\\d+)",
    "readyTimeoutMs": 120000,
    "pickSelector": "h1.hero-title",
    "preActions": [
      { "type": "click", "selector": "[data-testid='open-modal']" },
      { "type": "goto",  "path": "/about" }
    ],
    "reloadProbe": {
      "preActions": [{ "type": "click", "selector": "[data-testid='open-modal']" }],
      "expectSelector": "h1.hero-title"
    },
    "probe": {
      "expectLiveInit": true,
      "expectConsoleClean": true
    }
  }
}
```

The `expectedAfter` file lives alongside `fixture.json` (not inside `files/`) and is a human/agent-review reference — tests don't auto-apply the patch.

The `runtime` block is optional. Fixtures without it only run the static unit checks (is-generated, inject, wrap, csp-detect). Fixtures *with* it additionally run the E2E suite in `tests/live-e2e.test.mjs` (`bun run test:live-e2e`), which:

1. Stages the fixture into a tmp repo.
2. Runs `runtime.install` to install real deps.
3. Starts `live-server.mjs --background` and runs `live-inject.mjs --port` against it.
4. Spawns `runtime.devCommand` and scrapes the port from stdout using `runtime.readyPattern` (the first capture group must be the port).
5. Opens Playwright Chromium at the dev URL and asserts `window.__IMPECCABLE_LIVE_INIT__ === true` (the browser-side handshake oracle) within `runtime.readyTimeoutMs`.
6. Tears everything down (Playwright close, dev server SIGTERM, live-server stop, tmp rm).

## Current fixtures

| Fixture | Shape |
|---|---|
| `vite-react/` | Tracked `index.html` shell + `src/App.jsx`. Inject into the shell. |
| `nextjs-app/` | `app/layout.tsx` as JSX inject target (commentSyntax `jsx`). |
| `astro/` | `src/layouts/Layout.astro` as inject target. HTML comments. |
| `sveltekit/` | `src/app.html` shell + `src/routes/+page.svelte`. |
| `multipage-with-generator/` | `src/` tracked, `dist/` gitignored. Exercises the is-generated guard and `element_not_in_source` fallback. |
| `nextjs-turborepo/` | Monorepo with shared CSP helper (`createBaseNextConfig`). CSP shape `append-arrays`. |
| `nextjs-inline-csp/` | App-level `next.config.js` with a literal CSP string. CSP shape `append-string`. |
| `sveltekit-csp/` | SvelteKit `kit.csp.directives` in `svelte.config.js`. CSP shape `append-arrays`. |
| `nuxt-csp/` | Nuxt `routeRules` with literal CSP header in `nuxt.config.ts`. CSP shape `append-string`. |

Add new fixtures by cloning a directory, swapping files, and updating `fixture.json`.
