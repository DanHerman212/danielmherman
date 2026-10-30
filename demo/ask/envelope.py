"""What the browser receives: the agent's payload plus the facts only the web has.

There were two builders until Phase 4 — one at the end of the blocking view and one in
the middle of the streaming relay — each writing `remaining`, `conversation_id` and
`expires_at` by hand. They agreed because nobody had changed one of them yet, which is
the only reason a pair like that ever agrees; `test_payload_contract.py` now compares
the two envelopes field for field, and this module is what makes that comparison true by
construction rather than by coincidence.
"""

from __future__ import annotations


def for_client(result, *, remaining, conversation=None, turn=None):
    """The answer envelope: the agent's payload, plus what this proxy knows.

    `remaining` is the quota figure after this turn, which cannot be known before the
    answer exists and is why it rides here rather than on the page.

    `conversation_id`, `expires_at` and `turn_id` are sent only when the turn was
    stored. A question asked with no admission has no patient to pin, no thread to
    continue and no row to rate, so it carries none of them — and the console reads
    their absence as "nothing to keep", not as a missing value.

    `turn_id` is the stored answer row's own key, and it is here because the console
    cannot derive it. The ordinal it used to send was a page-local counter that restarted
    at 1 on every reload, so a rating on a restored thread named whichever answer came
    first in the conversation (and, on a thread longer than the page had drawn, none).
    The proxy is the only layer that sees the row, so it is the layer that says which row
    answered.

    The argument is rebound to a copy rather than mutated: the payload handed in here is
    the one the contract validator approved, and the store has already been written from
    it by the time this runs. `result` is the name the blocking view used for the same
    object before Phase 4, and it is also the name the contract test's producer scan
    reads, so this stays the one place those keys are written.
    """
    result = dict(result or {})
    result['remaining'] = remaining
    if conversation is not None:
        result['conversation_id'] = conversation.pk
        result['expires_at'] = conversation.expires_at.isoformat()
    if turn is not None:
        result['turn_id'] = turn.pk
    return result
