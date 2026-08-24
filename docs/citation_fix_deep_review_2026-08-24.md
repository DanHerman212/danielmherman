# Citation-Link Mismatch — Deep Review & Root Cause (2026-08-24)

## Symptom (as reported)
Meds chip (and some free-text turns) show a SourceCard that does not match the
citation: user clicks `^[1]` next to a medications answer and the canvas shows
the hospital course. Reported across multiple patients (Cynthia Petrov, Alan
Marchetti, Eleanor Whitfield, and "others").

## The three failed attempts (and why each was incomplete)

| Iteration | Fix | Why it missed |
|---|---|---|
| v1 | Resolve the SourceCard passage by a single section intent (`discharge_medications` for meds) | The intent-labeled passage can be absent from the returned top-k: the index stores whole-note chunks whose embeddings are near-tied, so the meds chunk does not always rank in the top 3. |
| v2 | + extract the intent section's body from any whole-note chunk | Some notes have NO medications section at all (Marchetti) — extraction found nothing. |
| v3 | Resolve to a section SET (`discharge_medications` → `discharge_instructions`) | Eleanor's note has neither section; the meds are one sentence inside the hospital course, so the card (correctly) pointed at the hospital course — but the label still read as a mismatch. |
| v4 | Snippet the meds sentence out of the hospital course | User's directive: never mine narrative. If the note has no meds-bearing section, the honest answer is "not available", not a mined sentence. |

## Root cause (evidence-based)
1. **The model's citation numbers are unreliable.** The meds answer cites
   `^[1]` while its supporting passage sits elsewhere in the returned array.
   The canvas must not map citation number → passage index.
2. **The retrieval contract hides the structure.** `rag_search_sections`
   returns chunks labeled by section, but chunks contain the whole note and
   embeddings are near-tied — the intended section's chunk is not guaranteed
   to be returned.
3. **Notes vary in shape.** The meds claim's supporting text lives in
   `discharge_medications` (Cynthia), `discharge_instructions` (Marchetti,
   Ellison), the hospital course only (Eleanor), or nowhere (Boyle expired;
   Clarence/Curtis are non-discharge notes). A single fixed mapping cannot
   cover all shapes; and "wherever it happens to appear" is not a defensible
   contract for a clinical demo.
4. **The canvas rendered a fixed "No 30-day readmission risk estimate was
   requested" heading** on every non-risk turn, wasting the space that should
   show the citation source.

## Final deterministic contract
- Resolve the SourceCard by **section intent** (a preference-ordered section
  set derived from the question wording), first by passage label, then by
  extraction from whole-note chunks.
- If the note has **none** of the targeted sections, the card shows a
  deterministic message — e.g. *"No discharge medication information is
  available for this patient."* — never content mined from unrelated
  narrative. (`empty passages` still shows the existing honest-empty card.)
- The canvas **no longer renders the large "no risk estimate" heading** on
  non-risk turns; that space goes to the citation source.
- The **agent prompt** (harness) is updated in lockstep: when neither
  `discharge_medications` nor `discharge_instructions` is returned, the agent
  answers "no discharge medication information is available" instead of
  mining the hospital course. (Site card and agent answer must agree.)

## Verification (before any push)
- 48 site unit tests pass (incl. the Eleanor unavailable-case and the
  meds-in-instructions case).
- `demo/verify_live_citations.py` runs the REAL deployed agent through the
  local ask view — **all 7 cases pass** (meds section / instructions / Boyle
  unavailable / Eleanor unavailable / Ellison instructions / two
  empty-passage notes / free-text instructions).
- Local demo reseeded with the full 108-patient cohort.

## Outstanding (after the user's local test)
- Site deploy (push to `main`).
- Agent redeploy (harness `agent/prompts.py` change; Cloud Run service) so the
  agent answer matches the unavailable card.
- Tear down the billable endpoints once UAT is confirmed.
