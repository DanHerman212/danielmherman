# Synthetic Cohort — Phase 2 Agenda

_Loaded 2026-08-20. Owner: Dan. Companion to `docs/go_live_plan.md` (Phase 2 —
synthetic cohort swap) and `enterprise_clinical_copilot/docs/mimic_dua_compliance.md`._

## Goal

Swap the demo's real (MIMIC-derived) data for **fabricated data** — the final gate
before anything public. Keep the **UI/data contract identical**; only the data source
changes. **Compliance rule (settled):** no real MIMIC content ships anywhere via a
public demo, full stop.

## Design decisions (from the 2026-08-20 discussion)

- **Scope:** minimal-but-defensible — ~20–40 clinically coherent synthetic patients;
  the real model scores synthetic feature rows; rebuild fixtures for those patients.
  (Not a statistically-faithful full-index replacement — that's a later, optional lift.)
- **Coherence rule:** notes ↔ feature rows ↔ risk score must agree for each patient
  (a "high risk" patient's notes must reflect it, or the demo looks broken).
- **Band spread:** the cohort must span low / borderline / high so all three risk
  bands render in the UI.
- **Redaction convention:** synthetic notes use the app's `___` style (consistent with
  the existing synthetic-name approach).

## Task sequence

0. **Design & archetypes** — decide cohort size + patient archetypes (e.g., elderly
   CHF readmission, post-op infection, routine admission) and the feature↔notes
   mapping rules. Sign off before generating.
1. **Feature-row generator** — produce synthetic feature rows matching
   `manifest.json` feature order (age, LOS, prior admissions, labs, meds count, …)
   with realistic distributions.
2. **Risk scoring** — run synthetic features through `model.bst` → risk scores;
   validate band spread; adjust until low/borderline/high all appear sensibly.
3. **Discharge-note generator** — write coherent fictional discharge summaries per
   patient (hospital course, discharge diagnosis, discharge medications, discharge
   instructions) in the `___` redaction style, so RAG + meds/summarize chips work.
4. **RAG index (synthetic)** — chunk + embed the synthetic notes and build a
   synthetic index so retrieval returns **only fabricated content**. No real MIMIC text.
5. **Fixtures + re-seed** — rebuild `cohort_risk.json`, per-chip `rag_*.json`, and
   re-seed `demo/data/demo_cohort.json`. Keep the data contract identical.
6. **E2E verify** — drive all 3 chips + citations + trace on several patients; **no
   patient hits the "no supporting passage" empty path**; risk cards / meds /
   summaries coherent.
7. **Eval re-validation** — re-run the golden eval (regression sample → full) on the
   synthetic cohort; confirms agent behavior and gates the pinned Playground work.
8. **Compliance sign-off** — confirm no real MIMIC content anywhere in the public
   surface (ties to the DUA note); document the synthetic-only posture.
9. **QA walkthrough** — user drives the demo end-to-end on synthetic patients; sign-off.

## Definition of done

Full-coverage synthetic data, **same UX**, no empty paths, eval green on synthetic.

---

## Task 0 — design proposal (2026-08-20, IN PROGRESS — user on board, awaiting final sign-off)

**Open items to close on return:**
- Confirm cohort size: **24 patients** (8 low / 8 borderline / 8 high) vs current 32.
- Decide **(A) full synthetic** — live synthetic RAG index + synthetic features + offline
  fixtures (the real-system-on-synthetic-data path, matches the "no shortcuts" stance) —
  vs **(B) fixtures-first** — offline fixtures, then add the live index/features as follow-on.
  Recommendation: **A**.

**Synthetic id scheme:** `90000001`–`90000024` (clearly synthetic; no real MIMIC ids ship).

**Archetypes (by band):**

| Band | Archetype | Coherent story |
|---|---|---|
| High (8) | Elderly CHF exacerbation | 75–85y, 2–3 prior adm, long LOS, diuretics/β-blockers, rehab/SNF |
| | Oncology + infection | cancer hx, 8+ prior adm, febrile neutropenia, long stay, hospice/SNF |
| | Severe COPD readmission | 70–80y, prior adm, prolonged stay, steroids/bronchodilators |
| Borderline (8) | Post-op infection | 55–65y, 1 procedure, 5–7d stay, antibiotics, home w/ services |
| | Moderate CKD/pneumonia | 60–70y, 1 prior adm, 4–6d stay, moderate meds |
| | Diabetic foot / cellulitis | 50–65y, 1–2 prior adm, IV antibiotics, 4–6d stay |
| Low (8) | Routine short admission | 25–40y, 0–1 prior adm, 1–2d stay, few meds, home |
| | Minor elective procedure | 30–50y, 1 procedure, 1–3d stay, home |
| | Uncomplicated observation | 20–35y, observation, 1d, home |

**Coherence rules:** notes ↔ features ↔ risk must agree; `___` redaction style; all 4 RAG
sections present; no duplicated stories; plausible med lists.

**Band thresholds (app):** low < 0.12 · borderline 0.12–0.20 · high > 0.20 (at 0.12 threshold).
