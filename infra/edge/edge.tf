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

  # Two per-client-IP limits, each scoped to the path it protects. NOT a
  # blanket limit on every request: one load of the A2UI console pulls dozens
  # of ES modules out of /static/vendor/, so a limit that counts assets ends up
  # banning a human who is simply using the demo. Volumetric attacks are a job
  # for Cloud Armor's always-on L3/L4 protection and Cloud Run's maxScale, not
  # for a request counter that cannot tell a stylesheet from a login attempt.
  #
  # throttle, NOT rate_based_ban: a ban is enforced against the client IP for
  # every path on the policy, so exceeding the limit on /accounts/login/ also
  # denies /favicon.ico and the rest of the site to that address. That is the
  # wrong instrument here — the demo is routinely used from one address by
  # several people, and the expensive behaviour behind it is already bounded by
  # django-axes (per username) and the per-user daily quota. Throttling caps the
  # rate on the protected path and leaves the rest of the site alone.
  # throttle would be the calmer instrument, but the provider cannot clear
  # ban_duration_sec on an existing policy (it is Optional+Computed, so the
  # previous value is re-sent and the API rejects a ban duration on anything
  # that is not rate_based_ban). Scoping the match is what actually fixed the
  # false positives; the ban that remains is 60 s and, since it is only ever
  # tripped by the paths below, does not touch ordinary browsing.
  rule {
    priority = 1000
    action   = "rate_based_ban"
    match {
      expr {
        expression = "request.path.startsWith('/accounts/login')"
      }
    }
    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"
      rate_limit_threshold {
        count        = var.rate_limit_login_per_minute
        interval_sec = 60
      }
      ban_duration_sec = var.rate_limit_ban_seconds
    }
    description = "Sign-in path: credential stuffing"
  }

  rule {
    priority = 1100
    action   = "rate_based_ban"
    match {
      expr {
        expression = "request.path.startsWith('/demo/a2ui/ask')"
      }
    }
    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"
      rate_limit_threshold {
        count        = var.rate_limit_ask_per_minute
        interval_sec = 60
      }
      ban_duration_sec = var.rate_limit_ban_seconds
    }
    description = "Agent path: volumetric abuse (the per-user daily quota is the real bound)"
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
