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
#   PREFLIGHT  reachability + state-baseline (read-only; runs in --dry-run)
#   DRAIN      graceful SIGTERM stop of the local Hub (W2-prep handler)
#   SNAPSHOT   pg_dump the local postgres via hub-snapshot.sh
#   UPLOAD     gsutil cp the dump to the GCS cutover staging path
#   RESTORE    IAP-tunnel SSH → download + pg_restore into the cloud VM
#   VERIFY     cloud-Hub /health 200 + entity-count parity vs the baseline
#   ADAPTER    print the OIS_HUB_URL flip instructions (operator-driven)
#
# --dry-run exercises the real path with NO mutating ops: PREFLIGHT runs in
# full (live reachability + baseline reads); every mutating step prints its
# fully-resolved command line and skips. That printout is the pre-audit
# evidence for the bilateral pre-cutover audit.
#
# Usage:
#   scripts/cloud/cutover-to-cloud.sh --dry-run     # pre-audit rehearsal
#   scripts/cloud/cutover-to-cloud.sh               # the real cutover
#
# Env (all optional — defaults target the mission-86 prod deployment):
#   GCP_PROJECT          GCP project        (default: gcloud active project)
#   LOCAL_HUB_CONTAINER  local Hub container        (default: ois-hub-local-prod)
#   LOCAL_PG_CONTAINER   local postgres container   (default: hub-substrate-postgres)
#   CLOUD_VM             cloud VM instance          (default: hub-vm)
#   CLOUD_VM_ZONE        cloud VM zone              (default: australia-southeast1-a)
#   CLOUD_HUB_CONTAINER  cloud Hub container        (default: ois-hub-prod)
#   CLOUD_PG_CONTAINER   cloud postgres container   (default: ois-postgres-prod)
#   CLOUD_RUN_URL        Cloud Run hub-api URL      (default: the prod URL)
#   CUTOVER_BUCKET       GCS bucket for the dump    (default: gs://labops-389703-hub-backups)
#   CUTOVER_PREFIX       object prefix within it    (default: cutover — lifecycle-exempt)
#   DRAIN_TIMEOUT        local-Hub SIGTERM grace, s (default: 30)
#   SNAPSHOT_DIR         local dir for the dump     (default: local-state/snapshots)

set -euo pipefail

# ── Argument parsing ───────────────────────────────────────────────────
DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    -h|--help)
      sed -n '2,46p' "$0" | sed 's/^# \{0,1\}//'
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

# Captured by PREFLIGHT / SNAPSHOT for the AG-W4.2 / AG-W4.7 parity check.
LOCAL_ENTITY_COUNT=""

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
  echo
  echo "  ⚠  This is the REAL production cutover — it will STOP the local Hub,"
  echo "     migrate state to the cloud Hub, and incur ~30s of downtime."
  read -rp "  Proceed with the PRODUCTION cutover? (yes/no): " reply
  [ "$reply" = "yes" ] || die "cutover aborted by operator"
}

# ── PREFLIGHT — read-only; always runs (including under --dry-run) ──────
preflight() {
  phase "PREFLIGHT — reachability + state baseline"

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

  # VM + cloud postgres reachable via IAP tunnel.
  log "checking cloud VM via IAP tunnel (this can take ~10s)..."
  ssh_vm "sudo docker ps --format '{{.Names}}'" 2>/dev/null | grep -qx "$CLOUD_PG_CONTAINER" \
    || die "cloud postgres container '$CLOUD_PG_CONTAINER' not visible on VM '$CLOUD_VM'"
  log "cloud VM reachable; '$CLOUD_PG_CONTAINER' running"

  # State baseline — entity count on both sides (AG-W4.2 / AG-W4.7).
  LOCAL_ENTITY_COUNT="$(docker exec "$LOCAL_PG_CONTAINER" \
    psql -U hub -d hub -tA -c 'SELECT COUNT(*) FROM entities' | tr -d '[:space:]')"
  local cloud_count
  cloud_count="$(ssh_vm "sudo docker exec $CLOUD_PG_CONTAINER psql -U hub -d hub -tA -c 'SELECT COUNT(*) FROM entities'" 2>/dev/null | tr -d '[:space:]')"
  log "baseline — local entities: ${LOCAL_ENTITY_COUNT}  |  cloud entities (pre-restore, throwaway W2(3) state): ${cloud_count:-?}"

  # Cutover bucket must exist + be writable.
  gsutil ls "${CUTOVER_BUCKET}/" >/dev/null 2>&1 \
    || die "cutover bucket not accessible: ${CUTOVER_BUCKET}"
  log "cutover staging path: ${GCS_URI}"

  log "PREFLIGHT OK"
}

# ── DRAIN — graceful SIGTERM stop of the local Hub ─────────────────────
drain() {
  phase "DRAIN — graceful stop of local Hub (downtime begins)"
  log "docker stop --time=${DRAIN_TIMEOUT} sends SIGTERM; the W2-prep handler drains cleanly"
  would docker stop --time="$DRAIN_TIMEOUT" "$LOCAL_HUB_CONTAINER"
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
  # The cloud Hub is stopped for a clean restore, then restarted; it re-runs
  # the idempotent SchemaReconciler against the restored state on boot.
  local remote_cmd
  remote_cmd="set -euo pipefail
echo '[vm] downloading dump from GCS...'
gsutil cp '${GCS_URI}' '/tmp/${DUMP_BASENAME}'
echo '[vm] stopping cloud Hub container for clean restore...'
sudo docker stop '${CLOUD_HUB_CONTAINER}'
echo '[vm] pg_restore --clean --if-exists...'
sudo docker exec -i '${CLOUD_PG_CONTAINER}' pg_restore --clean --if-exists -U hub -d hub < '/tmp/${DUMP_BASENAME}'
echo '[vm] starting cloud Hub container...'
sudo docker start '${CLOUD_HUB_CONTAINER}'
echo '[vm] restore complete'"

  if $DRY_RUN; then
    echo "[cutover][DRY-RUN] would run on VM '${CLOUD_VM}' via IAP tunnel:"
    printf '%s\n' "$remote_cmd" | sed 's/^/             | /'
  else
    log "restoring on VM '${CLOUD_VM}' via IAP tunnel..."
    ssh_vm "$remote_cmd"
  fi
}

# ── VERIFY — cloud Hub health + entity-count parity ────────────────────
verify() {
  phase "VERIFY — cloud Hub health + state parity"
  if $DRY_RUN; then
    echo "[cutover][DRY-RUN] would verify:"
    printf '             curl %s/health → expect 200\n' "$CLOUD_RUN_URL"
    printf '             cloud entity count == local baseline (%s)  [AG-W4.2 / AG-W4.7]\n' "${LOCAL_ENTITY_COUNT:-<baseline>}"
    return 0
  fi

  # Poll /health — the cloud Hub re-boots + runs SchemaReconciler post-restore.
  local code="" i
  for i in $(seq 1 30); do
    code="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "${CLOUD_RUN_URL}/health" || true)"
    [ "$code" = "200" ] && break
    sleep 2
  done
  [ "$code" = "200" ] || die "cloud Hub /health did not return 200 within ~60s (last: '$code')"
  log "cloud Hub healthy: ${CLOUD_RUN_URL}/health → 200"

  local cloud_count
  cloud_count="$(ssh_vm "sudo docker exec $CLOUD_PG_CONTAINER psql -U hub -d hub -tA -c 'SELECT COUNT(*) FROM entities'" 2>/dev/null | tr -d '[:space:]')"
  log "entity count — local baseline: ${LOCAL_ENTITY_COUNT}  |  cloud post-restore: ${cloud_count}"
  [ -n "$cloud_count" ] && [ "$cloud_count" = "$LOCAL_ENTITY_COUNT" ] \
    || die "entity-count parity FAILED (AG-W4.2/W4.7): local=${LOCAL_ENTITY_COUNT} cloud=${cloud_count}"
  log "state parity OK — cloud matches local baseline (AG-W4.2 / AG-W4.7)"
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
  drain
  snapshot
  upload
  restore
  verify
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
