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
    sources: list[dict[str, Any]]
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

    return result