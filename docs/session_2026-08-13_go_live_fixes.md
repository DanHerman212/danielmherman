# Session 2026-08-13 — Go-Live Fixes & UX Polish

**Goal:** get the A2UI Enterprise Clinical Copilot demo to a polished, production-ready
state (real-first: live endpoints, real MIMIC data, no fixtures masquerading as real).

## What we achieved

1. **Demo remediation** — chips now map to real questions (`_question_for`), so the
   live branch reaches the agent and the whole chain works: citations, footnotes, canvas.
2. **Endpoints redeployed + integration test passed** — predict (readmission-cpr),
   RAG index, agent, mcp-server all live again.
3. **Fixed a stale mcp-server** that broke meds/summarize (missing `rag_search` tool).
4. **Prompt fixes** — risk chip always cites; summarize never refuses; sparse, deduped
   citations (model-level + front-end dedupe).
5. **Retrieval regression diagnosed** — broad queries return 1–2 passages due to
   embedding drift vs the index snapshot. Solution: deterministic `rag_search_sections`
   tool (one call, section coverage moved out of the model). Verified 3/3 live.
6. **Canvas linkage** — new tool's passages render as canvas SourceCards; footnote
   click → section. `_rag_response` handles both tools.
7. **UI redesign** — Copilot-chat thread chapters, pinned composer + contextual chips,
   working animations (moving border, typing dots, canvas shimmer), reduced-motion safe.
8. **Selection parity** — search/select patients stays consistent with the rail.
9. **Sticky source card** — cited discharge notes pin to the canvas bottom (A2UI shadow
   `:host` sticky + prov-before-source reorder).
10. **App-shell layout fix** — grid rows constrained (`minmax(0,1fr)`) so the rail,
    thread and canvas scroll internally and the canvas stays visible on long rails.
11. **Summary formatting fix** — agent now writes flowing prose with bold inline section
    labels (no more `1. 1. 1. 1.` headings); renderer keeps numbered lists together.
12. **Latent agent bug fixed** — `server.py` had a `SyntaxError` (never actually
    deployed); fixed, redeployed → `agent-00012-gcg` serving 100%.
13. **Verified live in production** — Sandra Guerrero discharge summary (flowing prose,
    `^[1]`/`^[2]`, canvas linked), layout geometry, all three chips.

## Known to watch (next session)
- Vertex AI `429 RESOURCE_EXHAUSTED` — transient regional quota; demo shows an honest
  "unavailable" instead of failing. Watch during bursts.
- Quota counter needs periodic reset via `/admin/demo/demoquota/` while testing.

## Commits
- Site: `e60ee38` → `c023c49` → `8adce37` → `f2a454f` → `ff10bca` → `fad4381` →
  `9e67aea` → `ca6a06c` (sticky) → `77507f8` (layout + renderer)
- Harness: `2c223cd` → `32a3423` → `128b3b1` → `b5ff777` → `732c5ad` →
  `50466bb` (summary prose) → `f567263` (server.py fix)

## Status
- 38/38 tests green · production verified · UX owner (Dan) comfortable.
- **Demo is NOT yet publicly open.** Next: Phase 5 evaluation gate.
