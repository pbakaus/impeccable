# Contents

What currently produced output (`PRODUCT.md`, `DESIGN.md`, `.impeccable/design.json`) maps to, category by category, against the proposed 8-category design context doc.

Source examples analyzed (local scratch runs, not tracked in this repo):

- `tmp/notes/init-tests/runs/noren-ops-20260708-1832/DESIGN.md` + `proof/PRODUCT.md` + `proof/design.json`
- `tmp/notes/init-tests/runs/hanazono-atelier-20260708-1832/DESIGN.md` + `/Users/abdulwahab/hanazono-atelier/PRODUCT.md`

Every field below also has a provenance — derived from code, or from one of three questionnaire flows (in-chat during init, in-chat during document, browser during document — the last two cover both what's shipped today and the new seed work). See [`PROVENANCE.md`](./PROVENANCE.md) for the mechanism and [`CONTENTS-TABLE.md`](./CONTENTS-TABLE.md) for the per-field breakdown.

---

## Audience

*Who it is for, emotional state, needs, trust triggers.*

Found in:
- `PRODUCT.md` → `## Users`
  - Primary/secondary role
  - Company context
  - Weekly rhythm
  - Job-to-be-done
- `PRODUCT.md` → `Brand Personality` → "Emotional goal on landing"
  - e.g. Hanazono: "quiet authority"
  - Filed under Brand Personality today, but it's really audience emotional state

Gap:
- No dedicated trust-trigger question in the Audience interview block. As of [PR #315](https://github.com/pbakaus/impeccable/pull/315), the *content* exists one category over — see Product → `## Conversion & proof` → "Proof on hand" — but nothing cross-references it back into Audience.
- What exists instead (Rippling/Linear, Nicolai Bergmann/Cereal) are taste anchors, not trust signals

Tightened by PR #315 (not new content, but new rigor):
- `## Users` now requires a confirmed primary/secondary split rather than an inferred one — no manufacturing a secondary audience that isn't there.
- Explicit question when the surface's audience differs from who actually uses the product (e.g. a marketing site's visitor vs. an app's daily operator).

---

## Product

*Purpose, differentiator, proof points, use cases, what must be clear first.*

Found in:
- `PRODUCT.md` → `## Product Purpose`
  - What it does
  - The success definition
- `PRODUCT.md` → `## Positioning` (added in [PR #315](https://github.com/pbakaus/impeccable/pull/315), both registers)
  - "The single strategic claim every screen reinforces"
  - This is the differentiator field, now explicit instead of buried in Design Principles
- `PRODUCT.md` → `## Conversion & proof` (added in PR #315, **brand register only** — product register omits the section, heading included)
  - Primary and secondary CTA
  - The line a visitor remembers after 10 seconds
  - Belief ladder (what a visitor must believe, in order, before the primary CTA)
  - Proof on hand: testimonials, case studies, press, client/partner logos — referenced by path, collected under `.impeccable/assets/proof/`
  - This fills the proof-points sub-item directly, and the belief ladder / memorable line fill "what must be clear first"
- Use cases — still only implicit
  - Hanazono's three commission lanes are named in Product Purpose
  - Noren's app routes (Dashboard/People/PTO/Onboarding/Settings) only show up in agent-log crawl notes, never written into `PRODUCT.md` itself
  - Untouched by PR #315

Gap:
- Proof points / conversion framing don't exist for product-register projects — `Conversion & proof` is explicitly omitted there
- Use cases remain implicit rather than an enumerated field, for both registers

Also mapped here (resolved orphans — see [`ORPHANS.md`](./ORPHANS.md)):
- **Register** (`product`/`brand`) — travels with Product Purpose as the metadata switch for the rest of the doc
- **Name** (`DESIGN.md` frontmatter `name`) — the literal project name; an identifier, not a design decision. (`description` moved to Brand — see below.)

---

## Brand

*Identity, wordmark/logo fallback, voice, tone, cues, taste boundaries, anti-references.*

Found in:
- `DESIGN.md` → `## 1. Overview`
  - Creative North Star name
  - Narrative + key characteristics
- `PRODUCT.md` → `Brand Personality`
  - Three words
  - Voice, tone
  - References
- `PRODUCT.md` → `## Anti-references`
  - Echoed in `DESIGN.md` Overview and `## 6. Do's and Don'ts`

Also mapped here (resolved orphans — see [`ORPHANS.md`](./ORPHANS.md)):
- **Design Principles** (the numbered list as a unit) — e.g. "Quiet authority over persuasion," "Restraint in every frame" read as voice/taste judgment calls, closer to Brand's cues and taste boundaries than to Product's purpose/differentiator framing. Kept intact as a unit rather than decomposed per-bullet, even though a few individual principles (e.g. "One workspace, not three spreadsheets") lean Product.
- **Description** (`DESIGN.md` frontmatter `description`) — the short form of the same Creative North Star narrative above, not a separate fact. Was bundled with `name` under Product; that was a mistake, since it's brand-identity content compressed to one sentence, not header metadata.

Gap:
- Wordmark / logo fallback is completely absent in both examples
- No logo file reference, no text-lockup rule for when no mark exists

---

## Color

*Palette, roles, tints, strategy, dark-mode inference, copyable values.*

Found in:
- `DESIGN.md` frontmatter `colors:` block → palette + copyable hex values
- `DESIGN.md` → `## 2. Colors`
  - `### Primary` / `### Neutral` → roles
  - `### Named Rules` → strategy (One Accent Rule, Humane Ground Rule, One Plum Rule, Warm Ground Rule)
- Tints
  - Hanazono: opacity variants in frontmatter (`ink-muted`, `ink-subtle`, `divider`)
  - Noren: separate flat colors instead (`surface-raised`, `border-subtle`)

Also mapped here (resolved orphan — see [`ORPHANS.md`](./ORPHANS.md)):
- **Tonal ramps** (`design.json` → `colorMeta.tonalRamp`, OKLCH 8-step ramps per color) — promoted out of the sidecar into the doc, alongside the canonical hex

Gap:
- No dark-mode palette or inference logic anywhere
- The tonal ramps could seed one (they're dark-to-light ordered already) but nothing does yet — promoting them into the doc is a first step, not the full fix

---

## Typography

*Font families, hierarchy, font scale, readability rules.*

Found in:
- `DESIGN.md` frontmatter `typography:` block + "Display Font / Body Font" callouts
- `### Hierarchy` — role, size, weight, line-height, tracking, usage per level
- Readability rules
  - ch-width caps
  - `text-wrap: balance/pretty`
  - Named Rules (One Voice Display Rule, Measure Rule, Homepage Italic Rule)

Gap:
- Best-covered category, no real gaps
- Possible exception: no explicit rule documenting non-Latin fallback rationale (Hanazono stacks Hiragino Mincho / Yu Mincho for Japanese rendering)

Planned (upcoming visual document seed, not yet shipped):
- **Typescale** — a named modular scale/ratio (base size + ratio, e.g. Major Third) that generates the hierarchy, replacing hand-picked per-role sizes with a systematic rule.

---

## Iconography

*Icon style, stroke weight, metaphor rules, icon-button behavior, allowed/forbidden icon types.*

Found in:
- Nothing today. Zero mentions in `PRODUCT.md`, `DESIGN.md`, or `design.json` for either project
- Closest adjacent item: Hanazono's don't — "no decorative floral motifs in UI chrome" — but that's illustration/decoration, not icons

Planned (upcoming visual document seed, not yet shipped):
- **Icon library/style** — a direct question ("Which icon style should the design use?") with named library options (Lucide, Tabler Icons, Hugeicons), each with a one-line fit description.

Gap:
- Library choice covers icon *style* only. Stroke weight, metaphor rules, icon-button behavior, and allowed/forbidden icon types are not part of this question and stay unfed even once it ships.

---

## Material

*Radius, borders, shadows, elevation, surfaces, folds/edges, texture, motion feel.*

Found in:
- Radius: `rounded:` frontmatter tokens / Hanazono's explicit "square corners, no border-radius"
- Borders: Border Subtle / Hairline Rule / Lane Divider / CTA Stroke
  - Their color *values* live in the Color section — Material only gets them by reference
- Shadows + elevation: `## 4. Elevation` section, backed by `design.json.shadows[]`
- Surfaces: Surface Raised is written up under Color's `### Neutral`, not a Material section
  - Functionally a Material concept, textually filed under Color
- Motion feel — scattered
  - `prefers-reduced-motion` compliance + per-component hover behavior in Do's/Don'ts and Components prose
  - Actual motion tokens (`ease-standard`, `duration-fast`) only exist in `design.json`, never surfaced in `DESIGN.md`

Gap:
- Texture/grain and folds/edges have no field, not even to declare "intentionally none"
- Both example systems are flat by doctrine, but there's no explicit material-honesty statement captured anywhere

Also mapped here (resolved orphans — see [`ORPHANS.md`](./ORPHANS.md)):
- **Spacing / layout scale** (`xs/sm/md/lg/xl/gutter/section` tokens) — physical construction of the interface, alongside radius/borders/elevation
- **Breakpoints** (`sm/md/lg` px values) — responsive behavior of the same physical system
- **Motion tokens** (`design.json` → `extensions.motion`, e.g. `ease-standard`, `duration-fast`) — promoted out of the sidecar so the doc states the real easing curve and duration, not just qualitative motion feel

Planned (upcoming visual document seed — Layout structure already exists in today's seed, just not previously captured in this analysis):
- **Layout structure / grid strictness** — "How strict should the layout feel?" with named points on a spectrum (Simple grid, Balanced, Editorial, Freeform). A rhythm/composition rule distinct from the spacing scale — this is about how strictly content aligns to a grid, not what the spacing values are.

---

## Interface

*Buttons, inputs, cards/panels, rails, tabs, swatches, copy controls, component states, interaction patterns.*

Found in:
- `DESIGN.md` frontmatter `components:` token bindings
- `## 5. Components`
  - Buttons, Chips, Cards, Inputs, Navigation
  - Signature/future components: Metric Summary, Proof Quote, Commission Lane, Consultation Form, Gallery Grid
- Component states (hover/focus/error/disabled) documented inline per component
- `design.json.components[]` → concrete HTML/CSS per component

Also mapped here (resolved orphan — see [`ORPHANS.md`](./ORPHANS.md)):
- **Accessibility & Inclusion** (`PRODUCT.md` · WCAG target, reduced motion, alt text, color-vision pairing, plain-language/bilingual notes) — kept as a unit rather than split; the majority of its actual content (keyboard nav, screen-reader behavior, focus visibility, alt text) is Interface, even though reduced motion (Material), contrast/color-vision (Color), and bilingual notes (Audience) also draw from it. Filed here instead of Material, where it originally landed.

Gap:
- Best second-covered category
- Tabs/rails/swatches/copy-controls aren't exercised by either example — reads as "not needed by these two fixtures," not "no place to go"
