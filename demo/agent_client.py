"""Server-side client for the private `agent` Cloud Run service.

The browser never talks to the agent. Both Cloud Run services are private, and
Django is the only public surface — so this module is what makes the whole
topology work: it mints a short-lived ID token per request and proxies the call.

Keeping the agent private removes a category of problems rather than solving
them: no CORS, no public prediction endpoint to rate-limit separately, no
credentials shipped to the client, and no way for a visitor to bypass the quota
by calling the agent directly.
"""

import json
import logging
import subprocess  # nosec B404 — local-only ID-token path, fixed args, no shell
import threading

import requests
from django.conf import settings

from .agent_contract import AgentResponseError, validate_agent_response

logger = logging.getLogger(__name__)


class AgentError(Exception):
    """The agent could not be reached, or did not answer usefully.

    `spent` records whether the failed request still bought model spend
    upstream. Failures raised BEFORE the request was dispatched (no URL, no
    token, busy, connection refused) provably cost nothing and refund freely;
    everything after dispatch (timeout, bad status, bad body) is treated as
    billed and refunds only under the daily cap (S1-09).
    """

    def __init__(self, message, spent=True):
        super().__init__(message)
        self.spent = spent


# Bounds concurrent agent calls per instance. Each call blocks a sync-view
# worker thread for up to DEMO_AGENT_TIMEOUT (120s); without a bound, a
# handful of slow calls exhaust the thread pool and stall the whole public
# site, including login and content pages (S1-15).
_agent_slots = threading.BoundedSemaphore(settings.DEMO_AGENT_MAX_CONCURRENCY)


def _id_token(audience):
    """Mint an ID token for a private Cloud Run service.

    The audience must be the **service URL**, not the /ask path. A mismatched
    audience produces a 401 that is indistinguishable from a missing IAM
    binding, and the audience is the more common cause.

    In production the metadata server mints this in-process. Locally, ADC is a
    *user* credential, which cannot mint an ID token for an arbitrary audience.
    Check the credential type first rather than letting fetch_id_token fail:
    its failure path probes the GCE metadata server and stalls for seconds
    before raising, on every local request.
    """
    import google.auth
    import google.auth.transport.requests
    import google.oauth2.credentials
    import google.oauth2.id_token

    credentials, _ = google.auth.default()

    if not isinstance(credentials, google.oauth2.credentials.Credentials):
        request = google.auth.transport.requests.Request()
        return google.oauth2.id_token.fetch_id_token(request, audience)

    # Local development against a real deployed agent. gcloud is not present in
    # the container image, so this branch cannot be reached in production.
    try:
        result = subprocess.run(  # nosec B603 B607 — fixed argv, no shell, local dev only
            ['gcloud', 'auth', 'print-identity-token'],
            capture_output=True, text=True, check=True, timeout=60,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise AgentError(
            f'Could not mint a local identity token: {exc}', spent=False
        ) from exc
    return result.stdout.strip()


def _validated(result):
    """Reject response shapes the views cannot safely index into (S1-11).

    A malformed body would otherwise raise mid-view — a 500 AFTER the credit
    was consumed, on a path the refund handling does not cover. Raising
    AgentError here routes it through the existing refund path instead.
    """
    try:
        return validate_agent_response(result)
    except AgentResponseError as exc:
        raise AgentError(str(exc)) from exc


def trace_id(request):
    """The Cloud Trace id Cloud Run stamped on this inbound request.

    Cloud Run adds `X-Cloud-Trace-Context: TRACE_ID/SPAN_ID;o=1` to every
    request it delivers. Forwarding the header to the agent lets one user
    action be followed across both services' logs by a single id. Empty when
    the request did not come through Cloud Run (local development, tests).
    """
    header = request.META.get('HTTP_X_CLOUD_TRACE_CONTEXT', '')
    return header.split('/', 1)[0]


def ask(body, trace=''):
    """Send one request to the agent and return its parsed JSON response.

    `body` is the request intent — `{'chip': ..., 'hadm_id': ...}` or
    `{'question': ..., 'hadm_id': ...}`. Django does not compose the question:
    the agent owns the prompt's wording (layer 3, chain artifact), so what
    crosses this boundary is intent rather than prompt text.

    `trace` is the inbound Cloud Trace id (see `trace_id`); it is forwarded so
    the agent's log lines carry the same id as Django's.
    """
    base = settings.DEMO_AGENT_URL.rstrip('/')
    if not base:
        raise AgentError('DEMO_AGENT_URL is not configured.', spent=False)

    # Fail fast when every slot is taken rather than queueing more blocked
    # threads behind a slow agent. Nothing was dispatched, so nothing billed.
    if not _agent_slots.acquire(timeout=5):
        raise AgentError('All agent slots are busy.', spent=False)
    try:
        try:
            token = _id_token(base)
        except AgentError:
            raise
        except Exception as exc:
            # google-auth failures (no ADC, metadata unreachable) — nothing
            # was dispatched, so nothing billed.
            raise AgentError(
                f'Could not mint an identity token: {type(exc).__name__}',
                spent=False,
            ) from exc
        headers = {'Authorization': f'Bearer {token}'}
        if trace:
            headers['X-Cloud-Trace-Context'] = trace
        try:
            response = requests.post(
                f'{base}/ask',
                json=body,
                headers=headers,
                timeout=settings.DEMO_AGENT_TIMEOUT,
            )
        except requests.ConnectionError as exc:
            # Refused/DNS failure before anything was dispatched — zero spend.
            raise AgentError(f'{type(exc).__name__}: {exc}', spent=False) from exc
        except requests.RequestException as exc:
            # Includes the read timeout, where the agent may well still be
            # running (and billing). A cold agent instance plus a cold MCP
            # instance is two cold starts on the same request, so the timeout
            # has to be generous — see BUILD_GUIDE section 12.
            raise AgentError(f'{type(exc).__name__}: {exc}') from exc

        if response.status_code != 200:
            # Log the body, return a generic message. The agent's errors can
            # quote internal URLs and service account names.
            logger.error(
                'agent returned %s trace=%s: %s',
                response.status_code, trace or '-', response.text[:2000],
            )
            raise AgentError(f'Agent returned HTTP {response.status_code}.')

        try:
            return _validated(response.json())
        except ValueError as exc:
            raise AgentError('Agent returned a non-JSON body.') from exc
    finally:
        _agent_slots.release()


def _frames(lines):
    """Yield (event, data) pairs from an SSE line stream.

    Keepalive frames are comment lines (`: keepalive`) and carry no data, so
    they are skipped rather than surfaced — they exist to hold the socket open,
    not to tell the browser anything.
    """
    event, data = None, []
    for line in lines:
        if isinstance(line, bytes):
            line = line.decode('utf-8', 'replace')
        if not line.strip():
            if data:
                yield (event or 'message', '\n'.join(data))
            event, data = None, []
        elif line.startswith(':'):
            continue
        elif line.startswith('event:'):
            event = line[len('event:'):].strip()
        elif line.startswith('data:'):
            data.append(line[len('data:'):].lstrip())
    if data:
        yield (event or 'message', '\n'.join(data))


def ask_stream(body, trace=''):
    """Send a request and yield the agent's frames as they arrive.

    `body` is the request intent, exactly as `ask` takes it.

    Yields (event, data) pairs: zero or more progress stages, then exactly one
    terminal frame — `answer` with the same validated payload `ask()` returns,
    or `error` with a code and a message the caller can act on.

    A generator rather than a function returning a list, because the point is
    that frames reach the browser while the chain is still working. Collecting
    them here first would deliver everything at the end, which looks exactly
    like no streaming at all.

    The terminal frame is guaranteed: if the agent closes the stream without
    one, an error frame is synthesized, so a caller iterating this can never be
    left waiting for an answer that is not coming.
    """
    base = settings.DEMO_AGENT_URL.rstrip('/')
    if not base:
        raise AgentError('DEMO_AGENT_URL is not configured.', spent=False)

    # Same bound as the blocking path, held for the same duration: a streamed
    # call occupies one agent slot from dispatch to the terminal frame, so the
    # per-instance concurrency limit means the same thing either way.
    if not _agent_slots.acquire(timeout=5):
        raise AgentError('All agent slots are busy.', spent=False)
    try:
        try:
            token = _id_token(base)
        except AgentError:
            raise
        except Exception as exc:
            raise AgentError(
                f'Could not mint an identity token: {type(exc).__name__}',
                spent=False,
            ) from exc
        headers = {
            'Authorization': f'Bearer {token}',
            'Accept': 'text/event-stream',
        }
        if trace:
            headers['X-Cloud-Trace-Context'] = trace
        try:
            response = requests.post(
                f'{base}/ask/stream',
                json=body,
                headers=headers,
                stream=True,
                # Applies per read, not to the request as a whole: the agent
                # sends a keepalive every 15s while a tool call is running, so
                # this is "how long may the stream go silent", which is the
                # question worth bounding.
                timeout=settings.DEMO_AGENT_TIMEOUT,
            )
        except requests.ConnectionError as exc:
            raise AgentError(f'{type(exc).__name__}: {exc}', spent=False) from exc
        except requests.RequestException as exc:
            raise AgentError(f'{type(exc).__name__}: {exc}') from exc

        with response:
            if response.status_code != 200:
                logger.error(
                    'agent stream returned %s trace=%s: %s',
                    response.status_code, trace or '-', response.text[:2000],
                )
                raise AgentError(f'Agent returned HTTP {response.status_code}.')

            for event, raw in _frames(response.iter_lines()):
                try:
                    data = json.loads(raw)
                except ValueError:
                    data = None

                if event == 'answer':
                    # The agent saying "answer" is not evidence the payload is
                    # usable. The same contract check the blocking path runs
                    # runs here, and a payload that fails it is reported as an
                    # error — the browser must never be handed something the
                    # view cannot index into.
                    try:
                        yield ('answer', _validated(data))
                    except AgentError as exc:
                        logger.error(
                            'agent stream payload failed its contract trace=%s: %s',
                            trace or '-', exc,
                        )
                        yield ('error', {
                            'error': 'agent_failed',
                            'message': 'The clinical copilot is unavailable. Please try again.',
                        })
                    return

                if event == 'error':
                    yield ('error', data if isinstance(data, dict) else {
                        'error': 'agent_failed',
                        'message': 'The clinical copilot is unavailable. Please try again.',
                    })
                    return

                if isinstance(data, dict):
                    yield (event, data)

            # The loop ended without a terminal frame: the agent closed the
            # stream early (a crash, an eviction, something in the path cutting
            # it). Reported as an error so the caller is never left waiting.
            logger.error('agent stream ended without a terminal frame trace=%s', trace or '-')
            yield ('error', {
                'error': 'agent_failed',
                'message': 'The clinical copilot is unavailable. Please try again.',
            })
    finally:
        _agent_slots.release()
