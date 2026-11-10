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
#   E2E_DISPATCH_REQUIRED   optional, default 0; 1 makes Pro dispatch count toward the result
#
# Output: "PASS <check>", "FAIL <check>[: reason]" or "INFO ...", then "RESULT PASS|FAIL".
# Exit: 0 pass, 1 a check failed, 2 staging not ready, 3 bad inputs.
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
BIN=${E2E_IMPECCABLE_BIN:-$ROOT/target/release/impeccable}
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
export IMPECCABLE_NO_UPDATE_CHECK=1 IMPECCABLE_QUESTION_DISABLED=1 CI=${CI:-1}
unset IMPECCABLE_BIN IMPECCABLE_PRO DO_NOT_TRACK IMPECCABLE_NO_TELEMETRY

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
  check "dispatch: no 'Pro rules are off' line" '! grep -q "Pro rules are off" "$H/detect.err"'
  check "dispatch: a Pro build is installed" '[ -n "$installed" ]'
else
  info "dispatch (not required): $([ -n "$installed" ] && echo 'a Pro build is installed' || echo 'no Pro build installed'). $(grep -m1 'Pro rules' "$H/detect.err" | cut -c1-120)"
fi
if [ $health = 1 ]; then
  check "health: the scan's counts were saved (one-time notice)" 'grep -q "counts were saved to your account" "$H/detect.err"'
  "$BIN" health status > "$H/health.out" 2>&1
  check "health: status says on" 'grep -q "^Design health: on" "$H/health.out"'
fi

# 4. --json output stays free of notices.
(cd "$R" && "$BIN" detect --json .) > "$H/json.out" 2> "$H/json.err"
check "json: stdout parses as JSON" 'jq -e . "$H/json.out" >/dev/null'
check "json: no Pro or health notice on stderr" '! grep -qE "Pro rules|Design health" "$H/json.err"'

# 5. Sign out.
"$BIN" logout > "$H/logout.out" 2>&1; rc=$?
check "logout: exits 0" '[ $rc = 0 ]'
"$BIN" whoami > "$H/whoami2.out" 2>&1
check "logout: whoami says not signed in" 'grep -q "^Not signed in" "$H/whoami2.out"'

finish
