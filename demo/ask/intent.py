"""What a request means, and what is sent on to the agent.

Three jobs, all of them before a credit is spent or a byte leaves the process:

  * refuse a body this endpoint does not understand, rather than answering a request
    whose extra fields it would have dropped in silence;
  * turn a starter chip, a picked patient or typed free text into the intent the agent
    is asked — intent, not prompt text, because the agent owns the wording;
  * add the earlier turns of a live conversation, which is the one thing this side
    contributes to a follow-up.

The *wording* is not built here. Half of the prompt used to live in this repository,
which meant a prompt change could ship without touching the chain, so what crosses the
boundary is a chip name or the reader's own text plus the admission, and the agent
composes the question.
"""

from __future__ import annotations

from ..conversations import MAX_ASKED_CHARS
from ..fixtures import CHIP_NAMES
from ..models import DemoPatient
from . import runtime

MAX_QUESTION_CHARS = 2000

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


def unsupported_field_error(payload):
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


def asked_from(payload):
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


def with_declaration(intent, declared):
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


def with_replay(intent, conversation):
    """The intent plus the earlier turns of this conversation, if there is one.

    The agent holds nothing between requests (layer 8: it is stateless by
    requirement), so continuity is something the caller supplies. This is the
    caller: the site stores the turns and sends them back, which keeps the
    agent free of a store and keeps the browser from being one.

    Nothing is sent for a turn that stands alone — a question with no admission
    has no conversation and no earlier turns — or for the first turn of one.

    `replay_turns` is read through the app namespace because the frozen suite patches
    it on `demo.views`; see `runtime`.
    """
    turns = runtime.collaborator('replay_turns')(conversation)
    if turns:
        intent['turns'] = turns
    return intent


def intent_for(payload):
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
                return with_declaration(
                    {'chip': chip, 'hadm_id': hadm_id, 'question': q}, declared), None
            return with_declaration(
                {'chip': chip, 'hadm_id': hadm_id}, declared), None
        # Free text sent alongside the selected patient: the agent embeds the
        # admission in the question so it can ground the answer.
        question = payload.get('question')
        if isinstance(question, str) and question.strip():
            q = question.strip()
            if len(q) > MAX_QUESTION_CHARS:
                return None, f'Question exceeds {MAX_QUESTION_CHARS} characters.'
            return with_declaration({'question': q, 'hadm_id': hadm_id}, declared), None
        # Patient selected, nothing asked. This used to be forwarded: the agent had a
        # default question for exactly this case, and that default ran the readmission
        # model. The `/risk` command it belonged to was retired on 2026-10-26, so there
        # is nothing to ask and nothing to spend a credit on — the honest answer is the
        # refusal, not a turn about a question nobody asked.
        return None, 'Ask a question, or pick a command.'

    question = payload.get('question')
    if not isinstance(question, str) or not question.strip():
        return None, 'Provide either hadm_id or a non-empty question.'
    if len(question) > MAX_QUESTION_CHARS:
        return None, f'Question exceeds {MAX_QUESTION_CHARS} characters.'
    return with_declaration({'question': question.strip()}, declared), None
