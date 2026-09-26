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
      "flags": [{"id": "painted-pixels", "message": "Looks painted: 41 colours beyond its two main tones and soft shading across 47% of it. Drawn in code, this becomes a flat copy."}],
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
- `role: "plan"`: a code region (`text`, `control`, `chrome`) that needs a human decision: it carries a `flags` entry, or `codeDrawn: true`, or it is non-container `chrome` whose `surface` is neither `flat` nor `rules`. Preview is `comp-crop` (no file; the UI crops the pinned comp by `box`).
- `codeRegions`: every other code region. Listed for completeness and clickable on the map, but no decision is required. Containers (`container: true`) and bands are listed here.
- Order of `components`: flagged items first (plan items with `flags` or `codeDrawn`, and assets with `flags`), in spec order, then the remaining assets, then the remaining plan items. An asset passes its `flags` through.
- `reviewGroup` is not used in v3. `revision` per component is computed as today (component JSON plus pinned file hashes plus `specSha256`).

## Decisions

Per component: `{revision, action, feedback, split: false}` plus, for `reclassify`, `kind`:

- `approve`: asset looks right / code is the right medium.
- `revise`: on an asset, regenerate with `feedback`. With `split: true` (assets only; feedback optional) the asset is a baked composite that should come back as layers: a frame plate with a transparent opening at the same box, the view as its own image region at the opening, and each moving part as its own plate. On a plan item, `feedback` is required and describes a region-map change neither medium fixes (for example, artwork from a neighbouring photo spills over a code region: extend that photo under it, or split the material into its own plate). The region's kind can stay.
- `reclassify` (plan items, and any `codeRegions` id): `kind` is `plate`, `image` or `texture`; `feedback` optional. Allowed for ids in `codeRegions` without a component entry; those go in `submission.reclassify: [{id, kind, feedback}]`.

`missing` and `inventoryConfirmed` stay. The UI sets `inventoryConfirmed: true` when the user approves with nothing marked missing (the approve button says so). A submission with any `revise`, `reclassify` or `missing` entry is `changes-requested`. Approval requires every component approved and no reclassification.

## Capture

v3 needs no browser. `component-review capture` records the raster-source proof for each asset (as today) and a `comp-crop` proof (comp hash plus box) for each plan item. `verify` and `lifecycle` apply `capture_intact` to v3: blobs match hashes, sources match, every packet component has proof, raster previews match their raster-source proof, and `specSha256` matches the pinned spec.

## After feedback

The agent applies the receipt: for `reclassify`, change the region's kind (and note) in the regions file, rerun `comp-spec --regions`, produce the new plates; for `revise` on an asset, regenerate the plate with the feedback; for `revise` on a plan item, change the regions file as the feedback says, rerun `comp-spec --regions` and produce any new plates. Then `component-review plan`, `capture`, `serve` again. Unchanged decisions carry.

## Hero

The first-viewport review is unchanged in form. Two rule changes:

- After three failed hero attempts, the gate's message says to present the first-viewport review instead of continuing to iterate.
- An accepted first-viewport review for the current capture turns contradicted readings on code regions (`text`, `control`, `chrome`) into advisories, as the responsive gate already does for text. Material vetoes stay hard: a missing or unreferenced plate, an SVG illustration, a clipped plate.

## Painted-pixel flag (`comp-spec`)

For every `text`, `control` and `chrome` region, containers included, `comp-spec` measures the comp crop with pixels inside raster regions left out, and adds `flags: [{"id":"painted-pixels","message":...}]` when it looks painted. It is a flag, not a refusal, and `codeDrawn` does not suppress it.

The reading is taken over 64px windows (half-window stride; a smaller crop is one window) and the strongest window counts, so a painted patch reads the same in a tight box and in a generous one, and a container is judged on what shows between its raster children. Per window: `colours`, the distinct colours on a 2x-averaged copy that sit off the line between the window's two main tones, and `soft`, the share of mid-tone pixels in its 8x8 blocks with any contrast. A window reads painted at (colours, soft) of at least (18, 0.44) or (28, 0.38), or 60 colours alone.

Calibration: 556 regions from 12 eval comps plus the 24-run replay. Every photograph and about half the plates read painted when scored as code regions (the misses are small single-ink sprigs and flat plaques that look like type). No text or control region that shows only type flags; the ones that do hold painted material (foliage over a nav bar, a painted shutter button, a plaque).

The stored `message` is an observation for the reviewer ("Looks painted: 35 colours beyond its two main tones and soft shading across 45% of it. Drawn in code, this becomes a flat copy."). The instruction for the agent lives only in comp-spec's printed `FLAG <id> painted-pixels: ...` line.

## Baked-composite flag (`comp-spec`)

A raster region (`plate`, `image`, `texture`) whose note names a frame and then an opening onto content gets `flags: [{"id":"baked-composite","message":...}]`. Frame words: surround, frame, framing, window, doorway, door, arch, archway, shutter, cartouche, portal, niche, alcove, mirror, porthole, casement, proscenium. Opening words, which must come after the first frame word: view, vista, showing, reveals, looking out/through/into, inside, interior, through, beyond, opening onto, glimpse, "photograph/scene/picture/image of". "Full-frame" and "full-bleed" do not count as frames. Two cases never flag: a note whose leading clause is the content ("photograph through window: guest room, balcony doors open to the sea"), where later frame words are subject matter; and a raster region at least half covered by another plate whose note names a frame with its own opening ("window surround ..., transparent opening"), because that composite is already split.

The order rule keeps the frame-as-content cases clean: "a photograph of a window", "coast photograph seen through a carriage window" and "sea window photo" do not flag. "Framed portrait photo" does not flag either: nothing in it says the frame is a separate object with the portrait behind it rather than the photo's own composition, and flagging every framed photo would bury the real case. Checked on 128 raster notes from the calibration comps, the 24-run replay and the plan-review eval workspaces: 11 hits (the hotel run's three windows, seven painted room windows "showing a bright hotel bedroom interior", one "painted window ... photograph of stone terrace"), all real frame-plus-view composites, and no false positives. No pixel signal is used; the note is enough on this data.

The message is an observation for the reviewer and names a moving part when the note has one: "Frame and view are one image here, so the page can't swap the view or move the shutters on their own." The printed `FLAG` line adds the instruction for the agent: a frame plate with a transparent opening, the view as its own image region beneath it, and moving parts as their own plates, composited in the page. It is a flag, not a refusal.

## Surface reading (`comp-spec`)

Every code region also gets `"surface": {"flat": bool, "rules": bool}`, measured on its own pixels: raster regions and smaller regions inside it (its text, its controls) are set aside.

- `flat`: under 2% of those pixels leave the main tone. A bare ground: a nav field, a section background.
- `rules`: the box is at most 6px on its short side, or at least 80% of its ink lies on straight horizontal or vertical runs of 12px or more that are at most 6px thick. Frame edges, ticks, dividers, hairline grids.

`component-review plan` keeps non-container `chrome` as a plan item only when it is neither `flat` nor `rules`, so emblems, marks, icons and ornaments stay in the review and grounds and rules move to `codeRegions`. A flagged or `codeDrawn` region is a plan item regardless. A spec written before this reading carries no `surface` and keeps every non-container chrome.

## Engine notes

Details the engine settles that the sections above leave open (full wording in `docs/CLI-CONTRACT.md`, "Component review"):

- Packet identity: `id` is `components` for every round, so rounds share one session and decisions carry; `title` is `Plan and asset review`, plus ` · <artifact>` when the build state names one. `name` is derived from the region id.
- v3 capture evidence has its own schema, `plan-review-proof-v1`, so a browser capture can never stand in for it or the reverse. Plan items carry no `context` or `thumbnail`; assets get `thumbnail` equal to their preview.
- Decisions keep today's required `feedback` string (empty allowed) for every action; `feedback` is optional only in `submission.reclassify` entries.
- A spec with no raster region and no plan item has nothing to review: `plan` refuses to write an empty packet, and the build-phase gate does not wait.
- Hosted sessions (`IMPECCABLE_COMPONENT_REVIEW_TOOL` set) keep their review in the host's store. The host names its trusted session directories in `IMPECCABLE_COMPONENT_REVIEW_SESSIONS` (an OS path list, the same directories `lifecycle --hosted --session-dir` takes), and the gate applies the local rules to them: an accepted first viewport, or an accepted, capture-intact v3 review whose `specSha256` matches the current spec. Without that variable a hosted session is refused (fail closed). `IMPECCABLE_COMPONENT_REVIEW_PENDING` plays no part in this gate; only the hosted capture service reads it.
- The plates `--force` rule is unchanged and not widened: a reason that passes it (a quoted user downgrade of the comp) waives the review reason along with the plate readings, and is recorded. `record hero` has no force.
