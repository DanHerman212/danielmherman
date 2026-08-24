# UAT Results — Demo Console — 2026-08-24

**Scope:** production demo console at `www.danielmherman.com/demo/a2ui/`,
signed in as Dr. Lena Ortiz (hardcoded header). Endpoints redeployed in
parallel via `enterprise_clinical_copilot/scripts/launch_endpoints.sh`
(predict + RAG index) before the pass.

**Verdict: PASS with 1 open issue** — the citation-link mismatch reported
last night is reproducible on the meds chip and free-text turns. Everything
else is wired correctly end to end on the live system.

Legend: `[x]` verified working · `[!]` broken · `[~]` caveat

## Verified working (live pipeline, not fixtures)

- `[x]` **Live predict end-to-end.** Alan Boyle → 0.29975 (30.0%, high) with
  top factors ± contributions; Cynthia Petrov → 0.151509 (15.2%, borderline).
  Both match the rail exactly. Provenance:
  `predict_readmission, rag_search · model readmission-final-20260723172647`.
- `[x]` **Quota decrements per turn** — 21 → 15 across six turns (risk×2,
  summarize, meds×2, free text).
- `[x]` **Trace view** — every tool call with full payloads (hadm_id,
  probability, passages, model_version), no duplicate calls, R1 cross-patient
  isolation note rendered.
- `[x]` **Composed messages** — raw live A2UI envelope
  (`createSurface` v0.9 → Card/Column/SourceCard, `fixtureNote: ""`). The
  canvas is the agent's own composition.
- `[x]` **Citation clicks re-render the canvas.** Summarize turn on Alan
  Boyle: click `[1]` → `brief hospital course`; click `[2]` → SourceCard
  switches to `discharge diagnosis` with the extracted section body (the
  Sprint A alias-aware extraction fix works).
- `[x]` **Non-risk canvas** — honest h2 ("No 30-day readmission risk
  estimate was requested…") + provenance with no blank dashes.
- `[x]` **Meds chip (happy path content)** — Cynthia Petrov returns the real
  11-med discharge list with genuine polypharmacy, `used: rag_search_sections`.
- `[x]` **Free text** — "What were her discharge instructions?" grounds live
  on the note (meds, Coumadin INR schedule, follow-up, discharge date).
- `[x]` **Cross-patient isolation** — switching patients resets the episode
  (thread cleared, trace shows "No tool calls yet", ask box disabled until a
  patient is selected).
- `[x]` **Patient rail** — 108 patients, live search filter, pagination
  (1–10 / 11–20), band dots + legend (low/borderline/high/unscored).
- `[x]` **Thread controls** — "Earlier messages (n)" expands with a
  "Show fewer" toggle; "Show full section"/"Collapse" toggles the SourceCard.
- `[x]` **Guide page** — 4 journeys with anchor nav, all screenshots load,
  both back-links return to a fresh console; zero console errors, zero broken
  images.
- `[x]` **Nav** — Dashboard → "Coming soon" placeholder (intended);
  Readmission Risk → main view.
- `[x]` **Console clean** — no page/console errors across all chips, guide
  navigation, pagination, and nav clicks.
- `[~]` Alan Boyle (expired during admission) → meds chip honestly answers
  "No discharge medications were found…" — correct behavior for a note with
  no meds section, not an error.

## Open issue — `[!]` citation-link mismatch (reproduced)

The exact issue reported last night. The SourceCard on the canvas does not
match the section the citation refers to on **meds** and some **free-text**
turns.

**Repro 1 (meds chip, Cynthia Petrov 90000015):**
- Answer: "The patient was discharged on the following medications`[1]`:" +
  real 11-med list (`used: rag_search_sections`).
- Canvas SourceCard: `[1] brief hospital course` → body = HOSPITAL COURSE text.
- The meds content lives in the `discharge_medications` section of the note.

**Repro 2 (free text, same patient):**
- Question: "What were her discharge instructions?" → answer cites `[1]`
  with instructions/meds/follow-up content (`used: rag_search`).
- Canvas SourceCard: `[1] discharge diagnosis` → body = DISCHARGE DIAGNOSES.

**Root cause (from the composed envelope):** the canvas composes a single
SourceCard from the first citation and maps `cite n → passages[n-1]` in tool
response order. The agent's `^[n]` numbering does not correspond to that
array index for these turns. The summarize turn only aligns by coincidence
(its citations happen to match SUMMARY_SECTIONS order).

Composed envelope evidence (meds turn):
```json
{ "component": "SourceCard", "cite": 1,
  "section": "brief_hospital_course",
  "text": "HOSPITAL COURSE: As mentioned above, the patient was admitted…" }
```

**Impact:** the Demo User Guide promises "Citations point at real sections
of a real transcription… the agent drew from. Nothing is paraphrased into a
fact the note doesn't contain." That promise is currently broken for meds
and free-text turns — a reviewer clicking `[1]` on the meds list sees the
hospital course, not the meds.

**Candidate remediations (decide in the review sprint):**
1. Agent-side: instruct the agent to cite the correct passage index/section
   it actually used (strengthen prompt citation rules).
2. Canvas-side: compose one SourceCard per cited passage and map citations by
   section label, not by array index.
3. Tool-side: make `rag_search` / `rag_search_sections` return sections in a
   fixed order the canvas can rely on.

## Not tested
- Messages/Alerts bell buttons (decorative chrome).
- Mobile viewport.
- Quota exhaustion path (limit reached) — quota is per-user daily, 15 left.
