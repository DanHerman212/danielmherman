variable "project_id" {
  type    = string
  default = "trim-icon-498815-a0"
}

variable "region" {
  type    = string
  default = "us-east1"
}

variable "domain" {
  type    = string
  default = "danielmherman.com"
}

variable "dns_zone" {
  description = "Cloud DNS managed zone name (created outside Terraform during the GoDaddy migration)."
  type        = string
  default     = "danielmherman"
}

variable "cloud_run_service" {
  description = "Cloud Run service the load balancer fronts. Deployed by cloudbuild.yaml, not by Terraform."
  type        = string
  default     = "danielmherman"
}

variable "edge_enabled" {
  description = <<-EOT
    Whether the load balancer, serverless NEG and Cloud Armor policy exist.
    The certificate and its DNS authorizations exist in both states.
  EOT
  type        = bool
  default     = false
}

variable "dns_points_at_edge" {
  description = <<-EOT
    Whether the public DNS records publish the load balancer address. Kept
    separate from edge_enabled so a change of routing and the existence of the
    load balancer can happen in two steps with a TTL wait between them. Both
    directions use the same three states:

      edge_enabled=true,  dns_points_at_edge=false   load balancer exists, DNS
                                                     still on the domain mapping
      edge_enabled=true,  dns_points_at_edge=true    live at the load balancer
      edge_enabled=false, dns_points_at_edge=false   nothing running

    dns_points_at_edge=true requires edge_enabled=true.
  EOT
  type        = bool
  default     = false
}

variable "rate_limit_login_per_minute" {
  description = "Per-client-IP limit on the sign-in path before 429 (credential stuffing)."
  type        = number
  default     = 30
}

variable "rate_limit_ask_per_minute" {
  description = "Per-client-IP limit on the agent path before 429 (volumetric abuse)."
  type        = number
  default     = 60
}
