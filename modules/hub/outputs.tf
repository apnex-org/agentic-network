# ── modules/hub/ — module outputs (Design v1.3 §4.1) ──────────────────

output "vm_internal_ip" {
  description = "Static internal IP of the Hub VM (no public IP exists)"
  value       = google_compute_address.hub_vm.address
}

output "vm_name" {
  description = "Name of the Hub VM instance"
  value       = google_compute_instance.hub_vm.name
}

output "cloud_run_url" {
  description = "Public HTTPS URL of the Hub ingress proxy — OIS_HUB_URL for adapter shims (W4 cutover)"
  value       = google_cloud_run_v2_service.hub_api.uri
}

output "cloudbuild_webhook_url" {
  description = "Cloud Build webhook receiver URL registered as the GitHub repo webhook (contains key + secret)"
  value       = local.cloudbuild_webhook_url
  sensitive   = true
}

output "backup_bucket" {
  description = "GCS bucket holding hourly postgres snapshots"
  value       = google_storage_bucket.backup.name
}

output "hub_vm_sa_email" {
  description = "Hub VM service account email"
  value       = google_service_account.hub_vm.email
}
