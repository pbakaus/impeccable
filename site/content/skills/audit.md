---
tagline: "Five-dimension technical quality check with P0 to P3 severity."
---

<div class="docs-viz-hero">
  <div class="docs-viz-report">
    <div class="docs-viz-report-head">
      <div>
        <div class="docs-viz-report-title">/impeccable audit the checkout flow</div>
        <div class="docs-viz-report-target">src/checkout/**</div>
      </div>
      <div class="docs-viz-report-score">
        <span class="docs-viz-report-score-num">2.6</span>
        <span class="docs-viz-report-score-out">/ 4</span>
      </div>
    </div>
    <div class="docs-viz-report-dims">
      <div class="docs-viz-report-dim">
        <span class="docs-viz-report-dim-name">Accessibility</span>
        <span class="docs-viz-report-dim-bar"><span class="docs-viz-report-dim-fill docs-viz-report-dim-fill--fail" style="width:50%"></span></span>
        <span class="docs-viz-report-dim-score">2 / 4</span>
      </div>
      <div class="docs-viz-report-dim">
        <span class="docs-viz-report-dim-name">Performance</span>
        <span class="docs-viz-report-dim-bar"><span class="docs-viz-report-dim-fill" style="width:75%"></span></span>
        <span class="docs-viz-report-dim-score">3 / 4</span>
      </div>
      <div class="docs-viz-report-dim">
        <span class="docs-viz-report-dim-name">Theming</span>
        <span class="docs-viz-report-dim-bar"><span class="docs-viz-report-dim-fill docs-viz-report-dim-fill--warn" style="width:62%"></span></span>
        <span class="docs-viz-report-dim-score">2.5 / 4</span>
      </div>
      <div class="docs-viz-report-dim">
        <span class="docs-viz-report-dim-name">Responsive</span>
        <span class="docs-viz-report-dim-bar"><span class="docs-viz-report-dim-fill" style="width:75%"></span></span>
        <span class="docs-viz-report-dim-score">3 / 4</span>
      </div>
      <div class="docs-viz-report-dim">
        <span class="docs-viz-report-dim-name">Anti-patterns</span>
        <span class="docs-viz-report-dim-bar"><span class="docs-viz-report-dim-fill docs-viz-report-dim-fill--warn" style="width:70%"></span></span>
        <span class="docs-viz-report-dim-score">2.8 / 4</span>
      </div>
    </div>
    <div class="docs-viz-report-issues">
      <span class="docs-viz-report-sev docs-viz-report-sev--p0">P0<span class="docs-viz-report-sev-n">2</span></span>
      <span class="docs-viz-report-sev docs-viz-report-sev--p1">P1<span class="docs-viz-report-sev-n">5</span></span>
      <span class="docs-viz-report-sev docs-viz-report-sev--p2">P2<span class="docs-viz-report-sev-n">8</span></span>
      <span class="docs-viz-report-sev docs-viz-report-sev--p3">P3<span class="docs-viz-report-sev-n">14</span></span>
    </div>
  </div>
  <p class="docs-viz-caption">Five dimensions scored 0 to 4, each finding tagged P0 (blocks release) to P3 (polish). Audit documents; it doesn't fix. Route the findings into <code>/impeccable harden</code>, <code>/impeccable polish</code>, or <code>/impeccable optimize</code>.</p>
</div>

## When to use it

`/impeccable audit` is the technical counterpart to `/impeccable critique`. Where `/impeccable critique` asks "does this feel right", `/impeccable audit` asks "does this hold up". It runs accessibility, performance, theming, responsive design, and anti-pattern checks against the implementation, scores each dimension 0 to 4, and produces a plan with P0 to P3 severity ratings.

Use it before shipping, during a quality sprint, or whenever a tech lead says "we should really look at accessibility".

## How it works

The skill scans your code across five dimensions:

1. **Accessibility**: WCAG contrast, ARIA, keyboard nav, semantic HTML, form labels.
2. **Performance**: layout thrashing, expensive animations, missing lazy loading, bundle weight.
3. **Theming**: hard-coded colors, dark mode coverage, token consistency.
4. **Responsive**: breakpoint behavior, touch targets, mobile viewport handling.
5. **Anti-patterns**: the same deterministic 25 checks the detector runs.

Each dimension gets a 0 to 4 score. Each finding gets a severity: P0 blocks the release, P1 should fix this sprint, P2 is next cycle, P3 is polish. You get back a single document you can paste into a ticket tracker.

Audit does not fix anything. It documents. Route the findings to `/impeccable polish`, `/impeccable harden`, or `/impeccable optimize` depending on the category.

## Try it

```
/impeccable audit the checkout flow
```

Expected output:

```
Accessibility: 2/4 (partial)
  P0: Missing form labels on 4 inputs
  P1: Contrast 3.1:1 on disabled button state
  P2: No visible focus indicator on custom dropdown

Performance: 3/4 (good)
  P1: Hero image not lazy-loaded (340KB)
  ...
```

Hand the P0s to `/impeccable harden`, the theming and typography P1s to `/impeccable typeset` and `/impeccable polish`, the rest to `/impeccable polish`.

## Pitfalls

- **Confusing it with `/impeccable critique`.** Audit is implementation quality. Critique is design quality. Run both for a full picture.
- **Fixing P3s before P0s.** The severity scale exists for a reason. Start at the top.
- **Skipping the dimensions you think are fine.** Theming and responsive are the ones most people assume are fine until they are not.
