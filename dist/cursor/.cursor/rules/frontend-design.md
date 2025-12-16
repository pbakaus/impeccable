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

---

## Reference: ux-writing

# UX Writing

This reference guides the creation of interface copy that is clear, concise, helpful, and human - the words that make products understandable and usable.

The user provides a UX writing challenge: writing microcopy, improving error messages, crafting instructions, establishing voice and tone, or fixing unclear interface text. They may include brand guidelines, audience context, or specific copy problems to solve.

## UX Writing Thinking

Before writing, understand the context and user needs:

- **User Context**: What are users trying to accomplish? What's their emotional state? What do they already know?
- **Content Purpose**: Inform? Guide? Reassure? Warn? Celebrate? Different moments need different approaches.
- **Brand Voice**: Professional? Casual? Playful? Technical? Voice should match brand and audience.
- **Constraints**: Character limits, space limitations, translation considerations, accessibility requirements.

**CRITICAL**: Good UX writing is invisible - users understand immediately without noticing the words. Bad UX writing creates confusion and frustration.

Then write copy that is:
- Clear and immediately understandable
- Concise without sacrificing clarity
- Helpful and action-oriented
- Human and empathetic
- Consistent in terminology and tone

## The Button Label Problem

**Never use "OK", "Submit", or "Yes/No".** These are lazy and ambiguous. Use specific verb + object patterns:

| Bad | Good | Why |
|-----|------|-----|
| OK | Save changes | Says what will happen |
| Submit | Create account | Outcome-focused |
| Yes | Delete message | Confirms the action |
| Cancel | Keep editing | Clarifies what "cancel" means |
| Click here | Download PDF | Describes the destination |

**For destructive actions**, name the destruction:
- "Delete" not "Remove" (delete is permanent, remove implies recoverable)
- "Delete 5 items" not "Delete selected" (show the count)

## Error Messages: The Formula

Every error message should answer three questions:

1. **What happened?** (Clearly state the problem)
2. **Why?** (If not obvious)
3. **How to fix it?** (Specific action)

```
Bad:  "Invalid input"

Good: "Email address isn't valid. Please include an @ symbol."

Bad:  "Request failed"

Good: "We couldn't save your changes. Check your internet connection and try again."
```

### Error Message Templates

| Situation | Template |
|-----------|----------|
| **Format error** | "[Field] needs to be [format]. Example: [example]" |
| **Missing required** | "Please enter [what's missing]" |
| **Permission denied** | "You don't have access to [thing]. [What to do instead]" |
| **Network error** | "We couldn't reach [thing]. Check your connection and [action]." |
| **Server error** | "Something went wrong on our end. We're looking into it. [Alternative action]" |

### Don't Blame the User

```
Bad:  "You entered an invalid date"
Good: "Please enter a date in MM/DD/YYYY format"

Bad:  "Your password is too weak"
Good: "Add at least one number or symbol to strengthen your password"
```

## Empty States Are Opportunities

An empty list isn't a dead end—it's an onboarding moment.

```
Bad:  "No items"

Good: "No projects yet
       Projects help you organize your work. Create your first one to get started.
       [+ Create project]"
```

**Empty state formula**:
1. Acknowledge the emptiness (briefly)
2. Explain the value of filling it
3. Provide a clear action

## Voice vs Tone

**Voice** is your brand's personality—consistent everywhere.
**Tone** adapts to the moment.

| Moment | Tone Shift |
|--------|------------|
| Success | Celebratory, brief: "Done! Your changes are live." |
| Error | Empathetic, helpful: "That didn't work. Here's what to try..." |
| Loading | Reassuring: "Saving your work..." |
| Destructive confirm | Serious, clear: "Delete this project? This can't be undone." |

**Never use humor for errors.** Users are already frustrated. Be helpful, not cute.

## Writing for Accessibility

### Link Text

Screen readers can navigate by links. Vague links fail:

```html
<!-- Bad: meaningless without context -->
<a href="...">Click here</a>
<a href="...">Learn more</a>

<!-- Good: standalone meaning -->
<a href="...">View pricing plans</a>
<a href="...">Learn more about data export</a>
```

### Alt Text

Describe the **information**, not the image:

```html
<!-- Bad: describes image -->
<img alt="Chart" src="revenue.png">

<!-- Good: describes information -->
<img alt="Revenue increased 40% in Q4" src="revenue.png">

<!-- Decorative images get empty alt -->
<img alt="" src="decorative-wave.png">
```

### Button Context

Buttons need context, especially icons:

```html
<!-- Bad: no context -->
<button>×</button>

<!-- Good: screen reader context -->
<button aria-label="Close dialog">×</button>
```

## Writing for Translation

### Plan for Expansion

German text is ~30% longer than English. Allocate space:

| Language | Expansion |
|----------|-----------|
| German | +30% |
| French | +20% |
| Finnish | +30-40% |
| Chinese | -30% (fewer chars, but same width) |

### Translation-Friendly Patterns

```
Bad:  "You have 3 new messages"  (number inside sentence)
Good: "New messages: 3"          (number separate)

Bad:  "Welcome back, {name}!"    (word order varies by language)
Good: "{greeting_message}"       (full sentence as one string)

Bad:  "5 mins ago"               (abbrev doesn't translate)
Good: "5 minutes ago"            (full word)
```

### Give Translators Context

```json
{
  "delete_confirm": {
    "message": "Delete {item}?",
    "context": "Confirmation dialog when deleting a file or folder. {item} is the name of the item being deleted."
  }
}
```

## Consistency: The Terminology Problem

Pick one term and stick with it:

| Inconsistent | Consistent |
|--------------|------------|
| Delete / Remove / Trash | Delete |
| Settings / Preferences / Options | Settings |
| Sign in / Log in / Enter | Sign in |
| Create / Add / New | Create |

Build a terminology glossary and enforce it. Variety creates confusion.

## Avoid Redundant Copy

Saying the same thing twice wastes space and dilutes impact.

**Common redundancies**:
- Section header + intro paragraph saying the same thing
- Page title + section title with same/similar text
- CTA button + surrounding text repeating the action
- Outro that restates the intro

```
Bad:  "Settings"
      "Here you can adjust your settings and preferences."
      [Settings form]
      "Save your settings to apply changes."

Good: "Settings"
      [Settings form]
      [Save]
```

**The rule**: If the heading explains it, the intro is redundant. If the button is clear, don't explain it again. Say it once, say it well.

## Loading States

Tell users what's happening:

```
Bad:  "Loading..."
Good: "Saving your draft..."

Bad:  [spinner]
Good: "Searching 1,247 documents..."

Bad:  "Please wait"
Good: "Preparing your download... This usually takes 30 seconds."
```

For long waits, show progress or set expectations.

## Confirmation Dialogs: Use Sparingly

**Most confirmation dialogs are design failures.** If an action is dangerous enough to confirm, consider:
- Undo instead of confirm
- Making the action less destructive
- Showing consequences before the action

When you must confirm:

```
Bad:  "Are you sure?"
      [Yes] [No]

Good: "Delete 'Project Alpha'?
       This will permanently delete the project and all its files.
       [Delete project] [Keep project]"
```

Name the action, explain consequences, use specific button labels.

## Form Instructions

### Format Hints

Show don't tell:

```
Bad:  "Enter date in MMDDYYYY format"
Good: "Date of birth" + placeholder="04/15/1990"
```

### Why Are You Asking?

For non-obvious fields, explain:

```html
<label>Phone number (optional)</label>
<span class="help">We'll only use this to contact you about your order.</span>
```

---

**IMPORTANT**: Read your copy out loud. If it sounds awkward or robotic, rewrite until it sounds human.

**NEVER**:
- Use jargon without explanation
- Blame users ("You made an error" → "This field is required")
- Be vague ("Something went wrong" - explain what!)
- Use passive voice unnecessarily
- Vary terminology for variety (consistency matters)
- Write overly long explanations (be concise)
- Use humor for errors (be empathetic)
- Assume technical knowledge
- Use all caps (except acronyms)
- End questions with periods (use question marks)

Remember: You're a clarity expert and empathetic communicator. Write like you're helping a friend who's smart but unfamiliar with your product. Be clear, be helpful, be human.


---

## Reference: spatial-design

# Spatial Design

This reference guides the creation of spatial systems that balance mathematical precision with artistic composition, ensuring interfaces are both systematically organized and visually compelling.

The user provides a layout challenge: building spacing systems, establishing grids, improving visual hierarchy, fixing composition issues, or implementing responsive layouts. They may include design system constraints, aesthetic goals, or specific spatial problems to solve.

## Spatial Design Thinking

Before arranging elements, understand the compositional strategy:

- **Content Priority**: What's most important? What should users see first, second, third? Hierarchy starts here.
- **Visual Weight Distribution**: Where should the eye go? Balanced or intentionally unbalanced? Symmetrical or asymmetric?
- **Density vs Breathing Room**: Controlled density (information-rich) or generous space (editorial)? Match context and audience.
- **Reading Patterns**: Z-pattern (scanning), F-pattern (text-heavy), focal point (marketing), free-form (experimental)?

**CRITICAL**: Space is not empty - it's an active design element. Negative space gives positive elements room to breathe and meaning.

Then build layout systems that are:
- Systematically consistent with clear spacing rules
- Visually balanced with intentional hierarchy
- Responsive and adaptive across viewports
- Compositionally strong with clear focal points

## Spacing Systems

### Use 4pt Base, Not 8pt

8pt systems are too coarse. **4pt gives you the granularity you actually need:**

```css
:root {
  --space-1: 4px;    /* 0.25rem - tight */
  --space-2: 8px;    /* 0.5rem */
  --space-3: 12px;   /* 0.75rem */
  --space-4: 16px;   /* 1rem - base */
  --space-6: 24px;   /* 1.5rem */
  --space-8: 32px;   /* 2rem */
  --space-12: 48px;  /* 3rem */
  --space-16: 64px;  /* 4rem */
  --space-24: 96px;  /* 6rem - section gaps */
}
```

**The insight**: You'll frequently need 12px (between 8 and 16). An 8pt-only system forces awkward choices.

### Name Tokens by Relationship, Not Value

```css
/* Bad: tied to pixels */
--spacing-8: 8px;
--spacing-16: 16px;

/* Better: semantic */
--space-xs: 4px;   /* Tight inline gaps */
--space-sm: 8px;   /* Between related elements */
--space-md: 16px;  /* Component padding */
--space-lg: 24px;  /* Between components */
--space-xl: 48px;  /* Section padding */
--space-2xl: 96px; /* Section margins */
```

### Gap Over Margin

**Stop using margins for spacing between siblings.** Use `gap`:

```css
/* Old way: margins create double-spacing bugs */
.card { margin-bottom: 16px; }
.card:last-child { margin-bottom: 0; } /* Cleanup hack */

/* Modern way: gap just works */
.card-list {
  display: flex;
  flex-direction: column;
  gap: 16px;  /* Automatic, no cleanup needed */
}
```

Gap works in Flexbox and Grid. It's cleaner, more intentional, and eliminates margin collapse headaches.

## Grid Systems

### The Self-Adjusting Grid

This pattern creates responsive grids without breakpoints:

```css
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--space-lg);
}
```

**How it works**: Columns are at least 280px. As many as fit per row. Leftovers stretch. No media queries needed.

**Variation for exact counts:**
```css
/* Always 3 columns on desktop, stack on mobile */
.grid-3 {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr));
  gap: var(--space-lg);
}
```

### Grid Area Naming

For complex layouts, named areas are clearer than line numbers:

```css
.page {
  display: grid;
  grid-template-areas:
    "header header"
    "sidebar main"
    "footer footer";
  grid-template-columns: 280px 1fr;
  grid-template-rows: auto 1fr auto;
}

.header { grid-area: header; }
.sidebar { grid-area: sidebar; }
.main { grid-area: main; }
.footer { grid-area: footer; }
```

At mobile breakpoints, redefine the areas:
```css
@media (max-width: 768px) {
  .page {
    grid-template-areas:
      "header"
      "main"
      "sidebar"
      "footer";
    grid-template-columns: 1fr;
  }
}
```

## Visual Hierarchy

### The Squint Test

Blur your eyes (or screenshot and blur). Can you still identify:
- The most important element?
- The second most important?
- Clear groupings?

If everything looks the same weight blurred, you have a hierarchy problem.

### Hierarchy Through Multiple Dimensions

Don't rely on size alone. Combine:

| Tool | Strong Hierarchy | Weak Hierarchy |
|------|------------------|----------------|
| **Size** | 3:1 ratio or more | <2:1 ratio |
| **Weight** | Bold vs Regular | Medium vs Regular |
| **Color** | High contrast | Similar tones |
| **Position** | Top/left (primary) | Bottom/right |
| **Space** | Surrounded by white space | Crowded |

**The best hierarchy uses 2-3 dimensions at once**: A heading that's larger, bolder, AND has more space above it.

### Cards Are Not Required

Cards (bordered/shadowed containers) are overused. You don't need a card to create visual grouping—spacing and alignment do this naturally.

**Use cards when**:
- Content is truly distinct and actionable (a product, a post, a task)
- Items need to be visually comparable in a grid
- Content needs clear boundaries for interaction (hover, click)

**Don't use cards for**:
- General layout structure (use spacing instead)
- Single items (a lone card looks arbitrary)
- Nesting—**never put cards inside cards**. If you need hierarchy within a card, use spacing, typography, and subtle dividers instead

```css
/* Bad: card in a card */
.outer-card > .inner-card { /* Noisy and confusing */ }

/* Good: hierarchy without nesting */
.card > .card-section { border-top: 1px solid var(--border); }
```

## Container Queries

Viewport queries are for page layouts. **Container queries are for components**:

```css
.card-container {
  container-type: inline-size;
}

.card {
  display: grid;
  gap: var(--space-md);
}

/* Card layout changes based on its container, not viewport */
@container (min-width: 400px) {
  .card {
    grid-template-columns: 120px 1fr;
  }
}
```

**Why this matters**: A card in a narrow sidebar stays compact, while the same card in a main content area expands—automatically, without viewport hacks.

## Optical Adjustments

### Text Doesn't Align

A paragraph set to `margin-left: 0` looks indented because letterforms have internal whitespace. Fix with negative margin or padding:

```css
.heading {
  margin-left: -0.05em;  /* Pull left to optically align */
}
```

### Icons Need Optical Centering

A geometrically centered icon often looks off-center. Play icons need to shift right, left-arrows need to shift left:

```css
.play-button svg {
  transform: translateX(2px);  /* Optical center */
}
```

### Touch Targets vs Visual Size

Buttons can look small but need large touch targets (44px minimum). Use padding or pseudo-elements:

```css
.icon-button {
  width: 24px;  /* Visual size */
  height: 24px;
  position: relative;
}

.icon-button::before {
  content: '';
  position: absolute;
  inset: -10px;  /* Expand tap target to 44px */
}
```

## Depth & Elevation

### Semantic Z-Index

Don't use arbitrary numbers. Create a scale:

```css
:root {
  --z-dropdown: 100;
  --z-sticky: 200;
  --z-modal-backdrop: 300;
  --z-modal: 400;
  --z-toast: 500;
  --z-tooltip: 600;
}
```

### Shadow Scale for Elevation

Shadows indicate elevation. Create a consistent scale:

```css
:root {
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.05);         /* Subtle lift */
  --shadow-md: 0 4px 6px rgba(0,0,0,0.07);         /* Cards */
  --shadow-lg: 0 10px 15px rgba(0,0,0,0.1);        /* Dropdowns */
  --shadow-xl: 0 20px 25px rgba(0,0,0,0.15);       /* Modals */
}
```

**Key insight**: Shadows should be subtle. If you can clearly see the shadow, it's probably too strong.

---

**IMPORTANT**: Systematic spacing doesn't mean boring. Use the system as a foundation, then break it intentionally for impact.

**NEVER**:
- Use arbitrary spacing values outside your scale (unless intentionally breaking the system)
- Create layouts that ignore natural reading patterns without good reason
- Forget that white space is a design element, not wasted space
- Make all spacing equal (variety creates hierarchy)
- Build responsive layouts that only work at breakpoint edges
- Create hierarchy through size alone (combine multiple tools)

Remember: Composition is the invisible structure that makes everything else work. Master the fundamentals, then break rules intentionally.


---

## Reference: motion-design

# Motion Design

This reference guides the creation of motion design that enhances usability, provides feedback, and creates delight - without sacrificing performance or accessibility.

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

## Duration: The 100/300/500 Rule

Timing matters more than easing. These durations feel right for most UI:

| Duration | Use Case | Examples |
|----------|----------|----------|
| **100-150ms** | Instant feedback | Button press, toggle, color change |
| **200-300ms** | State changes | Menu open, tooltip, hover states |
| **300-500ms** | Layout changes | Accordion, modal, drawer |
| **500-800ms** | Entrance animations | Page load, hero reveals |

**Exit animations are faster than entrances.** Users want to see what's leaving—quickly. Use ~75% of the enter duration:
```css
.modal {
  --enter: 400ms;
  --exit: 300ms;
}
```

## Easing: Pick the Right Curve

**Don't use `ease`.** It's a compromise that's rarely optimal. Instead:

| Curve | Use For | CSS |
|-------|---------|-----|
| **ease-out** | Elements entering | `cubic-bezier(0.16, 1, 0.3, 1)` |
| **ease-in** | Elements leaving | `cubic-bezier(0.7, 0, 0.84, 0)` |
| **ease-in-out** | State toggles (there → back) | `cubic-bezier(0.65, 0, 0.35, 1)` |

**For micro-interactions, use exponential curves**—they feel natural because they mimic real physics (friction, deceleration):

```css
/* Quart out - smooth, refined (recommended default) */
--ease-out-quart: cubic-bezier(0.25, 1, 0.5, 1);

/* Quint out - slightly more dramatic */
--ease-out-quint: cubic-bezier(0.22, 1, 0.36, 1);

/* Expo out - snappy, confident */
--ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
```

**Avoid bounce and elastic curves.** They were trendy in 2015 but now feel tacky and amateurish. Real objects don't bounce when they stop—they decelerate smoothly. Overshoot effects draw attention to the animation itself rather than the content.

## The Only Two Properties You Should Animate

**transform** and **opacity**. That's it. Everything else causes layout recalculation or repaints:

```css
/* Good: GPU-accelerated, smooth */
.slide-in {
  transform: translateX(0);
  opacity: 1;
  transition: transform 300ms ease-out, opacity 300ms ease-out;
}
.slide-in.hidden {
  transform: translateX(20px);
  opacity: 0;
}

/* Bad: triggers layout, janky */
.slide-in {
  left: 0;  /* Layout thrashing */
  height: 100%;  /* Expensive */
}
```

**Exceptions**: Sometimes you must animate `height` for accordions. Use `max-height` with a value larger than content, or better yet, use CSS Grid's `grid-template-rows: 0fr → 1fr` trick.

## Staggered Animations

Staggering creates rhythm and direction. The formula:

```css
.list-item {
  animation: fade-in 400ms ease-out both;
}

/* Stagger each item by 50ms */
.list-item:nth-child(1) { animation-delay: 0ms; }
.list-item:nth-child(2) { animation-delay: 50ms; }
.list-item:nth-child(3) { animation-delay: 100ms; }
/* ... */
```

**Better approach with CSS custom property:**

```css
.list-item {
  animation: fade-in 400ms ease-out both;
  animation-delay: calc(var(--i, 0) * 50ms);
}
```
```html
<li class="list-item" style="--i: 0">First</li>
<li class="list-item" style="--i: 1">Second</li>
<li class="list-item" style="--i: 2">Third</li>
```

**Key insight**: Cap the total stagger time. 10 items at 50ms = 500ms before the last item appears. If you have 50 items, reduce to 20ms per item or cap at ~10 staggered items.

## Reduced Motion

This is not optional. Vestibular disorders affect ~35% of adults over 40.

```css
/* Define animations normally */
.card {
  animation: slide-up 500ms ease-out;
}

/* Provide alternative for reduced motion */
@media (prefers-reduced-motion: reduce) {
  .card {
    animation: fade-in 200ms ease-out;  /* Crossfade instead of motion */
  }
}

/* Or disable entirely */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

**What to preserve**: Functional animations like progress bars, loading spinners (slowed down), and focus indicators should still work—just without spatial movement.

## Performance: Avoid These Mistakes

### Don't Use will-change Preemptively

```css
/* Bad: wastes GPU memory */
.card { will-change: transform; }

/* Good: only when animation is imminent */
.card:hover { will-change: transform; }
.card.animating { will-change: transform; }
```

`will-change` forces the browser to create a compositing layer. Used everywhere = memory bloat.

### Don't Animate During Scroll

Scroll-linked animations (parallax, reveal) are expensive. If you must:

```javascript
// Use Intersection Observer, not scroll events
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target); // Animate once, then stop observing
    }
  });
}, { threshold: 0.2 });
```

### Don't Fight the Main Thread

Heavy JavaScript animations block rendering. For complex choreography, use the Web Animations API or a library like Motion One that schedules efficiently.

## Motion Tokens

Create a system for consistency:

```css
:root {
  /* Durations */
  --duration-instant: 100ms;
  --duration-fast: 200ms;
  --duration-normal: 300ms;
  --duration-slow: 500ms;

  /* Easings */
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in: cubic-bezier(0.7, 0, 0.84, 0);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);

  /* Common patterns */
  --transition-fade: opacity var(--duration-fast) var(--ease-out);
  --transition-slide: transform var(--duration-normal) var(--ease-out);
  --transition-all: var(--duration-normal) var(--ease-out);
}
```

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


---

## Reference: typography

# Typography

This reference guides the creation and refinement of typography systems that balance timeless principles with modern web capabilities.

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

### Vertical Rhythm

The non-obvious insight: your line-height should be the base unit for ALL vertical spacing in your design. If body text has `line-height: 1.5` on `16px` type (= 24px), then spacing values should be multiples of 24px: 24, 48, 72, etc.

This creates subconscious harmony. Text and space feel "right" together because they share a mathematical foundation.

```css
:root {
  --baseline: 1.5rem; /* 24px if root is 16px */
  --space-1: var(--baseline);      /* 24px */
  --space-2: calc(var(--baseline) * 2);  /* 48px */
  --space-half: calc(var(--baseline) / 2); /* 12px */
}
```

### Modular Scale & Hierarchy

The common mistake: too many font sizes that are too close together (14px, 15px, 16px, 18px...). This creates muddy hierarchy.

**Use fewer sizes with more contrast.** A 5-size system covers most needs:

| Role | Typical Ratio | Use Case |
|------|---------------|----------|
| xs | 0.75rem | Captions, legal |
| sm | 0.875rem | Secondary UI, metadata |
| base | 1rem | Body text |
| lg | 1.25-1.5rem | Subheadings, lead text |
| xl+ | 2-4rem | Headlines, hero text |

Popular ratios: 1.25 (major third), 1.333 (perfect fourth), 1.5 (perfect fifth). Pick one and commit.

### Readability & Measure

Line length (measure) guidelines are well-known (45-75 characters), but the implementation detail matters:

```css
/* Use ch units for true character-based measure */
.prose { max-width: 65ch; }

/* Line-height scales inversely with line length */
.narrow-column { max-width: 45ch; line-height: 1.4; }
.wide-column { max-width: 75ch; line-height: 1.6; }
```

**Non-obvious**: Increase line-height for light text on dark backgrounds. The perceived weight is lighter, so text needs more breathing room. Add 0.05-0.1 to your normal line-height.

## Font Selection & Pairing

### Choosing Distinctive Fonts

**Avoid the invisible defaults**: Inter, Roboto, Open Sans, Lato, Montserrat. These are everywhere, making your design feel generic. They're fine for documentation or tools where personality isn't the goal—but if you want distinctive design, look elsewhere.

**Better Google Fonts alternatives**:
- Instead of Inter → **Instrument Sans**, **Plus Jakarta Sans**, **Outfit**
- Instead of Roboto → **Onest**, **Figtree**, **Urbanist**
- Instead of Open Sans → **Source Sans 3**, **Nunito Sans**, **DM Sans**
- For editorial/premium feel → **Fraunces**, **Newsreader**, **Lora**

**System fonts are underrated**: `-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui` looks native, loads instantly, and is highly readable. Consider this for apps where performance > personality.

### Pairing Principles

**The non-obvious truth**: You often don't need a second font. One well-chosen font family in multiple weights creates cleaner hierarchy than two competing typefaces. Only add a second font when you need genuine contrast (e.g., display headlines + body serif).

When pairing, contrast on multiple axes:
- Serif + Sans (structure contrast)
- Geometric + Humanist (personality contrast)
- Condensed display + Wide body (proportion contrast)

**Never pair fonts that are similar but not identical** (e.g., two geometric sans-serifs). They create visual tension without clear hierarchy.

### Web Font Loading

The layout shift problem: fonts load late, text reflows, and users see content jump. Here's the fix:

```css
/* 1. Use font-display: swap for visibility */
@font-face {
  font-family: 'CustomFont';
  src: url('font.woff2') format('woff2');
  font-display: swap;
}

/* 2. Match fallback metrics to minimize shift */
@font-face {
  font-family: 'CustomFont-Fallback';
  src: local('Arial');
  size-adjust: 105%;        /* Scale to match x-height */
  ascent-override: 90%;     /* Match ascender height */
  descent-override: 20%;    /* Match descender depth */
  line-gap-override: 10%;   /* Match line spacing */
}

body {
  font-family: 'CustomFont', 'CustomFont-Fallback', sans-serif;
}
```

Tools like [Fontaine](https://github.com/unjs/fontaine) calculate these overrides automatically.

## Modern Web Typography

### Fluid Type

Fluid typography eliminates breakpoint jumps. The formula:

```css
/* font-size: clamp(min, preferred, max) */
h1 { font-size: clamp(2rem, 5vw + 1rem, 4rem); }
```

The `5vw + 1rem` creates smooth scaling. Adjust the vw coefficient for faster/slower scaling.

**When NOT to use fluid type**:
- Button text, labels, UI elements (should be consistent, not fluid)
- Very short text (scaling makes less sense)
- When you need precise control at specific breakpoints

### OpenType Features

Most developers don't know these exist. Use them for polish:

```css
/* Tabular numbers for data alignment */
.data-table { font-variant-numeric: tabular-nums; }

/* Proper fractions */
.recipe-amount { font-variant-numeric: diagonal-fractions; }

/* Small caps for abbreviations */
abbr { font-variant-caps: all-small-caps; }

/* Disable ligatures in code */
code { font-variant-ligatures: none; }

/* Enable kerning (usually on by default, but be explicit) */
body { font-kerning: normal; }
```

Check what features your font supports at [Wakamai Fondue](https://wakamaifondue.com/).

## Typography System Architecture

### Token Structure

**Name tokens semantically, not by value**:

```css
/* Bad: tied to implementation */
--font-size-16: 1rem;
--font-size-24: 1.5rem;

/* Good: tied to purpose */
--font-size-body: 1rem;
--font-size-heading: 1.5rem;
```

A complete token set:

```css
:root {
  /* Font stacks */
  --font-sans: 'CustomSans', system-ui, sans-serif;
  --font-serif: 'CustomSerif', Georgia, serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;

  /* Size scale (semantic) */
  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-lg: 1.25rem;
  --text-xl: 1.5rem;
  --text-2xl: 2rem;
  --text-3xl: 3rem;

  /* Weight */
  --font-normal: 400;
  --font-medium: 500;
  --font-semibold: 600;
  --font-bold: 700;

  /* Line height */
  --leading-tight: 1.25;
  --leading-normal: 1.5;
  --leading-relaxed: 1.75;

  /* Letter spacing */
  --tracking-tight: -0.02em;
  --tracking-normal: 0;
  --tracking-wide: 0.05em;
}
```

## Accessibility Considerations

Beyond contrast ratios (which are well-documented), consider:

- **Never disable zoom**: `user-scalable=no` breaks accessibility. If your layout breaks at 200% zoom, fix the layout.
- **Use rem/em for font sizes**: This respects user browser settings. Never `px` for body text.
- **Minimum 16px body text**: Smaller than this strains eyes and fails WCAG on mobile.
- **Adequate touch targets**: Text links need padding or line-height that creates 44px+ tap targets.

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


---

## Reference: interaction-design

# Interaction Design

This reference guides the creation of interaction patterns that are intuitive, accessible, and delightful - the conversation between user and interface.

The user provides an interaction challenge: designing forms, improving button states, fixing navigation patterns, optimizing input UX, implementing keyboard navigation, or creating feedback mechanisms. They may include accessibility requirements, device constraints, or specific interaction problems to solve.

## Interaction Design Thinking

Before designing interactions, understand the user's mental model and context:

- **User Context**: What are users trying to accomplish? What's their experience level? What's their emotional state (stressed during checkout vs relaxed browsing)?
- **Device & Input**: Touch vs pointer? Keyboard navigation? Voice input? Gamepad? Different inputs need different affordances.
- **Error Tolerance**: High-stakes actions (delete, purchase) vs low-stakes (filter, sort)? Design appropriate safeguards.
- **Speed vs Accuracy**: Quick scanning vs careful reading? Simple taps vs precise manipulation?

**CRITICAL**: Good interaction design is invisible. Users should complete tasks without thinking about the interface.

Then implement interactions that are:
- Intuitive with clear affordances and feedback
- Accessible to all users and input methods
- Forgiving with error prevention and recovery
- Responsive with immediate feedback and state changes

## The Eight Interactive States

Every interactive element needs these states designed:

| State | When | Visual Treatment |
|-------|------|------------------|
| **Default** | At rest | Base styling |
| **Hover** | Pointer over (not touch) | Subtle lift, color shift |
| **Focus** | Keyboard/programmatic focus | Visible ring (see below) |
| **Active** | Being pressed | Pressed in, darker |
| **Disabled** | Not interactive | Reduced opacity, no pointer |
| **Loading** | Processing | Spinner, skeleton |
| **Error** | Invalid state | Red border, icon, message |
| **Success** | Completed | Green check, confirmation |

**The common miss**: Designing hover without focus, or vice versa. They're different. Keyboard users never see hover states.

## Focus Rings: Do Them Right

**Never `outline: none` without replacement.** It's an accessibility violation. Instead, use `:focus-visible` to show focus only for keyboard users:

```css
/* Hide focus ring for mouse/touch */
button:focus {
  outline: none;
}

/* Show focus ring for keyboard */
button:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}
```

**Focus ring design**:
- High contrast (3:1 minimum against adjacent colors)
- 2-3px thick
- Offset from element (not inside it)
- Consistent across all interactive elements

## Form Design: The Non-Obvious

### Don't Use Placeholders as Labels

Placeholders disappear when you type. Users forget what the field was for. Screen readers may not announce them.

```html
<!-- Bad -->
<input placeholder="Email address">

<!-- Good -->
<label for="email">Email address</label>
<input id="email" type="email" placeholder="name@example.com">
```

Use placeholders only for examples or format hints, never as the primary label.

### Validate on Blur, Not on Input

Real-time validation (validating every keystroke) is annoying. Users can't finish typing before seeing errors.

```javascript
// Bad: fires on every keystroke
input.addEventListener('input', validate);

// Good: fires when user leaves field
input.addEventListener('blur', validate);

// Exception: password strength (show progress while typing)
passwordInput.addEventListener('input', showStrength);
```

### Error Message Placement

Place errors **below** the field (users scan top-down), not above. Keep messages close to the field—not in a summary at the top unless also repeated inline.

```html
<label for="email">Email</label>
<input id="email" type="email" aria-describedby="email-error">
<span id="email-error" class="error">Please enter a valid email</span>
```

The `aria-describedby` connects the error to the input for screen readers.

## Loading States: Optimistic Updates

**Show success immediately, handle failure gracefully.** Users perceive the app as faster.

```javascript
// Optimistic update pattern
async function toggleLike() {
  // 1. Update UI immediately
  setLiked(true);

  try {
    // 2. Send request
    await api.like(postId);
  } catch {
    // 3. Rollback on failure
    setLiked(false);
    showToast('Like failed. Please try again.');
  }
}
```

**When to use**: Low-stakes actions (likes, follows, small edits). **Not for**: Payments, destructive actions, critical data changes.

### Skeleton Screens > Spinners

Spinners say "something is happening" but give no sense of what or how long. Skeletons preview the content shape:

```css
.skeleton {
  background: linear-gradient(
    90deg,
    var(--gray-200) 25%,
    var(--gray-100) 50%,
    var(--gray-200) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

## Modals: The Inert Approach

Focus trapping in modals used to require complex JavaScript. Now use the `inert` attribute:

```html
<!-- When modal is open -->
<main inert>
  <!-- Content behind modal can't be focused or clicked -->
</main>
<dialog open>
  <h2>Modal Title</h2>
  <!-- Focus stays inside modal -->
</dialog>
```

Or use the native `<dialog>` element:

```javascript
const dialog = document.querySelector('dialog');
dialog.showModal();  // Opens with focus trap, closes on Escape
```

## The Popover API

For tooltips, dropdowns, and non-modal overlays, use native popovers:

```html
<button popovertarget="menu">Open menu</button>
<div id="menu" popover>
  <button>Option 1</button>
  <button>Option 2</button>
</div>
```

**Benefits**: Light-dismiss (click outside closes), proper stacking, no z-index wars, accessible by default.

## Destructive Actions: Undo > Confirm

Confirmation dialogs are friction. Users click through them mindlessly. **Undo is better**:

```javascript
async function deleteItem(id) {
  // 1. Remove from UI immediately
  hideItem(id);

  // 2. Show undo toast
  const toast = showToast('Item deleted', {
    action: { label: 'Undo', onClick: () => restoreItem(id) },
    duration: 5000
  });

  // 3. Actually delete after toast expires
  toast.onClose(() => api.delete(id));
}
```

**When to still use confirmation**: Irreversible actions (account deletion), high-cost actions (large purchases), batch operations on many items.

## Keyboard Navigation Patterns

### Roving Tabindex

For component groups (tabs, menu items, radio groups), one item is tabbable; arrow keys move within:

```html
<div role="tablist">
  <button role="tab" tabindex="0">Tab 1</button>
  <button role="tab" tabindex="-1">Tab 2</button>
  <button role="tab" tabindex="-1">Tab 3</button>
</div>
```

Arrow keys move `tabindex="0"` between items. Tab moves to the next component entirely.

### Skip Links

For keyboard users, provide a skip link to jump past navigation:

```html
<a href="#main-content" class="skip-link">Skip to main content</a>
<nav>...</nav>
<main id="main-content">...</main>
```

```css
.skip-link {
  position: absolute;
  left: -9999px;
}
.skip-link:focus {
  left: 0;
  z-index: 9999;
  /* Visible styling */
}
```

## Gesture Discoverability

Swipe-to-delete and similar gestures are invisible. Hint at their existence:

- **Partially reveal**: Show delete button peeking from edge
- **Onboarding**: Coach marks on first use
- **Alternative**: Always provide a visible fallback (menu with "Delete")

Don't rely on gestures as the only way to perform actions.

---

**IMPORTANT**: Test interactions with actual users and diverse input methods. What works with a mouse might fail with touch or keyboard.

**NEVER**:
- Remove focus indicators without providing visible alternatives (accessibility violation)
- Use placeholder text as labels (disappears on input, hard to remember)
- Make touch targets smaller than 44x44px
- Validate in real-time for long inputs (wait for blur)
- Show generic error messages ("Error occurred") - be specific and helpful
- Block user interaction without clear loading states
- Design only for mouse/pointer (test with keyboard and touch)
- Use custom controls without proper ARIA and keyboard support

Remember: Interaction design is where users actually experience your interface. Get this right, and everything else falls into place.


---

## Reference: color-and-contrast

# Color & Contrast

This reference guides the creation of color systems that are both beautiful and functional, balancing creative expression with accessibility and systematic coherence.

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

Pure gray (`oklch(50% 0 0)`) and pure black (`#000`) don't exist in nature—real shadows and surfaces always have a color cast. They look uncanny and lifeless.

```css
/* Dead and artificial */
--gray: oklch(50% 0 0);
--black: oklch(0% 0 0);

/* Natural and warm */
--gray: oklch(50% 0.01 60);     /* Warm gray */
--black: oklch(12% 0.01 250);   /* Very dark blue-gray */
```

Even a chroma of 0.005-0.01 is enough to feel natural without being obviously tinted.

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

```css
/* Dark mode depth via surface color, not shadow */
:root[data-theme="dark"] {
  --surface-1: oklch(15% 0.01 250);
  --surface-2: oklch(20% 0.01 250);  /* "Higher" = lighter */
  --surface-3: oklch(25% 0.01 250);

  /* Reduce text weight slightly */
  --body-weight: 350;  /* Instead of 400 */
}
```

### Token Hierarchy

Use two layers of abstraction:

```css
/* Layer 1: Primitive tokens (rarely use directly) */
--blue-500: oklch(55% 0.2 250);
--blue-600: oklch(45% 0.2 250);

/* Layer 2: Semantic tokens (use these) */
--color-primary: var(--blue-500);
--color-primary-hover: var(--blue-600);
--color-text: var(--gray-900);
--color-text-muted: var(--gray-600);
--color-border: var(--gray-200);
--color-surface: var(--white);
```

**For dark mode, only redefine the semantic layer:**

```css
:root[data-theme="dark"] {
  --color-primary: var(--blue-400);  /* Lighter in dark mode */
  --color-text: var(--gray-100);
  --color-surface: var(--gray-900);
}
```

## Alpha Is A Design Smell

If you're using lots of transparency (rgba, hsla), your palette is probably incomplete. Alpha creates:
- Unpredictable contrast (depends on what's behind it)
- Performance overhead (compositing)
- Inconsistency across contexts

**Instead**: Define explicit overlay colors:

```css
/* Bad: unpredictable */
--overlay: rgba(0, 0, 0, 0.5);

/* Good: explicit colors for each context */
--overlay-on-light: oklch(40% 0 0);
--overlay-on-dark: oklch(70% 0 0);
--overlay-on-image: oklch(20% 0 0 / 60%);  /* Alpha only when necessary */
```

The exception: Focus rings and interactive states where you need to see through to the element beneath.

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


---

## Reference: responsive-design

# Responsive Design

This reference guides the creation of responsive interfaces that adapt beautifully across devices, screen sizes, input methods, and usage contexts.

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

## Mobile-First: Write It Right

Start with base styles for mobile, then layer complexity:

```css
/* Base: mobile */
.nav {
  display: flex;
  flex-direction: column;
}

/* Enhancement: tablet and up */
@media (min-width: 768px) {
  .nav {
    flex-direction: row;
  }
}
```

**The mistake**: Writing desktop-first (max-width queries) means mobile loads desktop styles first, then overrides. Wasteful and error-prone.

## Breakpoints: Content-Driven, Not Device-Driven

**Don't chase device sizes.** iPhones change, Android varies wildly, tablets overlap with laptops. Instead, let content tell you where to break:

1. Start narrow
2. Stretch the viewport until the design breaks
3. Add a breakpoint there

Common content-driven breakpoints (as starting points):

```css
:root {
  --bp-sm: 640px;   /* Larger phones, small content changes */
  --bp-md: 768px;   /* Tablets, significant reflow */
  --bp-lg: 1024px;  /* Laptops, multi-column */
  --bp-xl: 1280px;  /* Desktops, max content width */
}
```

**Three breakpoints usually suffice.** If you have more than five, you're probably over-engineering.

## Fluid Design: The Clamp Formula

`clamp(min, preferred, max)` creates fluid values without media queries.

### The Formula

```css
/* Font size: 16px min, scales with viewport, 24px max */
font-size: clamp(1rem, 0.5rem + 2vw, 1.5rem);
```

**How to calculate the preferred value**: The middle value determines the scaling rate. Higher vw coefficient = faster scaling:

- `1vw` = gentle scaling
- `2-3vw` = moderate scaling
- `4vw+` = aggressive scaling

Add a rem offset to shift the baseline: `0.5rem + 2vw` ensures it doesn't collapse to 0 on small screens.

### Fluid Spacing

```css
:root {
  --space-lg: clamp(2rem, 1rem + 3vw, 4rem);
  --container-padding: clamp(1rem, 5vw, 4rem);
}
```

This creates breathing room that naturally expands on larger screens.

## Detect Input Method, Not Just Screen Size

**Screen size doesn't tell you input method.** A laptop with touchscreen, a tablet with keyboard—use pointer and hover queries:

```css
/* Fine pointer (mouse, trackpad) */
@media (pointer: fine) {
  .button { padding: 8px 16px; }
}

/* Coarse pointer (touch, stylus) */
@media (pointer: coarse) {
  .button { padding: 12px 20px; }  /* Larger touch target */
}

/* Device supports hover */
@media (hover: hover) {
  .card:hover { transform: translateY(-2px); }
}

/* Device doesn't support hover (touch) */
@media (hover: none) {
  .card { /* No hover state - use active instead */ }
}
```

**Critical**: Don't rely on hover for functionality. Touch users can't hover.

## Safe Areas: Handle the Notch

Modern phones have notches, rounded corners, and home indicators. Use `env()`:

```css
body {
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
  padding-left: env(safe-area-inset-left);
  padding-right: env(safe-area-inset-right);
}

/* With fallback */
.footer {
  padding-bottom: max(1rem, env(safe-area-inset-bottom));
}
```

**Enable viewport-fit** in your meta tag:
```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
```

## Responsive Images: Get It Right

### srcset with Width Descriptors

```html
<img
  src="hero-800.jpg"
  srcset="
    hero-400.jpg 400w,
    hero-800.jpg 800w,
    hero-1200.jpg 1200w
  "
  sizes="(max-width: 768px) 100vw, 50vw"
  alt="Hero image"
>
```

**How it works**:
- `srcset` lists available images with their actual widths (`w` descriptors)
- `sizes` tells the browser how wide the image will display
- Browser picks the best file based on viewport width AND device pixel ratio

### Picture Element for Art Direction

When you need different crops/compositions (not just resolutions):

```html
<picture>
  <source media="(min-width: 768px)" srcset="wide.jpg">
  <source media="(max-width: 767px)" srcset="tall.jpg">
  <img src="fallback.jpg" alt="...">
</picture>
```

## Layout Adaptation Patterns

### Navigation: The Three-Stage Pattern

```css
/* Mobile: hamburger icon + drawer */
.nav-menu { display: none; }
.nav-toggle { display: block; }

/* Tablet: horizontal but compact */
@media (min-width: 768px) {
  .nav-menu { display: flex; }
  .nav-toggle { display: none; }
}

/* Desktop: full navigation with labels */
@media (min-width: 1024px) {
  .nav-item-label { display: inline; }
}
```

### Table to Cards

Tables work on desktop, fail on mobile. Transform:

```css
@media (max-width: 768px) {
  table, thead, tbody, th, td, tr {
    display: block;
  }

  thead { display: none; }  /* Hide headers */

  tr {
    margin-bottom: 1rem;
    border: 1px solid var(--border);
    padding: 1rem;
  }

  td::before {
    content: attr(data-label);  /* Add labels via data attribute */
    font-weight: 600;
    display: block;
  }
}
```

### Progressive Disclosure

Not everything needs to show on mobile:

```css
/* Show summary on mobile */
.details-content { display: none; }

@media (min-width: 768px) {
  /* Expand on desktop */
  .details-content { display: block; }
}
```

Combine with `<details>/<summary>` for interactive expansion on mobile.

## Testing: Don't Trust DevTools Alone

DevTools device emulation is useful for layout but misses:

- Actual touch interactions
- Real CPU/memory constraints
- Network latency patterns
- Font rendering differences
- Browser chrome/keyboard appearances

**Test on at least**: One real iPhone, one real Android, a tablet if relevant. Cheap Android phones reveal performance issues you'll never see on simulators.

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
