#!/usr/bin/env bash
#
# scripts/local/start-hub.sh — Launch the local Hub container against a
# selected env. Container name encodes the env (mission-46 T1):
# ois-hub-local-<env>.
#
# Idempotent: if ANY ois-hub-local-* container exists, it's stopped and
# removed before relaunching this env's. One hub at a time (per mission-46
# decision); env switching is stop-prior-start-new.
#
# Container config (env, ports, mount, seccomp) is the single source of
# truth here — constants at the top. Token + bucket come from the env's
# tfvars (gitignored). SA key path is auto-discovered.
#
# Usage:
#   OIS_ENV=<env> scripts/local/start-hub.sh
#   scripts/local/start-hub.sh                 # OIS_ENV defaults to prod
#
# Env selection (mission-46 T1):
#   OIS_ENV    — selects which tfvars file to read + container name
#                suffix. Default: prod.
#                Must match ^[a-z][a-z0-9-]*$, max 20 chars.
#   HUB_HOST_PORT — default: 8080
#   GOOGLE_APPLICATION_CREDENTIALS — path to SA JSON; auto-discovered if unset
#
# tfvars discovery order (first existing wins for OIS_ENV=<env>):
#   1. deploy/cloudrun/env/<env>.tfvars   (split-structure target)
#   2. deploy/env/<env>.tfvars            (local-bootstrap; transitional)
#
# Reads from tfvars: hub_api_token (required), state_bucket_name
# (optional; falls back to ois-relay-hub-state for backward-compat with
# single-env operators), project_id (for SA key auto-discovery hint).
#
set -euo pipefail

# Pre-flight: refuse to run from non-canonical worktree. Worktrees like
# agent-lily/ or agent-greg/ lack the .cutover-complete sentinel under
# local-state/, and the bind-mount logic below would silently attach the
# wrong state-dir to the production Hub container — killing it into a
# restart-loop. Incident: 2026-05-07 Phase-1.5 #1 Pass 10.
CANONICAL_REPO="/home/apnex/taceng/agentic-network"
if [[ "$(pwd)" != "$CANONICAL_REPO" ]]; then
  echo "ERROR: start-hub.sh must run from canonical main checkout." >&2
  echo "       Current CWD: $(pwd)" >&2
  echo "       Required:    $CANONICAL_REPO" >&2
  echo "       (Worktrees lack the cutover sentinel and would mount the" >&2
  echo "        wrong state-dir, killing the prod Hub.)" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# ── Per-role env-file (mission-52 T3 follow-on) ────────────────────────
# Source ~/.config/apnex-agents/hub.env to pick up Hub-runtime env-vars
# (OIS_GH_API_TOKEN + OIS_REPO_EVENT_BRIDGE_REPOS + cadence/budget knobs).
# Mirrors the convention used by sibling scripts (get-agents.sh,
# publish-packages.sh). Idempotent + optional — absent file is a no-op.
HUB_ENV_FILE="${HOME}/.config/apnex-agents/hub.env"
if [[ -f "$HUB_ENV_FILE" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$HUB_ENV_FILE"
  set +a
fi

# ── Env selection + validation (mission-46 T1) ─────────────────────────

OIS_ENV="${OIS_ENV:-prod}"
if [[ ! "$OIS_ENV" =~ ^[a-z][a-z0-9-]*$ ]] || [[ ${#OIS_ENV} -gt 20 ]]; then
  echo "[start-hub] ERROR: invalid OIS_ENV='$OIS_ENV' — must match ^[a-z][a-z0-9-]*$, max 20 chars." >&2
  exit 1
fi

# ── tfvars discovery ───────────────────────────────────────────────────

TFVARS=""
for candidate in \
  "$REPO_ROOT/deploy/cloudrun/env/${OIS_ENV}.tfvars" \
  "$REPO_ROOT/deploy/env/${OIS_ENV}.tfvars"; do
  if [[ -f "$candidate" ]]; then
    TFVARS="$candidate"
    break
  fi
done

if [[ -z "$TFVARS" ]]; then
  echo "[start-hub] ERROR: no tfvars found for OIS_ENV='$OIS_ENV'." >&2
  echo "              Expected one of:" >&2
  echo "                deploy/cloudrun/env/${OIS_ENV}.tfvars" >&2
  echo "                deploy/env/${OIS_ENV}.tfvars" >&2
  echo "              Copy from deploy/cloudrun/env/prod.tfvars.example and populate." >&2
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

# ── Container constants (env-tagged for side-by-side clarity) ──────────

CONTAINER_NAME="ois-hub-local-${OIS_ENV}"
IMAGE="ois-hub:local"
HOST_PORT="${HUB_HOST_PORT:-8080}"
CONTAINER_PORT="8080"

# Hub-side env defaults (non-secret)
GCS_BUCKET="$(read_tfvar state_bucket_name)"
GCS_BUCKET="${GCS_BUCKET:-ois-relay-hub-state}"
# Mission-48 T2b: laptop-Hub default flipped from `gcs` to `local-fs`.
# Operator runs state-sync.sh once to bootstrap GCS→local-fs (writes
# the .cutover-complete sentinel), then start-hub.sh boots into the
# local-fs profile by default — laptop-Hub deployment is the prod
# pattern (per ADR-024 amendment §6.1, mission-48).
# Set `STORAGE_BACKEND=gcs` explicitly to roll back to the GCS profile
# (e.g., for operator-driven comparison testing or explicit cutover
# rollback per the T4 runbook).
STORAGE_BACKEND="${STORAGE_BACKEND:-local-fs}"
# Mission-48 T1: default state-dir host path matches mission-47 T3's
# state-sync.sh layout. `${REPO_ROOT}/local-state/` is gitignored.
OIS_LOCAL_FS_ROOT="${OIS_LOCAL_FS_ROOT:-${REPO_ROOT}/local-state}"
WATCHDOG_ENABLED="false"   # ADR-017 watchdog paused locally; queue still operational
NODE_ENV="production"
PROJECT_ID="$(read_tfvar project_id)"

# Mission-52 T3: repo-event-bridge env-var defaults. Token absent →
# bridge no-ops at Hub startup (no-op + log line). Repos are comma-
# separated owner/name. Cadence + budget have sensible defaults
# (matching package defaults).
OIS_GH_API_TOKEN="${OIS_GH_API_TOKEN:-}"
OIS_REPO_EVENT_BRIDGE_REPOS="${OIS_REPO_EVENT_BRIDGE_REPOS:-}"
OIS_REPO_EVENT_BRIDGE_CADENCE_S="${OIS_REPO_EVENT_BRIDGE_CADENCE_S:-30}"
OIS_REPO_EVENT_BRIDGE_RATE_BUDGET_PCT="${OIS_REPO_EVENT_BRIDGE_RATE_BUDGET_PCT:-0.8}"

# ── Read tfvars for the secret ─────────────────────────────────────────

HUB_API_TOKEN="$(read_tfvar hub_api_token)"
if [[ -z "$HUB_API_TOKEN" || "$HUB_API_TOKEN" == "your-secret-token-here" ]]; then
  echo "[start-hub] ERROR: hub_api_token not populated in $TFVARS." >&2
  exit 1
fi

# ── SA key auto-discovery ──────────────────────────────────────────────
#
# Search order (first hit wins):
#   1. $REPO_ROOT/<project-id>.json   (worktree-local; per-env key)
#   2. $REPO_ROOT/labops-389703.json  (legacy single-env hardcode — preserved for prod back-compat)
#   3. parent/<project-id>.json       (canonical sibling)
#   4. parent/agentic-network/<project-id>.json
#   5. parent/labops-389703.json      (legacy)
# A new env's operator drops their <project-id>.json into the worktree or parent; prod
# continues working via the labops-389703.json path until rotated.

if [[ -z "${GOOGLE_APPLICATION_CREDENTIALS:-}" ]]; then
  PARENT="$(cd "$REPO_ROOT/.." && pwd)"
  CANDIDATES=()
  if [[ -n "$PROJECT_ID" ]]; then
    CANDIDATES+=("$REPO_ROOT/${PROJECT_ID}.json")
    CANDIDATES+=("$PARENT/${PROJECT_ID}.json")
    CANDIDATES+=("$PARENT/agentic-network/${PROJECT_ID}.json")
  fi
  # Legacy fallbacks (preserve prod back-compat for engineers who haven't renamed their key)
  CANDIDATES+=("$REPO_ROOT/labops-389703.json")
  CANDIDATES+=("$PARENT/agentic-network/labops-389703.json")
  CANDIDATES+=("$PARENT/labops-389703.json")
  for candidate in "${CANDIDATES[@]}"; do
    if [[ -f "$candidate" ]]; then
      GOOGLE_APPLICATION_CREDENTIALS="$candidate"
      break
    fi
  done
fi

if [[ -z "${GOOGLE_APPLICATION_CREDENTIALS:-}" || ! -f "$GOOGLE_APPLICATION_CREDENTIALS" ]]; then
  echo "[start-hub] ERROR: SA key not found. Set GOOGLE_APPLICATION_CREDENTIALS explicitly" >&2
  echo "              or place <project-id>.json (e.g. ${PROJECT_ID:-<project>}.json) in" >&2
  echo "              $REPO_ROOT, its parent, or the canonical agentic-network/ sibling." >&2
  exit 1
fi

# ── Image presence check ───────────────────────────────────────────────

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "[start-hub] ERROR: Image '$IMAGE' not found locally." >&2
  echo "              Run: OIS_ENV=$OIS_ENV scripts/local/build-hub.sh" >&2
  exit 1
fi

# ── One-hub-at-a-time enforcement ──────────────────────────────────────
#
# Policy (mission-46 T1 Decision: option B + one-at-a-time): only one
# ois-hub-local-* container may run at a time. If a different-env
# container is running, we stop it before starting the requested one.

RUNNING_HUBS=$(docker ps -a -q --filter "name=^/ois-hub-local" || true)
if [[ -n "$RUNNING_HUBS" ]]; then
  for cid in $RUNNING_HUBS; do
    existing_name=$(docker inspect --format '{{.Name}}' "$cid" 2>/dev/null | sed 's|^/||')
    echo "[start-hub] Removing existing $existing_name ..."
    docker rm -f "$cid" >/dev/null
  done
fi

# ── Port collision check (non-Docker processes only) ───────────────────

if ss -ltn "( sport = :$HOST_PORT )" 2>/dev/null | tail -n +2 | grep -q .; then
  echo "[start-hub] ERROR: Port $HOST_PORT already in use by a non-Docker process." >&2
  ss -ltnp "( sport = :$HOST_PORT )" 2>/dev/null | tail -n +2 >&2 || true
  exit 1
fi

# ── Mission-48 T1: state-dir pre-flight (local-fs only) ────────────────
#
# When `STORAGE_BACKEND=local-fs`, the container bind-mounts the host
# state directory and writes through it. Catch the bind-mount uid/gid
# trap loudly at the shell layer (before docker run) by ensuring the
# directory exists + is writable by the host user. The Hub-side
# writability assertion in `hub/src/index.ts` provides defense-in-depth
# inside the container.

if [[ "$STORAGE_BACKEND" == "local-fs" ]]; then
  if ! mkdir -p "$OIS_LOCAL_FS_ROOT" 2>/dev/null; then
    echo "[start-hub] ERROR: cannot create state directory $OIS_LOCAL_FS_ROOT." >&2
    echo "              Check parent-directory permissions; ensure host path is writable." >&2
    exit 1
  fi
  WRITABILITY_PROBE="${OIS_LOCAL_FS_ROOT}/.start-hub-writability-$$"
  if ! ( : > "$WRITABILITY_PROBE" ) 2>/dev/null; then
    echo "[start-hub] ERROR: $OIS_LOCAL_FS_ROOT not writable by host user $(id -u):$(id -g)." >&2
    echo "              Most likely cause: state-dir was previously written by a different uid (e.g., container running as appuser without -u override)." >&2
    echo "              Fix: either chown the dir to $(id -u):$(id -g), or remove + recreate it before re-running." >&2
    exit 1
  fi
  rm -f "$WRITABILITY_PROBE"
fi

# ── Launch ─────────────────────────────────────────────────────────────

echo "[start-hub] OIS_ENV:      $OIS_ENV"
echo "[start-hub] Image:        $IMAGE"
echo "[start-hub] Container:    $CONTAINER_NAME"
echo "[start-hub] Port:         ${HOST_PORT}:${CONTAINER_PORT}"
echo "[start-hub] Backend:      $STORAGE_BACKEND"
if [[ "$STORAGE_BACKEND" == "local-fs" ]]; then
  echo "[start-hub] State dir:    $OIS_LOCAL_FS_ROOT (bind-mounted; uid/gid $(id -u):$(id -g))"
else
  echo "[start-hub] GCS bucket:   $GCS_BUCKET"
fi
echo "[start-hub] SA key:       $GOOGLE_APPLICATION_CREDENTIALS"
echo "[start-hub] Watchdog:     $WATCHDOG_ENABLED"

# Build docker run argv as an array so the local-fs bind mount can be
# conditionally appended without nested escaping.
DOCKER_ARGS=(
  -d
  --name "$CONTAINER_NAME"
  --restart unless-stopped
  -u "$(id -u):$(id -g)"
  -p "${HOST_PORT}:${CONTAINER_PORT}"
  -e "NODE_ENV=$NODE_ENV"
  -e "PORT=$CONTAINER_PORT"
  -e "GOOGLE_APPLICATION_CREDENTIALS=/secrets/sa-key.json"
  -e "GCS_BUCKET=$GCS_BUCKET"
  -e "STORAGE_BACKEND=$STORAGE_BACKEND"
  -e "HUB_API_TOKEN=$HUB_API_TOKEN"
  -e "WATCHDOG_ENABLED=$WATCHDOG_ENABLED"
  -e "OIS_SCHEDULED_MESSAGE_SWEEPER_INTERVAL_MS=${OIS_SCHEDULED_MESSAGE_SWEEPER_INTERVAL_MS:-30000}"
  -e "OIS_MESSAGE_PROJECTION_SWEEPER_INTERVAL_MS=${OIS_MESSAGE_PROJECTION_SWEEPER_INTERVAL_MS:-30000}"
  -v "$GOOGLE_APPLICATION_CREDENTIALS:/secrets/sa-key.json:ro"
  --security-opt seccomp=unconfined
)

# Mission-48 T1: bind-mount the state directory + propagate the path
# into the container so `OIS_LOCAL_FS_ROOT` resolves identically inside.
if [[ "$STORAGE_BACKEND" == "local-fs" ]]; then
  DOCKER_ARGS+=( -v "$OIS_LOCAL_FS_ROOT:$OIS_LOCAL_FS_ROOT" )
  DOCKER_ARGS+=( -e "OIS_LOCAL_FS_ROOT=$OIS_LOCAL_FS_ROOT" )
fi

# Mission-52 T3: repo-event-bridge env-var pass-through. Token-absent
# → no env-vars passed (Hub-side conditional skips bridge); token-set
# → all four pass through. Container Hub then logs whether bridge is
# enabled at startup.
if [[ -n "$OIS_GH_API_TOKEN" ]]; then
  DOCKER_ARGS+=( -e "OIS_GH_API_TOKEN=$OIS_GH_API_TOKEN" )
  DOCKER_ARGS+=( -e "OIS_REPO_EVENT_BRIDGE_REPOS=$OIS_REPO_EVENT_BRIDGE_REPOS" )
  DOCKER_ARGS+=( -e "OIS_REPO_EVENT_BRIDGE_CADENCE_S=$OIS_REPO_EVENT_BRIDGE_CADENCE_S" )
  DOCKER_ARGS+=( -e "OIS_REPO_EVENT_BRIDGE_RATE_BUDGET_PCT=$OIS_REPO_EVENT_BRIDGE_RATE_BUDGET_PCT" )
  echo "[start-hub] repo-bridge:   enabled (repos=$OIS_REPO_EVENT_BRIDGE_REPOS, cadence=${OIS_REPO_EVENT_BRIDGE_CADENCE_S}s)"
else
  echo "[start-hub] repo-bridge:   disabled (OIS_GH_API_TOKEN not set)"
fi

docker run "${DOCKER_ARGS[@]}" "$IMAGE" >/dev/null

# ── Health check ───────────────────────────────────────────────────────

echo "[start-hub] Waiting for health ..."
HEALTH_URL="http://localhost:${HOST_PORT}/health"
DEADLINE=$(( $(date +%s) + 30 ))
while (( $(date +%s) < DEADLINE )); do
  if curl -sf -o /dev/null "$HEALTH_URL" 2>/dev/null; then
    BODY=$(curl -s "$HEALTH_URL")
    echo "[start-hub] Healthy: $BODY"
    echo "[start-hub] Hub up at $HEALTH_URL (env=$OIS_ENV)"
    exit 0
  fi
  sleep 1
done

echo "[start-hub] ERROR: Hub failed to become healthy within 30s." >&2
echo "[start-hub] Last 30 log lines:" >&2
docker logs --tail 30 "$CONTAINER_NAME" >&2 || true
exit 1
