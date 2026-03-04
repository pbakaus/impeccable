# Project Instructions for Claude

## CSS Build Process

**IMPORTANT**: After modifying any CSS files in `public/css/` (especially `workflow.css` or `main.css`), you MUST rebuild the Tailwind CSS:

```bash
bunx @tailwindcss/cli -i public/css/main.css -o public/css/styles.css
```

The CSS architecture:
- `public/css/main.css` - Main entry point, imports Tailwind and all other CSS files
- `public/css/workflow.css` - Commands section, glass terminal, case studies styles
- `public/css/styles.css` - **Compiled output** (do not edit directly)

## Development Server

```bash
bun run dev
```

Runs at http://localhost:3000

## Build System

The build system compiles skills and commands from `source/` to provider-specific formats in `dist/`:

```bash
bun run build      # Build all providers
bun run rebuild    # Clean and rebuild
```

Source files use placeholders that get replaced per-provider:
- `{{model}}` - Model name (Claude, Gemini, GPT, etc.)
- `{{config_file}}` - Config file name (CLAUDE.md, .cursorrules, etc.)
- `{{ask_instruction}}` - How to ask user questions

## Versioning

When bumping the version, update **all** of these locations to keep them in sync:

- `package.json` → `version`
- `.claude-plugin/plugin.json` → `version`
- `.claude-plugin/marketplace.json` → `plugins[0].version`
- `public/index.html` → hero version link text + new changelog entry
