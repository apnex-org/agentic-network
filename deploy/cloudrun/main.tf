# ══════════════════════════════════════════════════════════════════════
# OIS Agentic Network — Cloud Run Application Tier
#
# Hub + Architect services + their public-access IAM bindings. Frequently
# redeployed; sometimes destroyed for review or cost control.
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

  hub_image       = var.hub_image != "" ? var.hub_image : "${local.registry_prefix}/${var.hub_service_name}:latest"
  architect_image = var.architect_image != "" ? var.architect_image : "${local.registry_prefix}/${var.architect_service_name}:latest"

  hub_mcp_url = "${google_cloud_run_v2_service.hub.uri}/mcp"
}

# ── Cloud Run: Hub ────────────────────────────────────────────────────

resource "google_cloud_run_v2_service" "hub" {
  name     = var.hub_service_name
  location = var.region

  # v6 provider default is true; set false so `terraform destroy` works
  # without a pre-step apply. Re-enable only for genuinely locked services.
  deletion_protection = false

  template {
    service_account = local.service_account_email

    scaling {
      min_instance_count = var.hub_min_instances
      max_instance_count = var.hub_max_instances
    }

    timeout = "3600s"

    containers {
      image = local.hub_image

      ports {
        container_port = 8080
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "STORAGE_BACKEND"
        value = "gcs"
      }
      env {
        name  = "GCS_BUCKET"
        value = local.state_bucket_name
      }
      env {
        name  = "HUB_API_TOKEN"
        value = var.hub_api_token
      }
      env {
        name  = "WATCHDOG_ENABLED"
        value = var.watchdog_enabled
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
    }
  }

  labels = {
    environment = var.environment
    component   = "hub"
  }
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

  depends_on = [
    google_cloud_run_v2_service.hub, # Architect needs Hub URL
  ]
}

# ── IAM: Public access to Hub ─────────────────────────────────────────
# App-level HUB_API_TOKEN handles authentication.
# Cloud Run IAM just controls network reachability.

resource "google_cloud_run_v2_service_iam_member" "hub_public" {
  count = var.hub_allow_unauthenticated ? 1 : 0

  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.hub.name
  role     = "roles/run.invoker"
  member   = "allUsers"
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
