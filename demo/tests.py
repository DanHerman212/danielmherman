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
from django.test import Client, TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from .agent_client import AgentError
from .a2ui_canvas import compose_risk_canvas
from .models import DemoPatient, DemoQuota

AGENT_REPLY = {
    'question': 'Assess the 30-day readmission risk for admission 20924467.',
    'answer': 'Probability 0.131398, above the 0.12 threshold.',
    'tool_calls': [{'name': 'predict_readmission'}],
}

# A live agent reply shaped like the real /ask response: tool_calls carry the
# response payloads the A2UI canvas composer needs (predict + rag).
A2UI_AGENT_REPLY = {
    'question': 'Assess the 30-day readmission risk for admission 20924467.',
    'answer': ('Estimated 30-day unplanned readmission risk is 0.1314 (13.1%), '
               'above the 0.12 operating threshold.^[1]'),
    'tool_calls': [
        {'name': 'predict_readmission',
         'args': {'hadm_id': 20924467},
         'response': {
             'hadm_id': 20924467, 'probability': 0.131398, 'threshold': 0.12,
             'decision': 1, 'model_version': 'readmission-final-x',
             'feature_source': 'BigQuery',
             'top_factors': [
                 {'feature': 'oncology_flag', 'contribution': 0.2,
                  'direction': 'increases'}]}},
        {'name': 'rag_search',
         'args': {'hadm_id': 20924467, 'query': 'medications', 'top_k': 5},
         'response': {'hadm_id': 20924467, 'query': 'medications', 'returned': 1,
                      'passages': [
                          {'id': 'x_1', 'section': 'discharge_medications',
                           'text': 'Discharge Medications:\nwarfarin 4 mg QD',
                           'score': 0.2}]}},
    ],
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


@override_settings(DEMO_FIXTURE_MODE=False)
class AskEndpointTests(TestCase):
    # The live-agent path. Fixture mode is the default while the endpoints are
    # down, so these tests pin it off to exercise the mocked agent proxy.
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


class FixtureModeTests(TestCase):
    """The fixture path serves real captured payloads while endpoints are down."""

    def setUp(self):
        self.user = User.objects.create_user('demo', password='x')
        self.client.force_login(self.user)

    def _post(self, payload):
        return self.client.post(
            reverse('demo:ask'),
            data=json.dumps(payload),
            content_type='application/json',
        )

    def test_risk_chip_returns_real_predict_and_rag(self):
        response = self._post({'hadm_id': 20724182, 'chip': 'risk'})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['source'], 'fixture')
        names = [tc['name'] for tc in body['tool_calls']]
        self.assertEqual(names, ['predict_readmission', 'rag_search'])
        self.assertIn('19.5%', body['answer'])
        self.assertIn('^[1]', body['answer'])

    def test_meds_chip_without_captured_passages_is_honest_empty(self):
        # Erica Abernathy has a real risk payload but no captured rag passages,
        # so retrieval must be the honest empty (returned: 0), never fabricated.
        response = self._post({'hadm_id': 22489815, 'chip': 'meds'})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        rag = body['tool_calls'][0]['response']
        self.assertEqual(rag['returned'], 0)
        self.assertIn('No supporting note passage', body['answer'])

    def test_unknown_patient_is_structured_error(self):
        response = self._post({'hadm_id': 999999, 'chip': 'risk'})
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()['error'], 'unknown_patient')

    def test_free_text_is_rejected_in_fixture_mode(self):
        response = self._post({'question': 'Why was this patient flagged?'})
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()['error'], 'unsupported_in_fixture_mode')


class A2uiCanvasTests(TestCase):
    """The A2UI spike: server composes the canvas as A2UI messages."""

    def setUp(self):
        self.user = User.objects.create_user('demo', password='x')
        self.client.force_login(self.user)

    def test_compose_emits_custom_components(self):
        predict = {
            'hadm_id': 20724182, 'probability': 0.194512, 'threshold': 0.12,
            'decision': 1, 'base_value': -1.3, 'model_version': 'readmission-final-x',
            'feature_source': 'BigQuery',
            'top_factors': [{'feature': 'oncology_flag', 'contribution': 0.2894,
                             'direction': 'increases'}],
        }
        rag = {'passages': [{'id': 'x_brief_hospital_course_1',
                             'section': 'brief_hospital_course',
                             'text': 'Brief Hospital Course:\nsome course text',
                             'score': 0.2}]}
        env = compose_risk_canvas(predict, rag)
        self.assertEqual(env['surface_id'], 'risk-canvas')
        self.assertTrue(env['fallback_text'])
        comps = env['messages'][1]['updateComponents']['components']
        types = {c['component'] for c in comps}
        self.assertIn('RiskBar', types)
        self.assertIn('FactorBars', types)
        # The surface must point at the combined catalog the front-end registers.
        self.assertEqual(
            env['messages'][0]['createSurface']['catalogId'],
            'https://example.com/catalogs/readmission-risk-v1.json')

    def test_compose_without_predict_does_not_crash(self):
        """A non-risk question (no predict payload) still composes a canvas."""
        rag = {'passages': [{'id': 'x_medications_1',
                             'section': 'discharge_medications',
                             'text': 'Discharge Medications:\nwarfarin 4 mg QD',
                             'score': 0.2}]}
        env = compose_risk_canvas(None, rag)
        self.assertEqual(env['surface_id'], 'risk-canvas')
        comps = env['messages'][1]['updateComponents']['components']
        types = {c['component'] for c in comps}
        self.assertIn('SourceCard', types)
        self.assertNotIn('RiskBar', types)
        self.assertTrue(env['fallback_text'])

    def test_a2ui_ask_returns_messages_from_fixture(self):
        response = self.client.post(
            reverse('demo:a2ui_ask'),
            data=json.dumps({'hadm_id': 20724182, 'chip': 'risk'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn('a2ui', body)
        self.assertEqual(
            body['a2ui']['messages'][0]['createSurface']['surfaceId'],
            'risk-canvas')

    def test_a2ui_ask_free_text_gets_the_live_agent_message(self):
        """Screen 4 §4.1 — free text in fixture mode gets the clear message,
        never a confusing hadm_id error."""
        response = self.client.post(
            reverse('demo:a2ui_ask'),
            data=json.dumps({'question': 'Why was this patient flagged?'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 404)
        body = response.json()
        self.assertEqual(body['error'], 'unsupported_in_fixture_mode')
        self.assertIn('Free-text questions need the live agent', body['message'])

    def test_a2ui_console_requires_login(self):
        anon = Client()
        response = anon.get(reverse('demo:a2ui_console'))
        self.assertEqual(response.status_code, 302)
        self.assertIn('/accounts/login/', response['Location'])

    @override_settings(
        STORAGES={
            **settings.STORAGES,
            "staticfiles": {
                "BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"
            },
        }
    )
    def test_a2ui_console_renders_the_canvas_page(self):
        DemoPatient.objects.create(
            hadm_id=20724182, display_name='Leonard Castellano', age=70,
            sex='M', summary='70M', split_name='test',
        )
        response = self.client.get(reverse('demo:a2ui_console'))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'id="a2ui-root"')
        self.assertContains(response, 'id="a2ui-host"')
        self.assertContains(response, 'id="patient-list"')
        self.assertContains(response, 'id="thread"')
        self.assertContains(response, 'id="a2ui-toggle-msg"')
        self.assertContains(response, 'id="a2ui-messages"')
        # Screen 3: the trace toggle (top-right of the canvas pane) now drives
        # the whole trace journey in the A2UI demo.
        self.assertContains(response, 'id="trace-toggle"')
        # Cache-busted stylesheet + module links so the shell CSS and the A2UI
        # component module are never stale in the browser.
        self.assertContains(response, 'demo_splitpane.css?v=2')
        self.assertContains(response, 'demo_a2ui.js?v=5')


@override_settings(DEMO_FIXTURE_MODE=False)
class A2uiAskLiveTests(TestCase):
    """The A2UI live branch (Phase 3) — mirrors the custom `ask` live path.

    The agent is mocked; what needs proving here is that the A2UI endpoint
    does the same quota/refund/error dance as `ask`, and that the canvas is
    composed from the LIVE tool_calls, not the fixtures.
    """

    def setUp(self):
        self.user = User.objects.create_user('demo', password='x')
        self.client.force_login(self.user)
        DemoPatient.objects.create(
            hadm_id=20924467, display_name='Test Patient', age=71,
            sex='F', summary='71F · emergency admission', split_name='validation',
        )

    def _post(self, payload):
        return self.client.post(
            reverse('demo:a2ui_ask'),
            data=json.dumps(payload),
            content_type='application/json',
        )

    @patch('demo.views.ask_agent', return_value=dict(A2UI_AGENT_REPLY))
    def test_live_branch_composes_canvas_and_consumes_quota(self, mocked):
        response = self._post({'hadm_id': 20924467, 'chip': 'risk'})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['remaining'], 9)
        # The question is composed server-side so phrasing cannot be edited
        # into something leading (same as `ask`).
        self.assertIn('20924467', mocked.call_args.args[0])
        # The canvas is composed from the LIVE tool_calls.
        self.assertIn('a2ui', body)
        comps = body['a2ui']['messages'][1]['updateComponents']['components']
        types = {c['component'] for c in comps}
        self.assertIn('RiskBar', types)
        self.assertIn('FactorBars', types)
        self.assertIn('SourceCard', types)

    @patch('demo.views.ask_agent', return_value=dict(A2UI_AGENT_REPLY))
    def test_live_free_text_is_accepted(self, mocked):
        response = self._post({'question': 'Why was this patient flagged?'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(mocked.call_args.args[0], 'Why was this patient flagged?')

    @patch('demo.views.ask_agent')
    def test_quota_exhaustion_returns_429_without_calling_the_agent(self, mocked):
        DemoQuota.objects.create(user=self.user, daily_limit=0)
        response = self._post({'hadm_id': 20924467, 'chip': 'risk'})
        self.assertEqual(response.status_code, 429)
        mocked.assert_not_called()

    @patch('demo.views.ask_agent', side_effect=AgentError('boom'))
    def test_agent_failure_refunds_the_credit(self, mocked):
        DemoQuota.objects.create(user=self.user, daily_limit=5)
        response = self._post({'hadm_id': 20924467, 'chip': 'risk'})
        self.assertEqual(response.status_code, 502)
        self.assertEqual(DemoQuota.remaining(self.user), 5)

    @patch('demo.views.ask_agent', return_value=dict(A2UI_AGENT_REPLY))
    def test_bad_input_is_rejected_before_the_quota_is_touched(self, mocked):
        DemoQuota.objects.create(user=self.user, daily_limit=5)
        for payload in ({}, {'hadm_id': 'abc'}, {'hadm_id': -1}, {'question': '   '}):
            with self.subTest(payload=payload):
                self.assertEqual(self._post(payload).status_code, 400)
        self.assertEqual(DemoQuota.remaining(self.user), 5)
        mocked.assert_not_called()

    def test_malformed_json_is_rejected(self):
        response = self.client.post(
            reverse('demo:a2ui_ask'), data='not json', content_type='application/json'
        )
        self.assertEqual(response.status_code, 400)


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
        # The enterprise shell: brand, sidebar nav, and the split-pane surface.
        self.assertContains(response, 'id="demo-root"')
        self.assertContains(response, 'ECC')
        self.assertContains(response, 'Readmission Risk')
        self.assertContains(response, 'id="thread"')
        self.assertContains(response, 'id="canvas"')
        # Risk dots on the patient rows + pagination.
        self.assertContains(response, 'patient-row')
        self.assertContains(response, 'risk-dot')
        self.assertContains(response, 'page-next')
