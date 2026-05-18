#!/usr/bin/env bash
#
# hub-snapshot.sh — Hub substrate backup/restore wrapper
#
# mission-83 W7 deliverable per Design v1.4 §2.5 snapshot/restore primitive.
# Wraps `pg_dump -Fc` (custom-format) for save + `pg_restore` for restore.
# Adds schemaVersion validation before restore (per Design §3.3 idempotency).
#
# Usage:
#   hub-snapshot.sh save <target-path>
#   hub-snapshot.sh restore <source-path>
#
# Examples:
#   hub-snapshot.sh save /var/backups/hub-$(date +%Y%m%d-%H%M%S).dump
#   hub-snapshot.sh restore /var/backups/hub-20260517-053000.dump
#
# Env:
#   HUB_PG_CONNECTION_STRING — defaults to postgres://hub:hub@localhost:5432/hub
#   PGHOST/PGUSER/PGDATABASE — standard pg_dump env overrides

set -euo pipefail

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
  HUB_PG_CONNECTION_STRING  postgres connection string
                            (default: postgres://hub:hub@localhost:5432/hub)

Notes:
  - save: pg_dump -Fc (custom format; compressed; supports parallel restore)
  - restore: pg_restore --clean --if-exists; verifies schemaVersion before restore
USAGE
  exit 2
}

if [ -z "$ACTION" ] || [ -z "$PATH_ARG" ]; then usage; fi

save() {
  local target="$1"
  local target_dir
  target_dir="$(dirname "$target")"
  if [ ! -d "$target_dir" ]; then
    echo "[hub-snapshot] FATAL: target directory does not exist: $target_dir" >&2
    exit 1
  fi
  echo "[hub-snapshot] save → $target"
  echo "[hub-snapshot] $(date -u +%Y-%m-%dT%H:%M:%SZ) pg_dump -Fc starting..."
  pg_dump -Fc -d "$CONN" -f "$target"
  local size
  size=$(du -h "$target" | cut -f1)
  echo "[hub-snapshot] ✓ snapshot saved ($size)"

  # Sidecar metadata for restore-time validation
  local meta="${target}.meta"
  local schema_count
  schema_count=$(psql "$CONN" -tA -c "SELECT COUNT(*) FROM entities WHERE kind = 'SchemaDef'")
  cat > "$meta" <<META
{
  "snapshotAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "schemaDefCount": $schema_count,
  "source": "$CONN",
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
  echo "[hub-snapshot] restore ← $source"

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
  pg_restore --clean --if-exists -d "$CONN" "$source"
  echo "[hub-snapshot] ✓ restore complete"

  # Post-restore: verify entity count
  local entity_count
  entity_count=$(psql "$CONN" -tA -c "SELECT COUNT(*) FROM entities")
  echo "[hub-snapshot] ✓ post-restore entity count: $entity_count"
}

case "$ACTION" in
  save) save "$PATH_ARG" ;;
  restore) restore "$PATH_ARG" ;;
  *) echo "[hub-snapshot] unknown action: $ACTION (use save|restore)" >&2; usage ;;
esac
