# ── modules/hub/ — GCP Secret Manager: Hub runtime secrets ────────────
# mission-86 W3 Design v2.0 §4.5.1 (F13(b)) + §4.4 (F11).
#
# POSTGRES_PASSWORD, HUB_API_TOKEN and OIS_GH_API_TOKEN move to GCP Secret
# Manager — terraform-managed, off-disk, centrally rotatable. startup.sh
# fetches all three at every boot via the Secret Manager REST API + the VM
# SA metadata token. This SUPERSEDES the W2 persistent-disk .env (F13(a))
# and closes F13 structurally — secrets survive any VM-replace with zero
# disk dependency.
#
# Mirrors the cloudbuild.tf webhook-secret pattern (secret + version + IAM).
# The secretmanager.googleapis.com API is already enabled in main.tf.

# ── POSTGRES_PASSWORD — terraform-generated ───────────────────────────
resource "random_password" "postgres" {
  length  = 32
  special = false # alphanumeric — safe inside the postgres connection URL
}

resource "google_secret_manager_secret" "postgres_password" {
  secret_id = "${var.name_prefix}-postgres-password"

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis["secretmanager.googleapis.com"]]
}

resource "google_secret_manager_secret_version" "postgres_password" {
  secret      = google_secret_manager_secret.postgres_password.id
  secret_data = random_password.postgres.result
}

# ── HUB_API_TOKEN — terraform-generated ───────────────────────────────
resource "random_password" "hub_api_token" {
  length  = 32
  special = false
}

resource "google_secret_manager_secret" "hub_api_token" {
  secret_id = "${var.name_prefix}-hub-api-token"

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis["secretmanager.googleapis.com"]]
}

resource "google_secret_manager_secret_version" "hub_api_token" {
  secret      = google_secret_manager_secret.hub_api_token.id
  secret_data = random_password.hub_api_token.result
}

# ── OIS_GH_API_TOKEN — operator-supplied GitHub PAT (F11) ─────────────
# A GitHub PAT (repo / read:org / read:user scopes) for the cloud-Hub
# repo-event-bridge. NOT terraform-generated — supplied via the (gitignored,
# sensitive) var.gh_api_token.
resource "google_secret_manager_secret" "gh_api_token" {
  secret_id = "${var.name_prefix}-gh-api-token"

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis["secretmanager.googleapis.com"]]
}

resource "google_secret_manager_secret_version" "gh_api_token" {
  secret      = google_secret_manager_secret.gh_api_token.id
  secret_data = var.gh_api_token
}

# ── VM SA read-access — per-secret (least-privilege per OQ-14) ─────────
# Per-secret grants, NOT a project-level role: the VM SA can read exactly
# these three secrets and no other project secret (e.g. not the Cloud Build
# webhook secret).
resource "google_secret_manager_secret_iam_member" "hub_vm_secrets" {
  for_each = {
    postgres-password = google_secret_manager_secret.postgres_password.id
    hub-api-token     = google_secret_manager_secret.hub_api_token.id
    gh-api-token      = google_secret_manager_secret.gh_api_token.id
  }

  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.hub_vm.email}"
}
