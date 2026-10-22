"""Phase 02.5: the site half of the eight live UX defects.

Three kinds of assertion here, and each one exists because the defect it covers was
invisible to every test this repository had:

* the turn chrome the console draws (toolbar, rating transport, stage history) is
  present in the assets and wired to the endpoint that backs it — it was deleted in
  one commit and nothing noticed, because nothing asserted its presence;
* `verified` is carried across the wire and survives a round trip through the store,
  including for a turn recorded before the field existed;
* the literature payload the agent now withholds (an empty search is `None`, not an
  empty list of articles) does not leave the console drawing an empty PubMed card.
"""

import json
from pathlib import Path

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from django.urls import reverse

from .agent_contract import AgentResponseError, validate_agent_response
from .conversations import record_answer, turn_payloads
from .models import Conversation, DemoPatient

STATIC = Path(__file__).resolve().parents[1] / 'static' / 'js'
TEMPLATES = Path(__file__).resolve().parent / 'templates' / 'demo'


def _answer(**overrides):
    body = {
        'question': 'What did the discharge note say?',
        'answer': 'She was admitted with sepsis.^[1]',
        'verified': True,
        'guardrail_flags': [],
        'sources': [{'cite': 1, 'section': 'discharge_diagnosis', 'text': 'Sepsis.'}],
        'literature': None,
        'model': 'test',
        'code_revision': 'rev',
        'langfuse_trace_id': 'trace',
        'mcp_transport': 'stdio',
    }
    body.update(overrides)
    return body


class VerifiedContractTests(TestCase):
    def test_a_boolean_verified_survives_validation(self):
        assert validate_agent_response(_answer())['verified'] is True
        assert validate_agent_response(_answer(verified=False))['verified'] is False

    def test_a_turn_recorded_before_the_field_existed_is_still_accepted(self):
        body = _answer()
        del body['verified']

        assert validate_agent_response(body).get('verified') is None

    def test_a_non_boolean_is_refused(self):
        """The badge says a clinical claim was checked against the record."""
        for wrong in ('true', 1, [], {}):
            with self.assertRaises(AgentResponseError):
                validate_agent_response(_answer(verified=wrong))


class VerifiedRoundTripTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user('demo', password='x')

    def _conversation(self):
        patient = DemoPatient.objects.create(
            hadm_id=90000015, display_name='Chart Patient', age=70,
            sex='F', summary='70F', split_name='test',
        )
        return Conversation.objects.create(user=self.user, patient=patient)

    def test_the_badge_survives_a_turn_being_stored_and_replayed(self):
        conversation = self._conversation()

        record_answer(conversation, _answer())

        payloads = turn_payloads(conversation)
        assert payloads[-1]['verified'] is True

    def test_an_unverified_answer_replays_without_the_badge(self):
        conversation = self._conversation()

        record_answer(conversation, _answer(verified=False))

        assert turn_payloads(conversation)[-1]['verified'] is False

    def test_a_turn_stored_before_the_field_existed_replays_as_unverified(self):
        conversation = self._conversation()
        body = _answer()
        del body['verified']

        record_answer(conversation, body)

        assert turn_payloads(conversation)[-1]['verified'] is False


class TurnChromeTests(TestCase):
    """The controls that were deleted in `53240ec`, held by assertion.

    Read from the source rather than from a browser: this repository has no DOM
    harness, and the failure being guarded is not "the wrong glyph" but "the control
    and the endpoint behind it are gone". Both halves are asserted, because a button
    with no URL posts nowhere and a URL with no button is never posted to.
    """

    def setUp(self):
        self.canvas = (STATIC / 'copilot_canvas.js').read_text(encoding='utf-8')
        self.console = (TEMPLATES / 'a2ui_console.html').read_text(encoding='utf-8')

    def test_the_turn_toolbar_and_its_actions_are_drawn(self):
        for marker in ('cp-turn-toolbar', 'fa-copy', 'fa-download',
                       'fa-thumbs-up', 'fa-thumbs-down', 'cp-turn-actions'):
            assert marker in self.canvas, marker

    def test_the_rating_is_posted_to_the_feedback_endpoint(self):
        assert 'data-feedback-url' in self.canvas
        assert 'keepalive: true' in self.canvas
        assert "data-feedback-url=\"{% url 'demo:feedback' %}\"" in self.console

    def test_the_stage_history_disclosure_is_drawn(self):
        for marker in ('cp-stages', 'function stageHistory', 'stages.push(label)'):
            assert marker in self.canvas, marker

    def test_the_driver_click_is_heard_once_and_carries_its_intent(self):
        """One listener on the feed, and it passes the declaration on.

        Two listeners — one per turn and one on the feed — would send the question
        twice; a listener with no intent cannot tell the agent it is a drill-down.
        """
        assert self.canvas.count("addEventListener('a2ui-follow-up'") == 1
        assert 'askFollowUp(detail.question, [], detail.intent)' in self.canvas
        assert 'declaredIntent' in self.canvas

    def test_the_verified_badge_is_drawn_from_the_envelope(self):
        assert "payload.verified === true" in self.canvas
        assert 'Verified against the chart' in self.canvas
        # The correction notice keeps its own wording and its own trigger.
        assert 'Reconciled with medical record' in self.canvas

    def test_the_draft_renderer_strips_markdown_headings(self):
        assert '.replace(/^[ \\t]*#{1,6}[ \\t]+/gm' in self.canvas


@override_settings(DEMO_FIXTURE_MODE=True)
class FixtureLiteraryPayloadTests(TestCase):
    """An empty search must reach the console as `None`, never as `[]`.

    A `LiteratureList` with no records draws "no matching literature was found" over
    an answer that came from the notes — the console's half of defect 6.
    """

    def setUp(self):
        self.user = User.objects.create_user('demo', password='x')
        self.client.force_login(self.user)
        DemoPatient.objects.create(
            hadm_id=90000015, display_name='Chart Patient', age=70,
            sex='F', summary='70F', split_name='test',
        )

    def test_a_clinician_question_does_not_draw_a_literature_card(self):
        response = self.client.post(
            reverse('demo:a2ui_ask'),
            data=json.dumps({'hadm_id': 90000015, 'chip': 'meds'}),
            content_type='application/json',
        )
        body = response.json()
        self.assertEqual(response.status_code, 200, body)

        assert body.get('literature') is None
        components = body['a2ui']['messages'][1]['updateComponents']['components']
        assert 'LiteratureList' not in {c['component'] for c in components}
