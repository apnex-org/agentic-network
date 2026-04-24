#!/usr/bin/env bash
#
# deploy/new-environment-bootstrap.sh — One-shot wrapper that stands up
# a fully isolated new OIS environment from a fresh GCP project.
#
# Mission-46 T2 deliverable. Orchestrates existing tooling; does not
# re-implement it.
#
# Preconditions (operator must complete BEFORE running this script):
#   1. `gcloud projects create <project-id>` — project exists.
#   2. Billing linked to the project.
#   3. `gcloud auth login` — operator authenticated.
#   4. `gcloud auth application-default login` — ADC set for terraform.
#   5. Operator has project-owner (or equivalent) IAM on <project-id>.
#   6. Tools installed: gcloud, terraform (>=1.5), uuidgen, openssl.
#
# What this script does (idempotent end-to-end; safe to re-run):
#   1. Validate inputs (project-id, region, env-name regex).
#   2. Scaffold per-env tfvars files from templates (skip if exist):
#      - deploy/base/env/<env>.tfvars
#      - deploy/cloudrun/env/<env>.tfvars
#      Auto-generates hub_api_token (openssl rand -base64 32) +
#      architect_global_instance_id (uuidgen). Saves them to a local
#      .bootstrap-secrets-<env>.txt file (gitignored) for operator
#      retention.
#   3. Enable the two bootstrap GCP APIs that terraform itself needs
#      (cloudresourcemanager + serviceusage). All other APIs are
#      enabled by the base terraform plan.
#   4. terraform apply in deploy/base/ (idempotent; creates SA, bucket,
#      Artifact Registry, enables remaining APIs).
#   5. Build + push Hub image via deploy/build-hub.sh.
#   6. Build + push Architect image via deploy/build-architect.sh.
#   7. terraform apply in deploy/cloudrun/ (creates hub-<env> +
#      architect-<env> Cloud Run services using the just-pushed :latest
#      images).
#   8. Report the live service URLs from terraform output.
#   9. Optional: generate a local SA key JSON for local-dev (opt-in
#      via --provision-local-key).
#
# Usage:
#   deploy/new-environment-bootstrap.sh \
#     --project-id <gcp-project-id> \
#     --region <gcp-region> \
#     --env <env-name> \
#     [--bucket-name <name>] \
#     [--provision-local-key] \
#     [--skip-build]
#
# Flags:
#   --project-id          GCP project ID (operator must have created this).
#   --region              GCP region (e.g. australia-southeast1).
#   --env                 Env name (^[a-z][a-z0-9-]*$, max 20 chars).
#                         Used in tfvars filename, service names, labels.
#   --bucket-name         State bucket name (default: <project-id>-hub-state).
#                         GCS bucket names are global-namespaced — must be unique.
#   --provision-local-key After base apply, generate a local SA key JSON
#                         at $REPO_ROOT/<project-id>.json for local-dev use
#                         via scripts/local/start-hub.sh. Default: off
#                         (long-lived credentials; opt in explicitly).
#   --skip-build          Skip Hub + Architect image build (phases 5-6).
#                         Useful for re-running cloudrun apply against an
#                         existing registry. Cloud Run plan still applies.
#
# Secrets-safety invariant: generated token + UUID are written ONLY to
# the per-env tfvars files (gitignored) and to .bootstrap-secrets-<env>.txt
# (gitignored). Neither is echoed to stdout or terminal logs.
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── Parse args ─────────────────────────────────────────────────────────

PROJECT_ID=""
REGION=""
ENV_NAME=""
BUCKET_NAME=""
PROVISION_LOCAL_KEY=false
SKIP_BUILD=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-id)
      PROJECT_ID="${2:?--project-id requires a value}"
      shift 2
      ;;
    --region)
      REGION="${2:?--region requires a value}"
      shift 2
      ;;
    --env)
      ENV_NAME="${2:?--env requires a value}"
      shift 2
      ;;
    --bucket-name)
      BUCKET_NAME="${2:?--bucket-name requires a value}"
      shift 2
      ;;
    --provision-local-key)
      PROVISION_LOCAL_KEY=true
      shift
      ;;
    --skip-build)
      SKIP_BUILD=true
      shift
      ;;
    -h|--help)
      sed -n '2,66p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "[bootstrap] Unknown arg: $1" >&2
      echo "[bootstrap] Run with --help to see usage." >&2
      exit 1
      ;;
  esac
done

# ── Validate inputs ────────────────────────────────────────────────────

if [[ -z "$PROJECT_ID" ]]; then
  echo "[bootstrap] ERROR: --project-id is required." >&2
  exit 1
fi
if [[ -z "$REGION" ]]; then
  echo "[bootstrap] ERROR: --region is required." >&2
  exit 1
fi
if [[ -z "$ENV_NAME" ]]; then
  echo "[bootstrap] ERROR: --env is required." >&2
  exit 1
fi
if [[ ! "$ENV_NAME" =~ ^[a-z][a-z0-9-]*$ ]] || [[ ${#ENV_NAME} -gt 20 ]]; then
  echo "[bootstrap] ERROR: invalid --env '$ENV_NAME' — must match ^[a-z][a-z0-9-]*$, max 20 chars." >&2
  exit 1
fi

# Default bucket name if not provided. GCS names must be globally
# unique + meet GCS naming constraints; <project-id>-hub-state is the
# idiomatic shape.
BUCKET_NAME="${BUCKET_NAME:-${PROJECT_ID}-hub-state}"

# ── Tool checks ────────────────────────────────────────────────────────

REQUIRED_TOOLS=("gcloud" "terraform" "uuidgen" "openssl")
MISSING=()
for tool in "${REQUIRED_TOOLS[@]}"; do
  command -v "$tool" >/dev/null 2>&1 || MISSING+=("$tool")
done
if [[ ${#MISSING[@]} -gt 0 ]]; then
  echo "[bootstrap] ERROR: missing required tools: ${MISSING[*]}" >&2
  echo "[bootstrap] Install them and re-run." >&2
  exit 1
fi

# ── gcloud auth sanity check ───────────────────────────────────────────

if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | grep -q . ; then
  echo "[bootstrap] ERROR: no active gcloud auth account." >&2
  echo "[bootstrap] Run: gcloud auth login" >&2
  exit 1
fi

# Application Default Credentials — required for terraform google provider.
if ! gcloud auth application-default print-access-token >/dev/null 2>&1; then
  echo "[bootstrap] ERROR: Application Default Credentials not set (terraform needs ADC)." >&2
  echo "[bootstrap] Run: gcloud auth application-default login" >&2
  exit 1
fi

echo "[bootstrap] ══════════════════════════════════════════════════════"
echo "[bootstrap]   New environment bootstrap — mission-46 T2"
echo "[bootstrap]   Project:      $PROJECT_ID"
echo "[bootstrap]   Region:       $REGION"
echo "[bootstrap]   Env:          $ENV_NAME"
echo "[bootstrap]   State bucket: $BUCKET_NAME"
echo "[bootstrap]   Build images: $([[ "$SKIP_BUILD" == "true" ]] && echo "NO (--skip-build)" || echo "yes")"
echo "[bootstrap]   Local SA key: $([[ "$PROVISION_LOCAL_KEY" == "true" ]] && echo "yes (--provision-local-key)" || echo "no")"
echo "[bootstrap] ══════════════════════════════════════════════════════"

# ── Phase 1/9: scaffold tfvars (idempotent) ────────────────────────────

BASE_TFVARS="$REPO_ROOT/deploy/base/env/${ENV_NAME}.tfvars"
CLOUDRUN_TFVARS="$REPO_ROOT/deploy/cloudrun/env/${ENV_NAME}.tfvars"
SECRETS_FILE="$REPO_ROOT/.bootstrap-secrets-${ENV_NAME}.txt"

echo ""
echo "[bootstrap] Phase 1/9: Scaffold tfvars"

if [[ -f "$BASE_TFVARS" ]]; then
  echo "[bootstrap]   $BASE_TFVARS exists — using existing (idempotent)."
else
  echo "[bootstrap]   Writing $BASE_TFVARS"
  cat > "$BASE_TFVARS" <<TFVARS_EOF
# Generated by deploy/new-environment-bootstrap.sh for env '${ENV_NAME}'.
# Safe to edit; script re-runs skip scaffolding when this file exists.

project_id         = "${PROJECT_ID}"
region             = "${REGION}"
environment        = "${ENV_NAME}"
state_bucket_name  = "${BUCKET_NAME}"
artifact_repo_name = "cloud-run-source-deploy"
TFVARS_EOF
fi

if [[ -f "$CLOUDRUN_TFVARS" ]]; then
  echo "[bootstrap]   $CLOUDRUN_TFVARS exists — using existing (idempotent; secrets not regenerated)."
else
  echo "[bootstrap]   Writing $CLOUDRUN_TFVARS (auto-generating secrets)"
  HUB_API_TOKEN="$(openssl rand -base64 32 | tr -d '\n')"
  ARCHITECT_UUID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
  cat > "$CLOUDRUN_TFVARS" <<TFVARS_EOF
# Generated by deploy/new-environment-bootstrap.sh for env '${ENV_NAME}'.
# Safe to edit; script re-runs skip scaffolding when this file exists.
# Secrets regenerated only when this file is absent (idempotent).

project_id                   = "${PROJECT_ID}"
region                       = "${REGION}"
environment                  = "${ENV_NAME}"

# Per-env service names (mission-46 T1 convention)
hub_service_name             = "hub-${ENV_NAME}"
architect_service_name       = "architect-${ENV_NAME}"

# Secrets (generated by bootstrap; do NOT commit)
hub_api_token                = "${HUB_API_TOKEN}"
architect_global_instance_id = "${ARCHITECT_UUID}"

# Mission-19 routing label stamped on Architect Agent at first create
architect_labels             = "{\"env\":\"${ENV_NAME}\"}"
TFVARS_EOF

  # Save secrets summary for operator retention (gitignored).
  cat > "$SECRETS_FILE" <<SECRETS_EOF
# Bootstrap secrets for env '${ENV_NAME}'
# Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)
# KEEP THIS FILE SECRET. It is gitignored. Do not share.

project_id                   = ${PROJECT_ID}
env                          = ${ENV_NAME}
hub_api_token                = ${HUB_API_TOKEN}
architect_global_instance_id = ${ARCHITECT_UUID}

# Also written to: ${CLOUDRUN_TFVARS}
SECRETS_EOF
  chmod 600 "$SECRETS_FILE"
  echo "[bootstrap]   Secrets summary: $SECRETS_FILE (chmod 600)"
fi

# Add .bootstrap-secrets-* to root .gitignore if not already there.
ROOT_GITIGNORE="$REPO_ROOT/.gitignore"
if [[ -f "$ROOT_GITIGNORE" ]] && ! grep -qxF ".bootstrap-secrets-*.txt" "$ROOT_GITIGNORE"; then
  echo "[bootstrap]   Adding .bootstrap-secrets-*.txt to root .gitignore"
  echo "" >> "$ROOT_GITIGNORE"
  echo "# Mission-46 T2: new-environment-bootstrap.sh secrets summaries" >> "$ROOT_GITIGNORE"
  echo ".bootstrap-secrets-*.txt" >> "$ROOT_GITIGNORE"
fi

# ── Phase 2/9: bootstrap APIs (cloudresourcemanager + serviceusage) ────

echo ""
echo "[bootstrap] Phase 2/9: Enable bootstrap APIs (terraform needs these to enable the rest)"
gcloud services enable \
  cloudresourcemanager.googleapis.com \
  serviceusage.googleapis.com \
  --project="$PROJECT_ID" \
  --quiet

# ── Phase 3/9: terraform apply — base ──────────────────────────────────

echo ""
echo "[bootstrap] Phase 3/9: terraform apply — base (foundation)"
pushd "$REPO_ROOT/deploy/base" >/dev/null
if [[ ! -d .terraform ]]; then
  echo "[bootstrap]   terraform init"
  terraform init -input=false
fi
terraform apply -input=false -auto-approve -var-file="env/${ENV_NAME}.tfvars"

SERVICE_ACCOUNT_EMAIL="$(terraform output -raw service_account_email)"
STATE_BUCKET_NAME="$(terraform output -raw state_bucket_name)"
popd >/dev/null
echo "[bootstrap]   service_account_email = $SERVICE_ACCOUNT_EMAIL"
echo "[bootstrap]   state_bucket_name     = $STATE_BUCKET_NAME"

# ── Phase 4/9: build Hub image ─────────────────────────────────────────

if [[ "$SKIP_BUILD" == "true" ]]; then
  echo ""
  echo "[bootstrap] Phase 4/9: SKIPPED (--skip-build)"
else
  echo ""
  echo "[bootstrap] Phase 4/9: Build Hub image via deploy/build-hub.sh"
  OIS_ENV="$ENV_NAME" "$REPO_ROOT/deploy/build-hub.sh" \
    --tag "bootstrap-${ENV_NAME}-$(date -u +%Y%m%d-%H%M%S)"
fi

# ── Phase 5/9: build Architect image ───────────────────────────────────

if [[ "$SKIP_BUILD" == "true" ]]; then
  echo ""
  echo "[bootstrap] Phase 5/9: SKIPPED (--skip-build)"
else
  echo ""
  echo "[bootstrap] Phase 5/9: Build Architect image via deploy/build-architect.sh"
  OIS_ENV="$ENV_NAME" "$REPO_ROOT/deploy/build-architect.sh" \
    --tag "bootstrap-${ENV_NAME}-$(date -u +%Y%m%d-%H%M%S)"
fi

# ── Phase 6/9: terraform apply — cloudrun ──────────────────────────────

echo ""
echo "[bootstrap] Phase 6/9: terraform apply — cloudrun (Hub + Architect services)"
pushd "$REPO_ROOT/deploy/cloudrun" >/dev/null
if [[ ! -d .terraform ]]; then
  echo "[bootstrap]   terraform init"
  terraform init -input=false
fi
terraform apply -input=false -auto-approve -var-file="env/${ENV_NAME}.tfvars"

HUB_URL="$(terraform output -raw hub_url)"
HUB_MCP_URL="$(terraform output -raw hub_mcp_url)"
ARCHITECT_URL="$(terraform output -raw architect_url)"
popd >/dev/null

# ── Phase 7/9: optional local SA key provisioning ──────────────────────

LOCAL_KEY_PATH=""
if [[ "$PROVISION_LOCAL_KEY" == "true" ]]; then
  echo ""
  echo "[bootstrap] Phase 7/9: Provision local SA key (--provision-local-key)"
  LOCAL_KEY_PATH="$REPO_ROOT/${PROJECT_ID}.json"
  if [[ -f "$LOCAL_KEY_PATH" ]]; then
    echo "[bootstrap]   $LOCAL_KEY_PATH exists — keeping existing (idempotent; rotate manually if needed)."
  else
    echo "[bootstrap]   Generating SA key at $LOCAL_KEY_PATH"
    gcloud iam service-accounts keys create "$LOCAL_KEY_PATH" \
      --iam-account="$SERVICE_ACCOUNT_EMAIL" \
      --project="$PROJECT_ID" \
      --quiet
    chmod 600 "$LOCAL_KEY_PATH"
    echo "[bootstrap]   SA key written (chmod 600). scripts/local/start-hub.sh auto-discovers this path."
    echo "[bootstrap]   SECURITY: this is a long-lived credential. Rotate periodically; do not commit; do not share."
  fi
else
  echo ""
  echo "[bootstrap] Phase 7/9: SKIPPED (--provision-local-key not set)."
  echo "[bootstrap]   Cloud Run services use attached SA; no local key needed for prod operation."
  echo "[bootstrap]   Pass --provision-local-key if you want local Hub dev (scripts/local/start-hub.sh)."
fi

# ── Phase 8/9: terraform state check ───────────────────────────────────

echo ""
echo "[bootstrap] Phase 8/9: Verification"
# Health-check the Hub's /health endpoint if it's reachable.
if command -v curl >/dev/null 2>&1; then
  HEALTH_STATUS="$(curl -s -o /dev/null -w "%{http_code}" "${HUB_URL}/health" 2>/dev/null || echo "000")"
  echo "[bootstrap]   Hub /health HTTP status: $HEALTH_STATUS (200 = healthy; 000 = unreachable)"
fi

# ── Phase 9/9: Report ──────────────────────────────────────────────────

echo ""
echo "[bootstrap] ══════════════════════════════════════════════════════"
echo "[bootstrap]   BOOTSTRAP COMPLETE for env '${ENV_NAME}'"
echo "[bootstrap] ══════════════════════════════════════════════════════"
echo "[bootstrap]"
echo "[bootstrap]   Hub URL:          $HUB_URL"
echo "[bootstrap]   Hub MCP endpoint: $HUB_MCP_URL"
echo "[bootstrap]   Architect URL:    $ARCHITECT_URL"
echo "[bootstrap]"
echo "[bootstrap]   tfvars:           $BASE_TFVARS"
echo "[bootstrap]                     $CLOUDRUN_TFVARS"
if [[ -f "$SECRETS_FILE" ]]; then
  echo "[bootstrap]   Secrets:          $SECRETS_FILE (gitignored; chmod 600)"
fi
if [[ -n "$LOCAL_KEY_PATH" ]]; then
  echo "[bootstrap]   Local SA key:     $LOCAL_KEY_PATH (gitignored; chmod 600)"
fi
echo "[bootstrap]"
echo "[bootstrap]   Next steps:"
echo "[bootstrap]   - Configure your OpenCode / Claude plugin's OIS_HUB_URL to: $HUB_MCP_URL"
echo "[bootstrap]   - Read \$SECRETS_FILE for hub_api_token (set as OIS_HUB_TOKEN in plugin)."
echo "[bootstrap]   - See docs/onboarding/multi-env-operator-setup.md (mission-46 T4) for the"
echo "[bootstrap]     full engineer-side setup runbook."
