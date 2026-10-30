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
from ..models import Conversation, Turn

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
    attach_score(turn_id, score)
    return HttpResponse(status=204)


def attach_score(turn_id: str, value: int) -> None:
    """Record the rating against the trace behind the turn, when there is one.

    `turn_id` is `"<conversation id>:<n>"`, where `n` counts the turns the console has
    drawn for that conversation. It is deliberately NOT a row id: the console composes
    it and a turn is two rows. So the nth drawn turn is the nth stored AGENT row, in
    ordinal order — matched that way rather than by arithmetic, because `2 * n` would
    encode an implementation detail (a turn being a user row and an agent row) into a
    lookup that only needs to agree with what the reader saw.

    Everything here is best-effort. A rating for a turn that was never stored (the
    client sends `unsaved:1` when the conversation id had not arrived) has no trace to
    point at, and neither has one whose run was not traced at all.
    """
    conversation_ref, _, index = (turn_id or '').partition(':')
    if not (conversation_ref.isdigit() and index.isdigit()):
        return
    ordinal = int(index)
    if ordinal < 1:
        return

    conversation = Conversation.objects.filter(pk=int(conversation_ref)).first()
    if conversation is None:
        return
    answered = list(
        conversation.turns.filter(role=Turn.Role.AGENT).order_by('ordinal')
    )
    if ordinal > len(answered):
        logger.info('a2ui feedback turn=%s has no stored answer to score', turn_id)
        return
    turn = answered[ordinal - 1]
    if not turn.langfuse_trace_id:
        logger.info('a2ui feedback turn=%s was not traced', turn_id)
        return
    if langfuse_scores.score(turn.langfuse_trace_id, value):
        logger.info('a2ui feedback turn=%s attached to trace %s', turn_id,
                    turn.langfuse_trace_id)
