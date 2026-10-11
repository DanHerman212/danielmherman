# Enterprise Clinical Copilot — the front door

![The copilot's front door](images/front-door.png)

The clinician-facing application. It authenticates a user, holds the session, spends their
credits, and presents what the agent returns — the answer, the canvas and the evidence behind
it. It is the front door, and it is deliberately not the brain: no clinical reasoning happens
here, and nothing on this side decides what an answer may say. That belongs to the agent
service, which this application calls and then renders.

## Capabilities

| Capability | What it does |
|---|---|
| Entry | A public front door that introduces the copilot and carries the clinician into the console. |
| Authentication | Local password sign-in, with a per-user profile that a social identity can populate later without a migration. |
| Failed-login lockout | Five failed attempts on one username locks that account for an hour; a success resets the count. |
| Session management | Server-side sessions; the cookie is secure in production and expires when the browser closes. |
| Patient selection | `@` in the composer searches the admission cohort and pins one patient to the turn. |
| Commands | `/risk`, `/meds`, `/ehr` and `/pubmed` in the composer, each an explicit intent rather than a phrase to be interpreted. |
| Free text | A typed question is passed to the agent as the question. The two entry paths — command and question — are the same request. |
| Streaming | The answer arrives as a stream, and the stages of the run appear while it works. |
| Canvas | The agent's composed surface: a risk card with its factor bars, source cards for the note evidence, and a card for published literature. |
| Evidence | Every claim about the patient carries a numbered citation, resolved to the note section it came from. |
| Guardrails | Deterministic checks run before an answer is served, and the flags they raise travel with it. |
| Conversation | Turns are stored per conversation and pinned to one admission, so a follow-up is answered against what came before. |
| Credits | The demo runs on a per-user daily quota. A turn that fails is refunded rather than counted. |
| Authorization | The admission cohort is the server-side boundary. A request outside it is refused before any spend or any call to the agent. |
| Content security | A content-security policy with a path exemption for the rich-text editor, CSRF protection on every write, and clickjacking protection. |
| Observability | Each stored answer carries the trace id of the run that produced it, so an answer can be traced back to its execution. |

## What it is not

It holds no prompt, no tool contract, and no clinical threshold. The agent owns what to ask and
how to answer; this application owns who may ask, and how the answer is shown.

See [`../architecture/README.md`](../architecture/README.md) for where this runs, and the
agent and tool services it depends on.
