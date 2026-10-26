"""What a refreshed browser still knows: the workflow, and the benchmark it compared to.

Two gaps closed together here, because they failed the same way — the turn was on screen,
and the account of it was not.

`Agent workflow - N steps` was drawn from the SSE frames the run emitted. Frames are
transient: they exist for as long as the response is open, and a `Cmd+R` took the whole
tracery of the run with them, leaving a turn that said nothing about how it was answered.
The agent now sends the ordered labels in the answer envelope, and this file asserts they
survive the store.

The comparison table draws curated PubMed cohorts, and the fifth source — the one the
table's figures come from — was composed outside the citation pipeline. So the drawer
listed `1..4` and the benchmark could not be opened from the turn that showed it. The
agent now registers it as source `5`; this asserts the record round-trips.
"""

import json
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse

from .conversations import turn_payloads
from .models import Conversation, DemoPatient, Turn

#: The turn the console drew, as the agent now sends it: four note sources, then the
#: curated cohort the comparison table rests on, and the workflow that produced both.
STEPS = [
    'Planning the Search',
    'Reading the Note Sections',
    'Found 4 Note Passages',
    'Checking the Answer Against the Evidence',
]

NOTE_SOURCES = [
    {'cite': position, 'section': section, 'text': f'{section} text.',
     'query': 'summary'}
    for position, section in enumerate(
        ('history_of_present_illness', 'brief_hospital_course',
         'discharge_diagnosis', 'discharge_instructions'), start=1)
]

BENCHMARK = {
    'cite': 5,
    'kind': 'Literature',
    'badge': 'PubMed',
    'title': 'The Journal of Arthroplasty · 2022',
    'label': '5 · The Journal of Arthroplasty · 2022',
    'subtitle': 'PMID 34793857 · Retrospective Cohort',
    'section': 'The Journal of Arthroplasty · 2022',
    'text': 'Elective primary total knee arthroplasty — The 30-day readmission rate '
            'was 3.4%.',
    'pmid': '34793857',
    'url': 'https://pubmed.ncbi.nlm.nih.gov/34793857/',
}

BENCHMARK_REFERENCE = {
    'index': 5,
    'source': 'PubMed',
    'title': BENCHMARK['title'],
    'label': BENCHMARK['label'],
    'excerpt': BENCHMARK['text'],
    'pmid': BENCHMARK['pmid'],
    'url': BENCHMARK['url'],
}

AGENT_REPLY = {
    'question': 'Summarize the discharge note for admission 90000015.',
    'answer': ('The hospital course was uneventful ^[1]. The discharge diagnosis was '
               'osteoarthritis ^[2].'),
    'guardrail_flags': [],
    'tool_calls': [],
    'a2ui': {'surface_id': 'clinical', 'messages': []},
    'sources': NOTE_SOURCES + [BENCHMARK],
    'references': [
        {'index': 1, 'source': 'Discharge note', 'title': 'Brief hospital course',
         'label': '1 · Brief hospital course', 'excerpt': 'Uneventful.'},
        BENCHMARK_REFERENCE,
    ],
    'steps': STEPS,
    'verified': True,
    'scope': 'patient_chart',
    'literature': None,
    'follow_ups': [],
    'model': 'gemini-3.1-flash-lite',
    'code_revision': 'abc1234',
    'langfuse_trace_id': 'a84f7e9903ab13d86b6ee075f2a91f60',
    'mcp_transport': 'http',
}


class PresentationAcrossRefreshTests(TestCase):
    """One answered turn, stored and then read back as the console hydrates it."""

    def setUp(self):
        self.user = User.objects.create_user('demo', password='x')
        self.client.force_login(self.user)
        DemoPatient.objects.create(
            hadm_id=90000015, display_name='Test Patient', age=63,
            sex='F', summary='63F', split_name='test',
        )

    def _answer(self):
        with patch('demo.views.ask_agent', return_value=dict(AGENT_REPLY)):
            self.client.post(
                reverse('demo:a2ui_ask'),
                data=json.dumps({'hadm_id': 90000015, 'chip': 'summarize'}),
                content_type='application/json',
            )
        return Conversation.objects.get(user=self.user)

    def test_the_workflow_is_stored_with_the_turn(self):
        conversation = self._answer()

        stored = Turn.objects.get(conversation=conversation, role=Turn.Role.AGENT)

        self.assertEqual(stored.presentation['steps'], STEPS)

    def test_a_refresh_returns_the_workflow_on_every_turn(self):
        conversation = self._answer()

        payload = turn_payloads(conversation)

        self.assertEqual(payload[0]['steps'], STEPS)

    def test_the_hydration_endpoint_carries_the_workflow(self):
        conversation = self._answer()

        response = self.client.get(
            reverse('demo:conversation_detail', args=[conversation.pk]))

        self.assertEqual(response.status_code, 200)
        turns = response.json()['turns']
        self.assertEqual(turns[0]['steps'], STEPS)

    def test_the_benchmark_source_survives_the_refresh(self):
        """The fifth reference is the one the comparison table's figures come from."""
        conversation = self._answer()

        references = turn_payloads(conversation)[0]['references']

        self.assertEqual([row['index'] for row in references], [1, 5])
        benchmark = references[-1]
        self.assertEqual(benchmark['source'], 'PubMed')
        self.assertEqual(benchmark['pmid'], '34793857')
        self.assertEqual(benchmark['url'], BENCHMARK['url'])
        self.assertEqual(benchmark['label'], BENCHMARK['label'])

    def test_the_verified_badge_survives_the_refresh(self):
        payload = turn_payloads(self._answer())

        self.assertTrue(payload[0]['verified'])
