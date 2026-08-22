## Why

Devin CLI (the successor to Windsurf's CLI, and bundled with Devin Desktop — the ex-Windsurf Desktop product) is a Claude-compatible coding agent that Impeccable users cannot install for today. The harness reads the same `SKILL.md` format, Claude-format subagents, and Claude-format hooks from `.devin/` / `.windsurf/` project paths, so supporting it is a matter of adding two new provider builds and CLI install targets — but that plumbing currently doesn't exist, and Devin users are a documented share of the tool's audience.

## What Changes

- Add two new provider configs to the build pipeline:
  - `devin` → project dir `.devin`, display name "Devin CLI", Claude-format hooks emitted to `.devin/hooks.v1.json`, Claude-format subagents emitted to `.devin/agents/`
  - `devin-legacy` → project dir `.windsurf`, display name "Devin (ex-Windsurf Desktop)", skills only (no hooks, no subagents)
- Both reuse the existing `placeholderProvider: 'agents'` setup text and Devin's `.agents`-standard compatibility, so no new placeholder dictionary entries are needed beyond `command_prefix: '/'`.
- Extend the CLI installer (`cli/bin/commands/skills.mjs`) with `.devin` / `.windsurf` provider dirs, aliases (`devin`, `windsurf`), and global-detection hints for `~/.devin`, `~/.windsurf`, `~/.config/devin/skills`, and `~/.codeium/<channel>/skills`.
- Add `devin` / `devin-legacy` to `cli/lib/download-providers.js` so the download API exposes both builds.
- Document both harnesses in `README.md`, `docs/HARNESSES.md`, and the skills CLI's install output.

## Capabilities

### New Capabilities

- `harness-provider-devin`: Provider build, install, detection, and download support for `.devin` and `.windsurf` config dirs (Devin CLI and Devin legacy path)

### Modified Capabilities

(none)

## Impact

- **Build pipeline**: `scripts/lib/transformers/providers.js`, `scripts/lib/transformers/index.js`, `scripts/build.js` (accepted `configDir` list in `build:release` sync)
- **CLI**: `cli/bin/commands/skills.mjs` (provider maps, detection hints), `cli/lib/download-providers.js`
- **Docs**: `README.md`, `docs/HARNESSES.md`, `docs/DEVELOP.md`
- **Tests**: `tests/build.test.js` (provider transformer coverage), `tests/skills-cli.test.js` (link/detection coverage)
- **Release artifacts**: `.devin` / `.windsurf` tracked root harness folders will be added to `build:release` sync output
