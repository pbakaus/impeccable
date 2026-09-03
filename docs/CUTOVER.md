# Cutover: shipping the Rust engine (the maintainer's checklist)

State as of 2026-09-03. Everything below `rust-swap` is verified and pushed;
nothing irreversible has happened: no engine tag, no npm publish, no merge.
The detector is open source (the closed-core mechanism was built, measured,
and removed the same week; the private `impeccable-detector` repo is archived
as the record). The old `impeccable-dist` channel is archived too.

## Steps, in order

1. **Rebase and final drift check.** `git fetch && git log --oneline
   94b7f34f..origin/main -- skill/scripts scripts/lib` (nothing had landed
   as of 2026-09-03). Rebase `rust-swap` onto `origin/main`.
2. **Engine release.** `bun run release:engine` (clean tree, pushed, tag
   free, `package.json` platform pins equal `ENGINE_VERSION`). It tags
   `engine-v<ENGINE_VERSION>`; `.github/workflows/release-engine.yml` builds
   the five binaries (darwin-arm64, darwin-x64 on the arm64 runner, linux-x64
   and linux-arm64 musl, windows-x64) and publishes them with `.sha256`
   sidecars on this repo's Releases. Check: `bun run check:engine-release`
   passes its binary half.
3. **npm.** Create the `@impeccable` scope if it does not exist, `npm login`,
   then publish the five `@impeccable/cli-<os>-<arch>` platform packages from
   the release assets (`cli/platform-packages/` holds the templates at
   version `0.0.0-engine`; stamp `ENGINE_VERSION`, put the binary at `bin/`,
   `npm publish --access public`). Then the `impeccable` shim through
   `bun run release:cli` plus `npm publish`. `bun run check:engine-release`
   is fully green after this.
4. **Clean-HOME launcher check.** `rm -rf ~/.impeccable/bin`, then run
   `skill/scripts/impeccable context` from any project: it must download from
   `engine-v<X>` and run.
5. **Merge** `rust-swap` into `main`. The sync workflow regenerates the
   provider directories (they still carry copies of the retired JS engine;
   the sync rewrites them). CI's `rust`, `rust-windows` and `oracle` jobs are
   required already.
6. **Version bumps and changelog** for skill, CLI and extension. The
   extension is the wasm-core shell now (manifest held at 1.3.3; the bump
   plus a Web Store resubmission for the new `offscreen` permission are
   yours). Flip `engine-release-ready` to required.
7. **Housekeeping.** Revoke the fine-grained PAT `impeccable-detector-release`
   in your GitHub settings (created for the closed-core release flow; its
   secret is already deleted).

## What to know

- `cargo xtask bundle` regenerates `crates/live/assets/detect-antipatterns-browser.js`
  (tracked) and `extension/detector/` (vendored at build). `bun run
  build:extension` runs it; CI installs `wasm-pack` for that.
- The oracle replays byte-for-byte on macOS and Linux (795 cases on macOS,
  794 plus one platform skip on Linux). `tests/oracle/DELTAS.md` records the
  two goldens re-recorded when the harness started staging workspaces at
  their real path.
- The Firefox extension zip is packaged and lint-clean but cannot run the
  offscreen-document design; a Gecko fallback is future work before an AMO
  release.
- Pristine consumes this engine as a wasm module built from a git revision
  pin (branch `rust-engine` in the pristine repo): its `rules/` crate links
  `impeccable-core`, `impeccable-wasm` (`detect` feature) and
  `impeccable-bundle` with its own rule pack, and `bun run engine:bump` moves
  the pin (a weekly workflow opens the PR). No engine code is copied there.
  Until `rust-swap` merges, that pin points at a `rust-swap` commit; after
  the merge, switch the bump script's branch constant to `main`.
