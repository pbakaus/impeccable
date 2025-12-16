---
patterns:
  - name: Typography
    items:
      - Use a modular type scale (1.2, 1.25, 1.333, 1.5 ratios)
      - Pair a distinctive display font with a refined body font
      - Set body text at 16-18px minimum for readability
      - Use proper line heights (1.4-1.6 for body, tighter for headings)
  - name: Color & Contrast
    items:
      - Build palettes from a dominant color with intentional accents
      - Use off-whites and near-blacks for softer, sophisticated feel
  - name: Layout & Space
    items:
      - Use a spacing scale (4, 8, 12, 16, 24, 32, 48, 64, 96)
      - Create visual rhythm through varied spacing
      - Use asymmetry and unexpected compositions
      - Break the grid intentionally for emphasis
  - name: Motion
    items:
      - Use 150-300ms for micro-interactions
      - Prefer transform and opacity (GPU-accelerated)
      - Stagger reveals for orchestrated page loads
  - name: Interaction
    items:
      - Write specific, helpful error messages
  - name: Responsive
    items:
      - Use fluid typography (clamp for smooth scaling)
      - Test landscape orientation on mobile
      - Consider device capabilities (not just screen size)
antipatterns:
  - name: Typography
    items:
      - Don't implement arbitrary font sizes without a scale
  - name: Color & Contrast
    items:
      - Don't use gray text on colored backgrounds
      - Don't use pure gray, pure black (#000), or pure white (#fff) - add subtle color tint
      - Don't create palettes with arbitrary color choices
  - name: Layout & Space
    items:
      - Don't wrap everything in cards
      - Don't nest cards inside cards
      - Don't make all spacing equal (variety creates hierarchy)
      - Don't create hierarchy through size alone
  - name: Motion
    items:
      - Don't use durations over 500ms for UI feedback
      - Don't animate layout properties (width, height, padding, margin) - use transform instead
      - Don't use bounce or elastic easing - they feel dated and tacky; use ease-out-quart/quint/expo
  - name: Interaction
    items:
      - Don't use placeholder text as labels
      - Don't show generic error messages
      - Don't repeat the same information (redundant headers, intro restating heading, etc.)
  - name: Responsive
    items:
      - Don't hide critical functionality on mobile
      - Don't use device detection over feature detection
      - Don't forget about landscape orientation
---
