#!/usr/bin/env bash
# Bring the edge (load balancer + Cloud Armor) up or down without a dark window.
#
#   infra/edge/edge.sh up      LB + Cloud Armor created, DNS -> LB, ingress restricted
#   infra/edge/edge.sh down    ingress opened, DNS -> Cloud Run mapping, LB destroyed
#   infra/edge/edge.sh status  what exists right now
#
# Why a script and not just `terraform apply`: the Cloud Run service is owned by
# cloudbuild.yaml, so its ingress setting is changed here with gcloud, and the
# two changes (DNS, ingress) must happen in the right order with a TTL wait
# between them. Terraform owns everything else.
set -euo pipefail

cd "$(dirname "$0")"

PROJECT="${PROJECT:-trim-icon-498815-a0}"
REGION="${REGION:-us-east1}"
SERVICE="${SERVICE:-danielmherman}"
DOMAIN="${DOMAIN:-danielmherman.com}"
TTL_WAIT="${TTL_WAIT:-330}"   # DNS TTL is 300 s; wait a little longer

ingress() {
  gcloud run services update "$SERVICE" --region "$REGION" --project "$PROJECT" \
    --ingress "$1" --quiet >/dev/null
  echo "ingress -> $1"
}

wait_ttl() {
  echo "waiting ${TTL_WAIT}s for DNS TTL to expire..."
  sleep "$TTL_WAIT"
}

case "${1:-}" in
  up)
    terraform init -input=false >/dev/null
    # Phase 1: build LB + flip DNS in one apply. Ingress is still "all", so the
    # domain mapping keeps serving while resolvers pick up the new records.
    terraform apply -input=false -auto-approve -var edge_enabled=true
    IP=$(terraform output -raw edge_ip)
    echo "LB IP: $IP"
    # The forwarding rule takes about a minute to be programmed at the edge.
    # --resolve (not -H Host) so TLS SNI matches the managed certificate.
    echo "waiting for the LB to answer on $IP..."
    for _ in $(seq 1 24); do
      code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
        --resolve "$DOMAIN:443:$IP" "https://$DOMAIN/" || true)
      [[ "$code" == "200" ]] && break
      sleep 5
    done
    echo "  https://$DOMAIN via $IP -> HTTP $code"
    [[ "$code" == "200" ]] || { echo "LB not serving; leaving ingress open" >&2; exit 1; }
    wait_ttl
    # Phase 2: only the LB may reach Cloud Run now.
    ingress internal-and-cloud-load-balancing
    echo "edge is UP"
    ;;
  down)
    terraform init -input=false >/dev/null
    # Phase 1: reopen ingress so the domain mapping can serve again.
    ingress all
    # Phase 2: flip DNS back and destroy the LB in one apply. Resolvers still
    # holding the LB IP get served by the LB until it is gone.
    terraform apply -input=false -auto-approve -var edge_enabled=false
    echo "edge is DOWN (certificate, DNS zone, and domain mapping retained)"
    ;;
  status)
    terraform init -input=false >/dev/null
    terraform output
    printf "ingress: %s\n" "$(gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" \
      --format='value(metadata.annotations["run.googleapis.com/ingress"])')"
    printf "live A:  %s\n" "$(dig +short "$DOMAIN" A | tr '\n' ' ')"
    ;;
  *)
    echo "usage: $0 up|down|status" >&2
    exit 2
    ;;
esac
