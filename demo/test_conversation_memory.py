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

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from django.urls import reverse

from .conversations import MAX_REPLAYED_TURNS, replay_turns
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
        self.assertEqual(turns[0]['question'], 'Question 2?',
                         'the oldest turns are the ones left behind')

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
