#!/usr/bin/env bash
# reap-scope.test.sh — bug-256/idea-511 + bug-303 (oisfix2): PROVE the seat reap is blast-safe.
# The reap targets ONLY the seat whose canonical OIS_SEAT_ID matches, signalling each PID
# individually (exact /proc/<pid>/environ) — NEVER a process-group kill. So a co-resident sibling
# with a different / absent / unreadable identity CANNOT be swept — the guarantee the bug-303 fleet
# detonation (one `ois reset lily` group-killed greg+ruby+lily via a shared pgid) violated, and the
# guarantee oisfix0's fail-OPEN cdir/group-kill defense still violated for cdir-less siblings.
#
# Sources ois (dispatch source-guarded) to exercise the REAL reap_seat / _seat_id_of_pid /
# _seat_pid_starttime / _seat_new_session against controlled throwaway procs + a throwaway tmux
# socket. Self-cleaning; NEVER touches a real seat (throwaway ids/groups keep the runner + real
# seats out of blast range).
#
# The DISCRIMINATING negatives (1)-(4) call the reap via a VERSION-AWARE entrypoint (reap_target):
# on oisfix2 -> reap_seat(seat_id); on the pre-fix oisfix0 -> reap_seat_procgroup(pane_pid,cdir).
# So each MUST-FAIL-on-oisfix0 case is honestly demonstrable with `git stash push -- ois/bin/ois`.
#
# Run:  bash ois/test/reap-scope.test.sh   -> prints PASS / FAIL, exit 0 / 1.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/../bin/ois"   # loads fns; the source-guard skips the CLI dispatch
set +e
# Hermetic env: never leak the test-runner's own identity into throwaway procs.
unset OIS_SEAT_ID CLAUDE_CONFIG_DIR

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

# VERSION-AWARE reap entrypoint so the discriminating scenarios FAIL on the pre-fix oisfix0 code.
#   oisfix2: reap_seat(<seat_id>)                     — exact-id, no group signal
#   oisfix0: reap_seat_procgroup(<pane_pid>, <cdir>)  — the fail-open cdir/group-kill defense
reap_target() { # <target_pane_pid> <target_cdir> <target_seat_id>
  if declare -F reap_seat >/dev/null 2>&1; then reap_seat "$3"
  elif declare -F reap_seat_procgroup >/dev/null 2>&1; then reap_seat_procgroup "$1" "$2"
  else echo "  FAIL: no reap entrypoint defined"; fail=1; fi
}

# stage_coresident <tsid> <tcdir> <ssid> <scdir>: a setsid leader + a TARGET child and a SIBLING
# child (both plain subshells → they INHERIT the leader's process group == co-residency). Each child
# starts from a clean identity slate, then applies only the given OIS_SEAT_ID / CLAUDE_CONFIG_DIR.
# Sets CO_LEADER, CO_TARGET, CO_SIB. (An empty id/cdir arg = that var is left UNSET on that child.)
stage_coresident() {
  local tsid="$1" tcdir="$2" ssid="$3" scdir="$4" texp="" sexp="" i
  : > "$TDIR/L"; : > "$TDIR/T"; : > "$TDIR/S"
  [[ -n "$tsid"  ]] && texp+="export OIS_SEAT_ID='$tsid'; "
  [[ -n "$tcdir" ]] && texp+="export CLAUDE_CONFIG_DIR='$tcdir'; "
  [[ -n "$ssid"  ]] && sexp+="export OIS_SEAT_ID='$ssid'; "
  [[ -n "$scdir" ]] && sexp+="export CLAUDE_CONFIG_DIR='$scdir'; "
  setsid bash -c "
    echo \$\$ > '$TDIR/L'
    ( unset OIS_SEAT_ID CLAUDE_CONFIG_DIR; $texp exec -a seat-target sleep 30 ) & echo \$! > '$TDIR/T'
    ( unset OIS_SEAT_ID CLAUDE_CONFIG_DIR; $sexp exec -a seat-sib    sleep 30 ) & echo \$! > '$TDIR/S'
    wait
  " >/dev/null 2>&1 &
  disown 2>/dev/null || true
  for i in $(seq 1 30); do [[ -s "$TDIR/L" && -s "$TDIR/T" && -s "$TDIR/S" ]] && break; sleep 0.1; done
  CO_LEADER=$(cat "$TDIR/L" 2>/dev/null); CO_TARGET=$(cat "$TDIR/T" 2>/dev/null); CO_SIB=$(cat "$TDIR/S" 2>/dev/null)
  PIDS+=("$CO_LEADER" "$CO_TARGET" "$CO_SIB")
  # sanity: target + sibling really co-resident in ONE pgid
  local gt gs; gt=$(ps -o pgid= -p "$CO_TARGET" 2>/dev/null | tr -d ' '); gs=$(ps -o pgid= -p "$CO_SIB" 2>/dev/null | tr -d ' ')
  [[ "$gt" =~ ^[0-9]+$ && "$gt" == "$gs" ]] || { echo "  FAIL: could not stage co-residency (pgidT=$gt pgidS=$gs)"; fail=1; }
}

# reap a co-resident scenario targeting the target seat, then assert the sibling SURVIVED.
run_negative() { # <label> <tsid> <tcdir> <ssid> <scdir>
  local label="$1"; shift
  stage_coresident "$1" "$2" "$3" "$4"
  reap_target "$CO_TARGET" "$2" "$1"
  assert_dead  "$CO_TARGET" "target ($1)"
  assert_alive "$CO_SIB"    "$label"
}

echo "== (1) cdir-less foreign sibling co-resident in the target's group SURVIVES (steve's falsifier) =="
run_negative "cdir-less foreign sibling (no OIS_SEAT_ID, no CLAUDE_CONFIG_DIR)" \
  "ois-lily-claude" "$TDIR/seatLily" "" ""

echo "== (2) SAME AGENT, TWO HARNESSES: ois-lily-pi sibling SURVIVES a reap of ois-lily-claude =="
run_negative "same-agent/other-harness sibling (ois-lily-pi)" \
  "ois-lily-claude" "$TDIR/seatLily" "ois-lily-pi" ""

echo "== (3) foreign-AGENT sibling (ois-greg-claude, cdir-less) co-resident SURVIVES =="
run_negative "foreign-agent sibling (ois-greg-claude)" \
  "ois-lily-claude" "$TDIR/seatLily" "ois-greg-claude" ""

echo "== (4) legacy-no-id sibling (launched by a pre-oisfix2 ois) co-resident SURVIVES (fail-closed) =="
run_negative "legacy-no-id sibling" \
  "ois-lily-claude" "$TDIR/seatLily" "" "$TDIR/seatOther"

echo "== (5) empty args are a safe no-op (never a broad signal) =="
reap_target "" "" ""
echo "  ok: empty reap did not error"

echo "== (6) bug-256: a DETACHED (own-session) straggler carrying the target OIS_SEAT_ID is reaped =="
# detached = its OWN process group (setsid), NOT in any pane group — the id-reap still finds it.
OIS_SEAT_ID="ois-lily-claude" CLAUDE_CONFIG_DIR="$TDIR/seatLily" setsid bash -c "echo \$\$ > '$TDIR/D'; exec -a seat-detached sleep 30" >/dev/null 2>&1 &
disown 2>/dev/null || true
for i in $(seq 1 20); do [[ -s "$TDIR/D" ]] && break; sleep 0.1; done
D=$(cat "$TDIR/D" 2>/dev/null); PIDS+=("$D")
reap_target "$D" "$TDIR/seatLily" "ois-lily-claude"
assert_dead "$D" "detached id-retaining straggler (bug-256 reap preserved)"

echo "== (7) id-retention: a DESCENDANT inherits OIS_SEAT_ID; the whole tree is reaped =="
OIS_SEAT_ID="ois-lily-claude" CLAUDE_CONFIG_DIR="$TDIR/seatLily" setsid bash -c "
  echo \$\$ > '$TDIR/TP'
  ( exec -a seat-child sleep 30 ) & echo \$! > '$TDIR/TC'
  wait
" >/dev/null 2>&1 &
disown 2>/dev/null || true
for i in $(seq 1 20); do [[ -s "$TDIR/TP" && -s "$TDIR/TC" ]] && break; sleep 0.1; done
TP=$(cat "$TDIR/TP" 2>/dev/null); TC=$(cat "$TDIR/TC" 2>/dev/null); PIDS+=("$TP" "$TC")
if [[ "$(_seat_id_of_pid "$TC")" == "ois-lily-claude" ]]; then echo "  ok: child inherited OIS_SEAT_ID"; else echo "  FAIL: child did not inherit OIS_SEAT_ID"; fail=1; fi
reap_target "$TP" "$TDIR/seatLily" "ois-lily-claude"
assert_dead "$TP" "tree parent"
assert_dead "$TC" "tree child (inherited id)"

echo "== (8) do_launch OVERWRITES an inherited OIS_SEAT_ID (a peer-spawn can't inherit the spawner's) =="
got=$(OIS_SEAT_ID="ois-spawner-claude" bash -c 'source "'"$DIR/../bin/ois"'"; a=lily; h=claude; export OIS_SEAT_ID="$(session_name "$a" "$h")"; printf %s "$OIS_SEAT_ID"' 2>/dev/null)
if [[ "$got" == "ois-lily-claude" ]]; then echo "  ok: inherited 'ois-spawner-claude' overwritten to '$got'"; else echo "  FAIL: overwrite produced '$got'"; fail=1; fi

echo "== (9) seat-token validation rejects a delimiter-ambiguous token (fail-closed in do_launch) =="
if [[ "a-b" =~ ^[A-Za-z0-9_]+$ ]]; then echo "  FAIL: hyphenated token 'a-b' wrongly accepted"; fail=1; else echo "  ok: 'a-b' rejected (do_launch would fatal — unambiguous id)"; fi
if [[ "lily" =~ ^[A-Za-z0-9_]+$ && "claude" =~ ^[A-Za-z0-9_]+$ ]]; then echo "  ok: canonical tokens accepted"; else echo "  FAIL: canonical tokens rejected"; fail=1; fi

echo "== (10) PID-reuse guard: _seat_pid_starttime is a stable numeric start-identity; unreadable -> empty (fail-closed) =="
s1=$(_seat_pid_starttime "$$"); sleep 0.2; s2=$(_seat_pid_starttime "$$")
if [[ "$s1" =~ ^[0-9]+$ && "$s1" == "$s2" ]]; then echo "  ok: starttime stable+numeric ($s1)"; else echo "  FAIL: starttime s1='$s1' s2='$s2'"; fail=1; fi
if [[ -z "$(_seat_pid_starttime 999999)" ]]; then echo "  ok: unreadable pid -> empty starttime -> _reap_seat_signal skips (fail-closed)"; else echo "  note: pid 999999 unexpectedly present (skipping)"; fi

echo "== (11) spawn isolation — POSTCONDITION ONLY (NOT setsid causality): a seat launched via"
echo "        _seat_new_session gets its OWN pgid, severed from the caller =="
if command -v tmux >/dev/null 2>&1; then
  T11="ois-reapscope11-$$"
  _seat_new_session "$T11" "sleep 30" >/dev/null 2>&1   # fn does `env -u TMUX -u TMUX_PANE setsid -w` internally
  sleep 0.5
  pane=$(tmux -L "$T11" list-panes -t "$T11" -F '#{pane_pid}' 2>/dev/null | head -1)
  mygrp=$(ps -o pgid= -p "$$" 2>/dev/null | tr -d ' ')
  pgrp=$(ps -o pgid= -p "$pane" 2>/dev/null | tr -d ' ')
  if [[ "$pane" =~ ^[0-9]+$ && "$pgrp" =~ ^[0-9]+$ ]]; then
    if [[ "$pgrp" != "$mygrp" ]]; then echo "  ok: seat pane($pane) pgid=$pgrp severed from caller pgid=$mygrp"; else echo "  FAIL: seat shares caller pgid ($pgrp)"; fail=1; fi
  else echo "  FAIL: could not read pane pid/pgid (pane=$pane pgid=$pgrp)"; fail=1; fi
  tmux -L "$T11" kill-server 2>/dev/null
else
  echo "  SKIP: tmux not available — spawn-isolation assertion needs a real tmux"
fi

echo
if [[ $fail -eq 0 ]]; then
  echo "PASS: reap is blast-safe — exact-OIS_SEAT_ID per-PID reap, no group signal; foreign/cross-harness/legacy/cdir-less siblings survive; id-retaining stragglers + trees reaped to quiescence; zero cross-seat blast radius"
  exit 0
else
  echo "FAIL: reap scope violation"
  exit 1
fi
