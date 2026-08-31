# §1 — Demo Authentication & Per-User Quota

## Scope

The demo console is the **only public surface** in a topology where the agent and MCP services are IAM-private Cloud Run endpoints. This section owns two gates: **who gets in** (authentication) and **how much spend each session can burn** (a per-user daily quota that caps calls to the billable agent). It is the choke point every paid request crosses.

**Purpose of the capability:** issue a visitor an identity, gate the console behind login, and enforce a hard per-user daily budget on agent calls — claiming the credit *before* the agent is invoked and refunding it when no answer materializes, so a burst of concurrent requests can never all pass a post-hoc check.

**Key technologies:**
- Stock `django.contrib.auth` (`auth.User`, issued accounts — no signup route; login/logout via `django.contrib.auth.urls`; `@login_required` on all demo views).
- `DemoQuota` — a `OneToOne` per-user counter (`daily_limit` default 10, `used`, `period_start`) enforced by **atomic `UPDATE` statements**, deliberately avoiding read-modify-write so the cap holds under concurrency. Lazy daily rollover, no cron.
- `agent_client.ask()` — mints a **per-request ID token** (GCE metadata server in prod; `gcloud` subprocess fallback locally), audience = the agent's service URL, to reach the private agent. 120 s timeout (two cold starts).
- `DEMO_FIXTURE_MODE` — serves **captured real payloads** (`demo/data/demo_fixtures/`) under the same response contract when paid endpoints are torn down; honest `source: 'fixture'` marker, free-text requires the live agent.
- A2UI canvas variant (`/demo/a2ui/ask/`) — mirrors the ask path but composes the UI as A2UI v0.9 messages with **deterministic section-intent citation resolution** (the canvas never trusts the model's `^[n]` numbers, which are known to mis-number).

## Adversarial Review Pass

Each section was reviewed twice: a primary pass, then an **independent adversarial model** instructed to falsify the primary's mental model and find what the primary missed, plus automated scanners (bandit, pip-audit, `manage.py check --deploy`). §1 ran the **blind** protocol — the adversarial pass had no prior assumptions about the code. Findings below are grouped by theme; IDs map to the site backlog (`REVIEW_BACKLOG.md`).

### The production gate fails open

- **S1-01 · Major** — `IS_PRODUCTION` is keyed to a single env var (`ENVIRONMENT == 'production'`) that **defaults to `development`**, and the Cloud Build deploy step sets no env vars. A missing/misspelled var — or a service recreated from the repo — silently deploys a **public site with `DEBUG=True`, the committed fallback `SECRET_KEY`, insecure cookies, and no SSL redirect**. *Remediation:* fail closed (require `ENVIRONMENT`, raise `ImproperlyConfigured` on unknown values); set the vars in the deploy step; add `check --deploy` as a CI gate.
- **S1-18 · Minor** — `check --deploy` reports 6 warnings (W004 no HSTS; W008/W012/W016/W018 SSL/secure-cookie/DEBUG; W009 fallback key) that **corroborate S1-01** — the local run isn't `production`, so all prod hardening is simultaneously absent. *Remediation:* covered by S1-01 + CI gate.
- **S1-12 · Minor** — No `SECURE_HSTS_SECONDS` despite `SECURE_SSL_REDIRECT` being set — first-visit transport can be downgraded. *Remediation:* ramp HSTS up.

### Fixture mode defaults to on

- **S1-02 · Major** — `DEMO_FIXTURE_MODE` **defaults to `true`** and is silent. A prod deploy that omits `DEMO_FIXTURE_MODE=false` serves captured fixtures instead of the live agent — the exact "fixtures-as-the-real-thing" failure the project's no-shortcuts stance forbids. The payload is honest (`source: 'fixture'`), but the page never signals mode. *Remediation:* default to `false`; hard-fail at startup if fixture mode is on under `ENVIRONMENT=production`.

### The spend cap can be defeated

- **S1-09 · Major** — **Refund loop.** `hadm_id` is never validated against the `DemoPatient` cohort, and tool-error failures are always refunded. A request guaranteed to error downstream (nonexistent admission → `predict_readmission` returns `{"error": …}`) burns a **full Gemini round trip** on every request yet is always refunded — the quota stops being a spend limit for its most expensive component. Unvalidated ids also open prompt-injection/id-probing against the agent. *Remediation:* validate `hadm_id` server-side against the cohort; refund only failures that provably spent nothing (e.g., connection refused pre-dispatch), or cap refunds per user per day.
- **S1-11 · Minor** — The agent's JSON response shape is never validated: a non-dict body or non-dict tool response raises an unhandled exception → **500 after the credit was consumed**, outside the `AgentError`/`_tools_errored` refund paths. A misbehaving upstream burns user quota via crashes. *Remediation:* validate shape right after `ask_agent`; treat malformed shapes as `AgentError` so the existing refund path runs.
- **S1-07 · Minor** — `refund()` is day-scoped, not credit-scoped: it filters on `period_start = localdate()`, so a consume before midnight + refund after midnight targets the new day's counter — the credit is silently lost (or a fresh day's counter is decremented). *Remediation:* have `consume()` return the debited period (a claim token) for `refund()` to target.
- **S1-08 · Minor** — Per-user cap only; no global daily budget / kill switch (roadmap item). Low risk while accounts are manually issued.

### Auth surface hardening

- **S1-05 · Major** — No throttling/lockout on `/accounts/login/` or `/admin/` (the latter at the **default path**). Quota caps agent spend, not credential guessing; admin controls quotas and content. *Remediation:* django-axes or equivalent; move/shield admin (non-default path, allowlist, or IAP).
- **S1-06 · Minor** — `django.contrib.auth.urls` exposes password-change/reset routes with no templates (`registration/` has only `login.html`) → `TemplateDoesNotExist` (500) on those paths. *Remediation:* include only the intended login/logout routes.
- **S1-04 · Minor** — No session-expiry override: default **2-week** `SESSION_COOKIE_AGE`, survives browser close — a stolen demo cookie is valid for two weeks. *Remediation:* `SESSION_EXPIRE_AT_BROWSER_CLOSE=True` or a short `SESSION_COOKIE_AGE`.

### Information disclosure

- **S1-03 · Major** — The 502 response returns `detail: str(exc)` to the client. `requests` exceptions embed the **private agent host:port**; the test guards only the `error` field, not `detail`. *Remediation:* log server-side; return a fixed generic `detail`.
- **S1-10 · Minor** — `DEMO_AGENT_URL` **defaults to the real private service URL** in settings — internal topology in source, and with the S1-01 fail-open any misconfigured instance mints ID tokens for prod. *Remediation:* require the URL from env/secret; empty default.
- **S1-13 · Minor** — CKEditor `htmlSupport` allow-all + `GS_DEFAULT_ACL='publicRead'` (cross-cutting; owned by §6). Stored-XSS-by-configuration if any author is less than fully trusted; uploads world-readable. *Remediation:* restrict `htmlSupport`; set `CKEDITOR_5_FILE_UPLOAD_PERMISSION='staff'`; reconsider bucket-wide public read.

### Serving / concurrency

- **S1-15 · Minor** — `ask_agent` is a **blocking `requests.post` (120 s) in sync views** under ASGI/uvicorn (2 workers). Sync views run on a bounded thread pool; a few concurrent slow agent calls (or the S1-09 loop) can exhaust it and **stall the entire public site**, including login/content. *Remediation:* async (`httpx`) or a per-instance semaphore; size Cloud Run concurrency to the pool.
- **S1-14 · Minor** — The site container runs as **root** (agent/MCP images use `USER 1000`). *Remediation:* add a non-root `USER` after `collectstatic`.

### Dependencies & scanners

- **S1-16 · Major** — **72 known CVEs in 4 packages** (pip-audit): `Django==6.0` (39 → fix ≥6.0.8), `pillow==12.1.0` (27 → 12.3.0), `sqlparse==0.5.5` (4 → 0.6.0), `bleach==4.1.0` (2 GHSA → 6.4.0 — bleach is the HTML sanitizer; a vulnerable sanitizer undermines the stored-XSS defense). *Remediation:* upgrade pins; re-run the scan.
- **S1-17 · Minor** — bandit: 10 issues, all Low (7×B106 hardcoded password in tests — false positives; B404/B603/B607 on the gated local-only `gcloud` subprocess — fixed args, no shell). *Remediation:* awareness; optionally `# nosec`.

## Remediation Scope

**Summary:** §1 is a fail-open posture problem more than a logic problem. The three Critical-class themes — prod hardening not guaranteed (S1-01), fixture mode silently defaulting on (S1-02), and a refund loop that nullifies the spend cap (S1-09) — are all *configuration and boundary* fixes, not rewrites. The demo's core mechanisms (DB-atomic quota, claim-before-spend, ID-token minting) are sound and should be preserved; remediation tightens the edges around them. Recommended order: **fail closed → harden the boundary → sanitize the client contract → CI gate**.

**Detail:**
1. **Fail closed (S1-01, S1-18, S1-12, S9-01 ties).** Require `ENVIRONMENT` (no permissive default), raise `ImproperlyConfigured` on unknown values; declare all prod env vars in the Cloud Build deploy step (`--set-env-vars` / `--env-vars-file`, secrets via `--set-secrets`); add HSTS; add `manage.py check --deploy` to CI.
2. **Fixture mode (S1-02).** Default `DEMO_FIXTURE_MODE=false`; hard-fail at startup if enabled under `ENVIRONMENT=production`. Fixtures remain dev scaffolding only.
3. **Spend-cap integrity (S1-09, S1-11, S1-07).** Validate `hadm_id` against the cohort before calling the agent (treat the cohort as the server-side authorization boundary); refund only provably-unspent failures or cap refunds per user/day; validate the agent response shape so crashes route through the refund path; make `refund()` target the debited credit period.
4. **Auth surface (S1-05, S1-06, S1-04).** Add login/admin throttling; move admin off the default path; trim `auth.urls` to login/logout; shorten session lifetime.
5. **Client contract (S1-03, S1-10, S1-13).** Log exceptions server-side and return a generic 502 `detail`; require `DEMO_AGENT_URL` from env; restrict CKEditor `htmlSupport` and the media ACL (owned by §6).
6. **Serving (S1-15, S1-14).** Move agent calls off the sync thread pool (async or semaphore); run the container as a non-root user.
7. **Dependencies (S1-16).** Upgrade to the fixed versions and re-scan; wire pip-audit + bandit into CI as guards.
