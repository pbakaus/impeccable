# vibe-design-plugins

Cross-provider design skills and commands for LLM-powered development tools.

## What's Included

### Commands
- **normalize** - Normalize your design to match your design system and ensure consistency

### Skills
- **frontend-design** - Create distinctive, production-grade frontend interfaces with exceptional design quality

## Installation

Choose your provider and copy the files to the appropriate location:

### Cursor

Copy commands and rules to your project's `.cursor` directory:

```bash
cp -r dist/cursor/commands/* .cursor/commands/
cp -r dist/cursor/rules/* .cursor/rules/
```

**Note**: Cursor doesn't support command arguments or frontmatter, so commands work but with simplified functionality.

**Reference**: 
- [Cursor Commands Documentation](https://cursor.com/docs/agent/chat/commands)
- [Cursor Rules Documentation](https://cursor.com/docs/context/rules)

### Claude Code

Copy to your global Claude directory:

```bash
cp -r dist/claude-code/commands/* ~/.claude/commands/
cp -r dist/claude-code/skills/* ~/.claude/skills/
```

Or for project-specific use, copy to `.claude/` in your project root.

**Reference**: 
- [Claude Code Slash Commands](https://code.claude.com/docs/en/slash-commands)
- [Anthropic Skills Documentation](https://github.com/anthropics/skills)

### Gemini CLI

Copy commands and skill files to your project:

```bash
# Commands (global for all projects)
cp -r dist/gemini/commands/* ~/.gemini/commands/

# Skills (project-specific - place at your project root)
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

Copy prompts and skill files:

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
```

**Gemini**:
```
/normalize <optional-feature-name>
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

## Contributing

Want to add more design skills or commands? See [DEVELOP.md](DEVELOP.md) for contributor guidelines.

## License

See LICENSE file.
