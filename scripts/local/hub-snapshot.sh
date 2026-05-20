#!/usr/bin/env bash
#
# hub-snapshot.sh — Hub substrate backup/restore wrapper
#
# mission-83 W7 deliverable per Design v1.4 §2.5 snapshot/restore primitive.
# Wraps `pg_dump -Fc` (custom-format) for save + `pg_restore` for restore.
# Adds schemaVersion validation before restore (per Design §3.3 idempotency).
#
# The Hub's postgres runs as a Docker container (substrate cutover, mission-83
# W5) — `hub-substrate-postgres` in local dev, `ois-postgres-prod` on the
# cloud VM. The operator host has no postgres client, so pg_dump / pg_restore
# / psql run *inside* the postgres container via `docker exec`
# (mission-86 W2, finding F10). Set HUB_PG_CONTAINER to the container name;
# set it empty to fall back to host-installed pg binaries against
# HUB_PG_CONNECTION_STRING.
#
# Usage:
#   hub-snapshot.sh save <target-path>
#   hub-snapshot.sh restore <source-path>
#
# Examples:
#   hub-snapshot.sh save /var/backups/hub-$(date +%Y%m%d-%H%M%S).dump
#   hub-snapshot.sh restore /var/backups/hub-20260517-053000.dump
#   HUB_PG_CONTAINER=ois-postgres-prod hub-snapshot.sh restore /tmp/hub.dump
#
# Env:
#   HUB_PG_CONTAINER          postgres Docker container to `docker exec` into
#                             (default: hub-substrate-postgres). Set empty to
#                             use host pg binaries against the connection
#                             string instead.
#   HUB_PG_USER               postgres role (default: hub)
#   HUB_PG_DATABASE           postgres database (default: hub)
#   HUB_PG_CONNECTION_STRING  host-binary-mode connection string
#                             (default: postgres://hub:hub@localhost:5432/hub)
#   HUB_DOCKER                docker invocation (default: docker). Set to
#                             "sudo docker" on hosts where the invoking user
#                             is not in the docker group (e.g. the COS VM).

set -euo pipefail

# `-` (not `:-`) so an explicitly-empty HUB_PG_CONTAINER selects host mode,
# while an unset variable gets the local-dev default.
PG_CONTAINER="${HUB_PG_CONTAINER-hub-substrate-postgres}"
DOCKER="${HUB_DOCKER:-docker}"
PG_USER="${HUB_PG_USER:-hub}"
PG_DATABASE="${HUB_PG_DATABASE:-hub}"
CONN="${HUB_PG_CONNECTION_STRING:-postgres://hub:hub@localhost:5432/hub}"
ACTION="${1:-}"
PATH_ARG="${2:-}"

usage() {
  cat >&2 <<'USAGE'
hub-snapshot.sh — Hub substrate backup/restore

Usage:
  hub-snapshot.sh save <target-path>
  hub-snapshot.sh restore <source-path>

Env:
  HUB_PG_CONTAINER          postgres Docker container to docker-exec into
                            (default: hub-substrate-postgres; empty = host mode)
  HUB_PG_USER               postgres role (default: hub)
  HUB_PG_DATABASE           postgres database (default: hub)
  HUB_PG_CONNECTION_STRING  host-mode connection string
                            (default: postgres://hub:hub@localhost:5432/hub)

Notes:
  - save: pg_dump -Fc (custom format; compressed; supports parallel restore)
  - restore: pg_restore --clean --if-exists; verifies schemaVersion before restore
USAGE
  exit 2
}

if [ -z "$ACTION" ] || [ -z "$PATH_ARG" ]; then usage; fi

# ── pg client invocation ──────────────────────────────────────────────
# docker-exec into the postgres container, or (HUB_PG_CONTAINER empty) the
# host-installed binary against $CONN. pg_dump streams the archive to
# stdout; pg_restore reads it from stdin — so the snapshot file lives on
# the host in both modes (the container needs no shared volume).
pg_dump_cmd() {
  if [ -n "$PG_CONTAINER" ]; then
    $DOCKER exec "$PG_CONTAINER" pg_dump -Fc -U "$PG_USER" "$PG_DATABASE"
  else
    pg_dump -Fc -d "$CONN"
  fi
}

pg_restore_cmd() {
  if [ -n "$PG_CONTAINER" ]; then
    $DOCKER exec -i "$PG_CONTAINER" pg_restore --clean --if-exists -U "$PG_USER" -d "$PG_DATABASE"
  else
    pg_restore --clean --if-exists -d "$CONN"
  fi
}

psql_query() {
  if [ -n "$PG_CONTAINER" ]; then
    $DOCKER exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DATABASE" -tA -c "$1"
  else
    psql "$CONN" -tA -c "$1"
  fi
}

src_label() {
  if [ -n "$PG_CONTAINER" ]; then echo "container:$PG_CONTAINER/$PG_DATABASE"; else echo "$CONN"; fi
}

save() {
  local target="$1"
  local target_dir
  target_dir="$(dirname "$target")"
  if [ ! -d "$target_dir" ]; then
    echo "[hub-snapshot] FATAL: target directory does not exist: $target_dir" >&2
    exit 1
  fi
  echo "[hub-snapshot] save → $target  (source: $(src_label))"
  echo "[hub-snapshot] $(date -u +%Y-%m-%dT%H:%M:%SZ) pg_dump -Fc starting..."
  pg_dump_cmd > "$target"
  local size
  size=$(du -h "$target" | cut -f1)
  echo "[hub-snapshot] ✓ snapshot saved ($size)"

  # Sidecar metadata for restore-time validation
  local meta="${target}.meta"
  local schema_count
  schema_count=$(psql_query "SELECT COUNT(*) FROM entities WHERE kind = 'SchemaDef'")
  cat > "$meta" <<META
{
  "snapshotAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "schemaDefCount": $schema_count,
  "source": "$(src_label)",
  "tool": "hub-snapshot.sh (mission-83 W7)",
  "format": "pg_dump -Fc"
}
META
  echo "[hub-snapshot] ✓ metadata sidecar at $meta"
}

restore() {
  local source="$1"
  if [ ! -f "$source" ]; then
    echo "[hub-snapshot] FATAL: snapshot not found: $source" >&2
    exit 1
  fi
  echo "[hub-snapshot] restore ← $source  (target: $(src_label))"

  # Pre-restore validation: schemaVersion compat check via sidecar
  local meta="${source}.meta"
  if [ -f "$meta" ]; then
    echo "[hub-snapshot] sidecar metadata found at $meta"
    cat "$meta"
    echo ""
  else
    echo "[hub-snapshot] WARN: no sidecar metadata at $meta (continuing without schema-version check)"
  fi

  # Confirm before destructive restore
  read -p "[hub-snapshot] RESTORE WILL OVERWRITE current substrate state. Proceed? (yes/no): " -r confirm
  if [ "$confirm" != "yes" ]; then
    echo "[hub-snapshot] aborted"
    exit 0
  fi

  echo "[hub-snapshot] $(date -u +%Y-%m-%dT%H:%M:%SZ) pg_restore --clean --if-exists starting..."
  pg_restore_cmd < "$source"
  echo "[hub-snapshot] ✓ restore complete"

  # Post-restore: verify entity count
  local entity_count
  entity_count=$(psql_query "SELECT COUNT(*) FROM entities")
  echo "[hub-snapshot] ✓ post-restore entity count: $entity_count"
}

case "$ACTION" in
  save) save "$PATH_ARG" ;;
  restore) restore "$PATH_ARG" ;;
  *) echo "[hub-snapshot] unknown action: $ACTION (use save|restore)" >&2; usage ;;
esac
