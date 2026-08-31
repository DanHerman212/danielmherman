"""Server-side client for the private `agent` Cloud Run service.

The browser never talks to the agent. Both Cloud Run services are private, and
Django is the only public surface — so this module is what makes the whole
topology work: it mints a short-lived ID token per request and proxies the call.

Keeping the agent private removes a category of problems rather than solving
them: no CORS, no public prediction endpoint to rate-limit separately, no
credentials shipped to the client, and no way for a visitor to bypass the quota
by calling the agent directly.
"""

import logging
import subprocess
import threading

import requests
from django.conf import settings

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
        result = subprocess.run(
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
    if not isinstance(result, dict):
        raise AgentError('Agent returned a malformed response.')
    tool_calls = result.get('tool_calls')
    if tool_calls is not None:
        if not isinstance(tool_calls, list) or not all(
            isinstance(tc, dict)
            and (tc.get('response') is None or isinstance(tc.get('response'), dict))
            for tc in tool_calls
        ):
            raise AgentError('Agent returned malformed tool calls.')
    return result


def ask(question):
    """Send a question to the agent and return its parsed JSON response."""
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
        try:
            response = requests.post(
                f'{base}/ask',
                json={'question': question},
                headers={'Authorization': f'Bearer {token}'},
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
                'agent returned %s: %s', response.status_code, response.text[:2000]
            )
            raise AgentError(f'Agent returned HTTP {response.status_code}.')

        try:
            return _validated(response.json())
        except ValueError as exc:
            raise AgentError('Agent returned a non-JSON body.') from exc
    finally:
        _agent_slots.release()
