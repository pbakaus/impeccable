#!/usr/bin/env bash
# Launch-day CLI smoke test: the published CLI, from a clean environment, step by step.
#
# Everything runs in a fresh scratch HOME: the CLI's sign-in, Loop's install, the agent
# configuration loop connect writes. Scans and uploads use a throwaway git repository
# with no remote, never a real one. Server-side data the run uploads is deleted again
# (health/critiques/setup forget) before sign-out.
#
# Usage:  scripts/launch-smoke.sh
# Env:
#   SMOKE_TARGET     production (default) or staging
#   SMOKE_VERSION    npm version to run with npx (default 4.9.0)
#   SMOKE_BIN        optional: run this engine binary instead of npx (a candidate build)
#   SMOKE_EXPECT_PRO 1 (default) when the signed-in account has Pro and Pro rules must load
#   SMOKE_LOOP       1 (default on macOS): also loop install, connect and disconnect
#   PRISTINE_DIR     staging only: pristine checkout whose `bun run staging-admin cli-login` works
#                    (signs in as Platform's seeded staging person; production needs a person)
#
# Output: "PASS <step>", "FAIL <step>[: reason]", "INFO ..." or "WAIT ..." lines, then
# "RESULT PASS|FAIL". Exit 0 pass, 1 a step failed, 3 bad inputs.
set -u
TARGET=${SMOKE_TARGET:-production}
VERSION=${SMOKE_VERSION:-4.9.0}
EXPECT_PRO=${SMOKE_EXPECT_PRO:-1}
LOOP=${SMOKE_LOOP:-$([ "$(uname)" = Darwin ] && echo 1 || echo 0)}
case "$TARGET" in
  production) ISSUER=https://api.impeccable.style ;;
  staging) ISSUER=https://api.staging.impeccable.style ;;
  *) echo "FAIL inputs: SMOKE_TARGET must be production or staging"; echo "RESULT FAIL"; exit 3 ;;
esac
for tool in curl jq git; do command -v "$tool" >/dev/null || { echo "FAIL inputs: $tool not on PATH"; echo "RESULT FAIL"; exit 3; }; done
if [ -n "${SMOKE_BIN:-}" ]; then
  case "$SMOKE_BIN" in /*) ;; *) SMOKE_BIN="$PWD/$SMOKE_BIN" ;; esac
  [ -x "$SMOKE_BIN" ] || { echo "FAIL inputs: SMOKE_BIN is not executable"; echo "RESULT FAIL"; exit 3; }
  CLI=("$SMOKE_BIN")
else
  command -v npx >/dev/null || { echo "FAIL inputs: npx not on PATH"; echo "RESULT FAIL"; exit 3; }
  CLI=(npx -y "impeccable@$VERSION")
fi
if [ "$TARGET" = staging ]; then
  [ -d "${PRISTINE_DIR:-}" ] || { echo "FAIL inputs: staging needs PRISTINE_DIR"; echo "RESULT FAIL"; exit 3; }
  command -v bun >/dev/null || { echo "FAIL inputs: bun not on PATH"; echo "RESULT FAIL"; exit 3; }
fi

REAL_PATH=$PATH
H=$(mktemp -d "${TMPDIR:-/tmp}/impeccable-launch-smoke.XXXXXX")
login_pid=""
cleanup() {
  if [ -n "$login_pid" ]; then kill "$login_pid" 2>/dev/null; wait "$login_pid" 2>/dev/null; fi
  rm -rf "$H"
}
trap cleanup EXIT
mkdir -p "$H/home" "$H/bin" "$H/repo"
# A clean person: a fresh home, no agent configuration, no opt-outs, no CI.
export HOME="$H/home" IMPECCABLE_ACCOUNT_URL="$ISSUER" IMPECCABLE_NO_UPDATE_CHECK=1
export IMPECCABLE_QUESTION_DISABLED=1 IMPECCABLE_TELEMETRY_CHANNEL=test
unset CI IMPECCABLE_HOME IMPECCABLE_BIN IMPECCABLE_PRO DO_NOT_TRACK IMPECCABLE_NO_TELEMETRY
unset CLAUDE_CONFIG_DIR CODEX_HOME IMPECCABLE_CLAUDE_BIN IMPECCABLE_CODEX_BIN
[ "$TARGET" = staging ] && export IMPECCABLE_CREDENTIAL_STORE=file
imp() { "${CLI[@]}" "$@"; }

failed=0
pass() { echo "PASS $1"; }
fail() { echo "FAIL $1${2:+: $2}"; failed=1; }
check() { if eval "$2"; then pass "$1"; else fail "$1"; fi; }
info() { echo "INFO $*"; }
finish() {
  [ $failed = 0 ] && { echo "RESULT PASS"; exit 0; }
  echo "RESULT FAIL"; exit 1
}

info "target $TARGET ($ISSUER), cli: ${CLI[*]}"
info "engine $(imp --version 2>/dev/null | head -1)"

# 0. The service is up and offers what the CLI asks for.
meta=$(curl -sf "$ISSUER/.well-known/oauth-authorization-server") || { fail "preflight: OAuth metadata"; finish; }
scopes=" $(printf '%s' "$meta" | jq -r '.scopes_supported|join(" ")') "
for s in rules:read health:write setup:write foundations:write design:write critiques:write; do
  case "$scopes" in *" $s "*) pass "preflight: service offers $s" ;; *) info "service does not offer $s (its step is skipped)" ;; esac
done
offers() { case "$scopes" in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

# 1. Sign in. Production: a person opens the printed link and approves. Staging: the seeded person.
imp login --no-browser > "$H/login.out" 2> "$H/login.err" &
login_pid=$!
url=""
for _ in $(seq 1 150); do url=$(grep -m1 '^https://' "$H/login.out" 2>/dev/null); [ -n "$url" ] && break; sleep 0.2; done
[ -n "$url" ] || { fail "login: the CLI printed a sign-in link"; finish; }
pass "login: the CLI printed a sign-in link"
if [ "$TARGET" = staging ]; then
  answer=$(cd "$PRISTINE_DIR" && bun run --silent staging-admin cli-login "$url" 2>&1 | grep -E '^(approved|refused:)' | tail -1)
  [ "$answer" = approved ] || { fail "login: consent" "${answer:-no answer from staging-admin}"; finish; }
else
  echo "WAIT open this link in your browser and approve (10 minutes):"
  echo "$url"
fi
for _ in $(seq 1 3100); do kill -0 "$login_pid" 2>/dev/null || break; sleep 0.2; done
if kill -0 "$login_pid" 2>/dev/null; then fail "login: finished" "still waiting after 620 s"; finish; fi
wait "$login_pid"; rc=$?; login_pid=""
check "login: signed in" '[ $rc = 0 ]'

# 2. whoami: the account, the plan, Pro.
imp whoami > "$H/whoami.out" 2>&1; rc=$?
check "whoami: exits 0" '[ $rc = 0 ]'
check "whoami: signed in" 'grep -q "^Signed in to " "$H/whoami.out"'
if [ "$EXPECT_PRO" = 1 ]; then
  check "whoami: the plan includes Pro" 'grep -qE "Pro rules: included|^Plan: Pro" "$H/whoami.out"'
fi
info "whoami: $(tr '\n' ' ' < "$H/whoami.out" | cut -c1-200)"

# 3. A throwaway repository: no remote, a page with an AI tell and placeholder copy, a DESIGN.md.
git -C "$H/repo" init -q -b main
printf '%s\n' '<!doctype html><html><body style="font-family:Inter">' \
  '<h1 style="background:linear-gradient(90deg,#7c3aed,#db2777);-webkit-background-clip:text;color:transparent">Unleash your potential</h1>' \
  '<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p></body></html>' > "$H/repo/index.html"
printf '%s\n' '# Design' '' 'Smoke-test design system: one accent, one typeface.' > "$H/repo/DESIGN.md"
git -C "$H/repo" add -A && git -C "$H/repo" -c user.name=smoke -c user.email=smoke@invalid commit -qm smoke

# 4. A full detect: findings, Pro rules when expected, design health and DESIGN.md's first upload.
(cd "$H/repo" && imp detect . > "$H/detect.out" 2> "$H/detect.err"); rc=$?
check "detect: runs (exit 0 or 2)" '[ $rc = 0 ] || [ $rc = 2 ]'
check "detect: finds the AI-pattern fixture" 'grep -qiE "gradient|slop|ai" "$H/detect.out"'
if [ "$EXPECT_PRO" = 1 ]; then
  check "detect: Pro rules load (placeholder copy)" 'grep -q "placeholder-copy" "$H/detect.out"'
  check "detect: no 'Pro rules are off' line" '! grep -q "Pro rules are off\|Pro rules aren" "$H/detect.err"'
fi
if offers design:write; then
  check "DESIGN.md: first-upload notice" 'grep -q "Uploaded your DESIGN.md to your Impeccable account." "$H/detect.err"'
  (cd "$H/repo" && imp detect . > /dev/null 2> "$H/detect2.err")
  check "DESIGN.md: notice not repeated" '! grep -q "Uploaded your DESIGN.md" "$H/detect2.err"'
fi

# 5. Critique history: one saved report, its first-upload notice.
if offers critiques:write; then
  printf '# Critique\n\nSmoke test report.\n' > "$H/report.md"
  (cd "$H/repo" && IMPECCABLE_CRITIQUE_META='{"target":"Smoke","total_score":24,"max_score":32,"p0_count":0,"p1_count":1}' \
    imp critique-storage write smoke "$H/report.md" > "$H/crit.out" 2> "$H/crit.err"); rc=$?
  check "critique: saved" '[ $rc = 0 ]'
  check "critique: first-upload notice" 'grep -q "Uploaded this critique report to your Impeccable account." "$H/crit.out" "$H/crit.err"'
fi

# 6. Setup status reports on by default.
if offers setup:write; then
  imp setup status > "$H/setup.out" 2>&1
  check "setup status: on" 'grep -q "^Setup status: on" "$H/setup.out"'
fi

# 7. Loop: install, connect one agent (Claude Code, if installed), disconnect. macOS only.
if [ "$LOOP" = 1 ]; then
  imp loop install --no-open > "$H/loop.out" 2>&1; rc=$?
  check "loop install: exits 0" '[ $rc = 0 ]'
  check "loop install: the app is in ~/Applications" '[ -x "$HOME/Applications/Impeccable Loop.app/Contents/MacOS/loop-hook" ]'
  claude=$(PATH=$REAL_PATH command -v claude || true)
  if [ -n "$claude" ]; then
    # Only Claude Code: Codex's MCP add starts its own browser sign-in.
    ln -s "$claude" "$H/bin/claude"
    PATH="$H/bin:/usr/bin:/bin" imp loop connect > "$H/connect.out" 2>&1; rc=$?
    check "loop connect: exits 0" '[ $rc = 0 ]'
    check "loop connect: Claude Code connected" 'grep -q "^Claude Code: connected" "$H/connect.out"'
    mcp=$(jq -r '.mcpServers.impeccable.url // empty' "$HOME/.claude.json" 2>/dev/null)
    check "loop connect: MCP server registered" '[ -n "$mcp" ]'
    info "loop connect: MCP server $mcp"
    PATH="$H/bin:/usr/bin:/bin" imp loop disconnect > "$H/disconnect.out" 2>&1; rc=$?
    check "loop disconnect: exits 0" '[ $rc = 0 ]'
    check "loop disconnect: Claude Code disconnected" 'grep -q "^Claude Code: disconnected" "$H/disconnect.out"'
  else
    info "Claude Code not installed; loop connect skipped"
  fi
fi

# 8. Delete what this run uploaded, then sign out.
if offers critiques:write; then imp critiques forget > /dev/null 2>&1; rc=$?; check "cleanup: critique history deleted" '[ $rc = 0 ]'; fi
if offers setup:write; then imp setup forget > /dev/null 2>&1; rc=$?; check "cleanup: setup reports deleted" '[ $rc = 0 ]'; fi
(cd "$H/repo" && imp health forget > /dev/null 2>&1); rc=$?; check "cleanup: design health deleted" '[ $rc = 0 ]'
imp logout > "$H/logout.out" 2>&1; rc=$?
check "logout: exits 0" '[ $rc = 0 ]'
imp whoami > "$H/whoami2.out" 2>&1
check "logout: whoami says not signed in" 'grep -q "^Not signed in" "$H/whoami2.out"'

finish
