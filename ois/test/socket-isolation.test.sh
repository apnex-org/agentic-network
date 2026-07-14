#!/usr/bin/env bash
# socket-isolation.test.sh — bug-248/idea-512: PROVE per-seat tmux isolation. A `tmux
# kill-server` on ONE seat's `-L` socket wipes only that seat's server — never another
# seat's, never the operator's default server. This is the guarantee the shared DEFAULT
# server (cleanslate0) violated. Sources ois (dispatch source-guarded) to exercise the real
# `stmux` wrapper. Self-cleaning; uses $$-unique sockets (no overlap with real seats).
#
# Run:  bash ois/test/socket-isolation.test.sh   → PASS / FAIL, exit 0 / 1.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/../bin/ois"   # loads stmux + helpers; source-guard skips the CLI dispatch
set +e

command -v tmux >/dev/null 2>&1 || { echo "SKIP: tmux not available"; exit 0; }

SA="ois-testA-$$"; SB="ois-testB-$$"
cleanup() { tmux -L "$SA" kill-server 2>/dev/null; tmux -L "$SB" kill-server 2>/dev/null; }
trap cleanup EXIT

fail=0
echo "== two seats, each on its OWN per-seat socket =="
stmux "$SA" new-session -d -s "$SA" "sleep 60" 2>/dev/null || { echo "  FAIL: could not start seat A"; fail=1; }
stmux "$SB" new-session -d -s "$SB" "sleep 60" 2>/dev/null || { echo "  FAIL: could not start seat B"; fail=1; }
sleep 0.5
stmux "$SA" has-session -t "$SA" 2>/dev/null && echo "  ok: seat A up (socket $SA)" || { echo "  FAIL: A not up"; fail=1; }
stmux "$SB" has-session -t "$SB" 2>/dev/null && echo "  ok: seat B up (socket $SB)" || { echo "  FAIL: B not up"; fail=1; }

echo "== kill-server on A's socket must NOT reach B =="
tmux -L "$SA" kill-server 2>/dev/null
sleep 0.3
if stmux "$SA" has-session -t "$SA" 2>/dev/null; then echo "  FAIL: A survived its own kill-server"; fail=1; else echo "  ok: A's server gone"; fi
if stmux "$SB" has-session -t "$SB" 2>/dev/null; then echo "  ok: B SURVIVED A's kill-server (isolated — no cross-seat blast)"; else echo "  FAIL: B was wiped by A's kill-server — CROSS-SEAT BLAST"; fail=1; fi

echo
if [[ $fail -eq 0 ]]; then
  echo "PASS: per-seat tmux isolation — a kill-server on one seat's socket cannot reach another seat"
  exit 0
else
  echo "FAIL: socket isolation violated"
  exit 1
fi
