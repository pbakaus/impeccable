# browser-bundle: the page-side JavaScript of the detector

Plain JavaScript that runs inside a page or the extension: the DOM probe the
wasm rule core calls back into, the page snapshot producer, the
visual-contrast sampling IO, the overlay UI, the scan API and the extension's
offscreen document. Measurement and presentation only; every rule decision
is a call into the wasm rule core built from `crates/core` (`docs/ENGINE.md`).

Two consumers:

- `crates/browser` embeds `15-snapshot.js` (the snapshot producer the URL
  engine injects; no WebAssembly runs in the page).
- `cargo xtask bundle` concatenates these files, in filename order, with the
  wasm core into `dist/detect-antipatterns-browser.js`, copies that bundle to
  the tracked `crates/live/assets/detect-antipatterns-browser.js` the engine
  embeds, and writes the extension's `extension/detector/` pieces.

`15-snapshot.js` lists the computed-style properties the rules read; the
bundle build checks that list against the core's and fails when they drift.
