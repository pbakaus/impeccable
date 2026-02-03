---
name: teach-impeccable
description: One-time setup that gathers design context for your project and saves it to your AI config file. Run once to establish persistent design guidelines.
---

Gather design context for this project, then persist it for all future sessions.

## Step 1: Explore the Codebase

Before asking questions, thoroughly scan the project to discover what you can:

- **README and docs**: Project purpose, target audience, any stated goals
- **Package.json / config files**: Tech stack, dependencies, existing design libraries
- **Existing components**: Current design patterns, spacing, typography in use
- **Brand assets**: Logos, favicons, color values already defined
- **Design tokens / CSS variables**: Existing color palettes, font stacks, spacing scales
- **Any style guides or brand documentation**

Note what you've learned and what remains unclear.

## Step 2: Ask UX-Focused Questions

STOP and call the AskUserQuestionTool to clarify. Focus only on what you couldn't infer from the codebase:

### Users & Purpose
- Who uses this? What's their context when using it?
- What job are they trying to get done?
- What emotions should the interface evoke? (confidence, delight, calm, urgency, etc.)

### Brand & Personality
- How would you describe the brand personality in 3 words?
- Any reference sites or apps that capture the right feel? What specifically about them?
- What should this explicitly NOT look like? Any anti-references?

### Aesthetic Preferences
- Any strong preferences for visual direction? (minimal, bold, elegant, playful, technical, organic, etc.)
- Light mode, dark mode, or both?
- Any colors that must be used or avoided?

### Accessibility & Inclusion
- Specific accessibility requirements? (WCAG level, known user needs)
- Considerations for reduced motion, color blindness, or other accommodations?

Skip questions where the answer is already clear from the codebase exploration.

## Step 3: Choose Storage Location

Before writing the design context, ask the user where they'd prefer to store this information:

STOP and call the AskUserQuestionTool to clarify.
**Where would you like to store the design guidelines?**

1. **Direct integration**: Add to CLAUDE.md in the project root (immediately available to Claude)
2. **Laravel Boost integration**: Create separate guideline file in `.ai/guidelines/design-context.md` (Laravel Boost will merge into CLAUDE.md when you run `php artisan boost:update`)

Always present the options in the order listed above. Option 1 is recommended for most projects. Option 2 is only for projects using Laravel Boost's guideline merging system.

## Step 4: Write Design Context

Synthesize your findings and the user's answers into a `## Design Context` section:

```markdown
## Design Context

### Users
[Who they are, their context, the job to be done]

### Brand Personality
[Voice, tone, 3-word personality, emotional goals]

### Aesthetic Direction
[Visual tone, references, anti-references, theme]

### Design Principles
[3-5 principles derived from the conversation that should guide all design decisions]
```

**If user chose option 1**: Write this section to CLAUDE.md in the project root. If the file exists, append or update the Design Context section.

**If user chose option 2 (Laravel Boost)**: 
1. Create the `.ai/guidelines/` directory if it doesn't exist
2. Write the Design Context section to `.ai/guidelines/design-context.md`
3. Inform the user to run `php artisan boost:update` to merge this guideline into their CLAUDE.md

Confirm completion and summarize the key design principles that will now guide all future work. 

**For Laravel Boost users (option 2):** Remind them to run `php artisan boost:update` to merge the new guideline into their CLAUDE.md.