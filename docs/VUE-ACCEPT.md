# Vue component acceptance

Vue component previews remain opt-in during verification for #386. Set
`IMPECCABLE_LIVE_VUE_COMPONENT=1` when starting the engine and Live server.
Without the flag, the existing Vue source-preview path stays unchanged.

The app must provide Vue 3 and `@vue/compiler-sfc`. The engine uses that
compiler to parse SFC blocks and validate both the selected variant and the
accepted component before an atomic source write. Original scripts and global
style blocks stay byte-for-byte unchanged. Accept replaces the selected template
range and reconciles the chosen CSS into the component's scoped block, or adds a
scoped block if the component previously had only global styles.

Variants keep the generated script and all original directives, expressions,
component tags and template refs. CSS must be inline and scoped. Numeric Tune
values are unitless; use `calc(var(--p-space, 8) * 1px)` for a pixel dimension.
`params.json` beside the variants supplies their knob declarations.

The initial path rejects external SFC blocks, custom blocks, CSS modules,
preprocessors such as Sass/SCSS/Less, multiple scoped blocks, global/deep/slotted
variant selectors, and global at-rules. It reports a failure before writing
source. Consolidate scoped blocks and use plain scoped CSS before retrying.
Insert-mode component previews are not enabled by this path.

Run `cargo test -p impeccable-live --test vue_accept` with
`IMPECCABLE_TEST_VUE_MODULES` pointing to a directory containing `@vue/compiler-sfc`.
Run `bun run test:live-vue-accept` with a locally built `IMPECCABLE_BIN`, Playwright
Chromium, and the opt-in flag. `IMPECCABLE_TEST_CHROME` can point to an existing
Chrome executable. The browser test uses a deterministic test agent and real Vue,
Vite, the Live server, Tune controls, acceptance, reload, and a production build.
It does not replace the separately required, API-backed Svelte adapter sweep.
