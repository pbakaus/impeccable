---
tagline: "Pull reusable components, tokens, and patterns into the design system."
---

<div class="docs-viz-hero">
  <div class="docs-viz-flow">
    <div class="docs-viz-flow-step">
      <span class="docs-viz-flow-num">01</span>
      <span class="docs-viz-flow-name">Discover drift</span>
      <span class="docs-viz-flow-hint">Repeated hex values, button variants, spacing scales, text styles.</span>
    </div>
    <div class="docs-viz-flow-step">
      <span class="docs-viz-flow-num">02</span>
      <span class="docs-viz-flow-name">Propose primitives</span>
      <span class="docs-viz-flow-hint">Token names, component APIs with variant + size, text styles.</span>
    </div>
    <div class="docs-viz-flow-step docs-viz-flow-step--accent">
      <span class="docs-viz-flow-num">03</span>
      <span class="docs-viz-flow-name">Migrate call sites</span>
      <span class="docs-viz-flow-hint">Replace duplicated CSS with the new primitives. No orphan code left behind.</span>
    </div>
  </div>
  <p class="docs-viz-caption">The skill only extracts what's used three or more times with the same intent. Two usages are not a pattern, and migration always happens in the same pass.</p>
</div>

## When to use it

`/impeccable extract` is for the moment your codebase has accidentally become a design system. Repeated button styles in 12 places. Three variants of the same card. Hex colors scattered throughout. Hand-rolled spacing that accidentally matches a scale. Reach for it when you want to consolidate this drift into reusable primitives.

Use it after a product has shipped enough features to reveal the patterns. Premature extraction creates abstractions that do not match reality.

## How it works

The skill discovers the design system structure first, then identifies extraction opportunities:

1. **Tokens**: find repeated literal values (colors, spacing, radii, shadows, font sizes). Propose token names, add to the token system, replace usages.
2. **Components**: find UI patterns that repeat with minor variation (buttons, cards, inputs, modals). Extract into a single component with variants, migrate callers.
3. **Composition patterns**: find layout or interaction patterns that repeat (form rows, toolbar groups, empty states). Extract into composition primitives.
4. **Type styles**: find repeated font-size + weight + line-height combinations. Extract into text styles.
5. **Animation patterns**: find repeated easing, duration, or keyframe combinations. Extract into motion tokens.

The skill is cautious. It only extracts things used three or more times, with the same intent. It never extracts "because it might be reused later". Premature abstraction is worse than duplication.

## Try it

```
/impeccable extract the button styles
```

Expected output:

- Found 14 button instances across 8 files
- 4 distinct variants: primary (filled accent), secondary (bordered), ghost (text-only), destructive (filled red)
- All 4 variants use the same size scale (small, default, large)
- Extracted into `<Button variant="primary" size="default">` with token-driven styles
- Migrated 14 call sites, removed ~180 lines of duplicated CSS
- Added 3 missing tokens: `--button-radius`, `--button-padding-y`, `--button-padding-x`

## Pitfalls

- **Extracting too early.** Two usages are not a pattern. Three might be. Wait until the pattern is obvious.
- **Over-generalizing.** The extracted component should match the current use cases closely, not anticipate every possible future one. You can always add variants later.
- **Forgetting the migration.** Extraction without migration leaves the old duplicated code around and creates a third way of doing the same thing. Always migrate in the same pass.
- **Extracting things that differ in intent.** Two buttons that look similar but serve different purposes (primary action vs link styled as button) should probably stay separate.
