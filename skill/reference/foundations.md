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

`/impeccable foundations <id>` fixes one item. Read what "done" means for that id below, look at the project to find the smallest change that gets there, make it in the project's own stack and conventions, then re-run `{{scripts_path}}/impeccable foundations --json` and confirm `items["<id>"]` is `"checked"`. If it is, say so in one short line and name the new Next up. If it is still `"failing"`, say what the check still misses and fix that; do not game the check with an empty file or a stub that does nothing.

Ask before anything that needs the user: an account (Sentry, a host), a key, legal wording, or a product decision. Write placeholders they must fill in only when they agree, and say exactly which lines.

## What "done" means

- **secrets-out-of-repo**: no tracked file holds a key in a known format (AWS, Stripe, GitHub, Slack, OpenAI, Anthropic, Google, private keys) and no `.env`, `.env.local` or `.env.production` is tracked. Move each value to an untracked env file or the host's secret store, read it from the environment, add the env file to `.gitignore`, `git rm --cached` it, and commit a `.env.example` with empty values. A key that was ever committed must be rotated: tell the user, since removing it from the latest commit doesn't remove it from history.
- **readable-contrast**: the detector finds no low-contrast text in the full scan. Run `{{scripts_path}}/impeccable detect --json .`, fix each `low-contrast` finding at its token or style, and prefer darkening a shared token over one-off overrides.
- **no-generic-ai-patterns**: the detector finds none of its generic-AI pattern rules. Fix the findings from `{{scripts_path}}/impeccable detect --json .` in the project's own design language; PRODUCT.md and DESIGN.md say what that is.
- **not-found-page**: the framework's own not-found page exists: Next `app/not-found.tsx` (or `pages/404`), SvelteKit `src/routes/+error.svelte`, Nuxt `error.vue`, Astro or Gatsby `src/pages/404`, Remix or React Router an `ErrorBoundary` in `app/root` or a `$.tsx` splat route, a client-routed SPA a catch-all `path="*"` route, a static or Hugo or Jekyll site a `404.html`. It says what happened and links home, in the product's voice.
- **app-icons**: a favicon (`favicon.ico`/`.svg`/`.png`, Next `app/icon.*`, or `<link rel="icon">` in the HTML entry) and a large icon: `apple-touch-icon.png` (180×180), a 192 or 512 PNG, or a web manifest with `icons`. Ask for the logo if there is none; never invent a brand mark.
- **social-previews**: pages carry `og:image` and `twitter:card` meta (Next: `metadata.openGraph` or an `opengraph-image` file). A 1200×630 image of the product's name and promise beats a screenshot.
- **legal-pages**: a privacy page and a terms page, as routes or files named `privacy` and `terms` (or `tos`), linked from the footer. Draft them only if the user asks, mark them as drafts for their review, and never present generated text as legal advice.
- **readme-runs**: the README names the install and run commands (for example `npm install` then `npm run dev`), and every script it names exists in `package.json`.
- **ci-runs-tests**: a CI workflow runs the test command on pull requests or pushes (for GitHub, `.github/workflows/*.yml` with `on: pull_request`). If there are no tests yet, add one real test first.
- **design-tokens**: colors are defined once as tokens (CSS custom properties in `:root`, a Tailwind theme, or a tokens file) and components use them. Move hard-coded hex and rgb values onto named tokens.
- **reduced-motion**: every animation or transition has a `prefers-reduced-motion` path (a media query, Tailwind `motion-safe:`/`motion-reduce:`, or Motion's `useReducedMotion`/`MotionConfig reducedMotion`). Reduce, don't just delete: keep opacity fades, drop movement.
- **real-packages**: not checked by the CLI (needs the network). Confirm each dependency exists on its registry and is the package you meant.
- **dependency-scanning**: Dependabot (`.github/dependabot.yml`) or Renovate is configured for the project's package managers.
- **error-tracking**: an error-tracking SDK (Sentry, Bugsnag, Rollbar, Honeybadger, Highlight, LogRocket, Datadog RUM) is a dependency and initialised at the app's entry. The user creates the account; read the DSN from the environment.
- **reversible-migrations**: every migration has a down step the tool can run: knex, Sequelize, TypeORM or umzug files export `down`, Rails uses `def change` or `def down`, Laravel has `down()`, golang-migrate has a `.down.sql` beside each `.up.sql`, dbmate and goose have a non-empty down section.
- **no-giant-files**: no hand-written source file is over 1,000 lines. Split along the seams the file already has; change no behaviour while doing it.
- **current-dependencies**: not checked by the CLI (needs the network). `npm outdated` or the ecosystem's equivalent shows what is far behind.
- **infrastructure-as-code**: the hosting setup lives in the repo (`wrangler.toml`, `vercel.json`, `netlify.toml`, `fly.toml`, a `Dockerfile`, Terraform, and the like).
