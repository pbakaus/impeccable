---
tagline: "Purposeful motion that conveys state, not decoration."
---

## When to use it

`/impeccable animate` is for interfaces that feel lifeless, where state changes are instant and jarring, where loading just pops in, where the user never quite trusts that their click registered. Use it to add the small motions that communicate what is happening: entrances, exits, feedback, transitions between states.

Do not use it to add bounces or elastic springs for the sake of energy. That is decoration, and this skill will not give it to you.

## How it works

The skill identifies static moments that would benefit from motion, then applies them with strict discipline:

1. **Entrances and exits**: elements appear and leave with 200 to 300ms fades plus subtle Y or scale, never layout properties.
2. **State feedback**: hover, active, focus, loading, success all communicate via motion instead of sudden swaps.
3. **Transitions between views**: shared-element transitions where it makes sense, fade-through otherwise.
4. **Progress and loading**: skeleton screens, determinate bars, motion that says "still working".
5. **Reduced motion**: every animation has a `prefers-reduced-motion` fallback.

Easing is always exponential (ease-out-quart, quint, or expo) because real objects decelerate smoothly. No bounce, no elastic, no linear for anything except progress indicators.

The skill animates `transform` and `opacity` only. If you find yourself animating `width`, `height`, `top`, or `left`, it is doing the wrong thing. Use `grid-template-rows` for height transitions.

## Try it

```
/impeccable animate the sign-up flow
```

Typical additions:

- Email input gets a focus glow on focus-visible (opacity + shadow, 180ms)
- Submit button shows a spinner inside itself on loading state, not a separate spinner next to it
- Success screen enters with opacity + translateY(8px), 260ms, ease-out-quart
- Error message slides down with grid-template-rows (not height), 220ms
- `@media (prefers-reduced-motion: reduce)` fallback for every transition

## Pitfalls

- **Asking for "more animation".** Animate is not a dial. It adds where motion communicates, not everywhere.
- **Removing the reduced-motion fallbacks.** The skill adds them automatically. Non-negotiable for accessibility.
