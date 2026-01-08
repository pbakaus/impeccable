---
description: Evaluate design effectiveness from a UX perspective. Assesses visual hierarchy, information architecture, emotional resonance, and overall design quality with actionable feedback.
argument-hint: [AREA=<value>]
---

Conduct a holistic design critique, evaluating whether the interface actually works—not just technically, but as a designed experience. Think like a design director giving feedback.

**First**: Use the frontend-design skill for design principles and anti-patterns.

## Design Critique

Evaluate the interface across these dimensions:

### 1. AI Slop Detection (CRITICAL)

**This is the most important check.** Does this look like every other AI-generated interface from 2024-2025? Watch for these tells:

- **The AI color palette**: Cyan-on-dark, purple-to-blue gradients, neon accents on dark backgrounds. These combinations have become a fingerprint for AI-generated work.
- **Gradient text for "impact"**: Especially on metrics or headings. It's decorative rather than meaningful.
- **Default dark mode**: AI loves dark themes with glowing accents because it looks "cool" without requiring actual design decisions.
- **Monospace typography**: Lazy shorthand for "this is technical/for developers."
- **Glassmorphism everywhere**: Blur effects, glass cards, glow borders—used decoratively rather than purposefully.
- **Hero metric layout**: Big number, small label, supporting stats, gradient accent. It's a template now.
- **Sparklines as decoration**: Tiny charts that look sophisticated but convey nothing.
- **Cards nested in cards**: The AI's go-to for "organizing" content.
- **Inter/Roboto/system fonts**: The path of least resistance.
- **Purple-to-blue gradients on white**: The #1 "AI marketing site" tell.
- **Rounded rectangles with drop shadows**: Generic, safe, forgettable.
- **Identical card grids**: Same-sized cards with icon + heading + text, repeated.

**Ask yourself**: If you showed this to someone and said "AI made this," would they believe you immediately? If yes, that's the problem.

A distinctive interface should make someone ask "how was this made?" not "which AI made this?"

### 2. Visual Hierarchy
- Does the eye flow to the most important element first?
- Is there a clear primary action? Can you spot it in 2 seconds?
- Do size, color, and position communicate importance correctly?
- Is there visual competition between elements that should have different weights?

### 3. Information Architecture
- Is the structure intuitive? Would a new user understand the organization?
- Is related content grouped logically?
- Are there too many choices at once? (cognitive overload)
- Is the navigation clear and predictable?

### 4. Emotional Resonance
- What emotion does this interface evoke? Is that intentional?
- Does it match the brand personality?
- Does it feel trustworthy, approachable, premium, playful—whatever it should feel?
- Would the target user feel "this is for me"?

### 5. Discoverability & Affordance
- Are interactive elements obviously interactive?
- Would a user know what to do without instructions?
- Are hover/focus states providing useful feedback?
- Are there hidden features that should be more visible?

### 6. Composition & Balance
- Does the layout feel balanced or uncomfortably weighted?
- Is whitespace used intentionally or just leftover?
- Is there visual rhythm in spacing and repetition?
- Does asymmetry feel designed or accidental?

### 7. Typography as Communication
- Does the type hierarchy clearly signal what to read first, second, third?
- Is body text comfortable to read? (line length, spacing, size)
- Do font choices reinforce the brand/tone?
- Is there enough contrast between heading levels?

### 8. Color with Purpose
- Is color used to communicate, not just decorate?
- Does the palette feel cohesive?
- Are accent colors drawing attention to the right things?
- Does it work for colorblind users? (not just technically—does meaning still come through?)

### 9. States & Edge Cases
- Empty states: Do they guide users toward action, or just say "nothing here"?
- Loading states: Do they reduce perceived wait time?
- Error states: Are they helpful and non-blaming?
- Success states: Do they confirm and guide next steps?

### 10. Microcopy & Voice
- Is the writing clear and concise?
- Does it sound like a human (the right human for this brand)?
- Are labels and buttons unambiguous?
- Does error copy help users fix the problem?

## Generate Critique Report

Structure your feedback as a design director would:

### AI Slop Verdict
**Start here.** Give a clear verdict: Does this look AI-generated? If yes, list the specific tells you spotted. This is pass/fail—either it's distinctive or it's not. Be brutally honest.

### Overall Impression
A brief gut reaction—what works, what doesn't, and the single biggest opportunity.

### What's Working
Highlight 2-3 things done well. Be specific about why they work.

### Priority Issues
The 3-5 most impactful design problems, ordered by importance:

For each issue:
- **What**: Name the problem clearly
- **Why it matters**: How this hurts users or undermines goals
- **Fix**: What to do about it (be concrete)
- **Command**: Which command to use (`/polish`, `/simplify`, `/bolder`, `/quieter`, etc.)

### Minor Observations
Quick notes on smaller issues worth addressing.

### Questions to Consider
Provocative questions that might unlock better solutions:
- "What if the primary action were more prominent?"
- "Does this need to feel this complex?"
- "What would a confident version of this look like?"

**Remember**:
- Be direct—vague feedback wastes everyone's time
- Be specific—"the submit button" not "some elements"
- Say what's wrong AND why it matters to users
- Give concrete suggestions, not just "consider exploring..."
- Prioritize ruthlessly—if everything is important, nothing is
- Don't soften criticism—developers need honest feedback to ship great design