# ── deploy/hub/ — root-caller outputs (mission-86 W4-closeout) ────────
# Re-exports the operator-facing Hub secrets from the hub module so they
# are reachable via `terraform output -raw <name>` from this root plan —
# closing the W4 step-3 "where is the token" gap (the cutover needs
# HUB_API_TOKEN for adapter-config.json hubToken).
#
# Both are sensitive: bare `terraform output` prints <sensitive>; use
# `-raw` to get the value. The values also live in GCP Secret Manager
# (the runtime source the VM reads) + this plan's locked tfstate.

output "hub_api_token" {
  description = "Hub bearer token (HUB_API_TOKEN) — adapter-config.json hubToken for the W4 cutover"
  value       = module.hub.hub_api_token
  sensitive   = true
}

output "admin_token" {
  description = "Hub admin token — drives the hub-token CLI (/admin/tokens)"
  value       = module.hub.admin_token
  sensitive   = true
}
