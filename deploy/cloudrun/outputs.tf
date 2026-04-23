output "hub_url" {
  description = "Hub Cloud Run service URL"
  value       = google_cloud_run_v2_service.hub.uri
}

output "hub_mcp_url" {
  description = "Hub MCP endpoint (for plugin config)"
  value       = local.hub_mcp_url
}

output "architect_url" {
  description = "Architect Cloud Run service URL"
  value       = google_cloud_run_v2_service.architect.uri
}

# Deploy-script helpers (Phase 2x P2-7): used by deploy/build.sh to
# force a new Cloud Run revision via `gcloud run services update
# --update-labels=deploy-ts=...`. Terraform leaves the existing
# revision in place when the image tag resolves to the same digest;
# the label bump forces a new ready revision so the new container
# image is actually rolled out.

output "region" {
  description = "GCP region for all Cloud Run services"
  value       = var.region
}

output "hub_service_name" {
  description = "Cloud Run service name for the Hub"
  value       = var.hub_service_name
}

output "architect_service_name" {
  description = "Cloud Run service name for the Architect"
  value       = var.architect_service_name
}

# Passthroughs from base (convenience for deploy/build.sh helpers)

output "state_bucket_name" {
  description = "GCS state bucket name (from base plan)"
  value       = local.state_bucket_name
}

output "registry_prefix" {
  description = "Artifact Registry image prefix (from base plan)"
  value       = local.registry_prefix
}
