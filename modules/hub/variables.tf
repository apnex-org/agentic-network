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
  description = "Boot disk image (Debian 12 per Design §4.2 / OQ-1)"
  type        = string
  default     = "debian-cloud/debian-12"
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
  description = "Cloud Run nginx-proxy CPU limit (Design §4.15: 0.5 vCPU)"
  type        = string
  default     = "0.5"
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
