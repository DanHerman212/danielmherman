# 00_MASTER_STRATEGY.md — Website Redesign & SaaS Command Center Strategy

* **Platform:** `danielmherman.com` (Django Web Application Tier)
* **Strategic Archetype:** B2B SaaS Product Showcase & Forward-Deployed AI Engineering Dossier
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
  * Information architecture, navigation, progressive disclosure documentation, and interactive resume presentation.
  * Self-service authentication perimeter using **Google and Microsoft Social OAuth** (allowing both personal and corporate accounts).
  * Automated provisioning of a **20-request live quota** per authenticated user, governed by a **100-user global concurrency/capacity cap** and IP-level initiation throttling (replacing the need for a standalone CAPTCHA).
  * Dual-mode routing inside `/demo/`: serving a self-service **Simulated Sandbox** to unauthenticated visitors and unlocking the **Live Agent Runtime** for authenticated users.
* **Agent Backend Tier Responsibilities (External Workstream):**
  * Supplying deterministic, verified golden dataset payloads (recorded SSE streams and structured JSON responses for `/risk`, `/meds`, `/ehr`, and literature queries) to power the unauthenticated Simulated Sandbox at zero LLM inference cost.

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

Each phase below will be expanded into its own self-contained Tactical Specification Document (`01` through `06`) only when we are ready to execute that specific phase.

### Phase 1: Information Architecture, Routing & Navigation Pruning (Lowest Effort)
* **Strategic Goal:** Eliminate dead click-paths, retire empty catalog links from the global navigation bar, redirect `/projects/` to the flagship architecture page, and embed a persistent direct-contact bar in the global footer.
* **Target Scope:** `content/views.py`, `content/templates/content/base.html`.
* **Verification Gate:** All `content` unit tests pass; zero placeholder pages reachable from primary navigation; zero CSP violations.

### Phase 2: Command Center Landing Page (`/`) (Low-Medium Effort)
* **Strategic Goal:** Replace the empty article feed on `/` with the B2B SaaS Hero, the Enterprise Clinical Copilot centerpiece showcase, an interactive screenshot switcher, and the Dual-Path Demo Launcher.
* **Target Scope:** `content/templates/content/home.html` (or `command_center.html`), `content/static/css/style.css`.
* **Verification Gate:** Responsive desktop/mobile rendering; functional screenshot tabs; clear visual hierarchy routing to `/demo/` and `/projects/enterprise-clinical-copilot/`.

### Phase 3: Progressive Disclosure Architecture Bento Grid (Medium Effort)
* **Strategic Goal:** Prevent cognitive overload on the flagship project page by introducing a 6-card visual system map above the long-form documentation, linking directly into existing `sectioning.py` deep-dive routes.
* **Target Scope:** `content/templates/content/project_detail.html`, `content/static/css/style.css`.
* **Verification Gate:** All 6 cards map cleanly to valid `sectioning.py` slugs; sidebar navigation and deep-dive sub-pages remain 100% functional.

### Phase 4: Interactive Resume Dossier & Lens Switcher (Medium Effort)
* **Strategic Goal:** Reframe the career narrative on `/resume/` from a linear timeline into an interactive dossier with a 3-way Vanilla JS Lens Toggle, expandable system proof drawers, a click-to-copy contact bar, and clean `@media print` rules.
* **Target Scope:** `content/views.py` (`ResumeView` context), `content/templates/content/resume.html`, `content/static/js/main.js`, `content/static/css/style.css`.
* **Verification Gate:** Lens filtering operates smoothly without inline-script CSP violations; `window.print()` produces a clean multi-page PDF layout.

### Phase 5: Top-Right Hamburger Menu & User Guide Experience (Medium Effort)
* **Strategic Goal:** Introduce an OpenEvidence-inspired top-right navigation/help drawer inside the application experience providing frictionless access to the updated User Guide (format—static visual reference vs. guided walkthrough—to be finalized at Phase 5 kickoff).
* **Target Scope:** `demo/templates/demo/...` header templates and `/demo/guide/` view/template assets.
* **Verification Gate:** Accessible from both unauthenticated Sandbox and authenticated Live modes; zero layout shift in the clinical console.

### Phase 6: Social OAuth (Google/MSFT) & Simulated Sandbox Mode (Highest Complexity)
* **Strategic Goal:** Enable frictionless self-service registration via Google and Microsoft OAuth (personal and work emails allowed), enforce IP-level login initiation throttling, auto-provision the 20-credit `DemoQuota` up to the 100-user global cap, and wire `/demo/` to serve recorded golden SSE streams to unauthenticated users.
* **Target Scope:** `danielmherman/settings.py`, `danielmherman/urls.py`, `demo/models.py`, `demo/views.py`, and golden fixture integration from the Agent Evaluation workstream.
* **Verification Gate:** End-to-end OAuth handshake test, oversubscription gate verification (101st user / 0-credit block directing to `dan@danielmherman.com`), and zero-cost SSE replay in unauthenticated mode.

---

## 5. Operating Cadence (Human-in-the-Loop + Autonomous Coding Agent)

1. **Pre-Phase Alignment:** Before generating a Tactical Spec for Phase $N$, we review any open product questions and inspect the raw target files for that phase.
2. **Tactical Spec Generation:** A single, bounded markdown spec (`0N_PHASE_N_...md`) is drafted containing exact file diffs, CSP constraints, and test commands.
3. **Autonomous Execution & Verification:** The coding agent executes the single Phase Spec and runs the local verification gate before we move to Phase $N+1$.