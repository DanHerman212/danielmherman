# `01_PHASE1_ROUTING_AND_NAV.md` — Governance Contract & Phase 1 Tactical Specification

* **Parent Strategy:** `00_MASTER_STRATEGY.md`
* **Objective:** Enforce strict multi-repository workspace governance and execute Phase 1 (updating the global navigation bar and footer in `base.html`, passing the flagship project context into `HomeView`, and redirecting `/projects/` to `/projects/enterprise-clinical-copilot/` when active).

---

## PART 1: PERSISTENT WORKSPACE GOVERNANCE & ARCHITECTURAL BOUNDARY CONTRACT

 Saved this section to `.github/copilot-instructions.md` 

---

## PART 2: PHASE 1 SCOPE & BOUNDARY CONTRACT

### ALLOWED_WRITE_SCOPE (Exhaustive List for Phase 1)
You may ONLY modify the following 2 files during Phase 1:
1. `content/views.py`
2. `content/templates/content/base.html`

### FORBIDDEN_PATHS (Hard Blinders)
* **Agent Backend Repository:** Strictly READ-ONLY.
* **`demo/` Application (All files):** Strictly READ-ONLY.
* **`danielmherman/` Core Config (`urls.py`, `settings.py`, `csp_middleware.py`):** Strictly READ-ONLY.
* **`content/urls.py` & `content/models.py`:** Strictly READ-ONLY in Phase 1.
* **Test Suite (`content/tests.py`):** Strictly READ-ONLY in this workflow. Do not modify any tests.

---

## PART 3: PHASE 1 IMPLEMENTATION SPECIFICATIONS

### Task 3.1: Update `content/views.py`
1. Define the constant `FLAGSHIP_PROJECT_SLUG = "enterprise-clinical-copilot"` above `HomeView`.
2. In `HomeView.get_context_data(self, **kwargs)`, preserve the existing `categories` and `featured_articles` context keys, and add:
   * `flagship_project`: The active `Project` instance matching `slug=FLAGSHIP_PROJECT_SLUG, is_active=True` (via `.first()`).
   * `flagship_sections`: If `flagship_project` exists and `flagship_project.drilldown` is True, populate with `decorate_sections(flagship_project.content)`, else `[]`.
3. In `ProjectListView`, override `get(self, request, *args, **kwargs)` so that if `Project.objects.filter(slug=FLAGSHIP_PROJECT_SLUG, is_active=True).exists()` is True, it returns `redirect(f'/projects/{FLAGSHIP_PROJECT_SLUG}/')`. If False (such as in isolated unit test fixtures that do not seed the flagship slug), it falls back to `super().get(request, *args, **kwargs)`.

#### Exact Replacement for `HomeView` in `content/views.py`:
```python
FLAGSHIP_PROJECT_SLUG = "enterprise-clinical-copilot"


class HomeView(TemplateView):
    """Homepage View — Command Center entry point."""
    template_name = 'content/home.html'

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context['categories'] = Category.objects.filter(is_active=True)
        context['featured_articles'] = Article.objects.filter(is_published=True)[:3]

        flagship = Project.objects.filter(
            slug=FLAGSHIP_PROJECT_SLUG, is_active=True
        ).first()
        context['flagship_project'] = flagship
        if flagship and flagship.drilldown:
            context['flagship_sections'] = decorate_sections(flagship.content)
        else:
            context['flagship_sections'] = []

        return context
```

#### Exact Replacement for `ProjectListView` in `content/views.py`:
```python
class ProjectListView(ListView):
    """Projects page.

    Redirects directly to the flagship project detail page when active in the
    database so visitors bypass placeholder cards. Falls back to the standard
    list view when the flagship slug is absent (e.g., unit test fixtures).
    """
    model = Project
    template_name = 'content/project_list.html'
    context_object_name = 'projects'

    def get(self, request, *args, **kwargs):
        if Project.objects.filter(slug=FLAGSHIP_PROJECT_SLUG, is_active=True).exists():
            return redirect(f'/projects/{FLAGSHIP_PROJECT_SLUG}/')
        return super().get(request, *args, **kwargs)

    def get_queryset(self):
        return Project.objects.filter(is_active=True)
```

---

### Task 3.2: Update Navigation & Footer in `content/templates/content/base.html`
1. Do NOT modify `<head>`, external stylesheet links, SRI hashes, or `<script>` tags at the bottom of `content/templates/content/base.html`.
2. Replace the `<nav>...</nav>` block with the Command Center navigation bar:
   * Brand: `Dan Herman` with subtle badge `AI Systems Architect` linking to `{% url 'home' %}`.
   * Nav items:
     * `Overview` -> `{% url 'home' %}`
     * `System Architecture` -> `/projects/enterprise-clinical-copilot/`
     * `Bio & Resume` -> `{% url 'resume' %}`
     * Primary CTA button: `Launch Live Demo` -> `/demo/`
3. Replace the `<footer>...</footer>` block with the updated footer containing the direct contact link (`mailto:dan@danielmherman.com`) and existing social links (`LinkedIn`, `GitHub`, `Hacker News`).

#### Exact Replacement for `<nav>...</nav>` in `content/templates/content/base.html`:
```html
    <!-- Navigation-->
    <nav class="navbar navbar-expand-lg navbar-dark bg-dark border-bottom border-secondary border-opacity-25">
        <div class="container">
            <a class="navbar-brand fw-semibold" href="{% url 'home' %}">
                Dan Herman
                <span class="badge bg-secondary bg-opacity-25 text-light fw-normal ms-2" style="font-size: 0.7rem; vertical-align: middle;">
                    AI Systems Architect
                </span>
            </a>
            <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav" aria-controls="navbarNav" aria-expanded="false" aria-label="Toggle navigation">
                <span class="navbar-toggler-icon"></span>
            </button>
            <div class="collapse navbar-collapse" id="navbarNav">
                <ul class="navbar-nav ms-auto align-items-lg-center gap-lg-2">
                    <li class="nav-item">
                        <a class="nav-link" href="{% url 'home' %}">Overview</a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link" href="/projects/enterprise-clinical-copilot/">System Architecture</a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link" href="{% url 'resume' %}">Bio &amp; Resume</a>
                    </li>
                    <li class="nav-item ms-lg-2 mt-2 mt-lg-0">
                        <a class="btn btn-primary btn-sm px-3 fw-medium" href="/demo/">
                            <i class="fas fa-terminal me-1"></i> Launch Live Demo
                        </a>
                    </li>
                </ul>
            </div>
        </div>
    </nav>
```

#### Exact Replacement for `<footer>...</footer>` in `content/templates/content/base.html`:
```html
<!-- Footer -->
<footer class="bg-dark text-white mt-5 py-5 border-top border-secondary border-opacity-25">
    <div class="container text-center">
        <div class="mb-3">
            <span class="text-secondary small text-uppercase fw-semibold d-block mb-1" style="letter-spacing: 0.08em;">
                Direct Contact &amp; Demo Access
            </span>
            <a href="mailto:dan@danielmherman.com" class="text-white text-decoration-none fw-medium fs-5">
                <i class="far fa-envelope me-2 text-primary"></i>dan@danielmherman.com
            </a>
        </div>
        <div class="social-links my-3">
            <a href="https://www.linkedin.com/in/danherman/" class="text-white me-3" target="_blank" rel="noopener"><i class="fab fa-linkedin fa-2x"></i></a>
            <a href="https://github.com/DanHerman212" class="text-white me-3" target="_blank" rel="noopener"><i class="fab fa-github fa-2x"></i></a>
            <a href="https://news.ycombinator.com/user?id=lazarus01" class="text-white me-3" target="_blank" rel="noopener"><i class="fab fa-hacker-news fa-2x"></i></a>
        </div>
        <p class="text-secondary small mb-1">&copy; 2026 Dan Herman. All rights reserved.</p>
        <p class="text-secondary small mb-0">
            Developed in house with
            <img src="https://static.djangoproject.com/img/logos/django-logo-negative.svg" alt="Django" height="22" style="vertical-align: bottom;">
        </p>
    </div>
</footer>
```

---

## PART 4: MANDATORY VERIFICATION & BOUNDARY AUDIT (READ-ONLY)

After applying Task 3.1 and Task 3.2, execute the following two verification commands:

1. **Boundary Audit:**
   ```bash
   git status --porcelain
   ```
   * **Pass Criterion:** Output must list ONLY `M content/views.py` and `M content/templates/content/base.html` (plus untracked docs/governance files if newly added). Zero files in `demo/` or the Agent Backend repo may be modified.

2. **Test Suite Execution (Read-Only Diagnostic):**
   ```bash
   python manage.py test content
   ```
   * **Pass Criterion:** All tests in `content` pass.
   * **Stop Condition:** If any test fails, DO NOT edit `content/tests.py`. Report the exact traceback to the user and halt.