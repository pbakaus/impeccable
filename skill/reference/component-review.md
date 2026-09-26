# Plan and asset review

Use this checkpoint on comp-led builds once every raster region has its plate and before any page code exists. The approved comp is the reference. The user reviews two things: the plates that will ship, and the production plan for everything else, meaning which regions code draws. A painted region planned as code is the most expensive mistake a comp-led build makes, and this is where the user catches it. Text, controls and chrome are judged later, in the assembled first viewport.

## Plan, capture, serve

Run `{{scripts_path}}/impeccable component-review plan`. It writes `.impeccable/review/components.json` from the measured spec, the comp and the plate files, and refuses, naming each one, while any raster region lacks its plate. Never write or edit that file for this stage: the packet is derived from the spec, so every change belongs in the regions file.

If the harness exposes `component_review`, call it with `manifest_path` set to `.impeccable/review/components.json`. The host captures, presents the review and returns the user's decisions. A suspended request is waiting for the user; it is not a failed build or an approval.

Otherwise run `{{scripts_path}}/impeccable component-review capture --manifest .impeccable/review/components.json`, then start `{{scripts_path}}/impeccable component-review serve --session <returned session>` in the background. Open the URL it prints in the available browser and wait for the user; `serve` exits 0 once they submit. Read the decisions with `{{scripts_path}}/impeccable component-review status --session <id>`; `{{scripts_path}}/impeccable component-review verify --manifest .impeccable/review/components.json` confirms approval and refuses pending, needs-work and stale input. Never submit the page or write a receipt on the user's behalf.

`serve` exits 2 when this session has no browser (the same signal as the decision page) and 4 when it closes after 30 idle minutes without a decision. Either way no one is reviewing: stop waiting, do not approve anything yourself, and do not build past this checkpoint. End the run and report the plan and asset review as pending with its session ID, so the user can resume it. A waiting review is pending work, not a completed build.

## Act on the receipt

Apply the user's decisions as given, never your own favorable verdict in their place.

- **approve**: once every item is approved and the inventory is confirmed, advance to the hero.
- **revise** (a plate): regenerate that plate at the same path with the user's feedback.
- **revise with split** (an asset): replace that region in the regions file with its layers: a frame plate with a transparent opening (kind `plate`, same box), the content as its own `image` region at the opening's box, and each moving part (a shutter, a door) as its own plate. Name each layer after the original region, as `<id>-frame`, `<id>-view` or `<id>-shutter-left`, so the next round shows it as part of the user's request. Rerun `comp-spec --regions` and produce the plates.
- **revise** (a plan item): change the regions file as the feedback says (resize or extend a raster region, split material into its own plate region, or adjust the code region), rerun `comp-spec --regions`, and produce any new plates.
- **reclassify** (a code region): in the regions file, change that region's `kind` to the one the user chose and rewrite its `note` to describe the material. Rerun `comp-spec --regions`, then produce the new plates, with the asset producer when subagents are available.
- **missing**: add the region to the regions file, rerun `comp-spec --regions`, and produce its plate if it is raster.

Then run `plan`, `capture` and `serve` again. Unchanged decisions carry over, so the user sees only what changed. Any spec change needs a new round; the build-phase gate stays closed until the review of the current spec is accepted.

## Assemble and review

Build the first viewport from the approved plates and plan, and run the hero gate. Human review does not waive its integrity checks. After three failed hero attempts, stop iterating and present the first-viewport review with the current build; the user's eye settles what the readings could not.

Present a second manifest at `.impeccable/review/hero.json`, with `id` and `stage` set to `hero`. Use one page-preview component covering the assembled first viewport, its real HTML entry, and its complete dependency list (local paths only). The reference stays the approved comp. Call the same host review tool, or run `capture`, `serve` and `verify` with this manifest. Needs-work feedback starts another assembly round.

Acceptance closes human review for this build: never request plan, asset or assembly approval again. Remaining contradicted readings on code regions (`text`, `control`, `chrome`) become advisories; material vetoes still hold (a missing or unreferenced plate, an SVG illustration, a clipped plate). Complete the rest of the page, responsive behavior, finish checks and documentation with the accepted first viewport as the visual direction. This is first-viewport calibration, not a claim that the user reviewed the rest of the page. Shared stylesheet edits do not reopen approval. Preserve the accepted direction; a later explicit user change is a new task.

Assembled-page capture executes inline and declared local scripts from the pinned inputs. Network APIs, frames and workers are unavailable; the initial viewport must settle before capture. Keep the real page and declare its scripts rather than removing behavior to pass review.
