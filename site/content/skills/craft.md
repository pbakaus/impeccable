---
tagline: "Design it, then build it, all in one flow."
---

<div class="docs-viz-hero">
  <div class="docs-viz-flow">
    <div class="docs-viz-flow-step">
      <span class="docs-viz-flow-num">01</span>
      <span class="docs-viz-flow-name">Shape</span>
      <span class="docs-viz-flow-hint">Task brief. Purpose, audience, proof, constraints, direction.</span>
    </div>
    <div class="docs-viz-flow-step">
      <span class="docs-viz-flow-num">02</span>
      <span class="docs-viz-flow-name">Load references</span>
      <span class="docs-viz-flow-hint">Spatial, typography, motion, color, interaction.</span>
    </div>
    <div class="docs-viz-flow-step">
      <span class="docs-viz-flow-num">03</span>
      <span class="docs-viz-flow-name">Build</span>
      <span class="docs-viz-flow-hint">Structure, hierarchy, type, color, states, motion, responsive.</span>
    </div>
    <div class="docs-viz-flow-step docs-viz-flow-step--accent">
      <span class="docs-viz-flow-num">04</span>
      <span class="docs-viz-flow-name">Iterate visually</span>
      <span class="docs-viz-flow-hint">Check in browser, refine until it matches the brief.</span>
    </div>
  </div>
  <p class="docs-viz-caption">Every phase is non-skippable. The discovery step is where most AI output fails: by the time code exists, the thinking is locked in.</p>
</div>

## When to use it

`/impeccable craft` is the end-to-end build command. Give it a website, surface, or feature description and it runs the whole pipeline: task-specific shape, reference loading, implementation, visual iteration. Use it when you are starting from zero and want the whole workflow in one invocation.

Reach for it when:

- **You are building a new feature and want the full flow.** You do not want to manage the steps yourself.
- **You know what you are building but not how it should look.** The discovery phase forces the design thinking before implementation locks it in.
- **You want visual iteration by default.** `craft` checks the result in a browser and refines until the polish is high, instead of shipping the first working version.

If you only want the thinking without the code, use `/impeccable shape` standalone. If you already have a clear vision and just want to build, call `/impeccable` directly with your feature description. `craft` sits in between: structured, complete, opinionated.

If the work is mainly brand/site direction, run `/impeccable init` first. It produces `PRODUCT.md`, `BRAND.md`, and `DESIGN.md` with selected cue, palette, and type choices, then you can shape or craft from that direction later.

## How it works

`craft` runs four phases in order:

1. **Shape the design.** Runs `/impeccable shape` internally: a short conversation about purpose, users, content, constraints, and goals. The output is a task brief you can read and push back on.
2. **Load references.** Based on the brief, pulls in the right reference files (spatial, typography, motion, color, interaction, responsive, UX writing) so the model has the relevant principles loaded before it starts coding.
3. **Build.** Implements the feature in a deliberate order: structure first, then spacing and hierarchy, then type and color, then states, then motion, then responsive. Every decision traces back to the brief.
4. **Visual iteration.** Opens the result in a browser, checks it against the brief and the anti-pattern catalog, and refines until it matches the intent. This step is critical. The first working version is never the shipped version.

The discovery phase is non-skippable and that is the point. Most AI-generated UIs fail because nobody asked what the user was trying to accomplish before the model started writing JSX. `craft` inverts that.

## Try it

```
/impeccable craft a new website for a boutique architecture studio
```

Expect a focused design conversation first. Questions cover audience, proof, visual references, emotional tone, anti-references, and constraints. Then a confirmed design brief. Then implementation, with the browser checked at each stage. Expect multiple iteration rounds in the visual polish phase.

The whole run is longer than a typical command because it includes the thinking, the building, and the refining. That is the trade: more upfront structure, less cleanup afterwards.

## Pitfalls

- **Using it for small changes.** `craft` is for new features, not touch-ups. For existing code, reach for `/impeccable polish`, `/impeccable critique`, or a specific refinement command instead.
- **Rushing the discovery phase.** The brief feels slow compared to "just start coding". It is not. Answering carefully produces a sharper build and fewer rewrites.
- **Skipping the visual iteration.** The phase exists for a reason. The gap between "technically works" and "feels right" is closed with visual polish, not code review. Let it run.
