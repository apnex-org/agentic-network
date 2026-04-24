#!/usr/bin/env bash
#
# build-hub.sh — Build the Hub container image via Cloud Build, then pull it
# locally and tag it `ois-hub:local` so scripts/local/start-hub.sh can run it.
#
# Source: hub/ in this repo. Build context is the local hub/ directory; you
# do NOT need to push to GitHub first (gcloud builds submit uploads sources).
#
# Idempotent: running twice rebuilds + re-pulls. Image tag in Artifact
# Registry is `:latest`; local Docker tag is `ois-hub:local`.
#
# Usage:
#   scripts/local/build-hub.sh
#
# Env overrides:
#   GCP_PROJECT — default: from prod.tfvars project_id
#   GCP_REGION  — default: from prod.tfvars region (or australia-southeast1)
#

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TFVARS="$REPO_ROOT/deploy/env/prod.tfvars"

# ── Read tfvars ────────────────────────────────────────────────────────

if [[ ! -f "$TFVARS" ]]; then
  echo "[build-hub] ERROR: $TFVARS not found." >&2
  echo "             Copy deploy/env/prod.tfvars.example and populate." >&2
  exit 1
fi

read_tfvar() {
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
  echo "[build-hub] ERROR: project_id not set in $TFVARS and GCP_PROJECT unset." >&2
  exit 1
fi

REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/cloud-run-source-deploy"
REMOTE_TAG="${REGISTRY}/hub:latest"
LOCAL_TAG="ois-hub:local"

# ── Build via Cloud Build ──────────────────────────────────────────────

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
echo "[build-hub] Next: scripts/local/start-hub.sh"
