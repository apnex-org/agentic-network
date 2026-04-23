output "project_id" {
  description = "GCP project ID (passthrough for downstream plans)"
  value       = var.project_id
}

output "region" {
  description = "GCP region (passthrough for downstream plans)"
  value       = var.region
}

output "environment" {
  description = "Environment label (passthrough for downstream plans)"
  value       = var.environment
}

output "service_account_email" {
  description = "Runtime service account email (consumed by cloudrun plan)"
  value       = google_service_account.runtime.email
}

output "state_bucket_name" {
  description = "GCS state bucket name (consumed by cloudrun plan for GCS_BUCKET env var)"
  value       = google_storage_bucket.state.name
}

output "state_bucket_id" {
  description = "GCS state bucket full resource ID"
  value       = google_storage_bucket.state.id
}

output "artifact_repo_name" {
  description = "Artifact Registry repository name (consumed by cloudrun plan for image refs)"
  value       = google_artifact_registry_repository.images.repository_id
}

output "registry_prefix" {
  description = "Artifact Registry image prefix (region-docker.pkg.dev/project/repo) — consumed by cloudrun plan"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${var.artifact_repo_name}"
}

output "apis_enabled" {
  description = "List of enabled GCP APIs"
  value       = [for svc in google_project_service.apis : svc.service]
}
