# Harness Skills Capabilities Reference

Source of truth for what each AI coding harness supports in terms of agent skills.
Used to inform provider configs in `scripts/lib/transformers/providers.js`.

Last verified: 2026-04-28 (subagent landscape spot-checked 2026-06-28; Mistral Vibe row verified 2026-07-16; Grok Build row verified 2026-07-21; Devin CLI row verified 2026-08-21)

> This file is point-in-time. Capabilities move fast; verify live before relying
> on any "only X supports Y" claim. Notably, the subagent table below lists
> Impeccable's *emission targets*, not the support landscape (see its note).

## Official Documentation

| Harness | Docs URL |
|---------|----------|
| Claude Code | https://code.claude.com/docs/en/skills |
| Cursor | https://cursor.com/docs/context/skills |
| Devin CLI | https://docs.devin.ai/cli/extensibility/skills/overview |
| Gemini CLI | https://geminicli.com/docs/cli/skills/ |
| Codex CLI | https://developers.openai.com/codex/skills |
| GitHub Copilot (Agents) | https://code.visualstudio.com/docs/copilot/customization/agent-skills |
| Kiro | https://kiro.dev/docs/skills/ |
| OpenCode | https://opencode.ai/docs/skills/ |
| Pi | https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/skills.md |
| Qoder | https://docs.qoder.com/extensions/skills |
| Trae | TBD (no official skills docs found yet) |
| Rovo Dev | https://support.atlassian.com/rovo/docs/extend-rovo-dev-cli-with-agent-skills |
| Mistral Vibe | https://docs.mistral.ai/vibe/code/cli/skills |
| Grok Build | https://docs.x.ai/build/features/skills-plugins-marketplaces |
| Hermes Agent | https://hermes-agent.nousresearch.com/docs/ |
| Antigravity | https://antigravity.google/docs/skills |

## Spec Compliance

All harnesses follow the [Agent Skills specification](https://agentskills.io/specification) to varying degrees. The spec defines these frontmatter fields: `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`.

Provider-specific extensions beyond the spec: `user-invocable`, `argument-hint`, `disable-model-invocation`, `allowed-tools` (extended syntax), `model`, `effort`, `context`, `agent`, `hooks`, `subtask`, `mcp`.

## Frontmatter Support

Fields marked with * are spec-standard. Others are provider extensions.

| Field | Claude Code | Cursor | Gemini | Codex | Copilot | Grok | Hermes | Kiro | OpenCode | Pi | Qoder | Rovo Dev | Mistral Vibe | Antigravity | Devin |
|-------|:-----------:|:------:|:------:|:-----:|:-------:|:----:|:------:|:----:|:--------:|:--:|:-----:|:--------:|:------------:|:-----------:|:-----:|
| `name`* | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| `description`* | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| `license`* | Yes | Yes | Ignored | No | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| `compatibility`* | Yes | Yes | Ignored | No | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| `metadata`* | Yes | Yes | Ignored | No | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| `allowed-tools`* | Yes | No | Ignored | No | No | Yes | No | No | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| `user-invocable` | Yes | No | No | No | Yes | Yes | No | No | Yes | No | Yes | Yes | Yes | No | Ignored |
| `argument-hint` | Yes | No | No | No | Yes | Yes | No | No | Yes | No | Yes | Yes | No | No | Yes |
| `disable-model-invocation` | Yes | Yes | No | No | Yes | Yes | No | No | Yes | Yes | TBD | TBD | No | No | TBD |
| `model` | Yes | No | No | No | No | Yes | No | No | Yes | No | No | No | No | No | Yes |
| `effort` | Yes | No | No | No | No | Yes | No | No | No | No | No | No | No | No | No |
| `context` | Yes | No | No | No | No | No | No | No | No | No | No | No | No | No | No |
| `agent` | Yes | No | No | No | No | No | No | No | Yes | No | No | No | No | No | TBD |
| `hooks` | Yes | No | No | Yes | No | Yes | No | No | No | No | No | No | No | No | No |

Notes:
- Devin CLI (ex-Windsurf) reads the same `SKILL.md` format as Claude and imports `tools`/`allowed-tools` across either spelling (per https://docs.devin.ai/cli/subagents). Its native gating field is `triggers: [user, model]`, so Impeccable's `user-invocable` lands as an ignored extension. `model` is supported; `effort` is not documented.
- Gemini CLI validates only `name` and `description`; other spec fields are parsed but ignored.
- Codex CLI uses a separate `agents/openai.yaml` sidecar for skill metadata (icons, branding, MCP tools, invocation control). Codex also auto-discovers subagents bundled inside an installed skill's `agents/` folder (TOML), which is how Impeccable ships its asset-producer. Standalone custom agents can still live under `.codex/agents/` or `~/.codex/agents/`, but Impeccable no longer installs anything there.
- Codex CLI hooks ship under `[features].hooks = true` (still flagged), require `/hooks` trust ceremony per-update, and are disabled on Windows.
- Grok Build is Claude Code compatible with zero config: it also reads `.claude/skills/`, `.claude/settings.json` hooks, and Claude plugin layouts. Native paths are `.grok/skills/`, `.grok/hooks/*.json`, and `.grok/agents/`. Skill frontmatter supports `when-to-use` in addition to the fields above. Project hooks require `/hooks-trust` (or `--trust`). See https://docs.x.ai/build/features/skills-plugins-marketplaces and https://docs.x.ai/build/features/hooks.
- Hermes Agent reads the Agent Skills spec as-is. Spec-defined fields (`name`, `description`, `license`, `compatibility`, `metadata`) are parsed and stored; harness-specific extensions (`user-invocable`, `argument-hint`, `allowed-tools`, `disable-model-invocation`, `model`, `effort`, `context`, `agent`, `hooks`) are unknown keys and silently ignored. Hermes has no hook surface, no per-skill tool ACL, and no slash-command equivalent of `user-invocable` (skills are loaded via `/skill <name>` or auto-loaded; sub-commands like `/impeccable polish` are routed from the skill body, not declared in frontmatter). Hermes adds two frontmatter fields not in the spec: `platforms:` (OS filter; default = all) and `environments:` (relevance gate over `kanban`, `docker`, `s6`). Unknown fields are silently ignored.
- Kiro recognizes `user-invocable` and `disable-model-invocation` per community reports but does not formally document them.
- Antigravity supports standard Agent Skills spec frontmatter fields (`name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`).
- Unknown fields are silently ignored by all harnesses.

## Hook surface used by Impeccable

| Harness | Edit hook | Startup hook | Manifest location | Notes |
|---------|:---------:|:------------:|-------------------|-------|
| Claude Code | Yes (`PostToolUse`) | No | `.claude/settings.json` | Project-local settings entry installed by `npx impeccable skills install/update`. Runs `.claude/skills/impeccable/scripts/hook.mjs`. |
| Codex CLI | Yes (`PostToolUse`) | No | `.codex/hooks.json` | Project-local manifest installed with the `.agents/skills/impeccable` payload. Runs `.agents/skills/impeccable/scripts/hook.mjs` from the git root. Requires normal `/hooks` trust approval. |
| Cursor | Yes (`preToolUse`) | No | `.cursor/hooks.json` | Project-level manifest installed with `.cursor/skills/impeccable`. Runs `hook-before-edit.mjs` to block bad proposed writes before they land. Reloads on save; restart Cursor if hooks do not pick up. |
| Devin CLI | Yes (`PostToolUse`) | No | `.devin/hooks.v1.json` | Project-local bare manifest installed with `.devin/skills/impeccable`. Claude-compatible syntax; `${DEVIN_PROJECT_DIR}` resolves the project root. Also runs a Stop deep pass. |
| Grok Build | Yes (`PostToolUse`) | No | `.grok/hooks/impeccable.json` | Project-local manifest installed with `.grok/skills/impeccable`. Claude-compatible matchers (`Edit\|Write\|MultiEdit`) alias to Grok tools. Also runs a Stop deep pass. Requires `/hooks-trust` or `--trust`. Plugin installs use `plugin/hooks/hooks.json` with `${CLAUDE_PLUGIN_ROOT}` (aliased to `GROK_PLUGIN_ROOT`). |
| All other harnesses | No | No | n/a | No documented hook surface today. Skill and commands still ship. |

## Skill Directory Structure

| Harness | Native directory | Also reads |
|---------|-----------------|------------|
| Claude Code | `.claude/skills/` | - |
| Cursor | `.cursor/skills/` | `.agents/skills/`, `.claude/skills/` |
| Devin CLI | `.devin/skills/` (project), `~/.config/devin/skills/` (global; `%APPDATA%\devin\skills\` on Windows) | `.windsurf/skills/`, `.agents/skills/`, plus Claude/Cursor imports when enabled |
| Devin (ex-Windsurf Desktop, legacy path) | `.windsurf/skills/` (project), `~/.codeium/<channel>/skills/` (global, channel = `windsurf` / `windsurf-next` / `windsurf-insiders`) | Imported by Devin CLI when `read_config_from.windsurf` is on (default) |
| Gemini CLI | `.gemini/skills/` | `.agents/skills/` |
| Codex CLI | `.agents/skills/` (primary) | - |
| GitHub Copilot | `.github/skills/` | `.agents/skills/`, `.claude/skills/` |
| Kiro | `.kiro/skills/` | - |
| OpenCode | `.opencode/skills/` | `.agents/skills/`, `.claude/skills/` |
| Pi | `.pi/skills/` (project), `~/.pi/agent/skills/` (global) | `.agents/skills/` |
| Qoder | `.qoder/skills/` | `~/.qoder/skills/` (user-level) |
| Trae China | `.trae-cn/skills/` | TBD |
| Trae International | `.trae/skills/` | TBD |
| Rovo Dev | `.rovodev/skills/` | `~/.rovodev/skills/` (user-level) |
| Mistral Vibe | `.vibe/skills/` (project), `~/.vibe/skills/` (global) | `.agents/skills/` (project), `~/.agents/skills/` (global) |
| Grok Build | `.grok/skills/` (project), `~/.grok/skills/` (global) | `.agents/skills/`, `.claude/skills/`, `.cursor/skills/` (Claude/Cursor compat, configurable) |
| Hermes Agent | `.hermes/skills/` (project), `~/.hermes/skills/` (global) | `skills.external_dirs` config (no automatic `.agents/skills/` fallback) |
| Antigravity | `.agent/skills/` (project), `~/.gemini/config/skills/` (global) | `.agents/skills/` (project), `~/.agents/skills/` (global) |

All harnesses support the `{skill-name}/SKILL.md` directory structure with optional `reference/`, `scripts/`, and `assets/` subdirectories.

## Native Subagent Directory Structure (Impeccable emission targets)

> **Scope:** this table is **where Impeccable emits native subagent files**, not a
> map of which harnesses support subagents. Subagents are broadly supported now:
> Cursor (auto-delegation + `/name` invocation, https://cursor.com/docs/subagents),
> GitHub Copilot, and Google Antigravity ship them too. Impeccable only writes
> native files where there is a stable, documented on-disk format to target.

| Harness | Native directory | File format |
|---------|------------------|-------------|
| Claude Code | `.claude/agents/` (installed plugin) | Markdown with YAML frontmatter |
| Devin CLI | `.devin/agents/` (project) | Markdown with YAML frontmatter (Claude-compatible) |
| Grok Build | `.grok/agents/` (project) and plugin `agents/` | Markdown with YAML frontmatter (Claude-compatible) |
| Codex CLI | `<skill>/agents/` (nested, auto-discovered) | TOML |

Impeccable keeps canonical agent prompts under `skill/agents/` and emits provider-native files only for harnesses with a documented on-disk subagent format. Claude reads its agents from the installed plugin; Devin reads Claude-compatible markdown agents from project `.devin/agents/`; Grok reads the same markdown agents from the plugin package and from project `.grok/agents/`; Codex auto-discovers the TOML bundled inside the installed skill's own `agents/` folder, so the normal skills install carries it with no separate sidecar.

**Spawn / permission model** (matters more than directory support when building skills):

| Harness | Who can spawn a subagent |
|---------|--------------------------|
| Claude Code | Programmatically, from within the skill/agent flow. |
| Grok Build | Programmatically via `spawn_subagent` (built-in types plus project/user agents under `.grok/agents/`). |
| Codex CLI | Only if the user has allowed sub-agents / parallel work; otherwise the skill must ask once, then stop (see `skill/reference/critique.md` `<codex>` gate). |
| Cursor | Agent-chosen: auto-delegated by the Agent, or user-invoked via `/name`. Not reliably skill-spawnable. |
| Others | Varies; treat as unavailable unless verified, and degrade loudly. |

## Placeholder / Variable Substitution

Claude Code supports runtime variable substitution directly in SKILL.md bodies: `$ARGUMENTS`, `$0`-`$N`, `${CLAUDE_SKILL_DIR}`, `${CLAUDE_SESSION_ID}`. No other harness supports substitution in skills.

Some harnesses have separate "custom commands" systems (distinct from skills) with their own substitution:

| Harness | Command system | Substitution syntax |
|---------|---------------|-------------------|
| Gemini CLI | `.gemini/commands/` (TOML) | `{{args}}`, `!{shell}`, `@{file}` |
| Codex CLI | `.codex/prompts/` | `$ARGNAME` |
| OpenCode | `.opencode/commands/` | `$ARGUMENTS`, `$1`-`$N`, `` !`shell` `` |

Our build system handles cross-provider placeholders at compile time via `replacePlaceholders()` for `{{model}}`, `{{config_file}}`, `{{ask_instruction}}`, and `{{available_commands}}`.
