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
  - literature records: LIVE — real PubMed records captured once by
    `scripts/demo/capture_synthetic_literature_fixtures.py` in the agent repository,
    so `/pubmed` answers offline without depending on NCBI being reachable or on a
    shared IP not having hit the rate limit. Keyed by query, with no admission: the
    tool takes none, because the same clinical question returns the same articles
    whoever the patient is.

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
    # Phase 4B. Fixture mode cannot answer this one (it needs a live agent to generate the
    # trajectories), and it is listed anyway for the same reason `literature` was: the
    # set is the allowlist the site checks before spending a credit, so a chip the
    # console offers and this omits is refused at the site with no explanation.
    'labs': {
        'label': 'Show inpatient lab trajectories',
        'question': "Describe the laboratory trajectories for this patient's admission.",
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
#
# Empty as of 2026-10-15: `/pubmed` was the last member and it left when its records
# were captured to disk. The set is kept rather than deleted because the rule it
# enforces has not gone away — a chip added later that needs a live service belongs
# here, and an empty set is a cheaper thing to add to than a deleted one is to
# remember.
FIXTURE_UNAVAILABLE_CHIPS = frozenset()

# The slash commands the composer offers.
#
# `command` is what a clinician types; `chip` is the intent the agent receives.
# Keeping both means the visible vocabulary and the wire vocabulary can differ
# without either becoming a second list to hold in step. Every `chip` here must
# be a key of `CHIPS` — `test_chips.py` fails if one is not.
#
# `hidden` is the third thing an entry can say, and it arrived 2026-10-16 (Phase 1.1
# §3): a command that is real but no longer worth a button. `/risk` is the first,
# because the anchor turn `/ehr` now carries the same score beside the narrative
# that explains it. Hidden is not removed — the flag is read where the MENU is
# drawn, and the list itself still resolves a typed `/risk` and still feeds the
# record printed above an answer — because hiding a control and deleting a
# capability are different acts, and only one of them was asked for.
SLASH_COMMANDS = (
    {'command': 'risk', 'chip': 'risk', 'hidden': True,
     'description': 'Run the 30-day readmission risk model'},
    {'command': 'meds', 'chip': 'meds',
     'description': 'Extract the discharge medications'},
    # An alias, hidden so the menu keeps its four macros. `/drugs` is what a clinician
    # types for the medication list, and an unrecognised slash command used to leave the
    # composer hanging with nothing rendered (2026-10-16). The alias belongs HERE, with
    # the typed vocabulary, rather than in the agent: the agent's contract is a chip and
    # never a leading slash, so a fallback there would be a second command vocabulary in
    # a service that deliberately has none.
    {'command': 'drugs', 'chip': 'meds', 'hidden': True,
     'description': 'Extract the discharge medications (alias of /meds)'},
    {'command': 'drug', 'chip': 'meds', 'hidden': True,
     'description': 'Extract the discharge medications (alias of /meds)'},
    {'command': 'ehr', 'chip': 'summarize',
     'description': 'Chart summary, readmission risk and cohort comparison'},
    # Phase 4B. The agent grew this command because hiding the capability forced a
    # free-text question ("what are the lab trajectories for this patient?") down a
    # path that could loop to a recursion failure, and the deterministic route has to
    # be the one a clinician reaches for rather than the fallback.
    {'command': 'labs', 'chip': 'labs',
     'description': 'Inpatient laboratory trajectories'},
    {'command': 'pubmed', 'chip': 'literature',
     'description': 'Search the medical literature'},
)


def offered_commands() -> list[dict]:
    """The commands the composer's `/` menu offers: `SLASH_COMMANDS` minus the hidden.

    Separate from `SLASH_COMMANDS` on purpose, and only by this much. Two lists would
    drift; one list and a flag cannot, because a command that is in the list but not
    offered is still a command.
    """
    return [entry for entry in SLASH_COMMANDS if not entry.get('hidden')]


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
    # The condition `/pubmed` answers with in fixture mode. Three captures on disk
    # cover the demo cohort's conditions; this names the one the chip uses, and the
    # fixture note says so, because a chip that silently answered a different
    # condition than the patient has would read as evidence about them.
    'literature': 'congestive heart failure 30-day readmission risk',
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


@lru_cache(maxsize=1)
def _captured_literature() -> dict[str, dict]:
    """query-key -> captured search_literature response."""
    out = {}
    for path in FIXTURES_DIR.glob('literature_*.json'):
        payload = json.loads(path.read_text())
        out[payload['query']] = payload
    return out


def _literature_response(query: str) -> dict:
    """A search_literature tool response: the captured records, or the honest empty.

    The capture's own `provenance` key is dropped here. The live tool does not return
    one, and the fixture response has to be a response the browser could not tell
    apart from the live one — a key that appears only offline is exactly the
    difference this module exists to prevent.
    """
    captured = _captured_literature().get(query)
    if captured:
        return {k: v for k, v in captured.items() if k != 'provenance'}
    return {
        'query': query,
        'returned': 0,
        'articles': [],
        'note': 'No captured records for this query in fixture mode.',
    }


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

    if chip == 'literature':
        literature = next((tc['response'] for tc in tool_calls
                           if tc['name'] == 'search_literature'), None)
        articles = (literature or {}).get('articles') or []
        if not articles:
            # The empty result is a real answer and says only what happened: the
            # records a summary would rest on are not there, so no summary is made.
            return ('The literature search returned no records for this question.')
        # A caption, not a synthesis. The synthesis in the live path is written by a
        # model reading the abstracts; nothing here reads them, and prose composed
        # from a title list would be an assertion about the evidence that no one
        # actually made. What the fixture can honestly state is what was retrieved.
        return (f"{len(articles)} PubMed records were retrieved for this "
                f"question.^[1]")

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
                'message': 'This chip needs a live service that captured '
                           'payloads cannot stand in for. Run with '
                           'DEMO_FIXTURE_MODE=false.'}

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
    if chip == 'literature':
        # No rag call beside it: a literature answer rests on the records, and the
        # canvas swaps the risk widgets out for them rather than showing both.
        #
        # The risk call IS made, because `/pubmed` gained it as a supplementary call
        # (Phase 2, 2026-10-16) so the comparative matrix can pin this patient's own
        # estimate above the published cohorts. It is not a second surface — the widgets
        # stay swapped out — the estimate is the baseline row of the comparison, and a
        # comparison with no patient in it would be a table about strangers. Served from
        # the same captured payload the risk chip uses, so the two cannot disagree.
        query = _CHIP_QUERY[chip]
        tool_calls.append(_tool_call(
            'search_literature', {'query': query}, _literature_response(query)))
        tool_calls.append(_tool_call(
            'predict_readmission', {'hadm_id': hadm_id}, pred))

    question = CHIPS[chip]['question']
    answer = _compose_answer(chip, tool_calls)
    compose_presentation, _ = _agent_presentation()
    # The chip IS the command name the live path passes, and the composer needs it: the
    # comparative matrix is drawn per command (`_draws_matrix`), so omitting it made the
    # fixture compose a turn the live service would never produce — records with no
    # comparison above them. Everything the surface draws is decided by that one
    # argument here, which is the whole reason the fixture composes through the agent's
    # own module instead of a copy of it.
    presentation = compose_presentation(question, answer, tool_calls, command=chip)

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
