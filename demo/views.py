"""The demo's two endpoints: a console page and an ask proxy.

Both require a login. Accounts are issued, not self-registered — there is no
signup route anywhere in this app, by design.
"""

import json

from django.conf import settings
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.shortcuts import render
from django.views.decorators.http import require_POST

from .agent_client import AgentError, ask as ask_agent
from .a2ui_canvas import compose_risk_canvas, first_citation
from .fixtures import CHIPS, band_for, fixture_ask, risk_for
from .models import DemoPatient, DemoQuota

MAX_QUESTION_CHARS = 2000


@login_required
def console(request):
    """The demo console: patient list with risk dots + split-pane thread.

    Each row carries the patient plus their real risk payload (or None when
    the patient has no cached risk), so the template can draw the dot and the
    threshold band server-side.
    """
    rows = []
    for p in DemoPatient.objects.all():
        risk = risk_for(p.hadm_id)
        band, band_label = band_for(risk)
        rows.append({
            'patient': p,
            'risk': risk,
            'band': band,
            'band_label': band_label,
            'probability': round(risk['probability'], 3) if risk else None,
        })
    return render(request, 'demo/console.html', {
        'rows': rows,
        'remaining': DemoQuota.remaining(request.user),
    })


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


@login_required
@require_POST
def ask(request):
    try:
        payload = json.loads(request.body)
    except ValueError:
        return JsonResponse({'error': 'Request body must be JSON.'}, status=400)

    if not isinstance(payload, dict):
        return JsonResponse({'error': 'Request body must be a JSON object.'}, status=400)

    # Fixture mode answers the starter chips from captured real payloads while
    # the Vertex endpoints are down. Same response shape as the live agent.
    if settings.DEMO_FIXTURE_MODE:
        result = fixture_ask(payload)
        if result.get('error'):
            status = 400 if result['error'] == 'bad_request' else 404
            return JsonResponse(result, status=status)
        result['remaining'] = DemoQuota.remaining(request.user)
        return JsonResponse(result)

    question, error = _question_for(payload)
    if error:
        return JsonResponse({'error': error}, status=400)

    # Claim the credit before spending anything. Checking the quota after the
    # call would let a burst of concurrent requests all pass the check and all
    # bill.
    if not DemoQuota.consume(request.user):
        return JsonResponse({
            'error': 'Daily demo limit reached.',
            'remaining': 0,
        }, status=429)

    try:
        result = ask_agent(question)
    except AgentError as exc:
        # The credit bought nothing, so give it back.
        DemoQuota.refund(request.user)
        return JsonResponse({
            'error': 'The clinical copilot is unavailable. Please try again.',
            'detail': str(exc),
            'remaining': DemoQuota.remaining(request.user),
        }, status=502)

    # The agent surfaces downstream (endpoint) failures as graceful tool error
    # payloads with HTTP 200 (e.g. predict_readmission -> {"error": ...} when
    # the Vertex endpoint is down). That is a failure for quota purposes too:
    # a credit was spent and no real answer came back, so refund + 502.
    if _tools_errored(result):
        DemoQuota.refund(request.user)
        return JsonResponse({
            'error': 'The clinical copilot is unavailable. Please try again.',
            'remaining': DemoQuota.remaining(request.user),
        }, status=502)

    result['remaining'] = DemoQuota.remaining(request.user)
    return JsonResponse(result)


# --------------------------------------------------------------------------- #
# A2UI — the same canvas, composed as A2UI messages and rendered by the
# vendored A2UI renderer. Fixture mode is the default (same real payloads as
# the custom demo); the live branch mirrors `ask` once the agent is deployed.
# --------------------------------------------------------------------------- #

@login_required
def a2ui_console(request):
    """The A2UI canvas demo: same enterprise shell + patient rail + thread as
    the custom demo, but the context canvas is composed as A2UI messages and
    rendered by the vendored A2UI renderer (agent-composed UI)."""
    rows = []
    for p in DemoPatient.objects.all():
        risk = risk_for(p.hadm_id)
        band, band_label = band_for(risk)
        rows.append({
            'patient': p,
            'risk': risk,
            'band': band,
            'band_label': band_label,
            'probability': round(risk['probability'], 3) if risk else None,
        })
    return render(request, 'demo/a2ui_console.html', {
        'rows': rows,
        'remaining': DemoQuota.remaining(request.user),
    })


def _tool_response(result, name):
    """The response payload for one named tool call, or None."""
    return next(
        (tc.get('response') for tc in result.get('tool_calls', [])
         if tc.get('name') == name),
        None)


def _rag_response(result):
    """The rag passages from either retrieval tool — the free-text
    `rag_search` or the deterministic `rag_search_sections` used for
    summaries — so the canvas source card is drawn for both paths."""
    for name in ('rag_search', 'rag_search_sections'):
        rag = _tool_response(result, name)
        if rag is not None:
            return rag
    return None


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
    """Run a risk assessment and return the composed A2UI canvas messages.

    Mirrors the custom `ask` view: fixture mode answers the starter chips from
    captured payloads; live mode runs the real agent (quota, refund on
    failure). The canvas is then composed from whichever branch produced the
    tool calls — the same `compose_risk_canvas(predict, rag)` in both.
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
        # and all bill.
        if not DemoQuota.consume(request.user):
            return JsonResponse({
                'error': 'Daily demo limit reached.',
                'remaining': 0,
            }, status=429)

        try:
            result = ask_agent(question)
        except AgentError as exc:
            # The credit bought nothing, so give it back.
            DemoQuota.refund(request.user)
            return JsonResponse({
                'error': 'The clinical copilot is unavailable. Please try again.',
                'detail': str(exc),
                'remaining': DemoQuota.remaining(request.user),
            }, status=502)

        # Downstream (endpoint) failures surface as graceful tool error
        # payloads with HTTP 200 — refund + 502 so a credit is never silently
        # consumed for an answer that never materialized.
        if _tools_errored(result):
            DemoQuota.refund(request.user)
            return JsonResponse({
                'error': 'The clinical copilot is unavailable. Please try again.',
                'remaining': DemoQuota.remaining(request.user),
            }, status=502)

    # The SourceCard mirrors the answer's own citation: whichever passage the
    # agent cited first is the one the canvas shows, so a meds answer that
    # cites the discharge_medications passage (^[3] in rag_search_sections
    # order) is composed against that passage, not always the first one.
    result['a2ui'] = compose_risk_canvas(
        _tool_response(result, 'predict_readmission'),
        _rag_response(result),
        cite=first_citation(result.get('answer') or ''))
    result['remaining'] = DemoQuota.remaining(request.user)
    return JsonResponse(result)
