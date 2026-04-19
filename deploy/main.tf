# ══════════════════════════════════════════════════════════════════════
# OIS Agentic Network — GCP Infrastructure
#
# Idempotent Terraform plan for deploying the full system:
#   - GCS bucket (state store)
#   - Artifact Registry (Docker images)
#   - Cloud Run: Hub (MCP relay + policy engine)
#   - Cloud Run: Architect (LLM agent + sandwich handlers)
#   - IAM bindings (service account, public access)
#   - Required GCP APIs
#
# Usage:
#   cd deploy/
#   terraform init
#   terraform plan -var-file="env/prod.tfvars"
#   terraform apply -var-file="env/prod.tfvars"
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

# ── Local computed values ─────────────────────────────────────────────

locals {
  registry_prefix = "${var.region}-docker.pkg.dev/${var.project_id}/${var.artifact_repo_name}"

  # Use explicit image if provided, otherwise point to Artifact Registry
  hub_image       = var.hub_image != "" ? var.hub_image : "${local.registry_prefix}/${var.hub_service_name}:latest"
  architect_image = var.architect_image != "" ? var.architect_image : "${local.registry_prefix}/${var.architect_service_name}:latest"

  # Hub URL is computed from the deployed service
  hub_mcp_url = "${google_cloud_run_v2_service.hub.uri}/mcp"
}

# ── GCP APIs ──────────────────────────────────────────────────────────

resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "storage.googleapis.com",
    "artifactregistry.googleapis.com",
    "aiplatform.googleapis.com",
    "cloudbuild.googleapis.com",
  ])

  service            = each.value
  disable_on_destroy = false
}

# ── Service Account ───────────────────────────────────────────────────

resource "google_service_account" "runtime" {
  account_id   = "ois-runtime"
  display_name = "OIS Agentic Network Runtime"
  description  = "Shared service account for Hub and Architect Cloud Run services"
}

resource "google_project_iam_member" "runtime_storage" {
  project = var.project_id
  role    = "roles/storage.objectAdmin"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_project_iam_member" "runtime_vertex" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

# ── GCS Bucket ────────────────────────────────────────────────────────
# On a blank project, Terraform creates this bucket.
# To adopt an existing bucket, run once before apply:
#   terraform import google_storage_bucket.state <bucket-name>
# Either way, data is preserved — force_destroy is false.

resource "google_storage_bucket" "state" {
  name     = var.state_bucket_name
  location = var.region

  uniform_bucket_level_access = true
  force_destroy               = false

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      num_newer_versions = 3
    }
    action {
      type = "Delete"
    }
  }

  labels = {
    environment = var.environment
    system      = "ois-agentic-network"
  }
}

# ── Artifact Registry ─────────────────────────────────────────────────

resource "google_artifact_registry_repository" "images" {
  location      = var.region
  repository_id = var.artifact_repo_name
  format        = "DOCKER"
  description   = "OIS Agentic Network container images"

  labels = {
    environment = var.environment
  }

  depends_on = [google_project_service.apis["artifactregistry.googleapis.com"]]
}

# ── Cloud Run: Hub ────────────────────────────────────────────────────

resource "google_cloud_run_v2_service" "hub" {
  name     = var.hub_service_name
  location = var.region

  template {
    service_account = google_service_account.runtime.email

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
        value = google_storage_bucket.state.name
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

  depends_on = [
    google_project_service.apis["run.googleapis.com"],
    google_project_iam_member.runtime_storage,
  ]
}

# ── Cloud Run: Architect ──────────────────────────────────────────────

resource "google_cloud_run_v2_service" "architect" {
  name     = var.architect_service_name
  location = var.region

  template {
    service_account = google_service_account.runtime.email

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
        value = google_storage_bucket.state.name
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
      # ADR-017 wakeEndpoint: cannot self-reference the Cloud Run
      # service URL (terraform forbids). Left unset in terraform for v1;
      # Hub watchdog's re-dispatch path still works without wake POST
      # (architect's 300s event-loop polls drain the queue on its own
      # schedule; scale-to-zero longer than 300s correctly escalates to
      # Director). Optimization: set ARCHITECT_WAKE_ENDPOINT manually
      # via gcloud run services update, or move Cloud Run URL to a
      # terraform locals + data source in a follow-up.
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
    google_project_service.apis["run.googleapis.com"],
    google_project_iam_member.runtime_storage,
    google_project_iam_member.runtime_vertex,
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
