"""What a conversation stores, and what is sent back to the agent (plan item 6).

The lifecycle rules (credit, ceiling, expiry, pinning) are in
`test_conversation_lifecycle.py`. This file is about the other half of the same
decision: a follow-up is answered about turns the agent can no longer see, so the
site has to keep them and hand them back — keeping the *right* parts of them, and
nothing else. Two properties are tested as rules rather than as implementation:

  * nothing clinical accumulates here: a citation is stored as its identity and a
    tool result only when it cannot be obtained again;
  * what is replayed is bounded, because the window is the context the current
    question is being asked in.
"""

import json
from unittest.mock import patch

from django.conf import settings
from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from django.urls import reverse

from .conversations import MAX_REPLAYED_TURNS, replay_turns, turn_payloads
from .models import Conversation, DemoPatient, Turn

AGENT_REPLY = {
    'question': 'Assess the 30-day readmission risk for admission 90000009.',
    'answer': 'Estimated risk is 0.31 (31%), above the 0.12 threshold.^[1]',
    'guardrail_flags': [],
    'tool_calls': [
        {
            'name': 'predict_readmission',
            'args': {'hadm_id': 90000009},
            'response': {'probability': 0.31, 'threshold': 0.12},
            'derivable': False,
        },
        {
            'name': 'rag_search',
            'args': {'hadm_id': 90000009, 'query': 'diagnosis'},
            'response': {'returned': 1, 'passages': [
                {'id': 'MT-1-DS_hospital_course_1',
                 'section': 'hospital_course',
                 'text': 'She was admitted with pneumonia.'},
            ]},
            'derivable': True,
        },
    ],
    'a2ui': None,
    'sources': [
        {'cite': 1, 'section': 'hospital_course',
         'text': 'She was admitted with pneumonia.', 'query': 'diagnosis'},
    ],
    'model': 'gemini-3.1-flash-lite',
    'code_revision': 'abc1234',
    'langfuse_trace_id': 'a84f7e9903ab13d86b6ee075f2a91f60',
    'mcp_transport': 'http',
}


class _AskTestCase(TestCase):
    """One patient, one logged-in account, and a mocked agent."""

    def setUp(self):
        self.user = User.objects.create_user('demo', password='x')
        self.client.force_login(self.user)
        self.patient = DemoPatient.objects.create(
            hadm_id=90000009, display_name='Test Patient', age=63,
            sex='F', summary='63F', split_name='test',
        )

    def _post(self, payload):
        return self.client.post(
            reverse('demo:a2ui_ask'),
            data=json.dumps(payload),
            content_type='application/json',
        )

    def _conversation(self):
        return Conversation.objects.get(user=self.user)


class TurnStoreTests(_AskTestCase):
    """What one answered turn leaves behind."""

    @patch('demo.views.ask_agent', return_value=dict(AGENT_REPLY))
    def test_a_turn_is_stored_as_the_pair_it_was(self, _mocked):
        self._post({'hadm_id': 90000009, 'chip': 'risk'})

        rows = list(Turn.objects.filter(conversation=self._conversation())
                    .order_by('ordinal'))
        self.assertEqual([r.role for r in rows],
                         [Turn.Role.USER, Turn.Role.AGENT])
        self.assertEqual(rows[0].question, AGENT_REPLY['question'])
        self.assertEqual(rows[1].answer, AGENT_REPLY['answer'])
        self.assertEqual(rows[1].model, 'gemini-3.1-flash-lite')
        self.assertEqual(rows[1].code_revision, 'abc1234')

    @patch('demo.views.ask_agent', return_value=dict(AGENT_REPLY))
    def test_the_turn_carries_the_pointer_to_its_run(self, _mocked):
        """The trace id is stored with the turn, because the two records answer
        different questions: the run says what the model was shown and which
        tools ran, the row says what was answered after the tracing stack has
        been swept. Without the id an operator matches the two by timestamp."""
        self._post({'hadm_id': 90000009, 'chip': 'risk'})

        stored = Turn.objects.get(conversation=self._conversation(),
                                  role=Turn.Role.AGENT).langfuse_trace_id
        self.assertEqual(stored, AGENT_REPLY['langfuse_trace_id'])

    @patch('demo.views.ask_agent')
    def test_a_turn_with_tracing_off_stores_no_pointer(self, mocked):
        """Tracing is a sink, so a run with Langfuse unconfigured returns an
        empty id and the turn stores the empty string. The answer is unaffected,
        which is the point of the sink rule."""
        mocked.return_value = {**AGENT_REPLY, 'langfuse_trace_id': ''}

        response = self._post({'hadm_id': 90000009, 'chip': 'risk'})

        self.assertEqual(response.status_code, 200)
        stored = Turn.objects.get(conversation=self._conversation(),
                                  role=Turn.Role.AGENT)
        self.assertEqual(stored.langfuse_trace_id, '')

    @patch('demo.views.ask_agent')
    def test_a_pointer_that_is_not_a_string_is_not_stored(self, mocked):
        """The column is read by the staff console to build a URL, so a value
        that is not a string would put a broken link in front of an operator --
        worse than no link, because it looks like evidence."""
        mocked.return_value = {**AGENT_REPLY, 'langfuse_trace_id': 12345678}

        self._post({'hadm_id': 90000009, 'chip': 'risk'})

        stored = Turn.objects.get(conversation=self._conversation(),
                                  role=Turn.Role.AGENT)
        self.assertEqual(stored.langfuse_trace_id, '')

    @patch('demo.views.ask_agent', return_value=dict(AGENT_REPLY))
    def test_a_stored_citation_keeps_its_identity_and_not_its_passage(
        self, _mocked
    ):
        """The passage is re-derived from the note when it is needed. Keeping it
        here would put discharge-note text in the web application's database,
        which is the one thing the memory policy refuses."""
        self._post({'hadm_id': 90000009, 'chip': 'risk'})

        stored = Turn.objects.get(conversation=self._conversation(),
                                  role=Turn.Role.AGENT).citations
        self.assertEqual(stored, [{'cite': 1, 'section': 'hospital_course',
                                   'query': 'diagnosis'}])

    @patch('demo.views.ask_agent')
    def test_the_stored_citations_are_provenance_and_are_not_published(
        self, _mocked
    ):
        """One name for the facts a reader clicks.

        The identities above are what the agent resolved this turn against, and
        they are kept for that reason alone. The console's references drawer
        lists `references`, which carry the label a reader sees, so publishing a
        second list of the same facts would be a second thing to keep correct
        with no reader.
        """
        _mocked.return_value = {
            **AGENT_REPLY,
            'a2ui': dict(A2UI_ENVELOPE),
            'references': [{'index': 1, 'source': 'Discharge note',
                            'title': 'Hospital course',
                            'excerpt': 'admitted with pneumonia'}],
        }

        self._post({'hadm_id': 90000009, 'chip': 'risk'})

        turn = turn_payloads(self._conversation())[0]
        self.assertEqual(len(turn['references']), 1)
        self.assertEqual(turn['references'][0]['title'], 'Hospital course')
        self.assertNotIn('citations', turn)
        # The stored column survives the change: it is provenance, not a
        # rendering input.
        stored = Turn.objects.get(conversation=self._conversation(),
                                  role=Turn.Role.AGENT)
        self.assertEqual(len(stored.citations), 1)

    @patch('demo.views.ask_agent', return_value=dict(AGENT_REPLY))
    def test_a_tool_result_is_kept_only_when_it_cannot_be_derived_again(
        self, _mocked
    ):
        self._post({'hadm_id': 90000009, 'chip': 'risk'})

        stored = Turn.objects.get(conversation=self._conversation(),
                                  role=Turn.Role.AGENT).tool_calls
        predict, search = stored
        self.assertEqual(predict['name'], 'predict_readmission')
        self.assertEqual(predict['args'], {'hadm_id': 90000009})
        self.assertEqual(predict['payload'], AGENT_REPLY['tool_calls'][0]['response'])
        self.assertEqual(search['name'], 'rag_search')
        self.assertIsNone(search['payload'], 'retrieval is resolved again')
        self.assertNotIn('text', json.dumps(stored))

    @patch('demo.views.ask_agent')
    def test_the_guardrails_that_fired_are_kept_by_name(self, mocked):
        """The flag list is the only record of why a served answer differs from
        what the model wrote.

        It used to be dropped: the agent returned the names and this store kept
        none of them, so an answer with a sentence rewritten could be traced to
        "a guardrail acted" and no further — and the agent's log carried a count,
        not a name. The answer and the reason have to live in the same place.
        """
        mocked.return_value = {
            **AGENT_REPLY,
            'guardrail_flags': ['risk_number_unsupported:0.14',
                                'med_dose_mismatch:5 mg'],
        }

        self._post({'hadm_id': 90000009, 'chip': 'risk'})

        stored = Turn.objects.get(conversation=self._conversation(),
                                  role=Turn.Role.AGENT).guardrail_flags
        self.assertEqual(stored, ['risk_number_unsupported:0.14',
                                  'med_dose_mismatch:5 mg'])

    @patch('demo.views.ask_agent', return_value=dict(AGENT_REPLY))
    def test_the_answer_carries_the_id_the_browser_sends_back(self, _mocked):
        response = self._post({'hadm_id': 90000009, 'chip': 'risk'})

        self.assertEqual(response.json()['conversation_id'],
                         self._conversation().pk)

    @patch('demo.views.ask_agent', return_value=dict(AGENT_REPLY))
    def test_a_question_with_no_admission_is_given_no_conversation(self, _mocked):
        """It still answers, and it is still paid for — there is simply no
        patient to pin, so there is no thread to continue."""
        response = self._post({'question': 'What is the readmission threshold?'})

        self.assertNotIn('conversation_id', response.json())
        self.assertEqual(Conversation.objects.count(), 0)

    @patch('demo.views.ask_agent', return_value=dict(AGENT_REPLY))
    def test_a_failed_turn_leaves_no_half_of_itself_behind(self, _mocked):
        from .agent_client import AgentError

        with patch('demo.views.ask_agent',
                   side_effect=AgentError('agent refused', spent=True)):
            self._post({'hadm_id': 90000009, 'chip': 'risk'})

        self.assertEqual(Turn.objects.count(), 0)


A2UI_ENVELOPE = {
    'surface_id': 'main',
    'renders_prose': True,
    'messages': [
        {'version': 'v0.9',
         'createSurface': {'surfaceId': 'main', 'catalogId': 'catalog-v1'}},
        {'version': 'v0.9',
         'updateComponents': {
             'surfaceId': 'main',
             'components': [
                 {'id': 'root', 'component': 'Column', 'children': ['narrative']},
                 {'id': 'narrative', 'component': 'CitedNarrative',
                  'text': 'Estimated risk is 31%.^[1]',
                  'citations': [{'index': 1, 'source': 'PubMed', 'title': 'A study'}]},
             ],
         }},
    ],
}


class StoredPresentationTests(_AskTestCase):
    """The composed canvas is kept with the turn (Phase 3, 2026-10-14).

    Recall needs it: the canvas is composed by the agent from live evidence, so a thread
    restored without it would be a transcript of the answer with none of its artifacts.
    """

    def _reply(self):
        return {**AGENT_REPLY, 'a2ui': dict(A2UI_ENVELOPE)}

    @patch('demo.views.ask_agent')
    def test_the_composed_presentation_is_stored_with_the_turn(self, mocked):
        mocked.return_value = self._reply()

        self._post({'hadm_id': 90000009, 'chip': 'risk'})

        stored = Turn.objects.filter(role=Turn.Role.AGENT).latest('ordinal')
        self.assertEqual(stored.presentation['a2ui'], A2UI_ENVELOPE)

    @patch('demo.views.ask_agent')
    def test_a_turn_with_no_canvas_stores_an_empty_presentation(self, mocked):
        mocked.return_value = dict(AGENT_REPLY)  # `a2ui` is None

        self._post({'hadm_id': 90000009, 'chip': 'risk'})

        stored = Turn.objects.filter(role=Turn.Role.AGENT).latest('ordinal')
        self.assertEqual(stored.presentation['a2ui'], {})

    @patch('demo.views.ask_agent')
    def test_a_payload_that_is_not_an_envelope_is_not_stored_as_one(self, mocked):
        """The browser mounts this value as a surface, so a list arriving here would
        reach the renderer malformed and draw nothing — which reads as an answer that
        failed rather than as a payload that was mis-stored."""
        mocked.return_value = {**AGENT_REPLY, 'a2ui': ['not', 'an', 'envelope']}

        self._post({'hadm_id': 90000009, 'chip': 'risk'})

        stored = Turn.objects.filter(role=Turn.Role.AGENT).latest('ordinal')
        self.assertEqual(stored.presentation['a2ui'], {})

    @patch('demo.views.ask_agent')
    def test_the_turns_own_facts_are_stored_beside_the_canvas(self, mocked):
        """Scope, references and follow-ups are kept with the turn, not recomputed.

        The console draws all three after a thread is replayed, so a turn that lost them
        would come back as an answer with no evidence list and no next questions.
        """
        mocked.return_value = {
            **AGENT_REPLY,
            'a2ui': dict(A2UI_ENVELOPE),
            'scope': 'patient_chart',
            'references': [{'index': 1, 'source': 'Discharge note', 'title': 'Course'}],
            'follow_ups': ['What changed overnight?', 'Which medications were held?'],
        }

        self._post({'hadm_id': 90000009, 'chip': 'risk'})

        stored = Turn.objects.filter(role=Turn.Role.AGENT).latest('ordinal')
        self.assertEqual(stored.presentation['scope'], 'patient_chart')
        self.assertEqual(len(stored.presentation['references']), 1)
        self.assertEqual(len(stored.presentation['follow_ups']), 2)

    def test_a_turn_stored_before_the_presentation_held_more_still_reads(self):
        """The bare envelope is still a shape this reads, and there is no migration.

        Every turn written before 4A-2 holds the envelope itself. Reading one has to
        yield the envelope and empty defaults rather than a scope nobody recorded — so a
        thread that spans the change renders as one thing, not two.
        """
        from demo.conversations import _presentation_parts

        envelope, scope, references, follow_ups = _presentation_parts(A2UI_ENVELOPE)

        self.assertEqual(envelope, A2UI_ENVELOPE)
        self.assertIsNone(scope)
        self.assertEqual(references, [])
        self.assertEqual(follow_ups, [])

    @patch('demo.views.ask_agent')
    def test_the_canonical_turn_carries_what_the_console_renders(self, mocked):
        """One shape, used by a live turn and a restored one, so the client has one
        renderer rather than a live path and a hydrate path that drift apart."""
        mocked.return_value = self._reply()
        self._post({'hadm_id': 90000009, 'chip': 'risk'})

        payloads = turn_payloads(self._conversation())

        self.assertEqual(len(payloads), 1)
        turn = payloads[0]
        # `asked` is the heading the console draws. This request carried no
        # `asked` of its own, so it falls back to the composed question — which is
        # the right answer for a caller that is not the console, and the reason the
        # fallback exists.
        self.assertEqual(turn['asked'], AGENT_REPLY['question'])
        self.assertEqual(turn['answer'], AGENT_REPLY['answer'])
        self.assertEqual(turn['a2ui'], A2UI_ENVELOPE)
        self.assertEqual(turn['flags'], [])
        # The rule the store has always held, asserted on the payload the console
        # receives: the passage behind a citation is not carried, on the turn or
        # beside it. Only its identity is, and the agent re-resolves the text.
        self.assertNotIn('pneumonia', json.dumps(payloads))

    @patch('demo.views.ask_agent')
    def test_a_restored_turn_is_what_was_stored_not_what_would_be_composed_now(self, mocked):
        """A recall renders the payload from the turn, so the thread shows what it
        showed. Re-composing on read would silently rewrite history every time the
        composer changed."""
        mocked.return_value = self._reply()
        self._post({'hadm_id': 90000009, 'chip': 'risk'})
        conversation = self._conversation()

        stored = Turn.objects.filter(role=Turn.Role.AGENT).latest('ordinal')
        stored.presentation = {**A2UI_ENVELOPE, 'surface_id': 'recomposed'}
        stored.save(update_fields=['presentation'])

        self.assertEqual(turn_payloads(conversation)[0]['a2ui']['surface_id'],
                         'recomposed')


class ReplayTests(_AskTestCase):
    """What the site hands back to a stateless agent (A1/A3)."""

    @patch('demo.views.ask_agent', return_value=dict(AGENT_REPLY))
    def test_a_first_turn_replays_nothing(self, mocked):
        self._post({'hadm_id': 90000009, 'chip': 'risk'})

        self.assertNotIn('turns', mocked.call_args.args[0])

    @patch('demo.views.ask_agent', return_value=dict(AGENT_REPLY))
    def test_a_follow_up_replays_the_earlier_turn(self, mocked):
        self._post({'hadm_id': 90000009, 'chip': 'risk'})
        conversation = self._conversation()

        self._post({'hadm_id': 90000009, 'question': 'And potassium?',
                    'conversation_id': conversation.pk})

        sent = mocked.call_args.args[0]
        self.assertEqual(sent['question'], 'And potassium?')
        self.assertEqual(len(sent['turns']), 1)
        turn = sent['turns'][0]
        self.assertEqual(turn['question'], AGENT_REPLY['question'])
        self.assertEqual(turn['answer'], AGENT_REPLY['answer'])
        # The prediction score travels because it cannot be produced again; the
        # retrieval result does not, and is resolved again by the agent.
        self.assertEqual([c['name'] for c in turn['tool_calls']],
                         ['predict_readmission', 'rag_search'])
        self.assertEqual(turn['tool_calls'][0]['payload']['probability'], 0.31)
        self.assertNotIn('payload', turn['tool_calls'][1])

    @override_settings(DEMO_CONVERSATION_TURN_CEILING=20)
    @patch('demo.views.ask_agent')
    def test_the_replayed_window_is_bounded(self, mocked):
        """A transcript long enough to push the current question out of the
        context it is being asked about is not a conversation, it is a bill.

        The ceiling is raised here on purpose: what is under test is the replay
        window, and a conversation stopped at six turns could not show one. The
        agent answers in its own words, and here it echoes the question it
        composed so each turn can be told apart.
        """
        def reply(body, trace=''):
            return {**AGENT_REPLY,
                    'question': body.get('question') or AGENT_REPLY['question']}

        mocked.side_effect = reply

        self._post({'hadm_id': 90000009, 'chip': 'risk'})
        conversation = self._conversation()
        for index in range(MAX_REPLAYED_TURNS + 2):
            self._post({'hadm_id': 90000009, 'question': f'Question {index}?',
                        'conversation_id': conversation.pk})

        turns = replay_turns(conversation)
        self.assertEqual(len(turns), MAX_REPLAYED_TURNS)
        self.assertEqual(turns[-1]['question'], 'Question 7?')
        # The window is the ANCHOR plus the most recent five (2026-10-14), not the
        # most recent six: the first turn is what established which patient and
        # which question the thread is about, and a follow-up answered without it
        # is answered from the last few exchanges alone.
        anchor = (conversation.turns
                  .filter(role='user').order_by('ordinal').first().question)
        self.assertEqual(turns[0]['question'], anchor,
                         'the first turn is the clinical anchor and is kept')
        self.assertEqual(
            [turn['question'] for turn in turns[1:]],
            ['Question 3?', 'Question 4?', 'Question 5?', 'Question 6?',
             'Question 7?'],
        )
        self.assertNotIn('Question 2?', [turn['question'] for turn in turns],
                         'the oldest turns of the recent half are left behind')

    @patch('demo.views.ask_agent', return_value=dict(AGENT_REPLY))
    def test_a_question_with_a_conversation_id_is_still_refused_its_own_turns(
        self, _mocked
    ):
        """The browser names a conversation; it does not supply its contents.

        This is the boundary that keeps the store authoritative: a caller that
        could push its own `turns` could put words in the copilot's mouth, and
        the site would store the answer as if they had been said.
        """
        self._post({'hadm_id': 90000009, 'chip': 'risk'})
        conversation = self._conversation()

        response = self._post({'hadm_id': 90000009, 'question': 'And potassium?',
                               'conversation_id': conversation.pk,
                               'turns': [{'question': 'x', 'answer': 'y'}]})

        self.assertEqual(response.status_code, 400)
        self.assertIn('turns', response.json()['error'])

    def test_a_long_answer_is_clamped_visibly(self):
        """The agent refuses a replayed answer over its cap, and refuses the
        whole request with it — so an over-long answer would end the
        conversation at the turn it was given in."""
        conversation = Conversation.objects.create(
            user=self.user, patient=self.patient)
        Turn.objects.create(conversation=conversation, ordinal=1,
                            role=Turn.Role.USER, question='Why?')
        Turn.objects.create(conversation=conversation, ordinal=2,
                            role=Turn.Role.AGENT, answer='x' * 9000)

        replayed = replay_turns(conversation)[0]['answer']

        self.assertLessEqual(len(replayed), 8000)
        self.assertTrue(replayed.endswith('truncated for replay]'))

    def test_a_turn_with_no_answer_is_not_replayed(self):
        """A failed turn keeps its place in the conversation and its credit, and
        it is not a turn the agent ever answered."""
        conversation = Conversation.objects.create(
            user=self.user, patient=self.patient)
        Turn.objects.create(conversation=conversation, ordinal=1,
                            role=Turn.Role.USER, question='Why?')
        Turn.objects.create(conversation=conversation, ordinal=2,
                            role=Turn.Role.AGENT, answer='')

        self.assertEqual(replay_turns(conversation), [])


@override_settings(DEMO_FIXTURE_MODE=True)
class FixtureModeIsSingleTurnTests(_AskTestCase):
    """Offline scaffolding answers one question at a time, and says so."""

    def test_fixture_mode_opens_no_conversation(self):
        response = self.client.post(
            reverse('demo:a2ui_ask'),
            data=json.dumps({'hadm_id': 90000009, 'chip': 'risk'}),
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 200)
        self.assertNotIn('conversation_id', response.json())
        self.assertEqual(Conversation.objects.count(), 0)
        self.assertEqual(Turn.objects.count(), 0)

    # This test renders the console page, which references built static files.
    # Plain storage keeps it independent of a collectstatic run: the manifest is
    # a build artifact, and a test that needs one fails on a clean checkout.
    @override_settings(
        STORAGES={
            **settings.STORAGES,
            "staticfiles": {
                "BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"
            },
        }
    )
    def test_the_console_says_so(self):
        response = self.client.get(reverse('demo:a2ui_console'))
        rendered = response.content.decode()

        self.assertContains(response, 'Offline demonstration')
        self.assertContains(response, 'one question')
        # A multi-line `{# … #}` is not a Django comment — the tag is single-line,
        # so the braces are rendered as text on the page. Caught by looking at the
        # page rather than at the test, so it is asserted here instead.
        self.assertNotIn('{#', rendered)
        self.assertNotIn('#}', rendered)
