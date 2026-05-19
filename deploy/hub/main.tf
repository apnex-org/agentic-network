# ══════════════════════════════════════════════════════════════════════
# OIS Agentic Network — Hub VM deployment
# mission-86 M-Hub-Storage-Cloud-Deploy
#
# Third plan in the deploy/ IaC tree (alongside deploy/base/ + deploy/cloudrun/).
# Provisions the production Hub on an internal-only GCE VM:
#   network.tf    Layer C  — custom VPC + subnet + firewall
#   compute.tf    Layer A/C — internal-only e2-small VM; 3-container
#                             docker-compose stack (Hub + Postgres + Watchtower)
#   cloudrun.tf   Layer C  — Cloud Run nginx ingress proxy + Direct VPC Egress
#   storage.tf    Layer B  — GCS backup bucket (hourly postgres snapshots)
#   cloudbuild.tf Layer D  — Cloud Build trigger for Hub image CD
#   iam.tf                 — dedicated least-privilege service accounts
#
# Design: docs/designs/m-hub-storage-cloud-deploy-design.md v1.1 RATIFIED (0715410)
#
# Usage:
#   cd deploy/hub/
#   terraform init
#   terraform plan  -var-file="env/prod.tfvars"
#   terraform apply -var-file="env/prod.tfvars"
#
# State backend (W0 finding F5): this plan uses a GCS backend with native
# state locking. deploy/base/ + deploy/cloudrun/ use local backends, but a
# production VM deployment should not keep state on an operator laptop. The
# state bucket is created out-of-band (bootstrap) before `terraform init` —
# a W0 deliverable (AG-W0.4); see the W0 PR / engineer work-trace.
#
# Foundation reuse (W0 finding F6): deploy/base/ provisions the shared
# Artifact Registry repo. deploy/base/ uses a local backend whose state file
# is not present in every checkout, so this plan does NOT consume base via
# terraform_remote_state — it is self-contained (own service accounts, own
# VPC) and references the shared Artifact Registry by name. No cross-plan
# state coupling; the plan plans/applies from any checkout.
# ══════════════════════════════════════════════════════════════════════

terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }

  # GCS backend — bucket is bootstrapped out-of-band at W0 (AG-W0.4).
  # Multi-env: override `prefix` via `-backend-config` per env.
  backend "gcs" {
    bucket = "labops-389703-tfstate"
    prefix = "hub"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# ── GCP APIs ──────────────────────────────────────────────────────────
# deploy/base/ enables run/storage/artifactregistry/cloudbuild project-wide;
# the Hub VM plan additionally needs Compute Engine, IAP, and the ops-agent
# logging/monitoring APIs. google_project_service is a project-level resource
# and idempotent across plans; disable_on_destroy=false so tearing down this
# plan never disables an API another plan depends on.

resource "google_project_service" "apis" {
  for_each = toset([
    "compute.googleapis.com",
    "run.googleapis.com",
    "cloudbuild.googleapis.com",
    "artifactregistry.googleapis.com",
    "storage.googleapis.com",
    "iap.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
  ])

  service            = each.value
  disable_on_destroy = false
}

# ── Computed values ───────────────────────────────────────────────────

locals {
  # Artifact Registry image prefix — region-docker.pkg.dev/project/repo.
  registry_prefix = "${var.region}-docker.pkg.dev/${var.project_id}/${var.artifact_repo_name}"

  # Hub container image (built by cloudbuild.yaml) + nginx-proxy image.
  hub_image   = var.hub_image != "" ? var.hub_image : "${local.registry_prefix}/hub:latest"
  proxy_image = var.proxy_image != "" ? var.proxy_image : "${local.registry_prefix}/hub-proxy:latest"

  common_labels = {
    environment = var.environment
    system      = "ois-agentic-network"
    mission     = "mission-86"
  }
}
