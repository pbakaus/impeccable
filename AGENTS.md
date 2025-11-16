# vibe-design-plugins Repository

This repository provides cross-provider design skills and commands for LLM-powered development tools (Cursor, Claude Code, Gemini CLI, Codex CLI).

## Repository Purpose

Maintain a **single source of truth** for design-focused skills and commands, then automatically transform them into provider-specific formats. Each provider has different capabilities (frontmatter, arguments, modular files), so we use a build system to generate appropriate outputs.

## Architecture: Option A (Feature-Rich Source)

We use a **feature-rich source format** that gets transformed for each provider:

- **Source files** (`source/`): Full metadata with YAML frontmatter, args, descriptions
- **Build system** (`scripts/`): Transforms source → provider-specific formats
- **Distribution** (`dist/`): Committed output files for 4 providers

### Why Option A?

Cursor doesn't support frontmatter or arguments (lowest common denominator). Instead of limiting all providers, we:
1. Author with full metadata in source files
2. Generate full-featured versions for providers that support it (Claude Code, Gemini, Codex)
3. Generate downgraded versions for Cursor (strip frontmatter, rely on appending)

## Repository Structure

```
vibe-design-plugins/
├── source/                      # EDIT THESE! Single source of truth
│   ├── commands/                # Command definitions with frontmatter
│   │   └── normalize.md
│   └── skills/                  # Skill definitions with frontmatter
│       └── frontend-design.md
├── dist/                        # Generated outputs (committed for users)
│   ├── cursor/                  # Downgraded (no frontmatter)
│   │   ├── commands/*.md
│   │   └── rules/*.md
│   ├── claude-code/             # Full featured
│   │   ├── commands/*.md
│   │   └── skills/*/SKILL.md
│   ├── gemini/                  # TOML commands + modular skills
│   │   ├── commands/*.toml
│   │   ├── GEMINI.md
│   │   └── GEMINI.*.md
│   └── codex/                   # Custom prompts + modular skills
│       ├── prompts/*.md
│       ├── AGENTS.md
│       └── AGENTS.*.md
├── scripts/                     # Build system (Bun)
│   ├── build.js                 # Main orchestrator
│   ├── lib/
│   │   ├── utils.js             # Shared utilities
│   │   └── transformers/        # Provider-specific transformers
│   │       ├── cursor.js
│   │       ├── claude-code.js
│   │       ├── gemini.js
│   │       └── codex.js
├── README.md                    # End user documentation
├── DEVELOP.md                   # Contributor documentation
└── package.json                 # Bun scripts
```

## Source File Format

### Commands (`source/commands/*.md`)

```yaml
---
name: command-name
description: Clear description of what this command does
args:
  - name: argname
    description: Argument description
    required: false
---

Command prompt here. Use {{argname}} placeholders for arguments.
```

### Skills (`source/skills/*.md`)

```yaml
---
name: skill-name
description: Clear description of what this skill provides
license: License info (optional)
---

Skill instructions for the LLM here.
```

## Build System

Uses **Bun** for fast builds. Modular architecture:

- **`utils.js`**: Shared functions (parseFrontmatter, readSourceFiles, writeFile, etc.)
- **Transformer pattern**: Each provider has one focused file
- **Registry**: `transformers/index.js` exports all transformers
- **Main script**: `build.js` orchestrates everything (~50 lines)

Run: `bun run build`

## Provider Transformations

### 1. Cursor (Downgraded)
- **Commands**: Body only → `dist/cursor/commands/*.md`
- **Skills**: Body only → `dist/cursor/rules/*.md`
- **Strips**: All frontmatter, all metadata
- **Args**: Not supported, arguments get appended to end of prompt

### 2. Claude Code (Full Featured)
- **Commands**: Full YAML frontmatter → `dist/claude-code/commands/*.md`
- **Skills**: Full YAML frontmatter → `dist/claude-code/skills/{name}/SKILL.md`
- **Preserves**: All metadata, all args
- **Format**: Matches [Anthropic Skills spec](https://github.com/anthropics/skills)

### 3. Gemini CLI (Full Featured)
- **Commands**: TOML format → `dist/gemini/commands/*.toml`
  - Uses `description` and `prompt` keys
  - Transforms `{{argname}}` → `{{args}}` (Gemini uses single args string)
- **Skills**: Modular with imports → `dist/gemini/GEMINI.{name}.md`
  - Main `GEMINI.md` uses `@./GEMINI.{name}.md` import syntax
  - Gemini automatically loads imported files

### 4. Codex CLI (Full Featured)
- **Commands**: Custom prompt format → `dist/codex/prompts/*.md`
  - Uses `description` and `argument-hint` in frontmatter
  - Transforms `{{argname}}` → `$ARGNAME` (uppercase variables)
  - Invoked as `/prompts:<name>`
- **Skills**: Modular with routing → `dist/codex/AGENTS.{name}.md`
  - Main `AGENTS.md` provides routing instructions
  - Tells Codex when to read which skill file

## Key Design Decisions

### Why commit dist/?
End users can copy files directly without needing build tools.

### Why separate transformers?
- Each provider ~30-85 lines, easy to understand
- Can modify one without affecting others
- Easy to add new providers

### Why Bun?
- Much faster than Node.js (2-4x)
- All-in-one toolkit (runtime + package manager)
- Zero config, TypeScript native
- Node.js compatible (works with existing code)

### Why modular skills for Gemini/Codex?
- Better context management (load only what's needed)
- Cleaner file organization
- Gemini: Uses native `@file.md` import feature
- Codex: Uses routing pattern with AGENTS.md guide

## Adding New Content

1. **Create source file** in `source/commands/` or `source/skills/`
2. **Add frontmatter** with name, description, args (for commands) or license (for skills)
3. **Write body** with instructions/prompt
4. **Build**: `bun run build`
5. **Test** with your provider
6. **Commit** both source and dist files

## Current Content

### Commands
- **normalize**: Normalize design to match design system

### Skills
- **frontend-design**: Create distinctive, production-grade frontend interfaces

## Important Notes

- **Source is truth**: Always edit `source/`, never edit `dist/` directly
- **Test across providers**: Changes affect 4 different outputs
- **Argument handling**: Write prompts that work with both placeholders and appending
- **Cursor limitations**: No frontmatter/args, so design for graceful degradation

## Documentation

- **README.md**: End user guide (installation, usage)
- **DEVELOP.md**: Contributor guide (architecture, build system, adding content)
- **This file**: Context for AI assistants and new developers

## Provider Documentation Links

- [Cursor Commands](https://cursor.com/docs/agent/chat/commands)
- [Cursor Rules](https://cursor.com/docs/context/rules)
- [Claude Code Slash Commands](https://code.claude.com/docs/en/slash-commands)
- [Anthropic Skills](https://github.com/anthropics/skills)
- [Gemini CLI Custom Commands](https://cloud.google.com/blog/topics/developers-practitioners/gemini-cli-custom-slash-commands)
- [Gemini CLI GEMINI.md](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/gemini-md.md)
- [Codex CLI Slash Commands](https://developers.openai.com/codex/guides/slash-commands)
- [Codex CLI AGENTS.md](https://developers.openai.com/codex/guides/agents-md)

