#!/usr/bin/env bash
#
# state-sync.sh — Mirror Hub state between GCS and a local directory.
# Forward direction (default): GCS → local-fs (cutover bootstrap).
# Reverse direction (--reverse --yes): local-fs → GCS (rollback / backup).
#
# Mission-47 T3 baseline (forward-only).
# Mission-48 T2a: post-copy set-equality invariant + .cutover-complete
#   sentinel (forward direction).
# Mission-48 T2c: reverse direction added; symmetric invariant; explicit
#   --yes confirmation required for reverse to prevent accidental GCS
#   clobber. Sentinel + writability probes excluded from sync in both
#   directions.
#
# Usage:
#   ./scripts/state-sync.sh                            # forward (default), sync to ./local-state/
#   ./scripts/state-sync.sh /custom/root               # forward with custom root
#   GCS_BUCKET=gs://other-hub ./scripts/state-sync.sh  # forward with custom source bucket
#   ./scripts/state-sync.sh --reverse --yes            # reverse: local-fs → GCS (REQUIRES --yes)
#   ./scripts/state-sync.sh --reverse --yes /custom    # reverse with custom local root
#
# Caveats:
#   - local-fs provider is single-writer (cas:true, durable:true,
#     concurrent:false). DO NOT run multiple hubs against the same root.
#     scripts/local/start-hub.sh enforces one container at a time per host.
#   - rsync -d semantics: target-only files (i.e. files in destination
#     but not in source) are deleted to match source exactly. For
#     reverse direction this means GCS-only files get deleted from GCS
#     unless they're in local-fs — which is the intended rollback
#     behavior, but operators should know.
#   - Reverse direction excludes `.tmp.*` files (LocalFsStorageProvider
#     interrupted-write artifacts) + the `.cutover-complete` sentinel
#     (local-fs-only marker; never propagates to GCS) + writability
#     probe files.
#   - Mission-49 (closed 2026-04-25) migrated AuditStore + NotificationStore
#     to the Repository pattern; ALL entity state is now durable across
#     Hub restart on local-fs.
#

set -euo pipefail

# ── Constants ────────────────────────────────────────────────────────

# Tmp-file pattern: LocalFsStorageProvider may leave behind .tmp.<suffix>
# files on interrupted writes (writeFile without subsequent rename, or
# process killed mid-flight). They are NOT part of the logical keyspace.
TMP_FILE_EXCLUDE_REGEX='.*\.tmp\..*'

# Sentinel filename: written by this script (forward direction only) ONLY
# after the post-copy invariant passes. Hub-side bootstrap-required guard
# (mission-48 T2b, hub/src/lib/cutover-sentinel.ts) gates Hub startup on
# its presence. Sentinel must NEVER cross into GCS via reverse-sync —
# it's a local-fs-only marker; GCS is the canonical state.
SENTINEL_FILENAME='.cutover-complete'

# Writability probe artifacts: dropped by start-hub.sh shell-layer probe
# + Hub-side writability assertion. These are operator metadata, not
# Hub state — exclude from both sync directions and from invariant
# comparison.
SCRIPT_ARTIFACT_REGEX='\.(cutover-complete|hub-writability-|start-hub-writability-)'

# Combined gsutil rsync exclusion (Python regex, re.search semantics):
# matches `.tmp.*` files anywhere + the sentinel + writability probes.
SYNC_EXCLUDE_REGEX="${TMP_FILE_EXCLUDE_REGEX}|${SCRIPT_ARTIFACT_REGEX}"

# ── Argument parsing ──────────────────────────────────────────────────

usage() {
  cat <<USAGE
Usage:
  ./scripts/state-sync.sh [ROOT]                       # forward (GCS → local-fs); default
  ./scripts/state-sync.sh --reverse --yes [ROOT]       # reverse (local-fs → GCS); REQUIRES --yes

Environment:
  GCS_BUCKET    GCS bucket URL; default 'gs://ois-relay-hub-state'.

The reverse direction will overwrite the canonical GCS state from local-fs.
This is the rollback path — accidental invocation is the most expensive
mistake, so --yes is required even when --reverse is set.
USAGE
}

DIRECTION="forward"
CONFIRM_REVERSE=false
ROOT_ARG=""

while (( $# > 0 )); do
  case "$1" in
    --reverse)  DIRECTION="reverse" ;;
    --yes)      CONFIRM_REVERSE=true ;;
    -h|--help)  usage; exit 0 ;;
    -*)         echo "[state-sync] ERROR: unknown flag '$1'" >&2; usage >&2; exit 1 ;;
    *)
      if [[ -z "$ROOT_ARG" ]]; then
        ROOT_ARG="$1"
      else
        echo "[state-sync] ERROR: unexpected positional argument '$1'" >&2
        usage >&2
        exit 1
      fi
      ;;
  esac
  shift
done

if [[ "$DIRECTION" == "reverse" && "$CONFIRM_REVERSE" != true ]]; then
  echo "[state-sync] ERROR: --reverse requires explicit --yes confirmation." >&2
  echo "[state-sync]" >&2
  echo "[state-sync] Reverse direction overwrites the canonical GCS state from local-fs." >&2
  echo "[state-sync] This is the rollback path — accidental invocation is the most expensive mistake." >&2
  echo "[state-sync]" >&2
  echo "[state-sync] Re-run with: scripts/state-sync.sh --reverse --yes [ROOT]" >&2
  exit 1
fi

# ── Resolve paths ─────────────────────────────────────────────────────

BUCKET="${GCS_BUCKET:-gs://ois-relay-hub-state}"
BUCKET="${BUCKET%/}"   # strip trailing slash so the sed-prefix-strip in the invariant pipeline is unambiguous
ROOT="${ROOT_ARG:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/local-state}"
SENTINEL="${ROOT}/${SENTINEL_FILENAME}"

if ! command -v gsutil >/dev/null 2>&1; then
  echo "[state-sync] ERROR: gsutil not found in PATH. Install the Google Cloud SDK." >&2
  exit 1
fi

mkdir -p "$ROOT"

# ── Direction-specific source/target ──────────────────────────────────

case "$DIRECTION" in
  forward)
    SRC_LABEL="${BUCKET}"
    TGT_LABEL="${ROOT}"
    SRC_PATH="${BUCKET}/"
    TGT_PATH="${ROOT}/"
    ;;
  reverse)
    SRC_LABEL="${ROOT}"
    TGT_LABEL="${BUCKET}"
    SRC_PATH="${ROOT}/"
    TGT_PATH="${BUCKET}/"
    ;;
esac

echo "[state-sync] Direction: ${DIRECTION}"
echo "[state-sync] Source:    ${SRC_LABEL}"
echo "[state-sync] Target:    ${TGT_LABEL}"
echo "[state-sync] Excluding: ${SYNC_EXCLUDE_REGEX}"

if [[ "$DIRECTION" == "reverse" ]]; then
  echo "[state-sync] WARNING: reverse direction will overwrite canonical GCS state."
  echo "[state-sync]          --yes confirmation received; proceeding."
fi

echo "[state-sync] Syncing (parallel, -d deletes target-only files to match source)..."

gsutil -m rsync -r -d -x "${SYNC_EXCLUDE_REGEX}" "${SRC_PATH}" "${TGT_PATH}"

# ── Mission-48 T2a/T2c: post-sync set-equality invariant ─────────────
#
# Symmetric for both directions: the GCS keyspace and local keyspace
# must match (modulo exclusions). A failure means the rsync was torn —
# rerun is safe.

echo "[state-sync] Verifying set-equality (post-sync invariant)..."

gcs_keys_file=$(mktemp)
local_keys_file=$(mktemp)
trap 'rm -f "${gcs_keys_file}" "${local_keys_file}"' EXIT

# GCS keys: strip bucket prefix, drop directory markers + blanks,
# drop tmp files + script artifacts. `|| true` survives empty-bucket
# non-zero exit.
( gsutil ls -r "${BUCKET}/" 2>/dev/null || true ) \
  | grep -v ':$' \
  | grep -v '^$' \
  | sed "s|^${BUCKET}/||" \
  | grep -Ev "${TMP_FILE_EXCLUDE_REGEX}" \
  | grep -Ev "${SCRIPT_ARTIFACT_REGEX}" \
  | sort \
  > "${gcs_keys_file}"

# Local keys: strip ./ prefix, drop tmp files + script artifacts.
( cd "${ROOT}" && find . -type f ) \
  | sed 's|^\./||' \
  | grep -Ev "${TMP_FILE_EXCLUDE_REGEX}" \
  | grep -Ev "${SCRIPT_ARTIFACT_REGEX}" \
  | sort \
  > "${local_keys_file}"

if ! diff_output=$(diff "${gcs_keys_file}" "${local_keys_file}"); then
  echo "[state-sync] INVARIANT FAILED — set-equality between GCS and ${ROOT} is broken." >&2
  echo "[state-sync]" >&2
  echo "[state-sync] Diff (< = GCS-only / missing on local; > = local-only / not in GCS):" >&2
  echo "${diff_output}" | sed 's/^/[state-sync]   /' >&2
  echo "[state-sync]" >&2
  case "$DIRECTION" in
    forward)
      echo "[state-sync] Forward direction failure causes:" >&2
      echo "[state-sync]   - rsync was interrupted; rerun this script to retry." >&2
      echo "[state-sync]   - GCS bucket was modified during sync; rerun to converge." >&2
      echo "[state-sync]   - Local writes happened during sync (only safe if Hub was stopped)." >&2
      echo "[state-sync]   - .tmp.* file leaked from a reverse-sync (should be excluded — file a bug)." >&2
      echo "[state-sync] Sentinel NOT updated; cutover NOT validated." >&2
      ;;
    reverse)
      echo "[state-sync] Reverse direction failure causes:" >&2
      echo "[state-sync]   - rsync was interrupted; rerun this script to retry." >&2
      echo "[state-sync]   - Local-fs modified during sync (Hub still running? stop it first)." >&2
      echo "[state-sync]   - GCS write conflict; rerun to converge." >&2
      echo "[state-sync] Reverse direction does NOT touch the local sentinel; rerun is safe." >&2
      ;;
  esac
  exit 1
fi

# ── Direction-specific success path ──────────────────────────────────

case "$DIRECTION" in
  forward)
    # Mission-48 T2a: write the cutover sentinel ONLY after invariant green.
    cat > "${SENTINEL}" <<EOF
# state-sync.sh cutover sentinel — mission-48 T2a
# Written ONLY after the post-copy set-equality invariant passes.
# Hub-side startup will gate on this file's presence + freshness.
direction=forward
timestamp_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)
gcs_source=${BUCKET}
local_root=${ROOT}
script_commit=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && git rev-parse HEAD 2>/dev/null || echo "unknown")
script_invocation=$(date -u +%s)
EOF
    echo "[state-sync] Sentinel written: ${SENTINEL}"
    ;;
  reverse)
    # Mission-48 T2c: reverse direction does NOT touch the sentinel.
    # The sentinel reflects the LAST FORWARD bootstrap (operator's
    # contract: "this state-dir was bootstrapped from GCS at <timestamp>");
    # rewriting it on reverse would mislead future cold-engineer pickup
    # into thinking a fresh bootstrap occurred.
    echo "[state-sync] Reverse-sync complete; local sentinel unchanged at: ${SENTINEL}"
    ;;
esac

# ── Summary ──────────────────────────────────────────────────────────

COUNT=$(wc -l < "${local_keys_file}" | tr -d ' ')
SIZE=$(du -sh "$ROOT" | cut -f1)
echo "[state-sync] Invariant green: ${COUNT} key(s) match across GCS + local."
echo "[state-sync] Done: ${COUNT} file(s), ${SIZE} local total"
echo ""
case "$DIRECTION" in
  forward)
    echo "To use with a local hub:"
    echo "  scripts/local/start-hub.sh   # default backend is now local-fs (mission-48 T2b)"
    ;;
  reverse)
    echo "Reverse-sync done. GCS state now matches the local-fs state at ${ROOT} as of $(date -u +%Y-%m-%dT%H:%M:%SZ)."
    echo "Rollback to GCS-backed Hub:"
    echo "  STORAGE_BACKEND=gcs scripts/local/start-hub.sh"
    ;;
esac
