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

## Recorded 2026-08-31: main's post-freeze fixture changes, goldens re-recorded from the engine

The rebase onto main brought fixture updates whose paired JS rule changes have
not been ported to the engine yet. The detect goldens below are re-recorded
from the binary, so they pin the engine's current behavior on the new fixture
content; the entries name the upstream JS change each one still owes. Until a
rule ships in the engine and its golden is re-recorded, the golden is the pin
of the gap, not an endorsement of it.

- `detect-fixture-json-color-html`, `detect-fixture-text-color-html`: the fixture gained the color-mix nested-hex column (upstream 54440319, #578, with explicit sizes from 7426af44); the engine still reads hex codes inside `color-mix(...)` when measuring gradient contrast, so its readings on the reshaped fixture differ from the JS engine's.
- `detect-fixture-json-oklch-neon-text-html`, `detect-fixture-text-oklch-neon-text-html`: new fixture for oklch parsing in visual-contrast and neon-text (upstream 1b7da15b, #592, columns from 8347d77f); the engine does not parse oklch there yet, so the flag column's neon-text goes unflagged and a mis-read low-contrast is recorded.
- `detect-fixture-json-codex-grid-1d-pass-html`, `detect-fixture-text-codex-grid-1d-pass-html`: new pass-case fixture for 1D dashed rules (upstream a236137b/7ddcd533, #615); the engine still flags the 1D line-field as `codex-grid-background`, which is the pre-fix behavior the fixture exists to retire.
- `detect-fixture-json-organic-clip-path-html`, `detect-fixture-text-organic-clip-path-html`, `detect-fixture-json-buried-raster-html`, `detect-fixture-text-buried-raster-html`: fixtures for the two comp-fidelity rules (upstream 58561610: organic-clip-path, buried-raster); neither rule exists in the engine, so only incidental findings (or none) are recorded.
- `detect-dir-json-all-fixtures`, `detect-dir-text-all-fixtures`, `detect-dir-quiet-all-fixtures`, `detect-scope-type`, `detect-scope-both`, `detect-no-advisory-json`, `detect-no-advisory-text`: directory-wide sweeps over `tests/fixtures/antipatterns/`; re-recorded because the fixture set above grew and changed, shifting counts and orderings.
