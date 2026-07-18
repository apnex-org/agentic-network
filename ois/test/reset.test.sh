#!/usr/bin/env bash
# reset.test.sh — work-274 (bug-298): PROVE the `ois reset` primitive wiring + IDEMPOTENCY.
#
# `ois reset <agent> [harness] [--force]` CONVERGES a seat to a running interactive tmux claude on
# the CURRENT tool schema (Director: idempotent). = safe-point `ois down` (only if a session is LIVE)
# + `ois up` (claude auto-resumes via -c when a prior conversation exists — idea-494 — else a graceful
# fresh start). This test exercises the REAL cmd_reset by sourcing ois (dispatch source-guarded) and
# stubbing the seat verbs, asserting: live-session restart (down->up, no extra args => -c path),
# harness auto-resolve, best-effort busy/idle guard + --force, usage error, and IDEMPOTENCY
# (session-absent => NO down, just a fresh up; dead-seat harness defaults to claude). The -c RESUME
# MECHANISM itself is proven separately by the two live `ois down/up <seat> claude -c` reloads in the
# refresh-spike receipts; this proves the verb WIRES that path + converges regardless of prior state.
#
# Run:  bash ois/test/reset.test.sh   → PASS / FAIL, exit 0 / 1.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/../bin/ois"   # loads cmd_reset + helpers; source-guard skips the CLI dispatch
set +e

CALLS="$(mktemp "${TMPDIR:-/tmp}/ois-reset-test-XXXXXX")"
# ── stubs (override the real seat verbs so the test never touches tmux/hub) ──
cmd_down() { echo "DOWN $*" >> "$CALLS"; }
cmd_up()   { echo "UP $*"   >> "$CALLS"; }
live_harness() { echo "claude"; }
session_name() { echo "ois-$1-$2"; }
SESSION_EXISTS=1                                 # controls stmux has-session
FAKE_PANE="❯ "                                   # default = idle prompt
stmux() { case "${2:-}" in
  has-session)  [[ "$SESSION_EXISTS" == 1 ]] && return 0 || return 1 ;;
  capture-pane) printf '%s\n' "$FAKE_PANE" ;;
  *)            return 0 ;;
esac }
fatal() { echo "FATAL: $*" >&2; exit 1; }        # exit is contained by the subshells below

pass=0; fail=0
has() { if printf '%s' "$2" | grep -qF "$3"; then echo "  ok: $1"; pass=$((pass+1)); else echo "  FAIL: $1 — want '$3' in: $2"; fail=$((fail+1)); fi; }
no()  { if printf '%s' "$2" | grep -qF "$3"; then echo "  FAIL: $1 — did NOT want '$3' in: $2"; fail=$((fail+1)); else echo "  ok: $1"; pass=$((pass+1)); fi; }

echo "== T1: LIVE session, reset <agent> <harness> => cmd_down then cmd_up, NO extra args (=> -c) =="
: > "$CALLS"; SESSION_EXISTS=1; FAKE_PANE="❯ "; ( cmd_reset testagent claude ) >/dev/null 2>&1
got="$(cat "$CALLS")"
has "cmd_down(testagent claude)" "$got" "DOWN testagent claude"
has "cmd_up(testagent claude) with no launch-args" "$got" "UP testagent claude"
if [[ "$(head -1 "$CALLS")" == DOWN* && "$(tail -1 "$CALLS")" == UP* ]]; then echo "  ok: ordering down->up"; pass=$((pass+1)); else echo "  FAIL: ordering"; fail=$((fail+1)); fi

echo "== T2: LIVE session, reset <agent> (no harness) auto-resolves via live_harness =="
: > "$CALLS"; SESSION_EXISTS=1; FAKE_PANE="❯ "; ( cmd_reset testagent ) >/dev/null 2>&1
has "auto-resolved harness -> up claude" "$(cat "$CALLS")" "UP testagent claude"

echo "== T3: LIVE + BUSY pane ('esc to interrupt') without --force => REFUSE, no down/up =="
: > "$CALLS"; SESSION_EXISTS=1; FAKE_PANE="✳ Working… (esc to interrupt)"
out="$( ( cmd_reset testagent claude ) 2>&1 )"
has "refuses with BUSY message" "$out" "BUSY"
no  "no seat verbs issued while busy" "$(cat "$CALLS")" "DOWN"

echo "== T4: LIVE + BUSY pane WITH --force => proceeds =="
: > "$CALLS"; SESSION_EXISTS=1; FAKE_PANE="✳ Working… (esc to interrupt)"; ( cmd_reset testagent claude --force ) >/dev/null 2>&1
has "--force overrides busy -> down/up" "$(cat "$CALLS")" "UP testagent claude"

echo "== T5: no agent => usage error =="
out="$( ( cmd_reset ) 2>&1 )"
has "usage error" "$out" "usage: ois reset"

echo "== T6: IDEMPOTENT — NO live session => NO cmd_down, just a fresh cmd_up (converge-to-running) =="
: > "$CALLS"; SESSION_EXISTS=0; FAKE_PANE=""; ( cmd_reset testagent claude ) >/dev/null 2>&1
no  "no cmd_down when there is no session" "$(cat "$CALLS")" "DOWN"
has "cmd_up issued (fresh start)" "$(cat "$CALLS")" "UP testagent claude"

echo "== T7: NO session + NO harness => default harness 'claude' (dead seat has none to infer) =="
: > "$CALLS"; SESSION_EXISTS=0; live_harness() { echo ""; }
( cmd_reset testagent ) >/dev/null 2>&1
has "defaults to claude for a dead seat" "$(cat "$CALLS")" "UP testagent claude"
live_harness() { echo "claude"; }

rm -f "$CALLS"
echo
if [[ $fail -eq 0 ]]; then echo "PASS: ois reset primitive (incl. idempotency) — $pass checks green"; exit 0; else echo "FAIL: $fail failed / $pass passed"; exit 1; fi
