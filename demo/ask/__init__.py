"""The ask-layer package: one responsibility per module, and one public endpoint.

Split from `demo/views.py` in Phase 4 of the frontend refactor, which had 1,147 lines
mixing seven jobs. The seams are the ones the refactor plan named:

    intent       what a request means, and what is sent to the agent
    threads      which conversation a turn belongs to, and what it costs
    envelope     the one builder of the answer envelope, for both transports
    relay        SSE framing, the stream relay, and the refund policy on it
    recall       the sidebar, a restored thread, pin, delete, patient lookup
    telemetry    how the reader rated a turn
    views        the endpoint that orchestrates the four above
    runtime      the collaborators the frozen test suite patches

`demo/views.py` remains the page module and a re-export shim, so `demo/urls.py` and the
locked test suite resolve the same names they always have.
"""

from __future__ import annotations

from .views import a2ui_ask  # noqa: F401  (the package's one public endpoint)

__all__ = ['a2ui_ask']
