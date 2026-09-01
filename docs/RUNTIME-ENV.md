# Runtime environment the binary reads (context crate)

The JS scripts learned two things from their own file location that a single
binary cannot: which harness built them (`lib/provider.mjs`) and where the
skill's `reference/` and `SKILL.md` live (`../reference`, `../SKILL.md`).
`crates/context/src/provider.rs` resolves both at run time.

| Variable | Meaning | Default |
|---|---|---|
| `IMPECCABLE_SKILL_DIR` | The skill directory (holds `SKILL.md`, `reference/`, `scripts/`). Used for the native platform references `context` inlines, the local version in the update check, `pin`'s `command-metadata.json`, and `concept-seed`'s default catalog dir (`<skill>/scripts`). | Walk up from the executable's directory until a directory containing `reference/ios.md` is found (the binary ships at `<skill>/scripts/bin/<os>-<arch>/`). None if nothing matches: native refs are then skipped silently, like a missing file in the JS. |
| `IMPECCABLE_PROVIDER_ID` | The build provider id (`claude-code`, `codex`, `cursor`, ...). Selects the hook manifest paths `context` and `doctor` inspect and the `$`/`/` command prefix (`$` only for `codex`). | Derived from the skill dir's harness folder (`<root>/.codex/skills/impeccable` -> `codex`); otherwise `source`, which is what the JS reads in a source checkout. |
| `IMPECCABLE_SELF` | How to spell this binary in printed commands where the JS printed `node <scripts>/<script>.mjs` (`context`'s MANUAL_DETECTOR_REQUIRED, IMAGE_GEN_AVAILABLE, SURFACE_CONTEXT_AVAILABLE, MONOREPO_TARGET_REQUIRED, `serve-question --start`'s follow-up line). Printed as `<self> <verb>`. | The executable path. |

Everything else is the JS contract's own environment (`IMPECCABLE_CONTEXT_DIR`,
`IMPECCABLE_UPDATE_*`, `IMPECCABLE_STALENESS_CACHE`, `IMPECCABLE_CATALOG_DIR`,
`IMPECCABLE_API_URL`, `IMPECCABLE_IMAGE_GEN_FAKE`, ...), read unchanged.

The launcher (`launcher/impeccable`) does not export these yet; a launcher that
sets `IMPECCABLE_SKILL_DIR="$dir/.."` and `IMPECCABLE_SELF="$0"` would make
directives name the launcher instead of the platform binary.

Oracle note: run the public repo's `tests/oracle/run.mjs` with
`IMPECCABLE_SKILL_DIR=<public repo>/skill` (the corpus expects the native
references inlined) and an `IMPECCABLE_BIN` path outside `$HOME` (the
harness normalizes `$HOME` before it normalizes the bin path, so a binary
under the home dir renders as `<HOME>/...` instead of `<IMPECCABLE>`).
