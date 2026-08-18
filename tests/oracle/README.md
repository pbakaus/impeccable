# Oracle: behavior goldens for every `impeccable` verb

`lib.mjs` runs each case (verb + args + staged workspace + stdin) against an
implementation and captures stdout, stderr, exit code, and named files, with
machine-specific paths and timestamps normalized.

- `record.mjs` writes goldens from the JS scripts (`skill/scripts`, `cli/bin`).
- `run.mjs` replays the corpus against `$IMPECCABLE_BIN` (or `--js` for a
  self-check) and diffs. Byte-equal is the bar; `DELTAS.md` lists reviewed
  exceptions.
- `cases/*.mjs` define the corpus (default export: array or async function
  returning an array). `workspaces/` holds project fixtures that are copied to
  a temp dir per run, so cases can write freely.

Adding a case: append to the matching `cases/*.mjs`, run
`node tests/oracle/record.mjs <prefix>`, commit the golden.

Verb names are the binary's subcommands. `cli-help` and `cli-version` map to
`impeccable --help` / `--version`.
