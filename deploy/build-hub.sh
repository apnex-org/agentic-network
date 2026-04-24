#!/usr/bin/env bash
#
# deploy/build-hub.sh — Build the Hub container via Cloud Build and publish
# to Artifact Registry with a timestamped tag + :latest alias.
#
# Scope: build + push only. Does NOT roll Cloud Run — that's a separate
# concern tracked under deploy/README.md §Outstanding. Run this, confirm
# the new image, then roll Cloud Run via terraform apply or gcloud run
# services update (see printed follow-up at the end).
#
# Usage:
#   deploy/build-hub.sh [--tag <tag-suffix>]
#
# Default tag suffix: UTC ISO-compact timestamp (YYYYMMDD-HHMMSS).
# Recommended for mission ships: pass --tag "mission-XX-YYYYMMDD-HHMMSS"
# for easier provenance tracing.
#
# Env overrides (take precedence over tfvars):
#   GCP_PROJECT — project id
#   GCP_REGION  — region (fallback: australia-southeast1)
#
# tfvars discovery order (first existing wins):
#   1. deploy/cloudrun/env/prod.tfvars   (split-structure target)
#   2. deploy/env/prod.tfvars            (local-bootstrap; transitional)
# Both paths are gitignored via deploy/.gitignore. This script reads only
# `project_id` and `region` keys — it never reads, prints, or logs secret
# material such as hub_api_token.
#
# Requires: gcloud authenticated as a principal with Cloud Build + Artifact
# Registry write permissions on the target project.
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── Parse args ─────────────────────────────────────────────────────────

TAG_SUFFIX=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag)
      TAG_SUFFIX="${2:?--tag requires a value}"
      shift 2
      ;;
    -h|--help)
      sed -n '2,31p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "[build-hub] Unknown arg: $1" >&2
      echo "[build-hub] Usage: deploy/build-hub.sh [--tag <tag-suffix>]" >&2
      exit 1
      ;;
  esac
done

TAG_SUFFIX="${TAG_SUFFIX:-$(date -u +%Y%m%d-%H%M%S)}"

# ── Discover tfvars + read project/region ──────────────────────────────

TFVARS=""
for candidate in \
  "$REPO_ROOT/deploy/cloudrun/env/prod.tfvars" \
  "$REPO_ROOT/deploy/env/prod.tfvars"; do
  if [[ -f "$candidate" ]]; then
    TFVARS="$candidate"
    break
  fi
done

read_tfvar() {
  # Extract a single "key = \"value\"" line from a tfvars file. Prints
  # nothing (returns empty) if the key is absent. Does not dump the file.
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
  echo "[build-hub] ERROR: project_id not resolvable." >&2
  echo "             Populate deploy/cloudrun/env/prod.tfvars (see .example)," >&2
  echo "             or set GCP_PROJECT env var." >&2
  exit 1
fi

REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/cloud-run-source-deploy"
IMAGE_TIMESTAMPED="${REGISTRY}/hub:${TAG_SUFFIX}"
IMAGE_LATEST="${REGISTRY}/hub:latest"

# ── Print plan (no secrets) ────────────────────────────────────────────

echo "[build-hub] Project:       $PROJECT_ID"
echo "[build-hub] Region:        $REGION"
echo "[build-hub] tfvars source: ${TFVARS:-<none; using env overrides>}"
echo "[build-hub] Source:        $REPO_ROOT/hub"
echo "[build-hub] Image tag:     $IMAGE_TIMESTAMPED"
echo "[build-hub] Latest alias:  $IMAGE_LATEST"
echo "[build-hub] ──────── Cloud Build submit ────────"

# ── Build + push via Cloud Build ───────────────────────────────────────

gcloud builds submit "$REPO_ROOT/hub" \
  --project "$PROJECT_ID" \
  --tag "$IMAGE_TIMESTAMPED" \
  --quiet

# ── Re-tag :latest to the fresh image ──────────────────────────────────

echo "[build-hub] ──────── Re-tagging :latest ────────"
gcloud artifacts docker tags add \
  "$IMAGE_TIMESTAMPED" \
  "$IMAGE_LATEST" \
  --quiet

# ── Summary + Cloud Run follow-up hint ─────────────────────────────────

echo ""
echo "[build-hub] Done."
echo "[build-hub]   New image:   $IMAGE_TIMESTAMPED"
echo "[build-hub]   :latest →    $IMAGE_TIMESTAMPED"
echo ""
echo "[build-hub] Next — roll Cloud Run to the new image (not performed here):"
echo "[build-hub]   gcloud run services update hub \\"
echo "[build-hub]     --image \"$IMAGE_TIMESTAMPED\" \\"
echo "[build-hub]     --region $REGION \\"
echo "[build-hub]     --project $PROJECT_ID"
