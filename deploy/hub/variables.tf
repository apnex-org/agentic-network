# ── deploy/hub/ — root caller variables ───────────────────────────────
# Per-instance values for mission-86's deployment of modules/hub/.
# Set in env/<env>.tfvars (gitignored). Module-side defaults cover the
# rest of the modules/hub/ interface.

variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region"
  type        = string
  default     = "australia-southeast1"
}

variable "zone" {
  description = "GCP zone for the Hub VM"
  type        = string
  default     = "australia-southeast1-a"
}

variable "name_prefix" {
  description = "Resource-name prefix for this hub instance"
  type        = string
  default     = "hub"
}

variable "environment" {
  description = "Environment label"
  type        = string
  default     = "prod"
}

variable "hub_image" {
  description = "Full Artifact Registry path for the Hub container image"
  type        = string
}

variable "proxy_image" {
  description = "Full Artifact Registry path for the nginx ingress-proxy image"
  type        = string
}

variable "postgres_image" {
  description = "Full Artifact Registry path for the Postgres image (Docker Hub via the AR pull-through remote)"
  type        = string
}

variable "watchtower_image" {
  description = "Full Artifact Registry path for the Watchtower image (Docker Hub via the AR pull-through remote)"
  type        = string
}

variable "artifact_registry_repo" {
  description = "Artifact Registry repository name (Cloud Build push-target)"
  type        = string
}

variable "source_repo_url" {
  description = "HTTPS URL of the public source repo"
  type        = string
}

variable "source_repo_branch" {
  description = "Branch the Cloud Build trigger builds from"
  type        = string
  default     = "main"
}

variable "backup_bucket_name" {
  description = "GCS bucket for hourly postgres snapshots (globally unique)"
  type        = string
}

variable "enable_cloudbuild_trigger" {
  description = "Create the Cloud Build webhook trigger (F9 deferred — false at W1)"
  type        = bool
  default     = false
}

# ── W3 F11 — cloud-Hub repo-event-bridge ──────────────────────────────

variable "gh_api_token" {
  description = "GitHub PAT (repo / read:org / read:user) for the cloud-Hub repo-event-bridge — provisioned into Secret Manager (F11). Set in env/<env>.tfvars (gitignored); sensitive."
  type        = string
  sensitive   = true
}

variable "repo_event_bridge_repos" {
  description = "Comma-separated owner/name repos the cloud-Hub repo-event-bridge polls (F11)"
  type        = string
  default     = "apnex-org/agentic-network"
}
