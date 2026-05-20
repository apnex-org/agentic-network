# ── modules/hub/ — dedicated least-privilege service accounts ─────────
# Design §4.2 + OQ-14. Separate SAs for the VM and the Cloud Run proxy.

# VM service account — GCS backup uploads, Cloud Ops Agent logging/metrics,
# Artifact Registry image pulls.
resource "google_service_account" "hub_vm" {
  account_id   = "${var.name_prefix}-vm-sa"
  display_name = "OIS Hub VM (${var.name_prefix})"
  description  = "Runtime SA for the internal-only Hub VM"
}

resource "google_project_iam_member" "hub_vm_roles" {
  for_each = toset([
    "roles/storage.objectAdmin",     # hourly postgres snapshots → GCS backup bucket
    "roles/logging.logWriter",       # Cloud Ops Agent → Cloud Logging
    "roles/monitoring.metricWriter", # Cloud Ops Agent → Cloud Monitoring
    "roles/artifactregistry.reader", # docker pull of the hub image
  ])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.hub_vm.email}"
}

# Cloud Run nginx-proxy service account. The proxy only forwards HTTP to
# the VM over the VPC — it accesses no GCP resource, so it carries no
# project IAM roles (least-privilege per OQ-14).
resource "google_service_account" "proxy" {
  account_id   = "${var.name_prefix}-proxy-sa"
  display_name = "OIS Hub Cloud Run nginx-proxy (${var.name_prefix})"
  description  = "Runtime SA for the Cloud Run ingress proxy"
}
