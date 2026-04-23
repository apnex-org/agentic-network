variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region for all resources"
  type        = string
  default     = "australia-southeast1"
}

variable "environment" {
  description = "Environment label (e.g. prod, staging, dev)"
  type        = string
  default     = "prod"
}

variable "state_bucket_name" {
  description = "GCS bucket for all persisted state"
  type        = string
  default     = "ois-relay-hub-state"
}

variable "artifact_repo_name" {
  description = "Artifact Registry repository name"
  type        = string
  default     = "cloud-run-source-deploy"
}
