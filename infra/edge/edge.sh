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
    # Phase 1: build the LB. DNS still publishes the domain mapping, so the
    # site is untouched while the ten resources come up. Ingress stays "all"
    # until the end, so both paths can serve at the same time.
    terraform apply -input=false -auto-approve \
      -var edge_enabled=true -var dns_points_at_edge=false
    IP=$(terraform output -raw edge_ip)
    echo "LB IP: $IP"
    # Readiness has two stages because the two halves come up at different
    # speeds, and waiting on the slower one first wastes the difference. The
    # forwarding path answers first: an HTTP request returns the URL map's
    # redirect, which needs no TLS. Only then is the certificate worth waiting
    # for. --resolve (not -H Host) so the SNI matches the managed certificate.
    ready_when() {  # port scheme expected-code attempts label
      local code=000
      for _ in $(seq 1 "$4"); do
        code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
          --resolve "$DOMAIN:$1:$IP" "$2://$DOMAIN/" || true)
        [[ "$code" == "$3" ]] && break
        sleep 5
      done
      echo "  $5 -> HTTP $code"
      [[ "$code" == "$3" ]]
    }

    echo "waiting for the forwarding path on $IP..."
    ready_when 80 http 301 60 "http://$DOMAIN" || {
      echo "LB never answered on port 80; DNS untouched, nothing to undo" >&2
      exit 1
    }
    echo "waiting for the certificate on $IP..."
    ready_when 443 https 200 60 "https://$DOMAIN" || {
      echo "LB answered but TLS is not ready; DNS untouched, nothing to undo" >&2
      exit 1
    }
    # Phase 2: now that the LB demonstrably serves, move DNS to it. Resolvers
    # still holding the domain-mapping addresses keep being served.
    terraform apply -input=false -auto-approve \
      -var edge_enabled=true -var dns_points_at_edge=true
    wait_ttl
    # Phase 3: only the LB may reach Cloud Run now.
    ingress internal-and-cloud-load-balancing
    echo "edge is UP"
    ;;
  down)
    terraform init -input=false >/dev/null
    # Phase 1: reopen ingress so the domain mapping can serve again the moment
    # DNS moves. Nothing has moved yet.
    ingress all
    # Phase 2: move DNS back to the domain mapping while the LB still exists,
    # so a resolver holding the LB address keeps working until it re-resolves.
    terraform apply -input=false -auto-approve \
      -var edge_enabled=true -var dns_points_at_edge=false
    wait_ttl
    # Phase 3: nothing points at the LB any more; destroy it.
    terraform apply -input=false -auto-approve \
      -var edge_enabled=false -var dns_points_at_edge=false
    echo "edge is DOWN (certificate, DNS zone, and domain mapping retained)"
    ;;
  status)
    terraform init -input=false >/dev/null
    terraform output
    printf "ingress: %s\n" "$(gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" \
      --format='value(metadata.annotations["run.googleapis.com/ingress"])')"
    printf "live A:  %s\n" "$(dig +short "$DOMAIN" A | tr '\n' ' ')"
    printf "lb up:   %s\n" "$(gcloud compute forwarding-rules list --global \
      --filter="name~danielmherman" --format='value(name)' | tr '\n' ' ')"
    ;;
  *)
    echo "usage: $0 up|down|status" >&2
    exit 2
    ;;
esac
