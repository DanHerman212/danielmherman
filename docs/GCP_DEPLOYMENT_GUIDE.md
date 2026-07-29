# Deploying danielmherman.com to Google Cloud Platform

A complete step-by-step guide for deploying this Django app to **Google Cloud Run** using **ASGI (uvicorn)**, with **GitHub CI/CD** via Cloud Build, **Cloud SQL (PostgreSQL)** for the database, **Cloud Storage** for media files, and a **custom domain from GoDaddy**.

> **Memorystore (Redis) is deliberately not part of this deployment.** See Section 6 for
> the reasoning and for instructions if you ever need to add it.

> **Architecture note:** This deployment uses ASGI (uvicorn) instead of WSGI (gunicorn) to support WebSocket connections for future real-time applications (e.g., clinical dashboards, live data feeds). Standard HTTP views work identically under ASGI — there is no downside to starting with it. Future Django apps (clinical dashboard, recommendation system, etc.) will be added to this project and served as pages under the same domain. ML model inference will be served from separate GCP projects via dedicated prediction endpoints.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Create a GCP Project](#2-create-a-gcp-project)
3. [Install & Configure the gcloud CLI](#3-install--configure-the-gcloud-cli)
4. [Set Up Cloud SQL (PostgreSQL)](#4-set-up-cloud-sql-postgresql)
5. [Set Up a Cloud Storage Bucket (Media Files)](#5-set-up-a-cloud-storage-bucket-media-files)
6. [Set Up Memorystore (Redis) — SKIPPED](#6-set-up-memorystore-redis--skipped)
7. [Store Secrets in Secret Manager](#7-store-secrets-in-secret-manager)
8. [Update the Django App for Production](#8-update-the-django-app-for-production)
9. [Create the Dockerfile](#9-create-the-dockerfile)
10. [Create .dockerignore](#10-create-dockerignore)
11. [Test the Container Locally (Optional)](#11-test-the-container-locally-optional)
12. [Push Your Code to GitHub](#12-push-your-code-to-github)
13. [Set Up Artifact Registry](#13-set-up-artifact-registry)
14. [Deploy to Cloud Run (First Time — Manual)](#14-deploy-to-cloud-run-first-time--manual)
15. [Run Database Migrations in Production](#15-run-database-migrations-in-production)
16. [Create a Superuser in Production](#16-create-a-superuser-in-production)
17. [Clean-Sheet Launch (No Data Migration)](#17-clean-sheet-launch-no-data-migration)
18. [Set Up Cloud Build CI/CD from GitHub](#18-set-up-cloud-build-cicd-from-github)
19. [Connect Your GoDaddy Domain (danielmherman.com)](#19-connect-your-godaddy-domain-danielmhermancom)
20. [Post-Deployment Checklist](#20-post-deployment-checklist)
21. [Ongoing Workflow](#21-ongoing-workflow)
22. [Future: Adding New Django Apps](#22-future-adding-new-django-apps)

---

## 1. Prerequisites

Before starting, make sure you have:

- [ ] A **Google account** with billing enabled (you'll set this up in GCP Console)
- [ ] A **GitHub account** with your code in a repository
- [ ] **Docker Desktop** installed on your Mac — [download here](https://www.docker.com/products/docker-desktop/)
- [ ] **Git** installed (`git --version` to check)
- [ ] Your **GoDaddy** account credentials (for danielmherman.com)

---

## 2. Create a GCP Project

1. Go to console.cloud.google.com
2. Click the project dropdown at the top → **New Project**
3. Name it `danielmherman` (or similar)
4. Note your **Project ID** (e.g., `danielmherman-123456`) — you'll use this everywhere
5. Make sure **billing is enabled** for the project (Navigation Menu → Billing)
6. Enable the required APIs. In the Cloud Shell or terminal, run:

```bash
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  storage.googleapis.com \
  compute.googleapis.com
```

> `redis.googleapis.com` and `vpcaccess.googleapis.com` are **not** enabled — this
> deployment uses neither Memorystore nor a VPC connector (Section 6). Enabling an API
> costs nothing, but leaving them off keeps the project surface honest about what is
> actually in use.

---

## 3. Install & Configure the gcloud CLI

1. Install the Google Cloud CLI (if not already installed):

```bash
brew install --cask google-cloud-sdk
```

2. Initialize and authenticate:

```bash
gcloud init
```

3. Follow the prompts to:
   - Log in with your Google account
   - Select your project (`danielmherman` or whatever you named it)
   - Set a default region — choose **`us-east1`** (matches the clinical copilot / MLOps project region, avoiding cross-region latency and egress)

4. Confirm your config:

```bash
gcloud config list
```

---

## 4. Set Up Cloud SQL (PostgreSQL)

> **Password handling.** Generate both database passwords directly into Secret Manager *before* creating the instance, then read them back when needed. This way you never type a password into your shell, nothing lands in `~/.bash_history`, and Secret Manager is the single source of truth — so there's no way for the value in Cloud SQL to drift out of sync with the value Cloud Run injects at runtime.

### 4a. Generate and store the database passwords

Requires the Secret Manager API (`gcloud services enable secretmanager.googleapis.com`).

```bash
# Postgres superuser password — you will rarely need this, but store it properly
python3 -c "import secrets; print(secrets.token_urlsafe(32), end='')" | \
  gcloud secrets create db-root-password --data-file=-

# Application user password — Cloud Run injects this as DB_PASSWORD
python3 -c "import secrets; print(secrets.token_urlsafe(32), end='')" | \
  gcloud secrets create db-password --data-file=-
```

> The `end=''` matters. A trailing newline becomes part of the secret value and causes
> `password authentication failed` errors that are very hard to spot.

### 4b. Create the Cloud SQL instance

```bash
gcloud sql instances create danielmherman-db \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region=us-east1 \
  --root-password="$(gcloud secrets versions access latest --secret=db-root-password)"
```

> **`db-f1-micro`** is the smallest/cheapest tier (~$7-10/month). Good for a personal site.

### 4c. Create a database

```bash
gcloud sql databases create danielmherman --instance=danielmherman-db
```

### 4d. Create the application database user

```bash
gcloud sql users create djangouser \
  --instance=danielmherman-db \
  --password="$(gcloud secrets versions access latest --secret=db-password)"
```

This is the account Django authenticates as. Because both this command and Cloud Run
read from the same `db-password` secret, the two can never disagree.

### 4e. Note your connection name

```bash
gcloud sql instances describe danielmherman-db --format="value(connectionName)"
```

This will output something like: `danielmherman-123456:us-east1:danielmherman-db`

**Save this value** — you'll need it later.

> **If you ever need to rotate the password:** add a new secret version
> (`gcloud secrets versions add db-password --data-file=-`), then apply it with
> `gcloud sql users set-password djangouser --instance=danielmherman-db --prompt-for-password`,
> then redeploy Cloud Run so it picks up the new version.

---

## 5. Set Up a Cloud Storage Bucket (Media Files)

This bucket will store uploaded images (article images, CKEditor uploads, etc.).

```bash
# Create the bucket (name must be globally unique)
gsutil mb -l us-east1 gs://danielmherman-media

# Make uploaded files publicly readable (for serving images on your site)
gsutil iam ch allUsers:objectViewer gs://danielmherman-media

# Set CORS for CKEditor uploads
cat > /tmp/cors.json << 'EOF'
[
  {
    "origin": ["https://danielmherman.com", "https://*.run.app"],
    "method": ["GET", "HEAD", "PUT", "POST"],
    "responseHeader": ["Content-Type"],
    "maxAgeSeconds": 3600
  }
]
EOF
gsutil cors set /tmp/cors.json gs://danielmherman-media
```

---

## 6. Set Up Memorystore (Redis) — SKIPPED

> **Skip this entire section.** It is retained only as a reference for if the
> requirements change.

**Why it was dropped.** Redis would serve as the Django Channels *channel layer*, whose
only job is passing messages **between processes** (`group_send`). A consumer that holds
a connection and calls the agent inline never touches it. The demo is auth-gated with
few users, and Cloud SQL (Postgres) already covers sessions, per-user quota, and
LangGraph checkpointing — all shared across Cloud Run instances and durable, which
Redis is not.

Separately, the A2UI rendering layer does **not** require WebSockets: they are a
*proposed, unimplemented* transport in that spec, and user actions travel as ordinary
tool calls. So the one thing that might have forced a channel layer does not.

**What it saves:** ~$36/month (Memorystore) + ~$7-10/month (VPC connector) ≈ **$43-46/month**.

**The one case that would justify revisiting:** a live dashboard where several viewers
must see the same updates pushed simultaneously. Postgres genuinely cannot do that
well; that is the trigger to come back here.

> **Note:** a VPC connector is *not* needed for Cloud SQL. Cloud Run reaches the
> database through `--add-cloudsql-instances`, which uses the managed Cloud SQL Auth
> Proxy rather than the VPC. The connector below exists solely for Memorystore.

<details>
<summary>Instructions, if Memorystore is ever needed</summary>

### 6a. Create a VPC Connector

```bash
gcloud compute networks vpc-access connectors create danielmherman-connector \
  --region=us-east1 \
  --range=10.8.0.0/28
```

### 6b. Create the Redis instance

```bash
gcloud redis instances create danielmherman-redis \
  --size=1 \
  --region=us-east1 \
  --redis-version=redis_7_0 \
  --tier=basic
```

### 6c. Note the Redis host IP

```bash
gcloud redis instances describe danielmherman-redis --region=us-east1 --format="value(host)"
```

Then re-add `--vpc-connector danielmherman-connector` and `REDIS_HOST` to the Cloud Run
deploy command, and enable `redis.googleapis.com` and `vpcaccess.googleapis.com`.

</details>

---

## 7. Store Secrets in Secret Manager

Never hardcode secrets. The two database passwords were already created in Section 4a —
this section adds the Django secret key and grants Cloud Run access to everything it needs.

```bash
# Django SECRET_KEY — generated straight into Secret Manager, never printed to the terminal
python3 -c "import secrets; print(secrets.token_urlsafe(50), end='')" | \
  gcloud secrets create django-secret-key --data-file=-
```

Verify all three secrets exist:

```bash
gcloud secrets list --format="table(name)"
# expect: db-password, db-root-password, django-secret-key
```

Grant the Cloud Run service account access to the secrets:

```bash
PROJECT_NUM=$(gcloud projects describe $(gcloud config get-value project) --format="value(projectNumber)")

# Grant secret access to the default compute service account
gcloud secrets add-iam-policy-binding django-secret-key \
  --member="serviceAccount:${PROJECT_NUM}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding db-password \
  --member="serviceAccount:${PROJECT_NUM}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

> **`db-root-password` is deliberately not granted.** The application never authenticates
> as the Postgres superuser, so Cloud Run has no reason to read it. Keep that blast radius small.

---

## 8. Update the Django App for Production

### 8a. Update `requirements.txt`

Add these production dependencies:

```
asgiref==3.11.0
bleach==4.1.0
Django==6.0
django-ckeditor-5==0.2.20
django-js-asset==3.1.2
pillow==12.1.0
sqlparse==0.5.5
webencodings==0.5.1
uvicorn[standard]==0.34.0
psycopg2-binary==2.9.10
django-storages[google]==1.14.4
google-cloud-secret-manager==2.21.0
whitenoise==6.8.2
channels==4.2.0
channels-redis==4.2.1
```

> **Key changes from WSGI plan:** `gunicorn` is replaced by `uvicorn[standard]`.
>
> **On `channels-redis`:** it is pinned but **currently unused**, because Memorystore is
> not deployed (Section 6). It is harmless — roughly 1 MB, imported only if the channel
> layer is configured to use it — and keeping it pinned means adding Redis later is a
> config change rather than a dependency change. Drop it if you prefer a minimal
> install; nothing in the running app imports it today.
>
> **On `django-ckeditor`:** if your `requirements.txt` omits it, a clean-sheet deploy
> will fail during migrations. `content/migrations/0004_alter_article_content.py` has a
> module-level `import ckeditor.fields`, and a fresh database replays every migration —
> so the package must be installed even though the current models use CKEditor 5.

### 8b. Update `danielmherman/settings.py`

Replace the **database**, **static/media**, **security**, and **secret key** sections. Add these imports at the top and modify the settings to support both local dev and production:

```python
"""
Django settings for danielmherman project.
"""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# Detect environment
ENVIRONMENT = os.environ.get('ENVIRONMENT', 'development')
IS_PRODUCTION = ENVIRONMENT == 'production'

# ---------- SECRET KEY ----------
if IS_PRODUCTION:
    from google.cloud import secretmanager
    client = secretmanager.SecretManagerServiceClient()
    PROJECT_ID = os.environ.get('GOOGLE_CLOUD_PROJECT')
    
    def get_secret(secret_id):
        name = f"projects/{PROJECT_ID}/secrets/{secret_id}/versions/latest"
        response = client.access_secret_version(request={"name": name})
        return response.payload.data.decode("UTF-8")
    
    SECRET_KEY = get_secret('django-secret-key')
else:
    # Local development only. Override via DJANGO_SECRET_KEY if you need a
    # stable key across restarts. Never commit a real key here.
    SECRET_KEY = os.environ.get(
        'DJANGO_SECRET_KEY',
        'django-insecure-local-dev-only-never-use-in-production',
    )

# ---------- DEBUG ----------
DEBUG = not IS_PRODUCTION

# ---------- ALLOWED HOSTS ----------
ALLOWED_HOSTS = os.environ.get('ALLOWED_HOSTS', 'localhost,127.0.0.1').split(',')

# ---------- CSRF ----------
CSRF_TRUSTED_ORIGINS = os.environ.get(
    'CSRF_TRUSTED_ORIGINS',
    'http://localhost:8000'
).split(',')
```

**Keep your INSTALLED_APPS the same**, but add `storages` (for production media) and whitenoise:

```python
INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'content',
    'django_ckeditor_5',
    'storages',   # Cloud Storage media backend
    'channels',   # Django Channels (WebSocket/ASGI support)
]
```

**Add WhiteNoise to middleware** (right after SecurityMiddleware):

```python
MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',  # ADD THIS LINE
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]
```

**Replace the DATABASE section:**

```python
if IS_PRODUCTION:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': 'danielmherman',
            'USER': 'djangouser',
            'PASSWORD': get_secret('db-password'),
            'HOST': '/cloudsql/' + os.environ.get('CLOUD_SQL_CONNECTION_NAME', ''),
            'PORT': '5432',
        }
    }
else:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': BASE_DIR / 'db.sqlite3',
        }
    }
```

**Replace the static/media files section at the bottom:**

```python
# ---------- STATIC FILES ----------
STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STATICFILES_DIRS = [BASE_DIR / 'static']
STORAGES = {
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}

# ---------- MEDIA FILES ----------
if IS_PRODUCTION:
    STORAGES["default"] = {
        "BACKEND": "storages.backends.gcloud.GoogleCloudStorage",
    }
    GS_BUCKET_NAME = os.environ.get('GS_BUCKET_NAME', 'danielmherman-media')
    GS_DEFAULT_ACL = 'publicRead'
    MEDIA_URL = f'https://storage.googleapis.com/{GS_BUCKET_NAME}/'
else:
    MEDIA_URL = '/media/'
    MEDIA_ROOT = BASE_DIR / 'media'

# ---------- SECURITY (production only) ----------
if IS_PRODUCTION:
    SECURE_SSL_REDIRECT = True
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True

# ---------- ASGI / CHANNELS ----------
ASGI_APPLICATION = 'danielmherman.asgi.application'

# Redis is only required for cross-process WebSocket broadcast (group_send).
# Without REDIS_HOST set, the in-memory layer is used — correct for
# request/response and single-connection streaming workloads.
REDIS_HOST = os.environ.get('REDIS_HOST')

if REDIS_HOST:
    CHANNEL_LAYERS = {
        'default': {
            'BACKEND': 'channels_redis.core.RedisChannelLayer',
            'CONFIG': {
                'hosts': [(REDIS_HOST, 6379)],
            },
        },
    }
else:
    CHANNEL_LAYERS = {
        'default': {
            'BACKEND': 'channels.layers.InMemoryChannelLayer',
        },
    }
```

> **Key the channel layer on `REDIS_HOST`, not on `IS_PRODUCTION`.** The obvious version
> of this block (`if IS_PRODUCTION:` → Redis) breaks the moment you deploy to production
> *without* Memorystore: it would fall back to `127.0.0.1:6379`, where nothing is
> listening, and every channel-layer operation would fail. Keying on the presence of the
> variable means the same code is correct with or without Redis, and adding Memorystore
> later is purely a deploy-flag change.

### 8b-2. Add a `LOGGING` config

Append this to `settings.py`. **Do not skip it** — without it, production 500s are
invisible.

```python
# ---------- LOGGING ----------
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'verbose': {
            'format': '{levelname} {asctime} {name} {message}',
            'style': '{',
        },
    },
    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
            'formatter': 'verbose',
        },
    },
    'loggers': {
        'django.request': {
            'handlers': ['console'],
            'level': 'ERROR',
            'propagate': False,
        },
        'django': {
            'handlers': ['console'],
            'level': 'INFO' if IS_PRODUCTION else 'WARNING',
            'propagate': False,
        },
        'content': {
            'handlers': ['console'],
            'level': 'INFO',
            'propagate': False,
        },
    },
    'root': {
        'handlers': ['console'],
        'level': 'WARNING',
    },
}
```

> **Why this is necessary.** With `DEBUG=False`, Django routes unhandled view exceptions
> to the `django.request` logger, whose *only* default handler is `mail_admins`. With no
> email backend configured, those tracebacks are discarded. The symptom is a Cloud Run
> log containing exactly one line —
> `"GET / HTTP/1.1" 500 Internal Server Error` — and no indication of the cause.
> Every production incident then starts from zero.
>
> Writing to stdout is sufficient: Cloud Run captures stdout and stderr into Cloud
> Logging automatically, so no logging agent, sidecar, or `google-cloud-logging`
> dependency is required.
>
> View them with:
> ```bash
> gcloud run services logs read danielmherman --region us-east1 --limit 50
> ```

### 8c. Update `danielmherman/asgi.py`

Replace the default ASGI config to support Django Channels routing:

```python
"""
ASGI config for danielmherman project.
"""

import os
from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'danielmherman.settings')

# Initialize Django ASGI application early to ensure the AppRegistry is populated
django_asgi_app = get_asgi_application()

from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack

# For now, only HTTP is routed. When you add WebSocket consumers
# (e.g., for the clinical dashboard), add a 'websocket' key here.
application = ProtocolTypeRouter({
    'http': django_asgi_app,
    # 'websocket': AuthMiddlewareStack(
    #     URLRouter([
    #         # Add WebSocket URL routes here when needed
    #     ])
    # ),
})
```

### 8d. Keep everything else the same

Your CKEditor config, templates, URL config, password validators, etc. all stay as-is.

---

## 9. Create the Dockerfile

Create a file called `Dockerfile` in your project root (`/danielmherman/Dockerfile`):

```dockerfile
# Use Python 3.12 slim image
FROM python:3.12-slim

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

# Collect static files
# NOTE: this must succeed. Do NOT suppress errors (e.g. `2>/dev/null || true`) —
# a silent failure here ships a container whose site loads with no CSS/JS and no error.
RUN ENVIRONMENT=collectstatic python manage.py collectstatic --noinput

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
```

> **Why JSON form for `CMD`?** The shell form (`CMD exec uvicorn ...`) also works,
> because `exec` replaces the shell process. But Docker's linter emits a
> `JSONArgsRecommended` warning for it, and the signal-handling guarantee then rests on
> one easily-deleted keyword. JSON form makes it structural. The tradeoff: JSON form
> does not expand environment variables, so the port is hardcoded to `8080` — which
> matches both Cloud Run's default and the `--port 8080` used at deploy time.

> **Why uvicorn instead of gunicorn?** Uvicorn is a native ASGI server that supports both regular HTTP requests and WebSocket connections. All existing Django views work identically. When you add real-time apps with Django Channels, they'll work without any server changes.

> **Why no `apt-get` layer?** An earlier version of this guide installed `gcc` and
> `libpq-dev` "for psycopg2". That is only necessary when building `psycopg2` from
> source. This project pins **`psycopg2-binary`**, which ships manylinux wheels with
> libpq statically bundled. Removing the layer cut the image from **540 MB to 354 MB**
> and removes a compiler from the production runtime — a modest attack-surface win as
> well as a size one. Verified with `import psycopg2` plus a full migrate + request
> test inside the container.

---

## 10. Create .dockerignore

Create `.dockerignore` in your project root:

```
# Virtual environments (note: this project uses .venv, not venv)
venv/
.venv/

# Python bytecode
__pycache__/
*.pyc
*.pyo

# Local database
db.sqlite3

# Version control
.git/
.gitignore

# Docs and images (not needed at runtime)
*.md
docs/
images/

# Local media uploads — production serves these from Cloud Storage
media/

# Build output — collectstatic regenerates this inside the image.
# Copying the local copy in bloats the image and can ship a stale manifest.
staticfiles/

# Secrets and OS cruft
.env
.DS_Store

# Container files themselves
Dockerfile
.dockerignore
```

> **Why `staticfiles/` matters.** It is `STATIC_ROOT` — pure build output. Copying the
> local copy into the image both bloats it and risks shipping a stale
> `staticfiles.json` manifest that disagrees with the freshly collected assets. The
> `RUN ... collectstatic` step regenerates it during the build.

> **Why `.venv/` matters.** The guide originally listed only `venv/`. This project's
> environment was renamed to `.venv`, which that pattern does not match — leaving it out
> would copy hundreds of megabytes of host-specific, Linux-incompatible packages into
> the image.

---

## 11. Test the Container Locally (Optional)

Before deploying, you can verify the container builds and runs:

```bash
# Build the image
docker build -t danielmherman .

# Run it locally (still uses SQLite in dev mode)
docker run -p 8080:8080 -e ENVIRONMENT=development danielmherman
```

Visit `http://localhost:8080` — if you see your site, the container works.

Press `Ctrl+C` to stop.

---

## 12. Push Your Code to GitHub

### 12a. Create a `.gitignore` file (if you don't have one)

```
venv/
__pycache__/
*.pyc
db.sqlite3
.env
.DS_Store
media/
staticfiles/
get-pip.py
```

### 12b. Initialize git and push

```bash
cd ~/Desktop/danielmherman

git init
git add .
git commit -m "Initial commit - Django personal site"

# Create repo on GitHub first (via github.com → New Repository → name it danielmherman)
# Then connect and push:
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/danielmherman.git
git branch -M main
git push -u origin main
```

---

## 13. Set Up Artifact Registry

Artifact Registry stores your Docker container images.

```bash
gcloud artifacts repositories create danielmherman-repo \
  --repository-format=docker \
  --location=us-east1 \
  --description="Docker images for danielmherman.com"
```

---

## 14. Deploy to Cloud Run (First Time — Manual)

For the first deployment, build and deploy manually to make sure everything works.

### 14a. Build and push the image

```bash
PROJECT_ID=$(gcloud config get-value project)

# Build the image using Cloud Build
gcloud builds submit --tag us-east1-docker.pkg.dev/${PROJECT_ID}/danielmherman-repo/danielmherman:latest
```

### 14b. Deploy to Cloud Run

```bash
CLOUD_SQL_CONNECTION=$(gcloud sql instances describe danielmherman-db --format="value(connectionName)")

gcloud run deploy danielmherman \
  --image us-east1-docker.pkg.dev/${PROJECT_ID}/danielmherman-repo/danielmherman:latest \
  --platform managed \
  --region us-east1 \
  --allow-unauthenticated \
  --add-cloudsql-instances ${CLOUD_SQL_CONNECTION} \
  --set-env-vars "^@^ENVIRONMENT=production@GOOGLE_CLOUD_PROJECT=${PROJECT_ID}@CLOUD_SQL_CONNECTION_NAME=${CLOUD_SQL_CONNECTION}@GS_BUCKET_NAME=danielmherman-media@ALLOWED_HOSTS=danielmherman.com,www.danielmherman.com,.run.app@CSRF_TRUSTED_ORIGINS=https://danielmherman.com,https://www.danielmherman.com" \
  --min-instances 0 \
  --max-instances 3 \
  --memory 512Mi
```

> **Why the `^@^` prefix and one single `--set-env-vars`?** Two separate traps:
>
> 1. **Commas.** `--set-env-vars` splits pairs on commas by default, so
>    `ALLOWED_HOSTS=a.com,b.com` is read as `ALLOWED_HOSTS=a.com` plus a malformed
>    key `b.com`, and gcloud errors with *"Bad syntax for dict arg"*. The `^@^`
>    prefix changes the delimiter to `@`, so commas stay inside the values — which
>    `settings.py` needs, because it calls `.split(',')` on both variables.
> 2. **Repetition silently overwrites.** `--set-env-vars` is a dictionary flag. Passing
>    it several times does **not** accumulate — the last occurrence replaces all the
>    earlier ones. A multi-flag version of this command deploys with only
>    `CSRF_TRUSTED_ORIGINS` set, which means `ENVIRONMENT` is missing and the app boots
>    in development mode: `DEBUG=True`, permissive hosts, no SSL redirect — and it
>    *starts successfully*, so nothing looks wrong. Keeping every variable in one flag
>    removes the hazard.
>
> Use `--update-env-vars` instead of `--set-env-vars` if you ever want to change one
> variable without resupplying the rest.

> **No Redis, no VPC connector.** Memorystore was dropped from this deployment
> (see Section 6). Cloud SQL is reached through `--add-cloudsql-instances`, which uses
> the managed Cloud SQL Auth Proxy — **not** the VPC — so no `--vpc-connector` is
> needed either. Together these save roughly **$43/month**.
>
> `REDIS_HOST` is deliberately unset. `settings.py` keys the channel layer on the
> *presence* of that variable, so with it absent the app uses
> `InMemoryChannelLayer` and starts cleanly. Setting it to an unreachable host would
> be worse than leaving it out.
>
> **Other notes:**
> - `--min-instances 0` lets the service scale to zero — near-free when idle, at the
>   cost of an occasional cold start. Raise it to `1` later if the clinical demo needs
>   consistently snappy responses (~$3-5/month).
> - `--allow-unauthenticated` is what makes the site public. Revoking this binding is
>   the clean way to take the site offline without deleting the service (which would
>   destroy the domain mapping and force a 15-60 minute SSL re-provision).
>
> **If you later add Memorystore**, you will need to re-add `--vpc-connector`, set
> `REDIS_HOST`, and create the connector first.

After deployment, you'll get a URL like `https://danielmherman-xxxxxxxxxx-ue.a.run.app`. Visit it to verify your site is running.

> **If you see errors**, check the logs:
> ```bash
> gcloud run services logs read danielmherman --region us-east1 --limit 50
> ```

---

## 15. Run Database Migrations in Production

Cloud Run doesn't automatically run migrations. You need to run them for each deployment that includes model changes.

> **Ordering matters:** run migrations **before** the new revision starts serving.
> If you deploy first and migrate second, the new code briefly runs against the old
> schema and can 500. The CI/CD pipeline in Section 18 is ordered accordingly.
> (The alternative is to only ever write backward-compatible migrations — harder to
> guarantee in practice.)

### Option A: Use a Cloud Run Job (recommended)

```bash
PROJECT_ID=$(gcloud config get-value project)
CLOUD_SQL_CONNECTION=$(gcloud sql instances describe danielmherman-db --format="value(connectionName)")

gcloud run jobs create migrate \
  --image us-east1-docker.pkg.dev/${PROJECT_ID}/danielmherman-repo/danielmherman:latest \
  --region us-east1 \
  --set-env-vars "ENVIRONMENT=production,GOOGLE_CLOUD_PROJECT=${PROJECT_ID},CLOUD_SQL_CONNECTION_NAME=${CLOUD_SQL_CONNECTION}" \
  --set-cloudsql-instances ${CLOUD_SQL_CONNECTION} \
  --command "python" \
  --args "manage.py,migrate"

# Execute the migration job
gcloud run jobs execute migrate --region us-east1 --wait
```

> **All three variables must be in a single `--set-env-vars` flag.** Repeating the flag
> does not accumulate — the last occurrence wins. If `ENVIRONMENT` were dropped that
> way, the job would run in development mode against **ephemeral SQLite inside the
> container**, report every migration as applied, exit `0`, and leave the Cloud SQL
> database completely untouched. A green checkmark on a migration that did nothing is
> the worst possible failure mode here.
>
> No value contains a comma, so the default comma delimiter is fine (unlike the deploy
> command in Section 14b, which needs `^@^`).

For subsequent migrations, point the job at the new image and run it **before** deploying that image to the service:

```bash
gcloud run jobs update migrate \
  --image us-east1-docker.pkg.dev/${PROJECT_ID}/danielmherman-repo/danielmherman:latest \
  --region us-east1

gcloud run jobs execute migrate --region us-east1 --wait
```

---

## 16. Create a Superuser in Production

You need an admin user to access `/admin/`.

> **Do not pass the password as a plaintext env var.** It would be stored in the job
> config, your shell history, and potentially Cloud Logging. Put it in Secret Manager
> and reference it with `--set-secrets`.

> **Run these one line at a time.** Do not paste the whole block at once — see the
> warning after step 1 for why.

```bash
PROJECT_ID=$(gcloud config get-value project)
CLOUD_SQL_CONNECTION=$(gcloud sql instances describe danielmherman-db --format="value(connectionName)")
PROJECT_NUM=$(gcloud projects describe ${PROJECT_ID} --format="value(projectNumber)")
```

**1. Generate the superuser password straight into Secret Manager.**

Nothing is typed, echoed, or stored in shell history — the value goes from Python's
CSPRNG into Secret Manager and is never held in a shell variable:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(24), end='')" | gcloud secrets create django-superuser-password --data-file=-
```

> **Why not `read -rs`?** An interactive `read` is unsafe to paste. When you paste a
> multi-line block, the terminal buffers every line, and `read` consumes **the next
> pasted line as its input**. The result is a password silently set to the text of the
> following command, with the rest of the block executing out of order. Generating the
> secret non-interactively removes the hazard completely — and produces a stronger
> password than one you would invent.
>
> The `end=''` matters: a trailing newline becomes part of the secret and causes
> authentication failures that are very hard to diagnose.

**2. Retrieve the password when you need to log in:**

```bash
gcloud secrets versions access latest --secret=django-superuser-password
```

**3. Let the runtime service account read it:**

```bash
gcloud secrets add-iam-policy-binding django-superuser-password \
  --member="serviceAccount:${PROJECT_NUM}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

**4. Create and run the job, injecting the password from Secret Manager:**

```bash
gcloud run jobs create createsuperuser \
  --image us-east1-docker.pkg.dev/${PROJECT_ID}/danielmherman-repo/danielmherman:latest \
  --region us-east1 \
  --set-env-vars "ENVIRONMENT=production,GOOGLE_CLOUD_PROJECT=${PROJECT_ID},CLOUD_SQL_CONNECTION_NAME=${CLOUD_SQL_CONNECTION},DJANGO_SUPERUSER_USERNAME=admin,DJANGO_SUPERUSER_EMAIL=your-email@example.com" \
  --set-secrets "DJANGO_SUPERUSER_PASSWORD=django-superuser-password:latest" \
  --set-cloudsql-instances ${CLOUD_SQL_CONNECTION} \
  --command "python" \
  --args "manage.py,createsuperuser,--noinput"

gcloud run jobs execute createsuperuser --region us-east1 --wait
```

> **Single `--set-env-vars` flag again** — same reason as Section 15. Split across five
> flags, only `DJANGO_SUPERUSER_EMAIL` would survive, and the job would create an admin
> account in a throwaway SQLite file rather than in Cloud SQL. You would then be unable
> to log in to `/admin/`, with nothing in the logs explaining why.
>
> **Do not use the `^@^` delimiter here** — the email address contains an `@`, which
> would be parsed as a separator. The default comma delimiter is correct because no
> value contains a comma.

> **Cleanup:** once the superuser exists, delete the one-shot job:
> ```bash
> gcloud run jobs delete createsuperuser --region us-east1 --quiet
> ```
> Keep the secret if you want to rotate the password later, or delete it with
> `gcloud secrets delete django-superuser-password --quiet`.

---

## 17. Clean-Sheet Launch (No Data Migration)

**This deployment is a clean sheet.** Only the HTML templates (and static CSS/JS) carry
over from the local project — none of the locally created content is migrated.

### What carries over

- `content/templates/` — the HTML templates
- `content/static/` — CSS / JS
- The app's models, views, and URLs (the *code*, not the rows)

### What does NOT carry over

- The local SQLite database (`db.sqlite3`) — already excluded by `.dockerignore`
  and `.gitignore`
- Locally created articles, projects, and categories
- Local uploads in `media/` — already excluded by `.dockerignore`

### What this means operationally

- **Do not** run `dumpdata` / `loaddata`. There is nothing to import.
- The production database starts **empty** after §15 (migrations) — this is expected.
- After §16 (superuser), log in at `/admin/` and author content directly in
  production. Production becomes the system of record.
- The Cloud Storage media bucket starts empty; it fills as you upload images through
  CKEditor in production.

> **Why clean sheet?** The local database was scratch/dev content. Starting empty avoids
> importing throwaway rows and sidesteps SQLite→PostgreSQL type and sequence quirks.

> **If you ever do need to import data later**, note that a `loaddata` job cannot shell
> out to `gsutil` — the `python:3.12-slim` image does not include the gcloud SDK. Either
> bake the fixture into the image, or download it with `google-cloud-storage` from Python.

---

## 18. Set Up Cloud Build CI/CD from GitHub

This is what makes `git push` automatically deploy your site.

### 18a. Connect GitHub to Cloud Build

1. Go to **GCP Console → Cloud Build → Repositories** (2nd gen)
2. Click **Create Host Connection** → select **GitHub**
3. Authenticate with GitHub and install the Cloud Build GitHub App
4. Select your `danielmherman` repository
5. Click **Link Repository**

### 18b. Create `cloudbuild.yaml`

Create this file in your project root:

```yaml
steps:
  # Build the Docker image
  - name: 'gcr.io/cloud-builders/docker'
    args:
      - 'build'
      - '-t'
      - 'us-east1-docker.pkg.dev/$PROJECT_ID/danielmherman-repo/danielmherman:$COMMIT_SHA'
      - '-t'
      - 'us-east1-docker.pkg.dev/$PROJECT_ID/danielmherman-repo/danielmherman:latest'
      - '.'

  # Push the image to Artifact Registry
  - name: 'gcr.io/cloud-builders/docker'
    args:
      - 'push'
      - '--all-tags'
      - 'us-east1-docker.pkg.dev/$PROJECT_ID/danielmherman-repo/danielmherman'

  # Run migrations FIRST — before the new revision serves traffic.
  # Deploying first would briefly run new code against the old schema.
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    entrypoint: gcloud
    args:
      - 'run'
      - 'jobs'
      - 'update'
      - 'migrate'
      - '--image'
      - 'us-east1-docker.pkg.dev/$PROJECT_ID/danielmherman-repo/danielmherman:$COMMIT_SHA'
      - '--region'
      - 'us-east1'

  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    entrypoint: gcloud
    args:
      - 'run'
      - 'jobs'
      - 'execute'
      - 'migrate'
      - '--region'
      - 'us-east1'
      - '--wait'

  # Deploy to Cloud Run only after migrations succeed.
  # If the migrate step fails, the build stops here and the old revision keeps serving.
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    entrypoint: gcloud
    args:
      - 'run'
      - 'deploy'
      - 'danielmherman'
      - '--image'
      - 'us-east1-docker.pkg.dev/$PROJECT_ID/danielmherman-repo/danielmherman:$COMMIT_SHA'
      - '--region'
      - 'us-east1'
      - '--platform'
      - 'managed'

images:
  - 'us-east1-docker.pkg.dev/$PROJECT_ID/danielmherman-repo/danielmherman:$COMMIT_SHA'
  - 'us-east1-docker.pkg.dev/$PROJECT_ID/danielmherman-repo/danielmherman:latest'

options:
  logging: CLOUD_LOGGING_ONLY
```

> **Migrations run before deploy.** This ordering keeps the old revision serving until
> the schema is ready. It requires migrations to be **backward compatible** with the
> currently deployed code (the old revision runs against the new schema for a few
> seconds). For destructive changes (dropping/renaming a column), use the standard
> two-deploy pattern: first deploy code that no longer uses the column, then a second
> deploy that drops it.

### 18c. Grant Cloud Build permissions

> **Not on the critical path.** If anything in this section fights you, skip Section 18
> entirely and keep deploying manually with Sections 14 and 15 — they perform the same
> operations. CI is a convenience; it is not required for a working site.

#### Pre-check: which service account will builds use?

Projects created before ~mid-2024 have a **legacy** Cloud Build service account.
Newer projects do not — Google stopped auto-creating it, and builds run as the
**Compute Engine default** account instead. Find out which you have:

```bash
gcloud iam service-accounts list --format="value(email)"
```

- See `PROJECT_NUM@cloudbuild.gserviceaccount.com`? → **Path A**
- Only see `PROJECT_NUM-compute@developer.gserviceaccount.com`? → **Path B** or **Path C**

> If you grant roles to a service account that doesn't exist, the binding may appear to
> succeed while builds actually run as a different identity — then fail at the deploy
> step with a confusing permission error. Run the pre-check first.

#### Path A — legacy Cloud Build account exists

```bash
PROJECT_ID=$(gcloud config get-value project)
PROJECT_NUM=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")
BUILD_SA="${PROJECT_NUM}@cloudbuild.gserviceaccount.com"

for ROLE in roles/run.admin roles/iam.serviceAccountUser roles/artifactregistry.writer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${BUILD_SA}" \
    --role="$ROLE" \
    --condition=None
done
```

Nothing else to change. Continue to 18d.

#### Path B — quickest fix: grant the compute default account

Same roles, applied to the account your builds already run as. Least effort; the
trade-off is that this account is broadly used, so it accumulates permissions.

```bash
PROJECT_ID=$(gcloud config get-value project)
PROJECT_NUM=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")
BUILD_SA="${PROJECT_NUM}-compute@developer.gserviceaccount.com"

for ROLE in roles/run.admin roles/iam.serviceAccountUser roles/artifactregistry.writer roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${BUILD_SA}" \
    --role="$ROLE" \
    --condition=None
done
```

Continue to 18d. No trigger changes needed.

#### Path C — dedicated build account (preferred)

A purpose-built identity that only does CI. Cleaner blast radius and the modern
recommended pattern.

```bash
PROJECT_ID=$(gcloud config get-value project)
PROJECT_NUM=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")

gcloud iam service-accounts create cicd-deployer \
  --display-name="Cloud Build deployer"

BUILD_SA="cicd-deployer@${PROJECT_ID}.iam.gserviceaccount.com"

# logging.logWriter is REQUIRED for user-specified service accounts —
# the legacy account had it implicitly, a custom one does not.
for ROLE in roles/run.admin roles/iam.serviceAccountUser roles/artifactregistry.writer roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${BUILD_SA}" \
    --role="$ROLE" \
    --condition=None
done

# Allow the build account to act as the Cloud Run runtime account
gcloud iam service-accounts add-iam-policy-binding \
  "${PROJECT_NUM}-compute@developer.gserviceaccount.com" \
  --member="serviceAccount:${BUILD_SA}" \
  --role="roles/iam.serviceAccountUser"

echo "Use this in the trigger (18d): ${BUILD_SA}"
```

With Path C you must **name the account on the trigger** — see the note in 18d.

> **`options: logging: CLOUD_LOGGING_ONLY` is mandatory here.** A build running as a
> user-specified service account refuses to start without it (or an explicit
> `logsBucket`). It is already present at the bottom of the `cloudbuild.yaml` in 18b —
> don't remove it. The resulting error mentions `build.service_account` needing a logs
> bucket and gives no hint that the service account is the cause.


### 18d. Create the trigger

1. Go to **GCP Console → Cloud Build → Triggers**
2. Click **Create Trigger**
3. Configuration:
   - **Name:** `deploy-on-push`
   - **Event:** Push to a branch
   - **Source:** Select your linked GitHub repo
   - **Branch:** `^main$`
   - **Configuration:** Cloud Build configuration file
   - **Location:** `/cloudbuild.yaml`
   - **Service account:** leave as default for Path A or B; for **Path C**, select
     `cicd-deployer@PROJECT_ID.iam.gserviceaccount.com`
4. Click **Create**

### 18e. Test it

```bash
git add cloudbuild.yaml
git commit -m "Add Cloud Build CI/CD pipeline"
git push
```

Go to **Cloud Build → History** in the GCP Console to watch the build run.

**If the build fails on permissions**, confirm which identity actually ran it — this is
usually different from the one you granted roles to:

```bash
gcloud builds list --limit=1 --format="value(id)"
gcloud builds describe BUILD_ID --format="value(serviceAccount)"
```

Grant the four roles from 18c to whatever that command returns, or re-point the trigger.

---

## 19. Connect Your GoDaddy Domain (danielmherman.com)

### 19a. Map the domain in Cloud Run

1. Go to **GCP Console → Cloud Run** → click on your `danielmherman` service
2. Click the **Integrations** or **Custom Domains** tab (under **Networking**)
3. Click **Add Custom Domain** (Cloud Run will use Google-managed SSL certificates)
4. Choose **Cloud Run domain mapping**
5. Enter `danielmherman.com`
6. Also add `www.danielmherman.com`
7. GCP will show you the **DNS records** you need to add — keep this page open

You'll typically see records like:

| Type | Name | Value |
|------|------|-------|
| A | @ | 216.239.32.21 |
| A | @ | 216.239.34.21 |
| A | @ | 216.239.36.21 |
| A | @ | 216.239.38.21 |
| AAAA | @ | 2001:4860:4802:32::15 |
| AAAA | @ | 2001:4860:4802:34::15 |
| AAAA | @ | 2001:4860:4802:36::15 |
| AAAA | @ | 2001:4860:4802:38::15 |
| CNAME | www | ghs.googlehosted.com. |

> The exact IPs may differ — use whatever GCP shows you, not these examples.

### 19b. Configure DNS in GoDaddy

1. Log in to **GoDaddy** → go to **My Products** → find `danielmherman.com`
2. Click **DNS** (or **Manage DNS**)
3. **Delete** any existing A records pointing to GoDaddy parking pages
4. **Add** the DNS records from the GCP console:

   **For the root domain (`danielmherman.com`):**
   - Add all 4 **A records** with Name `@` and the IP addresses GCP gave you
   - Add all 4 **AAAA records** with Name `@` and the IPv6 addresses GCP gave you

   **For www:**
   - Add a **CNAME record** with Name `www` pointing to `ghs.googlehosted.com.`

5. **Set TTL** to the lowest available (600 seconds / 10 minutes) for faster propagation

### 19c. Wait for DNS propagation & SSL

- **DNS propagation:** Usually 15-60 minutes, can take up to 48 hours
- **SSL certificate:** Google will auto-provision a free SSL cert. This can take 15-60 minutes after DNS propagates

### 19d. Verify it's working

Check DNS propagation:


```bash
# Check A records
dig danielmherman.com A +short

# Check CNAME
dig www.danielmherman.com CNAME +short

# Check SSL certificate status in GCP
gcloud run domain-mappings describe --domain danielmherman.com --region us-east1
```

Once the certificate shows `ACTIVE`, visit:
- `https://danielmherman.com`
- `https://www.danielmherman.com`

Both should show your Django site with a valid HTTPS certificate.

### 19e. (Optional) Redirect www to root (or vice versa)

If you want `www.danielmherman.com` to redirect to `danielmherman.com`, you can add Django middleware or handle it at the DNS level. A simple approach is to add this to your Django middleware or just map both in Cloud Run (both will serve the same content).

---

## 20. Post-Deployment Checklist

After everything is deployed, verify:

- [ ] Site loads at `https://danielmherman.com`
- [ ] Site loads at `https://www.danielmherman.com`
- [ ] Admin panel works at `https://danielmherman.com/admin/`
- [ ] You can log in with your superuser credentials
- [ ] You can create/edit an article with CKEditor
- [ ] Image uploads in CKEditor work (stored in Cloud Storage)
- [ ] Static files load correctly (CSS, JS)
- [ ] Site starts with **no content** (expected — clean sheet); you can author a new article in `/admin/` and see it render
- [ ] HTTPS works (no mixed content warnings)
- [ ] `git push` to main triggers an automatic deployment

---

## 21. Ongoing Workflow

Your day-to-day development process:

```
1.  Make changes locally (VS Code)
2.  Test with: python manage.py runserver
3.  Commit:    git add . && git commit -m "description of changes"
4.  Deploy:    git push origin main
5.  Cloud Build automatically:
      → Builds a new Docker image
      → Pushes it to Artifact Registry
      → Deploys it to Cloud Run
      → Runs database migrations
6.  Site is live in ~3-5 minutes
```

### Useful commands for monitoring

```bash
# View Cloud Run logs
gcloud run services logs read danielmherman --region us-east1 --limit 50

# View Cloud Build history
gcloud builds list --limit 5

# Check service status
gcloud run services describe danielmherman --region us-east1

# Connect to Cloud SQL (for debugging)
gcloud sql connect danielmherman-db --user=djangouser --database=danielmherman
```

### Estimated Monthly Costs

**As actually deployed** (no Memorystore, no VPC connector):

| Service | Estimated Cost |
|---------|---------------|
| Cloud Run (min-instances=0, scales to zero) | ~$0-2/month |
| Cloud SQL (db-f1-micro) | ~$7-10/month |
| Cloud Storage | ~$0.02/GB/month (negligible) |
| Cloud Build | 120 free build-minutes/day |
| Secret Manager | Free for low usage |
| **Total** | **~$10-15/month** |

> **Cloud SQL is the only component that bills while the site is idle** (~$0.25-0.35/day).
> Cloud Run at `--min-instances 0` is genuinely free when nobody is visiting. If you want
> to pause costs, stop the SQL instance — do **not** delete the Cloud Run service, since
> that destroys the domain mapping and forces a 15-60 minute SSL re-provision on return.

**If Memorystore is ever added** (see Section 6):

| Additional Service | Estimated Cost |
|---------|---------------|
| Memorystore Redis (1 GB basic) | ~$36/month |
| VPC Connector | ~$7-10/month |
| **Revised total** | **~$50-55/month** |

> **Cost-saving tip:** Deploy initially without Memorystore and the VPC Connector (~$10-15/month). Add them later when you build your first real-time app that needs WebSocket support.

---

## 22. Future: Adding New Django Apps

This deployment is designed to support multiple Django apps under one domain. Here's the pattern for adding new applications (e.g., a clinical dashboard, recommendation system):

### Adding a new Django app

```bash
# Create the app
python manage.py startapp clinical

# Then:
# 1. Add 'clinical' to INSTALLED_APPS in settings.py
# 2. Create models, views, templates, and URLs in the clinical/ directory
# 3. Include the app's URLs in danielmherman/urls.py
# 4. Run migrations locally, test, then push to GitHub
# 5. Cloud Build deploys automatically — no infra changes needed
```

Your site structure grows like this:

```
danielmherman.com/                    → portfolio (content app)
danielmherman.com/clinical-dashboard/ → clinical app
danielmherman.com/recommender/        → recommender app
danielmherman.com/admin/              → Django admin (manages all apps)
```

### Connecting to external ML prediction endpoints

Each ML application will have its own GCP project with its own data pipeline and prediction endpoint. Your Django apps call these endpoints over HTTPS:

```python
# Example: calling a prediction endpoint in another GCP project
import google.auth.transport.requests
import google.oauth2.id_token
import requests

def get_prediction(patient_data):
    endpoint_url = 'https://sepsis-predict-xxxxx-uc.a.run.app/predict'
    
    # Get an ID token for cross-project authentication
    auth_req = google.auth.transport.requests.Request()
    id_token = google.oauth2.id_token.fetch_id_token(auth_req, endpoint_url)
    
    response = requests.post(
        endpoint_url,
        json=patient_data,
        headers={'Authorization': f'Bearer {id_token}'}
    )
    return response.json()
```

### Cross-project IAM setup

For each external prediction service, grant the web project's service account `roles/run.invoker` on the target service:

```bash
# Run this in the ML project (e.g., danielmherman-clinical)
gcloud run services add-iam-policy-binding sepsis-predict \
  --region=us-east1 \
  --member="serviceAccount:WEB_PROJECT_NUM-compute@developer.gserviceaccount.com" \
  --role="roles/run.invoker"
```

### When to enable Memorystore (Redis)

Memorystore is **not** deployed (Section 6). The trigger to add it is narrower than it
first appears: you need it only when **multiple processes must broadcast to each other**
— for example a live dashboard where several viewers see the same updates pushed
simultaneously.

You do **not** need it for:

- Streaming one agent response to one user (SSE or a single WebSocket held by one
  worker — Cloud Run pins a WebSocket to one instance for its lifetime anyway)
- A2UI rendering — WebSockets are a *proposed, unimplemented* transport in that spec,
  and user actions travel as ordinary tool calls
- Sessions, per-user quota, or LangGraph checkpointing — Cloud SQL handles all three,
  and unlike Redis it is durable

If you do add it, create the resources from Section 6, enable `redis.googleapis.com` and
`vpcaccess.googleapis.com`, then:

```bash
REDIS_HOST=$(gcloud redis instances describe danielmherman-redis --region=us-east1 --format="value(host)")

gcloud run services update danielmherman \
  --region us-east1 \
  --vpc-connector danielmherman-connector \
  --update-env-vars "REDIS_HOST=${REDIS_HOST}"
```

> `--update-env-vars` adds this variable without disturbing the others — unlike
> `--set-env-vars`, which would replace the entire set. Because `settings.py` keys the
> channel layer on the presence of `REDIS_HOST`, this one command is the whole switch;
> no code change is required.

---

## Troubleshooting

### "Error: Connection refused" on Cloud SQL
- Make sure `--add-cloudsql-instances` was set during deployment
- Verify the connection name is correct

### Static files not loading (404)
- Make sure `collectstatic` runs during Docker build
- Check that WhiteNoise is in MIDDLEWARE

### CKEditor uploads fail
- Check Cloud Storage bucket permissions
- Verify CORS settings on the bucket
- Make sure `django-storages` is configured correctly

### "DisallowedHost" error
- Add your domain to `ALLOWED_HOSTS` env var in Cloud Run

### SSL certificate stuck on "PENDING"
- Verify DNS records are correct with `dig`
- Wait up to 24 hours (usually much faster)
- Make sure you deleted old GoDaddy parking page A records
