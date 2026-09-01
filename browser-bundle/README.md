# browser-bundle: the page-side JavaScript of the detector

Plain JavaScript that runs inside a page or the extension: the DOM probe the
wasm rule core calls back into, the page snapshot producer, the
visual-contrast sampling IO, the overlay UI, the scan API and the extension's
offscreen document. Measurement and presentation only; every rule decision
is a call into the closed core (`docs/ENGINE.md`).

Two consumers:

- `crates/browser` embeds `15-snapshot.js` (the snapshot producer the URL
  engine injects; no WebAssembly runs in the page).
- The private detector repo's `cargo xtask bundle` concatenates these files,
  in filename order, with the wasm core into `detect-antipatterns-browser.js`
  and the extension's `detector/` pieces, then publishes them in
  `detector-browser-bundle.zip` with each detector release. It reads this
  directory from a checkout of this repo (`IMPECCABLE_PUBLIC_REPO`, else a
  sibling `impeccable` / `impeccable-second` checkout).

`15-snapshot.js` lists the computed-style properties the rules read; the
bundle build checks that list against the core's and fails when they drift.
