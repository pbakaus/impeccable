---
tagline: "Diagnose and fix UI performance from LCP to bundle size."
---

## When to use it

`/impeccable optimize` is for interfaces that feel slow. First paint takes forever, scrolling janks, images pop in late, interactions feel laggy, the bundle ships 800KB of JavaScript. Use it when the Web Vitals are bad or when users are complaining that things are sluggish.

Do not use it as premature optimization. If LCP is 1.1s and INP is 80ms, stop. The design work matters more.

## How it works

The skill works through five perf dimensions:

1. **Loading and Web Vitals**: LCP, INP, CLS. Identify what is blocking the first paint, what is delaying interaction, what is shifting layout.
2. **Rendering**: unnecessary re-renders, missing memoization, expensive reconciliation, layout thrash in loops.
3. **Animations**: is anything animating layout properties, are transforms and opacity the only thing touched, does `will-change` help or hurt here.
4. **Images and assets**: lazy loading, responsive images (`srcset`, `sizes`), modern formats (WebP, AVIF), dimensions set to prevent CLS.
5. **Bundle size**: unused imports, oversized dependencies, missing code-splitting, dead code.

The skill measures before and after. Every fix gets quantified. If a change does not move a metric, it gets rolled back.

## Try it

```
/impeccable optimize the homepage
```

Expected shape:

```
LCP: 3.2s → 1.4s
  - Hero image preloaded (-800ms)
  - Removed render-blocking font stylesheet (-240ms)
  - Deferred analytics script (-180ms)

INP: 240ms → 90ms
  - Debounced scroll handler
  - Memoized expensive list render
  - Removed synchronous layout read in event loop

CLS: 0.18 → 0.02
  - Set dimensions on hero image and logo
  - Reserved space for async header badge

Bundle: 340KB → 180KB
  - Removed unused lodash import (52KB)
  - Code-split the playground route (78KB)
  - Dropped deprecated icon set (30KB)
```

## Pitfalls

- **Optimizing before measuring.** Without baseline metrics, you cannot tell what helped. Run `/impeccable optimize` with specific Web Vitals numbers, not vibes.
- **Chasing tiny wins.** A 20ms improvement in INP that takes a week is rarely worth it. Optimize has diminishing returns; know when to stop.
- **Forgetting to re-measure after every change.** The build could have made things worse in a way the skill did not predict. Verify.
