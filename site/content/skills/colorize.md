---
tagline: "Add strategic color to monochrome interfaces without going garish."
---

## When to use it

`/impeccable colorize` is the counterweight to "everything is gray". Dashboards that read as a beige wall, forms with no accent, content pages that could be any SaaS product. Reach for it when the interface is functional but emotionally flat, and you want warmth without tipping into the AI color palette (purple-to-pink, cyan neon, dark mode glow).

## How it works

The skill starts by reading your brand color if one exists, then decides where color earns its place:

1. **Primary action** gets the strongest expression of the brand hue.
2. **Secondary accents** get muted or tinted variants, not a second full color.
3. **Neutrals** get tinted toward the brand hue at low chroma (around 0.005 to 0.01), which is nearly invisible per pixel but creates subconscious cohesion.
4. **Content categories** get a limited, intentional accent system, not a rainbow.

Importantly, it uses OKLCH rather than HSL so that equal lightness steps look equal. As lightness moves toward the extremes, chroma drops automatically. This is how you get color that feels considered instead of computed.

## Try it

```
/impeccable colorize the dashboard
```

Expected diff:

- Brand color moved from a hardcoded hex to `--color-accent: oklch(62% 0.18 240)`
- Neutrals tinted with 0.007 chroma toward the brand hue
- Primary button gets the full accent, secondary buttons get ink/mist
- Chart series uses 3 distinct hues, all at matched lightness so no series visually dominates
- Empty state illustration picks up a soft accent wash

## Pitfalls

- **Running it without a brand hue.** Colorize needs a starting point. If `PRODUCT.md` does not specify one, it will ask. Do not let it pick from the AI color palette defaults.
- **Expecting it to fix the AI color palette problem.** If your design already has purple gradients and cyan neon, you need `/impeccable quieter` first, then colorize can rebuild.
- **Using it on already-colorful interfaces.** That is a `/impeccable quieter` job. Colorize adds, it does not subtract.
