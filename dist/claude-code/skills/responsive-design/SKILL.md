---
name: responsive-design
description: Create responsive interfaces that adapt beautifully across devices, screen sizes, and input methods. Use this skill when building mobile-first layouts, defining breakpoint strategies, or optimizing for touch. Produces fluid, performant experiences that feel native to each device while maintaining consistency.
license: Complete terms in LICENSE.txt
---

This skill guides the creation of responsive interfaces that adapt beautifully across devices, screen sizes, input methods, and usage contexts.

The user provides a responsive design challenge: building mobile-first layouts, defining breakpoint strategies, optimizing for touch vs pointer, creating fluid designs, or solving specific cross-device problems. They may include device requirements, constraints, or specific adaptation challenges.

## Responsive Design Thinking

Before implementing, understand the multi-device context:

- **Device Landscape**: Which devices matter? (Mobile, tablet, desktop, TV, watch?) What's the primary device?
- **Usage Context**: How do usage patterns differ by device? (On-the-go mobile vs focused desktop work)
- **Input Methods**: Touch, pointer, keyboard, voice, gamepad - what input methods need support?
- **Network Conditions**: Fast wifi vs slow 3G - how does this impact design decisions?
- **Content Priority**: What's essential on all devices vs optional on larger screens?

**CRITICAL**: Responsive design is not just about scaling - it's about adapting the experience appropriately for each context.

Then build responsive systems that are:
- Mobile-first with progressive enhancement
- Fluid and adaptable across viewport sizes
- Optimized for different input methods
- Performant on constrained devices
- Contextually appropriate

## Mobile-First Methodology

### Why Mobile-First

[TO BE DEVELOPED: Progressive enhancement, performance benefits, forces priority decisions, mobile usage dominance]

### Mobile-First Implementation

[TO BE DEVELOPED: Start with mobile styles, add complexity with min-width media queries, content-first approach]

## Breakpoint Strategies

### Choosing Breakpoints

[TO BE DEVELOPED: Content-driven vs device-driven, common breakpoint values, in-between states, avoiding too many breakpoints]

### Breakpoint Architecture

[TO BE DEVELOPED: Named breakpoints, breakpoint tokens, consistent usage across codebase]

## Fluid & Adaptive Design

### Fluid Typography

[TO BE DEVELOPED: clamp(), viewport units, fluid type scales, maintaining readability]

### Fluid Spacing

[TO BE DEVELOPED: Responsive spacing scales, container-relative spacing, clamp() for margins/padding]

### Fluid Layouts

[TO BE DEVELOPED: CSS Grid auto-fit/auto-fill, flexible columns, aspect-ratio, fluid containers]

### Container Queries

[TO BE DEVELOPED: Component-level responsiveness, when to use vs media queries, polyfills]

## Layout Adaptation Patterns

### Navigation Patterns

[TO BE DEVELOPED: Mobile hamburger/drawer, tablet side panel, desktop persistent nav, bottom nav bars]

### Content Reflow

[TO BE DEVELOPED: Single column → multi-column, stacking orders, priority content first]

### Component Adaptation

[TO BE DEVELOPED: Tabs → accordion, horizontal → vertical, show/hide patterns, progressive disclosure]

## Touch vs Pointer Optimization

### Touch Target Sizing

[TO BE DEVELOPED: 44x44px minimum, spacing between targets, thumb zones, edge cases]

### Touch-Specific Interactions

[TO BE DEVELOPED: Swipe gestures, pull-to-refresh, long press, avoiding hover-dependent patterns]

### Hybrid Devices

[TO BE DEVELOPED: Supporting both touch and pointer, feature detection, adaptive interfaces]

## Viewport & Screen Considerations

### Viewport Meta Tag

[TO BE DEVELOPED: Proper viewport configuration, zoom control, initial scale]

### Safe Areas

[TO BE DEVELOPED: iPhone notch, rounded corners, system UI insets, padding for safe areas]

### Orientation Handling

[TO BE DEVELOPED: Portrait vs landscape, orientation-specific layouts, testing both orientations]

### High-DPI Screens

[TO BE DEVELOPED: Retina images, 2x/3x assets, SVG for icons, responsive images]

## Responsive Images & Media

### Responsive Images

[TO BE DEVELOPED: srcset, sizes, picture element, art direction, lazy loading]

### Video Adaptation

[TO BE DEVELOPED: Responsive video embeds, bandwidth considerations, poster images]

## Performance on Mobile

### Mobile Performance Budget

[TO BE DEVELOPED: Constrained CPU/memory, slow connections, battery concerns]

### Loading Strategies

[TO BE DEVELOPED: Critical path optimization, lazy loading, code splitting for mobile]

## Testing Strategies

### Device Testing

[TO BE DEVELOPED: Real device testing, browser DevTools, emulators, viewport testing]

### Testing Checklist

[TO BE DEVELOPED: Different viewports, orientations, input methods, connection speeds]

---

**IMPORTANT**: Test on real devices, not just DevTools. Device emulation is useful but misses real-world constraints.

**NEVER**:
- Design desktop-first and try to cram into mobile
- Hide critical functionality on mobile
- Use device detection instead of feature detection
- Create separate mobile/desktop codebases (maintain one responsive codebase)
- Ignore landscape orientation
- Use fixed pixel values without considering smaller/larger screens
- Forget about tablet (it's not just big phone or small desktop)
- Assume all mobile devices are powerful (many users have older devices)

Remember: Responsive design is about creating experiences that work everywhere while feeling native nowhere. Adapt intelligently for context while maintaining consistency.