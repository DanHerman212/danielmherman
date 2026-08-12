"""Fixture mode — real payloads served while the endpoints are down.

The serving endpoints are torn down for cost, but the demo UI needs real data
to build against. When DEMO_FIXTURE_MODE is on, the ask view answers the
starter chips from captured payloads in demo/data/demo_fixtures/:

  - risk numbers: REAL — computed by running the actual serving predictor
    locally (probability, threshold, decision, native-TreeSHAP top_factors),
    one per demo-cohort patient (cohort_risk.json).
  - rag passages: REAL — the passages returned by the live index on 2026-08-11
    for the primary demo patient (Leonard Castellano, hadm 20724182); the full
    note text is from BigQuery.

The response shape is identical to the live agent's /ask response
({question, answer, tool_calls, ...}), so the front-end cannot tell the
difference and the switch to live is zero-change.

Honesty rule: patients without captured rag passages return an EMPTY result
(returned: 0) — the same empty-is-a-real-answer contract as the live tool. The
live index covers the full test split, so every demo patient has real passages
once the endpoints are redeployed.
"""

import json
from functools import lru_cache
from pathlib import Path

from django.conf import settings

FIXTURES_DIR = Path(__file__).resolve().parent / 'data' / 'demo_fixtures'

# The chips the demo UI can send; each maps to a composed question and a set
# of tool calls to simulate.
CHIPS = {
    'risk': 'Assess the 30-day readmission risk for this patient.',
    'meds': 'What medications was this patient discharged on?',
    'summarize': 'Summarize the recent discharge notes for this patient.',
    'compare': 'Compare this assessment to the previous one for this patient.',
}

# A retrieval query per chip, used to ground the answer (matters when we have
# captured rag passages; otherwise the honest empty path runs).
_CHIP_QUERY = {
    'risk': 'sepsis and elevated lactate on broad-spectrum antibiotics',
    'meds': 'medications',
    'summarize': 'summarize the hospital course and discharge diagnosis',
}


@lru_cache(maxsize=1)
def _cohort_risk() -> dict[str, dict]:
    """hadm_id (str) -> full predict payload, for every demo patient."""
    return json.loads((FIXTURES_DIR / 'cohort_risk.json').read_text())


def risk_for(hadm_id: int) -> dict | None:
    """The real predict payload for one patient, or None if not in the cohort."""
    return _cohort_risk().get(str(hadm_id))


def band_for(payload: dict | None) -> tuple[str | None, str]:
    """(key, label) from a risk payload, derived from the operating threshold.

    low = below threshold · borderline = threshold to threshold + 0.08 ·
    high = above that. The threshold itself comes from the model, so a
    recalibration reshapes the bands instead of hardcoding clinical cutoffs.
    """
    if not payload:
        return None, ''
    p = float(payload['probability'])
    t = float(payload['threshold'])
    if p < t:
        return 'low', 'low risk'
    if p < t + 0.08:
        return 'borderline', 'borderline'
    return 'high', 'high risk'


@lru_cache(maxsize=1)
def _captured_rag() -> dict[str, dict]:
    """query-key -> captured rag_search response (only the primary patient)."""
    out = {}
    for path in FIXTURES_DIR.glob('rag_*.json'):
        payload = json.loads(path.read_text())
        out[payload['query']] = payload
    return out


def _empty_rag(hadm_id: int, query: str) -> dict:
    """The honest empty answer when we have no captured passages for a patient."""
    return {'hadm_id': hadm_id, 'query': query, 'returned': 0, 'passages': []}


def _rag_response(hadm_id: int, query: str) -> dict:
    """A rag_search tool response: real captured passages or the honest empty."""
    captured = _captured_rag().get(query)
    if captured and captured.get('hadm_id') == hadm_id:
        return captured
    return _empty_rag(hadm_id, query)


def _tool_call(name: str, args: dict, response: dict) -> dict:
    return {'name': name, 'args': args, 'response': response}


def _passages_of(tool_calls: list[dict]) -> list[dict]:
    for tc in tool_calls:
        if tc['name'] == 'rag_search':
            return tc['response'].get('passages') or []
    return []


def _compose_answer(chip: str, tool_calls: list[dict]) -> str:
    """Deterministic, cited prose composed from the tool payloads."""
    pred = next((tc['response'] for tc in tool_calls
                 if tc['name'] == 'predict_readmission'), None)
    passages = _passages_of(tool_calls)

    if chip == 'risk' and pred and pred.get('probability') is not None:
        p = float(pred['probability'])
        thr = float(pred.get('threshold', 0.5))
        band = 'above' if p >= thr else 'below'
        sentences = [
            f"Estimated 30-day unplanned readmission risk is {p:.3f} "
            f"({p * 100:.1f}%), {band} the {thr:.2f} operating threshold."
        ]
        factors = pred.get('top_factors') or []
        if factors:
            top = factors[0]
            sentences.append(
                f"The strongest driver is {top['feature']} "
                f"({top['direction']} risk).")
        if passages:
            sec = passages[0]['section'].replace('_', ' ')
            sentences.append(
                f"The discharge note documents the admission in the "
                f"{sec} section.^[1]")
        else:
            sentences.append(
                'No supporting note passage was found for this question.')
        return ' '.join(sentences)

    if chip in ('meds', 'summarize'):
        if passages:
            sec = passages[0]['section'].replace('_', ' ')
            if chip == 'meds':
                lead = ('The patient was discharged on the medications listed '
                        'in the discharge note')
            else:
                lead = ('The discharge note covers the admission in these '
                        'sections')
            labels = ' · '.join(
                f"{p['section'].replace('_', ' ')}^[{i + 1}]"
                for i, p in enumerate(passages[:4]))
            return f"{lead}: {labels}."
        return ('No supporting note passage was found for this question.')

    if chip == 'compare' and pred and pred.get('probability') is not None:
        p = float(pred['probability'])
        thr = float(pred.get('threshold', 0.5))
        return (
            f"Estimated 30-day unplanned readmission risk is {p:.3f} "
            f"({p * 100:.1f}%), {thr:.2f} threshold. The canvas shows this "
            'assessment beside the earlier one; the numbers are the same '
            'because the underlying record has not changed.'
        )

    return 'Ask a specific question, or use a starter chip.'


def fixture_ask(payload: dict) -> dict:
    """Answer a starter-chip request from real captured payloads.

    Returns the same shape as the live agent /ask response, plus a `source`
    field ('fixture') so the trace view can be honest about mode.
    """
    hadm_id = payload.get('hadm_id')
    chip = payload.get('chip')

    # Free text / unknown chips cannot be answered from fixtures — only the
    # starter chips map to captured payloads. Check before parsing hadm_id so
    # a typed question gets a clear "use the live agent" message, not a
    # confusing hadm_id error.
    if chip not in CHIPS:
        return {'error': 'unsupported_in_fixture_mode',
                'message': 'Free-text questions need the live agent '
                           '(DEMO_FIXTURE_MODE=false). Use a starter chip.'}

    try:
        hadm_id = int(hadm_id)
    except (TypeError, ValueError):
        return {'error': 'bad_request', 'message': 'hadm_id must be an integer.'}

    pred = risk_for(hadm_id)
    if not pred:
        return {'error': 'unknown_patient',
                'message': f'No admission {hadm_id} in the demo cohort.'}

    tool_calls = []
    if chip in ('risk', 'compare'):
        tool_calls.append(_tool_call(
            'predict_readmission', {'hadm_id': hadm_id}, pred))
    if chip in ('risk', 'meds', 'summarize'):
        query = _CHIP_QUERY[chip]
        tool_calls.append(_tool_call(
            'rag_search', {'hadm_id': hadm_id, 'query': query, 'top_k': 5},
            _rag_response(hadm_id, query)))

    return {
        'question': CHIPS[chip],
        'answer': _compose_answer(chip, tool_calls),
        'tool_calls': tool_calls,
        'source': 'fixture',
        'model': 'fixture-mode (real captured payloads)',
        'fixture_note': (
            'Served from real captured payloads while the Vertex endpoints '
            'are torn down. Risk is computed by the real serving predictor; '
            'rag passages are the 2026-08-11 live captures for the primary '
            'patient.'),
    }
