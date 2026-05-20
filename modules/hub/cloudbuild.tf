# ── modules/hub/ — Layer D: Cloud Build webhook trigger (image CD) ────
# Design v1.3 §4.12. On a push to the source repo, GitHub posts to a
# Cloud Build webhook trigger; the trigger builds + pushes the Hub +
# nginx-proxy images to Artifact Registry; Watchtower on the VM auto-pulls
# the Hub image within its poll cycle.
#
# Full-IaC closure: terraform also registers the GitHub repo webhook
# (github_repository_webhook) pointing at the trigger — ZERO manual
# webhook steps. The shared secret is generated here (random_password →
# Secret Manager) and wired to both ends.

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
# Cloud Build's webhook receiver URL is authenticated by an API key
# (restricted to the Cloud Build API) plus the shared secret.
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

# ── Cloud Build webhook trigger ───────────────────────────────────────
resource "google_cloudbuild_trigger" "hub_image" {
  name        = "${var.name_prefix}-image-cd"
  description = "Build + push the Hub + nginx-proxy images on ${var.source_repo_branch}-push"

  webhook_config {
    secret = google_secret_manager_secret_version.webhook_secret.id
  }

  source_to_build {
    uri       = var.source_repo_url
    ref       = "refs/heads/${var.source_repo_branch}"
    repo_type = "GITHUB"
  }

  git_file_source {
    path      = "cloudbuild.yaml"
    uri       = var.source_repo_url
    revision  = "refs/heads/${var.source_repo_branch}"
    repo_type = "GITHUB"
  }

  substitutions = {
    _REGISTRY = local.registry_prefix
  }

  depends_on = [
    google_project_service.apis["cloudbuild.googleapis.com"],
    google_secret_manager_secret_iam_member.cloudbuild_webhook_secret,
  ]
}

# ── GitHub repo webhook (full-IaC closure) ────────────────────────────
locals {
  # Cloud Build webhook receiver URL — what GitHub POSTs push events to.
  cloudbuild_webhook_url = join("", [
    "https://cloudbuild.googleapis.com/v1/projects/${var.project_id}",
    "/triggers/${google_cloudbuild_trigger.hub_image.trigger_id}:webhook",
    "?key=${google_apikeys_key.webhook.key_string}",
    "&secret=${random_password.webhook_secret.result}",
  ])
}

resource "github_repository_webhook" "hub_image" {
  repository = local.repo_name
  active     = true
  events     = ["push"]

  configuration {
    url          = local.cloudbuild_webhook_url
    content_type = "json"
    insecure_ssl = false
  }
}
