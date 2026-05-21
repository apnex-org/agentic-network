#!/usr/bin/env bash
#
# deploy-local.sh — Build Docker image locally and deploy to Cloud Run.
# Bypasses Cloud Build entirely. Use when Cloud Build is unavailable.
#
# Usage:
#   ./scripts/deploy-local.sh <service-dir> [service-name]
#
# Examples:
#   ./scripts/deploy-local.sh hub
#   ./scripts/deploy-local.sh hub my-custom-name
#
set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────

PROJECT_ID="${GCP_PROJECT:-labops-389703}"
REGION="${GCP_REGION:-australia-southeast1}"
REPO="cloud-run-source-deploy"
REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}"

SERVICE_DIR="${1:?Usage: deploy-local.sh <service-dir> [service-name]}"
SERVICE_NAME="${2:-$(basename "$SERVICE_DIR")}"
IMAGE="${REGISTRY}/${SERVICE_NAME}"
TAG="$(date +%Y%m%d-%H%M%S)"
FULL_IMAGE="${IMAGE}:${TAG}"

# ── Validate ─────────────────────────────────────────────────────────

if [ ! -d "$SERVICE_DIR" ]; then
  echo "[ERROR] Directory not found: $SERVICE_DIR"
  exit 1
fi

if [ ! -f "$SERVICE_DIR/Dockerfile" ]; then
  echo "[ERROR] No Dockerfile in $SERVICE_DIR"
  exit 1
fi

echo "════════════════════════════════════════════════════════════════"
echo "  Local Deploy: ${SERVICE_NAME}"
echo "  Image:        ${FULL_IMAGE}"
echo "  Region:       ${REGION}"
echo "════════════════════════════════════════════════════════════════"

# ── Build ────────────────────────────────────────────────────────────

echo ""
echo "[1/4] Building Docker image locally..."
docker build -t "${FULL_IMAGE}" -t "${IMAGE}:latest" "${SERVICE_DIR}"

# ── Push ─────────────────────────────────────────────────────────────

echo ""
echo "[2/4] Pushing to Artifact Registry..."
docker push "${FULL_IMAGE}"
docker push "${IMAGE}:latest"

# ── Deploy ───────────────────────────────────────────────────────────

echo ""
echo "[3/4] Deploying to Cloud Run..."
gcloud run deploy "${SERVICE_NAME}" \
  --image "${FULL_IMAGE}" \
  --region "${REGION}" \
  --min-instances 1 \
  --max-instances 1 \
  --timeout=3600 \
  --quiet

# ── Verify ───────────────────────────────────────────────────────────

echo ""
echo "[4/4] Verifying deployment..."
SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --region "${REGION}" \
  --format="value(status.url)" 2>/dev/null)

if [ -n "$SERVICE_URL" ]; then
  echo "  Service URL: ${SERVICE_URL}"
  HEALTH=$(curl -s --max-time 10 "${SERVICE_URL}/health" 2>/dev/null || echo '{"error":"timeout"}')
  echo "  Health:      ${HEALTH}"
else
  echo "  [WARN] Could not retrieve service URL"
fi

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  Deploy complete: ${SERVICE_NAME} → ${TAG}"
echo "════════════════════════════════════════════════════════════════"
