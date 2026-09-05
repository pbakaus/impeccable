One-time live-mode project setup. Loaded from [live.md](live.md) only when `impeccable live` reports `config_missing` / `config_invalid`, when `configDrift` needs handling, or when the config lacks `cspChecked`. Not part of the per-session hot path.

## Write the config

Create the file at the `path` the boot reported (default `.impeccable/live/config.json`):

```json
{
  "files": ["<path-or-glob>", "<path-or-glob>", ...],
  "exclude": ["<optional-glob>", ...],
  "insertBefore": "</body>",
  "commentSyntax": "html",
  "cspChecked": true
}
```

`files` is the inject target: **the HTML files the browser actually loads**, not necessarily source (tracked vs generated does not matter here; wrap has its own generated-file guard). Entries are literal paths or globs. `exclude` (optional) skips files a `files` glob would otherwise include (email templates, demo fixtures). `cspChecked` records that the CSP step below has run; absent on first setup.

**Hard-excluded paths (cannot be overridden):** `**/node_modules/**` and `**/.git/**`; injecting there would instrument third-party code.

**Glob syntax:** `**` matches any number of segments (including zero), `*` matches within a segment, `?` matches one character. Paths are project-root-relative with forward slashes.

| Framework | `files` | `insertBefore` | `commentSyntax` |
|-----------|---------|----------------|-----------------|
| SPA with single shell (Vite / React / Plain HTML) | `["index.html"]` | `</body>` | `html` |
| Next.js (App Router) | `["app/layout.tsx"]` | `</body>` | `jsx` |
| Next.js (Pages) | `["pages/_document.tsx"]` | `</body>` | `jsx` |
| Nuxt | `["app.vue"]` | `</body>` | `html` |
| Svelte / SvelteKit | `["src/app.html"]` | `</body>` | `html` |
| TanStack Router (SPA, Vite) | `["index.html"]` | `</body>` | `html` |
| TanStack Start (SSR) | `["src/routes/__root.tsx"]` | `<Scripts` | `jsx` |
| Astro | `[" <root layout .astro>"]` | `</body>` | `html` |
| Multi-page (separate HTML per route) | `["public/**/*.html"]` glob over the served dir | `</body>` | `html` |

Pick an anchor that exists in every file (`</body>` almost always works); `insertAfter` matches after a line instead. For multi-page sites prefer a glob so new pages are picked up automatically. For sites whose pages are rebuilt by a generator, the inject survives only until the next regeneration: re-run `impeccable live` after each build (accept is unaffected; it writes true source via the fallback flow).

**Framework adapters (auto-detected at inject time).** Every inject records what it wrote in `.impeccable/live/inject-journal.json`; the next inject or remove heals artifacts a crash or wrong-directory stop left behind. SvelteKit, Nuxt, and TanStack Start server-render their document shell, so a raw `<script>` in the entry template will not execute reliably; `impeccable live-inject` detects them and routes to a dedicated adapter (SvelteKit: dev-only root component from `+layout.svelte`; Nuxt: dev-only `.client.ts` plugin; TanStack Start: a generated dev-only `ImpeccableLiveRoot` component in `__root`). The `files` value stays a valid detection/CSP hint but is not the literal insertion site. A plain TanStack Router SPA takes the baseline Vite path.

## Config drift

On every boot the project is scanned for HTML files under common page roots (`public/`, `src/`, `app/`, `pages/`) that the resolved `files` list does not cover; they surface as `configDrift.orphans` with a hint. Tell the user once per session which files are uncovered and offer to add them or switch `files` to a glob. Never auto-update the config; the user decides. `configDrift` is `null` when there is no drift.

## CSP detection (first-time only)

If `config.cspChecked === true`, skip this whole section; the user was already asked once.

```bash
.trae/skills/impeccable/scripts/impeccable detect-csp
```

Output `{ shape, signals }`; the shape names the *patch mechanism*, so one template covers many frameworks:

- **`null`**: no CSP; write the config with `cspChecked: true` and stop here.
- **`append-arrays`**: CSP as structured directive arrays; auto-patchable (monorepo helpers with `additionalScriptSrc`/`additionalConnectSrc`, SvelteKit `kit.csp.directives`, Nuxt `nuxt-security`).
- **`append-string`**: CSP as a literal value string; auto-patchable (inline `next.config.*` `headers()`, Nuxt `routeRules`).
- **`middleware`** / **`meta-tag`**: detected but not auto-patched. Show the user the detected files, ask them to add `http://localhost:8400` to `script-src` and `connect-src` manually, then mark `cspChecked: true` and proceed.

### Consent prompt (use this phrasing)

> **CSP patch needed.** I detected a Content Security Policy in your project that blocks `http://localhost:8400`: the live picker won't load without an allowance. Here's the change I'd make:
>
> ```diff
> [file: <patchTarget>]
> [exact diff, 2-5 lines]
> ```
>
> It's guarded by `NODE_ENV === "development"` so the extra entry only appears in dev and never reaches production. You can remove it any time by reverting this file. Apply? [y/n]

On "no": skip the patch, note that live will not work until the allowance is added manually, and still write `cspChecked: true` (the question has been asked). On "yes": apply the shape's patch below, then write `cspChecked: true`.

### append-arrays

Declare near the top of the file that holds the CSP arrays, then append `...__impeccableLiveDev` to the script-src and connect-src arrays:

```ts
// Dev-only allowance so impeccable live mode can load. Guarded by NODE_ENV.
const __impeccableLiveDev =
  process.env.NODE_ENV === "development" ? ["http://localhost:8400"] : [];
```

Per-framework: Next.js + monorepo helper: edit the *app's* `next.config.*` (not the shared helper), appending to `additionalScriptSrc` / `additionalConnectSrc`. SvelteKit: `svelte.config.js`, `kit.csp.directives['script-src']` and `['connect-src']`. Nuxt + nuxt-security: `nuxt.config.*`, `security.headers.contentSecurityPolicy['script-src']` and `['connect-src']`. Reference outputs: [nextjs-turborepo/expected-after-patch.ts](https://github.com/pbakaus/impeccable/blob/8dac6ae7e020c43ab10ce9b41939f6fd42627b96/tests/framework-fixtures/nextjs-turborepo/expected-after-patch.ts), [sveltekit-csp/expected-after-patch.js](https://github.com/pbakaus/impeccable/blob/8dac6ae7e020c43ab10ce9b41939f6fd42627b96/tests/framework-fixtures/sveltekit-csp/expected-after-patch.js). Idempotency: if `__impeccableLiveDev` already exists in the file, the patch is applied; just mark `cspChecked: true`.

### append-string

Two-point patch: declare a dev-only string, interpolate it into the CSP value at both directives (leading space so it concatenates cleanly; convert literals to template strings as part of the edit):

```ts
// Dev-only allowance so impeccable live mode can load.
const __impeccableLiveDev =
  process.env.NODE_ENV === "development" ? " http://localhost:8400" : "";
```

- `script-src 'self' 'unsafe-inline'` becomes `` `script-src 'self' 'unsafe-inline'${__impeccableLiveDev}` ``
- `connect-src 'self'` becomes `` `connect-src 'self'${__impeccableLiveDev}` ``

Per-framework: Next.js inline `headers()` in `next.config.*`; Nuxt `routeRules['/**'].headers['Content-Security-Policy']` in `nuxt.config.*`. Reference outputs: [nextjs-inline-csp/expected-after-patch.js](https://github.com/pbakaus/impeccable/blob/8dac6ae7e020c43ab10ce9b41939f6fd42627b96/tests/framework-fixtures/nextjs-inline-csp/expected-after-patch.js), [nuxt-csp/expected-after-patch.ts](https://github.com/pbakaus/impeccable/blob/8dac6ae7e020c43ab10ce9b41939f6fd42627b96/tests/framework-fixtures/nuxt-csp/expected-after-patch.ts).

## Troubleshooting

If the user said "no" to the CSP patch and later reports live not working: their dev CSP blocks `http://localhost:8400`. Delete `cspChecked` from `.impeccable/live/config.json` and re-run `impeccable live`; setup asks again.

After setup, re-run `impeccable live`.
