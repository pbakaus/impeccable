#!/usr/bin/env bash
# Pro CLI end-to-end against Impeccable's staging service, unattended.
# Run by pristine's staging-only CI job (workflow_dispatch, staging-deploy environment), or locally.
#
# Sign-in consent is given as Platform's seeded staging test person through pristine's own
# fixed command `bun run staging-admin cli-login <url>`, run from a pristine checkout. No
# session, cookie or token passes through this script, and it prints none.
#
# Usage:  scripts/staging-cli-e2e.sh
# Env:
#   PRISTINE_DIR            required: pristine checkout whose `bun run staging-admin` works
#   E2E_IMPECCABLE_BIN      optional: engine binary (default: target/release/impeccable in this repo,
#                           built with `cargo build --release -p impeccable`)
#   E2E_ISSUER              optional, default https://api.staging.impeccable.style
#   E2E_DISPATCH_REQUIRED   optional, default 0; 1 makes Pro dispatch count toward the result:
#                           a Pro build installs and a Pro-only rule (pristine/placeholder-copy) fires.
#                           Needs a staging Pro build for the binary's engine version, and a binary
#                           that trusts the staging release key (built with --features
#                           test-release-keys, IMPECCABLE_PRO_RELEASE_KEYS = the staging keyring).
#
# Output: "PASS <check>", "FAIL <check>[: reason]" or "INFO ...", then "RESULT PASS|FAIL".
# Exit: 0 pass, 1 a check failed, 2 staging not ready, 3 bad inputs.
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
BIN=${E2E_IMPECCABLE_BIN:-$ROOT/target/release/impeccable}
# The scans run from a scratch repo: a relative path must not depend on where they run.
case "$BIN" in /*) ;; *) BIN="$PWD/$BIN" ;; esac
PRISTINE=${PRISTINE_DIR:-}
ISSUER=${E2E_ISSUER:-https://api.staging.impeccable.style}
[ -x "$BIN" ] || { echo "FAIL inputs: no engine binary at $BIN (cargo build --release -p impeccable)"; echo "RESULT FAIL"; exit 3; }
[ -d "$PRISTINE" ] || { echo "FAIL inputs: PRISTINE_DIR is not a directory"; echo "RESULT FAIL"; exit 3; }
for tool in curl jq git bun; do command -v "$tool" >/dev/null || { echo "FAIL inputs: $tool not on PATH"; echo "RESULT FAIL"; exit 3; }; done

H=$(mktemp -d "${TMPDIR:-/tmp}/impeccable-staging-e2e.XXXXXX")
login_pid=""
cleanup() { if [ -n "$login_pid" ]; then kill "$login_pid" 2>/dev/null; wait "$login_pid" 2>/dev/null; fi; rm -rf "$H"; }
trap cleanup EXIT
export IMPECCABLE_HOME="$H/home" IMPECCABLE_ACCOUNT_URL="$ISSUER" IMPECCABLE_TELEMETRY_CHANNEL=test
export IMPECCABLE_NO_UPDATE_CHECK=1 IMPECCABLE_QUESTION_DISABLED=1
# The file credential store on every OS, so the sibling section can copy a sign-in.
export IMPECCABLE_CREDENTIAL_STORE=file
# Design health is off by design whenever CI is set (GitHub Actions sets CI=true), so
# the scans below run as a person's terminal would: no CI, no opt-out variables.
unset CI IMPECCABLE_BIN IMPECCABLE_PRO DO_NOT_TRACK IMPECCABLE_NO_TELEMETRY

failed=0
pass() { echo "PASS $1"; }
fail() { echo "FAIL $1${2:+: $2}"; failed=1; }
check() { if eval "$2"; then pass "$1"; else fail "$1"; fi; }
info() { echo "INFO $*"; }
finish() { [ $failed = 0 ] && { echo "RESULT PASS"; exit 0; }; echo "RESULT FAIL"; exit "${1:-1}"; }

info "engine $("$BIN" --version 2>/dev/null | head -1)"

# 0. Staging serves what the CLI needs.
meta=$(curl -sf "$ISSUER/.well-known/oauth-authorization-server") || { fail "preflight: OAuth metadata at $ISSUER"; finish 2; }
scopes=" $(printf '%s' "$meta" | jq -r '.scopes_supported|join(" ")') "
case "$scopes" in *" rules:read "*) pass "preflight: staging offers rules:read" ;; *) fail "preflight: staging offers rules:read"; finish 2 ;; esac
health=0
case "$scopes" in *" health:write "*) pass "preflight: staging offers health:write"; health=1 ;; *) info "staging does not offer health:write; design health skipped" ;; esac

# 1. Sign in: the CLI prints the authorize URL and waits on its loopback; pristine's
#    command approves it as the seeded person and delivers the code there.
"$BIN" login --no-browser > "$H/login.out" 2> "$H/login.err" &
login_pid=$!
url=""
for _ in $(seq 1 100); do url=$(grep -m1 '^https://' "$H/login.out" 2>/dev/null); [ -n "$url" ] && break; sleep 0.2; done
[ -n "$url" ] || { fail "login: the CLI printed a sign-in link"; finish; }
pass "login: the CLI printed a sign-in link"
answer=$(cd "$PRISTINE" && bun run --silent staging-admin cli-login "$url" 2>&1 | grep -E '^(approved|refused:)' | tail -1)
[ "$answer" = approved ] || { fail "login: consent" "${answer:-no answer from staging-admin cli-login}"; finish; }
pass "login: consent approved as the seeded test person"
# After the approval, login also fetches the Pro build, which may take up to its own
# 600 s download deadline; wait a little past that, never forever.
for _ in $(seq 1 3100); do kill -0 "$login_pid" 2>/dev/null || break; sleep 0.2; done
if kill -0 "$login_pid" 2>/dev/null; then fail "login: the CLI finished signing in" "still running 620 s after the approval"; finish; fi
wait "$login_pid"; rc=$?; login_pid=""
check "login: the CLI finished signing in" '[ $rc = 0 ]'

# 2. whoami.
"$BIN" whoami > "$H/whoami.out" 2>&1; rc=$?
check "whoami: exits 0" '[ $rc = 0 ]'
check "whoami: signed in to staging" 'grep -q "^Signed in to " "$H/whoami.out"'
info "whoami: $(grep -v '^Signed in to ' "$H/whoami.out" | tr '\n' ' ' | cut -c1-200)"

# 3. A full detect of a git repo: Pro dispatch, then the design-health upload.
R="$H/repo"; mkdir -p "$R"
cat > "$R/index.html" <<'HTML'
<!doctype html><html><head><title>e2e</title><style>
body{background:#f5f0e6;font-family:Inter,sans-serif}
.card{border-left:4px solid #6d28d9;border-radius:16px;padding:8px}
</style></head><body><h1>Pricing</h1><h4>Plans</h4>
<div class="card"><div class="card"><p style="color:#9ca3af;background:#6d28d9">Grey on purple</p></div></div>
<p>Lorem ipsum dolor sit amet, our plans start here.</p>
</body></html>
HTML
git -C "$R" init -q && git -C "$R" remote add origin https://github.com/impeccable-e2e/staging-site
git -C "$R" add -A && git -C "$R" -c user.email=e2e@example.invalid -c user.name=e2e commit -qm init
"$BIN" pro-refresh > "$H/refresh.out" 2>&1
info "pro-refresh: $(tail -1 "$H/refresh.out" | cut -c1-160)"
(cd "$R" && "$BIN" detect .) > "$H/detect.out" 2> "$H/detect.err"; rc=$?
check "detect: runs on the repo" '[ $rc = 0 ] || [ $rc = 2 ]'
installed=$(ls "$IMPECCABLE_HOME"/account/*/pro/*/current.json 2>/dev/null | head -1)
if [ "${E2E_DISPATCH_REQUIRED:-0}" = 1 ]; then
  check "dispatch: no 'Pro rules are off' or 'aren't ready' line" '! grep -qE "Pro rules are off|Pro rules aren.t ready" "$H/detect.err"'
  check "dispatch: a Pro build is installed" '[ -n "$installed" ]'
  # The proof that Pro rules ran: the page's filler text trips a rule only the Pro build has.
  (cd "$R" && "$BIN" detect --json .) > "$H/pro.json" 2>/dev/null
  check "dispatch: a Pro rule fired (pristine/placeholder-copy)" 'grep -q "pristine/placeholder-copy" "$H/pro.json"'
else
  info "dispatch (not required): $([ -n "$installed" ] && echo 'a Pro build is installed' || echo 'no Pro build installed'). $(grep -m1 'Pro rules' "$H/detect.err" | cut -c1-120)"
fi
# The scan's notices (no secrets: product lines only), so a failure shows its cause.
while IFS= read -r line; do info "detect stderr: $line"; done < <(grep -E "^(Design health|Pro rules)" "$H/detect.err" | cut -c1-200)
if [ $health = 1 ]; then
  check "health: the scan's counts were saved (one-time notice)" 'grep -q "counts were saved to your account" "$H/detect.err"'
  "$BIN" health status > "$H/health.out" 2>&1
  info "health status: $(head -1 "$H/health.out" | cut -c1-200)"
  check "health: status says on" 'grep -q "^Design health: on" "$H/health.out"'
fi

# 4. --json output stays free of notices.
(cd "$R" && "$BIN" detect --json .) > "$H/json.out" 2> "$H/json.err"
check "json: stdout parses as JSON" 'jq -e . "$H/json.out" >/dev/null'
# Paul's rule (REN-1553): the not-entitled line stays out of machine output.
# Lines that say something is wrong ("not ready", "didn't verify") still print, on stderr.
check "json: no not-entitled line on stderr" '! grep -q "this account doesn.t include them" "$H/json.err"'

# 4b. Worlds (REN-1763): `impeccable world <id>` seeds a fresh project from a catalog
#     world, never overwrites, and names why when it can't. Skipped where staging
#     doesn't offer worlds:read or the binary has no world verb yet.
case "$scopes" in *" worlds:read "*) worlds=1 ;; *) worlds=0; info "staging does not offer worlds:read; worlds skipped" ;; esac
if [ "$worlds" = 1 ] && ! "$BIN" world --help > /dev/null 2>&1; then worlds=0; info "this binary has no world verb; worlds skipped"; fi
if [ "$worlds" = 1 ]; then
  W="$H/world-project"; mkdir -p "$W"
  PUBLIC_WORLD=${E2E_WORLD_PUBLIC:-sd-seedbed-lobes}
  PRO_WORLD=${E2E_WORLD_PRO:-boutique-window-dressed-as-diagonal}
  (cd "$W" && "$BIN" world "$PUBLIC_WORLD" > "$H/world.out" 2> "$H/world.err"); rc=$?
  check "world: seeds a public world (exit 0)" '[ $rc = 0 ]'
  info "world: $(tr '\n' ' ' < "$H/world.out" | cut -c1-200) $(tr '\n' ' ' < "$H/world.err" | cut -c1-200)"
  check "world: says the world is now the design system" 'grep -q "is now this project.s design system\.$" "$H/world.out"'
  check "world: no colour codes in piped output" '! grep -q "$(printf "\033")" "$H/world.out"'
  check "world: DESIGN.md names the world in its frontmatter" 'grep -q "^world: \"\{0,1\}$PUBLIC_WORLD" "$W/DESIGN.md"'
  check "world: DESIGN.md carries a reference image" 'grep -q "^Reference image: https://" "$W/DESIGN.md"'
  check "world: the sidecar is marked as seeded" '[ "$(jq -r .seededFrom.world "$W/.impeccable/design.json" 2>/dev/null)" = "$PUBLIC_WORLD" ]'
  # The seed's fingerprint, so a local build from the same world can be shown to start from these exact files.
  info "world: seed sha256 DESIGN.md $(shasum -a 256 "$W/DESIGN.md" | cut -d" " -f1) design.json $(shasum -a 256 "$W/.impeccable/design.json" | cut -d" " -f1)"
  before=$(shasum -a 256 "$W/DESIGN.md" | cut -d" " -f1)
  (cd "$W" && "$BIN" world "$PUBLIC_WORLD" > "$H/world2.out" 2>&1); rc=$?
  check "world: a second run writes nothing and points at --print" '[ $rc = 0 ] && grep -q "already exists, so nothing was written" "$H/world2.out" && [ "$(shasum -a 256 "$W/DESIGN.md" | cut -d" " -f1)" = "$before" ]'
  (cd "$W" && "$BIN" world "$PUBLIC_WORLD" --print > "$H/world-print.out" 2>/dev/null)
  check "world: --print hands over the seed as JSON" '[ "$(jq -r .id "$H/world-print.out" 2>/dev/null)" = "$PUBLIC_WORLD" ]'
  W2="$H/world-project-2"; mkdir -p "$W2"
  (cd "$W2" && "$BIN" world no-such-world-e2e > /dev/null 2> "$H/world404.err"); rc=$?
  check "world: an unknown id says so and writes nothing" '[ $rc = 1 ] && grep -q "^No world has the id no-such-world-e2e\." "$H/world404.err" && [ ! -e "$W2/DESIGN.md" ]'
  (cd "$W2" && "$BIN" world "$PRO_WORLD" > "$H/worldpro.out" 2> "$H/worldpro.err"); rc=$?
  if grep -q "Pro rules: included\|^Plan: \(Pro\|Team\)" "$H/whoami.out"; then
    check "world: a Pro world seeds on a Pro plan" '[ $rc = 0 ] && [ -f "$W2/DESIGN.md" ]'
  else
    check "world: a Pro world on Free names Pro and the pricing page" '[ $rc = 1 ] && grep -q "needs Pro\. See impeccable.style/pricing" "$H/worldpro.err" && [ ! -e "$W2/DESIGN.md" ]'
  fi
fi

# 5. Two sessions on one sign-in (pristine #4576): session B is a copy of A's stored
#    sign-in. Each forced refresh rotates the refresh token, so B's second refresh
#    presents a token A already used. Before #4576 that revoked the whole grant.
#    A refresh is forced by marking the stored access token expired; the CLI's own
#    refresh then runs. Tokens are never printed: only hashes of the refresh token
#    are compared.
creds() { ls "$1"/account/*/credentials.json 2>/dev/null | head -1; }
expire() { local f; f=$(creds "$1"); jq '.access_expires_at = 0' "$f" > "$f.tmp" && chmod 600 "$f.tmp" && mv "$f.tmp" "$f"; }
rhash() { jq -r '.refresh_token' "$(creds "$1")" | { if command -v sha256sum >/dev/null; then sha256sum; else shasum -a 256; fi; } | cut -c1-16; }
as_home() { local home=$1; shift; IMPECCABLE_HOME="$home" "$BIN" "$@"; }
A=$IMPECCABLE_HOME; B="$H/home-b"
cp -Rp "$A" "$B"
check "sibling: session B holds a copy of the sign-in" '[ -n "$(creds "$B")" ]'
r0=$(rhash "$A")
expire "$A"; as_home "$A" whoami > "$H/sa1.out" 2>&1; rc=$?
check "sibling: A refreshes and answers whoami" '[ $rc = 0 ] && grep -q "^Signed in to " "$H/sa1.out"'
check "sibling: A's refresh rotated its refresh token" '[ "$(rhash "$A")" != "$r0" ]'
expire "$B"; as_home "$B" whoami > "$H/sb1.out" 2>&1; rc=$?
check "sibling: B refreshes with the token A already used, and answers whoami" '[ $rc = 0 ] && grep -q "^Signed in to " "$H/sb1.out"'
check "sibling: B now holds its own refresh token" '[ "$(rhash "$B")" != "$(rhash "$A")" ] && [ "$(rhash "$B")" != "$r0" ]'
expire "$A"; as_home "$A" whoami > "$H/sa2.out" 2>&1; rc=$?
check "sibling: A refreshes again after B" '[ $rc = 0 ] && grep -q "^Signed in to " "$H/sa2.out"'
expire "$B"; as_home "$B" whoami > "$H/sb2.out" 2>&1; rc=$?
check "sibling: B refreshes again" '[ $rc = 0 ] && grep -q "^Signed in to " "$H/sb2.out"'
[ $rc = 0 ] || info "sibling B second refresh said: $(head -1 "$H/sb2.out" | cut -c1-160)"

# 6. Sign out (A). That revokes the grant, so B's next refresh must fail too.
"$BIN" logout > "$H/logout.out" 2>&1; rc=$?
check "logout: exits 0" '[ $rc = 0 ]'
"$BIN" whoami > "$H/whoami2.out" 2>&1
check "logout: whoami says not signed in" 'grep -q "^Not signed in" "$H/whoami2.out"'
expire "$B"; as_home "$B" whoami > "$H/sb3.out" 2>&1; rc=$?
check "sibling: after sign-out, B's refresh is refused" '[ $rc != 0 ] && grep -q "^Your sign-in expired" "$H/sb3.out"'
info "sibling B after sign-out said: $(head -1 "$H/sb3.out" | cut -c1-160)"

finish
