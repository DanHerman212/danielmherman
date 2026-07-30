"""Tests for the demo BFF: auth, quota, and the agent proxy.

The agent itself is mocked throughout. Its behaviour is already covered by the
harness Tier 1 suite against the real deployed service; what needs proving here
is that Django refuses to call it when it should, and accounts correctly when
it does.
"""

import json
from datetime import timedelta
from unittest.mock import patch

from django.conf import settings
from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from .agent_client import AgentError
from .models import DemoPatient, DemoQuota

AGENT_REPLY = {
    'question': 'Assess the 30-day readmission risk for admission 20924467.',
    'answer': 'Probability 0.131398, above the 0.12 threshold.',
    'tool_calls': [{'name': 'predict_readmission'}],
}


class DemoAuthTests(TestCase):
    def test_console_requires_login(self):
        response = self.client.get(reverse('demo:console'))
        self.assertEqual(response.status_code, 302)
        self.assertIn('/accounts/login/', response['Location'])

    def test_ask_requires_login(self):
        response = self.client.post(
            reverse('demo:ask'), data='{}', content_type='application/json'
        )
        self.assertEqual(response.status_code, 302)

    def test_no_signup_route_exists(self):
        """Accounts are issued. A signup URL would quietly undo that."""
        from django.urls import NoReverseMatch
        with self.assertRaises(NoReverseMatch):
            reverse('signup')


class QuotaTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user('demo', password='x')

    def test_consume_stops_at_the_limit(self):
        DemoQuota.objects.create(user=self.user, daily_limit=3)
        self.assertEqual([DemoQuota.consume(self.user) for _ in range(4)],
                         [True, True, True, False])
        self.assertEqual(DemoQuota.remaining(self.user), 0)

    def test_counter_resets_on_a_new_day(self):
        quota = DemoQuota.objects.create(user=self.user, daily_limit=2, used=2)
        quota.period_start = timezone.localdate() - timedelta(days=1)
        quota.save(update_fields=['period_start'])

        self.assertTrue(DemoQuota.consume(self.user))
        quota.refresh_from_db()
        self.assertEqual(quota.used, 1)
        self.assertEqual(quota.period_start, timezone.localdate())

    def test_remaining_reports_a_stale_day_as_full(self):
        quota = DemoQuota.objects.create(user=self.user, daily_limit=5, used=5)
        quota.period_start = timezone.localdate() - timedelta(days=1)
        quota.save(update_fields=['period_start'])
        self.assertEqual(DemoQuota.remaining(self.user), 5)

    def test_refund_returns_a_credit(self):
        DemoQuota.objects.create(user=self.user, daily_limit=2)
        DemoQuota.consume(self.user)
        DemoQuota.refund(self.user)
        self.assertEqual(DemoQuota.remaining(self.user), 2)

    def test_refund_cannot_go_negative(self):
        DemoQuota.objects.create(user=self.user, daily_limit=2)
        DemoQuota.refund(self.user)
        DemoQuota.refund(self.user)
        self.assertEqual(DemoQuota.objects.get(user=self.user).used, 0)

    def test_consume_creates_a_quota_on_first_use(self):
        self.assertTrue(DemoQuota.consume(self.user))
        self.assertTrue(DemoQuota.objects.filter(user=self.user).exists())


class AskEndpointTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user('demo', password='x')
        self.client.force_login(self.user)
        DemoPatient.objects.create(
            hadm_id=20924467, display_name='Test Patient', age=71,
            sex='F', summary='71F · emergency admission', split_name='validation',
        )

    def _post(self, payload):
        return self.client.post(
            reverse('demo:ask'),
            data=json.dumps(payload),
            content_type='application/json',
        )

    @patch('demo.views.ask_agent', return_value=dict(AGENT_REPLY))
    def test_happy_path(self, mocked):
        response = self._post({'hadm_id': 20924467})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn('0.131398', body['answer'])
        self.assertEqual(body['remaining'], 9)
        # The question is composed server-side so phrasing cannot be edited
        # into something leading.
        self.assertIn('20924467', mocked.call_args.args[0])

    @patch('demo.views.ask_agent', return_value=dict(AGENT_REPLY))
    def test_free_text_question_is_accepted(self, mocked):
        response = self._post({'question': 'Why was this patient flagged?'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(mocked.call_args.args[0], 'Why was this patient flagged?')

    @patch('demo.views.ask_agent')
    def test_quota_exhaustion_returns_429_without_calling_the_agent(self, mocked):
        DemoQuota.objects.create(user=self.user, daily_limit=0)
        response = self._post({'hadm_id': 20924467})
        self.assertEqual(response.status_code, 429)
        mocked.assert_not_called()

    @patch('demo.views.ask_agent', side_effect=AgentError('boom'))
    def test_agent_failure_refunds_the_credit(self, mocked):
        DemoQuota.objects.create(user=self.user, daily_limit=5)
        response = self._post({'hadm_id': 20924467})
        self.assertEqual(response.status_code, 502)
        self.assertEqual(DemoQuota.remaining(self.user), 5)

    @patch('demo.views.ask_agent')
    def test_bad_input_is_rejected_before_the_quota_is_touched(self, mocked):
        DemoQuota.objects.create(user=self.user, daily_limit=5)
        for payload in ({}, {'hadm_id': 'abc'}, {'hadm_id': -1}, {'question': '   '}):
            with self.subTest(payload=payload):
                self.assertEqual(self._post(payload).status_code, 400)
        self.assertEqual(DemoQuota.remaining(self.user), 5)
        mocked.assert_not_called()

    def test_malformed_json_is_rejected(self):
        response = self.client.post(
            reverse('demo:ask'), data='not json', content_type='application/json'
        )
        self.assertEqual(response.status_code, 400)

    def test_get_is_not_allowed(self):
        self.assertEqual(self.client.get(reverse('demo:ask')).status_code, 405)

    @patch('demo.views.ask_agent', side_effect=AgentError('https://agent-internal/ask 403'))
    def test_agent_internals_are_not_leaked_in_the_main_message(self, mocked):
        response = self._post({'hadm_id': 20924467})
        self.assertNotIn('agent-internal', response.json()['error'])


class ConsoleTests(TestCase):
    # The page references a static file through {% static %}, and the project
    # serves static assets with a *manifest* storage backend, which raises for
    # any file collectstatic has not hashed yet. That is correct in production
    # and useless in a test, where no collectstatic has run — so the test uses
    # the plain backend and asserts on the markup rather than on the pipeline.
    @override_settings(
        STORAGES={
            **settings.STORAGES,
            "staticfiles": {
                "BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"
            },
        }
    )
    def test_console_lists_patients_and_labels_names_as_synthetic(self):
        user = User.objects.create_user('demo', password='x')
        self.client.force_login(user)
        DemoPatient.objects.create(
            hadm_id=1, display_name='Test Patient', age=71,
            sex='F', summary='71F', split_name='test',
        )
        response = self.client.get(reverse('demo:console'))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'Test Patient')
        # Section 14's obligation: the UI must never imply these are real names.
        self.assertContains(response, 'synthetic')
        # The fallback element must exist even when the renderer never boots.
        self.assertContains(response, 'id="prose"')
