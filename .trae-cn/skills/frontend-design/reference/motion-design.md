# Motion Design

## Duration: The 100/300/500 Rule

Timing matters more than easing. These durations feel right for most UI:

| Duration | Use Case | Examples |
|----------|----------|----------|
| **100-150ms** | Instant feedback | Button press, toggle, color change |
| **200-300ms** | State changes | Menu open, tooltip, hover states |
| **300-500ms** | Layout changes | Accordion, modal, drawer |
| **500-800ms** | Entrance animations | Page load, hero reveals |

**Exit animations are faster than entrances**—use 60-75% of enter duration.

### Duration by Element Size & Distance

Larger elements and longer distances need more time. Use these as starting points, not rigid rules:

| Element size | Enter | Exit |
|-------------|-------|------|
| Small (icon, badge, tooltip) | 100-150ms | 75-100ms |
| Medium (card, menu, toast) | 200-300ms | 150-200ms |
| Large (modal, drawer, panel) | 300-500ms | 200-350ms |
| Full-screen (page, overlay) | 400-600ms | 250-400ms |

| Travel distance | Duration |
|----------------|----------|
| < 100px | 100-200ms |
| 100-500px | 200-350ms |
| > 500px | 350-500ms |

**Stagger intervals**: 30-50ms for tight lists, 60-80ms for grids, 100-150ms for hero sequences.

## Easing: Pick the Right Curve

**Don't use `ease`.** It's a compromise that's rarely optimal. Instead:

| Curve | Use For | CSS |
|-------|---------|-----|
| **ease-out** | Elements entering | `cubic-bezier(0.16, 1, 0.3, 1)` |
| **ease-in** | Elements leaving | `cubic-bezier(0.7, 0, 0.84, 0)` |
| **ease-in-out** | State toggles (there → back) | `cubic-bezier(0.65, 0, 0.35, 1)` |

**For micro-interactions, use exponential curves**—they feel natural because they mimic real physics (friction, deceleration):

```css
/* Quart out - smooth, refined (recommended default) */
--ease-out-quart: cubic-bezier(0.25, 1, 0.5, 1);

/* Quint out - slightly more dramatic */
--ease-out-quint: cubic-bezier(0.22, 1, 0.36, 1);

/* Expo out - snappy, confident */
--ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
```

**Avoid bounce and elastic curves.** They were trendy in 2015 but now feel tacky and amateurish. Real objects don't bounce when they stop—they decelerate smoothly. Overshoot effects draw attention to the animation itself rather than the content.

## Pre-Animation State Must Live in CSS

CSS is synchronous; JavaScript is not. If an element's initial state (e.g., `opacity: 0; transform: translateY(20px)`) is set by JS, users see a flash of the final state before JS runs. Always define the pre-animation state in your stylesheet so the element is hidden/positioned correctly on first paint, then animate from that state.

## The Only Two Properties You Should Animate

**transform** and **opacity** only—everything else causes layout recalculation. For height animations (accordions), use `grid-template-rows: 0fr → 1fr` instead of animating `height` directly.

## Staggered Animations

Use CSS custom properties for cleaner stagger: `animation-delay: calc(var(--i, 0) * 50ms)` with `style="--i: 0"` on each item. **Cap total stagger time**—10 items at 50ms = 500ms total. For many items, reduce per-item delay or cap staggered count.

## JavaScript Animation (GSAP)

CSS handles simple transitions well. For sequenced, interactive, or complex choreography, use a JS animation library like GSAP. Key rules when mixing JS animation with component lifecycles:

- **Pre-animation state in CSS** (see above). GSAP animates *from* this state.
- **Inline values, not shared config files.** Durations and easings belong in the component using them — a shared `animations.js` config becomes a coupling magnet.
- **Clean up on unmount.** In React, call `gsap.killTweensOf(ref.current)` in every `useEffect` cleanup. Orphaned tweens write to detached DOM nodes and leak memory.
- **Reduced motion guard:**
  ```js
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    gsap.defaults({ duration: 0 });
  }
  ```
  This collapses all GSAP animation to instant state changes without requiring per-tween conditionals.

## Reduced Motion

This is not optional. Vestibular disorders affect ~35% of adults over 40.

**CSS approach:**
```css
/* Provide alternative for reduced motion */
@media (prefers-reduced-motion: reduce) {
  .card {
    animation: fade-in 200ms ease-out;  /* Crossfade instead of motion */
  }
}

/* Or disable entirely */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

**JS approach (GSAP):** Check `prefers-reduced-motion` at runtime and set `gsap.defaults({ duration: 0 })` — see GSAP section above.

**What to preserve**: Functional animations like progress bars, loading spinners (slowed down), and focus indicators should still work—just without spatial movement.

## Perceived Performance

**Nobody cares how fast your site is—just how fast it feels.** Perception can be as effective as actual performance.

**The 80ms threshold**: Our brains buffer sensory input for ~80ms to synchronize perception. Anything under 80ms feels instant and simultaneous. This is your target for micro-interactions.

**Active vs passive time**: Passive waiting (staring at a spinner) feels longer than active engagement. Strategies to shift the balance:

- **Preemptive start**: Begin transitions immediately while loading (iOS app zoom, skeleton UI). Users perceive work happening.
- **Early completion**: Show content progressively—don't wait for everything. Video buffering, progressive images, streaming HTML.
- **Optimistic UI**: Update the interface immediately, handle failures gracefully. Instagram likes work offline—the UI updates instantly, syncs later. Use for low-stakes actions; avoid for payments or destructive operations.

**Easing affects perceived duration**: Ease-in (accelerating toward completion) makes tasks feel shorter because the peak-end effect weights final moments heavily. Ease-out feels satisfying for entrances, but ease-in toward a task's end compresses perceived time.

**Caution**: Too-fast responses can decrease perceived value. Users may distrust instant results for complex operations (search, analysis). Sometimes a brief delay signals "real work" is happening.

## Performance

Don't use `will-change` preemptively—only when animation is imminent (`:hover`, `.animating`). For scroll-triggered animations, use Intersection Observer instead of scroll events; unobserve after animating once. Create motion tokens for consistency (durations, easings, common transitions).

**Shadow animation trick**: Never animate `box-shadow` directly — it triggers paint on every frame. Instead, render the target shadow on a `::after` pseudo-element and animate its `opacity` from 0→1. The shadow is painted once and composited cheaply.

---

**Avoid**: Animating everything (animation fatigue is real). Using >500ms for UI feedback. Ignoring `prefers-reduced-motion`. Using animation to hide slow loading.
