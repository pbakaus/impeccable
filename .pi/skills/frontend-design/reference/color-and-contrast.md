# Color & Contrast

## Color Spaces: Use OKLCH

**Stop using HSL.** Use OKLCH (or LCH) instead. It's perceptually uniform, meaning equal steps in lightness *look* equal—unlike HSL where 50% lightness in yellow looks bright while 50% in blue looks dark.

```css
/* OKLCH: lightness (0-100%), chroma (0-0.4+), hue (0-360) */
--color-primary: oklch(60% 0.15 250);      /* Blue */
--color-primary-light: oklch(85% 0.08 250); /* Same hue, lighter */
--color-primary-dark: oklch(35% 0.12 250);  /* Same hue, darker */
```

**Key insight**: As you move toward white or black, reduce chroma (saturation). High chroma at extreme lightness looks garish. A light blue at 85% lightness needs ~0.08 chroma, not the 0.15 of your base color.

## Building Functional Palettes

### The Tinted Neutral Trap

**Pure gray is dead.** Add a subtle hint of your brand hue to all neutrals:

```css
/* Dead grays */
--gray-100: oklch(95% 0 0);     /* No personality */
--gray-900: oklch(15% 0 0);

/* Warm-tinted grays (add brand warmth) */
--gray-100: oklch(95% 0.01 60);  /* Hint of warmth */
--gray-900: oklch(15% 0.01 60);

/* Cool-tinted grays (tech, professional) */
--gray-100: oklch(95% 0.01 250); /* Hint of blue */
--gray-900: oklch(15% 0.01 250);
```

The chroma is tiny (0.01) but perceptible. It creates subconscious cohesion between your brand color and your UI.

### Palette Structure

A complete system needs:

| Role | Purpose | Example |
|------|---------|---------|
| **Primary** | Brand, CTAs, key actions | 1 color, 3-5 shades |
| **Neutral** | Text, backgrounds, borders | 9-11 shade scale |
| **Semantic** | Success, error, warning, info | 4 colors, 2-3 shades each |
| **Surface** | Cards, modals, overlays | 2-3 elevation levels |

**Skip secondary/tertiary unless you need them.** Most apps work fine with one accent color. Adding more creates decision fatigue and visual noise.

### The 60-30-10 Rule (Applied Correctly)

This rule is about **visual weight**, not pixel count:

- **60%**: Neutral backgrounds, white space, base surfaces
- **30%**: Secondary colors—text, borders, inactive states
- **10%**: Accent—CTAs, highlights, focus states

The common mistake: using the accent color everywhere because it's "the brand color." Accent colors work *because* they're rare. Overuse kills their power.

## Contrast & Accessibility

### WCAG Requirements

| Content Type | AA Minimum | AAA Target |
|--------------|------------|------------|
| Body text | 4.5:1 | 7:1 |
| Large text (18px+ or 14px bold) | 3:1 | 4.5:1 |
| UI components, icons | 3:1 | 4.5:1 |
| Non-essential decorations | None | None |

**The gotcha**: Placeholder text still needs 4.5:1. That light gray placeholder you see everywhere? Usually fails WCAG.

### Dangerous Color Combinations

These commonly fail contrast or cause readability issues:

- Light gray text on white (the #1 accessibility fail)
- **Gray text on any colored background**—gray looks washed out and dead on color. Use a darker shade of the background color, or transparency
- Red text on green background (or vice versa)—8% of men can't distinguish these
- Blue text on red background (vibrates visually)
- Yellow text on white (almost always fails)
- Thin light text on images (unpredictable contrast)

### Never Use Pure Gray or Pure Black

Pure gray (`oklch(50% 0 0)`) and pure black (`#000`) don't exist in nature—real shadows and surfaces always have a color cast. Even a chroma of 0.005-0.01 is enough to feel natural without being obviously tinted. (See tinted neutrals example above.)

### Gradient & Glass Surface Contrast

**Gradients**: Measure contrast at the lightest (worst-case) stop of the gradient, not the average. Text over a blue-to-white gradient must pass contrast against the white end.

**Frosted glass / backdrop-filter**: Never place text over `backdrop-filter: blur()` without a solid scrim behind the text. Blurred backgrounds are unpredictable — the contrast depends on whatever content scrolls behind. Minimum scrim: `rgba(10, 10, 10, 0.65)` for light text, `rgba(255, 255, 255, 0.75)` for dark text. Never use `backdrop-filter` over user-generated or dynamic content without a scrim.

### Testing

Don't trust your eyes. Use tools:

- [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)
- Browser DevTools → Rendering → Emulate vision deficiencies
- [Polypane](https://polypane.app/) for real-time testing

## Theming: Light & Dark Mode

### Dark Mode Is Not Inverted Light Mode

You can't just swap colors. Dark mode requires different design decisions:

| Light Mode | Dark Mode |
|------------|-----------|
| Shadows for depth | Lighter surfaces for depth (no shadows) |
| Dark text on light | Light text on dark (reduce font weight) |
| Vibrant accents | Desaturate accents slightly |
| White backgrounds | Never pure black—use dark gray (oklch 12-18%) |

**Surface elevation**: Higher = lighter. Space levels 6-8 lightness points apart:

```css
:root[data-theme="dark"] {
  --surface-1: oklch(15% 0.01 250);  /* Base */
  --surface-2: oklch(20% 0.01 250);  /* Card */
  --surface-3: oklch(25% 0.01 250);  /* Raised (modal, popover) */
  --surface-4: oklch(30% 0.01 250);  /* Highest (tooltip) */

  --body-weight: 350;  /* Reduce weight slightly — light-on-dark reads heavier */
}
```

**Text hierarchy via opacity**: Instead of multiple gray shades, use opacity on a single off-white base (`rgba(255,255,255,N)`): 0.87 primary, 0.7 secondary, 0.5 tertiary, 0.3 disabled. Never use pure `#FFFFFF` for body text — it's too harsh. Off-white like `#EDECF4` or `rgba(255,255,255,0.87)` is easier on the eyes.

**Borders & shadows**: Standard `box-shadow` is invisible on dark surfaces. Use `rgba(255,255,255,0.08)` borders for card edges, or colored glow/dense multi-layer black shadows for depth.

**Accent adjustments**: Brand accents that pass contrast on white often fail on dark gray. Increase lightness by +15-25% and reduce chroma by 10-15%. A violet at `oklch(55% 0.15 280)` becomes `oklch(72% 0.12 280)` in dark mode.

### Token Strategy

Choose the right level of indirection for your project:

**Flat tokens** (simple, direct): Define colors by name or role and override them in dark mode. No alias chains. Works well for most projects and avoids the complexity of multi-layer systems.

```css
:root {
  --color-ink: oklch(15% 0.01 250);
  --color-surface: oklch(98% 0.01 250);
  --color-accent: oklch(55% 0.15 250);
}
[data-theme="dark"] {
  --color-ink: oklch(90% 0.01 250);
  --color-surface: oklch(15% 0.01 250);
  --color-accent: oklch(70% 0.12 250);
}
```

**Two-layer tokens** (primitive + semantic): Useful for large teams or multi-brand design systems where the same primitives map to different roles per brand. Adds indirection, so only adopt if the mapping complexity justifies it.

**Rule of thumb**: Start flat. Add a semantic layer only when you have multiple themes beyond light/dark, or when multiple teams need independent color decisions.

### Dark Mode Contrast Re-Verification

Light-mode contrast passing does NOT guarantee dark-mode contrast passes. Every text/background pair must be independently verified in both modes. Common failures:

- Mid-gray text (`#6B6B6B`) on dark surfaces — often lands at 4.0:1 or below
- Accent colors that pass on white but fail on dark gray (brand violet at `oklch(55% 0.15 280)` on `oklch(15% 0.01 250)` = ~3.8:1)
- Disabled-state text that was already borderline in light mode

**Adjust accents for dark mode**: Increase lightness by +15-25% and reduce chroma by 10-15% to maintain contrast without garish saturation.

## Alpha Is A Design Smell

Heavy use of transparency (rgba, hsla) usually means an incomplete palette. Alpha creates unpredictable contrast, performance overhead, and inconsistency. Define explicit overlay colors for each context instead. Exception: focus rings and interactive states where see-through is needed.

---

**Avoid**: Relying on color alone to convey information. Creating palettes without clear roles for each color. Using pure black (#000) for large areas. Skipping color blindness testing (8% of men affected).
