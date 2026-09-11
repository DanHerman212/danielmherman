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
from .models import DemoPatient, DemoQuota

# A live agent reply shaped like the real /ask response: the agent composes
# the full presentation contract (a2ui, sources) and
# Django is a pass-through. The mock carries a minimal-but-real envelope so
# the view proves it forwards rather than recomposes.
A2UI_AGENT_REPLY = {
    'question': 'Assess the 30-day readmission risk for admission 90000009.',
    'answer': ('Estimated 30-day unplanned readmission risk is 0.1540 (15.4%), '
               'above the 0.12 operating threshold.^[1]'),
    'tool_calls': [
        {'name': 'predict_readmission',
         'args': {'hadm_id': 90000009},
         'response': {
             'hadm_id': 90000009, 'probability': 0.154016, 'threshold': 0.12,
             'decision': 1, 'model_version': 'readmission-final-x',
             'feature_source': 'synthetic',
             'top_factors': [
                 {'feature': 'oncology_flag', 'contribution': 0.2,
                  'direction': 'increases'}]}},
        {'name': 'rag_search',
         'args': {'hadm_id': 90000009, 'query': 'medications', 'top_k': 5},
         'response': {'hadm_id': 90000009, 'query': 'medications', 'returned': 1,
                      'passages': [
                          {'id': 'x_1', 'section': 'discharge_medications',
                           'text': 'Discharge Medications:\nwarfarin 4 mg QD',
                           'score': 0.2}]}},
    ],
    'a2ui': {
        'surface_id': 'risk-canvas',
        'audience': ['user'],
        'messages': [
            {'version': 'v0.9', 'createSurface': {
                'surfaceId': 'risk-canvas',
                'catalogId': 'https://example.com/catalogs/readmission-risk-v1.json'}},
            {'version': 'v0.9', 'updateComponents': {
                'surfaceId': 'risk-canvas',
                'components': [
                    {'id': 'root', 'component': 'Card', 'child': 'body'},
                    {'id': 'body', 'component': 'Column',
                     'children': ['risk', 'factors', 'source']},
                    {'id': 'risk', 'component': 'RiskBar',
                     'probability': 0.154016, 'threshold': 0.12, 'band': 'borderline'},
                    {'id': 'factors', 'component': 'FactorBars', 'factors': []},
                    {'id': 'source', 'component': 'SourceCard', 'cite': 1,
                     'section': 'discharge_medications',
                     'text': 'warfarin 4 mg QD', 'query': 'medications'},
                ]}},
        ],
        'fallback_text': 'Admission 90000009: 15.4% 30-day readmission probability.',
    },
    'sources': [{'cite': 1, 'section': 'discharge_medications',
                 'text': 'warfarin 4 mg QD', 'query': 'medications'}],
}


class DemoAuthTests(TestCase):
    def test_guide_requires_login(self):
        response = self.client.get(reverse('demo:guide'))
        self.assertEqual(response.status_code, 302)
        self.assertIn('/accounts/login/', response['Location'])

    def test_guide_renders_journeys_for_logged_in_user(self):
        user = User.objects.create_user(username='dr', password='x')
        self.client.force_login(user)
        # Plain storage: rendering console-derived templates needs no
        # collected-manifest entry (the site uses CompressedManifest storage).
        with override_settings(STORAGES={
            **settings.STORAGES,
            'staticfiles': {
                'BACKEND': 'django.contrib.staticfiles.storage.'
                           'StaticFilesStorage'},
        }):
            response = self.client.get(reverse('demo:guide'))
        self.assertEqual(response.status_code, 200)
        body = response.content.decode()
        for anchor in (
            'journey-risk', 'journey-ask', 'journey-verify',
        ):
            self.assertIn(f'id="{anchor}"', body)
        self.assertIn('Demo User Guide', body)
        self.assertIn(f'action="{reverse("logout")}"', body)
        # Every journey has a real live screenshot wired in (no "pending"
        # placeholder), so the guide shows the actual demo, not a stub.
        for img in ('images/guide/risk-card.png', 'images/guide/agent-chat.png',
                    'images/guide/source-panel.png'):
            self.assertIn('images/guide/', body)
            self.assertIn(img, body)
        self.assertNotIn('Screenshot: ', body)
        self.assertNotIn('(pending)', body)

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
        today = timezone.localdate()
        self.assertEqual([DemoQuota.consume(self.user) for _ in range(4)],
                         [today, today, today, None])
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
        period = DemoQuota.consume(self.user)
        DemoQuota.refund(self.user, period)
        self.assertEqual(DemoQuota.remaining(self.user), 2)

    def test_refund_cannot_go_negative(self):
        DemoQuota.objects.create(user=self.user, daily_limit=2)
        today = timezone.localdate()
        DemoQuota.refund(self.user, today)
        DemoQuota.refund(self.user, today)
        self.assertEqual(DemoQuota.objects.get(user=self.user).used, 0)

    def test_refund_only_targets_the_period_it_debited(self):
        """A refund presented after the counter rolled to a new day must be
        dropped, not deducted from the new day's count (S1-07)."""
        DemoQuota.objects.create(user=self.user, daily_limit=5)
        yesterday = timezone.localdate() - timedelta(days=1)
        DemoQuota.consume(self.user)  # today's counter: used=1
        DemoQuota.refund(self.user, yesterday)  # stale claim token
        self.assertEqual(DemoQuota.objects.get(user=self.user).used, 1)

    @override_settings(DEMO_DAILY_REFUND_CAP=2)
    def test_billed_refunds_are_capped_per_day(self):
        """Refunds for failures that still bought model spend stop at the cap,
        or a request engineered to always fail downstream loops the quota
        into unmetered spend (S1-09)."""
        DemoQuota.objects.create(user=self.user, daily_limit=10)
        for _ in range(3):
            period = DemoQuota.consume(self.user)
            DemoQuota.refund(self.user, period)  # spent=True default
        self.assertEqual(DemoQuota.objects.get(user=self.user).used, 1)
        self.assertEqual(DemoQuota.remaining(self.user), 9)

    @override_settings(DEMO_DAILY_REFUND_CAP=0)
    def test_zero_spend_refunds_bypass_the_cap(self):
        """Pre-dispatch failures (connection refused, busy) provably billed
        nothing and refund freely."""
        DemoQuota.objects.create(user=self.user, daily_limit=10)
        period = DemoQuota.consume(self.user)
        DemoQuota.refund(self.user, period, spent=False)
        self.assertEqual(DemoQuota.remaining(self.user), 10)

    def test_consume_creates_a_quota_on_first_use(self):
        self.assertTrue(DemoQuota.consume(self.user))
        self.assertTrue(DemoQuota.objects.filter(user=self.user).exists())


@override_settings(DEMO_FIXTURE_MODE=True)
class A2uiFixtureContractTests(TestCase):
    """Fixture mode must emit the agent's full presentation contract.

    The canvas/citation unit tests moved to the agent repo
    (tests/agent/test_a2ui.py, test_citations.py) with the logic itself; what
    needs proving HERE is only that fixture mode returns the same contract the
    live agent returns, so the browser cannot tell the difference.
    """

    def setUp(self):
        self.user = User.objects.create_user('demo', password='x')
        self.client.force_login(self.user)

    def test_a2ui_ask_returns_the_full_contract_from_fixture(self):
        response = self.client.post(
            reverse('demo:a2ui_ask'),
            data=json.dumps({'hadm_id': 90000017, 'chip': 'risk'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        # The canvas comes pre-composed by the agent's own composer.
        self.assertEqual(
            body['a2ui']['messages'][0]['createSurface']['surfaceId'],
            'risk-canvas')
        comps = body['a2ui']['messages'][1]['updateComponents']['components']
        types = {c['component'] for c in comps}
        self.assertIn('RiskBar', types)
        self.assertIn('SourceCard', types)
        # Resolved sources are attached by the agent, not recomposed here.
        self.assertIn('sources', body)
        self.assertIsInstance(body['sources'], list)
        # Fixture honesty markers survive.
        self.assertEqual(body['source'], 'fixture')
        self.assertIn('remaining', body)


@override_settings(DEMO_FIXTURE_MODE=True)
class A2uiConsolePageTests(TestCase):
    """The A2UI console page renders the shell the canvas mounts into."""

    def setUp(self):
        self.user = User.objects.create_user('demo', password='x')
        self.client.force_login(self.user)

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
            hadm_id=90000017, display_name='Eugene Sokolov', age=83,
            sex='M', summary='83M', split_name='test',
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
        # The production demo (A2UI) header carries the Demo User Guide link.
        self.assertContains(response, 'Demo User Guide')
        self.assertContains(response, reverse('demo:guide'))
        # And a POST logout control next to the signed-in identity.
        self.assertContains(response, 'action="%s"' % reverse('logout'))
        self.assertContains(response, 'name="csrfmiddlewaretoken"')
        # Cache-busted stylesheet + module links so the shell CSS and the A2UI
        # component module are never stale in the browser.
        self.assertContains(response, 'demo_splitpane.css?v=7')
        self.assertContains(response, 'demo_a2ui.js?v=12')


@override_settings(DEMO_FIXTURE_MODE=False)
class A2uiAskLiveTests(TestCase):
    """The A2UI live branch — the agent is mocked; what needs proving here is
    that the endpoint does the quota/refund/error dance correctly and forwards
    the agent's presentation contract unchanged."""

    def setUp(self):
        self.user = User.objects.create_user('demo', password='x')
        self.client.force_login(self.user)
        DemoPatient.objects.create(
            hadm_id=90000009, display_name='Test Patient', age=63,
            sex='F', summary='63F · urgent admission', split_name='test',
        )

    def test_retired_presentation_modules_are_gone(self):
        """The citation/canvas logic moved to the agent — these must not
        reappear as a second interpretation layer in the BFF."""
        import importlib
        for module in ('demo.a2ui_canvas', 'demo.feature_labels'):
            with self.assertRaises(ModuleNotFoundError):
                importlib.import_module(module)

    def _post(self, payload):
        return self.client.post(
            reverse('demo:a2ui_ask'),
            data=json.dumps(payload),
            content_type='application/json',
        )

    @patch('demo.views.ask_agent', return_value=dict(A2UI_AGENT_REPLY))
    def test_live_branch_passes_the_agent_contract_through(self, mocked):
        response = self._post({'hadm_id': 90000009, 'chip': 'risk'})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['remaining'], 9)
        # The question is composed server-side so phrasing cannot be edited
        # into something leading.
        self.assertIn('90000009', mocked.call_args.args[0])
        # The presentation contract arrives from the agent pre-composed;
        # Django must forward it byte-for-byte, not recompose it.
        self.assertEqual(body['a2ui'], A2UI_AGENT_REPLY['a2ui'])
        self.assertEqual(body['sources'], A2UI_AGENT_REPLY['sources'])
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

    @patch('demo.views.ask_agent', return_value=dict(A2UI_AGENT_REPLY))
    def test_live_free_text_embeds_the_selected_admission(self, mocked):
        """Free text sent alongside a selected patient must embed the admission
        (like the chips), so the agent never has to ask for the hadm_id."""
        response = self._post({'hadm_id': 90000009,
                               'question': 'Why was this patient flagged?'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(mocked.call_args.args[0],
                         'Why was this patient flagged? For admission 90000009.')

    @patch('demo.views.ask_agent', return_value=dict(A2UI_AGENT_REPLY))
    def test_chip_maps_to_chip_question(self, mocked):
        """The meds chip must send the medications question (not the risk
        question), so the live agent actually calls rag_search and cites ^[n]."""
        self._post({'hadm_id': 90000009, 'chip': 'meds'})
        self.assertIn('medications', mocked.call_args.args[0])
        self.assertIn('90000009', mocked.call_args.args[0])

    @patch('demo.views.ask_agent', return_value=dict(A2UI_AGENT_REPLY))
    def test_summarize_chip_maps_to_summarize_question(self, mocked):
        self._post({'hadm_id': 90000009, 'chip': 'summarize'})
        self.assertIn('Summarize', mocked.call_args.args[0])
        self.assertIn('90000009', mocked.call_args.args[0])

    @patch('demo.views.ask_agent')
    def test_unknown_chip_rejected_before_quota(self, mocked):
        DemoQuota.objects.create(user=self.user, daily_limit=5)
        response = self._post({'hadm_id': 90000009, 'chip': 'bogus'})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(DemoQuota.remaining(self.user), 5)
        mocked.assert_not_called()

    @patch('demo.views.ask_agent')
    def test_quota_exhaustion_returns_429_without_calling_the_agent(self, mocked):
        DemoQuota.objects.create(user=self.user, daily_limit=0)
        response = self._post({'hadm_id': 90000009, 'chip': 'risk'})
        self.assertEqual(response.status_code, 429)
        mocked.assert_not_called()

    @patch('demo.views.ask_agent', side_effect=AgentError('boom'))
    def test_agent_failure_refunds_the_credit(self, mocked):
        DemoQuota.objects.create(user=self.user, daily_limit=5)
        response = self._post({'hadm_id': 90000009, 'chip': 'risk'})
        self.assertEqual(response.status_code, 502)
        self.assertEqual(DemoQuota.remaining(self.user), 5)

    @patch('demo.views.ask_agent')
    def test_errored_predict_tool_refunds_and_returns_502(self, mocked):
        """A predict tool that errored (e.g. the endpoint is down) must refund
        the credit and return 502 — a deliberate 502, not a server 500."""
        reply = dict(A2UI_AGENT_REPLY)
        reply['tool_calls'] = [
            {'name': 'predict_readmission',
             'args': {'hadm_id': 90000009},
             'response': {'error': 'upstream 503', 'status': 'failed'}},
            dict(A2UI_AGENT_REPLY['tool_calls'][1]),
        ]
        mocked.return_value = reply
        DemoQuota.objects.create(user=self.user, daily_limit=5)
        response = self._post({'hadm_id': 90000009, 'chip': 'risk'})
        self.assertEqual(response.status_code, 502)
        self.assertEqual(DemoQuota.remaining(self.user), 5)

    @patch('demo.views.ask_agent')
    def test_errored_rag_tool_refunds_quota(self, mocked):
        """Same for a rag tool error — any errored tool means the answer was
        degraded, so the credit is refunded."""
        reply = dict(A2UI_AGENT_REPLY)
        reply['tool_calls'] = [
            dict(A2UI_AGENT_REPLY['tool_calls'][0]),
            {'name': 'rag_search',
             'args': {'hadm_id': 90000009, 'query': 'meds', 'top_k': 5},
             'response': {'error': 'search_failed'}},
        ]
        mocked.return_value = reply
        DemoQuota.objects.create(user=self.user, daily_limit=5)
        response = self._post({'hadm_id': 90000009, 'chip': 'risk'})
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
