# Next Session Kickoff — 2026-08-17 (Mon AM) — Enterprise Clinical Copilot

_Owner: Dan. Companion to `docs/go_live_plan.md` (the tracking plan)._

## Where things stand (as of Sun 2026-08-16)

- Phase 1 (A2UI demo) ✅ · Phase 3 (A2UI live path) ✅ · Phase 4 (infra) ✅ mostly —
  **one follow-up verification pending**.
- Phase 2 (synthetic swap), Phase 5 (eval gate), Phase 6 (live E2E), Phase 7 (publish) — not started.
- ⚠️ Demo assets still **uncommitted** — nothing ships until the synthetic swap lands.

## Monday, in order

1. **Close out Phase 4 (the unchecked box).** Restore endpoints per
   `session_2026-08-12_live_deploy.md` §4, re-deploy, and verify live that the
   2026-08-13 remediation works: chip→question mapping, agent-markdown +
   `^[n]` footnotes → source cards, cache-busters. Meds/summarize chips must
   produce citations + source cards on the deployed site.

2. **Phase 5 — Agent evaluation (CRITICAL GATE: do not open the demo until green).**
   - `pytest projects/agent-harness/tests/test_tier1.py` (routing, known-good 0.1314, schema, error path)
   - `pytest …/test_agent_local.py` locally (stdio) → then against deployed agent (`MCP_TRANSPORT=http`)
   - `scripts/integration_test_live.py` + `scripts/validate_rag.py`
   - Golden-set rubric (faithfulness + groundedness, LLM-as-judge, ~1,000 holdout ids) → fix-and-retest until no ungrounded claims.

3. **Phase 6 — Live E2E validation + Langfuse self-host** (2026-08-14 decision).
   Full screen-guide run on live endpoints; error/refund path (agent down → 502 + quota refund);
   wire LangGraph callback + rubric scores into Langfuse; teardown-able, real payloads stay in tenancy.

4. **Phase 2 — Synthetic cohort swap (final data gate).** Fabricate discharge notes + feature rows;
   rebuild RAG/predict fixtures; re-seed `demo/data/demo_cohort.json`; keep UI/data contract identical;
   no patient may hit the empty "no supporting passage" path.

5. **Phase 7 — Publish.** Auth-gate with personas (`dr.ortiz` / `maya.chen` / `alex.rivera`, per-user quota);
   synthetic-only + compliance note (no MIMIC data in repo — document access steps);
   deployment-optimization cleanup pass per `enterprise_clinical_copilot/docs/NEXT_STEPS.md`.

## Reference (have open)

- `danielmherman/docs/go_live_plan.md`
- `danielmherman/docs/session_2026-08-12_live_deploy.md` §4 (restore commands)
- `enterprise_clinical_copilot/projects/agent-harness/docs/BUILD_GUIDE.md`, `RAG_BUILD_GUIDE.md`, `demo_screen_guide.md`, `wireframes.md`
- `/memories/repo/eval-observability.md` (Langfuse) · `/memories/repo/personas.md` (publish)

## Watch-outs

- Long pole = **Phase 5** (gates the demo). Phase 4 close-out is quick.
- Langfuse is live-phase only, self-hosted, teardown-able; JSONL trace archive stays in GCP as durable evidence.
- First live agent call was ~47s cold start (scale-to-zero) — factor into demo pacing.
