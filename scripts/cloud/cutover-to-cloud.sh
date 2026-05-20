#!/usr/bin/env bash
#
# cutover-to-cloud.sh — mission-86 W4 production cutover orchestration.
#
# Migrates the production Hub from the local Docker container to the live
# cloud-Hub infrastructure (internal-only GCE VM + Cloud Run nginx ingress +
# Secret Manager + Cloud NAT + bearer-auth gate — all provisioned W0–W3).
# Design v2.9 §4.14 + §5 W4; acceptance gates AG-W4.1–W4.7.
#
# The cutover is a hard pg_dump → pg_restore migration (mission-83 W5.4
# precedent). Both Hubs run postgres:15-alpine — no cross-major-version risk.
# Target downtime ~30s. The local-Hub is STOPPED (not removed) so rollback
# is a trivial re-start; full decommission (`docker rm`) is W5.
#
# Sequence:
#   PREFLIGHT   reachability + state survey (read-only; runs in --dry-run)
#   FREEZE-IMG  pause cloud Watchtower so hub:latest cannot drift mid-cutover
#   DRAIN       graceful SIGTERM stop of the local Hub (W2-prep handler)
#   FREEZE-BASE re-capture the authoritative local entity count (Hub stopped)
#   SNAPSHOT    pg_dump the local postgres via hub-snapshot.sh
#   UPLOAD      gsutil cp the dump to the GCS cutover staging path
#   RESTORE     IAP-tunnel SSH → download + pg_restore into the cloud VM
#   VERIFY      cloud-Hub /health 200 + entity-count parity vs the baseline
#   RESUME-IMG  resume cloud Watchtower (the ongoing image-CD model)
#   ADAPTER     print the OIS_HUB_URL flip instructions (operator-driven)
#
# Downtime (DRAIN → VERIFY): realistically ~2-3 min — drain (≤30s) + snapshot
# + upload + IAP-SSH restore (download + cloud-Hub stop/restore/start). The
# Design's "~30s" is the inner-pipeline figure; the orchestration bookends
# dominate. There is no hard downtime AG.
#
# --dry-run exercises the real path with NO mutating ops: PREFLIGHT runs in
# full (live reachability + survey reads); every mutating step prints its
# fully-resolved command line and skips. That printout is the pre-audit
# evidence for the bilateral pre-cutover audit.
#
# Usage:
#   scripts/cloud/cutover-to-cloud.sh --dry-run     # pre-audit rehearsal
#   scripts/cloud/cutover-to-cloud.sh               # the real cutover (interactive confirm)
#   scripts/cloud/cutover-to-cloud.sh --yes         # the real cutover, non-interactive
#
# --yes skips the interactive confirm() prompt — required for non-interactive
# (engineer-agent / automation) drive, where there is no TTY to type "yes" at
# and a piped stdin is consumed by PREFLIGHT's gcloud-ssh before confirm()
# reads it. The Director cutover-window-confirm is the human gate; --yes
# asserts it has been given. No effect under --dry-run (confirm is skipped).
#
# Env (all optional — defaults target the mission-86 prod deployment):
#   GCP_PROJECT          GCP project        (default: gcloud active project)
#   LOCAL_HUB_CONTAINER  local Hub container        (default: ois-hub-local-prod)
#   LOCAL_PG_CONTAINER   local postgres container   (default: hub-substrate-postgres)
#   CLOUD_VM             cloud VM instance          (default: hub-vm)
#   CLOUD_VM_ZONE        cloud VM zone              (default: australia-southeast1-a)
#   CLOUD_HUB_CONTAINER  cloud Hub container        (default: ois-hub-prod)
#   CLOUD_PG_CONTAINER   cloud postgres container   (default: ois-postgres-prod)
#   WATCHTOWER_CONTAINER cloud Watchtower container (default: watchtower-prod)
#   CLOUD_RUN_URL        Cloud Run hub-api URL      (default: the prod URL)
#   CUTOVER_BUCKET       GCS bucket for the dump    (default: gs://labops-389703-hub-backups)
#   CUTOVER_PREFIX       object prefix within it    (default: cutover — lifecycle-exempt)
#   DRAIN_TIMEOUT        local-Hub SIGTERM grace, s (default: 30)
#   SNAPSHOT_DIR         local dir for the dump     (default: local-state/snapshots)

set -euo pipefail

# ── Argument parsing ───────────────────────────────────────────────────
DRY_RUN=false
ASSUME_YES=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --yes|-y) ASSUME_YES=true ;;
    -h|--help)
      sed -n '2,61p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "cutover-to-cloud: unknown argument '$arg' (use --dry-run or --help)" >&2; exit 2 ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# ── Config (env-overridable) ───────────────────────────────────────────
GCP_PROJECT="${GCP_PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}"
LOCAL_HUB_CONTAINER="${LOCAL_HUB_CONTAINER:-ois-hub-local-prod}"
LOCAL_PG_CONTAINER="${LOCAL_PG_CONTAINER:-hub-substrate-postgres}"
CLOUD_VM="${CLOUD_VM:-hub-vm}"
CLOUD_VM_ZONE="${CLOUD_VM_ZONE:-australia-southeast1-a}"
CLOUD_HUB_CONTAINER="${CLOUD_HUB_CONTAINER:-ois-hub-prod}"
CLOUD_PG_CONTAINER="${CLOUD_PG_CONTAINER:-ois-postgres-prod}"
WATCHTOWER_CONTAINER="${WATCHTOWER_CONTAINER:-watchtower-prod}"
CLOUD_RUN_URL="${CLOUD_RUN_URL:-https://hub-api-5muxctm3ta-ts.a.run.app}"
CUTOVER_BUCKET="${CUTOVER_BUCKET:-gs://labops-389703-hub-backups}"
CUTOVER_PREFIX="${CUTOVER_PREFIX:-cutover}"
DRAIN_TIMEOUT="${DRAIN_TIMEOUT:-30}"
SNAPSHOT_DIR="${SNAPSHOT_DIR:-${REPO_ROOT}/local-state/snapshots}"

CLOUD_RUN_URL="${CLOUD_RUN_URL%/}"
CUTOVER_BUCKET="${CUTOVER_BUCKET%/}"
SNAPSHOT_TOOL="${REPO_ROOT}/scripts/local/hub-snapshot.sh"

TS="$(date -u +%Y%m%d-%H%M%S)"
DUMP_BASENAME="hub-cutover-${TS}.dump"
LOCAL_DUMP="${SNAPSHOT_DIR}/${DUMP_BASENAME}"
GCS_URI="${CUTOVER_BUCKET}/${CUTOVER_PREFIX}/${DUMP_BASENAME}"

# The AG-W4.2 / AG-W4.7 parity pair — both captured while their Hub is STOPPED
# so neither can drift before its count is read:
#  · LOCAL_ENTITY_COUNT   — post-drain (freeze_baseline()); local Hub stopped.
#  · CLOUD_RESTORED_COUNT — post-pg_restore (restore()); cloud Hub still stopped.
# A count taken with the Hub running drifts (repo-event-bridge GitHub polls,
# heartbeats) → a strict-equality parity check would falsely fail.
LOCAL_ENTITY_COUNT=""
CLOUD_RESTORED_COUNT=""

# ── Output helpers ─────────────────────────────────────────────────────
phase() { echo; echo "════════ $* ════════"; }
log()   { echo "[cutover] $*"; }
die()   { echo "[cutover] FATAL: $*" >&2; exit 1; }

# Print a mutating command's resolved form; run it only when not --dry-run.
would() {
  if $DRY_RUN; then
    echo "[cutover][DRY-RUN] would run:"
    printf '             %s\n' "$*"
  else
    echo "[cutover] \$ $*"
    "$@"
  fi
}

ssh_vm() {
  # $1 = remote command string. Read-only callers pass --dry-run-safe=yes.
  local proj_flag=()
  [ -n "$GCP_PROJECT" ] && proj_flag=(--project="$GCP_PROJECT")
  gcloud compute ssh "$CLOUD_VM" --zone="$CLOUD_VM_ZONE" --tunnel-through-iap \
    "${proj_flag[@]}" --command="$1"
}

confirm() {
  $DRY_RUN && return 0
  if $ASSUME_YES; then
    log "confirm: --yes given — proceeding non-interactively"
    log "         (asserts the Director cutover-window-confirm has been given)"
    return 0
  fi
  echo
  echo "  ⚠  This is the REAL production cutover — it will STOP the local Hub,"
  echo "     migrate state to the cloud Hub, and incur ~2-3 min of downtime."
  read -rp "  Proceed with the PRODUCTION cutover? (yes/no): " reply
  [ "$reply" = "yes" ] || die "cutover aborted by operator"
}

# ── PREFLIGHT — read-only; always runs (including under --dry-run) ──────
preflight() {
  phase "PREFLIGHT — reachability + state survey"

  for bin in gcloud gsutil docker curl; do
    command -v "$bin" >/dev/null 2>&1 || die "'$bin' not found on PATH"
  done
  [ -n "$GCP_PROJECT" ] || die "no GCP project — set GCP_PROJECT or 'gcloud config set project'"
  [ -x "$SNAPSHOT_TOOL" ] || die "hub-snapshot.sh not found/executable at $SNAPSHOT_TOOL"
  log "tooling present; GCP project = $GCP_PROJECT"

  # Local Hub must be running (it is the thing we are cutting over FROM).
  docker ps --format '{{.Names}}' | grep -qx "$LOCAL_HUB_CONTAINER" \
    || die "local Hub container '$LOCAL_HUB_CONTAINER' is not running"
  docker ps --format '{{.Names}}' | grep -qx "$LOCAL_PG_CONTAINER" \
    || die "local postgres container '$LOCAL_PG_CONTAINER' is not running"
  log "local Hub + postgres containers running"

  # Cloud Hub must be reachable BEFORE the cutover (it is the destination).
  local code
  code="$(curl -s -m 15 -o /dev/null -w '%{http_code}' "${CLOUD_RUN_URL}/health" || true)"
  [ "$code" = "200" ] || die "cloud Hub /health returned '$code' (expected 200) — destination not ready"
  log "cloud Hub reachable: ${CLOUD_RUN_URL}/health → 200"

  # VM + cloud containers reachable via IAP tunnel (one SSH; check all three).
  log "checking cloud VM via IAP tunnel (this can take ~10s)..."
  local vm_containers
  vm_containers="$(ssh_vm "sudo docker ps --format '{{.Names}}'" 2>/dev/null)"
  local c
  for c in "$CLOUD_PG_CONTAINER" "$CLOUD_HUB_CONTAINER" "$WATCHTOWER_CONTAINER"; do
    echo "$vm_containers" | grep -qx "$c" \
      || die "cloud container '$c' not running on VM '$CLOUD_VM'"
  done
  log "cloud VM reachable; ${CLOUD_PG_CONTAINER} / ${CLOUD_HUB_CONTAINER} / ${WATCHTOWER_CONTAINER} running"

  # State survey — INFORMATIONAL ONLY. The local count here is pre-drain and
  # will keep moving until DRAIN; the authoritative AG-W4.2/W4.7 parity
  # baseline is captured post-drain by freeze_baseline().
  local pre_local pre_cloud
  pre_local="$(docker exec "$LOCAL_PG_CONTAINER" \
    psql -U hub -d hub -tA -c 'SELECT COUNT(*) FROM entities' | tr -d '[:space:]')"
  pre_cloud="$(ssh_vm "sudo docker exec $CLOUD_PG_CONTAINER psql -U hub -d hub -tA -c 'SELECT COUNT(*) FROM entities'" 2>/dev/null | tr -d '[:space:]')"
  log "survey (informational) — local entities: ${pre_local} (pre-drain; still moving)"
  log "survey (informational) — cloud entities: ${pre_cloud:-?} (throwaway W2(3) state; replaced on restore)"

  # Cutover bucket must exist + be writable.
  gsutil ls "${CUTOVER_BUCKET}/" >/dev/null 2>&1 \
    || die "cutover bucket not accessible: ${CUTOVER_BUCKET}"
  log "cutover staging path: ${GCS_URI}"

  log "PREFLIGHT OK"
}

# ── FREEZE-IMG — pause Watchtower so hub:latest cannot drift mid-cutover ─
freeze_image() {
  phase "FREEZE-IMG — pause cloud Watchtower"
  log "hub:latest is a live-moving tag; pausing Watchtower freezes the cloud"
  log "Hub image for a deterministic cutover (resumed at RESUME-IMG)."
  log "NOTE: an aborted cutover leaves Watchtower paused — resume it with"
  log "      'sudo docker start ${WATCHTOWER_CONTAINER}' on the VM if needed."
  if $DRY_RUN; then
    echo "[cutover][DRY-RUN] would run on VM '${CLOUD_VM}':"
    printf '             sudo docker stop %s\n' "$WATCHTOWER_CONTAINER"
  else
    ssh_vm "sudo docker stop $WATCHTOWER_CONTAINER"
    log "Watchtower paused"
  fi
}

# ── DRAIN — graceful SIGTERM stop of the local Hub ─────────────────────
drain() {
  phase "DRAIN — graceful stop of local Hub (downtime begins)"
  log "docker stop --time=${DRAIN_TIMEOUT} sends SIGTERM; the W2-prep handler drains cleanly"
  would docker stop --time="$DRAIN_TIMEOUT" "$LOCAL_HUB_CONTAINER"
}

# ── FREEZE-BASE — re-capture the authoritative parity baseline ─────────
# Runs AFTER drain: the local Hub is stopped, so the entity count is frozen
# and matches what the SNAPSHOT pg_dump will capture. The local postgres
# container is still up, so the count is still queryable.
freeze_baseline() {
  phase "FREEZE-BASE — authoritative entity-count baseline"
  if $DRY_RUN; then
    echo "[cutover][DRY-RUN] would re-capture the post-drain local entity count"
    echo "             (skipped — the Hub is not actually stopped in --dry-run)"
    return 0
  fi
  LOCAL_ENTITY_COUNT="$(docker exec "$LOCAL_PG_CONTAINER" \
    psql -U hub -d hub -tA -c 'SELECT COUNT(*) FROM entities' | tr -d '[:space:]')"
  [ -n "$LOCAL_ENTITY_COUNT" ] || die "could not read post-drain local entity count"
  log "authoritative baseline (post-drain, frozen): ${LOCAL_ENTITY_COUNT} entities"
}

# ── SNAPSHOT — pg_dump the local postgres ──────────────────────────────
snapshot() {
  phase "SNAPSHOT — pg_dump local postgres"
  mkdir -p "$SNAPSHOT_DIR"
  if $DRY_RUN; then
    echo "[cutover][DRY-RUN] would run:"
    printf '             HUB_PG_CONTAINER=%s bash %s save %s\n' \
      "$LOCAL_PG_CONTAINER" "$SNAPSHOT_TOOL" "$LOCAL_DUMP"
  else
    HUB_PG_CONTAINER="$LOCAL_PG_CONTAINER" bash "$SNAPSHOT_TOOL" save "$LOCAL_DUMP"
    [ -f "$LOCAL_DUMP" ] || die "snapshot did not produce $LOCAL_DUMP"
    log "snapshot: $LOCAL_DUMP ($(du -h "$LOCAL_DUMP" | cut -f1))"
  fi
}

# ── UPLOAD — stage the dump (+ sidecar) to GCS ─────────────────────────
upload() {
  phase "UPLOAD — stage dump to GCS"
  would gsutil cp "$LOCAL_DUMP" "$GCS_URI"
  # hub-snapshot.sh writes a <dump>.meta sidecar — carry it across too.
  if $DRY_RUN; then
    printf '             %s\n' "gsutil cp ${LOCAL_DUMP}.meta ${GCS_URI}.meta"
  elif [ -f "${LOCAL_DUMP}.meta" ]; then
    would gsutil cp "${LOCAL_DUMP}.meta" "${GCS_URI}.meta"
  fi
}

# ── RESTORE — IAP-tunnel SSH → download + pg_restore on the cloud VM ───
restore() {
  phase "RESTORE — pg_restore into cloud VM"
  # The basename is resolved operator-side and interpolated into the remote
  # command (NOT a remote $(...) — $LATEST_DUMP would be undefined on the VM).
  # The cloud Hub is stopped for a clean restore; the post-restore entity
  # count is read here, WHILE it is still stopped (exact + frozen — verify()
  # parity-checks it); then the Hub is restarted and re-runs the idempotent
  # SchemaReconciler against the restored state on boot.
  local remote_cmd
  remote_cmd="set -euo pipefail
echo '[vm] downloading dump from GCS...'
gsutil cp '${GCS_URI}' '/tmp/${DUMP_BASENAME}'
echo '[vm] stopping cloud Hub container for clean restore...'
sudo docker stop '${CLOUD_HUB_CONTAINER}'
echo '[vm] pg_restore --clean --if-exists...'
sudo docker exec -i '${CLOUD_PG_CONTAINER}' pg_restore --clean --if-exists -U hub -d hub < '/tmp/${DUMP_BASENAME}'
echo \"CUTOVER_RESTORED_COUNT=\$(sudo docker exec '${CLOUD_PG_CONTAINER}' psql -U hub -d hub -tA -c 'SELECT COUNT(*) FROM entities' | tr -d '[:space:]')\"
echo '[vm] starting cloud Hub container...'
sudo docker start '${CLOUD_HUB_CONTAINER}'
echo '[vm] restore complete'"

  if $DRY_RUN; then
    echo "[cutover][DRY-RUN] would run on VM '${CLOUD_VM}' via IAP tunnel:"
    printf '%s\n' "$remote_cmd" | sed 's/^/             | /'
  else
    log "restoring on VM '${CLOUD_VM}' via IAP tunnel..."
    local out
    out="$(ssh_vm "$remote_cmd")"
    echo "$out"
    CLOUD_RESTORED_COUNT="$(printf '%s\n' "$out" | sed -n 's/^CUTOVER_RESTORED_COUNT=//p' | tr -d '[:space:]')"
    [ -n "$CLOUD_RESTORED_COUNT" ] || die "restore did not report a post-restore entity count"
  fi
}

# ── VERIFY — cloud Hub health + entity-count parity ────────────────────
verify() {
  phase "VERIFY — cloud Hub health + state parity"
  if $DRY_RUN; then
    echo "[cutover][DRY-RUN] would verify:"
    printf '             entity parity: CLOUD_RESTORED_COUNT == LOCAL_ENTITY_COUNT  [AG-W4.2 / AG-W4.7]\n'
    printf '             curl %s/health → expect 200\n' "$CLOUD_RUN_URL"
    return 0
  fi

  # Entity-count parity (AG-W4.2 / AG-W4.7). Both counts are frozen-exact —
  # LOCAL_ENTITY_COUNT taken post-drain, CLOUD_RESTORED_COUNT taken post-restore
  # with the cloud Hub still stopped — so strict equality is correct and a
  # successful restore cannot false-fail. Checked first: fail fast on data-loss
  # before the ~60s health wait.
  log "entity count — local baseline (post-drain): ${LOCAL_ENTITY_COUNT}  |  cloud (post-restore): ${CLOUD_RESTORED_COUNT}"
  [ -n "$CLOUD_RESTORED_COUNT" ] && [ "$CLOUD_RESTORED_COUNT" = "$LOCAL_ENTITY_COUNT" ] \
    || die "entity-count parity FAILED (AG-W4.2/W4.7): local=${LOCAL_ENTITY_COUNT} cloud=${CLOUD_RESTORED_COUNT}"
  log "state parity OK — cloud matches local baseline (AG-W4.2 / AG-W4.7)"

  # Poll /health — the cloud Hub re-boots + runs SchemaReconciler post-restore.
  local code="" i
  for i in $(seq 1 30); do
    code="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "${CLOUD_RUN_URL}/health" || true)"
    [ "$code" = "200" ] && break
    sleep 2
  done
  [ "$code" = "200" ] || die "cloud Hub /health did not return 200 within ~60s (last: '$code')"
  log "cloud Hub healthy: ${CLOUD_RUN_URL}/health → 200"
}

# ── RESUME-IMG — resume Watchtower (the ongoing image-CD model) ────────
resume_image() {
  phase "RESUME-IMG — resume cloud Watchtower"
  if $DRY_RUN; then
    echo "[cutover][DRY-RUN] would run on VM '${CLOUD_VM}':"
    printf '             sudo docker start %s\n' "$WATCHTOWER_CONTAINER"
  else
    ssh_vm "sudo docker start $WATCHTOWER_CONTAINER"
    log "Watchtower resumed — the cloud Hub is back on the hub:latest CD model"
  fi
}

# ── ADAPTER — print the OIS_HUB_URL flip instructions ──────────────────
adapter_flip_notice() {
  phase "ADAPTER — OIS_HUB_URL flip (operator-driven)"
  cat <<NOTICE
The cloud Hub is now live with production state. Final step is OPERATOR-DRIVEN
— it restarts the adapter sessions, so the script cannot do it for itself.

For each adapter shim (lily + greg), flip the Hub URL then restart the session:

  • Edit  <workdir>/.ois/adapter-config.json  →  set  "hubUrl": "${CLOUD_RUN_URL}"
    (or export OIS_HUB_URL="${CLOUD_RUN_URL}" — the env var overrides the file)
  • Restart the adapter session.

This is a config change only — NOT a plugin reinstall (the shim reads the URL
at startup: process.env.OIS_HUB_URL || fileConfig.hubUrl).

Post-flip acceptance checks:
  • AG-W4.3  both agents reconnect within 60s via the Cloud Run URL
  • AG-W4.4  a first post-cutover MCP call succeeds (e.g. list_missions)
  • AG-W4.6  every adapter shim config shows ${CLOUD_RUN_URL}

The local Hub is STOPPED but NOT removed — rollback = re-start it + revert the
URL. Full decommission (docker rm) is W5, after the cutover is validated.
Cutover dump archived at: ${GCS_URI}  (AG-W4.5; lifecycle-exempt prefix)
NOTICE
}

# ── Main ───────────────────────────────────────────────────────────────
main() {
  phase "mission-86 W4 — production cutover$([ "$DRY_RUN" = true ] && echo '  [DRY-RUN]')"
  log "local:  ${LOCAL_HUB_CONTAINER} (pg: ${LOCAL_PG_CONTAINER})"
  log "cloud:  ${CLOUD_VM}/${CLOUD_HUB_CONTAINER} (pg: ${CLOUD_PG_CONTAINER}) — ${CLOUD_RUN_URL}"

  preflight
  confirm
  freeze_image
  drain
  freeze_baseline
  snapshot
  upload
  restore
  verify
  resume_image
  adapter_flip_notice

  phase "CUTOVER ${DRY_RUN:+DRY-RUN }COMPLETE"
  if $DRY_RUN; then
    log "dry-run finished — preflight ran live; every mutating step printed its"
    log "resolved command above. This is the pre-audit evidence."
  else
    log "cloud Hub is live at ${CLOUD_RUN_URL} — complete the adapter flip above."
  fi
}

main
