"""How the reader rated a turn: telemetry, and deliberately nothing more.

There is no table behind this and no migration with it: the event is written to the log
stream where the rest of a request's trace already goes, and the rating is attached to
the Langfuse trace behind the answer, which is where a review of "answers a clinician
rated badly" actually happens. A table here would mean a schema this phase does not need
and a second home for one event.
"""

from __future__ import annotations

import json
import logging

from django.contrib.auth.decorators import login_required
from django.http import HttpResponse
from django.views.decorators.http import require_POST

from .. import langfuse_scores
from ..models import Turn

logger = logging.getLogger('demo.views')
# The logger name is the one this endpoint has always logged under, and it is kept
# deliberately. Moving the code to a package would have moved the records to
# `demo.ask.telemetry`, which is a different node in the log hierarchy: nothing that
# filters on `demo.views` — an operator's query, or the suite's own `assertLogs` — would
# see them any more. A refactor that silently renames a log stream is a behaviour change
# wearing a file move as a disguise.


@login_required
@require_POST
def feedback(request):
    """How the reader rated one turn. Telemetry, and deliberately nothing more.

    It never fails the reader. A malformed rating is logged and accepted, because the
    reader has already moved on and there is nothing they could do about a 400 on a
    thumbs-up. 204 either way, so the client has one case to handle rather than two.
    """
    try:
        body = json.loads(request.body or b'{}')
    except ValueError:
        body = {}
    if not isinstance(body, dict):
        body = {}

    turn_id = str(body.get('turn_id') or '')[:200]
    score = body.get('score')
    # `bool` is an `int` in Python, so an explicit exclusion: `True` is not a rating.
    if isinstance(score, bool) or not isinstance(score, int) or score not in (-1, 1):
        logger.info('a2ui feedback ignored turn=%s score=%r', turn_id or '-',
                    body.get('score'))
        return HttpResponse(status=204)

    logger.info('a2ui feedback turn=%s score=%+d at=%s', turn_id or '-', score,
                body.get('timestamp'))
    attach_score(turn_id, score, user=request.user)
    return HttpResponse(status=204)


def attach_score(turn_id, value, *, user=None):
    """Record the rating against the trace behind the turn, when there is one.

    `turn_id` is the stored answer row's own key — sent with the answer by
    `envelope.for_client` and again with every restored turn by `turn_payloads`. It is
    the only identity that survives a reload: until 2026-10-30 the console sent
    `"<conversation id>:<n>"` with `n` counted by `++turnOrdinal`, a page-local counter
    that restarts at 1 each load. The two numbers agree only while one page draws the
    conversation from its first answer, which is why production logged
    `turn=219:12 has no stored answer to score` and then `turn=219:1` for the same
    conversation four minutes later — one rating dropped, the next aimed at whichever
    answer came first.

    `user` scopes the lookup. A rating is telemetry and cannot fail the reader, but it
    can still be pointed at somebody else's turn by a hand-written request, and a score
    is written against that turn's trace in a shared project.

    Everything here is best-effort. A rating for a turn that was never stored has no
    trace to point at, and neither has one whose run was not traced, and an unconfigured
    Langfuse cannot record anything at all — which is said out loud below, because a
    feature that is switched off should not answer exactly like one that works.
    """
    try:
        pk = int(str(turn_id or '').strip())
    except (TypeError, ValueError):
        logger.info('a2ui feedback turn=%r names no stored turn', turn_id)
        return

    stored = Turn.objects.filter(pk=pk, role=Turn.Role.AGENT)
    if user is not None:
        stored = stored.filter(conversation__user=user)
    turn = stored.first()
    if turn is None:
        logger.info('a2ui feedback turn=%s is not a stored answer', turn_id)
        return
    if not turn.langfuse_trace_id:
        logger.info('a2ui feedback turn=%s was not traced', turn_id)
        return
    if langfuse_scores.score(turn.langfuse_trace_id, value):
        logger.info('a2ui feedback turn=%s attached to trace %s', turn_id,
                    turn.langfuse_trace_id)
    else:
        logger.warning('a2ui feedback turn=%s could not be attached to its trace %s',
                       turn_id, turn.langfuse_trace_id)
