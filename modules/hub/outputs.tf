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

# ── Operator-facing generated secrets (mission-86 W4-closeout) ─────────
# The TF-generated random_password secrets, surfaced as sensitive outputs
# so operators read them via `terraform output -raw <name>` rather than
# having to know the Secret Manager secret-id. `terraform output` alone
# prints <sensitive>; use `-raw`. The values also live in GCP Secret
# Manager (the runtime source the VM reads) + this plan's locked tfstate —
# these outputs are a convenience accessor, not a new exposure surface.

output "hub_api_token" {
  description = "Hub bearer token (HUB_API_TOKEN) — the /mcp grandfather token, used as adapter-config.json hubToken. Read with `terraform output -raw hub_api_token`."
  value       = random_password.hub_api_token.result
  sensitive   = true
}

output "admin_token" {
  description = "Hub admin token guarding /admin/tokens — drives the hub-token CLI. Read with `terraform output -raw admin_token`."
  value       = random_password.admin_token.result
  sensitive   = true
}
