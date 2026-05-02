---
tagline: "Tone down designs that are shouting without losing their intent."
---

## When to use it

`/impeccable quieter` is the counterweight to `/impeccable bolder`. Reach for it when an interface is visually aggressive, overstimulating, or trying to do too many things at full volume. Neon on dark, gradient text everywhere, 6 accent colors, everything animated, 20px shadows. Use quieter when the design needs to breathe and you want refinement without losing the point of view.

Also useful after `/impeccable bolder` goes a little too far.

## How it works

The skill works by reduction across four axes:

1. **Color**: desaturate, lower chroma in OKLCH, pull accents back to a single primary plus muted support. No more than two intentional colors.
2. **Contrast**: soften extreme darks and lights, pull the range in. Backgrounds move from pure white and pure black to paper and ink.
3. **Decoration**: remove shadows that are not doing work, drop borders that are not carrying structure, retire gradients that exist for energy rather than hierarchy.
4. **Motion and effect**: slow animations down, remove anything that auto-plays, drop parallax and blur unless they serve readability.

The skill preserves the design's intent. If the original had a point of view, the quieter version has the same point of view with more confidence. Refinement, not neutralization.

## Try it

```
/impeccable quieter the pricing page
```

Typical diff:

- Gradient text on the price removed, replaced with solid ink at one weight heavier
- Three accent colors reduced to one (magenta), the other two become neutral variants
- Card shadows reduced from `0 20px 40px rgba(0,0,0,0.2)` to `0 1px 0 var(--color-mist)` (a hairline)
- Background switches from dark gradient to paper with a subtle cream wash at the top
- Hero animation from 1.2s easeOut with 3 staggered elements to a single 260ms fade-in

## Pitfalls

- **Over-applying.** Quieter can strip personality if you run it on something that was already measured. Use it when the design is too loud, not when it is correctly assertive.
- **Confusing quieter with distill.** Quieter reduces intensity. Distill removes elements. They are different moves.
- **Running it in response to a critique that says "too busy".** Busy usually means too many things, not too loud. Try `/impeccable distill` first.
