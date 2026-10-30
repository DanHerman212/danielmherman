"""Which conversation a turn belongs to, and what it costs.

The policy, in one place, because every rule here has to be decided before a credit is
spent and none of them can be decided anywhere else:

  * a conversation is pinned to the patient it opened with;
  * one thread per patient — asking about the same patient twice continues one thread,
    and a browser that has lost its place must not open a second;
  * a thread past its retention window is refused even if the sweep has not reached it;
  * a thread whose turns are spent is refused rather than quietly replaced;
  * a conversation belonging to somebody else is reported exactly as one that does not
    exist, because the difference is not the caller's business.
"""

from __future__ import annotations

from django.http import JsonResponse
from django.utils import timezone
from django.db.models import F

from ..models import Conversation

# What a caller is told when a conversation has spent its turns. It names the way
# forward rather than only the refusal: the ceiling exists to bound what one
# credit buys, not to end the conversation for the user.
CONVERSATION_FULL = (
    'This conversation has reached its turn limit. Start a new conversation to '
    'keep asking about this patient.'
)


def resolve_conversation(request, payload, hadm_id):
    """The conversation this request continues, or the one it opens.

    Returns `(conversation, opening, error)`. `conversation` is None for a turn
    that belongs to no conversation at all: a question asked with no admission
    has no patient to pin, and every conversation is about exactly one patient.

    The rules are the layer's, in one place: a conversation is pinned to the
    patient it opened with, it is refused once it has passed its retention window
    even if the sweep has not reached it yet, and it is refused once its turns
    are spent. A conversation that belongs to somebody else is reported exactly
    as one that does not exist, because the difference is not the caller's
    business.

    One thread per patient (UX ruling 2026-10-14). A question about a patient
    whose thread is still live continues that thread whether or not the browser
    named it: asking about the same patient twice is not two conversations, and a
    browser that has lost its place — a new tab, a cleared store, a reload after
    the id was swept — must not open a second one beside the first. The lookup is
    what makes the id an optimisation rather than the thing that decides.

    A full thread is returned rather than skipped, so the ceiling refuses the turn
    with its own message instead of silently starting a second thread that would
    spend the credit the ceiling exists to bound.
    """
    raw = payload.get('conversation_id')
    if raw is None:
        if hadm_id is None:
            return None, False, None
        conversation, created = thread_for(request, hadm_id)
        # `created` rather than `True`: this branch continues an existing thread
        # whenever the patient has one, and only opening a thread spends a credit.
        # The id is an optimisation on top of this, not the thing that decides.
        return conversation, created, None

    try:
        pk = int(raw)
    except (TypeError, ValueError):
        return None, False, JsonResponse(
            {'error': 'conversation_id must be an integer.'}, status=400)

    conversation = Conversation.objects.filter(pk=pk, user=request.user).first()
    if conversation is None:
        return None, False, JsonResponse({
            'error': 'unknown_conversation',
            'message': 'That conversation does not exist. Start a new one.',
        }, status=404)
    if conversation.is_expired:
        # Belt as well as braces: the sweep is the thing that removes expired
        # conversations, and this is the check that makes the retention promise
        # hold for a request that arrives before the next sweep runs.
        return None, False, JsonResponse({
            'error': 'conversation_expired',
            'message': 'That conversation has expired. Start a new one.',
        }, status=409)
    if hadm_id is not None and conversation.patient_id != hadm_id:
        return None, False, JsonResponse({
            'error': 'conversation_patient_mismatch',
            'message': 'That conversation is about another patient. Start a new '
                       'one.',
        }, status=409)
    if not conversation.has_capacity:
        return None, False, JsonResponse({
            'error': 'conversation_full',
            'message': CONVERSATION_FULL,
        }, status=409)
    return conversation, False, None


def thread_for(request, hadm_id):
    """This account's live thread with this patient, and whether it is a new one.

    The one place a conversation is created by the ask path, so the one-thread-per-
    patient rule has a single implementation rather than one per caller. Any *live*
    thread with this patient is reused, full or not — see `resolve_conversation`
    for why a full one is returned instead of passed over.

    The flag matters as much as the thread: only opening a thread spends a credit,
    and a question that continues one is already paid for.

    A patient with no live thread has none because the thread expired rather than
    because it was deleted, so the new one inherits nothing either way.
    """
    existing = (
        Conversation.objects
        .filter(user=request.user, patient_id=hadm_id,
                expires_at__gt=timezone.now())
        .order_by('-created_at')
        .first()
    )
    if existing is not None:
        return existing, False
    return Conversation.objects.create(user=request.user, patient_id=hadm_id), True


def record_turn(conversation):
    """Count a turn that produced an answer.

    Only a turn that produced an answer counts, which is what makes the ceiling
    a limit on answers rather than on attempts: a failed first turn keeps its
    credit and its place, and the retry is the first successful turn.
    """
    if conversation is None:
        return
    Conversation.objects.filter(pk=conversation.pk).update(
        turn_count=F('turn_count') + 1, last_turn_at=timezone.now()
    )
