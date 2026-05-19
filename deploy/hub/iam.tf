# ── deploy/hub/ — dedicated least-privilege service accounts ──────────
# Design §4.2 + OQ-14. Separate SAs for the VM and the Cloud Run proxy;
# deploy/base/'s shared ois-runtime SA is intentionally NOT reused.

# VM service account — GCS backup uploads, Cloud Ops Agent logging/metrics,
# Artifact Registry image pulls.
resource "google_service_account" "hub_vm" {
  account_id   = var.hub_vm_sa_id
  display_name = "OIS Hub VM (mission-86)"
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
  account_id   = var.proxy_sa_id
  display_name = "OIS Hub Cloud Run nginx-proxy (mission-86)"
  description  = "Runtime SA for the hub-api Cloud Run ingress proxy"
}
