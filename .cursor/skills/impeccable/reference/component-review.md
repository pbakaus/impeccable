# Component review

Use this checkpoint on comp-led builds after producing the initial component kit and before composing the page. The approved comp is the reference. The user reviews the actual produced components, including code; a list of planned assets or screenshots supplied by the builder is not a review of what will ship.

## Prepare the component kit

Keep the measured spec's region IDs. Include every visible region: produced raster assets and working HTML/CSS/SVG for text, controls, patterns, decoration and layout elements. A region rendered in code needs an actual review document, not a promise to implement it later. Use semantic HTML for content and controls. Do not flatten the page or combine unrelated regions to avoid review. Report omitted regions so the user can mark what is missing.

Write `.impeccable/review/components.json` with this manifest format:

```json
{
  "schemaVersion": 1,
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
      "dependencies": [".impeccable/build/spec.json"]
    },
    {
      "id": "headline",
      "name": "Headline",
      "medium": "html",
      "box": {"x": 0.05, "y": 0.2, "w": 0.4, "h": 0.25},
      "note": "Rendered semantic heading and its typography.",
      "preview": {"kind": "page", "path": ".impeccable/review/components/headline.html"},
      "dependencies": [".impeccable/build/spec.json", "assets/type.woff2"]
    }
  ]
}
```

The coordinates above only illustrate the schema. Use the approved comp's actual pixel dimensions and each measured region's normalized bounds (`x / width`, `y / height`, `w / width`, `h / height`). A code preview is rendered at the comp viewport and cropped to that component's box, so place its content at those coordinates in the review document. Include every file the document uses in `dependencies`, including linked CSS, fonts and images. The runtime also binds the measured spec for the component stage and checks its inventory. Local paths only. Static PNG, WebP and JPEG previews retain their original bytes and actual transparency; never draw a checkerboard into the asset.

Native capture supports stable HTML/CSS and inline SVG. Supply a static review state for motion and keep the implementation's real inputs. A scripted, canvas or otherwise unsupported component is a blocker to report, not permission to substitute a raster or omit it.

## Present and wait

If the harness exposes `component_review`, call it with `manifest_path` set to `.impeccable/review/components.json`. The host captures the component files, presents this same review interface and returns the user's decisions. A suspended request is waiting for the user; it is not a failed build or an approval.

Otherwise run `.cursor/skills/impeccable/scripts/impeccable component-review capture --manifest .impeccable/review/components.json`, then start `.cursor/skills/impeccable/scripts/impeccable component-review serve --session <returned session>` in the background. Open the URL it prints in the available browser and wait for the user. Read the result with `.cursor/skills/impeccable/scripts/impeccable component-review verify --manifest .impeccable/review/components.json`; pending, needs-work and stale input all refuse approval. Never submit the page or write a receipt on the user's behalf.

The user can approve components, request changes, and mark missing regions. Act on their feedback without replacing it with your own favorable verdict. Keep component IDs stable, update the actual implementation and dependency list, and present another round. The UI carries only approvals whose component inputs have not changed. Do not ask the user to reapprove unchanged work. Continue only when the inventory is confirmed and all components are approved.

## Assemble and review

Build the page from the approved component files. Replacing, simplifying or changing an approved component requires a new component review. Run the existing plates and hero gates; human review does not waive their integrity checks.

After the full page and responsive checks are complete, present a second manifest at `.impeccable/review/hero.json`, with `id` and `stage` set to `hero`. Use one page-preview component covering the assembled first viewport, its real HTML entry, and its complete dependency list. The reference stays the approved comp. Call the same host review tool (or native capture/serve/verify workflow) and obtain the user's approval before the final response. Later edits to the reviewed files require a fresh review. A component-kit approval does not approve their assembled layout.
