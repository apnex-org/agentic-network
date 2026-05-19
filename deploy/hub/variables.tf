# ── deploy/hub/ — Hub VM deployment plan: input variables ─────────────
# mission-86 M-Hub-Storage-Cloud-Deploy. See main.tf header for overview.
#
# Per-env tfvars convention (mission-46 T1): copy env/prod.tfvars.example
# to env/<env>.tfvars and select with OIS_ENV. env/*.tfvars is gitignored.

# ── Project / location ────────────────────────────────────────────────

variable "project_id" {
  description = "GCP project ID"
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

variable "environment" {
  description = "Environment label (e.g. prod, staging, dev)"
  type        = string
  default     = "prod"
}

# ── Artifact Registry (shared; provisioned by deploy/base/) ───────────

variable "artifact_repo_name" {
  description = "Artifact Registry repo (shared; created by deploy/base/). Holds both the hub and hub-proxy images."
  type        = string
  default     = "cloud-run-source-deploy"
}

variable "hub_image" {
  description = "Full image ref for the Hub container. Empty = <registry>/hub:latest."
  type        = string
  default     = ""
}

variable "proxy_image" {
  description = "Full image ref for the nginx-proxy container. Empty = <registry>/hub-proxy:latest."
  type        = string
  default     = ""
}

# ── VM (Layer A/C — internal-only e2-small) ───────────────────────────

variable "vm_name" {
  description = "Name of the Hub GCE instance"
  type        = string
  default     = "hub-vm"
}

variable "machine_type" {
  description = "GCE machine type for the Hub VM (Design §4.2: e2-small)"
  type        = string
  default     = "e2-small"
}

variable "boot_disk_image" {
  description = "Boot disk image (Debian 12 per Design §4.2 / OQ-1 CONCUR)"
  type        = string
  default     = "debian-cloud/debian-12"
}

variable "data_disk_size_gb" {
  description = "Size of the attached PD-Standard data disk for the postgres volume (Design §4.2 / OQ-12)"
  type        = number
  default     = 20
}

# ── Network (Layer C — custom VPC, internal-only) ─────────────────────

variable "network_name" {
  description = "Name of the custom VPC (Design §4.10 / OQ-13)"
  type        = string
  default     = "hub-vpc"
}

variable "subnet_name" {
  description = "Name of the hub subnet"
  type        = string
  default     = "hub-subnet"
}

variable "subnet_cidr" {
  description = "Primary IPv4 CIDR for the hub subnet"
  type        = string
  default     = "10.10.0.0/24"
}

# ── Cloud Run nginx-proxy (Layer C — ingress + auto-managed TLS) ──────

variable "proxy_service_name" {
  description = "Cloud Run service name for the nginx ingress proxy (Design §4.15)"
  type        = string
  default     = "hub-api"
}

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

# ── GCS backup bucket (Layer B — hourly postgres snapshots) ───────────

variable "backup_bucket_name" {
  description = "GCS bucket for hourly postgres snapshots. GLOBALLY UNIQUE across GCP."
  type        = string
  default     = "labops-389703-hub-backups"
}

variable "backup_retention_days" {
  description = "Age-based lifecycle delete for snapshots/ objects (Design §4.8)"
  type        = number
  default     = 30
}

# ── Service accounts (dedicated; least-privilege per OQ-14) ───────────

variable "hub_vm_sa_id" {
  description = "Account ID for the Hub VM service account"
  type        = string
  default     = "hub-vm-sa"
}

variable "proxy_sa_id" {
  description = "Account ID for the Cloud Run nginx-proxy service account"
  type        = string
  default     = "cloudrun-proxy-sa"
}

# ── Cloud Build trigger (Layer D — image CD) ──────────────────────────

variable "github_owner" {
  description = "GitHub org/owner for the Cloud Build trigger source repo"
  type        = string
  default     = "apnex-org"
}

variable "github_repo" {
  description = "GitHub repo name for the Cloud Build trigger source repo"
  type        = string
  default     = "agentic-network"
}

variable "cloudbuild_trigger_disabled" {
  description = "W0 = true (manual-trigger only); W1 flips to false (fire on main-merge)."
  type        = bool
  default     = true
}
