#!/usr/bin/env bash
#
# hub-backup.sh — portable online single-file backup of the Hub postgres substrate.
#
# Works against ANY postgres reachable via standard connection string:
#   - local docker postgres (default; uses postgres://hub:hub@localhost:5432/hub)
#   - Cloud Run + Persistent Disk postgres deployment
#   - GCE + Persistent Disk postgres deployment
#   - any other postgres reachable via TCP
#
# Online-safe: pg_dump uses MVCC snapshot + ACCESS SHARE locks only.
# The Hub keeps serving reads + writes for the entire backup window.
#
# Usage:
#   hub-backup.sh                                # → default dir, timestamped, default conn
#   hub-backup.sh /local/path.dump               # → explicit local file
#   hub-backup.sh gs://bucket/snap.dump          # → GCS object (requires gsutil)
#   HUB_PG_CONNECTION_STRING=postgres://... hub-backup.sh gs://...   # cloud postgres → GCS
#
# Env overrides (all optional):
#   HUB_PG_CONNECTION_STRING   target postgres connection string
#                              (default: postgres://hub:hub@localhost:5432/hub)
#   HUB_BACKUP_DIR             default local target dir (when no target arg given)
#                              (default: /home/apnex/taceng/cutover-snapshots)
#   HUB_USE_DOCKER_EXEC        if "1", use `docker exec hub-substrate-postgres pg_dump`
#                              instead of connection-string mode (legacy local-dev path;
#                              avoids pg client install OR ephemeral docker)
#   HUB_PG_CONTAINER           postgres container name for HUB_USE_DOCKER_EXEC mode
#                              (default: hub-substrate-postgres)
#
# pg client tool resolution (connection-string mode):
#   1. Host `pg_dump` on PATH    → use it directly (fastest)
#   2. Else ephemeral docker run postgres:15-alpine pg_dump (no host install needed)
#
# Output format: postgres custom format (-Fc; zlib-compressed; single file; restorable
# via pg_restore on any postgres ≥ source major version).

set -euo pipefail

DEFAULT_CONN="postgres://hub:hub@localhost:5432/hub"
DEFAULT_DIR="${HUB_BACKUP_DIR:-/home/apnex/taceng/cutover-snapshots}"
CONN="${HUB_PG_CONNECTION_STRING:-$DEFAULT_CONN}"
CONTAINER="${HUB_PG_CONTAINER:-hub-substrate-postgres}"

# Resolve target (local file path OR gs:// URI)
if [ $# -ge 1 ]; then
  TARGET="$1"
else
  mkdir -p "$DEFAULT_DIR"
  TARGET="$DEFAULT_DIR/hub-$(date +%Y%m%dT%H%M%S).dump"
fi

# Validate target shape
case "$TARGET" in
  gs://*)
    if ! command -v gsutil >/dev/null 2>&1; then
      echo "[hub-backup] FATAL: target is GCS ($TARGET) but gsutil not found on PATH." >&2
      echo "[hub-backup]   install: https://cloud.google.com/sdk/docs/install" >&2
      exit 1
    fi
    TARGET_KIND="gcs"
    ;;
  s3://*|az://*)
    echo "[hub-backup] FATAL: target shape not yet supported: $TARGET" >&2
    echo "[hub-backup]   supported: local file path, gs://..." >&2
    exit 1
    ;;
  *)
    target_dir="$(dirname "$TARGET")"
    if [ ! -d "$target_dir" ]; then
      echo "[hub-backup] FATAL: target directory does not exist: $target_dir" >&2
      exit 1
    fi
    if [ -f "$TARGET" ]; then
      echo "[hub-backup] FATAL: target file already exists: $TARGET" >&2
      echo "[hub-backup] Remove it first or pick a different path." >&2
      exit 1
    fi
    TARGET_KIND="local"
    ;;
esac

# Build the pg_dump invocation
run_pg_dump() {
  if [ "${HUB_USE_DOCKER_EXEC:-0}" = "1" ]; then
    # Legacy local-dev path: docker exec into the postgres container
    if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
      echo "[hub-backup] FATAL: HUB_USE_DOCKER_EXEC=1 but container '$CONTAINER' not running." >&2
      exit 1
    fi
    docker exec "$CONTAINER" pg_dump -Fc -U hub -d hub
  elif command -v pg_dump >/dev/null 2>&1; then
    # Host pg client tools available (fastest path)
    pg_dump -Fc "$CONN"
  else
    # Ephemeral docker pg_dump (no host install required)
    # --network=host so container can reach localhost:5432 OR any host-reachable endpoint.
    # On macOS/Windows docker, network=host doesn't work the same way; operators on those
    # platforms should install pg_dump on host OR use HUB_USE_DOCKER_EXEC=1.
    docker run --rm --network=host postgres:15-alpine pg_dump -Fc "$CONN"
  fi
}

# Build the target-write
write_target() {
  case "$TARGET_KIND" in
    gcs)
      gsutil -q cp - "$TARGET"
      ;;
    local)
      cat > "$TARGET"
      ;;
  esac
}

# Mask password in connection string for logging
mask_conn() {
  echo "$1" | sed -E 's|(://[^:]+):[^@]+@|\1:***@|'
}

echo "[hub-backup] $(date -u +%Y-%m-%dT%H:%M:%SZ) starting online backup..."
if [ "${HUB_USE_DOCKER_EXEC:-0}" = "1" ]; then
  echo "[hub-backup]   mode:       docker-exec (container=$CONTAINER)"
else
  echo "[hub-backup]   mode:       portable (connection string)"
  echo "[hub-backup]   conn:       $(mask_conn "$CONN")"
  if command -v pg_dump >/dev/null 2>&1; then
    echo "[hub-backup]   pg_dump:    host ($(pg_dump --version | head -1))"
  else
    echo "[hub-backup]   pg_dump:    ephemeral docker (postgres:15-alpine)"
  fi
fi
echo "[hub-backup]   target:     $TARGET ($TARGET_KIND)"

# Execute backup with proper pipe error handling
set -o pipefail
if ! run_pg_dump | write_target; then
  echo "[hub-backup] FATAL: backup pipeline failed." >&2
  # Best-effort cleanup of partial local file
  [ "$TARGET_KIND" = "local" ] && [ -f "$TARGET" ] && rm -f "$TARGET"
  exit 1
fi

# Report
case "$TARGET_KIND" in
  gcs)
    SIZE=$(gsutil du -h "$TARGET" 2>/dev/null | awk '{print $1$2}' || echo "?")
    echo "[hub-backup] ✓ snapshot saved: $TARGET ($SIZE)"
    ;;
  local)
    SIZE=$(du -h "$TARGET" | cut -f1)
    echo "[hub-backup] ✓ snapshot saved: $TARGET ($SIZE)"
    ;;
esac

echo "[hub-backup]"
echo "[hub-backup] Restore command:"
case "$TARGET_KIND" in
  gcs)
    echo "[hub-backup]   hub-restore $TARGET"
    ;;
  local)
    echo "[hub-backup]   hub-restore $TARGET"
    ;;
esac
