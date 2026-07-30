# Doesn't Have a Clean Place in the 8-Category Schema (Orphans)

Present in current output, but no obvious bucket among Audience / Product / Brand / Color / Typography / Iconography / Material / Interface.

## Resolved

- **Register** (`product`/`brand`) → **Product**. It's the metadata switch that determines everything downstream, but downstream of what if not the product's own framing — it belongs next to Product Purpose.
- **Name** (`DESIGN.md` frontmatter `name`) → **Product**. The literal project name — an identifier, not a design decision; travels with Product Purpose rather than standing alone. (Originally bundled with `description` as "header metadata," but `description` isn't metadata — see next entry.)
- **Description** (`DESIGN.md` frontmatter `description`, e.g. "Calm HR ops workspace — dense tables, flat surfaces, dusty plum accent on warm cream.") → **Brand**, merged with Identity name + narrative. It's the same brand story as the `## 1. Overview` narrative, just compressed to one sentence — a short-form/long-form pair, not two separate facts. Filing it under Product next to `name` was a mistake carried over from treating the whole frontmatter block as one undifferentiated metadata unit.
- **Design Principles** (the numbered list as a unit) → **Brand**. Kept intact rather than decomposed per-bullet. Individual principles split close to 50/50 between voice/taste judgment calls (e.g. "Quiet authority over persuasion," "Restraint in every frame" — Brand) and product/workflow claims (e.g. "One workspace, not three spreadsheets" — Product), but the majority reads as brand cues and taste boundaries rather than product strategy, so the list stays with Brand instead of Product.
- **Spacing / layout scale** (`xs/sm/md/lg/xl/gutter/section` tokens) → **Material**. Treated as part of the physical construction of the interface alongside radius, borders, and elevation.
- **Breakpoints** (`sm/md/lg` px values) → **Material**. Responsive behavior of the same physical system: how surfaces reflow.
- **Accessibility & Inclusion** (WCAG target, reduced motion, alt text, color-vision pairing, plain-language/bilingual notes) → **Interface**. Per-item count across the two example runs: keyboard nav, screen-reader behavior, focus visibility, and alt text (Interface, the plurality) outweigh reduced motion (Material), contrast/color-vision pairing (Color), and bilingual/plain-language notes (Audience). Kept intact as a unit rather than split four ways, same treatment as Design Principles → Brand.
- **Tonal ramps** (`design.json` → `colorMeta.tonalRamp`, OKLCH 8-step scales per color) → **Color**. Promoted out of the sidecar into the human-readable doc, alongside the canonical hex — gives dark-mode inference raw material to work from instead of staying generated-only.
- **Motion tokens** (`design.json` → `extensions.motion`, e.g. `ease-standard`, `duration-fast`) → **Material**. Promoted out of the sidecar so the doc states the actual easing curve and duration behind "subtle lift on hover," not just the qualitative motion feel.

## Checked against PR #315 — no new orphans

[pbakaus/impeccable#315](https://github.com/pbakaus/impeccable/pull/315) adds `## Positioning` and `## Conversion & proof` to the `PRODUCT.md` template. Both map cleanly into the existing **Product** bucket, no new orphan:

- `## Positioning` → **Product**, filling the differentiator sub-item.
- `## Conversion & proof` (CTAs, memorable line, belief ladder, proof assets) → **Product**, filling the proof-points and what's-must-be-clear-first sub-items.

One nuance, not an orphan: the CTA/conversion-goal content doesn't exactly match any of the five sub-items in Product's current definition ("Purpose, differentiator, proof points, use cases, what must be clear first") — it's closest to Purpose but is more actionable/specific ("book a consultation" vs. "why this exists"). Worth a small wording update to Product's definition (e.g. adding "conversion goal") rather than a schema change.

## Checked against the upcoming visual document seed (Typescale, Layout structure, Iconography)

No new orphans. All three land inside categories that already exist in the schema:

- **Typescale** (modular scale/ratio) → **Typography**, filling the font-scale sub-item with a generative rule instead of hand-picked sizes.
- **Layout structure** (grid strictness spectrum) → **Material**, alongside the already-resolved spacing/breakpoints orphans — same "physical construction of the interface" bucket.
- **Iconography** (icon library/style) → **Iconography** itself. This is the first content this category has ever had; it fills the "icon style" sub-item specifically, but stroke weight, metaphor rules, icon-button behavior, and forbidden types are outside this question's scope and stay open (tracked in [`MISSING.md`](./MISSING.md)).

No open questions remain from this pass.
