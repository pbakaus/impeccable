# Harness Skills Capabilities Reference

Source of truth for what each AI coding harness supports in terms of agent skills.
Used to inform provider configs in `scripts/lib/transformers/providers.js`.

Last verified: 2026-04-28

## Official Documentation

| Harness | Docs URL |
|---------|----------|
| Claude Code | https://code.claude.com/docs/en/skills |
| Cursor | https://cursor.com/docs/context/skills |
| Gemini CLI | https://geminicli.com/docs/cli/skills/ |
| Codex CLI | https://developers.openai.com/codex/skills |
| GitHub Copilot (Agents) | https://code.visualstudio.com/docs/copilot/customization/agent-skills |
| Kiro | https://kiro.dev/docs/skills/ |
| OpenCode | https://opencode.ai/docs/skills/ |
| Pi | https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/skills.md |
| Qoder | https://docs.qoder.com/extensions/skills |
| Trae | TBD (no official skills docs found yet) |
| Rovo Dev | https://support.atlassian.com/rovo/docs/extend-rovo-dev-cli-with-agent-skills |
| Antigravity | https://antigravity.google/docs/skills |

## Spec Compliance

All harnesses follow the [Agent Skills specification](https://agentskills.io/specification) to varying degrees. The spec defines these frontmatter fields: `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`.

Provider-specific extensions beyond the spec: `user-invocable`, `argument-hint`, `disable-model-invocation`, `allowed-tools` (extended syntax), `model`, `effort`, `context`, `agent`, `hooks`, `subtask`, `mcp`.

## Frontmatter Support

Fields marked with * are spec-standard. Others are provider extensions.

| Field | Claude Code | Cursor | Gemini | Codex | Copilot | Kiro | OpenCode | Pi | Qoder | Rovo Dev | Antigravity |
|-------|:-----------:|:------:|:------:|:-----:|:-------:|:----:|:--------:|:--:|:-----:|:--------:|:-----------:|
| `name`* | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| `description`* | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| `license`* | Yes | Yes | Ignored | No | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| `compatibility`* | Yes | Yes | Ignored | No | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| `metadata`* | Yes | Yes | Ignored | No | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| `allowed-tools`* | Yes | No | Ignored | No | No | No | Yes | Yes | Yes | Yes | Yes |
| `user-invocable` | Yes | No | No | No | Yes | No | Yes | No | Yes | Yes | No |
| `argument-hint` | Yes | No | No | No | Yes | No | Yes | No | Yes | Yes | No |
| `disable-model-invocation` | Yes | Yes | No | No | Yes | No | Yes | Yes | TBD | TBD | TBD |
| `model` | Yes | No | No | No | No | No | Yes | No | No | No | No |
| `effort` | Yes | No | No | No | No | No | No | No | No | No | No |
| `context` | Yes | No | No | No | No | No | No | No | No | No | No |
| `agent` | Yes | No | No | No | No | No | Yes | No | No | No | No |
| `hooks` | Yes | No | No | Yes | No | No | No | No | No | No | No |

Notes:
- Gemini CLI validates only `name` and `description`; other spec fields are parsed but ignored.
- Codex CLI uses a separate `agents/openai.yaml` sidecar for skill metadata (icons, branding, MCP tools, invocation control). Codex also auto-discovers subagents bundled inside an installed skill's `agents/` folder (TOML), which is how Impeccable ships its asset-producer. Standalone custom agents can still live under `.codex/agents/` or `~/.codex/agents/`, but Impeccable no longer installs anything there.
- Codex CLI hooks ship under `[features].hooks = true` (still flagged), require `/hooks` trust ceremony per-update, and are disabled on Windows.
- Kiro recognizes `user-invocable` and `disable-model-invocation` per community reports but does not formally document them.
- Unknown fields are silently ignored by all harnesses.
- Antigravity's own skills spec documents `name`, `description`, `license`, `compatibility`, `metadata`, and `allowed-tools` with explicit constraints (e.g. `name` max 64 chars, `description` max 1024 chars, `compatibility` max 500 chars), confirming all six spec-standard fields are respected, not just parsed.

## Hook surface used by Impeccable

| Harness | Edit hook | Startup hook | Manifest location | Notes |
|---------|:---------:|:------------:|-------------------|-------|
| Claude Code | Yes (`PostToolUse`) | No | `.claude/settings.json` | Project-local settings entry installed by `npx impeccable skills install/update`. Runs `.claude/skills/impeccable/scripts/hook.mjs`. |
| Codex CLI | Yes (`PostToolUse`) | No | `.codex/hooks.json` | Project-local manifest installed with the `.agents/skills/impeccable` payload. Runs `.agents/skills/impeccable/scripts/hook.mjs` from the git root. Requires normal `/hooks` trust approval. |
| Cursor | Yes (`preToolUse`) | No | `.cursor/hooks.json` | Project-level manifest installed with `.cursor/skills/impeccable`. Runs `hook-before-edit.mjs` to block bad proposed writes before they land. Reloads on save; restart Cursor if hooks do not pick up. |
| All other harnesses | No | No | n/a | No documented hook surface today. Skill and commands still ship. |

## Skill Directory Structure

| Harness | Native directory | Also reads |
|---------|-----------------|------------|
| Claude Code | `.claude/skills/` | - |
| Cursor | `.cursor/skills/` | `.agents/skills/`, `.claude/skills/` |
| Gemini CLI | `.gemini/skills/` | `.agents/skills/` |
| Codex CLI | `.agents/skills/` (primary) | - |
| GitHub Copilot | `.github/skills/` | `.agents/skills/`, `.claude/skills/` |
| Kiro | `.kiro/skills/` | - |
| OpenCode | `.opencode/skills/` | `.agents/skills/`, `.claude/skills/` |
| Pi | `.pi/skills/` | `.agents/skills/` |
| Qoder | `.qoder/skills/` | `~/.qoder/skills/` (user-level) |
| Trae China | `.trae-cn/skills/` | TBD |
| Trae International | `.trae/skills/` | TBD |
| Rovo Dev | `.rovodev/skills/` | `~/.rovodev/skills/` (user-level) |
| Antigravity | `.agent/skills/` (legacy path, deliberately chosen — see note) | `.agents/skills/` (current default per Antigravity's own docs, but content-owned by Codex CLI's `agents` provider below) |

All harnesses support the `{skill-name}/SKILL.md` directory structure with optional `reference/`, `scripts/`, and `assets/` subdirectories.

Antigravity's own docs state it now defaults to `.agents/skills/` (shared with Codex CLI) and keeps `.agent/skills/` only for backward compatibility. We ship to `.agent/skills/` anyway: `.agents/skills/impeccable/` is already generated content owned by the Codex `agents` provider, with `{{model}}` → `GPT` and `{{command_prefix}}` → `$` baked into the body text. Writing Antigravity's own Gemini/`/`-prefixed wording to that same path would either silently clobber Codex's output (same destination, two different generators) or require reworking Codex's wording — out of scope for this provider's addition. Net effect: a pure-Antigravity project gets correct content at the legacy path; a project with both Codex and Antigravity will also pick up the Codex-flavored copy at `.agents/skills/`, which still works, just with the wrong model name/prefix in the prose.

## Native Subagent Directory Structure

| Harness | Native directory | File format |
|---------|------------------|-------------|
| Claude Code | `.claude/agents/` (installed plugin) | Markdown with YAML frontmatter |
| Codex CLI | `<skill>/agents/` (nested, auto-discovered) | TOML |

Impeccable keeps canonical agent prompts under `skill/agents/` and emits provider-native files only for harnesses with documented subagent formats. Claude reads its agents from the installed plugin; Codex auto-discovers the TOML bundled inside the installed skill's own `agents/` folder, so the normal skills install carries it with no separate sidecar.

Antigravity has no equivalent here. Its `.agent/workflows/` directory (description-only frontmatter, saved prompts invoked via `/workflow-name` or called from another workflow) is a slash-command system like Gemini's `.gemini/commands/`, not an isolated, tool-restricted subagent dispatch. `skill/agents/manual-edit-applier.md` has no faithful mapping onto that model, so Impeccable does not generate Antigravity workflow files.

## Placeholder / Variable Substitution

Claude Code supports runtime variable substitution directly in SKILL.md bodies: `$ARGUMENTS`, `$0`-`$N`, `${CLAUDE_SKILL_DIR}`, `${CLAUDE_SESSION_ID}`. No other harness supports substitution in skills.

Some harnesses have separate "custom commands" systems (distinct from skills) with their own substitution:

| Harness | Command system | Substitution syntax |
|---------|---------------|-------------------|
| Gemini CLI | `.gemini/commands/` (TOML) | `{{args}}`, `!{shell}`, `@{file}` |
| Codex CLI | `.codex/prompts/` | `$ARGNAME` |
| OpenCode | `.opencode/commands/` | `$ARGUMENTS`, `$1`-`$N`, `` !`shell` `` |

Our build system handles cross-provider placeholders at compile time via `replacePlaceholders()` for `{{model}}`, `{{config_file}}`, `{{ask_instruction}}`, and `{{available_commands}}`.
