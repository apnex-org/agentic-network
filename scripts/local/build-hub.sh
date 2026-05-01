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

# ── Sovereign-package tarball staging (mission-50 T1+T5; task-386 ext.) ─
#
# Hub depends on multiple sovereign packages via `file:../packages/...`
# refs in hub/package.json. Those refs work for local dev
# (`cd hub && npm install`) but not for Cloud Build: the build context
# is hub/ only — `..` escapes the upload.
#
# Pre-build hook: for each sovereign package, `npm pack` it into hub/
# as a tarball and rewrite the corresponding `file:../packages/<pkg>`
# ref in a transient hub/package.json swap to `file:./<tarball>`, then
# let `gcloud builds submit hub/` upload the prepared directory. The
# container resolves its own dep tree at build time (Dockerfile uses
# `npm install`, not `npm ci`). A trap on EXIT/INT/TERM/HUP restores
# package.json and removes ALL staged tarballs, so committed state
# stays clean even on signal interrupt.
#
# Adding a sovereign package = append one entry to SOVEREIGN_PACKAGES
# below + add matching `COPY ois-<pkg>-*.tgz ./` lines to hub/Dockerfile
# (both stages) + add matching exclusion to hub/.gitignore + add matching
# `!ois-<pkg>-*.tgz` re-include to hub/.gcloudignore.
#
# Why the script does NOT regenerate hub/package-lock.json (bug-38, T5):
# Earlier mission-50 iterations regenerated the lockfile on the host
# before the gcloud upload (T1: `npm install --package-lock-only`; T4:
# full `npm install`). Both produced lockfiles that were structurally
# fragile against (a) host-vs-container npm/node version drift (host
# npm 11 / node 24 vs container npm 10 / node 22), (b) registry state
# at regen time (different runs produced different @emnapi/* version
# pinnings), and (c) operator-environment variation (different hosts
# produce different lockfiles for identical inputs). The Cloud Build
# container demanded multiple @emnapi/* versions simultaneously that
# host-side regen could not consistently produce. T5 removed host-side
# regen entirely; the container does its own resolution against the
# swap-modified package.json (file:./tarball ref) using its own
# toolchain. Tradeoff: Dockerfile uses `npm install` not `npm ci` for
# the build path, so strict lockfile-validation is removed for that
# path — acceptable because the lockfile was already transient (regen
# per build before T5; never reaching commit-state-strictness anyway)
# and `cd hub && npm install` local dev keeps using the committed
# lockfile via the file:../packages/<pkg> refs.
#
# TODO(idea-186): When npm workspaces lands, this transient-swap hook
# becomes obsolete — workspaces resolve internal packages without
# tarball staging. Sunset condition: idea-186 ratified + Hub migrated
# to workspace resolution. At that point, delete this entire section,
# the `COPY ois-<pkg>-*.tgz` lines from hub/Dockerfile (one per
# sovereign package), the tarball exclusions from hub/.gitignore, and
# hub/.gcloudignore; the Dockerfile's `npm install` reverts to `npm ci`
# for strict lockfile-validation against the committed
# (workspaces-resolved) lockfile.

HUB_DIR="$REPO_ROOT/hub"
BACKUP_DIR=""
STAGED_TARBALLS=()
SWAP_APPLIED=0

# Sovereign packages staged into hub/ as tarballs for Cloud Build.
# Format: "<package-name>:<source-dir-relative-to-REPO_ROOT>"
SOVEREIGN_PACKAGES=(
  "@apnex/storage-provider:packages/storage-provider"
  "@apnex/repo-event-bridge:packages/repo-event-bridge"
)

cleanup_tarball_swap() {
  local rc=$?
  trap - EXIT INT TERM HUP
  if [[ $SWAP_APPLIED -eq 1 && -n "$BACKUP_DIR" && -d "$BACKUP_DIR" ]]; then
    [[ -f "$BACKUP_DIR/package.json" ]] && mv -f "$BACKUP_DIR/package.json" "$HUB_DIR/package.json"
  fi
  if [[ ${#STAGED_TARBALLS[@]} -gt 0 ]]; then
    for tarball in "${STAGED_TARBALLS[@]}"; do
      [[ -f "$tarball" ]] && rm -f "$tarball"
    done
  fi
  if [[ -n "$BACKUP_DIR" && -d "$BACKUP_DIR" ]]; then
    rm -rf "$BACKUP_DIR"
  fi
  exit "$rc"
}
trap cleanup_tarball_swap EXIT INT TERM HUP

BACKUP_DIR=$(mktemp -d -t build-hub-XXXXXX)
cp "$HUB_DIR/package.json" "$BACKUP_DIR/package.json"
SWAP_APPLIED=1

for entry in "${SOVEREIGN_PACKAGES[@]}"; do
  PKG_NAME="${entry%%:*}"
  PKG_SOURCE="${entry#*:}"
  PKG_DIR="$REPO_ROOT/$PKG_SOURCE"

  echo "[build-hub] ──────── Pack $PKG_NAME ────────"
  # Pre-install package devDeps so the `prepare` hook (which runs `tsc`)
  # can succeed during npm pack. Fresh checkouts lack node_modules; the
  # prepare hook's `tsc` needs @types/node + typescript + the package's
  # own deps. Idempotent: subsequent runs no-op if node_modules current.
  ( cd "$PKG_DIR" && npm install --no-audit --no-fund --silent )
  TARBALL_NAME=$( cd "$PKG_DIR" && npm pack --pack-destination "$HUB_DIR" --silent )
  if [[ -z "$TARBALL_NAME" || ! -f "$HUB_DIR/$TARBALL_NAME" ]]; then
    echo "[build-hub] ERROR: npm pack did not produce a tarball for $PKG_NAME." >&2
    exit 1
  fi
  STAGED_TARBALLS+=("$HUB_DIR/$TARBALL_NAME")
  echo "[build-hub] Tarball: $TARBALL_NAME"

  # Swap file:../<pkg-source> → file:./<tarball> in hub/package.json.
  # The build context for gcloud builds submit is hub/, so the tarball
  # ref must resolve relative to hub/. The container resolves its own
  # dep tree at build time via Dockerfile's `npm install` (T5; bug-38).
  sed -i.sedbak "s|\"${PKG_NAME}\": \"file:\\.\\./${PKG_SOURCE}\"|\"${PKG_NAME}\": \"file:./${TARBALL_NAME}\"|" "$HUB_DIR/package.json"
  rm -f "$HUB_DIR/package.json.sedbak"

  if ! grep -q "file:./${TARBALL_NAME}" "$HUB_DIR/package.json"; then
    echo "[build-hub] ERROR: $PKG_NAME ref swap did not take effect in hub/package.json." >&2
    exit 1
  fi
done

echo "[build-hub] Staged ${#STAGED_TARBALLS[@]} tarball(s); package.json refs swapped."

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
