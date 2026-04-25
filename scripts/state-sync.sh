#!/usr/bin/env bash
#
# state-sync.sh — Mirror GCS hub state to a local directory for use with
# STORAGE_BACKEND=local-fs.
#
# Mission-47 T3 baseline: forward-direction bootstrap (GCS → local).
# Mission-48 T2a extension: post-copy set-equality invariant +
# `.cutover-complete` sentinel + tmp-file exclusion (the same exclusion
# T2c's local→GCS reverse-sync will inherit).
#
# The local-fs StorageProvider reads/writes from a root directory; point
# a laptop-Hub at a gsutil-rsynced snapshot of prod state. Byte-identical
# layout (blobs → files, prefixes → dirs), so this is a one-shot
# bootstrap or refresh-by-rerun.
#
# Usage:
#   ./scripts/state-sync.sh                            # sync to ./local-state/
#   ./scripts/state-sync.sh /custom/root               # custom root dir
#   GCS_BUCKET=gs://other-hub ./scripts/state-sync.sh  # custom source bucket
#
# Caveats:
#   - local-fs provider is single-writer (cas:true, durable:true,
#     concurrent:false). DO NOT run multiple hubs against the same root
#     simultaneously. scripts/local/start-hub.sh enforces one container
#     at a time per host.
#   - Subsequent re-runs overwrite divergent files and delete local-only
#     files (gsutil rsync -d semantics). Check in git or back up your
#     root before running if you've been writing locally.
#   - Mission-49 closed the AuditStore + NotificationStore in-memory gap
#     on local-fs (W8 + W9 Repository migrations); ALL entity state is
#     now durable across Hub restart on local-fs.
#

set -euo pipefail

BUCKET="${GCS_BUCKET:-gs://ois-relay-hub-state}"
BUCKET="${BUCKET%/}"   # normalize: strip any trailing slash so the sed-prefix-strip in the invariant pipeline is unambiguous
ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/local-state}"
SENTINEL="${ROOT}/.cutover-complete"

# Mission-48 T2a: tmp-file exclusion. The local-fs LocalFsStorageProvider
# may leave behind `*.tmp.<suffix>` files on interrupted writes (writeFile
# without rename, or process killed mid-flight). They are NOT part of the
# logical keyspace — `LocalFsStorageProvider.list()` already filters them
# out. The bootstrap direction (this script's forward path) defensively
# excludes them so a stray .tmp.* in GCS — possible only if a future
# reverse-sync ever leaks one — never lands on disk for the laptop-Hub.
# T2c reverse-sync inherits the same exclusion to keep .tmp.* artifacts
# off GCS by construction.
TMP_FILE_EXCLUDE_REGEX='.*\.tmp\..*'

# Sentinel + writability-probe + cutover-marker artifacts must NEVER be
# part of the keyspace comparison — they're operator metadata, not Hub
# state.
SCRIPT_ARTIFACT_REGEX='^\.(cutover-complete|hub-writability-|start-hub-writability-).*'

if ! command -v gsutil >/dev/null 2>&1; then
  echo "[state-sync] ERROR: gsutil not found in PATH. Install the Google Cloud SDK." >&2
  exit 1
fi

mkdir -p "$ROOT"

echo "[state-sync] Source: ${BUCKET}"
echo "[state-sync] Target: ${ROOT}"
echo "[state-sync] Excluding tmp files matching: ${TMP_FILE_EXCLUDE_REGEX}"
echo "[state-sync] Syncing (parallel, -d deletes local-only files to match source)..."

# -m parallel; -d delete-local-only (mirror semantics); -r recursive;
# -x regex exclusion of tmp files (mission-48 T2a addition).
gsutil -m rsync -r -d -x "${TMP_FILE_EXCLUDE_REGEX}" "${BUCKET}/" "${ROOT}/"

# ── Mission-48 T2a: post-copy set-equality invariant ─────────────────
#
# gsutil rsync's exit code captures most failure modes (network errors,
# auth failures, partial-byte counts). It does NOT robustly catch
# "interrupted partway through a multi-file batch with --no-verify" or
# similar edge cases where the local tree is structurally divergent
# from the source. The invariant below is the load-bearing check:
# enumerate both keyspaces, normalize, compare. Sentinel (next block)
# only writes after invariant passes.

echo "[state-sync] Verifying set-equality (post-copy invariant)..."

# Build sorted relative-key lists from both sides.
#
# `gsutil ls -r gs://bucket/` output mixes:
#   gs://bucket/foo/file.json     — actual blob (KEEP)
#   gs://bucket/foo/:             — prefix/directory marker (DROP — ends in :)
#   <blank line>                  — separator (DROP)
# Strip bucket prefix; drop markers + blanks + tmp files + script artifacts.
# `|| true` survives the empty-bucket case (`gsutil ls` non-zero exit).
expected_keys_file=$(mktemp)
actual_keys_file=$(mktemp)
trap 'rm -f "${expected_keys_file}" "${actual_keys_file}"' EXIT
( gsutil ls -r "${BUCKET}/" 2>/dev/null || true ) \
  | grep -v ':$' \
  | grep -v '^$' \
  | sed "s|^${BUCKET}/||" \
  | grep -Ev "${TMP_FILE_EXCLUDE_REGEX}" \
  | grep -Ev "${SCRIPT_ARTIFACT_REGEX}" \
  | sort \
  > "${expected_keys_file}"

# `find -type f` output: ./path/to/file.json — strip ./ prefix.
# Drop tmp files + script artifacts (the sentinel itself must not be
# in the diff or it would re-fail the invariant on subsequent runs).
( cd "${ROOT}" && find . -type f ) \
  | sed 's|^\./||' \
  | grep -Ev "${TMP_FILE_EXCLUDE_REGEX}" \
  | grep -Ev "${SCRIPT_ARTIFACT_REGEX}" \
  | sort \
  > "${actual_keys_file}"

if ! diff_output=$(diff "${expected_keys_file}" "${actual_keys_file}"); then
  echo "[state-sync] INVARIANT FAILED — set-equality between GCS and ${ROOT} is broken." >&2
  echo "[state-sync]" >&2
  echo "[state-sync] Diff (< = GCS-only / missing locally; > = local-only / unexpected):" >&2
  echo "${diff_output}" | sed 's/^/[state-sync]   /' >&2
  echo "[state-sync]" >&2
  echo "[state-sync] Possible causes:" >&2
  echo "[state-sync]   - rsync was interrupted; rerun this script to retry." >&2
  echo "[state-sync]   - GCS bucket was modified during sync; rerun to converge." >&2
  echo "[state-sync]   - Local writes happened during sync (only safe if Hub was stopped)." >&2
  echo "[state-sync]   - .tmp.* file leaked from a reverse-sync (should be excluded — file a bug)." >&2
  echo "[state-sync] Sentinel NOT updated; cutover NOT validated." >&2
  exit 1
fi

# ── Mission-48 T2a: .cutover-complete sentinel ───────────────────────
#
# Write the sentinel ONLY after the invariant passes. T2b's Hub-side
# startup will refuse to flip to STORAGE_BACKEND=local-fs without a
# fresh sentinel — fail-fast guard against a half-bootstrapped state.

cat > "${SENTINEL}" <<EOF
# state-sync.sh cutover sentinel — mission-48 T2a
# Written ONLY after the post-copy set-equality invariant passes.
# Hub-side startup will gate on this file's presence + freshness.
timestamp_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)
gcs_source=${BUCKET}
local_root=${ROOT}
script_commit=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && git rev-parse HEAD 2>/dev/null || echo "unknown")
script_invocation=$(date -u +%s)
EOF

# ── Summary ──────────────────────────────────────────────────────────

COUNT=$(wc -l < "${actual_keys_file}" | tr -d ' ')
SIZE=$(du -sh "$ROOT" | cut -f1)
echo "[state-sync] Invariant green: ${COUNT} key(s) match across GCS + local."
echo "[state-sync] Sentinel written: ${SENTINEL}"
echo "[state-sync] Done: ${COUNT} file(s), ${SIZE} total"
echo ""
echo "To use with a local hub:"
echo "  export STORAGE_BACKEND=local-fs"
echo "  export OIS_LOCAL_FS_ROOT=${ROOT}"
echo "  scripts/local/start-hub.sh"
