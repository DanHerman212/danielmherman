# Hybrid Demo — Comprehensive Test-Suite Agenda

Status: SPRINT A COMPLETE · 2026-08-22 — demo working in production with all
fixes verified. Next: §6 Sprint B (Demo User Guide screenshots).
Scope: the production A2UI demo at `www.danielmherman.com/demo/a2ui/` (the real,
live system — real MTSamples notes, real served model, real RAG index). This
agenda drives a top-to-bottom pass so every capability is verified and any
issue is raised + remediated before it ships.

Legend: `[x]` = verified working · `[!]` = broken / needs fix · `[?]` =
unverified, needs a test · `[~]` = works but has a caveat.

---

## 0. Sprint A result (2026-08-22)

### Done + verified in production
- `[x]` **Citation links fixed** — SourceCard now shows the cited section body
  (alias-aware extraction mirroring harness `KNOWN_HEADINGS`); clicking `^[n]`
  re-renders the SourceCard to the correct extracted section. Verified live on
  risk + meds turns, no console errors.
- `[x]` **Meds citation semantics** — canvas composes SourceCard from the
  answer's first citation (`first_citation` + `cite=` param); agent prompt
  strengthened (cite the `discharge_medications` passage, not `^[1]`).
- `[x]` **Gender/sex coherence — full cohort corrected** — root cause was a
  feature-encoding inversion (fill set F→1.0 but model encodes 1=male). Fixed
  `fill_features.py`, rebuilt cohort (re-scored: 7 low / 14 borderline / 3
  high), reloaded BigQuery hybrid_*, re-seeded site. 0 gender mismatches now.
  90000015 → Cynthia Petrov 61F (0.1515), 90000009 → Linda Okafor 48F (0.1254),
  90000017 → Deborah Sokolov 47F (0.1572, now borderline).
- `[x]` **Blank provenance fixed** — non-risk canvas shows "No model — no
  readmission estimate was requested" (no dashes).
- `[x]` **Endpoints redeployed + live** — predict (readmission-endpoint) + RAG
  (readmission-rag-index → rag_tree_ah). Live predict + RAG verified.
- `[x]` **Site deployed** (build ae005219) + production pass green (43 tests).
- `[x]` Commits pushed: ECC `787b930`, site `2ceb7b7`.

### Remaining notes
- `[x]` RAG fixtures refreshed from the live endpoint (all 3 chips, 5 passages
  each) — provenance now current.
- `[x]` `PREDICT_PATIENTS` updated to the corrected low/borderline/high trio
  `[90000001, 90000009, 90000023]` (90000023 is the true high at 0.3262;
  90000017 moved to borderline after the gender re-score). Orphaned
  `predict_90000017.json` removed; `predict_90000023.json` added. 43 tests
  green. Commits: site `1ac5a10`, ECC `985bcf5`.

---

## 0a. Session goals (from the user)

### Repos / branches
- `danielmherman` (site) — branch `main`, HEAD `4f8f2e8` (on origin/main).
  **Uncommitted local work:**
  - `M demo/a2ui_canvas.py` — non-risk prov caption fix (written, NOT deployed)
  - `M static/vendor/a2ui/a2ui_risk_components.js` — SourceCard title uses
    section not query (written, NOT deployed)
  - `M static/js/demo_a2ui.js` — bumped `a2ui_risk_components.js?v=4`→`?v=5`
  - `M demo/tests.py` — strengthened non-risk canvas test (written, NOT run)
  - `?? docs/hybrid_demo_test_agenda.md` — this doc (uncommitted)
- `enterprise_clinical_copilot` (harness) — no code changes pending for this
  task; `rag/sections.py` + `scripts/*` already committed.

### Verified working in production (2026-08-21 live pass)
- All 3 chips return real hybrid data: risk 16.1% borderline (Alan Petrov,
  90000015), full real meds list, multi-section summarize.
- Citation superscripts (`^[n]` → `<sup class="cite">`) render and ARE
  clickable; clicking `[2]` on summarize switched SourceCard to
  `[2] discharge diagnosis` (mechanically works).
- Trace toggle, "Show composed messages", quota decrements, live-mode
  indicator all work; console clean (no page errors).
- Demo User Guide link renders in the A2UI header and routes to `/demo/guide/`.

### Root-caused bugs — NOT yet fixed
- `[!]` **SourceCard body never changes on citation click** — extraction
  (`_extract_section` in `a2ui_canvas.py` + `extractSection` in
  `demo_flow.js`) searches canonical MIMIC headers but MTSamples notes use
  different headers ("HOSPITAL COURSE:", "DISCHARGE DIAGNOSES:",
  "MEDICATIONS:", "INSTRUCTIONS GIVEN…"). Extraction misses → falls back to
  the WHOLE note → every citation shows "CHIEF COMPLAINT: …" → links look
  dead. Fix = alias-aware header list (mirror harness `rag/sections.py`
  `KNOWN_HEADINGS`).
- `[!]` **Citation-number mismatch on non-risk turns** — meds answer cited
  `^[1]` for the meds list, but `SUMMARY_SECTIONS` order puts
  `discharge_medications` at `[3]` (brief_hospital_course=1,
  discharge_diagnosis=2, discharge_medications=3, discharge_instructions=4).
- `[!]` **Gender/sex coherence** — 90000015 "Alan Petrov" is `61M` in the
  rail/features but the MTSamples note 2788 narrates a 61-year-old female
  (she/her). Data bug in `build_hybrid_fixtures.py` / `seed_demo_cohort.py`
  (`_assign_name`/`_summary` use feature gender; note gender not cross-checked).
- `[!]` **Blank provenance on non-risk chips** — "Model — · features from —".
  (Fix already written in `a2ui_canvas.py`, not deployed.)
- `[!]` **Source label mismatch** — SourceCard title used `query`
  ("discharge notes") instead of the cited `section`. (Fix already written in
  `a2ui_risk_components.js`, not deployed.)
- `[?]` Non-risk h2 wording ("No 30-day readmission risk estimate was
  requested") may read as an error to reviewers.
- `[~]` Duplicate `rag_search_sections` seen in one earlier trace — confirm.

### Decisions pending (user) — default recommendations in parens
1. 90000015 gender: relabel patient to match the note (F) vs swap note.
   (Recommendation: note-first → relabel to F.)
2. Non-risk canvas heading: keep honest h2 vs soften.
   (Recommendation: keep honest, maybe soften wording.)
3. SourceCard: one card following last-clicked cite vs one card per `^[n]`.
   (Recommendation: one following card for now.)

---

## 0a. Session goals (from the user)

- Pause, reset, and look at the demo **top to bottom**.
- Organize an agenda around a **comprehensive test suite**.
- The user has already spotted: **"the citation links are not working."**

---

## 1. Inventory — the demo from top to bottom

| Layer | Artifact | Path |
|---|---|---|
| Page | A2UI console template | `demo/templates/demo/a2ui_console.html` |
| Guide | Demo User Guide | `demo/templates/demo/guide.html` |
| Views | a2ui_console / a2ui_ask / console / ask | `demo/views.py` |
| Canvas composer | `compose_risk_canvas` | `demo/a2ui_canvas.py` |
| Fixtures | `fixture_ask`, `_compose_answer`, `_CHIP_QUERY` | `demo/fixtures.py` |
| Client flow | patient rail, thread, chips, citations | `static/js/demo_flow.js` |
| A2UI driver | envelope -> surface, SourceCard cite | `static/js/demo_a2ui.js` |
| A2UI renderer | RiskBar / FactorBars / SourceCard | `static/vendor/a2ui/a2ui_risk_components.js` |
| Agent (live) | prompt citation rules, rag_search_sections | `projects/agent-harness/agent/prompts.py`, `mcp_server/tools/rag_search.py` |

User journeys (from the guide): (1) select patient, (2) run risk, (3) summarize
notes, (4) list medications, (5) read the trace, (6) read the composed
messages, (7) open the Demo User Guide.

---

## 2. Findings from the production audit (2026-08-21)

### 2.1 Citation links — the user's report, root-caused

`[!]` **The thread citation superscripts (`^[n]` -> `<sup class="cite">`) are
present and clickable**, and clicking one DOES re-render the canvas with the
SourceCard pointed at that passage (verified live: clicking `[2]` on the
summarize turn changed the SourceCard to `[2] discharge diagnosis`).

`[!]` **But the SourceCard BODY never changes** — it shows the WHOLE note
(starting "CHIEF COMPLAINT: …") no matter which citation is clicked. Root
cause: `_extract_section` (`a2ui_canvas.py`) and `extractSection`
(`demo_flow.js`) search for canonical MIMIC headers ("Brief Hospital Course",
"Discharge Diagnosis", …) but the MTSamples note text uses different headers
("HOSPITAL COURSE:", "DISCHARGE DIAGNOSES:", "MEDICATIONS:",
"INSTRUCTIONS GIVEN TO THE PATIENT AT THE TIME OF DISCHARGE:"). The regex
misses, extraction returns `None`, and the code falls back to the full note
text. Result: clicking a citation changes only the `[n]` badge + section
label; the body looks identical → "the citation links don't work."

- Fix: the extraction header list (in BOTH `a2ui_canvas.py` and
  `demo_flow.js`) must include the MTSamples aliases — mirror the harness
  `rag/sections.py` `KNOWN_HEADINGS` (e.g. "Hospital Course", "Discharge
  Diagnoses", "Medications", "Instructions Given to the Patient at the Time
  of Discharge", "Discharge Medications/Instructions").

`[!]` **Citation-number vs passage mismatch on non-risk turns.** The live meds
answer cited `^[1]` for the medications list, but `SUMMARY_SECTIONS` order is
brief_hospital_course=1, discharge_diagnosis=2, discharge_medications=3,
discharge_instructions=4 — so `^[1]` pointed at the hospital course, not the
meds. (Agent-side; the meds section is `[3]`.) Decide: agent should cite the
section it actually used (or the canvas should render all cited passages, one
SourceCard per `^[n]`).

### 2.2 Other issues found

`[!]` **Gender/sex coherence bug in the demo data.** Patient 90000015
"Alan Petrov" is displayed `61M` (demo_cohort sex=M, feature gender=1.0), but
the MTSamples note 2788 narrates a **61-year-old white female** (she/her
throughout). A reviewer reading the note against the rail sees the mismatch.
Root: `_assign_name`/`_summary` use the filled feature gender; nothing
cross-checks the note's narrated sex. (See `scripts/build_hybrid_fixtures.py`
and `scripts/seed_demo_cohort.py`.)

`[!]` **Canvas provenance is blank on non-risk chips.** Meds/summarize canvas
shows "Model — · features from — · A2UI canvas" because `predict` is None and
the caption hard-codes dashes. (Fix already written in `a2ui_canvas.py`:
non-risk now says "No model — no readmission estimate was requested…" — not yet
deployed.)

`[!]` **Source label mismatch.** SourceCard widget title came from
`props.query` ("discharge notes") while the citation badge shows the section
("brief hospital course"). (Fix already written in `a2ui_risk_components.js`:
title now uses `props.section` — not yet deployed.)

`[?]` **Non-risk canvas heading.** "No 30-day readmission risk estimate was
requested for this question." renders as an h2. Intended, but confirm it does
not read as an error to reviewers.

`[~]` **Duplicate `rag_search_sections` calls** seen in one trace earlier —
confirm whether the live agent issues it more than once per turn.

---

## 3. The comprehensive test agenda

### 3.1 Server-side unit tests (Django, `demo/tests.py`) — run first, fast, deterministic

- [ ] `a2ui_canvas.compose_risk_canvas`: risk payload → RiskBar + FactorBars +
      prov names model + bigquery; non-risk → honest note + prov without
      dashes; failed predict (dict w/o probability) → honest note, no 500.
- [ ] `compose_risk_canvas` SourceCard: section = cited passage's section;
      body = EXTRACTED section text (not the whole note) for a real MTSamples
      note snippet (add aliases coverage: "HOSPITAL COURSE:", "DISCHARGE
      DIAGNOSES:", "MEDICATIONS:", "INSTRUCTIONS GIVEN…").
- [ ] `fixture_ask`: risk/meds/summarize each return answer + tool_calls +
      `^[n]` markers that stay in range of returned passages; free text →
      clear "use the live agent" message; unknown chip → same; bad hadm_id →
      400; unknown patient → 404.
- [ ] `views.a2ui_ask`: fixture mode returns `a2ui` envelope; quota decrements;
      refund on AgentError and on errored tools (502).
- [ ] `views.ask` (custom demo): parity checks.

### 3.2 Static JS unit-ish checks (node, no browser needed where possible)

- [ ] `citedNumbers` / `citationMarkers` parse `^[1]`, `^[1, 2]`, `^[1-3]`.
- [ ] `extractSection` extracts real MTSamples sections (add alias tests).
- [ ] `wireCitations` collapses repeated same-passage citations, keeps
      distinct ones, attaches a click handler per sup.
- [ ] `envelopeForCite(turn, n)` re-points SourceCard to passage n-1.

### 3.3 Local integration (dev server on 8008, fixture + live mode)

- [ ] Load `/demo/a2ui/`, pick 90000015 (Alan Petrov). Risk chip → 16.1%
      borderline, real top factors, SourceCard shows the cited section body.
- [ ] Meds chip → real meds list; canvas SourceCard = the DISCHARGE MEDS
      section (not hospital course); prov caption honest.
- [ ] Summarize chip → multi-citation answer; click `[2]` → SourceCard body
      changes to Discharge Diagnoses text.
- [ ] Free text → fixture-mode message; live-mode grounds to admission.
- [ ] Quota decrements; "Earlier messages" collapse/expand; patient search +
      pagination; back button resets.
- [ ] Guide page: every link resolves, screenshots present, back-link returns
      to `/demo/a2ui/`.

### 3.4 Live production pass (`www.danielmherman.com/demo/a2ui/`)

- [ ] All of 3.3 against production after deploy.
- [ ] Trace toggle: tool calls listed w/ payloads; no duplicate calls.
- [ ] "Show composed messages": envelope is the agent's own composition.
- [ ] Console clean (no page errors), on all three chips + free text.
- [ ] Cross-patient isolation: switching patients resets episode memory.

### 3.5 Data/coherence checks

- [ ] Every demo patient's note narrative (age/sex) matches the rail
      (age/sex). Fix 90000015 gender mismatch (or relabel note).
- [ ] `hybrid_cohort.json` ↔ `demo_cohort.json` ↔ `cohort_risk.json` all agree
      on 24 patients, bands, and probabilities.
- [ ] Citation `^[n]` in every fixture answer points at a real returned
      passage (guardrail parity).

---

## 4. Execution order

1. Write the alias-aware extraction (a2ui_canvas.py + demo_flow.js) + the
   non-risk prov fix + SourceCard title fix (some already written).
2. Add the server-side tests above; make them pass (fixture + live paths).
3. Fix the meds `^[1]`→`^[3]` citation semantics (agent prompt or canvas
   renders all cited passages).
4. Fix the 90000015 gender/sex coherence.
5. Local run-through (3.3) with dev server.
6. Deploy (regional build, `--region=us-east1`); run 3.4 + 3.5 in production.
7. Record results back here; raise any remaining issues to the user.

---

## 6. Tomorrow's sprint (next session)

### Sprint A — get the demo working (today's work, resumed)
1. Commit the uncommitted local work first (or fold into the fix pass):
   `a2ui_canvas.py`, `a2ui_risk_components.js`, `demo_a2ui.js` (`?v=5`),
   `tests.py`, and this doc.
2. Implement the alias-aware section extraction in `a2ui_canvas.py` +
   `demo_flow.js` (mirror `rag/sections.py` `KNOWN_HEADINGS`). **This is the
   citation-links fix** — the SourceCard body will finally change on click.
3. Resolve the meds `^[1]`→`^[3]` citation semantics (agent prompt to cite
   the section it used; or canvas renders one SourceCard per cited passage).
4. Fix 90000015 gender/sex coherence (note-first: relabel patient to F) —
   re-seed `demo_cohort.json` via `build_hybrid_fixtures.py` + reload site.
5. Run the unit tests (3.1) + JS checks (3.2) + local integration (3.3).
6. Deploy (regional build — check `--region=us-east1`), run production pass
   (3.4) + data checks (3.5). Confirm console clean + citation clicks now
   change the SourceCard body.
7. Decide the 3 open questions with the user if not already settled
   (gender, non-risk h2 wording, one-card-per-cite).

### Sprint B — finish the Demo User Guide with screenshots
Prerequisite: Sprint A done (demo working in production).
1. Capture live screenshots from `www.danielmherman.com/demo/a2ui/` covering
   each user journey in the guide:
   (1) patient rail/selection, (2) risk chip + risk canvas (RiskBar +
   FactorBars + provenance + SourceCard), (3) summarize chip + citations,
   (4) meds chip + source, (5) trace view, (6) composed messages,
   (7) guide page itself + quota/back behaviors.
2. Save into `demo/static/` (e.g. `images/guide/`) and wire into
   `demo/templates/demo/guide.html` (it already has the structure + `.guide-root`
   tokens; add the `<img>` per journey with captions + alt text).
3. Verify every guide link resolves, back-link returns to `/demo/a2ui/`,
   images load over HTTPS, and the page renders in production.
4. Screenshots must show the REAL system (live chips + real data) — never a
   stub; per the user's no-shortcuts stance, fixtures are dev-only scaffolding.

### Known gotchas for the sprint (from memory)
- Builds are REGIONAL: `gcloud builds list` needs `--region=us-east1`.
- After regenerating fixtures, RESTART the dev server (`fixtures.py`
  `lru_cache` serves stale cohort risk).
- Site venv: `/Users/danherman/Desktop/danielmherman/.venv/bin/python`; dev
  server on 8008.
- After editing `rag/` or `pipelines/`, rebuild the RAG image AND pin a fresh
  tag (`RAG_IMAGE_URI`) to bust the KFP cache.

---

## 5. Open questions for the user

- Non-risk canvas: keep the "No 30-day readmission risk estimate was
  requested" h2, or make it less alarming (e.g. "No risk estimate — this
  question is about the notes, not the model")?
- Should the canvas render ONE SourceCard per `^[n]` cited passage (so meds
  shows the meds section), or keep one SourceCard that follows the last
  clicked citation?
- 90000015: relabel as female (note is authoritative, it's real MTSamples
  text) or swap to a male note? Note-first means the patient record should
  follow the note.
