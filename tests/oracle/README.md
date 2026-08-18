# Oracle: behavior goldens for every `impeccable` verb

`lib.mjs` runs each case (verb + args + staged workspace + stdin) against an
implementation and captures stdout, stderr, exit code, and named files, with
machine-specific paths and timestamps normalized.

- The goldens are **frozen JS behavior**: they were recorded from the Node
  scripts (`skill/scripts`, `cli/bin`) before those left the tree with the
  launcher swap, plus the reviewed deltas in `DELTAS.md`. They are the
  behavior contract the engine binary is held to.
- `record.mjs --bin` (with `$IMPECCABLE_BIN` or `--bin=/path`) writes goldens
  from the binary, for new cases or a delta a review accepted. Plain
  `record.mjs` still targets the JS scripts and only works on a checkout that
  has them (history before the swap).
- `run.mjs` replays the corpus against `$IMPECCABLE_BIN` (or `--js` for a
  self-check on a pre-swap checkout) and diffs. Byte-equal is the bar;
  `DELTAS.md` lists reviewed exceptions.
- `tests/oracle.test.mjs` runs `run.mjs` under `bun run test` and skips when
  no binary is found (`IMPECCABLE_BIN` or `skill/scripts/bin/<os>-<arch>/`,
  filled by `bun run fetch:engine`).
- `cases/*.mjs` define the corpus (default export: array or async function
  returning an array). `workspaces/` holds project fixtures that are copied to
  a temp dir per run, so cases can write freely.

Adding a case: append to the matching `cases/*.mjs`, run
`node tests/oracle/record.mjs --bin <prefix>`, review the golden by hand
(the binary is now the recorder, so a bug in it would be frozen too), commit
the golden.

Verb names are the binary's subcommands. `cli-help` and `cli-version` map to
`impeccable --help` / `--version`. `lib.mjs` still carries the `JS_VERBS`
table that maps each verb to the script it was recorded from.

`vectors/` holds the function-level vectors recorded from the JS engine's pure
functions; see `vectors/README.md`.

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

## Live-mode cases (`cases/live-*.mjs`, workspaces `live-*`)

Helpers live in `live-helpers.mjs` (staged journals, buffers, wrapped source
files with the fake-agent variant block, a `.git` FILE pointing at a non-repo
gitdir so roots resolution sees a git boundary while `git check-ignore` exits
128 everywhere and the ignore block lands in the snapshotable
`.gitfake/info/exclude`). Svelte component preview cases symlink this repo's
`node_modules/svelte` into the staged app, exactly like the unit tests.

Harness additions made for live:

- `steps[]` entries may carry their own `setup(ws)` (run right before that
  step) and `daemon: true` with `readyFile` / `readyTimeoutMs`: the verb is
  spawned detached, the harness waits for the ready file, later steps run
  against it, and teardown SIGTERMs (then SIGKILLs) it. Its stdout/stderr land
  in the golden as `daemon: [{stdout, stderr}]`.
- `normalize: [[regexSource, flags, replacement], ...]` on a case applies extra
  masks to that case only. Live uses it for the dynamic helper port
  (`localhost:<PORT>`, `"port": <PORT>`), lease and phase stamps (`<EPOCH>`),
  and float durations (`<N>`).
- Global masks added: `"pid": <PID>` / `(pid <PID>)` and UUID tokens `<UUID>`.
- `snapshotFiles` walks `node_modules/.impeccable-live` (the Svelte preview
  tree) and nothing else under `node_modules`.

Deliberately not covered here (rely on `tests/live-e2e`): the browser
handshake and `/live.js` bundle, SSE, generate/accept round-trips through a
real browser, `variant_mount_failed` republish, manual-edit chat routing and
the codex/claude subprocess providers, Svelte revision-dir publishing, and
`live.mjs`'s dev-server-dependent flows. Lock-file names hash the absolute
source path, so lock cases do not snapshot `.impeccable/live/locks/`.
`live-poll-*-connection-refused` assumes nothing listens on 127.0.0.1:65531.
