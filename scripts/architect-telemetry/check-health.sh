#!/usr/bin/env bash
# Architect telemetry health-check — Phase 2x P0-2 (idea-117 follow-on).
#
# Auto-discovers the current architect revision and runs aggregate.py
# against the ratified Phase 2b/2c thresholds in targets.yaml. Suitable
# for scheduling via Cloud Scheduler (or any cron) — emits a loud
# single-line "HEALTHY" / "REGRESSION" marker for log-based alerting.
#
# Exit codes:
#   0 — verdict: pass (all required targets pass)
#   1 — verdict: fail (regression detected — alert Director)
#   2 — infra error (gcloud auth failure, no logs, etc)
#
# Usage:
#   scripts/architect-telemetry/check-health.sh [--freshness 1h]
#   scripts/architect-telemetry/check-health.sh --revision architect-agent-00045-2pb
#   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json ./check-health.sh
#
# Cloud Scheduler recipe (hourly health probe, alerts on regression):
#
#   1. Build a Cloud Run Job that runs this script:
#        gcloud run jobs create architect-telemetry-healthcheck \
#          --image=gcr.io/PROJECT/architect-telemetry-runner:latest \
#          --region=australia-southeast1 \
#          --service-account=telemetry-runner@PROJECT.iam.gserviceaccount.com
#
#   2. Wire Cloud Scheduler to invoke the Job hourly:
#        gcloud scheduler jobs create http architect-telemetry-hourly \
#          --schedule="0 * * * *" \
#          --http-method=POST \
#          --uri="https://run.googleapis.com/apis/run.googleapis.com/v1/namespaces/PROJECT/jobs/architect-telemetry-healthcheck:run" \
#          --oauth-service-account-email=scheduler@PROJECT.iam.gserviceaccount.com
#
#   3. Alert on the REGRESSION line via Cloud Monitoring log-based alert:
#        filter = 'resource.type="cloud_run_job"
#                  textPayload=~"^\[HealthCheck\] REGRESSION"'
#
# Roles/Perms required by the runner SA:
#   - roles/logging.viewer (to read architect Cloud Run logs via aggregate.py)
#   - roles/run.viewer (to discover the latest architect revision)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ARCHITECT_SERVICE="${ARCHITECT_SERVICE:-architect-agent}"
REGION="${REGION:-australia-southeast1}"
FRESHNESS="${FRESHNESS:-1h}"
REVISION=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --freshness) FRESHNESS="$2"; shift 2 ;;
    --revision)  REVISION="$2"; shift 2 ;;
    --service)   ARCHITECT_SERVICE="$2"; shift 2 ;;
    --region)    REGION="$2"; shift 2 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \?//'
      exit 0 ;;
    *)
      echo "[HealthCheck] Unknown arg: $1" >&2
      exit 2 ;;
  esac
done

# Auto-discover latest revision if not supplied
if [[ -z "$REVISION" ]]; then
  REVISION=$(gcloud run services describe "$ARCHITECT_SERVICE" \
    --region="$REGION" \
    --format="value(status.latestReadyRevisionName)" 2>/dev/null || true)
  if [[ -z "$REVISION" ]]; then
    echo "[HealthCheck] ERROR — could not discover latest revision for service=$ARCHITECT_SERVICE region=$REGION" >&2
    exit 2
  fi
fi

echo "[HealthCheck] Probing revision=$REVISION freshness=$FRESHNESS"

# Run the aggregator and capture both verdict + full output. The
# aggregator emits structured text to stdout and uses exit code 0/1/2
# for pass/fail/error. Tee the output so it's visible in log
# inspection + the REGRESSION signal below stays the primary grep
# surface.
OUTPUT_FILE="$(mktemp)"
trap 'rm -f "$OUTPUT_FILE"' EXIT

set +e
"$SCRIPT_DIR/aggregate.py" \
  --revision "$REVISION" \
  --freshness "$FRESHNESS" \
  --thread-prefix thread- \
  --limit 3000 \
  > "$OUTPUT_FILE" 2>&1
AGG_EXIT=$?
set -e

cat "$OUTPUT_FILE"

case "$AGG_EXIT" in
  0)
    echo "[HealthCheck] HEALTHY revision=$REVISION freshness=$FRESHNESS"
    exit 0
    ;;
  1)
    # Extract the failing targets for the alert payload
    FAILED_TARGETS=$(grep '✗' "$OUTPUT_FILE" | head -5 | tr '\n' '|')
    echo "[HealthCheck] REGRESSION revision=$REVISION freshness=$FRESHNESS failed-targets='$FAILED_TARGETS'"
    exit 1
    ;;
  *)
    echo "[HealthCheck] INFRA_ERROR revision=$REVISION freshness=$FRESHNESS agg_exit=$AGG_EXIT"
    exit 2
    ;;
esac
