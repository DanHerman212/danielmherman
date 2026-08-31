# §1 — Demo auth + per-user quota

**Scope:** the public demo's authentication and its per-user daily spend cap — the choke point that gates the entire system. Django is the *only* public service in the topology; the agent and MCP services behind it are IAM-private. This section is where a visitor is authenticated and where every paid call is budgeted.

---

## Part 1 — How it works

### Authentication: issued accounts, no self-service surface

Authentication is stock `django.contrib.auth` on the default `auth.User` model. Accounts are provisioned out-of-band (`createsuperuser` / admin) — `urls.py` includes `django.contrib.auth.urls` for login/logout only, and a regression test asserts that no signup route exists. All demo views are `@login_required`, so unauthenticated access redirects to the login view preserving `?next=`.

Production hardening is gated on `ENVIRONMENT == 'production'`: `SECRET_KEY` comes from Secret Manager, and the prod block sets `SECURE_SSL_REDIRECT`, `SECURE_PROXY_SSL_HEADER`, `SESSION_COOKIE_SECURE`, and `CSRF_COOKIE_SECURE`. CSRF is enforced site-wide via `CsrfViewMiddleware` with `CSRF_TRUSTED_ORIGINS` from environment.

### Quota: a DB-atomic daily spend cap, claimed before spend

`DemoQuota` is a OneToOne per user (`daily_limit` default 10, `used`, `period_start`). The counter rolls over lazily on first use of a new day — no cron.

`consume()` is a single atomic `UPDATE ... SET used = used + 1 WHERE used < daily_limit AND period_start = today`. The read-modify-write alternative is deliberately avoided: two concurrent requests would both read N and both write N+1, and the limit would quietly stop holding under load. The day rollover is a separate guarded `UPDATE ... WHERE period_start < today`, so a racing loser's grant UPDATE simply matches no rows. `refund()` decrements guarded by `used > 0` — it can never drive the counter negative.

The views follow a **claim-before-spend** pattern: consume the credit *before* invoking the agent (so a burst of concurrent requests can't all pass a post-hoc check), and refund on `AgentError` or on **graceful tool-error payloads** — the MCP tools return `{"error": ...}` with HTTP 200 when a downstream endpoint is down, and a credit must never be consumed for an answer that never materialized.

### The ask path: browser → Django → IAM-private agent

The browser POSTs JSON to `/demo/ask/` (CSRF-protected, `@require_POST`). `_question_for` normalizes input: starter chips map to server-composed prompts with the `hadm_id` embedded (so phrasing can't be edited into a leading question), and free text is length-capped at 2000 chars. In live mode, `agent_client.ask()` mints a per-request **ID token** — audience is the agent's *service URL*, not the path — via the GCE metadata server in production, with a gcloud-subprocess fallback locally gated on the ADC credential type. The agent is never reached directly by the browser.

### Fixture mode: honest offline scaffolding

`DEMO_FIXTURE_MODE` (default true while the paid endpoints are torn down for cost) answers starter chips from captured real payloads (`demo/data/demo_fixtures/`) under the same response contract, so the live/fixture switch is zero-change for the client. Free text gets an explicit "live agent required" error rather than a fabricated answer, and the response carries `source: 'fixture'` + a fixture note so the trace view is honest about mode.

### The A2UI variant

`/demo/a2ui/ask/` mirrors `ask` (identical quota/refund/fixture semantics) but composes the canvas as **A2UI v0.9 messages** with **deterministic section-intent citation resolution** (`intent_sections`). The canvas deliberately never trusts the model's `^[n]` numbers — they are known to mis-number — and `renumber_citations` fixes display order.

### Failure modes (by design)

`@login_required` redirect for anonymous; 400 for malformed input *before* quota is touched; 429 on exhaustion (agent never called); 502 + refund on agent/tool failure; production 500s go to stdout → Cloud Logging.

---

## Part 2 — Findings and remediation

Reviewed by an independent adversarial pass (a second model instructed to assume everything is broken) against the code, plus automated scanners. Grouped by theme; each maps to an ID in the structured backlog.

### The production/development gate fails open

- **S1-01 · Major — `IS_PRODUCTION = ENVIRONMENT == 'production'`, defaulting to `'development'`; `DEBUG = not IS_PRODUCTION`.** The Cloud Build deploy step sets no env vars, so a missing/misspelled `ENVIRONMENT` — or recreating the service from the repo — yields a public deployment running `DEBUG=True` with the committed `django-insecure-...` SECRET_KEY fallback and insecure cookies. *Remediation:* fail closed — require `ENVIRONMENT` and raise `ImproperlyConfigured` on unknown values; declare the env vars in the deploy step (`--set-env-vars` / `--env-vars-file`).
- **S1-18 · Minor — `manage.py check --deploy` reports 6 warnings** (W004 HSTS; W008/W012/W016/W018 on SSL redirect, secure cookies, DEBUG; W009 on the fallback key) that independently corroborate S1-01 and S1-12. *Remediation:* add the check as a CI gate.
- **S1-12 · Minor — No HSTS.** `SECURE_HSTS_SECONDS` (and preload/includeSubdomains) is unset, so first-visit transport can be downgraded despite `SECURE_SSL_REDIRECT`. *Remediation:* add HSTS (ramp up from a low value).

### Fixture mode defaults to on

- **S1-02 · Major — `DEMO_FIXTURE_MODE` defaults to `true` and is silent.** A production deploy that omits `DEMO_FIXTURE_MODE=false` serves captured payloads instead of the live agent — violating the project's rule that fixtures are dev scaffolding, never the public surface. *Remediation:* default to false; forbid fixture mode under `ENVIRONMENT=production` (fail loudly at startup).

### The spend cap has a refund loop

- **S1-09 · Major — `hadm_id` is never validated against the cohort, and tool-error failures are always refunded.** A request guaranteed to make a downstream tool error (a nonexistent admission → `predict_readmission` returns `{"error": ...}`) burns a full Gemini round trip every time, yet the credit is refunded — defeating the spend cap for its most expensive component. *Remediation:* validate `hadm_id` against `DemoPatient` server-side; refund only failures that provably spent nothing (e.g., connection refused pre-dispatch), or cap refunds per user per day.
- **S1-11 · Minor — The agent response shape is never validated.** A non-dict body or non-dict tool response raises an unhandled exception → 500 *after* the credit was consumed, outside the `AgentError`/`_tools_errored` refund paths. *Remediation:* validate `result`/`tool_calls` shape immediately after `ask_agent`; treat malformed shapes as `AgentError` so the existing refund path runs.
- **S1-07 · Minor — `refund()` is day-scoped, not credit-scoped.** It filters on `period_start = localdate()`, but a consume before midnight + refund after midnight targets the new day's counter — the credit is silently lost, or a fresh day's counter is decremented. *Remediation:* have `consume()` return the debited period (or a claim token) for `refund()` to target.
- **S1-08 · Minor — Per-user cap only; no global budget / kill switch** (documented roadmap item). Low risk while accounts are manually issued.

### No throttling on the auth surface

- **S1-05 · Major — No rate limiting on `/accounts/login/` or `/admin/`** (the latter at the default path). Quota caps agent spend, not credential guessing; admin controls quotas and content. *Remediation:* django-axes or equivalent; non-default admin path / allowlist / IAP.
- **S1-06 · Minor — `django.contrib.auth.urls` exposes password-change/reset routes with no templates** (`demo/templates/registration/` has only `login.html`) → `TemplateDoesNotExist` (500) on those paths. *Remediation:* include only the intended login/logout routes.
- **S1-04 · Minor — No session-expiry override.** Default 2-week `SESSION_COOKIE_AGE`, survives browser close — a stolen session cookie is valid for two weeks. *Remediation:* `SESSION_EXPIRE_AT_BROWSER_CLOSE=True` or a short `SESSION_COOKIE_AGE`.

### Information disclosure

- **S1-03 · Major — The 502 response returns `detail: str(exc)`.** `requests` exceptions embed the private agent host:port; the test guards only the `error` field, not `detail`. *Remediation:* log the exception server-side; return a fixed generic `detail`.
- **S1-10 · Minor — `DEMO_AGENT_URL` defaults to the real private service URL** in settings. *Remediation:* require it from env/secret.
- **S1-13 · Minor — CKEditor `htmlSupport` allow-all + `GS_DEFAULT_ACL='publicRead'`** (cross-cutting; owned by §6). *Remediation:* restrict/sanitize server-side; fix the media ACL.

### Serving/concurrency

- **S1-15 · Minor — Blocking `requests.post` (120s timeout) in sync views under ASGI/uvicorn (2 workers).** Sync views run on a bounded thread pool; a few concurrent slow agent calls can exhaust it and stall the whole site, including login. *Remediation:* async (`httpx`) or a per-instance semaphore; size Cloud Run concurrency to the pool.
- **S1-14 · Minor — The site container runs as root** (the agent/MCP images use `USER 1000`). *Remediation:* add a non-root `USER` after `collectstatic`.

### Dependencies and scanners

- **S1-16 · Major — 72 known CVEs in 4 packages** (`pip-audit`): `Django==6.0` (39), `pillow==12.1.0` (27), `sqlparse==0.5.5` (4), `bleach==4.1.0` (2 GHSA). *Remediation:* upgrade to the fixed versions (Django ≥6.0.8, Pillow ≥12.3.0, sqlparse ≥0.6.0, bleach ≥6.4.0); re-run the scan.
- **S1-17 · Minor — bandit: 10 issues, all Low** (7×B106 hardcoded password in tests; B404/B603/B607 on the local-only `gcloud` subprocess in `agent_client.py`). *Remediation:* awareness; optionally `# nosec` the gated local subprocess.
