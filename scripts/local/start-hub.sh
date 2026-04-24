#!/usr/bin/env bash
#
# start-hub.sh — Launch the local Hub container (ois-hub-local).
#
# Idempotent: if a container with the same name already exists, it's stopped
# and removed before relaunching. Health-checks the new container before
# returning success.
#
# Container config (env, ports, mount, seccomp) is the single source of truth
# here — start with constants at the top of the script. Token comes from
# deploy/env/prod.tfvars (gitignored). SA key path is auto-discovered.
#
# Usage:
#   scripts/local/start-hub.sh
#
# Env overrides:
#   HUB_HOST_PORT       — default: 8080
#   GOOGLE_APPLICATION_CREDENTIALS — path to SA JSON; auto-discovered if unset
#

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TFVARS="$REPO_ROOT/deploy/env/prod.tfvars"

# ── Container constants ────────────────────────────────────────────────

CONTAINER_NAME="ois-hub-local"
IMAGE="ois-hub:local"
HOST_PORT="${HUB_HOST_PORT:-8080}"
CONTAINER_PORT="8080"

# Hub-side env defaults (non-secret)
GCS_BUCKET="ois-relay-hub-state"
STORAGE_BACKEND="gcs"
WATCHDOG_ENABLED="false"   # ADR-017 watchdog paused locally; queue still operational
NODE_ENV="production"

# ── Read tfvars for the secret ─────────────────────────────────────────

if [[ ! -f "$TFVARS" ]]; then
  echo "[start-hub] ERROR: $TFVARS not found." >&2
  echo "              Copy deploy/env/prod.tfvars.example and populate hub_api_token." >&2
  exit 1
fi

read_tfvar() {
  awk -v key="$1" '
    $1 == key && $2 == "=" {
      val = $0
      sub(/^[^=]*=[ \t]*"/, "", val)
      sub(/"[ \t]*$/, "", val)
      print val
      exit
    }
  ' "$TFVARS"
}

HUB_API_TOKEN="$(read_tfvar hub_api_token)"
if [[ -z "$HUB_API_TOKEN" || "$HUB_API_TOKEN" == "your-secret-token-here" ]]; then
  echo "[start-hub] ERROR: hub_api_token not populated in $TFVARS." >&2
  exit 1
fi

# ── SA key auto-discovery ──────────────────────────────────────────────

if [[ -z "${GOOGLE_APPLICATION_CREDENTIALS:-}" ]]; then
  # Search order:
  #   1. Worktree-local (if user copied the key into this checkout)
  #   2. Canonical agentic-network/ sibling (worktree case — most common)
  #   3. Direct parent (non-worktree single-checkout case)
  PARENT="$(cd "$REPO_ROOT/.." && pwd)"
  for candidate in \
    "$REPO_ROOT/labops-389703.json" \
    "$PARENT/agentic-network/labops-389703.json" \
    "$PARENT/labops-389703.json"; do
    if [[ -f "$candidate" ]]; then
      GOOGLE_APPLICATION_CREDENTIALS="$candidate"
      break
    fi
  done
fi

if [[ -z "${GOOGLE_APPLICATION_CREDENTIALS:-}" || ! -f "$GOOGLE_APPLICATION_CREDENTIALS" ]]; then
  echo "[start-hub] ERROR: SA key not found. Set GOOGLE_APPLICATION_CREDENTIALS or place" >&2
  echo "              labops-389703.json in $REPO_ROOT, its parent, or the canonical" >&2
  echo "              agentic-network/ sibling." >&2
  exit 1
fi

# ── Image presence check ───────────────────────────────────────────────

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "[start-hub] ERROR: Image '$IMAGE' not found locally." >&2
  echo "              Run: scripts/local/build-hub.sh" >&2
  exit 1
fi

# ── Port collision check ───────────────────────────────────────────────
#
# A non-Docker process on $HOST_PORT would let `docker run -p` fail mid-launch
# leaving the user to debug. Surface this up-front.

if ss -ltn "( sport = :$HOST_PORT )" 2>/dev/null | tail -n +2 | grep -q .; then
  # Allow if the listener is the existing ois-hub-local container we'll replace
  if ! docker ps -q --filter "name=^/${CONTAINER_NAME}$" | grep -q .; then
    echo "[start-hub] ERROR: Port $HOST_PORT already in use by a non-Docker process." >&2
    ss -ltnp "( sport = :$HOST_PORT )" 2>/dev/null | tail -n +2 >&2 || true
    exit 1
  fi
fi

# ── Stop + remove any existing container ───────────────────────────────

if docker ps -a -q --filter "name=^/${CONTAINER_NAME}$" | grep -q .; then
  echo "[start-hub] Removing existing $CONTAINER_NAME ..."
  docker rm -f "$CONTAINER_NAME" >/dev/null
fi

# ── Launch ─────────────────────────────────────────────────────────────

echo "[start-hub] Image:        $IMAGE"
echo "[start-hub] Container:    $CONTAINER_NAME"
echo "[start-hub] Port:         ${HOST_PORT}:${CONTAINER_PORT}"
echo "[start-hub] GCS bucket:   $GCS_BUCKET"
echo "[start-hub] SA key:       $GOOGLE_APPLICATION_CREDENTIALS"
echo "[start-hub] Watchdog:     $WATCHDOG_ENABLED"

docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  -p "${HOST_PORT}:${CONTAINER_PORT}" \
  -e "NODE_ENV=$NODE_ENV" \
  -e "PORT=$CONTAINER_PORT" \
  -e "GOOGLE_APPLICATION_CREDENTIALS=/secrets/sa-key.json" \
  -e "GCS_BUCKET=$GCS_BUCKET" \
  -e "STORAGE_BACKEND=$STORAGE_BACKEND" \
  -e "HUB_API_TOKEN=$HUB_API_TOKEN" \
  -e "WATCHDOG_ENABLED=$WATCHDOG_ENABLED" \
  -v "$GOOGLE_APPLICATION_CREDENTIALS:/secrets/sa-key.json:ro" \
  --security-opt seccomp=unconfined \
  "$IMAGE" >/dev/null

# ── Health check ───────────────────────────────────────────────────────

echo "[start-hub] Waiting for health ..."
HEALTH_URL="http://localhost:${HOST_PORT}/health"
DEADLINE=$(( $(date +%s) + 30 ))
while (( $(date +%s) < DEADLINE )); do
  if curl -sf -o /dev/null "$HEALTH_URL" 2>/dev/null; then
    BODY=$(curl -s "$HEALTH_URL")
    echo "[start-hub] Healthy: $BODY"
    echo "[start-hub] Hub up at $HEALTH_URL"
    exit 0
  fi
  sleep 1
done

echo "[start-hub] ERROR: Hub failed to become healthy within 30s." >&2
echo "[start-hub] Last 30 log lines:" >&2
docker logs --tail 30 "$CONTAINER_NAME" >&2 || true
exit 1
