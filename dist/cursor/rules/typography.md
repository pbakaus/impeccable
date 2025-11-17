This skill guides the creation and refinement of typography systems that balance timeless principles with modern web capabilities.

The user provides a typography challenge: building a type system, improving readability, selecting fonts, fixing hierarchy, or implementing responsive typography. They may include context about the project's aesthetic direction, constraints, or specific problems to solve.

## Typography Thinking

Before implementing, understand the context and establish a clear typographic voice:

- **Purpose & Audience**: What is being communicated? Who is reading? Technical docs need different type than marketing pages.
- **Tone & Character**: What personality should the typography convey? Authoritative? Playful? Elegant? Minimal? The fonts and system should embody this.
- **Constraints**: Performance budgets, browser support, existing design system, accessibility requirements.
- **Reading Context**: Long-form reading vs scanning, dense information vs spacious editorial, desktop vs mobile primary usage.

**CRITICAL**: Typography is the voice of your interface. Invest time in getting it right - it impacts every single screen.

Then build or refine a typography system that is:
- Readable and accessible across devices and contexts
- Systematically coherent with clear hierarchy
- Performant and technically sound
- Aesthetically distinctive and appropriate for the brand

## Classic Typography Principles

### Vertical Rhythm & Baseline Grids

[TO BE DEVELOPED: Baseline grids, consistent vertical spacing, maintaining rhythm across components]

### Modular Scale & Hierarchy

[TO BE DEVELOPED: Scale ratios, establishing hierarchy through size/weight/spacing, visual balance]

### Readability & Measure

[TO BE DEVELOPED: Line length (45-75 CPL), line height ratios, paragraph spacing, optimal reading conditions]

## Font Selection & Pairing

### Choosing Distinctive Fonts

[TO BE DEVELOPED: Avoiding generic choices, character in typefaces, matching tone to content, Google Fonts alternatives]

### Pairing Principles

[TO BE DEVELOPED: Contrast-based pairing, display + body, serif + sans, mono + geometric, variable fonts]

### Web Font Loading

[TO BE DEVELOPED: FOUT/FOIT strategies, font-display, subsetting, variable fonts, preloading]

## Modern Web Typography

### Fluid & Responsive Type

[TO BE DEVELOPED: clamp(), viewport units, container query typography, breakpoint-based scales]

### Advanced Features

[TO BE DEVELOPED: OpenType features, ligatures, font-feature-settings, kerning, number styles]

### Performance Optimization

[TO BE DEVELOPED: Font loading strategies, subsetting, variable fonts vs static, hosting decisions]

## Typography System Architecture

### Token Structure

[TO BE DEVELOPED: Font stacks, size scales, weight scales, line heights, letter spacing]

### Implementation

[TO BE DEVELOPED: CSS custom properties, utility classes, semantic vs primitive tokens]

## Accessibility Considerations

[TO BE DEVELOPED: Text scaling, contrast ratios, font sizes, dyslexia-friendly choices]

---

**IMPORTANT**: Balance trendy font choices with timeless readability principles. A distinctive font is worthless if users can't comfortably read it.

**NEVER**:
- Use more than 2-3 font families in a single project
- Sacrifice readability for aesthetic novelty
- Ignore font loading performance
- Skip fallback font definitions
- Use decorative fonts for body text
- Implement arbitrary font sizes without a systematic scale

Remember: Typography is 95% of design. Master it, and everything else becomes easier.