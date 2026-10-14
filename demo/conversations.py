"""Reading and writing a conversation (layer 8, plan item 6).

Two functions and one policy. `record_answer` writes the turn that was just
answered; `replay_turns` reads a conversation back as the `turns` the agent
replays. Both live here rather than in `views.py` because this is where the
policy is stated, and the policy is the same one written out in
`docs/architecture/layer-08-memory-and-ux-strategy.md` in the harness:

  * a turn is stored as the pair it was — what was asked, then what was
    answered — so the conversation reads like the thread the clinician saw;
  * a citation is stored as its identity and never as its passage, and a tool
    result is stored only when it cannot be obtained again. The agent says which
    is which (`derivable`) because only the layer that ran the tool knows: it
    returns discharge-note text, and this database is not where note text lives;
  * what is sent back to the agent is a bounded window, because every replayed
    turn enters the context window the current question is being asked in.

Nothing here decides who may continue a conversation or what it costs — that is
`views._resolve_conversation`, and it has to happen before a credit is spent.
"""

from django.db import transaction
from django.db.models import Max

from .models import Turn

# The agent's caps on a replay (services/agent/contracts.py). The site sends what
# the agent accepts: a request over any of these is refused outright, and a
# refusal here would break the conversation rather than the turn.
MAX_REPLAYED_TURNS = 6
MAX_REPLAYED_TOOL_CALLS = 5
MAX_TURN_ANSWER_CHARS = 8000
MAX_TOOL_NAME_CHARS = 64

# How long the clinician's own words may be when they are used as a turn's
# heading. The console's composer is what bounds this in practice; this is the
# bound for a caller that is not the console.
MAX_ASKED_CHARS = 300

# Marked rather than silent. An earlier answer that has to be shortened for the
# replay is shortened visibly, so the model is not told that a truncated answer
# is the whole of what the clinician was told.
TRUNCATION_MARK = '\n[earlier answer truncated for replay]'


def _next_ordinal(conversation):
    """The next free ordinal in this conversation.

    Read from the rows rather than from `turn_count`, because a turn is two rows
    and the counter counts answers.
    """
    highest = conversation.turns.aggregate(top=Max('ordinal'))['top']
    return (highest or 0) + 1


def record_answer(conversation, result, asked=''):
    """Store the turn the agent just answered. Returns the turn, or None.

    `conversation` is None for a question asked with no admission: there is no
    patient to pin and therefore no conversation to continue.

    A turn that produced no answer is not stored at all. It keeps its place and
    its credit without one — the ceiling counts answers, so a failed opening turn
    leaves the conversation open and unpaid — and the failure itself is in the
    agent's execution log under the same trace id, which is where a failure
    record belongs. What this store holds is what would be replayed.

    `asked` is the clinician's own words — the command they ran, or the text they
    typed — and it is deliberately a second field rather than a replacement for
    the composed question. The composed prompt is what the agent was asked and
    what a follow-up has to be replayed against; the clinician's words are what
    the console heads the turn with. Turning one into the other would need a copy
    of the command vocabulary on whichever side was doing the turning.
    """
    if conversation is None:
        return None

    composed = result.get('question') or ''
    ordinal = _next_ordinal(conversation)
    # One transaction for the pair: a stored answer with no question in front of
    # it cannot be replayed, so half a turn is not worth having.
    with transaction.atomic():
        Turn.objects.create(
            conversation=conversation,
            ordinal=ordinal,
            role=Turn.Role.USER,
            question=composed,
            asked=_clamp_asked(asked) or composed,
        )
        turn = Turn.objects.create(
            conversation=conversation,
            ordinal=ordinal + 1,
            role=Turn.Role.AGENT,
            answer=result.get('answer') or '',
            model=result.get('model') or '',
            code_revision=result.get('code_revision') or '',
            langfuse_trace_id=_stored_trace_id(result.get('langfuse_trace_id')),
            citations=_stored_citations(result.get('sources')),
            presentation=_stored_presentation(result.get('a2ui')),
            tool_calls=_stored_calls(result.get('tool_calls')),
            guardrail_flags=_stored_flags(result.get('guardrail_flags')),
        )
    return turn


def _stored_flags(flags):
    """The guardrail flags as the agent named them.

    Kept because the flag list is the only record of why a served answer differs
    from what the model wrote: a guardrail that rewrote a sentence leaves the
    answer and the reason in different places, and the agent's log is not
    something a reviewer of this conversation can reach. Non-strings are dropped
    rather than stored — the agent sends names, and anything else is a contract
    violation that belongs in the log, not in this table.
    """
    return [flag for flag in flags or [] if isinstance(flag, str)]


def _stored_presentation(envelope):
    """The composed A2UI payload as it will be stored, or {} when there is none.

    Validated as a dict rather than trusted: this value is mounted by the browser as
    a surface, so a list or a string here would reach the renderer as a malformed
    envelope and draw nothing — which reads on screen as an answer that failed rather
    than as a payload that was mis-stored. A turn with no canvas stores {}, and the
    empty default is what the column already means.
    """
    return envelope if isinstance(envelope, dict) else {}


def turn_payloads(conversation):
    """The conversation as the list of turns the console renders, oldest first.

    The canonical turn, defined once and used twice: a live answer and a turn restored
    from the store are the same shape, so the client has one renderer rather than a
    live path and a hydrate path that drift apart. Each entry is

        question    the header: the user's own prompt or command, as they typed it
        answer      the prose, for a turn the surface does not draw
        a2ui        the composed presentation for the turn, or {} when it had none
        flags       the guardrails that fired, which is why this answer differs
        citations   identities, for the click-through list beside the thread

    Nothing here re-composes. `a2ui` is the payload the agent composed at the time
    and this store kept, so a restored thread shows what the turn showed rather than
    a recomposition from evidence that has since moved.
    """
    if conversation is None:
        return []

    payloads = []
    asked = ''
    label = ''
    for row in conversation.turns.order_by('ordinal'):
        if row.role == Turn.Role.USER:
            asked = row.question
            # Rows written before the console kept the clinician's own words have
            # only the composed prompt, which is a worse heading than the command
            # but not an empty one.
            label = row.asked or row.question
            continue
        if not asked and not row.answer:
            continue
        payloads.append({
            'asked': label,
            'answer': row.answer,
            'a2ui': row.presentation or {},
            'flags': list(row.guardrail_flags or []),
            'citations': list(row.citations or []),
            'ordinal': row.ordinal,
        })
        asked = ''
    return payloads


def _stored_trace_id(value):
    """The pointer to the run, if it is a string that fits the column.

    A pointer that is not a string is not a pointer, and this value is turned
    into a URL by the admin, so storing a number or None would put a broken link
    in front of an operator — worse than storing nothing, because it looks like
    evidence. The agent's contract already refuses a non-string; this is the
    second line for the fixture path, which composes responses without going
    through the agent at all.

    Truncated rather than trusted: the column is 64 characters and a Langfuse
    trace id is 32, so anything longer is not an id this site can point at.
    """
    if not isinstance(value, str):
        return ''
    return value[:64]


def _stored_citations(sources):
    """The identity of each citation, and nothing else.

    `text` is the passage a citation points at. It is not stored: the passage is
    re-derived from the note when a replayed turn needs it, which is what keeps
    clinical prose out of this database.
    """
    stored = []
    for source in sources or []:
        if not isinstance(source, dict) or not isinstance(source.get('cite'), int):
            continue
        stored.append({
            'cite': source['cite'],
            'section': source.get('section') or '',
            'query': source.get('query') or '',
        })
    return stored


def _stored_calls(calls):
    """Each call as the agent described it, minus a result that can be re-derived.

    `derivable` is the agent's answer to "can this be obtained again?", and a call
    that does not carry it is treated as derivable: guessing the other way would
    put note text in this database, and the cost of guessing this way is one
    re-run of a tool whose corpus is written offline and never mutated by a
    request.
    """
    stored = []
    for call in calls or []:
        if not isinstance(call, dict):
            continue
        name = call.get('name')
        if not isinstance(name, str) or not name:
            continue
        stored.append({
            'name': name,
            'args': call.get('args') if isinstance(call.get('args'), dict) else {},
            'payload': None if call.get('derivable', True) else call.get('response'),
        })
    return stored


def replay_turns(conversation):
    """The conversation as the `turns` the agent replays, oldest first.

    Bounded to `MAX_REPLAYED_TURNS`, and the bound is the agent's — this sends what
    the agent accepts. Which turns fill it changed on 2026-10-14: a conversation
    longer than the bound sends the FIRST turn and the most recent ones, not the
    most recent alone. The first turn is the clinical anchor the rest of the thread
    is written against — the question that established what is being asked about
    this patient — and a window of recent turns alone would let the agent reason
    about the patient from the last few exchanges only.
    """
    if conversation is None:
        return []

    turns = []
    asked = ''
    for row in conversation.turns.order_by('ordinal'):
        if row.role == Turn.Role.USER:
            asked = row.question
            continue
        # An answer with no question in front of it is not a turn. The pair is
        # written in one transaction, so this is a guard rather than an expected
        # state, and skipping it is the only faithful reading.
        if not asked or not row.answer:
            continue
        turns.append({
            'question': asked,
            'answer': _clamp(row.answer),
            'tool_calls': _replay_calls(row.tool_calls),
        })
        asked = ''

    if len(turns) <= MAX_REPLAYED_TURNS:
        return turns
    # The anchor plus the most recent turns. One turn of the window is spent on the
    # anchor, so the recent half is one shorter than the bound — the alternative,
    # sending six recent turns and the anchor, would exceed what the agent accepts
    # and be refused outright.
    return turns[:1] + turns[-(MAX_REPLAYED_TURNS - 1):]


def _clamp(answer):
    """An answer short enough to be replayed.

    The agent refuses a replayed answer over its cap and refuses the whole
    request with it, so an answer that long would end the conversation at the
    point it was given. Shortening it is the lesser loss, and the mark says so.
    """
    if len(answer) <= MAX_TURN_ANSWER_CHARS:
        return answer
    return answer[:MAX_TURN_ANSWER_CHARS - len(TRUNCATION_MARK)] + TRUNCATION_MARK


def _clamp_asked(asked):
    """The clinician's own words, bounded to something a heading can hold.

    The client sends what it drew, and what it drew was bounded by the composer.
    This is the second line for a caller that is not the console: a heading is one
    line by construction, and an unbounded string here would be a heading that is a
    wall of text rather than a heading that is long.
    """
    if not isinstance(asked, str):
        return ''
    asked = asked.strip()
    if len(asked) <= MAX_ASKED_CHARS:
        return asked
    return asked[:MAX_ASKED_CHARS - len(TRUNCATION_MARK)] + TRUNCATION_MARK


def _replay_calls(stored):
    """The stored tool calls, in the shape the agent's replay accepts.

    A call whose name is missing or too long is left out rather than sent: one
    name the agent would refuse would refuse the whole request, and dropping the
    call costs the replayed turn its place in the tool sequence rather than the
    conversation.
    """
    calls = []
    for call in (stored or [])[:MAX_REPLAYED_TOOL_CALLS]:
        if not isinstance(call, dict):
            continue
        name = call.get('name')
        if not isinstance(name, str) or not name or len(name) > MAX_TOOL_NAME_CHARS:
            continue
        entry = {
            'name': name,
            'args': call.get('args') if isinstance(call.get('args'), dict) else {},
        }
        if call.get('payload') is not None:
            entry['payload'] = call['payload']
        calls.append(entry)
    return calls
