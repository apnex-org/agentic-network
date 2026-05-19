# ══════════════════════════════════════════════════════════════════════
# OIS Agentic Network — Cloud Run Application Tier
#
# Architect service + its public-access IAM binding. Frequently redeployed;
# sometimes destroyed for review or cost control.
#
# mission-86 (M-Hub-Storage-Cloud-Deploy) retired the dead Hub-on-Cloud-Run
# service block from this plan: Hub-on-Cloud-Run contradicts AG-2 (the Hub
# is a stateful substrate — it runs on the deploy/hub/ VM). The Architect
# service is preserved; its MCP_HUB_URL now comes from var.hub_mcp_url.
#
# Depends on deploy/base/ — reads service account email, bucket name,
# registry prefix via terraform_remote_state. Base plan must be applied
# before this plan can plan/apply.
#
# Usage:
#   cd deploy/cloudrun/
#   terraform init
#   terraform plan -var-file="env/prod.tfvars"
#   terraform apply -var-file="env/prod.tfvars"
#
# Tearing down services only (leaves base intact):
#   terraform destroy -var-file="env/prod.tfvars"
# ══════════════════════════════════════════════════════════════════════

terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# ── Remote state: base plan outputs ──────────────────────────────────

data "terraform_remote_state" "base" {
  backend = "local"

  config = {
    path = "../base/terraform.tfstate"
  }
}

# ── Local computed values ─────────────────────────────────────────────

locals {
  service_account_email = data.terraform_remote_state.base.outputs.service_account_email
  state_bucket_name     = data.terraform_remote_state.base.outputs.state_bucket_name
  registry_prefix       = data.terraform_remote_state.base.outputs.registry_prefix

  architect_image = var.architect_image != "" ? var.architect_image : "${local.registry_prefix}/${var.architect_service_name}:latest"

  # mission-86: Hub-on-Cloud-Run retired — the Architect's Hub endpoint is
  # now an operator-supplied variable (the deploy/hub/ Cloud Run proxy URL).
  hub_mcp_url = var.hub_mcp_url
}

# ── Cloud Run: Architect ──────────────────────────────────────────────

resource "google_cloud_run_v2_service" "architect" {
  name     = var.architect_service_name
  location = var.region

  # v6 provider default is true; set false so `terraform destroy` works
  # without a pre-step apply. Re-enable only for genuinely locked services.
  deletion_protection = false

  template {
    service_account = local.service_account_email

    scaling {
      min_instance_count = var.architect_min_instances
      max_instance_count = var.architect_max_instances
    }

    timeout = "3600s"

    containers {
      image = local.architect_image

      ports {
        container_port = 8080
      }

      env {
        name  = "MCP_HUB_URL"
        value = local.hub_mcp_url
      }
      env {
        name  = "HUB_API_TOKEN"
        value = var.hub_api_token
      }
      env {
        name  = "GCS_BUCKET"
        value = local.state_bucket_name
      }
      env {
        name  = "CONTEXT_PREFIX"
        value = var.architect_context_prefix
      }
      env {
        name  = "EVENT_LOOP_ENABLED"
        value = tostring(var.event_loop_enabled)
      }
      env {
        name  = "EVENT_LOOP_INTERVAL"
        value = tostring(var.event_loop_interval)
      }
      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }
      env {
        name  = "GOOGLE_CLOUD_LOCATION"
        value = var.vertex_ai_location
      }
      env {
        name  = "OIS_GLOBAL_INSTANCE_ID"
        value = var.architect_global_instance_id
      }
      env {
        name  = "OIS_HUB_LABELS"
        value = var.architect_labels
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
      }
    }
  }

  labels = {
    environment = var.environment
    component   = "architect"
  }
}

# ── IAM: Public access to Architect ───────────────────────────────────
# Required for external chat interface access.

resource "google_cloud_run_v2_service_iam_member" "architect_public" {
  count = var.architect_allow_unauthenticated ? 1 : 0

  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.architect.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
