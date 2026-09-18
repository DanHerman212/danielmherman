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


def record_answer(conversation, result):
    """Store the turn the agent just answered. Returns the turn, or None.

    `conversation` is None for a question asked with no admission: there is no
    patient to pin and therefore no conversation to continue.

    A turn that produced no answer is not stored at all. It keeps its place and
    its credit without one — the ceiling counts answers, so a failed opening turn
    leaves the conversation open and unpaid — and the failure itself is in the
    agent's execution log under the same trace id, which is where a failure
    record belongs. What this store holds is what would be replayed.
    """
    if conversation is None:
        return None

    asked = result.get('question') or ''
    ordinal = _next_ordinal(conversation)
    # One transaction for the pair: a stored answer with no question in front of
    # it cannot be replayed, so half a turn is not worth having.
    with transaction.atomic():
        Turn.objects.create(
            conversation=conversation,
            ordinal=ordinal,
            role=Turn.Role.USER,
            question=asked,
        )
        turn = Turn.objects.create(
            conversation=conversation,
            ordinal=ordinal + 1,
            role=Turn.Role.AGENT,
            answer=result.get('answer') or '',
            model=result.get('model') or '',
            code_revision=result.get('code_revision') or '',
            citations=_stored_citations(result.get('sources')),
            tool_calls=_stored_calls(result.get('tool_calls')),
        )
    return turn


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

    Bounded to the most recent `MAX_REPLAYED_TURNS`: the window is what keeps the
    current question inside the context it is being asked about, and the oldest
    turns are the ones a follow-up is least likely to need.
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

    return turns[-MAX_REPLAYED_TURNS:]


def _clamp(answer):
    """An answer short enough to be replayed.

    The agent refuses a replayed answer over its cap and refuses the whole
    request with it, so an answer that long would end the conversation at the
    point it was given. Shortening it is the lesser loss, and the mark says so.
    """
    if len(answer) <= MAX_TURN_ANSWER_CHARS:
        return answer
    return answer[:MAX_TURN_ANSWER_CHARS - len(TRUNCATION_MARK)] + TRUNCATION_MARK


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
