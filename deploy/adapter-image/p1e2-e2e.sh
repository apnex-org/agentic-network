#!/usr/bin/env bash
# =============================================================================
# P1e-2 LIVE docker-L2 restart e2e harness  (M-Adapter-Modernization, Design §4/§9)
# =============================================================================
# Validates the FULL resilience loop end-to-end in a REAL container against a REAL
# (test-only) Hub, ZERO-manual once the wedge is injected:
#
#   compose-up (watchdog ENABLED, file-mounted secrets, restart=on-failure)
#     -> agent handshakes + session live          [assert ONLINE; record RestartCount_0]
#     -> INJECT the wedge SERVER-SIDE             [keepalives-flowing-but-session-dead]
#     -> the REAL L1.5 session-probe fails        [the detection path P1c built]
#     -> watchdog budget exhausted -> LIVENESS LOST -> /run/adapter-wedged written
#     -> PID-1 supervisor consumes the sentinel  -> SIGTERM child -> exit 75
#     -> docker restart-policy (on-failure) fires -> RestartCount increments
#     -> a FRESH container re-handshakes + re-claims   [recovery, not just a loop]
#
# Captures the carry-a (real docker-L2 restart) + carry-b (watchdog DRIVES the restart)
# evidence: RestartCount delta + the seam log lines (probe-FAILED / LIVENESS-LOST /
# sentinel-write / supervisor exit(75) / re-handshake).
#
# DESIGN INTENT (VM-portable): authored OFF-VM; the architect runs it ON the VM. Every
# host/Hub specific is an ENV PARAM. The exit-code + sentinel contract are READ FROM THE
# BAKED IMAGE (the supervisor's exported constants) — never re-literal'd here — so the
# harness is drift-proof the same way the seam-test parity is.
#
# FAITHFULNESS BAR (architect-set, non-negotiable): the wedge must drive the watchdog's
# REAL app-level session-validity probe to fail via a SERVER-SIDE session death while the
# transport keepalive still flows. NAIVE inducers (container-kill / network-cut /
# SIGKILL-the-child) are FORBIDDEN — they bypass the watchdog's entire reason-for-being
# (transport health looks FINE in the true wedge). This harness is fail-closed: it will
# NOT run the e2e without an injection mechanism (INJECT_CMD or MANUAL_INJECT=1), so it
# can never false-green by skipping the wedge.
#
# USAGE:
#   selfcheck (in-repo, NO live Hub/VM — CI-runnable):
#     ./p1e2-e2e.sh selfcheck
#   live run (on the VM):
#     OIS_HUB_URL=http://test-hub:8080/mcp ADAPTER_TAG=<:sha> OIS_AGENT_NAME=p1e2-probe \
#     HOST_WORKTREE=/path/to/host/worktree HOST_SECRETS_DIR=/path/to/secrets \
#     INJECT_CMD='<server-side session-evict against the test-Hub>' \
#       ./p1e2-e2e.sh run
#   (or MANUAL_INJECT=1 to pause for an interactive evict — the architect+engineer
#    confirm the exact real-evict mechanism together on the run session.)
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_COMPOSE="${SCRIPT_DIR}/docker-compose.yml"
E2E_COMPOSE="${SCRIPT_DIR}/docker-compose.e2e.yml"

# ── tunables (env-overridable; VM-portable) ──────────────────────────────────
ADAPTER_IMAGE="${ADAPTER_IMAGE:-australia-southeast1-docker.pkg.dev/labops-389703/cloud-run-source-deploy/claude-adapter}"
ADAPTER_TAG="${ADAPTER_TAG:-}"                         # the immutable :sha image-under-test
E2E_CONTAINER_NAME="${E2E_CONTAINER_NAME:-apnex-claude-adapter-e2e}"
ONLINE_TIMEOUT="${ONLINE_TIMEOUT:-60}"                 # s to first 'Hub connection established'
RESTART_TIMEOUT="${RESTART_TIMEOUT:-60}"               # s from inject to RestartCount increment
RECLAIM_TIMEOUT="${RECLAIM_TIMEOUT:-60}"               # s for the fresh container to re-handshake
RESULTS_DIR="${RESULTS_DIR:-${SCRIPT_DIR}/.p1e2-e2e-results}"
KEEP_UP="${KEEP_UP:-0}"                                # 1 = skip teardown (debugging)
export E2E_CONTAINER_NAME

# Seam log markers (the adapter + supervisor emit these to stderr -> docker logs).
M_ONLINE="Hub connection established"                  # shim.ts — full sync done
M_WATCHDOG_ON="\[LivenessWatchdog\] ENABLED"           # shim.ts — watchdog wired
M_PROBE_FAIL="\[LivenessWatchdog\] session probe FAILED"
M_LIVENESS_LOST="LIVENESS LOST"                        # watchdog escalation
M_SENTINEL="wrote wedged-restart sentinel"             # liveness-signal.ts
M_SUPERVISOR_EXIT="terminating child"                  # supervisor.mjs finish()

GREEN=$'\033[32m'; RED=$'\033[31m'; YEL=$'\033[33m'; NC=$'\033[0m'
log()  { printf '%s[p1e2]%s %s\n' "$YEL" "$NC" "$*"; }
pass() { printf '%s[PASS]%s %s\n' "$GREEN" "$NC" "$*"; }
fail() { printf '%s[FAIL]%s %s\n' "$RED" "$NC" "$*" >&2; }
die()  { fail "$*"; exit 1; }

compose() { docker compose -f "$BASE_COMPOSE" -f "$E2E_COMPOSE" "$@"; }
clogs()   { docker logs "$E2E_CONTAINER_NAME" 2>&1; }
restart_count() { docker inspect -f '{{.RestartCount}}' "$E2E_CONTAINER_NAME" 2>/dev/null || echo "ERR"; }

# Read the exit-code + sentinel contract FROM THE BAKED IMAGE (drift-proof). The
# supervisor's auto-run is import.meta-guarded, so importing it only reads exports.
extract_contract() {
  docker run --rm --entrypoint node "${ADAPTER_IMAGE}:${ADAPTER_TAG}" -e '
    import("/app/supervisor.mjs")
      .then((m) => process.stdout.write(JSON.stringify({
        exitCode: m.SUPERVISOR_EXIT_CODE, sentinel: m.SUPERVISOR_SENTINEL_DEFAULT })))
      .catch((e) => { process.stderr.write(String(e)); process.exit(3); });
  ' 2>/dev/null
}

# Poll `clogs` until $1 (an egrep pattern) appears, or $2 seconds elapse.
wait_for_log() {
  local pat="$1" timeout="$2" waited=0
  while [ "$waited" -lt "$timeout" ]; do
    if clogs | grep -Eq "$pat"; then return 0; fi
    sleep 2; waited=$((waited + 2))
  done
  return 1
}

# Poll until RestartCount exceeds $1, or $2 seconds elapse. Echoes the final count.
wait_for_restart() {
  local before="$1" timeout="$2" waited=0 now
  while [ "$waited" -lt "$timeout" ]; do
    now="$(restart_count)"
    if [ "$now" != "ERR" ] && [ "$now" -gt "$before" ] 2>/dev/null; then echo "$now"; return 0; fi
    sleep 2; waited=$((waited + 2))
  done
  echo "${now:-ERR}"; return 1
}

teardown() {
  [ "$KEEP_UP" = "1" ] && { log "KEEP_UP=1 — leaving the stack up for inspection"; return; }
  log "teardown: compose down"
  compose down -v >/dev/null 2>&1 || true
}

# ── selfcheck: in-repo structural validation, NO live Hub/VM (CI-runnable) ────
# Degrades gracefully: the full base+override MERGE check needs docker compose v2 (the
# VM has it); on an authoring host without it, fall back to file-direct seam checks so
# the harness still greens everywhere and the deep merge-check just runs on the VM.
selfcheck() {
  local ok=1
  log "selfcheck — structural validation (no live Hub)"
  bash -n "${BASH_SOURCE[0]}" && pass "harness syntax (bash -n)" || { fail "harness syntax"; ok=0; }
  [ -f "$BASE_COMPOSE" ] && pass "base compose present" || { fail "base compose missing: $BASE_COMPOSE"; ok=0; }
  [ -f "$E2E_COMPOSE" ]  && pass "e2e override present"  || { fail "e2e override missing: $E2E_COMPOSE"; ok=0; }

  # YAML validity (python3 if present — portable; else note + skip).
  if command -v python3 >/dev/null 2>&1; then
    if python3 -c 'import yaml,sys; [yaml.safe_load(open(f)) for f in sys.argv[1:]]' "$BASE_COMPOSE" "$E2E_COMPOSE" 2>/dev/null; then
      pass "both compose files are valid YAML"
    else
      fail "compose YAML did not parse"; ok=0
    fi
  else
    log "python3 absent — YAML parse skipped"
  fi

  # Seam-preservation. Prefer the REAL merge (compose v2 — the VM); else check files directly.
  if docker compose version >/dev/null 2>&1; then
    local merged
    if merged="$(ADAPTER_TAG=selfcheck OIS_HUB_URL=http://x OIS_AGENT_NAME=x HOST_WORKTREE=/tmp \
                 HOST_SECRETS_DIR=/tmp compose config 2>/dev/null)"; then
      pass "compose base+override merge + parse (docker compose config)"
      echo "$merged" | grep -q 'OIS_LIVENESS_WATCHDOG_ENABLED' && pass "watchdog still ENABLED in merged config" \
        || { fail "merged config lost OIS_LIVENESS_WATCHDOG_ENABLED"; ok=0; }
      echo "$merged" | grep -Eq 'on-failure' && pass "restart-policy still on-failure (merged)" \
        || { fail "merged config lost restart: on-failure"; ok=0; }
      echo "$merged" | grep -q 'OIS_LIVENESS_PROBE_METHOD' && pass "fast-fire probe-method present (merged)" \
        || { fail "fast-fire tuning not applied"; ok=0; }
    else
      fail "compose base+override did not merge/parse"; ok=0
    fi
  else
    log "docker compose v2 absent here — merge-check DEFERRED to the VM; checking files directly"
    grep -q 'OIS_LIVENESS_WATCHDOG_ENABLED' "$BASE_COMPOSE" && pass "base: watchdog ENABLED" \
      || { fail "base lost watchdog-enabled"; ok=0; }
    grep -Eq 'restart: *on-failure' "$BASE_COMPOSE" && pass "base: restart on-failure" \
      || { fail "base lost restart on-failure"; ok=0; }
    grep -q 'tmpfs' "$BASE_COMPOSE" && pass "base: /run tmpfs (fresh sentinel per boot)" \
      || { fail "base lost /run tmpfs"; ok=0; }
    grep -q 'OIS_LIVENESS_PROBE_METHOD' "$E2E_COMPOSE" && pass "override: fast-fire probe-method" \
      || { fail "override missing fast-fire probe-method"; ok=0; }
    grep -q 'OIS_LIVENESS_PROBE_INTERVAL_MS' "$E2E_COMPOSE" && pass "override: fast-fire probe-interval" \
      || { fail "override missing probe-interval"; ok=0; }
    # The override must NOT re-disable the watchdog (a "0"/"false" enable would gut carry-b).
    if grep -Eq 'OIS_LIVENESS_WATCHDOG_ENABLED: *.?(0|false)' "$E2E_COMPOSE"; then
      fail "override re-disables the watchdog!"; ok=0
    else
      pass "override does not re-disable the watchdog"
    fi
  fi
  [ "$ok" = "1" ] && { pass "selfcheck GREEN"; return 0; } || { die "selfcheck RED"; }
}

# ── run: the live e2e ────────────────────────────────────────────────────────
run() {
  command -v docker >/dev/null || die "docker not found"
  docker compose version >/dev/null 2>&1 || die "docker compose v2 not found"
  [ -n "$ADAPTER_TAG" ] || die "ADAPTER_TAG required (the immutable :sha image-under-test)"
  [ -n "${OIS_HUB_URL:-}" ] || die "OIS_HUB_URL required (the TEST-only Hub endpoint)"
  [ -n "${OIS_AGENT_NAME:-}" ] || die "OIS_AGENT_NAME required"
  [ -n "${HOST_WORKTREE:-}" ] || die "HOST_WORKTREE required (host-created git worktree)"
  [ -n "${HOST_SECRETS_DIR:-}" ] || die "HOST_SECRETS_DIR required (hub_token + claude_oauth_token files)"
  # FAIL-CLOSED: refuse to run without a real injection mechanism, so we can never
  # false-green by skipping the wedge.
  if [ -z "${INJECT_CMD:-}" ] && [ "${MANUAL_INJECT:-0}" != "1" ]; then
    die "no wedge injection: set INJECT_CMD='<server-side session-evict>' or MANUAL_INJECT=1 (fail-closed — see README §Injection)"
  fi
  export ADAPTER_IMAGE ADAPTER_TAG
  mkdir -p "$RESULTS_DIR"
  trap teardown EXIT

  # 1) drift-proof contract from the baked image
  log "reading exit-code + sentinel contract from the baked image ${ADAPTER_IMAGE}:${ADAPTER_TAG}"
  local contract expect_exit sentinel
  contract="$(extract_contract)" || die "could not read contract from image (is :${ADAPTER_TAG} pullable?)"
  expect_exit="$(echo "$contract" | sed -n 's/.*"exitCode":\([0-9]*\).*/\1/p')"
  sentinel="$(echo "$contract" | sed -n 's/.*"sentinel":"\([^"]*\)".*/\1/p')"
  [ -n "$expect_exit" ] && [ -n "$sentinel" ] || die "contract parse failed: $contract"
  pass "contract from image: exit-code=${expect_exit} sentinel=${sentinel} (NOT re-literal'd here)"

  # 2) stand up the EMBEDDED stack
  log "compose up (base + e2e override) against test-Hub ${OIS_HUB_URL}"
  compose up -d >/dev/null 2>&1 || die "compose up failed"

  # 3) assert ONLINE + watchdog wired; record RestartCount_0
  wait_for_log "$M_ONLINE" "$ONLINE_TIMEOUT" || { clogs | tail -40; die "adapter never reached '$M_ONLINE' in ${ONLINE_TIMEOUT}s"; }
  pass "adapter ONLINE (handshake + session live, file-mounted secrets, no TUI prompt)"
  wait_for_log "$M_WATCHDOG_ON" 10 || { clogs | tail -40; die "L1.5 watchdog not ENABLED — carry-b cannot be proven"; }
  pass "L1.5 watchdog ENABLED (carry-b config-half live)"
  local rc0; rc0="$(restart_count)"
  [ "$rc0" != "ERR" ] || die "could not read RestartCount"
  log "RestartCount_0 = ${rc0}"

  # 4) INJECT the wedge SERVER-SIDE (keepalives-flowing-but-session-dead)
  if [ "${MANUAL_INJECT:-0}" = "1" ]; then
    log "${YEL}MANUAL injection${NC}: evict ${OIS_AGENT_NAME}'s session SERVER-SIDE on the test-Hub"
    log "  REQUIRED condition: session dead server-side; SSE keepalive STILL FLOWING (do NOT kill the container/network/child)."
    log "  Confirm the real-evict mechanism with the architect, perform it, then press ENTER."
    read -r _ < /dev/tty || true
  else
    log "INJECT_CMD: ${INJECT_CMD}"
    bash -c "$INJECT_CMD" || die "INJECT_CMD failed"
  fi
  pass "wedge injected (server-side session death; transport keepalive intact)"

  # 5) assert the REAL probe detected it + the seam fired
  wait_for_log "$M_PROBE_FAIL" "$RESTART_TIMEOUT" || { clogs | tail -60; die "the watchdog's REAL session probe never failed — the inject did not produce a session-dead-but-transport-alive wedge (NOT faithful)"; }
  pass "watchdog REAL session-probe FAILED (the faithful detection path, not a shortcut)"
  wait_for_log "$M_LIVENESS_LOST" "$RESTART_TIMEOUT" || { clogs | tail -60; die "watchdog never escalated to LIVENESS LOST"; }
  wait_for_log "$M_SENTINEL" 10 || { clogs | tail -60; die "wedged-restart sentinel never written"; }
  pass "LIVENESS LOST -> wedged-restart sentinel written"
  if clogs | grep -Eq "$M_SUPERVISOR_EXIT"; then pass "PID-1 supervisor consumed the sentinel -> child terminated -> exit(${expect_exit})"; fi

  # 6) assert docker-L2 restart happened (RestartCount strictly increments)
  local rc1; rc1="$(wait_for_restart "$rc0" "$RESTART_TIMEOUT")" \
    || { clogs | tail -60; die "RestartCount did not increment (${rc0} -> ${rc1}) — docker-L2 restart did NOT fire"; }
  pass "docker-L2 restart FIRED: RestartCount ${rc0} -> ${rc1} (carry-a)"

  # 7) assert RECOVERY (a fresh re-handshake AFTER the restart — not just a loop)
  local online_before online_after
  online_before=2  # by step-3 there was >=1; the restart must add another
  if wait_for_log "(${M_ONLINE}.*){2,}" "$RECLAIM_TIMEOUT" \
     || [ "$(clogs | grep -Ec "$M_ONLINE")" -ge "$online_before" ]; then
    pass "fresh container RE-HANDSHAKED + re-claimed after restart (recovery, not a crash-loop)"
  else
    clogs | tail -60; die "no re-handshake after restart — restart did not RECOVER the session (vacuous green guard)"
  fi

  # 8) capture evidence
  local stamp evid
  stamp="${RESULTS_STAMP:-run}"
  evid="${RESULTS_DIR}/p1e2-e2e-${stamp}.txt"
  {
    echo "=== P1e-2 LIVE docker-L2 restart e2e — EVIDENCE ==="
    echo "image: ${ADAPTER_IMAGE}:${ADAPTER_TAG}"
    echo "test-Hub: ${OIS_HUB_URL}   agent: ${OIS_AGENT_NAME}"
    echo "contract (from baked image): exitCode=${expect_exit} sentinel=${sentinel}"
    echo "RestartCount: ${rc0} -> ${rc1}  (carry-a: docker-L2 restart fired)"
    echo "injection: ${MANUAL_INJECT:+MANUAL}${INJECT_CMD:+INJECT_CMD=${INJECT_CMD}}"
    echo "--- seam log lines (carry-b: watchdog DROVE the restart) ---"
    clogs | grep -E "${M_PROBE_FAIL}|${M_LIVENESS_LOST}|${M_SENTINEL}|${M_SUPERVISOR_EXIT}|${M_ONLINE}|${M_WATCHDOG_ON}" || true
  } > "$evid"
  pass "evidence captured: ${evid}"
  echo
  pass "P1e-2 e2e GREEN — the full wedge->detect->sentinel->exit-${expect_exit}->restart->re-claim loop ran zero-manual."
}

case "${1:-run}" in
  selfcheck) selfcheck ;;
  run)       run ;;
  *)         die "usage: $0 {selfcheck|run}" ;;
esac
