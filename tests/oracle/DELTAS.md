# Accepted deltas

Cases listed here differ from their JS golden on purpose. Each entry names the
case id, what differs, and why it is an improvement. Nothing gets on this list
without review.

Format: `- \`<case-id>\`: <what differs> (<why>)`

## Recorded 2026-08-17: the engine names its own commands

The JS scripts printed their own file names in usage lines, directives, and
the hook manifests they wrote. The binary prints the verb (`impeccable doctor`)
or the launcher path (`"<scripts>/impeccable" hook`). Each case below was
re-recorded from the engine after a line-level review confirmed the only change
is that wording; behavior, exit codes, and every other byte are unchanged.

- `doctor-help`, `doctor-help-short`: `Usage: node doctor.mjs …` is now `Usage: impeccable doctor [--json] [--fix] [--target <path>]`.
- `doctor-legacy-text`: the closing hint reads `Run \`<self> doctor --fix\``.
- `pin-usage-no-args`, `pin-usage-one-arg`: `Usage: impeccable pin <pin|unpin> <command>`.
- `surface-brief-usage`, `surface-brief-unknown`, `surface-brief-write-usage`: usage lines name `impeccable surface-brief`.
- `critique-usage`, `critique-unknown`: usage lines name `impeccable critique-storage`.
- `context-monorepo-target-missing`: MONOREPO_TARGET_REQUIRED says `impeccable context ran without --target`.
- `hadmin-on`, `hadmin-on-twice`, `hadmin-off-then-status`, `hadmin-on-repairs-existing-manifest`, `hadmin-on-malformed-manifest-backup`: `hooks on` writes manifests that run the launcher (`"<scripts>/impeccable" hook`, Cursor `hook-before-edit`) instead of `node "<scripts>/hook.mjs"`.
- `hook-session-fresh-then-pending-then-stop`, `hook-session-two-sessions`, `hbe-denial-downgrade-after-6`: the short footer names `impeccable hooks ignore-value`.
- `live-help`, `live-accept-help`, `live-inject-help`, `live-insert-help`, `live-server-help`, `live-resume-help`, `live-commit-help`, `live-discard-help`, `live-complete-help`, `live-complete-no-id`: usage text names `impeccable live*` verbs.
- `live-server-already-running`, `live-daemon-server-status-poll-complete`, `live-status-empty`, `live-status-generating`, `live-status-many-sessions`, `live-status-stale-server-json`, `live-status-legacy-sessions-dir`, `live-status-from-subdir`, `live-status-manual-apply`, `live-resume-manual-apply`, `live-status-mount-failed`, `live-resume-mount-failed`, `live-resume-generating`, `live-resume-by-id`, `live-resume-first-active-sorted`, `live-resume-accept-requested`, `live-resume-carbonize-required`: recovery hints and next-command lines spell `<self> live-poll` / `live-server` / `live-complete` / `live-commit-manual-edits` instead of the `.mjs` names.

## Recorded 2026-08-17: live-inject adds `'wasm-unsafe-eval'` to a CSP meta script-src

The detector the live overlay loads from the helper origin is a WebAssembly
module in the engine (its `docs/WASM-BUNDLE.md`); a `script-src` that names the
origin but not `'wasm-unsafe-eval'` still refuses to compile it. The JS
`patchCspMeta` predates the wasm bundle and appended only the origin.

- `live-inject-csp-meta-no-connect-src`: the patched `<meta http-equiv="Content-Security-Policy">` reads `script-src 'self' http://localhost:8412 'wasm-unsafe-eval'` (was `script-src 'self' http://localhost:8412`). The `data-impeccable-csp-original` marker, the `connect-src` and `img-src` additions, idempotence, and the revert on unpatch are unchanged. `live-inject-vite-csp-meta` and `live-inject-next-jsx` carry meta tags the patch does not touch, so their goldens did not move.

## Recorded 2026-08-31: detector-engine ports landed, gap goldens restored

The section previously here pinned the gap between main's post-freeze detector
fixes and the engine. Those fixes are now ported (engine repo commits:
`c0aa75f` oklch in visual-contrast/neon-text, upstream 1b7da15b #592;
`5cdeec8` color-mix nested hex, upstream 54440319 #578; the 1D grid fix,
upstream a236137b #615, rode along in `9046e8f` via a concurrent staging race;
`6d36231` comment stripping for regex matchers, upstream 067665cc #589 +
ddb60993 + ba873f75 + 9a7d0fbc; `33aef88` root-relative linked stylesheets,
upstream 2b88aa52 #652 + daae1d41; `6d0ecf1` URL userinfo redaction with
origin-scoped basic auth, upstream d5873ff8 + d690349d #657; `09f8ae7` inert
exact ignore-value refusal, upstream be87f5eb #662; `20c8347` the
comp-fidelity rules organic-clip-path and buried-raster, upstream 58561610).
The affected goldens were re-recorded from the fixed engine and each json
fixture golden was byte-verified against the last JS engine state in history
(`db1462b9^`, which carries both main's drift and the comp-fidelity rules):

- Moved to post-fix behavior: `detect-fixture-json-codex-grid-1d-pass-html`,
  `detect-fixture-text-codex-grid-1d-pass-html` (no finding, exit 0),
  `detect-fixture-json-organic-clip-path-html`,
  `detect-fixture-text-organic-clip-path-html`,
  `detect-fixture-json-buried-raster-html`,
  `detect-fixture-text-buried-raster-html` (the new rules fire),
  `detect-fixture-json-glow-html`, `detect-fixture-text-glow-html` (glow's
  `.photo-opaque-grad` column now carries its intended buried-raster finding),
  and the sweeps `detect-dir-json-all-fixtures`, `detect-dir-text-all-fixtures`,
  `detect-dir-quiet-all-fixtures`, `detect-no-advisory-json`,
  `detect-no-advisory-text`.
- Unchanged on re-record (already matched the fixed JS in the static engine):
  `detect-fixture-json-color-html`, `detect-fixture-text-color-html`,
  `detect-fixture-json-oklch-neon-text-html`,
  `detect-fixture-text-oklch-neon-text-html` (the oklch and color-mix fixes
  observably change the browser-side visual-contrast path, which these static
  scans do not exercise), `detect-scope-type`, `detect-scope-both`.

The frozen call vectors for `checkHtmlPatterns`
(`tests/oracle/vectors/calls/rules.checks/checkHtmlPatterns.jsonl`) were
re-recorded the same way: args untouched, results replayed through the
`db1462b9^` JS (14 of 101 moved: the comp-fidelity scans and the
comment-stripping/inline-fragment fixes to `enclosingCssSelector`). No case in
this section is an accepted delta any more; the engine matches the final JS.

## Recorded 2026-08-31: main's Aug 17-31 verb fixes ported to the engine, goldens re-recorded

The goldens below froze pre-fix behavior. Each fix landed on main in JS and
was ported to the engine; the cases were re-recorded from the binary and
reviewed line by line, so they now pin the fixed behavior.

- `hook-session-fresh-then-pending-then-stop`, `hook-session-two-sessions`: the Stop deep pass syncs the remembered set to the live scan, including findings the per-edit pass already surfaced, so a second Stop with nothing new is silent and a fixed-then-reintroduced finding fires again (upstream 3c442af7).
- `hadmin-on`, `hadmin-on-twice`, `hadmin-off-then-status`, `hadmin-on-repairs-existing-manifest`, `hadmin-on-malformed-manifest-backup`: the Claude manifests `hooks on` writes match on `Edit|Write` and the description names the current tools; Claude Code folded multi-edit behavior into Edit (upstream 7d5c60d2).
- `live-commit-mock-unreported-file-change`: the rollback-failure results share one constructor, which moved `unreportedFiles` and `notes` after `pageUrl` in the emitted JSON (upstream 1f2c3f9d).

## Recorded 2026-08-31: main's Sep-1 verb fixes ported after the rust-swap rebase

Five more fixes landed on main in JS between the swap branch and its rebase.
Each was ported to the engine and the affected goldens re-recorded from the
binary after a line-level review; the engine's output was also diffed
byte-for-byte against the upstream JS on the same inputs before recording.

- `critique-usage`, `critique-unknown`: the usage line now lists the new `close` subcommand (upstream 5211bdf4, #660).
- `critique-latest-existing`: `latest` applies the #660 identity/freshness path: a legacy snapshot carrying no fingerprint for a concrete local target is closed and `latest` exits 2 instead of printing the stale body (upstream 5211bdf4, #660).
- `critique-write-then-read`: `write` stamps `target_identity`/`target_fingerprint`/`target_path`, uses a fixed-width `~NNNN` collision suffix when two snapshots share a UTC second, `latest` freshness-closes the read snapshot, and `trend` now surfaces the `closed` flag and identity fields (upstream 5211bdf4, #660).
- `critique-write-monorepo-child`: `write` stamps the resolved `target_identity`, and a `latest` run from a sibling app resolves to a different identity so it exits 2 rather than returning the neighbor's backlog (upstream 5211bdf4, #660).
- `detect-fixture-json-overused-font-html`, `detect-fixture-text-overused-font-html`: new fixture added on the swap branch; overused-font primary selection now skips only the CSS generics, so a system stack keeps its system face as primary and later web-font fallbacks like Roboto no longer flag (upstream 2cfd6076, #678).
- `detect-dir-json-all-fixtures`, `detect-dir-text-all-fixtures`, `detect-dir-quiet-all-fixtures`, `detect-scope-type`, `detect-scope-both`, `detect-no-advisory-json`, `detect-no-advisory-text`: the directory sweep picks up the new overused-font fixture and the #678 primary-face change (upstream 2cfd6076, #678).

## Recorded 2026-08-31: E8 hook-manifest self-heal on upgrade

Two new cases pin the fix for triage E8 (the v3-to-launcher upgrade path). The
JS `automaticHookMode` counted any hook command naming the skill as an active
hook, including the JS-era `node .../hook.mjs` form. After a skill update the
`.mjs` script no longer exists, so that manifest points at a dead command yet
still suppressed `MANUAL_DETECTOR_REQUIRED`, leaving the detector dark. The
engine now treats a manifest that names ONLY the `.mjs` form as not an active
launcher hook, so the manual detector fallback fires until install/update
repairs the manifest to the launcher form. The launcher form still counts as
active exactly as before. No existing golden moved: every other `context` case
runs under the `source` provider, whose manifest list is empty, so none of them
scan a hook manifest.

- `context-stale-hook-manifest`: a `.claude/settings.local.json` naming `node "${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/hook.mjs"` under the `claude-code` provider emits `MANUAL_DETECTOR_REQUIRED` (the stale marker no longer counts as active).
- `context-launcher-hook-active`: the same manifest in the launcher form (`"…/impeccable" hook`) suppresses `MANUAL_DETECTOR_REQUIRED`, confirming the launcher marker is still recognized as active.

## Recorded 2026-09-01: the harness stages workspaces at their real path

Two goldens were re-recorded after `stageWorkspace` started returning the
realpath of the staged directory. macOS's tmpdir is a symlink (`/var` ->
`/private/var`), and the old goldens carried that artifact rather than the
verbs' behavior; Linux, where the two paths are the same, never reproduced
them. The binary's output is unchanged; the input the harness fed it is.

- `context-dir-override`: `productPath` is `elsewhere/PRODUCT.md`, the plain relative path, instead of `../../../../../../..<WS>/elsewhere/PRODUCT.md` (a relative path from the symlinked cwd to the resolved one).
- `live-accept-source-locked`: the accept now reports `source_locked`, which is what the case is named for. The staged lock named the file under the symlinked path, so the verb never matched it against its own resolved path and the old golden recorded a successful accept.

`context-lowercase-product-name` runs only on case-insensitive hosts
(`platforms: ['darwin', 'win32']` in the case): `product.md` is found through
the canonical name there and through the fallback scan elsewhere, both right.

## Recorded 2026-09-03: #710 resolves an explicit target at its own git boundary

Upstream `672ca296` (#710) scopes an explicit `--target` to its own repository.
A route-shaped target that begins with `/` is an absolute path outside the
workspace, so route cases that used to resolve inside the fixture now resolve
against the filesystem root. Every case below was re-recorded after confirming
`origin/main`'s `context.mjs` / `surface-brief.mjs` produce the same stdout and
the same exit code for the same run.

- `context-full-target-route`, `surface-brief-path-slash`, `surface-brief-path-outside`, `surface-brief-read-route`: stdout and exit code match origin/main byte for byte; nothing here is a delta beyond the upstream change itself.
- `surface-brief-write-route`: the write now fails on both engines (exit 1) because `/.impeccable/surfaces` is not writable. Node reports `ENOENT: no such file or directory, mkdir '/.impeccable/surfaces'`; the engine reports the failed write as `No such file or directory (os error 2)`. Same failure, different wording for an unwritable filesystem root.

## Recorded 2026-09-03: the OpenCode pinned command names the launcher

Upstream `9736a9f6` (#483) makes `pin` write an OpenCode slash-command bridge
whose body tells the agent to run `node <skill-base-dir>/scripts/context.mjs`.
The engine names its own command everywhere else the launcher replaced a
script path (see the 2026-08-17 section above), so the bridge says
`<skill-base-dir>/scripts/impeccable context` instead. Nothing else in the
file, the file set, or the printed lines differs from the JS.

- `pin-opencode-project`, `pin-opencode-user-scope`, `pin-opencode-skips-foreign-command`, `pin-opencode-then-unpin`, `pin-opencode-unpin-skips-foreign`.


## Recorded 2026-09-04: `--version` follows the npm package to 4.0.0

The npm shim answers `--version` / `-v` itself from its own `package.json`
(docs/CLI-CONTRACT.md), so the number users see tracks the package they
installed. The binary's `CLI_VERSION` moves from `3.6.0` to `4.0.0` with the
CLI 4.0.0 release; it is what the binary prints when run directly.

- `cli-version`.

## Recorded 2026-09-11: comp regions no longer include neighbouring pixels

The `comp-diff-no-spec` golden now measures the automatic bands at their actual
bounds rather than enlarging bands under 48px. Reviewed changes are confined to
regional scores and ink boxes: the second band's overall is 0.6755 (was 0.6951),
the fourth is 1.0 (was 0.9468), and narrow-band ink boxes use the corrected crop
coordinates. Whole-frame scores, verdicts, region definitions, exit status, and
stderr are unchanged. The golden was updated to enforce these exact results;
this is not an open-ended accepted delta. Frozen function call vectors remain
unchanged. The Rust narrow-region regression independently checks that changing
only neighbouring pixels leaves the measured crop identical.

## Recorded 2026-09-17: reference-bound typography reuse

- `comp-spec-regions`: the written spec adds `compSha256`, a SHA-256 of decoded dimensions and pixels. This binds retained typography to the exact reference when regions are remeasured. Structured comparison verified that only this field changed; stdout, stderr, exit status, regions, palettes and bounds are identical. The failing/passing regression separately verifies preservation and invalidation.

## Recorded 2026-09-17: exact reference bounds and non-destructive plate candidates

Reviewed the three CLI differences before updating their goldens:
`comp-spec-grid` appends coordinate guidance, `comp-spec-usage` explains grid,
normalized box and exact pixelBox units, and `build-phase-usage` advertises the
read-only candidate check. Only those stdout strings changed. Existing image
files, measurements, exit codes and frozen function vectors were not replaced.
The plate gate applies reference UI exclusions symmetrically after alignment;
regressions separately verify hidden-pixel invariance, visible missing-art
rejection, raw comp-copy rejection and unchanged candidate-check state.

## Recorded 2026-09-18: draft region authoring and source binding

`comp-spec-usage` now describes --auto as a draft writer. In
`comp-spec-regions`, the only file-content addition is regionsSource with the
input path and fixture-derived SHA-256; all existing fields and measurements
were compared unchanged. No frozen function vectors changed. New Rust
regressions verify automatic drafts do not overwrite specs or existing drafts,
cannot be submitted unchanged, and a rejected/missing region-source revision
cannot advance the build using the last successful measurements.

## Recorded 2026-09-18: read-only map inspection

`comp-spec-usage` adds one help line for --inspect-map, --out-dir and --json.
Only that stdout line was edited; existing measurements and frozen function
vectors remain unchanged. Rust regressions cover consolidated invalid-input
findings, fully masked references, container and child masks, preservation of
review group members, reference PNG provenance, HTML escaping, and refusal to
overwrite an existing report. Inspection does not change specs or build state.

## Recorded 2026-09-24: build session identity and nested italic headings

`build-phase-start-status`: the written state adds `"sessionId": "oracle-build"`
after `finish`, from the new `--session-id` start option. No other state field,
stdout, stderr or exit status changed. `build-phase-usage` advertises
`[--artifact <entry file>] [--session-id <id>]` on start and the new
`completion [--session-id <id>]` verb; only those usage strings changed.

The italic-serif-display correction adds exactly one finding per golden that
scans `tests/fixtures/antipatterns/italic-serif-display.html`: `italic serif h1
(fraunces) at 72px "Inline Em Inside Roman"`, a roman h1 whose visible text is
an `<em>` set in the same serif. The fixture moved this case from should-pass to
should-flag. `detect-fixture-{json,text}-italic-serif-display-html` go from 7 to
8 findings, and the aggregate corpus goldens (`detect-dir-*-all-fixtures`,
`detect-no-advisory-*`, `detect-scope-both`, `detect-scope-type`) go from 419 to
420. Every other finding, count, snippet and exit status is unchanged. Hidden
heading descendants and sans-serif or small italics stay exempt; Rust
regressions in `crates/html/tests/italic_heading.rs` pin both sides.

## Recorded 2026-09-25: plan and asset review (component review v3)

Three new cases, recorded from the binary and reviewed by hand; no existing
golden changed. `component-review-usage` is the usage refusal, which now leads
with `plan [--out .impeccable/review/components.json]`. `component-review-plan-missing-plates`
runs `plan` on the comp-basic spec before its one plate exists: exit 1, the
missing plate listed, nothing written. `component-review-plan` adds the plate
and pins the written v3 packet: `art` as an asset previewed by its plate, `top`
(non-container chrome) as a plan item with a `comp-crop` preview, `body` in
`codeRegions`, and `specSha256` of the fixture spec. Contract:
`docs/PLAN-REVIEW.md`. The build-phase plates next-step text gained one
sentence naming the review; no golden prints it.

## Recorded 2026-09-25: surface reading on code regions

`comp-spec-regions`: the written spec adds `"surface": {"flat": false, "rules": false}` to the two code regions (`top`, `body`). The raster region, every other field, measurement, stdout, stderr and exit status are unchanged, and no region in the fixture reads painted, so no `flags` entry or `FLAG` line appears. No frozen function vectors changed. Rust regressions cover the readings: a painted patch reads the same in tight and generous boxes, containers flag only on unmapped painted material, and grounds and rules separate from marks.

## Recorded 2026-09-29: visualize.md before decision comps

Agents wrote decision comp prompts before opening `reference/visualize.md`, which holds every comp-prompt rule, while they followed the engine's printed NEXT lines reliably. `serve-question` now prints a `NEXT read <skill>/reference/visualize.md now, before writing any decision comp prompt; ...` line when a round's comps are due, and `--wait` names landed decision comps that have no prompt sidecar.

- `question-wait-flip`: after the unchanged `BUILD PATH FLIPPED` line, one added `NEXT read <REPO>/skill/reference/visualize.md now, ...` line (a flip to comp is the moment a code-led round's comps start). Exit status and files are unchanged.

New cases, recorded from the binary and reviewed by hand: `question-wait-comp-sidecar-missing` (WAITING plus `COMP SIDECAR MISSING` naming only the landed comp without a sidecar), `question-wait-answer-comp-sidecar-missing` (the same line after the ANSWER block), `question-update-comps-next` (the NEXT line after `next round delivered`), `question-update-code-led-no-next` (a code-led round prints no NEXT line). `--start` is not in the corpus because it binds a port; Rust tests in `crates/context/src/serve_question.rs` cover its trigger.

Follow-up on the same branch: the NEXT line now also requires a declared comp that is not on disk yet (a comp-round page serves comps that already exist, so "before writing any decision comp prompt" was stale there), and a comp-round pick no longer prints the decision-round `CHOSEN COMP` line ("compositional option one ... adds two variations"), which predates this branch. It prints `APPROVED COMP: ...` instead, keyed on the comp sitting directly in `.impeccable/mocks/`. No existing golden changed. New cases: `question-update-comps-landed-no-next` (every declared comp exists, no NEXT line) and `question-wait-answer-comp-round` (`APPROVED COMP` in place of `CHOSEN COMP`).

Provenance by hand timestamp (same branch): deciding whether a comp is owed by existence alone misread files an earlier round left at reused slot paths. Every served hand now records `handAt` and `handDigest` in the state file, and a declared comp counts for the hand only when written at or after `handAt` (comp-round comps directly in `.impeccable/mocks/` excepted). A restart is `--start` with the same key and payload, so the dead-server message now names the key:

- `question-wait-no-server`, `question-wait-dead-pid`: `restart it with --start and the same payload` reads `restart it with --start --key k1 and the same payload`. Exit status and files are unchanged.

New case `question-wait-comp-stale`: `handAt` in 2100 makes the staged comp one an earlier round left, so WAITING is followed by `COMP STALE: ...` naming it, and no `COMP SIDECAR MISSING`. The other decision-comp goldens carry no `handAt`, which falls back to existence, so they did not move.

Hand file and content fingerprints (same branch, supersedes the `handAt` rule above): `--update` wrote the hand into `<key>.state.json`, which the server rewrites on heartbeat and claim, so an overlapping write could drop the hand; and flooring `handAt` to the second let an old image rewritten in the same second pass. Provenance now lives in `<key>.hand.json` (`digest`, `comps`, `pre` fingerprints), written atomically by `--start` and `--update` only, and a comp is this hand's when its bytes differ from the slot's `pre` fingerprint (or the slot had none).

- `question-wait-comp-stale`: the staged provenance moved from `handAt`/`handDigest` in the state file to a hand file whose `pre` fingerprint matches the staged `a.png`. Stdout and exit are unchanged; the snapshot now lists the hand file, and the state file no longer carries hand fields.
- `question-update-comps-next`: now snapshots `.impeccable/questions/k1.hand.json`, the new hand `--update` writes (`pre` is empty because neither slot holds a file). Stdout and exit are unchanged.

Generated slots and hand-write failures (same branch): a deterministic generator returns identical bytes for an unchanged prompt, so a re-roll regenerating into a reused slot failed the fingerprint rule forever. `impeccable generate-image` now marks a written `--out` that a recorded hand declares with a marker file in `<key>.generated/`, and such a slot counts as this hand's. A failed hand write now fails `--start` (before spawning) and `--update` (before delivering) with exit 1. No existing golden changed. New case `genimg-fake-marks-hand-slot`: the fake generator writes a declared slot and the snapshot shows the marker beside the untouched hand file. The failure path is covered by Rust tests, not the oracle, because its stderr carries the OS error text, which differs per platform. Follow-up: markers name their hand by `hand` (the hand's per-hand `id`, falling back to `digest` for a hand file without one) instead of `digest`, so `genimg-fake-marks-hand-slot` now shows `"hand":"0123456789abcdef"` where it showed `"digest"`; a new hand prunes other hands' markers only after its own write succeeds, and `--stop` and a closing answer remove the marker folder. `question-update-comps-next` now snapshots the hand file with its per-hand `id`, which mixes the clock and the pid, so that case masks it as `<HAND_ID>` with a case-scoped normalizer.

## Recorded 2026-09-30: hand-tagged generated markers (#886)

`--update` wrote the new hand and then pruned `<key>.generated/` by reading each marker's `hand` and deleting the file, so a parallel `impeccable generate-image` for the new hand that replaced a reused slot's marker between the read and the delete lost its marker, and a byte-identical regeneration then read as stale. Markers now carry the hand in their name, `<16 hex of the slot>-<hand id>.json`, so one hand's markers never share a path with another's, and the prune decides from the name alone: it deletes only names tagged with another hand. Legacy untagged `<16 hex>.json` markers are still read and pruned by their content `hand` (or `digest`).

- `genimg-fake-marks-hand-slot`: the marker file is now `k1.generated/bc804e5cae3cb360-0123456789abcdef.json` where it was `k1.generated/bc804e5cae3cb360.json`. Its content, stdout, stderr and exit are unchanged.

The interleaving itself is covered by Rust tests in `crates/context/src/serve_question.rs`, not the oracle, since it needs two writers.

## Recorded 2026-09-30: sidecar name spelled out

The decision-comp directives said a comp's prompt goes in `<comp>.json`, which an agent read as the comp's name without its extension (`assigned.json`). The engine checks the image's full file name plus `.json` (`a.png.json`), so the wording now says so: `its sidecar, the image's full file name plus .json (a.png gets a.png.json)`. Only that phrase moved in each golden; exit status, files and every other line are unchanged.

- `question-update-comps-next`, `question-wait-flip`: the `NEXT read ... visualize.md` line ends with the new phrase in place of `(<comp>.json)`.
- `question-wait-comp-sidecar-missing`, `question-wait-answer-comp-sidecar-missing`: `COMP SIDECAR MISSING` names the sidecar the same way, followed by `as {"prompt": "..."} (generate-image writes it itself, a harness image tool does not)`.
- `question-wait-answer-comp-round`: `APPROVED COMP` says `Set "approved": true in its prompt sidecar, the image's full file name plus .json (a.png gets a.png.json)`.
Concept-seed richness instruction scoped by mode (fix/operate-directions): the seed's RICHNESS text told every run to commit an interface-language source "across navigation, content, controls, and states", which contradicted the Operate rule in new-work.md and visualize.md at fusion time. It now allows that on Persuade and Experience surfaces, while Operate and Read take the source's type, density, palette, material accents and one signature move and keep the platform's standard navigation and controls. The 12 seed goldens that print the instruction change in that one sentence only; reviewed by hand.

## Recorded 2026-09-30: Operate deals from the graphic tier

`select_approved_challengers` now takes per-mode tier quotas (`TIER_QUOTAS`), in parity with impeccable-site's roll API (renaissance-geek-inc/impeccable-site#77). Operate draws five graphic worlds and one interaction world and no atmosphere, because instrument and atmosphere worlds dealt to working screens became costumes of the tool. For a mode with quotas, a tier the mode filter empties hands its picks to graphic instead of refilling from worlds closed to the mode. Every other mode keeps two per tier with the same salts, so no persuade, read, experience or unscoped roll moved; `crates/context/src/roll_selection.rs` tests replay 136 rolls recorded from the JS to prove it.

- `seed-direction-local-count-5` (`--mode operate`): challengers 3 to 6 were relay desk, dial cabinet (interaction), pine gallery, dusk quarry (atmosphere); they are now placard row, crest register, stamp folio (graphic) and relay desk (interaction). Header, assigned index and every other line are unchanged.
- `seed-surface-local`, `seed-surface-local-default-scope` (`--mode operate`, surface scope): the atmosphere pair frost arcade and salt terrace and the second interaction pick, signal tower, are gone; folio stand and banner press join placard row and poster wall, with meter row as the one interaction pick. The fixture catalog holds only four graphic duals, so this surface roll deals five challengers where it dealt six: a quota tier reuses its pool when it cannot fill its quota but never borrows another strength. The live catalog holds 16 graphic duals open to operate.
- `seed-direction-local-operate` (new): an operate direction roll on `oracle-key-1`, five graphic and one interaction, no atmosphere.

## Recorded 2026-10-01: MODE RULES printed by concept-seed

Mode-specific rules for directions and comps moved out of the shared reference files into `skill/reference/mode-persuade.md` (persuade and experience), `mode-operate.md` and `mode-read.md`. With `--mode`, `concept-seed` now prints the bodies of the mode file's `## Directions` and `## Comps` sections inside a `MODE RULES (<mode>, from <path>). ...` block, so the agent gets them in output it already reads instead of a file it can skip. The block sits right after the richness instruction on a full roll and after the authority instruction on a degraded one, and prints on every round, re-rolls and both registers included. An unreadable file or a missing section prints one `MODE RULES unavailable: read <path> before writing directions or comps.` line and the roll still succeeds. The richness instruction lost its Persuade/Experience versus Operate/Read sentence, which now lives in the mode files, and reads `Keep a literal carrier only when it becomes functional.` where it read `Otherwise keep ...`.

Seed cases now set `IMPECCABLE_SKILL_DIR` to `tests/fixtures/mode-rules-skill` (placeholder rule text), so these goldens do not move whenever the real mode prose changes. Nothing else concept-seed prints reads the skill dir while `IMPECCABLE_CATALOG_DIR` is pinned.

- Every seed golden that prints the richness instruction (`seed-direction-local`, `-reroll`, `-reroll-bolder`, `-reroll-safer`, `-unscoped`, `-count-5`, `-operate`, `seed-direction-env-key`, `seed-surface-local`, `-default-scope`, `-grain-flow`, `-compositions`, `-card-base`): the richness sentence change above. Those that pass `--mode` also gain the MODE RULES block after it, naming the fixture file for their mode (`seed-surface-local-card-base` prints `experience` with `mode-persuade.md`). The unscoped and safer cases without `--mode` print no block.
- `seed-degraded-direction`, `seed-degraded-surface`: the MODE RULES block after the authority instruction (persuade and operate). Degraded output carries no richness instruction, so nothing else moved.
- `question-update-comps-next`, `question-wait-flip`: the NEXT line reads `it and the MODE RULES block concept-seed printed for this surface govern every card's image` where it read `its comp rules govern every card's image`.

Exit status, stderr and files are unchanged everywhere. New cases: `seed-mode-rules-persuade`, `-experience` (reads `mode-persuade.md`), `-operate`, `-read` (one per mode file, `oracle-key-5`), and `seed-mode-rules-missing-file`, `-missing-section` against `tests/fixtures/mode-rules-skill-partial` (no `mode-read.md`; a `mode-operate.md` without `## Comps`), which print the unavailable line.

## Recorded 2026-10-02: responsive gate names displaced regions, prints crops, escalates

New cases, recorded from the engine and reviewed by hand (no JS golden ever covered the responsive gate's printed output).

- `build-phase-responsive-displaced`: a sign-off line pushed 40px below the first viewport by a growing column reads `displaced, not missing` with the offset and the visible share, the `LOOK FIRST` crop list and the displaced remedy line print, and the third failed `advance` leads with the three-attempt route to the first-viewport review.
- `build-phase-responsive-missing`: the same region absent from the capture still reads `at desktop width, region sign-off is missing`, now with its repair crop listed.

## Recorded 2026-10-04: a native ship binds every captured input

A comp-led run recorded `finish --disposition ship`, then fixed padding findings the Stop hook reported after it, and stopped: the shipped page no longer matched the final native capture. Native `finish --disposition ship` now records `finish.captureInputs`, the `{path, sha256}` rows of the manifest the final responsive capture bound, and `build-phase completion` reports `changed-after-finish` when the entry or any of those files changed, listing them in `changedSinceFinish`. The NEXT lines after review and after a recorded ship now say that a later edit, a hook finding's fix included, needs ship recorded again, and what ship does with the current files under each capture policy. No existing golden printed these lines, so none moved.

New cases, recorded from the binary and reviewed by hand:

- `build-phase-shipped-then-edited`: `status` over a native ship that still covers the page prints the `Finish is recorded for the current entry. Any later edit ...` NEXT; after a font the page loads changes (entry bytes unchanged), `status` prints `A file the final check bound changed after finish (fonts/face.ttf) ...` and `completion` reports `changed-after-finish` with `changedSinceFinish: ["fonts/face.ttf"]`.
- `build-phase-review-next-native`: the review-phase NEXT under native capture, ending `Make every fix before ship: ship re-captures the current files natively and must pass the responsive gate again, and any edit after it, a fix for a hook finding included, needs ship recorded again.`

## Recorded 2026-10-04: a component treatment is clothes

The challenger instruction in direction-scope concept-seed output says what counts as a challenger's clothes. It read `A donation transfers ambition and system discipline, never the challenger's clothes; one world owns the page.` and now reads `A donation transfers ambition and system discipline, never the challenger's clothes. A component treatment, such as a button's shadow or a display face, is clothes, not discipline; one world owns the page.` The lines after it rewrap; their words are unchanged. A gallery run had filed a declined challenger's hard offset shadow on the primary button as a discipline raise.

- `seed-direction-local`, `-reroll`, `-unscoped`, `-count-5`, `-operate`, `seed-direction-env-key`, `seed-mode-rules-persuade`, `-experience`, `-missing-file`, `-missing-section`: that sentence only, reviewed by hand. Exit status, stderr and files are unchanged.
