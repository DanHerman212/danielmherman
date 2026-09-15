"""The demo's endpoints: the A2UI console page and its ask proxy.

Both require a login. Accounts are issued, not self-registered — there is no
signup route anywhere in this app, by design.
"""

import json
import logging

from asgiref.sync import sync_to_async
from django.conf import settings
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse, StreamingHttpResponse
from django.shortcuts import render
from django.views.decorators.http import require_POST

from .agent_client import (
    AgentError,
    ask as ask_agent,
    ask_stream as ask_agent_stream,
    trace_id,
)
from .fixtures import CHIP_NAMES, fixture_ask
from .models import DemoPatient, DemoQuota

logger = logging.getLogger(__name__)

MAX_QUESTION_CHARS = 2000

# The one message the browser shows when the copilot cannot answer. Internal
# detail is never returned to the client (S1-03); the trace id pairs this with
# the server-side log line instead.
UNAVAILABLE = 'The clinical copilot is unavailable. Please try again.'

# Marks "the agent's stream is finished" when advancing it by one step in a
# worker thread. A sentinel rather than catching StopIteration, because
# StopIteration cannot cross a Future's boundary.
_EXHAUSTED = object()


def _intent_for(payload):
    """Turn the request body into what the agent is asked, or (None, error).

    Three ways in: a starter chip, a picked patient, or typed free text. The
    *wording* is no longer built here. The agent owns the prompt — half of it
    used to live in this repository, which meant a prompt change could ship
    without touching the chain — so this sends intent (a chip name, or the text)
    plus the admission, and the agent composes the question.

    What stays on this side is the validation that must happen before a credit is
    spent, and the one check only this side can make: the admission exists in the
    demo cohort, which is the authorization boundary (S1-09).
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
            if chip not in CHIP_NAMES:
                return None, 'unknown chip.'
            return {'chip': chip, 'hadm_id': hadm_id}, None
        # Free text sent alongside the selected patient: the agent embeds the
        # admission in the question so it can ground the answer.
        question = payload.get('question')
        if isinstance(question, str) and question.strip():
            q = question.strip()
            if len(q) > MAX_QUESTION_CHARS:
                return None, f'Question exceeds {MAX_QUESTION_CHARS} characters.'
            return {'question': q, 'hadm_id': hadm_id}, None
        # Patient selected, nothing asked: the agent has a default question for
        # exactly this case.
        return {'hadm_id': hadm_id}, None

    question = payload.get('question')
    if not isinstance(question, str) or not question.strip():
        return None, 'Provide either hadm_id or a non-empty question.'
    if len(question) > MAX_QUESTION_CHARS:
        return None, f'Question exceeds {MAX_QUESTION_CHARS} characters.'
    return {'question': question.strip()}, None


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


def _sse(event, data):
    """One server-sent event, in the same encoding the agent uses.

    Encoded to bytes here rather than left as text: the streaming response
    carries bytes on the wire, and being explicit avoids relying on Django to
    encode each frame for us.
    """
    return f'event: {event}\ndata: {json.dumps(data)}\n\n'.encode('utf-8')


async def _refund(user, period, spent=True):
    """Give the credit back, off the event loop.

    This generator runs in an async context, where Django refuses synchronous
    database access (`SynchronousOnlyOperation`) — so the quota calls have to
    hop to a worker thread rather than being called directly.
    """
    await sync_to_async(DemoQuota.refund)(user, period, spent=spent)


async def _remaining(user):
    """The quota left for this user, off the event loop (see `_refund`)."""
    return await sync_to_async(DemoQuota.remaining)(user)


async def _stream_frames(user, trace, period, first, rest):
    """Relay the agent's frames to the browser, then close.

    ASYNC on purpose, and this is not a style choice. A synchronous iterator
    works, but Django's ASGI handler consumes it with `sync_to_async(list)`
    (`StreamingHttpResponse.__aiter__`), which materializes the whole stream and
    sends every frame at the end. Measured live: every frame arrived at the same
    millisecond, which is indistinguishable from not streaming at all. An async
    iterator is consumed part by part, so each frame is flushed as it is
    produced.

    The frames themselves come from a blocking `requests` stream, so each step
    is advanced in a worker thread instead of on the event loop, and the quota
    calls hop threads for the same reason (see `_refund`).

    Quota policy is unchanged from the blocking path — it has only moved to
    where the answer now arrives. A tool error or a stream failure refunds the
    credit; an answer reports what is left. `remaining` rides on the terminal
    frame because it cannot be known before the answer exists.

    The error frame keeps the same shape as the blocking path's 502 body —
    `error` holds the user-facing message, plus `remaining` — so the browser
    renders a streamed failure and a blocking failure identically.
    """
    pending = first
    try:
        while True:
            if pending is not None:
                item, pending = pending, None
            else:
                item = await sync_to_async(next)(rest, _EXHAUSTED)
                if item is _EXHAUSTED:
                    break
            event, data = item

            if event == 'answer':
                # A downstream (endpoint) failure returns a graceful tool error
                # payload inside an otherwise good answer — refund so a credit
                # is never silently consumed for an answer that never
                # materialised.
                if _tools_errored(data):
                    logger.error('a2ui_ask: tool error in streamed answer trace=%s', trace or '-')
                    await _refund(user, period)
                    yield _sse('error', {
                        'error': UNAVAILABLE,
                        'remaining': await _remaining(user),
                    })
                    return
                # The presentation contract is composed in the AGENT; Django
                # adds only the web-specific quota figure.
                data['remaining'] = await _remaining(user)
                yield _sse('answer', data)
                return

            if event == 'error':
                logger.error('a2ui_ask: stream failed mid-answer trace=%s: %s', trace or '-', data)
                await _refund(user, period)
                yield _sse('error', {
                    'error': UNAVAILABLE,
                    'remaining': await _remaining(user),
                })
                return

            yield _sse(event, data)

        # `ask_stream` guarantees a terminal frame, so this is unreachable. If
        # it ever becomes reachable, the credit comes back rather than staying
        # spent on an answer that never arrived, and the browser is told rather
        # than left on its pending turn.
        await _refund(user, period)
        yield _sse('error', {
            'error': UNAVAILABLE,
            'remaining': await _remaining(user),
        })
    finally:
        # Reached when the caller goes away (uvicorn closes the generator) as
        # well as on every normal exit. Closing the upstream stream releases
        # the agent slot and drops the connection to the agent, instead of
        # reading it to the end for an answer nobody will see.
        rest.close()


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

    intent, error = _intent_for(payload)
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

    trace = trace_id(request)
    if 'text/event-stream' in request.headers.get('Accept', ''):
        return _streaming_ask(request, intent, trace, period)

    try:
        result = ask_agent(intent, trace=trace)
    except AgentError as exc:
        # Give the credit back — freely if provably nothing was billed,
        # under the daily refund cap otherwise (S1-09). Exception detail
        # is logged server-side, never returned to the client (S1-03).
        # The trace id pairs this line with the agent's own log entry.
        logger.error(
            'a2ui_ask: agent call failed trace=%s: %s', trace or '-', exc
        )
        DemoQuota.refund(request.user, period, spent=exc.spent)
        return JsonResponse({
            'error': UNAVAILABLE,
            'remaining': DemoQuota.remaining(request.user),
        }, status=502)

    # Downstream (endpoint) failures surface as graceful tool error
    # payloads with HTTP 200 — refund + 502 so a credit is never silently
    # consumed for an answer that never materialized.
    if _tools_errored(result):
        DemoQuota.refund(request.user, period)
        return JsonResponse({
            'error': UNAVAILABLE,
            'remaining': DemoQuota.remaining(request.user),
        }, status=502)

    # The presentation contract (renumbered answer, resolved sources, a2ui)
    # is composed in the AGENT — the layer where the guardrails ran and the
    # tool evidence is visible. Django is a pass-through for it; only the
    # web-specific `remaining` quota is added here.
    result['remaining'] = DemoQuota.remaining(request.user)
    return JsonResponse(result)


def _streaming_ask(request, intent, trace, period):
    """Start a streamed answer, or fail the way the blocking path fails.

    The first frame is pulled here, before the response is committed to being a
    stream. A failure before any frame — no identity token, refused connection,
    an agent 502 — can still be an ordinary status code, which keeps the
    browser's existing error path and the refund rule exactly as they are. Only
    once a frame exists does the response become a stream, and from that point
    failures arrive as a terminal error frame instead.
    """
    stream = None
    try:
        # Both statements are inside the guard on purpose: `ask_stream` is a
        # generator today, so a failure surfaces on the first `next()`, but
        # nothing enforces that, and a raise from the call itself would
        # otherwise escape the view as a 500.
        stream = ask_agent_stream(intent, trace=trace)
        first = next(stream, None)
    except AgentError as exc:
        logger.error(
            'a2ui_ask: agent stream failed before its first frame trace=%s: %s',
            trace or '-', exc,
        )
        DemoQuota.refund(request.user, period, spent=exc.spent)
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
        DemoQuota.refund(request.user, period)
        return JsonResponse({
            'error': UNAVAILABLE,
            'remaining': DemoQuota.remaining(request.user),
        }, status=502)

    response = StreamingHttpResponse(
        _stream_frames(request.user, trace, period, first, stream),
        content_type='text/event-stream',
    )
    response['Cache-Control'] = 'no-cache'
    # An explicit "do not buffer this" for any proxy in front. Without it the
    # whole stream can arrive at once when the response ends, which looks
    # exactly like no streaming at all.
    response['X-Accel-Buffering'] = 'no'
    return response
