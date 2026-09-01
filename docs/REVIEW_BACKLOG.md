# Site Review Backlog — danielmherman

Strategy + phases: `enterprise_clinical_copilot/docs/code_review_plan.md`.
Decisions locked 2026-08-29 — adversarial model: **Claude Fable 5** (subagent
override); primary pass: main assistant (DeepSeek V4 Flash); **review-only
first**; done = **zero Critical/Major open**. Cross-repo risk order spans both
repos; §1 (auth + quota) is reviewed first across the whole review.

## Section status

| # | Section | Location | Status | Protocol | Notes |
|---|---|---|---|---|---|
| §1 | Demo auth + per-user quota | `demo/` | **review complete** (primary + adversarial) — backlog S1-01…S1-15 | Blind | Crown jewel — the public surface a stranger can touch. Two-pass coverage confirmed. |
| §6 | Admin + content | `content/` | **review complete** (primary + cross-check adversarial) — S6-01…S6-13 | Cross-check | Public blog/admin exposure. |
| §7 | Front-end JS | `demo/static/` → `static/js/`, `static/vendor/a2ui/` | **review complete** (primary + cross-check adversarial) — S7-01…S7-17 | Cross-check | Demo flow, A2UI renderer, splitpane. Strong XSS posture, real races. |
| §9 | Django config | `danielmherman/` | **review complete** (primary + cross-check adversarial) — S9-01…S9-07 | Cross-check | settings, urls, deployment config. `manage.py check --deploy`. |
| Deps | Dependencies (CVE) | `requirements.txt` | pending (up-front) | Scanner | Run first — cheap, high-signal; feeds backlog early. |

## §1 Understand — Demo auth + per-user quota

**Scope:** the demo BFF in `danielmherman/demo/` — how a user signs in, what the
console is, and how the per-user daily quota gates agent calls. Auth is Django
built-in (`django.contrib.auth`); the demo adds the quota model, the agent
proxy, fixture mode, and the A2UI variant.

**Entry points (route → view → purpose):**

| Route | View | Purpose | Auth |
|---|---|---|---|
| `/accounts/login/` | `django.contrib.auth.views.LoginView` | sign-in | public (needed to sign in) |
| `/accounts/logout/` | built-in | sign out → redirect `home` | — |
| `/demo/` | `views.console` | patient rail + split-pane thread (`console.html`) | `@login_required` |
| `/demo/ask/` | `views.ask` | POST proxy → agent; returns JSON | `@login_required` + `@require_POST` |
| `/demo/a2ui/` | `views.a2ui_console` | A2UI-rendered canvas page | `@login_required` |
| `/demo/a2ui/ask/` | `views.a2ui_ask` | A2UI variant of ask | `@login_required` + `@require_POST` |
| `/demo/guide/` | `guide_views.guide` | static Demo User Guide | `@login_required` |
| `/admin/` | Django admin | demo patient/quota admin | admin auth |

**How auth operates:**
- Accounts are **issued, not self-registered**. `danielmherman/urls.py` includes
  `django.contrib.auth.urls` (login/logout) and explicitly has **no signup
  route**; `test_no_signup_route_exists` guards this. Accounts are created via
  `manage.py createsuperuser` or the admin. Default `auth.User` (no custom user
  model), standard password validators.
- `LOGIN_URL='login'`, `LOGIN_REDIRECT_URL='demo:console'`,
  `LOGOUT_REDIRECT_URL='home'`. Demo views are `@login_required` →
  unauthenticated users redirected to login (preserving `?next=`).
- Production security (when `ENVIRONMENT=production`): `SECRET_KEY` from Secret
  Manager, `SECURE_SSL_REDIRECT`, `SECURE_PROXY_SSL_HEADER`,
  `SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE`. CSRF enforced site-wide
  (`CsrfViewMiddleware`); `CSRF_TRUSTED_ORIGINS` + `ALLOWED_HOSTS` from env.

**How quota operates (the spend cap):**
- `demo.models.DemoQuota` — OneToOne per user: `daily_limit` (default
  `DEMO_DAILY_LIMIT`=10), `used`, `period_start` (the day `used` refers to).
- **Enforced atomically in the DB**, deliberately not read-modify-write (two
  concurrent requests must not both pass on the last credit).
  - `consume()`: `get_or_create` quota → lazily roll over if `period_start <
    today` (guarded `period_start__lt`, racing loser's UPDATE matches no rows)
    → single `UPDATE … SET used=used+1 WHERE used < daily_limit`. True iff a
    row updated.
  - `refund()`: `UPDATE … SET used=used-1 WHERE used > 0` (never negative).
  - `remaining()`: stale day → full limit; else `max(limit - used, 0)`.
- **Claim-before-spend** in `ask`: quota consumed *before* the agent call (so a
  burst can't all pass a post-check); **refunded** if the call fails or the
  agent's tools return error payloads.
- `DemoQuotaAdmin` keeps `used` editable — "raising someone's limit or clearing
  a counter mid-demo is the whole reason this is in the admin."
- `period_start` stored (no nightly cron) → counter resets lazily on first
  request of a new day; no scheduled job to fail silently.

**The ask flow (browser → Django → agent → MCP → Vertex):**
1. Browser POSTs JSON to `/demo/ask/`.
2. `_question_for()` normalizes input: chip → mapped question text (server
   embeds the admission id: "For admission N"), or free text (≤ 2000 chars), or
   default risk phrasing.
3. **Fixture mode** (`DEMO_FIXTURE_MODE`, default **true**): answers starter
   chips from **captured real payloads** (`demo/data/demo_fixtures/`) — risk
   computed by the real serving predictor on synthetic features, rag passages
   from the 2026-08-11 live captures. Free-text/unknown chips get a clear "use
   the live agent" message. **No agent call, no quota consume.**
4. **Live mode:** `DemoQuota.consume()` first; then `agent_client.ask()`.
5. `agent_client.ask()`: POSTs to `{DEMO_AGENT_URL}/ask` with an **ID token
   minted per-request** for the private Cloud Run service (audience = service
   URL, not the path). Prod: metadata server mints it. Local: ADC is a user
   credential → falls back to `gcloud auth print-identity-token` (subprocess;
   unreachable in the container image by design). Timeout `DEMO_AGENT_TIMEOUT`
   (120s — two cold starts).
6. `AgentError` (unreachable / non-200 / non-JSON): refund credit → **502** with
   generic message; agent internals logged server-side, not leaked.
7. **Graceful tool errors** (MCP tools return `{"error": …}` with HTTP 200 when
   Vertex is down): `_tools_errored()` detects → refund → 502. A credit is never
   silently consumed for an answer that never materialized.
8. Success: attach `remaining`, return agent JSON.

**A2UI variant (`/demo/a2ui/ask/`):** mirrors `ask` (identical quota/refund/
fixture) but the canvas is composed as **A2UI messages** via
`compose_risk_canvas(predict, rag, cite, sections)` in `a2ui_canvas.py`.
Citation resolution is **deterministic by section intent** (`intent_sections`),
NOT the model's `^[n]` numbers — the model mis-numbers citations, so the canvas
must not trust them; `renumber_citations` fixes display order.

**Fixture mode specifics:** `CHIPS` (risk/meds/summarize/compare) → composed
questions. `_cohort_risk()` = hadm_id → full predict payload (lru_cached).
`risk_for`/`band_for` derive low/borderline/high from the model's own
threshold. **Honesty rule:** patients without captured rag passages return the
honest empty result (`returned: 0`), never fabricated prose. Response carries
`source: 'fixture'` + `fixture_note` so the trace view is honest about mode.

**Config (settings.py):** `DEMO_AGENT_URL` (service URL = ID-token audience),
`DEMO_AGENT_TIMEOUT` (120), `DEMO_DAILY_LIMIT` (10), `DEMO_FIXTURE_MODE`
(true), login redirects, `CSRF_TRUSTED_ORIGINS`, `ALLOWED_HOSTS`, prod security
flags, Cloud Logging via stdout.

**Failure modes (expected behavior):** unauthenticated → login redirect; bad
input/malformed JSON → 400 before quota; quota exhausted → 429 (agent never
called); agent unreachable/error/tool error → 502 + refund; endpoint down +
fixture mode → chips still answerable from captured payloads (dev scaffolding
only); production 500s → stdout → Cloud Logging.

**Test coverage (`demo/tests.py`, ~57 tests):** `DemoAuthTests` (require login,
no signup route), `QuotaTests` (limit, rollover, refund, first-use),
`AskEndpointTests` (happy path, free text, 429-before-call, refund-on-failure,
bad-input-before-quota, malformed JSON, GET denied, internals not leaked),
`FixtureModeTests`, `A2uiCanvasTests` + `A2uiAskLiveTests` (canvas + section-
intent citations + live quota/refund/502), `ConsoleTests`.

**Areas to probe in the review passes (not findings yet):** session hardening
(prod-only secure-cookie flags, session expiry defaults ~2wk, fixation),
whether `django.contrib.auth.urls` exposes unintended self-service
(password-change/reset) routes, UTC day-boundary semantics for quota rollover,
`get_or_create` race in `consume`, no per-minute rate limit on login (brute
force) or ask beyond quota, ID-token subprocess path reachability, fixture-mode
quota bypass (dev scaffolding only).

## §6 Understand — Admin + content

**Scope:** `danielmherman/content/` — the public blog/portfolio (home, articles,
projects, resume, contact) + Django admin. The second public surface after the
demo (§1).

**Models (`content/models.py`):** `Category` (taxonomy, active flag), `Article`
(category FK, title, slug, **CKEditor5 rich-HTML `content`**, featured_image,
published flags), `Project` (title, slug, **CKEditor5 content**, links, `drilldown`
flag), `ContactMessage` (name/email/subject/message from the public form). Slugs
auto-generated via `slugify(title)` on save.

**Views (`content/views.py`):**
- `HomeView` — homepage (featured published articles + active categories). Public.
- `CategoryView` / `ArticleListView` — published articles by category / all
  (paginated 10). Public; both filter `is_published`.
- `ArticleDetailView` — single published article (filters `is_published`). Public.
- `ArticlePreviewView` — **`staff_member_required`** (draft preview).
- `ProjectListView` / `ProjectDetailView` / `ProjectSectionView` — active
  projects; `drilldown` splits content via `decorate_sections` into per-section
  URLs. Public; filter `is_active`.
- `ProjectPreviewView` — `staff_member_required`.
- `ResumeView` — hardcoded experience data. Public.
- `ContactView` — GET renders the form; POST creates `ContactMessage` (**no rate
  limit, no server-side length/email validation** — only "all fields present").
  CSRF-protected (template has `{% csrf_token %}`). Public.

**Sectioning (`content/sectioning.py`):** splits `Project.content` HTML on h2
headings into sections (cards + per-section pages); h3+ stay in the body with
injected anchors; rebuilds HTML via a custom `HTMLParser`. Pure + tested
(`SectioningTests`).

**Admin (`content/admin.py`):** Category/Article/Project/ContactMessage admins;
preview links via `format_html` (safe); ContactMessage read-only (auto-escaped).
Sits at `/admin/` default path with no throttling (S1-05).

**Rendering — the `|safe` surface:** `article_detail.html`
(`article.content|safe`), `project_detail.html` (`project.content|safe`),
`project_section.html` (`section.body|safe` ×3). Rich HTML is rendered
**unescaped by design** (needed for formatting). Combined with the CKEditor
`htmlSupport` allow-all config (S1-13), any HTML a staff author enters executes
for every visitor — the trust boundary is "staff-only authoring," not
sanitization.

**Failure modes (expected):** draft → 404; inactive project → excluded; unknown
section slug → 404; duplicate title → slug unique error → 500 on admin save;
oversized contact field → DB DataError → 500.

**Test coverage:** only `content/tests.py` `SectioningTests`. **No view/form/auth/
rendering tests** for the public content surface.

**Probe areas (not findings yet):**
- Stored-XSS chain: `|safe` + CKEditor allow-all — is any non-staff path able to
  inject into content? (Contact messages are stored but never rendered as HTML;
  there is no comments feature.)
- Contact form: no spam/rate control; no server-side length/email validation →
  500s / junk rows.
- Slug auto-collision → 500 on duplicate titles.
- No content-view tests (auth gating, publishing filters).

## §7 Understand — Front-end JS

**Scope:** the hand-written demo JS (`static/js/demo_flow.js`, `demo_a2ui.js`,
`demo_splitpane.js`) + the vendored A2UI renderer (`static/vendor/a2ui/`). The
custom demo (`/demo/`) and the A2UI demo (`/demo/a2ui/`) share one flow; only
the canvas renderer differs.

**`demo_flow.js` — shared flow:** owns patient rail (search/pagination/select),
the thread (chapters, starter chips, free text), the ask flow (POST JSON +
`X-CSRFToken` from the cookie), episodic per-patient memory, sidebar view
switching, and the trace toggle. **Escaping discipline is strong:**
- `esc()` escapes `& < > " '` in the right order.
- User turns render via `textContent`; agent turns via `citedMarkdown` = markdown
  built from **escaped** text (docstring: "no raw HTML survives esc()"), then
  `createContextualFragment`.
- Citations become `<sup>` elements via `textContent` (safe); error/remaining
  values via `textContent`.
- `renderAgentMarkdown` wraps escaped lines in `<p>/<ul>/<li>/<strong>/<em>/<code>`.
- `api.showEmpty(markup)` uses **`innerHTML`** — today only called with constant
  strings (latent sink).

**`demo_splitpane.js` — custom canvas renderer:** builds RISK / DRIVERS / SOURCE
/ TRACE widgets. Risk numbers interpolated into `innerHTML` (numeric — safe);
feature names, passage text, query, fixture note all via `esc()`/`textContent`
(safe).

**`demo_a2ui.js` — A2UI renderer wiring:** feeds the agent-composed A2UI
envelope into the vendored `MessageProcessor`; mounts a fresh surface per run.
The **vendored markdown provider (`a2ui_markdown-it` + markdown-it 14) runs
DOMPurify on its output** — so A2UI `data`-model values (rendered as markdown
by the basic Text component) are sanitized client-side. Trace/envelope display
via `textContent`/JSON.stringify. `envelopeForCite` re-points the SourceCard to
the cited passage (section-intent resolution, mirrors the server).

**`a2ui_risk_components.js` — custom A2UI components:** RiskBar / FactorBars /
SourceCard / TraceCard. Built with **lit `html` tagged templates (auto-escaping)**
— note passage text in the SourceCard and tool-call payloads in the TraceCard
are escaped by lit.

**XSS posture (the crux — positive):** every data path is defended — agent
prose (escaped markdown), note passages (textContent / lit), A2UI data model
(DOMPurify), feature names (textContent). **No exploitable XSS found** in the
demo JS. The residual surface is `showEmpty`'s innerHTML (constants-only today)
and the absence of CSP (S6-10).

**Failure modes (expected):** malformed predict payload → `NaN%` display (no
client-side number validation); `extractSection` client-side section logic can
diverge from the server's (citation shows wrong section); empty states via
`showEmpty` constants.

**Test coverage:** demo JS has no unit tests (server-side `A2uiCanvasTests`
cover the envelope; `demo/tests.py` covers page rendering).

**Probe areas (not findings yet):** `showEmpty` innerHTML latent sink; client-
side `SECTION_ALIASES` is a 4th copy of the section vocabulary (ties ECC-33);
no CSP (S6-10); client trusts predict payload numbers (NaN/garbage display);
markdown-on-escaped-text display quirks.

## §9 Understand — Django config

**Scope:** `danielmherman/danielmherman/` (settings, urls, asgi, wsgi) + `manage.py`
— the last section. Most config-level risk was **already captured** in §1/§5:
S1-01 (ENVIRONMENT/DEBUG fail-open), S1-04 (session expiry), S1-12 (HSTS),
S1-13 (CKEditor allow-all + `GS_DEFAULT_ACL=publicRead`), S6-10 (no CSP),
S1-16 (CVE), S1-14 (Dockerfile root). §9 adds the config-completeness view.

**settings.py:** env-driven (`ENVIRONMENT` gates prod), Secret Manager for
`SECRET_KEY`/`db-password`, Postgres via Cloud SQL in prod / SQLite locally,
Whitenoise + manifest-hashed staticfiles, GCS media in prod (`publicRead`),
prod security block (SSL redirect, secure cookies, proxy header), Channels with
InMemory CHANNEL_LAYERS (Redis only when `REDIS_HOST` set), LOGGING → stdout
(Cloud Logging). AUTH_PASSWORD_VALIDATORS present. `TIME_ZONE=UTC`.

**asgi.py:** Channels `ProtocolTypeRouter` with **HTTP only** (no WebSocket
routed today); `get_asgi_application()` initialized early. **wsgi.py/manage.py:**
standard.

**The config reality (ties S1-01/ECC-46):** the entire runtime config depends on
env vars (`ENVIRONMENT`, `ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS`,
`CLOUD_SQL_CONNECTION_NAME`, `GS_BUCKET_NAME`, `DEMO_AGENT_URL`,
`DEMO_FIXTURE_MODE`, `REDIS_HOST`) that are **not committed or enumerated in one
place**; defaults (`localhost:8000` CSRF origin, `localhost` ALLOWED_HOSTS) are
local-dev values, so a prod deploy missing a var fails confusingly (all POSTs
403 without CSRF_TRUSTED_ORIGINS; 400 without ALLOWED_HOSTS) rather than
failing fast at startup.

**Failure modes (expected):** missing env → 400/403/DEBUG-on (S1-01);
`manage.py check --deploy` 6 warnings (S1-18); WebSockets would silently use
InMemory broadcast if added without REDIS.

**Probe areas (not findings yet):**
- No startup-time config validation / fail-fast on missing prod env.
- No single documented list of required env vars (config manifest).
- The rest is cross-referenced to existing findings.

## Findings backlog (severity-ranked)

*Status 2026-08-30: **REVIEW PHASE COMPLETE.** §1 complete (S1-01…S1-18) +
scanners. **§6 complete** (S6-01…S6-13). **§7 complete** (S7-01…S7-17). **§9
complete 2026-08-30** (primary + cross-check adversarial; merged S9-01…S9-07).
Cross-check independently confirmed S1-01/S1-12/S1-13 and added 5 new items.
Ready for the remediation phase.*

| ID | Section | Severity | Category | Location | Finding | Remediation | Status |
|---|---|---|---|---|---|---|---|
| S1-01 | §1 | Major | security/ops | `danielmherman/settings.py` (`ENVIRONMENT`/`DEBUG`); `cloudbuild.yaml` | Production mode keyed off a single env var (`ENVIRONMENT == 'production'`) that **defaults to `development`**, and the build pipeline's `run deploy` step never sets it. If the var is unset or misspelled (or the service is recreated from this file), prod silently runs `DEBUG=True`, the insecure fallback `SECRET_KEY`, non-secure cookies, and no SSL redirect. | Fail-closed: require an explicit `ENVIRONMENT` (no permissive default) or gate on a `DEBUG` flag; set `ENVIRONMENT=production` in the cloudbuild deploy step; add `manage.py check --deploy` as a CI gate. **RESOLVED 2026-08-31:** ENVIRONMENT required + validated (production/development/collectstatic); cloudbuild deploy + jobs set the full runtime env. | resolved |
| S1-02 | §1 | Major | ops/correctness | `danielmherman/settings.py` (`DEMO_FIXTURE_MODE`); `demo/views.py` | Fixture mode **defaults to `true`** and is silent (env-driven). A production deploy that omits `DEMO_FIXTURE_MODE=false` serves captured fixtures instead of the live agent — exactly what the no-shortcuts stance forbids (fixtures are dev scaffolding, never the thing shown as live). Payload is honest (`source: 'fixture'`) but the page never signals mode. | Default to `false`; forbid fixture mode when `ENVIRONMENT=production` (fail loudly at startup); require explicit opt-in. **RESOLVED 2026-08-31:** defaults false; raises ImproperlyConfigured if true in production; fixture tests pin it on. | resolved |
| S1-03 | §1 | Major | security (info disclosure) | `demo/views.py` (`ask`, `a2ui_ask` 502 `detail`) | The 502 response returns `'detail': str(exc)` to the client. Network errors embed the private agent host:port (`requests` exception text); `AgentError('https://agent-internal/ask 403')` lands verbatim. The test only guards the `error` field, not `detail`. Adversarial pass rates Major: it contradicts the same module's own sanitization intent for non-200 responses. | Log exception server-side; return a fixed generic `detail` to the client. | **resolved 2026-08-31** — both 502s log the exception server-side and drop the `detail` field entirely; test asserts no private URL fragment anywhere in the body |
| S1-04 | §1 | Minor | security (session) | `danielmherman/settings.py` | No `SESSION_EXPIRE_AT_BROWSER_CLOSE` / `SESSION_COOKIE_AGE` override → default **2-week** session; survives browser close. A stolen demo cookie is valid for 2 weeks. | `SESSION_EXPIRE_AT_BROWSER_CLOSE=True` (or a short `SESSION_COOKIE_AGE`) for the demo surface. | **resolved 2026-08-31** — `SESSION_EXPIRE_AT_BROWSER_CLOSE=True`; sessions hold only auth (quota is DB-backed), so a stolen demo cookie dies with the tab |
| S1-05 | §1 | Major | security/ops | `/accounts/login/`, `/admin/` (default path) | No throttling/lockout on the auth surface (login or admin); admin sits at the default `/admin/` path. Quota caps agent spend, not credential guessing. Adversarial pass rates Major: two well-known endpoints, and admin controls quotas + content. | Add throttling/lockout (django-axes or equivalent); move/shield admin (non-default path, allowlist, or IAP). Admin hardening also tracked under §6. | **resolved 2026-08-31** — django-axes 8.3.1 (5 failures → 1h lockout, username-keyed behind the shared Cloud Run LB IP); admin moved off /admin/ to env-configurable ADMIN_PATH (default /staff-console/); production DatabaseCache + createcachetable wired into the cloudbuild migrate job. IAP remains a documented cloud-side option |
| S1-06 | §1 | Minor | ops | `danielmherman/urls.py` (`auth.urls`) | `django.contrib.auth.urls` exposes password-change/reset routes; `demo/templates/registration/` has only `login.html` → those paths raise TemplateDoesNotExist (500). | Include only the intended login/logout routes; add templates only if a self-service flow is wanted. | **resolved 2026-08-31** — explicit `/accounts/login/` + `/accounts/logout/` routes; password_change/reset no longer mounted (they 500'd on missing templates); added registration/logged_out.html |
| S1-07 | §1 | Minor | correctness | `demo/models.py` (`DemoQuota`), `demo/views.py` | Two boundary issues. (a) Rollover keyed to `timezone.localdate()` (UTC) — resets at UTC midnight for every user. (b) `refund()` is day-scoped but not tied to the credit `consume()` debited: a consume before midnight + refund after midnight targets the new day's counter (credit silently lost), or decrements the new day for a credit consumed yesterday. | Have `consume()` return the period it debited (or a claim token) for `refund()` to target; or `period_start__lte=today`. Document the UTC boundary. | **resolved 2026-08-31** — `consume()` returns the debited date as a claim token; `refund(user, period)` matches only that period (stale credits dropped, never misapplied); UTC boundary documented on the model |
| S1-08 | §1 | Minor | ops | `deployment_strategy.md` (roadmap) | Per-user quota only; no global daily budget / kill switch (planned, not built). Low risk while accounts are issued (small N). | Tracked on the deployment roadmap; re-evaluate before any public window. | open |
| S1-09 | §1 | Major | security | `demo/views.py` (`ask`, `a2ui_ask`), `demo/models.py` | **Refund loop defeats the spend cap.** `hadm_id` is never validated against the `DemoPatient` cohort; a request guaranteed to make a downstream tool error (e.g. nonexistent admission id → `predict_readmission` returns `{"error": …}`) burns a full Gemini round trip on every request yet is always refunded — the quota stops being a spend limit for the most expensive component. Same for timeout-induced refunds. Unvalidated free text / arbitrary ids also open prompt-injection and id-probing against the agent. | Validate `hadm_id` against `DemoPatient` before calling the agent; refund only failures that provably consumed no model spend (e.g. connection refused pre-dispatch) or cap refunds per user per day. Treat the demo cohort as the server-side authorization boundary. | **resolved 2026-08-31** — both: `_question_for` rejects ids outside `DemoPatient` before quota/agent; refunds for billed failures capped per day (`DEMO_DAILY_REFUND_CAP`, default 3), pre-dispatch zero-spend failures (`AgentError.spent=False`) refund freely |
| S1-10 | §1 | Minor | security | `danielmherman/settings.py` (`DEMO_AGENT_URL` default) | The real private agent URL (`https://agent-jamycsjjzq-ue.a.run.app`) is committed as the env default — discloses internal topology in source, and with the S1-01 fail-open, any misconfigured/dev instance silently points at + mints ID tokens for the production agent. | Default to empty string (client already raises a clear error); require the URL via env/secret. **RESOLVED 2026-08-31:** default removed from settings; URL set per-deploy in cloudbuild; required at boot in production. | resolved |
| S1-11 | §1 | Minor | correctness | `demo/views.py`, `demo/agent_client.py` | Agent JSON response shape never validated: a non-dict body or non-dict tool response raises an unhandled exception → 500 **after** the credit was consumed, and the refund paths only cover `AgentError` and `_tools_errored`. A misbehaving upstream burns user quota via crashes. | Validate `result` is a dict (and `tool_calls` entries are dicts) right after `ask_agent`; treat malformed shapes as `AgentError` so the existing refund path runs. | **resolved 2026-08-31** — `_validated()` in agent_client rejects malformed bodies/tool_calls as `AgentError`, routing through the refund path |
| S1-12 | §1 | Minor | security | `danielmherman/settings.py` | No HSTS: `SECURE_SSL_REDIRECT`, secure cookies, `SECURE_PROXY_SSL_HEADER` are set, but `SECURE_HSTS_SECONDS` (+ preload/includeSubdomains) is absent — first-visit/downgrade interception of the session cookie transport remains possible. | Set `SECURE_HSTS_SECONDS` (ramp up), plus `SECURE_HSTS_INCLUDE_SUBDOMAINS`/`SECURE_HSTS_PRELOAD` as appropriate. | **resolved 2026-08-31** — `SECURE_HSTS_SECONDS=2592000` (30d, ramp), `INCLUDE_SUBDOMAINS=True`, `PRELOAD=False` (demo site, not a preload candidate); covered by a prod-settings test |
| S1-13 | §1 | Minor | security | `danielmherman/settings.py` (CKEditor + storage) | CKEditor `htmlSupport` allows every element with all attributes/classes/styles (`{'name': '/.*/', 'attributes': True, …}`) — stored-XSS-by-configuration if any content author is less than fully trusted — and the `django_ckeditor_5` upload route is mounted publicly at `/ckeditor5/` with no `CKEDITOR_5_FILE_UPLOAD_PERMISSION` pinned, while `GS_DEFAULT_ACL='publicRead'` makes uploads world-readable. **Owned by §6 (admin/content); captured here since it lives in settings.** | Restrict `htmlSupport` to a concrete allowlist; set `CKEDITOR_5_FILE_UPLOAD_PERMISSION="staff"`; reconsider `publicRead` as bucket-wide default. | **resolved 2026-08-31** — htmlSupport restricted to a concrete tag allowlist (mirrors the nh3 server-side list); `CKEDITOR_5_FILE_UPLOAD_PERMISSION="staff"`; `publicRead` kept deliberately (portfolio media is public by design) and documented in settings |
| S1-14 | §1 | Minor | ops | `Dockerfile` | Container runs as root — no `USER` directive. Any code-execution bug grants root inside the container (Cloud Run sandbox limits blast radius, but it drops a standard defense layer). | Add a non-root user (`RUN adduser --system app` / `USER app`) after `COPY`/`collectstatic`. | **resolved 2026-08-31** — `RUN useradd --system --no-create-home app` + `USER app` after collectstatic; uvicorn now runs unprivileged |
| S1-15 | §1 | Minor | architecture | `demo/agent_client.py`, `demo/views.py`, `Dockerfile` | `ask_agent` is a blocking `requests.post` with a 120s timeout in sync views under ASGI/uvicorn (2 workers). Sync views run on a bounded thread pool per worker; a few concurrent slow agent calls (or the S1-09 refund loop) can exhaust the pool and stall the whole public site, including login/content. | Async view with `httpx`, or a per-instance semaphore/queue around agent calls; size Cloud Run concurrency to the thread pool. | **resolved 2026-08-31** — per-instance `BoundedSemaphore(DEMO_AGENT_MAX_CONCURRENCY=4)` around the agent call; full slots fail fast (5s) with a zero-spend `AgentError` |
| S1-16 | Deps | Major | security (dependencies) | `requirements.txt` | **72 known CVEs in 4 packages** (pip-audit 2026-08-30): `Django==6.0` (39 CVEs → fix 6.0.8), `pillow==12.1.0` (27 → 12.3.0), `sqlparse==0.5.5` (4 → 0.6.0), `bleach==4.1.0` (2 GHSA → 6.4.0; bleach is the HTML sanitizer — a vulnerable sanitizer undermines the stored-XSS defense behind CKEditor content). | **RESOLVED 2026-08-31:** Django→6.0.8, pillow→12.3.0, sqlparse→0.6.0; bleach removed (zero first-party imports — not the active sanitizer). pip-audit clean; 57 tests pass. | resolved |
| S1-17 | §1 | Minor | security | bandit scan (site) | 10 issues, all **Low**: 7×B106 hardcoded password in `demo/tests.py` (false positive — test setup); B404/B603/B607 all on the `gcloud` subprocess in `demo/agent_client.py` (local-only ID-token path; no shell, fixed args — verified low risk). | None required beyond awareness; optionally `# nosec` the local-only subprocess. | **resolved 2026-08-31** — `# nosec` on the local-only gcloud subprocess (B404/B603/B607); test-password findings remain documented false positives |
| S1-18 | §1 | Minor | ops | `manage.py check --deploy` | 6 warnings. W004 (no HSTS) confirms **S1-12**. W008/W012/W016/W018 (SSL redirect, secure session/CSRF cookies, DEBUG) fire only because the local run isn't `ENVIRONMENT=production` — **corroborates S1-01 fail-open** (prod misconfig ⇒ all of these at once). W009 = insecure fallback `SECRET_KEY` (same root cause). | Covered by S1-01/S1-12 remediation; add `check --deploy` to CI as a gate. | open |
| S6-01 | §6 | Major | security | `content/templates/content/*.html` (`|safe`), `content/models.py` (`CKEditor5Field`) | **Stored XSS: no server-side sanitization.** Rich-HTML content is rendered unescaped (`article.content|safe`, `project.content|safe`, `section.body|safe`). Cross-check reframed the root cause: `htmlSupport` is client-side editor config — the **server performs no sanitization at all**, so any HTML written into `content` (via the admin's `sourceEditing`, a direct DB write, or any client) executes for every visitor. Boundary = staff-only authoring with no backstop. | Add a server-side sanitizer (bleach/defusedhtml) before render; restrict `htmlSupport`; treat authoring as a trusted-but-limited boundary. | **resolved 2026-08-31** — new `content_extras.sanitize` filter (nh3, concrete tag/attr/scheme allowlist) replaces every content `|safe`; htmlSupport restricted (S1-13); render-time sanitization catches sourceEditing/DB-write/any-client paths |
| S6-02 | §6 | Major | ops | `content/views.py` (`ContactView.post`) | The public contact form has **no rate limiting / spam protection** (upgraded per cross-check): any anonymous POST creates a `ContactMessage` row, and `message` is an unbounded `TextField` — a bot can insert unlimited multi-MB rows (prod Postgres bloat, inbox burying). | Use a Django `Form` with `max_length`; add per-IP throttling (cache-based) + a honeypot field. | **resolved 2026-08-31** — ContactForm caps message at 5000 chars (and enforces the model's length limits); honeypot hidden field is silently dropped; per-IP throttle (5 valid submissions/hour, X-Forwarded-For aware) via the Django cache |
| S6-03 | §6 | Major | correctness | `content/views.py` (`ContactView.post`) | No server-side validation → **500 in production** (upgraded per cross-check): `objects.create()` skips validation; on prod **PostgreSQL**, `name` > 100 / `email` > 254 / `subject` > 200 chars raises `DataError` → unhandled 500 (dev SQLite silently stores). HTML `required`/`type=email` are the only validation and are trivially bypassed. | A `ModelForm` with `is_valid()` fixes length/email validation and the 500. | **resolved 2026-08-31** — ContactView validates via ContactForm (is_valid), saves through the form, and re-renders with errors instead of crashing on PostgreSQL length limits |
| S6-04 | §6 | Minor | correctness | `content/models.py` (`Article.save`, `Project.save`) | Slug auto-generation via `slugify(title)` — two items with the same title collide on the unique constraint → **500 on admin save**. | Dedupe slugs (append a suffix) or handle `IntegrityError` with a clear message. | **resolved 2026-08-31** — Article.save / Project.save dedupe via _unique_slug() (-2, -3, … suffixes); same-title rows save cleanly |
| S6-05 | §6 | Minor | ops | `content/tests.py` | Only `SectioningTests` exist — **no tests for the public content surface**: view auth gating (staff previews), publishing/active filters, the contact form, or the `|safe` rendering. | Add view/rendering tests mirroring the demo's gates. | **resolved 2026-08-31** — ContentSurfaceTests cover article list/category publish filters, draft detail 404, and staff-only previews; ContactFormTests + SlugDedupTests cover the contact form and slug dedup |
| S6-06 | §6 | Major | security/correctness | `content/sectioning.py` (`_Splitter`, `convert_charrefs=True`), `project_section.html` | **Sectioning round-trip un-escapes entities and re-emits raw HTML:** `handle_data` decodes `&lt;` → `<` and `_render` re-emits attribute values unescaped, so author-escaped text (`&lt;script&gt;`, code samples with `<`/`&amp;`) becomes **live markup** in drill-down section bodies, and a decoded `"` in an attribute breaks out of the tag — an escalation beyond "staff HTML renders verbatim." | Re-escape in `handle_data`/`_render` (`html.escape`), or keep charrefs verbatim (`convert_charrefs=False`). | **resolved 2026-08-31** — `handle_data` re-escapes text (`html.escape`, quote=False), `_render` escapes attribute values (quote=True); section/TOC titles `html.unescape`d as plain text; regression tests cover escaped-script and attribute-quote round-trips |
| S6-07 | §6 | Major | correctness | `content/sectioning.py` (L115–123), `project_detail.html` | Drill-down projects **silently drop all content before the first `<h2>`** (body parts emitted while `pending is None` are discarded) — an author's intro paragraph(s) vanish from the landing page and every section page with no warning; the test fixture itself has an uncovered `<p>intro</p>`. | Emit a synthetic intro section or render pre-heading content above the card grid. | **resolved 2026-08-31** — split_sections surfaces pre-heading content as a synthetic Overview section (merged into the author's Overview heading when present); nothing authored is dropped |
| S6-13 | §6 | Major | security (authz) | `content/views.py` (`ProjectDetailView`, `ProjectSectionView`) | **Inactive projects are publicly served.** The Understand doc claimed these filter `is_active` — they do not (no `get_queryset`); only `ProjectListView` filters. Deactivating a project only removes it from the list; its detail + every section URL stay public (drafts, retracted content). Slugs are guessable. Cross-check caught this by falsifying the doc. | Add `get_queryset: Project.objects.filter(is_active=True)` to both views. | **resolved 2026-08-31** — both `ProjectDetailView` and `ProjectSectionView` filter `is_active`; inactive project detail + section URLs now 404 (tests) |
| S7-01 | §7 | Minor | security (latent) | `static/js/demo_flow.js` (`api.showEmpty(markup)`) | `showEmpty` assigns `div.innerHTML = markup` — an **XSS sink**, safe today only because every caller passes a constant string. A future dynamic caller (e.g. interpolating an answer/passage into the empty state) becomes stored/reflected XSS with no warning. | Replace with a safe builder (or escape the markup param); add a code comment/guard. | **resolved 2026-08-31** — `showEmpty` is now a safe DOM builder taking a plain-text `{icon, title, sub}` spec (createElement/textContent, no innerHTML); guard comment added; both call sites updated |
| S7-02 | §7 | Minor | maintainability | `static/js/demo_flow.js` (`SECTION_ALIASES`) | Client-side `SECTION_ALIASES` is a **4th hand-maintained copy** of the section vocabulary (build whitelist, serving `_KNOWN_SECTIONS`, parser canonicals + this). Divergence → citation clicks show the wrong section / extraction fails silently. Ties ECC-33. | Generate from one source (or a shared JSON the server emits); add a consistency check. | open |
| S7-03 | §7 | Minor | ops | (whole demo JS) | **No Content-Security-Policy** (shared with S6-10) — the demo relies on escaping + DOMPurify with no policy backstop; a single missed sink becomes site-wide XSS with nothing to contain it. | Add a CSP (script-src allow-list incl. the vendored bundles) via `django-csp`. | **resolved 2026-08-31** — django-csp 4.0 policy covers the demo (script-src 'self' + nonce + CDNs; vendored bundles are same-origin static); see S6-10 |
| S7-04 | §7 | Minor | robustness | `static/js/demo_splitpane.js` (`riskBlock`, `driversBlock`), `demo_flow.js` (`pct`) | The client trusts the predict payload shape: a non-numeric `probability`/`threshold` renders `NaN%`/`Infinity%` and a wrong band (no client-side number validation). Server composes these, so low risk, but there's no guard. | Validate numbers before render; fall back to the empty state on malformed payloads. | open |
| S7-05 | §7 | Minor | correctness | `static/js/demo_flow.js` (`renderAgentMarkdown`) | Markdown regexes run on **escaped** text, so entity/code spans display literally (an answer with `&amp;` renders as `&amp;` in a `<code>` span) — minor display fidelity quirk, not security. | Consider decoding entities in code spans after escaping, or document. | open |
| S7-06 | §7 | Major | correctness | `static/js/demo_flow.js` (`post`) | **Concurrent asks corrupt the thread:** nothing disables the composer while a request is in flight; `post()` resolves by overwriting the LAST turn (`episode.turns[episode.turns.length-1] = turn`). A second ask sent while the first is pending → answer A is attributed to question B, and the first pending "…" turn is stranded forever. | Disable ask while pending, or replace the pending turn by identity (`indexOf(pending)`), not tail position. | **resolved 2026-08-31** — both: `state.asking` flag + composer disabled in flight, and the pending turn is replaced by identity (`indexOf(pending)`) |
| S7-07 | §7 | Major | correctness | `static/js/demo_flow.js` (`post`, `turnBlock`) | **Patient-switch race paints the wrong patient** (and can throw): `post()` captures `episode` at send time and unconditionally `renderThread`/`paint`s it on completion — if the user selects another patient mid-flight, patient X's thread+canvas render under patient Y's header (cross-patient display contamination in an R1 demo). `turnBlock` labels user turns with `state.current.name` at render time (old turns get the NEW patient's name); if Back was clicked, the callback throws (`state.current` null) leaving the spinner stuck. | Guard the response handler (`if (state.current?.hadmId !== requestHadmId) return`); store the asking patient's name on the turn instead of reading `state.current` at render time. | **resolved 2026-08-31** — post() captures hadmId at send and only re-renders/paints when that patient is still current; the asker's name is pinned to the user turn; the citation fallback guards null `state.current` |
| S7-08 | §7 | Major | correctness | `static/js/demo_flow.js` (`agentTurnFromResponse`), `demo_splitpane.js` (`passageRow`) | **Unguarded payload-shape derefs leave the spinner stuck:** `predict.response.model_version` and `rag.response.passages` are dereferenced with no guard on `.response` (a failed tool with no response — exactly what the server defends against). The call is OUTSIDE the try/catch, so the exception is unhandled and the pending "…" turn never resolves. Same class: `passage.section.replace` on a section-less passage. | `predict?.response?.model_version`, `rag?.response?.passages`, `String(passage.section || '')`; or move turn construction inside the try. | **resolved 2026-08-31** — optional chaining on all three derefs, and post() wraps turn construction in try/catch so a malformed payload never strands the pending turn; passageRow guards a section-less passage |
| S7-09 | §7 | Major | correctness | `static/js/demo_splitpane.js` (source/cite mapping) vs `demo_a2ui.js` | **Known citation mis-numbering is fixed in the A2UI demo but NOT the custom demo.** The A2UI path resolves citations by `intentSections`; the custom demo maps `^[n]` straight to `passages[n-1]` with no intent resolution — in the acknowledged mis-numbering failure mode, the custom SOURCE card shows the wrong passage (or none), and `highlightPassage(n)` finds no matching row. If the server renumbers for the custom path too, the mapping is broken by construction. | Port the intent-section resolution (or the server-side deterministic mapping) to the custom demo. | **resolved 2026-08-31** — `resolvePassages()` in demo_splitpane.js resolves cited passages through intentSections (section label, else extractSection from a whole-note chunk) before footnote-number fallback; rows renumber 1..k and highlightPassage falls back to the first resolved row |
| S7-10 | §7 | Minor | security | `static/vendor/a2ui/a2ui_markdown-it*.js` (`sanitize` default config) + `demo_a2ui.js` | **DOMPurify default config + no CSP = link/img injection channel:** stock DOMPurify allows `<a href>` and `<img src>`. Agent-composed markdown (downstream of retrieved note text) can emit `[click](https://attacker)` or `![](https://attacker/beacon)` that renders inside the trusted clinical canvas — phishing / request-beacon (user-IP signal). | `sanitize(html, { FORBID_TAGS: ['img'], ALLOWED_URI_REGEXP: /^https?:\/\/(hosts)/ })` or strip a/img entirely (the canvas never needs them); add a CSP with `img-src 'self'`. | **resolved 2026-08-31** — vendored wrapper now calls `sanitize(html, {FORBID_TAGS: ["a","img"]})` (canvas never needs links/images); CSP `img-src` restricted to self/data/media bucket (S6-10) |
| S7-11 | §7 | Minor | correctness | `static/js/demo_flow.js` (citation parser) | Citation marker regex is comma-list *or* single range: mixed `^[1, 3-5]` is left as raw text; reversed `^[5-3]` matches but expands to an empty list and `wireCitations` then **consumes the marker and appends nothing** — the citation silently disappears. | Support mixed lists; guard `a <= b`; keep the original text on unparseable/empty markers. | open |
| S7-12 | §7 | Minor | correctness | `static/js/demo_flow.js` (`extractSection`), `demo/a2ui_canvas.py` | **Start-anchor asymmetry (client + server copies agree on being wrong):** the start match is `\balias\b\s*:` anywhere in the note (not line-anchored), while the end bound requires a line start. Generic aliases (`History`, `Condition`, `Diagnoses`, `Medications`, `Activity`) match mid-sentence and truncate/extract the wrong body. | Anchor the start match to line starts `(^|\n)\s*`, consistent with the end bound. | open |
| S7-13 | §7 | Minor | ops | `demo_a2ui.js` (imports `demo_flow.js?v=16`) vs `demo_splitpane.js` (`?v=11`) + template tags | **Cache-bust version skew:** the shared module is imported under two different URLs — the custom demo runs a stale `demo_flow` (5 revisions behind the A2UI demo). Manifest-hashed collectstatic doesn't rewrite intra-module import specifiers, so `?v=` is the only invalidation. | Single source of truth for the version (import-map / hashed module filenames). | open |
| S7-14 | §7 | Minor | correctness | `demo/templates/demo/{console,a2ui_console}.html`, `demo_flow.js` (`pct`) | Unscored patients render **"NaN%"** in the thread header: `data-probability="{{ row.probability }}"` has no `|default` (the band does), so a `None` probability renders the literal string `"None"` (truthy) → `pct("None")` → `NaN%`. | `{{ row.probability|default:'' }}` or a `Number.isFinite` guard client-side. | open |
| S7-15 | §7 | Minor | correctness | `static/js/demo_splitpane.js` (`renderSourceForTurn`) | Source lookup by **query equality** (`episode.sources.findIndex(s => s.query === turn.query)`) resolves repeated or null-query turns to the FIRST matching entry — a footnote click on a later turn surfaces an earlier turn's passages/cited-set. | Key sources by turn index, not query text. | open |
| S7-16 | §7 | Minor | correctness | `static/js/demo_a2ui.js` (empty path doesn't reset `msgPre`) | The stale "Show composed messages" pane **leaks the previous patient's full envelope JSON** (incl. note-passage text) after Back / selecting a patient with no envelope — cross-patient bleed in the trace surface an R1 demo shouldn't show. | `msgPre.textContent = ''` in the empty path. | open |
| S7-17 | §7 | Minor | correctness | `static/js/demo_a2ui.js` (`envelopeForCite`) | Edge cases: (a) when the envelope lacks a `SourceCard`, the "no targeted sections" branch silently returns the clone unchanged — a footnote click appears to do nothing; (b) when `extractSection` fails, `source.text` falls back to the whole-note text while `source.section` still claims the matched section — a header/body mismatch. | (a) synthesize a SourceCard when missing; (b) fall back the section label too when extraction fails. | open |
| S9-01 | §9 | Minor | ops | `danielmherman/settings.py` (env-gated config) | **No startup-time config validation / fail-fast:** settings never validate that prod env vars are present and consistent. A prod deploy missing `CSRF_TRUSTED_ORIGINS` → **every POST 403s**; missing `ALLOWED_HOSTS` → 400; missing `CLOUD_SQL_CONNECTION_NAME` → an empty `/cloudsql/` host. These fail confusingly at runtime, not loudly at boot (ties S1-01). | Add a startup check that raises `ImproperlyConfigured` when `IS_PRODUCTION` and required env vars are missing; validate origins/hosts shape. **RESOLVED 2026-08-31:** prod boot fails fast listing all missing required env. | resolved |
| S9-01 | §9 | Major | ops | `danielmherman/settings.py` (env-gated config) | **No startup-time config validation / fail-fast** (upgraded per cross-check): missing `CLOUD_SQL_CONNECTION_NAME` makes `HOST` silently the literal `/cloudsql/` (passes boot + health, 500s on first query with an opaque psycopg2 error); missing `GS_BUCKET_NAME` silently defaults to `danielmherman-media`; missing `CSRF_TRUSTED_ORIGINS` → every POST 403s; missing `ALLOWED_HOSTS` → 400; missing `GOOGLE_CLOUD_PROJECT` → `projects/None/...` Secret Manager failure. (Secret Manager itself DOES fail fast at boot.) Ties S1-01. | Add a prod startup check that raises `ImproperlyConfigured` on missing required env (CLOUD_SQL_CONNECTION_NAME, ALLOWED_HOSTS, CSRF_TRUSTED_ORIGINS, GOOGLE_CLOUD_PROJECT, GS_BUCKET_NAME). **RESOLVED 2026-08-31:** implemented, plus DEMO_AGENT_URL; verified by booting prod settings with vars removed. | resolved |
| S9-02 | §9 | Minor | ops | `danielmherman/` (config) | **No single documented list of required env vars** — `ENVIRONMENT`, `ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS`, `CLOUD_SQL_CONNECTION_NAME`, `GS_BUCKET_NAME`, `GOOGLE_CLOUD_PROJECT`, `DEMO_AGENT_URL`, `DEMO_FIXTURE_MODE`, `DEMO_AGENT_TIMEOUT`, `DEMO_DAILY_LIMIT`, `REDIS_HOST` are uncommitted/unenumerated (the S1-01/ECC-46 theme from the config side). Recreating the service from the repo leaves the operator guessing. | Ship a config manifest (`.env.example` or a documented settings table) + the fail-fast check from S9-01. **RESOLVED 2026-08-31:** .env.example committed documenting required/optional vars. | resolved |
| S9-03 | §9 | Minor | correctness | `danielmherman/settings.py` (ALLOWED_HOSTS, CSRF_TRUSTED_ORIGINS) | Both are `env.split(',')` with **no `.strip()` / no empty-entry filtering**: `"a.com, b.com"` yields `' b.com'` (never matches → 400), an empty-string env yields `['']`, trailing commas make empty entries; for CSRF a whitespace-prefixed origin silently fails the match → 403 on POST. | `[h.strip() for h in val.split(',') if h.strip()]` for both. **RESOLVED 2026-08-31:** _env_list() helper strips and drops empty entries for both. | resolved |
| S9-04 | §9 | Minor | ops | `danielmherman/settings.py` (`GS_DEFAULT_ACL`) | `GS_DEFAULT_ACL='publicRead'` uses **legacy per-object ACLs** — if the bucket has (or is migrated to) Uniform Bucket-Level Access, every upload 400s (breaks CKEditor image uploads in prod). `MEDIA_URL` hardcoded also silently disagrees with `storage.url()` output (django-storages ignores MEDIA_URL). Ties S1-13. | Drop `GS_DEFAULT_ACL`; `GS_QUERYSTRING_AUTH=False`; grant public read via bucket IAM. | **resolved 2026-08-31** — documented the UBLA caveat + bucket-IAM command in settings.py; the ACL→IAM switch is sequenced with the IaC step (runbook Step 6) so bucket mode and code change together |
| S9-05 | §9 | Minor | security/ops | `requirements.txt` | **Dead + stale deps in the prod image:** `django-ckeditor==6.7.3` (the CKEditor **4** package — unmaintained upstream, bundles a CKEditor 4 build with known XSS CVEs) not in INSTALLED_APPS; `bleach==4.1.0` (2021 release, apparently unused); `Django==6.0` pinned to the bare `.0` release, excluding 6.0.x security patches (ties S1-16). | **RESOLVED 2026-08-31:** removed `django-ckeditor` + `bleach` + orphaned transitives (`django-js-asset`, `six`, `webencodings`, `packaging`); migration 0004 rewritten to `models.TextField` (same DB type, superseded by 0005; `makemigrations --check` clean). Django pinned 6.0.8. | resolved |
| S9-06 | §9 | Minor | ops | `danielmherman/settings.py` (LOGGING) | LOGGING names `django`, `django.request`, `content` loggers but **omits `demo`** — the clinical console that calls the private agent and most needs telemetry; its INFO logs (agent latency, quota decisions, fixture-vs-live) are dropped in prod. | Add a `'demo'` logger mirroring `'content'`. | **resolved 2026-08-31** — `'demo'` logger added to LOGGING at INFO, mirroring content |
| S9-07 | §9 | Minor | correctness | `danielmherman/urls.py` (DEBUG static) | In DEBUG, `static(STATIC_URL, document_root=STATIC_ROOT)` serves from `staticfiles/` (collectstatic output) — stale/absent locally, and under local uvicorn can serve hashed names against a stale tree while templates emit unhashed ones. Dev-only, low impact (WhiteNoise already handles static). | Drop the line and rely on WhiteNoise (`WHITENOISE_USE_FINDERS=True` in dev). | **resolved 2026-08-31** — DEBUG static now serves from the live STATICFILES_DIRS source instead of the stale collected staticfiles/ |
| S6-08 | §6 | Minor | security | `content/urls.py` (L13–14) | A section slugged `preview` is **shadowed by the staff preview route** (`projects/<slug>/preview/` matches first) — a legit h2 "Preview" links public visitors to a staff-login-gated URL. | Move previews to a non-colliding prefix or reserve the `preview` slug. | open |
| S6-09 | §6 | Minor | security (supply chain) | `content/templates/content/base.html` | Third-party JS/CSS loaded from **CDNs without SRI** (Bootstrap, FontAwesome, Prism; Mermaid on floating `@10`) — a CDN compromise or malicious patch is site-wide XSS; Mermaid renders staff-authored diagram text client-side (historically XSS-prone). | Pin exact versions + `integrity`/`crossorigin`, or self-host via staticfiles. | open |
| S6-10 | §6 | Minor | ops | `danielmherman/settings.py` (prod security block) | **No Content-Security-Policy** anywhere — the only realistic backstop for a site that renders `|safe` rich HTML plus CDN scripts. Also no HSTS (S1-12). | Add `django-csp` with an explicit script-src allow-list; add HSTS. | **resolved 2026-08-31** — django-csp 4.0 via `PathExemptCSPMiddleware` (staff-only /admin/ + /ckeditor5/ exempt): default-src 'self', script-src 'self'+nonce+jsdelivr+cdnjs, object-src 'none', frame-ancestors 'self'; the two inline scripts carry `request.csp_nonce`. HSTS remains tracked as S1-12 (Cluster H) |
| S6-11 | §6 | Minor | security (latent) | `content/templatetags/content_extras.py` (`first_sentence`) | `is_safe=True` is a **wrong promise** (the filter does not escape) — harmless today (inputs are unsafe strs so autoescape applies), but it would propagate safeness if ever chained after `|safe`, and truncation at the first `.` can bisect an entity (`&amp.`). | Drop `is_safe=True`. | **resolved 2026-08-31** — dropped, with a docstring explaining why the promise was wrong; test asserts the output is not SafeString |
| S6-12 | §6 | Minor | correctness | `content/views.py` (`ContactView.post`) | Contact error path **loses user input** (re-renders the bare template with no context), returns 200 for a failed submission, and accepts whitespace-only values (`all([...])` passes for `" "`). | Bound `Form` + re-render with the form in context; `strip=True` fields. | open |

*(First findings land here. Severity: Critical / Major / Minor. Category:
security / correctness / architecture / ops.)*

## Cross-cutting bucket

Findings not tied to one section (shared utils, logging, error handling).

## Definition of done

All sections reviewed; **zero Critical/Major open** (fixed or documented
deferral with owner + date); scanners run; backlog tracked here.

## Cadence (per section)

1. Understand pass → **Understand doc** (written to be read: entry points, how
   it operates, data flow, config, failure modes).
2. **Dan reads + confirms** the mental model.
3. Primary review pass → findings.
4. Adversarial pass — Claude Fable 5, per the section's protocol (blind hostile
   for §1).
5. Triage into this backlog.

One section per sitting. Progress update this file as we go.
