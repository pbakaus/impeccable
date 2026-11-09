# Runtime environment the binary reads (context crate)

The JS scripts learned two things from their own file location that a single
binary cannot: which harness built them (`lib/provider.mjs`) and where the
skill's `reference/` and `SKILL.md` live (`../reference`, `../SKILL.md`).
`crates/context/src/provider.rs` resolves both at run time.

| Variable | Meaning | Default |
|---|---|---|
| `IMPECCABLE_SKILL_DIR` | The skill directory (holds `SKILL.md`, `reference/`, `scripts/`). Used for the native platform references `context` inlines, the local version in the update check, `pin`'s `command-metadata.json`, and `concept-seed`'s default catalog dir (`<skill>/scripts`). | Walk up from the executable's directory until a directory containing `reference/ios.md` is found (the binary ships at `<skill>/scripts/bin/<os>-<arch>/`). None if nothing matches: native refs are then skipped silently, like a missing file in the JS. |
| `IMPECCABLE_PROVIDER_ID` | The build provider id (`claude-code`, `codex`, `cursor`, ...). Selects the hook manifest paths `context` and `doctor` inspect and the `$`/`/` command prefix (`$` only for `codex`). | Derived from the skill dir's harness folder (`<root>/.codex/skills/impeccable` -> `codex`); otherwise `source`, which is what the JS reads in a source checkout. |
| `IMPECCABLE_SELF` | How to spell this binary in printed commands where the JS printed `node <scripts>/<script>.mjs` (`context`'s MANUAL_DETECTOR_REQUIRED, IMAGE_GEN_AVAILABLE, SURFACE_CONTEXT_AVAILABLE, MONOREPO_TARGET_REQUIRED, `serve-question --start`'s follow-up line). Printed as `<self> <verb>`; a Windows `.cmd` path that has to be quoted (one containing spaces, or any quoted hook spelling) is printed as `& '<path>' <verb>` (a PowerShell literal, `'` doubled) so PowerShell runs it (`impeccable_common::launcher`, #744). | The executable path. |
| `IMPECCABLE_SEED_SALT` | Pins the salt seed references are computed under (`impeccable_common::seed`), so tests and the oracle print stable references. Never set it in normal use: the per-user salt is what keeps a committed reference from being computed out of a key. | The contents of `~/.impeccable/seed-salt`, 128 random bits created on first use. |
| `IMPECCABLE_TELEMETRY_CHANNEL` | A lowercase word appended to `X-Impeccable-Client` (`test` in this repo's tests and CI) so test traffic is tagged. | None. |

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

## Account sign-in (`login`, `logout`, `whoami`; `crates/account`)

`impeccable login` signs in to the Impeccable account service with OAuth 2.1:
authorization code, PKCE S256, a loopback redirect on
`http://127.0.0.1:<port>/callback`, the public client `impeccable-cli`,
resource `<issuer>/cli`, scopes `account:read rules:read`. The callback's
`state` and RFC 9207 `iss` must match before the code is exchanged. A
callback without this attempt's `state` is answered and ignored, so another
local process cannot end the sign-in; each connection gets 5 seconds to send
its request head, and the whole wait ends at `IMPECCABLE_LOGIN_TIMEOUT`. With
`--no-browser` the authorization URL is the only line on stdout, so a script
can open it (or drive the consent page) itself. `whoami` asks
`GET /cli/v1/entitlement`; `whoami --json` prints
`{account_url, signed_in, pro, reason}` and exits 1 when not signed in.
When signed in, `whoami` also reads the public plan catalog,
`GET /v1/plans` without a token and with a 5-second deadline, and prints the
plan's name and what it adds, marking announced items `(soon)`; `--json` adds
`plan: {id, name, builds, adds: [{text, soon}]}`. The plan is the one the
entitlement names in `plan`, else `pro` or `free` from its `pro` flag. If the
catalog can't be read (off, unreachable, malformed), `whoami` prints its
`Pro rules:` line instead. Catalog text is cleaned of control characters and
bidirectional overrides and capped in length before it is printed.

Every request goes to the issuer's own origin. That is checked at the HTTP
client, so an endpoint read back from `state.json` cannot carry a token
elsewhere. Each request has a 60-second deadline from connect to last byte,
and redirects are not followed. Plain `http` is accepted only for a
loopback service. Its names (`localhost`, `*.localhost`) resolve straight to
`127.0.0.1` and `::1` without a resolver, and any other name is refused.
Transport errors are reported by kind, never by the HTTP layer's own text,
and tokens must have RFC 6750 syntax before they are stored or sent.

Storage lives under `$IMPECCABLE_HOME/account/<hash of the issuer>/`:
`state.json` (signed in or not, the generation, the backend, the token
endpoints) and, for the file backend, `credentials.json` (0600 in a 0700
directory; symlinks and other owners refused). The keychain backend keeps
the tokens in the macOS Keychain or Windows Credential Manager (service
`impeccable-cli`, account = issuer plus the account directory, so two
`IMPECCABLE_HOME`s never share one secret). The backend is pinned at
sign-in. Signing in again, or signing out, removes the secret from both
backends and revokes the replaced grant. On Windows the file backend is
refused unless `IMPECCABLE_HOME` is inside the user's profile: Windows
files take the ACL of their directory, and only the profile is private by
default. A same-user process can read the file backend.

One OS lock (`lock` in that directory) covers login, logout and refresh.
Every write re-reads under it and bumps the generation; a refresh that finds
the generation moved adopts the newer tokens instead of reusing its refresh
token (the service revokes a grant on reuse). `logout` writes the signed-out
state first (the tombstone), even when nothing was stored, deletes the
secret, then revokes the refresh token at the service, best effort. A
`login` still waiting in the browser when a logout lands does not sign the
machine back in: it revokes the tokens it got and fails.

**Threat model.** These files and the keychain item protect a sign-in from
other users on the machine and from the network. They do not protect it
from another process running as the same user, which can read the file
backend, ask the keychain, or replace the CLI itself.

| Variable | Meaning | Default |
|---|---|---|
| `IMPECCABLE_ACCOUNT_URL` | The account service origin (the OAuth issuer). `https`, or `http` for a loopback host only. | `https://api.impeccable.style` |
| `IMPECCABLE_HOME` | Root for account state (and the engine cache). | `~/.impeccable` |
| `IMPECCABLE_CREDENTIAL_STORE` | `keychain` or `file` for a new sign-in. | `keychain` on macOS and Windows, `file` elsewhere |
| `IMPECCABLE_NO_BROWSER` | Truthy: as `login --no-browser`. | unset |
| `IMPECCABLE_LOGIN_TIMEOUT` | Seconds `login` waits for the browser. | `300` |

## Pro dispatch (`crates/account/src/pro`)

A signed-in, entitled machine runs scans (`detect`, its path shorthand,
`hook`, `hook-before-edit`) on the **Pro engine**: a separate build of this
CLI with the Pro rule pack linked in through `impeccable::run`. The open
binary decides in `main` (a Pro build calls `run` and never dispatches) and
re-runs the same argv on the Pro build with `IMPECCABLE_PRO_CHILD=1`. No
dispatch for a Pro child, an explicit `IMPECCABLE_BIN`, `IMPECCABLE_PRO=off`,
or any other verb. A machine that never signed in sees nothing new.

**Refresh** (at `login`, and in a detached hidden `pro-refresh` when a lease
has under two days left or is missing; at most every ten minutes, hourly
after "not entitled"). One refresh runs at a time per account: it holds an
exclusive OS lock on `pro/refresh.lock`, and a scan claims the attempt under
that lock before it starts one, so of many scans that find a refresh due at
once, one starts it (a scan that cannot record the attempt starts none). The
refresh at `login` waits up to a minute for one already running; a
background one gives way after two seconds.

The network steps run **without the sign-in lock**, so a slow or stalled
service never holds up `login` or `logout` (token rotation still takes it
for its one request). Every request has the client's 60 second deadline,
except the artifact download, which has ten minutes.

1. `GET /cli/v1/manifest?engine=<this version>&target=<os-arch>`
   (`darwin-arm64`, `linux-x64`, `windows-x64`, ...). The body's exact bytes
   must verify against `X-Impeccable-Signature` (base64url Ed25519) under a
   **pinned release key**, then parse as the manifest below with this
   engine and target. A revision below the **revision floor** is refused.
2. The artifact is cached by digest at
   `$IMPECCABLE_HOME/pro/artifacts/<sha256>[.exe]`. A cached file is used
   only if it is a regular file (no symlink, FIFO or device) of the signed
   size, owned by this user, not writable by others, and has the signed
   digest; at most the signed size is read. Otherwise
   `GET /cli/v1/artifact/<sha256>`, checked for size and digest, written to
   a freshly created staging file (never through anything planted at its
   name), then renamed into place.
3. `POST /cli/v1/lease {artifact_sha256}`: a compact EdDSA JWS, verified
   against the cached lease keys; on an unknown `kid` (or no cache)
   `GET /.well-known/impeccable-cli-keys.json` once and verify again. A
   lease must have `iat` no later than five minutes from now, and `exp`
   after `iat` by at most seven days (the service's maximum).
4. **Install**, under the sign-in lock, only if nothing happened since the
   refresh started that it would undo: the machine is still signed in with
   the **same sign-in**, no "not entitled" answer was recorded after the
   refresh started, and no newer revision was accepted. Then
   `pro/current.json` (manifest bytes and signature as served, the lease,
   and the sign-in it belongs to) is replaced in one write, and the
   revision floor raised.

A sign-in is `login` in `state.json`: the generation it was made at, kept
through token refreshes, changed by a new sign-in or a sign-out. Both of
those clear the Pro state under the sign-in lock (installed manifest, lease,
"not entitled", the retry clock), and dispatch uses a lease only when it was
installed for the current sign-in. One account's lease never runs Pro for
the next one.

`403 not_entitled` forgets the lease and the installed manifest at once;
`whoami` does the same when it reads `pro: false`. Both take the sign-in
lock, and record the answer's time, so a refresh already in flight installs
nothing. `503` answers (`CLI_ARTIFACTS`, `CLI_LEASE_*`, `malformed_release`)
and network failures keep an existing lease: it runs to its own `exp`
(offline grace), then the open rules.

The **revision floor** (`$IMPECCABLE_HOME/pro/floor-<engine>-<target>`) is
the highest `artifact_revision` accepted for this engine and target. It is
outside the account's Pro state, so forgetting a lease or signing out never
lowers it, and both refresh and dispatch refuse a revision below it.

**Dispatch** (every scan, offline), cheapest checks first: signed in; no
"not entitled"; an installed manifest for this sign-in that verifies for
this engine and target, at or above the floor; a lease that verifies (key,
digest, `iat`, `exp`); and only then the artifact's digest. Any failure runs
the open engine with one line on stderr saying why. The one exception is an account without Pro ("this account doesn't include them"). That line comes at most once a day, and only from a scan a person ran (`detect` or its path shorthand), never from the edit hooks (`NOT_ENTITLED_QUIETLY` in `crates/account/src/pro/mod.rs`, pending Paul's choice on REN-1553).

**What this protects, and what it does not.** Dispatch runs a Pro build only
when the release key signed it, the service leased it to this sign-in, and
the lease is live. That holds against a compromised or misbehaving service
or network short of the release key. It does not hold against a process
running as the same user: such a process can write `$IMPECCABLE_HOME`, can
swap the cached artifact between its check and its execution, can replace
the cached lease keys (which are trusted on first fetch from the service),
and can run the cached Pro build directly. Offline licensing is not
enforced against the machine's owner.

Manifest schema 1 (the release job signs these bytes):

```json
{ "schema": 1, "key_id": "<release key id>", "engine": "0.1.18",
  "target": "darwin-arm64", "artifact_revision": 3,
  "artifact_sha256": "<64 lowercase hex>", "size": 12345678,
  "pack_version": "<optional>" }
```

The release keys are compiled in from `scripts/cli-pro-release-keys.json`
(`{ "<key id>": "<64 hex public key>" }`). It is empty until the first Pro
release key exists, so every build falls back to the open rules until then.
A build with the cargo feature `test-release-keys`
(`cargo build -p impeccable --features test-release-keys`) trusts
`IMPECCABLE_PRO_RELEASE_KEYS` (same JSON) instead, for tests and local
rehearsals. It is a build feature rather than a runtime switch so that no
environment variable can change what a shipped binary trusts; the release
workflow builds without it.

| Variable | Meaning | Default |
|---|---|---|
| `IMPECCABLE_PRO` | `off` (or `0`, `false`, `no`): never dispatch. | unset |
| `IMPECCABLE_PRO_CHILD` | Set by the dispatcher on the Pro child; stops recursion. | unset |
| `IMPECCABLE_PRO_RELEASE_KEYS` | Release keys JSON, honoured only by `test-release-keys` builds. | unset |
