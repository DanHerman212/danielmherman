# Session 2026-08-17 — Phase 4 close-out + Phase 5 golden re-run (handoff)

_Owner: Dan · Status: Phase 4 DONE; Phase 5 re-run DONE (88.6% → 92.7%), safety criterion NOT yet green · Companion to `go_live_plan.md` + `session_2026-08-17_next_session.md`._

## What happened today, in order

1. **Restored endpoints (cost gate approved)** — prediction (`deploy_cpr.py`) + RAG index
   (`deploy_rag_endpoint.py`, new endpoint `indexEndpoints/4775975045849677824`; index
   `2371299135438454784` kept). RAG deploy took ~31 min (slow provisioning, not hung).
2. **Live validation green** — `integration_test_live.py` (R1+/R1/ML PASS) +
   `validate_rag.py` (r1/r1_positive/sanity PASS). Endpoints resolve by display name, so
   no config change needed for the fresh endpoint IDs.
3. **Tier 1 + Tier 2 green** — `test_tier1.py` 4 pass; `test_agent_local.py` 6 pass
   (stdio) + 6 pass against deployed mcp-server (HTTP).
4. **Phase 4 UI verification (live demo, Dr. Lena Ortiz)** — risk/summarize/meds chips →
   question mapping, `^[n]` citations, source cards, `___` redaction preserved. Found and
   fixed **two real bugs** (below).
5. **Cache-buster check** — deployed site serves `demo_splitpane.css?v=6`, `demo_a2ui.js?v=6`,
   `style.css?v=11`; matches source. Working tree clean (except untracked session docs).
   → **Phase 4 CLOSED.**
6. **Agent rebuilt + redeployed** (revision `agent-00015-j59`) with P4 guardrails + hardened
   prompt (guardrails were committed `672ee9e` but never in the running image until now).
   Verified via Tier 2 (6 pass). mcp-server was already on the fixed revision
   (`mcp-server-00006-mhk`).
7. **Golden 300-trace collect + re-judge** → results below.

## Bug 1 — Meds retrieval gap (root-caused, not guessed)

- **Symptom:** meds chip on Alan Duval (hadm `23613002`) → "No supporting passage was found
  for discharge medications" (no citation/source card). Worked on Leonard Castellano
  (`20724182`). Phase 4 blocker.
- **Root cause (validated):** the free-text query `"discharge medications"` **embeds far
  from Duval's meds chunks** (query-side embedding drift). The chunks ARE indexed (self-retrieval
  of the chunk text returns all 4, filtered to his hadm), but the query returns 0 even at
  `top_k=20` — the query's vector lands near `medications_on_admission`/`discharge_instructions`
  chunks instead. Cosine sim query→chunk: Duval 0.591 vs Castellano 0.635. Patient-dependent
  geometry. `rag_search_sections` ALSO missed Duval's meds because it used short phrases internally.
  Not a data gap, not a safety failure (agent correctly declined to fabricate).
- **Fix (all inside RAG, no bypass, no new MCP tool):** `mcp_server/tools/rag_search.py`
  - `rag_search_sections`: anchor each section query to the section's ACTUAL body text
    (fetch note from BigQuery, parse via `rag/sections.parse_note`) instead of short phrases.
  - `rag_search`: `_section_for_query()` fallback — if a section-targeting query returns 0,
    retry with that section's text as the query (same index + hadm restrict).
  - mcp-server image now ships `rag/` (pure stdlib: `re`, `dataclasses`). Dockerfile build
    context changed from `mcp_server/` to harness root; new `cloudbuild.mcp.yaml`
    (`-f mcp_server/Dockerfile`).
  - Committed `e84691f` (with 3 regression tests).

## Bug 2 — Source-card title showed the whole passage (regression from Bug 1 fix)

- **Symptom:** canvas SourceCard title became `Source · <ENTIRE SECTION BODY>`.
- **Root cause:** the section-anchored fallback re-queried with the section body, and the
  inner `_search` returned `"query": body` — the UI renders `Source · ${turn.query}`.
- **Fix:** fallback keeps the caller's original query in the response:
  `return {**res, "query": query}`. Embed still uses the body; only reported `query` reverts.
  Regression test asserts `result["query"] == "discharge medications"`.
  Redeployed mcp-server (revision `mcp-server-00006-mhk`). Verified live on Duval + Castellano.

## ⚠️ Tooling lesson — silent stale-judge trap

- First judge run reported "88.6% / 16 safety failures" — **INVALID**. `judged.jsonl` from
  the Aug-14 baseline was still on disk (gitignored, not deleted), and `judge.py` resumes by
  skipping already-judged `(hadm, prompt)` pairs. Log said **"Resuming: 300 already judged,
  0 to go"** — it reused baseline judgments, judged nothing new, and echoed the old baseline.
- **Fix:** `mv judged.jsonl judged_baseline_aug14.jsonl`, re-ran judge → "0 already judged,
  300 to go". **Always check the "Resuming: N already judged" line before trusting a delta.**
  A gitignored-but-present result file is a silent-stale-data hazard.

## 📊 Phase 5 golden re-run — VALID results (fixed agent, Aug-17)

Rows=300, scored=300, agent_errors=0. Re-judged from scratch (0 reused).

| Metric | Baseline (Aug-14) | **Re-run (Aug-17)** | Delta |
|---|---|---|---|
| Overall pass rate | 88.6% (265/299) | **92.7% (278/300)** | **+4.1 pts** |
| Safety failures | 16 | **16** | 0 (unchanged) |
| risk | 89/99 | **98/100** | +9 |
| meds | 92/99 | **94/100** | +2 |
| summarize | 84/99 | **86/100** | +2 |
| faithfulness | 91% | 93% | +2 |
| groundedness | 90% | 94% | +4 |
| citation | 96% | 97% | +1 |
| clinical | 96% | 98% | +2 |
| safety | 95% | 95% | 0 |

**Interpretation:** real improvement (+4.1 pts), driven mostly by risk (+9) — the prompt
hardening + guardrails working on the assessment path. Meds/summarize +2 each (meds retrieval
fix helps). **Safety failures stayed at 16** — the guardrails convert silent failures into
corrected/flagged outputs (faithfulness/groundedness up), but the judge still counts 16 safety
failures. The remaining flags are now a NARROWER, more specific class — **med-detail fidelity**
(e.g. Oxycodone dose omitted, Levofloxacin 7 vs 6 days, incomplete discharge-meds list,
Acetaminophen 1000 vs 500 mg) — not the baseline's invented-age/fabrication class.

## Gate status (Phase 5)

- **Improvement proven: YES** (88.6% → 92.7%).
- **Safety criterion: NOT YET GREEN** — 16 safety failures > 0, and the plan's ship gates
  (invented-med count = 0, wrong-citation count = 0, safety pass ≥ 95%) not all met.
- **Remaining work:** the 16 safety failures are med-fidelity gaps — the token-level
  dose/freq guardrail is global (catches a dose absent everywhere, but not
  "Simvastatin should be DAILY, not BID" when another med in the note is BID — the known
  P4 limitation). Next step is to attack the med-fidelity class (per-med verification or
  stricter meds-summary prompting), then re-run the 300.

## Infra / deploy record

- Prediction endpoint: `endpoints/7673546625830092800` (model `readmission-cpr-20260817151122`).
- RAG index endpoint: `indexEndpoints/4775975045849677824`.
- mcp-server: revision `mcp-server-00006-mhk` (both fixes live).
- agent: revision `agent-00015-j59` (P4 guardrails + hardened prompt live).
- Commits: `e84691f` (meds fix + source-card fix + tests). Baseline judged preserved as
  `judged_baseline_aug14.jsonl`.
- Eval artifacts now gitignored (durable trace archive is GCP). Files remain on disk:
  `traces.jsonl` (Aug-17), `judged.jsonl` (Aug-17), `golden_report.json` (Aug-17),
  `collect_p5.log`, `judge_p5.log`.

## Reference
- `go_live_plan.md` · `session_2026-08-17_next_session.md` · `session_2026-08-12_live_deploy.md`
- `/memories/repo/meds-retrieval-fix.md` (root cause + fix detail)
