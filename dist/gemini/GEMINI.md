# Gemini Context

This repository contains specialized skills for different tasks. When you detect a user request in a particular domain, the corresponding skill file will be automatically loaded to provide detailed guidance.

## Available Skills

Each skill provides deep expertise in its domain. The skills below are automatically imported and will guide your responses:

### ux-writing

**When to use**: Write clear, helpful, and human interface copy that users understand immediately. Use this skill when crafting microcopy, improving error messages, or establishing voice and tone. Produces concise, empathetic copy that guides users confidently through tasks without confusion or frustration.

@./GEMINI.ux-writing.md

### spatial-design

**When to use**: Master spatial design balancing systematic precision with artistic composition. Use this skill when building spacing systems, establishing grids, or improving visual hierarchy. Creates systematically organized layouts with compelling visual hierarchy and intentional spatial relationships.

@./GEMINI.spatial-design.md

### motion-design

**When to use**: Create purposeful motion that enhances usability and provides feedback without sacrificing performance. Use this skill when adding animations, building micro-interactions, or establishing motion systems. Produces smooth, delightful animations that guide attention and reinforce interactions while maintaining 60fps performance.

@./GEMINI.motion-design.md

### typography

**When to use**: Master typography systems that balance timeless principles with modern web capabilities. Use this skill when building type systems, improving readability, or establishing typographic hierarchy. Creates readable, systematically coherent typography that is both performant and aesthetically distinctive.

@./GEMINI.typography.md

### frontend-design

**When to use**: Create distinctive, production-grade frontend interfaces with high design quality. Use this skill when the user asks to build web components, pages, or applications. Generates creative, polished code that avoids generic AI aesthetics.

@./GEMINI.frontend-design.md

### interaction-design

**When to use**: Design intuitive interaction patterns that feel natural and provide clear feedback. Use this skill when building interactive components, designing forms, or establishing interaction standards. Creates accessible, forgiving interfaces where every state is clear and every action provides immediate feedback.

@./GEMINI.interaction-design.md

### color-and-contrast

**When to use**: Build sophisticated color systems balancing aesthetics with accessibility and function. Use this skill when establishing brand palettes, implementing theming, or ensuring WCAG compliance. Produces beautiful, accessible color implementations with systematic coherence across all theme variants.

@./GEMINI.color-and-contrast.md

### responsive-design

**When to use**: Create responsive interfaces that adapt beautifully across devices, screen sizes, and input methods. Use this skill when building mobile-first layouts, defining breakpoint strategies, or optimizing for touch. Produces fluid, performant experiences that feel native to each device while maintaining consistency.

@./GEMINI.responsive-design.md


## How Skills Work

1. Skills are automatically loaded via the import statements above
2. When a user request matches a skill domain, apply that skill's guidance
3. Multiple skills can be combined when the task requires expertise from different domains
4. Follow the detailed instructions provided in each imported skill file