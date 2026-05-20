# ══════════════════════════════════════════════════════════════════════
# modules/hub/ — reusable Hub-on-GCE deployment module
# mission-86 M-Hub-Storage-Cloud-Deploy
#
# Provisions the production Hub on an internal-only GCE VM. Deployable to
# multiple projects via thin root callers (see deploy/hub/) — every
# project/env value is an input (variables.tf); all resource names are
# driven by var.name_prefix; no hardcoded project/registry/repo literals.
#
#   network.tf    Layer C   — custom VPC + subnet + firewall
#   compute.tf    Layer A/C — internal-only VM; 3-container docker-compose stack
#   cloudrun.tf   Layer C   — Cloud Run nginx ingress proxy + Direct VPC Egress
#   cloudbuild.tf Layer D   — webhook trigger + Secret Manager + github webhook
#   iam.tf                  — dedicated least-privilege service accounts
#   storage.tf    Layer B   — GCS backup bucket (hourly postgres snapshots)
#
# Design: docs/designs/m-hub-storage-cloud-deploy-design.md v1.3 RATIFIED (d6cceea)
#
# Provider + backend config: deploy/hub/ root caller only (§4.1 discipline #3);
# this module declares version constraints in versions.tf.
# ══════════════════════════════════════════════════════════════════════

# ── GCP APIs ──────────────────────────────────────────────────────────
# Project-level + idempotent across plans; disable_on_destroy=false so
# tearing down a hub instance never disables an API another plan needs.

resource "google_project_service" "apis" {
  for_each = toset([
    "compute.googleapis.com",
    "run.googleapis.com",
    "vpcaccess.googleapis.com",
    "cloudbuild.googleapis.com",
    "artifactregistry.googleapis.com",
    "storage.googleapis.com",
    "secretmanager.googleapis.com",
    "apikeys.googleapis.com",
    "iam.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "iap.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
  ])

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

# ── Computed values ───────────────────────────────────────────────────

locals {
  # Artifact Registry image prefix — region-docker.pkg.dev/project/repo.
  registry_prefix = "${var.region}-docker.pkg.dev/${var.project_id}/${var.artifact_registry_repo}"

  # owner/repo derived from the public source-repo URL (single source of
  # truth) — consumed by cloudbuild.tf for the GitHub webhook registration.
  repo_path  = replace(replace(var.source_repo_url, "https://github.com/", ""), ".git", "")
  repo_owner = split("/", local.repo_path)[0]
  repo_name  = split("/", local.repo_path)[1]

  labels = merge(
    {
      system      = "ois-agentic-network"
      component   = "hub"
      environment = var.environment
    },
    var.labels,
  )
}
