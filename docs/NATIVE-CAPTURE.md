# Native static-entry capture and sandbox transport

Responsive comparison blocks contradicted control regions as well as contradicted text. A passing whole-page score cannot excuse a contradicted declared control. This check still depends on the spec declaring that control separately; it does not establish that the region map is complete or sufficiently granular.

The opt-in native HTML gate freezes the current entry, allowed static dependencies, spec and approved reference. The spec and reference are hashed and re-verified but never served to the page, so a page cannot show the comp it is graded against: a request for it, a loaded byte copy of it or of the approved review screenshot, or a data URI of either refuses the capture, and images painting 15% or more of a frame outside the declared raster regions refuse it too. It captures raster observations in an isolated browser world and verifies the original inputs before accepting them. Saved screenshots and JSON are audit output, not substitutes for capture. The existing build-phase checks retain their copy, geometry, text, presence and fidelity policies.

Some host sandboxes cannot start Chromium's nested sandbox. `capture-server <registered-project> <ready-file>` provides the same `CdpEntryRenderer` outside that filesystem sandbox while keeping Chromium's own sandbox enabled. The host chooses the project and exact engine binary before the builder starts. Requests cannot select a different root, URL, shell command, executable or arbitrary skill verb. Normal build-phase execution remains in-process when no transport is configured.

The service binds loopback and requires the host-generated `IMPECCABLE_CAPTURE_CAPABILITY`; the client reads it together with `IMPECCABLE_CAPTURE_PORT`. It exposes capture, current-input verification, release and saved-evidence audit. Requests, responses, active captures and lifetime are bounded. Captures retain their immutable snapshot; the most recent hero and responsive snapshots survive release for the final host audit. A host adapter must own service startup and process-group cleanup.

A capability authenticates callers, not arbitrary responses from a builder-selected endpoint. An adapter using this transport must retain its own service process and port, check that process before and after audit requests, and audit through that private reference. The audit compares saved frame PNGs, observation JSON and input reports against host-held capture objects, then rechecks current source bytes. The final responsive snapshot is the current-input boundary; hero legitimately predates later sections. The adapter must verify exported HTML, assets and native evidence against the returned manifest and hashes. A missing or failed host audit invalidates transport provenance. Do not use a client response or a workspace-authored audit file alone as qualification evidence.

A first viewport with no raster region is captured as an assembled-page viewport and its frames carry no region receipts. The client accepts an empty receipt list only when the spec it froze declares no raster region and the report says `captureMethod: assembled-page-viewport`, with a coverage proof per frame, a known dependency policy and a served list that excludes the spec and comp. The spec decides the kind, so a raster capture without receipts, or a text-only claim for a raster spec, still fails closed. Raster captures carry the same served list and per-frame coverage proofs, measured outside the declared raster regions, and the client checks them the same way. A raster frame must carry one receipt per measured raster region, at most 32, the batch bound the in-process capture already enforces. The audit endpoint checks text-only frames like raster ones, with `[]` as their saved observations.

The eval adapter records `nativeCaptureTransport: host-service-v1` as a separate comparison axis. It retains a host audit outside the builder-writable workspace and fails the worker contract on a bad audit. This transport does not introduce a judge, creative instructions, extra repair advice, or a new pass threshold. Other optional browser features, including font-match's documented catalog fallback, retain their existing behavior.

Raster observations use software rasterization so temporary image suppression restores exact pixels despite GPU tile rounding. Capture-induced CSS transitions finish naturally within a bounded wait; authored styles and motion settings remain intact. DOM, geometry, document identity, response identity and exact pixel restoration still have to match.

Generated `::before` and `::after` image backgrounds are measured using native CDP pseudo-element boxes. A bounded inspector-owned stylesheet suppresses only the selected URL layers, retaining gradients, other layers and box styling, then clears the override. Computed suppression must actually take effect; an overriding author rule is an unavailable measurement. Each URL remains bound to its captured response bytes. Hidden or covered copies contribute only the pixels they actually paint, and duplicate layers are measured together as well as individually. Unresolved surfaces, content images, canvas and shadow content retain their explicit coverage failures.


Final shipping repeats the native responsive comparison against the current HTML,
spec, comp and assets. Review edits therefore cannot inherit an earlier screenshot
pass by recording a new finish hash. A failed final comparison reopens responsive
and records `fix`; the ordinary repair workflow remains available. Legacy capture
runs keep their recorded protocol.

Native capture disables partial raster reuse as well as GPU rasterization. The
full viewport still must restore byte-identical decoded pixels, DOM, geometry and
network identity. This avoids a reproduced Chromium antialiasing difference after
partial repaints without tolerances or changing the authored page. Receipts record
`partialRaster: false`. Unsupported neighboring SVG/canvas still fail coverage.

The plate gate also rejects non-texture PNGs carrying `impeccable:crop-of`.
Transforms and a newly embedded prompt do not erase that recorded origin.
Texture patches remain an explicit exception. Absence of the marker is not
proof of generation; evaluation still audits shipped assets against independent
image-generation records. Perceptual similarity remains a separate check.
Caller-supplied metadata, including historical fixture markers, cannot disable
the non-texture comp-copy check.

After a recorded finish, status uses the shared completion report to distinguish
the unchanged entry from later edits or a missing entry. It does not reopen phases
or sign new bytes. Changed entries are directed back to final review and finish;
dependency validation remains the responsibility of the native capture gate.
