# Demo pass + citation remediation — 2026-09-04

One patient walked end-to-end on the **live** site (`danielmherman.com/demo/a2ui/`),
patient **Alan Boyle** (`hadm_id 90000005`, note `MT-1148-DS`). Every chip and
citation link was clicked and checked against ground truth.

## Ground truth for the test patient

The note `MT-1148-DS` has these sections (queried from `readmission.hybrid_notes`):

1. DISCHARGE DIAGNOSES
2. DISCHARGE INSTRUCTIONS  ← **contains the medication list**
3. HISTORY OF PRESENT ILLNESS
4. PAST MEDICAL/FAMILY/SOCIAL HISTORY
5. REVIEW OF SYSTEMS
6. PHYSICAL EXAMINATION
7. LABORATORY STUDIES
8. HOSPITAL COURSE

There is **no MEDICATIONS section**. The meds ("Valium 10-20 mg…, Flomax…,
cefazolin…, Lotrimin…") live inside DISCHARGE INSTRUCTIONS.

## Issues found

### 1. [CRITICAL] Citation links resolve to "note" instead of the real section

**Repro:** Select Alan Boyle → any chip → click a `[n]` superscript in the answer.

All five citation links were clicked on the live site. Every one flips the
SourceCard section label to **"note"**:

- Risk `[1]` → "note" (server canvas said "brief hospital course").
- Summarize `[1]` → "note" (should be brief hospital course).
- Summarize `[2]` → "note" (should be discharge diagnosis).
- Summarize `[3]` → "note" (should be discharge instructions).
- Meds `[1]` → "note" (should be discharge instructions).

"Show full section" (truncated-source expand) works.

**Root cause:** The deployed `demo_a2ui.js` is **stale**. It still contains the
old `S7-17(b)` fallback in `envelopeForCite`, which labels the section `'note'`
whenever header extraction fails. The server-composed canvas (Python side) is
already correct — only the **client-side** citation click path is stale.

The fix already exists in the local working tree
(`static/js/demo_a2ui.js`, the `knownSection` guard) but is **uncommitted and
undeployed**, which is why "nothing changed" on the live site.

**Fix:** commit + deploy `static/js/demo_a2ui.js` (cache bump `?v=10` → `?v=11`
already present in `a2ui_console.html`).

### 2. [BY DESIGN — NOT A BUG] Meds chip cites "discharge instructions"

The meds answer cites "discharge instructions" because this patient's note has
no medications section — the meds are written inside DISCHARGE INSTRUCTIONS.
The `intent_sections` preference order (`discharge_medications` →
`discharge_instructions`) falls back correctly, so the citation is honest. For
patients whose notes *do* have a MEDICATIONS section, the same chip will cite
`discharge_medications`.

### 3. [DATA STALENESS] Patient rail band disagrees with the live model

Rail header shows **borderline · 12.1%**; the live run shows **high · 25.1%**.

- Rail: cached `demo/data/demo_fixtures/cohort_risk.json`, old model
  `readmission-final-20260723172647`, `feature_source: "hybrid"`.
- Live: `readmission-final-20260902014308`, `feature_source: "bigquery"`.

The rail renders from a fixture snapshot of the **old** model. Regenerating it
from the current model (89 patients) is a separate data task — tracked, not
part of the citation fix.

### 4. [WORKING] Confirmed correct during the pass

- Risk canvas: RiskBar (25.1%, above threshold · high), FactorBars with SHAP
  directions/magnitudes, provenance caption (model + feature source).
- Summarize chip: three sections, one citation each, correct bodies.
- Trace view: full tool-call payloads (`predict_readmission`, `rag_search`,
  `rag_search_sections`) with per-passage `section` fields present.
- Composed-messages pane: valid A2UI envelope JSON.
- Patient rail search, pagination, band legend, quota counter.

## Remediation done

- `static/js/demo_a2ui.js`: `envelopeForCite` now keeps the passage's known
  section (`matchedSection || passage.section`) when header extraction fails,
  and only falls back to `'note'` when the section is genuinely unknown.
- Cache bust: `a2ui_console.html` script tag `?v=11`.
- `collectstatic` refreshed `staticfiles/` (gitignored; regenerated on deploy).

## What is still required (deploy — user-owned)

The fix is local-only until pushed + deployed. Deploy runs `collectstatic`,
which copies `static/` → `staticfiles/` and serves the corrected JS.
