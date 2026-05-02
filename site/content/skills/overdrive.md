---
tagline: "Push an interface past conventional limits. Shaders, physics, 60fps, cinematic transitions."
---

## When to use it

`/impeccable overdrive` is for the moments where you want to impress. A hero that uses WebGL. A table that handles a million rows. A dialog that morphs out of its trigger element. A form that validates in real-time with streaming feedback. A page transition that feels cinematic. Use it when the project budget allows for technical ambition and the outcome needs to feel extraordinary.

Do not use it on operator tools, dashboards, or anything where reliability beats spectacle. Overdrive burns complexity for effect, and that trade-off is only worth it on moments that matter.

## How it works

The skill picks one moment to make extraordinary and commits to it, rather than spreading effort across the whole interface. It then reaches for techniques most AI-generated UIs never touch: WebGL shaders, spring physics, Scroll Timeline, View Transitions, canvas animation, GPU-accelerated filters. Everything is budgeted, profiled, and tested at 60fps, with reduced-motion fallbacks baked in.

Overdrive output is announced with `──── ⚡ OVERDRIVE ────` so you know you are entering a more ambitious mode. Expect larger diffs, new dependencies, and implementation depth beyond what other skills produce.

## Try it

```
/impeccable overdrive the landing hero
```

One concrete run might replace a static hero with a WebGL shader background driven by mouse position, a display headline that reveals with a mask on scroll using the Scroll Timeline API, and a View Transition on the CTA that morphs into the next page. Plus a reduced-motion fallback that swaps all of it for a clean static composition.

## Pitfalls

- **Using it everywhere.** Overdrive works because it is rare. If every page has cinematic moments, none of them are cinematic.
- **Shipping without reduced-motion fallbacks.** Non-negotiable. Overdrive adds them automatically; do not remove them.
- **Ignoring performance.** Extraordinary moments still need to hit 60fps. If the effect drops frames, cut it or optimize. Slow spectacle is worse than simple done well.
- **Running overdrive before the base interface is solid.** Spectacle on a broken foundation reads as distraction, not delight.
