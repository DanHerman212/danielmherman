# ---------------------------------------------------------------------------
# The edge — created when edge_enabled = true, destroyed when false.
#
#   internet ─▶ static IP ─▶ HTTPS proxy (cert map) ─▶ URL map
#            ─▶ backend service (Cloud Armor) ─▶ serverless NEG ─▶ Cloud Run
#
# Global external Application Load Balancer: no proxy-instance charge, unlike
# the regional flavour. The Cloud Run service itself is owned by cloudbuild.yaml
# and is only *referenced* here.
# ---------------------------------------------------------------------------

locals {
  edge_count = var.edge_enabled ? 1 : 0
}

resource "google_compute_global_address" "edge" {
  count = local.edge_count
  name  = "danielmherman-edge"
}

resource "google_compute_region_network_endpoint_group" "web" {
  count                 = local.edge_count
  name                  = "danielmherman-web-neg"
  region                = var.region
  network_endpoint_type = "SERVERLESS"
  cloud_run {
    service = var.cloud_run_service
  }
}

# --- Cloud Armor -----------------------------------------------------------

resource "google_compute_security_policy" "edge" {
  count = local.edge_count
  name  = "danielmherman-edge"

  # Per-client-IP rate limit. Exceeding the threshold bans the IP for
  # rate_limit_ban_seconds. Google-managed WAF rules are deliberately not
  # enabled: they are a tuning exercise, and false positives would block the
  # demo. Rate limiting is the requirement; WAF rules are a later choice.
  rule {
    priority = 1000
    action   = "rate_based_ban"
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"
      rate_limit_threshold {
        count        = var.rate_limit_per_minute
        interval_sec = 60
      }
      ban_duration_sec = var.rate_limit_ban_seconds
    }
    description = "Per-IP rate limit"
  }

  rule {
    priority = 2147483647
    action   = "allow"
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    description = "Default allow"
  }
}

# --- Load balancer ---------------------------------------------------------

resource "google_compute_backend_service" "web" {
  count                 = local.edge_count
  name                  = "danielmherman-web"
  protocol              = "HTTPS"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  security_policy       = google_compute_security_policy.edge[0].id
  enable_cdn            = false

  backend {
    group = google_compute_region_network_endpoint_group.web[0].id
  }

  log_config {
    enable      = true
    sample_rate = 1.0
  }
}

resource "google_compute_url_map" "https" {
  count           = local.edge_count
  name            = "danielmherman-https"
  default_service = google_compute_backend_service.web[0].id
}

resource "google_compute_target_https_proxy" "edge" {
  count           = local.edge_count
  name            = "danielmherman-https"
  url_map         = google_compute_url_map.https[0].id
  certificate_map = "//certificatemanager.googleapis.com/${google_certificate_manager_certificate_map.edge.id}"
}

resource "google_compute_global_forwarding_rule" "https" {
  count                 = local.edge_count
  name                  = "danielmherman-https"
  target                = google_compute_target_https_proxy.edge[0].id
  ip_address            = google_compute_global_address.edge[0].address
  port_range            = "443"
  load_balancing_scheme = "EXTERNAL_MANAGED"
}

# HTTP → HTTPS redirect at the edge, so plain-HTTP requests never reach Django.
resource "google_compute_url_map" "http_redirect" {
  count = local.edge_count
  name  = "danielmherman-http-redirect"
  default_url_redirect {
    https_redirect         = true
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    strip_query            = false
  }
}

resource "google_compute_target_http_proxy" "redirect" {
  count   = local.edge_count
  name    = "danielmherman-http-redirect"
  url_map = google_compute_url_map.http_redirect[0].id
}

resource "google_compute_global_forwarding_rule" "http" {
  count                 = local.edge_count
  name                  = "danielmherman-http"
  target                = google_compute_target_http_proxy.redirect[0].id
  ip_address            = google_compute_global_address.edge[0].address
  port_range            = "80"
  load_balancing_scheme = "EXTERNAL_MANAGED"
}
