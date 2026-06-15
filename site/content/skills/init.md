---
tagline: "Set up Product, Brand, and Design context in one browser-first flow."
---

<div class="docs-viz-hero">
  <div class="docs-viz-file">
    <div class="docs-viz-file-header">
      <span class="docs-viz-file-name">PRODUCT.md · BRAND.md · DESIGN.md</span>
      <span class="docs-viz-file-status">Loaded on future commands</span>
    </div>
    <div class="docs-viz-file-body">
      <div class="docs-viz-file-row">
        <span class="docs-viz-file-k">Product</span>
        <span class="docs-viz-file-v">What exists, who it is for, why it is hard to replace.</span>
      </div>
      <div class="docs-viz-file-row">
        <span class="docs-viz-file-k">Brand</span>
        <span class="docs-viz-file-v">Trust, audience fit, visual cues, route families, guardrails.</span>
      </div>
      <div class="docs-viz-file-row">
        <span class="docs-viz-file-k">Design</span>
        <span class="docs-viz-file-v">Palette, typography, components, motion, accessibility.</span>
      </div>
    </div>
    <div class="docs-viz-file-footer">Init creates the context every later command should respect.</div>
  </div>
  <p class="docs-viz-caption">A browser questionnaire for brand-new sites and products. Answer, upload product material, choose visual cues, then lock the design direction.</p>
</div>

## When to use it

Run `/impeccable init` at the start of a project, or when the brand direction changes. Without it, later commands have to guess. With it, they read the product, brand, and design context before shaping or building.

Reach for it when:

- **You are starting a new site or product.** Init gives future agents a shared source of truth.
- **You have real product material.** Upload product photos, testimonials, process shots, GIFs, or MP4s so visual direction grows from the actual thing.
- **The brand direction changed.** Re-run init and stage updated next files without overwriting the old ones.
- **Another command reports missing context.** Run init, then resume.

## How it works

Init opens a local browser questionnaire with three sections:

- **What exists:** what you are making, what assets you already have, what makes it special.
- **What it means:** what people should trust, who should feel seen, who it is not for, and what visual cues the brand should carry.
- **How it appears:** color palette and typography direction.

The page shows one focused question at a time. Most slides offer generated choices plus a freeform input. The secondary action is **Choose for me**, which asks the agent to make the strongest choice from your previous answers; it is not a silent skip.

Visual cue cards are generated as four independent images. Each has a route family such as material/object, graphic/shape, gesture/motion, atmosphere/light, playful/character, pattern/ornament, surreal/metaphor, or editorial/cultural. The point is variety: four art-direction doors, not four versions of the same object.

Palette cards are generated from the selected cues and uploaded assets. Typography cards use real loadable fonts, not images, so you can see the actual heading and body voice.

## Output

Init writes:

- **`PRODUCT.md`** for product definition, audience, differentiator, assets, register, and practical context.
- **`BRAND.md`** for trust, audience fit/non-fit, selected cue images, route families, prompt history, and guardrails.
- **`DESIGN.md`** for palette, typography, component, motion, and accessibility guidance linked back to `BRAND.md`.

If any file already exists, init stages the replacement under `.impeccable/init/*.next.md` and asks before merge or replace.

## Try it

```
/impeccable init
```

Expect a visual browser flow, not a long chat interview. The first question is simple: “What are we making?”

## Pitfalls

- **Treating Choose for me as skip.** It delegates the decision to the agent and records the rationale.
- **Uploading generic stock instead of real material.** Product images, process shots, and proof make later cue and palette choices sharper.
- **Choosing four similar cues.** A useful batch gives you different art-direction routes.
- **Ignoring staged files.** Existing PRODUCT, BRAND, and DESIGN files are never overwritten silently.
