#!/bin/sh
# Start the local dev server.
#
# The console page loads a BUILT JavaScript bundle (why: see
# scripts/bundle_console_js.sh). The browser needs that file to exist on disk,
# and there is no Docker build locally — so building it is part of STARTING the
# server rather than a separate step. Nothing to remember, nothing that can be
# stale, because the server will not start without it.
#
# Production does the same thing in the Dockerfile's jsbuild stage, so no human
# runs this to ship a release.
#
#     sh scripts/dev.sh          # fixture mode: no agent, no ADC, no network
#     sh scripts/dev.sh live     # the real agent (needs DEMO_AGENT_URL + ADC)
#
# Any further arguments go to uvicorn, e.g. `sh scripts/dev.sh --reload`.
set -e

cd "$(dirname "$0")/.."

sh scripts/bundle_console_js.sh

ENVIRONMENT=development
export ENVIRONMENT

if [ "$1" = "live" ]; then
  shift
else
  DEMO_FIXTURE_MODE=true
  export DEMO_FIXTURE_MODE
fi

exec .venv/bin/python -m uvicorn danielmherman.asgi:application \
  --host 127.0.0.1 --port 8000 "$@"
