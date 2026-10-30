"""Recall: the sidebar's list, a thread restored, and the two things a reader may do to it.

The store has always held the turns. What it could not do until Phase 3 of the UX work
is hand them back as the console draws them; `turn_payloads` is the one shape for that,
so a restored thread and a live one are rendered by the same code. This module is the
HTTP surface over that: list, detail, pin, delete, and the `@` selector's lookup.
"""

from __future__ import annotations

import json

from django.conf import settings
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_POST

from ..conversations import turn_payloads
from ..models import Conversation, DemoPatient, Turn

# How many conversations the History list offers. The retention window bounds it
# in practice; the cap is here so a demo account that has been used heavily does
# not answer a page load with an unbounded list.
HISTORY_LIMIT = 50

# The `@` selector. One character matches most of the cohort, so the lookup waits
# for a second; the cap keeps the payload small enough to read at a glance.
MIN_PATIENT_QUERY_CHARS = 2
PATIENT_LOOKUP_LIMIT = 5


@login_required
def patient_autocomplete(request):
    """The `@` selector's lookup: patients whose name contains what was typed.

    Behind a login like the rest of the application. The cohort is the demo's
    whole patient list, so an open endpoint here would publish it; when the
    anonymous path exists it can decide for itself what a visitor sees.

    A lookup rather than the cohort rendered into the page: that would ship every
    patient on every load whether or not anyone types an `@`, and would have to be
    re-shipped whenever the cohort changes.
    """
    query = request.GET.get('q', '').strip()
    if len(query) < MIN_PATIENT_QUERY_CHARS:
        return JsonResponse({'results': []})

    patients = DemoPatient.objects.filter(
        display_name__icontains=query
    ).order_by('display_name')[:PATIENT_LOOKUP_LIMIT]

    return JsonResponse({'results': [
        {
            'hadm_id': p.hadm_id,
            'display_name': p.display_name,
            # Built from the fields rather than read from `summary`, so the
            # dropdown's format is this line's decision and not the data's.
            'meta': f'{p.age}{p.sex}',
        }
        for p in patients
    ]})


def _conversation_payload(conversation):
    """One conversation, as the console hydrates it."""
    return {
        'conversation_id': conversation.pk,
        'hadm_id': conversation.patient_id,
        'patient': conversation.patient.display_name,
        'pinned': conversation.pinned,
        'turns': turn_payloads(conversation),
        'ceiling': settings.DEMO_CONVERSATION_TURN_CEILING,
        # When the window closes, so the console can say when a thread will end
        # rather than letting one disappear without notice.
        'expires_at': conversation.expires_at.isoformat(),
    }


def _history_entry(conversation):
    """One row of the sidebar: the thread's name, and what it takes to open it.

    Deliberately thin. The row is a single line carrying a patient's name and
    nothing else, so the payload carries the name and the id and nothing the row
    would have to be talked out of drawing — a first question, a turn count and a
    date were all here, and all three are things a reader scanning for a patient
    does not want.

    A thread carries no name of its own. `Conversation.title` and the rename
    endpoint that wrote to it were removed rather than left waiting for a surface:
    the row is the patient's name in every state, including when a pin has lifted
    it to the top of the list, so a second name had nowhere to appear. A stored
    field nothing reads is a capability the system does not have and a reader
    cannot tell is missing.
    """
    return {
        'conversation_id': conversation.pk,
        'hadm_id': conversation.patient_id,
        'patient': conversation.patient.display_name,
        'pinned': conversation.pinned,
    }


@login_required
def conversation_detail(request, pk):
    """A stored conversation, as the blocks the console renders.

    Scoped to the account that owns it. A thread is clinical text with a patient
    pinned to it, so an id is not a capability: another account's conversation is
    answered as absent rather than as forbidden, because "this exists but is not
    yours" is itself a fact about somebody else's activity.
    """
    conversation = (
        Conversation.objects
        .filter(pk=pk, user=request.user)
        .select_related('patient')
        .prefetch_related('turns')
        .first()
    )
    if conversation is None:
        return JsonResponse({'error': 'No such conversation.'}, status=404)
    return JsonResponse(_conversation_payload(conversation))


@login_required
def conversation_history(request):
    """The account's live conversations, most recently used first.

    Expired threads are excluded rather than shown greyed out: a list that offers
    a conversation the sweep is about to delete is an offer the system cannot keep.

    `q` matches the patient's name, the admission, or the text of the questions and
    answers in the thread. It is applied here rather than in the query because it
    spans a related table, and the list is bounded by the retention window at demo
    scale — if this ever needs to be fast it needs an index, not a different
    contract at this endpoint.
    """
    conversations = list(
        Conversation.objects
        .filter(user=request.user, expires_at__gt=timezone.now())
        .select_related('patient')
        # Pinned first, then most recently used. A pinned thread is a deliberate
        # "keep this where I can see it", so it outranks recency; within each
        # group the ordering is the same.
        .order_by('-pinned', '-last_turn_at', '-created_at')[:HISTORY_LIMIT]
    )
    entries = [_history_entry(conversation) for conversation in conversations]

    needle = (request.GET.get('q') or '').strip().lower()
    if needle:
        text_by_conversation = {}
        for conv_id, question, answer in Turn.objects.filter(
            conversation__in=[c.pk for c in conversations]
        ).values_list('conversation_id', 'question', 'answer'):
            text_by_conversation.setdefault(conv_id, []).append(
                f'{question or ""} {answer or ""}'
            )

        def matches(entry):
            haystack = ' '.join((
                entry['patient'], str(entry['hadm_id']),
                ' '.join(text_by_conversation.get(entry['conversation_id'], [])),
            )).lower()
            return needle in haystack

        entries = [entry for entry in entries if matches(entry)]

    return JsonResponse({'conversations': entries})


def _owned(request, pk):
    """This account's conversation, or None.

    One reader for the two management endpoints below, so they cannot disagree
    about who may touch a thread. An id belonging to somebody else is None here
    and a 404 at the caller, which is the same answer the detail endpoint gives
    and for the same reason: "it exists but is not yours" is a fact about another
    account's activity.
    """
    return Conversation.objects.filter(pk=pk, user=request.user).first()


def _managed(request, pk):
    """The thread a management call is about, or the error to answer with.

    PUT rather than PATCH semantics: each of these sends the whole of the one
    field it owns, so a repeated request is the same request rather than a second
    change applied on top of the first.
    """
    conversation = _owned(request, pk)
    if conversation is None:
        return None, JsonResponse({'error': 'No such conversation.'}, status=404)
    try:
        body = json.loads(request.body or b'{}')
    except (TypeError, ValueError):
        return None, JsonResponse({'error': 'Body must be JSON.'}, status=400)
    if not isinstance(body, dict):
        return None, JsonResponse({'error': 'Body must be a JSON object.'},
                                  status=400)
    return (conversation, body), None


@login_required
@require_POST
def conversation_pin(request, pk):
    """Hold a thread at the top of the sidebar, or let it go."""
    parsed, error = _managed(request, pk)
    if error is not None:
        return error
    conversation, body = parsed

    pinned = body.get('pinned')
    if not isinstance(pinned, bool):
        return JsonResponse({'error': "'pinned' must be true or false."},
                            status=400)
    Conversation.objects.filter(pk=conversation.pk).update(pinned=pinned)
    conversation.pinned = pinned
    return JsonResponse(_history_entry(conversation))


@login_required
@require_POST
def conversation_delete(request, pk):
    """Delete a thread, now rather than at the end of its window.

    A real delete, not a hidden flag. The retention promise is that this store
    holds a conversation for seven days; a thread the clinician has deleted is one
    they expect gone, and a soft delete would leave clinical text in the database
    while the interface said otherwise.
    """
    conversation = _owned(request, pk)
    if conversation is None:
        return JsonResponse({'error': 'No such conversation.'}, status=404)
    conversation.delete()
    return JsonResponse({'deleted': pk})
