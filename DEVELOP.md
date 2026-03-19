# Developer Guide

Documentation for contributors to Impeccable.

## Architecture

This repository uses a **feature-rich source format** that transforms into provider-specific formats. We chose "Option A" architecture: maintain full metadata in source files and downgrade for providers with limited support (like Cursor), rather than limiting everyone to the lowest common denominator.

### Why This Approach?

Different providers have different capabilities:
- **Claude Code, OpenCode, Trae**: Full metadata — args, user-invokable, allowed-tools, license, compatibility
- **Codex, Agents**: Args converted to `argument-hint` format
- **Gemini**: Minimal frontmatter, `{{arg}}` placeholders become `{{args}}`
- **Cursor, Kiro, Pi**: Basic frontmatter (name, description, license/compatibility)

By maintaining rich source files, we preserve maximum functionality where supported while still providing working (if simpler) versions for all providers.

## Source Format

### Skills (`source/skills/{name}/SKILL.md`)

```yaml
---
name: skill-name
description: What this skill provides
license: License info (optional)
compatibility: Environment requirements (optional)
---

Your skill instructions here...
```

**Frontmatter fields** (based on [Agent Skills spec](https://agentskills.io/specification)):
- `name` (required): Skill identifier (1-64 chars, lowercase/numbers/hyphens)
- `description` (required): What the skill provides (1-1024 chars)
- `user-invokable` (optional): Boolean — if `true`, the skill can be invoked as a slash command
- `args` (optional): Array of argument objects (for user-invokable skills)
  - `name`: Argument identifier
  - `description`: What it's for
  - `required`: Boolean (defaults to false)
- `license` (optional): License/attribution info
- `compatibility` (optional): Environment requirements (1-500 chars)
- `metadata` (optional): Arbitrary key-value pairs
- `allowed-tools` (optional, experimental): Pre-approved tools list

**Body**: The skill instructions for the LLM.

## Building

### Prerequisites
- Bun (fast JavaScript runtime and package manager)
- No external dependencies required

### Commands

```bash
# Build all provider formats
bun run build

# Clean dist folder
bun run clean

# Rebuild from scratch
bun run rebuild
```

### What Gets Generated

```
source/                          → dist/
  skills/{name}/SKILL.md           cursor/.cursor/skills/{name}/SKILL.md
                                   claude-code/.claude/skills/{name}/SKILL.md
                                   gemini/.gemini/skills/{name}/SKILL.md
                                   codex/.codex/skills/{name}/SKILL.md
                                   agents/.agents/skills/{name}/SKILL.md
                                   kiro/.kiro/skills/{name}/SKILL.md
                                   opencode/.opencode/skills/{name}/SKILL.md
                                   pi/.pi/skills/{name}/SKILL.md
                                   trae/.trae-cn/builtin_skills/{name}/SKILL.md
```

## Provider Transformations

All providers output skills to `dist/{provider}/.{config}/skills/{name}/SKILL.md` with reference files in subdirectories. They differ in frontmatter fields and argument handling.

### Cursor
- Output: `dist/cursor/.cursor/skills/{name}/SKILL.md`
- Frontmatter: name, description, license
- **Note**: Agent Skills require Cursor nightly channel

### Claude Code (Full Featured)
- Output: `dist/claude-code/.claude/skills/{name}/SKILL.md`
- Frontmatter: name, description, user-invokable, args, license, compatibility, metadata, allowed-tools
- Preserves `{{arg}}` placeholders in body

### OpenCode (Full Featured)
- Output: `dist/opencode/.opencode/skills/{name}/SKILL.md`
- Frontmatter: name, description, user-invokable, args, license, compatibility, metadata, allowed-tools
- Same format as Claude Code

### Gemini CLI
- Output: `dist/gemini/.gemini/skills/{name}/SKILL.md`
- Frontmatter: name, description
- For user-invokable skills: remaining `{{arg}}` placeholders become `{{args}}`

### Codex CLI
- Output: `dist/codex/.codex/skills/{name}/SKILL.md`
- Frontmatter: name, description, argument-hint, license
- For user-invokable skills: `{{argname}}` → `$ARGNAME` (uppercase)

### Agents (VS Code Copilot, Antigravity)
- Output: `dist/agents/.agents/skills/{name}/SKILL.md`
- Frontmatter: name, description, user-invokable, argument-hint
- Args converted to `argument-hint` format (e.g., `<target> [FORMAT=<value>]`)

### Kiro
- Output: `dist/kiro/.kiro/skills/{name}/SKILL.md`
- Frontmatter: name, description, license, compatibility, metadata

### Pi
- Output: `dist/pi/.pi/skills/{name}/SKILL.md`
- Frontmatter: name, description, license, compatibility, metadata

### Trae (Full Featured)
- Output: `dist/trae/.trae-cn/builtin_skills/{name}/SKILL.md` (China version)
- Output: `dist/trae/.trae/builtin_skills/{name}/SKILL.md` (International version)
- Frontmatter: name, description, user-invokable, args, license, compatibility, metadata, allowed-tools
- Same format as Claude Code
- Two variants are generated automatically:
  - **Trae China**: Skills installed to `~/.trae-cn/builtin_skills/`
  - **Trae International**: Skills installed to `~/.trae/builtin_skills/`

## Adding New Content

### 1. Create Source File

```bash
mkdir source/skills/myskill
touch source/skills/myskill/SKILL.md
```

Add frontmatter and content following the format above.

### 2. Build

```bash
bun run build
```

This generates all 9 provider formats automatically.

### 3. Test

Test with your provider of choice to ensure it works correctly. Remember that Cursor will have limited functionality.

### 4. Commit

Commit source files:
```bash
git add source/
git commit -m "Add [skill name]"
```

## Build System Details

The build system uses a modular architecture under `scripts/`:

- `build.js` — Main orchestrator
- `lib/utils.js` — Shared utilities (frontmatter parsing, file I/O, placeholder replacement)
- `lib/zip.js` — ZIP bundle generation
- `lib/transformers/*.js` — One file per provider (cursor, claude-code, gemini, codex, agents, kiro, opencode, pi, trae)

### Key Functions

- `parseFrontmatter()`: Extracts YAML frontmatter and body
- `readSourceFiles()`: Reads all skill directories from `source/skills/`
- `replacePlaceholders()`: Substitutes `{{model}}`, `{{config_file}}`, etc. per provider
- `transformCursor()`: Basic frontmatter (name, description, license)
- `transformClaudeCode()`: Full metadata with args and allowed-tools
- `transformGemini()`: Minimal frontmatter, `{{arg}}` → `{{args}}`
- `transformCodex()`: Args → argument-hint, `{{arg}}` → `$ARGNAME`
- `transformAgents()`: Args → argument-hint, user-invokable flag
- `transformKiro()`: Basic frontmatter with license/compatibility/metadata
- `transformOpenCode()`: Full metadata (same as Claude Code)
- `transformPi()`: Basic frontmatter with license/compatibility/metadata
- `transformTrae()`: Full metadata (same as Claude Code), outputs to both `.trae-cn/builtin_skills/` and `.trae/builtin_skills/`

## Best Practices

### Skill Writing

1. **Focused scope**: One clear domain per skill
2. **Clear descriptions**: Make purpose obvious
3. **Clear instructions**: LLM should understand exactly what to do
4. **Include examples**: Where they clarify intent
5. **State constraints**: What NOT to do as clearly as what to do
6. **Test across providers**: Verify it works in multiple contexts

## Reference Documentation

- [Agent Skills Specification](https://agentskills.io/specification) - Open standard
- [Cursor Commands](https://cursor.com/docs/agent/chat/commands)
- [Cursor Rules](https://cursor.com/docs/context/rules)
- [Cursor Skills](https://cursor.com/docs/context/skills)
- [Claude Code Slash Commands](https://code.claude.com/docs/en/slash-commands)
- [Anthropic Skills (Claude Code)](https://github.com/anthropics/skills)
- [Gemini CLI Custom Commands](https://cloud.google.com/blog/topics/developers-practitioners/gemini-cli-custom-slash-commands)
- [Gemini CLI Skills](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/gemini-md.md)
- [Codex CLI Slash Commands](https://developers.openai.com/codex/guides/slash-commands#create-your-own-slash-commands-with-custom-prompts)
- [Codex CLI Skills](https://developers.openai.com/codex/skills/)
- [Pi Skills](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/skills.md)

## Repository Structure

```
impeccable/
├── source/                          # Edit these! Source of truth
│   └── skills/                      # Skill definitions
│       ├── frontend-design/
│       │   ├── SKILL.md
│       │   └── reference/*.md       # Domain-specific references
│       ├── audit/SKILL.md
│       ├── polish/SKILL.md
│       └── ...
├── dist/                            # Generated output (gitignored)
│   ├── cursor/
│   ├── claude-code/
│   ├── gemini/
│   ├── codex/
│   ├── agents/
│   ├── kiro/
│   ├── opencode/
│   ├── pi/
│   └── trae/
├── scripts/
│   ├── build.js                     # Main orchestrator
│   └── lib/
│       ├── utils.js                 # Shared utilities
│       ├── zip.js                   # ZIP generation
│       └── transformers/            # One file per provider
│           ├── cursor.js
│           ├── claude-code.js
│           ├── gemini.js
│           ├── codex.js
│           ├── agents.js
│           ├── kiro.js
│           ├── opencode.js
│           ├── pi.js
│           └── trae.js
├── tests/                           # Bun test suite
├── package.json                     # ESM project config
├── README.md                        # User documentation
├── DEVELOP.md                       # This file
└── .gitignore
```

## Troubleshooting

### Build fails with YAML parsing errors
- Check frontmatter indentation (YAML is indent-sensitive)
- Ensure `---` delimiters are on their own lines
- Verify colons have spaces after them (`key: value`)

### Output doesn't match expectations
- Check the transformer function for your provider in `scripts/lib/transformers/`
- Verify source file has correct frontmatter structure
- Run `bun run rebuild` to ensure clean build

### Provider doesn't recognize the files
- Check installation path for your provider
- Verify file naming matches provider requirements
- Consult provider's documentation (links above)

## Questions?

Open an issue or submit a PR!

