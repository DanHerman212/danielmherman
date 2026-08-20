# Go-Live Plan — Enterprise Clinical Copilot demo (A2UI)

_Date: 2026-08-11 · Status: OPEN · Owner: Dan_

Step-by-step plan for finishing the A2UI demo and taking it to a live E2E run,
then to a public (auth-gated) demo. Tick boxes as you go.

## Context & current state

- **Renderer decision (2026-08-11):** **A2UI wins** over the custom-DOM demo.
  The two demos are visually identical; A2UI is chosen for the stronger
  "agent composed the UI" story and is the emerging agent-UI standard.
  - The custom canvas renderer (`static/js/demo_splitpane.js` custom widgets,
    `demo/views.py: console/ask` fixtures) stays **until A2UI passes Screens
    3–4**, then is deleted (shared `static/js/demo_flow.js` is kept).
- **Per-passage footnote rendering:** keep as-is (one cited passage at a time —
  less clutter). Confirmed 2026-08-11.
- **Synthetic cohort is the final gate before public** (data privacy — real
  MIMIC-derived content must not ship publicly).
- **Nothing is committed.** The demo assets stay uncommitted/un-deployed until
  the synthetic cohort swap lands, so real captured data is never available in
  production. (User commits when ready.)
- **Fixture mode is the default** (`DEMO_FIXTURE_MODE=true` in
  `danielmherman/danielmherman/settings.py`). Live = set it `false` + point
  `DEMO_AGENT_URL` at the deployed agent.
- **Tests:** `manage.py test demo` = 37 passing (was 28; +3 chip-mapping
  regressions added 2026-08-13).

## Known code gap before live

The **custom** demo's `ask` view already has a live branch (calls
`agent_client.ask` when `DEMO_FIXTURE_MODE=false`). The **A2UI** `a2ui_ask`
view is **fixture-only**: it hard-calls `fixture_ask`, ignores `question` (no
free text), and never consumes quota. This is Phase 3 below.

---

## Phase 1 — Finish the A2UI demo (Screens 3–4) [START here tomorrow]

- [x] **Screen 3 — Trace view (A2UI):** `demo_splitpane.js` has a `traceBlock`
      but the A2UI renderer (`static/js/demo_a2ui.js`) does not. Add a trace
      renderer for the A2UI surface: list `predict_readmission(…)` /
      `rag_search(…)` args + returned payloads from `turn.toolCalls`, plus the
      R1 cross-patient-isolation note.
      → Done 2026-08-12: `TraceCard` A2UI component
      (`static/vendor/a2ui/a2ui_risk_components.js`) + `traceEnvelope` /
      traceOn handling in `demo_a2ui.js`.
- [x] Add the `#trace-toggle` button to `demo/templates/demo/a2ui_console.html`
      (currently absent → the `if (els.traceToggle)` guard disables the whole
      journey). Placement per `projects/agent-harness/docs/wireframes.md`
      Screen 3 (top-right of the canvas pane).
- [x] **Screen 4 / cross-cutting:** run `projects/agent-harness/docs/
      demo_screen_guide.md` §3–§4 against the **A2UI** page: free-text message,
      quota badge, episodic memory (switch patients and back), R8 nothing
      renders empty.
      → Also fixed `a2ui_ask` free-text path: fixture mode now returns the
      clear "use the live agent" message instead of a confusing hadm_id error.
- [x] Bump `?v=` cache-busters on any JS/CSS/template change (script tag +
      internal module imports) and update `demo/tests.py` assertions.
      → `demo_a2ui.js?v=5`, `a2ui_risk_components.js?v=3`; 28 tests pass.

**Exit criteria:** A2UI page passes every checklist item in the screen guide.
→ VERIFIED in browser 2026-08-12 (Screens 1–4).

---

## Phase 2 — Synthetic cohort swap (final data gate)

- [ ] Fabricate **discharge notes** (fiction, per patient) + **feature rows**.
- [ ] Rebuild RAG fixtures (one per chip query per patient) + predict fixtures
      (or a plausible risk generator).
- [ ] Re-seed `demo/data/demo_cohort.json`.
- [ ] Keep the UI/data contract identical — only the data source swaps.
- [ ] Verify all 3 chips + citations + trace on several patients; **no patient**
      hits the "no supporting note passage found" empty path.

**Exit criteria:** full-coverage synthetic data, same UX.

---

## Phase 3 — A2UI live path (code, before infra)

- [x] Add a `DEMO_FIXTURE_MODE=false` branch to `demo/views.py: a2ui_ask`,
      mirroring the custom `ask` view:
      `_question_for` (free text + chips) → `DemoQuota.consume/refund` →
      `agent_client.ask(question)` → compose canvas from **live** `tool_calls`
      via `compose_risk_canvas(predict, rag)`.
      → Done 2026-08-12 (shared `_tool_response` helper; `isinstance` check;
      live branch mirrors `ask` incl. burst-safe quota + refund on AgentError).
- [x] Keep the fixture branch untouched.
- [x] Add a regression test for the live branch (mock `agent_client.ask`).
      → `A2uiAskLiveTests` (6 tests: compose+quota, free text, 429, refund,
      bad input, malformed JSON). 34 tests total.

**Exit criteria:** flipping `DEMO_FIXTURE_MODE=false` runs the A2UI page against
a stubbed live agent locally.
→ VERIFIED 2026-08-12: Django with `DEMO_FIXTURE_MODE=false` +
`DEMO_AGENT_URL=http://127.0.0.1:8010` (local stub agent) — quota dropped to 9,
canvas-mode showed `agent-composed · live`, canvas composed from the stub's
tool_calls (no "fixture mode" marker).

---

## Phase 4 — Redeploy infrastructure (pay-per-use)

> **DECISION 2026-08-12 — Langfuse (live-phase only).** Yes to Langfuse, but as a
> **temporary, teardown-able** resource stood up when the live agent is running
> (same discipline as the RAG endpoint: up during active windows, down between).
> **Self-host (OSS) on GCP** to keep trace payloads in tenancy — real MIMIC-derived
> holdout ids/passages must never go to Langfuse Cloud. Langfuse Cloud is only
> acceptable with synthetic/stripped payloads. Keep a plain per-request JSONL
> trace (LangGraph events → GCS or Cloud SQL) as the durable evidence archive.
> Langfuse is the working surface for live debugging + Phase-5 scoring, not the
> archive. See /memories/repo/eval-observability.md.

- [x] **Prediction:** `python projects/mlops/scripts/deploy_cpr.py`
      → `readmission-endpoint` (CPR + TreeSHAP; image cached, path validated).
      → Deployed 2026-08-12; smoke `20924467` = **0.1314** ✓.
- [x] **RAG:** index `2371299135438454784` is kept (no re-pay) →
      `python projects/agent-harness/scripts/deploy_rag_endpoint.py`
      (idempotent; `readmission-rag-index`).
      → Deployed on `e2-standard-16`; fixed a polling bug in the script
      (get_operation → op.done()).
- [x] **Agent + MCP:** deploy both to Cloud Run (agent private, MCP over HTTP)
      per `projects/agent-harness/docs/BUILD_GUIDE.md`; confirm both tools reach
      the endpoints.
      → Already deployed (scale-to-zero); verified agent→MCP→live predict
      (`0.131398`) + `integration_test_live.py`: R1+/R1/ML all PASS.
- [x] **Django:** redeploy per `docs/GCP_DEPLOYMENT_GUIDE.md` with
      `DEMO_FIXTURE_MODE=false` + `DEMO_AGENT_URL=<deployed agent>`.
      → Pushed app code (deploy-on-push trigger, us-east1) + flipped env.
      FIX: `cohort_risk.json` was gitignored → demo page 500'd; tracked it
      (real MIMIC note passages `rag_*.json` stay excluded).

**Exit criteria:** live endpoints reachable from the deployed agent; demo
answers from live tools.
→ VERIFIED 2026-08-12 on the deployed site: `/demo/a2ui/` risk chip →
`agent-composed · live`, quota 9→8, canvas from live predict tool_calls
(19.5%, oncology_flag +0.2894…), no fixture marker. First live call ~47s
(agent+MCP cold start); later calls faster.

### Phase 4 follow-up — demo remediation (2026-08-13, commit `e60ee38`)

Fix the 3 demo issues found in live E2E (root cause: the live branch dropped
the `chip`, so every chip was sent as the risk question and the agent never
called `rag_search` for meds/summarize → no `^[n]` citations, no canvas
linkage, no source passage).

- [x] **Chip → question mapping** in the live branch of both `ask` and
      `a2ui_ask` (`_question_for` maps each chip to `fixtures.CHIPS` question +
      embeds the hadm_id). Agent now calls `rag_search` per intent → citations,
      footnote→canvas linkage, and the source card all work.
- [x] **Render agent markdown** in the chat thread: `renderAgentMarkdown` +
      `wireCitations` + `citedMarkdown` in `demo_flow.js` (safe light markdown:
      code/bold/italic, ul/ol, paragraphs) with clickable `^[n]` footnotes that
      re-render the turn's A2UI envelope SourceCard (`demo_a2ui.js onCite`).
- [x] **Consistent cache-busters** across both demos (entry modules +
      `demo_flow.js` + `demo_splitpane.css`) so a stale cache can't show one
      demo on old assets; updated the `tests.py` asset-URL assertions.
- [x] **Regression tests:** chip→question (meds + summarize), unknown-chip
      rejected before quota, cache-buster URLs. `manage.py test demo` = 37 pass.
- [ ] **Verify on the deployed site** after endpoints are re-deployed (restore
      commands in `session_2026-08-12_live_deploy.md` §4, then Phase 5).

---

## Phase 5 — Agent evaluation (faithfulness & groundedness gate)

> **DECISION 2026-08-12 — score evals in Langfuse** (self-hosted, see Phase 4):
> attach the faithfulness/groundedness rubric scores (LLM-as-judge) to traces in
> Langfuse for the fix-and-retest loop; the JSONL trace archive stays in GCP as
> the durable evidence. See /memories/repo/eval-observability.md.

> **Do not open the demo until this gate passes.** The agent eval measures only
> **faithfulness + groundedness + safety of the narrative** — it never
> re-evaluates the model (that's MLOps AUCPR). See
> `projects/agent-harness/docs/architecture.md` §Evaluation, `BUILD_GUIDE.md`
> §13, `RAG_BUILD_GUIDE.md` §12.

- [x] **Tier 1 (deterministic):** `pytest projects/agent-harness/tests/test_tier1.py`
      — tool routing, known-good value (`0.1314` for `hadm_id=20924467`),
      response schema, graceful error for an unknown id. (20 guardrail tests pass.)
- [x] **Tier 2 (local, stdio):**
      `pytest projects/agent-harness/tests/test_agent_local.py` — the agent
      calls the tool and reports the **exact** number (no answer-from-memory).
- [x] **Tier 2 (against the deployed agent):**
      `MCP_TRANSPORT=http MCP_URL=<deployed agent> pytest …/test_agent_local.py`
      — the same assertions against the live service.
- [x] **Live retrieval/validation:** `scripts/integration_test_live.py` +
      `scripts/validate_rag.py` (needs the endpoints from Phase 4).
- [x] **Golden set / rubric (faithfulness + groundedness):** sample from the
      ~1,000 holdout demo ids; score the narrative — every claim must trace to a
      tool output or a retrieved passage; no invented SHAP factors; clinically
      sensible; safe. Use the versioned rubric / LLM-as-judge where built
      (`demo_finish_plan.md` §groundedness). Full 300-trace run: **95% pass
      (285/300)**, 3 safety failures, 0 errors — reproducible (identical 08-18
      & 08-19 runs); every trace scored in Langfuse (1,854 scores).
- [x] Fix-and-retest loop until no ungrounded claims remain. (Guardrail fix
      `5991197`: dry-run 6 → 3, all 3 justified real errors the judge missed.)

**Exit criteria:** Tier 1 + Tier 2 green locally **and** against the deployed
agent; golden-set sample shows no ungrounded/invented claims.

---

## Phase 6 — Live E2E validation

> **DECISION 2026-08-14 — Observability initiative.** Implement **Langfuse self-host
> (OSS on GCP)** for Phase 6 as the live debugging surface, and use it as the chance to
> *learn* the tool (traces, tool calls, scoring). Real MIMIC-derived payloads stay in
> tenancy (self-host). Tear it down between phases. **Phase 5 runs on existing tooling +
> the JSONL trace archive** — Langfuse is pulled forward to Phase 5 only if the
> fix-and-retest loop needs the trace-scoring UI to move faster. See
> /memories/repo/eval-observability.md.

- [x] Run the full screen guide against **live** endpoints: chips, free-text,
      footnotes→passages, trace, source cards, quota countdown. (Verified live
      on the deployed site 08-19; endpoints torn down EOD after.)
- [x] Error/refund path: agent down → 502 + quota refund. (Quota-refund fix
      `6a16feb`: BFF now refunds + 502 on graceful tool-error payloads that
      previously returned 200-with-error and silently consumed a credit;
      40 tests pass incl. regression tests for predict and rag tool errors.)
- [x] Spot-check groundedness: every claim traces to a passage or feature
      (Tier 2 rubric).
- [x] **Observability (Langfuse):** stand up self-host, wire the LangGraph
      callback, attach rubric scores, learn the UI on live runs. (Self-host
      `v2.95.11` on Cloud Run; callback wired; 6 scores/trace attached for the
      full 300-trace eval; observability.danielmherman.com mapped.)

- [x] **Block B — live agent-down verify** (08-20): logged into the demo with
      endpoints down and ran the risk chip. Clean error surfaced + **quota
      refund confirmed** (Requests left unchanged after the failed run) — no
      spent credit on a failed call. Phase 6 exit criteria met.

**Exit criteria:** full journey works live; no unhandled errors.

---

## Phase 7 — Publish

> **DECISION 2026-08-12 — personas = separate issued login ids.** One account
> per persona (`dr.ortiz`, `maya.chen`, `alex.rivera`), each carrying a
> `persona` field. The shell reads the logged-in user's persona to set the
> header name/avatar and gate capabilities (trace toggle for the technical
> evaluator, episodic/Compare for Maya, etc.). Quota is already per-user
> (`DemoQuota`). No persona switcher in the fixture demo — the header persona
> is hardcoded for now; adjustments land later. See /memories/repo/personas.md.

- [ ] Auth-gate the demo (issued accounts; per-user quota).
- [ ] Synthetic-cohort only; compliance note — **no MIMIC data in the repo**,
      document access steps instead.
- [ ] Deployment-optimization cleanup pass (the explicit final step per
      `enterprise_clinical_copilot/docs/NEXT_STEPS.md`).

**Exit criteria:** public demo live behind auth with no real patient data.

---

## Reference

- Screen guide: `enterprise_clinical_copilot/projects/agent-harness/docs/
  demo_screen_guide.md`
- Wireframes: `enterprise_clinical_copilot/projects/agent-harness/docs/
  wireframes.md`
- Agent build/deploy: `enterprise_clinical_copilot/projects/agent-harness/docs/
  BUILD_GUIDE.md`
- Website deploy: `danielmherman/docs/GCP_DEPLOYMENT_GUIDE.md`
- Master roadmap: `enterprise_clinical_copilot/docs/NEXT_STEPS.md`
- Demo dev log: `/memories/repo/a2ui-spike.md`
