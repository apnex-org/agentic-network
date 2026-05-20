# ══════════════════════════════════════════════════════════════════════
# deploy/hub/ — thin root caller for the modules/hub/ module
# mission-86 M-Hub-Storage-Cloud-Deploy
#
# This is mission-86's own deployment instance — the first proof-instance
# of the reusable modules/hub/ module (Design v1.3 §4.1). A second
# deployment is another thin root caller pointing `source` at
# ../../modules/hub with different tfvars.
#
# provider {} + backend {} live here (§4.1 discipline #3); all hub logic
# is in the module.
#
# Usage:
#   cd deploy/hub/
#   terraform init
#   terraform plan  -var-file="env/prod.tfvars"
#   GITHUB_TOKEN=$(gh auth token) terraform apply -var-file="env/prod.tfvars"
#
# GITHUB_TOKEN (the github provider) is needed only for the
# github_repository_webhook resource — full-IaC webhook closure (§4.12).
# ══════════════════════════════════════════════════════════════════════

terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    github = {
      source  = "integrations/github"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # GCS state backend — bucket bootstrapped out-of-band at W0 (AG-W0.4).
  backend "gcs" {
    bucket = "labops-389703-tfstate"
    prefix = "hub"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# github provider — registers the Cloud Build webhook on the source repo.
# Auth via the GITHUB_TOKEN env var at apply-time (GITHUB_TOKEN=$(gh auth token)).
provider "github" {
  owner = local.github_owner
}

locals {
  # owner segment of https://github.com/<owner>/<repo>
  github_owner = split("/", replace(var.source_repo_url, "https://github.com/", ""))[0]
}

module "hub" {
  source = "../../modules/hub"

  project_id             = var.project_id
  region                 = var.region
  zone                   = var.zone
  name_prefix            = var.name_prefix
  environment            = var.environment
  hub_image              = var.hub_image
  proxy_image            = var.proxy_image
  postgres_image         = var.postgres_image
  watchtower_image       = var.watchtower_image
  artifact_registry_repo = var.artifact_registry_repo
  source_repo_url        = var.source_repo_url
  source_repo_branch     = var.source_repo_branch
  backup_bucket_name     = var.backup_bucket_name

  enable_cloudbuild_trigger = var.enable_cloudbuild_trigger
}
