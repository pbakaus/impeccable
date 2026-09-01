# Porting guide

Conventions every porting task follows. The bar is byte-equal behavior against
the JS goldens; read this before touching a crate.

## Sources of truth

- JS source: the public repo checkout (`../impeccable-second` locally,
  `../impeccable` in CI; env `IMPECCABLE_PUBLIC_REPO` overrides).
- Contract: `docs/CLI-CONTRACT.md` in the public repo. Every verb's argv, env,
  stdout/stderr, exit codes, files, network.
- Goldens: `tests/oracle/` in the public repo. `node tests/oracle/run.mjs`
  with `IMPECCABLE_BIN=<path to our binary>` replays every case and diffs.
- Function vectors: `tests/oracle/vectors/calls/<module>/<fn>.jsonl`, generated
  by `node tests/oracle/vectors/record-calls.mjs` (needs the JS engine present).
  `crates/core/tests/vectors.rs` replays them.

## Rules

1. Port the behavior, including bugs. Mark a knowingly-odd port with a
   `// JS-PARITY:` comment naming the JS function and what it does. Never
   change a threshold, message string, or ordering while porting.
2. Improvements go through `tests/oracle/DELTAS.md` in the public repo, one
   line per case id, after review. Until then the golden wins.
3. JS number and string semantics live in `impeccable_core::js`
   (`number_to_string`, `to_fixed`, `parse_float`, `parse_int`, `trim`,
   `to_lower_case`). Use them everywhere output text is produced; never
   `format!("{}", f64)` a value that ends up in stdout or a snippet.
4. Regexes: `regex` crate. JS features it lacks (lookbehind, backreferences,
   `\b` on unicode) get hand-written equivalents with a test.
5. Field order in emitted JSON matters. Use serde structs with the JS field
   order, or `serde_json::Map` built in order (`preserve_order` is on).
6. Every crate that produces stdout does so through the `cli` crate's writer so
   trailing newlines and stdout/stderr split match the contract exactly.
7. Exit codes are part of the contract. `std::process::exit` only in `cli`.
8. No panics on user input. `panic = "abort"` is set in release; a panic is a
   crash for the user.
9. Keep `core` free of I/O and `std::process`; it compiles to wasm.

## Crate boundaries

| crate | owns | must not |
|---|---|---|
| core | pure rules, color, registry, findings, inline ignores; the browser rules over the `browser::dom::Dom` probe trait | touch fs/process/network |
| html | static engine: DOM model, cascade, adapters, text/regex engine, design system, visual | spawn browsers |
| browser | CDP client, browser discovery, page injection | parse HTML itself |
| context | context/doctor/pin/briefs/critique/palette/concept-seed/question/image/embed/signals/csp | |
| hook | hook, hook-before-edit, hooks admin | |
| live | live server and all live verbs | require Node except the documented Svelte/Vue exception |
| cli | argv router, exit codes, stdout writer | business logic |
| wasm | wasm-bindgen exports over core; `JsDom` (the probe over JS imports); see docs/WASM-BUNDLE.md | |

## Workflow per module

1. Read the JS file top to bottom. List exports and internal helpers.
2. Port helpers first, then exports, keeping names (`snake_case`) and a doc
   comment `/// JS: <file>#<name>`.
3. Run the vector test for the module until green.
4. If the module feeds a verb, build the verb, run the oracle for that verb's
   prefix, fix until green.
5. Commit with a message that names the JS module ported and the vector/oracle
   result. End with `Prepared with AI assistance (Claude Code).`

## Windows

The JS ran on Node, which picks `path.win32` on Windows and `path.posix`
elsewhere. `impeccable_common::jsp` does the same: the top-level functions
(`join`, `resolve`, `relative`, `dirname`, `basename`, `extname`,
`normalize`, `is_absolute`, `SEP`) dispatch on `cfg!(windows)`; the two
implementations sit under `jsp::posix` and `jsp::win32`, each with tests whose
expected values came from `node -p "path.win32.X(...)"`. Rules:

1. Use `jsp::*` wherever the JS used `path.*`. Use `jsp::posix::*` only where
   the JS wrote `path.posix.*` (tanstack-adapter's dirname, live's
   `posix_normalize`).
2. Where the JS did `.split(path.sep).join('/')` (display paths, glob matching,
   manifests another platform may read), the port calls `jsp::to_posix`.
   Where the JS built a prefix with `path.sep`, use `jsp::SEP` / `SEP_CHAR`.
   Where the JS split on a literal `'/'`, keep the literal: that is the
   behavior on Windows too, bugs included.
3. `resolve` / `relative` take an explicit cwd where Node read
   `process.cwd()`. Callers that only pass absolute paths may hand in `"/"`;
   on Windows that is the drive-less root, exactly what `path.win32.resolve('/')`
   yields with no cwd for the device.
4. Process plumbing that differs per OS lives in `impeccable_common::proc`:
   `kill0` / `pid_reachable` (`process.kill(pid, 0)`; OpenProcess on Windows),
   `terminate` (`process.kill(pid)`), `detach` (`spawn({ detached: true })`:
   `setsid` on unix, `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP` on
   Windows, so no console window), `hide_window` for short-lived helpers,
   `on_interrupt` (`process.on('SIGINT'|'SIGTERM')`; a console control
   handler on Windows), `shell` (`{ shell: true }`: `/bin/sh -c` or
   `cmd.exe /d /s /c`), `node_exe` (`node.exe`), `tool_on_path`
   (`which` / `where`).
5. Chrome discovery already carries the Windows candidate list; the launcher
   for Windows is `launcher/impeccable.cmd`.

Cross-checking from macOS or Linux: `rustup target add x86_64-pc-windows-msvc`
then `cargo check --workspace --target x86_64-pc-windows-msvc`. `ring`
(under `ureq`'s rustls) compiles C for the target, so point `cc` at a clang
with the Windows CRT/SDK headers (`cargo install xwin && xwin --accept-license
splat --output ~/.xwin`), e.g.

```
CC_x86_64_pc_windows_msvc=clang \
CFLAGS_x86_64_pc_windows_msvc="--target=x86_64-pc-windows-msvc -Wno-everything -I$HOME/.xwin/crt/include -I$HOME/.xwin/sdk/include/ucrt -I$HOME/.xwin/sdk/include/um -I$HOME/.xwin/sdk/include/shared" \
AR_x86_64_pc_windows_msvc=<a lib.exe stand-in: llvm-lib, or a script mapping "-out:X objs" to "ar crs X objs"> \
cargo check --workspace --target x86_64-pc-windows-msvc
```

CI runs `cargo test --workspace` on `windows-latest` (`.github/workflows/ci.yml`),
which is the only real Windows execution the project has. What a check
cannot show and only that job (or a Windows machine) can: the live server's
`--background` spawn surviving the parent's console, Ctrl-C reaching
`on_interrupt`, `cmd.exe` quoting for `proc::shell` scripts, and the Svelte
bridge finding `node.exe`.

The oracle goldens in the public repo were recorded on macOS: `<WS>` /
`<HOME>` masks assume `/`-separated paths, `tests/oracle/lib.mjs` compares
`stdout` byte-for-byte, and several cases stage posix-only workspaces
(`core.hooksPath=/dev/null`, `sh` steps). Running the oracle on Windows would
need the harness to normalize `\` to `/` inside `<WS>`/`<HOME>`-masked paths
before diffing, drive-letter-aware masks, and a Windows recording pass for
the verbs whose output embeds `path.sep` (hook file lists, live manifests).
That work belongs to the public repo and is out of scope here.
