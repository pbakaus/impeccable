# Impeccable

The vocabulary you didn't know you needed. 1 skill, 23 commands, and curated anti-patterns for impeccable frontend design.

> **Quick start:** Visit [impeccable.style](https://impeccable.style) to download ready-to-use bundles.

## Why Impeccable?

Anthropic's [frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design) was the first widely-used design skill for Claude. Impeccable started from there.

Every model trained on the same SaaS templates. Skip the guidance and you get the same handful of tells on every project: Inter for everything, purple-to-blue gradients, cards nested in cards, gray text on colored backgrounds, the rounded-square icon tile above every heading.

Impeccable adds:
- **7 domain reference files** ([view source](skill/)). Typography, color, motion, spatial, interaction, responsive, UX writing. Load on every command, alongside a brand-vs-product register that adjusts the defaults.
- **23 commands.** A shared design vocabulary with your AI: `polish`, `audit`, `critique`, `distill`, `animate`, `bolder`, `quieter`, and more.
- **27 deterministic anti-pattern rules** plus a 12-rule LLM critique pass. CLI and browser extension run the deterministic ones with no LLM and no API key. Each is tied to specific design guidance the skill teaches against.

## What's Included

### The Skill: impeccable

A comprehensive design skill with 7 domain-specific references ([view skill](skill/SKILL.md)):

| Reference | Covers |
|-----------|--------|
| [typography](skill/reference/typography.md) | Type systems, font pairing, modular scales, OpenType |
| [color-and-contrast](skill/reference/color-and-contrast.md) | OKLCH, tinted neutrals, dark mode, accessibility |
| [spatial-design](skill/reference/spatial-design.md) | Spacing systems, grids, visual hierarchy |
| [motion-design](skill/reference/motion-design.md) | Easing curves, staggering, reduced motion |
| [interaction-design](skill/reference/interaction-design.md) | Forms, focus states, loading patterns |
| [responsive-design](skill/reference/responsive-design.md) | Mobile-first, fluid design, container queries |
| [ux-writing](skill/reference/ux-writing.md) | Button labels, error messages, empty states |

### 23 Commands

All commands are accessed through `/impeccable`:

| Command | What it does |
|---------|--------------|
| `/impeccable craft` | Full shape-then-build flow with visual iteration |
| `/impeccable teach` | One-time setup: gather design context, write root PRODUCT.md and DESIGN.md |
| `/impeccable document` | Generate root DESIGN.md from existing project code |
| `/impeccable extract` | Pull reusable components and tokens into the design system |
| `/impeccable shape` | Plan UX/UI before writing code |
| `/impeccable critique` | UX design review: hierarchy, clarity, emotional resonance |
| `/impeccable audit` | Run technical quality checks (a11y, performance, responsive) |
| `/impeccable polish` | Final pass, design system alignment, and shipping readiness |
| `/impeccable bolder` | Amplify boring designs |
| `/impeccable quieter` | Tone down overly bold designs |
| `/impeccable distill` | Strip to essence |
| `/impeccable harden` | Error handling, i18n, text overflow, edge cases |
| `/impeccable onboard` | First-run flows, empty states, activation paths |
| `/impeccable animate` | Add purposeful motion |
| `/impeccable colorize` | Introduce strategic color |
| `/impeccable typeset` | Fix font choices, hierarchy, sizing |
| `/impeccable layout` | Fix layout, spacing, visual rhythm |
| `/impeccable delight` | Add moments of joy |
| `/impeccable overdrive` | Add technically extraordinary effects |
| `/impeccable clarify` | Improve unclear UX copy |
| `/impeccable adapt` | Adapt for different devices |
| `/impeccable optimize` | Performance improvements |
| `/impeccable live` | Visual variant mode: iterate on elements in the browser |

Use `/impeccable pin <command>` to create standalone shortcuts (e.g., `pin audit` creates `/audit`).

#### Usage Examples

```
/impeccable audit blog           # Audit blog hub + post pages
/impeccable critique landing     # UX design review
/impeccable polish settings      # Final pass before shipping
/impeccable harden checkout      # Add error handling + edge cases
```

Or use `/impeccable` directly with a description:
```
/impeccable redo this hero section
```

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

**OpenCode:**
```bash
cp -r dist/opencode/.opencode your-project/
```

**Pi:**
```bash
cp -r dist/pi/.pi your-project/
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
# Project-local
cp -r dist/agents/.agents your-project/

# Or user-wide
mkdir -p ~/.agents/skills
cp -r dist/agents/.agents/skills/* ~/.agents/skills/
```

**GitHub Copilot:**
```bash
cp -r dist/github/.github your-project/
```

**Trae:**
```bash
# Trae China (domestic version)
cp -r dist/trae/.trae-cn/skills/* ~/.trae-cn/skills/

# Trae International
cp -r dist/trae/.trae/skills/* ~/.trae/skills/
```

> **Note:** Trae has two versions with different config directories:
> - **Trae China**: `~/.trae-cn/skills/`
> - **Trae International**: `~/.trae/skills/`
>
> After copying, restart Trae IDE to activate the skills.

**Rovo Dev:**
```bash
# Project-specific
cp -r dist/rovo-dev/.rovodev your-project/

# Or global (applies to all projects)
cp -r dist/rovo-dev/.rovodev/skills/* ~/.rovodev/skills/
```

**Qoder:**
```bash
# Project-specific
cp -r dist/qoder/.qoder your-project/

# Or global (applies to all projects)
cp -r dist/qoder/.qoder/skills/* ~/.qoder/skills/
```

## Usage

Once installed, use commands in your AI harness:

```
/audit           # Find issues
/normalize       # Fix inconsistencies
/polish          # Final cleanup
/distill         # Remove complexity
```

Most commands accept an optional argument to focus on a specific area:

```
/audit header
/polish checkout-form
```

**Note:** Codex uses skills here, not `/prompts:` commands. Open `/skills` or type `$impeccable`. Repo-local installs live in `.agents/skills/`; user-wide installs live in `~/.agents/skills/`. GitHub Copilot uses `.github/skills/`. Restart the tool if a newly installed skill does not appear.

## CLI

Impeccable includes a standalone CLI for detecting anti-patterns without an AI harness:

```bash
npx impeccable detect src/                   # scan a directory
npx impeccable detect index.html             # scan an HTML file
npx impeccable detect https://example.com    # scan a URL (Puppeteer)
npx impeccable detect --fast --json .        # regex-only, JSON output
```

The detector catches 24 issues across AI slop (side-tab borders, purple gradients, bounce easing, dark glows) and general design quality (line length, cramped padding, small touch targets, skipped headings, and more).

## Supported Tools

- [Cursor](https://cursor.com)
- [Claude Code](https://claude.ai/code)
- [OpenCode](https://opencode.ai)
- [Pi](https://pi.dev)
- [Gemini CLI](https://github.com/google-gemini/gemini-cli)
- [Codex CLI](https://github.com/openai/codex)
- [VS Code Copilot](https://code.visualstudio.com)
- [Kiro](https://kiro.dev)
- [Trae](https://trae.ai)
- [Rovo Dev](https://www.atlassian.com/software/rovo)
- [Qoder](https://qoder.com)

## Community & Ecosystem

Join the community and ecosystem conversations:

- GitHub Discussions: file bugs, request features, and help newcomers.
- [Impeccable on npm](https://www.npmjs.com/package/impeccable): grab the CLI, follow releases, and star the package.
- Follow @pbakaus on Twitter for release notes, sample lint reports, and video highlights of new rules.

## Contributing

See [DEVELOP.md](DEVELOP.md) for contributor guidelines and build instructions.

## License

Apache 2.0. See [LICENSE](LICENSE).

The impeccable skill builds on [Anthropic's original frontend-design skill](https://github.com/anthropics/skills/tree/main/skills/frontend-design). See [NOTICE.md](NOTICE.md) for attribution.

---

Created by [Paul Bakaus](https://www.paulbakaus.com)
