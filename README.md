# impeccable.style

Cross-provider design skills and commands for LLM-powered development tools.

> **🌐 Visit [impeccable.style](https://impeccable.style)** to download bundles, individual skills, or commands for your IDE/CLI.

## Quick Start

**Option 1: Download from Website (Recommended)**

Visit [impeccable.style](https://impeccable.style) and download the complete bundle for your tool:
- One-click ZIP downloads for Cursor, Claude Code, Gemini CLI, or Codex CLI
- Individual skill and command downloads
- Always up-to-date with the latest version

**Option 2: Clone from GitHub**

```bash
git clone https://github.com/pbakaus/vibe-design-plugins.git
cd vibe-design-plugins
```

Then copy the appropriate files from `dist/` to your IDE/CLI configuration directory (see [Installation](#installation) below).

## What's Included

### Commands (15)

**Core Workflow:**
- **normalize** - Align features with design system standards
- **audit** - Comprehensive quality audit with severity ratings and recommendations

**Quality & Polish:**
- **polish** - Final quality pass before shipping (alignment, spacing, consistency)
- **clarify** - Improve unclear UX copy and microcopy
- **optimize** - Performance improvements (loading, rendering, bundle size)
- **harden** - Error handling, i18n, text wrapping, edge cases

**Aesthetic Adjustment:**
- **quieter** - Tone down overly bold designs → refined sophistication
- **bolder** - Amplify boring designs → memorable impact
- **simplify** - Strip to essence → clarity through reduction

**Enhancement:**
- **animate** - Add purposeful motion and micro-interactions
- **colorize** - Introduce strategic color to monochromatic designs
- **delight** - Add moments of joy and personality

**System & Growth:**
- **extract** - Pull components/tokens into design system
- **adapt** - Adapt designs for different devices/contexts
- **onboard** - Design onboarding flows and empty states

### Skills (8)

- **frontend-design** - Create distinctive, production-grade frontend interfaces with high design quality. Generates creative, polished code that avoids generic AI aesthetics.
- **typography** - Master typography systems that balance timeless principles with modern web capabilities. Creates readable, systematically coherent typography that is both performant and aesthetically distinctive.
- **color-and-contrast** - Build sophisticated color systems balancing aesthetics with accessibility and function. Produces beautiful, accessible color implementations with systematic coherence across all theme variants.
- **spatial-design** - Master spatial design balancing systematic precision with artistic composition. Creates systematically organized layouts with compelling visual hierarchy and intentional spatial relationships.
- **motion-design** - Create purposeful motion that enhances usability and provides feedback without sacrificing performance. Produces smooth, delightful animations that guide attention and reinforce interactions while maintaining 60fps performance.
- **interaction-design** - Design intuitive interaction patterns that feel natural and provide clear feedback. Creates accessible, forgiving interfaces where every state is clear and every action provides immediate feedback.
- **responsive-design** - Create responsive interfaces that adapt beautifully across devices, screen sizes, and input methods. Produces fluid, performant experiences that feel native to each device while maintaining consistency.
- **ux-writing** - Write clear, helpful, and human interface copy that users understand immediately. Produces concise, empathetic copy that guides users confidently through tasks without confusion or frustration.

## Command & Skill Relationships

### Diagnostic Flow
1. **audit** (report issues) → Use specific commands to fix:
   - Design system issues → **normalize** or **extract**
   - Performance issues → **optimize**
   - Edge cases → **harden**
   - Responsiveness → **adapt**
   - Copy clarity → **clarify**

### Aesthetic Direction Flow
- Too boring → **bolder** + **colorize** + **delight**
- Too intense → **quieter** + **simplify**
- Too cluttered → **simplify** + **normalize**
- Too static → **animate** + **delight**

### Production Flow
1. **Build** → Use skills (**frontend-design**, **typography**, **spatial-design**, etc.)
2. **Refine** → **normalize** + **clarify** + **adapt**
3. **Harden** → **harden** + **optimize**
4. **Audit** → **audit** to catch issues
5. **Polish** → **polish** final pass
6. **Enhance** → **delight** + **animate** (optional)

### Skills Support Commands
- **typography** skill → **normalize** typography across app
- **ux-writing** skill → **clarify** existing copy
- **responsive-design** skill → **adapt** for new device
- **motion-design** skill → **animate** static interface

## Installation

After downloading from [impeccable.style](https://impeccable.style) or cloning this repo, install for your provider:

### Cursor

**From Website**: Download the Cursor bundle ZIP from [impeccable.style](https://impeccable.style), unzip, and copy to your project:

```bash
# After unzipping the downloaded bundle
cp -r cursor/commands/* your-project/.cursor/commands/
cp -r cursor/rules/* your-project/.cursor/rules/
```

**From Repo**: Copy directly from the dist directory:

```bash
cp -r dist/cursor/commands/* .cursor/commands/
cp -r dist/cursor/rules/* .cursor/rules/
```

**Note**: Cursor doesn't support command arguments or frontmatter, so commands work but with simplified functionality.

**Reference**: 
- [Cursor Commands Documentation](https://cursor.com/docs/agent/chat/commands)
- [Cursor Rules Documentation](https://cursor.com/docs/context/rules)

### Claude Code

**From Website**: Download the Claude Code bundle ZIP from [impeccable.style](https://impeccable.style), unzip, and copy:

```bash
# Global installation
cp -r claude-code/commands/* ~/.claude/commands/
cp -r claude-code/skills/* ~/.claude/skills/

# Or project-specific
cp -r claude-code/commands/* .claude/commands/
cp -r claude-code/skills/* .claude/skills/
```

**From Repo**:

```bash
cp -r dist/claude-code/commands/* ~/.claude/commands/
cp -r dist/claude-code/skills/* ~/.claude/skills/
```

**Reference**: 
- [Claude Code Slash Commands](https://code.claude.com/docs/en/slash-commands)
- [Anthropic Skills Documentation](https://github.com/anthropics/skills)

### Gemini CLI

**From Website**: Download the Gemini CLI bundle ZIP from [impeccable.style](https://impeccable.style), unzip, and copy:

```bash
# Commands (global)
cp -r gemini/commands/* ~/.gemini/commands/

# Skills (project-specific)
cp gemini/GEMINI*.md ~/your-project-root/
```

**From Repo**:

```bash
cp -r dist/gemini/commands/* ~/.gemini/commands/
cp dist/gemini/GEMINI*.md ~/your-project-root/
```

**Note**: 
- Commands use `.toml` format with `{{args}}` placeholders
- `GEMINI.md` uses `@file.md` import syntax to load modular skill files
- Skills should be placed at your project root for project-specific context
- For global skills, place `GEMINI.md` in `~/.gemini/`

**Reference**: 
- [Gemini CLI Custom Slash Commands](https://cloud.google.com/blog/topics/developers-practitioners/gemini-cli-custom-slash-commands)
- [Gemini CLI Skills (GEMINI.md)](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/gemini-md.md)

### Codex CLI

**From Website**: Download the Codex CLI bundle ZIP from [impeccable.style](https://impeccable.style), unzip, and copy:

```bash
# Prompts (global)
cp -r codex/prompts/* ~/.codex/prompts/

# Skills (project-specific)
cp codex/AGENTS*.md ~/your-project-root/
```

**From Repo**:

```bash
cp -r dist/codex/prompts/* ~/.codex/prompts/
cp dist/codex/AGENTS*.md ~/your-project-root/
```

**Note**: 
- Commands are invoked as `/prompts:<name>` (e.g., `/prompts:normalize`)
- The `AGENTS.md` file guides Codex to read modular skill files as needed
- Place `AGENTS.md` at your repository root

**Reference**: 
- [Codex CLI Slash Commands](https://developers.openai.com/codex/guides/slash-commands#create-your-own-slash-commands-with-custom-prompts)
- [Codex CLI Skills (AGENTS.md)](https://developers.openai.com/codex/guides/agents-md)

## Usage

### Commands

**Cursor, Claude Code**:
```
/normalize
/audit
/polish
```

**Gemini**:
```
/normalize <optional-feature-name>
/audit <optional-area>
```

**Codex**:
```
/prompts:normalize
/prompts:normalize FEATURE="dashboard"
```

### Skills

Skills are automatically available once installed. Refer to your provider's documentation for how skills are activated:

- **Cursor**: Rules apply automatically to the context
- **Claude Code**: Skills activated via `/skills` or `@skill-name`
- **Gemini**: Gemini reads `GEMINI.md` and automatically imports referenced skill files using `@file.md` syntax
- **Codex**: Codex reads `AGENTS.md` and automatically loads referenced skill files when needed

## Provider Comparison

| Feature | Cursor | Claude Code | Gemini CLI | Codex CLI |
|---------|---------|-------------|------------|-----------|
| Command Args | ❌ | ✅ | ✅ | ✅ |
| Frontmatter | ❌ | ✅ | ✅ (TOML) | ✅ |
| Modular Skills | ❌ | ❌ | ✅ | ✅ |

## Development

### Local Setup

```bash
# Clone the repo
git clone https://github.com/pbakaus/vibe-design-plugins.git
cd vibe-design-plugins

# Build distribution files
bun run build

# Start dev server
bun run dev
# Visit http://localhost:3000
```

### Project Structure

- `source/` - Edit these! Single source of truth for all content
- `dist/` - Generated provider-specific files (committed for users)
- `public/` - Website (HTML, CSS modules, vanilla JS)
- `server/` - Bun server for impeccable.style
- `scripts/` - Build system that transforms source → dist

### Deployment

The site runs on Vercel with Bun runtime. Just push to main and it auto-deploys.

```bash
# Production build
bun run build
bun run start  # Uses --production flag
```

See [DEVELOP.md](DEVELOP.md) for detailed contributor guidelines.

## Contributing

Want to add more design skills or commands? See [DEVELOP.md](DEVELOP.md) for contributor guidelines.

This is an open-source project hosted on [GitHub](https://github.com/pbakaus/vibe-design-plugins).

## License

See LICENSE file.
