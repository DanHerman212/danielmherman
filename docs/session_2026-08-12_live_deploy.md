# Session 2026-08-12 — Live deploy, issues found, remediation (handoff)

_Owner: Dan · Handoff · **Remediation APPLIED 2026-08-13** (commit `e60ee38`, build in flight) · Next: re-deploy endpoints, verify live, then Phase 5 (agent eval gate)._

---

## 1. What was achieved today

- **Phase 1 (A2UI Screens 3–4) — done & verified.** Trace view (`TraceCard` A2UI component +
  `traceEnvelope`), `#trace-toggle` on `a2ui_console.html`, free-text fixture message fix,
  cache-busters bumped. 34 tests pass (`manage.py test demo`).
- **README** — added the Google Cloud Platform deployment Mermaid diagram (nested subgraphs)
  and updated top/bottom text.
- **Phase 3 (A2UI live path, code)** — `demo/views.py a2ui_ask` now mirrors the custom `ask`
  view: fixture guard, `_question_for`, burst-safe `DemoQuota.consume`/`refund`, live
  `ask_agent(question)`, canvas composed from live `tool_calls`. Regression tests added
  (`A2uiAskLiveTests`). Verified locally against a stub agent.
- **Phase 4 (live infra deployed + verified on real data):**
  - **Predict endpoint** `readmission-endpoint` (CPR + TreeSHAP, `n1-standard-2`) — smoke
    `20924467` = **0.1314**.
  - **RAG index endpoint** `readmission-rag-index` (`e2-standard-16`) on the kept index
    `2371299135438454784`. Fixed a polling bug in `deploy_rag_endpoint.py`
    (`get_operation(name=…)` → `op.done()`).
  - **Agent → MCP → live predict** verified (`0.131398`); `integration_test_live.py`:
    **R1+ / R1 / ML all PASS** (real retrieval + cross-patient isolation + prediction).
  - **Django** — app code pushed (`deploy-on-push` trigger is **regional `us-east1`**);
    `DEMO_FIXTURE_MODE=false` set. Live E2E on the deployed site: `/demo/a2ui/` risk chip →
    `agent-composed · live`, quota 9→8, canvas from live predict `tool_calls`.
- Committed + pushed the demo app code. Git/Docker ignore now excludes the **real MIMIC note
  passages** (`demo/data/demo_fixtures/rag_*.json`) + spikes; `cohort_risk.json` (real
  inference output) is tracked; internal docs (`go_live_plan.md`, `deployment_strategy.md`)
  kept local.

---

## 2. Problems with the last deployment

### 2a. 500 on `/demo/a2ui/` (fixed, root-caused)
- **Cause:** `demo/data/demo_fixtures/cohort_risk.json` was gitignored (privacy safety) →
  absent from the Cloud Build source → absent from the image → the patient-rail views
  (`risk_for()` → `json.loads(...cohort_risk.json)`) threw `FileNotFoundError` on every page
  render.
- **Fix:** tracked `cohort_risk.json` (real inference output only — no note text; hadm_ids
  already in the committed `demo_cohort.json`). Real note passages stay excluded.
  Redeployed; verified the page loads.

### 2b. Demo issues (user-reported; root-caused; **FIXED 2026-08-13** — commit `e60ee38`)
1. **LLM messages not formatted; no footnote links.**
2. **Context canvas not linked to the LLM output.**
3. **Discharge-note source "not found."**

**Root cause (single bug):** the live branch drops the `chip`. `demo/views.py _question_for`
ignores `chip` — whenever `hadm_id` is present it always returns
`"Assess the 30-day readmission risk for admission {hadm_id}."` So every chip click
(meds / summarize / risk) is sent to the live agent as the **risk** question. The agent
therefore never calls `rag_search` for note questions, so its answers contain **no `^[n]`
citations** and no passages. Consequences:
- No `^[n]` → the chat footnote renderer has nothing to link (issue 1, "no footnote links").
- No citations/passages → the footnote→canvas `onCite` path has nothing to hook; the canvas
  always shows the risk widget (issue 2).
- No `rag_search` → the Source card honestly reports "No supporting note passage was found"
  (issue 3). The RAG endpoint itself was verified live (R1+ retrieved passages for this
  patient) — the agent just never reaches it.

**Secondary issue:** the agent's answers contain markdown (`* **oncology_flag**…`), and the
chat renders agent text as **plain text** — so the raw asterisks/bold show through
(issue 1, "not formatted properly").

---

## 3. Recommended remediation (next session — in order)

1. **Fix chip → question mapping (root cause).** In the live branch (both `ask` and
   `a2ui_ask`), when `chip` is present, translate it to the chip's question
   (`fixtures.CHIPS`, e.g. `What medications was this patient discharged on?`) instead of
   always the risk question. The agent will then call `rag_search` for meds/summarize and
   emit `^[n]` citations → footnotes, canvas linkage, and the source card all work.
   Add a regression test (mock `ask_agent`, assert the question passed per chip).
   → **DONE 2026-08-13** (`_question_for` maps chips; tests
   `test_chip_maps_to_chip_question`, `test_summarize_chip_maps_to_summarize_question`,
   `test_unknown_chip_rejected_before_quota`).
2. **Render agent markdown in the chat thread** (or constrain the agent to plain prose) so
   answers aren't raw `* **…**`. (Either render markdown in `turnBlock`/`citedParagraph`, or
   trim markdown from the agent output.)
   → **DONE 2026-08-13** (`renderAgentMarkdown`/`wireCitations`/`citedMarkdown` in
   `demo_flow.js`; verified locally in both demos + against a live stub: bold, ul/ol,
   clickable `^[n]` → re-renders the turn's canvas SourceCard).
3. **Interim demo posture:** the service is currently `DEMO_FIXTURE_MODE=false`. With the
   endpoints torn down, live asks will error (502) until re-deployed. Decide on resume
   whether to flip to fixture (note: the deployed image lacks `rag_*.json`, so fixture mode
   is degraded there) or keep live-only during active windows. Recommend: keep the env live
   and re-deploy endpoints only for active windows (matches the cost discipline).
4. **(Undecided, do not build without confirmation)** Live-computed patient-rail risk dots
   (`DemoRisk` in Cloud SQL, seeded by calling the live predict endpoint) — the "real-first"
   upgrade for the dots; dovetails with the Phase-7 synthetic cohort.
5. Then **Phase 5 — Agent evaluation gate** (Tier 1 + Tier 2 local/live, live retrieval
   validation, golden-set faithfulness/groundedness rubric) before the demo opens.

---

## 4. Infra state at close (2026-08-12 EOD)

**Torn down (billable, ~$0 now):**
- Predict endpoint `readmission-endpoint` — deleted.
- RAG index endpoint `readmission-rag-index` — deleted (index `2371299135438454784` kept; no re-pay).
- Model registry, GCS bundles, BigQuery tables, Artifact Registry images — kept (storage pennies).

**Still up (scale-to-zero, ~$0 idle):**
- Cloud Run `agent`, `mcp-server`, `danielmherman` (production website). `DEMO_FIXTURE_MODE=false`
  remains set — live asks will error until endpoints are re-deployed.

**Restore live with (idempotent):**
- `.venv/bin/python projects/mlops/scripts/deploy_cpr.py` → predict endpoint.
- `.venv/bin/python projects/agent-harness/scripts/deploy_rag_endpoint.py` → RAG endpoint.

---

## 5. Key decisions recorded this session
- Personas = separate issued login ids per persona (Phase 7). `/memories/repo/personas.md`.
- Langfuse: live-phase only, self-hosted on GCP, teardown-able; JSONL trace archive stays in
  GCP. `/memories/repo/eval-observability.md`.
- Real-first sequencing: live on REAL data (Phases 3–6), synthetic only for the public
  surface (Phase 7); keep the real model, build a synthetic RAG index for public.
- User philosophy (no fixtures presented as real; real enterprise app). `/memories/user-philosophy.md`.
