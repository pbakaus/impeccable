---
name: motion-design
description: Create purposeful motion that enhances usability and provides feedback without sacrificing performance. Use this skill when adding animations, building micro-interactions, or establishing motion systems. Produces smooth, delightful animations that guide attention and reinforce interactions while maintaining 60fps performance.
license: Complete terms in LICENSE.txt
---

This skill guides the creation of motion design that enhances usability, provides feedback, and creates delight - without sacrificing performance or accessibility.

The user provides a motion challenge: adding animations to components, improving interaction feedback, building page transitions, creating micro-interactions, or establishing motion design systems. They may include performance constraints, aesthetic goals, or specific interaction problems to solve.

## Motion Design Thinking

Before animating anything, understand the purpose and context:

- **Purpose**: Why animate? Feedback? Delight? Guidance? Branding? Every animation needs a reason beyond "it looks cool."
- **Personality**: What character should motion convey? Snappy and energetic? Smooth and luxurious? Playful and bouncy? Subtle and refined?
- **Performance Budget**: Mobile devices? Complex pages? Can we afford GPU-intensive animations?
- **Accessibility**: Motion sensitivity, vestibular disorders, reduced motion preferences - some users need minimal animation.

**CRITICAL**: Animation should enhance understanding and usability, not obscure it. When in doubt, be subtle. Users notice janky animation more than no animation.

Then implement motion that is:
- Purposeful with clear functional or emotional goals
- Performant with smooth 60fps execution
- Accessible with reduced motion alternatives
- Choreographed with thoughtful timing and sequencing

## Classic Animation Principles

### Disney's 12 Principles (Web Context)

[TO BE DEVELOPED: Squash and stretch, anticipation, staging, follow-through, ease-in/ease-out, arcs, secondary action, timing, exaggeration, solid drawing, appeal - adapted for UI]

### Timing & Duration

[TO BE DEVELOPED: Micro-interactions (100-300ms), transitions (300-500ms), complex animations (500-1000ms), duration by distance, perceived speed]

### Easing & Curves

[TO BE DEVELOPED: Linear vs eased, ease-out (enter), ease-in (exit), ease-in-out (full cycle), custom cubic-bezier, spring physics]

## Types of UI Animation

### Micro-interactions

[TO BE DEVELOPED: Button feedback, hover states, toggle switches, like buttons, form validation feedback, loading indicators]

### Page Transitions

[TO BE DEVELOPED: Route transitions, modal entry/exit, drawer animations, cross-fade, slide, zoom patterns]

### State Transitions

[TO BE DEVELOPED: Loading → success → error flows, expand/collapse, show/hide, enable/disable state changes]

### Scrolling & Parallax

[TO BE DEVELOPED: Scroll-triggered animations, reveal on scroll, parallax layers, scroll-linked effects, intersection observer]

## Choreography & Sequencing

### Staggered Animations

[TO BE DEVELOPED: animation-delay patterns, sequential reveals, cascade effects, list item staggering]

### Orchestrated Page Loads

[TO BE DEVELOPED: Entry choreography, hero → content → details, creating narrative through sequence, attention management]

### Exit Choreography

[TO BE DEVELOPED: Reverse sequences, intentional exit timing, maintaining spatial relationships during exit]

## Technical Implementation

### CSS-Only Animation

[TO BE DEVELOPED: @keyframes, animation properties, transitions, transform, pseudo-element animations, hardware acceleration]

### JavaScript Animation

[TO BE DEVELOPED: Web Animations API, requestAnimationFrame, animation libraries (GSAP, Framer Motion, Motion One)]

### Performance Optimization

[TO BE DEVELOPED: GPU acceleration (transform, opacity only), will-change, avoiding layout thrashing, reducing paint, FPS monitoring]

## Motion Design Systems

### Motion Tokens

[TO BE DEVELOPED: Duration scales, easing tokens, named animations, consistent motion vocabulary]

### Reduced Motion

[TO BE DEVELOPED: prefers-reduced-motion, graceful degradation, essential vs decorative animation, crossfade alternatives]

---

**IMPORTANT**: One well-orchestrated page load with staggered reveals creates more delight than scattered micro-interactions everywhere. Focus on high-impact moments.

**NEVER**:
- Animate everything (animation fatigue is real)
- Use long durations (>500ms) for UI feedback (users will perceive lag)
- Animate layout properties (width, height, top, left) - use transform instead
- Ignore prefers-reduced-motion (accessibility requirement)
- Use animation to hide slow loading (fix the loading time)
- Animate without purpose (every animation should answer "why?")
- Create animations that obscure content or block interaction

Remember: Motion is powerful - it can guide attention, provide feedback, and create emotional connection. Use it thoughtfully, not reflexively.