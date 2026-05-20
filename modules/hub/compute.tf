# ── modules/hub/ — Layer A/C: internal-only Hub VM ────────────────────
# Design v1.5 §4.2. e2-small, Container-Optimized OS, NO public IP. COS
# ships Docker pre-installed (F8/B3 — OQ-1 Debian→COS reversal); the
# metadata startup script (scripts/startup.sh) bootstraps the 3-container
# stack at first boot. All images pull from Artifact Registry (the VM has
# Google-services-only egress); no Docker / Ops-Agent install needed.

# Static internal IP — the Cloud Run proxy's upstream config points here
# (cloudrun.tf injects it as the HUB_VM_INTERNAL_IP env var).
resource "google_compute_address" "hub_vm" {
  name         = "${var.name_prefix}-vm-ip"
  address_type = "INTERNAL"
  subnetwork   = google_compute_subnetwork.hub_subnet.id
  region       = var.region
}

# Attached PD-Standard data disk — backs the postgres docker volume so
# state survives VM re-creation (Design §4.2 / §4.5 / OQ-12).
resource "google_compute_disk" "hub_data" {
  name = "${var.name_prefix}-vm-data"
  type = "pd-standard"
  size = var.data_disk_size_gb
  zone = var.zone
}

resource "google_compute_instance" "hub_vm" {
  name         = "${var.name_prefix}-vm"
  machine_type = var.machine_type
  zone         = var.zone
  tags         = ["${var.name_prefix}-vm"]

  boot_disk {
    initialize_params {
      image = var.boot_disk_image
      size  = 20
      type  = "pd-balanced"
    }
  }

  attached_disk {
    source      = google_compute_disk.hub_data.id
    device_name = "hub-data"
  }

  # Internal-only — subnetwork attachment with NO access_config block, so
  # the VM gets no public IP (Design §4.2). Reachable via Cloud Run Direct
  # VPC Egress (tcp:8080) + IAP-tunnel SSH (tcp:22) only.
  network_interface {
    subnetwork = google_compute_subnetwork.hub_subnet.id
    network_ip = google_compute_address.hub_vm.address
  }

  service_account {
    email  = google_service_account.hub_vm.email
    scopes = ["cloud-platform"]
  }

  metadata = {
    # Read by scripts/startup.sh from the metadata server at first boot.
    hub-image                = var.hub_image
    postgres-image           = var.postgres_image
    watchtower-image         = var.watchtower_image
    backup-bucket            = var.backup_bucket_name
    watchtower-poll-interval = tostring(var.watchtower_poll_interval)
    enable-oslogin           = "TRUE"
    # COS-native logging + monitoring (replaces the Cloud Ops Agent install).
    google-logging-enabled    = "true"
    google-monitoring-enabled = "true"
  }

  metadata_startup_script = file("${path.module}/scripts/startup.sh")

  labels = local.labels

  depends_on = [
    google_project_service.apis["compute.googleapis.com"],
    google_compute_firewall.allow_iap_ssh,
  ]

  allow_stopping_for_update = true
}
