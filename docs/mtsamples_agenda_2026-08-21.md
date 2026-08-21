# MTSamples Evaluation — Tomorrow's Agenda (2026-08-21)

_Created 2026-08-20. Owner: Dan. Companion to `synthetic_cohort_curation.md`.
Goal: download the complete MTSamples dataset, assess what it gives us, and
decide how to make the demo more compelling with real EHR notes._

## Context (why this session)

- v1 synthetic notes are live but too thin (no polypharmacy, template-y, feature↔
  note mismatch).
- Research (2026-08-20) established MTSamples = ~5,043 unstructured transcribed
  notes across 40 specialties, incl. 108 discharge summaries. Apache-style free
  use for the demo is a decision Dan has made; data is de-identified.
- MTSamples provides NO tabular features — the predict path will still need
  parsed-and-filled feature rows (see extractability table in
  `synthetic_cohort_curation.md`).

## Agenda

### 1. Download the complete dataset (first, and gated on success)
- [ ] Determine the reliable download path (site pagination / crawler / any
      published mirror). MTSamples pages are per-sample HTML; ~5k samples.
- [ ] Crawl all 108 Discharge Summaries first (the demo's primary note type),
      then decide whether the rest of the corpus is worth pulling.
- [ ] Save raw HTML → parse to clean text (title, description, body, sections).
- [ ] Store the raw corpus in a **gitignored, local-only** directory
      (e.g. `projects/agent-harness/data/mtsamples/` — do NOT commit real notes;
      mirror the existing "no raw note text in git" rule).
- [ ] Record exact download date + source for provenance.

### 2. Explore the corpus (what can we actually use?)
- [x] Inventory: 108 discharge summaries downloaded (crawler, `fb06a9e`); median
      ~3,690 chars (300–7,771); 2 sparse (`1864`, `2024`). Raw corpus lives in
      gitignored `projects/agent-harness/data/mtsamples/` (+ `data/mtsamples_raw_backup/`).
- [x] **Clean corpus (2026-08-21):** nav chrome stripped from all 108 notes
      (0/108 leaking; cleaner fix `f7b22f4`). Root cause of the 25 stubborn
      leakers was `_BODY_START` requiring a colon after the heading — fixed by
      anchoring on the per-note `Intended for:` metadata line, with `_BODY_START`
      as a nav-guarded fallback.
- [x] **Section coverage after mapping (`rag/sections.py` aliases, `f7b22f4`):**
      of 108 — brief_hospital_course 79, discharge_diagnosis 74, discharge_medications 47,
      hpi 46, discharge_instructions 38, discharge_condition 31, physical_exam 28,
      pmh 14, discharge_disposition 14, social 7, family 6, meds_on_admission 0.
      Zero-section notes 12 → 6 (1793, 1849, 2113, 2425, 2486, 2568 — colon-less
      headings, kept as a documented outlier category; parser keeps its colon rule).
      PE sub-regions (ABDOMEN/HEENT/…) + DIET/ACTIVITY deliberately left absorbed
      so chunks stay meaningful-sized.
- [x] Meds: discharge-med count per note (deduped capitalized drug + dose);
      min 0, median 1, max 23; **19 notes ≥5 meds** (real polypharmacy) —
      histogram 0:53, 1:13, 2:11, 3:6, 4:6, 6:6, 9:4, 5:2, 10:2, 23:1, 7:1, 8:1, 13:1, 14:1.
- [x] **Feature extraction coverage vs. the 49-feature schema** (in-text, of 108):
      gender 100, medication 96, age 77, procedure 67, labs 56, race 48,
      discharge_location 33, ed_visits 31, admission_type 24, oncology 16,
      insurance 1, LOS 1, prior_admission 0. → Only gender/medication/age/
      procedure/labs are parse-anchored; insurance/prior-admissions/LOS must be
      filled (Step 2.7).
- [x] **Band fit (provisional, `band_fit.py`):** healthy-baseline fill + local
      model.bst scoring gives **79 high / 24 borderline / 5 low** of 108. Two
      honest caveats: (1) MTSamples teaching cases skew complex/high-risk under
      the MIMIC-tuned 0.12 threshold; (2) the provisional fill is a *story-blind
      lower bound* — it zeros prior admissions/LOS, so clinically complex notes
      (e.g. `1195`, 89yo, 18 meds, SNF) score artificially low. Selection must
      pair provisional band + chip support + story coherence.
- [ ] (in progress) **Selection / band fit:** pick ~24 notes spanning
      low/borderline/high maximizing chip support + coherence. Preliminary
      best-chip candidates: low → 1568, 1493, 1564, 2788, 1195; borderline →
      1566, 2789, 2791, 2792, 2760, 1148; high → 1351, 1657, 1254, 2771, 1106.
      Per-note section + chip support in `data/mtsamples/coverage.json`.

### 2.5 Step-2 detailed analysis plan (added 2026-08-21, in progress)

**Data so far (measured):** 108 notes, median ~3,690 chars (300–7,771); 2 sparse
(`1864`, `2024`); 96/108 have ≥1 whitelisted section, 12 have none. Section
coverage: `brief_hospital_course` 71, `discharge_diagnosis` 62, `hpi` 38,
`discharge_medications` 31, `discharge_instructions` 30, `physical_exam` 23,
`discharge_condition` 14, `pmh` 12, `social_history` 7, `family_history` 6,
`discharge_disposition` 1, `medications_on_admission` 0. Age/sex extractable in
82/108 and 79/108.

**Key structural findings:**
1. MTSamples headings ≠ MIMIC headings. Our chunker's `KNOWN_HEADINGS`
   allowlist is MIMIC-tuned; MTSamples uses `DISPOSITION`, `CONDITION ON
   DISCHARGE`, `MEDICATIONS`, `ADMISSION/ADMITTING DIAGNOSIS`, `FOLLOWUP`, etc.
   → this is why `discharge_disposition`=1 and `discharge_medications`=31.
2. Nav boilerplate is leaking into ~70 notes (body-start anchor doesn't fire →
   `Sample Name`, `Medical Specialty`, `Educational Disclaimer` kept).
3. Meds are often in prose, not a clean block (first counter undercounted; fix
   pending validation).

**Step-by-step plan:**
1. Fix + validate exploration tooling (accurate meds, body-cleanliness,
   duplicates); re-run and lock numbers.
2. Clean corpus: strip residual nav boilerplate, normalize endings, flag sparse/
   near-duplicates.
3. Section mapping: extend `KNOWN_HEADINGS` with MTSamples aliases (deliberate
   per-heading decisions).
4. Per-note capability score: which chips each note supports (meds / summarize /
   citations / risk).
5. Feature-extraction audit: which of the 49 features are in-text vs absent.
6. Selection / band fit: pick ~24 notes spanning low/borderline/high maximizing
   chip support + coherence.
7. Fill strategy: how absent features get filled plausibly, anchored to each
   note's story; note ↔ feature ↔ risk coherence gate.
8. Prototype 1–3 patients end-to-end (real note → parsed/filled features →
   live predict → RAG citation).
9. Write up direction; update curation doc + agenda with locked decisions.

### 3. Decide the data direction (write up, don't build)
- [ ] Lock the **hybrid** approach: notes = real MTSamples text; features = parsed
      where present + plausibly filled for the rest, anchored to each note.
- [ ] Decide whether the demo's public description becomes "real de-identified
      EHR notes" (vs. current "synthetic") and note any UI/copy changes that
      follow.
- [ ] Decide scope: replace all 24 notes, or hybrid (some real, some synthetic)?
- [ ] Update `synthetic_cohort_curation.md` with the locked direction +
      extractability table + provenance/attribution note.

### 4. Prototype one end-to-end patient (spike, not full rebuild)
- [ ] Pick 2–3 representative notes (low/borderline/high).
- [ ] Parse features from note text; fill the rest plausibly.
- [ ] Run through the real predict path (endpoint) → confirm coherent risk vs.
      note story.
- [ ] Chunk + embed + index one note into the synthetic RAG pipeline → confirm
      citations/meds/summarize chips work on real text.
- [ ] Render in the local site (fixture mode) → visual sanity check.

### 5. Decide next steps / scope the build
- [ ] If the spike is compelling: write the v3 build tasks (parser, feature-fill
      rules, cohort selection, re-ingest, re-deploy — reusing the existing cheap
      machine).
- [ ] If not: fall back to the v2 curation pass (richer synthetic notes) with the
      polypharmacy + coherence fixes already scoped.

## Locked findings so far (Step 2, 2026-08-21)

- Corpus is clean and parseable: **108/108 nav-free**, median 3,690 chars,
  96/108 with ≥1 recognised section after alias mapping.
- MTSamples → MIMIC section aliases are **committed in the shared parser**
  (`rag/sections.py`, `f7b22f4`): Disposition, Medications, Admission/Admitting/
  Secondary/Final diagnoses, Condition*on discharge, Laboratory blocks,
  procedures, bare History forms, followup forms. All 38 existing parser/chunk
  tests still pass (additive, MIMIC notes unaffected).
- **Real polypharmacy exists:** 19 notes with ≥5 discharge meds (max 23) — the
  exact texture v1 synthetic notes lacked.
- **Feature reality check:** only gender/medication/age/procedure/labs are
  in-text reliably; insurance, prior admissions, LOS, ED visits are absent →
  fill strategy is mandatory, and the fill must be coherent with each note's
  story (coherence rule).
- **Band reality check:** the corpus skews high under the MIMIC threshold
  (79/24/5 provisional). Selection should deliberately seek out the low and
  borderline story-compatible notes rather than assuming a natural 8/8/8.

## Constraints / rules (carry forward)

- **No raw MTSamples text in git** (gitignore; ship derived/processed only, with
  provenance). Same posture as MIMIC note text.
- **Real notes = honest description** ("de-identified transcription samples"),
  never labeled "synthetic".
- **Coherence rule stands:** note story ↔ feature row ↔ risk score must agree.
- Re-ingest pipeline is cheap (cached KFP, small shard) — iteration cost is low.

## Open questions for Dan

1. Download effort acceptable? (~5k pages is a few-hour crawl; 108 discharge
   summaries is fast. Start with discharge summaries only?)
2. Full replacement of the 24 notes, or keep some synthetic ones?
3. Attribution: add "sample transcriptions from MTSamples" credit on the site
   footer / README — OK?
