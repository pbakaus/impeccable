## Context

See proposal.md "Why" for motivation. This design sits on the existing provider mechanism: every provider is an entry in `scripts/lib/transformers/providers.js` with a `configDir`, `providerTags`, `placeholderProvider`, optional `agentFormat`, and optional `emitHooks`. Devin CLI is a Claude-compatible harness (verified against `docs.devin.ai.cli/`) that reads `.devin/` project config and `~/.config/devin/` (plus `%APPDATA%\devin\` on Windows) global config; Devin Desktop (ex-Windsurf) users have `.windsurf/` as their legacy project path today. Both are "one provider" targets in the same static-shape pipeline, so this change mostly adds config entries, not new machinery.

## Goals / Non-Goals

**Goals:**
- Emit two new provider builds: `devin` (fully featured) and `devin-legacy` (skills-only).
- Make `.devin` / `.windsurf` first-class install targets in the CLI (`--providers=devin`, `--providers=windsurf`).
- Surface both in download endpoints and documentation.
- Keep the paternal `placeholderProvider: 'agents'` reuse so Devin setup text matches the existing agent-style installs.

**Non-Goals:**
- Supporting Devin's experimental `subagent` / `agent` routing fields. The harness treats them the same as Claude's, so we emit Claude-style `tools:` on the subagent frontmatter and let Devin inherit `tools` → `allowed-tools` on import (per its docs "Both formats are supported").
- Implementing the `/hooks` CLI listing for Devin (Claude-format hooks work; the label is handled by Devin itself).
- Adding `devin` to `build:release` default sync path gating. The `syncConfigs` filter today excludes `.codex`; we extend it cautiously to exclude `.windsurf` too until legacy usage is proven via real installs.
- Shipping MCP config for Devin (out of scope for this change).

## Decisions

### D1 — `configDir` mapping

- `devin` → `.devin` (skills, subagents, hooks)
- `devin-legacy` → `.windsurf` (skills only)

Rationale: Devin reads project skills from `.devin/skills/`, `.windsurf/skills/`, and `.agents/skills/` (verified). Emitting the richer `.devin` payload (agents + hooks) is safe because legacy Windsurf files still resolve at `.windsurf/` per the harness.

Alternatives considered: only emit `.devin` — rejected, because existing Windsurf bookmarks load legacy `.windsurf` files today; making `.devin` mandatory would silently abandon them.

### D2 — Reuse "agents" placeholder provider

Both `devin` and `devin-legacy` set `placeholderProvider: 'agents'`. Devin reads and honors `.agents/skills` as a project path, so the placeholder text aligns with its real behavior. Alternatives considered: a new placeholder entry — unnecessary duplication for one char-based override (`command_prefix: '/'`).

### D3 — Hook manifest shape

Devin documents "Claude Code compatible" hooks with a dedicated `.devin/hooks.v1.json` file (no wrapper key, unlike `.devin/config.json` nested under `"hooks"`). The build therefore writes `.devin/hooks.v1.json` and uses the `DEVIN_PROJECT_DIR` env var in the command (documented by Devin as the project root). Alternatives considered: `.devin/config.json` — rejected, its "hooks" nested key adds a wrapper where none is needed and the standalone file is the documented path.

### D4 — Subagent emission

Devin reads `.devin/agents/` using the same Claude-format `.md` shape (frontmatter `name`/`description`/`tools`/`model`/`effort`/`maxTurns`). Because Devin explicitly supports importing `tools` from Claude's format (per docs), `buildClaudeAgent` output lands correctly without a new `buildDevinAgent` formatter. Deferred feature of Devin's imported `claude` path: since Devin supports nested `agents/<name>/AGENT.md` too, the emitted flat `<name>.md` is still safe — Devin treats the flat layout as first-class.

Alternatives considered: emit Codex `.toml` — rejected, Devin does not recognize it.

### D5 — Global-path handling in the CLI

Devin's global skills location is `~/.config/devin/skills/`, and legacy users sit on `~/.codeium/<channel>/skills/` (channel = windsurf / windsurf-next / windsurf-insiders). The CLI adds `HOME_SKILLS_DIR_OVERRIDES['.devin']` returning the XDG path; detection hints add `~/.devin`, `~/.windsurf`, `~/.codeium/windsurf`, `~/.codeium/windsurf-next`, and `~/.codeium/windsurf-insiders` so both handle the common two paths.

Windows `%APPDATA%\devin\` is resolved via an override for consistency with Linux.

Alternatives considered: a hardcoded Windows path — rejected, the override handles XDG semantics.

### D6 — Double-install guard

Devin imports legacy `.windsurf` files automatically when `read_config_from.windsurf` is enabled (the default). If the user installs both `devin` and `windsurf` providers into the same Devin project, the same skill content can land twice (once under `.devin/`, once imported via `.windsurf/`). The CLI adds a warning that recommends picking one, and `skills.mjs` prints an explicit warning when both targets are selected.

Alternatives considered: silently coexist — rejected, this is the failure mode users will hit.

### D7 — Release sync gating

`.devin` is a tracked root harness folder candidate; `.windsurf` is the legacy path and is expected to shrink over time. `scripts/build.js` keeps the existing `configDir !== '.codex'` sync filter and extends it to also exclude `.windsurf` from tracked-root sync, so Devin CLI gets direct install support immediately while the legacy path ships only through the download/universal bundle.

Alternatives considered: sync both — rejected, `.windsurf` is a legacy artifact that would pollute root harness output for a decreasing-user surface.

## Risks / Trade-offs

- [Devin hooks pre-1.0 env var undocumented in docs but confirmed at `docs.devin.ai/cli/extensibility/hooks/overview`] → We pin the manifest to `${DEVIN_PROJECT_DIR}` (the documented surface) and keep the Claude fallback in `.claude` paths `read_config_from` already offers.
- [`devin-legacy` clones Skill text without hooks/subagents → users on modern Windsurf get a degraded experience unless they install Devin CLI anyway] → Docs call this out explicitly and mark `devin` as the preferred target for new work.
- [Legacy Codeium paths use channel-dependent folders and user may run multiple channels] → Detection hints cover all three known channels; each maps to `devin-legacy`.
- [`~/.config/devin` is a global-scope target while `.devin/` is project-scope → both must be accepted by `impeccable skills link`] → Both are added to `PROVIDER_DIRS` so linking works at both scopes.
- [A user with `.devin` and `.windsurf` in one project may see the same skill loaded twice via Devin's `read_config_from` import] → The CLI install path warns when both providers are selected (see D6).

## Open Questions

- Does Devin CI/Codeium support `argument-hint` / `user-invocable` frontmatter passthrough as an official extension, or does it ignore them? If ignored, we may drop the fields from `frontmatterFields` in a follow-up without changing the spec shape.
- Does Devin Desktop ship its own bundled CLI that still reads `.windsurf/` at project level even after the migrate-to-`.devin` transition? If yes, the `devin-legacy` build may become the primary emission path and `devin` sinks to an import of `agents`. This is a follow-up decision, not blocking this change.
