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

---

# Hybrid Real-Note Direction (Step 3, 2026-08-21)

_This is the **locked direction** for the v3 data pass, decided after the Step-2
MTSamples analysis (`mtsamples_agenda_2026-08-21.md`). Supersedes the v2
synthetic-notes-only plan in the sections above for the NOTES; the serving
architecture and feature rows stay as they are._

## 3.1 The decision

**Notes = real MTSamples discharge-summary transcriptions.**
**Feature rows = parsed-where-present + story-anchored fill for the rest.**
**Risk scores = the real served model on those rows.**

This is the hybrid that the Step-2 analysis supports:

- MTSamples notes are genuinely richer than v1 synthetic (real polypharmacy:
  19/108 notes with ≥5 discharge meds, max 23; coherent narratives; no template
  repetition), which is exactly the "thin content" gap v2 was trying to patch.
- The corpus is clean and parseable: **108/108 nav-free**, 96/108 with ≥1
  recognised section after the shared parser's MTSamples aliases.
- The model, threshold, serving path, ingest pipeline, fixtures, and site are
  **unchanged** — only the note text and the fill logic change.

## 3.2 Extractability table (measured, of 108 notes)

In-text extractability of the 49 model features (loose presence signals):

| Feature family       | In-text | Note                                      |
|----------------------|---------|-------------------------------------------|
| gender               | 100/108 | near-universal pronoun/noun signal         |
| medication           | 96/108  | case-insensitive + fraction-dose counting  |
| age                  | 77/108  | `NN-year-old` / `age of N`                 |
| procedure            | 67/108  | surgery/operation/procedure mentions       |
| labs                 | 56/108  | hgb/sodium most common; rbc/rdw/mono derived |
| race                 | 48/108  | else filled race_unknown (see §3.4)        |
| discharge_location   | 33/108  | else default home                          |
| ed_visits            | 31/108  | ER/ED mentions                             |
| admission_type       | 24/108  | else default emergency                     |
| oncology             | 16/108  | cancer/onco/chemo/metastatic               |
| insurance            |  1/108  | **always filled** (age-based: ≥65 medicare)|
| LOS (index_los_days) |  1/108  | **filled** (chronicity/procedure/age inferred) |
| prior_admission      |  0/108  | **filled** ("status post" prior procedures counted) |

Fill strategy: `projects/agent-harness/scripts/fill_features.py`, which mirrors
the deployed `ReadmissionPredictor` locally (model.bst + manifest + threshold,
TreeSHAP top_factors aggregated to parent groups) so bands and drivers are
exactly what the endpoint returns.

## 3.3 Provenance / attribution

- **Source:** MTSamples (mtsamples.com) discharge-summary transcriptions,
  downloaded 2026-08-20. Raw text is **gitignored, local-only** (same posture as
  MIMIC note text); only derived/processed artifacts ship.
- **Public copy:** the demo will describe the notes as **"de-identified
  transcription samples"** — never "synthetic". Add MTSamples attribution
  (footer / README / about) with the download date.
- **Feature rows are parsed-and-filled, not raw**: every feature carries a
  provenance (parsed vs filled + basis). The site should expose this honestly
  (e.g. feature tooltip "parsed from note" vs "derived from note story").

## 3.4 Known artifacts / open decisions (carry to the build)

1. **race_unknown fill** — when a note never mentions race, the fill sets
   race_unknown and the model's race_unknown attribution can appear as a top
   factor ("race → reduces risk") on cards. Decision: prefer race-parsed notes in
   the final 24, and/or suppress filled-only race from displayed top_factors.
2. **Story-blind lower-bound is fixed** — prior procedures ("status post …") are
   counted as prior-admission signals, so complex notes (e.g. `1195`) now read
   high-risk coherently.
3. **Band spread after fill:** 43 low / 46 borderline / 19 high of 108. The
   final 24 (8/8/8) are selected from `selection_24.json` by chip support.
