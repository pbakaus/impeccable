---
patterns:
  - name: Typography
    items:
      - Use a modular type scale (1.2, 1.25, 1.333, 1.5 ratios)
      - Pair a distinctive display font with a refined body font
      - Establish clear hierarchy through weight, size, and spacing
      - Set body text at 16-18px minimum for readability
      - Use proper line heights (1.4-1.6 for body, tighter for headings)
  - name: Color & Contrast
    items:
      - Build palettes from a dominant color with intentional accents
      - Use off-whites and near-blacks for softer, sophisticated feel
      - Meet WCAG AA contrast (4.5:1 text, 3:1 UI elements)
      - Create semantic color tokens (success, warning, error, info)
      - Test with color blindness simulators
  - name: Layout & Space
    items:
      - Use a spacing scale (4, 8, 12, 16, 24, 32, 48, 64, 96)
      - Create visual rhythm through varied spacing
      - Let content breathe with generous whitespace
      - Use asymmetry and unexpected compositions
      - Break the grid intentionally for emphasis
  - name: Motion
    items:
      - Animate with purpose (guide attention, confirm actions)
      - Use 150-300ms for micro-interactions
      - Prefer transform and opacity (GPU-accelerated)
      - Respect prefers-reduced-motion preferences
      - Stagger reveals for orchestrated page loads
  - name: Interaction
    items:
      - Design clear, visible focus indicators
      - Make touch targets at least 44×44px
      - Provide immediate feedback for all actions
      - Write specific, helpful error messages
      - Support keyboard, mouse, and touch equally
  - name: Responsive
    items:
      - Design mobile-first, enhance for larger screens
      - Use fluid typography (clamp for smooth scaling)
      - Ensure all functionality works across devices
      - Test landscape orientation on mobile
      - Consider device capabilities (not just screen size)
antipatterns:
  - name: Typography
    items:
      - Don't use more than 2-3 font families
      - Don't use decorative fonts for body text
      - Don't implement arbitrary font sizes without a scale
      - Don't sacrifice readability for aesthetic novelty
      - Don't skip fallback font definitions
  - name: Color & Contrast
    items:
      - Don't use gray text on colored backgrounds
      - Don't rely on color alone to convey information
      - Don't use pure black (#000) or white (#fff) for large areas
      - Don't create palettes with arbitrary color choices
      - Don't ignore color blindness (8% of men)
  - name: Layout & Space
    items:
      - Don't wrap everything in cards
      - Don't nest cards inside cards
      - Don't make all spacing equal (variety creates hierarchy)
      - Don't forget white space is a design element
      - Don't create hierarchy through size alone
  - name: Motion
    items:
      - Don't animate without purpose
      - Don't use durations over 500ms for UI feedback
      - Don't animate layout properties (width, height, padding, margin) - they trigger reflows and can cause text wrapping mid-animation; use transform instead
      - Don't ignore prefers-reduced-motion
      - Don't use animation to hide slow loading
  - name: Interaction
    items:
      - Don't remove focus indicators without alternatives
      - Don't use placeholder text as labels
      - Don't make touch targets smaller than 44×44px
      - Don't show generic error messages
      - Don't design only for mouse/pointer
  - name: Responsive
    items:
      - Don't design desktop-first and cram into mobile
      - Don't hide critical functionality on mobile
      - Don't use device detection over feature detection
      - Don't forget about landscape orientation
      - Don't assume all mobile devices are powerful
---

## Design Patterns Reference

This reference defines what TO do and what NOT to do when creating frontend interfaces. These patterns fight against model bias—the tendency of LLMs to converge on the same predictable choices.

### What TO Do (Patterns)

Focus on intentional, distinctive design choices:

**Typography**: Use a modular type scale with a distinctive display font paired with a refined body font. Establish clear hierarchy through weight, size, and spacing—not size alone.

**Color**: Build palettes from a dominant color with sharp accents. Use off-whites and near-blacks for sophistication. Always meet WCAG AA contrast requirements.

**Space**: Use a spacing scale (4, 8, 12, 16, 24, 32, 48, 64, 96). Create visual rhythm through varied spacing. Let content breathe. Break the grid intentionally.

**Motion**: Animate with purpose—guide attention and confirm actions. Use 150-300ms for micro-interactions. Prefer transform and opacity. Stagger reveals for orchestrated page loads.

**Interaction**: Design clear focus indicators. Make touch targets 44×44px minimum. Provide immediate feedback. Write specific, helpful error messages.

**Responsive**: Design mobile-first. Use fluid typography with clamp(). Ensure all functionality works across devices.

### What NOT to Do (Anti-Patterns)

These patterns create generic "AI slop" aesthetics:

**Generic Visuals**: Defaulting to Inter/Roboto/Arial, purple-to-blue gradients on white, wrapping everything in rounded cards, decorative shadows without purpose.

**Structural Issues**: Arbitrary spacing without a scale, hierarchy through size alone, equal spacing everywhere, cards nested inside cards.

**Interaction Failures**: Removing focus outlines without alternatives, placeholder text as labels, touch targets under 44×44px, generic "Something went wrong" errors.

**Accessibility Violations**: Color-only meaning, ignoring prefers-reduced-motion, failing WCAG contrast, creating keyboard traps.

These anti-patterns are baked into training data from countless generic templates. Without explicit guidance, AI reproduces them. This skill ensures your AI knows both what to do AND what to avoid.
