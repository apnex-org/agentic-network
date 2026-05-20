# ── modules/hub/ — Artifact Registry pull-through remote ──────────────
# Design v1.5 §4.3 (F8/B3). The internal-only VM has Google-services-only
# egress — it cannot reach Docker Hub. This remote (pull-through) repo
# proxies Docker Hub; the VM pulls postgres + watchtower images through
# pkg.dev (PGA-reachable). The Hub image itself is built into the standard
# Artifact Registry repo (var.artifact_registry_repo).

resource "google_artifact_registry_repository" "dockerhub_remote" {
  location      = var.region
  repository_id = "${var.name_prefix}-dockerhub-remote"
  format        = "DOCKER"
  mode          = "REMOTE_REPOSITORY"
  description   = "Pull-through Docker Hub proxy for the internal-only Hub VM (mission-86)"

  remote_repository_config {
    docker_repository {
      public_repository = "DOCKER_HUB"
    }
  }

  labels = local.labels

  depends_on = [google_project_service.apis["artifactregistry.googleapis.com"]]
}
