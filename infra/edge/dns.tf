# ---------------------------------------------------------------------------
# Public DNS for the site. These three record sets exist in both states and
# flip between the Cloud Run domain mapping (edge down) and the load balancer
# (edge up). Short TTL so a flip takes effect in five minutes.
#
# They were created during the GoDaddy migration and imported into state:
#   terraform import google_dns_record_set.apex_a    projects/.../rrsets/danielmherman.com./A
#   terraform import google_dns_record_set.apex_aaaa projects/.../rrsets/danielmherman.com./AAAA
#   terraform import google_dns_record_set.www       projects/.../rrsets/www.danielmherman.com./CNAME
# ---------------------------------------------------------------------------

locals {
  # Cloud Run domain-mapping anycast addresses (ghs.googlehosted.com).
  ghs_ipv4 = ["216.239.32.21", "216.239.34.21", "216.239.36.21", "216.239.38.21"]
  ghs_ipv6 = ["2001:4860:4802:32::15", "2001:4860:4802:34::15", "2001:4860:4802:36::15", "2001:4860:4802:38::15"]
}

resource "google_dns_record_set" "apex_a" {
  managed_zone = var.dns_zone
  name         = "${var.domain}."
  type         = "A"
  ttl          = 300
  rrdatas      = var.edge_enabled ? [google_compute_global_address.edge[0].address] : local.ghs_ipv4
}

# The load balancer has an IPv4 address only; drop AAAA while the edge is up.
resource "google_dns_record_set" "apex_aaaa" {
  count        = var.edge_enabled ? 0 : 1
  managed_zone = var.dns_zone
  name         = "${var.domain}."
  type         = "AAAA"
  ttl          = 300
  rrdatas      = local.ghs_ipv6
}

resource "google_dns_record_set" "www" {
  managed_zone = var.dns_zone
  name         = "www.${var.domain}."
  type         = "CNAME"
  ttl          = 300
  rrdatas      = var.edge_enabled ? ["${var.domain}."] : ["ghs.googlehosted.com."]
}
