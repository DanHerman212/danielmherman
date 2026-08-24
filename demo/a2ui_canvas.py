"""Compose the A2UI risk canvas (fixture-mode spike).

Mirrors the harness `agent/a2ui.py` contract (surface_id, audience, messages,
fallback_text) but composes the *full assessment canvas* using the custom A2UI
components registered in static/vendor/a2ui/a2ui_risk_components.js:

  - RiskBar     — big number + progress bar + threshold marker
  - FactorBars  — horizontal SHAP bars (sign -> direction, magnitude -> length)

The surface's `catalogId` must equal the combined catalog id the front-end
registers, so one surface can use basic AND custom components together.

The composition lives server-side (exactly where the agent would compose it),
so this is the message list the agent would emit for this payload — the
"agent composed the UI" story, rendered in fixture mode.
"""

import re

CATALOG_ID = "https://example.com/catalogs/readmission-risk-v1.json"
SURFACE_ID = "risk-canvas"
A2UI_VERSION = "v0.9"
AUDIENCE = ["user"]

# Section header aliases per canonical section — mirrors the harness
# `rag/sections.py KNOWN_HEADINGS` (MTSamples discharge summaries use these
# variants, e.g. "Hospital Course:", "Discharge Diagnoses:", "Medications:").
# Extraction uses these BOTH to locate a section's start and to bound its end
# (the next known header), so a citation click shows the cited section's body
# instead of the whole note.
_SECTION_ALIASES: dict[str, tuple[str, ...]] = {
    "chief_complaint": ("Chief Complaint", "Reason for Admission"),
    "major_procedure": (
        "Major Surgical or Invasive Procedure",
        "Major Surgical or Invasive Procedures",
        "Procedure", "Procedures", "Procedures Performed",
        "Operations Performed", "Principal Procedure", "Principal Procedures",
        "Procedure Performed During This Hospitalization",
        "Procedures During This Hospitalization",
        "Procedures During Hospitalization", "Operations and Procedures",
    ),
    "history_of_present_illness": (
        "History of Present Illness", "HPI", "History", "History of Illness",
        "Brief History", "Brief History of Present Illness", "Current History",
    ),
    "review_of_systems": ("Review of Systems", "ROS"),
    "past_medical_history": (
        "Past Medical History", "PMH", "Past History",
        "Past Medical/Family/Social History", "Past Medical, Family, Social History",
    ),
    "past_surgical_history": ("Past Surgical History", "Surgical History"),
    "social_history": ("Social History",),
    "family_history": ("Family History",),
    "physical_exam": (
        "Physical Exam", "Physical Examination", "Admission Exam",
        "Admission Physical Exam", "Discharge Exam", "Discharge Physical Exam",
        "Discharge Physical Examination",
        "Physical Examination at the Time of Discharge",
        "Physical Examination on Discharge",
    ),
    "pertinent_results": (
        "Pertinent Results", "Pertinent Labs", "Laboratory Data",
        "Laboratory Studies", "Laboratory", "Pertinent Laboratories",
        "Discharge Labs", "Laboratories on Admission",
        "Significant Labs and X-Rays", "Additional Laboratory Studies",
    ),
    "brief_hospital_course": (
        "Brief Hospital Course", "Hospital Course", "Course in the Hospital",
        "History and Hospital Course", "Brief Hospital Course Summary",
        "Brief Summary of Hospital Course",
    ),
    "medications_on_admission": ("Medications on Admission",),
    "discharge_medications": (
        "Discharge Medications", "Medications", "Medications on Discharge",
        "Home Medications", "New Medications", "Current Medications",
        "Medications and Advice on Discharge", "Discharge Medications/Instructions",
    ),
    "discharge_disposition": ("Discharge Disposition", "Disposition"),
    "discharge_diagnosis": (
        "Discharge Diagnosis", "Discharge Diagnoses",
        "Admission Diagnosis", "Admission Diagnoses", "Admitting Diagnosis",
        "Admitting Diagnoses", "Secondary Diagnosis", "Secondary Diagnoses",
        "Diagnoses on Admission", "Diagnoses on Discharge", "Primary Diagnoses",
        "Final Diagnosis", "Final Diagnoses",
    ),
    "discharge_condition": (
        "Discharge Condition", "Condition", "Condition on Discharge",
        "Conditions on Discharge", "Condition Upon Discharge", "Condition at Discharge",
        "Condition of Patient on Discharge", "Condition of the Patient at Discharge",
    ),
    "discharge_instructions": (
        "Discharge Instructions", "Discharge Plan", "Additional Instructions",
        "Special Instructions", "Instructions to Patient", "Discharge Diet",
        "Discharge Activities", "Physical Activity",
        # MTSamples 2788-style long-form instructions header (the demo
        # extracts it directly; the harness alias list is the source of truth
        # for chunking and may adopt it too).
        "Instructions Given to the Patient at the Time of Discharge",
    ),
    "followup_instructions": (
        "Followup Instructions", "Follow-up Instructions", "Followup",
        "Follow Up", "Follow-Up", "Followup Appointments",
        "Instructions for Followup",
    ),
    "facility": ("Facility",),
}

# Every known header, flattened — bounds the end of an extracted section.
_ALL_HEADERS = tuple(h for aliases in _SECTION_ALIASES.values() for h in aliases)


def _band(probability: float, threshold: float) -> str:
    """low = below threshold · borderline = threshold to threshold + 0.08."""
    if probability < threshold:
        return "low"
    if probability < threshold + 0.08:
        return "borderline"
    return "high"


def _extract_section(note_text: str, section: str) -> str | None:
    """Extract a named section's body from a full note (mirrors the client).

    Alias-aware: matches the section's MTSamples header variants (e.g.
    "Hospital Course:" for brief_hospital_course), then bounds the body at the
    next known header. Returns None only when the section is genuinely absent.
    """
    if not note_text:
        return None
    aliases = _SECTION_ALIASES.get(section) or (str(section or "").replace("_", " "),)
    if not aliases[0]:
        return None
    # Locate the section start via the first alias that appears in the note.
    start = None
    matched = None
    for alias in aliases:
        m = re.search(rf"\b{re.escape(alias)}\b\s*:", note_text, re.IGNORECASE)
        if m:
            start = m.start()
            matched = m.group(0)
            break
    if start is None or matched is None:
        return None
    # Bound the end at the next known header after the section title.
    end = len(note_text)
    for header in _ALL_HEADERS:
        hm = re.search(
            rf"\n\s*{re.escape(header)}\s*:",
            note_text[start + len(matched):],
            re.IGNORECASE,
        )
        if hm:
            candidate = start + len(matched) + hm.start()
            if candidate < end:
                end = candidate
    return note_text[start:end].strip()


def _usable_estimate(predict) -> dict | None:
    """Return predict only when it carries a real estimate (numeric probability
    + threshold). A predict tool that failed (endpoint down, bad payload)
    returns a dict *without* those keys — treat it as "no estimate", never as a
    risk score. This is what keeps the canvas composer from 500ing on a failed
    tool call.
    """
    if not isinstance(predict, dict):
        return None
    try:
        float(predict["probability"])
        float(predict["threshold"])
    except (KeyError, TypeError, ValueError):
        return None
    return predict


def first_citation(answer: str) -> int:
    """The first citation number in the answer prose (^[n]), or 1 if none.

    The canvas's SourceCard mirrors the agent's own citation: whichever passage
    the answer cites first is the one the canvas shows. The agent numbers
    passages in the order the tool returned them, so this keeps the composed
    canvas aligned with the prose even when the first cited section isn't the
    first passage (e.g. a meds answer that cites the discharge_medications
    passage, which is ^[3] in rag_search_sections order).
    """
    m = re.search(r"\^\[(\d+)", answer or "")
    return int(m.group(1)) if m else 1


# Words that a meds answer capitalizes but that are not medication names.
_MED_STOPWORDS = {
    "the", "for", "and", "with", "was", "were", "she", "he", "her",
    "his", "their", "patient", "admission", "discharged", "following",
    "medication", "medications", "discharge", "daily", "tablets", "capsules",
}


def _answer_med_tokens(answer: str) -> set[str]:
    """Capitalized words the answer introduces as medication names.

    Pulled from markdown list items ("- Vicodin 5 mg ...") and from the prose
    after the "following medications" phrase. Used only to locate the note
    sentence(s) that actually name them — never to alter the answer.
    """
    if not answer:
        return set()
    tokens = set()
    for m in re.findall(r"^\s*[-*•]?\s*([A-Z][a-zA-Z\-]{3,})", answer, re.M):
        tokens.add(m.lower())
    marker = re.search(r"medications?\s*[:,\-]", answer, re.IGNORECASE)
    tail = answer[marker.end():] if marker else answer
    for m in re.findall(r"\b([A-Z][a-zA-Z\-]{3,})\b", tail):
        if m.lower() not in _MED_STOPWORDS:
            tokens.add(m.lower())
    return {t for t in tokens if t not in _MED_STOPWORDS}


def _med_snippet(text: str, answer: str) -> str | None:
    """The sentence(s) in `text` that name the answer's medications, or None.

    Some notes have no medications (or instructions) section at all — the meds
    are one sentence inside the hospital course (hadm 90000035: "She was given
    prescription for Vicodin for pain and Synthroid thyroid hormone"). Showing
    the whole hospital course then reads as a citation mismatch even though the
    passage really contains the claim. Snippet down to the sentence(s) that
    name the meds so the SourceCard visibly supports the claim.
    """
    tokens = _answer_med_tokens(answer)
    if not tokens or not text:
        return None
    sentences = re.split(r"(?<=[.!?])\s+", text)
    hits = [s for s in sentences if any(t in s.lower() for t in tokens)]
    if not hits:
        return None
    return " ".join(hits).strip()


_MEDS_INTENT_SECTIONS = {"discharge_medications", "discharge_instructions"}


# Discharge-note sections a question can target, in preference order, with the
# words that reveal the intent. A question maps to a SECTION SET because the
# content can live in different sections across MTSamples notes: the meds
# claim's supporting text is usually discharge_medications, but many notes
# carry it in discharge_instructions instead (verified: hadm 90000005 has no
# medications section — "discharged on his usual Valium 10-20 mg..." is in
# DISCHARGE INSTRUCTIONS). Resolving by section (not the model's ^[n]
# numbers) is what keeps the canvas honest.
_INTENT_SECTIONS: tuple[tuple[tuple[str, ...], tuple[str, ...]], ...] = (
    (("discharge_medications", "discharge_instructions"),
     ("medication", "medications", "meds", "discharged on")),
    (("discharge_instructions",),
     ("instruction", "instructions")),
    (("discharge_diagnosis",),
     ("diagnosis", "diagnoses")),
    (("brief_hospital_course",),
     ("hospital course", "admission course")),
)


def intent_sections(question: str | None) -> tuple[str, ...]:
    """The discharge-note sections a question clearly targets, in preference
    order — or an empty tuple when the question has no single-section intent.

    Mirrors the harness `_section_for_query` keyword map so the demo's fixed
    chips and section-targeted free text resolve to the right passage even
    when the agent's own citation numbers are wrong. Summarize/risk questions
    map to () — their citation-by-number behavior is left untouched.
    """
    if not question:
        return ()
    q = question.lower()
    for sections, needles in _INTENT_SECTIONS:
        if any(n in q for n in needles):
            return sections
    return ()


def compose_risk_canvas(predict: dict | None, rag: dict | None,
                        cite: int = 1, sections: tuple[str, ...] = (),
                        answer: str | None = None) -> dict:
    """Turn one predict (+ rag) payload into the A2UI risk-canvas envelope.

    predict is None when the question did not request a readmission estimate
    (e.g. a medication or summarize question), or an unusable dict when the
    predict tool errored — the canvas then answers with a plain honest note
    plus the cited source instead of a risk score, so the agent never 500s on
    a non-risk or failed-risk turn.
    """
    components: list[dict] = [
        {"id": "root", "component": "Card", "child": "body"},
        {"id": "body", "component": "Column", "children": []},
    ]
    children = components[1]["children"]

    estimate = _usable_estimate(predict)
    if predict is not None and estimate is None:
        # The predict tool ran but returned no usable estimate (e.g. the
        # serving endpoint was unreachable). Honest note — never a 500, never
        # a made-up number.
        children += ["note"]
        components.append({"id": "note", "component": "Text",
                           "text": "The readmission-risk service did not return "
                                   "a usable estimate for this question.",
                           "variant": "h2"})
        fallback = ("The readmission-risk service did not return a usable "
                    "estimate for this question.")
    elif estimate is None:
        children += ["note"]
        components.append({"id": "note", "component": "Text",
                           "text": "No 30-day readmission risk estimate was "
                                   "requested for this question.",
                           "variant": "h2"})
        fallback = "No 30-day readmission risk estimate was requested for this question."
    else:
        probability = float(estimate["probability"])
        threshold = float(estimate["threshold"])
        band = _band(probability, threshold)
        factors = estimate.get("top_factors") or []

        # Each widget is a self-contained custom component whose chrome (card,
        # widget title, band pill, SHAP bars, cited source) mirrors the custom
        # demo.
        children += ["risk", "factors"]
        components.append({"id": "risk", "component": "RiskBar",
                           "probability": probability, "threshold": threshold,
                           "band": band})
        components.append({"id": "factors", "component": "FactorBars",
                           "factors": factors})

        fallback = (
            f"Admission {estimate.get('hadm_id')}: {probability:.1%} 30-day readmission "
            f"probability ({probability:.4f}), {band} at a {threshold:.2f} threshold."
        )

    # Provenance caption. For a risk estimate it names the model + feature
    # source (the two facts a reviewer checks). For a non-risk question there
    # is no estimate, so we say so plainly instead of rendering bare dashes
    # that read as a rendering bug.
    if estimate:
        model = estimate.get('model_version', 'unknown')
        feature_source = estimate.get('feature_source', 'unknown')
        prov_text = f"Model {model} · features from {feature_source} · A2UI canvas"
    else:
        prov_text = "No model — no readmission estimate was requested for this question."
    children.append("prov")
    components.append({"id": "prov", "component": "Text",
                       "text": prov_text,
                       "variant": "caption"})

    # Cited source — the passage the answer cites first (mirrors the custom
    # demo). Kept as the LAST child so it can pin to the bottom of the canvas
    # (sticky) and the discharge notes stay in view however long the session
    # gets.
    passages = (rag or {}).get("passages") or []
    query = (rag or {}).get("query") or "discharge note"
    children.append("source")
    if passages:
        # Deterministic resolution: when the question clearly targets note
        # section(s) (meds / instructions / diagnoses / hospital course), show
        # THAT section regardless of the number the model attached to it. The
        # model mis-numbers citations (a meds answer cites ^[1] while its
        # supporting passage sits elsewhere in the array), so a pure
        # cite -> passages[cite-1] mapping shows the wrong section.
        cited = None
        intent_body = None
        matched_section = None
        for sec in sections:
            cited = next((p for p in passages
                          if p.get("section") == sec), None)
            if cited is not None:
                matched_section = sec
                break
            # The index stores whole-note chunks: a passage labeled with a
            # different section still CONTAINS the target section, and the
            # labeled chunk can miss the top-k (near-tied whole-note
            # embeddings). Pull the section body out of the passage text
            # instead of showing the wrong section — deterministic for every
            # patient.
            for p in passages:
                body = _extract_section(p.get("text", ""), sec)
                if body:
                    cited = p
                    intent_body = body
                    matched_section = sec
                    break
            if cited is not None:
                break
        if cited is None:
            # cite is 1-based from the answer prose; clamp to a real passage.
            idx = min(max(cite, 1), len(passages)) - 1
            cited = passages[idx]
            badge = idx + 1
        else:
            # Badge mirrors the thread's citation number (the answer's ^[n]),
            # not the passage's array position.
            badge = max(cite, 1)
        if intent_body is not None:
            section_text = intent_body
            shown_section = matched_section
        elif matched_section is not None:
            section_text = _extract_section(cited.get("text", ""), matched_section)
            shown_section = matched_section
        else:
            section_text = _extract_section(cited.get("text", ""), cited.get("section", ""))
            shown_section = cited.get("section", "discharge note")
            # The supporting text may live OUTSIDE the intent sections (a note
            # with no meds/instructions section carries the meds in the hospital
            # course). Show the sentence(s) that name the meds so the card
            # visibly supports the claim instead of reading as a mismatch.
            if sections and shown_section not in set(sections) and answer:
                snippet = _med_snippet(section_text or cited.get("text", ""), answer)
                if snippet:
                    section_text = snippet
        components.append({"id": "source", "component": "SourceCard",
                           "cite": badge,
                           "section": shown_section,
                           "text": section_text or cited.get("text", ""),
                           "query": query})
    else:
        components.append({"id": "source", "component": "SourceCard",
                           "cite": 1, "section": "not found",
                           "text": "No supporting note passage was found for this "
                                   "question. An empty result is a real answer — "
                                   "the agent does not fabricate passages.",
                           "query": query})

    return {
        "surface_id": SURFACE_ID,
        "audience": AUDIENCE,
        "messages": [
            {"version": A2UI_VERSION,
             "createSurface": {"surfaceId": SURFACE_ID, "catalogId": CATALOG_ID}},
            {"version": A2UI_VERSION,
             "updateComponents": {"surfaceId": SURFACE_ID, "components": components}},
        ],
        "fallback_text": fallback,
    }
