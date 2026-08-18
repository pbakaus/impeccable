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

## Corpus files

- `cases/detect.mjs`: `detect`, `cli-help`, `cli-version`, `ignores`.
- `cases/hooks.mjs`: `hook`, `hook-before-edit`, `hook-admin`.
- `cases/context.mjs`: `context`, `doctor`, `pin`, `surface-brief`,
  `critique-storage`, `palette`, `embed-prompt`, `context-signals`
  (id prefix `signals-`), `detect-csp` (`csp-`), `concept-seed` (`seed-`),
  `generate-image` (`genimg-`), `serve-question` (`question-`). Only offline
  paths: the local catalog fixture or an unreachable roll API, fake image
  generation, and serve-question modes that never open a browser or listen.
  Workspaces are `workspaces/ctx-*`; the header comment in the case file
  describes each one. Machine-specific env (`OPENAI_API_KEY`, catalog and
  context overrides, `CI`) is pinned per case so the recording host does not
  leak into goldens.

## Normalizations

Beyond paths and ISO timestamps, `normalize()` masks these run- or
machine-dependent fragments. Each is targeted at one script's output:

- `IMAGE_TOOLS: <IMAGE_TOOLS_PROBE>`: `context` probes `which cwebp sips
  magick ffmpeg`; the set found describes the machine, not the script.
- `"devServer": <DEV_SERVER_PROBE>`: `context-signals` probes localhost ports
  4321/3000/5173/5174/8080/8000/4200; whatever is listening on the recording
  host is not part of the contract.
- `<STAMP>`: `critique-storage` stamps snapshots with the wall clock in dash
  form (`2026-05-12T18-30-00Z`), in the file name and the `timestamp:`
  frontmatter it writes. Cases that write a snapshot do not snapshot the file;
  they run `latest` / `trend` afterwards instead.
- `"<finding-id>": <EPOCH>`: the staleness notice cache
  (`~/.impeccable/staleness-check.json`) keys epoch stamps by finding id.
- `<IMPECCABLE> <verb>` / `<HOOK_ADMIN_CMD>`: self-referential command lines.

Not covered on purpose: `palette` with no `--id` / `--from` / env seed (random),
`concept-seed` against the live roll API, `generate-image` real mode,
`serve-question --start` / blocking mode (opens a browser and binds a port),
and unhandled-exception paths whose stack traces carry Node line numbers.
