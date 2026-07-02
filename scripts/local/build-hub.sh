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
#   OIS_ENV     — env label (validation + display). Default: prod.
#                 Must match ^[a-z][a-z0-9-]*$, max 20 chars.
#   GCP_PROJECT — project id override (takes precedence over hub.env)
#   GCP_REGION  — region override (fallback: australia-southeast1)
#
# Config (mission-87 W1 / idea-308): PROJECT_ID + REGION come from
# ~/.config/apnex-agents/hub.env (see scripts/local/hub.env.example).
#

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# ── Config: ~/.config/apnex-agents/hub.env ─────────────────────────────
# Single config source for the local-Hub tooling (mission-87 W1 /
# idea-308): build-hub.sh reads PROJECT_ID + REGION from it. key=value,
# shell-sourced; see scripts/local/hub.env.example. Optional — absent
# file is a no-op; the PROJECT_ID check below catches a missing config.
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
  echo "[build-hub] ERROR: invalid OIS_ENV='$OIS_ENV' — must match ^[a-z][a-z0-9-]*$, max 20 chars." >&2
  exit 1
fi

# ── Project + region (mission-87 W1 / idea-308) ────────────────────────
# Sourced from ~/.config/apnex-agents/hub.env above; GCP_PROJECT /
# GCP_REGION env-vars still override.

PROJECT_ID="${GCP_PROJECT:-${PROJECT_ID:-}}"
REGION="${GCP_REGION:-${REGION:-australia-southeast1}}"

if [[ -z "$PROJECT_ID" ]]; then
  echo "[build-hub] ERROR: PROJECT_ID not set." >&2
  echo "             Set it in ~/.config/apnex-agents/hub.env" >&2
  echo "             (copy scripts/local/hub.env.example), or set GCP_PROJECT." >&2
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
#
# Lib-extracted (M-GitHub-Releases-Plugin-Distribution Design v1.0 §1.4):
# the pack-and-swap-then-restore primitive lives at
# scripts/build/lib/transient-package-swap.sh; consumed by
# release-plugin.yml workflow as well.

HUB_DIR="$REPO_ROOT/hub"

# Sovereign packages staged into hub/ as tarballs for Cloud Build.
# Format: "<package-name>:<source-dir-relative-to-REPO_ROOT>"
SOVEREIGN_PACKAGES=(
  "@apnex/storage-provider:packages/storage-provider"
  "@apnex/repo-event-bridge:packages/repo-event-bridge"
)

source "$REPO_ROOT/scripts/build/lib/transient-package-swap.sh"

# Combined cleanup: restore package.json + remove the staged tarballs
# (tps_cleanup), AND remove the transient build-info.json stamped below
# (C3-R1 M-Roll-Signal / idea-340). Bash traps overwrite per-signal, so a
# single wrapper covers both. HUB_DIR is set above.
hub_build_cleanup() {
  tps_cleanup
  rm -f "$HUB_DIR/build-info.json"
}
trap hub_build_cleanup EXIT INT TERM HUP

swap_workspace_deps_to_tarballs "$HUB_DIR" "${SOVEREIGN_PACKAGES[@]}"

# ── build-info.json — deploy-truth stamp (C3-R1 M-Roll-Signal / idea-340) ─
#
# Stamp the image with the exact source it was built from so prod /health
# can report {gitSha, builtAt} and CI can confirm the new image actually
# rolled (closes the bug-107/DR-011 silent-deploy class). Generated INTO
# the hub/ build context — `gcloud builds submit "$REPO_ROOT/hub"` uploads
# hub/ AS the context (no --build-arg path), hub/Dockerfile COPYs it into
# the prod stage, hub/src/index.ts reads it at boot. Transient: gitignored
# + removed by hub_build_cleanup; regenerated every build. gitSha prefers
# the CI-authoritative GITHUB_SHA (so it equals github.sha for the
# deploy-hub.yml roll-confirm), falls back to local HEAD.
BUILD_GIT_SHA="${GITHUB_SHA:-$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo unknown)}"
BUILD_BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '{"gitSha":"%s","builtAt":"%s"}\n' "$BUILD_GIT_SHA" "$BUILD_BUILT_AT" > "$HUB_DIR/build-info.json"
echo "[build-hub] build-info: gitSha=$BUILD_GIT_SHA builtAt=$BUILD_BUILT_AT"

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

# CI hosts (e.g. .github/workflows/deploy-hub.yml) push the image to
# Artifact Registry and stop here — they don't run the Hub container
# locally, so the docker pull/tag below would be wasted work.
if [[ -n "${CI:-}" ]]; then
  echo "[build-hub] CI detected (CI=$CI); skipping local docker pull/tag."
  echo "[build-hub] Done. Image pushed to $REMOTE_TAG"
  exit 0
fi

# ── Pull + tag locally ─────────────────────────────────────────────────

echo "[build-hub] ──────── Pull + tag local ────────"
docker pull "$REMOTE_TAG"
docker tag "$REMOTE_TAG" "$LOCAL_TAG"

DIGEST=$(docker image inspect "$LOCAL_TAG" --format '{{index .RepoDigests 0}}' 2>/dev/null || echo "<unknown>")
echo "[build-hub] Done. Image:  $LOCAL_TAG"
echo "[build-hub]       Digest: $DIGEST"
echo "[build-hub] Next: OIS_ENV=$OIS_ENV scripts/local/start-hub.sh"
