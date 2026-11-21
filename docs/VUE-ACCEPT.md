# Vue component acceptance verification

The authoritative behavior, supported scope, feature flag, fallback diagnostics,
and acceptance contract are in [CLI-CONTRACT.md](CLI-CONTRACT.md#opt-in-vue-component-preview-and-acceptance).

Run `cargo test -p impeccable-live --test vue_accept` with
`IMPECCABLE_TEST_VUE_MODULES` pointing to a directory containing `@vue/compiler-sfc`.
CI installs exactly `@vue/compiler-sfc@3.5.44` with `--ignore-scripts` on Linux
and Windows. When the variable is unset, compiler-dependent tests report a skip;
argument-validation and missing-compiler fallback tests still run. A configured
but missing or broken compiler fails the integration tests rather than skipping.
Run `bun run test:live-vue-accept` with a locally built `IMPECCABLE_BIN`, Playwright
Chromium, `IMPECCABLE_TEST_VUE_MODULES` containing Vue 3.5.44, and the opt-in flag.
`IMPECCABLE_TEST_CHROME` can point to an existing
Chrome executable. The browser test uses a deterministic test agent and real Vue,
Vite, the Live server, Tune controls, acceptance, reload, and a production build.
It does not replace the separately required, API-backed Svelte adapter sweep.
