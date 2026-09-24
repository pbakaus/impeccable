# Component review

Use this checkpoint on comp-led builds after producing the initial component kit and before composing the page. The approved comp is the reference. The user reviews the actual produced components, including code; a list of planned assets or screenshots supplied by the builder is not a review of what will ship.

## Prepare the component kit

Keep the measured spec's region IDs. Include every visible region: produced raster assets and working HTML/CSS/SVG for text, controls, patterns, decoration and layout elements. A region rendered in code needs an actual review document, not a promise to implement it later. Use semantic HTML for content and controls. Do not flatten the page or combine unrelated regions to avoid review. Report omitted regions so the user can mark what is missing.

For a repeated code pattern, give instances of the same component and role the same `reviewGroup` name. Group peers of the same kind, not a container with its contents or unrelated text roles. Keep every instance and its region ID in the manifest, in the same kit document. The review opens with one item per group and shows its instances together. One explicit group decision applies to its unreviewed instances; the user can open an instance to leave an exception. Existing decisions are preserved. Unique raster assets still require their own review; grouping never removes inventory or gate checks.

Before producing assets, inspect each reference crop against its named subject. Coarse grid cells and automatic ink snapping can include neighbors or omit parts of a compound element. Correct the measured region with an explicit normalized `box`; do not build to a known bad crop. Check the code preview contains the complete component before presenting it. The capture tool refuses content cut off by the review crop.

Write `.impeccable/review/components.json` with this manifest format:

```json
{
  "schemaVersion": 2,
  "id": "components",
  "title": "Component review",
  "stage": "components",
  "comp": {"path": ".impeccable/mocks/comp-2.png", "width": 1536, "height": 1024},
  "components": [
    {
      "id": "illustration",
      "name": "Illustration",
      "medium": "raster",
      "box": {"x": 0.5, "y": 0.2, "w": 0.45, "h": 0.7},
      "note": "Produced cutout; positioned over the page ground.",
      "preview": {"kind": "image", "path": "assets/illustration.png"},
      "dependencies": []
    },
    {
      "id": "headline",
      "name": "Headline",
      "medium": "html",
      "box": {"x": 0.05, "y": 0.2, "w": 0.4, "h": 0.25},
      "note": "Rendered semantic heading and its typography.",
      "preview": {"kind": "page", "path": ".impeccable/review/components/kit.html", "selector": "#headline"},
      "dependencies": ["assets/type.woff2"]
    }
  ]
}
```

The coordinates above only illustrate the schema. Use the approved comp's actual pixel dimensions and each measured region's normalized bounds (the spec’s `box` is already normalized; divide only pixel coordinates by comp dimensions). Each code preview requires a `selector` matching exactly one component element inside the document body. Shared kit documents are supported: the native capturer preserves layout and authored styles, hides other components, and crops to the measured box. A separately targeted child is excluded from its parent's isolated preview. Background fields therefore show their own paint, not the text and controls laid over them. Place components at the comp coordinates in the review document.

For a raster placed inside the kit, add `context: {"kind":"page","path":".impeccable/review/components/kit.html","selector":"#illustration"}` and declare that document's dependencies. This identifies its DOM placement so a containing code component excludes it too; the raster preview remains the original image bytes.

The runtime also captures an unmodified **In context** view from that same document. This assembled view is reference only, not another component to approve. Keep each review target independently meaningful; use context to show a group together rather than submitting the same content for approval as both a combined component and its children. The final assembled hero still has its own review checkpoint. Include every file the document uses in `dependencies`, including linked CSS, fonts and images. The runtime also binds the measured spec for the component stage and checks its inventory. Local paths only. Static PNG, WebP and JPEG previews retain their original bytes and actual transparency; never draw a checkerboard into the asset.

Component capture supports stable HTML/CSS and inline SVG. Supply a static review state for motion and keep the implementation's real inputs. A scripted, canvas or otherwise unsupported component is a blocker to report, not permission to substitute a raster or omit it.

Keep the implementation's intended fonts in the review document. Vendor external fonts locally and declare them as dependencies; removing their imports changes the component being reviewed. Capture rejects unavailable primary font families rather than presenting a silent fallback.

## Present and wait

If the harness exposes `component_review`, call it with `manifest_path` set to `.impeccable/review/components.json`. The host captures the component files, presents this same review interface and returns the user's decisions. A suspended request is waiting for the user; it is not a failed build or an approval.

Otherwise run `.vibe/skills/impeccable/scripts/impeccable component-review capture --manifest .impeccable/review/components.json`, then start `.vibe/skills/impeccable/scripts/impeccable component-review serve --session <returned session>` in the background. Open the URL it prints in the available browser and wait for the user. Read the result with `.vibe/skills/impeccable/scripts/impeccable component-review verify --manifest .impeccable/review/components.json`; pending, needs-work and stale input all refuse approval. Never submit the page or write a receipt on the user's behalf.

The user can approve components, request changes, and mark missing regions. Act on their feedback without replacing it with your own favorable verdict. Keep component IDs stable, update the actual implementation and dependency list, and present another round. The UI carries only approvals whose component inputs have not changed. Selector ownership is an input too; changing a target invalidates affected captures. Do not ask the user to reapprove unchanged work. Continue only when the inventory is confirmed and all components are approved.

## Assemble and review

Build the first viewport from the approved component files and run the existing plates and hero gates. Resolve component changes before presenting the assembled first viewport; human review does not waive integrity checks.

Once the first viewport is ready for calibration, present a second manifest at `.impeccable/review/hero.json`, with `id` and `stage` set to `hero`. Use one page-preview component covering the assembled first viewport, its real HTML entry, and its complete dependency list. The reference stays the approved comp. Call the same host review tool (or native capture/serve/verify workflow). Needs-work feedback starts another assembly round. Acceptance closes both review stages for this build: never request component or assembly approval again. Complete the rest of the page, responsive behavior, finish checks and documentation using the accepted first viewport as the visual direction. This is first-viewport calibration, not a claim that the user reviewed the rest of the page. Shared stylesheet edits do not reopen approval. Preserve the accepted direction; a later explicit user change is a new task.

Assembled-page capture executes inline and declared local scripts from the pinned inputs. Network APIs, frames and workers are unavailable; the initial viewport must settle before capture. Keep the real page and declare its scripts rather than removing behavior to pass review.
