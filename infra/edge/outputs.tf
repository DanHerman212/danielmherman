output "edge_enabled" {
  value = var.edge_enabled
}

output "edge_ip" {
  description = "Load balancer IPv4 address (null when the edge is down)."
  value       = var.edge_enabled ? google_compute_global_address.edge[0].address : null
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
