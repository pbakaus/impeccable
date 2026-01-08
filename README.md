# Impeccable

The vocabulary you didn't know you needed. 1 skill, 17 commands, and curated anti-patterns for impeccable frontend design.

> **Quick start:** Visit [impeccable.style](https://impeccable.style) to download ready-to-use bundles.

## Why Impeccable?

Anthropic created [frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design), a skill that guides Claude toward better UI design. Impeccable builds on that foundation with deeper expertise and more control.

Every LLM learned from the same generic templates. Without guidance, you get the same predictable mistakes: Inter font, purple gradients, cards nested in cards, gray text on colored backgrounds.

Impeccable fights that bias with:
- **An expanded skill** with 7 domain-specific reference files ([view source](source/skills/frontend-design/))
- **17 steering commands** to audit, review, polish, simplify, animate, and more
- **Curated anti-patterns** that explicitly tell the AI what NOT to do

## What's Included

### The Skill: frontend-design

A comprehensive design skill with 7 domain-specific references ([view skill](source/skills/frontend-design/SKILL.md)):

| Reference | Covers |
|-----------|--------|
| [typography](source/skills/frontend-design/reference/typography.md) | Type systems, font pairing, modular scales, OpenType |
| [color-and-contrast](source/skills/frontend-design/reference/color-and-contrast.md) | OKLCH, tinted neutrals, dark mode, accessibility |
| [spatial-design](source/skills/frontend-design/reference/spatial-design.md) | Spacing systems, grids, visual hierarchy |
| [motion-design](source/skills/frontend-design/reference/motion-design.md) | Easing curves, staggering, reduced motion |
| [interaction-design](source/skills/frontend-design/reference/interaction-design.md) | Forms, focus states, loading patterns |
| [responsive-design](source/skills/frontend-design/reference/responsive-design.md) | Mobile-first, fluid design, container queries |
| [ux-writing](source/skills/frontend-design/reference/ux-writing.md) | Button labels, error messages, empty states |

### 17 Commands

| Command | What it does |
|---------|--------------|
| `/teach-impeccable` | One-time setup: gather design context, save to config |
| `/audit` | Run technical quality checks (a11y, performance, responsive) |
| `/critique` | UX design review: hierarchy, clarity, emotional resonance |
| `/normalize` | Align with design system standards |
| `/polish` | Final pass before shipping |
| `/simplify` | Strip to essence |
| `/clarify` | Improve unclear UX copy |
| `/optimize` | Performance improvements |
| `/harden` | Error handling, i18n, edge cases |
| `/animate` | Add purposeful motion |
| `/colorize` | Introduce strategic color |
| `/bolder` | Amplify boring designs |
| `/quieter` | Tone down overly bold designs |
| `/delight` | Add moments of joy |
| `/extract` | Pull into reusable components |
| `/adapt` | Adapt for different devices |
| `/onboard` | Design onboarding flows |

### Anti-Patterns

The skill includes explicit guidance on what to avoid:

- Don't use overused fonts (Arial, Inter, system defaults)
- Don't use gray text on colored backgrounds
- Don't use pure black/gray (always tint)
- Don't wrap everything in cards or nest cards inside cards
- Don't use bounce/elastic easing (feels dated)

## See It In Action

Visit [impeccable.style](https://impeccable.style#casestudies) to see before/after case studies of real projects transformed with Impeccable commands.

## Installation

### Option 1: Download from Website (Recommended)

Visit [impeccable.style](https://impeccable.style), download the ZIP for your tool, and extract to your project.

### Option 2: Copy from Repository

**Cursor:**
```bash
cp -r dist/cursor/.cursor your-project/
```

> **Note:** Cursor skills require setup:
> 1. Switch to Nightly channel in Cursor Settings → Beta
> 2. Enable Agent Skills in Cursor Settings → Rules
>
> [Learn more about Cursor skills](https://cursor.com/docs/context/skills)

**Claude Code:**
```bash
# Project-specific
cp -r dist/claude-code/.claude your-project/

# Or global (applies to all projects)
cp -r dist/claude-code/.claude/* ~/.claude/
```

**Gemini CLI:**
```bash
cp -r dist/gemini/.gemini your-project/
```

> **Note:** Gemini CLI skills require setup:
> 1. Install preview version: `npm i -g @google/gemini-cli@preview`
> 2. Run `/settings` and enable "Skills"
> 3. Run `/skills list` to verify installation
>
> [Learn more about Gemini CLI skills](https://geminicli.com/docs/cli/skills/)

**Codex CLI:**
```bash
cp -r dist/codex/.codex/* ~/.codex/
```

## Usage

Once installed, use commands in your AI coding tool:

```
/audit           # Find issues
/normalize       # Fix inconsistencies
/polish          # Final cleanup
/simplify        # Remove complexity
```

Most commands accept an optional argument to focus on a specific area:

```
/audit header
/polish checkout-form
```

**Note:** Codex CLI uses a different syntax: `/prompts:audit`, `/prompts:polish`, etc.

## Supported Tools

- [Cursor](https://cursor.com)
- [Claude Code](https://claude.ai/code)
- [Gemini CLI](https://github.com/google-gemini/gemini-cli)
- [Codex CLI](https://github.com/openai/codex)

## Contributing

See [DEVELOP.md](DEVELOP.md) for contributor guidelines and build instructions.

## License

Apache 2.0. See [LICENSE](LICENSE).

The frontend-design skill builds on [Anthropic's original](https://github.com/anthropics/skills/tree/main/skills/frontend-design). See [NOTICE.md](NOTICE.md) for attribution.

---

Created by [Paul Bakaus](https://www.paulbakaus.com)
