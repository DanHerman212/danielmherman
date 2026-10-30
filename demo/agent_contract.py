"""Runtime validation for the private agent response consumed by Django."""

from typing import Any, TypedDict


class AgentToolCall(TypedDict, total=False):
    name: str
    args: dict[str, Any]
    response: dict[str, Any] | None
    # Whether the result can be obtained again by calling the tool again. The
    # site stores a turn so a later turn can be replayed, and keeps the result
    # only when it cannot: retrieval returns discharge-note text, and the store
    # is not where note text lives. Absent means derivable — guessing the other
    # way would put that text here.
    derivable: bool


class AgentSuccess(TypedDict, total=False):
    question: str
    answer: str
    guardrail_flags: list[str]
    tool_calls: list[AgentToolCall]
    a2ui: dict[str, Any] | None
    # What the turn presented besides its answer, composed by the agent and read by the
    # console: the scope pill, the records its markers resolve to, the next questions, and
    # the note that a free-text question was routed to a command.
    #
    # Named here rather than only in the browser, because `validate_agent_response` passes
    # them through and a field nothing declares is a field nothing misses when it stops
    # arriving. `routed_to` had no declaration on this side at all until
    # `test_payload_contract.py` asked which source produces every published key and the
    # answer for it was "none".
    scope: str | None
    references: list[dict[str, Any]]
    follow_ups: list[str]
    routed_to: str | None
    sources: list[dict[str, Any]]
    # Published records the answer rests on, if it rests on any. Separate from
    # `sources`, which is the discharge-note citation channel: that list is numbered,
    # renumbered and resolved against retrieved note passages, and a journal article
    # has no passage to resolve against.
    #
    # The whole tool result travels rather than only its articles, because `None`
    # ("no search ran") and an empty article list ("searched, found nothing") must not
    # render identically — and neither must `degraded` ("could not search at all").
    literature: dict[str, Any] | None
    #: Whether the agent checked this answer against, and grounded it in, the patient's
    #: own record. Optional because the two services deploy from separate triggers: a
    #: site revision that lands before an agent revision still answers, and a turn
    #: recorded before the field existed must read as "not verified" rather than as a
    #: rejected response.
    verified: bool
    #: The workflow the agent went through, in order, as the labels the reader watched.
    #: Carried in the answer rather than only in the SSE frames so the store can keep it
    #: and a refreshed browser can still show `Agent workflow - N steps`. Optional for the
    #: same reason as `verified`: an agent revision that predates the field still answers,
    #: and its turns simply have no steps to restore.
    steps: list[str]
    model: str
    code_revision: str
    # The pointer to the run behind this answer. Optional here rather than
    # required, unlike on the agent's side, because the two services deploy from
    # separate triggers: a site revision that lands before an agent revision
    # must keep answering, and a missing pointer is a lost convenience rather
    # than a broken answer.
    langfuse_trace_id: str
    mcp_transport: str


class AgentResponseError(ValueError):
    """The private agent returned a body outside the Django contract."""


def validate_agent_response(result: Any) -> AgentSuccess:
    """Validate known response fields while preserving the JSON wire shape."""
    if not isinstance(result, dict):
        raise AgentResponseError("Agent returned a malformed response.")

    for field in ("question", "answer", "model", "code_revision",
                  "langfuse_trace_id", "mcp_transport"):
        value = result.get(field)
        if value is not None and not isinstance(value, str):
            raise AgentResponseError(f"Agent returned an invalid {field} field.")

    flags = result.get("guardrail_flags")
    if flags is not None and (
        not isinstance(flags, list)
        or not all(isinstance(flag, str) for flag in flags)
    ):
        raise AgentResponseError("Agent returned malformed guardrail flags.")

    a2ui = result.get("a2ui")
    if a2ui is not None and not isinstance(a2ui, dict):
        raise AgentResponseError("Agent returned malformed A2UI data.")

    sources = result.get("sources")
    if sources is not None:
        if not isinstance(sources, list) or not all(
            isinstance(s, dict) and isinstance(s.get("cite"), int)
            for s in sources
        ):
            raise AgentResponseError("Agent returned malformed sources.")

    tool_calls = result.get("tool_calls")
    if tool_calls is not None:
        if not isinstance(tool_calls, list):
            raise AgentResponseError("Agent returned malformed tool calls.")
        for call in tool_calls:
            if not isinstance(call, dict) or not isinstance(call.get("name"), str):
                raise AgentResponseError("Agent returned malformed tool calls.")
            response = call.get("response")
            if response is not None and not isinstance(response, dict):
                raise AgentResponseError("Agent returned malformed tool calls.")
            args = call.get("args")
            if args is not None and not isinstance(args, dict):
                raise AgentResponseError("Agent returned malformed tool calls.")
            if "derivable" in call and not isinstance(call["derivable"], bool):
                raise AgentResponseError("Agent returned malformed tool calls.")

    # Checked here rather than trusted to the template: a malformed record renders as
    # a broken card, and a broken card beside a clinical answer is worse than a card
    # that says the search did not complete.
    literature = result.get("literature")
    if literature is not None:
        if not isinstance(literature, dict):
            raise AgentResponseError("Agent returned malformed literature.")
        articles = literature.get("articles")
        if articles is not None and not isinstance(articles, list):
            raise AgentResponseError("Agent returned malformed literature.")
        if not isinstance(literature.get("degraded", False), bool):
            raise AgentResponseError("Agent returned malformed literature.")

    # A boolean, not a truthy value. The badge says a clinical claim was checked against
    # the record, so `"false"` and `1` are both wrong in a way the reader cannot see.
    if "verified" in result and not isinstance(result["verified"], bool):
        raise AgentResponseError("Agent returned an invalid verified field.")

    # The workflow steps are written into the DOM of a restored turn, so a non-string in
    # the list is a crash on a page that loaded fine. The agent cleans its own list; this
    # is the boundary refusing to store what it would then have to trust.
    steps = result.get("steps")
    if steps is not None and (
        not isinstance(steps, list)
        or not all(isinstance(step, str) for step in steps)
    ):
        raise AgentResponseError("Agent returned malformed workflow steps.")

    return result