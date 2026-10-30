"""SSE framing, the stream relay, and the refund policy that rides on it.

The relay is the one place in this application where a response is not a value but a
sequence of them, and three things have to stay true across that boundary:

  * a frame the browser can parse, in the encoding the agent already uses;
  * the credit rules, unchanged from the blocking path — a failure refunds, an answer
    reports what is left;
  * the terminal frame, whatever happens: a stream that ends without one leaves the
    reader watching a turn that will never finish.
"""

from __future__ import annotations

import json
import logging

from asgiref.sync import sync_to_async
from django.http import StreamingHttpResponse

from ..conversations import record_answer
from ..models import DemoQuota
from . import envelope
from .threads import record_turn

logger = logging.getLogger(__name__)

# The one message the browser shows when the copilot cannot answer. Internal
# detail is never returned to the client (S1-03); the trace id pairs this with
# the server-side log line instead.
UNAVAILABLE = 'The clinical copilot is unavailable. Please try again.'

# Marks "the agent's stream is finished" when advancing it by one step in a
# worker thread. A sentinel rather than catching StopIteration, because
# StopIteration cannot cross a Future's boundary.
_EXHAUSTED = object()


# The tools whose failure means the answer is not worth charging for.
#
# These read the patient's own record. If one of them fails, the answer that arrives
# is not the answer that was asked for, and spending a credit on it would be charging
# for nothing. `discharge_medications` and `get_lab_trends` are here for that reason:
# a medication or lab question is answered from them and nothing else, so their failure
# is the question going unanswered.
#
# The literature tool is deliberately NOT here. It is the only one that reaches
# outside the project, and no clinical question depends on it: an outside agency
# rate-limiting its own server must not deny a clinician the risk score and note
# summary they came for. It degrades instead — the agent is instructed to report the
# search as unavailable rather than as an absence, and the canvas says so beside the
# answer. `get_admission_profile` is not here either: it is a pre-flight read folded
# into the prompt, so its failure degrades the context rather than the answer.
CORE_TOOLS = frozenset({
    "predict_readmission",
    "rag_search",
    "rag_search_sections",
    "discharge_medications",
    "get_lab_trends",
})

#: Refusals the AGENT manufactures before a tool ever runs: the turn's tool budget is
#: spent, or the same call was already made with the same arguments. They arrive in the
#: same `{"error": ...}` shape a broken tool uses, and the difference matters — a
#: refusal means the tool was never called, so nothing about the downstream is broken.
#:
#: Treating them as outages deleted a correct answer on 2026-10-17: the agent answered an
#: administrative question from the pre-flight manifest, then spent its remaining budget
#: on searches it did not need, and the BFF answered "the clinical copilot is
#: unavailable" over the top of a right answer.
POLICY_REFUSALS = frozenset({
    "tool_call_limit",
    "repeated_tool_call",
    # The agent refusing its own tool call because the model reached for an
    # admission this turn is not about, or put an identifier into a literature
    # search. Both are the boundary working, and both look like a `rag_search`
    # error to anything reading the payload alone.
    "patient_scope_refused",
    "patient_identifier_refused",
    # The agent refusing a call the model declared arguments for that the tool
    # does not accept. Nothing downstream was contacted, so nothing can be broken:
    # the agent caught a malformed call at its own boundary and said so.
    "undeclared_argument_refused",
})


def tools_errored(result) -> bool:
    """True if any CORE tool the agent called returned an error payload.

    The MCP tools fail GRACEFULLY when a downstream (endpoint) dependency is
    down — they return {"error": ...} instead of raising, so the agent replies
    with HTTP 200. For a core tool that is still a failure for quota purposes (a
    credit was spent and no real answer came back), so the views refund + 502.

    A tool outside that set is not an outage. The literature tool degrades its own
    external failures and never returns one, so this is a second line rather than
    the mechanism — but a rule kept in step with every new tool by hand is one that
    drifts, and the failure it would cause is an unnecessary outage page shown to
    somebody asking about a patient.

    `POLICY_REFUSALS` are excluded for the same reason: they are the agent's own
    bookkeeping, not a dependency failing.
    """
    for call in (result.get("tool_calls") or []):
        code = (call.get("response") or {}).get("error")
        if code and code not in POLICY_REFUSALS and call.get("name") in CORE_TOOLS:
            return True
    return False


def _sse(event, data) -> bytes:
    """One server-sent event, in the same encoding the agent uses.

    Encoded to bytes here rather than left as text: the streaming response
    carries bytes on the wire, and being explicit avoids relying on Django to
    encode each frame for us.
    """
    return f'event: {event}\ndata: {json.dumps(data)}\n\n'.encode('utf-8')


class StreamedResponse(StreamingHttpResponse):
    """A frame stream that streams under either of Django's handlers.

    Django chooses how to iterate a `StreamingHttpResponse` from the iterator's
    own type, and then materialises the kind it did not ask for: the WSGI
    handler drains an ASYNC iterator into a list before it sends anything
    (`__iter__` wraps it in `async_to_sync(to_list)`), and the ASGI handler does
    the same to a SYNC one (`__aiter__` wraps it in `sync_to_async(list)`).
    This app is served both ways — `runserver` is WSGI by default and the
    deployed uvicorn service is ASGI — so a response built around one kind
    streams in exactly one environment and buffers in the other.

    Keeping one kind and overruling the handler that would have buffered it is
    the whole reason this class exists. `stream_frames` is synchronous, because
    the frames come from a blocking `requests` stream and because a synchronous
    iterator is what WSGI already flushes frame by frame. Overriding `__aiter__`
    to advance that same iterator one step at a time gives the ASGI handler what
    its own implementation would have thrown away, without a second generator to
    keep in step with the first.

    Measured live before this: the local server delivered an entire turn as a
    single 34KB chunk after 16.2s. Every stage frame was present and none of them
    were early, so the console's progress label never moved off "Sending the
    question" — indistinguishable from not streaming at all.
    """

    async def __aiter__(self):
        # `_set_streaming_content` has already taken `iter(value)`, so
        # `self._iterator` is the synchronous generator itself. Each step is
        # advanced in a worker thread rather than on the event loop, because
        # reading the next frame blocks on the agent's socket.
        try:
            while True:
                item = await sync_to_async(next)(self._iterator, _EXHAUSTED)
                if item is _EXHAUSTED:
                    return
                yield self.make_bytes(item)
        finally:
            # The browser can go away mid-answer, and the ASGI handler closes
            # this generator with `aclosing()` when it does. `_set_streaming_content`
            # only files a closer for objects that have `close`, and an async
            # generator has `aclose` instead, so the synchronous generator
            # underneath would otherwise be left open with its `finally` never
            # reached — which is where the upstream stream, and the agent slot
            # it holds, are released.
            self._iterator.close()


def stream_frames(
    user, trace, period, first, rest, conversation=None, asked='',
):
    """Relay the agent's frames to the browser, then close.

    SYNCHRONOUS on purpose, and this is a correctness requirement rather than a
    style choice: `StreamedResponse` documents what each of Django's handlers
    does to an iterator of the other kind, and why this generator is written the
    way its source is read. The frames come from a blocking `requests` stream,
    and the quota and turn-write calls below are ordinary synchronous database
    work, which a synchronous generator running on the WSGI handler's own thread
    can do directly.

    Quota policy is unchanged from the blocking path — it has only moved to
    where the answer now arrives. A tool error or a stream failure refunds the
    credit; an answer reports what is left. `remaining` rides on the terminal
    frame because it cannot be known before the answer exists.

    The error frame keeps the same shape as the blocking path's 502 body —
    `error` holds the user-facing message, plus `remaining` — so the browser
    renders a streamed failure and a blocking failure identically.

    `asked` is the console's own heading for the turn, carried through to the
    store. It is a parameter of this generator because the generator is where the
    turn is written, and the caller is where the heading is known.
    """
    pending = first
    try:
        while True:
            if pending is not None:
                item, pending = pending, None
            else:
                item = next(rest, _EXHAUSTED)
                if item is _EXHAUSTED:
                    break
            event, data = item

            if event == 'answer':
                # A downstream (endpoint) failure returns a graceful tool error
                # payload inside an otherwise good answer — refund so a credit
                # is never silently consumed for an answer that never
                # materialised.
                if tools_errored(data):
                    logger.error('a2ui_ask: tool error in streamed answer trace=%s', trace or '-')
                    DemoQuota.refund(user, period, trace=trace)
                    yield _sse('error', {
                        'error': UNAVAILABLE,
                        'remaining': DemoQuota.remaining(user),
                    })
                    return
                # The presentation contract is composed in the AGENT; Django
                # adds only the web-specific quota figure, counts the turn now
                # that an answer exists, and stores it so the next question can
                # be answered as a follow-up.
                record_turn(conversation)
                record_answer(conversation, data, asked)
                # The same builder the blocking path uses, so the two cannot
                # disagree about which keys an answer carries.
                yield _sse('answer', envelope.for_client(
                    data,
                    remaining=DemoQuota.remaining(user),
                    conversation=conversation,
                ))
                return

            if event == 'error':
                logger.error('a2ui_ask: stream failed mid-answer trace=%s: %s', trace or '-', data)
                DemoQuota.refund(user, period, trace=trace)
                yield _sse('error', {
                    'error': UNAVAILABLE,
                    'remaining': DemoQuota.remaining(user),
                })
                return

            yield _sse(event, data)

        # `ask_stream` guarantees a terminal frame, so this is unreachable. If
        # it ever becomes reachable, the credit comes back rather than staying
        # spent on an answer that never arrived, and the browser is told rather
        # than left on its pending turn.
        DemoQuota.refund(user, period, trace=trace)
        yield _sse('error', {
            'error': UNAVAILABLE,
            'remaining': DemoQuota.remaining(user),
        })
    finally:
        # Reached when the caller goes away (uvicorn closes the generator) as
        # well as on every normal exit. Closing the upstream stream releases
        # the agent slot and drops the connection to the agent, instead of
        # reading it to the end for an answer nobody will see.
        rest.close()
