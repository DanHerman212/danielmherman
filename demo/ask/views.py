"""The ask endpoint: one question in, one answer out, by either transport.

This module orchestrates and nothing else. Validation is `intent`, the conversation and
the credit are `threads`, the envelope is `envelope`, and the streaming transport is
`relay`; what is left here is the order the five happen in, which is the only thing that
was ever a decision rather than a rule.

Both routes exist because the browser chooses: `Accept: text/event-stream` gets the
chain's progress stages while it works and the answer last, and anything else gets the
single JSON object this endpoint has always returned.
"""

from __future__ import annotations

import json
import logging

from django.conf import settings
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.views.decorators.http import require_POST

from ..agent_client import (
    AgentError,
    AgentRefused,
    trace_id,
)
from ..conversations import record_answer
from ..fixtures import fixture_ask
from ..models import DemoQuota
from . import envelope, intent, runtime
from .relay import (
    UNAVAILABLE,
    StreamedResponse,
    stream_frames,
    tools_errored,
)
from .threads import record_turn, resolve_conversation

logger = logging.getLogger(__name__)


@login_required
@require_POST
def a2ui_ask(request):
    """Proxy one question to the agent and return its presentation contract.

    Fixture mode answers the starter chips from captured payloads; live mode
    runs the real agent (quota, refund on failure). Either way the response
    arrives with the canvas and citation metadata already composed.

    Live mode has two shapes, chosen by what the caller asks for. With
    `Accept: text/event-stream` the chain's progress stages are relayed while
    it works and the answer arrives last; without it the response is the single
    JSON object it has always been. The browser decides, so a caller that does
    not want progress is unaffected.
    """
    try:
        payload = json.loads(request.body)
    except ValueError:
        return JsonResponse({'error': 'Request body must be JSON.'}, status=400)

    if not isinstance(payload, dict):
        return JsonResponse({'error': 'Request body must be a JSON object.'}, status=400)

    # Refuse unknown fields before anything else, including before the fixture
    # branch, so neither mode can answer a request whose extra fields it would
    # have dropped in silence.
    unsupported = intent.unsupported_field_error(payload)
    if unsupported:
        return JsonResponse({'error': unsupported}, status=400)

    # Fixture mode answers the starter chips from real captured payloads (same
    # response shape as the live agent /ask). Passing the payload straight
    # through means free text / unknown chips get the clear "use the live
    # agent" message, never a confusing hadm_id error (screen-guide §4.1).
    if settings.DEMO_FIXTURE_MODE:
        result = fixture_ask(payload)
        if result.get('error'):
            status = 400 if result['error'] == 'bad_request' else 404
            return JsonResponse(result, status=status)
        # Captured payloads answer instantly: no chain runs, so there is
        # nothing to narrate and nothing worth streaming.
        result['remaining'] = DemoQuota.remaining(request.user)
        return JsonResponse(result)

    built, error = intent.intent_for(payload)
    if error:
        return JsonResponse({'error': error}, status=400)

    asked = intent.asked_from(payload)

    conversation, opening, error = resolve_conversation(
        request, payload, built.get('hadm_id'))
    if error is not None:
        return error

    # Claim a credit before spending anything — but only when this request opens
    # a conversation, or stands alone. A follow-up inside a conversation is
    # already paid for; the ceiling is what bounds it. Checking the quota after
    # the call would let a burst of concurrent requests all pass the check and
    # all bill. `period` is the claim token a refund must present, and it stays
    # None when no credit was claimed, which is what makes the refund path below
    # a no-op rather than a second wrong debit.
    if conversation is None or opening:
        period = DemoQuota.consume(request.user)
        if not period:
            return JsonResponse({
                'error': 'Daily demo limit reached.',
                'remaining': 0,
            }, status=429)
    else:
        period = None

    trace = trace_id(request)
    intent.with_replay(built, conversation)
    if 'text/event-stream' in request.headers.get('Accept', ''):
        return _streaming_ask(
            request, built, trace, period, conversation, asked,
            # Strict identity rather than truthiness: a caller sending the string
            # `"true"` has got the type wrong, and answering that by turning prose
            # streaming on is a guess about what it meant.
            prose_stream=payload.get('stream_prose') is True,
            # Strict identity here too: this one buys a model call per turn, so a
            # caller sending the string "true" gets nothing rather than a guess.
            follow_ups=payload.get('follow_ups') is True,
        )

    # Read through the app namespace, because that is the binding the frozen suite
    # patches; see `runtime`.
    ask_agent = runtime.collaborator('ask_agent')

    try:
        result = ask_agent(built, trace=trace)
    except AgentRefused as exc:
        # The agent declined the request as it stands, before running anything.
        # Its message is the guidance the clinician needs ("Please include a
        # clinical topic to search"), so it is relayed rather than replaced, and
        # the credit is given back freely because nothing was dispatched.
        logger.info(
            'a2ui_ask: agent refused trace=%s code=%s', trace or '-', exc.code
        )
        DemoQuota.refund(request.user, period, spent=exc.spent, trace=trace)
        return JsonResponse({
            'error': exc.message,
            'remaining': DemoQuota.remaining(request.user),
        }, status=400)
    except AgentError as exc:
        # Give the credit back — freely if provably nothing was billed,
        # under the daily refund cap otherwise (S1-09). Exception detail
        # is logged server-side, never returned to the client (S1-03).
        # The trace id pairs this line with the agent's own log entry.
        logger.error(
            'a2ui_ask: agent call failed trace=%s: %s', trace or '-', exc
        )
        DemoQuota.refund(request.user, period, spent=exc.spent, trace=trace)
        return JsonResponse({
            'error': UNAVAILABLE,
            'remaining': DemoQuota.remaining(request.user),
        }, status=502)

    # Downstream (endpoint) failures surface as graceful tool error
    # payloads with HTTP 200 — refund + 502 so a credit is never silently
    # consumed for an answer that never materialized.
    if tools_errored(result):
        DemoQuota.refund(request.user, period, trace=trace)
        return JsonResponse({
            'error': UNAVAILABLE,
            'remaining': DemoQuota.remaining(request.user),
        }, status=502)

    # The presentation contract (renumbered answer, resolved sources, a2ui)
    # is composed in the AGENT — the layer where the guardrails ran and the
    # tool evidence is visible. Django is a pass-through for it; the envelope
    # builder adds the three facts only this side knows.
    record_turn(conversation)
    # The stored row is the identity a rating names, so the envelope carries its key.
    stored_turn = record_answer(conversation, result, asked)
    return JsonResponse(envelope.for_client(
        result,
        remaining=DemoQuota.remaining(request.user),
        conversation=conversation,
        turn=stored_turn,
    ))


def _streaming_ask(request, intent_body, trace, period, conversation=None, asked='',
                   prose_stream=False, follow_ups=False):
    """Start a streamed answer, or fail the way the blocking path fails.

    The first frame is pulled here, before the response is committed to being a
    stream. A failure before any frame — no identity token, refused connection,
    an agent 502 — can still be an ordinary status code, which keeps the
    browser's existing error path and the refund rule exactly as they are. Only
    once a frame exists does the response become a stream, and from that point
    failures arrive as a terminal error frame instead.

    `prose_stream` asks the agent to announce the answer's prose as it is written
    (`answer_delta`), and to say when what was announced did not survive into the
    settled answer (`prose_settled`). It is set only when the browser asked for it,
    because both frames reach the browser unaltered. The blocking path never sets
    it: a single JSON response has nothing to stream into.
    """
    stream = None
    try:
        # Both statements are inside the guard on purpose: `ask_stream` is a
        # generator today, so a failure surfaces on the first `next()`, but
        # nothing enforces that, and a raise from the call itself would
        # otherwise escape the view as a 500.
        # Both flags are merged here rather than folded into the intent upstream,
        # because neither is intent: they are what this page asked to be shown, and
        # the agent treats them as capabilities rather than as part of the question.
        requested = dict(intent_body)
        if prose_stream:
            requested['stream_prose'] = True
        if follow_ups:
            requested['follow_ups'] = True
        # Read through the app namespace, because that is the binding the frozen
        # suite patches; see `runtime`.
        stream = runtime.collaborator('ask_agent_stream')(requested, trace=trace)
        first = next(stream, None)
    except AgentRefused as exc:
        # Same reasoning as the blocking path: the refusal is guidance rather
        # than a failure, and nothing was dispatched, so the credit is free.
        logger.info(
            'a2ui_ask: agent refused the stream before its first frame trace=%s code=%s',
            trace or '-', exc.code,
        )
        DemoQuota.refund(request.user, period, spent=exc.spent, trace=trace)
        return JsonResponse({
            'error': exc.message,
            'remaining': DemoQuota.remaining(request.user),
        }, status=400)
    except AgentError as exc:
        logger.error(
            'a2ui_ask: agent stream failed before its first frame trace=%s: %s',
            trace or '-', exc,
        )
        DemoQuota.refund(request.user, period, spent=exc.spent, trace=trace)
        return JsonResponse({
            'error': UNAVAILABLE,
            'remaining': DemoQuota.remaining(request.user),
        }, status=502)

    if first is None:
        # An agent that answers a stream request with no frames at all is
        # broken in a way nothing downstream can represent; treat it as a
        # failed call rather than opening a stream that will never carry an
        # answer.
        logger.error('a2ui_ask: agent stream produced no frames trace=%s', trace or '-')
        DemoQuota.refund(request.user, period, trace=trace)
        return JsonResponse({
            'error': UNAVAILABLE,
            'remaining': DemoQuota.remaining(request.user),
        }, status=502)

    # `StreamedResponse`, not `StreamingHttpResponse`: the stock class streams
    # under one of Django's handlers and buffers under the other, and this app is
    # served by both (see the class for what each handler does).
    response = StreamedResponse(
        stream_frames(request.user, trace, period, first, stream, conversation,
                      asked),
        content_type='text/event-stream',
    )
    response['Cache-Control'] = 'no-cache, no-transform'
    # An explicit "do not buffer this" for any proxy in front. Without it the
    # whole stream can arrive at once when the response ends, which looks
    # exactly like no streaming at all.
    response['X-Accel-Buffering'] = 'no'
    return response
