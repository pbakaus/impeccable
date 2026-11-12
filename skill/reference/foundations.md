# /impeccable foundations

Walk the user through the product foundations every shipped project needs, and fix one at a time. This is a roadmap, not a design task: do not redesign anything on the way.

## Without an argument: the roadmap

Run:

```
{{scripts_path}}/impeccable foundations
```

It checks the project's own files (and runs the design detector) offline and prints a count, the **Next up** item with why it matters, and every other item: `✓` in place, `✗` to fix, `·` not checked (it needs the network, or the project gives no evidence either way). Pass a path for one app in a monorepo.

Relay the count and the Next up item in two or three sentences, then offer to fix that item now. List the other `✗` items in one line by name. Do not explain the `·` items unless asked. If it prints `Nothing to check yet`, say so and stop. If the next item is `secrets-out-of-repo`, the output names the file and line of each key: never print, copy or quote the key itself.

## With an id: fix that one item

`/impeccable foundations <id>` fixes one item. Read what "done" means for that id below, look at the project to find the smallest change that gets there, make it in the project's own stack and conventions, then re-run `{{scripts_path}}/impeccable foundations --json` and confirm `items["<id>"]` is `"checked"`. If it is, say so in one short line and name the new Next up. If it is still `"failing"`, say what the check still misses and fix that; do not game the check with an empty file or a stub that does nothing. If the id is absent from `items` (the CLI can't judge it here: `real-packages`, `current-dependencies`, or contrast in an app whose components only the regex engine reads), verify the definition below yourself, say what you checked, and don't claim the CLI confirmed it.

Ask before anything that needs the user: an account (Sentry, a host), a key, legal wording, or a product decision. Write placeholders they must fill in only when they agree, and say exactly which lines.

## What "done" means

- **secrets-out-of-repo**: no tracked file holds a key in a known format (AWS, Stripe, GitHub, Slack, OpenAI, Anthropic, Google, a private key with its body), and no tracked env file (`.env`, `.env.local`, `.env.production`) sets a non-empty value under a secret-looking name (KEY, SECRET, TOKEN, PASSWORD, CREDENTIAL, PRIVATE, DSN, or a URL with a password). Names public by convention (`PUBLIC_`, `NEXT_PUBLIC_`, `VITE_`, `NUXT_PUBLIC_`, `EXPO_PUBLIC_`, `REACT_APP_`, `GATSBY_`) are fine to commit, and `.env.example`, `.env.sample` and `.env.template` always pass. Obvious placeholders (EXAMPLE, abcdef, 123456, xxxxxx) don't count. Move each value to an untracked env file or the host's secret store, read it from the environment, add the env file to `.gitignore`, `git rm --cached` it, and commit a `.env.example` with empty values. A key that was ever committed must be rotated: tell the user, since removing it from the latest commit doesn't remove it from history.
- **readable-contrast**: the detector finds no low-contrast text in the full scan. Run `{{scripts_path}}/impeccable detect --json .`, fix each `low-contrast` finding at its token or style, and prefer darkening a shared token over one-off overrides.
- **no-generic-ai-patterns**: the detector finds none of its generic-AI pattern rules. Fix the findings from `{{scripts_path}}/impeccable detect --json .` in the project's own design language; PRODUCT.md and DESIGN.md say what that is.
- **not-found-page**: the framework's own not-found page exists: Next `app/not-found.tsx` (or `pages/404`), SvelteKit `src/routes/+error.svelte`, Nuxt `error.vue`, Astro or Gatsby `src/pages/404`, Remix or React Router an `ErrorBoundary` in `app/root` or a `$.tsx` splat route, a client-routed SPA a catch-all `path="*"` route, a static or Hugo or Jekyll site a `404.html`. It says what happened and links home, in the product's voice.
- **app-icons**: a favicon and a large app icon, as image files in the public folders (including `public/icons/`, `static/icons/`, `public/images/`), or local images linked by `rel="icon"`, `rel="apple-touch-icon"` or a web manifest. Source components do not count. Ask for the logo if there is none; never invent a brand mark.
- **social-previews**: a share image in `og:image`, `twitter:image`, framework metadata (including Nuxt `ogImage` and Next `generateMetadata` with `openGraph.images`), or an `opengraph-image` file. `twitter:card` alone and comments do not count. Aim for 1200×630.
- **legal-pages**: a privacy page and a terms page, as routes or files named `privacy` and `terms` (or `tos`), linked from the footer. Draft them only if the user asks, mark them as drafts for their review, and never present generated text as legal advice.
- **readme-runs**: install and run commands for this project appear in README code blocks or code spans, and every named package script exists. Scaffolding commands such as `npx create-next-app` do not count.
- **ci-runs-tests**: a CI command runs tests on pushes or pull requests. Common package managers and test runners count; comments do not. Missing CI, checkout/setup alone, or only recognised non-test commands (install, build, lint, format, typecheck, deploy, echo) fails. An unclassified command sends nothing.
- **design-tokens**: a project colour custom property is defined and used through `var()`, or there is a recognised tokens file or theme source. Unused definitions and third-party variables do not count. HTML entities are not hex colours.
- **reduced-motion**: motion has a real reduced-motion guard. CSS animation, transitions, Web Animations, Svelte directives, Motion components and Tailwind `animate-*` count as motion; commented guards do not.
- **real-packages**: not checked by the CLI (needs the network). Confirm each dependency exists on its registry and is the package you meant.
- **dependency-scanning**: Dependabot (`.github/dependabot.yml`) or Renovate is configured for the project's package managers.
- **error-tracking**: an error-tracking SDK (Sentry, Bugsnag, Rollbar, Honeybadger, Highlight, LogRocket, Datadog RUM) is a dependency and initialised at the app's entry. The user creates the account; read the DSN from the environment.
- **reversible-migrations**: every migration has a down step the tool can run: knex, Sequelize, TypeORM or umzug files export `down`, Rails uses `def change` or `def down`, Laravel has `down()`, golang-migrate has a `.down.sql` beside each `.up.sql`, dbmate and goose have a non-empty down section.
- **no-giant-files**: no hand-written source file is over 1,000 lines. Split along the seams the file already has; change no behaviour while doing it.
- **current-dependencies**: not checked by the CLI (needs the network). `npm outdated` or the ecosystem's equivalent shows what is far behind.
- **infrastructure-as-code**: the hosting setup lives in the repo (`wrangler.toml`, `vercel.json`, a `Dockerfile`, Terraform, and the like). A package library without app evidence sends nothing when hosting config is absent.
