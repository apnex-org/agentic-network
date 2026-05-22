# ── modules/hub/ — Layer C: Cloud Run nginx ingress proxy ─────────────
# Design §4.15. Public HTTPS endpoint (auto-managed *.run.app TLS) that
# reverse-proxies to the internal-only Hub VM over Direct VPC Egress.

resource "google_cloud_run_v2_service" "hub_api" {
  name     = "${var.name_prefix}-api"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  # v6 provider default is true; false so `terraform destroy` works
  # without a pre-step apply.
  deletion_protection = false

  template {
    service_account = google_service_account.proxy.email

    # bug-108: SSE notification streams are long-lived. The Cloud Run
    # default request timeout (300s) force-closed them every ~5 min,
    # driving a reconnect storm. 3600s (the Cloud Run max) cuts that
    # churn ~12x. Matched by the nginx proxy_*_timeout (proxy/default.conf.template).
    timeout = "3600s"

    scaling {
      min_instance_count = var.proxy_min_instances # 1 = no cold-start (OQ-18)
      max_instance_count = var.proxy_max_instances
    }

    # Direct VPC Egress — Cloud Run reaches the internal-only VM via the
    # hub VPC. PRIVATE_RANGES_ONLY keeps public traffic on standard egress
    # (no VPC connector resource / cost).
    vpc_access {
      network_interfaces {
        network    = google_compute_network.hub_vpc.id
        subnetwork = google_compute_subnetwork.hub_subnet.id
      }
      egress = "PRIVATE_RANGES_ONLY"
    }

    containers {
      image = var.proxy_image

      ports {
        container_port = 8080
      }

      # nginx upstream target — the VM's static internal IP. The proxy
      # image's entrypoint substitutes this into the nginx config.
      env {
        name  = "HUB_VM_INTERNAL_IP"
        value = google_compute_address.hub_vm.address
      }

      resources {
        limits = {
          cpu    = var.proxy_cpu
          memory = var.proxy_memory
        }
        # Fractional CPU (<1) requires request-scoped CPU allocation;
        # fine for nginx, which is idle between requests.
        cpu_idle = true
      }
    }
  }

  labels = local.labels

  depends_on = [google_project_service.apis["run.googleapis.com"]]
}

# Public invoker — the proxy is reachable from the internet; request auth
# is enforced at the Hub via bearer token (W3). IAP stays DISABLED for
# this service (Design §4.15; future hub-ui services get IAP per AG-11).
resource "google_cloud_run_v2_service_iam_member" "hub_api_public" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.hub_api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
