"""The envelope the browser receives, frozen before the web layer is refactored.

Phase 0 of the frontend refactor (`docs/site_redesign/01-frontend_inventory_and_refactor_plan.md`).
Nothing in `views.py` or `static/js/` changes here: these tests exist so that the phases
that follow can move code without moving the contract, and so that a key dropped from the
envelope fails here rather than in a browser.

Three locks:

  1. **The two ask paths agree.** `/ask` answers with one JSON object, or with an SSE
     stream whose last frame carries the same object. Both paths assemble it themselves
     — the blocking view and `_stream_frames` each add `remaining`, `conversation_id` and
     `expires_at` — and nothing asserted that the two assemblies agreed. A field added to
     one and forgotten in the other is a console that behaves differently depending on
     whether the reader's browser asked for a stream, which is not a setting anyone chose.

  2. **A live turn and a restored turn are the same shape.** `turn_payloads` is what a
     refresh draws, `fillTurn` is what a live answer draws, and the console has one
     renderer for both. That only holds while the stored turn publishes every field the
     renderer reads.

  3. **Python and JavaScript name the same keys.** Neither side can import the other, so
     the two vocabularies are kept in step by a test that reads both. This is the Python
     half; `tests/js/frames.test.mjs` holds the frame vocabulary and the rendered
     structure.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

from asgiref.sync import async_to_sync
from django.conf import settings
from django.contrib.auth.models import User
from django.test import SimpleTestCase, TestCase
from django.urls import reverse

from .agent_contract import AgentSuccess
from .conversations import record_answer, turn_payloads
from .models import Conversation, DemoPatient, Turn

# --------------------------------------------------------------------------- #
# The contract, stated once
# --------------------------------------------------------------------------- #
#
#: Every key a caller may find on an answer envelope, in three groups: what the agent
#: composes, what it composes that `AgentSuccess` does not name, and what this proxy
#: adds. The grouped comments are load-bearing — `test_every_published_key_has_a_producer`
#: holds the set to the source, and a key that belongs to none of the three groups has no
#: producer at all.
PUBLISHED_ENVELOPE_KEYS = frozenset({
    # The agent's contract, validated at the boundary (`agent_contract.AgentSuccess`).
    'question', 'answer', 'guardrail_flags', 'tool_calls', 'a2ui', 'sources',
    'literature', 'verified', 'steps', 'model', 'code_revision',
    'langfuse_trace_id', 'mcp_transport',
    # The agent's presentation fields. `validate_agent_response` passes them through
    # without naming them, and both the console and `_stored_presentation` read them.
    # They are the gap this phase exists to close: an envelope may not lose one.
    'scope', 'references', 'follow_ups', 'routed_to',
    # Added by this proxy, on both paths.
    'remaining', 'conversation_id', 'expires_at', 'turn_id',
})

#: Keys that ride on an SSE frame body rather than on the answer envelope. `error` is
#: both: it is a terminal frame's name and the key a failed JSON response carries.
FRAME_KEYS = frozenset({'text', 'swap', 'label', 'stage', 'error'})

#: The other three payloads the console reads, each with its own shape. They are named
#: apart from the answer envelope rather than folded into it: a history row has no
#: `answer`, an envelope has no `pinned`, and one flat set would let a key move between
#: two endpoints without anything noticing.
#:
#: `GET /demo/a2ui/conversations/` — one row per thread in the sidebar.
HISTORY_ROW_KEYS = frozenset({'conversation_id', 'hadm_id', 'patient', 'pinned'})
#: `GET /demo/a2ui/conversations/<pk>/` — a thread as the console hydrates it.
CONVERSATION_KEYS = HISTORY_ROW_KEYS | frozenset({'turns', 'ceiling', 'expires_at'})
#: `GET /demo/a2ui/patients/?q=` — the `@` selector's rows.
PATIENT_LOOKUP_KEYS = frozenset({'results', 'hadm_id', 'display_name', 'meta'})

#: Everything the page may find on any response it reads.
CONSUMED_KEYS = (PUBLISHED_ENVELOPE_KEYS | FRAME_KEYS | HISTORY_ROW_KEYS
                 | CONVERSATION_KEYS | PATIENT_LOOKUP_KEYS)

#: Read by the console's live path and deliberately absent from a restored turn.
#:
#: `routed_to` is a fact about how *this* request was routed — free text matched to a
#: command before the model was consulted. It is not part of what the answer says, so it
#: is not stored and a replayed thread has nothing to show it with. Everything else the
#: turn chrome reads has to survive a refresh.
LIVE_ONLY_KEYS = frozenset({'routed_to'})

#: The turn shape a refresh draws. `turn_payloads` publishes these and
#: `should_fillTurn`/`presentFacts` reads them; the named ones are the task's list.
RESTORED_TURN_KEYS = frozenset({
    'asked', 'answer', 'verified', 'scope', 'references', 'follow_ups', 'a2ui',
    'flags', 'steps', 'ordinal', 'turn_id',
})

DEMO = Path(__file__).resolve().parent
STATIC_JS = DEMO.parent / 'static' / 'js'


def _sources(*targets):
    """The text of each target; a directory contributes every `.py`/`.js` beneath it.

    Package-aware on purpose. Phase 4 moves the ask proxy out of `views.py` into
    `demo/ask/`, and Phase 5 splits `copilot_canvas.js` into `copilot_*.js` modules, while
    these scanners and every assertion built on them are frozen as read-only. Reading a
    span of the tree rather than one named file is what lets the code move without the
    contract test having to be edited to follow it — which is the one edit a frozen test
    cannot make.

    Test modules are skipped when scanning a directory: a `demo/ask/tests.py` would
    otherwise contribute the fake `result[...] = ...` assignments in its mocks, and a
    published key would appear to have a producer that only exists in a stub.
    """
    texts = []
    for target in targets:
        if target.is_file():
            texts.append(target.read_text(encoding='utf-8'))
        elif target.is_dir():
            for pattern in ('*.py', '*.js'):
                for path in sorted(target.rglob(pattern)):
                    if path.name == 'tests.py' or path.name.startswith('test_'):
                        continue
                    texts.append(path.read_text(encoding='utf-8'))
    return '\n'.join(texts)


#: Where a published envelope key is assembled: the blocking view today, the `ask`
#: package after Phase 4, and the store's own presentation reads.
BACKEND = _sources(DEMO / 'views.py', DEMO / 'conversations.py', DEMO / 'ask')
#: Where a consumed envelope key is read: the canvas today, and every module split out of
#: it after Phase 5. `bundled/` is deliberately not scanned — that is build output.
CANVAS = _sources(*sorted(STATIC_JS.glob('copilot_*.js')))

#: A complete agent reply: every key in `AgentSuccess`, every unvalidated presentation
#: field, and the `/meds` shape the console draws with a references drawer.
AGENT_REPLY = {
    'question': 'What medications was this patient discharged on?',
    'answer': 'The discharge note lists warfarin 4 mg daily.^[1]',
    'guardrail_flags': ['citation_out_of_range:^[9]'],
    'tool_calls': [
        {'name': 'discharge_medications',
         'args': {'hadm_id': 90000009},
         'response': {'hadm_id': 90000009, 'query': 'discharge_medications',
                      'returned': 1,
                      'passages': [{'id': 'MT-2616-DS_discharge_medications_1',
                                    'section': 'discharge_medications',
                                    'text': 'warfarin 4 mg QD'}]},
         'derivable': True},
    ],
    'a2ui': {
        'surface_id': 'meds-canvas',
        'audience': ['user'],
        'renders_prose': True,
        'messages': [
            {'version': 'v0.9', 'createSurface': {
                'surfaceId': 'meds-canvas',
                'catalogId': 'https://example.com/catalogs/readmission-risk-v1.json'}},
            {'version': 'v0.9', 'updateComponents': {
                'surfaceId': 'meds-canvas',
                'components': [
                    {'id': 'root', 'component': 'Column', 'children': ['narrative']},
                    {'id': 'narrative', 'component': 'CitedNarrative',
                     'text': 'The discharge note lists warfarin 4 mg daily.^[1]',
                     'citations': [{'index': 1, 'source': 'Discharge note',
                                    'title': 'Discharge medications',
                                    'excerpt': 'warfarin 4 mg QD'}]},
                ]}},
        ],
    },
    'sources': [{'cite': 1, 'section': 'discharge_medications',
                 'text': 'warfarin 4 mg QD', 'query': 'discharge_medications'}],
    'literature': {'degraded': False, 'articles': []},
    'verified': True,
    'steps': ['Reading the Question', 'Reading the Note'],
    'scope': 'patient_chart',
    'references': [{'index': 1, 'title': 'Discharge medications',
                    'tag': 'Clinical Note', 'excerpt': 'warfarin 4 mg QD'}],
    'follow_ups': ['What dose of metoprolol was she on?'],
    'routed_to': 'meds',
    'model': 'gemini-2.5-pro',
    'code_revision': 'agent-00220-z9b',
    'langfuse_trace_id': 'a' * 32,
    'mcp_transport': 'stdio',
}


def _stream(*frames):
    """A stub for `ask_stream`: an iterable of (event, data) pairs."""
    def generator(question, trace=''):
        yield from frames
    return generator


class AskPathParityTests(TestCase):
    """`/ask` answers the same envelope whether or not the caller asked for a stream."""

    def setUp(self):
        self.user = User.objects.create_user('demo', password='x')
        self.client.force_login(self.user)
        DemoPatient.objects.create(
            hadm_id=90000009, display_name='Test Patient', age=63,
            sex='F', summary='63F', split_name='test',
        )

    def _post(self, accept=None):
        headers = {'HTTP_ACCEPT': accept} if accept else {}
        return self.client.post(
            reverse('demo:a2ui_ask'),
            data=json.dumps({'hadm_id': 90000009, 'chip': 'meds'}),
            content_type='application/json',
            **headers,
        )

    def _streamed_answer(self, response):
        """The terminal `answer` frame, read through the response the ASGI handler uses."""
        async def collect():
            chunks = []
            async for chunk in response:
                chunks.append(chunk)
            return b''.join(chunks)

        body = async_to_sync(collect)().decode('utf-8')
        frames = []
        for block in body.strip().split('\n\n'):
            lines = [line for line in block.split('\n')
                     if line.strip() and not line.startswith(':')]
            if not lines:
                continue
            name = next(line[len('event:'):].strip()
                        for line in lines if line.startswith('event:'))
            raw = next(line[len('data:'):].lstrip()
                       for line in lines if line.startswith('data:'))
            frames.append((name, json.loads(raw)))
        answers = [data for name, data in frames if name == 'answer']
        self.assertEqual(len(answers), 1, f'expected one answer frame: {frames}')
        return answers[0]

    @patch('demo.views.ask_agent_stream')
    @patch('demo.views.ask_agent')
    def test_the_blocking_and_streaming_paths_emit_the_same_envelope(
            self, blocking, streaming):
        """One thread, two requests, so `conversation_id` and `expires_at` are comparable.

        The second request is a follow-up inside the thread the first one opened, which
        is what a console does; if the two paths disagreed about the thread they opened
        this would catch it as well as a key-set difference.
        """
        blocking.return_value = dict(AGENT_REPLY)
        streaming.side_effect = _stream(
            ('planning', {'stage': 'planning', 'label': 'Reading the Question'}),
            ('answer', dict(AGENT_REPLY)),
        )

        json_body = self._post().json()
        stream_body = self._streamed_answer(
            self._post(accept='text/event-stream'))

        self.assertEqual(sorted(json_body), sorted(stream_body),
                         'the two ask paths disagree about the envelope key set')
        # `turn_id` is the one key two requests cannot agree about: it names the row
        # each answer was stored as, and these are two different turns. It is held to
        # the store immediately below instead, which is the stronger check anyway —
        # two paths that both wrote the same id would pass an equality test and be
        # wrong about one of them.
        for key in sorted(PUBLISHED_ENVELOPE_KEYS - {'turn_id'}):
            with self.subTest(key=key):
                self.assertEqual(json_body[key], stream_body[key])

        conversation = Conversation.objects.get(pk=json_body['conversation_id'])
        answered = list(conversation.turns.filter(role=Turn.Role.AGENT)
                        .order_by('ordinal'))
        self.assertEqual([json_body['turn_id'], stream_body['turn_id']],
                         [row.pk for row in answered],
                         'each answer must name the row it was stored as')

    @patch('demo.views.ask_agent_stream')
    @patch('demo.views.ask_agent')
    def test_the_two_paths_leave_the_same_rows_behind(
            self, blocking, streaming):
        """The envelope is what the reader sees; the rows are what a refresh reads.

        A field this proxy adds on its way out and forgets on its way into the store is
        invisible until somebody reloads the page and the turn comes back without it.
        Both paths call `record_answer`, and this is what says so.
        """
        blocking.return_value = dict(AGENT_REPLY)
        streaming.side_effect = _stream(('answer', dict(AGENT_REPLY)))

        json_body = self._post().json()
        stream_body = self._streamed_answer(
            self._post(accept='text/event-stream'))
        self.assertEqual(json_body['conversation_id'],
                         stream_body['conversation_id'])

        conversation = Conversation.objects.get(pk=json_body['conversation_id'])
        self.assertEqual(conversation.turn_count, 2)
        self.assertEqual(conversation.turns.count(), 4,
                         'two answered turns are two question rows and two answer rows')

        answered = list(conversation.turns.filter(role=Turn.Role.AGENT)
                        .order_by('ordinal'))
        self.assertEqual(len(answered), 2)
        for row in answered:
            with self.subTest(ordinal=row.ordinal):
                self.assertEqual(row.answer, AGENT_REPLY['answer'])
                self.assertEqual(row.model, AGENT_REPLY['model'])
                self.assertEqual(row.code_revision, AGENT_REPLY['code_revision'])
                self.assertEqual(row.langfuse_trace_id, AGENT_REPLY['langfuse_trace_id'])
                self.assertEqual(row.presentation, {
                    'a2ui': AGENT_REPLY['a2ui'],
                    'scope': AGENT_REPLY['scope'],
                    'references': AGENT_REPLY['references'],
                    'follow_ups': AGENT_REPLY['follow_ups'],
                    'verified': AGENT_REPLY['verified'],
                    'steps': AGENT_REPLY['steps'],
                })
                self.assertEqual(list(row.guardrail_flags), AGENT_REPLY['guardrail_flags'])
                self.assertEqual([call['name'] for call in row.tool_calls],
                                 ['discharge_medications'])

    @patch('demo.views.ask_agent_stream')
    @patch('demo.views.ask_agent')
    def test_the_web_added_fields_are_the_same_three_on_both_paths(
            self, blocking, streaming):
        """Named separately because these are the ones each path writes itself."""
        blocking.return_value = dict(AGENT_REPLY)
        streaming.side_effect = _stream(('answer', dict(AGENT_REPLY)))

        json_body = self._post().json()
        stream_body = self._streamed_answer(
            self._post(accept='text/event-stream'))

        self.assertEqual(json_body['remaining'], stream_body['remaining'])
        self.assertEqual(json_body['conversation_id'],
                         stream_body['conversation_id'])
        self.assertEqual(json_body['expires_at'], stream_body['expires_at'])
        # And they are the values the store actually holds, not merely equal to
        # each other — two paths that both wrote `None` would pass the check above.
        conversation = Conversation.objects.get(pk=json_body['conversation_id'])
        self.assertEqual(json_body['remaining'],
                         settings.DEMO_DAILY_LIMIT - conversation.turn_count + 1)
        self.assertEqual(json_body['expires_at'],
                         conversation.expires_at.isoformat())
        expires = datetime.fromisoformat(json_body['expires_at'])
        self.assertLess(expires - datetime.now(expires.tzinfo),
                        timedelta(hours=settings.DEMO_CONVERSATION_TTL_HOURS))

    @patch('demo.views.ask_agent', return_value=dict(AGENT_REPLY))
    def test_the_unvalidated_presentation_fields_survive_the_proxy(self, mocked):
        """`scope`, `references`, `follow_ups` and `routed_to` are not in
        `AgentSuccess`, so nothing in the validator would notice them being dropped.

        The console draws a pill, a references drawer, the next questions and a routing
        note from exactly these four.
        """
        body = self._post().json()

        for key in ('scope', 'references', 'follow_ups', 'routed_to'):
            with self.subTest(key=key):
                self.assertEqual(body[key], AGENT_REPLY[key])


class RestoredTurnShapeTests(TestCase):
    """A refreshed browser draws the same turn a live answer drew."""

    def setUp(self):
        self.user = User.objects.create_user('demo', password='x')
        patient = DemoPatient.objects.create(
            hadm_id=90000009, display_name='Test Patient', age=63,
            sex='F', summary='63F', split_name='test',
        )
        self.conversation = Conversation.objects.create(
            user=self.user, patient=patient)

    def _restored(self):
        record_answer(self.conversation, dict(AGENT_REPLY), asked='/meds')
        return turn_payloads(self.conversation)[0]

    def test_a_restored_turn_publishes_every_field_the_renderer_reads(self):
        turn = self._restored()

        self.assertLessEqual(RESTORED_TURN_KEYS, set(turn),
                             f'missing from the restored turn: '
                             f'{sorted(RESTORED_TURN_KEYS - set(turn))}')
        # The values, not only the keys: a presentation stored as `{}` would satisfy a
        # key-set check and draw nothing.
        self.assertEqual(turn['a2ui'], AGENT_REPLY['a2ui'])
        self.assertEqual(turn['references'], AGENT_REPLY['references'])
        self.assertEqual(turn['follow_ups'], AGENT_REPLY['follow_ups'])
        self.assertEqual(turn['scope'], AGENT_REPLY['scope'])
        self.assertEqual(turn['steps'], AGENT_REPLY['steps'])
        self.assertIs(turn['verified'], True)
        self.assertEqual(turn['flags'], AGENT_REPLY['guardrail_flags'])
        self.assertEqual(turn['asked'], '/meds')

    def test_the_live_and_restored_payloads_carry_the_same_presentation_keys(self):
        """The live envelope minus the live-only keys is the restored turn plus bookkeeping."""
        turn = self._restored()
        live = set(AGENT_REPLY) - LIVE_ONLY_KEYS
        # `turn_payloads` publishes `flags` where the agent says `guardrail_flags`, and
        # adds the coordinates a rating needs. Those are the only differences, and
        # naming them here is the point: a second difference would be a field one
        # renderer gets and the other does not. Both carry `turn_id`, which is why it
        # does not appear below.
        self.assertEqual(live - set(turn),
                         {'guardrail_flags', 'question', 'model', 'code_revision',
                          'langfuse_trace_id', 'mcp_transport', 'tool_calls',
                          'sources', 'literature'})
        self.assertEqual(set(turn) - live, {'flags', 'ordinal', 'asked', 'turn_id'})

    def test_every_restored_turn_names_its_own_row(self):
        """The identity a rating sends, restored: distinct per turn and the stored one.

        The defect this replaces was invisible to every existing test because each of
        them built one turn. A page counter and a row id agree on turn 1; they disagree
        from the second turn onward, and a reload makes them disagree about the first.
        """
        record_answer(self.conversation, dict(AGENT_REPLY), asked='/meds')
        record_answer(self.conversation, dict(AGENT_REPLY), asked='/labs')

        restored = turn_payloads(self.conversation)
        stored = list(self.conversation.turns.filter(role=Turn.Role.AGENT)
                      .order_by('ordinal'))

        self.assertEqual([turn['turn_id'] for turn in restored],
                         [row.pk for row in stored])
        self.assertNotEqual(restored[0]['turn_id'], restored[1]['turn_id'],
                            'two turns sharing an identity is the bug, not a detail')


class SourceKeyAgreementTests(SimpleTestCase):
    """Every envelope key the console reads is one this side publishes."""

    def _keys_read(self, source, handles):
        found = set()
        for handle in handles:
            found |= set(re.findall(
                r'\b' + re.escape(handle) + r'\.([a-z_][a-z0-9_]*)', source))
        return found

    def _produced_keys(self):
        """The keys the source actually produces, derived rather than restated."""
        typed = set(AgentSuccess.__annotations__)
        assigned = set(re.findall(r"(?:result|data)\['([a-z_]+)'\]\s*=", BACKEND))
        stored = set(re.findall(r"result\.get\(\s*'([a-z_]+)'\s*\)", BACKEND))
        return typed | assigned | stored

    def test_every_published_key_has_a_producer(self):
        produced = self._produced_keys()

        self.assertLessEqual(
            PUBLISHED_ENVELOPE_KEYS, produced,
            f'published but produced nowhere: '
            f'{sorted(PUBLISHED_ENVELOPE_KEYS - produced)}',
        )

    def test_every_response_key_the_client_reads_is_published(self):
        read = self._keys_read(CANVAS, ('payload', 'answerPayload', 'failure'))

        self.assertTrue(read, 'the page reads no response key at all — did the '
                              'handle get renamed?')
        self.assertLessEqual(
            read, CONSUMED_KEYS,
            f'read by the console but published nowhere: '
            f'{sorted(read - CONSUMED_KEYS)}',
        )

    def test_every_key_the_console_reads_is_named_by_the_endpoint_that_publishes_it(self):
        """The other half of the agreement, for the three payloads that are built as
        dict literals rather than by assignment: a key renamed in Django has to fail
        here, because nothing in the browser would notice until a row drew empty."""
        for family, keys in (
                ('history row', HISTORY_ROW_KEYS),
                ('conversation', CONVERSATION_KEYS),
                ('patient lookup', PATIENT_LOOKUP_KEYS)):
            for key in sorted(keys):
                with self.subTest(payload=family, key=key):
                    self.assertIn(f"'{key}'", BACKEND,
                                  f'{key} is read from the {family} payload and no '
                                  f'endpoint names it')

    def test_the_frame_vocabulary_is_disjoint_from_the_envelope(self):
        """A frame field that leaked into the envelope would be stored with the turn.

        A *failed* response is `{'error': ..., 'remaining': ...}`, which is not an
        envelope: it carries no answer, so no turn is stored from it and `error` is not
        part of the shape the restore path reads.
        """
        self.assertEqual(FRAME_KEYS & PUBLISHED_ENVELOPE_KEYS, frozenset())
        self.assertIn('error', FRAME_KEYS)

    def test_the_canvas_reads_every_presentation_field_the_contract_publishes(self):
        """The other direction: a field the console never reads is dead weight, and the
        one that stops being read is the one whose drawer silently disappeared."""
        read = self._keys_read(CANVAS, ('payload', 'answerPayload'))

        for key in ('scope', 'references', 'follow_ups', 'verified', 'a2ui', 'answer',
                    'conversation_id', 'expires_at', 'remaining'):
            with self.subTest(key=key):
                self.assertIn(key, read)
