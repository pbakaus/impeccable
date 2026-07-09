# What's Missing

Genuine content gaps not produced by either example run (`noren-ops-20260708-1832`, `hanazono-atelier-20260708-1832`), regardless of category.

## Resolved by PR #315

[pbakaus/impeccable#315](https://github.com/pbakaus/impeccable/pull/315) ("Expand init to capture positioning, conversion, and proof context") adds two new `PRODUCT.md` sections to the Step 3 interview in `skill/reference/init.md`:

- `## Positioning` (both registers) — "the single strategic claim every screen reinforces"
- `## Conversion & proof` (brand register only; product register omits the section entirely) — primary/secondary CTA, the line a visitor remembers after 10 seconds, belief ladder, and "Proof on hand" (testimonials, case studies, press, client/partner logos — referenced by path, collected under `.impeccable/assets/proof/`)

What that resolves:

- ~~A labeled differentiator field~~ → `## Positioning` is exactly this, now asked explicitly instead of living buried inside Design Principles.
- ~~Proof points as actual content~~ → `## Conversion & proof` → "Proof on hand" collects real testimonials/case studies/press/logos by path, not just the proof-quote UI container.
- ~~A "what must be clear first" content-priority statement~~ → covered by the memorable-line + belief-ladder pair for brand register, and the pre-existing "primary workflow / primary task on any screen" question for product register.
- Explicit trust-trigger content for Audience → the *content* now exists (proof assets), but it's captured under Product (`Conversion & proof`), not Audience. See the note in [`ORPHANS.md`](./ORPHANS.md) — this isn't a new orphan, just a reminder that trust-trigger content lives one category over from where "Audience" would intuitively look for it.

Also tightened (not a new field, but changes what's captured): `## Users` now requires an explicit, confirmed primary/secondary audience split — no manufactured splits, and a direct question when the surface's audience differs from who actually uses the product.

## Partially resolved by the upcoming visual document seed

Planned feature (not yet a PR): a new visual, card-based document seed adds three question areas — Typescale, Layout structure, and Iconography. Layout structure already exists in today's seed ("How strict should the layout feel?" — Simple grid / Balanced / Editorial / Freeform); Typescale and Iconography are new.

- ~~Iconography, full stop~~ → **partially resolved.** The new "Which icon style should the design use?" question captures icon library/style (Lucide / Tabler Icons / Hugeicons). Icon style itself is no longer a total gap, but stroke weight, metaphor rules, icon-button behavior, and allowed/forbidden icon types are not part of this question and remain open — library choice implies a default aesthetic, not a full spec.
- Typography's font scale goes from hand-picked sizes to a named, generative rule: a base size + ratio (modular scale, e.g. Major Third) that derives the hierarchy, rather than each role's size being picked independently. Not something `MISSING.md` had called out explicitly before, but it's a real upgrade to how "font scale" gets captured.
- Layout structure (grid strictness) adds a rhythm/composition rule to Material that neither example run's `DESIGN.md` states explicitly today — closest existing analogue is the spacing scale, but "how strict is the grid" is a distinct decision from "what are the spacing values."

## Not missing, but not resettable either

Everything answered today gets baked directly into prose with no persisted record of the original question/answer pair: `Questionnaire — In-chat (init)` (nearly everything in `PRODUCT.md`), `Questionnaire — In-chat (document)`'s shipped fields (`DESIGN.md`'s North Star/color narrative/elevation feel), and `Questionnaire — Browser (document)`'s shipped fields (today's Layout-strictness card UI). There's nothing to reset any of them *to* — a user who wants to redo just the brand personality answer, or just the layout-strictness pick, has to manually edit the doc, not reopen a slide. Only the new fields being added to `In-chat (document)` and `Browser (document)` by the upcoming seed work are getting the persisted/resettable treatment. See [`PROVENANCE.md`](./PROVENANCE.md) open question #1 for whether the already-shipped fields should eventually get it too.

## Still missing

Untouched by PR #315 and the upcoming visual document seed:

- Stroke weight, metaphor rules, icon-button behavior, and allowed/forbidden icon types within Iconography (library/style choice alone doesn't cover these)
- Dark-mode palette / inference logic
- Wordmark / logo fallback rule
- Texture/grain and folds/edges material language (or an explicit "none, by doctrine" statement)
- Conversion & proof content for product-register projects — the section is explicitly omitted there, so proof-point/trust-trigger content stays absent for product-register work (arguably correct scope for an internal app, but worth a second look if a given product-register project does have testimonials or logos worth capturing)
