# Enterprise Clinical Copilot — the front door

Presentation layer for full stack AI Application.  Designed to help health care professionals assess unplanned readmission risk for patients admitted for more than 24 hrs.

![The copilot's front door](../../images/front-door.png)

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
| Conversation | Turns are stored per conversation and pinned to one admission, so a follow-up is answered against what came before. |
| Credits | The demo runs on a per-user daily quota. A turn that fails is refunded rather than counted. |
| Authorization | The admission cohort is the server-side boundary. A request outside it is refused before any spend or any call to the agent. |
| Content security | A content-security policy with a path exemption for the rich-text editor, CSRF protection on every write, and clickjacking protection. |

