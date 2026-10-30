"""Attaching a reader's rating to the trace that produced the answer.

A thumbs-up is worth more than a log line. The rating is already joined to a stored
turn by its id, and that turn already carries `langfuse_trace_id`; the link that was
missing is the last one — nothing ever told Langfuse about it. So the one signal that
says "a clinician read this answer and thought it was good" was invisible to every
review that starts in the trace UI, which is exactly where a review starts.

Three rules, the same three `services/agent/observability.py` earned:

1. **A rating never fails the reader.** Every path returns a bool and swallows its
   exceptions. The endpoint answers 204 regardless: the reader has already moved on,
   and there is nothing they could do about a score that did not land.

2. **Unconfigured means off, but not silently.** No host or no keys, no call — and one
   warning naming what is missing. The site needs this for scores only; it is not a
   tracing dependency, and a demo deployment without Langfuse credentials is a supported
   state rather than a misconfiguration. What is not supported is looking like a working
   feature: until 2026-10-30 this returned False with no log at all, so a service missing
   all three variables answered every rating exactly as a service that recorded it, and
   the reader's judgement was dropped in silence for as long as nobody compared the two.

3. **A turn with no trace is not an error.** Tracing may be off, or the run may never
   have started. The caller drops the rating quietly rather than reporting it.

Why a module and not four lines in the view: the wire format is the part that has to
be right, and it is the part that is easiest to get wrong without noticing, because a
rejected score is a 4xx on a request nobody is watching.
"""

from __future__ import annotations

import logging
import os

import requests

logger = logging.getLogger(__name__)

#: All three, for the same reason the agent requires all three: a host without keys
#: half-configures the call and produces a 401 instead of a score.
_ENV_VARS = ('LANGFUSE_HOST', 'LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY')

#: The name every rating lands under, so a review filters on one name instead of
#: guessing which of the project's scores came from a person.
SCORE_NAME = 'user-feedback'

#: Short, because this runs inside a request whose answer the reader is not waiting
#: on — but not so short that a slow ingest endpoint turns every click into a miss.
TIMEOUT_SECONDS = 3.0


def missing() -> list[str]:
    """The environment variables this deployment has not been given.

    Named rather than counted: a warning that says "not configured" sends whoever reads
    it to the deploy config to guess, and the fix is always the same list of three.
    """
    return [name for name in _ENV_VARS if not (os.environ.get(name) or '').strip()]


def configured() -> bool:
    """True when this deployment can record a score. Says nothing about reachability."""
    return not missing()


def score(trace_id: str, value: int, *, comment: str = '') -> bool:
    """Attach one rating to one trace. True when Langfuse accepted it.

    A SIGNED NUMBER, not a boolean. The first version sent `dataType: BOOLEAN` with
    `1`/`0`, and a thumbs-down therefore arrived as `0` — which the scored-trace
    table either renders as nothing or as the absence of a score. A reader could not
    tell a negative rating from an unrated trace, which makes the whole feature
    useless for the one thing it exists for. `1` / `-1` cannot be confused with
    missing, sorts correctly, and is what a numeric column is for.

    ONE ROW PER TRACE, because a reader can change their mind. Scores are appended by
    default, so a thumbs-up followed by a thumbs-down left two rows on the same trace
    — and a review that averages them gets 0, which is a judgement nobody made. The id
    is derived from the trace, so a second rating UPDATES the first. Verified against
    the live API on 2026-10-17: two posts with one id leave exactly one row whose value
    is the later one.
    """
    if not trace_id:
        return False
    if not configured():
        logger.warning(
            'langfuse scoring is off for this service: %s unset, so this rating was '
            'dropped rather than recorded', ', '.join(missing()))
        return False

    host = os.environ['LANGFUSE_HOST'].strip().rstrip('/')
    try:
        # `requests`, not `urllib`, and the difference is not style: the stdlib
        # client resolves its CA bundle from the system store, and on this machine
        # that store has no issuer chain, so every post raised
        # `SSLCertVerificationError` and the rating was dropped in silence. `requests`
        # ships `certifi`, and the site already depends on it.
        response = requests.post(
            host + '/api/public/scores',
            json={
                # Deterministic, so the reader's latest judgement replaces the last
                # one instead of standing beside it.
                'id': f'{SCORE_NAME}-{trace_id}',
                'traceId': trace_id,
                'name': SCORE_NAME,
                'value': 1 if value > 0 else -1,
                'dataType': 'NUMERIC',
                # The number carries the sign; the comment carries the words, so the
                # score is readable in a table without a legend.
                'comment': comment or ('helpful' if value > 0 else 'not helpful'),
            },
            # Project-scoped keys, so a score can only land in the project that
            # issued them.
            auth=(os.environ['LANGFUSE_PUBLIC_KEY'].strip(),
                  os.environ['LANGFUSE_SECRET_KEY'].strip()),
            timeout=TIMEOUT_SECONDS,
        )
        return 200 <= response.status_code < 300
    except Exception:  # noqa: BLE001 — rule 1: tracing may not fail the reader
        logger.warning('langfuse score could not be recorded', exc_info=True)
        return False
