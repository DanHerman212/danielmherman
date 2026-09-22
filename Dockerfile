# ---- console JavaScript bundle --------------------------------------------
# Builds the console page's JavaScript from static/js and the npm packages
# declared in package.json. Why a bundle at all: an unbundled module graph is
# fetched one dependency layer at a time, and the page used to wait on 385 of
# them before it could paginate.
#
# Node lives ONLY in this stage. The bundle is built from the same source the
# runtime image ships, so it cannot be stale; .dockerignore keeps any locally
# generated copy out of the build context, so this is the only source of it.
#
# `npm ci`, not `install`: it installs exactly what package-lock.json pins, so
# the build is reproducible and cannot drift.
FROM node:22-slim AS jsbuild
WORKDIR /src
COPY package.json package-lock.json vite.config.js ./
RUN npm ci
COPY static/js ./static/js
RUN npm run build

# Use Python 3.12 slim image. Pinned by digest (multi-arch manifest list) so
# rebuilds are reproducible: resolves linux/amd64 on Cloud Build and arm64 on
# Apple Silicon. A floating tag would let the base drift under a stable build.
FROM python:3.12-slim@sha256:e5c9fa26ffb76e11e0f054f30dc2523a2f9693f0c36c0cf1e39b27e152d899fc

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Set work directory
WORKDIR /app

# No system build dependencies needed.
# `psycopg2-binary` ships precompiled wheels bundling their own libpq, so gcc and
# libpq-dev are unnecessary. (They WOULD be required if this ever switches to
# source-built `psycopg2` — if pip starts failing on a compile step, that is why.)

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy project files
COPY . .

# The console JavaScript bundles, from the build stage above. Declared as its
# own COPY so it is obvious where they come from: no bundle in the build
# context (see .dockerignore), and no bundle committed to the repository.
COPY --from=jsbuild /src/static/js/bundled ./static/js/bundled

# Collect static files
# NOTE: this must succeed. Do NOT suppress errors (e.g. `2>/dev/null || true`) —
# a silent failure here ships a container whose site loads with no CSS/JS and no error.
RUN ENVIRONMENT=collectstatic python manage.py collectstatic --noinput

# Non-root runtime user (S1-14): uvicorn and everything after this point run
# as 'app', so a code-execution bug cannot escalate to root in the container.
# Static files were collected above as root and stay world-readable.
RUN useradd --system --no-create-home app
USER app

# Expose port
EXPOSE 8080

# Run with uvicorn (ASGI). JSON/exec form: uvicorn runs as PID 1 and receives
# SIGTERM directly, so Cloud Run scale-down and revision swaps shut down cleanly
# instead of being SIGKILLed after the grace period.
CMD ["uvicorn", "danielmherman.asgi:application", \
     "--host", "0.0.0.0", \
     "--port", "8080", \
     "--workers", "2", \
     "--timeout-keep-alive", "120"]