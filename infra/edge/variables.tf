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
    false: no load balancer; DNS points at the Cloud Run domain mapping.
    true:  load balancer + Cloud Armor exist; DNS points at the LB IP.
    The certificate and DNS authorization persist in both states.
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

variable "rate_limit_ban_seconds" {
  description = "How long a client that exceeds the threshold is banned."
  type        = number
  default     = 60
}
