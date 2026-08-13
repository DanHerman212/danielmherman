# Deployment Strategy — Public Demo (Analytics, Access Gate, Cost Control)

_Date: 2026-08-11 · Status: OPEN · Owner: Dan_
_Companion to `docs/go_live_plan.md` (the go-live build plan). This doc covers
**how** the demo is exposed, **who** gets in, and **how we monitor + cap**
traffic and cost once it's live._

---

## Goals

1. **Monitor website traffic** — Google Analytics 4 (GA4), created from scratch.
2. **Control costs by limiting usage** — per-user quota + a spend model +
   budget alerts.
3. **Phased access** — a handful of trusted testers first, then a
   **limited-time** public window.
4. **Verified-email registration gate** — users register with an email and must
   click a confirmation link, so we know whose account is using the demo.
5. **Shut it off if it gets too busy** — cost/traffic alerts reach the owner
   fast, and a one-click kill switch exists.

## Current state (what already exists)

- **Auth:** Django built-in auth only. No self-registration today — the login
  page says *"Demo accounts are issued on request."* Accounts are created
  manually (`manage.py createsuperuser` / admin). Demo views are
  `@login_required`.
- **Quota:** `demo.models.DemoQuota` — per-user daily allowance
  (`DEMO_DAILY_LIMIT`, default 10), enforced atomically in the DB
  (`consume()`/`refund()`). This is already a **per-user spend cap**.
- **Email:** no SMTP/email backend configured yet. Required for email
  verification.
- **Analytics:** none.
- **Cost posture today:** near zero — fixture mode, endpoints torn down, Cloud
  Run scale-to-zero.

---

## Part 1 — Access gate + verified-email registration

### 1.1 Access phases (a single, admin-toggleable gate)

Introduce one source of truth for access, toggleable from Django admin with
**no redeploy**. A single-row model (or an env-var default):

| Mode | Meaning |
|------|---------|
| `closed` | Nobody new; demo hidden/disabled (registration closed, demo URL shows a "coming soon" page). |
| `testers` | Only **pre-created** accounts (the 3 friends) can log in. Self-registration is disabled. |
| `public` | Open registration with email verification; anyone verified can log in. |

Plus a **kill switch** (boolean) that immediately forces `closed`-like behavior
(blocks all demo requests) — the manual off button.

**Implementation sketch:**
- `demo/models.py`: `DemoAccess` singleton model — `mode` (choices above),
  `kill_switch` bool, `public_until` date (for the limited-time window),
  `updated_at`.
- `demo/access.py`: `require_demo_open()` helper / decorator + `registration_enabled()`
  (reads the row; memoize briefly, e.g. per-request).
- Wrap the demo URLs (`/demo/`, `/demo/a2ui/`) and `register` so `closed` or
  `kill_switch` returns a friendly "demo temporarily unavailable" page.
- Default from env (`DEMO_ACCESS_MODE`) so deploys can pre-set a phase, but the
  admin row overrides at runtime.

### 1.2 Verified-email registration (as you described)

Flow the user asked for, which is sound:
> click the demo link → create account + log in page → we email a verification
> link → they click it → account is verified → they can sign in.

**Recommended build (least dependency, in-house):**
1. `demo/views.py` + `demo/urls.py`: `register` (username/email/password),
   `verify-email/<token>/`, plus a login page (already exists).
2. New accounts are created **inactive** (`is_active=False`).
3. On register, email a verification link built with Django's
   `django.core.signing` (signed user id + expiry) — **no new package needed**.
   Clicking the link activates the account and logs them in.
4. `demo/tests.py`: register → inactive → verify link activates → login →
   demo reachable. Cover expired/tampered tokens.
5. Only exposed in `public` mode; in `testers` mode the register route returns
   404/disabled.

**Email backend (needed for verification links):**
- **Start:** Gmail SMTP (free, ~500 msgs/day cap — plenty for a demo) via
  `EMAIL_BACKEND`/`EMAIL_HOST` env vars in `settings.py`, secrets via Secret
  Manager in prod.
- **Scale-up later:** Amazon SES / SendGrid / Postmark if volume grows.
- Flagged as an open decision (needs your Gmail/Workspace account or a mail
  provider).

### 1.3 Tester phase (the 3 friends)

- Keep the current model: **admin creates the accounts** (3 users) in
  `testers` mode. No registration route. They use a shared login page with
  their issued credentials.
- Optionally mark them with a group/flag for the audit list.

---

## Part 2 — Google Analytics 4 (traffic monitoring)

GA4 measures **traffic** (who visits, how long, what pages). Cost monitoring is
Part 3 — keep the two separate.

### Setup steps
1. In [analytics.google.com](https://analytics.google.com): **Admin → Create
   property** (e.g. "danielherman.com").
2. Add a **Web data stream** for `https://danielmherman.com` → copy the
   **Measurement ID** (`G-XXXXXXXXXX`).
3. Inject the gtag snippet into the base template `<head>`
   (`content/templates/content/base.html`, before `{% block extra_css %}`),
   **gated by an env var** so dev stays clean:
   - `settings.py`: `GA_MEASUREMENT_ID = os.environ.get('GA_MEASUREMENT_ID', '')`
   - base.html: `{% if GA_MEASUREMENT_ID %}<script async src="https://www.googletagmanager.com/gtag/js?id={{ GA_MEASUREMENT_ID }}"></script>…{% endif %}` (pass via a context processor or the settings template var).
4. Verify with **Tag Assistant / Realtime** report.

### Notes
- Track the **whole site** (portfolio + demo) — simplest, and shows demo page
  traffic in context. Can add a `page_view` event dimension for the demo URL
  if you want a dedicated report.
- GA4 does **not** capture demo content (it's page-view analytics), so no PHI
  risk from the synthetic data. Optionally enable basic **Consent Mode** and
  keep data retention conservative; not required to start.
- Realtime report = your "is it busy right now" traffic view.

---

## Part 3 — Cost monitoring & control

### 3.1 Cost model (what the meter actually is when live)

| Component | Approx. cost | Notes |
|-----------|--------------|-------|
| **RAG index endpoint** (Vertex Vector Search, `e2-standard-16`) | **~$270/mo** ⚠️ | The dominant fixed cost. Config in `deploy_rag_endpoint.py` / `deploy_index.py` (`ENDPOINT_MACHINE`). |
| **Prediction endpoint** (CPR on Vertex) | TBD (machine-dependent) | `deploy_cpr.py`; usually far less than the RAG endpoint. |
| **Gemini Flash** (agent LLM) | ~fractions of a cent per call | Bounded by quota × users. |
| **Cloud Run** (Django + agent + MCP) | ~$0 when idle (scale-to-zero, `min-instances 0`) | Cold-start latency on first hit. |
| **Cloud SQL** | small fixed | Already in use. |

**The biggest cost lever: only run the Vertex endpoints during active demo
windows.** The RAG index is **kept** between runs (re-deploy is cheap, no
re-pay), so the strategy is:
- Deploy endpoints for a **test / public window**, then **tear down** between
  phases (`teardown.py`).
- Review whether the RAG endpoint can run on a **smaller machine** than
  `e2-standard-16` (latency vs cost) — potential ~4× saving if it fits.

### 3.2 Budget alerts (the "message me when the bill hits X" ask)

Use **GCP Billing → Budgets & alerts**:
1. Create a budget (suggest starting at **$75/mo** as a "feeling-out"
   threshold; adjust after one live window).
2. Set **alert thresholds**: 50% / 75% / 90% / 100% → **email** (and optionally
   SMS via a notification channel).
3. Enable **daily cost email reports** for a regular cadence.

This is exactly the "alert at a certain level or regular intervals" you
described. It's email-based and needs **no extra infrastructure**.

### 3.3 Usage limits (already built, keep + tune)

- `DemoQuota` caps each user (default 10/day). With N users, the worst-case
  variable spend ≈ `10 × N × per-call-cost`. This is the real cost control.
- Tune `DEMO_DAILY_LIMIT` per phase (e.g., testers get more, public gets
  fewer).
- Optional stretch: a site-wide **requests-per-minute** cap or
  rate limiter if a public spike worries you (can add `django-ratelimit`).

### 3.4 Cost dashboard (optional)

A Cloud Monitoring dashboard or the Billing report page is enough at this
scale. No build required to start.

---

## Part 4 — Shut-off / kill switch

**Recommended: manual first, automate later.**

1. **Manual kill switch (instant, no deploy):** the `DemoAccess.kill_switch`
   toggle in Django admin. Flip it → all demo requests are blocked behind a
   friendly page. This is the primary off button.
2. **Scale-to-zero the meter:** for a hard stop of the expensive Vertex
   endpoints, run the teardown script (index persists). Takes minutes.
3. **Automated (stretch):** GCP budget alert → Pub/Sub → small Cloud Function
   that sets `kill_switch` (or scales the endpoint down). Nice-to-have after
   the manual path is proven — avoids any chance of a runaway public window
   going unnoticed.

Your "shut it off if it gets too busy" flow:
- **Traffic too high** → watch GA4 **Realtime** → flip the kill switch.
- **Cost too high** → budget alert email → flip the kill switch (+ teardown
  endpoints if needed).

---

## Part 5 — Phased rollout (maps to `docs/go_live_plan.md`)

| Phase | Gate mode | Who's in | Cost posture | Monitoring armed |
|-------|-----------|----------|--------------|------------------|
| **Build** (go_live_plan Phases 1–3) | `closed` | Dan | fixture (~$0) | GA4 not needed |
| **Live E2E** (go_live_plan Phases 4–6) | `testers` (just Dan) | Dan | endpoints live | budget alert + GA4 |
| **Friend test-drive** | `testers` | 3 friends, admin-created | endpoints live | budget alert + GA4 Realtime |
| **Limited-time public** | `public` (with `public_until`) | anyone w/ verified email | endpoints live | budget alert + GA4 + kill switch ready |
| **Post-window** | `closed` | none | endpoints torn down (~$0) | — |

**Sequence to implement:**
1. Part 1: `DemoAccess` gate + `closed` default. (Do this before exposing the
   demo.)
2. Part 1: registration + email verification (`public`-only), email backend.
3. Part 2: GA4 property + gtag in base.html (`GA_MEASUREMENT_ID` env).
4. Part 3: GCP budget + alert thresholds; tune `DEMO_DAILY_LIMIT`.
5. Part 4: kill switch toggle + teardown runbook.
6. Rehearse the friend phase, then flip to `public` for the window.

---

## Open decisions (need your input)

1. **Email backend for verification links** — Gmail SMTP (free, recommended to
   start) vs a provider (SES/Postmark). Needs your Gmail/Workspace account or
   provider keys.
2. **Budget threshold** — start at $75/mo and tune after one live window? (You
   said "feeling it out" — this gives you a first data point.)
3. **RAG endpoint machine** — try a smaller machine than `e2-standard-16`
   before the public window to cut the fixed cost (~4× potential)? Requires a
   quick latency test.
4. **Automated kill switch** — defer (manual first) unless you want the
   belt-and-suspenders path.
5. **GA4 consent mode** — optional; default is basic page-view tracking without
   consent mode.

---

## Reference

- Go-live build plan: `docs/go_live_plan.md`
- Website deploy: `docs/GCP_DEPLOYMENT_GUIDE.md`
- Demo screen guide: `enterprise_clinical_copilot/projects/agent-harness/docs/demo_screen_guide.md`
- Agent deploy: `enterprise_clinical_copilot/projects/agent-harness/docs/BUILD_GUIDE.md`
- Quota model: `demo/models.py` (`DemoQuota`)
- Demo views/auth: `demo/views.py`, `demo/urls.py`
