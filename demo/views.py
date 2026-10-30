"""The demo's pages, and the names the app has always exported.

Two views live here: the public front door, and the console page a signed-in account is
given. Everything else moved to `demo/ask/` in Phase 4 of the frontend refactor, when
this module held 1,147 lines and seven jobs; what remains is the part that renders HTML.

The imports below are re-exports, not indirection. `demo/urls.py` and the frozen test
suite resolve `views.a2ui_ask`, `views.CORE_TOOLS` and `views._intent_for` from this
module, and they keep resolving: the objects are the same ones, imported once, and the
underscore names are the aliases the suite already imports by name. Nothing is wrapped,
so a call through here is a call to the real function with the real signature.

One consequence worth stating where it can be read: the ask layer looks its agent
collaborators up through this module at call time (`demo.ask.runtime`), because a patch
on `demo.views.ask_agent` rebinds this namespace and not the ask layer's own.
"""

import logging

from django.conf import settings
from django.contrib.auth.decorators import login_required
from django.shortcuts import render

from .agent_client import ask as ask_agent  # noqa: F401
from .agent_client import ask_stream as ask_agent_stream  # noqa: F401
from .ask.intent import (  # noqa: F401  (re-exported for the app namespace)
    APPROVED_REQUEST_FIELDS,
    CONVERSATION_FIELDS,
    MAX_QUESTION_CHARS,
    asked_from as _asked_from,
    intent_for as _intent_for,
    unsupported_field_error as _unsupported_field_error,
    with_declaration as _with_declaration,
    with_replay as _with_replay,
)
from .ask.recall import (  # noqa: F401
    HISTORY_LIMIT,
    MIN_PATIENT_QUERY_CHARS,
    PATIENT_LOOKUP_LIMIT,
    conversation_delete,
    conversation_detail,
    conversation_history,
    conversation_pin,
    patient_autocomplete,
)
from .ask.relay import (  # noqa: F401
    CORE_TOOLS,
    POLICY_REFUSALS,
    UNAVAILABLE,
    tools_errored as _tools_errored,
)
from .ask.telemetry import attach_score as _attach_score  # noqa: F401
from .ask.telemetry import feedback  # noqa: F401
from .ask.views import _streaming_ask, a2ui_ask  # noqa: F401
from .conversations import replay_turns  # noqa: F401
from .fixtures import SLASH_COMMANDS
from .models import DemoQuota, Profile

logger = logging.getLogger(__name__)


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
