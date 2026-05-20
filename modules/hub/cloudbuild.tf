# ── modules/hub/ — Layer D: Cloud Build webhook trigger (image CD) ────
# Design v1.5 §4.12. On a push to the source repo, GitHub posts to a Cloud
# Build webhook trigger; the trigger builds + pushes the Hub + nginx-proxy
# images to Artifact Registry; Watchtower on the VM auto-pulls the Hub
# image within its poll cycle.
#
# Full-IaC closure: terraform also registers the GitHub repo webhook
# (github_repository_webhook) — ZERO manual webhook steps.
#
# F7: the trigger uses an inline `build {}` block, NOT git_file_source.
# git_file_source repo_type=GITHUB needs a Cloud Build host connection,
# which v1.3 A1 deliberately rejected (webhook-not-GitHub-App). Cloud Build
# has open internet, so the inline build's first step does the
# credential-free public `git clone` itself.

data "google_project" "this" {
  project_id = var.project_id
}

# ── Shared webhook secret ─────────────────────────────────────────────
resource "random_password" "webhook_secret" {
  length  = 32
  special = false # alphanumeric — safe as a URL query-param value
}

resource "google_secret_manager_secret" "webhook_secret" {
  secret_id = "${var.name_prefix}-cloudbuild-webhook-secret"

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis["secretmanager.googleapis.com"]]
}

resource "google_secret_manager_secret_version" "webhook_secret" {
  secret      = google_secret_manager_secret.webhook_secret.id
  secret_data = random_password.webhook_secret.result
}

# Cloud Build's service agent reads the webhook secret to validate
# incoming webhook requests.
resource "google_secret_manager_secret_iam_member" "cloudbuild_webhook_secret" {
  secret_id = google_secret_manager_secret.webhook_secret.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:service-${data.google_project.this.number}@gcp-sa-cloudbuild.iam.gserviceaccount.com"
}

# ── API key for the webhook receiver URL ──────────────────────────────
resource "google_apikeys_key" "webhook" {
  name         = "${var.name_prefix}-cloudbuild-webhook-key"
  display_name = "OIS Hub Cloud Build webhook key (${var.name_prefix})"

  restrictions {
    api_targets {
      service = "cloudbuild.googleapis.com"
    }
  }

  depends_on = [google_project_service.apis["apikeys.googleapis.com"]]
}

# ── Cloud Build webhook trigger (inline build — F7) ───────────────────
resource "google_cloudbuild_trigger" "hub_image" {
  # F9 (Design v1.6): opaque Cloud Build 400 on webhook_config — DEFERRED.
  # Authored + IaC-ready but gated off; flip var.enable_cloudbuild_trigger
  # true once F9 is diagnosed (a hard W5/AG-W5.1 prerequisite).
  count = var.enable_cloudbuild_trigger ? 1 : 0

  name        = "${var.name_prefix}-image-cd"
  description = "Build + push the Hub + nginx-proxy images on ${var.source_repo_branch}-push"

  webhook_config {
    secret = google_secret_manager_secret_version.webhook_secret.id
  }

  build {
    timeout = "1200s"
    options {
      logging = "CLOUD_LOGGING_ONLY"
    }

    # 1. Credential-free clone of the public source repo (Cloud Build has
    #    open internet — this is NOT the internal-only VM).
    step {
      id   = "clone"
      name = "gcr.io/cloud-builders/git"
      args = ["clone", "--depth=1", "--branch", var.source_repo_branch, var.source_repo_url, "."]
    }

    # 2. Stage sovereign packages into hub/ as tarballs (the Hub depends on
    #    them via file:../packages/* refs that don't survive the build
    #    context). Mirrors scripts/local/build-hub.sh.
    step {
      id         = "stage-sovereign-packages"
      name       = "node:22"
      entrypoint = "bash"
      args = ["-c", <<-EOT
        set -euo pipefail
        source scripts/build/lib/transient-package-swap.sh
        swap_workspace_deps_to_tarballs hub \
          "@apnex/storage-provider:packages/storage-provider" \
          "@apnex/repo-event-bridge:packages/repo-event-bridge"
      EOT
      ]
    }

    # 3. Build the Hub image.
    step {
      id   = "build-hub"
      name = "gcr.io/cloud-builders/docker"
      args = ["build", "-t", "${local.registry_prefix}/hub:latest", "hub"]
    }

    # 4. Build the nginx ingress-proxy image.
    step {
      id   = "build-proxy"
      name = "gcr.io/cloud-builders/docker"
      args = ["build", "-t", "${local.registry_prefix}/hub-proxy:latest", "modules/hub/proxy"]
    }

    images = [
      "${local.registry_prefix}/hub:latest",
      "${local.registry_prefix}/hub-proxy:latest",
    ]
  }

  depends_on = [
    google_project_service.apis["cloudbuild.googleapis.com"],
    google_secret_manager_secret_iam_member.cloudbuild_webhook_secret,
  ]
}

# ── GitHub repo webhook (full-IaC closure) ────────────────────────────
locals {
  # Cloud Build webhook receiver URL — what GitHub POSTs push events to.
  # Empty while the trigger is gated off (F9 deferred).
  cloudbuild_webhook_url = var.enable_cloudbuild_trigger ? join("", [
    "https://cloudbuild.googleapis.com/v1/projects/${var.project_id}",
    "/triggers/${google_cloudbuild_trigger.hub_image[0].trigger_id}:webhook",
    "?key=${google_apikeys_key.webhook.key_string}",
    "&secret=${random_password.webhook_secret.result}",
  ]) : ""
}

resource "github_repository_webhook" "hub_image" {
  count = var.enable_cloudbuild_trigger ? 1 : 0

  repository = local.repo_name
  active     = true
  events     = ["push"]

  configuration {
    url          = local.cloudbuild_webhook_url
    content_type = "json"
    insecure_ssl = false
  }
}
