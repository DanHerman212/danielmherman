# Architecture and infrastructure

Two products, one Django project, deployed as one service. This document covers what the
application is built from, where it runs, and the path a copilot question takes beyond it.

## Application

Ordinary Django: models define the data, class-based views select and shape it, templates
present it. The repository holds two apps — `content` for the site and `demo` for the
copilot — which share the platform below them and nothing else.

```mermaid
flowchart TD
  client["Browser"]

  subgraph app["Django application"]
    direction LR
    urls["URL dispatcher"] --> views["Views"]
    views --> templates["Templates"]
    views --> models["Models"]
    admin["Admin"] --> models
  end

  data["Primary database"]
  media["Object storage"]

  client -->|"HTTP request"| urls
  templates -->|"rendered page"| client
  models <-->|"ORM"| data
  media -.->|"uploaded images"| templates
```

The database is Postgres in production and SQLite in development, behind the same ORM.
Nothing in the application knows which one it is talking to.

## Deployment

Google Cloud, in `us-east1`. The service scales to zero when idle, and the database is
managed rather than run by the application.

```mermaid
flowchart TD
  client["Browser"]
  github["GitHub repository"]

  subgraph gcp["Google Cloud — us-east1"]
    direction LR
    web["Cloud Run<br/>Django"]
    jobs["Cloud Run jobs<br/>migrate · createsuperuser"]
    sql["Cloud SQL<br/>Postgres"]
    store["Cloud Storage<br/>media"]
    secrets["Secret Manager"]
    build["Cloud Build"]
    registry["Artifact Registry"]
  end

  client -->|"custom domain, HTTPS"| web
  web -->|"socket"| sql
  web <-->|"media files"| store
  web -.->|"secrets as env vars"| secrets
  jobs -->|"apply migrations"| sql
  github -->|"push to main"| build
  build -->|"image"| registry
  registry -->|"deploy"| web
  build -->|"run"| jobs
```