# ── modules/hub/ — Layer B: GCS backup bucket ─────────────────────────
# Design §4.8. The VM-native systemd backup-runner uploads hourly postgres
# snapshots to gs://<bucket>/snapshots/.

resource "google_storage_bucket" "backup" {
  name     = var.backup_bucket_name
  location = var.region

  uniform_bucket_level_access = true
  force_destroy               = false

  versioning {
    enabled = true
  }

  # Age-based retention on snapshot objects (Design §4.8).
  lifecycle_rule {
    condition {
      age            = var.backup_retention_days
      matches_prefix = ["snapshots/"]
    }
    action {
      type = "Delete"
    }
  }

  labels = local.labels
}
