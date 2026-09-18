"""Tests for the demo BFF: auth, quota, and the agent proxy.

The agent itself is mocked throughout. Its behaviour is already covered by the
harness Tier 1 suite against the real deployed service; what needs proving here
is that Django refuses to call it when it should, and accounts correctly when
it does.
"""

import json
from datetime import timedelta
from unittest.mock import patch

from asgiref.sync import async_to_sync
from django.conf import settings
from django.contrib.auth.models import User
from django.core.management import call_command
from django.db import IntegrityError
from django.test import Client, TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from .agent_client import AgentError
from .models import Conversation, DemoPatient, DemoQuota, Turn

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


class ConversationStoreTests(TestCase):
    """The conversation store enforces the policy, not just the schema."""

    def setUp(self):
        self.user = User.objects.create_user('demo', password='x')
        self.patient = DemoPatient.objects.create(
            hadm_id=90000017, display_name='Eugene Sokolov', age=83,
            sex='M', summary='83M', split_name='test',
        )
        self.other = DemoPatient.objects.create(
            hadm_id=90000018, display_name='Other Patient', age=70,
            sex='F', summary='70F', split_name='test',
        )

    def _conversation(self, patient=None):
        return Conversation.objects.create(
            user=self.user, patient=patient or self.patient)

    def test_the_retention_window_is_set_at_creation(self):
        conversation = self._conversation()

        expected = conversation.created_at + timedelta(
            hours=settings.DEMO_CONVERSATION_TTL_HOURS)
        self.assertEqual(conversation.expires_at, expected)
        self.assertFalse(conversation.is_expired)

    def test_an_expired_conversation_reports_itself_as_expired(self):
        conversation = self._conversation()
        Conversation.objects.filter(pk=conversation.pk).update(
            expires_at=timezone.now() - timedelta(seconds=1))

        self.assertTrue(Conversation.objects.get(pk=conversation.pk).is_expired)

    def test_the_patient_is_pinned(self):
        """A conversation that could move between patients would let a
        follow-up be answered about the wrong person."""
        conversation = self._conversation()
        conversation.patient = self.other

        with self.assertRaises(ValueError):
            conversation.save()
        self.assertEqual(
            Conversation.objects.get(pk=conversation.pk).patient_id,
            self.patient.pk)

    def test_capacity_stops_at_the_ceiling(self):
        conversation = self._conversation()
        self.assertTrue(conversation.has_capacity)

        Conversation.objects.filter(pk=conversation.pk).update(
            turn_count=settings.DEMO_CONVERSATION_TURN_CEILING)

        self.assertFalse(
            Conversation.objects.get(pk=conversation.pk).has_capacity)

    def test_a_turn_records_identity_rather_than_passage_text(self):
        conversation = self._conversation()
        turn = Turn.objects.create(
            conversation=conversation, ordinal=1, role=Turn.Role.AGENT,
            question='Why was this patient flagged?', answer='She was flagged…',
            model='gemini-3.1-flash-lite', code_revision='abc1234',
            citations=[{'cite': 1, 'section': 'hospital_course',
                        'query': 'why flagged'}],
            tool_calls=[
                {'name': 'predict_readmission', 'args': {'hadm_id': 90000017},
                 'payload': {'probability': 0.31}},
            ],
        )

        stored = Turn.objects.get(pk=turn.pk)
        self.assertEqual(stored.citations[0]['section'], 'hospital_course')
        self.assertNotIn('text', stored.citations[0])

    def test_two_turns_cannot_share_an_ordinal(self):
        conversation = self._conversation()
        Turn.objects.create(conversation=conversation, ordinal=1,
                            role=Turn.Role.USER, question='First?')

        with self.assertRaises(IntegrityError):
            Turn.objects.create(conversation=conversation, ordinal=1,
                                role=Turn.Role.USER, question='Again?')


class PurgeExpiredConversationsTests(TestCase):
    """The sweep is a job: lazy expiry never touches a row nobody reads."""

    def setUp(self):
        self.user = User.objects.create_user('demo', password='x')
        self.patient = DemoPatient.objects.create(
            hadm_id=90000017, display_name='Eugene Sokolov', age=83,
            sex='M', summary='83M', split_name='test',
        )

    def _conversation(self, *, expired):
        conversation = Conversation.objects.create(
            user=self.user, patient=self.patient)
        if expired:
            Conversation.objects.filter(pk=conversation.pk).update(
                expires_at=timezone.now() - timedelta(minutes=1))
        return conversation

    def test_it_deletes_what_has_expired_and_keeps_what_has_not(self):
        expired = self._conversation(expired=True)
        Turn.objects.create(conversation=expired, ordinal=1,
                            role=Turn.Role.USER, question='Abandoned?')
        live = self._conversation(expired=False)

        call_command('purge_expired_conversations')

        self.assertFalse(Conversation.objects.filter(pk=expired.pk).exists())
        self.assertEqual(Turn.objects.filter(conversation=expired).count(), 0)
        self.assertTrue(Conversation.objects.filter(pk=live.pk).exists())

    def test_a_dry_run_deletes_nothing(self):
        expired = self._conversation(expired=True)

        call_command('purge_expired_conversations', '--dry-run')

        self.assertTrue(Conversation.objects.filter(pk=expired.pk).exists())

    def test_an_account_deletion_takes_its_conversations_with_it(self):
        conversation = self._conversation(expired=False)

        self.user.delete()

        self.assertFalse(Conversation.objects.filter(pk=conversation.pk).exists())


@override_settings(DEMO_FIXTURE_MODE=True)
class RequestBoundaryTests(TestCase):
    """The site refuses unknown fields instead of dropping them in silence.

    The agent's contract has been closed for some time: it refuses a field it
    does not know rather than answering a question that quietly lost part of its
    input. The site's proxy in front of it was open — it read three keys and
    ignored every other key — so a browser that posted a history was answered as
    though it had not, at the boundary a browser can actually reach. These tests
    hold the two boundaries to the same behaviour, including in fixture mode,
    which answers before the agent is ever called.
    """

    def setUp(self):
        self.user = User.objects.create_user('demo', password='x')
        self.client.force_login(self.user)
        DemoPatient.objects.create(
            hadm_id=90000017, display_name='Eugene Sokolov', age=83,
            sex='M', summary='83M', split_name='test',
        )

    def _post(self, payload):
        return self.client.post(
            reverse('demo:a2ui_ask'),
            data=json.dumps(payload),
            content_type='application/json',
        )

    def test_a_conversation_field_is_refused_rather_than_dropped(self):
        response = self._post(
            {'hadm_id': 90000017, 'question': 'And the potassium?',
             'history': [{'role': 'user', 'text': 'Why was this patient flagged?'}]}
        )

        self.assertEqual(response.status_code, 400)
        error = response.json()['error']
        self.assertIn("'history'", error)
        self.assertIn('single-turn', error)

    def test_an_unknown_field_is_refused_by_name(self):
        response = self._post({'hadm_id': 90000017, 'chip': 'risk', 'foo': 1})

        self.assertEqual(response.status_code, 400)
        error = response.json()['error']
        self.assertIn("'foo'", error)
        self.assertIn('Send a question', error)

    def test_the_known_fields_still_answer(self):
        """The boundary must not refuse what the console actually sends."""
        response = self._post({'hadm_id': 90000017, 'chip': 'risk'})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['source'], 'fixture')


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
        # The conversation's lifetime is stated in the interface, not left for the
        # user to discover from a follow-up answered as a first question. It ships
        # hidden: the flow shows it once the site has given the thread a
        # conversation id.
        self.assertContains(response, 'id="thread-session-note"')
        self.assertContains(response, 'Reloading starts a new')
        self.assertContains(response, 'id="thread-session-note" class="thread-session-note" hidden')
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
        # component module are never stale in the browser. Bumping these is how
        # an asset change reaches a browser that already has the old file; the
        # assertion is deliberately exact so forgetting to bump fails here
        # rather than showing a stale page in production.
        self.assertContains(response, 'demo_splitpane.css?v=11')
        self.assertContains(response, 'demo_a2ui.js?v=15')


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
        # Intent crosses this boundary, not prompt text: the wording lives with
        # the chain, so a prompt change cannot ship from this repository.
        self.assertEqual(mocked.call_args.args[0],
                         {'chip': 'risk', 'hadm_id': 90000009})
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
        self.assertEqual(mocked.call_args.args[0],
                         {'question': 'Why was this patient flagged?'})

    @patch('demo.views.ask_agent', return_value=dict(A2UI_AGENT_REPLY))
    def test_no_prompt_wording_crosses_the_boundary(self, mocked):
        """Gap 2's whole point.

        Half the prompt used to be composed here, which meant a change to it
        could ship without touching the chain, its revision, or its review. The
        request must now carry intent only — a chip *name*, not a sentence. If
        wording ever reappears in this body, the chain artifact has leaked back
        into the website.
        """
        self._post({'hadm_id': 90000009, 'chip': 'risk'})

        intent = mocked.call_args.args[0]
        self.assertEqual(set(intent), {'chip', 'hadm_id'})
        # A chip name is one word; wording would be a sentence.
        self.assertNotIn(' ', intent['chip'])

    @patch('demo.views.ask_agent', return_value=dict(A2UI_AGENT_REPLY))
    def test_cloud_trace_id_is_forwarded_to_the_agent(self, mocked):
        """Cloud Run stamps X-Cloud-Trace-Context on the inbound request; the
        trace id (before the slash) is handed to the agent so both services'
        logs carry the same id for one user action."""
        self.client.post(
            reverse('demo:a2ui_ask'),
            data=json.dumps({'question': 'Why?'}),
            content_type='application/json',
            HTTP_X_CLOUD_TRACE_CONTEXT='105445aa7843bc8bf206b12000100000/1;o=1',
        )
        self.assertEqual(
            mocked.call_args.kwargs['trace'], '105445aa7843bc8bf206b12000100000'
        )

    @patch('demo.views.ask_agent', return_value=dict(A2UI_AGENT_REPLY))
    def test_missing_trace_header_forwards_an_empty_trace(self, mocked):
        self._post({'question': 'Why?'})
        self.assertEqual(mocked.call_args.kwargs['trace'], '')

    @patch('demo.views.ask_agent', return_value=dict(A2UI_AGENT_REPLY))
    def test_live_free_text_carries_the_selected_admission(self, mocked):
        """The admission travels alongside the text so the agent can embed it
        and ground the answer, rather than having to ask for the hadm_id."""
        response = self._post({'hadm_id': 90000009,
                               'question': 'Why was this patient flagged?'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(mocked.call_args.args[0],
                         {'question': 'Why was this patient flagged?',
                          'hadm_id': 90000009})

    @patch('demo.views.ask_agent', return_value=dict(A2UI_AGENT_REPLY))
    def test_a_chip_travels_as_a_name_not_as_wording(self, mocked):
        """The meds chip must reach the agent as `meds`, so the agent asks the
        medications question (and calls rag_search) rather than the risk one —
        and so the wording stays on the agent's side of the boundary."""
        self._post({'hadm_id': 90000009, 'chip': 'meds'})
        self.assertEqual(mocked.call_args.args[0],
                         {'chip': 'meds', 'hadm_id': 90000009})

    @patch('demo.views.ask_agent', return_value=dict(A2UI_AGENT_REPLY))
    def test_every_chip_travels_unchanged(self, mocked):
        for chip in ('risk', 'meds', 'summarize'):
            with self.subTest(chip=chip):
                self._post({'hadm_id': 90000009, 'chip': chip})
                self.assertEqual(mocked.call_args.args[0],
                                 {'chip': chip, 'hadm_id': 90000009})

    @patch('demo.views.ask_agent', return_value=dict(A2UI_AGENT_REPLY))
    def test_a_patient_with_nothing_asked_sends_only_the_admission(self, mocked):
        """No chip and no text is still a question — the agent has a default for
        exactly this case, so no wording is invented here."""
        self._post({'hadm_id': 90000009})
        self.assertEqual(mocked.call_args.args[0], {'hadm_id': 90000009})

    @patch('demo.views.ask_agent')
    def test_the_compare_chip_is_gone(self, mocked):
        """It asked about a previous assessment the single-turn product has no
        data for — a leftover from an earlier UX exercise, never offered in the
        console. Refused before a credit is spent, not merely hidden."""
        DemoQuota.objects.create(user=self.user, daily_limit=5)
        response = self._post({'hadm_id': 90000009, 'chip': 'compare'})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(DemoQuota.remaining(self.user), 5)
        mocked.assert_not_called()

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


class A2uiAskStreamTests(TestCase):
    """The streamed progress path (Layer 3, Gap 1).

    Only one thing is new here: frames are relayed while the chain works, and
    the answer arrives as the last frame. Everything else — the quota claim,
    the refund rules, the payload contract — is the blocking path's behaviour,
    so the tests that matter most are the ones proving the streamed path
    behaves the same way when things go wrong.
    """

    def setUp(self):
        self.user = User.objects.create_user('demo', password='x')
        self.client.force_login(self.user)
        DemoPatient.objects.create(
            hadm_id=90000009, display_name='Test Patient', age=63,
            sex='F', summary='63F · urgent admission', split_name='test',
        )

    def _post(self, payload, accept=None):
        headers = {'HTTP_ACCEPT': accept} if accept else {}
        return self.client.post(
            reverse('demo:a2ui_ask'),
            data=json.dumps(payload),
            content_type='application/json',
            **headers,
        )

    def _body(self, response):
        """Collect a streamed response's body.

        Consumed as an async iterator, because that is what the view returns:
        Django materializes a *synchronous* iterator, so a sync test would pass
        happily while the live stream arrived in one lump at the end.
        """
        async def collect():
            chunks = []
            async for chunk in response.streaming_content:
                chunks.append(chunk)
            return b''.join(chunks)

        return async_to_sync(collect)()

    def _frames(self, response):
        """The relayed frames, decoded and parsed, keepalives skipped."""
        body = self._body(response).decode('utf-8')
        frames = []
        for block in body.strip().split('\n\n'):
            lines = [l for l in block.split('\n') if l.strip() and not l.startswith(':')]
            if not lines:
                continue
            name = next(l[len('event:'):].strip() for l in lines if l.startswith('event:'))
            raw = next(l[len('data:'):].lstrip() for l in lines if l.startswith('data:'))
            frames.append((name, json.loads(raw)))
        return frames

    def _stream(self, *frames):
        """A stub for ask_stream: an iterable of (event, data) pairs."""
        def generator(question, trace=''):
            yield from frames
        return generator

    # --- the happy path ------------------------------------------------------

    @patch('demo.views.ask_agent_stream')
    def test_stages_are_relayed_then_the_answer_arrives_last(self, mocked):
        mocked.side_effect = self._stream(
            ('planning', {'stage': 'planning', 'label': 'Reading the Question'}),
            ('tool', {'stage': 'tool', 'label': 'Reading The Risk Model',
                      'tool': 'predict_readmission'}),
            ('verify', {'stage': 'verify', 'label': 'Checking the Answer Against the Evidence'}),
            ('answer', dict(A2UI_AGENT_REPLY)),
        )

        response = self._post(
            {'hadm_id': 90000009, 'chip': 'risk'}, accept='text/event-stream'
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'text/event-stream')
        # Every proxy between here and the browser must be told not to buffer,
        # or the frames all arrive together at the end and streaming is a lie.
        self.assertEqual(response['X-Accel-Buffering'], 'no')

        frames = self._frames(response)
        self.assertEqual([name for name, _ in frames],
                         ['planning', 'tool', 'verify', 'answer'])
        # The label is relayed verbatim: the agent owns the wording, and the
        # proxy must not reformat it on the way through.
        self.assertEqual(frames[1][1]['label'], 'Reading The Risk Model')

        answer = frames[-1][1]
        # The presentation contract still arrives pre-composed from the agent.
        self.assertEqual(answer['a2ui'], A2UI_AGENT_REPLY['a2ui'])
        self.assertEqual(answer['sources'], A2UI_AGENT_REPLY['sources'])
        # Django adds exactly one thing: the quota figure, on the final frame,
        # because it cannot be known before the answer exists.
        self.assertEqual(answer['remaining'], 9)

    @patch('demo.views.ask_agent_stream')
    def test_the_stream_is_opt_in_by_accept_header(self, mocked):
        """A caller that does not ask for a stream gets the JSON contract it
        has always had — the new path cannot change existing behaviour."""
        mocked.side_effect = self._stream(('answer', dict(A2UI_AGENT_REPLY)))
        with patch('demo.views.ask_agent', return_value=dict(A2UI_AGENT_REPLY)):
            response = self._post({'hadm_id': 90000009, 'chip': 'risk'})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'application/json')
        self.assertEqual(response.json()['remaining'], 9)
        mocked.assert_not_called()

    @patch('demo.views.ask_agent_stream')
    def test_the_response_is_async_so_django_does_not_buffer_it(self, mocked):
        """The response must be an ASYNC iterator, and nothing else proves it.

        Django's ASGI handler consumes a synchronous iterator with
        `sync_to_async(list)` (`StreamingHttpResponse.__aiter__`), which
        materializes the whole stream and sends every frame at the end. That
        was measured live on this endpoint: all frames arrived at the same
        millisecond, which is indistinguishable from not streaming at all. An
        async iterator is consumed part by part, so each frame is flushed as it
        is produced.
        """
        mocked.side_effect = self._stream(('answer', dict(A2UI_AGENT_REPLY)))

        response = self._post(
            {'hadm_id': 90000009, 'chip': 'risk'}, accept='text/event-stream'
        )

        self.assertTrue(
            hasattr(response.streaming_content, '__aiter__'),
            'a sync streaming response is buffered whole by Django under ASGI',
        )

    @patch('demo.views.ask_agent_stream')
    def test_the_stream_survives_the_caller_disconnecting(self, mocked):
        """Closing the stream early must release the agent slot: the browser
        going away is the common case for a long answer, and leaking a slot per
        abandoned request would eventually stall the whole site."""
        closed = []

        def generator(question, trace=''):
            try:
                yield ('planning', {'stage': 'planning', 'label': 'Reading the Question'})
                yield ('answer', dict(A2UI_AGENT_REPLY))
            finally:
                closed.append(True)

        mocked.side_effect = generator
        response = self._post(
            {'hadm_id': 90000009, 'chip': 'risk'}, accept='text/event-stream'
        )

        async def read_one_then_abandon():
            iterator = response.streaming_content.__aiter__()
            await iterator.__anext__()
            await iterator.aclose()

        async_to_sync(read_one_then_abandon)()
        self.assertEqual(closed, [True])

    @patch('demo.views.ask_agent_stream')
    def test_fixture_mode_never_streams(self, mocked):
        """Captured payloads answer instantly: no chain runs, so there is
        nothing to narrate."""
        with override_settings(DEMO_FIXTURE_MODE=True):
            response = self._post(
                {'hadm_id': 90000009, 'chip': 'risk'}, accept='text/event-stream'
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'application/json')
        mocked.assert_not_called()

    # --- the failure paths --------------------------------------------------

    @patch('demo.views.ask_agent_stream')
    def test_a_failure_before_the_first_frame_is_still_a_502(self, mocked):
        """A streamed request that fails before any frame exists can still be
        refused with a real status code, so the browser's existing error
        handling keeps working."""
        mocked.side_effect = AgentError('boom')
        DemoQuota.objects.create(user=self.user, daily_limit=5)

        response = self._post(
            {'hadm_id': 90000009, 'chip': 'risk'}, accept='text/event-stream'
        )

        self.assertEqual(response.status_code, 502)
        self.assertEqual(response['Content-Type'], 'application/json')
        self.assertEqual(DemoQuota.remaining(self.user), 5)

    @patch('demo.views.ask_agent_stream')
    def test_a_stream_with_no_frames_at_all_is_a_502(self, mocked):
        mocked.side_effect = self._stream()
        DemoQuota.objects.create(user=self.user, daily_limit=5)

        response = self._post(
            {'hadm_id': 90000009, 'chip': 'risk'}, accept='text/event-stream'
        )

        self.assertEqual(response.status_code, 502)
        self.assertEqual(DemoQuota.remaining(self.user), 5)

    @patch('demo.views.ask_agent_stream')
    def test_a_tool_error_in_the_streamed_answer_refunds(self, mocked):
        """A downstream failure arrives as a good-looking answer containing a
        tool error. The credit must come back and the browser must be told,
        exactly as on the blocking path."""
        reply = dict(A2UI_AGENT_REPLY)
        reply['tool_calls'] = [
            {'name': 'predict_readmission',
             'response': {'error': 'upstream 503', 'status': 'failed'}},
        ]
        mocked.side_effect = self._stream(('answer', reply))
        DemoQuota.objects.create(user=self.user, daily_limit=5)

        response = self._post(
            {'hadm_id': 90000009, 'chip': 'risk'}, accept='text/event-stream'
        )

        frames = self._frames(response)
        self.assertEqual([name for name, _ in frames], ['error'])
        self.assertEqual(DemoQuota.remaining(self.user), 5)
        # The frame is shaped like the blocking path's 502 body, so the browser
        # renders both failures the same way.
        self.assertIn('unavailable', frames[0][1]['error'])
        self.assertEqual(frames[0][1]['remaining'], 5)

    @patch('demo.views.ask_agent_stream')
    def test_a_stream_failure_mid_answer_refunds_and_replaces_the_placeholder(self, mocked):
        """Once frames have been sent the status code is spent, so the failure
        has to arrive as an error frame — and it must still refund."""
        mocked.side_effect = self._stream(
            ('tool', {'stage': 'tool', 'label': 'Reading The Risk Model'}),
            ('error', {'error': 'agent_failed', 'message': 'upstream died'}),
        )
        DemoQuota.objects.create(user=self.user, daily_limit=5)

        response = self._post(
            {'hadm_id': 90000009, 'chip': 'risk'}, accept='text/event-stream'
        )

        self.assertEqual(response.status_code, 200)
        frames = self._frames(response)
        self.assertEqual([name for name, _ in frames], ['tool', 'error'])
        self.assertEqual(DemoQuota.remaining(self.user), 5)

    @patch('demo.views.ask_agent_stream')
    def test_a_streamed_failure_discloses_nothing_internal(self, mocked):
        """The agent's error detail routinely embeds the private MCP URL and
        service account names; the frame the browser sees must carry none of
        it (S1-03)."""
        mocked.side_effect = self._stream(
            ('error', {'error': 'agent_failed',
                       'message': 'https://secret-mcp-url/ask audience=projects/12345'}),
        )

        response = self._post(
            {'hadm_id': 90000009, 'chip': 'risk'}, accept='text/event-stream'
        )

        body = self._body(response).decode('utf-8')
        self.assertNotIn('secret-mcp-url', body)
        self.assertNotIn('audience', body)
        self.assertIn('unavailable', body)
