# The engine: the Rust runtime behind every skill verb

Every command the skill text runs is `{{scripts_path}}/impeccable <verb>`. The
launcher next to the skill (`skill/scripts/impeccable`, `impeccable.cmd`)
finds or downloads one static binary per platform and execs it. That binary
is built from this repo's Cargo workspace. There is no Node at runtime.

This page is the map for anyone building or changing the runtime. The
observable behavior of every verb is specified in `CLI-CONTRACT.md` and
pinned byte-for-byte by `tests/oracle/`.

## Layout

```
Cargo.toml              the workspace (crates/*), release profile
rust-toolchain.toml     EXACT rustc pin (see "The closed detector")
DETECTOR_VERSION        which prebuilt detector release crates/core links
ENGINE_VERSION          which engine release the launcher / npm shim download
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
  foundation   OPEN helpers + boundary types: JS-semantics helpers, color,
               findings, registry, inline ignores, the Dom trait, SnapshotDom
  core         the shim: re-exports foundation under the paths every crate
               uses, and forwards the rule checks to the closed detector
```

Build and test:

```bash
cargo build --release -p impeccable      # target/release/impeccable
cargo test --workspace
IMPECCABLE_BIN=target/release/impeccable node tests/oracle/run.mjs   # the behavior gate
```

`bun run test` and the oracle find the binary through `IMPECCABLE_BIN` or
`skill/scripts/bin/<os>-<arch>/` (`bun run fetch:engine` downloads the pinned
release there; `IMPECCABLE_BIN=target/release/impeccable bun run fetch:engine`
copies a local build).

## The closed detector

The rule engine itself (the checks, the browser rule adapters, the visual
contrast decisions) is proprietary and lives in a private repo. It ships as a
prebuilt native archive per target, `libimpeccable_detector-<os>-<arch>.a`
(`impeccable_detector-windows-x64.lib`), published as the GitHub Release
`detector-v<DETECTOR_VERSION>` on this repo, next to
`detector-browser-bundle.zip` (the same rules compiled to wasm for the
extension, the live overlay and the site).

`crates/core/build.rs` resolves the archive in this order and links it:

1. `IMPECCABLE_DETECTOR_LIB=<dir>`: a directory holding the archive for the
   current target (a local build of the detector repo).
2. `~/.impeccable/detector/<DETECTOR_VERSION>/<os>-<arch>/` (`IMPECCABLE_HOME`
   moves the root).
3. A download from `detector-v<DETECTOR_VERSION>` into that cache, verified
   against the `.sha256` sidecar. `IMPECCABLE_DETECTOR_BASE` overrides the
   release root; `IMPECCABLE_DETECTOR_OFFLINE=1` refuses to download.

Three things follow from how that archive is made, and they are the reason
for three otherwise odd-looking settings:

- **The toolchain is pinned to an exact version.** The archive is the closed
  crates' rlib objects repacked with `llvm-ar`, with no std inside. Its
  objects reference std by mangled symbol name, which only resolves against
  the same rustc build. `rust-toolchain.toml` pins it; rustup installs it on
  first `cargo` invocation. A toolchain bump needs a new detector release.
- **The release profile has `lto = false`.** Fat and thin LTO internalize std
  symbols the opaque archive still needs and the link fails with "symbol(s)
  not found". Cargo's default thin-local LTO stays.
- **`crates/core` keeps the old paths.** Nothing outside `crates/core` and
  `crates/foundation` knows about the boundary: `impeccable_core::checks::
  rules::check_colors` is a one-line shim that encodes its argument, calls
  the archive, decodes the result. The C-ABI is three symbols
  (`det_abi_version`, `det_call`, `det_free`) and a host vtable the closed
  side uses to call back into the open `Dom` / `StyleMap` implementations.
  Every id and every type that crosses is declared in
  `crates/foundation/src/boundary.rs`; the shim checks the ABI number once
  and panics with a clear message when the archive was built for another.

The frozen function-level vectors in `tests/oracle/vectors/calls/` replay
through the shipped archive (`impeccable_core::vectors::call` forwards
unknown names to it), so the black box is verified the same way the open
code is.

## Releases

Three release kinds touch the runtime, in this order:

1. **Detector** (`detector-v<X>`, published by the private repo's CI to this
   repo's Releases). `DETECTOR_VERSION` here pins it.
2. **Engine** (`engine-v<ENGINE_VERSION>`): `bun run release:engine` verifies
   the detector release exists (`scripts/check-detector-release.mjs`), tags,
   and pushes; `.github/workflows/release-engine.yml` builds the five targets
   and publishes the binaries with `.sha256` sidecars. The launcher, the npm
   shim and `impeccable install` download from
   `github.com/pbakaus/impeccable/releases/download/engine-v<X>/`.
3. **npm platform packages**, then the **skill** and **CLI** releases, which
   `scripts/check-engine-release.mjs` gates on the engine release.

CI runs the workspace build and tests (`rust`, `rust-windows`) and the oracle
against a source build; both are warn-only until the first detector release
exists, then their `continue-on-error` flips to false.

## Working on the detector

Changes to rule logic happen in the private detector repo. Point the shim at
a local build while iterating:

```bash
# in the detector repo
cargo xtask detector-archive --out /tmp/det
# here
IMPECCABLE_DETECTOR_LIB=/tmp/det cargo test --workspace
```

Adding a function that the open crates call: add its id to
`foundation/src/boundary.rs` (never renumber), the shim in `crates/core`, the
dispatcher arm in the detector repo, and bump `boundary::ABI` if any existing
signature or type changed. The shim's test diffs the two id tables.
