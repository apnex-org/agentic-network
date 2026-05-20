# ── modules/hub/ — Layer C: custom VPC + subnet + firewall ────────────
# Design §4.10 / OQ-13. The VM is internal-only (no public IP); reachable
# only via Cloud Run Direct VPC Egress (tcp:8080) and IAP-tunnel SSH (tcp:22).

resource "google_compute_network" "hub_vpc" {
  name                    = "${var.name_prefix}-vpc"
  auto_create_subnetworks = false
  description             = "OIS Hub VPC — internal-only Hub VM"

  depends_on = [google_project_service.apis["compute.googleapis.com"]]
}

resource "google_compute_subnetwork" "hub_subnet" {
  name          = "${var.name_prefix}-subnet"
  ip_cidr_range = var.vpc_cidr
  region        = var.region
  network       = google_compute_network.hub_vpc.id

  # The VM has no public IP — Private Google Access lets it reach Google
  # APIs (Artifact Registry image pulls, GCS backup uploads, Cloud Logging).
  private_ip_google_access = true
}

# Cloud Run (Direct VPC Egress) → VM:8080. Cloud Run instances draw their
# network interface IPs from this subnet, so the subnet CIDR is the proxy's
# source range.
resource "google_compute_firewall" "allow_cloudrun_to_vm" {
  name      = "${var.name_prefix}-allow-cloudrun-to-vm"
  network   = google_compute_network.hub_vpc.id
  direction = "INGRESS"

  allow {
    protocol = "tcp"
    ports    = ["8080"]
  }

  source_ranges = [var.vpc_cidr]
  target_tags   = ["${var.name_prefix}-vm"]
}

# IAP-tunnel SSH → VM:22. 35.235.240.0/20 is Google's canonical IAP range
# (Design §4.10 / OQ-15) — no public-SSH endpoint exists.
resource "google_compute_firewall" "allow_iap_ssh" {
  name      = "${var.name_prefix}-allow-iap-ssh"
  network   = google_compute_network.hub_vpc.id
  direction = "INGRESS"

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  source_ranges = ["35.235.240.0/20"]
  target_tags   = ["${var.name_prefix}-vm"]
}

# Google VPC default-denies all other ingress — no explicit deny-all
# rule is needed (Design §4.10).
