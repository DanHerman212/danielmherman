# ---------------------------------------------------------------------------
# Certificate — PERSISTS across up/down cycles.
#
# Certificate Manager with DNS authorization: the certificate is proven by a
# CNAME record, not by pointing traffic at a load balancer. It is issued once
# and attached to whatever HTTPS proxy exists, so bringing the edge up never
# waits on certificate provisioning.
# ---------------------------------------------------------------------------

resource "google_certificate_manager_dns_authorization" "apex" {
  name   = "danielmherman-apex"
  domain = var.domain
}

resource "google_certificate_manager_dns_authorization" "www" {
  name   = "danielmherman-www"
  domain = "www.${var.domain}"
}

# The CNAME records Certificate Manager asks for. Written to Cloud DNS by
# Terraform so the authorization completes without a manual step.
resource "google_dns_record_set" "cert_auth_apex" {
  managed_zone = var.dns_zone
  name         = google_certificate_manager_dns_authorization.apex.dns_resource_record[0].name
  type         = google_certificate_manager_dns_authorization.apex.dns_resource_record[0].type
  ttl          = 300
  rrdatas      = [google_certificate_manager_dns_authorization.apex.dns_resource_record[0].data]
}

resource "google_dns_record_set" "cert_auth_www" {
  managed_zone = var.dns_zone
  name         = google_certificate_manager_dns_authorization.www.dns_resource_record[0].name
  type         = google_certificate_manager_dns_authorization.www.dns_resource_record[0].type
  ttl          = 300
  rrdatas      = [google_certificate_manager_dns_authorization.www.dns_resource_record[0].data]
}

resource "google_certificate_manager_certificate" "edge" {
  name = "danielmherman-edge"
  managed {
    domains = [var.domain, "www.${var.domain}"]
    dns_authorizations = [
      google_certificate_manager_dns_authorization.apex.id,
      google_certificate_manager_dns_authorization.www.id,
    ]
  }
}

# A certificate map is how a global HTTPS proxy references Certificate Manager.
resource "google_certificate_manager_certificate_map" "edge" {
  name = "danielmherman-edge"
}

resource "google_certificate_manager_certificate_map_entry" "apex" {
  name         = "apex"
  map          = google_certificate_manager_certificate_map.edge.name
  certificates = [google_certificate_manager_certificate.edge.id]
  hostname     = var.domain
}

resource "google_certificate_manager_certificate_map_entry" "www" {
  name         = "www"
  map          = google_certificate_manager_certificate_map.edge.name
  certificates = [google_certificate_manager_certificate.edge.id]
  hostname     = "www.${var.domain}"
}
