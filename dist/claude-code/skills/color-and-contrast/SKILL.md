---
name: color-and-contrast
description: Build sophisticated color systems balancing aesthetics with accessibility and function. Use this skill when establishing brand palettes, implementing theming, or ensuring WCAG compliance. Produces beautiful, accessible color implementations with systematic coherence across all theme variants.
license: Complete terms in LICENSE.txt
---

This skill guides the creation of color systems that are both beautiful and functional, balancing creative expression with accessibility and systematic coherence.

The user provides a color challenge: building a color palette, implementing theming, fixing contrast issues, establishing brand colors, or creating dark mode variants. They may include brand guidelines, accessibility requirements, or existing design constraints.

## Color System Thinking

Before choosing colors, understand the strategic requirements:

- **Brand & Emotion**: What feelings should the colors evoke? Trust (blues)? Energy (reds/oranges)? Growth (greens)? Luxury (purples/golds)? Colors are never neutral.
- **Functional Requirements**: How many semantic states needed? Success, error, warning, info? How many UI layers? Background, surface, border, text?
- **Context**: Industry conventions (avoid red for finance), cultural considerations, competitor differentiation.
- **Accessibility Goals**: WCAG level (A/AA/AAA), audience considerations (aging users need higher contrast).

**CRITICAL**: Color is both an art and a science. Aesthetics matter, but accessibility is non-negotiable.

Then build a color system that is:
- Accessible and WCAG compliant
- Systematically organized with clear roles
- Flexible enough for theming and variations
- Aesthetically cohesive and on-brand

## Color Theory Fundamentals

### Color Harmony & Relationships

[TO BE DEVELOPED: Complementary, analogous, triadic, split-complementary, monochromatic schemes, color wheel navigation]

### Color Psychology & Meaning

[TO BE DEVELOPED: Emotional associations, cultural considerations, industry conventions, semantic color choices]

### Color Properties

[TO BE DEVELOPED: Hue, saturation, lightness/brightness, HSL vs RGB vs LCH, perceptual uniformity]

## Building Functional Palettes

### Palette Structure

[TO BE DEVELOPED: Primary/secondary/tertiary, neutral scales (9-11 steps), semantic colors, state colors]

### Generating Color Scales

[TO BE DEVELOPED: Lightness curves, saturation shifts, hue rotation, perceptual uniformity, algorithmic generation]

### The Dominant Color Principle

[TO BE DEVELOPED: 60-30-10 rule, accent color strategy, visual weight distribution, avoiding rainbow vomit]

## Contrast & Accessibility

### WCAG Compliance

[TO BE DEVELOPED: AA vs AAA standards, text contrast ratios (4.5:1 / 7:1), UI component contrast (3:1), large text exceptions]

### Testing & Tools

[TO BE DEVELOPED: Contrast checkers, automated testing, color blindness simulation, tools for verification]

### Accessible Color Combinations

[TO BE DEVELOPED: Which combinations work, which don't, safe pairings, dangerous pairings, contrast matrices]

## Theming Architecture

### Light & Dark Mode

[TO BE DEVELOPED: Independent palettes vs inverted, neutral strategies, shadows in dark mode, image handling]

### CSS Custom Properties

[TO BE DEVELOPED: Token hierarchy (primitive → semantic → component), naming conventions, theme switching]

### Multi-Theme Systems

[TO BE DEVELOPED: Brand themes, user preference themes, contextual themes, theme inheritance]

## Advanced Color Techniques

### Gradients & Effects

[TO BE DEVELOPED: Mesh gradients, color stops, blend modes, gradient generation, overlay techniques]

### Transparency & Alpha

[TO BE DEVELOPED: Alpha channels, overlay strategies, transparency scales, backdrop effects]

### Dynamic Color

[TO BE DEVELOPED: State-based color changes, hover darkening/lightening, interactive color feedback]

---

**IMPORTANT**: Test color combinations in context, not in isolation. Colors behave differently on different backgrounds and at different sizes.

**NEVER**:
- Rely on color alone to convey information
- Use color combinations that fail WCAG contrast requirements
- Create palettes with arbitrary color choices (every color needs a purpose)
- Ignore color blindness (8% of men, 0.5% of women)
- Use pure black (#000) or pure white (#fff) for large areas
- Create theme systems without testing all combinations

Remember: Color is powerful. Use it deliberately, systematically, and inclusively.