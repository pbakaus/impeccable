# Developer Guide

Documentation for contributors to vibe-design-plugins.

## Architecture

This repository uses a **feature-rich source format** that transforms into provider-specific formats. We chose "Option A" architecture: maintain full metadata in source files and downgrade for providers with limited support (like Cursor), rather than limiting everyone to the lowest common denominator.

### Why This Approach?

Different providers have different capabilities:
- **Cursor**: No frontmatter or argument support
- **Claude Code, Gemini, Codex**: Full support for metadata and arguments

By maintaining rich source files, we preserve maximum functionality where supported while still providing working (if simpler) versions for all providers.

## Source Format

### Commands (`source/commands/*.md`)

```yaml
---
name: command-name
description: What this command does
args:
  - name: argname
    description: Argument description
    required: false
---

Your command prompt here with {{argname}} placeholders...
```

**Frontmatter fields**:
- `name` (required): Command identifier
- `description` (required): What the command does
- `args` (optional): Array of argument objects
  - `name`: Argument identifier
  - `description`: What it's for
  - `required`: Boolean (defaults to false)

**Body**: The actual prompt. Use `{{argname}}` for argument placeholders (automatically transformed to provider-specific syntax).

### Skills (`source/skills/*.md`)

```yaml
---
name: skill-name
description: What this skill provides
license: License info (optional)
---

Your skill instructions here...
```

**Frontmatter fields**:
- `name` (required): Skill identifier
- `description` (required): What the skill provides
- `license` (optional): License/attribution info

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
source/                  → dist/
  commands/*.md            cursor/commands/*.md         (body only)
  skills/*.md              cursor/rules/*.md            (body only)
                           
                           claude-code/commands/*.md    (full frontmatter)
                           claude-code/skills/*/SKILL.md
                           
                           gemini/commands/*.toml       (TOML format)
                           gemini/GEMINI*.md            (modular)
                           
                           codex/prompts/*.md           (custom prompt format)
                           codex/AGENTS*.md             (modular)
```

## Provider Transformations

### Cursor (Downgraded)
- Strips ALL frontmatter
- Body only → `dist/cursor/commands/*.md` and `dist/cursor/rules/*.md`
- Argument placeholders remain as descriptive text (no substitution)

### Claude Code (Full Featured)
- Keeps full YAML frontmatter + body
- Commands → `dist/claude-code/commands/*.md`
- Skills → `dist/claude-code/skills/{name}/SKILL.md`

### Gemini CLI (Full Featured)
- Commands converted to TOML format → `dist/gemini/commands/*.toml`
  - `description` and `prompt` keys
  - Arguments converted to `{{args}}` (Gemini uses single args string)
- Skills → Modular `GEMINI.{name}.md` files
- Main `GEMINI.md` imports skill files using `@./GEMINI.{name}.md` syntax
  - Uses Gemini's native import feature for modular context files

### Codex CLI (Full Featured)
- Commands → Custom prompts with `argument-hint` → `dist/codex/prompts/*.md`
  - Frontmatter uses `description` and `argument-hint` (not `args` array)
  - Placeholders transformed from `{{argname}}` to `$ARGNAME` (uppercase)
  - Invoked as `/prompts:<name>`
- Skills → Modular `AGENTS.{name}.md` files
- Main `AGENTS.md` guides Codex on when to read each skill file
  - Includes skill descriptions to help Codex decide which file to read

## Adding New Content

### 1. Create Source File

**For a command**:
```bash
# Create source/commands/mycommand.md
touch source/commands/mycommand.md
```

Add frontmatter and content following the format above.

**For a skill**:
```bash
# Create source/skills/myskill.md
touch source/skills/myskill.md
```

Add frontmatter and content following the format above.

### 2. Build

```bash
bun run build
```

This generates all 4 provider formats automatically.

### 3. Test

Test with your provider of choice to ensure it works correctly. Remember that Cursor will have limited functionality.

### 4. Commit

Commit both source and dist files:
```bash
git add source/ dist/
git commit -m "Add [command/skill name]"
```

**Important**: The `dist/` directory is committed intentionally so end users can use files without building.

## Build System Details

The build system (`scripts/build.js`) is a single 410-line Node.js script with:
- Custom YAML frontmatter parser (no dependencies)
- Provider-specific transformation functions
- Automatic directory management
- Zero external dependencies (pure Node.js)

### Key Functions

- `parseFrontmatter()`: Extracts YAML frontmatter and body
- `readSourceFiles()`: Recursively reads source files
- `transformCursor()`: Strips frontmatter for Cursor
- `transformClaudeCode()`: Keeps full format
- `transformGemini()`: Converts to TOML + modular skills
- `transformCodex()`: Full format + modular skills

## Best Practices

### Command Writing

1. **Clear descriptions**: Make purpose obvious
2. **Meaningful argument names**: Use descriptive names
3. **Flexible prompts**: Write prompts that work even without argument substitution (for Cursor compatibility)
4. **Test across providers**: Verify it works in multiple contexts

### Skill Writing

1. **Focused scope**: One clear domain per skill
2. **Clear instructions**: LLM should understand exactly what to do
3. **Include examples**: Where they clarify intent
4. **State constraints**: What NOT to do as clearly as what to do

## Reference Documentation

- [Cursor Commands](https://cursor.com/docs/agent/chat/commands)
- [Cursor Rules](https://cursor.com/docs/context/rules)
- [Claude Code Slash Commands](https://code.claude.com/docs/en/slash-commands)
- [Anthropic Skills (Claude Code)](https://github.com/anthropics/skills)
- [Gemini CLI Custom Commands](https://cloud.google.com/blog/topics/developers-practitioners/gemini-cli-custom-slash-commands)
- [Gemini CLI Skills](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/gemini-md.md)
- [Codex CLI Slash Commands](https://developers.openai.com/codex/guides/slash-commands#create-your-own-slash-commands-with-custom-prompts)
- [Codex CLI Agents](https://developers.openai.com/codex/guides/agents-md)

## Repository Structure

```
vibe-design-plugins/
├── source/              # Edit these! Source of truth
│   ├── commands/        # Command definitions
│   │   └── normalize.md
│   └── skills/          # Skill definitions
│       └── frontend-design.md
├── dist/                # Generated (committed for users)
│   ├── cursor/
│   ├── claude-code/
│   ├── gemini/
│   └── codex/
├── scripts/
│   └── build.js         # Build system (410 lines, zero deps)
├── package.json         # ESM project config
├── README.md            # User documentation
├── DEVELOP.md           # This file
└── .gitignore
```

## Troubleshooting

### Build fails with YAML parsing errors
- Check frontmatter indentation (YAML is indent-sensitive)
- Ensure `---` delimiters are on their own lines
- Verify colons have spaces after them (`key: value`)

### Output doesn't match expectations
- Check the transformer function for your provider in `scripts/build.js`
- Verify source file has correct frontmatter structure
- Run `npm run rebuild` to ensure clean build

### Provider doesn't recognize the files
- Check installation path for your provider
- Verify file naming matches provider requirements
- Consult provider's documentation (links above)

## Questions?

Open an issue or submit a PR!

