# Deploying danielmherman.com to Google Cloud Platform

A complete step-by-step guide for deploying this Django app to **Google Cloud Run** using **ASGI (uvicorn)**, with **GitHub CI/CD** via Cloud Build, **Cloud SQL (PostgreSQL)** for the database, **Cloud Storage** for media files, **Memorystore (Redis)** for Django Channels, and a **custom domain from GoDaddy**.

> **Architecture note:** This deployment uses ASGI (uvicorn) instead of WSGI (gunicorn) to support WebSocket connections for future real-time applications (e.g., clinical dashboards, live data feeds). Standard HTTP views work identically under ASGI — there is no downside to starting with it. Future Django apps (clinical dashboard, recommendation system, etc.) will be added to this project and served as pages under the same domain. ML model inference will be served from separate GCP projects via dedicated prediction endpoints.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Create a GCP Project](#2-create-a-gcp-project)
3. [Install & Configure the gcloud CLI](#3-install--configure-the-gcloud-cli)
4. [Set Up Cloud SQL (PostgreSQL)](#4-set-up-cloud-sql-postgresql)
5. [Set Up a Cloud Storage Bucket (Media Files)](#5-set-up-a-cloud-storage-bucket-media-files)
6. [Set Up Memorystore (Redis)](#6-set-up-memorystore-redis)
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
17. [Migrate Existing Data from SQLite (Optional)](#17-migrate-existing-data-from-sqlite-optional)
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
  compute.googleapis.com \
  redis.googleapis.com \
  vpcaccess.googleapis.com
```

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
   - Set a default region — choose **`us-central1`** (good general-purpose region)

4. Confirm your config:

```bash
gcloud config list
```

---

## 4. Set Up Cloud SQL (PostgreSQL)

### 4a. Create the Cloud SQL instance

```bash
gcloud sql instances create danielmherman-db \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region=us-central1 \
  --root-password=YOUR_DB_ROOT_PASSWORD
```

> **`db-f1-micro`** is the smallest/cheapest tier (~$7-10/month). Good for a personal site.

### 4b. Create a database

```bash
gcloud sql databases create danielmherman --instance=danielmherman-db
```

### 4c. Create a database user

```bash
gcloud sql users create djangouser \
  --instance=danielmherman-db \
  --password=CHOOSE_A_STRONG_PASSWORD
```

### 4d. Note your connection name

```bash
gcloud sql instances describe danielmherman-db --format="value(connectionName)"
```

This will output something like: `danielmherman-123456:us-central1:danielmherman-db`

**Save this value** — you'll need it later.

---

## 5. Set Up a Cloud Storage Bucket (Media Files)

This bucket will store uploaded images (article images, CKEditor uploads, etc.).

```bash
# Create the bucket (name must be globally unique)
gsutil mb -l us-central1 gs://danielmherman-media

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

## 6. Set Up Memorystore (Redis)

Redis is used as the channel layer backend for Django Channels, enabling WebSocket support for future real-time dashboard apps.

### 6a. Create a VPC Connector

Cloud Run needs a Serverless VPC Access connector to reach Memorystore (which runs on a private VPC):

```bash
gcloud compute networks vpc-access connectors create danielmherman-connector \
  --region=us-central1 \
  --range=10.8.0.0/28
```

### 6b. Create the Redis instance

```bash
gcloud redis instances create danielmherman-redis \
  --size=1 \
  --region=us-central1 \
  --redis-version=redis_7_0 \
  --tier=basic
```

> **`basic` tier** is the cheapest (~$0.049/GB/hour ≈ ~$36/month for 1 GB). You can skip this step for the initial portfolio deployment and add it later when you build the first real-time app. If you skip it, also skip the `--vpc-connector` flag in the Cloud Run deploy command (Section 14).

### 6c. Note the Redis host IP

```bash
gcloud redis instances describe danielmherman-redis --region=us-central1 --format="value(host)"
```

**Save this IP** — you'll need it for the `REDIS_HOST` environment variable in Cloud Run.

---

## 7. Store Secrets in Secret Manager

Never hardcode secrets. Store them in GCP Secret Manager:

```bash
# Django secret key — generate a random one
python -c "import secrets; print(secrets.token_urlsafe(50))" | \
  gcloud secrets create django-secret-key --data-file=-

# Database password
echo -n "CHOOSE_A_STRONG_PASSWORD" | \
  gcloud secrets create db-password --data-file=-
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

> **Key changes from WSGI plan:** `gunicorn` is replaced by `uvicorn[standard]`, and `channels` + `channels-redis` are added for WebSocket support.

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
    SECRET_KEY = 'django-insecure-81v8x+^5s3_(@!r@ga4_7tti5pghtnnyig0!0_g=gj_#h^cb5x'

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

if IS_PRODUCTION:
    CHANNEL_LAYERS = {
        'default': {
            'BACKEND': 'channels_redis.core.RedisChannelLayer',
            'CONFIG': {
                'hosts': [(os.environ.get('REDIS_HOST', '127.0.0.1'), 6379)],
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

# Install system dependencies (needed for psycopg2)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy project files
COPY . .

# Collect static files
RUN ENVIRONMENT=collectstatic python manage.py collectstatic --noinput 2>/dev/null || true

# Expose port
EXPOSE 8080

# Run with uvicorn (ASGI) — supports HTTP + WebSocket
CMD exec uvicorn danielmherman.asgi:application \
    --host 0.0.0.0 \
    --port 8080 \
    --workers 2 \
    --timeout-keep-alive 120
```

> **Why uvicorn instead of gunicorn?** Uvicorn is a native ASGI server that supports both regular HTTP requests and WebSocket connections. All existing Django views work identically. When you add real-time apps with Django Channels, they'll work without any server changes.

---

## 10. Create .dockerignore

Create `.dockerignore` in your project root:

```
venv/
__pycache__/
*.pyc
db.sqlite3
.git/
.gitignore
*.md
media/
.env
.DS_Store
get-pip.py
docs/
images/
```

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
  --location=us-central1 \
  --description="Docker images for danielmherman.com"
```

---

## 14. Deploy to Cloud Run (First Time — Manual)

For the first deployment, build and deploy manually to make sure everything works.

### 14a. Build and push the image

```bash
PROJECT_ID=$(gcloud config get-value project)

# Build the image using Cloud Build
gcloud builds submit --tag us-central1-docker.pkg.dev/${PROJECT_ID}/danielmherman-repo/danielmherman:latest
```

### 14b. Deploy to Cloud Run

```bash
CLOUD_SQL_CONNECTION=$(gcloud sql instances describe danielmherman-db --format="value(connectionName)")
REDIS_HOST=$(gcloud redis instances describe danielmherman-redis --region=us-central1 --format="value(host)")

gcloud run deploy danielmherman \
  --image us-central1-docker.pkg.dev/${PROJECT_ID}/danielmherman-repo/danielmherman:latest \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --add-cloudsql-instances ${CLOUD_SQL_CONNECTION} \
  --vpc-connector danielmherman-connector \
  --set-env-vars "ENVIRONMENT=production" \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=${PROJECT_ID}" \
  --set-env-vars "CLOUD_SQL_CONNECTION_NAME=${CLOUD_SQL_CONNECTION}" \
  --set-env-vars "GS_BUCKET_NAME=danielmherman-media" \
  --set-env-vars "ALLOWED_HOSTS=danielmherman.com,www.danielmherman.com,.run.app" \
  --set-env-vars "CSRF_TRUSTED_ORIGINS=https://danielmherman.com,https://www.danielmherman.com" \
  --set-env-vars "REDIS_HOST=${REDIS_HOST}" \
  --min-instances 1 \
  --max-instances 3 \
  --memory 512Mi
```

> **Key differences from basic deployment:**
> - `--vpc-connector` enables access to Memorystore Redis (private VPC)
> - `--min-instances 1` avoids cold starts — important for future real-time dashboard apps
> - `REDIS_HOST` env var connects Django Channels to Redis
>
> **If you skipped Memorystore (Section 6):** Remove the `--vpc-connector` and `REDIS_HOST` lines. You can add them later when you build your first real-time app.

After deployment, you'll get a URL like `https://danielmherman-xxxxxxxxxx-uc.a.run.app`. Visit it to verify your site is running.

> **If you see errors**, check the logs:
> ```bash
> gcloud run services logs read danielmherman --region us-central1 --limit 50
> ```

---

## 15. Run Database Migrations in Production

Cloud Run doesn't automatically run migrations. You need to run them after each deployment that includes model changes.

### Option A: Use a Cloud Run Job (recommended)

```bash
PROJECT_ID=$(gcloud config get-value project)
CLOUD_SQL_CONNECTION=$(gcloud sql instances describe danielmherman-db --format="value(connectionName)")

gcloud run jobs create migrate \
  --image us-central1-docker.pkg.dev/${PROJECT_ID}/danielmherman-repo/danielmherman:latest \
  --region us-central1 \
  --set-env-vars "ENVIRONMENT=production" \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=${PROJECT_ID}" \
  --set-env-vars "CLOUD_SQL_CONNECTION_NAME=${CLOUD_SQL_CONNECTION}" \
  --set-cloudsql-instances ${CLOUD_SQL_CONNECTION} \
  --command "python" \
  --args "manage.py,migrate"

# Execute the migration job
gcloud run jobs execute migrate --region us-central1 --wait
```

For subsequent migrations, just execute the job again (after deploying the new image):

```bash
gcloud run jobs update migrate \
  --image us-central1-docker.pkg.dev/${PROJECT_ID}/danielmherman-repo/danielmherman:latest \
  --region us-central1

gcloud run jobs execute migrate --region us-central1 --wait
```

---

## 16. Create a Superuser in Production

You need an admin user to access `/admin/`:

```bash
PROJECT_ID=$(gcloud config get-value project)
CLOUD_SQL_CONNECTION=$(gcloud sql instances describe danielmherman-db --format="value(connectionName)")

gcloud run jobs create createsuperuser \
  --image us-central1-docker.pkg.dev/${PROJECT_ID}/danielmherman-repo/danielmherman:latest \
  --region us-central1 \
  --set-env-vars "ENVIRONMENT=production" \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=${PROJECT_ID}" \
  --set-env-vars "CLOUD_SQL_CONNECTION_NAME=${CLOUD_SQL_CONNECTION}" \
  --set-env-vars "DJANGO_SUPERUSER_USERNAME=admin" \
  --set-env-vars "DJANGO_SUPERUSER_EMAIL=your-email@example.com" \
  --set-env-vars "DJANGO_SUPERUSER_PASSWORD=CHOOSE_A_STRONG_PASSWORD" \
  --set-cloudsql-instances ${CLOUD_SQL_CONNECTION} \
  --command "python" \
  --args "manage.py,createsuperuser,--noinput"

gcloud run jobs execute createsuperuser --region us-central1 --wait
```

> **Important:** After running this, delete the job so the password isn't stored:
> ```bash
> gcloud run jobs delete createsuperuser --region us-central1 --quiet
> ```

---

## 17. Migrate Existing Data from SQLite (Optional)

If you have existing articles, projects, and categories you want to keep:

### 17a. Export from SQLite locally

```bash
python manage.py dumpdata content --indent 2 > data_export.json
```

### 17b. Upload to Cloud Storage

```bash
gsutil cp data_export.json gs://danielmherman-media/data_export.json
```

### 17c. Import into Cloud SQL via a Cloud Run Job

```bash
PROJECT_ID=$(gcloud config get-value project)
CLOUD_SQL_CONNECTION=$(gcloud sql instances describe danielmherman-db --format="value(connectionName)")

gcloud run jobs create loaddata \
  --image us-central1-docker.pkg.dev/${PROJECT_ID}/danielmherman-repo/danielmherman:latest \
  --region us-central1 \
  --set-env-vars "ENVIRONMENT=production" \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=${PROJECT_ID}" \
  --set-env-vars "CLOUD_SQL_CONNECTION_NAME=${CLOUD_SQL_CONNECTION}" \
  --set-cloudsql-instances ${CLOUD_SQL_CONNECTION} \
  --command "bash" \
  --args "-c,gsutil cp gs://danielmherman-media/data_export.json /tmp/data.json && python manage.py loaddata /tmp/data.json"

gcloud run jobs execute loaddata --region us-central1 --wait
```

### 17d. Upload existing media files

```bash
# Upload all your local media files to the bucket
gsutil -m cp -r media/* gs://danielmherman-media/
```

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
      - 'us-central1-docker.pkg.dev/$PROJECT_ID/danielmherman-repo/danielmherman:$COMMIT_SHA'
      - '-t'
      - 'us-central1-docker.pkg.dev/$PROJECT_ID/danielmherman-repo/danielmherman:latest'
      - '.'

  # Push the image to Artifact Registry
  - name: 'gcr.io/cloud-builders/docker'
    args:
      - 'push'
      - '--all-tags'
      - 'us-central1-docker.pkg.dev/$PROJECT_ID/danielmherman-repo/danielmherman'

  # Deploy to Cloud Run
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    entrypoint: gcloud
    args:
      - 'run'
      - 'deploy'
      - 'danielmherman'
      - '--image'
      - 'us-central1-docker.pkg.dev/$PROJECT_ID/danielmherman-repo/danielmherman:$COMMIT_SHA'
      - '--region'
      - 'us-central1'
      - '--platform'
      - 'managed'

  # Run migrations
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    entrypoint: gcloud
    args:
      - 'run'
      - 'jobs'
      - 'update'
      - 'migrate'
      - '--image'
      - 'us-central1-docker.pkg.dev/$PROJECT_ID/danielmherman-repo/danielmherman:$COMMIT_SHA'
      - '--region'
      - 'us-central1'
    
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    entrypoint: gcloud
    args:
      - 'run'
      - 'jobs'
      - 'execute'
      - 'migrate'
      - '--region'
      - 'us-central1'
      - '--wait'

images:
  - 'us-central1-docker.pkg.dev/$PROJECT_ID/danielmherman-repo/danielmherman:$COMMIT_SHA'
  - 'us-central1-docker.pkg.dev/$PROJECT_ID/danielmherman-repo/danielmherman:latest'

options:
  logging: CLOUD_LOGGING_ONLY
```

### 18c. Grant Cloud Build permissions

Cloud Build needs permission to deploy to Cloud Run and access Cloud SQL:

```bash
PROJECT_NUM=$(gcloud projects describe $(gcloud config get-value project) --format="value(projectNumber)")

# Grant Cloud Run Admin
gcloud projects add-iam-policy-binding $(gcloud config get-value project) \
  --member="serviceAccount:${PROJECT_NUM}@cloudbuild.gserviceaccount.com" \
  --role="roles/run.admin"

# Grant Service Account User (needed to deploy)
gcloud projects add-iam-policy-binding $(gcloud config get-value project) \
  --member="serviceAccount:${PROJECT_NUM}@cloudbuild.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"

# Grant Artifact Registry Writer
gcloud projects add-iam-policy-binding $(gcloud config get-value project) \
  --member="serviceAccount:${PROJECT_NUM}@cloudbuild.gserviceaccount.com" \
  --role="roles/artifactregistry.writer"
```

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
4. Click **Create**

### 18e. Test it

```bash
git add cloudbuild.yaml
git commit -m "Add Cloud Build CI/CD pipeline"
git push
```

Go to **Cloud Build → History** in the GCP Console to watch the build run.

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
gcloud run domain-mappings describe --domain danielmherman.com --region us-central1
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
- [ ] All existing content appears (if you migrated data)
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
gcloud run services logs read danielmherman --region us-central1 --limit 50

# View Cloud Build history
gcloud builds list --limit 5

# Check service status
gcloud run services describe danielmherman --region us-central1

# Connect to Cloud SQL (for debugging)
gcloud sql connect danielmherman-db --user=djangouser --database=danielmherman
```

### Estimated Monthly Costs

| Service | Estimated Cost |
|---------|---------------|
| Cloud Run (min-instances=1) | ~$3-5/month |
| Cloud SQL (db-f1-micro) | ~$7-10/month |
| Memorystore Redis (1 GB basic) | ~$36/month (skip until needed) |
| Cloud Storage | ~$0.02/GB/month (negligible) |
| Cloud Build | 120 free build-minutes/day |
| Secret Manager | Free for low usage |
| VPC Connector | ~$7/month (skip if no Memorystore) |
| **Total (without Redis)** | **~$10-15/month** |
| **Total (with Redis)** | **~$50-55/month** |

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
  --region=us-central1 \
  --member="serviceAccount:WEB_PROJECT_NUM-compute@developer.gserviceaccount.com" \
  --role="roles/run.invoker"
```

### When to enable Memorystore (Redis)

If you skipped Memorystore in Section 6, enable it when you add your first app that needs WebSocket support (e.g., real-time clinical dashboard). Then update the Cloud Run service to include the VPC connector and Redis host:

```bash
REDIS_HOST=$(gcloud redis instances describe danielmherman-redis --region=us-central1 --format="value(host)")

gcloud run services update danielmherman \
  --region us-central1 \
  --vpc-connector danielmherman-connector \
  --update-env-vars "REDIS_HOST=${REDIS_HOST}"
```

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
