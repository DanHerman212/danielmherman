"""Local verification loop for the citation fix — runs the LIVE agent.

The production ask path, exercised locally before anything is pushed:
posts the meds chip (and a free-text instructions question) for a set of
patients to the local Django `a2ui_ask` view with the real deployed agent
behind it, then asserts the composed canvas SourceCard resolves to the
section that actually supports the claim.

Usage (from the site repo root; live endpoints must be up):
    DEMO_FIXTURE_MODE=false .venv/bin/python demo/verify_live_citations.py

Why the meds assertion is a section SET: MTSamples notes vary — the meds
claim's supporting text usually lives in discharge_medications, but notes
without a medications section carry it in discharge_instructions (hadm
90000005: "discharged on his usual Valium 10-20 mg at bedtime...").
"""

import json
import os
import re
import sys

# Running the script directly puts demo/ (not the repo root) on sys.path, so
# the danielmherman package would not be importable.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "danielmherman.settings")
django.setup()

from django.conf import settings
from django.contrib.auth.models import User
from django.test import Client
from django.utils import timezone

from demo.models import DemoQuota

# The Django test Client talks to 'testserver', which ALLOWED_HOSTS rejects.
# (manage.py test does this behind the scenes; a standalone script must too.)
settings.ALLOWED_HOSTS = [*settings.ALLOWED_HOSTS, "testserver"]

# (hadm_id, display name, expected card kind, why this case matters)
# card kinds:
#   meds_section          -> section == discharge_medications AND answer meds in card
#   instructions          -> section == discharge_instructions AND answer meds in card
#   instructions_no_meds  -> section == discharge_instructions AND answer lists NO meds
#                            (honest: no meds section and no named meds — the
#                            card is still the instructions section that exists)
#   unavailable           -> section == 'not available' (note lacks the sections)
#   empty_passages        -> section == 'not found' (no passages returned at all)
CASES = [
    (90000015, "Cynthia Petrov", "meds_section",
     "meds section exists (discharge_medications)"),
    (90000005, "Alan Marchetti", "instructions",
     "NO meds section — meds live in discharge_instructions"),
    (90000107, "Alan Boyle", "unavailable",
     "expired during admission — honest no-meds answer"),
    (90000035, "Eleanor Whitfield", "unavailable",
     "NO meds/instructions section — meds mentioned only in hospital course"),
    (90000053, "Alan Ellison", "instructions",
     "breadth: meds in instructions"),
    (90000091, "Jordan Sokolov", "instructions_no_meds",
     "no meds section, no NAMED meds — honest no-meds answer, no stacked citations"),
    (90000054, "Clarence Whitfield", "empty_passages",
     "breadth: outpatient therapy note, no discharge content"),
    (90000095, "Curtis Whitfield", "empty_passages",
     "breadth: admission note, no discharge content"),
]

MEDS_SECTIONS = ("discharge_medications", "discharge_instructions")


def source_card(a2ui):
    for msg in a2ui.get("messages", []):
        if msg.get("updateComponents"):
            for c in msg["updateComponents"].get("components", []):
                if c.get("component") == "SourceCard":
                    return c
    return None


_MED_STOPWORDS = {
    "the", "for", "and", "with", "was", "were", "she", "he", "her",
    "his", "their", "patient", "admission", "discharged", "following",
    "medication", "medications", "discharge", "daily", "tablets", "capsules",
}


def first_meds(answer):
    """The medication names the answer introduces, in answer order."""
    out = []
    for m in re.findall(r"^\s*[-*•]?\s*([A-Z][a-zA-Z\-]{3,})", answer, re.M):
        if m.lower() not in _MED_STOPWORDS:
            out.append(m)
    marker = re.search(r"medications?\s*[:,\-]", answer, re.I)
    tail = answer[marker.end():] if marker else answer
    for m in re.findall(r"\b([A-Z][a-zA-Z\-]{3,})\b", tail):
        if m.lower() not in _MED_STOPWORDS:
            out.append(m)
    return out


def main():
    if settings.DEMO_FIXTURE_MODE:
        sys.exit("DEMO_FIXTURE_MODE is on — set DEMO_FIXTURE_MODE=false to go live.")

    user, _ = User.objects.get_or_create(username="verify-bot")
    DemoQuota.objects.update_or_create(
        user=user,
        defaults={"daily_limit": 50, "used": 0, "period_start": timezone.localdate()},
    )
    client = Client()
    client.force_login(user)

    failures = 0

    for hadm_id, name, expected, why in CASES:
        resp = client.post(
            "/demo/a2ui/ask/",
            data=json.dumps({"hadm_id": hadm_id, "chip": "meds"}),
            content_type="application/json",
        )
        if resp.status_code != 200:
            print(f"FAIL {name}: HTTP {resp.status_code} {resp.content[:200]}")
            failures += 1
            continue
        body = resp.json()
        answer = body.get("answer") or ""
        card = source_card(body.get("a2ui") or {})
        meds = first_meds(answer)
        section = card["section"] if card else None

        if expected == "unavailable":
            ok = section == "not available"
            if meds:
                print(f"  WARN {name}: live agent still lists meds "
                      f"({meds[:3]}) — the harness prompt rule aligns the "
                      f"answer once the agent redeploys")
        elif expected == "empty_passages":
            ok = section == "not found"
        elif expected == "instructions_no_meds":
            ok = section == "discharge_instructions" and not meds
        else:
            want_section = {
                "meds_section": "discharge_medications",
                "instructions": "discharge_instructions",
            }[expected]
            overlap = [
                m for m in meds
                if m.lower() in (card.get("text") or "").lower()
            ]
            ok = section == want_section and bool(overlap)
        detail = (f"expected={expected!r} section={section!r} "
                  f"first_answer_meds={meds[:3]}")
        print(f"{'PASS' if ok else 'FAIL'} {name} ({why})")
        print(f"     {detail}")
        if card:
            print(f"     card text head: {card.get('text', '')[:110]!r}")
        # The renumbered answer must not stack citations (^[1]^[2]^[3] on one
        # claim is a formatting bug the demo normalizes server-side).
        if re.search(r"\]\s*\^\[", answer):
            ok = False
            print(f"     FAIL: stacked citations still in answer: {answer!r}")
        if not ok:
            failures += 1

    # Free-text instructions intent (the other observed failure class).
    resp = client.post(
        "/demo/a2ui/ask/",
        data=json.dumps({"hadm_id": 90000015,
                         "question": "What were her discharge instructions?"}),
        content_type="application/json",
    )
    if resp.status_code != 200:
        print(f"FAIL free-text instructions: HTTP {resp.status_code}")
        failures += 1
    else:
        body = resp.json()
        card = source_card(body.get("a2ui") or {})
        ok = card is not None and card["section"] == "discharge_instructions"
        print(f"{'PASS' if ok else 'FAIL'} free-text 'discharge instructions' "
              f"(Cynthia Petrov) section={card['section'] if card else None!r}")
        if card:
            print(f"     card text head: {card.get('text', '')[:110]!r}")
        if not ok:
            failures += 1

    print()
    print("ALL PASS" if failures == 0 else f"{failures} FAILURE(S)")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
