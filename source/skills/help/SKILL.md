---
name: help
description: Explain what each Impeccable command does and recommend the right next command or sequence for the user's design goal.
user-invokable: true
---

Help the user choose the right Impeccable command for their current situation.

This is a navigation command. Do NOT run `teach-impeccable` just to answer `/help`.

## What To Do

1. Infer the user's goal from recent context when possible.
2. If their goal is still unclear, ask one short clarifying question before recommending commands.
3. Explain the available commands grouped by purpose.
4. Recommend the best next command or short sequence for the user's specific situation.
5. Never invent commands. Only recommend installed commands: {{available_commands}}.

## Command Map

### Setup
- `/teach-impeccable` — Gather project design context and save it for future sessions
- `/help` — Explain the command set and recommend the best next step

### Diagnose
- `/audit` — Find technical quality issues across accessibility, performance, theming, and responsiveness
- `/critique` — Review UX and visual design quality

### Quality
- `/normalize` — Align work with the design system and core standards
- `/polish` — Do a final refinement pass before shipping
- `/optimize` — Improve performance and runtime efficiency
- `/harden` — Improve resilience, error handling, and edge cases

### Adaptation
- `/clarify` — Improve unclear UX writing and labels
- `/distill` — Remove excess and simplify the interface
- `/adapt` — Improve the experience for different devices and contexts

### Intensity
- `/bolder` — Push a weak or timid design further
- `/quieter` — Tone down a design that feels too loud or heavy

### Enhancement
- `/animate` — Add purposeful motion
- `/colorize` — Introduce strategic color
- `/delight` — Add charm, personality, or surprise
- `/onboard` — Improve onboarding and guided flows

### System
- `/extract` — Pull repeated design patterns into reusable components

## Default Recommendations

- New project or no design context yet: start with `/teach-impeccable`
- You do not know what is wrong yet: start with `/audit` for technical issues or `/critique` for design issues
- The UI mostly works but feels inconsistent: use `/normalize`
- The UI is close and needs one final pass: use `/polish`
- The design feels bland: use `/bolder`, `/colorize`, or `/delight`
- The design feels busy or overworked: use `/quieter` or `/distill`

## Response Format

Use this structure unless the user asks for just a raw list:

### Best next step
- Name the single best command and why

### Good alternatives
- List 2-4 relevant commands with one-line guidance

### Suggested sequence
1. First command
2. Second command
3. Final command

### Example invocations
- Include 1-3 concrete examples when helpful, such as `/audit header` or `/polish checkout-form`

Keep the answer brief and practical. The goal is to help the user move, not to dump documentation.
