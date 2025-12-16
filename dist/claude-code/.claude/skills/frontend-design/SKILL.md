---
name: frontend-design
description: Create distinctive, production-grade frontend interfaces with comprehensive expertise in typography, color systems, spatial design, responsive layouts, interaction patterns, motion, and UX writing. Use this skill when the user asks to build web components, pages, or applications. Generates creative, polished code that avoids generic AI aesthetics.
license: Complete terms in LICENSE.txt
---

This skill guides creation of distinctive, production-grade frontend interfaces that avoid generic "AI slop" aesthetics. Implement real working code with exceptional attention to aesthetic details and creative choices.

The user provides frontend requirements: a component, page, application, or interface to build. They may include context about the purpose, audience, or technical constraints.

## Design Thinking

Before coding, understand the context and commit to a BOLD aesthetic direction:
- **Purpose**: What problem does this interface solve? Who uses it?
- **Tone**: Pick an extreme: brutally minimal, maximalist chaos, retro-futuristic, organic/natural, luxury/refined, playful/toy-like, editorial/magazine, brutalist/raw, art deco/geometric, soft/pastel, industrial/utilitarian, etc. There are so many flavors to choose from. Use these for inspiration but design one that is true to the aesthetic direction.
- **Constraints**: Technical requirements (framework, performance, accessibility).
- **Differentiation**: What makes this UNFORGETTABLE? What's the one thing someone will remember?

**CRITICAL**: Choose a clear conceptual direction and execute it with precision. Bold maximalism and refined minimalism both work - the key is intentionality, not intensity.

Then implement working code (HTML/CSS/JS, React, Vue, etc.) that is:
- Production-grade and functional
- Visually striking and memorable
- Cohesive with a clear aesthetic point-of-view
- Meticulously refined in every detail

## Frontend Aesthetics Guidelines

Focus on:
- **Typography**: Choose fonts that are beautiful, unique, and interesting. Avoid generic fonts like Arial and Inter; opt instead for distinctive choices that elevate the frontend's aesthetics; unexpected, characterful font choices. Pair a distinctive display font with a refined body font.
- **Color & Theme**: Commit to a cohesive aesthetic. Use CSS variables for consistency. Dominant colors with sharp accents outperform timid, evenly-distributed palettes.
- **Motion**: Use animations for effects and micro-interactions. Prioritize CSS-only solutions for HTML. Use Motion library for React when available. Focus on high-impact moments: one well-orchestrated page load with staggered reveals (animation-delay) creates more delight than scattered micro-interactions. Use scroll-triggering and hover states that surprise.
- **Spatial Composition**: Unexpected layouts. Asymmetry. Overlap. Diagonal flow. Grid-breaking elements. Generous negative space OR controlled density.
- **Backgrounds & Visual Details**: Create atmosphere and depth rather than defaulting to solid colors. Add contextual effects and textures that match the overall aesthetic. Apply creative forms like gradient meshes, noise textures, geometric patterns, layered transparencies, dramatic shadows, decorative borders, custom cursors, and grain overlays.

NEVER use generic AI-generated aesthetics like overused font families (Inter, Roboto, Arial, system fonts), cliched color schemes (particularly purple gradients on white backgrounds), predictable layouts and component patterns, and cookie-cutter design that lacks context-specific character.

Interpret creatively and make unexpected choices that feel genuinely designed for the context. No design should be the same. Vary between light and dark themes, different fonts, different aesthetics. NEVER converge on common choices (Space Grotesk, for example) across generations.

**IMPORTANT**: Match implementation complexity to the aesthetic vision. Maximalist designs need elaborate code with extensive animations and effects. Minimalist or refined designs need restraint, precision, and careful attention to spacing, typography, and subtle details. Elegance comes from executing the vision well.

Remember: Claude is capable of extraordinary creative work. Don't hold back, show what can truly be created when thinking outside the box and committing fully to a distinctive vision.



## Design Patterns Reference

This reference defines what TO do and what NOT to do when creating frontend interfaces. These patterns fight against model bias—the tendency of LLMs to converge on the same predictable choices.

### What TO Do (Patterns)

Focus on intentional, distinctive design choices:

**Typography**:
- Use a modular type scale (1.2, 1.25, 1.333, 1.5 ratios)
- Pair a distinctive display font with a refined body font
- Establish clear hierarchy through weight, size, and spacing
- Set body text at 16-18px minimum for readability
- Use proper line heights (1.4-1.6 for body, tighter for headings)

**Color & Contrast**:
- Build palettes from a dominant color with intentional accents
- Use off-whites and near-blacks for softer, sophisticated feel
- Meet WCAG AA contrast (4.5:1 text, 3:1 UI elements)
- Create semantic color tokens (success, warning, error, info)
- Test with color blindness simulators

**Layout & Space**:
- Use a spacing scale (4, 8, 12, 16, 24, 32, 48, 64, 96)
- Create visual rhythm through varied spacing
- Let content breathe with generous whitespace
- Use asymmetry and unexpected compositions
- Break the grid intentionally for emphasis

**Motion**:
- Animate with purpose (guide attention, confirm actions)
- Use 150-300ms for micro-interactions
- Prefer transform and opacity (GPU-accelerated)
- Respect prefers-reduced-motion preferences
- Stagger reveals for orchestrated page loads

**Interaction**:
- Design clear, visible focus indicators
- Make touch targets at least 44×44px
- Provide immediate feedback for all actions
- Write specific, helpful error messages
- Support keyboard, mouse, and touch equally

**Responsive**:
- Design mobile-first, enhance for larger screens
- Use fluid typography (clamp for smooth scaling)
- Ensure all functionality works across devices
- Test landscape orientation on mobile
- Consider device capabilities (not just screen size)

### What NOT to Do (Anti-Patterns)

These patterns create generic "AI slop" aesthetics:

**Typography**:
- Don't use more than 2-3 font families
- Don't use decorative fonts for body text
- Don't implement arbitrary font sizes without a scale
- Don't sacrifice readability for aesthetic novelty
- Don't skip fallback font definitions

**Color & Contrast**:
- Don't use gray text on colored backgrounds
- Don't rely on color alone to convey information
- Don't use pure gray, pure black (#000), or pure white (#fff) - add subtle color tint
- Don't create palettes with arbitrary color choices
- Don't ignore color blindness (8% of men)

**Layout & Space**:
- Don't wrap everything in cards
- Don't nest cards inside cards
- Don't make all spacing equal (variety creates hierarchy)
- Don't forget white space is a design element
- Don't create hierarchy through size alone

**Motion**:
- Don't animate without purpose
- Don't use durations over 500ms for UI feedback
- Don't animate layout properties (width, height, padding, margin) - use transform instead
- Don't use bounce or elastic easing - they feel dated and tacky; use ease-out-quart/quint/expo
- Don't ignore prefers-reduced-motion

**Interaction**:
- Don't remove focus indicators without alternatives
- Don't use placeholder text as labels
- Don't make touch targets smaller than 44×44px
- Don't show generic error messages
- Don't repeat the same information (redundant headers, intro restating heading, etc.)

**Responsive**:
- Don't design desktop-first and cram into mobile
- Don't hide critical functionality on mobile
- Don't use device detection over feature detection
- Don't forget about landscape orientation
- Don't assume all mobile devices are powerful

These anti-patterns are baked into training data from countless generic templates. Without explicit guidance, AI reproduces them. This skill ensures your AI knows both what to do AND what to avoid.


---

## Domain Reference Files

For deeper expertise in specific design domains, consult these reference files:

### Typography
For type systems, font selection, readability, and typographic hierarchy.
**See**: [reference/typography.md](reference/typography.md)

### Color & Contrast
For color systems, palettes, accessibility, theming, and WCAG compliance.
**See**: [reference/color-and-contrast.md](reference/color-and-contrast.md)

### Spatial Design
For spacing systems, grids, visual hierarchy, and composition.
**See**: [reference/spatial-design.md](reference/spatial-design.md)

### Responsive Design
For mobile-first layouts, breakpoints, fluid design, and cross-device adaptation.
**See**: [reference/responsive-design.md](reference/responsive-design.md)

### Interaction Design
For forms, states, feedback patterns, keyboard navigation, and touch optimization.
**See**: [reference/interaction-design.md](reference/interaction-design.md)

### Motion Design
For animations, micro-interactions, transitions, and performance optimization.
**See**: [reference/motion-design.md](reference/motion-design.md)

### UX Writing
For interface copy, error messages, microcopy, and voice/tone guidelines.
**See**: [reference/ux-writing.md](reference/ux-writing.md)

---

## When to Use Reference Files

- **Quick builds**: Use this main skill file for most frontend work
- **Deep dives**: Consult specific reference files when facing complex challenges in that domain
- **Systematic work**: When building design systems or establishing patterns, reference multiple domain files
- **Troubleshooting**: When something feels "off", check the relevant domain reference for best practices