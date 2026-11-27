# browser-bundle: the page-side JavaScript of the detector

Plain JavaScript that runs inside a page or the extension: the DOM probe the
wasm rule core calls back into, the page snapshot producer, the
visual-contrast sampling IO, the overlay UI, the scan API and the extension's
offscreen document. Measurement and presentation only; every rule decision
is a call into the wasm rule core built from `crates/core` (`docs/ENGINE.md`).

Two consumers:

- `crates/browser` embeds `05-natives.js`, `12-query.js` and `15-snapshot.js` (the snapshot
  producer the URL engine injects; no WebAssembly runs in the page). It also
  runs `05-natives.js` on every new document before the page's own scripts,
  which stashes the built-ins where a site's own global `Map` or a reassigned
  `Array.from` cannot reach them.
- `crates/bundle` (the `impeccable-bundle` library) embeds every file here
  with `include_str!` and concatenates them, in filename order, with the wasm
  core into the in-page bundle plus the extension's `extension/detector/`
  pieces. `cargo xtask bundle` is its caller inside this workspace: it writes
  `dist/detect-antipatterns-browser.js`, copies that bundle to the tracked
  `crates/live/assets/detect-antipatterns-browser.js` the engine embeds, and
  writes the extension pieces. A downstream crate with its own rule pack
  calls the library directly (`docs/ENGINE.md`).

Because the files are embedded, a new one here has to be added to
`PAGE_JS` in `crates/bundle/src/lib.rs` (and to the order it is concatenated
in); a test fails when the two lists disagree.

`15-snapshot.js` lists the computed-style properties the rules read; the
bundle build checks that list against the core's and fails when they drift.

Page JS runs in the page's world, so it names built-ins (`Map`, `Set`,
`Array.from`, `JSON`, `Math`, `getComputedStyle`, ...) only through the
bindings `05-natives.js` declares. A new built-in a file starts using goes
into that file's list too.
