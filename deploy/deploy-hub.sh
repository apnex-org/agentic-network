#!/usr/bin/env bash
#
# deploy/deploy-hub.sh — Roll the Cloud Run `hub` service to a specified
# image revision. Pairs with deploy/build-hub.sh (which pushes the image
# to Artifact Registry). Does NOT rebuild — runs `gcloud run services
# update` only; assumes the image is already live in the registry.
#
# Usage:
#   deploy/deploy-hub.sh [--image <full-image-uri>]
#
# Default image:  "<registry>/hub:latest" resolved from the active tfvars.
# Recommended for mission ships: pass the explicit timestamped URI printed
# by deploy/build-hub.sh so the Cloud Run revision carries a traceable
# tag and future terraform apply diff-reviews remain honest.
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
# Requires: gcloud authenticated as a principal with Cloud Run Admin
# permissions on the target project. The specified image must already
# exist in Artifact Registry (run deploy/build-hub.sh first).
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── Parse args ─────────────────────────────────────────────────────────

IMAGE_OVERRIDE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --image)
      IMAGE_OVERRIDE="${2:?--image requires a value}"
      shift 2
      ;;
    -h|--help)
      sed -n '2,29p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "[deploy-hub] Unknown arg: $1" >&2
      echo "[deploy-hub] Usage: deploy/deploy-hub.sh [--image <full-image-uri>]" >&2
      exit 1
      ;;
  esac
done

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
  echo "[deploy-hub] ERROR: project_id not resolvable." >&2
  echo "             Populate deploy/cloudrun/env/prod.tfvars (see .example)," >&2
  echo "             or set GCP_PROJECT env var." >&2
  exit 1
fi

REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/cloud-run-source-deploy"
IMAGE="${IMAGE_OVERRIDE:-${REGISTRY}/hub:latest}"

# ── Print plan (no secrets) ────────────────────────────────────────────

echo "[deploy-hub] Project:       $PROJECT_ID"
echo "[deploy-hub] Region:        $REGION"
echo "[deploy-hub] tfvars source: ${TFVARS:-<none; using env overrides>}"
echo "[deploy-hub] Service:       hub"
echo "[deploy-hub] Image:         $IMAGE"
echo "[deploy-hub] ──────── Cloud Run services update ────────"

# ── Roll the service ───────────────────────────────────────────────────

gcloud run services update hub \
  --image "$IMAGE" \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --quiet

# ── Report the live URL ────────────────────────────────────────────────

SERVICE_URL=$(gcloud run services describe hub \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --format="value(status.url)" 2>/dev/null || true)

echo ""
echo "[deploy-hub] Done."
echo "[deploy-hub]   Service URL:  ${SERVICE_URL:-<unable to resolve>}"
if [[ -n "$SERVICE_URL" ]]; then
  echo "[deploy-hub]   MCP endpoint: ${SERVICE_URL}/mcp"
fi
