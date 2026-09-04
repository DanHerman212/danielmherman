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

from .feature_labels import humanize

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
    "name": ("Name",),
    "unit_no": ("Unit No", "Unit No.", "Medical Record Number", "MRN"),
    "admission_date": ("Admission Date", "Date of Admission"),
    "discharge_date": ("Discharge Date", "Date of Discharge"),
    "date_of_birth": ("Date of Birth", "DOB"),
    "sex": ("Sex",),
    "service": ("Service",),
    "attending": ("Attending",),
    "allergies": ("Allergies", "Allergy", "Allergies to"),
    "activity": ("Activity",),
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
        "Brief Summary of Hospital Course", "Course on Admission",
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
        "Final Diagnosis", "Final Diagnoses", "Diagnosis at Admission",
        "Diagnoses",
    ),
    "discharge_condition": (
        "Discharge Condition", "Condition", "Condition on Discharge",
        "Conditions on Discharge", "Condition Upon Discharge", "Condition at Discharge",
        "Condition of Patient on Discharge", "Condition of the Patient at Discharge",
    ),
    "discharge_instructions": (
        "Discharge Instructions", "Discharge Plan", "Additional Instructions",
        "Special Instructions", "Instructions to Patient", "Discharge Diet",
        "Discharge Activities", "Physical Activity", "Recommendations",
        "Discharge Instructions/Medications",
        # MTSamples 2788-style long-form instructions header (the demo
        # extracts it directly; the harness alias list is the source of truth
        # for chunking and may adopt it too).
        "Instructions Given to the Patient at the Time of Discharge",
    ),
    "discharge_summary": ("Discharge Summary", "Discharge Summaries"),
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
        # S7-12: anchor to a line start (^ or \n), consistent with the end
        # bound, so generic aliases (History, Condition, Medications…) can't
        # match mid-sentence and truncate the wrong body.
        m = re.search(
            rf"(^|\n)\s*{re.escape(alias)}\b\s*:", note_text, re.IGNORECASE
        )
        if m:
            anchor = m.group(1)
            rest = m.group(0)[len(anchor):]
            ws = len(rest) - len(rest.lstrip())
            start = m.start() + len(anchor) + ws
            matched = rest[ws:]
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


_CITATION_RE = re.compile(r"\^\[(\d+(?:\s*,\s*\d+)*|\d+\s*-\s*\d+)\]")


def _expand_citations(inner: str) -> list[int]:
    """Expand a ^[n] marker body ("3" / "1, 2" / "1-3") to a number list."""
    if "-" in inner:
        a, b = (int(x.strip()) for x in inner.split("-", 1))
        return list(range(a, b + 1))
    return [int(x.strip()) for x in inner.split(",") if x.strip()]


def _renumber_citations(answer: str) -> tuple[str, dict[int, int]]:
    """Renumber ^[n] markers to first-appearance order.

    Returns (renumbered_answer, old_to_new) where old_to_new maps the model's
    original citation number (the tool's array position) to its renumbered
    number (first-appearance order, 1-based).
    """
    if not answer:
        return answer, {}
    markers = list(_CITATION_RE.finditer(answer))
    if not markers:
        return answer, {}
    # Group markers separated only by whitespace into one cluster.
    clusters: list[list[re.Match]] = [[markers[0]]]
    for m in markers[1:]:
        gap = answer[clusters[-1][-1].end():m.start()]
        if gap.strip():
            clusters.append([m])
        else:
            clusters[-1].append(m)
    # Renumber by first appearance, cluster by cluster.
    old_to_new: dict[int, int] = {}
    nxt = 1
    for cl in clusters:
        for m in cl:
            for num in _expand_citations(m.group(1)):
                if num not in old_to_new:
                    old_to_new[num] = nxt
                    nxt += 1
    # Rebuild: one marker per cluster, carrying the cluster's first number.
    out: list[str] = []
    last = 0
    for cl in clusters:
        out.append(answer[last:cl[0].start()])
        first = _expand_citations(cl[0].group(1))[0]
        out.append(f"^[{old_to_new[first]}]")
        last = cl[-1].end()
    out.append(answer[last:])
    return "".join(out), old_to_new


def renumber_citations(answer: str) -> str:
    """Renumber ^[n] markers to first-appearance order (1, 2, 3, ...).

    The model numbers citations by the tool's array position: a meds-only
    answer cites ^[3] because discharge_medications is the THIRD section in
    rag_search_sections order. In a meds-only turn that reads illogically —
    the first (and only) citation should be ^[1]. Renumber deterministically
    so citations always start at 1 in order of appearance; the canvas's
    section-intent resolution keeps the passage mapping correct regardless.

    Also collapses STACKED citations (^[1]^[2]^[3]... with only whitespace
    between them — the model dumping every returned passage onto one claim) to
    a single marker, since a row of citations on one claim has no per-claim
    granularity to preserve.
    """
    return _renumber_citations(answer)[0]


def citation_remap(answer: str) -> dict[str, int]:
    """{renumbered citation number: original passage number} for the client.

    `renumber_citations` rewrites the model's ^[n] markers to first-appearance
    order, so a clicked (renumbered) number no longer matches the passage
    array index when the model cited passages out of array order. The client
    uses this map to translate a clicked ^[n] back to the original passage.
    Keys are strings for JSON.
    """
    _, old_to_new = _renumber_citations(answer)
    return {str(new): old for old, new in old_to_new.items()}


def _unavailable_text(section: str) -> str:
    """The deterministic message for a question whose target section the note
    does not have. Never mine the content from unrelated narrative."""
    if section == "discharge_medications":
        return "No discharge medication information is available for this patient."
    return f"No {section.replace('_', ' ')} information is available for this patient."


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
                        cite: int = 1, sections: tuple[str, ...] = ()) -> dict:
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
        # Non-risk question (meds / summarize / free text): no estimate, and no
        # big "no risk estimate" heading either — that space belongs to the
        # citation source. The small provenance caption below already says
        # plainly that no estimate was requested.
        fallback = "No 30-day readmission risk estimate was requested for this question."
    else:
        probability = float(estimate["probability"])
        threshold = float(estimate["threshold"])
        band = _band(probability, threshold)
        factors = estimate.get("top_factors") or []
        # Post-process the SHAP names for visual consumption: each factor gets
        # a human label (feature_labels.humanize) so the bars never show a raw
        # model key (camelCase or snake_case).
        factors = [
            {**f, "label": humanize(f["feature"])}
            for f in factors
        ]

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
        if cited is None and sections:
            # The note has NONE of the targeted sections. The deterministic
            # answer is "not available", not a passage mined from unrelated
            # narrative (e.g. meds mentioned inside the hospital course).
            badge = max(cite, 1)
            shown_section = "not available"
            section_text = _unavailable_text(sections[0])
        elif cited is None:
            # cite is 1-based from the answer prose; clamp to a real passage.
            idx = min(max(cite, 1), len(passages)) - 1
            cited = passages[idx]
            badge = idx + 1
            shown_section = cited.get("section", "discharge note")
            section_text = _extract_section(cited.get("text", ""), shown_section)
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
                shown_section = cited.get("section", "discharge note")
                section_text = _extract_section(cited.get("text", ""), shown_section)
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
