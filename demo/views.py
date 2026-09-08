"""The demo's endpoints: the A2UI console page and its ask proxy.

Both require a login. Accounts are issued, not self-registered — there is no
signup route anywhere in this app, by design.
"""

import json
import logging

from django.conf import settings
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.shortcuts import render
from django.views.decorators.http import require_POST

from .agent_client import AgentError, ask as ask_agent
from .fixtures import CHIPS, fixture_ask
from .models import DemoPatient, DemoQuota

logger = logging.getLogger(__name__)

MAX_QUESTION_CHARS = 2000


def _question_for(payload):
    """Turn the request body into a question, or return (None, error).

    Three ways in: a starter chip (mapped to the chip's question so the live
    agent answers the chosen intent — risk, medications, summarize — instead of
    always the risk question), a picked patient id, or typed free text. Chips
    and the picker send an id so the server embeds it in the wording — the
    phrasing stays consistent and cannot be edited into a leading question.
    """
    hadm_id = payload.get('hadm_id')
    if hadm_id is not None:
        try:
            hadm_id = int(hadm_id)
        except (TypeError, ValueError):
            return None, 'hadm_id must be an integer.'
        if hadm_id <= 0:
            return None, 'hadm_id must be positive.'
        # The demo cohort is the server-side authorization boundary (S1-09):
        # an id outside it is rejected BEFORE any credit is consumed or any
        # agent spend happens — otherwise a nonexistent admission is a
        # guaranteed downstream tool error that gets refunded every time,
        # turning the refund loop into unmetered Gemini spend.
        if not DemoPatient.objects.filter(pk=hadm_id).exists():
            return None, 'Unknown admission id.'

        chip = payload.get('chip')
        if chip is not None:
            question = CHIPS.get(chip)
            if not question:
                return None, 'unknown chip.'
            return f'{question} For admission {hadm_id}.', None
        # Free text sent alongside the selected patient: embed the admission so
        # the live agent can ground the answer (same phrasing the chips use).
        question = payload.get('question')
        if isinstance(question, str) and question.strip():
            q = question.strip()
            if len(q) > MAX_QUESTION_CHARS:
                return None, f'Question exceeds {MAX_QUESTION_CHARS} characters.'
            return f'{q} For admission {hadm_id}.', None
        return f'Assess the 30-day readmission risk for admission {hadm_id}.', None

    question = payload.get('question')
    if not isinstance(question, str) or not question.strip():
        return None, 'Provide either hadm_id or a non-empty question.'
    if len(question) > MAX_QUESTION_CHARS:
        return None, f'Question exceeds {MAX_QUESTION_CHARS} characters.'
    return question.strip(), None


# --------------------------------------------------------------------------- #
# A2UI — the canvas composed as A2UI messages by the AGENT and rendered by the
# vendored A2UI renderer. Fixture mode is the default (same real payloads); the
# live branch runs the real agent once the endpoint is deployed.
# --------------------------------------------------------------------------- #

@login_required
def a2ui_console(request):
    """The A2UI canvas demo: enterprise shell + patient rail + thread, with the
    context canvas rendered from agent-composed A2UI messages.

    The patient rail carries no precomputed risk band — every patient is
    unscored until a live assessment is run in the thread."""
    return render(request, 'demo/a2ui_console.html', {
        'rows': [{'patient': p} for p in DemoPatient.objects.all()],
        'remaining': DemoQuota.remaining(request.user),
    })


def _tools_errored(result) -> bool:
    """True if any tool the agent called returned an error payload.

    The MCP tools fail GRACEFULLY when a downstream (endpoint) dependency is
    down — they return {"error": ...} instead of raising, so the agent replies
    with HTTP 200. That is still a failure for quota purposes (a credit was
    spent and no real answer came back), so the views refund + 502 on this.
    """
    return any(
        (tc.get("response") or {}).get("error")
        for tc in (result.get("tool_calls") or [])
    )


@login_required
@require_POST
def a2ui_ask(request):
    """Proxy one question to the agent and return its presentation contract.

    Fixture mode answers the starter chips from captured payloads; live mode
    runs the real agent (quota, refund on failure). Either way the response
    arrives with the canvas and citation metadata already composed.
    """
    try:
        payload = json.loads(request.body)
    except ValueError:
        return JsonResponse({'error': 'Request body must be JSON.'}, status=400)

    if not isinstance(payload, dict):
        return JsonResponse({'error': 'Request body must be a JSON object.'}, status=400)

    # Fixture mode answers the starter chips from real captured payloads (same
    # response shape as the live agent /ask). Passing the payload straight
    # through means free text / unknown chips get the clear "use the live
    # agent" message, never a confusing hadm_id error (screen-guide §4.1).
    if settings.DEMO_FIXTURE_MODE:
        result = fixture_ask(payload)
        if result.get('error'):
            status = 400 if result['error'] == 'bad_request' else 404
            return JsonResponse(result, status=status)
    else:
        question, error = _question_for(payload)
        if error:
            return JsonResponse({'error': error}, status=400)

        # Claim the credit before spending anything. Checking the quota after
        # the call would let a burst of concurrent requests all pass the check
        # and all bill. `period` is the claim token a refund must present.
        period = DemoQuota.consume(request.user)
        if not period:
            return JsonResponse({
                'error': 'Daily demo limit reached.',
                'remaining': 0,
            }, status=429)

        try:
            result = ask_agent(question)
        except AgentError as exc:
            # Give the credit back — freely if provably nothing was billed,
            # under the daily refund cap otherwise (S1-09). Exception detail
            # is logged server-side, never returned to the client (S1-03).
            logger.error('a2ui_ask: agent call failed: %s', exc)
            DemoQuota.refund(request.user, period, spent=exc.spent)
            return JsonResponse({
                'error': 'The clinical copilot is unavailable. Please try again.',
                'remaining': DemoQuota.remaining(request.user),
            }, status=502)

        # Downstream (endpoint) failures surface as graceful tool error
        # payloads with HTTP 200 — refund + 502 so a credit is never silently
        # consumed for an answer that never materialized.
        if _tools_errored(result):
            DemoQuota.refund(request.user, period)
            return JsonResponse({
                'error': 'The clinical copilot is unavailable. Please try again.',
                'remaining': DemoQuota.remaining(request.user),
            }, status=502)

    # The presentation contract (renumbered answer, citation_map,
    # intent_sections, a2ui) is composed in the AGENT — the layer where the
    # guardrails ran and the tool evidence is visible. Django is a pass-through
    # for it; only the web-specific `remaining` quota is added here.
    result['remaining'] = DemoQuota.remaining(request.user)
    return JsonResponse(result)
