#!/usr/bin/env bash
# reap-scope.test.sh — bug-256/idea-511 + bug-303: PROVE the seat reap is blast-safe. It reaps
# ONLY the target seat (its CLAUDE_CONFIG_DIR-scoped stragglers + — only when the group is
# provably single-seat — its process group) and has NO cross-seat blast radius — the guarantee
# the cleanslate0 incident (bug-256) and the bug-303 fleet detonation (one `ois reset lily`
# group-killed greg+ruby+lily via a shared process group) violated.
#
# Sources ois (dispatch is source-guarded) to exercise the REAL reap_seat_procgroup /
# _reap_by_configdir / _group_has_foreign_cdir / _seat_new_session, against controlled throwaway
# process groups + a throwaway tmux socket. Self-cleaning; NEVER touches a real seat (the
# selfpgid guard + throwaway groups keep the runner and real seats out of blast range).
#
# Run:  bash ois/test/reap-scope.test.sh   → prints PASS / FAIL, exit 0 / 1.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/../bin/ois"   # loads fns; the source-guard skips the CLI dispatch
set +e                     # this harness drives its own failure handling
# Hermetic env: unset any ambient CLAUDE_CONFIG_DIR so throwaway sleepers are genuinely cdir-less
# (else running this test FROM a claude seat leaks that seat's cdir into every spawned group and
# the bug-303 mixed-group guard would see a phantom "foreign" seat). Tests that need a cdir set
# one explicitly. Matches the clean CI env where CLAUDE_CONFIG_DIR is not set.
unset CLAUDE_CONFIG_DIR

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

echo "== (4) bug-303: a MIXED group (two seats co-resident in ONE pgid, DIFFERENT cdirs) is NOT"
echo "       swept — the reap refuses the cross-seat group-kill and falls back to cdir-only =="
# Stage the bug-303 detonation shape: a shared process group holding two seats with different
# CLAUDE_CONFIG_DIRs. A setsid'd leader owns the group; its two children (no setsid of their own)
# inherit the leader's pgid == co-residency. This throwaway group is NOT the runner's group, so
# even the PRE-fix unconditional group-kill can only hit these sleepers (the selfpgid guard + the
# distinct setsid group keep the test runner and real seats safe).
CO_LEADER="$TDIR/coLeader"; CO_TPID="$TDIR/coTpid"; CO_SPID="$TDIR/coSpid"
setsid bash -c "
  echo \$\$ > '$CO_LEADER'
  ( export CLAUDE_CONFIG_DIR='$TDIR/seatT'; exec -a claude-coT sleep 30 ) & echo \$! > '$CO_TPID'
  ( export CLAUDE_CONFIG_DIR='$TDIR/seatS'; exec -a claude-coS sleep 30 ) & echo \$! > '$CO_SPID'
  wait
" >/dev/null 2>&1 &
disown 2>/dev/null || true   # keep job-control's async "Killed" notice out of the test output
for i in $(seq 1 30); do [[ -s "$CO_LEADER" && -s "$CO_TPID" && -s "$CO_SPID" ]] && break; sleep 0.1; done
CL=$(cat "$CO_LEADER" 2>/dev/null); CT=$(cat "$CO_TPID" 2>/dev/null); CS=$(cat "$CO_SPID" 2>/dev/null)
PIDS+=("$CL" "$CT" "$CS")
GT=$(ps -o pgid= -p "$CT" 2>/dev/null | tr -d ' '); GS=$(ps -o pgid= -p "$CS" 2>/dev/null | tr -d ' ')
if [[ "$GT" =~ ^[0-9]+$ && "$GT" == "$GS" ]]; then
  echo "  ok: seatT($CT) + seatS($CS) co-resident in one pgid ($GT)"
else
  echo "  FAIL: could not stage co-residency (pgidT=$GT pgidS=$GS)"; fail=1
fi
# reap targeting seatT (its pane_pid $CT sits in the shared group). PRE-FIX: `kill -- -$GT` sweeps
# both → seatS dies. POST-FIX: MIXED group detected (seatS = foreign cdir) → group-kill refused →
# cdir-only reap → seatT dies, seatS SURVIVES.
reap_seat_procgroup "$CT" "$TDIR/seatT"
assert_dead  "$CT" "seatT (target — cdir-reaped)"
assert_alive "$CS" "seatS co-resident sibling (foreign cdir MUST survive — bug-303 blast-safety)"

echo "== (5) bug-303: a seat launched via _seat_new_session gets its OWN pgid, severed from the"
echo "       caller — spawn-isolation so a peer-spawned seat is never in the spawner's group =="
if command -v tmux >/dev/null 2>&1; then
  T5SOCK="ois-reapscope5-$$"
  _seat_new_session "$T5SOCK" "sleep 30" >/dev/null 2>&1   # fn already does `env -u TMUX -u TMUX_PANE setsid -w` internally
  sleep 0.5
  T5PANE=$(tmux -L "$T5SOCK" list-panes -t "$T5SOCK" -F '#{pane_pid}' 2>/dev/null | head -1)
  MYGRP=$(ps -o pgid= -p "$$" 2>/dev/null | tr -d ' ')
  T5GRP=$(ps -o pgid= -p "$T5PANE" 2>/dev/null | tr -d ' ')
  if [[ "$T5PANE" =~ ^[0-9]+$ && "$T5GRP" =~ ^[0-9]+$ ]]; then
    if [[ "$T5GRP" != "$MYGRP" ]]; then
      echo "  ok: seat pane($T5PANE) pgid=$T5GRP is severed from caller pgid=$MYGRP"
    else
      echo "  FAIL: seat shares the caller's pgid ($T5GRP) — NOT spawn-isolated"; fail=1
    fi
  else
    echo "  FAIL: could not read the throwaway seat's pane pid/pgid (pane=$T5PANE grp=$T5GRP)"; fail=1
  fi
  tmux -L "$T5SOCK" kill-server 2>/dev/null
else
  echo "  SKIP: tmux not available — spawn-isolation assertion needs a real tmux"
fi

echo
if [[ $fail -eq 0 ]]; then
  echo "PASS: reap is blast-safe — cdir-primary + single-seat-group-only, mixed-group refused, spawn-isolated; zero cross-seat blast radius"
  exit 0
else
  echo "FAIL: reap scope violation"
  exit 1
fi
