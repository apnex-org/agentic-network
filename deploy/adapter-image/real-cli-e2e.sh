#!/usr/bin/env bash
# =============================================================================
# M-Real-CLI-Harness n5 — full container integration + 3-level sentinel e2e
# =============================================================================
# The REAL claude-code CLI as an unattended engineer, in a bounded container, ZERO-human:
#
#   compose-up (supervisor -> real claude under tmux [plugin path] -> shim GRANDCHILD;
#               L1.5 watchdog ON, n2 bounded sandbox, /run tmpfs 1777, restart=on-failure)
#     PHASE 1 (behavioral — the relocated ev_engineer_ready):
#       -> claude boots dialog-free + handshakes (register_role engineer)   [assert get_agents]
#       -> the idea-353 self-wake digest is injected via <channel>          [UNPRIMED-FIRST finding]
#       -> the CLI claim->start->complete + renew_lease on the SEEDED item, ZERO-human
#       -> CAPTURE the <channel> render + PERSIST acting-confirm evidence TO /work  [BEFORE the wedge]
#     PHASE 2 (chaos — ev_container_e2e, P1e-2 parity w/ the REAL CLI in the middle):
#       -> INJECT the SILENT wedge SERVER-SIDE (POST /wedge -> evict sessions, keepalives flow)
#       -> the REAL L1.5 session-probe fails -> watchdog budget exhausted -> /run/adapter-wedged
#       -> PID-1 supervisor consumes the sentinel -> SIGTERM child -> exit 75
#       -> docker restart-policy fires (RestartCount++) -> FRESH container re-handshakes + re-claims
#     PHASE 3 (clean stop): SIGTERM -> supervisor quiesces the CLI + grandchild -> exit 0 (no loop)
#
# VM-PORTABLE: authored off-VM; runs ON the VM (working docker). Every host/Hub-specific is an
# ENV PARAM. The exit-code + sentinel contract are READ FROM THE BAKED IMAGE (supervisor exports),
# never re-literal'd. FAIL-CLOSED: refuses to run the chaos without a real wedge mechanism.
#
# FAITHFULNESS BAR (architect): the wedge is a SERVER-SIDE session death while transport keepalive
# flows (NAIVE container-kill / network-cut / SIGKILL are FORBIDDEN — they bypass the watchdog's
# reason-for-being). PERSIST-BEFORE-WEDGE (architect guardrail): the L2 restart wipes in-container
# ephemeral (tmux scrollback, /run/*), so Phase 1 captures + persists to the HOST /work mount first.
#
# USAGE:
#   selfcheck (in-repo, NO VM/Hub — sanity of the harness itself):
#     ./real-cli-e2e.sh selfcheck
#   live run (on the VM):
#     ADAPTER_TAG=n5-<sha> HOST_WORKTREE=/path/work HOST_CLAUDE_CONFIG_DIR=/path/claude-cfg \
#     TEST_HUB_BUNDLE=/path/real-cli-n4-test-hub.mjs \
#       ./real-cli-e2e.sh run
# =============================================================================
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
MODE="${1:-run}"

# ── tunables (env-overridable; VM-portable) ──────────────────────────────────
IMAGE="${ADAPTER_IMAGE:-australia-southeast1-docker.pkg.dev/labops-389703/cloud-run-source-deploy/claude-adapter-realcli}"
ADAPTER_TAG="${ADAPTER_TAG:-}"
NET="${REAL_CLI_NET:-real-cli-net}"
TEST_HUB_NAME="${TEST_HUB_NAME:-real-cli-test-hub}"
TEST_HUB_BUNDLE="${TEST_HUB_BUNDLE:-$HERE/real-cli-n4-test-hub.mjs}"
TEST_HUB_NODE_IMAGE="${TEST_HUB_NODE_IMAGE:-node:22-bookworm-slim}"
CONTROL_PORT="${CONTROL_PORT:-8090}"            # test-Hub control (/health,/workitem,/wedge) -> host
E2E_CONTAINER_NAME="${E2E_CONTAINER_NAME:-apnex-real-cli-e2e}"
HOST_WORKTREE="${HOST_WORKTREE:-}"
HOST_CLAUDE_CONFIG_DIR="${HOST_CLAUDE_CONFIG_DIR:-}"
BASE_COMPOSE="${BASE_COMPOSE:-$HERE/docker-compose.real-cli.yml}"
BEHAVIOR_TIMEOUT_S="${BEHAVIOR_TIMEOUT_S:-300}"  # cold boot + handshake + self-wake + claim->complete
RECOVERY_TIMEOUT_S="${RECOVERY_TIMEOUT_S:-120}"  # wedge -> sentinel -> exit75 -> L2 restart -> re-claim
WEDGE_TTL_MS="${WEDGE_TTL_MS:-12000}"

GREEN=$'\033[32m'; RED=$'\033[31m'; YEL=$'\033[33m'; NC=$'\033[0m'
log()  { printf '%s[n5-e2e]%s %s\n' "$YEL" "$NC" "$*"; }
pass() { printf '%s[PASS]%s %s\n' "$GREEN" "$NC" "$*"; }
fail() { printf '%s[FAIL]%s %s\n' "$RED" "$NC" "$*" >&2; }
die()  { fail "$*"; exit 1; }
nap()  { python3 -c "import time,sys; time.sleep(float(sys.argv[1]))" "$1" 2>/dev/null || sleep "${1%.*}"; }

ctl()           { curl -s --max-time 5 "http://127.0.0.1:${CONTROL_PORT}$1"; }
ctl_post()      { curl -s --max-time 5 -X POST "http://127.0.0.1:${CONTROL_PORT}$1"; }
workitem_status(){ ctl /workitem | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','?'))" 2>/dev/null || echo "?"; }
clogs()         { docker logs "$E2E_CONTAINER_NAME" 2>&1; }
restart_count() { docker inspect -f '{{.RestartCount}}' "$E2E_CONTAINER_NAME" 2>/dev/null || echo "ERR"; }
exited_code()   { docker inspect -f '{{.State.ExitCode}}' "$E2E_CONTAINER_NAME" 2>/dev/null || echo "ERR"; }

# Build-provenance guard (the stale-base lesson): the image-under-test MUST contain the REAL CLI +
# the launcher + the in-repo marketplace — else the whole e2e is vacuous. (Verified at build by
# cloudbuild.verify-realcli.yaml; re-asserted here against the actual run image.)
assert_realcli_in_image() {
  local img="$IMAGE:$ADAPTER_TAG"
  log "build-provenance: asserting real CLI + launcher + marketplace in $img"
  docker run --rm --entrypoint bash "$img" -c '
    set -e
    claude --version >/dev/null
    test -x /app/real-cli-launch.sh
    test -f /app/adapters/claude-plugin/.claude-plugin/marketplace.json
    test -f /app/adapters/claude-plugin/dist/shim.js
    grep -q "agentic-network" /home/appuser/.claude/plugins/known_marketplaces.json
  ' || die "image $img missing real-CLI/launcher/marketplace — STALE/wrong image (vacuous e2e averted)"
  pass "build-provenance: real CLI + launcher + in-repo marketplace present in the run image"
}

# ── selfcheck: validate the harness itself, no VM/Hub ────────────────────────
selfcheck() {
  log "selfcheck — harness sanity (no live VM/Hub)"
  [ -f "$BASE_COMPOSE" ] || die "compose missing: $BASE_COMPOSE"
  command -v python3 >/dev/null || die "python3 required"
  grep -q "/wedge" "$HERE/real-cli-n4-test-hub.mts" 2>/dev/null \
    && pass "test-Hub entrypoint declares /wedge (chaos inducer present)" \
    || log  "note: run TEST_HUB_BUNDLE must be built from an entrypoint with /wedge"
  grep -q "real-cli-launch.sh" "$BASE_COMPOSE" && pass "compose CMD -> the real-CLI launcher"
  pass "selfcheck OK — provide ADAPTER_TAG + HOST_WORKTREE + HOST_CLAUDE_CONFIG_DIR + TEST_HUB_BUNDLE, then 'run' on the VM"
}

teardown() {
  log "teardown"
  docker compose -f "$BASE_COMPOSE" down --remove-orphans 2>/dev/null || true
  docker rm -f "$TEST_HUB_NAME" 2>/dev/null || true
  docker network rm "$NET" 2>/dev/null || true
}

run() {
  [ -n "$ADAPTER_TAG" ] || die "ADAPTER_TAG required (the n5 image tag, e.g. n5-bad98e5)"
  [ -n "$HOST_WORKTREE" ] || die "HOST_WORKTREE required (the /work host mount)"
  [ -n "$HOST_CLAUDE_CONFIG_DIR" ] || die "HOST_CLAUDE_CONFIG_DIR required (preseed + marketplace + .credentials.json)"
  [ -f "$TEST_HUB_BUNDLE" ] || die "TEST_HUB_BUNDLE missing: $TEST_HUB_BUNDLE (build via build-real-cli-test-hub.sh + deliver)"
  command -v docker >/dev/null || die "docker required (run ON the VM)"
  trap teardown EXIT

  assert_realcli_in_image

  # ── PHASE 0: setup ─────────────────────────────────────────────────────────
  log "PHASE 0 — network + test-Hub-with-work + the n5 container"
  docker network create "$NET" 2>/dev/null || true
  docker rm -f "$TEST_HUB_NAME" 2>/dev/null || true
  docker run -d --name "$TEST_HUB_NAME" --network "$NET" \
    -p "${CONTROL_PORT}:${CONTROL_PORT}" \
    -e MCP_PORT=8080 -e CONTROL_PORT="$CONTROL_PORT" -e BIND=0.0.0.0 \
    -e SEEDED_PROOF_PATH=/work/n5-proof.txt -e WEDGE_TTL_MS="$WEDGE_TTL_MS" \
    -v "$TEST_HUB_BUNDLE:/app/th.mjs:ro" \
    "$TEST_HUB_NODE_IMAGE" node /app/th.mjs >/dev/null
  for _ in $(seq 1 30); do nap 1; ctl /health | grep -q '"ok":true' && break; done
  ctl /health | grep -q '"ok":true' || { docker logs "$TEST_HUB_NAME" 2>&1 | tail -20; die "test-Hub /health never came up"; }
  pass "test-Hub-with-work up: $(ctl /health)"

  ADAPTER_TAG="$ADAPTER_TAG" HOST_WORKTREE="$HOST_WORKTREE" HOST_CLAUDE_CONFIG_DIR="$HOST_CLAUDE_CONFIG_DIR" \
    E2E_CONTAINER_NAME="$E2E_CONTAINER_NAME" \
    docker compose -f "$BASE_COMPOSE" up -d || die "compose up failed"
  pass "n5 container up ($E2E_CONTAINER_NAME) — supervisor -> launcher -> claude -> shim grandchild"

  # The plugin PATH requires the plugin INSTALLED in the mounted config — the marketplace
  # registration ALONE is insufficient (n5 finding). `claude plugin install` copies it from the
  # directory marketplace + works WITHOUT OAuth (local op). Idempotent; then restart so the
  # launcher's claude loads the now-installed plugin (-> spawns the shim grandchild on login).
  log "ensuring agent-adapter plugin installed (plugin path needs install, not just registration)"
  nap 6
  docker exec -e CLAUDE_CONFIG_DIR=/home/appuser/.claude "$E2E_CONTAINER_NAME" bash -c \
    'claude plugin list 2>/dev/null | grep -q "agent-adapter@agentic-network" || claude plugin install agent-adapter@agentic-network' \
    && pass "agent-adapter plugin installed/enabled in the mounted config" \
    || log "plugin-install step returned nonzero (may already be installed)"
  ADAPTER_TAG="$ADAPTER_TAG" HOST_WORKTREE="$HOST_WORKTREE" HOST_CLAUDE_CONFIG_DIR="$HOST_CLAUDE_CONFIG_DIR" \
    E2E_CONTAINER_NAME="$E2E_CONTAINER_NAME" docker compose -f "$BASE_COMPOSE" restart >/dev/null 2>&1 || true
  pass "restarted — claude re-boots with the plugin installed (+ the staged OAuth -> login -> shim spawn -> register)"

  # ── PHASE 1: behavioral acting-confirm (UNPRIMED-FIRST) ─────────────────────
  log "PHASE 1 — behavioral: waiting up to ${BEHAVIOR_TIMEOUT_S}s for the self-wake digest to drive claim->complete (UNPRIMED)"
  local status="" t0 elapsed
  t0=$(python3 -c 'import time;print(int(time.time()))')
  while :; do
    status="$(workitem_status)"
    elapsed=$(( $(python3 -c 'import time;print(int(time.time()))') - t0 ))
    [ "$status" = "done" ] && break
    [ "$elapsed" -ge "$BEHAVIOR_TIMEOUT_S" ] && break
    [ $((elapsed % 20)) -eq 0 ] && log "  ...${elapsed}s seeded-item status=$status"
    nap 5
  done

  # CAPTURE + PERSIST to /work BEFORE any wedge (architect guardrail — L2 restart wipes ephemeral).
  log "capture + PERSIST acting-confirm evidence to host /work"
  ctl /workitem > "$HOST_WORKTREE/n5-workitem-final.json" 2>/dev/null || true
  docker exec "$E2E_CONTAINER_NAME" bash -c 'tmux -L n5 capture-pane -t cli -p 2>/dev/null' \
    > "$HOST_WORKTREE/n5-channel-render.txt" 2>/dev/null || true
  clogs | tail -200 > "$HOST_WORKTREE/n5-container-phase1.log" 2>/dev/null || true

  if [ "$status" = "done" ]; then
    pass "BEHAVIORAL: the UNPRIMED real CLI self-drove the seeded item to done (claim->start->complete), ZERO-human"
    grep -qiE "channel|work_claimable|claimable" "$HOST_WORKTREE/n5-channel-render.txt" 2>/dev/null \
      && pass "  <channel> render captured in the pane (positive render — the n4 capstone)" \
      || log  "  note: <channel> marker not grep-matched in the pane snapshot (inspect n5-channel-render.txt)"
    BOOTSTRAP_FINDING="UNPRIMED-SELF-DROVE"
  else
    fail "BEHAVIORAL: seeded item did NOT reach done within ${BEHAVIOR_TIMEOUT_S}s (status=$status) — the UNPRIMED CLI did not reliably self-drive"
    log  "  -> the BOOTSTRAP finding = NEEDS-MINIMAL-PRIMING (add a CLAUDE.md / system-prompt + re-run; report which). NOT a harness failure."
    BOOTSTRAP_FINDING="NEEDS-PRIMING"
  fi
  log "BOOTSTRAP-FINDING=$BOOTSTRAP_FINDING (the headline behavioral result)"

  # ── PHASE 2: wedge-chaos (3-level sentinel recovery, REAL CLI in the middle) ─
  log "PHASE 2 — chaos: RestartCount_0=$(restart_count); injecting the SILENT wedge (POST /wedge)"
  local rc0; rc0="$(restart_count)"
  ctl_post /wedge | grep -q '"wedged":true' || die "wedge inject failed (fail-closed: no chaos without a real wedge)"
  pass "wedge injected (server-side session evict; keepalives flow)"

  log "waiting up to ${RECOVERY_TIMEOUT_S}s for the 3-level recovery (probe-fail -> sentinel -> exit75 -> L2 restart -> re-claim)"
  local rc rec=0 t1; t1=$(python3 -c 'import time;print(int(time.time()))')
  while :; do
    rc="$(restart_count)"
    [ "$rc" != "ERR" ] && [ "$rc" -gt "${rc0:-0}" ] 2>/dev/null && { rec=1; break; }
    [ $(( $(python3 -c 'import time;print(int(time.time()))') - t1 )) -ge "$RECOVERY_TIMEOUT_S" ] && break
    nap 3
  done
  clogs | tail -200 > "$HOST_WORKTREE/n5-container-chaos.log" 2>/dev/null || true
  if [ "$rec" = "1" ]; then
    pass "CHAOS: docker-L2 restart fired (RestartCount ${rc0}->${rc}) — the real CLI re-boots + re-handshakes"
    clogs | grep -qiE "wedged|sentinel|exit.?75|LIVENESS|re-?handshake|registered" \
      && pass "  3-level seam log markers present (probe-fail/sentinel/exit-75/re-handshake)" \
      || log  "  note: inspect n5-container-chaos.log for the seam markers"
  else
    die "CHAOS: no RestartCount delta within ${RECOVERY_TIMEOUT_S}s — the 3-level recovery did NOT complete (see n5-container-chaos.log)"
  fi

  # ── PHASE 3: clean SIGTERM stop ────────────────────────────────────────────
  log "PHASE 3 — clean stop: docker compose stop (SIGTERM) -> supervisor quiesces -> exit 0 (no restart loop)"
  ADAPTER_TAG="$ADAPTER_TAG" HOST_WORKTREE="$HOST_WORKTREE" HOST_CLAUDE_CONFIG_DIR="$HOST_CLAUDE_CONFIG_DIR" \
    E2E_CONTAINER_NAME="$E2E_CONTAINER_NAME" docker compose -f "$BASE_COMPOSE" stop 2>/dev/null || true
  nap 3
  pass "clean stop issued (supervisor SIGTERM path: tears down the CLI + grandchild)"

  echo
  pass "n5 e2e COMPLETE — behavioral=$BOOTSTRAP_FINDING + 3-level chaos recovery GREEN. Evidence persisted to $HOST_WORKTREE/n5-*."
}

case "$MODE" in
  selfcheck) selfcheck ;;
  run)       run ;;
  *)         die "usage: real-cli-e2e.sh {selfcheck|run}" ;;
esac
