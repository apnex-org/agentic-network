#!/usr/bin/env bash
#
# hub-restore.sh — portable single-command restore of a Hub postgres substrate dump.
#
# Works against ANY postgres reachable via standard connection string:
#   - local docker postgres (default; uses postgres://hub:hub@localhost:5432/hub)
#   - Cloud Run + Persistent Disk postgres deployment
#   - GCE + Persistent Disk postgres deployment
#   - any other postgres reachable via TCP
#
# DESTRUCTIVE: drops the current substrate state and replaces it with the dump.
#
# Usage:
#   hub-restore.sh <source>                                    # interactive (asks for yes)
#   hub-restore.sh <source> --yes                              # skip confirm
#
#   <source> may be:
#     /local/path.dump                  local file
#     gs://bucket/snap.dump             GCS object (requires gsutil)
#
# Env overrides (all optional):
#   HUB_PG_CONNECTION_STRING   target postgres connection string
#                              (default: postgres://hub:hub@localhost:5432/hub)
#   HUB_HUB_CONTAINER          local Hub docker container to auto-stop/start
#                              (default: ois-hub-local-prod; skipped if not running)
#   HUB_AUTO_STOP_HUB          if "0", skip auto-stop/start of Hub container
#                              (must be done manually by operator for cloud deploys)
#   HUB_USE_DOCKER_EXEC        if "1", use `docker exec` instead of connection string
#                              (legacy local-dev path; avoids pg client install + ephemeral docker)
#   HUB_PG_CONTAINER           postgres container name for HUB_USE_DOCKER_EXEC mode
#                              (default: hub-substrate-postgres)
#
# pg client tool resolution (connection-string mode):
#   1. Host `pg_restore` on PATH    → use it directly (fastest)
#   2. Else ephemeral docker run postgres:15-alpine pg_restore

set -euo pipefail

DEFAULT_CONN="postgres://hub:hub@localhost:5432/hub"
CONN="${HUB_PG_CONNECTION_STRING:-$DEFAULT_CONN}"
HUB_CONTAINER="${HUB_HUB_CONTAINER:-ois-hub-local-prod}"
CONTAINER="${HUB_PG_CONTAINER:-hub-substrate-postgres}"
AUTO_STOP_HUB="${HUB_AUTO_STOP_HUB:-1}"

SOURCE="${1:-}"
SKIP_CONFIRM="${2:-}"

if [ -z "$SOURCE" ]; then
  cat >&2 <<'USAGE'
hub-restore.sh — portable Hub postgres substrate restore (DESTRUCTIVE)

Usage:
  hub-restore.sh <source>                    interactive (asks for yes)
  hub-restore.sh <source> --yes              scripted / cron

<source> may be:
  /local/path.dump                   local file
  gs://bucket/snap.dump              GCS object (requires gsutil)

Env:
  HUB_PG_CONNECTION_STRING           default: postgres://hub:hub@localhost:5432/hub
  HUB_HUB_CONTAINER                  default: ois-hub-local-prod (auto-stop/start)
  HUB_AUTO_STOP_HUB=0                skip auto-stop/start (for cloud deploys)
  HUB_USE_DOCKER_EXEC=1              use docker exec instead of connection string
USAGE
  exit 2
fi

# Resolve source shape
case "$SOURCE" in
  gs://*)
    if ! command -v gsutil >/dev/null 2>&1; then
      echo "[hub-restore] FATAL: source is GCS ($SOURCE) but gsutil not found on PATH." >&2
      exit 1
    fi
    if ! gsutil ls "$SOURCE" >/dev/null 2>&1; then
      echo "[hub-restore] FATAL: GCS source not found or unreadable: $SOURCE" >&2
      exit 1
    fi
    SOURCE_KIND="gcs"
    SIZE=$(gsutil du -h "$SOURCE" 2>/dev/null | awk '{print $1$2}' || echo "?")
    ;;
  s3://*|az://*)
    echo "[hub-restore] FATAL: source shape not yet supported: $SOURCE" >&2
    exit 1
    ;;
  *)
    if [ ! -f "$SOURCE" ]; then
      echo "[hub-restore] FATAL: source file not found: $SOURCE" >&2
      exit 1
    fi
    # Magic-byte check (postgres custom-format starts with PGDMP)
    if ! head -c 5 "$SOURCE" | grep -q '^PGDMP'; then
      echo "[hub-restore] FATAL: not a postgres custom-format dump (missing PGDMP header)" >&2
      echo "[hub-restore]   $SOURCE" >&2
      exit 1
    fi
    SOURCE_KIND="local"
    SIZE=$(du -h "$SOURCE" | cut -f1)
    ;;
esac

# Build read-source pipeline
read_source() {
  case "$SOURCE_KIND" in
    gcs)   gsutil -q cp "$SOURCE" - ;;
    local) cat "$SOURCE" ;;
  esac
}

# Build pg_restore invocation (reads from stdin)
run_pg_restore() {
  if [ "${HUB_USE_DOCKER_EXEC:-0}" = "1" ]; then
    if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
      echo "[hub-restore] FATAL: HUB_USE_DOCKER_EXEC=1 but container '$CONTAINER' not running." >&2
      exit 1
    fi
    docker exec -i "$CONTAINER" pg_restore --clean --if-exists -U hub -d hub
  elif command -v pg_restore >/dev/null 2>&1; then
    pg_restore --clean --if-exists -d "$CONN"
  else
    docker run --rm -i --network=host postgres:15-alpine pg_restore --clean --if-exists -d "$CONN"
  fi
}

# Count entities helper (used for plan + post-restore verify)
count_entities() {
  if command -v psql >/dev/null 2>&1; then
    psql "$CONN" -tA -c 'SELECT COUNT(*) FROM entities' 2>/dev/null || echo "0"
  else
    docker run --rm --network=host postgres:15-alpine psql "$CONN" -tA -c 'SELECT COUNT(*) FROM entities' 2>/dev/null || echo "0"
  fi
}

# Mask password in connection string for logging
mask_conn() {
  echo "$1" | sed -E 's|(://[^:]+):[^@]+@|\1:***@|'
}

CURRENT_ENTITIES=$(count_entities)

echo "[hub-restore] === RESTORE PLAN ==="
echo "[hub-restore]   source:            $SOURCE ($SOURCE_KIND, $SIZE)"
if [ "${HUB_USE_DOCKER_EXEC:-0}" = "1" ]; then
  echo "[hub-restore]   mode:              docker-exec (container=$CONTAINER)"
else
  echo "[hub-restore]   mode:              portable (connection string)"
  echo "[hub-restore]   target:            $(mask_conn "$CONN")"
  if command -v pg_restore >/dev/null 2>&1; then
    echo "[hub-restore]   pg_restore:        host"
  else
    echo "[hub-restore]   pg_restore:        ephemeral docker (postgres:15-alpine)"
  fi
fi
echo "[hub-restore]   current entities:  $CURRENT_ENTITIES  ← WILL BE WIPED"
if [ "$AUTO_STOP_HUB" = "1" ]; then
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$HUB_CONTAINER"; then
    echo "[hub-restore]   hub auto-stop:     YES ($HUB_CONTAINER)"
  else
    echo "[hub-restore]   hub auto-stop:     SKIP ($HUB_CONTAINER not running)"
  fi
else
  echo "[hub-restore]   hub auto-stop:     DISABLED (HUB_AUTO_STOP_HUB=0; operator must stop Hub before restore)"
fi
echo "[hub-restore]"

# Interactive confirm
if [ "$SKIP_CONFIRM" != "--yes" ]; then
  read -p "[hub-restore] DESTRUCTIVE. Type 'yes' to proceed: " -r confirm
  if [ "$confirm" != "yes" ]; then
    echo "[hub-restore] aborted"
    exit 0
  fi
fi

# 1. Stop Hub (auto, if requested + applicable)
HUB_WAS_RUNNING=0
if [ "$AUTO_STOP_HUB" = "1" ] && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$HUB_CONTAINER"; then
  HUB_WAS_RUNNING=1
  echo "[hub-restore] $(date -u +%Y-%m-%dT%H:%M:%SZ) stopping Hub: $HUB_CONTAINER"
  docker stop "$HUB_CONTAINER" >/dev/null
fi

# 2. Restore via streaming pipeline
echo "[hub-restore] $(date -u +%Y-%m-%dT%H:%M:%SZ) pg_restore --clean --if-exists starting..."
set -o pipefail
if ! read_source | run_pg_restore; then
  rc=$?
  echo "[hub-restore] WARN: restore pipeline returned non-zero ($rc)" >&2
  echo "[hub-restore]   Often non-fatal (DROP-IF-EXISTS on absent objects produces noise)." >&2
  echo "[hub-restore]   Verifying entity count..." >&2
fi

# 3. Verify
NEW_ENTITIES=$(count_entities)
echo "[hub-restore] ✓ post-restore entity count: $NEW_ENTITIES"

if [ "$NEW_ENTITIES" = "0" ]; then
  echo "[hub-restore] FATAL: entities table empty after restore — restore likely failed." >&2
  echo "[hub-restore]        Hub NOT restarted; investigate before retry." >&2
  exit 1
fi

# 4. Restart Hub
if [ "$HUB_WAS_RUNNING" = "1" ]; then
  echo "[hub-restore] $(date -u +%Y-%m-%dT%H:%M:%SZ) restarting Hub: $HUB_CONTAINER"
  docker start "$HUB_CONTAINER" >/dev/null
  sleep 4
  if docker logs --tail 30 "$HUB_CONTAINER" 2>&1 | grep -q 'substrate-mode active'; then
    echo "[hub-restore] ✓ Hub bootstrap success (substrate-mode active)"
  else
    echo "[hub-restore] WARN: Hub bootstrap not yet logged; check: docker logs $HUB_CONTAINER" >&2
  fi
fi

echo "[hub-restore]"
echo "[hub-restore] ✓ RESTORE COMPLETE"
echo "[hub-restore]   entities now: $NEW_ENTITIES"
