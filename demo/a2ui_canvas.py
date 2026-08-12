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

# The note section headers the chunker used (mirrors the client-side list).
_SECTION_HEADERS = [
    "History of Present Illness", "Past Medical History", "Family History",
    "Social History", "Physical Exam", "Brief Hospital Course",
    "Discharge Condition", "Discharge Diagnosis", "Discharge Medications",
    "Medications on Admission", "Discharge Disposition", "Discharge Instructions",
    "Chief Complaint", "Major Surgical or Invasive Procedure",
]


def _band(probability: float, threshold: float) -> str:
    """low = below threshold · borderline = threshold to threshold + 0.08."""
    if probability < threshold:
        return "low"
    if probability < threshold + 0.08:
        return "borderline"
    return "high"


def _extract_section(note_text: str, section: str) -> str | None:
    """Extract a named section's text from a full note (mirrors the client)."""
    title = str(section or "").replace("_", " ")
    if not title:
        return None
    m = re.search(rf"\b{re.escape(title)}\b\s*:", note_text, re.IGNORECASE)
    if not m:
        return None
    start = m.start()
    end = len(note_text)
    for header in _SECTION_HEADERS:
        hm = re.search(
            rf"\n\s*{re.escape(header)}\s*:",
            note_text[start + len(m.group(0)):],
            re.IGNORECASE,
        )
        if hm:
            candidate = start + len(m.group(0)) + hm.start()
            if candidate < end:
                end = candidate
    return note_text[start:end].strip()


def compose_risk_canvas(predict: dict | None, rag: dict | None) -> dict:
    """Turn one predict (+ rag) payload into the A2UI risk-canvas envelope.

    predict is None when the question did not request a readmission estimate
    (e.g. a medication or summarize question) — the canvas then answers with a
    plain note plus the cited source instead of a risk score, so the agent
    never 500s on a non-risk turn.
    """
    components: list[dict] = [
        {"id": "root", "component": "Card", "child": "body"},
        {"id": "body", "component": "Column", "children": []},
    ]
    children = components[1]["children"]

    if predict is None:
        children += ["note"]
        components.append({"id": "note", "component": "Text",
                           "text": "No 30-day readmission risk estimate was "
                                   "requested for this question.",
                           "variant": "h2"})
        fallback = "No 30-day readmission risk estimate was requested for this question."
    else:
        probability = float(predict["probability"])
        threshold = float(predict["threshold"])
        band = _band(probability, threshold)
        factors = predict.get("top_factors") or []

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
            f"Admission {predict.get('hadm_id')}: {probability:.1%} 30-day readmission "
            f"probability ({probability:.4f}), {band} at a {threshold:.2f} threshold."
        )

    # Cited source (the first passage's section text — matches the custom demo).
    passages = (rag or {}).get("passages") or []
    query = (rag or {}).get("query") or "discharge note"
    children.append("source")
    if passages:
        first = passages[0]
        section_text = _extract_section(first.get("text", ""), first.get("section", ""))
        components.append({"id": "source", "component": "SourceCard",
                           "cite": 1,
                           "section": first.get("section", "discharge note"),
                           "text": section_text or first.get("text", ""),
                           "query": query})
    else:
        components.append({"id": "source", "component": "SourceCard",
                           "cite": 1, "section": "not found",
                           "text": "No supporting note passage was found for this "
                                   "question. An empty result is a real answer — "
                                   "the agent does not fabricate passages.",
                           "query": query})

    model = predict.get('model_version', 'unknown') if predict else '—'
    feature_source = predict.get('feature_source', 'unknown') if predict else '—'
    children.append("prov")
    components.append({"id": "prov", "component": "Text",
                       "text": f"Model {model} · features from {feature_source} · "
                               "A2UI canvas",
                       "variant": "caption"})

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
