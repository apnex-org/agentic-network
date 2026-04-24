#!/usr/bin/env bash
#
# state-sync.sh — Mirror GCS hub state to a local directory for use with
# STORAGE_BACKEND=local-fs (mission-47 T3).
#
# The local-fs StorageProvider reads/writes from a root directory; point
# a dev hub at a gsutil-rsynced snapshot of prod state to debug without
# touching GCS. Byte-identical layout (blobs → files, prefixes → dirs),
# so this is a one-shot populate + re-run for refresh.
#
# Usage:
#   ./scripts/state-sync.sh                        # sync to ./local-state/
#   ./scripts/state-sync.sh /custom/root            # custom root dir
#   GCS_BUCKET=gs://other-hub ./scripts/state-sync.sh   # custom source bucket
#
# Caveats:
#   - local-fs provider is single-writer (cas:true, durable:true,
#     concurrent:false). DO NOT run multiple hubs against the same root
#     simultaneously. Fine for a single dev hub.
#   - Subsequent re-runs overwrite divergent files and delete local-only
#     files (gsutil rsync -d semantics). Check in git or back up your
#     root before running if you've been writing locally.
#   - AuditStore + NotificationStore are not yet migrated to the
#     repository pattern — they live in-memory on local-fs backend and
#     reset on hub restart. Entity state (tasks, threads, missions, ...)
#     IS durable across restart.
#

set -euo pipefail

BUCKET="${GCS_BUCKET:-gs://ois-relay-hub-state}"
ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/local-state}"

if ! command -v gsutil >/dev/null 2>&1; then
  echo "[state-sync] ERROR: gsutil not found in PATH. Install the Google Cloud SDK." >&2
  exit 1
fi

mkdir -p "$ROOT"

echo "[state-sync] Source: ${BUCKET}"
echo "[state-sync] Target: ${ROOT}"
echo "[state-sync] Syncing (parallel, -d deletes local-only files to match source exactly)..."

# -m parallel; -d delete-local-only (mirror semantics); -r recursive.
gsutil -m rsync -r -d "${BUCKET}/" "${ROOT}/"

# Summary
COUNT=$(find "$ROOT" -type f | wc -l | tr -d ' ')
SIZE=$(du -sh "$ROOT" | cut -f1)
echo "[state-sync] Done: ${COUNT} file(s), ${SIZE} total"
echo ""
echo "To use with a local hub:"
echo "  export STORAGE_BACKEND=local-fs"
echo "  export OIS_LOCAL_FS_ROOT=${ROOT}"
echo "  (cd hub && npm run dev)"
