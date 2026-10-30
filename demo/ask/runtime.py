"""Collaborators the frozen test suite controls, resolved through `demo.views`.

Every test in the locked suite patches one of three collaborators on `demo.views` —
`ask_agent`, `ask_agent_stream`, or `replay_turns` — because that module is where the
endpoints lived before Phase 4. A patch rebinds **one module's namespace**: if this
package imported `ask_agent` at module level, the patch would land on the binding in
`demo.views` while the endpoint called the binding here, and every mocked-agent test in
the suite would reach for the real service and fail.

So the three lookups go through `demo.views` at call time. That is the whole of the
compatibility surface between this package and a test suite that is read-only by
directive, and it is deliberately visible rather than spread across three modules: one
place to read, one place to delete when the suite is allowed to patch the new locations
instead.

It is not a behaviour change. `demo.views` re-exports the same objects this package
imports; a lookup through it returns the same function whenever nothing has patched it.
"""

from __future__ import annotations

import sys

#: The module the locked suite patches, and therefore the module these lookups read.
APP_NAMESPACE = 'demo.views'


def collaborator(name: str):
    """The current binding of `name` on `demo.views`, read at call time.

    Read from `sys.modules` rather than imported: `demo.views` imports this package to
    re-export its endpoints, so a module-level import of it here would be a cycle. By
    the time an endpoint runs, the app namespace is fully loaded.
    """
    module = sys.modules.get(APP_NAMESPACE)
    if module is None:  # pragma: no cover - only reachable if called while importing
        raise RuntimeError(f'{APP_NAMESPACE} is not imported yet')
    return getattr(module, name)
