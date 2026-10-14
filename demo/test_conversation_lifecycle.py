"""The conversation lifecycle rules in the ask path (plan item 5).

The layer's decisions about money and continuity live here rather than in a
document: a conversation is pinned to the patient it opened with, only opening a
conversation spends a credit, the ceiling bounds the turns a single credit buys,
and a failed opening turn keeps both its credit and its place.

These are the rules a caller can feel, so each one is tested through the endpoint
rather than against the model, with the agent mocked. What the agent is asked is
covered by the harness suite; what matters here is what the site charges, records
and refuses.
"""

import json
from datetime import timedelta
from unittest.mock import patch

from django.conf import settings
from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from .models import Conversation, DemoPatient, DemoQuota

AGENT_REPLY = {
    'question': 'Assess the 30-day readmission risk for admission 90000009.',
    'answer': 'Estimated risk is 0.31 (31%), above the 0.12 threshold.^[1]',
    'guardrail_flags': [],
    'tool_calls': [],
    'a2ui': None,
    'sources': [],
    'model': 'gemini-3.1-flash-lite',
    'code_revision': 'abc1234',
    'mcp_transport': 'http',
}


class ConversationLifecycleTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user('demo', password='x')
        self.client.force_login(self.user)
        self.patient = DemoPatient.objects.create(
            hadm_id=90000009, display_name='Test Patient', age=63,
            sex='F', summary='63F', split_name='test',
        )
        self.other = DemoPatient.objects.create(
            hadm_id=90000010, display_name='Another Patient', age=70,
            sex='M', summary='70M', split_name='test',
        )

    def _post(self, payload):
        return self.client.post(
            reverse('demo:a2ui_ask'),
            data=json.dumps(payload),
            content_type='application/json',
        )

    def _quota(self):
        return DemoQuota.objects.get(user=self.user)

    @patch('demo.views.ask_agent', return_value=dict(AGENT_REPLY))
    def test_opening_a_conversation_spends_one_credit(self, _mocked):
        response = self._post({'hadm_id': 90000009, 'chip': 'risk'})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._quota().used, 1)
        conversation = Conversation.objects.get(user=self.user)
        self.assertEqual(conversation.patient_id, 90000009)
        self.assertEqual(conversation.turn_count, 1)

    @patch('demo.views.ask_agent', return_value=dict(AGENT_REPLY))
    def test_a_follow_up_spends_nothing(self, _mocked):
        first = self._post({'hadm_id': 90000009, 'chip': 'risk'})
        conversation = Conversation.objects.get(user=self.user)

        second = self._post({'hadm_id': 90000009, 'question': 'And potassium?',
                             'conversation_id': conversation.pk})

        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(self._quota().used, 1, 'a follow-up is already paid for')
        conversation.refresh_from_db()
        self.assertEqual(conversation.turn_count, 2)

    @patch('demo.views.ask_agent', return_value=dict(AGENT_REPLY))
    def test_a_follow_up_about_another_patient_is_refused(self, _mocked):
        self._post({'hadm_id': 90000009, 'chip': 'risk'})
        conversation = Conversation.objects.get(user=self.user)

        response = self._post({'hadm_id': 90000010, 'question': 'And potassium?',
                               'conversation_id': conversation.pk})

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['error'], 'conversation_patient_mismatch')
        conversation.refresh_from_db()
        self.assertEqual(conversation.patient_id, 90000009)
        self.assertEqual(conversation.turn_count, 1, 'a refused turn is not a turn')

    @patch('demo.views.ask_agent', return_value=dict(AGENT_REPLY))
    def test_the_ceiling_refuses_with_a_way_forward(self, _mocked):
        self._post({'hadm_id': 90000009, 'chip': 'risk'})
        conversation = Conversation.objects.get(user=self.user)
        Conversation.objects.filter(pk=conversation.pk).update(
            turn_count=settings.DEMO_CONVERSATION_TURN_CEILING)

        response = self._post({'hadm_id': 90000009, 'question': 'And potassium?',
                               'conversation_id': conversation.pk})

        self.assertEqual(response.status_code, 409)
        body = response.json()
        self.assertEqual(body['error'], 'conversation_full')
        self.assertIn('Start a new conversation', body['message'])
        self.assertEqual(self._quota().used, 1, 'a refused turn costs nothing')

    @patch('demo.views.ask_agent', return_value=dict(AGENT_REPLY))
    def test_an_expired_conversation_is_refused_even_before_the_sweep(self, _mocked):
        self._post({'hadm_id': 90000009, 'chip': 'risk'})
        conversation = Conversation.objects.get(user=self.user)
        Conversation.objects.filter(pk=conversation.pk).update(
            expires_at=timezone.now())

        response = self._post({'hadm_id': 90000009, 'question': 'And potassium?',
                               'conversation_id': conversation.pk})

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['error'], 'conversation_expired')

    @patch('demo.views.ask_agent', return_value=dict(AGENT_REPLY))
    def test_another_accounts_conversation_is_not_found(self, _mocked):
        self._post({'hadm_id': 90000009, 'chip': 'risk'})
        conversation = Conversation.objects.get(user=self.user)
        other_user = User.objects.create_user('other', password='x')
        self.client.force_login(other_user)

        response = self._post({'hadm_id': 90000009, 'question': 'And potassium?',
                               'conversation_id': conversation.pk})

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()['error'], 'unknown_conversation')

    @patch('demo.views.ask_agent')
    def test_a_failed_opening_turn_keeps_its_credit_and_its_conversation(
        self, mocked
    ):
        """The retry is then the first successful turn, and costs one credit."""
        from .agent_client import AgentError

        mocked.side_effect = AgentError('agent refused', spent=True)

        response = self._post({'hadm_id': 90000009, 'chip': 'risk'})

        self.assertEqual(response.status_code, 502)
        self.assertEqual(self._quota().used, 0, 'the credit came back')
        conversation = Conversation.objects.get(user=self.user)
        self.assertEqual(conversation.turn_count, 0)
        self.assertFalse(conversation.is_expired)

    @patch('demo.views.ask_agent', return_value=dict(AGENT_REPLY))
    def test_a_question_with_no_admission_still_answers_but_opens_nothing(
        self, _mocked
    ):
        """A conversation is about one patient; a question about none has none."""
        response = self._post({'question': 'What is the readmission threshold?'})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(Conversation.objects.count(), 0)
        self.assertEqual(self._quota().used, 1, 'it is still a paid question')

    @patch('demo.views.ask_agent', return_value=dict(AGENT_REPLY))
    def test_a_second_question_about_the_same_patient_continues_their_thread(
        self, _mocked
    ):
        """One thread per patient (UX ruling 2026-10-14).

        The rule this asserts was the opposite until then: a second question about
        the same patient used to open a second conversation, which is how a sidebar
        came to hold five threads for one patient. A question about a patient whose
        thread is live continues it, and a continuation is already paid for — the
        ceiling, not the daily allowance, is what bounds a thread.
        """
        self._post({'hadm_id': 90000009, 'chip': 'risk'})
        first = Conversation.objects.get(user=self.user)

        response = self._post({'hadm_id': 90000009, 'chip': 'meds'})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._quota().used, 1, 'a continuation is the same credit')
        self.assertEqual(Conversation.objects.filter(user=self.user).count(), 1)
        self.assertEqual(response.json()['conversation_id'], first.pk)

    @patch('demo.views.ask_agent', return_value=dict(AGENT_REPLY))
    def test_a_thread_is_reused_even_when_the_caller_names_another(self, _mocked):
        """A browser that has lost its place must not open a second thread.

        A new tab, a cleared store, or a reload after the id was swept all arrive
        with the admission and no id. Resolving by patient is what makes the id an
        optimisation rather than the thing that decides.
        """
        self._post({'hadm_id': 90000009, 'chip': 'risk'})
        first = Conversation.objects.get(user=self.user)

        response = self._post({'hadm_id': 90000009, 'chip': 'meds'})

        self.assertEqual(response.json()['conversation_id'], first.pk)
        self.assertEqual(Conversation.objects.filter(user=self.user).count(), 1)

    @patch('demo.views.ask_agent', return_value=dict(AGENT_REPLY))
    def test_a_different_patient_gets_a_thread_of_their_own(self, _mocked):
        self._post({'hadm_id': 90000009, 'chip': 'risk'})
        self._post({'hadm_id': 90000010, 'chip': 'risk'})

        self.assertEqual(Conversation.objects.filter(user=self.user).count(), 2)
        self.assertEqual(self._quota().used, 2, 'two patients, two credits')

    @patch('demo.views.ask_agent', return_value=dict(AGENT_REPLY))
    def test_an_expired_thread_is_not_the_one_continued(self, _mocked):
        """The window ends a thread. A patient whose thread has expired gets a new
        one rather than a refusal, which is what the expiry is for."""
        self._post({'hadm_id': 90000009, 'chip': 'risk'})
        stale = Conversation.objects.get(user=self.user)
        Conversation.objects.filter(pk=stale.pk).update(
            expires_at=timezone.now() - timedelta(hours=1))

        response = self._post({'hadm_id': 90000009, 'chip': 'risk'})

        self.assertNotEqual(response.json()['conversation_id'], stale.pk)
        self.assertEqual(Conversation.objects.filter(user=self.user).count(), 2)
