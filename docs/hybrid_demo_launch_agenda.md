# Hybrid Demo — Downstream Launch Agenda

_Created 2026-08-21. Owner: Dan. This is the **remaining work to ship the hybrid
demo** (real MTSamples notes + parsed/filled features + real served model).
Preceded by `mtsamples_agenda_2026-08-21.md` (Step-2 analysis) and
`synthetic_cohort_curation.md` (locked direction). Progress is tracked against
the session todo list.

## Where we are

- **Built & committed:** hybrid cohort artifact (`eval/results/hybrid_cohort.json`,
  24 patients, 8/8/8 bands, hadm_ids `90000001`–`90000024`), loaded to
  `readmission.hybrid_notes` / `hybrid_split` / `hybrid_features` (24 rows each).
- **RAG index built:** `rag-tree-ah-20260821170717` (**163 vectors**, small shard),
  from the hybrid notes via pipeline run `rag-ingest-20260821130155`.
- **RAG endpoint deploy:** in progress (`deploy_synthetic_rag.py` → endpoint
  `readmission-rag-index`, machine `e2-standard-2`).
- **Predict endpoint:** torn down (must be re-deployed).
- **Site / fixtures / agent:** still pointed at the synthetic cohort.

## Action items (in dependency order)

### A. Endpoints live
- [ ] **A1 — Finish RAG endpoint deploy.** Confirm the LRO completed; verify
      `readmission-rag-index` serves `rag-tree-ah-20260821170717`. Use
      `scripts/wait_rag_deploy.py` / `verify_rag_query.py`. (Run manually — the
      chain script has a cwd bug with relative paths.)
- [ ] **A2 — Deploy the predict endpoint.** `projects/mlops/scripts/deploy_cpr.py`
      (CPR image; points at the newest `readmission-final-*` bundle). Confirm the
      endpoint resolves and returns a prediction for a hybrid hadm_id.

### B. Re-point the deployed agent (mcp-server, Cloud Run)
- [ ] **B1 — Set env to hybrid tables** (single `--set-env-vars "^@^…"`):
      - `FEATURE_TABLE=readmission.hybrid_features`
      - `DISCHARGE_TABLE=readmission.hybrid_notes`
      (Other vars `FEATURE_SOURCE=bigquery`, `ENDPOINT_NAME`, `LOCATION`,
      `PROJECT_ID` stay as-is.)
- [ ] **B2 — Confirm the agent tools answer for hybrid patients** via
      `scripts/verify_mcp_live.py` (predict + rag_search on e.g. `90000017`).

### C. Fixtures + site data (offline-render parity with live)
- [ ] **C1 — Predict fixtures** for the hybrid cohort (a `build_hybrid_fixtures.py`
      twin of `build_synthetic_fixtures.py`, using the serving predictor on
      `hybrid_cohort.json` features).
- [ ] **C2 — RAG fixtures** (twin of `capture_synthetic_rag_fixtures.py`,
      pointing `DISCHARGE_TABLE` at `hybrid_notes`; capture passage scores for
      the primary + a few patients).
- [ ] **C3 — Seed the site cohort** (twin of `seed_synthetic_demo_cohort.py` →
      `demo_cohort.json`; deterministic names/summaries from hybrid features) and
      re-seed the DB: `manage.py seed_demo_patients --prune`.

### D. Live verification
- [ ] **D1 — Integration test** (`scripts/integration_test_live.py` with hybrid
      overrides): R1+/R1/ML all green.
- [ ] **D2 — Drive all chips + citations + trace** on several patients: risk,
      summarize, meds (real polypharmacy), citations from real note sections;
      **no empty-path patients**.
- [ ] **D3 — Render in local site (fixture mode)** → visual sanity check of a
      low/borderline/high patient card against its real note.

### E. Eval + compliance + QA
- [ ] **E1 — Eval re-validation** on hybrid (regression → full golden) to confirm
      agent behavior gates still hold on real-note text.
- [ ] **E2 — Compliance sign-off.** Re-confirm no real MIMIC ships; update the
      compliance note to describe the hybrid data (de-identified transcription
      samples + parsed/filled features).
- [ ] **E3 — Attribution/editorial.** Add MTSamples credit (footer / README /
      about) + download date; public copy says "de-identified transcription
      samples", never "synthetic".
- [ ] **E4 — QA walkthrough by Dan** → sign off hybrid as the public-facing data.

### F. Cleanup / open decisions
- [ ] **F1 — Old synthetic index/endpoint.** After hybrid is validated, tear down
      or keep `rag-tree-ah-20260820213455` (synthetic) as a fallback; decide the
      fate of `synthetic_*` tables.
- [ ] **F2 — race_unknown card artifact.** Decide: prefer race-parsed notes in the
      final 24, and/or suppress filled-only race from displayed `top_factors`.

## Notes / gotchas

- **KFP cache:** after any `rag/` or `pipelines/components/` edit, rebuild the
  image **and pin a fresh tag** (`RAG_IMAGE_URI=...:b<buildid>`). The `:latest`
  tag does not invalidate KFP step caching → stale parser output silently
  reused (this bit us twice on the hybrid ingest).
- **mcp-server env:** use `--update-env-vars` on an existing service (it carries
  several vars); never repeat `--set-env-vars` flags.
- **Raw text posture:** `hybrid_notes.json` (real note text) is gitignored; only
  the features artifact is tracked.
