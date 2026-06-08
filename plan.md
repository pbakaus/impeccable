# Issue 202: Monorepo Context Plan

## Summary

Implement monorepo-aware context loading for issue #202, following the owner guidance in comment 4634508507:

- Keep single-repo overhead tiny and deterministic.
- Support common monorepo frameworks instead of assuming only `apps/`.
- Treat `.impeccable` as project-scoped state where possible.
- Cover the behavior with unit tests.

This plan uses a fresh worktree from `origin/main` because the original checkout had unrelated dirty changes.

## Key Changes

- Add deterministic project-root discovery for common monorepo signals: `package.json` workspaces, `pnpm-workspace.yaml`, `turbo.json`, `nx.json`, `lerna.json`, plus `apps/*` / `packages/*` fallback when a monorepo marker exists.
- Update context loading so active project files override root files per file:
  - child `PRODUCT.md` overrides root `PRODUCT.md`
  - child `DESIGN.md` overrides root `DESIGN.md`
  - missing child files inherit the matching root file
  - no merging or extension in this pass
- Keep current single-repo behavior and `IMPECCABLE_CONTEXT_DIR` fallback semantics intact.
- Scope `.impeccable` paths to the resolved active project root for live config, design sidecar, sessions, annotations, and critique storage.
- Update `skill/SKILL.src.md` setup guidance so agents can pass an explicit target path when available; otherwise cwd-based resolution remains the default.
- Update the README with tree-style ASCII examples matching the issue's framing.
- Include the same tree-style ASCII diagrams in the PR description to explain inheritance and override behavior.
- Regenerate provider outputs with `bun run build`.

## Public Interfaces

- Extend context helpers with an options object, for example `loadContext(cwd, { targetPath })`, while preserving existing call signatures.
- Add CLI support for `node context.mjs --target apps/dashboard/src/App.tsx`.
- Preserve existing `PRODUCT.md`, `DESIGN.md`, `productPath`, `designPath`, and `contextDir` fields; add project/root metadata only if useful for scripts.

## Documentation Diagrams

Use tree-style ASCII, close to the original issue.

```text
Case 1: child apps inherit root context

PRODUCT.md
DESIGN.md
apps/
|-- marketing/
|-- dashboard/
`-- admin/
```

```text
Case 2: child app context overrides root context

PRODUCT.md
DESIGN.md
apps/
|-- marketing/
|   |-- PRODUCT.md  -> overrides root PRODUCT.md
|   `-- DESIGN.md   -> overrides root DESIGN.md
|-- dashboard/
|   `-- PRODUCT.md  -> overrides root PRODUCT.md, inherits root DESIGN.md
`-- admin/
    `-- inherits root PRODUCT.md + DESIGN.md
```

## Tests

- Add a monorepo fixture in `tests/context.test.mjs` with root `PRODUCT.md` / `DESIGN.md` and three child apps: `apps/marketing`, `apps/dashboard`, `apps/admin`.
- Test inheritance: none of the child apps has context files, and running from each app loads the root product and design context.
- Test overrides: child apps define their own `PRODUCT.md` and/or `DESIGN.md`; those specific files replace root context while absent files still inherit root context.
- Add `.impeccable` path tests proving an active child app uses `apps/<app>/.impeccable/...`, not root `.impeccable/...`.
- Run focused checks: `node --test tests/context.test.mjs` and `node --test tests/impeccable-paths.test.mjs`.
- Finish with `bun run build` and `bun run test`.

## Headless Provider Mega Test

Add a local-only mega test harness under `tmp/issue-202-headless-harness/`. The repo already ignores `tmp/`, so the harness, linked provider files, logs, and disposable monorepo projects stay out of git.

The harness should create one scratch monorepo with this shape:

```text
PRODUCT.md
DESIGN.md
apps/
|-- marketing/
|-- dashboard/
`-- admin/
```

Then run the same behavior against headless Claude, Cursor, and Codex provider installs:

- Link the local worktree skill into provider-specific scratch workspaces with the local CLI, for example `node ./cli/bin/cli.js skills link --source=. --providers=claude,cursor,codex --force -y`.
- Drive the installed headless agent CLIs where available: Claude Code, Cursor, and Codex. Discover the exact local command shape from each CLI's `--help` output inside the harness instead of baking in a brittle command.
- Give each agent the same scratch monorepo and a machine-readable prompt asking it to resolve context for `apps/marketing`, `apps/dashboard`, and `apps/admin`.
- Also run the provider-linked `context.mjs` scripts headlessly, not the source-tree script directly, so generated provider output is tested with deterministic assertions even if an agent CLI is unavailable or produces noisy prose.
- Assert inheritance when child apps do not have `PRODUCT.md` / `DESIGN.md`: `marketing`, `dashboard`, and `admin` all resolve root product and design context.
- Assert per-file overrides when `marketing` has both files, `dashboard` has only `PRODUCT.md`, and `admin` has none:
  - `marketing` resolves child product and child design.
  - `dashboard` resolves child product and root design.
  - `admin` resolves root product and root design.
- Assert active child `.impeccable` paths are scoped under `apps/<app>/.impeccable/...` for each provider install.

Repeat/fix loop:

- Run the mega test.
- If Claude, Cursor, or Codex fails, inspect the harness output and provider-linked files.
- Fix source files in `skill/`, `skill/scripts/`, `scripts/`, or docs as needed.
- Re-run focused checks, `bun run build`, and the mega test.
- Repeat until all three headless provider harnesses pass, then finish with `bun run test`.

## Assumptions

- "Three other repos" means the issue body's three child projects inside one monorepo, not Git submodules.
- Project-level context overwrites root context per file; extension/merge semantics are out of scope for this first implementation.
- Root `.impeccable/live/config.json` should not silently drive child app live mode; child apps get their own `.impeccable` state.
