terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }

  # State lives in GCS so up/down cycles work from any machine and survive
  # local clones. Versioning is enabled on the bucket.
  backend "gcs" {
    bucket = "trim-icon-498815-a0-tfstate"
    prefix = "edge"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
