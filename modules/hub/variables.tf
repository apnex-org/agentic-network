# ── modules/hub/ — reusable Hub-on-GCE module: input interface ────────
# mission-86 Design v1.3 §4.1. Every project/env-specific value is an
# input; resource names are driven by var.name_prefix. No project/
# registry/repo literals appear anywhere in this module.

# ── Project / location ────────────────────────────────────────────────

variable "project_id" {
  description = "GCP project ID this hub instance deploys into"
  type        = string
}

variable "region" {
  description = "GCP region for all resources"
  type        = string
  default     = "australia-southeast1"
}

variable "zone" {
  description = "GCP zone for the Hub VM"
  type        = string
  default     = "australia-southeast1-a"
}

variable "name_prefix" {
  description = "Prefix for all resource names — multi-instance collision-safety (§4.1 discipline #2)"
  type        = string
  default     = "hub"
}

variable "environment" {
  description = "Environment label (prod / staging / dev)"
  type        = string
  default     = "prod"
}

variable "labels" {
  description = "Extra labels merged onto all labelled resources"
  type        = map(string)
  default     = {}
}

# ── Container images (full Artifact Registry paths) ───────────────────

variable "hub_image" {
  description = "Full Artifact Registry path for the Hub container image"
  type        = string
}

variable "proxy_image" {
  description = "Full Artifact Registry path for the nginx ingress-proxy image"
  type        = string
}

variable "postgres_image" {
  description = "Full Artifact Registry path for the Postgres image (Docker Hub mirror via the AR pull-through remote — internal-only VM, Design v1.5 §4.3)"
  type        = string
}

variable "watchtower_image" {
  description = "Full Artifact Registry path for the Watchtower image (Docker Hub mirror via the AR pull-through remote)"
  type        = string
}

variable "artifact_registry_repo" {
  description = "Artifact Registry repository name — Cloud Build image push-target"
  type        = string
}

# ── Source repo (Cloud Build webhook trigger watch-target) ────────────

variable "source_repo_url" {
  description = "HTTPS URL of the public source repo (https://github.com/<owner>/<repo>)"
  type        = string
}

variable "source_repo_branch" {
  description = "Branch the Cloud Build trigger builds from"
  type        = string
  default     = "main"
}

# ── VM ────────────────────────────────────────────────────────────────

variable "machine_type" {
  description = "GCE machine type for the Hub VM (Design §4.2: e2-small)"
  type        = string
  default     = "e2-small"
}

variable "boot_disk_image" {
  description = "Boot disk image — Container-Optimized OS (Design v1.5 §4.2; Docker pre-installed — F8/B3 OQ-1 Debian→COS reversal)"
  type        = string
  default     = "cos-cloud/cos-stable"
}

variable "data_disk_size_gb" {
  description = "Size of the attached PD-Standard postgres data disk (OQ-12)"
  type        = number
  default     = 20
}

# ── Cloud Run nginx-proxy ─────────────────────────────────────────────

variable "proxy_min_instances" {
  description = "Cloud Run min instances (1 = no cold-start per OQ-18)"
  type        = number
  default     = 1
}

variable "proxy_max_instances" {
  description = "Cloud Run max instances"
  type        = number
  default     = 10
}

variable "proxy_cpu" {
  # bug-197: bumped 0.5->1. cpu>=1 is REQUIRED for containerConcurrency>1 on
  # Cloud Run (fractional CPU pins concurrency to 1). At 0.5/concurrency=1 each
  # long-lived MCP SSE stream consumed a whole instance, so a multi-agent survey
  # burst exhausted the ~10-instance budget and 429'd the org's coordination
  # plane. Live-applied on revision hub-api-00002-5td 2026-06-28; codified here.
  description = "Cloud Run nginx-proxy CPU limit (bug-197: 1 vCPU; cpu>=1 required for concurrency>1)"
  type        = string
  default     = "1"
}

variable "proxy_concurrency" {
  # bug-197: max concurrent requests per instance. 80 (Cloud Run default) so ONE
  # instance multiplexes many long-lived MCP SSE streams + request bursts instead
  # of 1-per-instance. Requires proxy_cpu>=1.
  description = "Cloud Run nginx-proxy max concurrent requests per instance (bug-197: 80)"
  type        = number
  default     = 80
}

variable "proxy_memory" {
  description = "Cloud Run nginx-proxy memory limit (Design §4.15: 128 MB)"
  type        = string
  default     = "128Mi"
}

# ── Watchtower (image-CD poll on the VM) ──────────────────────────────

variable "watchtower_poll_interval" {
  description = "Watchtower image-poll interval in seconds (Design §4.7)"
  type        = number
  default     = 300
}

# ── Network ───────────────────────────────────────────────────────────

variable "vpc_cidr" {
  description = "Primary IPv4 CIDR for the hub subnet"
  type        = string
  default     = "10.10.0.0/24"
}

# ── GCS backup bucket ─────────────────────────────────────────────────

variable "backup_bucket_name" {
  description = "GCS bucket for hourly postgres snapshots — GLOBALLY UNIQUE across GCP"
  type        = string
}

variable "backup_retention_days" {
  description = "Age-based lifecycle delete for snapshots/ objects (Design §4.8)"
  type        = number
  default     = 30
}

# ── Hub runtime secrets / repo-event-bridge (W3 F11 + F13(b)) ─────────

variable "gh_api_token" {
  description = "GitHub PAT (repo / read:org / read:user scopes) for the cloud-Hub repo-event-bridge — provisioned into Secret Manager (F11). Operator-supplied; sensitive; no default."
  type        = string
  sensitive   = true
}

variable "repo_event_bridge_repos" {
  description = "Comma-separated owner/name repos the cloud-Hub repo-event-bridge polls — OIS_REPO_EVENT_BRIDGE_REPOS (F11)"
  type        = string
  default     = "apnex-org/agentic-network"
}

# ── Cloud Build trigger gate (F9) ─────────────────────────────────────

variable "enable_cloudbuild_trigger" {
  description = "Create the Cloud Build webhook trigger + GitHub webhook. W1: false — finding F9 (opaque Cloud Build 400 on webhook_config; deferred per Design v1.6). The trigger is authored + IaC-ready; flip true once F9 is diagnosed (a hard W5/AG-W5.1 prerequisite)."
  type        = bool
  default     = false
}
