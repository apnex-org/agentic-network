#!/usr/bin/env bash
#
# start-architect.sh — Bring the Architect agent online.
#
# Sets min-instances=1 so Cloud Run keeps the container warm,
# the SSE stream stays connected, and the 300s event loop runs.
# Restores traffic to the latest revision.
#

set -euo pipefail

SERVICE="architect-agent"
REGION="${GCP_REGION:-australia-southeast1}"

echo "[start] Setting ${SERVICE} min-instances=1 ..."
gcloud run services update "$SERVICE" \
  --min-instances 1 \
  --region "$REGION" \
  --quiet

echo "[start] Routing 100% traffic to latest revision ..."
gcloud run services update-traffic "$SERVICE" \
  --to-latest \
  --region "$REGION" \
  --quiet

URL=$(gcloud run services describe "$SERVICE" --region "$REGION" --format="value(status.url)")
echo "[start] Architect is live at ${URL}"
echo "[start] Waiting for health check ..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${URL}/health" 2>/dev/null || echo "000")
echo "[start] Health: ${HTTP_CODE}"
