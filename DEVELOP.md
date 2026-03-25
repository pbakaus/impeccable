# Developer Guide

Documentation for contributors to Impeccable.

## Architecture

Source skills in `source/skills/` are transformed into provider-specific formats by a config-driven factory. Each provider is defined as a config object in `scripts/lib/transformers/providers.js` -- adding a new provider requires only a new config entry.

For detailed harness capabilities (which frontmatter fields each supports, placeholder systems, directory structures), see [HARNESSES.md](HARNESSES.md).

## Source Format

### Skills (`source/skills/{name}/SKILL.md`)

```yaml
---
name: skill-name
description: What this skill provides
argument-hint: "[target]"
user-invocable: true
license: License info (optional)
compatibility: Environment requirements (optional)
---

Your skill instructions here...
```

**Frontmatter fields** (based on [Agent Skills spec](https://agentskills.io/specification)):
- `name` (required): Skill identifier (1-64 chars, lowercase/numbers/hyphens)
- `description` (required): What the skill provides (1-1024 chars)
- `user-invocable` (optional): Boolean -- if `true`, the skill can be invoked as a slash command
- `argument-hint` (optional): Hint shown during autocomplete (e.g., `[target]`, `[area (feature, page...)]`)
- `license` (optional): License/attribution info
- `compatibility` (optional): Environment requirements (1-500 chars)
- `metadata` (optional): Arbitrary key-value pairs
- `allowed-tools` (optional, experimental): Pre-approved tools list

**Body placeholders** (replaced per-provider during build):
- `{{model}}` -- Provider-specific model name (e.g., "Claude", "Gemini", "GPT")
- `{{config_file}}` -- Provider-specific config file (e.g., "CLAUDE.md", ".cursorrules")
- `{{ask_instruction}}` -- How to ask the user for clarification
- `{{command_prefix}}` -- Slash command prefix (`/` for most, `$` for Codex)
- `{{available_commands}}` -- Comma-separated list of user-invocable commands

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
source/                          -> dist/
  skills/{name}/SKILL.md           {provider}/{configDir}/skills/{name}/SKILL.md
```

Each provider gets its own output directory. Two variants are generated per provider: unprefixed and prefixed (with `i-` prefix for skill names).

## Build System Details

The build system uses a factory pattern under `scripts/`:

```
scripts/
  build.js                        # Main orchestrator
  lib/
    utils.js                      # Frontmatter parsing, placeholder replacement, YAML generation
    zip.js                        # ZIP bundle generation
    transformers/
      factory.js                  # createTransformer() -- generates transformer functions from config
      providers.js                # PROVIDERS config map -- one entry per provider
      index.js                    # Re-exports factory-generated transformer functions
```

### Adding a New Provider

1. Add a placeholder config to `PROVIDER_PLACEHOLDERS` in `scripts/lib/utils.js`:
   ```javascript
   'my-provider': {
     model: 'MyModel',
     config_file: 'CONFIG.md',
     ask_instruction: 'ask the user directly to clarify.',
     command_prefix: '/'
   }
   ```

2. Add a provider config to `PROVIDERS` in `scripts/lib/transformers/providers.js`:
   ```javascript
   'my-provider': {
     provider: 'my-provider',
     configDir: '.my-provider',
     displayName: 'My Provider',
     frontmatterFields: ['user-invocable', 'argument-hint', 'license'],
   }
   ```

3. Run `bun run build` -- the provider is automatically picked up by the build loop.

4. Update `HARNESSES.md` with the provider's capabilities.

### Provider Config Options

| Field | Description |
|-------|-------------|
| `provider` | Key for output directory and placeholder lookup |
| `configDir` | Dot-directory name (e.g., `.claude`) |
| `displayName` | Human-readable name for build logs |
| `frontmatterFields` | Which optional fields to emit (see `factory.js` FIELD_SPECS) |
| `bodyTransform` | Optional `(body, skill) => body` function for post-processing |
| `placeholderProvider` | Override which PROVIDER_PLACEHOLDERS key to use (for variants sharing config) |

### Key Functions

- `createTransformer(config)`: Factory that returns a transformer function from a provider config
- `parseFrontmatter()`: Extracts YAML frontmatter and body from SKILL.md files
- `readSourceFiles()`: Reads all skill directories from `source/skills/`
- `replacePlaceholders()`: Substitutes `{{model}}`, `{{config_file}}`, etc. per provider
- `generateYamlFrontmatter()`: Serializes objects to YAML frontmatter (auto-quotes values starting with `[` or `{`)
- `prefixSkillReferences()`: Replaces `/skillname` with `/i-skillname` for prefixed variants

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
- [HARNESSES.md](HARNESSES.md) - Provider capabilities matrix
- [Cursor Skills](https://cursor.com/docs/context/skills)
- [Claude Code Skills](https://code.claude.com/docs/en/skills)
- [Gemini CLI Skills](https://geminicli.com/docs/cli/skills/)
- [Codex CLI Skills](https://developers.openai.com/codex/skills/)
- [VS Code Copilot Skills](https://code.visualstudio.com/docs/copilot/customization/agent-skills)
- [Kiro Skills](https://kiro.dev/docs/skills/)
- [OpenCode Skills](https://opencode.ai/docs/skills/)
- [Pi Skills](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/skills.md)

## Repository Structure

```
impeccable/
  source/                          # Edit these! Source of truth
    skills/                        # Skill definitions
      frontend-design/
        SKILL.md
        reference/*.md             # Domain-specific references
      audit/SKILL.md
      polish/SKILL.md
      ...
  dist/                            # Generated output (gitignored)
  scripts/
    build.js                       # Main orchestrator
    lib/
      utils.js                     # Shared utilities
      zip.js                       # ZIP generation
      transformers/
        factory.js                 # Config-driven transformer factory
        providers.js               # Provider config map
        index.js                   # Re-exports
  tests/                           # Bun test suite
  HARNESSES.md                     # Provider capabilities reference
  DEVELOP.md                       # This file
  README.md                        # User documentation
```

## Troubleshooting

### Build fails with YAML parsing errors
- Check frontmatter indentation (YAML is indent-sensitive)
- Ensure `---` delimiters are on their own lines
- Values starting with `[` or `{` are auto-quoted; other special YAML chars may need manual quoting

### Output doesn't match expectations
- Check the provider config in `scripts/lib/transformers/providers.js`
- Verify source file has correct frontmatter structure
- Run `bun run rebuild` to ensure clean build

### Provider doesn't recognize the files
- Check installation path for your provider
- Verify file naming matches provider requirements
- Consult [HARNESSES.md](HARNESSES.md) for provider-specific details

## Questions?

Open an issue or submit a PR!
