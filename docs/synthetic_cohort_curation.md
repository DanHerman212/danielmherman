# Synthetic Cohort — Curation Pass (v2) Scope

_Created 2026-08-20. Owner: Dan. Companion to `synthetic_cohort_plan.md` (Phase 2)
and the live v1 deployment. This is a **scope / planning document only** — no work
executed from it yet.

## 1. Why this pass exists

The v1 synthetic cohort (24 patients, `eval/results/synthetic_notes.json`) is live
and systemically correct, but the **clinical content is too thin** — a reviewer
whose trust we want will notice:

1. **No polypharmacy.** Max meds per note is 3; most are 1–2. Real complex
   discharges (CHF, oncology, CKD, COPD) run 5–8 meds.
2. **Feature ↔ note mismatch.** `synthetic_cohort.json` has a `medication_count`
   feature per patient that does **not** match the note's actual meds list.
   The same applies to other features (labs, LOS) — the note doesn't reflect them.
3. **The `___` redaction blanks.** v1 notes copy MIMIC's de-identified template
   (`Name: ___`, `Attending: ___`). That artifact makes *synthetic* notes read as
   unfinished. Real-looking synthetic content should replace the blanks.
4. **Narrative doesn't cross-check the row.** Labs (rbc, sodium, RDW, hemoglobin),
   LOS, prior admissions, procedures are described vaguely and can contradict the
   feature values the model scores.

The machine (ingest pipeline, index, fixtures, endpoints) is **not** the problem —
it's correct and cheap to re-run. The gap is the data. This pass makes the v1
skeleton into a defensible, finished product.

## 2. Scope — what changes vs what stays

### Stays (no changes)
- The 24-patient cohort size, synthetic id scheme (`90000001`–`90000024`), and
  band spread (8 low / 8 borderline / 8 high).
- The serving architecture end-to-end (BigQuery → rag-ingest pipeline → synthetic
  index → predict/RAG endpoints → fixtures → site). No API/contract changes.
- The model (`model.bst`), threshold/bands, and the real predict path on synthetic
  features.
- The `___` **name/redaction convention for people** (no real patient names) — but
  see item 3 below: the clinical *narrative* blanks are filled in, not the person
  redaction.

### Changes (this pass)
1. **Medication realism.** Expand every variant's `meds` list to a clinically
   coherent regimen (complex archetypes 5–8 meds; simple ones stay light). Route,
   dose, frequency, and rx_line per med.
2. **Feature ↔ note alignment.** The discharge meds list (and count) must match the
   patient's `medication_count` feature; narrative labs and LOS must match the
   feature row. This is the "coherence rule" made concrete.
3. **Fill the clinical blanks.** Replace template blanks in narrative sections with
   real synthetic content (dates, attending, findings, values) — person identifiers
   stay redacted. Keep the format recognizably a discharge summary.
4. **Narrative ↔ features cross-check.** Age, sex, LOS, prior admissions, procedures,
   labs (rbc/sodium/RDW/Hgb) mentioned in the note agree with the feature row.
5. **More patient-to-patient variety.** Round-robin currently picks from 2–3 variants
   per archetype; add enough variants that 24 notes don't read as 8 templates.
6. **Consistency across sections.** pmh ↔ meds ↔ diagnoses ↔ disposition ↔
   instructions cohere (e.g., CHF + AF → anticoagulant + statin + ACEi + loop
   diuretic + β-blocker; disposition matches).

### Explicitly out of scope
- Statistical full-index fidelity / re-deriving a real cohort distribution.
- Changing cohort size or band targets (unless v2 reveals a reason).
- Model retraining or threshold changes.
- Front-end/UX changes (contract is identical).

## 3. Concrete tasks

### Task C1 — Meds library + regimen mapping
- Build a curated med library keyed by archetype/condition (drug, dose, route, freq,
  rx_line) with realistic polypharmacy for complex cases.
- Define per-archetype **base regimen** (chronic meds) + **acute/admission meds** so
  discharge lists look like real transitions of care.

### Task C2 — Note generator rework (`generate_synthetic_notes.py`)
- Rework `TEMPLATES` + `_note()` to:
  - Render meds from the regimen, **count-matched to `medication_count`**.
  - Inject feature values (age, LOS, labs) into the narrative.
  - Fill clinical blanks; keep person-redaction.
  - Add variants to break template uniformity.
- Regenerate `eval/results/synthetic_notes.json`; spot-check all 24 for coherence
  and variety.

### Task C3 — Coherence verification (script or notebook)
- For each patient, assert: meds count == `medication_count`; note-mentioned labs ⊂
  feature row; LOS/age/sex/prior-adm match; sections cohere (pmh ↔ dx ↔ meds ↔
  disposition). Fail the gate on any mismatch.

### Task C4 — Re-ingest + re-deploy (the machine, reused)
1. Reload notes: `scripts/load_synthetic_notes.py` (WRITE_TRUNCATE).
2. Re-run `rag-ingest` pipeline — chunk/embed may re-run since notes changed
   (cache keyed on inputs); small-shard index, cheap machines. Submit via
   `submit_pipeline.sh` envs as before (`SHARD_SIZE_SMALL`, synthetic tables,
   `PREVIOUS_INGEST_URI=""`).
3. Deploy the new synthetic index: `scripts/deploy_synthetic_rag.py`
   (auto-picks newest `rag-tree-ah-*`).
4. Rebuild fixtures: `build_synthetic_fixtures.py` (risk) +
   `capture_synthetic_rag_fixtures.py` (rag, after index live).
5. Re-seed site: `seed_synthetic_demo_cohort.py` → `manage.py seed_demo_patients
   --prune` (names unchanged by design — same deterministic names).

### Task C5 — Verification (E2E + eval)
- Re-run `integration_test_live.py` with the synthetic overrides (R1+, R1, ML).
- Drive all 3 chips + citations + trace on several patients; **no empty-path
  patients**; meds chip shows a coherent polypharmacy list where the row says so.
- Re-run the golden eval (regression → full) on synthetic — confirms agent behavior
  gates.

### Task C6 — Compliance + QA sign-off
- Re-confirm no real MIMIC content ships (ties to `mimic_dua_compliance.md`);
  update the compliance note's synthetic-data description.
- QA walkthrough by Dan; sign off v2 as the public-facing data.

## 4. Definition of done (v2)

- Every patient's note is coherent and varied; complex archetypes show realistic
  polypharmacy (5–8 meds).
- Feature ↔ note alignment passes the C3 gate for all 24.
- No `___` clinical blanks remain (only person redaction, clearly intentional).
- Live RAG returns only synthetic content; all chips cite; no empty paths.
- Eval green on synthetic; compliance note updated; Dan walks through and signs off.

## 5. Cost / effort notes

- Re-running the ingest is cheap: cached KFP steps + small shard (e2-standard-2).
- Most effort is content (C1–C3), not plumbing — the pipeline is a solved problem.
- Fixtures + index + site re-seed are scripted; no new architecture.

## 6. Open questions for Dan (before execution)

1. **Person-redaction style:** keep `___` for names only (recommended), or generate
   fully fictional names in-note? (Site already shows display names; note-level names
   are separate.)
2. **Lab specificity:** how detailed should narrative labs get? (Recommend: mention
   the feature-driving labs — rbc, sodium, RDW, hemoglobin — with values matching
   the row, lightly rounded.)
3. **Variant count target:** how many variants per archetype feels "enough" to you?
   (Recommend ≥4 for the 8-patient bands, ≥3 elsewhere.)
4. **Scope of the med library:** reuse the current per-archetype drugs and just add
   more, or build a broader library (recommend: broader, so meds vary across patients
   of the same archetype).
