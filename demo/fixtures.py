"""Fixture mode — synthetic payloads served while the endpoints are down.

The serving endpoints may be torn down for cost, but the demo UI needs data to
build against. When DEMO_FIXTURE_MODE is on, the ask view answers the starter
chips from captured payloads in demo/data/demo_fixtures/:

  - risk numbers: SYNTHETIC — computed by running the actual serving predictor
    locally on the synthetic cohort features (probability, threshold, decision,
    native-TreeSHAP top_factors), one per demo-cohort patient (cohort_risk.json).
  - rag passages: SYNTHETIC — passages from the synthetic notes corpus, captured
    from the synthetic index once deployed. Until then, patients fall back to
    the honest-empty path below.

The response shape is identical to the live agent's /ask response — including
the full presentation contract (`a2ui`, `sources`) —
which is composed by the AGENT's own modules (imported lazily from the sibling
enterprise_clinical_copilot repo) so fixture and live paths can never drift.
The front-end cannot tell the difference and the switch to live is zero-change.

Honesty rule: patients without captured rag passages return an EMPTY result
(returned: 0) — the same empty-is-a-real-answer contract as the live tool.
"""

import json
import sys
from functools import lru_cache
from pathlib import Path

FIXTURES_DIR = Path(__file__).resolve().parent / 'data' / 'demo_fixtures'

# The agent lives in the sibling enterprise_clinical_copilot repo (both repos
# sit side by side under the same parent directory); add it to the path lazily
# so the site still boots when the repo is absent (fixture mode is dev
# scaffolding and is rejected in production).
_ECC_ROOT = Path(__file__).resolve().parents[2] / 'enterprise_clinical_copilot'
if _ECC_ROOT.is_dir() and str(_ECC_ROOT) not in sys.path:
    sys.path.insert(0, str(_ECC_ROOT))


@lru_cache(maxsize=1)
def _agent_presentation():
    """(compose_presentation, label_for) imported from the agent repo."""
    from services.agent.a2ui import compose_presentation
    from services.agent.feature_labels import label_for
    return compose_presentation, label_for


# The console's starter chips: the ONE list on this side. Everything else in this
# repository derives from it — the live allowlist, fixture mode's wording, and the
# buttons the console renders (passed to the page by `views.a2ui_console`).
#
# It was two lists here until 2026-10-08: this one and another in
# `static/js/demo_flow.js`. Two declarations of one concept in one repository is a
# drift hazard with no upside: a chip added to the console and forgotten here is
# refused with a 400 the moment somebody clicks it, and the page gives no hint why.
#
# `question` is the wording the model is asked, and it is kept here ONLY for fixture
# mode, which has to write a `question` into its response to match the live contract.
# The live path sends the chip NAME alone — the agent owns the prompt wording, on
# purpose, so that a change to half the prompt cannot ship without touching the chain
# and its revision (see `services/agent/questions.py`). `label` is UI copy and is
# deliberately not the wording.
#
# The agent's keys remain a separate declaration in a separate repository, and cannot
# be anything else: neither production image contains the other's code. `test_chips.py`
# holds the two together where drift is actually introduced — on a machine that has
# both repositories.
CHIPS = {
    'risk': {
        'label': 'Run 30-day readmission risk',
        'question': 'Assess the 30-day readmission risk for this patient.',
    },
    'meds': {
        'label': 'What medications were they discharged on?',
        'question': 'What medications was this patient discharged on?',
    },
    'summarize': {
        'label': 'Summarize recent discharge notes',
        'question': 'Summarize the recent discharge notes for this patient.',
    },
    'literature': {
        'label': 'Search PubMed for recent literature',
        'question': 'Search PubMed for recent literature on this condition.',
    },
}

# Just the names, which is all the live path needs to reject an unknown chip before a
# credit is spent.
#
# `literature` is in this set for the live path even though fixture mode cannot answer
# it (see below): the set is the allowlist `views._parse_starters` checks, so a chip the
# console offers and this omits is refused at the site and never reaches the agent.
CHIP_NAMES = tuple(CHIPS)

# Chips whose answer needs a live service that captured payloads cannot stand in for.
# Fixture mode says so rather than composing something that reads as though the feature
# worked offline — the one thing fixtures must never do.
FIXTURE_UNAVAILABLE_CHIPS = frozenset({'literature'})


def chip_buttons() -> list[dict]:
    """The chips the console renders: `[{'key', 'label'}]` in declaration order.

    The page is handed this rather than declaring its own list, so the buttons and the
    allowlist above cannot disagree.
    """
    return [{'key': name, 'label': chip['label']} for name, chip in CHIPS.items()]

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
    _, label_for = _agent_presentation()
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
                f"The strongest driver is {label_for(top['feature'])} "
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
        return 'No supporting note passage was found for this question.'

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

    if chip in FIXTURE_UNAVAILABLE_CHIPS:
        return {'error': 'unsupported_in_fixture_mode',
                'message': 'Literature search runs against PubMed and has no '
                           'offline fixture. Run with DEMO_FIXTURE_MODE=false.'}

    try:
        hadm_id = int(hadm_id)
    except (TypeError, ValueError):
        return {'error': 'bad_request', 'message': 'hadm_id must be an integer.'}

    pred = risk_for(hadm_id)
    if not pred:
        return {'error': 'unknown_patient',
                'message': f'No admission {hadm_id} in the demo cohort.'}

    tool_calls = []
    if chip == 'risk':
        tool_calls.append(_tool_call(
            'predict_readmission', {'hadm_id': hadm_id}, pred))
    if chip in ('risk', 'meds', 'summarize'):
        query = _CHIP_QUERY[chip]
        tool_calls.append(_tool_call(
            'rag_search', {'hadm_id': hadm_id, 'query': query, 'top_k': 5},
            _rag_response(hadm_id, query)))

    question = CHIPS[chip]['question']
    answer = _compose_answer(chip, tool_calls)
    compose_presentation, _ = _agent_presentation()
    presentation = compose_presentation(question, answer, tool_calls)

    return {
        'question': question,
        'answer': presentation['answer'],
        'tool_calls': tool_calls,
        'a2ui': presentation['a2ui'],
        'sources': presentation['sources'],
        # Carried so the fixture response matches the live one exactly. Absent keys
        # here would be a difference the browser could see even though it is not
        # supposed to be able to tell the two apart — which is the whole point of
        # composing the fixture response with the agent's own modules.
        'literature': presentation.get('literature'),
        'source': 'fixture',
        'model': 'fixture-mode (real captured payloads)',
        'fixture_note': (
            'Served from real captured payloads while the Vertex endpoints '
            'are torn down. Risk is computed by the real serving predictor; '
            'rag passages are the 2026-08-11 live captures for the primary '
            'patient.'),
    }
