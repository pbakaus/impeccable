## Purpose

Makes Devin CLI (the successor to Windsurf, bundled with Devin Desktop and also installable standalone) a supported Impeccable provider, covering both its native `.devin` config dir and the legacy `.windsurf` path that existing users have in place. The build emits a Claude-compatible skills build, Claude-format subagents, and Claude-format hooks for `.devin`, plus a skills-only `.windsurf` build for users still on the legacy path.

## Requirements

### Requirement: Devin CLI provider build

The system SHALL emit a provider build under `dist/devin/` for the `.devin` config dir, containing `SKILL.md`, reference files, scripts, subagents in `agents/`, and a hook manifest at `.devin/hooks.v1.json`.

#### Scenario: Build emits Devin CLI output

- **WHEN** `bun run build` runs
- **THEN** `dist/devin/.devin/skills/impeccable/` contains `SKILL.md`, `reference/`, `scripts/`, and an `agents/` subagent file, and `dist/devin/.devin/hooks.v1.json` exists

#### Scenario: Devin CLI hook manifest uses the Devin project env var

- **WHEN** inspecting `dist/devin/.devin/hooks.v1.json`
- **THEN** hook commands reference `${DEVIN_PROJECT_DIR}` so they resolve at the Devin project root

#### Scenario: Devin CLI subagents use the `.devin/agents/` path

- **WHEN** Devin loads the Impeccable skill
- **THEN** the parent thread can delegate to the emitted Claude-format subagent file under `.devin/agents/`

### Requirement: Devin legacy provider build

The system SHALL emit a provider build under `dist/devin-legacy/` for the `.windsurf` config dir, containing `SKILL.md`, reference files, and scripts (no subagents or hooks, because Devin Desktop is documented as a CLI-bundled surface).

#### Scenario: Build emits Devin legacy output

- **WHEN** `bun run build` runs
- **THEN** `dist/devin-legacy/.windsurf/skills/impeccable/` contains `SKILL.md`, `reference/`, and `scripts/`, and `dist/devin-legacy/.windsurf/skills/` does not contain `agents/` or `hooks.v1.json`

#### Scenario: Legacy build avoids double-installing when Devin auto-imports `.devin`

- **WHEN** a user installs `devin` and also runs `impeccable skills link --providers=windsurf` in a Devin project that also has `.devin/`
- **THEN** the skills CLI warns that installing `windsurf` alongside `devin` can double-load the same skill in Devin's imported legacy path (or the user is prompted to choose one)

### Requirement: Devin CLI install path

The system SHALL recognize `.devin` and `.windsurf` as valid project install targets in `impeccable skills install` and `impeccable skills link`.

#### Scenario: `.devin` accepted as a provider input

- **WHEN** running `./bin/impeccable.js skills install --providers=devin`
- **THEN** project-level `.devin/skills/` is the target

#### Scenario: `.windsurf` accepted as a provider input

- **WHEN** running `./bin/impeccable.js skills install --providers=windsurf`
- **THEN** project-level `.windsurf/skills/` is the target

### Requirement: Devin global detection

The system SHALL detect Devin CLI from `~/.devin` and `~/.windsurf` as project-level hints, and from `~/.config/devin/skills` and `~/.codeium/<channel>/skills` as global-scope hints, in the same pre-selection menu as every other provider.

#### Scenario: Detection hints pre-select Devin

- **WHEN** running `impeccable skills install` in a project with `~/.devin` or `~/.windsurf` present
- **THEN** the provider list includes `devin` (or `devin-legacy` if only `.windsurf` exists)

### Requirement: Devin download provider exposure

The system SHALL expose `devin` and `devin-legacy` in the download provider config (`cli/lib/download-providers.js`).

#### Scenario: Download endpoints list both

- **WHEN** the Cloudflare Pages download function loads
- **THEN** `FILE_DOWNLOAD_PROVIDER_CONFIG_DIRS.devin` and `FILE_DOWNLOAD_PROVIDER_CONFIG_DIRS['devin-legacy']` resolve to `.devin` and `.windsurf` respectively

### Requirement: Documentation updated

The system SHALL document both Devin providers in `README.md` and `docs/HARNESSES.md`.

#### Scenario: README lists Devin

- **WHEN** a user reads the providers list
- **THEN** "Devin CLI" and "Devin (ex-Windsurf Desktop)" appear with their paths (`/devin` project, `~/.devin` global, and `.windsurf` legacy)

#### Scenario: Harness doc includes Devin-specific notes

- **WHEN** reading `docs/HARNESSES.md`
- **THEN** a Devin section covers `.devin/.devin` hooks/subagents and the `.windsurf` fallback, plus the trade-off of choosing `windsurf` when Devin imports `.devin`
