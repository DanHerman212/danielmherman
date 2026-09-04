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

# A live agent reply shaped like the real /ask response: tool_calls carry the
# response payloads the A2UI canvas composer needs (predict + rag).
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
            self.assertIn(f'images/guide/', body)
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
class A2uiCanvasTests(TestCase):
    """The A2UI spike: server composes the canvas as A2UI messages."""

    def setUp(self):
        self.user = User.objects.create_user('demo', password='x')
        self.client.force_login(self.user)

    def test_compose_emits_custom_components(self):
        predict = {
            'hadm_id': 90000017, 'probability': 0.299359, 'threshold': 0.12,
            'decision': 1, 'base_value': -1.3, 'model_version': 'readmission-final-x',
            'feature_source': 'synthetic',
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
        # No bare-dash provenance: a non-risk question says plainly there is
        # no estimate rather than rendering "Model — · features from —".
        prov = next(c for c in comps if c.get('id') == 'prov')
        self.assertNotIn('Model —', prov['text'])
        self.assertIn('no readmission estimate was requested', prov['text'])
        # The cited source card carries the actual section, not the query.
        source = next(c for c in comps if c.get('component') == 'SourceCard')
        self.assertEqual(source['section'], 'discharge_medications')
        self.assertEqual(source['cite'], 1)

    def test_intent_section_maps_chips_and_free_text(self):
        from demo.a2ui_canvas import intent_sections
        self.assertEqual(
            intent_sections('What medications was this patient discharged on?'),
            ('discharge_medications', 'discharge_instructions'))
        self.assertEqual(
            intent_sections('What were her discharge instructions? '
                           'For admission 90000015.'),
            ('discharge_instructions',))
        self.assertEqual(
            intent_sections('list her diagnoses'), ('discharge_diagnosis',))
        self.assertEqual(
            intent_sections('summarize the hospital course'),
            ('brief_hospital_course',))
        # Summarize/risk questions have no single-section intent: their
        # citation-by-number behavior stays as-is.
        self.assertEqual(intent_sections(
            'Summarize the recent discharge notes for this patient.'), ())
        self.assertEqual(intent_sections(
            'Assess the 30-day readmission risk for this patient.'), ())

    def test_compose_resolves_cited_passage_by_section(self):
        """The citation-links fix: the SourceCard resolves the passage by the
        question's target section, not by the (unreliable) citation number.
        A meds answer cites ^[1] while the meds passage sits at index 2 —
        the canvas must still show discharge_medications."""
        rag = {'passages': [
            {'id': 'n_bhc_1', 'section': 'brief_hospital_course',
             'text': 'Hospital Course: recovered.', 'score': 0.3},
            {'id': 'n_dx_1', 'section': 'discharge_diagnosis',
             'text': 'Discharge Diagnoses: TKA.', 'score': 0.2},
            {'id': 'n_meds_1', 'section': 'discharge_medications',
             'text': 'Discharge Medications: Celebrex 200 mg daily.',
             'score': 0.1},
        ], 'query': 'discharge notes'}
        env = compose_risk_canvas(
            None, rag, cite=1, sections=('discharge_medications',))
        comps = env['messages'][1]['updateComponents']['components']
        source = next(c for c in comps if c.get('component') == 'SourceCard')
        self.assertEqual(source['section'], 'discharge_medications')
        self.assertIn('Celebrex', source['text'])
        # Badge mirrors the thread's citation number, not the array position.
        self.assertEqual(source['cite'], 1)

        # Without a section hint the number mapping is unchanged.
        env = compose_risk_canvas(None, rag, cite=1)
        comps = env['messages'][1]['updateComponents']['components']
        source = next(c for c in comps if c.get('component') == 'SourceCard')
        self.assertEqual(source['section'], 'brief_hospital_course')

        # A section hint the note does not have is a deterministic
        # "not available" card — never a fallback to the wrong section.
        env = compose_risk_canvas(
            None, rag, cite=2, sections=('discharge_instructions',))
        comps = env['messages'][1]['updateComponents']['components']
        source = next(c for c in comps if c.get('component') == 'SourceCard')
        self.assertEqual(source['section'], 'not available')
        self.assertIn('instruction', source['text'])

    def test_compose_extracts_intent_section_from_whole_note_chunks(self):
        """The index stores whole-note chunks, so the intent-labeled passage
        can miss the returned list entirely. The canvas must then pull the
        intent section's body OUT of any returned chunk's text — never show
        the wrong section (the live meds-chip failure)."""
        whole_note = (
            'CHIEF COMPLAINT: Knee pain.\n\n'
            'HOSPITAL COURSE: She underwent a right TKA and recovered.\n\n'
            'DISCHARGE DIAGNOSES: 1. S/p right TKA.\n\n'
            'MEDICATIONS: Celebrex 200 mg daily.'
        )
        rag = {'passages': [
            {'id': 'n_bhc_1', 'section': 'brief_hospital_course',
             'text': whole_note, 'score': 0.3},
            {'id': 'n_dx_1', 'section': 'discharge_diagnosis',
             'text': whole_note, 'score': 0.2},
        ], 'query': 'discharge notes'}
        env = compose_risk_canvas(
            None, rag, cite=1, sections=('discharge_medications',))
        comps = env['messages'][1]['updateComponents']['components']
        source = next(c for c in comps if c.get('component') == 'SourceCard')
        self.assertEqual(source['section'], 'discharge_medications')
        self.assertIn('Celebrex', source['text'])
        self.assertNotIn('HOSPITAL COURSE', source['text'])
        self.assertEqual(source['cite'], 1)

    def test_compose_resolves_meds_to_instructions_when_no_meds_section(self):
        """Alan Marchetti (90000005): the note has NO medications section —
        the meds claim's supporting text is in DISCHARGE INSTRUCTIONS. The
        meds intent set must resolve there, never to brief_hospital_course."""
        note = (
            'DISCHARGE DIAGNOSES: Cellulitis.\n\n'
            'DISCHARGE INSTRUCTIONS: The patient would be discharged on his '
            'usual Valium 10-20 mg at bedtime for spasticity, Flomax 0.4 mg '
            'daily, cefazolin 500 mg q.i.d., and Lotrimin cream between toes.\n\n'
            'HOSPITAL COURSE: The patient was admitted to the General Medical '
            'floor and treated with intravenous ceftriaxone and topical '
            'Lotrimin.'
        )
        rag = {'passages': [
            {'id': 'n_bhc_1', 'section': 'brief_hospital_course',
             'text': note, 'score': 0.3},
            {'id': 'n_dx_1', 'section': 'discharge_diagnosis',
             'text': note, 'score': 0.2},
            {'id': 'n_ins_1', 'section': 'discharge_instructions',
             'text': note, 'score': 0.1},
        ], 'query': 'discharge notes'}
        env = compose_risk_canvas(
            None, rag, cite=1,
            sections=('discharge_medications', 'discharge_instructions'))
        comps = env['messages'][1]['updateComponents']['components']
        source = next(c for c in comps if c.get('component') == 'SourceCard')
        self.assertEqual(source['section'], 'discharge_instructions')
        self.assertIn('Valium', source['text'])
        self.assertNotIn('HOSPITAL COURSE', source['text'])
        self.assertEqual(source['cite'], 1)

    def test_compose_unavailable_when_note_lacks_meds_sections(self):
        """Eleanor Whitfield (90000035): no meds AND no instructions section —
        the note mentions meds only inside the hospital course. The
        deterministic answer is 'not available', never a meds sentence mined
        from the hospital course narrative."""
        note = (
            'ADMISSION DIAGNOSIS: Symptomatic thyroid goiter.\n\n'
            'HOSPITAL COURSE: The patient underwent total thyroidectomy on '
            '09/22/08, which she tolerated very well. She was given '
            'prescription for Vicodin for pain and Synthroid thyroid hormone.'
        )
        rag = {'passages': [
            {'id': 'n_bhc_1', 'section': 'brief_hospital_course',
             'text': note, 'score': 0.3},
            {'id': 'n_dx_1', 'section': 'discharge_diagnosis',
             'text': note, 'score': 0.2},
        ], 'query': 'discharge notes'}
        env = compose_risk_canvas(
            None, rag, cite=1,
            sections=('discharge_medications', 'discharge_instructions'))
        comps = env['messages'][1]['updateComponents']['components']
        source = next(c for c in comps if c.get('component') == 'SourceCard')
        self.assertEqual(source['section'], 'not available')
        self.assertIn('No discharge medication information', source['text'])
        self.assertNotIn('Vicodin', source['text'])
        self.assertEqual(source['cite'], 1)

    def test_renumber_citations_first_appearance_order(self):
        from demo.a2ui_canvas import renumber_citations
        # A meds-only answer cites ^[3] (discharge_medications is the 3rd
        # section in rag_search_sections order) — it must read as ^[1].
        self.assertEqual(
            renumber_citations(
                'The patient was discharged on the following medications^[3]:'),
            'The patient was discharged on the following medications^[1]:')
        # Multi-citation: renumber by order of first appearance.
        self.assertEqual(
            renumber_citations('A^[2] and B^[1] and C^[3]'),
            'A^[1] and B^[2] and C^[3]')
        self.assertEqual(renumber_citations('no citations here'),
                         'no citations here')
        # Stacked citations on one claim collapse to a single marker.
        self.assertEqual(
            renumber_citations('discharged on pain medication ^[1]^[2]^[3]^[4]^[5].'),
            'discharged on pain medication ^[1].')
        self.assertEqual(
            renumber_citations('discharged on pain medication ^[1] ^[2] ^[3].'),
            'discharged on pain medication ^[1].')

    def test_citation_remap_maps_renumbered_to_original(self):
        from demo.a2ui_canvas import citation_remap
        # 'A^[2] and B^[1] and C^[3]' renumbers to 1,2,3 in appearance order,
        # so the map must translate the renumbered numbers back to the
        # original passage positions (2,1,3).
        self.assertEqual(
            citation_remap('A^[2] and B^[1] and C^[3]'),
            {'1': 2, '2': 1, '3': 3})
        self.assertEqual(citation_remap('no citations here'), {})

    def test_extract_section_bounds_at_allergies_and_activity(self):
        """The meds source must not swallow trailing headers (Allergies,
        Activity) that the site alias list previously did not recognize."""
        from demo.a2ui_canvas import _extract_section
        note = ('DISCHARGE MEDICATIONS: Tylenol 650 mg q.6h., Lasix 80 mg '
                'daily.\n\n'
                'ALLERGIES: None.\n\n'
                'ACTIVITY: Per PT.\n\n'
                'FOLLOWUP INSTRUCTIONS: Call the office.')
        meds = _extract_section(note, 'discharge_medications')
        self.assertIn('Tylenol', meds)
        self.assertNotIn('ALLERGIES', meds)
        self.assertNotIn('ACTIVITY', meds)

    def test_extract_section_handles_mtsamples_headers(self):
        """Alias-aware extraction: MTSamples notes use different headers than
        MIMIC canon ("HOSPITAL COURSE:", "DISCHARGE DIAGNOSES:"), and the
        SourceCard body must come from the cited section — not the whole note.
        This is the citation-links fix."""
        from demo.a2ui_canvas import _extract_section
        note = (
            "CHIEF COMPLAINT: Knee pain.\n\n"
            "HISTORY OF PRESENT ILLNESS: The patient is a 61-year-old female.\n\n"
            "HOSPITAL COURSE: She underwent a right total knee replacement and "
            "recovered well.\n\n"
            "DISCHARGE DIAGNOSES: 1. S/p right TKA.\n\n"
            "MEDICATIONS: Celebrex 200 mg daily.\n\n"
            "INSTRUCTIONS GIVEN TO THE PATIENT AT THE TIME OF DISCHARGE: "
            "Continue Celebrex for one month."
        )
        course = _extract_section(note, 'brief_hospital_course')
        self.assertIsNotNone(course)
        self.assertIn('right total knee replacement', course)
        self.assertNotIn('CHIEF COMPLAINT', course)
        self.assertNotIn('DISCHARGE DIAGNOSES', course)

        dx = _extract_section(note, 'discharge_diagnosis')
        self.assertIsNotNone(dx)
        self.assertIn('S/p right TKA', dx)
        self.assertNotIn('HOSPITAL COURSE', dx)

        meds = _extract_section(note, 'discharge_medications')
        self.assertIsNotNone(meds)
        self.assertIn('Celebrex', meds)

        instr = _extract_section(note, 'discharge_instructions')
        self.assertIsNotNone(instr)
        self.assertIn('for one month', instr)
        self.assertNotIn('Celebrex 200 mg daily.', instr[:len('MEDICATIONS: Celebrex 200 mg daily.')])

    def test_a2ui_ask_returns_messages_from_fixture(self):
        response = self.client.post(
            reverse('demo:a2ui_ask'),
            data=json.dumps({'hadm_id': 90000017, 'chip': 'risk'}),
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
        self.assertContains(response, 'demo_a2ui.js?v=11')


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
            hadm_id=90000009, display_name='Test Patient', age=63,
            sex='F', summary='63F · urgent admission', split_name='test',
        )

    def _post(self, payload):
        return self.client.post(
            reverse('demo:a2ui_ask'),
            data=json.dumps(payload),
            content_type='application/json',
        )

    @patch('demo.views.ask_agent', return_value=dict(A2UI_AGENT_REPLY))
    def test_live_branch_composes_canvas_and_consumes_quota(self, mocked):
        response = self._post({'hadm_id': 90000009, 'chip': 'risk'})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['remaining'], 9)
        # The question is composed server-side so phrasing cannot be edited
        # into something leading (same as `ask`).
        self.assertIn('90000009', mocked.call_args.args[0])
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
        the credit and return 502. The agent surfaced the failure as a graceful
        tool error payload (HTTP 200), which must not silently eat a credit —
        and it is a deliberate 502, not a server 500."""
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
