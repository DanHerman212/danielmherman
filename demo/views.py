"""The demo's two endpoints: a console page and an ask proxy.

Both require a login. Accounts are issued, not self-registered — there is no
signup route anywhere in this app, by design.
"""

import json

from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.shortcuts import render
from django.views.decorators.http import require_POST

from .agent_client import AgentError, ask as ask_agent
from .models import DemoPatient, DemoQuota

MAX_QUESTION_CHARS = 2000


@login_required
def console(request):
    """The patient picker. Section 17 replaces this template with the real UI."""
    return render(request, 'demo/console.html', {
        'patients': DemoPatient.objects.all(),
        'remaining': DemoQuota.remaining(request.user),
    })


def _question_for(payload):
    """Turn the request body into a question, or return (None, error).

    Two ways in: pick a patient from the cohort, or type a question. The picker
    sends an id and lets the server compose the wording, so the phrasing stays
    consistent across every demo and cannot be edited into a leading question.
    """
    hadm_id = payload.get('hadm_id')
    if hadm_id is not None:
        try:
            hadm_id = int(hadm_id)
        except (TypeError, ValueError):
            return None, 'hadm_id must be an integer.'
        if hadm_id <= 0:
            return None, 'hadm_id must be positive.'
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

    result['remaining'] = DemoQuota.remaining(request.user)
    return JsonResponse(result)
