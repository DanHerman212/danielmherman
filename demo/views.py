"""The demo's endpoints: the public front door, the A2UI console, its ask proxy,
and the `@` patient lookup.

The front door is public; everything else requires a login. Accounts are issued,
not self-registered — there is no signup route anywhere in this app, by design.
"""

import json
import logging

from asgiref.sync import sync_to_async
from django.conf import settings
from django.contrib.auth.decorators import login_required
from django.db.models import F
from django.http import HttpResponse, JsonResponse, StreamingHttpResponse
from django.shortcuts import render
from django.utils import timezone
from django.views.decorators.http import require_POST

from . import langfuse_scores
from .agent_client import (
    AgentError,
    AgentRefused,
    ask as ask_agent,
    ask_stream as ask_agent_stream,
    trace_id,
)
from .conversations import (
    MAX_ASKED_CHARS,
    record_answer,
    replay_turns,
    turn_payloads,
)
from .fixtures import CHIP_NAMES, SLASH_COMMANDS, fixture_ask
from .models import Conversation, DemoPatient, DemoQuota, Profile, Turn

logger = logging.getLogger(__name__)

MAX_QUESTION_CHARS = 2000

# How many conversations the History list offers. The retention window bounds it
# in practice; the cap is here so a demo account that has been used heavily does
# not answer a page load with an unbounded list.
HISTORY_LIMIT = 50

# The `@` selector. One character matches most of the cohort, so the lookup waits
# for a second; the cap keeps the payload small enough to read at a glance.
MIN_PATIENT_QUERY_CHARS = 2
PATIENT_LOOKUP_LIMIT = 5

# The fields a request may carry, mirroring the agent's closed contract
# (services/agent/contracts.py). An unknown field used to be ignored here, so a
# caller that sent a history received an answer that had silently dropped it —
# the failure the agent's own closure exists to prevent, sitting at the boundary
# a browser can actually reach. Refusing is what keeps a single-turn demo honest
# about being single-turn.
# `stream_prose` is the browser asking to be shown the answer as it is written, and it
# is opt-in here for the same reason it is on the agent: the `answer_delta` and
# `prose_settled` frames are relayed unaltered, so a client that draws a progress row
# per unrecognised event would print the answer as a log. The decision belongs to the
# layer that has to draw it, and a page loaded before this existed simply never asks.
# `follow_ups` is the browser asking for the next questions to be proposed under the
# answer. Opt-in for the same reason, and a sharper one: it costs a model call on every
# turn, and a caller that does not draw the rows should not pay for them.
APPROVED_REQUEST_FIELDS = frozenset(
    {'question', 'hadm_id', 'chip', 'conversation_id', 'asked', 'stream_prose',
     'follow_ups', 'intent'}
)

# Names a caller reaches for when it expects the copilot to remember the
# conversation. Only `turns` does anything — it is the site's own replay of the
# thread, and it is the one name the agent accepts. The rest are refused with that
# reason rather than left to be inferred from an answer that quietly lost its
# context. `conversation_id` is deliberately absent: it is the browser's handle on
# the stored thread, resolved here, and never forwarded.
CONVERSATION_FIELDS = frozenset(
    {'history', 'messages', 'session_id', 'context', 'turns'}
)


def _unsupported_field_error(payload):
    """The message to refuse a payload with, or None when it is acceptable.

    The same two-wording shape the agent uses, so the two boundaries explain the
    refusal in the same terms: a conversation field is refused as a product
    decision made visible, and any other unknown field is refused by naming what
    the endpoint does accept.
    """
    unknown = sorted(set(payload) - APPROVED_REQUEST_FIELDS)
    if not unknown:
        return None
    named = ', '.join(f"'{name}'" for name in unknown)
    if CONVERSATION_FIELDS.intersection(unknown):
        return (f'Unsupported field(s): {named}. This demonstration is '
                'single-turn, so a conversation field is refused rather than '
                'silently ignored.')
    return (f'Unsupported field(s): {named}. Send a question, or a chip with an '
            'admission.')

# The one message the browser shows when the copilot cannot answer. Internal
# detail is never returned to the client (S1-03); the trace id pairs this with
# the server-side log line instead.
UNAVAILABLE = 'The clinical copilot is unavailable. Please try again.'

# Marks "the agent's stream is finished" when advancing it by one step in a
# worker thread. A sentinel rather than catching StopIteration, because
# StopIteration cannot cross a Future's boundary.
_EXHAUSTED = object()

# What a caller is told when a conversation has spent its turns. It names the way
# forward rather than only the refusal: the ceiling exists to bound what one
# credit buys, not to end the conversation for the user.
CONVERSATION_FULL = (
    'This conversation has reached its turn limit. Start a new conversation to '
    'keep asking about this patient.'
)


def _resolve_conversation(request, payload, hadm_id):
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
        conversation, created = _thread_for(request, hadm_id)
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


def _thread_for(request, hadm_id):
    """This account's live thread with this patient, and whether it is a new one.

    The one place a conversation is created by the ask path, so the one-thread-per-
    patient rule has a single implementation rather than one per caller. Any *live*
    thread with this patient is reused, full or not — see `_resolve_conversation`
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


def _record_turn(conversation):
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


def _with_replay(intent, conversation):
    """The intent plus the earlier turns of this conversation, if there is one.

    The agent holds nothing between requests (layer 8: it is stateless by
    requirement), so continuity is something the caller supplies. This is the
    caller: the site stores the turns and sends them back, which keeps the
    agent free of a store and keeps the browser from being one.

    Nothing is sent for a turn that stands alone — a question with no admission
    has no conversation and no earlier turns — or for the first turn of one.
    """
    turns = replay_turns(conversation)
    if turns:
        intent['turns'] = turns
    return intent


def _asked_from(payload):
    """The clinician's own words for this turn, as the console drew them.

    Sent by the console rather than derived here, because deriving it would mean
    this side knowing which command a request came from — and the command
    vocabulary is the agent's to own (`routing.py`). The console already knows
    what it put on screen; this side only bounds it.

    Absent is not an error. A caller that does not draw a heading — a script, a
    test — gets the composed question as its heading, which is what
    `record_answer` falls back to.
    """
    asked = payload.get('asked')
    if not isinstance(asked, str):
        return ''
    asked = ' '.join(asked.split())
    return asked[:MAX_ASKED_CHARS]


def _with_declaration(intent, declared):
    """Attach the intent a control declared, unread.

    A question's wording is for the reader; what kind of question it is has to be
    said separately, and the vocabulary for saying it belongs to the agent (it is
    the layer that acts on it). So this side carries the value across and nothing
    more: it does not decide which values exist, and a value it has never heard of
    is the agent's to refuse with its own message rather than a second opinion
    from here.
    """
    if declared:
        intent['intent'] = declared
    return intent


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

    A chip and text can arrive together. Which commands take the caller's words
    and which refuse them as a second intention is the agent's decision, not
    this side's: the command vocabulary lives in one place, and this proxy is a
    pass-through for intent rather than a second interpreter of it.

    `intent` is a third thing and travels beside the question rather than instead
    of it: a rendered control that asks its own question (a clicked risk driver)
    declares what kind of question it is, because the wording written for the
    reader cannot carry a machine meaning.
    """
    declared = payload.get('intent')
    if declared is not None:
        if not isinstance(declared, str) or not declared.strip():
            return None, 'intent must be a non-empty string.'
        declared = declared.strip()

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
            # Text beside a chip is forwarded rather than dropped. Which
            # commands take the caller's words — and which refuse text as a
            # second intention — is the agent's vocabulary to interpret, and it
            # is the only layer that knows it: `routing.py` is the single owner
            # of the command set. This side used to resolve it by keeping the
            # chip and discarding the text, which is how a clinician who typed a
            # topic got the previous answer back instead.
            question = payload.get('question')
            if isinstance(question, str) and question.strip():
                q = question.strip()
                if len(q) > MAX_QUESTION_CHARS:
                    return None, f'Question exceeds {MAX_QUESTION_CHARS} characters.'
                return _with_declaration(
                    {'chip': chip, 'hadm_id': hadm_id, 'question': q}, declared), None
            return _with_declaration(
                {'chip': chip, 'hadm_id': hadm_id}, declared), None
        # Free text sent alongside the selected patient: the agent embeds the
        # admission in the question so it can ground the answer.
        question = payload.get('question')
        if isinstance(question, str) and question.strip():
            q = question.strip()
            if len(q) > MAX_QUESTION_CHARS:
                return None, f'Question exceeds {MAX_QUESTION_CHARS} characters.'
            return _with_declaration({'question': q, 'hadm_id': hadm_id}, declared), None
        # Patient selected, nothing asked: the agent has a default question for
        # exactly this case.
        return _with_declaration({'hadm_id': hadm_id}, declared), None

    question = payload.get('question')
    if not isinstance(question, str) or not question.strip():
        return None, 'Provide either hadm_id or a non-empty question.'
    if len(question) > MAX_QUESTION_CHARS:
        return None, f'Question exceeds {MAX_QUESTION_CHARS} characters.'
    return _with_declaration({'question': question.strip()}, declared), None


# --------------------------------------------------------------------------- #
# A2UI — the canvas composed as A2UI messages by the AGENT and rendered by the
# vendored A2UI renderer. Fixture mode is the default (same real payloads); the
# live branch runs the real agent once the endpoint is deployed.
# --------------------------------------------------------------------------- #

def landing(request):
    """The public front door: the shell with no conversation behind it yet.

    Reachable without a login so the project page can link straight to it rather
    than dropping a visitor onto a sign-in form. The ask bar is deliberately
    inert — the anonymous path that would answer here is not built, and an input
    that appears to send is worse than one that plainly does not.
    """
    return render(request, 'demo/landing.html')


@login_required
def a2ui_console(request):
    """The application behind the front door: the shell for a signed-in account.

    No patient list is passed. The redesign moves patient selection into the ask
    bar as an `@` command, so handing the page every patient would be the legacy
    rail rebuilt rather than a step away from it."""
    return render(request, 'demo/a2ui_console.html', {
        # Who the shell is showing. `Profile` is where a social sign-in will
        # write a name and a picture; today it falls back to the account's own.
        'profile': Profile.for_user(request.user),
        'remaining': DemoQuota.remaining(request.user),
        # What the composer's `/` menu offers, from the one list in `fixtures.py`
        # that also names the intent each command sends.
        'commands': SLASH_COMMANDS,
        # Fixture mode answers captured payloads one question at a time and keeps
        # no conversation at all, so the page says so rather than letting a
        # follow-up look like it was remembered.
        'fixture_mode': settings.DEMO_FIXTURE_MODE,
        # The ceiling the turn counter is out of ("Turn 3 of 20"). Sent with the
        # page rather than fetched, because it is a policy value and the label is
        # on screen before any conversation exists.
        'turn_ceiling': settings.DEMO_CONVERSATION_TURN_CEILING,
        # The window the thread is kept for, from the same policy. The console
        # states it up front: a thread that disappears without the reader having
        # been told how long it lasts reads as data loss, not as retention.
        'retention_days': settings.DEMO_CONVERSATION_TTL_HOURS // 24,
    })


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


def _tools_errored(result) -> bool:
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


def _sse(event, data):
    """One server-sent event, in the same encoding the agent uses.

    Encoded to bytes here rather than left as text: the streaming response
    carries bytes on the wire, and being explicit avoids relying on Django to
    encode each frame for us.
    """
    return f'event: {event}\ndata: {json.dumps(data)}\n\n'.encode('utf-8')


class _StreamedResponse(StreamingHttpResponse):
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
    the whole reason this class exists. `_stream_frames` is synchronous, because
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


def _stream_frames(
    user, trace, period, first, rest, conversation=None, asked='',
):
    """Relay the agent's frames to the browser, then close.

    SYNCHRONOUS on purpose, and this is a correctness requirement rather than a
    style choice: `_StreamedResponse` documents what each of Django's handlers
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
                if _tools_errored(data):
                    logger.error('a2ui_ask: tool error in streamed answer trace=%s', trace or '-')
                    DemoQuota.refund(user, period)
                    yield _sse('error', {
                        'error': UNAVAILABLE,
                        'remaining': DemoQuota.remaining(user),
                    })
                    return
                # The presentation contract is composed in the AGENT; Django
                # adds only the web-specific quota figure, counts the turn now
                # that an answer exists, and stores it so the next question can
                # be answered as a follow-up.
                _record_turn(conversation)
                record_answer(conversation, data, asked)
                data['remaining'] = DemoQuota.remaining(user)
                if conversation is not None:
                    data['conversation_id'] = conversation.pk
                    # The same two facts the recall endpoint sends, so the console's
                    # context bar reads the same after a live turn as after a
                    # restored one.
                    data['expires_at'] = conversation.expires_at.isoformat()
                yield _sse('answer', data)
                return

            if event == 'error':
                logger.error('a2ui_ask: stream failed mid-answer trace=%s: %s', trace or '-', data)
                DemoQuota.refund(user, period)
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
        DemoQuota.refund(user, period)
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


# --- conversation recall ------------------------------------------------------
#
# The store has always held the turns. What it could not do until now is hand them
# back as the console draws them; `turn_payloads` is the one shape for that, so a
# restored thread and a live one are rendered by the same code (Phase 3).


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
    unsupported = _unsupported_field_error(payload)
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

    intent, error = _intent_for(payload)
    if error:
        return JsonResponse({'error': error}, status=400)

    asked = _asked_from(payload)

    conversation, opening, error = _resolve_conversation(
        request, payload, intent.get('hadm_id'))
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
    _with_replay(intent, conversation)
    if 'text/event-stream' in request.headers.get('Accept', ''):
        return _streaming_ask(
            request, intent, trace, period, conversation, asked,
            # Strict identity rather than truthiness: a caller sending the string
            # `"true"` has got the type wrong, and answering that by turning prose
            # streaming on is a guess about what it meant.
            prose_stream=payload.get('stream_prose') is True,
            # Strict identity here too: this one buys a model call per turn, so a
            # caller sending the string "true" gets nothing rather than a guess.
            follow_ups=payload.get('follow_ups') is True,
        )

    try:
        result = ask_agent(intent, trace=trace)
    except AgentRefused as exc:
        # The agent declined the request as it stands, before running anything.
        # Its message is the guidance the clinician needs ("Please include a
        # clinical topic to search"), so it is relayed rather than replaced, and
        # the credit is given back freely because nothing was dispatched.
        logger.info(
            'a2ui_ask: agent refused trace=%s code=%s', trace or '-', exc.code
        )
        DemoQuota.refund(request.user, period, spent=exc.spent)
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
    _record_turn(conversation)
    record_answer(conversation, result, asked)
    result['remaining'] = DemoQuota.remaining(request.user)
    if conversation is not None:
        # The browser keeps this and sends it back on the next question, which
        # is what turns the next question into a follow-up rather than a new
        # conversation (and therefore what keeps it from costing a credit).
        result['conversation_id'] = conversation.pk
        result['expires_at'] = conversation.expires_at.isoformat()
    return JsonResponse(result)


def _streaming_ask(request, intent, trace, period, conversation=None, asked='',
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
        # Both flags are merged here rather than folded into `intent` upstream, because
        # neither is intent: they are what this page asked to be shown, and the agent
        # treats them as capabilities rather than as part of the question.
        requested = dict(intent)
        if prose_stream:
            requested['stream_prose'] = True
        if follow_ups:
            requested['follow_ups'] = True
        stream = ask_agent_stream(requested, trace=trace)
        first = next(stream, None)
    except AgentRefused as exc:
        # Same reasoning as the blocking path: the refusal is guidance rather
        # than a failure, and nothing was dispatched, so the credit is free.
        logger.info(
            'a2ui_ask: agent refused the stream before its first frame trace=%s code=%s',
            trace or '-', exc.code,
        )
        DemoQuota.refund(request.user, period, spent=exc.spent)
        return JsonResponse({
            'error': exc.message,
            'remaining': DemoQuota.remaining(request.user),
        }, status=400)
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

    # `_StreamedResponse`, not `StreamingHttpResponse`: the stock class streams
    # under one of Django's handlers and buffers under the other, and this app is
    # served by both (see the class for what each handler does).
    response = _StreamedResponse(
        _stream_frames(request.user, trace, period, first, stream, conversation,
                       asked),
        content_type='text/event-stream',
    )
    response['Cache-Control'] = 'no-cache, no-transform'
    # An explicit "do not buffer this" for any proxy in front. Without it the
    # whole stream can arrive at once when the response ends, which looks
    # exactly like no streaming at all.
    response['X-Accel-Buffering'] = 'no'
    return response


@login_required
@require_POST
def feedback(request):
    """How the reader rated one turn. Telemetry, and deliberately nothing more.

    There is no table behind this and no migration with it: the event is written to the
    log stream where the rest of a request's trace already goes, and the rating is
    attached to the Langfuse trace behind the answer, which is where a review of
    "answers a clinician rated badly" actually happens. A table here would mean a schema
    this phase does not need and a second home for one event.

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
    _attach_score(turn_id, score)
    return HttpResponse(status=204)


def _attach_score(turn_id: str, value: int) -> None:
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
