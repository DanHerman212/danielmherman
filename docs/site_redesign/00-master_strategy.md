# 00_MASTER_STRATEGY.md — Website Redesign & SaaS Command Center Strategy

* **Platform:** `danielmherman.com` (Django Web Application Tier)
* **Strategic Archetype:** B2B SaaS Product Showcase & Forward-Deployed AI Engineering Dossier
* **IDE & Agent Environment:** VS Code Multi-Repo Workspace + GitHub Copilot Coding Agent
* **Execution Cadence:** Two-Tier Progressive Disclosure (Master Strategy -> Phase-by-Phase Tactical Specs)

---

## 1. Strategic Vision & Core Objectives

The objective of this redesign is to transition `danielmherman.com` from a traditional content-management blog layout into a high-signal **B2B SaaS Product Showcase** where Dan Herman is presented as the solo founder and chief systems architect.

Rather than routing visitors through multi-click catalog pages (`Articles`, `Projects` placeholders, `Contact` forms), the site will center on two core assets:
1. **The Flagship Production System:** The **Enterprise Clinical Copilot (ECC)**—a full-stack multi-agent clinical decision support, MIMIC-IV readmission risk, and PubMed RAG platform.
2. **The Architect's Dossier:** A synthesis of 15+ years of enterprise B2B GTM leadership (Fintech/Cybersecurity) with end-to-end production AI/ML systems engineering.

---

## 2. System Boundaries & Dual-Mode Product Funnel

A clear architectural boundary separates the **Django Web Application Tier** (this workstream) from the **Agent Backend & Evaluation Workstream**:

* **Web Application Tier Responsibilities (This Workstream):**
  * Information architecture, navigation, progressive disclosure documentation, and interactive resume presentation (`content/` app)[cite: 6].
  * Ad-blocker-proof **Django Server-Side Funnel Telemetry** logging page views, referrers/UTMs, and key conversion events directly to PostgreSQL and surfacing them in Django Admin.
  * Self-service authentication perimeter using **Google and Microsoft Social OAuth** (allowing both personal and corporate accounts).
  * Automated provisioning of a **20-request live quota** per authenticated user, governed by a **100-user global concurrency/capacity cap** and IP-level initiation throttling.
  * Dual-mode routing inside `/demo/`: serving a self-service **Simulated Sandbox** to unauthenticated visitors and unlocking the **Live Agent Runtime** for authenticated users.
* **Agent Backend Tier Responsibilities (External Workstream — Read-Only Reference):**
  * Supplying deterministic, verified golden dataset payloads (recorded SSE streams and structured JSON responses for `/ehr`, `/meds`, and literature queries) to power the unauthenticated Simulated Sandbox at zero LLM inference cost.
  * Serving as a read-only documentation source in the multi-repo workspace to inform architectural copy on the portfolio site.

---

## 3. Target Information Architecture

| Route | Strategic Role | User Experience |
| :--- | :--- | :--- |
| **`/` (Root Command Center)** | **SaaS Product Hook & Bio Synthesis** | Immediate executive bio hook + flagship ECC showcase card, tabbed UI previews, and a dual-path CTA fork: **Try Instant Sandbox (No Login)** vs. **Sign In for Live Agent (Google/MSFT)**. |
| **`/projects/enterprise-clinical-copilot/`** | **Progressive Disclosure Architecture Hub** | Opens with an executive summary and a **6-Card Architecture Bento Grid** (Web/Edge, Orchestrator, ML Inference, RAG/Warehouse, Observability, CI/CD) that links into deep-dive sub-pages. |
| **`/projects/`** | **Catalog Bypass** | Transparently redirects (`302`) to `/projects/enterprise-clinical-copilot/` so incomplete placeholder projects are never exposed. |
| **`/resume/`** | **Interactive Engineering & Executive Dossier** | Two-column layout featuring a Vanilla JS **Lens Toggle** (*Full Synthesis* \| *AI & ML Engineering* \| *Enterprise GTM Leadership*), 1-click email copy, and print-to-PDF formatting. |
| **`/demo/` & Top-Right Guide Menu** | **Dual-Mode Console & On-Demand User Guide** | Houses both the Simulated Sandbox (unauthenticated) and Live Agent Console (authenticated), equipped with an OpenEvidence-style top-right menu for the User Guide. |
| **`/articles/` & `/contact/`** | **Dormant Legacy Routes** | Removed from primary navigation (preserved in codebase for future reversal). Direct contact (`dan@danielmherman.com`) is elevated to the global footer and resume header. |

---

## 4. Phased Execution Roadmap (Ordered Lowest to Highest Complexity)

Each phase below will be expanded into its own self-contained Tactical Specification Document (`01` through `07`) only when we are ready to execute that specific phase.

### Phase 1: Information Architecture, Routing & Navigation Pruning (Lowest Effort)
* **Strategic Goal:** Eliminate dead click-paths, retire empty catalog links from the global navigation bar, redirect `/projects/` to the flagship architecture page, and embed a persistent direct-contact bar in the global footer.
* **Allowed Write Scope:** `content/views.py`, `content/templates/content/base.html`[cite: 6, 7].
* **Verification Gate:** All `content` unit tests pass; zero placeholder pages reachable from primary navigation; zero CSP violations; `git status` confirms zero files modified outside the Allowed Write Scope.

### Phase 2: Command Center Landing Page (`/`) (Low-Medium Effort)
* **Strategic Goal:** Replace the empty article feed on `/` with the B2B SaaS Hero, the Enterprise Clinical Copilot centerpiece showcase, an interactive screenshot switcher, and the Dual-Path Demo Launcher.
* **Allowed Write Scope:** `content/templates/content/home.html`, `content/static/css/style.css`.
* **Verification Gate:** Responsive desktop/mobile rendering; functional screenshot tabs; clear visual hierarchy routing to `/demo/` and `/projects/enterprise-clinical-copilot/`.

### Phase 3: Progressive Disclosure Architecture Bento Grid (Medium Effort)
* **Strategic Goal:** Prevent cognitive overload on the flagship project page by introducing a 6-card visual system map above the long-form documentation, linking directly into existing `sectioning.py` deep-dive routes[cite: 6].
* **Allowed Write Scope:** `content/templates/content/project_detail.html`, `content/static/css/style.css`[cite: 6]. (Agent may read architecture docs from the Agent Repo to populate accurate copy, but may not write to the Agent Repo).
* **Verification Gate:** All 6 cards map cleanly to valid `sectioning.py` slugs; sidebar navigation and deep-dive sub-pages remain 100% functional[cite: 6].

### Phase 4: Interactive Resume Dossier & Lens Switcher (Medium Effort)
* **Strategic Goal:** Reframe the career narrative on `/resume/` from a linear timeline into an interactive dossier with a 3-way Vanilla JS Lens Toggle, expandable system proof drawers, a click-to-copy contact bar, and clean `@media print` rules[cite: 6].
* **Allowed Write Scope:** `content/views.py` (`ResumeView` context), `content/templates/content/resume.html`, `content/static/js/main.js`, `content/static/css/style.css`[cite: 6, 7].
* **Verification Gate:** Lens filtering operates smoothly without inline-script CSP violations; `window.print()` produces a clean multi-page PDF layout.

### Phase 5: Django Server-Side Funnel Telemetry (Medium Effort)
* **Strategic Goal:** Capture 100% ad-blocker-proof visitor analytics without loosening Content Security Policy rules or adding third-party tracking scripts. Track high-signal funnel events (`page_view`, `sandbox_launch`, `oauth_start`, `resume_lens_toggle`), referrer/UTM tags, and anonymized client IP hashes (`X-Forwarded-For`), exposing clean summary filters in Django Admin[cite: 6].
* **Allowed Write Scope:** `content/models.py`, `content/migrations/`, `content/admin.py`, `content/views.py`, `content/tests.py`[cite: 6].
* **Verification Gate:** Zero impact on page-load latency; bot/health-check user agents filtered out; funnel events visible and filterable inside Django Admin.

### Phase 6: Top-Right Hamburger Menu & User Guide Experience (Medium Effort)
* **Strategic Goal:** Introduce an OpenEvidence-inspired top-right navigation/help drawer inside the application experience providing frictionless access to the updated User Guide.
* **Allowed Write Scope:** Explicitly limited to `demo/templates/demo/` header/guide templates and `demo/views.py` guide route (all `demo/ask/` BFF and `copilot_*.js` controller modules remain strictly off-limits).
* **Verification Gate:** Accessible from both unauthenticated Sandbox and authenticated Live modes; zero regressions in Django or JS test suites.

### Phase 7: Social OAuth (Google/MSFT) & Simulated Sandbox Mode (Highest Complexity)
* **Strategic Goal:** Enable frictionless self-service registration via Google and Microsoft OAuth, enforce IP-level login initiation throttling, auto-provision the 20-credit `DemoQuota` up to the 100-user global cap, and wire `/demo/` to serve recorded golden SSE streams to unauthenticated users.
* **Allowed Write Scope:** `danielmherman/settings.py`, `danielmherman/urls.py`, `demo/` auth/sandbox routing, and static golden fixture files[cite: 5].
* **Verification Gate:** End-to-end OAuth handshake test, oversubscription gate verification, and zero-cost SSE replay in unauthenticated mode.

---

## 5. AI Coding Agent Governance & Workspace Boundaries

Because the VS Code workspace mounts both the **Website Repository** and the **Agent Backend Repository**, the GitHub Copilot Coding Agent must operate under strict mechanical governance during every phase:

### 5.1 Repository & Directory Blast-Radius Matrix

| Workspace Path | Permission Level | Governance Rule |
| :--- | :--- | :--- |
| **Agent Backend Repo (All Files)** | **READ-ONLY** | Never create, edit, format, or delete any file in the agent backend repository. It exists in the workspace strictly as a read-only reference for architectural documentation and fixture schemas. |
| **`demo/` App & `demo/static/js/copilot_*.js`** | **FROZEN (Phases 1–5)** | The decomposed BFF (`demo/ask/`) and modular JS sub-controllers (`copilot_*.js`) are production-hardened and strictly off-limits during Phases 1–5. Any accidental edit to `demo/` during Phases 1–5 is an automatic gate failure. |
| **`danielmherman/csp_middleware.py`** | **FROZEN** | Never weaken, bypass, or add `unsafe-inline` to Content Security Policy rules to make a frontend feature work. All CSS and JS must conform to the existing CSP. |
| **`content/` App** | **SCOPED WRITE** | The agent may only modify the exact files listed in the **Allowed Write Scope** block of the active Phase Spec. |

### 5.2 Separation of Concerns: Implementation vs. Test Execution

To prevent the coding agent from "green-washing" (weakening tests to force a passing run) or conflating feature changes with test debugging:

1. **Test Immutability Rule:** Existing test files (`content/tests.py`, `demo/tests/`, JS test suites) are **read-only** during feature implementation unless the Phase Spec explicitly instructs adding a new test or updating a specific assertion.
2. **Two-Step Execution Loop:**
   * **Step A (Implementation):** The agent applies changes strictly to the files listed in the Phase Spec's `Allowed Write Scope`.
   * **Step B (Verification & Triage):** The agent runs the designated test suite in read-only diagnostic mode. If a test fails, the agent **must not** edit the test file to make it pass. It must either fix the defect within the allowed implementation files or stop and report the exact failure output to the human architect.
3. **Mandatory Pre-Commit Diff Audit:** Before any phase is marked complete, the agent must run:
   ```bash
   git status --porcelain