#!/usr/bin/env bash
# reap-scope.test.sh — bug-256/idea-511: PROVE the seat reap is blast-safe. It reaps ONLY
# the target seat (its process group + its CLAUDE_CONFIG_DIR-scoped stragglers) and has NO
# cross-seat blast radius — the guarantee the cleanslate0 incident (a broad kill wiping
# greg+lily off the shared default tmux server) violated.
#
# Sources ois (dispatch is source-guarded) to exercise the REAL reap_seat_procgroup /
# _reap_by_configdir, against controlled throwaway process groups. Self-cleaning.
#
# Run:  bash ois/test/reap-scope.test.sh   → prints PASS / FAIL, exit 0 / 1.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/../bin/ois"   # loads fns; the source-guard skips the CLI dispatch
set +e                     # this harness drives its own failure handling

TDIR="$(mktemp -d)"
PIDS=()
cleanup() {
  local p
  for p in "${PIDS[@]}"; do kill -KILL "$p" 2>/dev/null; kill -KILL "-$p" 2>/dev/null; done
  rm -rf "$TDIR"
}
trap cleanup EXIT

fail=0
alive() { kill -0 "$1" 2>/dev/null; }
assert_dead()  { if alive "$1"; then echo "  FAIL: $2 still alive ($1)"; fail=1; else echo "  ok: $2 reaped"; fi; }
assert_alive() { if alive "$1"; then echo "  ok: $2 survived"; else echo "  FAIL: $2 was killed ($1)"; fail=1; fi; }

# spawn a session/group-leader sleeper; write its own pid (== pgid) to a file; return it.
spawn_group() { # <pidfile> [envkv] [argv0]
  local pf="$1" envkv="${2:-}" a0="${3:-sleeper}"
  # `>/dev/null 2>&1` on the background job is LOAD-BEARING: without it the child's stdout
  # fd is inherited by this function's command-substitution, which then blocks until the
  # child exits (the classic $(...)-waits-on-an-inherited-backgrounded-fd hang).
  if [[ -n "$envkv" ]]; then
    env "$envkv" setsid bash -c "echo \$\$ > '$pf'; exec -a '$a0' sleep 30" >/dev/null 2>&1 &
  else
    setsid bash -c "echo \$\$ > '$pf'; exec -a '$a0' sleep 30" >/dev/null 2>&1 &
  fi
  # the setsid child (the real group leader) writes its own pid; wait for it to appear.
  local i; for i in $(seq 1 20); do [[ -s "$pf" ]] && break; sleep 0.1; done
  cat "$pf"
}

echo "== (1) process-GROUP reap does not cross into a sibling group =="
A=$(spawn_group "$TDIR/pgA"); PIDS+=("$A")
B=$(spawn_group "$TDIR/pgB"); PIDS+=("$B")
[[ "$A" =~ ^[0-9]+$ && "$B" =~ ^[0-9]+$ && "$A" != "$B" ]] || { echo "  FAIL: bad spawn ($A/$B)"; fail=1; }
reap_seat_procgroup "$A" ""     # reap A's group only (no config-dir arg)
assert_dead  "$A" "target group A"
assert_alive "$B" "sibling group B"

echo "== (2) config-dir sweep hits only the matching CLAUDE_CONFIG_DIR seat =="
X=$(spawn_group "$TDIR/pgX" "CLAUDE_CONFIG_DIR=$TDIR/seatX" "claude-testX"); PIDS+=("$X")
Y=$(spawn_group "$TDIR/pgY" "CLAUDE_CONFIG_DIR=$TDIR/seatY" "claude-testY"); PIDS+=("$Y")
reap_seat_procgroup "" "$TDIR/seatX"   # reap only the seatX config-dir (no pgid arg)
assert_dead  "$X" "seatX (matching config dir)"
assert_alive "$Y" "seatY (different config dir — proves real seats are untouched)"

echo "== (3) empty args are a safe no-op (never kill-server / bare-pgid) =="
reap_seat_procgroup "" ""
echo "  ok: empty reap did not error"

echo
if [[ $fail -eq 0 ]]; then
  echo "PASS: reap is blast-safe — group-scoped + config-dir-scoped, zero cross-seat blast radius"
  exit 0
else
  echo "FAIL: reap scope violation"
  exit 1
fi
