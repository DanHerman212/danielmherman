# ---------------------------------------------------------------------------
# Public DNS for the site. These three record sets exist in both states and
# follow `dns_points_at_edge`, NOT `edge_enabled`: the load balancer can exist
# without the public being sent to it, which is what makes a drain possible.
# Short TTL so a flip takes effect in five minutes.
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

  # Splat rather than index: with edge_enabled = false the resource has no
  # instances, and `edge[0]` would fail at plan time before the precondition
  # below could explain why.
  lb_ip = one(google_compute_global_address.edge[*].address)
}

resource "google_dns_record_set" "apex_a" {
  managed_zone = var.dns_zone
  name         = "${var.domain}."
  type         = "A"
  ttl          = 300
  rrdatas      = var.dns_points_at_edge ? [local.lb_ip] : local.ghs_ipv4

  lifecycle {
    precondition {
      condition     = !var.dns_points_at_edge || var.edge_enabled
      error_message = "dns_points_at_edge = true requires edge_enabled = true: DNS cannot publish a load balancer address that does not exist."
    }
  }
}

# The load balancer has an IPv4 address only; publish AAAA only while DNS is on
# the domain mapping, which does have IPv6.
resource "google_dns_record_set" "apex_aaaa" {
  count        = var.dns_points_at_edge ? 0 : 1
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
  rrdatas      = var.dns_points_at_edge ? ["${var.domain}."] : ["ghs.googlehosted.com."]
}
