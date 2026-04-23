# ══════════════════════════════════════════════════════════════════════
# OIS Agentic Network — Base Infrastructure (foundation tier)
#
# Long-lived resources: project APIs, service account, IAM bindings,
# state GCS bucket, Artifact Registry. Rarely destroyed.
#
# Cloud Run services live in deploy/cloudrun/ — separate plan, separate
# state, reads this plan's outputs via terraform_remote_state.
#
# Usage:
#   cd deploy/base/
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

# ── GCS Bucket (sovereign state backplane) ────────────────────────────
# force_destroy=false ensures Terraform refuses to delete the bucket
# with data in it. Versioning + 3-version lifecycle rule provides
# recovery window for accidental overwrites.

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
