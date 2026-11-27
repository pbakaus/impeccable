# $impeccable foundations

Walk the user through the foundations every shipped project needs, fixing one at a time. This is a roadmap, not a design task: redesign nothing.

## Without an argument: the roadmap

Run:

```
.agents/skills/impeccable/scripts/impeccable foundations
```

It checks the project's files (and runs the design detector), asks npm about the root `package.json`'s dependencies and the deployed site about HTTPS, headers, email DNS and `security.txt` (each once a day), and prints a count, the **Next up** item with why it matters, and every other item: `✓` in place, `✗` to fix, `·` not checked (it needs the network, or the project gives no evidence either way). Pass a path for one app in a monorepo.

Relay the count and the Next up item in two or three sentences, and offer to fix it now. List the other `✗` items in one line by name. Do not explain the `·` items unless asked. If it prints `Nothing to check yet`, say so and stop. If the next item is `secrets-out-of-repo`, the output names the file and line of each key: never print, copy or quote the key itself.

## With an id: fix that one item

`$impeccable foundations <id>` fixes one item. Read what "done" means for that id below, look at the project to find the smallest change that gets there, make it in the project's own stack and conventions, then re-run `.agents/skills/impeccable/scripts/impeccable foundations --json` and confirm `items["<id>"]` is `"checked"`. If so, say it in one line and name the new Next up. If it is still `"failing"`, say what the check still misses and fix that; never game it with a stub. If the id is absent from `items` (the CLI can't judge it here: a dependency outside npm, a site it can't find or reach, or contrast in an app whose components only the regex engine reads), verify the definition below yourself, say what you checked, and don't claim the CLI did.

Ask before anything that needs the user: an account (Sentry, a host), a key, legal wording, or a product decision. Write placeholders they must fill in only when they agree, and say exactly which lines.

Site items count once deployed. The site is the first of `homepage` in `package.json`, a `CNAME`, Astro `site`, Next `metadataBase`, `Sitemap:` in `robots.txt`, or a canonical / `og:url`; none, and they send nothing (add `homepage` once the user gives the URL).

## What "done" means

Web items (`app-icons`, `not-found-page`, `social-previews`, `legal-pages`, `error-tracking`) need a web UI. Server frameworks need markup templates or served markup pages; an API-only server sends none of them. Rails with `config.api_only = true` is never web.

- **secrets-out-of-repo**: no tracked file holds a private key or a key in a known format. Public Firebase client config is not a leak. Tracked env files fail on real values under `_`-separated secret name segments (KEY, SECRET, TOKEN, PASSWORD, PASSWD, PWD, CREDENTIAL, PRIVATE), or URLs with passwords. Public-prefixed names, variable references and obvious placeholders do not count. A DSN or URL without a password is not secret evidence. Example/sample/template env files do not count. Move real secrets to an untracked env file or the host's secret store. Rotate any exposed credential (history keeps it); never repeat its value.
- **readable-contrast**: the detector finds no low-contrast text in the full scan. Run `.agents/skills/impeccable/scripts/impeccable detect --json .`, fix each `low-contrast` finding at its token or style, preferring a shared token. A page that runs a script or takes another host's stylesheet, or a project too large to walk, sends nothing.
- **no-generic-ai-patterns**: the detector finds none of its generic-AI pattern rules. Fix the findings from `.agents/skills/impeccable/scripts/impeccable detect --json .` in the project's own design language; PRODUCT.md and DESIGN.md say what that is.
- **not-found-page**: the framework's own not-found page exists: Next `app/not-found.tsx` (or `pages/404`), SvelteKit `src/routes/+error.svelte`, Nuxt `error.vue`, Astro or Gatsby `src/pages/404`, Remix or React Router an `ErrorBoundary` in `app/root` or a `$.tsx` splat route, a client-routed SPA a catch-all `path="*"` route, a static or Hugo or Jekyll site a `404.html`. It links home, in the product's voice.
- **app-icons**: a favicon and a large app icon, as image files in the public folders (including `public/icons/`, `static/icons/`, `public/images/`), or local images linked by `rel="icon"`, `rel="apple-touch-icon"` or a web manifest. Source components do not count. Ask for the logo if there is none; never invent a brand mark.
- **social-previews**: a share image in `og:image`, `twitter:image`, framework metadata (including Nuxt `ogImage` and Next `generateMetadata` with `openGraph.images`), or an `opengraph-image` file. `twitter:card` alone and comments do not count. Aim for 1200×630.
- **legal-pages**: a privacy page and a terms page, as routes or files named `privacy` and `terms` (or `tos`), linked from the footer. Draft them only if asked, marked as drafts, never as legal advice.
- **readme-runs**: notes-only repos send nothing. Otherwise, install and run commands for this project appear in README code blocks or code spans, and every named package script exists. Scaffolding commands do not count.
- **ci-runs-tests**: a CI command runs tests on pushes or pull requests. Notes-only repos send nothing. Missing CI, checkout/setup alone, or only recognised non-test commands (install, build, lint, format, typecheck, deploy, echo) fails. An unclassified command sends nothing.
- **design-tokens**: a project colour custom property is defined and used through `var()`, or there is a recognised tokens file or theme source. Unused definitions and third-party variables do not count.
- **reduced-motion**: motion has a real reduced-motion guard. CSS animation, transitions, Web Animations, Svelte directives, Motion components and Tailwind `animate-*` count as motion; commented guards do not.
- **real-packages**: every direct npm dependency exists under that exact name. Failing names the missing: invented (find the one meant) or private (name its registry in `.npmrc`).
- **dependency-scanning**: Dependabot (`.github/dependabot.yml`) or Renovate is configured for the project's package managers.
- **error-tracking**: an error-tracking SDK (Sentry, Bugsnag, Rollbar, Honeybadger, Highlight, LogRocket, Datadog RUM) is a dependency and initialised at the app's entry. Read the DSN from the environment.
- **reversible-migrations**: every migration has a down step the tool can run: knex, Sequelize, TypeORM or umzug files export `down`, Rails uses `def change` or `def down`, Laravel has `down()`, golang-migrate has a `.down.sql` beside each `.up.sql`, dbmate and goose have a non-empty down section.
- **no-giant-files**: no hand-written source file is over 1,000 lines. Split along its seams without changing behaviour.
- **current-dependencies**: no direct npm dependency's range is over one major behind latest (0.x: the minor). Upgrade the listed ones one at a time, testing after each.
- **infrastructure-as-code**: the hosting setup lives in the repo (`wrangler.toml`, `vercel.json`, a `Dockerfile`, Terraform, and the like). Libraries and notes-only repos send nothing without it; an Expo app needs `eas.json`.
- **https-enforced**: `http://` redirects to `https://` on the same host (or www twin) and HTTPS sends `Strict-Transport-Security` with `max-age` ≥ 15552000.
- **certificate-renews**: the certificate has ≥ 14 days left; failing means auto-renewal broke.
- **security-headers**: the home page sends `X-Content-Type-Options: nosniff`, a `Referrer-Policy`, and `X-Frame-Options` or CSP `frame-ancestors`; set them at the host.
- **email-authentication**: the domain publishes SPF (`v=spf1`) and DMARC (`_dmarc` `v=DMARC1`). The user adds DNS records: draft them from the services that send their mail (`p=none` first).
- **security-txt**: `/.well-known/security.txt` is plain text with a `Contact:` line (ask which address).
