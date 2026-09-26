# Plan and asset review (component review v3)

Comp-led builds fail most expensively when the agent decides a painted region (an illustrated figure, a metal texture, a photograph) can be drawn in code, then draws a stick figure or CSS stripes. That decision is made in the region map (`comp-spec`), long before any code exists. The human checkpoint before code therefore reviews two things: the generated raster assets, and the production plan for everything else. It no longer asks for HTML/CSS previews of text, controls and chrome; those are judged in the assembled first-viewport review, where they can be judged in context.

## Where it sits

`comps → spec → plates → [plan and asset review] → hero → [first-viewport review] → sections → motion → responsive → review`

The review opens once every raster region has its plate. Nothing in the page is written before it. `build-phase advance` from plates (and `record hero`) refuses until the review for the current build journey is accepted and its reviewed spec digest equals the current `.impeccable/build/spec.json`. A later spec change (for example a reclassified region) needs a new round; unchanged decisions carry over.

## Packet: schemaVersion 3, stage `components`

The stage keeps its name so hosts and `lifecycle --require components hero` keep working. The model does not author this packet. `impeccable component-review plan` writes `.impeccable/review/components.json` from the spec, the comp and the plate files, and refuses (listing every missing plate) while any raster region lacks its plate.

```json
{
  "schemaVersion": 3,
  "stage": "components",
  "id": "<from spec/build journey>",
  "title": "<surface title>",
  "comp": {"path": "<approved comp>", "width": 1440, "height": 900},
  "specSha256": "<sha256 of .impeccable/build/spec.json>",
  "components": [
    {
      "id": "hero-figure", "name": "Hero figure", "kind": "plate", "role": "asset",
      "box": {"x": 0.52, "y": 0.1, "w": 0.4, "h": 0.6},
      "note": "Illustrated fisherman mending a net",
      "medium": "raster",
      "preview": {"kind": "image", "path": "assets/hero-figure.png"},
      "dependencies": []
    },
    {
      "id": "brushed-panel", "name": "Brushed panel", "kind": "chrome", "role": "plan",
      "box": {"x": 0, "y": 0.7, "w": 1, "h": 0.1},
      "note": "Brushed steel band under the nav",
      "medium": "code",
      "preview": {"kind": "comp-crop"},
      "flags": [{"id": "painted-pixels", "message": "The comp shows photographic shading here (41 colours, soft gradients)."}],
      "codeDrawn": false,
      "dependencies": []
    }
  ],
  "codeRegions": [
    {"id": "headline", "name": "Headline", "kind": "text", "box": {"x": 0.06, "y": 0.2, "w": 0.4, "h": 0.2}, "note": "A little closer to the sea."}
  ]
}
```

- `role: "asset"`: every raster region (`plate`, `image`, `texture`). Preview is its plate file, pinned by hash as today.
- `role: "plan"`: a code region (`text`, `control`, `chrome`) that needs a human decision: it carries a `flags` entry, or `codeDrawn: true`, or it is non-container `chrome`. Preview is `comp-crop` (no file; the UI crops the pinned comp by `box`).
- `codeRegions`: every other code region. Listed for completeness and clickable on the map, but no decision is required. Containers (`container: true`) and bands are listed here.
- Order of `components`: flagged or `codeDrawn` plan items first, then assets, then remaining plan items.
- `reviewGroup` is not used in v3. `revision` per component is computed as today (component JSON plus pinned file hashes plus `specSha256`).

## Decisions

Per component: `{revision, action, feedback, split: false}` plus, for `reclassify`, `kind`:

- `approve`: asset looks right / code is the right medium.
- `revise` (assets only): regenerate with `feedback`.
- `reclassify` (plan items, and any `codeRegions` id): `kind` is `plate`, `image` or `texture`; `feedback` optional. Allowed for ids in `codeRegions` without a component entry; those go in `submission.reclassify: [{id, kind, feedback}]`.

`missing` and `inventoryConfirmed` stay. The UI sets `inventoryConfirmed: true` when the user approves with nothing marked missing (the approve button says so). A submission with any `revise`, `reclassify` or `missing` entry is `changes-requested`. Approval requires every component approved and no reclassification.

## Capture

v3 needs no browser. `component-review capture` records the raster-source proof for each asset (as today) and a `comp-crop` proof (comp hash plus box) for each plan item. `verify` and `lifecycle` apply `capture_intact` to v3: blobs match hashes, sources match, every packet component has proof, raster previews match their raster-source proof, and `specSha256` matches the pinned spec.

## After feedback

The agent applies the receipt: for `reclassify`, change the region's kind (and note) in the regions file, rerun `comp-spec --regions`, produce the new plates; for `revise`, regenerate the plate with the feedback. Then `component-review plan`, `capture`, `serve` again. Unchanged decisions carry.

## Hero

The first-viewport review is unchanged in form. Two rule changes:

- After three failed hero attempts, the gate's message says to present the first-viewport review instead of continuing to iterate.
- An accepted first-viewport review for the current capture turns contradicted readings on code regions (`text`, `control`, `chrome`) into advisories, as the responsive gate already does for text. Material vetoes stay hard: a missing or unreferenced plate, an SVG illustration, a clipped plate.

## Painted-pixel flag (`comp-spec`)

For every `text`, `control` and `chrome` region, `comp-spec` measures the comp crop and adds `flags: [{"id":"painted-pixels","message":...}]` when it looks painted: many distinct colours outside the two dominant clusters and a high share of soft-gradient pixels. It is a flag, not a refusal. Thresholds are calibrated on eval comps: raster regions should flag, text and controls should not. `comp-spec` prints flagged regions in its summary.

## Engine notes

Details the engine settles that the sections above leave open (full wording in `docs/CLI-CONTRACT.md`, "Component review"):

- Packet identity: `id` is `components` for every round, so rounds share one session and decisions carry; `title` is `Plan and asset review`, plus ` · <artifact>` when the build state names one. `name` is derived from the region id.
- v3 capture evidence has its own schema, `plan-review-proof-v1`, so a browser capture can never stand in for it or the reverse. Plan items carry no `context` or `thumbnail`; assets get `thumbnail` equal to their preview.
- Decisions keep today's required `feedback` string (empty allowed) for every action; `feedback` is optional only in `submission.reclassify` entries.
- A spec with no raster region and no plan item has nothing to review: `plan` refuses to write an empty packet, and the build-phase gate does not wait.
- Hosted sessions (`IMPECCABLE_COMPONENT_REVIEW_TOOL` set) keep their review in the host's store, so the build-phase gate follows the host's policy (`IMPECCABLE_COMPONENT_REVIEW_PENDING=1` refuses) instead of the local store.
- The plates `--force` rule is unchanged and not widened: a reason that passes it (a quoted user downgrade of the comp) waives the review reason along with the plate readings, and is recorded. `record hero` has no force.
