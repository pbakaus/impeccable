# Project Instructions for Claude

## Skill bootstrap: skip the post-update-cleanup step

The `<post-update-cleanup>` block at the top of `.claude/skills/impeccable/SKILL.md` runs `scripts/cleanup-deprecated.mjs` and then self-deletes. **Do not run it in this repo, and do not delete the block.** This repo is the source of truth for the Impeccable skill; the cleanup script scans for "leftover" skill files to remove and its judgment doesn't fit a repo where the skill lives in `skill/`. The block is also regenerated from `skill/SKILL.md` on every `bun run build`, so any deletion churns back on the next build. Skip the step silently and proceed.

Same rule for AGENTS.md and every other harness-specific instruction file: treat post-update-cleanup as a no-op in this repo.

## Architecture (v3.0+)

There is **one** user-invocable skill, `impeccable`, with **23 commands** underneath it. Users type `/impeccable polish`, `/impeccable audit`, etc. The skill is defined in `skill/`:

- `SKILL.md` — frontmatter (with the auto-trigger-optimized description and the `allowed-tools` list), shared design laws, and the **Commands** router table.
- `reference/` — one `<command>.md` per command (`audit.md`, `polish.md`, `critique.md`, etc.) plus the domain reference files (`typography.md`, `color-and-contrast.md`, etc.). When a sub-command is matched, the router loads its reference file.
- `reference/brand.md` and `reference/product.md` — the two register references. SKILL.md's Setup section selects one based on the task cue, the surface in focus, or the `register` field in PRODUCT.md (first match wins).
- `scripts/command-metadata.json` — single source of truth for each command's description, argument hint, and (eventually) category. Both the build and `pin.mjs` read from this.
- `scripts/pin.mjs` — creates/removes lightweight redirect shims so users can have `/audit` as a standalone shortcut that delegates to `/impeccable audit`.
- `scripts/cleanup-deprecated.mjs` — runs once after an update to remove leftover files from renamed/merged commands.

**Do not add standalone skills** unless there's a strong reason. The consolidation was deliberate: the `/` menu pollution problem is real and gets worse as users install more plugins.

### Register (brand vs product)

Every design task belongs to one of two registers:

- **Brand** — design IS the product: marketing, landing pages, brand sites, campaign surfaces, portfolios, long-form content. Distinctiveness is the bar. Spans every visual lane (tech-minimal, luxury, editorial-magazine, consumer-warm, brutalist, etc.) — do not default to only one.
- **Product** — design SERVES the product: app UI, admin, dashboards, tools. Earned familiarity is the bar — fluent users of Linear / Figma / Notion / Raycast / Stripe should trust it.

PRODUCT.md at the project root carries a `## Register` section with a bare value (`brand` or `product`). `/impeccable teach` asks about register first because it shapes every downstream answer.

Sub-command reference files add a short `## Register` section near the top *only where the answer diverges between the two*. Don't restate the register files' content in sub-commands — link instead. Sub-commands where register meaningfully diverges today: `typeset`, `animate`, `bolder`, `delight`, `colorize`, `layout`, `quieter`.

**a11y lives in `audit.md`**, not in SKILL.md, `brand.md`, or `product.md`. Models over-cautious themselves into safe, underdesigned output when reminded about accessibility at design time. The audit command is the dedicated place for that check.

## CSS

Plain hand-written CSS, no Tailwind. Imported into Astro pages/layouts via frontmatter `import` statements; Vite resolves `@import` chains automatically.

The CSS architecture (under `site/styles/`):
- `main.css` — Main entry point, imports the partials and defines tokens/reset
- `workflow.css` — Commands section, glass terminal, magazine spread styles
- `sub-pages.css` — `/docs`, `/anti-patterns`, `/tutorials`, detail pages
- `tokens.css` — OKLCH color tokens (ink, charcoal, ash, mist, cream, accent)
- `footer.css` — shared across all pages, imported in `Base.astro`

Edit any of these directly and the dev server hot-reloads. No rebuild needed for CSS changes.

## Color token rule

- **`--color-ink`** (10% lightness) is for body copy. Use it even for small text.
- **`--color-charcoal`** (25% lightness) reads as washed-out gray in small text. Only use for headings or larger body copy at ≥16px.
- **`--color-ash`** (55%) is for secondary labels, captions, relationship meta lines.
- **Never use pure black or pure white.** Use the tinted tokens.

## Prose: read STYLE.md before writing user-facing copy

Editorial brief is at `STYLE.md` (root). Read it before editing the homepage, sub-pages, command editorials, tutorials, or READMEs. The site has been called out for AI prose; the rules there exist to keep that from creeping back.

The build's `validateProse` step (in `scripts/build.js`) enforces a denylist: em dashes (`—` and HTML entities), the `--` em-dash substitute, `load-bearing`, `highest-leverage`, `biggest unlock`, `seamless`, `robust`, `delve`, `elevate`, `empower`, `underscore`, `pivotal`, `tapestry`, `data-driven`, `reflex defaults`, `collapses into monoculture`, `in today's`, `gone are the days`, `whether you're`, `let's dive in`, `in summary`, `in conclusion`, `moreover`, `furthermore`. Each rule prints a rationale and a suggested replacement when it fires. **Do not silently work around the regex.** If a banned word has earned a real meaning here, raise it as a STYLE.md amendment.

The validator scans `site/pages/`, `site/content/`, `site/components/`, `site/layouts/`, `README.md`, `README.npm.md`. It deliberately skips `skill/` because LLM-facing reference instructions sometimes need technical phrasings the marketing copy can't.

The deeper structural issues (negation pivot, triadic auto-pilot, uniform paragraph rhythm, hollow confidence) require human judgment. STYLE.md lists them. Use them on every editorial pass.

## Editorial content lives under `site/content/`

Skill editorials and tutorials are read by `scripts/build.js` (for taglines and downstream tooling) and by Astro's content collection (for what actually renders on the site). One tree, one place to edit:
- `site/content/skills/<id>.md` — optional editorial wrapper with frontmatter `tagline` plus body sections
- `site/content/tutorials/<slug>.md` — full tutorial content
- `site/data/anti-patterns-catalog.js` — detection-rule catalog (visual examples, gallery items, layer definitions)

## Development Server

```bash
bun run dev        # Bun dev server at http://localhost:3000
bun run preview    # Build + Cloudflare Pages local preview
```

The dev server runs Astro (`astro dev`). Editing files in `site/content/skills/`, `skill/`, or `scripts/lib/sub-pages-data.js` requires a **server restart** (not just a browser reload) to see the change. CSS, components, and pages hot-reload fine without a restart.

**Legacy URL redirects** are emitted to `_redirects` by `scripts/build.js` (via `generateCFConfig`); the dynamic `/skills/:id → /docs/:id` redirect lives in `site/public/_redirects` (Cloudflare Pages reads both at deploy). Current redirects: `/skills` → `/docs`, `/skills/:id` → `/docs/:id`, `/cheatsheet` → `/docs`, `/gallery` → `/visual-mode#try-it-live`.

## Deployment

Hosted on Cloudflare Pages. Static assets served from `build/`, API routes handled via `_redirects` rewrites (JSON) and Pages Functions (downloads).

```bash
bun run deploy     # Build + deploy to Cloudflare Pages
```

## Build System

The build system compiles the impeccable skill from `skill/` to provider-specific formats in `dist/`:

```bash
bun run build      # Build all providers
bun run rebuild    # Clean and rebuild
```

Source files use placeholders that get replaced per-provider:
- `{{model}}` — Model name (Claude, Gemini, GPT, etc.)
- `{{config_file}}` — Config file name (CLAUDE.md, .cursorrules, etc.)
- `{{ask_instruction}}` — How to ask user questions
- `{{command_prefix}}` — `/` or `$` depending on provider
- `{{available_commands}}` — auto-populated list of commands (from `IMPECCABLE_SUB_COMMANDS` in `scripts/lib/utils.js`)
- `{{scripts_path}}` — provider-aware path to the skill's scripts directory

### Harness output directories are tracked

`.claude/skills/`, `.cursor/skills/`, `.agents/skills/`, and the other 8 harness directories are **intentionally committed to the repo**. `npx skills` reads them directly from this repo at install time, and they enable clean submodule use. Do not gitignore them. Run `bun run build` to refresh them after editing `skill/`.

Local state files inside harness directories (e.g. `.claude/scheduled_tasks.lock`, `.claude/settings.local.json`) ARE gitignored.

### Generated sub-pages are gitignored

`site/public/docs/`, `site/public/anti-patterns/`, `site/public/tutorials/`, `site/public/visual-mode/`, `site/public/slop/` are gitignored as legacy generator output paths. Astro's content collections drive the live site under `site/pages/docs/`, `site/pages/tutorials/`, etc.; nothing reads from those gitignored dirs anymore.

## Testing

```bash
bun run test            # Default suite: unit + static framework fixtures
bun run test:live-e2e   # Opt-in: full-cycle live-mode E2E across framework fixtures
```

Unit tests (build orchestration, detector logic) run via `bun test`. Fixture tests (jsdom-based HTML detection) run via `node --test` because bun is too slow with jsdom. The `test` script handles this split automatically.

**Important:** `tests/build.test.js` uses `spyOn(transformers, 'transformCursor')` with the named exports from `scripts/lib/transformers/index.js`. Those named exports (`transformCursor`, `transformClaudeCode`, etc.) are kept specifically for test spying, even though `build.js` itself uses `createTransformer + PROVIDERS` directly. **Do not delete them as "dead code"** — I made that mistake once and broke 8 tests.

### Live-mode E2E

`tests/live-e2e.test.mjs` drives the entire user flow (handshake → pick → Go → cycle → accept → carbonize cleanup) against every fixture in `tests/framework-fixtures/` that declares a `runtime` block. Each fixture installs real deps, boots its framework dev server (Vite, Next, SvelteKit, Astro, Nuxt static), and runs Playwright Chromium against a deterministic fake agent that produces realistic variants in the exact format `reference/live.md` describes.

```bash
bun run test:live-e2e                                       # full suite, ~2 min, 19 fixtures
IMPECCABLE_E2E_ONLY=vite8-react-modal bun run test:live-e2e # scope to one fixture
IMPECCABLE_E2E_DEBUG=1 bun run test:live-e2e                # dump page DOM + dev-server tail on failure
```

**One-time setup**: `npx playwright install chromium` (the suite uses a specific Chromium build keyed to the bundled Playwright version).

**Kept out of the default `bun run test`** because (a) it does real `npm install` per fixture, (b) it boots framework dev servers, (c) wall time is ~2 minutes, and (d) it requires Playwright's browser cache. Run it locally before shipping changes to anything in `skill/scripts/live-*.{mjs,js}`.

The agent is pluggable via a one-method interface in `tests/live-e2e/agent.mjs`: `generateVariants(event, context) → { scopedCss, variants[] }`. The default fake agent emits canned variants that exercise all three param kinds (`range`, `steps`, `toggle`). The orchestrator (wrap, write, accept, carbonize) is agent-agnostic.

**LLM agent (opt-in)**: set `IMPECCABLE_E2E_AGENT=llm` to swap the fake agent for `tests/live-e2e/agents/llm-agent.mjs`, which calls Claude (default Haiku 4.5) via `@anthropic-ai/sdk`. Requires `ANTHROPIC_API_KEY` in env; the test runner skips with a clear message when it's unset. Override the model with `IMPECCABLE_E2E_LLM_MODEL=claude-sonnet-4-6` if Haiku produces unreliable JSON. Caching is on — live.md is the cacheable prefix, and after the first call subsequent fixtures pay only the cache-read rate. Pass rate on a typical sweep is 18/19; the modal fixture's intrinsic state-loss flake is amplified by LLM latency and may need a re-run. **This path hits the API and costs money** — keep it out of CI unless you really want it there.

Adding a new fixture is a matter of cloning a directory under `tests/framework-fixtures/`, swapping the source files, and writing a `fixture.json`. See `tests/framework-fixtures/README.md` for the full schema.

## CLI

The CLI lives in this repo under `cli/`: `cli/bin/` (entry + sub-commands), `cli/engine/` (the detect-antipatterns rule engine + browser variant), `cli/lib/` (helpers shared by CLI and Cloudflare Pages Functions). Published to npm as `impeccable`.

```bash
npx impeccable detect [file-or-dir-or-url...]   # detect anti-patterns
npx impeccable detect --fast --json src/         # regex-only, JSON output
npx impeccable live                              # start browser overlay server
npx impeccable skills install                    # install skills
npx impeccable --help                            # show help
```

The browser detector (`cli/engine/detect-antipatterns-browser.js`) is generated from the main engine. After changing `cli/engine/detect-antipatterns.mjs`, rebuild it:

```bash
bun run build:browser
```

**IMPORTANT**: Always use `node` (not `bun`) to run the detect CLI. Bun's jsdom implementation is extremely slow and will cause scans with HTML files to hang for minutes.

## Versioning

There are three independently versioned components. Only bump the one(s) that actually changed:

**CLI** (npm package):
- `package.json` → `version`
- Bump when: CLI code changes (`cli/bin/`, `cli/engine/detect-antipatterns.mjs`, etc.)

**Skills** (Claude Code plugin / skill definitions):
- `.claude-plugin/plugin.json` → `version`
- `.claude-plugin/marketplace.json` → `plugins[0].version`
- Bump when: skill content changes (`skill/`, reference files, command metadata, etc.)

**Chrome extension**:
- `extension/manifest.json` → `version`
- Bump when: extension code changes (`extension/`)

**Website changelog** (`site/pages/index.astro`):
- Hero version link text + new changelog entry in the changelog section
- Update for user-facing changes only, not internal build/tooling details
- Use the most prominent version that changed (skills version is usually the right one)

After bumping, see **Releases** below for how to tag and publish.

## Releases

GitHub releases are tagged per-component, not per-version, since the three components ship independently. Tag prefixes: `skill-v`, `cli-v`, `ext-v`.

Workflow for any component:

1. Bump the manifest version (see Versioning above).
2. Add a changelog entry to `site/pages/index.astro`. Skill entries use a bare `vX.Y.Z` label; CLI and extension entries use the prefixed forms `CLI vX.Y.Z` and `Extension vX.Y.Z`. The release script extracts notes by matching this label, so the prefix matters.
3. Commit and push to `main`.
4. Run `bun run release:<skill|cli|ext>`. Preview first with `node scripts/release.mjs <component> --dry-run`.

The script refuses to run if: the working tree is dirty, HEAD is ahead of origin, the tag already exists, the matching changelog entry is missing, or (for skill/extension) `bun run build` / `bun run build:extension` produces uncommitted changes — meaning the harness output dirs or `extension/detector/` files weren't refreshed before the bump was committed.

Skill releases attach `dist/universal.zip`. Extension releases run `bun run build:extension` first and attach `dist/extension.zip`. CLI releases print a reminder to run `npm publish` separately; extension releases print a reminder to upload the zip to the Chrome Web Store dashboard.

If you need to fix release notes after the fact (typo, missing thank-you, formatting bug): `gh release edit <tag> --notes-file <md>`. The release script's `htmlToMarkdown` function is the cleanest source for regenerating notes from the changelog.

## Adding New Commands

All commands live under `/impeccable`. To add a new one:

1. Create `skill/reference/<command>.md` with the command's instructions (this is what the LLM loads when the command is invoked)
2. Add a row to the **Sub-command reference table** in `skill/SKILL.md`
3. Add an entry to the **Command menu** section in the same file
4. Add the command name to `IMPECCABLE_SUB_COMMANDS` in `scripts/lib/utils.js`
5. Add it to `VALID_COMMANDS` in `skill/scripts/pin.mjs`
6. Add its metadata (description + argumentHint) to `skill/scripts/command-metadata.json`
7. Add its category to `SKILL_CATEGORIES` in `scripts/lib/sub-pages-data.js`
8. Add its relationships (leadsTo / pairs / combinesWith) to `COMMAND_RELATIONSHIPS` in the same file
9. Add the same category entry to `site/scripts/data.js` `commandCategories` and `commandProcessSteps` (for the homepage carousel)
10. Add symbol + number to `commandSymbols` and `commandNumbers` in `site/scripts/components/framework-viz.js` (periodic table)
11. Optional: write an editorial wrapper at `site/content/skills/<command>.md` with a short `tagline` and expanded body (When to use it / How it works / Try it / Pitfalls)

The build system counts commands from the router table automatically. Update the command count in **all** of these locations when the total changes:

- `site/pages/index.astro` — meta descriptions, hero box, section lead
- `/cheatsheet` redirects to `/docs` (no standalone page)
- `README.md` — intro, command count, commands table
- `NOTICE.md` — command count
- `AGENTS.md` — intro command count
- `.claude-plugin/plugin.json` — description
- `.claude-plugin/marketplace.json` — metadata description + plugin description

The build validator (`generateCounts` in `scripts/build.js`) checks these files for stale numeric counts and fails the build if any disagree with the router table.

## Adding editorial content for existing commands

Editorial files live at `site/content/skills/<command>.md` and have a `tagline` frontmatter plus a body with the standard four sections:

- **When to use it** — the specific scenarios this command owns
- **How it works** — the internal process, phases, or approach
- **Try it** — one or two concrete examples with expected output
- **Pitfalls** — real failure modes, with alternatives to reach for instead

The tagline is used by UI surfaces (magazine spread, docs cards) that need a short human-friendly label. The long description in `command-metadata.json` stays optimized for auto-trigger keyword matching in the AI harness.

Every command should have an editorial file eventually, but the build does not require one: commands without editorials fall back to the frontmatter description.

## Adding or modifying anti-pattern detection rules

`cli/engine/detect-antipatterns.mjs` is the source of truth for the rule engine. It powers the CLI, the public-site overlay, the Chrome extension, and the homepage rule count. Five places stay in sync:

| Where | How it stays in sync |
|---|---|
| `cli/engine/detect-antipatterns.mjs` (`ANTIPATTERNS` array + `checkXxx` logic) | Hand-edited |
| `cli/engine/detect-antipatterns-browser.js` | `bun run build:browser` |
| `extension/detector/detect.js` + `extension/detector/antipatterns.json` | `bun run build:extension` |
| `site/public/js/generated/counts.js` (`DETECTION_COUNT`) | `bun run build` |
| `skill/SKILL.md` and `reference/*.md` | Hand-edited if the rule introduces new design guidance |

Always run all three builds and the test suite after a rule change:

```bash
bun run build && bun run build:browser && bun run build:extension && bun run test
```

### TDD order (non-negotiable)

1. **Fixture** at `tests/fixtures/antipatterns/{rule-id}.html` with two columns (should-flag / should-pass), each case identified by a unique heading. Cover ≥4 flag cases and ≥5 false-positive shapes. Use **explicit pixel dimensions in CSS** because jsdom does no layout.
2. **Failing test** in `tests/detect-antipatterns-fixtures.test.mjs` using the snippet-substring pattern (regex `/"([^"]+)"/` against `SHOULD_FLAG` / `SHOULD_PASS` lists). Run it and watch it fail before implementing.
3. **Rule entry** in the `ANTIPATTERNS` array: `id`, `category` (`slop` for AI tells, `quality` for real design or a11y issues), `name`, `description`, optional `skillSection` and `skillGuideline`.
4. **Pure check function** `checkXxx(opts)` returning `[{ id, snippet }]`. No DOM access in the pure function.
5. **Two adapters**: `checkElementXxxDOM(el)` for the browser (`getComputedStyle` + `getBoundingClientRect`) and `checkElementXxx(el, tag, window)` for jsdom (`parseFloat(style.width)` instead of layout). Wire **both** into **both** element loops in `cli/engine/detect-antipatterns.mjs` — the browser loop (~line 1837) and the jsdom loop in `detectHtml` (~line 2058). Forgetting one is the most common mistake; symptom is "test passes, live page silent" or vice versa.
6. **Verify on a live page**: `http://localhost:3000/fixtures/antipatterns/{rule-id}.html` and the homepage (no false positives). The two adapter paths can disagree, so manual browser checks catch what the fixture test can't.

### Conventions and jsdom gotchas

- **Snippet format**: wrap the identifying heading text in straight double quotes (e.g. `'icon tile above h3 "Lightning Fast"'`) so the fixture test can extract it. For rules not anchored to a heading, pick another stable identifier.
- **jsdom doesn't lay out**: `getBoundingClientRect()` returns 0×0. Read `parseFloat(style.width)` and `parseFloat(style.height)` from explicit CSS instead.
- **`background:` shorthand isn't decomposed in jsdom**: use the existing `resolveBackground()` and `resolveGradientStops()` helpers (~line 631 / 670).
- **Computed colors aren't normalized in jsdom**: `parseGradientColors()` handles both hex and rgb forms.

Reference rules to copy from: `side-tab` (border, ~line 312), `low-contrast` (color + gradient, ~line 339), `icon-tile-stack` (sibling relationship, ~line 425), `flat-type-hierarchy` (page-level, ~line 1080).

## Evals Framework (separate private repo)

The eval framework lives in a separate private repo at `~/code/impeccable-evals/`. It measures whether the `/impeccable` skill improves or harms AI-generated frontend design by running the same brief through a model with and without the skill loaded.

**If you're picking up eval work, switch to that repo and read its `AGENT.md` first.** It captures model choices, sample size policy, lessons learned, common workflows, and gotchas.

```bash
cd ~/code/impeccable-evals
bun run serve            # dashboard on http://localhost:8723
```

The eval runners read this repo's skill from `../impeccable/skill/` and staged provider skills from `../impeccable/build/_data/dist/*`. Run `bun run build` in this repo before an eval sweep if you want the Claude/Gemini staged skills to reflect your latest edits.

### After structural skill changes, update `inline-skill.ts` in the evals repo

The harness inlines `SKILL.md` into the system prompt for "skill-on", stripping sections irrelevant to an API-driven craft run. The stripped list in `runner/inline-skill.ts` needs to stay in sync with `SKILL.md`'s top-level `##` headings. As of v3.0, it should strip `## Setup (non-optional)` (was `## Context Gathering Protocol`), `## Commands` (was `## Command Router`), and `## Pin / Unpin`. Keep `## Shared design laws`. If you add or rename a top-level section, update the strip list there.
