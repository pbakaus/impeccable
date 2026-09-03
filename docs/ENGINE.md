# The engine: the Rust runtime behind every skill verb

Every command the skill text runs is `{{scripts_path}}/impeccable <verb>`. The
launcher next to the skill (`skill/scripts/impeccable`, `impeccable.cmd`)
finds or downloads one static binary per platform and execs it. That binary
is built from this repo's Cargo workspace. There is no Node at runtime.

This page is the map for anyone building or changing the runtime. The
observable behavior of every verb is specified in `CLI-CONTRACT.md` and
pinned byte-for-byte by `tests/oracle/`.

Everything is in this repo, Apache-2.0, and builds offline from source. No
part of the engine is fetched at build time.

## Layout

```
Cargo.toml              the workspace (crates/*), release profile
rust-toolchain.toml     the channel plus the wasm32 target
ENGINE_VERSION          which engine release the launcher / npm shim download
.cargo/config.toml      the `cargo xtask` alias
browser-bundle/         the page JS the in-page bundle is built from
crates/
  cli          the `impeccable` binary: verb router, exit codes
  common       Io handle (stdout/stderr/stdin/env/cwd), path + process helpers
  context      context, doctor, staleness, signals, concept-seed, pin, ...
  hook         the design hook (hook, hook-before-edit, hook-admin)
  live         live mode: server, wrap, accept, manual edits, Svelte/Vue
  skills       install / update / check / link (the old npm CLI verbs)
  comp         comp-fidelity pure libs (raster, png, metrics, fonts)
  comp-verbs   build-phase, comp-diff, comp-spec, font-match
  detect       `impeccable detect`: file walk, config, ignores, output, regex engine
  html         the static HTML engine: parser, cascade, static DOM, rule adapters
  browser      the URL engine: Chrome discovery, CDP, snapshot, visual pass
  foundation   JS-semantics helpers, color, findings, the rule registry, inline
               ignores, the Dom trait, SnapshotDom, and the plain-data types
               every check takes in and hands back
  core         the rule logic: every `check_*` / `scan_*` and its heuristics,
               the browser rule adapters, the visual-contrast decisions
  wasm         wasm-bindgen exports over `core` (the in-page bundle and the
               extension's offscreen core)
  xtask        `cargo xtask bundle`: builds the in-page bundle and the
               extension pieces
```

`crates/core` re-exports the foundation modules under its own paths, so every
consumer names one crate: `impeccable_core::js`, `impeccable_core::color`,
`impeccable_core::checks::rules::check_colors`,
`impeccable_core::browser::driver::collect_browser_findings`. The split
between the two crates is about what a check is written against, not about
who may see it.

Build and test:

```bash
cargo build --release -p impeccable      # target/release/impeccable
cargo test --workspace
IMPECCABLE_BIN=target/release/impeccable node tests/oracle/run.mjs   # the behavior gate
```

`bun run test` and the oracle find the binary through `IMPECCABLE_BIN`, then
`skill/scripts/bin/<os>-<arch>/` (`bun run fetch:engine` downloads the pinned
release there; `IMPECCABLE_BIN=target/release/impeccable bun run fetch:engine`
copies a local build), then `target/release/impeccable`, so a plain
`cargo build --release -p impeccable` is enough.

The frozen function-level vectors in `tests/oracle/vectors/calls/` replay
through `impeccable_core::vectors::call` (`cargo test -p impeccable-core`),
which is the union of foundation's dispatch arms and the core's.

## The browser bundle

The same rules that run natively run in a page, compiled to WebAssembly.
`cargo xtask bundle` is the one command that produces every browser artifact:

1. `wasm-pack build crates/wasm --target no-modules --release` into
   `target/wasm-bundle/` (opt-level `z`, then `wasm-opt`).
2. Concatenate the page JS in `browser-bundle/*.js` in a fixed order with the
   wasm-bindgen glue and the `.wasm` embedded as base64. The page JS only
   implements the `Dom` probe, marshals JSON, and draws the overlay; no rule
   logic lives there.
3. Write `dist/detect-antipatterns-browser.js` and `dist/antipatterns.json`,
   and copy the bundle to
   **`crates/live/assets/detect-antipatterns-browser.js`**. That copy is a
   tracked generated file: `crates/live/src/browser_assets.rs` embeds it with
   `include_str!` and the live server hands it to the browser as `/detect.js`,
   so the binary has to carry it.
4. Write the five extension pieces into `extension/detector/`
   (`snapshot.js`, `overlay.js`, `core.js`, `core_bg.wasm`,
   `antipatterns.json`). That directory is gitignored;
   `bun run build:extension` runs this task and then packages the zips.

`cargo xtask bundle --check` rebuilds and fails when the tracked live asset is
stale, which is the CI staleness gate. The build is deterministic: same
sources, same bytes.

`wasm-pack` is the one extra tool this needs (`cargo install wasm-pack
--locked`) plus the `wasm32-unknown-unknown` target, which
`rust-toolchain.toml` requests. `IMPECCABLE_XTASK_SKIP_WASM_PACK=1` reuses
whatever is already in `target/wasm-bundle/`, for iterating on the page JS
alone. `IMPECCABLE_EXTENSION_SKIP_BUNDLE=1` lets `bun run build:extension`
skip the bundle step when `extension/detector/` is already complete, for CI
matrices that pre-built it.

Run `cargo xtask bundle` after touching `crates/core`, `crates/wasm`, or
`browser-bundle/`, and commit the refreshed live asset.

## Releases

Two release kinds touch the runtime, in this order:

1. **Engine** (`engine-v<ENGINE_VERSION>`): `bun run release:engine` verifies
   the version, the npm platform-package pins and a clean tree, then tags and
   pushes; `.github/workflows/release-engine.yml` builds the five targets and
   publishes the binaries with `.sha256` sidecars. The launcher, the npm shim
   and `impeccable install` download from
   `github.com/pbakaus/impeccable/releases/download/engine-v<X>/`.
2. **npm platform packages**, then the **skill** and **CLI** releases, which
   `scripts/check-engine-release.mjs` gates on the engine release.

The extension ships its own vendored WASM core and never execs the engine
binary, so `bun run release:ext` is exempt from that gate. It does need
`bun run build:extension` (and therefore a Rust toolchain and `wasm-pack`)
before the zip is attached.

CI runs the workspace build and tests (`rust`, `rust-windows`) and replays the
oracle against a release build from the checkout under test.
