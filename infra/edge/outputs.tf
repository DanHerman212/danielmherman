output "edge_enabled" {
  value = var.edge_enabled
}

output "dns_points_at_edge" {
  description = "Whether the public records publish the load balancer address."
  value       = var.dns_points_at_edge
}

output "edge_ip" {
  description = "Load balancer IPv4 address (null when it does not exist)."
  value       = local.lb_ip
}

output "certificate_state" {
  value = google_certificate_manager_certificate.edge.managed[0].state
}

output "dns_apex_a" {
  value = google_dns_record_set.apex_a.rrdatas
}

output "dns_www_cname" {
  value = google_dns_record_set.www.rrdatas
}
