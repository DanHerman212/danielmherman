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
- [ ] Inventory: how many usable discharge summaries vs. poor/empty/duplicate?
- [ ] Section coverage: do notes parse into our chunker's sections (chief
      complaint, HPI, PMH, hospital course, discharge meds, discharge
      instructions, disposition, diagnosis)?
- [ ] Meds: extract discharge-med list + count per note; confirm real polypharmacy
      range (how many notes have 5–8+ meds?).
- [ ] Feature extraction coverage against the 49-feature schema (age, sex, LOS,
      med count, procedure, discharge location = good; labs/admission type/
      insurance = absent → confirm the fill strategy).
- [ ] Band fit: can we find ~24 notes that match our low/borderline/high
      archetypes (CHF, COPD, oncology, post-op, cellulitis, routine)?

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
