# Shared component review — UI checkpoint

This framework-independent browser surface is owned by Impeccable. The eval dashboard imports it directly for the current visual checkpoint; the native `component-review` command serves the same bundle. The comp-led skill workflow presents it after the initial component kit and again after assembling the page. Existing build-phase integrity gates remain independent.

`ReviewPacket` contains a request/revision identity, the pinned comp dimensions, and the component inventory. Raster and sandboxed page-region previews share the same comparison canvas. `Draft` records individual decisions, optional split requests, missing regions and explicit inventory completeness. `onSubmit` belongs to the trusted host adapter. A UI draft is not an authenticated human approval.

The eval preview uses actual historical hotel artifacts and manually mapped titles. Its HTML views clip the existing page at the recorded comp-region bounds. These are interface test data, not proof that an initial component-production round occurred. No historical approvals are inferred, rewritten or reused. No model calls occur.

Implemented runtime foundation: manifest/path validation, pinned dependency bytes, version-bound local-browser feedback stored outside the builder project, and scoped approval invalidation. Native static component capture is implemented below. The eval harness owns authenticated reviewer routing, provider pause/resume and its attention queue; these are not responsibilities of this public UI. The trusted adapter must reject malformed, duplicate or stale submissions and verify the reviewer identity. No permissions decision is based on a browser-provided actor name.

The dashboard route `/dashboard/component-review/` is a temporary review checkpoint. Final embedding belongs in the waiting run's detail view. Keep the launch hold until the runtime and restart/resume checks pass.

## Native runtime

Use the Bun version in `.bun-version` (also used by CI). Build the shared UI with `bun run build:component-review`, then rebuild the engine. It embeds the JS and licensed fonts; the runtime needs no Node server or dashboard. The bundled asset is tracked alongside the native consumer, and the bundle test catches source drift.

From a project, run `impeccable component-review prepare --manifest review.json`. The manifest uses the UI packet shape plus `schemaVersion: 1`; replace each preview/comp/context/thumbnail `url` with a project-relative `path`, and declare each component's `dependencies` (CSS, images, fonts and other inputs used by its rendered preview). The service assigns revisions and round numbers. Paths outside the project are refused. Prepare prints a session ID. Start `impeccable component-review serve --session <id>` and open the returned loopback URL. `status --session <id>` reads the saved result. The default store is `~/.impeccable/component-reviews`; a test may use `--store <outside-project-directory>`.

Feedback commits atomically and identically retried submissions are idempotent. A second, different response to the same round is refused. Preparing changed inputs creates a new round, preserves unaffected approvals, resets inventory completeness, and carries missing-region feedback forward for human resolution. Prior packets remain addressable by revision; their URLs never silently switch to a new round's pixels. Closing/restarting the server preserves the packet and submitted feedback. Unsubmitted typing is not yet autosaved.

### Evidence boundary

Plain `prepare` pins the producer's declared inputs and leaves `captureVerified: false`. Native `capture` renders static code using only frozen declared inputs, verifies observed browser response bytes and stable pixels, and records the resulting captures outside the project. Only this in-process adapter can produce `captureVerified: true`. Both paths retain `reviewer: local-browser`; no browser-provided actor name grants human-eval qualification. The out-of-project store prevents a builder workspace JSON edit from changing authoritative feedback. Host/Origin/fetch-metadata checks reject cross-site browser requests, but do not authenticate a person against another process with the same OS permissions. Eval integration must own that trust boundary and preserve the distinction in provenance.

Generated HTML/SVG is served with a restrictive CSP and sandbox: no scripts, network requests, form submissions, or access to approval controls. Fonts can load from pinned files in an opaque-origin frame. Script-dependent components require a trusted captured preview; they are not yet supported as live executable component frames. Absolute-root asset URLs are not rewritten; the packet must use self-contained relative dependencies.

The runtime currently serves standalone with `frame-ancestors 'none'`. Transcript embedding must add an explicit trusted parent/broker rather than weakening this globally. It never opens Chrome automatically, starts an eval, changes existing campaign data, or bypasses fidelity/provenance gates.


## Repair rounds

The host supplies `ReviewHistory` separately from the producer's packet. The
native store derives it from saved packets and decisions: prior preview URLs,
component changes, outstanding feedback with its originating round, carried
approvals, and removed inventory entries. History is not inferred from filenames
or accepted from a producer-authored manifest field.

The round summary leads to changed/new components. Current/Previous switches
show each round's own comp and preview at its recorded geometry. Previous-round
inspection disables both individual and batch approval. Change details explain
whether files, region geometry or component definition invalidated an approval.
The inspector remains a fixed height and retains scroll position on view toggles.

Content identity and review identity are distinct. An unchanged prepare is a
no-op; reverting to earlier content creates a fresh review round whose identity
includes its predecessor. An old submission cannot approve that new round, and
its archived receipt is not overwritten. Preparing several versions before a
reply preserves outstanding feedback; a later explicit approval resolves it.

The native hotel checkpoint is an isolated integration-test copy. Its second
round changes only the boat description, explicitly labelled as such, to test
feedback and approval carryover without altering artwork or historical evals.


Feedback hierarchy: prior requests appear in a read-only **Previous feedback**
section with their originating round. The **Preview** control affects only the
comparison images. The separate **Your review** section names the current round;
choosing Needs work opens an empty **New feedback** field. Prior text is never
silently copied into that field. Definition-only changes explicitly state that
files are unchanged and expose the old/current descriptions.


## Attention-first navigation

Map markers and inventory cards use one revision-aware status function. Gold
numbered circles need review; subdued checked markers are approved; a separate
pencil state indicates feedback ready to send. Shape/icon, text and color carry
the distinction together. Stable component numbers do not change with sorting
or filtering. Missing marks also appear on the comp map.

The inventory defaults to Needs attention, excluding approved components and
sorting changed/new components first. Approved and All remain available. A
filter change selects a matching component when necessary. Next to review skips
already decided items; choosing Needs work retains that component in the
attention list while the reviewer writes feedback. Stale approval revisions
never hide a component. Bulk approval still preserves repair requests, and
inventory confirmation is independently required before approval submission.


## Native static component capture

Use `impeccable component-review capture --manifest review.json` instead of
`prepare` when the component packet needs native provenance. Both use the same
versioned store, service and decision contract. Static PNG, WebP and JPEG raster previews remain their
actual files (including alpha). Page previews become native PNG crops captured
at the comp's declared viewport and component box. Context views, when supplied,
are captured too; thumbnails reuse the primary output. Supply isolated component
HTML for the first asset round, not a screenshot pretending to be HTML.

`crates/browser/html_snapshot` and the CDP response/isolated-world primitives
are extracted from the existing native capture candidate. They freeze and serve
explicit input bytes; the new component adapter adds no aesthetic scoring or
comp-fidelity exception. It waits for images/fonts, verifies the document and
observed resource bodies against the frozen inputs, and checks that the pixels,
DOM and network stay stable across capture. The manifest itself is bound too.
A dependency or region change makes pending submission stale. Capture failure
never replaces an existing review round or substitutes supplied screenshots.

V1 supports static PNG, WebP and JPEG files and static HTML/CSS/inline SVG documents. Animated WebP is rejected. Component-stage capture binds the measured spec centrally and rejects missing measured regions or rasterized controls. Scripted, canvas,
framed and actively animated components are rejected instead of accepting their
fallback. CSS reduced-motion behavior is respected through the browser preference;
styles are not rewritten to make a capture pass. This is provenance for the
rendered state, not a claim that all future interactive states are covered.

The adapter records observed semantic-control, SVG and raster counts as evidence;
it does not decide that required semantics or visual fidelity pass. Human identity, run routing and exact provider continuation belong to the consuming harness. The hero stage uses the same manifest and native capture contract.

## Plan and asset review (packet schemaVersion 3)

A `components` packet with `schemaVersion: 3` (contract: `docs/PLAN-REVIEW.md`) renders `plan-review.ts` instead of the inventory view; `mountComponentReview` dispatches on the packet, so hosts need no change. The first-viewport (`hero`) stage keeps the view in `review.ts`.

The comp carries region outlines rather than pins: generated assets solid, planned-in-code dashed, flagged plan items (`flags` or `codeDrawn`) amber, and `codeRegions` visible on hover. Every region is clickable. An asset shows its comp crop beside the generated file at the largest same-scale size the panel allows (up to 4x comp pixels); a transparent file sits on the comp colour around its box, with light and dark as alternatives. A plan item shows the comp around it, never shrinking a band below comp scale, with the plan in one sentence and any flag above it. Decisions are one of two buttons: "Looks good" / "Needs work" for assets, "Code is fine" / "Make it an image" for plan items. A `codeRegions` entry needs no decision and offers only "Make it an image", which travels in `submission.reclassify`.

There is no bulk approval and no separate completeness checkbox. "Approve plan and assets" is enabled once every item is approved with nothing changed or missing, and sets `inventoryConfirmed: true`; any feedback, reclassification or missing mark turns it into "Send changes". Pure logic lives in `plan-model.ts` with tests beside it.

## Design-system kit (vendored)

Controls are the Impeccable site kit, not local imitations: `.ks-button`, `.ks-instrument-strip.is-paper` with its sliding `.ks-thumb`, `.ks-switch`, `.ks-checkbox`, `.ks-icon-button`, `.ks-tab-list`, and the docs rail's selected-row pattern. `vendor/` holds verbatim copies of impeccable-site's `kinpaku-tokens.css`, the needed `kinpaku-kit.css` sections, the rail rules from `docs-kinpaku.css`, and `instrument-strip.js`; the site is the source of truth. Refresh with `node scripts/sync-kinpaku-kit.mjs [path-to-impeccable-site]`. `instrument-strip.ts` ports the thumb script to shadow roots and re-rendering views; the region-map inspection page (`crates/comp-verbs/src/map_inspection.html`) inlines the same vendored CSS and script and ships the fonts beside the report.
