## 1. Provider registration in the build pipeline

- [x] 1.1 Add `devin` entry to `PROVIDERS` in `scripts/lib/transformers/providers.js` with `configDir: '.devin'`, `displayName: 'Devin CLI'`, `providerTags: ['devin']`, `placeholderProvider: 'agents'`, `agentFormat: 'claude-md'`, `emitHooks: 'devin'`, `hooksManifestRel: 'hooks.v1.json'`, and verify the entry compiles
- [x] 1.2 Add `devin-legacy` entry to `PROVIDERS` in `scripts/lib/transformers/providers.js` with `configDir: '.windsurf'`, `displayName: 'Devin (ex-Windsurf Desktop)'`, `providerTags: ['devin-legacy', 'devin']`, `placeholderProvider: 'agents'`, and no `agentFormat` / `emitHooks`, and verify the entry compiles
- [x] 1.3 Add `devin` and `devin-legacy` to `PROVIDER_BLOCK_TAGS` in `scripts/lib/utils.js` if `providerTags` is used anywhere as a manifest (verify the provider set is consistent)
- [x] 1.4 Export `transformDevin` and `transformDevinLegacy` in `scripts/lib/transformers/index.js` with spy-friendly named exports and verify the exports exist

## 2. Hook emitter support for Devin

- [x] 2.1 Add `buildDevinHooksManifest()` to `scripts/lib/transformers/hooks.js` that uses `${DEVIN_PROJECT_DIR}` in the command path and emits the bare Claude format (no top-level `description`), and verify the timezone `timeout` numbers match
- [x] 2.2 Add `'devin'` to the `hooksJsonFor(provider, options)` switch returning `buildDevinHooksManifest`, and verify the smoke test passes

## 3. CLI install / link / detection support

- [x] 3.1 Add `.devin` and `.windsurf` to `PROVIDER_DIRS` in `cli/bin/commands/skills.mjs`, and verify the prompt system lists both providers
- [x] 3.2 Add `devin: '.devin'`, `windsurf: '.windsurf'`, `'devin-cli': '.devin'`, `'devin-legacy': '.windsurf'`, and `devin-desktop: '.windsurf'` to `PROVIDER_ALIASES`, and verify alias resolution works
- [x] 3.3 Add `PROVIDER_DISPLAY` entries for `.devin` and `.windsurf` with names "Devin CLI" and "Devin (ex-Windsurf Desktop)", and `PROVIDER_INPUT_ORDER` gets both, and verify `formatProviderList` output
- [x] 3.4 Add `HOME_SKILLS_DIR_OVERRIDES['.devin']` returning `~/.config/devin/skills` (or `%APPDATA%\devin\skills` on Windows), and `HOME_SKILLS_DIR_OVERRIDES['.windsurf']` returning `~/.codeium/windsurf/skills`, and verify both overrides resolve on test isolation
- [x] 3.5 Add detection entries to `GLOBAL_HARNESS_HINTS` for `.devin`, `.windsurf`, `.config/devin/skills`, `.codeium/windsurf`, `.codeium/windsurf-next`, and `.codeium/windsurf-insiders`, and verify the detection map picks up the right providers

## 4. Double-install guard and UX copy

- [x] 4.1 In `chooseInstallProviders` (or `promptDetectedInstallMode`), warn if both `devin` and `windsurf` providers are selected due to Devin's auto-import of legacy `.windsurf` (see design D6), and verify the warning emits once per prompt

## 5. Download provider exposure

- [x] 5.1 Add `devin: '.devin'` and `'devin-legacy': '.windsurf'` to `FILE_DOWNLOAD_PROVIDER_CONFIG_DIRS` in `cli/lib/download-providers.js`, and verify map round-trips

## 6. Documentation

- [x] 6.1 Add README.md entries under "supported providers" for Devin CLI and Devin (ex-Windsurf Desktop), including their project and global paths, and verify the text matches existing style
- [x] 6.2 Add `docs/HARNESSES.md` rows for `.devin/skills` (project + global), `.windsurf/skills` (legacy), the `~/.config/devin` override, and Codeium channel fallback, and verify the table is consistent
- [x] 6.3 Update `docs/DEVELOP.md` examples to reference Devin alongside other providers, and verify examples parse

## 7. Tests

- [x] 7.1 Add `tests/build.test.js` coverage for `transformDevin` and `transformDevinLegacy` that asserts subagent files land in `.devin/agents/` but not in `.windsurf/agents/`, skills/references/scripts land in both, and the hook manifest lands only in `.devin`, and verify all assertions pass
- [x] 7.2 Add `tests/skills-cli.test.js` coverage for `devin` and `devin-legacy` provider linking/detection, including the double-install warning, and verify all assertions pass

## 8. Release sync wiring

- [x] 8.1 Update `scripts/build.js` `syncConfigs` filter to include `.windsurf` in the tracked harness exclusion list alongside `.codex`, and verify `bun run build:release` emits expected files

## 9. Validation

- [x] 9.1 Run `bun run build` and verify `dist/devin` and `dist/devin-legacy` contain expected files
- [x] 9.2 Run `bun test tests/build.test.js` and `bun test tests/skills-cli.test.js` and verify the new providers pass
- [x] 9.3 Run `bun run test` end-to-end and verify the full suite passes including new provider paths
