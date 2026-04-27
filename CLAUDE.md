# Project Instructions for Claude

## Skill bootstrap: skip the post-update-cleanup step

The `<post-update-cleanup>` block at the top of `.claude/skills/impeccable/SKILL.md` runs `scripts/cleanup-deprecated.mjs` and then self-deletes. **Do not run it in this repo, and do not delete the block.** This repo is the source of truth for the Impeccable skill; the cleanup script scans for "leftover" skill files to remove and its judgment doesn't fit a repo where the skill lives in `source/`. The block is also regenerated from `source/skills/impeccable/SKILL.md` on every `bun run build`, so any deletion churns back on the next build. Skip the step silently and proceed.

Same rule for AGENTS.md and every other harness-specific instruction file: treat post-update-cleanup as a no-op in this repo.

## Architecture (v3.0+)

There is **one** user-invocable skill, `impeccable`, with **23 commands** underneath it. Users type `/impeccable polish`, `/impeccable audit`, etc. The skill is defined in `source/skills/impeccable/`:

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

Plain hand-written CSS, no Tailwind, no build step. Bun's HTML loader resolves `<link rel="stylesheet">` and inlines `@import` chains automatically for both `bun run dev` and `bun run build`.

The CSS architecture:
- `public/css/main.css` — Main entry point, imports the partials and defines tokens/reset
- `public/css/workflow.css` — Commands section, glass terminal, magazine spread styles
- `public/css/sub-pages.css` — `/docs`, `/anti-patterns`, `/tutorials`, detail pages
- `public/css/tokens.css` — OKLCH color tokens (ink, charcoal, ash, mist, cream, accent)

Edit any of these directly and reload. No rebuild needed for CSS changes.

## Color token rule

- **`--color-ink`** (10% lightness) is for body copy. Use it even for small text.
- **`--color-charcoal`** (25% lightness) reads as washed-out gray in small text. Only use for headings or larger body copy at ≥16px.
- **`--color-ash`** (55%) is for secondary labels, captions, relationship meta lines.
- **Never use pure black or pure white.** Use the tinted tokens.

## No em dashes, no `--` either

CLAUDE.md feedback from multiple sessions: "no em dashes in project copy" does NOT mean "replace with `--`". It means **use actual punctuation**: commas, colons, semicolons, periods, parentheses. The `--` substitution makes the problem worse. The build validator (`validateNoEmDashes` in `scripts/build.js`) catches real em dashes but not the `--` double-hyphen habit, so you have to catch yourself.

## Development Server

```bash
bun run dev        # Bun dev server at http://localhost:3000
bun run preview    # Build + Cloudflare Pages local preview
```

The dev server (in `server/index.js`) runs `generateSubPages` at module load, so editing source files in `content/site/skills/`, `source/skills/impeccable/`, or the sub-page generator requires a **server restart** (not just a browser reload) to see the change. CSS hot-reloads fine without a restart.

**Legacy URL redirects** live in `server/index.js` and must stay in sync with `scripts/build.js` `_redirects` generation. Current redirects: `/skills` → `/docs`, `/skills/:id` → `/docs/:id`, `/cheatsheet` → `/docs`, `/gallery` → `/visual-mode#try-it-live`.

## Deployment

Hosted on Cloudflare Pages. Static assets served from `build/`, API routes handled via `_redirects` rewrites (JSON) and Pages Functions (downloads).

```bash
bun run deploy     # Build + deploy to Cloudflare Pages
```

## Build System

The build system compiles the impeccable skill from `source/` to provider-specific formats in `dist/`:

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

`.claude/skills/`, `.cursor/skills/`, `.agents/skills/`, and the other 8 harness directories are **intentionally committed to the repo**. `npx skills` reads them directly from this repo at install time, and they enable clean submodule use. Do not gitignore them. Run `bun run build` to refresh them after editing `source/skills/`.

Local state files inside harness directories (e.g. `.claude/scheduled_tasks.lock`, `.claude/settings.local.json`) ARE gitignored.

### Generated sub-pages are gitignored

`public/docs/`, `public/anti-patterns/`, `public/tutorials/`, `public/visual-mode/` are generated by `scripts/build-sub-pages.js` on dev server startup and during `bun run build`. They're gitignored because the production site (Cloudflare Pages) runs its own build and nobody consumes them directly from git.

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

**Kept out of the default `bun run test`** because (a) it does real `npm install` per fixture, (b) it boots framework dev servers, (c) wall time is ~2 minutes, and (d) it requires Playwright's browser cache. Run it locally before shipping changes to anything in `source/skills/impeccable/scripts/live-*.{mjs,js}`.

The agent is pluggable via a one-method interface in `tests/live-e2e/agent.mjs`: `generateVariants(event, context) → { scopedCss, variants[] }`. The default fake agent emits canned variants that exercise all three param kinds (`range`, `steps`, `toggle`). The orchestrator (wrap, write, accept, carbonize) is agent-agnostic.

**LLM agent (opt-in)**: set `IMPECCABLE_E2E_AGENT=llm` to swap the fake agent for `tests/live-e2e/agents/llm-agent.mjs`, which calls Claude (default Haiku 4.5) via `@anthropic-ai/sdk`. Requires `ANTHROPIC_API_KEY` in env; the test runner skips with a clear message when it's unset. Override the model with `IMPECCABLE_E2E_LLM_MODEL=claude-sonnet-4-6` if Haiku produces unreliable JSON. Caching is on — live.md is the cacheable prefix, and after the first call subsequent fixtures pay only the cache-read rate. Pass rate on a typical sweep is 18/19; the modal fixture's intrinsic state-loss flake is amplified by LLM latency and may need a re-run. **This path hits the API and costs money** — keep it out of CI unless you really want it there.

Adding a new fixture is a matter of cloning a directory under `tests/framework-fixtures/`, swapping the source files, and writing a `fixture.json`. See `tests/framework-fixtures/README.md` for the full schema.

## CLI

The CLI lives in this repo under `bin/` and `src/`. Published to npm as `impeccable`.

```bash
npx impeccable detect [file-or-dir-or-url...]   # detect anti-patterns
npx impeccable detect --fast --json src/         # regex-only, JSON output
npx impeccable live                              # start browser overlay server
npx impeccable skills install                    # install skills
npx impeccable --help                            # show help
```

The browser detector (`src/detect-antipatterns-browser.js`) is generated from the main engine. After changing `src/detect-antipatterns.mjs`, rebuild it:

```bash
bun run build:browser
```

**IMPORTANT**: Always use `node` (not `bun`) to run the detect CLI. Bun's jsdom implementation is extremely slow and will cause scans with HTML files to hang for minutes.

## Versioning

There are three independently versioned components. Only bump the one(s) that actually changed:

**CLI** (npm package):
- `package.json` → `version`
- Bump when: CLI code changes (`bin/`, `src/detect-antipatterns.mjs`, etc.)

**Skills** (Claude Code plugin / skill definitions):
- `.claude-plugin/plugin.json` → `version`
- `.claude-plugin/marketplace.json` → `plugins[0].version`
- Bump when: skill content changes (`source/skills/`, reference files, command metadata, etc.)

**Chrome extension**:
- `extension/manifest.json` → `version`
- Bump when: extension code changes (`extension/`)

**Website changelog** (`public/index.html`):
- Hero version link text + new changelog entry in the changelog section
- Update for user-facing changes only, not internal build/tooling details
- Use the most prominent version that changed (skills version is usually the right one)

## Adding New Commands

All commands live under `/impeccable`. To add a new one:

1. Create `source/skills/impeccable/reference/<command>.md` with the command's instructions (this is what the LLM loads when the command is invoked)
2. Add a row to the **Sub-command reference table** in `source/skills/impeccable/SKILL.md`
3. Add an entry to the **Command menu** section in the same file
4. Add the command name to `IMPECCABLE_SUB_COMMANDS` in `scripts/lib/utils.js`
5. Add it to `VALID_COMMANDS` in `source/skills/impeccable/scripts/pin.mjs`
6. Add its metadata (description + argumentHint) to `source/skills/impeccable/scripts/command-metadata.json`
7. Add its category to `SKILL_CATEGORIES` in `scripts/lib/sub-pages-data.js`
8. Add its relationships (leadsTo / pairs / combinesWith) to `COMMAND_RELATIONSHIPS` in the same file
9. Add the same category entry to `public/js/data.js` `commandCategories` and `commandProcessSteps` (for the homepage carousel)
10. Add symbol + number to `commandSymbols` and `commandNumbers` in `public/js/components/framework-viz.js` (periodic table)
11. Optional: write an editorial wrapper at `content/site/skills/<command>.md` with a short `tagline` and expanded body (When to use it / How it works / Try it / Pitfalls)

The build system counts commands from the router table automatically. Update the command count in **all** of these locations when the total changes:

- `public/index.html` — meta descriptions, hero box, section lead
- `public/cheatsheet.html` does not exist anymore; `/cheatsheet` redirects to `/docs`
- `README.md` — intro, command count, commands table
- `NOTICE.md` — command count
- `AGENTS.md` — intro command count
- `.claude-plugin/plugin.json` — description
- `.claude-plugin/marketplace.json` — metadata description + plugin description

The build validator (`generateCounts` in `scripts/build.js`) checks these files for stale numeric counts and fails the build if any disagree with the router table.

## Adding editorial content for existing commands

Editorial files live at `content/site/skills/<command>.md` and have a `tagline` frontmatter plus a body with the standard four sections:

- **When to use it** — the specific scenarios this command owns
- **How it works** — the internal process, phases, or approach
- **Try it** — one or two concrete examples with expected output
- **Pitfalls** — real failure modes, with alternatives to reach for instead

The tagline is used by UI surfaces (magazine spread, docs cards) that need a short human-friendly label. The long description in `command-metadata.json` stays optimized for auto-trigger keyword matching in the AI harness.

Every command should have an editorial file eventually, but the build does not require one: commands without editorials fall back to the frontmatter description.

## Adding or modifying anti-pattern detection rules

`src/detect-antipatterns.mjs` is the source of truth for the rule engine. It powers the CLI, the public-site overlay, the Chrome extension, and the homepage rule count. Five places stay in sync:

| Where | How it stays in sync |
|---|---|
| `src/detect-antipatterns.mjs` (`ANTIPATTERNS` array + `checkXxx` logic) | Hand-edited |
| `src/detect-antipatterns-browser.js` | `bun run build:browser` |
| `extension/detector/detect.js` + `extension/detector/antipatterns.json` | `bun run build:extension` |
| `public/js/generated/counts.js` (`DETECTION_COUNT`) | `bun run build` |
| `source/skills/impeccable/SKILL.md` and `reference/*.md` | Hand-edited if the rule introduces new design guidance |

Always run all three builds and the test suite after a rule change:

```bash
bun run build && bun run build:browser && bun run build:extension && bun run test
```

### TDD order (non-negotiable)

1. **Fixture** at `tests/fixtures/antipatterns/{rule-id}.html` with two columns (should-flag / should-pass), each case identified by a unique heading. Cover ≥4 flag cases and ≥5 false-positive shapes. Use **explicit pixel dimensions in CSS** because jsdom does no layout.
2. **Failing test** in `tests/detect-antipatterns-fixtures.test.mjs` using the snippet-substring pattern (regex `/"([^"]+)"/` against `SHOULD_FLAG` / `SHOULD_PASS` lists). Run it and watch it fail before implementing.
3. **Rule entry** in the `ANTIPATTERNS` array: `id`, `category` (`slop` for AI tells, `quality` for real design or a11y issues), `name`, `description`, optional `skillSection` and `skillGuideline`.
4. **Pure check function** `checkXxx(opts)` returning `[{ id, snippet }]`. No DOM access in the pure function.
5. **Two adapters**: `checkElementXxxDOM(el)` for the browser (`getComputedStyle` + `getBoundingClientRect`) and `checkElementXxx(el, tag, window)` for jsdom (`parseFloat(style.width)` instead of layout). Wire **both** into **both** element loops in `src/detect-antipatterns.mjs` — the browser loop (~line 1837) and the jsdom loop in `detectHtml` (~line 2058). Forgetting one is the most common mistake; symptom is "test passes, live page silent" or vice versa.
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

The eval runners read this repo's skill from `../impeccable/source/skills/impeccable/` and staged provider skills from `../impeccable/build/_data/dist/*`. Run `bun run build` in this repo before an eval sweep if you want the Claude/Gemini staged skills to reflect your latest edits.

### After structural skill changes, update `inline-skill.ts` in the evals repo

The harness inlines `SKILL.md` into the system prompt for "skill-on", stripping sections irrelevant to an API-driven craft run. The stripped list in `runner/inline-skill.ts` needs to stay in sync with `SKILL.md`'s top-level `##` headings. As of v3.0, it should strip `## Setup (non-optional)` (was `## Context Gathering Protocol`), `## Commands` (was `## Command Router`), and `## Pin / Unpin`. Keep `## Shared design laws`. If you add or rename a top-level section, update the strip list there.
