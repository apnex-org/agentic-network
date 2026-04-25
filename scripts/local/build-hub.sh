#!/usr/bin/env bash
#
# scripts/local/build-hub.sh — Build the Hub container image via Cloud
# Build for the selected env, then pull it locally and tag as
# `ois-hub:local` so scripts/local/start-hub.sh can run it.
#
# Source: hub/ in this repo. Build context is the local hub/ directory;
# you do NOT need to push to GitHub first (gcloud builds submit uploads
# sources).
#
# Idempotent: running twice rebuilds + re-pulls. Remote tag is :latest
# in the selected env's Artifact Registry; local Docker tag is always
# `ois-hub:local` (single tag matches one-hub-at-a-time policy in
# start-hub.sh — switching envs = rebuild + restart).
#
# Usage:
#   OIS_ENV=<env> scripts/local/build-hub.sh
#   scripts/local/build-hub.sh              # OIS_ENV defaults to prod
#
# Env selection (mission-46 T1):
#   OIS_ENV     — selects which tfvars file to read. Default: prod.
#                 Must match ^[a-z][a-z0-9-]*$, max 20 chars.
#   GCP_PROJECT — project id override (takes precedence over tfvars)
#   GCP_REGION  — region override (fallback: australia-southeast1)
#
# tfvars discovery order (first existing wins for OIS_ENV=<env>):
#   1. deploy/cloudrun/env/<env>.tfvars
#   2. deploy/env/<env>.tfvars
#

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# ── Env selection + validation (mission-46 T1) ─────────────────────────

OIS_ENV="${OIS_ENV:-prod}"
if [[ ! "$OIS_ENV" =~ ^[a-z][a-z0-9-]*$ ]] || [[ ${#OIS_ENV} -gt 20 ]]; then
  echo "[build-hub] ERROR: invalid OIS_ENV='$OIS_ENV' — must match ^[a-z][a-z0-9-]*$, max 20 chars." >&2
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

read_tfvar() {
  [[ -z "$TFVARS" ]] && return 0
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

PROJECT_ID="${GCP_PROJECT:-$(read_tfvar project_id)}"
REGION="${GCP_REGION:-$(read_tfvar region)}"
REGION="${REGION:-australia-southeast1}"

if [[ -z "$PROJECT_ID" ]]; then
  echo "[build-hub] ERROR: project_id not resolvable for OIS_ENV='$OIS_ENV'." >&2
  echo "             Populate deploy/cloudrun/env/${OIS_ENV}.tfvars (see .example)," >&2
  echo "             or set GCP_PROJECT env var." >&2
  exit 1
fi

REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/cloud-run-source-deploy"
REMOTE_TAG="${REGISTRY}/hub:latest"
LOCAL_TAG="ois-hub:local"

# ── Storage-provider tarball staging (mission-50 T1) ───────────────────
#
# Hub depends on @ois/storage-provider via a `file:../packages/...` ref
# that works for local dev (`cd hub && npm install`) but not for Cloud
# Build (the build context is hub/ only — `..` escapes the upload).
#
# Pre-build hook: pack storage-provider into hub/ as a tarball, swap
# package.json to a `file:./<tarball>` ref, regenerate package-lock.json
# against the tarball resolution, then let gcloud builds submit upload
# the prepared hub/ directory. Trap on EXIT/INT/TERM/HUP restores
# package.json + package-lock.json and removes the staged tarball, so
# committed state stays clean even on signal interrupt.
#
# TODO(idea-186): When npm workspaces lands, this transient-swap hook
# becomes obsolete — workspaces resolve internal packages without
# tarball staging. Sunset condition: idea-186 ratified + Hub migrated
# to workspace resolution. At that point, delete this entire section,
# the `COPY ois-storage-provider-*.tgz` lines from hub/Dockerfile, and
# the tarball exclusion from hub/.gitignore.

HUB_DIR="$REPO_ROOT/hub"
SP_DIR="$REPO_ROOT/packages/storage-provider"
BACKUP_DIR=""
STAGED_TARBALL=""
SWAP_APPLIED=0

cleanup_tarball_swap() {
  local rc=$?
  trap - EXIT INT TERM HUP
  if [[ $SWAP_APPLIED -eq 1 && -n "$BACKUP_DIR" && -d "$BACKUP_DIR" ]]; then
    [[ -f "$BACKUP_DIR/package.json" ]] && mv -f "$BACKUP_DIR/package.json" "$HUB_DIR/package.json"
    [[ -f "$BACKUP_DIR/package-lock.json" ]] && mv -f "$BACKUP_DIR/package-lock.json" "$HUB_DIR/package-lock.json"
  fi
  if [[ -n "$STAGED_TARBALL" && -f "$STAGED_TARBALL" ]]; then
    rm -f "$STAGED_TARBALL"
  fi
  if [[ -n "$BACKUP_DIR" && -d "$BACKUP_DIR" ]]; then
    rm -rf "$BACKUP_DIR"
  fi
  exit "$rc"
}
trap cleanup_tarball_swap EXIT INT TERM HUP

echo "[build-hub] ──────── Pack storage-provider ────────"
BACKUP_DIR=$(mktemp -d -t build-hub-XXXXXX)
TARBALL_NAME=$( cd "$SP_DIR" && npm pack --pack-destination "$HUB_DIR" --silent )
if [[ -z "$TARBALL_NAME" || ! -f "$HUB_DIR/$TARBALL_NAME" ]]; then
  echo "[build-hub] ERROR: npm pack did not produce a tarball." >&2
  exit 1
fi
STAGED_TARBALL="$HUB_DIR/$TARBALL_NAME"
echo "[build-hub] Tarball: $TARBALL_NAME"

cp "$HUB_DIR/package.json" "$BACKUP_DIR/package.json"
cp "$HUB_DIR/package-lock.json" "$BACKUP_DIR/package-lock.json"
SWAP_APPLIED=1

# Swap file:../packages/storage-provider → file:./<tarball> in hub/package.json.
# The build context for gcloud builds submit is hub/, so the tarball ref
# must resolve relative to hub/.
sed -i.sedbak "s|\"@ois/storage-provider\": \"file:\\.\\./packages/storage-provider\"|\"@ois/storage-provider\": \"file:./${TARBALL_NAME}\"|" "$HUB_DIR/package.json"
rm -f "$HUB_DIR/package.json.sedbak"

if ! grep -q "file:./${TARBALL_NAME}" "$HUB_DIR/package.json"; then
  echo "[build-hub] ERROR: storage-provider ref swap did not take effect in hub/package.json." >&2
  exit 1
fi

echo "[build-hub] ──────── Regen package-lock.json ────────"
# Full `npm install` (NOT `--package-lock-only`) — required for complete
# platform-conditional / optional-dep resolution. bug-37 (closed by T4
# 2026-04-25): `--package-lock-only` produced an incomplete lockfile
# missing 11 `@emnapi/*` entries, causing `npm ci` to fail inside the
# Cloud Build container with `Missing: @emnapi/runtime@... from lock file`.
# Full install populates the platform-conditional graph so `npm ci`
# strict-validation passes. Side-effect: hub/node_modules/ accumulates as
# a cached dev install (already excluded from .gitignore + .gcloudignore;
# does not pollute git status or Cloud Build upload context).
( cd "$HUB_DIR" && npm install --ignore-scripts --no-audit --no-fund --silent )

# ── Build via Cloud Build ──────────────────────────────────────────────

echo "[build-hub] OIS_ENV:  $OIS_ENV"
echo "[build-hub] Project:  $PROJECT_ID"
echo "[build-hub] Region:   $REGION"
echo "[build-hub] Source:   $REPO_ROOT/hub"
echo "[build-hub] Remote:   $REMOTE_TAG"
echo "[build-hub] Local:    $LOCAL_TAG"
echo "[build-hub] ──────── Cloud Build submit ────────"

gcloud builds submit "$REPO_ROOT/hub" \
  --project "$PROJECT_ID" \
  --tag "$REMOTE_TAG" \
  --quiet

# ── Pull + tag locally ─────────────────────────────────────────────────

echo "[build-hub] ──────── Pull + tag local ────────"
docker pull "$REMOTE_TAG"
docker tag "$REMOTE_TAG" "$LOCAL_TAG"

DIGEST=$(docker image inspect "$LOCAL_TAG" --format '{{index .RepoDigests 0}}' 2>/dev/null || echo "<unknown>")
echo "[build-hub] Done. Image:  $LOCAL_TAG"
echo "[build-hub]       Digest: $DIGEST"
echo "[build-hub] Next: OIS_ENV=$OIS_ENV scripts/local/start-hub.sh"
