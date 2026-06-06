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

## Assumptions

- "Three other repos" means the issue body's three child projects inside one monorepo, not Git submodules.
- Project-level context overwrites root context per file; extension/merge semantics are out of scope for this first implementation.
- Root `.impeccable/live/config.json` should not silently drive child app live mode; child apps get their own `.impeccable` state.
