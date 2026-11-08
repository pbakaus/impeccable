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
