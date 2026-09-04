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
  bundle       the page JS plus the bundler: in-page bundle, extension
               pieces, registry JSON, the wasm-pack call
  xtask        `cargo xtask bundle`: the workspace's caller of `bundle`
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
   and copy both into **`crates/live/assets/`**. Those two copies are tracked
   generated files. `crates/live/src/browser_assets.rs` embeds the bundle with
   `include_str!` and the live server hands it to the browser as `/detect.js`,
   so the binary has to carry it. `antipatterns.json` is the registry
   (`[{ id, name, category, description }]`) that a consumer working from a
   source checkout or a repo tarball reads without a Rust toolchain, since
   `extension/detector/` is gitignored; impeccable.style counts and renders
   the rules from it.
4. Write the five extension pieces into `extension/detector/`
   (`snapshot.js`, `overlay.js`, `core.js`, `core_bg.wasm`,
   `antipatterns.json`). That directory is gitignored;
   `bun run build:extension` runs this task and then packages the zips.

`cargo xtask bundle --check` rebuilds and fails when either tracked asset is
stale, which is the CI staleness gate. The build is deterministic: same
sources, same bytes.

`wasm-pack` is the one extra tool this needs (`cargo install wasm-pack
--locked`) plus the `wasm32-unknown-unknown` target, which
`rust-toolchain.toml` requests. `IMPECCABLE_BUNDLE_SKIP_WASM_PACK=1` reuses
whatever is already in `target/wasm-bundle/`, for iterating on the page JS
alone. `IMPECCABLE_EXTENSION_SKIP_BUNDLE=1` lets `bun run build:extension`
skip the bundle step when `extension/detector/` is already complete, for CI
matrices that pre-built it.

Run `cargo xtask bundle` after touching `crates/core`, `crates/foundation`,
`crates/wasm`, or `browser-bundle/`, and commit the refreshed assets.

### Reusing the bundler downstream

None of that lives in the task. `impeccable-bundle` (`crates/bundle`) embeds
`browser-bundle/*.js` with `include_str!` and owns the assembly, so a crate
that links `impeccable-core` + `impeccable-wasm` plus its own rule pack into
one wasm module builds the same artifacts for that module without copying a
file out of this repo:

```rust
let (glue, wasm) = impeccable_bundle::wasm_pack_build(
    Path::new("crates/my-wasm"),      // engine + pack, not crates/wasm
    Path::new("target/wasm-bundle"),
    &[],                              // extra cargo args, after `--`
)?;
let js = impeccable_bundle::in_page_bundle(&glue, &wasm);   // /detect.js
let registry = impeccable_bundle::registry_json();          // built-ins + pack rows
let ext = impeccable_bundle::extension_pieces(&glue, &wasm, &registry);
impeccable_bundle::check_capture_contract()?;               // snapshot/core drift
```

Nothing there writes files or exits: the caller places the bytes and reports
its own failures. The pack's registry rows appear in `registry_json` once the
pack is installed, since the registry reads built-ins plus every registered
slice. `IMPECCABLE_BUNDLE_SKIP_WASM_PACK=1` is the library's name for the
skip switch (the old `IMPECCABLE_XTASK_SKIP_WASM_PACK=1` still works).

## Rule packs

The built-in rules are compiled in and always run. A **rule pack** is how a
crate that depends on this workspace adds rules of its own without forking it:
one process-lifetime value carrying its own registry rows plus the hooks it
has rules for. With no pack installed nothing changes, which the oracle
enforces byte-for-byte.

The traits:

- `impeccable_core::rule_pack::RulePack` (object-safe, `Send + Sync + Debug`)
  with three hooks, each defaulting to empty: `check_text(content, file_path,
  ext)` for the text engine, `check_element_dom(dom, el)` and
  `check_page_dom(dom)` for the browser engines.
- `impeccable_html::StaticRulePack` with `check_document(doc, file_path)`.
  The `StaticDocument` model belongs to `crates/html`, and `detect` cannot
  name a type from a crate that depends on it, so the static engine's hook is
  a separate trait. A pack that covers HTML implements both.

Three steps for the downstream crate: declare `static ROWS: &[Antipattern]`
with namespaced ids (`mypack/my-rule`) and return them from `registry()`;
call `impeccable_core::rule_pack::install(&PACK)` once at startup, which is
what makes `get_antipattern` resolve the pack's ids and therefore what gives
its findings a name, description, category, and severity; then pass the pack
to the engine being run.

Where a pack reference travels:

| Engine | Field |
|---|---|
| text | `TextOptions.rule_pack`, `ScanOptions.rule_pack` |
| static HTML | `DetectHtmlOptions.static_rule_pack` and `.rule_pack`; `StaticHtmlEngine.static_rule_pack` for the `Engines` seam |
| browser / snapshot | `BrowserConfig.rule_pack` (`#[serde(skip)]`: a pack is a Rust value, never JSON from the page) |

Where each hook runs, and why there:

- **Text engine** (`detect_text`): after every built-in matcher, style-block
  and CSS-in-JS pass, the design-system scan, the dedupe, and the page
  analyzers, and before inline ignores. Appending last keeps built-in output
  identical, and being inside the waiver step means `impeccable-disable`
  covers a pack's rules the same way it covers built-in ones.
- **Static HTML engine** (`detect_html_source`): after the element rules, the
  design-system merge, the page-level checks and the pattern checks, again
  just before inline ignores. An HTML file gets exactly one pack pass:
  `static_rule_pack` when it is set, otherwise `rule_pack.check_text` over
  the raw HTML source, which is how a text-only pack still covers `.html`
  files. A pack that implements both never reports the same file twice.
- **Browser driver** (`collect_browser_findings`): `check_element_dom` runs
  at the end of the driver's per-element loop, through the same
  disabled-rules filter and grouped onto the same element as the built-in
  findings; `check_page_dom` runs after every built-in page pass, attributed
  like the built-in checks that name their own element (`el: None` means
  `document.body`). `skipScan` skips the pack too.

The registry keeps `ANTIPATTERNS` as the built-in list and consults the
registered rows after it (`registry::extend`, `registry::all_antipatterns`).
`extend` is idempotent per slice and panics on an id collision, so a pack can
never shadow a built-in rule. Registration is append-only and has no undo:
a pack is a property of the process, not of a run.

### The wasm `detect` feature

`crates/wasm` builds with `--features detect` for hosts that cannot exec the
binary (Cloudflare Workers and other wasm sandboxes). It adds two exports
over the file-scanning engines, JSON in and JSON out:

- `detect_text_json(content, file_path, options_json)`
- `detect_html_source_json(html, file_path, options_json)`

Both take `{ inlineIgnores?: boolean, designSystem?: { frontmatter?, sidecar? } }`
and return the findings array `impeccable detect --json` prints, same keys and
same order. `designSystem` carries the DESIGN.md inputs rather than a
normalized object, because the JS API's normalized form used `Set`s and
`Map`s that JSON cannot hold. Unparseable options fall back to the defaults.
`antipatterns_json()` lists the built-ins followed by any pack's rows, and
`immediate_tier_rules_json()` returns the design hook's immediate tier (the
rule ids worth fixing at the edit site). That list lives in
`impeccable_core::registry::IMMEDIATE_TIER_RULES`, which `impeccable-hook`
re-exports, so a wasm consumer reads the same one the hook runs on instead of
keeping a copy.

A pack reaches those exports through `impeccable_wasm::set_rule_pack` and
`exports_detect::set_static_rule_pack`, both Rust-only: the consumer is a
crate that links `impeccable-wasm` as an rlib, registers its pack, and runs
`wasm-pack` over itself. There is deliberately no JS-facing setter.

```bash
cargo build -p impeccable-wasm --features detect --target wasm32-unknown-unknown --release
```

Pristine (the PR design-review bot) is the first consumer: its `rules/` crate
carries `pristine/*` rules on all three hooks and reaches the engine through
this feature, replacing the `detectText` call it makes into the npm
`impeccable@3` package today.

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
