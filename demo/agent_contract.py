"""Runtime validation for the private agent response consumed by Django."""

from typing import Any, TypedDict


class AgentToolCall(TypedDict, total=False):
    name: str
    response: dict[str, Any] | None


class AgentSuccess(TypedDict, total=False):
    question: str
    answer: str
    guardrail_flags: list[str]
    tool_calls: list[AgentToolCall]
    a2ui: dict[str, Any] | None
    model: str
    mcp_transport: str


class AgentResponseError(ValueError):
    """The private agent returned a body outside the Django contract."""


def validate_agent_response(result: Any) -> AgentSuccess:
    """Validate known response fields while preserving the JSON wire shape."""
    if not isinstance(result, dict):
        raise AgentResponseError("Agent returned a malformed response.")

    for field in ("question", "answer", "model", "mcp_transport"):
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

    return result