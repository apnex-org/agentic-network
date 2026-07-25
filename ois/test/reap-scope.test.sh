#!/usr/bin/env bash
# reap-scope.test.sh — bug-256/idea-511 + bug-303 (oisfix2/oisfix3): PROVE the seat reap is blast-safe.
# The reap targets ONLY the seat whose canonical OIS_SEAT_ID matches, signalling each PID
# individually (exact /proc/<pid>/environ) — NEVER a process-group kill. So a co-resident sibling
# with a different / absent / unreadable identity CANNOT be swept — the guarantee the bug-303 fleet
# detonation (one `ois reset lily` group-killed greg+ruby+lily via a shared pgid) violated, and the
# guarantee oisfix0's fail-OPEN cdir/group-kill defense still violated for cdir-less siblings.
#
# Sources ois (dispatch source-guarded) to exercise the REAL reap_seat / _seat_id_of_pid /
# _seat_pid_starttime / _seat_new_session against controlled throwaway procs + a throwaway tmux
# socket. Self-cleaning; NEVER touches a real seat: the reap keys are PID-UNIQUE throwaway ids
# (TW/TID below) that can NEVER match a live seat's OIS_SEAT_ID — even POST-DEPLOY when seats carry
# one — and the exact-id reap + selfpgid guard keep the runner + real seats out of blast range.
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
# bug-303 (oisfix3 follow-up, greg): PID-UNIQUE throwaway seat ids so the exact-id reap can NEVER
# match a REAL fleet seat — even post-deploy when live seats carry OIS_SEAT_ID (a bug-303 FIX must
# NOT ship a test that re-creates the bug-303 detonation). The 'reaptest<pid>a'/'reaptest<pid>b'
# agent tokens cannot collide with any real agent name; used across ALL reap tests (1-4/6/7 real
# reap; 8/9 kill-spy).
TW="ois-reaptest$$"
TID="${TW}a-claude"      # target seat (throwaway agent reaptest<pid>a, harness claude)
TID_H2="${TW}a-pi"       # (2) SAME agent, other harness
TID_FA="${TW}b-claude"   # (3) FOREIGN agent

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
  "$TID" "$TDIR/seatLily" "" ""

echo "== (2) SAME AGENT, TWO HARNESSES: $TID_H2 sibling SURVIVES a reap of $TID =="
run_negative "same-agent/other-harness sibling ($TID_H2)" \
  "$TID" "$TDIR/seatLily" "$TID_H2" ""

echo "== (3) foreign-AGENT sibling ($TID_FA, cdir-less) co-resident SURVIVES =="
run_negative "foreign-agent sibling ($TID_FA)" \
  "$TID" "$TDIR/seatLily" "$TID_FA" ""

echo "== (4) legacy-no-id sibling (launched by a pre-oisfix2 ois) co-resident SURVIVES (fail-closed) =="
run_negative "legacy-no-id sibling" \
  "$TID" "$TDIR/seatLily" "" "$TDIR/seatOther"

echo "== (5) empty args are a safe no-op (never a broad signal) =="
reap_target "" "" ""
echo "  ok: empty reap did not error"

echo "== (6) bug-256: a DETACHED (own-session) straggler carrying the target OIS_SEAT_ID is reaped =="
# detached = its OWN process group (setsid), NOT in any pane group — the id-reap still finds it.
OIS_SEAT_ID="$TID" CLAUDE_CONFIG_DIR="$TDIR/seatLily" setsid bash -c "echo \$\$ > '$TDIR/D'; exec -a seat-detached sleep 30" >/dev/null 2>&1 &
disown 2>/dev/null || true
for i in $(seq 1 20); do [[ -s "$TDIR/D" ]] && break; sleep 0.1; done
D=$(cat "$TDIR/D" 2>/dev/null); PIDS+=("$D")
reap_target "$D" "$TDIR/seatLily" "$TID"
assert_dead "$D" "detached id-retaining straggler (bug-256 reap preserved)"

echo "== (7) id-retention: a DESCENDANT inherits OIS_SEAT_ID; the whole tree is reaped =="
OIS_SEAT_ID="$TID" CLAUDE_CONFIG_DIR="$TDIR/seatLily" setsid bash -c "
  echo \$\$ > '$TDIR/TP'
  ( exec -a seat-child sleep 30 ) & echo \$! > '$TDIR/TC'
  wait
" >/dev/null 2>&1 &
disown 2>/dev/null || true
for i in $(seq 1 20); do [[ -s "$TDIR/TP" && -s "$TDIR/TC" ]] && break; sleep 0.1; done
TP=$(cat "$TDIR/TP" 2>/dev/null); TC=$(cat "$TDIR/TC" 2>/dev/null); PIDS+=("$TP" "$TC")
if [[ "$(_seat_id_of_pid "$TC")" == "$TID" ]]; then echo "  ok: child inherited OIS_SEAT_ID"; else echo "  FAIL: child did not inherit OIS_SEAT_ID"; fail=1; fi
reap_target "$TP" "$TDIR/seatLily" "$TID"
assert_dead "$TP" "tree parent"
assert_dead "$TC" "tree child (inherited id)"

# (do_launch OVERWRITE + token-validation are now proven END-TO-END through the real `ois launch`
#  path in ois/test/seat-identity.test.sh — oisfix2's in-test export/regex versions were hollow,
#  steve's oisfix2 blockers 1+2. This file keeps the reap-signal guards, driven for real below.)

echo "== (8) PID-REUSE guard: _reap_seat_signal SUPPRESSES the signal when the per-PID start-identity"
echo "       CHANGES between its two production reads (st1 != st2) — a recycled PID is never mis-killed. =="
# A real owned proc (OIS_SEAT_ID=target) so pgrep enumerates it + the REAL ownership check matches.
OIS_SEAT_ID="$TID" setsid bash -c "echo \$\$ > '$TDIR/PR'; exec -a seat-reuse sleep 30" >/dev/null 2>&1 &
disown 2>/dev/null || true
for i in $(seq 1 20); do [[ -s "$TDIR/PR" ]] && break; sleep 0.1; done
PR=$(cat "$TDIR/PR" 2>/dev/null); PIDS+=("$PR")
# Negative: a FILE-backed counter forces the two production _seat_pid_starttime reads to DIFFER (an
# in-memory counter would reset inside each $() call → st1==st2, passing for the WRONG reason). The
# kill-spy logs the intended signal and sends nothing; the REAL st1==st2 gate must skip the target.
if ( CNT="$TDIR/stcnt"; KLOG="$TDIR/klog8"; echo 0 > "$CNT"; : > "$KLOG"; sf=0
     _seat_pid_starttime() { local n; n=$(cat "$CNT" 2>/dev/null); echo $((n+1)) > "$CNT"; [[ "$1" == "$PR" ]] && echo "$n" || echo 7; }
     kill() { echo "$*" >> "$KLOG"; }
     _reap_seat_signal "$TID" TERM
     if grep -qw "$PR" "$KLOG"; then echo "  FAIL: PID $PR signalled despite st1 != st2 (guard not enforced)"; sf=1
     else echo "  ok: signal SUPPRESSED on changed start-identity (kill-spy empty for target)"; fi
     exit $sf ); then :; else fail=1; fi
# POSITIVE CONTROL: with a STABLE start-identity the SAME real reap DOES signal the target — proving the
# suppression above is the st1==st2 gate, not a reap that never fires. (Delete the gate in ois/bin/ois →
# the negative case above signals → RED, while this control stays green.)
if ( KLOG="$TDIR/klog8c"; : > "$KLOG"; sf=0
     _seat_pid_starttime() { echo 42; }
     kill() { echo "$*" >> "$KLOG"; }
     _reap_seat_signal "$TID" TERM
     if grep -qw "$PR" "$KLOG"; then echo "  ok: positive control — stable start-identity DOES signal the target"
     else echo "  FAIL: positive control — matching+stable target not signalled (reap a no-op?)"; sf=1; fi
     exit $sf ); then :; else fail=1; fi

echo "== (9) UNREADABLE-ENVIRON candidate is NOT signalled (fail-closed): an enumerated PID whose"
echo "       environ read returns EMPTY is skipped, while a readable matching sibling IS reaped. =="
OIS_SEAT_ID="$TID" setsid bash -c "echo \$\$ > '$TDIR/PU'; exec -a seat-unread sleep 30" >/dev/null 2>&1 &
disown 2>/dev/null || true
OIS_SEAT_ID="$TID" setsid bash -c "echo \$\$ > '$TDIR/PC'; exec -a seat-ctl sleep 30" >/dev/null 2>&1 &
disown 2>/dev/null || true
for i in $(seq 1 20); do [[ -s "$TDIR/PU" && -s "$TDIR/PC" ]] && break; sleep 0.1; done
PU=$(cat "$TDIR/PU" 2>/dev/null); PC=$(cat "$TDIR/PC" 2>/dev/null); PIDS+=("$PU" "$PC")
# Stub ONLY the proc-read boundary (_seat_id_of_pid): return "" for the UNREADABLE target (simulated),
# the REAL read for every other pid. The REAL _reap_seat_signal ownership comparison ("" != seat_id)
# must SKIP the unreadable one (fail-closed); the readable matching sibling IS signalled (positive control).
if ( KLOG="$TDIR/klog9"; : > "$KLOG"; sf=0
     _seat_id_of_pid() { if [[ "$1" == "$PU" ]]; then echo ""; else cat "/proc/$1/environ" 2>/dev/null | tr '\0' '\n' | grep -m1 '^OIS_SEAT_ID=' | cut -d= -f2-; fi; }
     kill() { echo "$*" >> "$KLOG"; }
     _reap_seat_signal "$TID" TERM
     if grep -qw "$PU" "$KLOG"; then echo "  FAIL: unreadable-environ PID $PU was signalled (NOT fail-closed)"; sf=1
     else echo "  ok: unreadable candidate $PU NOT signalled (fail-closed)"; fi
     if grep -qw "$PC" "$KLOG"; then echo "  ok: positive control — readable matching sibling $PC IS signalled"
     else echo "  FAIL: positive control — matching readable sibling not signalled (reap a no-op?)"; sf=1; fi
     exit $sf ); then :; else fail=1; fi

echo "== (10) spawn isolation — POSTCONDITION ONLY (NOT setsid causality): a seat launched via"
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

echo "== (11) bug-363 PEER-SPAWN IDENTITY LEAK: a seat brought up from INSIDE another seat's pane must"
echo "        NOT leave its tmux SERVER carrying the SPAWNER's OIS_SEAT_ID, and a reap of the spawner"
echo "        must NOT signal that foreign server. =="
# THE REGRESSION FOR bug-363. #641 re-keys the seat's canonical id inside do_launch — INSIDE the new
# session — but the tmux server is forked BEFORE that, from the caller's env. So peer-spawning left
# the server carrying the SPAWNER's id, and the exact-id reap (no argv inclusion filter, by design)
# would signal it while tearing down the SPAWNER — destroying a co-resident seat. Measured live
# 2026-07-25: one seat's reap set contained two other seats' tmux servers.
#
# MUTATION-PROOF: this drives the REAL _seat_new_session (the fix site) and the REAL
# _reap_seat_signal / _seat_id_of_pid. Delete `-u OIS_SEAT_ID` from _seat_new_session and BOTH
# assertions below go RED — the server inherits the spawner's id and the reap selects it.
if command -v tmux >/dev/null 2>&1; then
  T12="ois-reaptest$$-peer"   # pid-unique + ois-* prefixed; can never collide with a live seat
  # Peer-spawn EXACTLY as `ois up <peer>` from inside a live seat's pane does: the caller's
  # environment carries the SPAWNER's canonical id at the moment tmux is forked.
  ( export OIS_SEAT_ID="$TID"; _seat_new_session "$T12" "sleep 30" ) >/dev/null 2>&1
  sleep 0.5
  SRV=$(tmux -L "$T12" display-message -p '#{pid}' 2>/dev/null)
  if [[ "$SRV" =~ ^[0-9]+$ ]]; then
    PIDS+=("$SRV")
    # (a) IDENTITY — the forked server must not carry the spawner's id at all.
    srvid=$(_seat_id_of_pid "$SRV")
    if [[ "$srvid" == "$TID" ]]; then
      echo "  FAIL: peer-spawned tmux server $SRV INHERITED the spawner's OIS_SEAT_ID ($TID)"; fail=1
    else
      echo "  ok: peer-spawned tmux server $SRV carries no spawner id (got '${srvid:-<none>}')"
    fi
    # (b) REAP SCOPE — the safety property itself, via the REAL selector with a kill-spy so nothing
    #     is actually signalled. A staged proc genuinely owned by the spawner is the positive
    #     control: it MUST be signalled, proving the reap fires rather than being a silent no-op.
    OIS_SEAT_ID="$TID" setsid bash -c "echo \$\$ > '$TDIR/PS'; exec -a seat-spawner-own sleep 30" >/dev/null 2>&1 &
    disown 2>/dev/null || true
    for i in $(seq 1 20); do [[ -s "$TDIR/PS" ]] && break; sleep 0.1; done
    PS=$(cat "$TDIR/PS" 2>/dev/null); PIDS+=("$PS")
    if ( KLOG="$TDIR/klog11"; : > "$KLOG"; sf=0
         kill() { echo "$*" >> "$KLOG"; }
         _reap_seat_signal "$TID" TERM
         if grep -qw "$SRV" "$KLOG"; then echo "  FAIL: reap of $TID SIGNALLED foreign tmux server $SRV (cross-seat blast)"; sf=1
         else echo "  ok: reap of $TID did NOT signal foreign tmux server $SRV"; fi
         if grep -qw "$PS" "$KLOG"; then echo "  ok: positive control — the spawner's OWN proc $PS IS signalled"
         else echo "  FAIL: positive control — spawner's own proc not signalled (reap a no-op?)"; sf=1; fi
         exit $sf ); then :; else fail=1; fi
  else
    echo "  FAIL: could not read peer tmux server pid (got '$SRV')"; fail=1
  fi
  tmux -L "$T12" kill-server 2>/dev/null   # throwaway -L socket only; NEVER the shared/default server
else
  echo "  SKIP: tmux not available — peer-spawn identity assertion needs a real tmux"
fi

echo "== (12) bug-363 DEFENCE-IN-DEPTH: a proc that carries the TARGET's id but whose argv POSITIVELY"
echo "        names ANOTHER seat's -L socket is provably foreign infrastructure and is NOT signalled. =="
# Pins the _seat_pid_foreign_socket exclusion on its OWN. Test (11) alone does not: with the
# `env -u OIS_SEAT_ID` root fix in place the exclusion is redundant there, so deleting the exclusion
# leaves (11) green — and a guard whose deletion turns nothing red is NOT ENFORCED (the bug-303 law).
# This case reintroduces the leak DIRECTLY in the fixture: id matches, argv names a foreign socket.
# Delete the `_seat_pid_foreign_socket … && continue` line in ois/bin/ois -> this goes RED.
FS_SOCK="ois-reaptest$$-foreignsock"
# NOTE: deliberately NO `exec` — exec would REPLACE the process image and DISCARD the `-L …` argv
# this case exists to detect, so the fixture would carry the target id with a bare `sleep` cmdline
# and pass for entirely the wrong reason. The bash proc keeps its own argv and sleeps as a child.
OIS_SEAT_ID="$TID" setsid bash -c 'echo $$ > "'"$TDIR"'/FS"; sleep 30' \
  fake-tmux -L "$FS_SOCK" new-session >/dev/null 2>&1 &
disown 2>/dev/null || true
for i in $(seq 1 20); do [[ -s "$TDIR/FS" ]] && break; sleep 0.1; done
FS=$(cat "$TDIR/FS" 2>/dev/null); PIDS+=("$FS")
if [[ "$FS" =~ ^[0-9]+$ ]]; then
  # fixture sanity: it really does carry the TARGET id AND its argv really does name a foreign
  # socket. Both must hold or the case proves nothing.
  [[ "$(_seat_id_of_pid "$FS")" == "$TID" ]] \
    && echo "  ok: fixture carries the target id (so only the exclusion can spare it)" \
    || { echo "  FAIL: fixture does not carry the target id — test would pass for the wrong reason"; fail=1; }
  if tr '\0' ' ' < "/proc/$FS/cmdline" 2>/dev/null | grep -q -- "-L $FS_SOCK"; then
    echo "  ok: fixture argv names the foreign socket $FS_SOCK"
  else
    echo "  FAIL: fixture argv does NOT contain '-L $FS_SOCK' (got: $(tr '\0' ' ' < /proc/$FS/cmdline 2>/dev/null | cut -c1-90)) — exclusion would be untested"; fail=1
  fi
  if ( KLOG="$TDIR/klog12"; : > "$KLOG"; sf=0
       kill() { echo "$*" >> "$KLOG"; }
       _reap_seat_signal "$TID" TERM
       if grep -qw "$FS" "$KLOG"; then echo "  FAIL: foreign-socket proc $FS was signalled (exclusion not enforced)"; sf=1
       else echo "  ok: foreign-socket proc $FS NOT signalled (exclusion enforced)"; fi
       exit $sf ); then :; else fail=1; fi
else
  echo "  FAIL: could not stage the foreign-socket fixture (got '$FS')"; fail=1
fi

echo
if [[ $fail -eq 0 ]]; then
  echo "PASS: reap is blast-safe — exact-OIS_SEAT_ID per-PID reap, no group signal; foreign/cross-harness/legacy/cdir-less siblings survive; id-retaining stragglers + trees reaped to quiescence; zero cross-seat blast radius"
  exit 0
else
  echo "FAIL: reap scope violation"
  exit 1
fi
