# Live browser assets

`detect-antipatterns-browser.js` is the in-page detector bundle: the rule
core (`crates/core`) compiled to WebAssembly by `crates/wasm`, concatenated
with the page JS in `browser-bundle/` and the module embedded as base64.

It is **generated, and tracked**: `crates/live/src/browser_assets.rs` embeds
it with `include_str!` and the live server hands it to the browser as
`/detect.js`, so the binary has to carry it. Do not hand-edit. Rebuild with:

```bash
cargo xtask bundle          # rewrites this file (and extension/detector/)
cargo xtask bundle --check  # fails when this file is stale
```

The other browser scripts the live server serves (`live-browser*.js`,
`modern-screenshot.umd.js`) are not copied here: they are embedded straight
from `skill/scripts/`, the one copy the build also ships to every provider.
