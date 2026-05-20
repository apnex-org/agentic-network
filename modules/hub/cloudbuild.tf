# ── deploy/hub/ — Layer D: Cloud Build trigger (image CD) ─────────────
# Design §4.12. On apnex-org/agentic-network main-merge, build + push the
# Hub container image (+ the nginx-proxy image) to Artifact Registry;
# Watchtower on the VM then auto-pulls the Hub image within its poll cycle.
#
# W0: disabled = true — the trigger is authored but does NOT fire on
# main-merge. W1 flips var.cloudbuild_trigger_disabled to false.
#
# Prerequisite (W1 apply): the Cloud Build GitHub App must be connected to
# the apnex-org/agentic-network repo (one-time, via Cloud Console) before
# `terraform apply` can create this trigger.

resource "google_cloudbuild_trigger" "hub_image" {
  name        = "hub-image-cd"
  description = "Build + push the Hub + nginx-proxy images on main-merge (mission-86)"
  disabled    = var.cloudbuild_trigger_disabled

  github {
    owner = var.github_owner
    name  = var.github_repo
    push {
      branch = "^main$"
    }
  }

  filename = "cloudbuild.yaml"

  substitutions = {
    _REGISTRY = local.registry_prefix
  }

  depends_on = [google_project_service.apis["cloudbuild.googleapis.com"]]
}
